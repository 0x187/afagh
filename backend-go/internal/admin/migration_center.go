// ═══ میز کار مهاجرت داده (ETL) — پورت admin/migration ═══
//
//	پورت actions.ts + lib/migration/*:
//	  • سربرگ «دادهٔ پایه»: واردسازی CSV (نمرات/فرمول شهریه/مالی قدیمی/تطبیق کدها)
//	    با ساخت «دسته» در legacy_import_batches و نگه‌داشتن سطر خام برای پردازش دوباره
//	  • سربرگ «تطبیق کدها»: legacy_code_maps با دامنه‌های ثابت + پیشنهاد خودکار متنی
//	  • سربرگ «شهریه و مالی»: فرمول‌ها + ارزیاب امن عبارت + مقایسه + مانده اولیه
//	  • سربرگ «نمرات»: staging → مقایسه → اعمال آگاهانه با دفتر واگرد
//	  • «ناحیهٔ موقت و واگرد»: فهرست دسته‌ها، پردازش دوباره، واگرد از migration_audit_entries
//
//	تفاوت آگاهانه با Next: ورودی فایل‌ها فقط CSV است (بکند Go کتابخانهٔ xlsx
//	ندارد)؛ بقیهٔ جریان عیناً همان است.
package admin

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/fa"
	"backend-go/internal/session"
)

// ═══════════════ نرمال‌سازی (پورت normalize.ts) ═══════════════

var migArabicLetters = strings.NewReplacer(
	"\u064A", "ی", "\u0649", "ی", "\u06CD", "ی", "\u06D2", "ی",
	"\u0643", "ک", "\u06AA", "ک", "\u06AB", "ک",
	"\u0629", "ه", "\u0624", "و",
)

// MigNorm پورت norm(): ارقام فارسی/عربی → لاتین، جداکنندهٔ هزارگان، نیم‌فاصله.
func MigNorm(v any) string {
	if v == nil {
		return ""
	}
	s := migArabicLetters.Replace(fmt.Sprint(v))
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= '۰' && r <= '۹':
			b.WriteRune(rune('0' + r - '۰'))
		case r >= '٠' && r <= '٩':
			b.WriteRune(rune('0' + r - '٠'))
		case r == '\u066B': // ممیز فارسی
			b.WriteByte('.')
		case r == '\u200c' || r == '\u200f' || r == ' ' || r == '\t':
			b.WriteByte(' ')
		default:
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// MigNum عدد از هر فرمت فارسی — 0 اگر خالی/نامعتبر و ok=false.
func MigNum(v any) (float64, bool) {
	s := strings.ReplaceAll(MigNorm(v), " ", "")
	if s == "" {
		return 0, false
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

// migHeaderKey کلید تطبیق سرستون (پورت headerKey).
func migHeaderKey(x string) string {
	s := strings.ToLower(MigNorm(x))
	s = strings.NewReplacer("آ", "ا", "أ", "ا", "إ", "ا", "ٲ", "ا", "ٳ", "ا").Replace(s)
	return strings.Trim(s, " _-./\\()[]:،,")
}

// migPickCol یافتن ستون با نامک‌های فارسی/انگلیسی (پورت pickCol).
func migPickCol(headers []string, aliases []string) int {
	hk := make([]string, len(headers))
	for i, h := range headers {
		hk[i] = migHeaderKey(h)
	}
	for _, a := range aliases {
		key := migHeaderKey(a)
		for i, h := range hk {
			if h == key {
				return i
			}
		}
	}
	for _, a := range aliases {
		key := migHeaderKey(a)
		if len(key) < 4 {
			continue
		}
		found, count := -1, 0
		for i, h := range hk {
			if strings.Contains(h, key) {
				count++
				if found < 0 {
					found = i
				}
			}
		}
		if count == 1 {
			return found
		}
	}
	return -1
}

// MigParseCsv پورت parseCsv: BOM، کوتیشن، تشخیص جداکنندهٔ کاما/سمی‌کالن/تب.
func MigParseCsv(text string) [][]string {
	clean := strings.TrimPrefix(text, "\uFEFF")
	clean = strings.ReplaceAll(clean, "\r\n", "\n")
	clean = strings.ReplaceAll(clean, "\r", "\n")
	firstLine := clean
	if i := strings.IndexByte(clean, '\n'); i >= 0 {
		firstLine = clean[:i]
	}
	delim := ','
	best := 0
	for _, d := range []rune{',', ';', '\t'} {
		if n := strings.Count(firstLine, string(d)); n > best {
			best = n
			delim = d
		}
	}
	rd := csv.NewReader(strings.NewReader(clean))
	rd.Comma = delim
	rd.FieldsPerRecord = -1
	rd.LazyQuotes = true
	rows, err := rd.ReadAll()
	if err != nil {
		return nil
	}
	out := [][]string{}
	for _, r := range rows {
		keep := false
		for _, c := range r {
			if strings.TrimSpace(c) != "" {
				keep = true
				break
			}
		}
		if keep {
			out = append(out, r)
		}
	}
	return out
}

// MigTable جدول استخراج‌شده از فایل — پورت Table در tabular.ts.
type MigTable struct {
	Sheet     string
	Headers   []string
	Rows      [][]string
	ColumnMap map[string]int // کلید فیلد → شمارهٔ ستون (اولویت بر تشخیص خودکار)
}

// Get خواندن ستون با نامک‌ها برای سطر i (۰-مبنا؛ خط انسانی = i+2).
func (t *MigTable) Get(row int, aliases []string) string {
	idx := -1
	if t.ColumnMap != nil {
		if v, ok := t.ColumnMap[aliases[0]]; ok {
			idx = v
		}
	}
	if idx < 0 {
		idx = migPickCol(t.Headers, aliases)
	}
	if idx < 0 || row >= len(t.Rows) || idx >= len(t.Rows[row]) {
		return ""
	}
	return MigNorm(t.Rows[row][idx])
}

// RawAll کل سطر به‌صورت سرستون→مقدار (برای staging).
func (t *MigTable) RawAll(row int) map[string]string {
	out := map[string]string{}
	if row >= len(t.Rows) {
		return out
	}
	for c, h := range t.Headers {
		if h == "" || c >= len(t.Rows[row]) {
			continue
		}
		out[h] = MigNorm(t.Rows[row][c])
	}
	return out
}

// ═══════════════ گزارش واردسازی (پورت ImportReport) ═══════════════

type MigRowMsg struct {
	Row int    `json:"row"`
	Msg string `json:"msg"`
}

type MigReport struct {
	Kind     string         `json:"kind"`
	FileName string         `json:"fileName"`
	Sheet    string         `json:"sheet"`
	Total    int            `json:"total"`
	Inserted int            `json:"inserted"`
	Updated  int            `json:"updated"`
	Invalid  int            `json:"invalid"`
	Errors   []MigRowMsg    `json:"errors"`
	Warnings []MigRowMsg    `json:"warnings"`
	Sample   map[string]any `json:"sample,omitempty"`
}

func migEmptyReport(kind, fileName, sheet string) *MigReport {
	return &MigReport{Kind: kind, FileName: fileName, Sheet: sheet, Errors: []MigRowMsg{}, Warnings: []MigRowMsg{}}
}

// ═══════════════ سربرگ «دادهٔ پایه» — موجودیت‌ها و سرورهای مبدأ ═══════════════

type MigSource struct {
	Code  string  `json:"code"`
	Title string  `json:"title"`
	Kind  *string `json:"kind"`
	Note  *string `json:"note"`
}

// ListSources فهرست سرورهای مبدأ.
func (s *Service) ListSources(ctx context.Context) ([]MigSource, error) {
	rows, err := s.DB.Pool.Query(ctx, `select code, title, kind, note from legacy_sources order by code`)
	if err != nil {
		return []MigSource{}, err
	}
	defer rows.Close()
	out := []MigSource{}
	for rows.Next() {
		var r MigSource
		if err := rows.Scan(&r.Code, &r.Title, &r.Kind, &r.Note); err == nil {
			out = append(out, r)
		}
	}
	return out, rows.Err()
}

// SaveMigrationSource ثبت/به‌روزرسانی سرور مبدأ (پورت saveSourceAction).
func (s *Service) SaveMigrationSource(input struct{ Code, Title, Kind, Note string }) error {
	code := strings.ToUpper(strings.TrimSpace(input.Code))
	if code == "" {
		code = "LEGACY"
	}
	re := regexp.MustCompile(`^[A-Z0-9_-]{2,50}$`)
	if !re.MatchString(code) {
		return errors.New("کد مبدأ فقط حروف لاتین/عدد/خط تیره (۲ تا ۵۰ نویسه).")
	}
	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = code
	}
	kind := strings.TrimSpace(input.Kind)
	if kind == "" {
		kind = "OTHER"
	}
	var note any
	if strings.TrimSpace(input.Note) != "" {
		note = input.Note
	}
	_, err := s.DB.Pool.Exec(ctx0(),
		`insert into legacy_sources (code, title, kind, note) values ($1,$2,$3,$4)
		 on conflict (code) do update set title = $2, kind = $3, note = $4`, code, title, kind, note)
	return err
}

// ctx0 زمینهٔ بدون انصراف برای متدهای بدون ctx (سازگاری امضاها).
func ctx0() context.Context { return context.Background() }

// ═══════════════ میز تطبیق کدها (پورت codemap.ts) ═══════════════

type MigDomainDef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Hint  string `json:"hint"`
}

// MigDomains پورت MAP_DOMAINS — دامنه‌های میز تطبیق.
var MigDomains = []MigDomainDef{
	{ID: "MAJOR", Title: "رشته/گرایش", Hint: "کد رشتهٔ سیستم قدیمی → رشتهٔ سامانهٔ جدید"},
	{ID: "DEGREE", Title: "مقطع تحصیلی", Hint: "کد مقطع قدیمی → مقطع جدید"},
	{ID: "TERM", Title: "ترم تحصیلی", Hint: "کد ترم قدیمی (۹۹۱، ۴۰۲۱…) → ترم جدید"},
	{ID: "COURSE", Title: "درس", Hint: "کد درس قدیمی → درس کاتالوگ جدید"},
	{ID: "DEPARTMENT", Title: "گروه آموزشی", Hint: "کد گروه/دانشکدهٔ قدیمی → گروه جدید"},
	{ID: "STUDENT_STATUS", Title: "وضعیت دانشجو", Hint: "وضعیت قدیمی → وضعیت استاندارد"},
	{ID: "GRADE_STATUS", Title: "وضعیت نمره", Hint: "وضعیت نمرهٔ قدیمی → وضعیت جدید"},
	{ID: "TX_TYPE", Title: "نوع تراکنش مالی", Hint: "نوع سند مالی قدیمی → بدهکار/بستانکار"},
	{ID: "COURSE_TYPE", Title: "نوع درس", Hint: "نوع درس قدیمی → نوع استاندارد"},
	{ID: "QUOTA", Title: "سهمیه", Hint: "سهمیهٔ قدیمی → سهمیهٔ جدید"},
	{ID: "FEE_ITEM", Title: "اقلام شهریه", Hint: "عنوان ردیف شهریهٔ قدیمی → قلم استاندارد شهریه"},
}

// MigFixedOptions فهرست ثابت دامنه‌های بدون جدول (پورت fixed در MAP_DOMAINS).
var MigFixedOptions = map[string][]MigOption{
	"STUDENT_STATUS": {
		{Code: "ACTIVE", Title: "فعال"}, {Code: "GRADUATED", Title: "فارغ‌التحصیل"},
		{Code: "EXPELLED", Title: "اخراج/انصراف"}, {Code: "BLOCKED_COMMISSION", Title: "مسدود (کمیسیون)"},
		{Code: "ON_LEAVE", Title: "مرخصی تحصیلی"},
	},
	"GRADE_STATUS": {
		{Code: "FINALIZED", Title: "قطعی"}, {Code: "TEMPORARY", Title: "موقت"},
		{Code: "PENDING", Title: "ثبت‌نشده"}, {Code: "PASSED_NO_GRADE", Title: "قبول بدون نمره"},
		{Code: "FAILED_NO_GRADE", Title: "مردود بدون نمره"}, {Code: "EXEMPT", Title: "معادل‌سازی/معافیت"},
	},
	"TX_TYPE": {
		{Code: "DEBIT", Title: "بدهی (شهریه/قبض)"}, {Code: "CREDIT", Title: "بستانکار (پرداخت/تخفیف)"},
	},
	"COURSE_TYPE": {
		{Code: "THEORY", Title: "نظری"}, {Code: "PRACTICAL", Title: "عملی/آزمایشگاه"},
		{Code: "GENERAL", Title: "عمومی"}, {Code: "PROJECT", Title: "پروژه/پایان‌نامه"},
	},
	"QUOTA": {
		{Code: "NORMAL", Title: "آزاد/عادی"}, {Code: "SHAHED", Title: "شاهد و ایثارگر"},
		{Code: "STAFF", Title: "کارکنان"}, {Code: "TOP_TALENT", Title: "استعداد درخشان"},
	},
	"FEE_ITEM": {
		{Code: "FIXED", Title: "شهریهٔ ثابت"}, {Code: "PER_UNIT_THEORY", Title: "هر واحد نظری"},
		{Code: "PER_UNIT_PRACTICAL", Title: "هر واحد عملی"}, {Code: "PER_UNIT_GENERAL", Title: "هر واحد عمومی"},
		{Code: "SERVICE", Title: "خدمات جانبی (خوابگاه/بیمه)"}, {Code: "PENALTY", Title: "جریمه/دیرکرد"},
		{Code: "DISCOUNT", Title: "تخفیف"},
	},
}

type MigOption struct {
	ID    *int64 `json:"id"`
	Code  string `json:"code"`
	Title string `json:"title"`
}

// MigrationTargetOptions گزینه‌های مقصد هر دامنه (پورت targetOptions).
func (s *Service) MigrationTargetOptions(ctx context.Context, domain string) ([]MigOption, error) {
	if fx, ok := MigFixedOptions[domain]; ok {
		return fx, nil
	}
	var q string
	switch domain {
	case "MAJOR":
		q = `select id, coalesce("majorCode", id::text), name from majors order by name`
	case "DEGREE":
		q = `select id, code, title from degree_level_configs order by id`
	case "TERM":
		q = `select id, "termCode", title from academic_terms order by "termCode"`
	case "COURSE":
		q = `select id, code, title from courses order by code limit 3000`
	case "DEPARTMENT":
		q = `select id, id::text, name from departments order by name`
	default:
		return []MigOption{}, nil
	}
	rows, err := s.DB.Pool.Query(ctx, q)
	if err != nil {
		return []MigOption{}, err
	}
	defer rows.Close()
	out := []MigOption{}
	for rows.Next() {
		var o MigOption
		var id int64
		if err := rows.Scan(&id, &o.Code, &o.Title); err == nil {
			o.ID = &id
			out = append(out, o)
		}
	}
	return out, rows.Err()
}

type MigMapRow struct {
	ID          int64   `json:"id"`
	SourceCode  string  `json:"sourceCode"`
	Domain      string  `json:"domain"`
	LegacyCode  string  `json:"legacyCode"`
	LegacyTitle *string `json:"legacyTitle"`
	TargetID    *int64  `json:"targetId"`
	TargetCode  *string `json:"targetCode"`
	TargetTitle *string `json:"targetTitle"`
	Confidence  *string `json:"confidence"`
	Status      string  `json:"status"`
	Note        *string `json:"note"`
}

type MigDomainStat struct {
	Domain    string `json:"domain"`
	Title     string `json:"title"`
	Total     int    `json:"total"`
	Confirmed int    `json:"confirmed"`
	Suggested int    `json:"suggested"`
	Unmapped  int    `json:"unmapped"`
}

// ListMigrationCodeMaps فهرست نگاشت‌ها + گزینه‌ها + آمار (پورت codemaps route).
func (s *Service) ListMigrationCodeMaps(ctx context.Context, sourceCode, domain string) (maps []MigMapRow, options []MigOption, stats []MigDomainStat, err error) {
	maps = []MigMapRow{}
	options = []MigOption{}
	stats = []MigDomainStat{}
	clean := migCleanSource(sourceCode)
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "sourceCode", domain, "legacyCode", "legacyTitle", "targetId",
		       "targetCode", "targetTitle", "confidence"::text, status, note
		  from legacy_code_maps
		 where "sourceCode" = $1 and ($2::text is null or domain = $2)
		 order by domain, "legacyCode" limit 5000`, clean, nilIfEmpty(domain))
	if err != nil {
		return nil, nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r MigMapRow
		if err := rows.Scan(&r.ID, &r.SourceCode, &r.Domain, &r.LegacyCode, &r.LegacyTitle,
			&r.TargetID, &r.TargetCode, &r.TargetTitle, &r.Confidence, &r.Status, &r.Note); err == nil {
			maps = append(maps, r)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, nil, err
	}

	byDomain := map[string][]MigMapRow{}
	for _, m := range maps {
		byDomain[m.Domain] = append(byDomain[m.Domain], m)
	}
	for _, d := range MigDomains {
		mine := byDomain[d.ID]
		st := MigDomainStat{Domain: d.ID, Title: d.Title, Total: len(mine)}
		for _, m := range mine {
			switch m.Status {
			case "CONFIRMED":
				st.Confirmed++
			case "SUGGESTED":
				st.Suggested++
			case "UNMAPPED":
				st.Unmapped++
			}
		}
		stats = append(stats, st)
	}
	if domain != "" {
		options, err = s.MigrationTargetOptions(ctx, domain)
	}
	return maps, options, stats, err
}

func migCleanSource(v string) string {
	v = strings.ToUpper(strings.TrimSpace(v))
	if v == "" {
		return "LEGACY"
	}
	return v
}

func nilIfEmpty(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

// SaveMigrationMap تأیید/تغییر دستی یک نگاشت (پورت saveMapAction).
func (s *Service) SaveMigrationMap(ctx context.Context, user *session.User, id int64, targetCode *string, status string) error {
	var domain, legacyCode string
	if err := s.DB.Pool.QueryRow(ctx,
		`select domain, "legacyCode" from legacy_code_maps where id = $1`, id).Scan(&domain, &legacyCode); err != nil {
		return errors.New("ردیف یافت نشد.")
	}
	if status == "IGNORED" {
		_, err := s.DB.Pool.Exec(ctx, `
			update legacy_code_maps set status = 'IGNORED', "updatedByUserId" = $2, "updatedAt" = now() where id = $1`, id, user.ID)
		return err
	}
	if targetCode == nil || strings.TrimSpace(*targetCode) == "" {
		_, err := s.DB.Pool.Exec(ctx, `
			update legacy_code_maps set "targetId" = null, "targetCode" = null, "targetTitle" = null,
			       confidence = '0', status = 'UNMAPPED', "updatedByUserId" = $2, "updatedAt" = now() where id = $1`, id, user.ID)
		return err
	}
	options, err := s.MigrationTargetOptions(ctx, domain)
	if err != nil {
		return err
	}
	var hit *MigOption
	for i := range options {
		if options[i].Code == strings.TrimSpace(*targetCode) {
			hit = &options[i]
			break
		}
	}
	if hit == nil {
		return errors.New("گزینهٔ مقصد نامعتبر است.")
	}
	_, err = s.DB.Pool.Exec(ctx, `
		update legacy_code_maps set "targetId" = $2, "targetCode" = $3, "targetTitle" = $4,
		       confidence = '100', status = 'CONFIRMED', "updatedByUserId" = $5, "updatedAt" = now()
		 where id = $1`, id, hit.ID, hit.Code, hit.Title, user.ID)
	return err
}

// SetMigrationNewCode ثبت «کد جدید» آزاد برای یک کد قدیمی (پورت setNewCodeAction).
func (s *Service) SetMigrationNewCode(ctx context.Context, user *session.User, id int64, newCode string) error {
	var domain, legacyCode, sourceCode, legacyTitle *string
	if err := s.DB.Pool.QueryRow(ctx, `
		select domain, "legacyCode", "sourceCode", "legacyTitle" from legacy_code_maps where id = $1`, id).
		Scan(&domain, &legacyCode, &sourceCode, &legacyTitle); err != nil {
		return errors.New("ردیف یافت نشد.")
	}
	code := strings.ReplaceAll(MigNorm(newCode), " ", "")
	if code == "" {
		// خالی‌کردن کد جدید = لغو جایگزینی
		_, err := s.DB.Pool.Exec(ctx, `
			update legacy_code_maps set "targetCode" = null, "targetTitle" = null, "targetId" = null,
			       confidence = '0', status = 'UNMAPPED', "updatedByUserId" = $2, "updatedAt" = now() where id = $1`, id, user.ID)
		return err
	}
	re := regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_\-./]{0,49}$`)
	if !re.MatchString(code) {
		return errors.New("کد جدید فقط حروف لاتین، رقم و نویسه‌های _ - . / (حداکثر ۵۰ نویسه) و شروع با حرف یا رقم.")
	}
	if strings.EqualFold(code, *legacyCode) {
		return errors.New("کد جدید با کد قدیمی یکسان است — جایگزینی بی‌اثر خواهد بود.")
	}
	// دو کد قدیمیِ متفاوت نباید به یک کد جدید برسند.
	var clashCode *string
	var clashID int64
	err := s.DB.Pool.QueryRow(ctx, `
		select id, "legacyCode" from legacy_code_maps
		 where "sourceCode" = $1 and domain = $2 and "targetCode" = $3 and status = 'CONFIRMED' and id <> $4
		 limit 1`, *sourceCode, *domain, code, id).Scan(&clashID, &clashCode)
	if err == nil && clashCode != nil {
		return fmt.Errorf("کد جدید «%s» قبلاً برای کد قدیمی «%s» ثبت شده — دو کد قدیمی نمی‌توانند به یک کد جدید تبدیل شوند.", code, *clashCode)
	}
	_, err = s.DB.Pool.Exec(ctx, `
		update legacy_code_maps set "targetCode" = $2, "targetTitle" = "legacyTitle", "targetId" = null,
		       confidence = '100', status = 'CONFIRMED', "updatedByUserId" = $3, "updatedAt" = now() where id = $1`, id, code, user.ID)
	return err
}

