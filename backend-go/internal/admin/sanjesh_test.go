package admin

import "testing"

func TestParseFixedWidthText(t *testing.T) {
	cols, err := ParseSanjeshColumns(`[
		{"name":"nc","start":0,"length":10,"target":"nationalCode"},
		{"name":"sc","start":10,"length":8,"target":"studentCode"},
		{"name":"prev","start":18,"length":4,"target":"previousMajorCode"}
	]`)
	if err != nil {
		t.Fatal(err)
	}
	text := "0012345678314120011234\n----\n\n0012345678314120025678\n"
	rows := ParseFixedWidthText(text, cols)
	if len(rows) != 2 {
		t.Fatalf("تعداد ردیف: %d", len(rows))
	}
	if rows[0]["__nationalCode"] != "0012345678" || rows[0]["__studentCode"] != "31412001" || rows[0]["__previousMajorCode"] != "1234" {
		t.Fatalf("پارس ردیف اول نادرست: %#v", rows[0])
	}
	if rows[1]["__previousMajorCode"] != "5678" {
		t.Fatalf("پارس ردیف دوم نادرست: %#v", rows[1])
	}
}

func TestParseSanjeshColumnsInvalid(t *testing.T) {
	for _, raw := range []string{"", "not-json", `[{"name":"","start":0,"length":2}]`, `[{"name":"x","start":-1,"length":2}]`, `[{"name":"x","start":0,"length":0}]`} {
		if _, err := ParseSanjeshColumns(raw); err == nil {
			t.Fatalf("ساختار نامعتبر پذیرفته شد: %q", raw)
		}
	}
}

func TestNormalizeNationalCode(t *testing.T) {
	if v := NormalizeNationalCode("0012345678"); v == nil || *v != "0012345678" {
		t.Fatal("کد ۱۰ رقمی")
	}
	if v := NormalizeNationalCode("1234567890123456"); v == nil || *v != "7890123456" {
		t.Fatal("بیش از ۱۰ رقم → ۱۰ رقم آخر")
	}
	if v := NormalizeNationalCode("۱۲۳۴۵"); v != nil {
		t.Fatal("ارقام فارسی/کوتاه نباید معتبر شوند")
	}
	if v := NormalizeNationalCode("0012-345-678"); v == nil || *v != "0012345678" {
		t.Fatal("جداکننده باید حذف شود")
	}
}

func TestSuggestRelation(t *testing.T) {
	p := func(s string) *string { return &s }
	if SuggestRelation(nil, p("412")) != nil {
		t.Fatal("بدون رشتهٔ قبلی باید nil باشد")
	}
	if v := SuggestRelation(p("412"), p("412")); v == nil || *v != "RELATED" {
		t.Fatal("کد برابر → RELATED")
	}
	if v := SuggestRelation(p("4121"), p("4129")); v == nil || *v != "PARTIAL" {
		t.Fatal("سه رقم اول یکسان → PARTIAL")
	}
	if v := SuggestRelation(p("412"), p("999")); v == nil || *v != "UNRELATED" {
		t.Fatal("کد ناهمخوان → UNRELATED")
	}
	if v := SuggestRelation(p("41"), p("412")); v == nil || *v != "UNRELATED" {
		t.Fatal("کد کوتاه → UNRELATED")
	}
}
