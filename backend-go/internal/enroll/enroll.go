// ═══ Course enrollment engine (phase 3) — port of src/lib/enroll-engine and the enroll page ═══
//
// The validation pipeline is exactly the five filters from document §1008:
//
//	1) Financial + student status
//	2) Atomic capacity (Redis with DB fallback) + duplicate course
//	3) Unit cap per regulations
//	4) Prerequisite/corequisite (soft error)
//	5) Class conflict (soft) and exam conflict (HARD/SOFT)
package enroll

import (
	"strings"
	"time"
)

// MaxUnits default cap when the regulations engine is unavailable.
const MaxUnits = 20

// EquivSemesterUnits every 20 equivalent units = one semester deducted from study years.
const EquivSemesterUnits = 20

// Targeting offering targeting (level/major/entry range).
type Targeting struct {
	TargetDegreeLevelID *int64
	TargetMajorID       *int64
	EntryYearStart      *int
	EntryYearEnd        *int
}

// StudentScope student scope for targeting matching.
type StudentScope struct {
	DegreeLevelID *int64
	MajorID       *int64
	EntryYear     int
}

// OfferingVisible port of offeringVisible: NULL means "no restriction".
func OfferingVisible(o Targeting, s StudentScope) bool {
	if o.TargetDegreeLevelID != nil && (s.DegreeLevelID == nil || *o.TargetDegreeLevelID != *s.DegreeLevelID) {
		return false
	}
	if o.TargetMajorID != nil && (s.MajorID == nil || *o.TargetMajorID != *s.MajorID) {
		return false
	}
	if o.EntryYearStart != nil && s.EntryYear < *o.EntryYearStart {
		return false
	}
	if o.EntryYearEnd != nil && s.EntryYear > *o.EntryYearEnd {
		return false
	}
	return true
}

// clock5 port of slice(0,5) on the time.
func clock5(v string) string {
	if len(v) >= 5 {
		return v[:5]
	}
	return v
}

// timeOverlap port of timeOverlap (string comparison of HH:MM).
func timeOverlap(s1, e1, s2, e2 string) bool {
	return clock5(s1) < clock5(e2) && clock5(s2) < clock5(e1)
}

// ParseTermTypeOf port of termTypeOf — the 00EQ prefix takes precedence over the termType column.
func TermTypeOf(termCode string, termType *string, isSummer bool) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(termCode)), "00eq") {
		return "EQUIVALENCE"
	}
	if termType != nil {
		switch *termType {
		case "EQUIVALENCE", "SUMMER", "NORMAL":
			return *termType
		}
	}
	if isSummer {
		return "SUMMER"
	}
	return "NORMAL"
}

func nowUnixMilli() int64 { return time.Now().UnixMilli() }
