package gradestatus

import "testing"

func TestTableIntegrity(t *testing.T) {
	if len(Codes) != 50 {
		t.Fatalf("تعداد کدهای جدول مرجع باید ۵۰ باشد: %d", len(Codes))
	}
	seen := map[string]bool{}
	for _, c := range Codes {
		if seen[c.Code] {
			t.Fatalf("کد تکراری: %s", c.Code)
		}
		seen[c.Code] = true
	}
}

func TestHelpers(t *testing.T) {
	if !IsPassed("1") || IsPassed("2") || IsPassed("") {
		t.Fatal("isPassed نادرست")
	}
	if !IsDropped("6") || IsDropped("1") {
		t.Fatal("isDropped نادرست")
	}
	if !IsNonGpaPass("12") || !IsNonGpaPass("18") || IsNonGpaPass("1") {
		t.Fatal("isNonGpaPass نادرست")
	}
	if got := TitleOf("2"); got == nil || *got != "درس عادي - مردود" {
		t.Fatalf("TitleOf(2)=%v", got)
	}
	if TitleOf("999") != nil {
		t.Fatal("کد ناشناخته باید nil بدهد")
	}
	if NonGpaCodes["12"] != true || NonGpaCodes["1"] == true {
		t.Fatal("NonGpaCodes نادرست")
	}
	if NonGpaPassCodes["16"] != true || NonGpaPassCodes["2"] == true {
		t.Fatal("NonGpaPassCodes نادرست")
	}
	if NonTermGpaCodes["23"] == true || NonTermGpaCodes["1"] == true {
		t.Fatal("NonTermGpaCodes نادرست")
	}
}

func TestRowCountsTowardGpa(t *testing.T) {
	zero := 0
	one := 1
	if !RowCountsTowardGpa("2", &one, "NUMERIC") {
		t.Fatal("مردودی عادی باید در معدل اثر داشته باشد")
	}
	if RowCountsTowardGpa("12", &one, "NUMERIC") {
		t.Fatal("۱۲ (بدون احتساب) نباید در معدل اثر داشته باشد")
	}
	if RowCountsTowardGpa("1", &zero, "NUMERIC") {
		t.Fatal("courses.affectsGpa=0 نباید در معدل اثر داشته باشد")
	}
	if RowCountsTowardGpa("1", &one, "DESCRIPTIVE") {
		t.Fatal("درس توصیفی نباید در معدل اثر داشته باشد")
	}
	if !RowCountsTowardGpa("", nil, "") {
		t.Fatal("کد خالی/سوییچ nil باید مجاز باشد")
	}
}

func TestResolveRetakeBar(t *testing.T) {
	v := 14.5
	if got := ResolveRetakeBar("EXCLUDE_IF_PASSED_1391", &v, 10); got == nil || *got != 14.5 {
		t.Fatalf("retakeMinGrade باید ملاک باشد: %v", got)
	}
	if got := ResolveRetakeBar("EXCLUDE_IF_PASSED_1391", nil, 10); got == nil || *got != 10 {
		t.Fatalf("در نبود retakeMinGrade، کف قبولی ملاک است: %v", got)
	}
	if got := ResolveRetakeBar("OTHER", &v, 10); got != nil {
		t.Fatalf("سیاست دیگر باید nil بدهد: %v", got)
	}
	if got := ResolveRetakeBar("EXCLUDE_IF_PASSED_1391", nil, 0); got != nil {
		t.Fatalf("بدون هیچ کف معتبر باید nil بدهد: %v", got)
	}
}

func TestRegulationFrozen(t *testing.T) {
	for _, code := range []string{"6", "14", "-1", "55", "400"} {
		if !RegulationFrozenCodes[code] {
			t.Fatalf("کد %s باید frozen باشد", code)
		}
	}
	if RegulationFrozenCodes["1"] || RegulationFrozenCodes["931"] {
		t.Fatal("۱ و ۹۳۱ نباید frozen باشند")
	}
}
