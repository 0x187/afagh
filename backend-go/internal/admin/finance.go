// ═══ Admin finance dashboard — admin/finance and student-finance port ═══
package admin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"backend-go/internal/fa"
	"backend-go/internal/finance"
	"backend-go/internal/session"
)

// FinanceStudentRow student finance row.
type FinanceStudentRow struct {
	StudentID      int64   `json:"studentId"`
	UserID         int64   `json:"userId"`
	StudentCode    string  `json:"studentCode"`
	FirstName      *string `json:"firstName"`
	LastName       *string `json:"lastName"`
	FullName       string  `json:"fullName"`
	NationalCode   *string `json:"nationalCode"`
	MajorTitle     *string `json:"majorTitle"`
	DegreeTitle    *string `json:"degreeTitle"`
	EntryYear      *int    `json:"entryYear"`
	Status         *string `json:"status"`
	Charges        float64 `json:"charges"`
	Discounts      float64 `json:"discounts"`
	Sponsorships   float64 `json:"sponsorships"`
	Payments       float64 `json:"payments"`
	ChequesCleared float64 `json:"chequesCleared"`
	ChequesPending float64 `json:"chequesPending"`
	Loans          float64 `json:"loans"`
	Balance        float64 `json:"balance"`
}

// FinanceStudentsResponse finance dashboard response.
type FinanceStudentsResponse struct {
	Students []FinanceStudentRow `json:"students"`
	Totals   FinanceTotals       `json:"totals"`
}

// FinanceTotals dashboard totals.
type FinanceTotals struct {
	Charges        float64 `json:"charges"`
	Discounts      float64 `json:"discounts"`
	Sponsorships   float64 `json:"sponsorships"`
	Payments       float64 `json:"payments"`
	ChequesCleared float64 `json:"chequesCleared"`
	Loans          float64 `json:"loans"`
	Balance        float64 `json:"balance"`
	DebtorCount    int     `json:"debtorCount"`
}

// FinanceListFilters finance list filters (aligned with FinanceListFilters in Next).
type FinanceListFilters struct {
	Q             string
	OnlyDebtors   bool
	MajorID       *int64
	DegreeLevelID *int64
	EntryYear     *int
	Limit         int
}

// ListFinanceStudents listFinanceStudents port without report-module filters.
func (s *Service) ListFinanceStudents(ctx context.Context, user *session.User, uniCookie, q string, onlyDebtors bool) (*FinanceStudentsResponse, error) {
	return s.ListFinanceStudentsFiltered(ctx, user, uniCookie, FinanceListFilters{
		Q: q, OnlyDebtors: onlyDebtors, Limit: 1000,
	})
}

