// ═══ Identity data (PII) encryption — port of pii.ts ═══
//
// two columns for the national ID:
//   - blind index (HMAC-SHA256, irreversible) for equality search
//   - ciphertext (AES-256-GCM) for display to an authorized user
//
// envelope identical to samin/crypto.ts and the current system: `v1:<ivHex>:<tagHex>:<dataHex>`
// with a 12-byte IV, a 16-byte tag, and all parts hex. Key:
//   - 64 hex chars → the same 32 bytes of AES-256
//   - anything else → scrypt (N=16384,r=8,p=1) with fixed salt afagh:pii:v1
//
// in production a missing AFAGH_PII_KEY is an error (fail-closed); in development the key is public.
package pii

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"regexp"
	"strings"

	"golang.org/x/crypto/scrypt"

	"backend-go/internal/fa"
)

const (
	// KeyEnv name of the primary key variable.
	KeyEnv = "AFAGH_PII_KEY"
	// KeyPreviousEnv name of the previous key variable (key rotation).
	KeyPreviousEnv = "AFAGH_PII_KEY_PREVIOUS"

	envelopeVersion = "v1"
	ivBytes         = 12
	tagBytes        = 16
	passphraseSalt  = "afagh:pii:v1"
	devFallback     = "afagh-dev-pii-key-not-for-production"
)

var (
	hex64    = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
	hex24    = regexp.MustCompile(`^[0-9a-f]{24}$`)
	hex32    = regexp.MustCompile(`^[0-9a-f]{32}$`)
	hexAny   = regexp.MustCompile(`^[0-9a-f]*$`)
	spaceRun = regexp.MustCompile(`[\s\x{200b}-\x{200f}\x{202a}-\x{202e}\x{2066}-\x{2069}\x{feff}]`)
	dashRun  = regexp.MustCompile(`[‐‑‒–—―−-]`)
)

// production whether this is the production environment? (same as NODE_ENV)
func production() bool {
	return strings.TrimSpace(os.Getenv("NODE_ENV")) == "production"
}

// deriveKey port of deriveKey: hex64 → raw bytes; otherwise scrypt with fixed salt.
func deriveKey(raw string) ([]byte, error) {
	value := strings.TrimSpace(raw)
	if hex64.MatchString(value) {
		return hex.DecodeString(value)
	}
	return scrypt.Key([]byte(value), []byte(passphraseSalt), 16384, 8, 1, 32)
}

func keyFromEnv(name string) ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return nil, nil
	}
	return deriveKey(raw)
}

// Key the primary PII key — zero value/error in production without a key (fail-closed).
func Key() ([]byte, error) {
	key, err := keyFromEnv(KeyEnv)
	if err != nil {
		return nil, err
	}
	if key != nil {
		return key, nil
	}
	if production() {
		return nil, errors.New(KeyEnv + " تعریف نشده است — رمزنگاری داده‌های هویتی در پروداکشن بدون کلید مجاز نیست.")
	}
	return deriveKey(devFallback)
}

// KeyPrevious the previous key (optional) — its absence is not an error.
func KeyPrevious() ([]byte, error) {
	return keyFromEnv(KeyPreviousEnv)
}

// NormalizePiiValue port of normalizePiiValue: digits → Latin, strip spaces/directional
// controls/hyphens and trim.
func NormalizePiiValue(value string) string {
	s := fa.ToEnDigits(value)
	s = spaceRun.ReplaceAllString(s, "")
	s = dashRun.ReplaceAllString(s, "")
	return strings.TrimSpace(s)
}

// IsPiiCiphertext is this the current envelope version?
func IsPiiCiphertext(value string) bool {
	parts := strings.Split(value, ":")
	if len(parts) != 4 || parts[0] != envelopeVersion {
		return false
	}
	_, iv, tag, data := parts[0], parts[1], parts[2], parts[3]
	return hex24.MatchString(iv) && hex32.MatchString(tag) && hexAny.MatchString(data) && len(data)%2 == 0
}

