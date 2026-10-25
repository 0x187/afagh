// ═══ هدرهای امنیتی — پورت وفادار از next.config.mjs (بخش headers) ═══
//
// فقط روی مسیرهای «مالک» (API v2 + SPA) اعمال می‌شود؛ پاسخ‌های پروکسی‌شده به
// Next.js هدر خودشان را دارند و تکرار CSP می‌تواند مرورگر را بشکند.
// توجه: frame-ancestors / X-Frame-Options عمداً نیست (سامانه در دامنهٔ واسط
// داخل iframe استفاده می‌شود — همان تصمیم مستند در next.config.mjs).
package middleware

import "net/http"

// SecurityHeaders هدرهای پایهٔ امنیتی روی پاسخ‌های مالک‌شده می‌گذارد.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("X-Permitted-Cross-Domain-Policies", "none")
		h.Set("Permissions-Policy", "geolocation=(), microphone=(self), camera=(self), payment=()")
		// CSP حداقلی و بی‌خطر — همان مقدار next.config.mjs
		h.Set("Content-Security-Policy", "object-src 'none'; base-uri 'self'")
		h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		next.ServeHTTP(w, r)
	})
}

// NoStore هدرهای کش‌گریز برای مسیرهای حساس (الگوی verifyPaths در next.config.mjs).
func NoStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, max-age=0, must-revalidate")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
}
