package authn

import (
	"testing"
)

// پارتی با Node crypto.scryptSync — بردار از خود Node تولید شده است:
// docker run --rm node:22-bookworm-slim node -e "..." (N=16384,r=8,p=1,keylen=32)
func TestScryptNodeParity(t *testing.T) {
	stored := "73512fe1f252c406c5ad0a5989074761:7164a70cf14d283f6cbeceedb7038608a7aca5305c7b90cc119d8fc88620f996"
	if !VerifyPasswordIgnoreErr("TestPass123", stored) {
		t.Fatal("هش نود باید در Go تأیید شود — پارامترهای scrypt هم‌ارز نیستند")
	}
	if VerifyPasswordIgnoreErr("WrongPass", stored) {
		t.Fatal("رمز نادرست نباید تأیید شود")
	}
}

// هش‌های Go باید با سمت Node (همان الگوریتم) سازگار باشند: ساخت هش و
// تأیید دوباره با پارامترهای پیش‌فرض.
func TestHashAndVerifyRoundTrip(t *testing.T) {
	h, err := HashPassword("Secret12345")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPasswordIgnoreErr("Secret12345", h) {
		t.Fatal("هش تازه باید تأیید شود")
	}
	if VerifyPasswordIgnoreErr("secret12345", h) {
		t.Fatal("رمز با حروف متفاوت نباید تأیید شود")
	}
	if VerifyPasswordIgnoreErr("x", "garbage") {
		t.Fatal("فرمت بد نباید تأیید شود")
	}
	if VerifyPasswordIgnoreErr("x", DUMMY_PASSWORD_HASH) {
		t.Fatal("هش ساختگی هرگز نباید تأیید شود")
	}
}

// ماتریس انتقال کوکی — پورت sessionTransport (proxy-trust.ts).
func TestSessionTransportMatrix(t *testing.T) {
	cases := []struct {
		name       string
		env        transportEnv
		wantSecure bool
		wantSame   string
	}{
		// production همیشه Secure — حتی با AFAGH_COOKIE_SECURE=false
		{"prod forces secure", transportEnv{NodeEnv: "production", CookieSecure: "false"}, true, "lax"},
		// none بدون Secure به lax برمی‌گردد (fail-safe)
		{"none without secure", transportEnv{NodeEnv: "development", CookieSecure: "false", CookieSameSite: "none"}, false, "lax"},
		// none با Secure مجاز است
		{"none with secure", transportEnv{NodeEnv: "production", CookieSameSite: "none"}, true, "none"},
		{"strict", transportEnv{NodeEnv: "development", CookieSameSite: "strict"}, false, "strict"},
		// auto + https در URL
		{"auto https", transportEnv{NodeEnv: "development", PublicBaseURL: "https://edu.example.ac.ir"}, true, "lax"},
		{"auto http", transportEnv{NodeEnv: "development", PublicBaseURL: "http://localhost:8091"}, false, "lax"},
		// secure=true صریح در dev
		{"explicit true", transportEnv{NodeEnv: "development", CookieSecure: "true"}, true, "lax"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			secure, same := sessionTransport(tc.env)
			if secure != tc.wantSecure || same != tc.wantSame {
				t.Fatalf("got secure=%v same=%s; want secure=%v same=%s", secure, same, tc.wantSecure, tc.wantSame)
			}
		})
	}
}

// سقف مطلق نشست — پورت SESSION_MAX_HOURS (پیش‌فرض ۴، بازهٔ ۱..۲۴).
func TestSessionMaxHours(t *testing.T) {
	cases := map[string]int{"": 4, "1": 1, "4": 4, "24": 24, "0": 4, "25": 4, "abc": 4, "4.9": 4}
	for raw, want := range cases {
		if got := sessionMaxHours(raw); got != want {
			t.Fatalf("sessionMaxHours(%q)=%d want %d", raw, got, want)
		}
	}
}

// نرمال‌سازی ارقام فارسی/عربی — پورت toEnDigits.
func TestToEnDigits(t *testing.T) {
	if got := ToEnDigits("۱۲۳۴۵۶ ٠١٢٣"); got != "123456 0123" {
		t.Fatalf("got %q", got)
	}
	if got := ToEnDigits("abc"); got != "abc" {
		t.Fatalf("غیررقمی نباید تغییر کند: %q", got)
	}
}
