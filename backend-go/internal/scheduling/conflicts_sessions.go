// ═══ قیود سخت برنامه + مولد تاریخ جلسات — ادامهٔ پورت scheduling-core.ts ═══
package scheduling

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"backend-go/internal/jalali"
)

// ─────────────────────────── قیود سخت V1 ───────────────────────────

// ScheduleConflictInput یک ردیف برنامهٔ هفتگی برای قیود سخت.
type ScheduleConflictInput struct {
	OfferingID       int64
	GroupNumber      *int
	DayOfWeek        *int
	StartTime        string
	EndTime          string
	RoomID           *int64
	RequiredCapacity int
	ProfessorIDs     []*int64
	OfferingTitle    string
}

// RoomCapacityInfo ظرفیت و عنوان سالن.
type RoomCapacityInfo struct {
	ID       int64
	Capacity int
	Title    string
}

// ScheduleConflict قید سخت نقض‌شده.
type ScheduleConflict struct {
	Type        string // ROOM_OVERLAP | PROFESSOR_OVERLAP | ROOM_CAPACITY
	Severity    string // همیشه ERROR
	Message     string
	OfferingIDs []int64
}

// DetectScheduleConflictsV1 پورت detectScheduleConflicts (نسخهٔ اول).
func DetectScheduleConflictsV1(entries []ScheduleConflictInput, rooms []RoomCapacityInfo) []ScheduleConflict {
	conflicts := []ScheduleConflict{}
	byRoom := map[int64][]ScheduleConflictInput{}
	byProf := map[int64][]ScheduleConflictInput{}

	for _, e := range entries {
		if e.RoomID != nil {
			byRoom[*e.RoomID] = append(byRoom[*e.RoomID], e)
		}
		for _, pid := range e.ProfessorIDs {
			if pid == nil {
				continue
			}
			byProf[*pid] = append(byProf[*pid], e)
		}
	}

	sameDayOverlap := func(a, b ScheduleConflictInput) bool {
		if a.DayOfWeek == nil || b.DayOfWeek == nil || *a.DayOfWeek != *b.DayOfWeek {
			return false
		}
		aS, e1 := ToMinutes(a.StartTime)
		aE, e2 := ToMinutes(a.EndTime)
		bS, e3 := ToMinutes(b.StartTime)
		bE, e4 := ToMinutes(b.EndTime)
		if e1 != nil || e2 != nil || e3 != nil || e4 != nil {
			return false
		}
		return Overlaps(aS, aE, bS, bE)
	}
	uniqueIDs := func(ids ...int64) []int64 {
		seen := map[int64]bool{}
		out := []int64{}
		for _, id := range ids {
			if !seen[id] {
				seen[id] = true
				out = append(out, id)
			}
		}
		return out
	}

	for roomID, list := range byRoom {
		for i := 0; i < len(list); i++ {
			for j := i + 1; j < len(list); j++ {
				if sameDayOverlap(list[i], list[j]) {
					conflicts = append(conflicts, ScheduleConflict{
						Type: "ROOM_OVERLAP", Severity: "ERROR",
						Message:     fmt.Sprintf("سالن %d: «%s» و «%s» هم‌زمان‌اند.", roomID, list[i].OfferingTitle, list[j].OfferingTitle),
						OfferingIDs: uniqueIDs(list[i].OfferingID, list[j].OfferingID),
					})
				}
			}
		}
	}
	for profID, list := range byProf {
		for i := 0; i < len(list); i++ {
			for j := i + 1; j < len(list); j++ {
				if sameDayOverlap(list[i], list[j]) {
					conflicts = append(conflicts, ScheduleConflict{
						Type: "PROFESSOR_OVERLAP", Severity: "ERROR",
						Message:     fmt.Sprintf("استاد %d: تداخل بین «%s» و «%s».", profID, list[i].OfferingTitle, list[j].OfferingTitle),
						OfferingIDs: uniqueIDs(list[i].OfferingID, list[j].OfferingID),
					})
				}
			}
		}
	}
	roomCap := map[int64]RoomCapacityInfo{}
	for _, r := range rooms {
		roomCap[r.ID] = r
	}
	for _, e := range entries {
		if e.RoomID == nil {
			continue
		}
		room, ok := roomCap[*e.RoomID]
		if ok && e.RequiredCapacity > room.Capacity {
			conflicts = append(conflicts, ScheduleConflict{
				Type: "ROOM_CAPACITY", Severity: "ERROR",
				Message:     fmt.Sprintf("سالن «%s» (ظرفیت %d) برای «%s» (%d نفر) کوچک است.", room.Title, room.Capacity, e.OfferingTitle, e.RequiredCapacity),
				OfferingIDs: []int64{e.OfferingID},
			})
		}
	}
	return conflicts
}

