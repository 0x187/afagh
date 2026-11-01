// ═══ Codes Center — a single place to define and review the «کد» of all reference tables ═══
//
// Faithful port of afagh-next/src/app/admin/codes/actions.ts and tables.ts.
//
// Why it is needed: the code is the identity document (the major code says which major, which degree level, which
// department, and which faculty). Until now the codes were scattered: the faculty code had no interface
// at all, the department code was populated only from an import file, and there was nowhere to see which
// records are missing a code or have a duplicate code.
package admin

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"backend-go/internal/fa"
	"backend-go/internal/session"
)

// ── Definition of coded tables — tables.ts port ──

type codeTableDef struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Hint      string `json:"hint"`
	Editable  bool   `json:"editable"`
	Creatable bool   `json:"creatable"`
}

var codeTableDefs = []codeTableDef{
	{ID: "faculty", Title: "دانشکده‌ها", Hint: "کد دانشکده — ریشهٔ ساختار سازمانی", Editable: true, Creatable: true},
	{ID: "department", Title: "گروه‌های آموزشی", Hint: "کد گروه — ذیل دانشکده", Editable: true, Creatable: false},
	{ID: "major", Title: "رشته‌ها و گرایش‌ها", Hint: "کد رشته — مقطع و گروه و دانشکده را مشخص می‌کند", Editable: true, Creatable: true},
	{ID: "degree", Title: "مقاطع تحصیلی", Hint: "کد مقطع — در فایل‌های دانشجو و درس به کار می‌رود", Editable: true, Creatable: true},
	{ID: "course", Title: "دروس", Hint: "کد درس — کلید یکتای کاتالوگ", Editable: true, Creatable: false},
	// Term: its code is fixed (it is rooted in registration, grades, tuition, and transcripts), but
	// the term schedule (start/end, registration, add/drop, exams) is editable.
	{ID: "term", Title: "ترم‌ها", Hint: "کد ترم — مثلاً ۴۰۳۱ · کد ثابت، زمان‌بندی ترم ویرایش‌پذیر است", Editable: false, Creatable: true},
}

func validCodeTable(t string) bool {
	switch t {
	case "faculty", "department", "major", "degree", "course", "term":
		return true
	}
	return false
}

// ── Response types ──

// CodeRow is a code display row (CodeRow port).
type CodeRow struct {
	ID           int64   `json:"id"`
	Code         *string `json:"code"`
	Title        string  `json:"title"`
	Context      *string `json:"context"`
	Duplicate    bool    `json:"duplicate"`
	StartDate    *string `json:"startDate"`
	EndDate      *string `json:"endDate"`
	StandardCode *string `json:"standardCode"`
	MinistryCode *string `json:"ministryCode"`
}

// CodeStat holds code health statistics for a table (CodeStat port).
type CodeStat struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Hint      string `json:"hint"`
	Editable  bool   `json:"editable"`
	Creatable bool   `json:"creatable"`
	Total     int    `json:"total"`
	Missing   int    `json:"missing"`
	Duplicate int    `json:"duplicate"`
}

// MissingCodeSummary summarizes records with missing codes in a table.
type MissingCodeSummary struct {
	Table   string `json:"table"`
	Missing int    `json:"missing"`
}

// CodeFormOptions holds parent options for the create form (FormOptions port).
type CodeFormOptions struct {
	Degree     []CodeOption `json:"degree"`
	Department []CodeOption `json:"department"`
	Faculty    []CodeOption `json:"faculty"`
}

// CodeOption is a select option.
type CodeOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// DegreeDetail holds details of a degree level for the edit form (DegreeDetail port).
type DegreeDetail struct {
	ID                      int64   `json:"id"`
	Title                   string  `json:"title"`
	Code                    string  `json:"code"`
	StandardCode            *string `json:"standardCode"`
	MinistryCode            *string `json:"ministryCode"`
	DefaultPassingGrade     string  `json:"defaultPassingGrade"`
	ConditionalGpaThreshold string  `json:"conditionalGpaThreshold"`
	MaxUnitsPerTerm         *int64  `json:"maxUnitsPerTerm"`
	TermCount               *int64  `json:"termCount"`
	IsGraduate              *int64  `json:"isGraduate"`
}

// ── Internal raw row ──
//
// scope is the uniqueness key (e.g. university).
// Why: the term code and the course code are unique only «درون یک دانشگاه» (uq_terms_uni_code and
// uq_courses_uni_code), not globally. The global count of 270/525 gave false warnings
// while the real duplicates were zero. scope=null means global (major, degree level).

type codeRawRow struct {
	id           int64
	code         *string
	title        string
	context      *string
	scope        *string
	standardCode *string
	ministryCode *string
	startDate    *string
	endDate      *string
}

// strPtr/derefStr are used from pos.go and admissions.go in this same package.

// codeDupSet — dupSet port.
func codeDupSet(rows []codeRawRow) map[string]bool {
	seen := map[string]int{}
	for _, r := range rows {
		if r.code == nil || *r.code == "" {
			continue
		}
		key := codeScopeKey(r)
		seen[key]++
	}
	out := map[string]bool{}
	for k, n := range seen {
		if n > 1 {
			out[k] = true
		}
	}
	return out
}

func codeScopeKey(r codeRawRow) string {
	scope := ""
	if r.scope != nil {
		scope = *r.scope
	}
	return scope + "::" + derefStr(r.code)
}

// ── listCodes ──

// ListCodes ports listCodes — lists the codes of a reference table (with duplicate detection and search).
func (s *Service) ListCodes(ctx context.Context, user *session.User, uniCookie, table, q string) ([]CodeRow, error) {
	tn := []rune(fa.NormalizeFa(q))
	if len(tn) > 60 {
		tn = tn[:60]
	}
	t := string(tn)
	// The active university from the header switch — all reference tables (except degree level, which is global)
	// show only this university's records so the switch actually works.
	uniID := s.UniversityID(ctx, user, uniCookie)

	raw, err := s.codesRawRows(ctx, uniID, table)
	if err != nil {
		return nil, err
	}

	dups := codeDupSet(raw)
	rows := make([]CodeRow, 0, len(raw))
	for _, r := range raw {
		rows = append(rows, CodeRow{
			ID:           r.id,
			Code:         r.code,
			Title:        r.title,
			Context:      r.context,
			Duplicate:    r.code != nil && *r.code != "" && dups[codeScopeKey(r)],
			StartDate:    r.startDate,
			EndDate:      r.endDate,
			StandardCode: r.standardCode,
			MinistryCode: r.ministryCode,
		})
	}
	if t == "" {
		return rows, nil
	}
	out := rows[:0:0]
	for _, r := range rows {
		if fa.FaIncludes(r.Title, t) || strings.Contains(derefStr(r.Code), t) || fa.FaIncludes(derefStr(r.Context), t) {
			out = append(out, r)
		}
	}
	return out, nil
}

// codesRawRows reads each table raw — the same select/orderBy/where as the Next version.
func (s *Service) codesRawRows(ctx context.Context, uniID *int64, table string) ([]codeRawRow, error) {
	var rows []codeRawRow
	var err error
	switch table {
	case "faculty":
		rows, err = s.codesRawFaculty(ctx, uniID)
	case "department":
		rows, err = s.codesRawDepartment(ctx, uniID)
	case "major":
		rows, err = s.codesRawMajor(ctx, uniID)
	case "degree":
		rows, err = s.codesRawDegree(ctx, uniID)
	case "course":
		rows, err = s.codesRawCourse(ctx, uniID)
	case "term":
		rows, err = s.codesRawTerm(ctx, uniID)
	}
	return rows, err
}

func (s *Service) codesRawFaculty(ctx context.Context, uniID *int64) ([]codeRawRow, error) {
	where := "true"
	args := []any{}
	if uniID != nil {
		where = `(f."universityId" = $1 or f."universityId" is null)`
		args = append(args, *uniID)
	}
	rws, err := s.DB.Pool.Query(ctx, `
		select f.id, f."facultyCode", f.name, f."standardCode", f."ministryCode", u.title, f."universityId"
		  from faculties f
		  left join universities u on u.id = f."universityId"
		 where `+where+`
		 order by f.name`, args...)
	if err != nil {
		return nil, err
	}
	defer rws.Close()
	out := []codeRawRow{}
	for rws.Next() {
		var r codeRawRow
		var uni *string
		var uid *int64
		if err := rws.Scan(&r.id, &r.code, &r.title, &r.standardCode, &r.ministryCode, &uni, &uid); err != nil {
			return nil, err
		}
		if uni != nil {
			r.context = uni
		}
		if uid != nil {
			r.scope = strPtr(fmt.Sprintf("u%d", *uid))
		}
		out = append(out, r)
	}
	return out, rws.Err()
}