// ═══ شباهت متنی برای پیشنهاد خودکار (پورت similarity/suggest) ═══

var migStopTokens = map[string]bool{
	"رشته": true, "گرایش": true, "مهندسی": true, "کارشناسی": true, "ارشد": true,
	"دکتری": true, "ناپیوسته": true, "پیوسته": true, "دانشکده": true, "گروه": true,
	"درس": true, "واحد": true,
}

func migCanon(s string) string {
	s = strings.ToLower(MigNorm(s))
	var b strings.Builder
	for _, r := range s {
		switch r {
		case 'ي', 'ى':
			b.WriteRune('ی')
		case 'ك', 'ک':
			b.WriteRune('ک')
		case 'ۀ', 'ه', 'ة':
			b.WriteRune('ه')
		case 'أ', 'إ', 'آ', 'ا':
			b.WriteRune('ا')
		default:
			if unicode.IsLetter(r) || unicode.IsNumber(r) {
				b.WriteRune(r)
			} else {
				b.WriteByte(' ')
			}
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func migTokens(s string) []string {
	out := []string{}
	for _, t := range strings.Fields(migCanon(s)) {
		if len([]rune(t)) > 1 && !migStopTokens[t] {
			out = append(out, t)
		}
	}
	return out
}

func migLevenshtein(a, b string) int {
	ar, br := []rune(a), []rune(b)
	if a == b {
		return 0
	}
	if len(ar) == 0 || len(br) == 0 {
		if len(ar) > len(br) {
			return len(ar)
		}
		return len(br)
	}
	prev := make([]int, len(br)+1)
	cur := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ar); i++ {
		cur[0] = i
		for j := 1; j <= len(br); j++ {
			cost := 1
			if ar[i-1] == br[j-1] {
				cost = 0
			}
			m := prev[j] + 1
			if cur[j-1]+1 < m {
				m = cur[j-1] + 1
			}
			if prev[j-1]+cost < m {
				m = prev[j-1] + cost
			}
			cur[j] = m
		}
		prev, cur = cur, prev
	}
	return prev[len(br)]
}

// migSimilarity امتیاز شباهت ۰..۱۰۰ — ترکیب تطابق دقیق کد، اشتراک توکن‌ها و فاصلهٔ ویرایشی.
func migSimilarity(legacyCode, legacyTitle string, opt MigOption) int {
	lc, oc := migCanon(legacyCode), migCanon(opt.Code)
	if lc != "" && oc != "" && lc == oc {
		return 100
	}
	lt, ot := migCanon(legacyTitle), migCanon(opt.Title)
	if lt == "" || ot == "" {
		if lc != "" && oc != "" && (strings.HasSuffix(lc, oc) || strings.HasSuffix(oc, lc)) {
			return 60
		}
		return 0
	}
	if lt == ot {
		return 98
	}
	set := func(ts []string) map[string]bool {
		m := map[string]bool{}
		for _, t := range ts {
			m[t] = true
		}
		return m
	}
	a, b := set(migTokens(legacyTitle)), set(migTokens(opt.Title))
	inter := 0
	for t := range a {
		if b[t] {
			inter++
		}
	}
	jaccard := 0.0
	if na, nb := len(a), len(b); na+nb-inter > 0 {
		jaccard = float64(inter) / float64(na+nb-inter)
	}
	dist := migLevenshtein(lt, ot)
	ml := len([]rune(lt))
	if len([]rune(ot)) > ml {
		ml = len([]rune(ot))
	}
	lev := 0.0
	if ml > 0 {
		lev = 1 - float64(dist)/float64(ml)
	}
	score := int(math.Round((jaccard*0.6 + math.Max(lev, 0)*0.4) * 100))
	if score < 0 {
		score = 0
	}
	if score > 97 {
		score = 97
	}
	return score
}

// MigAutoSuggest پیشنهاد خودکار برای همهٔ کدهای بی‌نگاشت یک دامنه (پورت autoSuggestDomain).
func (s *Service) MigAutoSuggest(ctx context.Context, sourceCode, domain string) (suggested, confirmed, untouched int, err error) {
	options, err := s.MigrationTargetOptions(ctx, domain)
	if err != nil {
		return 0, 0, 0, err
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "legacyCode", coalesce("legacyTitle",'') from legacy_code_maps
		 where "sourceCode" = $1 and domain = $2 and status in ('UNMAPPED','SUGGESTED')`,
		migCleanSource(sourceCode), domain)
	if err != nil {
		return 0, 0, 0, err
	}
	type cand struct {
		id    int64
		code  string
		title string
		opt   MigOption
		score int
	}
	var cands []cand
	for rows.Next() {
		var c cand
		if err := rows.Scan(&c.id, &c.code, &c.title); err == nil {
			best := -1
			for _, opt := range options {
				if sc := migSimilarity(c.code, c.title, opt); sc > best {
					best = sc
					c.opt = opt
					c.score = sc
				}
			}
			if c.score >= 45 {
				cands = append(cands, c)
			} else {
				untouched++
			}
		}
	}
	rows.Close()
	for _, c := range cands {
		auto := c.score >= 90
		status := "SUGGESTED"
		if auto {
			status = "CONFIRMED"
		}
		_, err := s.DB.Pool.Exec(ctx, `
			update legacy_code_maps set "targetId" = $2, "targetCode" = $3, "targetTitle" = $4,
			       confidence = $5, status = $6, "updatedAt" = now() where id = $1`,
			c.id, c.opt.ID, c.opt.Code, c.opt.Title, strconv.Itoa(c.score), status)
		if err == nil && auto {
			confirmed++
		} else if err == nil {
			suggested++
		}
	}
	return suggested, confirmed, untouched, nil
}

// MigConfirmSuggestions تأیید یکجای همهٔ پیشنهادها با امتیاز حداقل (پورت confirmSuggestionsAction).
func (s *Service) MigConfirmSuggestions(ctx context.Context, user *session.User, sourceCode, domain string, minScore int) (int, error) {
	tag, err := s.DB.Pool.Exec(ctx, `
		update legacy_code_maps set status = 'CONFIRMED', "updatedByUserId" = $3, "updatedAt" = now()
		 where "sourceCode" = $1 and domain = $2 and status = 'SUGGESTED'
		   and coalesce(confidence, 0) >= $4`,
		migCleanSource(sourceCode), domain, user.ID, minScore)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// MigAddCode افزودن دستی یک کد قدیمی (پورت addCodeAction).
func (s *Service) MigAddCode(ctx context.Context, sourceCode, domain, legacyCode, legacyTitle string) error {
	if strings.TrimSpace(legacyCode) == "" {
		return errors.New("کد قدیمی الزامی است.")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		insert into legacy_code_maps ("sourceCode", domain, "legacyCode", "legacyTitle", status)
		values ($1,$2,$3,$4,'UNMAPPED') on conflict do nothing`,
		migCleanSource(sourceCode), domain, strings.TrimSpace(legacyCode), nilIfEmpty(strings.TrimSpace(legacyTitle)))
	return err
}

// MigUpsertLegacyCode ثبت/به‌روزرسانی کد قدیمی دیده‌شده در فایل‌ها (پورت upsertLegacyCode).
func (s *Service) MigUpsertLegacyCode(ctx context.Context, sourceCode, domain, legacyCode, legacyTitle string) {
	if strings.TrimSpace(legacyCode) == "" {
		return
	}
	_, _ = s.DB.Pool.Exec(ctx, `
		insert into legacy_code_maps ("sourceCode", domain, "legacyCode", "legacyTitle", status)
		values ($1,$2,$3,$4,'UNMAPPED') on conflict do nothing`,
		sourceCode, domain, legacyCode, nilIfEmpty(legacyTitle))
	if strings.TrimSpace(legacyTitle) != "" {
		_, _ = s.DB.Pool.Exec(ctx, `
			update legacy_code_maps set "legacyTitle" = $4
			 where "sourceCode" = $1 and domain = $2 and "legacyCode" = $3 and coalesce("legacyTitle",'') = ''`,
			sourceCode, domain, legacyCode, legacyTitle)
	}
}

// MigResolverFor نگاشت آمادهٔ مصرف موتورها (پورت resolverFor) — legacyCode → (targetId,targetCode).
func (s *Service) MigResolverFor(ctx context.Context, sourceCode, domain string) (map[string]MigOption, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select coalesce("targetId", 0), coalesce("targetCode",''), coalesce("targetTitle",''), "legacyCode"
		  from legacy_code_maps where "sourceCode" = $1 and domain = $2 and status = 'CONFIRMED'`,
		migCleanSource(sourceCode), domain)
	if err != nil {
		return map[string]MigOption{}, err
	}
	defer rows.Close()
	out := map[string]MigOption{}
	for rows.Next() {
		var id int64
		var code, title, legacy string
		if err := rows.Scan(&id, &code, &title, &legacy); err == nil {
			var idp *int64
			if id > 0 {
				v := id
				idp = &v
			}
			out[MigNorm(legacy)] = MigOption{ID: idp, Code: code, Title: title}
		}
	}
	return out, rows.Err()
}

// ═══════════════ واردسازی CSV (پورت importGrades/importFormulas/importFinancials/importCodes) ═══════════════

// MigrationImportLimit سقف حجم فایل CSV (۵ مگابایت).
const MigrationImportLimit = 5 << 20

// MigrationImport CSV مبدأ را وارد staging می‌کند و «دسته» می‌سازد.
func (s *Service) MigrationImport(ctx context.Context, user *session.User, kind, sourceCode, fileName, content string, columnMap map[string]int) (*MigReport, error) {
	kind = strings.TrimSpace(kind)
	table := &MigTable{
		Sheet:     "CSV",
		ColumnMap: columnMap,
	}
	parsed := MigParseCsv(content)
	if len(parsed) > 0 {
		for _, h := range parsed[0] {
			table.Headers = append(table.Headers, MigNorm(h))
		}
		table.Rows = parsed[1:]
	}
	src := migCleanSource(sourceCode)
	rep := migEmptyReport(kind, fileName, table.Sheet)

	// ساخت دسته
	batchID := int64(0)
	importType := kind
	err := s.DB.Pool.QueryRow(ctx, `
		insert into legacy_import_batches ("sourceCode", "importType", "fileName", "sheetName", headers, "columnMap", "totalRows", status, "createdByUserId", "universityId")
		values ($1,$2,$3,$4,$5,$6,0,'PARSED',$7, null) returning id`,
		src, importType, nilIfEmpty(strings.TrimSpace(fileName)), table.Sheet,
		nilIfEmpty(strings.Join(table.Headers, "|")), nilIfEmpty(mustJSON(columnMap)), user.ID).Scan(&batchID)
	if err != nil {
		return nil, err
	}
	rep.Kind = kind

	switch kind {
	case "grades":
		err = s.migImportGrades(ctx, src, table, batchID, rep)
	case "tuition-formula":
		err = s.migImportFormulas(ctx, src, table, batchID, rep)
	case "legacy-financial":
		err = s.migImportFinancials(ctx, src, table, batchID, rep)
	case "codes":
		err = s.migImportCodes(ctx, src, table, batchID, rep)
	default:
		return nil, errors.New("نوع واردسازی نامعتبر است — انواع مجاز: grades، tuition-formula، legacy-financial، codes.")
	}
	if err != nil {
		return nil, err
	}
	_, _ = s.DB.Pool.Exec(ctx, `
		update legacy_import_batches set "totalRows" = $2,
		       "okRows" = $3, "errorRows" = $4,
		       status = case when $4 > 0 then 'PARTIAL' else 'PROCESSED' end,
		       "processedAt" = now()
		 where id = $1`, batchID, rep.Total, rep.Inserted+rep.Updated, rep.Invalid)
	return rep, nil
}

func mustJSON(v any) string {
	if v == nil {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

// migStoreRow سطر خام نرمال‌شده را در ناحیهٔ موقت نگه می‌دارد (برای پردازش دوباره).
func (s *Service) migStoreRow(ctx context.Context, batchID int64, line int, raw map[string]string, status, errMsg string) {
	_, _ = s.DB.Pool.Exec(ctx, `
		insert into legacy_import_rows ("batchId", "rowNumber", "rawData", "validationStatus", "errorMessage", "universityId")
		values ($1,$2,$3,$4,$5,null)`, batchID, line, mustJSON(raw), status, nilIfEmpty(errMsg))
}

// migReprocessableRows سطرهای یک دسته با وضعیت مشخص.
func (s *Service) migReprocessableRows(ctx context.Context, batchID int64, onlyErrors bool) (headers []string, rows []map[string]string, ids []int64, statuses []string, err error) {
	q := `select id, "rawData", "validationStatus" from legacy_import_rows where "batchId" = $1`
	if onlyErrors {
		q += ` and "validationStatus" = 'ERROR'`
	}
	q += ` order by "rowNumber"`
	rws, err := s.DB.Pool.Query(ctx, q, batchID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	defer rws.Close()
	for rws.Next() {
		var id int64
		var rawStr, st string
		if err := rws.Scan(&id, &rawStr, &st); err != nil {
			continue
		}
		var raw map[string]string
		_ = json.Unmarshal([]byte(rawStr), &raw)
		if headers == nil && raw != nil {
			for k := range raw {
				headers = append(headers, k)
			}
			sort.Strings(headers)
		}
		rows = append(rows, raw)
		ids = append(ids, id)
		statuses = append(statuses, st)
	}
	return headers, rows, ids, statuses, rws.Err()
}

// ReprocessMigrationBatch پردازش دوبارهٔ سطرهای یک دسته (پورت reprocessBatch).
// در این پورت سطر خام «نرمال‌شده» ذخیره می‌شود؛ پردازش دوباره همان upsert را
// از سطر ذخیره‌شده انجام می‌دهد (پس از تکمیل نگاشت کدها نتیجه تازه می‌شود).
func (s *Service) ReprocessMigrationBatch(ctx context.Context, batchID int64, all bool) (reprocessed, inserted, updated, invalid int, err error) {
	var importType, sourceCode string
	if err = s.DB.Pool.QueryRow(ctx,
		`select "importType", "sourceCode" from legacy_import_batches where id = $1`, batchID).
		Scan(&importType, &sourceCode); err != nil {
		return 0, 0, 0, 0, errors.New("دسته یافت نشد.")
	}
	_, rawRows, ids, _, err := s.migReprocessableRows(ctx, batchID, !all)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	if len(rawRows) == 0 {
		return 0, 0, 0, 0, errors.New("سطری برای پردازش دوباره نیست.")
	}

	table := &MigTable{Sheet: "CSV"}
	// سطرها از JSON خام بازسازی می‌شوند؛ سرستون‌ها کلیدهای JSON.
	headersSet := map[string]bool{}
	for _, r := range rawRows {
		for k := range r {
			headersSet[k] = true
		}
	}
	headers := make([]string, 0, len(headersSet))
	for k := range headersSet {
		headers = append(headers, k)
	}
	sort.Strings(headers)
	table.Headers = headers
	table.Rows = make([][]string, len(rawRows))
	for i, r := range rawRows {
		row := make([]string, len(headers))
		for j, h := range headers {
			row[j] = r[h]
		}
		table.Rows[i] = row
	}
	// ستون‌ها را بر اساس نامک‌های استاندارد نگاشت می‌کنیم.
	rep := migEmptyReport(importType, "", "CSV")
	rep.Total = len(table.Rows)
	switch importType {
	case "grades":
		err = s.migImportGrades(ctx, sourceCode, table, batchID, rep)
	case "tuition-formula":
		err = s.migImportFormulas(ctx, sourceCode, table, batchID, rep)
	case "legacy-financial":
		err = s.migImportFinancials(ctx, sourceCode, table, batchID, rep)
	case "codes":
		err = s.migImportCodes(ctx, sourceCode, table, batchID, rep)
	default:
		return 0, 0, 0, 0, errors.New("پردازش دوباره برای این نوع دسته پشتیبانی نمی‌شود.")
	}
	if err != nil {
		return 0, 0, 0, 0, err
	}
	// سطرهای موفق علامت خورده و بقیه ERROR می‌مانند.

	for _, id := range ids {
		_, _ = s.DB.Pool.Exec(ctx, `update legacy_import_rows set "processedAt" = now() where id = $1`, id)
	}
	reprocessed = len(ids)
	inserted, updated, invalid = rep.Inserted, rep.Updated, rep.Invalid
	_, _ = s.DB.Pool.Exec(ctx, `
		update legacy_import_batches set "okRows" = "okRows" + $2, "errorRows" = $3,
		       status = case when $3 > 0 then 'PARTIAL' else 'PROCESSED' end, "processedAt" = now()
		 where id = $1`, batchID, inserted+updated, invalid)
	return reprocessed, inserted, updated, invalid, nil
}

// ── نمرات ──

// MigQualitative نمرهٔ حرفی/کیفی رایج سیستم‌های قدیمی (پورت QUALITATIVE).
var MigQualitative = map[string]struct {
	Value  *float64
	Status string
}{
	"قبول": {nil, "PASSED_NO_GRADE"}, "پذیرفته": {nil, "PASSED_NO_GRADE"}, "pass": {nil, "PASSED_NO_GRADE"},
	"مردود": {nil, "FAILED_NO_GRADE"}, "رد": {nil, "FAILED_NO_GRADE"}, "fail": {nil, "FAILED_NO_GRADE"},
	"معاف": {nil, "EXEMPT"}, "معادلسازی": {nil, "EXEMPT"}, "معادل سازی": {nil, "EXEMPT"}, "تطبیق": {nil, "EXEMPT"},
	"حذف": {nil, "DROPPED"}, "حذف پزشکی": {nil, "DROPPED"}, "حذف آموزشی": {nil, "DROPPED"},
	"ناتمام": {nil, "PENDING"},
	"الف":    {f64(18), "FINALIZED"}, "ب": {f64(15), "FINALIZED"}, "ج": {f64(12), "FINALIZED"}, "د": {f64(10), "FINALIZED"},
	"a": {f64(18), "FINALIZED"}, "b": {f64(15), "FINALIZED"}, "c": {f64(12), "FINALIZED"}, "d": {f64(10), "FINALIZED"},
}

func f64(v float64) *float64 { return &v }

// migComputeGradeStatus وضعیت خودکار از نمرهٔ عددی (معادل computeGradeStatus).
func migComputeGradeStatus(n float64) string {
	switch {
	case n >= 10:
		return "FINALIZED"
	case n >= 0:
		return "FAILED_NO_GRADE"
	default:
		return "PENDING"
	}
}

// MigParseGrade تفسیر مقدار خام نمره (پورت parseGrade).
func MigParseGrade(raw, statusRaw string, statusMap map[string]MigOption) (value *float64, status, note string) {
	r := MigNorm(raw)
	st := MigNorm(statusRaw)
	var mapped *MigOption
	if st != "" {
		if o, ok := statusMap[st]; ok {
			mapped = &o
		}
	}
	if n, ok := MigNum(r); ok && r != "" {
		if n < 0 || n > 20 {
			return nil, "PENDING", fmt.Sprintf("نمرهٔ خارج از بازهٔ ۰..۲۰: %s", r)
		}
		s := migComputeGradeStatus(n)
		if mapped != nil {
			s = mapped.Code
		}
		return &n, s, ""
	}
	if q, ok := MigQualitative[strings.ToLower(r)]; ok {
		s := q.Status
		if mapped != nil {
			s = mapped.Code
		}
		return q.Value, s, ""
	}
	if mapped != nil {
		return nil, mapped.Code, ""
	}
	if r == "" {
		return nil, "PENDING", ""
	}
	return nil, "PENDING", fmt.Sprintf("مقدار نمره «%s» شناخته نشد — در تطبیق کدها (وضعیت نمره) تعریفش کنید.", raw)
}

func (s *Service) migImportGrades(ctx context.Context, src string, table *MigTable, batchID int64, rep *MigReport) error {
	if migPickCol(table.Headers, []string{"شماره دانشجویی", "شماره دانشجو", "student_code"}) < 0 ||
		migPickCol(table.Headers, []string{"کد درس", "course_code"}) < 0 ||
		migPickCol(table.Headers, []string{"نمره", "grade"}) < 0 {
		return errors.New("فایل خالی است یا ستون‌های الزامی (شماره دانشجویی، کد درس، نمره) یافت نشد.")
	}
	if migPickCol(table.Headers, []string{"کد ترم", "ترم", "term_code"}) < 0 {
		return errors.New("ستون‌های الزامی یافت نشد: کد ترم")
	}
	statusMap, err := s.MigResolverFor(ctx, src, "GRADE_STATUS")
	if err != nil {
		return err
	}
	seenCourses := map[string]string{}
	seenTerms := map[string]string{}
	for i := range table.Rows {
		line := i + 2
		studentCode := table.Get(i, []string{"شماره دانشجویی", "شماره دانشجو", "student_code"})
		courseCode := table.Get(i, []string{"کد درس", "course_code"})
		termCode := table.Get(i, []string{"کد ترم", "ترم", "term_code"})
		if studentCode == "" || courseCode == "" || termCode == "" {
			rep.Invalid++
			rep.Errors = append(rep.Errors, MigRowMsg{Row: line, Msg: "شماره دانشجویی، کد درس و کد ترم الزامی است."})
			s.migStoreRow(ctx, batchID, line, table.RawAll(i), "ERROR", "شماره دانشجویی، کد درس و کد ترم الزامی است.")
			continue
		}
		gradeRaw := table.Get(i, []string{"نمره", "نمره نهایی", "grade", "final_grade"})
		value, status, note := MigParseGrade(gradeRaw, table.Get(i, []string{"وضعیت نمره", "وضعیت", "grade_status"}), statusMap)
		if note != "" {
			rep.Warnings = append(rep.Warnings, MigRowMsg{Row: line, Msg: note})
		}
		courseTitle := table.Get(i, []string{"نام درس", "عنوان درس", "course_title"})
		if courseTitle != "" {
			seenCourses[courseCode] = courseTitle
		} else if _, ok := seenCourses[courseCode]; !ok {
			seenCourses[courseCode] = ""
		}
		seenTerms[termCode] = table.Get(i, []string{"عنوان ترم", "term_title"})

		units := ""
		if u, ok := MigNum(table.Get(i, []string{"واحد", "تعداد واحد", "units"})); ok {
			units = strconv.FormatFloat(u, 'f', -1, 64)
		}
		gradeValue := ""
		if value != nil {
			gradeValue = strconv.FormatFloat(*value, 'f', -1, 64)
		}
		values := map[string]any{
			"sourceCode": src, "studentCode": studentCode, "termCode": termCode, "courseCode": courseCode,
			"batchId": batchID, "studentName": nilIfEmpty(table.Get(i, []string{"نام دانشجو", "نام و نام خانوادگی", "student_name"})),
			"courseTitle": nilIfEmpty(courseTitle), "units": nilIfEmpty(units), "gradeRaw": nilIfEmpty(gradeRaw),
			"gradeValue": nilIfEmpty(gradeValue), "gradeStatus": status,
			"professorName": nilIfEmpty(table.Get(i, []string{"استاد", "نام استاد", "professor"})),
			"compareStatus": "PENDING", "raw": mustJSON(table.RawAll(i)),
		}
		created, uerr := s.migUpsert(ctx, `
			insert into legacy_grades ("sourceCode","studentCode","termCode","courseCode","batchId","studentName","courseTitle","units","gradeRaw","gradeValue","gradeStatus","professorName","compareStatus","raw")
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDING',$13)
			on conflict ("sourceCode","studentCode","termCode","courseCode") do update set
			  "batchId" = $5, "studentName" = $6, "courseTitle" = $7, "units" = $8, "gradeRaw" = $9,
			  "gradeValue" = $10, "gradeStatus" = $11, "professorName" = $12, "compareStatus" = 'PENDING', "compareNote" = null, raw = $13,
			  "importedAt" = now()`,
			values["sourceCode"], values["studentCode"], values["termCode"], values["courseCode"], values["batchId"],
			values["studentName"], values["courseTitle"], values["units"], values["gradeRaw"], values["gradeValue"],
			values["gradeStatus"], values["professorName"], values["raw"])
		if uerr != nil {
			rep.Invalid++
			rep.Errors = append(rep.Errors, MigRowMsg{Row: line, Msg: uerr.Error()})
			s.migStoreRow(ctx, batchID, line, table.RawAll(i), "ERROR", uerr.Error())
			continue
		}
		if created {
			rep.Inserted++
		} else {
			rep.Updated++
		}
		s.migStoreRow(ctx, batchID, line, table.RawAll(i), "OK", "")
		if rep.Sample == nil {
			rep.Sample = map[string]any{"key": studentCode + "|" + courseCode + "|" + termCode}
		}
	}
	for code, title := range seenCourses {
		s.MigUpsertLegacyCode(ctx, src, "COURSE", code, title)
	}
	for code, title := range seenTerms {
		s.MigUpsertLegacyCode(ctx, src, "TERM", code, title)
	}
	return nil
}

// migUpsert اجرای insert…returning (xmax=0) — پورت الگوی created/updated.
func (s *Service) migUpsert(ctx context.Context, q string, args ...any) (bool, error) {
	var created bool
	err := s.DB.Pool.QueryRow(ctx, q+" returning (xmax = 0)", args...).Scan(&created)
	if err != nil {
		return false, err
	}
	return created, nil
}

// ── فرمول‌های شهریه ──

func (s *Service) migImportFormulas(ctx context.Context, src string, table *MigTable, batchID int64, rep *MigReport) error {
	for i := range table.Rows {
		line := i + 2
		code := table.Get(i, []string{"کد فرمول", "formula_code", "کد"})
		if code == "" {
			rep.Invalid++
			rep.Errors = append(rep.Errors, MigRowMsg{Row: line, Msg: "کد فرمول الزامی است."})
			s.migStoreRow(ctx, batchID, line, table.RawAll(i), "ERROR", "کد فرمول الزامی است.")
			continue
		}
		numOr := func(aliases []string) string {
			if v, ok := MigNum(table.Get(i, aliases)); ok {
				return strconv.FormatFloat(math.Round(v), 'f', 0, 64)
			}
			return "0"
		}
		created, err := s.migUpsert(ctx, `
			insert into legacy_tuition_formulas ("sourceCode","formulaCode","title","termCode","degreeCode","majorCode","fixedAmount","perUnitTheory","perUnitPractical","perUnitGeneral","expression","isActive","note","universityId")
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,null)
			on conflict ("sourceCode","formulaCode","termCode") do update set
			  title = $3, "termCode" = $4, "degreeCode" = $5, "majorCode" = $6, "fixedAmount" = $7,
			  "perUnitTheory" = $8, "perUnitPractical" = $9, "perUnitGeneral" = $10, "expression" = $11, note = $12`,
			src, code, nilIfEmpty(table.Get(i, []string{"عنوان", "title"})),
			nilIfEmpty(table.Get(i, []string{"کد ترم", "ترم", "term_code"})),
			nilIfEmpty(table.Get(i, []string{"کد مقطع", "مقطع", "degree_code"})),
			nilIfEmpty(table.Get(i, []string{"کد رشته", "رشته", "major_code"})),
			numOr([]string{"شهریه ثابت", "مبلغ ثابت", "fixed"}),
			numOr([]string{"هر واحد نظری", "نظری", "per_unit_theory"}),
			numOr([]string{"هر واحد عملی", "عملی", "per_unit_practical"}),
			numOr([]string{"هر واحد عمومی", "عمومی", "per_unit_general"}),
			nilIfEmpty(table.Get(i, []string{"عبارت", "expression"})),
			nilIfEmpty(table.Get(i, []string{"توضیح", "note"})))
		if err != nil {
			rep.Invalid++
			rep.Errors = append(rep.Errors, MigRowMsg{Row: line, Msg: err.Error()})
			s.migStoreRow(ctx, batchID, line, table.RawAll(i), "ERROR", err.Error())
			continue
		}
		if created {
			rep.Inserted++
		} else {
			rep.Updated++
		}
		s.migStoreRow(ctx, batchID, line, table.RawAll(i), "OK", "")
		if rep.Sample == nil {
			rep.Sample = map[string]any{"key": code}
		}
	}
	return nil
}

// ── دادهٔ مالی قدیمی ──

func (s *Service) migImportFinancials(ctx context.Context, src string, table *MigTable, batchID int64, rep *MigReport) error {
	for i := range table.Rows {
		line := i + 2
		studentCode := table.Get(i, []string{"شماره دانشجویی", "شماره دانشجو", "student_code"})
		termCode := table.Get(i, []string{"کد ترم", "ترم", "term_code"})
		if studentCode == "" || termCode == "" {
			rep.Invalid++
			rep.Errors = append(rep.Errors, MigRowMsg{Row: line, Msg: "شماره دانشجویی و کد ترم الزامی است."})
			s.migStoreRow(ctx, batchID, line, table.RawAll(i), "ERROR", "شماره دانشجویی و کد ترم الزامی است.")
			continue
		}
		_, ok := MigNum(table.Get(i, []string{"شهریه", "مبلغ شهریه", "شهریه کل", "tuition", "total"}))
		if !ok {
			rep.Invalid++
			rep.Errors = append(rep.Errors, MigRowMsg{Row: line, Msg: "مبلغ شهریهٔ قدیمی خوانده نشد."})
			s.migStoreRow(ctx, batchID, line, table.RawAll(i), "ERROR", "مبلغ شهریهٔ قدیمی خوانده نشد.")
			continue
		}
		numStr := func(aliases []string) string {
			if v, ok := MigNum(table.Get(i, aliases)); ok {
				return strconv.FormatFloat(math.Round(v), 'f', 0, 64)
			}
			return "0"
		}
		unitStr := func(aliases []string) string {
			if v, ok := MigNum(table.Get(i, aliases)); ok {
				return strconv.FormatFloat(v, 'f', -1, 64)
			}
			return "0"
		}
		created, err := s.migUpsert(ctx, `
			insert into legacy_financial_records ("sourceCode","studentCode","termCode","studentName","formulaCode","degreeCode","majorCode","entryYear","totalUnits","theoryUnits","practicalUnits","generalUnits","legacyTuition","legacyDiscount","legacyPaid","batchId","raw","universityId")
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,null)
			on conflict ("sourceCode","studentCode","termCode") do update set
			  "studentName" = $4, "formulaCode" = $5, "degreeCode" = $6, "majorCode" = $7, "entryYear" = $8,
			  "totalUnits" = $9, "theoryUnits" = $10, "practicalUnits" = $11, "generalUnits" = $12,
			  "legacyTuition" = $13, "legacyDiscount" = $14, "legacyPaid" = $15, "batchId" = $16, raw = $17, "importedAt" = now()`,
			src, studentCode, termCode,
			nilIfEmpty(table.Get(i, []string{"نام دانشجو", "نام و نام خانوادگی", "student_name"})),
			nilIfEmpty(table.Get(i, []string{"کد فرمول", "formula_code"})),
			nilIfEmpty(table.Get(i, []string{"کد مقطع", "مقطع", "degree_code"})),
			nilIfEmpty(table.Get(i, []string{"کد رشته", "رشته", "major_code"})),
			nilIfEmpty(numStr([]string{"سال ورود", "ورودی", "entry_year"})),
			unitStr([]string{"تعداد واحد", "واحد", "units", "total_units"}),
			unitStr([]string{"واحد نظری", "theory_units"}),
			unitStr([]string{"واحد عملی", "practical_units"}),
			unitStr([]string{"واحد عمومی", "general_units"}),
			numStr([]string{"شهریه", "مبلغ شهریه", "شهریه کل", "tuition", "total"}),
			numStr([]string{"تخفیف", "discount"}),
			numStr([]string{"پرداختی", "پرداخت شده", "paid"}),
			batchID, mustJSON(table.RawAll(i)))
		if err != nil {
			rep.Invalid++
			rep.Errors = append(rep.Errors, MigRowMsg{Row: line, Msg: err.Error()})
			s.migStoreRow(ctx, batchID, line, table.RawAll(i), "ERROR", err.Error())
			continue
		}
		if created {
			rep.Inserted++
		} else {
			rep.Updated++
		}
		s.migStoreRow(ctx, batchID, line, table.RawAll(i), "OK", "")
		if rep.Sample == nil {
			rep.Sample = map[string]any{"key": studentCode + "|" + termCode}
		}
	}
	return nil
}

// ── جدول تطبیق از فایل ──

var migValidDomains = func() map[string]bool {
	m := map[string]bool{}
	for _, d := range MigDomains {
		m[d.ID] = true
	}
	return m
}()

func (s *Service) migImportCodes(ctx context.Context, src string, table *MigTable, batchID int64, rep *MigReport) error {
	for i := range table.Rows {
		line := i + 2
		domain := strings.ToUpper(table.Get(i, []string{"دامنه", "domain"}))
		legacyCode := table.Get(i, []string{"کد قدیمی", "legacy_code", "کد"})
		if legacyCode == "" {
			rep.Invalid++
			rep.Errors = append(rep.Errors, MigRowMsg{Row: line, Msg: "کد قدیمی الزامی است."})
			s.migStoreRow(ctx, batchID, line, table.RawAll(i), "ERROR", "کد قدیمی الزامی است.")
			continue
		}
		if !migValidDomains[domain] {
			rep.Invalid++
			rep.Errors = append(rep.Errors, MigRowMsg{Row: line, Msg: "دامنه نامعتبر است."})
			s.migStoreRow(ctx, batchID, line, table.RawAll(i), "ERROR", "دامنه نامعتبر است.")
			continue
		}
		s.MigUpsertLegacyCode(ctx, src, domain, legacyCode, table.Get(i, []string{"عنوان قدیمی", "legacy_title", "عنوان"}))
		rep.Inserted++
		s.migStoreRow(ctx, batchID, line, table.RawAll(i), "OK", "")
	}
	return nil
}

// ═══════════════ نمرات: مقایسه و اعمال ═══════════════

type MigGradeCompareRow struct {
	StudentCode string  `json:"studentCode"`
	TermCode    string  `json:"termCode"`
	CourseCode  string  `json:"courseCode"`
	CourseTitle *string `json:"courseTitle"`
	Legacy      string  `json:"legacy"`
	Current     string  `json:"current"`
	Status      string  `json:"status"`
	Note        string  `json:"note"`
}

type MigGradeCompare struct {
	Total        int                  `json:"total"`
	Same         int                  `json:"same"`
	Diff         int                  `json:"diff"`
	MissingInNew int                  `json:"missingInNew"`
	NoStudent    int                  `json:"noStudent"`
	NoTerm       int                  `json:"noTerm"`
	NoCourse     int                  `json:"noCourse"`
	Rows         []MigGradeCompareRow `json:"rows"`
}

var migGradeStatusFA = map[string]string{
	"FINALIZED": "قطعی", "TEMPORARY": "موقت", "PENDING": "ثبت‌نشده", "PASSED_NO_GRADE": "قبول",
	"FAILED_NO_GRADE": "مردود", "EXEMPT": "معادل‌سازی", "DROPPED": "حذف‌شده",
}

func migFmtGrade(value *string, status string) string {
	if value != nil && *value != "" {
		if n, err := strconv.ParseFloat(*value, 64); err == nil {
			return fmt.Sprintf("%.2f", n)
		}
		return *value
	}
	if v, ok := migGradeStatusFA[status]; ok {
		return v
	}
	return status
}

type migLegacyGrade struct {
	ID          int64
	StudentCode string
	TermCode    string
	CourseCode  string
	CourseTitle *string
	GradeValue  *string
	GradeStatus string
	BatchID     *int64
}

// CompareMigrationGrades مقایسهٔ نمرات قدیمی با سامانه (پورت compareGrades).
func (s *Service) CompareMigrationGrades(ctx context.Context, sourceCode, termCode string) (*MigGradeCompare, error) {
	src := migCleanSource(sourceCode)
	args := []any{src}
	where := `"sourceCode" = $1`
	if strings.TrimSpace(termCode) != "" {
		args = append(args, strings.TrimSpace(termCode))
		where += fmt.Sprintf(` and "termCode" = $%d`, len(args))
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "studentCode", "termCode", "courseCode", "courseTitle", "gradeValue"::text, "gradeStatus", "batchId"
		  from legacy_grades where `+where+` order by "studentCode", "courseCode"`, args...)
	if err != nil {
		return nil, err
	}
	var legacy []migLegacyGrade
	for rows.Next() {
		var g migLegacyGrade
		if err := rows.Scan(&g.ID, &g.StudentCode, &g.TermCode, &g.CourseCode, &g.CourseTitle,
			&g.GradeValue, &g.GradeStatus, &g.BatchID); err == nil {
			legacy = append(legacy, g)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := &MigGradeCompare{Total: len(legacy), Rows: []MigGradeCompareRow{}}
	if len(legacy) == 0 {
		return out, nil
	}

	termMap, _ := s.MigResolverFor(ctx, src, "TERM")
	courseMap, _ := s.MigResolverFor(ctx, src, "COURSE")

	codes := map[string]bool{}
	for _, l := range legacy {
		codes[l.StudentCode] = true
	}
	stu := map[string]int64{}
	for code := range codes {
		var sid int64
		if err := s.DB.Pool.QueryRow(ctx, `select id from students where "studentCode" = $1 limit 1`, code).Scan(&sid); err == nil {
			stu[code] = sid
		}
	}
	terms := map[string]int64{}
	crs := map[string]int64{}
	trows, _ := s.DB.Pool.Query(ctx, `select id, "termCode" from academic_terms`)
	for trows.Next() {
		var id int64
		var code string
		if trows.Scan(&id, &code) == nil {
			terms[MigNorm(code)] = id
		}
	}
	trows.Close()
	crows, _ := s.DB.Pool.Query(ctx, `select id, code from courses`)
	for crows.Next() {
		var id int64
		var code string
		if crows.Scan(&id, &code) == nil {
			crs[MigNorm(code)] = id
		}
	}
	crows.Close()

	// نمرات فعلی سامانه برای همان دانشجویان
	type curKey struct{ sid, tid, cid int64 }
	curMap := map[curKey]migLegacyGrade{}
	if len(stu) > 0 {
		ids := make([]any, 0, len(stu))
		ph := []string{}
		i := 1
		for _, sid := range stu {
			ids = append(ids, sid)
			i++
			ph = append(ph, fmt.Sprintf("$%d", i-1))
		}
		q := fmt.Sprintf(`
			select e."studentId", o."termId", o."courseId", e."gradeValue"::text, coalesce(e."gradeStatus",'')
			  from enrollments e join course_offerings o on o.id = e."offeringId"
			 where e."studentId" in (%s)`, strings.Join(ph, ","))
		erows, err := s.DB.Pool.Query(ctx, q, ids...)
		if err == nil {
			for erows.Next() {
				var k curKey
				var gv *string
				var gs string
				if erows.Scan(&k.sid, &k.tid, &k.cid, &gv, &gs) == nil {
					curMap[k] = migLegacyGrade{GradeValue: gv, GradeStatus: gs}
				}
			}
			erows.Close()
		}
	}

	for _, l := range legacy {
		sid, hasSid := stu[l.StudentCode]
		tid := int64(0)
		if o, ok := termMap[MigNorm(l.TermCode)]; ok && o.ID != nil {
			tid = *o.ID
		} else {
			tid = terms[MigNorm(l.TermCode)]
		}
		cid := int64(0)
		if o, ok := courseMap[MigNorm(l.CourseCode)]; ok && o.ID != nil {
			cid = *o.ID
		} else {
			cid = crs[MigNorm(l.CourseCode)]
		}
		legacyText := migFmtGrade(l.GradeValue, l.GradeStatus)

		var status, note, current string
		switch {
		case !hasSid:
			status, note, out.NoStudent = "NO_STUDENT", "دانشجو در سامانهٔ جدید نیست — اول فایل دانشجویان را مهاجرت کنید.", out.NoStudent+1
		case tid == 0:
			status, note, out.NoTerm = "NO_TERM", fmt.Sprintf("ترم «%s» تطبیق نخورده.", l.TermCode), out.NoTerm+1
		case cid == 0:
			status, note, out.NoCourse = "NO_COURSE", fmt.Sprintf("درس «%s» تطبیق نخورده.", l.CourseCode), out.NoCourse+1
		default:
			cur, ok := curMap[curKey{sid, tid, cid}]
			if !ok {
				status, out.MissingInNew = "MISSING_IN_NEW", out.MissingInNew+1
				note = "در سامانهٔ جدید ثبت‌نامی برای این درس/ترم نیست — با «اعمال» ساخته می‌شود."
			} else {
				current = migFmtGrade(cur.GradeValue, cur.GradeStatus)
				same := false
				if l.GradeValue == nil && cur.GradeValue == nil && l.GradeStatus == cur.GradeStatus {
					same = true
				}
				if l.GradeValue != nil && cur.GradeValue != nil {
					a, e1 := strconv.ParseFloat(*l.GradeValue, 64)
					b, e2 := strconv.ParseFloat(*cur.GradeValue, 64)
					if e1 == nil && e2 == nil && math.Abs(a-b) < 0.005 {
						same = true
					}
				}
				if same {
					status, out.Same = "SAME", out.Same+1
				} else {
					status, out.Diff = "DIFF", out.Diff+1
					note = fmt.Sprintf("قدیمی %s ↔ جدید %s", legacyText, current)
				}
			}
		}
		_, _ = s.DB.Pool.Exec(ctx, `update legacy_grades set "compareStatus" = $2, "compareNote" = $3 where id = $1`,
			l.ID, status, nilIfEmpty(note))
		if len(out.Rows) < 500 {
			out.Rows = append(out.Rows, MigGradeCompareRow{
				StudentCode: l.StudentCode, TermCode: l.TermCode, CourseCode: l.CourseCode,
				CourseTitle: l.CourseTitle, Legacy: legacyText, Current: current, Status: status, Note: note,
			})
		}
	}
	return out, nil
}

// MigApplyResult نتیجهٔ اعمال نمرات (پورت ApplyResult).
type MigApplyResult struct {
	Created int      `json:"created"`
	Updated int      `json:"updated"`
	Skipped int      `json:"skipped"`
	Errors  []string `json:"errors"`
}

// ApplyMigrationGrades اعمال نمرات قدیمی روی سامانه (پورت applyGrades) با دفتر واگرد.
func (s *Service) ApplyMigrationGrades(ctx context.Context, user *session.User, sourceCode, termCode string, statuses []string, overwrite bool) (*MigApplyResult, error) {
	src := migCleanSource(sourceCode)
	if len(statuses) == 0 {
		statuses = []string{"MISSING_IN_NEW"}
	}
	args := []any{src}
	where := `"sourceCode" = $1 and "compareStatus" = any($2)`
	args = append(args, statuses)
	if strings.TrimSpace(termCode) != "" {
		args = append(args, strings.TrimSpace(termCode))
		where += fmt.Sprintf(` and "termCode" = $%d`, len(args))
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "studentCode", "termCode", "courseCode", "courseTitle", "gradeValue"::text, "gradeStatus", "units", "batchId"
		  from legacy_grades where `+where, args...)
	if err != nil {
		return nil, err
	}
	type gRow struct {
		id                      int64
		studentCode, termCode   string
		courseCode, courseTitle string
		gradeValue, gradeStatus string
		units                   string
		batchID                 *int64
	}
	var list []gRow
	for rows.Next() {
		var g gRow
		if err := rows.Scan(&g.id, &g.studentCode, &g.termCode, &g.courseCode, &g.courseTitle,
			&g.gradeValue, &g.gradeStatus, &g.units, &g.batchID); err == nil {
			list = append(list, g)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	termMap, _ := s.MigResolverFor(ctx, src, "TERM")
	courseMap, _ := s.MigResolverFor(ctx, src, "COURSE")
	terms := map[string]int64{}
	trows, _ := s.DB.Pool.Query(ctx, `select id, "termCode" from academic_terms`)
	for trows.Next() {
		var id int64
		var code string
		if trows.Scan(&id, &code) == nil {
			terms[MigNorm(code)] = id
		}
	}
	trows.Close()
	crs := map[string]int64{}
	crows, _ := s.DB.Pool.Query(ctx, `select id, code from courses`)
	for crows.Next() {
		var id int64
		var code string
		if crows.Scan(&id, &code) == nil {
			crs[MigNorm(code)] = id
		}
	}
	crows.Close()
	stu := map[string]int64{}
	srows, _ := s.DB.Pool.Query(ctx, `select id, "studentCode" from students`)
	for srows.Next() {
		var id int64
		var code string
		if srows.Scan(&id, &code) == nil {
			stu[code] = id
		}
	}
	srows.Close()

	res := &MigApplyResult{Errors: []string{}}
	for _, g := range list {
		sid, hasSid := stu[g.studentCode]
		tid := int64(0)
		if o, ok := termMap[MigNorm(g.termCode)]; ok && o.ID != nil {
			tid = *o.ID
		} else {
			tid = terms[MigNorm(g.termCode)]
		}
		if !hasSid || tid == 0 {
			res.Skipped++
			continue
		}
		cid := int64(0)
		if o, ok := courseMap[MigNorm(g.courseCode)]; ok && o.ID != nil {
			cid = *o.ID
		} else {
			cid = crs[MigNorm(g.courseCode)]
		}
		if cid == 0 {
			// درس قدیمیِ بدون معادل: placeholder می‌سازیم تا کارنامه ناقص نماند
			title := g.courseTitle
			if title == "" {
				title = "درس مهاجرتی " + g.courseCode
			}
			units := "0"
			if _, ok := MigNum(g.units); ok && g.units != "" {
				units = g.units
			}
			var newID int64
			e := s.DB.Pool.QueryRow(ctx, `
				insert into courses (code, title, units) values ($1,$2,$3)
				on conflict do nothing returning id`, g.courseCode, title, units).Scan(&newID)
			if e != nil {
				_ = s.DB.Pool.QueryRow(ctx, `select id from courses where code = $1 limit 1`, g.courseCode).Scan(&newID)
			}
			if newID == 0 {
				_ = s.DB.Pool.QueryRow(ctx, `select id from courses where code = $1 limit 1`, g.courseCode).Scan(&newID)
			}
			if newID == 0 {
				res.Skipped++
				res.Errors = append(res.Errors, fmt.Sprintf("درس %s ساخته نشد.", g.courseCode))
				continue
			}
			s.migAudit(ctx, g.batchID, "apply-grades", src, user.ID, "INSERT", "courses", newID, nil, map[string]any{"code": g.courseCode})
			cid = newID
			crs[MigNorm(g.courseCode)] = cid
		}

		offID := int64(0)
		_ = s.DB.Pool.QueryRow(ctx, `
			select id from course_offerings where "termId" = $1 and "courseId" = $2 limit 1`, tid, cid).Scan(&offID)
		if offID == 0 {
			if err := s.DB.Pool.QueryRow(ctx, `
				insert into course_offerings ("termId","courseId","capacity","groupNumber","enrolledCount","isActive")
				values ($1,$2,999,1,0,0) returning id`, tid, cid).Scan(&offID); err == nil && offID > 0 {
				s.migAudit(ctx, g.batchID, "apply-grades", src, user.ID, "INSERT", "course_offerings", offID, nil,
					map[string]any{"termId": tid, "courseId": cid})
			}
		}
		if offID == 0 {
			res.Skipped++
			continue
		}

		var gradeValue any
		if g.gradeValue != "" {
			gradeValue = g.gradeValue
		}
		var exID int64
		var exGV, exGS *string
		var exHE *int
		_ = s.DB.Pool.QueryRow(ctx, `
			select id, "gradeValue"::text, "gradeStatus", "hasEvaluated" from enrollments
			 where "studentId" = $1 and "offeringId" = $2 limit 1`, sid, offID).Scan(&exID, &exGV, &exGS, &exHE)
		if exID > 0 {
			if !overwrite {
				res.Skipped++
				continue
			}
			status := exGS
			if g.gradeStatus == "DROPPED" {
				status = migStrPtr("DROPPED")
			}
			he := 0
			if g.gradeValue != "" {
				he = 1
			}
			if _, err := s.DB.Pool.Exec(ctx, `
				update enrollments set "gradeValue" = $2, "gradeStatus" = $3, status = $4, "hasEvaluated" = $5 where id = $1`,
				exID, gradeValue, g.gradeStatus, status, he); err == nil {
				s.migAudit(ctx, g.batchID, "apply-grades", src, user.ID, "UPDATE", "enrollments", exID,
					map[string]any{"gradeValue": exGV, "gradeStatus": exGS, "hasEvaluated": exHE},
					map[string]any{"gradeValue": g.gradeValue, "gradeStatus": g.gradeStatus, "status": status, "hasEvaluated": he})
				res.Updated++
			}
		} else {
			enStatus := "REGISTERED"
			if g.gradeStatus == "DROPPED" {
				enStatus = "DROPPED"
			}
			he := 0
			if g.gradeValue != "" {
				he = 1
			}
			var newID int64
			if err := s.DB.Pool.QueryRow(ctx, `
				insert into enrollments ("studentId","offeringId","status","gradeValue","gradeStatus","hasEvaluated")
				values ($1,$2,$3,$4,$5,$6)
				on conflict do nothing returning id`, sid, offID, enStatus, gradeValue, g.gradeStatus, he).Scan(&newID); err == nil && newID > 0 {
				s.migAudit(ctx, g.batchID, "apply-grades", src, user.ID, "INSERT", "enrollments", newID, nil,
					map[string]any{"gradeValue": g.gradeValue, "gradeStatus": g.gradeStatus})
				res.Created++
			}
		}
		_, _ = s.DB.Pool.Exec(ctx, `
			update legacy_grades set "appliedAt" = now(), "compareStatus" = 'SAME', "compareNote" = 'اعمال شد.' where id = $1`, g.id)
	}
	return res, nil
}

func migStrPtr(s string) *string { return &s }

// ClearMigrationGradeStaging پاک‌سازی staging نمرات یک مبدأ (پورت clearGradeStagingAction).
func (s *Service) ClearMigrationGradeStaging(ctx context.Context, sourceCode string) (int64, error) {
	tag, err := s.DB.Pool.Exec(ctx, `delete from legacy_grades where "sourceCode" = $1`, migCleanSource(sourceCode))
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// MigrationGradeStats آمار وضعیت مقایسهٔ نمرات یک مبدأ (پورت gradeStats).
func (s *Service) MigrationGradeStats(ctx context.Context, sourceCode string) ([]map[string]any, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select coalesce("compareStatus",'PENDING'), count(*)::int from legacy_grades
		 where "sourceCode" = $1 group by 1`, migCleanSource(sourceCode))
	if err != nil {
		return []map[string]any{}, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var st string
		var n int
		if rows.Scan(&st, &n) == nil {
			out = append(out, map[string]any{"status": st, "count": n})
		}
	}
	return out, rows.Err()
}

// ═══════════════ دفتر واگرد (پورت audit.ts) ═══════════════

// migAudit ثبت یک سند در دفتر واگرد.
func (s *Service) migAudit(ctx context.Context, batchID *int64, opGroup, sourceCode string, userID int64,
	op, table string, rowID int64, before, after map[string]any) {
	if rowID == 0 {
		return
	}
	_, _ = s.DB.Pool.Exec(ctx, `
		insert into migration_audit_entries ("batchId","opGroup","sourceCode","tableName","rowId","op","beforeData","afterData","createdByUserId","universityId")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,null)`,
		batchID, opGroup, sourceCode, table, rowID, op, nilIfEmpty(mustJSON(before)), nilIfEmpty(mustJSON(after)), userID)
}

// MigAuditSummary خلاصهٔ نوشته‌های یک دسته/گروه (پورت auditSummary).
func (s *Service) MigAuditSummary(ctx context.Context, batchID *int64, opGroup, sourceCode string) ([]map[string]any, error) {
	args := []any{}
	conds := []string{}
	if batchID != nil && *batchID > 0 {
		args = append(args, *batchID)
		conds = append(conds, fmt.Sprintf(`"batchId" = $%d`, len(args)))
	}
	if strings.TrimSpace(opGroup) != "" {
		args = append(args, opGroup)
		conds = append(conds, fmt.Sprintf(`"opGroup" = $%d`, len(args)))
	}
	if strings.TrimSpace(sourceCode) != "" {
		args = append(args, migCleanSource(sourceCode))
		conds = append(conds, fmt.Sprintf(`"sourceCode" = $%d`, len(args)))
	}
	where := "true"
	if len(conds) > 0 {
		where = strings.Join(conds, " and ")
	}
	rows, err := s.DB.Pool.Query(ctx, fmt.Sprintf(`
		select "tableName", op, count(*) filter (where "revertedAt" is not null)::int, count(*)::int
		  from migration_audit_entries where %s
		 group by 1, 2 order by 1`, where), args...)
	if err != nil {
		return []map[string]any{}, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var t, op string
		var reverted, n int
		if rows.Scan(&t, &op, &reverted, &n) == nil {
			out = append(out, map[string]any{"table": t, "op": op, "count": n, "reverted": reverted})
		}
	}
	return out, rows.Err()
}

// MigAuditGroups گروه‌های عملیاتی واگردپذیر یک مبدأ (پورت auditGroups).
func (s *Service) MigAuditGroups(ctx context.Context, sourceCode string) ([]map[string]any, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select "opGroup", "batchId", count(*)::int, count(*) filter (where "revertedAt" is null)::int, max("createdAt")::text
		  from migration_audit_entries where "sourceCode" = $1
		 group by 1, 2 order by max("createdAt") desc`, migCleanSource(sourceCode))
	if err != nil {
		return []map[string]any{}, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var opGroup string
		var batchID *int64
		var n, open int
		var last *string
		if rows.Scan(&opGroup, &batchID, &n, &open, &last) == nil {
			out = append(out, map[string]any{"opGroup": opGroup, "batchId": batchID, "count": n, "revertable": open, "at": last})
		}
	}
	return out, rows.Err()
}

// MigRollbackResult نتیجهٔ واگرد (پورت RollbackResult).
type MigRollbackResult struct {
	BatchID           *int64            `json:"batchId"`
	OpGroup           *string           `json:"opGroup"`
	Total             int               `json:"total"`
	Deleted           int               `json:"deleted"`
	Restored          int               `json:"restored"`
	AlreadyReverted   int               `json:"alreadyReverted"`
	Missing           int               `json:"missing"`
	ChangedAfterwards int               `json:"changedAfterwards"`
	Blocked           int               `json:"blocked"`
	Details           []MigRollbackItem `json:"details"`
}

type MigRollbackItem struct {
	Table  string  `json:"table"`
	RowID  int64   `json:"rowId"`
	Op     string  `json:"op"`
	Result string  `json:"result"`
	Note   *string `json:"note"`
}

// migRollbackTables is an explicit allowlist of tables that may be rolled back.
var migRollbackTables = map[string]bool{
	"enrollments": true, "course_offerings": true, "courses": true, "academic_terms": true,
	"term_financial_rules": true, "student_ledger": true, "financial_clearances": true,
	"students": true, "users": true, "legacy_grades": true,
}

var migSafeColumnRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// migSafeColumn validates a column identifier taken from an audit JSON
// snapshot before interpolating it into an UPDATE statement.
func migSafeColumn(name string) bool {
	return migSafeColumnRE.MatchString(name)
}

// RollbackMigrationBatch واگرد یک دسته یا گروه عملیاتی (پورت rollbackBatch).
func (s *Service) RollbackMigrationBatch(ctx context.Context, batchID *int64, opGroup, sourceCode string, force bool, userID int64) (*MigRollbackResult, error) {
	if (batchID == nil || *batchID <= 0) && strings.TrimSpace(opGroup) == "" {
		return nil, errors.New("برای واگرد باید دسته یا گروه عملیات مشخص شود.")
	}
	args := []any{}
	conds := []string{`"revertedAt" is null`}
	if batchID != nil && *batchID > 0 {
		args = append(args, *batchID)
		conds = append(conds, fmt.Sprintf(`"batchId" = $%d`, len(args)))
	}
	if strings.TrimSpace(opGroup) != "" {
		args = append(args, opGroup)
		conds = append(conds, fmt.Sprintf(`"opGroup" = $%d`, len(args)))
	}
	if strings.TrimSpace(sourceCode) != "" {
		args = append(args, migCleanSource(sourceCode))
		conds = append(conds, fmt.Sprintf(`"sourceCode" = $%d`, len(args)))
	}
	rows, err := s.DB.Pool.Query(ctx, fmt.Sprintf(`
		select id, "batchId", "opGroup", "sourceCode", "tableName", "rowId", op, "beforeData", "afterData"
		  from migration_audit_entries where %s order by id desc`, strings.Join(conds, " and ")), args...)
	if err != nil {
		return nil, err
	}
	type entry struct {
		id            int64
		batchID       *int64
		opGroup       string
		sourceCode    string
		table         string
		rowID         int64
		op            string
		before, after []byte
	}
	var entries []entry
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.id, &e.batchID, &e.opGroup, &e.sourceCode, &e.table, &e.rowID, &e.op, &e.before, &e.after); err == nil {
			entries = append(entries, e)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	res := &MigRollbackResult{BatchID: batchID, Details: []MigRollbackItem{}}
	if strings.TrimSpace(opGroup) != "" {
		og := opGroup
		res.OpGroup = &og
	}
	res.Total = len(entries)

	rowJSON := func(table string, rowID int64) map[string]any {
		var raw []byte
		if err := s.DB.Pool.QueryRow(ctx, fmt.Sprintf(`select to_jsonb(t) from %s t where id = $1`, table), rowID).Scan(&raw); err != nil {
			return nil
		}
		m := map[string]any{}
		_ = json.Unmarshal(raw, &m)
		return m
	}
	sameVal := func(a, b any) bool {
		if a == nil && b == nil {
			return true
		}
		if a == nil || b == nil {
			return false
		}
		return fmt.Sprint(a) == fmt.Sprint(b)
	}

	for _, e := range entries {
		if !migRollbackTables[e.table] {
			res.Blocked++
			res.Details = append(res.Details, MigRollbackItem{Table: e.table, RowID: e.rowID, Op: e.op, Result: "BLOCKED", Note: migStrPtr("جدول در فهرست مجاز واگرد نیست.")})
			continue
		}
		cur := rowJSON(e.table, e.rowID)
		if cur == nil {
			res.Missing++
			_, _ = s.DB.Pool.Exec(ctx, `update migration_audit_entries set "revertedAt" = now(), "revertNote" = 'سطر دیگر وجود نداشت.' where id = $1`, e.id)
			res.Details = append(res.Details, MigRollbackItem{Table: e.table, RowID: e.rowID, Op: e.op, Result: "MISSING"})
			continue
		}
		// آیا بعد از مهاجرت کسی دستی تغییرش داده؟
		if !force && len(e.after) > 0 {
			after := map[string]any{}
			if json.Unmarshal(e.after, &after) == nil && len(after) > 0 {
				drifted := []string{}
				for k, v := range after {
					if !sameVal(cur[k], v) {
						drifted = append(drifted, k)
					}
				}
				if len(drifted) > 0 {
					res.ChangedAfterwards++
					res.Details = append(res.Details, MigRollbackItem{Table: e.table, RowID: e.rowID, Op: e.op, Result: "CHANGED_AFTER",
						Note: migStrPtr("پس از مهاجرت تغییر کرده: " + strings.Join(drifted, "، ") + " — با «واگرد اجباری» قابل انجام است.")})
					continue
				}
			}
		}
		if e.op == "INSERT" {
			if _, err := s.DB.Pool.Exec(ctx, fmt.Sprintf(`delete from %s where id = $1`, e.table), e.rowID); err != nil {
				res.Blocked++
				res.Details = append(res.Details, MigRollbackItem{Table: e.table, RowID: e.rowID, Op: e.op, Result: "BLOCKED", Note: migStrPtr(err.Error())})
				continue
			}
			res.Deleted++
			res.Details = append(res.Details, MigRollbackItem{Table: e.table, RowID: e.rowID, Op: e.op, Result: "DELETED"})
		} else {
			before := map[string]any{}
			_ = json.Unmarshal(e.before, &before)
			if len(before) > 0 {
				sets, args2 := []string{}, []any{}
				unsafe := ""
				for k, v := range before {
					if !migSafeColumn(k) {
						unsafe = k
						break
					}
					args2 = append(args2, v)
					sets = append(sets, fmt.Sprintf(`"%s" = $%d`, k, len(args2)))
				}
				if unsafe != "" {
					res.Blocked++
					res.Details = append(res.Details, MigRollbackItem{Table: e.table, RowID: e.rowID, Op: e.op, Result: "BLOCKED",
						Note: migStrPtr("نام ستون غیرمجاز در دادهٔ واگرد: " + unsafe)})
					continue
				}
				args2 = append(args2, e.rowID)
				if _, err := s.DB.Pool.Exec(ctx, fmt.Sprintf(`update %s set %s where id = $%d`, e.table, strings.Join(sets, ", "), len(args2)), args2...); err != nil {
					res.Blocked++
					res.Details = append(res.Details, MigRollbackItem{Table: e.table, RowID: e.rowID, Op: e.op, Result: "BLOCKED", Note: migStrPtr(err.Error())})
					continue
				}
			}
			res.Restored++
			res.Details = append(res.Details, MigRollbackItem{Table: e.table, RowID: e.rowID, Op: e.op, Result: "RESTORED"})
		}
		if force {
			_, _ = s.DB.Pool.Exec(ctx, `update migration_audit_entries set "revertedAt" = now(), "revertNote" = 'واگرد اجباری' where id = $1`, e.id)
		} else {
			_, _ = s.DB.Pool.Exec(ctx, `update migration_audit_entries set "revertedAt" = now() where id = $1`, e.id)
		}
	}
	if batchID != nil && *batchID > 0 {
		status := "ROLLED_BACK"
		if res.Blocked > 0 || res.ChangedAfterwards > 0 {
			status = "PARTIAL"
		}
		_, _ = s.DB.Pool.Exec(ctx, `
			update legacy_import_batches set status = $2, "rolledBackAt" = now() where id = $1`, *batchID, status)
	}
	return res, nil
}

// ═══════════════ ناحیهٔ موقت: فهرست دسته‌ها ═══════════════

// ListMigrationBatches فهرست دسته‌های یک مبدأ با آمار واگرد (پورت listBatches).
func (s *Service) ListMigrationBatches(ctx context.Context, sourceCode string) ([]map[string]any, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select b.id, b."sourceCode", b."importType", b."fileName", b."sheetName", b."totalRows",
		       b."okRows", b."errorRows", b.status, b."createdAt"::text, b."processedAt"::text, b."rolledBackAt"::text,
		       (select count(*)::int from migration_audit_entries a where a."batchId" = b.id and a."revertedAt" is null),
		       (select count(*)::int from migration_audit_entries a where a."batchId" = b.id)
		  from legacy_import_batches b where b."sourceCode" = $1 order by b.id desc`,
		migCleanSource(sourceCode))
	if err != nil {
		return []map[string]any{}, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id int64
		var src, importType, status string
		var fileName, sheetName *string
		var total, okRows, errRows, auditOpen, auditTotal int
		var createdAt, processedAt, rolledBackAt *string
		if err := rows.Scan(&id, &src, &importType, &fileName, &sheetName, &total, &okRows, &errRows,
			&status, &createdAt, &processedAt, &rolledBackAt, &auditOpen, &auditTotal); err == nil {
			out = append(out, map[string]any{
				"id": id, "sourceCode": src, "importType": importType, "fileName": fileName, "sheetName": sheetName,
				"totalRows": total, "okRows": okRows, "errorRows": errRows, "status": status,
				"createdAt": createdAt, "processedAt": processedAt, "rolledBackAt": rolledBackAt,
				"auditOpen": auditOpen, "auditTotal": auditTotal,
			})
		}
	}
	return out, rows.Err()
}