// HasHardConflicts آیا قید سختی نقض شده است؟
func HasHardConflicts(conflicts []ScheduleConflict) bool { return len(conflicts) > 0 }

// ─────────────────────────── تاریخ جلسات V1 ───────────────────────────

// SessionDate جلسهٔ تولیدشده.
type SessionDate struct {
	SessionNo int
	Date      time.Time // UTC
}

// SessionDatesFor پورت sessionDatesFor (ALL/EVEN/ODD، ۱۶ جلسهٔ پیش‌فرض).
func SessionDatesFor(termStart time.Time, dayOfWeek int, scheduleType string, totalSessions int) []SessionDate {
	if dayOfWeek < 0 || dayOfWeek > 6 {
		return nil
	}
	if totalSessions == 0 {
		totalSessions = 16
	}
	base := time.Date(termStart.UTC().Year(), termStart.UTC().Month(), termStart.UTC().Day(), 0, 0, 0, 0, time.UTC)
	first := base.AddDate(0, 0, dayOfWeek)
	out := []SessionDate{}
	no := 1
	for w := 0; w < totalSessions; w++ {
		week := w + 1
		take := scheduleType == "ALL" ||
			(scheduleType == "EVEN" && week%2 == 0) ||
			(scheduleType == "ODD" && week%2 == 1)
		if take {
			out = append(out, SessionDate{SessionNo: no, Date: first.AddDate(0, 0, w*7)})
			no++
		}
	}
	return out
}

// ─────────────────────────── قیود سخت V2 ───────────────────────────

// HardConflictListLimit سقف پیش‌فرض فهرست تداخل‌ها.
const HardConflictListLimit = 500

// HardConflictEntry ردیف زمان‌بندی‌شده برای قیود V2.
type HardConflictEntry struct {
	OfferingID    int64
	GroupNumber   int
	CourseCode    string
	ProfessorIDs  []int64
	RoomID        *int64
	DayOfWeek     int
	StartMinutes  int
	EndMinutes    int
	EnrolledCount int
	Capacity      int
}

// HardConflict قید سخت V2.
type HardConflict struct {
	Kind        string // PROFESSOR_OVERLAP | ROOM_OVERLAP | CAPACITY_OVERFLOW
	OfferingIDs []int64
	Message     string
}

// HardConflictReport گزارش با شمار کامل و فهرست سقف‌دار.
type HardConflictReport struct {
	Conflicts []HardConflict
	Total     int
	Truncated bool
}

