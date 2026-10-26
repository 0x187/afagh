package pii

import (
	"strings"
	"testing"
)

// بردارهای پارتی تولیدشده با Node (همان الگوریتم pii.ts، کلید ثابت hex64):
//
//	docker run --rm node:22-bookworm-slim node -e "..."
const (
	testKeyHex = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
	nodeEnv    = "v1:000102030405060708090a0b:9d39f4182527d7f5b372c7d0b9306efc:26288404737df880fe03"
	nodeBlind  = "02b20408a54c2a8a81d42b028519b9c365656abe56e8832f45c3ee38bdd911c4"
)

func TestNodeParity(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	t.Setenv(KeyEnv, testKeyHex)

	plain, err := DecryptPii(nodeEnv)
	if err != nil || plain != "0012345678" {
		t.Fatalf("رمزگشایی پاکت Node: %q, %v", plain, err)
	}

	blind, err := BlindIndex("0012345678", "users.nationalCode")
	if err != nil || blind != nodeBlind {
		t.Fatalf("شاخص کور با Node هم‌خوان نیست: %s, %v", blind, err)
	}

	// ارقام فارسی + خط تیره باید همان شاخص را بدهند (نرمال‌سازی)
	blindFa, err := BlindIndex("۰۰۱۲۳۴-۵۶۷۸", "users.nationalCode")
	if err != nil || blindFa != nodeBlind {
		t.Fatalf("شاخص کور با ورودی فارسی: %s, %v", blindFa, err)
	}

	// context بخشی از دامنه است
	other, _ := BlindIndex("0012345678", "admissions_staging.nationalCode")
	if other == nodeBlind {
		t.Fatal("شاخص کور بدون تفکیک context ساخته شد")
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	t.Setenv(KeyEnv, testKeyHex)

	enc, err := EncryptPii("0012345678")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(enc, "v1:") || !IsPiiCiphertext(enc) {
		t.Fatalf("پاکت: %s", enc)
	}
	dec, err := DecryptPii(enc)
	if err != nil || dec != "0012345678" {
		t.Fatalf("رفت‌وبرگشت: %q, %v", dec, err)
	}
	// دو رمزگذاری از یک مقدار باید متفاوت باشند (IV تصادفی)
	enc2, _ := EncryptPii("0012345678")
	if enc == enc2 {
		t.Fatal("IV باید تصادفی باشد")
	}

	if empty, _ := EncryptPii(""); empty != "" {
		t.Fatal("ورودی خالی باید رشتهٔ خالی بدهد")
	}
	if empty, _ := DecryptPii(""); empty != "" {
		t.Fatal("رمزگشایی خالی باید رشتهٔ خالی بدهد")
	}
}

func TestCiphertextValidation(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	t.Setenv(KeyEnv, testKeyHex)

	if IsPiiCiphertext("0012345678") {
		t.Fatal("متن ساده نباید پاکت شمرده شود")
	}
	if IsPiiCiphertext("v2:000102030405060708090a0b:9d39f4182527d7f5b372c7d0b9306efc:26288404737df880fe03") {
		t.Fatal("نسخهٔ ناشناخته نباید معتبر باشد")
	}
	if _, err := DecryptPii("0012345678"); err == nil || !strings.Contains(err.Error(), "پاکت ناشناخته") {
		t.Fatalf("متن ساده باید خطای پاکت بدهد: %v", err)
	}
	// دستکاری داده
	tampered := "v1:000102030405060708090a0b:9d39f4182527d7f5b372c7d0b9306efc:26288404737df881fe03"
	if _, err := DecryptPii(tampered); err == nil || !strings.Contains(err.Error(), "رمزگشایی PII ناموفق") {
		t.Fatalf("دادهٔ دستکاری‌شده باید خطا بدهد: %v", err)
	}
}

func TestKeyRotation(t *testing.T) {
	oldKey := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	newKey := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	t.Setenv("NODE_ENV", "development")
	t.Setenv(KeyEnv, oldKey)
	enc, err := EncryptPii("1234567890")
	if err != nil {
		t.Fatal(err)
	}

	t.Setenv(KeyEnv, newKey)
	t.Setenv(KeyPreviousEnv, oldKey)
	dec, err := DecryptPii(enc)
	if err != nil || dec != "1234567890" {
		t.Fatalf("دورهٔ چرخش کلید: %q, %v", dec, err)
	}

	t.Setenv(KeyPreviousEnv, "")
	if _, err := DecryptPii(enc); err == nil {
		t.Fatal("بدون کلید قبلی باید شکست بخورد")
	}
}

func TestProductionFailClosed(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv(KeyEnv, "")
	if _, err := Key(); err == nil || !strings.Contains(err.Error(), "تعریف نشده") {
		t.Fatalf("production بدون کلید باید fail-closed باشد: %v", err)
	}
	if _, err := BlindIndex("0012345678", "users.nationalCode"); err == nil {
		t.Fatal("شاخص کور در production بدون کلید نباید ساخته شود")
	}
}

func TestNormalizeAndMask(t *testing.T) {
	cases := map[string]string{
		"۰۰۱۲۳۴۵۶۷۸۹":      "00123456789",
		"٠١٢٣٤٥٦٧٨٩":       "0123456789",
		"0012 345 678":     "0012345678",
		"۰۰۱۲۳۴-۵۶۷۸":      "0012345678",
		"0012\u200f345678": "0012345678",
		"0012\u202b345678": "0012345678",
	}
	for in, want := range cases {
		if got := NormalizePiiValue(in); got != want {
			t.Fatalf("NormalizePiiValue(%q)=%q want %q", in, got, want)
		}
	}
	if MaskPii("") != "—" || MaskPii("12345") != "*****" || MaskPii("0012345678") != "001*****78" {
		t.Fatalf("MaskPii: %q %q %q", MaskPii(""), MaskPii("12345"), MaskPii("0012345678"))
	}
}

func TestBlindIndexGuards(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	t.Setenv(KeyEnv, testKeyHex)
	if _, err := BlindIndex("", "users.nationalCode"); err == nil || !strings.Contains(err.Error(), "مقدار خالی") {
		t.Fatalf("مقدار خالی باید خطا بدهد: %v", err)
	}
	if _, err := BlindIndex("0012345678", "  "); err == nil || !strings.Contains(err.Error(), "context") {
		t.Fatalf("context خالی باید خطا بدهد: %v", err)
	}
}