func (s *Service) codesRawDepartment(ctx context.Context, uniID *int64) ([]codeRawRow, error) {
	where := "true"
	args := []any{}
	if uniID != nil {
		where = `(f."universityId" = $1 or f."universityId" is null)`
		args = append(args, *uniID)
	}
	rws, err := s.DB.Pool.Query(ctx, `
		select d.id, d."departmentCode", d.name, d."standardCode", d."ministryCode",
		       u.title, f.name, f."facultyCode", d."facultyId"
		  from departments d
		  left join faculties f on f.id = d."facultyId"
		  left join universities u on u.id = f."universityId"
		 where `+where+`
		 order by f.name, d.name`, args...)
	if err != nil {
		return nil, err
	}
	defer rws.Close()
	out := []codeRawRow{}
	for rws.Next() {
		var r codeRawRow
		var uni, facName, facCode *string
		var facID *int64
		if err := rws.Scan(&r.id, &r.code, &r.title, &r.standardCode, &r.ministryCode,
			&uni, &facName, &facCode, &facID); err != nil {
			return nil, err
		}
		// Context: [university, faculty [faculty code]] with «·»
		parts := []string{}
		if uni != nil && *uni != "" {
			parts = append(parts, *uni)
		}
		if facName != nil && *facName != "" {
			f := *facName
			if facCode != nil && *facCode != "" {
				f += fmt.Sprintf(" [%s]", *facCode)
			}
			parts = append(parts, f)
		}
		if len(parts) > 0 {
			r.context = strPtr(strings.Join(parts, " · "))
		}
		// The department is under the faculty — a real duplicate means a duplicate code within one faculty
		if facID != nil {
			r.scope = strPtr(fmt.Sprintf("f%d", *facID))
		}
		out = append(out, r)
	}
	return out, rws.Err()
}

func (s *Service) codesRawMajor(ctx context.Context, uniID *int64) ([]codeRawRow, error) {
	where := "true"
	args := []any{}
	if uniID != nil {
		where = `(m."universityId" = $1 or m."universityId" is null)`
		args = append(args, *uniID)
	}
	rws, err := s.DB.Pool.Query(ctx, `
		select m.id, m."majorCode", m.name, m."standardCode", m."ministryCode",
		       dlc.title, d.name, d."departmentCode"
		  from majors m
		  left join degree_level_configs dlc on dlc.id = m."degreeLevelId"
		  left join departments d on d.id = m."departmentId"
		 where `+where+`
		 order by m.name`, args...)
	if err != nil {
		return nil, err
	}
	defer rws.Close()
	out := []codeRawRow{}
	for rws.Next() {
		var r codeRawRow
		var deg, dept, deptCode *string
		if err := rws.Scan(&r.id, &r.code, &r.title, &r.standardCode, &r.ministryCode,
			&deg, &dept, &deptCode); err != nil {
			return nil, err
		}
		parts := []string{}
		if deg != nil && *deg != "" {
			parts = append(parts, *deg)
		}
		if dept != nil && *dept != "" {
			d := *dept
			if deptCode != nil && *deptCode != "" {
				d += fmt.Sprintf(" [%s]", *deptCode)
			}
			parts = append(parts, d)
		}
		if len(parts) > 0 {
			r.context = strPtr(strings.Join(parts, " · "))
		}
		// The major code is globally unique (majorCode unique) — a duplicate is real
		out = append(out, r)
	}
	return out, rws.Err()
}

func (s *Service) codesRawDegree(ctx context.Context, uniID *int64) ([]codeRawRow, error) {
	where := "true"
	args := []any{}
	if uniID != nil {
		// Degree levels are in practice used per university (each university has its own subset)
		// But their ownership is messy (the SAMAs are all under Afagh's name while 4 universities
		// use them). So the filter = owned by the university itself, shared, or used by its fields of study.
		where = `("universityId" = $1 or "universityId" is null or id in (select "degreeLevelId" from majors where "universityId" = $1))`
		args = append(args, *uniID)
	}
	rws, err := s.DB.Pool.Query(ctx, `
		select id, code, title, "standardCode", "ministryCode", "termCount", "isGraduate"
		  from degree_level_configs
		 where `+where+`
		 order by title`, args...)
	if err != nil {
		return nil, err
	}
	defer rws.Close()
	out := []codeRawRow{}
	for rws.Next() {
		var r codeRawRow
		var termCount, isGraduate *int64
		if err := rws.Scan(&r.id, &r.code, &r.title, &r.standardCode, &r.ministryCode,
			&termCount, &isGraduate); err != nil {
			return nil, err
		}
		parts := []string{}
		if termCount != nil {
			parts = append(parts, fmt.Sprintf("%d ترمه", *termCount))
		} else {
			parts = append(parts, "ترم: استنتاجی")
		}
		if isGraduate != nil && *isGraduate == 1 {
			parts = append(parts, "تکمیلی")
		}
		r.context = strPtr(strings.Join(parts, " · "))
		// The national degree-level code is unique — this is a real duplicate
		out = append(out, r)
	}
	return out, rws.Err()
}

func (s *Service) codesRawCourse(ctx context.Context, uniID *int64) ([]codeRawRow, error) {
	where := "true"
	args := []any{}
	if uniID != nil {
		where = `(c."universityId" = $1 or c."universityId" is null)`
		args = append(args, *uniID)
	}
	rws, err := s.DB.Pool.Query(ctx, `
		select c.id, c.code, c.title, c."standardCode", c."ministryCode",
		       u.title, (select dlc.title from degree_level_configs dlc where dlc.id = (to_jsonb(c)->>'degreeLevelId')::int), d.name, c."universityId"
		  from courses c
		  left join departments d on d.id = c."departmentId"
		  left join universities u on u.id = c."universityId"
		 where `+where+`
		 order by c.code`, args...)
	if err != nil {
		return nil, err
	}
	defer rws.Close()
	out := []codeRawRow{}
	for rws.Next() {
		var r codeRawRow
		var uni, deg, dept *string
		var uid *int64
		if err := rws.Scan(&r.id, &r.code, &r.title, &r.standardCode, &r.ministryCode,
			&uni, &deg, &dept, &uid); err != nil {
			return nil, err
		}
		parts := []string{}
		for _, p := range []*string{uni, deg, dept} {
			if p != nil && *p != "" {
				parts = append(parts, *p)
			}
		}
		if len(parts) > 0 {
			r.context = strPtr(strings.Join(parts, " · "))
		}
		// The course code is unique only within a university (uq_courses_uni_code)
		if uid != nil {
			r.scope = strPtr(fmt.Sprintf("u%d", *uid))
		}
		out = append(out, r)
	}
	return out, rws.Err()
}

func (s *Service) codesRawTerm(ctx context.Context, uniID *int64) ([]codeRawRow, error) {
	where := "true"
	args := []any{}
	if uniID != nil {
		where = `(t."universityId" = $1 or t."universityId" is null)`
		args = append(args, *uniID)
	}
	rws, err := s.DB.Pool.Query(ctx, `
		select t.id, t."termCode", t.title, t."standardCode", t."ministryCode",
		       u.title, t."universityId",
		       to_char(t."startDate", 'YYYY-MM-DD"T"HH24:MI'),
		       to_char(t."endDate", 'YYYY-MM-DD"T"HH24:MI')
		  from academic_terms t
		  left join universities u on u.id = t."universityId"
		 where `+where+`
		 order by t."termCode"`, args...)
	if err != nil {
		return nil, err
	}
	defer rws.Close()
	out := []codeRawRow{}
	for rws.Next() {
		var r codeRawRow
		var uni *string
		var uid *int64
		if err := rws.Scan(&r.id, &r.code, &r.title, &r.standardCode, &r.ministryCode,
			&uni, &uid, &r.startDate, &r.endDate); err != nil {
			return nil, err
		}
		if uni != nil {
			r.context = uni
		}
		// The term code is unique only within a university (uq_terms_uni_code)
		if uid != nil {
			r.scope = strPtr(fmt.Sprintf("u%d", *uid))
		}
		out = append(out, r)
	}
	return out, rws.Err()
}

// ── codeStats / missingCodeSummary ──

