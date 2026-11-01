// ═══ Payslip financial operations — compute / midterm / settle / payslip / export / config ═══
package payroll

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ComputeTermResult whole-term computation result.
type ComputeTermResult struct {
	Ok                bool            `json:"ok"`
	TermTitle         string          `json:"termTitle"`
	Computed          int             `json:"computed"`
	SkippedNoContract int             `json:"skippedNoContract"`
	SkippedSettled    int             `json:"skippedSettled"`
	SkippedLocked     int             `json:"skippedLocked"`
	Totals            map[string]float64 `json:"totals"`
}

// ComputeTermPayroll computes payslips for all professors of a term — load once, then upsert.
// Professors without a contract are excluded from the computation (not an error).
// 🔒 a payslip in the approval chain or rejected is not touched unless explicitly returned to DRAFT.
func (e *Engine) ComputeTermPayroll(ctx context.Context, actorUserID *int64, termID *int64) (*ComputeTermResult, error) {
	term, err := e.CurrentTerm(ctx, termID)
	if err != nil {
		return nil, err
	}
	if term == nil {
		return nil, errors.New("ترم جاری مشخص نیست.")
	}
	data, err := e.LoadTermPayrollData(ctx, term.ID)
	if err != nil {
		return nil, err
	}

	staffIDs := make([]int64, 0, len(data.OfferingsByStaff))
	for sid := range data.OfferingsByStaff {
		staffIDs = append(staffIDs, sid)
	}
	sort.Slice(staffIDs, func(i, j int) bool { return staffIDs[i] < staffIDs[j] })

	type insertRow struct {
		contractID int64
		totalEquiv string
		payable    string
		gross      string
		deductions string
		net        string
		detail     string
		rank       *string
		base       *string
		rate       string
	}
	inserts := []insertRow{}
	type updateRow struct {
		id                                             int64
		totalEquiv, payable, gross, deductions, net    string
		detail                                         string
		rank, base                                     *string
		rate                                           string
	}
	updates := []updateRow{}
	res := &ComputeTermResult{Ok: true, TermTitle: term.Title, Totals: map[string]float64{"gross": 0, "deductions": 0, "net": 0}}
	lockedIDs := []int64{}

	for _, staffID := range staffIDs {
		contract, ok := data.Contracts[staffID]
		if !ok {
			res.SkippedNoContract++
			continue
		}
		existing := data.StatementsByStaff[staffID]
		if existing != nil && existing.Status != nil && *existing.Status == "FINAL_SETTLED" {
			res.SkippedSettled++
			continue
		}
		if existing != nil && existing.Status != nil &&
			*existing.Status != "DRAFT" && *existing.Status != "MID_TERM_PAID" {
			res.SkippedLocked++
			lockedIDs = append(lockedIDs, existing.ID)
			continue
		}
		calc, err := CalcStaffPayrollFromData(data, staffID)
		if err != nil {
			continue
		}
		deductions := calc.Tax + calc.AbsenceDeductionRial
		detailMap := map[string]any{
			"rows": calc.Rows, "rate": calc.Rate, "dutyUnits": calc.DutyUnits, "taxRate": calc.TaxRate,
			"rateSource": calc.RateSource, "rateDivisor": calc.RateDivisor,
			"absenceDeductionRial": calc.AbsenceDeductionRial, "staff": calc.Staff, "gates": calc.Gates,
			"engine": "payroll-engine.v2", "scale": UnitScale,
		}
		detailB, _ := json.Marshal(detailMap)
		res.Totals["gross"] += calc.Gross
		res.Totals["deductions"] += deductions
		res.Totals["net"] += calc.Net

		// term snapshot stamp: the contract snapshot if present, otherwise this computation's value.
		snapRank := contract.RankSnapshot
		if snapRank == nil {
			snapRank = calc.Staff.Rank
		}
		snapBase := contract.BaseSnapshot
		snapRate := calc.Rate
		if contract.RateSnapshot != nil {
			snapRate = *contract.RateSnapshot
		}
		rateStr := strconv.FormatFloat(snapRate, 'f', -1, 64)

		if existing != nil {
			updates = append(updates, updateRow{
				id: existing.ID,
				totalEquiv: strconv.FormatFloat(calc.TotalEquivalentUnits, 'f', -1, 64),
				payable:    strconv.FormatFloat(calc.PayableUnits, 'f', -1, 64),
				gross:      strconv.FormatFloat(calc.Gross, 'f', -1, 64),
				deductions: strconv.FormatFloat(deductions, 'f', -1, 64),
				net:        strconv.FormatFloat(calc.Net, 'f', -1, 64),
				detail:     string(detailB),
				rank:       snapRank, base: snapBase, rate: rateStr,
			})
		} else {
			inserts = append(inserts, insertRow{
				contractID: contract.ID,
				totalEquiv: strconv.FormatFloat(calc.TotalEquivalentUnits, 'f', -1, 64),
				payable:    strconv.FormatFloat(calc.PayableUnits, 'f', -1, 64),
				gross:      strconv.FormatFloat(calc.Gross, 'f', -1, 64),
				deductions: strconv.FormatFloat(deductions, 'f', -1, 64),
				net:        strconv.FormatFloat(calc.Net, 'f', -1, 64),
				detail:     string(detailB),
				rank:       snapRank, base: snapBase, rate: rateStr,
			})
		}
		res.Computed++
	}

	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	for _, in := range inserts {
		if _, err := tx.Exec(ctx, `
			insert into payroll_statements ("contractId","totalEquivalentUnits","payableUnits","grossAmount","deductions","netAmount","detailJson",status,"rankSnapshot","baseSnapshot","rateSnapshot")
			values ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10)`,
			in.contractID, in.totalEquiv, in.payable, in.gross, in.deductions, in.net, in.detail,
			in.rank, in.base, in.rate); err != nil {
			return nil, err
		}
	}
	for _, u := range updates {
		if _, err := tx.Exec(ctx, `
			update payroll_statements set
			  "totalEquivalentUnits" = $2, "payableUnits" = $3, "grossAmount" = $4,
			  "deductions" = $5, "netAmount" = $6, "detailJson" = $7, "computedAt" = now(),
			  "rankSnapshot" = $8, "baseSnapshot" = $9, "rateSnapshot" = $10
			 where id = $1`,
			u.id, u.totalEquiv, u.payable, u.gross, u.deductions, u.net, u.detail,
			u.rank, u.base, u.rate); err != nil {
			return nil, fmt.Errorf("به‌روزرسانی فیش %d ناموفق: %w", u.id, err)
		}
	}
	totalsJSON, _ := json.Marshal(map[string]any{
		"computed": res.Computed, "skippedNoContract": res.SkippedNoContract,
		"skippedSettled": res.SkippedSettled, "skippedLocked": res.SkippedLocked,
		"lockedIds": lockedIDs, "totals": res.Totals,
	})
	if err := writeAudit(ctx, tx, actorUserID, "PAYROLL_COMPUTED", "term", &term.ID, string(totalsJSON)); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return res, nil
}

