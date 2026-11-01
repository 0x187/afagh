// ═══ Student statement/finance transcript — port of api/admin/finance/reports/student-statement ═══
package student

import (
	"context"
	"math"
	"strings"

	"backend-go/internal/finance"
)

// StatementCourse is one course's variable-tuition detail in the official document.
type StatementCourse struct {
	CourseCode  *string `json:"courseCode"`
	CourseTitle *string `json:"courseTitle"`
	Units       float64 `json:"units"`
	PerUnit     float64 `json:"perUnit"`
	Amount      float64 `json:"amount"`
}

// StatementRow is a term row in the statement: the SAMA display split + canonical numbers.
type StatementRow struct {
	TermID    int64  `json:"termId"`
	TermCode  string `json:"termCode"`
	TermTitle string `json:"termTitle"`

	TuitionFixed     float64 `json:"tuitionFixed"`
	TuitionVariable  float64 `json:"tuitionVariable"`
	DiscountFixed    float64 `json:"discountFixed"`
	DiscountVariable float64 `json:"discountVariable"`
	SubjectAdditive  float64 `json:"subjectAdditive"`
	SubjectDeductive float64 `json:"subjectDeductive"`
	Sponsorship      float64 `json:"sponsorship"`
	Payments         float64 `json:"payments"`
	POSPayments      float64 `json:"posPayments"`
	Loans            float64 `json:"loans"`

	Charges           float64 `json:"charges"`
	Discounts         float64 `json:"discounts"`
	Sponsorships      float64 `json:"sponsorships"`
	CanonicalPayments float64 `json:"canonicalPayments"`
	ChequesCleared    float64 `json:"chequesCleared"`
	ChequesPending    float64 `json:"chequesPending"`
	ChequesBounced    float64 `json:"chequesBounced"`
	CanonicalLoans    float64 `json:"canonicalLoans"`
	NetPayable        float64 `json:"netPayable"`
	Balance           float64 `json:"balance"`

	Courses      []StatementCourse `json:"courses"`
	CoursesBasis string            `json:"coursesBasis"`
}

// StatementStudent is the document identity.
type StatementStudent struct {
	Name string `json:"name"`
	Code string `json:"code"`
}

// StudentStatement is the full statement response.
type StudentStatement struct {
	Rows    []StatementRow   `json:"rows"`
	Totals  FinanceTotals    `json:"totals"`
	Balance float64          `json:"balance"`
	Student StatementStudent `json:"student"`
}

