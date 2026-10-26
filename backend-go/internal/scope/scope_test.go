package scope

import (
	"testing"
	"time"
)

func dt(y int, m time.Month, d int) *time.Time {
	t := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	return &t
}

func TestSortTermsChronologically(t *testing.T) {
	terms := []TermScope{
		{ID: 1, TermCode: "14022"},
		{ID: 2, TermCode: "14031"},
		{ID: 3, TermCode: "14021"},
		{ID: 4, TermCode: "14012"},
	}
	got := SortTermsChronologically(terms)
	// ترتیب TS: year نزولی → semester صعودی → code نزولی
	// 14031 (نیمسال ۱)، سپس 14021 (نیمسال ۱)، سپس 14022 (نیمسال ۲)، سپس 14012
	want := []int64{2, 3, 1, 4}
	for i, id := range want {
		if got[i].ID != id {
			t.Fatalf("ترتیب نادرست: %v", []int64{got[0].ID, got[1].ID, got[2].ID, got[3].ID})
		}
	}
}

func TestPickEffectiveTerm(t *testing.T) {
	today := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	terms := []TermScope{
		{ID: 1, TermCode: "14031", StartDate: dt(2025, 9, 1), EndDate: dt(2026, 1, 20)},
		{ID: 2, TermCode: "14032", StartDate: dt(2026, 1, 25), EndDate: dt(2026, 6, 20)},
		{ID: 3, TermCode: "14041", StartDate: dt(2026, 9, 20), EndDate: dt(2027, 1, 20)},
	}
	// امروز در ترم ۳ است
	if eff := PickEffectiveTerm(terms, today); eff == nil || eff.ID != 3 {
		t.Fatalf("ترم شامل امروز باید مؤثر باشد: %+v", eff)
	}
	// بین ترم‌ها: آخرین ترم شروع‌شده
	between := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	if eff := PickEffectiveTerm(terms, between); eff == nil || eff.ID != 2 {
		t.Fatalf("بین ترم‌ها آخرین شروع‌شده مؤثر است: %+v", eff)
	}
	// پیش از همه: نزدیک‌ترین آینده
	before := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	if eff := PickEffectiveTerm(terms, before); eff == nil || eff.ID != 1 {
		t.Fatalf("پیش از همه، نزدیک‌ترین آینده مؤثر است: %+v", eff)
	}
}

func TestTeachingTermFilter(t *testing.T) {
	eq := "EQUIVALENCE"
	sp := "SPECIAL"
	normal := "NORMAL"
	if isTeachingTerm(&eq) || isTeachingTerm(&sp) {
		t.Fatal("EQUIVALENCE/SPECIAL باید پنهان شوند")
	}
	if !isTeachingTerm(&normal) || !isTeachingTerm(nil) {
		t.Fatal("NORMAL/خالی باید آموزشی باشند")
	}
}

func TestTermCodeNumberPersianDigits(t *testing.T) {
	if got := TermCodeNumber("۱۴۰۳۱"); got != 14031 {
		t.Fatalf("کد ترم با ارقام فارسی باید 14031 شود: %v", got)
	}
	if got := TermCodeNumber(""); got != -1e308 && !(got < 0) {
		t.Fatal("کد خالی باید -Inf باشد")
	}
}

func TestTermOrdinalForEntry(t *testing.T) {
	y := 1403
	term := 2
	// ورودی ۱۴۰۳۲: همان ترم = ۱؛ ۱۴۰۴۱ = ۲؛ ۱۴۰۳۱ (قبل از ورود) = nil
	if got := TermOrdinalForEntry(&y, &term, "14032"); got == nil || *got != 1 {
		t.Fatalf("۱۴۰۳۲: %v", got)
	}
	if got := TermOrdinalForEntry(&y, &term, "14041"); got == nil || *got != 2 {
		t.Fatalf("۱۴۰۴۱: %v", got)
	}
	if got := TermOrdinalForEntry(&y, &term, "14031"); got != nil {
		t.Fatalf("ترم قبل از ورود باید nil باشد: %v", *got)
	}
	if got := TermOrdinalForEntry(nil, nil, "14031"); got != nil {
		t.Fatal("بدون سال ورود باید nil بدهد")
	}
	if got := TermOrdinalForEntry(&y, &term, ""); got != nil {
		t.Fatal("بدون کد ترم باید nil بدهد")
	}
}
