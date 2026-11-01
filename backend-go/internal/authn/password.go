// ═══ Password hashing — scrypt port from afagh-next/src/lib/auth.ts ═══
//
// Storage format (phase zero): «salt:hash» hex — 16-byte random salt, keyLen 32,
// r=8, p=1 — parameters compatible with Node crypto.scrypt. Constant-time comparison and
// a dummy "000…:000…" hash for constant-time padding on the "user not found" path.
package authn

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"math"
	"os"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/crypto/scrypt"
)

// scryptParams holds the current parameters — resolved once from ENV with sync.OnceValue.
var scryptParams = sync.OnceValues(func() (n int, err error) {
	return resolveScryptN(os.Getenv("AFAGH_SCRYPT_N"), ConfigFromEnv().Production)
})

// scryptNFloor is the allowed N floor — below it means a weaker hash = faster cracking.
const scryptNFloor = 16384

// resolveScryptN is a port of the SCRYPT_N_RAW logic in auth.ts:
//   - an invalid value (non-numeric/non-integer/below floor) in production ⇒ fail-closed error
//     ("the system does not start") — in TS this error is thrown at module load and
//     the service does not come up; in Go, where a package cannot kill the process, the error
//     is returned on the first hash/verify use and auth paths stay closed.
//   - the same invalid value in non-production ⇒ warning and fallback to the floor 16384.
func resolveScryptN(raw string, production bool) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return scryptNFloor, nil
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || f != math.Trunc(f) || f < scryptNFloor {
		if production {
			return 0, errors.New("[auth] AFAGH_SCRYPT_N زیر کف مجاز 16384 در production است — سامانه بالا نمی‌آید (fail-closed).")
		}
		loggerFor().Error("scrypt_n_invalid", map[string]any{"raw": raw})
		return scryptNFloor, nil
	}
	return int(f), nil
}

// scryptKey derives with the shared parameters — salt is consumed as a "hex string"
// (not decoded bytes) to be equivalent to Node scryptSync.
//
// ⚠ Argument order for x/crypto/scrypt: Key(password, salt, N, r, p, keyLen)
func scryptKey(password, saltHex string) ([]byte, error) {
	n, err := scryptParams()
	if err != nil {
		return nil, err
	}
	// N from ENV/default, r=8, p=1, keyLen=32 — same as SCRYPT_OPTS in auth.ts
	return scrypt.Key([]byte(password), []byte(saltHex), n, 8, 1, scryptKeyLen)
}

// scryptKeyLen is the output key length — 32 bytes (64 hex characters).
const scryptKeyLen = 32

// DUMMY_PASSWORD_HASH is a dummy hash with a valid format (32 zeros : 64 zeros) — only for
// constant-time padding on the "user not found" path; we never build a real hash with it.
const DUMMY_PASSWORD_HASH = "00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000"

// VerifyPassword is a line-by-line port of verifyPassword:
//   - bad format (missing salt/hash) ⇒ false without error
//   - invalid hex hash ⇒ false without error (equivalent to Node's half-open Buffer whose length
//     does not match the 32-byte derivation)
//   - length comparison + timing-safe
func VerifyPassword(password, stored string) (bool, error) {
	salt, hash, ok := strings.Cut(stored, ":")
	if !ok || salt == "" || hash == "" {
		return false, nil
	}
	calc, err := scryptKey(password, salt)
	if err != nil {
		return false, err
	}
	known, err := hex.DecodeString(hash)
	if err != nil {
		return false, nil
	}
	return len(calc) == len(known) && subtle.ConstantTimeCompare(calc, known) == 1, nil
}

// VerifyPasswordIgnoreErr is for constant-time padding paths that in TS are called with
// .catch(() => false) — a configuration error also counts as a failure.
func VerifyPasswordIgnoreErr(password, stored string) bool {
	ok, err := VerifyPassword(password, stored)
	return err == nil && ok
}

// HashPassword is a port of hashPassword — output is «salt:hash» hex with a 16-byte random salt.
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	saltHex := hex.EncodeToString(salt)
	buf, err := scryptKey(password, saltHex)
	if err != nil {
		return "", err
	}
	return saltHex + ":" + hex.EncodeToString(buf), nil
}
