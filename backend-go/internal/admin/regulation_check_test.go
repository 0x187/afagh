package admin

import "testing"

func ptr[T any](v T) *T { return &v }

func TestTermChronologicalValue(t *testing.T) {
	cases := []struct {
		code *string
		sort *int
		want int
	}{
		{nil, ptr(7), 7},                // sortOrder مقدم است
		{ptr("992"), nil, 13992},        // سه‌رقمی → ۱۳+
		{ptr("4001"), nil, 14001},       // چهاررقمی 4/0 → ۱+
		{ptr("14032"), nil, 14032},      // چهاررقمی عادی
		{ptr("۱۴۰۳۲"), nil, 0},          // غیررقمی → ۰
		{nil, nil, 0},                   // بدون داده
		{ptr(" 1403-2 "), ptr(0), 1403}, // parseInt تا اولین غیررقمی
	}
	for _, c := range cases {
		if got := termChronologicalValue(c.code, c.sort); got != c.want {
			t.Fatalf("termChronologicalValue(%v,%v)=%d want %d", c.code, c.sort, got, c.want)
		}
	}
}

func TestRegulationFailExcludeCode(t *testing.T) {
	cfgWith := func(failed, policy string) *samaRegConfig {
		c := &samaRegConfig{}
		c.GradingAndGPA.FailedSamaStatusCode = failed
		c.GradingAndGPA.FailedCourseGpaPolicy = policy
		return c
	}
	cases := []struct {
		name  string
		title *string
		cfg   *samaRegConfig
		want  string
	}{
		{"کد صریح آیین‌نامه", ptr("آیین‌نامه"), cfgWith("77", "EXCLUDE_IF_PASSED"), "77"},
		{"۱۳۹۱", ptr("آیین‌نامه"), cfgWith("", "EXCLUDE_IF_PASSED_1391"), "-91"},
		{"ارشد ۹۴", ptr("آیین‌نامهٔ ۹۴ ارشد"), cfgWith("", "EXCLUDE_IF_PASSED"), "941"},
		{"دکتری ۹۵", ptr("آیین‌نامه 95 دکتری"), cfgWith("", ""), "951"},
		{"۱۳۹۳", ptr("آیین‌نامه"), cfgWith("", "EXCLUDE_IF_PASSED"), "931"},
		{"بدون سیاست", ptr("آیین‌نامه"), cfgWith("", ""), ""},
		{"بدون تنظیمات", ptr("آیین‌نامه"), nil, ""},
	}
	for _, c := range cases {
		if got := regulationFailExcludeCode(c.title, c.cfg); got != c.want {
			t.Fatalf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}

func TestResolveRetakeBar(t *testing.T) {
	if v := resolveRetakeBar("OTHER", ptr(14.0), 10); v != nil {
		t.Fatalf("سیاست غیر ۱۳۹۱ نباید حد نصاب مجدد داشته باشد: %v", *v)
	}
	if v := resolveRetakeBar("EXCLUDE_IF_PASSED_1391", ptr(14.0), 10); v == nil || *v != 14 {
		t.Fatalf("retakeMinGrade باید برنده شود")
	}
	if v := resolveRetakeBar("EXCLUDE_IF_PASSED_1391", nil, 12); v == nil || *v != 12 {
		t.Fatalf("fallback باید passingGrade باشد")
	}
	if v := resolveRetakeBar("EXCLUDE_IF_PASSED_1391", nil, 0); v != nil {
		t.Fatalf("بدون حد نصاب هیچ مقداری برنگردد")
	}
}

func TestPtrTrim(t *testing.T) {
	if ptrTrim(nil) != nil {
		t.Fatal("nil باید nil بماند")
	}
	if ptrTrim(ptr("   ")) != nil {
		t.Fatal("فاصله باید nil شود")
	}
	if got := ptrTrim(ptr(" 1 ")); got == nil || *got != "1" {
		t.Fatal("trim باید انجام شود")
	}
}
