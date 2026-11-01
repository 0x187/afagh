// ═══ Teaching-fee regulation versions — port of payroll/regulations ═══
package payroll

import (
	"context"
	"errors"
	"strings"
)

// RegulationVersion regulation version.
type RegulationVersion struct {
	ID          int64   `json:"id"`
	Code        string  `json:"code"`
	Title       string  `json:"title"`
	Year        *int    `json:"year"`
	Description *string `json:"description"`
	IsActive    bool    `json:"isActive"`
	CreatedAt   *string `json:"createdAt"`
}

// ListRegulations list of versions.
func (e *Engine) ListRegulations(ctx context.Context, universityID *int64) ([]RegulationVersion, error) {
	args := []any{}
	where := ""
	if universityID != nil {
		where = ` where "universityId" = $1`
		args = append(args, *universityID)
	}
	rows, err := e.Pool.Query(ctx, `
		select id, code, title, year, description, "isActive", "createdAt"::text
		  from payroll_regulation_versions`+where+` order by "createdAt" desc limit 100`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RegulationVersion{}
	for rows.Next() {
		var r RegulationVersion
		var active *int
		if err := rows.Scan(&r.ID, &r.Code, &r.Title, &r.Year, &r.Description, &active, &r.CreatedAt); err == nil {
			r.IsActive = active != nil && *active == 1
			out = append(out, r)
		}
	}
	return out, nil
}

// CreateRegulation create a version (unique code).
func (e *Engine) CreateRegulation(ctx context.Context, universityID *int64, code, title string, year *int, description *string, createdBy int64) (int64, error) {
	code = strings.TrimSpace(code)
	title = strings.TrimSpace(title)
	if len([]rune(code)) < 2 || len([]rune(title)) < 2 {
		return 0, errors.New("کد و عنوان الزامی‌اند.")
	}
	var dup bool
	_ = e.Pool.QueryRow(ctx, `select exists(select 1 from payroll_regulation_versions where code = $1)`, code).Scan(&dup)
	if dup {
		return 0, errors.New("این کد نسخه قبلاً ثبت شده است.")
	}
	var id int64
	if err := e.Pool.QueryRow(ctx, `
		insert into payroll_regulation_versions (code, title, year, description, "isActive", "createdBy", "universityId")
		values ($1,$2,$3,$4,0,$5,$6) returning id`,
		code, title, year, description, createdBy, universityID).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

// ActivateRegulation activation: only one active version per university.
func (e *Engine) ActivateRegulation(ctx context.Context, universityID *int64, id int64) error {
	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if universityID != nil {
		if _, err := tx.Exec(ctx, `update payroll_regulation_versions set "isActive" = 0 where "universityId" = $1`, *universityID); err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(ctx, `update payroll_regulation_versions set "isActive" = 0`); err != nil {
			return err
		}
	}
	tag, err := tx.Exec(ctx, `update payroll_regulation_versions set "isActive" = 1 where id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("نسخه یافت نشد.")
	}
	return tx.Commit(ctx)
}

// DeleteRegulation delete an inactive version.
func (e *Engine) DeleteRegulation(ctx context.Context, id int64) error {
	var active *int
	if err := e.Pool.QueryRow(ctx, `select "isActive" from payroll_regulation_versions where id = $1`, id).Scan(&active); err != nil {
		return errors.New("نسخه یافت نشد.")
	}
	if active != nil && *active == 1 {
		return errors.New("نسخهٔ فعال حذف نمی‌شود؛ ابتدا نسخهٔ دیگری را فعال کنید.")
	}
	_, err := e.Pool.Exec(ctx, `delete from payroll_regulation_versions where id = $1`, id)
	return err
}
