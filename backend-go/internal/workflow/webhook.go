// ═══ Workflow webhook with SSRF guard ═══
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

// postWebhookSafe POSTs to the webhook — https only, to public destinations; errors are silent.
func postWebhookSafe(rawURL string, body []byte) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return
	}
	host := u.Hostname()
	if host == "" {
		return
	}
	// Internal/private destinations are blocked (fail-closed).
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
