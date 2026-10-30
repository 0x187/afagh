// ═══ سرفصل/برنامهٔ درسی — پورت admin/curriculum (نسخه‌ها، دروس، قواعد، چرخهٔ حیات، اعتبارسنج) ═══
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"backend-go/internal/enroll"
	"backend-go/internal/session"
)

// ── ماشین حالت (پورت curriculum-types) ──

var curriculumTransitions = map[string][]string{
	"DRAFT":     {"REVIEW"},
	"REVIEW":    {"APPROVED", "DRAFT"},
	"APPROVED":  {"PUBLISHED"},
	"PUBLISHED": {"ARCHIVED"},
	"ARCHIVED":  {},
}

func curriculumCanTransition(from, to string) bool {
	for _, t := range curriculumTransitions[from] {
		if t == to {
			return true
		}
	}
	return false
}

func curriculumAssertTransition(from, to, action string) error {
	if !curriculumCanTransition(from, to) {
		allowed := strings.Join(curriculumTransitions[from], "، ")
		if allowed == "" {
			allowed = "—"
		}
		return fmt.Errorf("گذار غیرمجاز برنامهٔ درسی: «%s» از وضعیت %s به %s ممکن نیست. گذارهای مجاز: %s", action, from, to, allowed)
	}
	return nil
}

// normalizeLogicNode پورت normalizeLogicNode.
type CurriculumLogicCond struct {
	Course      string                `json:"course,omitempty"`
	MinGrade    *float64              `json:"minGrade,omitempty"`
	UnitsPassed *float64              `json:"unitsPassed,omitempty"`
	Operator    string                `json:"operator,omitempty"`
	Conditions  []CurriculumLogicCond `json:"conditions,omitempty"`
}

func NormalizeLogicNode(raw map[string]any) (CurriculumLogicCond, error) {
	node := CurriculumLogicCond{Operator: "AND"}
	if raw == nil {
		return node, nil
	}
	op := strings.ToUpper(fmt.Sprint(raw["operator"]))
	if op == "" || op == "<NIL>" {
		op = "AND"
	}
	if op != "AND" && op != "OR" {
		return node, fmt.Errorf("عملگر نامعتبر در درخت قاعده: «%s» (فقط AND/OR مجاز است)", op)
	}
	node.Operator = op
	arr, _ := raw["conditions"].([]any)
	for _, item := range arr {
		c, ok := item.(map[string]any)
		if !ok {
			return node, errors.New("هر شرط داخل درخت قاعده باید یک شیء باشد")
		}
		if _, hasOp := c["operator"]; hasOp {
			sub, err := NormalizeLogicNode(c)
			if err != nil {
				return node, err
			}
			node.Conditions = append(node.Conditions, sub)
			continue
		}
		cond := CurriculumLogicCond{}
		if v, ok := c["course"]; ok && v != nil {
			cond.Course = strings.TrimSpace(fmt.Sprint(v))
		}
		if v, ok := c["minGrade"]; ok && v != nil {
			if f, err := strconv.ParseFloat(fmt.Sprint(v), 64); err == nil {
				cond.MinGrade = &f
			}
		}
		if v, ok := c["unitsPassed"]; ok && v != nil {
			if f, err := strconv.ParseFloat(fmt.Sprint(v), 64); err == nil {
				cond.UnitsPassed = &f
			}
		}
		if cond.Course == "" && cond.UnitsPassed == nil {
			return node, errors.New("شرط قاعده باید شامل course یا unitsPassed باشد")
		}
		node.Conditions = append(node.Conditions, cond)
	}
	return node, nil
}

// ParseRoleUnitTargets پورت parseRoleUnitTargets.
func ParseRoleUnitTargets(raw any) map[string]float64 {
	out := map[string]float64{}
	var obj map[string]any
	switch v := raw.(type) {
	case string:
		if strings.TrimSpace(v) == "" {
			return out
		}
		if json.Unmarshal([]byte(v), &obj) != nil {
			return out
		}
	case map[string]any:
		obj = v
	default:
		return out
	}
	for k, v := range obj {
		key := strings.ToUpper(strings.TrimSpace(k))
		f, err := strconv.ParseFloat(fmt.Sprint(v), 64)
		if len(key) >= 2 && len(key) <= 20 && isAZ(key) && err == nil && f >= 0 {
			out[key] = f
		}
	}
	return out
}

