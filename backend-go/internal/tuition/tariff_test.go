package tuition

import "testing"

func TestTariffCourseAmount(t *testing.T) {
	rate := &TariffRate{TH: 1000, OP: 2500}
	if got := TariffCourseAmount(2, 1, rate); got != 4500 {
		t.Fatalf("amount = %v, want 4500", got)
	}
	if got := TariffCourseAmount(1.5, 0.5, rate); got != 2750 {
		t.Fatalf("amount = %v, want 2750", got)
	}
	// Official document behavior: an un-rated course is zero, not the default rate.
	if got := TariffAmountOrZero(2, 1, nil); got != 0 {
		t.Fatalf("nil rate amount = %v, want 0", got)
	}
}

func TestPickTariffRate(t *testing.T) {
	rates := map[int]TariffRate{2: {TH: 100, OP: 200}}
	two := 2
	if r := PickTariffRate(rates, &two); r == nil || r.TH != 100 || r.OP != 200 {
		t.Fatalf("unexpected rate: %+v", r)
	}
	one := 1
	if r := PickTariffRate(rates, &one); r != nil {
		t.Fatalf("missing mali type must be nil, got %+v", r)
	}
	if r := PickTariffRate(rates, nil); r != nil {
		t.Fatalf("nil mali type must be nil, got %+v", r)
	}
	zero := 0
	if r := PickTariffRate(rates, &zero); r != nil {
		t.Fatalf("zero mali type must be nil, got %+v", r)
	}
	if r := PickTariffRate(nil, &two); r != nil {
		t.Fatalf("empty rates must be nil, got %+v", r)
	}
}

func TestTermYearOf(t *testing.T) {
	y := 1405
	if got := termYearOf(&y, "14031"); got != 1405 {
		t.Fatalf("termYear = %d, want 1405", got)
	}
	if got := termYearOf(nil, "14031"); got != 1403 {
		t.Fatalf("fallback year = %d, want 1403", got)
	}
	if got := termYearOf(nil, ""); got != 0 {
		t.Fatalf("empty = %d, want 0", got)
	}
}
