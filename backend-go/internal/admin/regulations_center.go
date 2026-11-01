// ═══ Center for Management and Control of Educational Regulations — port of admin/regulations in Next ═══
//
// Faithful port of afagh-next/src/app/admin/regulations/{page.tsx,actions.ts} and
// afagh-next/src/lib/regulations-types.ts (presets).
//
// Data source: educational_regulations (rulesConfig = textual JSON) and
// degree_level_configs. Regulations with universityId=null are global and
// those with universityId=<active university> are university-specific; both appear in the list.
//
// "Activation": in the Next reference there is no separate operation named activation;
// the active version of each item is determined by its validity year range (effectiveFromYear/effectiveToYear)
// — the same behavior is preserved here.
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"

	"backend-go/internal/session"
)

// ── Configuration types (port of RegulationConfig from regulations-types.ts) ──

// RegulationLevelOverride semester/yearly (SHORT/LONG) level differences.
type RegulationLevelOverride struct {
	MinUnits                 *float64 `json:"min_units,omitempty"`
	MaxConsecutiveProbations *float64 `json:"max_consecutive_probations,omitempty"`
	MaxTotalProbations       *float64 `json:"max_total_probations,omitempty"`
	MaxStudySemesters        *float64 `json:"max_study_semesters,omitempty"`
}

// RegulationRegularTermRules regular semester rules.
type RegulationRegularTermRules struct {
	MinUnits          float64 `json:"min_units"`
	MaxUnits          float64 `json:"max_units"`
	ProbationMaxUnits float64 `json:"probation_max_units"`
	HonorsMinGPA      float64 `json:"honors_min_gpa"`
	HonorsMaxUnits    float64 `json:"honors_max_units"`
}

// RegulationSummerTermRules summer semester rules.
type RegulationSummerTermRules struct {
	DefaultMaxUnits    float64 `json:"default_max_units"`
	GraduatingMaxUnits float64 `json:"graduating_max_units"`
}

// RegulationGraduatingTermRules final-semester facilities.
type RegulationGraduatingTermRules struct {
	CanTakeWithProbation   bool    `json:"can_take_with_probation"`
	MaxUnits               float64 `json:"max_units"`
	AutoCorequisiteAllowed bool    `json:"auto_corequisite_allowed"`
}

// RegulationProbationAndTenure probation and tenure.
type RegulationProbationAndTenure struct {
	ProbationGpaThreshold    float64 `json:"probation_gpa_threshold"`
	MaxConsecutiveProbations float64 `json:"max_consecutive_probations"`
	MaxTotalProbations       float64 `json:"max_total_probations"`
	MaxStudySemesters        float64 `json:"max_study_semesters"`
}

// RegulationGradingAndGpa grading policy and dropping a failed grade after passing.
type RegulationGradingAndGpa struct {
	FailedCourseGpaPolicy string   `json:"failed_course_gpa_policy"` // EXCLUDE_IF_PASSED | EXCLUDE_IF_PASSED_1391 | KEEP_ALWAYS
	DefaultPassingGrade   float64  `json:"default_passing_grade"`
	RetakeMinGrade        *float64 `json:"retakeMinGrade,omitempty"`
	RegulationLabel       *string  `json:"regulationLabel,omitempty"`
	FailedSamaStatusCode  *string  `json:"failed_sama_status_code,omitempty"`
	DedupeRepeatedCourses *bool    `json:"dedupeRepeatedCourses,omitempty"`
}

// RegulationQuotaOverride overrides for special quotas (SHAHED_ISARGAR and …).
type RegulationQuotaOverride struct {
	SummerTermRules *struct {
		DefaultMaxUnits *float64 `json:"default_max_units,omitempty"`
	} `json:"summer_term_rules,omitempty"`
	ProbationMaxUnits     *float64 `json:"probation_max_units,omitempty"`
	ExtraAllowedSemesters *float64 `json:"extra_allowed_semesters,omitempty"`
}

