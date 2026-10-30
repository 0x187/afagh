// ═══ مرکز گزارش‌های مالی — پورت admin/reports (مرکز مالی) ═══
//
// هفت گزارش مرکز مالی: شهریه/تراکنش، تعرفه، صورت‌حساب، کارتابل،
// حق‌التدریس و دو گزارش BI. منطق هر گزارش عیناً از همان ماژول‌های
// r-finance.ts / r-collect-external.ts / actions.ts گرفته شده تا اعداد
// گزارش با کارتابل و کارنامهٔ مالی واگرا نشوند.
package reports

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/admin"
	"backend-go/internal/bi"
	"backend-go/internal/fa"
	"backend-go/internal/finance"
	"backend-go/internal/jalali"
	"backend-go/internal/payroll"
	"backend-go/internal/session"
)

// Per تعداد ردیف در هر صفحه (همان PER در report-helpers.ts).
const Per = 50

// FilterOptions گزینه‌های فیلتر مرکز گزارش.
type FilterOptions struct {
	Terms        []TermOption       `json:"terms"`
	Degrees      []DegreeOption     `json:"degrees"`
	Faculties    []NamedOption      `json:"faculties"`
	Departments  []NamedCodeOption  `json:"departments"`
	Majors       []NamedCodeOption  `json:"majors"`
	EntryYears   []int              `json:"entryYears"`
	LatestTerm   string             `json:"latestTerm"`
	Universities []UniversityOption `json:"universities"`
}

// TermOption گزینهٔ ترم.
type TermOption struct {
	Code  string  `json:"code"`
	Title *string `json:"title"`
}

// DegreeOption گزینهٔ مقطع.
type DegreeOption struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

// NamedOption گزینهٔ نام‌دار.
type NamedOption struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// NamedCodeOption گزینهٔ نام‌دار با کد.
type NamedCodeOption struct {
	ID   int64   `json:"id"`
	Name string  `json:"name"`
	Code *string `json:"code"`
}

// UniversityOption گزینهٔ دانشگاه.
type UniversityOption struct {
	ID    int64  `json:"id"`
	Code  string `json:"code"`
	Title string `json:"title"`
	Kind  string `json:"kind"`
}

// Column ستون گزارش.
type Column struct {
	Key    string `json:"key"`
	Title  string `json:"title"`
	Format string `json:"format,omitempty"`
}

// Result نتیجهٔ یک صفحهٔ گزارش.
type Result struct {
	Columns    []Column         `json:"columns"`
	Rows       []map[string]any `json:"rows"`
	Total      int              `json:"total"`
	Page       int              `json:"page"`
	Per        int              `json:"per"`
	TotalPages int              `json:"totalPages"`
	Summary    string           `json:"summary,omitempty"`
}

// ExportResult خروجی CSV آمادهٔ کلاینت (عنوان‌ها و سطرهای قالب‌بندی‌شده).
type ExportResult struct {
	Header []string   `json:"header"`
	Lines  [][]string `json:"lines"`
}

// Filters فیلترهای گزارش — همان فیلدهای ReportFilters در Next.
type Filters struct {
	Term          string  `json:"term"`
	DegreeID      int64   `json:"degreeId"`
	FacultyID     int64   `json:"facultyId"`
	DepartmentID  int64   `json:"departmentId"`
	MajorID       int64   `json:"majorId"`
	EntryYear     int64   `json:"entryYear"`
	EntryYearFrom int64   `json:"entryYearFrom"`
	EntryYearTo   int64   `json:"entryYearTo"`
	EntryTerm     int64   `json:"entryTerm"`
	Gender        string  `json:"gender"`
	QuotaType     string  `json:"quotaType"`
	StatusScope   string  `json:"statusScope"`
	Q             string  `json:"q"`
	NationalCode  string  `json:"nationalCode"`
	Miss          string  `json:"miss"`
	Page          int     `json:"page"`
	OnlyDebtors   bool    `json:"onlyDebtors"`
	DossierStatus string  `json:"dossierStatus"`
	SessionID     int64   `json:"sessionId"`
	OrderBy       string  `json:"orderBy"`
	ShowFinance   string  `json:"showFinance"`
	CourseCode    string  `json:"courseCode"`
	ProfessorCode string  `json:"professorCode"`
	Status        string  `json:"status"`
	OnlyStale     *bool   `json:"onlyStale"`
	IDs           []int64 `json:"ids"`
	UniversityID  int64   `json:"universityId"`
}

// Service سرویس گزارش‌ها.
type Service struct {
	Pool    *pgxpool.Pool
	Finance *admin.Service
	Payroll *payroll.Engine
	BI      *bi.Service
}

// New ساخت سرویس.
func New(pool *pgxpool.Pool, financeSvc *admin.Service, payrollEngine *payroll.Engine, biSvc *bi.Service) *Service {
	return &Service{Pool: pool, Finance: financeSvc, Payroll: payrollEngine, BI: biSvc}
}