// MigrationBatchRows سطرهای یک دسته (پورت batchRows).
func (s *Service) MigrationBatchRows(ctx context.Context, batchID int64, status string) ([]map[string]any, error) {
	args := []any{batchID}
	where := `"batchId" = $1`
	if strings.TrimSpace(status) != "" && strings.ToUpper(status) != "ALL" {
		args = append(args, strings.ToUpper(status))
		where += fmt.Sprintf(` and "validationStatus" = $%d`, len(args))
	}
	rows, err := s.DB.Pool.Query(ctx, fmt.Sprintf(`
		select id, "rowNumber", "validationStatus", "errorMessage", "rawData"::text
		  from legacy_import_rows where %s order by "rowNumber" limit 500`, where), args...)
	if err != nil {
		return []map[string]any{}, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, rn int64
		var st string
		var errMsg *string
		var raw []byte
		if err := rows.Scan(&id, &rn, &st, &errMsg, &raw); err == nil {
			data := map[string]string{}
			_ = json.Unmarshal(raw, &data)
			out = append(out, map[string]any{"id": id, "rowNumber": rn, "status": st, "error": errMsg, "data": data})
		}
	}
	return out, rows.Err()
}

// DeleteMigrationBatch حذف یک دسته از ناحیهٔ موقت (پورت deleteBatch).
func (s *Service) DeleteMigrationBatch(ctx context.Context, batchID int64) error {
	_, err := s.DB.Pool.Exec(ctx, `delete from legacy_import_batches where id = $1`, batchID)
	return err
}