// RegulationConfig full configuration of a regulation — rulesConfig JSON structure.
type RegulationConfig struct {
	Levels              map[string]RegulationLevelOverride `json:"levels,omitempty"`
	RegularTermRules    RegulationRegularTermRules         `json:"regular_term_rules"`
	SummerTermRules     RegulationSummerTermRules          `json:"summer_term_rules"`
	GraduatingTermRules RegulationGraduatingTermRules      `json:"graduating_term_rules"`
	ProbationAndTenure  RegulationProbationAndTenure       `json:"probation_and_tenure"`
	GradingAndGpa       RegulationGradingAndGpa            `json:"grading_and_gpa"`
	QuotaOverrides      map[string]RegulationQuotaOverride `json:"quota_overrides,omitempty"`
}

func regFloat(v float64) *float64 { return &v }

// ── Presets (port of DEFAULT_* and REGULATION_PRESETS from regulations-types.ts) ──

func regulationPresetBachelor1403() RegulationConfig {
	return RegulationConfig{
		RegularTermRules:    RegulationRegularTermRules{MinUnits: 12, MaxUnits: 20, ProbationMaxUnits: 14, HonorsMinGPA: 17.0, HonorsMaxUnits: 24},
		SummerTermRules:     RegulationSummerTermRules{DefaultMaxUnits: 6, GraduatingMaxUnits: 8},
		GraduatingTermRules: RegulationGraduatingTermRules{CanTakeWithProbation: true, MaxUnits: 24, AutoCorequisiteAllowed: true},
		ProbationAndTenure:  RegulationProbationAndTenure{ProbationGpaThreshold: 12.0, MaxConsecutiveProbations: 3, MaxTotalProbations: 4, MaxStudySemesters: 8},
		GradingAndGpa:       RegulationGradingAndGpa{FailedCourseGpaPolicy: "EXCLUDE_IF_PASSED", DefaultPassingGrade: 10.0, RegulationLabel: strPtr("آیین‌نامه ۱۴۰۲")},
		QuotaOverrides: map[string]RegulationQuotaOverride{
			"SHAHED_ISARGAR": {
				SummerTermRules: &struct {
					DefaultMaxUnits *float64 `json:"default_max_units,omitempty"`
				}{DefaultMaxUnits: regFloat(8)},
				ProbationMaxUnits:     regFloat(14),
				ExtraAllowedSemesters: regFloat(2),
			},
			"ELITE": {
				SummerTermRules: &struct {
					DefaultMaxUnits *float64 `json:"default_max_units,omitempty"`
				}{DefaultMaxUnits: regFloat(8)},
			},
		},
	}
}

func regulationPresetBachelor1390() RegulationConfig {
	return RegulationConfig{
		RegularTermRules:    RegulationRegularTermRules{MinUnits: 12, MaxUnits: 20, ProbationMaxUnits: 14, HonorsMinGPA: 17.0, HonorsMaxUnits: 24},
		SummerTermRules:     RegulationSummerTermRules{DefaultMaxUnits: 6, GraduatingMaxUnits: 8},
		GraduatingTermRules: RegulationGraduatingTermRules{CanTakeWithProbation: false, MaxUnits: 20, AutoCorequisiteAllowed: false},
		ProbationAndTenure:  RegulationProbationAndTenure{ProbationGpaThreshold: 12.0, MaxConsecutiveProbations: 3, MaxTotalProbations: 4, MaxStudySemesters: 10},
		GradingAndGpa:       RegulationGradingAndGpa{FailedCourseGpaPolicy: "KEEP_ALWAYS", DefaultPassingGrade: 10.0, RegulationLabel: strPtr("آیین‌نامه ماقبل ۱۳۹۱")},
		QuotaOverrides: map[string]RegulationQuotaOverride{
			"SHAHED_ISARGAR": {
				SummerTermRules: &struct {
					DefaultMaxUnits *float64 `json:"default_max_units,omitempty"`
				}{DefaultMaxUnits: regFloat(8)},
			},
		},
	}
}

