// ═══ Professor dashboard — port of professor/page.tsx ═══
package professor

import (
	"context"
	"sort"
	"strings"
)

// ProfessorInfo professor display info.
type ProfessorInfo struct {
	ID              int64   `json:"id"`
	Name            string  `json:"name"`
	StaffCode       string  `json:"staffCode"`
	AcademicRank    *string `json:"academicRank"`
	ContractType    *string `json:"contractType"`
	DepartmentName  *string `json:"departmentName"`
	UniversityTitle string  `json:"universityTitle"`
	UniversityLogo  *string `json:"universityLogo"`
}

// UniversityInfo title/logo.
type UniversityInfo struct {
	Title   string  `json:"title"`
	LogoURL *string `json:"logoUrl"`
}

// LiveSession the professor's virtual class session.
type LiveSession struct {
	ID              int64  `json:"id"`
	CourseTitle     string `json:"courseTitle"`
	MeetingID       string `json:"meetingId"`
	IsRunning       bool   `json:"isRunning"`
	Attendance      int    `json:"activeParticipantsCount"`
	RecordingsCount int    `json:"recordingsCount"`
	StartTime       string `json:"startTime"`
	EndTime         string `json:"endTime"`
}

// ClassCard dashboard class card.
type ClassCard struct {
	Key           string   `json:"key"`
	OfferingID    int64    `json:"offeringId"`
	Title         string   `json:"title"`
	Code          string   `json:"code"`
	Group         int      `json:"group"`
	Units         float64  `json:"units"`
	RoomLine      string   `json:"roomLine"`
	TimeLine      string   `json:"timeLine"`
	Enrolled      int      `json:"enrolled"`
	Capacity      int      `json:"capacity"`
	IsCoTaught    bool     `json:"isCoTaught"`
	CoTeacherName *string  `json:"coTeacherName"`
	IsMerged      bool     `json:"isMerged"`
	MergedCodes   []string `json:"mergedCodes"`
}

// DashboardStats status bar.
type DashboardStats struct {
	ClassCount        int     `json:"classCount"`
	AvailabilityCount int     `json:"availabilityCount"`
	ContractStatus    string  `json:"contractStatus"`
	GradeDeadline     *string `json:"gradeDeadline"`
}

// Dashboard the dashboard response.
type Dashboard struct {
	Professor    ProfessorInfo  `json:"professor"`
	Term         TermInfo       `json:"term"`
	University   UniversityInfo `json:"university"`
	Stats        DashboardStats `json:"stats"`
	Cards        []ClassCard    `json:"cards"`
	WeekRows     []ScheduleRow  `json:"weekRows"`
	LiveSessions []LiveSession  `json:"liveSessions"`
	VCConfigured bool           `json:"vcConfigured"`
}

type slot struct {
	Day   *int
	Start string
	End   string
	Room  string
}

func normMergeTime(v string) string {
	if len(v) >= 5 {
		return v[:5]
	}
	return v
}

