// ═══ Prerequisite/corequisite — port of enroll-engine/prereqs.ts + equivalence-expand.ts ═══
package enroll

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LogicCondition one condition in the logic tree.
type LogicCondition struct {
	Course     *string          `json:"course,omitempty"`
	MinGrade   *float64         `json:"minGrade,omitempty"`
	Operator   string           `json:"operator,omitempty"`
	Conditions []LogicCondition `json:"conditions,omitempty"`
}

// EvaluateLogicTree port of evaluateLogicTree — nested AND/OR.
func EvaluateLogicTree(node *LogicCondition, passed map[string]float64) (bool, []string) {
	if node == nil {
		return true, nil
	}
	type res struct {
		ok      bool
		missing []string
	}
	results := make([]res, 0, len(node.Conditions))
	for i := range node.Conditions {
		c := &node.Conditions[i]
		if c.Course != nil {
			grade, ok := passed[*c.Course]
			pass := ok && (c.MinGrade == nil || grade >= *c.MinGrade)
			r := res{ok: pass}
			if !pass {
				r.missing = []string{*c.Course}
			}
			results = append(results, r)
			continue
		}
		if c.Operator != "" {
			ok, missing := EvaluateLogicTree(c, passed)
			results = append(results, res{ok: ok, missing: missing})
			continue
		}
		results = append(results, res{ok: true})
	}
	op := node.Operator
	if op == "" {
		op = "AND"
	}
	if op == "OR" {
		any := false
		allMissing := true
		missing := []string{}
		for _, r := range results {
			if r.ok {
				any = true
			}
			if r.ok {
				allMissing = false
			}
			missing = append(missing, r.missing...)
		}
		if any {
			return true, nil
		}
		if allMissing {
			return false, missing
		}
		return false, nil
	}
	all := true
	missing := []string{}
	for _, r := range results {
		if !r.ok {
			all = false
			missing = append(missing, r.missing...)
		}
	}
	return all, missing
}

// FormatPrereq port of formatPrereq — human-readable label for the UI.
func FormatPrereq(node *LogicCondition, titles map[string]string) string {
	if node == nil || len(node.Conditions) == 0 {
		return ""
	}
	joiner := " و "
	if node.Operator == "OR" {
		joiner = " یا "
	}
	parts := []string{}
	for i := range node.Conditions {
		c := &node.Conditions[i]
		if c.Course != nil {
			if t, ok := titles[*c.Course]; ok && t != "" {
				parts = append(parts, t)
			} else {
				parts = append(parts, *c.Course)
			}
			continue
		}
		if c.Operator != "" {
			if inner := FormatPrereq(c, titles); inner != "" {
				parts = append(parts, "("+inner+")")
			}
		}
	}
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += joiner
		}
		out += p
	}
	return out
}

// PrereqContext student prerequisite context.
type PrereqContext struct {
	Passed         map[string]float64
	RuleByCourse   map[int64]*LogicCondition
	Titles         map[string]string
	DefaultPassing float64
}

