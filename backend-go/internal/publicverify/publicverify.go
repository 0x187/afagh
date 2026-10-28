// ═══ موتور استعلام عمومی — پورت verifyTranscript/verifyFinance/... ═══
//
//  توکن‌های امضاشده (T1.<payload>.<sig>) — هر پاسخ فقط از پایگاه داده؛
//  توکن ناشناخته/منقضی صریحاً «یافت نشد» است (هیچ fallback ساختگی).
//  کد ملی همیشه ماسک‌شده (۳ رقم اول + ۵ ستاره + ۲ رقم آخر).
package publicverify

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/student"
	"backend-go/internal/verification"
)

// Service سرویس استعلام عمومی.
type Service struct {
	Student *student.Service
	Signer  *verification.Signer
	Pool    *pgxpool.Pool
}

// Result پاسخ استعلام.
type Result struct {
	OK      bool   `json:"ok"`
	Kind    string `json:"kind,omitempty"`
	Reason  string `json:"reason,omitempty"`
	Message string `json:"message,omitempty"`
	Doc     any    `json:"doc,omitempty"`
}

// MaskNationalCode ماسک با طول ثابت خروجی.
func MaskNationalCode(code *string) string {
	if code == nil {
		return "—"
	}
	c := []rune(*code)
	if len(c) <= 5 {
		return "*****"
	}
	return string(c[:3]) + "*****" + string(c[len(c)-2:])
}

func bad(reason, message string) *Result {
	return &Result{OK: false, Reason: reason, Message: message}
}

// resolveStudent پروندهٔ هدف توکن: sid (همان شخص) ← uid (ACTIVE-first).
func (s *Service) resolveStudent(ctx context.Context, payload map[string]any) (int64, int64, error) {
	uid := toInt(payload["uid"])
	sid := toInt(payload["sid"])
	if uid <= 0 {
		return 0, 0, errors.New("no uid")
	}
	if sid > 0 {
		var userID int64
		err := s.Pool.QueryRow(ctx, `
			select st."userId" from students st
			 where st.id = $1 and (st."userId" = $2 or exists(
			   select 1 from users u2 where u2.id = st."userId" and u2."nationalCode" = (
			     select "nationalCode" from users where id = $2)))`, sid, uid).Scan(&userID)
		if err == nil {
			return sid, userID, nil
		}
	}
	var picked int64
	err := s.Pool.QueryRow(ctx, `
		select id from students where "userId" = $1
		 order by case when status = 'ACTIVE' then 0 else 1 end,
		          (select count(*) from enrollments e where e."studentId" = students.id) desc,
		          id desc
		 limit 1`, uid).Scan(&picked)
	if err != nil {
		return 0, 0, err
	}
	return picked, uid, nil
}

func toInt(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	case string:
		var out int64
		for _, r := range n {
			if r < '0' || r > '9' {
				break
			}
			out = out*10 + int64(r-'0')
		}
		return out
	}
	return 0
}

// Verify بررسی توکن و تولید سند متناظر.
func (s *Service) Verify(ctx context.Context, rawToken string) *Result {
	payload, ok, err := s.Signer.Verify(ctx, rawToken)
	if err != nil || !ok {
		switch {
		case errors.Is(err, verification.ErrExpired):
			return bad("EXPIRED", "این توکن منقضی شده است؛ سند تازه را از سامانه بگیرید.")
		case errors.Is(err, verification.ErrMalformed), errors.Is(err, verification.ErrBadSignature):
			return bad("BAD_TOKEN", "توکن نامعتبر یا دستکاری‌شده است.")
		case err != nil:
			// کلید امضا تنظیم نشده یا خطای پیکربندی — fail-closed
			return bad("BAD_TOKEN", "استعلام در حال حاضر ممکن نیست؛ امضای توکن قابل بررسی نیست.")
		default:
			return bad("BAD_TOKEN", "توکن نامعتبر یا دستکاری‌شده است.")
		}
	}
	kind, _ := payload["kind"].(string)
	studentID, userID, err := s.resolveStudent(ctx, payload)
	if err != nil {
		return bad("NOT_FOUND", "دانشجویی با این توکن یافت نشد.")
	}
	switch kind {
	case "TRANSCRIPT":
		var fullName string
		_ = s.Pool.QueryRow(ctx, `select coalesce("firstName" || ' ' || "lastName",'') from users where id = $1`, userID).Scan(&fullName)
		doc, err := s.Student.GetTranscript(ctx, userID, fullName, &studentID, nil, "")
		if err != nil {
			return bad("EMPTY", "محاسبهٔ کارنامهٔ تحصیلی برای این دانشجو ممکن نشد.")
		}
		return &Result{OK: true, Kind: kind, Doc: doc}
	case "FINANCE_STMT":
		doc, err := s.Student.GetFinanceByStudentID(ctx, studentID, nil)
		if err != nil {
			return bad("NOT_FOUND", "اطلاعات مالی این دانشجو یافت نشد.")
		}
		masked := MaskNationalCode(doc.Student.NationalCode)
		doc.Student.NationalCode = &masked
		return &Result{OK: true, Kind: kind, Doc: doc}
	case "ENROLL_CONFIRM":
		termID := toInt(payload["term"])
		var cookie *int64
		if termID > 0 {
			cookie = &termID
		}
		doc, err := s.Student.GetEnrollConfirm(ctx, userID, cookie, "")
		if err != nil {
			return bad("NOT_FOUND", "تأییدیهٔ انتخاب واحد یافت نشد.")
		}
		return &Result{OK: true, Kind: kind, Doc: doc}
	case "EXAM":
		doc, err := s.Student.GetExamCard(ctx, userID, nil, "")
		if err != nil {
			return bad("NOT_FOUND", "کارت آزمون یافت نشد.")
		}
		return &Result{OK: true, Kind: kind, Doc: doc}
	}
	return bad("BAD_TOKEN", "نوع توکن با هیچ سند استعلامی هم‌خوانی ندارد.")
}
