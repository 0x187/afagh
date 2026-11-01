// ═══ Regulation check of Sama grade status codes — port of admin/regulation-check ═══
//
// Scan finalized grades and compare the current code with the correct regulation code (resolveSamaCode),
// apply batch corrections with logging in grade_change_log, and find graduates without
// any grade record (status mismatch).
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/enroll"
	"backend-go/internal/gradestatus"
	"backend-go/internal/session"
)

const samaScanLimit = 2000

// SamaMismatchRow: a grade with an incorrect status code.
type SamaMismatchRow struct {
	EnrollmentID   int64    `json:"enrollmentId"`
	StudentID      int64    `json:"studentId"`
	StudentCode    string   `json:"studentCode"`
	StudentName    string   `json:"studentName"`
	CourseCode     string   `json:"courseCode"`
	CourseTitle    string   `json:"courseTitle"`
	TermCode       string   `json:"termCode"`
	GradeValue     *float64 `json:"gradeValue"`
	CurrentCode    *string  `json:"currentCode"`
	CorrectCode    *string  `json:"correctCode"`
	CorrectTitle   string   `json:"correctTitle"`
	OriginalCode   *string  `json:"originalCode"`
	RegulationName *string  `json:"regulationTitle"`
}

// SamaScanResult: scan result.
type SamaScanResult struct {
	Rows      []SamaMismatchRow `json:"rows"`
	Scanned   int               `json:"scanned"`
	Truncated bool              `json:"truncated"`
}

// StatusMismatchRow: a graduate without a grade record.
type StatusMismatchRow struct {
	StudentID      int64   `json:"studentId"`
	StudentCode    string  `json:"studentCode"`
	StudentName    string  `json:"studentName"`
	GraduateDate   *string `json:"graduateDate"`
	RegulationName *string `json:"regulationTitle"`
}

// ── resolver helper data ──

type samaRegConfig struct {
	GradingAndGPA struct {
		FailedSamaStatusCode  string   `json:"failed_sama_status_code"`
		FailedCourseGpaPolicy string   `json:"failed_course_gpa_policy"`
		DefaultPassingGrade   *float64 `json:"default_passing_grade"`
		RetakeMinGrade        *float64 `json:"retakeMinGrade"`
	} `json:"grading_and_gpa"`
}

type samaStudent struct {
	ID         int64
	RegTitle   *string
	RegConfig  *samaRegConfig
	HasRegInfo bool
}

type samaOffering struct {
	CourseID      int64
	TermCode      *string
	TermSortOrder *int
	DefaultAccept *string
	DefaultReject *string
	CourseMin     *float64
	GradingType   string
}

type samaCurriculumCourse struct {
	PassCode *string
	FailCode *string
	MinGrade *float64
}

type samaPassRow struct {
	GradeValue    *float64
	GradeStatus   string
	SamaCode      *string
	TermCode      *string
	TermSortOrder *int
}

// samaResolver: cached — a 2000-row scan without repeating constant queries.
type samaResolver struct {
	ctx       context.Context
	s         *Service
	students  map[int64]*samaStudent
	offerings map[int64]*samaOffering
	versions  map[int64]*int64
	ccRows    map[string]*samaCurriculumCourse
	passes    map[string][]samaPassRow
}

func newSamaResolver(ctx context.Context, s *Service) *samaResolver {
	return &samaResolver{
		ctx: ctx, s: s,
		students:  map[int64]*samaStudent{},
		offerings: map[int64]*samaOffering{},
		versions:  map[int64]*int64{},
		ccRows:    map[string]*samaCurriculumCourse{},
		passes:    map[string][]samaPassRow{},
	}
}

func ptrTrim(v *string) *string {
	if v == nil {
		return nil
	}
	t := strings.TrimSpace(*v)
	if t == "" {
		return nil
	}
	return &t
}

