// ═══ Sama detailed tariff — port of tuition-tariff-core + computeTariffCourseLinesForTerms ═══
package tuition

import (
	"context"
	"math"
	"strconv"
	"strings"
)

// TariffRate is the theory/practical rate of a "financial course type".
type TariffRate struct {
	TH float64 `json:"th"`
	OP float64 `json:"op"`
}

// TariffLine is a course's detailed tuition based on the yearly tariff.
type TariffLine struct {
	CourseCode     string  `json:"courseCode"`
	CourseTitle    string  `json:"courseTitle"`
	Units          float64 `json:"units"`
	TheoryUnits    float64 `json:"theoryUnits"`
	PracticalUnits float64 `json:"practicalUnits"`
	MaliType       *int    `json:"maliType"`
	PerUnit        float64 `json:"perUnit"`
	Amount         float64 `json:"amount"`
}

// jsRound is equivalent to JavaScript's Math.round (half rounds toward +∞).
func jsRound(v float64) float64 { return math.Floor(v + 0.5) }

// TariffCourseAmount is a course's amount: theory×Th + practical×OP.
func TariffCourseAmount(theoryUnits, practicalUnits float64, rate *TariffRate) float64 {
	if rate == nil {
		return 0
	}
	return jsRound(theoryUnits*rate.TH + practicalUnits*rate.OP)
}

// TariffAmountOrZero follows the official document's behavior: an un-rated course is zero (not the default rate).
func TariffAmountOrZero(theoryUnits, practicalUnits float64, rate *TariffRate) float64 {
	if rate == nil {
		return 0
	}
	return TariffCourseAmount(theoryUnits, practicalUnits, rate)
}

// PickTariffRate picks the exact rate; its absence means zero (same behavior as Sama).
func PickTariffRate(rates map[int]TariffRate, maliType *int) *TariffRate {
	if len(rates) == 0 || maliType == nil {
		return nil
	}
	t := *maliType
	if t <= 0 {
		return nil
	}
	if r, ok := rates[t]; ok {
		copied := r
		return &copied
	}
	return nil
}

func termYearOf(termYear *int, termCode string) int {
	if termYear != nil && *termYear > 0 {
		return *termYear
	}
	code := strings.TrimSpace(termCode)
	if len(code) >= 4 {
		if y, err := strconv.Atoi(code[:4]); err == nil && y > 0 {
			return y
		}
	}
	return 0
}

// ComputeTariffCourseLinesForTerms gives the detailed variable tuition of courses based on the detailed tariff.
// A term whose year's tariff is missing is absent from the result (missing key) so the caller
// falls back to the unified engine — exactly like buildTranscriptCourses.
func (e *Engine) ComputeTariffCourseLinesForTerms(ctx context.Context, studentID int64, termIDs []int64) map[int64][]TariffLine {
	out := map[int64][]TariffLine{}
	ids := uniquePositive(termIDs)
	if len(ids) == 0 {
		return out
	}

	var majorID, universityID *int64
	var entryYear *int
	if err := e.Pool.QueryRow(ctx, `
		select "majorId", "entryYear", "universityId" from students where id = $1`, studentID).
		Scan(&majorID, &entryYear, &universityID); err != nil {
		return out
	}
	if majorID == nil || entryYear == nil || universityID == nil {
		return out
	}

	type termRow struct {
		ID   int64
		Code string
	}
	codeByID := map[int64]string{}
	trows, err := e.Pool.Query(ctx, `select id, coalesce("termCode",'') from academic_terms where id = any($1)`, ids)
	if err != nil {
		return out
	}
	for trows.Next() {
		var t termRow
		if err := trows.Scan(&t.ID, &t.Code); err == nil {
			if strings.TrimSpace(t.Code) != "" {
				codeByID[t.ID] = t.Code
			}
		}
	}
	trows.Close()
	if len(codeByID) == 0 {
		return out
	}

	// Rates: the matching key is the "tariff year" (the Sama rate is annual, not per semester).
	byYear := map[int]map[int]TariffRate{}
	rrows, err := e.Pool.Query(ctx, `
		select "termYear", "termCode", "maliType", "thPrice"::float8, "opPrice"::float8
		  from tuition_term_tariff
		 where "universityId" = $1 and "majorId" = $2 and "entryYear" = $3`,
		*universityID, *majorID, *entryYear)
	if err != nil {
		return out
	}
	for rrows.Next() {
		var termYear *int
		var termCode string
		var maliType int
		var th, op float64
		if err := rrows.Scan(&termYear, &termCode, &maliType, &th, &op); err != nil {
			continue
		}
		year := termYearOf(termYear, termCode)
		if year <= 0 {
			continue
		}
		m := byYear[year]
		if m == nil {
			m = map[int]TariffRate{}
			byYear[year] = m
		}
		m[maliType] = TariffRate{TH: th, OP: op}
	}
	rrows.Close()
	if len(byYear) == 0 {
		return out
	}

	// Semesters whose year's tariff exists are "covered", even with no courses.
	for termID, code := range codeByID {
		year, _ := strconv.Atoi(code[:minInt(4, len(code))])
		if _, ok := byYear[year]; ok {
			out[termID] = []TariffLine{}
		}
	}

	erows, err := e.Pool.Query(ctx, `
		select o."termId", c.code, c.title, c.units::float8,
		       coalesce(c."theoreticalUnits",0)::float8, coalesce(c."practicalUnits",0)::float8,
		       c."legacyMaliType"
		  from enrollments en
		  join course_offerings o on o.id = en."offeringId"
		  join courses c on c.id = o."courseId"
		 where en."studentId" = $1 and o."termId" = any($2) and en."sourceUniversityId" is null`,
		studentID, ids)
	if err != nil {
		return out
	}
	defer erows.Close()
	for erows.Next() {
		var termID int64
		var code, title string
		var units, theory, practical float64
		var maliType *int
		if err := erows.Scan(&termID, &code, &title, &units, &theory, &practical, &maliType); err != nil {
			continue
		}
		termCode, ok := codeByID[termID]
		if !ok {
			continue
		}
		yearCode := termCode
		if len(yearCode) > 4 {
			yearCode = yearCode[:4]
		}
		year, _ := strconv.Atoi(yearCode)
		rates, ok := byYear[year]
		if !ok {
			continue
		}
		rate := PickTariffRate(rates, maliType)
		amount := TariffAmountOrZero(theory, practical, rate)
		perUnit := 0.0
		if units > 0 {
			perUnit = jsRound(amount / units)
		}
		out[termID] = append(out[termID], TariffLine{
			CourseCode: code, CourseTitle: title, Units: units,
			TheoryUnits: theory, PracticalUnits: practical, MaliType: maliType,
			PerUnit: perUnit, Amount: amount,
		})
	}
	return out
}

func uniquePositive(ids []int64) []int64 {
	seen := map[int64]bool{}
	out := []int64{}
	for _, id := range ids {
		if id > 0 && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
