// ═══ یادآوری چک — پورت cheque-reminders.ts ═══
package finance

import (
	"math"
	"strings"

	"backend-go/internal/money"
)

const dayMs = 86_400_000

// ChequeReminderRow ردیف چک برای تصمیم یادآوری.
type ChequeReminderRow struct {
	ID         int64
	ChequeNo   *string
	Amount     any
	DueDate    any
	Status     *string
	RemindedAt any
}

// ChequeReminderDecision نتیجهٔ تصمیم.
type ChequeReminderDecision struct {
	Remind   bool
	DaysLeft *int
	Overdue  bool
}

// ChequeNeedsReminder پورت chequeNeedsReminder.
func ChequeNeedsReminder(c ChequeReminderRow, nowMs int64, remindDays float64) ChequeReminderDecision {
	none := ChequeReminderDecision{Remind: false, DaysLeft: nil, Overdue: false}
	status := ""
	if c.Status != nil {
		status = strings.ToUpper(*c.Status)
	}
	if status != "PENDING" {
		return none
	}
	if ToMs(c.RemindedAt) != nil {
		return none
	}
	due := ToMs(c.DueDate)
	if due == nil {
		return none
	}
	daysLeft := int(math.Ceil(float64(*due-nowMs) / float64(dayMs)))
	overdue := daysLeft < 0
	limit := math.Max(0, ToNum(remindDays))
	remind := float64(daysLeft) <= limit
	return ChequeReminderDecision{Remind: remind, DaysLeft: &daysLeft, Overdue: overdue}
}

// ReminderTextInput ورودی متن یادآوری.
type ReminderTextInput struct {
	ChequeNo *string
	Amount   any
	DueDate  any
	BankName *string
}

// BuildChequeReminderText پورت buildChequeReminderText — فارسی با مبلغ و روزها.
func BuildChequeReminderText(c ReminderTextInput, daysLeft *int, overdue bool) string {
	no := ""
	if c.ChequeNo != nil && *c.ChequeNo != "" {
		no = " شمارهٔ " + *c.ChequeNo
	}
	amount := money.GroupThousands(ToNum(c.Amount))
	bank := ""
	if c.BankName != nil && *c.BankName != "" {
		bank = " بانک " + *c.BankName
	}
	if overdue {
		return "چک" + no + bank + " به مبلغ " + amount + " ریال از سررسید گذشته است. لطفاً هرچه زودتر برای تعیین تکلیف به امور مالی مراجعه کنید."
	}
	days := ""
	if daysLeft != nil {
		switch {
		case *daysLeft == 0:
			days = " امروز"
		case *daysLeft == 1:
			days = " فردا"
		default:
			days = " تا " + money.GroupThousands(float64(*daysLeft)) + " روز دیگر"
		}
	}
	return "چک" + no + bank + " به مبلغ " + amount + " ریال" + days + " سررسید می‌شود. لطفاً پیش از سررسید نسبت به تأمین موجودی اقدام کنید."
}
