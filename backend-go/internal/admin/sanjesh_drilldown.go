// ═══ Sanjesh (سازمان سنجش) conversion drill-down — port of admin/sanjesh/[id]/* ═══
//
// Ports the six-step flow pages that hang off one uploaded file:
//   fields (field mapping), values (decode tables), rows (paging + detail),
//   matched (stage to admissions), enrolled (admissions_staging view)
// and the templates CRUD (sanjesh_templates live in the database, not in code).
//
// Multi-university: every query is scoped to the active university (fail-closed
// — no cookie, no data). A file/template row with universityId = NULL is a
// global default and stays readable for everyone, exactly like the reference
// `universityScope` helper. Bound parameters only.
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf16"

	"backend-go/internal/session"
)

// ─────────────────────────── shared row types ───────────────────────────

// SanjeshFile is one uploaded exam file (sanjesh_files).
type SanjeshFile struct {
	ID            int64    `json:"id"`
	UniversityID  *int64   `json:"universityId"`
	TermID        *int64   `json:"termId"`
	TemplateID    *int64   `json:"templateId"`
	TemplateKey   *string  `json:"templateKey"`
	Title         string   `json:"title"`
	ExamKind      *string  `json:"examKind"`
	ExamYear      *int     `json:"examYear"`
	FileName      *string  `json:"fileName"`
	FileSize      *int64   `json:"fileSize"`
	Encoding      *string  `json:"encoding"`
	ColumnCount   int      `json:"columnCount"`
	RowCount      int      `json:"rowCount"`
	Status        string   `json:"status"`
	Warnings      []string `json:"warnings"`
	CreatedAt     *string  `json:"createdAt"`
}

// SanjeshCounters is the per-file match counters (port of fileCounters).
type SanjeshCounters struct {
	Total          int `json:"total"`
	Pending        int `json:"pending"`
	Matched        int `json:"matched"`
	Duplicate      int `json:"duplicate"`
	Invalid        int `json:"invalid"`
	Ignored        int `json:"ignored"`
	UnmappedFields int `json:"unmappedFields"`
}

const sanjeshFileColumns = `
	"id", "universityId", "termId", "templateId", "templateKey", "title", "examKind",
	"examYear", "fileName", "fileSize", "encoding", "columnCount", "rowCount",
	"status", "warningsJson"::text, "createdAt"::text`

func scanSanjeshFile(row interface{ Scan(dest ...any) error }) (*SanjeshFile, error) {
	var f SanjeshFile
	var warnings string
	if err := row.Scan(&f.ID, &f.UniversityID, &f.TermID, &f.TemplateID, &f.TemplateKey, &f.Title,
		&f.ExamKind, &f.ExamYear, &f.FileName, &f.FileSize, &f.Encoding, &f.ColumnCount, &f.RowCount,
		&f.Status, &warnings, &f.CreatedAt); err != nil {
		return nil, err
	}
	f.Warnings = []string{}
	if strings.TrimSpace(warnings) != "" {
		var w []string
		if json.Unmarshal([]byte(warnings), &w) == nil {
			f.Warnings = w
		}
	}
	return &f, nil
}

// SanjeshScopedFile port of getScopedFile — the file must belong to the active
// university (or be a global NULL record); otherwise "not found" leaks nothing.
// Fail-closed: without an active university nothing is returned.
func (s *Service) SanjeshScopedFile(ctx context.Context, user *session.User, uniCookie string, fileID int64) (*SanjeshFile, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	f, err := scanSanjeshFile(s.DB.Pool.QueryRow(ctx, `
		select `+sanjeshFileColumns+` from "sanjesh_files"
		 where "id" = $1 and ("universityId" = $2 or "universityId" is null) limit 1`, fileID, *uniID))
	if err != nil {
		return nil, errors.New("فایل در دامنهٔ این دانشگاه یافت نشد.")
	}
	return f, nil
}

// SanjeshFileCounters port of fileCounters — status histogram + unmapped columns.
func (s *Service) SanjeshFileCounters(ctx context.Context, fileID int64) (*SanjeshCounters, error) {
	c := &SanjeshCounters{}
	rows, err := s.DB.Pool.Query(ctx, `
		select "matchStatus", count(*)::int from "sanjesh_file_rows"
		 where "fileId" = $1 group by "matchStatus"`, fileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			return nil, err
		}
		c.Total += n
		switch st {
		case "PENDING":
			c.Pending = n
		case "MATCHED":
			c.Matched = n
		case "DUPLICATE":
			c.Duplicate = n
		case "INVALID":
			c.Invalid = n
		case "IGNORED":
			c.Ignored = n
		}
	}
	if err := s.DB.Pool.QueryRow(ctx, `
		select count(*)::int from "sanjesh_file_fields"
		 where "fileId" = $1 and "isMapped" = false`, fileID).Scan(&c.UnmappedFields); err != nil {
		return nil, err
	}
	return c, nil
}

// ─────────────────────────── builtin templates ───────────────────────────
//
// Port of lib/sanjesh/templates.ts — the four builtin templates are seeded once
// into sanjesh_templates (isBuiltin = true, universityId = NULL) so they can be
// cloned per year. They are the initial defaults only; the database is the
// source of truth after seeding.

// SanjeshDecodeEntry one row of a decode table (value/label/internal code).
type SanjeshDecodeEntry struct {
	Value         string  `json:"value"`
	Label         string  `json:"label"`
	InternalValue *string `json:"internalValue,omitempty"`
}

type sanjeshBuiltinColumn struct {
	Title string
	Len   int
	Field string
}

type sanjeshBuiltinTemplate struct {
	Key                 string
	Title               string
	ExamKind            string
	ExamYear            int
	PdfRowCount         int
	ExpandedRows        []map[string]any
	Columns             []sanjeshBuiltinColumn
	DecodeTables        map[string][]SanjeshDecodeEntry
	VerifiedWithRealFile bool
}

func sanjeshPtrStr(v string) *string { return &v }

func sanjeshYesNo() []SanjeshDecodeEntry {
	return []SanjeshDecodeEntry{{Value: "0", Label: "خیر"}, {Value: "1", Label: "بله"}}
}

func sanjeshGpaMismatch() []SanjeshDecodeEntry {
	return []SanjeshDecodeEntry{{Value: "0", Label: "ندارد"}, {Value: "1", Label: "دارد"}}
}

var sanjeshBuiltinDecode = map[string][]SanjeshDecodeEntry{
	"GENDER": {
		{Value: "1", Label: "زن", InternalValue: sanjeshPtrStr("FEMALE")},
		{Value: "2", Label: "مرد", InternalValue: sanjeshPtrStr("MALE")},
		{Value: "زن", Label: "زن", InternalValue: sanjeshPtrStr("FEMALE")},
		{Value: "مرد", Label: "مرد", InternalValue: sanjeshPtrStr("MALE")},
	},
	"RELIGION": {
		{Value: "1", Label: "اسلام"}, {Value: "2", Label: "مسیحی"},
		{Value: "3", Label: "کلیمی"}, {Value: "4", Label: "زرتشتی"},
	},
	"FOREIGNER": {
		{Value: "0", Label: "غیراتباع"}, {Value: "1", Label: "افغانستان"},
		{Value: "2", Label: "پاکستان"}, {Value: "3", Label: "ترکیه"},
		{Value: "4", Label: "عراق"}, {Value: "5", Label: "لبنان"},
		{Value: "6", Label: "هند"}, {Value: "7", Label: "سایر کشورها"},
	},
	"DISABILITY": {
		{Value: "0", Label: "بدون معلولیت"}, {Value: "1", Label: "بینایی"},
		{Value: "2", Label: "شنوایی"}, {Value: "3", Label: "جسمی و حرکتی"},
		{Value: "4", Label: "آسیب گفتار و زبان"}, {Value: "5", Label: "تکامل رشد (اتیسم)"},
		{Value: "6", Label: "اعصاب و روان"},
	},
	"DISABILITY_SEVERITY": {
		{Value: "0", Label: "نامشخص"}, {Value: "1", Label: "خفیف"},
		{Value: "2", Label: "متوسط"}, {Value: "3", Label: "شدید"},
		{Value: "4", Label: "خیلی شدید"},
	},
	"LANGUAGE": {
		{Value: "1", Label: "انگلیسی"}, {Value: "2", Label: "آلمانی"},
		{Value: "3", Label: "فرانسه"}, {Value: "4", Label: "روسی"},
		{Value: "5", Label: "ایتالیایی"}, {Value: "انگليسي", Label: "انگلیسی"},
		{Value: "آلماني", Label: "آلمانی"}, {Value: "فرانسه", Label: "فرانسه"},
		{Value: "روسي", Label: "روسی"}, {Value: "ايتاليايي", Label: "ایتالیایی"},
	},
	"DEGREE": {
		{Value: "1", Label: "کاردانی"}, {Value: "2", Label: "کارشناسی"},
		{Value: "3", Label: "کارشناسی ارشد"}, {Value: "4", Label: "دکترای عمومی"},
		{Value: "5", Label: "دکترای پیوسته"},
	},
	"QUOTA_FINAL_SARASARI": {
		{Value: "1", Label: "منطقه ۱"}, {Value: "2", Label: "منطقه ۲"}, {Value: "3", Label: "منطقه ۳"},
		{Value: "4", Label: "خانواده شهدا"}, {Value: "5", Label: "ایثارگران ۲۵ درصد ظرفیت"},
		{Value: "6", Label: "رزمندگان"}, {Value: "7", Label: "ایثارگران ۵ درصد ظرفیت"},
	},
	"QUOTA_ADMIT_SARASARI": {
		{Value: "0", Label: "آزاد"}, {Value: "1", Label: "منطقه ۱"}, {Value: "2", Label: "منطقه ۲"},
		{Value: "3", Label: "منطقه ۳"}, {Value: "4", Label: "خانواده شهدا"},
		{Value: "5", Label: "ایثارگران ۲۵ درصد ظرفیت"}, {Value: "6", Label: "رزمندگان"},
		{Value: "7", Label: "کارمندی"}, {Value: "8", Label: "دیپلمه‌های کشاورزی"},
		{Value: "9", Label: "ایثارگران ۵ درصد ظرفیت"},
	},
	"QUOTA_REG_SARASARI": {
		{Value: "1", Label: "مناطق"}, {Value: "2", Label: "خانواده شهدا"},
		{Value: "3", Label: "جانبازان ۲۵ درصد و بالاتر"}, {Value: "4", Label: "فرزند جانباز ۲۵ درصد و بالاتر"},
		{Value: "5", Label: "همسر جانباز ۲۵ درصد و بالاتر"}, {Value: "6", Label: "آزادگان"},
		{Value: "7", Label: "فرزند آزاده"}, {Value: "8", Label: "همسر آزاده"},
		{Value: "9", Label: "فرزند شهید و مفقودالاثر"}, {Value: "10", Label: "همسر شهید و مفقودالاثر"},
		{Value: "11", Label: "رزمنده داوطلب بسیجی"}, {Value: "12", Label: "رزمنده وزارت جهاد کشاورزی"},
		{Value: "13", Label: "رزمنده ستاد کل نیروهای مسلح"}, {Value: "14", Label: "جانبازان کمتر از ۲۵ درصد"},
		{Value: "15", Label: "فرزند جانبازان کمتر از ۲۵ درصد"}, {Value: "16", Label: "همسر جانبازان کمتر از ۲۵ درصد"},
		{Value: "17", Label: "فرزند رزمنده داوطلب بسیجی"}, {Value: "18", Label: "فرزند رزمنده وزارت جهاد کشاورزی"},
		{Value: "19", Label: "فرزند رزمنده ستاد کل نیروهای مسلح"}, {Value: "20", Label: "همسر رزمنده داوطلب بسیجی"},
		{Value: "21", Label: "همسر رزمنده وزارت جهاد کشاورزی"}, {Value: "22", Label: "همسر رزمنده ستاد کل نیروهای مسلح"},
	},
	"COURSE_SARASARI": {
		{Value: "1", Label: "روزانه"}, {Value: "2", Label: "نوبت دوم"}, {Value: "3", Label: "پیام نور"},
		{Value: "4", Label: "نیمه حضوری"}, {Value: "5", Label: "محروم"}, {Value: "6", Label: "فرهنگیان/آزاد"},
		{Value: "7", Label: "غیرانتفاعی"}, {Value: "8", Label: "فرهنگیان/شاغل"},
		{Value: "9", Label: "پردیس خودگردان"}, {Value: "10", Label: "مجازی دولتی"},
		{Value: "11", Label: "مجازی غیرانتفاعی"}, {Value: "12", Label: "شهریه‌پرداز"},
		{Value: "13", Label: "مشترک با خارج"}, {Value: "14", Label: "دانشگاه آزاد"},
		{Value: "15", Label: "خودگردان دانشگاه آزاد"}, {Value: "16", Label: "روزانه غیردولتی"},
	},
	"EMPLOYMENT_STATUS": {
		{Value: "0", Label: "هیچ‌کدام"}, {Value: "1", Label: "دانشجوی انصرافی روزانه"},
		{Value: "2", Label: "دانشجوی انصرافی غیرروزانه"}, {Value: "3", Label: "دانشجوی روزانه"},
		{Value: "4", Label: "دانشجوی غیرروزانه"}, {Value: "5", Label: "دانشجوی اخراجی"},
	},
	"VETERAN_TYPE_K2K": {
		{Value: "1", Label: "آزاد"}, {Value: "2", Label: "—"},
		{Value: "3", Label: "جانبازان ۲۵ درصد و بالاتر"}, {Value: "4", Label: "فرزند جانباز ۲۵ درصد و بالاتر"},
		{Value: "5", Label: "همسر جانباز ۲۵ درصد و بالاتر"}, {Value: "6", Label: "آزادگان"},
		{Value: "7", Label: "فرزند آزاده"}, {Value: "8", Label: "همسر آزاده"},
		{Value: "9", Label: "فرزند شهید و مفقودالاثر"}, {Value: "10", Label: "همسر شهید و مفقودالاثر"},
		{Value: "11", Label: "رزمنده متقاضی بسیجی"}, {Value: "12", Label: "رزمنده وزارت جهاد کشاورزی"},
		{Value: "13", Label: "رزمنده ستاد کل نیروهای مسلح"}, {Value: "14", Label: "جانبازان کمتر از ۲۵ درصد"},
		{Value: "15", Label: "فرزند جانبازان کمتر از ۲۵ درصد"}, {Value: "16", Label: "همسر جانبازان کمتر از ۲۵ درصد"},
		{Value: "17", Label: "فرزند رزمنده متقاضی بسیجی"}, {Value: "18", Label: "فرزند رزمنده وزارت جهاد کشاورزی"},
		{Value: "19", Label: "فرزند رزمنده ستاد کل نیروهای مسلح"}, {Value: "20", Label: "همسر رزمنده متقاضی بسیجی"},
		{Value: "21", Label: "همسر رزمنده وزارت جهاد کشاورزی"}, {Value: "22", Label: "همسر رزمنده ستاد کل نیروهای مسلح"},
	},
	"DISABILITY_K2K": {
		{Value: "0", Label: "بدون معلولیت"}, {Value: "11", Label: "بینایی - خفیف"},
		{Value: "12", Label: "بینایی - متوسط"}, {Value: "13", Label: "بینایی - شدید"},
		{Value: "14", Label: "بینایی - خیلی شدید"}, {Value: "21", Label: "شنوایی - خفیف"},
		{Value: "22", Label: "شنوایی - متوسط"}, {Value: "23", Label: "شنوایی - شدید"},
		{Value: "24", Label: "شنوایی - خیلی شدید"}, {Value: "31", Label: "جسمی و حرکتی - خفیف"},
		{Value: "32", Label: "جسمی و حرکتی - متوسط"}, {Value: "33", Label: "جسمی و حرکتی - شدید"},
		{Value: "34", Label: "جسمی و حرکتی - خیلی شدید"}, {Value: "41", Label: "آسیب گفتار و زبان"},
		{Value: "51", Label: "تکامل رشد (اتیسم)"}, {Value: "61", Label: "اعصاب و روان"},
	},
	"DEFECT_CODE": {
		{Value: "0", Label: "بدون نقص"}, {Value: "1", Label: "فاقد عکس"},
		{Value: "2", Label: "مطابق دستورالعمل ثبت‌نامی اقدام گردد"},
		{Value: "4", Label: "مطابق دستورالعمل ثبت‌نامی اقدام گردد"},
		{Value: "5", Label: "مطابق دستورالعمل ثبت‌نامی اقدام گردد"},
		{Value: "6", Label: "مطابق دستورالعمل ثبت‌نامی اقدام گردد"},
		{Value: "15", Label: "دو حالت ۵ و ۱ را شامل می‌شود"},
	},
	"MILITARY_STATUS": {
		{Value: "0", Label: "مشمول / معاف‌نشده"}, {Value: "1", Label: "معافیت دائم"},
		{Value: "2", Label: "معافیت پزشکی"}, {Value: "3", Label: "معافیت تحصیلی"},
		{Value: "4", Label: "پایان خدمت"}, {Value: "5", Label: "در حال خدمت"},
		{Value: "6", Label: "مشمول"}, {Value: "7", Label: "معافیت کفالت"},
		{Value: "8", Label: "معافیت موارد خاص"}, {Value: "11", Label: "سایر"},
	},
	"YES_NO":       sanjeshYesNo(),
	"GPA_MISMATCH": sanjeshGpaMismatch(),
}