// PayMidterm midterm advance — percentage from settings, paid in a transaction with row-level locking.
func (e *Engine) PayMidterm(ctx context.Context, staffID int64, actorUserID *int64, termID *int64) (float64, error) {
	term, err := e.CurrentTerm(ctx, termID)
	if err != nil {
		return 0, err
	}
	if term == nil {
		return 0, errors.New("ترم جاری مشخص نیست.")
	}
	pct := e.Settings.GetNumber(ctx, "PAYROLL_MIDTERM_PERCENT", 40)

	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var psID int64
	var status string
	var netAmount, midtermPaid float64
	err = tx.QueryRow(ctx, `
		select ps.id, coalesce(ps.status,''), ps."netAmount"::float8, ps."midtermPaidAmount"::float8
		  from payroll_statements ps
		  join professor_term_contracts pc on pc.id = ps."contractId"
		 where pc."staffId" = $1 and pc."termId" = $2
		 for update of ps`, staffID, term.ID).
		Scan(&psID, &status, &netAmount, &midtermPaid)
	if err != nil {
		return 0, errors.New("ابتدا فیش ترم را محاسبه کنید.")
	}
	if status != "DRAFT" {
		return 0, errors.New("علی‌الحساب میان‌ترم قبلاً پرداخت یا تسویه شده است.")
	}
	amount := PercentOf(netAmount, pct)
	if _, err := tx.Exec(ctx, `
		update payroll_statements set "midtermPaidAmount" = $1, "midtermPaidAt" = now(), status = 'MID_TERM_PAID'
		 where id = $2`, strconv.FormatFloat(amount, 'f', -1, 64), psID); err != nil {
		return 0, err
	}
	details, _ := json.Marshal(map[string]any{"amount": amount, "pct": pct, "statementId": psID})
	if err := writeAudit(ctx, tx, actorUserID, "PAYROLL_MIDTERM", "staff", &staffID, string(details)); err != nil {
		return 0, err
	}
	var userID int64
	_ = tx.QueryRow(ctx, `select "userId" from staff where id = $1`, staffID).Scan(&userID)
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	if userID > 0 {
		e.notify(ctx, userID, "PAYROLL_MIDTERM",
			fmt.Sprintf("استاد گرامی، علی‌الحساب میان‌ترم حق‌التدریس شما به مبلغ %s ریال پرداخت شد.", groupThousands(amount)))
	}
	return amount, nil
}

