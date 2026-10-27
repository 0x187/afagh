// ═══ کد یک‌بارمصرف — پورت src/lib/otp.ts ═══
package otp

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"os"
	"strings"
)

const pepperEnv = "AFAGH_OTP_PEPPER"
const devPepper = "afagh-dev-otp-pepper"

// Pepper فلفل HMAC؛ در production بدون آن خطا (fail-closed).
func Pepper(production bool) (string, error) {
	p := strings.TrimSpace(os.Getenv(pepperEnv))
	if p != "" {
		return p, nil
	}
	if production {
		return "", errors.New("[otp] AFAGH_OTP_PEPPER در production ست نشده است — صدور OTP متوقف شد (fail-closed).")
	}
	return devPepper, nil
}

// NewCode کد شش‌رقمی از CSPRNG.
func NewCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// Digest هش HMAC-SHA256 با بافت یکتا.
func Digest(pepper, code, context string) string {
	mac := hmac.New(sha256.New, []byte(pepper))
	mac.Write([]byte(strings.TrimSpace(code) + ":" + context))
	return hex.EncodeToString(mac.Sum(nil))
}

// LegacyDigest سازگاری با رکوردهای قدیمی sha256(code).
func LegacyDigest(code string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(code)))
	return hex.EncodeToString(sum[:])
}

// Equal مقایسهٔ زمان-ثابت.
func Equal(a, b string) bool {
	ab := []byte(a)
	bb := []byte(b)
	return len(ab) == len(bb) && subtle.ConstantTimeCompare(ab, bb) == 1
}
