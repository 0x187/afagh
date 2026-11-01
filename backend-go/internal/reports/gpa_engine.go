// ═══ Official GPA engine for reports — port of regulations-engine (GPA part) ═══
package reports

import (
	"context"
	"encoding/json"
	"sort"

	"backend-go/internal/enroll"
	"backend-go/internal/gpa"
)

type gpaRow struct {
	SID       int64
	Code      string
	Units     any
	Grade     any
	Status    *string
	Sama      *string
	Grading   *string
	Affects   *int
	MinMark   any
	TermID    *int64
	TermCode  string
	TermTitle string
}

type gpaRegCfg struct {
	PassingGrade   float64
	RetakeMinGrade float64
	Policy         string
	Dedupe         bool
	ProbThreshold  float64
}

func defaultGPACfg() gpaRegCfg {
	return gpaRegCfg{PassingGrade: 10, RetakeMinGrade: 10, Policy: "EXCLUDE_IF_PASSED", ProbThreshold: 12}
}

// gpaCfgsFor resolves each student's regulation (cached per unique pair).
func gpaCfgsFor(ctx context.Context, s *Service, sids []int64) (map[int64]gpaRegCfg, map[int64][2]*int64, error) {
	out := map[int64]gpaRegCfg{}
	pairs := map[int64][2]*int64{}
	if len(sids) == 0 {
		return out, pairs, nil
	}
	rows, err := s.Pool.Query(ctx, `select id, "regulationId", "degreeLevelId" from students where id = any($1)`, sids)
	if err != nil {
		return out, pairs, err
	}
	defer rows.Close()
	pairCfg := map[string]gpaRegCfg{}
	for rows.Next() {
		var sid int64
		var reg, deg *int64
		if err := rows.Scan(&sid, &reg, &deg); err != nil {
			continue
		}
		pairs[sid] = [2]*int64{reg, deg}
		key := gpaPairKey(reg, deg)
		if _, ok := pairCfg[key]; !ok {
			cfg := enroll.LoadRegulationConfig(ctx, s.Pool, reg, deg)
			g := defaultGPACfg()
			g.PassingGrade = cfg.PassingGrade
			g.RetakeMinGrade = cfg.RetakeMinGrade
			if cfg.Policy != "" {
				g.Policy = cfg.Policy
			}
			g.Dedupe = cfg.DedupeRepeated
			if cfg.ProbationGPA > 0 {
				g.ProbThreshold = cfg.ProbationGPA
			}
			pairCfg[key] = g
		}
	}
	for sid, pair := range pairs {
		if c, ok := pairCfg[gpaPairKey(pair[0], pair[1])]; ok {
			out[sid] = c
		} else {
			out[sid] = defaultGPACfg()
		}
	}
	return out, pairs, nil
}

func gpaPairKey(reg, deg *int64) string {
	a, b := int64(0), int64(0)
	if reg != nil {
		a = *reg
	}
	if deg != nil {
		b = *deg
	}
	return itoa64(a) + ":" + itoa64(b)
}

