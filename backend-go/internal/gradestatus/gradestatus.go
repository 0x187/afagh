// ═══ Sama grade status codes — port of grade-status-codes.ts ═══
//
// Official reference table; the only definition of "this row does not contribute its mark to the GPA" is
// in rowCountsTowardGpa so that the "official GPA" and the "graduation-gate GPA" do not diverge.
package gradestatus

import "strings"

// Code is one row of the grade status code reference table.
type Code struct {
	Code           string
	Title          string
	Passed         bool
	AffectsGpa     bool
	AffectsTermGpa bool
	IsDropped      bool
}

// Codes is the reference table (source order preserved).
var Codes = []Code{
	{"-91", "حذف آيين نامه 91 (کارداني _ کارشناسي)", false, false, false, false},
	{"-6", "تقلبهاي مشكوك", false, false, false, false},
	{"-5", "انصراف", false, false, false, true},
	{"-4", "حذف توسط استاد راهنما در حذف و اضافه", false, false, false, true},
	{"-3", "حذف توسط استاد راهنما در انتخاب واحد", false, false, false, true},
	{"-1", "حذف در حذف و اضافه", false, false, false, true},
	{"0", "نامشخص", false, false, false, false},
	{"1", "درس عادي - قبول", true, true, true, false},
	{"2", "درس عادي - مردود", false, true, true, false},
	{"3", "در معادل سازي پذيرفته شده با احتساب در معدل کل", true, true, true, false},
	{"4", "در معادل سازي پذيرفته نشده", false, false, false, false},
	{"5", "غيبت در جلسه امتحان", false, false, false, false},
	{"6", "حذف اضطراري", false, false, false, true},
	{"7", "حذف توسط شوراي آموزشي", false, false, false, true},
	{"8", "حذف توسط ستاد دانشجويان شاهد و ايثارگر", false, false, false, true},
	{"9", "حذف توسط کميسيون موارد خاص", false, false, false, true},
	{"10", "نمره گزارش نشده", false, false, false, false},
	{"11", "جبراني- بااحتساب درمعدل", true, true, true, false},
	{"12", "جبراني بدون احتساب در معدل-قبول", true, false, false, false},
	{"13", "ناتمام", false, false, false, false},
	{"14", "حذف پزشکي", false, false, false, true},
	{"15", "حذف‌ترم بااحتساب", false, false, false, true},
	{"16", "در معادل سازي پذيرفته شده بدون احتساب معدل", true, false, false, false},
	{"17", "درمعادل‌سازي‌پذيرفته‌شده‌جزواحدبدون‌احتسابمعدل", true, false, false, false},
	{"18", "پايان نامه 941-قبول", true, false, false, false},
	{"19", "درحال تحقيق", false, false, false, false},
	{"20", "بدون تاثير در معدل ترم و معدل کل", false, false, false, false},
	{"22", "جبراني بدون احتساب در معدل - مردود", false, false, false, false},
	{"23", "پيش نياز-قبول موثر در نيمسال", true, false, true, false},
	{"24", "پيش نياز -مردود موثر در نيمسال", false, false, true, false},
	{"27", "رساله دکتري", true, true, true, false},
	{"28", "بدون احتساب در معدل", false, false, false, false},
	{"29", "دروس‌کمبودبدون‌احتساب‌درمعدل", false, false, false, false},
	{"32", "جبراني-معادلسازي", true, false, false, false},
	{"40", "معرفي به استاد", true, true, true, false},
	{"44", "دروس پيش‌دانشگاهي/جبراني بدون احتساب", true, false, false, false},
	{"46", "دروس پيش‌دانشگاهي/جبراني بدون احتساب - مردود", false, false, false, false},
	{"50", "خودخوان - قبول", true, true, true, false},
	{"51", "خودخوان - مردود", false, true, true, false},
	{"52", "تخلف در امتحان", false, false, false, false},
	{"53", "دروس‌خودخوان _قبول(جبراني‌بدون‌احتساب‌درمعدل)", true, false, false, false},
	{"54", "فوت", true, true, true, false},
	{"55", "حذف توسط كميته انضباطي", false, false, false, true},
	{"200", "حذف آيين نامه اي ماده 23", false, false, false, true},
	{"201", "حذف بدليل مرودي درترم هاي قبل", false, false, false, true},
	{"300", "غيبت غير موجه بيش از حددر کلاس", false, false, false, false},
	{"400", "حذف آموزشي", false, false, false, true},
	{"931", "حذف آيين نامه 93 (کارداني _ کارشناسي)", false, false, true, false},
	{"941", "حذف آيين نامه 94 (کارشناسي ارشد)", false, false, true, false},
	{"951", "حذف آيين نامه 95 (دکترا)", false, false, true, false},
}