// sanjeshRawScoreColumns port of rawScoreColumns — the expanded raw-score columns.
func sanjeshRawScoreColumns(n int) []sanjeshBuiltinColumn {
	fa := []string{"۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹", "۱۰", "۱۱", "۱۲", "۱۳", "۱۴", "۱۵", "۱۶", "۱۷", "۱۸", "۱۹", "۲۰", "۲۱", "۲۲", "۲۳"}
	out := make([]sanjeshBuiltinColumn, 0, n)
	for i := 0; i < n; i++ {
		name := fmt.Sprintf("نمره خام درس %s", fa[i])
		out = append(out, sanjeshBuiltinColumn{Title: name, Len: 6, Field: fmt.Sprintf("rawScore%d", i+1)})
	}
	return out
}

func sanjeshBuiltinTemplates() []sanjeshBuiltinTemplate {
	expand := func(cols []sanjeshBuiltinColumn) []sanjeshBuiltinColumn {
		out := []sanjeshBuiltinColumn{}
		for _, c := range cols {
			out = append(out, c)
		}
		return out
	}
	decode := func(keys ...string) map[string][]SanjeshDecodeEntry {
		m := map[string][]SanjeshDecodeEntry{}
		for _, k := range keys {
			m[k] = sanjeshBuiltinDecode[k]
		}
		return m
	}
	return []sanjeshBuiltinTemplate{
		{
			Key: "FANI_1405", Title: "کاردانی ویژه دانشگاه ملی مهارت و غیردولتی-غیرانتفاعی ۱۴۰۵",
			ExamKind: "FANI", ExamYear: 1405, PdfRowCount: 54, VerifiedWithRealFile: true,
			ExpandedRows: []map[string]any{{"pdfRow": 22, "title": "نمرات خام دروس (۴ درس)", "columns": 4, "charCount": 6}},
			Columns: expand(concat([]sanjeshBuiltinColumn{
				{"شماره داوطلب", 6, "applicantNo"}, {"شماره پرونده", 6, "fileNo"},
				{"نام خانوادگی", 30, "lastName"}, {"نام", 30, "firstName"}, {"نام پدر", 30, "fatherName"},
				{"جنس", 1, "gender"}, {"شماره شناسنامه", 10, "idNumber"},
				{"تاریخ تولد (روز و ماه و سال)", 6, "birthDate"}, {"کد ملی", 10, "nationalCode"},
				{"کد رشته تحصیلی", 2, "majorCode"}, {"عنوان رشته تحصیلی", 50, "majorTitle"},
				{"کد رشته امتحانی", 2, "fieldCode"}, {"عنوان رشته امتحانی", 50, "fieldTitle"},
				{"کد سهمیه نهایی", 2, "quotaFinalCode"}, {"عنوان سهمیه نهایی", 50, "quotaFinalTitle"},
				{"کد سهمیه قبولی", 1, "quotaAdmitCode"}, {"عنوان سهمیه قبولی", 15, "quotaAdmitTitle"},
				{"کد رشته محل قبولی", 4, "fieldPlaceCode"}, {"عنوان رشته محل قبولی", 70, "fieldPlaceTitle"},
				{"کد دانشگاه قبولی", 4, "universityCode"}, {"عنوان دانشگاه قبولی", 70, "universityTitle"},
			}, sanjeshRawScoreColumns(4), []sanjeshBuiltinColumn{
				{"نمره قبولی (نمره کل)", 6, "totalScore"}, {"کد دین", 1, "religionCode"},
				{"کد معلولیت", 1, "disabilityCode"}, {"کد اتباع خارجی", 1, "foreignerCode"},
				{"کد پیگیری اتباع خارجی", 16, "foreignerRef"}, {"کد استان اخذ دیپلم", 2, "provinceDiplomaCode"},
				{"عنوان استان اخذ دیپلم", 20, "provinceDiplomaTitle"}, {"کد دیپلم", 5, "diplomaCode"},
				{"کد استان اقامت", 2, "provinceResidenceCode"}, {"عنوان استان اقامت", 20, "provinceResidenceTitle"},
				{"کد زبان خارجی", 1, "languageCode"}, {"عنوان زبان خارجی", 10, "languageTitle"},
				{"تلفن ثابت", 11, "phone"}, {"تلفن همراه", 11, "mobile"}, {"کد پستی", 10, "postalCode"},
				{"رایانامه (آدرس پست الکترونیکی)", 50, "email"}, {"کد استان محل سکونت", 2, "provinceCurrentCode"},
				{"عنوان استان محل سکونت", 35, "provinceCurrentTitle"}, {"کد شهر محل سکونت", 4, "cityCurrentCode"},
				{"عنوان شهر محل سکونت", 35, "cityCurrentTitle"}, {"آدرس", 200, "address"},
				{"کد نقص", 3, "defectCode"}, {"معدل", 4, "diplomaGpa"}, {"وضعیت آزمون", 1, "examStatus"},
				{"چپ دست می‌باشد", 1, "leftHanded"}, {"کد شهر محل تولد", 4, "cityBirthCode"},
				{"عنوان شهر محل تولد", 50, "cityBirthTitle"}, {"کد تعهد ۲", 1, "commitmentCode"},
				{"کد دوره", 1, "courseCode"}, {"عنوان دوره", 10, "courseTitle"},
				{"نیمسال قبولی", 10, "semesterCode"}, {"نیاز به بررسی مغایرت معدل", 1, "gpaMismatch"},
			})),
			DecodeTables: decode("GENDER", "RELIGION", "FOREIGNER", "DISABILITY", "DEFECT_CODE", "YES_NO", "GPA_MISMATCH"),
		},
		{
			Key: "ARSHAD_1405", Title: "کارشناسی ارشد ۱۴۰۵",
			ExamKind: "ARSHAD", ExamYear: 1405, PdfRowCount: 54, VerifiedWithRealFile: true,
			ExpandedRows: []map[string]any{{"pdfRow": 39, "title": "نمره خام دروس (۲۱ درس)", "columns": 21, "charCount": 6}},
			Columns: expand(concat([]sanjeshBuiltinColumn{
				{"شماره پرونده", 7, "fileNo"}, {"شماره داوطلبی", 7, "applicantNo"},
				{"نام خانوادگی", 30, "lastName"}, {"نام", 30, "firstName"}, {"نام پدر", 15, "fatherName"},
				{"جنسیت", 3, "gender"}, {"تاریخ تولد", 8, "birthDate"}, {"شماره شناسنامه", 10, "idNumber"},
				{"کد ملی", 10, "nationalCode"}, {"زبان", 10, "languageTitle"},
				{"عنوان اتباع خارجی", 20, "foreignerTitle"}, {"معدل فوق دیپلم", 4, "associateGpa"},
				{"معدل لیسانس", 4, "bachelorGpa"}, {"کد سهمیه ثبت‌نامی", 1, "quotaRegCode"},
				{"عنوان سهمیه ثبت‌نامی", 20, "quotaRegTitle"}, {"کد سهمیه قبولی", 1, "quotaAdmitCode"},
				{"عنوان سهمیه قبولی", 20, "quotaAdmitTitle"}, {"کد رشته امتحانی قبولی", 4, "fieldCode"},
				{"عنوان رشته امتحانی قبولی", 70, "fieldTitle"}, {"کد رشته محل قبولی", 5, "fieldPlaceCode"},
				{"کد دانشگاه قبولی", 4, "universityCode"}, {"عنوان دانشگاه قبولی", 85, "universityTitle"},
				{"کد گرایش قبولی", 2, "orientationCode"}, {"عنوان گرایش قبولی", 80, "orientationTitle"},
				{"نمره کل قبولی", 6, "totalScore"}, {"اولویت قبولی", 3, "priority"},
				{"رتبه کل در رشته امتحانی", 5, "totalRank"}, {"رتبه در گرایش قبولی", 5, "orientationRank"},
				{"کد رشته تحصیلی", 4, "majorCode"}, {"عنوان رشته تحصیلی", 70, "majorTitle"},
				{"کد دانشگاه اخذ مدرک", 4, "degreeUniversityCode"}, {"عنوان دانشگاه اخذ مدرک", 70, "degreeUniversityTitle"},
				{"سال و ماه و روز اخذ مدرک", 8, "degreeDate"}, {"کد تعهد", 1, "commitmentCode"},
				{"کد نظام وظیفه", 2, "militaryStatusCode"}, {"ارگان رزمندگی", 31, "veteranOrgTitle"},
				{"مدت جبهه رزمندگی", 3, "veteranMonths"}, {"معلولیت", 20, "disabilityTitle"},
			}, sanjeshRawScoreColumns(21), []sanjeshBuiltinColumn{
				{"تلفن ثابت", 11, "phone"}, {"تلفن همراه", 11, "mobile"}, {"کد پستی", 10, "postalCode"},
				{"کد استان اقامت (سکونت)", 2, "provinceResidenceCode"}, {"عنوان استان اقامت (سکونت)", 35, "provinceResidenceTitle"},
				{"کد شهر اقامت (سکونت)", 4, "cityResidenceCode"}, {"عنوان شهر اقامت (سکونت)", 35, "cityResidenceTitle"},
				{"آدرس", 200, "address"}, {"کد پیگیری اتباع خارجی", 13, "foreignerRef"},
				{"پست الکترونیکی", 50, "email"}, {"کد دوره", 2, "courseCode"}, {"عنوان دوره", 30, "courseTitle"},
				{"کد شهر محل تولد", 4, "cityBirthCode"}, {"عنوان شهر محل تولد", 35, "cityBirthTitle"},
				{"رتبه کشوری در گرایش قبولی", 6, "nationalRank"},
			})),
			DecodeTables: decode("GENDER", "LANGUAGE", "DISABILITY", "YES_NO", "QUOTA_REG_SARASARI", "QUOTA_ADMIT_SARASARI", "COURSE_SARASARI", "MILITARY_STATUS"),
		},
		{
			Key: "K2K_1405", Title: "کاردانی به کارشناسی ناپیوسته ۱۴۰۵",
			ExamKind: "K2K", ExamYear: 1405, PdfRowCount: 57, VerifiedWithRealFile: true,
			ExpandedRows: []map[string]any{{"pdfRow": 35, "title": "نمره خام (۱۳ فیلد ۶ تایی)", "columns": 13, "charCount": 6}},
			Columns: expand(concat([]sanjeshBuiltinColumn{
				{"شماره پرونده", 6, "fileNo"}, {"شماره داوطلب", 7, "applicantNo"},
				{"نام خانوادگی", 30, "lastName"}, {"نام", 30, "firstName"}, {"نام پدر", 20, "fatherName"},
				{"جنس", 3, "gender"}, {"تاریخ تولد (روز، ماه، سال)", 8, "birthDate"},
				{"شماره شناسنامه", 10, "idNumber"}, {"کد ملی", 10, "nationalCode"},
				{"عنوان دین", 15, "religionTitle"}, {"عنوان زبان امتحانی", 15, "languageTitle"},
				{"کد استان بومی", 2, "nativeProvinceCode"}, {"کد سهمیه نهایی", 1, "quotaFinalCode"},
				{"عنوان سهمیه نهایی", 15, "quotaFinalTitle"}, {"بومی", 1, "nativeFlag"},
				{"کد سهمیه قبولی", 1, "quotaAdmitCode"}, {"عنوان سهمیه قبولی", 20, "quotaAdmitTitle"},
				{"کد رشته امتحانی", 3, "fieldCode"}, {"عنوان رشته امتحانی", 60, "fieldTitle"},
				{"کد رشته محل قبولی", 4, "fieldPlaceCode"}, {"عنوان رشته محل قبولی", 120, "fieldPlaceTitle"},
				{"کد دانشگاه قبولی", 4, "universityCode"}, {"عنوان دانشگاه قبولی", 80, "universityTitle"},
				{"نمره کل قبولی", 5, "totalScore"}, {"اولویت قبولی", 2, "priority"},
				{"کد رشته فارغ‌التحصیلی", 4, "graduatedMajorCode"}, {"عنوان رشته فارغ‌التحصیلی", 60, "graduatedMajorTitle"},
				{"کد محل فارغ‌التحصیلی", 4, "graduatedPlaceCode"}, {"عنوان محل فارغ‌التحصیلی", 80, "graduatedPlaceTitle"},
				{"کد نوع ایثارگری", 2, "veteranTypeCode"}, {"مدت جبهه", 3, "veteranMonths"},
				{"کد معلولیت", 2, "disabilityCode"}, {"کد اتباع خارجی", 1, "foreignerCode"},
				{"کد پیگیری اتباع خارجی", 13, "foreignerRef"},
			}, sanjeshRawScoreColumns(13), []sanjeshBuiltinColumn{
				{"شماره تلفن", 11, "phone"}, {"یارانامه (پست الکترونیکی)", 50, "email"},
				{"کد پستی", 10, "postalCode"}, {"عنوان استان محل سکونت", 50, "provinceCurrentTitle"},
				{"عنوان شهر محل سکونت", 50, "cityCurrentTitle"}, {"آدرس محل سکونت", 200, "address"},
				{"شماره موبایل", 11, "mobile"}, {"کد استان اقامت", 2, "provinceResidenceCode"},
				{"عنوان استان اقامت", 40, "provinceResidenceTitle"}, {"کد شهر اقامت", 4, "cityResidenceCode"},
				{"عنوان شهر اقامت", 40, "cityResidenceTitle"}, {"کد نقص", 2, "defectCode"},
				{"کد وضعیت", 1, "examStatus"}, {"معدل", 4, "diplomaGpa"}, {"چپ دست", 1, "leftHanded"},
				{"کد شهر محل تولد", 4, "cityBirthCode"}, {"عنوان شهر محل تولد", 50, "cityBirthTitle"},
				{"وضعیت قبولی", 2, "admitStatus"}, {"کد دوره", 1, "courseCode"},
				{"عنوان دوره", 20, "courseTitle"}, {"کد نیمسال قبولی", 1, "semesterCode"},
				{"نیاز به بررسی مغایرت معدل", 1, "gpaMismatch"},
			})),
			DecodeTables: decode("GENDER", "VETERAN_TYPE_K2K", "DISABILITY_K2K", "FOREIGNER", "DEFECT_CODE", "YES_NO", "GPA_MISMATCH"),
		},
		{
			Key: "SARASARI_1404", Title: "سراسری ۱۴۰۴ — معرفی‌شدگان تکمیل ظرفیت",
			ExamKind: "SARASARI", ExamYear: 1404, PdfRowCount: 77, VerifiedWithRealFile: true,
			ExpandedRows: []map[string]any{{"pdfRow": 49, "title": "نمرات دروس (۹ فیلد)", "columns": 9, "charCount": 6}},
			Columns: expand(concat([]sanjeshBuiltinColumn{
				{"شناسه یکتا", 13, "uniqueId"}, {"شماره داوطلبی", 7, "applicantNo"},
				{"نام خانوادگی", 30, "lastName"}, {"نام", 30, "firstName"}, {"نام پدر", 20, "fatherName"},
				{"جنس", 1, "gender"}, {"تاریخ تولد (روز، ماه، سال)", 8, "birthDate"},
				{"شماره شناسنامه", 10, "idNumber"}, {"کد ملی", 10, "nationalCode"},
				{"کد وضعیت نظام وظیفه", 2, "militaryStatusCode"}, {"کد بخش تولد", 4, "districtBirthCode"},
				{"کد شهر تولد", 2, "cityBirthCode"}, {"کد استان تولد", 2, "provinceBirthCode"},
				{"کد بخش دیپلم یا پیش‌دانشگاهی", 4, "districtDiplomaCode"},
				{"کد شهر دیپلم یا پیش‌دانشگاهی", 2, "cityDiplomaCode"},
				{"کد استان دیپلم یا پیش‌دانشگاهی", 2, "provinceDiplomaCode"},
				{"کد بخش سال قبل از دیپلم", 4, "districtPrev1Code"}, {"کد شهرستان سال قبل از دیپلم", 2, "cityPrev1Code"},
				{"کد استان سال قبل از دیپلم", 2, "provincePrev1Code"},
				{"کد بخش دو سال قبل از دیپلم", 4, "districtPrev2Code"}, {"کد شهرستان دو سال قبل از دیپلم", 2, "cityPrev2Code"},
				{"کد استان دو سال قبل از دیپلم", 2, "provincePrev2Code"},
				{"کد بخش اقامت", 4, "districtResidenceCode"}, {"کد شهر اقامت", 2, "cityResidenceCode"},
				{"کد استان اقامت", 2, "provinceResidenceCode"}, {"کد استان بومی", 2, "nativeProvinceCode"},
				{"کد سهمیه نهایی", 1, "quotaFinalCode"}, {"کد سهمیه ثبت‌نامی", 2, "quotaRegCode"},
				{"کد سهمیه قبولی", 1, "quotaAdmitCode"}, {"کد معلولیت", 1, "disabilityCode"},
				{"کد شدت معلولیت", 1, "disabilitySeverityCode"}, {"کد عنوان دیپلم", 2, "diplomaTypeCode"},
				{"کد عنوان پیش‌دانشگاهی", 2, "preUniversityTypeCode"}, {"بهیار", 1, "behyar"},
				{"آموزگار", 1, "teacher"}, {"گروه قبولی", 1, "fieldGroup"}, {"کد رشته قبولی", 5, "majorCode"},
				{"دیکد رشته قبولی", 100, "majorTitle"}, {"گرایش قبولی", 60, "orientationTitle"},
				{"کد دانشگاه قبولی", 4, "universityCode"}, {"دی کد دانشگاه قبولی", 60, "universityTitle"},
				{"کد مقطع قبولی", 1, "degreeCode"}, {"کد دوره قبولی", 2, "courseCode"},
				{"کد نظام آموزشی", 1, "educationSystemCode"}, {"کد اتباع خارجی و ملیت", 1, "foreignerCode"},
				{"کد فراگیر اتباع", 16, "foreignerRef"}, {"سال اخذ دیپلم", 16, "diplomaYear"},
				{"سال اخذ پیش‌دانشگاهی", 4, "preUniversityYear"},
			}, sanjeshRawScoreColumns(9), []sanjeshBuiltinColumn{
				{"زبان خارجی", 1, "languageCode"}, {"نمره قبولی", 6, "totalScore"},
				{"تلفن ثابت", 11, "phone"}, {"تلفن همراه", 11, "mobile"}, {"کد پستی", 10, "postalCode"},
				{"عنوان استان محل سکونت", 50, "provinceCurrentTitle"}, {"عنوان شهر محل سکونت", 50, "cityCurrentTitle"},
				{"آدرس محل سکونت", 200, "address"}, {"پست الکترونیکی", 50, "email"},
				{"کد وضعیت اشتغال به تحصیل", 1, "employmentStatusCode"}, {"فارغ‌التحصیل مقطع کاردانی", 1, "graduatedAssociate"},
				{"فارغ‌التحصیل مقطع کارشناسی", 1, "graduatedBachelor"},
				{"فارغ‌التحصیل مقطع کارشناسی ارشد و بالاتر", 1, "graduatedMaster"},
				{"معدل کتبی دیپلم", 4, "diplomaGpa"}, {"پذیرش بدون آزمون می‌باشد", 1, "acceptedWithoutExam"},
				{"کد تعهد وزارت بهداشت", 1, "healthCommitmentCode"}, {"چپ دست می‌باشد", 1, "leftHanded"},
				{"کد نقص", 1, "defectCode"}, {"رتبه در سهمیه نهایی", 6, "quotaRank"},
				{"رتبه کشوری", 6, "nationalRank"}, {"دانشجوی ممتاز", 1, "topStudent"},
				{"حداقل نمره سهمیه آزاد یا منطقه یک", 1, "hasQuotaThreshold"}, {"ردیف رشته قبولی", 3, "previousFieldRow"},
				{"کد پیگیری سوابق تحصیلی", 26, "academicRecordRef"}, {"دریافت فرم انصراف", 1, "cancelFormReceived"},
				{"نیاز به بررسی مغایرت معدل", 1, "gpaMismatch"}, {"گروه رشته محل قبولی قبلی", 1, "previousFieldGroup"},
				{"کد رشته محل قبولی قبلی", 5, "previousFieldCode"},
			})),
			DecodeTables: decode("GENDER", "FOREIGNER", "DISABILITY", "DISABILITY_SEVERITY", "LANGUAGE", "DEGREE",
				"QUOTA_FINAL_SARASARI", "QUOTA_REG_SARASARI", "QUOTA_ADMIT_SARASARI", "COURSE_SARASARI",
				"EMPLOYMENT_STATUS", "DEFECT_CODE", "MILITARY_STATUS", "YES_NO", "GPA_MISMATCH"),
		},
	}
}

