// ═══ POST /api/v2/session/ping و /session/unlock — پورت مسیرهای Next ═══
package httpapi

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"backend-go/internal/ratelimit"
	"backend-go/internal/session"
	"backend-go/internal/sessionlock"
)

// StepUpLimiter عملیات موردنیاز گیت تأیید رمز (peek/hit/count).
type StepUpLimiter interface {
	Peek(ctx context.Context, key string, limit, windowSec int) (allowed bool, retryAfterSec int, err error)
	Hit(ctx context.Context, key string, windowSec int) error
	Count(ctx context.Context, key string) (int, error)
}

// PasswordVerifier تأیید رمز کاربر جاری — پیاده‌سازی: authn.Service.VerifyPasswordForUser.
type PasswordVerifier interface {
	VerifyPasswordForUser(ctx context.Context, userID int64, password string) (bool, error)
}

// SessionLockAPI هندلرهای ضربان/بازگشایی قفل.
type SessionLockAPI struct {
	Store    *session.Store
	Locks    *sessionlock.Service
	Limiter  StepUpLimiter
	Verifier PasswordVerifier
	ClientIP func(c *gin.Context) string
}

func (a *SessionLockAPI) clientIP(c *gin.Context) string {
	if a.ClientIP != nil {
		return a.ClientIP(c)
	}
	return c.ClientIP()
}

func (a *SessionLockAPI) Register(r gin.IRouter) {
	r.POST("/session/ping", a.ping)
	r.GET("/session/ping", a.ping) // سازگاری قرارداد SPA (بدون بدنه = پرسش وضعیت)
	r.POST("/session/unlock", a.unlock)
}

type pingBody struct {
	Active bool `json:"active"`
}

// ping پورت GET/POST /session/ping — منبع حقیقت قفل بیکاری.
func (a *SessionLockAPI) ping(c *gin.Context) {
	token := session.ReadToken(parseCookies(c.Request))
	var user *session.User
	if token != "" {
		user, _ = a.Store.Get(c.Request.Context(), token, false)
	}
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "locked": false, "reason": "no-session"})
		return
	}

	timeoutMin := a.Locks.ResolveIdleTimeoutMinutes(c.Request.Context(), user.Roles)

	// پرچم قفل صریح (مثلاً قفل دستی/step-up) بر هر چیز مقدم است.
	if a.Locks.IsLocked(c.Request.Context(), user.ID) {
		c.JSON(http.StatusOK, gin.H{"ok": true, "locked": true, "timeoutMin": timeoutMin, "reauthMin": a.Locks.ResolveReauthMinutes(c.Request.Context(), timeoutMin)})
		return
	}

	var body pingBody
	if c.Request.Method == http.MethodPost {
		_ = c.ShouldBindJSON(&body) // بدنهٔ خالی = پرسش وضعیت
	}

	if body.Active {
		a.Locks.TouchActivity(c.Request.Context(), user.ID)
		c.JSON(http.StatusOK, gin.H{"ok": true, "locked": false, "timeoutMin": timeoutMin, "reauthMin": a.Locks.ResolveReauthMinutes(c.Request.Context(), timeoutMin)})
		return
	}

	if a.Locks.IsIdle(c.Request.Context(), user.ID, timeoutMin) {
		// خودِ سرور قفل را ثبت می‌کند (نه فقط گزارش) — رفرش/تب جدید هم قفل می‌ماند.
		_ = a.Locks.SetLock(c.Request.Context(), user.ID)
		c.JSON(http.StatusOK, gin.H{"ok": true, "locked": true, "timeoutMin": timeoutMin, "reauthMin": a.Locks.ResolveReauthMinutes(c.Request.Context(), timeoutMin)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "locked": false, "timeoutMin": timeoutMin, "reauthMin": a.Locks.ResolveReauthMinutes(c.Request.Context(), timeoutMin)})
}

type unlockBody struct {
	Password string `json:"password"`
}

// unlock پورت verifyOwnPasswordCore: همان سقف ۵ خطا/۱۵دقیقه به‌ازای کاربر + IP،
// تأخیر تصاعدی، و پاک‌سازی پرچم قفل در صورت موفقیت.
func (a *SessionLockAPI) unlock(c *gin.Context) {
	var body unlockBody
	if err := c.ShouldBindJSON(&body); err != nil || body.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "رمز عبور را وارد کنید."})
		return
	}

	token := session.ReadToken(parseCookies(c.Request))
	var user *session.User
	if token != "" {
		user, _ = a.Store.Get(c.Request.Context(), token, false)
	}
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "نشست منقضی شده است؛ دوباره وارد شوید."})
		return
	}

	if ok, msg := a.stepUpGateForRequest(c, user.ID); !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": msg})
		return
	}

	ok, err := a.Verifier.VerifyPasswordForUser(c.Request.Context(), user.ID, body.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطا در ارتباط با سرور."})
		return
	}
	if !ok {
		if a.Limiter != nil {
			_ = a.Limiter.Hit(c.Request.Context(), fmt.Sprintf("stepup:pw:%d", user.ID), 15*60)
			_ = a.Limiter.Hit(c.Request.Context(), fmt.Sprintf("stepup:ip:%.64s", a.clientIP(c)), 15*60)
		}
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "رمز نادرست است."})
		return
	}
	_ = a.Locks.ClearLock(c.Request.Context(), user.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// stepUpGateForRequest نسخهٔ آگاه به IP همان درخواست.
func (a *SessionLockAPI) stepUpGateForRequest(c *gin.Context, userID int64) (bool, string) {
	return stepUpGate(c.Request.Context(), a.Limiter, userID, a.clientIP(c))
}

// stepUpGate گیت مشترک تأیید رمز (۵ خطا/۱۵دقیقه کاربر + ۲۰/۱۵دقیقه IP) با
// تأخیر تصاعدی — همان قرارداد SessionLockAPI.unlock و step-up حساس.
func stepUpGate(ctx context.Context, limiter StepUpLimiter, userID int64, ip string) (bool, string) {
	if limiter == nil {
		return true, ""
	}
	userKey := fmt.Sprintf("stepup:pw:%d", userID)
	ipKey := fmt.Sprintf("stepup:ip:%.64s", ip)
	uOK, uRetry, _ := limiter.Peek(ctx, userKey, 5, 15*60)
	iOK, iRetry, _ := limiter.Peek(ctx, ipKey, 20, 15*60)
	if !uOK || !iOK {
		retry := 0
		if !uOK {
			retry = uRetry
		}
		if !iOK && iRetry > retry {
			retry = iRetry
		}
		if n, err := limiter.Count(ctx, userKey); err == nil && n > 0 {
			// تأخیر تصاعدی پیش از پاسخ — همان progressiveDelay(count) در TS
			progressiveSleep(ctx, n)
		}
		minutes := int(math.Ceil(float64(retry) / 60))
		return false, fmt.Sprintf("تلاش‌های تأیید رمز بیش از حد مجاز شد. %d دقیقهٔ دیگر دوباره تلاش کنید.", minutes)
	}
	return true, ""
}

// progressiveSleep تأخیر تصاعدی پیش از پاسخ (پورت progressiveDelay).
func progressiveSleep(ctx context.Context, failCount int) {
	t := time.NewTimer(time.Duration(ratelimit.ProgressiveDelayMs(failCount)) * time.Millisecond)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}
