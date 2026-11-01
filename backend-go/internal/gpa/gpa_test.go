package gpa

import "testing"

func i(v int) *int       { return &v }
func i64(v int64) *int64 { return &v }
func s(v string) *string { return &v }

func TestParseGradeUnits(t *testing.T) {
	if ParseGrade(nil) != nil || ParseGrade("") != nil || ParseGrade("  ") != nil || ParseGrade("abc") != nil {
		t.Fatal("مقادیر خالی/غیرعددی باید nil بدهند")
	}
	if got := ParseGrade("12.5"); got == nil || *got != 12.5 {
		t.Fatalf("ParseGrade(12.5)=%v", got)
	}
	if got := ParseUnits(nil); got != 0 {
		t.Fatal("واحد خالی باید صفر باشد")
	}
	if got := ParseUnits(-2); got != 0 {
		t.Fatal("واحد منفی باید صفر باشد")
	}
	if got := ParseUnits("3.5"); got != 3.5 {
		t.Fatalf("ParseUnits(3.5)=%v", got)
	}
}

func TestAccumulatorPrecision(t *testing.T) {
	acc := &Accumulator{}
	acc.Add(15.12, 3) // Mark with two decimal places
	acc.Add(18.34, 2)
	if !acc.HasUnits() || acc.Units() != 5 {
		t.Fatalf("units=%v", acc.Units())
	}
	want := (15.12*3 + 18.34*2) / 5
	exact := acc.Exact()
	if exact == nil || *exact != want {
		t.Fatalf("exact=%v want %v", exact, want)
	}
	rounded := acc.Rounded()
	if rounded == nil || *rounded != 16.41 {
		t.Fatalf("rounded=%v want 16.41", rounded)
	}
	empty := &Accumulator{}
	if empty.Exact() != nil || empty.Rounded() != nil {
		t.Fatal("انباشتگر خالی باید nil بدهد")
	}
}

func row(over func(*Row)) Row {
	r := Row{Code: "C1", Units: 3, GradeValue: 15, CourseID: i64(1)}
	over(&r)
	return r
}

func TestOfficialGpaBasics(t *testing.T) {
	core := AggregateOfficialGpaRows([]Row{
		row(func(r *Row) { r.GradeValue = 20; r.Units = 3 }),
		row(func(r *Row) { r.Code = "C2"; r.GradeValue = 10; r.Units = 2; r.CourseID = i64(2) }),
	}, OfficialInput{PassingGrade: 10, Policy: ""})
	if core.GPA != 16 || core.TotalUnits != 5 || core.PassedUnits != 5 || core.ExcludedCount != 0 {
		t.Fatalf("gpa پایه: %+v", core)
	}

	// Mark 9 with a floor of 10: not a pass, but it counts toward the GPA because it affects it
	failRow := AggregateOfficialGpaRows([]Row{
		row(func(r *Row) { r.GradeValue = 20 }),
		row(func(r *Row) { r.Code = "C2"; r.GradeValue = 9; r.Units = 2; r.CourseID = i64(2) }),
	}, OfficialInput{PassingGrade: 10, Policy: ""})
	if failRow.PassedUnits != 3 {
		t.Fatalf("passedUnits باید فقط ۳ باشد: %+v", failRow)
	}
	// (20×3 + 9×2)/5 = 15.6
	if failRow.GPA != 15.6 {
		t.Fatalf("gpa با مردودی: %v", failRow.GPA)
	}

	// Course threshold (minMark=18 on the row)
	minMark := AggregateOfficialGpaRows([]Row{
		row(func(r *Row) { r.GradeValue = 17; r.CourseMinMark = 18 }),
	}, OfficialInput{PassingGrade: 10, Policy: ""})
	if minMark.PassedUnits != 0 {
		t.Fatalf("minMark=18 باید ردیف ۱۷ را مردود کند: %+v", minMark)
	}
}

func TestOfficialGpaRules(t *testing.T) {
	// Code 12 (not counted): has passing credits but the mark does not count toward the GPA
	nonGpa := AggregateOfficialGpaRows([]Row{
		row(func(r *Row) { r.GradeValue = 18; r.SamaGradeStatusCode = s("12") }),
	}, OfficialInput{PassingGrade: 10, Policy: ""})
	if nonGpa.PassedUnits != 3 || nonGpa.TotalUnits != 0 || nonGpa.GPA != 0 {
		t.Fatalf("کد ۱۲: %+v", nonGpa)
	}

	// Descriptive course: mark 1 is a pass, no effect on the GPA
	desc := AggregateOfficialGpaRows([]Row{
		row(func(r *Row) { r.GradeValue = 1; r.GradingType = s("DESCRIPTIVE") }),
	}, OfficialInput{PassingGrade: 10, Policy: ""})
	if desc.PassedUnits != 3 || desc.TotalUnits != 0 {
		t.Fatalf("توصیفی: %+v", desc)
	}
	descFail := AggregateOfficialGpaRows([]Row{
		row(func(r *Row) { r.GradeValue = 0; r.GradingType = s("DESCRIPTIVE") }),
	}, OfficialInput{PassingGrade: 10, Policy: ""})
	if descFail.PassedUnits != 0 {
		t.Fatalf("توصیفی ۰ نباید قبول شود: %+v", descFail)
	}

	// affectsGpa=0 → no effect on the GPA, passing credits retained
	noAffect := AggregateOfficialGpaRows([]Row{
		row(func(r *Row) { r.GradeValue = 16; r.AffectsGpa = i(0) }),
	}, OfficialInput{PassingGrade: 10, Policy: ""})
	if noAffect.PassedUnits != 3 || noAffect.TotalUnits != 0 {
		t.Fatalf("affectsGpa=0: %+v", noAffect)
	}

	// EXEMPT without a mark: neither passing credits (in this core) nor GPA
	exempt := AggregateOfficialGpaRows([]Row{
		row(func(r *Row) { r.GradeValue = nil; r.GradeStatus = s("EXEMPT") }),
	}, OfficialInput{PassingGrade: 10, Policy: ""})
	if exempt.PassedUnits != 0 || exempt.TotalUnits != 0 {
		t.Fatalf("EXEMPT بدون نمره: %+v", exempt)
	}
}

