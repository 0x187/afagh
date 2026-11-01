// ═══ Afagh tuition engine — port of lib/tuition-engine.ts (DB layer) ═══
//
// Rates are read from the unified tuition_rules table and rule selection is done with
// a single resolver (Resolve): degree level > major > term type > course type > entry cohort.
//   - Fixed tuition: charged once per term type (termLevelOnly)
//   - Variable tuition: per unit with theory/practical/general bucketing
//   - Semester escalation coefficient (tuition_coefficients) + subject-specific amounts (subject_fee_types)
package tuition

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Settings is the minimal settings dependency.
type Settings interface {
	Get(ctx context.Context, key string) (string, error)
}

// Engine is the tuition engine.
type Engine struct {
	Pool     *pgxpool.Pool
	Settings Settings
}

// New constructs the engine.
func New(pool *pgxpool.Pool, settings Settings) *Engine {
	return &Engine{Pool: pool, Settings: settings}
}

// TuitionLine is a variable-tuition row for one course.
type TuitionLine struct {
	CourseCode   string  `json:"courseCode"`
	CourseTitle  string  `json:"courseTitle"`
	OfferingType string  `json:"offeringType"`
	Units        float64 `json:"units"`
	PerUnit      float64 `json:"perUnit"`
	Amount       float64 `json:"amount"`
}

// SubjectFeeLine is a subject-specific amount row.
type SubjectFeeLine struct {
	Code   string  `json:"code"`
	Title  string  `json:"title"`
	Kind   string  `json:"kind"`
	Amount float64 `json:"amount"`
}

// TermTuition is the tuition of one term.
type TermTuition struct {
	StudentID                 int64            `json:"studentId"`
	TermID                    int64            `json:"termId"`
	TermType                  TermType         `json:"termType"`
	FixedTuition              float64          `json:"fixedTuition"`
	VariableTuition           float64          `json:"variableTuition"`
	FixedCoefficient          float64          `json:"fixedCoefficient"`
	VariableCoefficient       float64          `json:"variableCoefficient"`
	SubjectFees               []SubjectFeeLine `json:"subjectFees"`
	SubjectFeesTotal          float64          `json:"subjectFeesTotal"`
	FixedTuitionAfterCoeff    float64          `json:"fixedTuitionAfterCoeff"`
	VariableTuitionAfterCoeff float64          `json:"variableTuitionAfterCoeff"`
	TotalTuition              float64          `json:"totalTuition"`
	Lines                     []TuitionLine    `json:"lines"`
	FixedRuleID               *int64           `json:"fixedRuleId"`
	OverrideID                *int64           `json:"overrideId"`
	OverrideReason            *string          `json:"overrideReason"`
}