// CodeStats is the codeStats port — code health summary for all tables (cards at the top of the page).
func (s *Service) CodeStats(ctx context.Context, user *session.User, uniCookie string) ([]CodeStat, error) {
	out := []CodeStat{}
	for _, d := range codeTableDefs {
		rows, err := s.ListCodes(ctx, user, uniCookie, d.ID, "")
		if err != nil {
			return nil, err
		}
		st := CodeStat{
			ID: d.ID, Title: d.Title, Hint: d.Hint,
			Editable: d.Editable, Creatable: d.Creatable,
			Total: len(rows),
		}
		for _, r := range rows {
			if r.Code == nil || *r.Code == "" {
				st.Missing++
			}
			if r.Duplicate {
				st.Duplicate++
			}
		}
		out = append(out, st)
	}
	return out, nil
}

// MissingCodeSummary is the missingCodeSummary port — count of records without a code in each table
// (for warning before data migration).
func (s *Service) MissingCodeSummary(ctx context.Context, user *session.User, uniCookie string) ([]MissingCodeSummary, error) {
	stats, err := s.CodeStats(ctx, user, uniCookie)
	if err != nil {
		return nil, err
	}
	out := []MissingCodeSummary{}
	for _, st := range stats {
		if st.Missing > 0 {
			out = append(out, MissingCodeSummary{Table: st.Title, Missing: st.Missing})
		}
	}
	return out, nil
}

// ── exportCodesCsv ──

// ExportCodesCsv is the exportCodesCsv port — CSV export of one table (download as text).
func (s *Service) ExportCodesCsv(ctx context.Context, user *session.User, uniCookie, table string) (string, error) {
	rows, err := s.ListCodes(ctx, user, uniCookie, table, "")
	if err != nil {
		return "", err
	}
	esc := func(v string) string {
		t := strings.TrimLeft(v, " \t\n\r\v\f")
		out := v
		if t != "" && strings.IndexByte("=+-@|\t\r", t[0]) >= 0 {
			out = "'" + v
		}
		if strings.ContainsAny(out, "\",\n") {
			out = `"` + strings.ReplaceAll(out, `"`, `""`) + `"`
		}
		return out
	}
	var b strings.Builder
	b.WriteString("کد,عنوان,زمینه,کد استاندارد,کد وزارت\n")
	for i, r := range rows {
		if i > 0 {
			b.WriteByte('\n')
		}
		fields := []string{
			esc(derefStr(r.Code)),
			esc(r.Title),
			esc(derefStr(r.Context)),
			esc(derefStr(r.StandardCode)),
			esc(derefStr(r.MinistryCode)),
		}
		b.WriteString(strings.Join(fields, ","))
	}
	return b.String(), nil
}

// ── countRows ──

// CountRows is the countRows port — total record count of each table without loading it fully
// (for large pages such as courses).
func (s *Service) CountRows(ctx context.Context, user *session.User, uniCookie, table string) (int64, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	var uniCol string
	switch table {
	case "faculty":
		uniCol = `"universityId"`
	case "department":
		uniCol = `"universityId"`
	case "major":
		uniCol = `"universityId"`
	case "degree":
		uniCol = `"universityId"`
	case "course":
		uniCol = `"universityId"`
	case "term":
		uniCol = `"universityId"`
	default:
		return 0, nil
	}
	where := "true"
	args := []any{}
	if uniID != nil {
		where = fmt.Sprintf(`(%s = $1 or %s is null)`, uniCol, uniCol)
		args = append(args, *uniID)
	}
	var n int64
	err := s.DB.Pool.QueryRow(ctx, `select count(*) from `+codeTableName(table)+` where `+where, args...).Scan(&n)
	return n, err
}

func codeTableName(table string) string {
	switch table {
	case "faculty":
		return "faculties"
	case "department":
		return "departments"
	case "major":
		return "majors"
	case "degree":
		return "degree_level_configs"
	case "course":
		return "courses"
	case "term":
		return "academic_terms"
	}
	return ""
}

// ── setCodeAction — edit a record's code with a uniqueness check ──

// SetCodeInput is the input for editing a code.
//
// National/ministry codes (Samin) — they change only when the form has sent these same fields;
// older forms (saving a code from a table row) do not send them at all and the columns stay untouched.
type SetCodeInput struct {
	Table        string  `json:"table"`
	ID           int64   `json:"id"`
	Code         string  `json:"code"`
	StandardCode *string `json:"standardCode"`
	MinistryCode *string `json:"ministryCode"`
}

// SetCodeAction is the setCodeAction port.
func (s *Service) SetCodeAction(ctx context.Context, user *session.User, uniCookie string, in SetCodeInput) error {
	id := in.ID
	code := strings.TrimSpace(in.Code)
	if id <= 0 {
		return errors.New("رکورد نامعتبر است.")
	}
	// The record must belong to the active university (or be national)
	uni := s.UniversityID(ctx, user, uniCookie)
	if uni == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	tblUniCol := map[string]string{
		"faculty":    `faculties."universityId"`,
		"department": `departments."universityId"`,
		"major":      `majors."universityId"`,
		"degree":     `degree_level_configs."universityId"`,
		"course":     `courses."universityId"`,
		"term":       `academic_terms."universityId"`,
	}
	if uniCol, ok := tblUniCol[in.Table]; ok {
		var u *int64
		err := s.DB.Pool.QueryRow(ctx,
			`select `+uniCol+` from `+codeTableName(in.Table)+` where id = $1`, id).Scan(&u)
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("رکورد یافت نشد یا متعلق به دانشگاه دیگری است.")
		}
		if err != nil {
			return err
		}
		if u != nil && *u != *uni {
			return errors.New("رکورد یافت نشد یا متعلق به دانشگاه دیگری است.")
		}
	}

	// National/ministry codes (Samin) — they change only when the form has sent these same fields.
	std := optLatinPtr(in.StandardCode)
	min := optLatinPtr(in.MinistryCode)

	clash := func(foundTitle string) error {
		return fmt.Errorf("کد «%s» قبلاً برای «%s» ثبت شده — کد باید یکتا باشد.", code, foundTitle)
	}
	// clashCode returns its title if the code is already registered to another record.
	clashCode := func(query string, args ...any) (*string, error) {
		var title string
		err := s.DB.Pool.QueryRow(ctx, query, args...).Scan(&title)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &title, nil
	}

	switch in.Table {
	case "faculty":
		if code != "" {
			t, err := clashCode(`select name from faculties where "facultyCode" = $1 and id <> $2 limit 1`, code, id)
			if err != nil {
				return err
			}
			if t != nil {
				return clash(*t)
			}
		}
		return s.codesExecUpdate(ctx, `update faculties set "facultyCode" = $1`, code, std, min, id)
	case "department":
		if code != "" {
			t, err := clashCode(`select name from departments where "departmentCode" = $1 and id <> $2 limit 1`, code, id)
			if err != nil {
				return err
			}
			if t != nil {
				return clash(*t)
			}
		}
		return s.codesExecUpdate(ctx, `update departments set "departmentCode" = $1`, code, std, min, id)
	case "major":
		if code != "" {
			t, err := clashCode(`select name from majors where "majorCode" = $1 and id <> $2 limit 1`, code, id)
			if err != nil {
				return err
			}
			if t != nil {
				return clash(*t)
			}
		}
		return s.codesExecUpdate(ctx, `update majors set "majorCode" = $1`, code, std, min, id)
	case "degree":
		// The degree-level code is NOT NULL — clearing it is not allowed
		if code == "" {
			return errors.New("کد مقطع نمی‌تواند خالی باشد.")
		}
		t, err := clashCode(`select title from degree_level_configs where code = $1 and id <> $2 limit 1`, code, id)
		if err != nil {
			return err
		}
		if t != nil {
			return clash(*t)
		}
		return s.codesExecUpdate(ctx, `update degree_level_configs set code = $1`, code, std, min, id)
	case "course":
		if code == "" {
			return errors.New("کد درس نمی‌تواند خالی باشد.")
		}
		t, err := clashCode(`select title from courses where code = $1 and id <> $2 limit 1`, code, id)
		if err != nil {
			return err
		}
		if t != nil {
			return clash(*t)
		}
		return s.codesExecUpdate(ctx, `update courses set code = $1`, code, std, min, id)
	case "term":
		// The term code is not editable from this page — only Samin codes can be registered
		if std == nil && min == nil {
			return errors.New("کد این جدول از این صفحه قابل ویرایش نیست.")
		}
		sets, args := []string{}, []any{}
		n := 1
		if std != nil {
			sets = append(sets, fmt.Sprintf(`"standardCode" = $%d`, n))
			args = append(args, *std)
			n++
		}
		if min != nil {
			sets = append(sets, fmt.Sprintf(`"ministryCode" = $%d`, n))
			args = append(args, *min)
			n++
		}
		args = append(args, id)
		tag, err := s.DB.Pool.Exec(ctx,
			`update academic_terms set `+strings.Join(sets, ", ")+` where id = $`+strconv.Itoa(n), args...)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errors.New("رکورد یافت نشد یا متعلق به دانشگاه دیگری است.")
		}
		return nil
	}
	return errors.New("کد این جدول از این صفحه قابل ویرایش نیست.")
}

