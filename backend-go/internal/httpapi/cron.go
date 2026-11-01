// ═══ Cron endpoints (phase 10) — x-cron-secret, GET status, POST run ═══
package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"backend-go/internal/cron"
	"backend-go/internal/ratelimit"
)

// CronAPI is the background handlers.
type CronAPI struct {
	Engine  *cron.Engine
	Limiter *ratelimit.Limiter
}

func (a *CronAPI) Register(r gin.IRouter) {
	r.GET("/cron/:job", a.cronStatus)
	r.POST("/cron/:job", a.cronRun)
}

func (a *CronAPI) authorize(c *gin.Context, job *cron.Job) bool {
	// Light rate limit before the secret check.
	if a.Limiter != nil {
		if ok, _, err := a.Limiter.Allow(c.Request.Context(), job.RateKey+":"+c.ClientIP(), 30, 60); err == nil && !ok {
			c.JSON(http.StatusTooManyRequests, gin.H{"ok": false, "error": "تعداد درخواست‌ها بیش از حد مجاز است."})
			return false
		}
	}
	secret := ""
	if a.Engine.Settings != nil {
		secret, _ = a.Engine.Settings.Get(c.Request.Context(), job.SecretKey)
	}
	if strings.TrimSpace(secret) == "" || !cron.SecretMatches(c.GetHeader("x-cron-secret"), secret) {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "دسترسی غیرمجاز است. کلید کرون معتبر نیست."})
		return false
	}
	return true
}

func (a *CronAPI) cronStatus(c *gin.Context) {
	job := a.Engine.Find(c.Param("job"))
	if job == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "جاب یافت نشد."})
		return
	}
	if !a.authorize(c, job) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "dryRun": true, "status": "آماده", "job": job.Name,
		"hint": "اجرای واقعی فقط با POST انجام می‌شود."})
}

func (a *CronAPI) cronRun(c *gin.Context) {
	job := a.Engine.Find(c.Param("job"))
	if job == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "جاب یافت نشد."})
		return
	}
	if !a.authorize(c, job) {
		return
	}
	started := time.Now()
	res, err := job.Run(c.Request.Context())
	durationMs := time.Since(started).Milliseconds()
	action := "CRON_" + strings.ToUpper(strings.ReplaceAll(job.Name, "-", "_"))
	if err != nil {
		a.Engine.Audit(c.Request.Context(), action, map[string]any{"durationMs": durationMs, "error": err.Error()})
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "اجرای جاب ناموفق بود؛ دوباره تلاش کنید."})
		return
	}
	details := map[string]any{"durationMs": durationMs}
	for k, v := range res {
		details[k] = v
	}
	a.Engine.Audit(c.Request.Context(), action, details)
	out := gin.H{"ok": true, "durationMs": durationMs}
	for k, v := range res {
		out[k] = v
	}
	c.JSON(http.StatusOK, out)
}
