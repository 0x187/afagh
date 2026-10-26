// ═══ آیین‌نامه و سقف واحد — پورت بخشی از regulations-engine.ts ═══
//
// فقط بخش‌های لازم برای انتخاب واحد (سقف/کف واحد، ترم آخر، ممتازی، مشروطی،
// سهمیه، واحدهای جبرانی) پورت شده‌اند؛ تجمیع معدل از بستهٔ gpa می‌آید تا
// دقیقاً همان ریاضی کارنامه باشد.
package enroll

import (
	"context"
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/gpa"
)

// TermRules قواعد ترم عادی.
type TermRules struct {
	MinUnits          float64
	MaxUnits          float64
	ProbationMaxUnits float64
	HonorsMinGPA      float64
	HonorsMaxUnits    float64
}

// SummerRules قواعد تابستان.
type SummerRules struct {
	DefaultMaxUnits    float64
	GraduatingMaxUnits float64
}

// GraduatingRules قواعد ترم آخر.
type GraduatingRules struct {
	CanTakeWithProbation bool
	MaxUnits             float64
}

// RuleConfig پیکربندی مؤثر آیین‌نامه.
type RuleConfig struct {
	Regular         TermRules
	Summer          SummerRules
	Graduating      GraduatingRules
	ProbationGPA    float64
	PassingGrade    float64
	RetakeMinGrade  float64
	Policy          string
	DedupeRepeated  bool
	RegulationLabel string
	// quota_overrides — فقط سقف تابستان سهمیه‌ها لازم است
	QuotaSummerMax map[string]float64
}

func defaultBachelor() RuleConfig {
	return RuleConfig{
		Regular:         TermRules{MinUnits: 12, MaxUnits: 20, ProbationMaxUnits: 14, HonorsMinGPA: 17, HonorsMaxUnits: 24},
		Summer:          SummerRules{DefaultMaxUnits: 6, GraduatingMaxUnits: 8},
		Graduating:      GraduatingRules{CanTakeWithProbation: true, MaxUnits: 24},
		ProbationGPA:    12,
		PassingGrade:    10,
		RetakeMinGrade:  10,
		Policy:          "EXCLUDE_IF_PASSED",
		RegulationLabel: "آیین‌نامه ۱۴۰۲",
		QuotaSummerMax:  map[string]float64{"SHAHED_ISARGAR": 8, "ELITE": 8},
	}
}

func num(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case string:
		var f float64
		if _, err := fmtSscan(n, &f); err == nil {
			return f, true
		}
	}
	return 0, false
}

func fmtSscan(s string, f *float64) (int, error) {
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0, err
	}
	*f = v
	return 1, nil
}

