// ═══ بانک دروس — GET/POST/PATCH پورت /api/admin/curriculum/bank ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/session"
)

// BankPage پاسخ صفحه‌بندی‌شدهٔ بانک دروس.
type BankPage struct {
	Courses []BankCourseRow `json:"courses"`
	Total   int             `json:"total"`
	Page    int             `json:"page"`
	Limit   int             `json:"limit"`
}

// BankCourses پورت GET /api/admin/curriculum/bank.
func (s *Service) BankCourses(ctx context.Context, user *session.User, cookie, q string, page, limit int) (*BankPage, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	uniID := s.UniversityID(ctx, user, cookie)
	conds := []string{}
	args := []any{}
	add := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if uniID != nil {
		p := add(*uniID)
		conds = append(conds, `(c."universityId" = `+p+` or c."universityId" is null)`)
	}
	if q = strings.TrimSpace(q); q != "" {
		p := add("%" + escapeLike(q) + "%")
		conds = append(conds, `(c.code ILIKE `+p+` ESCAPE '\' or c.title ILIKE `+p+` ESCAPE '\')`)
	}
	where := ""
	if len(conds) > 0 {
		where = " where " + strings.Join(conds, " and ")
	}
	var total int
	if err := s.DB.Pool.QueryRow(ctx, `select count(*)::int from courses c`+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	dataArgs := append(append([]any{}, args...), limit, (page-1)*limit)
	rows, err := s.DB.Pool.Query(ctx, `
		select c.id, c.code, c.title, c."theoreticalUnits"::text, c."practicalUnits"::text,
		       coalesce(c.units,0)::text, c."courseType", c."gradingType", c."affectsGpa",
		       c."departmentId", d.name, (to_jsonb(c)->>'degreeLevelId')::int, dl.title, c."clusterId", ec."clusterTitle",
		       c."offeringScope", c."locationType", c."courseNature", c."englishName", c.description,
		       c."weeklyTheoryHours"::text, c."weeklyPracticalHours"::text,
		       c."isThesis", c."hasProject", c."internshipUnits"::text,
		       c."minPassedMark"::text, c."defaultAcceptMarkState", c."defaultRejectMarkState",
		       c."courseIsActive", c."emergencyWithdrawal", c."coRequisites", c."facesHours"::text,
		       c."equivalentCourseCodes"
		  from courses c
		  left join departments d on d.id = c."departmentId"
		  left join degree_level_configs dl on dl.id = (to_jsonb(c)->>'degreeLevelId')::int
		  left join equivalence_clusters ec on ec.id = c."clusterId"`+where+`
		 order by c.code
		 limit $`+strconv.Itoa(len(args)+1)+` offset $`+strconv.Itoa(len(args)+2), dataArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BankCourseRow{}
	for rows.Next() {
		var r BankCourseRow
		if err := rows.Scan(&r.ID, &r.Code, &r.Title, &r.TheoreticalUnits, &r.PracticalUnits,
			&r.Units, &r.CourseType, &r.GradingType, &r.AffectsGPA,
			&r.DepartmentID, &r.DepartmentName, &r.DegreeLevelID, &r.DegreeLevelTitle,
			&r.ClusterID, &r.ClusterTitle,
			&r.OfferingScope, &r.LocationType, &r.CourseNature, &r.EnglishName, &r.Description,
			&r.WeeklyTheoryHours, &r.WeeklyPracticalHours,
			&r.IsThesis, &r.HasProject, &r.InternshipUnits,
			&r.MinPassedMark, &r.DefaultAcceptMarkState, &r.DefaultRejectMarkState,
			&r.CourseIsActive, &r.EmergencyWithdrawal, &r.CoRequisites, &r.FacesHours,
			&r.EquivalentCourseCodes); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return &BankPage{Courses: out, Total: total, Page: page, Limit: limit}, rows.Err()
}

func reqStr(raw map[string]any, key, label string) (string, error) {
	v, ok := raw[key]
	if !ok {
		return "", fmt.Errorf("%s الزامی است.", label)
	}
	sv, ok := strJSON(v)
	if !ok {
		return "", fmt.Errorf("%s نامعتبر است.", label)
	}
	return strings.TrimSpace(sv), nil
}

func optNum(raw map[string]any, key string) (*float64, bool, error) {
	v, ok := raw[key]
	if !ok || v == nil {
		return nil, false, nil
	}
	f, valid := numJSON(v)
	if !valid {
		return nil, true, fmt.Errorf("مقدار عددی «%s» نامعتبر است.", key)
	}
	return &f, true, nil
}

func optStr(raw map[string]any, key string) (*string, bool) {
	v, ok := raw[key]
	if !ok || v == nil {
		return nil, false
	}
	sv, ok2 := strJSON(v)
	if !ok2 {
		return nil, false
	}
	return nullableTrim(&sv), true
}

// strPresent رشتهٔ حاضرشده را برمی‌گرداند حتی اگر خالی باشد (برای پاک‌کردن با null).
func strPresent(raw map[string]any, key string) (string, bool) {
	v, ok := raw[key]
	if !ok || v == nil {
		return "", false
	}
	sv, ok2 := strJSON(v)
	if !ok2 {
		return "", false
	}
	return strings.TrimSpace(sv), true
}

func optID(raw map[string]any, key string) (*int64, bool, error) {
	v, ok := raw[key]
	if !ok {
		return nil, false, nil
	}
	if v == nil {
		return nil, true, nil
	}
	f, valid := numJSON(v)
	if !valid || f <= 0 {
		return nil, true, fmt.Errorf("شناسهٔ «%s» نامعتبر است.", key)
	}
	id := int64(f)
	return &id, true, nil
}

func checkNumRange(raw map[string]any, key string, min, max float64) error {
	if f, present, err := optNum(raw, key); err != nil {
		return err
	} else if present && (f == nil || *f < min || *f > max) {
		return fmt.Errorf("مقدار «%s» باید بین %s تا %s باشد.", key, trimNum(min), trimNum(max))
	}
	return nil
}

// CreateBankCourse پورت POST /api/admin/curriculum/bank.
func (s *Service) CreateBankCourse(ctx context.Context, user *session.User, cookie string, raw map[string]any) (int64, error) {
	if err := rejectUnknown(raw, bankFields); err != nil {
		return 0, err
	}
	code, err := reqStr(raw, "code", "کد درس")
	if err != nil {
		return 0, err
	}
	title, err := reqStr(raw, "title", "عنوان درس")
	if err != nil {
		return 0, err
	}
	if !maxRunes(code, 20) {
		return 0, errors.New("کد درس حداکثر ۲۰ کاراکتر است.")
	}
	if !maxRunes(title, 150) {
		return 0, errors.New("عنوان درس حداکثر ۱۵۰ کاراکتر است.")
	}
	for _, k := range []string{"theoreticalUnits", "practicalUnits", "weeklyTheoryHours", "weeklyPracticalHours", "internshipUnits", "minPassedMark", "facesHours"} {
		if err := checkNumRange(raw, k, 0, 20); err != nil {
			return 0, err
		}
	}
	theo, _, _ := optNum(raw, "theoreticalUnits")
	prac, _, _ := optNum(raw, "practicalUnits")
	theoV, pracV := 0.0, 0.0
	if theo != nil {
		theoV = *theo
	}
	if prac != nil {
		pracV = *prac
	}
	if theoV+pracV <= 0 {
		return 0, errors.New("مجموع واحد نظری و عملی باید بیشتر از صفر باشد.")
	}
	courseType := "تخصصی"
	if v, ok := optStr(raw, "courseType"); ok && v != nil {
		courseType = *v
	}
	if !validCourseType(courseType) {
		return 0, errors.New("نوع درس نامعتبر است.")
	}
	gradingType := "NUMERIC"
	if v, ok := optStr(raw, "gradingType"); ok && v != nil {
		gradingType = *v
	}
	if !validGradingType(gradingType) {
		return 0, errors.New("نوع نمره نامعتبر است.")
	}
	offeringScope := "DEPARTMENTAL"
	if v, ok := optStr(raw, "offeringScope"); ok && v != nil {
		offeringScope = *v
	}
	if !validOfferingScope(offeringScope) {
		return 0, errors.New("نحوهٔ ارائه نامعتبر است.")
	}
	locationType := "IN_CAMPUS"
	if v, ok := optStr(raw, "locationType"); ok && v != nil {
		locationType = *v
	}
	if !validLocationType(locationType) {
		return 0, errors.New("محل ارائه نامعتبر است.")
	}
	if err := validateLongTexts(raw); err != nil {
		return 0, err
	}
	affectsGpa := 1
	if v, ok := raw["affectsGpa"]; ok && v != nil {
		if b, valid := boolJSON(v); valid && !b {
			affectsGpa = 0
		}
	}
	departmentID, _, err := optID(raw, "departmentId")
	if err != nil {
		return 0, err
	}
	degreeLevelID, _, err := optID(raw, "degreeLevelId")
	if err != nil {
		return 0, err
	}
	clusterID, _, err := optID(raw, "clusterId")
	if err != nil {
		return 0, err
	}
	uniID := s.UniversityID(ctx, user, cookie)

	if uniID != nil {
		var one int
		err := s.DB.Pool.QueryRow(ctx, `select 1 from courses where code = $1 and ("universityId" = $2 or "universityId" is null) limit 1`,
			code, *uniID).Scan(&one)
		if err == nil {
			return 0, fmt.Errorf("کد درس تکراری است: %s", code)
		}
	} else {
		var one int
		if err := s.DB.Pool.QueryRow(ctx, `select 1 from courses where code = $1 limit 1`, code).Scan(&one); err == nil {
			return 0, fmt.Errorf("کد درس تکراری است: %s", code)
		}
	}

	nature, _ := optStr(raw, "courseNature")
	englishName, _ := optStr(raw, "englishName")
	description, _ := optStr(raw, "description")
	coReq, _ := optStr(raw, "coRequisites")
	equiv, _ := optStr(raw, "equivalentCourseCodes")
	accept, _ := optStr(raw, "defaultAcceptMarkState")
	reject, _ := optStr(raw, "defaultRejectMarkState")
	weekTheo, _, _ := optNum(raw, "weeklyTheoryHours")
	weekPrac, _, _ := optNum(raw, "weeklyPracticalHours")
	internship, _, _ := optNum(raw, "internshipUnits")
	minMark, _, _ := optNum(raw, "minPassedMark")
	faces, _, _ := optNum(raw, "facesHours")

	var weekTheoStr, weekPracStr, minMarkStr, facesStr *string
	if weekTheo != nil && *weekTheo > 0 {
		v := trimNum(*weekTheo)
		weekTheoStr = &v
	}
	if weekPrac != nil && *weekPrac > 0 {
		v := trimNum(*weekPrac)
		weekPracStr = &v
	}
	if minMark != nil && *minMark > 0 {
		v := trimNum(*minMark)
		minMarkStr = &v
	}
	if faces != nil && *faces > 0 {
		v := trimNum(*faces)
		facesStr = &v
	}
	internshipStr := "0"
	if internship != nil {
		internshipStr = trimNum(*internship)
	}
	isThesis, hasProject, emergency := 0, 0, 0
	if v, ok := raw["isThesis"]; ok && v != nil {
		if b, valid := boolJSON(v); valid && b {
			isThesis = 1
		}
	}
	if v, ok := raw["hasProject"]; ok && v != nil {
		if b, valid := boolJSON(v); valid && b {
			hasProject = 1
		}
	}
	if v, ok := raw["emergencyWithdrawal"]; ok && v != nil {
		if b, valid := boolJSON(v); valid && b {
			emergency = 1
		}
	}
	active := 1
	if v, ok := raw["courseIsActive"]; ok && v != nil {
		if b, valid := boolJSON(v); valid && !b {
			active = 0
		}
	}

	hasDegree := s.courseHasDegreeLevel(ctx)
	if degreeLevelID != nil && !hasDegree {
		return 0, errors.New("ستون مقطع درس در این نصب وجود ندارد؛ ابتدا اسکیمای دیتابیس را به‌روزرسانی کنید.")
	}
	cols := []string{"code", "title", `"universityId"`, `"theoreticalUnits"`, `"practicalUnits"`, "units",
		`"courseType"`, `"gradingType"`, `"affectsGpa"`, `"departmentId"`}
	vals := []any{code, title, uniID, trimNum(theoV), trimNum(pracV), trimNum(theoV + pracV),
		courseType, gradingType, affectsGpa, departmentID}
	if hasDegree {
		cols = append(cols, `"degreeLevelId"`)
		vals = append(vals, degreeLevelID)
	}
	cols = append(cols, `"clusterId"`, `"offeringScope"`, `"locationType"`, `"courseNature"`, `"englishName"`,
		"description", `"weeklyTheoryHours"`, `"weeklyPracticalHours"`, `"isThesis"`, `"hasProject"`,
		`"internshipUnits"`, `"minPassedMark"`, `"defaultAcceptMarkState"`, `"defaultRejectMarkState"`,
		`"courseIsActive"`, `"emergencyWithdrawal"`, `"coRequisites"`, `"facesHours"`, `"equivalentCourseCodes"`)
	vals = append(vals, clusterID, offeringScope, locationType, nature, englishName,
		description, weekTheoStr, weekPracStr, isThesis, hasProject,
		internshipStr, minMarkStr, accept, reject,
		active, emergency, coReq, facesStr, equiv)
	placeholders := make([]string, len(vals))
	for i := range vals {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
	}
	var id int64
	err = s.DB.Pool.QueryRow(ctx, `insert into courses (`+strings.Join(cols, ", ")+`) values (`+strings.Join(placeholders, ",")+`) returning id`, vals...).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "uq_courses_uni_code") || strings.Contains(err.Error(), "duplicate key") {
			return 0, fmt.Errorf("کد درس تکراری است: %s", code)
		}
		return 0, err
	}
	return id, nil
}

func validateLongTexts(raw map[string]any) error {
	if v, ok := optStr(raw, "courseNature"); ok && v != nil && !maxRunes(*v, 50) {
		return errors.New("ماهیت درس حداکثر ۵۰ کاراکتر است.")
	}
	if v, ok := optStr(raw, "englishName"); ok && v != nil && !maxRunes(*v, 200) {
		return errors.New("نام انگلیسی حداکثر ۲۰۰ کاراکتر است.")
	}
	if v, ok := optStr(raw, "description"); ok && v != nil && !maxRunes(*v, 2000) {
		return errors.New("توضیحات حداکثر ۲۰۰۰ کاراکتر است.")
	}
	if v, ok := optStr(raw, "coRequisites"); ok && v != nil && !maxRunes(*v, 200) {
		return errors.New("هم‌نیاز حداکثر ۲۰۰ کاراکتر است.")
	}
	if v, ok := optStr(raw, "defaultAcceptMarkState"); ok && v != nil && !maxRunes(*v, 10) {
		return errors.New("کد قبولی حداکثر ۱۰ کاراکتر است.")
	}
	if v, ok := optStr(raw, "defaultRejectMarkState"); ok && v != nil && !maxRunes(*v, 10) {
		return errors.New("کد مردودی حداکثر ۱۰ کاراکتر است.")
	}
	if v, ok := optStr(raw, "equivalentCourseCodes"); ok && v != nil && !maxRunes(*v, 500) {
		return errors.New("دروس هم‌ارز حداکثر ۵۰۰ کاراکتر است.")
	}
	return nil
}

// courseHasDegreeLevel وجود ستون مقطع در بانک دروس را تشخیص می‌دهد؛ برخی نصب‌های
// قدیمی این ستون را ندارند و نوشتن مستقیم باعث خطای ۴۲۷۰۳ می‌شود.
func (s *Service) courseHasDegreeLevel(ctx context.Context) bool {
	var ok bool
	_ = s.DB.Pool.QueryRow(ctx, `select exists(select 1 from information_schema.columns
		where table_schema = 'public' and table_name = 'courses' and column_name = 'degreeLevelId')`).Scan(&ok)
	return ok
}

// UpdateBankCourse پورت PATCH /api/admin/curriculum/bank.
func (s *Service) UpdateBankCourse(ctx context.Context, user *session.User, cookie string, id int64, raw map[string]any) error {
	if id <= 0 {
		return errors.New("شناسه درس نامعتبر.")
	}
	if err := rejectUnknown(raw, bankFields); err != nil {
		return err
	}
	uniID := s.UniversityID(ctx, user, cookie)
	var targetUni *int64
	err := s.DB.Pool.QueryRow(ctx, `select "universityId" from courses where id = $1`, id).Scan(&targetUni)
	if err == pgx.ErrNoRows {
		return errors.New("درس یافت نشد.")
	}
	if err != nil {
		return err
	}
	if uniID != nil && targetUni != nil && *targetUni != *uniID {
		return errors.New("این درس متعلق به دانشگاه دیگری است.")
	}

	sets := []string{}
	args := []any{}
	add := func(expr string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf(expr, len(args)))
	}
	if v, ok := optStr(raw, "title"); ok && v != nil {
		if *v == "" || !maxRunes(*v, 150) {
			return errors.New("عنوان درس باید ۱ تا ۱۵۰ کاراکتر باشد.")
		}
		add(`title = $%d`, *v)
	}
	if v, ok := optStr(raw, "code"); ok && v != nil {
		if *v == "" || !maxRunes(*v, 20) {
			return errors.New("کد درس باید ۱ تا ۲۰ کاراکتر باشد.")
		}
		add(`code = $%d`, *v)
	}
	theoChanged, pracChanged := false, false
	if f, present, err := optNum(raw, "theoreticalUnits"); err != nil {
		return err
	} else if present && f != nil {
		if *f < 0 || *f > 20 {
			return errors.New("واحد نظری باید بین ۰ تا ۲۰ باشد.")
		}
		add(`"theoreticalUnits" = $%d`, trimNum(*f))
		theoChanged = true
	}
	if f, present, err := optNum(raw, "practicalUnits"); err != nil {
		return err
	} else if present && f != nil {
		if *f < 0 || *f > 20 {
			return errors.New("واحد عملی باید بین ۰ تا ۲۰ باشد.")
		}
		add(`"practicalUnits" = $%d`, trimNum(*f))
		pracChanged = true
	}
	for _, k := range []string{"weeklyTheoryHours", "weeklyPracticalHours", "internshipUnits", "minPassedMark", "facesHours"} {
		if f, present, err := optNum(raw, k); err != nil {
			return err
		} else if present && f != nil {
			if *f < 0 || *f > 20 {
				return fmt.Errorf("مقدار «%s» باید بین ۰ تا ۲۰ باشد.", k)
			}
			add(`"`+k+`" = $%d`, trimNum(*f))
		}
	}
	if v, ok := optStr(raw, "courseType"); ok && v != nil {
		if !validCourseType(*v) {
			return errors.New("نوع درس نامعتبر است.")
		}
		add(`"courseType" = $%d`, *v)
	}
	if v, ok := optStr(raw, "gradingType"); ok && v != nil {
		if !validGradingType(*v) {
			return errors.New("نوع نمره نامعتبر است.")
		}
		add(`"gradingType" = $%d`, *v)
	}
	if v, ok := optStr(raw, "offeringScope"); ok && v != nil {
		if !validOfferingScope(*v) {
			return errors.New("نحوهٔ ارائه نامعتبر است.")
		}
		add(`"offeringScope" = $%d`, *v)
	}
	if v, ok := optStr(raw, "locationType"); ok && v != nil {
		if !validLocationType(*v) {
			return errors.New("محل ارائه نامعتبر است.")
		}
		add(`"locationType" = $%d`, *v)
	}
	if v, ok := raw["affectsGpa"]; ok && v != nil {
		if b, valid := boolJSON(v); valid {
			add(`"affectsGpa" = $%d`, boolInt(b))
		}
	}
	for _, k := range []string{"isThesis", "hasProject", "courseIsActive", "emergencyWithdrawal"} {
		if v, ok := raw[k]; ok && v != nil {
			if b, valid := boolJSON(v); valid {
				add(`"`+k+`" = $%d`, boolInt(b))
			}
		}
	}
	for _, k := range []string{"departmentId", "clusterId"} {
		if v, present, err := optID(raw, k); err != nil {
			return err
		} else if present {
			add(`"`+k+`" = $%d`, v)
		}
	}
	if v, present, err := optID(raw, "degreeLevelId"); err != nil {
		return err
	} else if present {
		if !s.courseHasDegreeLevel(ctx) {
			if v != nil {
				return errors.New("ستون مقطع درس در این نصب وجود ندارد؛ ابتدا اسکیمای دیتابیس را به‌روزرسانی کنید.")
			}
		} else {
			add(`"degreeLevelId" = $%d`, v)
		}
	}
	for _, k := range []string{"courseNature", "englishName", "description", "defaultAcceptMarkState", "defaultRejectMarkState", "coRequisites", "equivalentCourseCodes"} {
		if v, ok := strPresent(raw, k); ok {
			var arg any
			if v != "" {
				arg = v
			}
			add(`"`+k+`" = $%d`, arg)
		}
	}
	if err := validateLongTexts(raw); err != nil {
		return err
	}
	if len(sets) == 0 {
		return errors.New("فیلدی برای ویرایش ارسال نشد.")
	}
	if theoChanged || pracChanged {
		var curTheo, curPrac *float64
		_ = s.DB.Pool.QueryRow(ctx, `select "theoreticalUnits"::float8, "practicalUnits"::float8 from courses where id = $1`, id).
			Scan(&curTheo, &curPrac)
		theoV, pracV := 0.0, 0.0
		if curTheo != nil {
			theoV = *curTheo
		}
		if curPrac != nil {
			pracV = *curPrac
		}
		if f, present, _ := optNum(raw, "theoreticalUnits"); present && f != nil {
			theoV = *f
		}
		if f, present, _ := optNum(raw, "practicalUnits"); present && f != nil {
			pracV = *f
		}
		add(`units = $%d`, trimNum(theoV+pracV))
	}
	args = append(args, id)
	query := `update courses set ` + strings.Join(sets, ", ") + ` where id = $` + strconv.Itoa(len(args))
	if _, err := s.DB.Pool.Exec(ctx, query, args...); err != nil {
		if strings.Contains(err.Error(), "uq_courses_uni_code") || strings.Contains(err.Error(), "duplicate key") {
			return errors.New("کد درس تکراری است.")
		}
		return err
	}
	return nil
}
