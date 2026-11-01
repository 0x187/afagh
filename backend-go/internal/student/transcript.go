// ═══ Student transcript — port of student/transcript/page.tsx ═══
//
// GPA calculations come from the pure gpa core (the same functions used by the regulation engine
// and graduation) so the transcript and verification can never diverge.
package student

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"backend-go/internal/gpa"
	"backend-go/internal/qr"
	"backend-go/internal/scheduling"
)

// transcriptStatusFa is the transcript page's statusFa equivalent.
var transcriptStatusFa = map[string]string{
	"REGISTERED":      "ثبت قطعی",
	"WAITLISTED":      "اتاق انتظار",
	"PENDING_COUNCIL": "در انتظار شورا",
	"DROPPED":         "حذف‌شده",
	"ABSENT":          "غایب",
	"REJECTED":        "مردود",
	"ACTIVE":          "مجاز به ادامه تحصیل",
	"PROBATION":       "مشروط",
	"GRADUATED":       "فارغ‌التحصیل",
}

// RecordOption is a multi-level record option.
type RecordOption struct {
	ID          int64   `json:"id"`
	StudentCode string  `json:"studentCode"`
	Status      string  `json:"status"`
	DegreeTitle *string `json:"degreeTitle"`
	EntryYear   int     `json:"entryYear"`
}

// TranscriptRow is one transcript course row.
type TranscriptRow struct {
	EnrollmentID        int64    `json:"enrollmentId"`
	Code                string   `json:"code"`
	Title               string   `json:"title"`
	Units               int      `json:"units"`
	CourseType          *string  `json:"courseType"`
	GradingType         *string  `json:"gradingType"`
	AffectsGpa          *int     `json:"affectsGpa"`
	CourseMinMark       *float64 `json:"courseMinMark"`
	Status              string   `json:"status"`
	EmergencyWithdrawal bool     `json:"emergencyWithdrawal"`
	Grade               *float64 `json:"grade"`
	GradeStatus         *string  `json:"gradeStatus"`
	HasEvaluated        bool     `json:"hasEvaluated"`
	// Display calculations
	IsDescriptive bool    `json:"isDescriptive"`
	PassMark      float64 `json:"passMark"`
	Result        string  `json:"result"` // PASSED|FAILED|PENDING|EQUIV|EMERGENCY|OTHER
}

// TermBlock is one term in the transcript.
type TermBlock struct {
	TermID       int64           `json:"termId"`
	TermCode     string          `json:"termCode"`
	Title        string          `json:"title"`
	IsCurrent    bool            `json:"isCurrent"`
	TermType     string          `json:"termType"`
	DisplayYear  string          `json:"displayYear"`
	DisplayTerm  string          `json:"displayTerm"`
	Semester     string          `json:"semester"`
	DisplayTitle string          `json:"displayTitle"`
	Rows         []TranscriptRow `json:"rows"`
	Units        int             `json:"units"`
	PassedUnits  int             `json:"passedUnits"`
	GradedUnits  int             `json:"gradedUnits"`
	GPA          *float64        `json:"gpa"`
	IsHonor      bool            `json:"isHonor"`
	IsProbation  bool            `json:"isProbation"`
}

// AcademicYearBlock is an academic-year group.
type AcademicYearBlock struct {
	AcademicYear int         `json:"academicYear"`
	DisplayYear  string      `json:"displayYear"`
	IsEquivalent bool        `json:"isEquivalent"`
	Terms        []TermBlock `json:"terms"`
}

// TranscriptTotals is the whole-period summary.
type TranscriptTotals struct {
	EnrolledUnits int      `json:"enrolledUnits"`
	PassedUnits   int      `json:"passedUnits"`
	FailedUnits   int      `json:"failedUnits"`
	GradedUnits   int      `json:"gradedUnits"`
	GPA           *float64 `json:"gpa"`
	ExcludedCount int      `json:"excludedCount"`
}

