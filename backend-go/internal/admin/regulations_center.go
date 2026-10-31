// ═══ مرکز مدیریت و کنترل آیین‌نامه‌های آموزشی — پورت admin/regulations در Next ═══
//
// پورت وفادار afagh-next/src/app/admin/regulations/{page.tsx,actions.ts} و
// afagh-next/src/lib/regulations-types.ts (پریست‌ها).
//
// منبع داده: educational_regulations (rulesConfig = JSON متنی) و
// degree_level_configs. آیین‌نامه‌ها با universityId=null سراسری‌اند و
// با universityId=دانشگاهِ فعال اختصاصی؛ هر دو در فهرست می‌آیند.
//
// «فعال‌سازی»: در مرجع Next عملیات جداگانه‌ای به نام فعال‌سازی وجود ندارد؛
// نسخهٔ فعال هر ورودی با بازهٔ سال اعتبار (effectiveFromYear/effectiveToYear)
// تعیین می‌شود — همان رفتار اینجا حفظ شده است.
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"backend-go/internal/session"
)

// ── انواع پیکربندی (پورت RegulationConfig از regulations-types.ts) ──

// RegulationLevelOverride تفاوت‌های مقطعی نیمسال/سنوات (SHORT/LONG).
type RegulationLevelOverride struct {
	MinUnits                 *float64 `json:"min_units,omitempty"`
	MaxConsecutiveProbations *float64 `json:"max_consecutive_probations,omitempty"`
	MaxTotalProbations       *float64 `json:"max_total_probations,omitempty"`
	MaxStudySemesters        *float64 `json:"max_study_semesters,omitempty"`
}

// RegulationRegularTermRules قواعد نیمسال عادی.
type RegulationRegularTermRules struct {
	MinUnits          float64 `json:"min_units"`
	MaxUnits          float64 `json:"max_units"`
	ProbationMaxUnits float64 `json:"probation_max_units"`
	HonorsMinGPA      float64 `json:"honors_min_gpa"`
	HonorsMaxUnits    float64 `json:"honors_max_units"`
}

// RegulationSummerTermRules قواعد نیمسال تابستان.
type RegulationSummerTermRules struct {
	DefaultMaxUnits    float64 `json:"default_max_units"`
	GraduatingMaxUnits float64 `json:"graduating_max_units"`
}

// RegulationGraduatingTermRules تسهیلات ترم آخر.
type RegulationGraduatingTermRules struct {
	CanTakeWithProbation   bool    `json:"can_take_with_probation"`
	MaxUnits               float64 `json:"max_units"`
	AutoCorequisiteAllowed bool    `json:"auto_corequisite_allowed"`
}

// RegulationProbationAndTenure مشروطی و سنوات.
type RegulationProbationAndTenure struct {
	ProbationGpaThreshold    float64 `json:"probation_gpa_threshold"`
	MaxConsecutiveProbations float64 `json:"max_consecutive_probations"`
	MaxTotalProbations       float64 `json:"max_total_probations"`
	MaxStudySemesters        float64 `json:"max_study_semesters"`
}

// RegulationGradingAndGpa سیاست نمرات و حذف نمرهٔ ردی پس از قبولی.
type RegulationGradingAndGpa struct {
	FailedCourseGpaPolicy string   `json:"failed_course_gpa_policy"` // EXCLUDE_IF_PASSED | EXCLUDE_IF_PASSED_1391 | KEEP_ALWAYS
	DefaultPassingGrade   float64  `json:"default_passing_grade"`
	RetakeMinGrade        *float64 `json:"retakeMinGrade,omitempty"`
	RegulationLabel       *string  `json:"regulationLabel,omitempty"`
	FailedSamaStatusCode  *string  `json:"failed_sama_status_code,omitempty"`
	DedupeRepeatedCourses *bool    `json:"dedupeRepeatedCourses,omitempty"`
}

// RegulationQuotaOverride اورراید سهمیه‌های خاص (SHAHED_ISARGAR و …).
type RegulationQuotaOverride struct {
	SummerTermRules *struct {
		DefaultMaxUnits *float64 `json:"default_max_units,omitempty"`
	} `json:"summer_term_rules,omitempty"`
	ProbationMaxUnits     *float64 `json:"probation_max_units,omitempty"`
	ExtraAllowedSemesters *float64 `json:"extra_allowed_semesters,omitempty"`
}

// RegulationConfig پیکربندی کامل یک آیین‌نامه — ساختار JSON rulesConfig.
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

// ── پریست‌ها (پورت DEFAULT_* و REGULATION_PRESETS از regulations-types.ts) ──

