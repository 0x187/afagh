// ═══ دفاع CSRF — پورت وفادار از src/lib/security.ts (assertSameOrigin) ═══
//
// قواعد (الگوی Django/OWASP — همان مستند در security.ts):
//
//	۱) Origin موجود ⇒ باید host درخواست باشد یا در لیست سفید ALLOWED_EXTRA_ORIGINS
//	۲) بدون Origin اما با Referer ⇒ Referer باید هم‌مبدأ باشد
//	۳) هیچ‌کدام ⇒ کلاینت غیرمرورگری (curl/cron)؛ CSRF بدون Origin/Referer
//	   در مرورگر ممکن نیست ⇒ مجاز (با لاگ اگر mutating و احرازشده)
//
// فقط host مقایسه می‌شود (نه scheme) تا پشت پروکسی Caddy کار کند.
package middleware

import (
	"net/http"
	"net/url"
	"strings"

	"backend-go/internal/logger"
)

var csrfLog = logger.For("security")

func hostOf(urlOrHost string) string {
	if u, err := url.Parse(urlOrHost); err == nil && u.Host != "" {
		return u.Host
	}
	return urlOrHost
}

func originAllowed(originHeader, host string, extra []string) bool {
	originHost := hostOf(originHeader)
	if originHost == host {
		return true
	}
	for _, o := range extra {
		if o == originHeader {
			return true
		}
	}
	return false
}

// AssertSameOrigin پورت assertSameOrigin: اگر پاسخ بنویسد ⇒ همان باید برگردد؛
// true یعنی مجاز.
func AssertSameOrigin(w http.ResponseWriter, r *http.Request, extraOrigins []string) bool {
	host := r.Host
	if host == "" {
		host = hostOf("http://" + r.URL.Host)
	}

	if origin := r.Header.Get("Origin"); origin != "" {
		if !originAllowed(origin, host, extraOrigins) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"منشأ درخواست با سامانه هم‌خوان نیست (CSRF blocked)."}`))
			return false
		}
		return true
	}

	if referer := r.Header.Get("Referer"); referer != "" {
		refHost := hostOf(referer)
		ok := refHost == host
		if !ok {
			for _, o := range extraOrigins {
				if hostOf(o) == refHost {
					ok = true
					break
				}
			}
		}
		if !ok {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"منشأ درخواست با سامانه هم‌خوان نیست (CSRF blocked)."}`))
			return false
		}
		return true
	}

	// Observability-only: کلاینت غیرمرورگری مجاز است ولی mutating احرازشدهٔ
	// بدون Origin/Referer لاگ می‌شود (همان رفتار security.ts).
	switch strings.ToUpper(r.Method) {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		if r.Header.Get("Authorization") != "" || len(r.Cookies()) > 0 {
			csrfLog.Warn("csrf_no_origin_mutating", logger.Fields{"path": r.URL.Path, "method": r.Method})
		}
	}
	return true
}