// Options پورت getFilterOptions — تفکیک دانشگاه fail-closed.
func (s *Service) Options(ctx context.Context, user *session.User, uniCookie string) (*FilterOptions, error) {
	opts := &FilterOptions{
		Terms: []TermOption{}, Degrees: []DegreeOption{}, Faculties: []NamedOption{},
		Departments: []NamedCodeOption{}, Majors: []NamedCodeOption{}, EntryYears: []int{},
		Universities: []UniversityOption{},
	}
	uid := int64(-1)
	if id := s.Finance.UniversityID(ctx, user, uniCookie); id != nil {
		uid = *id
	}

	if rows, err := s.Pool.Query(ctx, `
		select "termCode" as code, max(title) as title
		  from academic_terms where "universityId" = $1
		 group by "termCode" order by "termCode" desc`, uid); err == nil {
		for rows.Next() {
			var t TermOption
			if err := rows.Scan(&t.Code, &t.Title); err == nil {
				opts.Terms = append(opts.Terms, t)
			}
		}
		rows.Close()
	}
	if rows, err := s.Pool.Query(ctx, `select min(id) as id, title from degree_level_configs group by title order by min(id)`); err == nil {
		for rows.Next() {
			var d DegreeOption
			if err := rows.Scan(&d.ID, &d.Title); err == nil {
				opts.Degrees = append(opts.Degrees, d)
			}
		}
		rows.Close()
	}
	if rows, err := s.Pool.Query(ctx, `select id, name from faculties where "universityId" = $1 or "universityId" is null order by id`, uid); err == nil {
		for rows.Next() {
			var f NamedOption
			if err := rows.Scan(&f.ID, &f.Name); err == nil {
				opts.Faculties = append(opts.Faculties, f)
			}
		}
		rows.Close()
	}
	if rows, err := s.Pool.Query(ctx, `select id, name, "departmentCode" as code from departments where "universityId" = $1 or "universityId" is null order by name`, uid); err == nil {
		for rows.Next() {
			var d NamedCodeOption
			if err := rows.Scan(&d.ID, &d.Name, &d.Code); err == nil {
				opts.Departments = append(opts.Departments, d)
			}
		}
		rows.Close()
	}
	if rows, err := s.Pool.Query(ctx, `select id, name, "majorCode" as code from majors where "universityId" = $1 or "universityId" is null order by name`, uid); err == nil {
		for rows.Next() {
			var m NamedCodeOption
			if err := rows.Scan(&m.ID, &m.Name, &m.Code); err == nil {
				opts.Majors = append(opts.Majors, m)
			}
		}
		rows.Close()
	}
	if rows, err := s.Pool.Query(ctx, `select distinct "entryYear" as y from students where "universityId" = $1 order by 1 desc`, uid); err == nil {
		for rows.Next() {
			var y int
			if err := rows.Scan(&y); err == nil {
				opts.EntryYears = append(opts.EntryYears, y)
			}
		}
		rows.Close()
	}
	if rows, err := s.Pool.Query(ctx, `select id, code, title, kind from universities where "isActive" = 1 order by id`); err == nil {
		for rows.Next() {
			var u UniversityOption
			if err := rows.Scan(&u.ID, &u.Code, &u.Title, &u.Kind); err == nil {
				opts.Universities = append(opts.Universities, u)
			}
		}
		rows.Close()
	}
	if len(opts.Terms) > 0 {
		opts.LatestTerm = opts.Terms[0].Code
	}
	return opts, nil
}

// Run اجرای گزارش مرکز مالی.
func (s *Service) Run(ctx context.Context, user *session.User, uniCookie, kind string, f Filters) (*Result, error) {
	empty := &Result{Columns: []Column{}, Rows: []map[string]any{}, Page: 1, Per: Per, TotalPages: 1}
	uniID := s.Finance.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		empty.Summary = "دانشگاه فعال شما مشخص نیست؛ اجرای گزارش ممکن نیست."
		return empty, nil
	}
	f.UniversityID = *uniID

	switch kind {
	case "tuition":
		return s.runTuition(ctx, f)
	case "tuition-tariff":
		return s.runTariff(ctx, f)
	case "tuition-statement":
		return s.runStatement(ctx, f)
	case "finance-worklist":
		return s.runWorklist(ctx, user, uniCookie, f)
	case "payroll-overview":
		return s.runPayroll(ctx, f)
	case "bi-teaching-quality":
		return s.runBITeaching(ctx, f)
	case "bi-facilities":
		return s.runBIFacilities(ctx, f)
	}
	if res, err := s.runEduCore(ctx, kind, f); res != nil || err != nil {
		return res, err
	}
	if res, err := s.runEduExtra(ctx, kind, f); res != nil || err != nil {
		return res, err
	}
	if res, err := s.runEduExam(ctx, kind, f); res != nil || err != nil {
		return res, err
	}
	if res, err := s.runEduStaff(ctx, kind, f); res != nil || err != nil {
		return res, err
	}
	if res, err := s.runEduStatusOps(ctx, kind, f); res != nil || err != nil {
		return res, err
	}
	if res, err := s.runEduThesis(ctx, kind, f); res != nil || err != nil {
		return res, err
	}
	if res, err := s.runEduCouncil(ctx, kind, f); res != nil || err != nil {
		return res, err
	}
	return empty, nil
}

// ─────────────────── studentWhere (پورت report-helpers) ───────────────────

