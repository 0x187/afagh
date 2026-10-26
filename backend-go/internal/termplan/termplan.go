// ═══ تعداد ترم چارت بر اساس مقطع + ترم تابستان — پورت term-plan.ts ═══
package termplan

import "strings"

// SummerSemester شمارهٔ ثابت ترم تابستان.
const SummerSemester = 9

// MaxStandardSemester حداکثر ترم عادی.
const MaxStandardSemester = 8

var degreeNormalizer = strings.NewReplacer(
	"ي", "ی",
	"ك", "ک",
	"ة", "ه",
	"‌", "",
	"‍", "",
)

// NormalizeDegreeText پورت normalizeDegreeText: حروف عربی هم‌شکل + حذف فاصله/نیم‌فاصله + بزرگ.
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

// TermCountForDegree پورت termCountForDegree: مقدار معتبر صریح مقدم است؛
// وگرنه کاردانی/ناپیوسته/ارشد/دکترا → ۴، پیوسته/ناشناخته → ۸.
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

// IsSummerSemester آیا شمارهٔ ترم، تابستان است؟
func IsSummerSemester(sem *int) bool {
	return sem != nil && *sem == SummerSemester
}

// PlanSemesters فهرست ترم‌های عادی چارت [1..N] با کف ۱ و سقف ۱۲.
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
