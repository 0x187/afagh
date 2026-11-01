// ═══ Welfare fund: funds and loan assignment — port of api/admin/finance/welfare ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"backend-go/internal/session"
)

// WelfareFund: welfare fund.
type WelfareFund struct {
	ID          int64   `json:"id"`
	Code        string  `json:"code"`
	Title       string  `json:"title"`
	Description *string `json:"description"`
	IsActive    bool    `json:"isActive"`
	LoanCount   int     `json:"loanCount"`
	CreatedAt   *string `json:"createdAt"`
}

// WelfareLoan: loan with student.
type WelfareLoan struct {
	ID           int64   `json:"id"`
	StudentID    int64   `json:"studentId"`
	StudentCode  string  `json:"studentCode"`
	StudentName  string  `json:"studentName"`
	Lender       *string `json:"lender"`
	LoanCode     *string `json:"loanCode"`
	Amount       float64 `json:"amount"`
	Installments *int    `json:"installments"`
	Status       *string `json:"status"`
	FundID       *int64  `json:"welfareFundId"`
	FundTitle    *string `json:"fundTitle"`
	CreatedAt    *string `json:"createdAt"`
}

// ListWelfareFunds: fund list + loan count per fund.
func (s *Service) ListWelfareFunds(ctx context.Context, user *session.User, uniCookie string) ([]WelfareFund, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return []WelfareFund{}, nil
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select f.id, f.code, f.title, f.description, f."isActive", f."createdAt"::text,
		       (select count(*)::int from student_loans l
		         where l."welfareFundId" = f.id and (l."universityId" = $1 or l."universityId" is null))
		  from welfare_funds f
		 where (f."universityId" = $1 or f."universityId" is null)
		 order by f.id desc`, *uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WelfareFund{}
	for rows.Next() {
		var f WelfareFund
		var active *int
		if err := rows.Scan(&f.ID, &f.Code, &f.Title, &f.Description, &active, &f.CreatedAt, &f.LoanCount); err == nil {
			f.IsActive = active != nil && *active == 1
			out = append(out, f)
		}
	}
	return out, nil
}

// ListWelfareLoans: loans of one fund (fundID nil = no fund).
func (s *Service) ListWelfareLoans(ctx context.Context, user *session.User, uniCookie string, fundID *int64, page int) ([]WelfareLoan, int, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return []WelfareLoan{}, 0, nil
	}
	if page < 1 {
		page = 1
	}
	args := []any{*uniID}
	fundWhere := ` and l."welfareFundId" is null`
	if fundID != nil {
		args = append(args, *fundID)
		fundWhere = fmt.Sprintf(` and l."welfareFundId" = $%d`, len(args))
	}
	where := ` where (l."universityId" = $1 or l."universityId" is null)` + fundWhere
	var total int
	if err := s.DB.Pool.QueryRow(ctx, `select count(*)::int from student_loans l`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, 50, (page-1)*50)
	rows, err := s.DB.Pool.Query(ctx, `
		select l.id, l."studentId", st."studentCode", coalesce(u."firstName" || ' ' || u."lastName",''),
		       l.lender, l."loanCode", l.amount::float8, l.installments, l.status,
		       l."welfareFundId", f.title, l."createdAt"::text
		  from student_loans l
		  join students st on st.id = l."studentId"
		  join users u on u.id = st."userId"
		  left join welfare_funds f on f.id = l."welfareFundId"`+where+`
		 order by l."createdAt" desc limit $`+fmt.Sprintf("%d", len(args)-1)+` offset $`+fmt.Sprintf("%d", len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []WelfareLoan{}
	for rows.Next() {
		var l WelfareLoan
		if err := rows.Scan(&l.ID, &l.StudentID, &l.StudentCode, &l.StudentName, &l.Lender, &l.LoanCode,
			&l.Amount, &l.Installments, &l.Status, &l.FundID, &l.FundTitle, &l.CreatedAt); err == nil {
			l.StudentName = strings.TrimSpace(l.StudentName)
			out = append(out, l)
		}
	}
	return out, total, nil
}

// WelfareFundInput: fund save input.
type WelfareFundInput struct {
	Code        string  `json:"code"`
	Title       string  `json:"title"`
	Description *string `json:"description"`
	IsActive    *bool   `json:"isActive"`
}

func validateFund(in WelfareFundInput) error {
	code := strings.TrimSpace(in.Code)
	title := strings.TrimSpace(in.Title)
	if code == "" || len(code) > 40 || title == "" || len([]rune(title)) > 150 {
		return errors.New("invalid_body")
	}
	if in.Description != nil && len([]rune(*in.Description)) > 2000 {
		return errors.New("invalid_body")
	}
	return nil
}

// CreateWelfareFund port of POST — globally unique code (unique) → 409.
func (s *Service) CreateWelfareFund(ctx context.Context, user *session.User, uniCookie string, in WelfareFundInput) (int64, error) {
	if err := validateFund(in); err != nil {
		return 0, err
	}
	uniID := s.UniversityID(ctx, user, uniCookie)
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	active := 1
	if in.IsActive != nil && !*in.IsActive {
		active = 0
	}
	var id int64
	if err := tx.QueryRow(ctx, `
		insert into welfare_funds (code, title, description, "isActive", "universityId")
		values ($1,$2,$3,$4,$5) returning id`,
		strings.TrimSpace(in.Code), strings.TrimSpace(in.Title), trimmedPtr(in.Description), active, uniID).Scan(&id); err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "23505") {
			return 0, errors.New("duplicate_code")
		}
		return 0, err
	}
	details := fmt.Sprintf(`{"code":%q,"title":%q}`, strings.TrimSpace(in.Code), strings.TrimSpace(in.Title))
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "WELFARE_FUND_CREATED", "welfare_funds", id, details); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return id, nil
}

// UpdateWelfareFund port of PATCH.
func (s *Service) UpdateWelfareFund(ctx context.Context, user *session.User, id int64, in WelfareFundInput) error {
	if id <= 0 {
		return errors.New("invalid_id")
	}
	if err := validateFund(in); err != nil {
		return err
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var exists bool
	_ = tx.QueryRow(ctx, `select exists(select 1 from welfare_funds where id = $1 for update)`, id).Scan(&exists)
	if !exists {
		return errors.New("not_found")
	}
	active := 1
	if in.IsActive != nil && !*in.IsActive {
		active = 0
	}
	if _, err := tx.Exec(ctx, `
		update welfare_funds set code = $2, title = $3, description = $4, "isActive" = $5 where id = $1`,
		id, strings.TrimSpace(in.Code), strings.TrimSpace(in.Title), trimmedPtr(in.Description), active); err != nil {
		return err
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "WELFARE_FUND_UPDATED", "welfare_funds", id, `{}`); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeleteWelfareFund port of DELETE (ADMIN) — a fund with loans cannot be deleted.
func (s *Service) DeleteWelfareFund(ctx context.Context, user *session.User, id int64) error {
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
	var n int
	_ = s.DB.Pool.QueryRow(ctx, `select count(*)::int from student_loans where "welfareFundId" = $1`, id).Scan(&n)
	if n > 0 {
		return fmt.Errorf("fund_in_use:%d", n)
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `delete from welfare_funds where id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("not_found")
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "WELFARE_FUND_DELETED", "welfare_funds", id,
		fmt.Sprintf(`{"id":%d}`, id)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AssignLoanInput: input for assigning a loan to a fund.
type AssignLoanInput struct {
	LoanID int64
	FundID *int64
	// FundIDSet: indicates whether the fundId key was sent at all (null = remove fund)
	FundIDSet bool
}

// AssignLoanToFund port of action=assign-loan.
func (s *Service) AssignLoanToFund(ctx context.Context, user *session.User, uniCookie string, in AssignLoanInput) error {
	if in.LoanID <= 0 || !in.FundIDSet {
		return errors.New("invalid_loan")
	}
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("forbidden")
	}
	if in.FundID != nil && *in.FundID <= 0 {
		return errors.New("invalid_fund")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var loanUni *int64
	if err := tx.QueryRow(ctx, `select "universityId" from student_loans where id = $1 for update`, in.LoanID).Scan(&loanUni); err != nil {
		return errors.New("not_found")
	}
	if loanUni != nil && *loanUni != *uniID {
		return errors.New("forbidden")
	}
	if in.FundID != nil {
		var exists bool
		_ = tx.QueryRow(ctx, `select exists(select 1 from welfare_funds where id = $1)`, *in.FundID).Scan(&exists)
		if !exists {
			return errors.New("fund_not_found")
		}
	}
	if _, err := tx.Exec(ctx, `update student_loans set "welfareFundId" = $2 where id = $1`, in.LoanID, in.FundID); err != nil {
		return err
	}
	details := `{"fundId":null}`
	if in.FundID != nil {
		details = fmt.Sprintf(`{"fundId":%d}`, *in.FundID)
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "WELFARE_LOAN_ASSIGNED", "student_loans", in.LoanID, details); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
