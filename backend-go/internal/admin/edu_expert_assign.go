// ═══ تخصیص کارشناس آموزشی به اتاق/گروه/ارائه — پورت admin/edu-expert-assign ═══
//
// پورت وفادار afagh-next/src/app/admin/edu-expert-assign/{page.tsx,actions.ts}
// و afagh-next/src/lib/edu-expert.ts.
//
// زنجیرهٔ تصمیم کارشناسِ یک درس (از دقیق به کلی):
//
//	۱) course_offering_edu_experts — استثنای همان درس (چند‌به‌چند)
//	۲) classroom_edu_experts       — کارشناسِ اتاقِ سانس‌های همان درس
//	۳) expert_scopes               — گروه → دانشگاه
//
// واحدِ اصلیِ تخصیص «اتاق» است؛ تخصیصِ سطحِ درس فقط «استثنا».
package admin

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"backend-go/internal/session"
)

// ── انواع پاسخ (JSON هم‌نام با کلاینت Next) ──

// EduExpertTerm ترم تحصیلی برای انتخاب‌گر.
type EduExpertTerm struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	IsCurrent bool   `json:"isCurrent"`
}

// EduExpertCandidate کاندید «مسئول اتاق/کلاس» — کارشناس آموزش یا کنترل‌کنندهٔ حضور.
type EduExpertCandidate struct {
	UserID int64  `json:"userId"`
	Name   string `json:"name"`
	Kind   string `json:"kind"` // EDU_EXPERT | ATTENDANCE_CONTROLLER
}

// EduExpertDepartment گروه آموزشی + مدیرگروهش — برای «گروهِ مسئولِ اتاق».
type EduExpertDepartment struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	FacultyName *string `json:"facultyName"`
	HeadName    *string `json:"headName"`
}

// ClassroomSessionRow یک سانسِ هفتگیِ برگزارشده در اتاق.
type ClassroomSessionRow struct {
	ScheduleID    int64   `json:"scheduleId"`
	OfferingID    int64   `json:"offeringId"`
	DayOfWeek     *int    `json:"dayOfWeek"`
	Start         *string `json:"start"`
	End           *string `json:"end"`
	CourseTitle   string  `json:"courseTitle"`
	GroupNumber   int     `json:"groupNumber"`
	ProfessorName string  `json:"professorName"`
}

// ClassroomAssignRow اتاق + کارشناسانش + برنامهٔ هفتگی (پورت ClassroomAssignRow).
type ClassroomAssignRow struct {
	RoomID         int64                 `json:"roomId"`
	RoomName       string                `json:"roomName"`
	BuildingName   *string               `json:"buildingName"`
	Floor          *string               `json:"floor"`
	SessionCount   int                   `json:"sessionCount"`
	OfferingCount  int                   `json:"offeringCount"`
	Departments    []string              `json:"departments"`
	DepartmentID   *int64                `json:"departmentId"`
	DepartmentName *string               `json:"departmentName"`
	HeadName       *string               `json:"headName"`
	ExpertIDs      []int64               `json:"expertIds"`
	Sessions       []ClassroomSessionRow `json:"sessions"`
}

// EduExpertAssignRow یک ردیف جدول استثناهای درس (پورت EduExpertAssignRow).
type EduExpertAssignRow struct {
	OfferingID      int64    `json:"offeringId"`
	CourseTitle     string   `json:"courseTitle"`
	GroupNumber     int      `json:"groupNumber"`
	DepartmentName  *string  `json:"departmentName"`
	Rooms           []string `json:"rooms"`
	HasSchedule     bool     `json:"hasSchedule"`
	AssignedUserID  *int64   `json:"assignedUserId"`
	AssignedUserIDs []int64  `json:"assignedUserIds"`
	ResolvedUserID  *int64   `json:"resolvedUserId"`
	Source          *string  `json:"source"` // offering | classroom | scope | null
}

// EduExpertAssignInit دادهٔ اولیهٔ کامل صفحه (پورت EduExpertAssignInit).
type EduExpertAssignInit struct {
	Terms       []EduExpertTerm       `json:"terms"`
	Candidates  []EduExpertCandidate  `json:"candidates"`
	Departments []EduExpertDepartment `json:"departments"`
	Rooms       []ClassroomAssignRow  `json:"rooms"`
	Rows        []EduExpertAssignRow  `json:"rows"`
}