// AnalyzeHardConflicts پورت analyzeHardConflicts — همان الگوریتم سطل‌بندی
// «روز+سالن» و «روز+استاد» با شمارندهٔ عددی و ساخت تنبل اشیا.
func AnalyzeHardConflicts(rows []HardConflictEntry, limit int) HardConflictReport {
	if limit == 0 {
		limit = HardConflictListLimit
	}
	out := []HardConflict{}
	total := 0
	push := func(fn func() HardConflict) {
		total++
		if len(out) < limit {
			out = append(out, fn())
		}
	}

	// ۱) سرریز ظرفیت
	for _, r := range rows {
		if r.Capacity > 0 && r.EnrolledCount > r.Capacity {
			r := r
			push(func() HardConflict {
				return HardConflict{
					Kind:        "CAPACITY_OVERFLOW",
					OfferingIDs: []int64{r.OfferingID},
					Message:     fmt.Sprintf("«%s» گروه %d: %d ثبت‌نامی در کلاس با ظرفیت %d", r.CourseCode, r.GroupNumber, r.EnrolledCount, r.Capacity),
				}
			})
		}
	}

	// ۲) تداخل‌های زمانی درون سطل‌های هم‌روز
	type item struct {
		idx int
		r   HardConflictEntry
	}
	buckets := map[string][]item{}
	add := func(key string, it item) { buckets[key] = append(buckets[key], it) }
	for idx, r := range rows {
		if r.RoomID != nil {
			add(fmt.Sprintf("R|%d|%d", r.DayOfWeek, *r.RoomID), item{idx, r})
		}
		for _, p := range r.ProfessorIDs {
			add(fmt.Sprintf("P|%d|%d", r.DayOfWeek, p), item{idx, r})
		}
	}
	seenProfPair := map[int64]bool{}
	pairKey := func(i, j int) int64 {
		if i < j {
			return int64(i)*1e7 + int64(j)
		}
		return int64(j)*1e7 + int64(i)
	}

	for key, items := range buckets {
		if len(items) < 2 {
			continue
		}
		isRoom := key[0] == 'R'
		// مرتب‌سازی پایدار بر اساس زمان شروع سپس idx
		for i := 1; i < len(items); i++ {
			for j := i; j > 0; j-- {
				a, b := items[j-1], items[j]
				if a.r.StartMinutes < b.r.StartMinutes || (a.r.StartMinutes == b.r.StartMinutes && a.idx <= b.idx) {
					break
				}
				items[j-1], items[j] = b, a
			}
		}
		for i := 0; i < len(items); i++ {
			a := items[i]
			for j := i + 1; j < len(items); j++ {
				b := items[j]
				if b.r.StartMinutes >= a.r.EndMinutes {
					break
				}
				if !Overlaps(a.r.StartMinutes, a.r.EndMinutes, b.r.StartMinutes, b.r.EndMinutes) {
					continue
				}
				x, y := a, b
				if a.idx > b.idx {
					x, y = b, a
				}
				if isRoom {
					x2, y2 := x, y
					push(func() HardConflict {
						return HardConflict{
							Kind:        "ROOM_OVERLAP",
							OfferingIDs: []int64{x2.r.OfferingID, y2.r.OfferingID},
							Message:     fmt.Sprintf("تداخل سالن: «%s» گروه %d با «%s» گروه %d", x2.r.CourseCode, x2.r.GroupNumber, y2.r.CourseCode, y2.r.GroupNumber),
						}
					})
				} else {
					k := pairKey(x.idx, y.idx)
					if seenProfPair[k] {
						continue
					}
					seenProfPair[k] = true
					x2, y2 := x, y
					push(func() HardConflict {
						return HardConflict{
							Kind:        "PROFESSOR_OVERLAP",
							OfferingIDs: []int64{x2.r.OfferingID, y2.r.OfferingID},
							Message:     fmt.Sprintf("تداخل استاد: «%s» گروه %d با «%s» گروه %d", x2.r.CourseCode, x2.r.GroupNumber, y2.r.CourseCode, y2.r.GroupNumber),
						}
					})
				}
			}
		}
	}
	return HardConflictReport{Conflicts: out, Total: total, Truncated: total > len(out)}
}

// DetectHardConflicts نسخهٔ سازگار — فقط فهرست سقف‌دار.
func DetectHardConflicts(rows []HardConflictEntry, limit int) []HardConflict {
	return AnalyzeHardConflicts(rows, limit).Conflicts
}

// ─────────────────────────── مولد تاریخ جلسات (شمسی) ───────────────────────────

// SessionDateInput ورودی computeSessionDates.
type SessionDateInput struct {
	TermStart      time.Time
	ClassStartDate *time.Time
	ClassEndDate   *time.Time
	DayOfWeek      int
	SessionsCount  int
	// OddFirstWeek هفتهٔ اول «فرد» است؟ (nil = پیش‌فرض true، همان TS)
	OddFirstWeek *bool
	Holidays     []string
	Recurrence   string // ALL | EVEN | ODD (پیش‌فرض ALL)
}

// GeneratedSession جلسهٔ تولیدشده (تاریخ شمسی).
type GeneratedSession struct {
	SessionNo  int
	JalaliDate string
	JM         int
	JD         int
}

func pad2(n int) string { return fmt.Sprintf("%02d", n) }

func jalaliWeekdayToJdnMod(dow int) int { return (5 + dow) % 7 }

func dateOnlyLocal(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.Local)
}

