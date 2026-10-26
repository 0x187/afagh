// ═══ هستهٔ خالص موتور برنامه‌ریزی — پورت scheduling-core.ts ═══
//
// مسئولیت‌ها: نرمال‌سازی کد ترم، اعتبارسنجی گروه درسی، هم‌پوشانی زمانی،
// امتیازدهی پیشنهاد، پیش‌بینی تقاضا، ماشین فازها، سلامت برنامه، قیود سخت
// و مولد تاریخ جلسات. هیچ DB در این پکیج نیست.
package scheduling

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// ─────────────────────────── ثابت‌ها ───────────────────────────

const (
	MaxGroups            = 20
	MinCapacity          = 5
	MaxCapacity          = 500
	DaysPerWeek          = 7
	MinutesGrid          = 30
	EquivalenceGroupYear = 0
)

// Shift مرز شیفت‌ها (دقیقه از نیمه‌شب).
const (
	MorningEnd   = 12 * 60
	EveningStart = 13*60 + 30
)

// Genders / Shifts / Scopes / LocationTypes / Phases — مجموعه‌های مجاز.
var Genders = []string{"MALE", "FEMALE", "MIXED"}
var Shifts = []string{"MORNING", "EVENING"}
var OfferingScopes = []string{"DEPARTMENTAL", "GENERAL_SERVICE"}
var LocationTypes = []string{"IN_CAMPUS", "OUT_CAMPUS"}
var SchedulingPhases = []string{"SUPPLY", "ALLOCATION", "REVIEW", "PUBLISHED"}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// ─────────────────────────── کد ترم ───────────────────────────

// NormalizedTerm پورت NormalizedTerm.
type NormalizedTerm struct {
	OriginalCode    string
	NormalizedCode  string
	AcademicYear    int
	Semester        int
	TermType        string // NORMAL | SUMMER | EQUIVALENCE
	SortKey         int
	DisplayYear     string
	DisplaySemester string
}

// TermTypeFromDigit رقم آخر کد ترم → نوع.
func TermTypeFromDigit(d int) string {
	switch d {
	case 1, 2:
		return "NORMAL"
	case 3:
		return "SUMMER"
	}
	return "EQUIVALENCE"
}

func allDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// NormalizeTermCode پورت normalizeTermCode — کد ۵ رقمی کاننیکال؛
// مسیرهای قدیمی ۳/۴ رقمی هم برای سازگاری پشتیبانی می‌شوند.
func NormalizeTermCode(raw string) *NormalizedTerm {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil
	}
	normalized := ""
	switch {
	case len(s) == 5 && allDigits(s):
		normalized = s
	case len(s) == 3 && allDigits(s):
		if !strings.HasPrefix(s, "8") && !strings.HasPrefix(s, "9") {
			return nil
		}
		normalized = "13" + s
	case len(s) == 4 && strings.HasPrefix(s, "14") && allDigits(s):
		x, _ := strconv.Atoi(s[2:3])
		normalized = strconv.Itoa(1400+x) + s[3:4]
	default:
		digits := digitsOnly(s)
		switch {
		case len(digits) >= 5:
			normalized = digits[:5]
		case len(digits) == 3 && (strings.HasPrefix(digits, "8") || strings.HasPrefix(digits, "9")):
			normalized = "13" + digits
		case len(digits) == 4 && strings.HasPrefix(digits, "14"):
			x, _ := strconv.Atoi(digits[2:3])
			normalized = strconv.Itoa(1400+x) + digits[3:4]
		default:
			return nil
		}
	}

	academicYear, _ := strconv.Atoi(normalized[:4])
	semester, _ := strconv.Atoi(normalized[4:5])
	if academicYear < 1300 || academicYear > 1420 {
		return nil
	}
	termType := TermTypeFromDigit(semester)

	sortKey := 0
	if termType == "EQUIVALENCE" {
		sortKey, _ = strconv.Atoi(normalized)
	} else {
		sortKey = 100000 + academicYear*10 + semester
	}

	displayYear := fmt.Sprintf("%d-%d", academicYear, academicYear+1)
	var displaySemester string
	switch {
	case termType == "EQUIVALENCE":
		displaySemester = "معادل‌سازی"
	case termType == "SUMMER":
		displaySemester = "نیمسال تابستان"
	case semester == 1:
		displaySemester = "نیمسال اول"
	case semester == 2:
		displaySemester = "نیمسال دوم"
	default:
		displaySemester = "نامشخص"
	}

	return &NormalizedTerm{
		OriginalCode: s, NormalizedCode: normalized,
		AcademicYear: academicYear, Semester: semester,
		TermType: termType, SortKey: sortKey,
		DisplayYear: displayYear, DisplaySemester: displaySemester,
	}
}

