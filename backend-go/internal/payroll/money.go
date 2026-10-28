// ═══ ابزار پول و اعداد — پورت lib/money.ts ═══
//
// همهٔ محاسبات ریالی روی اعداد صحیح و با گردکردن به مضرب ۱۰ ریال؛
// واحد درسی با مقیاس ۱۰۰ (۲ رقم اعشار) تا ضرب در ضرایب اعشاری دقیق بماند.
package payroll

import (
	"math"
	"strconv"
	"strings"
)

// UnitScale مقیاس اعداد صحیح برای واحد درسی.
const UnitScale = 100

// RialStep کوچک‌ترین واحد قابل پرداخت (۱۰ ریال = ۱ تومان).
const RialStep = 10

// MulberryRound گردکردن با حفظ علامت (پورت Math.sign×Math.round —
// sign(0)=0 پس صفر ورودی خروجی صفر می‌دهد، نه NaN).
func MulberryRound(value float64) float64 {
	sign := 1.0
	if value < 0 || (value == 0 && math.Signbit(value)) {
		sign = -1.0
	}
	return sign * math.Round(math.Abs(value))
}

// UnitsToInt مقدار اعشاری → واحد مقیاس‌شدهٔ صحیح (۲ رقم اعشار).
// روی «رشتهٔ اعشاری دقیق» (۴ رقم) گرد می‌شود تا ۱.۰۰۵ → ۱۰۱ شود
// (گردکردن نیمه‌به‌بالا، همان انتظار حسابدار).
func UnitsToInt(value float64) int {
	if math.IsNaN(value) || value < 0 {
		return 0
	}
	s := strconv.FormatFloat(value, 'f', 4, 64)
	parts := strings.SplitN(s, ".", 2)
	i := parts[0]
	f := parts[1]
	if len(f) < 4 {
		f = f + strings.Repeat("0", 4-len(f))
	}
	out, _ := strconv.Atoi(i)
	hund, _ := strconv.Atoi(f[:2])
	out = out*UnitScale + hund
	if f[2] >= '5' {
		out++
	}
	return out
}

// IntToUnits واحد مقیاس‌شدهٔ صحیح → عدد اعشاری (numeric(6,2)).
func IntToUnits(value int) float64 {
	return math.Round(float64(value)) / UnitScale
}

// ToRial گردکردن پول به مضرب ۱۰ ریال (تومان).
func ToRial(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return MulberryRound(value/RialStep) * RialStep
}

// PercentOf درصد (۰..۱۰۰) از یک عدد صحیح — گرد به نزدیک‌ترین.
func PercentOf(amountInt float64, percent float64) float64 {
	if math.IsNaN(percent) {
		return 0
	}
	return MulberryRound((amountInt * percent) / 100)
}

// RatioOf نسبت (صورت/مخرج) از یک عدد صحیح — برای کسر غیبت به تناسب جلسات.
func RatioOf(amountInt float64, numerator, denominator float64) float64 {
	if math.IsNaN(denominator) || denominator <= 0 {
		return 0
	}
	return MulberryRound((amountInt * numerator) / denominator)
}
