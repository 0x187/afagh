// ═══ one-time code — port of src/lib/otp.ts ═══
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

// Pepper is the HMAC pepper; in production, missing it is an error (fail-closed).
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

// NewCode: six-digit code from CSPRNG.
func NewCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// Digest: HMAC-SHA256 hash with a unique context.
func Digest(pepper, code, context string) string {
	mac := hmac.New(sha256.New, []byte(pepper))
	mac.Write([]byte(strings.TrimSpace(code) + ":" + context))
	return hex.EncodeToString(mac.Sum(nil))
}

// LegacyDigest: compatibility with old sha256(code) records.
func LegacyDigest(code string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(code)))
	return hex.EncodeToString(sum[:])
}

// Equal: constant-time comparison.
func Equal(a, b string) bool {
	ab := []byte(a)
	bb := []byte(b)
	return len(ab) == len(bb) && subtle.ConstantTimeCompare(ab, bb) == 1
}