// codesExecUpdate performs the code update + optional Samin codes.
func (s *Service) codesExecUpdate(ctx context.Context, baseUpdate, code string, std, min *string, id int64) error {
	// baseUpdate has the form `update <tbl> set <col> = $1` — the base column is always present
	// (empty → NULL; for NOT NULL tables it always arrives non-empty).
	sets := []string{strings.TrimPrefix(baseUpdate, "update ")}
	args := []any{optCode(code)}
	n := 2
	if std != nil {
		sets = append(sets, fmt.Sprintf(`"standardCode" = $%d`, n))
		args = append(args, *std)
		n++
	}
	if min != nil {
		sets = append(sets, fmt.Sprintf(`"ministryCode" = $%d`, n))
		args = append(args, *min)
		n++
	}
	tbl := strings.Fields(baseUpdate)[1]
	args = append(args, id)
	tag, err := s.DB.Pool.Exec(ctx,
		`update `+tbl+` set `+strings.Join(sets, ", ")+` where id = $`+strconv.Itoa(n), args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("رکورد یافت نشد یا متعلق به دانشگاه دیگری است.")
	}
	return nil
}

// ── Shared helpers ──

// A user may write the code with Persian digits; the code must be stored in Latin
// otherwise it will not match the code of the same row in the source Excel file.
func codeLatin(v string) string { return fa.ToEnDigits(v) }

// optCode empty or absent → nil (the columns are nullable) — optCode port.
func optCode(v string) *string {
	v = strings.TrimSpace(codeLatin(v))
	if v == "" {
		return nil
	}
	return &v
}

func optLatinPtr(p *string) *string {
	if p == nil {
		return nil
	}
	return optCode(*p)
}

// codeStrTrim is the form's string value — trimmed.
func codeStrTrim(v string) string { return strings.TrimSpace(v) }

// codeNum is the num port — a number from the form (Persian digits are accepted too); invalid → nil.
func codeNum(v string) *float64 {
	v = strings.TrimSpace(fa.ToEnDigits(v))
	if v == "" {
		return nil
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return nil
	}
	return &n
}

// codeNumOr is the num(fd,k) ?? def port.
func codeNumOr(vals map[string]string, key string, def float64) float64 {
	if n := codeNum(vals[key]); n != nil {
		return *n
	}
	return def
}

// normJalali — the normJalali port in exam-scheduler.ts.
// Standard Jalali date 'YYYY/MM/DD' (fixed length for string comparison).
func normJalali(s string) string {
	parts := strings.Split(strings.TrimSpace(s), "/")
	if len(parts) != 3 {
		return s
	}
	pad := func(n string) string {
		v, err := strconv.Atoi(strings.TrimSpace(n))
		if err != nil {
			return strings.TrimSpace(n)
		}
		return fmt.Sprintf("%02d", v)
	}
	y, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil {
		return s
	}
	return fmt.Sprintf("%04d/%s/%s", y, pad(parts[1]), pad(parts[2]))
}

