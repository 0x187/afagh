// ═══ ورود / انتخاب حساب / خروج — پورت خط‌به‌خط از src/lib/auth.ts ═══
package authn

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/ratelimit"
	"backend-go/internal/session"
)

// userRow ردیف کاربر برای مسیرهای احراز هویت — فیلدهای لازم login/change/switch.
type userRow struct {
	ID                 int64
	FirstName          string
	LastName           string
	NationalCode       string
	PasswordHash       string
	IsActive           int
	MustChangePassword int
	UniversityID       *int64
}

const userSelectColumns = `id, "firstName", "lastName", "nationalCode", "passwordHash", "isActive", "mustChangePassword", "universityId"`

func scanUserRow(row pgx.Row) (*userRow, error) {
	var u userRow
	err := row.Scan(&u.ID, &u.FirstName, &u.LastName, &u.NationalCode, &u.PasswordHash,
		&u.IsActive, &u.MustChangePassword, &u.UniversityID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// sha256Hex همان sha256() در auth.ts — هش توکن پیش از ذخیره/مقایسه.
func sha256Hex(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

// IssueSessionFor تنها محل ساخت sessions — پورت issueSessionFor:
//  1. خواندن mustChangePassword
//  2. توکن ۳۲ بایت تصادفی (۶۴ hex)
//  3. حذف نشست‌های منقضی + همهٔ نشست‌های قبلی همین کاربر (ضد fixation)
//  4. درج نشست تازه با هش توکن
//  5. DUAL-WRITE کوکی + پاک‌کردن قفل بیکاری
func (s *Service) IssueSessionFor(ctx context.Context, w http.ResponseWriter, userID int64) (bool, error) {
	u, err := scanUserRow(s.Pool.QueryRow(ctx, `select `+userSelectColumns+` from users where id = $1`, userID))
	if err != nil {
		return false, err
	}
	if u == nil {
		return false, errors.New(msgUserNotFound)
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return false, err
	}
	token := hex.EncodeToString(raw)

	now := time.Now()
	if _, err := s.Pool.Exec(ctx, `delete from sessions where "expiresAt" < $1`, now); err != nil {
		return false, err
	}
	if _, err := s.Pool.Exec(ctx, `delete from sessions where "userId" = $1`, userID); err != nil {
		return false, err
	}
	expiresAt := now.Add(time.Duration(s.Cfg.SessionMaxHours) * time.Hour)
	if _, err := s.Pool.Exec(ctx,
		`insert into sessions (token, "userId", "expiresAt") values ($1, $2, $3)`,
		sha256Hex(token), userID, expiresAt); err != nil {
		return false, err
	}

	s.writeSessionCookie(w, token)
	s.clearLock(ctx, userID)
	return u.MustChangePassword == 1, nil
}

// candidateSummaries خلاصهٔ نمایشی حساب‌ها برای صفحهٔ «انتخاب حساب».
func (s *Service) candidateSummaries(ctx context.Context, ids []int64) ([]LoginCandidate, error) {
	out := make([]LoginCandidate, 0, len(ids))
	for _, id := range ids {
		var firstName, lastName string
		var universityID *int64
		err := s.Pool.QueryRow(ctx,
			`select "firstName", "lastName", "universityId" from users where id = $1`, id).
			Scan(&firstName, &lastName, &universityID)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}

		staffCodes := []string{}
		rows, err := s.Pool.Query(ctx, `select "staffCode" from staff where "userId" = $1`, id)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var c string
			if err := rows.Scan(&c); err != nil {
				rows.Close()
				return nil, err
			}
			staffCodes = append(staffCodes, c)
		}
		rows.Close()

		roles := []string{}
		rows, err = s.Pool.Query(ctx,
			`select r.code from user_roles ur join roles r on r.id = ur."roleId" where ur."userId" = $1`, id)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var c *string
			if err := rows.Scan(&c); err != nil {
				rows.Close()
				return nil, err
			}
			if c != nil && *c != "" {
				roles = append(roles, *c)
			}
		}
		rows.Close()

		var uniTitle *string
		if universityID != nil {
			var t string
			if err := s.Pool.QueryRow(ctx, `select title from universities where id = $1`, *universityID).Scan(&t); err == nil {
				uniTitle = &t
			}
		}

		name := strings.TrimSpace(firstName + " " + lastName)
		if name == "" {
			name = "—"
		}
		out = append(out, LoginCandidate{
			ID:              id,
			Name:            name,
			StaffCodes:      staffCodes,
			UniversityTitle: uniTitle,
			Roles:           roles,
		})
	}
	return out, nil
}

