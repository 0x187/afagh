// ═══ موتور انتخاب واحد (فاز ۳) — پورت src/lib/enroll-engine و صفحهٔ enroll ═══
//
// خط لولهٔ اعتبارسنجی عیناً همان پنج فیلتر سند §۱۰۰۸ است:
//
//	۱) مالی + وضعیت دانشجو
//	۲) ظرفیت اتمیک (Redis با fallback دیتابیس) + تکرار درس
//	۳) سقف واحد بر اساس آیین‌نامه
//	۴) پیش‌نیاز/هم‌نیاز (خطای نرم)
//	۵) تداخل کلاس (نرم) و امتحان (HARD/SOFT)
package enroll

import (
	"strings"
	"time"
)

// MaxUnits سقف پیش‌فرض وقتی موتور آیین‌نامه در دسترس نیست.
const MaxUnits = 20

// EquivSemesterUnits هر ۲۰ واحد معادل‌سازی = یک ترم کسر از سنوات.
const EquivSemesterUnits = 20

// Targeting هدف‌گیری ارائه (مقطع/رشته/بازهٔ ورود).
type Targeting struct {
	TargetDegreeLevelID *int64
	TargetMajorID       *int64
	EntryYearStart      *int
	EntryYearEnd        *int
}

// StudentScope دامنهٔ دانشجو برای تطبیق هدف‌گیری.
type StudentScope struct {
	DegreeLevelID *int64
	MajorID       *int64
	EntryYear     int
}

// OfferingVisible پورت offeringVisible: NULL یعنی «بدون محدودیت».
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

// clock5 پورت slice(0,5) روی ساعت.
func clock5(v string) string {
	if len(v) >= 5 {
		return v[:5]
	}
	return v
}

// timeOverlap پورت timeOverlap (مقایسهٔ رشته‌ای HH:MM).
func timeOverlap(s1, e1, s2, e2 string) bool {
	return clock5(s1) < clock5(e2) && clock5(s2) < clock5(e1)
}

// ParseTermTypeOf پورت termTypeOf — پیشوند 00EQ مقدم بر ستون termType.
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
