// ═══ Educational program/course registration reports — port of r-edu-schedule ═══
package reports

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"backend-go/internal/jalali"
)

func (s *Service) runEduSchedule(ctx context.Context, kind string, f Filters) (*Result, error) {
	switch kind {
	case "student-weekly-conflicts", "student-exam-conflicts", "prereq-violations", "course-grade-status", "enrollment-pick":
	default:
		return nil, nil
	}
	term := f.Term
	if term == "" {
		term = s.latestTermCode(ctx)
	}

	switch kind {
	case "student-weekly-conflicts":
		if term == "" {
			return emptyResult(nil, "ترمی یافت نشد"), nil
		}
		args := []any{term}
		conds := []string{`t."termCode" = $1`, `e1.status <> 'DROPPED'`, `e2.status <> 'DROPPED'`, studentWhere(f, &args)}
		from := `FROM enrollments e1
			JOIN course_offerings o1 ON o1.id = e1."offeringId"
			JOIN academic_terms t ON t.id = o1."termId"
			JOIN students s ON s.id = e1."studentId"
			JOIN users u ON u.id = s."userId"
			LEFT JOIN majors m ON m.id = s."majorId"
			JOIN courses c1 ON c1.id = o1."courseId"
			JOIN schedules sc1 ON sc1."offeringId" = o1.id AND sc1."scheduleType" = 'CLASS' AND sc1."dayOfWeek" IS NOT NULL
			JOIN enrollments e2 ON e2."studentId" = e1."studentId" AND e2.id > e1.id
			JOIN course_offerings o2 ON o2.id = e2."offeringId" AND o2."termId" = o1."termId"
			JOIN courses c2 ON c2.id = o2."courseId"
			JOIN schedules sc2 ON sc2."offeringId" = o2.id AND sc2."scheduleType" = 'CLASS'
			  AND sc2."dayOfWeek" = sc1."dayOfWeek"
			  AND sc1."startTime" < sc2."endTime" AND sc2."startTime" < sc1."endTime"`
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
			 (c1.code || ' — ' || c1.title) AS course1, (c2.code || ' — ' || c2.title) AS course2,
			 CASE sc1."dayOfWeek" WHEN 0 THEN 'شنبه' WHEN 1 THEN 'یکشنبه' WHEN 2 THEN 'دوشنبه' WHEN 3 THEN 'سه‌شنبه'
			   WHEN 4 THEN 'چهارشنبه' WHEN 5 THEN 'پنج‌شنبه' WHEN 6 THEN 'جمعه' ELSE COALESCE('روز ' || sc1."dayOfWeek"::text,'—') END AS day,
			 (to_char(sc1."startTime",'HH24:MI') || ' تا ' || to_char(sc1."endTime",'HH24:MI')) AS time1,
			 (to_char(sc2."startTime",'HH24:MI') || ' تا ' || to_char(sc2."endTime",'HH24:MI')) AS time2`,
			from, strings.Join(conds, " AND "), "", `ORDER BY code, course1, course2`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "course1", Title: "درس اول"},
			{Key: "course2", Title: "درس دوم"}, {Key: "day", Title: "روز"}, {Key: "time1", Title: "ساعت درس اول"},
			{Key: "time2", Title: "ساعت درس دوم"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s مورد تداخل هفتگی در ترم %s (مبنای زمان: schedules با scheduleType='CLASS')", jalali.GroupThousands(float64(total)), term)}, nil

	case "student-exam-conflicts":
		if term == "" {
			return emptyResult(nil, "ترمی یافت نشد"), nil
		}
		args := []any{term}
		conds := []string{`t."termCode" = $1`, `e1.status <> 'DROPPED'`, `e2.status <> 'DROPPED'`, studentWhere(f, &args)}
		from := `FROM enrollments e1
			JOIN course_offerings o1 ON o1.id = e1."offeringId"
			JOIN academic_terms t ON t.id = o1."termId"
			JOIN students s ON s.id = e1."studentId"
			JOIN users u ON u.id = s."userId"
			LEFT JOIN majors m ON m.id = s."majorId"
			JOIN courses c1 ON c1.id = o1."courseId"
			JOIN schedules sc1 ON sc1."offeringId" = o1.id AND sc1."scheduleType" = 'EXAM' AND sc1."examDate" IS NOT NULL
			JOIN enrollments e2 ON e2."studentId" = e1."studentId" AND e2.id > e1.id
			JOIN course_offerings o2 ON o2.id = e2."offeringId" AND o2."termId" = o1."termId"
			JOIN courses c2 ON c2.id = o2."courseId"
			JOIN schedules sc2 ON sc2."offeringId" = o2.id AND sc2."scheduleType" = 'EXAM'
			  AND sc2."examDate" = sc1."examDate"
			  AND sc1."startTime" < sc2."endTime" AND sc2."startTime" < sc1."endTime"`
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
			 (c1.code || ' — ' || c1.title) AS course1, (c2.code || ' — ' || c2.title) AS course2,
			 sc1."examDate"::text AS exam_date,
			 (sc1."startTime"::text || ' تا ' || sc1."endTime"::text) AS time1,
			 (sc2."startTime"::text || ' تا ' || sc2."endTime"::text) AS time2`,
			from, strings.Join(conds, " AND "), "", `ORDER BY code, exam_date, course1`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "course1", Title: "درس اول"},
			{Key: "course2", Title: "درس دوم"}, {Key: "exam_date", Title: "تاریخ امتحان", Format: "DATE"},
			{Key: "time1", Title: "ساعت درس اول"}, {Key: "time2", Title: "ساعت درس دوم"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s مورد تداخل امتحانی در ترم %s (مبنای زمان: schedules با scheduleType='EXAM')", jalali.GroupThousands(float64(total)), term)}, nil

	case "course-grade-status":
		if term == "" {
			return emptyResult(nil, "ترمی یافت نشد"), nil
		}
		args := []any{term}
		conds := []string{`t."termCode" = $1`}
		if f.GradeStatus != "" {
			args = append(args, f.GradeStatus)
			conds = append(conds, fmt.Sprintf(`e."gradeStatus" = $%d`, len(args)))
		}
		if f.SamaCode != "" {
			args = append(args, f.SamaCode)
			conds = append(conds, fmt.Sprintf(`e."samaGradeStatusCode" = $%d`, len(args)))
		}
		conds = append(conds, studentWhere(f, &args))
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
			 (c.code || ' — ' || c.title) AS course, t."termCode" AS term,
			 e."gradeValue"::float8 AS "gradeValue", e."gradeStatus" AS "gradeStatus",
			 e."samaGradeStatusCode" AS "samaCode"`,
			`FROM enrollments e
			 JOIN course_offerings o ON o.id = e."offeringId"
			 JOIN academic_terms t ON t.id = o."termId"
			 JOIN students s ON s.id = e."studentId"
			 JOIN users u ON u.id = s."userId"
			 LEFT JOIN majors m ON m.id = s."majorId"
			 JOIN courses c ON c.id = o."courseId"`,
			strings.Join(conds, " AND "), "", `ORDER BY code, course`, args, f.Page)
		if err != nil {
			return nil, err
		}
		extra := ""
		if f.GradeStatus != "" {
			extra += " — وضعیت: " + f.GradeStatus
		}
		if f.SamaCode != "" {
			extra += " — کد سما: " + f.SamaCode
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "course", Title: "درس"},
			{Key: "term", Title: "ترم"}, {Key: "gradeValue", Title: "نمره", Format: "NUMBER"},
			{Key: "gradeStatus", Title: "وضعیت نمره"}, {Key: "samaCode", Title: "کد سما"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s رکورد درس و نمره در ترم %s%s", jalali.GroupThousands(float64(total)), term, extra)}, nil

	case "enrollment-pick":
		if term == "" {
			return emptyResult(nil, "ترمی یافت نشد"), nil
		}
		args := []any{term}
		conds := []string{`t."termCode" = $1`, studentWhere(f, &args)}
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			 COUNT(*) FILTER (WHERE e.status <> 'DROPPED')::int AS courses,
			 COALESCE(SUM(c.units) FILTER (WHERE e.status <> 'DROPPED'),0)::float8 AS units,
			 COUNT(*) FILTER (WHERE e.status = 'DROPPED')::int AS dropped`,
			`FROM enrollments e
			 JOIN course_offerings o ON o.id = e."offeringId"
			 JOIN academic_terms t ON t.id = o."termId"
			 JOIN students s ON s.id = e."studentId"
			 JOIN users u ON u.id = s."userId"
			 LEFT JOIN majors m ON m.id = s."majorId"
			 JOIN courses c ON c.id = o."courseId"`,
			strings.Join(conds, " AND "),
			`s."studentCode", u."firstName", u."lastName", m.name`, `ORDER BY code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "courses", Title: "تعداد درس", Format: "NUMBER"}, {Key: "units", Title: "جمع واحد", Format: "NUMBER"},
			{Key: "dropped", Title: "حذف‌شده", Format: "NUMBER"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s دانشجو با انتخاب واحد در ترم %s — «تغییرات» فقط در حد شمارش حذف‌شده‌ها گزارش می‌شود", jalali.GroupThousands(float64(total)), term)}, nil

	case "prereq-violations":
		return s.prereqViolations(ctx, f, term)
	}
	return nil, nil
}

// ── Prerequisite/corequisite ──

type LogicCond struct {
	Course      string      `json:"course"`
	MinGrade    *float64    `json:"minGrade"`
	UnitsPassed *float64    `json:"unitsPassed"`
	Operator    string      `json:"operator"`
	Conditions  []LogicCond `json:"conditions"`
}

func (n LogicCond) isEmpty() bool {
	return n.Course == "" && n.UnitsPassed == nil && len(n.Conditions) == 0
}

func evalTree(node LogicCond, isCoreq bool, passedBefore map[string]float64, sameTerm map[string]bool, passedUnits float64) (bool, []string) {
	if node.Course != "" {
		if isCoreq && sameTerm[node.Course] {
			return true, nil
		}
		need := 10.0
		if node.MinGrade != nil {
			need = *node.MinGrade
		}
		g, ok := passedBefore[node.Course]
		if ok && g >= need {
			return true, nil
		}
		return false, []string{node.Course}
	}
	if node.UnitsPassed != nil {
		if passedUnits >= *node.UnitsPassed {
			return true, nil
		}
		return false, []string{fmt.Sprintf("%s واحد", numText(*node.UnitsPassed))}
	}
	if len(node.Conditions) == 0 {
		return true, nil
	}
	op := strings.ToUpper(strings.TrimSpace(node.Operator))
	if op == "" {
		op = "AND"
	}
	missing := []string{}
	okAll := true
	okAny := false
	for _, c := range node.Conditions {
		ok, m := evalTree(c, isCoreq, passedBefore, sameTerm, passedUnits)
		missing = append(missing, m...)
		if ok {
			okAny = true
		} else {
			okAll = false
		}
	}
	if op == "OR" {
		return okAny, nil2Missing(missing, okAny)
	}
	return okAll, missing
}

func nil2Missing(missing []string, okAny bool) []string {
	if okAny {
		return nil
	}
	return missing
}

func (s *Service) prereqViolations(ctx context.Context, f Filters, term string) (*Result, error) {
	cols := []Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "course", Title: "درس اخذشده"},
		{Key: "rule", Title: "نوع قاعده"}, {Key: "missing", Title: "پیش‌نیاز/هم‌نیاز رعایت‌نشده"}, {Key: "term", Title: "ترم اخذ"},
	}
	if term == "" {
		return emptyResult(cols, "ترمی یافت نشد"), nil
	}
	// Chronological order of terms
	trows, err := s.Pool.Query(ctx, `select "termCode" as code, "sortOrder" as so from academic_terms`)
	if err != nil {
		return nil, err
	}
	type termRef struct {
		code string
		so   *int
	}
	terms := []termRef{}
	for trows.Next() {
		var t termRef
		if err := trows.Scan(&t.code, &t.so); err == nil {
			terms = append(terms, t)
		}
	}
	trows.Close()
	sort.SliceStable(terms, func(i, j int) bool {
		a, b := terms[i], terms[j]
		ao, bo := math.MaxInt32, math.MaxInt32
		if a.so != nil {
			ao = *a.so
		}
		if b.so != nil {
			bo = *b.so
		}
		if ao != bo {
			return ao < bo
		}
		return a.code < b.code
	})
	orderOf := map[string]int{}
	for i, t := range terms {
		orderOf[t.code] = i
	}
	targetOrder, ok := orderOf[term]
	if !ok {
		targetOrder = math.MaxInt32
	}

	// Rules
	rrows, err := s.Pool.Query(ctx, `select c.code, r."ruleType", r."logicTree"
		from course_rules r join courses c on c.id = r."courseId"
		where r."ruleType" in ('PREREQ','COREQ')`)
	if err != nil {
		return nil, err
	}
	type ruleRef struct {
		RuleType string
		Tree     LogicCond
	}
	ruleByCourse := map[string][]ruleRef{}
	badRules := 0
	for rrows.Next() {
		var ccode, ruleType, logic string
		if err := rrows.Scan(&ccode, &ruleType, &logic); err != nil {
			continue
		}
		var tree LogicCond
		if json.Unmarshal([]byte(logic), &tree) != nil || tree.isEmpty() {
			badRules++
			continue
		}
		ruleByCourse[ccode] = append(ruleByCourse[ccode], ruleRef{RuleType: ruleType, Tree: tree})
	}
	rrows.Close()
	if len(ruleByCourse) == 0 {
		msg := "قاعدهٔ پیش‌نیاز/هم‌نیاز قابل ارزیابی یافت نشد"
		if badRules > 0 {
			msg += fmt.Sprintf(" (%s قاعدهٔ خراب نادیده گرفته شد)", jalali.GroupThousands(float64(badRules)))
		}
		return emptyResult(cols, msg), nil
	}

	// Target-term enrollments for courses with a rule
	args := []any{term}
	codes := make([]string, 0, len(ruleByCourse))
	for code := range ruleByCourse {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	codePh := make([]string, 0, len(codes))
	for _, c := range codes {
		args = append(args, c)
		codePh = append(codePh, "$"+strconv.Itoa(len(args)))
	}
	conds := []string{`t."termCode" = $1`, `e.status <> 'DROPPED'`,
		`c.code IN (` + strings.Join(codePh, ",") + `)`, studentWhere(f, &args)}
	type targetRow struct {
		SID  int64
		Code string
		Name string
		CC   string
		CT   string
	}
	target := []targetRow{}
	tq, err := s.Pool.Query(ctx, `select e."studentId"::bigint, s."studentCode", u."firstName" || ' ' || u."lastName", c.code, c.title
		from enrollments e
		join course_offerings o on o.id = e."offeringId"
		join academic_terms t on t.id = o."termId"
		join students s on s.id = e."studentId"
		join users u on u.id = s."userId"
		left join majors m on m.id = s."majorId"
		join courses c on c.id = o."courseId"
		where `+strings.Join(conds, " AND "), args...)
	if err != nil {
		return nil, err
	}
	for tq.Next() {
		var r targetRow
		if err := tq.Scan(&r.SID, &r.Code, &r.Name, &r.CC, &r.CT); err == nil {
			target = append(target, r)
		}
	}
	tq.Close()
	if len(target) == 0 {
		return emptyResult(cols, fmt.Sprintf("در ترم %s اخذی برای دروس دارای قاعده یافت نشد", term)), nil
	}

	// History of passes
	sids := map[int64]bool{}
	for _, r := range target {
		sids[r.SID] = true
	}
	sidPh := make([]string, 0, len(sids))
	hargs := []any{}
	for sid := range sids {
		hargs = append(hargs, sid)
		sidPh = append(sidPh, "$"+strconv.Itoa(len(hargs)))
	}
	hq, err := s.Pool.Query(ctx, `select e."studentId"::bigint, c.code, e."gradeValue"::float8, t."termCode", c."gradingType", c.units::float8
		from enrollments e
		join course_offerings o on o.id = e."offeringId"
		join academic_terms t on t.id = o."termId"
		join courses c on c.id = o."courseId"
		where e."gradeStatus" = 'FINALIZED' AND e."gradeValue" IS NOT NULL AND e."studentId" IN (`+strings.Join(sidPh, ",")+`)`, hargs...)
	if err != nil {
		return nil, err
	}
	bestBefore := map[int64]map[string]float64{}
	unitsBefore := map[int64]float64{}
	for hq.Next() {
		var sid int64
		var ccode, tcode string
		var g, units float64
		var gt *string
		if err := hq.Scan(&sid, &ccode, &g, &tcode, &gt, &units); err != nil {
			continue
		}
		ord, ok := orderOf[tcode]
		if !ok || ord >= targetOrder {
			continue
		}
		passed := g >= 10
		if gt != nil && *gt == "DESCRIPTIVE" {
			passed = g == 1
		}
		if !passed {
			continue
		}
		m := bestBefore[sid]
		if m == nil {
			m = map[string]float64{}
		}
		if cur, ok := m[ccode]; !ok || g > cur {
			m[ccode] = g
		}
		bestBefore[sid] = m
		unitsBefore[sid] += units
	}
	hq.Close()
	sameTermByStudent := map[int64]map[string]bool{}
	for _, r := range target {
		if sameTermByStudent[r.SID] == nil {
			sameTermByStudent[r.SID] = map[string]bool{}
		}
		sameTermByStudent[r.SID][r.CC] = true
	}

	out := []map[string]any{}
	for _, r := range target {
		for _, rule := range ruleByCourse[r.CC] {
			ok, missing := evalTree(rule.Tree, rule.RuleType == "COREQ",
				bestBefore[r.SID], sameTermByStudent[r.SID], unitsBefore[r.SID])
			if !ok {
				uniq := []string{}
				seen := map[string]bool{}
				for _, m := range missing {
					if !seen[m] {
						seen[m] = true
						uniq = append(uniq, m)
					}
				}
				ruleLabel := "پیش‌نیاز"
				if rule.RuleType == "COREQ" {
					ruleLabel = "هم‌نیاز"
				}
				out = append(out, map[string]any{
					"code": r.Code, "name": r.Name,
					"course": r.CC + " — " + r.CT, "rule": ruleLabel,
					"missing": strings.Join(uniq, "، "), "term": term,
				})
				break
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if fmt.Sprint(out[i]["code"]) != fmt.Sprint(out[j]["code"]) {
			return fmt.Sprint(out[i]["code"]) < fmt.Sprint(out[j]["code"])
		}
		return fmt.Sprint(out[i]["course"]) < fmt.Sprint(out[j]["course"])
	})
	note := ""
	if badRules > 0 {
		note = fmt.Sprintf(" — %s قاعدهٔ خراب نادیده گرفته شد", jalali.GroupThousands(float64(badRules)))
	}
	res := pageOf(cols, out, f.Page, fmt.Sprintf("%s مورد عدم رعایت پیش‌نیاز/هم‌نیاز در ترم %s (مبنای قبولی: نمرهٔ نهایی ۱۰ به بالا در ترم‌های قبل طبق sortOrder؛ هم‌نیاز با اخذ هم‌زمان هم پوشش داده می‌شود)%s", jalali.GroupThousands(float64(len(out))), term, note))
	return res, nil
}

func emptyResult(cols []Column, summary string) *Result {
	if cols == nil {
		cols = []Column{}
	}
	return &Result{Columns: cols, Rows: []map[string]any{}, Page: 1, Per: Per, TotalPages: 1, Summary: summary}
}
