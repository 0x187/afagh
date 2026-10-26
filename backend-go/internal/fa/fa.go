// ═══ نرمال‌سازی ارقام فارسی/عربی — پورت toEnDigits از persian-search.ts ═══
package fa

// ToEnDigits ارقام فارسی/عربی را به لاتین تبدیل می‌کند (کدهای سیستمی انگلیسی‌اند).
func ToEnDigits(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch {
		case r >= '۰' && r <= '۹': // U+06F0..U+06F9
			out = append(out, '0'+(r-'۰'))
		case r >= '٠' && r <= '٩': // U+0660..U+0669
			out = append(out, '0'+(r-'٠'))
		default:
			out = append(out, r)
		}
	}
	return string(out)
}
