// ═══ Term-by-term financial transcript — port of statement.ts ═══
package finance

import (
	"regexp"
	"sort"
	"strings"

	"backend-go/internal/scheduling"
)

// ChequeCleared cleared cheque status.
const ChequeCleared = "CLEARED"

// ChequeRow cheque row.
type ChequeRow struct {
	ID         int64
	TermID     *int64
	ChequeNo   *string
	BankName   *string
	Amount     any
	DueDate    any
	Status     *string
	RemindedAt any
}

// LoanRow loan row — only ACTIVE affects the balance.
type LoanRow struct {
	ID        int64
	TermID    *int64
	Amount    any
	Lender    *string
	Status    *string
	CreatedAt any
}

// LedgerTxn financial ledger transaction.
type LedgerTxn struct {
	ID              int64
	TermID          *int64
	TransactionType *string
	Amount          any
	Description     *string
	CreatedAt       any
	// Real deposit metadata (migrations 0119/0121) — nil for old rows.
	DepositDate       any
	DepositType       *string
	PayerName         *string
	PayerNationalCode *string
	ReceiptNo         *string
	VoucherNo         *string
	PayTypeCode       *int64
	AccountNo         *string
	CardNo            *string
	BankName          *string
	BranchName        *string
	RecorderCode      *int64
	RecorderName      *string
	LegacyRem         *string
}

// StatementEvent transcript event.
type StatementEvent struct {
	Kind   string // CHARGE | DISCOUNT | SPONSOR | CHARITY | PAYMENT | CHEQUE | LOAN
	Label  string
	Amount float64
	DateMs *int64
	Sign   int // +1 in the student's favor, -1 against them
	// Deposit metadata (PAYMENT events; migration 0119/0121).
	DepositType       *string
	DatedByDeposit    bool
	PayerName         *string
	PayerNationalCode *string
	ReceiptNo         *string
	VoucherNo         *string
	PayTypeCode       *int64
	AccountNo         *string
	CardNo            *string
	BankName          *string
	BranchName        *string
	RecorderCode      *int64
	RecorderName      *string
	LegacyRem         *string
}

// TermStatement transcript of one term.
type TermStatement struct {
	TermID      int64
	TermTitle   string
	TermCode    *string
	StatusTitle *string // student's term state (studying / leave / …)

	Charges                  float64
	TuitionFixed             float64 // display split — sum is part of Charges
	TuitionVariable          float64
	Discounts                float64
	Sponsorships             float64
	SponsorshipsFromDeposits float64 // third-party deposits reclassified to sponsor
	CharityCoverage          float64 // charity-fund deposits (separate row)
	Payments                 float64
	ChequesCleared           float64
	ChequesPending           float64
	ChequesBounced           float64
	Loans                    float64
	NetPayable               float64
	Balance                  float64
	Events                   []StatementEvent
}

// TranscriptInput input for building the transcript.
type TranscriptInput struct {
	Ledger       []LedgerTxn
	Discounts    []AppliedAmount
	Sponsorships []AppliedAmount
	Cheques      []ChequeRow
	Loans        []LoanRow
	TermTitles   map[string]string
	TermCodes    map[string]string
	TermStatuses map[string]string // termId → student's term-state title
}

const noTerm = int64(0)

func termKey(t *int64) int64 {
	if t == nil {
		return noTerm
	}
	return *t
}

