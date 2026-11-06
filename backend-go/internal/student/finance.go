// ═══ Student finance — port of student/finance + finance-engine/student-detail ═══
package student

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"backend-go/internal/finance"
	"backend-go/internal/jalali"
	"backend-go/internal/qr"
)

// FinanceStudent is the student identity in the finance document.
type FinanceStudent struct {
	StudentID    int64   `json:"studentId"`
	UserID       int64   `json:"userId"`
	StudentCode  string  `json:"studentCode"`
	FullName     string  `json:"fullName"`
	NationalCode *string `json:"nationalCode"`
	MajorTitle   *string `json:"majorTitle"`
	DegreeTitle  *string `json:"degreeTitle"`
	EntryYear    int     `json:"entryYear"`
	Status       string  `json:"status"`
	EntryTerm    *int    `json:"entryTerm"`
}

// FinanceEvent is a term financial event.
type FinanceEvent struct {
	Kind   string  `json:"kind"`
	Label  string  `json:"label"`
	Amount float64 `json:"amount"`
	DateMs *int64  `json:"dateMs"`
	Sign   int     `json:"sign"`
	// Deposit metadata (migrations 0119/0121) — real bank deposit info.
	DepositType       *string `json:"depositType,omitempty"`
	DatedByDeposit    bool    `json:"datedByDeposit,omitempty"`
	PayerName         *string `json:"payerName,omitempty"`
	PayerNationalCode *string `json:"payerNationalCode,omitempty"`
	ReceiptNo         *string `json:"receiptNo,omitempty"`
	VoucherNo         *string `json:"voucherNo,omitempty"`
	PayTypeCode       *int64  `json:"payTypeCode,omitempty"`
	AccountNo         *string `json:"accountNo,omitempty"`
	CardNo            *string `json:"cardNo,omitempty"`
	BankName          *string `json:"bankName,omitempty"`
	RecorderName      *string `json:"recorderName,omitempty"`
	LegacyRem         *string `json:"legacyRem,omitempty"`
}

// FinanceTerm is one term's statement.
type FinanceTerm struct {
	TermID                   int64          `json:"termId"`
	TermTitle                string         `json:"termTitle"`
	TermCode                 *string        `json:"termCode"`
	StatusTitle              *string        `json:"statusTitle"`
	Charges                  float64        `json:"charges"`
	TuitionFixed             float64        `json:"tuitionFixed"`
	TuitionVariable          float64        `json:"tuitionVariable"`
	Discounts                float64        `json:"discounts"`
	Sponsorships             float64        `json:"sponsorships"`
	SponsorshipsFromDeposits float64        `json:"sponsorshipsFromDeposits"`
	CharityCoverage          float64        `json:"charityCoverage"`
	Payments                 float64        `json:"payments"`
	ChequesCleared           float64        `json:"chequesCleared"`
	ChequesPending           float64        `json:"chequesPending"`
	ChequesBounced           float64        `json:"chequesBounced"`
	Loans                    float64        `json:"loans"`
	NetPayable               float64        `json:"netPayable"`
	Balance                  float64        `json:"balance"`
	Events                   []FinanceEvent `json:"events"`
}

// FinanceCheque is a cheque.
type FinanceCheque struct {
	ID       int64   `json:"id"`
	TermID   *int64  `json:"termId"`
	ChequeNo *string `json:"chequeNo"`
	BankName *string `json:"bankName"`
	Amount   float64 `json:"amount"`
	DueDate  *string `json:"dueDate"`
	Status   *string `json:"status"`
}

// FinanceLoan is a loan.
type FinanceLoan struct {
	ID           int64   `json:"id"`
	TermID       *int64  `json:"termId"`
	ProductTitle *string `json:"productTitle"`
	Lender       *string `json:"lender"`
	Amount       float64 `json:"amount"`
	Installments *int    `json:"installments"`
	Status       *string `json:"status"`
}

// FinanceNotification is a financial message.
type FinanceNotification struct {
	ID     int64   `json:"id"`
	Text   string  `json:"text"`
	DateMs *int64  `json:"dateMs"`
	Event  *string `json:"event"`
}

