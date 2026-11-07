// Legacy /uploads serving — the Next.js app exposed uploaded files (login
// showcase images, photos) as static files under /uploads. When
// AFAGH_UPLOADS_DIST points at the uploads directory, those URLs keep working
// in front of the Go edge; otherwise /uploads falls through to normal routing.
package app

import (
	"net/http"
	"strings"

	"backend-go/internal/middleware"
)

// withUploads mounts a read-only static file handler for /uploads/* in front
// of the root handler. Directory listing is disabled (any directory path gets
// a plain 404) and security headers wrap every response.
func withUploads(root http.Handler, dist string) http.Handler {
	files := http.StripPrefix("/uploads", http.FileServer(http.Dir(dist)))
	denyList := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "" || strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
	mux := http.NewServeMux()
	mux.Handle("/uploads/", middleware.SecurityHeaders(denyList))
	mux.Handle("/", root)
	return mux
}