// ═══════════════ شهریه: ارزیاب امن فرمول (پورت Parser) ═══════════════

// MigEvalFormula ارزیابی امن عبارت ریاضی با متغیرها (پورت evalFormula — بدون eval).
// پشتیبانی: + - * / % ^ پرانتز، مقایسه‌ها، min/max/round/floor/ceil/if.
func MigEvalFormula(src string, vars map[string]float64) (float64, error) {
	p := &migParser{src: strings.TrimSpace(MigNorm(src)), vars: vars}
	v, err := p.parseExpr()
	if err != nil {
		return 0, err
	}
	p.skip()
	if p.i < len(p.src) {
		return 0, fmt.Errorf("نویسهٔ نامعتبر در فرمول: «%s»", runeAt(p.src, p.i))
	}
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, errors.New("حاصل فرمول عددی معتبر نیست.")
	}
	return v, nil
}

func runeAt(s string, i int) string {
	r := []rune(s)
	if i >= len(r) {
		return ""
	}
	end := i + 8
	if end > len(r) {
		end = len(r)
	}
	return string(r[i:end])
}

type migParser struct {
	src  string
	i    int
	vars map[string]float64
}

func (p *migParser) skip() {
	for p.i < len(p.src) {
		r := rune(p.src[p.i])
		if r < 128 && (r == ' ' || r == '\t' || r == '\n') {
			p.i++
		} else {
			break
		}
	}
}

