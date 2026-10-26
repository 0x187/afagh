// ═══ کمک‌تابع‌های کاتالوگ انتخاب واحد ═══
package enroll

import (
	"context"
	"time"

	"backend-go/internal/tuition"
)

// curriculumScope دامنهٔ چارت دانشجو.
type curriculumScope struct {
	Resolved    bool
	Reason      string
	VersionID   *int64
	VersionCode *string
	CourseIDs   map[int64]bool
	Recommended map[int64]*int
	Granted     map[int64]bool
}

func (s *Service) resolveCurriculumScope(ctx context.Context, studentID int64) curriculumScope {
	out := curriculumScope{
		CourseIDs: map[int64]bool{}, Recommended: map[int64]*int{}, Granted: map[int64]bool{},
	}
	if rows, err := s.DB.Pool.Query(ctx, `select "courseId" from student_course_grants where "studentId" = $1`, studentID); err == nil {
		for rows.Next() {
			var cid *int64
			if err := rows.Scan(&cid); err == nil && cid != nil {
				out.Granted[*cid] = true
			}
		}
		rows.Close()
	}

	version, err := ResolveStudentCurriculum(ctx, s.DB.Pool, studentID)
	if err != nil || version == nil {
		out.Reason = "NO_VERSIONS"
		if err == nil {
			out.Reason = "NO_MAJOR_OR_DEGREE"
		}
		return out
	}
	out.Resolved = true
	out.Reason = "RESOLVED"
	id := version.ID
	out.VersionID = &id
	code := version.VersionCode
	out.VersionCode = &code

	rows, err := s.DB.Pool.Query(ctx, `
		select "courseId", "recommendedSemester"
		  from curriculum_courses where "curriculumVersionId" = $1`, version.ID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var cid *int64
		var semester *int
		if err := rows.Scan(&cid, &semester); err != nil {
			continue
		}
		if cid == nil {
			continue
		}
		out.CourseIDs[*cid] = true
		out.Recommended[*cid] = semester
	}
	return out
}

// scopeOfferingsByCurriculum پورت scopeOfferingsByCurriculum.
func scopeOfferingsByCurriculum(offerings []rawOffering, scope curriculumScope, termOrdinal *int, retake map[int64]bool, requireChart bool) []rawOffering {
	if !scope.Resolved {
		if requireChart {
			return []rawOffering{}
		}
		return offerings
	}
	out := []rawOffering{}
	for _, o := range offerings {
		if !scope.CourseIDs[o.CourseID] {
			continue
		}
		if scope.Granted[o.CourseID] {
			out = append(out, o)
			continue
		}
		rec := scope.Recommended[o.CourseID]
		if rec == nil {
			out = append(out, o)
			continue
		}
		if termOrdinal != nil && *rec == *termOrdinal {
			out = append(out, o)
			continue
		}
		if retake[o.CourseID] {
			out = append(out, o)
			continue
		}
		if termOrdinal != nil && *rec < *termOrdinal {
			out = append(out, o)
			continue
		}
	}
	return out
}

// retakeCourseIDs دروس مردودی که هنوز پاس نشده و در جریان نیستند.
func (s *Service) retakeCourseIDs(ctx context.Context, studentID int64) map[int64]bool {
	rows, err := s.DB.Pool.Query(ctx, `
		select c.id, e."gradeValue", e.status, c."gradingType", c."affectsGpa", c."minPassedMark"
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1`, studentID)
	if err != nil {
		return map[int64]bool{}
	}
	defer rows.Close()
	passed := map[int64]bool{}
	inProgress := map[int64]bool{}
	failed := map[int64]bool{}
	for rows.Next() {
		var (
			cid         int64
			grade       *float64
			status      *string
			gradingType *string
			affectsGpa  *int
			minMark     *float64
		)
		if err := rows.Scan(&cid, &grade, &status, &gradingType, &affectsGpa, &minMark); err != nil {
			continue
		}
		isDescriptive := (gradingType != nil && *gradingType == "DESCRIPTIVE") || (affectsGpa != nil && *affectsGpa == 0)
		bar := 10.0
		if minMark != nil && *minMark >= 0 && *minMark <= 20 {
			bar = *minMark
		}
		isPassed := (status != nil && *status == "EQUIV_PASSED") ||
			(grade != nil && ((isDescriptive && *grade != 0) || (!isDescriptive && *grade >= bar)))
		if isPassed {
			passed[cid] = true
			continue
		}
		if status != nil && *status == "DROPPED" {
			continue
		}
		if grade == nil && status != nil {
			switch *status {
			case "REGISTERED", "FINALIZED", "WAITLISTED", "PENDING_COUNCIL":
				inProgress[cid] = true
				continue
			}
		}
		failed[cid] = true
	}
	out := map[int64]bool{}
	for cid := range failed {
		if !passed[cid] && !inProgress[cid] {
			out[cid] = true
		}
	}
	return out
}

