// ═══ ضرایب نیمسال + مبالغ موضوعی (نوع + تخصیص) — پورت finance/coefficients و subject-fees ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"backend-go/internal/session"
)

// ─────────────────── ضریب افزایشی نیمسال ───────────────────

// SaveCoefficientInput ورودی upsert ضریب.
type SaveCoefficientInput struct {
	TermID            int64   `json:"termId"`
	VariableCoefficient float64 `json:"variableCoefficient"`
	FixedCoefficient  float64 `json:"fixedCoefficient"`
	Note              string  `json:"note"`
}

// SaveCoefficient پورت POST finance/coefficients — upsert با سقف تغییر ±۲۰٪.
func (s *Service) SaveCoefficient(ctx context.Context, user *session.User, uniCookie string, in SaveCoefficientInput) (int64, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال نامشخص است")
	}
	if in.TermID <= 0 {
		return 0, errors.New("ترم الزامی است")
	}
	if in.VariableCoefficient < 0.5 || in.VariableCoefficient > 5 {
		return 0, errors.New("ضریب متغیر باید بین ۰.۵۰ تا ۵.۰۰ باشد")
	}
	if in.FixedCoefficient < 0.5 || in.FixedCoefficient > 5 {
		return 0, errors.New("ضریب ثابت باید بین ۰.۵۰ تا ۵.۰۰ باشد")
	}
	var termUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from academic_terms where id = $1`, in.TermID).Scan(&termUni); err != nil {
		return 0, errors.New("ترم یافت نشد")
	}
	if termUni != nil && *termUni != *uniID {
		return 0, errors.New("ترم متعلق به دانشگاه دیگری است")
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var existingID int64
	var oldV, oldF *float64
	err = tx.QueryRow(ctx, `
		select id, "variable_coefficient"::float8, "fixed_coefficient"::float8
		  from tuition_coefficients
		 where "termId" = $1 and ("universityId" = $2 or "universityId" is null)
		 limit 1 for update`, in.TermID, *uniID).Scan(&existingID, &oldV, &oldF)
	if err == nil {
		for _, pair := range []struct {
			label string
			old   *float64
			newV  float64
		}{
			{"متغیر", oldV, in.VariableCoefficient},
			{"ثابت", oldF, in.FixedCoefficient},
		} {
			if pair.old != nil && *pair.old > 0 {
				ratio := pair.newV / *pair.old
				if ratio < 0.8 || ratio > 1.2 {
					return 0, fmt.Errorf("تغییر ضریب %s در هر مرحله حداکثر ±۲۰٪ مجاز است (مقدار فعلی %s)؛ برای تغییر بزرگ‌تر در چند مرحله اقدام کنید",
						pair.label, formatNum(*pair.old))
				}
			}
		}
		if _, err := tx.Exec(ctx, `
			update tuition_coefficients set "variable_coefficient" = $2, "fixed_coefficient" = $3,
			  note = $4, "updated_at" = now()
			 where id = $1 and ("universityId" = $5 or "universityId" is null)`,
			existingID, fmtNum(in.VariableCoefficient), fmtNum(in.FixedCoefficient), cleanStr(in.Note), *uniID); err != nil {
			return 0, err
		}
		details := fmt.Sprintf(`{"termId":%d,"oldV":%s,"oldF":%s,"newV":%s,"newF":%s}`,
			in.TermID, ptrNum(oldV), ptrNum(oldF), fmtNum(in.VariableCoefficient), fmtNum(in.FixedCoefficient))
		if err := s.writeAdminAuditTx(ctx, tx, user.ID, "FINANCE_COEFFICIENT_UPDATED", "tuition_coefficients", existingID, details); err != nil {
			return 0, err
		}
		if err := tx.Commit(ctx); err != nil {
			return 0, err
		}
		return existingID, nil
	}

	var id int64
	if err := tx.QueryRow(ctx, `
		insert into tuition_coefficients ("universityId","termId","variable_coefficient","fixed_coefficient",note)
		values ($1,$2,$3,$4,$5) returning id`,
		*uniID, in.TermID, fmtNum(in.VariableCoefficient), fmtNum(in.FixedCoefficient), cleanStr(in.Note)).Scan(&id); err != nil {
		return 0, errors.New("خطا در ذخیرهٔ ضریب")
	}
	details := fmt.Sprintf(`{"termId":%d,"newV":%s,"newF":%s}`, in.TermID, fmtNum(in.VariableCoefficient), fmtNum(in.FixedCoefficient))
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "FINANCE_COEFFICIENT_CREATED", "tuition_coefficients", id, details); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return id, nil
}

func ptrNum(v *float64) string {
	if v == nil {
		return "null"
	}
	return fmtNum(*v)
}

func formatNum(v float64) string {
	if v == mathTrunc(v) {
		return strconv.FormatInt(int64(v), 10)
	}
	return fmtNum(v)
}

func mathTrunc(v float64) float64 {
	return float64(int64(v))
}

// DeleteCoefficient حذف ضریب (دامنهٔ دانشگاه).
func (s *Service) DeleteCoefficient(ctx context.Context, user *session.User, uniCookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است")
	}
	var rowUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from tuition_coefficients where id = $1`, id).Scan(&rowUni); err != nil {
		return errors.New("رکورد یافت نشد")
	}
	if rowUni != nil && *rowUni != *uniID {
		return errors.New("رکورد متعلق به دانشگاه دیگری است")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		delete from tuition_coefficients where id = $1 and ("universityId" = $2 or "universityId" is null)`, id, *uniID)
	return err
}

// ─────────────────── مبالغ موضوعی: نوع ───────────────────

// SubjectFeeKindInput ورودی ذخیرهٔ نوع مبلغ موضوعی.
type SubjectFeeKindInput struct {
	ID              int64   `json:"id"`
	Code            string  `json:"code"`
	Title           string  `json:"title"`
	Kind            string  `json:"kind"`
	FixedAmount     float64 `json:"fixedAmount"`
	VariablePercent float64 `json:"variablePercent"`
	AppliesTo       string  `json:"appliesTo"`
	IsActive        bool    `json:"isActive"`
	Note            string  `json:"note"`
}

var feeKinds = map[string]bool{"ADDITIVE": true, "DEDUCTIVE": true}
var feeAppliesTo = map[string]bool{"BOTH": true, "FIXED": true, "VARIABLE": true}

// SaveSubjectFeeType پورت POST finance/subject-fees (ایجاد/ویرایش + audit).
func (s *Service) SaveSubjectFeeType(ctx context.Context, user *session.User, uniCookie string, in SubjectFeeKindInput) (int64, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال نامشخص است")
	}
	if strings.TrimSpace(in.Code) == "" || strings.TrimSpace(in.Title) == "" {
		return 0, errors.New("کد و عنوان الزامی است")
	}
	if len(in.Code) > 40 || len([]rune(in.Title)) > 150 {
		return 0, errors.New("طول کد یا عنوان بیش از حد مجاز است")
	}
	kind := in.Kind
	if kind == "" {
		kind = "ADDITIVE"
	}
	if !feeKinds[kind] {
		return 0, errors.New("نوع مبلغ موضوعی نامعتبر است")
	}
	appliesTo := in.AppliesTo
	if appliesTo == "" {
		appliesTo = "BOTH"
	}
	if !feeAppliesTo[appliesTo] {
		return 0, errors.New("محدودهٔ اعمال نامعتبر است")
	}
	if in.VariablePercent < 0 || in.VariablePercent > 100 {
		return 0, errors.New("درصد متغیر باید بین ۰ تا ۱۰۰ باشد")
	}
	if in.FixedAmount < 0 || in.FixedAmount > 10_000_000_000 {
		return 0, errors.New("مبلغ ثابت باید عدد صحیح ریال بین ۰ تا ۱۰٬۰۰۰٬۰۰۰٬۰۰۰ باشد")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if in.ID > 0 {
		var rowUni *int64
		if err := tx.QueryRow(ctx, `select "universityId" from subject_fee_types where id = $1`, in.ID).Scan(&rowUni); err != nil {
			return 0, errors.New("رکورد یافت نشد")
		}
		if rowUni != nil && *rowUni != *uniID {
			return 0, errors.New("رکورد متعلق به دانشگاه دیگری است")
		}
		if _, err := tx.Exec(ctx, `
			update subject_fee_types set code = $2, title = $3, kind = $4, "fixed_amount" = $5,
			  "variable_percent" = $6, "applies_to" = $7, "is_active" = $8, note = $9
			 where id = $1 and ("universityId" = $10 or "universityId" is null)`,
			in.ID, strings.TrimSpace(in.Code), strings.TrimSpace(in.Title), kind, fmtNum(in.FixedAmount),
			fmtNum(in.VariablePercent), appliesTo, boolToDigit(in.IsActive), cleanStr(in.Note), *uniID); err != nil {
			return 0, err
		}
		details := fmt.Sprintf(`{"code":%q,"kind":%q,"appliesTo":%q,"fixedAmount":%s}`,
			in.Code, kind, appliesTo, fmtNum(in.FixedAmount))
		if err := s.writeAdminAuditTx(ctx, tx, user.ID, "FINANCE_SUBJECT_FEE_TYPE_UPDATED", "subject_fee_types", in.ID, details); err != nil {
			return 0, err
		}
		if err := tx.Commit(ctx); err != nil {
			return 0, err
		}
		return in.ID, nil
	}
	var id int64
	if err := tx.QueryRow(ctx, `
		insert into subject_fee_types ("universityId",code,title,kind,"fixed_amount","variable_percent","applies_to","is_active",note)
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
		*uniID, strings.TrimSpace(in.Code), strings.TrimSpace(in.Title), kind, fmtNum(in.FixedAmount),
		fmtNum(in.VariablePercent), appliesTo, boolToDigit(in.IsActive), cleanStr(in.Note)).Scan(&id); err != nil {
		return 0, err
	}
	details := fmt.Sprintf(`{"code":%q,"kind":%q,"appliesTo":%q,"fixedAmount":%s}`,
		in.Code, kind, appliesTo, fmtNum(in.FixedAmount))
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "FINANCE_SUBJECT_FEE_TYPE_CREATED", "subject_fee_types", id, details); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return id, nil
}

