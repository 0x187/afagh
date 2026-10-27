// ═══ حضور و غیاب استاد — پورت professor/attendance ═══
package professor

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"backend-go/internal/jalali"
	"backend-go/internal/scheduling"
)

// AttendanceStudent دانشجوی کلاس.
type AttendanceStudent struct {
	ID          int64  `json:"id"`
	StudentCode string `json:"studentCode"`
	FullName    string `json:"fullName"`
}

// StudentStatus وضعیت حضور دانشجو.
type StudentStatus struct {
	Status string `json:"status"`
}

// ProfessorCheck جزئیات ثبت حضور استاد.
type ProfessorCheck struct {
	VerificationMethod string  `json:"verificationMethod"`
	IPAddress          *string `json:"ipAddress"`
	RecordedAt         *string `json:"recordedAt"`
}

// SessionItem جلسهٔ کلاس.
type SessionItem struct {
	ID                 int64                   `json:"id"`
	SessionNo          int                     `json:"sessionNo"`
	SessionDate        string                  `json:"sessionDate"`
	StartTime          string                  `json:"startTime"`
	EndTime            string                  `json:"endTime"`
	RoomName           string                  `json:"roomName"`
	Topic              string                  `json:"topic"`
	IsHeld             bool                    `json:"isHeld"`
	IsMakeUp           bool                    `json:"isMakeUp"`
	ReplacedSessionNo  *int                    `json:"replacedSessionNo"`
	ProfessorStatus    string                  `json:"professorStatus"`
	VerificationDetail string                  `json:"verificationDetail"`
	ProfessorCheck     *ProfessorCheck         `json:"professorCheck"`
	StudentStatuses    map[int64]StudentStatus `json:"studentStatuses"`
}

// AttendanceOffering ارائه در صفحهٔ حضور.
type AttendanceOffering struct {
	ID           int64               `json:"id"`
	Code         string              `json:"code"`
	Title        string              `json:"title"`
	GroupNumber  int                 `json:"groupNumber"`
	Units        float64             `json:"units"`
	RoomName     string              `json:"roomName"`
	ScheduleTime string              `json:"scheduleTime"`
	HasSchedules bool                `json:"hasSchedules"`
	CanGenerate  bool                `json:"canGenerate"`
	Merged       bool                `json:"merged"`
	MemberCount  int                 `json:"memberCount"`
	Students     []AttendanceStudent `json:"students"`
	Sessions     []SessionItem       `json:"sessions"`
}

// MakeupRecord سابقهٔ جلسهٔ جبرانی.
type MakeupRecord struct {
	ID                int64  `json:"id"`
	OfferingID        int64  `json:"offeringId"`
	CourseTitle       string `json:"courseTitle"`
	GroupNumber       int    `json:"groupNumber"`
	ProfessorName     string `json:"professorName"`
	ReplacedSessionNo int    `json:"replacedSessionNo"`
	SessionDate       string `json:"sessionDate"`
	SessionTime       string `json:"sessionTime"`
	RoomName          string `json:"roomName"`
	Topic             string `json:"topic"`
	Reason            string `json:"reason"`
	Status            string `json:"status"`
	AllocatedAt       string `json:"allocatedAt"`
}

// RoomOption سالن.
type RoomOption struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Capacity int    `json:"capacity"`
	Type     string `json:"type"`
}

// AttendanceResponse پاسخ صفحه.
type AttendanceResponse struct {
	Professor         ProfessorInfo        `json:"professor"`
	TermTitle         string               `json:"termTitle"`
	TermID            *int64               `json:"termId"`
	Offerings         []AttendanceOffering `json:"offerings"`
	DefaultOfferingID *int64               `json:"defaultOfferingId"`
	MakeupHistory     []MakeupRecord       `json:"initialMakeupHistory"`
	TodayJalali       string               `json:"todayJalali"`
	Rooms             []RoomOption         `json:"rooms"`
}

type attendanceEnrollment struct {
	ID          int64
	OfferingID  int64
	StudentID   int64
	StudentCode string
	FirstName   string
	LastName    string
}

