// ═══ لبهٔ مسیریابی strangler ═══
//
// سرویس Go نقطهٔ ورود ترافیک می‌شود (Caddy → Go):
//   - مسیرهای مالک‌شده (پیشوند AFAGH_OWNED_PREFIXES: پیش‌فرض /api/v2 و /app)
//     → پیشوند /api/* : API خود سرویس (gin) + هدرهای امنیتی + CSRF
//     → بقیه          : SPA — پروکسی به AFAGH_SPA_UPSTREAM (dev/Vite) یا
//     فایل‌های AFAGH_SPA_DIST با fallback به index.html
//   - هر چیز دیگر → پروکسی به Next.js (AFAGH_NEXT_UPSTREAM) با حفظ Host
//
// سوییچ هر ماژول در پروداکشن = افزودن یک پیشوند به AFAGH_OWNED_PREFIXES
// بدون تغییر Caddy و بدون داون‌تایم.
package edge

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"backend-go/internal/middleware"
)

// IsOwned طولانی‌ترین پیشوند مالک‌شدهٔ مسیر را برمی‌گرداند.
// تطبیق سخت‌گیرانه است: مسیر باید دقیقاً پیشوند یا پیشوند+«/» باشد
// (یعنی «/app» هرگز «/appp» را نمی‌گیرد).
func IsOwned(owned []string, p string) (string, bool) {
	best := ""
	found := false
	for _, prefix := range owned {
		if p == prefix || strings.HasPrefix(p, prefix+"/") {
			if len(prefix) > len(best) {
				best = prefix
				found = true
			}
		}
	}
	return best, found
}

// IsAPIPath آیا مسیر زیر پیشوند API مالک‌شده است؟
func IsAPIPath(owned []string, p string) bool {
	prefix, ok := IsOwned(owned, p)
	return ok && strings.HasPrefix(prefix, "/api/")
}

// Root هندلر ریشهٔ کامل را می‌سازد (مسیریابی + هدرهای امنیتی + CSRF + لاگ).
func Root(owned []string, api http.Handler, spa http.Handler, spaDist string, nextUpstream *url.URL, extraOrigins []string) http.Handler {
	next := httputil.NewSingleHostReverseProxy(nextUpstream)
	// Host اصلی حفظ شود تا Next مسیرهای نسبی/کوکی‌ها را درست ببیند
	origDirector := next.Director
	next.Director = func(req *http.Request) {
		origDirector(req)
		req.Host = nextUpstream.Host
	}

	// برای هر پیشوند SPA، هندلر مناسب ساخته می‌شود (پروکسی یا استاتیک).
	spaByPrefix := map[string]http.Handler{}
	for _, prefix := range owned {
		if strings.HasPrefix(prefix, "/api/") {
			continue
		}
		switch {
		case spa != nil:
			spaByPrefix[prefix] = spa
		case spaDist != "":
			spaByPrefix[prefix] = spaStaticHandler(prefix, spaDist)
		}
	}

	return middleware.AccessLog(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		prefix, ok := IsOwned(owned, req.URL.Path)
		if !ok {
			next.ServeHTTP(w, req)
			return
		}
		if strings.HasPrefix(prefix, "/api/") {
			// CSRF پیش از هر نوشتن پاسخ — پورت assertCsrf
			if !middleware.AssertSameOrigin(w, req, extraOrigins) {
				return
			}
			// پیشوند API حذف می‌شود تا هندلرهای gin مستقل از محل نصب باشند
			middleware.SecurityHeaders(http.StripPrefix(prefix, api)).ServeHTTP(w, req)
			return
		}
		handler, hasSPA := spaByPrefix[prefix]
		switch {
		case hasSPA:
			middleware.SecurityHeaders(handler).ServeHTTP(w, req)
		default:
			http.Error(w, "SPA پیکربندی نشده است (AFAGH_SPA_DIST یا AFAGH_SPA_UPSTREAM)", http.StatusNotImplemented)
		}
	}))
}

// assetExts پسوندهای دارایی واقعی؛ مسیرهای دیگر (حتی با نقطه — مثل توکن)
// به index.html می‌افتند تا router داخلی SPA آن را بگیرد.
var assetExts = map[string]bool{
	".js": true, ".mjs": true, ".css": true, ".map": true, ".json": true,
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".svg": true, ".webp": true, ".ico": true,
	".woff": true, ".woff2": true, ".ttf": true, ".otf": true, ".txt": true, ".webmanifest": true,
	".wasm": true,
}

// spaStaticHandler فایل‌های dist را زیر «prefix» سرو می‌کند؛ هر مسیر بدون
// پسوند (مسیر کلاینتی مثل /app/student/enroll) به index.html می‌افتد تا
// router داخلی SPA آن را بگیرد؛ دارایی گمشده 404 واقعی می‌دهد.
func spaStaticHandler(prefix, dist string) http.Handler {
	files := http.StripPrefix(prefix, http.FileServer(http.Dir(dist)))
	index := http.StripPrefix(prefix, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(dist, "index.html"))
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel := strings.TrimPrefix(strings.TrimPrefix(path.Clean(r.URL.Path), prefix), "/")
		if rel == "" || strings.HasSuffix(r.URL.Path, "/") {
			index.ServeHTTP(w, r)
			return
		}
		if assetExts[strings.ToLower(path.Ext(rel))] {
			if st, err := os.Stat(filepath.Join(dist, rel)); err == nil && !st.IsDir() {
				files.ServeHTTP(w, r)
				return
			}
			http.NotFound(w, r)
			return
		}
		// مسیرهای کلاینتی که «نقطه» دارند (مثل توکن T1.<b64>.<sig>) هم index می‌گیرند
		index.ServeHTTP(w, r)
	})
}
