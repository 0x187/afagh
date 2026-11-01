// ═══ Moving a student between groups of a course — port of admin/group-transfer ═══
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"backend-go/internal/enroll"
	"backend-go/internal/jalali"
	"backend-go/internal/session"
)

// TransferOffering: course offering.
type TransferOffering struct {
	OfferingID    int64  `json:"offeringId"`
	GroupNumber   int    `json:"groupNumber"`
	EnrolledCount int    `json:"enrolledCount"`
	Capacity      int    `json:"capacity"`
	ProfessorName string `json:"professorName"`
	IsActive      bool   `json:"isActive"`
}

// TransferCourseGroup: course + its groups.
type TransferCourseGroup struct {
	CourseID       int64              `json:"courseId"`
	Code           string             `json:"code"`
	Title          string             `json:"title"`
	Units          *float64           `json:"units"`
	DepartmentID   *int64             `json:"departmentId"`
	DepartmentName string             `json:"departmentName"`
	Offerings      []TransferOffering `json:"offerings"`
}

// GroupRosterRow: student in a group.
type GroupRosterRow struct {
	EnrollmentID int64  `json:"enrollmentId"`
	StudentID    int64  `json:"studentId"`
	StudentCode  string `json:"studentCode"`
	FirstName    string `json:"firstName"`
	LastName     string `json:"lastName"`
	Status       string `json:"status"`
}

// TransferResult: transfer result.
type TransferResult struct {
	OK           bool     `json:"ok"`
	Error        *string  `json:"error,omitempty"`
	Warnings     []string `json:"warnings,omitempty"`
	Blocks       []string `json:"blocks,omitempty"`
	EnrollmentID *int64   `json:"enrollmentId,omitempty"`
}

// TransferTargets: term courses and groups.
func (s *Service) TransferTargets(ctx context.Context, user *session.User, cookie string, termID int64) ([]TransferCourseGroup, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.id, c.code, c.title, c.units::float8, c."departmentId", coalesce(d.name,'—'),
		       coalesce(o."groupNumber",0), coalesce(o."enrolledCount",0), coalesce(o.capacity,0),
		       coalesce(o."isActive",1),
		       coalesce(nullif(trim(u."firstName" || ' ' || u."lastName"),''), '—')
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join departments d on d.id = c."departmentId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		 where o."termId" = $1 and coalesce(o."isActive",1) = 1 and o."universityId" = $2
		 order by c.title, o."groupNumber" limit 4000`, termID, *uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TransferCourseGroup{}
	index := map[int64]int{}
	for rows.Next() {
		var offeringID, courseID int64
		var code, title string
		var units *float64
		var deptID *int64
		var deptName string
		var groupNo, enrolled, capacity, active int
		var prof string
		if err := rows.Scan(&offeringID, &courseID, &code, &title, &units, &deptID, &deptName,
			&groupNo, &enrolled, &capacity, &active, &prof); err != nil {
			continue
		}
		idx, ok := index[courseID]
		if !ok {
			idx = len(out)
			index[courseID] = idx
			out = append(out, TransferCourseGroup{
				CourseID: courseID, Code: code, Title: title, Units: units,
				DepartmentID: deptID, DepartmentName: deptName, Offerings: []TransferOffering{},
			})
		}
		out[idx].Offerings = append(out[idx].Offerings, TransferOffering{
			OfferingID: offeringID, GroupNumber: groupNo, EnrolledCount: enrolled,
			Capacity: capacity, ProfessorName: prof, IsActive: active != 0,
		})
	}
	return out, nil
}

// TransferRosterOffer: source group details.
type TransferRosterOffer struct {
	OfferingID    int64  `json:"offeringId"`
	CourseCode    string `json:"courseCode"`
	CourseTitle   string `json:"courseTitle"`
	GroupNumber   int    `json:"groupNumber"`
	Capacity      int    `json:"capacity"`
	EnrolledCount int    `json:"enrolledCount"`
	ProfessorName string `json:"professorName"`
}

// TransferRoster: group roster response.
type TransferRoster struct {
	Offer  TransferRosterOffer `json:"offer"`
	Roster []GroupRosterRow    `json:"roster"`
}

// TransferGroupRoster: roster of a source group.
func (s *Service) TransferGroupRoster(ctx context.Context, user *session.User, cookie string, termID, offeringID int64) (*TransferRoster, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	out := &TransferRoster{Roster: []GroupRosterRow{}}
	var offUni *int64
	err := s.DB.Pool.QueryRow(ctx, `
		select o.id, c.code, c.title, coalesce(o."groupNumber",0), coalesce(o.capacity,0),
		       coalesce(o."enrolledCount",0), o."universityId",
		       coalesce(nullif(trim(u."firstName" || ' ' || u."lastName"),''), '—')
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		 where o.id = $1 and o."termId" = $2`, offeringID, termID).
		Scan(&out.Offer.OfferingID, &out.Offer.CourseCode, &out.Offer.CourseTitle, &out.Offer.GroupNumber,
			&out.Offer.Capacity, &out.Offer.EnrolledCount, &offUni, &out.Offer.ProfessorName)
	if err != nil {
		return nil, errors.New("گروه مبدأ یافت نشد یا متعلق به این ترم نیست.")
	}
	if offUni == nil {
		return nil, errors.New("دانشگاه گروه نامشخص است.")
	}
	if *offUni != *uniID {
		return nil, errors.New("این گروه متعلق به دانشگاه دیگری است.")
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select e.id, st.id, coalesce(st."studentCode",''), coalesce(u."firstName",''), coalesce(u."lastName",''), e.status
		  from enrollments e
		  join students st on st.id = e."studentId"
		  join users u on u.id = st."userId"
		 where e."offeringId" = $1
		 order by u."lastName", u."firstName" limit 2000`, offeringID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r GroupRosterRow
		if err := rows.Scan(&r.EnrollmentID, &r.StudentID, &r.StudentCode, &r.FirstName, &r.LastName, &r.Status); err == nil {
			out.Roster = append(out.Roster, r)
		}
	}
	return out, nil
}