// BuildTranscript port of buildTranscript — chronological order based on term code (not id).
func BuildTranscript(input TranscriptInput) []TermStatement {
	termIDs := map[int64]bool{}
	for _, t := range input.Ledger {
		termIDs[termKey(t.TermID)] = true
	}
	for _, c := range input.Cheques {
		termIDs[termKey(c.TermID)] = true
	}
	for _, l := range input.Loans {
		termIDs[termKey(l.TermID)] = true
	}
	ids := make([]int64, 0, len(termIDs))
	for id := range termIDs {
		ids = append(ids, id)
	}

	// chronKey: [group, sortKey, termId] — 0 valid code, 1 unknown code, 2 no term
	type ck struct {
		group   int
		sortKey int
		termID  int64
	}
	chronKey := func(termID int64) ck {
		if termID == noTerm {
			return ck{2, 0, termID}
		}
		var code string
		if input.TermCodes != nil {
			code = input.TermCodes[itoa(termID)]
		}
		if norm := scheduling.NormalizeTermCode(code); norm != nil {
			return ck{0, norm.SortKey, termID}
		}
		return ck{1, 0, termID}
	}
	sort.SliceStable(ids, func(i, j int) bool {
		a, b := chronKey(ids[i]), chronKey(ids[j])
		if a.group != b.group {
			return a.group < b.group
		}
		if a.sortKey != b.sortKey {
			return a.sortKey < b.sortKey
		}
		return a.termID < b.termID
	})

	statements := []TermStatement{}
	for _, termID := range ids {
		events := []StatementEvent{}
		var charges, payments float64
		var tuitionFixed, tuitionVariable float64
		var ledgerDiscounts, ledgerSponsorships float64
		var depositSponsorships, depositCharity, depositLoans float64

		for _, txn := range input.Ledger {
			if termKey(txn.TermID) != termID {
				continue
			}
			amount := ToNum(txn.Amount)
			dateMs := ToMs(txn.CreatedAt)
			typ := ""
			if txn.TransactionType != nil {
				typ = *txn.TransactionType
			}
			if IsChargeType(typ) {
				charges += amount
				// Display split: fixed and variable tuition counted separately
				// (their sum stays inside charges).
				tt := strings.ToUpper(strings.TrimSpace(typ))
				if tt == "TUITION_FIXED" {
					tuitionFixed += amount
				} else if tt == "TUITION_VARIABLE" {
					tuitionVariable += amount
				}
				label := "ثبت شهریه"
				if txn.Description != nil && *txn.Description != "" {
					label = *txn.Description
				}
				events = append(events, StatementEvent{Kind: "CHARGE", Label: label, Amount: amount, DateMs: dateMs, Sign: -1})
				continue
			}
			if !IsPaymentType(typ) {
				continue
			}
			creditType := strings.ToUpper(strings.TrimSpace(typ))
			// Ledger-recorded discount/coverage — not a student payment.
			// The official statement showed them as "student deposits",
			// which misled users (e.g. the legacy "بیتس شهریه" rows).
			if ledgerDiscountSet[creditType] {
				ledgerDiscounts += amount
				events = append(events, StatementEvent{Kind: "DISCOUNT",
					Label:  ledgerCreditLabel(creditType, txn.Description, txn.LegacyRem),
					Amount: amount, DateMs: dateMs, Sign: 1})
				continue
			}
			if ledgerSponsorSet[creditType] {
				ledgerSponsorships += amount
				events = append(events, StatementEvent{Kind: "SPONSOR",
					Label:  ledgerCreditLabel(creditType, txn.Description, txn.LegacyRem),
					Amount: amount, DateMs: dateMs, Sign: 1})
				continue
			}
			depositType := ""
			if txn.DepositType != nil {
				depositType = strings.TrimSpace(*txn.DepositType)
			}
			// The real bank deposit date takes priority over createdAt, which
			// for migrated rows is just the import day.
			paidAtMs := ToMs(txn.DepositDate)
			if paidAtMs == nil {
				paidAtMs = dateMs
			}
			label := "پرداخت"
			if txn.Description != nil && *txn.Description != "" {
				label = *txn.Description
			}
			ev := StatementEvent{
				Kind: "PAYMENT", Label: StripDepositSuffix(label, depositType),
				Amount: amount, DateMs: paidAtMs, Sign: 1,
				DepositType: strPtr(depositType), DatedByDeposit: ToMs(txn.DepositDate) != nil,
				PayerName: txn.PayerName, PayerNationalCode: txn.PayerNationalCode,
				ReceiptNo: txn.ReceiptNo, VoucherNo: txn.VoucherNo,
				PayTypeCode: txn.PayTypeCode, AccountNo: txn.AccountNo,
				CardNo: txn.CardNo, BankName: txn.BankName, BranchName: txn.BranchName,
				RecorderCode: txn.RecorderCode, RecorderName: txn.RecorderName,
				LegacyRem: txn.LegacyRem,
			}
			// ── Third-party payer deposits ──
			// SAMA records them in TermPays (so the balance treats them as
			// deposits), but the printed statement must show them under
			// "foundation coverage"/"loan", next to their own rows. The
			// balance is unchanged: coverage subtracts from net, deposit
			// subtracts from balance — same algebra.
			if IsSponsorDeposit(depositType) {
				depositSponsorships += amount
				ev.Kind = "SPONSOR"
				events = append(events, ev)
				continue
			}
			if IsCharityDeposit(depositType) {
				depositCharity += amount
				ev.Kind = "CHARITY"
				events = append(events, ev)
				continue
			}
			if IsLoanDeposit(depositType) {
				depositLoans += amount
				ev.Kind = "LOAN"
				events = append(events, ev)
				continue
			}
			payments += amount
			events = append(events, ev)
		}

		var discounts float64
		for _, d := range input.Discounts {
			if d.TermID != nil && *d.TermID != termID {
				continue
			}
			amount := ToNum(d.Amount)
			discounts += amount
			label := "تخفیف شهریه"
			if d.Title != nil && *d.Title != "" {
				label = *d.Title
			}
			events = append(events, StatementEvent{Kind: "DISCOUNT", Label: label, Amount: amount, Sign: 1})
		}

		var sponsorships float64
		for _, s := range input.Sponsorships {
			if s.TermID != nil && *s.TermID != termID {
				continue
			}
			amount := ToNum(s.Amount)
			sponsorships += amount
			label := "پوشش بنیاد"
			if s.Title != nil && *s.Title != "" {
				label = *s.Title
			}
			events = append(events, StatementEvent{Kind: "SPONSOR", Label: label, Amount: amount, Sign: 1})
		}

		var cleared, pending, bounced float64
		for _, c := range input.Cheques {
			if termKey(c.TermID) != termID {
				continue
			}
			amount := ToNum(c.Amount)
			status := ""
			if c.Status != nil {
				status = strings.ToUpper(*c.Status)
			}
			label := chequeLabel(c)
			dateMs := ToMs(c.DueDate)
			switch status {
			case ChequeCleared:
				cleared += amount
				events = append(events, StatementEvent{Kind: "CHEQUE", Label: label + " (وصول شد)", Amount: amount, DateMs: dateMs, Sign: 1})
			case "BOUNCED":
				bounced += amount
				events = append(events, StatementEvent{Kind: "CHEQUE", Label: label + " (برگشتی)", Amount: amount, DateMs: dateMs, Sign: -1})
			case "CANCELLED":
				events = append(events, StatementEvent{Kind: "CHEQUE", Label: label + " (باطل‌شده)", Amount: amount, DateMs: dateMs, Sign: 1})
			default:
				pending += amount
				events = append(events, StatementEvent{Kind: "CHEQUE", Label: label + " (در انتظار وصول)", Amount: amount, DateMs: dateMs, Sign: 1})
			}
		}

		// Loan deposits (welfare/bank loans recorded as deposits) already
		// counted here; table loans add on top.
		loans := depositLoans
		for _, l := range input.Loans {
			if termKey(l.TermID) != termID {
				continue
			}
			status := ""
			if l.Status != nil {
				status = strings.ToUpper(*l.Status)
			}
			if status != "ACTIVE" {
				continue
			}
			amount := ToNum(l.Amount)
			loans += amount
			label := "وام"
			if l.Lender != nil && *l.Lender != "" {
				label = "وام — " + *l.Lender
			}
			events = append(events, StatementEvent{Kind: "LOAN", Label: label, Amount: amount, DateMs: ToMs(l.CreatedAt), Sign: 1})
		}

		// 🔒 cap: total discount+sponsorship never exceeds the term tuition.
		// Ledger-recorded discounts (e.g. SAMA بیتس) and table discounts both
		// reduce debt; a shared cap keeps the net from going negative.
		cappedDiscounts := discounts + ledgerDiscounts
		if cappedDiscounts > charges {
			cappedDiscounts = charges
		}
		remainingForSponsor := charges - cappedDiscounts
		if remainingForSponsor < 0 {
			remainingForSponsor = 0
		}
		cappedTableSponsorships := sponsorships + ledgerSponsorships
		if cappedTableSponsorships > remainingForSponsor {
			cappedTableSponsorships = remainingForSponsor
		}
		// Table coverage is capped (to avoid a fake negative net), but
		// coverage that came from real deposits is not — that money was
		// actually paid; any surplus is a student credit. Ignoring it would
		// inflate the balance by the surplus.
		cappedSponsorships := cappedTableSponsorships + depositSponsorships + depositCharity
		netPayable := charges - cappedDiscounts - cappedSponsorships
		balance := netPayable - payments - cleared - loans

		sort.SliceStable(events, func(i, j int) bool {
			var am, bm int64
			if events[i].DateMs != nil {
				am = *events[i].DateMs
			}
			if events[j].DateMs != nil {
				bm = *events[j].DateMs
			}
			if am != bm {
				return am < bm
			}
			return events[i].Kind < events[j].Kind
		})

		title := "بدون ترم"
		var codePtr *string
		var statusTitle *string
		if termID != noTerm {
			title = "ترم " + itoa(termID)
			if input.TermTitles != nil {
				if t, ok := input.TermTitles[itoa(termID)]; ok && t != "" {
					title = t
				}
			}
			if input.TermCodes != nil {
				if c, ok := input.TermCodes[itoa(termID)]; ok && c != "" {
					cp := c
					codePtr = &cp
				}
			}
			if input.TermStatuses != nil {
				if s, ok := input.TermStatuses[itoa(termID)]; ok && s != "" {
					st := s
					statusTitle = &st
				}
			}
		}

		statements = append(statements, TermStatement{
			TermID: termID, TermTitle: title, TermCode: codePtr,
			StatusTitle: statusTitle,
			Charges:     charges, TuitionFixed: tuitionFixed, TuitionVariable: tuitionVariable,
			Discounts: cappedDiscounts, Sponsorships: cappedSponsorships,
			SponsorshipsFromDeposits: depositSponsorships, CharityCoverage: depositCharity,
			Payments: payments, ChequesCleared: cleared, ChequesPending: pending,
			ChequesBounced: bounced, Loans: loans,
			NetPayable: netPayable, Balance: balance, Events: events,
		})
	}
	return statements
}

