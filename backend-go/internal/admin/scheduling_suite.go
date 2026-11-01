// Scheduling suite — port of the Next.js admin/scheduling module.
//
// Ported from:
//   - afagh-next/src/app/admin/scheduling/actions.ts  (page actions)
//   - afagh-next/src/lib/scheduling-engine.ts         (phases/supply/allocation/quotas/suggestions)
//   - afagh-next/src/lib/scheduling-health.ts         (health checks)
//   - afagh-next/src/lib/class-session-generator.ts   (real session generation)
//
// The pure core lives in backend-go/internal/scheduling (ported from
// scheduling-core.ts). Database-bound logic is implemented here.
//
// Rules: cooperative locks via pg_advisory_xact_lock at each bottleneck,
// atomic transactions + audit_logs hash chain, Persian user-facing errors,
// and fail-closed university scoping (invalid scope => 1 = 0).
package admin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/scheduling"
	"backend-go/internal/session"
)

// ─────────────────────────── helpers ───────────────────────────

// schedAuditValues computes the audit row details/hash (curriculum_ops.go pattern).
func schedAuditValues(action string, entityID int64, details any) (string, string) {
	raw, _ := json.Marshal(details)
	h := sha256.Sum256([]byte("|" + action + "|" + strconv.FormatInt(entityID, 10) + "|" + string(raw)))
	return string(raw), hex.EncodeToString(h[:])
}

// schedAuditTx writes an audit row inside the transaction.
func schedAuditTx(ctx context.Context, tx pgx.Tx, userID *int64, action, entityType string, entityID int64, details any) {
	raw, hash := schedAuditValues(action, entityID, details)
	var prev string
	_ = tx.QueryRow(ctx, `select coalesce(hash,'') from audit_logs order by id desc limit 1`).Scan(&prev)
	_, _ = tx.Exec(ctx, `insert into audit_logs ("actorUserId", action, "entityType", "entityId", details, "prevHash", hash)
		values ($1,$2,$3,$4,$5,$6,$7)`, userID, action, entityType, entityID, raw, prev, hash)
}

// schedAdvisoryLock transaction-scoped advisory lock (same hashtextextended pattern as the Next engine).
func schedAdvisoryLock(ctx context.Context, tx pgx.Tx, ns string, a, b int64) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
		fmt.Sprintf("%s:%d:%d", ns, a, b))
	return err
}

// schedScopeCond condition for "this university or global (NULL) rows" — uniOrGlobal.
// Invalid identifier ⇒ `1 = 0` (the condition is never dropped).
func schedScopeCond(col string, uniID *int64) string {
	if uniID != nil && *uniID > 0 {
		return fmt.Sprintf(`(%s = %d or %s is null)`, col, *uniID, col)
	}
	return `1 = 0`
}

// schedEqCond condition for "this university" — universityEq.
func schedEqCond(col string, uniID *int64) string {
	if uniID != nil && *uniID > 0 {
		return fmt.Sprintf(`%s = %d`, col, *uniID)
	}
	return `1 = 0`
}

// AssertSchedTermInUni verifies that a term belongs to the active university
// (or is a global row). Read-only engines that take a raw termId from the
// client must call this before querying schedules/rooms to prevent cross-tenant
// data exposure.
func (s *Service) AssertSchedTermInUni(ctx context.Context, termID int64, uniID *int64) error {
	if termID <= 0 {
		return errors.New("نیمسال نامعتبر است.")
	}
	var ok bool
	q := `select exists(select 1 from academic_terms where id = $1 and ` + schedScopeCond(`"universityId"`, uniID) + `)`
	if err := s.DB.Pool.QueryRow(ctx, q, termID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return errors.New("نیمسال انتخابی متعلق به دانشگاه فعال نیست.")
	}
	return nil
}

// schedHM normalizes a time to HH:MM (input from to_char or a raw string).
func schedHM(t *string) string {
	if t == nil {
		return ""
	}
	v := *t
	if len(v) >= 5 {
		return v[:5]
	}
	return v
}

// schedHhmmss "HH:MM" → "HH:MM:00".
func schedHhmmss(t string) string {
	if len(t) == 5 {
		return t + ":00"
	}
	return t
}

// schedToHHMM minutes since midnight → "HH:MM".
func schedToHHMM(minutes int) string {
	return fmt.Sprintf("%02d:%02d", minutes/60, minutes%60)
}

// schedResolveStaffID converts userId → staffId for *ByStaffId columns.
func schedResolveStaffID(ctx context.Context, q interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}, userID *int64) *int64 {
	if userID == nil || *userID == 0 {
		return nil
	}
	var id int64
	if err := q.QueryRow(ctx, `select id from staff where "userId" = $1 limit 1`, *userID).Scan(&id); err != nil {
		return nil
	}
	return &id
}

// schedStateOfTerm current phase of the term (default SUPPLY).
func schedStateOfTerm(ctx context.Context, q interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}, termID int64) (id int64, phase string) {
	phase = "SUPPLY"
	err := q.QueryRow(ctx, `select id, phase from term_scheduling_states where "termId" = $1 limit 1`, termID).Scan(&id, &phase)
	if err != nil {
		return 0, "SUPPLY"
	}
	return id, phase
}

// ─────────────────────────── workspace output types ───────────────────────────

// SchedTermOption term for the picker.
type SchedTermOption struct {
	ID        int64  `json:"id"`
	Code      string `json:"code"`
	Title     string `json:"title"`
	IsCurrent bool   `json:"isCurrent"`
}

// SchedProgramOption major/degree/faculty.
type SchedProgramOption struct {
	ID          int64  `json:"id"`
	Code        string `json:"code"`
	Title       string `json:"title"`
	FacultyName string `json:"facultyName"`
	DegreeLevel string `json:"degreeLevel"`
	FacultyID   *int64 `json:"facultyId"`
}

// SchedCohort academic entry cohort.
type SchedCohort struct {
	EntryYear        int `json:"entryYear"`
	ExpectedStudents int `json:"expectedStudents"`
}

// SchedClassroomOption classroom.
type SchedClassroomOption struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	BuildingName string `json:"buildingName"`
	Capacity     int    `json:"capacity"`
	RoomType     string `json:"roomType"`
}

// SchedProfessorOption professor.
type SchedProfessorOption struct {
	ID             int64   `json:"id"`
	Name           string  `json:"name"`
	StaffCode      *string `json:"staffCode"`
	AcademicRank   *string `json:"academicRank"`
	DepartmentName *string `json:"departmentName"`
}

// SchedAvailabilityRow professor availability row.
type SchedAvailabilityRow struct {
	StaffID   int64   `json:"staffId"`
	DayOfWeek *int    `json:"dayOfWeek"`
	StartTime *string `json:"startTime"`
	EndTime   *string `json:"endTime"`
	Status    string  `json:"status"`
}

// SchedDemand course demand (one group of one offering).
type SchedDemand struct {
	OfferingID      int64  `json:"offeringId"`
	CourseID        int64  `json:"courseId"`
	CourseDeptID    *int64 `json:"courseDeptId"`
	Code            string `json:"code"`
	Title           string `json:"title"`
	Units           string `json:"units"`
	CourseType      string `json:"courseType"`
	Capacity        int    `json:"capacity"`
	GroupNumber     int    `json:"groupNumber"`
	ProfessorID     *int64 `json:"professorId"`
	IsCoTaught      bool   `json:"isCoTaught"`
	EnrolledCount   int    `json:"enrolledCount"`
	ProgramID       int64  `json:"programId"`
	ProgramTitle    string `json:"programTitle"`
	CohortID        string `json:"cohortId"`
	CohortTitle     string `json:"cohortTitle"`
	IsSharedService bool   `json:"isSharedService"`
	OfferingScope   string `json:"offeringScope"`
}

// SchedApprovedOffering approved class (schedules row).
type SchedApprovedOffering struct {
	OfferingID    int64  `json:"offeringId"`
	Code          string `json:"code"`
	Title         string `json:"title"`
	Units         string `json:"units"`
	CourseType    string `json:"courseType"`
	GroupNumber   int    `json:"groupNumber"`
	ProfessorID   *int64 `json:"professorId"`
	ProfessorName string `json:"professorName"`
	Capacity      int    `json:"capacity"`
	EnrolledCount int    `json:"enrolledCount"`
	DayOfWeek     *int   `json:"dayOfWeek"`
	DayName       string `json:"dayName"`
	StartTime     string `json:"startTime"`
	EndTime       string `json:"endTime"`
	RoomID        *int64 `json:"roomId"`
	RoomName      string `json:"roomName"`
	BuildingName  string `json:"buildingName"`
}

// SchedMakeupSession makeup session.
type SchedMakeupSession struct {
	ID                int64  `json:"id"`
	CourseCode        string `json:"courseCode"`
	CourseTitle       string `json:"courseTitle"`
	ProfName          string `json:"profName"`
	SessionNo         int    `json:"sessionNo"`
	SessionDate       string `json:"sessionDate"`
	SessionTime       string `json:"sessionTime"`
	ReplacedSessionID *int64 `json:"replacedSessionId"`
}

// SchedTermCalendar term calendar from the academic_terms row.
type SchedTermCalendar struct {
	ID          int64   `json:"id"`
	StartJalali *string `json:"startJalali"`
	EndJalali   *string `json:"endJalali"`
	StartDate   *string `json:"startDate"`
}

// SchedOfferingSessionSummary summary of sessions per offering.
type SchedOfferingSessionSummary struct {
	Total     int     `json:"total"`
	Makeup    int     `json:"makeup"`
	FirstDate *string `json:"firstDate"`
}

// SchedulingWorkspace full workspace output (port of getSchedulingWorkspaceAction).
type SchedulingWorkspace struct {
	Terms              []SchedTermOption                     `json:"terms"`
	SelectedTermID     *int64                                `json:"selectedTermId"`
	Programs           []SchedProgramOption                  `json:"programs"`
	Cohorts            []SchedCohort                         `json:"cohorts"`
	Classrooms         []SchedClassroomOption                `json:"classrooms"`
	AllocatedRoomIDs   []int64                               `json:"allocatedRoomIds"`
	Professors         []SchedProfessorOption                `json:"professors"`
	Demands            []SchedDemand                         `json:"demands"`
	Departments        []map[string]any                      `json:"departments"`
	Availabilities     []SchedAvailabilityRow                `json:"availabilities"`
	Phases             map[int64]string                      `json:"phases"`
	TermCalendar       *SchedTermCalendar                    `json:"termCalendar"`
	SessionsTotal      int                                   `json:"sessionsTotal"`
	SessionsByOffering map[int64]SchedOfferingSessionSummary `json:"sessionsByOffering"`
	HardConflictCount  int                                   `json:"hardConflictCount"`
	ApprovedOfferings  []SchedApprovedOffering               `json:"approvedOfferings"`
	MakeupSessions     []SchedMakeupSession                  `json:"makeupSessions"`
}

var schedDayNames = []string{"شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"}

func schedDayName(d *int) string {
	if d == nil || *d < 0 || *d >= len(schedDayNames) {
		return "—"
	}
	return schedDayNames[*d]
}

// ─────────────────────────── raw workspace queries ───────────────────────────

// schedListTerms real terms.
func (s *Service) schedListTerms(ctx context.Context, uniID *int64) []SchedTermOption {
	out := []SchedTermOption{}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "termCode", title, coalesce("isCurrent",0)
		  from academic_terms where `+schedScopeCond(`"universityId"`, uniID)+`
		 order by id desc`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r SchedTermOption
		var cur int
		if err := rows.Scan(&r.ID, &r.Code, &r.Title, &cur); err == nil {
			r.IsCurrent = cur == 1
			out = append(out, r)
		}
	}
	return out
}

// schedListPrograms programs = majors + faculty (active only).
func (s *Service) schedListPrograms(ctx context.Context, uniID *int64) []SchedProgramOption {
	out := []SchedProgramOption{}
	rows, err := s.DB.Pool.Query(ctx, `
		select m.id, coalesce(m."majorCode", m.id::text), m.name,
		       coalesce(f.name, '—'), coalesce(d.title, '—'),
		       m."facultyId", dep."facultyId"
		  from majors m
		  left join degree_level_configs d on d.id = m."degreeLevelId"
		  left join departments dep on dep.id = m."departmentId"
		  left join faculties f on f.id = m."facultyId"
		 where coalesce(m."isActive",1) = 1 and `+schedEqCond(`m."universityId"`, uniID)+`
		 order by m.name`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r SchedProgramOption
		if err := rows.Scan(&r.ID, &r.Code, &r.Title, &r.FacultyName, &r.DegreeLevel, &r.FacultyID, &r.FacultyID); err == nil {
			out = append(out, r)
		}
	}
	return out
}

// schedListCohorts real student entry cohorts.
func (s *Service) schedListCohorts(ctx context.Context, uniID *int64) []SchedCohort {
	out := []SchedCohort{}
	rows, err := s.DB.Pool.Query(ctx, `
		select st."entryYear", count(*)::int
		  from students st join majors m on m.id = st."majorId"
		 where `+schedEqCond(`st."universityId"`, uniID)+`
		 group by st."entryYear" order by st."entryYear" desc`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r SchedCohort
		if err := rows.Scan(&r.EntryYear, &r.ExpectedStudents); err == nil {
			out = append(out, r)
		}
	}
	return out
}

// schedListClassrooms real classrooms.
func (s *Service) schedListClassrooms(ctx context.Context, uniID *int64) []SchedClassroomOption {
	out := []SchedClassroomOption{}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, name, coalesce("buildingName",'—'), capacity, coalesce("roomType",'THEORY')
		  from classrooms where `+schedEqCond(`"universityId"`, uniID))
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r SchedClassroomOption
		if err := rows.Scan(&r.ID, &r.Name, &r.BuildingName, &r.Capacity, &r.RoomType); err == nil {
			out = append(out, r)
		}
	}
	return out
}

