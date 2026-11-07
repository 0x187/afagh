package edge

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

const tagAPI = "API"
const tagSPA = "SPA"
const tagNext = "NEXT"

func handler(tag string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(tag))
	})
}

// TestRootDispatch isolates the edge routing with a fake Next server
// (it never connects to the host's real port 8080).
func TestRootDispatch(t *testing.T) {
	nextSrv := httptest.NewServer(handler(tagNext))
	defer nextSrv.Close()
	nextURL, err := url.Parse(nextSrv.URL)
	if err != nil {
		t.Fatal(err)
	}
	h := Root([]string{"/api/v2", "/app"}, handler(tagAPI), handler(tagSPA), "", nextURL, nil)

	cases := []struct{ path, want string }{
		{"/api/v2/health", tagAPI},
		{"/api/v2/session", tagAPI},
		{"/app/", tagSPA},
		{"/app/student/enroll", tagSPA},
		{"/login", tagNext},
		{"/student", tagNext},
		{"/api/health", tagNext}, // the old health still belongs to Next
		{"/", tagNext},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x"+tc.path, nil))
			if w.Body.String() != tc.want {
				t.Fatalf("مسیر %s → %q، انتظار %q", tc.path, w.Body.String(), tc.want)
			}
		})
	}
}

func TestSPAFallback(t *testing.T) {
	dir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(dir, "assets"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "index.html"), []byte("INDEX"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("JS"), 0o644)

	nextSrv := httptest.NewServer(handler(tagNext))
	defer nextSrv.Close()
	nextURL, _ := url.Parse(nextSrv.URL)
	h := Root([]string{"/app"}, nil, nil, dir, nextURL, nil)

	// client route → index.html
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/app/student/enroll", nil))
	if w.Body.String() != "INDEX" {
		t.Fatalf("مسیر کلاینتی باید index.html بدهد، داد: %q", w.Body.String())
	}
	// existing asset
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/app/assets/app.js", nil))
	if w.Body.String() != "JS" {
		t.Fatalf("دارایی موجود باید سرو شود، داد: %q", w.Body.String())
	}
	// missing asset → real 404, not index.html
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/app/assets/missing.js", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("دارایی گمشده باید 404 بدهد، داد %d", w.Code)
	}
	// SPA root
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/app", nil))
	if w.Body.String() != "INDEX" {
		t.Fatalf("ریشهٔ /app باید index.html بدهد، داد: %q", w.Body.String())
	}
}

// TestGoOnlyNoUpstream — with a nil Next upstream (post-retirement mode),
// non-owned paths fall back to the static SPA instead of proxying.
func TestGoOnlyNoUpstream(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "index.html"), []byte("INDEX"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "verify.js"), []byte("JS"), 0o644)

	h := Root([]string{"/api/v2", "/app"}, handler(tagAPI), nil, dir, nil, nil)

	// public client route at the root → index.html
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/verify-enrollment", nil))
	if w.Body.String() != "INDEX" {
		t.Fatalf("در حالت Go-only مسیر عمومی باید index.html بدهد، داد: %q", w.Body.String())
	}
	// root asset served from dist
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/verify.js", nil))
	if w.Body.String() != "JS" {
		t.Fatalf("دارایی ریشه باید سرو شود، داد: %q", w.Body.String())
	}
	// missing root asset → 404
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/missing.js", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("دارایی گمشده باید 404 بدهد، داد %d", w.Code)
	}
	// owned prefixes keep working
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/api/v2/health", nil))
	if w.Body.String() != tagAPI {
		t.Fatalf("API مالک‌شده دست‌نخورده باید بماند، داد: %q", w.Body.String())
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/app/", nil))
	if w.Body.String() != "INDEX" {
		t.Fatalf("/app باید SPA باشد، داد: %q", w.Body.String())
	}
}

func TestIsAPIPath(t *testing.T) {
	owned := []string{"/api/v2", "/app"}
	if !IsAPIPath(owned, "/api/v2/session") {
		t.Fatal("/api/v2/session باید API باشد")
	}
	if IsAPIPath(owned, "/app/x") {
		t.Fatal("/app/x نباید API باشد")
	}
	if _, ok := IsOwned(owned, "/app/student"); !ok {
		t.Fatal("/app/student مالک‌شده است")
	}
}