func regulationPresetMaster1403() RegulationConfig {
	return RegulationConfig{
		RegularTermRules:    RegulationRegularTermRules{MinUnits: 8, MaxUnits: 14, ProbationMaxUnits: 10, HonorsMinGPA: 17.0, HonorsMaxUnits: 16},
		SummerTermRules:     RegulationSummerTermRules{DefaultMaxUnits: 4, GraduatingMaxUnits: 6},
		GraduatingTermRules: RegulationGraduatingTermRules{CanTakeWithProbation: true, MaxUnits: 14, AutoCorequisiteAllowed: true},
		ProbationAndTenure:  RegulationProbationAndTenure{ProbationGpaThreshold: 14.0, MaxConsecutiveProbations: 2, MaxTotalProbations: 2, MaxStudySemesters: 4},
		GradingAndGpa:       RegulationGradingAndGpa{FailedCourseGpaPolicy: "EXCLUDE_IF_PASSED", DefaultPassingGrade: 12.0, RetakeMinGrade: regFloat(12), RegulationLabel: strPtr("آیین‌نامه ۱۳۹۴ ارشد")},
	}
}

// regulationPreset1402 educational regulations of 1402 and later (associate/bachelor).
func regulationPreset1402() RegulationConfig {
	return RegulationConfig{
		Levels: map[string]RegulationLevelOverride{
			"SHORT": {MaxConsecutiveProbations: regFloat(2), MaxTotalProbations: regFloat(2), MaxStudySemesters: regFloat(4)},
			"LONG":  {MaxConsecutiveProbations: regFloat(3), MaxTotalProbations: regFloat(3), MaxStudySemesters: regFloat(8)},
		},
		RegularTermRules:    RegulationRegularTermRules{MinUnits: 12, MaxUnits: 20, ProbationMaxUnits: 14, HonorsMinGPA: 17.0, HonorsMaxUnits: 24},
		SummerTermRules:     RegulationSummerTermRules{DefaultMaxUnits: 6, GraduatingMaxUnits: 8},
		GraduatingTermRules: RegulationGraduatingTermRules{CanTakeWithProbation: true, MaxUnits: 24, AutoCorequisiteAllowed: true},
		ProbationAndTenure:  RegulationProbationAndTenure{ProbationGpaThreshold: 12.0, MaxConsecutiveProbations: 3, MaxTotalProbations: 3, MaxStudySemesters: 8},
		GradingAndGpa:       RegulationGradingAndGpa{FailedCourseGpaPolicy: "EXCLUDE_IF_PASSED", DefaultPassingGrade: 10.0, RetakeMinGrade: regFloat(10), RegulationLabel: strPtr("آیین‌نامه ۱۴۰۲")},
	}
}

// regulationPreset1393 regulations approved on 93/7/28 (Sama codes 93/94/914/915).
func regulationPreset1393() RegulationConfig {
	return RegulationConfig{
		Levels: map[string]RegulationLevelOverride{
			"SHORT": {MaxConsecutiveProbations: regFloat(2), MaxTotalProbations: regFloat(2), MaxStudySemesters: regFloat(4)},
			"LONG":  {MaxConsecutiveProbations: regFloat(3), MaxTotalProbations: regFloat(3), MaxStudySemesters: regFloat(8)},
		},
		RegularTermRules:    RegulationRegularTermRules{MinUnits: 12, MaxUnits: 20, ProbationMaxUnits: 14, HonorsMinGPA: 17.0, HonorsMaxUnits: 24},
		SummerTermRules:     RegulationSummerTermRules{DefaultMaxUnits: 6, GraduatingMaxUnits: 8},
		GraduatingTermRules: RegulationGraduatingTermRules{CanTakeWithProbation: true, MaxUnits: 24, AutoCorequisiteAllowed: true},
		ProbationAndTenure:  RegulationProbationAndTenure{ProbationGpaThreshold: 12.0, MaxConsecutiveProbations: 3, MaxTotalProbations: 3, MaxStudySemesters: 8},
		GradingAndGpa:       RegulationGradingAndGpa{FailedCourseGpaPolicy: "EXCLUDE_IF_PASSED", DefaultPassingGrade: 10.0, RetakeMinGrade: regFloat(10), RegulationLabel: strPtr("آیین‌نامه ۱۳۹۳")},
	}
}