// DueCheque is a cheque nearing its due date.
type DueCheque struct {
	ID       int64   `json:"id"`
	ChequeNo *string `json:"chequeNo"`
	BankName *string `json:"bankName"`
	Amount   float64 `json:"amount"`
	DaysLeft *int    `json:"daysLeft"`
	Overdue  bool    `json:"overdue"`
}

// FinanceTotals are the totals.
type FinanceTotals struct {
	Charges        float64 `json:"charges"`
	Discounts      float64 `json:"discounts"`
	Sponsorships   float64 `json:"sponsorships"`
	Payments       float64 `json:"payments"`
	ChequesCleared float64 `json:"chequesCleared"`
	ChequesPending float64 `json:"chequesPending"`
	ChequesBounced float64 `json:"chequesBounced"`
	Loans          float64 `json:"loans"`
	Balance        float64 `json:"balance"`
}

// FinanceQR is the verification block.
type FinanceQR struct {
	URL       string `json:"url"`
	SVG       string `json:"svg"`
	ExpiresAt string `json:"expiresAt"`
}

// FinanceResponse is the finance page response.
type FinanceResponse struct {
	Student           FinanceStudent        `json:"student"`
	Records           []RecordOption        `json:"records"`
	ActiveRecordID    int64                 `json:"activeRecordId"`
	Terms             []FinanceTerm         `json:"terms"`
	Totals            FinanceTotals         `json:"totals"`
	Cheques           []FinanceCheque       `json:"cheques"`
	Loans             []FinanceLoan         `json:"loans"`
	Notifications     []FinanceNotification `json:"notifications"`
	DueSoon           []DueCheque           `json:"dueSoon"`
	SelectedTermTitle *string               `json:"selectedTermTitle"`
	University        UniversityInfo        `json:"university"`
	IssuedAt          string                `json:"issuedAt"`
	QR                *FinanceQR            `json:"qr"`
}

// GetFinance ports the student-side getStudentFinance + the finance page.
func (s *Service) GetFinance(ctx context.Context, userID int64, recordID *int64, termCookie *int64, publicBaseURL string) (*FinanceResponse, error) {
	picked, err := s.Resolve(ctx, userID)
	if err != nil {
		return nil, err
	}
	if picked == nil {
		return nil, errNoStudent
	}
	me, err := s.resolveRecord(ctx, userID, picked, recordID)
	if err != nil {
		return nil, err
	}
	return s.buildFinance(ctx, userID, me, termCookie, publicBaseURL)
}

// GetFinanceByStudentID is the admin version of the same engine (port of admin/finance/student/[id],
// which itself calls getStudentFinance) — the cartable number and the finance statement
// cannot diverge because both go through one path.
func (s *Service) GetFinanceByStudentID(ctx context.Context, studentID int64, termCookie *int64) (*FinanceResponse, error) {
	var rec Record
	err := s.Pool.QueryRow(ctx, `
		select id, "userId", "studentCode", "universityId", "majorId", "degreeLevelId",
		       "regulationId", "entryYear", "entryTerm", "currentTermNo", status,
		       "studyType"
		  from students where id = $1`, studentID).
		Scan(&rec.ID, &rec.UserID, &rec.StudentCode, &rec.UniversityID, &rec.MajorID, &rec.DegreeLevelID,
			&rec.RegulationID, &rec.EntryYear, &rec.EntryTerm, &rec.CurrentTermNo, &rec.Status,
			&rec.StudyType)
	if err != nil {
		return nil, errNoStudent
	}
	return s.buildFinance(ctx, rec.UserID, &rec, termCookie, "")
}