func itoa64(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// loadGpaRowsBatch loads GPA rows for all students + legacy system fallback.
func (s *Service) loadGpaRowsBatch(ctx context.Context, sids []int64) (map[int64][]gpaRow, error) {
	out := map[int64][]gpaRow{}
	if len(sids) == 0 {
		return out, nil
	}
	rows, err := s.Pool.Query(ctx, `
		select e."studentId"::bigint, c.code, c.units::float8, e."gradeValue"::float8, e."gradeStatus",
		       e."samaGradeStatusCode", c."gradingType", c."affectsGpa", c."minPassedMark"::float8,
		       o."termId", coalesce(t."termCode",''), coalesce(t.title,'')
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		  left join academic_terms t on t.id = o."termId"
		 where e."studentId" = any($1)
		   and e."gradeStatus" in ('FINALIZED','EXEMPT','PASSED_NO_GRADE')`, sids)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var sid int64
		var code string
		var units, grade, minMark *float64
		var status, sama, grading *string
		var affects *int
		var termID *int64
		var termCode, termTitle string
		if err := rows.Scan(&sid, &code, &units, &grade, &status, &sama, &grading, &affects, &minMark, &termID, &termCode, &termTitle); err == nil {
			out[sid] = append(out[sid], gpaRow{SID: sid, Code: code, Units: f64Any(units), Grade: f64Any(grade),
				Status: status, Sama: sama, Grading: grading, Affects: affects, MinMark: f64Any(minMark),
				TermID: termID, TermCode: termCode, TermTitle: termTitle})
		}
	}
	rows.Close()

	// Legacy system — only courses whose equivalent is not in enrollments.
	lrows, err := s.Pool.Query(ctx, `
		select * from (
		  select st.id::bigint as sid, lg."courseCode" as code,
		         case when coalesce(lg.units,0) > 0 then lg.units else cat.units end as units,
		         lg."gradeValue" as grade, lg."gradeStatus" as status, lg.raw,
		         cat."gradingType" as grading, coalesce(cat."affectsGpa",1) as affects,
		         cat."minPassedMark" as minmark, lg."termCode" as termcode,
		         row_number() over (partition by st.id order by lg."termCode", lg."courseCode") as rn
		    from legacy_grades lg
		    join students st on st."studentCode" = lg."studentCode"
		    left join universities un on un.id = st."universityId"
		    left join lateral (
		      select units, "minPassedMark", "gradingType", "affectsGpa"
		        from courses c where c.code = lg."courseCode" order by c.id limit 1
		    ) cat on true
		   where st.id = any($1) and upper(un.code) ~ '^[A-Z0-9_-]{2,50}$' and lg."sourceCode" = upper(un.code)
		) x where x.rn <= 500`, sids)
	if err != nil {
		return out, nil
	}
	defer lrows.Close()
	for lrows.Next() {
		var sid int64
		var code string
		var units, grade, minMark *float64
		var affects *float64
		var status *string
		var raw *string
		var grading *string
		var termCode string
		if err := lrows.Scan(&sid, &code, &units, &grade, &status, &raw, &grading, &affects, &minMark, &termCode); err != nil {
			continue
		}
		var sama *string
		if raw != nil && *raw != "" {
			var parsed map[string]any
			if json.Unmarshal([]byte(*raw), &parsed) == nil {
				if v, ok := parsed["markStat"]; ok && v != nil {
					if sv, ok := v.(string); ok && sv != "" {
						sama = &sv
					}
				}
			}
		}
		var affectsI *int
		if affects != nil {
			n := int(*affects)
			affectsI = &n
		}
		covered := map[string]bool{}
		for _, r := range out[sid] {
			covered[r.TermCode+"|"+r.Code] = true
		}
		if covered[termCode+"|"+code] {
			continue
		}
		out[sid] = append(out[sid], gpaRow{SID: sid, Code: code, Units: f64Any(units), Grade: f64Any(grade),
			Status: status, Sama: sama, Grading: grading, Affects: affectsI, MinMark: f64Any(minMark), TermCode: termCode})
	}
	return out, nil
}

func f64Any(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

func gpaEngineInput(cfg gpaRegCfg) gpa.OfficialInput {
	return gpa.OfficialInput{PassingGrade: cfg.PassingGrade, RetakeMinGrade: cfg.RetakeMinGrade, Policy: cfg.Policy, DedupeRepeated: cfg.Dedupe}
}

func gpaRowsOf(rows []gpaRow) []gpa.Row {
	out := make([]gpa.Row, 0, len(rows))
	for _, r := range rows {
		out = append(out, gpa.Row{Code: r.Code, Units: r.Units, GradeValue: r.Grade, GradeStatus: r.Status,
			SamaGradeStatusCode: r.Sama, GradingType: r.Grading, AffectsGpa: r.Affects, CourseMinMark: r.MinMark})
	}
	return out
}

type officialTermRow struct {
	TermID   *int64
	TermCode string
	Title    string
	GPA      *float64
	Units    float64
	Passed   float64
	IsProb   bool
}

// officialBreakdown is the official term-by-term GPA (sorted by termCode).
func officialBreakdown(rows []gpaRow, cfg gpaRegCfg) []officialTermRow {
	groups := map[string][]gpaRow{}
	order := []string{}
	meta := map[string]gpaRow{}
	for _, r := range rows {
		key := r.TermCode
		if key == "" {
			key = "?"
		}
		if _, ok := groups[key]; !ok {
			order = append(order, key)
			meta[key] = r
		}
		groups[key] = append(groups[key], r)
	}
	sort.SliceStable(order, func(i, j int) bool { return order[i] < order[j] })
	out := []officialTermRow{}
	for _, key := range order {
		c := gpa.AggregateOfficialGpaRows(gpaRowsOf(groups[key]), gpaEngineInput(cfg))
		var gp *float64
		if c.TotalUnits > 0 {
			v := c.GPA
			gp = &v
		}
		out = append(out, officialTermRow{
			TermID: meta[key].TermID, TermCode: meta[key].TermCode, Title: meta[key].TermTitle,
			GPA: gp, Units: c.TotalUnits, Passed: c.PassedUnits,
			IsProb: c.TotalUnits > 0 && c.GPA < cfg.ProbThreshold,
		})
	}
	return out
}
