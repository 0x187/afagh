package admin

import (
	"encoding/json"
	"testing"
)

func TestEscapeLike(t *testing.T) {
	cases := map[string]string{
		"abc":   "abc",
		`a\b`:   `a\\b`,
		"50%":   `50\%`,
		"a_b":   `a\_b`,
		`%_\`:   `\%\_\\`,
		"ریاضی": "ریاضی",
	}
	for in, want := range cases {
		if got := escapeLike(in); got != want {
			t.Fatalf("escapeLike(%q)=%q want %q", in, got, want)
		}
	}
}

func TestNumAndBoolJSON(t *testing.T) {
	if f, ok := numJSON(json.Number("17.5")); !ok || f != 17.5 {
		t.Fatal("json.Number باید پارس شود")
	}
	if f, ok := numJSON("12"); !ok || f != 12 {
		t.Fatal("رشتهٔ عددی باید پارس شود")
	}
	if _, ok := numJSON("abc"); ok {
		t.Fatal("رشتهٔ غیرعددی نباید پارس شود")
	}
	if b, ok := boolJSON(json.Number("0")); !ok || b {
		t.Fatal("۰ باید false شود")
	}
	if b, ok := boolJSON(json.Number("1")); !ok || !b {
		t.Fatal("۱ باید true شود")
	}
	if b, ok := boolJSON("on"); !ok || !b {
		t.Fatal("on باید true شود")
	}
	if b, ok := boolJSON("false"); !ok || b {
		t.Fatal("false باید false شود")
	}
}

func TestBankEnumsAndLimits(t *testing.T) {
	for _, v := range []string{"پایه", "اصلی", "تخصصی", "عمومی", "عملی", "نظری", "کارگاهی", "اختیاری"} {
		if !validCourseType(v) {
			t.Fatalf("نوع درس معتبر رد شد: %s", v)
		}
	}
	if validCourseType("نامعتبر") {
		t.Fatal("نوع درس نامعتبر پذیرفته شد")
	}
	if !validGradingType("NUMERIC") || !validGradingType("PASS_FAIL") || validGradingType("X") {
		t.Fatal("اعتبارسنجی نوع نمره نادرست است")
	}
	if !validOfferingScope("GENERAL_SERVICE") || validOfferingScope("BAD") {
		t.Fatal("اعتبارسنجی نحوهٔ ارائه نادرست است")
	}
	if !validLocationType("HYBRID") || validLocationType("BAD") {
		t.Fatal("اعتبارسنجی محل ارائه نادرست است")
	}
	if !maxRunes("سلام", 4) || maxRunes("سلام", 3) {
		t.Fatal("maxRunes نادرست است")
	}
}