// TranscriptQR is the verification block.
type TranscriptQR struct {
	URL       string `json:"url"`
	SVG       string `json:"svg"`
	ExpiresAt string `json:"expiresAt"`
}

// TranscriptResponse is the transcript document.
type TranscriptResponse struct {
	Student          StudentInfo         `json:"student"`
	University       UniversityInfo      `json:"university"`
	Records          []RecordOption      `json:"records"`
	ActiveRecordID   int64               `json:"activeRecordId"`
	NationalIDMasked string              `json:"nationalIdMasked"`
	DegreeTitle      string              `json:"degreeTitle"`
	MajorName        string              `json:"majorName"`
	EntryYear        int                 `json:"entryYear"`
	StudyType        string              `json:"studyType"`
	Status           string              `json:"status"`
	StatusLabel      string              `json:"statusLabel"`
	RegulationTitle  string              `json:"regulationTitle"`
	RegulationPolicy string              `json:"regulationPolicy"`
	AcademicYears    []AcademicYearBlock `json:"academicYears"`
	Totals           TranscriptTotals    `json:"totals"`
	GeneratedAt      string              `json:"generatedAt"`
	QR               *TranscriptQR       `json:"qr"`
}

type regulationConfig struct {
	Title          string
	Policy         string
	PassingGrade   float64
	RetakeMinGrade float64
	DedupeRepeated bool
}

// loadRegulation ports getRegulationConfig + the transcript page's regulation selection.
func (s *Service) loadRegulation(ctx context.Context, me *Record) regulationConfig {
	cfg := regulationConfig{
		Title:          "آیین‌نامهٔ آموزشی دورهٔ تحصیلی",
		Policy:         "EXCLUDE_IF_PASSED",
		PassingGrade:   10,
		RetakeMinGrade: 10,
	}
	if me.DegreeLevelID == nil {
		return cfg
	}
	rows, err := s.Pool.Query(ctx, `
		select id, title, "effectiveFromYear", "effectiveToYear", "rulesConfig"
		  from educational_regulations
		 where "degreeLevelId" = $1`, *me.DegreeLevelID)
	if err != nil {
		return cfg
	}
	defer rows.Close()

	type regRow struct {
		id    int64
		title string
		from  int
		to    *int
		raw   string
	}
	all := []regRow{}
	for rows.Next() {
		var r regRow
		if err := rows.Scan(&r.id, &r.title, &r.from, &r.to, &r.raw); err != nil {
			return cfg
		}
		all = append(all, r)
	}

	inWindow := func(r regRow) bool {
		return r.from <= me.EntryYear && (r.to == nil || *r.to >= me.EntryYear)
	}
	var chosen *regRow
	if me.RegulationID != nil {
		for i := range all {
			if all[i].id == *me.RegulationID && inWindow(all[i]) {
				chosen = &all[i]
				break
			}
		}
	}
	if chosen == nil {
		// The newest valid regulation by entry year
		var candidates []regRow
		for _, r := range all {
			if inWindow(r) {
				candidates = append(candidates, r)
			}
		}
		sort.Slice(candidates, func(i, j int) bool { return candidates[i].from > candidates[j].from })
		if len(candidates) > 0 {
			chosen = &candidates[0]
		}
	}
	if chosen == nil && me.RegulationID != nil {
		for i := range all {
			if all[i].id == *me.RegulationID {
				chosen = &all[i]
				break
			}
		}
	}

	if chosen != nil && strings.TrimSpace(chosen.title) != "" {
		cfg.Title = chosen.title
	}
	raw := ""
	if chosen != nil {
		raw = chosen.raw
	}
	applyRulesConfig(&cfg, raw)
	return cfg
}

