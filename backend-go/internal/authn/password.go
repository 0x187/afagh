// ═══ هش گذرواژه — پورت scrypt از afagh-next/src/lib/auth.ts ═══
//
// فرمت ذخیره (فاز صفر): «salt:hash» هگز — salt ۱۶ بایت تصادفی، keyLen ۳۲،
// r=8، p=1 — پارامترهای سازگار با crypto.scrypt نود. مقایسهٔ زمان‌ثابت و
// هش ساختگی «۰۰۰…:۰۰۰…» برای پدینگ زمان‌ثابت مسیر «کاربر یافت نشد».
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

// scryptParams پارامترهای جاری — با sync.OnceValue از ENV یک‌بار حل می‌شود.
var scryptParams = sync.OnceValues(func() (n int, err error) {
	return resolveScryptN(os.Getenv("AFAGH_SCRYPT_N"), ConfigFromEnv().Production)
})

// scryptNFloor کف مجاز N — کمتر از آن یعنی هش ضعیف‌تر = کرک سریع‌تر.
const scryptNFloor = 16384

// resolveScryptN پورت منطق SCRYPT_N_RAW در auth.ts:
//   - مقدار نامعتبر (غیرعدد/غیرصحیح/زیر کف) در production ⇒ خطای fail-closed
//     («سامانه بالا نمی‌آید») — در TS این خطا هنگام لود ماژول پرتاب می‌شود و
//     سرویس بالا نمی‌آید؛ در Go که نمی‌توان از داخل پکیج process را کشت، خطا
//     در اولین مصرفِ هش/verify برمی‌گردد و مسیرهای احراز هویت بسته می‌مانند.
//   - همان مقدار نامعتبر در غیر production ⇒ هشدار و بازگشت به کف ۱۶۳۸۴.
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

// scryptKey مشتق‌سازی با پارامترهای مشترک — salt به‌صورت «رشتهٔ هگز» مصرف
// می‌شود (نه بایت‌های decodeشده) تا با scryptSync نود هم‌ارز باشد.
//
// ⚠ ترتیب آرگومان‌های x/crypto/scrypt: Key(password, salt, N, r, p, keyLen)
func scryptKey(password, saltHex string) ([]byte, error) {
	n, err := scryptParams()
	if err != nil {
		return nil, err
	}
	// N از ENV/پیش‌فرض، r=8، p=1، keyLen=32 — همان SCRYPT_OPTS در auth.ts
	return scrypt.Key([]byte(password), []byte(saltHex), n, 8, 1, scryptKeyLen)
}

// scryptKeyLen طول کلید خروجی — ۳۲ بایت (۶۴ کاراکتر هگز).
const scryptKeyLen = 32

// DUMMY_PASSWORD_HASH هش ساختگی با فرمت معتبر (۳۲ صفر : ۶۴ صفر) — فقط برای
// پدینگ زمان‌ثابت در مسیر «کاربر یافت نشد»؛ هرگز با آن هش واقعی نمی‌سازیم.
const DUMMY_PASSWORD_HASH = "00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000"

// VerifyPassword پورت خط‌به‌خط verifyPassword:
//   - فرمت بد (نبودِ salt/hash) ⇒ false بدون خطا
//   - hash هگز نامعتبر ⇒ false بدون خطا (معادل Buffer نیمه‌باز نود که طولش
//     با مشتق ۳۲ بایتی نمی‌خواند)
//   - مقایسهٔ طول + timing-safe
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

// VerifyPasswordIgnoreErr برای مسیرهای پدینگ زمان‌ثابت که در TS با
// .catch(() => false) صدا زده می‌شوند — خطای پیکربندی هم «ناموفق» شمرده می‌شود.
func VerifyPasswordIgnoreErr(password, stored string) bool {
	ok, err := VerifyPassword(password, stored)
	return err == nil && ok
}

// HashPassword پورت hashPassword — خروجی «salt:hash» هگز با salt تصادفی ۱۶ بایتی.
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
