package scheduleconflicts

import (
	"strings"
	"testing"
)

func ip(v int) *int       { return &v }
func i64(v int64) *int64  { return &v }
func sp(v string) *string { return &v }

func slot(over func(*ConflictSlot)) ConflictSlot {
	s := ConflictSlot{
		ScheduleID: 1, OfferingID: 1, DayOfWeek: ip(1),
		StartTime: "08:00", EndTime: "09:30",
		RoomID: i64(10), RoomName: sp("کلاس ۱۰"),
		ProfessorID: i64(7), ProfessorName: sp("استاد هفت"),
		CourseCode: "C1", CourseTitle: "درس یک", GroupNumber: 1,
		EnrolledCount: 20,
	}
	over(&s)
	return s
}

func TestTimeHelpers(t *testing.T) {
	if v := ToMinutesPtr("08:30"); v == nil || *v != 510 {
		t.Fatalf("toMinutes: %v", v)
	}
	for _, bad := range []string{"", "8", "25:00", "12:60", "x:10"} {
		if ToMinutesPtr(bad) != nil {
			t.Fatalf("%q باید nil بدهد", bad)
		}
	}
	if got := MinutesToHm(510); got != "08:30" {
		t.Fatalf("minutesToHm: %s", got)
	}
	if OverlapMinutes(480, 600, 540, 660) != 60 || OverlapMinutes(480, 540, 540, 600) != 0 {
		t.Fatal("overlapMinutes نادرست")
	}
}

func TestMergeRules(t *testing.T) {
	if SharedMergeKey(sp("G-1")) == nil || SharedMergeKey(sp("SOLO-1")) != nil || SharedMergeKey(sp("  ")) != nil {
		t.Fatal("sharedMergeKey نادرست")
	}
	if !IsExplicitlySplit(sp("SOLO-1")) || IsExplicitlySplit(sp("G-1")) || IsExplicitlySplit(nil) {
		t.Fatal("isExplicitlySplit نادرست")
	}

	a := slot(func(s *ConflictSlot) {})
	b := slot(func(s *ConflictSlot) { s.ScheduleID = 2; s.OfferingID = 2 })
	if !IsMergedPair(a, b) {
		t.Fatal("ساعت و سالن یکسان = ادغامی")
	}
	// same merge key
	a2 := slot(func(s *ConflictSlot) { s.SharedScheduleGroupKey = sp("G-9") })
	b2 := slot(func(s *ConflictSlot) { s.SharedScheduleGroupKey = sp("G-9"); s.ScheduleID = 3 })
	if !IsMergedPair(a2, b2) {
		t.Fatal("کلید ادغام یکسان = ادغامی")
	}
	// SOLO blocks merging
	a3 := slot(func(s *ConflictSlot) { s.SharedScheduleGroupKey = sp("SOLO-1") })
	if IsMergedPair(a3, b) {
		t.Fatal("SOLO نباید ادغامی شمرده شود")
	}
	// unknown room does not block merging
	a4 := slot(func(s *ConflictSlot) { s.RoomID = nil })
	if !IsMergedPair(a4, b) {
		t.Fatal("سالن NULL باید ادغام را مجاز کند")
	}
	// different time
	b5 := slot(func(s *ConflictSlot) { s.StartTime = "10:00"; s.EndTime = "11:30" })
	if IsMergedPair(a, b5) {
		t.Fatal("ساعت متفاوت نباید ادغامی باشد")
	}

	// near merged: same professor/room, gap ≤20 minutes
	near := slot(func(s *ConflictSlot) { s.StartTime = "08:15"; s.EndTime = "09:45" })
	if !IsNearMergedPair(a, near) {
		t.Fatal("اختلاف ۱۵ دقیقه باید near-merged باشد")
	}
	far := slot(func(s *ConflictSlot) { s.StartTime = "08:25"; s.EndTime = "09:55" })
	if IsNearMergedPair(a, far) {
		t.Fatal("اختلاف ۲۵ دقیقه نباید near باشد")
	}
	otherRoom := slot(func(s *ConflictSlot) { s.RoomID = i64(11); s.StartTime = "08:10"; s.EndTime = "09:40" })
	if IsNearMergedPair(a, otherRoom) {
		t.Fatal("سالن متفاوت نباید near-merged باشد")
	}
	otherProf := slot(func(s *ConflictSlot) { s.ProfessorID = i64(8); s.StartTime = "08:10"; s.EndTime = "09:40" })
	if IsNearMergedPair(a, otherProf) {
		t.Fatal("استاد متفاوت نباید near-merged باشد")
	}
	if !IsNearMergedPair(a, b) {
		t.Fatal("ادغام دقیق باید near هم باشد")
	}
}

