// ═══ Strangler routing edge ═══
//
// The Go service becomes the traffic entry point (Caddy → Go):
//   - owned routes (AFAGH_OWNED_PREFIXES prefixes: default /api/v2 and /app)
//     → /api/* prefix: the service's own API (gin) + security headers + CSRF
//     → the rest         : SPA — proxy to AFAGH_SPA_UPSTREAM (dev/Vite) or
//     AFAGH_SPA_DIST files with fallback to index.html
//   - anything else → proxy to Next.js (AFAGH_NEXT_UPSTREAM) preserving Host
//
// Switching each module in production = adding a prefix to AFAGH_OWNED_PREFIXES
// with no Caddy change and no downtime.
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

// IsOwned returns the longest owned prefix of the path.
// Matching is strict: the path must be exactly the prefix or prefix+"/"
// (that is, "/app" never matches "/appp").
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

// IsAPIPath reports whether the path is under the owned API prefix.
func IsAPIPath(owned []string, p string) bool {
	prefix, ok := IsOwned(owned, p)
	return ok && strings.HasPrefix(prefix, "/api/")
}

// Root builds the full root handler (routing + security headers + CSRF + logging).
func Root(owned []string, api http.Handler, spa http.Handler, spaDist string, nextUpstream *url.URL, extraOrigins []string) http.Handler {
	next := &httputil.ReverseProxy{Rewrite: func(req *httputil.ProxyRequest) {
		req.SetURL(nextUpstream)
		req.Out.Host = nextUpstream.Host
	}}

	// For each SPA prefix, the appropriate handler is built (proxy or static).
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
			// CSRF before any write response — port of assertCsrf
			if !middleware.AssertSameOrigin(w, req, extraOrigins) {
				return
			}
			// The API prefix is stripped so gin handlers are independent of the mount point
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

// assetExts real asset extensions; other paths (even with a dot — such as a token)
// fall through to index.html so the SPA's internal router handles them.
var assetExts = map[string]bool{
	".js": true, ".mjs": true, ".css": true, ".map": true, ".json": true,
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".svg": true, ".webp": true, ".ico": true,
	".woff": true, ".woff2": true, ".ttf": true, ".otf": true, ".txt": true, ".webmanifest": true,
	".wasm": true,
}

// spaStaticHandler serves dist files under "prefix"; every path without
// an extension (a client route like /app/student/enroll) falls through to index.html so the
// SPA's internal router handles it; a missing asset returns a real 404.
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
		// Client routes that have a "dot" (such as the token T1.<b64>.<sig>) also get index
		index.ServeHTTP(w, r)
	})
}