// loginUserIDs کاندیداهای ورود را به همان ترتیب auth.ts برمی‌گرداند:
// staff.staffCode → students.studentCode → گسترش هم‌شخصی (کدهای linked).
func (s *Service) loginUserIDs(ctx context.Context, clean string) ([]*userRow, error) {
	var cands []*userRow
	seen := map[int64]bool{}

	appendRows := func(rows pgx.Rows) error {
		defer rows.Close()
		for rows.Next() {
			var u userRow
			if err := rows.Scan(&u.ID, &u.FirstName, &u.LastName, &u.NationalCode, &u.PasswordHash,
				&u.IsActive, &u.MustChangePassword, &u.UniversityID); err != nil {
				return err
			}
			if !seen[u.ID] {
				seen[u.ID] = true
				cp := u
				cands = append(cands, &cp)
			}
		}
		return rows.Err()
	}

	rows, err := s.Pool.Query(ctx,
		`select `+userSelectColumnsSuffix()+`
		   from staff st join users u on u.id = st."userId"
		  where st."staffCode" = $1 order by u.id`, clean)
	if err != nil {
		return nil, err
	}
	if err := appendRows(rows); err != nil {
		return nil, err
	}

	if len(cands) == 0 {
		rows, err = s.Pool.Query(ctx,
			`select `+userSelectColumnsSuffix()+`
			   from students stu join users u on u.id = stu."userId"
			  where stu."studentCode" = $1 order by u.id`, clean)
		if err != nil {
			return nil, err
		}
		if err := appendRows(rows); err != nil {
			return nil, err
		}
	}

	// ── گسترش هم‌شخصی: کدهای linked همان کدملی هم کاندیدا می‌شوند؛
	//    ورود به هر حساب فقط با رمز همان حساب. (STAFF_NC_MAP)
	linked := map[string]bool{}
	if nc, ok := staffNCMap[clean]; ok {
		for _, c := range ncToCodes[nc] {
			linked[c] = true
		}
	}
	for _, c := range ncToCodes[clean] {
		linked[c] = true
	}
	if len(linked) > 0 {
		codes := make([]string, 0, len(linked))
		for c := range linked {
			codes = append(codes, c)
		}
		rows, err = s.Pool.Query(ctx,
			`select `+userSelectColumnsSuffix()+`
			   from staff st join users u on u.id = st."userId"
			  where st."staffCode" = any($1) order by u.id`, codes)
		if err != nil {
			return nil, err
		}
		if err := appendRows(rows); err != nil {
			return nil, err
		}
	}
	return cands, nil
}

// userSelectColumnsSuffix ستون‌های users با پیشوند u. — برای joinهایی که
// ستون‌های هم‌نام (universityId/id/…) دارند و بدون qualify مبهم می‌شوند.
func userSelectColumnsSuffix() string {
	return `u.id, u."firstName", u."lastName", u."nationalCode", u."passwordHash", u."isActive", u."mustChangePassword", u."universityId"`
}

// Login پورت login(): نرمال‌سازی ارقام، محدودیت دو لایه (IP/حساب با رزرو پیش
// از scrypt)، تأخیر تصاعدی، پدینگ زمان‌ثابت، واریانت رمز نرمال‌شده، و
// حالت چند-حساب با توکن امضاشدهٔ ۵دقیقه‌ای.
func (s *Service) Login(ctx context.Context, w http.ResponseWriter, identifier, password, clientIP string) (*LoginResult, error) {
	clean := ToEnDigits(strings.TrimSpace(identifier))
	if clientIP == "" {
		clientIP = UNKNOWN_CLIENT_IP
	}
	// کلید IP هش می‌شود چون IP ممکن است از هدر پروکسی آمده باشد.
	ipKey := "login:ip:" + sha256Hex(clientIP)[:24]
	accKey := "login:acc:" + sha256Hex(clean)[:24]

	ipAllowed := true
	retryAfter := 0
	if s.Rate != nil {
		var err error
		ipAllowed, retryAfter, err = s.Rate.Allow(ctx, ipKey, 100, 10*60)
		if err != nil {
			loggerFor().Error("login_ip_rate_error", map[string]any{"error": err.Error()})
			ipAllowed = true
		}
	}
	if !ipAllowed {
		return nil, &LoginRateLimitError{RetryAfterSec: retryAfter}
	}

	priorFails := s.countRate(ctx, accKey)
	if priorFails > 0 {
		ratelimit.ProgressiveDelay(ctx, priorFails)
	}
	accAllowed := true
	if s.Rate != nil {
		var err error
		accAllowed, _, err = s.Rate.Allow(ctx, accKey, 5, 10*60)
		if err != nil {
			loggerFor().Error("login_acc_rate_error", map[string]any{"error": err.Error()})
			accAllowed = true
		}
	}
	if !accAllowed {
		// پدینگ زمان‌ثابت: مسیر «محدودشده» هم هزینهٔ scrypt بدهد.
		VerifyPasswordIgnoreErr(password, DUMMY_PASSWORD_HASH)
		return &LoginResult{OK: false, Error: msgLoginFailed}, nil
	}

	cands, err := s.loginUserIDs(ctx, clean)
	if err != nil {
		return nil, err
	}

	// واریانت رمز: عیناً + ارقام نرمال‌شده (فقط پذیرش بیشتر، بدون تغییر هش‌ها).
	variants := []string{password}
	if norm := ToEnDigits(password); norm != password {
		variants = append(variants, norm)
	}

	// پدینگ زمان‌ثابت وقتی کاندیدای فعالی نیست.
	hasActive := false
	for _, c := range cands {
		if c.IsActive == 1 {
			hasActive = true
			break
		}
	}
	if !hasActive {
		VerifyPasswordIgnoreErr(password, DUMMY_PASSWORD_HASH)
	}

	matched := make([]*userRow, 0, len(cands))
	for _, cand := range cands {
		if cand.IsActive != 1 {
			continue
		}
		for _, pw := range variants {
			if VerifyPasswordIgnoreErr(pw, cand.PasswordHash) {
				matched = append(matched, cand)
				break
			}
		}
	}
	if len(matched) == 0 {
		return &LoginResult{OK: false, Error: msgLoginFailed}, nil
	}

	s.releaseRate(ctx, ipKey, accKey)

	if len(matched) == 1 {
		mustChange, err := s.IssueSessionFor(ctx, w, matched[0].ID)
		if err != nil {
			return nil, err
		}
		return &LoginResult{OK: true, MustChange: mustChange}, nil
	}

	// یک شناسه، چند حسابِ هم‌رمز → انتخاب حساب توسط کاربر.
	uids := make([]string, 0, len(matched))
	for _, m := range matched {
		uids = append(uids, fmt.Sprintf("%d", m.ID))
	}
	token, err := s.Signer.Sign(ctx, map[string]any{"uids": strings.Join(uids, ","), "ident": clean}, 5*60)
	if err != nil {
		loggerFor().Error("login_choice_sign_failed", map[string]any{"error": err.Error()})
		return &LoginResult{OK: false, Error: msgSignFailed}, nil
	}
	ids := make([]int64, 0, len(matched))
	for _, m := range matched {
		ids = append(ids, m.ID)
	}
	candidates, err := s.candidateSummaries(ctx, ids)
	if err != nil {
		return nil, err
	}
	return &LoginResult{OK: false, NeedChoice: true, Token: token, Candidates: candidates}, nil
}