// GetAttendance پورت professor/attendance/page.tsx.
func (s *Service) GetAttendance(ctx context.Context, userID int64, cookie *int64, wantedOfferingID *int64) (*AttendanceResponse, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, errNoStaff
	}
	term := s.ResolveTerm(ctx, st.UniversityID, cookie)

	// ارائه‌های ترم.
	type offeringRow struct {
		ID        int64
		TermID    int64
		CourseID  int64
		Code      string
		Title     string
		Units     float64
		Group     int
		SharedKey *string
	}
	myOfferings := []offeringRow{}
	q := `select o.id, o."termId", o."courseId", c.code, c.title, c.units,
	             coalesce(o."groupNumber",0), o."sharedScheduleGroupKey"
	        from course_offerings o
	        join courses c on c.id = o."courseId"
	       where o."isActive" = 1 and (o."professorId" = $1 or exists (
	               select 1 from offering_professors op where op."offeringId" = o.id and op."staffId" = $1))`
	args := []any{st.ID}
	if term.ID != nil {
		q += ` and o."termId" = $2`
		args = append(args, *term.ID)
	}
	if st.UniversityID != nil {
		q += fmt.Sprintf(` and o."universityId" = $%d`, len(args)+1)
		args = append(args, *st.UniversityID)
	}
	rows, err := s.DB.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var o offeringRow
		if err := rows.Scan(&o.ID, &o.TermID, &o.CourseID, &o.Code, &o.Title, &o.Units, &o.Group, &o.SharedKey); err == nil {
			myOfferings = append(myOfferings, o)
		}
	}
	rows.Close()

	// ارائهٔ پیوندی خارج از ترم انتخابی.
	if wantedOfferingID != nil {
		found := false
		for _, o := range myOfferings {
			if o.ID == *wantedOfferingID {
				found = true
			}
		}
		if !found {
			var o offeringRow
			err := s.DB.Pool.QueryRow(ctx, `
				select o.id, o."termId", o."courseId", c.code, c.title, c.units,
				       coalesce(o."groupNumber",0), o."sharedScheduleGroupKey"
				  from course_offerings o join courses c on c.id = o."courseId"
				 where o.id = $1 and (o."professorId" = $2 or exists (
				       select 1 from offering_professors op where op."offeringId" = o.id and op."staffId" = $2))`,
				*wantedOfferingID, st.ID).
				Scan(&o.ID, &o.TermID, &o.CourseID, &o.Code, &o.Title, &o.Units, &o.Group, &o.SharedKey)
			if err == nil {
				myOfferings = append(myOfferings, o)
			}
		}
	}

	resp := &AttendanceResponse{
		Professor: s.professorInfo(ctx, st), TermTitle: term.Title, TermID: term.ID,
		Offerings: []AttendanceOffering{}, MakeupHistory: []MakeupRecord{},
		TodayJalali: jalaliToday(), Rooms: []RoomOption{},
	}
	if len(myOfferings) == 0 {
		return resp, nil
	}
	offeringIDs := []int64{}
	for _, o := range myOfferings {
		offeringIDs = append(offeringIDs, o.ID)
	}

	// جلسات.
	type sessionRow struct {
		ID          int64
		OfferingID  int64
		SessionNo   int
		SessionDate string
		StartTime   string
		EndTime     string
		Status      string
		IsMakeUp    int
		ReplacedID  *int64
		RoomID      *int64
		Topic       *string
	}
	sessions := []sessionRow{}
	srows, err := s.DB.Pool.Query(ctx, `
		select id, "offeringId", coalesce("sessionNo",0), coalesce("sessionDate",''),
		       coalesce("startTime",''), coalesce("endTime",''), coalesce(status,''),
		       coalesce("isMakeUpSession",0), "replacedSessionId", "roomId", topic
		  from class_sessions where "offeringId" = any($1) order by "sessionNo", id`, offeringIDs)
	if err != nil {
		return nil, err
	}
	for srows.Next() {
		var r sessionRow
		if err := srows.Scan(&r.ID, &r.OfferingID, &r.SessionNo, &r.SessionDate, &r.StartTime,
			&r.EndTime, &r.Status, &r.IsMakeUp, &r.ReplacedID, &r.RoomID, &r.Topic); err == nil {
			sessions = append(sessions, r)
		}
	}
	srows.Close()

	// برنامه‌های هفتگی (CLASS).
	type scheduleInfo struct {
		OfferingID int64
		Day        *int
		Start, End string
		RoomID     *int64
	}
	schedules := []scheduleInfo{}
	wrows, err := s.DB.Pool.Query(ctx, `
		select "offeringId", "dayOfWeek", "startTime"::text, "endTime"::text, "roomId"
		  from schedules where "offeringId" = any($1) and "scheduleType" <> 'EXAM'`, offeringIDs)
	if err == nil {
		for wrows.Next() {
			var si scheduleInfo
			if err := wrows.Scan(&si.OfferingID, &si.Day, &si.Start, &si.End, &si.RoomID); err == nil {
				schedules = append(schedules, si)
			}
		}
		wrows.Close()
	}

	// دانشجویان.
	enrollments := []attendanceEnrollment{}
	erows, err := s.DB.Pool.Query(ctx, `
		select e.id, e."offeringId", e."studentId", st."studentCode",
		       coalesce(u."firstName",''), coalesce(u."lastName",'')
		  from enrollments e
		  join students st on st.id = e."studentId"
		  join users u on u.id = st."userId"
		 where e."offeringId" = any($1) and e.status in ('REGISTERED','PENDING_COUNCIL')`, offeringIDs)
	if err == nil {
		for erows.Next() {
			var en attendanceEnrollment
			if err := erows.Scan(&en.ID, &en.OfferingID, &en.StudentID, &en.StudentCode, &en.FirstName, &en.LastName); err == nil {
				enrollments = append(enrollments, en)
			}
		}
		erows.Close()
	}
	enrollByID := map[int64]attendanceEnrollment{}
	for _, en := range enrollments {
		enrollByID[en.ID] = en
	}

	// حضور دانشجویان.
	sessionIDs := []int64{}
	for _, s := range sessions {
		sessionIDs = append(sessionIDs, s.ID)
	}
	attendance := map[int64]map[int64]string{}
	if len(sessionIDs) > 0 {
		arows, err := s.DB.Pool.Query(ctx, `
			select "sessionId","enrollmentId",status from student_class_attendance where "sessionId" = any($1)`, sessionIDs)
		if err == nil {
			for arows.Next() {
				var sid, enID int64
				var status string
				if err := arows.Scan(&sid, &enID, &status); err == nil {
					en, ok := enrollByID[enID]
					if !ok {
						continue
					}
					if attendance[sid] == nil {
						attendance[sid] = map[int64]string{}
					}
					attendance[sid][en.StudentID] = status
				}
			}
			arows.Close()
		}
	}

	profAttendance := map[int64]ProfessorCheck{}
	if len(sessionIDs) > 0 {
		prows, err := s.DB.Pool.Query(ctx, `
			select "sessionId","verificationMethod","recordedIpAddress","recordedAt"::text
			  from professor_class_attendance where "sessionId" = any($1) and "staffId" = $2`,
			sessionIDs, st.ID)
		if err == nil {
			for prows.Next() {
				var sid int64
				var method string
				var ip, recordedAt *string
				if err := prows.Scan(&sid, &method, &ip, &recordedAt); err == nil {
					profAttendance[sid] = ProfessorCheck{VerificationMethod: method, IPAddress: ip, RecordedAt: recordedAt}
				}
			}
			prows.Close()
		}
	}

	// سالن‌ها.
	roomIDs := []int64{}
	for _, sc := range schedules {
		if sc.RoomID != nil {
			roomIDs = append(roomIDs, *sc.RoomID)
		}
	}
	roomNames := map[int64]string{}
	roomCap := map[int64]int{}
	if len(roomIDs) > 0 {
		rrows, err := s.DB.Pool.Query(ctx, `select id, name, coalesce(capacity,0), coalesce("roomType",'THEORY') from classrooms where id = any($1)`, roomIDs)
		if err == nil {
			for rrows.Next() {
				var id int64
				var name, typ string
				var cap int
				if err := rrows.Scan(&id, &name, &cap, &typ); err == nil {
					roomNames[id] = name
					roomCap[id] = cap
					resp.Rooms = append(resp.Rooms, RoomOption{ID: id, Name: name, Capacity: cap, Type: typ})
				}
			}
			rrows.Close()
		}
	}
	sort.Slice(resp.Rooms, func(i, j int) bool { return resp.Rooms[i].Name < resp.Rooms[j].Name })

	// گروه‌بندی ارائه‌های ادغامی.
	slotsByOffering := map[int64][]slot{}
	for _, sc := range schedules {
		if sc.Day == nil {
			continue
		}
		roomKey := "-"
		if sc.RoomID != nil {
			roomKey = itoa64(*sc.RoomID)
		}
		slotsByOffering[sc.OfferingID] = append(slotsByOffering[sc.OfferingID], slot{Day: sc.Day, Start: sc.Start, End: sc.End, Room: roomKey})
	}
	// گروه‌بندی ساده: کلید ادغام = term|mergedGroupKey.
	type group struct {
		Key     string
		Members []offeringRow
	}
	groups := []group{}
	byKey := map[string]int{}
	for _, o := range myOfferings {
		key := mergedGroupKey(o.SharedKey, slotsByOffering[o.ID])
		if key == "" {
			groups = append(groups, group{Members: []offeringRow{o}})
			continue
		}
		fullKey := itoa64(o.TermID) + "|" + key
		idx, ok := byKey[fullKey]
		if !ok {
			idx = len(groups)
			byKey[fullKey] = idx
			groups = append(groups, group{Key: fullKey})
		}
		groups[idx].Members = append(groups[idx].Members, o)
	}
	memberToPrimary := map[int64]int64{}
	for gi := range groups {
		g := &groups[gi]
		sort.SliceStable(g.Members, func(a, b int) bool { return g.Members[a].ID < g.Members[b].ID })
		primary := g.Members[0].ID
		for _, m := range g.Members {
			memberToPrimary[m.ID] = primary
		}
	}
	if wantedOfferingID != nil {
		if p, ok := memberToPrimary[*wantedOfferingID]; ok {
			resp.DefaultOfferingID = &p
		}
	}

	offeringByID := map[int64]offeringRow{}
	for _, o := range myOfferings {
		offeringByID[o.ID] = o
	}
	enrollByOffering := map[int64][]attendanceEnrollment{}
	for _, en := range enrollments {
		enrollByOffering[en.OfferingID] = append(enrollByOffering[en.OfferingID], en)
	}
	sessionByID := map[int64]sessionRow{}
	for _, sc := range sessions {
		sessionByID[sc.ID] = sc
	}

	for _, g := range groups {
		primary := offeringByID[g.Members[0].ID]
		// جامعهٔ دانشجویان (یکتا).
		students := []AttendanceStudent{}
		seen := map[int64]bool{}
		for _, m := range g.Members {
			for _, en := range enrollByOffering[m.ID] {
				if seen[en.StudentID] {
					continue
				}
				seen[en.StudentID] = true
				students = append(students, AttendanceStudent{
					ID: en.StudentID, StudentCode: en.StudentCode,
					FullName: strings.TrimSpace(en.FirstName + " " + en.LastName),
				})
			}
		}
		sort.SliceStable(students, func(i, j int) bool { return students[i].FullName < students[j].FullName })

		// زمان‌بندی.
		scheduleTime := ""
		hasSchedules := false
		canGenerate := false
		roomName := ""
		for _, m := range g.Members {
			for _, sc := range schedules {
				if sc.OfferingID != m.ID {
					continue
				}
				hasSchedules = true
				if sc.Day != nil {
					canGenerate = true
				}
				if scheduleTime == "" {
					scheduleTime = fmt.Sprintf("%s %s-%s", dayLabel(sc.Day), clock5(sc.Start), clock5(sc.End))
				}
				if sc.RoomID != nil && roomName == "" {
					roomName = roomNames[*sc.RoomID]
				}
			}
		}

		// جلسات گروه (یکتا بر اساس تاریخ/ساعت/جبرانی/جایگزین).
		items := []SessionItem{}
		seenSess := map[string]bool{}
		memberSessions := []sessionRow{}
		for _, m := range g.Members {
			for _, sc := range sessions {
				if sc.OfferingID == m.ID {
					memberSessions = append(memberSessions, sc)
				}
			}
		}
		sort.SliceStable(memberSessions, func(a, b int) bool {
			if memberSessions[a].SessionNo != memberSessions[b].SessionNo {
				return memberSessions[a].SessionNo < memberSessions[b].SessionNo
			}
			return memberSessions[a].ID < memberSessions[b].ID
		})
		for _, sc := range memberSessions {
			replaced := int64(0)
			if sc.ReplacedID != nil {
				replaced = *sc.ReplacedID
			}
			key := fmt.Sprintf("%s|%s|%s|%d|%d", sc.SessionDate, sc.StartTime, sc.EndTime, replaced, sc.IsMakeUp)
			if seenSess[key] {
				continue
			}
			seenSess[key] = true
			statuses := map[int64]StudentStatus{}
			held := false
			if att, ok := attendance[sc.ID]; ok {
				for sid, stt := range att {
					statuses[sid] = StudentStatus{Status: stt}
				}
				if len(att) > 0 {
					held = true
				}
			}
			check, hasProf := profAttendance[sc.ID]
			if hasProf {
				held = true
			}
			replacedNo := (*int)(nil)
			if sc.ReplacedID != nil {
				if prev, ok := sessionByID[*sc.ReplacedID]; ok {
					no := prev.SessionNo
					replacedNo = &no
				}
			}
			topic := ""
			if sc.Topic != nil {
				topic = *sc.Topic
			}
			item := SessionItem{
				ID: sc.ID, SessionNo: sc.SessionNo, SessionDate: sc.SessionDate,
				StartTime: clock5(sc.StartTime), EndTime: clock5(sc.EndTime),
				RoomName: roomName, Topic: topic, IsHeld: held,
				IsMakeUp: sc.IsMakeUp != 0, ReplacedSessionNo: replacedNo,
				ProfessorStatus: "UPCOMING", VerificationDetail: "جلسه در انتظار برگزاری/ثبت",
				StudentStatuses: statuses,
			}
			if hasProf {
				item.ProfessorStatus = "VERIFIED_PRESENT"
				item.VerificationDetail = "حضور استاد در این جلسه ثبت شده است."
				pc := check
				item.ProfessorCheck = &pc
			}
			items = append(items, item)
		}
		sort.SliceStable(items, func(i, j int) bool {
			if items[i].SessionNo != items[j].SessionNo {
				return items[i].SessionNo < items[j].SessionNo
			}
			return items[i].ID < items[j].ID
		})

		codes := []string{}
		for _, m := range g.Members {
			codes = append(codes, m.Code)
		}
		title := primary.Title
		if len(g.Members) > 1 {
			title = mergedDisplayTitle(primary.Title, codes)
		}
		maxUnits := 0.0
		for _, m := range g.Members {
			if m.Units > maxUnits {
				maxUnits = m.Units
			}
		}
		resp.Offerings = append(resp.Offerings, AttendanceOffering{
			ID: primary.ID, Code: strings.Join(uniqueStrings(codes), " / "), Title: title,
			GroupNumber: primary.Group, Units: maxUnits, RoomName: roomName,
			ScheduleTime: scheduleTime, HasSchedules: hasSchedules, CanGenerate: canGenerate,
			Merged: len(g.Members) > 1, MemberCount: len(g.Members),
			Students: students, Sessions: items,
		})
	}

	// تاریخچهٔ جلسات جبرانی.
	for _, sc := range sessions {
		if sc.IsMakeUp == 0 {
			continue
		}
		o, ok := offeringByID[sc.OfferingID]
		if !ok {
			continue
		}
		replacedNo := 0
		if sc.ReplacedID != nil {
			if prev, ok := sessionByID[*sc.ReplacedID]; ok {
				replacedNo = prev.SessionNo
			}
		}
		reason := "ثبت مستقیم توسط استاد"
		switch sc.Status {
		case "PROPOSED":
			reason = "در انتظار تأیید اداره آموزش"
		case "REJECTED":
			reason = "ردشده"
		}
		topic := ""
		if sc.Topic != nil {
			topic = *sc.Topic
		}
		room := ""
		if sc.RoomID != nil {
			room = roomNames[*sc.RoomID]
		}
		resp.MakeupHistory = append(resp.MakeupHistory, MakeupRecord{
			ID: sc.ID, OfferingID: sc.OfferingID, CourseTitle: o.Title, GroupNumber: o.Group,
			ProfessorName: st.Name, ReplacedSessionNo: replacedNo, SessionDate: sc.SessionDate,
			SessionTime: clock5(sc.StartTime) + " الی " + clock5(sc.EndTime), RoomName: room,
			Topic: topic, Reason: reason, Status: sc.Status, AllocatedAt: resp.TodayJalali,
		})
	}
	return resp, nil
}

