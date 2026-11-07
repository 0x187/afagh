// ═══ Session cookie transport — line-by-line port of sessionTransport from proxy-trust.ts ═══
//
// ────────────────────────────────────────────────────────────────────────
//
//	Session cookie transport decision matrix (single source of truth)
//
// ────────────────────────────────────────────────────────────────────────
//
//	The decision comes only from ENV, never from request headers (Host /
//	X-Forwarded-Proto / X-Forwarded-For / ...). Reason: if headers were the basis, a
//	misconfigured proxy or an attacker could "downgrade" the cookie to an insecure channel.
//
//	1) Secure:
//	   • AFAGH_COOKIE_SECURE=false  → false  — an explicit operator decision,
//	     honored in every environment (parity with afagh-next: the production
//	     Next.js deployment runs plain HTTP with this exact value; a warning
//	     is logged once so the choice stays visible).
//	   • AFAGH_COOKIE_SECURE=true   → true
//	   • unset / auto / invalid:
//	       NODE_ENV=production → true (fail-closed: never ship the session
//	       cookie over production HTTP by accident)
//	       otherwise → if AFAGH_PUBLIC_BASE_URL has https:// then true,
//	       otherwise false.
//
//	2) SameSite:
//	       AFAGH_COOKIE_SAMESITE=none   → none  (only if Secure=true)
//	       AFAGH_COOKIE_SAMESITE=strict → strict
//	       lax / auto / empty / invalid → lax  (secure default)
//
//	3) Mandatory rule "none + insecure is forbidden": SameSite=None combined with Secure=false
//	   is rejected and reverted to Lax (fail-safe), and a warning is logged.
//
//	4) iframe cost (explicit opt-in): SameSite=None is only for cross-site embedding
//	   and CSRF protection must come from another layer (in Go: middleware.AssertSameOrigin
//	   on /api prefixes at the edge).
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

// sessionMaxHours is a port of SESSION_MAX_HOURS: default 4; only finite values in
// the range [1,24] are accepted (floor rounding). Empty/NaN/out of range ⇒ 4.
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

// transportEnv is the matrix's pure input — built from Config to be testable.
type transportEnv struct {
	NodeEnv, PublicBaseURL, CookieSecure, CookieSameSite string
}

// Warnings are printed only once so logs are not flooded on every request (same
// warned* flags in proxy-trust.ts).
var (
	warnInsecureNoneOnce         sync.Once
	warnCrossSiteNoneOnce        sync.Once
	warnProductionSecureOverOnce sync.Once
)

// sessionTransport is the decision matrix — output (secure, sameSite) with values
// "lax" | "none" | "strict".
func sessionTransport(env transportEnv) (secure bool, sameSite string) {
	https := env.NodeEnv == "production"
	// equivalent to new URL(...): only the http/https scheme can change the default;
	// an empty/invalid URL ⇒ catch in TS ⇒ the default stays untouched.
	if u, err := url.Parse(env.PublicBaseURL); err == nil &&
		(u.Scheme == "https" || u.Scheme == "http") {
		https = u.Scheme == "https"
	}

	production := env.NodeEnv == "production"
	secureMode := "auto"
	if v := strings.TrimSpace(env.CookieSecure); v != "" {
		// strconv.ParseBool accepts true/false and 1/0 (and t/f variants) so both
		// spellings used across compose files behave identically; invalid → auto.
		if b, err := strconv.ParseBool(v); err == nil {
			if b {
				secureMode = "true"
			} else {
				secureMode = "false"
			}
		}
	}
	// Explicit operator decisions win; only an UNSET value leans fail-closed
	// in production (parity: the reference production app runs plain HTTP
	// with AFAGH_COOKIE_SECURE=false).
	switch {
	case secureMode == "true":
		secure = true
	case secureMode == "false":
		secure = false
		if production {
			warnProductionSecureOverOnce.Do(func() {
				loggerFor().Warn("⚠ [cookie] AFAGH_COOKIE_SECURE=false در production — کوکی سشن بدون Secure (تصمیم آگاهانهٔ اپراتور برای استقرار HTTP).", nil)
			})
		}
	case production:
		secure = true
	default: // auto / empty / invalid in non-production
		secure = https
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

	// We do not accept "none + insecure": the browser rejects it, and if it did not, the cookie would leak.
	if sameSite == "none" && !secure {
		warnInsecureNoneOnce.Do(func() {
			loggerFor().Warn("⛔ [cookie] AFAGH_COOKIE_SAMESITE=none بدون Secure رد شد؛ به Lax برگشت. برای iframe باید HTTPS و AFAGH_COOKIE_SECURE=true باشد.", nil)
		})
		sameSite = "lax"
	}

	// SameSite=None is an explicit security decision, not a default; we remind once.
	if sameSite == "none" {
		warnCrossSiteNoneOnce.Do(func() {
			loggerFor().Warn("⚠ [cookie] SameSite=None فعال است (opt-in برای جاسازی cross-site)؛ محافظت CSRF از طریق assertCsrf / assertServerActionOrigin الزامی است.", nil)
		})
	}

	return secure, sameSite
}

// cookieOpts holds the final session cookie options — port of sessionCookieOptions.
type cookieOpts struct {
	Secure   bool
	SameSite string // lax | none | strict
	MaxAge   int    // seconds
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

// goSameSite converts the matrix string to the net/http constant.
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

// hostPrefixEnabled gates migration to the __Host- cookie name — same as hostSessionCookieEnabled
// (gates on the exact value «host», case-insensitive; off by default).
func hostPrefixEnabled(cfg Config) bool {
	return cfg.SessionCookiePrefix == "host"
}

// newSessionCookie builds the session cookie: httpOnly, Path=/, no Domain (host-only),
// MaxAge is the absolute limit — secure/sameSite only from the matrix above.
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

// writeSessionCookie is a port of writeSessionCookie — DUAL-WRITE (on the response writer
// of gin in handlers):
//   - the new name (__Host-afagh_session) only when the gate is on and transport is Secure;
//     the browser rejects a __Host- cookie without Secure.
//   - the old name (token) is always written so the edge/proxy and previous-generation
//     readers do not break (proxy.ts reads only token).
func (s *Service) writeSessionCookie(w http.ResponseWriter, token string) {
	opts := s.Cfg.cookieOpts()
	if hostPrefixEnabled(s.Cfg) && opts.Secure {
		// path='/' and the absence of domain come from newSessionCookie — the __Host- requirement
		http.SetCookie(w, newSessionCookie(session.CookieNameHost, token, opts))
	}
	http.SetCookie(w, newSessionCookie(session.CookieName, token, opts))
}

// clearSessionCookies is a port of clearSessionCookies — clears both session cookie names
// (old + new) with Path=/ and MaxAge=0 (in net/http: negative MaxAge ⇒ «Max-Age=0»).
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