func TestOfficialGpaRetakePolicies(t *testing.T) {
	// A later pass removes the earlier failure (EXCLUDE_IF_PASSED)
	rows := []Row{
		row(func(r *Row) { r.Code = "C1"; r.GradeValue = 8; r.CourseID = i64(1) }),
		row(func(r *Row) { r.Code = "C1"; r.GradeValue = 15; r.CourseID = i64(1) }),
	}
	core := AggregateOfficialGpaRows(rows, OfficialInput{PassingGrade: 10, Policy: "EXCLUDE_IF_PASSED"})
	if core.ExcludedCount != 1 || core.GPA != 15 || core.TotalUnits != 3 {
		t.Fatalf("EXCLUDE_IF_PASSED: %+v", core)
	}

	// Note 1391: retake pass floor is 14; a pass of 12 does not remove the failed row
	lowPass := AggregateOfficialGpaRows([]Row{
		row(func(r *Row) { r.Code = "C1"; r.GradeValue = 8 }),
		row(func(r *Row) { r.Code = "C1"; r.GradeValue = 12 }),
	}, OfficialInput{PassingGrade: 10, RetakeMinGrade: 14, Policy: "EXCLUDE_IF_PASSED_1391"})
	if lowPass.ExcludedCount != 0 {
		t.Fatalf("۱۳۹۱ با قبولی ۱۲ نباید حذف کند: %+v", lowPass)
	}
	highPass := AggregateOfficialGpaRows([]Row{
		row(func(r *Row) { r.Code = "C1"; r.GradeValue = 8 }),
		row(func(r *Row) { r.Code = "C1"; r.GradeValue = 15 }),
	}, OfficialInput{PassingGrade: 10, RetakeMinGrade: 14, Policy: "EXCLUDE_IF_PASSED_1391"})
	if highPass.ExcludedCount != 1 || highPass.GPA != 15 {
		t.Fatalf("۱۳۹۱ با قبولی ۱۵: %+v", highPass)
	}
}

func TestOfficialGpaDedupe(t *testing.T) {
	core := AggregateOfficialGpaRows([]Row{
		row(func(r *Row) { r.Code = "C1"; r.GradeValue = 10; r.Units = 3 }),
		row(func(r *Row) { r.Code = "C1"; r.GradeValue = 18; r.Units = 3 }),
	}, OfficialInput{PassingGrade: 10, Policy: "", DedupeRepeated: true})
	if core.GPA != 18 || core.TotalUnits != 3 || core.ExcludedCount != 1 {
		t.Fatalf("dedupe: %+v", core)
	}
}

func TestAuditTranscript(t *testing.T) {
	core := AggregateAuditTranscript([]Row{
		row(func(r *Row) { r.GradeValue = 18; r.Units = 3; r.CourseID = i64(1) }),
		row(func(r *Row) { r.GradeValue = 8; r.Units = 2; r.CourseID = i64(2) }),
		row(func(r *Row) { r.GradeValue = nil; r.Units = 4; r.GradeStatus = s("EXEMPT"); r.CourseID = i64(3) }),
		row(func(r *Row) { r.GradeValue = 16; r.Units = 3; r.SamaGradeStatusCode = s("12"); r.CourseID = i64(4) }),
	}, 10)
	// Passes: rows 1, 3 (EXEMPT), 4 (code 12) → 3+4+3 = 10
	if core.PassedUnits != 10 {
		t.Fatalf("passedUnits=%v want 10", core.PassedUnits)
	}
	// Only the mark from row 1 counts toward the GPA
	if core.GPA == nil || *core.GPA != 18 {
		t.Fatalf("gpa=%v", core.GPA)
	}
	if !core.PassedIDs[1] || core.PassedIDs[2] || !core.PassedIDs[3] {
		t.Fatalf("passedIds: %v", core.PassedIDs)
	}
}

// Parity of the two engines for simple rows (no exclude/dedupe policy) — the same
// rowCountsTowardGpa rule, so the GPA must be identical. (Documented difference: the audit engine
// does not count failed rows toward the GPA at all, so this test only
// compares passing rows.)
func TestEngineParity(t *testing.T) {
	rows := []Row{
		row(func(r *Row) { r.Code = "C1"; r.GradeValue = 17.5; r.Units = 3 }),
		row(func(r *Row) { r.Code = "C2"; r.GradeValue = 12; r.Units = 2; r.CourseID = i64(2) }),
	}
	official := AggregateOfficialGpaRows(rows, OfficialInput{PassingGrade: 10, Policy: ""})
	audit := AggregateAuditTranscript(rows, 10)
	if audit.GPA == nil || *audit.GPA != official.GPA {
		t.Fatalf("پارتی موتورها: official=%v audit=%v", official.GPA, audit.GPA)
	}
}