// concat joins column groups (port of the TS spread operator).
func concat(groups ...[]sanjeshBuiltinColumn) []sanjeshBuiltinColumn {
	out := []sanjeshBuiltinColumn{}
	for _, g := range groups {
		out = append(out, g...)
	}
	return out
}

// ─────────────────────────── template read/write ───────────────────────────

// SanjeshTemplate is a template as the UI sees it (database or builtin fallback).
type SanjeshTemplate struct {
	ID                  int64                            `json:"id"`
	Key                 string                           `json:"key"`
	Title               string                           `json:"title"`
	ExamKind            string                           `json:"examKind"`
	ExamYear            int                              `json:"examYear"`
	ColumnCount         int                              `json:"columnCount"`
	PdfRowCount         int                              `json:"pdfRowCount"`
	Columns             []SanjeshTemplateColumn          `json:"columns"`
	DecodeTables        map[string][]SanjeshDecodeEntry  `json:"decodeTables"`
	ExpandedRows        []map[string]any                 `json:"expandedRows"`
	Notes               *string                          `json:"notes"`
	IsBuiltin           bool                             `json:"isBuiltin"`
	VerifiedWithRealFile bool                            `json:"verifiedWithRealFile"`
	UniversityID        *int64                           `json:"universityId"`
}

// SanjeshTemplateColumn one column of a template.
type SanjeshTemplateColumn struct {
	ColIndex     int     `json:"colIndex"`
	SanjeshTitle string  `json:"sanjeshTitle"`
	CharCount    int     `json:"charCount"`
	TargetField  *string `json:"targetField"`
}