// schedListProfessors real professors (staff + users + department).
func (s *Service) schedListProfessors(ctx context.Context, uniID *int64) []SchedProfessorOption {
	out := []SchedProfessorOption{}
	rows, err := s.DB.Pool.Query(ctx, `
		select st.id, coalesce(u."firstName",''), u."lastName", st."staffCode", st."academicRank", d.name
		  from staff st
		  join users u on u.id = st."userId"
		  left join departments d on d.id = st."departmentId"
		 where coalesce(st."isActive",1) = 1 and `+schedEqCond(`st."universityId"`, uniID)+`
		 order by st.id`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r SchedProfessorOption
		var first, last string
		if err := rows.Scan(&r.ID, &first, &last, &r.StaffCode, &r.AcademicRank, &r.DepartmentName); err == nil {
			r.Name = strings.TrimSpace(first + " " + last)
			out = append(out, r)
		}
	}
	return out
}

// schedListDemands real demand: courses with an offering in this term.
func (s *Service) schedListDemands(ctx context.Context, termID int64, uniID *int64) []SchedDemand {
	out := []SchedDemand{}
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.id, c."departmentId", c.code, c.title, c."units"::text,
		       coalesce(c."courseType",'عمومی'), o.capacity, o."groupNumber", o."professorId",
		       o."enrolledCount", o."targetMajorId", m.name, o."entryYearStart", o."entryYearEnd",
		       o."isSharedService", coalesce(c."offeringScope",'DEPARTMENTAL')
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join majors m on m.id = o."targetMajorId"
		 where o."termId" = $1 and `+schedEqCond(`o."universityId"`, uniID)+`
		 order by c.code`, termID)
	if err != nil {
		return out
	}
	coTaught := map[int64]bool{}
	prows, perr := s.DB.Pool.Query(ctx, `
		select op."offeringId" from offering_professors op
		  join course_offerings o on o.id = op."offeringId"
		 where o."termId" = $1 and `+schedEqCond(`o."universityId"`, uniID)+`
		 group by op."offeringId" having count(*) > 1`, termID)
	if perr == nil {
		for prows.Next() {
			var id int64
			if prows.Scan(&id) == nil {
				coTaught[id] = true
			}
		}
		prows.Close()
	}
	defer rows.Close()
	for rows.Next() {
		var r SchedDemand
		var targetMajorID *int64
		var majorName *string
		var yearStart, yearEnd *int
		var shared int
		if err := rows.Scan(&r.OfferingID, &r.CourseID, &r.CourseDeptID, &r.Code, &r.Title, &r.Units,
			&r.CourseType, &r.Capacity, &r.GroupNumber, &r.ProfessorID,
			&r.EnrolledCount, &targetMajorID, &majorName, &yearStart, &yearEnd,
			&shared, &r.OfferingScope); err != nil {
			continue
		}
		if targetMajorID != nil {
			r.ProgramID = *targetMajorID
		}
		r.ProgramTitle = "همهٔ رشته‌ها"
		if majorName != nil {
			r.ProgramTitle = *majorName
		}
		if yearStart != nil && yearEnd != nil && *yearStart == *yearEnd {
			r.CohortID = strconv.Itoa(*yearStart)
			r.CohortTitle = fmt.Sprintf("ورودی %d", *yearStart)
		} else {
			r.CohortID = "ALL"
			r.CohortTitle = "کلیهٔ ورودی‌ها"
		}
		r.IsCoTaught = coTaught[r.OfferingID]
		r.IsSharedService = shared == 1
		out = append(out, r)
	}
	return out
}

// schedCurriculumVersionID published/archived curriculum version for the major + term entry year.
func (s *Service) schedCurriculumVersionID(ctx context.Context, uniID *int64, termID, programID int64) (*int64, int, error) {
	var termYear *int
	var isSummer, sortOrder *int
	if err := s.DB.Pool.QueryRow(ctx, `
		select "academicYear", "isSummer", "sortOrder" from academic_terms
		 where id = $1 and `+schedScopeCond(`"universityId"`, uniID), termID).
		Scan(&termYear, &isSummer, &sortOrder); err != nil {
		return nil, 0, nil
	}
	var majorDegree *int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select "degreeLevelId" from majors where id = $1 and `+schedScopeCond(`"universityId"`, uniID), programID).
		Scan(&majorDegree); err != nil || majorDegree == nil {
		return nil, 0, nil
	}

	currentSemester := 1
	if isSummer != nil && *isSummer == 1 {
		currentSemester = 9
	} else if sortOrder != nil && *sortOrder > 0 {
		currentSemester = ((*sortOrder - 1) % 2) + 1
	}
	if termYear == nil {
		return nil, currentSemester, nil
	}

	var cvID int64
	err := s.DB.Pool.QueryRow(ctx, `
		select cv.id from curriculum_versions cv
		 where cv."majorId" = $1 and cv."degreeLevelId" = $2
		   and `+schedEqCond(`cv."universityId"`, uniID)+`
		   and cv.status in ('PUBLISHED','ARCHIVED')
		   and $3 between cv."entryYearFrom" and coalesce(cv."entryYearTo", 9999)
		 order by cv.id desc limit 1`, programID, *majorDegree, *termYear).Scan(&cvID)
	if err != nil {
		return nil, currentSemester, nil
	}
	return &cvID, currentSemester, nil
}

// schedDemandRaw raw demand query row — before coTaught/cohort/program decoration.
type schedDemandRaw struct {
	SchedDemand
	targetMajorID *int64
	majorName     *string
	yearStart     *int
	yearEnd       *int
	shared        int
}

// schedListCurriculumDemands curriculum-based demand for a major.
func (s *Service) schedListCurriculumDemands(ctx context.Context, termID, programID int64, uniID *int64) []SchedDemand {
	cvID, currentSemester, _ := s.schedCurriculumVersionID(ctx, uniID, termID, programID)
	if cvID == nil {
		return []SchedDemand{}
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.id, c."departmentId", c.code, c.title, c."units"::text,
		       coalesce(c."courseType",'عمومی'), o.capacity, o."groupNumber", o."professorId",
		       o."enrolledCount", o."targetMajorId", m.name, o."entryYearStart", o."entryYearEnd",
		       o."isSharedService", coalesce(c."offeringScope",'DEPARTMENTAL')
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join majors m on m.id = o."targetMajorId"
		 where o."termId" = $1 and c.id in (
		       select cc."courseId" from curriculum_courses cc
		        where cc."curriculumVersionId" = $2
		          and (cc."recommendedSemester" = $3 or cc."recommendedSemester" is null))
		   and `+schedScopeCond(`o."universityId"`, uniID)+`
		 order by c.code`, termID, *cvID, currentSemester)
	if err != nil {
		return []SchedDemand{}
	}
	defer rows.Close()

	raws := []schedDemandRaw{}
	for rows.Next() {
		var r schedDemandRaw
		if err := rows.Scan(&r.OfferingID, &r.CourseID, &r.CourseDeptID, &r.Code, &r.Title, &r.Units,
			&r.CourseType, &r.Capacity, &r.GroupNumber, &r.ProfessorID,
			&r.EnrolledCount, &r.targetMajorID, &r.majorName, &r.yearStart, &r.yearEnd,
			&r.shared, &r.OfferingScope); err != nil {
			continue
		}
		raws = append(raws, r)
	}
	return s.schedDecorateDemands(ctx, raws)
}

// schedDecorateDemands shared mapping of a raw demand row (coTaught/cohort/program).
func (s *Service) schedDecorateDemands(ctx context.Context, raws []schedDemandRaw) []SchedDemand {
	out := []SchedDemand{}
	ids := make([]int64, 0, len(raws))
	for _, r := range raws {
		ids = append(ids, r.OfferingID)
	}
	coTaught := map[int64]bool{}
	if len(ids) > 0 {
		prows, err := s.DB.Pool.Query(ctx, `
			select op."offeringId" from offering_professors op
			 where op."offeringId" = any($1)
			 group by op."offeringId" having count(*) > 1`, ids)
		if err == nil {
			for prows.Next() {
				var id int64
				if prows.Scan(&id) == nil {
					coTaught[id] = true
				}
			}
			prows.Close()
		}
	}
	for _, r := range raws {
		d := r.SchedDemand
		if r.targetMajorID != nil {
			d.ProgramID = *r.targetMajorID
		}
		d.ProgramTitle = "همهٔ رشته‌ها"
		if r.majorName != nil {
			d.ProgramTitle = *r.majorName
		}
		if r.yearStart != nil && r.yearEnd != nil && *r.yearStart == *r.yearEnd {
			d.CohortID = strconv.Itoa(*r.yearStart)
			d.CohortTitle = fmt.Sprintf("ورودی %d", *r.yearStart)
		} else {
			d.CohortID = "ALL"
			d.CohortTitle = "کلیهٔ ورودی‌ها"
		}
		d.IsCoTaught = coTaught[d.OfferingID]
		d.IsSharedService = r.shared == 1
		out = append(out, d)
	}
	return out
}

// schedListApprovedOfferings real approved schedule (schedules with scheduleType='CLASS').
func (s *Service) schedListApprovedOfferings(ctx context.Context, termID int64, uniID *int64) []SchedApprovedOffering {
	out := []SchedApprovedOffering{}
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.code, c.title, c."units"::text, coalesce(c."courseType",'عمومی'),
		       o."groupNumber", o."professorId", u."firstName", u."lastName",
		       o.capacity, o."enrolledCount", sc."dayOfWeek", to_char(sc."startTime",'HH24:MI'),
		       to_char(sc."endTime",'HH24:MI'), sc."roomId", cr.name, cr."buildingName"
		  from schedules sc
		  join course_offerings o on o.id = sc."offeringId"
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		  left join classrooms cr on cr.id = sc."roomId"
		 where sc."scheduleType" = 'CLASS' and o."termId" = $1
		   and sc."dayOfWeek" is not null
		   and `+schedEqCond(`o."universityId"`, uniID)+`
		 order by c.code, o."groupNumber"`, termID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r SchedApprovedOffering
		var first, last *string
		var start, end string
		if err := rows.Scan(&r.OfferingID, &r.Code, &r.Title, &r.Units, &r.CourseType,
			&r.GroupNumber, &r.ProfessorID, &first, &last,
			&r.Capacity, &r.EnrolledCount, &r.DayOfWeek, &start, &end,
			&r.RoomID, &r.RoomName, &r.BuildingName); err != nil {
			continue
		}
		if first != nil {
			r.ProfessorName = strings.TrimSpace(*first + " " + derefStr(last))
		} else {
			r.ProfessorName = "تخصیص‌نیافته"
		}
		r.DayName = schedDayName(r.DayOfWeek)
		r.StartTime = start
		r.EndTime = end
		if r.RoomName == "" {
			r.RoomName = "—"
		}
		if r.BuildingName == "" {
			r.BuildingName = "—"
		}
		out = append(out, r)
	}
	return out
}

// schedListMakeupSessions real makeup sessions (class_sessions.isMakeUpSession=1).
func (s *Service) schedListMakeupSessions(ctx context.Context, termID int64, uniID *int64) []SchedMakeupSession {
	out := []SchedMakeupSession{}
	rows, err := s.DB.Pool.Query(ctx, `
		select cs.id, c.code, c.title, u."firstName", u."lastName",
		       coalesce(cs."sessionNo",0), cs."sessionDate",
		       coalesce(cs."startTime",''), coalesce(cs."endTime",''), cs."replacedSessionId"
		  from class_sessions cs
		  join course_offerings o on o.id = cs."offeringId"
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		 where cs."isMakeUpSession" = 1 and o."termId" = $1
		   and `+schedEqCond(`o."universityId"`, uniID)+`
		 order by cs."sessionDate"`, termID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r SchedMakeupSession
		var first, last *string
		var start, end string
		if err := rows.Scan(&r.ID, &r.CourseCode, &r.CourseTitle, &first, &last,
			&r.SessionNo, &r.SessionDate, &start, &end, &r.ReplacedSessionID); err != nil {
			continue
		}
		if first != nil {
			r.ProfName = strings.TrimSpace(*first + " " + derefStr(last))
		} else {
			r.ProfName = "—"
		}
		r.SessionTime = start + " تا " + end
		out = append(out, r)
	}
	return out
}

