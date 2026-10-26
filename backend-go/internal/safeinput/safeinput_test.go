package safeinput

import (
	"encoding/json"
	"strings"
	"testing"
)

var (
	png  = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 0x00}
	jpeg = []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10}
	gif  = []byte{0x47, 0x49, 0x46, 0x38, 0x39, 0x61}
	bmp  = []byte{0x42, 0x4d, 0x00, 0x00, 0x00, 0x00}
	pdf  = []byte{0x25, 0x50, 0x44, 0x46, 0x2d, 0x31}
	webp = append(append([]byte("RIFF"), 0, 0, 0, 0), []byte("WEBP")...)
)

func TestMagicMatches(t *testing.T) {
	cases := []struct {
		mime string
		b    []byte
		want bool
	}{
		{"image/png", png, true}, {"image/jpeg", jpeg, true}, {"image/gif", gif, true},
		{"image/bmp", bmp, true}, {"application/pdf", pdf, true}, {"image/webp", webp, true},
		{"image/jpeg", png, false}, {"image/png", jpeg, false},
		{"image/png", []byte{0x89, 0x50}, false},
		{"image/webp", []byte("RIFFxxxxNOPE"), false},
		{"application/octet-stream", png, false},
	}
	for _, c := range cases {
		if got := MagicMatches(c.mime, c.b); got != c.want {
			t.Fatalf("MagicMatches(%s)=%v want %v", c.mime, got, c.want)
		}
	}
}

func TestCheckUpload(t *testing.T) {
	if r := CheckUpload("photo.png", "image/png", png); !r.OK || r.Mime != "image/png" || r.Ext != "png" {
		t.Fatalf("PNG معتبر رد شد: %+v", r)
	}
	if r := CheckUpload("photo.PNG", "image/png", png); !r.OK || r.Ext != "png" {
		t.Fatalf("پسوند بزرگ‌حرف: %+v", r)
	}
	if r := CheckUpload("doc.pdf", "application/pdf", pdf); !r.OK || r.Ext != "pdf" {
		t.Fatalf("PDF معتبر: %+v", r)
	}
	if r := CheckUpload("x.txt", "text/plain", []byte("hello world")); r.OK || r.Status != 415 {
		t.Fatalf("نوع خارج whitelist باید ۴۱۵ بدهد: %+v", r)
	}
	if r := CheckUpload("photo.png", "image/jpeg", png); r.OK || r.Status != 400 {
		t.Fatalf("عدم تطابق محتوا باید ۴۰۰ بدهد: %+v", r)
	}
	if r := CheckUpload("photo.jpg", "image/png", png); r.OK || r.Status != 400 {
		t.Fatalf("عدم تطابق پسوند باید ۴۰۰ بدهد: %+v", r)
	}
	if r := CheckUpload("a.p n g", "image/png", png); !r.OK || r.Ext != "png" {
		t.Fatalf("پاک‌سازی پسوند: %+v", r)
	}
}

func TestSanitizeRequestFormData(t *testing.T) {
	okCase := func(raw string, studentID int64) bool {
		return SanitizeRequestFormData(json.RawMessage(raw), studentID).OK
	}
	if !okCase(`{"title":"درخواست","count":3,"urgent":true,"note":null}`, 7) {
		t.Fatal("مقادیر ساده باید پذیرفته شوند")
	}
	if !okCase(`{"file":{"key":"requests/7/a.pdf","name":"a.pdf","size":10,"mimeType":"application/pdf"}}`, 7) {
		t.Fatal("پیوست در پوشهٔ همان دانشجو باید پذیرفته شود")
	}
	if okCase(`{"file":{"key":"requests/8/evil.pdf","name":"e.pdf","size":1,"mimeType":"application/pdf"}}`, 7) {
		t.Fatal("پیوست دانشجوی دیگر باید رد شود")
	}
	if okCase(`{"f":"requests/8/evil.pdf"}`, 7) {
		t.Fatal("رشتهٔ مسیر بیرون از پوشه باید رد شود")
	}
	if okCase(`{"f":{"key":"requests/7/../evil"}}`, 7) {
		t.Fatal("مسیر دارای .. باید رد شود")
	}
	if okCase(`{"s":"`+strings.Repeat("x", 2001)+`"}`, 1) {
		t.Fatal("مقدار خیلی طولانی باید رد شود")
	}
	if okCase(`null`, 1) || okCase(`[1,2,3]`, 1) {
		t.Fatal("null/آرایه باید رد شوند")
	}
	big := map[string]int{}
	for i := 0; i < 51; i++ {
		big["k"+string(rune('a'+i))] = i
	}
	raw, _ := json.Marshal(big)
	if okCase(string(raw), 1) {
		t.Fatal("بیش از ۵۰ کلید باید رد شود")
	}
}
