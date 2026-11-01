// ═══ Money and number utilities — port of lib/money.ts ═══
//
// all rial computations on integers, rounded to a multiple of 10 rials;
// course units at scale 100 (2 decimal places) so multiplication by decimal coefficients stays exact.
package payroll

import (
	"math"
	"strconv"
	"strings"
)

// UnitScale integer scale for course units.
const UnitScale = 100

// RialStep smallest payable unit (10 rials = 1 toman).
const RialStep = 10

// MulberryRound sign-preserving rounding (port of Math.sign×Math.round —
// sign(0)=0, so zero input gives zero output, not NaN).
func MulberryRound(value float64) float64 {
	sign := 1.0
	if value < 0 || (value == 0 && math.Signbit(value)) {
		sign = -1.0
	}
	return sign * math.Round(math.Abs(value))
}

// UnitsToInt decimal value → scaled integer unit (2 decimal places).
// rounded on the "exact decimal string" (4 digits) so that 1.005 → 101
// (half-up rounding, same as the accountant's expectation).
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

// IntToUnits scaled integer unit → decimal number (numeric(6,2)).
func IntToUnits(value int) float64 {
	return math.Round(float64(value)) / UnitScale
}

// ToRial rounds money to a multiple of 10 rials (toman).
func ToRial(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return MulberryRound(value/RialStep) * RialStep
}

// PercentOf percentage (0..100) of an integer — rounded to nearest.
func PercentOf(amountInt float64, percent float64) float64 {
	if math.IsNaN(percent) {
		return 0
	}
	return MulberryRound((amountInt * percent) / 100)
}

// RatioOf ratio (numerator/denominator) of an integer — for prorating absences by sessions.
func RatioOf(amountInt float64, numerator, denominator float64) float64 {
	if math.IsNaN(denominator) || denominator <= 0 {
		return 0
	}
	return MulberryRound((amountInt * numerator) / denominator)
}
