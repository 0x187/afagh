// ═══ instructor teaching-fee engine — port of lib/payroll-engine.ts ═══
//
//	Payment flow:  DRAFT → MID_TERM_PAID (advance payment) → FINAL_SETTLED
//	Settlement gates:  ① all instructor grades FINALIZED  ② all their documents SIGNED
//
//	load the term with "fixed queries" (no N+1) and compute in memory;
//	money as integers rounded to a multiple of 10 rials.
package payroll

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/jalali"
	"backend-go/internal/messaging"
)

// Settings is the minimal settings dependency.
type Settings interface {
	Get(ctx context.Context, key string) (string, error)
	GetNumber(ctx context.Context, key string, fallback float64) float64
}

// Engine is the teaching-fee engine.
type Engine struct {
	Pool     *pgxpool.Pool
	Settings Settings
}

// New constructs the engine.
func New(pool *pgxpool.Pool, settings Settings) *Engine {
	return &Engine{Pool: pool, Settings: settings}
}

// PayrollRow is a statement row for one offering.
type PayrollRow struct {
	OfferingID           int64        `json:"offeringId"`
	CourseCode           string       `json:"courseCode"`
	CourseTitle          string       `json:"courseTitle"`
	Units                float64      `json:"units"`
	GroupNumber          *int         `json:"groupNumber"`
	PayRole              string       `json:"payRole"`
	OfferingType         string       `json:"offeringType"`
	Coefficients         string       `json:"coefficients"`
	EquivalentUnits      float64      `json:"equivalentUnits"`
	Sessions             SessionStats `json:"sessions"`
	EffectiveUnits       float64      `json:"effectiveUnits"`
	AbsenceDeductionRial float64      `json:"absenceDeductionRial"`
	GrossRial            float64      `json:"grossRial"`
	RuleTitle            *string      `json:"ruleTitle"`
}

// SessionStats is the session stats for one offering.
type SessionStats struct {
	Planned     int `json:"planned"`
	Held        int `json:"held"`
	Absents     int `json:"absents"`
	Makeup      int `json:"makeup"`
	NetAbsences int `json:"netAbsences"`
}

// StaffPayroll is an instructor's calculated statement.
type StaffPayroll struct {
	Staff                StaffMeta    `json:"staff"`
	Rate                 float64      `json:"rate"`
	RateSource           string       `json:"rateSource"`
	RateDivisor          float64      `json:"rateDivisor"`
	DutyUnits            float64      `json:"dutyUnits"`
	TaxRate              float64      `json:"taxRate"`
	Rows                 []PayrollRow `json:"rows"`
	TotalEquivalentUnits float64      `json:"totalEquivalentUnits"`
	TotalEffectiveUnits  float64      `json:"totalEffectiveUnits"`
	PayableUnits         float64      `json:"payableUnits"`
	Gross                float64      `json:"gross"`
	AbsenceDeductionRial float64      `json:"absenceDeductionRial"`
	Tax                  float64      `json:"tax"`
	Net                  float64      `json:"net"`
	Gates                Gates        `json:"gates"`
	HasContract          bool         `json:"hasContract"`
}

// Gates are the settlement gates.
type Gates struct {
	GradesFinalized bool `json:"gradesFinalized"`
	PendingGrades   int  `json:"pendingGrades"`
	DocsSigned      bool `json:"docsSigned"`
	UnsignedDocs    int  `json:"unsignedDocs"`
}

// StaffMeta is the instructor profile.
type StaffMeta struct {
	ID           int64   `json:"id"`
	Name         string  `json:"name"`
	StaffCode    *string `json:"staffCode"`
	Rank         *string `json:"rank"`
	Base         *string `json:"base"`
	Degree       *string `json:"degree"`
	ContractType *string `json:"contractType"`
}

// PayrollOverviewItem is a payroll overview row.
type PayrollOverviewItem struct {
	StaffMeta
	Rate                 float64 `json:"rate"`
	RateSource           string  `json:"rateSource"`
	DutyUnits            float64 `json:"dutyUnits"`
	TotalEquivalentUnits float64 `json:"totalEquivalentUnits"`
	TotalEffectiveUnits  float64 `json:"totalEffectiveUnits"`
	PayableUnits         float64 `json:"payableUnits"`
	Gross                float64 `json:"gross"`
	Tax                  float64 `json:"tax"`
	AbsenceDeductionRial float64 `json:"absenceDeductionRial"`
	Net                  float64 `json:"net"`
	Status               string  `json:"status"`
	StatementID          *int64  `json:"statementId"`
	MidtermPaid          float64 `json:"midtermPaid"`
	FinalPaid            float64 `json:"finalPaid"`
	Remaining            float64 `json:"remaining"`
	Gates                Gates   `json:"gates"`
}

// OverviewTotals is the overview total.
type OverviewTotals struct {
	Budget     float64 `json:"budget"`
	Paid       float64 `json:"paid"`
	Remaining  float64 `json:"remaining"`
	StaffCount int     `json:"staffCount"`
}

// Overview is the whole-term view.
type Overview struct {
	Term   string                `json:"term"`
	List   []PayrollOverviewItem `json:"list"`
	Totals OverviewTotals        `json:"totals"`
}

// ─────────────────── configuration ───────────────────

type coefs struct {
	Practical   float64 `json:"practical"`
	MsLevel     float64 `json:"msLevel"`
	Crowded     float64 `json:"crowded"`
	CrowdedTier *struct {
		MinStudents   *int     `json:"minStudents"`
		StepSize      *int     `json:"stepSize"`
		StepIncrement *float64 `json:"stepIncrement"`
	} `json:"crowdedTier"`
}

// PayRule: formula rules — the most specific rule wins.
type PayRule struct {
	ID              int64    `json:"id"`
	OfferingType    *string  `json:"offeringType"`
	ProfessorRole   *string  `json:"professorRole"`
	AcademicRank    *string  `json:"academicRank"`
	ClassMode       string   `json:"classMode"`
	MinStudents     *int     `json:"minStudents"`
	MaxStudents     *int     `json:"maxStudents"`
	DepartmentID    *int64   `json:"departmentId"`
	CourseType      *string  `json:"courseType"`
	RepeatNumber    *int     `json:"repeatNumber"`
	Expression      *string  `json:"expression"`
	FlatBase        *float64 `json:"flatBase"`
	PerStudentHours *float64 `json:"perStudentHours"`
	Title           *string  `json:"title"`
}

// RuleMatch: an offering's coordinates for rule matching.
type RuleMatch struct {
	OfferingType string
	Role         string
	Rank         *string
	HasClass     bool
	Enrolled     int
	DeptID       *int64
	CourseType   *string
	Nth          int
}

// ContractRow is a term contract.
type ContractRow struct {
	ID           int64
	StaffID      int64
	ContractType *string
	BaseDuty     float64
	TaxRate      float64
	RankSnapshot *string
	BaseSnapshot *string
	RateSnapshot *float64
	SalaryBase   *float64
}

type staffMetaRow struct {
	Info   StaffMeta
	UserID int64
}

type staffOffering struct {
	OfferingID      int64
	CourseCode      string
	CourseTitle     string
	UnitsInt        int
	PracticalUnits  int
	GroupNumber     *int
	EnrolledCount   int
	OfferingType    string
	PayRole         string
	SharePct        float64
	MergeKey        *string
	MergedMemberIds []int64
	CourseID        int64
	TheoryUnits     float64
	DeptID          *int64
	CourseType      *string
}

