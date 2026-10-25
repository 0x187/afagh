// ═══ نشست مشترک — پورت وفادار از afagh-next/src/lib/auth.ts ═══
//
// قرارداد عمداً با Next.js یکسان است تا در الگوی strangler هر دو سرویس
// روی یک جدول sessions و یک کوکی کار کنند:
//   - توکن: ۶۴ کاراکتر hex (۳۲ بایت تصادفی)؛ در DB فقط sha256 آن ذخیره می‌شود.
//   - کوکی: نام قدیمی «token» + dual-read نام جدید «__Host-afagh_session»
//     پشت گیت AFAGH_SESSION_COOKIE_PREFIX=host (خواندن از نام جدید در اولویت).
//   - سقف مطلق نشست در DB (expiresAt) — بدون تمدید لغزان.
//   - کاربر غیرفعال ⇒ حذف نشست و بی‌اعتباری فوری همهٔ کانال‌ها.
//   - mustChangePassword ⇒ نشست فقط برای جریان تغییر رمز/خروج معتبر است.
package session

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// نام کوکی‌ها — همان ثابت‌های auth.ts.
const (
	CookieName     = "token"
	CookieNameHost = "__Host-afagh_session"
)

// HostPrefixEnabled گیت مهاجرت به نام کوکی __Host- — همان hostSessionCookieEnabled.
func HostPrefixEnabled() bool {
	return strings.ToLower(strings.TrimSpace(os.Getenv("AFAGH_SESSION_COOKIE_PREFIX"))) == "host"
}

// ReadToken خواندن توکن نشست از مپ کوکی‌ها — DUAL-READ با اولویت نام جدید.
func ReadToken(cookies map[string]string) string {
	if HostPrefixEnabled() {
		if t := cookies[CookieNameHost]; t != "" {
			return t
		}
	}
	return cookies[CookieName]
}

// Sha256Hex هش توکن پیش از مقایسه/ذخیره — همان sha256() در auth.ts.
func Sha256Hex(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

// User همان SessionUser در auth.ts.
type User struct {
	ID                 int64    `json:"id"`
	Name               string   `json:"name"`
	Roles              []string `json:"roles"`
	MustChangePassword bool     `json:"mustChangePassword"`
	UniversityID       *int64   `json:"universityId"`
}

// Store جست‌وجوی نشست روی استخر مالک — همان مسیر db در getSessionUser.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Get پورت خط‌به‌خط getSessionUser:
//  1. join sessions→users→user_roles→roles با token هش‌شده و انقضای آینده
//  2. هیچ سطری ⇒ nil (بدون نشست)
//  3. isActive != 1 ⇒ حذف نشست + nil (ابطال فوری همهٔ کانال‌ها)
//  4. mustChangePassword == 1 و !allowPending ⇒ nil (گاردها نشست نمی‌بینند)
//  5. roles بدون تکرار (چند سطر user_roles برای یک نقش)
func (s *Store) Get(ctx context.Context, rawToken string, allowPendingPasswordChange bool) (*User, error) {
	tokenHash := Sha256Hex(rawToken)
	rows, err := s.pool.Query(ctx, `
		select u.id, u."firstName", u."lastName", r.code,
		       u."mustChangePassword", u."isActive", u."universityId"
		from sessions s
		join users u on u.id = s."userId"
		left join user_roles ur on ur."userId" = u.id
		left join roles r on r.id = ur."roleId"
		where s.token = $1 and s."expiresAt" > now()
	`, tokenHash)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type rowT struct {
		id                  int64
		firstName, lastName string
		role                *string
		mustChangePassword  int
		isActive            int
		universityID        *int64
	}
	var rowsData []rowT
	for rows.Next() {
		var r rowT
		if err := rows.Scan(&r.id, &r.firstName, &r.lastName, &r.role,
			&r.mustChangePassword, &r.isActive, &r.universityID); err != nil {
			return nil, err
		}
		rowsData = append(rowsData, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(rowsData) == 0 {
		return nil, nil
	}
	first := rowsData[0]

	// ⛔ غیرفعال‌سازی کامل کاربر: نشست باز هم بی‌اعتبار است.
	if first.isActive != 1 {
		if _, err := s.pool.Exec(ctx, `delete from sessions where token = $1`, tokenHash); err != nil {
			return nil, err
		}
		return nil, nil
	}
	// 🔒 تغییر اجباری رمز: تا تغییر رمز هیچ گارد عمومی نشست معتبر نمی‌بیند.
	if first.mustChangePassword == 1 && !allowPendingPasswordChange {
		return nil, nil
	}

	roles := make([]string, 0, len(rowsData))
	seen := make(map[string]struct{}, len(rowsData))
	for _, r := range rowsData {
		if r.role == nil || *r.role == "" {
			continue
		}
		if _, dup := seen[*r.role]; dup {
			continue
		}
		seen[*r.role] = struct{}{}
		roles = append(roles, *r.role)
	}
	return &User{
		ID:                 first.id,
		Name:               strings.TrimSpace(first.firstName + " " + first.lastName),
		Roles:              roles,
		MustChangePassword: first.mustChangePassword == 1,
		UniversityID:       first.universityID,
	}, nil
}

// PurgeExpired پاکسازی دوره‌ای نشست‌های منقضی — کمکی داخلی؛ Next این کار را
// در لحظهٔ ورود انجام می‌دهد (issueSessionFor)؛ اینجا فقط برای سرویس بلند-عمر.
func (s *Store) PurgeExpired(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, `delete from sessions where "expiresAt" < $1`, time.Now())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ConstantTimeEmpty مقایسهٔ زمان‌ثابت برای طول توکن — توکن معتبر دقیقاً ۶۴ hex است.
// (مشابه چک شکل کوکی در src/proxy.ts؛ تضمین می‌کند توکن‌های بدشکل زودتر رد شوند
// بدون لو دادن اطلاعات زمانی.)
func ValidTokenShape(t string) bool {
	if len(t) != 64 {
		return false
	}
	if _, err := hex.DecodeString(t); err != nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(t), []byte(t)) == 1
}