// applyRulesConfig parses rulesConfig supporting flat keys (legacy seed) and the
// nested grading_and_gpa structure.
func applyRulesConfig(cfg *regulationConfig, raw string) {
	if strings.TrimSpace(raw) == "" {
		return
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return
	}
	gpaCfg := parsed
	if nested, ok := parsed["grading_and_gpa"].(map[string]any); ok {
		gpaCfg = nested
	}
	if v, ok := gpaCfg["failed_course_gpa_policy"].(string); ok && v != "" {
		cfg.Policy = v
	}
	if n := numberFromAny(gpaCfg["default_passing_grade"]); n != nil && *n > 0 {
		cfg.PassingGrade = *n
		cfg.RetakeMinGrade = *n
	}
	if n := numberFromAny(gpaCfg["retakeMinGrade"]); n != nil {
		cfg.RetakeMinGrade = *n
	}
	if v, ok := gpaCfg["dedupeRepeatedCourses"].(bool); ok {
		cfg.DedupeRepeated = v
	}
	if v, ok := gpaCfg["regulationLabel"].(string); ok && v != "" {
		cfg.Title = v
	}
}

func numberFromAny(v any) *float64 {
	switch n := v.(type) {
	case float64:
		return &n
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		if err == nil {
			return &f
		}
	}
	return nil
}

