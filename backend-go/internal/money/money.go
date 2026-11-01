// ═══ money and number helpers — port of money.ts ═══
//
// all calculations are done on "scaled integers" so floating-point error does not
// corrupt the sum of thousands of rows in a financial report:
//   - money → integer rials
//   - units → units × 100
//   - money rounding → multiple of 10 rials (toman)
package money

import (
	"math"
	"strconv"
	"strings"
)

// UnitScale is the integer scale for course units.
const UnitScale = 100

// RialStep is the smallest payable unit (10 rials = 1 toman).
const RialStep = 10

// MaxRials is the maximum allowed amount — equivalent to numeric(12,0).
const MaxRials = 999_999_999_999

// MulberryRound ports mulberryRound: sign(v)*round(|v|) = round half away from zero.
func MulberryRound(value float64) float64 {
	return math.Round(value)
}

// UnitsToInt ports unitsToInt: 2 decimal places with round half up on the exact string
// (1.005 → 101). Invalid/negative input → 0.
func UnitsToInt(value string) int {
	n, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 {
		return 0
	}
	// equivalent to n.toFixed(4): four decimal places with correct rounding
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

// IntToUnits ports intToUnits.
func IntToUnits(value int) float64 {
	return math.Round(float64(value)) / UnitScale
}

// ToRial ports toRial: rounds to a multiple of 10 rials; non-finite input → 0.
func ToRial(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return MulberryRound(value/RialStep) * RialStep
}

// ScaleUnits: scaled units × multiplier → scaled units.
func ScaleUnits(unitsInt int, multiplier float64) int {
	if math.IsNaN(multiplier) || math.IsInf(multiplier, 0) {
		return 0
	}
	return int(math.Round(float64(unitsInt) * multiplier))
}

// PercentOf: percentage (0..100) of an integer — rounds to nearest.
func PercentOf(amountInt int, percent float64) int {
	if math.IsNaN(percent) || math.IsInf(percent, 0) {
		return 0
	}
	return int(MulberryRound((float64(amountInt) * percent) / 100))
}

// RatioOf: ratio (numerator/denominator) of an integer — denominator ≤ 0 → 0.
func RatioOf(amountInt int, numerator, denominator float64) int {
	if math.IsNaN(denominator) || math.IsInf(denominator, 0) || denominator <= 0 {
		return 0
	}
	return int(MulberryRound((float64(amountInt) * numerator) / denominator))
}

// SumUnits: exact sum of a list of scaled units.
func SumUnits(values []int) int {
	s := 0
	for _, v := range values {
		s += v
	}
	return s
}

// SafeRials ports safeRials: only non-negative integer rials up to the numeric(12,0) limit
// are accepted; anything else is nil (fail-closed at the financial input boundary).
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

// SafeRialsInt is the numeric-input version (for JSON values).
func SafeRialsInt(value int64) *int64 {
	if value < 0 || value > MaxRials {
		return nil
	}
	v := value
	return &v
}

var faDigitRunes = []rune{'۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'}

// FaDigits: Latin digits → Persian.
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

// GroupThousands: applies the Persian thousands separator to the rounded number.
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

// FmtRial ports fmtRial: "1,234 rial" — display only, not for calculation.
func FmtRial(value float64) string {
	return GroupThousands(value) + " ریال"
}

// RialString ports rialString: raw rial string for storing in details/logs.
func RialString(value float64) string {
	return strconv.FormatInt(int64(math.Round(value)), 10)
}
