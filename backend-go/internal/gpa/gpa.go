// ═══ Pure GPA core — port of gpa-aggregation.ts ═══
//
// a single source of truth for both engines: "official GPA" (regulations) and the
// "graduation-gate GPA". Sums are performed on scaled integers:
//
//	weighted = Σ (grade×100) × (units×10)
//	units    = Σ (units×10)
//
// the "whether the row's grade counts toward the GPA" rule comes from gradestatus.RowCountsTowardGpa.
package gpa

import (
	"math"
	"strconv"
	"strings"

	"backend-go/internal/gradestatus"
)

const (
	gradeScale = 100 // grade: two decimal places
	unitScale  = 10  // units: one decimal place
)

// ParseGrade port of parseGrade: empty/non-numeric → nil (meaning "no grade recorded").
func ParseGrade(value any) *float64 {
	if value == nil {
		return nil
	}
	var raw string
	switch v := value.(type) {
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return nil
		}
		return &v
	case float32:
		f := float64(v)
		return &f
	case int:
		f := float64(v)
		return &f
	case int64:
		f := float64(v)
		return &f
	case string:
		raw = strings.TrimSpace(v)
		if raw == "" {
			return nil
		}
	default:
		raw = strings.TrimSpace(toString(v))
		if raw == "" {
			return nil
		}
	}
	n, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return nil
	}
	return &n
}

func toString(v any) string {
	switch x := v.(type) {
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	default:
		return ""
	}
}

// ParseUnits port of parseUnits: invalid/negative → 0.
func ParseUnits(value any) float64 {
	n := ParseGrade(value)
	if n == nil || *n < 0 {
		return 0
	}
	return *n
}

// Round2 port of round2 — round half up to two decimal places.
func Round2(value float64) float64 {
	return math.Round((value+2.220446049250313e-16)*100) / 100
}

// Accumulator GPA accumulator with integer arithmetic.
type Accumulator struct {
	weighted    float64
	unitsScaled float64
}

// Add adds one effective row.
func (a *Accumulator) Add(grade, units float64) {
	g := math.Round(grade * gradeScale)
	u := math.Round(units * unitScale)
	if u <= 0 {
		return
	}
	a.weighted += g * u
	a.unitsScaled += u
}

// HasUnits whether any units have been aggregated.
func (a *Accumulator) HasUnits() bool { return a.unitsScaled > 0 }

// Units aggregated units (unscaled).
func (a *Accumulator) Units() float64 { return a.unitsScaled / unitScale }

// Exact exact GPA (unrounded) — for regulation comparisons.
func (a *Accumulator) Exact() *float64 {
	if a.unitsScaled <= 0 {
		return nil
	}
	v := a.weighted / (a.unitsScaled * gradeScale)
	return &v
}

// Rounded GPA rounded to two decimal places (display/storage).
func (a *Accumulator) Rounded() *float64 {
	if a.unitsScaled <= 0 {
		return nil
	}
	v := math.Round((a.weighted*100)/(a.unitsScaled*gradeScale)) / 100
	return &v
}

// Row transcript row for aggregation (structural and permissive).
type Row struct {
	CourseID            *int64
	Code                string
	Units               any
	GradeValue          any
	GradeStatus         *string
	SamaGradeStatusCode *string
	GradingType         *string
	AffectsGpa          *int
	CourseMinMark       any
}

func thresholdFactory(passingGrade float64) func(Row) float64 {
	return func(r Row) float64 {
		m := ParseGrade(r.CourseMinMark)
		if m != nil && *m >= 0 && *m <= 20 {
			return *m
		}
		return passingGrade
	}
}

func isPassedRow(r Row, grade *float64, bar float64) bool {
	if r.GradeStatus != nil && (*r.GradeStatus == "EXEMPT" || *r.GradeStatus == "PASSED_NO_GRADE") {
		return true
	}
	if r.SamaGradeStatusCode != nil && gradestatus.IsPassed(*r.SamaGradeStatusCode) {
		return true
	}
	if r.GradingType != nil && *r.GradingType == "DESCRIPTIVE" {
		return grade != nil && *grade == 1
	}
	return grade != nil && *grade >= bar
}

func codeOf(r Row) string { return r.Code }

// OfficialInput official GPA input.
type OfficialInput struct {
	PassingGrade   float64
	RetakeMinGrade float64
	Policy         string
	DedupeRepeated bool
}