func studentWhere(f Filters, args *[]any) string {
	add := func(v any) string {
		*args = append(*args, v)
		return "$" + strconv.Itoa(len(*args))
	}
	conds := []string{}
	conds = append(conds, fmt.Sprintf(`(s."universityId" = %s OR s."universityId" IS NULL)`, add(f.UniversityID)))
	if f.DegreeID > 0 {
		conds = append(conds, fmt.Sprintf(`s."degreeLevelId" IN (SELECT id FROM degree_level_configs WHERE title = (SELECT title FROM degree_level_configs WHERE id = %s))`, add(f.DegreeID)))
	}
	if f.FacultyID > 0 {
		conds = append(conds, fmt.Sprintf(`m."facultyId" = %s`, add(f.FacultyID)))
	}
	if f.DepartmentID > 0 {
		conds = append(conds, fmt.Sprintf(`m."departmentId" = %s`, add(f.DepartmentID)))
	}
	if f.MajorID > 0 {
		conds = append(conds, fmt.Sprintf(`s."majorId" = %s`, add(f.MajorID)))
	}
	if f.EntryYear > 0 {
		conds = append(conds, fmt.Sprintf(`s."entryYear" = %s`, add(f.EntryYear)))
	}
	if f.EntryYearFrom > 0 {
		conds = append(conds, fmt.Sprintf(`s."entryYear" >= %s`, add(f.EntryYearFrom)))
	}
	if f.EntryYearTo > 0 {
		conds = append(conds, fmt.Sprintf(`s."entryYear" <= %s`, add(f.EntryYearTo)))
	}
	if f.EntryTerm > 0 {
		conds = append(conds, fmt.Sprintf(`s."entryTerm" = %s`, add(f.EntryTerm)))
	}
	if f.Gender == "MALE" || f.Gender == "FEMALE" {
		conds = append(conds, fmt.Sprintf(`u."gender" = %s`, add(f.Gender)))
	}
	if f.QuotaType != "" {
		conds = append(conds, fmt.Sprintf(`s."quotaType" = %s`, add(f.QuotaType)))
	}
	if f.StatusScope == "ACTIVE" {
		conds = append(conds, `s."status" = 'ACTIVE'`)
	} else if f.StatusScope == "INACTIVE" {
		conds = append(conds, `s."status" <> 'ACTIVE'`)
	}
	if f.NationalCode != "" {
		like := "%" + fa.EscapeLikeChars(fa.ToEnDigits(strings.TrimSpace(f.NationalCode))) + "%"
		conds = append(conds, fmt.Sprintf(`u."nationalCode" ILIKE %s ESCAPE '\'`, add(like)))
	}
	if f.Q != "" {
		like := "%" + fa.EscapeLikeChars(fa.ToEnDigits(strings.TrimSpace(f.Q))) + "%"
		p := add(like)
		conds = append(conds, fmt.Sprintf(`(s."studentCode" ILIKE %s ESCAPE '\' OR u."firstName" ILIKE %s ESCAPE '\' OR u."lastName" ILIKE %s ESCAPE '\' OR u."nationalCode" ILIKE %s ESCAPE '\')`, p, p, p, p))
	}
	return strings.Join(conds, " AND ")
}

func inList(args *[]any, values []string) string {
	parts := make([]string, len(values))
	for i, v := range values {
		*args = append(*args, v)
		parts[i] = "$" + strconv.Itoa(len(*args))
	}
	return strings.Join(parts, ", ")
}

// ─────────────────── صفحه‌بندی SQL ───────────────────

func (s *Service) pagedQuery(ctx context.Context, selectCols, from, where, groupBy, orderBy string, args []any, page int) ([]map[string]any, int, int, error) {
	return s.pagedQueryArgs(ctx, selectCols, from, where, groupBy, orderBy, args, args, page)
}

// pagedQueryArgs نسخهٔ جداشدهٔ count/data — گزارش‌هایی که در SELECT خود
// پارامتر دارند (مثل IN نوع‌های دفتر) نباید آن پارامترها را به کوئری شمارش
// بفرستند (Postgres: could not determine data type of parameter).
func (s *Service) pagedQueryArgs(ctx context.Context, selectCols, from, where, groupBy, orderBy string, countArgs, dataArgs []any, page int) ([]map[string]any, int, int, error) {
	grp := ""
	if groupBy != "" {
		grp = " GROUP BY " + groupBy
	}
	var total int
	countSQL := "SELECT COUNT(*)::int FROM (SELECT 1 " + from
	if where != "" {
		countSQL += " WHERE " + where
	}
	countSQL += grp + ") t"
	if err := s.Pool.QueryRow(ctx, countSQL, countArgs...).Scan(&total); err != nil {
		return nil, 0, 1, err
	}
	totalPages := int(math.Max(1, math.Ceil(float64(total)/Per)))
	if page < 1 {
		page = 1
	}
	if page > totalPages {
		page = totalPages
	}
	offset := (page - 1) * Per
	dataSQL := "SELECT " + selectCols + " " + from
	if where != "" {
		dataSQL += " WHERE " + where
	}
	dataSQL += grp + " " + orderBy + " LIMIT $" + strconv.Itoa(len(dataArgs)+1) + " OFFSET $" + strconv.Itoa(len(dataArgs)+2)
	dataArgs = append(dataArgs, Per, offset)
	rows, err := s.Pool.Query(ctx, dataSQL, dataArgs...)
	if err != nil {
		return nil, 0, 1, err
	}
	defer rows.Close()
	return scanRows(rows), total, totalPages, nil
}

