// ═══ Single tuition-rules resolver — port of tuition-resolver.ts ═══
//
// Specificity hierarchy: degree level > major > faculty > term type > course type >
// clinical phase > entry range > entry semester > current semester.
// Tie-break: smaller priority, then newer entryYearFrom, then smaller id.
package tuition

import (
	"math"
	"sort"
	"strconv"
	"strings"
)

// ToNum is a port of toNum.
func ToNum(v any) float64 {
	switch x := v.(type) {
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return 0
		}
		return x
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case string:
		n, err := strconv.ParseFloat(x, 64)
		if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
			return 0
		}
		return n
	}
	return 0
}

// RuleLike is the minimal shape of a tuition-rule row.
type RuleLike struct {
	ID               int64
	DegreeLevelID    *int64
	MajorID          *int64
	FacultyID        *int64
	TermType         *string
	OfferingType     *string
	ClinicalPhase    *string
	EntryYearFrom    *int
	EntryYearTo      *int
	EntryTermID      *int64
	CurrentTermID    *int64
	FixedAmount      any
	PerUnitTheory    any
	PerUnitPractical any
	PerUnitGeneral   any
	MinSummerUnits   any
	PercentUnderMin  any
	Priority         *int
	IsActive         *int
	UniversityID     *int64
}

// Context is the student/term context for matching.
type Context struct {
	DegreeLevelID *int64
	MajorID       *int64
	FacultyID     *int64
	EntryYear     *int
	TermType      *string
	OfferingType  *string
	ClinicalPhase *string
	EntryTermID   *int64
	CurrentTermID *int64
	UniversityID  *int64
	TermLevelOnly bool
}

