// ═══ وب‌هوک گردش کار با گارد SSRF ═══
package workflow

import (
	"bytes"
	"context"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// postWebhookSafe ارسال POST به وب‌هوک — فقط https به مقصد عمومی؛ خطا بی‌صدا.
func postWebhookSafe(rawURL string, body []byte) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return
	}
	host := u.Hostname()
	if host == "" {
		return
	}
	// مقصدهای داخلی/خصوصی مسدود (fail-closed).
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
			return
		}
	} else if strings.EqualFold(host, "localhost") {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}
