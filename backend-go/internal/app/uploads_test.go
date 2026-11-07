package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestWithUploads(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "logo.png"), []byte("PNG"), 0o644)
	_ = os.MkdirAll(filepath.Join(dir, "nested"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "nested", "a.txt"), []byte("TXT"), 0o644)

	root := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("ROOT")) })
	h := withUploads(root, dir)

	// existing file served
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/uploads/logo.png", nil))
	if w.Body.String() != "PNG" {
		t.Fatalf("uploads file must be served, got %q", w.Body.String())
	}
	// nested file served
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/uploads/nested/a.txt", nil))
	if w.Body.String() != "TXT" {
		t.Fatalf("nested uploads file must be served, got %q", w.Body.String())
	}
	// directory listing denied
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/uploads/nested/", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("directory path must 404, got %d", w.Code)
	}
	// missing file → real 404
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/uploads/missing.png", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("missing file must 404, got %d", w.Code)
	}
	// everything else falls through to root
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://x/api/v2/health", nil))
	if w.Body.String() != "ROOT" {
		t.Fatalf("non-uploads paths must reach the root handler, got %q", w.Body.String())
	}
}
