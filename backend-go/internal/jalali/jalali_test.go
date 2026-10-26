package jalali

import "testing"

// تبدیل‌های شناخته‌شده + رفت‌وبرگشت ۲۰هزار روز.
func TestKnownConversions(t *testing.T) {
	cases := []struct {
		g        GregorianDate
		j        Date
		wantLeap bool
	}{
		{GregorianDate{2026, 10, 26}, Date{1405, 8, 4}, false},
		{GregorianDate{2025, 3, 21}, Date{1404, 1, 1}, false},
		{GregorianDate{2024, 3, 20}, Date{1403, 1, 1}, true},
		{GregorianDate{2021, 3, 21}, Date{1400, 1, 1}, false},
		{GregorianDate{2000, 1, 1}, Date{1378, 10, 11}, false},
	}
	for _, c := range cases {
		got := ToJalali(c.g.Y, c.g.M, c.g.D)
		if got != c.j {
			t.Fatalf("%v → %v (want %v)", c.g, got, c.j)
		}
		back := ToGregorian(got.Y, got.M, got.D)
		if back != c.g {
			t.Fatalf("برگشت %v → %v (want %v)", got, back, c.g)
		}
		if IsLeap(got.Y) != c.wantLeap {
			t.Fatalf("کبیسهٔ %d = %v want %v", got.Y, IsLeap(got.Y), c.wantLeap)
		}
	}
}

func TestRoundTripRange(t *testing.T) {
	start := G2D(2000, 1, 1)
	for i := 0; i < 20000; i++ {
		jdn := start + i
		j := D2J(jdn)
		back, err := J2D(j.Y, j.M, j.D)
		if err != nil {
			t.Fatalf("J2D(%v): %v", j, err)
		}
		if back != jdn {
			t.Fatalf("رفت‌وبرگشت روز %d شکست: %v → %d", jdn, j, back)
		}
	}
}

func TestMonthLength(t *testing.T) {
	if MonthLength(1405, 1) != 31 || MonthLength(1405, 7) != 30 {
		t.Fatal("طول ماه‌های ثابت نادرست است")
	}
	// ۱۴۰۳ کبیسه: اسفند ۳۰ روز
	if MonthLength(1403, 12) != 30 {
		t.Fatal("اسفند ۱۴۰۳ باید ۳۰ روز باشد")
	}
	if MonthLength(1405, 12) != 29 {
		t.Fatal("اسفند ۱۴۰۵ باید ۲۹ روز باشد")
	}
}

func TestToShamsi(t *testing.T) {
	if got := ToShamsi(""); got != "—" {
		t.Fatalf("خالی → «—»: %q", got)
	}
	if got := ToShamsi("1405/08/04"); got != "1405/08/04" {
		t.Fatalf("شمسی دست‌نخورده: %q", got)
	}
	if got := ToShamsi("2026-10-26"); got != "۱۴۰۵/۰۸/۰۴" {
		t.Fatalf("ISO → شمسی: %q", got)
	}
	if got := ToShamsi("not-a-date"); got != "not-a-date" {
		t.Fatalf("نامعتبر دست‌نخورده: %q", got)
	}
}

func TestGroupThousands(t *testing.T) {
	if got := GroupThousands(1234567); got != "۱٬۲۳۴٬۵۶۷" {
		t.Fatalf("grouping=%q", got)
	}
	if got := GroupThousands(999); got != "۹۹۹" {
		t.Fatalf("grouping کوچک=%q", got)
	}
}
