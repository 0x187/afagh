// ═══ احراز هویت — پورت وفادار از afagh-next/src/lib/auth.ts (فاز ۱) ═══
//
// هستهٔ ورود/خروج/تغییر رمز/جابه‌جایی حساب بکند Go. ساختار فایل‌ها:
//
//	authn.go          — سرویس، پیکربندی، اینترفیس‌های تزریقی، انواع نتیجه
//	password.go       — scrypt Verify/Hash + هش ساختگی (پدینگ زمان‌ثابت)
//	cookies.go        — ماتریس انتقال کوکی (پورت proxy-trust.ts) + نوشتن/حذف
//	login.go          — login/chooseLoginAccount + گسترش هم‌شخصی
//	changepassword.go — تغییر رمز با همان پیام‌های اعتبارسنجی
//	switch.go         — جابه‌جایی به حساب هم‌شخص (پورت account-switch.ts)
//	persian.go        — toEnDigits (نرمال‌سازی ارقام فارسی/عربی)
//	staffncmap_gen.go — نگاشت generated کد استاد → کدملی
//
// قرارداد پاسخ با Next.js یکسان است (پاکت {ok, error?, ...}) تا SPA بدون
// تغییر منطق روی هر دو بکند کار کند؛ پیام‌های خطا عیناً رشته‌های auth.ts و
// login.actions.ts هستند.
//
// متغیرهای محیطی (همان قرارداد afagh-next؛ چون internal/config در مالکیت
// این فاز نیست، مستقیم از os.Getenv خوانده می‌شود):
//
//	NODE_ENV                    — «production» ⇒ حالت تولید (Secure کوکی اجباری)
//	AFAGH_PUBLIC_BASE_URL       — تشخیص https برای Secure در حالت auto
//	AFAGH_COOKIE_SECURE         — auto|true|false (پیش‌فرض auto)
//	AFAGH_COOKIE_SAMESITE       — auto|lax|none|strict (پیش‌فرض lax)
//	AFAGH_SESSION_COOKIE_PREFIX — «host» ⇒ dual-write نام __Host-afagh_session
//	AFAGH_SESSION_MAX_HOURS     — سقف مطلق نشست (پیش‌فرض ۴، بازهٔ ۱..۲۴)
//	AFAGH_SCRYPT_N              — پارامتر N اسکریپت (پیش‌فرض ۱۶۳۸۴، کف مجاز)
package authn

import (
	"context"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/logger"
	"backend-go/internal/session"
)

// loggerFor لاگر ماژول — فقط برای هشدارهای زیرساختی (لیمیت خراب، N نامعتبر).
func loggerFor() *logger.Logger { return logger.For("authn") }

// اینترفیس‌های تزریقی — امضاها عیناً از قرارداد فاز ۱ (docs/rewrite/phase1-contracts.md).
// پیاده‌سازی‌ها در پکیج‌های infra هستند؛ اینجا فقط مصرف‌کننده‌ایم.

// RateLimiter سقف نرخ اتمیک (INCR+EXPIRE معادل) — پیاده‌سازی: internal/ratelimit.
type RateLimiter interface {
	Allow(ctx context.Context, key string, limit int, windowSec int) (allowed bool, retryAfterSec int, err error)
	Count(ctx context.Context, key string) (int, error)
	Release(ctx context.Context, key string) error
}

// TokenSigner امضا/اعتبارسنجی توکن انتخاب حساب — پیاده‌سازی: internal/verification.
type TokenSigner interface {
	Sign(ctx context.Context, payload map[string]any, ttlSec int) (string, error)
	Verify(ctx context.Context, token string) (payload map[string]any, ok bool, err error)
}

// LockClearer پاک‌کردن قفل بیکاری نشست — پیاده‌سازی: internal/sessionlock.
type LockClearer interface {
	ClearLock(ctx context.Context, userID int64) error
}

// UNKNOWN_CLIENT_IP همان UNKNOWN_CLIENT_IP در proxy-trust.ts — کلید rate-limit
// وقتی هیچ هویتی در دسترس نیست.
const UNKNOWN_CLIENT_IP = "unknown"

// پیام‌های خطا — عیناً رشته‌های auth.ts و login.actions.ts (فارسی، بدون تغییر).
const (
	msgLoginFailed      = "شناسه یا رمز نادرست است."
	msgChooseSignedOut  = "نشست انتخاب حساب منقضی شده است. دوباره وارد شوید."
	msgChooseInvalidAcc = "حساب معتبر نیست."
	msgChooseInactive   = "حساب غیرفعال است."
	msgRateLimitGeneric = "تلاش بیش از حد مجاز. چند دقیقه دیگر دوباره تلاش کنید."
	msgSignFailed       = "خطای داخلی در آماده‌سازی انتخاب حساب. لطفاً با کد پرسنلی/دانشجویی هر حساب جداگانه وارد شوید."
	msgUserNotFound     = "کاربر یافت نشد."
)

// LoginRateLimitError سقف ورود از یک IP تمام شده — هندلر HTTP آن را به پیام
// عمومی login.actions.ts (و وضعیت ۴۲۹) تبدیل می‌کند؛ هرگز متن خام برنمی‌گردد.
type LoginRateLimitError struct {
	RetryAfterSec int
}

func (e *LoginRateLimitError) Error() string { return "LOGIN_RATE_LIMITED" }

