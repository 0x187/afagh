// ═══ Top students/official probation/withdrawal file/score log — port of r-edu-roster and r-collect-external ═══
package reports

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"backend-go/internal/gpa"
	"backend-go/internal/graduation"
	"backend-go/internal/jalali"
)

var entryTermFa = map[int]string{1: "نیمسال اول", 2: "نیمسال دوم", 3: "تابستان"}

func (s *Service) runEduFinal(ctx context.Context, kind string, f Filters) (*Result, error) {
	switch kind {
	case "top-students", "probation", "graduation-dossiers", "grade-audit-log":
	default:
		return nil, nil
	}
	switch kind {
	case "top-students":
		return s.runTopStudents(ctx, f)
	case "probation":
		return s.runProbationCore(ctx, f)
	case "graduation-dossiers":
		return s.runGraduationDossiers(ctx, f)
	case "grade-audit-log":
		return s.runGradeAuditLog(ctx, f)
	}
	return nil, nil
}

type popRow struct {
	ID    int64
	Code  string
	Name  string
	Major *string
	Deg   *string
	Y     *int
	ET    *int
	St    *string
}

const popCap = 600

func (s *Service) population(ctx context.Context, f Filters) ([]popRow, bool, error) {
	args := []any{}
	where := studentWhere(f, &args)
	rows, err := s.Pool.Query(ctx, `select s.id::bigint, s."studentCode", u."firstName" || ' ' || u."lastName",
		m.name, d.title, s."entryYear", s."entryTerm", s.status
		from students s join users u on u.id = s."userId"
		left join majors m on m.id = s."majorId"
		left join degree_level_configs d on d.id = s."degreeLevelId"
		where `+where+` order by s."studentCode" limit $`+fmt.Sprint(len(args)+1), append(args, popCap)...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []popRow{}
	for rows.Next() {
		var r popRow
		if err := rows.Scan(&r.ID, &r.Code, &r.Name, &r.Major, &r.Deg, &r.Y, &r.ET, &r.St); err == nil {
			out = append(out, r)
		}
	}
	return out, len(out) >= popCap, rows.Err()
}

func (s *Service) runTopStudents(ctx context.Context, f Filters) (*Result, error) {
	mode := strings.ToUpper(strings.TrimSpace(f.GPAMode))
	if mode != "TERM" && mode != "CUMULATIVE" {
		mode = "OVERALL"
	}
	gpaTerm := strings.TrimSpace(f.GPATerm)
	gpaTermFrom := strings.TrimSpace(f.GPATermFrom)
	topN := f.TopN
	if topN < 0 {
		topN = 0
	}
	if topN > 500 {
		topN = 500
	}
	titleOf := func(code string) string {
		if code == "" {
			return code
		}
		var t *string
		_ = s.Pool.QueryRow(ctx, `select title from academic_terms where "termCode" = $1 limit 1`, code).Scan(&t)
		if t != nil && *t != "" {
			return *t
		}
		return code
	}
	termTitle, termFromTitle := gpaTerm, gpaTermFrom
	if gpaTerm != "" {
		termTitle = titleOf(gpaTerm)
	}
	if gpaTermFrom != "" {
		termFromTitle = titleOf(gpaTermFrom)
	}
	gpaLabel := "معدل کل"
	switch mode {
	case "TERM":
		gpaLabel = "معدل نیمسال " + termTitle
	case "CUMULATIVE":
		if gpaTermFrom != "" {
			gpaLabel = fmt.Sprintf("معدل از %s تا پایان %s", termFromTitle, termTitle)
		} else {
			gpaLabel = "معدل تا پایان " + termTitle
		}
	}
	columns := []Column{
		{Key: "rank", Title: "رتبه"}, {Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"},
		{Key: "major", Title: "رشته"}, {Key: "degree", Title: "مقطع"}, {Key: "y", Title: "سال ورود", Format: "NUMBER"},
		{Key: "et", Title: "نیمسال ورود"}, {Key: "gpa", Title: gpaLabel, Format: "NUMBER"},
		{Key: "units", Title: "واحد محاسبه‌شده", Format: "NUMBER"}, {Key: "passed", Title: "واحد گذرانده", Format: "NUMBER"},
		{Key: "st", Title: "وضعیت"},
	}
	if mode != "OVERALL" && gpaTerm == "" {
		return emptyResult(columns, "برای این ملاک، ابتدا نیمسال را انتخاب کنید."), nil
	}
	pop, capped, err := s.population(ctx, f)
	if err != nil {
		return nil, err
	}
	sids := make([]int64, 0, len(pop))
	for _, p := range pop {
		sids = append(sids, p.ID)
	}
	cfgs, _, err := gpaCfgsFor(ctx, s, sids)
	if err != nil {
		return nil, err
	}
	rowsBySid, err := s.loadGpaRowsBatch(ctx, sids)
	if err != nil {
		return nil, err
	}
	type scored struct {
		p             popRow
		gpa           *float64
		units, passed float64
	}
	scoredList := []scored{}
	for _, p := range pop {
		cfg := cfgs[p.ID]
		rows := rowsBySid[p.ID]
		var gp *float64
		var units, passed float64
		switch mode {
		case "OVERALL":
			c := gpa.AggregateOfficialGpaRows(gpaRowsOf(rows), gpaEngineInput(cfg))
			units, passed = c.TotalUnits, c.PassedUnits
			if c.TotalUnits > 0 {
				v := c.GPA
				gp = &v
			}
		case "TERM":
			for _, t := range officialBreakdown(rows, cfg) {
				if t.TermCode == gpaTerm {
					if t.GPA != nil {
						gp = t.GPA
					}
					units, passed = t.Units, t.Passed
					break
				}
			}
		case "CUMULATIVE":
			filtered := []gpaRow{}
			for _, r := range rows {
				tc := r.TermCode
				if tc == "" {
					continue
				}
				if gpaTerm != "" && tc > gpaTerm {
					continue
				}
				if gpaTermFrom != "" && tc < gpaTermFrom {
					continue
				}
				filtered = append(filtered, r)
			}
			c := gpa.AggregateOfficialGpaRows(gpaRowsOf(filtered), gpaEngineInput(cfg))
			units, passed = c.TotalUnits, c.PassedUnits
			if c.TotalUnits > 0 {
				v := c.GPA
				gp = &v
			}
		}
		scoredList = append(scoredList, scored{p: p, gpa: gp, units: units, passed: passed})
	}
	sort.SliceStable(scoredList, func(i, j int) bool {
		a, b := scoredList[i], scoredList[j]
		av, bv := -1.0, -1.0
		if a.gpa != nil {
			av = *a.gpa
		}
		if b.gpa != nil {
			bv = *b.gpa
		}
		if av != bv {
			return av > bv
		}
		return a.p.Code < b.p.Code
	})
	type rankedRow struct {
		rank          int
		code, name    string
		major, degree *string
		y             *int
		et            *int
		gpa           *float64
		units, passed float64
		st            *string
	}
	ranked := []rankedRow{}
	withGpa := []scored{}
	for _, sc := range scoredList {
		if sc.gpa != nil {
			withGpa = append(withGpa, sc)
		}
	}
	lastGpa, lastRank := -1.0, 0
	for i, sc := range withGpa {
		if lastRank == 0 || *sc.gpa != lastGpa {
			lastRank = i + 1
			lastGpa = *sc.gpa
		}
		ranked = append(ranked, rankedRow{rank: lastRank, code: sc.p.Code, name: sc.p.Name,
			major: sc.p.Major, degree: sc.p.Deg, y: sc.p.Y, et: sc.p.ET, gpa: sc.gpa,
			units: sc.units, passed: sc.passed, st: sc.p.St})
	}
	if topN > 0 && topN < len(ranked) {
		ranked = ranked[:topN]
	}
	out := []map[string]any{}
	for _, r := range ranked {
		et := "—"
		if r.et != nil {
			if label, ok := entryTermFa[*r.et]; ok {
				et = label
			}
		}
		out = append(out, map[string]any{
			"rank": r.rank, "code": r.code, "name": r.name,
			"major": strOr(r.major, "—"), "degree": strOr(r.degree, "—"),
			"y": r.y, "et": et, "gpa": r.gpa, "units": r.units, "passed": r.passed,
			"st": faStatus(r.st),
		})
	}
	summary := fmt.Sprintf("%s دانشجو دارای %s — مرتب‌شده نزولی با رتبه", jalali.GroupThousands(float64(len(ranked))), gpaLabel)
	if topN > 0 {
		summary += fmt.Sprintf(" (برترین‌های انتخاب‌شده: %s نفر)", jalali.GroupThousands(float64(topN)))
	}
	if capped {
		summary += fmt.Sprintf(" · توجه: جمعیت واجد شرایط از سقف %s نفر بیشتر بود؛ برای رتبه‌بندی دقیق‌تر رشته/مقطع/سال و نیمسال ورود را فیلتر کنید.", jalali.GroupThousands(popCap))
	}
	return pageOf(columns, out, f.Page, summary), nil
}

func strOr(v *string, def string) string {
	if v == nil || *v == "" {
		return def
	}
	return *v
}

func (s *Service) runProbationCore(ctx context.Context, f Filters) (*Result, error) {
	columns := []Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
		{Key: "degree", Title: "مقطع"}, {Key: "y", Title: "سال ورود", Format: "NUMBER"},
		{Key: "probTerms", Title: "تعداد ترم مشروطی", Format: "NUMBER"}, {Key: "lastTerm", Title: "آخرین ترم مشروط"},
		{Key: "lastGpa", Title: "معدل آن ترم", Format: "NUMBER"}, {Key: "threshold", Title: "مرز مشروطی مقطع", Format: "NUMBER"},
		{Key: "units", Title: "واحد مؤثر", Format: "NUMBER"}, {Key: "st", Title: "وضعیت"},
	}
	pop, capped, err := s.population(ctx, f)
	if err != nil {
		return nil, err
	}
	sids := make([]int64, 0, len(pop))
	for _, p := range pop {
		sids = append(sids, p.ID)
	}
	cfgs, _, err := gpaCfgsFor(ctx, s, sids)
	if err != nil {
		return nil, err
	}
	rowsBySid, err := s.loadGpaRowsBatch(ctx, sids)
	if err != nil {
		return nil, err
	}
	isSummerOrEquiv := func(code string) bool {
		if strings.HasSuffix(code, "3") || strings.HasSuffix(code, "5") {
			return true
		}
		return strings.Contains(strings.ToUpper(code), "EQ")
	}
	out := []map[string]any{}
	for _, p := range pop {
		cfg := cfgs[p.ID]
		bd := officialBreakdown(rowsBySid[p.ID], cfg)
		probTerms := []officialTermRow{}
		for _, t := range bd {
			if t.IsProb && !isSummerOrEquiv(t.TermCode) && (f.Term == "" || t.TermCode == f.Term) {
				probTerms = append(probTerms, t)
			}
		}
		if len(probTerms) == 0 {
			continue
		}
		last := probTerms[len(probTerms)-1]
		thr := cfg.ProbThreshold
		out = append(out, map[string]any{
			"code": p.Code, "name": p.Name, "major": strOr(p.Major, "—"), "degree": strOr(p.Deg, "—"),
			"y": p.Y, "probTerms": len(probTerms), "lastTerm": last.Title,
			"lastGpa": last.GPA, "threshold": thr, "units": last.Units, "st": faStatus(p.St),
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		return toInt(out[j]["probTerms"]) < toInt(out[i]["probTerms"])
	})
	summary := fmt.Sprintf("%s دانشجوی مشروط بر پایهٔ مرز آیین‌نامهٔ مقطع (تابستان/معادل‌سازی شمرده نشد)", jalali.GroupThousands(float64(len(out))))
	if capped {
		summary += fmt.Sprintf(" · توجه: سقف %s نفر برای سرعت؛ رشته/مقطع/سال و نیمسال ورود را فیلتر کنید.", jalali.GroupThousands(popCap))
	}
	return pageOf(columns, out, f.Page, summary), nil
}

func toInt(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	}
	return 0
}

func (s *Service) runGraduationDossiers(ctx context.Context, f Filters) (*Result, error) {
	if s.Graduation == nil {
		return emptyResult(nil, "سرویس فارغ‌التحصیلی در دسترس نیست."), nil
	}
	list, err := s.Graduation.ListDossiers(ctx, &f.UniversityID, f.DossierStatus, strings.TrimSpace(f.Q))
	if err != nil {
		return nil, err
	}
	titleOf := func(code string) string {
		for _, st := range graduation.WorkflowSteps {
			if st.Code == code {
				return st.Title
			}
		}
		return code
	}
	rows := []map[string]any{}
	for _, d := range list {
		irandoc := "—"
		if d.IrandocStatus != nil {
			irandoc = *d.IrandocStatus
		}
		last := "—"
		if d.LastEventAt != nil {
			last = d.LastEventAt.UTC().Format("2006-01-02T15:04:05Z")
		}
		rows = append(rows, map[string]any{
			"code": d.StudentCode, "name": d.FullName, "major": d.MajorName, "degree": d.DegreeTitle,
			"gpa": d.GPA, "passed": d.PassedUnits, "required": d.RequiredUnits,
			"status": titleOf(d.WorkflowStatus), "irandoc": irandoc, "last": last,
		})
	}
	return pageOf([]Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
		{Key: "degree", Title: "مقطع"}, {Key: "gpa", Title: "معدل", Format: "NUMBER"},
		{Key: "passed", Title: "واحد گذرانده", Format: "NUMBER"}, {Key: "required", Title: "واحد لازم", Format: "NUMBER"},
		{Key: "status", Title: "مرحله"}, {Key: "irandoc", Title: "ایرانداک"}, {Key: "last", Title: "آخرین رویداد", Format: "DATETIME"},
	}, rows, f.Page, fmt.Sprintf("%s پرونده (سقف ۳۰۰)", jalali.GroupThousands(float64(len(rows))))), nil
}