// BuildPrereqContext port of buildPrereqContext.
func BuildPrereqContext(ctx context.Context, pool *pgxpool.Pool, studentID int64) (*PrereqContext, error) {
	var degreeLevelID *int64
	_ = pool.QueryRow(ctx, `select "degreeLevelId" from students where id = $1`, studentID).Scan(&degreeLevelID)
	defaultPassing := 10.0
	if degreeLevelID != nil {
		var v float64
		if err := pool.QueryRow(ctx, `select coalesce("defaultPassingGrade",10) from degree_level_configs where id = $1`, *degreeLevelID).Scan(&v); err == nil && v > 0 {
			defaultPassing = v
		}
	}

	// Rules: passing-grade override + logic tree.
	rows, err := pool.Query(ctx, `
		select "courseId", "syllabusId", "ruleType", coalesce("logicTree",''),
		       "customPassingGrade"
		  from course_rules`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type rule struct {
		courseID   int64
		syllabusID *int64
		ruleType   string
		tree       string
		custom     *float64
	}
	allRules := []rule{}
	for rows.Next() {
		var r rule
		if err := rows.Scan(&r.courseID, &r.syllabusID, &r.ruleType, &r.tree, &r.custom); err != nil {
			return nil, err
		}
		allRules = append(allRules, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	overrides := map[int64]float64{}
	for _, r := range allRules {
		if r.custom != nil {
			if _, ok := overrides[r.courseID]; !ok {
				overrides[r.courseID] = *r.custom
			}
		}
	}

	resolvedVersion, err := ResolveStudentCurriculum(ctx, pool, studentID)
	if err != nil {
		return nil, err
	}
	var versionID *int64
	if resolvedVersion != nil {
		versionID = &resolvedVersion.ID
	}

	globalRule := map[int64]*LogicCondition{}
	scopedRule := map[int64]*LogicCondition{}
	for _, r := range allRules {
		if r.ruleType != "PREREQ" || r.tree == "" {
			continue
		}
		var node LogicCondition
		if err := json.Unmarshal([]byte(r.tree), &node); err != nil {
			continue
		}
		if r.syllabusID == nil {
			if _, ok := globalRule[r.courseID]; !ok {
				cp := node
				globalRule[r.courseID] = &cp
			}
		} else if versionID != nil && *r.syllabusID == *versionID {
			if _, ok := scopedRule[r.courseID]; !ok {
				cp := node
				scopedRule[r.courseID] = &cp
			}
		}
	}
	ruleByCourse := map[int64]*LogicCondition{}
	for k, v := range globalRule {
		ruleByCourse[k] = v
	}
	for k, v := range scopedRule {
		ruleByCourse[k] = v
	}

	// Passed courses.
	prows, err := pool.Query(ctx, `
		select c.code, c.id, e."gradeValue", e."gradeStatus", c."gradingType"
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1`, studentID)
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	passed := map[string]float64{}
	for prows.Next() {
		var code string
		var courseID int64
		var grade *float64
		var gradeStatus, gradingType *string
		if err := prows.Scan(&code, &courseID, &grade, &gradeStatus, &gradingType); err != nil {
			return nil, err
		}
		if gradeStatus == nil || *gradeStatus != "FINALIZED" || grade == nil {
			continue
		}
		passing := defaultPassing
		if v, ok := overrides[courseID]; ok {
			passing = v
		}
		ok := false
		if gradingType != nil && *gradingType == "DESCRIPTIVE" {
			ok = *grade == 1
		} else {
			ok = *grade >= passing
		}
		if ok && (!hasKey(passed, code) || passed[code] < *grade) {
			passed[code] = *grade
		}
	}
	if err := prows.Err(); err != nil {
		return nil, err
	}

	// Titles + equivalent-cluster members.
	crows, err := pool.Query(ctx, `select coalesce(code,''), coalesce(title,''), "clusterId" from courses`)
	if err != nil {
		return nil, err
	}
	defer crows.Close()
	titles := map[string]string{}
	members := []equivalenceMember{}
	for crows.Next() {
		var code, title string
		var clusterID *int64
		if err := crows.Scan(&code, &title, &clusterID); err != nil {
			return nil, err
		}
		titles[code] = title
		if clusterID != nil {
			members = append(members, equivalenceMember{clusterCode: *clusterID, code: code})
		}
	}
	if err := crows.Err(); err != nil {
		return nil, err
	}

	return &PrereqContext{
		Passed:         expandPassedWithEquivalents(passed, members),
		RuleByCourse:   ruleByCourse,
		Titles:         titles,
		DefaultPassing: defaultPassing,
	}, nil
}

func hasKey(m map[string]float64, k string) bool {
	_, ok := m[k]
	return ok
}

// expandPassedWithEquivalents port of equivalence-expand.ts.
type equivalenceMember struct {
	clusterCode int64
	code        string
}

func expandPassedWithEquivalents(passed map[string]float64, members []equivalenceMember) map[string]float64 {
	groups := map[int64][]string{}
	for _, m := range members {
		groups[m.clusterCode] = append(groups[m.clusterCode], m.code)
	}
	out := map[string]float64{}
	for k, v := range passed {
		out[k] = v
	}
	for _, codes := range groups {
		if len(codes) < 2 {
			continue
		}
		var best *float64
		for _, code := range codes {
			if g, ok := out[code]; ok && (best == nil || g > *best) {
				v := g
				best = &v
			}
		}
		if best == nil {
			continue
		}
		for _, code := range codes {
			if g, ok := out[code]; ok && g >= *best {
				continue
			}
			out[code] = *best
		}
	}
	return out
}
