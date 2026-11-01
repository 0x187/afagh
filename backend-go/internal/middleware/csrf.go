// ═══ CSRF defense — faithful port of src/lib/security.ts (assertSameOrigin) ═══
//
// Rules (Django/OWASP pattern — same documentation in security.ts):
//
//  1. Origin present ⇒ must be the request host or in the ALLOWED_EXTRA_ORIGINS allowlist
//  2. no Origin but Referer present ⇒ Referer must be same-origin
//  3. neither ⇒ non-browser client (curl/cron); CSRF without Origin/Referer
//     is not possible in a browser ⇒ allowed (with a log if mutating and authenticated)
//
// only the host is compared (not the scheme) so it works behind a Caddy proxy.
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

// AssertSameOrigin ports assertSameOrigin: if it writes a response ⇒ that same one must be returned;
// true means allowed.
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

	// Observability-only: non-browser clients are allowed, but an authenticated mutating
	// request without Origin/Referer is logged (same behavior as security.ts).
	switch strings.ToUpper(r.Method) {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		if r.Header.Get("Authorization") != "" || len(r.Cookies()) > 0 {
			csrfLog.Warn("csrf_no_origin_mutating", logger.Fields{"path": r.URL.Path, "method": r.Method})
		}
	}
	return true
}
