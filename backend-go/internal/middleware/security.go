// ═══ security headers — faithful port of next.config.mjs (headers section) ═══
//
// applied only to "owner" routes (API v2 + SPA); responses proxied to
// Next.js have their own headers and duplicating CSP can break the browser.
// Note: frame-ancestors / X-Frame-Options are deliberately absent (the system runs on the intermediary domain
// inside an iframe — the same documented decision in next.config.mjs).
package middleware

import "net/http"

// SecurityHeaders sets the basic security headers on owned responses.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("X-Permitted-Cross-Domain-Policies", "none")
		h.Set("Permissions-Policy", "geolocation=(), microphone=(self), camera=(self), payment=()")
		// minimal, safe CSP — the same value as next.config.mjs
		h.Set("Content-Security-Policy", "object-src 'none'; base-uri 'self'")
		h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		next.ServeHTTP(w, r)
	})
}

// NoStore adds no-cache headers for sensitive routes (verifyPaths pattern in next.config.mjs).
func NoStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, max-age=0, must-revalidate")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
}
