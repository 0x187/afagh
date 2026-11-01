// ═══ Token signing — faithful port from src/lib/verification.ts (signToken part) ═══
//
// Format: `T1.<base64url(JSON payload + jti + exp)>.<base64url(HMAC-SHA256(secret, body))>`
// Random jti so two consecutive issuances do not produce identical tokens.
// The key comes from the TICKET_TOKEN_SECRET setting; soft rotation with PREVIOUS_TICKET_TOKEN_SECRET
// (both are checked, constant-time comparison) — same behavior as TS.
package verification

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// SettingsStore is the minimal required dependency — a port of getSetting.
type SettingsStore interface {
	Get(ctx context.Context, key string) (string, error)
}

// Signer is the HMAC token signer.
type Signer struct {
	Settings SettingsStore
}

func New(settings SettingsStore) *Signer { return &Signer{Settings: settings} }

func b64u(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func (s *Signer) tokenSecret(ctx context.Context) (string, error) {
	raw, err := s.Settings.Get(ctx, "TICKET_TOKEN_SECRET")
	if err != nil {
		return "", err
	}
	secret := strings.TrimSpace(raw)
	if secret == "" {
		return "", errors.New("کلید امضای توکن (TICKET_TOKEN_SECRET) تنظیم نشده است.")
	}
	return secret, nil
}

// Sign is a port of signToken: TTL is exactly ttlSec; exp = now + ttl.
func (s *Signer) Sign(ctx context.Context, payload map[string]any, ttlSec int) (string, error) {
	secret, err := s.tokenSecret(ctx)
	if err != nil {
		return "", err
	}
	exp := time.Now().Unix() + int64(ttlSec)
	jti := make([]byte, 8)
	if _, err := rand.Read(jti); err != nil {
		return "", err
	}
	body := make(map[string]any, len(payload)+2)
	for k, v := range payload {
		body[k] = v
	}
	body["jti"] = hex.EncodeToString(jti)
	body["exp"] = exp

	raw, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	encoded := b64u(raw)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(encoded))
	sig := b64u(mac.Sum(nil))
	return "T1." + encoded + "." + sig, nil
}

// ErrMalformed / ErrBadSignature / ErrExpired — equivalents of the TS reason values.
var (
	ErrMalformed    = errors.New("MALFORMED")
	ErrBadSignature = errors.New("BAD_SIGNATURE")
	ErrExpired      = errors.New("EXPIRED")
)

// Verify is a port of verifyTokenSignature: checks the signature (current + previous) and expiry without any
// guessing or arbitrary interpretation.
func (s *Signer) Verify(ctx context.Context, token string) (map[string]any, bool, error) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 3 || parts[0] != "T1" {
		return nil, false, ErrMalformed
	}
	body, sig := parts[1], parts[2]

	currentSecret, err := s.tokenSecret(ctx)
	if err != nil {
		return nil, false, err
	}
	prevSecret, _ := s.Settings.Get(ctx, "PREVIOUS_TICKET_TOKEN_SECRET")
	prevSecret = strings.TrimSpace(prevSecret)

	valid := hmacEqual(body, sig, currentSecret)
	if !valid && prevSecret != "" {
		valid = hmacEqual(body, sig, prevSecret)
	}
	if !valid {
		return nil, false, ErrBadSignature
	}

	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return nil, false, ErrMalformed
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, false, ErrMalformed
	}
	exp, ok := payload["exp"].(float64)
	if !ok || !isFinite(exp) || int64(exp) < time.Now().Unix() {
		return nil, false, ErrExpired
	}
	return payload, true, nil
}

func isFinite(f float64) bool {
	return !(f != f) // NaN check (Inf doesn't come from JSON but for parity)
}

func hmacEqual(body, sig, secret string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	expected := b64u(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(sig), []byte(expected)) == 1
}

// Ensure interface compliance at compile time for contract use.
var _ = fmt.Sprintf
