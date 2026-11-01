// ═══ Student-specific formula (student_tuition_overrides) — admin/finance/student-formula port ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"backend-go/internal/session"
)

// TuitionOverride special formula row.
type TuitionOverride struct {
	ID            int64   `json:"id"`
	StudentID     int64   `json:"studentId"`
	StudentCode   string  `json:"studentCode"`
	StudentName   string  `json:"studentName"`
	TermID        *int64  `json:"termId"`
	TermTitle     string  `json:"termTitle"`
	FixedAmount   float64 `json:"fixedAmount"`
	PerUnitAmount float64 `json:"perUnitAmount"`
	Reason        *string `json:"reason"`
	IsActive      bool    `json:"isActive"`
	CreatedAt     *string `json:"createdAt"`
	UpdatedAt     *string `json:"updatedAt"`
}

// ListTuitionOverrides GET port (q/studentId/active/page).
func (s *Service) ListTuitionOverrides(ctx context.Context, user *session.User, uniCookie, q string, studentID int64, activeOnly bool, page int) ([]TuitionOverride, int, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return []TuitionOverride{}, 0, nil
	}
	if page < 1 {
		page = 1
	}
	args := []any{*uniID}
	where := ` where (o."universityId" = $1 or o."universityId" is null)`
	if studentID > 0 {
		args = append(args, studentID)
		where += fmt.Sprintf(` and o."studentId" = $%d`, len(args))
	}
	if activeOnly {
		where += ` and o."isActive" = 1`
	}
	if q = strings.TrimSpace(q); q != "" {
		like := "%" + q + "%"
		args = append(args, like, q)
		where += fmt.Sprintf(` and (st."studentCode" = $%d or (u."firstName" || ' ' || u."lastName") like $%d escape '\')`, len(args)-1, len(args))
	}
	var total int
	if err := s.DB.Pool.QueryRow(ctx, `
		select count(*)::int from student_tuition_overrides o
		  join students st on st.id = o."studentId"
		  join users u on u.id = st."userId"`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, 50, (page-1)*50)
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, o."studentId", st."studentCode",
		       coalesce(u."firstName" || ' ' || u."lastName",''),
		       o."termId", o."fixedAmount"::float8, o."perUnitAmount"::float8,
		       o.reason, o."isActive", o."createdAt"::text, o."updatedAt"::text
		  from student_tuition_overrides o
		  join students st on st.id = o."studentId"
		  join users u on u.id = st."userId"`+where+`
		 order by o.id desc limit $`+fmt.Sprintf("%d", len(args)-1)+` offset $`+fmt.Sprintf("%d", len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []TuitionOverride{}
	for rows.Next() {
		var r TuitionOverride
		var active *int
		if err := rows.Scan(&r.ID, &r.StudentID, &r.StudentCode, &r.StudentName, &r.TermID,
			&r.FixedAmount, &r.PerUnitAmount, &r.Reason, &active, &r.CreatedAt, &r.UpdatedAt); err == nil {
			r.StudentName = strings.TrimSpace(r.StudentName)
			r.IsActive = active != nil && *active == 1
			if r.TermID == nil {
				r.TermTitle = "همهٔ ترم‌ها"
			} else {
				var title string
				if err := s.DB.Pool.QueryRow(ctx, `select title from academic_terms where id = $1`, *r.TermID).Scan(&title); err == nil {
					r.TermTitle = title
				} else {
					r.TermTitle = fmt.Sprintf("#%d", *r.TermID)
				}
			}
			out = append(out, r)
		}
	}
	return out, total, nil
}

// deactivateConflicts deactivate conflicting active formulas (same student + same term scope).
func (s *Service) deactivateConflicts(ctx context.Context, tx execer, studentID int64, termID *int64, exceptID int64) error {
	args := []any{studentID}
	where := ` where "studentId" = $1 and "isActive" = 1`
	if termID == nil {
		where += ` and "termId" is null`
	} else {
		args = append(args, *termID)
		where += fmt.Sprintf(` and "termId" = $%d`, len(args))
	}
	if exceptID > 0 {
		args = append(args, exceptID)
		where += fmt.Sprintf(` and id <> $%d`, len(args))
	}
	_, err := tx.Exec(ctx, `update student_tuition_overrides set "isActive" = 0, "updatedAt" = now()`+where, args...)
	return err
}

type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func (t *txExec) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return t.tx.Exec(ctx, sql, args...)
}

// txExec pgx.Tx adapter for execer.
type txExec struct{ tx pgx.Tx }

// SaveTuitionOverrideInput create input.
type SaveTuitionOverrideInput struct {
	StudentID     int64   `json:"studentId"`
	TermID        *int64  `json:"termId"`
	FixedAmount   float64 `json:"fixedAmount"`
	PerUnitAmount float64 `json:"perUnitAmount"`
	Reason        *string `json:"reason"`
}

const maxOverrideRials = 9_999_999_999_999

// CreateTuitionOverride POST port — deactivate conflicts + audit.
func (s *Service) CreateTuitionOverride(ctx context.Context, user *session.User, uniCookie string, in SaveTuitionOverrideInput) (int64, error) {
	if in.StudentID <= 0 {
		return 0, errors.New("invalid_body")
	}
	if in.FixedAmount < 0 || in.FixedAmount > maxOverrideRials || in.PerUnitAmount < 0 || in.PerUnitAmount > maxOverrideRials {
		return 0, errors.New("invalid_body")
	}
	if in.FixedAmount == 0 && in.PerUnitAmount == 0 {
		return 0, errors.New("zero_formula")
	}
	if in.Reason != nil && len([]rune(*in.Reason)) > 2000 {
		return 0, errors.New("invalid_body")
	}
	var exists bool
	if err := s.DB.Pool.QueryRow(ctx, `select exists(select 1 from students where id = $1)`, in.StudentID).Scan(&exists); err != nil || !exists {
		return 0, errors.New("student_not_found")
	}
	if in.TermID != nil {
		if err := s.DB.Pool.QueryRow(ctx, `select exists(select 1 from academic_terms where id = $1)`, *in.TermID).Scan(&exists); err != nil || !exists {
			return 0, errors.New("term_not_found")
		}
	}
	uniID := s.UniversityID(ctx, user, uniCookie)
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if err := s.deactivateConflicts(ctx, &txExec{tx}, in.StudentID, in.TermID, 0); err != nil {
		return 0, err
	}
	reason := trimmedPtr(in.Reason)
	var id int64
	if err := tx.QueryRow(ctx, `
		insert into student_tuition_overrides ("studentId","termId","fixedAmount","perUnitAmount",reason,"isActive","createdBy","universityId")
		values ($1,$2,$3,$4,$5,1,$6,$7) returning id`,
		in.StudentID, in.TermID, fmtNum(in.FixedAmount), fmtNum(in.PerUnitAmount), reason, user.ID, uniID).Scan(&id); err != nil {
		return 0, err
	}
	details := fmt.Sprintf(`{"studentId":%d,"termId":%s,"fixedAmount":%s,"perUnitAmount":%s}`,
		in.StudentID, ptrNumInt(in.TermID), fmtNum(in.FixedAmount), fmtNum(in.PerUnitAmount))
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "TUITION_OVERRIDE_CREATED", "student_tuition_overrides", id, details); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return id, nil
}

// UpdateTuitionOverrideInput PATCH input — all fields are optional.
type UpdateTuitionOverrideInput struct {
	TermID        **int64  `json:"termId"`
	FixedAmount   *float64 `json:"fixedAmount"`
	PerUnitAmount *float64 `json:"perUnitAmount"`
	Reason        **string `json:"reason"`
	IsActive      *bool    `json:"isActive"`
}

// UpdateTuitionOverride PATCH port.
func (s *Service) UpdateTuitionOverride(ctx context.Context, user *session.User, id int64, in UpdateTuitionOverrideInput) error {
	if id <= 0 {
		return errors.New("invalid_id")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var studentID int64
	var curTerm *int64
	if err := tx.QueryRow(ctx, `
		select "studentId", "termId" from student_tuition_overrides where id = $1 for update`, id).
		Scan(&studentID, &curTerm); err != nil {
		return errors.New("not_found")
	}
	sets := []string{}
	args := []any{id}
	if in.TermID != nil {
		args = append(args, *in.TermID)
		sets = append(sets, fmt.Sprintf(`"termId" = $%d`, len(args)))
	}
	if in.FixedAmount != nil {
		if *in.FixedAmount < 0 || *in.FixedAmount > maxOverrideRials {
			return errors.New("invalid_body")
		}
		args = append(args, fmtNum(*in.FixedAmount))
		sets = append(sets, fmt.Sprintf(`"fixedAmount" = $%d`, len(args)))
	}
	if in.PerUnitAmount != nil {
		if *in.PerUnitAmount < 0 || *in.PerUnitAmount > maxOverrideRials {
			return errors.New("invalid_body")
		}
		args = append(args, fmtNum(*in.PerUnitAmount))
		sets = append(sets, fmt.Sprintf(`"perUnitAmount" = $%d`, len(args)))
	}
	if in.Reason != nil {
		args = append(args, trimmedPtr(*in.Reason))
		sets = append(sets, fmt.Sprintf(`reason = $%d`, len(args)))
	}
	if in.IsActive != nil {
		args = append(args, boolToDigit(*in.IsActive))
		sets = append(sets, fmt.Sprintf(`"isActive" = $%d`, len(args)))
	}
	if len(sets) == 0 {
		return errors.New("empty_patch")
	}
	// Reactivation = deactivating conflicts.
	if in.IsActive != nil && *in.IsActive {
		effTerm := curTerm
		if in.TermID != nil {
			effTerm = *in.TermID
		}
		if err := s.deactivateConflicts(ctx, &txExec{tx}, studentID, effTerm, id); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `
		update student_tuition_overrides set `+strings.Join(sets, ", ")+`, "updatedAt" = now() where id = $1`, args...); err != nil {
		return err
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "TUITION_OVERRIDE_UPDATED", "student_tuition_overrides", id, `{}`); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeleteTuitionOverride DELETE port (ADMIN only).
func (s *Service) DeleteTuitionOverride(ctx context.Context, user *session.User, id int64) error {
	isAdmin := false
	for _, r := range user.Roles {
		if r == "ADMIN" {
			isAdmin = true
		}
	}
	if !isAdmin {
		return errors.New("forbidden")
	}
	if id <= 0 {
		return errors.New("invalid_id")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `delete from student_tuition_overrides where id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("not_found")
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "TUITION_OVERRIDE_DELETED", "student_tuition_overrides", id, `{}`); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func ptrNumInt(v *int64) string {
	if v == nil {
		return "null"
	}
	return fmt.Sprintf("%d", *v)
}

func trimmedPtr(v *string) *string {
	if v == nil {
		return nil
	}
	t := strings.TrimSpace(*v)
	if t == "" {
		return nil
	}
	return &t
}