// LoginCandidate خلاصهٔ نمایشی حساب برای صفحهٔ «انتخاب حساب» — همان LoginCandidate.
type LoginCandidate struct {
	ID              int64    `json:"id"`
	Name            string   `json:"name"`
	StaffCodes      []string `json:"staffCodes"`
	UniversityTitle *string  `json:"universityTitle"`
	Roles           []string `json:"roles"`
}

// LoginResult نتیجهٔ چندحالتی login — هندلر HTTP آن را به پاکت قرارداد تبدیل می‌کند.
type LoginResult struct {
	OK         bool
	Error      string
	MustChange bool
	NeedChoice bool
	Token      string
	Candidates []LoginCandidate
}

// SimpleResult نتیجهٔ choose-account / change-password / switch-account.
type SimpleResult struct {
	OK         bool
	Error      string
	MustChange bool
}

// Config مقادیر رفتاری موردنیاز authn — از ConfigFromEnv پر می‌شود تا بدون
// وابستگی به internal/config (خارج از مالکیت این فاز) همان ENVهای afagh-next
// خوانده شوند.
type Config struct {
	Production          bool   // NODE_ENV == "production"
	PublicBaseURL       string // AFAGH_PUBLIC_BASE_URL
	CookieSecure        string // AFAGH_COOKIE_SECURE
	CookieSameSite      string // AFAGH_COOKIE_SAMESITE
	SessionCookiePrefix string // AFAGH_SESSION_COOKIE_PREFIX (کوچک‌شده)
	SessionMaxHours     int    // سقف مطلق نشست — پورت SESSION_MAX_HOURS
}

// ConfigFromEnv پیکربندی را از ENV می‌خواند — نام متغیرها عیناً afagh-next.
func ConfigFromEnv() Config {
	return Config{
		Production:          strings.TrimSpace(os.Getenv("NODE_ENV")) == "production",
		PublicBaseURL:       os.Getenv("AFAGH_PUBLIC_BASE_URL"),
		CookieSecure:        os.Getenv("AFAGH_COOKIE_SECURE"),
		CookieSameSite:      os.Getenv("AFAGH_COOKIE_SAMESITE"),
		SessionCookiePrefix: strings.ToLower(strings.TrimSpace(os.Getenv("AFAGH_SESSION_COOKIE_PREFIX"))),
		SessionMaxHours:     sessionMaxHours(os.Getenv("AFAGH_SESSION_MAX_HOURS")),
	}
}

// Service همهٔ منطق احراز هویت روی استخر مالک اسکیما — تنها محل ساخت sessions.
type Service struct {
	Pool   *pgxpool.Pool
	Store  *session.Store
	Cfg    Config
	Rate   RateLimiter
	Signer TokenSigner
	Locks  LockClearer
}

// NewService سرویس می‌سازد؛ Store نشست مشترک فاز ۰ از همان استخر ساخته می‌شود
// تا dual-read کوکی و جدول sessions بین دو سرویس یکسان بماند.
func NewService(pool *pgxpool.Pool, cfg Config, rate RateLimiter, signer TokenSigner, locks LockClearer) *Service {
	return &Service{
		Pool:   pool,
		Store:  session.NewStore(pool),
		Cfg:    cfg,
		Rate:   rate,
		Signer: signer,
		Locks:  locks,
	}
}

// allowRate بررسی سقف نرخ. سیاست خطا (تفاوت ساختاری با TS): پیاده‌سازی TS هرگز
// خطا به بیرون نمی‌دهد (fallback درون‌حافظه دارد)؛ اگر با وجود fallback هم خطا
// داد، ورود را نمی‌بندیم (fail-open) و فقط لاگ می‌کنیم — قفل‌شدن کل سامانه به
// خاطر لیمیتِ خراب، خطرناک‌تر از عبور موقت سقف است. (در گزارش پورت ذکر شده.)
func (s *Service) allowRate(ctx context.Context, key string, limit, windowSec int) bool {
	if s.Rate == nil {
		return true
	}
	allowed, _, err := s.Rate.Allow(ctx, key, limit, windowSec)
	if err != nil {
		loggerFor().Error("rate_limit_error", map[string]any{"key": key, "error": err.Error()})
		return true
	}
	return allowed
}

// countRate شمارش فعلی کلید (برای تأخیر تصاعدی) — خطا ⇒ ۰ (همان .catch(() => 0)).
func (s *Service) countRate(ctx context.Context, key string) int {
	if s.Rate == nil {
		return 0
	}
	n, err := s.Rate.Count(ctx, key)
	if err != nil {
		return 0
	}
	return n
}

// releaseRate آزادسازی رزرو (برگرداندن شمارش) — خطا نادیده گرفته می‌شود،
// همان releaseRateLimit در TS که خودش fallback داخلی دارد.
func (s *Service) releaseRate(ctx context.Context, keys ...string) {
	if s.Rate == nil {
		return
	}
	for _, k := range keys {
		_ = s.Rate.Release(ctx, k)
	}
}

// clearLock پاک‌کردن قفل بیکاری — خطا همیشه نادیده گرفته می‌شود
// (همان clearSessionLock(userId).catch(() => {}) در auth.ts).
func (s *Service) clearLock(ctx context.Context, userID int64) {
	if s.Locks == nil {
		return
	}
	_ = s.Locks.ClearLock(ctx, userID)
}