// loadActiveFeeRules returns all active tuition rules (one query).
func (e *Engine) loadActiveFeeRules(ctx context.Context) ([]RuleLike, error) {
	rows, err := e.Pool.Query(ctx, `
		select id, "degreeLevelId", "majorId", "facultyId", "termType", "offeringType", "clinicalPhase",
		       "entryYearFrom", "entryYearTo", "entryTermId", "currentTermId",
		       "fixedAmount"::float8, "perUnitTheory"::float8, "perUnitPractical"::float8, "perUnitGeneral"::float8,
		       "minSummerUnits"::float8, "percentUnderMin"::float8, priority, "isActive", "universityId"
		  from tuition_rules where "isActive" = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RuleLike{}
	for rows.Next() {
		var r RuleLike
		var fixed, theory, practical, general, minSummer, underMin *float64
		if err := rows.Scan(&r.ID, &r.DegreeLevelID, &r.MajorID, &r.FacultyID, &r.TermType, &r.OfferingType, &r.ClinicalPhase,
			&r.EntryYearFrom, &r.EntryYearTo, &r.EntryTermID, &r.CurrentTermID,
			&fixed, &theory, &practical, &general, &minSummer, &underMin, &r.Priority, &r.IsActive, &r.UniversityID); err != nil {
			continue
		}
		r.FixedAmount = fixed
		r.PerUnitTheory = theory
		r.PerUnitPractical = practical
		r.PerUnitGeneral = general
		r.MinSummerUnits = minSummer
		r.PercentUnderMin = underMin
		out = append(out, r)
	}
	return out, nil
}

type tuitionOverride struct {
	ID            int64
	TermID        *int64
	FixedAmount   float64
	PerUnitAmount float64
	Reason        *string
}

// findActiveTuitionOverride is the active special formula (priority: current term > all terms).
func (e *Engine) findActiveTuitionOverride(ctx context.Context, studentID, termID int64) (*tuitionOverride, error) {
	rows, err := e.Pool.Query(ctx, `
		select id, "termId", "fixedAmount"::float8, "perUnitAmount"::float8, reason
		  from student_tuition_overrides
		 where "studentId" = $1 and "isActive" = 1
		 order by id desc`, studentID)
	if err != nil {
		return nil, nil
	}
	defer rows.Close()
	var exact, global *tuitionOverride
	for rows.Next() {
		var o tuitionOverride
		if err := rows.Scan(&o.ID, &o.TermID, &o.FixedAmount, &o.PerUnitAmount, &o.Reason); err != nil {
			continue
		}
		if o.TermID != nil && *o.TermID == termID && exact == nil {
			cp := o
			exact = &cp
		}
		if o.TermID == nil && global == nil {
			cp := o
			global = &cp
		}
	}
	if exact != nil {
		return exact, nil
	}
	return global, nil
}

func (e *Engine) coefficientForTerm(ctx context.Context, termID int64) (fixed, variable float64) {
	fixed, variable = 1, 1
	var f, v *float64
	if err := e.Pool.QueryRow(ctx, `
		select "fixed_coefficient"::float8, "variable_coefficient"::float8
		  from tuition_coefficients where "termId" = $1 limit 1`, termID).Scan(&f, &v); err == nil {
		if f != nil && *f != 0 {
			fixed = *f
		}
		if v != nil && *v != 0 {
			variable = *v
		}
	}
	return fixed, variable
}

func (e *Engine) computeSubjectFees(ctx context.Context, studentID, termID int64, variableTuition, fixedTuition float64) ([]SubjectFeeLine, float64) {
	rows, err := e.Pool.Query(ctx, `
		select t.code, t.title, coalesce(t.kind,''), t."fixed_amount"::float8,
		       t."variable_percent"::float8, t."applies_to", s.amount::float8
		  from student_subject_fees s
		  join subject_fee_types t on t.id = s.subject_fee_type_id
		 where s.student_id = $1 and s.term_id = $2 and s.is_active = 1 and t."is_active" = 1`,
		studentID, termID)
	if err != nil {
		return []SubjectFeeLine{}, 0
	}
	defer rows.Close()
	lines := []SubjectFeeLine{}
	total := 0.0
	for rows.Next() {
		var code, title, kind string
		var fixedAmount, variablePercent, studentAmount float64
		var appliesTo *string
		if err := rows.Scan(&code, &title, &kind, &fixedAmount, &variablePercent, &appliesTo, &studentAmount); err != nil {
			continue
		}
		amount := studentAmount
		if amount == 0 {
			var variablePart float64
			if variablePercent > 0 {
				base := fixedTuition + variableTuition
				if appliesTo != nil && *appliesTo == "FIXED" {
					base = fixedTuition
				} else if appliesTo != nil && *appliesTo == "VARIABLE" {
					base = variableTuition
				}
				variablePart = mulberryRound((variablePercent / 100) * base)
			}
			amount = fixedAmount + variablePart
		}
		sign := 1.0
		if kind == "DEDUCTIVE" {
			sign = -1
		}
		final := sign * amount
		lines = append(lines, SubjectFeeLine{Code: code, Title: title, Kind: kind, Amount: final})
		total += final
	}
	return lines, total
}

func mulberryRound(v float64) float64 {
	sign := 1.0
	if v < 0 {
		sign = -1
	}
	if v < 0 {
		v = -v
	}
	return sign * float64(int64(v+0.5))
}

// ComputeTermTuition computes one term's tuition for one student.
func (e *Engine) ComputeTermTuition(ctx context.Context, studentID, termID int64, includeFixed bool) (*TermTuition, error) {
	var degreeLevelID, majorID, universityID *int64
	var entryYear *int
	if err := e.Pool.QueryRow(ctx, `
		select "degreeLevelId", "majorId", "entryYear", "universityId"
		  from students where id = $1`, studentID).
		Scan(&degreeLevelID, &majorID, &entryYear, &universityID); err != nil {
		return nil, errors.New("دانشجو یافت نشد")
	}
	var termTypeRaw, termCode *string
	var isSummer *int
	if err := e.Pool.QueryRow(ctx, `
		select "termType", "termCode", "isSummer" from academic_terms where id = $1`, termID).
		Scan(&termTypeRaw, &termCode, &isSummer); err != nil {
		return nil, errors.New("ترم یافت نشد")
	}
	termType := TermTypeOf(TermInput{TermType: termTypeRaw, TermCode: termCode, IsSummer: isSummer})
	termTypeStr := string(termType)

	rules, err := e.loadActiveFeeRules(ctx)
	if err != nil {
		return nil, err
	}
	override, _ := e.findActiveTuitionOverride(ctx, studentID, termID)
	overrideRate := 0.0
	if override != nil {
		overrideRate = override.PerUnitAmount
	}

	// Fixed tuition — charged once per term type; only term-level rules.
	fixedRule := Resolve(rules, Context{
		DegreeLevelID: degreeLevelID, MajorID: majorID, TermType: &termTypeStr,
		EntryYear: entryYear, TermLevelOnly: true, UniversityID: universityID,
	})
	fixedTuition := 0.0
	var fixedRuleID *int64
	if override != nil {
		fixedTuition = override.FixedAmount
	} else if includeFixed && fixedRule != nil {
		fixedTuition = ToNum(fixedRule.FixedAmount)
	}
	if includeFixed && override == nil && fixedRule != nil {
		id := fixedRule.ID
		fixedRuleID = &id
	}

	// The student's registered courses in this term (excluding the transferred course — its tuition is handled elsewhere).
	rows, err := e.Pool.Query(ctx, `
		select c.code, c.title, c.units::float8, c."theoreticalUnits"::float8, c."practicalUnits"::float8,
		       c."courseType", coalesce(o."offeringType",'NORMAL')
		  from enrollments en
		  join course_offerings o on o.id = en."offeringId"
		  join courses c on c.id = o."courseId"
		 where en."studentId" = $1 and o."termId" = $2 and en."sourceUniversityId" is null`, studentID, termID)
	if err != nil {
		return nil, err
	}
	lines := []TuitionLine{}
	variableTuition := 0.0
	for rows.Next() {
		var code, title, offeringType string
		var units float64
		var theoreticalUnits, practicalUnits *float64
		var courseType *string
		if err := rows.Scan(&code, &title, &units, &theoreticalUnits, &practicalUnits, &courseType, &offeringType); err != nil {
			continue
		}
		if override != nil {
			amount := mulberryRound(units * overrideRate)
			variableTuition += amount
			lines = append(lines, TuitionLine{CourseCode: code, CourseTitle: title, OfferingType: offeringType,
				Units: units, PerUnit: overrideRate, Amount: amount})
			continue
		}
		rule := Resolve(rules, Context{
			DegreeLevelID: degreeLevelID, MajorID: majorID, TermType: &termTypeStr,
			EntryYear: entryYear, OfferingType: &offeringType, UniversityID: universityID,
		})
		src := rule
		if src == nil {
			src = fixedRule
		}
		buckets := bucketCourseUnits(units, theoreticalUnits, practicalUnits, courseType)
		var theoryRate, practicalRate, generalRate float64
		if src != nil {
			theoryRate = ToNum(src.PerUnitTheory)
			practicalRate = ToNum(src.PerUnitPractical)
			generalRate = ToNum(src.PerUnitGeneral)
		}
		amount := mulberryRound(buckets.Theory*theoryRate + buckets.Practical*practicalRate + buckets.General*generalRate)
		perUnit := 0.0
		if units > 0 {
			perUnit = mulberryRound(amount / units)
		}
		variableTuition += amount
		lines = append(lines, TuitionLine{CourseCode: code, CourseTitle: title, OfferingType: offeringType,
			Units: units, PerUnit: perUnit, Amount: amount})
	}
	rows.Close()

	fixedCoeff, variableCoeff := e.coefficientForTerm(ctx, termID)
	fixedAfter := mulberryRound(fixedTuition * fixedCoeff)
	variableAfter := mulberryRound(variableTuition * variableCoeff)
	subjectLines, subjectTotal := e.computeSubjectFees(ctx, studentID, termID, variableAfter, fixedAfter)

	out := &TermTuition{
		StudentID: studentID, TermID: termID, TermType: termType,
		FixedTuition: fixedTuition, VariableTuition: variableTuition,
		FixedCoefficient: fixedCoeff, VariableCoefficient: variableCoeff,
		SubjectFees: subjectLines, SubjectFeesTotal: subjectTotal,
		FixedTuitionAfterCoeff: fixedAfter, VariableTuitionAfterCoeff: variableAfter,
		TotalTuition: fixedAfter + variableAfter + subjectTotal,
		Lines:        lines, FixedRuleID: fixedRuleID,
	}
	if override != nil {
		out.OverrideID = &override.ID
		out.OverrideReason = override.Reason
	}
	return out, nil
}

// ChargeTermTuition charges the computed tuition into the financial ledger (idempotent via
// referenceId=termId and type TUITION_CHARGE; row lock + unique partial backstop).
func (e *Engine) ChargeTermTuition(ctx context.Context, studentID, termID int64, includeFixed bool) (float64, float64, error) {
	t, err := e.ComputeTermTuition(ctx, studentID, termID, includeFixed)
	if err != nil {
		return 0, 0, err
	}
	amount := t.TotalTuition
	if amount < 0 {
		amount = 0
	}
	amount = mulberryRound(amount)

	var termTitle string
	_ = e.Pool.QueryRow(ctx, `select title from academic_terms where id = $1`, termID).Scan(&termTitle)
	coeffNote := ""
	if t.FixedCoefficient != 1 || t.VariableCoefficient != 1 {
		coeffNote = fmt.Sprintf(" [ضریب: ثابت×%s، متغیر×%s]", fmtNum(t.FixedCoefficient), fmtNum(t.VariableCoefficient))
	}
	subjectNote := ""
	if t.SubjectFeesTotal != 0 {
		sign := ""
		if t.SubjectFeesTotal > 0 {
			sign = "+"
		}
		subjectNote = fmt.Sprintf(" + موضوعی %s%s", sign, fmtNum(t.SubjectFeesTotal))
	}
	desc := fmt.Sprintf("شهریهٔ ترم «%s» — ثابت %s + متغیر %s%s%s",
		termTitle, fmtNum(t.FixedTuitionAfterCoeff), fmtNum(t.VariableTuitionAfterCoeff), subjectNote, coeffNote)

	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx)

	var uniID *int64
	if err := tx.QueryRow(ctx, `select "universityId" from students where id = $1`, studentID).Scan(&uniID); err != nil {
		return 0, 0, errors.New("دانشجو یافت نشد")
	}
	if uniID == nil {
		return 0, 0, errors.New("دانشگاه دانشجو نامشخص است؛ شارژ ممکن نیست")
	}
	var existingID int64
	err = tx.QueryRow(ctx, `
		select id from student_ledger
		 where "studentId" = $1 and "termId" = $2 and "transactionType" = 'TUITION_CHARGE'
		 for update`, studentID, termID).Scan(&existingID)

	if amount == 0 && err != nil {
		return 0, t.TotalTuition, tx.Commit(ctx)
	}
	if err == nil {
		if _, err := tx.Exec(ctx, `
			update student_ledger set amount = $2, description = $3 where id = $1`,
			existingID, fmtNum(amount), desc); err != nil {
			return 0, 0, err
		}
	} else {
		if _, err := tx.Exec(ctx, `
			insert into student_ledger ("studentId","termId","transactionType",amount,description,"referenceId","universityId")
			values ($1,$2,'TUITION_CHARGE',$3,$4,$2,$5)`,
			studentID, termID, fmtNum(amount), desc, *uniID); err != nil {
			// Concurrent races are rare (unique backstop): update the winning row.
			if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "23505") {
				var winner int64
				if err2 := tx.QueryRow(ctx, `
					select id from student_ledger
					 where "studentId" = $1 and "termId" = $2 and "transactionType" = 'TUITION_CHARGE'
					 for update`, studentID, termID).Scan(&winner); err2 == nil {
					if _, err3 := tx.Exec(ctx, `update student_ledger set amount = $2, description = $3 where id = $1`,
						winner, fmtNum(amount), desc); err3 != nil {
						return 0, 0, err3
					}
				} else {
					return 0, 0, err
				}
			} else {
				return 0, 0, err
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return amount, t.TotalTuition, nil
}

// ComputeCourseTuitionForTerms gives the detailed variable tuition of courses for multiple terms (detailed financial transcript).
func (e *Engine) ComputeCourseTuitionForTerms(ctx context.Context, studentID int64, termIDs []int64) map[int64][]TuitionLine {
	out := map[int64][]TuitionLine{}
	for _, tid := range termIDs {
		t, err := e.ComputeTermTuition(ctx, studentID, tid, true)
		if err != nil || t == nil {
			out[tid] = []TuitionLine{}
			continue
		}
		out[tid] = t.Lines
	}
	return out
}

// GetEquivFixedMode is the equivalency fixed-tuition policy (EQUIV_FIXED_TUITION_MODE setting).
func (e *Engine) GetEquivFixedMode(ctx context.Context) EquivFixedMode {
	raw := ""
	if e.Settings != nil {
		raw, _ = e.Settings.Get(ctx, "EQUIV_FIXED_TUITION_MODE")
	}
	return NormalizeEquivFixedMode(raw)
}

// EquivTermsFor is the equivalency term row (open shift for the workflow package).
type EquivTerm struct {
	ID    int64
	Title string
}

func fmtNum(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// EnsureEquivalenceTerm ensures the "00EQn" equivalency term owned by the same university — idempotent.
func (e *Engine) EnsureEquivalenceTerm(ctx context.Context, universityID int64, termCode, title string) (*EquivTerm, error) {
	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var t EquivTerm
	err = tx.QueryRow(ctx, `
		select id, title from academic_terms
		 where "termCode" = $1 and "universityId" = $2 limit 1`, termCode, universityID).Scan(&t.ID, &t.Title)
	if err == nil {
		return &t, nil
	}
	err = tx.QueryRow(ctx, `
		insert into academic_terms ("universityId","termCode",title,"termType","isCurrent","isSummer","isEnrollmentOpen","startDate","endDate")
		values ($1,$2,$3,'EQUIVALENCE',0,0,0,'2000-01-01','2000-06-30')
		on conflict ("universityId","termCode") do nothing
		returning id, title`, universityID, termCode, title).Scan(&t.ID, &t.Title)
	if err != nil {
		if err := tx.QueryRow(ctx, `
			select id, title from academic_terms
			 where "termCode" = $1 and "universityId" = $2 limit 1`, termCode, universityID).Scan(&t.ID, &t.Title); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &t, nil
}

// ApplyEquivalenceRegistration registers the equivalized course in the TRANSFER offering
// (the registration part of applyEquivalenceBatch — no charging; charging is done by ChargeTermTuition).
func (e *Engine) ApplyEquivalenceRegistration(ctx context.Context, tx pgx.Tx, studentID, termID, courseID int64, grade float64, workflowRequestID *int64) (bool, error) {
	var offeringID int64
	err := tx.QueryRow(ctx, `
		select id from course_offerings
		 where "courseId" = $1 and "termId" = $2 and "offeringType" = 'TRANSFER' limit 1`,
		courseID, termID).Scan(&offeringID)
	if err != nil {
		err = tx.QueryRow(ctx, `
			insert into course_offerings ("termId","courseId","groupNumber",capacity,"enrolledCount","offeringType","isActive")
			values ($1,$2,900,500,0,'TRANSFER',1) returning id`, termID, courseID).Scan(&offeringID)
		if err != nil {
			_ = tx.QueryRow(ctx, `
				select id from course_offerings
				 where "courseId" = $1 and "termId" = $2 and "offeringType" = 'TRANSFER' limit 1`,
				courseID, termID).Scan(&offeringID)
			if err == nil {
				return false, nil
			}
			return false, err
		}
	}
	var existingID int64
	err = tx.QueryRow(ctx, `
		select id from enrollments where "studentId" = $1 and "offeringId" = $2 limit 1`,
		studentID, offeringID).Scan(&existingID)
	if err == nil {
		_, uerr := tx.Exec(ctx, `
			update enrollments set status = 'EQUIV_PASSED', "workflowRequestId" = $2,
			  "gradeValue" = $3, "gradeStatus" = 'FINALIZED'
			 where id = $1`, existingID, workflowRequestID, fmtNum(grade))
		return true, uerr
	}
	_, ierr := tx.Exec(ctx, `
		insert into enrollments ("studentId","offeringId","isDirectedReading",status,"workflowRequestId","gradeValue","gradeStatus")
		values ($1,$2,0,'EQUIV_PASSED',$3,$4,'FINALIZED')`,
		studentID, offeringID, workflowRequestID, fmtNum(grade))
	return ierr == nil, ierr
}

// ─────────────────── Unit bucketing (port of bucketCourseUnits) ───────────────────

type unitBuckets struct {
	Theory    float64
	Practical float64
	General   float64
}

func normalizeType(t string) string {
	rep := map[rune]rune{'ي': 'ی', 'ك': 'ک', 'ة': 'ه'}
	out := []rune{}
	for _, r := range t {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\u200c' || r == '\u200d' {
			continue
		}
		if mapped, ok := rep[r]; ok {
			r = mapped
		}
		if r >= 'a' && r <= 'z' {
			r = r - 'a' + 'A'
		}
		out = append(out, r)
	}
	return string(out)
}

func bucketCourseUnits(units float64, theoreticalUnits, practicalUnits *float64, courseType *string) unitBuckets {
	u := units
	typ := ""
	if courseType != nil {
		typ = normalizeType(*courseType)
	}
	if typ == "GENERAL" || typ == "عمومی" || typ == "OMOMI" {
		return unitBuckets{General: u}
	}
	practical := u
	if practicalUnits != nil && *practicalUnits < u {
		practical = *practicalUnits
	}
	if practical < 0 {
		practical = 0
	}
	theory := u - practical
	if theoreticalUnits != nil && *theoreticalUnits < theory {
		theory = *theoreticalUnits
	}
	if theory < 0 {
		theory = 0
	}
	leftover := u - practical - theory
	if leftover < 0 {
		leftover = 0
	}
	return unitBuckets{Theory: theory + leftover, Practical: practical}
}