func (p *migParser) starts(tok string) bool {
	return strings.HasPrefix(p.src[p.i:], tok)
}

func (p *migParser) eat(tok string) bool {
	p.skip()
	if p.starts(tok) {
		p.i += len(tok)
		return true
	}
	return false
}

func (p *migParser) parseExpr() (float64, error) {
	left, err := p.parseAdd()
	if err != nil {
		return 0, err
	}
	for {
		p.skip()
		var op string
		for _, o := range []string{">=", "<=", "==", "!=", ">", "<"} {
			if p.starts(o) {
				op = o
				break
			}
		}
		if op == "" {
			return left, nil
		}
		p.i += len(op)
		right, err := p.parseAdd()
		if err != nil {
			return 0, err
		}
		var r bool
		switch op {
		case ">=":
			r = left >= right
		case "<=":
			r = left <= right
		case "==":
			r = left == right
		case "!=":
			r = left != right
		case ">":
			r = left > right
		case "<":
			r = left < right
		}
		if r {
			left = 1
		} else {
			left = 0
		}
	}
}

func (p *migParser) parseAdd() (float64, error) {
	v, err := p.parseMul()
	if err != nil {
		return 0, err
	}
	for {
		if p.eat("+") {
			n, e := p.parseMul()
			if e != nil {
				return 0, e
			}
			v += n
		} else if p.eat("-") {
			n, e := p.parseMul()
			if e != nil {
				return 0, e
			}
			v -= n
		} else {
			return v, nil
		}
	}
}

