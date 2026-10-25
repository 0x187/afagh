// ═══ پیکربندی سرویس Go (بازنویسی بکند آفاق) ═══
//
// قرارداد متغیرهای محیطی عمداً همان قرارداد afagh-next است تا یک کانتینر
// compose بتواند هر دو سرویس را تغذیه کند. در production متغیرهای حیاتی
// (DATABASE_URL) اجباری‌اند — همان سیاست fail-closed «requireEnvInProd» در
// afagh-next/src/db/index.ts: مقدار خالی یا فقط-فاصله «تنظیم‌نشده» شمرده
// می‌شود و سرویس بالا نمی‌آید.
package config

import (
	"fmt"
	"os"
	"strings"
)

// Config همهٔ تنظیمات لازم سرویس را نگه می‌دارد.
type Config struct {
	// زیرساخت (مشترک با afagh-next)
	DatabaseURL    string // استخر مالک اسکیما (نقش afagh)
	DatabaseURLApp string // استخر محدود afagh_app با RLS — در فاز ۰ فقط ساخته می‌شود
	RedisURL       string // خالی = بررسی redis در health «skipped»
	S3Endpoint     string // خالی = بررسی minio در health «skipped»
	S3Bucket       string
	S3AccessKey    string
	S3SecretKey    string

	// رفتار سرویس
	Port    string // PORT (پیش‌فرض 8090)
	Env     string // NODE_ENV سازگاری: production | development
	Version string // AFAGH_VERSION | APP_VERSION | dev

	// لبهٔ مسیریابی (strangler)
	NextUpstream  string   // آدرس سرویس Next.js — هر مسیرِ «مالک‌نشده» به این‌جا پروکسی می‌شود
	SpaUpstream   string   // اگر ست باشد، SPA از این آدرس پروکسی می‌شود (dev: Vite)
	SpaDist       string   // وگرنه مسیر پوشهٔ dist ساخته‌شدهٔ SPA (production)
	OwnedPrefixes []string // پیشوندهایی که سرویس Go خودش پاسخ می‌دهد؛ بقیه → Next

	// امنیت (همان ENVهای afagh-next)
	AllowedExtraOrigins []string // ALLOWED_EXTRA_ORIGINS — لیست سفید CSRF
	SessionCookiePrefix string   // AFAGH_SESSION_COOKIE_PREFIX: «host» = dual-read با __Host-afagh_session

	// لاگ
	LogLevel  string
	LogFormat string // json | pretty (پیش‌فرض: pretty در غیر production)
	LogApp    string
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func isProduction(env string) bool { return env == "production" }

// Load پیکربندی را از محیط می‌خواند؛ در production نبودِ DATABASE_URL خطای مرگبار می‌دهد.
func Load() (*Config, error) {
	cfg := &Config{
		Env:                 env("NODE_ENV", "development"),
		Port:                env("PORT", "8090"),
		Version:             env("AFAGH_VERSION", env("APP_VERSION", "dev")),
		NextUpstream:        env("AFAGH_NEXT_UPSTREAM", "http://127.0.0.1:8080"),
		SpaUpstream:         strings.TrimSpace(os.Getenv("AFAGH_SPA_UPSTREAM")),
		SpaDist:             strings.TrimSpace(os.Getenv("AFAGH_SPA_DIST")),
		SessionCookiePrefix: strings.ToLower(env("AFAGH_SESSION_COOKIE_PREFIX", "")),
		LogLevel:            strings.ToLower(env("LOG_LEVEL", "info")),
		LogFormat:           strings.ToLower(env("LOG_FORMAT", "")),
		LogApp:              env("LOG_APP_NAME", "afagh"),
	}

	// ── requireEnvInProd — پورت وفادار از src/db/index.ts ──
	cfg.DatabaseURL = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if cfg.DatabaseURL == "" {
		if isProduction(cfg.Env) {
			return nil, fmt.Errorf("[config] در production متغیر DATABASE_URL اجباری است و نمی‌تواند خالی بماند (پیش‌فرض توسعه‌ای در production پذیرفته نمی‌شود)")
		}
		cfg.DatabaseURL = "postgres://afagh:afagh@localhost:5432/afagh_db"
	}
	// استخر RLS: در production نبودنش خطا نیست (تنها زمانی لازم است که مسیرهای
	// دانشکیت RLS فعال شوند)؛ در فازهای بعدی مصرف‌کننده‌هایش fail-closed خودشان را دارند.
	cfg.DatabaseURLApp = strings.TrimSpace(os.Getenv("DATABASE_URL_APP"))
	if cfg.DatabaseURLApp == "" && !isProduction(cfg.Env) {
		cfg.DatabaseURLApp = "postgres://afagh_app:afagh_app@127.0.0.1:5432/afagh_db"
	}

	cfg.RedisURL = strings.TrimSpace(os.Getenv("REDIS_URL"))
	cfg.S3Endpoint = strings.TrimSpace(os.Getenv("S3_ENDPOINT"))
	cfg.S3Bucket = strings.TrimSpace(os.Getenv("S3_BUCKET"))
	cfg.S3AccessKey = strings.TrimSpace(os.Getenv("S3_ACCESS_KEY"))
	cfg.S3SecretKey = strings.TrimSpace(os.Getenv("S3_SECRET_KEY"))

	cfg.AllowedExtraOrigins = nil
	for _, o := range strings.Split(os.Getenv("ALLOWED_EXTRA_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			cfg.AllowedExtraOrigins = append(cfg.AllowedExtraOrigins, o)
		}
	}

	cfg.OwnedPrefixes = nil
	for _, p := range strings.Split(env("AFAGH_OWNED_PREFIXES", "/api/v2,/app"), ",") {
		if p = strings.TrimSpace(p); p != "" {
			if !strings.HasPrefix(p, "/") {
				return nil, fmt.Errorf("[config] AFAGH_OWNED_PREFIXES: پیشوند باید با «/» شروع شود: %q", p)
			}
			cfg.OwnedPrefixes = append(cfg.OwnedPrefixes, p)
		}
	}
	return cfg, nil
}

// IsProduction گزارش می‌دهد که سرویس در حالت production اجرا می‌شود.
func (c *Config) IsProduction() bool { return isProduction(c.Env) }
