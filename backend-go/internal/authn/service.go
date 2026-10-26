// ═══ تغییر رمز و جابه‌جایی حساب — پورت از auth.ts / account-switch.ts ═══
package authn

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ChangePassword پورت changePassword:
//   - گارد با allowPendingPasswordChange=true (نشستِ mustChange هم اجازهٔ تغییر دارد)
//   - تأیید رمز فعلی (+ واریانت ارقام فارسی)
//   - اعتبارسنجی با پیام‌های عیناً auth.ts
//   - هش تازه + mustChangePassword=0
//   - ابطال همهٔ نشست‌های دیگر کاربر (نشست جاری حفظ می‌شود)
func (s *Service) ChangePassword(ctx context.Context, currentToken, currentPassword, newPassword string) (*SimpleResult, error) {
	me, err := s.Store.Get(ctx, currentToken, true)
	if err != nil {
		return nil, err
	}
	if me == nil {
		return &SimpleResult{OK: false, Error: "برای تغییر رمز ابتدا وارد شوید."}, nil
	}

	u, err := scanUserRow(s.Pool.QueryRow(ctx, `select `+userSelectColumns+` from users where id = $1`, me.ID))
	if err != nil {
		return nil, err
	}
	if u == nil {
		return &SimpleResult{OK: false, Error: msgUserNotFound}, nil
	}

	if !VerifyPasswordIgnoreErr(currentPassword, u.PasswordHash) {
		// اغماض حالت کیبورد: رمز فعلی با ارقام فارسی تایپ شده باشد
		norm := ToEnDigits(currentPassword)
		if norm == currentPassword || !VerifyPasswordIgnoreErr(norm, u.PasswordHash) {
			return &SimpleResult{OK: false, Error: "رمز فعلی نادرست است."}, nil
		}
	}

	trimmed := strings.TrimSpace(newPassword)
	if len([]rune(trimmed)) < 10 {
		return &SimpleResult{OK: false, Error: "رمز جدید باید حداقل ۱۰ کاراکتر باشد."}, nil
	}
	if len([]rune(trimmed)) > 128 {
		return &SimpleResult{OK: false, Error: "رمز جدید باید حداکثر ۱۲۸ کاراکتر باشد."}, nil
	}
	hasLetter, hasDigit := false, false
	for _, r := range trimmed {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') {
			hasLetter = true
		}
		if r >= '0' && r <= '9' {
			hasDigit = true
		}
	}
	if !hasLetter || !hasDigit {
		return &SimpleResult{OK: false, Error: "رمز جدید باید حداقل یک حرف و یک رقم داشته باشد."}, nil
	}
	if trimmed == currentPassword {
		return &SimpleResult{OK: false, Error: "رمز جدید نباید با رمز فعلی یکسان باشد."}, nil
	}

	hash, err := HashPassword(trimmed)
	if err != nil {
		return nil, err
	}
	if _, err := s.Pool.Exec(ctx,
		`update users set "passwordHash" = $1, "mustChangePassword" = 0 where id = $2`, hash, u.ID); err != nil {
		return nil, err
	}

	// ابطال همهٔ نشست‌های دیگر (نشست جاری می‌ماند تا کاربر وسط کار اخراج نشود).
	if _, err := s.Pool.Exec(ctx,
		`delete from sessions where "userId" = $1 and token <> $2`, u.ID, sha256Hex(currentToken)); err != nil {
		return nil, err
	}
	return &SimpleResult{OK: true}, nil
}