// SettleFinal final settlement — both gates must be closed and the payslip DEAN_APPROVED.
func (e *Engine) SettleFinal(ctx context.Context, staffID int64, actorUserID *int64, termID *int64, afterSettle func(tx pgx.Tx, statementID int64) error) (float64, Gates, error) {
	term, err := e.CurrentTerm(ctx, termID)
	if err != nil {
		return 0, Gates{}, err
	}
	if term == nil {
		return 0, Gates{}, errors.New("ترم جاری مشخص نیست.")
	}
	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return 0, Gates{}, err
	}
	defer tx.Rollback(ctx)

	var psID int64
	var status string
	var netAmount, midtermPaid, finalPaid float64
	err = tx.QueryRow(ctx, `
		select ps.id, coalesce(ps.status,''), ps."netAmount"::float8,
		       ps."midtermPaidAmount"::float8, ps."finalPaidAmount"::float8
		  from payroll_statements ps
		  join professor_term_contracts pc on pc.id = ps."contractId"
		 where pc."staffId" = $1 and pc."termId" = $2
		 for update of ps`, staffID, term.ID).
		Scan(&psID, &status, &netAmount, &midtermPaid, &finalPaid)
	if err != nil {
		return 0, Gates{}, errors.New("ابتدا فیش ترم را محاسبه کنید.")
	}
	if status == "FINAL_SETTLED" {
		return 0, Gates{}, errors.New("این فیش قبلاً تسویه شده است.")
	}
	if status != "DEAN_APPROVED" {
		return 0, Gates{}, errors.New("تسویهٔ نهایی فقط پس از تأیید معاونت آموزشی ممکن است (وضعیت فعلی نیازمند طی زنجیرهٔ تأیید است).")
	}
	g, err := loadStaffGates(ctx, tx, term.ID, staffID)
	if err != nil {
		return 0, Gates{}, err
	}
	if !g.GradesFinalized {
		return 0, Gates{}, fmt.Errorf("گلوگاه تسویه: %d نمره هنوز FINALIZED نشده است.", g.PendingGrades)
	}
	if !g.DocsSigned {
		return 0, Gates{}, fmt.Errorf("گلوگاه تسویه: %d سند الکترونیکی امضانشده دارید.", g.UnsignedDocs)
	}
	paid := midtermPaid + finalPaid
	amount := maxF(0, netAmount-paid)
	tag, err := tx.Exec(ctx, `
		update payroll_statements set "finalPaidAmount" = $1, "finalPaidAt" = now(), status = 'FINAL_SETTLED'
		 where id = $2 and status = 'DEAN_APPROVED'`,
		strconv.FormatFloat(amount, 'f', -1, 64), psID)
	if err != nil {
		return 0, Gates{}, err
	}
	if tag.RowsAffected() != 1 {
		return 0, Gates{}, errors.New("وضعیت فیش در همین لحظه تغییر کرده است؛ تسویه انجام نشد. دوباره تلاش کنید.")
	}
	details, _ := json.Marshal(map[string]any{"amount": amount, "statementId": psID, "gates": g})
	if err := writeAudit(ctx, tx, actorUserID, "PAYROLL_SETTLED", "staff", &staffID, string(details)); err != nil {
		return 0, Gates{}, err
	}
	if afterSettle != nil {
		if err := afterSettle(tx, psID); err != nil {
			return 0, Gates{}, err
		}
	}
	var userID int64
	_ = tx.QueryRow(ctx, `select "userId" from staff where id = $1`, staffID).Scan(&userID)
	if err := tx.Commit(ctx); err != nil {
		return 0, Gates{}, err
	}
	if userID > 0 {
		e.notify(ctx, userID, "PAYROLL_SETTLED",
			fmt.Sprintf("استاد گرامی، تسویهٔ نهایی حق‌التدریس ترم به مبلغ %s ریال انجام شد. سپاس از به‌موقع‌بودن ثبت نمرات.", groupThousands(amount)))
	}
	return amount, g, nil
}