// ListFinanceStudentsFiltered listFinanceStudents port (lib/finance-engine/list-students.ts):
// The balance comes from the same computeTermAdjustments used by the transcript, so
// the dashboard and transcript figures cannot diverge. An uncleared check is not counted as "paid"
// and appears in a separate column.
func (s *Service) ListFinanceStudentsFiltered(ctx context.Context, user *session.User, uniCookie string, f FinanceListFilters) (*FinanceStudentsResponse, error) {
	resp := &FinanceStudentsResponse{Students: []FinanceStudentRow{}}
	uniID := s.UniversityID(ctx, user, uniCookie)
	// ⚠ No active university ⇒ empty list (fail-closed, matching DENY_UNI).
	if uniID == nil {
		return resp, nil
	}

	args := []any{*uniID}
	conds := []string{`st."universityId" = $1`}
	add := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		// Codes are English; Persian digits in input are normalized + wildcard escaping.
		needle := "%" + fa.EscapeLikeChars(fa.ToEnDigits(q)) + "%"
		p := add(needle)
		conds = append(conds, `(u."firstName" ilike `+p+` escape '\' or u."lastName" ilike `+p+` escape '\'
			or u."nationalCode" ilike `+p+` escape '\' or st."studentCode" ilike `+p+` escape '\')`)
	}
	if f.MajorID != nil {
		conds = append(conds, `st."majorId" = `+add(*f.MajorID))
	}
	if f.DegreeLevelID != nil {
		conds = append(conds, `st."degreeLevelId" = `+add(*f.DegreeLevelID))
	}
	if f.EntryYear != nil {
		conds = append(conds, `st."entryYear" = `+add(*f.EntryYear))
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 1000
	}
	if limit > 2000 {
		limit = 2000
	}
	args = append(args, limit)
	limitArg := "$" + strconv.Itoa(len(args))

	// Base student row.
	type baseRow struct {
		ID           int64
		UserID       int64
		Code         string
		FirstName    *string
		LastName     *string
		FullName     string
		NationalCode *string
		MajorTitle   *string
		DegreeTitle  *string
		EntryYear    *int
		Status       *string
	}
	base := []baseRow{}
	brows, err := s.DB.Pool.Query(ctx, `
		select st.id, st."userId", coalesce(st."studentCode",''),
		       u."firstName", u."lastName",
		       coalesce(u."firstName" || ' ' || u."lastName",''),
		       u."nationalCode",
		       m.name, d.title, st."entryYear", st.status
		  from students st
		  join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		  left join degree_level_configs d on d.id = st."degreeLevelId"
		 where `+strings.Join(conds, " and ")+`
		 order by st."studentCode" asc limit `+limitArg, args...)
	if err != nil {
		return nil, err
	}
	for brows.Next() {
		var b baseRow
		if err := brows.Scan(&b.ID, &b.UserID, &b.Code, &b.FirstName, &b.LastName, &b.FullName,
			&b.NationalCode, &b.MajorTitle, &b.DegreeTitle, &b.EntryYear, &b.Status); err == nil {
			base = append(base, b)
		}
	}
	brows.Close()
	if len(base) == 0 {
		return resp, nil
	}
	ids := make([]int64, len(base))
	for i, b := range base {
		ids[i] = b.ID
	}

	// Five aggregate queries instead of a per-student loop.
	type ledgerAggRow struct {
		StudentID int64
		TermID    *int64
		Type      *string
		Total     float64
	}
	ledgerAgg := []ledgerAggRow{}
	lrows, err := s.DB.Pool.Query(ctx, `
		select "studentId", "termId", "transactionType", sum(amount)::float8
		  from student_ledger where "studentId" = any($1)
		 group by "studentId", "termId", "transactionType"`, ids)
	if err == nil {
		for lrows.Next() {
			var r ledgerAggRow
			if err := lrows.Scan(&r.StudentID, &r.TermID, &r.Type, &r.Total); err == nil {
				ledgerAgg = append(ledgerAgg, r)
			}
		}
		lrows.Close()
	}

	type discRow struct {
		ID        int64
		StudentID int64
		TermID    *int64
		Kind      string
		Percent   *float64
		Amount    *float64
	}
	discountRows := []discRow{}
	drows, err := s.DB.Pool.Query(ctx, `
		select id, "studentId", "termId", coalesce(kind,''), percent, amount::float8
		  from student_discounts
		 where status = 'APPROVED' and "studentId" = any($1)`, ids)
	if err == nil {
		for drows.Next() {
			var r discRow
			if err := drows.Scan(&r.ID, &r.StudentID, &r.TermID, &r.Kind, &r.Percent, &r.Amount); err == nil {
				discountRows = append(discountRows, r)
			}
		}
		drows.Close()
	}

	type sponRow struct {
		ID        int64
		StudentID int64
		TermID    *int64
		Kind      string
		Percent   *float64
		Amount    *float64
	}
	sponsorRows := []sponRow{}
	srows, err := s.DB.Pool.Query(ctx, `
		select id, "studentId", "termId", coalesce("coverageKind",''),
		       coalesce(greatest(coalesce("fixedPercent",0), coalesce("variablePercent",0)), percent),
		       amount::float8
		  from student_sponsorships
		 where status in ('CONFIRMED','PAID') and "studentId" = any($1)`, ids)
	if err == nil {
		for srows.Next() {
			var r sponRow
			if err := srows.Scan(&r.ID, &r.StudentID, &r.TermID, &r.Kind, &r.Percent, &r.Amount); err == nil {
				sponsorRows = append(sponsorRows, r)
			}
		}
		srows.Close()
	}

	type chequeAggRow struct {
		StudentID int64
		Status    string
		Total     float64
	}
	chequeAgg := []chequeAggRow{}
	crows, err := s.DB.Pool.Query(ctx, `
		select "studentId", coalesce(status,''), sum(amount)::float8
		  from payment_cheques where "studentId" = any($1)
		 group by "studentId", status`, ids)
	if err == nil {
		for crows.Next() {
			var r chequeAggRow
			if err := crows.Scan(&r.StudentID, &r.Status, &r.Total); err == nil {
				chequeAgg = append(chequeAgg, r)
			}
		}
		crows.Close()
	}

	type loanAggRow struct {
		StudentID int64
		Status    string
		Total     float64
	}
	loanAgg := []loanAggRow{}
	larows, err := s.DB.Pool.Query(ctx, `
		select "studentId", coalesce(status,''), sum(amount)::float8
		  from student_loans where "studentId" = any($1)
		 group by "studentId", status`, ids)
	if err == nil {
		for larows.Next() {
			var r loanAggRow
			if err := larows.Scan(&r.StudentID, &r.Status, &r.Total); err == nil {
				loanAgg = append(loanAgg, r)
			}
		}
		larows.Close()
	}

	// Ledger breakdown using the canonical ledger-balance vocabulary.
	const noTerm = int64(0)
	termChargesByStudent := map[int64][]finance.TermCharge{}
	paymentsByStudent := map[int64]float64{}
	ledgerCreditsByStudent := map[int64]float64{}
	for _, r := range ledgerAgg {
		typ := ""
		if r.Type != nil {
			typ = strings.ToUpper(strings.TrimSpace(*r.Type))
		}
		amount := r.Total
		if finance.IsChargeType(typ) {
			tid := noTerm
			if r.TermID != nil {
				tid = *r.TermID
			}
			termChargesByStudent[r.StudentID] = append(termChargesByStudent[r.StudentID], finance.TermCharge{TermID: tid, Charges: amount})
		} else if typ == "PAYMENT" || typ == "POS_PAYMENT" {
			paymentsByStudent[r.StudentID] += amount
		} else if finance.IsPaymentType(typ) {
			ledgerCreditsByStudent[r.StudentID] += amount
		}
	}

	discountsByStudent := map[int64][]finance.DiscountRowLike{}
	for _, d := range discountRows {
		discountsByStudent[d.StudentID] = append(discountsByStudent[d.StudentID], finance.DiscountRowLike{
			ID: d.ID, TermID: d.TermID, Kind: d.Kind, Percent: d.Percent, Amount: d.Amount,
		})
	}
	sponsorsByStudent := map[int64][]finance.SponsorRowLike{}
	for _, sp := range sponsorRows {
		sponsorsByStudent[sp.StudentID] = append(sponsorsByStudent[sp.StudentID], finance.SponsorRowLike{
			ID: sp.ID, TermID: sp.TermID, CoverageKind: sp.Kind, Percent: sp.Percent, Amount: sp.Amount,
		})
	}
	chequesByStudent := map[int64][2]float64{}
	for _, c := range chequeAgg {
		slot := chequesByStudent[c.StudentID]
		switch strings.ToUpper(c.Status) {
		case "CLEARED":
			slot[0] += c.Total
		case "PENDING":
			slot[1] += c.Total
		}
		chequesByStudent[c.StudentID] = slot
	}
	loansByStudent := map[int64]float64{}
	for _, l := range loanAgg {
		st := strings.ToUpper(l.Status)
		if st != "ACTIVE" && st != "SETTLED" {
			continue
		}
		loansByStudent[l.StudentID] += l.Total
	}

	for _, b := range base {
		adjustments := finance.ComputeTermAdjustments(
			termChargesByStudent[b.ID], discountsByStudent[b.ID], sponsorsByStudent[b.ID])
		var charges, discounts, sponsorships float64
		for _, a := range adjustments {
			charges += a.Charges
			discounts += a.Discounts
			sponsorships += a.Sponsorships
		}
		discounts += ledgerCreditsByStudent[b.ID]
		r := FinanceStudentRow{
			StudentID: b.ID, UserID: b.UserID, StudentCode: b.Code,
			FirstName: b.FirstName, LastName: b.LastName,
			FullName: strings.TrimSpace(b.FullName), NationalCode: b.NationalCode,
			MajorTitle: b.MajorTitle, DegreeTitle: b.DegreeTitle, EntryYear: b.EntryYear, Status: b.Status,
			Charges: charges, Discounts: discounts, Sponsorships: sponsorships,
			Payments:       paymentsByStudent[b.ID],
			ChequesCleared: chequesByStudent[b.ID][0],
			ChequesPending: chequesByStudent[b.ID][1],
			Loans:          loansByStudent[b.ID],
		}
		r.Balance = charges - discounts - sponsorships - r.Payments - r.Loans
		resp.Students = append(resp.Students, r)
	}

	// Sorting: balance descending, then student code.
	sort.SliceStable(resp.Students, func(i, j int) bool {
		if resp.Students[i].Balance != resp.Students[j].Balance {
			return resp.Students[i].Balance > resp.Students[j].Balance
		}
		return resp.Students[i].StudentCode < resp.Students[j].StudentCode
	})

	if f.OnlyDebtors {
		out := []FinanceStudentRow{}
		for _, r := range resp.Students {
			if r.Balance > 0 {
				out = append(out, r)
			}
		}
		resp.Students = out
	}

	for _, r := range resp.Students {
		resp.Totals.Charges += r.Charges
		resp.Totals.Discounts += r.Discounts
		resp.Totals.Sponsorships += r.Sponsorships
		resp.Totals.Payments += r.Payments
		resp.Totals.ChequesCleared += r.ChequesCleared
		resp.Totals.Loans += r.Loans
		resp.Totals.Balance += r.Balance
		if r.Balance > 0 {
			resp.Totals.DebtorCount++
		}
	}
	return resp, nil
}