// ChooseLoginAccount پورت chooseLoginAccount — توکن امضاشدهٔ ۵دقیقه‌ای.
func (s *Service) ChooseLoginAccount(ctx context.Context, w http.ResponseWriter, token string, userID int64, clientIP string) (*SimpleResult, error) {
	if clientIP == "" {
		clientIP = UNKNOWN_CLIENT_IP
	}
	allowed, _, err := s.Rate.Allow(ctx, "choose:"+clientIP, 10, 10*60)
	if err != nil {
		loggerFor().Error("choose_rate_error", map[string]any{"error": err.Error()})
	}
	if !allowed {
		return &SimpleResult{OK: false, Error: msgRateLimitGeneric}, nil
	}

	payload, ok, verr := s.Signer.Verify(ctx, token)
	if !ok || verr != nil {
		// هر خطای امضا/انقضا = «نشست انتخاب حساب منقضی شده» (همان رفتار TS)
		return &SimpleResult{OK: false, Error: msgChooseSignedOut}, nil
	}
	uids := map[int64]bool{}
	if raw, ok := payload["uids"].(string); ok {
		for _, part := range strings.Split(raw, ",") {
			var n int64
			if _, err := fmt.Sscanf(strings.TrimSpace(part), "%d", &n); err == nil && n > 0 {
				uids[n] = true
			}
		}
	}
	if !uids[userID] {
		return &SimpleResult{OK: false, Error: msgChooseInvalidAcc}, nil
	}

	u, err := scanUserRow(s.Pool.QueryRow(ctx, `select `+userSelectColumns+` from users where id = $1`, userID))
	if err != nil {
		return nil, err
	}
	if u == nil || u.IsActive != 1 {
		return &SimpleResult{OK: false, Error: msgChooseInactive}, nil
	}
	mustChange, err := s.IssueSessionFor(ctx, w, userID)
	if err != nil {
		return nil, err
	}
	return &SimpleResult{OK: true, MustChange: mustChange}, nil
}

// ErrMalformedSentinel نگه‌داشتن import errors — خطای امضا در Verify با error
// برمی‌گردد (MALFORMED/BAD_SIGNATURE/EXPIRED) و همه به یک پیام UI تبدیل می‌شوند.
var ErrMalformedSentinel = errors.New("verify")

var _ = ErrMalformedSentinel

// Logout پورت logout(): حذف همهٔ نشست‌های کاربر (خروج از همه‌جا)، حذف
// fallback با توکن، پاک‌کردن قفل بیکاری، و حذف هر دو نام کوکی.
func (s *Service) Logout(ctx context.Context, w http.ResponseWriter, token string) error {
	var me *session.User
	if token != "" {
		me, _ = s.Store.Get(ctx, token, true)
	}
	if me != nil {
		if _, err := s.Pool.Exec(ctx, `delete from sessions where "userId" = $1`, me.ID); err != nil {
			return err
		}
	}
	if token != "" {
		if _, err := s.Pool.Exec(ctx, `delete from sessions where token = $1`, sha256Hex(token)); err != nil {
			return err
		}
	}
	if me != nil {
		s.clearLock(ctx, me.ID)
	}
	s.clearSessionCookies(w)
	return nil
}