var byCode = func() map[string]Code {
	m := make(map[string]Code, len(Codes))
	for _, c := range Codes {
		m[c.Code] = c
	}
	return m
}()

// NonGpaCodes are codes with no effect on the overall GPA.
var NonGpaCodes = func() map[string]bool {
	m := map[string]bool{}
	for _, c := range Codes {
		if !c.AffectsGpa {
			m[c.Code] = true
		}
	}
	return m
}()

// NonGpaPassCodes are passing codes whose mark has no effect on the GPA.
var NonGpaPassCodes = func() map[string]bool {
	m := map[string]bool{}
	for _, c := range Codes {
		if c.Passed && !c.AffectsGpa {
			m[c.Code] = true
		}
	}
	return m
}()

// NonTermGpaCodes are codes with no effect on the semester GPA.
var NonTermGpaCodes = func() map[string]bool {
	m := map[string]bool{}
	for _, c := range Codes {
		if !c.AffectsTermGpa {
			m[c.Code] = true
		}
	}
	return m
}()

// DroppedCodes are codes of dropped courses.
var DroppedCodes = func() map[string]bool {
	m := map[string]bool{}
	for _, c := range Codes {
		if c.IsDropped {
			m[c.Code] = true
		}
	}
	return m
}()

// OptionLabel is "code — title" for the dropdown.
func OptionLabel(c Code) string { return c.Code + " — " + c.Title }

// TitleOf returns the title for a code (nil if unknown).
func TitleOf(code string) *string {
	c, ok := byCode[strings.TrimSpace(code)]
	if !ok {
		return nil
	}
	t := c.Title
	return &t
}

// IsPassed reports whether the code is a pass.
func IsPassed(code string) bool {
	c, ok := byCode[strings.TrimSpace(code)]
	return ok && c.Passed
}

// IsDropped reports whether the code is a course drop.
func IsDropped(code string) bool { return DroppedCodes[strings.TrimSpace(code)] }

// IsNonGpaPass reports whether it is a pass not counted in the GPA.
func IsNonGpaPass(code string) bool { return NonGpaPassCodes[strings.TrimSpace(code)] }

// RowCountsTowardGpa is the reference rule for a mark counting toward the GPA — three AND conditions:
//  1. the Sama code is not in NON_GPA_CODES
//  2. the courses.affectsGpa switch is not zero
//  3. the course is not descriptive
func RowCountsTowardGpa(samaCode string, courseAffectsGpa *int, gradingType string) bool {
	if gradingType == "DESCRIPTIVE" {
		return false
	}
	if courseAffectsGpa != nil && *courseAffectsGpa == 0 {
		return false
	}
	code := strings.TrimSpace(samaCode)
	if code != "" && NonGpaCodes[code] {
		return false
	}
	return true
}

// ResolveRetakeBar is the retake pass threshold — only EXCLUDE_IF_PASSED_1391.
func ResolveRetakeBar(policy string, retakeMinGrade *float64, passingGrade float64) *float64 {
	if policy != "EXCLUDE_IF_PASSED_1391" {
		return nil
	}
	if retakeMinGrade != nil && *retakeMinGrade > 0 {
		return retakeMinGrade
	}
	if passingGrade > 0 {
		v := passingGrade
		return &v
	}
	return nil
}

// RegulationFrozenCodes are codes that regulation logic must never override.
var RegulationFrozenCodes = func() map[string]bool {
	list := []string{
		"3", "4", "5", "6", "7", "8", "9", "10", "13", "14", "15", "16", "17", "18", "19", "20",
		"22", "28", "29", "32", "36", "40", "44", "46", "50", "51", "52", "53", "55",
		"200", "201", "300", "400", "-1", "-3", "-4", "-5", "0",
	}
	m := make(map[string]bool, len(list))
	for _, c := range list {
		m[c] = true
	}
	return m
}()
