// ═══ چهار کرون افزوده — پورت api/cron/{greetings, graduation-scan, ═══
// ═══ messenger-link-purge, bi-refresh} ═══
//
//	احراز فقط ماشین‌به‌ماشین با هدر x-cron-secret و راز اختصاصی هر جاب
//	(اولویت: جدول system_settings → ENV — fail-closed بدون راز). GET فقط
//	وضعیت است (بدون اثر جانبی)؛ اجرای واقعی فقط با POST. مقایسهٔ هدر با
//	کلید زمان‌ثابت است (cron.SecretMatches). مسیرهای دقیق این‌جا ثبت می‌شوند
//	و gin مسیر ایستا را بر /cron/:job عمومی مقدم می‌کند — بدون دست‌زدن به
//	internal/httpapi/cron.go.
package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"backend-go/internal/cron"
	"backend-go/internal/messaging"
	"backend-go/internal/ratelimit"
)

// cronExtraJob تعریف یک کرون افزوده.
type cronExtraJob struct {
	SecretKey  string // کلید تنظیم حاوی راز
	EnvName    string // نام ENV همان کلید (چون هنوز در PhaseOneDefs نیست)
	RateKey    string // پیشوند محدودیت نرخ
	Audit      string // اکشن ممیزی (عیناً مطابق Next)
	RunError   string // پیام ۵۰۰
	StatusHint string // پیام GET
}

var cronExtraJobs = map[string]cronExtraJob{
	"greetings": {
		SecretKey: "GREETINGS_CRON_SECRET", EnvName: "GREETINGS_CRON_SECRET", RateKey: "cron:greet",
		Audit: "CRON_GREETINGS", RunError: "اجرای تبریک‌های خودکار ناموفق بود؛ دوباره تلاش کنید.",
		StatusHint: "اجرای واقعی تبریک‌ها فقط با POST انجام می‌شود.",
	},
	"graduation-scan": {
		SecretKey: "GRADUATION_SCAN_CRON_SECRET", EnvName: "GRADUATION_SCAN_CRON_SECRET", RateKey: "cron:grad",
		Audit: "CRON_GRADUATION_SCAN", RunError: "پویش فارغ‌التحصیلی ناموفق بود؛ دوباره تلاش کنید.",
		StatusHint: "اجرای واقعی پویش فقط با POST انجام می‌شود.",
	},
	"messenger-link-purge": {
		SecretKey: "MSG_LINK_CRON_SECRET", EnvName: "MSG_LINK_CRON_SECRET", RateKey: "cron:msglinkpurge",
		Audit: "CRON_LINK_PURGE", RunError: "پاکسازی لینک‌های پیام‌رسان ناموفق بود؛ دوباره تلاش کنید.",
		StatusHint: "اجرای واقعی پاکسازی فقط با POST انجام می‌شود.",
	},
	"bi-refresh": {
		SecretKey: "BI_CRON_SECRET", EnvName: "BI_CRON_SECRET", RateKey: "cron:bi",
		Audit: "CRON_BI_REFRESH", RunError: "تازه‌سازی BI ناموفق بود؛ دوباره تلاش کنید.",
		StatusHint: "اجرای واقعی تازه‌سازی فقط با POST انجام می‌شود.",
	},
}

// CronExtraAPI هندلرهای کرون‌های افزوده.
type CronExtraAPI struct {
	Engine  *cron.Engine
	Limiter *ratelimit.Limiter
}

// Register مسیرهای دقیق هر چهار جاب را ثبت می‌کند (ایستا، مقدم بر /cron/:job).
func (a *CronExtraAPI) Register(r gin.IRouter) {
	for name := range cronExtraJobs {
		n := name
		r.GET("/cron/"+n, func(c *gin.Context) { a.status(c, n) })
		r.POST("/cron/"+n, func(c *gin.Context) { a.run(c, n) })
	}
}

// authorize راز و محدودیت نرخ — fail-closed.
func (a *CronExtraAPI) authorize(c *gin.Context, job cronExtraJob) bool {
	if a.Limiter != nil {
		if ok, _, err := a.Limiter.Allow(c.Request.Context(), job.RateKey+":"+c.ClientIP(), 30, 60); err == nil && !ok {
			c.JSON(http.StatusTooManyRequests, gin.H{"ok": false, "error": "تعداد درخواست‌ها بیش از حد مجاز است."})
			return false
		}
	}
	secret := messaging.SettingRaw(c.Request.Context(),
		messaging.New(a.Engine.Pool, a.Engine.Settings), job.SecretKey, job.EnvName, "")
	if strings.TrimSpace(secret) == "" || !cron.SecretMatches(c.GetHeader("x-cron-secret"), secret) {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "دسترسی غیرمجاز است. کلید کرون معتبر نیست."})
		return false
	}
	return true
}

func (a *CronExtraAPI) status(c *gin.Context, name string) {
	job, ok := cronExtraJobs[name]
	if !ok || !a.authorize(c, job) {
		if _, known := cronExtraJobs[name]; !known {
			c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "جاب یافت نشد."})
		}
		return
	}
	out := gin.H{"ok": true, "dryRun": true, "status": "آماده", "hint": job.StatusHint}
	if name == "bi-refresh" {
		// فقط وضعیت کش — خواندن، بدون بازسازی و بدون هیچ نوشتن.
		cache, err := a.Engine.BiCacheStatus(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خواندن وضعیت کش ناموفق بود؛ دوباره تلاش کنید."})
			return
		}
		out["cache"] = cache
	}
	c.JSON(http.StatusOK, out)
}

func (a *CronExtraAPI) run(c *gin.Context, name string) {
	job, ok := cronExtraJobs[name]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "جاب یافت نشد."})
		return
	}
	if !a.authorize(c, job) {
		return
	}
	ctx := c.Request.Context()
	started := time.Now()
	var res map[string]any
	var err error
	switch name {
	case "greetings":
		res, err = a.Engine.RunGreetingsCron(ctx)
	case "graduation-scan":
		res, err = a.Engine.RunGraduationScanCron(ctx, c.Query("force") == "1")
	case "messenger-link-purge":
		res, err = a.Engine.RunLinkPurgeCron(ctx)
	case "bi-refresh":
		termID := new(int64)
		if v, perr := strconv.ParseInt(c.Query("termId"), 10, 64); perr == nil && v > 0 {
			*termID = v
		} else {
			termID = nil
		}
		res, err = a.Engine.RunBiRefreshCron(ctx, termID)
	}
	durationMs := time.Since(started).Milliseconds()
	if err != nil {
		a.Engine.Audit(ctx, job.Audit, map[string]any{"durationMs": durationMs, "error": err.Error()})
		if name == "bi-refresh" {
			// بازسازیBI خطای منطقی (مثل «ترم جاری مشخص نیست») → ۴۰۰ با همان پیام.
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": job.RunError})
		return
	}
	details := map[string]any{"durationMs": durationMs}
	for k, v := range res {
		details[k] = v
	}
	a.Engine.Audit(ctx, job.Audit, details)
	out := gin.H{"ok": true, "durationMs": durationMs}
	for k, v := range res {
		out[k] = v
	}
	if name == "bi-refresh" {
		if cache, cerr := a.Engine.BiCacheStatus(ctx); cerr == nil {
			out["cache"] = cache
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "تازه‌سازی BI ناموفق بود؛ دوباره تلاش کنید."})
			return
		}
	}
	c.JSON(http.StatusOK, out)
}