func chequeLabel(c ChequeRow) string {
	label := "چک"
	if c.ChequeNo != nil && *c.ChequeNo != "" {
		label += " " + *c.ChequeNo
	}
	if c.BankName != nil && *c.BankName != "" {
		label += " — " + *c.BankName
	}
	return strings.TrimSpace(label)
}

// TranscriptTotals transcript totals.
type TranscriptTotals struct {
	Charges        float64
	Discounts      float64
	Sponsorships   float64
	Payments       float64
	ChequesCleared float64
	ChequesPending float64
	ChequesBounced float64
	Loans          float64
	Balance        float64
}

// TranscriptTotalsOf port of transcriptTotals.
func TranscriptTotalsOf(statements []TermStatement) TranscriptTotals {
	var t TranscriptTotals
	for _, s := range statements {
		t.Charges += ToNum(s.Charges)
		t.Discounts += ToNum(s.Discounts)
		t.Sponsorships += ToNum(s.Sponsorships)
		t.Payments += ToNum(s.Payments)
		t.ChequesCleared += ToNum(s.ChequesCleared)
		t.ChequesPending += ToNum(s.ChequesPending)
		t.ChequesBounced += ToNum(s.ChequesBounced)
		t.Loans += ToNum(s.Loans)
		t.Balance += ToNum(s.Balance)
	}
	return t
}

