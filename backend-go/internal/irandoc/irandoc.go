// ═══ Irandoc similarity check — port of executeIrandocCheck ═══
//
// Path 1: real connection to the service with a public-destination guard;
// Path 2: when unconfigured, an honest MANUAL_REVIEW response (no fake demo).
package irandoc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Settings is the minimal settings dependency.
type Settings interface {
	Get(ctx context.Context, key string) (string, error)
	GetNumber(ctx context.Context, key string, fallback float64) float64
}

// Params is the check input.
type Params struct {
	NationalCode string
	TrackingCode string
	ThesisTitle  string
	DocHash      string
	Threshold    float64
}

// Result is the check result (shape compatible with IrandocCheckResult in TS).
type Result struct {
	Status               string  `json:"status"`
	SimilarityPercentage float64 `json:"similarityPercentage"`
	MaxAllowedThreshold  float64 `json:"maxAllowedThreshold"`
	CertificateURL       string  `json:"certificateUrl"`
	TrackingCode         string  `json:"trackingCode"`
	ThesisTitle          string  `json:"thesisTitle"`
	Decision             string  `json:"decision"`
	Message              string  `json:"message"`
	DurationMs           int64   `json:"durationMs"`
}

// Check runs the similarity check.
func Check(ctx context.Context, settings Settings, p Params) Result {
	started := time.Now()
	threshold := p.Threshold
	if threshold <= 0 {
		threshold = 20
		if settings != nil {
			threshold = settings.GetNumber(ctx, "GRAD_IRANDOC_MAX_SIMILARITY", 20)
		}
	}
	base := ""
	if settings != nil {
		v, _ := settings.Get(ctx, "IRANDOC_BASE_URL")
		base = strings.TrimRight(strings.TrimSpace(v), "/")
	}
	done := func(r Result) Result {
		r.DurationMs = time.Since(started).Milliseconds()
		return r
	}
	if base == "" {
		return done(Result{
			Status: "FAILED", SimilarityPercentage: 0, MaxAllowedThreshold: threshold,
			TrackingCode: p.TrackingCode, ThesisTitle: p.ThesisTitle, Decision: "MANUAL_REVIEW",
			Message: "سرویس همانندجویی ایرانداک پیکربندی نشده است (IRANDOC_BASE_URL).",
		})
	}
	payload, _ := json.Marshal(map[string]any{
		"national_id": p.NationalCode, "tracking_code": p.TrackingCode,
		"thesis_title": p.ThesisTitle, "doc_hash": nullIfEmpty(p.DocHash),
		"max_allowed_threshold": threshold,
	})
	raw, err := safePostJSON(ctx, base+"/similarity-check", payload, nil)
	if err != nil {
		return done(Result{
			Status: "FAILED", SimilarityPercentage: 0, MaxAllowedThreshold: threshold,
			TrackingCode: p.TrackingCode, ThesisTitle: p.ThesisTitle, Decision: "MANUAL_REVIEW",
			Message: "اتصال به سرویس همانندجویی ناموفق بود؛ بررسی دستی توسط کارشناس لازم است.",
		})
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return done(Result{
			Status: "FAILED", SimilarityPercentage: 0, MaxAllowedThreshold: threshold,
			TrackingCode: p.TrackingCode, ThesisTitle: p.ThesisTitle, Decision: "MANUAL_REVIEW",
			Message: "پاسخ سرویس همانندجویی نامعتبر است؛ بررسی دستی لازم است.",
		})
	}
	sim, ok := numberFromAny(firstNonNil(data["similarity"], data["similarity_percent"], data["similarityPercentage"]))
	if !ok {
		return done(Result{
			Status: "FAILED", SimilarityPercentage: 0, MaxAllowedThreshold: threshold,
			TrackingCode: p.TrackingCode, ThesisTitle: p.ThesisTitle, Decision: "MANUAL_REVIEW",
			Message: "پاسخ سرویس فاقد درصد مشابهت است.",
		})
	}
	approved := sim <= threshold
	decision := "REJECT_EXCEED_LIMIT"
	status := "REJECTED"
	message := fmt.Sprintf("درصد مشابهت (%s٪) از سقف مجاز (%s٪) بیشتر است — نیاز به اصلاح متن.", trimNum(sim), trimNum(threshold))
	if approved {
		decision = "AUTO_APPROVE"
		status = "COMPLETED"
		message = fmt.Sprintf("همانندجویی انجام شد: مشابهت %s٪ در محدودهٔ مجاز (زیر %s٪).", trimNum(sim), trimNum(threshold))
	}
	if d, ok := data["decision"].(string); ok && d == "AUTO_APPROVE" && approved {
		decision = "AUTO_APPROVE"
	}
	if m, ok := data["message"].(string); ok && strings.TrimSpace(m) != "" {
		message = m
	}
	return done(Result{
		Status: status, SimilarityPercentage: sim, MaxAllowedThreshold: threshold,
		CertificateURL: fmt.Sprintf("%s/cert/verify-%s.pdf", base, url.PathEscape(p.TrackingCode)),
		TrackingCode:   p.TrackingCode, ThesisTitle: p.ThesisTitle,
		Decision: decision, Message: message,
	})
}

func nullIfEmpty(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

func firstNonNil(vals ...any) any {
	for _, v := range vals {
		if v != nil {
			return v
		}
	}
	return nil
}

func numberFromAny(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, !math.IsNaN(x)
	case json.Number:
		f, err := x.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		return f, err == nil
	}
	return 0, false
}

func trimNum(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// safePostJSON POST with a public-destination guard (no localhost/private IP).
func safePostJSON(ctx context.Context, rawURL string, body []byte, headers map[string]string) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, errors.New("نشانی نامعتبر است")
	}
	host := u.Hostname()
	if host == "" || strings.EqualFold(host, "localhost") {
		return nil, errors.New("مقصد نامعتبر است")
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()) {
		return nil, errors.New("مقصد نامعتبر است")
	}
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, rawURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return raw, nil
}
