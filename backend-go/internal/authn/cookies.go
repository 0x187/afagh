// ═══ انتقال کوکی نشست — پورت خط‌به‌خط sessionTransport از proxy-trust.ts ═══
//
// ────────────────────────────────────────────────────────────────────────
//
//	ماتریس تصمیم انتقال کوکی نشست (منبع واحد حقیقت)
//
// ────────────────────────────────────────────────────────────────────────
//
//	تصمیم فقط از ENV گرفته می‌شود، هرگز از هدرهای درخواست (Host /
//	X-Forwarded-Proto / X-Forwarded-For / ...). دلیل: اگر هدر مبنا باشد، یک
//	پروکسی نادرست یا مهاجم می‌تواند کوکی را به کانال ناامن «تنزل» بدهد.
//
//	۱) Secure:
//	   • NODE_ENV=production  → همیشه true. مقدار AFAGH_COOKIE_SECURE=false
//	     در production نادیده گرفته می‌شود (یک‌بار هشدار لاگ می‌شود) تا
//	     کوکی نشست هرگز روی HTTP تولید ارسال نشود.
//	   • غیر production:
//	       AFAGH_COOKIE_SECURE=true   → true
//	       AFAGH_COOKIE_SECURE=false  → false  (فقط برای HTTP محلی)
//	       auto / خالی / نامعتبر      → اگر AFAGH_PUBLIC_BASE_URL با https://
//	                                    باشد true، وگرنه false.
//	     URL نامعتبر/خالی در production به «امن» میل می‌کند، نه به «ناامن».
//
//	۲) SameSite:
//	       AFAGH_COOKIE_SAMESITE=none   → none  (فقط اگر Secure=true)
//	       AFAGH_COOKIE_SAMESITE=strict → strict
//	       lax / auto / خالی / نامعتبر → lax  (پیش‌فرض امن)
//
//	۳) قاعدهٔ اجباری «none + ناامن ممنوع»: ترکیب SameSite=None با Secure=false
//	   «رد» و به Lax برگردانده می‌شود (fail-safe) و هشدار لاگ می‌گیرد.
//
//	۴) هزینهٔ iframe (opt-in صریح): SameSite=None فقط برای جاسازی cross-site
//	   است؛ محافظت CSRF باید از لایهٔ دیگر بیاید (در Go: middleware.AssertSameOrigin
//	   روی پیشوندهای /api در edge).
//
// ────────────────────────────────────────────────────────────────────────
package authn

import (
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"backend-go/internal/session"
)

// sessionMaxHours پورت SESSION_MAX_HOURS: پیش‌فرض ۴؛ فقط مقادیر متناهی در
// بازهٔ [1,24] پذیرفته می‌شوند (کف به پایین). خالی/NaN/خارج از بازه ⇒ ۴.
func sessionMaxHours(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 4
	}
	f, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || f < 1 || f > 24 {
		return 4
	}
	return int(math.Floor(f))
}

// transportEnv ورودی خالص ماتریس — از Config ساخته می‌شود تا تست‌پذیر باشد.
type transportEnv struct {
	NodeEnv, PublicBaseURL, CookieSecure, CookieSameSite string
}

// هشدارها فقط یک‌بار چاپ می‌شوند تا لاگ در هر درخواست پر نشود (همان فلگ‌های
// warned* در proxy-trust.ts).
var (
	warnInsecureNoneOnce         sync.Once
	warnCrossSiteNoneOnce        sync.Once
	warnProductionSecureOverOnce sync.Once
)