func scanRows(rows pgx.Rows) []map[string]any {
	fields := rows.FieldDescriptions()
	names := make([]string, len(fields))
	for i, fd := range fields {
		names[i] = string(fd.Name)
	}
	out := []map[string]any{}
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			continue
		}
		m := make(map[string]any, len(names))
		for i, name := range names {
			m[name] = normalizeValue(vals[i])
		}
		out = append(out, m)
	}
	return out
}

func normalizeValue(v any) any {
	switch x := v.(type) {
	case time.Time:
		return x.UTC().Format(time.RFC3339Nano)
	case []byte:
		return string(x)
	default:
		return v
	}
}

func pageOf(columns []Column, all []map[string]any, page int, summary string) *Result {
	total := len(all)
	totalPages := int(math.Max(1, math.Ceil(float64(total)/Per)))
	if page < 1 {
		page = 1
	}
	if page > totalPages {
		page = totalPages
	}
	start := (page - 1) * Per
	end := start + Per
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}
	rows := all[start:end]
	if rows == nil {
		rows = []map[string]any{}
	}
	return &Result{Columns: columns, Rows: rows, Total: total, Page: page, Per: Per, TotalPages: totalPages, Summary: summary}
}

// ─────────────────── ۱) گزارش شهریه / تراکنش مالی ───────────────────

func (s *Service) runTuition(ctx context.Context, f Filters) (*Result, error) {
	args := []any{}
	conds := []string{`s."status" = 'ACTIVE'`, studentWhere(f, &args)}
	if f.Term != "" {
		args = append(args, f.Term)
		conds = append(conds, `t."termCode" = $`+strconv.Itoa(len(args)))
	}
	// پارامترهای WHERE فقط تا این‌جا هستند؛ پارامترهای IN داخل SELECT نباید به
	// کوئری شمارش بروند (وگرنه Postgres نوعشان را نمی‌تواند تعیین کند).
	whereArgs := append([]any{}, args...)
	debtIn := inList(&args, finance.DebtLedgerTypes)
	creditIn := inList(&args, finance.CreditLedgerTypes)
	from := `FROM students s JOIN users u ON u.id = s."userId"
		LEFT JOIN majors m ON m.id = s."majorId"
		LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
		LEFT JOIN student_ledger sl ON sl."studentId" = s.id
		LEFT JOIN academic_terms t ON t.id = sl."termId"`
	where := strings.Join(conds, " AND ")
	selectCols := `s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
		m.name AS major, d.title AS degree,
		COALESCE(SUM(CASE WHEN sl."transactionType" IN (` + debtIn + `) THEN sl.amount ELSE 0 END), 0)::float8 AS debt,
		COALESCE(SUM(CASE WHEN sl."transactionType" IN (` + creditIn + `) THEN sl.amount ELSE 0 END), 0)::float8 AS credit,
		(COALESCE(SUM(CASE WHEN sl."transactionType" IN (` + debtIn + `) THEN sl.amount ELSE 0 END), 0)
			- COALESCE(SUM(CASE WHEN sl."transactionType" IN (` + creditIn + `) THEN sl.amount ELSE 0 END), 0))::float8 AS balance,
		COUNT(sl.id)::int AS "txCount"`
	groupBy := `s."studentCode", u."firstName", u."lastName", m.name, d.title`
	rows, total, totalPages, err := s.pagedQueryArgs(ctx, selectCols, from, where, groupBy, `ORDER BY balance DESC`, whereArgs, args, f.Page)
	if err != nil {
		return nil, err
	}
	summary := fmt.Sprintf("%s ردیف (مانده = بدهی − اعتبار، بر پایهٔ واژگان کانونی دفتر کل)",
		faNumInt(int64(total)))
	columns := []Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"},
		{Key: "major", Title: "رشته"}, {Key: "degree", Title: "مقطع"},
		{Key: "debt", Title: "بدهی (ریال)", Format: "MONEY"}, {Key: "credit", Title: "اعتبار (ریال)", Format: "MONEY"},
		{Key: "balance", Title: "مانده (ریال)", Format: "MONEY"}, {Key: "txCount", Title: "تراکنش"},
	}
	return &Result{Columns: columns, Rows: rows, Total: total, Page: clampPage(f.Page, totalPages), Per: Per, TotalPages: totalPages, Summary: summary}, nil
}

func clampPage(page, totalPages int) int {
	if page < 1 {
		return 1
	}
	if page > totalPages {
		return totalPages
	}
	return page
}

func inListNoArgs(values []string) string {
	parts := make([]string, len(values))
	for i, v := range values {
		parts[i] = "'" + strings.ReplaceAll(v, "'", "''") + "'"
	}
	return strings.Join(parts, ", ")
}

func numOf(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int64:
		return float64(x)
	case int32:
		return float64(x)
	case int:
		return float64(x)
	case string:
		n, _ := strconv.ParseFloat(x, 64)
		return n
	}
	return 0
}

// ─────────────────── ۲) تعرفهٔ تحصیلی ───────────────────