// loadProfessorNames نام استادهای ارائه‌های خام.
func (s *Service) loadProfessorNames(ctx context.Context, list []rawOffering) map[int64]string {
	out := map[int64]string{}
	ids := []int64{}
	seen := map[int64]bool{}
	for _, o := range list {
		if o.ProfessorID != nil && !seen[*o.ProfessorID] {
			seen[*o.ProfessorID] = true
			ids = append(ids, *o.ProfessorID)
		}
	}
	if len(ids) == 0 {
		return out
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select st.id, u."firstName", u."lastName"
		  from staff st join users u on u.id = st."userId"
		 where st.id = any($1)`, ids)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var fn, ln string
		if err := rows.Scan(&id, &fn, &ln); err == nil {
			out[id] = stringsTrim(fn + " " + ln)
		}
	}
	return out
}

func stringsTrim(v string) string {
	start, end := 0, len(v)
	for start < end && (v[start] == ' ' || v[start] == '\t' || v[start] == '\n' || v[start] == '\r') {
		start++
	}
	for end > start && (v[end-1] == ' ' || v[end-1] == '\t' || v[end-1] == '\n' || v[end-1] == '\r') {
		end--
	}
	return v[start:end]
}

// loadTuitionRules قواعد فعال دانشگاه + ترم مالی جاری.
func (s *Service) loadTuitionRules(ctx context.Context, universityID *int64) ([]tuition.RuleLike, *int64) {
	rules := []tuition.RuleLike{}
	var currentFin *int64
	if universityID != nil {
		_ = s.DB.Pool.QueryRow(ctx, `
			select id from financial_terms
			 where "universityId" = $1 and "isActive" = 1
			 order by "sortOrder" asc nulls last limit 1`, *universityID).Scan(&currentFin)
		rows, err := s.DB.Pool.Query(ctx, `
			select id, "degreeLevelId", "majorId", "facultyId", "termType", "offeringType",
			       "clinicalPhase", "entryYearFrom", "entryYearTo", "entryTermId", "currentTermId",
			       "fixedAmount", "perUnitTheory", "perUnitPractical", "perUnitGeneral",
			       "minSummerUnits", "percentUnderMin", priority, "isActive", "universityId"
			  from tuition_rules
			 where "isActive" = 1 and ("universityId" is null or "universityId" = $1)`, *universityID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var r tuition.RuleLike
				if err := rows.Scan(&r.ID, &r.DegreeLevelID, &r.MajorID, &r.FacultyID, &r.TermType,
					&r.OfferingType, &r.ClinicalPhase, &r.EntryYearFrom, &r.EntryYearTo,
					&r.EntryTermID, &r.CurrentTermID, &r.FixedAmount, &r.PerUnitTheory,
					&r.PerUnitPractical, &r.PerUnitGeneral, &r.MinSummerUnits,
					&r.PercentUnderMin, &r.Priority, &r.IsActive, &r.UniversityID); err == nil {
					rules = append(rules, r)
				}
			}
		}
	}
	return rules, currentFin
}

// loadCart سبد دانشجو با زمان‌بندی.
func (s *Service) loadCart(ctx context.Context, studentID int64, classMap map[int64][]ClassSlot, examMap map[int64]*ExamSlot) []CartItem {
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, o."courseId", c.code, c.title, c.units,
		       coalesce(o."groupNumber",0)
		  from cart_items ci
		  join course_offerings o on o.id = ci."offeringId"
		  join courses c on c.id = o."courseId"
		 where ci."studentId" = $1
		 order by ci."createdAt"`, studentID)
	if err != nil {
		return []CartItem{}
	}
	defer rows.Close()
	out := []CartItem{}
	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ID, &item.CourseID, &item.Code, &item.Title, &item.Units, &item.Group); err != nil {
			return out
		}
		out = append(out, item)
	}
	for i := range out {
		if cls, ok := classMap[out[i].ID]; ok {
			out[i].ClassSchedules = cls
		} else {
			out[i].ClassSchedules = []ClassSlot{}
		}
		out[i].ExamSchedule = examMap[out[i].ID]
	}
	return out
}

// enrolledOfferingIDs ارائه‌های ثبت‌شدهٔ ترم (وضعیت‌های فعال).
func (s *Service) enrolledOfferingIDs(ctx context.Context, studentID, termID int64) []int64 {
	rows, err := s.DB.Pool.Query(ctx, `
		select e."offeringId" from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		 where e."studentId" = $1 and o."termId" = $2
		   and e.status in ('REGISTERED','FINALIZED','WAITLISTED','PENDING_COUNCIL')`, studentID, termID)
	if err != nil {
		return []int64{}
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			out = append(out, id)
		}
	}
	return out
}

func (s *Service) cartStartedAt(ctx context.Context, studentID int64) *int64 {
	var t *time.Time
	_ = s.DB.Pool.QueryRow(ctx, `select min("createdAt") from cart_items where "studentId" = $1`, studentID).Scan(&t)
	if t == nil {
		return nil
	}
	ms := t.UnixMilli()
	return &ms
}

func (s *Service) loadBypassRequests(ctx context.Context, studentID int64) []BypassRequest {
	rows, err := s.DB.Pool.Query(ctx, `
		select b.id, b."offeringId", b.kind, b.status, c.title
		  from enroll_bypass_requests b
		  join course_offerings o on o.id = b."offeringId"
		  join courses c on c.id = o."courseId"
		 where b."studentId" = $1
		   and b.status in ('PENDING_MANAGER','ESCALATED_EXPERT','APPROVED','REJECTED')
		 order by b.id desc`, studentID)
	if err != nil {
		return []BypassRequest{}
	}
	defer rows.Close()
	out := []BypassRequest{}
	for rows.Next() {
		var b BypassRequest
		if err := rows.Scan(&b.ID, &b.OfferingID, &b.Kind, &b.Status, &b.CourseTitle); err == nil {
			out = append(out, b)
		}
	}
	return out
}

// nowDateString تاریخ امروز میلادی yyyy-mm-dd.
func nowDateString() string { return time.Now().Format("2006-01-02") }
