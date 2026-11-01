// ═══ Evaluation periods (admin) ═══
package admin

import (
	"context"
	"errors"
	"strings"
	"time"

	"backend-go/internal/session"
)

// EvalTerm term in the picker.
type EvalTerm struct {
	ID       int64  `json:"id"`
	Title    string `json:"title"`
	TermCode string `json:"termCode"`
}

// EvalPeriod evaluation period.
type EvalPeriod struct {
	ID        int64   `json:"id"`
	Title     string  `json:"title"`
	TermID    *int64  `json:"termId"`
	TermTitle *string `json:"termTitle"`
	StartDate *string `json:"startDate"`
	EndDate   *string `json:"endDate"`
	IsActive  int     `json:"isActive"`
	Open      bool    `json:"open"`
}

// EvaluationsData response.
type EvaluationsData struct {
	Terms   []EvalTerm   `json:"terms"`
	Periods []EvalPeriod `json:"periods"`
}

// GetEvaluations admin/evaluations port.
func (s *Service) GetEvaluations(ctx context.Context, user *session.User, uniCookie string) (*EvaluationsData, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	resp := &EvaluationsData{Terms: []EvalTerm{}, Periods: []EvalPeriod{}}
	if uniID == nil {
		return resp, nil
	}
	trows, err := s.DB.Pool.Query(ctx, `
		select id, title, "termCode" from academic_terms
		 where "universityId" = $1 order by id desc limit 60`, *uniID)
	if err == nil {
		for trows.Next() {
			var t EvalTerm
			if err := trows.Scan(&t.ID, &t.Title, &t.TermCode); err == nil {
				resp.Terms = append(resp.Terms, t)
			}
		}
		trows.Close()
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select p.id, p.title, p."termId", t.title, p."startDate", p."endDate", coalesce(p."isActive",0)
		  from evaluation_periods p left join academic_terms t on t.id = p."termId"
		 where (p."universityId" = $1 or p."universityId" is null)
		 order by p.id desc`, *uniID)
	if err != nil {
		return resp, nil
	}
	defer rows.Close()
	now := time.Now()
	for rows.Next() {
		var p EvalPeriod
		var start, end *time.Time
		if err := rows.Scan(&p.ID, &p.Title, &p.TermID, &p.TermTitle, &start, &end, &p.IsActive); err == nil {
			p.StartDate = timeISO(start)
			p.EndDate = timeISO(end)
			p.Open = p.IsActive != 0 && start != nil && end != nil && !now.Before(*start) && !now.After(*end)
			resp.Periods = append(resp.Periods, p)
		}
	}
	return resp, nil
}

// CreateEvalPeriod createEvaluationPeriodAction port.
func (s *Service) CreateEvalPeriod(ctx context.Context, user *session.User, uniCookie string, title string, termID int64, startInput, endInput string, active bool) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	if strings.TrimSpace(title) == "" || termID <= 0 {
		return errors.New("عنوان و ترم الزامی است.")
	}
	start, err := parseLocalInput(startInput)
	if err != nil {
		return errors.New("زمان شروع نامعتبر است.")
	}
	end, err := parseLocalInput(endInput)
	if err != nil {
		return errors.New("زمان پایان نامعتبر است.")
	}
	if !end.After(start) {
		return errors.New("پایان دوره باید بعد از شروع باشد.")
	}
	flag := 0
	if active {
		flag = 1
	}
	_, err = s.DB.Pool.Exec(ctx, `
		insert into evaluation_periods (title,"termId","universityId","startDate","endDate","isActive")
		values ($1,$2,$3,$4,$5,$6)`, strings.TrimSpace(title), termID, uniID, start, end, flag)
	return err
}

// ToggleEvalPeriod enable/disable.
func (s *Service) ToggleEvalPeriod(ctx context.Context, user *session.User, uniCookie string, periodID int64) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	var active int
	if err := s.DB.Pool.QueryRow(ctx, `
		select coalesce("isActive",0) from evaluation_periods where id = $1 and ("universityId" = $2 or "universityId" is null)`,
		periodID, *uniID).Scan(&active); err != nil {
		return errors.New("دوره یافت نشد.")
	}
	next := 1
	if active != 0 {
		next = 0
	}
	_, err := s.DB.Pool.Exec(ctx, `update evaluation_periods set "isActive" = $1 where id = $2`, next, periodID)
	return err
}

// DeleteEvalPeriod delete a period.
func (s *Service) DeleteEvalPeriod(ctx context.Context, user *session.User, uniCookie string, periodID int64) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	tag, err := s.DB.Pool.Exec(ctx, `
		delete from evaluation_periods where id = $1 and "universityId" = $2`, periodID, *uniID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("دوره یافت نشد یا سراسری است.")
	}
	return nil
}
