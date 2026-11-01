// ═══ Persian/Arabic search normalization — port of persian-search.ts ═══
//
// Dual-spelling letters are unified: Arabic yeh↔Persian yeh · Arabic kaf↔Persian kaf · teh marbuta↔heh · hamza waw→waw · hamza yeh→Persian yeh · alef forms→alef
// + remove tatweel and diacritics + ZWNJ→space.
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

// NormalizeFa port of normalizeFa.
func NormalizeFa(s string) string {
	s = faNormalizer.Replace(s)
	// Diacritics: U+064B..U+0656 and U+0670 — removed
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if (r >= 0x064B && r <= 0x0656) || r == 0x0670 {
			continue
		}
		b.WriteRune(r)
	}
	// repeated spaces → one and trim
	fields := strings.Fields(b.String())
	return strings.Join(fields, " ")
}

// EscapeLikeChars escapes LIKE special characters (\ % _) — the pattern must be used with ESCAPE '\'.
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

// FaLikePattern percent LIKE pattern from the raw term (normalized and escaped).
func FaLikePattern(raw string) string {
	return "%" + EscapeLikeChars(NormalizeFa(raw)) + "%"
}

// FaIncludes normalized substring match (Persian digits also to Latin).
// empty needle → true (same as faIncludes).
func FaIncludes(haystack, needle string) bool {
	n := ToEnDigits(NormalizeFa(needle))
	if n == "" {
		return true
	}
	return strings.Contains(ToEnDigits(NormalizeFa(haystack)), n)
}