// OfficialCore official GPA output.
type OfficialCore struct {
	GPA           float64
	TotalUnits    float64
	PassedUnits   float64
	ExcludedCount int
}

// AggregateOfficialGpaRows port of aggregateOfficialGpaRows.
func AggregateOfficialGpaRows(rows []Row, input OfficialInput) OfficialCore {
	thresholdOf := thresholdFactory(input.PassingGrade)
	is1391 := input.Policy == "EXCLUDE_IF_PASSED_1391"

	passedCourses := map[string]bool{}
	for _, r := range rows {
		g := ParseGrade(r.GradeValue)
		bar := thresholdOf(r)
		if is1391 {
			bar = input.RetakeMinGrade
		}
		if isPassedRow(r, g, bar) && r.Code != "" {
			passedCourses[codeOf(r)] = true
		}
	}

	bestByCode := map[string]int{}
	if input.DedupeRepeated {
		bestGrade := map[string]float64{}
		for i, r := range rows {
			g := ParseGrade(r.GradeValue)
			if g == nil {
				continue
			}
			cur, ok := bestGrade[r.Code]
			if !ok || *g > cur {
				bestGrade[r.Code] = *g
				bestByCode[r.Code] = i
			}
		}
	}

	acc := &Accumulator{}
	passedUnits := 0.0
	excludedCount := 0

	for i, r := range rows {
		g := ParseGrade(r.GradeValue)
		if g == nil {
			continue
		}
		u := ParseUnits(r.Units)
		passed := false
		if r.GradingType != nil && *r.GradingType == "DESCRIPTIVE" {
			passed = *g == 1
		} else {
			passed = *g >= thresholdOf(r)
		}

		if input.DedupeRepeated {
			if idx, ok := bestByCode[r.Code]; ok && idx != i {
				excludedCount++
				continue
			}
		}
		if passed {
			passedUnits = Round2(passedUnits + u)
		}
		var samaCode string
		if r.SamaGradeStatusCode != nil {
			samaCode = *r.SamaGradeStatusCode
		}
		if !gradestatus.RowCountsTowardGpa(samaCode, r.AffectsGpa, strOrEmpty(r.GradingType)) {
			continue
		}
		if (input.Policy == "EXCLUDE_IF_PASSED" || is1391) && !passed && passedCourses[r.Code] && r.Code != "" {
			excludedCount++
			continue
		}
		acc.Add(*g, u)
	}
	gpaVal := 0.0
	if v := acc.Rounded(); v != nil {
		gpaVal = *v
	}
	return OfficialCore{GPA: gpaVal, TotalUnits: acc.Units(), PassedUnits: passedUnits, ExcludedCount: excludedCount}
}

func strOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// AuditCore graduation-gate GPA output.
type AuditCore struct {
	PassedUnits float64
	GPA         *float64
	PassedIDs   map[int64]bool
}

// AggregateAuditTranscript port of aggregateAuditTranscript: policy for dropping failed courses and
// No dedupe; does not include the failed row's mark in the GPA.
func AggregateAuditTranscript(rows []Row, passing float64) AuditCore {
	thresholdOf := thresholdFactory(passing)
	passedIDs := map[int64]bool{}
	passedUnits := 0.0
	acc := &Accumulator{}
	for _, t := range rows {
		g := ParseGrade(t.GradeValue)
		u := ParseUnits(t.Units)
		isSpecialPass := t.GradeStatus != nil && (*t.GradeStatus == "EXEMPT" || *t.GradeStatus == "PASSED_NO_GRADE")
		if t.SamaGradeStatusCode != nil && gradestatus.IsPassed(*t.SamaGradeStatusCode) {
			isSpecialPass = true
		}
		ok := isSpecialPass || (g != nil && *g >= thresholdOf(t))
		if !ok {
			continue
		}
		if t.CourseID != nil {
			passedIDs[*t.CourseID] = true
		}
		passedUnits = Round2(passedUnits + u)
		var samaCode string
		if t.SamaGradeStatusCode != nil {
			samaCode = *t.SamaGradeStatusCode
		}
		if g != nil && gradestatus.RowCountsTowardGpa(samaCode, t.AffectsGpa, strOrEmpty(t.GradingType)) {
			acc.Add(*g, u)
		}
	}
	return AuditCore{PassedUnits: passedUnits, GPA: acc.Rounded(), PassedIDs: passedIDs}
}