func mergedGroupKey(shared *string, slots []slot) string {
	if shared != nil && strings.TrimSpace(*shared) != "" {
		return "K:" + strings.TrimSpace(*shared)
	}
	parts := []string{}
	seen := map[string]bool{}
	for _, sl := range slots {
		if sl.Day == nil || normMergeTime(sl.Start) == "" || normMergeTime(sl.End) == "" {
			continue
		}
		room := sl.Room
		if room == "" {
			room = "-"
		}
		p := itoa64(int64(*sl.Day)) + "|" + normMergeTime(sl.Start) + "|" + normMergeTime(sl.End) + "|" + room
		if !seen[p] {
			seen[p] = true
			parts = append(parts, p)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	sort.Strings(parts)
	return "S:" + strings.Join(parts, ";")
}

func mergedDisplayTitle(primary string, codes []string) string {
	uniq := []string{}
	seen := map[string]bool{}
	for _, c := range codes {
		if c != "" && !seen[c] {
			seen[c] = true
			uniq = append(uniq, c)
		}
	}
	return primary + " (کلاس ادغامی: " + strings.Join(uniq, "، ") + ")"
}

type mergedGroup struct {
	Key       string
	Merged    bool
	PrimaryID int64
	Members   []ScheduleRow
}

func groupIntoMerged(rows []ScheduleRow, keyOf func(ScheduleRow) string) []mergedGroup {
	groups := []mergedGroup{}
	byKey := map[string]int{}
	for _, r := range rows {
		k := keyOf(r)
		if k == "" {
			groups = append(groups, mergedGroup{Key: "", Merged: false, PrimaryID: r.ID, Members: []ScheduleRow{r}})
			continue
		}
		idx, ok := byKey[k]
		if !ok {
			idx = len(groups)
			byKey[k] = idx
			groups = append(groups, mergedGroup{Key: k, PrimaryID: r.ID})
		}
		groups[idx].Members = append(groups[idx].Members, r)
	}
	for i := range groups {
		g := &groups[i]
		if len(g.Members) > 1 {
			g.Merged = true
			sort.SliceStable(g.Members, func(a, b int) bool { return g.Members[a].ID < g.Members[b].ID })
			g.PrimaryID = g.Members[0].ID
		}
	}
	return groups
}

// GetDashboard port of ProfessorHome.
func (s *Service) GetDashboard(ctx context.Context, userID int64, cookie *int64) (*Dashboard, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, errNoStaff
	}
	uniID := st.UniversityID
	term := s.ResolveTerm(ctx, uniID, cookie)
	if term.ID == nil {
		return &Dashboard{
			Professor:  s.professorInfo(ctx, st),
			Term:       term,
			University: s.universityInfo(ctx, uniID),
			Cards:      []ClassCard{}, WeekRows: []ScheduleRow{}, LiveSessions: []LiveSession{},
		}, nil
	}

	rows, err := s.ScheduleRows(ctx, st.ID, *term.ID, uniID)
	if err != nil {
		return nil, err
	}
	// One row per offering for grouping.
	unique := []ScheduleRow{}
	seen := map[int64]bool{}
	slotsByID := map[int64][]slot{}
	for _, r := range rows {
		if !seen[r.ID] {
			seen[r.ID] = true
			unique = append(unique, r)
		}
		slotsByID[r.ID] = append(slotsByID[r.ID], slot{Day: r.DayOfWeek, Start: r.StartTime, End: r.EndTime, Room: r.RoomName})
	}
	groups := groupIntoMerged(unique, func(r ScheduleRow) string {
		return mergedGroupKey(r.SharedKey, slotsByID[r.ID])
	})
	cards := []ClassCard{}
	for _, g := range groups {
		primary := g.Members[0]
		for _, m := range g.Members {
			if m.ID == g.PrimaryID {
				primary = m
				break
			}
		}
		codes := []string{}
		units := 0.0
		enrolled := 0
		capacity := 0
		for _, m := range g.Members {
			codes = append(codes, m.Code)
			if m.Units > units {
				units = m.Units
			}
			enrolled += m.EnrolledCount
			if m.Capacity > capacity {
				capacity = m.Capacity
			}
		}
		title := primary.Title
		if g.Merged {
			title = mergedDisplayTitle(primary.Title, codes)
		}
		roomLine := "سالن ثبت نشده"
		if primary.RoomName != "" {
			roomLine = "🏛️ " + primary.RoomName
		}
		timeLine := "ساعت‌بندی ثبت نشده"
		if primary.HasSchedule {
			timeLine = primary.DayName + " " + primary.StartTime + " الی " + primary.EndTime
		}
		code := strings.Join(uniqueStrings(codes), " / ")
		cards = append(cards, ClassCard{
			Key: keyOfCard(g), OfferingID: primary.ID, Title: title, Code: code,
			Group: primary.GroupNumber, Units: units, RoomLine: roomLine, TimeLine: timeLine,
			Enrolled: enrolled, Capacity: capacity,
			IsCoTaught: primary.IsCoTaught, CoTeacherName: primary.CoPartnerName,
			IsMerged: g.Merged, MergedCodes: uniqueStrings(codes),
		})
	}

	// Contract and signing.
	contractStatus := "NONE"
	var contractID *int64
	_ = s.DB.Pool.QueryRow(ctx, `
		select id from professor_term_contracts where "staffId" = $1 and "termId" = $2 limit 1`,
		st.ID, *term.ID).Scan(&contractID)
	var signed, total int
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*), count(*) filter (where "signatureStatus" = 'SIGNED')
		  from electronic_documents where "staffId" = $1 and "termId" = $2`,
		st.ID, *term.ID).Scan(&total, &signed)
	if signed > 0 {
		contractStatus = "SIGNED"
	} else if total > 0 {
		contractStatus = "PENDING"
	}
	var availabilityCount int
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*) from professor_availabilities where "staffId" = $1 and "termId" = $2`,
		st.ID, *term.ID).Scan(&availabilityCount)

	dash := &Dashboard{
		Professor:  s.professorInfo(ctx, st),
		Term:       term,
		University: s.universityInfo(ctx, uniID),
		Stats: DashboardStats{
			ClassCount: len(cards), AvailabilityCount: availabilityCount,
			ContractStatus: contractStatus, GradeDeadline: term.GradeDeadline,
		},
		Cards:        cards,
		WeekRows:     rows,
		LiveSessions: []LiveSession{},
	}
	dash.University = s.universityInfo(ctx, uniID)

	// Professor's virtual classes.
	offeringIDs := []int64{}
	for _, r := range rows {
		offeringIDs = append(offeringIDs, r.ID)
	}
	if len(offeringIDs) > 0 {
		vrows, err := s.DB.Pool.Query(ctx, `
			select vc.id, c.title, coalesce(vc."bbbMeetingId",''), coalesce(vc."isRunning",0),
			       coalesce(vc."currentAttendanceCount",0),
			       (select count(*)::int from virtual_class_recordings vr where vr."classroomId" = vc.id)
			  from virtual_classrooms vc
			  join course_offerings o on o.id = vc."courseOfferingId"
			  join courses c on c.id = o."courseId"
			 where o.id = any($1)`, offeringIDs)
		if err == nil {
			for vrows.Next() {
				var v LiveSession
				var running int
				if err := vrows.Scan(&v.ID, &v.CourseTitle, &v.MeetingID, &running, &v.Attendance, &v.RecordingsCount); err == nil {
					v.IsRunning = running != 0
					dash.LiveSessions = append(dash.LiveSessions, v)
				}
			}
			vrows.Close()
		}
	}
	dash.VCConfigured = len(dash.LiveSessions) > 0
	return dash, nil
}

