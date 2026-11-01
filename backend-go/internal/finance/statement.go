// ═══ Term-by-term financial transcript — port of statement.ts ═══
package finance

import (
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
}

// StatementEvent transcript event.
type StatementEvent struct {
	Kind   string // CHARGE | DISCOUNT | SPONSOR | PAYMENT | CHEQUE | LOAN
	Label  string
	Amount float64
	DateMs *int64
	Sign   int // +1 in the student's favor, -1 against them
}

// TermStatement transcript of one term.
type TermStatement struct {
	TermID         int64
	TermTitle      string
	TermCode       *string
	Charges        float64
	Discounts      float64
	Sponsorships   float64
	Payments       float64
	ChequesCleared float64
	ChequesPending float64
	ChequesBounced float64
	Loans          float64
	NetPayable     float64
	Balance        float64
	Events         []StatementEvent
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
				label := "ثبت شهریه"
				if txn.Description != nil && *txn.Description != "" {
					label = *txn.Description
				}
				events = append(events, StatementEvent{Kind: "CHARGE", Label: label, Amount: amount, DateMs: dateMs, Sign: -1})
			} else if IsPaymentType(typ) {
				payments += amount
				label := "پرداخت"
				if txn.Description != nil && *txn.Description != "" {
					label = *txn.Description
				}
				events = append(events, StatementEvent{Kind: "PAYMENT", Label: label, Amount: amount, DateMs: dateMs, Sign: 1})
			}
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

		var loans float64
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
		cappedDiscounts := discounts
		if cappedDiscounts > charges {
			cappedDiscounts = charges
		}
		remainingForSponsor := charges - cappedDiscounts
		if remainingForSponsor < 0 {
			remainingForSponsor = 0
		}
		cappedSponsorships := sponsorships
		if cappedSponsorships > remainingForSponsor {
			cappedSponsorships = remainingForSponsor
		}
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
		}

		statements = append(statements, TermStatement{
			TermID: termID, TermTitle: title, TermCode: codePtr,
			Charges: charges, Discounts: cappedDiscounts, Sponsorships: cappedSponsorships,
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
