package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// پارتی با assertSameOrigin در security.ts — قواعد Origin/Referer.
func TestAssertSameOrigin(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	mk := func(host, origin, referer string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "http://example.com/api/v2/x", nil)
		r.Host = host
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if referer != "" {
			r.Header.Set("Referer", referer)
		}
		return r
	}

	cases := []struct {
		name           string
		host, origin   string
		referer        string
		extra          []string
		wantStatusCode int
	}{
		{"origin هم‌مبدأ", "edu.example.ac.ir", "https://edu.example.ac.ir", "", nil, 200},
		{"origin ناهم‌مبدأ", "edu.example.ac.ir", "https://evil.example.net", "", nil, 403},
		{"origin در لیست سفید", "edu.example.ac.ir", "https://portal.other.ir", "", []string{"https://portal.other.ir"}, 200},
		{"referer هم‌مبدأ", "edu.example.ac.ir", "", "https://edu.example.ac.ir/student", nil, 200},
		{"referer ناهم‌مبدأ", "edu.example.ac.ir", "", "https://evil.example.net/x", nil, 403},
		{"بدون هر دو (curl/cron)", "edu.example.ac.ir", "", "", nil, 200},
		{"host با پورت", "localhost:8090", "http://localhost:8090/app", "", nil, 200},
		{"host با پورت ناهم‌خوان", "localhost:8090", "http://localhost:3000", "", nil, 403},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			allowed := AssertSameOrigin(w, mk(tc.host, tc.origin, tc.referer), tc.extra)
			if allowed != (tc.wantStatusCode == 200) {
				t.Fatalf("allowed=%d want=%d", boolToInt(allowed), boolToInt(tc.wantStatusCode == 200))
			}
			if !allowed && w.Code != tc.wantStatusCode {
				t.Fatalf("status=%d want=%d", w.Code, tc.wantStatusCode)
			}
			if !allowed {
				// پاسخ 403 باید JSON با همان پیام فارسی باشد
				if got := w.Body.String(); got != `{"error":"منشأ درخواست با سامانه هم‌خوان نیست (CSRF blocked)."}` {
					t.Fatalf("بدنهٔ 403 نادرست: %s", got)
				}
			}
			_ = ok
		})
	}
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
