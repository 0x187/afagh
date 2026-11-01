// ═══ Teaching-fee payslip objections — port of lib/payroll-objections.ts ═══
package payroll

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ObjectionStatuses objection statuses.
const (
	ObjectionOpen    = "OPEN"
	ObjectionResolved = "RESOLVED"
	ObjectionRejected = "REJECTED"
)

// CreateObjectionInput input for filing a professor objection.
type CreateObjectionInput struct {
	StatementID  int64
	StaffID      int64
	Text         string
	CreatedBy    int64
	UniversityID *int64
}

// CreateObjection records a professor's objection to a payslip — own payslip only, no open duplicate.
func (e *Engine) CreateObjection(ctx context.Context, in CreateObjectionInput) (int64, error) {
	text := strings.TrimSpace(in.Text)
	if len([]rune(text)) < 5 {
		return 0, errors.New("متن اعتراض حداقل ۵ حرف باشد.")
	}
	if len([]rune(text)) > 4000 {
		return 0, errors.New("متن اعتراض حداکثر ۴۰۰۰ حرف.")
	}
	var status string
	var contractStaffID, termID int64
	err := e.Pool.QueryRow(ctx, `
		select ps.status, pc."staffId", pc."termId"
		  from payroll_statements ps
		  join professor_term_contracts pc on pc.id = ps."contractId"
		 where ps.id = $1`, in.StatementID).Scan(&status, &contractStaffID, &termID)
	if err != nil {
		return 0, errors.New("فیش یافت نشد.")
	}
	if contractStaffID != in.StaffID {
		return 0, errors.New("این فیش متعلق به شما نیست.")
	}
	if status == "FINAL_SETTLED" {
		return 0, errors.New("فیش تسویهٔ نهایی شده است؛ اعتراض فقط از طریق واحد مالی.")
	}
	var dup bool
	_ = e.Pool.QueryRow(ctx, `
		select exists(select 1 from payroll_objections where "statementId" = $1 and status = 'OPEN')`,
		in.StatementID).Scan(&dup)
	if dup {
		return 0, errors.New("برای این فیش یک اعتراض باز وجود دارد.")
	}
	var id int64
	if err := e.Pool.QueryRow(ctx, `
		insert into payroll_objections ("statementId","staffId","termId",text,status,"createdBy","universityId")
		values ($1,$2,$3,$4,'OPEN',$5,$6) returning id`,
		in.StatementID, in.StaffID, termID, text, in.CreatedBy, in.UniversityID).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

// StaffObjection objection from the professor's view.
type StaffObjection struct {
	ID                 int64   `json:"id"`
	StatementID        int64   `json:"statementId"`
	TermTitle          *string `json:"termTitle"`
	StatementStatus    *string `json:"statementStatus"`
	Text               string  `json:"text"`
	Status             string  `json:"status"`
	ReviewNote         *string `json:"reviewNote"`
	ReopenedStatement  int     `json:"reopenedStatement"`
	CreatedAt          *string `json:"createdAt"`
}

// ListObjectionsForStaff a professor's objections.
func (e *Engine) ListObjectionsForStaff(ctx context.Context, staffID int64, termID *int64) ([]StaffObjection, error) {
	args := []any{staffID}
	where := ` where o."staffId" = $1`
	if termID != nil {
		args = append(args, *termID)
		where += fmt.Sprintf(` and o."termId" = $%d`, len(args))
	}
	rows, err := e.Pool.Query(ctx, `
		select o.id, o."statementId", t.title, ps.status, o.text, o.status,
		       o."reviewNote", coalesce(o."reopenedStatement",0), o."createdAt"::text
		  from payroll_objections o
		  join payroll_statements ps on ps.id = o."statementId"
		  join academic_terms t on t.id = o."termId"`+where+`
		 order by o."createdAt" desc`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StaffObjection{}
	for rows.Next() {
		var o StaffObjection
		var reopened *int
		if err := rows.Scan(&o.ID, &o.StatementID, &o.TermTitle, &o.StatementStatus, &o.Text,
			&o.Status, &o.ReviewNote, &reopened, &o.CreatedAt); err == nil {
			if reopened != nil {
				o.ReopenedStatement = *reopened
			}
			out = append(out, o)
		}
	}
	return out, nil
}

// OpenObjection open objection from the expert's view.
type OpenObjection struct {
	StaffObjection
	StaffName  string  `json:"staffName"`
	StaffCode  *string `json:"staffCode"`
	GrossAmount *float64 `json:"grossAmount"`
}

// ListOpenObjections open-objection worklist for the expert.
func (e *Engine) ListOpenObjections(ctx context.Context, universityID *int64) ([]OpenObjection, error) {
	args := []any{}
	where := ` where o.status = 'OPEN'`
	if universityID != nil {
		args = append(args, *universityID)
		where += fmt.Sprintf(` and o."universityId" = $%d`, len(args))
	}
	rows, err := e.Pool.Query(ctx, `
		select o.id, o."statementId", t.title, ps.status, o.text, o.status,
		       o."reviewNote", coalesce(o."reopenedStatement",0), o."createdAt"::text,
		       coalesce(u."firstName" || ' ' || u."lastName",''), st."staffCode", ps."grossAmount"::float8
		  from payroll_objections o
		  join payroll_statements ps on ps.id = o."statementId"
		  join academic_terms t on t.id = o."termId"
		  join staff st on st.id = o."staffId"
		  join users u on u.id = st."userId"`+where+`
		 order by o."createdAt" desc limit 100`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OpenObjection{}
	for rows.Next() {
		var o OpenObjection
		var reopened *int
		if err := rows.Scan(&o.ID, &o.StatementID, &o.TermTitle, &o.StatementStatus, &o.Text,
			&o.Status, &o.ReviewNote, &reopened, &o.CreatedAt, &o.StaffName, &o.StaffCode, &o.GrossAmount); err == nil {
			if reopened != nil {
				o.ReopenedStatement = *reopened
			}
			o.StaffName = strings.TrimSpace(o.StaffName)
			if o.StaffName == "" {
				o.StaffName = "—"
			}
			out = append(out, o)
		}
	}
	return out, nil
}

// ReviewObjectionInput review input.
type ReviewObjectionInput struct {
	ID             int64
	Decision       string // RESOLVED | REJECTED
	ReviewNote     string
	Reopen         bool
	ReviewerUserID int64
}

// ReviewObjection port of reviewObjection: approve/reject + optional reopening of the payslip.
// Reopening = returnStatement approval chain (only meaningful for an approved payslip).
func (e *Engine) ReviewObjection(ctx context.Context, a *Approvals, in ReviewObjectionInput) (int64, error) {
	note := strings.TrimSpace(in.ReviewNote)
	if len([]rune(note)) < 3 {
		return 0, errors.New("یادداشت بررسی الزامی است.")
	}
	if in.Decision != ObjectionResolved && in.Decision != ObjectionRejected {
		return 0, errors.New("تصمیم نامعتبر است.")
	}
	var obID, statementID, staffID int64
	var status string
	err := e.Pool.QueryRow(ctx, `
		select id, "statementId", "staffId", status from payroll_objections where id = $1`, in.ID).
		Scan(&obID, &statementID, &staffID, &status)
	if err != nil {
		return 0, errors.New("اعتراض یافت نشد.")
	}
	if status != ObjectionOpen {
		return 0, errors.New("این اعتراض قبلاً بررسی شده است.")
	}
	reopened := 0
	if in.Reopen {
		user := &SessionUser{ID: in.ReviewerUserID}
		if _, err := a.Return(ctx, user, statementID, fmt.Sprintf("بازگشایی از اعتراض #%d: %s", obID, note)); err != nil {
			return 0, err
		}
		reopened = 1
	}
	if _, err := e.Pool.Exec(ctx, `
		update payroll_objections set status = $2, "reviewNote" = $3, "reviewedBy" = $4,
		  "reviewedAt" = $5, "reopenedStatement" = $6 where id = $1`,
		obID, in.Decision, note, in.ReviewerUserID, time.Now(), reopened); err != nil {
		return 0, err
	}
	var userID int64
	_ = e.Pool.QueryRow(ctx, `select "userId" from staff where id = $1`, staffID).Scan(&userID)
	if userID > 0 {
		text := ""
		if in.Decision == ObjectionResolved {
			verb := "ثبت شد"
			if reopened == 1 {
				verb = "فیش برای اصلاح بازگشایی شد"
			}
			text = fmt.Sprintf("اعتراض شما به فیش بررسی و %s: %s", verb, note)
		} else {
			text = fmt.Sprintf("اعتراض شما به فیش وارد تشخیص داده نشد: %s", note)
		}
		e.notify(ctx, userID, mapEvent(in.Decision), text)
	}
	return obID, nil
}

func mapEvent(decision string) string {
	if decision == ObjectionResolved {
		return "PAYROLL_OBJECTION_RESOLVED"
	}
	return "PAYROLL_OBJECTION_REJECTED"
}

// ObjectionHistoryRow objection history (expert worklist).
type ObjectionHistoryRow struct {
	StaffObjection
	StaffName string   `json:"staffName"`
	StaffCode *string  `json:"staffCode"`
}

// ListObjectionsHistory all objections (latest 100).
func (e *Engine) ListObjectionsHistory(ctx context.Context, universityID *int64) ([]ObjectionHistoryRow, error) {
	args := []any{}
	where := ""
	if universityID != nil {
		where = ` where o."universityId" = $1`
		args = append(args, *universityID)
	}
	rows, err := e.Pool.Query(ctx, `
		select o.id, o."statementId", t.title, ps.status, o.text, o.status,
		       o."reviewNote", coalesce(o."reopenedStatement",0), o."createdAt"::text,
		       coalesce(u."firstName" || ' ' || u."lastName",''), st."staffCode"
		  from payroll_objections o
		  join payroll_statements ps on ps.id = o."statementId"
		  join academic_terms t on t.id = o."termId"
		  join staff st on st.id = o."staffId"
		  join users u on u.id = st."userId"`+where+`
		 order by o."createdAt" desc limit 100`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ObjectionHistoryRow{}
	for rows.Next() {
		var h ObjectionHistoryRow
		var reopened *int
		if err := rows.Scan(&h.ID, &h.StatementID, &h.TermTitle, &h.StatementStatus, &h.Text,
			&h.Status, &h.ReviewNote, &reopened, &h.CreatedAt, &h.StaffName, &h.StaffCode); err == nil {
			if reopened != nil {
				h.ReopenedStatement = *reopened
			}
			h.StaffName = strings.TrimSpace(h.StaffName)
			if h.StaffName == "" {
				h.StaffName = "—"
			}
			out = append(out, h)
		}
	}
	return out, nil
}