func dayLabel(day *int) string {
	if day == nil || *day < 0 || *day >= len(dayNames) {
		return "روز نامشخص"
	}
	return dayNames[*day]
}

func jalaliToday() string {
	d := jalali.ToJalaliFromTime(time.Now())
	return jalali.FaDigits(fmt.Sprintf("%04d/%02d/%02d", d.Y, d.M, d.D))
}

// GenerateResult نتیجهٔ تولید جلسات.
type GenerateResult struct {
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
	Generated int    `json:"generated"`
	Skipped   int    `json:"skipped"`
	Already   bool   `json:"already,omitempty"`
	Offerings int    `json:"offerings"`
}

// GenerateSessions تولید جلسات هفتگی یک ارائه از برنامهٔ CLASS.
func (s *Service) GenerateSessions(ctx context.Context, userID, offeringID int64) GenerateResult {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return GenerateResult{Error: "پروندهٔ هیئت علمی یافت نشد."}
	}
	var (
		termID      int64
		professorID *int64
	)
	if err := s.DB.Pool.QueryRow(ctx, `
		select "termId", "professorId" from course_offerings where id = $1`, offeringID).
		Scan(&termID, &professorID); err != nil {
		return GenerateResult{Error: "درس یافت نشد."}
	}
	owned := professorID != nil && *professorID == st.ID
	if !owned {
		var one int
		if err := s.DB.Pool.QueryRow(ctx, `
			select 1 from offering_professors where "offeringId" = $1 and "staffId" = $2 limit 1`,
			offeringID, st.ID).Scan(&one); err == nil {
			owned = true
		}
	}
	if !owned {
		return GenerateResult{Error: "شما استاد این درس نیستید."}
	}

	// بازهٔ ترم.
	var start time.Time
	var classStart, classEnd *time.Time
	if err := s.DB.Pool.QueryRow(ctx, `
		select "startDate", "classStartDate", "classEndDate" from academic_terms where id = $1`, termID).
		Scan(&start, &classStart, &classEnd); err != nil || start.IsZero() {
		return GenerateResult{Error: "تاریخ شروع نیمسال ثبت نشده است؛ ابتدا تقویم ترم را تعریف کنید."}
	}

	// برنامه‌های کلاس.
	srows, err := s.DB.Pool.Query(ctx, `
		select "dayOfWeek", "startTime"::text, "endTime"::text, coalesce("scheduleType",'CLASS')
		  from schedules where "offeringId" = $1 and "scheduleType" <> 'EXAM' order by "dayOfWeek"`, offeringID)
	if err != nil {
		return GenerateResult{Error: "خطای داخلی سرور."}
	}
	type slotRow struct{ day, start, end, recurrence string }
	slots := []slotRow{}
	for srows.Next() {
		var day *int
		var startT, endT, recurrence string
		if err := srows.Scan(&day, &startT, &endT, &recurrence); err == nil {
			if day == nil {
				continue
			}
			rec := strings.ToUpper(recurrence)
			if rec != "EVEN" && rec != "ODD" {
				rec = "ALL"
			}
			slots = append(slots, slotRow{day: itoa64(int64(*day)), start: clock5(startT), end: clock5(endT), recurrence: rec})
		}
	}
	srows.Close()
	if len(slots) == 0 {
		return GenerateResult{Error: "برای این درس زمان‌بندی هفتگی (CLASS) ثبت نشده است؛ با ادارهٔ آموزش هماهنگ کنید."}
	}

	// اگر جلسهٔ غیرجبرانی وجود دارد → already.
	var regular int
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*) from class_sessions where "offeringId" = $1 and coalesce("isMakeUpSession",0) = 0`, offeringID).Scan(&regular)
	if regular > 0 {
		return GenerateResult{OK: true, Already: true}
	}

	generated := 0
	skipped := 0
	for _, sl := range slots {
		dayInt := 0
		fmt.Sscanf(sl.day, "%d", &dayInt)
		dates, err := scheduling.ComputeSessionDates(scheduling.SessionDateInput{
			TermStart: start, ClassStartDate: classStart, ClassEndDate: classEnd,
			DayOfWeek: dayInt, SessionsCount: 16, Recurrence: sl.recurrence,
		})
		if err != nil {
			skipped++
			continue
		}
		for _, d := range dates {
			var exists int
			_ = s.DB.Pool.QueryRow(ctx, `
				select 1 from class_sessions where "offeringId" = $1 and "sessionNo" = $2 limit 1`,
				offeringID, d.SessionNo).Scan(&exists)
			if exists == 1 {
				skipped++
				continue
			}
			_, err := s.DB.Pool.Exec(ctx, `
				insert into class_sessions ("offeringId","sessionDate","startTime","endTime",status,"sessionNo","isMakeUpSession")
				values ($1,$2,$3,$4,'SCHEDULED',$5,0)`,
				offeringID, d.JalaliDate, sl.start, sl.end, d.SessionNo)
			if err == nil {
				generated++
			}
		}
	}
	return GenerateResult{OK: true, Generated: generated, Skipped: skipped, Offerings: 1}
}

// AttendanceEntry ردیف حضور.
type AttendanceEntry struct {
	StudentID   int64  `json:"studentId"`
	Status      string `json:"status"`
	LateMinutes *int   `json:"lateMinutes,omitempty"`
}

// SaveSessionAttendance پورت saveSessionAttendanceAction.
func (s *Service) SaveSessionAttendance(ctx context.Context, userID, sessionID int64, entries []AttendanceEntry) (int, int, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return 0, 0, errNoStaff
	}
	var (
		offeringID   int64
		sessionDate  string
		startT, endT string
	)
	if err := s.DB.Pool.QueryRow(ctx, `
		select "offeringId", coalesce("sessionDate",''), coalesce("startTime",''), coalesce("endTime",'')
		  from class_sessions where id = $1`, sessionID).
		Scan(&offeringID, &sessionDate, &startT, &endT); err != nil {
		return 0, 0, errors.New("جلسه یافت نشد.")
	}
	var professorID *int64
	_ = s.DB.Pool.QueryRow(ctx, `select "professorId" from course_offerings where id = $1`, offeringID).Scan(&professorID)
	owned := professorID != nil && *professorID == st.ID
	if !owned {
		var one int
		if err := s.DB.Pool.QueryRow(ctx, `
			select 1 from offering_professors where "offeringId" = $1 and "staffId" = $2 limit 1`,
			offeringID, st.ID).Scan(&one); err == nil {
			owned = true
		}
	}
	if !owned {
		return 0, 0, errors.New("شما استاد این درس نیستید.")
	}

	valid := []AttendanceEntry{}
	for _, e := range entries {
		if e.StudentID <= 0 {
			continue
		}
		switch e.Status {
		case "PRESENT", "LATE", "ABSENT", "EXCUSED":
			valid = append(valid, e)
		}
	}
	if len(valid) == 0 {
		return 0, 0, errors.New("ردیف حضوری برای ذخیره وجود ندارد.")
	}

	// گسترش به کلاس ادغامی: همان کلید دستی + همان تاریخ/ساعت.
	groupKey := ""
	_ = s.DB.Pool.QueryRow(ctx, `select coalesce("sharedScheduleGroupKey",'') from course_offerings where id = $1`, offeringID).Scan(&groupKey)
	groupKey = strings.TrimSpace(groupKey)
	targets := map[int64]int64{sessionID: offeringID}
	if groupKey != "" && !strings.HasPrefix(groupKey, "SOLO-") {
		rows, err := s.DB.Pool.Query(ctx, `
			select cs.id, cs."offeringId"
			  from class_sessions cs
			  join course_offerings o on o.id = cs."offeringId"
			 where o."sharedScheduleGroupKey" = $1 and cs."sessionDate" = $2
			   and cs."startTime" = $3 and cs."endTime" = $4 and coalesce(cs."isActive",1) = 1`,
			groupKey, sessionDate, startT, endT)
		if err == nil {
			for rows.Next() {
				var sid, oid int64
				if err := rows.Scan(&sid, &oid); err == nil {
					targets[sid] = oid
				}
			}
			rows.Close()
		}
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	inserted := 0
	for sid, oid := range targets {
		studentIDs := []int64{}
		for _, e := range valid {
			studentIDs = append(studentIDs, e.StudentID)
		}
		enRows, err := tx.Query(ctx, `
			select id, "studentId" from enrollments where "offeringId" = $1 and "studentId" = any($2)`, oid, studentIDs)
		if err != nil {
			return 0, 0, err
		}
		enrollmentByStudent := map[int64]int64{}
		for enRows.Next() {
			var enID, sidStudent int64
			if err := enRows.Scan(&enID, &sidStudent); err == nil {
				enrollmentByStudent[sidStudent] = enID
			}
		}
		enRows.Close()
		if _, err := tx.Exec(ctx, `delete from student_class_attendance where "sessionId" = $1`, sid); err != nil {
			return 0, 0, err
		}
		for _, e := range valid {
			enID, ok := enrollmentByStudent[e.StudentID]
			if !ok {
				continue
			}
			if _, err := tx.Exec(ctx, `
				insert into student_class_attendance ("sessionId","enrollmentId",status)
				values ($1,$2,$3)`, sid, enID, e.Status); err != nil {
				return 0, 0, err
			}
			inserted++
		}
		if _, err := tx.Exec(ctx, `
			delete from professor_class_attendance where "sessionId" = $1 and "staffId" = $2`, sid, st.ID); err != nil {
			return 0, 0, err
		}
		if _, err := tx.Exec(ctx, `
			insert into professor_class_attendance ("sessionId","staffId","verificationMethod",status,"recordedAt")
			values ($1,$2,'MANUAL_ATTENDANCE_SHEET','VALID',now())`, sid, st.ID); err != nil {
			return 0, 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return inserted, len(targets), nil
}

// MakeupInput ورودی جلسهٔ جبرانی.
type MakeupInput struct {
	OfferingID        int64  `json:"offeringId"`
	ReplacedSessionID *int64 `json:"replacedSessionId"`
	SessionDate       string `json:"sessionDate"`
	StartTime         string `json:"startTime"`
	EndTime           string `json:"endTime"`
	RoomName          string `json:"roomName"`
	IsDirect          bool   `json:"isDirect"`
	Topic             string `json:"topic"`
	AbsenceReason     string `json:"absenceReason"`
}

// ScheduleMakeup پورت scheduleMakeupSessionAction.
func (s *Service) ScheduleMakeup(ctx context.Context, userID int64, input MakeupInput) (int64, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return 0, errNoStaff
	}
	var professorID *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "professorId" from course_offerings where id = $1`, input.OfferingID).
		Scan(&professorID); err != nil || professorID == nil || *professorID != st.ID {
		return 0, errors.New("شما استاد این درس نیستید.")
	}
	input.SessionDate = faToEn(input.SessionDate)
	input.StartTime = faToEn(input.StartTime)
	input.EndTime = faToEn(input.EndTime)
	if strings.TrimSpace(input.SessionDate) == "" || strings.TrimSpace(input.StartTime) == "" || strings.TrimSpace(input.EndTime) == "" {
		return 0, errors.New("تاریخ و ساعت جلسه را کامل وارد کنید.")
	}
	var roomID *int64
	if strings.TrimSpace(input.RoomName) != "" {
		var id int64
		if err := s.DB.Pool.QueryRow(ctx, `select id from classrooms where name = $1 limit 1`, input.RoomName).Scan(&id); err == nil {
			roomID = &id
		}
	}
	var maxNo int
	_ = s.DB.Pool.QueryRow(ctx, `select coalesce(max("sessionNo"),0) from class_sessions where "offeringId" = $1`, input.OfferingID).Scan(&maxNo)
	status := "PROPOSED"
	if input.IsDirect {
		status = "SCHEDULED"
	}
	topic := strings.TrimSpace(input.Topic)
	var topicVal *string
	if topic != "" {
		t := topic
		if len([]rune(t)) > 300 {
			r := []rune(t)
			t = string(r[:300])
		}
		topicVal = &t
	}
	var reason *string
	if strings.TrimSpace(input.AbsenceReason) != "" {
		r := strings.TrimSpace(input.AbsenceReason)
		reason = &r
	}
	var id int64
	err = s.DB.Pool.QueryRow(ctx, `
		insert into class_sessions ("offeringId","sessionDate","startTime","endTime",status,
		       "isMakeUpSession","replacedSessionId","sessionNo","roomId",topic,"absenceReason")
		values ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10) returning id`,
		input.OfferingID, input.SessionDate, input.StartTime, input.EndTime, status,
		input.ReplacedSessionID, maxNo+1, roomID, topicVal, reason).Scan(&id)
	if err != nil {
		return 0, errors.New("خطا در ثبت جلسهٔ جبرانی.")
	}
	return id, nil
}

func faToEn(v string) string {
	out := []rune(v)
	for i, r := range out {
		if r >= '۰' && r <= '۹' {
			out[i] = '0' + (r - '۰')
		} else if r >= '٠' && r <= '٩' {
			out[i] = '0' + (r - '٠')
		}
	}
	return string(out)
}
