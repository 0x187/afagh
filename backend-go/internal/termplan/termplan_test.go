package termplan

import "testing"

func intp(n int) *int { return &n }

func TestTermCountForDegree(t *testing.T) {
	cases := []struct {
		termCount   *int
		code, title string
		want        int
	}{
		{intp(4), "BS", "کارشناسی پیوسته", 4},
		{intp(8), "AD", "کاردانی", 8},
		{intp(0), "", "", 8},
		{intp(99), "", "", 8},
		{nil, "AD", "", 4},
		{nil, "MS", "", 4},
		{nil, "PHD", "", 4},
		{nil, "BS", "", 8},
		{nil, "ms", "", 4},
		{nil, "", "کاردانی", 4},
		{nil, "", "کارشناسی ناپیوسته", 4},
		{nil, "", "کارشناسی ارشد", 4},
		{nil, "", "دکترای تخصصی", 4},
		{nil, "", "کارشناسی پیوسته", 8},
		{nil, "", "کارشناسی", 8},
		{nil, "", "", 8},
		{nil, "", "كارداني", 4},
	}
	for _, c := range cases {
		if got := TermCountForDegree(c.termCount, c.code, c.title); got != c.want {
			t.Fatalf("TermCountForDegree(%v,%q,%q)=%d want %d", c.termCount, c.code, c.title, got, c.want)
		}
	}
}

func TestSummerAndPlan(t *testing.T) {
	if SummerSemester != 9 {
		t.Fatal("تابستان باید ۹ باشد")
	}
	if !IsSummerSemester(intp(9)) || IsSummerSemester(intp(2)) || IsSummerSemester(nil) {
		t.Fatal("isSummerSemester نادرست")
	}
	got4 := PlanSemesters(4)
	if len(got4) != 4 || got4[0] != 1 || got4[3] != 4 {
		t.Fatalf("planSemesters(4)=%v", got4)
	}
	got8 := PlanSemesters(8)
	if len(got8) != 8 || got8[7] != 8 {
		t.Fatalf("planSemesters(8)=%v", got8)
	}
}
