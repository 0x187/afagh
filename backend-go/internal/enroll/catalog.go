// ═══ Enrollment page data — port of student/enroll/page.tsx ═══
package enroll

import (
	"context"
	"strings"

	"backend-go/internal/scope"
	"backend-go/internal/tuition"
)

// ClassSlot is a weekly session.
type ClassSlot struct {
	DayOfWeek *int   `json:"dayOfWeek"`
	DayName   string `json:"dayName"`
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime"`
	Room      string `json:"room"`
	Building  string `json:"building"`
}

// ExamSlot is the exam time.
type ExamSlot struct {
	ExamDate  string `json:"examDate"`
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime"`
}

// OfferingOfferable is a catalog offering.
type OfferingOfferable struct {
	ID               int64       `json:"id"`
	CourseID         int64       `json:"courseId"`
	Code             string      `json:"code"`
	Title            string      `json:"title"`
	Units            float64     `json:"units"`
	Capacity         int         `json:"capacity"`
	WaitlistCapacity int         `json:"waitlistCapacity"`
	Enrolled         int         `json:"enrolled"`
	Group            int         `json:"group"`
	Professor        string      `json:"professor"`
	OfferingType     string      `json:"offeringType"`
	Prereq           *string     `json:"prereq"`
	PrereqMet        bool        `json:"prereqMet"`
	ClassSchedules   []ClassSlot `json:"classSchedules"`
	ExamSchedule     *ExamSlot   `json:"examSchedule"`
	TuitionFixed     float64     `json:"tuitionFixed"`
	TuitionVariable  float64     `json:"tuitionVariable"`
	TuitionPerUnit   float64     `json:"tuitionPerUnit"`
	TuitionTotal     float64     `json:"tuitionTotal"`
}

// CartItem is a cart row.
type CartItem struct {
	ID             int64       `json:"id"`
	CourseID       int64       `json:"courseId"`
	Code           string      `json:"code"`
	Title          string      `json:"title"`
	Units          float64     `json:"units"`
	Group          int         `json:"group"`
	ClassSchedules []ClassSlot `json:"classSchedules"`
	ExamSchedule   *ExamSlot   `json:"examSchedule"`
}

// BypassRequest is an open request without restriction.
type BypassRequest struct {
	ID          int64  `json:"id"`
	OfferingID  int64  `json:"offeringId"`
	Kind        string `json:"kind"`
	Status      string `json:"status"`
	CourseTitle string `json:"courseTitle"`
}

// TermInfo is term info for the page.
type TermInfo struct {
	ID             *int64  `json:"id"`
	Title          string  `json:"title"`
	TermCode       string  `json:"termCode"`
	Open           bool    `json:"open"`
	IsSummer       bool    `json:"isSummer"`
	AddDropEnd     *string `json:"addDropEndDate"`
	EnrollmentOpen bool    `json:"enrollmentFlag"`
}

// RegulationStatus is the regulation summary for the UI.
type RegulationStatus struct {
	EffectiveMaxUnits float64 `json:"effectiveMaxUnits"`
	MinAllowedUnits   float64 `json:"minAllowedUnits"`
	PassedUnits       float64 `json:"passedUnits"`
	RemainingUnits    float64 `json:"remainingUnits"`
	IsGraduating      bool    `json:"isGraduating"`
	IsHonors          bool    `json:"isHonors"`
	IsProbated        bool    `json:"isProbatedLastTerm"`
	TotalProbations   int     `json:"totalProbations"`
	IsSummer          bool    `json:"isSummer"`
}

// EnrollPageResponse is the full page response.
type EnrollPageResponse struct {
	Student             StudentLite         `json:"student"`
	Term                TermInfo            `json:"term"`
	Offerings           []OfferingOfferable `json:"offerings"`
	Cart                []CartItem          `json:"cart"`
	EnrolledOfferingIDs []int64             `json:"enrolledOfferingIds"`
	CartStartedAt       *int64              `json:"cartStartedAt"`
	Regulation          *RegulationStatus   `json:"regulationStatus"`
	BypassRequests      []BypassRequest     `json:"bypassRequests"`
	EnrollmentOpen      bool                `json:"enrollmentOpen"`
	EmergencyWithdraw   bool                `json:"emergencyWithdrawOpen"`
	DegreeTitle         string              `json:"degreeLevelTitle"`
	CurriculumScoped    bool                `json:"curriculumScoped"`
	CurriculumRequired  bool                `json:"curriculumRequired"`
	CurriculumReason    string              `json:"curriculumReason"`
	CurriculumVersion   *string             `json:"curriculumVersionLabel"`
	StudentTermOrdinal  *int                `json:"studentTermOrdinal"`
	SajjadPortalURL     string              `json:"sajjadPortalUrl"`
}

