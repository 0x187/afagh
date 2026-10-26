package money

import "testing"

func TestUnitsToInt(t *testing.T) {
	cases := map[string]int{
		"3": 300, "3.5": 350, "0.25": 25, "1.005": 101, "1.004": 100,
		"0": 0, "-2": 0, "abc": 0, "": 0, "12.34": 1234, "0.01": 1,
	}
	for in, want := range cases {
		if got := UnitsToInt(in); got != want {
			t.Fatalf("UnitsToInt(%q)=%d want %d", in, got, want)
		}
	}
}

func TestIntToUnits(t *testing.T) {
	if got := IntToUnits(350); got != 3.5 {
		t.Fatalf("IntToUnits(350)=%v", got)
	}
	if got := IntToUnits(101); got != 1.01 {
		t.Fatalf("IntToUnits(101)=%v", got)
	}
}

func TestToRial(t *testing.T) {
	cases := map[float64]float64{
		12345: 12350, // .5 تومان به بالا
		12344: 12340, 10: 10, 4: 0, 5: 10, 0: 0,
	}
	for in, want := range cases {
		if got := ToRial(in); got != want {
			t.Fatalf("ToRial(%v)=%v want %v", in, got, want)
		}
	}
}

func TestPercentRatioScale(t *testing.T) {
	if got := PercentOf(1000, 10); got != 100 {
		t.Fatalf("PercentOf=%d", got)
	}
	if got := PercentOf(333, 33.3); got != 111 {
		t.Fatalf("PercentOf(333,33.3)=%d", got)
	}
	if got := RatioOf(100, 1, 3); got != 33 {
		t.Fatalf("RatioOf=%d", got)
	}
	if got := RatioOf(100, 1, 0); got != 0 {
		t.Fatalf("RatioOf با مخرج صفر=%d", got)
	}
	if got := ScaleUnits(300, 1.5); got != 450 {
		t.Fatalf("ScaleUnits=%d", got)
	}
	if got := SumUnits([]int{100, 250, 3}); got != 353 {
		t.Fatalf("SumUnits=%d", got)
	}
}

func TestSafeRials(t *testing.T) {
	good := []string{"0", "123456", "999999999999", " 12"} // « 12» پس از trim معتبر است (همان TS)
	for _, s := range good {
		if SafeRials(s) == nil {
			t.Fatalf("SafeRials(%q) باید معتبر باشد", s)
		}
	}
	for _, s := range []string{"", "1e5", "12.5", "-1", "۱۲۳", "1000000000000", "abc"} {
		if SafeRials(s) != nil {
			t.Fatalf("SafeRials(%q) باید رد شود", s)
		}
	}
}

func TestFmtAndGroups(t *testing.T) {
	if got := FmtRial(1234567); got != "۱٬۲۳۴٬۵۶۷ ریال" {
		t.Fatalf("FmtRial=%q", got)
	}
	if got := RialString(1234.6); got != "1235" {
		t.Fatalf("RialString=%q", got)
	}
}
