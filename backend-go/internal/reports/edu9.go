// ═══ Degree-level regulatory caps + probation/units reports — port of r-edu-probation ═══
package reports

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"backend-go/internal/jalali"
)

// levelCaps is the per (regulation, level) caps/floors of the regulations.
type levelCaps struct {
	Total, Consecutive, Threshold, MinUnits, MaxUnits, ProbMax float64
}

func defaultLevelCaps() levelCaps {
	return levelCaps{Total: 3, Consecutive: 3, Threshold: 12, MinUnits: 12, MaxUnits: 20, ProbMax: 14}
}

func maghtaGroupOf(code string) string {
	m := strings.ToUpper(strings.TrimSpace(code))
	if i := strings.Index(m, "-"); i >= 0 {
		m = m[i+1:]
	}
	switch m {
	case "3", "MS":
		return "MS"
	case "4", "6", "7", "8", "PHD":
		return "PHD"
	case "1", "5", "9", "10", "AD":
		return "SHORT"
	}
	return "LONG"
}

func numJSONPtr(m map[string]any, key string) *float64 {
	if m == nil {
		return nil
	}
	if v, ok := m[key]; ok && v != nil {
		switch x := v.(type) {
		case float64:
			return &x
		case json.Number:
			if f, err := x.Float64(); err == nil {
				return &f
			}
		}
	}
	return nil
}

func subMap(m map[string]any, key string) map[string]any {
	if m == nil {
		return nil
	}
	if v, ok := m[key].(map[string]any); ok {
		return v
	}
	return nil
}

// levelCapsForStudents builds the caps of each (regulation, level) for the report population.
func (s *Service) levelCapsForStudents(ctx context.Context, f Filters) (map[string]levelCaps, []any, error) {
	pargs := []any{}
	pwhere := studentWhere(f, &pargs)
	prows, err := s.Pool.Query(ctx, `select distinct s."regulationId" as reg, s."degreeLevelId" as deg
		from students s join users u on u.id = s."userId"
		left join majors m on m.id = s."majorId"
		where `+pwhere+` limit 60`, pargs...)
	if err != nil {
		return nil, nil, err
	}
	type pair struct {
		reg *int64
		deg *int64
	}
	pairs := []pair{}
	for prows.Next() {
		var p pair
		if err := prows.Scan(&p.reg, &p.deg); err == nil {
			pairs = append(pairs, p)
		}
	}
	prows.Close()

	degCode := map[int64]string{}
	out := map[string]levelCaps{}
	for _, p := range pairs {
		key := fmt.Sprintf("%d:%d", int64(deref64(p.reg)), int64(deref64(p.deg)))
		if _, ok := out[key]; ok {
			continue
		}
		caps := defaultLevelCaps()
		qargs := []any{}
		conds := []string{}
		if p.reg != nil {
			qargs = append(qargs, *p.reg)
			conds = append(conds, fmt.Sprintf(`id = $%d`, len(qargs)))
		}
		if p.deg != nil {
			qargs = append(qargs, *p.deg)
			conds = append(conds, fmt.Sprintf(`"degreeLevelId" = $%d`, len(qargs)))
		}
		rows, err := s.Pool.Query(ctx, `select id, "degreeLevelId", "rulesConfig" from educational_regulations where `+strings.Join(conds, " or ")+` limit 20`, qargs...)
		if err == nil {
			type regRow struct {
				id  int64
				deg *int64
				raw string
			}
			list := []regRow{}
			for rows.Next() {
				var r regRow
				if err := rows.Scan(&r.id, &r.deg, &r.raw); err == nil {
					list = append(list, r)
				}
			}
			rows.Close()
			var preferred, fallback *regRow
			for i := range list {
				if p.reg != nil && list[i].id == *p.reg {
					preferred = &list[i]
				}
				if p.deg != nil && list[i].deg != nil && *list[i].deg == *p.deg && fallback == nil {
					fallback = &list[i]
				}
			}
			for _, r := range []*regRow{preferred, fallback} {
				if r == nil || strings.TrimSpace(r.raw) == "" {
					continue
				}
				var parsed map[string]any
				if json.Unmarshal([]byte(r.raw), &parsed) != nil || parsed == nil {
					continue
				}
				if subMap(parsed, "grading_and_gpa") == nil {
					continue
				}
				if pt := subMap(parsed, "probation_and_tenure"); pt != nil {
					if v := numJSONPtr(pt, "max_total_probations"); v != nil {
						caps.Total = *v
					}
					if v := numJSONPtr(pt, "max_consecutive_probations"); v != nil {
						caps.Consecutive = *v
					}
					if v := numJSONPtr(pt, "probation_gpa_threshold"); v != nil {
						caps.Threshold = *v
					}
				}
				if rt := subMap(parsed, "regular_term_rules"); rt != nil {
					if v := numJSONPtr(rt, "min_units"); v != nil {
						caps.MinUnits = *v
					}
					if v := numJSONPtr(rt, "max_units"); v != nil {
						caps.MaxUnits = *v
					}
					if v := numJSONPtr(rt, "probation_max_units"); v != nil {
						caps.ProbMax = *v
					}
				}
				// Level differences come from levels
				if levels := subMap(parsed, "levels"); levels != nil && p.deg != nil {
					code, ok := degCode[*p.deg]
					if !ok {
						_ = s.Pool.QueryRow(ctx, `select code from degree_level_configs where id = $1`, *p.deg).Scan(&code)
						degCode[*p.deg] = code
					}
					if ov := subMap(levels, maghtaGroupOf(code)); ov != nil {
						if v := numJSONPtr(ov, "max_total_probations"); v != nil {
							caps.Total = *v
						}
						if v := numJSONPtr(ov, "max_consecutive_probations"); v != nil {
							caps.Consecutive = *v
						}
						if v := numJSONPtr(ov, "min_units"); v != nil {
							caps.MinUnits = *v
						}
					}
				}
				break
			}
		}
		out[key] = caps
	}
	return out, pargs, nil
}