// TermWithCode برای مرتب‌سازی/گروه‌بندی.
type TermWithCode struct {
	TermCode string
	Rows     any
}

// SortTermsForTranscript پورت sortTermsForTranscript.
func SortTermsForTranscript(terms []TermWithCode) []TermWithCode {
	out := make([]TermWithCode, len(terms))
	copy(out, terms)
	sort.SliceStable(out, func(i, j int) bool {
		a := NormalizeTermCode(out[i].TermCode)
		b := NormalizeTermCode(out[j].TermCode)
		if a == nil || b == nil {
			return false
		}
		if a.SortKey != b.SortKey {
			return a.SortKey < b.SortKey
		}
		return out[i].TermCode < out[j].TermCode
	})
	return out
}

// TermWithNormalized برای خروجی گروه‌بندی.
type TermWithNormalized struct {
	TermCode   string
	Rows       any
	Normalized *NormalizedTerm
}

// AcademicYearGroup گروه سال تحصیلی در کارنامه.
type AcademicYearGroup struct {
	AcademicYear int
	DisplayYear  string
	Terms        []TermWithNormalized
}

// GroupTermsByAcademicYear پورت groupTermsByAcademicYear: معادل‌سازی‌ها یک
// بلوک جدا در ابتدا، سپس سال‌ها نزولی.
func GroupTermsByAcademicYear(terms []TermWithCode) []AcademicYearGroup {
	sorted := SortTermsForTranscript(terms)
	byYear := map[int][]TermWithNormalized{}
	equiv := []TermWithNormalized{}
	for _, t := range sorted {
		norm := NormalizeTermCode(t.TermCode)
		if norm == nil {
			continue
		}
		item := TermWithNormalized{TermCode: t.TermCode, Rows: t.Rows, Normalized: norm}
		if norm.TermType == "EQUIVALENCE" {
			equiv = append(equiv, item)
			continue
		}
		byYear[norm.AcademicYear] = append(byYear[norm.AcademicYear], item)
	}
	years := make([]int, 0, len(byYear))
	for y := range byYear {
		years = append(years, y)
	}
	sort.Slice(years, func(i, j int) bool { return years[i] > years[j] })
	groups := make([]AcademicYearGroup, 0, len(years)+1)
	for _, y := range years {
		groups = append(groups, AcademicYearGroup{
			AcademicYear: y,
			DisplayYear:  fmt.Sprintf("%d-%d", y, y+1),
			Terms:        byYear[y],
		})
	}
	if len(equiv) > 0 {
		groups = append([]AcademicYearGroup{{
			AcademicYear: EquivalenceGroupYear,
			DisplayYear:  "سوابق و معادل‌سازی",
			Terms:        equiv,
		}}, groups...)
	}
	return groups
}

// ─────────────────────────── ابزار زمان ───────────────────────────

var errTimeFormat = errors.New("قالب ساعت نامعتبر است.")