func (s *Service) runTariff(ctx context.Context, f Filters) (*Result, error) {
	args := []any{}
	conds := []string{}
	conds = append(conds, fmt.Sprintf(`(tr."universityId" = %s OR tr."universityId" IS NULL)`, addArg(&args, f.UniversityID)))
	if f.DegreeID > 0 {
		conds = append(conds, fmt.Sprintf(`tr."degreeLevelId" = %s`, addArg(&args, f.DegreeID)))
	}
	if f.FacultyID > 0 {
		conds = append(conds, fmt.Sprintf(`tr."facultyId" = %s`, addArg(&args, f.FacultyID)))
	}
	if f.MajorID > 0 {
		conds = append(conds, fmt.Sprintf(`tr."majorId" = %s`, addArg(&args, f.MajorID)))
	}
	if f.EntryYear > 0 {
		conds = append(conds, fmt.Sprintf(`(tr."entryYearFrom" IS NULL OR tr."entryYearFrom" <= %s) AND (tr."entryYearTo" IS NULL OR tr."entryYearTo" >= %s)`,
			addArg(&args, f.EntryYear), addArg(&args, f.EntryYear)))
	}
	if f.Term != "" {
		conds = append(conds, fmt.Sprintf(`(tr."currentTermId" IS NULL OR at."termCode" = %s)`, addArg(&args, f.Term)))
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		like := "%" + fa.EscapeLikeChars(fa.ToEnDigits(q)) + "%"
		p := addArg(&args, like)
		conds = append(conds, fmt.Sprintf(`(tr.code ILIKE %s ESCAPE '\' OR tr.title ILIKE %s ESCAPE '\')`, p, p))
	}
	from := `FROM tuition_rules tr
		LEFT JOIN degree_level_configs d ON d.id = tr."degreeLevelId"
		LEFT JOIN majors m ON m.id = tr."majorId"
		LEFT JOIN faculties fc ON fc.id = tr."facultyId"
		LEFT JOIN financial_terms fct ON fct.id = tr."currentTermId"
		LEFT JOIN academic_terms at ON at.id = fct."academicTermId"`
	where := strings.Join(conds, " AND ")
	selectCols := `tr.code AS code, tr.title AS title, d.title AS degree, m.name AS major,
		tr."entryYearFrom" AS yfrom, tr."entryYearTo" AS yto, tr."termType" AS termtype,
		tr."fixedAmount"::float8 AS fixed, tr."perUnitTheory"::float8 AS theory,
		tr."perUnitPractical"::float8 AS practical, tr."perUnitGeneral"::float8 AS general,
		CASE WHEN tr."isActive" = 1 THEN 'فعال' ELSE 'غیرفعال' END AS active`
	rows, total, totalPages, err := s.pagedQuery(ctx, selectCols, from, where, "", `ORDER BY tr.priority, tr.id`, args, f.Page)
	if err != nil {
		return nil, err
	}
	columns := []Column{
		{Key: "code", Title: "کد تعرفه"}, {Key: "title", Title: "عنوان"},
		{Key: "degree", Title: "مقطع"}, {Key: "major", Title: "رشته"},
		{Key: "yfrom", Title: "ورودی از"}, {Key: "yto", Title: "ورودی تا"},
		{Key: "termtype", Title: "نوع ترم"}, {Key: "fixed", Title: "شهریه ثابت", Format: "MONEY"},
		{Key: "theory", Title: "نظری/واحد", Format: "MONEY"}, {Key: "practical", Title: "عملی/واحد", Format: "MONEY"},
		{Key: "general", Title: "عمومی/واحد", Format: "MONEY"}, {Key: "active", Title: "وضعیت"},
	}
	return &Result{Columns: columns, Rows: rows, Total: total, Page: clampPage(f.Page, totalPages), Per: Per, TotalPages: totalPages,
		Summary: faNumInt(int64(total)) + " قاعده تعرفه"}, nil
}

func addArg(args *[]any, v any) string {
	*args = append(*args, v)
	return "$" + strconv.Itoa(len(*args))
}

// ─────────────────── ۳) صورت‌حساب شهریه دانشجو ───────────────────