// personNCs همهٔ کدملی‌های منتسب به یک کاربر: کدملی خودش + کدملیِ فایل برای
// کدهای پرسنلی‌اش (پورت personNCs در account-switch.ts).
func (s *Service) personNCs(ctx context.Context, userID int64) (map[string]bool, error) {
	out := map[string]bool{}
	var nc *string
	err := s.Pool.QueryRow(ctx, `select "nationalCode" from users where id = $1`, userID).Scan(&nc)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if nc != nil && strings.TrimSpace(*nc) != "" {
		out[strings.TrimSpace(*nc)] = true
	}
	rows, err := s.Pool.Query(ctx, `select "staffCode" from staff where "userId" = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		if mapped, ok := staffNCMap[strings.TrimSpace(code)]; ok {
			out[mapped] = true
		}
	}
	return out, rows.Err()
}

// describeUser پورت describeUser — کد و نوع حساب و عنوان دانشگاه.
func (s *Service) describeUser(ctx context.Context, id int64) (*SiblingAccount, error) {
	u, err := scanUserRow(s.Pool.QueryRow(ctx, `select `+userSelectColumns+` from users where id = $1`, id))
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, nil
	}

	var staffCode *string
	_ = s.Pool.QueryRow(ctx, `select "staffCode" from staff where "userId" = $1 limit 1`, id).Scan(&staffCode)

	code := ""
	kind := "staff"
	if staffCode != nil && *staffCode != "" {
		code = *staffCode
	} else {
		kind = "student"
		var sc string
		err := s.Pool.QueryRow(ctx,
			`select "studentCode" from students where "userId" = $1
			  order by case when status = 'ACTIVE' then 0 else 1 end, id desc limit 1`, id).Scan(&sc)
		if err == nil {
			code = sc
		}
	}
	if code == "" {
		return nil, nil
	}

	var uniTitle *string
	if u.UniversityID != nil {
		var t string
		if err := s.Pool.QueryRow(ctx, `select title from universities where id = $1`, *u.UniversityID).Scan(&t); err == nil {
			uniTitle = &t
		}
	}
	name := strings.TrimSpace(u.FirstName + " " + u.LastName)
	if name == "" {
		name = "—"
	}
	return &SiblingAccount{Kind: kind, Code: code, Name: name, UniversityTitle: uniTitle}, nil
}

// GetSiblingAccounts حساب‌های هم‌شخصِ کاربر جاری (حداکثر ۱۰) — پورت getSiblingAccounts.
func (s *Service) GetSiblingAccounts(ctx context.Context, currentUserID int64) ([]SiblingAccount, error) {
	ncs, err := s.personNCs(ctx, currentUserID)
	if err != nil || len(ncs) == 0 {
		return []SiblingAccount{}, err
	}
	ncList := make([]string, 0, len(ncs))
	for nc := range ncs {
		ncList = append(ncList, nc)
	}

	ids := []int64{}
	seen := map[int64]bool{}
	rows, err := s.Pool.Query(ctx,
		`select id from users where "nationalCode" = any($1) and "isActive" = 1`, ncList)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		if id != currentUserID && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	rows.Close()

	codes := map[string]bool{}
	for nc := range ncs {
		for _, c := range ncToCodes[nc] {
			codes[c] = true
		}
	}
	if len(codes) > 0 {
		codeList := make([]string, 0, len(codes))
		for c := range codes {
			codeList = append(codeList, c)
		}
		rows, err := s.Pool.Query(ctx,
			`select u.id from staff st join users u on u.id = st."userId"
			  where st."staffCode" = any($1) and u."isActive" = 1`, codeList)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			if id != currentUserID && !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
		rows.Close()
	}

	out := []SiblingAccount{}
	for i, id := range ids {
		if i >= 10 {
			break
		}
		d, err := s.describeUser(ctx, id)
		if err == nil && d != nil {
			out = append(out, *d)
		}
	}
	return out, nil
}

// SwitchAccount پورت switchAccountAction: جابه‌جایی به حساب هم‌شخص با رمز همان حساب.
func (s *Service) SwitchAccount(ctx context.Context, w http.ResponseWriter, kind, code, password, currentToken, clientIP string) (*SimpleResult, error) {
	if clientIP == "" {
		clientIP = UNKNOWN_CLIENT_IP
	}
	allowed := true
	if s.Rate != nil {
		var err error
		allowed, _, err = s.Rate.Allow(ctx, "switch:"+clientIP, 10, 10*60)
		if err != nil {
			loggerFor().Error("switch_rate_error", map[string]any{"error": err.Error()})
			allowed = true
		}
	}
	if !allowed {
		return &SimpleResult{OK: false, Error: "تلاش بیش از حد مجاز. چند دقیقه دیگر دوباره تلاش کنید."}, nil
	}

	me, err := s.Store.Get(ctx, currentToken, false)
	if err != nil {
		return nil, err
	}
	if me == nil {
		return &SimpleResult{OK: false, Error: "نشست شما منقضی شده است. دوباره وارد شوید."}, nil
	}
	clean := strings.TrimSpace(code)
	if clean == "" || password == "" {
		return &SimpleResult{OK: false, Error: "کد و رمز را وارد کنید."}, nil
	}

	myNCs, err := s.personNCs(ctx, me.ID)
	if err != nil {
		return nil, err
	}
	if len(myNCs) == 0 {
		return &SimpleResult{OK: false, Error: "حساب دیگری برای شما ثبت نشده است."}, nil
	}

	// کاربر مقصد فقط از روی کد پیدا می‌شود (userId از کلاینت پذیرفته نمی‌شود).
	var target *userRow
	if kind == "staff" {
		target, err = scanUserRow(s.Pool.QueryRow(ctx,
			`select `+userSelectColumnsSuffix()+`
			   from staff st join users u on u.id = st."userId"
			  where st."staffCode" = $1 limit 1`, clean))
	} else {
		target, err = scanUserRow(s.Pool.QueryRow(ctx,
			`select `+userSelectColumnsSuffix()+`
			   from students stu join users u on u.id = stu."userId"
			  where stu."studentCode" = $1 order by u.id limit 1`, clean))
	}
	if err != nil {
		return nil, err
	}
	if target == nil || target.IsActive != 1 {
		return &SimpleResult{OK: false, Error: "حساب مقصد یافت نشد یا غیرفعال است."}, nil
	}
	if target.ID == me.ID {
		return &SimpleResult{OK: false, Error: "همین حساب فعال است."}, nil
	}

	// پیوند هم‌شخصی باید برقرار باشد (کدملی مشترک) — وگرنه جابه‌جایی ممنوع.
	targetNCs, err := s.personNCs(ctx, target.ID)
	if err != nil {
		return nil, err
	}
	linked := false
	for nc := range targetNCs {
		if myNCs[nc] {
			linked = true
			break
		}
	}
	if !linked {
		return &SimpleResult{OK: false, Error: "این حساب به شما پیوند ندارد."}, nil
	}

	if !VerifyPasswordIgnoreErr(password, target.PasswordHash) {
		return &SimpleResult{OK: false, Error: "رمز این حساب نادرست است."}, nil
	}
	mustChange, err := s.IssueSessionFor(ctx, w, target.ID)
	if err != nil {
		return nil, err
	}
	return &SimpleResult{OK: true, MustChange: mustChange}, nil
}

// SiblingAccount حساب هم‌شخص برای بنر «مشاهده با کد دیگر».
type SiblingAccount struct {
	Kind            string  `json:"kind"` // staff | student
	Code            string  `json:"code"`
	Name            string  `json:"name"`
	UniversityTitle *string `json:"universityTitle"`
}

// VerifyPasswordForUser تأیید رمز کاربر جاری برای گیت unlock — پیاده‌سازی
// interface محلی httpapi.PasswordVerifier. کاربر غیرفعال/ناموجود = false.
func (s *Service) VerifyPasswordForUser(ctx context.Context, userID int64, password string) (bool, error) {
	u, err := scanUserRow(s.Pool.QueryRow(ctx, `select `+userSelectColumns+` from users where id = $1`, userID))
	if err != nil {
		return false, err
	}
	if u == nil || u.IsActive != 1 {
		return false, nil
	}
	return VerifyPasswordIgnoreErr(password, u.PasswordHash), nil
}