type statementRow struct {
	ID          int64
	StaffID     int64
	ContractID  int64
	TotalEquiv  *float64
	Payable     *float64
	Gross       *float64
	Deductions  *float64
	Net         *float64
	Status      *string
	MidtermPaid *float64
	FinalPaid   *float64
}

type termData struct {
	TermID                 int64
	TermTitle              string
	Coefs                  coefs
	Rules                  []PayRule
	RateByStaff            map[int64]float64
	Contracts              map[int64]*ContractRow
	EffectiveDuties        map[int64]float64
	StaffInfo              map[int64]staffMetaRow
	OfferingsByStaff       map[int64][]*staffOffering
	SessionsByOffering     map[int64]SessionStats
	SlotsByOffering        map[int64]string
	GatesByStaff           map[int64]Gates
	StatementsByStaff      map[int64]*statementRow
	MsPrefixes             []string
	CrowdedThreshold       float64
	CrowdedStep            float64
	CrowdedStepUp          float64
	RateFraction           bool
	RateDivisor            float64
	RateSource             map[int64]string
	PlannedSessionsDefault float64
	RoleTitles             map[string]string
	RepeatCount            map[string]int
}

// ─────────────────── roles and labels ───────────────────

var roleFA = map[string]string{
	"MAIN_LECTURER": "مدرس اصلی", "SUPERVISOR": "استاد راهنما", "ADVISOR": "استاد مشاور",
	"REVIEWER": "داور", "EXAMINER": "ممتحن",
	"ASSISTANT": "کمک‌استاد", "SELF_STUDY": "استاد خودخوان",
}

var typeFA = map[string]string{
	"THEORY": "نظری", "THESIS": "پایان‌نامه", "DIRECTED_READING": "معرفی به استاد",
	"INTERNSHIP": "کارآموزی", "NORMAL": "نظری", "TRANSFER": "تطبیق واحد",
}

func roleLabel(data *termData, code string) string {
	if t, ok := data.RoleTitles[code]; ok && t != "" {
		return t
	}
	if t, ok := roleFA[code]; ok {
		return t
	}
	return code
}

func offeringTypeFA(t string) string {
	if f, ok := typeFA[t]; ok {
		return f
	}
	return t
}

// ─────────────────── data-driven settings loading ───────────────────

func (e *Engine) loadCoefficients(ctx context.Context) (coefs, error) {
	practicalName, _ := e.Settings.Get(ctx, "PAYROLL_COEF_PRACTICAL")
	msName, _ := e.Settings.Get(ctx, "PAYROLL_COEF_MS_LEVEL")
	crowdedName, _ := e.Settings.Get(ctx, "PAYROLL_COEF_CROWDED")
	rows, err := e.Pool.Query(ctx, `
		select "ruleName", "multiplier"::float8, "minStudents", "stepSize", "stepIncrement"::float8
		  from teaching_coefficients`)
	if err != nil {
		return coefs{}, err
	}
	defer rows.Close()
	type cRow struct {
		Name    string
		Mult    float64
		Min     *int
		Step    *int
		StepInc *float64
	}
	list := []cRow{}
	for rows.Next() {
		var r cRow
		var name string
		var mult float64
		if err := rows.Scan(&name, &mult, &r.Min, &r.Step, &r.StepInc); err == nil {
			r.Name = strings.TrimSpace(name)
			r.Mult = mult
			list = append(list, r)
		}
	}
	rows.Close()
	num := func(name string, fallback float64) float64 {
		for _, r := range list {
			if r.Name == name && r.Mult > 0 {
				return r.Mult
			}
		}
		return fallback
	}
	var tier *struct {
		MinStudents   *int     `json:"minStudents"`
		StepSize      *int     `json:"stepSize"`
		StepIncrement *float64 `json:"stepIncrement"`
	}
	for _, r := range list {
		if crowdedName != "" && r.Name == crowdedName {
			tier = &struct {
				MinStudents   *int     `json:"minStudents"`
				StepSize      *int     `json:"stepSize"`
				StepIncrement *float64 `json:"stepIncrement"`
			}{r.Min, r.Step, r.StepInc}
		}
	}
	return coefs{
		Practical:   num(strings.TrimSpace(practicalName), 1),
		MsLevel:     num(strings.TrimSpace(msName), 1),
		Crowded:     num(strings.TrimSpace(crowdedName), 1),
		CrowdedTier: tier,
	}, nil
}