// PayslipResponse a professor's payslip for the professor portal/admin dialog.
type PayslipResponse struct {
	Term      string             `json:"term"`
	Computed  bool               `json:"computed"`
	Calc      *StaffPayroll      `json:"calc"`
	Statement *PayslipStatement  `json:"statement"`
}

// PayslipStatement the stored payslip.
type PayslipStatement struct {
	ID             int64   `json:"id"`
	Status         string  `json:"status"`
	MidtermPaid    float64 `json:"midtermPaidAmount"`
	MidtermPaidAt  *string `json:"midtermPaidAt"`
	FinalPaid      float64 `json:"finalPaidAmount"`
	FinalPaidAt    *string `json:"finalPaidAt"`
	Remaining      float64 `json:"remaining"`
}

// GetStaffPayslip a professor's current payslip.
func (e *Engine) GetStaffPayslip(ctx context.Context, staffID int64, termID *int64) (*PayslipResponse, error) {
	term, err := e.CurrentTerm(ctx, termID)
	if err != nil {
		return nil, err
	}
	if term == nil {
		return nil, errors.New("ترم جاری مشخص نیست.")
	}
	data, err := e.LoadTermPayrollData(ctx, term.ID)
	if err != nil {
		return nil, err
	}
	calc, err := CalcStaffPayrollFromData(data, staffID)
	if err != nil {
		return nil, err
	}
	resp := &PayslipResponse{Term: term.Title, Computed: false, Calc: calc}
	ps := data.StatementsByStaff[staffID]
	if ps == nil {
		return resp, nil
	}
	midtermPaid, finalPaid := 0.0, 0.0
	if ps.MidtermPaid != nil {
		midtermPaid = ToRial(*ps.MidtermPaid)
	}
	if ps.FinalPaid != nil {
		finalPaid = ToRial(*ps.FinalPaid)
	}
	status := "DRAFT"
	if ps.Status != nil {
		status = *ps.Status
	}
	resp.Computed = true
	resp.Statement = &PayslipStatement{
		ID: ps.ID, Status: status,
		MidtermPaid: midtermPaid, FinalPaid: finalPaid,
		Remaining: maxF(0, calc.Net-midtermPaid-finalPaid),
	}
	return resp, nil
}