// TransferTargetGroups: other groups of the same course.
func (s *Service) TransferTargetGroups(ctx context.Context, user *session.User, cookie string, termID, offeringID int64) (map[string]any, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	var courseID int64
	var srcUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select "courseId", "universityId" from course_offerings where id = $1`, offeringID).Scan(&courseID, &srcUni); err != nil {
		return nil, errors.New("گروه مبدأ یافت نشد.")
	}
	if srcUni == nil {
		return nil, errors.New("دانشگاه گروه نامشخص است.")
	}
	if *srcUni != *uniID {
		return nil, errors.New("این گروه متعلق به دانشگاه دیگری است.")
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, coalesce(o."groupNumber",0), coalesce(o."enrolledCount",0), coalesce(o.capacity,0),
		       coalesce(o."isActive",1), c.code, c.title,
		       coalesce(nullif(trim(u."firstName" || ' ' || u."lastName"),''), '—')
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		 where o."termId" = $1 and o."courseId" = $2 and coalesce(o."isActive",1) = 1
		   and o.id <> $3 and o."universityId" = $4
		 order by o."groupNumber" limit 500`, termID, courseID, offeringID, *uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []TransferOffering{}
	var code, title string
	for rows.Next() {
		var t TransferOffering
		var active int
		if err := rows.Scan(&t.OfferingID, &t.GroupNumber, &t.EnrolledCount, &t.Capacity,
			&active, &code, &title, &t.ProfessorName); err == nil {
			t.IsActive = active != 0
			groups = append(groups, t)
		}
	}
	res := map[string]any{"groups": groups}
	if code != "" || title != "" {
		res["course"] = map[string]any{"courseId": courseID, "code": code, "title": title}
	}
	return res, nil
}

type transferCtx struct {
	EnrollmentID int64
	StudentID    int64
	TermID       int64
}

type transferGates struct {
	Warnings        []string
	Blocks          []string
	CapacityBlocked bool
	ConflictBlocked bool
}

type transferSched struct {
	OfferingID int64
	Type       string
	Day        *int
	Start      *string
	End        *string
	ExamDate   *string
}