func TestDedupeAndConflicts(t *testing.T) {
	dup := slot(func(s *ConflictSlot) {})
	dup2 := slot(func(s *ConflictSlot) { s.ScheduleID = 99 })
	slots, removed := DedupeSlots([]ConflictSlot{dup, dup2})
	if len(slots) != 1 || removed != 1 {
		t.Fatalf("dedupe: %d/%d", len(slots), removed)
	}
	otherRoomSameTime := slot(func(s *ConflictSlot) { s.ScheduleID = 3; s.RoomID = i64(11) })
	if _, removed2 := DedupeSlots([]ConflictSlot{dup, otherRoomSameTime}); removed2 != 0 {
		t.Fatal("سالن متفاوت نباید تکراری شمرده شود")
	}

	// merged → professor conflict suppressed, but since it is the same professor there is no room conflict either
	mergedSameProf := slot(func(s *ConflictSlot) { s.ScheduleID = 2; s.OfferingID = 2; s.CourseCode = "C2" })
	res := DetectScheduleConflicts([]ConflictSlot{dup, mergedSameProf})
	if len(res.Pairs) != 0 || res.MergedSkipped != 1 || res.RawOverlaps != 1 {
		t.Fatalf("ادغام: %+v", res)
	}

	// merged with two different professors → room conflict remains
	mergedOtherProf := slot(func(s *ConflictSlot) {
		s.ScheduleID = 3
		s.OfferingID = 3
		s.CourseCode = "C3"
		s.ProfessorID = i64(8)
		s.ProfessorName = sp("استاد هشت")
	})
	res = DetectScheduleConflicts([]ConflictSlot{dup, mergedOtherProf})
	if len(res.Pairs) != 1 || res.Pairs[0].Kind != "ROOM" {
		t.Fatalf("ادغامی با استاد متفاوت باید تداخل سالن بدهد: %+v", res.Pairs)
	}

	// SOLO: same time and room → real conflict (professor + room)
	soloA := slot(func(s *ConflictSlot) { s.SharedScheduleGroupKey = sp("SOLO-1") })
	soloB := slot(func(s *ConflictSlot) { s.ScheduleID = 4; s.OfferingID = 4; s.SharedScheduleGroupKey = sp("SOLO-1") })
	res = DetectScheduleConflicts([]ConflictSlot{soloA, soloB})
	if len(res.Pairs) != 2 {
		t.Fatalf("SOLO باید هر دو تداخل را بدهد: %d", len(res.Pairs))
	}

	// near-merged: same professor/room with a time gap → conflicts flagged with likelyMerged
	near := slot(func(s *ConflictSlot) {
		s.ScheduleID = 5
		s.OfferingID = 5
		s.CourseCode = "C5"
		s.StartTime = "08:10"
		s.EndTime = "09:40"
	})
	res = DetectScheduleConflicts([]ConflictSlot{dup, near})
	if len(res.Pairs) == 0 {
		t.Fatal("اختلاف ساعت باید تداخل بدهد")
	}
	for _, p := range res.Pairs {
		if !p.LikelyMerged {
			t.Fatalf("تداخل باید likelyMerged باشد: %+v", p)
		}
	}

	// two courses of the same offering → ignored
	sameOffering := slot(func(s *ConflictSlot) { s.ScheduleID = 6; s.StartTime = "08:30"; s.EndTime = "10:00" })
	res = DetectScheduleConflicts([]ConflictSlot{dup, sameOffering})
	if len(res.Pairs) != 0 {
		t.Fatal("دو اسلات یک ارائه نباید تداخل گزارش شود")
	}
}

