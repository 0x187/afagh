// ═══ نرمال‌سازی جست‌وجوی فارسی/عربی — پورت persian-search.ts ═══
//
// حروف دو املایی یکسان می‌شوند: ي↔ی · ك↔ک · ة↔ه · ؤ→و · ئ→ی · أ/إ/آ→ا
// + حذف تطویل (ـ) و اعراب + نیم‌فاصله→فاصله.
package fa

import "strings"

var faNormalizer = strings.NewReplacer(
	"ي", "ی",
	"ك", "ک",
	"ة", "ه",
	"ؤ", "و",
	"ئ", "ی",
	"أ", "ا",
	"إ", "ا",
	"آ", "ا",
	"ـ", "",
	"‌", " ",
)

// NormalizeFa پورت normalizeFa.
func NormalizeFa(s string) string {
	s = faNormalizer.Replace(s)
	// اعراب: U+064B..U+0656 و U+0670 — حذف
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if (r >= 0x064B && r <= 0x0656) || r == 0x0670 {
			continue
		}
		b.WriteRune(r)
	}
	// فاصله‌های تکراری → یکی و trim
	fields := strings.Fields(b.String())
	return strings.Join(fields, " ")
}

// EscapeLikeChars فرار کاراکترهای ویژهٔ LIKE (\ ٪ _) — الگو باید با ESCAPE '\' استفاده شود.
func EscapeLikeChars(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == '\\' || r == '%' || r == '_' {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// FaLikePattern الگوی LIKE درصدی از عبارت خام (نرمال‌شده و فرارشده).
func FaLikePattern(raw string) string {
	return "%" + EscapeLikeChars(NormalizeFa(raw)) + "%"
}

// FaIncludes تطبیق زیررشته‌ای نرمال‌شده (ارقام فارسی هم به لاتین).
// سوزن خالی → true (همان faIncludes).
func FaIncludes(haystack, needle string) bool {
	n := ToEnDigits(NormalizeFa(needle))
	if n == "" {
		return true
	}
	return strings.Contains(ToEnDigits(NormalizeFa(haystack)), n)
}
