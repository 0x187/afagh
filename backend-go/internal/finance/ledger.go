// ═══ Canonical financial ledger balance — port of ledger-balance.ts ═══
//
// Sign convention: positive = student debt. Unknown types are ignored
// (fail-closed: they have no effect in gates).
package finance

import "strings"

// DebtLedgerTypes types that create debt.
var DebtLedgerTypes = []string{
	"TUITION_FIXED", "TUITION_VARIABLE", "TUITION_CHARGE", "CHARGE",
	"SUBJECT_ADDITIVE", "POS_REFUND", "TUITION_ADJUST_DEC",
}

// CreditLedgerTypes types that create credit.
var CreditLedgerTypes = []string{
	"PAYMENT", "POS_PAYMENT", "DISCOUNT_FIXED", "DISCOUNT_VARIABLE",
	"SUBJECT_DEDUCTIVE", "SPONSORSHIP", "LOAN", "CREDIT",
	"TUITION_BATES", "TUITION_ADJUST_INC",
}

var debtSet = toSet(DebtLedgerTypes)
var creditSet = toSet(CreditLedgerTypes)

func toSet(list []string) map[string]bool {
	m := make(map[string]bool, len(list))
	for _, s := range list {
		m[s] = true
	}
	return m
}

// LedgerBalanceRow minimal balance row.
type LedgerBalanceRow struct {
	TransactionType *string
	Amount          any
}

// LedgerBalance port of ledgerBalance: total debts − total credits.
func LedgerBalance(rows []LedgerBalanceRow) float64 {
	var debt, credit float64
	for _, r := range rows {
		t := ""
		if r.TransactionType != nil {
			t = strings.ToUpper(strings.TrimSpace(*r.TransactionType))
		}
		a := ToNum(r.Amount)
		if a == 0 {
			continue
		}
		if debtSet[t] {
			debt += a
		} else if creditSet[t] {
			credit += a
		}
	}
	return debt - credit
}

// IsChargeType whether the transaction type is debt.
func IsChargeType(typ string) bool {
	return debtSet[strings.ToUpper(strings.TrimSpace(typ))]
}

// IsPaymentType whether the transaction type is credit.
func IsPaymentType(typ string) bool {
	return creditSet[strings.ToUpper(strings.TrimSpace(typ))]
}