func eqPtr[T comparable](a *T, b *T) bool {
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

// Matches is a port of tuitionRuleMatches — empty field = no constraint.
func Matches(r RuleLike, ctx Context) bool {
	if r.IsActive != nil && *r.IsActive != 1 {
		return false
	}
	if r.UniversityID != nil && ctx.UniversityID != nil && *r.UniversityID != *ctx.UniversityID {
		return false
	}
	if r.DegreeLevelID != nil && !eqPtr(r.DegreeLevelID, ctx.DegreeLevelID) {
		return false
	}
	if r.MajorID != nil && !eqPtr(r.MajorID, ctx.MajorID) {
		return false
	}
	if r.FacultyID != nil && !eqPtr(r.FacultyID, ctx.FacultyID) {
		return false
	}
	if r.TermType != nil && ctx.TermType != nil && *r.TermType != *ctx.TermType {
		return false
	}
	if r.OfferingType != nil && ctx.OfferingType != nil && *r.OfferingType != *ctx.OfferingType {
		return false
	}
	if r.ClinicalPhase != nil && ctx.ClinicalPhase != nil && *r.ClinicalPhase != *ctx.ClinicalPhase {
		return false
	}
	if ctx.TermLevelOnly && r.OfferingType != nil {
		return false
	}
	y := ctx.EntryYear
	if r.EntryYearFrom != nil {
		if y == nil || *y < *r.EntryYearFrom {
			return false
		}
	}
	if r.EntryYearTo != nil {
		if y == nil || *y > *r.EntryYearTo {
			return false
		}
	}
	if r.EntryTermID != nil && !eqPtr(r.EntryTermID, ctx.EntryTermID) {
		return false
	}
	if r.CurrentTermID != nil && !eqPtr(r.CurrentTermID, ctx.CurrentTermID) {
		return false
	}
	return true
}

func yearSpecificity(r RuleLike) int {
	if r.EntryYearFrom != nil && r.EntryYearTo != nil {
		return 2
	}
	if r.EntryYearFrom != nil || r.EntryYearTo != nil {
		return 1
	}
	return 0
}

func termSpecificity(r RuleLike) int {
	if r.EntryTermID != nil && r.CurrentTermID != nil {
		return 2
	}
	if r.EntryTermID != nil || r.CurrentTermID != nil {
		return 1
	}
	return 0
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// Compare is a port of compareTuitionRules: negative = a is ahead (wins).
func Compare(a, b RuleLike) int {
	dims := []int{
		boolToInt(a.DegreeLevelID != nil) - boolToInt(b.DegreeLevelID != nil),
		boolToInt(a.MajorID != nil) - boolToInt(b.MajorID != nil),
		boolToInt(a.FacultyID != nil) - boolToInt(b.FacultyID != nil),
		boolToInt(a.TermType != nil) - boolToInt(b.TermType != nil),
		boolToInt(a.OfferingType != nil) - boolToInt(b.OfferingType != nil),
		boolToInt(a.ClinicalPhase != nil) - boolToInt(b.ClinicalPhase != nil),
		yearSpecificity(a) - yearSpecificity(b),
		termSpecificity(a) - termSpecificity(b),
	}
	for _, d := range dims {
		if d != 0 {
			return -d
		}
	}
	pa, pb := 100.0, 100.0
	if a.Priority != nil {
		pa = ToNum(*a.Priority)
	}
	if b.Priority != nil {
		pb = ToNum(*b.Priority)
	}
	if pa != pb {
		return int(pa - pb)
	}
	ya, yb := 0.0, 0.0
	if a.EntryYearFrom != nil {
		ya = ToNum(*a.EntryYearFrom)
	}
	if b.EntryYearFrom != nil {
		yb = ToNum(*b.EntryYearFrom)
	}
	if ya != yb {
		return int(yb - ya)
	}
	return int(a.ID - b.ID)
}

// Resolve is a port of resolveTuitionRule — the winning rule or nil.
func Resolve(rows []RuleLike, ctx Context) *RuleLike {
	var best *RuleLike
	for i := range rows {
		r := rows[i]
		if !Matches(r, ctx) {
			continue
		}
		if best == nil || Compare(r, *best) < 0 {
			cp := r
			best = &cp
		}
	}
	return best
}

// Rates is the per-unit rates from one rule.
type Rates struct {
	Fixed           float64
	Theory          float64
	Practical       float64
	General         float64
	MinSummerUnits  *float64
	PercentUnderMin *float64
}

// RatesOf is a port of ratesOf.
func RatesOf(r RuleLike) Rates {
	out := Rates{
		Fixed: ToNum(r.FixedAmount), Theory: ToNum(r.PerUnitTheory),
		Practical: ToNum(r.PerUnitPractical), General: ToNum(r.PerUnitGeneral),
	}
	if r.MinSummerUnits != nil {
		v := ToNum(r.MinSummerUnits)
		out.MinSummerUnits = &v
	}
	if r.PercentUnderMin != nil {
		v := ToNum(r.PercentUnderMin)
		out.PercentUnderMin = &v
	}
	return out
}

// ─────────────────────────── rules: term type and rule selection ───────────────────────────

// TermType enumerates the term types.
type TermType string

const (
	Normal      TermType = "NORMAL"
	Summer      TermType = "SUMMER"
	Equivalence TermType = "EQUIVALENCE"
)

// TermInput is the termTypeOf input.
type TermInput struct {
	TermType *string
	TermCode *string
	IsSummer *int
}

// TermTypeOf is a port of termTypeOf: first the 00EQ prefix, then the termType column, then isSummer.
func TermTypeOf(t TermInput) TermType {
	if t.TermCode != nil {
		code := ""
		for _, r := range *t.TermCode {
			code += string(r)
		}
		if len(code) >= 4 && (code[:4] == "00EQ" || code[:4] == "00eq" || code[:4] == "00Eq" || code[:4] == "00eQ") {
			return Equivalence
		}
	}
	if t.TermType != nil {
		switch *t.TermType {
		case "EQUIVALENCE", "SUMMER", "NORMAL":
			return TermType(*t.TermType)
		}
	}
	if t.IsSummer != nil && *t.IsSummer != 0 {
		return Summer
	}
	return Normal
}

// FeeRuleLike is the legacy row shape (fixedTuition/perUnitTuition).
type FeeRuleLike struct {
	ID                int64
	DegreeLevelID     *int64
	MajorID           *int64
	TermType          *string
	OfferingType      *string
	FixedTuition      any
	PerUnitTuition    any
	EffectiveFromYear *int
	Priority          *int
}

// FeeRuleParams are the selection parameters.
type FeeRuleParams struct {
	DegreeLevelID *int64
	TermType      *string
	OfferingType  *string
	EntryYear     *int
	MajorID       *int64
	TermLevelOnly bool
	UniversityID  *int64
}

// ResolvedRule is the selected rule.
type ResolvedRule struct {
	ID             int64
	FixedTuition   float64
	PerUnitTuition float64
	DegreeLevelID  *int64
	TermType       *string
	OfferingType   *string
}

// PickFeeRule is a port of pickFeeRule — mapped to the unified resolver.
func PickFeeRule(rows []FeeRuleLike, params FeeRuleParams) *ResolvedRule {
	canonical := make([]RuleLike, 0, len(rows))
	for _, r := range rows {
		canonical = append(canonical, RuleLike{
			ID: r.ID, DegreeLevelID: r.DegreeLevelID, MajorID: r.MajorID,
			TermType: r.TermType, OfferingType: r.OfferingType,
			EntryYearFrom: r.EffectiveFromYear, EntryYearTo: nil,
			FixedAmount: r.FixedTuition, PerUnitTheory: r.PerUnitTuition,
			PerUnitPractical: r.PerUnitTuition, PerUnitGeneral: r.PerUnitTuition,
			Priority: r.Priority,
		})
	}
	best := Resolve(canonical, Context{
		DegreeLevelID: params.DegreeLevelID, MajorID: params.MajorID,
		EntryYear: params.EntryYear, TermType: params.TermType,
		OfferingType: params.OfferingType, TermLevelOnly: params.TermLevelOnly,
		UniversityID: params.UniversityID,
	})
	if best == nil {
		return nil
	}
	return &ResolvedRule{
		ID: best.ID, FixedTuition: ToNum(best.FixedAmount), PerUnitTuition: ToNum(best.PerUnitTheory),
		DegreeLevelID: best.DegreeLevelID, TermType: best.TermType, OfferingType: best.OfferingType,
	}
}

// ─────────────────────────── Legacy rules bridge ───────────────────────────

// LegacyFeeRuleLike is one legacy financial rule row.
type LegacyFeeRuleLike struct {
	DegreeLevelID  *int64
	TermType       TermType
	TermCode       *string
	FixedTuition   any
	PerUnitTuition any
	TermSortKey    int64
}

// FeeRuleDraft is a new rule draft.
type FeeRuleDraft struct {
	DegreeLevelID     *int64
	TermType          TermType
	OfferingType      *string
	FixedTuition      float64
	PerUnitTuition    float64
	EffectiveFromYear *int
	Note              string
}

// MapLegacyFeeRules is a port of mapLegacyFeeRules: grouping by (degree level, term type),
// newest term wins, no-op rules removed, final sorting.
func MapLegacyFeeRules(rows []LegacyFeeRuleLike) []FeeRuleDraft {
	type key struct {
		degree int64
		hasDeg bool
		term   TermType
	}
	groups := map[key]LegacyFeeRuleLike{}
	order := []key{}
	for _, r := range rows {
		var k key
		if r.DegreeLevelID != nil {
			k.degree = *r.DegreeLevelID
			k.hasDeg = true
		}
		k.term = r.TermType
		prev, ok := groups[k]
		if !ok {
			order = append(order, k)
		}
		if !ok || r.TermSortKey > prev.TermSortKey {
			groups[k] = r
		}
	}
	drafts := []FeeRuleDraft{}
	for _, k := range order {
		r := groups[k]
		fixed := math.Round(ToNum(r.FixedTuition))
		perUnit := math.Round(ToNum(r.PerUnitTuition))
		if fixed <= 0 && perUnit <= 0 {
			continue
		}
		note := "درون‌ریزی از قواعد مالی قدیمی"
		if r.TermCode != nil && *r.TermCode != "" {
			note = "درون‌ریزی از قواعد مالی قدیمی — نرخ ترم " + *r.TermCode
		}
		drafts = append(drafts, FeeRuleDraft{
			DegreeLevelID: r.DegreeLevelID, TermType: r.TermType, OfferingType: nil,
			FixedTuition: fixed, PerUnitTuition: perUnit, EffectiveFromYear: nil, Note: note,
		})
	}
	sort.SliceStable(drafts, func(i, j int) bool {
		a, b := drafts[i], drafts[j]
		da, db := 0.0, 0.0
		if a.DegreeLevelID != nil {
			da = float64(*a.DegreeLevelID)
		}
		if b.DegreeLevelID != nil {
			db = float64(*b.DegreeLevelID)
		}
		if da != db {
			return da < db
		}
		return a.TermType < b.TermType
	})
	return drafts
}

// ─────────────────────────── Equivalency fixed-tuition policy ───────────────────────────

// EquivFixedMode is the equivalency fixed-tuition mode.
type EquivFixedMode string

const (
	EquivOnce    EquivFixedMode = "ONCE"
	EquivPerTerm EquivFixedMode = "PER_TERM"
	EquivNone    EquivFixedMode = "NONE"
)

// NormalizeEquivFixedMode maps any unknown value → ONCE.
// (same as String(value).trim().toUpperCase() in TS)
func NormalizeEquivFixedMode(value any) EquivFixedMode {
	s, _ := value.(string)
	switch strings.ToUpper(strings.TrimSpace(s)) {
	case "PER_TERM":
		return EquivPerTerm
	case "NONE":
		return EquivNone
	}
	return EquivOnce
}

// ShouldChargeFixed reports whether this semester's fixed tuition should be charged.
func ShouldChargeFixed(mode EquivFixedMode, isFirstTerm bool) bool {
	switch mode {
	case EquivNone:
		return false
	case EquivPerTerm:
		return true
	}
	return isFirstTerm
}
