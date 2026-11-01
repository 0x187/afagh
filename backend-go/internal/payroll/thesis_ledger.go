// ═══ Thesis ledger (supervision/advisory fee) — port of lib/thesis-ledger.ts ═══
package payroll

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
)

// ThesisRoles allowed roles.
var ThesisRoles = map[string]bool{"SUPERVISOR": true, "ADVISOR": true}

// ThesisStatuses statuses.
var ThesisStatuses = map[string]bool{"ONGOING": true, "COMPLETED": true, "CANCELLED": true}

// SupervisionItem summary row.
type SupervisionItem struct {
	ID             int64   `json:"id"`
	StaffID        int64   `json:"staffId"`
	StaffName      string  `json:"staffName"`
	StudentID      *int64  `json:"studentId"`
	StudentName    string  `json:"studentName"`
	Title          string  `json:"title"`
	TotalUnits     float64 `json:"totalUnits"`
	DrawnUnits     float64 `json:"drawnUnits"`
	RemainingUnits float64 `json:"remainingUnits"`
	Role           string  `json:"role"`
	Status         string  `json:"status"`
	StartTermTitle *string `json:"startTermTitle"`
	CreatedAt      *string `json:"createdAt"`
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// ListThesisSupervisions list of summaries with total withdrawals.
func (e *Engine) ListThesisSupervisions(ctx context.Context, universityID, staffID *int64) ([]SupervisionItem, error) {
	args := []any{}
	where := ""
	if universityID != nil {
		args = append(args, *universityID)
		where = ` where s."universityId" = $1`
	}
	if staffID != nil {
		args = append(args, *staffID)
		if where == "" {
			where = ` where s."staffId" = $1`
		} else {
			where += fmt.Sprintf(` and s."staffId" = $%d`, len(args))
		}
	}
	rows, err := e.Pool.Query(ctx, `
		select s.id, s."staffId", coalesce(u."firstName" || ' ' || u."lastName",''),
		       s."studentId", s."studentNameManual", s.title, s."totalUnits"::float8,
		       s.role, s.status, s."startTermId"::text, s."createdAt"::text,
		       coalesce((select sum(d.units) from thesis_unit_draws d where d."supervisionId" = s.id),0)::float8
		  from thesis_supervisions s
		  join staff st on st.id = s."staffId"
		  join users u on u.id = st."userId"`+where+`
		 order by s."createdAt" desc limit 200`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SupervisionItem{}
	for rows.Next() {
		var it SupervisionItem
		var startTermID *string
		var manual *string
		if err := rows.Scan(&it.ID, &it.StaffID, &it.StaffName, &it.StudentID, &manual, &it.Title,
			&it.TotalUnits, &it.Role, &it.Status, &startTermID, &it.CreatedAt, &it.DrawnUnits); err != nil {
			continue
		}
		it.StaffName = strings.TrimSpace(it.StaffName)
		if it.StaffName == "" {
			it.StaffName = "—"
		}
		// student name: student record ← manual name
		it.StudentName = strings.TrimSpace(derefStr(manual))
		if it.StudentID != nil {
			var name string
			var code *string
			if err := e.Pool.QueryRow(ctx, `
				select coalesce(u."firstName" || ' ' || u."lastName",''), st."studentCode"
				  from students st join users u on u.id = st."userId" where st.id = $1`, *it.StudentID).
				Scan(&name, &code); err == nil {
				it.StudentName = strings.TrimSpace(name)
				if code != nil {
					it.StudentName += " (" + *code + ")"
				}
			}
		}
		if it.StudentName == "" {
			it.StudentName = "—"
		}
		if startTermID != nil && *startTermID != "" {
			var title string
			if err := e.Pool.QueryRow(ctx, `select title from academic_terms where id::text = $1`, *startTermID).Scan(&title); err == nil {
				it.StartTermTitle = &title
			}
		}
		it.DrawnUnits = round2(it.DrawnUnits)
		it.RemainingUnits = round2(it.TotalUnits - it.DrawnUnits)
		out = append(out, it)
	}
	return out, nil
}

// CreateSupervisionInput new summary input.
type CreateSupervisionInput struct {
	StaffID           int64
	StudentID         *int64
	StudentNameManual *string
	Title             string
	TotalUnits        float64
	Role              string
	StartTermID       *int64
	CreatedBy         *int64
	UniversityID      *int64
}

// CreateSupervision port of createSupervision.
func (e *Engine) CreateSupervision(ctx context.Context, in CreateSupervisionInput) (int64, error) {
	title := strings.TrimSpace(in.Title)
	if len([]rune(title)) < 3 {
		return 0, errors.New("عنوان پایان‌نامه الزامی است.")
	}
	if !(in.TotalUnits > 0) || in.TotalUnits > 12 {
		return 0, errors.New("سقف واحد باید بین ۰ تا ۱۲ باشد.")
	}
	if !ThesisRoles[in.Role] {
		return 0, errors.New("نقش نامعتبر است.")
	}
	manual := ""
	if in.StudentNameManual != nil {
		manual = strings.TrimSpace(*in.StudentNameManual)
	}
	if in.StudentID == nil && manual == "" {
		return 0, errors.New("دانشجو یا نام دستی دانشجو الزامی است.")
	}
	var id int64
	if err := e.Pool.QueryRow(ctx, `
		insert into thesis_supervisions ("staffId","studentId","studentNameManual",title,"totalUnits",role,status,"startTermId","createdBy","universityId")
		values ($1,$2,$3,$4,$5,$6,'ONGOING',$7,$8,$9) returning id`,
		in.StaffID, in.StudentID, nullIfEmptyStr(manual), title, fmtNumRaw(in.TotalUnits), in.Role,
		in.StartTermID, in.CreatedBy, in.UniversityID).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

func nullIfEmptyStr(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

// SetSupervisionStatus change a summary's status.
func (e *Engine) SetSupervisionStatus(ctx context.Context, id int64, status string) error {
	if !ThesisStatuses[status] {
		return errors.New("وضعیت نامعتبر است.")
	}
	tag, err := e.Pool.Exec(ctx, `update thesis_supervisions set status = $2 where id = $1`, id, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("سرجمع یافت نشد.")
	}
	return nil
}

// DeleteSupervision delete a summary — only when it has no withdrawals.
func (e *Engine) DeleteSupervision(ctx context.Context, id int64) error {
	var hasDraws bool
	_ = e.Pool.QueryRow(ctx, `select exists(select 1 from thesis_unit_draws where "supervisionId" = $1)`, id).Scan(&hasDraws)
	if hasDraws {
		return errors.New("این سرجمع برداشت دارد؛ ابتدا برداشت‌ها را حذف کنید.")
	}
	_, err := e.Pool.Exec(ctx, `delete from thesis_supervisions where id = $1`, id)
	return err
}

// ThesisDraw a single withdrawal.
type ThesisDraw struct {
	ID        int64    `json:"id"`
	TermID    int64    `json:"termId"`
	TermTitle *string  `json:"termTitle"`
	Units     float64  `json:"units"`
	Note      *string  `json:"note"`
	CreatedAt *string  `json:"createdAt"`
}

// ListThesisDraws withdrawals of a summary.
func (e *Engine) ListThesisDraws(ctx context.Context, supervisionID int64) ([]ThesisDraw, error) {
	rows, err := e.Pool.Query(ctx, `
		select d.id, d."termId", t.title, d.units::float8, d.note, d."createdAt"::text
		  from thesis_unit_draws d
		  join academic_terms t on t.id = d."termId"
		 where d."supervisionId" = $1 order by d."createdAt" desc`, supervisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ThesisDraw{}
	for rows.Next() {
		var d ThesisDraw
		if err := rows.Scan(&d.ID, &d.TermID, &d.TermTitle, &d.Units, &d.Note, &d.CreatedAt); err == nil {
			out = append(out, d)
		}
	}
	return out, nil
}

// AddThesisDrawInput withdrawal input.
type AddThesisDrawInput struct {
	SupervisionID int64
	TermID        int64
	Units         float64
	Note          *string
	CreatedBy     *int64
	UniversityID  *int64
}

// AddThesisDraw records an installment withdrawal — cap: the summary's remaining balance.
func (e *Engine) AddThesisDraw(ctx context.Context, in AddThesisDrawInput) (int64, error) {
	if !(in.Units > 0) || in.Units > 12 {
		return 0, errors.New("واحد برداشت باید بین ۰ تا ۱۲ باشد.")
	}
	var totalUnits float64
	var status string
	err := e.Pool.QueryRow(ctx, `
		select "totalUnits"::float8, status from thesis_supervisions where id = $1`, in.SupervisionID).
		Scan(&totalUnits, &status)
	if err != nil {
		return 0, errors.New("سرجمع یافت نشد.")
	}
	if status == "CANCELLED" {
		return 0, errors.New("سرجمع لغوشده است.")
	}
	var drawn float64
	_ = e.Pool.QueryRow(ctx, `
		select coalesce(sum(units),0)::float8 from thesis_unit_draws where "supervisionId" = $1`, in.SupervisionID).Scan(&drawn)
	remaining := totalUnits - drawn
	if in.Units-remaining > 1e-9 {
		return 0, fmt.Errorf("سقف باقی‌مانده %s واحد است.", formatUnits(round2(remaining)))
	}
	var id int64
	if err := e.Pool.QueryRow(ctx, `
		insert into thesis_unit_draws ("supervisionId","termId",units,note,"createdBy","universityId")
		values ($1,$2,$3,$4,$5,$6) returning id`,
		in.SupervisionID, in.TermID, fmtNumRaw(in.Units), trimmedPtrOrNil(in.Note), in.CreatedBy, in.UniversityID).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

// DeleteThesisDraw delete a withdrawal.
func (e *Engine) DeleteThesisDraw(ctx context.Context, id int64) error {
	_, err := e.Pool.Exec(ctx, `delete from thesis_unit_draws where id = $1`, id)
	return err
}

func derefStr(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func trimmedPtrOrNil(v *string) *string {
	if v == nil {
		return nil
	}
	t := strings.TrimSpace(*v)
	if t == "" {
		return nil
	}
	return &t
}

func fmtNumRaw(v float64) string {
	return formatUnits(v)
}

func formatUnits(v float64) string {
	// no extra decimals: 2 → "2", 2.5 → "2.5"
	if v == math.Trunc(v) {
		return fmt.Sprintf("%d", int64(v))
	}
	return fmt.Sprintf("%g", v)
}