// regulationPreset1391 letter 138715 dated 91/7/22 — 1391 note (drop with 14+).
func regulationPreset1391() RegulationConfig {
	return RegulationConfig{
		Levels: map[string]RegulationLevelOverride{
			"SHORT": {MinUnits: regFloat(14), MaxConsecutiveProbations: regFloat(2), MaxTotalProbations: regFloat(2), MaxStudySemesters: regFloat(5)},
			"LONG":  {MinUnits: regFloat(14), MaxConsecutiveProbations: regFloat(3), MaxTotalProbations: regFloat(3), MaxStudySemesters: regFloat(10)},
		},
		RegularTermRules:    RegulationRegularTermRules{MinUnits: 14, MaxUnits: 20, ProbationMaxUnits: 14, HonorsMinGPA: 17.0, HonorsMaxUnits: 24},
		SummerTermRules:     RegulationSummerTermRules{DefaultMaxUnits: 6, GraduatingMaxUnits: 8},
		GraduatingTermRules: RegulationGraduatingTermRules{CanTakeWithProbation: true, MaxUnits: 24, AutoCorequisiteAllowed: true},
		ProbationAndTenure:  RegulationProbationAndTenure{ProbationGpaThreshold: 12.0, MaxConsecutiveProbations: 3, MaxTotalProbations: 3, MaxStudySemesters: 10},
		GradingAndGpa:       RegulationGradingAndGpa{FailedCourseGpaPolicy: "EXCLUDE_IF_PASSED_1391", DefaultPassingGrade: 10.0, RetakeMinGrade: regFloat(14), RegulationLabel: strPtr("آیین‌نامه ۱۳۹۱")},
	}
}

// regulationPresetPre1391 before 1391 — KEEP_ALWAYS (keep the failed grade).
func regulationPresetPre1391() RegulationConfig {
	return RegulationConfig{
		RegularTermRules:    RegulationRegularTermRules{MinUnits: 12, MaxUnits: 20, ProbationMaxUnits: 14, HonorsMinGPA: 17.0, HonorsMaxUnits: 24},
		SummerTermRules:     RegulationSummerTermRules{DefaultMaxUnits: 6, GraduatingMaxUnits: 8},
		GraduatingTermRules: RegulationGraduatingTermRules{CanTakeWithProbation: true, MaxUnits: 24, AutoCorequisiteAllowed: true},
		ProbationAndTenure:  RegulationProbationAndTenure{ProbationGpaThreshold: 12.0, MaxConsecutiveProbations: 3, MaxTotalProbations: 3, MaxStudySemesters: 10},
		GradingAndGpa:       RegulationGradingAndGpa{FailedCourseGpaPolicy: "KEEP_ALWAYS", DefaultPassingGrade: 10.0, RegulationLabel: strPtr("آیین‌نامه ماقبل ۱۳۹۱")},
	}
}

// regulationPreset1394Master master's regulations approved in 1394 (floor 12, boundary 14).
func regulationPreset1394Master() RegulationConfig {
	return RegulationConfig{
		RegularTermRules:    RegulationRegularTermRules{MinUnits: 8, MaxUnits: 14, ProbationMaxUnits: 10, HonorsMinGPA: 17.0, HonorsMaxUnits: 16},
		SummerTermRules:     RegulationSummerTermRules{DefaultMaxUnits: 4, GraduatingMaxUnits: 6},
		GraduatingTermRules: RegulationGraduatingTermRules{CanTakeWithProbation: true, MaxUnits: 14, AutoCorequisiteAllowed: true},
		ProbationAndTenure:  RegulationProbationAndTenure{ProbationGpaThreshold: 14.0, MaxConsecutiveProbations: 2, MaxTotalProbations: 2, MaxStudySemesters: 4},
		GradingAndGpa:       RegulationGradingAndGpa{FailedCourseGpaPolicy: "EXCLUDE_IF_PASSED", DefaultPassingGrade: 12.0, RetakeMinGrade: regFloat(12), RegulationLabel: strPtr("آیین‌نامه ۱۳۹۴ ارشد")},
	}
}

