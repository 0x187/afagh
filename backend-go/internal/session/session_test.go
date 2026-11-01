package session

import "testing"

// parity with auth.ts: a valid token is exactly 64 hex characters.
func TestValidTokenShape(t *testing.T) {
	good := "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8"
	if !ValidTokenShape(good) {
		t.Fatal("توکن ۶۴تایی hex معتبر باید پذیرفته شود")
	}
	for _, bad := range []string{
		"", "short", good + "extra", // length
		"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",  // non-hex
		"a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b%8", // non-hex
	} {
		if ValidTokenShape(bad) {
			t.Fatalf("توکن بدشکل باید رد شود: %q", bad)
		}
	}
}

func TestSha256Hex(t *testing.T) {
	// parity with the known sha256('abc')
	if got := Sha256Hex("abc"); got != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatalf("sha256 hex نادرست: %s", got)
	}
}

func TestReadTokenDualRead(t *testing.T) {
	t.Setenv("AFAGH_SESSION_COOKIE_PREFIX", "host")
	hostToken := "aaaa"
	oldToken := "bbbb"
	if got := ReadToken(map[string]string{CookieNameHost: hostToken, CookieName: oldToken}); got != hostToken {
		t.Fatal("با گیت host، نام جدید در اولویت است")
	}
	if got := ReadToken(map[string]string{CookieName: oldToken}); got != oldToken {
		t.Fatal("بدون نام جدید، نام قدیمی خوانده می‌شود")
	}
	t.Setenv("AFAGH_SESSION_COOKIE_PREFIX", "")
	if got := ReadToken(map[string]string{CookieNameHost: hostToken, CookieName: oldToken}); got != oldToken {
		t.Fatal("بدون گیت، فقط نام قدیمی خوانده می‌شود")
	}
}