// buildFinance is the shared body of the finance statement (student and admin).
func (s *Service) buildFinance(ctx context.Context, userID int64, me *Record, termCookie *int64, publicBaseURL string) (*FinanceResponse, error) {
	var (
		fullName, nationalCode, majorTitle, degreeTitle *string
	)
	_ = s.Pool.QueryRow(ctx, `
		select (u."firstName" || ' ' || u."lastName"), u."nationalCode", m.name, d.title
		  from students st
		  join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		  left join degree_level_configs d on d.id = st."degreeLevelId"
		 where st.id = $1`, me.ID).Scan(&fullName, &nationalCode, &majorTitle, &degreeTitle)

	records, err := s.Records(ctx, userID)
	if err != nil {
		return nil, err
	}
	resp := &FinanceResponse{
		Student: FinanceStudent{
			StudentID: me.ID, UserID: userID, StudentCode: me.StudentCode,
			NationalCode: nationalCode, MajorTitle: majorTitle, DegreeTitle: degreeTitle,
			EntryYear: me.EntryYear, Status: me.Status, EntryTerm: me.EntryTerm,
		},
		Records: records, ActiveRecordID: me.ID,
		Terms: []FinanceTerm{}, Cheques: []FinanceCheque{}, Loans: []FinanceLoan{},
		Notifications: []FinanceNotification{}, DueSoon: []DueCheque{},
		University: s.universityInfo(ctx, me.UniversityID),
		IssuedAt:   jalali.ToShamsi(time.Now().Format("2006-01-02")),
	}
	if fullName != nil {
		resp.Student.FullName = strings.TrimSpace(*fullName)
	}

	// Term titles.
	termTitles := map[string]string{}
	termCodes := map[string]string{}
	trows, err := s.Pool.Query(ctx, `select id, coalesce("termCode",''), title from academic_terms`)
	if err == nil {
		for trows.Next() {
			var id int64
			var code, title string
			if err := trows.Scan(&id, &code, &title); err == nil {
				key := itoa64(id)
				termTitles[key] = title
				termCodes[key] = code
			}
		}
		trows.Close()
	}

	// Finance ledger — chronological by the real deposit date when present,
	// falling back to createdAt (migrated rows share one import day).
	ledger := []finance.LedgerTxn{}
	lrows, err := s.Pool.Query(ctx, `
		select id, "termId", "transactionType", amount::float8, description, "createdAt",
		       "depositDate", "depositType", "payerName", "payerNationalCode",
		       "receiptNo", "voucherNo", "payTypeCode", "accountNo", "cardNo",
		       "bankName", "branchName", "recorderCode", "recorderName", "legacyRem"
		  from student_ledger where "studentId" = $1
		 order by coalesce("depositDate", "createdAt"), id`, me.ID)
	if err != nil {
		return nil, err
	}
	for lrows.Next() {
		var t finance.LedgerTxn
		if err := lrows.Scan(&t.ID, &t.TermID, &t.TransactionType, &t.Amount, &t.Description, &t.CreatedAt,
			&t.DepositDate, &t.DepositType, &t.PayerName, &t.PayerNationalCode,
			&t.ReceiptNo, &t.VoucherNo, &t.PayTypeCode, &t.AccountNo, &t.CardNo,
			&t.BankName, &t.BranchName, &t.RecorderCode, &t.RecorderName, &t.LegacyRem); err != nil {
			lrows.Close()
			return nil, err
		}
		ledger = append(ledger, t)
	}
	lrows.Close()

	// Student's term states (from student_term_states) — shown per term in the
	// finance transcript. Priority: statusTitle → normalized → source title.
	termStatuses := map[string]string{}
	tsrows, err := s.Pool.Query(ctx, `
		select "termId", coalesce(nullif("statusTitle",''), nullif("normalizedStatusTitle",''), nullif("sourceStatusTitle",''))
		  from student_term_states where "studentId" = $1 and "termId" is not null`, me.ID)
	if err == nil {
		for tsrows.Next() {
			var termID int64
			var title string
			if err := tsrows.Scan(&termID, &title); err == nil && title != "" {
				termStatuses[itoa64(termID)] = title
			}
		}
		tsrows.Close()
	}

	// Discounts/coverages → term adjustments.
	termCharges := map[int64]float64{}
	for _, t := range ledger {
		key := int64(0)
		if t.TermID != nil {
			key = *t.TermID
		}
		typ := ""
		if t.TransactionType != nil {
			typ = *t.TransactionType
		}
		if finance.IsChargeType(typ) {
			termCharges[key] += finance.ToNum(t.Amount)
		}
	}
	charges := make([]finance.TermCharge, 0, len(termCharges))
	for id, amount := range termCharges {
		charges = append(charges, finance.TermCharge{TermID: id, Charges: amount})
	}
	sort.Slice(charges, func(i, j int) bool { return charges[i].TermID < charges[j].TermID })

	discounts := []finance.DiscountRowLike{}
	drows, err := s.Pool.Query(ctx, `
		select d.id, d."termId", coalesce(d.kind,''), d.percent, d.amount::float8, dt.title
		  from student_discounts d
		  left join tuition_discount_types dt on dt.id = d."discountTypeId"
		 where d."studentId" = $1 and d.status = 'APPROVED'`, me.ID)
	if err == nil {
		for drows.Next() {
			var d finance.DiscountRowLike
			if err := drows.Scan(&d.ID, &d.TermID, &d.Kind, &d.Percent, &d.Amount, &d.Title); err == nil {
				discounts = append(discounts, d)
			}
		}
		drows.Close()
	}
	sponsorships := []finance.SponsorRowLike{}
	srows, err := s.Pool.Query(ctx, `
		select sp.id, sp."termId", coalesce(sp."coverageKind",''),
		       coalesce(greatest(coalesce(sp."fixed_percent",0), coalesce(sp."variable_percent",0)), sp.percent),
		       sp.amount::float8, ts.title
		  from student_sponsorships sp
		  left join tuition_sponsors ts on ts.id = sp."sponsorId"
		 where sp."studentId" = $1 and sp.status in ('CONFIRMED','PAID')`, me.ID)
	if err == nil {
		for srows.Next() {
			var sp finance.SponsorRowLike
			if err := srows.Scan(&sp.ID, &sp.TermID, &sp.CoverageKind, &sp.Percent, &sp.Amount, &sp.Title); err == nil {
				sponsorships = append(sponsorships, sp)
			}
		}
		srows.Close()
	}
	adjustments := finance.ComputeTermAdjustments(charges, discounts, sponsorships)
	discountApplied := []finance.AppliedAmount{}
	sponsorApplied := []finance.AppliedAmount{}
	for _, a := range adjustments {
		tid := a.TermID
		for _, l := range a.DiscountLines {
			l.TermID = &tid
			discountApplied = append(discountApplied, l)
		}
		for _, l := range a.SponsorLines {
			l.TermID = &tid
			sponsorApplied = append(sponsorApplied, l)
		}
	}

	// Cheques.
	cheques := []finance.ChequeRow{}
	crows, err := s.Pool.Query(ctx, `
		select id, "termId", "chequeNo", "bankName", amount::float8, "dueDate", status, "remindedAt"
		  from payment_cheques where "studentId" = $1 order by "dueDate" desc nulls last`, me.ID)
	if err == nil {
		dueRows := []FinanceCheque{}
		for crows.Next() {
			var c finance.ChequeRow
			var dueDate *time.Time
			if err := crows.Scan(&c.ID, &c.TermID, &c.ChequeNo, &c.BankName, &c.Amount, &dueDate, &c.Status, &c.RemindedAt); err != nil {
				continue
			}
			if dueDate != nil {
				c.DueDate = *dueDate
			}
			cheques = append(cheques, c)
			var dueStr *string
			if dueDate != nil {
				v := dueDate.Format(time.RFC3339)
				dueStr = &v
			}
			dueRows = append(dueRows, FinanceCheque{
				ID: c.ID, TermID: c.TermID, ChequeNo: c.ChequeNo, BankName: c.BankName,
				Amount: finance.ToNum(c.Amount), DueDate: dueStr, Status: c.Status,
			})
		}
		crows.Close()
		resp.Cheques = dueRows
	}

	// Loans.
	loans := []finance.LoanRow{}
	loanOut := []FinanceLoan{}
	wrows, err := s.Pool.Query(ctx, `
		select l.id, l."termId", lp.title, l.lender, l.amount::float8, l.installments, l.status, l."createdAt"
		  from student_loans l left join loan_products lp on lp.id = l."loanProductId"
		 where l."studentId" = $1 order by l.id desc`, me.ID)
	if err == nil {
		for wrows.Next() {
			var l finance.LoanRow
			var productTitle *string
			var installments *int
			if err := wrows.Scan(&l.ID, &l.TermID, &productTitle, &l.Lender, &l.Amount, &installments, &l.Status, &l.CreatedAt); err != nil {
				continue
			}
			loans = append(loans, l)
			loanOut = append(loanOut, FinanceLoan{
				ID: l.ID, TermID: l.TermID, ProductTitle: productTitle, Lender: l.Lender,
				Amount: finance.ToNum(l.Amount), Installments: installments, Status: l.Status,
			})
		}
		wrows.Close()
		resp.Loans = loanOut
	}

	// Build the statement.
	statements := finance.BuildTranscript(finance.TranscriptInput{
		Ledger: ledger, Discounts: discountApplied, Sponsorships: sponsorApplied,
		Cheques: cheques, Loans: loans, TermTitles: termTitles, TermCodes: termCodes,
		TermStatuses: termStatuses,
	})

	// Filter by the selected term (cookie).
	selection := s.Scope.GetTermScope(ctx, me.UniversityID, termCookie)
	var selected *int64
	if selection.SelectedID != nil {
		selected = selection.SelectedID
		var title string
		if err := s.Pool.QueryRow(ctx, `select title from academic_terms where id = $1`, *selected).Scan(&title); err == nil {
			resp.SelectedTermTitle = &title
		}
	}
	for _, st := range statements {
		if selected != nil && st.TermID != *selected {
			continue
		}
		term := FinanceTerm{
			TermID: st.TermID, TermTitle: st.TermTitle, TermCode: st.TermCode,
			StatusTitle: st.StatusTitle,
			Charges:     st.Charges, TuitionFixed: st.TuitionFixed, TuitionVariable: st.TuitionVariable,
			Discounts: st.Discounts, Sponsorships: st.Sponsorships,
			SponsorshipsFromDeposits: st.SponsorshipsFromDeposits, CharityCoverage: st.CharityCoverage,
			Payments: st.Payments, ChequesCleared: st.ChequesCleared,
			ChequesPending: st.ChequesPending, ChequesBounced: st.ChequesBounced,
			Loans: st.Loans, NetPayable: st.NetPayable, Balance: st.Balance,
			Events: []FinanceEvent{},
		}
		for _, e := range st.Events {
			term.Events = append(term.Events, FinanceEvent{
				Kind: e.Kind, Label: e.Label, Amount: e.Amount, DateMs: e.DateMs, Sign: e.Sign,
				DepositType: e.DepositType, DatedByDeposit: e.DatedByDeposit,
				PayerName: e.PayerName, PayerNationalCode: e.PayerNationalCode,
				ReceiptNo: e.ReceiptNo, VoucherNo: e.VoucherNo, PayTypeCode: e.PayTypeCode,
				AccountNo: e.AccountNo, CardNo: e.CardNo, BankName: e.BankName,
				RecorderName: e.RecorderName, LegacyRem: e.LegacyRem,
			})
		}
		resp.Terms = append(resp.Terms, term)
	}
	totals := finance.TranscriptTotalsOf(statements)
	if selected != nil {
		totals = finance.TranscriptTotals{}
		for _, st := range statements {
			if st.TermID == *selected {
				totals = finance.TranscriptTotalsOf([]finance.TermStatement{st})
				break
			}
		}
	}
	resp.Totals = FinanceTotals{
		Charges: totals.Charges, Discounts: totals.Discounts, Sponsorships: totals.Sponsorships,
		Payments: totals.Payments, ChequesCleared: totals.ChequesCleared,
		ChequesPending: totals.ChequesPending, ChequesBounced: totals.ChequesBounced,
		Loans: totals.Loans, Balance: totals.Balance,
	}
	if selected != nil {
		filteredCheques := []FinanceCheque{}
		for _, c := range resp.Cheques {
			if c.TermID != nil && *c.TermID == *selected {
				filteredCheques = append(filteredCheques, c)
			}
		}
		resp.Cheques = filteredCheques
		filteredLoans := []FinanceLoan{}
		for _, l := range resp.Loans {
			if l.TermID != nil && *l.TermID == *selected {
				filteredLoans = append(filteredLoans, l)
			}
		}
		resp.Loans = filteredLoans
	}

	// Reminder for cheques near their due date.
	remindDays := 7.0
	if s.Settings != nil {
		remindDays = s.Settings.GetNumber(ctx, "CHEQUE_REMIND_DAYS", 7)
	}
	now := time.Now()
	for _, c := range cheques {
		reminder := finance.ChequeReminderRow{
			ID: c.ID, ChequeNo: c.ChequeNo, Amount: c.Amount, DueDate: c.DueDate,
			Status: c.Status, RemindedAt: c.RemindedAt,
		}
		decision := finance.ChequeNeedsReminder(reminder, now.UnixMilli(), remindDays)
		if !decision.Remind || decision.DaysLeft == nil {
			continue
		}
		resp.DueSoon = append(resp.DueSoon, DueCheque{
			ID: c.ID, ChequeNo: c.ChequeNo, BankName: c.BankName,
			Amount: finance.ToNum(c.Amount), DaysLeft: decision.DaysLeft, Overdue: decision.Overdue,
		})
	}
	sort.Slice(resp.DueSoon, func(i, j int) bool {
		return derefInt(resp.DueSoon[i].DaysLeft) < derefInt(resp.DueSoon[j].DaysLeft)
	})

	// Financial messages (only FINANCE_CHEQUE_DUE).
	nrows, err := s.Pool.Query(ctx, `
		select id, coalesce("eventCode",''), payload, "createdAt"
		  from notifications where "userId" = $1 and "eventCode" = 'FINANCE_CHEQUE_DUE'
		 order by id desc limit 30`, userID)
	if err == nil {
		for nrows.Next() {
			var n FinanceNotification
			var event, payload string
			var created time.Time
			if err := nrows.Scan(&n.ID, &event, &payload, &created); err != nil {
				continue
			}
			n.Event = &event
			ms := created.UnixMilli()
			n.DateMs = &ms
			var parsed struct {
				Text string `json:"text"`
			}
			if jsonUnmarshal(payload, &parsed) == nil {
				n.Text = parsed.Text
			}
			resp.Notifications = append(resp.Notifications, n)
		}
		nrows.Close()
	}

	// QR for finance-statement verification.
	resp.QR = s.issueFinanceQR(ctx, userID, me, publicBaseURL)
	return resp, nil
}