// SanjeshTemplateColumnInput is a column coming from the editor form.
type SanjeshTemplateColumnInput struct {
	ColIndex     int    `json:"colIndex"`
	SanjeshTitle string `json:"sanjeshTitle"`
	CharCount    int    `json:"charCount"`
	TargetField  string `json:"targetField"` // "" = unmapped
}

// SanjeshSaveTemplateInput is the payload of the template editor.
type SanjeshSaveTemplateInput struct {
	ID          int64                        `json:"id"` // 0 = create
	Key         string                       `json:"key"`
	Title       string                       `json:"title"`
	ExamKind    string                       `json:"examKind"`
	ExamYear    int                          `json:"examYear"`
	Columns     []SanjeshTemplateColumnInput `json:"columns"`
	DecodeTables map[string][]SanjeshDecodeEntry `json:"decodeTables"`
	Notes       *string                      `json:"notes"`
}

// pgxRows is the minimal scan target shared by pgx.Row and pgx.Rows.
type pgxRows interface {
	Scan(dest ...any) error
}

func sanjeshColumnsFromJSON(raw string) []SanjeshTemplateColumn {
	cols := []SanjeshTemplateColumn{}
	if strings.TrimSpace(raw) == "" {
		return cols
	}
	var in []struct {
		ColIndex     int     `json:"colIndex"`
		SanjeshTitle string  `json:"sanjeshTitle"`
		CharCount    int     `json:"charCount"`
		TargetField  *string `json:"targetField"`
	}
	if json.Unmarshal([]byte(raw), &in) != nil {
		return cols
	}
	for _, c := range in {
		tf := c.TargetField
		// Unmapped columns were stored as extra_<n> by the reference so the raw
		// data survives; the UI shows them as unmapped.
		if tf != nil && strings.HasPrefix(*tf, "extra_") {
			tf = nil
		}
		cols = append(cols, SanjeshTemplateColumn{ColIndex: c.ColIndex, SanjeshTitle: c.SanjeshTitle, CharCount: c.CharCount, TargetField: tf})
	}
	return cols
}

// SanjeshListTemplates port of listTemplates — active database templates of this
// university (plus global ones), merged with the builtin code templates that
// are not in the database yet, sorted by year then key.
func (s *Service) SanjeshListTemplates(ctx context.Context, user *session.User, uniCookie string) ([]SanjeshTemplate, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	out := []SanjeshTemplate{}
	rows, err := s.DB.Pool.Query(ctx, `
		select "id", "key", "title", "examKind", "examYear", "columnCount",
		       coalesce("pdfRowCount", "columnCount"), "columnsJson"::text, "decodeTablesJson"::text,
		       "expandedRowsJson"::text, "notes", "isBuiltin", "verifiedWithRealFile", "universityId"
		  from "sanjesh_templates"
		 where "isActive" = true and ("universityId" = $1 or "universityId" is null)`, *uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	dbKeys := map[string]bool{}
	for rows.Next() {
		var t SanjeshTemplate
		var colsJSON, decJSON, expJSON string
		var notes *string
		if err := rows.Scan(&t.ID, &t.Key, &t.Title, &t.ExamKind, &t.ExamYear, &t.ColumnCount,
			&t.PdfRowCount, &colsJSON, &decJSON, &expJSON, &notes, &t.IsBuiltin, &t.VerifiedWithRealFile, &t.UniversityID); err != nil {
			return nil, err
		}
		t.Notes = notes
		t.Columns = sanjeshColumnsFromJSON(colsJSON)
		t.DecodeTables = map[string][]SanjeshDecodeEntry{}
		if strings.TrimSpace(decJSON) != "" {
			_ = json.Unmarshal([]byte(decJSON), &t.DecodeTables)
		}
		t.ExpandedRows = []map[string]any{}
		if strings.TrimSpace(expJSON) != "" {
			_ = json.Unmarshal([]byte(expJSON), &t.ExpandedRows)
		}
		dbKeys[t.Key] = true
		out = append(out, t)
	}
	// Builtin code templates missing from the database are still offered.
	for i := range out {
		if out[i].Columns == nil {
			out[i].Columns = []SanjeshTemplateColumn{}
		}
	}
	for _, b := range sanjeshBuiltinTemplates() {
		if dbKeys[b.Key] {
			continue
		}
		out = append(out, sanjeshBuiltinToTemplate(b))
	}
	// Sort by examYear then key (same as the reference).
	for i := 1; i < len(out); i++ {
		for j := i; j > 0; j-- {
			a, b := out[j-1], out[j]
			if a.ExamYear < b.ExamYear || (a.ExamYear == b.ExamYear && a.Key <= b.Key) {
				break
			}
			out[j-1], out[j] = b, a
		}
	}
	return out, nil
}

func sanjeshBuiltinToTemplate(b sanjeshBuiltinTemplate) SanjeshTemplate {
	cols := make([]SanjeshTemplateColumn, 0, len(b.Columns))
	for i, c := range b.Columns {
		f := c.Field
		cols = append(cols, SanjeshTemplateColumn{ColIndex: i + 1, SanjeshTitle: c.Title, CharCount: c.Len, TargetField: &f})
	}
	notes := "قالب پیش‌فرض کد — پس از درج در دیتابیس فقط قابل کپی است."
	return SanjeshTemplate{
		ID: 0, Key: b.Key, Title: b.Title, ExamKind: b.ExamKind, ExamYear: b.ExamYear,
		ColumnCount: len(b.Columns), PdfRowCount: b.PdfRowCount,
		Columns: cols, DecodeTables: b.DecodeTables,
		ExpandedRows: b.ExpandedRows, Notes: &notes,
		IsBuiltin: true, VerifiedWithRealFile: b.VerifiedWithRealFile,
	}
}

// SanjeshLoadTemplateByKey port of loadTemplateByKey — university template
// first, then the global record, then the builtin code template.
func (s *Service) SanjeshLoadTemplateByKey(ctx context.Context, key string, uniID int64) (*SanjeshTemplate, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select "id", "key", "title", "examKind", "examYear", "columnCount",
		       coalesce("pdfRowCount", "columnCount"), "columnsJson"::text, "decodeTablesJson"::text,
		       "expandedRowsJson"::text, "notes", "isBuiltin", "verifiedWithRealFile", "universityId"
		  from "sanjesh_templates"
		 where "key" = $1
		 order by case when "universityId" = $2 then 0 else 1 end
		 limit 5`, key, uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var own, global *SanjeshTemplate
	for rows.Next() {
		t, err := rowsToTemplate(rows)
		if err != nil {
			return nil, err
		}
		if t.UniversityID != nil && *t.UniversityID == uniID && own == nil {
			own = t
		}
		if t.UniversityID == nil && global == nil {
			global = t
		}
	}
	if own != nil {
		return own, nil
	}
	if global != nil {
		return global, nil
	}
	for _, b := range sanjeshBuiltinTemplates() {
		if b.Key == key {
			t := sanjeshBuiltinToTemplate(b)
			return &t, nil
		}
	}
	return nil, nil
}

// SanjeshTemplateDBInfo is the database record behind a template key — the
// editor needs the numeric id and the builtin lock. Priority: own university
// row, then the global one, then the first row found (same as the reference
// editor page).
type SanjeshTemplateDBInfo struct {
	ID        int64  `json:"id"`
	IsBuiltin bool   `json:"isBuiltin"`
	Key       string `json:"key"`
}

// SanjeshTemplateDBInfo reads the DB record behind a template key (may be nil
// when only the builtin code template exists).
func (s *Service) SanjeshTemplateDBInfo(ctx context.Context, key string, uniID int64) (*SanjeshTemplateDBInfo, error) {
	return s.sanjeshTemplateDBInfo(ctx, key, uniID)
}

func (s *Service) sanjeshTemplateDBInfo(ctx context.Context, key string, uniID int64) (*SanjeshTemplateDBInfo, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select "id", "isBuiltin", "universityId" from "sanjesh_templates" where "key" = $1 limit 5`, key)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var own, global, first *SanjeshTemplateDBInfo
	for rows.Next() {
		var info SanjeshTemplateDBInfo
		var u *int64
		if err := rows.Scan(&info.ID, &info.IsBuiltin, &u); err != nil {
			return nil, err
		}
		info.Key = key
		if first == nil {
			first = &info
		}
		if u != nil && *u == uniID && own == nil {
			own = &info
		}
		if u == nil && global == nil {
			global = &info
		}
	}
	if own != nil {
		return own, nil
	}
	if global != nil {
		return global, nil
	}
	if first != nil {
		return first, nil
	}
	return nil, nil
}

func rowsToTemplate(rows pgxRows) (*SanjeshTemplate, error) {
	var t SanjeshTemplate
	var colsJSON, decJSON, expJSON string
	var notes *string
	if err := rows.Scan(&t.ID, &t.Key, &t.Title, &t.ExamKind, &t.ExamYear, &t.ColumnCount,
		&t.PdfRowCount, &colsJSON, &decJSON, &expJSON, &notes, &t.IsBuiltin, &t.VerifiedWithRealFile, &t.UniversityID); err != nil {
		return nil, err
	}
	t.Notes = notes
	t.Columns = sanjeshColumnsFromJSON(colsJSON)
	t.DecodeTables = map[string][]SanjeshDecodeEntry{}
	if strings.TrimSpace(decJSON) != "" {
		_ = json.Unmarshal([]byte(decJSON), &t.DecodeTables)
	}
	t.ExpandedRows = []map[string]any{}
	if strings.TrimSpace(expJSON) != "" {
		_ = json.Unmarshal([]byte(expJSON), &t.ExpandedRows)
	}
	return &t, nil
}