var termCodeRe = regexp.MustCompile(`^[0-9A-Za-z_-]{2,10}$`)
var dtLocalRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$`)
var jalaliDateRe = regexp.MustCompile(`^\d{4}/\d{1,2}/\d{1,2}$`)

// ── codeFormOptions — parent options for the field-creation form ──

// CodeFormOptionsOf is the codeFormOptions port.
func (s *Service) CodeFormOptionsOf(ctx context.Context, user *session.User, uniCookie string) (*CodeFormOptions, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	uniCond := func(col string) string {
		if uniID != nil {
			return fmt.Sprintf(`(%s = %d or %s is null)`, col, *uniID, col)
		}
		return "true"
	}
	out := &CodeFormOptions{
		Degree:     []CodeOption{},
		Department: []CodeOption{},
		Faculty:    []CodeOption{},
	}

	degs, err := s.DB.Pool.Query(ctx, `
		select id, title, code from degree_level_configs
		 where `+uniCond(`"universityId"`)+`
		 order by title`)
	if err != nil {
		return nil, err
	}
	defer degs.Close()
	for degs.Next() {
		var id int64
		var title, code string
		if err := degs.Scan(&id, &title, &code); err != nil {
			return nil, err
		}
		out.Degree = append(out.Degree, CodeOption{Value: strconv.FormatInt(id, 10), Label: fmt.Sprintf("%s [%s]", title, code)})
	}
	deps, err := s.DB.Pool.Query(ctx, `
		select d.id, d.name, d."departmentCode", f.name
		  from departments d
		  left join faculties f on f.id = d."facultyId"
		 where `+uniCond(`d."universityId"`)+`
		 order by f.name, d.name`)
	if err != nil {
		return nil, err
	}
	defer deps.Close()
	for deps.Next() {
		var id int64
		var name string
		var code, fac *string
		if err := deps.Scan(&id, &name, &code, &fac); err != nil {
			return nil, err
		}
		label := name
		if code != nil && *code != "" {
			label += fmt.Sprintf(" [%s]", *code)
		}
		if fac != nil && *fac != "" {
			label += " · " + *fac
		}
		out.Department = append(out.Department, CodeOption{Value: strconv.FormatInt(id, 10), Label: label})
	}
	facs, err := s.DB.Pool.Query(ctx, `
		select id, name, "facultyCode" from faculties
		 where `+uniCond(`"universityId"`)+`
		 order by name`)
	if err != nil {
		return nil, err
	}
	defer facs.Close()
	for facs.Next() {
		var id int64
		var name string
		var code *string
		if err := facs.Scan(&id, &name, &code); err != nil {
			return nil, err
		}
		label := name
		if code != nil && *code != "" {
			label += fmt.Sprintf(" [%s]", *code)
		}
		out.Faculty = append(out.Faculty, CodeOption{Value: strconv.FormatInt(id, 10), Label: label})
	}
	return out, nil
}

// ── Creating a new reference record ──
//
// Why here: until now degree levels, faculties and fields had no creation UI and were only
// created from seed data or a migration file. That is, if a university added a new degree level,
// the only way was to manipulate the database directly. The academic department has its own page
// and courses are created in the department head's inbox, so they are not duplicated here.

// CreateCodeRow is the createCodeRowAction port — adding a degree level, faculty, field or term.
func (s *Service) CreateCodeRow(ctx context.Context, user *session.User, uniCookie, table string, vals map[string]string) (int64, error) {
	code := codeLatin(codeStrTrim(vals["code"]))
	var id int64
	var err error

	switch table {
	case "degree":
		id, err = s.codesCreateDegree(ctx, vals, code)
	case "faculty":
		id, err = s.codesCreateFaculty(ctx, vals, code)
	case "major":
		id, err = s.codesCreateMajor(ctx, vals, code)
	case "term":
		id, err = s.codesCreateTerm(ctx, vals, code)
	default:
		return 0, codeErr("ساخت رکورد برای این جدول از این صفحه ممکن نیست.")
	}
	if err != nil {
		// Validation messages are returned verbatim and without a suffix (like a return inside try in Next);
		// if two users register the same code at the same time, the checks above slip past each other
		// and the database itself is the final judge — we translate its message into Persian.
		var ve *codeValidationErr
		if errors.As(err, &ve) {
			return 0, err
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return 0, fmt.Errorf("کد «%s» هم‌اکنون توسط رکورد دیگری گرفته شد — کد دیگری بگذارید.", code)
		}
		return 0, fmt.Errorf("ثبت نشد: %s", err.Error())
	}
	return id, nil
}

// codeValidationErr is a validation error — equivalent to an early return in a Next action
// (without the «ثبت نشد:» suffix, which appears only for database errors).
type codeValidationErr struct{ msg string }

func (e *codeValidationErr) Error() string { return e.msg }

func codeErr(msg string) error { return &codeValidationErr{msg} }

func (s *Service) codesCreateDegree(ctx context.Context, vals map[string]string, code string) (int64, error) {
	title := codeStrTrim(vals["title"])
	if title == "" {
		return 0, codeErr("عنوان مقطع را وارد کنید.")
	}
	if code == "" {
		return 0, codeErr("کد مقطع الزامی است — در فایل‌های دانشجو و درس با همین کد تطبیق داده می‌شود.")
	}
	var dupTitle string
	err := s.DB.Pool.QueryRow(ctx, `select title from degree_level_configs where code = $1 limit 1`, code).Scan(&dupTitle)
	if err == nil {
		return 0, fmt.Errorf("کد «%s» قبلاً برای مقطع «%s» ثبت شده.", code, dupTitle)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	var dupCode string
	err = s.DB.Pool.QueryRow(ctx, `select code from degree_level_configs where title = $1 limit 1`, title).Scan(&dupCode)
	if err == nil {
		return 0, fmt.Errorf("مقطعی با عنوان «%s» از قبل هست (کد %s).", title, dupCode)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	pass := codeNumOr(vals, "defaultPassingGrade", 10)
	cond := codeNumOr(vals, "conditionalGpaThreshold", 12)
	maxU := codeNumOr(vals, "maxUnitsPerTerm", 20)
	if pass < 0 || pass > 20 {
		return 0, codeErr("نمرهٔ قبولی باید بین ۰ تا ۲۰ باشد.")
	}
	if cond < 0 || cond > 20 {
		return 0, codeErr("معدل مشروطی باید بین ۰ تا ۲۰ باشد.")
	}
	if maxU < 1 || maxU > 60 {
		return 0, codeErr("سقف واحد ترم باید بین ۱ تا ۶۰ باشد.")
	}
	termCount := codeNum(vals["termCount"])
	if termCount == nil || *termCount != float64(int64(*termCount)) || *termCount < 1 || *termCount > 12 {
		return 0, codeErr("تعداد ترم تحصیل باید عدد صحیح بین ۱ تا ۱۲ باشد.")
	}
	gradRaw := codeStrTrim(vals["isGraduate"])
	if gradRaw != "0" && gradRaw != "1" {
		return 0, codeErr("وضعیت تحصیلات تکمیلی نامعتبر است.")
	}
	var id int64
	err = s.DB.Pool.QueryRow(ctx, `
		insert into degree_level_configs
		  (title, code, "standardCode", "ministryCode", "defaultPassingGrade",
		   "conditionalGpaThreshold", "maxUnitsPerTerm", "termCount", "isGraduate")
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		returning id`,
		title, code, optCode(vals["standardCode"]), optCode(vals["ministryCode"]),
		strconv.FormatFloat(pass, 'f', 2, 64),
		strconv.FormatFloat(cond, 'f', 2, 64),
		int64(maxU), int64(*termCount), gradRaw,
	).Scan(&id)
	return id, err
}

func (s *Service) codesCreateFaculty(ctx context.Context, vals map[string]string, code string) (int64, error) {
	name := codeStrTrim(vals["name"])
	if name == "" {
		return 0, codeErr("نام دانشکده را وارد کنید.")
	}
	var dupID int64
	err := s.DB.Pool.QueryRow(ctx, `select id from faculties where name = $1 limit 1`, name).Scan(&dupID)
	if err == nil {
		return 0, fmt.Errorf("دانشکدهٔ «%s» از قبل ثبت شده.", name)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	if code != "" {
		var dupName string
		err := s.DB.Pool.QueryRow(ctx, `select name from faculties where "facultyCode" = $1 limit 1`, code).Scan(&dupName)
		if err == nil {
			return 0, fmt.Errorf("کد «%s» قبلاً برای «%s» ثبت شده.", code, dupName)
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return 0, err
		}
	}
	var id int64
	err = s.DB.Pool.QueryRow(ctx, `
		insert into faculties (name, "facultyCode", "standardCode", "ministryCode")
		values ($1, $2, $3, $4) returning id`,
		name, optCode(code), optCode(vals["standardCode"]), optCode(vals["ministryCode"])).Scan(&id)
	return id, err
}

func (s *Service) codesCreateMajor(ctx context.Context, vals map[string]string, code string) (int64, error) {
	name := codeStrTrim(vals["name"])
	degreeLevelID := codeNum(vals["degreeLevelId"])
	if name == "" {
		return 0, codeErr("نام رشته را وارد کنید.")
	}
	if degreeLevelID == nil || *degreeLevelID <= 0 {
		return 0, codeErr("مقطع رشته را انتخاب کنید — رشته بدون مقطع معنا ندارد.")
	}
	if code != "" {
		var dupName string
		err := s.DB.Pool.QueryRow(ctx, `select name from majors where "majorCode" = $1 limit 1`, code).Scan(&dupName)
		if err == nil {
			return 0, fmt.Errorf("کد «%s» قبلاً برای رشتهٔ «%s» ثبت شده.", code, dupName)
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return 0, err
		}
	}
	var departmentID *int64
	if n := codeNum(vals["departmentId"]); n != nil && *n > 0 {
		v := int64(*n)
		departmentID = &v
	}
	// We infer the faculty from the department so the chain field→department→faculty does not break
	var facultyID *int64
	if departmentID != nil {
		var f *int64
		if err := s.DB.Pool.QueryRow(ctx,
			`select "facultyId" from departments where id = $1 limit 1`, *departmentID).Scan(&f); err == nil {
			facultyID = f
		}
	}
	var minUnits *int64
	if n := codeNum(vals["minUnits"]); n != nil && *n > 0 && *n <= 400 {
		v := int64(*n)
		minUnits = &v
	}
	var id int64
	err := s.DB.Pool.QueryRow(ctx, `
		insert into majors
		  (name, "degreeLevelId", "departmentId", "facultyId", "majorCode",
		   "standardCode", "ministryCode", "minUnits")
		values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
		name, int64(*degreeLevelID), departmentID, facultyID, optCode(code),
		optCode(vals["standardCode"]), optCode(vals["ministryCode"]), minUnits).Scan(&id)
	return id, err
}

func (s *Service) codesCreateTerm(ctx context.Context, vals map[string]string, code string) (int64, error) {
	title := codeStrTrim(vals["title"])
	termType := codeStrTrim(vals["termType"])
	if termType == "" {
		termType = "NORMAL"
	}
	if code == "" {
		return 0, codeErr("کد ترم الزامی است — مثلاً 4031.")
	}
	if !termCodeRe.MatchString(code) {
		return 0, codeErr("کد ترم باید ۲ تا ۱۰ نویسهٔ لاتین/رقم باشد — مثلاً 4031.")
	}
	if title == "" {
		return 0, codeErr("عنوان ترم را وارد کنید.")
	}
	if termType != "NORMAL" && termType != "SUMMER" && termType != "EQUIVALENCE" {
		return 0, codeErr("نوع ترم نامعتبر است.")
	}
	var dupTitle string
	err := s.DB.Pool.QueryRow(ctx, `select title from academic_terms where "termCode" = $1 limit 1`, code).Scan(&dupTitle)
	if err == nil {
		return 0, fmt.Errorf("کد ترم «%s» قبلاً برای «%s» ثبت شده.", code, dupTitle)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	// A new term is never the current term and its registration is not open; the
	// education officer enables these deliberately in the term settings, not when creating the code.
	summer := 0
	if termType == "SUMMER" {
		summer = 1
	}
	var id int64
	err = s.DB.Pool.QueryRow(ctx, `
		insert into academic_terms
		  ("termCode", title, "termType", "standardCode", "ministryCode",
		   "isSummer", "isCurrent", "isEnrollmentOpen")
		values ($1, $2, $3, $4, $5, $6, 0, 0) returning id`,
		code, title, termType, optCode(vals["standardCode"]), optCode(vals["ministryCode"]), summer).Scan(&id)
	return id, err
}

// ── Generic row editing (faculty/department/field/course) ──

// GetCodeRow is the getCodeRowAction port — reads one row for the generic edit form.
func (s *Service) GetCodeRow(ctx context.Context, user *session.User, uniCookie, table string, id int64) (map[string]string, error) {
	if id <= 0 {
		return nil, nil
	}
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return nil, nil
	}
	res := map[string]string{}
	put := func(k string, v any) {
		switch x := v.(type) {
		case *string:
			res[k] = derefStr(x)
		case *int64:
			if x == nil {
				res[k] = ""
			} else {
				res[k] = strconv.FormatInt(*x, 10)
			}
		}
	}
	switch table {
	case "faculty":
		var name string
		var code, std, min *string
		err := s.DB.Pool.QueryRow(ctx, `
			select name, "facultyCode", "standardCode", "ministryCode"
			  from faculties where id = $1 and "universityId" = $2 limit 1`, id, *uniID).
			Scan(&name, &code, &std, &min)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		put("name", &name)
		put("code", code)
		put("standardCode", std)
		put("ministryCode", min)
	case "department":
		var name string
		var code, std *string
		var facID *int64
		err := s.DB.Pool.QueryRow(ctx, `
			select name, "departmentCode", "facultyId", "standardCode"
			  from departments where id = $1 and "universityId" = $2 limit 1`, id, *uniID).
			Scan(&name, &code, &facID, &std)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		put("name", &name)
		put("code", code)
		put("facultyId", facID)
		put("standardCode", std)
	case "major":
		var name string
		var code, std *string
		var degID, depID, minUnits *int64
		err := s.DB.Pool.QueryRow(ctx, `
			select name, "majorCode", "degreeLevelId", "departmentId", "minUnits", "standardCode"
			  from majors where id = $1 and "universityId" = $2 limit 1`, id, *uniID).
			Scan(&name, &code, &degID, &depID, &minUnits, &std)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		put("name", &name)
		put("code", code)
		put("degreeLevelId", degID)
		put("departmentId", depID)
		put("minUnits", minUnits)
		put("standardCode", std)
	case "course":
		var title string
		var code, std *string
		err := s.DB.Pool.QueryRow(ctx, `
			select title, code, "standardCode"
			  from courses where id = $1 and "universityId" = $2 limit 1`, id, *uniID).
			Scan(&title, &code, &std)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		put("title", &title)
		put("code", code)
		put("standardCode", std)
	default:
		return nil, nil
	}
	return res, nil
}