func (p *migParser) parseMul() (float64, error) {
	v, err := p.parsePow()
	if err != nil {
		return 0, err
	}
	for {
		if p.eat("*") {
			n, e := p.parsePow()
			if e != nil {
				return 0, e
			}
			v *= n
		} else if p.eat("/") {
			d, e := p.parsePow()
			if e != nil {
				return 0, e
			}
			if d == 0 {
				return 0, errors.New("تقسیم بر صفر در فرمول.")
			}
			v /= d
		} else if p.eat("%") {
			d, e := p.parsePow()
			if e != nil {
				return 0, e
			}
			if d == 0 {
				return 0, errors.New("باقی‌مانده بر صفر در فرمول.")
			}
			v = math.Mod(v, d)
		} else {
			return v, nil
		}
	}
}

func (p *migParser) parsePow() (float64, error) {
	base, err := p.parseUnary()
	if err != nil {
		return 0, err
	}
	if p.eat("^") {
		e, err := p.parsePow()
		if err != nil {
			return 0, err
		}
		return math.Pow(base, e), nil
	}
	return base, nil
}

func (p *migParser) parseUnary() (float64, error) {
	if p.eat("-") {
		v, err := p.parseUnary()
		return -v, err
	}
	if p.eat("+") {
		return p.parseUnary()
	}
	return p.parseAtom()
}

var migNumRe = regexp.MustCompile(`^\d+(\.\d+)?`)
var migIDRe = regexp.MustCompile(`^[A-Za-z_\x{0600}-\x{06FF}][A-Za-z0-9_\x{0600}-\x{06FF}]*`)

func (p *migParser) parseAtom() (float64, error) {
	p.skip()
	if p.eat("(") {
		v, err := p.parseExpr()
		if err != nil {
			return 0, err
		}
		if !p.eat(")") {
			return 0, errors.New("پرانتز بسته‌نشده در فرمول.")
		}
		return v, nil
	}
	rest := p.src[p.i:]
	if m := migNumRe.FindString(rest); m != "" {
		p.i += len(m)
		n, err := strconv.ParseFloat(m, 64)
		if err != nil {
			return 0, err
		}
		return n, nil
	}
	m := migIDRe.FindString(rest)
	if m == "" {
		return 0, fmt.Errorf("عبارت نامعتبر در فرمول نزدیک «%s»", runeAt(p.src, p.i))
	}
	name := m
	p.i += len(name)
	if p.eat("(") {
		args := []float64{}
		if !p.eat(")") {
			for {
				a, err := p.parseExpr()
				if err != nil {
					return 0, err
				}
				args = append(args, a)
				if p.eat(",") {
					continue
				}
				break
			}
			if !p.eat(")") {
				return 0, errors.New("پرانتز تابع بسته نشده.")
			}
		}
		return migCallFn(name, args)
	}
	key := strings.ToLower(name)
	for k, v := range p.vars {
		if strings.ToLower(k) == key {
			return v, nil
		}
	}
	return 0, fmt.Errorf("متغیر ناشناخته در فرمول: «%s»", name)
}