// DeleteSubjectFeeType حذف نوع — ممنوع اگر به دانشجو تخصیص یافته.
func (s *Service) DeleteSubjectFeeType(ctx context.Context, user *session.User, uniCookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است")
	}
	var assigned bool
	_ = s.DB.Pool.QueryRow(ctx, `select exists(select 1 from student_subject_fees where subject_fee_type_id = $1)`, id).Scan(&assigned)
	if assigned {
		return errors.New("این نوع مبلغ به دانشجویان تخصیص یافته و قابل حذف نیست")
	}
	var rowUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from subject_fee_types where id = $1`, id).Scan(&rowUni); err != nil {
		return errors.New("رکورد یافت نشد")
	}
	if rowUni != nil && *rowUni != *uniID {
		return errors.New("رکورد متعلق به دانشگاه دیگری است")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		delete from subject_fee_types where id = $1 and ("universityId" = $2 or "universityId" is null)`, id, *uniID); err != nil {
		return err
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "FINANCE_SUBJECT_FEE_TYPE_DELETED", "subject_fee_types", id,
		fmt.Sprintf(`{"subjectFeeTypeId":%d}`, id)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─────────────────── مبالغ موضوعی: تخصیص به دانشجو ───────────────────

// SubjectFeeAssignment ردیف تخصیص.
type SubjectFeeAssignment struct {
	ID         int64   `json:"id"`
	StudentID  int64   `json:"studentId"`
	TermID     int64   `json:"termId"`
	TypeID     int64   `json:"subjectFeeTypeId"`
	Amount     float64 `json:"amount"`
	IsActive   bool    `json:"isActive"`
	Note       *string `json:"note"`
	TypeCode   string  `json:"typeCode"`
	TypeTitle  string  `json:"typeTitle"`
	TypeKind   string  `json:"typeKind"`
}

// ListSubjectFeeAssignments پورت GET assign.
func (s *Service) ListSubjectFeeAssignments(ctx context.Context, user *session.User, uniCookie string, studentID, termID int64) ([]SubjectFeeAssignment, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است")
	}
	if studentID <= 0 {
		return nil, errors.New("studentId الزامی است")
	}
	var stuUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, studentID).Scan(&stuUni); err != nil {
		return nil, errors.New("دانشجو یافت نشد")
	}
	if stuUni != nil && *stuUni != *uniID {
		return nil, errors.New("دانشجو متعلق به دانشگاه دیگری است")
	}
	args := []any{studentID, *uniID}
	where := ` where s.student_id = $1 and (s."universityId" = $2 or s."universityId" is null)`
	if termID > 0 {
		args = append(args, termID)
		where += ` and s.term_id = $3`
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select s.id, s.student_id, s.term_id, s.subject_fee_type_id, s.amount::float8, s.is_active, s.note,
		       t.code, t.title, coalesce(t.kind,'')
		  from student_subject_fees s
		  join subject_fee_types t on t.id = s.subject_fee_type_id`+where+`
		 order by s.id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SubjectFeeAssignment{}
	for rows.Next() {
		var a SubjectFeeAssignment
		var active *int
		if err := rows.Scan(&a.ID, &a.StudentID, &a.TermID, &a.TypeID, &a.Amount, &active, &a.Note,
			&a.TypeCode, &a.TypeTitle, &a.TypeKind); err == nil {
			a.IsActive = active != nil && *active == 1
			out = append(out, a)
		}
	}
	return out, nil
}