// UpdateCodeRow is the updateCodeRowAction port — generic editing of code rows
// (department/field/course/faculty). Only this form's fields are written and every write
// is limited to the current university.
func (s *Service) UpdateCodeRow(ctx context.Context, user *session.User, uniCookie, table string, id int64, vals map[string]string) error {
	if id <= 0 {
		return codeErr("شناسهٔ سطر نامعتبر است.")
	}
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return codeErr("دانشگاه جاری مشخص نیست.")
	}

	var err error
	switch table {
	case "faculty":
		name := codeStrTrim(vals["name"])
		if name == "" {
			return codeErr("نام دانشکده را وارد کنید.")
		}
		var dupID int64
		err = s.DB.Pool.QueryRow(ctx, `
			select id from faculties where name = $1 and "universityId" = $2 limit 1`, name, *uniID).Scan(&dupID)
		if err == nil && dupID != id {
			return fmt.Errorf("دانشکدهٔ «%s» از قبل ثبت شده.", name)
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("ثبت نشد: %s", err.Error())
		}
		tag, err := s.DB.Pool.Exec(ctx, `
			update faculties set name = $1, "standardCode" = $2
			 where id = $3 and "universityId" = $4`,
			name, optCode(vals["standardCode"]), id, *uniID)
		if err != nil {
			return fmt.Errorf("ثبت نشد: %s", err.Error())
		}
		if tag.RowsAffected() == 0 {
			return codeErr("سطر یافت نشد (یا متعلق به دانشگاه دیگری است).")
		}
		return nil

	case "department":
		name := codeStrTrim(vals["name"])
		if name == "" {
			return codeErr("نام گروه آموزشی را وارد کنید.")
		}
		facID := codeNum(vals["facultyId"])
		if facID == nil || *facID <= 0 {
			return codeErr("دانشکدهٔ گروه را انتخاب کنید.")
		}
		tag, err := s.DB.Pool.Exec(ctx, `
			update departments set name = $1, "facultyId" = $2, "standardCode" = $3
			 where id = $4 and "universityId" = $5`,
			name, int64(*facID), optCode(vals["standardCode"]), id, *uniID)
		if err != nil {
			return fmt.Errorf("ثبت نشد: %s", err.Error())
		}
		if tag.RowsAffected() == 0 {
			return codeErr("سطر یافت نشد (یا متعلق به دانشگاه دیگری است).")
		}
		return nil

	case "major":
		name := codeStrTrim(vals["name"])
		degID := codeNum(vals["degreeLevelId"])
		if name == "" {
			return codeErr("نام رشته را وارد کنید.")
		}
		if degID == nil || *degID <= 0 {
			return codeErr("مقطع رشته را انتخاب کنید.")
		}
		var departmentID *int64
		if n := codeNum(vals["departmentId"]); n != nil && *n > 0 {
			v := int64(*n)
			departmentID = &v
		}
		var facultyID *int64
		if departmentID != nil {
			var f *int64
			if err := s.DB.Pool.QueryRow(ctx,
				`select "facultyId" from departments where id = $1 limit 1`, *departmentID).Scan(&f); err == nil {
				facultyID = f
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("ثبت نشد: %s", err.Error())
			}
		}
		var minUnits *int64
		if n := codeNum(vals["minUnits"]); n != nil && *n > 0 && *n <= 400 {
			v := int64(*n)
			minUnits = &v
		}
		tag, err := s.DB.Pool.Exec(ctx, `
			update majors set name = $1, "degreeLevelId" = $2, "departmentId" = $3, "facultyId" = $4,
			       "standardCode" = $5, "minUnits" = $6
			 where id = $7 and "universityId" = $8`,
			name, int64(*degID), departmentID, facultyID,
			optCode(vals["standardCode"]), minUnits, id, *uniID)
		if err != nil {
			return fmt.Errorf("ثبت نشد: %s", err.Error())
		}
		if tag.RowsAffected() == 0 {
			return codeErr("سطر یافت نشد (یا متعلق به دانشگاه دیگری است).")
		}
		return nil

	case "course":
		title := codeStrTrim(vals["title"])
		if title == "" {
			return codeErr("عنوان درس را وارد کنید.")
		}
		tag, err := s.DB.Pool.Exec(ctx, `
			update courses set title = $1, "standardCode" = $2
			 where id = $3 and "universityId" = $4`,
			title, optCode(vals["standardCode"]), id, *uniID)
		if err != nil {
			return fmt.Errorf("ثبت نشد: %s", err.Error())
		}
		if tag.RowsAffected() == 0 {
			return codeErr("سطر یافت نشد (یا متعلق به دانشگاه دیگری است).")
		}
		return nil

	default:
		return codeErr("ویرایش این جدول از این صفحه ممکن نیست.")
	}
}

// ── Editing a degree level ──