func regulationPresetBachelor1403() RegulationConfig {
	return RegulationConfig{
		RegularTermRules:    RegulationRegularTermRules{MinUnits: 12, MaxUnits: 20, ProbationMaxUnits: 14, HonorsMinGPA: 17.0, HonorsMaxUnits: 24},
		SummerTermRules:     RegulationSummerTermRules{DefaultMaxUnits: 6, GraduatingMaxUnits: 8},
		GraduatingTermRules: RegulationGraduatingTermRules{CanTakeWithProbation: true, MaxUnits: 24, AutoCorequisiteAllowed: true},
		ProbationAndTenure:  RegulationProbationAndTenure{ProbationGpaThreshold: 12.0, MaxConsecutiveProbations: 3, MaxTotalProbations: 4, MaxStudySemesters: 8},
		GradingAndGpa:       RegulationGradingAndGpa{FailedCourseGpaPolicy: "EXCLUDE_IF_PASSED", DefaultPassingGrade: 10.0, RegulationLabel: strPtr("آیین‌نامه ۱۴۰۲")},
		QuotaOverrides: map[string]RegulationQuotaOverride{
			"SHAHED_ISARGAR": {
				SummerTermRules:       &struct {
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

// regulationPreset1402 آیین‌نامه آموزشی ۱۴۰۲ و به بعد (کاردانی/کارشناسی).
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

// regulationPreset1393 آیین‌نامه مصوب ۹۳/۷/۲۸ (کدهای سما ۹۳/۹۴/۹۱۴/۹۱۵).
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

// regulationPreset1391 نامه ۱۳۸۷۱۵ مورخ ۹۱/۷/۲۲ — تبصرهٔ ۱۳۹۱ (حذف با ۱۴+).
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

// regulationPresetPre1391 ماقبل ۱۳۹۱ — KEEP_ALWAYS (ابقای نمرهٔ ردی).
func regulationPresetPre1391() RegulationConfig {
	return RegulationConfig{
		RegularTermRules:    RegulationRegularTermRules{MinUnits: 12, MaxUnits: 20, ProbationMaxUnits: 14, HonorsMinGPA: 17.0, HonorsMaxUnits: 24},
		SummerTermRules:     RegulationSummerTermRules{DefaultMaxUnits: 6, GraduatingMaxUnits: 8},
		GraduatingTermRules: RegulationGraduatingTermRules{CanTakeWithProbation: true, MaxUnits: 24, AutoCorequisiteAllowed: true},
		ProbationAndTenure:  RegulationProbationAndTenure{ProbationGpaThreshold: 12.0, MaxConsecutiveProbations: 3, MaxTotalProbations: 3, MaxStudySemesters: 10},
		GradingAndGpa:       RegulationGradingAndGpa{FailedCourseGpaPolicy: "KEEP_ALWAYS", DefaultPassingGrade: 10.0, RegulationLabel: strPtr("آیین‌نامه ماقبل ۱۳۹۱")},
	}
}

// regulationPreset1394Master آیین‌نامه ارشد مصوب ۱۳۹۴ (کف ۱۲، مرز ۱۴).
func regulationPreset1394Master() RegulationConfig {
	return RegulationConfig{
		RegularTermRules:    RegulationRegularTermRules{MinUnits: 8, MaxUnits: 14, ProbationMaxUnits: 10, HonorsMinGPA: 17.0, HonorsMaxUnits: 16},
		SummerTermRules:     RegulationSummerTermRules{DefaultMaxUnits: 4, GraduatingMaxUnits: 6},
		GraduatingTermRules: RegulationGraduatingTermRules{CanTakeWithProbation: true, MaxUnits: 14, AutoCorequisiteAllowed: true},
		ProbationAndTenure:  RegulationProbationAndTenure{ProbationGpaThreshold: 14.0, MaxConsecutiveProbations: 2, MaxTotalProbations: 2, MaxStudySemesters: 4},
		GradingAndGpa:       RegulationGradingAndGpa{FailedCourseGpaPolicy: "EXCLUDE_IF_PASSED", DefaultPassingGrade: 12.0, RetakeMinGrade: regFloat(12), RegulationLabel: strPtr("آیین‌نامه ۱۳۹۴ ارشد")},
	}
}

// regulationPreset1394Phd آیین‌نامه دکتری مصوب ۱۳۹۴ (کف ۱۴، مرز ۱۶).
func regulationPreset1394Phd() RegulationConfig {
	return RegulationConfig{
		RegularTermRules:    RegulationRegularTermRules{MinUnits: 6, MaxUnits: 12, ProbationMaxUnits: 8, HonorsMinGPA: 17.0, HonorsMaxUnits: 12},
		SummerTermRules:     RegulationSummerTermRules{DefaultMaxUnits: 4, GraduatingMaxUnits: 4},
		GraduatingTermRules: RegulationGraduatingTermRules{CanTakeWithProbation: false, MaxUnits: 12, AutoCorequisiteAllowed: false},
		ProbationAndTenure:  RegulationProbationAndTenure{ProbationGpaThreshold: 16.0, MaxConsecutiveProbations: 2, MaxTotalProbations: 2, MaxStudySemesters: 8},
		GradingAndGpa:       RegulationGradingAndGpa{FailedCourseGpaPolicy: "EXCLUDE_IF_PASSED", DefaultPassingGrade: 14.0, RetakeMinGrade: regFloat(14), RegulationLabel: strPtr("آیین‌نامه ۱۳۹۴ دکتری")},
	}
}

// EducationalRegulationPresets همهٔ پریست‌های آماده — کلیدها همان نام‌های مرجع.
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

// ── انواع پاسخ ──

// RegulationDegreeLevel مقطع تحصیلی برای انتخاب‌گر فرم (پورت DegreeLevelItem).
type RegulationDegreeLevel struct {
	ID                      int64   `json:"id"`
	LevelName               string  `json:"levelName"`
	Title                   string  `json:"title"`
	DefaultPassingGrade     float64 `json:"defaultPassingGrade"`
	ConditionalGpaThreshold float64 `json:"conditionalGpaThreshold"`
	MaxUnitsPerTerm         *int64  `json:"maxUnitsPerTerm"`
}

// RegulationItem یک نسخهٔ آیین‌نامه (پورت RegulationItem).
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

// RegulationCenterData پاسخ کامل صفحهٔ مرکز آیین‌نامه‌ها.
type RegulationCenterData struct {
	Regulations  []RegulationItem          `json:"regulations"`
	DegreeLevels []RegulationDegreeLevel   `json:"degreeLevels"`
	Presets      map[string]RegulationConfig `json:"presets"`
}

// RegulationSaveInput ورودی ذخیره (ساخت/ویرایش).
type RegulationSaveInput struct {
	ID                *int64          `json:"id"`
	Title             string          `json:"title"`
	DegreeLevelID     int64           `json:"degreeLevelId"`
	EffectiveFromYear int             `json:"effectiveFromYear"`
	EffectiveToYear   *int            `json:"effectiveToYear"`
	RulesConfig       json.RawMessage `json:"rulesConfig"`
}

// ListEducationalRegulations پورت page.tsx — فهرست آیین‌نامه‌ها + مقاطع + پریست‌ها.
func (s *Service) ListEducationalRegulations(ctx context.Context, user *session.User, cookie string) (*RegulationCenterData, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	resp := &RegulationCenterData{
		Regulations:  []RegulationItem{},
		DegreeLevels: []RegulationDegreeLevel{},
		Presets:      EducationalRegulationPresets(),
	}

	// مقاطع: همین دانشگاه + رکوردهای سراسری (universityId=null)
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

	// آیین‌نامه‌ها: همین دانشگاه + سراسری
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

	// اگر هیچ رکوردی در DB نیست، سه آیین‌نامهٔ پیش‌فرض در حافظه ساخته می‌شود
	// (خارج از DB — دقیقاً مثل page.tsx) تا کاربر با صفحهٔ خالی روبه‌رو نشود.
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

// regulationNormalizeRawConfig پارس rulesConfig متنی؛ خراب بودن → پریست کارشناسی.
func regulationNormalizeRawConfig(raw string) json.RawMessage {
	if raw != "" && json.Valid([]byte(raw)) {
		return json.RawMessage(raw)
	}
	out, _ := json.Marshal(regulationPresetBachelor1403())
	return out
}

func intPtr(v int) *int { return &v }

// SaveEducationalRegulation پورت saveRegulationAction — ساخت/ویرایش با گارد سال شمسی.
func (s *Service) SaveEducationalRegulation(ctx context.Context, user *session.User, cookie string, in RegulationSaveInput) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}

	// گارد سال شمسی معتبر: جلوگیری از ورود کدهای سما (مثل ۱۲۳۰/۱۳۳۰) به‌جای سال
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

	_, err := s.DB.Pool.Exec(ctx, `
		insert into educational_regulations
		       ("universityId", title, "degreeLevelId", "effectiveFromYear", "effectiveToYear", "rulesConfig")
		values ($1, $2, $3, $4, $5, $6)`,
		*uniID, title, in.DegreeLevelID, from, to, configStr)
	return err
}

// DeleteEducationalRegulation پورت deleteRegulationAction — حذف با گارد دانشگاه.
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