// ToMinutes پورت toMinutes (با خطا).
func ToMinutes(hhmm string) (int, error) {
	s := strings.TrimSpace(hhmm)
	parts := strings.SplitN(s, ":", 2)
	if len(parts) != 2 || len(parts[0]) == 0 || len(parts[0]) > 2 || len(parts[1]) != 2 {
		return 0, errTimeFormat
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h > 23 || m > 59 {
		return 0, errTimeFormat
	}
	return h*60 + m, nil
}

// ToMinutesOrNil نسخهٔ بدون خطا (برای داده‌های نامعتبر → nil).
func ToMinutesOrNil(v string) *int {
	m, err := ToMinutes(v)
	if err != nil {
		return nil
	}
	return &m
}

// ShiftOf پورت shiftOf.
func ShiftOf(startMinutes, endMinutes int) (string, error) {
	if endMinutes <= MorningEnd {
		return "MORNING", nil
	}
	if startMinutes >= EveningStart {
		return "EVENING", nil
	}
	return "", errors.New("بازهٔ زمانی نباید از مرز شیفت‌ها عبور کند (صبح تا ۱۲:۰۰ — عصر از ۱۳:۳۰).")
}

// Overlaps هم‌پوشانی دو بازه: aStart < bEnd && bStart < aEnd.
func Overlaps(aStart, aEnd, bStart, bEnd int) bool {
	return aStart < bEnd && bStart < aEnd
}

// ─────────────────────────── اعتبارسنجی گروه ───────────────────────────

// GroupDraftInput ورودی گروه درسی.
type GroupDraftInput struct {
	GroupNumber int
	Capacity    int
	Gender      string
	ProfessorID int64
	ClassroomID int64
	DayOfWeek   int
	StartTime   string
	EndTime     string
}

// ValidatedGroupDraft گروه نرمال‌شده.
type ValidatedGroupDraft struct {
	GroupDraftInput
	StartMinutes int
	EndMinutes   int
	Shift        string
}

// ValidateGroupDrafts پورت validateGroupDrafts — همان پیام‌های فارسی، خروجی مرتب.
func ValidateGroupDrafts(inputs []GroupDraftInput, ownerIsServicePool bool) ([]ValidatedGroupDraft, error) {
	if len(inputs) == 0 {
		return nil, errors.New("هیچ گروه درسی برای برنامه‌ریزی ارسال نشده است.")
	}
	if len(inputs) > MaxGroups {
		return nil, fmt.Errorf("تعداد گروه‌های درسی از سقف %d بیشتر است.", MaxGroups)
	}
	out := make([]ValidatedGroupDraft, 0, len(inputs))
	seen := map[int]bool{}
	for _, raw := range inputs {
		g := raw.GroupNumber
		if g < 1 || g > MaxGroups {
			return nil, errors.New("شمارهٔ گروه نامعتبر است.")
		}
		if seen[g] {
			return nil, fmt.Errorf("شمارهٔ گروه %d تکراری است.", g)
		}
		seen[g] = true

		cap := raw.Capacity
		if cap < MinCapacity || cap > MaxCapacity {
			return nil, fmt.Errorf("ظرفیت گروه %d نامعتبر است (%d..%d).", g, MinCapacity, MaxCapacity)
		}
		if !contains(Genders, raw.Gender) {
			return nil, fmt.Errorf("جنسیت گروه %d نامعتبر است.", g)
		}
		if raw.ProfessorID <= 0 {
			return nil, fmt.Errorf("استاد گروه %d نامعتبر است.", g)
		}
		if raw.ClassroomID <= 0 {
			return nil, fmt.Errorf("کلاس فیزیکی گروه %d نامعتبر است.", g)
		}
		if raw.DayOfWeek < 0 || raw.DayOfWeek >= DaysPerWeek {
			return nil, fmt.Errorf("روز گروه %d نامعتبر است.", g)
		}
		start, err := ToMinutes(raw.StartTime)
		if err != nil {
			return nil, err
		}
		end, err := ToMinutes(raw.EndTime)
		if err != nil {
			return nil, err
		}
		if start >= end {
			return nil, fmt.Errorf("بازهٔ زمانی گروه %d نامعتبر است (پایان قبل از شروع).", g)
		}
		if end-start > 4*60 {
			return nil, fmt.Errorf("مدت جلسهٔ گروه %d نباید از ۴ ساعت بیشتر شود.", g)
		}
		shift, err := ShiftOf(start, end)
		if err != nil {
			return nil, fmt.Errorf("گروه %d: %s", g, err.Error())
		}
		if ownerIsServicePool && shift != "MORNING" && shift != "EVENING" {
			return nil, fmt.Errorf("گروه %d: شیفت نامعتبر.", g)
		}
		out = append(out, ValidatedGroupDraft{
			GroupDraftInput: raw, StartMinutes: start, EndMinutes: end, Shift: shift,
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].GroupNumber < out[j].GroupNumber })
	return out, nil
}

// ─────────────────────────── امتیازدهی ───────────────────────────

// امتیازهای SCORE.
const (
	ScoreSameFaculty     = 40
	ScoreCrossFaculty    = 10
	ScorePreferredTime   = 50
	ScoreOKTime          = 20
	ScoreCapacityPerfect = 30
	ScoreCapacityGood    = 10
	ScoreCapacityOver    = -60
	ScoreGapAllowed      = 40
)

// SlotScoreInput ورودی امتیازدهی.
type SlotScoreInput struct {
	RoomFacultyID     *int64
	TargetFacultyID   *int64
	InPreferredWindow bool
	InAvailableWindow bool
	RoomCapacity      int
	RequiredCapacity  int
}

// SlotScore خروجی امتیازدهی.
type SlotScore struct {
	Score   int
	Reasons []string
}

// CalculateSlotScore پورت calculateSlotScore.
func CalculateSlotScore(p SlotScoreInput) SlotScore {
	reasons := []string{}
	score := 0
	if p.RoomCapacity < p.RequiredCapacity {
		return SlotScore{Score: ScoreCapacityOver, Reasons: []string{
			fmt.Sprintf("ظرفیت کلاس (%d) کمتر از نیاز (%d) است.", p.RoomCapacity, p.RequiredCapacity),
		}}
	}
	if !p.InAvailableWindow {
		return SlotScore{Score: -100, Reasons: []string{"خارج از ساعات حضور استاد است."}}
	}
	if p.TargetFacultyID != nil && p.RoomFacultyID != nil && *p.RoomFacultyID == *p.TargetFacultyID {
		score += ScoreSameFaculty
		reasons = append(reasons, "داخل دانشکدهٔ هدف (بدون جابجایی)")
	} else {
		score += ScoreCrossFaculty
		if p.TargetFacultyID != nil {
			reasons = append(reasons, "فاصلهٔ بین‌دانشکده‌ای")
		} else {
			reasons = append(reasons, "دانشکدهٔ هدف مشخص نشده")
		}
	}
	if p.InPreferredWindow {
		score += ScorePreferredTime
		reasons = append(reasons, "زمان ترجیحی استاد")
	} else {
		score += ScoreOKTime
		reasons = append(reasons, "زمان مقدور (داخل ساعات حضور)")
	}
	diff := p.RoomCapacity - p.RequiredCapacity
	if diff >= 0 && diff <= 15 {
		score += ScoreCapacityPerfect
		reasons = append(reasons, "تناسب عالی ظرفیت")
	} else if diff <= 40 {
		score += ScoreCapacityGood
		reasons = append(reasons, "تناسب قابل قبول ظرفیت")
	}
	return SlotScore{Score: score, Reasons: reasons}
}

// SuggestedGroupCount پورت suggestedGroupCount.
func SuggestedGroupCount(eligibleStudents int, standardCapacity float64) (int, error) {
	if eligibleStudents < 0 {
		return 0, errors.New("تعداد متقاضی نامعتبر است.")
	}
	if math.IsNaN(standardCapacity) || math.IsInf(standardCapacity, 0) || standardCapacity <= 0 {
		return 0, errors.New("ظرفیت استاندارد نامعتبر است.")
	}
	if eligibleStudents == 0 {
		return 1, nil
	}
	n := int(math.Ceil(float64(eligibleStudents) / standardCapacity))
	if n < 1 {
		n = 1
	}
	if n > MaxGroups {
		n = MaxGroups
	}
	return n, nil
}

// FacultyDemand تقاضای هر دانشکده.
type FacultyDemand struct {
	FacultyID *int64
	Eligible  int
}

// FacultyGroups توزیع گروه.
type FacultyGroups struct {
	FacultyID *int64
	Eligible  int
	Groups    int
}

// DistributeGroupsByFaculty پورت distributeGroupsByFaculty.
func DistributeGroupsByFaculty(perFaculty []FacultyDemand, standardCapacity float64) []FacultyGroups {
	out := make([]FacultyGroups, 0, len(perFaculty))
	for _, f := range perFaculty {
		g, err := SuggestedGroupCount(f.Eligible, standardCapacity)
		if err != nil {
			g = 1
		}
		out = append(out, FacultyGroups{FacultyID: f.FacultyID, Eligible: f.Eligible, Groups: g})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Eligible > out[j].Eligible })
	return out
}