// Records ports myRecords: all student records of one user.
func (s *Service) Records(ctx context.Context, userID int64) ([]RecordOption, error) {
	rows, err := s.Pool.Query(ctx, `
		select st.id, st."studentCode", st.status, dlc.title, st."entryYear"
		  from students st
		  left join degree_level_configs dlc on dlc.id = st."degreeLevelId"
		 where st."userId" = $1
		 order by st."entryYear" desc, st.id desc`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RecordOption{}
	for rows.Next() {
		var r RecordOption
		if err := rows.Scan(&r.ID, &r.StudentCode, &r.Status, &r.DegreeTitle, &r.EntryYear); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// resolveRecord ports the transcript record selection: default picked; if recordId
// belongs to the same user, that one (another level).
func (s *Service) resolveRecord(ctx context.Context, userID int64, picked *Record, recordID *int64) (*Record, error) {
	if recordID == nil || *recordID == picked.ID {
		return picked, nil
	}
	var r Record
	err := s.Pool.QueryRow(ctx, `
		select id, "userId", "studentCode", "universityId", "majorId", "degreeLevelId",
		       "regulationId", "entryYear", "entryTerm", "currentTermNo", status,
		       "studyType"
		  from students where id = $1 and "userId" = $2`, *recordID, userID).
		Scan(&r.ID, &r.UserID, &r.StudentCode, &r.UniversityID, &r.MajorID, &r.DegreeLevelID,
			&r.RegulationID, &r.EntryYear, &r.EntryTerm, &r.CurrentTermNo, &r.Status,
			&r.StudyType)
	if err != nil {
		return picked, nil
	}
	return &r, nil
}

// GetTranscript is the full transcript document.
func (s *Service) GetTranscript(ctx context.Context, userID int64, userName string, recordID *int64, termCookie *int64, publicBaseURL string) (*TranscriptResponse, error) {
	picked, err := s.Resolve(ctx, userID)
	if err != nil {
		return nil, err
	}
	if picked == nil {
		return nil, errNoStudent
	}
	me, err := s.resolveRecord(ctx, userID, picked, recordID)
	if err != nil {
		return nil, err
	}

	info, termID, termTitle, termCode := s.describeStudent(ctx, me, userName, termCookie)
	_ = termTitle
	_ = termCode

	records, err := s.Records(ctx, userID)
	if err != nil {
		return nil, err
	}

	resp := &TranscriptResponse{
		Student:        info,
		University:     s.universityInfo(ctx, me.UniversityID),
		Records:        records,
		ActiveRecordID: me.ID,
		DegreeTitle:    info.DegreeTitle,
		MajorName:      info.MajorName,
		EntryYear:      me.EntryYear,
		Status:         me.Status,
		StatusLabel:    transcriptStatusFa[me.Status],
		GeneratedAt:    "",
		AcademicYears:  []AcademicYearBlock{},
	}
	if resp.StatusLabel == "" {
		resp.StatusLabel = me.Status
	}

	// Masked national code
	var nationalCode *string
	_ = s.Pool.QueryRow(ctx, `select "nationalCode" from users where id = $1`, userID).Scan(&nationalCode)
	resp.NationalIDMasked = maskNationalCode(nationalCode)

	studyRaw := ""
	if me.StudyType != nil {
		studyRaw = strings.TrimSpace(*me.StudyType)
	}
	resp.StudyType = studyTypeFa(studyRaw)

	reg := s.loadRegulation(ctx, me)
	resp.RegulationTitle = reg.Title
	if reg.Policy == "KEEP_ALWAYS" {
		resp.RegulationPolicy = "نگهداری همیشه نمرهٔ ردی در معدل کل"
	} else {
		resp.RegulationPolicy = "حذف نمرهٔ مردودی از معدل کل پس از قبولی مجدد"
	}

	// All course history.
	rows, err := s.Pool.Query(ctx, `
		select e.id, c.code, c.title, coalesce(c.units,0)::int, c."courseType",
		       c."gradingType", c."affectsGpa", c."minPassedMark",
		       e.status, e."emergencyWithdrawal", e."gradeValue", e."gradeStatus",
		       e."hasEvaluated",
		       o."termId", t.title, t."termCode", t."isCurrent"
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		  join academic_terms t on t.id = o."termId"
		 where e."studentId" = $1
		 order by t."termCode" asc, e.id desc`, me.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	allRows := []struct {
		row       TranscriptRow
		termID    int64
		termTitle string
		termCode  string
		isCurrent bool
	}{}
	gpaRows := []gpa.Row{}
	for rows.Next() {
		var r TranscriptRow
		var termID int64
		var termTitle, termCode string
		var isCurrent, emergency, hasEvaluated int
		if err := rows.Scan(&r.EnrollmentID, &r.Code, &r.Title, &r.Units, &r.CourseType,
			&r.GradingType, &r.AffectsGpa, &r.CourseMinMark,
			&r.Status, &emergency, &r.Grade, &r.GradeStatus,
			&hasEvaluated,
			&termID, &termTitle, &termCode, &isCurrent); err != nil {
			return nil, err
		}
		r.EmergencyWithdrawal = emergency != 0
		r.HasEvaluated = hasEvaluated != 0
		allRows = append(allRows, struct {
			row       TranscriptRow
			termID    int64
			termTitle string
			termCode  string
			isCurrent bool
		}{r, termID, termTitle, termCode, isCurrent != 0})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Eligible GPA rows: same rule as loadOfficialGpaRows.
	for _, item := range allRows {
		if item.row.GradeStatus == nil {
			continue
		}
		switch *item.row.GradeStatus {
		case "FINALIZED", "EXEMPT", "PASSED_NO_GRADE":
			var gradeVal any
			if item.row.Grade != nil {
				gradeVal = *item.row.Grade
			}
			var minMark any
			if item.row.CourseMinMark != nil {
				minMark = *item.row.CourseMinMark
			}
			gpaRows = append(gpaRows, gpa.Row{
				Code:                item.row.Code,
				Units:               item.row.Units,
				GradeValue:          gradeVal,
				GradeStatus:         item.row.GradeStatus,
				SamaGradeStatusCode: nil,
				GradingType:         item.row.GradingType,
				AffectsGpa:          item.row.AffectsGpa,
				CourseMinMark:       minMark,
			})
		}
	}
	official := gpa.AggregateOfficialGpaRows(gpaRows, gpa.OfficialInput{
		PassingGrade:   reg.PassingGrade,
		RetakeMinGrade: reg.RetakeMinGrade,
		Policy:         reg.Policy,
		DedupeRepeated: reg.DedupeRepeated,
	})

	// Filter for the selected term.
	scoped := allRows
	if termID != nil {
		var filtered = allRows[:0:0]
		for _, item := range allRows {
			if item.termID == *termID {
				filtered = append(filtered, item)
			}
		}
		scoped = filtered
	}

	// Group courses by term + per-term calculations.
	type termAgg struct {
		block TermBlock
	}
	byTerm := map[int64]*termAgg{}
	order := []int64{}
	for _, item := range scoped {
		agg, ok := byTerm[item.termID]
		if !ok {
			agg = &termAgg{block: TermBlock{
				TermID: item.termID, TermCode: item.termCode, Title: item.termTitle,
				IsCurrent: item.isCurrent, Rows: []TranscriptRow{},
			}}
			byTerm[item.termID] = agg
			order = append(order, item.termID)
		}
		r := item.row
		r.IsDescriptive = r.GradingType != nil && *r.GradingType == "DESCRIPTIVE" ||
			(r.Grade != nil && *r.Grade == 1) ||
			(r.AffectsGpa != nil && *r.AffectsGpa == 0)
		r.PassMark = 10
		if r.CourseMinMark != nil && *r.CourseMinMark >= 0 && *r.CourseMinMark <= 20 {
			r.PassMark = *r.CourseMinMark
		}
		r.Result = transcriptResult(r)
		agg.block.Rows = append(agg.block.Rows, r)
	}

	// Compute per-term statistics following the transcript page logic.
	for _, id := range order {
		b := &byTerm[id].block
		weighted := 0.0
		for _, r := range b.Rows {
			b.Units += r.Units
			if r.IsDescriptive {
				if (r.Grade != nil && *r.Grade == 1) || (r.Grade != nil && *r.Grade >= 10) {
					b.PassedUnits += r.Units
				}
				continue
			}
			if r.Grade != nil && *r.Grade >= 10 {
				b.PassedUnits += r.Units
			}
			if r.Grade != nil && *r.Grade >= 0 && *r.Grade <= 20 {
				b.GradedUnits += r.Units
				weighted += *r.Grade * float64(r.Units)
			}
		}
		if b.GradedUnits > 0 {
			v := weighted / float64(b.GradedUnits)
			rounded := roundTo2(v)
			b.GPA = &rounded
			b.IsHonor = rounded >= 17
			b.IsProbation = rounded < 12
		}
	}

	// Year sorting/grouping, ported from scheduling-core.
	terms := make([]scheduling.TermWithCode, 0, len(order))
	for _, id := range order {
		terms = append(terms, scheduling.TermWithCode{TermCode: byTerm[id].block.TermCode, Rows: byTerm[id].block})
	}
	groups := scheduling.GroupTermsByAcademicYear(terms)
	for _, g := range groups {
		block := AcademicYearBlock{
			AcademicYear: g.AcademicYear,
			DisplayYear:  g.DisplayYear,
			IsEquivalent: g.AcademicYear == scheduling.EquivalenceGroupYear,
			Terms:        []TermBlock{},
		}
		for _, t := range g.Terms {
			tb, ok := t.Rows.(TermBlock)
			if !ok {
				continue
			}
			tb.DisplayYear = t.Normalized.DisplayYear
			tb.DisplayTerm = strconv.Itoa(t.Normalized.Semester)
			tb.Semester = strconv.Itoa(t.Normalized.Semester)
			tb.TermType = t.Normalized.TermType
			if t.Normalized.TermType == "EQUIVALENCE" && strings.TrimSpace(tb.Title) != "" {
				tb.DisplayTitle = tb.Title
			} else {
				tb.DisplayTitle = t.Normalized.DisplaySemester
			}
			block.Terms = append(block.Terms, tb)
		}
		resp.AcademicYears = append(resp.AcademicYears, block)
	}

	// Whole program summary.
	totals := TranscriptTotals{
		PassedUnits:   int(official.PassedUnits + 0.5),
		GradedUnits:   int(official.TotalUnits + 0.5),
		ExcludedCount: official.ExcludedCount,
	}
	if official.TotalUnits > 0 {
		v := official.GPA
		totals.GPA = &v
	}
	for _, item := range allRows {
		r := item.row
		u := r.Units
		if r.Status == "REGISTERED" || r.Status == "PENDING_COUNCIL" {
			totals.EnrolledUnits += u
		}
		isDescriptive := (r.GradingType != nil && *r.GradingType == "DESCRIPTIVE") ||
			(r.Grade != nil && *r.Grade == 1) ||
			(r.AffectsGpa != nil && *r.AffectsGpa == 0)
		if isDescriptive {
			if r.Grade != nil && *r.Grade == 0 {
				totals.FailedUnits += u
			}
		} else if r.Grade != nil && *r.Grade < 10 {
			totals.FailedUnits += u
		}
	}
	resp.Totals = totals

	// Authenticity QR block — a missing key must not break the transcript.
	if s.Signer != nil && publicBaseURL != "" {
		if token, expiresAt, err := s.issueTranscriptToken(ctx, userID, me); err == nil {
			url := strings.TrimRight(publicBaseURL, "/") + "/verify-transcript/" + token
			if svg, err := qr.SVG(url, qr.Options{Level: "Q", Size: 128, Margin: 4}); err == nil {
				resp.QR = &TranscriptQR{URL: url, SVG: svg, ExpiresAt: expiresAt}
			}
		}
	}
	return resp, nil
}

func transcriptResult(r TranscriptRow) string {
	if r.EmergencyWithdrawal {
		return "EMERGENCY"
	}
	if r.Status == "EQUIV_PASSED" {
		return "EQUIV"
	}
	if r.Grade == nil {
		return "PENDING"
	}
	if r.IsDescriptive {
		if *r.Grade == 0 {
			return "FAILED"
		}
		if *r.Grade == 1 || *r.Grade >= r.PassMark {
			return "PASSED"
		}
	}
	if *r.Grade >= r.PassMark {
		return "PASSED"
	}
	if *r.Grade < r.PassMark {
		return "FAILED"
	}
	if label, ok := transcriptStatusFa[r.Status]; ok {
		return label
	}
	return r.Status
}

func roundTo2(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100
}

func maskNationalCode(code *string) string {
	c := ""
	if code != nil {
		c = strings.TrimSpace(*code)
	}
	if c == "" {
		return "—"
	}
	if len(c) <= 5 {
		return "*****"
	}
	return c[:3] + "*****" + c[len(c)-2:]
}

// studyTypeFa is a port of courseTypeFa for the program type.
func studyTypeFa(v string) string {
	if v == "" {
		return "—"
	}
	labels := map[string]string{
		"0": "نامشخص", "1": "روزانه", "2": "شبانه", "3": "نیمه حضوری",
		"4": "غیرانتفاعی", "5": "دانشجویان خارجی", "6": "روزانه - موارد خاص",
		"7": "پیام نور", "8": "دوره‌های آموزش عالی آزاد", "10": "مجازی", "202": "مهمانی",
	}
	if len(v) <= 3 {
		if label, ok := labels[v]; ok {
			return label
		}
	}
	return v
}

// issueTranscriptToken is a port of issueTranscriptToken with a 1-year cap.
func (s *Service) issueTranscriptToken(ctx context.Context, userID int64, me *Record) (string, string, error) {
	ttlMin := 10080.0
	if s.Settings != nil {
		ttlMin = s.Settings.GetNumber(ctx, "TRANSCRIPT_TTL_MINUTES", 10080)
	}
	if !(ttlMin > 0) {
		return "", "", fmt.Errorf("مدت اعتبار کارنامهٔ تحصیلی (TRANSCRIPT_TTL_MINUTES) باید عددی بزرگ‌تر از صفر باشد.")
	}
	if ttlMin > 525600 {
		ttlMin = 525600
	}
	uni := int64(0)
	if me.UniversityID != nil {
		uni = *me.UniversityID
	}
	token, err := s.Signer.Sign(ctx, map[string]any{
		"uid":  userID,
		"sid":  me.ID,
		"sc":   me.StudentCode,
		"uni":  uni,
		"kind": "TRANSCRIPT",
	}, int(ttlMin)*60)
	if err != nil {
		return "", "", err
	}
	return token, expiresAtISO(int(ttlMin) * 60), nil
}
