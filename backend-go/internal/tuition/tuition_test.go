package tuition

import "testing"

func ip(v int) *int       { return &v }
func i64(v int64) *int64  { return &v }
func sp(v string) *string { return &v }

func TestToNum(t *testing.T) {
	cases := []struct {
		in   any
		want float64
	}{
		{12.5, 12.5}, {3, 3}, {int64(7), 7}, {"18.25", 18.25}, {"abc", 0}, {nil, 0},
	}
	for _, c := range cases {
		if got := ToNum(c.in); got != c.want {
			t.Fatalf("ToNum(%v)=%v want %v", c.in, got, c.want)
		}
	}
}

func TestTermTypeOf(t *testing.T) {
	cases := []struct {
		in   TermInput
		want TermType
	}{
		{TermInput{TermCode: sp("00EQ1"), TermType: sp("NORMAL")}, Equivalence}, // the prefix takes precedence
		{TermInput{TermType: sp("SUMMER")}, Summer},
		{TermInput{TermType: sp("EQUIVALENCE")}, Equivalence},
		{TermInput{IsSummer: ip(1)}, Summer},
		{TermInput{}, Normal},
		{TermInput{TermType: sp("SOMETHING")}, Normal},
	}
	for _, c := range cases {
		if got := TermTypeOf(c.in); got != c.want {
			t.Fatalf("TermTypeOf(%+v)=%s want %s", c.in, got, c.want)
		}
	}
}

func rule(over func(*RuleLike)) RuleLike {
	r := RuleLike{
		ID: 1, DegreeLevelID: i64(1), FixedAmount: 1000, PerUnitTheory: 100,
		PerUnitPractical: 100, PerUnitGeneral: 100,
	}
	over(&r)
	return r
}

func TestMatches(t *testing.T) {
	if !Matches(rule(func(r *RuleLike) {}), Context{DegreeLevelID: i64(1)}) {
		t.Fatal("قاعدهٔ ساده باید تطبیق دهد")
	}
	if Matches(rule(func(r *RuleLike) { r.UniversityID = i64(2) }), Context{UniversityID: i64(1)}) {
		t.Fatal("دانشگاه متفاوت نباید تطبیق دهد")
	}
	if Matches(rule(func(r *RuleLike) { r.IsActive = ip(0) }), Context{}) {
		t.Fatal("قاعدهٔ غیرفعال نباید تطبیق دهد")
	}
	if Matches(rule(func(r *RuleLike) { r.DegreeLevelID = i64(2) }), Context{DegreeLevelID: i64(1)}) {
		t.Fatal("مقطع متفاوت نباید تطبیق دهد")
	}
	if Matches(rule(func(r *RuleLike) { r.OfferingType = sp("TRANSFER") }), Context{TermLevelOnly: true}) {
		t.Fatal("termLevelOnly باید قواعد offeringType را کنار بگذارد")
	}
	if Matches(rule(func(r *RuleLike) { r.EntryYearFrom = ip(1400) }), Context{DegreeLevelID: i64(1), EntryYear: ip(1399)}) {
		t.Fatal("ورودی قبل از بازه نباید تطبیق دهد")
	}
	if Matches(rule(func(r *RuleLike) { r.EntryYearTo = ip(1400) }), Context{DegreeLevelID: i64(1), EntryYear: ip(1401)}) {
		t.Fatal("ورودی بعد از بازه نباید تطبیق دهد")
	}
	if !Matches(rule(func(r *RuleLike) { r.EntryYearFrom = ip(1400); r.EntryYearTo = ip(1402) }), Context{DegreeLevelID: i64(1), EntryYear: ip(1401)}) {
		t.Fatal("ورودی داخل بازه باید تطبیق دهد")
	}
	if Matches(rule(func(r *RuleLike) { r.EntryTermID = i64(5) }), Context{DegreeLevelID: i64(1), EntryTermID: i64(6)}) {
		t.Fatal("نیمسال ورود متفاوت نباید تطبیق دهد")
	}
}