// ExportBatch bulk deposit export (bank CSV).
func (e *Engine) ExportBatch(ctx context.Context, termID *int64) (csv string, count int, termTitle string, err error) {
	ov, err := e.GetOverview(ctx, termID)
	if err != nil {
		return "", 0, "", err
	}
	headers := []string{
		"ردیف", "شناسه پرسنلی", "کد ملی", "نام استاد", "مرتبه علمی", "مدرک تحصیلی", "نوع قرارداد",
		"شماره حساب بانکی", "نام بانک", "شعبه بانک", "شبا",
		"مبلغ ناخالص حق‌التدریس (ریال)", "کسر غیبت (ریال)", "مالیات (ریال)", "بیمه (ریال)", "سایر کسورات (ریال)",
		"مجموع کسورات (ریال)", "مبلغ خالص قابل واریز (ریال)",
		"واحدهای تدریس (معادل)", "ساعات تدریس", "ساعات غیبت",
		"واحدهای موظفی (الزامی)", "واحدهای مشمول محاسبه",
		"ضریب درس عملی", "ضریب مقطع ارشد", "ضریب کلاس جمعی",
		"نرخ پایه هر واحد (ریال)", "نرخ موثر با ضرایب (ریال)",
		"وضعیت فیش", "پرداخت میان‌ترم (ریال)", "پرداخت نهایی (ریال)", "باقی‌مانده قابل پرداخت (ریال)",
	}
	lines := []string{strings.Join(headers, ",")}
	for _, x := range ov.List {
		if x.Status == "NOT_COMPUTED" {
			continue
		}
		var bankAccount, nationalCode string
		var code *string
		_ = e.Pool.QueryRow(ctx, `
			select coalesce(st."bankAccountNo",''), coalesce(u."nationalCode",''), st."staffCode"
			  from staff st join users u on u.id = st."userId" where st.id = $1`, x.ID).
			Scan(&bankAccount, &nationalCode, &code)
		staffCode := ""
		if code != nil {
			staffCode = *code
		} else {
			staffCode = strconv.FormatInt(x.ID, 10)
		}
		slip, err := e.GetStaffPayslip(ctx, x.ID, termID)
		if err != nil {
			continue
		}
		totalTeachingUnits, totalTeachingHours, totalAbsenceHours := 0.0, 0.0, 0.0
		practicalCoef, msCoef, crowdedCoef := 1.0, 1.0, 1.0
		for _, row := range slip.Calc.Rows {
			totalTeachingUnits += row.EquivalentUnits
			totalTeachingHours += float64(row.Sessions.Held) * 2
			totalAbsenceHours += float64(row.Sessions.NetAbsences) * 2
			coefText := row.Coefficients
			if strings.Contains(coefText, "عملی") {
				if m, ok := extractCoef(coefText, "عملی"); ok {
					practicalCoef = m
				}
			}
			if strings.Contains(coefText, "ارشد") {
				if m, ok := extractCoef(coefText, "ارشد"); ok {
					msCoef = m
				}
			}
			if strings.Contains(coefText, "جمعی") {
				if m, ok := extractCoef(coefText, "جمعی"); ok {
					crowdedCoef = m
				}
			}
		}
		effectiveRate := mathRoundF(x.Rate * practicalCoef * msCoef * crowdedCoef)
		amt := x.Remaining
		if x.Status == "FINAL_SETTLED" {
			amt = 0
		}
		totalDeductions := x.Tax + x.AbsenceDeductionRial
		row := []string{
			strconv.Itoa(count + 1),
			`"` + staffCode + `"`, `"` + nationalCode + `"`, `"` + x.Name + `"`,
			`"` + deref(x.Rank) + `"`, `"` + deref(x.Degree) + `"`, `"` + deref(x.ContractType) + `"`,
			`"` + bankAccount + `"`, `""`, `""`, `""`,
			strconv.FormatFloat(x.Gross, 'f', -1, 64),
			strconv.FormatFloat(x.AbsenceDeductionRial, 'f', -1, 64),
			strconv.FormatFloat(x.Tax, 'f', -1, 64),
			"0", "0",
			strconv.FormatFloat(totalDeductions, 'f', -1, 64),
			strconv.FormatFloat(amt, 'f', -1, 64),
			strconv.FormatFloat(totalTeachingUnits, 'f', 2, 64),
			strconv.FormatFloat(totalTeachingHours, 'f', 0, 64),
			strconv.FormatFloat(totalAbsenceHours, 'f', 0, 64),
			strconv.FormatFloat(x.DutyUnits, 'f', 2, 64),
			strconv.FormatFloat(x.PayableUnits, 'f', 2, 64),
			strconv.FormatFloat(practicalCoef, 'f', 2, 64),
			strconv.FormatFloat(msCoef, 'f', 2, 64),
			strconv.FormatFloat(crowdedCoef, 'f', 2, 64),
			strconv.FormatFloat(x.Rate, 'f', -1, 64),
			strconv.FormatFloat(effectiveRate, 'f', 0, 64),
			`"` + x.Status + `"`,
			strconv.FormatFloat(x.MidtermPaid, 'f', -1, 64),
			strconv.FormatFloat(x.FinalPaid, 'f', -1, 64),
			strconv.FormatFloat(x.Remaining, 'f', -1, 64),
		}
		lines = append(lines, strings.Join(row, ","))
		count++
	}
	return strings.Join(lines, "\n"), count, ov.Term, nil
}

