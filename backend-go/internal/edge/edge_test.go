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

// TestRootDispatch مسیریابی لبه را با سرور Next جعلی ایزوله می‌کند
// (هرگز به پورت واقعی ۸۰۸۰ میزبان وصل نمی‌شود).
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
		{"/api/health", tagNext}, // health قدیمی هنوز مال Next است
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

	// مسیر کلاینتی → index.html
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/app/student/enroll", nil))
	if w.Body.String() != "INDEX" {
		t.Fatalf("مسیر کلاینتی باید index.html بدهد، داد: %q", w.Body.String())
	}
	// دارایی موجود
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/app/assets/app.js", nil))
	if w.Body.String() != "JS" {
		t.Fatalf("دارایی موجود باید سرو شود، داد: %q", w.Body.String())
	}
	// دارایی گمشده → 404 واقعی نه index.html
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/app/assets/missing.js", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("دارایی گمشده باید 404 بدهد، داد %d", w.Code)
	}
	// ریشهٔ SPA
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/app", nil))
	if w.Body.String() != "INDEX" {
		t.Fatalf("ریشهٔ /app باید index.html بدهد، داد: %q", w.Body.String())
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