// LedgerTxn ledger transaction.
type LedgerTxn struct {
	ID              int64   `json:"id"`
	StudentID       int64   `json:"studentId"`
	TransactionType string  `json:"transactionType"`
	Amount          float64 `json:"amount"`
	Description     *string `json:"description"`
	CreatedAt       *string `json:"createdAt"`
}

// ListLedgerTxns ledger line items of one student (admin page table section;
// the official transcript comes from the shared student.GetFinanceByStudentID engine).
func (s *Service) ListLedgerTxns(ctx context.Context, studentID int64) ([]LedgerTxn, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "studentId", "transactionType", amount::float8, description, "createdAt"
		  from student_ledger where "studentId" = $1 order by "createdAt", id`, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LedgerTxn{}
	for rows.Next() {
		var t LedgerTxn
		var createdAt *time.Time
		if err := rows.Scan(&t.ID, &t.StudentID, &t.TransactionType, &t.Amount, &t.Description, &createdAt); err == nil {
			if createdAt != nil {
				v := createdAt.Format("2006-01-02 15:04:05")
				t.CreatedAt = &v
			}
			out = append(out, t)
		}
	}
	return out, nil
}

// AdjustLedger record a manual ledger adjustment.
type AdjustInput struct {
	StudentID       int64   `json:"studentId"`
	TransactionType string  `json:"transactionType"`
	Amount          float64 `json:"amount"`
	Description     string  `json:"description"`
}

// Allowed manual adjustment types — subset of the `ck_student_ledger_txn_type` constraint CHECK
// (any type outside this constraint is rejected by the database on insert, so we filter fail-closed).
var adjustAllowedTypes = map[string]bool{
	"CHARGE": true, "CREDIT": true, "PAYMENT": true, "POS_PAYMENT": true,
	"TUITION_ADJUST_DEC": true, "TUITION_ADJUST_INC": true,
}

// AdjustLedger manual adjustment record port (recordLedgerAction): insert ledger row +
// audit row with hash chain, in one transaction.
func (s *Service) AdjustLedger(ctx context.Context, user *session.User, uniCookie string, in AdjustInput) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	t := strings.ToUpper(strings.TrimSpace(in.TransactionType))
	if !adjustAllowedTypes[t] {
		return errors.New("نوع تراکنش نامعتبر است.")
	}
	if in.Amount <= 0 {
		return errors.New("مبلغ باید مثبت باشد.")
	}
	desc := strings.TrimSpace(in.Description)
	if desc == "" {
		if t == "PAYMENT" || t == "POS_PAYMENT" {
			desc = "پرداخت شهریه"
		} else {
			desc = "شارژ شهریه"
		}
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var ledgerID int64
	if err := tx.QueryRow(ctx, `
		insert into student_ledger ("studentId","transactionType",amount,description,"universityId")
		values ($1,$2,$3,$4,$5) returning id`,
		in.StudentID, t, in.Amount, desc, *uniID).Scan(&ledgerID); err != nil {
		return err
	}
	var prev string
	_ = tx.QueryRow(ctx, `select coalesce(hash,'') from audit_logs order by id desc limit 1`).Scan(&prev)
	iso := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	h := sha256.Sum256([]byte(prev + "|FINANCE_LEDGER_" + t + "|" + strconv.FormatInt(ledgerID, 10) + "|" + iso))
	hash := hex.EncodeToString(h[:])
	details := fmt.Sprintf(`{"studentId":%d,"amount":%s,"type":%q}`, in.StudentID, strconv.FormatFloat(in.Amount, 'f', -1, 64), t)
	if _, err := tx.Exec(ctx, `
		insert into audit_logs ("actorUserId", action, "entityType", "entityId", details, "prevHash", hash)
		values ($1,$2,'student_ledger',$3,$4,$5,$6)`,
		user.ID, "FINANCE_LEDGER_"+t, ledgerID, details, prev, hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CourseFinanceRow course with finance type.
type CourseFinanceRow struct {
	ID             int64    `json:"id"`
	Code           string   `json:"code"`
	Title          string   `json:"title"`
	Units          *float64 `json:"units"`
	CourseType     *string  `json:"courseType"`
	LegacyMaliType *int     `json:"legacyMaliType"`
}

// CourseFinanceResponse course finance type page response.
type CourseFinanceResponse struct {
	Courses []CourseFinanceRow `json:"courses"`
}

// ListCourseFinance admin/course-finance port.
func (s *Service) ListCourseFinance(ctx context.Context, user *session.User, uniCookie string, q string) (*CourseFinanceResponse, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	resp := &CourseFinanceResponse{Courses: []CourseFinanceRow{}}
	if uniID == nil {
		return resp, nil
	}
	args := []any{*uniID}
	extra := ""
	if q = strings.TrimSpace(q); q != "" {
		extra = ` and (c.code ilike $2 or c.title ilike $2)`
		args = append(args, "%"+q+"%")
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select c.id, c.code, c.title, c.units, c."courseType", c."legacyMaliType"
		  from courses c
		 where (c."universityId" = $1 or c."universityId" is null)`+extra+`
		 order by (c."legacyMaliType" is null) desc, c.code limit 300`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c CourseFinanceRow
		if err := rows.Scan(&c.ID, &c.Code, &c.Title, &c.Units, &c.CourseType, &c.LegacyMaliType); err == nil {
			resp.Courses = append(resp.Courses, c)
		}
	}
	return resp, nil
}

// SetCourseFinanceType set the course finance type.
func (s *Service) SetCourseFinanceType(ctx context.Context, user *session.User, courseID int64, maliType int) error {
	if maliType < 0 || maliType > 99 {
		return errors.New("نوع درس مالی نامعتبر است.")
	}
	tag, err := s.DB.Pool.Exec(ctx, `update courses set "legacyMaliType" = $1 where id = $2`, maliType, courseID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("درس یافت نشد.")
	}
	return nil
}
