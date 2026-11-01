// ═══ Smart cart layout — port of autoFillCartFromChartAction ═══
package enroll

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"backend-go/internal/scope"
)

// AutoFillResult is the layout result.
type AutoFillResult struct {
	OK                bool    `json:"ok"`
	Count             int     `json:"count"`
	Units             float64 `json:"units"`
	Message           string  `json:"message"`
	ConflictsResolved int     `json:"conflictsResolved"`
}

// AutoFillCart ports autoFillCartFromChartAction.
func (s *Service) AutoFillCart(ctx context.Context, studentID int64) AutoFillResult {
	termID, uniID, err := s.currentTermForStudent(ctx, studentID)
	if err != nil {
		return AutoFillResult{Message: err.Error()}
	}
	var degreeLevelID *int64
	var entryYear int
	_ = s.DB.Pool.QueryRow(ctx, `select "degreeLevelId","entryYear" from students where id = $1`, studentID).Scan(&degreeLevelID, &entryYear)
	var majorID *int64
	_ = s.DB.Pool.QueryRow(ctx, `select "majorId" from students where id = $1`, studentID).Scan(&majorID)

	maxUnits := float64(MaxUnits)
	minUnits := 0.0
	if summary, err := EvaluateStudentRegulationStatus(ctx, s.DB.Pool, studentID, &termID); err == nil {
		maxUnits = summary.EffectiveMaxUnits
		minUnits = summary.MinAllowedUnits
	}

	prereq, err := BuildPrereqContext(ctx, s.DB.Pool, studentID)
	if err != nil {
		prereq = &PrereqContext{Passed: map[string]float64{}, RuleByCourse: map[int64]*LogicCondition{}, Titles: map[string]string{}}
	}
	passesPrereqs := func(courseID int64) bool {
		rule := prereq.RuleByCourse[courseID]
		if rule == nil {
			return true
		}
		ok, _ := EvaluateLogicTree(rule, prereq.Passed)
		return ok
	}

	registered := map[int64]bool{}
	if rows, err := s.DB.Pool.Query(ctx, `
		select o."courseId" from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		 where e."studentId" = $1 and o."termId" = $2
		   and e.status in ('REGISTERED','PENDING_COUNCIL')`, studentID, termID); err == nil {
		for rows.Next() {
			var cid int64
			if err := rows.Scan(&cid); err == nil {
				registered[cid] = true
			}
		}
		rows.Close()
	}

	var termCode string
	_ = s.DB.Pool.QueryRow(ctx, `select "termCode" from academic_terms where id = $1`, termID).Scan(&termCode)
	var entryTerm *int
	_ = s.DB.Pool.QueryRow(ctx, `select "entryTerm" from students where id = $1`, studentID).Scan(&entryTerm)
	ordinal := 0
	hasOrdinal := false
	if o := termOrdinalForEntryPtr(&entryYear, entryTerm, termCode); o != nil {
		ordinal = *o
		hasOrdinal = true
	}

	// chart.
	var chartPicks []struct {
		CourseID int64
		Code     string
		Semester *int
	}
	chartResolved := false
	if version, err := ResolveStudentCurriculum(ctx, s.DB.Pool, studentID); err == nil && version != nil {
		chartResolved = true
		rows, err := s.DB.Pool.Query(ctx, `
			select cc."courseId", c.code, cc."recommendedSemester"
			  from curriculum_courses cc join courses c on c.id = cc."courseId"
			 where cc."curriculumVersionId" = $1`, version.ID)
		if err == nil {
			for rows.Next() {
				var p struct {
					CourseID int64
					Code     string
					Semester *int
				}
				if err := rows.Scan(&p.CourseID, &p.Code, &p.Semester); err == nil {
					if registered[p.CourseID] {
						continue
					}
					if _, ok := prereq.Passed[p.Code]; ok {
						continue
					}
					if hasOrdinal && p.Semester != nil && *p.Semester > ordinal {
						continue
					}
					chartPicks = append(chartPicks, p)
				}
			}
			rows.Close()
		}
	}

	// Cleanup of the previous cart.
	if _, err := s.DB.Pool.Exec(ctx, `delete from cart_items where "studentId" = $1`, studentID); err != nil {
		return AutoFillResult{Message: "پاک‌سازی سبد ناموفق بود."}
	}

	// Viewable offerings.
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, o."courseId", c.code, c.title, c.units, coalesce(o."groupNumber",0),
		       o.capacity, o."enrolledCount", o."targetDegreeLevelId", o."targetMajorId",
		       o."entryYearStart", o."entryYearEnd"
		  from course_offerings o join courses c on c.id = o."courseId"
		 where o."termId" = $1 and o."isActive" = 1 and o."universityId" = $2`,
		termID, uniID)
	if err != nil {
		return AutoFillResult{Message: "خطای داخلی سرور."}
	}
	type offer struct {
		ID, CourseID                 int64
		Code, Title                  string
		Units                        float64
		Group, Capacity, Enrolled    int
		TargetDegreeLevelID          *int64
		TargetMajorID                *int64
		EntryYearStart, EntryYearEnd *int
	}
	visible := []offer{}
	scope := StudentScope{DegreeLevelID: degreeLevelID, MajorID: majorID, EntryYear: entryYear}
	for rows.Next() {
		var o offer
		if err := rows.Scan(&o.ID, &o.CourseID, &o.Code, &o.Title, &o.Units, &o.Group, &o.Capacity,
			&o.Enrolled, &o.TargetDegreeLevelID, &o.TargetMajorID, &o.EntryYearStart, &o.EntryYearEnd); err != nil {
			continue
		}
		if OfferingVisible(Targeting{
			TargetDegreeLevelID: o.TargetDegreeLevelID, TargetMajorID: o.TargetMajorID,
			EntryYearStart: o.EntryYearStart, EntryYearEnd: o.EntryYearEnd,
		}, scope) {
			visible = append(visible, o)
		}
	}
	rows.Close()

	// Sessions.
	offIDs := []int64{}
	for _, o := range visible {
		offIDs = append(offIDs, o.ID)
	}
	scheds := s.loadSchedules(ctx, offIDs)
	classByOff := map[int64][]scheduleRow{}
	examByOff := map[int64]*scheduleRow{}
	for i := range scheds {
		sc := scheds[i]
		if strings.ToUpper(sc.ScheduleType) == "EXAM" {
			examByOff[sc.OfferingID] = &sc
			continue
		}
		classByOff[sc.OfferingID] = append(classByOff[sc.OfferingID], sc)
	}

	allowed := map[int64]bool{}
	semOfCourse := map[int64]*int{}
	for _, p := range chartPicks {
		allowed[p.CourseID] = true
		semOfCourse[p.CourseID] = p.Semester
	}
	byCourse := map[int64][]offer{}
	for _, o := range visible {
		if chartResolved && !allowed[o.CourseID] {
			continue
		}
		if !passesPrereqs(o.CourseID) || registered[o.CourseID] {
			continue
		}
		if degreeLevelID != nil && *degreeLevelID == 1 &&
			(strings.HasPrefix(o.Code, "21") || strings.Contains(o.Title, "پایان‌نامه")) {
			continue
		}
		if strings.Contains(o.Title, "معرفی به استاد") || strings.Contains(o.Title, "مطالعه فردی") {
			continue
		}
		byCourse[o.CourseID] = append(byCourse[o.CourseID], o)
	}

	type courseEntry struct {
		CourseID int64
		Groups   []offer
	}
	ordered := make([]courseEntry, 0, len(byCourse))
	for cid, groups := range byCourse {
		ordered = append(ordered, courseEntry{CourseID: cid, Groups: groups})
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		si, sj := 99, 99
		if p := semOfCourse[ordered[i].CourseID]; p != nil {
			si = *p
		}
		if p := semOfCourse[ordered[j].CourseID]; p != nil {
			sj = *p
		}
		if si != sj {
			return si < sj
		}
		return ordered[i].CourseID < ordered[j].CourseID
	})

	chosen := []offer{}
	totalUnits := 0.0
	conflictsAvoided := 0
	for _, entry := range ordered {
		courseUnits := entry.Groups[0].Units
		if totalUnits+courseUnits > maxUnits {
			continue
		}
		var best *offer
		bestScore := -9999
		for gi := range entry.Groups {
			grp := entry.Groups[gi]
			hasCap := grp.Enrolled < grp.Capacity
			hasClassConflict := false
			hasExamConflict := false
			for _, ch := range chosen {
				for _, c1 := range classByOff[grp.ID] {
					for _, c2 := range classByOff[ch.ID] {
						if c1.DayOfWeek == nil || c2.DayOfWeek == nil || *c1.DayOfWeek != *c2.DayOfWeek {
							continue
						}
						if timeOverlap(c1.StartTime, c1.EndTime, c2.StartTime, c2.EndTime) {
							hasClassConflict = true
						}
					}
				}
				e1, e2 := examByOff[grp.ID], examByOff[ch.ID]
				if e1 != nil && e2 != nil && e1.ExamDate != nil && e2.ExamDate != nil && *e1.ExamDate == *e2.ExamDate {
					if timeOverlap(e1.StartTime, e1.EndTime, e2.StartTime, e2.EndTime) {
						hasExamConflict = true
					}
				}
			}
			score := 0
			if hasCap {
				score += 100
			}
			if !hasClassConflict {
				score += 500
			} else {
				score -= 500
			}
			if !hasExamConflict {
				score += 500
			} else {
				score -= 500
			}
			score -= grp.Group * 2
			if score > bestScore {
				bestScore = score
				g := grp
				best = &g
				if (hasClassConflict || hasExamConflict) && len(entry.Groups) > 1 {
					conflictsAvoided++
				}
			}
		}
		if best != nil && bestScore > 0 {
			chosen = append(chosen, *best)
			totalUnits += courseUnits
		}
	}

	for _, o := range chosen {
		_, _ = s.DB.Pool.Exec(ctx, `
			insert into cart_items ("studentId","offeringId","createdAt") values ($1,$2,now())
			on conflict ("studentId","offeringId") do nothing`, studentID, o.ID)
	}

	capNote := fmt.Sprintf("سقف مجاز شما %s واحد است", faNum(maxUnits))
	if len(chosen) == 0 {
		msg := "درسی برای چیدمان خودکار پیدا نشد. " + capNote + "."
		if chartResolved {
			msg = "درسی برای چیدمان خودکار پیدا نشد. " + capNote + ". ممکن است دروس واجد شرایط قبلاً گذرانده شده یا پیش‌نیازشان کامل نشده باشد؛ برای اخذ بدون رعایت پیش‌نیاز از «درخواست بایپس» استفاده کنید."
		}
		return AutoFillResult{OK: true, Message: msg}
	}
	minNote := ""
	if minUnits > 0 {
		minNote = fmt.Sprintf(" حداقل واحد این ترم %s واحد است.", faNum(minUnits))
	}
	return AutoFillResult{
		OK: true, Count: len(chosen), Units: totalUnits, ConflictsResolved: conflictsAvoided,
		Message: fmt.Sprintf("چیدمان هوشمند انجام شد: %d درس (%s واحد) با بررسی ظرفیت، پیش‌نیاز، تداخل کلاسی و امتحانی در سبد شما چیده شد. %s.%s",
			len(chosen), faNum(totalUnits), capNote, minNote),
	}
}

func termOrdinalForEntryPtr(entryYear *int, entryTerm *int, targetCode string) *int {
	if entryYear == nil {
		return nil
	}
	// We use the shared scope function so the rule stays consistent.
	return scope.TermOrdinalForEntry(entryYear, entryTerm, targetCode)
}