// GetStudentStatement builds the official statement from the canonical path:
//   - rows and totals come from buildFinance (the same finance-statement engine).
//   - the overall balance comes from finance.LedgerBalance over the whole ledger (all terms).
//   - the SAMA column split is display-only (a 1:1 mapping from the raw transaction type).
//   - course details: weights from the official yearly tariff, totals from the ledger's "variable tuition".
func (s *Service) GetStudentStatement(ctx context.Context, studentID int64) (*StudentStatement, error) {
	fin, err := s.GetFinanceByStudentID(ctx, studentID, nil)
	if err != nil {
		return nil, err
	}

	// The whole ledger (all terms) — the 5000-row cap is an exhaustion guard.
	type ledgerRow struct {
		TermID *int64
		Type   *string
		Amount float64
	}
	rows := []ledgerRow{}
	lrows, err := s.Pool.Query(ctx, `
		select "termId", "transactionType", amount::float8
		  from student_ledger where "studentId" = $1 limit 5000`, studentID)
	if err != nil {
		return nil, err
	}
	for lrows.Next() {
		var r ledgerRow
		if err := lrows.Scan(&r.TermID, &r.Type, &r.Amount); err == nil {
			rows = append(rows, r)
		}
	}
	lrows.Close()

	const noTerm = int64(0)
	byTermType := map[int64]map[string]float64{}
	balanceRows := make([]finance.LedgerBalanceRow, 0, len(rows))
	for _, r := range rows {
		key := noTerm
		if r.TermID != nil {
			key = *r.TermID
		}
		t := ""
		if r.Type != nil {
			t = strings.ToUpper(strings.TrimSpace(*r.Type))
		}
		slot := byTermType[key]
		if slot == nil {
			slot = map[string]float64{}
			byTermType[key] = slot
		}
		slot[t] += r.Amount
		balanceRows = append(balanceRows, finance.LedgerBalanceRow{TransactionType: r.Type, Amount: r.Amount})
	}
	balance := finance.LedgerBalance(balanceRows)

	// Course details — the same path as buildTranscriptCourses.
	termIDs := make([]int64, 0, len(fin.Terms))
	for _, t := range fin.Terms {
		termIDs = append(termIDs, t.TermID)
	}
	tariffMap := map[int64][]tuitionTariffLine{}
	engineMap := map[int64][]tuitionCourseLine{}
	if s.Tuition != nil {
		for id, lines := range s.Tuition.ComputeTariffCourseLinesForTerms(ctx, studentID, termIDs) {
			out := make([]tuitionTariffLine, 0, len(lines))
			for _, l := range lines {
				out = append(out, tuitionTariffLine{Code: l.CourseCode, Title: l.CourseTitle, Units: l.Units, Amount: l.Amount})
			}
			tariffMap[id] = out
		}
		for id, lines := range s.Tuition.ComputeCourseTuitionForTerms(ctx, studentID, termIDs) {
			out := make([]tuitionCourseLine, 0, len(lines))
			for _, l := range lines {
				out = append(out, tuitionCourseLine{Code: l.CourseCode, Title: l.CourseTitle, Units: l.Units, Amount: l.Amount})
			}
			engineMap[id] = out
		}
	}

	out := &StudentStatement{
		Rows:    []StatementRow{},
		Totals:  fin.Totals,
		Balance: balance,
		Student: StatementStudent{Name: fin.Student.FullName, Code: fin.Student.StudentCode},
	}
	for _, st := range fin.Terms {
		byType := byTermType[st.TermID]
		get := func(t string) float64 {
			if byType == nil {
				return 0
			}
			return byType[t]
		}
		termCode := ""
		if st.TermCode != nil {
			termCode = *st.TermCode
		}
		tariff, tariffOK := tariffMap[st.TermID]
		var courses []StatementCourse
		basis := "LEDGER"
		if tariffOK {
			courses = allocateStatementCourses(tariff, get("TUITION_VARIABLE"))
			basis = "TARIFF"
		} else {
			courses = allocateStatementCourses(engineMap[st.TermID], get("TUITION_VARIABLE"))
		}
		out.Rows = append(out.Rows, StatementRow{
			TermID: st.TermID, TermCode: termCode, TermTitle: st.TermTitle,
			TuitionFixed: get("TUITION_FIXED"), TuitionVariable: get("TUITION_VARIABLE"),
			DiscountFixed: get("DISCOUNT_FIXED"), DiscountVariable: get("DISCOUNT_VARIABLE"),
			SubjectAdditive: get("SUBJECT_ADDITIVE"), SubjectDeductive: get("SUBJECT_DEDUCTIVE"),
			Sponsorship: get("SPONSORSHIP"), Payments: get("PAYMENT"), POSPayments: get("POS_PAYMENT"),
			Loans:   get("LOAN"),
			Charges: st.Charges, Discounts: st.Discounts, Sponsorships: st.Sponsorships,
			CanonicalPayments: st.Payments, ChequesCleared: st.ChequesCleared,
			ChequesPending: st.ChequesPending, ChequesBounced: st.ChequesBounced,
			CanonicalLoans: st.Loans, NetPayable: st.NetPayable, Balance: st.Balance,
			Courses: courses, CoursesBasis: basis,
		})
	}
	return out, nil
}

type tuitionTariffLine struct {
	Code   string
	Title  string
	Units  float64
	Amount float64
}

type tuitionCourseLine struct {
	Code   string
	Title  string
	Units  float64
	Amount float64
}

// allocateStatementCourses distributes the ledger's "variable tuition" amount across courses
// proportionally to the weights (tariff/engine amount, or units when all are zero).
func allocateStatementCourses[T interface {
	courseFields() (string, string, float64, float64)
}](lines []T, target float64) []StatementCourse {
	if len(lines) == 0 {
		return []StatementCourse{}
	}
	weights := make([]float64, len(lines))
	units := make([]float64, len(lines))
	codes := make([]string, len(lines))
	titles := make([]string, len(lines))
	anyWeight := false
	for i, l := range lines {
		c, t, u, a := l.courseFields()
		codes[i], titles[i], units[i], weights[i] = c, t, u, a
		if a > 0 {
			anyWeight = true
		}
	}
	var shares []float64
	if target > 0 {
		w := weights
		if !anyWeight {
			w = units
		}
		shares = finance.AllocateWeightedShares(w, target)
	} else {
		shares = make([]float64, len(lines))
		for i, v := range weights {
			shares[i] = math.Floor(v + 0.5)
		}
	}
	out := make([]StatementCourse, len(lines))
	for i := range lines {
		perUnit := 0.0
		if units[i] > 0 {
			perUnit = math.Floor(shares[i]/units[i] + 0.5)
		}
		code, title := codes[i], titles[i]
		out[i] = StatementCourse{
			CourseCode: &code, CourseTitle: &title,
			Units: units[i], PerUnit: perUnit, Amount: shares[i],
		}
	}
	return out
}

func (l tuitionTariffLine) courseFields() (string, string, float64, float64) {
	return l.Code, l.Title, l.Units, l.Amount
}

func (l tuitionCourseLine) courseFields() (string, string, float64, float64) {
	return l.Code, l.Title, l.Units, l.Amount
}