// ComputeSessionDates پورت computeSessionDates: مبدأ classStartDate یا termStart،
// اولین تکرار روز هفته، گام ۷روزه تا sessionsCount یا پایان کلاس، حذف
// هفته‌های زوج/فرد و تعطیلات، سقف ایمنی ۴۰ هفته.
func ComputeSessionDates(px SessionDateInput) ([]GeneratedSession, error) {
	if px.DayOfWeek < 0 || px.DayOfWeek > 6 {
		return nil, errors.New("روز هفته باید ۰..۶ باشد (شنبه=۰).")
	}
	if px.SessionsCount < 1 || px.SessionsCount > 60 {
		return nil, errors.New("تعداد جلسات باید ۱..۶۰ باشد.")
	}
	holidays := map[string]bool{}
	for _, h := range px.Holidays {
		h = strings.TrimSpace(h)
		if h != "" {
			holidays[h] = true
		}
	}
	base := px.TermStart
	if px.ClassStartDate != nil {
		base = *px.ClassStartDate
	}
	start := dateOnlyLocal(base)
	var endCap *time.Time
	if px.ClassEndDate != nil {
		e := dateOnlyLocal(*px.ClassEndDate)
		endCap = &e
	}
	j0 := jalali.ToJalaliFromTime(start)
	jdn, err := jalali.J2D(j0.Y, j0.M, j0.D)
	if err != nil {
		return nil, err
	}
	target := jalaliWeekdayToJdnMod(px.DayOfWeek)
	for ((jdn%7)+7)%7 != target {
		jdn++
	}
	rec := px.Recurrence
	if rec == "" {
		rec = "ALL"
	}
	oddFirstWeek := true
	if px.OddFirstWeek != nil {
		oddFirstWeek = *px.OddFirstWeek
	}
	out := []GeneratedSession{}
	weekIndex := 1
	for guard := 0; guard < 40*7 && len(out) < px.SessionsCount; guard++ {
		isEven := weekIndex%2 == 0
		var weekOk bool
		if rec == "ALL" {
			weekOk = true
		} else if oddFirstWeek {
			if isEven {
				weekOk = rec == "EVEN"
			} else {
				weekOk = rec == "ODD"
			}
		} else {
			if isEven {
				weekOk = rec == "ODD"
			} else {
				weekOk = rec == "EVEN"
			}
		}
		j := jalali.D2J(jdn)
		ds := fmt.Sprintf("%d/%s/%s", j.Y, pad2(j.M), pad2(j.D))
		if endCap != nil {
			gg := jalali.ToGregorian(j.Y, j.M, j.D)
			cur := time.Date(gg.Y, time.Month(gg.M), gg.D, 0, 0, 0, 0, time.Local)
			if cur.After(*endCap) {
				break
			}
		}
		if weekOk && !holidays[ds] {
			out = append(out, GeneratedSession{SessionNo: len(out) + 1, JalaliDate: ds, JM: j.M, JD: j.D})
		}
		jdn += 7
		weekIndex++
	}
	return out, nil
}

var jalaliDateRe = regexp.MustCompile(`^(\d{4})/(\d{1,2})/(\d{1,2})$`)

// ParseJalaliDate پورت parseJalaliDate: «YYYY/MM/DD» → Date میلادی (محلی).
func ParseJalaliDate(s string) (time.Time, error) {
	m := jalaliDateRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return time.Time{}, fmt.Errorf("قالب تاریخ شمسی نامعتبر: «%s» (مورد انتظار YYYY/MM/DD)", s)
	}
	jy, _ := strconv.Atoi(m[1])
	jm, _ := strconv.Atoi(m[2])
	jd, _ := strconv.Atoi(m[3])
	gg := jalali.ToGregorian(jy, jm, jd)
	return time.Date(gg.Y, time.Month(gg.M), gg.D, 0, 0, 0, 0, time.Local), nil
}

// JalaliDateOf پورت jalaliDateOf: Date میلادی → «YYYY/MM/DD» شمسی.
func JalaliDateOf(d time.Time) string {
	j := jalali.ToJalaliFromTime(dateOnlyLocal(d))
	return fmt.Sprintf("%d/%s/%s", j.Y, pad2(j.M), pad2(j.D))
}
