// ═══ Digit normalization — port of toEnDigits from afagh-next/src/lib/persian-search.ts ═══
//
// Converts Persian (0-9) and Arabic (0-9) digits to English (0-9).
// Usage: login identifiers (national/staff/student code) and passwords — users sometimes type with
// a Persian keyboard, and without this conversion the search returns 0 rows and
// the first login fails.
package authn

// ToEnDigits converts Persian/Arabic digits to English in place; other characters
// remain untouched (like the two chained replaces in TS).
func ToEnDigits(s string) string {
	need := false
	for _, r := range s {
		if (r >= '۰' && r <= '۹') || (r >= '٠' && r <= '٩') {
			need = true
			break
		}
	}
	if !need {
		return s
	}
	out := []rune(s)
	for i, r := range out {
		switch {
		case r >= '۰' && r <= '۹': // U+06F0..U+06F9
			out[i] = '0' + (r - '۰')
		case r >= '٠' && r <= '٩': // U+0660..U+0669
			out[i] = '0' + (r - '٠')
		}
	}
	return string(out)
}