// extractCoef extracts the number from "practical ×1.5".
func extractCoef(text, key string) (float64, bool) {
	idx := strings.Index(text, key)
	if idx < 0 {
		return 0, false
	}
	rest := text[idx+len(key):]
	rest = strings.TrimSpace(rest)
	rest = strings.TrimPrefix(rest, "×")
	rest = strings.TrimPrefix(rest, "x")
	end := 0
	for end < len(rest) && (rest[end] == '.' || (rest[end] >= '0' && rest[end] <= '9')) {
		end++
	}
	if end == 0 {
		return 0, false
	}
	v, err := strconv.ParseFloat(rest[:end], 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// PayConfig transparent engine configuration for the finance panel.
type PayConfig struct {
	Year      int          `json:"year"`
	Coefs     coefs        `json:"coefs"`
	Crowded   float64      `json:"crowded"`
	Sessions  float64      `json:"sessions"`
	Midterm   float64      `json:"midterm"`
	Rates     []PayRateRow `json:"rates"`
	Rules     []PayRule    `json:"rules"`
}

// PayRateRow teaching rate row.
type PayRateRow struct {
	AcademicRank   string  `json:"academicRank"`
	Degree         string  `json:"degree"`
	AcademicBase   *string `json:"academicBase"`
	BaseRatePerUnit float64 `json:"baseRatePerUnit"`
	EffectiveYear  int     `json:"effectiveYear"`
}

// ListPayConfiguration formula-builder rules and current coefficients.
func (e *Engine) ListPayConfiguration(ctx context.Context) (*PayConfig, error) {
	cfg := &PayConfig{Rates: []PayRateRow{}, Rules: []PayRule{}}
	var err error
	if cfg.Coefs, err = e.loadCoefficients(ctx); err != nil {
		return nil, err
	}
	if cfg.Rules, err = e.loadPayRules(ctx); err != nil {
		return nil, err
	}
	cfg.Year = e.FiscalYear(ctx)
	cfg.Crowded = e.Settings.GetNumber(ctx, "PAYROLL_CROWDED_THRESHOLD", 40)
	cfg.Sessions = e.Settings.GetNumber(ctx, "PAYROLL_TERM_SESSIONS", 16)
	cfg.Midterm = e.Settings.GetNumber(ctx, "PAYROLL_MIDTERM_PERCENT", 40)
	rows, err := e.Pool.Query(ctx, `
		select "academicRank", "degree", "academicBase", "baseRatePerUnit"::float8, "effectiveYear"
		  from teaching_rates order by "effectiveYear"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r PayRateRow
		if err := rows.Scan(&r.AcademicRank, &r.Degree, &r.AcademicBase, &r.BaseRatePerUnit, &r.EffectiveYear); err == nil {
			cfg.Rates = append(cfg.Rates, r)
		}
	}
	return cfg, nil
}