// GetDegreeRow is the getDegreeRowAction port — reads a degree level for the edit form
// (the same fields as the creation form).
func (s *Service) GetDegreeRow(ctx context.Context, user *session.User, uniCookie string, id int64) (*DegreeDetail, error) {
	if id <= 0 {
		return nil, nil
	}
	uniID := s.UniversityID(ctx, user, uniCookie)
	var r DegreeDetail
	var universityID *int64
	err := s.DB.Pool.QueryRow(ctx, `
		select id, title, code, "standardCode", "ministryCode",
		       "defaultPassingGrade", "conditionalGpaThreshold",
		       "maxUnitsPerTerm", "termCount", "isGraduate", "universityId"
		  from degree_level_configs where id = $1 limit 1`, id).
		Scan(&r.ID, &r.Title, &r.Code, &r.StandardCode, &r.MinistryCode,
			&r.DefaultPassingGrade, &r.ConditionalGpaThreshold,
			&r.MaxUnitsPerTerm, &r.TermCount, &r.IsGraduate, &universityID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if uniID != nil && universityID != nil && *universityID != *uniID {
		return nil, nil
	}
	return &r, nil
}

// UpdateDegreeRow is the updateDegreeRowAction port — edits a degree level with all fields of
// the creation form; the code follows the same uniqueness rule as code editing.
func (s *Service) UpdateDegreeRow(ctx context.Context, user *session.User, uniCookie string, id int64, vals map[string]string) error {
	if id <= 0 {
		return errors.New("رکورد نامعتبر است.")
	}
	var existsID int64
	var universityID *int64
	err := s.DB.Pool.QueryRow(ctx, `
		select id, "universityId" from degree_level_configs where id = $1 limit 1`, id).
		Scan(&existsID, &universityID)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("مقطع یافت نشد.")
	}
	if err != nil {
		return err
	}
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID != nil && universityID != nil && *universityID != *uniID {
		return errors.New("مقطع متعلق به دانشگاه دیگری است.")
	}

	title := codeStrTrim(vals["title"])
	code := codeLatin(codeStrTrim(vals["code"]))
	if title == "" {
		return errors.New("عنوان مقطع را وارد کنید.")
	}
	if code == "" {
		return errors.New("کد مقطع نمی‌تواند خالی باشد.")
	}
	var t string
	err = s.DB.Pool.QueryRow(ctx, `
		select title from degree_level_configs where code = $1 and id <> $2 limit 1`, code, id).Scan(&t)
	if err == nil {
		return fmt.Errorf("کد «%s» قبلاً برای «%s» ثبت شده.", code, t)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var c string
	err = s.DB.Pool.QueryRow(ctx, `
		select code from degree_level_configs where title = $1 and id <> $2 limit 1`, title, id).Scan(&c)
	if err == nil {
		return fmt.Errorf("مقطع «%s» از قبل هست (کد %s).", title, c)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	pass := codeNumOr(vals, "defaultPassingGrade", 10)
	cond := codeNumOr(vals, "conditionalGpaThreshold", 12)
	maxU := codeNumOr(vals, "maxUnitsPerTerm", 20)
	if pass < 0 || pass > 20 {
		return errors.New("نمرهٔ قبولی باید بین ۰ تا ۲۰ باشد.")
	}
	if cond < 0 || cond > 20 {
		return errors.New("معدل مشروطی باید بین ۰ تا ۲۰ باشد.")
	}
	if maxU < 1 || maxU > 60 {
		return errors.New("سقف واحد ترم باید بین ۱ تا ۶۰ باشد.")
	}
	termCount := codeNum(vals["termCount"])
	if termCount == nil || *termCount != float64(int64(*termCount)) || *termCount < 1 || *termCount > 12 {
		return errors.New("تعداد ترم تحصیل باید عدد صحیح بین ۱ تا ۱۲ باشد.")
	}
	gradRaw := codeStrTrim(vals["isGraduate"])
	if gradRaw != "0" && gradRaw != "1" {
		return errors.New("وضعیت تحصیلات تکمیلی نامعتبر است.")
	}

	where := `id = $10`
	args := []any{
		title, code,
		optCode(vals["standardCode"]), optCode(vals["ministryCode"]),
		strconv.FormatFloat(pass, 'f', 2, 64),
		strconv.FormatFloat(cond, 'f', 2, 64),
		int64(maxU), int64(*termCount), gradRaw,
		id,
	}
	if uniID != nil {
		where = `id = $10 and ("universityId" = $11 or "universityId" is null)`
		args = append(args, *uniID)
	}
	_, err = s.DB.Pool.Exec(ctx, `
		update degree_level_configs set
		  title = $1, code = $2, "standardCode" = $3, "ministryCode" = $4,
		  "defaultPassingGrade" = $5, "conditionalGpaThreshold" = $6,
		  "maxUnitsPerTerm" = $7, "termCount" = $8, "isGraduate" = $9
		 where `+where, args...)
	return err
}

// ── Editing a term (academic schedule) ──

// GetTermRow is the getTermRowAction port — reads a term for the edit form;
// all schedules: term start/end, course registration, add/drop, grade deadline and
// objection, the whole exam window (Jalali).
func (s *Service) GetTermRow(ctx context.Context, user *session.User, uniCookie string, id int64) (map[string]string, error) {
	if id <= 0 {
		return nil, nil
	}
	uniID := s.UniversityID(ctx, user, uniCookie)
	var (
		title, termType          string
		std, min                 *string
		academicYear             *int64
		start, end               *string
		enrStart, enrEnd         *string
		addDropStart, addDropEnd *string
		gradeDeadline            *string
		appeal, sla              *int64
		isCurrent, isEnrOpen     *int64
		universityID             *int64
	)
	err := s.DB.Pool.QueryRow(ctx, `
		select title, "termType", "standardCode", "ministryCode", "academicYear",
		       to_char("startDate", 'YYYY-MM-DD"T"HH24:MI'),
		       to_char("endDate", 'YYYY-MM-DD"T"HH24:MI'),
		       to_char("enrollmentStartDate", 'YYYY-MM-DD"T"HH24:MI'),
		       to_char("enrollmentEndDate", 'YYYY-MM-DD"T"HH24:MI'),
		       to_char("addDropStartDate", 'YYYY-MM-DD"T"HH24:MI'),
		       to_char("addDropEndDate", 'YYYY-MM-DD"T"HH24:MI'),
		       to_char("gradeEntryDeadline", 'YYYY-MM-DD"T"HH24:MI'),
		       "appealWindowDays", "professorAppealSlaDays",
		       "isCurrent", "isEnrollmentOpen", "universityId"
		  from academic_terms where id = $1 limit 1`, id).
		Scan(&title, &termType, &std, &min, &academicYear,
			&start, &end, &enrStart, &enrEnd, &addDropStart, &addDropEnd, &gradeDeadline,
			&appeal, &sla, &isCurrent, &isEnrOpen, &universityID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if uniID != nil && universityID != nil && *universityID != *uniID {
		return nil, nil
	}
	var examStart, examEnd string
	var gs, ge *string
	err = s.DB.Pool.QueryRow(ctx, `
		select "globalStart", "globalEnd" from exam_calendar_configs where "termId" = $1 limit 1`, id).
		Scan(&gs, &ge)
	if err == nil {
		examStart, examEnd = derefStr(gs), derefStr(ge)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	res := map[string]string{
		"title":                  title,
		"termType":               termType,
		"standardCode":           derefStr(std),
		"ministryCode":           derefStr(min),
		"academicYear":           "",
		"startDate":              derefStr(start),
		"endDate":                derefStr(end),
		"enrollmentStartDate":    derefStr(enrStart),
		"enrollmentEndDate":      derefStr(enrEnd),
		"addDropStartDate":       derefStr(addDropStart),
		"addDropEndDate":         derefStr(addDropEnd),
		"gradeEntryDeadline":     derefStr(gradeDeadline),
		"appealWindowDays":       "3",
		"professorAppealSlaDays": "5",
		"isCurrent":              "0",
		"isEnrollmentOpen":       "0",
		"examStartDate":          examStart,
		"examEndDate":            examEnd,
	}
	if academicYear != nil {
		res["academicYear"] = strconv.FormatInt(*academicYear, 10)
	}
	if appeal != nil {
		res["appealWindowDays"] = strconv.FormatInt(*appeal, 10)
	}
	if sla != nil {
		res["professorAppealSlaDays"] = strconv.FormatInt(*sla, 10)
	}
	if isCurrent != nil && *isCurrent == 1 {
		res["isCurrent"] = "1"
	}
	if isEnrOpen != nil && *isEnrOpen == 1 {
		res["isEnrollmentOpen"] = "1"
	}
	return res, nil
}

// UpdateTermRow is the updateTermRowAction port — full editing of the term schedule.
func (s *Service) UpdateTermRow(ctx context.Context, user *session.User, uniCookie string, id int64, vals map[string]string) error {
	if id <= 0 {
		return errors.New("رکورد نامعتبر است.")
	}
	var universityID *int64
	err := s.DB.Pool.QueryRow(ctx, `
		select id, "universityId" from academic_terms where id = $1 limit 1`, id).
		Scan(&id, &universityID)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("ترم یافت نشد.")
	}
	if err != nil {
		return err
	}

	title := codeStrTrim(vals["title"])
	if title == "" {
		return errors.New("عنوان ترم را وارد کنید.")
	}
	termType := codeStrTrim(vals["termType"])
	if termType != "NORMAL" && termType != "SUMMER" && termType != "EQUIVALENCE" && termType != "SPECIAL" {
		return errors.New("نوع ترم نامعتبر است.")
	}
	var year *int64
	if n := codeNum(vals["academicYear"]); n != nil {
		if *n != float64(int64(*n)) || *n < 1300 || *n > 1500 {
			return errors.New("سال تحصیلی باید عدد صحیح بین ۱۳۰۰ تا ۱۵۰۰ باشد (مثلاً 1403).")
		}
		v := int64(*n)
		year = &v
	}

	// datetime-local times: empty = null
	dtFields := []string{"startDate", "endDate", "enrollmentStartDate", "enrollmentEndDate",
		"addDropStartDate", "addDropEndDate", "gradeEntryDeadline"}
	dtVals := map[string]*string{}
	for _, f := range dtFields {
		v := codeStrTrim(vals[f])
		if v == "" {
			dtVals[f] = nil
			continue
		}
		if !dtLocalRe.MatchString(v) {
			return fmt.Errorf("مقدار «%s» نامعتبر است.", f)
		}
		dtVals[f] = &v
	}
	if dtVals["startDate"] != nil && dtVals["endDate"] != nil && *dtVals["endDate"] < *dtVals["startDate"] {
		return errors.New("پایان ترم قبل از شروع آن است.")
	}
	if dtVals["enrollmentStartDate"] != nil && dtVals["enrollmentEndDate"] != nil &&
		*dtVals["enrollmentEndDate"] < *dtVals["enrollmentStartDate"] {
		return errors.New("پایان انتخاب واحد قبل از شروع آن است.")
	}
	if dtVals["addDropStartDate"] != nil && dtVals["addDropEndDate"] != nil &&
		*dtVals["addDropEndDate"] < *dtVals["addDropStartDate"] {
		return errors.New("پایان حذف و اضافه قبل از شروع آن است.")
	}

	appeal := codeNum(vals["appealWindowDays"])
	if appeal == nil || *appeal < 0 || *appeal > 365 {
		return errors.New("مهلت اعتراض دانشجو باید بین ۰ تا ۳۶۵ روز باشد.")
	}
	sla := codeNum(vals["professorAppealSlaDays"])
	if sla == nil || *sla < 0 || *sla > 365 {
		return errors.New("مهلت پاسخ استاد باید بین ۰ تا ۳۶۵ روز باشد.")
	}
	isCur := 0
	if codeStrTrim(vals["isCurrent"]) == "1" {
		isCur = 1
	}
	isEnr := 0
	if codeStrTrim(vals["isEnrollmentOpen"]) == "1" {
		isEnr = 1
	}

	// Exam window — Jalali date 'YYYY/M/D' in exam_calendar_configs (stored as Jalali)
	exS := codeStrTrim(vals["examStartDate"])
	exE := codeStrTrim(vals["examEndDate"])
	if (exS != "" && exE == "") || (exS == "" && exE != "") {
		return errors.New("هر دو تاریخ شروع و پایان امتحانات را وارد کنید (یا هر دو را خالی بگذارید).")
	}
	var zoning *[2]string
	if exS != "" && exE != "" {
		if !jalaliDateRe.MatchString(exS) || !jalaliDateRe.MatchString(exE) {
			return errors.New("تاریخ امتحانات باید شمسی باشد — مانند 1404/01/15.")
		}
		a, b := normJalali(exS), normJalali(exE)
		if b < a {
			return errors.New("پایان امتحانات قبل از شروع آن است.")
		}
		zoning = &[2]string{a, b}
	}

	_, err = s.DB.Pool.Exec(ctx, `
		update academic_terms set
		  title = $1, "termType" = $2, "standardCode" = $3, "ministryCode" = $4,
		  "academicYear" = $5, "startDate" = $6::timestamp, "endDate" = $7::timestamp,
		  "enrollmentStartDate" = $8::timestamp, "enrollmentEndDate" = $9::timestamp,
		  "addDropStartDate" = $10::timestamp, "addDropEndDate" = $11::timestamp,
		  "gradeEntryDeadline" = $12::timestamp,
		  "appealWindowDays" = $13, "professorAppealSlaDays" = $14,
		  "isCurrent" = $15, "isEnrollmentOpen" = $16
		 where id = $17`,
		title, termType, optCode(vals["standardCode"]), optCode(vals["ministryCode"]),
		year, dtVals["startDate"], dtVals["endDate"],
		dtVals["enrollmentStartDate"], dtVals["enrollmentEndDate"],
		dtVals["addDropStartDate"], dtVals["addDropEndDate"],
		dtVals["gradeEntryDeadline"], int64(*appeal), int64(*sla), isCur, isEnr, id)
	if err != nil {
		return err
	}

	// Only one «ترم جاری» and one «باز بودن انتخاب واحد» exist per university — the rest are turned off
	uniScope := `"universityId" is null`
	scopeArgs := []any{}
	if universityID != nil {
		uniScope = `"universityId" = $2`
		scopeArgs = append(scopeArgs, *universityID)
	}
	if isCur == 1 {
		if universityID != nil {
			if _, err := s.DB.Pool.Exec(ctx, `
				update academic_terms set "isCurrent" = 0
				 where "isCurrent" = 1 and `+uniScope+` and id <> $1`, append([]any{id}, scopeArgs...)...); err != nil {
				return err
			}
		} else {
			if _, err := s.DB.Pool.Exec(ctx, `
				update academic_terms set "isCurrent" = 0
				 where "isCurrent" = 1 and "universityId" is null and id <> $1`, id); err != nil {
				return err
			}
		}
	}
	if isEnr == 1 {
		if universityID != nil {
			if _, err := s.DB.Pool.Exec(ctx, `
				update academic_terms set "isEnrollmentOpen" = 0
				 where "isEnrollmentOpen" = 1 and `+uniScope+` and id <> $1`, append([]any{id}, scopeArgs...)...); err != nil {
				return err
			}
		} else {
			if _, err := s.DB.Pool.Exec(ctx, `
				update academic_terms set "isEnrollmentOpen" = 0
				 where "isEnrollmentOpen" = 1 and "universityId" is null and id <> $1`, id); err != nil {
				return err
			}
		}
	}

	// Exam window: upsert in exam_calendar_configs — general/specialized ranges
	// previous ones are clamped into the new range (detail changes in the exams module).
	if zoning != nil {
		a, b := zoning[0], zoning[1]
		var (
			zID                      int64
			genS, genE, specS, specE string
		)
		err := s.DB.Pool.QueryRow(ctx, `
			select id, "generalStart", "generalEnd", "specializedStart", "specializedEnd"
			  from exam_calendar_configs where "termId" = $1 limit 1`, id).
			Scan(&zID, &genS, &genE, &specS, &specE)
		clamp := func(v string) string {
			if v == "" {
				return a
			}
			if v < a {
				return a
			}
			if v > b {
				return b
			}
			return v
		}
		if err == nil {
			_, err = s.DB.Pool.Exec(ctx, `
				update exam_calendar_configs set
				  "globalStart" = $1, "globalEnd" = $2,
				  "generalStart" = $3, "generalEnd" = $4,
				  "specializedStart" = $5, "specializedEnd" = $6,
				  "updatedByUserId" = $7, "updatedAt" = now()
				 where id = $8`,
				a, b, clamp(genS), clamp(genE), clamp(specS), clamp(specE), user.ID, zID)
			if err != nil {
				return err
			}
		} else if errors.Is(err, pgx.ErrNoRows) {
			_, err = s.DB.Pool.Exec(ctx, `
				insert into exam_calendar_configs
				  ("termId", "globalStart", "globalEnd", "generalStart", "generalEnd",
				   "specializedStart", "specializedEnd", "universityId", "updatedByUserId")
				values ($1, $2, $3, $2, $3, $2, $3, $4, $5)`,
				id, a, b, universityID, user.ID)
			if err != nil {
				return err
			}
		} else {
			return err
		}
	}
	return nil
}

// ── Deleting a reference record ──

// DeleteCodeRow is the deleteCodeRowAction port — delete only when it is not used anywhere.
//
// Instead of manually counting 10+ referencing tables, we let the database itself judge
// and translate the foreign-key error (SQLSTATE 23503) into a Persian message. This way
// no new table is overlooked.
func (s *Service) DeleteCodeRow(ctx context.Context, user *session.User, uniCookie, table string, id int64) error {
	if id <= 0 {
		return errors.New("رکورد نامعتبر است.")
	}
	// A term can be deleted too: since its code is not editable, if it is registered by mistake
	// the only way to correct it is to delete the unused record. The foreign-key guard blocks deleting
	// a term that has registrations or grades.
	switch table {
	case "degree", "faculty", "major", "term":
	default:
		return errors.New("حذف این جدول از این صفحه ممکن نیست.")
	}
	uniID := s.UniversityID(ctx, user, uniCookie)
	where := `id = $1`
	args := []any{id}
	if uniID != nil {
		// The record must belong to the active university (or be national)
		var u *int64
		err := s.DB.Pool.QueryRow(ctx,
			`select "universityId" from `+codeTableName(table)+` where id = $1`, id).Scan(&u)
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("رکورد یافت نشد.")
		}
		if err != nil {
			return err
		}
		if u != nil && *u != *uniID {
			return errors.New("رکورد متعلق به دانشگاه دیگری است.")
		}
		where = `id = $1 and ("universityId" = $2 or "universityId" is null)`
		args = append(args, *uniID)
	}
	_, err := s.DB.Pool.Exec(ctx, `delete from `+codeTableName(table)+` where `+where, args...)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return errors.New("این رکورد جای دیگری استفاده شده (رشته، دانشجو، درس، انتخاب واحد یا …) و حذف نمی‌شود. اول وابستگی‌ها را جابه‌جا کنید.")
		}
		return err
	}
	return nil
}