func TestSummaryAndEntityGrouping(t *testing.T) {
	a := slot(func(s *ConflictSlot) { s.EnrolledCount = 20 })
	b := slot(func(s *ConflictSlot) {
		s.ScheduleID = 2
		s.OfferingID = 2
		s.StartTime = "08:10"
		s.EndTime = "09:40"
		s.EnrolledCount = 5
	})
	res := DetectScheduleConflicts([]ConflictSlot{a, b})
	sum := SummarizeConflicts(res.Pairs)
	if sum.Professor == 0 || sum.Room == 0 || sum.ProfessorEntities != 1 || sum.RoomEntities != 1 {
		t.Fatalf("summary: %+v", sum)
	}
	// affected students counted only once per offering pair
	if sum.StudentsAtRisk != 25 {
		t.Fatalf("studentsAtRisk=%d want 25", sum.StudentsAtRisk)
	}
	groups := GroupConflictsByEntity(res.Pairs)
	if len(groups) != 2 { // one professor + one room
		t.Fatalf("entity groups: %d", len(groups))
	}
	if groups[0].Kind != "PROFESSOR" {
		t.Fatal("گروه استاد باید اول باشد")
	}
}

func TestGroupConflictPairs(t *testing.T) {
	// three courses by one professor in one room with interleaved ranges → one issue
	mk := func(id int64, start, end string, enrolled int) ConflictSlot {
		return slot(func(s *ConflictSlot) {
			s.ScheduleID = id
			s.OfferingID = id
			s.CourseCode = "C" + strings.Repeat("0", int(id))
			s.StartTime = start
			s.EndTime = end
			s.EnrolledCount = enrolled
		})
	}
	slots := []ConflictSlot{
		mk(1, "13:45", "16:10", 10),
		mk(2, "14:00", "16:15", 20),
		mk(3, "13:50", "16:05", 30),
	}
	res := DetectScheduleConflicts(slots)
	if len(res.Pairs) == 0 {
		t.Fatal("باید تداخل تولید شود")
	}
	groups := GroupConflictPairs(res.Pairs, nil)
	if len(groups) != 1 {
		t.Fatalf("همهٔ جفت‌ها باید یک مسئله باشند: %d", len(groups))
	}
	g := groups[0]
	if len(g.Slots) != 3 {
		t.Fatalf("slots گروه: %d", len(g.Slots))
	}
	if g.Kind != "MIXED" {
		t.Fatalf("نوع گروه (استاد+سالن) باید MIXED باشد: %s", g.Kind)
	}
	if g.Students != 60 {
		t.Fatalf("students=%d want 60", g.Students)
	}
	if !g.LikelyMerged {
		t.Fatal("همهٔ جفت‌ها near-merged باید likelyMerged گروه را true کنند")
	}
	reviewed := GroupConflictPairs(res.Pairs, func(ConflictPair) bool { return true })
	if !reviewed[0].Reviewed {
		t.Fatal("با isReviewed=true گروه باید reviewed باشد")
	}
	if g.DayName != "یکشنبه" {
		t.Fatalf("dayName=%s", g.DayName)
	}
}

func TestReasonLabels(t *testing.T) {
	if len(ConflictReasonLabels) != 5 || len(ConflictReasonCodes) != 5 {
		t.Fatal("برچسب‌های دلیل باید ۵ مورد باشند")
	}
	for _, code := range ConflictReasonCodes {
		if ConflictReasonLabels[code] == "" {
			t.Fatalf("کد %s برچسب ندارد", code)
		}
	}
}