// EncryptPii port of encryptPii — random IV; output v1:iv:tag:data.
func EncryptPii(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	key, err := Key()
	if err != nil {
		return "", err
	}
	iv := make([]byte, ivBytes)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	return encryptWith(key, iv, []byte(plain))
}

// encryptWith encrypts with a given IV (for party tests).
func encryptWith(key, iv, plain []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, iv, plain, nil)
	// Seal: ciphertext || tag
	if len(sealed) < tagBytes {
		return "", errors.New("پاکت رمز نامعتبر است")
	}
	data := sealed[:len(sealed)-tagBytes]
	tag := sealed[len(sealed)-tagBytes:]
	return envelopeVersion + ":" + hex.EncodeToString(iv) + ":" + hex.EncodeToString(tag) + ":" + hex.EncodeToString(data), nil
}

func decryptWithKey(ivHex, tagHex, dataHex string, key []byte) (string, error) {
	iv, err := hex.DecodeString(ivHex)
	if err != nil {
		return "", err
	}
	tag, err := hex.DecodeString(tagHex)
	if err != nil {
		return "", err
	}
	data, err := hex.DecodeString(dataHex)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	sealed := append(append([]byte{}, data...), tag...)
	plain, err := gcm.Open(nil, iv, sealed, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// DecryptPii port of decryptPii — current key first, then the previous key.
// any inconsistency returns no plaintext (fail-closed).
func DecryptPii(cipherText string) (string, error) {
	if cipherText == "" {
		return "", nil
	}
	if !IsPiiCiphertext(cipherText) {
		return "", errors.New("دادهٔ رمزشدهٔ PII معتبر نیست — پاکت ناشناخته یا ناقص است.")
	}
	parts := strings.Split(cipherText, ":")
	ivHex, tagHex, dataHex := parts[1], parts[2], parts[3]

	keys := [][]byte{}
	current, err := Key()
	if err != nil {
		return "", err
	}
	keys = append(keys, current)
	if previous, perr := KeyPrevious(); perr == nil && previous != nil && !equalBytes(previous, current) {
		keys = append(keys, previous)
	}
	for _, key := range keys {
		if plain, derr := decryptWithKey(ivHex, tagHex, dataHex, key); derr == nil {
			return plain, nil
		}
	}
	return "", errors.New("رمزگشایی PII ناموفق بود — داده دستکاری شده است یا کلید رمزنگاری اشتباه/عوض‌شده است.")
}

func equalBytes(a, b []byte) bool { return hmac.Equal(a, b) }

// BlindIndex port of blindIndex: HMAC-SHA256 with a domain-separated subkey.
// message: `v1|<context>|<normalized value>`.
func BlindIndex(value, context string) (string, error) {
	normalized := NormalizePiiValue(value)
	ctx := strings.TrimSpace(context)
	if normalized == "" {
		return "", errors.New("شاخص کور برای مقدار خالی ساخته نمی‌شود.")
	}
	if ctx == "" {
		return "", errors.New("ساخت شاخص کور بدون context (نام جدول/ستون) مجاز نیست.")
	}
	key, err := Key()
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(passphraseSalt + ":blind-index"))
	indexKey := mac.Sum(nil)

	mac2 := hmac.New(sha256.New, indexKey)
	mac2.Write([]byte(envelopeVersion + "|" + ctx + "|" + normalized))
	return hex.EncodeToString(mac2.Sum(nil)), nil
}

// MaskPii port of maskPii: first 3 digits + 5 stars + last 2 digits (fixed length).
func MaskPii(value string) string {
	c := strings.TrimSpace(value)
	if c == "" {
		return "—"
	}
	runes := []rune(c)
	if len(runes) <= 5 {
		return "*****"
	}
	return string(runes[:3]) + "*****" + string(runes[len(runes)-2:])
}