// schedListAllocatedRoomIDs classrooms with an ALLOCATED quota in this term.
func (s *Service) schedListAllocatedRoomIDs(ctx context.Context, termID int64, uniID *int64) []int64 {
	out := []int64{}
	rows, err := s.DB.Pool.Query(ctx, `
		select g."classroomId" from scheduling_room_grants g
		  join classrooms c on c.id = g."classroomId"
		 where g."termId" = $1 and g.status = 'ALLOCATED'
		   and `+schedEqCond(`c."universityId"`, uniID), termID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			out = append(out, id)
		}
	}
	return out
}

// schedSessionsSummary summary of the term's generated sessions (getTermSessionsSummary).
func (s *Service) schedSessionsSummary(ctx context.Context, termID int64) (int, map[int64]SchedOfferingSessionSummary) {
	total := 0
	by := map[int64]SchedOfferingSessionSummary{}
	rows, err := s.DB.Pool.Query(ctx, `
		select cs."offeringId", count(*)::int,
		       coalesce(sum(case when cs."isMakeUpSession" = 1 then 1 else 0 end),0)::int,
		       min(cs."sessionDate")
		  from class_sessions cs
		  join course_offerings o on o.id = cs."offeringId"
		 where o."termId" = $1
		 group by cs."offeringId"`, termID)
	if err != nil {
		return 0, by
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var rec SchedOfferingSessionSummary
		if err := rows.Scan(&id, &rec.Total, &rec.Makeup, &rec.FirstDate); err == nil {
			by[id] = rec
			total += rec.Total
		}
	}
	return total, by
}

// schedLoadTermSchedules reads the real class schedule of a term (loadTermSchedules).
type schedTermScheduleRow struct {
	OfferingID    int64
	DayOfWeek     int
	StartTime     string
	EndTime       string
	RoomID        *int64
	CourseCode    string
	GroupNumber   int
	Capacity      int
	EnrolledCount int
	ProfessorID   *int64
	Recurrence    string
}

func (s *Service) schedLoadTermSchedules(ctx context.Context, q interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}, termID int64) []schedTermScheduleRow {
	out := []schedTermScheduleRow{}
	rows, err := q.Query(ctx, `
		select s."offeringId", s."dayOfWeek", to_char(s."startTime",'HH24:MI'),
		       to_char(s."endTime",'HH24:MI'), s."roomId",
		       coalesce(c.code, '#' || s."offeringId"::text),
		       o."groupNumber", o.capacity, coalesce(o."enrolledCount",0), o."professorId",
		       coalesce(s."scheduleType",'ALL')
		  from schedules s
		  join course_offerings o on o.id = s."offeringId"
		  left join courses c on c.id = o."courseId"
		 where o."termId" = $1 and s."scheduleType" = 'CLASS' and s."dayOfWeek" is not null
		 order by s."offeringId", s."dayOfWeek"`, termID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r schedTermScheduleRow
		var recurrence string
		if err := rows.Scan(&r.OfferingID, &r.DayOfWeek, &r.StartTime, &r.EndTime, &r.RoomID,
			&r.CourseCode, &r.GroupNumber, &r.Capacity, &r.EnrolledCount, &r.ProfessorID,
			&recurrence); err != nil {
			continue
		}
		// same as Next: scheduleType 'CLASS' → mapped to 'ALL'
		if recurrence != "ALL" && recurrence != "EVEN" && recurrence != "ODD" {
			recurrence = "ALL"
		}
		r.Recurrence = recurrence
		out = append(out, r)
	}
	return out
}

// schedProfessorsByOffering professors (main + secondary Co-Teaching) per offering.
func (s *Service) schedProfessorsByOffering(ctx context.Context, termID int64) map[int64][]int64 {
	out := map[int64][]int64{}
	rows, err := s.DB.Pool.Query(ctx, `
		select op."offeringId", op."staffId" from offering_professors op
		  join course_offerings o on o.id = op."offeringId"
		 where o."termId" = $1`, termID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var o, st int64
		if rows.Scan(&o, &st) == nil {
			out[o] = append(out[o], st)
		}
	}
	return out
}

// schedRoomCapacities classroom capacities.
func (s *Service) schedRoomCapacities(ctx context.Context) map[int64]int {
	out := map[int64]int{}
	rows, err := s.DB.Pool.Query(ctx, `select id, coalesce(capacity,0) from classrooms`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var cap int
		if rows.Scan(&id, &cap) == nil {
			out[id] = cap
		}
	}
	return out
}

// schedConflictEntries builds hard-constraint inputs from the real schedule.
func schedConflictEntries(schedRows []schedTermScheduleRow, profByOffering map[int64][]int64, roomCap map[int64]int) []scheduling.HardConflictEntry {
	entries := make([]scheduling.HardConflictEntry, 0, len(schedRows))
	for _, sr := range schedRows {
		profs := append([]int64{}, profByOffering[sr.OfferingID]...)
		if sr.ProfessorID != nil {
			found := false
			for _, p := range profs {
				if p == *sr.ProfessorID {
					found = true
					break
				}
			}
			if !found {
				profs = append([]int64{*sr.ProfessorID}, profs...)
			}
		}
		start, err1 := scheduling.ToMinutes(sr.StartTime)
		end, err2 := scheduling.ToMinutes(sr.EndTime)
		if err1 != nil || err2 != nil {
			continue
		}
		cap := 0
		if sr.RoomID != nil {
			cap = roomCap[*sr.RoomID]
		}
		entries = append(entries, scheduling.HardConflictEntry{
			OfferingID:    sr.OfferingID,
			GroupNumber:   sr.GroupNumber,
			CourseCode:    sr.CourseCode,
			ProfessorIDs:  profs,
			RoomID:        sr.RoomID,
			DayOfWeek:     sr.DayOfWeek,
			StartMinutes:  start,
			EndMinutes:    end,
			EnrolledCount: sr.EnrolledCount,
			Capacity:      cap,
		})
	}
	return entries
}

// InspectSchedulingHardConflicts detects hard constraints on a term's real schedule.
func (s *Service) InspectSchedulingHardConflicts(ctx context.Context, termID int64) (scheduling.HardConflictReport, int) {
	schedRows := s.schedLoadTermSchedules(ctx, s.DB.Pool, termID)
	profByOffering := s.schedProfessorsByOffering(ctx, termID)
	roomCap := s.schedRoomCapacities(ctx)
	entries := schedConflictEntries(schedRows, profByOffering, roomCap)
	return scheduling.AnalyzeHardConflicts(entries, scheduling.HardConflictListLimit), len(entries)
}

// ─────────────────────────── GetSchedulingWorkspace ───────────────────────────

// GetSchedulingWorkspace port of getSchedulingWorkspaceAction — initial data for all tabs.
func (s *Service) GetSchedulingWorkspace(ctx context.Context, user *session.User, cookie string, termID *int64) (*SchedulingWorkspace, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	w := &SchedulingWorkspace{
		Terms: []SchedTermOption{}, Programs: []SchedProgramOption{}, Cohorts: []SchedCohort{},
		Classrooms: []SchedClassroomOption{}, AllocatedRoomIDs: []int64{},
		Professors: []SchedProfessorOption{}, Demands: []SchedDemand{},
		Departments: []map[string]any{}, Availabilities: []SchedAvailabilityRow{},
		Phases: map[int64]string{}, SessionsByOffering: map[int64]SchedOfferingSessionSummary{},
		ApprovedOfferings: []SchedApprovedOffering{}, MakeupSessions: []SchedMakeupSession{},
	}
	w.Terms = s.schedListTerms(ctx, uniID)
	w.Programs = s.schedListPrograms(ctx, uniID)
	w.Classrooms = s.schedListClassrooms(ctx, uniID)
	w.Professors = s.schedListProfessors(ctx, uniID)

	var deptNames []string
	drows, err := s.DB.Pool.Query(ctx, `
		select id, name from departments where `+schedScopeCond(`"universityId"`, uniID)+` order by name`)
	if err == nil {
		for drows.Next() {
			var id int64
			var name string
			if drows.Scan(&id, &name) == nil {
				deptNames = append(deptNames, name)
				w.Departments = append(w.Departments, map[string]any{"id": id, "name": name})
			}
		}
		drows.Close()
	}

	// Target term: the client input is accepted only if it is one of this university's terms (fail-closed).
	var resolved *int64
	if termID != nil {
		for _, t := range w.Terms {
			if t.ID == *termID {
				v := *termID
				resolved = &v
				break
			}
		}
	}
	if resolved == nil {
		for _, t := range w.Terms {
			if t.IsCurrent {
				v := t.ID
				resolved = &v
				break
			}
		}
	}
	if resolved == nil && len(w.Terms) > 0 {
		v := w.Terms[0].ID
		resolved = &v
	}
	w.SelectedTermID = resolved
	if resolved == nil {
		return w, nil
	}
	termID2 := *resolved

	// Phases
	_ = deptNames
	prows, err := s.DB.Pool.Query(ctx, `
		select "termId", phase from term_scheduling_states where `+schedScopeCond(`"universityId"`, uniID))
	if err == nil {
		for prows.Next() {
			var tid int64
			var ph string
			if prows.Scan(&tid, &ph) == nil {
				w.Phases[tid] = ph
			}
		}
		prows.Close()
	}

	w.Cohorts = s.schedListCohorts(ctx, uniID)

	// Professor availability
	arows, err := s.DB.Pool.Query(ctx, `
		select "staffId", "dayOfWeek",
		       to_char("startTime",'HH24:MI'), to_char("endTime",'HH24:MI'),
		       coalesce(status,'AVAIL')
		  from professor_availabilities
		 where ("termId" = $1 or "termId" is null)
		   and `+schedScopeCond(`"universityId"`, uniID), termID2)
	if err == nil {
		for arows.Next() {
			var r SchedAvailabilityRow
			var st, en *string
			if err := arows.Scan(&r.StaffID, &r.DayOfWeek, &st, &en, &r.Status); err == nil {
				if st != nil {
					v := schedHM(st)
					r.StartTime = &v
				}
				if en != nil {
					v := schedHM(en)
					r.EndTime = &v
				}
				w.Availabilities = append(w.Availabilities, r)
			}
		}
		arows.Close()
	}

	// Hard constraints + term calendar + approved schedule + makeup sessions + quotas
	report, _ := s.InspectSchedulingHardConflicts(ctx, termID2)
	w.HardConflictCount = report.Total

	var startD, endD *time.Time
	_ = s.DB.Pool.QueryRow(ctx, `
		select "startDate", "endDate" from academic_terms
		 where id = $1 and `+schedScopeCond(`"universityId"`, uniID), termID2).
		Scan(&startD, &endD)
	if startD != nil {
		j := scheduling.JalaliDateOf(*startD)
		iso := startD.UTC().Format("2006-01-02T15:04:05.000Z")
		w.TermCalendar = &SchedTermCalendar{ID: termID2, StartJalali: &j, StartDate: &iso}
		if endD != nil {
			e := scheduling.JalaliDateOf(*endD)
			w.TermCalendar.EndJalali = &e
		}
	}

	w.Demands = s.schedListDemands(ctx, termID2, uniID)
	w.ApprovedOfferings = s.schedListApprovedOfferings(ctx, termID2, uniID)
	w.MakeupSessions = s.schedListMakeupSessions(ctx, termID2, uniID)
	w.AllocatedRoomIDs = s.schedListAllocatedRoomIDs(ctx, termID2, uniID)
	w.SessionsTotal, w.SessionsByOffering = s.schedSessionsSummary(ctx, termID2)
	return w, nil
}

// ─────────────────────────── GetCurriculumDemands ───────────────────────────

// GetCurriculumDemands port of getCurriculumDemandsAction — courses of a major's curriculum.
func (s *Service) GetCurriculumDemands(ctx context.Context, user *session.User, cookie string, termID, programID int64) ([]SchedDemand, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	return s.schedListCurriculumDemands(ctx, termID, programID, uniID), nil
}

// ─────────────────────────── phase transition ───────────────────────────

// SchedPhaseResult phase transition result.
type SchedPhaseResult struct {
	Phase string `json:"phase"`
	From  string `json:"from"`
}

