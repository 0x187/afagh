package payroll

import (
	"math"
	"testing"
)

// ═══ money — هم‌ارز رفتار lib/money.ts ═══

func TestUnitsToInt(t *testing.T) {
	cases := []struct {
		in   float64
		want int
	}{
		{0, 0}, {1, 100}, {1.5, 150}, {2.1, 210},
		{1.005, 101}, // نیمه‌به‌بالا روی رشتهٔ دقیق، نه ۱۰۰.۴۹۹۹→۱۰۰
		{3.45, 345}, {0.005, 1},
		{-2, 0}, // منفی/نامعتبر ← صفر
	}
	for _, c := range cases {
		if got := UnitsToInt(c.in); got != c.want {
			t.Errorf("UnitsToInt(%v) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestIntToUnits(t *testing.T) {
	if got := IntToUnits(150); got != 1.5 {
		t.Errorf("IntToUnits(150) = %v", got)
	}
	if got := IntToUnits(345); got != 3.45 {
		t.Errorf("IntToUnits(345) = %v", got)
	}
}

func TestToRial(t *testing.T) {
	// گرد به مضرب ۱۰ ریال
	if got := ToRial(1234567); got != 1234570 {
		t.Errorf("ToRial(1234567) = %v, want 1234570", got)
	}
	if got := ToRial(1234564); got != 1234560 {
		t.Errorf("ToRial(1234564) = %v, want 1234560", got)
	}
	if got := ToRial(math.NaN()); got != 0 {
		t.Errorf("ToRial(NaN) = %v", got)
	}
}

func TestPercentAndRatio(t *testing.T) {
	if got := PercentOf(1000000, 40); got != 400000 {
		t.Errorf("PercentOf = %v", got)
	}
	if got := RatioOf(1000, 3, 0); got != 0 {
		t.Errorf("RatioOf با مخرج صفر = %v, want 0", got)
	}
	if got := RatioOf(1000, 1, 3); got != 333 {
		t.Errorf("RatioOf(1000,1,3) = %v, want 333", got)
	}
}

// ═══ formula — پارسر امن (بدون eval) ═══

func TestEvalFormulaBasic(t *testing.T) {
	cases := []struct {
		expr string
		vars FormulaVars
		want float64
	}{
		{"RT*UN", FormulaVars{"RT": 100000, "UN": 3}, 300000},
		{"TH*RT + PH*RT*1.5", FormulaVars{"TH": 3, "PH": 1, "RT": 10000}, 45000},
		{"(TH+PH)*RT/2", FormulaVars{"TH": 2, "PH": 2, "RT": 1000}, 2000},
		{"-RT*2", FormulaVars{"RT": 100}, -200},
	}
	for _, c := range cases {
		got, err := EvalFormula(c.expr, c.vars)
		if err != nil {
			t.Errorf("EvalFormula(%q) error: %v", c.expr, err)
			continue
		}
		if got != c.want {
			t.Errorf("EvalFormula(%q) = %v, want %v", c.expr, got, c.want)
		}
	}
}

func TestEvalFormulaAliases(t *testing.T) {
	// حروف قدیمی سما: N=TH, A=PH, U=UN, C=ST, R=RT, K=CF, F=BS, H=HR
	got, err := EvalFormula("N*R", FormulaVars{"TH": 3, "RT": 5000})
	if err != nil {
		t.Fatalf("alias error: %v", err)
	}
	if got != 15000 {
		t.Errorf("alias N*R = %v, want 15000", got)
	}
}

func TestEvalFormulaRejects(t *testing.T) {
	// تزریق/متغیر ناشناخته/تقسیم بر صفر — همه fail-closed
	if _, err := EvalFormula("RT; DROP TABLE x", FormulaVars{"RT": 1}); err == nil {
		t.Error("نویسهٔ نامعتبر باید رد شود")
	}
	if _, err := EvalFormula("XX*2", FormulaVars{}); err == nil {
		t.Error("متغیر ناشناخته باید رد شود")
	}
	if _, err := EvalFormula("RT/0", FormulaVars{"RT": 1}); err == nil {
		t.Error("تقسیم بر صفر باید رد شود")
	}
	if _, err := EvalFormula("(RT*2", FormulaVars{"RT": 1}); err == nil {
		t.Error("پرانتز بسته‌نشده باید رد شود")
	}
	if _, err := EvalFormula("RT*2 3", FormulaVars{"RT": 1}); err == nil {
		t.Error("عبارت اضافی در پایان باید رد شود")
	}
}

func TestValidateFormula(t *testing.T) {
	if msg := ValidateFormula("RT*UN"); msg != "" {
		t.Errorf("فرمول معتبر رد شد: %s", msg)
	}
	if msg := ValidateFormula(""); msg == "" {
		t.Error("فرمول خالی باید خطا بدهد")
	}
	if msg := ValidateFormula("import os"); msg == "" {
		t.Error("نویسهٔ نامعتبر باید خطا بدهد")
	}
}

// ═══ matchRule / diagnose — الگوریتم یکپارچه ═══

func rule(t *string, rank *string) PayRule {
	return PayRule{OfferingType: t, AcademicRank: rank}
}

func strPtr(s string) *string { return &s }

func TestMatchRuleMostSpecificWins(t *testing.T) {
	// ترتیب ورودی = خروجی loadPayRules (خاص‌ترین اول، برچسب امتیاز بیشتر).
	rules := []PayRule{
		{ID: 2, OfferingType: strPtr("THESIS"), Expression: strPtr("ST*RT")},
		{ID: 1, OfferingType: nil, Expression: strPtr("RT*UN")},
	}
	m := RuleMatch{OfferingType: "THESIS", Role: "SUPERVISOR", HasClass: false, Enrolled: 3, Nth: 1}
	r := MatchRule(rules, m)
	if r == nil || r.ID != 2 {
		t.Fatalf("قانون خاص‌تر باید برنده شود؛ got %+v", r)
	}
}

func TestMatchRuleStudentRange(t *testing.T) {
	rules := []PayRule{
		{ID: 1, MinStudents: intPtr(40), Expression: strPtr("RT*UN*1.15")},
	}
	m := RuleMatch{OfferingType: "THEORY", Role: "MAIN_LECTURER", HasClass: true, Enrolled: 30, Nth: 1}
	if r := MatchRule(rules, m); r != nil {
		t.Errorf("خارج از بازه نباید منطبق شود: %+v", r)
	}
	m.Enrolled = 45
	if r := MatchRule(rules, m); r == nil {
		t.Error("داخل بازه باید منطبق شود")
	}
}

func intPtr(i int) *int { return &i }

func TestDiagnoseRuleMissFirstBlockingDim(t *testing.T) {
	rules := []PayRule{
		{OfferingType: strPtr("THEORY"), ProfessorRole: strPtr("MAIN_LECTURER")},
	}
	// نقش ناسازگار — باید در dim دوم (professorRole) متوقف شود
	dim, _ := DiagnoseRuleMiss(rules, RuleMatch{OfferingType: "THEORY", Role: "SUPERVISOR", HasClass: true, Enrolled: 10, Nth: 1})
	if dim != "professorRole" {
		t.Errorf("dim = %s, want professorRole", dim)
	}
	// بدون قانون
	dim, _ = DiagnoseRuleMiss(nil, RuleMatch{OfferingType: "THEORY", Role: "MAIN_LECTURER", HasClass: true, Enrolled: 10, Nth: 1})
	if dim != "none" {
		t.Errorf("dim = %s, want none", dim)
	}
}

func TestCrowdedMultTiers(t *testing.T) {
	data := &termData{
		Coefs:            coefs{Crowded: 1.15},
		CrowdedThreshold: 40,
		CrowdedStep:      25,
		CrowdedStepUp:    0.05,
	}
	// زیر آستانه: بدون برچسب
	mult, label := crowdedMult(30, data)
	if mult != 1.15 || label != "" {
		t.Errorf("زیر آستانه: mult=%v label=%q", mult, label)
	}
	// یک پله
	mult, label = crowdedMult(50, data)
	if mult != 1.15 || label == "" {
		t.Errorf("یک پله (up>0 ولی steps=1): mult=%v label=%q", mult, label)
	}
	// دو پله: n=65 → steps=⌊25/25⌋+1=2 → 1.15+0.05=1.20
	mult, label = crowdedMult(65, data)
	if mult != 1.2 {
		t.Errorf("دو پله: mult=%v, want 1.2 (label=%q)", mult, label)
	}
}

func TestGroupThousands(t *testing.T) {
	if got := groupThousands(174800000); got != "174,800,000" {
		t.Errorf("groupThousands = %q", got)
	}
	if got := groupThousands(-9500); got != "-9,500" {
		t.Errorf("groupThousands منفی = %q", got)
	}
}

func TestMulberryRoundZeroAndSign(t *testing.T) {
	// ⚠ رگرسیون: 0/0=NaN در پیاده‌سازی Trunc — صفر باید صفر بماند.
	if got := MulberryRound(0); got != 0 || got != got {
		t.Errorf("MulberryRound(0) = %v", got)
	}
	if got := MulberryRound(-3.6); got != -4 {
		t.Errorf("MulberryRound(-3.6) = %v, want -4", got)
	}
	if got := MulberryRound(2.5); got != 3 {
		t.Errorf("MulberryRound(2.5) = %v, want 3", got)
	}
	if got := ToRial(0); got != 0 || got != got {
		t.Errorf("ToRial(0) = %v", got)
	}
}
