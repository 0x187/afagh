package scheduling

import (
	"strings"
	"testing"
	"time"

	"backend-go/internal/jalali"
)

func mkDraft(over func(*GroupDraftInput)) GroupDraftInput {
	d := GroupDraftInput{GroupNumber: 1, Capacity: 40, Gender: "MIXED", ProfessorID: 10, ClassroomID: 100, DayOfWeek: 2, StartTime: "08:00", EndTime: "09:30"}
	over(&d)
	return d
}

// پورت تست validateGroupDrafts — همهٔ پیام‌ها و مرزها.
func TestValidateGroupDrafts(t *testing.T) {
	mustErr := func(name string, inputs []GroupDraftInput, part string) {
		t.Helper()
		if _, err := ValidateGroupDrafts(inputs, false); err == nil || !strings.Contains(err.Error(), part) {
			t.Fatalf("%s: انتظار خطای شامل %q، گرفت: %v", name, part, err)
		}
	}
	mustErr("لیست خالی", nil, "هیچ گروه درسی")
	many := make([]GroupDraftInput, MaxGroups+1)
	for i := range many {
		many[i] = mkDraft(func(d *GroupDraftInput) { d.GroupNumber = i + 1 })
	}
	mustErr("۲۱ گروه", many, "بیشتر است")
	mustErr("شمارهٔ گروه صفر", []GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.GroupNumber = 0 })}, "شمارهٔ گروه نامعتبر")
	mustErr("شمارهٔ تکراری", []GroupDraftInput{
		mkDraft(func(d *GroupDraftInput) { d.GroupNumber = 1 }),
		mkDraft(func(d *GroupDraftInput) { d.GroupNumber = 1 }),
	}, "تکراری")
	mustErr("ظرفیت ۳", []GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.Capacity = 3 })}, "ظرفیت")
	mustErr("ظرفیت ۶۰۰", []GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.Capacity = 600 })}, "ظرفیت")
	mustErr("جنسیت", []GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.Gender = "COED" })}, "جنسیت")
	mustErr("استاد صفر", []GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.ProfessorID = 0 })}, "استاد")
	mustErr("کلاس صفر", []GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.ClassroomID = 0 })}, "کلاس فیزیکی")
	mustErr("روز منفی", []GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.DayOfWeek = -1 })}, "روز")
	mustErr("روز هفت", []GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.DayOfWeek = 7 })}, "روز")
	mustErr("پایان قبل شروع", []GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.StartTime = "10:00"; d.EndTime = "09:00" })}, "بازهٔ زمانی")
	mustErr("مدت ۵ ساعت", []GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.StartTime = "08:00"; d.EndTime = "13:00" })}, "۴ ساعت")
	mustErr("مرز شیفت", []GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.StartTime = "10:30"; d.EndTime = "13:00" })}, "مرز شیفت")
	mustErr("قالب ساعت", []GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.StartTime = "8am" })}, "قالب ساعت")

	// روز ۰ و ۶ معتبر
	if _, err := ValidateGroupDrafts([]GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.DayOfWeek = 0 })}, false); err != nil {
		t.Fatalf("روز ۰ باید معتبر باشد: %v", err)
	}
	if _, err := ValidateGroupDrafts([]GroupDraftInput{mkDraft(func(d *GroupDraftInput) { d.DayOfWeek = 6 })}, false); err != nil {
		t.Fatalf("روز ۶ باید معتبر باشد: %v", err)
	}

	out, err := ValidateGroupDrafts([]GroupDraftInput{
		mkDraft(func(d *GroupDraftInput) { d.GroupNumber = 2; d.StartTime = "14:00"; d.EndTime = "15:30" }),
		mkDraft(func(d *GroupDraftInput) { d.GroupNumber = 1 }),
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	if out[0].GroupNumber != 1 || out[1].GroupNumber != 2 {
		t.Fatal("ترتیب صعودی شمارهٔ گروه حفظ نشد")
	}
	if out[0].Shift != "MORNING" || out[1].Shift != "EVENING" {
		t.Fatalf("شیفت‌ها نادرست: %s/%s", out[0].Shift, out[1].Shift)
	}
	if out[0].StartMinutes != 480 {
		t.Fatalf("دقیقهٔ شروع: %d", out[0].StartMinutes)
	}
}

func TestTimeTools(t *testing.T) {
	if v, err := ToMinutes("08:30"); err != nil || v != 510 {
		t.Fatalf("toMinutes(08:30)=%d,%v", v, err)
	}
	if _, err := ToMinutes("25:00"); err == nil {
		t.Fatal("ساعت ۲۵ باید خطا بدهد")
	}
	if !Overlaps(480, 600, 540, 660) || Overlaps(480, 600, 600, 720) ||
		!Overlaps(480, 720, 500, 600) || Overlaps(480, 540, 660, 720) {
		t.Fatal("overlaps نادرست")
	}
	if _, err := ShiftOf(600, 780); err == nil {
		t.Fatal("عبور از مرز شیفت باید خطا بدهد")
	}
}

func TestSlotScore(t *testing.T) {
	f2 := int64(2)
	f3 := int64(3)
	best := CalculateSlotScore(SlotScoreInput{RoomFacultyID: &f2, TargetFacultyID: &f2, InPreferredWindow: true, InAvailableWindow: true, RoomCapacity: 50, RequiredCapacity: 40})
	if best.Score != ScoreSameFaculty+ScorePreferredTime+ScoreCapacityPerfect {
		t.Fatalf("امتیاز طلایی: %d", best.Score)
	}
	cross := CalculateSlotScore(SlotScoreInput{RoomFacultyID: &f3, TargetFacultyID: &f2, InPreferredWindow: false, InAvailableWindow: true, RoomCapacity: 70, RequiredCapacity: 40})
	if cross.Score != ScoreCrossFaculty+ScoreOKTime+ScoreCapacityGood {
		t.Fatalf("امتیاز بین‌دانشکده: %d", cross.Score)
	}
	capLow := CalculateSlotScore(SlotScoreInput{RoomFacultyID: &f2, TargetFacultyID: &f2, InPreferredWindow: true, InAvailableWindow: true, RoomCapacity: 30, RequiredCapacity: 40})
	if capLow.Score != ScoreCapacityOver || !strings.Contains(capLow.Reasons[0], "کمتر از نیاز") {
		t.Fatalf("ظرفیت ناکافی: %+v", capLow)
	}
	noAvail := CalculateSlotScore(SlotScoreInput{RoomFacultyID: &f2, TargetFacultyID: &f2, InPreferredWindow: false, InAvailableWindow: false, RoomCapacity: 40, RequiredCapacity: 40})
	if noAvail.Score != -100 {
		t.Fatalf("خارج از ساعات حضور: %d", noAvail.Score)
	}
	overCap := CalculateSlotScore(SlotScoreInput{RoomFacultyID: &f2, TargetFacultyID: &f2, InPreferredWindow: true, InAvailableWindow: true, RoomCapacity: 100, RequiredCapacity: 40})
	if overCap.Score != ScoreSameFaculty+ScorePreferredTime {
		t.Fatalf("مازاد ظرفیت: %d", overCap.Score)
	}
}

func TestDemandAndQuota(t *testing.T) {
	cases := []struct {
		students int
		cap      float64
		want     int
	}{
		{0, 40, 1}, {39, 40, 1}, {41, 40, 2}, {210, 40, 6}, {900, 40, MaxGroups},
	}
	for _, c := range cases {
		got, err := SuggestedGroupCount(c.students, c.cap)
		if err != nil || got != c.want {
			t.Fatalf("SuggestedGroupCount(%d,%v)=%d,%v want %d", c.students, c.cap, got, err, c.want)
		}
	}
	if _, err := SuggestedGroupCount(10, 0); err == nil {
		t.Fatal("ظرفیت صفر باید خطا بدهد")
	}
	if _, err := SuggestedGroupCount(-5, 40); err == nil {
		t.Fatal("متقاضی منفی باید خطا بدهد")
	}
	f1, f15 := int64(1), int64(2)
	dist := DistributeGroupsByFaculty([]FacultyDemand{{FacultyID: &f1, Eligible: 55}, {FacultyID: &f15, Eligible: 15}}, 40)
	if *dist[0].FacultyID != 1 || dist[0].Groups != 2 || dist[1].Groups != 1 {
		t.Fatalf("توزیع دانشکده: %+v", dist)
	}

	rooms := []RoomGrantInput{
		{ClassroomID: 1, Capacity: 100, Shifts: []string{"MORNING", "EVENING"}},
		{ClassroomID: 2, Capacity: 60, Shifts: []string{"MORNING", "EVENING"}},
	}
	grants := AllocateQuotaShifts(rooms, []DeptShareInput{{DepartmentID: 10, ActiveStudents: 300}, {DepartmentID: 20, ActiveStudents: 100}})
	if len(grants) != 4 {
		t.Fatalf("جمع گرنت‌ها: %d", len(grants))
	}
	d10, d20 := 0, 0
	for _, g := range grants {
		if g.DepartmentID == 10 {
			d10++
		} else {
			d20++
		}
	}
	if d10 != 3 || d20 != 1 {
		t.Fatalf("سهم ۷۵/۲۵: %d/%d", d10, d20)
	}
	if grants[0].ClassroomID != 1 {
		t.Fatal("سالن بزرگ‌تر باید اول به گروه پرجمعیت برسد")
	}
	equal := AllocateQuotaShifts(rooms, []DeptShareInput{{DepartmentID: 10, ActiveStudents: 50}, {DepartmentID: 20, ActiveStudents: 50}})
	e10 := 0
	for _, g := range equal {
		if g.DepartmentID == 10 {
			e10++
		}
	}
	if e10 != 2 {
		t.Fatalf("توزیع مساوی: %d", e10)
	}
	if len(AllocateQuotaShifts(rooms, nil)) != 0 {
		t.Fatal("بدون دانشجو نباید گرنت ساخته شود")
	}
}

func TestPhasesAndUtilization(t *testing.T) {
	if !CanTransition("SUPPLY", "ALLOCATION") || CanTransition("SUPPLY", "REVIEW") ||
		!CanTransition("REVIEW", "PUBLISHED") || CanTransition("PUBLISHED", "REVIEW") {
		t.Fatal("ماشین فازها نادرست")
	}
	if !CanEditInPhase("SUPPLY") || CanEditInPhase("PUBLISHED") {
		t.Fatal("ویرایش فاز نادرست")
	}
	if CanAllocateInPhase("SUPPLY") || !CanAllocateInPhase("ALLOCATION") || CanAllocateInPhase("PUBLISHED") {
		t.Fatal("تخصیص فاز نادرست")
	}
	cases := []struct {
		e, c int
		want string
	}{
		{20, 40, "UNDERFILLED"}, {30, 40, "NORMAL"}, {36, 40, "FULL"}, {41, 40, "OVERBOOKED"}, {0, 0, "OVERBOOKED"},
	}
	for _, c := range cases {
		if got := ClassifyUtilization(c.e, c.c); got != c.want {
			t.Fatalf("ClassifyUtilization(%d,%d)=%s want %s", c.e, c.c, got, c.want)
		}
	}
	if ShiftUtilization(120, 240) != 0.5 || ShiftUtilization(0, 240) != 0 {
		t.Fatal("shiftUtilization نادرست")
	}
}

func TestHardConflictsV1(t *testing.T) {
	rooms := []RoomCapacityInfo{{ID: 1, Capacity: 40, Title: "کلاس ۱۰۱"}, {ID: 2, Capacity: 20, Title: "کلاس ۱۰۲"}}
	day := func(d int) *int { return &d }
	room := func(r int64) *int64 { return &r }
	sched := func(offer int64, d int, start, end string, roomID int64, profs ...int64) ScheduleConflictInput {
		pids := make([]*int64, 0, len(profs))
		for _, p := range profs {
			p2 := p
			pids = append(pids, &p2)
		}
		return ScheduleConflictInput{
			OfferingID: offer, GroupNumber: day(1), DayOfWeek: day(d), StartTime: start, EndTime: end,
			RoomID: room(roomID), RequiredCapacity: 30, ProfessorIDs: pids,
			OfferingTitle: "درس",
		}
	}

	clean := DetectScheduleConflictsV1([]ScheduleConflictInput{
		sched(1, 1, "08:00", "09:30", 1),
		sched(2, 1, "10:00", "11:30", 1),
	}, rooms)
	if len(clean) != 0 || HasHardConflicts(clean) {
		t.Fatal("برنامهٔ بدون تداخل نباید یافته بدهد")
	}

	roomOverlap := DetectScheduleConflictsV1([]ScheduleConflictInput{
		sched(1, 2, "08:00", "10:00", 1),
		sched(2, 2, "09:00", "11:00", 1),
	}, rooms)
	if !hasType(roomOverlap, "ROOM_OVERLAP") {
		t.Fatal("تداخل سالن شناسایی نشد")
	}
	for _, c := range roomOverlap {
		if c.Type == "ROOM_OVERLAP" && (len(c.OfferingIDs) != 2 || c.OfferingIDs[0] != 1 || c.OfferingIDs[1] != 2) {
			t.Fatalf("offeringIds: %v", c.OfferingIDs)
		}
	}

	if hasType(DetectScheduleConflictsV1([]ScheduleConflictInput{
		sched(1, 2, "08:00", "10:00", 1),
		sched(2, 2, "08:00", "10:00", 2),
	}, rooms), "ROOM_OVERLAP") {
		t.Fatal("سالن‌های متفاوت نباید تداخل بدهند")
	}

	profOverlap := DetectScheduleConflictsV1([]ScheduleConflictInput{
		sched(1, 3, "08:00", "10:00", 1, 7),
		sched(2, 3, "09:00", "11:00", 2, 8, 7),
	}, rooms)
	if !hasType(profOverlap, "PROFESSOR_OVERLAP") {
		t.Fatal("استاد دوم (Co-Teaching) شناسایی نشد")
	}

	if hasType(DetectScheduleConflictsV1([]ScheduleConflictInput{
		sched(1, 1, "08:00", "10:00", 1, 7),
		sched(2, 2, "08:00", "10:00", 1, 7),
	}, rooms), "PROFESSOR_OVERLAP") {
		t.Fatal("روزهای جدا نباید تداخل استاد بدهند")
	}

	if !hasType(DetectScheduleConflictsV1([]ScheduleConflictInput{
		{
			OfferingID: 9, GroupNumber: day(1), DayOfWeek: day(2), StartTime: "08:00", EndTime: "10:00",
			RoomID: room(1), RequiredCapacity: 50, ProfessorIDs: nil, OfferingTitle: "درس",
		},
	}, rooms), "ROOM_CAPACITY") {
		t.Fatal("سرریز ظرفیت سالن شناسایی نشد")
	}
}

func hasType(list []ScheduleConflict, typ string) bool {
	for _, c := range list {
		if c.Type == typ {
			return true
		}
	}
	return false
}

func TestSessionDatesFor(t *testing.T) {
	start := time.Date(2025, 9, 20, 0, 0, 0, 0, time.UTC) // شنبه
	all := SessionDatesFor(start, 0, "ALL", 16)
	if len(all) != 16 || all[0].SessionNo != 1 || all[15].SessionNo != 16 {
		t.Fatalf("ALL: %d جلسه", len(all))
	}
	if all[0].Date.Format("2006-01-02") != "2025-09-20" {
		t.Fatalf("جلسهٔ اول: %s", all[0].Date)
	}
	if all[1].Date.Sub(all[0].Date) != 7*24*time.Hour {
		t.Fatal("فاصلهٔ هفتگی نادرست")
	}
	if sun := SessionDatesFor(start, 1, "ALL", 4); sun[0].Date.Format("2006-01-02") != "2025-09-21" {
		t.Fatal("یکشنبه نادرست")
	}
	fri := SessionDatesFor(start, 6, "ALL", 4)
	if len(fri) != 4 || fri[0].Date.Format("2006-01-02") != "2025-09-26" {
		t.Fatal("جمعه نادرست")
	}
	even := SessionDatesFor(start, 0, "EVEN", 16)
	if len(even) != 8 || even[0].Date.Format("2006-01-02") != "2025-09-27" {
		t.Fatalf("EVEN: %d %s", len(even), even[0].Date)
	}
	odd := SessionDatesFor(start, 0, "ODD", 16)
	if len(odd) != 8 || odd[0].Date.Format("2006-01-02") != "2025-09-20" {
		t.Fatal("ODD نادرست")
	}
	for _, bad := range []int{-1, 7, 9} {
		if got := SessionDatesFor(start, bad, "ALL", 16); len(got) != 0 {
			t.Fatalf("روز %d باید خالی بدهد", bad)
		}
	}
}

func TestHardConflictsV2(t *testing.T) {
	row := func(over func(*HardConflictEntry)) HardConflictEntry {
		e := HardConflictEntry{
			OfferingID: 1, GroupNumber: 1, CourseCode: "C1", ProfessorIDs: []int64{10},
			RoomID: int64p(100), DayOfWeek: 2, StartMinutes: 480, EndMinutes: 570,
			EnrolledCount: 30, Capacity: 40,
		}
		over(&e)
		return e
	}
	if got := DetectHardConflicts([]HardConflictEntry{
		row(func(e *HardConflictEntry) {}),
		row(func(e *HardConflictEntry) {
			e.OfferingID = 2
			e.CourseCode = "C2"
			e.ProfessorIDs = []int64{11}
			e.RoomID = int64p(101)
			e.DayOfWeek = 3
		}),
	}, 0); len(got) != 0 {
		t.Fatal("بدون تداخل نباید یافته بدهد")
	}
	if got := DetectHardConflicts([]HardConflictEntry{
		row(func(e *HardConflictEntry) {}),
		row(func(e *HardConflictEntry) { e.OfferingID = 2; e.CourseCode = "C2"; e.RoomID = int64p(101) }),
	}, 0); len(got) == 0 || got[0].Kind != "PROFESSOR_OVERLAP" {
		t.Fatalf("تداخل استاد: %+v", got)
	}
	if got := DetectHardConflicts([]HardConflictEntry{
		row(func(e *HardConflictEntry) { e.ProfessorIDs = []int64{10, 12} }),
		row(func(e *HardConflictEntry) {
			e.OfferingID = 2
			e.CourseCode = "C2"
			e.ProfessorIDs = []int64{12}
			e.RoomID = int64p(101)
		}),
	}, 0); len(got) == 0 || got[0].Kind != "PROFESSOR_OVERLAP" {
		t.Fatal("استاد دوم Co-Teaching شناسایی نشد")
	}
	if got := DetectHardConflicts([]HardConflictEntry{
		row(func(e *HardConflictEntry) {}),
		row(func(e *HardConflictEntry) {
			e.OfferingID = 2
			e.CourseCode = "C2"
			e.ProfessorIDs = []int64{10}
			e.RoomID = int64p(101)
			e.DayOfWeek = 4
		}),
	}, 0); len(got) != 0 {
		t.Fatal("روزهای مختلف نباید تداخل بدهند")
	}
	if got := DetectHardConflicts([]HardConflictEntry{
		row(func(e *HardConflictEntry) {}),
		row(func(e *HardConflictEntry) {
			e.OfferingID = 2
			e.CourseCode = "C2"
			e.ProfessorIDs = []int64{11}
			e.StartMinutes = 540
			e.EndMinutes = 600
		}),
	}, 0); len(got) == 0 || got[0].Kind != "ROOM_OVERLAP" {
		t.Fatalf("تداخل سالن: %+v", got)
	}
	if got := DetectHardConflicts([]HardConflictEntry{
		row(func(e *HardConflictEntry) {}),
		row(func(e *HardConflictEntry) {
			e.OfferingID = 2
			e.CourseCode = "C2"
			e.ProfessorIDs = []int64{11}
			e.StartMinutes = 600
			e.EndMinutes = 660
		}),
	}, 0); len(got) != 0 {
		t.Fatal("سالن مشترک غیرهم‌زمان نباید تداخل بدهد")
	}
	if got := DetectHardConflicts([]HardConflictEntry{row(func(e *HardConflictEntry) { e.EnrolledCount = 45 })}, 0); len(got) == 0 || got[0].Kind != "CAPACITY_OVERFLOW" {
		t.Fatal("سرریز ظرفیت شناسایی نشد")
	}
	if got := DetectHardConflicts([]HardConflictEntry{row(func(e *HardConflictEntry) { e.Capacity = 0; e.EnrolledCount = 100 })}, 0); len(got) != 0 {
		t.Fatal("ظرفیت نامشخص نباید خطای کاذب بدهد")
	}
	multi := DetectHardConflicts([]HardConflictEntry{
		row(func(e *HardConflictEntry) {}),
		row(func(e *HardConflictEntry) { e.OfferingID = 2; e.CourseCode = "C2" }),
		row(func(e *HardConflictEntry) {
			e.OfferingID = 3
			e.CourseCode = "C3"
			e.ProfessorIDs = []int64{11}
			e.StartMinutes = 480
			e.EndMinutes = 540
		}),
	}, 0)
	if len(multi) != 4 {
		t.Fatalf("هم‌زمانی سه‌گانه باید ۴ تداخل بدهد: %d", len(multi))
	}
	// سقف فهرست + شمار کامل
	report := AnalyzeHardConflicts([]HardConflictEntry{row(func(e *HardConflictEntry) { e.EnrolledCount = 50 })}, 1)
	if report.Total != 1 || len(report.Conflicts) != 1 || report.Truncated {
		t.Fatalf("report: %+v", report)
	}
}

func int64p(v int64) *int64 { return &v }

func TestComputeSessionDates(t *testing.T) {
	start, err := ParseJalaliDate("1405/06/29")
	if err != nil {
		t.Fatal(err)
	}
	if got := JalaliDateOf(start); got != "1405/06/29" {
		t.Fatalf("رفت‌وبرگشت تاریخ: %s", got)
	}
	if _, err := ParseJalaliDate("۱۴۰۵/۰۶/۲۹"); err == nil {
		t.Fatal("قالب فارسی باید خطا بدهد")
	}

	all, err := ComputeSessionDates(SessionDateInput{TermStart: start, DayOfWeek: 0, SessionsCount: 16})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 16 || all[0].JalaliDate != "1405/07/04" || all[1].JalaliDate != "1405/07/11" {
		t.Fatalf("جلسات شنبه: %+v", all[:2])
	}
	if all[3].JalaliDate != "1405/07/25" {
		t.Fatalf("جلسهٔ چهارم: %s", all[3].JalaliDate)
	}
	holiday, _ := ComputeSessionDates(SessionDateInput{TermStart: start, DayOfWeek: 0, SessionsCount: 8, Holidays: []string{"1405/07/11"}})
	if len(holiday) != 8 || holiday[1].JalaliDate != "1405/07/18" {
		t.Fatalf("پرش تعطیلات: %+v", holiday[:2])
	}
	even, _ := ComputeSessionDates(SessionDateInput{TermStart: start, DayOfWeek: 0, SessionsCount: 4, Recurrence: "EVEN"})
	if even[0].JalaliDate != "1405/07/11" {
		t.Fatalf("هفتهٔ زوج: %s", even[0].JalaliDate)
	}
	odd, _ := ComputeSessionDates(SessionDateInput{TermStart: start, DayOfWeek: 0, SessionsCount: 4, Recurrence: "ODD"})
	if odd[0].JalaliDate != "1405/07/04" {
		t.Fatalf("هفتهٔ فرد: %s", odd[0].JalaliDate)
	}
	fri, _ := ComputeSessionDates(SessionDateInput{TermStart: start, DayOfWeek: 6, SessionsCount: 3})
	if len(fri) != 3 || fri[0].JalaliDate != "1405/07/03" {
		t.Fatalf("جمعه: %+v", fri)
	}
	wed, _ := ComputeSessionDates(SessionDateInput{TermStart: start, DayOfWeek: 4, SessionsCount: 3})
	if wed[0].JalaliDate != "1405/07/01" {
		t.Fatalf("چهارشنبه: %s", wed[0].JalaliDate)
	}
	for _, bad := range []int{-1, 7, 8} {
		if _, err := ComputeSessionDates(SessionDateInput{TermStart: start, DayOfWeek: bad, SessionsCount: 4}); err == nil {
			t.Fatalf("روز %d باید خطا بدهد", bad)
		}
	}
	if _, err := ComputeSessionDates(SessionDateInput{TermStart: start, DayOfWeek: 0, SessionsCount: 70}); err == nil {
		t.Fatal("۶۰+ جلسه باید خطا بدهد")
	}

	// لنگر واقعی: ۲۰۲۴-۱۰-۲۶ (شنبه) = ۱۴۰۳/۰۸/۰۵
	anchor := time.Date(2024, 10, 26, 0, 0, 0, 0, time.Local)
	if got := JalaliDateOf(anchor); got != "1403/08/05" {
		t.Fatalf("لنگر شمسی: %s", got)
	}
	parsed, _ := ParseJalaliDate("1403/08/05")
	if parsed.Weekday() != time.Saturday {
		t.Fatalf("۱۴۰۳/۰۸/۰۵ باید شنبه باشد: %v", parsed.Weekday())
	}
	satStart, _ := ParseJalaliDate("1403/08/01")
	satSessions, _ := ComputeSessionDates(SessionDateInput{TermStart: satStart, DayOfWeek: 0, SessionsCount: 4})
	if len(satSessions) != 4 || satSessions[0].JalaliDate != "1403/08/05" {
		t.Fatalf("نخستین شنبه: %+v", satSessions)
	}
	for _, s := range satSessions {
		d, _ := ParseJalaliDate(s.JalaliDate)
		if d.Weekday() != time.Saturday {
			t.Fatalf("%s شنبه نیست", s.JalaliDate)
		}
	}
}

var _ = jalali.FaDigits
