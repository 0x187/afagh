// ═══ Educational reports of the report center — port of the admin/reports/actions.ts core ═══
package reports

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"backend-go/internal/jalali"
)

const stuFrom = `FROM students s
	JOIN users u ON u.id = s."userId"
	LEFT JOIN majors m ON m.id = s."majorId"
	LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
	LEFT JOIN faculties fc ON fc.id = m."facultyId"`

const stuCols = `s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
	u."nationalCode" AS nc, m.name AS major, d.title AS degree, s."entryYear" AS y, s.status AS st`

var studentStatusFa = map[string]string{
	"ACTIVE": "در حال تحصیل", "GRADUATED": "فارغ‌التحصیل", "EXPELLED": "اخراج",
	"WITHDRAWN": "انصراف", "SUSPENDED": "محروم از تحصیل", "TRANSFERRED": "انتقالی / میهمان",
	"UNKNOWN": "نامشخص", "NO_SHOW": "عدم مراجعه", "DECEASED": "فوت",
}

func faStatus(v any) string {
	k := ""
	switch x := v.(type) {
	case nil:
	case *string:
		if x != nil {
			k = *x
		}
	default:
		k = fmt.Sprint(v)
	}
	if s, ok := studentStatusFa[k]; ok {
		return s
	}
	return k
}

func numText(v any) string {
	switch x := v.(type) {
	case int64:
		return fmt.Sprintf("%d", x)
	case int32:
		return fmt.Sprintf("%d", x)
	case int:
		return fmt.Sprintf("%d", x)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case string:
		return x
	}
	return ""
}

func mapStatusRows(rows []map[string]any, key string) {
	for _, r := range rows {
		r[key] = faStatus(r[key])
	}
}

// runEduCore runs the core educational reports.
func (s *Service) runEduCore(ctx context.Context, kind string, f Filters) (*Result, error) {
	switch kind {
	case "active-term":
		return s.runActiveTerm(ctx, f)
	case "status-summary":
		return s.runStatusSummary(ctx, f)
	case "by-faculty":
		return s.runByFaculty(ctx, f)
	case "by-major":
		return s.runByMajor(ctx, f)
	case "grade-status":
		return s.runGradeStatus(ctx, f)
	case "top":
		return s.runTop(ctx, f)
	case "incomplete":
		return s.runIncomplete(ctx, f)
	case "graduates", "entries", "noshow":
		return s.runStudentList(ctx, kind, f)
	case "transfers":
		return s.runTransfers(ctx, f)
	case "third-attempt":
		return s.runThirdAttempt(ctx, f)
	case "payesh":
		return s.runPayesh(ctx, f)
	case "jame":
		return s.runJame(ctx, f)
	case "docs":
		return s.runDocs(ctx, f)
	}
	return nil, nil
}

func (s *Service) latestTermCode(ctx context.Context) string {
	var code string
	_ = s.Pool.QueryRow(ctx, `select "termCode" from academic_terms order by "termCode" desc limit 1`).Scan(&code)
	return code
}

func (s *Service) runActiveTerm(ctx context.Context, f Filters) (*Result, error) {
	term := f.Term
	if term == "" {
		term = s.latestTermCode(ctx)
	}
	args := []any{term}
	conds := []string{`t."termCode" = $1`, studentWhere(f, &args)}
	from := `FROM enrollments e
		JOIN course_offerings o ON o.id = e."offeringId"
		JOIN academic_terms t ON t.id = o."termId"
		JOIN students s ON s.id = e."studentId"
		JOIN users u ON u.id = s."userId"
		LEFT JOIN majors m ON m.id = s."majorId"
		LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"`
	selectCols := `s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
		m.name AS major, d.title AS degree, COUNT(e.id)::int AS units,
		ROUND(AVG(CASE WHEN e."gradeStatus" = 'FINALIZED' AND e."gradeValue"::text ~ '^[0-9]+(\.[0-9]+)?$' THEN e."gradeValue"::numeric END), 2)::float8 AS avg`
	groupBy := `s."studentCode", u."firstName", u."lastName", m.name, d.title`
	rows, total, pages, err := s.pagedQuery(ctx, selectCols, from, strings.Join(conds, " AND "), groupBy, "ORDER BY code", args, f.Page)
	if err != nil {
		return nil, err
	}
	return &Result{Columns: []Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"},
		{Key: "major", Title: "رشته"}, {Key: "degree", Title: "مقطع"},
		{Key: "units", Title: "تعداد درس", Format: "NUMBER"}, {Key: "avg", Title: "میانگین", Format: "NUMBER"},
	}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
		Summary: fmt.Sprintf("%s دانشجو در ترم %s", jalali.GroupThousands(float64(total)), term)}, nil
}