// ─────────────────────────── سهمیهٔ سالن ───────────────────────────

// RoomGrantInput سالن با شیفت‌هایش.
type RoomGrantInput struct {
	ClassroomID int64
	Capacity    int
	Shifts      []string
}

// DeptShareInput سهمیهٔ دانشکده.
type DeptShareInput struct {
	DepartmentID   int64
	ActiveStudents int
}

// RoomGrant خروجی تخصیص.
type RoomGrant struct {
	DepartmentID int64
	ClassroomID  int64
	Capacity     int
	Shift        string
}

// AllocateQuotaShifts پورت allocateQuotaShifts.
func AllocateQuotaShifts(rooms []RoomGrantInput, depts []DeptShareInput) []RoomGrant {
	totalStudents := 0
	for _, d := range depts {
		totalStudents += d.ActiveStudents
	}
	if totalStudents <= 0 || len(rooms) == 0 {
		return nil
	}
	slots := 0
	for _, r := range rooms {
		slots += len(r.Shifts)
	}
	sortedRooms := make([]RoomGrantInput, len(rooms))
	copy(sortedRooms, rooms)
	sort.SliceStable(sortedRooms, func(i, j int) bool { return sortedRooms[i].Capacity > sortedRooms[j].Capacity })
	type slot struct {
		classroomID int64
		capacity    int
		shift       string
	}
	pool := make([]slot, 0, slots)
	for _, r := range sortedRooms {
		for _, sh := range r.Shifts {
			pool = append(pool, slot{r.ClassroomID, r.Capacity, sh})
		}
	}
	type share struct {
		departmentID int64
		active       int
		quota        int
	}
	shares := make([]share, 0, len(depts))
	for _, d := range depts {
		q := int(math.Round(float64(d.ActiveStudents) / float64(totalStudents) * float64(slots)))
		if q < 1 {
			q = 1
		}
		shares = append(shares, share{d.DepartmentID, d.ActiveStudents, q})
	}
	sort.SliceStable(shares, func(i, j int) bool { return shares[i].active > shares[j].active })

	grants := []RoomGrant{}
	cursor := 0
	for _, d := range shares {
		for i := 0; i < d.quota && cursor < len(pool); i++ {
			s := pool[cursor]
			cursor++
			grants = append(grants, RoomGrant{d.departmentID, s.classroomID, s.capacity, s.shift})
		}
	}
	return grants
}