func isAZ(s string) bool {
	for _, r := range s {
		if !((r >= 'A' && r <= 'Z') || r == '_') {
			return false
		}
	}
	return true
}

// nextRevisionCode پورت nextRevisionCode.
func NextRevisionCode(code string) string {
	p := enroll.ParseVersionCode(code)
	return p.Base + "-R" + strconv.Itoa(p.Revision+1)
}

// ── نوع‌های پاسخ ──

type CurriculumCheckResult struct {
	Check    string   `json:"check"`
	Severity string   `json:"severity"`
	Message  string   `json:"message"`
	Affected []string `json:"affected"`
}

type CurriculumVersionRow struct {
	ID                 int64  `json:"id"`
	MajorID            int64  `json:"majorId"`
	DegreeLevelID      int64  `json:"degreeLevelId"`
	TrackID            *int64 `json:"trackId"`
	VersionCode        string `json:"versionCode"`
	Title              string `json:"title"`
	Status             string `json:"status"`
	EntryYearFrom      int    `json:"entryYearFrom"`
	EntryYearTo        *int   `json:"entryYearTo"`
	TotalRequiredUnits string `json:"totalRequiredUnits"`
	MaxUnitsPerTerm    *int   `json:"maxUnitsPerTerm"`
	CourseCount        int    `json:"courseCount"`
}

type CurriculumCourseRow struct {
	CourseID               int64    `json:"courseId"`
	Code                   string   `json:"code"`
	Title                  string   `json:"title"`
	ClusterID              *int64   `json:"clusterId"`
	Units                  float64  `json:"units"`
	RoleType               string   `json:"roleType"`
	IsRequired             int      `json:"isRequired"`
	IsElective             int      `json:"isElective"`
	IsGraduationRequired   int      `json:"isGraduationRequired"`
	RecommendedSemester    *int     `json:"recommendedSemester"`
	MinGrade               *float64 `json:"minGrade"`
	AutoCorequisiteAllowed int      `json:"autoCorequisiteAllowed"`
	PassGradeStatusCode    *string  `json:"passGradeStatusCode"`
	FailGradeStatusCode    *string  `json:"failGradeStatusCode"`
}

type CurriculumRuleRow struct {
	CourseID  int64               `json:"courseId"`
	RuleType  string              `json:"ruleType"`
	LogicTree CurriculumLogicCond `json:"logicTree"`
}

type CurriculumApprovalRow struct {
	ID           int64   `json:"id"`
	ApprovalType *string `json:"approvalType"`
	FromStatus   *string `json:"fromStatus"`
	ToStatus     *string `json:"toStatus"`
	DecisionNote *string `json:"decisionNote"`
	ApprovedAt   *string `json:"approvedAt"`
	ApprovedBy   *string `json:"approvedBy"`
}

type CurriculumVersionDetail struct {
	Version   CurriculumVersionRow    `json:"version"`
	Courses   []CurriculumCourseRow   `json:"courses"`
	Rules     []CurriculumRuleRow     `json:"rules"`
	Approvals []CurriculumApprovalRow `json:"approvals"`
	Checks    []CurriculumCheckResult `json:"checks"`
	Blocked   bool                    `json:"blocked"`
}

type CurriculumOverview struct {
	Majors   []map[string]any       `json:"majors"`
	Versions []CurriculumVersionRow `json:"versions"`
	Tracks   []map[string]any       `json:"tracks"`
}

// ── helpers ──