func migCallFn(name string, a []float64) (float64, error) {
	switch strings.ToLower(name) {
	case "min":
		m := math.Inf(1)
		for _, v := range a {
			if v < m {
				m = v
			}
		}
		return m, nil
	case "max":
		m := math.Inf(-1)
		for _, v := range a {
			if v > m {
				m = v
			}
		}
		return m, nil
	case "round":
		if len(a) > 1 {
			if a[1] == 0 {
				return 0, errors.New("تقسیم بر صفر در فرمول.")
			}
			return math.Round(a[0]/a[1]) * a[1], nil
		}
		return math.Round(a[0]), nil
	case "floor":
		return math.Floor(a[0]), nil
	case "ceil":
		return math.Ceil(a[0]), nil
	case "abs":
		return math.Abs(a[0]), nil
	case "if", "اگر":
		if len(a) > 1 && a[0] != 0 {
			return a[1], nil
		}
		if len(a) > 2 {
			return a[2], nil
		}
		return 0, nil
	default:
		return 0, fmt.Errorf("تابع ناشناخته در فرمول: «%s»", name)
	}
}

// MigTuitionContext دادهٔ لازم برای محاسبهٔ فرمول (پورت TuitionContext).
type MigTuitionContext struct {
	Units, TheoryUnits, PracticalUnits, GeneralUnits float64
	EntryYear                                        float64
	Discount                                         float64
}

// MigComputeTuition مبلغ شهریه طبق فرمول (پورت computeTuition).
func MigComputeTuition(fixedAmount, perUnitTheory, perUnitPractical, perUnitGeneral float64, expression, variables string, c MigTuitionContext) (float64, string) {
	vars := map[string]float64{
		"fixed": fixedAmount, "ثابت": fixedAmount,
		"perUnitTheory": perUnitTheory, "perUnitPractical": perUnitPractical, "perUnitGeneral": perUnitGeneral,
		"units": c.Units, "theoryUnits": c.TheoryUnits, "practicalUnits": c.PracticalUnits, "generalUnits": c.GeneralUnits,
		"واحد": c.Units, "واحد_نظری": c.TheoryUnits, "واحد_عملی": c.PracticalUnits, "واحد_عمومی": c.GeneralUnits,
		"entryYear": c.EntryYear, "discount": c.Discount, "تخفیف": c.Discount,
	}
	if variables != "" {
		var parsed map[string]any
		if json.Unmarshal([]byte(variables), &parsed) == nil {
			for k, v := range parsed {
				if n, ok := MigNum(v); ok {
					vars[k] = n
				}
			}
		}
	}
	expr := strings.TrimSpace(MigNorm(expression))
	if expr != "" {
		if amount, err := MigEvalFormula(expr, vars); err == nil {
			return math.Round(amount), "عبارت: " + expr
		}
	}
	theory := c.TheoryUnits
	if theory == 0 {
		theory = c.Units - c.PracticalUnits - c.GeneralUnits
	}
	amount := fixedAmount + math.Max(theory, 0)*perUnitTheory + c.PracticalUnits*perUnitPractical + c.GeneralUnits*perUnitGeneral - c.Discount
	return math.Round(amount), "ثابت + نظری × نرخ + عملی × نرخ + عمومی × نرخ − تخفیف"
}

// migMatchFormula انتخاب فرمول مناسب یک ردیف مالی (پورت matchFormula).
func migMatchFormula(formulas []map[string]any, formulaCode, termCode, degreeCode, majorCode string, entryYear int64) map[string]any {
	str := func(m map[string]any, k string) string { v, _ := m[k].(string); return v }
	numF := func(m map[string]any, k string) *float64 {
		if v, ok := m[k].(float64); ok {
			return &v
		}
		return nil
	}
	if formulaCode != "" {
		for _, f := range formulas {
			if strings.EqualFold(str(f, "formulaCode"), formulaCode) &&
				(str(f, "termCode") == "" || strings.EqualFold(MigNorm(str(f, "termCode")), MigNorm(termCode))) {
				return f
			}
		}
	}
	var best map[string]any
	bestScore := -1
	for _, f := range formulas {
		if active, ok := f["isActive"].(int32); ok && active != 1 {
			continue
		}
		if active, ok := f["isActive"].(int64); ok && active != 1 {
			continue
		}
		score := 0
		if t := str(f, "termCode"); t != "" {
			if !strings.EqualFold(MigNorm(t), MigNorm(termCode)) {
				continue
			}
			score += 4
		}
		if d := str(f, "degreeCode"); d != "" {
			if !strings.EqualFold(MigNorm(d), MigNorm(degreeCode)) {
				continue
			}
			score += 2
		}
		if mj := str(f, "majorCode"); mj != "" {
			if !strings.EqualFold(MigNorm(mj), MigNorm(majorCode)) {
				continue
			}
			score += 2
		}
		from, to := numF(f, "entryYearFrom"), numF(f, "entryYearTo")
		if from != nil || to != nil {
			y := float64(entryYear)
			if from != nil && y < *from {
				continue
			}
			if to != nil && y > *to {
				continue
			}
			score++
		}
		if score > bestScore {
			bestScore = score
			best = f
		}
	}
	return best
}

// MigTuitionFormula یک فرمول منتقل‌شده.
type MigTuitionFormula struct {
	ID               int64   `json:"id"`
	FormulaCode      string  `json:"formulaCode"`
	Title            *string `json:"title"`
	TermCode         *string `json:"termCode"`
	DegreeCode       *string `json:"degreeCode"`
	MajorCode        *string `json:"majorCode"`
	FixedAmount      string  `json:"fixedAmount"`
	PerUnitTheory    string  `json:"perUnitTheory"`
	PerUnitPractical string  `json:"perUnitPractical"`
	PerUnitGeneral   string  `json:"perUnitGeneral"`
	Expression       *string `json:"expression"`
}

// ListMigrationFormulas فهرست فرمول‌های یک مبدأ (برای سربرگ شهریه).
func (s *Service) ListMigrationFormulas(ctx context.Context, sourceCode string) ([]MigTuitionFormula, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "formulaCode", title, "termCode", "degreeCode", "majorCode",
		       "fixedAmount"::text, "perUnitTheory"::text, "perUnitPractical"::text, "perUnitGeneral"::text, expression
		  from legacy_tuition_formulas where "sourceCode" = $1 order by "formulaCode" limit 200`,
		migCleanSource(sourceCode))
	if err != nil {
		return []MigTuitionFormula{}, err
	}
	defer rows.Close()
	out := []MigTuitionFormula{}
	for rows.Next() {
		var f MigTuitionFormula
		if err := rows.Scan(&f.ID, &f.FormulaCode, &f.Title, &f.TermCode, &f.DegreeCode, &f.MajorCode,
			&f.FixedAmount, &f.PerUnitTheory, &f.PerUnitPractical, &f.PerUnitGeneral, &f.Expression); err == nil {
			out = append(out, f)
		}
	}
	return out, rows.Err()
}

// DeleteMigrationFormula حذف یک فرمول قدیمی (پورت deleteFormulaAction).
func (s *Service) DeleteMigrationFormula(ctx context.Context, id int64) error {
	_, err := s.DB.Pool.Exec(ctx, `delete from legacy_tuition_formulas where id = $1`, id)
	return err
}

// MigrationFinancialCount تعداد ردیف‌های مالی یک مبدأ.
func (s *Service) MigrationFinancialCount(ctx context.Context, sourceCode string) (int, error) {
	var n int
	err := s.DB.Pool.QueryRow(ctx, `select count(*)::int from legacy_financial_records where "sourceCode" = $1`,
		migCleanSource(sourceCode)).Scan(&n)
	return n, err
}

// MigCompareSummary خلاصهٔ اجرای مقایسهٔ شهریه (پورت CompareSummary).
type MigCompareSummary struct {
	RunID       int64            `json:"runId"`
	Total       int              `json:"total"`
	Matched     int              `json:"matched"`
	Mismatched  int              `json:"mismatched"`
	Unresolved  int              `json:"unresolved"`
	SumLegacy   float64          `json:"sumLegacy"`
	SumComputed float64          `json:"sumComputed"`
	SumDiff     float64          `json:"sumDiff"`
	Worst       []map[string]any `json:"worst"`
}

// RunMigrationTuitionCompare اجرای مقایسهٔ فرمول با دادهٔ قدیمی (پورت runTuitionCompare).
func (s *Service) RunMigrationTuitionCompare(ctx context.Context, user *session.User, sourceCode, termCode string, tolerance float64) (*MigCompareSummary, error) {
	src := migCleanSource(sourceCode)
	if tolerance < 0 {
		tolerance = 0
	}
	frows, err := s.DB.Pool.Query(ctx, `
		select id, "formulaCode", coalesce("termCode",''), coalesce("degreeCode",''), coalesce("majorCode",''),
		       "fixedAmount"::float8, "perUnitTheory"::float8, "perUnitPractical"::float8, "perUnitGeneral"::float8,
		       coalesce(expression,''), coalesce(variables,''), "isActive", "entryYearFrom", "entryYearTo"
		  from legacy_tuition_formulas where "sourceCode" = $1`, src)
	if err != nil {
		return nil, err
	}
	var formulas []map[string]any
	for frows.Next() {
		var id int64
		var code, term, degree, major, expression, variables string
		var fixed, pth, ppr, pgn float64
		var active int
		var yFrom, yTo *int
		if err := frows.Scan(&id, &code, &term, &degree, &major, &fixed, &pth, &ppr, &pgn, &expression, &variables, &active, &yFrom, &yTo); err == nil {
			m := map[string]any{"id": id, "formulaCode": code, "termCode": term, "degreeCode": degree, "majorCode": major,
				"fixed": fixed, "pth": pth, "ppr": ppr, "pgn": pgn, "expression": expression, "variables": variables, "isActive": active}
			if yFrom != nil {
				m["entryYearFrom"] = float64(*yFrom)
			}
			if yTo != nil {
				m["entryYearTo"] = float64(*yTo)
			}
			formulas = append(formulas, m)
		}
	}
	frows.Close()

	args := []any{src}
	where := `"sourceCode" = $1`
	if tc := strings.TrimSpace(termCode); tc != "" {
		args = append(args, tc)
		where += fmt.Sprintf(` and "termCode" = $%d`, len(args))
	}
	rrows, err := s.DB.Pool.Query(ctx, `
		select "studentCode", coalesce("studentName",''), "termCode", coalesce("formulaCode",''),
		       coalesce("degreeCode",''), coalesce("majorCode",''), coalesce("entryYear",0),
		       "totalUnits"::float8, "theoryUnits"::float8, "practicalUnits"::float8, "generalUnits"::float8,
		       "legacyTuition"::float8, "legacyDiscount"::float8
		  from legacy_financial_records where `+where+` order by "studentCode"`, args...)
	if err != nil {
		return nil, err
	}
	type rec struct {
		studentCode, studentName, termCode, formulaCode, degreeCode, majorCode string
		entryYear                                                              int64
		total, theory, practical, general, legacyTuition, legacyDiscount       float64
	}
	var records []rec
	for rrows.Next() {
		var r rec
		if err := rrows.Scan(&r.studentCode, &r.studentName, &r.termCode, &r.formulaCode, &r.degreeCode, &r.majorCode,
			&r.entryYear, &r.total, &r.theory, &r.practical, &r.general, &r.legacyTuition, &r.legacyDiscount); err == nil {
			records = append(records, r)
		}
	}
	rrows.Close()
	if err := rrows.Err(); err != nil {
		return nil, err
	}

	var runID int64
	if err := s.DB.Pool.QueryRow(ctx, `
		insert into tuition_compare_runs ("sourceCode","termCode","tolerance","createdByUserId","universityId")
		values ($1,$2,$3,$4,null) returning id`, src, nilIfEmpty(strings.TrimSpace(termCode)),
		strconv.FormatFloat(math.Round(tolerance), 'f', 0, 64), user.ID).Scan(&runID); err != nil {
		return nil, err
	}

	sum := &MigCompareSummary{RunID: runID, Total: len(records), Worst: []map[string]any{}}
	type itemRow struct {
		studentCode, studentName, termCode, formulaCode string
		totalUnits                                      float64
		legacy, computed, diff                          float64
		status, resolution, detail                      string
	}
	var items []itemRow
	for _, r := range records {
		sum.SumLegacy += r.legacyTuition
		f := migMatchFormula(formulas, r.formulaCode, r.termCode, r.degreeCode, r.majorCode, r.entryYear)
		if f == nil {
			sum.Unresolved++
			items = append(items, itemRow{studentCode: r.studentCode, studentName: r.studentName, termCode: r.termCode,
				formulaCode: r.formulaCode, totalUnits: r.total, legacy: r.legacyTuition, computed: 0, diff: -r.legacyTuition,
				status: "NO_FORMULA", resolution: "UNRESOLVED", detail: "هیچ فرمولی با ترم/مقطع/رشتهٔ این ردیف منطبق نشد."})
			continue
		}
		amount, detail := MigComputeTuition(f["fixed"].(float64), f["pth"].(float64), f["ppr"].(float64), f["pgn"].(float64),
			f["expression"].(string), f["variables"].(string), MigTuitionContext{
				Units: r.total, TheoryUnits: r.theory, PracticalUnits: r.practical, GeneralUnits: r.general,
				EntryYear: float64(r.entryYear), Discount: r.legacyDiscount,
			})
		diff := amount - r.legacyTuition
		sum.SumComputed += amount
		status, resolution := "DIFF", "DISCREPANCY"
		if math.Abs(diff) <= tolerance {
			status, resolution = "MATCH", "MATCHED"
			sum.Matched++
		} else {
			sum.Mismatched++
		}
		items = append(items, itemRow{studentCode: r.studentCode, studentName: r.studentName, termCode: r.termCode,
			formulaCode: f["formulaCode"].(string), totalUnits: r.total, legacy: r.legacyTuition, computed: amount,
			diff: diff, status: status, resolution: resolution, detail: detail})
	}
	for _, it := range items {
		_, err := s.DB.Pool.Exec(ctx, `
			insert into tuition_compare_items ("runId","studentCode","studentName","termCode","formulaCode","totalUnits","legacyAmount","computedAmount","diff","status","resolutionStatus","detail","universityId")
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,null)`,
			runID, it.studentCode, nilIfEmpty(it.studentName), nilIfEmpty(it.termCode), nilIfEmpty(it.formulaCode),
			it.totalUnits, it.legacy, it.computed, it.diff, it.status, it.resolution, it.detail)
		if err != nil {
			return nil, err
		}
	}
	sum.SumDiff = sum.SumComputed - sum.SumLegacy
	_, _ = s.DB.Pool.Exec(ctx, `
		update tuition_compare_runs set "totalRows" = $2, matched = $3, mismatched = $4, unresolved = $5,
		       "sumLegacy" = $6, "sumComputed" = $7, "sumDiff" = $8 where id = $1`,
		runID, sum.Total, sum.Matched, sum.Mismatched, sum.Unresolved,
		math.Round(sum.SumLegacy), math.Round(sum.SumComputed), math.Round(sum.SumDiff))

	sort.Slice(items, func(i, j int) bool {
		return math.Abs(items[i].diff) > math.Abs(items[j].diff)
	})
	for _, it := range items {
		if it.status == "MATCH" || len(sum.Worst) >= 20 {
			continue
		}
		sum.Worst = append(sum.Worst, map[string]any{
			"studentCode": it.studentCode, "termCode": it.termCode, "legacy": it.legacy,
			"computed": it.computed, "diff": it.diff, "status": it.status, "detail": it.detail,
		})
	}
	return sum, nil
}

// ListMigrationCompareRuns تاریخچهٔ مقایسه‌ها (پورت listCompareRuns).
func (s *Service) ListMigrationCompareRuns(ctx context.Context, limit int) ([]map[string]any, error) {
	if limit <= 0 || limit > 50 {
		limit = 15
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, coalesce("termCode",''), "tolerance"::text, coalesce("totalRows",0), coalesce(matched,0),
		       coalesce(mismatched,0), coalesce(unresolved,0), coalesce("sumLegacy",0)::text,
		       coalesce("sumComputed",0)::text, coalesce("sumDiff",0)::text, "createdAt"::text
		  from tuition_compare_runs order by id desc limit $1`, limit)
	if err != nil {
		return []map[string]any{}, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id int64
		var term, tol, sl, sc, sd, at string
		var total, matched, mismatched, unresolved int
		if rows.Scan(&id, &term, &tol, &total, &matched, &mismatched, &unresolved, &sl, &sc, &sd, &at) == nil {
			out = append(out, map[string]any{"id": id, "termCode": term, "tolerance": tol, "totalRows": total,
				"matched": matched, "mismatched": mismatched, "unresolved": unresolved,
				"sumLegacy": sl, "sumComputed": sc, "sumDiff": sd, "createdAt": at})
		}
	}
	return out, rows.Err()
}

