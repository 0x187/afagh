// ═══ Student curriculum chart — port of student/chart ═══
package student

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"backend-go/internal/enroll"
)

// ChartRow is a chart course row.
type ChartRow struct {
	ID          int64    `json:"id"`
	CourseID    int64    `json:"courseId"`
	Code        string   `json:"code"`
	Title       string   `json:"title"`
	Units       float64  `json:"units"`
	RoleType    string   `json:"roleType"`
	PrereqCodes []string `json:"prereqCodes"`
	Status      string   `json:"status"` // PASSED | IN_PROGRESS | MISSING_PAST | FUTURE
}

// ChartSemester is a term group.
type ChartSemester struct {
	Key           int        `json:"key"`
	Title         string     `json:"title"`
	Units         float64    `json:"units"`
	IsCurrent     bool       `json:"isCurrent"`
	IsHighlighted bool       `json:"isHighlighted"`
	Rows          []ChartRow `json:"rows"`
}

// ChartRoleSummary is a course-type summary.
type ChartRoleSummary struct {
	RoleType    string  `json:"roleType"`
	Total       int     `json:"total"`
	Passed      int     `json:"passed"`
	Units       float64 `json:"units"`
	PassedUnits float64 `json:"passedUnits"`
}

// ChartResponse is the chart response.
type ChartResponse struct {
	Student           StudentInfo        `json:"student"`
	MajorName         string             `json:"majorName"`
	DegreeTitle       string             `json:"degreeTitle"`
	VersionCode       *string            `json:"versionCode"`
	ChartUnits        float64            `json:"chartUnits"`
	RequiredUnits     float64            `json:"requiredUnits"`
	EntryYear         int                `json:"entryYear"`
	Semesters         []ChartSemester    `json:"semesters"`
	RoleSummary       []ChartRoleSummary `json:"roleSummary"`
	EnrollmentCount   int                `json:"enrollmentCount"`
	FilteredTerm      *string            `json:"filteredTermTitle"`
	CurrentSemesterNo *int               `json:"currentSemesterNo"`
	HighlightAnchor   *string            `json:"highlightAnchor"`
}

var chartRoleFa = map[string]string{
	"CORE": "اصلی", "MAJOR": "تخصصی", "ELECTIVE": "اختیاری", "GENERAL": "عمومی",
	"THESIS": "پایان‌نامه", "INTERNSHIP": "کارآموزی", "WORKSHOP": "کارگاهی",
}

var semesterTitle = map[int]string{
	1: "نیمسال اول (ترم ۱)", 2: "نیمسال دوم (ترم ۲)", 3: "نیمسال سوم (ترم ۳)",
	4: "نیمسال چهارم (ترم ۴)", 5: "نیمسال پنجم (ترم ۵)", 6: "نیمسال ششم (ترم ۶)",
	7: "نیمسال هفتم (ترم ۷)", 8: "نیمسال هشتم (ترم ۸)", 9: "ترم تابستان",
}

// prereqCodes comes from the logic tree.
func prereqCodes(logicTree string) []string {
	out := []string{}
	var walk func(node map[string]any)
	walk = func(node map[string]any) {
		conds, _ := node["conditions"].([]any)
		for _, raw := range conds {
			cond, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			if c, ok := cond["course"].(string); ok && c != "" {
				out = append(out, c)
			} else if nested, ok := cond["conditions"].([]any); ok {
				walk(map[string]any{"conditions": nested})
			}
		}
	}
	var root map[string]any
	if json.Unmarshal([]byte(logicTree), &root) == nil {
		walk(root)
	}
	return out
}