func (s *Service) issueFinanceQR(ctx context.Context, userID int64, me *Record, publicBaseURL string) *FinanceQR {
	if s.Signer == nil || publicBaseURL == "" {
		return nil
	}
	ttlMin := 10080.0
	if s.Settings != nil {
		ttlMin = s.Settings.GetNumber(ctx, "FINANCE_STMT_TTL_MINUTES", 10080)
	}
	if !(ttlMin > 0) || ttlMin > 525600 {
		if ttlMin <= 0 {
			return nil
		}
		ttlMin = 525600
	}
	uni := int64(0)
	if me.UniversityID != nil {
		uni = *me.UniversityID
	}
	token, err := s.Signer.Sign(ctx, map[string]any{
		"uid": userID, "sid": me.ID, "sc": me.StudentCode, "uni": uni, "kind": "FINANCE_STMT",
	}, int(ttlMin)*60)
	if err != nil {
		return nil
	}
	url := trimRightSlash(publicBaseURL) + "/verify-finance/" + token
	svg, err := qr.SVG(url, qr.Options{Level: "M", Size: 160, Margin: 4})
	if err != nil {
		return nil
	}
	return &FinanceQR{URL: url, SVG: svg, ExpiresAt: expiresAtISO(int(ttlMin) * 60)}
}

func itoa64(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	buf := [20]byte{}
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func trimRightSlash(v string) string {
	for len(v) > 0 && v[len(v)-1] == '/' {
		v = v[:len(v)-1]
	}
	return v
}

func derefInt(p *int) int {
	if p == nil {
		return 1 << 30
	}
	return *p
}

func jsonUnmarshal(raw string, out any) error {
	return json.Unmarshal([]byte(raw), out)
}