func keyOfCard(g mergedGroup) string {
	if g.Merged {
		return "merged-" + g.Key
	}
	return itoa64(g.PrimaryID)
}

func uniqueStrings(list []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, s := range list {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func (s *Service) professorInfo(ctx context.Context, st *Staff) ProfessorInfo {
	info := ProfessorInfo{
		ID: st.ID, Name: st.Name, StaffCode: st.StaffCode,
		AcademicRank: st.AcademicRank,
		ContractType: firstNonEmpty(st.CooperationType, st.EmploymentType, st.StaffType),
	}
	if st.DepartmentID != nil {
		var name string
		if err := s.DB.Pool.QueryRow(ctx, `select name from departments where id = $1`, *st.DepartmentID).Scan(&name); err == nil {
			info.DepartmentName = &name
		}
	}
	uni := s.universityInfo(ctx, st.UniversityID)
	info.UniversityTitle = uni.Title
	info.UniversityLogo = uni.LogoURL
	return info
}

func firstNonEmpty(list ...*string) *string {
	for _, p := range list {
		if p != nil && strings.TrimSpace(*p) != "" {
			return p
		}
	}
	return nil
}

func (s *Service) universityInfo(ctx context.Context, universityID *int64) UniversityInfo {
	info := UniversityInfo{Title: "دانشگاه آفاق"}
	if universityID == nil {
		return info
	}
	var title string
	var logo *string
	if err := s.DB.Pool.QueryRow(ctx, `select title, "logoUrl" from universities where id = $1`, *universityID).
		Scan(&title, &logo); err == nil && title != "" {
		info.Title = title
		info.LogoURL = logo
	}
	return info
}