// sessionTransport ماتریس تصمیم — خروجی (secure, sameSite) با مقادیر
// "lax" | "none" | "strict".
func sessionTransport(env transportEnv) (secure bool, sameSite string) {
	https := env.NodeEnv == "production"
	// معادل new URL(...): فقط اسکیمای http/https می‌تواند پیش‌فرض را عوض کند؛
	// URL خالی/نامعتبر ⇒ catch در TS ⇒ پیش‌فرض دست‌نخورده می‌ماند.
	if u, err := url.Parse(env.PublicBaseURL); err == nil &&
		(u.Scheme == "https" || u.Scheme == "http") {
		https = u.Scheme == "https"
	}

	production := env.NodeEnv == "production"
	secureMode := "auto"
	if env.CookieSecure != "" {
		secureMode = strings.ToLower(env.CookieSecure)
	}
	// در production هیچ ENVای نمی‌تواند Secure را خاموش کند (fail-closed).
	switch {
	case production:
		secure = true
	case secureMode == "true":
		secure = true
	case secureMode == "false":
		secure = false
	default: // auto / خالی / نامعتبر
		secure = https
	}

	if production && secureMode == "false" {
		warnProductionSecureOverOnce.Do(func() {
			loggerFor().Warn("⚠ [cookie] AFAGH_COOKIE_SECURE=false در production نادیده گرفته شد؛ Secure اجباری است.", nil)
		})
	}

	mode := "auto"
	if env.CookieSameSite != "" {
		mode = strings.ToLower(env.CookieSameSite)
	}
	sameSite = "lax"
	switch mode {
	case "none":
		sameSite = "none"
	case "strict":
		sameSite = "strict"
	}

	// «none + ناامن» را نمی‌پذیریم: مرورگر رد می‌کند و اگر نپذیرد، کوکی لو می‌رود.
	if sameSite == "none" && !secure {
		warnInsecureNoneOnce.Do(func() {
			loggerFor().Warn("⛔ [cookie] AFAGH_COOKIE_SAMESITE=none بدون Secure رد شد؛ به Lax برگشت. برای iframe باید HTTPS و AFAGH_COOKIE_SECURE=true باشد.", nil)
		})
		sameSite = "lax"
	}

	// SameSite=None یک تصمیم صریح امنیتی است، نه پیش‌فرض؛ یک‌بار یادآوری می‌کنیم.
	if sameSite == "none" {
		warnCrossSiteNoneOnce.Do(func() {
			loggerFor().Warn("⚠ [cookie] SameSite=None فعال است (opt-in برای جاسازی cross-site)؛ محافظت CSRF از طریق assertCsrf / assertServerActionOrigin الزامی است.", nil)
		})
	}

	return secure, sameSite
}

// cookieOpts گزینه‌های نهایی کوکی نشست — پورت sessionCookieOptions.
type cookieOpts struct {
	Secure   bool
	SameSite string // lax | none | strict
	MaxAge   int    // ثانیه
}

func (c Config) cookieOpts() cookieOpts {
	secure, sameSite := sessionTransport(transportEnv{
		NodeEnv:        map[bool]string{true: "production", false: "development"}[c.Production],
		PublicBaseURL:  c.PublicBaseURL,
		CookieSecure:   c.CookieSecure,
		CookieSameSite: c.CookieSameSite,
	})
	return cookieOpts{Secure: secure, SameSite: sameSite, MaxAge: c.SessionMaxHours * 3600}
}

// goSameSite تبدیل رشتهٔ ماتریس به ثابت net/http.
func goSameSite(s string) http.SameSite {
	switch s {
	case "none":
		return http.SameSiteNoneMode
	case "strict":
		return http.SameSiteStrictMode
	default:
		return http.SameSiteLaxMode
	}
}

// hostPrefixEnabled گیت مهاجرت به نام کوکی __Host- — همان hostSessionCookieEnabled
// (گیت روی مقدار دقیق «host» بی‌توجه به بزرگی/کوچکی حرف؛ پیش‌فرض خاموش).
func hostPrefixEnabled(cfg Config) bool {
	return cfg.SessionCookiePrefix == "host"
}

// newSessionCookie کوکی نشست: httpOnly، Path=/، بدون Domain (host-only)،
// MaxAge سقف مطلق — secure/sameSite فقط از ماتریس بالا.
func newSessionCookie(name, value string, opts cookieOpts) *http.Cookie {
	return &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		MaxAge:   opts.MaxAge,
		HttpOnly: true,
		Secure:   opts.Secure,
		SameSite: goSameSite(opts.SameSite),
	}
}

// writeSessionCookie پورت writeSessionCookie — DUAL-WRITE (روی نویسندهٔ پاسخ
// gin در هندلرها):
//   - نام جدید (__Host-afagh_session) فقط وقتی گیت روشن و انتقال Secure باشد؛
//     مرورگر کوکی __Host- بدون Secure را رد می‌کند.
//   - نام قدیمی (token) همیشه نوشته می‌شود تا لبه/پروکسی و خواننده‌های نسل
//     قبل نشکنند (proxy.ts فقط token را می‌خواند).
func (s *Service) writeSessionCookie(w http.ResponseWriter, token string) {
	opts := s.Cfg.cookieOpts()
	if hostPrefixEnabled(s.Cfg) && opts.Secure {
		// path='/' و نبودِ domain از newSessionCookie تأمین می‌شود — الزام __Host-
		http.SetCookie(w, newSessionCookie(session.CookieNameHost, token, opts))
	}
	http.SetCookie(w, newSessionCookie(session.CookieName, token, opts))
}

// clearSessionCookies پورت clearSessionCookies — حذف هر دو نام کوکی نشست
// (قدیمی + جدید) با Path=/ و MaxAge=0 (در net/http: MaxAge منفی ⇒ «Max-Age=0»).
func (s *Service) clearSessionCookies(w http.ResponseWriter) {
	opts := s.Cfg.cookieOpts()
	for _, name := range []string{session.CookieNameHost, session.CookieName} {
		ck := &http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: true,
			Secure:   opts.Secure,
			SameSite: goSameSite(opts.SameSite),
		}
		http.SetCookie(w, ck)
	}
}