// GetChart ports student/chart/page.tsx.
func (s *Service) GetChart(ctx context.Context, userID int64, userName string, termCookie *int64) (*ChartResponse, error) {
	me, err := s.Resolve(ctx, userID)
	if err != nil {
		return nil, err
	}
	if me == nil {
		return nil, errNoStudent
	}
	resp := &ChartResponse{
		Student:   StudentInfo{Name: userName, StudentCode: me.StudentCode, EntryYear: me.EntryYear},
		MajorName: "—", DegreeTitle: "—", EntryYear: me.EntryYear,
		Semesters: []ChartSemester{}, RoleSummary: []ChartRoleSummary{},
	}
	if me.MajorID != nil {
		_ = s.Pool.QueryRow(ctx, `select name from majors where id = $1`, *me.MajorID).Scan(&resp.MajorName)
	}
	if me.DegreeLevelID != nil {
		_ = s.Pool.QueryRow(ctx, `select title from degree_level_configs where id = $1`, *me.DegreeLevelID).Scan(&resp.DegreeTitle)
	}

	// Selected/current term.
	selection := s.Scope.GetTermScope(ctx, me.UniversityID, termCookie)
	var selectedTerm *int64
	if selection.SelectedID != nil {
		selectedTerm = selection.SelectedID
	}
	termID := selection.EffectiveID
	if selectedTerm != nil {
		termID = selectedTerm
		var title string
		if err := s.Pool.QueryRow(ctx, `select title from academic_terms where id = $1`, *termID).Scan(&title); err == nil {
			resp.FilteredTerm = &title
		}
	}

	// Course history.
	type enrollmentRow struct {
		CourseID    int64
		Units       float64
		GradingType *string
		AffectsGpa  *int
		MinMark     *float64
		Grade       *float64
		Status      string
		TermID      *int64
	}
	rows, err := s.Pool.Query(ctx, `
		select c.id, c.units, c."gradingType", c."affectsGpa", c."minPassedMark",
		       e."gradeValue", e.status, o."termId"
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1`, me.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	enrollments := []enrollmentRow{}
	for rows.Next() {
		var r enrollmentRow
		if err := rows.Scan(&r.CourseID, &r.Units, &r.GradingType, &r.AffectsGpa, &r.MinMark,
			&r.Grade, &r.Status, &r.TermID); err == nil {
			enrollments = append(enrollments, r)
		}
	}
	resp.EnrollmentCount = len(enrollments)

	passedIDs := map[int64]bool{}
	currentIDs := map[int64]bool{}
	for _, r := range enrollments {
		isDescriptive := (r.GradingType != nil && *r.GradingType == "DESCRIPTIVE") || (r.AffectsGpa != nil && *r.AffectsGpa == 0)
		minMark := 10.0
		if r.MinMark != nil && *r.MinMark >= 0 && *r.MinMark <= 20 {
			minMark = *r.MinMark
		}
		passed := r.Status == "EQUIV_PASSED" ||
			(r.Grade != nil && ((isDescriptive && *r.Grade != 0) || (!isDescriptive && *r.Grade >= minMark)))
		if passed {
			passedIDs[r.CourseID] = true
		}
		if termID != nil && r.TermID != nil && *r.TermID == *termID && r.Status != "DROPPED" {
			currentIDs[r.CourseID] = true
		}
	}

	// Resolve the chart version (university scope).
	var majorID *int64
	_ = s.Pool.QueryRow(ctx, `select "majorId" from students where id = $1`, me.ID).Scan(&majorID)
	if majorID == nil || me.DegreeLevelID == nil {
		return resp, nil
	}
	q := `select id, "majorId", "degreeLevelId", "trackId", "versionCode", status,
	             "entryYearFrom", "entryYearTo", "entryTermId", coalesce("totalRequiredUnits",0)::int
	      from curriculum_versions where "majorId" = $1`
	args := []any{*majorID}
	if me.UniversityID != nil {
		q += ` and "universityId" = $2`
		args = append(args, *me.UniversityID)
	}
	vrows, err := s.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	versions := []enroll.ResolvableVersion{}
	for vrows.Next() {
		var v enroll.ResolvableVersion
		if err := vrows.Scan(&v.ID, &v.MajorID, &v.DegreeLevelID, &v.TrackID, &v.VersionCode,
			&v.Status, &v.EntryYearFrom, &v.EntryYearTo, &v.EntryTermID, &v.TotalRequiredUID); err == nil {
			versions = append(versions, v)
		}
	}
	vrows.Close()
	outcome := enroll.ResolveApplicableCurriculum(versions, enroll.CurriculumContext{
		MajorID: *majorID, DegreeLevelID: *me.DegreeLevelID, TrackID: nil,
		EntryYear: me.EntryYear, EntryTerm: me.EntryTerm,
	})
	if outcome.Version == nil {
		return resp, nil
	}
	version := outcome.Version
	v := version.VersionCode
	resp.VersionCode = &v
	var versionTitle string
	var totalRequired *float64
	_ = s.Pool.QueryRow(ctx, `select coalesce(title,''), "totalRequiredUnits" from curriculum_versions where id = $1`, version.ID).
		Scan(&versionTitle, &totalRequired)
	if totalRequired != nil {
		resp.RequiredUnits = *totalRequired
	}

	// Chart courses.
	crows, err := s.Pool.Query(ctx, `
		select cc.id, c.id, c.code, c.title, c.units, cc.units, coalesce(cc."roleType",''),
		       cc."recommendedSemester"
		  from curriculum_courses cc
		  join courses c on c.id = cc."courseId"
		 where cc."curriculumVersionId" = $1
		 order by cc."recommendedSemester" asc nulls first, c.code asc`, version.ID)
	if err != nil {
		return nil, err
	}
	type chartRaw struct {
		ID         int64
		CourseID   int64
		Code       string
		Title      string
		Units      float64
		ChartUnits *float64
		RoleType   string
		Semester   *int
	}
	chart := []chartRaw{}
	for crows.Next() {
		var r chartRaw
		if err := crows.Scan(&r.ID, &r.CourseID, &r.Code, &r.Title, &r.Units, &r.ChartUnits, &r.RoleType, &r.Semester); err == nil {
			chart = append(chart, r)
		}
	}
	crows.Close()

	// Prerequisites.
	prereqMap := map[int64][]string{}
	if len(chart) > 0 {
		ids := make([]int64, len(chart))
		for i, r := range chart {
			ids[i] = r.CourseID
		}
		prows, err := s.Pool.Query(ctx, `
			select "courseId", coalesce("logicTree",'') from course_rules
			 where "ruleType" = 'PREREQ' and "courseId" = any($1)`, ids)
		if err == nil {
			for prows.Next() {
				var cid int64
				var tree string
				if err := prows.Scan(&cid, &tree); err == nil {
					prereqMap[cid] = prereqCodes(tree)
				}
			}
			prows.Close()
		}
	}

	// Grouping and stats.
	groups := map[int][]chartRaw{}
	for _, r := range chart {
		key := 0
		if r.Semester != nil {
			key = *r.Semester
		}
		groups[key] = append(groups[key], r)
	}
	keys := make([]int, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Ints(keys)
	currentSems := map[int]bool{}
	for _, r := range chart {
		if currentIDs[r.CourseID] {
			key := 0
			if r.Semester != nil {
				key = *r.Semester
			}
			currentSems[key] = true
		}
	}
	var currentSemNo *int
	for _, k := range keys {
		if currentSems[k] {
			v := k
			currentSemNo = &v
			break
		}
	}
	resp.CurrentSemesterNo = currentSemNo
	if selectedTerm != nil && currentSemNo != nil {
		anchor := fmt.Sprintf("afagh-term-sem-%d", *currentSemNo)
		resp.HighlightAnchor = &anchor
	}

	roleTotals := map[string]*ChartRoleSummary{}
	for _, r := range chart {
		units := r.Units
		if r.ChartUnits != nil {
			units = *r.ChartUnits
		}
		resp.ChartUnits += units
		role := r.RoleType
		if role == "" {
			role = "CORE"
		}
		item := roleTotals[role]
		if item == nil {
			item = &ChartRoleSummary{RoleType: role}
			roleTotals[role] = item
		}
		item.Total++
		item.Units += units
		if passedIDs[r.CourseID] {
			item.Passed++
			item.PassedUnits += units
		}
	}

	for _, key := range keys {
		list := groups[key]
		semUnits := 0.0
		rowsOut := []ChartRow{}
		for _, r := range list {
			units := r.Units
			if r.ChartUnits != nil {
				units = *r.ChartUnits
			}
			semUnits += units
			status := "FUTURE"
			switch {
			case passedIDs[r.CourseID]:
				status = "PASSED"
			case currentIDs[r.CourseID]:
				status = "IN_PROGRESS"
			case currentSemNo != nil && key > 0 && key < *currentSemNo:
				status = "MISSING_PAST"
			}
			rowsOut = append(rowsOut, ChartRow{
				ID: r.ID, CourseID: r.CourseID, Code: r.Code, Title: r.Title,
				Units: units, RoleType: r.RoleType, PrereqCodes: prereqMap[r.CourseID],
				Status: status,
			})
		}
		title := fmt.Sprintf("ترم %d", key)
		if key == 0 {
			title = "دروس بدون ترم پیشنهادی"
		} else if v, ok := semesterTitle[key]; ok {
			title = v
		}
		resp.Semesters = append(resp.Semesters, ChartSemester{
			Key: key, Title: title, Units: semUnits,
			IsCurrent:     currentSems[key],
			IsHighlighted: selectedTerm != nil && currentSems[key],
			Rows:          rowsOut,
		})
	}
	// Role order follows the fixed order.
	order := []string{"CORE", "MAJOR", "ELECTIVE", "GENERAL", "THESIS", "INTERNSHIP", "WORKSHOP"}
	for _, role := range order {
		if item, ok := roleTotals[role]; ok {
			resp.RoleSummary = append(resp.RoleSummary, *item)
		}
	}
	for role, item := range roleTotals {
		found := false
		for _, r := range order {
			if r == role {
				found = true
				break
			}
		}
		if !found {
			resp.RoleSummary = append(resp.RoleSummary, *item)
		}
	}
	_ = versionTitle
	return resp, nil
}

var _ = strings.TrimSpace