func (s *Service) curriculumVersion(ctx context.Context, id int64) (map[string]any, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "majorId", "degreeLevelId", "trackId", "versionCode", title, status,
		       "entryYearFrom", "entryYearTo", coalesce("totalRequiredUnits",'0')::text,
		       "maxUnitsPerTerm", "effectiveFrom", "effectiveTo", "minRoleUnits", "universityId"
		  from curriculum_versions where id = $1`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, errors.New("نسخهٔ برنامهٔ درسی یافت نشد.")
	}
	var id2 int64
	var majorID, degreeID int64
	var trackID, maxUnits *int64
	var effFrom, effTo *string
	var minRoleUnits *string
	var uniID *int64
	var code, title, status string
	var entryFrom int
	var entryTo *int
	var totalRequired string
	if err := rows.Scan(&id2, &majorID, &degreeID, &trackID, &code, &title, &status,
		&entryFrom, &entryTo, &totalRequired, &maxUnits, &effFrom, &effTo, &minRoleUnits, &uniID); err != nil {
		return nil, err
	}
	var maxUnitsInt *int
	if maxUnits != nil {
		n := int(*maxUnits)
		maxUnitsInt = &n
	}
	return map[string]any{
		"id": id2, "majorId": majorID, "degreeLevelId": degreeID, "trackId": trackID,
		"versionCode": code, "title": title, "status": status,
		"entryYearFrom": entryFrom, "entryYearTo": entryTo,
		"totalRequiredUnits": totalRequired, "maxUnitsPerTerm": maxUnitsInt,
		"effectiveFrom": effFrom, "effectiveTo": effTo,
		"minRoleUnits": minRoleUnits, "universityId": uniID,
	}, nil
}

func curriculumAssertEditable(v map[string]any) error {
	status := fmt.Sprint(v["status"])
	if status != "DRAFT" {
		return fmt.Errorf("ویرایش نسخه در وضعیت «%s» مجاز نیست؛ ابتدا نسخه را به DRAFT برگردانید (فقط قبل از تأیید) یا نسخهٔ جدید (R1) بسازید.", status)
	}
	return nil
}

func (s *Service) curriculumAssertUnique(ctx context.Context, majorID, degreeID int64, trackID *int64, versionCode string, excludeID *int64) error {
	args := []any{majorID, degreeID, int64(0)}
	track := int64(0)
	if trackID != nil {
		track = *trackID
	}
	args[2] = track
	q := `select id from curriculum_versions where "majorId" = $1 and "degreeLevelId" = $2
		and coalesce("trackId",0) = $3 and "versionCode" = $4`
	args = append(args, versionCode)
	if excludeID != nil {
		q += ` and id <> $5`
		args = append(args, *excludeID)
	}
	var one int
	if err := s.DB.Pool.QueryRow(ctx, q+" limit 1", args...).Scan(&one); err == nil {
		return fmt.Errorf("نسخهٔ «%s» برای این رشته/مقطع/گرایش از قبل ثبت شده است. (کد نسخه باید یکتا باشد)", versionCode)
	}
	return nil
}

func (s *Service) curriculumActorStaff(ctx context.Context, user *session.User) (int64, error) {
	var id int64
	if err := s.DB.Pool.QueryRow(ctx, `select id from staff where "userId" = $1 limit 1`, user.ID).Scan(&id); err != nil {
		return 0, errors.New("حساب شما به پروندهٔ کارکنان (staff) متصل نیست؛ برای تأیید/انتشار برنامهٔ درسی این اتصال الزامی است.")
	}
	return id, nil
}

func (s *Service) loadCurriculumCourses(ctx context.Context, versionID int64) ([]CurriculumCourseRow, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select cc."courseId", c.code, c.title, c."clusterId",
		       coalesce(cc.units, c.units, 0)::float8, coalesce(cc."roleType",'CORE'),
		       coalesce(cc."isRequired",1), coalesce(cc."isElective",0), coalesce(cc."isGraduationRequired",0),
		       cc."recommendedSemester", cc."minGrade"::float8, coalesce(cc."autoCorequisiteAllowed",0),
		       cc."passGradeStatusCode", cc."failGradeStatusCode"
		  from curriculum_courses cc join courses c on c.id = cc."courseId"
		 where cc."curriculumVersionId" = $1
		 order by cc."recommendedSemester" asc nulls last, c.code`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CurriculumCourseRow{}
	for rows.Next() {
		var r CurriculumCourseRow
		if err := rows.Scan(&r.CourseID, &r.Code, &r.Title, &r.ClusterID, &r.Units, &r.RoleType,
			&r.IsRequired, &r.IsElective, &r.IsGraduationRequired, &r.RecommendedSemester,
			&r.MinGrade, &r.AutoCorequisiteAllowed, &r.PassGradeStatusCode, &r.FailGradeStatusCode); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Service) loadCurriculumRules(ctx context.Context, versionID int64) ([]CurriculumRuleRow, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select "courseId", "ruleType", "logicTree" from course_rules where "syllabusId" = $1 order by id`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CurriculumRuleRow{}
	for rows.Next() {
		var r CurriculumRuleRow
		var raw string
		if err := rows.Scan(&r.CourseID, &r.RuleType, &raw); err != nil {
			continue
		}
		var parsed map[string]any
		if json.Unmarshal([]byte(raw), &parsed) == nil {
			if node, err := NormalizeLogicNode(parsed); err == nil {
				r.LogicTree = node
			}
		}
		if r.LogicTree.Operator == "" {
			r.LogicTree = CurriculumLogicCond{Operator: "AND"}
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ── اعتبارسنج ۱۰چکی (پورت curriculum-validator) ──

type curriculumCheckInput struct {
	TotalRequiredUnits float64
	MaxUnitsPerTerm    *int
	TrackID            *int64
	Courses            []CurriculumCourseRow
	Rules              []CurriculumRuleRow
	ExistingCodes      map[string]bool
	MinRoleCounts      map[string]int
	MinRoleUnits       map[string]float64
}

func leafCourseCodes(node CurriculumLogicCond) []string {
	out := []string{}
	var walk func(n CurriculumLogicCond)
	walk = func(n CurriculumLogicCond) {
		for _, c := range n.Conditions {
			if c.Operator != "" {
				walk(c)
			} else if c.Course != "" {
				out = append(out, c.Course)
			}
		}
	}
	walk(node)
	return out
}

func hasCurriculumCycle(nodes []string, edges [][2]string) string {
	adj := map[string][]string{}
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	color := map[string]int{}
	var cycle []string
	var dfs func(u string) bool
	dfs = func(u string) bool {
		color[u] = 1
		for _, v := range adj[u] {
			found := false
			for _, n := range nodes {
				if n == v {
					found = true
					break
				}
			}
			if !found {
				continue
			}
			c := color[v]
			if c == 1 {
				cycle = append(cycle, u, v)
				return true
			}
			if c == 0 && dfs(v) {
				cycle = append(cycle, u)
				return true
			}
		}
		color[u] = 2
		return false
	}
	for _, n := range nodes {
		if color[n] == 0 && dfs(n) {
			uniq := []string{}
			seen := map[string]bool{}
			for _, c := range cycle {
				if !seen[c] {
					seen[c] = true
					uniq = append(uniq, c)
				}
			}
			return strings.Join(uniq, " ← ")
		}
	}
	return ""
}

func checkErr(check, message string, affected []string) CurriculumCheckResult {
	return CurriculumCheckResult{Check: check, Severity: "ERROR", Message: message, Affected: affected}
}
func checkWarn(check, message string, affected []string) CurriculumCheckResult {
	return CurriculumCheckResult{Check: check, Severity: "WARN", Message: message, Affected: affected}
}

func ValidateCurriculumCore(in curriculumCheckInput) []CurriculumCheckResult {
	res := []CurriculumCheckResult{}
	var requiredSum, offeredSum float64
	for _, c := range in.Courses {
		offeredSum += c.Units
		if c.IsRequired == 1 {
			requiredSum += c.Units
		}
	}
	if requiredSum == 0 || offeredSum < in.TotalRequiredUnits {
		affected := []string{}
		for _, c := range in.Courses {
			if c.IsRequired == 1 {
				affected = append(affected, c.Code)
			}
		}
		msg := fmt.Sprintf("مجموع واحدهای ارائه‌شده در نسخه (%s) از کل واحدهای لازم برنامه (%s) کمتر است.",
			jalaliNum(offeredSum), jalaliNum(in.TotalRequiredUnits))
		if requiredSum == 0 {
			msg = fmt.Sprintf("هیچ درس الزامی‌ای در نسخه تعریف نشده است (کل واحدهای لازم برنامه: %s).", jalaliNum(in.TotalRequiredUnits))
		}
		res = append(res, checkErr("UNITS_COVER_MIN", msg, affected))
	}

	unknown := map[string]bool{}
	for _, r := range in.Rules {
		if r.RuleType != "PREREQ" && r.RuleType != "COREQ" {
			continue
		}
		for _, code := range leafCourseCodes(r.LogicTree) {
			if !in.ExistingCodes[code] {
				unknown[code] = true
			}
		}
	}
	if len(unknown) > 0 {
		codes := sortedKeys(unknown)
		res = append(res, checkErr("PREREQ_REFERENCES_VALID", "کدهای درسیِ ناموجود در بانک دروس: "+strings.Join(codes, "، "), codes))
	}

	codeByID := map[int64]string{}
	codes := []string{}
	for _, c := range in.Courses {
		codeByID[c.CourseID] = c.Code
		codes = append(codes, c.Code)
	}
	edges := [][2]string{}
	for _, r := range in.Rules {
		if r.RuleType != "PREREQ" {
			continue
		}
		dep, ok := codeByID[r.CourseID]
		if !ok {
			continue
		}
		for _, pre := range leafCourseCodes(r.LogicTree) {
			edges = append(edges, [2]string{pre, dep})
		}
	}
	if cyc := hasCurriculumCycle(codes, edges); cyc != "" {
		res = append(res, checkErr("PREREQ_CYCLE_FREE", "حلقهٔ دورانی در گراف پیش‌نیازها یافت شد: "+cyc, strings.Split(cyc, " ← ")))
	}

	semOf := map[string]*int{}
	for _, c := range in.Courses {
		sem := c.RecommendedSemester
		semOf[c.Code] = sem
	}
	semIssues := []string{}
	for _, e := range edges {
		ps, ds := semOf[e[0]], semOf[e[1]]
		if ps != nil && ds != nil && *ps > *ds {
			semIssues = append(semIssues, fmt.Sprintf("%s(%d)→%s(%d)", e[0], *ps, e[1], *ds))
		}
	}
	if len(semIssues) > 0 {
		res = append(res, checkWarn("PREREQ_SEMESTER_ORDER", "پیش‌نیازهایی که در ترمِ دیرتر از درس وابسته چیده شده‌اند: "+strings.Join(semIssues, "، "), semIssues))
	}

	codesInVersion := map[string]bool{}
	byCode := map[string]CurriculumCourseRow{}
	for _, c := range in.Courses {
		codesInVersion[c.Code] = true
		byCode[c.Code] = c
	}
	coreqIssues := []string{}
	for _, r := range in.Rules {
		if r.RuleType != "COREQ" {
			continue
		}
		var dep *CurriculumCourseRow
		if c, ok := codeByID[r.CourseID]; ok {
			if cc, ok2 := byCode[c]; ok2 {
				dep = &cc
			}
		}
		for _, code := range leafCourseCodes(r.LogicTree) {
			if !codesInVersion[code] {
				coreqIssues = append(coreqIssues, code+" (خارج از نسخه)")
				continue
			}
			coreq := byCode[code]
			autoOk := dep != nil && dep.AutoCorequisiteAllowed == 1
			if !autoOk && dep != nil && coreq.RecommendedSemester != nil && dep.RecommendedSemester != nil && *coreq.RecommendedSemester != *dep.RecommendedSemester {
				coreqIssues = append(coreqIssues, fmt.Sprintf("%s (ترم %d ≠ %d)", code, *coreq.RecommendedSemester, *dep.RecommendedSemester))
			}
		}
	}
	if len(coreqIssues) > 0 {
		res = append(res, checkWarn("COREQ_PRESENT", "هم‌نیازهایی که باید هم‌ترم شوند یا در نسخه تعریف شوند: "+strings.Join(coreqIssues, "، "), coreqIssues))
	}

	gradRequired := 0
	for _, c := range in.Courses {
		if c.IsGraduationRequired == 1 {
			gradRequired++
		}
	}
	if gradRequired == 0 {
		affected := []string{}
		for _, c := range in.Courses {
			if c.RoleType == "CORE" || c.RoleType == "MAJOR" {
				affected = append(affected, c.Code)
				if len(affected) >= 10 {
					break
				}
			}
		}
		res = append(res, checkErr("GRADUATION_COVERAGE", "هیچ درسی به‌عنوان «شرط الزامی فارغ‌التحصیلی» علامت‌گذاری نشده است؛ بدون آن تطبیق سرفصل در فارغ‌التحصیلی ممکن نیست.", affected))
	}

	if in.MaxUnitsPerTerm != nil {
		type semInfo struct {
			units float64
			codes []string
		}
		bySem := map[int]*semInfo{}
		sems := []int{}
		for _, c := range in.Courses {
			if c.RecommendedSemester == nil {
				continue
			}
			info, ok := bySem[*c.RecommendedSemester]
			if !ok {
				info = &semInfo{}
				bySem[*c.RecommendedSemester] = info
				sems = append(sems, *c.RecommendedSemester)
			}
			info.units += c.Units
			info.codes = append(info.codes, c.Code)
		}
		sort.Ints(sems)
		for _, sem := range sems {
			info := bySem[sem]
			if info.units > float64(*in.MaxUnitsPerTerm) {
				label := fmt.Sprint(sem)
				if sem == 9 {
					label = "تابستان"
				}
				res = append(res, checkWarn("SEMESTER_LOAD",
					fmt.Sprintf("بار ترم %s (%s واحد) از سقف مجاز (%d واحد) بیشتر است.", label, jalaliNum(info.units), *in.MaxUnitsPerTerm), info.codes))
			}
		}
	}

	roleFa := map[string]string{"CORE": "پایه", "MAJOR": "اصلی", "ELECTIVE": "اختیاری", "GENERAL": "عمومی", "THESIS": "پایان‌نامه", "INTERNSHIP": "کارآموزی", "WORKSHOP": "کارگاه"}
	if len(in.MinRoleCounts) > 0 {
		countByRole := map[string]int{}
		for _, c := range in.Courses {
			countByRole[c.RoleType]++
		}
		roles := sortedKeys2(in.MinRoleCounts)
		for _, role := range roles {
			min := in.MinRoleCounts[role]
			if countByRole[role] < min {
				affected := []string{}
				for _, c := range in.Courses {
					if c.RoleType == role {
						affected = append(affected, c.Code)
					}
				}
				name := role
				if roleFa[role] != "" {
					name = roleFa[role]
				}
				res = append(res, checkWarn("COURSE_TYPES_COMPLETE",
					fmt.Sprintf("نقش «%s» فقط %d درس دارد؛ حداقل مقرر %d درس است.", name, countByRole[role], min), affected))
			}
		}
	}
	if len(in.MinRoleUnits) > 0 {
		unitsByRole := map[string]float64{}
		for _, c := range in.Courses {
			unitsByRole[c.RoleType] += c.Units
		}
		roles := make([]string, 0, len(in.MinRoleUnits))
		for r := range in.MinRoleUnits {
			roles = append(roles, r)
		}
		sort.Strings(roles)
		for _, role := range roles {
			min := in.MinRoleUnits[role]
			if unitsByRole[role] < min {
				affected := []string{}
				for _, c := range in.Courses {
					if c.RoleType == role {
						affected = append(affected, c.Code)
					}
				}
				name := role
				if roleFa[role] != "" {
					name = roleFa[role]
				}
				res = append(res, checkWarn("ROLE_UNITS_COVERAGE",
					fmt.Sprintf("سهم واحد نقش «%s»: فقط %s واحد تأمین شده؛ مقرر %s واحد است.", name, jalaliNum(unitsByRole[role]), jalaliNum(min)), affected))
			}
		}
	}

	if in.TrackID != nil {
		electives := 0
		for _, c := range in.Courses {
			if c.RoleType == "ELECTIVE" {
				electives++
			}
		}
		if electives == 0 {
			res = append(res, checkWarn("TRACK_INTEGRITY",
				fmt.Sprintf("نسخهٔ گرایشی (%d) هیچ درس انتخابی متمایزی ندارد؛ در عمل با نسخهٔ گرایش آزاد یکسان است.", *in.TrackID), []string{}))
		}
	}

	byCluster := map[int64][]CurriculumCourseRow{}
	clusterIDs := []int64{}
	for _, c := range in.Courses {
		if c.ClusterID == nil {
			continue
		}
		if _, ok := byCluster[*c.ClusterID]; !ok {
			clusterIDs = append(clusterIDs, *c.ClusterID)
		}
		byCluster[*c.ClusterID] = append(byCluster[*c.ClusterID], c)
	}
	sort.Slice(clusterIDs, func(i, j int) bool { return clusterIDs[i] < clusterIDs[j] })
	for _, cid := range clusterIDs {
		members := byCluster[cid]
		if len(members) > 1 {
			titles := []string{}
			codes := []string{}
			for _, m := range members {
				titles = append(titles, m.Title)
				codes = append(codes, m.Code)
			}
			res = append(res, checkWarn("EQUIVALENCY_DISJOINT",
				fmt.Sprintf("دروس هم‌ارز «%s» (خوشهٔ %d) هر دو در این نسخه‌اند؛ گذراندن یکی باید دیگری را پوشش دهد وگرنه واحدها دوبار شمرده می‌شوند.", strings.Join(titles, "» و «"), cid), codes))
		}
	}
	return res
}

func jalaliNum(v float64) string {
	s := strconv.FormatFloat(v, 'f', -1, 64)
	if strings.HasSuffix(s, ".0") {
		s = strings.TrimSuffix(s, ".0")
	}
	return s
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sortedKeys2(m map[string]int) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
