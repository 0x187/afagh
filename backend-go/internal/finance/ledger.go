// ═══ تراز کانونی دفتر مالی — پورت ledger-balance.ts ═══
//
// قرارداد علامت: مثبت = بدهی دانشجو. انواع ناشناخته نادیده گرفته می‌شوند
// (fail-closed: در گیت‌ها اثر ندارند).
package finance

import "strings"

// DebtLedgerTypes انواعی که بدهی می‌سازند.
var DebtLedgerTypes = []string{
	"TUITION_FIXED", "TUITION_VARIABLE", "TUITION_CHARGE", "CHARGE",
	"SUBJECT_ADDITIVE", "POS_REFUND", "TUITION_ADJUST_DEC",
}

// CreditLedgerTypes انواعی که اعتبار می‌سازند.
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

// LedgerBalanceRow ردیف حداقلی تراز.
type LedgerBalanceRow struct {
	TransactionType *string
	Amount          any
}

// LedgerBalance پورت ledgerBalance: جمع بدهی‌ها − جمع اعتبارها.
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

// IsChargeType آیا نوع تراکنش بدهی است؟
func IsChargeType(typ string) bool {
	return debtSet[strings.ToUpper(strings.TrimSpace(typ))]
}

// IsPaymentType آیا نوع تراکنش اعتبار است؟
func IsPaymentType(typ string) bool {
	return creditSet[strings.ToUpper(strings.TrimSpace(typ))]
}