func (s *Service) transferConflicts(ctx context.Context, c transferCtx, toOfferingID int64) ([]string, []string) {
	warnings, blocks := []string{}, []string{}
	rows, err := s.DB.Pool.Query(ctx, `
		select e."offeringId", c.title
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1 and o."termId" = $2
		   and e.status in ('REGISTERED','WAITLISTED','PENDING_COUNCIL') and e.id <> $3`,
		c.StudentID, c.TermID, c.EnrollmentID)
	if err != nil {
		return warnings, blocks
	}
	titleBy := map[int64]string{}
	otherIDs := []int64{}
	for rows.Next() {
		var oid int64
		var title string
		if err := rows.Scan(&oid, &title); err == nil {
			titleBy[oid] = title
			otherIDs = append(otherIDs, oid)
		}
	}
	rows.Close()
	if len(otherIDs) == 0 {
		return warnings, blocks
	}
	sched := func(offeringIDs []int64) []transferSched {
		out := []transferSched{}
		srows, err := s.DB.Pool.Query(ctx, `
			select "offeringId", "scheduleType", "dayOfWeek", to_char("startTime",'HH24:MI'),
			       to_char("endTime",'HH24:MI'), "examDate"::text
			  from schedules where "offeringId" = any($1) and "scheduleType" in ('CLASS','EXAM')`, offeringIDs)
		if err != nil {
			return out
		}
		defer srows.Close()
		for srows.Next() {
			var sl transferSched
			if err := srows.Scan(&sl.OfferingID, &sl.Type, &sl.Day, &sl.Start, &sl.End, &sl.ExamDate); err == nil {
				out = append(out, sl)
			}
		}
		return out
	}
	target := sched([]int64{toOfferingID})
	others := sched(otherIDs)
	for _, a := range target {
		if a.Type == "EXAM" {
			continue
		}
		if a.Day == nil {
			continue
		}
		for _, b := range others {
			if b.Type == "EXAM" || b.Day == nil || *a.Day != *b.Day {
				continue
			}
			if a.Start != nil && b.Start != nil && a.End != nil && b.End != nil &&
				rangesOverlap(*a.Start, *a.End, *b.Start, *b.End) {
				warnings = append(warnings, fmt.Sprintf("تداخل هفتگی: کلاس گروه مقصد با «%s» (روز %d).", titleBy[b.OfferingID], *a.Day))
			}
		}
	}
	for _, a := range target {
		if a.Type != "EXAM" || a.ExamDate == nil {
			continue
		}
		for _, b := range others {
			if b.Type != "EXAM" || b.ExamDate == nil || *a.ExamDate != *b.ExamDate {
				continue
			}
			clash := a.Start != nil && b.Start != nil && a.End != nil && b.End != nil &&
				rangesOverlap(*a.Start, *a.End, *b.Start, *b.End)
			if clash {
				blocks = append(blocks, fmt.Sprintf("تداخل قطعی امتحان: گروه مقصد با «%s» در %s و همان ساعت.", titleBy[b.OfferingID], *a.ExamDate))
			} else {
				warnings = append(warnings, fmt.Sprintf("تداخل نرم امتحان (هم‌روز، ساعت متفاوت): گروه مقصد با «%s» در %s.", titleBy[b.OfferingID], *a.ExamDate))
			}
		}
	}
	return warnings, blocks
}