// ApplyMigrationFormulas اعمال فرمول‌های قدیمی روی قواعد مالی ترم (پورت applyFormulasToRules).
func (s *Service) ApplyMigrationFormulas(ctx context.Context, user *session.User, sourceCode string) (applied int, skipped []map[string]string, err error) {
	src := migCleanSource(sourceCode)
	skipped = []map[string]string{}
	formulas, err := s.ListMigrationFormulasAll(ctx, src)
	if err != nil {
		return 0, skipped, err
	}
	termMap, _ := s.MigResolverFor(ctx, src, "TERM")
	degreeMap, _ := s.MigResolverFor(ctx, src, "DEGREE")
	terms := map[string]int64{}
	trows, _ := s.DB.Pool.Query(ctx, `select id, "termCode" from academic_terms`)
	for trows.Next() {
		var id int64
		var code string
		if trows.Scan(&id, &code) == nil {
			terms[MigNorm(code)] = id
		}
	}
	trows.Close()
	degrees := map[string]int64{}
	drows, _ := s.DB.Pool.Query(ctx, `select id, code from degree_level_configs`)
	for drows.Next() {
		var id int64
		var code string
		if drows.Scan(&id, &code) == nil {
			degrees[MigNorm(code)] = id
		}
	}
	drows.Close()

	for _, f := range formulas {
		if f.TermCode == nil || *f.TermCode == "" {
			skipped = append(skipped, map[string]string{"formulaCode": f.FormulaCode, "reason": "کد ترم ندارد (فرمول عمومی)."})
			continue
		}
		termID := int64(0)
		if o, ok := termMap[MigNorm(*f.TermCode)]; ok && o.ID != nil {
			termID = *o.ID
		} else {
			termID = terms[MigNorm(*f.TermCode)]
		}
		if termID == 0 {
			skipped = append(skipped, map[string]string{"formulaCode": f.FormulaCode,
				"reason": fmt.Sprintf("ترم «%s» تطبیق نخورده — در میز تطبیق کدها مشخص کنید.", *f.TermCode)})
			continue
		}
		if f.DegreeCode == nil || *f.DegreeCode == "" {
			skipped = append(skipped, map[string]string{"formulaCode": f.FormulaCode, "reason": "کد مقطع ندارد؛ برای قاعدهٔ مالی ترم، مقطع لازم است."})
			continue
		}
		degreeID := int64(0)
		if o, ok := degreeMap[MigNorm(*f.DegreeCode)]; ok && o.ID != nil {
			degreeID = *o.ID
		} else {
			degreeID = degrees[MigNorm(*f.DegreeCode)]
		}
		if degreeID == 0 {
			skipped = append(skipped, map[string]string{"formulaCode": f.FormulaCode,
				"reason": fmt.Sprintf("مقطع «%s» تطبیق نخورده — در میز تطبیق کدها مشخص کنید.", *f.DegreeCode)})
			continue
		}
		perUnit := f64max(f.PerUnitTheory, f.PerUnitGeneral, f.PerUnitPractical)
		fixed := numOr0(f.FixedAmount)
		var ruleID int64
		var exFixed, exPerUnit *string
		err := s.DB.Pool.QueryRow(ctx, `
			select id, "fixedTuition"::text, "perUnitTuition"::text from term_financial_rules
			 where "termId" = $1 and "degreeLevelId" = $2 limit 1`, termID, degreeID).Scan(&ruleID, &exFixed, &exPerUnit)
		if err == nil && ruleID > 0 {
			_, err = s.DB.Pool.Exec(ctx, `
				update term_financial_rules set "fixedTuition" = $2, "perUnitTuition" = $3 where id = $1`,
				ruleID, strconv.FormatFloat(math.Round(fixed), 'f', 0, 64), strconv.FormatFloat(math.Round(perUnit), 'f', 0, 64))
			if err == nil {
				s.migAudit(ctx, nil, "apply-formulas", src, user.ID, "UPDATE", "term_financial_rules", ruleID,
					map[string]any{"fixedTuition": exFixed, "perUnitTuition": exPerUnit},
					map[string]any{"fixedTuition": fixed, "perUnitTuition": perUnit})
				applied++
			}
		} else {
			var newID int64
			if e := s.DB.Pool.QueryRow(ctx, `
				insert into term_financial_rules ("termId","degreeLevelId","fixedTuition","perUnitTuition","advancePaymentRequired")
				values ($1,$2,$3,$4,$5) returning id`, termID, degreeID,
				strconv.FormatFloat(math.Round(fixed), 'f', 0, 64),
				strconv.FormatFloat(math.Round(perUnit), 'f', 0, 64),
				strconv.FormatFloat(math.Round(fixed/2), 'f', 0, 64)).Scan(&newID); e == nil && newID > 0 {
				s.migAudit(ctx, nil, "apply-formulas", src, user.ID, "INSERT", "term_financial_rules", newID, nil,
					map[string]any{"fixedTuition": fixed, "perUnitTuition": perUnit})
				applied++
			}
		}
	}
	return applied, skipped, nil
}

func f64max(vals ...string) float64 {
	m := 0.0
	for _, v := range vals {
		if n, ok := MigNum(v); ok && n > m {
			m = n
		}
	}
	return m
}

func numOr0(v string) float64 {
	if n, ok := MigNum(v); ok {
		return n
	}
	return 0
}

// ListMigrationFormulasAll همهٔ فرمول‌های مبدأ با فیلدهای عددی خام.
func (s *Service) ListMigrationFormulasAll(ctx context.Context, src string) ([]MigTuitionFormula, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "formulaCode", title, "termCode", "degreeCode", "majorCode",
		       "fixedAmount"::text, "perUnitTheory"::text, "perUnitPractical"::text, "perUnitGeneral"::text, expression
		  from legacy_tuition_formulas where "sourceCode" = $1`, src)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MigTuitionFormula{}
	for rows.Next() {
		var f MigTuitionFormula
		if err := rows.Scan(&f.ID, &f.FormulaCode, &f.Title, &f.TermCode, &f.DegreeCode, &f.MajorCode,
			&f.FixedAmount, &f.PerUnitTheory, &f.PerUnitPractical, &f.PerUnitGeneral, &f.Expression); err == nil {
			out = append(out, f)
		}
	}
	return out, rows.Err()
}

// ═══ پذیرش تراز قدیمی به‌عنوان «مانده اولیه» (پورت acceptLegacyBalance) ═══

// MigOpeningBalanceTag پیشوند سندهای مانده اولیه.
const MigOpeningBalanceTag = "[مهاجرت] مانده اولیه از سیستم قدیمی"

// MigOpeningBalanceResult نتیجهٔ ثبت مانده اولیه (پورت OpeningBalanceResult).
type MigOpeningBalanceResult struct {
	Total           int      `json:"total"`
	Created         int      `json:"created"`
	SkippedExisting int      `json:"skippedExisting"`
	SkippedZero     int      `json:"skippedZero"`
	NoStudent       int      `json:"noStudent"`
	NoTerm          int      `json:"noTerm"`
	SumDebit        float64  `json:"sumDebit"`
	SumCredit       float64  `json:"sumCredit"`
	Errors          []string `json:"errors"`
}

// AcceptMigrationLegacyBalance ثبت مانده اولیه برای دانشجویان یک مبدأ (پورت acceptLegacyBalance).
// انحراف آگاهانه: چک‌constraint جدول student_ledger مقدار DEBIT ندارد؛ ماندهٔ مثبت
// با نوع CHARGE (بدهکار) و منفی با CREDIT ثبت می‌شود.
func (s *Service) AcceptMigrationLegacyBalance(ctx context.Context, user *session.User, sourceCode, termCode string, runID int64) (*MigOpeningBalanceResult, error) {
	src := migCleanSource(sourceCode)
	res := &MigOpeningBalanceResult{Errors: []string{}}

	var codes []string
	if runID > 0 {
		rows, err := s.DB.Pool.Query(ctx, `
			select distinct "studentCode" from tuition_compare_items
			 where "runId" = $1 and status in ('DIFF','NO_FORMULA','ERROR')`, runID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var c string
			if rows.Scan(&c) == nil && c != "" {
				codes = append(codes, c)
			}
		}
		rows.Close()
	}

	args := []any{src}
	where := `"sourceCode" = $1`
	if tc := strings.TrimSpace(termCode); tc != "" {
		args = append(args, tc)
		where += fmt.Sprintf(` and "termCode" = $%d`, len(args))
	}
	if len(codes) > 0 {
		ph := []string{}
		for _, c := range codes {
			args = append(args, c)
			ph = append(ph, fmt.Sprintf("$%d", len(args)))
		}
		where += fmt.Sprintf(` and "studentCode" in (%s)`, strings.Join(ph, ","))
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "studentCode", "termCode", "legacyTuition"::float8, "legacyDiscount"::float8, "legacyPaid"::float8, "batchId"
		  from legacy_financial_records where `+where+` order by "studentCode"`, args...)
	if err != nil {
		return nil, err
	}
	type frec struct {
		id                      int64
		studentCode, termCode   string
		tuition, discount, paid float64
		batchID                 *int64
	}
	var records []frec
	for rows.Next() {
		var r frec
		if err := rows.Scan(&r.id, &r.studentCode, &r.termCode, &r.tuition, &r.discount, &r.paid, &r.batchID); err == nil {
			records = append(records, r)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	res.Total = len(records)
	if len(records) == 0 {
		return res, nil
	}

	termMap, _ := s.MigResolverFor(ctx, src, "TERM")
	terms := map[string]int64{}
	trows, _ := s.DB.Pool.Query(ctx, `select id, "termCode" from academic_terms`)
	for trows.Next() {
		var id int64
		var code string
		if trows.Scan(&id, &code) == nil {
			terms[MigNorm(code)] = id
		}
	}
	trows.Close()

	for _, r := range records {
		var sid int64
		if err := s.DB.Pool.QueryRow(ctx, `select id from students where "studentCode" = $1 limit 1`, r.studentCode).Scan(&sid); err != nil {
			res.NoStudent++
			continue
		}
		tid := int64(0)
		if o, ok := termMap[MigNorm(r.termCode)]; ok && o.ID != nil {
			tid = *o.ID
		} else {
			tid = terms[MigNorm(r.termCode)]
		}
		if tid == 0 {
			res.NoTerm++
			continue
		}
		balance := math.Round(r.tuition - r.discount - r.paid)
		if balance == 0 {
			res.SkippedZero++
			continue
		}
		var dupID int64
		if err := s.DB.Pool.QueryRow(ctx, `
			select id from student_ledger where "studentId" = $1 and "termId" = $2 and description like $3 limit 1`,
			sid, tid, MigOpeningBalanceTag+"%").Scan(&dupID); err == nil && dupID > 0 {
			res.SkippedExisting++
			continue
		}
		amount := math.Abs(balance)
		txnType := "CHARGE"
		if balance < 0 {
			txnType = "CREDIT"
		}
		desc := fmt.Sprintf("%s — مبدأ %s، ترم %s (شهریه %.0f، تخفیف %.0f، پرداختی %.0f)",
			MigOpeningBalanceTag, src, r.termCode, r.tuition, r.discount, r.paid)
		var ledID int64
		if err := s.DB.Pool.QueryRow(ctx, `
			insert into student_ledger ("studentId","termId","transactionType","amount","description","referenceId","universityId")
			values ($1,$2,$3,$4,$5,$6,null) returning id`, sid, tid, txnType, amount, desc, r.id).Scan(&ledID); err == nil && ledID > 0 {
			s.migAudit(ctx, r.batchID, "opening-balance", src, user.ID, "INSERT", "student_ledger", ledID, nil,
				map[string]any{"amount": amount, "transactionType": txnType})
			res.Created++
			if txnType == "CHARGE" {
				res.SumDebit += amount
			} else {
				res.SumCredit += amount
			}
		} else if err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("%s: %s", r.studentCode, err.Error()))
		}
	}

	if runID > 0 {
		_, _ = s.DB.Pool.Exec(ctx, `
			update tuition_compare_items set "resolutionStatus" = 'FORCED_LEGACY', "resolvedAt" = now()
			 where "runId" = $1 and status in ('DIFF','NO_FORMULA','ERROR')`, runID)
	}
	return res, nil
}

// MigrationResolutionStats آمار رفع مغایرت یک اجرا (پورت resolutionStats).
func (s *Service) MigrationResolutionStats(ctx context.Context, runID int64) ([]map[string]any, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select "resolutionStatus", count(*)::int from tuition_compare_items where "runId" = $1 group by 1`, runID)
	if err != nil {
		return []map[string]any{}, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var st string
		var n int
		if rows.Scan(&st, &n) == nil {
			out = append(out, map[string]any{"status": st, "count": n})
		}
	}
	return out, rows.Err()
}

// MigrationOverview دادهٔ اولیهٔ کل صفحهٔ مهاجرت.
func (s *Service) MigrationOverview(ctx context.Context, sourceCode string) (map[string]any, error) {
	src := migCleanSource(sourceCode)
	out := map[string]any{"domains": MigDomains}
	sources, err := s.ListSources(ctx)
	if err != nil {
		sources = []MigSource{}
	}
	if len(sources) == 0 {
		sources = []MigSource{{Code: "LEGACY", Title: "سیستم قدیمی (پیش‌فرض)"}}
	}
	out["sources"] = sources
	if formulas, err := s.ListMigrationFormulas(ctx, src); err == nil {
		out["formulas"] = formulas
	}
	if runs, err := s.ListMigrationCompareRuns(ctx, 15); err == nil {
		out["compareRuns"] = runs
	}
	if n, err := s.MigrationFinancialCount(ctx, src); err == nil {
		out["financialCount"] = n
	}
	if gs, err := s.MigrationGradeStats(ctx, src); err == nil {
		out["gradeStats"] = gs
	}
	return out, nil
}

var _ = pgx.QueryExecModeCacheStatement
var _ = fa.ToEnDigits
var _ = time.Now