func deref64(v *int64) float64 {
	if v == nil {
		return 0
	}
	return float64(*v)
}

// capCaseSQL builds a CASE expression (regulation+level -> value) with a JSON fallback.
func capCaseSQL(caps map[string]levelCaps, args *[]any, pick func(levelCaps) float64, fallbackSQL string) string {
	whens := []string{}
	for k, c := range caps {
		parts := strings.SplitN(k, ":", 2)
		reg, _ := strconv.ParseInt(parts[0], 10, 64)
		deg, _ := strconv.ParseInt(parts[1], 10, 64)
		*args = append(*args, reg, deg, pick(c))
		whens = append(whens, fmt.Sprintf(`WHEN s."regulationId" = $%d AND s."degreeLevelId" = $%d THEN $%d::numeric`, len(*args)-2, len(*args)-1, len(*args)))
	}
	if len(whens) == 0 {
		return "(" + fallbackSQL + ")"
	}
	return "(CASE " + strings.Join(whens, " ") + " ELSE " + fallbackSQL + " END)"
}

const probFlag = `(COALESCE(sts."isProbation",0) = 1 OR COALESCE(sts."calculatedProbation",0) = 1 OR COALESCE(sts."sourceProbation",0) = 1)`

func (s *Service) runEduProbation(ctx context.Context, kind string, f Filters) (*Result, error) {
	switch kind {
	case "probation-violations", "probation-chains", "unit-cap-violations", "repeated-courses":
	default:
		return nil, nil
	}
	caps, _, err := s.levelCapsForStudents(ctx, f)
	if err != nil {
		return nil, err
	}

	switch kind {
	case "probation-violations":
		args := []any{}
		jsonTotal := `COALESCE((SELECT (er."rulesConfig"::jsonb -> 'probation_and_tenure' ->> 'max_total_probations')::numeric FROM educational_regulations er WHERE er.id = s."regulationId"), 3)`
		cap := "(" + capCaseSQL(caps, &args, func(c levelCaps) float64 { return c.Total }, jsonTotal) + ` + COALESCE(s."extraAllowedProbations", 0))`
		counted := probFlag + ` AND NOT (sts."termCode" ~ '3$' OR sts."termCode" ~ '5$')`
		where := studentWhere(f, &args)
		groupBy := `s."studentCode", u."firstName", u."lastName", m.name, s.id, s."regulationId", s."extraAllowedProbations"`
		selectCols := `s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			COUNT(*) FILTER (WHERE ` + counted + `)::int AS "probTerms", ` + cap + `::int AS allowed,
			ROUND(AVG(COALESCE(sts."normalizedTermAvg", sts."termAvg", sts."sourceTermAvg")) FILTER (WHERE ` + counted + `), 2)::float8 AS avg`
		having := `COUNT(*) FILTER (WHERE ` + counted + `) > ` + cap
		rows, total, pages, err := s.pagedQueryHaving(ctx, selectCols,
			`FROM students s JOIN users u ON u.id = s."userId" LEFT JOIN majors m ON m.id = s."majorId"
			 JOIN student_term_states sts ON sts."studentId" = s.id`,
			where, groupBy, having, `ORDER BY "probTerms" DESC, code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "probTerms", Title: "ترم مشروطی", Format: "NUMBER"}, {Key: "allowed", Title: "سقف مجاز", Format: "NUMBER"},
			{Key: "avg", Title: "میانگین", Format: "NUMBER"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s دانشجو بیش از سقف مجاز مشروطی (سقف = سقف آیین‌نامهٔ مقطع + ارفاق دانشجو؛ تابستان/معادل‌سازی شمرده نشد)", jalali.GroupThousands(float64(total)))}, nil

	case "probation-chains":
		whereArgs := []any{}
		where := studentWhere(f, &whereArgs)
		jsonConsec := `COALESCE((SELECT (er."rulesConfig"::jsonb -> 'probation_and_tenure' ->> 'max_consecutive_probations')::numeric FROM educational_regulations er WHERE er.id = s."regulationId"), 3)`
		args := append([]any{}, whereArgs...)
		capExpr := capCaseSQL(caps, &args, func(c levelCaps) float64 { return c.Consecutive }, jsonConsec)
		from := `FROM (
			SELECT sid, MAX(len)::int AS "chainLength", (ARRAY_AGG(terms ORDER BY len DESC, terms))[1] AS "chainTerms"
			FROM (
			  SELECT sid, COUNT(*) AS len, STRING_AGG(tc, '، ' ORDER BY rn) AS terms
			  FROM (
			    SELECT sid, tc, rn, (rn - ROW_NUMBER() OVER (PARTITION BY sid ORDER BY rn)) AS grp
			    FROM (
			      SELECT sts."studentId" AS sid, sts."termCode" AS tc,
			        ROW_NUMBER() OVER (PARTITION BY sts."studentId" ORDER BY COALESCE(t."sortOrder", 2147483647), sts."termCode") AS rn,
			        CASE WHEN (COALESCE(sts."isProbation",0) = 1 OR COALESCE(sts."calculatedProbation",0) = 1 OR COALESCE(sts."sourceProbation",0) = 1) THEN 1 ELSE 0 END AS prob
			      FROM student_term_states sts LEFT JOIN academic_terms t ON t.id = sts."termId"
			    ) o WHERE prob = 1 AND NOT (tc ~ '3$' OR tc ~ '5$')
			  ) p GROUP BY sid, grp
			) g GROUP BY sid
		) b
		JOIN students s ON s.id = b.sid JOIN users u ON u.id = s."userId" LEFT JOIN majors m ON m.id = s."majorId"`
		selectCols := `s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			b."chainLength" AS "chainLength", b."chainTerms" AS "chainTerms",
			CASE WHEN b."chainLength" > ` + capExpr + ` THEN 'تخلف' ELSE '—' END AS "violation"`
		rows, total, pages, err := s.pagedQueryArgs(ctx, selectCols, from, where, "", `ORDER BY b."chainLength" DESC, code`, whereArgs, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "chainLength", Title: "طول زنجیره", Format: "NUMBER"}, {Key: "chainTerms", Title: "ترم‌های زنجیره"},
			{Key: "violation", Title: "تخلف سقف متوالی؟"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s دانشجو با سابقهٔ مشروطی (مرتب به‌ترتیب طولانی‌ترین زنجیرهٔ متوالی؛ تابستان/معادل‌سازی شمرده نشد)", jalali.GroupThousands(float64(total)))}, nil

	case "unit-cap-violations":
		args := []any{}
		jsonMin := `COALESCE((SELECT (er."rulesConfig"::jsonb -> 'regular_term_rules' ->> 'min_units')::numeric FROM educational_regulations er WHERE er.id = s."regulationId"), 12)`
		jsonMax := `COALESCE((SELECT (er."rulesConfig"::jsonb -> 'regular_term_rules' ->> 'max_units')::numeric FROM educational_regulations er WHERE er.id = s."regulationId"), 20)`
		jsonProbMax := `COALESCE((SELECT (er."rulesConfig"::jsonb -> 'regular_term_rules' ->> 'probation_max_units')::numeric FROM educational_regulations er WHERE er.id = s."regulationId"), 14)`
		cfgMin := capCaseSQL(caps, &args, func(c levelCaps) float64 { return c.MinUnits }, jsonMin)
		cfgMax := capCaseSQL(caps, &args, func(c levelCaps) float64 { return c.MaxUnits }, jsonMax)
		cfgProbMax := capCaseSQL(caps, &args, func(c levelCaps) float64 { return c.ProbMax }, jsonProbMax)
		cfgSummerMax := `COALESCE((SELECT (er."rulesConfig"::jsonb -> 'summer_term_rules' ->> 'default_max_units')::numeric FROM educational_regulations er WHERE er.id = s."regulationId"), 8)`
		isSummerTerm := `(COALESCE(t."isSummer",0) = 1 OR t."termCode" ~ '3$')`
		probLastTerm := `COALESCE((SELECT CASE WHEN COALESCE(sts2."isProbation",0) = 1 THEN 1 ELSE 0 END FROM student_term_states sts2 WHERE sts2."studentId" = s.id ORDER BY sts2."termCode" DESC LIMIT 1), 0)`
		effMax := `(CASE WHEN ` + isSummerTerm + ` THEN ` + cfgSummerMax + ` WHEN ` + probLastTerm + ` = 1 THEN ` + cfgProbMax + ` ELSE ` + cfgMax + ` END)`
		effMin := `(CASE WHEN ` + isSummerTerm + ` THEN 0 ELSE ` + cfgMin + ` END)`
		unitsSum := `SUM(c.units)`
		violation := `CASE WHEN ` + unitsSum + ` > ` + effMax + ` THEN 'تخطی سقف' WHEN ` + unitsSum + ` < ` + effMin + ` THEN 'تخطی کف' END`
		conds := []string{`e.status IN ('REGISTERED','PENDING_COUNCIL')`}
		if f.Term != "" {
			args = append(args, f.Term)
			conds = append(conds, fmt.Sprintf(`t."termCode" = $%d`, len(args)))
		}
		conds = append(conds, studentWhere(f, &args))
		selectCols := `s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, t."termCode" AS term,
			` + unitsSum + `::float8 AS "unitsTaken", ` + effMin + `::int AS "min", ` + effMax + `::int AS "max", ` + violation + ` AS violation`
		having := unitsSum + ` > ` + effMax + ` OR ` + unitsSum + ` < ` + effMin
		rows, total, pages, err := s.pagedQueryHaving(ctx, selectCols,
			`FROM enrollments e JOIN course_offerings o ON o.id = e."offeringId" JOIN courses c ON c.id = o."courseId"
			 JOIN academic_terms t ON t.id = o."termId" JOIN students s ON s.id = e."studentId"
			 JOIN users u ON u.id = s."userId" LEFT JOIN majors m ON m.id = s."majorId"
			 LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"`,
			strings.Join(conds, " AND "),
			`s."studentCode", u."firstName", u."lastName", t."termCode", m.name, s.id, s."regulationId", t."isSummer", t."termCode"`,
			having, `ORDER BY term DESC, code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "term", Title: "ترم"},
			{Key: "unitsTaken", Title: "واحد اخذشده", Format: "NUMBER"}, {Key: "min", Title: "کف", Format: "NUMBER"},
			{Key: "max", Title: "سقف", Format: "NUMBER"}, {Key: "violation", Title: "نوع تخلف"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s مورد تخطی سقف/کف واحد (سقف و کف از آیین‌نامهٔ مقطع؛ فقط اخذهای جاری)", jalali.GroupThousands(float64(total)))}, nil

	case "repeated-courses":
		args := []any{}
		conds := []string{}
		if f.Term != "" {
			args = append(args, f.Term)
			conds = append(conds, fmt.Sprintf(`EXISTS (SELECT 1 FROM enrollments e2 JOIN course_offerings o2 ON o2.id = e2."offeringId" JOIN academic_terms t2 ON t2.id = o2."termId" WHERE e2."studentId" = s.id AND o2."courseId" = c.id AND t2."termCode" = $%d)`, len(args)))
		}
		conds = append(conds, studentWhere(f, &args))
		selectCols := `s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			c.code AS "courseCode", c.title AS "courseTitle",
			COUNT(*) FILTER (WHERE e.status <> 'DROPPED')::int AS attempts,
			MAX(e."gradeValue")::float8 AS "bestGrade"`
		rows, total, pages, err := s.pagedQueryHaving(ctx, selectCols,
			`FROM enrollments e JOIN course_offerings o ON o.id = e."offeringId" JOIN courses c ON c.id = o."courseId"
			 JOIN students s ON s.id = e."studentId" JOIN users u ON u.id = s."userId"
			 LEFT JOIN majors m ON m.id = s."majorId"`,
			strings.Join(conds, " AND "),
			`s."studentCode", u."firstName", u."lastName", m.name, c.code, c.title`,
			`COUNT(*) FILTER (WHERE e.status <> 'DROPPED') > 1`, `ORDER BY attempts DESC, code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "courseCode", Title: "کد درس"}, {Key: "courseTitle", Title: "نام درس"},
			{Key: "attempts", Title: "تعداد اخذ", Format: "NUMBER"}, {Key: "bestGrade", Title: "بهترین نمره", Format: "NUMBER"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s درس چندبار اخذشده (حذف‌شده‌ها شمرده نشدند)", jalali.GroupThousands(float64(total)))}, nil
	}
	return nil, nil
}