func TestResolveSpecificity(t *testing.T) {
	// a rule with degree level+major takes precedence over a degree-level-only rule
	rows := []RuleLike{
		rule(func(r *RuleLike) { r.ID = 1; r.DegreeLevelID = i64(1); r.FixedAmount = 1000 }),
		rule(func(r *RuleLike) { r.ID = 2; r.DegreeLevelID = i64(1); r.MajorID = i64(5); r.FixedAmount = 2000 }),
	}
	best := Resolve(rows, Context{DegreeLevelID: i64(1), MajorID: i64(5)})
	if best == nil || best.ID != 2 {
		t.Fatalf("قاعدهٔ خاص‌تر باید برنده شود: %+v", best)
	}

	// smaller priority wins
	prio := Resolve([]RuleLike{
		rule(func(r *RuleLike) { r.ID = 1; r.DegreeLevelID = i64(1); r.Priority = ip(50) }),
		rule(func(r *RuleLike) { r.ID = 2; r.DegreeLevelID = i64(1); r.Priority = ip(10) }),
	}, Context{DegreeLevelID: i64(1)})
	if prio == nil || prio.ID != 2 {
		t.Fatalf("priority کوچک‌تر باید برنده شود: %+v", prio)
	}

	// newer entryYearFrom on ties
	newer := Resolve([]RuleLike{
		rule(func(r *RuleLike) { r.ID = 1; r.DegreeLevelID = i64(1); r.EntryYearFrom = ip(1400) }),
		rule(func(r *RuleLike) { r.ID = 2; r.DegreeLevelID = i64(1); r.EntryYearFrom = ip(1402) }),
	}, Context{DegreeLevelID: i64(1), EntryYear: ip(1403)})
	if newer == nil || newer.ID != 2 {
		t.Fatalf("ورودی جدیدتر باید برنده شود: %+v", newer)
	}

	// no match → nil
	if Resolve([]RuleLike{rule(func(r *RuleLike) { r.DegreeLevelID = i64(9) })}, Context{DegreeLevelID: i64(1)}) != nil {
		t.Fatal("بدون قاعدهٔ منطبق باید nil بدهد")
	}
}

func TestPickFeeRule(t *testing.T) {
	rows := []FeeRuleLike{
		{ID: 1, DegreeLevelID: i64(1), TermType: sp("NORMAL"), FixedTuition: "1500", PerUnitTuition: "120", EffectiveFromYear: ip(1400)},
		{ID: 2, DegreeLevelID: i64(1), TermType: sp("NORMAL"), OfferingType: sp("TRANSFER"), FixedTuition: "9999", PerUnitTuition: "999"},
	}
	best := PickFeeRule(rows, FeeRuleParams{DegreeLevelID: i64(1), TermType: sp("NORMAL"), EntryYear: ip(1405), TermLevelOnly: true})
	if best == nil || best.ID != 1 || best.FixedTuition != 1500 || best.PerUnitTuition != 120 {
		t.Fatalf("pickFeeRule: %+v", best)
	}
	if PickFeeRule(rows, FeeRuleParams{DegreeLevelID: i64(2), TermType: sp("NORMAL")}) != nil {
		t.Fatal("مقطع نامنطبق باید nil بدهد")
	}
}

func TestMapLegacyFeeRules(t *testing.T) {
	d1 := int64(1)
	drafts := MapLegacyFeeRules([]LegacyFeeRuleLike{
		{DegreeLevelID: &d1, TermType: Normal, TermCode: sp("14021"), FixedTuition: 1000, PerUnitTuition: 100, TermSortKey: 1},
		{DegreeLevelID: &d1, TermType: Normal, TermCode: sp("14031"), FixedTuition: 1200, PerUnitTuition: 120, TermSortKey: 3}, // newest wins
		{DegreeLevelID: &d1, TermType: Normal, TermCode: sp("14011"), FixedTuition: 900, PerUnitTuition: 90, TermSortKey: 2},
		{DegreeLevelID: &d1, TermType: Summer, TermCode: sp("14023"), FixedTuition: 0, PerUnitTuition: 0, TermSortKey: 4}, // no-op
	})
	if len(drafts) != 1 {
		t.Fatalf("پیش‌نویس‌ها: %+v", drafts)
	}
	if drafts[0].FixedTuition != 1200 || drafts[0].PerUnitTuition != 120 || drafts[0].EffectiveFromYear != nil {
		t.Fatalf("نرخ تازه‌ترین ترم باید بماند: %+v", drafts[0])
	}
	if drafts[0].Note != "درون‌ریزی از قواعد مالی قدیمی — نرخ ترم 14031" {
		t.Fatalf("note: %s", drafts[0].Note)
	}
}

func TestEquivFixedMode(t *testing.T) {
	if NormalizeEquivFixedMode("per_term") != EquivPerTerm || NormalizeEquivFixedMode("NONE") != EquivNone || NormalizeEquivFixedMode("x") != EquivOnce {
		t.Fatal("normalizeEquivFixedMode نادرست")
	}
	if ShouldChargeFixed(EquivNone, true) || !ShouldChargeFixed(EquivPerTerm, false) ||
		!ShouldChargeFixed(EquivOnce, true) || ShouldChargeFixed(EquivOnce, false) {
		t.Fatal("shouldChargeFixed نادرست")
	}
}