func strPtrEq(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// termChronologicalValue port of term-chronology.ts.
func termChronologicalValue(termCode *string, sortOrder *int) int {
	if sortOrder != nil && *sortOrder > 0 {
		return *sortOrder
	}
	if termCode == nil {
		return 0
	}
	code := strings.TrimSpace(*termCode)
	if len(code) == 3 {
		code = "13" + code
	} else if len(code) == 4 && (strings.HasPrefix(code, "4") || strings.HasPrefix(code, "0")) {
		code = "1" + code
	}
	// parseInt: up to the first non-digit character
	end := 0
	for end < len(code) && code[end] >= '0' && code[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0
	}
	n, err := strconv.Atoi(code[:end])
	if err != nil {
		return 0
	}
	return n
}

func (r *samaResolver) loadStudent(studentID int64) *samaStudent {
	if v, ok := r.students[studentID]; ok {
		return v
	}
	st := &samaStudent{ID: studentID}
	var regTitle *string
	var regConfig *string
	err := r.s.DB.Pool.QueryRow(r.ctx, `
		select er.title, er."rulesConfig"
		  from students st left join educational_regulations er on er.id = st."regulationId"
		 where st.id = $1`, studentID).Scan(&regTitle, &regConfig)
	if err == nil {
		st.RegTitle = regTitle
		if regConfig != nil {
			var cfg samaRegConfig
			if json.Unmarshal([]byte(*regConfig), &cfg) == nil {
				st.RegConfig = &cfg
			}
		}
		st.HasRegInfo = true
	}
	r.students[studentID] = st
	return st
}

func (r *samaResolver) loadOffering(offeringID int64) *samaOffering {
	if v, ok := r.offerings[offeringID]; ok {
		return v
	}
	var o samaOffering
	var grading *string
	err := r.s.DB.Pool.QueryRow(r.ctx, `
		select o."courseId", t."termCode", t."sortOrder",
		       c."defaultAcceptMarkState", c."defaultRejectMarkState",
		       c."minPassedMark"::float8, c."gradingType"
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join academic_terms t on t.id = o."termId"
		 where o.id = $1`, offeringID).
		Scan(&o.CourseID, &o.TermCode, &o.TermSortOrder, &o.DefaultAccept, &o.DefaultReject, &o.CourseMin, &grading)
	if err != nil {
		r.offerings[offeringID] = nil
		return nil
	}
	if grading != nil {
		o.GradingType = *grading
	}
	r.offerings[offeringID] = &o
	return &o
}

func (r *samaResolver) curriculumRow(studentID, courseID int64) *samaCurriculumCourse {
	if _, ok := r.versions[studentID]; !ok {
		var vid *int64
		if v, err := enroll.ResolveStudentCurriculum(r.ctx, r.s.DB.Pool, studentID); err == nil && v != nil {
			id := v.ID
			vid = &id
		}
		r.versions[studentID] = vid
	}
	vid := r.versions[studentID]
	if vid == nil {
		return nil
	}
	key := fmt.Sprintf("%d:%d", *vid, courseID)
	if v, ok := r.ccRows[key]; ok {
		return v
	}
	var cc samaCurriculumCourse
	err := r.s.DB.Pool.QueryRow(r.ctx, `
		select "passGradeStatusCode", "failGradeStatusCode", "minGrade"::float8
		  from curriculum_courses where "curriculumVersionId" = $1 and "courseId" = $2 limit 1`,
		*vid, courseID).Scan(&cc.PassCode, &cc.FailCode, &cc.MinGrade)
	if err != nil {
		r.ccRows[key] = nil
		return nil
	}
	r.ccRows[key] = &cc
	return &cc
}

func (r *samaResolver) laterPasses(studentID, courseID int64) []samaPassRow {
	key := fmt.Sprintf("%d:%d", studentID, courseID)
	if v, ok := r.passes[key]; ok {
		return v
	}
	rows, err := r.s.DB.Pool.Query(r.ctx, `
		select e."gradeValue"::float8, coalesce(e."gradeStatus",''), e."samaGradeStatusCode",
		       t."termCode", t."sortOrder"
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  left join academic_terms t on t.id = o."termId"
		 where e."studentId" = $1 and o."courseId" = $2`, studentID, courseID)
	out := []samaPassRow{}
	if err == nil {
		for rows.Next() {
			var p samaPassRow
			if err := rows.Scan(&p.GradeValue, &p.GradeStatus, &p.SamaCode, &p.TermCode, &p.TermSortOrder); err == nil {
				out = append(out, p)
			}
		}
		rows.Close()
	}
	r.passes[key] = out
	return out
}

func regulationFailExcludeCode(regTitle *string, cfg *samaRegConfig) string {
	if cfg != nil {
		if code := strings.TrimSpace(cfg.GradingAndGPA.FailedSamaStatusCode); code != "" {
			return code
		}
		if cfg.GradingAndGPA.FailedCourseGpaPolicy == "EXCLUDE_IF_PASSED_1391" {
			return "-91"
		}
	}
	if regTitle != nil {
		title := *regTitle
		if strings.Contains(title, "۹۴") || strings.Contains(title, "94") {
			return "941"
		}
		if strings.Contains(title, "۹۵") || strings.Contains(title, "95") {
			return "951"
		}
	}
	if cfg != nil && cfg.GradingAndGPA.FailedCourseGpaPolicy == "EXCLUDE_IF_PASSED" {
		return "931"
	}
	return ""
}

func resolveRetakeBar(policy string, retakeMin *float64, passingGrade float64) *float64 {
	if policy != "EXCLUDE_IF_PASSED_1391" {
		return nil
	}
	if retakeMin != nil && *retakeMin > 0 {
		v := *retakeMin
		return &v
	}
	if passingGrade > 0 {
		v := passingGrade
		return &v
	}
	return nil
}

// resolve: port of resolveSamaGradeStatusCode. Empty output = null in TS.
func (r *samaResolver) resolve(studentID, offeringID int64, gradeValue *float64, currentCode *string) string {
	if gradeValue == nil {
		if c := ptrTrim(currentCode); c != nil {
			return *c
		}
		return ""
	}
	numGrade := *gradeValue
	student := r.loadStudent(studentID)
	if student == nil || !student.HasRegInfo {
		return ""
	}
	off := r.loadOffering(offeringID)
	if off == nil {
		return ""
	}

	courseDefaultPass := ptrTrim(off.DefaultAccept)
	courseDefaultFail := ptrTrim(off.DefaultReject)
	var cfg *samaRegConfig
	if student.RegConfig != nil {
		cfg = student.RegConfig
	}

	cc := r.curriculumRow(studentID, off.CourseID)

	passingGrade := 10.0
	if off.CourseMin != nil && *off.CourseMin > 0 {
		passingGrade = *off.CourseMin
	} else if cc != nil && cc.MinGrade != nil && *cc.MinGrade > 0 {
		passingGrade = *cc.MinGrade
	} else if cfg != nil && cfg.GradingAndGPA.DefaultPassingGrade != nil && *cfg.GradingAndGPA.DefaultPassingGrade > 0 {
		passingGrade = *cfg.GradingAndGPA.DefaultPassingGrade
	}

	passed := numGrade >= passingGrade
	if off.GradingType == "DESCRIPTIVE" {
		passed = numGrade == 1
	}

	if passed {
		if courseDefaultPass != nil && *courseDefaultPass != "1" {
			return *courseDefaultPass
		}
		if cc != nil {
			if c := ptrTrim(cc.PassCode); c != nil {
				return *c
			}
		}
		if courseDefaultPass != nil {
			return *courseDefaultPass
		}
		return "1"
	}

	// The current frozen code (5/6/7/22 and …) is never changed by regulation logic.
	if c := ptrTrim(currentCode); c != nil && gradestatus.RegulationFrozenCodes[*c] {
		return *c
	}
	if courseDefaultFail != nil && *courseDefaultFail != "2" {
		return *courseDefaultFail
	}
	if cc != nil {
		if c := ptrTrim(cc.FailCode); c != nil && *c != "2" {
			return *c
		}
	}

	targetExcludeCode := regulationFailExcludeCode(student.RegTitle, cfg)
	policy := ""
	var retakeMin *float64
	if cfg != nil {
		policy = cfg.GradingAndGPA.FailedCourseGpaPolicy
		retakeMin = cfg.GradingAndGPA.RetakeMinGrade
	}
	retakeNeed := resolveRetakeBar(policy, retakeMin, passingGrade)

	if targetExcludeCode != "" {
		currentChrono := termChronologicalValue(off.TermCode, off.TermSortOrder)
		hasLaterPass := false
		for _, e := range r.laterPasses(studentID, off.CourseID) {
			otherChrono := termChronologicalValue(e.TermCode, e.TermSortOrder)
			if otherChrono <= currentChrono {
				continue
			}
			if e.GradeStatus == "EXEMPT" || e.GradeStatus == "PASSED_NO_GRADE" {
				hasLaterPass = true
				break
			}
			if e.SamaCode != nil && gradestatus.IsPassed(*e.SamaCode) {
				hasLaterPass = true
				break
			}
			if e.GradeStatus != "FINALIZED" || e.GradeValue == nil {
				continue
			}
			bar := passingGrade
			if retakeNeed != nil {
				bar = *retakeNeed
			}
			if off.GradingType == "DESCRIPTIVE" {
				if *e.GradeValue == 1 {
					hasLaterPass = true
					break
				}
			} else if *e.GradeValue >= bar {
				hasLaterPass = true
				break
			}
		}
		if hasLaterPass {
			return targetExcludeCode
		}
	}

	if courseDefaultFail != nil {
		return *courseDefaultFail
	}
	return "2"
}

// ScanMismatchedSamaCodes port of scanMismatchedSamaCodes.
func (s *Service) ScanMismatchedSamaCodes(ctx context.Context, user *session.User, cookie string) (*SamaScanResult, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال مشخص نیست.")
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select e.id, e."studentId", e."offeringId", st."studentCode",
		       coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",''),
		       c.code, c.title, t."termCode", e."gradeValue"::float8,
		       e."samaGradeStatusCode", e."originalSamaCode", er.title
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		  join academic_terms t on t.id = o."termId"
		  join students st on st.id = e."studentId"
		  join users u on u.id = st."userId"
		  left join educational_regulations er on er.id = st."regulationId"
		 where e."gradeStatus" = 'FINALIZED' and st."universityId" = $1
		 order by st."studentCode", t."termCode"
		 limit $2`, *uniID, samaScanLimit+1)
	if err != nil {
		return nil, err
	}
	type rawRow struct {
		EnrollmentID int64
		StudentID    int64
		OfferingID   int64
		StudentCode  string
		StudentName  string
		CourseCode   string
		CourseTitle  string
		TermCode     *string
		GradeValue   *float64
		CurrentCode  *string
		OriginalCode *string
		RegTitle     *string
	}
	all := []rawRow{}
	for rows.Next() {
		var r rawRow
		if err := rows.Scan(&r.EnrollmentID, &r.StudentID, &r.OfferingID, &r.StudentCode, &r.StudentName,
			&r.CourseCode, &r.CourseTitle, &r.TermCode, &r.GradeValue,
			&r.CurrentCode, &r.OriginalCode, &r.RegTitle); err != nil {
			rows.Close()
			return nil, err
		}
		all = append(all, r)
	}
	rows.Close()

	truncated := len(all) > samaScanLimit
	if truncated {
		all = all[:samaScanLimit]
	}
	resolver := newSamaResolver(ctx, s)
	out := []SamaMismatchRow{}
	for _, r := range all {
		correct := resolver.resolve(r.StudentID, r.OfferingID, r.GradeValue, r.CurrentCode)
		correctPtr := ptrTrim(&correct)
		cur := ptrTrim(r.CurrentCode)
		if strPtrEq(cur, correctPtr) {
			continue
		}
		title := "نامشخص"
		if correctPtr != nil {
			if t := gradestatus.TitleOf(*correctPtr); t != nil {
				title = *t
			}
		}
		term := ""
		if r.TermCode != nil {
			term = *r.TermCode
		}
		out = append(out, SamaMismatchRow{
			EnrollmentID: r.EnrollmentID, StudentID: r.StudentID,
			StudentCode: r.StudentCode, StudentName: r.StudentName,
			CourseCode: r.CourseCode, CourseTitle: r.CourseTitle, TermCode: term,
			GradeValue: r.GradeValue, CurrentCode: cur, CorrectCode: correctPtr,
			CorrectTitle: title, OriginalCode: ptrTrim(r.OriginalCode), RegulationName: r.RegTitle,
		})
	}
	return &SamaScanResult{Rows: out, Scanned: len(all), Truncated: truncated}, nil
}

// ApplyCorrectedSamaCodes پورت applyCorrectedSamaCodes — سقف ۵۰۰ ردیف.
func (s *Service) ApplyCorrectedSamaCodes(ctx context.Context, user *session.User, cookie string, enrollmentIDs []int64) (int, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال مشخص نیست.")
	}
	if len(enrollmentIDs) > 500 {
		enrollmentIDs = enrollmentIDs[:500]
	}
	resolver := newSamaResolver(ctx, s)
	applied := 0
	for _, eid := range enrollmentIDs {
		var studentID, offeringID int64
		var gradeValue *float64
		var currentCode, originalCode *string
		err := s.DB.Pool.QueryRow(ctx, `
			select e."studentId", e."offeringId", e."gradeValue"::float8,
			       e."samaGradeStatusCode", e."originalSamaCode"
			  from enrollments e join students st on st.id = e."studentId"
			 where e.id = $1 and st."universityId" = $2`, eid, *uniID).
			Scan(&studentID, &offeringID, &gradeValue, &currentCode, &originalCode)
		if err == pgx.ErrNoRows {
			continue
		}
		if err != nil {
			return applied, err
		}
		correct := resolver.resolve(studentID, offeringID, gradeValue, currentCode)
		correctPtr := ptrTrim(&correct)
		cur := ptrTrim(currentCode)
		if strPtrEq(cur, correctPtr) {
			continue
		}
		newOriginal := originalCode
		if newOriginal == nil {
			newOriginal = currentCode
		}
		tag, err := s.DB.Pool.Exec(ctx, `
			update enrollments set "samaGradeStatusCode" = $2, "originalSamaCode" = $3 where id = $1`,
			eid, correctPtr, newOriginal)
		if err != nil {
			return applied, err
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		curLabel := "—"
		if cur != nil {
			curLabel = *cur
		}
		var gradeStr *string
		if gradeValue != nil {
			g := strconv.FormatFloat(*gradeValue, 'f', -1, 64)
			gradeStr = &g
		}
		_, _ = s.DB.Pool.Exec(ctx, `
			insert into grade_change_log ("enrollmentId","studentId","offeringId",action,
			       "oldGradeValue","newGradeValue","oldGradeStatus","newGradeStatus",
			       "oldSamaStatusCode","newSamaStatusCode","actorUserId","actorRole",reason)
			values ($1,$2,$3,'ADMIN_OVERRIDE',$4,$4,'FINALIZED','FINALIZED',$5,$6,$7,'ADMIN',$8)`,
			eid, studentID, offeringID, gradeStr, cur, correctPtr, user.ID,
			"بازمحاسبه خودکار کد وضعیت سما بر اساس آیین‌نامه (قبلی: "+curLabel+")")
		applied++
	}
	return applied, nil
}

// ScanGraduatedWithoutGrades پورت scanGraduatedWithoutGrades.
func (s *Service) ScanGraduatedWithoutGrades(ctx context.Context, user *session.User, cookie string, limit int) ([]StatusMismatchRow, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال مشخص نیست.")
	}
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select st.id, st."studentCode",
		       coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",''),
		       st."graduateDate", er.title
		  from students st
		  left join users u on u.id = st."userId"
		  left join educational_regulations er on er.id = st."regulationId"
		  left join enrollments e on e."studentId" = st.id and e."gradeStatus" = 'FINALIZED'
		  left join legacy_grades lg on lg."studentCode" = st."studentCode"
		 where st.status = 'GRADUATED' and e.id is null and lg.id is null and st."universityId" = $1
		 limit $2`, *uniID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StatusMismatchRow{}
	for rows.Next() {
		var r StatusMismatchRow
		if err := rows.Scan(&r.StudentID, &r.StudentCode, &r.StudentName, &r.GraduateDate, &r.RegulationName); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
