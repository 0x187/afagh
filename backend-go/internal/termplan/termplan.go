// ═══ Chart term count by degree level + summer term — port of term-plan.ts ═══
package termplan

import "strings"

// SummerSemester is the fixed summer term number.
const SummerSemester = 9

// MaxStandardSemester is the maximum regular term.
const MaxStandardSemester = 8

var degreeNormalizer = strings.NewReplacer(
	"ي", "ی",
	"ك", "ک",
	"ة", "ه",
	"‌", "",
	"‍", "",
)

// NormalizeDegreeText is a port of normalizeDegreeText: identical-shape Arabic letters + strip spaces/ZWNJ + uppercase.
func NormalizeDegreeText(t string) string {
	t = degreeNormalizer.Replace(t)
	t = strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			return -1
		}
		return r
	}, t)
	return strings.ToUpper(t)
}

// TermCountForDegree is a port of termCountForDegree: an explicit valid value takes precedence;
// otherwise associate/discontinuous-bachelor/master/doctorate → 4, continuous/unknown → 8.
func TermCountForDegree(termCount *int, code, title string) int {
	if termCount != nil && *termCount >= 1 && *termCount <= 12 {
		return *termCount
	}
	c := NormalizeDegreeText(code)
	switch c {
	case "AD", "MS", "PHD":
		return 4
	case "BS":
		return 8
	}
	t := NormalizeDegreeText(title)
	for _, marker := range []string{"کاردانی", "ناپیوسته", "ارشد", "دکتر", "دکتری", "فوق", "PHD", "MS", "AD"} {
		if strings.Contains(t, marker) {
			return 4
		}
	}
	return 8
}

// IsSummerSemester reports whether a term number is a summer term.
func IsSummerSemester(sem *int) bool {
	return sem != nil && *sem == SummerSemester
}

// PlanSemesters is the list of the chart's regular terms [1..N], floored at 1 and capped at 12.
func PlanSemesters(count int) []int {
	n := count
	if n < 1 {
		n = 1
	}
	if n > 12 {
		n = 12
	}
	out := make([]int, n)
	for i := range out {
		out[i] = i + 1
	}
	return out
}