// TransitionSchedulingPhase port of transitionSchedulingPhaseAction —
// SUPPLY→ALLOCATION→REVIEW→PUBLISHED step by step; publish only without hard constraints.
func (s *Service) TransitionSchedulingPhase(ctx context.Context, user *session.User, cookie string, termID int64, to string) (*SchedPhaseResult, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	var termExists int
	if err := s.DB.Pool.QueryRow(ctx, `
		select count(*) from academic_terms where id = $1 and `+schedScopeCond(`"universityId"`, uniID), termID).Scan(&termExists); err != nil || termExists == 0 {
		return nil, errors.New("ترم متعلق به دانشگاه دیگری است.")
	}
	actorID := user.ID

	if to == "PUBLISHED" {
		report, _ := s.InspectSchedulingHardConflicts(ctx, termID)
		if report.Total > 0 {
			sample := ""
			if len(report.Conflicts) > 0 {
				sample = report.Conflicts[0].Message
			}
			return nil, fmt.Errorf("انتشار برنامه متوقف شد: %d قید سخت (تداخل استاد/سالن/ظرفیت) باقی است. نمونه: %s", report.Total, sample)
		}
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := schedAdvisoryLock(ctx, tx, "sched_phase", termID, 0); err != nil {
		return nil, err
	}
	stateID, fromPhase := schedStateOfTerm(ctx, tx, termID)
	if !scheduling.CanTransition(fromPhase, to) {
		return nil, fmt.Errorf("گذار فاز %s → %s مجاز نیست (فازها پلهای‌اند).", fromPhase, to)
	}
	var staffID *int64
	if to == "PUBLISHED" {
		staffID = schedResolveStaffID(ctx, tx, &actorID)
	}
	if stateID != 0 {
		if _, err := tx.Exec(ctx, `
			update term_scheduling_states set phase = $1,
			       "publishedAt" = case when $1 = 'PUBLISHED' then now() else "publishedAt" end,
			       "publishedByStaffId" = case when $1 = 'PUBLISHED' then $2 else "publishedByStaffId" end
			 where id = $3`, to, staffID, stateID); err != nil {
			return nil, err
		}
	} else {
		if _, err := tx.Exec(ctx, `
			insert into term_scheduling_states ("termId", phase, "publishedAt", "publishedByStaffId", "universityId")
			values ($1,$2, case when $2 = 'PUBLISHED' then now() else null end, $3, $4)`,
			termID, to, staffID, uniID); err != nil {
			return nil, err
		}
	}
	schedAuditTx(ctx, tx, &actorID, "SCHEDULING_PHASE_TRANSITION", "academic_term", termID,
		map[string]any{"from": fromPhase, "to": to})
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &SchedPhaseResult{Phase: to, From: fromPhase}, nil
}

// ─────────────────────────── course group supply ───────────────────────────

// SchedSupplyDraft one course group to supply.
type SchedSupplyDraft struct {
	GroupNumber int    `json:"groupNumber"`
	Capacity    int    `json:"capacity"`
	Gender      string `json:"gender"`
	ProfessorID int64  `json:"professorId"`
	ClassroomID int64  `json:"classroomId"`
	DayOfWeek   int    `json:"dayOfWeek"`
	StartTime   string `json:"startTime"`
	EndTime     string `json:"endTime"`
}

// SchedSupplyInput group supply input.
type SchedSupplyInput struct {
	TermID            int64              `json:"termId"`
	CourseID          int64              `json:"courseId"`
	OwnerDepartmentID int64              `json:"ownerDepartmentId"`
	IsSharedService   bool               `json:"isSharedService"`
	Drafts            []SchedSupplyDraft `json:"drafts"`
}

// SchedSupplyResult supply result.
type SchedSupplyResult struct {
	Created     int64   `json:"created"`
	OfferingIDs []int64 `json:"offeringIds"`
}

// SupplyGroupDrafts port of supplyGroupDraftsAction — real insertion of offering + schedule +
// offering_professors in one transaction with an advisory lock and audit.
func (s *Service) SupplyGroupDrafts(ctx context.Context, user *session.User, cookie string, px SchedSupplyInput) (*SchedSupplyResult, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	actorID := user.ID

	var offeringScope string
	var clusterID *int64
	err := s.DB.Pool.QueryRow(ctx, `select coalesce("offeringScope",'DEPARTMENTAL'), "clusterId" from courses where id = $1`, px.CourseID).
		Scan(&offeringScope, &clusterID)
	if err != nil {
		return nil, errors.New("درس یافت نشد.")
	}
	if px.IsSharedService && offeringScope != "GENERAL_SERVICE" {
		return nil, errors.New("این درس در کاتالوگ به‌عنوان درس خدماتی سراسری تعریف نشده است.")
	}

	// Professors must belong to the owning department (domain)
	profIDs := make([]int64, 0, len(px.Drafts))
	for _, d := range px.Drafts {
		profIDs = append(profIDs, d.ProfessorID)
	}
	if len(profIDs) > 0 {
		prows, err := s.DB.Pool.Query(ctx, `select id, coalesce("departmentId",0) from staff where id = any($1)`, profIDs)
		if err != nil {
			return nil, err
		}
		for prows.Next() {
			var pid, dept int64
			if prows.Scan(&pid, &dept) == nil && dept != px.OwnerDepartmentID {
				prows.Close()
				return nil, fmt.Errorf("استاد %d از گروه دیگری است — فقط اساتید گروه سازنده مجازند.", pid)
			}
		}
		prows.Close()
	}

	drafts := make([]scheduling.GroupDraftInput, 0, len(px.Drafts))
	for _, d := range px.Drafts {
		drafts = append(drafts, scheduling.GroupDraftInput{
			GroupNumber: d.GroupNumber, Capacity: d.Capacity, Gender: d.Gender,
			ProfessorID: d.ProfessorID, ClassroomID: d.ClassroomID,
			DayOfWeek: d.DayOfWeek, StartTime: d.StartTime, EndTime: d.EndTime,
		})
	}
	valid, err := scheduling.ValidateGroupDrafts(drafts, px.IsSharedService)
	if err != nil {
		return nil, err
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := schedAdvisoryLock(ctx, tx, "sched_supply", px.TermID, 0); err != nil {
		return nil, err
	}
	_, phase := schedStateOfTerm(ctx, tx, px.TermID)
	if !scheduling.CanEditInPhase(phase) {
		return nil, fmt.Errorf("در فاز «%s» امکان ساخت گروه درسی نیست.", phase)
	}

	// 1) Duplicate group in this term?
	existing := map[int]bool{}
	erows, err := tx.Query(ctx, `
		select "groupNumber" from course_offerings where "termId" = $1 and "courseId" = $2`, px.TermID, px.CourseID)
	if err != nil {
		return nil, err
	}
	for erows.Next() {
		var g int
		if erows.Scan(&g) == nil {
			existing[g] = true
		}
	}
	erows.Close()
	for _, d := range valid {
		if existing[d.GroupNumber] {
			return nil, fmt.Errorf("گروه %d این درس در ترم جاری قبلاً ساخته شده است.", d.GroupNumber)
		}
	}

	// 2) Professor/room conflict at insert time (defense in depth)
	brows, err := tx.Query(ctx, `
		select s."dayOfWeek", to_char(s."startTime",'HH24:MI'), to_char(s."endTime",'HH24:MI'), s."roomId", o."professorId"
		  from schedules s join course_offerings o on o.id = s."offeringId"
		 where o."termId" = $1`, px.TermID)
	if err != nil {
		return nil, err
	}
	type bookedRow struct {
		day        int
		start, end string
		roomID     *int64
		profID     *int64
	}
	booked := []bookedRow{}
	for brows.Next() {
		var b bookedRow
		if brows.Scan(&b.day, &b.start, &b.end, &b.roomID, &b.profID) == nil {
			booked = append(booked, b)
		}
	}
	brows.Close()
	for _, d := range valid {
		for _, b := range booked {
			if b.day != d.DayOfWeek {
				continue
			}
			bs, e1 := scheduling.ToMinutes(b.start)
			be, e2 := scheduling.ToMinutes(b.end)
			if e1 != nil || e2 != nil || !scheduling.Overlaps(d.StartMinutes, d.EndMinutes, bs, be) {
				continue
			}
			if b.profID != nil && *b.profID == d.ProfessorID {
				return nil, fmt.Errorf("تداخل استاد در گروه %d: استاد در این روز/ساعت کلاس دیگری دارد.", d.GroupNumber)
			}
			if b.roomID != nil && *b.roomID == d.ClassroomID {
				return nil, fmt.Errorf("تداخل مکان در گروه %d: کلاس فیزیکی در این روز/ساعت اشغال است.", d.GroupNumber)
			}
		}
	}

	// 3) Physical classroom capacity
	roomIDs := make([]int64, 0, len(valid))
	for _, d := range valid {
		roomIDs = append(roomIDs, d.ClassroomID)
	}
	roomCap := map[int64]int{}
	if len(roomIDs) > 0 {
		rrows, err := tx.Query(ctx, `select id, coalesce(capacity,0) from classrooms where id = any($1)`, roomIDs)
		if err != nil {
			return nil, err
		}
		for rrows.Next() {
			var id int64
			var c int
			if rrows.Scan(&id, &c) == nil {
				roomCap[id] = c
			}
		}
		rrows.Close()
	}
	for _, d := range valid {
		cap, ok := roomCap[d.ClassroomID]
		if !ok {
			return nil, fmt.Errorf("کلاس فیزیکی گروه %d یافت نشد.", d.GroupNumber)
		}
		if cap < d.Capacity {
			return nil, fmt.Errorf("ظرفیت فیزیکی کلاس گروه %d (%d) کمتر از ظرفیت درخواستی (%d) است.", d.GroupNumber, cap, d.Capacity)
		}
	}

	// 4) Batch insert: offering + schedule + offering_professors
	offeringIDs := []int64{}
	offeringByGroup := map[int]int64{}
	for _, d := range valid {
		var oid int64
		if err := tx.QueryRow(ctx, `
			insert into course_offerings ("termId", "courseId", "professorId", "groupNumber", capacity,
			                             "genderRestriction", "ownerDepartmentId", "isSharedService",
			                             "equivalenceClusterId", "offeringType", "universityId")
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'NORMAL',$10)
			returning id`, px.TermID, px.CourseID, d.ProfessorID, d.GroupNumber, d.Capacity,
			d.Gender, px.OwnerDepartmentID, boolInt(px.IsSharedService), clusterID, uniID).Scan(&oid); err != nil {
			return nil, fmt.Errorf("خطا در درج ارائهٔ گروه %d: %s", d.GroupNumber, err.Error())
		}
		offeringByGroup[d.GroupNumber] = oid
		offeringIDs = append(offeringIDs, oid)
		if _, err := tx.Exec(ctx, `
			insert into schedules ("offeringId", "scheduleType", "dayOfWeek", "startTime", "endTime", "roomId", "universityId")
			values ($1,'CLASS',$2,$3,$4,$5,$6)`, oid, d.DayOfWeek, schedHhmmss(d.StartTime), schedHhmmss(d.EndTime), d.ClassroomID, uniID); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `
			insert into offering_professors ("offeringId", "staffId", role, "sharePercentage", "universityId")
			values ($1,$2,'MAIN_LECTURER',100.00,$3)`, oid, d.ProfessorID, uniID); err != nil {
			return nil, err
		}
	}

	schedAuditTx(ctx, tx, &actorID, "SCHEDULING_SUPPLY_CREATED", "academic_term", px.TermID, map[string]any{
		"courseId": px.CourseID, "ownerDepartmentId": px.OwnerDepartmentID,
		"isSharedService": boolInt(px.IsSharedService), "groups": len(offeringIDs), "offeringIds": offeringIDs,
	})
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &SchedSupplyResult{Created: int64(len(offeringIDs)), OfferingIDs: offeringIDs}, nil
}

// ─────────────────────────── shared class allocation ───────────────────────────

// AllocateSections port of allocateSectionsAction — allocate the service pool to a group.
func (s *Service) AllocateSections(ctx context.Context, user *session.User, cookie string, termID, departmentID int64, offeringIDs []int64) (int, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	actorID := user.ID
	if len(offeringIDs) == 0 {
		return 0, errors.New("کلاسی برای تخصیص ارسال نشده است.")
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := schedAdvisoryLock(ctx, tx, "sched_allocate", termID, 0); err != nil {
		return 0, err
	}
	_, phase := schedStateOfTerm(ctx, tx, termID)
	if !scheduling.CanAllocateInPhase(phase) {
		return 0, fmt.Errorf("تخصیص فقط در فاز ALLOCATION/REVIEW ممکن است (فاز فعلی: %s).", phase)
	}

	type offerRow struct {
		id     int64
		shared int
	}
	offers := []offerRow{}
	orows, err := tx.Query(ctx, `select id, coalesce("isSharedService",0) from course_offerings where id = any($1)`, offeringIDs)
	if err != nil {
		return 0, err
	}
	for orows.Next() {
		var o offerRow
		if orows.Scan(&o.id, &o.shared) == nil {
			offers = append(offers, o)
		}
	}
	orows.Close()
	found := map[int64]bool{}
	for _, o := range offers {
		found[o.id] = true
	}
	for _, id := range offeringIDs {
		if !found[id] {
			return 0, fmt.Errorf("کلاس %d یافت نشد.", id)
		}
	}
	for _, o := range offers {
		if o.shared != 1 {
			return 0, fmt.Errorf("کلاس %d درس مشترک (خدماتی) نیست — تخصیص از استخر مجاز نیست.", o.id)
		}
	}

	// Current weekly schedule of the group (its own classes + previous allocations)
	type mineRow struct {
		day        int
		start, end string
		offeringID int64
	}
	mine := []mineRow{}
	mrows, err := tx.Query(ctx, `
		select s."dayOfWeek", to_char(s."startTime",'HH24:MI'), to_char(s."endTime",'HH24:MI'), s."offeringId"
		  from schedules s
		 where s."offeringId" in (
		   select o2.id from course_offerings o2 where o2."termId" = $1
		     and (o2."ownerDepartmentId" = $2
		          or o2.id in (select a."offeringId" from scheduling_allocations a
		                       where a."termId" = $1 and a."departmentId" = $2)))`, termID, departmentID)
	if err != nil {
		return 0, err
	}
	for mrows.Next() {
		var m mineRow
		if mrows.Scan(&m.day, &m.start, &m.end, &m.offeringID) == nil {
			mine = append(mine, m)
		}
	}
	mrows.Close()

	type chosenRow struct {
		id         int64
		day        int
		start, end string
	}
	chosen := []chosenRow{}
	crows, err := tx.Query(ctx, `
		select o.id, s."dayOfWeek", to_char(s."startTime",'HH24:MI'), to_char(s."endTime",'HH24:MI')
		  from course_offerings o join schedules s on s."offeringId" = o.id
		 where o.id = any($1)`, offeringIDs)
	if err != nil {
		return 0, err
	}
	for crows.Next() {
		var c chosenRow
		if crows.Scan(&c.id, &c.day, &c.start, &c.end) == nil {
			chosen = append(chosen, c)
		}
	}
	crows.Close()

	conflicts := []string{}
	for _, c := range chosen {
		cs, e1 := scheduling.ToMinutes(c.start)
		ce, e2 := scheduling.ToMinutes(c.end)
		if e1 != nil || e2 != nil {
			continue
		}
		for _, m := range mine {
			if m.day != c.day {
				continue
			}
			ms, e3 := scheduling.ToMinutes(m.start)
			me, e4 := scheduling.ToMinutes(m.end)
			if e3 != nil || e4 != nil || !scheduling.Overlaps(cs, ce, ms, me) {
				continue
			}
			conflicts = append(conflicts, fmt.Sprintf("کلاس %d با برنامهٔ گروه شما (کلاس %d) تداخل دارد.", c.id, m.offeringID))
		}
	}
	if len(conflicts) > 0 {
		return 0, errors.New(strings.Join(conflicts, " | "))
	}

	// Insert allocations (unique — re-allocation is impossible)
	done := 0
	staffID := schedResolveStaffID(ctx, tx, &actorID)
	for _, o := range offers {
		var insID int64
		err := tx.QueryRow(ctx, `
			insert into scheduling_allocations ("termId", "offeringId", "departmentId", "allocatedByStaffId", "universityId")
			values ($1,$2,$3,$4,$5)
			on conflict do nothing returning id`, termID, o.id, departmentID, staffID, uniID).Scan(&insID)
		if err == nil {
			done++
		}
	}
	schedAuditTx(ctx, tx, &actorID, "SCHEDULING_SECTIONS_ALLOCATED", "academic_term", termID, map[string]any{
		"departmentId": departmentID, "allocated": done,
	})
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return done, nil
}

// ─────────────────────────── classroom quotas ───────────────────────────

// AllocateRoomQuotas port of allocateRoomQuotasAction — initial allocation of the
// (classroom, shift) quota for each faculty's groups based on the active student population.
func (s *Service) AllocateRoomQuotas(ctx context.Context, user *session.User, cookie string, termID int64) (int, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	actorID := user.ID

	// Intentional deviation from Next: faculties/classrooms are restricted to the active university
	// and grant rows are inserted with "universityId" (the Next version inserted without scope and
	// with NULL — which was incompatible with this module's strict queries).
	facArgs := []any{}
	facCond := "1=1"
	if uniID != nil {
		facCond = `"universityId" = $1`
		facArgs = append(facArgs, *uniID)
	}
	frows, err := s.DB.Pool.Query(ctx, `select id from faculties where `+facCond+` order by id`, facArgs...)
	if err != nil {
		return 0, err
	}
	faculties := []int64{}
	for frows.Next() {
		var id int64
		if frows.Scan(&id) == nil {
			faculties = append(faculties, id)
		}
	}
	frows.Close()

	grants := []scheduling.RoomGrant{}
	for _, f := range faculties {
		roomRows := []scheduling.RoomGrantInput{}
		rrows, err := s.DB.Pool.Query(ctx, `
			select id, coalesce(capacity,0) from classrooms where "facultyId" = $1 order by id`, f)
		if err == nil {
			for rrows.Next() {
				var id int64
				var c int
				if rrows.Scan(&id, &c) == nil {
					roomRows = append(roomRows, scheduling.RoomGrantInput{ClassroomID: id, Capacity: c, Shifts: []string{"MORNING", "EVENING"}})
				}
			}
			rrows.Close()
		}
		if len(roomRows) == 0 {
			continue
		}
		depts := []scheduling.DeptShareInput{}
		drows, err := s.DB.Pool.Query(ctx, `
			select d.id, count(s.id)::int
			  from departments d
			  join majors m on m."departmentId" = d.id
			  left join students s on s."majorId" = m.id and s.status = 'ACTIVE'
			 where d."facultyId" = $1
			 group by d.id order by count(s.id) desc`, f)
		if err == nil {
			for drows.Next() {
				var id int64
				var n int
				if drows.Scan(&id, &n) == nil {
					depts = append(depts, scheduling.DeptShareInput{DepartmentID: id, ActiveStudents: n})
				}
			}
			drows.Close()
		}
		// Service groups (without curriculum-based students) do not receive a quota
		filtered := []scheduling.DeptShareInput{}
		for _, d := range depts {
			if d.ActiveStudents > 0 {
				filtered = append(filtered, d)
			}
		}
		if len(filtered) > 0 {
			grants = append(grants, scheduling.AllocateQuotaShifts(roomRows, filtered)...)
		}
	}

	if len(grants) == 0 {
		return 0, nil
	}
	n := 0
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := schedAdvisoryLock(ctx, tx, "sched_quota", termID, 0); err != nil {
		return 0, err
	}
	for _, g := range grants {
		var insID int64
		err := tx.QueryRow(ctx, `
			insert into scheduling_room_grants ("termId", "classroomId", shift, "ownerDepartmentId", "universityId")
			values ($1,$2,$3,$4,$5)
			on conflict do nothing returning id`, termID, g.ClassroomID, g.Shift, g.DepartmentID, uniID).Scan(&insID)
		if err == nil {
			n++
		}
	}
	schedAuditTx(ctx, tx, &actorID, "SCHEDULING_QUOTA_ALLOCATED", "academic_term", termID, map[string]any{"grants": n})
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return n, nil
}

// ─────────────────────────── smart suggestions ───────────────────────────

// SchedSmartSlot engine-suggested slot (SmartSlot).
type SchedSmartSlot struct {
	DayOfWeek         int      `json:"dayOfWeek"`
	StartTime         string   `json:"startTime"`
	EndTime           string   `json:"endTime"`
	ClassroomID       int64    `json:"classroomId"`
	ClassroomName     string   `json:"classroomName"`
	ClassroomCapacity int      `json:"classroomCapacity"`
	Score             int      `json:"score"`
	Reasons           []string `json:"reasons"`
}

// SchedSuggestInput smart suggestion input.
type SchedSuggestInput struct {
	TermID          int64  `json:"termId"`
	ProfessorID     int64  `json:"professorId"`
	Capacity        int    `json:"capacity"`
	TargetFacultyID *int64 `json:"targetFacultyId"`
	DurationMinutes int    `json:"durationMinutes"`
}

// GetSmartSuggestions ports getSmartSuggestionsAction. Slots are derived from
// the professor's declared availability, real room occupancy, faculty zoning,
// and capacity fit. All lookups are constrained to the active university.
func (s *Service) GetSmartSuggestions(ctx context.Context, uniID *int64, px SchedSuggestInput) ([]SchedSmartSlot, error) {
	if err := s.AssertSchedTermInUni(ctx, px.TermID, uniID); err != nil {
		return nil, err
	}
	if px.ProfessorID <= 0 || px.Capacity <= 0 || px.Capacity > 100000 {
		return nil, errors.New("استاد یا ظرفیت درس نامعتبر است.")
	}
	duration := px.DurationMinutes
	if duration < 30 || duration > 240 {
		duration = 90 // WEEKLY_DURATION_MIN
	}
	var exists int
	if err := s.DB.Pool.QueryRow(ctx, `
		select count(*) from staff where id = $1 and `+schedScopeCond(`"universityId"`, uniID),
		px.ProfessorID).Scan(&exists); err != nil || exists == 0 {
		return nil, errors.New("استاد یافت نشد.")
	}
	// Ignore a forged faculty hint from another tenant instead of letting it
	// influence score reasons.
	if px.TargetFacultyID != nil {
		var ok bool
		_ = s.DB.Pool.QueryRow(ctx, `
			select exists(select 1 from faculties where id = $1 and `+schedScopeCond(`"universityId"`, uniID)+`)`,
			*px.TargetFacultyID).Scan(&ok)
		if !ok {
			px.TargetFacultyID = nil
		}
	}

	type availRow struct {
		day        int
		start, end string
		hasTerm    bool
	}
	avail := []availRow{}
	arows, err := s.DB.Pool.Query(ctx, `
		select "dayOfWeek", to_char("startTime",'HH24:MI'), to_char("endTime",'HH24:MI'), "termId" is not null
		  from professor_availabilities
		 where "staffId" = $1 and ("termId" is null or "termId" = $2)
		   and `+schedScopeCond(`"universityId"`, uniID)+`
		   and "startTime" is not null and "endTime" is not null`, px.ProfessorID, px.TermID)
	if err != nil {
		return nil, err
	}
	for arows.Next() {
		var a availRow
		if arows.Scan(&a.day, &a.start, &a.end, &a.hasTerm) == nil {
			avail = append(avail, a)
		}
	}
	arows.Close()
	if len(avail) == 0 {
		return []SchedSmartSlot{}, nil
	}

	type busyRow struct {
		day        int
		start, end int
	}
	busy := []busyRow{}
	brows, err := s.DB.Pool.Query(ctx, `
		select s."dayOfWeek", to_char(s."startTime",'HH24:MI'), to_char(s."endTime",'HH24:MI')
		  from schedules s join course_offerings o on o.id = s."offeringId"
		 where o."termId" = $1 and o."professorId" = $2`, px.TermID, px.ProfessorID)
	if err == nil {
		for brows.Next() {
			var day int
			var s_, e_ string
			if brows.Scan(&day, &s_, &e_) == nil {
				bs, e1 := scheduling.ToMinutes(s_)
				be, e2 := scheduling.ToMinutes(e_)
				if e1 == nil && e2 == nil {
					busy = append(busy, busyRow{day, bs, be})
				}
			}
		}
		brows.Close()
	}

	type roomRow struct {
		id        int64
		name      string
		capacity  int
		facultyID *int64
	}
	rooms := []roomRow{}
	rrows, err := s.DB.Pool.Query(ctx, `
		select id, name, coalesce(capacity,0), "facultyId"
		  from classrooms
		 where coalesce(capacity,0) >= $1 and `+schedScopeCond(`"universityId"`, uniID)+`
		 order by id`, px.Capacity)
	if err != nil {
		return nil, err
	}
	for rrows.Next() {
		var r roomRow
		if rrows.Scan(&r.id, &r.name, &r.capacity, &r.facultyID) == nil {
			rooms = append(rooms, r)
		}
	}
	rrows.Close()
	if len(rooms) == 0 {
		return []SchedSmartSlot{}, nil
	}

	type occRow struct {
		day        int
		room       int64
		start, end int
	}
	occupied := []occRow{}
	orows, err := s.DB.Pool.Query(ctx, `
		select s."dayOfWeek", s."roomId", to_char(s."startTime",'HH24:MI'), to_char(s."endTime",'HH24:MI')
		  from schedules s join course_offerings o on o.id = s."offeringId"
		 where o."termId" = $1 and s."roomId" is not null`, px.TermID)
	if err == nil {
		for orows.Next() {
			var o occRow
			var s_, e_ string
			if orows.Scan(&o.day, &o.room, &s_, &e_) == nil {
				os, e1 := scheduling.ToMinutes(s_)
				oe, e2 := scheduling.ToMinutes(e_)
				if e1 == nil && e2 == nil {
					o.start, o.end = os, oe
					occupied = append(occupied, o)
				}
			}
		}
		orows.Close()
	}

	suggested := []SchedSmartSlot{}
	for _, a := range avail {
		day := a.day
		wStart, e1 := scheduling.ToMinutes(a.start)
		wEnd, e2 := scheduling.ToMinutes(a.end)
		if e1 != nil || e2 != nil {
			continue
		}
		preferred := a.hasTerm
		for start := wStart; start+duration <= wEnd; start += 30 {
			end := start + duration
			isProfBusy := false
			for _, b := range busy {
				if b.day == day && scheduling.Overlaps(start, end, b.start, b.end) {
					isProfBusy = true
					break
				}
			}
			if isProfBusy {
				continue
			}
			for _, room := range rooms {
				isOccupied := false
				for _, o := range occupied {
					if o.day == day && o.room == room.id && scheduling.Overlaps(start, end, o.start, o.end) {
						isOccupied = true
						break
					}
				}
				if isOccupied {
					continue
				}
				sc := scheduling.CalculateSlotScore(scheduling.SlotScoreInput{
					RoomFacultyID:     room.facultyID,
					TargetFacultyID:   px.TargetFacultyID,
					InPreferredWindow: preferred,
					InAvailableWindow: true,
					RoomCapacity:      room.capacity,
					RequiredCapacity:  px.Capacity,
				})
				if sc.Score < 0 {
					continue
				}
				suggested = append(suggested, SchedSmartSlot{
					DayOfWeek: day, StartTime: schedToHHMM(start), EndTime: schedToHHMM(end),
					ClassroomID: room.id, ClassroomName: room.name, ClassroomCapacity: room.capacity,
					Score: sc.Score, Reasons: sc.Reasons,
				})
			}
		}
	}
	sort.SliceStable(suggested, func(i, j int) bool { return suggested[i].Score > suggested[j].Score })
	if len(suggested) > 4 {
		suggested = suggested[:4]
	}
	return suggested, nil
}

// ─────────────────────────── diagnostics (schedule health) ───────────────────────────

// SchedForecast course demand forecast (forecastCourseDemand).
type SchedForecast struct {
	CourseID            int64                      `json:"courseId"`
	ClusterID           *int64                     `json:"clusterId"`
	EquivalentCourseIDs []int64                    `json:"equivalentCourseIds"`
	ActiveNeedingCount  int                        `json:"activeNeedingCount"`
	AlreadyPassedCount  int                        `json:"alreadyPassedCount"`
	EligibleStudents    int                        `json:"eligibleStudents"`
	SuggestedGroups     int                        `json:"suggestedGroups"`
	ByFaculty           []scheduling.FacultyGroups `json:"byFaculty"`
}

// schedForecastCourseDemand port of forecastCourseDemand — real course demand
// (or the whole equivalence cluster) minus those already passed.
func (s *Service) schedForecastCourseDemand(ctx context.Context, courseID int64, standardCapacity float64) (*SchedForecast, error) {
	var clusterID *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "clusterId" from courses where id = $1`, courseID).Scan(&clusterID); err != nil {
		return nil, errors.New("درس یافت نشد.")
	}
	memberIDs := []int64{courseID}
	if clusterID != nil {
		mrows, err := s.DB.Pool.Query(ctx, `select id from courses where "clusterId" = $1`, *clusterID)
		if err == nil {
			memberIDs = []int64{}
			for mrows.Next() {
				var id int64
				if mrows.Scan(&id) == nil {
					memberIDs = append(memberIDs, id)
				}
			}
			mrows.Close()
			has := false
			for _, id := range memberIDs {
				if id == courseID {
					has = true
					break
				}
			}
			if !has {
				memberIDs = append(memberIDs, courseID)
			}
		}
	}

	type needingRow struct {
		studentID int64
		facultyID *int64
	}
	needing := []needingRow{}
	nrows, err := s.DB.Pool.Query(ctx, `
		select distinct s.id, m."facultyId"
		  from students s
		  join majors m on m.id = s."majorId"
		  join curriculum_versions cv on cv."majorId" = m.id
		       and s."entryYear" between cv."entryYearFrom" and coalesce(cv."entryYearTo", 9999)
		       and cv.status in ('PUBLISHED','ARCHIVED')
		  join curriculum_courses sc on sc."curriculumVersionId" = cv.id
		 where s.status = 'ACTIVE' and sc."courseId" = any($1)`, memberIDs)
	if err == nil {
		for nrows.Next() {
			var r needingRow
			if nrows.Scan(&r.studentID, &r.facultyID) == nil {
				needing = append(needing, r)
			}
		}
		nrows.Close()
	}
	if len(needing) == 0 {
		return &SchedForecast{
			CourseID: courseID, ClusterID: clusterID, EquivalentCourseIDs: memberIDs,
			ActiveNeedingCount: 0, AlreadyPassedCount: 0, EligibleStudents: 0,
			SuggestedGroups: 1, ByFaculty: []scheduling.FacultyGroups{},
		}, nil
	}

	needingIDs := make([]int64, 0, len(needing))
	seen := map[int64]bool{}
	for _, r := range needing {
		if !seen[r.studentID] {
			seen[r.studentID] = true
			needingIDs = append(needingIDs, r.studentID)
		}
	}
	passed := map[int64]bool{}
	prows, err := s.DB.Pool.Query(ctx, `
		select distinct e."studentId"
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		 where o."courseId" = any($1)
		   and e."gradeStatus" = 'FINALIZED' and e."gradeValue" >= 10
		   and e."studentId" = any($2)`, memberIDs, needingIDs)
	if err == nil {
		for prows.Next() {
			var sid int64
			if prows.Scan(&sid) == nil {
				passed[sid] = true
			}
		}
		prows.Close()
	}

	facultyMap := map[int64]int{}
	facOrder := []int64{}
	eligibleSet := map[int64]bool{}
	for _, r := range needing {
		if passed[r.studentID] {
			continue
		}
		eligibleSet[r.studentID] = true
		fid := int64(0)
		if r.facultyID != nil {
			fid = *r.facultyID
		}
		if _, ok := facultyMap[fid]; !ok {
			facOrder = append(facOrder, fid)
		}
		facultyMap[fid]++
	}
	perFaculty := []scheduling.FacultyDemand{}
	for _, fid := range facOrder {
		if fid == 0 {
			perFaculty = append(perFaculty, scheduling.FacultyDemand{FacultyID: nil, Eligible: facultyMap[fid]})
		} else {
			v := fid
			perFaculty = append(perFaculty, scheduling.FacultyDemand{FacultyID: &v, Eligible: facultyMap[fid]})
		}
	}
	groups, _ := scheduling.SuggestedGroupCount(len(eligibleSet), standardCapacity)
	return &SchedForecast{
		CourseID: courseID, ClusterID: clusterID, EquivalentCourseIDs: memberIDs,
		ActiveNeedingCount: len(seen), AlreadyPassedCount: len(passed),
		EligibleStudents: len(eligibleSet), SuggestedGroups: groups,
		ByFaculty: scheduling.DistributeGroupsByFaculty(perFaculty, standardCapacity),
	}, nil
}

// SchedHiddenConflict hidden professor/room conflict.
type SchedHiddenConflict struct {
	Kind      string `json:"kind"`
	DayOfWeek int    `json:"dayOfWeek"`
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime"`
	A         int64  `json:"a"`
	B         int64  `json:"b"`
}

// SchedSupplyDemand supply versus demand.
type SchedSupplyDemand struct {
	CourseID         int64  `json:"courseId"`
	Title            string `json:"title"`
	SuppliedGroups   int    `json:"suppliedGroups"`
	SuggestedGroups  int    `json:"suggestedGroups"`
	Gap              int    `json:"gap"`
	EligibleStudents int    `json:"eligibleStudents"`
}

// SchedUnallocatedShared shared class without allocation.
type SchedUnallocatedShared struct {
	OfferingID  int64 `json:"offeringId"`
	CourseID    int64 `json:"courseId"`
	GroupNumber int   `json:"groupNumber"`
}

// SchedRoomShiftUsage utilization (classroom, shift).
type SchedRoomShiftUsage struct {
	ClassroomID     int64   `json:"classroomId"`
	ClassroomName   string  `json:"classroomName"`
	FacultyID       *int64  `json:"facultyId"`
	Shift           string  `json:"shift"`
	OccupiedMinutes int     `json:"occupiedMinutes"`
	Utilization     float64 `json:"utilization"`
}

// SchedReleasedUnused shift released to the floating pool.
type SchedReleasedUnused struct {
	ClassroomID int64  `json:"classroomId"`
	Shift       string `json:"shift"`
}

// SchedHealthReport schedule health report (HealthReport).
type SchedHealthReport struct {
	TermID            int64                    `json:"termId"`
	HiddenConflicts   []SchedHiddenConflict    `json:"hiddenConflicts"`
	SupplyVsDemand    []SchedSupplyDemand      `json:"supplyVsDemand"`
	UnallocatedShared []SchedUnallocatedShared `json:"unallocatedShared"`
	RoomShiftUsage    []SchedRoomShiftUsage    `json:"roomShiftUsage"`
	ReleasedUnused    []SchedReleasedUnused    `json:"releasedUnused"`
	Lines             []string                 `json:"lines"`
}

// GetSchedulingHealth ports getSchedulingHealthAction / runSchedulingHealthCheck.
// The term is validated against the active university before any query runs.
func (s *Service) GetSchedulingHealth(ctx context.Context, uniID *int64, termID int64) (*SchedHealthReport, error) {
	if err := s.AssertSchedTermInUni(ctx, termID, uniID); err != nil {
		return nil, err
	}
	report := &SchedHealthReport{
		TermID: termID, HiddenConflicts: []SchedHiddenConflict{},
		SupplyVsDemand: []SchedSupplyDemand{}, UnallocatedShared: []SchedUnallocatedShared{},
		RoomShiftUsage: []SchedRoomShiftUsage{}, ReleasedUnused: []SchedReleasedUnused{}, Lines: []string{},
	}

	// 1) Hidden conflicts (professor/room)
	type schedRow struct {
		id         int64
		day        int
		start, end string
		roomID     *int64
		profID     *int64
	}
	rows := []schedRow{}
	qrows, err := s.DB.Pool.Query(ctx, `
		select s.id, s."dayOfWeek", to_char(s."startTime",'HH24:MI'), to_char(s."endTime",'HH24:MI'),
		       s."roomId", o."professorId"
		  from schedules s join course_offerings o on o.id = s."offeringId"
		 where o."termId" = $1`, termID)
	if err != nil {
		return nil, err
	}
	for qrows.Next() {
		var r schedRow
		if qrows.Scan(&r.id, &r.day, &r.start, &r.end, &r.roomID, &r.profID) == nil {
			rows = append(rows, r)
		}
	}
	qrows.Close()
	for i := 0; i < len(rows); i++ {
		for j := i + 1; j < len(rows); j++ {
			a, b := rows[i], rows[j]
			if a.day != b.day {
				continue
			}
			aS, e1 := scheduling.ToMinutes(a.start)
			aE, e2 := scheduling.ToMinutes(a.end)
			bS, e3 := scheduling.ToMinutes(b.start)
			bE, e4 := scheduling.ToMinutes(b.end)
			if e1 != nil || e2 != nil || e3 != nil || e4 != nil || !scheduling.Overlaps(aS, aE, bS, bE) {
				continue
			}
			if a.profID != nil && b.profID != nil && *a.profID == *b.profID {
				report.HiddenConflicts = append(report.HiddenConflicts, SchedHiddenConflict{
					Kind: "PROFESSOR", DayOfWeek: a.day, StartTime: a.start, EndTime: a.end, A: a.id, B: b.id,
				})
			}
			if a.roomID != nil && b.roomID != nil && *a.roomID == *b.roomID {
				report.HiddenConflicts = append(report.HiddenConflicts, SchedHiddenConflict{
					Kind: "ROOM", DayOfWeek: a.day, StartTime: a.start, EndTime: a.end, A: a.id, B: b.id,
				})
			}
		}
	}
	if len(report.HiddenConflicts) > 0 {
		report.Lines = append(report.Lines, fmt.Sprintf("🚨 %d تداخل پنهان (استاد/مکان) یافت شد.", len(report.HiddenConflicts)))
	} else {
		report.Lines = append(report.Lines, "✅ تداخل پنهان استاد/مکان: صفر.")
	}

	// 2) Shared classes without allocation
	urows, err := s.DB.Pool.Query(ctx, `
		select o.id, o."courseId", o."groupNumber"
		  from course_offerings o
		 where o."termId" = $1 and o."isSharedService" = 1
		   and o.id not in (select a."offeringId" from scheduling_allocations a where a."termId" = $1)
		 order by o."courseId", o."groupNumber"`, termID)
	if err == nil {
		for urows.Next() {
			var r SchedUnallocatedShared
			if urows.Scan(&r.OfferingID, &r.CourseID, &r.GroupNumber) == nil {
				report.UnallocatedShared = append(report.UnallocatedShared, r)
			}
		}
		urows.Close()
	}
	if len(report.UnallocatedShared) > 0 {
		report.Lines = append(report.Lines, fmt.Sprintf("⚠ %d کلاس مشترک هنوز به هیچ گروهی تخصیص نیافته (یتیم).", len(report.UnallocatedShared)))
	} else {
		report.Lines = append(report.Lines, "✅ همهٔ کلاس‌های مشترک تخصیص یافته‌اند.")
	}

	// 3) Supply versus demand
	scrows, err := s.DB.Pool.Query(ctx, `
		select o."courseId", count(*)::int from course_offerings o
		 where o."termId" = $1 and o."isSharedService" = 1
		 group by o."courseId"`, termID)
	if err == nil {
		type scRow struct {
			courseID int64
			n        int
		}
		shared := []scRow{}
		for scrows.Next() {
			var r scRow
			if scrows.Scan(&r.courseID, &r.n) == nil {
				shared = append(shared, r)
			}
		}
		scrows.Close()
		for _, sc := range shared {
			demand, err := s.schedForecastCourseDemand(ctx, sc.courseID, 40)
			if err != nil {
				continue // course without syllabus → skipping it in the forecast is safe
			}
			var title string
			_ = s.DB.Pool.QueryRow(ctx, `select title from courses where id = $1`, sc.courseID).Scan(&title)
			gap := sc.n - demand.SuggestedGroups
			report.SupplyVsDemand = append(report.SupplyVsDemand, SchedSupplyDemand{
				CourseID: sc.courseID, Title: title, SuppliedGroups: sc.n,
				SuggestedGroups: demand.SuggestedGroups, Gap: gap, EligibleStudents: demand.EligibleStudents,
			})
			switch {
			case gap > 0:
				report.Lines = append(report.Lines, fmt.Sprintf("📉 درس «%s»: %d متقاضی واقعی → %d گروه پیشنهادی، ولی %d گروه ساخته شده (%d مازاد).", title, demand.EligibleStudents, demand.SuggestedGroups, sc.n, gap))
			case gap < 0:
				report.Lines = append(report.Lines, fmt.Sprintf("📈 درس «%s»: %d متقاضی واقعی → %d گروه پیشنهادی، فقط %d گروه ساخته شده (کمبود %d).", title, demand.EligibleStudents, demand.SuggestedGroups, sc.n, -gap))
			default:
				report.Lines = append(report.Lines, fmt.Sprintf("✅ درس «%s»: عرضه دقیقاً با تقاضا (%d گروه) هم‌خوان است.", title, demand.SuggestedGroups))
			}
		}
	}

	// 4) Utilization (classroom, shift)
	type usageRow struct {
		roomID     int64
		roomName   string
		facultyID  *int64
		day        int
		start, end string
	}
	urooms, err := s.DB.Pool.Query(ctx, `
		select s."roomId", c.name, c."facultyId", s."dayOfWeek",
		       to_char(s."startTime",'HH24:MI'), to_char(s."endTime",'HH24:MI')
		  from schedules s
		  join course_offerings o on o.id = s."offeringId"
		  join classrooms c on c.id = s."roomId"
		 where o."termId" = $1 and s."roomId" is not null`, termID)
	if err == nil {
		type usageRowIn = usageRow
		usage := []usageRowIn{}
		for urooms.Next() {
			var u usageRowIn
			if urooms.Scan(&u.roomID, &u.roomName, &u.facultyID, &u.day, &u.start, &u.end) == nil {
				usage = append(usage, u)
			}
		}
		urooms.Close()
		type shiftKey struct {
			room  int64
			shift string
		}
		perShift := map[shiftKey]*SchedRoomShiftUsage{}
		order := []shiftKey{}
		for _, u := range usage {
			start, e1 := scheduling.ToMinutes(u.start)
			end, e2 := scheduling.ToMinutes(u.end)
			if e1 != nil || e2 != nil {
				continue
			}
			shift := "EVENING"
			if end <= 12*60 {
				shift = "MORNING"
			}
			k := shiftKey{u.roomID, shift}
			if cur, ok := perShift[k]; ok {
				cur.OccupiedMinutes += end - start
			} else {
				cur := &SchedRoomShiftUsage{ClassroomID: u.roomID, ClassroomName: u.roomName, FacultyID: u.facultyID, Shift: shift, OccupiedMinutes: end - start}
				perShift[k] = cur
				order = append(order, k)
			}
		}
		for _, k := range order {
			ps := perShift[k]
			ps.Utilization = scheduling.ShiftUtilization(ps.OccupiedMinutes, 4*60)
			report.RoomShiftUsage = append(report.RoomShiftUsage, *ps)
		}
	}
	idle := 0
	for _, r := range report.RoomShiftUsage {
		if r.Utilization == 0 {
			idle++
		}
	}
	report.Lines = append(report.Lines, fmt.Sprintf("🏛️ بهره‌وری سالن‌ها: %d شیفت کاملاً خالی از %d شیفتِ برنامه‌دار.", idle, len(report.RoomShiftUsage)))

	// 5) Unused floating pool
	rrows, err := s.DB.Pool.Query(ctx, `
		select g."classroomId", g.shift from scheduling_room_grants g
		 where g."termId" = $1 and g.status = 'RELEASED'`, termID)
	if err == nil {
		for rrows.Next() {
			var r SchedReleasedUnused
			if rrows.Scan(&r.ClassroomID, &r.Shift) == nil {
				report.ReleasedUnused = append(report.ReleasedUnused, r)
			}
		}
		rrows.Close()
	}
	if len(report.ReleasedUnused) > 0 {
		report.Lines = append(report.Lines, fmt.Sprintf("🔄 %d شیفت در استخر شناور آزاد و قابل استفاده است.", len(report.ReleasedUnused)))
	} else {
		report.Lines = append(report.Lines, "✅ استخر شناور خالی است (یا همهٔ شیفت‌ها مصرف شده‌اند).")
	}
	return report, nil
}

// ─────────────────────────── real session generation ───────────────────────────

// SchedGenerateInput session generation input.
type SchedGenerateInput struct {
	TermID        int64    `json:"termId"`
	SessionsCount int      `json:"sessionsCount"`
	Holidays      []string `json:"holidays"`
	DryRun        bool     `json:"dryRun"`
}

// SchedGenerateResult session generation result.
type SchedGenerateResult struct {
	OK                  bool                      `json:"ok"`
	Generated           int                       `json:"generated"`
	Skipped             int                       `json:"skipped"`
	Warnings            []string                  `json:"warnings"`
	Error               string                    `json:"error,omitempty"`
	Offerings           int                       `json:"offerings"`
	SessionsPerOffering map[int64]int             `json:"sessionsPerOffering"`
	HardConflicts       []scheduling.HardConflict `json:"hardConflicts"`
	TermStart           *string                   `json:"termStart"`
}

// GenerateClassSessions port of generateClassSessionsAction / generateClassSessionsForTerm —
// generate/regenerate a term's real sessions from schedules (transactional + idempotent + hard-constraint gate).
func (s *Service) GenerateClassSessions(ctx context.Context, user *session.User, cookie string, px SchedGenerateInput) (*SchedGenerateResult, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	actorID := user.ID
	sessionsCount := px.SessionsCount
	if sessionsCount == 0 {
		sessionsCount = 16
	}
	holidays := px.Holidays
	if holidays == nil {
		holidays = []string{}
	}

	fail := func(res *SchedGenerateResult) (*SchedGenerateResult, error) {
		return res, nil
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := schedAdvisoryLock(ctx, tx, "sess_gen", px.TermID, 0); err != nil {
		return nil, err
	}

	var classStart, classEnd *time.Time
	err = tx.QueryRow(ctx, `
		select coalesce("classStartDate", "startDate"), "classEndDate" from academic_terms
		 where id = $1 and `+schedScopeCond(`"universityId"`, uniID), px.TermID).
		Scan(&classStart, &classEnd)
	if err != nil {
		return nil, errors.New("نیمسال تحصیلی یافت نشد.")
	}
	if classStart == nil {
		return nil, errors.New("تاریخ شروع نیمسال (startDate) ثبت نشده است؛ ابتدا تقویم ترم را تعریف کنید.")
	}

	schedRows := s.schedLoadTermSchedules(ctx, tx, px.TermID)
	if len(schedRows) == 0 {
		return fail(&SchedGenerateResult{OK: false, Warnings: []string{}, HardConflicts: []scheduling.HardConflict{},
			Error: "برای این نیمسال هیچ برنامهٔ هفتگی (schedule) ثبت نشده است.", SessionsPerOffering: map[int64]int{}})
	}

	profByOffering := s.schedProfessorsByOffering(ctx, px.TermID)
	roomCap := s.schedRoomCapacities(ctx)
	entries := schedConflictEntries(schedRows, profByOffering, roomCap)
	conflictReport := scheduling.AnalyzeHardConflicts(entries, scheduling.HardConflictListLimit)
	if conflictReport.Total > 0 {
		sample := ""
		if len(conflictReport.Conflicts) > 0 {
			sample = conflictReport.Conflicts[0].Message
		}
		return nil, fmt.Errorf("زمان‌بندی کنونی %d تداخل سخت دارد؛ پیش از تولید جلسات رفع کنید. مثال: %s", conflictReport.Total, sample)
	}

	offeringIDsSet := map[int64]bool{}
	for _, sr := range schedRows {
		offeringIDsSet[sr.OfferingID] = true
	}
	offeringIDs := make([]int64, 0, len(offeringIDsSet))
	for id := range offeringIDsSet {
		offeringIDs = append(offeringIDs, id)
	}

	// Idempotency: existing sessions (offeringId + sessionNo) are never created again.
	existing := map[int64]map[int]bool{}
	if len(offeringIDs) > 0 {
		erows, err := tx.Query(ctx, `
			select "offeringId", "sessionNo" from class_sessions where "offeringId" = any($1) and "sessionNo" is not null`, offeringIDs)
		if err != nil {
			return nil, err
		}
		for erows.Next() {
			var oid int64
			var no int
			if erows.Scan(&oid, &no) == nil {
				if existing[oid] == nil {
					existing[oid] = map[int]bool{}
				}
				existing[oid][no] = true
			}
		}
		erows.Close()
	}

	sessionsPerOffering := map[int64]int{}
	warnings := []string{}
	type sessionValue struct {
		offeringID  int64
		sessionDate string
		startTime   string
		endTime     string
		sessionNo   int
	}
	values := []sessionValue{}
	skipped := 0
	for _, sr := range schedRows {
		if sr.DayOfWeek < 0 || sr.DayOfWeek > 6 {
			warnings = append(warnings, fmt.Sprintf("برنامهٔ هفتگی offering %d (درس %s) روز هفتهٔ نامعتبر دارد و نادیده گرفته شد.", sr.OfferingID, sr.CourseCode))
			if _, ok := sessionsPerOffering[sr.OfferingID]; !ok {
				sessionsPerOffering[sr.OfferingID] = 0
			}
			continue
		}
		dates, err := scheduling.ComputeSessionDates(scheduling.SessionDateInput{
			TermStart:      *classStart,
			ClassStartDate: classStart,
			ClassEndDate:   classEnd,
			DayOfWeek:      sr.DayOfWeek,
			SessionsCount:  sessionsCount,
			Holidays:       holidays,
			Recurrence:     sr.Recurrence,
		})
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("برنامهٔ هفتگی offering %d (درس %s) روز هفتهٔ نامعتبر دارد و نادیده گرفته شد.", sr.OfferingID, sr.CourseCode))
			if _, ok := sessionsPerOffering[sr.OfferingID]; !ok {
				sessionsPerOffering[sr.OfferingID] = 0
			}
			continue
		}
		existingSet := existing[sr.OfferingID]
		kept := 0
		for _, d := range dates {
			if existingSet[d.SessionNo] {
				kept++
				continue
			}
			values = append(values, sessionValue{
				offeringID: sr.OfferingID, sessionDate: d.JalaliDate,
				startTime: schedHM(&sr.StartTime), endTime: schedHM(&sr.EndTime), sessionNo: d.SessionNo,
			})
		}
		skipped += kept
		sessionsPerOffering[sr.OfferingID] = len(dates) - kept
	}

	generated := 0
	if !px.DryRun && len(values) > 0 {
		for i := 0; i < len(values); i += 400 {
			end := i + 400
			if end > len(values) {
				end = len(values)
			}
			batch := values[i:end]
			for _, v := range batch {
				if _, err := tx.Exec(ctx, `
					insert into class_sessions ("offeringId", "sessionDate", "startTime", "endTime", status, "sessionNo", "isMakeUpSession", "universityId")
					values ($1,$2,$3,$4,'SCHEDULED',$5,0,$6)`,
					v.offeringID, v.sessionDate, v.startTime, v.endTime, v.sessionNo, uniID); err != nil {
					return nil, errors.New("خطا در ذخیرهٔ جلسات تولیدشده؛ لطفاً دوباره تلاش کنید و در صورت تکرار به آموزش اطلاع دهید.")
				}
			}
		}
		generated = len(values)
	}
	_ = skipped // reported in the output

	termStartStr := classStart.Format("2006-01-02")
	schedAuditTx(ctx, tx, &actorID, "SCHEDULING_SESSIONS_GENERATED", "academic_term", px.TermID, map[string]any{
		"generated": len(values), "skipped": skipped, "offerings": len(offeringIDs),
		"sessionsPerOffering": sessionsPerOffering, "holidays": len(holidays), "termStart": termStartStr,
	})
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &SchedGenerateResult{
		OK: true, Generated: generated, Skipped: skipped, Warnings: warnings,
		Offerings: len(offeringIDs), SessionsPerOffering: sessionsPerOffering,
		HardConflicts: conflictReport.Conflicts, TermStart: &termStartStr,
	}, nil
}

// ─────────────────────────── V1 conflict detection ───────────────────────────

// SchedConflictCheckResult output of checkScheduleConflictsAction.
type SchedConflictCheckResult struct {
	Conflicts    []scheduling.ScheduleConflict `json:"conflicts"`
	HasConflicts bool                          `json:"hasConflicts"`
}

// CheckScheduleConflicts port of checkScheduleConflictsAction.
func (s *Service) CheckScheduleConflicts(ctx context.Context, user *session.User, cookie string, termID int64) (*SchedConflictCheckResult, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	var termExists int
	if err := s.DB.Pool.QueryRow(ctx, `
		select count(*) from academic_terms where id = $1 and `+schedScopeCond(`"universityId"`, uniID), termID).Scan(&termExists); err != nil || termExists == 0 {
		return nil, errors.New("ترم متعلق به دانشگاه دیگری است.")
	}

	type schedRow struct {
		offeringID  int64
		day         *int
		start, end  string
		roomID      *int64
		capacity    int
		courseTitle string
		groupNumber int
	}
	rows := []schedRow{}
	srows, err := s.DB.Pool.Query(ctx, `
		select s."offeringId", s."dayOfWeek", to_char(s."startTime",'HH24:MI'), to_char(s."endTime",'HH24:MI'),
		       s."roomId", o.capacity, c.title, o."groupNumber"
		  from schedules s
		  join course_offerings o on o.id = s."offeringId"
		  join courses c on c.id = o."courseId"
		 where o."termId" = $1 and `+schedEqCond(`o."universityId"`, uniID), termID)
	if err != nil {
		return nil, err
	}
	for srows.Next() {
		var r schedRow
		if srows.Scan(&r.offeringID, &r.day, &r.start, &r.end, &r.roomID, &r.capacity, &r.courseTitle, &r.groupNumber) == nil {
			rows = append(rows, r)
		}
	}
	srows.Close()

	profByOffering := s.schedProfessorsByOffering(ctx, termID)
	entries := make([]scheduling.ScheduleConflictInput, 0, len(rows))
	for _, r := range rows {
		profIDs := []*int64{}
		for _, p := range profByOffering[r.offeringID] {
			v := p
			profIDs = append(profIDs, &v)
		}
		if len(profIDs) == 0 {
			profIDs = append(profIDs, nil) // same [null] as in Next
		}
		title := r.courseTitle
		if r.groupNumber > 1 {
			title += fmt.Sprintf(" (گروه %d)", r.groupNumber)
		}
		entries = append(entries, scheduling.ScheduleConflictInput{
			OfferingID: r.offeringID, GroupNumber: &r.groupNumber, DayOfWeek: r.day,
			StartTime: r.start, EndTime: r.end, RoomID: r.roomID,
			RequiredCapacity: r.capacity, ProfessorIDs: profIDs, OfferingTitle: title,
		})
	}
	roomRows := []scheduling.RoomCapacityInfo{}
	rrows, err := s.DB.Pool.Query(ctx, `
		select id, coalesce(capacity,0), name from classrooms where `+schedScopeCond(`"universityId"`, uniID))
	if err == nil {
		for rrows.Next() {
			var r scheduling.RoomCapacityInfo
			if rrows.Scan(&r.ID, &r.Capacity, &r.Title) == nil {
				roomRows = append(roomRows, r)
			}
		}
		rrows.Close()
	}
	conflicts := scheduling.DetectScheduleConflictsV1(entries, roomRows)
	return &SchedConflictCheckResult{Conflicts: conflicts, HasConflicts: len(conflicts) > 0}, nil
}

// ─────────────────────────── scheduling dashboard ───────────────────────────

// SchedDashboardBundle output of getSchedulingDashboardAction.
type SchedDashboardBundle struct {
	Terms                 []map[string]any `json:"terms"`
	Rooms                 []map[string]any `json:"rooms"`
	Professors            []map[string]any `json:"professors"`
	Phases                []map[string]any `json:"phases"`
	ActiveTermID          *int64           `json:"activeTermId"`
	Offerings             []map[string]any `json:"offerings"`
	Schedules             []map[string]any `json:"schedules"`
	OfferingProfessors    []map[string]any `json:"offeringProfessors"`
	GeneratedSessionCount int              `json:"generatedSessionCount"`
	Phase                 string           `json:"phase"`
}

// GetSchedulingDashboard port of getSchedulingDashboardAction.
func (s *Service) GetSchedulingDashboard(ctx context.Context, user *session.User, cookie string, termID *int64) (*SchedDashboardBundle, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := &SchedDashboardBundle{
		Terms: []map[string]any{}, Rooms: []map[string]any{}, Professors: []map[string]any{},
		Phases: []map[string]any{}, Offerings: []map[string]any{}, Schedules: []map[string]any{},
		OfferingProfessors: []map[string]any{}, Phase: "SUPPLY",
	}

	trows, err := s.DB.Pool.Query(ctx, `
		select id, "termCode", title, coalesce("isCurrent",0), coalesce("isSummer",0), "startDate"::text
		  from academic_terms where `+schedScopeCond(`"universityId"`, uniID)+` order by id desc`)
	if err == nil {
		for trows.Next() {
			var id int64
			var code, title string
			var cur, summer int
			var start *string
			if trows.Scan(&id, &code, &title, &cur, &summer, &start) == nil {
				out.Terms = append(out.Terms, map[string]any{
					"id": id, "termCode": code, "title": title, "isCurrent": cur, "isSummer": summer, "startDate": start,
				})
			}
		}
		trows.Close()
	}
	rrows, err := s.DB.Pool.Query(ctx, `
		select id, name, coalesce("buildingName",''), coalesce(capacity,0), coalesce("roomType",'THEORY'),
		       coalesce("facultyId",0), coalesce("isActive",1)
		  from classrooms where `+schedScopeCond(`"universityId"`, uniID)+` order by name`)
	if err == nil {
		for rrows.Next() {
			var id int64
			var name, building, roomType string
			var capacity, facultyID, isActive int
			if rrows.Scan(&id, &name, &building, &capacity, &roomType, &facultyID, &isActive) == nil {
				out.Rooms = append(out.Rooms, map[string]any{
					"id": id, "name": name, "buildingName": building, "capacity": capacity,
					"roomType": roomType, "facultyId": facultyID, "isActive": isActive,
				})
			}
		}
		rrows.Close()
	}
	prows, err := s.DB.Pool.Query(ctx, `
		select st.id, st."staffCode", coalesce(st."departmentId",0), st.title, u."firstName", u."lastName",
		       coalesce(st."isActive",1), d.name, f.name
		  from staff st
		  join users u on u.id = st."userId"
		  left join departments d on d.id = st."departmentId"
		  left join faculties f on f.id = d."facultyId"
		 where `+schedScopeCond(`st."universityId"`, uniID)+`
		 order by st."staffCode"`)
	if err == nil {
		for prows.Next() {
			var id int64
			var staffCode, first, last string
			var deptID int
			var title *string
			var isActive int
			var deptName, facName *string
			if prows.Scan(&id, &staffCode, &deptID, &title, &first, &last, &isActive, &deptName, &facName) == nil {
				out.Professors = append(out.Professors, map[string]any{
					"id": id, "staffCode": staffCode, "departmentId": deptID, "title": title,
					"name": first, "lastname": last, "isActive": isActive,
					"departmentName": deptName, "facultyName": facName,
				})
			}
		}
		prows.Close()
	}
	phrows, err := s.DB.Pool.Query(ctx, `
		select "termId", phase from term_scheduling_states where `+schedScopeCond(`"universityId"`, uniID))
	if err == nil {
		for phrows.Next() {
			var tid int64
			var ph string
			if phrows.Scan(&tid, &ph) == nil {
				out.Phases = append(out.Phases, map[string]any{"termId": tid, "phase": ph})
			}
		}
		phrows.Close()
	}

	// Target term
	var currentID *int64
	_ = s.DB.Pool.QueryRow(ctx, `
		select id from academic_terms where coalesce("isCurrent",0) = 1 and `+schedScopeCond(`"universityId"`, uniID)+` limit 1`).Scan(&currentID)
	var target *int64
	if termID != nil {
		known := false
		for _, t := range out.Terms {
			if v, _ := t["id"].(int64); termID != nil && v == *termID {
				known = true
				break
			}
		}
		if !known {
			return nil, errors.New("ترم متعلق به دانشگاه دیگری است.")
		}
		v := *termID
		target = &v
	}
	if target == nil {
		target = currentID
	}
	if target == nil && len(out.Terms) > 0 {
		if v, ok := out.Terms[0]["id"].(int64); ok {
			target = &v
		}
	}
	out.ActiveTermID = target

	state := map[string]any(nil)
	for _, p := range out.Phases {
		if v, ok := p["termId"].(int64); ok && target != nil && v == *target {
			state = p
			break
		}
	}
	if state != nil {
		out.Phases = []map[string]any{state}
		if ph, ok := state["phase"].(string); ok {
			out.Phase = ph
		}
	}

	if target != nil {
		orows, err := s.DB.Pool.Query(ctx, `
			select o.id, o."termId", o."courseId", o."groupNumber", o.capacity, coalesce(o."isActive",1),
			       c.code, c.title, c."units"::text
			  from course_offerings o join courses c on c.id = o."courseId"
			 where o."termId" = $1 and `+schedEqCond(`o."universityId"`, uniID)+`
			 order by o."courseId", o."groupNumber"`, *target)
		if err == nil {
			offeringIDs := []int64{}
			for orows.Next() {
				var id, termID2, courseID int64
				var group, capacity, isActive int
				var code, title, units string
				if orows.Scan(&id, &termID2, &courseID, &group, &capacity, &isActive, &code, &title, &units) == nil {
					out.Offerings = append(out.Offerings, map[string]any{
						"id": id, "termId": termID2, "courseId": courseID, "groupNumber": group,
						"capacity": capacity, "isActive": isActive, "code": code, "title": title, "units": units,
					})
					offeringIDs = append(offeringIDs, id)
				}
			}
			orows.Close()

			if len(offeringIDs) > 0 {
				srows, err := s.DB.Pool.Query(ctx, `
					select id, "offeringId", "scheduleType", "dayOfWeek", "startTime"::text, "endTime"::text,
					       "examDate"::text, "roomId"
					  from schedules where "offeringId" = any($1) order by "offeringId"`, offeringIDs)
				if err == nil {
					for srows.Next() {
						var id, offeringID int64
						var scheduleType string
						var day *int
						var start, end, examDate *string
						var roomID *int64
						if srows.Scan(&id, &offeringID, &scheduleType, &day, &start, &end, &examDate, &roomID) == nil {
							out.Schedules = append(out.Schedules, map[string]any{
								"id": id, "offeringId": offeringID, "scheduleType": scheduleType,
								"dayOfWeek": day, "startTime": start, "endTime": end,
								"examDate": examDate, "roomId": roomID,
							})
						}
					}
					srows.Close()
				}
				oprows, err := s.DB.Pool.Query(ctx, `
					select op."offeringId", op."staffId", op.role from offering_professors op
					 where op."offeringId" = any($1)`, offeringIDs)
				if err == nil {
					for oprows.Next() {
						var offeringID int64
						var staffID *int64
						var role *string
						if oprows.Scan(&offeringID, &staffID, &role) == nil {
							out.OfferingProfessors = append(out.OfferingProfessors, map[string]any{
								"offeringId": offeringID, "staffId": staffID, "role": role,
							})
						}
					}
					oprows.Close()
				}
				_ = s.DB.Pool.QueryRow(ctx, `
					select count(*) from class_sessions where "offeringId" = any($1)`, offeringIDs).Scan(&out.GeneratedSessionCount)
			}
		}
	}
	return out, nil
}