// sanjeshTemplateKeyExists port of templateKeyExists — the key is taken in this
// university scope (or globally) already.
func (s *Service) sanjeshTemplateKeyExists(ctx context.Context, key string, uniID int64) (bool, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select "universityId" from "sanjesh_templates" where "key" = $1`, key)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var u *int64
		if err := rows.Scan(&u); err != nil {
			return false, err
		}
		if u == nil || *u == uniID {
			return true, nil
		}
	}
	return false, rows.Err()
}

// SanjeshValidateTemplateColumns port of validateTemplateColumns — continuous
// column numbers from 1, unique destination fields, non-empty titles, sane
// lengths. At least one column is required.
func SanjeshValidateTemplateColumns(cols []SanjeshTemplateColumnInput) error {
	if len(cols) == 0 {
		return errors.New("قالب باید حداقل یک ستون داشته باشد.")
	}
	sorted := make([]SanjeshTemplateColumnInput, len(cols))
	copy(sorted, cols)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && sorted[j-1].ColIndex > sorted[j].ColIndex; j-- {
			sorted[j-1], sorted[j] = sorted[j], sorted[j-1]
		}
	}
	for i, c := range sorted {
		if c.ColIndex != i+1 {
			return fmt.Errorf("شمارهٔ ستون‌ها باید از ۱ پیوسته باشد (ستون %d شمارهٔ %d دارد).", i+1, c.ColIndex)
		}
	}
	seen := map[string]int{}
	for _, c := range sorted {
		if c.TargetField == "" {
			continue
		}
		if prev, ok := seen[c.TargetField]; ok {
			return fmt.Errorf("فیلد «%s» در ستون‌های %d و %d تکراری است — مقدار دومی اولی را بازنویسی می‌کند.", c.TargetField, prev, c.ColIndex)
		}
		seen[c.TargetField] = c.ColIndex
	}
	noTitle := 0
	badLen := 0
	for _, c := range sorted {
		if strings.TrimSpace(c.SanjeshTitle) == "" {
			noTitle++
		}
		if c.CharCount < 0 {
			badLen++
		}
	}
	if noTitle > 0 {
		return fmt.Errorf("%d ستون عنوان ندارد.", noTitle)
	}
	if badLen > 0 {
		return fmt.Errorf("%d ستون طول نامعتبر دارد.", badLen)
	}
	return nil
}

var sanjeshTemplateKeyRe = regexp.MustCompile(`^[A-Z0-9_]+$`)

// SanjeshSaveTemplate port of saveTemplate — create or update. Builtin and
// foreign-university templates cannot be edited (fail-closed).
func (s *Service) SanjeshSaveTemplate(ctx context.Context, user *session.User, uniCookie string, in *SanjeshSaveTemplateInput) (*SanjeshTemplate, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	in.Key = strings.TrimSpace(in.Key)
	in.Title = strings.TrimSpace(in.Title)
	in.ExamKind = strings.TrimSpace(in.ExamKind)
	if in.Key == "" || in.Title == "" || in.ExamKind == "" || in.ExamYear <= 0 {
		return nil, errors.New("اطلاعات قالب ناقص است.")
	}
	if err := SanjeshValidateTemplateColumns(in.Columns); err != nil {
		return nil, err
	}
	// Unmapped columns are stored with targetField: null (never "").
	storedCols := make([]map[string]any, 0, len(in.Columns))
	for _, c := range in.Columns {
		col := map[string]any{"colIndex": c.ColIndex, "sanjeshTitle": c.SanjeshTitle, "charCount": c.CharCount}
		if c.TargetField != "" && c.TargetField != "__none__" {
			col["targetField"] = c.TargetField
		} else {
			col["targetField"] = nil
		}
		storedCols = append(storedCols, col)
	}
	colsJSON, err := json.Marshal(storedCols)
	if err != nil {
		return nil, err
	}
	decJSON := in.DecodeTables
	if decJSON == nil {
		decJSON = map[string][]SanjeshDecodeEntry{}
	}
	decBytes, err := json.Marshal(decJSON)
	if err != nil {
		return nil, err
	}
	emptyExp, _ := json.Marshal([]map[string]any{})

	if in.ID > 0 {
		var isBuiltin bool
		var tplUni *int64
		err := s.DB.Pool.QueryRow(ctx, `
			select "isBuiltin", "universityId" from "sanjesh_templates" where "id" = $1 limit 1`, in.ID).
			Scan(&isBuiltin, &tplUni)
		if err != nil {
			return nil, errors.New("قالب یافت نشد.")
		}
		if isBuiltin {
			return nil, errors.New("قالب پیش‌فرض قابل ویرایش نیست؛ ابتدا آن را کپی کنید.")
		}
		if tplUni != nil && tplUni != uniID {
			return nil, errors.New("این قالب متعلق به دانشگاه دیگری است.")
		}
		tag, err := s.DB.Pool.Exec(ctx, `
			update "sanjesh_templates" set
				"title" = $2, "examKind" = $3, "examYear" = $4, "columnCount" = $5,
				"columnsJson" = $6::jsonb, "decodeTablesJson" = $7::jsonb, "notes" = $8, "updatedAt" = now()
			 where "id" = $1`,
			in.ID, in.Title, in.ExamKind, in.ExamYear, len(in.Columns),
			string(colsJSON), string(decBytes), in.Notes)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() == 0 {
			return nil, errors.New("قالب یافت نشد.")
		}
		return s.SanjeshTemplateByID(ctx, in.ID)
	}

	// Create — the key must be free in this scope (same check the reference
	// actions run before saving).
	if exists, err := s.sanjeshTemplateKeyExists(ctx, in.Key, *uniID); err != nil {
		return nil, err
	} else if exists {
		return nil, fmt.Errorf("کلید «%s» قبلاً استفاده شده است.", in.Key)
	}
	var id int64
	err = s.DB.Pool.QueryRow(ctx, `
		insert into "sanjesh_templates"
			("key", "title", "examKind", "examYear", "columnCount", "pdfRowCount",
			 "columnsJson", "decodeTablesJson", "expandedRowsJson", "notes",
			 "isBuiltin", "verifiedWithRealFile", "universityId", "createdByUserId")
		 values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,false,false,$11,$12)
		 returning "id"`,
		in.Key, in.Title, in.ExamKind, in.ExamYear, len(in.Columns), len(in.Columns),
		string(colsJSON), string(decBytes), string(emptyExp), in.Notes, *uniID, user.ID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return s.SanjeshTemplateByID(ctx, id)
}

// SanjeshTemplateByID reads one template row (for the editor after save).
func (s *Service) SanjeshTemplateByID(ctx context.Context, id int64) (*SanjeshTemplate, error) {
	row := s.DB.Pool.QueryRow(ctx, `
		select "id", "key", "title", "examKind", "examYear", "columnCount",
		       coalesce("pdfRowCount", "columnCount"), "columnsJson"::text, "decodeTablesJson"::text,
		       "expandedRowsJson"::text, "notes", "isBuiltin", "verifiedWithRealFile", "universityId"
		  from "sanjesh_templates" where "id" = $1 limit 1`, id)
	t, err := rowsToTemplate(row)
	if err != nil {
		return nil, errors.New("قالب یافت نشد.")
	}
	return t, nil
}

// SanjeshCloneTemplate port of cloneTemplate — copy a (usually builtin)
// template into an editable per-university template for a new year.
func (s *Service) SanjeshCloneTemplate(ctx context.Context, user *session.User, uniCookie, sourceKey, newKey, title string, examYear int) (*SanjeshTemplate, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	sourceKey, newKey, title = strings.TrimSpace(sourceKey), strings.TrimSpace(newKey), strings.TrimSpace(title)
	if sourceKey == "" || newKey == "" || title == "" || examYear <= 0 {
		return nil, errors.New("کلید، عنوان و سال قالب الزامی است.")
	}
	if !sanjeshTemplateKeyRe.MatchString(newKey) {
		return nil, errors.New("کلید قالب فقط حروف بزرگ انگلیسی، رقم و زیرخط.")
	}
	if exists, err := s.sanjeshTemplateKeyExists(ctx, newKey, *uniID); err != nil {
		return nil, err
	} else if exists {
		return nil, fmt.Errorf("کلید «%s» قبلاً استفاده شده است.", newKey)
	}
	src, err := s.SanjeshLoadTemplateByKey(ctx, sourceKey, *uniID)
	if err != nil {
		return nil, err
	}
	if src == nil {
		return nil, fmt.Errorf("قالب مبدأ «%s» یافت نشد.", sourceKey)
	}
	cols := make([]SanjeshTemplateColumnInput, 0, len(src.Columns))
	for _, c := range src.Columns {
		f := ""
		if c.TargetField != nil && !strings.HasPrefix(*c.TargetField, "extra_") {
			f = *c.TargetField
		}
		cols = append(cols, SanjeshTemplateColumnInput{ColIndex: c.ColIndex, SanjeshTitle: c.SanjeshTitle, CharCount: c.CharCount, TargetField: f})
	}
	created, err := s.SanjeshSaveTemplate(ctx, user, uniCookie, &SanjeshSaveTemplateInput{
		Key: newKey, Title: title, ExamKind: src.ExamKind, ExamYear: examYear,
		Columns: cols, DecodeTables: src.DecodeTables, Notes: src.Notes,
	})
	if err != nil {
		return nil, err
	}
	return created, nil
}

// SanjeshSeedBuiltinTemplates port of seedBuiltinTemplates — idempotent insert
// of the four code templates as global builtin rows.
func (s *Service) SanjeshSeedBuiltinTemplates(ctx context.Context) (map[string]int, error) {
	inserted, skipped := 0, 0
	for _, b := range sanjeshBuiltinTemplates() {
		var id int64
		err := s.DB.Pool.QueryRow(ctx, `select "id" from "sanjesh_templates" where "key" = $1 limit 1`, b.Key).Scan(&id)
		if err == nil {
			skipped++
			continue
		}
		cols := make([]SanjeshTemplateColumnInput, 0, len(b.Columns))
		for i, c := range b.Columns {
			cols = append(cols, SanjeshTemplateColumnInput{ColIndex: i + 1, SanjeshTitle: c.Title, CharCount: c.Len, TargetField: c.Field})
		}
		colsJSON, _ := json.Marshal(cols)
		decJSON, _ := json.Marshal(b.DecodeTables)
		expJSON, _ := json.Marshal(b.ExpandedRows)
		if _, err := s.DB.Pool.Exec(ctx, `
			insert into "sanjesh_templates"
				("key", "title", "examKind", "examYear", "columnCount", "pdfRowCount",
				 "columnsJson", "decodeTablesJson", "expandedRowsJson", "isBuiltin", "verifiedWithRealFile")
			 values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,true,$10)`,
			b.Key, b.Title, b.ExamKind, b.ExamYear, len(b.Columns), b.PdfRowCount,
			string(colsJSON), string(decJSON), string(expJSON), b.VerifiedWithRealFile); err != nil {
			return nil, err
		}
		inserted++
	}
	return map[string]int{"inserted": inserted, "skipped": skipped}, nil
}

// ─────────────────────────── fields page ───────────────────────────

// SanjeshFieldRow is one row of the field-mapping table.
type SanjeshFieldRow struct {
	ID             int64   `json:"id"`
	ColIndex       int     `json:"colIndex"`
	SanjeshTitle   string  `json:"sanjeshTitle"`
	CharCount      int     `json:"charCount"`
	TargetField    *string `json:"targetField"`
	SampleValue    *string `json:"sampleValue"`
	ObservedLength *int    `json:"observedLength"`
	IsMapped       bool    `json:"isMapped"`
}

// SanjeshFieldsView is the payload of the field-mapping page.
type SanjeshFieldsView struct {
	File     *SanjeshFile      `json:"file"`
	Counters *SanjeshCounters  `json:"counters"`
	Fields   []SanjeshFieldRow `json:"fields"`
}

// SanjeshFieldsView ports the [id]/fields page read.
func (s *Service) SanjeshFieldsView(ctx context.Context, user *session.User, uniCookie string, fileID int64) (*SanjeshFieldsView, error) {
	file, err := s.SanjeshScopedFile(ctx, user, uniCookie, fileID)
	if err != nil {
		return nil, err
	}
	counters, err := s.SanjeshFileCounters(ctx, fileID)
	if err != nil {
		return nil, err
	}
	fields := []SanjeshFieldRow{}
	rows, err := s.DB.Pool.Query(ctx, `
		select "id", "colIndex", "sanjeshTitle", "charCount", "targetField",
		       "sampleValue", "observedLength", "isMapped"
		  from "sanjesh_file_fields" where "fileId" = $1 order by "colIndex" asc`, fileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var f SanjeshFieldRow
		if err := rows.Scan(&f.ID, &f.ColIndex, &f.SanjeshTitle, &f.CharCount, &f.TargetField,
			&f.SampleValue, &f.ObservedLength, &f.IsMapped); err == nil {
			fields = append(fields, f)
		}
	}
	return &SanjeshFieldsView{File: file, Counters: counters, Fields: fields}, nil
}

// SanjeshFieldMappingUpdate is one field_<colIndex> entry of the mapping form.
type SanjeshFieldMappingUpdate struct {
	ColIndex int    `json:"colIndex"`
	Target   string `json:"target"` // "" = unmapped
}

// SanjeshSaveFieldMapping port of saveFieldMappingAction — validate the form,
// rewrite the mapping rows, rebuild dataJson.fields from the stored raw columns
// (remapFileRows) and flag the file FIELDS_READY.
func (s *Service) SanjeshSaveFieldMapping(ctx context.Context, user *session.User, uniCookie string, fileID int64, updates []SanjeshFieldMappingUpdate) (map[string]any, error) {
	if _, err := s.SanjeshScopedFile(ctx, user, uniCookie, fileID); err != nil {
		return nil, err
	}
	if len(updates) == 0 {
		return map[string]any{"message": "تغییری ثبت نشد.", "updated": 0}, nil
	}
	// One destination field cannot be given to two columns (the second would
	// silently overwrite the first).
	used := map[string]int{}
	for _, u := range updates {
		if u.Target == "" || u.Target == "__none__" {
			u.Target = ""
			continue
		}
		if prev, ok := used[u.Target]; ok {
			return nil, fmt.Errorf("فیلد «%s» هم به ستون %d و هم به ستون %d داده شده است.", u.Target, prev, u.ColIndex)
		}
		used[u.Target] = u.ColIndex
	}
	for _, u := range updates {
		target := u.Target
		if target == "__none__" {
			target = ""
		}
		var t any
		if target == "" {
			t = nil
		} else {
			t = target
		}
		if _, err := s.DB.Pool.Exec(ctx, `
			update "sanjesh_file_fields" set "targetField" = $3, "isMapped" = $4
			 where "fileId" = $1 and "colIndex" = $2`, fileID, u.ColIndex, t, target != ""); err != nil {
			return nil, err
		}
	}
	updated, err := s.sanjeshRemapFileRows(ctx, fileID)
	if err != nil {
		return nil, err
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		update "sanjesh_files" set "status" = 'FIELDS_READY', "updatedAt" = now() where "id" = $1`, fileID); err != nil {
		return nil, err
	}
	return map[string]any{
		"message": fmt.Sprintf("%d ستون به‌روزرسانی شد و داده‌ها بازنگاشت شدند.", len(updates)),
		"updated": updated,
	}, nil
}

