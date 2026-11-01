// ═══ Allocation formula and quota distribution — port of formulas.ts ═══
package finance

import (
	"math"
	"sort"

	"backend-go/internal/tuition"
)

// FormulaLike allocation formula.
type FormulaLike struct {
	ID               int64
	Code             *string
	Title            *string
	DegreeLevelID    *int64
	MajorID          *int64
	EntryYearFrom    *int
	EntryYearTo      *int
	FixedAmount      any
	PerUnitTheory    any
	PerUnitPractical any
	PerUnitGeneral   any
	Priority         any
	IsActive         *int
}

// FormulaContext student context.
type FormulaContext struct {
	DegreeLevelID *int64
	MajorID       *int64
	EntryYear     *int
}

// FormulaMatches port of formulaMatches — empty field = no restriction.
func FormulaMatches(f FormulaLike, ctx FormulaContext) bool {
	if f.IsActive == nil || *f.IsActive == 0 {
		return false
	}
	if f.DegreeLevelID != nil && !eqI64(f.DegreeLevelID, ctx.DegreeLevelID) {
		return false
	}
	if f.MajorID != nil && !eqI64(f.MajorID, ctx.MajorID) {
		return false
	}
	if f.EntryYearFrom != nil {
		if ctx.EntryYear == nil || *ctx.EntryYear < *f.EntryYearFrom {
			return false
		}
	}
	if f.EntryYearTo != nil {
		if ctx.EntryYear == nil || *ctx.EntryYear > *f.EntryYearTo {
			return false
		}
	}
	return true
}

func eqI64(a, b *int64) bool {
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

// PickFormula port of pickFormula — select via the tuition resolver and return the original row.
func PickFormula(formulas []FormulaLike, ctx FormulaContext) *FormulaLike {
	canonical := make([]tuition.RuleLike, 0, len(formulas))
	for _, f := range formulas {
		priority := 100
		if p, ok := f.Priority.(int); ok {
			priority = p
		} else if f.Priority != nil {
			priority = int(ToNum(f.Priority))
		}
		canonical = append(canonical, tuition.RuleLike{
			ID: f.ID, DegreeLevelID: f.DegreeLevelID, MajorID: f.MajorID,
			EntryYearFrom: f.EntryYearFrom, EntryYearTo: f.EntryYearTo,
			FixedAmount: f.FixedAmount, PerUnitTheory: f.PerUnitTheory,
			PerUnitPractical: f.PerUnitPractical, PerUnitGeneral: f.PerUnitGeneral,
			Priority: &priority, IsActive: f.IsActive,
		})
	}
	best := tuition.Resolve(canonical, tuition.Context{
		DegreeLevelID: ctx.DegreeLevelID, MajorID: ctx.MajorID, EntryYear: ctx.EntryYear,
	})
	if best == nil {
		return nil
	}
	for i := range formulas {
		if formulas[i].ID == best.ID {
			cp := formulas[i]
			return &cp
		}
	}
	return nil
}

// UnitBuckets unit buckets.
type UnitBuckets struct {
	Theory    float64
	Practical float64
	General   float64
}

// NormalizeBankType port of normalizeBankType: strip Arabic letters/spaces/ZWNJ + uppercase.
func NormalizeBankType(t string) string {
	rep := map[rune]rune{'ي': 'ی', 'ك': 'ک', 'ة': 'ه'}
	out := []rune{}
	for _, r := range t {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\u200c' || r == '\u200d' {
			continue
		}
		if mapped, ok := rep[r]; ok {
			r = mapped
		}
		if r >= 'a' && r <= 'z' {
			r = r - 'a' + 'A'
		}
		out = append(out, r)
	}
	return string(out)
}

// BucketCourseUnits port of bucketCourseUnits.
func BucketCourseUnits(units, theoreticalUnits, practicalUnits any, courseType *string) UnitBuckets {
	u := ToNum(units)
	typ := ""
	if courseType != nil {
		typ = NormalizeBankType(*courseType)
	}
	isGeneral := typ == "GENERAL" || typ == "عمومی" || typ == "OMOMI"
	if isGeneral {
		return UnitBuckets{Theory: 0, Practical: 0, General: u}
	}
	practical := math.Min(u, mathMax0(ToNum(practicalUnits)))
	theory := math.Min(u-practical, mathMax0(ToNum(theoreticalUnits)))
	leftover := mathMax0(u - practical - theory)
	return UnitBuckets{Theory: theory + leftover, Practical: practical, General: 0}
}

// TotalBuckets sum of buckets across several courses.
func TotalBuckets(courses []UnitBuckets) UnitBuckets {
	var t UnitBuckets
	for _, c := range courses {
		t.Theory += ToNum(c.Theory)
		t.Practical += ToNum(c.Practical)
		t.General += ToNum(c.General)
	}
	return t
}

// AllocateWeightedShares port of allocateWeightedShares: distribute the total amount proportionally
// by weight with «باقی‌ماندهٔ بزرگ‌تر» so no rial is lost or added.
func AllocateWeightedShares(weights []float64, target float64) []float64 {
	n := len(weights)
	if n == 0 {
		return nil
	}
	total := math.Max(0, math.Round(ToNum(target)))
	clean := make([]float64, n)
	for i, w := range weights {
		v := ToNum(w)
		if v > 0 {
			clean[i] = v
		}
	}
	if total == 0 {
		return make([]float64, n)
	}
	sum := 0.0
	for _, w := range clean {
		sum += w
	}
	// zero weights → equal split (remainder in row order)
	if sum <= 0 {
		base := math.Floor(total / float64(n))
		out := make([]float64, n)
		for i := range out {
			out[i] = base
		}
		rem := int(total - base*float64(n))
		for i := 0; i < rem; i++ {
			out[i]++
		}
		return out
	}

	raw := make([]float64, n)
	for i, w := range clean {
		raw[i] = (w / sum) * total
	}
	out := make([]float64, n)
	for i, x := range raw {
		out[i] = math.Floor(x)
	}
	used := 0.0
	for _, v := range out {
		used += v
	}
	remainder := int(total - used)
	order := make([]int, n)
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool {
		fa := raw[order[a]] - math.Floor(raw[order[a]])
		fb := raw[order[b]] - math.Floor(raw[order[b]])
		if fa != fb {
			return fa > fb
		}
		return order[a] < order[b]
	})
	for _, idx := range order {
		if remainder <= 0 {
			break
		}
		out[idx]++
		remainder--
	}
	// theoretical remainder (floating-point error) — in row order
	for i := 0; remainder > 0; i = (i + 1) % n {
		out[i]++
		remainder--
	}
	return out
}

// FormulaRates formula rate fields.
type FormulaRates struct {
	FixedAmount      any
	PerUnitTheory    any
	PerUnitPractical any
	PerUnitGeneral   any
}

// TuitionFromFormula port of tuitionFromFormula.
type TuitionBreakdown struct {
	Fixed    float64
	Variable float64
	Total    float64
}

// TuitionFromFormula computes gross tuition from the formula and unit buckets.
func TuitionFromFormula(f FormulaRates, buckets UnitBuckets) TuitionBreakdown {
	fixed := ToRial(ToNum(f.FixedAmount))
	variable := ToRial(
		ToNum(buckets.Theory)*ToNum(f.PerUnitTheory) +
			ToNum(buckets.Practical)*ToNum(f.PerUnitPractical) +
			ToNum(buckets.General)*ToNum(f.PerUnitGeneral))
	return TuitionBreakdown{Fixed: fixed, Variable: variable, Total: fixed + variable}
}