// AssignSubjectFeeInput ورودی تخصیص.
type AssignSubjectFeeInput struct {
	StudentID int64   `json:"studentId"`
	TermID    int64   `json:"termId"`
	TypeID    int64   `json:"subjectFeeTypeId"`
	Amount    float64 `json:"amount"`
	Note      string  `json:"note"`
}

// AssignSubjectFee پورت POST assign — upsert با اعتبارسنجی سخت‌گیرانهٔ ریال.
func (s *Service) AssignSubjectFee(ctx context.Context, user *session.User, uniCookie string, in AssignSubjectFeeInput) (int64, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال نامشخص است")
	}
	if in.StudentID <= 0 || in.TermID <= 0 || in.TypeID <= 0 {
		return 0, errors.New("دانشجو، ترم و نوع مبلغ الزامی است")
	}
	if in.Amount <= 0 || in.Amount != float64(int64(in.Amount)) {
		return 0, errors.New("مبلغ نامعتبر است؛ مبلغ باید عدد صحیح مثبت (ریال) باشد")
	}
	var stuUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, in.StudentID).Scan(&stuUni); err != nil {
		return 0, errors.New("دانشجو یافت نشد")
	}
	if stuUni != nil && *stuUni != *uniID {
		return 0, errors.New("دانشجو متعلق به دانشگاه دیگری است")
	}
	var typeUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from subject_fee_types where id = $1`, in.TypeID).Scan(&typeUni); err != nil {
		return 0, errors.New("نوع مبلغ موضوعی یافت نشد")
	}
	if typeUni != nil && *typeUni != *uniID {
		return 0, errors.New("نوع مبلغ متعلق به دانشگاه دیگری است")
	}
	var termUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from academic_terms where id = $1`, in.TermID).Scan(&termUni); err != nil {
		return 0, errors.New("ترم یافت نشد")
	}
	if termUni != nil && *termUni != *uniID {
		return 0, errors.New("ترم متعلق به دانشگاه دیگری است")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var existingID int64
	err = tx.QueryRow(ctx, `
		select id from student_subject_fees
		 where student_id = $1 and term_id = $2 and subject_fee_type_id = $3
		   and ("universityId" = $4 or "universityId" is null)
		 limit 1 for update`, in.StudentID, in.TermID, in.TypeID, *uniID).Scan(&existingID)
	if err == nil {
		if _, err := tx.Exec(ctx, `
			update student_subject_fees set amount = $2, note = $3, is_active = 1 where id = $1`,
			existingID, fmtNum(in.Amount), cleanStr(in.Note)); err != nil {
			return 0, err
		}
		details := fmt.Sprintf(`{"studentId":%d,"termId":%d,"subjectFeeTypeId":%d,"amount":%s}`,
			in.StudentID, in.TermID, in.TypeID, fmtNum(in.Amount))
		if err := s.writeAdminAuditTx(ctx, tx, user.ID, "FINANCE_SUBJECT_FEE_UPDATED", "student_subject_fees", existingID, details); err != nil {
			return 0, err
		}
		if err := tx.Commit(ctx); err != nil {
			return 0, err
		}
		return existingID, nil
	}
	var id int64
	if err := tx.QueryRow(ctx, `
		insert into student_subject_fees ("universityId",student_id,term_id,subject_fee_type_id,amount,note)
		values ($1,$2,$3,$4,$5,$6) returning id`,
		*uniID, in.StudentID, in.TermID, in.TypeID, fmtNum(in.Amount), cleanStr(in.Note)).Scan(&id); err != nil {
		return 0, err
	}
	details := fmt.Sprintf(`{"studentId":%d,"termId":%d,"subjectFeeTypeId":%d,"amount":%s}`,
		in.StudentID, in.TermID, in.TypeID, fmtNum(in.Amount))
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "FINANCE_SUBJECT_FEE_ASSIGNED", "student_subject_fees", id, details); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return id, nil
}

