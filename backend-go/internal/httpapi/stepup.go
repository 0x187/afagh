// ═══ تأیید دومرحله‌ای عملیاتی (step-up) — پورت lib/step-up.ts و step-up-actions.ts ═══
//
// برای عملیات حساس (grades:edit) کاربر باید رمز خود را دوباره تأیید کند؛ در
// صورت درستی، توکن امضاشدهٔ T1 در کوکی httpOnly با TTL ۱۰ دقیقه می‌نشیند.
// نام کوکی و قالب توکن دقیقاً همان Next است تا کوکی صادرشده توسط هر دو سرویس
// پذیرفته شود (مهاجرت تدریجی بدون لاگین/تأیید مجدد).
package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/session"
	"backend-go/internal/verification"
)

// StepUpTTL دامنه‌های مجاز و عمر توکن (ثانیه) — همان STEPUP_TTL در TS.
var StepUpTTL = map[string]int{
	"grades:edit":    10 * 60,
	"session:unlock": 10 * 60,
}

// StepUpCookieName معادل stepUpCookieName در TS.
func StepUpCookieName(scope string) string {
	var b strings.Builder
	for _, r := range scope {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	return "stepup_" + b.String()
}

// StepUpAPI هندلرهای تأیید رمز.
type StepUpAPI struct {
	Store    *session.Store
	Signer   *verification.Signer
	Verifier PasswordVerifier
	Limiter  StepUpLimiter
	ClientIP func(c *gin.Context) string
	Secure   bool
}

func (a *StepUpAPI) clientIP(c *gin.Context) string {
	if a.ClientIP != nil {
		return a.ClientIP(c)
	}
	return c.ClientIP()
}

func (a *StepUpAPI) Register(r gin.IRouter) {
	r.POST("/step-up/request", a.request)
	r.GET("/step-up/status", a.status)
}

func (a *StepUpAPI) currentUser(c *gin.Context) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		return nil
	}
	u, _ := a.Store.Get(c.Request.Context(), token, false)
	return u
}

type stepUpRequest struct {
	Scope    string `json:"scope"`
	Password string `json:"password"`
}

// request پورت requestStepUpAction.
func (a *StepUpAPI) request(c *gin.Context) {
	var in stepUpRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	ttl, ok := StepUpTTL[in.Scope]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دامنهٔ تأیید نامعتبر است."})
		return
	}
	if in.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "رمز عبور را وارد کنید."})
		return
	}
	if allowed, msg := stepUpGate(c.Request.Context(), a.Limiter, user.ID, a.clientIP(c)); !allowed {
		c.JSON(http.StatusTooManyRequests, gin.H{"ok": false, "error": msg})
		return
	}
	okPass, err := a.Verifier.VerifyPasswordForUser(c.Request.Context(), user.ID, in.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطا در ارتباط با سرور."})
		return
	}
	if !okPass {
		if a.Limiter != nil {
			_ = a.Limiter.Hit(c.Request.Context(), "stepup:pw:"+strconv.FormatInt(user.ID, 10), 15*60)
			ip := a.clientIP(c)
			if len(ip) > 64 {
				ip = ip[:64]
			}
			_ = a.Limiter.Hit(c.Request.Context(), "stepup:ip:"+ip, 15*60)
		}
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "رمز نادرست است."})
		return
	}
	token, err := a.Signer.Sign(c.Request.Context(), map[string]any{"uid": float64(user.ID), "scope": in.Scope}, ttl)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(StepUpCookieName(in.Scope), token, ttl, "/", "", a.Secure, true)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// status آیا دامنهٔ حساس هم‌اکنون تأییدشده است؟
func (a *StepUpAPI) status(c *gin.Context) {
	scope := c.Query("scope")
	if _, ok := StepUpTTL[scope]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دامنهٔ تأیید نامعتبر است."})
		return
	}
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"scope": scope,
		"valid": CheckStepUp(c.Request, a.Signer, user.ID, scope),
	}})
}

// CheckStepUp معادل checkStepUpToken: کوکی همان دامنه را می‌خواند و uid/scope را
// با مقدار امضاشده مقایسه می‌کند.
func CheckStepUp(r *http.Request, signer *verification.Signer, userID int64, scope string) bool {
	if signer == nil {
		return false
	}
	cookie, err := r.Cookie(StepUpCookieName(scope))
	if err != nil || cookie.Value == "" {
		return false
	}
	payload, ok, _ := signer.Verify(r.Context(), cookie.Value)
	if !ok {
		return false
	}
	uid, _ := payload["uid"].(float64)
	sc, _ := payload["scope"].(string)
	return int64(uid) == userID && sc == scope
}