func mapAny(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

// applyRulesConfig پورت normalizeLegacyRegulationConfig + ادغام با پیش‌فرض.
func applyRulesConfig(cfg *RuleConfig, parsed map[string]any) {
	if parsed == nil {
		return
	}
	// نگاشت کلیدهای تخت قدیمی به grading_and_gpa
	if _, ok := parsed["grading_and_gpa"]; !ok {
		gpaMap := map[string]any{}
		if v, ok := parsed["failed_course_gpa_policy"].(string); ok {
			gpaMap["failed_course_gpa_policy"] = v
		}
		if v, ok := num(parsed["default_passing_grade"]); ok {
			gpaMap["default_passing_grade"] = v
		}
		if v, ok := num(parsed["retakeMinGrade"]); ok {
			gpaMap["retakeMinGrade"] = v
		}
		if len(gpaMap) > 0 {
			parsed["grading_and_gpa"] = gpaMap
		}
	}
	if g, ok := mapAny(parsed["grading_and_gpa"]); ok {
		if v, ok := g["failed_course_gpa_policy"].(string); ok && v != "" {
			cfg.Policy = v
		}
		if v, ok := num(g["default_passing_grade"]); ok && v > 0 {
			cfg.PassingGrade = v
			cfg.RetakeMinGrade = v
		}
		if v, ok := num(g["retakeMinGrade"]); ok {
			cfg.RetakeMinGrade = v
		}
		if v, ok := g["dedupeRepeatedCourses"].(bool); ok {
			cfg.DedupeRepeated = v
		}
		if v, ok := g["regulationLabel"].(string); ok && v != "" {
			cfg.RegulationLabel = v
		}
	}
	if r, ok := mapAny(parsed["regular_term_rules"]); ok {
		if v, ok := num(r["min_units"]); ok {
			cfg.Regular.MinUnits = v
		}
		if v, ok := num(r["max_units"]); ok {
			cfg.Regular.MaxUnits = v
		}
		if v, ok := num(r["probation_max_units"]); ok {
			cfg.Regular.ProbationMaxUnits = v
		}
		if v, ok := num(r["honors_min_gpa"]); ok {
			cfg.Regular.HonorsMinGPA = v
		}
		if v, ok := num(r["honors_max_units"]); ok {
			cfg.Regular.HonorsMaxUnits = v
		}
	}
	if s, ok := mapAny(parsed["summer_term_rules"]); ok {
		if v, ok := num(s["default_max_units"]); ok {
			cfg.Summer.DefaultMaxUnits = v
		}
		if v, ok := num(s["graduating_max_units"]); ok {
			cfg.Summer.GraduatingMaxUnits = v
		}
	}
	if g, ok := mapAny(parsed["graduating_term_rules"]); ok {
		if v, ok := g["can_take_with_probation"].(bool); ok {
			cfg.Graduating.CanTakeWithProbation = v
		}
		if v, ok := num(g["max_units"]); ok {
			cfg.Graduating.MaxUnits = v
		}
	}
	if p, ok := mapAny(parsed["probation_and_tenure"]); ok {
		if v, ok := num(p["probation_gpa_threshold"]); ok {
			cfg.ProbationGPA = v
		}
	} else if v, ok := num(parsed["probation_gpa_threshold"]); ok {
		cfg.ProbationGPA = v
	}
	if q, ok := mapAny(parsed["quota_overrides"]); ok {
		for quota, raw := range q {
			qm, okQ := mapAny(raw)
			if !okQ {
				continue
			}
			if sm, ok := mapAny(qm["summer_term_rules"]); ok {
				if v, ok := num(sm["default_max_units"]); ok {
					cfg.QuotaSummerMax[quota] = v
				}
			}
		}
	}
}

// LoadRegulationConfig پورت getRegulationConfig با اولویت آیین‌نامهٔ اختصاصی.
func LoadRegulationConfig(ctx context.Context, pool *pgxpool.Pool, regulationID, degreeLevelID *int64) RuleConfig {
	cfg := defaultBachelor()
	if regulationID == nil && degreeLevelID == nil {
		return cfg
	}
	var rows pgx.Rows
	var err error
	switch {
	case regulationID != nil && degreeLevelID != nil:
		rows, err = pool.Query(ctx, `
			select id, "degreeLevelId", "rulesConfig" from educational_regulations
			 where id = $1 or "degreeLevelId" = $2 limit 20`, *regulationID, *degreeLevelID)
	case regulationID != nil:
		rows, err = pool.Query(ctx, `
			select id, "degreeLevelId", "rulesConfig" from educational_regulations where id = $1 limit 20`, *regulationID)
	default:
		rows, err = pool.Query(ctx, `
			select id, "degreeLevelId", "rulesConfig" from educational_regulations where "degreeLevelId" = $1 limit 20`, *degreeLevelID)
	}
	if err != nil {
		return cfg
	}
	defer rows.Close()
	type reg struct {
		id  int64
		deg *int64
		raw string
	}
	list := []reg{}
	for rows.Next() {
		var r reg
		if err := rows.Scan(&r.id, &r.deg, &r.raw); err == nil {
			list = append(list, r)
		}
	}
	var preferred, fallback *reg
	for i := range list {
		if regulationID != nil && list[i].id == *regulationID {
			preferred = &list[i]
		}
		if degreeLevelID != nil && list[i].deg != nil && *list[i].deg == *degreeLevelID && fallback == nil {
			fallback = &list[i]
		}
	}
	for _, r := range []*reg{preferred, fallback} {
		if r == nil || strings.TrimSpace(r.raw) == "" {
			continue
		}
		var parsed map[string]any
		if err := json.Unmarshal([]byte(r.raw), &parsed); err != nil {
			continue
		}
		if _, ok := parsed["grading_and_gpa"]; !ok {
			// کلیدهای تخت را first-class نمی‌پذیریم مگر همان مسیر normalize
			applyRulesConfig(&cfg, parsed)
			continue
		}
		applyRulesConfig(&cfg, parsed)
		return cfg
	}
	return cfg
}

// AcademicSummary خلاصهٔ وضعیت تحصیلی.
type AcademicSummary struct {
	StudentID            int64
	TotalRequiredUnits   float64
	PassedUnits          float64
	RemainingUnits       float64
	IsGraduating         bool
	LastTermGPA          *float64
	IsProbatedLastTerm   bool
	TotalProbations      int
	CompletedSemesters   int
	EquivalenceUnits     float64
	EquivalenceSemesters int
	Status               string
	EffectiveMaxUnits    float64
	MinAllowedUnits      float64
	IsSummer             bool
	QuotaType            string
	IsHonors             bool
	HonorsSource         string
	CompensatoryUnits    float64
	BaseMaxUnits         float64
}

// EvaluateStudentRegulationStatus پورت evaluateStudentRegulationStatus.
func EvaluateStudentRegulationStatus(ctx context.Context, pool *pgxpool.Pool, studentID int64, termID *int64) (*AcademicSummary, error) {
	var (
		regulationID, degreeLevelID, majorID, universityID *int64
		entryYear                                          int
		entryTerm                                          *int
		status, quotaType                                  string
		honorsOverride                                     *int
		compensatory                                       *float64
	)
	err := pool.QueryRow(ctx, `
		select "regulationId", "degreeLevelId", "majorId", "universityId",
		       "entryYear", "entryTerm", status, coalesce("quotaType",''),
		       "honorsOverride", "compensatoryUnits"
		  from students where id = $1`, studentID).
		Scan(&regulationID, &degreeLevelID, &majorID, &universityID, &entryYear, &entryTerm,
			&status, &quotaType, &honorsOverride, &compensatory)
	if err != nil {
		return nil, err
	}
	_ = majorID
	_ = universityID

	var (
		termTitle string
		termCode  string
		termType  *string
		isSummer  int
	)
	q := `select title, "termCode", "termType", coalesce("isSummer",0) from academic_terms`
	args := []any{}
	if termID != nil {
		q += ` where id = $1`
		args = append(args, *termID)
	} else {
		q += ` where "isCurrent" = 1 order by id desc limit 1`
	}
	_ = pool.QueryRow(ctx, q, args...).Scan(&termTitle, &termCode, &termType, &isSummer)
	isSummerTerm := isSummer != 0

	cfg := LoadRegulationConfig(ctx, pool, regulationID, degreeLevelID)

	var passingGrade = cfg.PassingGrade
	if degreeLevelID != nil {
		var dpg float64
		if err := pool.QueryRow(ctx, `select coalesce("defaultPassingGrade",10) from degree_level_configs where id = $1`, *degreeLevelID).Scan(&dpg); err == nil && dpg > 0 {
			if cfg.PassingGrade == 10 {
				passingGrade = dpg
			}
		}
	}

	// نسخهٔ حل‌شدهٔ چارت برای مجموع واحد لازم.
	totalRequired := 140.0
	if degreeLevelID != nil {
		var degCode, degTitle string
		_ = pool.QueryRow(ctx, `select coalesce(code,''), coalesce(title,'') from degree_level_configs where id = $1`, *degreeLevelID).Scan(&degCode, &degTitle)
		if strings.Contains(strings.ToUpper(degCode), "MASTER") || strings.Contains(degTitle, "ارشد") {
			totalRequired = 32
		}
	}
	if ver, err := ResolveStudentCurriculum(ctx, pool, studentID); err == nil && ver != nil && ver.TotalRequiredUID > 0 {
		totalRequired = float64(ver.TotalRequiredUID)
	}

	// سوابق دروس.
	rows, err := pool.Query(ctx, `
		select e.id, e."gradeValue", e."gradeStatus", e.status,
		       o."termId", coalesce(t."termCode",''), coalesce(t."isSummer",0), coalesce(t.title,''),
		       coalesce(o."offeringType",''), c.units, c."gradingType", c."affectsGpa",
		       coalesce(c.code,'')
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  left join academic_terms t on t.id = o."termId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1`, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type termAcc struct {
		acc     *gpa.Accumulator
		isSum   bool
		isEquiv bool
		code    string
	}
	termMap := map[int64]*termAcc{}
	passedUnits := 0.0
	equivUnits := 0.0
	for rows.Next() {
		var (
			enID                          int64
			gradeVal                      *float64
			gradeStatus, enrollmentStatus *string
			tid                           *int64
			code, title, offeringType     string
			isSummerRow                   int
			units                         float64
			gradingType                   *string
			affectsGpa                    *int
			courseCode                    string
		)
		if err := rows.Scan(&enID, &gradeVal, &gradeStatus, &enrollmentStatus, &tid,
			&code, &isSummerRow, &title, &offeringType, &units, &gradingType, &affectsGpa, &courseCode); err != nil {
			return nil, err
		}
		_ = enID
		_ = courseCode
		if tid != nil {
			if _, ok := termMap[*tid]; !ok {
				codeUpper := strings.ToUpper(code)
				isSum := isSummerRow != 0 || strings.HasSuffix(code, "3") || strings.Contains(title, "تابستان")
				isEquiv := strings.HasSuffix(code, "5") || strings.Contains(codeUpper, "EQ") || strings.Contains(title, "معادل")
				termMap[*tid] = &termAcc{acc: &gpa.Accumulator{}, isSum: isSum, isEquiv: isEquiv, code: code}
			}
		}
		if gradeStatus == nil || *gradeStatus != "FINALIZED" || gradeVal == nil {
			continue
		}
		g := *gradeVal
		u := units
		isDescriptive := gradingType != nil && *gradingType == "DESCRIPTIVE"
		isPassed := (isDescriptive && g == 1) || (!isDescriptive && g >= passingGrade)
		if isPassed {
			passedUnits = round2(passedUnits + u)
		}
		isEquivalence := (enrollmentStatus != nil && *enrollmentStatus == "EQUIV_PASSED") || offeringType == "TRANSFER"
		if isEquivalence && isPassed {
			equivUnits = round2(equivUnits + u)
		}
		if !isEquivalence && tid != nil && (affectsGpa == nil || *affectsGpa == 1) && !isDescriptive {
			termMap[*tid].acc.Add(g, u)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	remaining := math.Max(0, totalRequired-passedUnits)
	isGraduating := remaining <= cfg.Graduating.MaxUnits
	if isSummerTerm {
		isGraduating = remaining <= cfg.Summer.GraduatingMaxUnits
	}

	// مرتب‌سازی شناسهٔ ترم‌ها نزولی (مثل TS).
	termIDs := make([]int64, 0, len(termMap))
	for id := range termMap {
		termIDs = append(termIDs, id)
	}
	sortInt64Desc(termIDs)

	var lastTermGPA *float64
	if len(termIDs) > 0 {
		lastTermGPA = termMap[termIDs[0]].acc.Rounded()
	}

	totalProbations := 0
	for _, id := range termIDs {
		meta := termMap[id]
		if meta.isSum || meta.isEquiv {
			continue
		}
		if exact := meta.acc.Exact(); exact != nil && *exact < cfg.ProbationGPA {
			totalProbations++
		}
	}

	regularIDs := []int64{}
	for _, id := range termIDs {
		meta := termMap[id]
		if !meta.isSum && !meta.isEquiv {
			regularIDs = append(regularIDs, id)
		}
	}
	var relevantLast *float64
	if isSummerTerm {
		if len(termIDs) > 0 {
			relevantLast = termMap[termIDs[0]].acc.Exact()
		}
	} else if len(regularIDs) > 0 {
		relevantLast = termMap[regularIDs[0]].acc.Exact()
	}
	isProbatedLast := relevantLast != nil && *relevantLast < cfg.ProbationGPA
	isHonorsAuto := relevantLast != nil && *relevantLast >= cfg.Regular.HonorsMinGPA
	honorsSource := "AUTO"
	isHonors := isHonorsAuto
	if honorsOverride != nil {
		honorsSource = "OVERRIDE"
		isHonors = *honorsOverride == 1
	}

	comp := 0.0
	if compensatory != nil && *compensatory > 0 {
		comp = *compensatory
	}

	effectiveMax := cfg.Regular.MaxUnits
	minAllowed := cfg.Regular.MinUnits
	if isSummerTerm {
		minAllowed = 0
		effectiveMax = cfg.Summer.DefaultMaxUnits
		if isGraduating {
			effectiveMax = cfg.Summer.GraduatingMaxUnits
		}
		if v, ok := cfg.QuotaSummerMax[quotaType]; ok && v > effectiveMax {
			effectiveMax = v
		}
	} else {
		if isGraduating && cfg.Graduating.CanTakeWithProbation {
			effectiveMax = cfg.Graduating.MaxUnits
			minAllowed = 0
		} else if isProbatedLast {
			effectiveMax = cfg.Regular.ProbationMaxUnits
		} else if isHonors {
			effectiveMax = cfg.Regular.HonorsMaxUnits
		}
	}
	if isGraduating {
		minAllowed = 0
	}
	baseMax := effectiveMax
	if !isSummerTerm && comp > 0 {
		effectiveMax += comp
	}

	summary := &AcademicSummary{
		StudentID:            studentID,
		TotalRequiredUnits:   totalRequired,
		PassedUnits:          passedUnits,
		RemainingUnits:       remaining,
		IsGraduating:         isGraduating,
		LastTermGPA:          lastTermGPA,
		IsProbatedLastTerm:   isProbatedLast,
		TotalProbations:      totalProbations,
		CompletedSemesters:   len(termMap),
		EquivalenceUnits:     equivUnits,
		EquivalenceSemesters: int(math.Floor(equivUnits / EquivSemesterUnits)),
		Status:               status,
		EffectiveMaxUnits:    effectiveMax,
		MinAllowedUnits:      minAllowed,
		IsSummer:             isSummerTerm,
		QuotaType:            quotaType,
		IsHonors:             isHonors,
		HonorsSource:         honorsSource,
		CompensatoryUnits:    comp,
		BaseMaxUnits:         baseMax,
	}
	return summary, nil
}

func round2(v float64) float64 { return math.Round((v+1e-9)*100) / 100 }

func sortInt64Desc(v []int64) {
	for i := 1; i < len(v); i++ {
		for j := i; j > 0 && v[j] > v[j-1]; j-- {
			v[j], v[j-1] = v[j-1], v[j]
		}
	}
}