func (e *Engine) loadPayRules(ctx context.Context) ([]PayRule, error) {
	rows, err := e.Pool.Query(ctx, `
		select id, "offeringType", "professorRole", "academicRank", coalesce("classMode",'ANY'),
		       "minStudents", "maxStudents", "departmentId", "courseType", "repeatNumber",
		       "expression", "flatBase"::float8, "perStudentHours"::float8, title
		  from payroll_calculation_rules where "isActive" = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PayRule{}
	for rows.Next() {
		var r PayRule
		if err := rows.Scan(&r.ID, &r.OfferingType, &r.ProfessorRole, &r.AcademicRank, &r.ClassMode,
			&r.MinStudents, &r.MaxStudents, &r.DepartmentID, &r.CourseType, &r.RepeatNumber,
			&r.Expression, &r.FlatBase, &r.PerStudentHours, &r.Title); err != nil {
			continue
		}
		// a rule must be specific (all-dimensions = useless).
		specific := r.OfferingType != nil || r.ProfessorRole != nil || r.AcademicRank != nil ||
			(r.ClassMode != "" && r.ClassMode != "ANY") || r.DepartmentID != nil || r.CourseType != nil ||
			r.RepeatNumber != nil || r.MinStudents != nil || r.MaxStudents != nil
		if specific {
			out = append(out, r)
		}
	}
	rows.Close()
	sort.SliceStable(out, func(i, j int) bool {
		return ruleScore(&out[j]) < ruleScore(&out[i])
	})
	return out, nil
}

func ruleScore(r *PayRule) int {
	s := 0
	if r.OfferingType != nil {
		s += 2
	}
	if r.ProfessorRole != nil {
		s += 2
	}
	if r.AcademicRank != nil {
		s++
	}
	if r.ClassMode != "" && r.ClassMode != "ANY" {
		s++
	}
	if r.MinStudents != nil {
		s++
	}
	if r.MaxStudents != nil {
		s++
	}
	if r.DepartmentID != nil {
		s++
	}
	if r.CourseType != nil {
		s++
	}
	if r.RepeatNumber != nil {
		s += 2
	}
	return s
}

// MatchRule: rule matching — the first matching rule (most specific, pre-sorted).
func MatchRule(rules []PayRule, m RuleMatch) *PayRule {
	t := m.OfferingType
	if t == "NORMAL" {
		t = "THEORY"
	}
	for i := range rules {
		r := &rules[i]
		if r.OfferingType != nil && *r.OfferingType != t {
			continue
		}
		if r.ProfessorRole != nil && *r.ProfessorRole != m.Role {
			continue
		}
		if r.AcademicRank != nil && (m.Rank == nil || *r.AcademicRank != *m.Rank) {
			continue
		}
		if r.ClassMode != "" && r.ClassMode != "ANY" && (r.ClassMode == "WITH_CLASS") != m.HasClass {
			continue
		}
		if r.MinStudents != nil && m.Enrolled < *r.MinStudents {
			continue
		}
		if r.MaxStudents != nil && m.Enrolled > *r.MaxStudents {
			continue
		}
		if r.DepartmentID != nil && (m.DeptID == nil || *r.DepartmentID != *m.DeptID) {
			continue
		}
		if r.CourseType != nil && (m.CourseType == nil || *r.CourseType != *m.CourseType) {
			continue
		}
		if r.RepeatNumber != nil && *r.RepeatNumber != m.Nth {
			continue
		}
		return r
	}
	return nil
}

// DiagnoseRuleMiss: stepwise diagnosis — the first dimension that empties the candidate set.
func DiagnoseRuleMiss(rules []PayRule, m RuleMatch) (dim, reason string) {
	if len(rules) == 0 {
		return "none", "هیچ قانون فرمول فعالی تعریف نشده است — از زبانهٔ قوانین، دست‌کم یک سطر بسازید."
	}
	t := m.OfferingType
	if t == "NORMAL" {
		t = "THEORY"
	}
	tFa := offeringTypeFA(t)
	cands := rules
	type step struct {
		dim  string
		keep func(*PayRule) bool
		reas func() string
	}
	steps := []step{
		{"offeringType", func(r *PayRule) bool { return r.OfferingType == nil || *r.OfferingType == t },
			func() string {
				return fmt.Sprintf("نوع درس «%s»: هیچ قانونی این نوع را پوشش نمی‌دهد.", tFa)
			}},
		{"professorRole", func(r *PayRule) bool { return r.ProfessorRole == nil || *r.ProfessorRole == m.Role },
			func() string {
				return fmt.Sprintf("نقش «%s»: قانونی برای این نقش تعریف نشده (نقش قابل تعریف است).", m.Role)
			}},
		{"academicRank", func(r *PayRule) bool { return r.AcademicRank == nil || (m.Rank != nil && *r.AcademicRank == *m.Rank) },
			func() string {
				rank := "—"
				if m.Rank != nil {
					rank = *m.Rank
				}
				return fmt.Sprintf("مرتبهٔ «%s»: قوانین موجود مرتبهٔ دیگری می‌خواهند.", rank)
			}},
		{"classMode", func(r *PayRule) bool {
			return r.ClassMode == "" || r.ClassMode == "ANY" || (r.ClassMode == "WITH_CLASS") == m.HasClass
		},
			func() string {
				if m.HasClass {
					return "وضعیت کلاس: ارائه باکلاس است ولی قوانینِ منطبق فقط «بدون‌کلاس» می‌خواهند."
				}
				return "وضعیت کلاس: ارائه بدون‌کلاس است ولی قوانینِ منطبق فقط «باکلاس» می‌خواهند."
			}},
		{"studentRange", func(r *PayRule) bool {
			return (r.MinStudents == nil || m.Enrolled >= *r.MinStudents) && (r.MaxStudents == nil || m.Enrolled <= *r.MaxStudents)
		}, func() string {
			return fmt.Sprintf("تعداد دانشجو (%d نفر): خارج از بازهٔ قوانین منطبق است.", m.Enrolled)
		}},
		{"department", func(r *PayRule) bool {
			return r.DepartmentID == nil || (m.DeptID != nil && *r.DepartmentID == *m.DeptID)
		},
			func() string {
				return "گروه آموزشی: قوانین منطبق محدود به گروه دیگری هستند."
			}},
		{"courseType", func(r *PayRule) bool {
			return r.CourseType == nil || (m.CourseType != nil && *r.CourseType == *m.CourseType)
		},
			func() string {
				ct := "—"
				if m.CourseType != nil {
					ct = *m.CourseType
				}
				return fmt.Sprintf("نوع درس کاتالوگ («%s»): قانونی برای این نوع نیست.", ct)
			}},
		{"repeat", func(r *PayRule) bool { return r.RepeatNumber == nil || *r.RepeatNumber == m.Nth },
			func() string {
				return fmt.Sprintf("نوبت تکرار (بار %dاُم): قوانین منطبق نوبت دیگری می‌خواهند.", m.Nth)
			}},
	}
	for _, s := range steps {
		next := []PayRule{}
		for i := range cands {
			if s.keep(&cands[i]) {
				next = append(next, cands[i])
			}
		}
		if len(next) == 0 {
			return s.dim, s.reas()
		}
		cands = next
	}
	return "unknown", "علت نامشخص — با پشتیبانی در میان بگذارید."
}

// crowdedMult is the tiered multiplier for crowded classes.
func crowdedMult(enrolled int, data *termData) (mult float64, label string) {
	T := data.CrowdedThreshold
	if data.Coefs.CrowdedTier != nil && data.Coefs.CrowdedTier.MinStudents != nil && *data.Coefs.CrowdedTier.MinStudents > 0 {
		T = float64(*data.Coefs.CrowdedTier.MinStudents)
	}
	base := data.Coefs.Crowded
	if float64(enrolled) <= T {
		return base, ""
	}
	S := data.CrowdedStep
	if S < 1 {
		S = 25
	} else {
		S = float64(int(S))
	}
	up := data.CrowdedStepUp
	steps := int(mathFloor((float64(enrolled)-T)/S)) + 1
	if !(up > 0) || steps <= 1 {
		return base, fmt.Sprintf("جمعی ×%s", fmtCoef(base))
	}
	m := mathRound((base+float64(steps-1)*up)*100) / 100
	return m, fmt.Sprintf("جمعی ×%s (%d پله)", fmtCoef(m), steps)
}

func fmtCoef(v float64) string {
	s := strconv.FormatFloat(v, 'f', -1, 64)
	return s
}

func mathFloor(v float64) float64 { return math.Floor(v) }

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func mathRound(v float64) float64 { return math.Round(v) }

// ─────────────────── current term ───────────────────

// CurrentTerm: the current term (or the specified term).
func (e *Engine) CurrentTerm(ctx context.Context, termID *int64) (*TermRow, error) {
	var row *TermRow
	var err error
	if termID != nil && *termID > 0 {
		row, err = e.termByID(ctx, *termID)
	} else {
		var id int64
		err = e.Pool.QueryRow(ctx, `select id from academic_terms where "isCurrent" = 1 limit 1`).Scan(&id)
		if err != nil {
			return nil, nil
		}
		row, err = e.termByID(ctx, id)
	}
	if err != nil {
		return nil, err
	}
	return row, nil
}

// TermRow is a term.
type TermRow struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

func (e *Engine) termByID(ctx context.Context, id int64) (*TermRow, error) {
	var t TermRow
	if err := e.Pool.QueryRow(ctx, `select id, title from academic_terms where id = $1`, id).Scan(&t.ID, &t.Title); err != nil {
		return nil, nil
	}
	return &t, nil
}

// FiscalYear: fiscal year from the FA_YEAR setting, otherwise automatic from today's date (Jalali).
func (e *Engine) FiscalYear(ctx context.Context) int {
	if e.Settings != nil {
		if v, err := e.Settings.Get(ctx, "FA_YEAR"); err == nil {
			if t := strings.TrimSpace(v); t != "" {
				if n, err := strconv.Atoi(faToEnDigits(t)); err == nil {
					return n
				}
			}
		}
	}
	d := jalali.ToJalaliFromTime(time.Now())
	return d.Y
}

var faDigitMap = map[rune]rune{
	'۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
	'۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}

func faToEnDigits(s string) string {
	out := []rune(s)
	for i, r := range out {
		if en, ok := faDigitMap[r]; ok {
			out[i] = en
		}
	}
	return string(out)
}

// ─────────────────── bulk term loading (no N+1) ───────────────────

// LoadTermPayrollData loads all data needed to compute every instructor's statement in a term.
func (e *Engine) LoadTermPayrollData(ctx context.Context, termID int64) (*termData, error) {
	data := &termData{
		TermID:                 termID,
		RateByStaff:            map[int64]float64{},
		Contracts:              map[int64]*ContractRow{},
		EffectiveDuties:        map[int64]float64{},
		StaffInfo:              map[int64]staffMetaRow{},
		OfferingsByStaff:       map[int64][]*staffOffering{},
		SessionsByOffering:     map[int64]SessionStats{},
		SlotsByOffering:        map[int64]string{},
		GatesByStaff:           map[int64]Gates{},
		StatementsByStaff:      map[int64]*statementRow{},
		RateSource:             map[int64]string{},
		RoleTitles:             map[string]string{},
		RepeatCount:            map[string]int{},
		RateDivisor:            50,
		CrowdedThreshold:       40,
		CrowdedStep:            25,
		PlannedSessionsDefault: 16,
	}

	var err error
	if data.Coefs, err = e.loadCoefficients(ctx); err != nil {
		return nil, err
	}
	if data.Rules, err = e.loadPayRules(ctx); err != nil {
		return nil, err
	}

	// 1) term contracts
	crows, err := e.Pool.Query(ctx, `
		select id, "staffId", "contractType", "baseDutyUnits"::float8, "taxRate"::float8,
		       "rankSnapshot", "baseSnapshot", "rateSnapshot"::float8, "salaryBase"::float8
		  from professor_term_contracts where "termId" = $1`, termID)
	if err != nil {
		return nil, err
	}
	for crows.Next() {
		var c ContractRow
		if err := crows.Scan(&c.ID, &c.StaffID, &c.ContractType, &c.BaseDuty, &c.TaxRate,
			&c.RankSnapshot, &c.BaseSnapshot, &c.RateSnapshot, &c.SalaryBase); err == nil {
			data.Contracts[c.StaffID] = &c
		}
	}
	crows.Close()

	// 2) instructors
	srows, err := e.Pool.Query(ctx, `
		select st.id, st."userId", st."staffCode", st."academicRank", st."academicBase", st."degree",
		       coalesce(u."firstName",''), coalesce(u."lastName",'')
		  from staff st join users u on u.id = st."userId"`)
	if err != nil {
		return nil, err
	}
	type sr struct {
		id     int64
		userID int64
		code   *string
		rank   *string
		base   *string
		degree *string
		first  string
		last   string
	}
	staffRows := []sr{}
	for srows.Next() {
		var r sr
		if err := srows.Scan(&r.id, &r.userID, &r.code, &r.rank, &r.base, &r.degree, &r.first, &r.last); err == nil {
			staffRows = append(staffRows, r)
		}
	}
	srows.Close()
	for _, r := range staffRows {
		data.StaffInfo[r.id] = staffMetaRow{
			UserID: r.userID,
			Info: StaffMeta{
				ID: r.id, Name: strings.TrimSpace(r.first + " " + r.last),
				StaffCode: r.code, Rank: r.rank, Base: r.base, Degree: r.degree,
			},
		}
	}

	// 3) term classes + each instructor's role and share
	orows, err := e.Pool.Query(ctx, `
		select o.id, o."professorId", o."groupNumber", o."enrolledCount"::int, coalesce(o."offeringType",'NORMAL'),
		       o."courseId", coalesce(c."theoreticalUnits",0)::float8, c."departmentId", c."courseType",
		       o."sharedScheduleGroupKey", c.code, c.title, c.units::float8, coalesce(c."practicalUnits",0)::float8,
		       op."staffId", op.role, op."sharePercentage"::float8
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join offering_professors op on op."offeringId" = o.id
		 where o."termId" = $1 and o."isActive" = 1`, termID)
	if err != nil {
		return nil, err
	}
	type orow struct {
		offeringID  int64
		profID      *int64
		groupNo     *int
		enrolled    int
		oType       string
		courseID    int64
		theoryUnits float64
		deptID      *int64
		courseType  *string
		mergeKey    *string
		code        string
		title       string
		units       float64
		practical   float64
		coStaffID   *int64
		coRole      *string
		sharePct    *float64
	}
	offRows := []orow{}
	for orows.Next() {
		var r orow
		if err := orows.Scan(&r.offeringID, &r.profID, &r.groupNo, &r.enrolled, &r.oType,
			&r.courseID, &r.theoryUnits, &r.deptID, &r.courseType,
			&r.mergeKey, &r.code, &r.title, &r.units, &r.practical,
			&r.coStaffID, &r.coRole, &r.sharePct); err == nil {
			offRows = append(offRows, r)
		}
	}
	orows.Close()

	// 8) manual instructor role on the offering
	override := map[string]string{}
	ovrows, err := e.Pool.Query(ctx, `
		select e."offeringId", e."staffId", e."payRoleOverride"
		  from offering_payroll_extras e
		  join course_offerings o on o.id = e."offeringId"
		 where o."termId" = $1 and e."payRoleOverride" is not null`, termID)
	if err == nil {
		for ovrows.Next() {
			var oid, sid int64
			var role string
			if err := ovrows.Scan(&oid, &sid, &role); err == nil && role != "" {
				override[fmt.Sprintf("%d:%d", oid, sid)] = role
			}
		}
		ovrows.Close()
	}

	// 9) teaching occurrence
	rprows, err := e.Pool.Query(ctx, `
		select s."staffId", s."courseId", count(distinct s."termId")::int as "priorTerms"
		  from (
		    select o."courseId" as "courseId", o."termId" as "termId", o."professorId" as "staffId"
		      from course_offerings o where o."isActive" = 1 and o."professorId" is not null
		    union
		    select o."courseId" as "courseId", o."termId" as "termId", op."staffId" as "staffId"
		      from course_offerings o join offering_professors op on op."offeringId" = o.id
		     where o."isActive" = 1
		  ) s
		  join academic_terms t on t.id = s."termId"
		 where coalesce(t."sortOrder", 0) < coalesce((select "sortOrder" from academic_terms where id = $1), 0)
		 group by s."staffId", s."courseId"`, termID)
	if err == nil {
		for rprows.Next() {
			var sid, cid int64
			var n int
			if err := rprows.Scan(&sid, &cid, &n); err == nil {
				data.RepeatCount[fmt.Sprintf("%d:%d", sid, cid)] = n
			}
		}
		rprows.Close()
	}

	// 10) configurable role titles
	rdrows, err := e.Pool.Query(ctx, `select code, title from teaching_role_defs where "isActive" = 1`)
	if err == nil {
		for rdrows.Next() {
			var code, title string
			if err := rdrows.Scan(&code, &title); err == nil && code != "" {
				data.RoleTitles[code] = title
			}
		}
		rdrows.Close()
	}

	// classes per instructor (main + co-instructor)
	push := func(staffID int64, o *staffOffering) {
		data.OfferingsByStaff[staffID] = append(data.OfferingsByStaff[staffID], o)
	}
	for _, o := range offRows {
		base := &staffOffering{
			OfferingID: o.offeringID, CourseCode: o.code, CourseTitle: o.title,
			UnitsInt: UnitsToInt(o.units), PracticalUnits: int(o.practical),
			GroupNumber: o.groupNo, EnrolledCount: o.enrolled,
			OfferingType: o.oType, MergeKey: o.mergeKey,
			CourseID: o.courseID, TheoryUnits: o.theoryUnits, DeptID: o.deptID, CourseType: o.courseType,
		}
		if o.coStaffID != nil {
			role := override[fmt.Sprintf("%d:%d", o.offeringID, *o.coStaffID)]
			if role == "" {
				if o.coRole != nil && *o.coRole != "" {
					role = *o.coRole
				} else {
					role = "MAIN_LECTURER"
				}
			}
			share := 100.0
			if o.sharePct != nil {
				share = *o.sharePct
			}
			cp := *base
			cp.PayRole = role
			cp.SharePct = share
			push(*o.coStaffID, &cp)
		} else if o.profID != nil {
			role := override[fmt.Sprintf("%d:%d", o.offeringID, *o.profID)]
			if role == "" {
				if base.OfferingType == "THESIS" {
					role = "SUPERVISOR"
				} else {
					role = "MAIN_LECTURER"
				}
			}
			cp := *base
			cp.PayRole = role
			cp.SharePct = 100
			push(*o.profID, &cp)
		}
	}

	// 4) session stats for all term classes
	ssrows, err := e.Pool.Query(ctx, `
		select cs."offeringId",
		       sum(case when cs."isMakeUpSession" = 0 then 1 else 0 end)::int as planned,
		       sum(case when cs.status = 'HELD' and cs."isMakeUpSession" = 0 then 1 else 0 end)::int as held,
		       sum(case when cs.status = 'ABSENT' then 1 else 0 end)::int as absents,
		       sum(case when cs.status = 'HELD' and cs."isMakeUpSession" = 1 then 1 else 0 end)::int as makeup
		  from class_sessions cs
		  join course_offerings o on o.id = cs."offeringId"
		 where o."termId" = $1
		 group by cs."offeringId"`, termID)
	if err == nil {
		for ssrows.Next() {
			var oid int64
			var s SessionStats
			if err := ssrows.Scan(&oid, &s.Planned, &s.Held, &s.Absents, &s.Makeup); err == nil {
				s.NetAbsences = maxInt(0, s.Absents-s.Makeup)
				// proportion basis = main "held" sessions.
				s.Planned = s.Held
				data.SessionsByOffering[oid] = s
			}
		}
		ssrows.Close()
	}

	// 5) gate 1: un-finalized grades per instructor
	grows, err := e.Pool.Query(ctx, `
		select s.id, count(e.id)::int as "pendingGrades"
		  from staff s
		  join course_offerings o on o."termId" = $1
		    and (o."professorId" = s.id or exists (select 1 from offering_professors op where op."offeringId" = o.id and op."staffId" = s.id))
		  join enrollments e on e."offeringId" = o.id and e.status = 'REGISTERED' and coalesce(e."gradeStatus", '') <> 'FINALIZED'
		 group by s.id`, termID)
	if err == nil {
		for grows.Next() {
			var sid int64
			var n int
			if err := grows.Scan(&sid, &n); err == nil {
				data.GatesByStaff[sid] = Gates{PendingGrades: n, DocsSigned: true}
			}
		}
		grows.Close()
	}

	// 6) gate 2: unsigned documents
	drows, err := e.Pool.Query(ctx, `
		select ed."staffId", count(*)::int as "unsignedDocs"
		  from electronic_documents ed
		 where ed."termId" = $1 and coalesce(ed."signatureStatus", '') <> 'SIGNED'
		 group by ed."staffId"`, termID)
	if err == nil {
		for drows.Next() {
			var sid int64
			var n int
			if err := drows.Scan(&sid, &n); err == nil {
				g := data.GatesByStaff[sid]
				g.UnsignedDocs = n
				g.DocsSigned = n == 0
				data.GatesByStaff[sid] = g
			}
		}
		drows.Close()
	}
	// fill bool fields for grade-only instructors
	for sid, g := range data.GatesByStaff {
		g.DocsSigned = g.UnsignedDocs == 0
		g.GradesFinalized = g.PendingGrades == 0
		data.GatesByStaff[sid] = g
	}

	// 7) calculated statements
	prows, err := e.Pool.Query(ctx, `
		select ps.id, pc."staffId", ps."contractId",
		       ps."totalEquivalentUnits"::float8, ps."payableUnits"::float8, ps."grossAmount"::float8,
		       ps."deductions"::float8, ps."netAmount"::float8, ps.status,
		       coalesce(ps."midtermPaidAmount",0)::float8, coalesce(ps."finalPaidAmount",0)::float8
		  from payroll_statements ps
		  join professor_term_contracts pc on pc.id = ps."contractId"
		 where pc."termId" = $1`, termID)
	if err == nil {
		for prows.Next() {
			var s statementRow
			if err := prows.Scan(&s.ID, &s.StaffID, &s.ContractID, &s.TotalEquiv, &s.Payable, &s.Gross,
				&s.Deductions, &s.Net, &s.Status, &s.MidtermPaid, &s.FinalPaid); err == nil {
				data.StatementsByStaff[s.StaffID] = &s
			}
		}
		prows.Close()
	}

	// merge keys from the schedule
	slrows, err := e.Pool.Query(ctx, `
		select s."offeringId", s."dayOfWeek", s."startTime"::text, s."endTime"::text, s."roomId"
		  from schedules s
		  join course_offerings o on o.id = s."offeringId"
		 where o."termId" = $1 and s."scheduleType" = 'CLASS'`, termID)
	if err == nil {
		slotLists := map[int64][]mergeSlot{}
		for slrows.Next() {
			var oid int64
			var s mergeSlot
			var roomID *int64
			if err := slrows.Scan(&oid, &s.day, &s.start, &s.end, &roomID); err == nil {
				if roomID != nil {
					s.room = strconv.FormatInt(*roomID, 10)
				}
				slotLists[oid] = append(slotLists[oid], s)
			}
		}
		slrows.Close()
		for oid, slots := range slotLists {
			if key := mergeGroupKey(nil, slots); key != "" {
				data.SlotsByOffering[oid] = key
			}
		}
	}

	// settings + role-based duty + rates
	data.CrowdedThreshold = e.Settings.GetNumber(ctx, "PAYROLL_CROWDED_THRESHOLD", 40)
	data.CrowdedStep = e.Settings.GetNumber(ctx, "PAYROLL_CROWDED_STEP", 25)
	data.CrowdedStepUp = e.Settings.GetNumber(ctx, "PAYROLL_CROWDED_STEP_UP", 0)
	rateFractionRaw, _ := e.Settings.Get(ctx, "PAYROLL_RATE_FRACTION")
	data.RateFraction = strings.ToLower(strings.TrimSpace(rateFractionRaw)) == "true"
	data.RateDivisor = e.Settings.GetNumber(ctx, "PAYROLL_RATE_DIVISOR", 50)
	data.PlannedSessionsDefault = e.Settings.GetNumber(ctx, "PAYROLL_TERM_SESSIONS", 16)
	msPrefixRaw, _ := e.Settings.Get(ctx, "PAYROLL_MS_COURSE_PREFIX")
	for _, p := range strings.Split(msPrefixRaw, ",") {
		if p = strings.TrimSpace(p); p != "" {
			data.MsPrefixes = append(data.MsPrefixes, p)
		}
	}
	data.EffectiveDuties = LoadTermEffectiveDuties(ctx, e.Pool, termID)

	// each instructor's base rate: contract snapshot ← table rate (tenured over general) ← decree fraction
	year := e.FiscalYear(ctx)
	type rateRow struct {
		Rank   string
		Degree string
		Base   *string
		Rate   float64
		Year   int
	}
	rateRows := []rateRow{}
	rr, err := e.Pool.Query(ctx, `
		select "academicRank", "degree", "academicBase", "baseRatePerUnit"::float8, "effectiveYear"
		  from teaching_rates order by "effectiveYear"`)
	if err != nil {
		return nil, err
	}
	for rr.Next() {
		var r rateRow
		if err := rr.Scan(&r.Rank, &r.Degree, &r.Base, &r.Rate, &r.Year); err == nil {
			rateRows = append(rateRows, r)
		}
	}
	rr.Close()

	// an existing snapshot overrides the live value (migrations 0056/0090).
	for staffID, c := range data.Contracts {
		info, ok := data.StaffInfo[staffID]
		if !ok {
			continue
		}
		if c.RankSnapshot != nil {
			info.Info.Rank = c.RankSnapshot
			data.StaffInfo[staffID] = info
		}
		if c.BaseSnapshot != nil {
			info.Info.Base = c.BaseSnapshot
			data.StaffInfo[staffID] = info
		}
		if c.RateSnapshot != nil {
			data.RateByStaff[staffID] = *c.RateSnapshot
			data.RateSource[staffID] = "SNAPSHOT"
		}
	}
	for _, s := range staffRows {
		info := data.StaffInfo[s.id]
		rank := s.rank
		if info.Info.Rank != nil {
			rank = info.Info.Rank
		}
		sBase := s.base
		if info.Info.Base != nil {
			sBase = info.Info.Base
		}
		if rank == nil || s.degree == nil {
			data.RateByStaff[s.id] = 0
			data.RateSource[s.id] = "TABLE"
			continue
		}
		var applicable []rateRow
		for _, r := range rateRows {
			if r.Rank != *rank || r.Degree != *s.degree || r.Year > year {
				continue
			}
			if r.Base != nil && (sBase == nil || *r.Base != *sBase) {
				continue
			}
			applicable = append(applicable, r)
		}
		sort.SliceStable(applicable, func(i, j int) bool {
			bi := boolToInt(applicable[i].Base != nil)
			bj := boolToInt(applicable[j].Base != nil)
			if bi != bj {
				return bi > bj
			}
			return applicable[i].Year > applicable[j].Year
		})
		if len(applicable) > 0 {
			data.RateByStaff[s.id] = applicable[0].Rate
			if applicable[0].Base != nil {
				data.RateSource[s.id] = "BASE"
			} else {
				data.RateSource[s.id] = "TABLE"
			}
		} else {
			data.RateByStaff[s.id] = 0
			data.RateSource[s.id] = "TABLE"
		}
	}
	// decree fraction-rate switch (1/N) — highest priority.
	if data.RateFraction && data.RateDivisor > 0 {
		for staffID, c := range data.Contracts {
			if c.SalaryBase != nil && *c.SalaryBase > 0 {
				data.RateByStaff[staffID] = mathRoundF(*c.SalaryBase / data.RateDivisor)
				data.RateSource[staffID] = "FRACTION"
			}
		}
	}

	return data, nil
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func mathRoundF(v float64) float64 { return math.Round(v) }

// ─────────────────── merging concurrent classes ───────────────────

type mergeSlot struct {
	day        *int
	start, end string
	room       string
}

func normMergeTimeP(v string) string {
	if len(v) >= 5 {
		return v[:5]
	}
	return strings.TrimSpace(v)
}

// mergeGroupKey ports mergedGroupKey — merge key from the shared key or slots.
func mergeGroupKey(shared *string, slots []mergeSlot) string {
	if shared != nil && strings.TrimSpace(*shared) != "" {
		return "K:" + strings.TrimSpace(*shared)
	}
	parts := []string{}
	seen := map[string]bool{}
	for _, sl := range slots {
		st := normMergeTimeP(sl.start)
		en := normMergeTimeP(sl.end)
		if sl.day == nil || st == "" || en == "" {
			continue
		}
		room := sl.room
		if room == "" {
			room = "-"
		}
		p := strconv.Itoa(*sl.day) + "|" + st + "|" + en + "|" + room
		if !seen[p] {
			seen[p] = true
			parts = append(parts, p)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	sort.Strings(parts)
	return "S:" + strings.Join(parts, ";")
}

// collapseMergedOfferings ports collapseMergedOfferings for staffOffering.
func collapseMergedOfferings(list []*staffOffering, slotKeyOf func(int64) string) []*staffOffering {
	// group by mergeKey ?? slotKeyOf
	groups := []*staffOffering{}
	byKey := map[string][]*staffOffering{}
	for _, o := range list {
		key := ""
		if o.MergeKey != nil && strings.TrimSpace(*o.MergeKey) != "" {
			key = "K:" + strings.TrimSpace(*o.MergeKey)
		} else if k := slotKeyOf(o.OfferingID); k != "" {
			key = k
		}
		if key == "" {
			groups = append(groups, o)
			continue
		}
		byKey[key] = append(byKey[key], o)
	}
	_ = groups
	out := []*staffOffering{}
	emitted := map[int64]bool{}
	for _, o := range list {
		if emitted[o.OfferingID] {
			continue
		}
		key := ""
		if o.MergeKey != nil && strings.TrimSpace(*o.MergeKey) != "" {
			key = "K:" + strings.TrimSpace(*o.MergeKey)
		} else if k := slotKeyOf(o.OfferingID); k != "" {
			key = k
		}
		members := []*staffOffering{o}
		if key != "" {
			members = byKey[key]
		}
		for _, m := range members {
			emitted[m.OfferingID] = true
		}
		if len(members) > 1 {
			sort.SliceStable(members, func(i, j int) bool { return members[i].OfferingID < members[j].OfferingID })
			primary := members[0]
			codes := []string{}
			seenCode := map[string]bool{}
			maxUnits, maxPractical := 0, 0
			enrolled := 0
			ids := []int64{}
			for _, m := range members {
				if !seenCode[m.CourseCode] {
					seenCode[m.CourseCode] = true
					codes = append(codes, m.CourseCode)
				}
				if m.UnitsInt > maxUnits {
					maxUnits = m.UnitsInt
				}
				if m.PracticalUnits > maxPractical {
					maxPractical = m.PracticalUnits
				}
				enrolled += m.EnrolledCount
				ids = append(ids, m.OfferingID)
			}
			cp := *primary
			cp.CourseCode = strings.Join(codes, "/")
			cp.UnitsInt = maxUnits
			cp.PracticalUnits = maxPractical
			cp.EnrolledCount = enrolled
			cp.MergedMemberIds = ids
			out = append(out, &cp)
		} else {
			out = append(out, members[0])
		}
	}
	return out
}

func pickMergedSessions(data *termData, ids []int64) SessionStats {
	var best *SessionStats
	for _, id := range ids {
		if s, ok := data.SessionsByOffering[id]; ok {
			if best == nil || s.Held > best.Held {
				cp := s
				best = &cp
			}
		}
	}
	if best == nil {
		return SessionStats{}
	}
	return *best
}

// ─────────────────── computing one instructor's statement ───────────────────

// CalcStaffPayrollFromData computes one instructor's statement from preloaded data.
func CalcStaffPayrollFromData(data *termData, staffID int64) (*StaffPayroll, error) {
	meta, ok := data.StaffInfo[staffID]
	if !ok {
		return nil, errors.New("استاد یافت نشد.")
	}
	contract := data.Contracts[staffID]
	rate := data.RateByStaff[staffID]
	// duty comes from the instructor's "role", not rank; without a teaching role ← legacy baseDutyUnits.
	dutyUnits := 0.0
	if roleDuty, ok := data.EffectiveDuties[staffID]; ok {
		dutyUnits = roleDuty
	} else if contract != nil {
		dutyUnits = contract.BaseDuty
	}
	taxRate := 0.0
	if contract != nil {
		taxRate = contract.TaxRate
	}
	offerings := collapseMergedOfferings(data.OfferingsByStaff[staffID], func(id int64) string {
		return data.SlotsByOffering[id]
	})

	rows := []PayrollRow{}
	totalEquivInt := 0
	totalEffectiveInt := 0
	absenceDeductionRial := 0.0

	for _, o := range offerings {
		memberIDs := o.MergedMemberIds
		if memberIDs == nil {
			memberIDs = []int64{o.OfferingID}
		}
		sessions := pickMergedSessions(data, memberIDs)
		hasClass := false
		for _, id := range memberIDs {
			if _, ok := data.SlotsByOffering[id]; ok {
				hasClass = true
				break
			}
		}
		nth := data.RepeatCount[fmt.Sprintf("%d:%d", staffID, o.CourseID)] + 1
		rank := meta.Info.Rank
		rule := MatchRule(data.Rules, RuleMatch{
			OfferingType: o.OfferingType, Role: o.PayRole, Rank: rank, HasClass: hasClass,
			Enrolled: o.EnrolledCount, DeptID: o.DeptID, CourseType: o.CourseType, Nth: nth,
		})
		mergedMark := ""
		if len(memberIDs) > 1 {
			mergedMark = " (کلاس ادغامی)"
		}

		// ── unified expression path (0092): one expression, direct rial output ──
		if rule != nil {
			students := o.EnrolledCount
			crowdMult, _ := crowdedMult(students, data)
			expr := ""
			if rule.Expression != nil {
				expr = strings.TrimSpace(*rule.Expression)
			}
			if expr == "" {
				expr = "RT*UN"
			}
			flatBase := 0.0
			if rule.FlatBase != nil {
				flatBase = *rule.FlatBase
			}
			perStudentHours := 0.0
			if rule.PerStudentHours != nil {
				perStudentHours = *rule.PerStudentHours
			}
			rial, err := EvalFormula(expr, FormulaVars{
				"TH": o.TheoryUnits,
				"PH": float64(o.PracticalUnits) * 2,
				"WH": 0,
				"UN": float64(IntToUnits(o.UnitsInt)),
				"ST": float64(students),
				"RT": rate,
				"CF": crowdMult,
				"BS": flatBase,
				"HR": perStudentHours,
			})
			rial = ToRial(rial)
			equivInt := 0
			if rate > 0 {
				equivInt = int(mathRoundF((rial / rate) * UnitScale))
			}
			roleFa := roleLabel(data, o.PayRole)
			label := ""
			if err != nil {
				label = fmt.Sprintf("فرمول %s/%s — خطا: %v", offeringTypeFA(o.OfferingType), roleFa, err)
			} else {
				rep := ""
				if nth > 1 {
					rep = fmt.Sprintf(" (تکرار %d)", nth)
				}
				label = fmt.Sprintf("فرمول %s/%s%s: %s = %s", offeringTypeFA(o.OfferingType), roleFa, rep, expr, groupThousands(rial))
			}
			totalEquivInt += equivInt
			totalEffectiveInt += equivInt
			rt := rule.Title
			rows = append(rows, PayrollRow{
				OfferingID: o.OfferingID, CourseCode: o.CourseCode, CourseTitle: o.CourseTitle,
				Units: float64(IntToUnits(o.UnitsInt)), GroupNumber: o.GroupNumber, PayRole: o.PayRole,
				OfferingType: o.OfferingType, Coefficients: label + mergedMark,
				EquivalentUnits: float64(IntToUnits(equivInt)), Sessions: sessions,
				EffectiveUnits: float64(IntToUnits(equivInt)), AbsenceDeductionRial: 0, GrossRial: rial,
				RuleTitle: rt,
			})
			continue
		}

		// ── standard coefficients path ──
		applied := []string{}
		multiplierInt := UnitScale
		if o.PracticalUnits > 0 {
			multiplierInt = int(mathRoundF(float64(multiplierInt) * data.Coefs.Practical))
			applied = append(applied, fmt.Sprintf("عملی ×%s", fmtCoef(data.Coefs.Practical)))
		}
		msHit := false
		for _, c := range strings.Split(o.CourseCode, "/") {
			for _, p := range data.MsPrefixes {
				if strings.HasPrefix(c, p) {
					msHit = true
					break
				}
			}
			if msHit {
				break
			}
		}
		if msHit {
			multiplierInt = int(mathRoundF(float64(multiplierInt) * data.Coefs.MsLevel))
			applied = append(applied, fmt.Sprintf("ارشد ×%s", fmtCoef(data.Coefs.MsLevel)))
		}
		crowdMult, crowdLabel := crowdedMult(o.EnrolledCount, data)
		if crowdLabel != "" {
			multiplierInt = int(mathRoundF(float64(multiplierInt) * crowdMult))
			applied = append(applied, crowdLabel)
		}
		if mergedMark != "" {
			applied = append(applied, "کلاس ادغامی")
		}
		sharePct := o.SharePct
		if sharePct < 100 {
			applied = append(applied, fmt.Sprintf("سهم %d٪", int(sharePct)))
		}

		equivInt := int(mathRoundF(float64(o.UnitsInt) * float64(multiplierInt) / UnitScale * sharePct / 100))
		planned := float64(sessions.Planned)
		if planned == 0 {
			planned = data.PlannedSessionsDefault
		}
		effectiveInt := int(RatioOf(float64(equivInt), float64(planned)-float64(sessions.NetAbsences), planned))
		grossRial := ToRial(float64(IntToUnits(equivInt)) * rate)
		deduction := ToRial(float64(IntToUnits(equivInt-effectiveInt)) * rate)

		totalEquivInt += equivInt
		totalEffectiveInt += effectiveInt
		absenceDeductionRial += deduction

		coefText := "—"
		if len(applied) > 0 {
			coefText = strings.Join(applied, "، ")
		}
		rows = append(rows, PayrollRow{
			OfferingID: o.OfferingID, CourseCode: o.CourseCode, CourseTitle: o.CourseTitle,
			Units: float64(IntToUnits(o.UnitsInt)), GroupNumber: o.GroupNumber, PayRole: o.PayRole,
			OfferingType: o.OfferingType, Coefficients: coefText,
			EquivalentUnits: float64(IntToUnits(equivInt)), Sessions: sessions,
			EffectiveUnits: float64(IntToUnits(effectiveInt)), AbsenceDeductionRial: deduction, GrossRial: grossRial,
		})
	}

	dutyInt := UnitsToInt(dutyUnits)
	payableInt := maxInt(0, totalEffectiveInt-dutyInt)
	gross := ToRial(float64(IntToUnits(payableInt)) * rate)
	absenceTotal := ToRial(absenceDeductionRial)
	taxable := maxF(0, gross-absenceTotal)
	tax := ToRial((taxable * taxRate) / 100)
	net := maxF(0, taxable-tax)

	gates := data.GatesByStaff[staffID]
	gates.DocsSigned = gates.UnsignedDocs == 0
	gates.GradesFinalized = gates.PendingGrades == 0

	rateSource := data.RateSource[staffID]
	if rateSource == "" {
		rateSource = "TABLE"
	}
	out := &StaffPayroll{
		Staff: meta.Info, Rate: rate, RateSource: rateSource,
		RateDivisor: data.RateDivisor,
		DutyUnits:   dutyUnits, TaxRate: taxRate, Rows: rows,
		TotalEquivalentUnits: float64(IntToUnits(totalEquivInt)),
		TotalEffectiveUnits:  float64(IntToUnits(totalEffectiveInt)),
		PayableUnits:         float64(IntToUnits(payableInt)),
		Gross:                gross, AbsenceDeductionRial: absenceTotal, Tax: tax, Net: net,
		Gates: gates, HasContract: contract != nil,
	}
	return out, nil
}

func maxF(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

// groupThousands: format rials with thousands separators — display only.
func groupThousands(v float64) string {
	s := strconv.FormatFloat(mathRoundF(v), 'f', 0, 64)
	neg := strings.HasPrefix(s, "-")
	if neg {
		s = s[1:]
	}
	parts := []string{}
	for len(s) > 3 {
		parts = append([]string{s[len(s)-3:]}, parts...)
		s = s[:len(s)-3]
	}
	parts = append([]string{s}, parts...)
	out := strings.Join(parts, ",")
	if neg {
		return "-" + out
	}
	return out
}

// ─────────────────── lightweight gates ───────────────────

// loadStaffGates: an instructor's gates with two lightweight queries (inside the settlement transaction).
func loadStaffGates(ctx context.Context, q pgx.Tx, termID, staffID int64) (Gates, error) {
	var pending, unsigned int
	if err := q.QueryRow(ctx, `
		select count(e.id)::int from course_offerings o
		  join enrollments e on e."offeringId" = o.id and e.status = 'REGISTERED' and coalesce(e."gradeStatus", '') <> 'FINALIZED'
		 where o."termId" = $1
		   and (o."professorId" = $2 or exists (select 1 from offering_professors op where op."offeringId" = o.id and op."staffId" = $2))`,
		termID, staffID).Scan(&pending); err != nil {
		return Gates{}, err
	}
	if err := q.QueryRow(ctx, `
		select count(*)::int from electronic_documents ed
		 where ed."termId" = $1 and ed."staffId" = $2 and coalesce(ed."signatureStatus", '') <> 'SIGNED'`,
		termID, staffID).Scan(&unsigned); err != nil {
		return Gates{}, err
	}
	return Gates{
		PendingGrades: pending, UnsignedDocs: unsigned,
		GradesFinalized: pending == 0, DocsSigned: unsigned == 0,
	}, nil
}

// ─────────────────── whole-term view (payroll overview) ───────────────────

// GetOverview: whole-term statement view — instructors with a contract.
func (e *Engine) GetOverview(ctx context.Context, termID *int64) (*Overview, error) {
	term, err := e.CurrentTerm(ctx, termID)
	if err != nil {
		return nil, err
	}
	if term == nil {
		return nil, errors.New("ترم جاری مشخص نیست.")
	}
	data, err := e.LoadTermPayrollData(ctx, term.ID)
	if err != nil {
		return nil, err
	}
	ov := &Overview{Term: term.Title, List: []PayrollOverviewItem{}}
	staffIDs := make([]int64, 0, len(data.OfferingsByStaff))
	for sid := range data.OfferingsByStaff {
		staffIDs = append(staffIDs, sid)
	}
	sort.Slice(staffIDs, func(i, j int) bool { return staffIDs[i] < staffIDs[j] })
	for _, staffID := range staffIDs {
		if _, ok := data.Contracts[staffID]; !ok {
			continue
		}
		if _, ok := data.StaffInfo[staffID]; !ok {
			continue
		}
		calc, err := CalcStaffPayrollFromData(data, staffID)
		if err != nil {
			continue
		}
		ps := data.StatementsByStaff[staffID]
		midtermPaid, finalPaid := 0.0, 0.0
		status := "NOT_COMPUTED"
		if ps != nil {
			if ps.MidtermPaid != nil {
				midtermPaid = ToRial(*ps.MidtermPaid)
			}
			if ps.FinalPaid != nil {
				finalPaid = ToRial(*ps.FinalPaid)
			}
			if ps.Status != nil && *ps.Status != "" {
				status = *ps.Status
			}
		}
		item := PayrollOverviewItem{
			StaffMeta: calc.Staff,
			Rate:      calc.Rate, RateSource: calc.RateSource, DutyUnits: calc.DutyUnits,
			TotalEquivalentUnits: calc.TotalEquivalentUnits, TotalEffectiveUnits: calc.TotalEffectiveUnits,
			PayableUnits: calc.PayableUnits, Gross: calc.Gross, Tax: calc.Tax,
			AbsenceDeductionRial: calc.AbsenceDeductionRial, Net: calc.Net,
			Status: status, Gates: calc.Gates,
			MidtermPaid: midtermPaid, FinalPaid: finalPaid,
		}
		if ps != nil {
			id := ps.ID
			item.StatementID = &id
		}
		if status == "FINAL_SETTLED" {
			item.Remaining = 0
		} else {
			item.Remaining = maxF(0, calc.Net-midtermPaid-finalPaid)
		}
		ov.List = append(ov.List, item)
		ov.Totals.Budget += item.Net
		ov.Totals.Paid += item.MidtermPaid + item.FinalPaid
		ov.Totals.Remaining += item.Remaining
		ov.Totals.StaffCount++
	}
	return ov, nil
}

// ─────────────────── audit hash chain ───────────────────

// writeAudit: hash chain — each record links to the previous one.
func writeAudit(ctx context.Context, tx pgx.Tx, actorUserID *int64, action, entityType string, entityID *int64, details string) error {
	var prev string
	if err := tx.QueryRow(ctx, `select coalesce(hash,'') from audit_logs order by id desc limit 1 for update`).Scan(&prev); err != nil && err != pgx.ErrNoRows {
		prev = ""
	}
	h := sha256.Sum256([]byte(prev + "|" + action + "|" + entityType + "|" + itoa(entityID) + "|" + details))
	hash := hex.EncodeToString(h[:])
	_, err := tx.Exec(ctx, `
		insert into audit_logs ("actorUserId", action, "entityType", "entityId", details, "prevHash", hash)
		values ($1,$2,$3,$4,$5,$6,$7)`,
		actorUserID, action, entityType, entityID, details, prev, hash)
	return err
}

func itoa(v *int64) string {
	if v == nil {
		return ""
	}
	return strconv.FormatInt(*v, 10)
}

// notify: notify the instructor (insert into notifications — multi-channel in phase 10).
func (e *Engine) notify(ctx context.Context, userID int64, eventCode, text string) {
	if userID <= 0 {
		return
	}
	payload := `{"text":` + jsonString(text) + `}`
	_, _ = e.Pool.Exec(ctx, `insert into notifications ("userId","eventCode",payload) values ($1,$2,$3)`, userID, eventCode, payload)
	messaging.NotifyExternalDefault(ctx, userID, eventCode, text)
}

func jsonString(v string) string {
	out := make([]byte, 0, len(v)+2)
	out = append(out, '"')
	for _, r := range v {
		switch r {
		case '"':
			out = append(out, '\\', '"')
		case '\\':
			out = append(out, '\\', '\\')
		case '\n':
			out = append(out, '\\', 'n')
		case '\r':
			out = append(out, '\\', 'r')
		case '\t':
			out = append(out, '\\', 't')
		default:
			out = append(out, string(rune(r))...)
		}
	}
	out = append(out, '"')
	return string(out)
}
