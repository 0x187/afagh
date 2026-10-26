// ═══ رمزنگاری داده‌های هویتی (PII) — پورت pii.ts ═══
//
// دو ستون برای کد ملی:
//   - شاخص کور (HMAC-SHA256، برگشت‌ناپذیر) برای جست‌وجوی برابری
//   - متن رمزشده (AES-256-GCM) برای نمایش به کاربر مجاز
//
// پاکت عیناً samin/crypto.ts و سامانهٔ فعلی: `v1:<ivHex>:<tagHex>:<dataHex>`
// با IV ۱۲ بایتی، tag ۱۶ بایتی و همهٔ اجزا hex. کلید:
//   - ۶۴ کاراکتر hex → همان ۳۲ بایت AES-256
//   - هر چیز دیگر → scrypt (N=16384,r=8,p=1) با نمک ثابت afagh:pii:v1
//
// در production نبودِ AFAGH_PII_KEY خطاست (fail-closed)؛ در توسعه کلید عمومی.
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
	// KeyEnv نام متغیر کلید اصلی.
	KeyEnv = "AFAGH_PII_KEY"
	// KeyPreviousEnv نام متغیر کلید قبلی (گردش کلید).
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

// production آیا محیط تولید است؟ (همان NODE_ENV)
func production() bool {
	return strings.TrimSpace(os.Getenv("NODE_ENV")) == "production"
}

// deriveKey پورت deriveKey: hex64 → بایت‌های خام؛ وگرنه scrypt با نمک ثابت.
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

// Key کلید اصلی PII — صفر/خطا در production بدون کلید (fail-closed).
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

// KeyPrevious کلید قبلی (اختیاری) — نبودش خطا نیست.
func KeyPrevious() ([]byte, error) {
	return keyFromEnv(KeyPreviousEnv)
}

// NormalizePiiValue پورت normalizePiiValue: ارقام → لاتین، حذف فاصله/کنترل‌های
// جهت‌دهی/خط تیره‌ها و trim.
func NormalizePiiValue(value string) string {
	s := fa.ToEnDigits(value)
	s = spaceRun.ReplaceAllString(s, "")
	s = dashRun.ReplaceAllString(s, "")
	return strings.TrimSpace(s)
}

// IsPiiCiphertext آیا پاکت نسخهٔ فعلی است؟
func IsPiiCiphertext(value string) bool {
	parts := strings.Split(value, ":")
	if len(parts) != 4 || parts[0] != envelopeVersion {
		return false
	}
	_, iv, tag, data := parts[0], parts[1], parts[2], parts[3]
	return hex24.MatchString(iv) && hex32.MatchString(tag) && hexAny.MatchString(data) && len(data)%2 == 0
}

// EncryptPii پورت encryptPii — IV تصادفی؛ خروجی v1:iv:tag:data.
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

// encryptWith رمزگذاری با IV مشخص (برای تست پارتی).
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

// DecryptPii پورت decryptPii — ابتدا کلید جاری، سپس کلید قبلی.
// هیچ ناسازگاری‌ای متن ساده برنمی‌گرداند (fail-closed).
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

// BlindIndex پورت blindIndex: HMAC-SHA256 با کلید فرعی دامنه‌جدا.
// پیام: `v1|<context>|<مقدار نرمال‌شده>`.
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

// MaskPii پورت maskPii: ۳ رقم اول + ۵ ستاره + ۲ رقم آخر (طول ثابت).
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
