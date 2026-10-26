// ═══ ابزار پول و اعداد — پورت money.ts ═══
//
// همهٔ محاسبات روی «مقیاس‌شدهٔ صحیح» انجام می‌شود تا خطای ممیز شناور در
// جمع هزاران ردیف گزارش مالی را به‌هم نزند:
//   - پول  → ریال صحیح
//   - واحد → واحد × ۱۰۰
//   - گردکردن پول → مضرب ۱۰ ریال (تومان)
package money

import (
	"math"
	"strconv"
	"strings"
)

// UnitScale مقیاس اعداد صحیح برای واحد درسی.
const UnitScale = 100

// RialStep کوچک‌ترین واحد قابل پرداخت (۱۰ ریال = ۱ تومان).
const RialStep = 10

// MaxRials سقف مبلغ مجاز — هم‌ارز numeric(12,0).
const MaxRials = 999_999_999_999

// MulberryRound پورت mulberryRound: sign(v)*round(|v|) = گرد نیمه-دور-از-صفر.
func MulberryRound(value float64) float64 {
	return math.Round(value)
}

// UnitsToInt پورت unitsToInt: ۲ رقم اعشار با گرد نیمه‌به‌بالا روی رشتهٔ دقیق
// (۱.۰۰۵ → ۱۰۱). ورودی نامعتبر/منفی → ۰.
func UnitsToInt(value string) int {
	n, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 {
		return 0
	}
	// معادل n.toFixed(4): چهار رقم اعشار با گردکردن صحیح
	formatted := strconv.FormatFloat(n, 'f', 4, 64)
	parts := strings.SplitN(formatted, ".", 2)
	intPart, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0
	}
	frac := ""
	if len(parts) == 2 {
		frac = parts[1]
	}
	for len(frac) < 4 {
		frac += "0"
	}
	frac = frac[:4]
	first2, _ := strconv.Atoi(frac[:2])
	out := intPart*UnitScale + first2
	if frac[2] >= '5' {
		out++
	}
	return out
}

// IntToUnits پورت intToUnits.
func IntToUnits(value int) float64 {
	return math.Round(float64(value)) / UnitScale
}

// ToRial پورت toRial: گرد به مضرب ۱۰ ریال؛ ورودی غیرمتناهی → ۰.
func ToRial(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return MulberryRound(value/RialStep) * RialStep
}

// ScaleUnits واحد مقیاس‌شده × ضریب → واحد مقیاس‌شده.
func ScaleUnits(unitsInt int, multiplier float64) int {
	if math.IsNaN(multiplier) || math.IsInf(multiplier, 0) {
		return 0
	}
	return int(math.Round(float64(unitsInt) * multiplier))
}

// PercentOf درصد (۰..۱۰۰) از یک عدد صحیح — گرد به نزدیک‌ترین.
func PercentOf(amountInt int, percent float64) int {
	if math.IsNaN(percent) || math.IsInf(percent, 0) {
		return 0
	}
	return int(MulberryRound((float64(amountInt) * percent) / 100))
}

// RatioOf نسبت (صورت/مخرج) از یک عدد صحیح — مخرج ≤ ۰ → ۰.
func RatioOf(amountInt int, numerator, denominator float64) int {
	if math.IsNaN(denominator) || math.IsInf(denominator, 0) || denominator <= 0 {
		return 0
	}
	return int(MulberryRound((float64(amountInt) * numerator) / denominator))
}

// SumUnits جمع دقیق فهرستی از واحدهای مقیاس‌شده.
func SumUnits(values []int) int {
	s := 0
	for _, v := range values {
		s += v
	}
	return s
}

// SafeRials پورت safeRials: فقط ریالِ عدد صحیح نامنفی تا سقف numeric(12,0)
// پذیرفته می‌شود؛ هر چیز دیگر nil (fail-closed در مرز ورودی مالی).
func SafeRials(value string) *int64 {
	t := strings.TrimSpace(value)
	if t == "" || len(t) > 15 {
		return nil
	}
	for _, r := range t {
		if r < '0' || r > '9' {
			return nil
		}
	}
	n, err := strconv.ParseInt(t, 10, 64)
	if err != nil || n < 0 || n > MaxRials {
		return nil
	}
	return &n
}

// SafeRialsInt نسخهٔ ورودی عددی (برای مقادیر JSON).
func SafeRialsInt(value int64) *int64 {
	if value < 0 || value > MaxRials {
		return nil
	}
	v := value
	return &v
}

var faDigitRunes = []rune{'۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'}

// FaDigits ارقام لاتین → فارسی.
func FaDigits(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(faDigitRunes[r-'0'])
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// GroupThousands جداکنندهٔ هزارگان فارسی «٬» روی عدد گردشده.
func GroupThousands(n float64) string {
	neg := n < 0
	if neg {
		n = -n
	}
	digits := strconv.FormatInt(int64(math.Round(n)), 10)
	var out strings.Builder
	for i, d := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			out.WriteRune('٬')
		}
		out.WriteRune(d)
	}
	s := FaDigits(out.String())
	if neg {
		return "-" + s
	}
	return s
}

// FmtRial پورت fmtRial: «۱٬۲۳۴ ریال» — فقط برای نمایش، نه محاسبه.
func FmtRial(value float64) string {
	return GroupThousands(value) + " ریال"
}

// RialString پورت rialString: رشتهٔ ریالیِ خام برای ذخیره در جزئیات/لاگ.
func RialString(value float64) string {
	return strconv.FormatInt(int64(math.Round(value)), 10)
}