// ─────────────────────────── ماشین فازها ───────────────────────────

var phaseOrder = map[string]int{"SUPPLY": 0, "ALLOCATION": 1, "REVIEW": 2, "PUBLISHED": 3}

// CanTransition آیا گذار فاز مجاز است؟
func CanTransition(from, to string) bool {
	f, ok1 := phaseOrder[from]
	t, ok2 := phaseOrder[to]
	return ok1 && ok2 && t == f+1
}

// CanEditInPhase ویرایش در هر فاز جز PUBLISHED.
func CanEditInPhase(phase string) bool {
	return phase == "SUPPLY" || phase == "ALLOCATION" || phase == "REVIEW"
}

// CanAllocateInPhase تخصیص فقط در ALLOCATION/REVIEW.
func CanAllocateInPhase(phase string) bool {
	return phase == "ALLOCATION" || phase == "REVIEW"
}

// ─────────────────────────── سلامت برنامه ───────────────────────────

const (
	UnderfilledThreshold = 0.5
	FullThreshold        = 0.9
)

// ClassifyUtilization پورت classifyUtilization.
func ClassifyUtilization(enrolled, capacity int) string {
	if capacity <= 0 {
		return "OVERBOOKED"
	}
	ratio := float64(enrolled) / float64(capacity)
	if ratio > 1 {
		return "OVERBOOKED"
	}
	if ratio >= FullThreshold {
		return "FULL"
	}
	if ratio <= UnderfilledThreshold {
		return "UNDERFILLED"
	}
	return "NORMAL"
}

// ShiftUtilization پورت shiftUtilization.
func ShiftUtilization(usedMinutes, shiftMinutes int) float64 {
	if shiftMinutes <= 0 {
		return 0
	}
	v := float64(usedMinutes) / float64(shiftMinutes)
	if v > 1 {
		return 1
	}
	return v
}
