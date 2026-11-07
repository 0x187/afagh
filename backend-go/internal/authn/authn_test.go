package authn

import (
	"testing"
)

// Parity with Node crypto.scryptSync — the test vector was generated from Node itself:
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

// Go hashes must be compatible with the Node side (same algorithm): build the hash and
// verify it again with the default parameters.
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

// Cookie transport matrix — port of sessionTransport (proxy-trust.ts).
func TestSessionTransportMatrix(t *testing.T) {
	cases := []struct {
		name       string
		env        transportEnv
		wantSecure bool
		wantSame   string
	}{
		// explicit operator decision — honored in production too (parity with the
		// reference app: the production Next.js runs HTTP with this exact value)
		{"prod explicit false", transportEnv{NodeEnv: "production", CookieSecure: "false"}, false, "lax"},
		// unset in production leans fail-closed Secure
		{"prod unset forces secure", transportEnv{NodeEnv: "production"}, true, "lax"},
		// none without Secure falls back to lax (fail-safe)
		{"none without secure", transportEnv{NodeEnv: "development", CookieSecure: "false", CookieSameSite: "none"}, false, "lax"},
		// none is allowed with Secure
		{"none with secure", transportEnv{NodeEnv: "production", CookieSameSite: "none"}, true, "none"},
		{"strict", transportEnv{NodeEnv: "development", CookieSameSite: "strict"}, false, "strict"},
		// auto + https in the URL
		{"auto https", transportEnv{NodeEnv: "development", PublicBaseURL: "https://edu.example.ac.ir"}, true, "lax"},
		{"auto http", transportEnv{NodeEnv: "development", PublicBaseURL: "http://localhost:8091"}, false, "lax"},
		// explicit secure=true in dev
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

// Absolute session limit — port of SESSION_MAX_HOURS (default 4, range 1..24).
func TestSessionMaxHours(t *testing.T) {
	cases := map[string]int{"": 4, "1": 1, "4": 4, "24": 24, "0": 4, "25": 4, "abc": 4, "4.9": 4}
	for raw, want := range cases {
		if got := sessionMaxHours(raw); got != want {
			t.Fatalf("sessionMaxHours(%q)=%d want %d", raw, got, want)
		}
	}
}

// Persian/Arabic digit normalization — port of toEnDigits.
func TestToEnDigits(t *testing.T) {
	if got := ToEnDigits("۱۲۳۴۵۶ ٠١٢٣"); got != "123456 0123" {
		t.Fatalf("got %q", got)
	}
	if got := ToEnDigits("abc"); got != "abc" {
		t.Fatalf("غیررقمی نباید تغییر کند: %q", got)
	}
}