// regulationPreset1394Phd doctoral regulations approved in 1394 (floor 14, boundary 16).
func regulationPreset1394Phd() RegulationConfig {
	return RegulationConfig{
		RegularTermRules:    RegulationRegularTermRules{MinUnits: 6, MaxUnits: 12, ProbationMaxUnits: 8, HonorsMinGPA: 17.0, HonorsMaxUnits: 12},
		SummerTermRules:     RegulationSummerTermRules{DefaultMaxUnits: 4, GraduatingMaxUnits: 4},
		GraduatingTermRules: RegulationGraduatingTermRules{CanTakeWithProbation: false, MaxUnits: 12, AutoCorequisiteAllowed: false},
		ProbationAndTenure:  RegulationProbationAndTenure{ProbationGpaThreshold: 16.0, MaxConsecutiveProbations: 2, MaxTotalProbations: 2, MaxStudySemesters: 8},
		GradingAndGpa:       RegulationGradingAndGpa{FailedCourseGpaPolicy: "EXCLUDE_IF_PASSED", DefaultPassingGrade: 14.0, RetakeMinGrade: regFloat(14), RegulationLabel: strPtr("آیین‌نامه ۱۳۹۴ دکتری")},
	}
}

// EducationalRegulationPresets all built-in presets — keys are the same as the reference names.
func EducationalRegulationPresets() map[string]RegulationConfig {
	return map[string]RegulationConfig{
		"defaultBachelor1403": regulationPresetBachelor1403(),
		"defaultBachelor1390": regulationPresetBachelor1390(),
		"defaultMaster1403":   regulationPresetMaster1403(),
		"reg1402":             regulationPreset1402(),
		"reg1393":             regulationPreset1393(),
		"reg1391":             regulationPreset1391(),
		"regPre1391":          regulationPresetPre1391(),
		"reg1394Master":       regulationPreset1394Master(),
		"reg1394Phd":          regulationPreset1394Phd(),
	}
}

// ── Response types ──

// RegulationDegreeLevel degree level for the form selector (port of DegreeLevelItem).
type RegulationDegreeLevel struct {
	ID                      int64   `json:"id"`
	LevelName               string  `json:"levelName"`
	Title                   string  `json:"title"`
	DefaultPassingGrade     float64 `json:"defaultPassingGrade"`
	ConditionalGpaThreshold float64 `json:"conditionalGpaThreshold"`
	MaxUnitsPerTerm         *int64  `json:"maxUnitsPerTerm"`
}

// RegulationItem one regulation version (port of RegulationItem).
type RegulationItem struct {
	ID                int64           `json:"id"`
	Title             string          `json:"title"`
	DegreeLevelID     int64           `json:"degreeLevelId"`
	DegreeLevelTitle  string          `json:"degreeLevelTitle"`
	EffectiveFromYear int             `json:"effectiveFromYear"`
	EffectiveToYear   *int            `json:"effectiveToYear"`
	RulesConfig       json.RawMessage `json:"rulesConfig"`
	CreatedAt         *string         `json:"createdAt"`
}

// RegulationCenterData full response of the regulations center page.
type RegulationCenterData struct {
	Regulations  []RegulationItem            `json:"regulations"`
	DegreeLevels []RegulationDegreeLevel     `json:"degreeLevels"`
	Presets      map[string]RegulationConfig `json:"presets"`
}

// RegulationSaveInput save input (create/edit).
type RegulationSaveInput struct {
	ID                *int64          `json:"id"`
	Title             string          `json:"title"`
	DegreeLevelID     int64           `json:"degreeLevelId"`
	EffectiveFromYear int             `json:"effectiveFromYear"`
	EffectiveToYear   *int            `json:"effectiveToYear"`
	RulesConfig       json.RawMessage `json:"rulesConfig"`
}