func (s *Service) runStatusSummary(ctx context.Context, f Filters) (*Result, error) {
	args := []any{}
	where := studentWhere(f, &args)
	rows, err := s.Pool.Query(ctx, `select s.status as st, d.title as degree, count(*)::int as n `+stuFrom+` WHERE `+where+` GROUP BY s.status, d.title ORDER BY 1,2`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := scanRows(rows)
	total := 0
	for _, r := range out {
		r["st"] = faStatus(r["st"])
		if n, ok := r["n"].(int32); ok {
			total += int(n)
		} else if n, ok := r["n"].(int64); ok {
			total += int(n)
		}
	}
	return &Result{Columns: []Column{
		{Key: "st", Title: "وضعیت"}, {Key: "degree", Title: "مقطع"}, {Key: "n", Title: "تعداد", Format: "NUMBER"},
	}, Rows: out, Total: len(out), Page: 1, Per: len(out) + 1, TotalPages: 1,
		Summary: fmt.Sprintf("جمع کل: %s پرونده", jalali.GroupThousands(float64(total)))}, nil
}

func (s *Service) runByFaculty(ctx context.Context, f Filters) (*Result, error) {
	args := []any{}
	where := studentWhere(f, &args)
	rows, err := s.Pool.Query(ctx, `select COALESCE(fc.name,'— بدون دانشکده —') as faculty, s.status as st, count(*)::int as n `+stuFrom+` WHERE `+where+` GROUP BY fc.name, s.status ORDER BY 1,2`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	acc := map[string]map[string]any{}
	statuses := []string{}
	seen := map[string]bool{}
	for rows.Next() {
		var faculty, st string
		var n int
		if err := rows.Scan(&faculty, &st, &n); err != nil {
			return nil, err
		}
		if !seen[st] {
			seen[st] = true
			statuses = append(statuses, st)
		}
		if _, ok := acc[faculty]; !ok {
			acc[faculty] = map[string]any{"faculty": faculty, "total": 0}
		}
		acc[faculty][st] = n
		acc[faculty]["total"] = acc[faculty]["total"].(int) + n
	}
	out := []map[string]any{}
	for _, o := range acc {
		for _, st := range statuses {
			if n, ok := o[st].(int); ok && n > 0 {
				o[st] = jalali.GroupThousands(float64(n)) + " " + faStatus(st)
			} else {
				o[st] = "—"
			}
		}
		out = append(out, o)
	}
	cols := []Column{{Key: "faculty", Title: "دانشکده"}, {Key: "total", Title: "جمع", Format: "NUMBER"}}
	for _, st := range statuses {
		cols = append(cols, Column{Key: st, Title: faStatus(st)})
	}
	return &Result{Columns: cols, Rows: out, Total: len(out), Page: 1, Per: len(out) + 1, TotalPages: 1}, nil
}

func (s *Service) runByMajor(ctx context.Context, f Filters) (*Result, error) {
	args := []any{}
	where := studentWhere(f, &args)
	rows, err := s.Pool.Query(ctx, `select m."majorCode" as code, m.name as major, d.title as degree, COALESCE(fc.name,'—') as faculty,
		count(*)::int as total,
		count(*) FILTER (WHERE s.status = 'ACTIVE')::int as a,
		count(*) FILTER (WHERE s.status = 'GRADUATED')::int as g,
		count(*) FILTER (WHERE s.status = 'WITHDRAWN')::int as w,
		count(*) FILTER (WHERE s.status = 'NO_SHOW')::int as n `+stuFrom+` WHERE `+where+`
		GROUP BY m."majorCode", m.name, d.title, fc.name ORDER BY total DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := scanRows(rows)
	return &Result{Columns: []Column{
		{Key: "code", Title: "کد"}, {Key: "major", Title: "رشته"}, {Key: "degree", Title: "مقطع"},
		{Key: "faculty", Title: "دانشکده"}, {Key: "total", Title: "جمع", Format: "NUMBER"},
		{Key: "a", Title: "فعال", Format: "NUMBER"}, {Key: "g", Title: "فارغ‌التحصیل", Format: "NUMBER"},
		{Key: "w", Title: "انصراف", Format: "NUMBER"}, {Key: "n", Title: "عدم مراجعه", Format: "NUMBER"},
	}, Rows: out, Total: len(out), Page: 1, Per: len(out) + 1, TotalPages: 1}, nil
}

func (s *Service) runGradeStatus(ctx context.Context, f Filters) (*Result, error) {
	args := []any{f.Term}
	conds := []string{`t."termCode" = $1`, studentWhere(f, &args)}
	rows, err := s.Pool.Query(ctx, `select e."gradeStatus" as st, count(*)::int as n,
		ROUND(AVG(CASE WHEN e."gradeValue"::text ~ '^[0-9]+(\.[0-9]+)?$' THEN e."gradeValue"::numeric END),2)::float8 as avg
		FROM enrollments e
		JOIN course_offerings o ON o.id = e."offeringId"
		JOIN academic_terms t ON t.id = o."termId"
		JOIN students s ON s.id = e."studentId"
		JOIN users u ON u.id = s."userId"
		LEFT JOIN majors m ON m.id = s."majorId"
		WHERE `+strings.Join(conds, " AND ")+` GROUP BY 1 ORDER BY 2 DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := scanRows(rows)
	total := 0
	for _, r := range out {
		switch n := r["n"].(type) {
		case int32:
			total += int(n)
		case int64:
			total += int(n)
		}
	}
	gradeFa := map[string]string{"FINALIZED": "نهایی", "TEMPORARY": "موقت", "PENDING": "در انتظار", "EXEMPT": "معاف", "PASSED_NO_GRADE": "قبول بدون نمره", "FAILED_NO_GRADE": "مردود بدون نمره"}
	for _, r := range out {
		if k, ok := r["st"].(string); ok && gradeFa[k] != "" {
			r["st"] = gradeFa[k]
		}
	}
	return &Result{Columns: []Column{
		{Key: "st", Title: "وضعیت نمره"}, {Key: "n", Title: "تعداد", Format: "NUMBER"}, {Key: "avg", Title: "میانگین نمرات", Format: "NUMBER"},
	}, Rows: out, Total: total, Page: 1, Per: len(out) + 1, TotalPages: 1,
		Summary: fmt.Sprintf("%s رکورد نمره در ترم %s", jalali.GroupThousands(float64(total)), f.Term)}, nil
}

func (s *Service) runTop(ctx context.Context, f Filters) (*Result, error) {
	args := []any{}
	conds := []string{`e."gradeStatus" = 'FINALIZED'`, `e."gradeValue"::text ~ '^[0-9]+(\.[0-9]+)?$'`, studentWhere(f, &args)}
	from := `FROM enrollments e JOIN students s ON s.id = e."studentId" JOIN users u ON u.id = s."userId"
		LEFT JOIN majors m ON m.id = s."majorId" LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"`
	cols := `s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
		d.title AS degree, s."entryYear" AS y, COUNT(*)::int AS units, ROUND(AVG(e."gradeValue"::numeric),2)::float8 AS avg`
	groupBy := `s."studentCode", u."firstName", u."lastName", m.name, d.title, s."entryYear"`
	having := `COUNT(*) >= 10 AND AVG(e."gradeValue"::numeric) >= 17`
	rows, total, pages, err := s.pagedQueryHaving(ctx, cols, from, strings.Join(conds, " AND "), groupBy, having, "ORDER BY avg DESC", args, f.Page)
	if err != nil {
		return nil, err
	}
	return &Result{Columns: []Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
		{Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
		{Key: "units", Title: "درس", Format: "NUMBER"}, {Key: "avg", Title: "میانگین کل", Format: "NUMBER"},
	}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages}, nil
}

func (s *Service) runIncomplete(ctx context.Context, f Filters) (*Result, error) {
	miss := f.Miss
	var extra string
	switch miss {
	case "mobile":
		extra = `(u.mobile IS NULL OR u.mobile = '' OR u.mobile = '—')`
	case "major":
		extra = `s."majorId" IS NULL`
	default:
		extra = `(u."nationalCode" IS NULL OR u."nationalCode" !~ '^[0-9]{10}$')`
	}
	return s.studentList(ctx, []Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "nc", Title: "کد ملی"},
		{Key: "major", Title: "رشته"}, {Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
		{Key: "st", Title: "وضعیت"},
	}, extra, f)
}

func (s *Service) studentList(ctx context.Context, cols []Column, extra string, f Filters) (*Result, error) {
	args := []any{}
	conds := []string{studentWhere(f, &args)}
	if extra != "" {
		conds = append(conds, extra)
	}
	rows, total, pages, err := s.pagedQuery(ctx, stuCols, stuFrom, strings.Join(conds, " AND "), "", `ORDER BY s."studentCode"`, args, f.Page)
	if err != nil {
		return nil, err
	}
	mapStatusRows(rows, "st")
	return &Result{Columns: cols, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages}, nil
}

func (s *Service) runStudentList(ctx context.Context, kind string, f Filters) (*Result, error) {
	cols := []Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "nc", Title: "کد ملی"},
		{Key: "major", Title: "رشته"}, {Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
	}
	switch kind {
	case "graduates":
		return s.studentList(ctx, cols, `s.status = 'GRADUATED'`, f)
	case "noshow":
		return s.studentList(ctx, cols, `s.status = 'NO_SHOW'`, f)
	case "entries":
		year := f.EntryYear
		if year == 0 {
			_ = s.Pool.QueryRow(ctx, `select max("entryYear") from students where ("universityId" = $1 OR "universityId" IS NULL)`, f.UniversityID).Scan(&year)
		}
		cols = append(cols[:5], Column{Key: "st", Title: "وضعیت"})
		r, err := s.studentList(ctx, cols, fmt.Sprintf(`s."entryYear" = %d`, year), f)
		if r != nil {
			r.Summary = fmt.Sprintf("ورودی %d — %s نفر", year, jalali.GroupThousands(float64(r.Total)))
		}
		return r, err
	}
	return nil, nil
}

func (s *Service) runTransfers(ctx context.Context, f Filters) (*Result, error) {
	args := []any{}
	where := studentWhere(f, &args)
	rows, err := s.Pool.Query(ctx, `SELECT s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
		u."nationalCode" AS nc, m.name AS major, d.title AS degree, s."entryYear" AS y, s.status AS st,
		sts."termCode" AS guest_transfer_term, sts."statusTitle" AS guest_transfer_status
		FROM students s JOIN users u ON u.id = s."userId"
		LEFT JOIN majors m ON m.id = s."majorId"
		LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
		LEFT JOIN student_term_states sts ON sts."studentId" = s.id
		  AND (sts."normalizedStatusTitle" ILIKE '%میهمان%' OR sts."normalizedStatusTitle" ILIKE '%انتقال%'
		       OR sts."statusTitle" ILIKE '%میهمان%' OR sts."statusTitle" ILIKE '%انتقال%')
		WHERE s.status IN ('TRANSFERRED','GUEST') AND `+where+` ORDER BY s."studentCode"`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := scanRows(rows)
	mapStatusRows(out, "st")
	return &Result{Columns: []Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "nc", Title: "کد ملی"},
		{Key: "major", Title: "رشته"}, {Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
		{Key: "st", Title: "وضعیت کلی"}, {Key: "guest_transfer_term", Title: "ترم میهمانی/انتقال"},
		{Key: "guest_transfer_status", Title: "وضعیت ترم"},
	}, Rows: out, Total: len(out), Page: 1, Per: len(out) + 1, TotalPages: 1,
		Summary: fmt.Sprintf("%s دانشجو میهمان/انتقالی", jalali.GroupThousands(float64(len(out))))}, nil
}

func (s *Service) runThirdAttempt(ctx context.Context, f Filters) (*Result, error) {
	args := []any{}
	conds := []string{`s.status = 'ACTIVE'`, `ce."status" IN ('REGISTERED','PENDING_COUNCIL','WAITLISTED')`}
	if f.Term != "" {
		args = append(args, f.Term)
		conds = append(conds, fmt.Sprintf(`t."termCode" = $%d`, len(args)))
	}
	conds = append(conds, studentWhere(f, &args))
	from := `FROM enrollments ce
		JOIN course_offerings o ON o.id = ce."offeringId"
		JOIN courses c ON c.id = o."courseId"
		JOIN academic_terms t ON t.id = o."termId"
		JOIN students s ON s.id = ce."studentId"
		JOIN users u ON u.id = s."userId"
		LEFT JOIN majors m ON m.id = s."majorId"
		LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
		JOIN LATERAL (
		  SELECT COUNT(*) FILTER (WHERE e."status" <> 'DROPPED')::int AS total_attempts,
		    COUNT(*) FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND e."gradeValue"::text ~ '^[0-9]+(\.[0-9]+)?$' AND e."gradeValue"::numeric < 10)::int AS failed_count,
		    (ARRAY_AGG(e."gradeValue" ORDER BY t2."sortOrder" DESC NULLS LAST, t2."termCode" DESC, o2.id DESC)
		      FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND e."gradeValue"::text ~ '^[0-9]+(\.[0-9]+)?$'))[1] AS last_grade
		  FROM enrollments e
		    JOIN course_offerings o2 ON o2.id = e."offeringId"
		    JOIN academic_terms t2 ON t2.id = o2."termId"
		  WHERE e."studentId" = ce."studentId" AND o2."courseId" = o."courseId"
		) h ON h.failed_count >= 2`
	cols := `s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
		m.name AS major, d.title AS degree, s."entryYear" AS y,
		c.code AS course_code, c.title AS course_title,
		h.total_attempts, h.failed_count, t."termCode" AS current_term, h.last_grade::float8 AS last_grade`
	rows, total, pages, err := s.pagedQuery(ctx, cols, from, strings.Join(conds, " AND "), "",
		`ORDER BY failed_count DESC, last_grade ASC NULLS LAST`, args, f.Page)
	if err != nil {
		return nil, err
	}
	scope := "اخذ در همه ترم‌ها"
	if f.Term != "" {
		scope = "اخذ در ترم " + f.Term
	}
	return &Result{Columns: []Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
		{Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
		{Key: "course_code", Title: "کد درس"}, {Key: "course_title", Title: "نام درس"},
		{Key: "total_attempts", Title: "کل تلاش", Format: "NUMBER"}, {Key: "failed_count", Title: "تکرار مردودی", Format: "NUMBER"},
		{Key: "current_term", Title: "ترم جاری"}, {Key: "last_grade", Title: "آخرین نمره", Format: "NUMBER"},
	}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
		Summary: fmt.Sprintf("%s درس بار سوم (مردودی از کل سابقه) — %s", jalali.GroupThousands(float64(total)), scope)}, nil
}

func (s *Service) runPayesh(ctx context.Context, f Filters) (*Result, error) {
	args := []any{}
	conds := []string{"1=1"}
	if f.Term != "" {
		args = append(args, f.Term)
		conds = append(conds, fmt.Sprintf(`t."termCode" = $%d`, len(args)))
	}
	if f.UniversityID > 0 {
		args = append(args, f.UniversityID)
		conds = append(conds, fmt.Sprintf(`(f."universityId" = $%d OR f."universityId" IS NULL)`, len(args)))
	}
	rows, err := s.Pool.Query(ctx, `select f.id as fid, f.title as form_title, q.id as qid,
		q."questionText" as question, count(r.id)::int as responses,
		CASE WHEN q."questionType" = 'SCALE'
		  THEN ROUND(AVG(CASE WHEN qo."scoreValue" IS NOT NULL THEN qo."scoreValue" END),1)::float8::text
		  ELSE NULL END as avg_score
		FROM evaluation_forms f
		  JOIN evaluation_questions q ON q."formId" = f.id
		  LEFT JOIN question_options qo ON qo."questionId" = q.id
		  LEFT JOIN evaluation_responses r ON r."questionId" = q.id AND r."selectedOptionId" = qo.id
		  LEFT JOIN course_offerings o ON o.id = r."offeringId"
		  LEFT JOIN academic_terms t ON t.id = o."termId"
		WHERE `+strings.Join(conds, " AND ")+` GROUP BY f.id, f.title, q.id, q."questionText", q."questionType" ORDER BY f.id, q.id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := scanRows(rows)
	return &Result{Columns: []Column{
		{Key: "form_title", Title: "فرم"}, {Key: "question", Title: "سؤال"},
		{Key: "responses", Title: "پاسخ‌ها", Format: "NUMBER"}, {Key: "avg_score", Title: "میانگین نمره"},
	}, Rows: out, Total: len(out), Page: 1, Per: len(out) + 1, TotalPages: 1,
		Summary: fmt.Sprintf("%s سؤال پایش", jalali.GroupThousands(float64(len(out))))}, nil
}

func (s *Service) runJame(ctx context.Context, f Filters) (*Result, error) {
	args := []any{}
	where := studentWhere(f, &args)
	rows, err := s.Pool.Query(ctx, `select s."studentCode" as code, u."firstName" || ' ' || u."lastName" as name,
		m.name as major, d.title as degree, s."entryYear" as y,
		count(DISTINCT e."offeringId")::int as courses_passed,
		ROUND(AVG(CASE WHEN e."gradeStatus" = 'FINALIZED' AND e."gradeValue"::text ~ '^[0-9]+(\.[0-9]+)?$' THEN e."gradeValue"::numeric END),2)::float8 as avg
		FROM students s JOIN users u ON u.id = s."userId"
		  LEFT JOIN majors m ON m.id = s."majorId"
		  LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
		  LEFT JOIN enrollments e ON e."studentId" = s.id AND e."gradeStatus" = 'FINALIZED'
		    AND e."gradeValue"::text ~ '^[0-9]+(\.[0-9]+)?$' AND e."gradeValue"::numeric >= 12
		WHERE s.status = 'ACTIVE' AND `+where+`
		GROUP BY s."studentCode", u."firstName", u."lastName", m.name, d.title, s."entryYear"
		HAVING COUNT(DISTINCT e."offeringId") >= 10 ORDER BY avg DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := scanRows(rows)
	return &Result{Columns: []Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
		{Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
		{Key: "courses_passed", Title: "درس قبول", Format: "NUMBER"}, {Key: "avg", Title: "میانگین", Format: "NUMBER"},
	}, Rows: out, Total: len(out), Page: 1, Per: len(out) + 1, TotalPages: 1,
		Summary: fmt.Sprintf("%s دانشجو واجد شرایط جامع", jalali.GroupThousands(float64(len(out))))}, nil
}

func (s *Service) runDocs(ctx context.Context, f Filters) (*Result, error) {
	args := []any{}
	where := studentWhere(f, &args)
	rows, err := s.Pool.Query(ctx, `select s."studentCode" as code, u."firstName" || ' ' || u."lastName" as name,
		m.name as major, d.title as degree, s.status as st,
		count(sd.id)::int as doc_count, count(DISTINCT sd."categoryId")::int as cat_count
		FROM students s JOIN users u ON u.id = s."userId"
		  LEFT JOIN majors m ON m.id = s."majorId"
		  LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
		  LEFT JOIN student_documents sd ON sd."personUserId" = u.id
		WHERE s.status = 'ACTIVE' AND `+where+`
		GROUP BY s."studentCode", u."firstName", u."lastName", m.name, d.title, s.status
		ORDER BY doc_count ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := scanRows(rows)
	noDoc := 0
	for _, r := range out {
		if n, ok := r["doc_count"].(int32); ok && n == 0 {
			noDoc++
		}
	}
	return &Result{Columns: []Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
		{Key: "degree", Title: "مقطع"}, {Key: "doc_count", Title: "تعداد مدرک", Format: "NUMBER"},
		{Key: "cat_count", Title: "دسته مدرک", Format: "NUMBER"},
	}, Rows: out, Total: len(out), Page: 1, Per: len(out) + 1, TotalPages: 1,
		Summary: fmt.Sprintf("%s پرونده فعال — %s بدون مدرک", jalali.GroupThousands(float64(len(out))), jalali.GroupThousands(float64(noDoc)))}, nil
}

// pagedQueryHaving is pagination with HAVING.
func (s *Service) pagedQueryHaving(ctx context.Context, selectCols, from, where, groupBy, having, orderBy string, args []any, page int) ([]map[string]any, int, int, error) {
	grp := ""
	if groupBy != "" {
		grp = " GROUP BY " + groupBy
	}
	hav := ""
	if having != "" {
		hav = " HAVING " + having
	}
	var total int
	countSQL := "SELECT COUNT(*)::int FROM (SELECT 1 " + from
	if where != "" {
		countSQL += " WHERE " + where
	}
	countSQL += grp + hav + ") t"
	if err := s.Pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, 1, err
	}
	totalPages := int(float64(total)/float64(Per) + 0.999999)
	if totalPages < 1 {
		totalPages = 1
	}
	if page < 1 {
		page = 1
	}
	if page > totalPages {
		page = totalPages
	}
	offset := (page - 1) * Per
	dataSQL := "SELECT " + selectCols + " " + from
	if where != "" {
		dataSQL += " WHERE " + where
	}
	dataSQL += grp + hav + " " + orderBy + " LIMIT $" + strconv.Itoa(len(args)+1) + " OFFSET $" + strconv.Itoa(len(args)+2)
	dataArgs := append(append([]any{}, args...), Per, offset)
	rows, err := s.Pool.Query(ctx, dataSQL, dataArgs...)
	if err != nil {
		return nil, 0, 1, err
	}
	defer rows.Close()
	return scanRows(rows), total, totalPages, nil
}