// sanjeshRemapFileRows port of remapFileRows — rebuild dataJson.fields from the
// stored raw columns with a single jsonb aggregation; the file is never re-read.
func (s *Service) sanjeshRemapFileRows(ctx context.Context, fileID int64) (int, error) {
	tag, err := s.DB.Pool.Exec(ctx, `
		UPDATE "sanjesh_file_rows" AS r
		   SET "dataJson" = jsonb_set(
		         r."dataJson", '{fields}',
		         COALESCE((
		           SELECT jsonb_object_agg(m."targetField", COALESCE(r."dataJson"->'columns'->>(m."colIndex"::text), ''))
		             FROM "sanjesh_file_fields" m
		            WHERE m."fileId" = r."fileId" AND m."targetField" IS NOT NULL
		         ), '{}'::jsonb))
		 WHERE r."fileId" = $1`, fileID)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// SanjeshAutoMapFields port of autoMapFieldsAction — apply the file's template
// mapping to every column, then remap once.
func (s *Service) SanjeshAutoMapFields(ctx context.Context, user *session.User, uniCookie string, fileID int64) (map[string]any, error) {
	file, err := s.SanjeshScopedFile(ctx, user, uniCookie, fileID)
	if err != nil {
		return nil, err
	}
	if file.TemplateKey == nil || strings.TrimSpace(*file.TemplateKey) == "" {
		return nil, errors.New("برای نگاشت خودکار، فایل باید قالب داشته باشد.")
	}
	uniID := s.UniversityID(ctx, user, uniCookie)
	tpl, err := s.SanjeshLoadTemplateByKey(ctx, *file.TemplateKey, *uniID)
	if err != nil {
		return nil, err
	}
	if tpl == nil {
		return nil, errors.New("قالب فایل یافت نشد.")
	}
	for _, c := range tpl.Columns {
		target := ""
		if c.TargetField != nil && !strings.HasPrefix(*c.TargetField, "extra_") {
			target = *c.TargetField
		}
		var t any
		if target == "" {
			t = nil
		} else {
			t = target
		}
		if _, err := s.DB.Pool.Exec(ctx, `
			update "sanjesh_file_fields" set "targetField" = $3, "isMapped" = $4
			 where "fileId" = $1 and "colIndex" = $2`, fileID, c.ColIndex, t, target != ""); err != nil {
			return nil, err
		}
	}
	if _, err := s.sanjeshRemapFileRows(ctx, fileID); err != nil {
		return nil, err
	}
	return map[string]any{
		"message": fmt.Sprintf("نگاشت قالب «%s» روی %d ستون اعمال شد.", tpl.Key, len(tpl.Columns)),
	}, nil
}

// ─────────────────────────── rows pages ───────────────────────────

// SanjeshListRow is one row of the sanjesh rows table.
type SanjeshListRow struct {
	ID                int64   `json:"id"`
	RowNo             int     `json:"rowNo"`
	FullName          *string `json:"fullName"`
	NationalCode      *string `json:"nationalCode"`
	NationalCodeValid bool    `json:"nationalCodeValid"`
	ApplicantNo       *string `json:"applicantNo"`
	UniqueID          *string `json:"uniqueId"`
	StudentID         *int64  `json:"studentId"`
	MatchStatus       string  `json:"matchStatus"`
	MatchNote         *string `json:"matchNote"`
}

// SanjeshRowsView is the payload of the rows page (50 per page, like the ref).
type SanjeshRowsView struct {
	File     *SanjeshFile     `json:"file"`
	Counters *SanjeshCounters `json:"counters"`
	Rows     []SanjeshListRow `json:"rows"`
	Total    int              `json:"total"`
	Page     int              `json:"page"`
	Pages    int              `json:"pages"`
}

// SanjeshRowsView ports the [id]/rows page read (search + status filter + paging).
func (s *Service) SanjeshRowsView(ctx context.Context, user *session.User, uniCookie, q, status string, fileID, page int) (*SanjeshRowsView, error) {
	file, err := s.SanjeshScopedFile(ctx, user, uniCookie, int64(fileID))
	if err != nil {
		return nil, err
	}
	counters, err := s.SanjeshFileCounters(ctx, int64(fileID))
	if err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	const pageSize = 50
	conds := []string{`"fileId" = $1`}
	args := []any{fileID}
	idx := 2
	if q = strings.TrimSpace(q); q != "" {
		like := "%" + q + "%"
		conds = append(conds, `("nationalCode" ilike $`+itoa(int64(idx))+` or "fullName" ilike $`+itoa(int64(idx))+
			` or "applicantNo" ilike $`+itoa(int64(idx))+` or "uniqueId" ilike $`+itoa(int64(idx))+`)`)
		args = append(args, like)
		idx++
	}
	if status = strings.TrimSpace(status); status != "" {
		conds = append(conds, `"matchStatus" = $`+itoa(int64(idx)))
		args = append(args, status)
		idx++
	}
	where := strings.Join(conds, " and ")

	view := &SanjeshRowsView{File: file, Counters: counters, Rows: []SanjeshListRow{}, Page: page}
	if err := s.DB.Pool.QueryRow(ctx, `
		select count(*)::int from "sanjesh_file_rows" where `+where, args...).Scan(&view.Total); err != nil {
		return nil, err
	}
	view.Pages = 1
	if view.Total > 0 {
		view.Pages = (view.Total + pageSize - 1) / pageSize
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select "id", "rowNo", "fullName", "nationalCode", "nationalCodeValid",
		       "applicantNo", "uniqueId", "studentId", "matchStatus", "matchNote"
		  from "sanjesh_file_rows"
		 where `+where+`
		 order by "rowNo" asc limit `+itoa(pageSize)+` offset `+itoa(int64((page-1)*pageSize)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r SanjeshListRow
		if err := rows.Scan(&r.ID, &r.RowNo, &r.FullName, &r.NationalCode, &r.NationalCodeValid,
			&r.ApplicantNo, &r.UniqueID, &r.StudentID, &r.MatchStatus, &r.MatchNote); err == nil {
			view.Rows = append(view.Rows, r)
		}
	}
	return view, nil
}

// SanjeshRowDetail port of the [id]/rows/[rowId] page read — every stored
// column of the row (mapped or not) plus the untouched raw line.
type SanjeshRowDetail struct {
	File *SanjeshFile    `json:"file"`
	Row  *SanjeshListRow `json:"row"`
	// DataJSON is dataJson verbatim ({fields, columns, meta}) for the UI.
	DataJSON json.RawMessage `json:"dataJson"`
	RawLine  string          `json:"rawLine"`
	RowHash  *string         `json:"rowHash"`
	Fields   []SanjeshFieldRow `json:"fields"`
}

// SanjeshRowDetail ports the row detail read.
func (s *Service) SanjeshRowDetail(ctx context.Context, user *session.User, uniCookie string, fileID, rowID int64) (*SanjeshRowDetail, error) {
	file, err := s.SanjeshScopedFile(ctx, user, uniCookie, fileID)
	if err != nil {
		return nil, err
	}
	detail := &SanjeshRowDetail{File: file, Fields: []SanjeshFieldRow{}}
	var row SanjeshListRow
	err = s.DB.Pool.QueryRow(ctx, `
		select "id", "rowNo", "fullName", "nationalCode", "nationalCodeValid",
		       "applicantNo", "uniqueId", "studentId", "matchStatus", "matchNote",
		       "dataJson"::text, "rawLine", "rowHash"
		  from "sanjesh_file_rows"
		 where "fileId" = $1 and "id" = $2 limit 1`, fileID, rowID).
		Scan(&row.ID, &row.RowNo, &row.FullName, &row.NationalCode, &row.NationalCodeValid,
			&row.ApplicantNo, &row.UniqueID, &row.StudentID, &row.MatchStatus, &row.MatchNote,
			&detail.DataJSON, &detail.RawLine, &detail.RowHash)
	if err != nil {
		return nil, errors.New("ردیف یافت نشد.")
	}
	detail.Row = &row
	frows, err := s.DB.Pool.Query(ctx, `
		select "id", "colIndex", "sanjeshTitle", "charCount", "targetField",
		       "sampleValue", "observedLength", "isMapped"
		  from "sanjesh_file_fields" where "fileId" = $1 order by "colIndex" asc`, fileID)
	if err != nil {
		return nil, err
	}
	defer frows.Close()
	for frows.Next() {
		var f SanjeshFieldRow
		if err := frows.Scan(&f.ID, &f.ColIndex, &f.SanjeshTitle, &f.CharCount, &f.TargetField,
			&f.SampleValue, &f.ObservedLength, &f.IsMapped); err == nil {
			detail.Fields = append(detail.Fields, f)
		}
	}
	return detail, nil
}

// SanjeshRunMatch port of matchFileRows — match the pending rows of the file
// against the existing students of the SAME university by national code.
func (s *Service) SanjeshRunMatch(ctx context.Context, user *session.User, uniCookie string, fileID int64) (map[string]any, error) {
	if _, err := s.SanjeshScopedFile(ctx, user, uniCookie, fileID); err != nil {
		return nil, err
	}
	var fileUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from "sanjesh_files" where "id" = $1`, fileID).Scan(&fileUni); err != nil {
		return nil, errors.New("فایل یافت نشد.")
	}
	type ncRow struct {
		id int64
		nc *string
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select "id", "nationalCode" from "sanjesh_file_rows"
		 where "fileId" = $1 and "matchStatus" = 'PENDING'`, fileID)
	if err != nil {
		return nil, err
	}
	srcRows := []ncRow{}
	for rows.Next() {
		var r ncRow
		if err := rows.Scan(&r.id, &r.nc); err == nil {
			srcRows = append(srcRows, r)
		}
	}
	rows.Close()

	// Unique codes of this file.
	codes := []string{}
	seenCode := map[string]bool{}
	for _, r := range srcRows {
		if r.nc != nil && *r.nc != "" && !seenCode[*r.nc] {
			seenCode[*r.nc] = true
			codes = append(codes, *r.nc)
		}
	}
	res := map[string]any{"matched": 0, "unmatched": len(srcRows), "ambiguous": 0}
	if fileUni == nil {
		// Fail closed: a file without university scope must not match students
		// across universities.
		return nil, errors.New("دانشگاه فایل نامشخص است.")
	}
	if len(codes) == 0 {
		return res, nil
	}

	// The student national code lives in persons; students joins by personId.
	// University scoping is mandatory — without it a same-code student of
	// another university would be attached here.
	byCode := map[string][]int64{}
	found, err := s.DB.Pool.Query(ctx, `
		select p."canonicalNationalCode", s."id"
		  from "persons" p
		  join "students" s on s."personId" = p."id"
		 where p."canonicalNationalCode" = any($1)
		   and s."universityId" = $2`, codes, *fileUni)
	if err != nil {
		return nil, err
	}
	for found.Next() {
		var nc string
		var sid int64
		if err := found.Scan(&nc, &sid); err == nil {
			byCode[nc] = append(byCode[nc], sid)
		}
	}
	found.Close()

	matched, ambiguous, unmatched := 0, 0, 0
	for _, r := range srcRows {
		var candidates []int64
		if r.nc != nil {
			candidates = byCode[*r.nc]
		}
		switch {
		case len(candidates) == 1:
			if _, err := s.DB.Pool.Exec(ctx, `
				update "sanjesh_file_rows"
				   set "studentId" = $2, "matchStatus" = 'MATCHED', "matchedAt" = now(), "matchNote" = null
				 where "id" = $1`, r.id, candidates[0]); err != nil {
				return nil, err
			}
			matched++
		case len(candidates) > 1:
			note := fmt.Sprintf("%d دانشجو با این کد ملی", len(candidates))
			if _, err := s.DB.Pool.Exec(ctx, `
				update "sanjesh_file_rows" set "matchStatus" = 'DUPLICATE', "matchNote" = $2
				 where "id" = $1`, r.id, note); err != nil {
				return nil, err
			}
			ambiguous++
		default:
			unmatched++
		}
	}
	return map[string]any{"matched": matched, "unmatched": unmatched, "ambiguous": ambiguous}, nil
}

// SanjeshSetRowStatus port of setRowStatusAction — ignore a row / return it to
// the pending pool.
func (s *Service) SanjeshSetRowStatus(ctx context.Context, user *session.User, uniCookie string, fileID, rowID int64, status string) error {
	if _, err := s.SanjeshScopedFile(ctx, user, uniCookie, fileID); err != nil {
		return err
	}
	switch status {
	case "PENDING", "IGNORED", "INVALID":
	default:
		return errors.New("وضعیت نامعتبر است.")
	}
	var note any
	if status == "IGNORED" {
		note = "دستی نادیده گرفته شد"
	}
	tag, err := s.DB.Pool.Exec(ctx, `
		update "sanjesh_file_rows" set "matchStatus" = $3, "matchNote" = $4
		 where "fileId" = $1 and "id" = $2`, fileID, rowID, status, note)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("ردیف یافت نشد.")
	}
	return nil
}

// ─────────────────────────── matched page ───────────────────────────

// SanjeshReadyRow one row ready to be staged to admissions.
type SanjeshReadyRow struct {
	ID           int64   `json:"id"`
	RowNo        int     `json:"rowNo"`
	FullName     *string `json:"fullName"`
	NationalCode *string `json:"nationalCode"`
	StudentID    *int64  `json:"studentId"`
	MatchStatus  string  `json:"matchStatus"`
	MatchedAt    *string `json:"matchedAt"`
}

// SanjeshMatchedView is the payload of the matched page.
type SanjeshMatchedView struct {
	File        *SanjeshFile     `json:"file"`
	Counters    *SanjeshCounters `json:"counters"`
	ReadyRows   []SanjeshReadyRow `json:"readyRows"`
	StagedCount int              `json:"stagedCount"`
	ReadyCount  int              `json:"readyCount"`
}

// SanjeshMatchedView ports the [id]/matched page read — valid rows (PENDING +
// MATCHED) that can enter the admissions queue, capped at 300 like the ref.
func (s *Service) SanjeshMatchedView(ctx context.Context, user *session.User, uniCookie string, fileID int64) (*SanjeshMatchedView, error) {
	file, err := s.SanjeshScopedFile(ctx, user, uniCookie, fileID)
	if err != nil {
		return nil, err
	}
	counters, err := s.SanjeshFileCounters(ctx, fileID)
	if err != nil {
		return nil, err
	}
	view := &SanjeshMatchedView{File: file, Counters: counters, ReadyRows: []SanjeshReadyRow{}}
	rows, err := s.DB.Pool.Query(ctx, `
		select "id", "rowNo", "fullName", "nationalCode", "studentId", "matchStatus", "matchedAt"::text
		  from "sanjesh_file_rows"
		 where "fileId" = $1 and "matchStatus" in ('PENDING','MATCHED')
		 order by "rowNo" asc limit 300`, fileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r SanjeshReadyRow
		if err := rows.Scan(&r.ID, &r.RowNo, &r.FullName, &r.NationalCode, &r.StudentID, &r.MatchStatus, &r.MatchedAt); err == nil {
			view.ReadyRows = append(view.ReadyRows, r)
		}
	}
	if err := s.DB.Pool.QueryRow(ctx, `
		select count(*)::int from "admissions_staging" where "fileId" = $1`, fileID).Scan(&view.StagedCount); err != nil {
		return nil, err
	}
	view.ReadyCount = counters.Pending + counters.Matched
	return view, nil
}

// SanjeshStageResult is the outcome of staging matched rows to admissions.
type SanjeshStageResult struct {
	Staged  int    `json:"staged"`
	Skipped int    `json:"skipped"`
	Message string `json:"message"`
}

// SanjeshStageMatched port of stageMatchedRows — move the valid rows (PENDING
// and MATCHED) into admissions_staging. Matching an existing student is NOT a
// precondition: a fresh applicant has no student yet and must still reach the
// admissions queue. Existing staging rows of the same file are refreshed
// (idempotent) while already-IMPORTED rows stay untouched.
func (s *Service) SanjeshStageMatched(ctx context.Context, user *session.User, uniCookie string, fileID int64) (*SanjeshStageResult, error) {
	// The scoped read doubles as the ownership gate for the writes below.
	file, err := s.SanjeshScopedFile(ctx, user, uniCookie, fileID)
	if err != nil {
		return nil, err
	}
	fileUni, examKind := file.UniversityID, file.ExamKind
	type stageRow struct {
		id         int64
		rowNo      int
		nationalCode *string
		ncEnc      *string
		ncBlind    *string
		studentID  *int64
		fullName   *string
		dataJSON   string
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select "id", "rowNo", "nationalCode", "nationalCodeEnc", "nationalCodeBlindIndex",
		       "studentId", "fullName", "dataJson"::text
		  from "sanjesh_file_rows"
		 where "fileId" = $1 and "matchStatus" in ('PENDING','MATCHED')`, fileID)
	if err != nil {
		return nil, err
	}
	srcRows := []stageRow{}
	for rows.Next() {
		var r stageRow
		if err := rows.Scan(&r.id, &r.rowNo, &r.nationalCode, &r.ncEnc, &r.ncBlind,
			&r.studentID, &r.fullName, &r.dataJSON); err == nil {
			srcRows = append(srcRows, r)
		}
	}
	rows.Close()
	if len(srcRows) == 0 {
		return &SanjeshStageResult{Message: "0 ردیف به پذیرش منتقل شد · 0 از قبل منتقل شده بود"}, nil
	}

	// sanjesh code → internal major mapping (same admissions-engine rule: a
	// mapped row becomes RESOLVED, otherwise it waits in PENDING_MAPPING for
	// the /admin/admissions expert).
	if fileUni == nil {
		return nil, errors.New("دانشگاه فایل نامشخص است.")
	}
	majorByCode := map[string]any{}
	mrows, err := s.DB.Pool.Query(ctx, `
		select "sanjeshCode", "internalMajorId" from "sanjesh_mappings"
		 where ("universityId" = $1 or "universityId" is null)`, *fileUni)
	if err != nil {
		return nil, err
	}
	for mrows.Next() {
		var code string
		var major any
		if err := mrows.Scan(&code, &major); err == nil {
			majorByCode[strings.TrimSpace(code)] = major
		}
	}
	mrows.Close()

	existing := map[int]struct {
		id     int64
		status string
	}{}
	erows, err := s.DB.Pool.Query(ctx, `
		select "id", "rowNo", "status" from "admissions_staging" where "fileId" = $1`, fileID)
	if err != nil {
		return nil, err
	}
	for erows.Next() {
		var id int64
		var rowNo *int
		var status string
		if err := erows.Scan(&id, &rowNo, &status); err == nil && rowNo != nil {
			existing[*rowNo] = struct {
				id     int64
				status string
			}{id, status}
		}
	}
	erows.Close()

	inserted, updated, skipped := 0, 0, 0
	for _, r := range srcRows {
		prev, hasPrev := existing[r.rowNo]
		if hasPrev && prev.status == "IMPORTED" {
			skipped++
			continue
		}
		var payload struct {
			Fields  map[string]string `json:"fields"`
			Columns map[string]string `json:"columns"`
		}
		payload.Fields = map[string]string{}
		payload.Columns = map[string]string{}
		_ = json.Unmarshal([]byte(r.dataJSON), &payload)
		get := func(k string) string {
			return strings.TrimSpace(payload.Fields[k])
		}
		// The accepted-place code is the best key; the old K2K "fieldCode"
		// fallback stays only for legacy templates.
		sanjeshCode := get("fieldPlaceCode")
		if sanjeshCode == "" {
			sanjeshCode = get("fieldCode")
		}
		quota := get("quotaAdmitTitle")
		if quota == "" {
			quota = get("quotaFinalTitle")
		}
		if quota == "" {
			quota = "سهمیه عادی"
		}
		priority := 0.0
		if v := get("priority"); v != "" {
			priority = sanjeshParseFloat(v)
		}
		rawSanjesh := map[string]any{
			"firstName":      get("firstName"),
			"lastName":       get("lastName"),
			"sanjeshCode":    sanjeshCode,
			"quota":          quota,
			"rank":           priority,
			"examType":       strDeref(examKind),
			"degreeLevel":    get("degreeLevelTitle"),
			"majorGroup":     get("fieldTitle"),
			"universityCode": get("universityCode"),
		}
		if priority == 0 {
			delete(rawSanjesh, "rank")
		}
		rawBytes, err := json.Marshal(rawSanjesh)
		if err != nil {
			return nil, err
		}
		profileBytes, err := json.Marshal(map[string]any{"fields": payload.Fields, "columns": payload.Columns})
		if err != nil {
			return nil, err
		}
		mappedMajor, hasMapped := majorByCode[sanjeshCode]
		status := "PENDING_MAPPING"
		if hasMapped && mappedMajor != nil {
			status = "RESOLVED"
		}
		if hasPrev {
			// Keep the manual mapping of the previous run; only upgrade the
			// status when a mapping was found now.
			finalStatus := prev.status
			if status == "RESOLVED" {
				finalStatus = "RESOLVED"
			}
			var majorArg any
			if status == "RESOLVED" {
				majorArg = mappedMajor
			}
			if _, err := s.DB.Pool.Exec(ctx, `
				update "admissions_staging" set
					"nationalCode" = $2, "nationalCodeEnc" = $3, "nationalCodeBlindIndex" = $4,
					"rawSanjeshData" = $5, "profileJson" = $6, "fullName" = $7, "mobile" = $8,
					"studentId" = $9, "mappedMajorId" = coalesce($10, "mappedMajorId"), "status" = $11,
					"universityId" = $12, "matchedAt" = now()
				 where "id" = $1`,
				prev.id, strDeref(r.nationalCode), r.ncEnc, r.ncBlind,
				string(rawBytes), string(profileBytes), r.fullName, mobileArgOf(get("mobile")),
				r.studentID, majorArg, finalStatus, fileUni); err != nil {
				return nil, err
			}
			updated++
			continue
		}
		var majorArg any
		if status == "RESOLVED" {
			majorArg = mappedMajor
		}
		if _, err := s.DB.Pool.Exec(ctx, `
			insert into "admissions_staging"
				("nationalCode", "nationalCodeEnc", "nationalCodeBlindIndex", "rawSanjeshData",
				 "profileJson", "fullName", "mobile", "studentId", "mappedMajorId", "status",
				 "fileId", "rowNo", "matchedAt", "universityId")
			 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$13)`,
			strDeref(r.nationalCode), r.ncEnc, r.ncBlind, string(rawBytes),
			string(profileBytes), r.fullName, mobileArgOf(get("mobile")), r.studentID, majorArg, status,
			fileID, r.rowNo, fileUni); err != nil {
			return nil, err
		}
		inserted++
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		update "sanjesh_files" set "status" = 'STAGED', "updatedAt" = now() where "id" = $1`, fileID); err != nil {
		return nil, err
	}
	staged := inserted + updated
	return &SanjeshStageResult{
		Staged:  staged,
		Skipped: skipped,
		Message: fmt.Sprintf("%d ردیف به پذیرش منتقل شد · %d از قبل منتقل شده بود", staged, skipped),
	}, nil
}

func strDeref(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// mobileArgOf turns the trimmed mobile field into a nullable bind value.
func mobileArgOf(v string) any {
	if v == "" {
		return nil
	}
	return v
}

func sanjeshParseFloat(v string) float64 {
	var f float64
	for _, ch := range strings.TrimSpace(v) {
		if ch >= '0' && ch <= '9' {
			f = f*10 + float64(ch-'0')
		} else {
			return 0
		}
	}
	return f
}

// ─────────────────────────── enrolled page ───────────────────────────

// SanjeshStagedRow one admissions_staging row of this file.
type SanjeshStagedRow struct {
	ID                   int64   `json:"id"`
	RowNo                *int    `json:"rowNo"`
	FullName             *string `json:"fullName"`
	NationalCode         *string `json:"nationalCode"`
	StudentID            *int64  `json:"studentId"`
	Status               *string `json:"status"`
	OnboardingStatus     *string `json:"onboardingStatus"`
	AssignedStudentCode  *string `json:"assignedStudentCode"`
	StudentCode          *string `json:"studentCode"`
	MatchedAt            *string `json:"matchedAt"`
}

// SanjeshEnrolledView is the payload of the enrolled page (cap 500 like ref).
type SanjeshEnrolledView struct {
	File     *SanjeshFile       `json:"file"`
	Staged   []SanjeshStagedRow `json:"staged"`
	WithCode int                `json:"withCode"`
}

// SanjeshEnrolledView ports the [id]/enrolled page read — rows handed over to
// the admissions workspace, joined to students for the final student code.
func (s *Service) SanjeshEnrolledView(ctx context.Context, user *session.User, uniCookie string, fileID int64) (*SanjeshEnrolledView, error) {
	file, err := s.SanjeshScopedFile(ctx, user, uniCookie, fileID)
	if err != nil {
		return nil, err
	}
	view := &SanjeshEnrolledView{File: file, Staged: []SanjeshStagedRow{}}
	rows, err := s.DB.Pool.Query(ctx, `
		select g."id", g."rowNo", g."fullName", g."nationalCode", g."studentId", g."status",
		       g."onboardingStatus", g."assignedStudentCode", st."studentCode", g."matchedAt"::text
		  from "admissions_staging" g
		  left join "students" st on st."id" = g."studentId"
		 where g."fileId" = $1
		 order by g."rowNo" asc limit 500`, fileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r SanjeshStagedRow
		if err := rows.Scan(&r.ID, &r.RowNo, &r.FullName, &r.NationalCode, &r.StudentID, &r.Status,
			&r.OnboardingStatus, &r.AssignedStudentCode, &r.StudentCode, &r.MatchedAt); err == nil {
			if (r.StudentCode != nil && *r.StudentCode != "") || (r.AssignedStudentCode != nil && *r.AssignedStudentCode != "") {
				view.WithCode++
			}
			view.Staged = append(view.Staged, r)
		}
	}
	return view, nil
}

// ─────────────────────────── values page ───────────────────────────

// SanjeshValueMapRow one row of the decode/value-map table.
type SanjeshValueMapRow struct {
	ID            int64   `json:"id"`
	Field         string  `json:"field"`
	SanjeshValue  string  `json:"sanjeshValue"`
	SanjeshLabel  *string `json:"sanjeshLabel"`
	InternalValue *string `json:"internalValue"`
	InternalLabel *string `json:"internalLabel"`
}

// SanjeshValuesView is the payload of the values page.
type SanjeshValuesView struct {
	File *SanjeshFile         `json:"file"`
	Maps []SanjeshValueMapRow `json:"maps"`
}

// SanjeshValuesView ports the [id]/values page read.
func (s *Service) SanjeshValuesView(ctx context.Context, user *session.User, uniCookie string, fileID int64) (*SanjeshValuesView, error) {
	file, err := s.SanjeshScopedFile(ctx, user, uniCookie, fileID)
	if err != nil {
		return nil, err
	}
	view := &SanjeshValuesView{File: file, Maps: []SanjeshValueMapRow{}}
	rows, err := s.DB.Pool.Query(ctx, `
		select "id", "field", "sanjeshValue", "sanjeshLabel", "internalValue", "internalLabel"
		  from "sanjesh_value_maps"
		 where "fileId" = $1
		 order by "field" asc, "sanjeshValue" asc`, fileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m SanjeshValueMapRow
		if err := rows.Scan(&m.ID, &m.Field, &m.SanjeshValue, &m.SanjeshLabel, &m.InternalValue, &m.InternalLabel); err == nil {
			view.Maps = append(view.Maps, m)
		}
	}
	return view, nil
}

// SanjeshSaveValueMap port of saveValueMapAction — upsert one decode row on
// (fileId, field, sanjeshValue).
func (s *Service) SanjeshSaveValueMap(ctx context.Context, user *session.User, uniCookie string, fileID int64, field, sanjeshValue string, sanjeshLabel, internalValue, internalLabel *string) error {
	if _, err := s.SanjeshScopedFile(ctx, user, uniCookie, fileID); err != nil {
		return err
	}
	field, sanjeshValue = strings.TrimSpace(field), strings.TrimSpace(sanjeshValue)
	if field == "" || sanjeshValue == "" {
		return errors.New("فیلد و مقدار سنجش الزامی است.")
	}
	var fileUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from "sanjesh_files" where "id" = $1`, fileID).Scan(&fileUni); err != nil {
		return errors.New("فایل یافت نشد.")
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		insert into "sanjesh_value_maps"
			("fileId", "universityId", "field", "sanjeshValue", "sanjeshLabel", "internalValue", "internalLabel")
		 values ($1,$2,$3,$4,$5,$6,$7)
		 on conflict ("fileId", "field", "sanjeshValue")
		 do update set "sanjeshLabel" = excluded."sanjeshLabel",
		               "internalValue" = excluded."internalValue",
		               "internalLabel" = excluded."internalLabel"`,
		fileID, fileUni, field, sanjeshValue, sanjeshLabel, internalValue, internalLabel); err != nil {
		return err
	}
	return nil
}

// SanjeshDeleteValueMap port of deleteValueMapAction.
func (s *Service) SanjeshDeleteValueMap(ctx context.Context, user *session.User, uniCookie string, fileID, id int64) error {
	if _, err := s.SanjeshScopedFile(ctx, user, uniCookie, fileID); err != nil {
		return err
	}
	tag, err := s.DB.Pool.Exec(ctx, `
		delete from "sanjesh_value_maps" where "id" = $1 and "fileId" = $2`, id, fileID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("ردیف براورد یافت نشد.")
	}
	return nil
}

// SanjeshSeedValueMapsFromTemplate port of seedValueMapsFromTemplateAction —
// fill the decode table from the template's decodeTables (idempotent).
func (s *Service) SanjeshSeedValueMapsFromTemplate(ctx context.Context, user *session.User, uniCookie string, fileID int64) (map[string]any, error) {
	file, err := s.SanjeshScopedFile(ctx, user, uniCookie, fileID)
	if err != nil {
		return nil, err
	}
	if file.TemplateKey == nil || strings.TrimSpace(*file.TemplateKey) == "" {
		return nil, errors.New("فایل قالب ندارد.")
	}
	uniID := s.UniversityID(ctx, user, uniCookie)
	tpl, err := s.SanjeshLoadTemplateByKey(ctx, *file.TemplateKey, *uniID)
	if err != nil {
		return nil, err
	}
	if tpl == nil {
		return nil, errors.New("قالب یافت نشد.")
	}
	count := 0
	for field, entries := range tpl.DecodeTables {
		for _, e := range entries {
			var internalValue any
			if e.InternalValue != nil {
				internalValue = *e.InternalValue
			}
			if _, err := s.DB.Pool.Exec(ctx, `
				insert into "sanjesh_value_maps"
					("fileId", "universityId", "field", "sanjeshValue", "sanjeshLabel", "internalValue", "internalLabel")
				 values ($1,$2,$3,$4,$5,$6,$5)
				 on conflict ("fileId", "field", "sanjeshValue") do nothing`,
				fileID, file.UniversityID, field, e.Value, e.Label, internalValue); err != nil {
				return nil, err
			}
			count++
		}
	}
	return map[string]any{
		"count":   count,
		"message": fmt.Sprintf("%d ردیف براورد از قالب «%s» بررسی/درج شد.", count, tpl.Key),
	}, nil
}

// ─────────────────────────── template from file ───────────────────────────

// SanjeshParseLite is the minimal file survey used to build a template from a
// sample file: column count, observed lengths and first non-empty samples.
type SanjeshParseLite struct {
	Encoding        string            `json:"encoding"`
	RowCount        int               `json:"rowCount"`
	ColCount        int               `json:"colCount"`
	ObservedLengths map[string]int    `json:"observedLengths"`
	Samples         map[string]string `json:"samples"`
}

// sanjeshDecodeBuffer port of decodeSanjeshBuffer — UTF-16LE with BOM, UTF-8
// with BOM, zero-byte heuristic for UTF-16LE, Windows-1256 fallback.
func sanjeshDecodeBuffer(buf []byte) (string, string) {
	switch {
	case len(buf) >= 2 && buf[0] == 0xff && buf[1] == 0xfe:
		return sanjeshUTF16Decode(buf[2:]), "utf-16le"
	case len(buf) >= 3 && buf[0] == 0xef && buf[1] == 0xbb && buf[2] == 0xbf:
		return string(buf[3:]), "utf-8"
	}
	oddZeros := 0
	probe := len(buf)
	if probe > 2048 {
		probe = 2048
	}
	for i := 1; i < probe; i += 2 {
		if buf[i] == 0 {
			oddZeros++
		}
	}
	if probe > 20 && oddZeros > probe/4 {
		return sanjeshUTF16Decode(buf), "utf-16le"
	}
	// windows-1256 — Go has no windows-1256 decoder in the stdlib; latin-1 is
	// the safe byte-for-byte fallback (the raw line stays untouched either way).
	return string(buf), "windows-1256"
}

func sanjeshUTF16Decode(buf []byte) string {
	units := make([]uint16, 0, len(buf)/2)
	for i := 0; i+1 < len(buf); i += 2 {
		units = append(units, uint16(buf[i])|uint16(buf[i+1])<<8)
	}
	runes := utf16.Decode(units)
	return string(runes)
}

// SanjeshParseFileLite ports the survey pass of parseSanjeshFile (first pass
// only — column count from the file itself, observed lengths, samples).
func SanjeshParseFileLite(buf []byte, separator string) *SanjeshParseLite {
	if separator == "" {
		separator = "$"
	}
	text, encoding := sanjeshDecodeBuffer(buf)
	res := &SanjeshParseLite{
		Encoding:        encoding,
		ObservedLengths: map[string]int{},
		Samples:         map[string]string{},
	}
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, separator)
		// A trailing separator produces an empty last part — drop it.
		if len(parts) > 1 && strings.TrimSpace(parts[len(parts)-1]) == "" {
			parts = parts[:len(parts)-1]
		}
		if len(parts) > res.ColCount {
			res.ColCount = len(parts)
		}
		res.RowCount++
		for i, raw := range parts {
			col := fmt.Sprintf("%d", i+1)
			trimmed := strings.TrimSpace(raw)
			l := len(strings.TrimRight(raw, " \t"))
			if l > res.ObservedLengths[col] {
				res.ObservedLengths[col] = l
			}
			if trimmed != "" {
				if _, ok := res.Samples[col]; !ok {
					res.Samples[col] = trimmed
				}
			}
		}
	}
	return res
}

// SanjeshBuildTemplateFromFile port of buildTemplateFromFileAction — survey a
// sample file and create a template with generic columns; the expert then sets
// the destination fields in the editor.
func (s *Service) SanjeshBuildTemplateFromFile(ctx context.Context, user *session.User, uniCookie, fileName, key, title, examKind string, examYear int, buf []byte) (*SanjeshTemplate, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	key, title, examKind = strings.TrimSpace(key), strings.TrimSpace(title), strings.TrimSpace(examKind)
	if len(buf) == 0 {
		return nil, errors.New("فایل انتخاب نشده است.")
	}
	if key == "" || title == "" || examYear <= 0 {
		return nil, errors.New("کلید، عنوان و سال قالب الزامی است.")
	}
	if !sanjeshTemplateKeyRe.MatchString(key) {
		return nil, errors.New("کلید قالب فقط حروف بزرگ انگلیسی، رقم و زیرخط.")
	}
	if examKind == "" {
		examKind = "CUSTOM"
	}
	if exists, err := s.sanjeshTemplateKeyExists(ctx, key, *uniID); err != nil {
		return nil, err
	} else if exists {
		return nil, fmt.Errorf("کلید «%s» قبلاً استفاده شده است.", key)
	}
	parsed := SanjeshParseFileLite(buf, "$")
	if parsed.ColCount == 0 {
		return nil, errors.New("فایل هیچ ستونی ندارد.")
	}
	cols := make([]SanjeshTemplateColumnInput, 0, parsed.ColCount)
	for c := 1; c <= parsed.ColCount; c++ {
		sample := parsed.Samples[fmt.Sprintf("%d", c)]
		t := fmt.Sprintf("ستون %d", c)
		if sample != "" {
			r := []rune(sample)
			if len(r) > 40 {
				r = r[:40]
			}
			t = fmt.Sprintf("ستون %d — %s", c, string(r))
		}
		cols = append(cols, SanjeshTemplateColumnInput{ColIndex: c, SanjeshTitle: t, CharCount: parsed.ObservedLengths[fmt.Sprintf("%d", c)], TargetField: ""})
	}
	notes := fmt.Sprintf("ساخته‌شده از فایل «%s» (%d ردیف، %d ستون).", fileName, parsed.RowCount, parsed.ColCount)
	tpl, err := s.SanjeshSaveTemplate(ctx, user, uniCookie, &SanjeshSaveTemplateInput{
		Key: key, Title: title, ExamKind: examKind, ExamYear: examYear, Columns: cols, Notes: &notes,
	})
	if err != nil {
		return nil, err
	}
	return tpl, nil
}