// ListEducationalRegulations port of page.tsx — list of regulations + degree levels + presets.
func (s *Service) ListEducationalRegulations(ctx context.Context, user *session.User, cookie string) (*RegulationCenterData, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	resp := &RegulationCenterData{
		Regulations:  []RegulationItem{},
		DegreeLevels: []RegulationDegreeLevel{},
		Presets:      EducationalRegulationPresets(),
	}

	// Degree levels: this university + global records (universityId=null)
	if uniID != nil {
		rows, err := s.DB.Pool.Query(ctx, `
			select id, code, coalesce(nullif(title,''), code),
			       "defaultPassingGrade", "conditionalGpaThreshold", "maxUnitsPerTerm"
			  from degree_level_configs
			 where "universityId" = $1 or "universityId" is null
			 order by id`, *uniID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var d RegulationDegreeLevel
			if err := rows.Scan(&d.ID, &d.LevelName, &d.Title, &d.DefaultPassingGrade, &d.ConditionalGpaThreshold, &d.MaxUnitsPerTerm); err != nil {
				return nil, err
			}
			resp.DegreeLevels = append(resp.DegreeLevels, d)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	// Regulations: this university + global
	if uniID != nil {
		rows, err := s.DB.Pool.Query(ctx, `
			select r.id, r.title, r."degreeLevelId", coalesce(d.title, 'کارشناسی پیوسته'),
			       r."effectiveFromYear", r."effectiveToYear", r."rulesConfig", r."createdAt"::text
			  from educational_regulations r
			  left join degree_level_configs d on d.id = r."degreeLevelId"
			 where r."universityId" = $1 or r."universityId" is null
			 order by r."effectiveFromYear" desc, r.id`, *uniID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var r RegulationItem
			var raw string
			if err := rows.Scan(&r.ID, &r.Title, &r.DegreeLevelID, &r.DegreeLevelTitle,
				&r.EffectiveFromYear, &r.EffectiveToYear, &raw, &r.CreatedAt); err != nil {
				return nil, err
			}
			r.RulesConfig = regulationNormalizeRawConfig(raw)
			resp.Regulations = append(resp.Regulations, r)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	// If there are no records in the DB, three default regulations are built in memory
	// (outside the DB — exactly like page.tsx) so the user is not faced with an empty page.
	if len(resp.Regulations) == 0 && len(resp.DegreeLevels) > 0 {
		bachelorDeg := resp.DegreeLevels[0].ID
		masterDeg := bachelorDeg
		if len(resp.DegreeLevels) > 1 {
			masterDeg = resp.DegreeLevels[1].ID
		}
		def1403, _ := json.Marshal(regulationPresetBachelor1403())
		def1390, _ := json.Marshal(regulationPresetBachelor1390())
		defMaster, _ := json.Marshal(regulationPresetMaster1403())
		resp.Regulations = []RegulationItem{
			{ID: 1, Title: "آیین‌نامه یکپارچه آموزشی کارشناسی (مصوب ۱۳۹۷ به بعد)", DegreeLevelID: bachelorDeg, DegreeLevelTitle: "کارشناسی پیوسته", EffectiveFromYear: 1397, RulesConfig: def1403},
			{ID: 2, Title: "آیین‌نامه آموزشی کارشناسی (مصوب ۱۳۹۰)", DegreeLevelID: bachelorDeg, DegreeLevelTitle: "کارشناسی پیوسته", EffectiveFromYear: 1390, EffectiveToYear: intPtr(1396), RulesConfig: def1390},
			{ID: 3, Title: "آیین‌نامه جامع دوره کارشناسی ارشد ناپیوسته (مصوب ۱۴۰۳)", DegreeLevelID: masterDeg, DegreeLevelTitle: "کارشناسی ارشد", EffectiveFromYear: 1403, RulesConfig: defMaster},
		}
	}
	return resp, nil
}

// regulationNormalizeRawConfig parses the textual rulesConfig; if corrupt → bachelor preset.
func regulationNormalizeRawConfig(raw string) json.RawMessage {
	if raw != "" && json.Valid([]byte(raw)) {
		return json.RawMessage(raw)
	}
	out, _ := json.Marshal(regulationPresetBachelor1403())
	return out
}

func intPtr(v int) *int { return &v }

// SaveEducationalRegulation port of saveRegulationAction — create/edit with a Jalali year guard.
func (s *Service) SaveEducationalRegulation(ctx context.Context, user *session.User, cookie string, in RegulationSaveInput) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}

	// Valid Jalali year guard: prevents Sama codes (such as 1230/1330) from being entered instead of a year
	from := in.EffectiveFromYear
	if from < 1350 || from > 1500 {
		return fmt.Errorf("سال شروع اعتبار باید سال شمسی معتبر (۱۳۵۰ تا ۱۵۰۰) باشد؛ مقدار «%d» پذیرفته نیست.", from)
	}
	to := in.EffectiveToYear
	if to != nil && (*to < from || *to > 1500) {
		return fmt.Errorf("سال پایان اعتبار باید بین سال شروع (%d) و ۱۵۰۰ باشد.", from)
	}

	title := in.Title
	if title == "" {
		return errors.New("عنوان آیین‌نامه الزامی است.")
	}
	if len([]rune(title)) > 150 {
		return errors.New("عنوان آیین‌نامه حداکثر ۱۵۰ نویسه است.")
	}
	if in.DegreeLevelID <= 0 {
		return errors.New("مقطع تحصیلی نامعتبر است.")
	}
	if !json.Valid(in.RulesConfig) {
		return errors.New("پیکربندی قوانین (rulesConfig) JSON معتبری نیست.")
	}
	configStr := string(in.RulesConfig)

	if in.ID != nil && *in.ID > 0 {
		var curUni *int64
		if err := s.DB.Pool.QueryRow(ctx,
			`select "universityId" from educational_regulations where id = $1 limit 1`, *in.ID).
			Scan(&curUni); err != nil {
			return errors.New("آیین‌نامه یافت نشد.")
		}
		if curUni != nil && *curUni != *uniID {
			return errors.New("آیین‌نامه متعلق به دانشگاه دیگری است.")
		}
		_, err := s.DB.Pool.Exec(ctx, `
			update educational_regulations
			   set title = $1, "degreeLevelId" = $2, "effectiveFromYear" = $3,
			       "effectiveToYear" = $4, "rulesConfig" = $5
			 where id = $6 and ("universityId" = $7 or "universityId" is null)`,
			title, in.DegreeLevelID, from, to, configStr, *in.ID, *uniID)
		return err
	}

	insertSQL := `
		insert into educational_regulations
		       ("universityId", title, "degreeLevelId", "effectiveFromYear", "effectiveToYear", "rulesConfig")
		values ($1, $2, $3, $4, $5, $6)`
	_, err := s.DB.Pool.Exec(ctx, insertSQL, *uniID, title, in.DegreeLevelID, from, to, configStr)

	// Some installations seeded educational_regulations manually, leaving the
	// id sequence behind. Repair the sequence once and retry instead of failing
	// the first legitimate insert with a duplicate-key error.
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		if _, repairErr := s.DB.Pool.Exec(ctx, `
			select setval(
				pg_get_serial_sequence('educational_regulations', 'id'),
				greatest(
					coalesce((select max(id) from educational_regulations), 0),
					coalesce((select last_value from pg_sequences
					           where schemaname = current_schema()
					             and sequencename = 'educational_regulations_id_seq'), 0),
					1
				),
				true
			)`); repairErr != nil {
			return repairErr
		}
		_, err = s.DB.Pool.Exec(ctx, insertSQL, *uniID, title, in.DegreeLevelID, from, to, configStr)
	}
	return err
}

// DeleteEducationalRegulation port of deleteRegulationAction — delete with a university guard.
func (s *Service) DeleteEducationalRegulation(ctx context.Context, user *session.User, cookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	var curUni *int64
	if err := s.DB.Pool.QueryRow(ctx,
		`select "universityId" from educational_regulations where id = $1 limit 1`, id).
		Scan(&curUni); err != nil {
		return errors.New("آیین‌نامه یافت نشد.")
	}
	if curUni != nil && *curUni != *uniID {
		return errors.New("آیین‌نامه متعلق به دانشگاه دیگری است.")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		delete from educational_regulations
		 where id = $1 and ("universityId" = $2 or "universityId" is null)`, id, *uniID)
	return err
}