func itoa(n int64) string {
	// equivalent to String(number) — with no extra dependency
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	buf := [20]byte{}
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// ─── Deposit metadata (migrations 0119/0121) — port of statement.ts helpers ───

// normFaText unifies Arabic yeh/kaf and whitespace so migration data matches
// Persian-authored match patterns (سما rows use ي/ك).
func normFaText(s string) string {
	s = strings.ReplaceAll(s, "ي", "ی")
	s = strings.ReplaceAll(s, "ك", "ک")
	s = strings.ReplaceAll(s, "\u200c", " ")
	return strings.TrimSpace(normSpaceRe.ReplaceAllString(s, " "))
}

var normSpaceRe = regexp.MustCompile(`\s+`)

// Third-party payer deposits: SAMA brings the amount in TermPays (balance
// treats it as a deposit) but the foundation/government paid, so the printed
// statement shows it under its own coverage row.
var thirdPartyDepositRe = regexp.MustCompile(`سهم\s*بنیاد|سازمان\s*دولتی`)

// Charity-fund coverage — a separate row from "پوشش بنیاد" (user request).
var charityDepositRe = regexp.MustCompile(`صندوق\s*خیریه`)

// Student-loan deposit — from the welfare fund/bank, not the student's pocket.
var loanDepositRe = regexp.MustCompile(`وام\s*تحصیلی|وام\s*دانشجویی`)

// IsSponsorDeposit reports whether a deposit type is third-party foundation coverage.
func IsSponsorDeposit(depositType string) bool {
	d := normFaText(depositType)
	return len(d) > 0 && thirdPartyDepositRe.MatchString(d)
}

// IsCharityDeposit reports whether a deposit type is charity-fund coverage.
func IsCharityDeposit(depositType string) bool {
	d := normFaText(depositType)
	return len(d) > 0 && charityDepositRe.MatchString(d)
}

// IsLoanDeposit reports whether a deposit type is a student-loan deposit.
func IsLoanDeposit(depositType string) bool {
	d := normFaText(depositType)
	return len(d) > 0 && loanDepositRe.MatchString(d)
}

// StripDepositSuffix removes a trailing "（نوع واریز）" that the migration
// appended to the description — it is now a dedicated column. Only stripped
// when the parenthesized text is exactly the same deposit type.
func StripDepositSuffix(label, depositType string) string {
	if depositType == "" {
		return label
	}
	trimmed := strings.TrimSpace(label)
	m := regexp.MustCompile(`\(([^)]+)\)\s*$`).FindStringSubmatch(trimmed)
	if m == nil {
		return label
	}
	if strings.TrimSpace(m[1]) != strings.TrimSpace(depositType) {
		return label
	}
	return strings.TrimSpace(trimmed[:len(trimmed)-len(m[0])])
}

// ledger discount types — the official statement showed them as student
// deposits ("بیتس شهریهٔ قدیمی" confused users).
var ledgerDiscountSet = toSet([]string{
	"TUITION_BATES", "DISCOUNT_FIXED", "DISCOUNT_VARIABLE",
	"SUBJECT_DEDUCTIVE", "TUITION_ADJUST_INC",
})

var ledgerSponsorSet = toSet([]string{"SPONSORSHIP"})

// ledgerCreditLabel Persian label for ledger-recorded discount/coverage rows.
// The SAMA discount reason (legacyRem) is appended for auditing.
func ledgerCreditLabel(typ string, description, reason *string) string {
	t := strings.ToUpper(strings.TrimSpace(typ))
	desc := ""
	if description != nil {
		desc = strings.TrimSpace(*description)
	}
	why := ""
	if reason != nil {
		why = strings.TrimSpace(*reason)
	}
	suffix := ""
	if why != "" && why != "0" {
		suffix = " — " + why
	}
	switch t {
	case "TUITION_BATES":
		return "تخفیف بیتس (سما)" + suffix
	case "TUITION_ADJUST_INC":
		return "تعدیل افزایشی شهریه (سما)" + suffix
	case "DISCOUNT_FIXED":
		return orDefault(desc, "تخفیف شهریهٔ ثابت (سما)") + suffix
	case "DISCOUNT_VARIABLE":
		return orDefault(desc, "تخفیف شهریهٔ متغیر (سما)") + suffix
	case "SUBJECT_DEDUCTIVE":
		return orDefault(desc, "کاهش مبلغ موضوعی (سما)") + suffix
	default:
		return orDefault(desc, "تخفیف") + suffix
	}
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

// strPtr returns nil for empty strings so JSON omits them as null.
func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// PayTypeLabels maps SAMA pay_type codes to Persian labels (payment docs).
var PayTypeLabels = map[int64]string{
	0:   "نامشخص",
	1:   "نقدی",
	2:   "چک",
	3:   "کارت‌خوان",
	4:   "انتقال",
	6:   "ساتنا",
	7:   "سپرده",
	8:   "سایر",
	102: "اینترنتی سامان",
	108: "درگاه بانکی",
	157: "آنلاین سامان",
	201: "دستگاه کارت‌خوان",
}