func (s *Service) runStatement(ctx context.Context, f Filters) (*Result, error) {
	args := []any{}
	where := studentWhere(f, &args)
	ledgerJoin := `LEFT JOIN student_ledger sl ON sl."studentId" = s.id`
	if f.Term != "" {
		args = append(args, f.Term)
		ledgerJoin += ` AND sl."termId" = (SELECT id FROM academic_terms WHERE "termCode" = $` + strconv.Itoa(len(args)) + ` LIMIT 1)`
	}
	from := `FROM students s JOIN users u ON u.id = s."userId"
		LEFT JOIN majors m ON m.id = s."majorId"
		LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
		` + ledgerJoin
	charge := `sl."transactionType" IN ('TUITION_FIXED','TUITION_VARIABLE','SUBJECT_ADDITIVE','TUITION_CHARGE','CHARGE','TUITION_ADJUST_DEC')`
	disc := `sl."transactionType" IN ('DISCOUNT_FIXED','DISCOUNT_VARIABLE','SUBJECT_DEDUCTIVE','TUITION_BATES','TUITION_ADJUST_INC')`
	paid := `sl."transactionType" IN ('PAYMENT','POS_PAYMENT','LOAN','SPONSORSHIP')`
	selectCols := `s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
		m.name AS major, d.title AS degree, s."entryYear" AS y,
		COALESCE(SUM(sl.amount) FILTER (WHERE ` + charge + `), 0)::float8 AS charge,
		COALESCE(SUM(sl.amount) FILTER (WHERE ` + disc + `), 0)::float8 AS discount,
		COALESCE(SUM(sl.amount) FILTER (WHERE ` + paid + `), 0)::float8 AS paid,
		(COALESCE(SUM(sl.amount) FILTER (WHERE ` + charge + `), 0)
			- COALESCE(SUM(sl.amount) FILTER (WHERE ` + disc + `), 0)
			- COALESCE(SUM(sl.amount) FILTER (WHERE ` + paid + `), 0))::float8 AS balance,
		COUNT(sl.id)::int AS txns`
	groupBy := `s.id, s."studentCode", u."firstName", u."lastName", m.name, d.title, s."entryYear"`
	rows, total, totalPages, err := s.pagedQuery(ctx, selectCols, from, where, groupBy, `ORDER BY balance DESC`, args, f.Page)
	if err != nil {
		return nil, err
	}
	columns := []Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"},
		{Key: "major", Title: "رشته"}, {Key: "degree", Title: "مقطع"},
		{Key: "y", Title: "ورودی"}, {Key: "charge", Title: "بدهی شهریه", Format: "MONEY"},
		{Key: "discount", Title: "تخفیف", Format: "MONEY"}, {Key: "paid", Title: "پرداختی", Format: "MONEY"},
		{Key: "balance", Title: "مانده بدهی", Format: "MONEY"}, {Key: "txns", Title: "تراکنش"},
	}
	summary := faNumInt(int64(total)) + " دانشجو"
	if f.Term != "" {
		summary += " — ترم " + f.Term
	} else {
		summary += " — همه ترم‌ها"
	}
	summary += " (مانده = بدهی − تخفیف − پرداختی)"
	return &Result{Columns: columns, Rows: rows, Total: total, Page: clampPage(f.Page, totalPages), Per: Per, TotalPages: totalPages, Summary: summary}, nil
}

// ─────────────────── ۴) کارتابل مالی ───────────────────

