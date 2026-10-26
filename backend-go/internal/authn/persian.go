// ═══ نرمال‌سازی ارقام — پورت toEnDigits از afagh-next/src/lib/persian-search.ts ═══
//
// تبدیل ارقام فارسی (۰-۹) و عربی (٠-٩) به انگلیسی (0-9).
// کاربرد: شناسه‌های ورود (کد ملی/پرسنلی/دانشجویی) و گذرواژه — کاربر گاهی با
// کیبورد فارسی تایپ می‌کند و بدون این تبدیل، جست‌وجو ۰ ردیف برمی‌گرداند و
// ورود اول شکست می‌خورد.
package authn

// ToEnDigits ارقام فارسی/عربی را درجا به انگلیسی تبدیل می‌کند؛ بقیهٔ کاراکترها
// دست‌نخورده می‌مانند (مثل دو replace زنجیره‌ای در TS).
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