func (s *Service) runGradeAuditLog(ctx context.Context, f Filters) (*Result, error) {
	args := []any{}
	conds := []string{`(st."universityId" = $1 OR st."universityId" IS NULL)`}
	args = append(args, f.UniversityID)
	if strings.TrimSpace(f.Term) != "" {
		args = append(args, strings.TrimSpace(f.Term))
		conds = append(conds, fmt.Sprintf(`t."termCode" = $%d`, len(args)))
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		args = append(args, "%"+q+"%")
		p := fmt.Sprintf("$%d", len(args))
		conds = append(conds, `(c.code ILIKE `+p+` ESCAPE '\' OR c.title ILIKE `+p+` ESCAPE '\' OR st."studentCode" ILIKE `+p+` ESCAPE '\')`)
	}
	rows, err := s.Pool.Query(ctx, `select g."createdAt"::text, g."studentId", coalesce(c.code,'—'), coalesce(c.title,''),
		coalesce(t."termCode",'—'), g.action, coalesce(g."oldGradeValue",'—'), coalesce(g."newGradeValue",'—'),
		coalesce(au."firstName",''), coalesce(au."lastName",''), coalesce(g."actorUserId"::text,'—'), coalesce(g.reason,'—')
		from grade_change_log g
		join students st on st.id = g."studentId"
		left join users au on au.id = g."actorUserId"
		left join course_offerings o on o.id = g."offeringId"
		left join courses c on c.id = o."courseId"
		left join academic_terms t on t.id = o."termId"
		where `+strings.Join(conds, " AND ")+`
		order by g."createdAt" desc limit 200`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var date string
		var studentID int64
		var courseCode, courseTitle, term, action, before, after, first, last, actorID, reason string
		if err := rows.Scan(&date, &studentID, &courseCode, &courseTitle, &term, &action, &before, &after, &first, &last, &actorID, &reason); err != nil {
			continue
		}
		actor := strings.TrimSpace(strings.TrimSpace(first + " " + last))
		if actor == "" {
			actor = "#" + actorID
		}
		out = append(out, map[string]any{
			"date": date, "student": "#" + fmt.Sprint(studentID),
			"course": strings.TrimSpace(courseCode + " " + courseTitle), "term": term,
			"action": action, "before": before, "after": after,
			"actor": actor, "reason": reason,
		})
	}
	return pageOf([]Column{
		{Key: "date", Title: "تاریخ", Format: "DATETIME"}, {Key: "student", Title: "دانشجو"},
		{Key: "course", Title: "درس"}, {Key: "term", Title: "ترم"}, {Key: "action", Title: "عملیات"},
		{Key: "before", Title: "قبل"}, {Key: "after", Title: "بعد"}, {Key: "actor", Title: "اقدام‌کننده"},
		{Key: "reason", Title: "دلیل"},
	}, out, f.Page, fmt.Sprintf("%s رکورد (۲۰۰ لاگ اخیر)", jalali.GroupThousands(float64(len(out))))), nil
}
