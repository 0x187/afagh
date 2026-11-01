// ═══ Course management and grade status codes — port of admin/grade-status-codes and curriculum APIs ═══
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"backend-go/internal/gradestatus"
	"backend-go/internal/session"
)

// ── Response types ──

type GradeMajorRow struct {
	ID   int64  `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

// SimpleOption: simple id/name option.
type SimpleOption struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}
type GradeVersionRow struct {
	ID            int64  `json:"id"`
	VersionCode   string `json:"versionCode"`
	Title         string `json:"title"`
	Status        string `json:"status"`
	MajorID       int64  `json:"majorId"`
	EntryYearFrom *int   `json:"entryYearFrom"`
	EntryYearTo   *int   `json:"entryYearTo"`
}
type GradeCurriculumCourseRow struct {
	CourseID            int64   `json:"courseId"`
	Code                string  `json:"code"`
	Title               string  `json:"title"`
	Units               *string `json:"units"`
	PassGradeStatusCode *string `json:"passGradeStatusCode"`
	FailGradeStatusCode *string `json:"failGradeStatusCode"`
	RoleType            string  `json:"roleType"`
	RecommendedSemester *int    `json:"recommendedSemester"`
}
type GradeThresholdRow struct {
	ID        int64  `json:"id"`
	Label     string `json:"label"`
	MinValue  string `json:"minValue"`
	MaxValue  string `json:"maxValue"`
	Passed    int    `json:"passed"`
	SortOrder int    `json:"sortOrder"`
}
type OfferedCourseRow struct {
	ID                  int64   `json:"id"`
	CourseID            int64   `json:"courseId"`
	CourseCode          string  `json:"courseCode"`
	CourseTitle         string  `json:"courseTitle"`
	Units               *string `json:"units"`
	RoleType            string  `json:"roleType"`
	RecommendedSemester *int    `json:"recommendedSemester"`
	MinGrade            *string `json:"minGrade"`
	PassGradeStatusCode *string `json:"passGradeStatusCode"`
	FailGradeStatusCode *string `json:"failGradeStatusCode"`
	IsRequired          *int    `json:"isRequired"`
	IsElective          *int    `json:"isElective"`
	VersionID           int64   `json:"versionId"`
	VersionCode         string  `json:"versionCode"`
	VersionTitle        string  `json:"versionTitle"`
	Status              string  `json:"status"`
	MajorID             int64   `json:"majorId"`
	MajorName           string  `json:"majorName"`
	DegreeLevelID       *int64  `json:"degreeLevelId"`
	DegreeLevelTitle    *string `json:"degreeLevelTitle"`
	EntryYearFrom       *int    `json:"entryYearFrom"`
	EntryYearTo         *int    `json:"entryYearTo"`
}
type BankCourseRow struct {
	ID                     int64   `json:"id"`
	Code                   string  `json:"code"`
	Title                  string  `json:"title"`
	TheoreticalUnits       *string `json:"theoreticalUnits"`
	PracticalUnits         *string `json:"practicalUnits"`
	Units                  string  `json:"units"`
	CourseType             *string `json:"courseType"`
	GradingType            *string `json:"gradingType"`
	AffectsGPA             *int    `json:"affectsGpa"`
	DepartmentID           *int64  `json:"departmentId"`
	DepartmentName         *string `json:"departmentName"`
	DegreeLevelID          *int64  `json:"degreeLevelId"`
	DegreeLevelTitle       *string `json:"degreeLevelTitle"`
	ClusterID              *int64  `json:"clusterId"`
	ClusterTitle           *string `json:"clusterTitle"`
	OfferingScope          *string `json:"offeringScope"`
	LocationType           *string `json:"locationType"`
	CourseNature           *string `json:"courseNature"`
	EnglishName            *string `json:"englishName"`
	Description            *string `json:"description"`
	WeeklyTheoryHours      *string `json:"weeklyTheoryHours"`
	WeeklyPracticalHours   *string `json:"weeklyPracticalHours"`
	IsThesis               *int    `json:"isThesis"`
	HasProject             *int    `json:"hasProject"`
	InternshipUnits        *string `json:"internshipUnits"`
	MinPassedMark          *string `json:"minPassedMark"`
	DefaultAcceptMarkState *string `json:"defaultAcceptMarkState"`
	DefaultRejectMarkState *string `json:"defaultRejectMarkState"`
	CourseIsActive         *int    `json:"courseIsActive"`
	EmergencyWithdrawal    *int    `json:"emergencyWithdrawal"`
	CoRequisites           *string `json:"coRequisites"`
	FacesHours             *string `json:"facesHours"`
	EquivalentCourseCodes  *string `json:"equivalentCourseCodes"`
}

// GradeStatusCodeItem: a reference table row for UI.
type GradeStatusCodeItem struct {
	Code           string `json:"code"`
	Title          string `json:"title"`
	Passed         bool   `json:"passed"`
	AffectsGpa     bool   `json:"affectsGpa"`
	AffectsTermGpa bool   `json:"affectsTermGpa"`
	IsDropped      bool   `json:"isDropped"`
}

// ── Helpers ──

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	return strings.ReplaceAll(s, `_`, `\_`)
}
func numJSON(v any) (float64, bool) {
	switch t := v.(type) {
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case float64:
		return t, true
	case int:
		return float64(t), true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(t), 64)
		return f, err == nil
	}
	return 0, false
}

func boolJSON(v any) (bool, bool) {
	switch t := v.(type) {
	case bool:
		return t, true
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return false, false
		}
		return f != 0, true
	case float64:
		return t != 0, true
	case string:
		switch strings.ToLower(strings.TrimSpace(t)) {
		case "1", "true", "on":
			return true, true
		case "0", "false", "off", "":
			return false, true
		}
	}
	return false, false
}

func strJSON(v any) (string, bool) {
	sv, ok := v.(string)
	return sv, ok
}

func rejectUnknown(raw map[string]any, allowed []string) error {
	set := map[string]bool{}
	for _, k := range allowed {
		set[k] = true
	}
	for k := range raw {
		if !set[k] {
			return errors.New("داده ورودی معتبر نیست.")
		}
	}
	return nil
}

var bankFields = []string{
	"code", "title", "theoreticalUnits", "practicalUnits", "courseType", "gradingType",
	"affectsGpa", "departmentId", "degreeLevelId", "clusterId", "offeringScope", "locationType",
	"courseNature", "englishName", "description", "weeklyTheoryHours", "weeklyPracticalHours",
	"isThesis", "hasProject", "internshipUnits", "minPassedMark", "defaultAcceptMarkState",
	"defaultRejectMarkState", "courseIsActive", "emergencyWithdrawal", "coRequisites",
	"facesHours", "equivalentCourseCodes",
}

func validCourseType(v string) bool {
	switch v {
	case "پایه", "اصلی", "تخصصی", "عمومی", "عملی", "نظری", "کارگاهی", "اختیاری":
		return true
	}
	return false
}

func validGradingType(v string) bool { return v == "NUMERIC" || v == "PASS_FAIL" }
func validOfferingScope(v string) bool {
	return v == "DEPARTMENTAL" || v == "GENERAL_SERVICE" || v == "UNIVERSITY_WIDE"
}
func validLocationType(v string) bool {
	return v == "IN_CAMPUS" || v == "OUT_CAMPUS" || v == "ONLINE" || v == "HYBRID"
}

func maxRunes(s string, n int) bool { return len([]rune(s)) <= n }

// ── Metadata ──

// GradeMajors port of /api/admin/curriculum/majors.
func (s *Service) GradeMajors(ctx context.Context, user *session.User, cookie string) ([]GradeMajorRow, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	where := ""
	args := []any{}
	if uniID != nil {
		where = ` and (m."universityId" = $1 or m."universityId" is null)`
		args = append(args, *uniID)
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select m.id, m."majorCode", m.name from majors m
		 where m."isActive" = 1`+where+` order by m."majorCode"`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GradeMajorRow{}
	for rows.Next() {
		var r GradeMajorRow
		if err := rows.Scan(&r.ID, &r.Code, &r.Name); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GradeDepartments port of /api/admin/curriculum/departments.
func (s *Service) GradeDepartments(ctx context.Context, user *session.User, cookie string) ([]SimpleOption, error) {
	return s.namedScoped(ctx, user, cookie, "departments", "name", "name")
}

// GradeClusters port of /api/admin/curriculum/clusters.
func (s *Service) GradeClusters(ctx context.Context, user *session.User, cookie string) ([]SimpleOption, error) {
	return s.namedScoped(ctx, user, cookie, "equivalence_clusters", `"clusterTitle"`, `"clusterTitle"`)
}

func (s *Service) namedScoped(ctx context.Context, user *session.User, cookie, table, sel, order string) ([]SimpleOption, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	where := ""
	args := []any{}
	if uniID != nil {
		where = ` where ("universityId" = $1 or "universityId" is null)`
		args = append(args, *uniID)
	}
	rows, err := s.DB.Pool.Query(ctx, `select id, `+sel+` from `+table+where+` order by `+order, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SimpleOption{}
	for rows.Next() {
		var r SimpleOption
		if err := rows.Scan(&r.ID, &r.Name); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GradeDegreeLevels: all degree levels (no university restriction — same API behavior).
func (s *Service) GradeDegreeLevels(ctx context.Context) ([]SimpleOption, error) {
	rows, err := s.DB.Pool.Query(ctx, `select id, title from degree_level_configs order by title`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SimpleOption{}
	for rows.Next() {
		var r SimpleOption
		if err := rows.Scan(&r.ID, &r.Name); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GradeVersions port of /api/admin/curriculum/versions.
func (s *Service) GradeVersions(ctx context.Context, user *session.User, cookie string, majorID int64) ([]GradeVersionRow, error) {
	if majorID <= 0 {
		return []GradeVersionRow{}, nil
	}
	uniID := s.UniversityID(ctx, user, cookie)
	where := ` where "majorId" = $1`
	args := []any{majorID}
	if uniID != nil {
		where += ` and ("universityId" = $2 or "universityId" is null)`
		args = append(args, *uniID)
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "versionCode", title, status, "majorId", "entryYearFrom", "entryYearTo"
		  from curriculum_versions`+where+` order by "entryYearFrom" desc`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GradeVersionRow{}
	for rows.Next() {
		var r GradeVersionRow
		if err := rows.Scan(&r.ID, &r.VersionCode, &r.Title, &r.Status, &r.MajorID, &r.EntryYearFrom, &r.EntryYearTo); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GradeCurriculumCourses port of /api/admin/curriculum/courses with university guard.
func (s *Service) GradeCurriculumCourses(ctx context.Context, user *session.User, cookie string, versionID int64) ([]GradeCurriculumCourseRow, error) {
	out := []GradeCurriculumCourseRow{}
	if versionID <= 0 {
		return out, nil
	}
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID != nil {
		var verUni *int64
		err := s.DB.Pool.QueryRow(ctx, `select "universityId" from curriculum_versions where id = $1`, versionID).Scan(&verUni)
		if err != nil {
			return out, nil
		}
		if verUni != nil && *verUni != *uniID {
			return out, nil
		}
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select cc."courseId", c.code, c.title, cc.units::text,
		       cc."passGradeStatusCode", cc."failGradeStatusCode",
		       coalesce(cc."roleType",''), cc."recommendedSemester"
		  from curriculum_courses cc join courses c on c.id = cc."courseId"
		 where cc."curriculumVersionId" = $1
		 order by c.code limit 5000`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r GradeCurriculumCourseRow
		if err := rows.Scan(&r.CourseID, &r.Code, &r.Title, &r.Units,
			&r.PassGradeStatusCode, &r.FailGradeStatusCode, &r.RoleType, &r.RecommendedSemester); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GradeOffered port of /api/admin/curriculum/offered.
func (s *Service) GradeOffered(ctx context.Context, user *session.User, cookie, q string, majorID, degreeLevelID, versionID int64) ([]OfferedCourseRow, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	conds := []string{}
	args := []any{}
	add := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if majorID > 0 {
		conds = append(conds, `cv."majorId" = `+add(majorID))
	}
	if degreeLevelID > 0 {
		conds = append(conds, `cv."degreeLevelId" = `+add(degreeLevelID))
	}
	if versionID > 0 {
		conds = append(conds, `cc."curriculumVersionId" = `+add(versionID))
	}
	if uniID != nil {
		p := add(*uniID)
		conds = append(conds, `(cv."universityId" = `+p+` or cv."universityId" is null)`)
		conds = append(conds, `(m."universityId" = `+p+` or m."universityId" is null)`)
	}
	if q = strings.TrimSpace(q); q != "" {
		p := add("%" + escapeLike(q) + "%")
		conds = append(conds, `(c.code ILIKE `+p+` ESCAPE '\' or c.title ILIKE `+p+` ESCAPE '\' or m.name ILIKE `+p+` ESCAPE '\')`)
	}
	where := ""
	if len(conds) > 0 {
		where = " where " + strings.Join(conds, " and ")
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select cc.id, cc."courseId", c.code, c.title, cc.units::text,
		       coalesce(cc."roleType",''), cc."recommendedSemester", cc."minGrade"::text,
		       cc."passGradeStatusCode", cc."failGradeStatusCode",
		       cc."isRequired", cc."isElective",
		       cv.id, cv."versionCode", cv.title, cv.status,
		       m.id, m.name, d.id, d.title,
		       cv."entryYearFrom", cv."entryYearTo"
		  from curriculum_courses cc
		  join curriculum_versions cv on cv.id = cc."curriculumVersionId"
		  join courses c on c.id = cc."courseId"
		  join majors m on m.id = cv."majorId"
		  left join degree_level_configs d on d.id = cv."degreeLevelId"`+where+`
		 order by m.name, cv."versionCode", cc."recommendedSemester", c.code
		 limit 500`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OfferedCourseRow{}
	for rows.Next() {
		var r OfferedCourseRow
		if err := rows.Scan(&r.ID, &r.CourseID, &r.CourseCode, &r.CourseTitle, &r.Units,
			&r.RoleType, &r.RecommendedSemester, &r.MinGrade,
			&r.PassGradeStatusCode, &r.FailGradeStatusCode,
			&r.IsRequired, &r.IsElective,
			&r.VersionID, &r.VersionCode, &r.VersionTitle, &r.Status,
			&r.MajorID, &r.MajorName, &r.DegreeLevelID, &r.DegreeLevelTitle,
			&r.EntryYearFrom, &r.EntryYearTo); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SetCurriculumGradeCodes port of PATCH /api/admin/curriculum/grade-codes.
func (s *Service) SetCurriculumGradeCodes(ctx context.Context, user *session.User, cookie string, versionID, courseID int64, passCode, failCode *string) error {
	if versionID <= 0 || courseID <= 0 {
		return errors.New("شناسه نسخه یا درس نامعتبر است.")
	}
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID != nil {
		var verUni *int64
		if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from curriculum_versions where id = $1`, versionID).Scan(&verUni); err != nil {
			return errors.New("نسخه یافت نشد.")
		}
		if verUni != nil && *verUni != *uniID {
			return errors.New("این نسخه متعلق به دانشگاه دیگری است.")
		}
	}
	tag, err := s.DB.Pool.Exec(ctx, `
		update curriculum_courses set "passGradeStatusCode" = $3, "failGradeStatusCode" = $4
		 where "curriculumVersionId" = $1 and "courseId" = $2`,
		versionID, courseID, nullableTrim(passCode), nullableTrim(failCode))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("ردیف چارت برای این درس یافت نشد.")
	}
	return nil
}

// GradeStatusCodes: reference table list for UI dropdowns.
func GradeStatusCodes() []GradeStatusCodeItem {
	out := make([]GradeStatusCodeItem, 0, len(gradestatus.Codes))
	for _, c := range gradestatus.Codes {
		out = append(out, GradeStatusCodeItem{
			Code: c.Code, Title: c.Title, Passed: c.Passed,
			AffectsGpa: c.AffectsGpa, AffectsTermGpa: c.AffectsTermGpa, IsDropped: c.IsDropped,
		})
	}
	return out
}

// GetGradeThresholds port of GET /api/admin/grade-thresholds.
func (s *Service) GetGradeThresholds(ctx context.Context, user *session.User, cookie string, degreeLevelID int64) ([]GradeThresholdRow, string, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	where := ""
	args := []any{}
	if degreeLevelID > 0 {
		where = ` where "degreeLevelId" = $1`
		args = append(args, degreeLevelID)
	}
	if uniID != nil {
		p := "$1"
		if degreeLevelID > 0 {
			p = "$2"
			args = append(args, *uniID)
			where += ` and ("universityId" = ` + p + ` or "universityId" is null)`
		} else {
			args = append(args, *uniID)
			where = ` where ("universityId" = $1 or "universityId" is null)`
		}
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, label, "minValue"::text, "maxValue"::text, passed, "sortOrder"
		  from grade_thresholds`+where+` order by "degreeLevelId", "sortOrder"`, args...)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	out := []GradeThresholdRow{}
	for rows.Next() {
		var r GradeThresholdRow
		if err := rows.Scan(&r.ID, &r.Label, &r.MinValue, &r.MaxValue, &r.Passed, &r.SortOrder); err != nil {
			return nil, "", err
		}
		out = append(out, r)
	}
	mode := "NUMERIC"
	if degreeLevelID > 0 {
		var m *string
		_ = s.DB.Pool.QueryRow(ctx, `select "transcriptDisplayMode" from degree_level_configs where id = $1`, degreeLevelID).Scan(&m)
		if m != nil && *m != "" {
			mode = *m
		}
	}
	return out, mode, rows.Err()
}

type ThresholdInput struct {
	Label    string  `json:"label"`
	MinValue float64 `json:"minValue"`
	MaxValue float64 `json:"maxValue"`
	Passed   bool    `json:"passed"`
}

// SaveGradeThresholds port of POST /api/admin/grade-thresholds.
func (s *Service) SaveGradeThresholds(ctx context.Context, user *session.User, cookie string, degreeLevelID int64, displayMode string, thresholds []ThresholdInput) error {
	if degreeLevelID <= 0 {
		return errors.New("مقطع تحصیلی الزامی است.")
	}
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	var degUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from degree_level_configs where id = $1`, degreeLevelID).Scan(&degUni); err != nil {
		return errors.New("مقطع یافت نشد.")
	}
	if degUni != nil && *degUni != *uniID {
		return errors.New("مقطع متعلق به دانشگاه دیگری است.")
	}
	switch displayMode {
	case "", "NUMERIC", "QUALITATIVE", "BOTH", "LETTER", "GPA":
	default:
		return errors.New("حالت نمایش کارنامه نامعتبر است.")
	}
	if len(thresholds) > 50 {
		return errors.New("تعداد آستانه‌ها بیش از حد مجاز است.")
	}
	for _, t := range thresholds {
		label := strings.TrimSpace(t.Label)
		if label == "" || !maxRunes(label, 50) {
			return errors.New("برچسب آستانه باید ۱ تا ۵۰ کاراکتر باشد.")
		}
		if t.MinValue < 0 || t.MinValue > 20 || t.MaxValue < 0 || t.MaxValue > 20 {
			return errors.New("مقدار آستانه باید بین ۰ تا ۲۰ باشد.")
		}
		if t.MinValue > t.MaxValue {
			return errors.New("حداقل نمره باید ≤ حداکثر نمره باشد.")
		}
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if displayMode != "" {
		if _, err := tx.Exec(ctx, `
			update degree_level_configs set "transcriptDisplayMode" = $2
			 where id = $1 and ("universityId" = $3 or "universityId" is null)`,
			degreeLevelID, displayMode, *uniID); err != nil {
			return err
		}
	}
	if thresholds != nil {
		if _, err := tx.Exec(ctx, `
			delete from grade_thresholds where "degreeLevelId" = $1
			   and ("universityId" = $2 or "universityId" is null)`, degreeLevelID, *uniID); err != nil {
			return err
		}
		for i, t := range thresholds {
			if _, err := tx.Exec(ctx, `
				insert into grade_thresholds ("universityId","degreeLevelId",label,"minValue","maxValue",passed,"sortOrder")
				values ($1,$2,$3,$4,$5,$6,$7)`,
				*uniID, degreeLevelID, strings.TrimSpace(t.Label),
				strconv.FormatFloat(t.MinValue, 'f', -1, 64), strconv.FormatFloat(t.MaxValue, 'f', -1, 64),
				boolInt(t.Passed), i+1); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}