// StudentLite is minimal student info.
type StudentLite struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

type studentRow struct {
	ID            int64
	StudentCode   string
	UniversityID  *int64
	MajorID       *int64
	DegreeLevelID *int64
	RegulationID  *int64
	EntryYear     int
	EntryTerm     *int
	Status        string
}

func (s *Service) loadStudent(ctx context.Context, userID int64) (*studentRow, error) {
	var r studentRow
	err := s.DB.Pool.QueryRow(ctx, `
		select id, "studentCode", "universityId", "majorId", "degreeLevelId",
		       "regulationId", "entryYear", "entryTerm", status
		  from students where "userId" = $1
		 order by case when status = 'ACTIVE' then 0 else 1 end, id desc limit 1`, userID).
		Scan(&r.ID, &r.StudentCode, &r.UniversityID, &r.MajorID, &r.DegreeLevelID,
			&r.RegulationID, &r.EntryYear, &r.EntryTerm, &r.Status)
	return &r, err
}

var dayNames = []string{"شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"}

func dayName(d *int) string {
	if d == nil {
		return ""
	}
	if *d >= 0 && *d < len(dayNames) {
		return dayNames[*d]
	}
	return "روز دیگر"
}

// GetEnrollPage returns complete enrollment page data.
func (s *Service) GetEnrollPage(ctx context.Context, userID int64, userName string, termCookie *int64) (*EnrollPageResponse, error) {
	me, err := s.loadStudent(ctx, userID)
	if err != nil {
		return nil, err
	}

	selection := s.Scope.GetTermScope(ctx, me.UniversityID, termCookie)
	termID := selection.EffectiveID
	if selection.SelectedID != nil {
		termID = selection.SelectedID
	}

	// term.
	resp := &EnrollPageResponse{
		Student:             StudentLite{ID: me.ID, Name: userName, Status: me.Status},
		Offerings:           []OfferingOfferable{},
		Cart:                []CartItem{},
		EnrolledOfferingIDs: []int64{},
		BypassRequests:      []BypassRequest{},
	}
	var (
		termTitle        string
		termCode         string
		termType         *string
		termIsOpen       int
		termIsSummer     int
		addDropEnd       *string
		termUniversityID *int64
	)
	if termID != nil {
		_ = s.DB.Pool.QueryRow(ctx, `
			select title, "termCode", "termType", coalesce("isEnrollmentOpen",0),
			       coalesce("isSummer",0), "addDropEndDate"::text, "universityId"
			  from academic_terms where id = $1`, *termID).
			Scan(&termTitle, &termCode, &termType, &termIsOpen, &termIsSummer, &addDropEnd, &termUniversityID)
	}
	_ = termUniversityID
	resp.Term = TermInfo{
		ID: termID, Title: termTitle, TermCode: termCode,
		IsSummer: termIsSummer != 0, AddDropEnd: addDropEnd, EnrollmentOpen: termIsOpen != 0,
	}

	windowFlag := s.Settings.GetBool(ctx, "ENROLLMENT_WINDOW_OPEN")
	addDropTimeOpen := true
	if addDropEnd != nil && strings.TrimSpace(*addDropEnd) != "" {
		addDropTimeOpen = *addDropEnd >= nowDateString()
	}
	resp.EnrollmentOpen = termIsOpen != 0 && windowFlag && addDropTimeOpen
	resp.EmergencyWithdraw = s.Settings.GetBool(ctx, "EMERGENCY_WITHDRAW_OPEN")
	if v, err := s.Settings.Get(ctx, "SAJJAD_PORTAL_URL"); err == nil {
		resp.SajjadPortalURL = strings.TrimSpace(v)
	}

	// level + faculty.
	if me.DegreeLevelID != nil {
		_ = s.DB.Pool.QueryRow(ctx, `select title from degree_level_configs where id = $1`, *me.DegreeLevelID).Scan(&resp.DegreeTitle)
	}
	var facultyID *int64
	if me.MajorID != nil {
		_ = s.DB.Pool.QueryRow(ctx, `select "facultyId" from majors where id = $1`, *me.MajorID).Scan(&facultyID)
	}

	// regulation.
	if summary, err := EvaluateStudentRegulationStatus(ctx, s.DB.Pool, me.ID, termID); err == nil {
		resp.Regulation = &RegulationStatus{
			EffectiveMaxUnits: summary.EffectiveMaxUnits,
			MinAllowedUnits:   summary.MinAllowedUnits,
			PassedUnits:       summary.PassedUnits,
			RemainingUnits:    summary.RemainingUnits,
			IsGraduating:      summary.IsGraduating,
			IsHonors:          summary.IsHonors,
			IsProbated:        summary.IsProbatedLastTerm,
			TotalProbations:   summary.TotalProbations,
			IsSummer:          summary.IsSummer,
		}
	}

	if termID == nil || me.UniversityID == nil {
		return resp, nil
	}

	// ── raw offerings of the term/university ──
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, o."courseId", c.code, c.title, c.units, o.capacity, o."enrolledCount",
		       coalesce(o."groupNumber",0), o."professorId", o."offeringType", coalesce(o."waitlistCapacity",0),
		       o."targetDegreeLevelId", o."targetMajorId", o."entryYearStart", o."entryYearEnd"
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		 where o."termId" = $1 and o."isActive" = 1 and o."universityId" = $2
		 order by c.title, coalesce(o."groupNumber",0)`, *termID, *me.UniversityID)
	if err != nil {
		return nil, err
	}
	raw := []rawOffering{}
	for rows.Next() {
		var o rawOffering
		if err := rows.Scan(&o.ID, &o.CourseID, &o.Code, &o.Title, &o.Units, &o.Capacity, &o.Enrolled,
			&o.Group, &o.ProfessorID, &o.OfferingType, &o.WaitlistCapacity, &o.TargetDegreeLevelID, &o.TargetMajorID,
			&o.EntryYearStart, &o.EntryYearEnd); err != nil {
			rows.Close()
			return nil, err
		}
		raw = append(raw, o)
	}
	rows.Close()

	studentScope := StudentScope{DegreeLevelID: me.DegreeLevelID, MajorID: me.MajorID, EntryYear: me.EntryYear}
	visible := []rawOffering{}
	for _, o := range raw {
		if OfferingVisible(Targeting{
			TargetDegreeLevelID: o.TargetDegreeLevelID, TargetMajorID: o.TargetMajorID,
			EntryYearStart: o.EntryYearStart, EntryYearEnd: o.EntryYearEnd,
		}, studentScope) {
			visible = append(visible, o)
		}
	}

	// ── academic chart ──
	cscope := s.resolveCurriculumScope(ctx, me.ID)
	resp.CurriculumScoped = cscope.Resolved
	resp.CurriculumReason = cscope.Reason
	resp.CurriculumVersion = cscope.VersionCode
	resp.CurriculumRequired = s.Settings.GetBool(ctx, "ENROLL_REQUIRE_CURRICULUM_CHART")
	resp.StudentTermOrdinal = scope.TermOrdinalForEntry(&me.EntryYear, me.EntryTerm, termCode)

	// Failed courses for retake (from all records).
	retakeIDs := s.retakeCourseIDs(ctx, me.ID)
	scoped := scopeOfferingsByCurriculum(visible, cscope, resp.StudentTermOrdinal, retakeIDs, resp.CurriculumRequired)

	// ── sessions, professors, prerequisites ──
	offeringIDs := []int64{}
	for _, o := range raw {
		offeringIDs = append(offeringIDs, o.ID)
	}
	classMap := map[int64][]ClassSlot{}
	examMap := map[int64]*ExamSlot{}
	if len(offeringIDs) > 0 {
		srows, err := s.DB.Pool.Query(ctx, `
			select sc."offeringId", sc."scheduleType", sc."dayOfWeek", sc."examDate"::text,
			       sc."startTime"::text, sc."endTime"::text, cr.name, cr."buildingName"
			  from schedules sc left join classrooms cr on cr.id = sc."roomId"
			 where sc."offeringId" = any($1)`, offeringIDs)
		if err == nil {
			for srows.Next() {
				var (
					oid                  int64
					scheduleType         string
					dayOfWeek            *int
					examDate, start, end *string
					room, building       *string
				)
				if err := srows.Scan(&oid, &scheduleType, &dayOfWeek, &examDate, &start, &end, &room, &building); err != nil {
					continue
				}
				st, et := "", ""
				if start != nil {
					st = clock5(*start)
				}
				if end != nil {
					et = clock5(*end)
				}
				if strings.ToUpper(scheduleType) == "EXAM" {
					if examDate != nil {
						examMap[oid] = &ExamSlot{ExamDate: *examDate, StartTime: st, EndTime: et}
					}
					continue
				}
				roomName, buildingName := "", ""
				if room != nil {
					roomName = *room
				}
				if building != nil {
					buildingName = *building
				}
				classMap[oid] = append(classMap[oid], ClassSlot{
					DayOfWeek: dayOfWeek, DayName: dayName(dayOfWeek),
					StartTime: st, EndTime: et, Room: roomName, Building: buildingName,
				})
			}
			srows.Close()
		}
	}

	profNames := s.loadProfessorNames(ctx, scoped)
	prereq, _ := BuildPrereqContext(ctx, s.DB.Pool, me.ID)

	// ── tuition ──
	tuitionRules, currentFinTerm := s.loadTuitionRules(ctx, me.UniversityID)
	termTypeStr := "NORMAL"
	if termType != nil {
		termTypeStr = *termType
	}
	tctx := tuition.Context{
		DegreeLevelID: me.DegreeLevelID, MajorID: me.MajorID, FacultyID: facultyID,
		EntryYear: &me.EntryYear, TermType: &termTypeStr, ClinicalPhase: strPtr("NORMAL"),
		CurrentTermID: currentFinTerm, UniversityID: me.UniversityID,
	}

	for _, o := range scoped {
		item := OfferingOfferable{
			ID: o.ID, CourseID: o.CourseID, Code: o.Code, Title: o.Title, Units: o.Units,
			Capacity: o.Capacity, WaitlistCapacity: o.WaitlistCapacity, Enrolled: o.Enrolled, Group: o.Group,
			Professor: "نامشخص", PrereqMet: true,
			ClassSchedules: classMap[o.ID], ExamSchedule: examMap[o.ID],
		}
		if item.ClassSchedules == nil {
			item.ClassSchedules = []ClassSlot{}
		}
		if o.ProfessorID != nil {
			if n, ok := profNames[*o.ProfessorID]; ok && n != "" {
				item.Professor = n
			}
		}
		offType := "NORMAL"
		if o.OfferingType != nil && strings.TrimSpace(*o.OfferingType) != "" {
			offType = *o.OfferingType
		}
		item.OfferingType = offType
		if prereq != nil {
			if rule := prereq.RuleByCourse[o.CourseID]; rule != nil {
				if label := FormatPrereq(rule, prereq.Titles); label != "" {
					item.Prereq = &label
				}
				ok, _ := EvaluateLogicTree(rule, prereq.Passed)
				item.PrereqMet = ok
			}
		}
		ctx2 := tctx
		ctx2.OfferingType = &offType
		if rule := tuition.Resolve(tuitionRules, ctx2); rule != nil {
			rates := tuition.RatesOf(*rule)
			perUnit := rates.Theory
			fixed := rates.Fixed
			item.TuitionFixed = fixed
			item.TuitionPerUnit = perUnit
			item.TuitionVariable = perUnit * o.Units
			item.TuitionTotal = fixed + item.TuitionVariable
		}
		resp.Offerings = append(resp.Offerings, item)
	}

	// ── cart ──
	resp.Cart = s.loadCart(ctx, me.ID, classMap, examMap)
	resp.CartStartedAt = s.cartStartedAt(ctx, me.ID)
	resp.EnrolledOfferingIDs = s.enrolledOfferingIDs(ctx, me.ID, *termID)
	resp.BypassRequests = s.loadBypassRequests(ctx, me.ID)

	return resp, nil
}

func strPtr(v string) *string { return &v }

// rawOffering raw offering for catalog filtering.
type rawOffering struct {
	ID                  int64
	CourseID            int64
	Code                string
	Title               string
	Units               float64
	Capacity            int
	WaitlistCapacity    int
	Enrolled            int
	Group               int
	ProfessorID         *int64
	OfferingType        *string
	TargetDegreeLevelID *int64
	TargetMajorID       *int64
	EntryYearStart      *int
	EntryYearEnd        *int
}