// DeleteSubjectFeeAssignment حذف تخصیص.
func (s *Service) DeleteSubjectFeeAssignment(ctx context.Context, user *session.User, uniCookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است")
	}
	var rowUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from student_subject_fees where id = $1`, id).Scan(&rowUni); err != nil {
		return errors.New("رکورد یافت نشد")
	}
	if rowUni != nil && *rowUni != *uniID {
		return errors.New("رکورد متعلق به دانشگاه دیگری است")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		delete from student_subject_fees where id = $1 and ("universityId" = $2 or "universityId" is null)`, id, *uniID)
	return err
}

// CoefficientRow ردیف ضریب نیمسال.
type CoefficientRow struct {
	ID                  int64   `json:"id"`
	TermID              *int64  `json:"termId"`
	VariableCoefficient float64 `json:"variableCoefficient"`
	FixedCoefficient    float64 `json:"fixedCoefficient"`
	Note                *string `json:"note"`
	UpdatedAt           *string `json:"updatedAt"`
	TermTitle           *string `json:"termTitle"`
	TermCode            *string `json:"termCode"`
}

// ListCoefficients پورت GET finance/coefficients.
func (s *Service) ListCoefficients(ctx context.Context, user *session.User, uniCookie string) ([]CoefficientRow, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return []CoefficientRow{}, nil
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select c.id, c."termId", c."variable_coefficient"::float8, c."fixed_coefficient"::float8,
		       c.note, c."updated_at"::text, t.title, t."termCode"
		  from tuition_coefficients c
		  left join academic_terms t on t.id = c."termId"
		 where (c."universityId" = $1 or c."universityId" is null)
		 order by c.id`, *uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CoefficientRow{}
	for rows.Next() {
		var r CoefficientRow
		if err := rows.Scan(&r.ID, &r.TermID, &r.VariableCoefficient, &r.FixedCoefficient,
			&r.Note, &r.UpdatedAt, &r.TermTitle, &r.TermCode); err == nil {
			out = append(out, r)
		}
	}
	return out, nil
}

// SubjectFeeTypeRow نوع مبلغ موضوعی.
type SubjectFeeTypeRow struct {
	ID              int64   `json:"id"`
	Code            string  `json:"code"`
	Title           string  `json:"title"`
	Kind            string  `json:"kind"`
	FixedAmount     float64 `json:"fixedAmount"`
	VariablePercent float64 `json:"variablePercent"`
	AppliesTo       *string `json:"appliesTo"`
	IsActive        bool    `json:"isActive"`
	Note            *string `json:"note"`
}

// ListSubjectFeeTypes پورت GET finance/subject-fees.
func (s *Service) ListSubjectFeeTypes(ctx context.Context, user *session.User, uniCookie string) ([]SubjectFeeTypeRow, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return []SubjectFeeTypeRow{}, nil
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, coalesce(code,''), coalesce(title,''), coalesce(kind,'ADDITIVE'),
		       "fixed_amount"::float8, "variable_percent"::float8, "applies_to", "is_active", note
		  from subject_fee_types
		 where ("universityId" = $1 or "universityId" is null) order by id`, *uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SubjectFeeTypeRow{}
	for rows.Next() {
		var r SubjectFeeTypeRow
		var active *int
		if err := rows.Scan(&r.ID, &r.Code, &r.Title, &r.Kind, &r.FixedAmount, &r.VariablePercent,
			&r.AppliesTo, &active, &r.Note); err == nil {
			r.IsActive = active != nil && *active == 1
			out = append(out, r)
		}
	}
	return out, nil
}