func (s *Service) runWorklist(ctx context.Context, user *session.User, uniCookie string, f Filters) (*Result, error) {
	search := strings.TrimSpace(f.Q)
	if search == "" {
		search = strings.TrimSpace(f.NationalCode)
	}
	in := admin.FinanceListFilters{Q: search, OnlyDebtors: f.OnlyDebtors, Limit: 1000}
	if f.MajorID > 0 {
		v := f.MajorID
		in.MajorID = &v
	}
	if f.DegreeID > 0 {
		v := f.DegreeID
		in.DegreeLevelID = &v
	}
	if f.EntryYear > 0 {
		v := int(f.EntryYear)
		in.EntryYear = &v
	}
	list, err := s.Finance.ListFinanceStudentsFiltered(ctx, user, uniCookie, in)
	if err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0, len(list.Students))
	for _, r := range list.Students {
		name := strings.TrimSpace(r.FullName)
		if name == "" {
			name = "—"
		}
		rows = append(rows, map[string]any{
			"code": r.StudentCode, "name": name, "nc": r.NationalCode,
			"major": r.MajorTitle, "degree": r.DegreeTitle, "y": r.EntryYear,
			"charges": r.Charges, "discounts": r.Discounts, "sponsorships": r.Sponsorships,
			"payments": r.Payments, "balance": r.Balance, "pending": r.ChequesPending,
		})
	}
	columns := []Column{
		{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"},
		{Key: "nc", Title: "کد ملی"}, {Key: "major", Title: "رشته"},
		{Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی"},
		{Key: "charges", Title: "بدهی", Format: "MONEY"}, {Key: "discounts", Title: "تخفیف", Format: "MONEY"},
		{Key: "sponsorships", Title: "حمایت", Format: "MONEY"}, {Key: "payments", Title: "پرداخت", Format: "MONEY"},
		{Key: "balance", Title: "مانده", Format: "MONEY"}, {Key: "pending", Title: "چک در راه", Format: "MONEY"},
	}
	summary := faNumInt(int64(len(rows))) + " دانشجو (سقف ۱۰۰۰)"
	if f.OnlyDebtors {
		summary += " — فقط بدهکار"
	}
	return pageOf(columns, rows, f.Page, summary), nil
}

// ─────────────────── ۵) حق‌التدریس اساتید ───────────────────

func (s *Service) runPayroll(ctx context.Context, f Filters) (*Result, error) {
	var termID *int64
	if f.Term != "" {
		var id int64
		if err := s.Pool.QueryRow(ctx, `
			select id from academic_terms where "termCode" = $1 and "universityId" = $2
			 order by id desc limit 1`, f.Term, f.UniversityID).Scan(&id); err == nil {
			termID = &id
		}
	}
	ov, err := s.Payroll.GetOverview(ctx, termID)
	if err != nil {
		return nil, err
	}
	q := strings.TrimSpace(f.Q)
	statusFa := map[string]string{
		"DRAFT": "پیش‌نویس", "MID_TERM_PAID": "میان‌ترم پرداخت",
		"FINAL_SETTLED": "تسویه نهایی", "NOT_COMPUTED": "محاسبه‌نشده",
	}
	rows := []map[string]any{}
	for _, x := range ov.List {
		name := x.Name
		code := ""
		if x.StaffCode != nil {
			code = *x.StaffCode
		}
		if q != "" && !strings.Contains(name, q) && !strings.Contains(code, q) {
			continue
		}
		st := x.Status
		if fa2, ok := statusFa[x.Status]; ok {
			st = fa2
		}
		rows = append(rows, map[string]any{
			"code": x.StaffCode, "name": name, "rank": x.Rank, "contract": x.ContractType,
			"units": x.PayableUnits, "gross": x.Gross, "tax": x.Tax, "net": x.Net,
			"paid": x.MidtermPaid + x.FinalPaid, "remaining": x.Remaining, "status": st,
		})
	}
	columns := []Column{
		{Key: "code", Title: "کد پرسنلی"}, {Key: "name", Title: "استاد"},
		{Key: "rank", Title: "رتبه"}, {Key: "contract", Title: "قرارداد"},
		{Key: "units", Title: "واحد قابل پرداخت", Format: "NUMBER"}, {Key: "gross", Title: "ناخالص", Format: "MONEY"},
		{Key: "tax", Title: "مالیات", Format: "MONEY"}, {Key: "net", Title: "خالص", Format: "MONEY"},
		{Key: "paid", Title: "پرداخت‌شده", Format: "MONEY"}, {Key: "remaining", Title: "مانده", Format: "MONEY"},
		{Key: "status", Title: "وضعیت"},
	}
	summary := fmt.Sprintf("ترم %s — بودجه %s — پرداخت %s — مانده %s (%s استاد)",
		ov.Term, faNumInt(int64(math.Round(ov.Totals.Budget))), faNumInt(int64(math.Round(ov.Totals.Paid))),
		faNumInt(int64(math.Round(ov.Totals.Remaining))), faNumInt(int64(ov.Totals.StaffCount)))
	return pageOf(columns, rows, f.Page, summary), nil
}

// ─────────────────── ۶) کیفیت تدریس (BI) ───────────────────

func (s *Service) runBITeaching(ctx context.Context, f Filters) (*Result, error) {
	ov := s.BI.ManagementOverview(ctx)
	q := strings.TrimSpace(f.Q)
	rows := []map[string]any{}
	for _, x := range ov.List {
		dep := ""
		if x.Department != nil {
			dep = *x.Department
		}
		if q != "" && !strings.Contains(x.Name, q) && !strings.Contains(dep, q) {
			continue
		}
		rank := "—"
		if x.Rank != nil && *x.Rank != "" {
			rank = *x.Rank
		}
		if dep == "" {
			dep = "—"
		}
		status := "عادی"
		if x.Flagged {
			status = "⚠ نیازمند بررسی"
		}
		rows = append(rows, map[string]any{
			"name": x.Name, "rankdept": rank + " / " + dep,
			"score": x.Score, "respondents": x.Respondents, "offerings": x.Offerings,
			"status": status,
		})
	}
	columns := []Column{
		{Key: "name", Title: "استاد"}, {Key: "rankdept", Title: "رتبه / گروه"},
		{Key: "score", Title: "نمره جاری", Format: "NUMBER"}, {Key: "respondents", Title: "پاسخ‌دهنده"},
		{Key: "offerings", Title: "کلاس"}, {Key: "status", Title: "وضعیت"},
	}
	summary := "ترم " + ov.Term
	if ov.Period != nil && *ov.Period != "" {
		summary += " — " + *ov.Period
	}
	summary += fmt.Sprintf(" — آستانه %s — %s علامت‌خورده", trimNum(ov.Threshold), faNumInt(int64(ov.FlaggedCount)))
	return pageOf(columns, rows, f.Page, summary), nil
}

// ─────────────────── ۷) امکانات کلاس‌ها (BI) ───────────────────

func (s *Service) runBIFacilities(ctx context.Context, f Filters) (*Result, error) {
	rep := s.BI.FacilitiesReport(ctx)
	q := strings.TrimSpace(f.Q)
	rows := []map[string]any{}
	for _, r := range rep.Rooms {
		building := ""
		if r.Building != nil {
			building = *r.Building
		}
		if q != "" && !strings.Contains(r.Room, q) && !strings.Contains(building, q) {
			continue
		}
		if building == "" {
			building = "—"
		}
		repair := "سالم"
		if r.NeedsRepair {
			repair = "🔧 نیازمند تعمیر"
		}
		rows = append(rows, map[string]any{
			"room": r.Room, "building": building, "worst": r.WorstAxis,
			"worstScore": r.WorstScore, "responses": r.Responses, "repair": repair,
		})
	}
	columns := []Column{
		{Key: "room", Title: "کلاس"}, {Key: "building", Title: "ساختمان"},
		{Key: "worst", Title: "ضعیف‌ترین شاخص"}, {Key: "worstScore", Title: "نمره شاخص", Format: "NUMBER"},
		{Key: "responses", Title: "پاسخ"}, {Key: "repair", Title: "وضعیت"},
	}
	summary := fmt.Sprintf("%s کلاس نیازمند تعمیر (آستانه %s)",
		faNumInt(int64(rep.NeedsRepairCount)), trimNum(rep.RepairThreshold))
	return pageOf(columns, rows, f.Page, summary), nil
}

// ─────────────────── خروجی CSV ───────────────────

// Export پورت exportReport — ورق‌زدن همهٔ صفحات تا سقف ۵۰۰۰ ردیف.
func (s *Service) Export(ctx context.Context, user *session.User, uniCookie, kind string, f Filters) (*ExportResult, error) {
	first, err := s.Run(ctx, user, uniCookie, kind, Filters{
		Term: f.Term, DegreeID: f.DegreeID, FacultyID: f.FacultyID, DepartmentID: f.DepartmentID,
		MajorID: f.MajorID, EntryYear: f.EntryYear, Q: f.Q, NationalCode: f.NationalCode,
		Miss: f.Miss, Page: 1, OnlyDebtors: f.OnlyDebtors, DossierStatus: f.DossierStatus,
	})
	if err != nil {
		return nil, err
	}
	all := append([]map[string]any{}, first.Rows...)
	for p := 2; p <= first.TotalPages && len(all) < 5000; p++ {
		ff := f
		ff.Page = p
		r, err := s.Run(ctx, user, uniCookie, kind, ff)
		if err != nil {
			return nil, err
		}
		all = append(all, r.Rows...)
	}
	if len(all) > 5000 {
		all = all[:5000]
	}
	header := make([]string, len(first.Columns))
	for i, c := range first.Columns {
		header[i] = csvGuard(c.Title)
	}
	lines := make([][]string, 0, len(all))
	for _, row := range all {
		line := make([]string, len(first.Columns))
		for i, c := range first.Columns {
			line[i] = csvGuard(FormatCell(row[c.Key], c.Format))
		}
		lines = append(lines, line)
	}
	return &ExportResult{Header: header, Lines: lines}, nil
}

// CSVGuard باگ تزریق فرمول: مقادیر شروع‌شونده با = + - @ | تب/CR.
func csvGuard(v string) string {
	trimmed := strings.TrimLeft(v, " \t")
	if trimmed != "" && strings.ContainsRune("=+-@|\t\r", rune(trimmed[0])) {
		return "'" + v
	}
	return v
}

// ─────────────────── قالب‌بندی سلول ───────────────────

// FormatCell پورت formatReportCell — هیچ تاریخ میلادی/مبلغ بی‌جداکننده.
func FormatCell(value any, format string) string {
	switch p := value.(type) {
	case nil:
		return "—"
	case *string:
		if p == nil {
			return "—"
		}
		return FormatCell(*p, format)
	case *int:
		if p == nil {
			return "—"
		}
		return FormatCell(*p, format)
	case *int64:
		if p == nil {
			return "—"
		}
		return FormatCell(*p, format)
	case *float64:
		if p == nil {
			return "—"
		}
		return FormatCell(*p, format)
	case *bool:
		if p == nil {
			return "—"
		}
		return FormatCell(*p, format)
	}
	if value == "" {
		return "—"
	}
	switch format {
	case "DATE":
		return jalaliSmart(value, false)
	case "DATETIME":
		return jalaliSmart(value, true)
	case "MONEY":
		return faNumInt(int64(math.Round(numOf(value)))) + " ریال"
	case "NUMBER":
		return faNumInt(int64(math.Round(numOf(value))))
	}
	return fmt.Sprint(value)
}

func jalaliSmart(value any, withTime bool) string {
	raw := strings.TrimSpace(fmt.Sprint(value))
	if raw == "" {
		return "—"
	}
	// از قبل شمسی؟
	if len(raw) >= 8 && (strings.HasPrefix(raw, "13") || strings.HasPrefix(raw, "14")) {
		sep := strings.IndexAny(raw, "/-")
		if sep > 0 {
			return jalali.FaDigits(strings.ReplaceAll(raw, "-", "/"))
		}
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, raw); err == nil {
			j := jalali.ToJalaliFromTime(t)
			date := fmt.Sprintf("%04d/%02d/%02d", j.Y, j.M, j.D)
			if withTime {
				date += fmt.Sprintf(" %02d:%02d", t.Hour(), t.Minute())
			}
			return jalali.FaDigits(date)
		}
	}
	return jalali.FaDigits(raw)
}

// faNumInt ارقام فارسی با جداکنندهٔ هزارگان (همان toLocaleString en-US سپس faDigits).
func faNumInt(v int64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	s := strconv.FormatInt(v, 10)
	var b strings.Builder
	for i, d := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(d)
	}
	out := jalali.FaDigits(b.String())
	if neg {
		return "-" + out
	}
	return out
}

func trimNum(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// StudentsPicker فهرست دانشجویان انتخاب‌گر صورت‌حساب (limit 500).
func (s *Service) StudentsPicker(ctx context.Context, user *session.User, uniCookie string) ([]map[string]any, error) {
	list, err := s.Finance.ListFinanceStudentsFiltered(ctx, user, uniCookie, admin.FinanceListFilters{Limit: 500})
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(list.Students))
	for _, r := range list.Students {
		out = append(out, map[string]any{
			"studentId": r.StudentID, "studentCode": r.StudentCode,
			"firstName": r.FirstName, "lastName": r.LastName,
			"nationalCode": r.NationalCode, "majorTitle": r.MajorTitle,
			"degreeTitle": r.DegreeTitle, "entryYear": r.EntryYear, "status": r.Status,
			"balance": r.Balance, "pendingCheques": r.ChequesPending,
		})
	}
	return out, nil
}