// ListEduExpertAssignInit پورت getEduExpertAssignInit — همه‌چیز در یک رفت‌وبرگشت.
func (s *Service) ListEduExpertAssignInit(ctx context.Context, user *session.User, cookie string, termID *int64) (*EduExpertAssignInit, error) {
	uniID := s.UniversityID(ctx, user, cookie)

	resp := &EduExpertAssignInit{
		Terms:       []EduExpertTerm{},
		Candidates:  []EduExpertCandidate{},
		Departments: []EduExpertDepartment{},
		Rooms:       []ClassroomAssignRow{},
		Rows:        []EduExpertAssignRow{},
	}

	// ترم‌ها
	rows, err := s.DB.Pool.Query(ctx, `
		select id, title, coalesce("isCurrent",0) = 1
		  from academic_terms
		 where ($1::int is null or "universityId" = $1)
		 order by id`, uniID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var t EduExpertTerm
		if err := rows.Scan(&t.ID, &t.Title, &t.IsCurrent); err != nil {
			rows.Close()
			return nil, err
		}
		resp.Terms = append(resp.Terms, t)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	// ترم جاری پیش‌فرض است تا کاربر هر بار ترم را عوض نکند.
	var tid int64
	if termID != nil && *termID > 0 {
		tid = *termID
	} else {
		for _, t := range resp.Terms {
			if t.IsCurrent {
				tid = t.ID
			}
		}
		if tid == 0 && len(resp.Terms) > 0 {
			tid = resp.Terms[len(resp.Terms)-1].ID
		}
	}

	if resp.Candidates, err = s.listEduExpertCandidates(ctx, uniID); err != nil {
		return nil, err
	}
	if tid > 0 {
		if resp.Rooms, err = s.listClassroomExpertAssignments(ctx, tid, uniID); err != nil {
			return nil, err
		}
		if resp.Rows, err = s.listOfferingExpertAssignments(ctx, tid, uniID); err != nil {
			return nil, err
		}
	}
	if resp.Departments, err = s.listDepartmentsForRoomOwner(ctx, uniID); err != nil {
		return nil, err
	}
	return resp, nil
}

// listEduExpertCandidates پورت listEduExpertCandidates — دو نقشِ مجازِ ثبت حضور.
func (s *Service) listEduExpertCandidates(ctx context.Context, uniID *int64) ([]EduExpertCandidate, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select u.id,
		       trim(coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",'')) as name,
		       case when bool_or(r.code = 'EDU_EXPERT') then 'EDU_EXPERT' else 'ATTENDANCE_CONTROLLER' end as kind
		  from user_roles ur
		  join roles r on r.id = ur."roleId" and r.code in ('EDU_EXPERT','ATTENDANCE_CONTROLLER')
		  join users u on u.id = ur."userId"
		 where coalesce(u."isActive",0) = 1
		   and ($1::int is null or u."universityId" is null or u."universityId" = $1)
		 group by u.id
		 order by name`, uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EduExpertCandidate{}
	for rows.Next() {
		var c EduExpertCandidate
		if err := rows.Scan(&c.UserID, &c.Name, &c.Kind); err != nil {
			return nil, err
		}
		if c.Kind != "EDU_EXPERT" {
			c.Name = strings.TrimSpace(c.Name) + " — کنترل‌کنندهٔ حضور"
		}
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, rows.Err()
}

// listDepartmentsForRoomOwner گروه‌های آموزشی دانشگاه جاری + نامِ مدیرگروه هرکدام.
func (s *Service) listDepartmentsForRoomOwner(ctx context.Context, uniID *int64) ([]EduExpertDepartment, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select d.id, d.name, f.name as "facultyName", (to_jsonb(d)->>'headStaffId')::int
		  from departments d
		  left join faculties f on f.id = d."facultyId"
		 where ($1::int is null or d."universityId" = $1)
		 order by d.name`, uniID)
	if err != nil {
		return nil, err
	}
	type deptRaw struct {
		id          int64
		name        string
		facultyName *string
		headStaffID *int64
	}
	depts := []deptRaw{}
	for rows.Next() {
		var d deptRaw
		if err := rows.Scan(&d.id, &d.name, &d.facultyName, &d.headStaffID); err != nil {
			rows.Close()
			return nil, err
		}
		depts = append(depts, d)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	headIDs := []int64{}
	seen := map[int64]bool{}
	for _, d := range depts {
		if d.headStaffID != nil && !seen[*d.headStaffID] {
			seen[*d.headStaffID] = true
			headIDs = append(headIDs, *d.headStaffID)
		}
	}
	headNames := map[int64]string{}
	if len(headIDs) > 0 {
		hs, err := s.DB.Pool.Query(ctx, `
			select st.id, trim(coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",''))
			  from staff st join users u on u.id = st."userId"
			 where st.id = any($1::int[])`, headIDs)
		if err == nil {
			defer hs.Close()
			for hs.Next() {
				var id int64
				var name string
				if err := hs.Scan(&id, &name); err == nil {
					headNames[id] = name
				}
			}
		}
	}

	out := make([]EduExpertDepartment, 0, len(depts))
	for _, d := range depts {
		row := EduExpertDepartment{ID: d.id, Name: d.name, FacultyName: d.facultyName}
		if d.headStaffID != nil {
			if n, ok := headNames[*d.headStaffID]; ok && n != "" {
				row.HeadName = &n
			}
		}
		out = append(out, row)
	}
	return out, nil
}

// ── سطح اتاق — فهرست اتاق‌های دارای سانس + کارشناسان + برنامهٔ هفتگی ──

// listClassroomExpertAssignments پورت listClassroomExpertAssignments.
func (s *Service) listClassroomExpertAssignments(ctx context.Context, termID int64, uniID *int64) ([]ClassroomAssignRow, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select s.id, s."scheduleType", s."roomId", s."dayOfWeek",
		       s."startTime"::text, s."endTime"::text,
		       o.id, c.title, o."groupNumber", o."professorId", o."ownerDepartmentId"
		  from schedules s
		  join course_offerings o on o.id = s."offeringId"
		  join courses c on c.id = o."courseId"
		 where o."termId" = $1
		   and coalesce(o."isActive",0) = 1
		   and ($2::int is null or o."universityId" = $2)
		 order by s."dayOfWeek", s."startTime"`, termID, uniID)
	if err != nil {
		return nil, err
	}
	type schedRaw struct {
		scheduleID   int64
		scheduleType string
		roomID       *int64
		dayOfWeek    *int
		start        *string
		end          *string
		offeringID   int64
		courseTitle  string
		groupNumber  int
		professorID  *int64
		ownerDeptID  *int64
	}
	all := []schedRaw{}
	for rows.Next() {
		var r schedRaw
		if err := rows.Scan(&r.scheduleID, &r.scheduleType, &r.roomID, &r.dayOfWeek,
			&r.start, &r.end, &r.offeringID, &r.courseTitle, &r.groupNumber,
			&r.professorID, &r.ownerDeptID); err != nil {
			rows.Close()
			return nil, err
		}
		all = append(all, r)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	// سانس امتحان اتاقش سالنِ امتحان است، نه کلاسِ درس — بیرونش می‌گذاریم.
	filtered := all[:0:0]
	roomSeen := map[int64]bool{}
	roomIDs := []int64{}
	deptSeen := map[int64]bool{}
	deptIDs := []int64{}
	profSeen := map[int64]bool{}
	profIDs := []int64{}
	for _, r := range all {
		if strings.EqualFold(r.scheduleType, "EXAM") || r.roomID == nil {
			continue
		}
		filtered = append(filtered, r)
		if !roomSeen[*r.roomID] {
			roomSeen[*r.roomID] = true
			roomIDs = append(roomIDs, *r.roomID)
		}
		if r.ownerDeptID != nil && !deptSeen[*r.ownerDeptID] {
			deptSeen[*r.ownerDeptID] = true
			deptIDs = append(deptIDs, *r.ownerDeptID)
		}
		if r.professorID != nil && !profSeen[*r.professorID] {
			profSeen[*r.professorID] = true
			profIDs = append(profIDs, *r.professorID)
		}
	}
	if len(filtered) == 0 {
		return []ClassroomAssignRow{}, nil
	}

	// فرادادهٔ اتاق‌ها (نام/ساختمان/طبقه/گروه مسئول)
	type roomMeta struct {
		id           int64
		name         string
		buildingName *string
		floor        *string
		departmentID *int64
	}
	roomByID := map[int64]*roomMeta{}
	rrows, err := s.DB.Pool.Query(ctx, `
		select id, name, "buildingName", floor, "departmentId"
		  from classrooms where id = any($1::int[])`, roomIDs)
	if err != nil {
		return nil, err
	}
	for rrows.Next() {
		var m roomMeta
		if err := rrows.Scan(&m.id, &m.name, &m.buildingName, &m.floor, &m.departmentID); err != nil {
			rrows.Close()
			return nil, err
		}
		roomByID[m.id] = &m
	}
	if err := rrows.Err(); err != nil {
		rrows.Close()
		return nil, err
	}
	rrows.Close()
	// اگر اتاقی پیدا نشد یعنی مشکل واقعی است — به جای جعلِ نام، خطا بده.
	if len(roomByID) == 0 {
		return nil, errors.New("read_classroom_meta_failed")
	}

	deptName := map[int64]string{}
	if len(deptIDs) > 0 {
		drows, err := s.DB.Pool.Query(ctx, `select id, name from departments where id = any($1::int[])`, deptIDs)
		if err == nil {
			for drows.Next() {
				var id int64
				var name string
				if err := drows.Scan(&id, &name); err == nil {
					deptName[id] = name
				}
			}
			drows.Close()
		}
	}
	profName := map[int64]string{}
	if len(profIDs) > 0 {
		prows, err := s.DB.Pool.Query(ctx, `
			select st.id, trim(coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",''))
			  from staff st join users u on u.id = st."userId"
			 where st.id = any($1::int[])`, profIDs)
		if err == nil {
			for prows.Next() {
				var id int64
				var name string
				if err := prows.Scan(&id, &name); err == nil {
					profName[id] = name
				}
			}
			prows.Close()
		}
	}
	expertsByRoom := map[int64][]int64{}
	arows, err := s.DB.Pool.Query(ctx, `
		select "classroomId", "userId" from classroom_edu_experts
		 where "classroomId" = any($1::int[]) order by id`, roomIDs)
	if err != nil {
		return nil, err
	}
	for arows.Next() {
		var roomID, userID int64
		if err := arows.Scan(&roomID, &userID); err != nil {
			arows.Close()
			return nil, err
		}
		if !containsInt64(expertsByRoom[roomID], userID) {
			expertsByRoom[roomID] = append(expertsByRoom[roomID], userID)
		}
	}
	if err := arows.Err(); err != nil {
		arows.Close()
		return nil, err
	}
	arows.Close()

	// مدیرگروهِ گروهِ مسئولِ هر اتاق
	type ownerDept struct {
		name        string
		headStaffID *int64
	}
	ownerDeptIDs := []int64{}
	ownerSeen := map[int64]bool{}
	for _, m := range roomByID {
		if m.departmentID != nil && !ownerSeen[*m.departmentID] {
			ownerSeen[*m.departmentID] = true
			ownerDeptIDs = append(ownerDeptIDs, *m.departmentID)
		}
	}
	ownerDeptByID := map[int64]*ownerDept{}
	if len(ownerDeptIDs) > 0 {
		orows, err := s.DB.Pool.Query(ctx, `
			select id, name, (to_jsonb(d)->>'headStaffId')::int from departments d where d.id = any($1::int[])`, ownerDeptIDs)
		if err == nil {
			for orows.Next() {
				var id int64
				var d ownerDept
				if err := orows.Scan(&id, &d.name, &d.headStaffID); err == nil {
					ownerDeptByID[id] = &d
				}
			}
			orows.Close()
		}
	}
	headIDs := []int64{}
	headSeen := map[int64]bool{}
	for _, d := range ownerDeptByID {
		if d.headStaffID != nil && !headSeen[*d.headStaffID] {
			headSeen[*d.headStaffID] = true
			headIDs = append(headIDs, *d.headStaffID)
		}
	}
	headNameByID := map[int64]string{}
	if len(headIDs) > 0 {
		hrows, err := s.DB.Pool.Query(ctx, `
			select st.id, trim(coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",''))
			  from staff st join users u on u.id = st."userId"
			 where st.id = any($1::int[])`, headIDs)
		if err == nil {
			for hrows.Next() {
				var id int64
				var name string
				if err := hrows.Scan(&id, &name); err == nil {
					headNameByID[id] = name
				}
			}
			hrows.Close()
		}
	}

	byRoom := map[int64]*ClassroomAssignRow{}
	roomOrder := []int64{}
	for _, r := range filtered {
		roomID := *r.roomID
		row, ok := byRoom[roomID]
		if !ok {
			room := roomByID[roomID]
			row = &ClassroomAssignRow{
				RoomID:       roomID,
				RoomName:     fmt.Sprintf("اتاق %d", roomID),
				SessionCount: 0,
				Departments:  []string{},
				ExpertIDs:    []int64{},
				Sessions:     []ClassroomSessionRow{},
			}
			if room != nil {
				row.RoomName = room.name
				row.BuildingName = room.buildingName
				row.Floor = room.floor
				row.DepartmentID = room.departmentID
				if room.departmentID != nil {
					if od, ok := ownerDeptByID[*room.departmentID]; ok {
						row.DepartmentName = &od.name
						if od.headStaffID != nil {
							if hn, ok := headNameByID[*od.headStaffID]; ok && hn != "" {
								row.HeadName = &hn
							}
						}
					}
				}
			}
			if ids, ok := expertsByRoom[roomID]; ok {
				row.ExpertIDs = ids
			}
			byRoom[roomID] = row
			roomOrder = append(roomOrder, roomID)
		}
		row.SessionCount++
		sess := ClassroomSessionRow{
			ScheduleID:    r.scheduleID,
			OfferingID:    r.offeringID,
			DayOfWeek:     r.dayOfWeek,
			Start:         trimTime(r.start),
			End:           trimTime(r.end),
			CourseTitle:   r.courseTitle,
			GroupNumber:   r.groupNumber,
			ProfessorName: "—",
		}
		if r.professorID != nil {
			if n, ok := profName[*r.professorID]; ok && n != "" {
				sess.ProfessorName = n
			}
		}
		row.Sessions = append(row.Sessions, sess)
		if r.ownerDeptID != nil {
			if dn, ok := deptName[*r.ownerDeptID]; ok && !containsString(row.Departments, dn) {
				row.Departments = append(row.Departments, dn)
			}
		}
	}
	out := make([]ClassroomAssignRow, 0, len(roomOrder))
	for _, roomID := range roomOrder {
		row := byRoom[roomID]
		offeringSet := map[int64]bool{}
		for _, sess := range row.Sessions {
			offeringSet[sess.OfferingID] = true
		}
		row.OfferingCount = len(offeringSet)
		out = append(out, *row)
	}
	// اول اتاق‌های پرکار، بعد بی‌کار — تا مدیر از بالا شروع کند
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].SessionCount != out[j].SessionCount {
			return out[i].SessionCount > out[j].SessionCount
		}
		return out[i].RoomName < out[j].RoomName
	})
	return out, nil
}

func trimTime(t *string) *string {
	if t == nil {
		return nil
	}
	s := *t
	if len(s) >= 5 {
		s = s[:5]
	}
	return &s
}

func containsInt64(list []int64, v int64) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func containsString(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// ── سطح درس (استثنا) — فهرست انبوه ──

// listOfferingExpertAssignments پورت listOfferingExpertAssignments.
func (s *Service) listOfferingExpertAssignments(ctx context.Context, termID int64, uniID *int64) ([]EduExpertAssignRow, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.title, o."groupNumber", o."ownerDepartmentId", o."universityId",
		       o."eduExpertUserId", coalesce(o."isActive",0)
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		 where o."termId" = $1
		   and coalesce(o."isActive",0) = 1
		   and ($2::int is null or o."universityId" = $2)
		 order by c.title`, termID, uniID)
	if err != nil {
		return nil, err
	}
	type offRaw struct {
		offeringID   int64
		courseTitle  string
		groupNumber  int
		ownerDeptID  *int64
		universityID *int64
		eduExpertUID *int64
		isActive     int
	}
	offs := []offRaw{}
	offeringIDs := []int64{}
	deptSeen := map[int64]bool{}
	deptIDs := []int64{}
	for rows.Next() {
		var r offRaw
		if err := rows.Scan(&r.offeringID, &r.courseTitle, &r.groupNumber, &r.ownerDeptID,
			&r.universityID, &r.eduExpertUID, &r.isActive); err != nil {
			rows.Close()
			return nil, err
		}
		offs = append(offs, r)
		offeringIDs = append(offeringIDs, r.offeringID)
		if r.ownerDeptID != nil && !deptSeen[*r.ownerDeptID] {
			deptSeen[*r.ownerDeptID] = true
			deptIDs = append(deptIDs, *r.ownerDeptID)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if len(offs) == 0 {
		return []EduExpertAssignRow{}, nil
	}

	deptNames := map[int64]string{}
	if len(deptIDs) > 0 {
		drows, err := s.DB.Pool.Query(ctx, `select id, name from departments where id = any($1::int[])`, deptIDs)
		if err == nil {
			for drows.Next() {
				var id int64
				var name string
				if err := drows.Scan(&id, &name); err == nil {
					deptNames[id] = name
				}
			}
			drows.Close()
		}
	}
	deptNameOf := func(id *int64) *string {
		if id == nil {
			return nil
		}
		if n, ok := deptNames[*id]; ok {
			return &n
		}
		return nil
	}

	// اتاق‌های هر درس از schedules (بدون سانسِ امتحان)
	type schedRaw struct {
		offeringID int64
		roomID     *int64
		schedType  string
	}
	schedRows := []schedRaw{}
	srows, err := s.DB.Pool.Query(ctx, `
		select "offeringId", "roomId", "scheduleType" from schedules
		 where "offeringId" = any($1::int[])`, offeringIDs)
	if err != nil {
		return nil, err
	}
	for srows.Next() {
		var sr schedRaw
		if err := srows.Scan(&sr.offeringID, &sr.roomID, &sr.schedType); err != nil {
			srows.Close()
			return nil, err
		}
		if !strings.EqualFold(sr.schedType, "EXAM") {
			schedRows = append(schedRows, sr)
		}
	}
	if err := srows.Err(); err != nil {
		srows.Close()
		return nil, err
	}
	srows.Close()

	roomSeen := map[int64]bool{}
	roomIDs := []int64{}
	roomsByOffering := map[int64][]string{}
	scheduledOfferings := map[int64]bool{}
	roomIDsByOffering := map[int64][]int64{}
	for _, sr := range schedRows {
		scheduledOfferings[sr.offeringID] = true
		if sr.roomID != nil {
			if !containsInt64(roomIDsByOffering[sr.offeringID], *sr.roomID) {
				roomIDsByOffering[sr.offeringID] = append(roomIDsByOffering[sr.offeringID], *sr.roomID)
			}
			if !roomSeen[*sr.roomID] {
				roomSeen[*sr.roomID] = true
				roomIDs = append(roomIDs, *sr.roomID)
			}
		}
	}
	roomName := map[int64]string{}
	if len(roomIDs) > 0 {
		rrows, err := s.DB.Pool.Query(ctx, `select id, name from classrooms where id = any($1::int[])`, roomIDs)
		if err == nil {
			for rrows.Next() {
				var id int64
				var name string
				if err := rrows.Scan(&id, &name); err == nil {
					roomName[id] = name
				}
			}
			rrows.Close()
		}
	}
	for _, sr := range schedRows {
		if sr.roomID == nil {
			continue
		}
		if n, ok := roomName[*sr.roomID]; ok {
			if !containsString(roomsByOffering[sr.offeringID], n) {
				roomsByOffering[sr.offeringID] = append(roomsByOffering[sr.offeringID], n)
			}
		}
	}

	// کارشناسانِ سطح اتاق — یک کوئری برای همهٔ اتاق‌های این ترم
	expertsByRoom := map[int64][]int64{}
	if len(roomIDs) > 0 {
		erows, err := s.DB.Pool.Query(ctx, `
			select "classroomId", "userId" from classroom_edu_experts
			 where "classroomId" = any($1::int[]) order by id`, roomIDs)
		if err != nil {
			return nil, err
		}
		for erows.Next() {
			var roomID, userID int64
			if err := erows.Scan(&roomID, &userID); err != nil {
				erows.Close()
				return nil, err
			}
			if !containsInt64(expertsByRoom[roomID], userID) {
				expertsByRoom[roomID] = append(expertsByRoom[roomID], userID)
			}
		}
		if err := erows.Err(); err != nil {
			erows.Close()
			return nil, err
		}
		erows.Close()
	}

	// نقش‌ها (expert_scopes) یک بار خوانده می‌شود و در حافظه جست‌وجو می‌شود
	type scopeRow struct {
		userID    int64
		scopeType string
		scopeID   *int64
	}
	scopes := []scopeRow{}
	scrows, err := s.DB.Pool.Query(ctx, `select "userId", "scopeType", "scopeId" from expert_scopes`)
	if err == nil {
		for scrows.Next() {
			var sc scopeRow
			if err := scrows.Scan(&sc.userID, &sc.scopeType, &sc.scopeID); err == nil {
				scopes = append(scopes, sc)
			}
		}
		scrows.Close()
	}
	scopeHit := func(scopeType string, id *int64) *int64 {
		for _, sc := range scopes {
			if sc.scopeType == scopeType && ptrEq(sc.scopeID, id) {
				u := sc.userID
				return &u
			}
		}
		return nil
	}

	// کارشناسانِ سطح کلاس — یک کوئری برای همهٔ ارائه‌های ترم
	expertsByOffering := map[int64][]int64{}
	xrows, err := s.DB.Pool.Query(ctx, `
		select "offeringId", "userId" from course_offering_edu_experts
		 where "offeringId" = any($1::int[]) order by id`, offeringIDs)
	if err != nil {
		return nil, err
	}
	for xrows.Next() {
		var offeringID, userID int64
		if err := xrows.Scan(&offeringID, &userID); err != nil {
			xrows.Close()
			return nil, err
		}
		if !containsInt64(expertsByOffering[offeringID], userID) {
			expertsByOffering[offeringID] = append(expertsByOffering[offeringID], userID)
		}
	}
	if err := xrows.Err(); err != nil {
		xrows.Close()
		return nil, err
	}
	xrows.Close()

	out := make([]EduExpertAssignRow, 0, len(offs))
	for _, r := range offs {
		rooms := roomsByOffering[r.offeringID]
		if rooms == nil {
			rooms = []string{}
		}
		row := EduExpertAssignRow{
			OfferingID:      r.offeringID,
			CourseTitle:     r.courseTitle,
			GroupNumber:     r.groupNumber,
			DepartmentName:  deptNameOf(r.ownerDeptID),
			Rooms:           rooms,
			HasSchedule:     scheduledOfferings[r.offeringID],
			AssignedUserIDs: []int64{},
		}

		// ۱) استثنای درس (چند‌به‌چند) — ستون قدیمی eduExpertUserId هم تورِ ایمنی است
		explicit := expertsByOffering[r.offeringID]
		if len(explicit) == 0 && r.eduExpertUID != nil {
			explicit = []int64{*r.eduExpertUID}
		}
		if len(explicit) > 0 {
			row.AssignedUserID = &explicit[0]
			row.AssignedUserIDs = explicit
			row.ResolvedUserID = &explicit[0]
			src := "offering"
			row.Source = &src
			out = append(out, row)
			continue
		}

		// ۲) کارشناسِ اتاق‌های همین درس
		fromRooms := []int64{}
		for _, roomID := range roomIDsByOffering[r.offeringID] {
			for _, uid := range expertsByRoom[roomID] {
				if !containsInt64(fromRooms, uid) {
					fromRooms = append(fromRooms, uid)
				}
			}
		}
		if len(fromRooms) > 0 {
			row.AssignedUserID = &fromRooms[0]
			row.AssignedUserIDs = fromRooms
			row.ResolvedUserID = &fromRooms[0]
			src := "classroom"
			row.Source = &src
			out = append(out, row)
			continue
		}

		// ۳) از نقش‌ها: گروه سازنده → دانشگاه
		fromScope := scopeHit("DEPARTMENT", r.ownerDeptID)
		if fromScope == nil {
			fromScope = scopeHit("UNIVERSITY", r.universityID)
		}
		row.ResolvedUserID = fromScope
		if fromScope != nil {
			src := "scope"
			row.Source = &src
		}
		out = append(out, row)
	}
	return out, nil
}

func ptrEq(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// ── عملیات نوشتن ──

// assertEduExpertUserID اعتبارسنجی کاربر: واقعاً حساب است و (اگر داده بود) فعال است.
func (s *Service) assertEduExpertUserID(ctx context.Context, userID *int64) error {
	if userID == nil {
		return nil
	}
	var isActive *int
	if err := s.DB.Pool.QueryRow(ctx, `select "isActive" from users where id = $1 limit 1`, *userID).
		Scan(&isActive); err != nil {
		return errors.New("کاربر یافت نشد.")
	}
	if isActive == nil || *isActive != 1 {
		return errors.New("حساب انتخاب‌شده غیرفعال است.")
	}
	return nil
}

// setOfferingEduExpertIDs جایگزینی کامل فهرست کارشناسان یک کلاس (پورت setOfferingEduExperts).
// ids خالی = آزاد کردن کلاس (بازگشت به نقش‌ها). خروجی فهرست نهایی ذخیره‌شده است.
func (s *Service) setOfferingEduExpertIDs(ctx context.Context, offeringID int64, userIDs []int64) ([]int64, error) {
	ids := dedupeInt64(userIDs)
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from course_offering_edu_experts where "offeringId" = $1`, offeringID); err != nil {
		return nil, err
	}
	if len(ids) > 0 {
		if _, err := tx.Exec(ctx, `
			insert into course_offering_edu_experts ("offeringId","userId")
			select $1, x from unnest($2::int[]) as t(x)
			on conflict do nothing`, offeringID, ids); err != nil {
			return nil, err
		}
	}
	var first *int64
	if len(ids) > 0 {
		first = &ids[0]
	}
	if _, err := tx.Exec(ctx, `
		update course_offerings set "eduExpertUserId" = $1 where id = $2`, first, offeringID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return ids, nil
}

// addOfferingEduExpertIDs افزودن یک کارشناس به کلاس‌ها بدون دست‌زدن به بقیه
// (پورت addOfferingEduExperts). خروجی: تعداد کلاس‌های تغییر‌یافته.
func (s *Service) addOfferingEduExpertIDs(ctx context.Context, offeringIDs []int64, userID int64) (int, error) {
	ids := dedupeInt64(offeringIDs)
	if len(ids) == 0 || userID <= 0 {
		return 0, nil
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		insert into course_offering_edu_experts ("offeringId","userId")
		select o, $2 from unnest($1::int[]) as t(o)
		on conflict do nothing`, ids, userID); err != nil {
		return 0, err
	}
	// برای ارائه‌هایی که هنوز «کارشناسِ اصلی» ندارند، همین نفر اصلی می‌شود.
	ct, err := s.DB.Pool.Exec(ctx, `
		update course_offerings set "eduExpertUserId" = $2
		 where id = any($1::int[]) and "eduExpertUserId" is null`, ids, userID)
	if err != nil {
		return 0, err
	}
	_ = ct
	return len(ids), nil
}

// SetOfferingEduExpert پورت setOfferingEduExpertAction — تخصیصِ تک‌مقداری (یا آزاد کردن با null).
func (s *Service) SetOfferingEduExpert(ctx context.Context, user *session.User, cookie string, offeringID int64, userID *int64) error {
	if err := s.assertEduExpertUserID(ctx, userID); err != nil {
		return err
	}
	var ids []int64
	if userID != nil {
		ids = []int64{*userID}
	}
	_, err := s.setOfferingEduExpertIDs(ctx, offeringID, ids)
	return err
}

// SetOfferingEduExpertList پورت setOfferingEduExpertsAction — جایگزینی کامل فهرست.
func (s *Service) SetOfferingEduExpertList(ctx context.Context, user *session.User, cookie string, offeringID int64, userIDs []int64) ([]int64, error) {
	for _, id := range userIDs {
		uid := id
		if err := s.assertEduExpertUserID(ctx, &uid); err != nil {
			return nil, err
		}
	}
	return s.setOfferingEduExpertIDs(ctx, offeringID, userIDs)
}

// AddOfferingEduExpert پورت addOfferingEduExpertAction — افزودن بدون حذف بقیه.
func (s *Service) AddOfferingEduExpert(ctx context.Context, user *session.User, cookie string, offeringID int64, userID int64) error {
	uid := userID
	if err := s.assertEduExpertUserID(ctx, &uid); err != nil {
		return err
	}
	if userID <= 0 {
		return errors.New("کارشناس انتخاب نشده.")
	}
	_, err := s.addOfferingEduExpertIDs(ctx, []int64{offeringID}, userID)
	return err
}

// RemoveOfferingEduExpert پورت removeOfferingEduExpertAction — حذف یک نفر (بقیه می‌مانند).
func (s *Service) RemoveOfferingEduExpert(ctx context.Context, user *session.User, cookie string, offeringID, userID int64) ([]int64, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select "userId" from course_offering_edu_experts
		 where "offeringId" = $1 order by id`, offeringID)
	if err != nil {
		return nil, err
	}
	current := []int64{}
	for rows.Next() {
		var uid int64
		if err := rows.Scan(&uid); err != nil {
			rows.Close()
			return nil, err
		}
		current = append(current, uid)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	next := []int64{}
	for _, uid := range current {
		if uid != userID {
			next = append(next, uid)
		}
	}
	return s.setOfferingEduExpertIDs(ctx, offeringID, next)
}

// BulkSetOfferingEduExpert پورت bulkSetOfferingEduExpertAction — جایگزینی گروهی.
func (s *Service) BulkSetOfferingEduExpert(ctx context.Context, user *session.User, cookie string, offeringIDs []int64, userID *int64) (int, error) {
	if err := s.assertEduExpertUserID(ctx, userID); err != nil {
		return 0, err
	}
	ids := dedupeInt64(offeringIDs)
	if len(ids) == 0 {
		return 0, nil
	}
	// فقط ارائه‌های موجود را به‌روز کن تا عددِ updated دروغ نگوید
	rows, err := s.DB.Pool.Query(ctx, `select id from course_offerings where id = any($1::int[])`, ids)
	if err != nil {
		return 0, err
	}
	existing := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		existing = append(existing, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	if len(existing) == 0 {
		return 0, nil
	}
	var assign []int64
	if userID != nil {
		assign = []int64{*userID}
	}
	for _, id := range existing {
		if _, err := s.setOfferingEduExpertIDs(ctx, id, assign); err != nil {
			return 0, err
		}
	}
	return len(existing), nil
}

// BulkAddOfferingEduExpert پورت bulkAddOfferingEduExpertAction — افزودن گروهی.
func (s *Service) BulkAddOfferingEduExpert(ctx context.Context, user *session.User, cookie string, offeringIDs []int64, userID int64) (int, error) {
	uid := userID
	if err := s.assertEduExpertUserID(ctx, &uid); err != nil {
		return 0, err
	}
	if userID <= 0 {
		return 0, errors.New("کارشناس انتخاب نشده.")
	}
	ids := dedupeInt64(offeringIDs)
	if len(ids) == 0 {
		return 0, nil
	}
	rows, err := s.DB.Pool.Query(ctx, `select id from course_offerings where id = any($1::int[])`, ids)
	if err != nil {
		return 0, err
	}
	existing := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		existing = append(existing, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	if len(existing) == 0 {
		return 0, nil
	}
	return s.addOfferingEduExpertIDs(ctx, existing, userID)
}

// ClearTermEduExperts پورت clearTermEduExpertAction — آزاد کردن همهٔ تخصیص‌های یک ترم.
// هر دو لایه پاک می‌شوند: جدولِ واسط و ستونِ «کارشناسِ اصلی».
func (s *Service) ClearTermEduExperts(ctx context.Context, user *session.User, cookie string, termID int64) (int, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select id from course_offerings
		 where "termId" = $1 and coalesce("isActive",0) = 1`, termID)
	if err != nil {
		return 0, err
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	if len(ids) == 0 {
		return 0, nil
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		delete from course_offering_edu_experts where "offeringId" = any($1::int[])`, ids); err != nil {
		return 0, err
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		update course_offerings set "eduExpertUserId" = null where id = any($1::int[])`, ids); err != nil {
		return 0, err
	}
	return len(ids), nil
}

// SetClassroomDepartment پورت setClassroomDepartmentAction — گروهِ مسئولِ اتاق
// (همان گروهِ مسئول، مدیرگروهش را هم مشخص می‌کند).
func (s *Service) SetClassroomDepartment(ctx context.Context, user *session.User, cookie string, classroomID int64, departmentID *int64) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if classroomID <= 0 {
		return errors.New("اتاق نامعتبر است.")
	}
	var roomUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from classrooms where id = $1 limit 1`, classroomID).
		Scan(&roomUni); err != nil {
		return errors.New("اتاق یافت نشد.")
	}
	if uniID != nil && roomUni != nil && *roomUni != *uniID {
		return errors.New("این اتاق در دانشگاه شما نیست.")
	}
	if departmentID != nil {
		var deptUni *int64
		if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from departments where id = $1 limit 1`, *departmentID).
			Scan(&deptUni); err != nil {
			return errors.New("گروه یافت نشد.")
		}
		if uniID != nil && deptUni != nil && *deptUni != *uniID {
			return errors.New("این گروه در دانشگاه شما نیست.")
		}
	}
	_, err := s.DB.Pool.Exec(ctx, `update classrooms set "departmentId" = $1 where id = $2`, departmentID, classroomID)
	return err
}

// AddClassroomExperts پورت addClassroomExpertAction — افزودن به یک یا چند اتاق.
func (s *Service) AddClassroomExperts(ctx context.Context, user *session.User, cookie string, classroomIDs []int64, userID int64) (int, error) {
	uid := userID
	if err := s.assertEduExpertUserID(ctx, &uid); err != nil {
		return 0, err
	}
	if userID <= 0 {
		return 0, errors.New("کارشناس انتخاب نشده.")
	}
	ids := dedupeInt64(classroomIDs)
	if len(ids) == 0 || userID <= 0 {
		return 0, nil
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		insert into classroom_edu_experts ("classroomId","userId")
		select r, $2 from unnest($1::int[]) as t(r)
		on conflict do nothing`, ids, userID); err != nil {
		return 0, err
	}
	return len(ids), nil
}

// RemoveClassroomExpert پورت removeClassroomExpertAction — حذف یک نفر از اتاق.
func (s *Service) RemoveClassroomExpert(ctx context.Context, user *session.User, cookie string, classroomID, userID int64) ([]int64, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select "userId" from classroom_edu_experts
		 where "classroomId" = $1 order by id`, classroomID)
	if err != nil {
		return nil, err
	}
	current := []int64{}
	for rows.Next() {
		var uid int64
		if err := rows.Scan(&uid); err != nil {
			rows.Close()
			return nil, err
		}
		current = append(current, uid)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	next := []int64{}
	for _, uid := range current {
		if uid != userID {
			next = append(next, uid)
		}
	}
	return s.setClassroomEduExpertIDs(ctx, classroomID, next)
}

// SetClassroomExperts پورت setClassroomExpertsAction — جایگزینی کامل فهرست اتاق.
func (s *Service) SetClassroomExperts(ctx context.Context, user *session.User, cookie string, classroomID int64, userIDs []int64) ([]int64, error) {
	for _, id := range userIDs {
		uid := id
		if err := s.assertEduExpertUserID(ctx, &uid); err != nil {
			return nil, err
		}
	}
	return s.setClassroomEduExpertIDs(ctx, classroomID, userIDs)
}

// setClassroomEduExpertIDs جایگزینی کامل کارشناسان یک اتاق (پورت setClassroomEduExperts).
func (s *Service) setClassroomEduExpertIDs(ctx context.Context, classroomID int64, userIDs []int64) ([]int64, error) {
	ids := dedupeInt64(userIDs)
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from classroom_edu_experts where "classroomId" = $1`, classroomID); err != nil {
		return nil, err
	}
	if len(ids) > 0 {
		if _, err := tx.Exec(ctx, `
			insert into classroom_edu_experts ("classroomId","userId")
			select $1, x from unnest($2::int[]) as t(x)
			on conflict do nothing`, classroomID, ids); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return ids, nil
}

// ClearAllClassroomExperts پورت clearAllClassroomExpertsAction — آزاد کردن همهٔ
// تخصیص‌های سطح اتاق (کل سامانه، نه یک ترم — همان رفتار مرجع).
func (s *Service) ClearAllClassroomExperts(ctx context.Context, user *session.User, cookie string) (int, error) {
	ct, err := s.DB.Pool.Exec(ctx, `delete from classroom_edu_experts`)
	if err != nil {
		return 0, err
	}
	return int(ct.RowsAffected()), nil
}

func dedupeInt64(in []int64) []int64 {
	out := []int64{}
	seen := map[int64]bool{}
	for _, v := range in {
		if v <= 0 || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}
