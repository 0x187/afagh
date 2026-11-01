// ═══ access log + panic recovery + request ID ═══
package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"backend-go/internal/logger"
)

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += int64(n)
	return n, err
}

func newRequestID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// AccessLog logs every owned request on one line and sets x-request-id.
func AccessLog(next http.Handler) http.Handler {
	log := logger.For("http")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rid := r.Header.Get("x-request-id")
		if rid == "" {
			rid = newRequestID()
		}
		w.Header().Set("x-request-id", rid)
		rec := &statusRecorder{ResponseWriter: w}
		t0 := time.Now()
		defer func() {
			if p := recover(); p != nil {
				log.Error("panic_recovered", logger.Fields{
					"method": r.Method, "path": r.URL.Path, "rid": rid,
					"panic": toStr(p), "ms": time.Since(t0).Milliseconds(),
				})
				if rec.status == 0 {
					w.Header().Set("Content-Type", "application/json; charset=utf-8")
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = w.Write([]byte(`{"error":"خطای داخلی سرور."}`))
				}
				return
			}
			status := rec.status
			if status == 0 {
				status = http.StatusOK
			}
			log.Info("request", logger.Fields{
				"method": r.Method, "path": r.URL.Path, "status": status,
				"ms": time.Since(t0).Milliseconds(), "rid": rid, "bytes": rec.bytes,
			})
		}()
		next.ServeHTTP(rec, r)
	})
}

func toStr(v any) string {
	if err, ok := v.(error); ok {
		return err.Error()
	}
	if s, ok := v.(string); ok {
		return s
	}
	return logger.MarshalSafe(v)
}