// TransferStudent: transfer one enrollment with regulation gates.
func (s *Service) TransferStudent(ctx context.Context, user *session.User, cookie string, enrollmentID, toOfferingID int64, overrideReason string) *TransferResult {
	uniID := s.UniversityID(ctx, user, cookie)
	fail := func(msg string) *TransferResult { return &TransferResult{OK: false, Error: &msg} }
	if uniID == nil {
		return fail("دانشگاه فعال نامشخص است.")
	}
	reason := strings.TrimSpace(overrideReason)
	hasOverride := len([]rune(reason)) >= 5

	var studentID, fromOfferingID, fromTermID int64
	var status string
	var enrUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select "studentId", "offeringId", status, "universityId" from enrollments where id = $1`, enrollmentID).
		Scan(&studentID, &fromOfferingID, &status, &enrUni); err != nil {
		return fail("ثبت‌نام یافت نشد.")
	}
	if status != "REGISTERED" {
		return fail(fmt.Sprintf("فقط ثبت‌نام قطعی (REGISTERED) قابل انتقال است (وضعیت فعلی: %s).", status))
	}
	if fromOfferingID == toOfferingID {
		return fail("گروه مبدأ و مقصد یکی است.")
	}
	var fromCourseID, toCourseID, toTermID int64
	var fromCap, fromEnrolled, toCap, toEnrolled, toActive int
	var fromGroup, toGroup int
	var fromUni, toUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select "courseId","termId",coalesce("groupNumber",0),coalesce(capacity,0),coalesce("enrolledCount",0),"universityId"
		  from course_offerings where id = $1`, fromOfferingID).
		Scan(&fromCourseID, &fromTermID, &fromGroup, &fromCap, &fromEnrolled, &fromUni); err != nil {
		return fail("گروه مبدأ یافت نشد.")
	}
	if err := s.DB.Pool.QueryRow(ctx, `
		select "courseId","termId",coalesce("groupNumber",0),coalesce(capacity,0),coalesce("enrolledCount",0),
		       coalesce("isActive",1),"universityId"
		  from course_offerings where id = $1`, toOfferingID).
		Scan(&toCourseID, &toTermID, &toGroup, &toCap, &toEnrolled, &toActive, &toUni); err != nil {
		return fail("گروه مقصد یافت نشد یا غیرفعال است.")
	}
	if toActive == 0 {
		return fail("گروه مقصد یافت نشد یا غیرفعال است.")
	}
	if fromCourseID != toCourseID {
		return fail("گروه مقصد از درس دیگری است — انتقال فقط بین گروه‌های یک درس مجاز است.")
	}
	if fromTermID != toTermID {
		return fail("گروه مقصد در ترم دیگری است.")
	}
	var dup int
	if err := s.DB.Pool.QueryRow(ctx, `select 1 from enrollments where "studentId" = $1 and "offeringId" = $2 limit 1`,
		studentID, toOfferingID).Scan(&dup); err == nil {
		return fail("این دانشجو همین‌الان در گروه مقصد ثبت است.")
	}
	if fromUni == nil || toUni == nil {
		return fail("دانشگاه گروه‌ها نامشخص است.")
	}
	if *fromUni != *uniID || *toUni != *uniID {
		return fail("گروه‌ها متعلق به دانشگاه دیگری هستند.")
	}
	var stuUni *int64
	var stuStatus string
	var extraProb, extraSem int
	if err := s.DB.Pool.QueryRow(ctx, `
		select "universityId", status, coalesce("extraAllowedProbations",0), coalesce("extraAllowedSemesters",0)
		  from students where id = $1`, studentID).Scan(&stuUni, &stuStatus, &extraProb, &extraSem); err != nil {
		return fail("دانشجو یافت نشد.")
	}
	if stuUni == nil || *stuUni != *uniID {
		return fail("این دانشجو از دانشگاه دیگری است.")
	}

	gates := transferGates{Warnings: []string{}, Blocks: []string{}}
	if toCap > 0 && toEnrolled+1 > toCap {
		gates.CapacityBlocked = true
		gates.Blocks = append(gates.Blocks, fmt.Sprintf("ظرفیت گروه مقصد تکمیل است (%s/%s) — برای تخطی، «انتقال با دلیل» لازم است.",
			jalali.GroupThousands(float64(toEnrolled)), jalali.GroupThousands(float64(toCap))))
	}
	if stuStatus == "BLOCKED_COMMISSION" {
		gates.Blocks = append(gates.Blocks, "پروندهٔ دانشجو توسط کمیسیون موارد خاص مسدود است.")
	} else if stuStatus != "ACTIVE" && stuStatus != "PROBATION" {
		gates.Blocks = append(gates.Blocks, fmt.Sprintf("وضعیت دانشجو برای ادامهٔ ثبت فعال نیست (%s).", stuStatus))
	} else if stuStatus == "PROBATION" {
		gates.Warnings = append(gates.Warnings, "دانشجو در وضعیت «مشروط» است.")
	}
	if summary, err := enroll.EvaluateStudentRegulationStatus(ctx, s.DB.Pool, studentID, &fromTermID); err == nil && summary != nil {
		maxProb := 3 + extraProb
		maxSem := 8 + extraSem - summary.EquivalenceSemesters
		if summary.TotalProbations >= maxProb {
			gates.Blocks = append(gates.Blocks, fmt.Sprintf("سقف مشروطیت: %d ترم مشروطی از سقف %d ترم — ادامهٔ تحصیل نیازمند کمیسیون است.", summary.TotalProbations, maxProb))
		}
		if summary.CompletedSemesters >= maxSem {
			gates.Blocks = append(gates.Blocks, fmt.Sprintf("پایان سنوات: %d ترم از سقف %d ترم — نیازمند سنوات ارفاقی.", summary.CompletedSemesters, maxSem))
		}
	}
	var cleared *int
	_ = s.DB.Pool.QueryRow(ctx, `
		select "isCleared" from financial_clearances where "studentId" = $1 and "termId" = $2 limit 1`,
		studentID, fromTermID).Scan(&cleared)
	if cleared == nil || *cleared != 1 {
		gates.Warnings = append(gates.Warnings, "تسویهٔ مالی این ترم ثبت نشده است.")
	}
	cw, cb := s.transferConflicts(ctx, transferCtx{EnrollmentID: enrollmentID, StudentID: studentID, TermID: fromTermID}, toOfferingID)
	gates.Warnings = append(gates.Warnings, cw...)
	gates.Blocks = append(gates.Blocks, cb...)
	if len(cb) > 0 {
		gates.ConflictBlocked = true
	}
	if fromCap > 0 {
		afterLeave := fromEnrolled - 1
		if float64(afterLeave) < float64(fromCap)*0.5 {
			if afterLeave < 0 {
				afterLeave = 0
			}
			gates.Warnings = append(gates.Warnings, fmt.Sprintf("گروه مبدأ پس از انتقال به زیر حدنصاب (۵۰٪) می‌رسد (ثبت‌شده: %s/%s).",
				jalali.GroupThousands(float64(afterLeave)), jalali.GroupThousands(float64(fromCap))))
		}
	}
	if len(gates.Blocks) > 0 {
		if !s.settingBool(ctx, "ENROLL_EXPERT_OVERRIDE", true) {
			res := fail("نادیده‌گرفتن آیین‌نامه در حال حاضر غیرمجاز است (تنظیم سازمان).")
			res.Blocks = gates.Blocks
			res.Warnings = gates.Warnings
			return res
		}
		if !hasOverride {
			res := &TransferResult{OK: false, Blocks: gates.Blocks, Warnings: gates.Warnings}
			return res
		}
	}

	overrideVal := 0
	var reasonVal any
	if hasOverride {
		overrideVal = 1
		reasonVal = reason
	}
	council := 0
	if gates.ConflictBlocked {
		council = 1
	}
	var overridden any
	if hasOverride {
		b, _ := json.Marshal(append(append([]string{}, gates.Blocks...), gates.Warnings...))
		overridden = string(b)
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		res := fail("خطا در انتقال.")
		return res
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		update enrollments set "offeringId" = $2, status = 'REGISTERED', "waitlistPosition" = null,
		       "enrolledByUserId" = $3, "enrollOverride" = $4, "enrollOverrideReason" = $5,
		       "councilRuling" = $6, "overriddenRules" = $7 where id = $1`,
		enrollmentID, toOfferingID, user.ID, overrideVal, reasonVal, council, overridden); err != nil {
		res := fail(err.Error())
		return res
	}
	if gates.CapacityBlocked {
		if _, err := tx.Exec(ctx, `update course_offerings set "enrolledCount" = "enrolledCount" + 1 where id = $1`, toOfferingID); err != nil {
			res := fail(err.Error())
			return res
		}
	} else {
		tag, err := tx.Exec(ctx, `
			update course_offerings set "enrolledCount" = "enrolledCount" + 1
			 where id = $1 and (capacity <= 0 or "enrolledCount" < capacity)`, toOfferingID)
		if err != nil || tag.RowsAffected() == 0 {
			res := fail("ظرفیت گروه مقصد در همین لحظه تکمیل شد؛ دوباره تلاش کنید.")
			return res
		}
	}
	if _, err := tx.Exec(ctx, `update course_offerings set "enrolledCount" = greatest("enrolledCount" - 1, 0) where id = $1`, fromOfferingID); err != nil {
		res := fail(err.Error())
		return res
	}
	details := fmt.Sprintf(`{"studentId":%d,"fromOfferingId":%d,"toOfferingId":%d,"termId":%d,"fromGroupNumber":%d,"toGroupNumber":%d,"status":%s,"override":%d,"overrideReason":%s}`,
		studentID, fromOfferingID, toOfferingID, fromTermID, fromGroup, toGroup, jsonQuote(status), overrideVal, jsonQuote(reason))
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "GROUP_TRANSFER", "enrollment", enrollmentID, details); err != nil {
		res := fail(err.Error())
		return res
	}
	if err := tx.Commit(ctx); err != nil {
		res := fail(err.Error())
		return res
	}
	finalWarnings := append([]string{}, gates.Warnings...)
	finalBlocks := []string{}
	if hasOverride {
		for _, b := range gates.Blocks {
			finalWarnings = append(finalWarnings, "⚠ (نادیده گرفته شد) "+b)
		}
		finalBlocks = gates.Blocks
	}
	id := enrollmentID
	return &TransferResult{OK: true, Warnings: finalWarnings, Blocks: finalBlocks, EnrollmentID: &id}
}
