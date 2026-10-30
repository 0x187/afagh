// ═══ گزارش سالانهٔ «سهام» (IRPHE — saham.irphe.ac.ir) ═══
//
//	پورت admin/saham + lib/saham/*:
//	  • آمار دانشگاه‌ها و درصد پر بودن ستون‌های تازهٔ سهام (page.tsx)
//	  • لوک‌آپ‌های فیلتر (وضعیت/رشته/دانشکده/ترم/سال ورود)
//	  • خروجی رسمی CSV با همان ستون‌های فایل‌های 1-Student / 2-Graduate /
//	    3-TeachingStaff و شیت نظام وظیفه — mapping عیناً از student-rows.ts و
//	    graduate-rows.ts و instructor-rows.ts و فهرست‌های بستهٔ codes.ts
//	  • تنظیمات کد مؤسسه (CRUD saham_institute_codes — settings/actions.ts)
//
//	انحراف آگاهانه: خروجی اکسل Next با CSV UTF-8 (BOM) جایگزین شده — بکند Go
//	کتابخانهٔ xlsx ندارد و «ستون‌های متنی» سهام در CSV هم حفظ می‌شوند.
package admin

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"backend-go/internal/session"
)

// ═══════════════ فهرست‌های بستهٔ رسمی سهام (پورت codes.ts) ═══════════════

var sahamClosedLists = map[string][]string{
	"teaching_mode":    {"حضوری", "نیمه حضوری", "غیر حضوری"},
	"study_type":       {"روزانه", "شبانه", "پرديس", "فراگير", "پودماني", "نيمه حضوري", "الكترونيكي", "مشترك", "روزانه - بورس دانش", "روزانه - بورس صنعت و مشاغل", "دانشجوي غيرايراني (جذب از طريق فراخوان)"},
	"degree":           {"کاردانی", "کارشناسی", "کارشناسی ناپیوسته", "کارشناسی ارشد", "کارشناسی ارشد پیوسته", "دکتری عمومی (حرفه‌ای)", "دستیاری تخصصی بالینی", "دستیاری تخصصی(علوم پایه پزشکی، داروسازی و دندانپزشکی)", "دکتری تخصصی(PhD )", "دکتری تخصصی(PhD ) پیوسته", "فوق تخصصی", "دوره فلوشیپ", "دوره MPH", "دانشوری", "سایر"},
	"student_status":   {"فعال", "غیرفعال - اخراج", "غیرفعال - انصراف ( ترک تحصیل )", "غیرفعال - فارغ التحصیل ( دانش آموخته )", "غیرفعال - محروم از تحصیل", "غیرفعال - فوت", "غیرفعال - بلا تکلیف", "غیرفعال - سایر"},
	"term_status":      {"در حال تحصیل", "تعلیق با احتساب سنوات", "تعلیق بدون احتساب سنوات", "ثبت نام نکرده", "حذف ترم", "حذف ترم با احتساب سنوات", "حذف ترم بدون احتساب سنوات", "عدم مراجعه", "محروم از تحصیل", "مرخصی با احتساب سنوات", "مرخصی بدون احتساب سنوات", "منع موقت آموزشی", "منع موقت با احتساب در سنوات", "منع موقت بدون احتساب در سنوات", "وقفه تحصیلی", "وقفه تحصیلی بدون احتساب سنوات", "وقفه تحصیلی با احتساب سنوات", "بلا تکلیف", "سایر"},
	"transfer_guest":   {"انتقال از سایر دانشگاهها ( انتقالی از )", "انتقال از سایر دانشگاهها توام با تغییر رشته", "انتقال به سایر دانشگاهها ( انتقالی به )", "انتقال به سایر دانشگاهها توام با تغییر رشته", "جابجایی از سایر دانشگاهها", "جابجایی به سایر دانشگاهها", "میهمان از سایر دانشگاهها", "میهمان به سایر دانشگاهها", "انتقال از خارج", "انتقال فرزند هیات علمی"},
	"scholarship":      {"بورس داخل - بورسيه وزارت علوم", "بورس داخل - بورسيه سازمان هاي دولتي ( به غير از وزارت علوم )", "بورس داخل - بورسيه سازمان هاي غير دولتي", "بورس خارج", "تبديل بورس خارج به داخل", "بورس مربي", "بورسيه ترددي", "ندارد", "بورس دانشجويان غير ايراني", "بورس دانش", "بورس صنعت و مشاغل", "بورس وطن", "بورس سرامدان", "بورس ابرار", "بورس بنگاههاي اقتصادي"},
	"admission_type":   {"از طريق آزمون ورودي سازمان سنجش آموزش كشور", "از طريق آزمون ورودي وزارت بهداشت، درمان و آموزش پزشكي", "از طريق آزمون ورودي دانشگاه آزاد اسلامي", "از طريق آزمون ورودي اختصاصي دانشگاهها", "از طريق آزمون ورودي سازمان سنجش آموزش كشور - صرفا با سوابق تحصيلي (بدون آزمون)", "استعداد درخشان، ممتاز، نفر اول دوره قبلي و . . .", "دانشپذيري", "ساير", "غيربورسيه خارجي", "از طريق آزمون ورودي سازمان سنجش آموزش كشور - با آزمون", "دكتري استاد محور", "دانشجوي غيرايراني (جذب از طريق فراخوان)", "دكتري پژوهش محور", "دكتري آموزشي - پژوهشي", "پذيرش دانشجو - معلم", "دانشجوي غيرايراني (جذب از طريق سازمان سنجش)"},
	"admission_method": {"متمرکز", "نیمه متمرکز"},
	"quota":            {"منطقه يك", "منطقه دو", "منطقه سه", "مناطق", "مناطق محروم", "خانواده شهدا ( پدر، مادر، خواهر و برادر شهيد )", "جانبازان انقلاب اسلامي", "شاهد يا ايثارگر", "رزمندگان", "آزادگان", "ساير", "مربي", "استعداد درخشان، ممتاز، نفر اول دوره قبلي و . . .", "آزاد", "جانباز 25% و بالاتر", "فرزند جانباز 25% و بالاتر", "همسر جانباز 25% و بالاتر", "فرزند آزاده", "همسر آزاده", "فرزند شهيد و مفقودالاثر", "همسر شهيد و مفقودالاثر", "رزمنده داوطلب بسيجي", "رزمنده وزارت جهاد كشاورزي", "رزمنده ستاد كل نيروهاي مسلح", "جانباز كمتر از 25%", "فرزند جانباز كمتر از 25%", "همسر جانباز كمتر از 25%", "فرزند رزمنده داوطلب بسيجي", "فرزند رزمنده وزارت جهاد كشاورزي", "فرزند رزمنده ستاد كل نيروهاي مسلح", "همسر رزمنده داوطلب بسيجي", "همسر رزمنده وزارت جهاد كشاورزي", "همسر رزمنده ستاد كل نيروهاي مسلح"},
	"tuition_payment":  {"رایگان", "پرداخت شهریه توسط دانشجو", "پرداخت شهریه توسط وزارت علوم ( بورسیه )", "پرداخت شهریه توسط سازمان های دولتی ( به غیر از وزارت علوم )", "پرداخت شهریه توسط سازمان های غیر دولتی"},
	"last_degree":      {"زير ديپلم", "ديپلم", "كارداني", "كارشناسي", "كارشناسي ناپيوسته", "كارشناسي ارشد", "كارشناسي ارشد پيوسته", "دكتري عمومي (حرفه اي)", "دستياري تخصصي باليني", "دستياري تخصصي ناپيوسته", "دستياري تخصصي پيوسته", "دكتري تخصصي(PhD)", "دكتري تخصصي(PhD) پيوسته", "فوق تخصصي", "دوره فلوشيپ", "دوره MPH", "دانشوري", "خبرگان", "ساير"},
	"employment_type":  {"شركتي", "قراردادي", "سربازي", "پيماني", "تعهد خدمت", "رسمي آزمايشي", "رسمي قطعي", "استاد مدعو"},
	"academic_rank":    {"استاد", "دانشیار", "استادیار", "مربی", "مربی آموزشیار", "سایر"},
	"activity_field":   {"اداري، مالي، پشتيباني", "آموزشي و پژوهشي", "دانشجويي و فرهنگي", "کتابخانه و انتشارات", "آزمايشگاه و رايانه", "ساير"},
	"service_type":     {"شاغل تمام وقت", "شاغلين غير تمام وقت", "اشتغال به كار", "مرخصي با حقوق", "مرخصي بدون حقوق", "مأمور از ساير دانشگاه ها", "مأمور به ساير دانشگاه ها", "مأموريت تحصيلي تمام وقت", "مأموريت تحصيلي نيمه وقت", "آماده به خدمت", "پايان مأموريت", "انتقال"},
}

// sahamStatusCode کد وضعیت کلی دانشجو (پورت C_student_status_code).
var sahamStatusCode = map[string]string{
	"ACTIVE": "1", "EXPELLED": "2", "WITHDRAWN": "3", "TRANSFERRED": "3",
	"GRADUATED": "4", "SUSPENDED": "5", "DECEASED": "6", "NO_SHOW": "7", "UNKNOWN": "8",
}

// sahamNormFa یکسان‌سازی ی/ک عربی و فارسی برای مقایسه (پورت normFa در codes.ts).
func sahamNormFa(s string) string {
	s = strings.NewReplacer(
		"\u06CC", "\u064A", "\u0649", "\u064A", // ی ى → ي
		"\u06A9", "\u0643", // ک → ك
		"\u200C", "", // نیم‌فاصله
	).Replace(s)
	return strings.Join(strings.Fields(s), " ")
}

var sahamNormCache = map[string]map[string]string{}

func sahamNormList(field string) map[string]string {
	if m, ok := sahamNormCache[field]; ok {
		return m
	}
	m := map[string]string{}
	for _, v := range sahamClosedLists[field] {
		m[sahamNormFa(v)] = v
	}
	sahamNormCache[field] = m
	return m
}

// SahamMapClosed نگاشت امن ستون‌های فهرست‌بسته (پورت mapSahamClosed):
// ۱) نگاشت داخلی saham_value_maps ۲) تطابق با املای رسمی ۳) ” (هرگز کد داخلی).
func SahamMapClosed(maps map[string]map[string]string, field string, value any) string {
	if value == nil {
		return ""
	}
	v := strings.TrimSpace(fmt.Sprint(value))
	if v == "" {
		return ""
	}
	if fm, ok := maps[field]; ok {
		if mapped, ok2 := fm[v]; ok2 {
			return mapped
		}
		if mapped, ok2 := fm[sahamNormFa(v)]; ok2 {
			return mapped
		}
	}
	list, ok := sahamClosedLists[field]
	if !ok {
		return ""
	}
	for _, x := range list {
		if x == v {
			return v
		}
	}
	if near, ok := sahamNormList(field)[sahamNormFa(v)]; ok {
		return near
	}
	return ""
}

// SahamMapValue نگاشت ساده؛ اگر نگاشتی نبود خودِ مقدار برمی‌گردد.
func SahamMapValue(maps map[string]map[string]string, field string, value any) string {
	if value == nil {
		return ""
	}
	v := strings.TrimSpace(fmt.Sprint(value))
	if v == "" {
		return ""
	}
	if fm, ok := maps[field]; ok {
		if mapped, ok2 := fm[v]; ok2 {
			return mapped
		}
	}
	return v
}

// SahamLoadValueMaps همهٔ نگاشت‌های فعال (پورت loadSahamValueMaps).
func (s *Service) SahamLoadValueMaps(ctx context.Context) map[string]map[string]string {
	out := map[string]map[string]string{}
	rows, err := s.DB.Pool.Query(ctx, `select "field", "sourceValue", "sahamTitle" from saham_value_maps where "isActive" = 1`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var field, src, title string
		if rows.Scan(&field, &src, &title) == nil {
			if out[field] == nil {
				out[field] = map[string]string{}
			}
			out[field][src] = title
		}
	}
	return out
}

// SahamGeoTitles نام استان/شهر از جدول‌های geo (پورت loadGeoTitles).
type SahamGeoTitles struct {
	Province   map[string]string
	City       map[string]string
	CityScoped map[string]string
}

func (s *Service) SahamLoadGeoTitles(ctx context.Context) (*SahamGeoTitles, error) {
	geo := &SahamGeoTitles{Province: map[string]string{}, City: map[string]string{}, CityScoped: map[string]string{}}
	prows, err := s.DB.Pool.Query(ctx, `select "code", "title" from geo_provinces`)
	if err != nil {
		return geo, nil
	}
	for prows.Next() {
		var code, title string
		if prows.Scan(&code, &title) == nil {
			geo.Province[code] = title
		}
	}
	prows.Close()
	crows, err := s.DB.Pool.Query(ctx, `select "provinceCode", "code", "title" from geo_cities`)
	if err != nil {
		return geo, nil
	}
	for crows.Next() {
		var pc, code, title string
		if crows.Scan(&pc, &code, &title) == nil {
			geo.City[code] = title
			geo.CityScoped[pc+":"+code] = title
		}
	}
	crows.Close()
	return geo, nil
}

func sahamCityTitle(geo *SahamGeoTitles, provinceCode, cityCode *string) string {
	if provinceCode == nil || cityCode == nil || *provinceCode == "" || *cityCode == "" {
		return ""
	}
	return geo.CityScoped[*provinceCode+":"+*cityCode]
}

// SahamInstituteCode سطر کد واحد سهام.
type SahamInstituteCode struct {
	UniversityID int64
	FacultyID    *int64
	Title        string
	Code         string
	ProvinceCode *string
	CityCode     *string
	IsDefault    int
}

// SahamLoadInstituteCodes کدهای فعال هر دانشگاه (پورت loadSahamInstituteCodes).
func (s *Service) SahamLoadInstituteCodes(ctx context.Context) map[int64][]SahamInstituteCode {
	out := map[int64][]SahamInstituteCode{}
	rows, err := s.DB.Pool.Query(ctx, `
		select "universityId", "facultyId", title, code, "provinceCode", "cityCode", coalesce("isDefault",0)
		  from saham_institute_codes where "isActive" = 1`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r SahamInstituteCode
		if rows.Scan(&r.UniversityID, &r.FacultyID, &r.Title, &r.Code, &r.ProvinceCode, &r.CityCode, &r.IsDefault) == nil {
			out[r.UniversityID] = append(out[r.UniversityID], r)
		}
	}
	return out
}

// SahamPickCode انتخاب سطر کد سهام برای دانشگاه+دانشکده — فقط تطبیق دقیق.
func SahamPickCode(byUni map[int64][]SahamInstituteCode, universityID int64, facultyID *int64) *SahamInstituteCode {
	list, ok := byUni[universityID]
	if !ok || len(list) == 0 || facultyID == nil {
		return nil
	}
	for i := range list {
		if list[i].FacultyID != nil && *list[i].FacultyID == *facultyID {
			return &list[i]
		}
	}
	return nil
}

// SahamBirthYear سال تولد شمسی از تاریخ میلادی ISO (پورت sahamBirthYear).
func SahamBirthYear(iso *string) string {
	if iso == nil || *iso == "" {
		return ""
	}
	m := regexp.MustCompile(`^(\d{4})`).FindStringSubmatch(*iso)
	return jalaliYearPrefix(m)
}

// jalaliYearPrefix سال شمسی چهاررقمی از سال میلادی (تقریب کافی برای ستون «سال تولد»).
func jalaliYearPrefix(m []string) string {
	if m == nil {
		return ""
	}
	gy, err := strconv.Atoi(m[1])
	if err != nil || gy < 1900 {
		return ""
	}
	// تبدیل تقریبی: سال جلالی ≈ میلادی − 621/622 بر پایهٔ ماه
	jy := gy - 622
	if jy < 1 {
		return ""
	}
	return strconv.Itoa(jy)
}

// SahamEntryYear سال ورود سهام — سه رقم آخر سال + نیمسال (پورت sahamEntryYear).
func SahamEntryYear(entryYear *int64, entryTerm *int64) string {
	if entryYear == nil {
		return ""
	}
	sem := "1"
	if entryTerm != nil && *entryTerm == 2 {
		sem = "2"
	}
	return fmt.Sprintf("%d%s", *entryYear%1000, sem)
}

// SahamGradTermFromDate نیمسال فارغ‌التحصیلی از تاریخ فراغت جلالی (پورت sahamGradTermFromDate).
func SahamGradTermFromDate(d *string) string {
	if d == nil || *d == "" {
		return ""
	}
	m := regexp.MustCompile(`^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$`).FindStringSubmatch(strings.TrimSpace(*d))
	if m == nil {
		return *d
	}
	year, _ := strconv.Atoi(m[1])
	month, _ := strconv.Atoi(m[2])
	sem := 2
	switch {
	case month >= 7:
		sem = 1
	case month >= 5:
		sem = 3
	}
	return fmt.Sprintf("%d%d", year%1000, sem)
}

var sahamNativeMap = map[string]string{"1": "بومی", "2": "غیربومی"}

// SahamNative نگاشت بومی/غیربومی (پورت sahamNative).
func SahamNative(v *string) string {
	if v == nil {
		return ""
	}
	t := strings.TrimSpace(*v)
	if mapped, ok := sahamNativeMap[t]; ok {
		return mapped
	}
	return t
}

// ═══════════════ آمار و لوک‌آپ‌ها (پورت page.tsx) ═══════════════

// SahamStats آمار یک دانشگاه برای صفحهٔ سهام.
type SahamStats struct {
	UniversityID   int64          `json:"universityId"`
	Code           string         `json:"code"`
	Title          string         `json:"title"`
	IsDissolved    bool           `json:"isDissolved"`
	Students       int            `json:"students"`
	Graduates      int            `json:"graduates"`
	Instructors    int            `json:"instructors"`
	SahamCodeCount int            `json:"sahamCodeCount"`
	Fill           SahamFillStats `json:"fill"`
}

type SahamFillStats struct {
	StudyType         int `json:"studyType"`
	TeachingMode      int `json:"teachingMode"`
	MaritalStatus     int `json:"maritalStatus"`
	BirthProvince     int `json:"birthProvince"`
	ResidenceProvince int `json:"residenceProvince"`
}

// GetSahamStats آمار همهٔ دانشگاه‌های فعال.
func (s *Service) GetSahamStats(ctx context.Context) ([]SahamStats, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		SELECT u.id, u.code, u.title, u.kind,
		  (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id) AS students,
		  (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id AND s.status = 'GRADUATED') AS graduates,
		  (SELECT count(*)::int FROM staff st WHERE st."universityId" = u.id) AS instructors,
		  (SELECT count(*)::int FROM saham_institute_codes c
		    WHERE c."universityId" = u.id AND c."isActive" = 1) AS saham_codes,
		  (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id AND s."studyType"     IS NOT NULL) AS study_type,
		  (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id AND s."teachingMode"  IS NOT NULL) AS teaching_mode,
		  (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id AND s."maritalStatus" IS NOT NULL) AS marital_status,
		  (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id AND s."birthProvince"  IS NOT NULL) AS birth_province,
		  (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id AND s."residenceProvince" IS NOT NULL) AS residence_province
		FROM universities u
		WHERE u."isActive" = 1
		ORDER BY u.id`)
	if err != nil {
		return []SahamStats{}, err
	}
	defer rows.Close()
	out := []SahamStats{}
	for rows.Next() {
		var r SahamStats
		var kind string
		if err := rows.Scan(&r.UniversityID, &r.Code, &r.Title, &kind, &r.Students, &r.Graduates,
			&r.Instructors, &r.SahamCodeCount, &r.Fill.StudyType, &r.Fill.TeachingMode,
			&r.Fill.MaritalStatus, &r.Fill.BirthProvince, &r.Fill.ResidenceProvince); err == nil {
			r.IsDissolved = kind == "DISSOLVED"
			out = append(out, r)
		}
	}
	return out, rows.Err()
}

// SahamLookups لوک‌آپ‌های فیلتر (پورت SahamFilterLookups).
type SahamLookups struct {
	Statuses   []map[string]any `json:"statuses"`
	Majors     []map[string]any `json:"majors"`
	Faculties  []map[string]any `json:"faculties"`
	Terms      []map[string]any `json:"terms"`
	EntryYears []map[string]any `json:"entryYears"`
}

// GetSahamLookups لوک‌آپ‌های سبک فیلتر.
func (s *Service) GetSahamLookups(ctx context.Context) (*SahamLookups, error) {
	out := &SahamLookups{
		Statuses: []map[string]any{}, Majors: []map[string]any{}, Faculties: []map[string]any{},
		Terms: []map[string]any{}, EntryYears: []map[string]any{},
	}
	srows, err := s.DB.Pool.Query(ctx, `
		SELECT s."universityId", s.status, count(*)::int AS n
		FROM students s GROUP BY 1, 2 ORDER BY 1, 3 DESC`)
	if err != nil {
		return out, nil
	}
	for srows.Next() {
		var uni int64
		var status string
		var n int
		if srows.Scan(&uni, &status, &n) == nil {
			out.Statuses = append(out.Statuses, map[string]any{"universityId": uni, "status": status, "n": n})
		}
	}
	srows.Close()

	mrows, err := s.DB.Pool.Query(ctx, `SELECT m."universityId", m.id, m."name", m."facultyId" FROM majors m ORDER BY m."universityId", m."name"`)
	if err == nil {
		for mrows.Next() {
			var uni, id int64
			var name string
			var fid *int64
			if mrows.Scan(&uni, &id, &name, &fid) == nil {
				out.Majors = append(out.Majors, map[string]any{"universityId": uni, "id": id, "name": name, "facultyId": fid})
			}
		}
		mrows.Close()
	}

	frows, err := s.DB.Pool.Query(ctx, `SELECT f."universityId", f.id, f."name" FROM faculties f ORDER BY f."universityId", f."name"`)
	if err == nil {
		for frows.Next() {
			var uni, id int64
			var name string
			if frows.Scan(&uni, &id, &name) == nil {
				out.Faculties = append(out.Faculties, map[string]any{"universityId": uni, "id": id, "name": name})
			}
		}
		frows.Close()
	}

	trows, err := s.DB.Pool.Query(ctx, `
		SELECT t."universityId", t.id, t."termCode", t.title, t."isCurrent"
		FROM academic_terms t ORDER BY t."universityId", COALESCE(t."sortOrder", 0) DESC LIMIT 200`)
	if err == nil {
		for trows.Next() {
			var uni, id int64
			var code, title string
			var cur int
			if trows.Scan(&uni, &id, &code, &title, &cur) == nil {
				out.Terms = append(out.Terms, map[string]any{"universityId": uni, "id": id, "termCode": code, "title": title, "isCurrent": cur})
			}
		}
		trows.Close()
	}

	yrows, err := s.DB.Pool.Query(ctx, `
		SELECT s."universityId", min(s."entryYear"), max(s."entryYear")
		FROM students s GROUP BY 1`)
	if err == nil {
		for yrows.Next() {
			var uni int64
			var mn, mx *int
			if yrows.Scan(&uni, &mn, &mx) == nil {
				out.EntryYears = append(out.EntryYears, map[string]any{"universityId": uni, "min": mn, "max": mx})
			}
		}
		yrows.Close()
	}
	return out, nil
}

// ═══════════════ استخراج ردیف‌ها (پورت student-rows.ts / instructor-rows.ts) ═══════════════

const SahamDefaultLimit = 5000
const SahamMaxLimit = 20000

// SahamStudentFilters فیلترهای سمت سرور.
type SahamStudentFilters struct {
	Status       string
	MajorID      int64
	FacultyID    int64
	EntryFrom    *int
	EntryTo      *int
	GraduateFrom string
	GraduateTo   string
	TermID       int64
	Limit        int
}

// SahamStudent ردیف خام دانشجو با همهٔ ستون‌های سهام.
type SahamStudent struct {
	UniversityID       int64
	UniversityTitle    string
	FacultyID          *int64
	FacultyTitle       *string
	TeachingMode       *string
	StudyType          *string
	DegreeCode         *string
	DegreeTitle        *string
	MajorCode          *string
	MajorTitle         *string
	Status             string
	TermStatusTitle    *string
	TransferGuest      *string
	LastTermCode       *string
	StudentCode        string
	EntryYear          *int64
	EntryTerm          *int64
	FirstName          string
	LastName           string
	Gender             *string
	FatherName         *string
	BirthCertNo        *string
	NationalCode       string
	MaritalStatus      *string
	Religion           *string
	BirthDate          *string
	BirthProvince      *string
	BirthCity          *string
	NativeType         *string
	ResProvince        *string
	ResCity            *string
	PostalCode         *string
	HomeTell           *string
	Mobile             *string
	Email              *string
	Nationality        *string
	CountryTitle       *string
	AcceptanceType     *string
	AdmissionMethod    *string
	QuotaType          *string
	TuitionPayment     *string
	ScholarshipType    *string
	EntranceRank       *string
	TermCourseCount    *int
	LeaveSemesters     *int
	ProbationSemesters *int
	TotalPassedUnits   *string
	UnitsRemaining     *string
	TotalAverage       *string
	TotalFailedUnits   *string
	ForeignStudentID   *string
	IsThesis           int
	// توجه: ستون militaryStatus در دیتابیس فعلی وجود ندارد — شیت نظام وظیفه خالی می‌ماند.
	Address      *string
	GraduateDate *string
	EduEndYear   *int64
	EduEndSem    *int64
}

const sahamStudentSelect = `
	WITH last_state AS (
	  SELECT DISTINCT ON (st."studentId") st."studentId", st."statusTitle"
	  FROM student_term_states st
	  JOIN students s2 ON s2.id = st."studentId"
	  WHERE s2."universityId" = $1
	  ORDER BY st."studentId", st."termCode" DESC
	),
	enr_per_term AS (
	  SELECT e."studentId", t."termCode", count(*)::int AS cnt
	  FROM enrollments e
	  JOIN course_offerings o ON o.id = e."offeringId"
	  JOIN academic_terms t ON t.id = o."termId"
	  JOIN students s2 ON s2.id = e."studentId"
	  WHERE s2."universityId" = $1
	  GROUP BY e."studentId", t."termCode"
	),
	last_enr AS (
	  SELECT DISTINCT ON ("studentId") "studentId", "termCode", cnt
	  FROM enr_per_term ORDER BY "studentId", "termCode" DESC
	),
	leave_cnt AS (
	  SELECT st."studentId", count(*)::int AS cnt
	  FROM student_term_states st
	  JOIN students s2 ON s2.id = st."studentId"
	  WHERE s2."universityId" = $1 AND st."statusCode" IN ('2','3')
	  GROUP BY st."studentId"
	),
	prob_cnt AS (
	  SELECT st."studentId", count(*)::int AS cnt
	  FROM student_term_states st
	  JOIN students s2 ON s2.id = st."studentId"
	  WHERE s2."universityId" = $1 AND st."isProbation" = 1
	  GROUP BY st."studentId"
	),
	thesis_now AS (
	  SELECT e."studentId", 1::int AS f
	  FROM enrollments e
	  JOIN course_offerings o ON o.id = e."offeringId"
	  JOIN courses c ON c.id = o."courseId"
	  JOIN academic_terms t ON t.id = o."termId"
	  JOIN students s2 ON s2.id = e."studentId"
	  WHERE s2."universityId" = $1 AND c."isThesis" = 1
	    AND CASE WHEN $2::int IS NOT NULL THEN t.id = $2::int ELSE t."isCurrent" = 1 END
	  GROUP BY e."studentId"
	)
	SELECT
	  s."universityId", u2."title",
	  m."facultyId", f."name",
	  s."teachingMode", s."studyType",
	  d."standardCode", d."title",
	  m."majorCode", m."name",
	  s.status, ls."statusTitle", s."transferGuestStatus", le."termCode",
	  s."studentCode", s."entryYear", s."entryTerm",
	  us."firstName", us."lastName", us."gender", us."fatherName", us."birthCertNo", us."nationalCode",
	  s."maritalStatus", us."religion", to_char(us."birthDate", 'YYYY-MM-DD'),
	  s."birthProvince", s."birthCity", s."nativeType",
	  s."residenceProvince", s."residenceCity",
	  us."postalCode", s."homeTell", us."mobile", us."email", us."nationality", gc."title",
	  s."acceptanceType", s."admissionMethod", s."quotaType", s."tuitionPaymentMethod",
	  s."scholarshipType", s."entranceExamRank",
	  le.cnt, lc.cnt, pc.cnt,
	  s."totalPassedUnits"::text, s."unitsRemaining"::text, s."totalAverage"::text,
	  s."totalFailedUnits"::text, s."foreignStudentId", COALESCE(tn.f, 0),
	  us."address", s."graduateDate", s."eduEndYear", s."eduEndSemester"
	FROM students s
	JOIN users us ON us.id = s."userId"
	JOIN universities u2 ON u2.id = s."universityId"
	LEFT JOIN majors m ON m.id = s."majorId"
	LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
	LEFT JOIN faculties f ON f.id = m."facultyId"
	LEFT JOIN geo_countries gc ON gc."code" = us."nationality"
	LEFT JOIN last_state ls ON ls."studentId" = s.id
	LEFT JOIN last_enr le ON le."studentId" = s.id
	LEFT JOIN leave_cnt lc ON lc."studentId" = s.id
	LEFT JOIN prob_cnt pc ON pc."studentId" = s.id
	LEFT JOIN thesis_now tn ON tn."studentId" = s.id
	WHERE s."universityId" = $1
`

func (f *SahamStudentFilters) conds(idx *int) ([]string, []any) {
	conds, args := []string{}, []any{}
	add := func(cond string, v any) {
		*idx++
		args = append(args, v)
		conds = append(conds, strings.ReplaceAll(cond, "$?", "$"+strconv.Itoa(*idx)))
	}
	if f.Status != "" {
		add(`s.status = $?`, f.Status)
	}
	if f.MajorID > 0 {
		add(`s."majorId" = $?`, f.MajorID)
	}
	if f.FacultyID > 0 {
		add(`m."facultyId" = $?`, f.FacultyID)
	}
	if f.EntryFrom != nil {
		add(`s."entryYear" >= $?`, *f.EntryFrom)
	}
	if f.EntryTo != nil {
		add(`s."entryYear" <= $?`, *f.EntryTo)
	}
	if f.GraduateFrom != "" {
		add(`s."graduateDate" >= $?`, f.GraduateFrom)
	}
	if f.GraduateTo != "" {
		add(`s."graduateDate" <= $?`, f.GraduateTo)
	}
	return conds, args
}

// SahamCountStudents تعداد رکوردهای فیلترشدهٔ یک دانشگاه.
func (s *Service) SahamCountStudents(ctx context.Context, universityID int64, f SahamStudentFilters) (int64, error) {
	idx := 1
	conds, args := f.conds(&idx)
	where := ""
	if len(conds) > 0 {
		where = " AND " + strings.Join(conds, " AND ")
	}
	args2 := append([]any{universityID}, args...)
	var n int64
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT count(*) FROM students s
		LEFT JOIN majors m ON m.id = s."majorId"
		WHERE s."universityId" = $1`+where, args2...).Scan(&n)
	return n, err
}

// SahamFetchStudents خواندن دانشجویان یک دانشگاه با همهٔ ستون‌های سهام.
func (s *Service) SahamFetchStudents(ctx context.Context, universityID int64, f SahamStudentFilters) ([]SahamStudent, int64, bool, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = SahamDefaultLimit
	}
	if limit > SahamMaxLimit {
		limit = SahamMaxLimit
	}
	var termID any
	if f.TermID > 0 {
		termID = f.TermID
	}
	base := []any{universityID, termID}
	idx := 2
	conds, extra := f.conds(&idx)
	args := append(base, extra...)
	where := ""
	if len(conds) > 0 {
		where = " AND " + strings.Join(conds, " AND ")
	}
	q := sahamStudentSelect + where + fmt.Sprintf(` ORDER BY s."studentCode" LIMIT %d`, limit)
	rows, err := s.DB.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, false, err
	}
	defer rows.Close()
	out := []SahamStudent{}
	for rows.Next() {
		var r SahamStudent
		if err := rows.Scan(&r.UniversityID, &r.UniversityTitle, &r.FacultyID, &r.FacultyTitle,
			&r.TeachingMode, &r.StudyType, &r.DegreeCode, &r.DegreeTitle, &r.MajorCode, &r.MajorTitle,
			&r.Status, &r.TermStatusTitle, &r.TransferGuest, &r.LastTermCode,
			&r.StudentCode, &r.EntryYear, &r.EntryTerm,
			&r.FirstName, &r.LastName, &r.Gender, &r.FatherName, &r.BirthCertNo, &r.NationalCode,
			&r.MaritalStatus, &r.Religion, &r.BirthDate,
			&r.BirthProvince, &r.BirthCity, &r.NativeType,
			&r.ResProvince, &r.ResCity,
			&r.PostalCode, &r.HomeTell, &r.Mobile, &r.Email, &r.Nationality, &r.CountryTitle,
			&r.AcceptanceType, &r.AdmissionMethod, &r.QuotaType, &r.TuitionPayment,
			&r.ScholarshipType, &r.EntranceRank,
			&r.TermCourseCount, &r.LeaveSemesters, &r.ProbationSemesters,
			&r.TotalPassedUnits, &r.UnitsRemaining, &r.TotalAverage,
			&r.TotalFailedUnits, &r.ForeignStudentID, &r.IsThesis,
			&r.Address, &r.GraduateDate, &r.EduEndYear, &r.EduEndSem); err == nil {
			out = append(out, r)
		}
	}
	total, _ := s.SahamCountStudents(ctx, universityID, f)
	return out, total, total > int64(len(out)), rows.Err()
}

// SahamStudentHeaders سرستون‌های رسمی فایل دانشجویان سهام — ۵۲ ستون، ترتیب عیناً همین.
var SahamStudentHeaders = []string{
	"نام موسسه آموزش عالی", "کد دانشکده / مرکز / واحد", "نام دانشکده / مرکز / واحد",
	"استان محل استقرار دانشکده / مرکز / واحد", "شهر محل استقرار دانشکده / مرکز / واحد",
	"شیوه آموزش", "نوع تحصیل", "کد دوره تحصیلی", "دوره تحصیلی", "کد رشته تحصیلی", "رشته تحصیلی",
	"کد وضعیت کلی دانشجو", "وضعیت کلی دانشجو", "وضعیت دانشجو در ترم", "وضعیت انتقال / میهمان",
	"آخرین ترم ثبت نام دانشجو", "شماره دانشجویی", "سال ورود/ نیمسال اول یا دوم",
	"نام", "نام خانوادگی", "جنسیت", "نام پدر", "شماره شناسنامه", "شماره ملی",
	"وضعیت تاهل", "دین", "سال تولد", "استان محل تولد", "شهر محل تولد", "بومی یا غیربومی",
	"استان محل سکونت دائمی", "شهر محل سکونت دائمی", "کد پستی محل سکونت دائمی",
	"شماره تلفن ثابت", "شماره تلفن همراه", "پست الکترونیکی", "تابعیت", "کشور تابعیت",
	"نوع پذیرش دانشجو", "روش پذیرش دانشجو", "وضعیت سهمیه پذیرش", "نحوه پرداخت شهریه",
	"نوع بورسیه", "رتبه در آزمون ورودی", "تعداد درس ثبت نامی دانشجو در ترم",
	"تعداد نیمسال های مرخصی", "تعداد نیمسال های مشروطی",
	"جمع واحد گذرانده تا قبل از نیمسال تحصیلی فعلی", "جمع واحد باقیمانده تا قبل از نیمسال تحصیلی فعلی",
	"معدل کل تا قبل از نیمسال فعلی", "آیا دانشجو در حال گذراندن پایان نامه یا رساله می‌باشد؟",
	"شناسه فراگیر اتباع خارجی",
}

// SahamGraduateHeaders سرستون‌های رسمی شیت اول دانش‌آموختگان — ۴۳ ستون.
var SahamGraduateHeaders = []string{
	"نام موسسه آموزش عالی", "کد دانشکده / مرکز / واحد", "نام  دانشکده / مرکز / واحد",
	"استان محل استقرار  دانشکده / مرکز / واحد", "شهر محل استقرار  دانشکده / مرکز / واحد",
	"شیوه آموزش", "نوع تحصیل", "کد دوره تحصیلی", "دوره تحصیلی", "کد رشته تحصیلی", "رشته تحصیلی",
	"وضعیت کلی دانشجو", "کد وضعیت کلی دانشجو", "شماره دانشجویی", "سال ورود/ نیمسال اول یا دوم",
	"نیمسال فارغ التحصیلی", "نام", "نام خانوادگی", "جنسیت", "نام پدر", "شماره شناسنامه", "شماره ملی",
	"وضعیت تاهل", "دین", "سال تولد", "استان محل تولد", "شهر محل تولد", "بومی یا غیربومی",
	"استان محل سکونت دائمی", "شهر محل سکونت دائمی", "کد پستی محل سکونت دائمی",
	"آدرس محل سکونت دائمی", "شماره تلفن ثابت", "شماره تلفن همراه", "پست الکترونیکی",
	"تابعیت", "کشور تابعیت", "تعداد نیمسال های مرخصی", "تعداد نیمسال های مشروطی",
	"معدل کل", "جمع واحد گذرانده", "جمع واحد مردودی", "شناسه فراگیر اتباع خارجی",
}

// SahamMilitaryHeaders سرستون‌های شیت دوم «وضعیت نظام وظیفه».
var SahamMilitaryHeaders = []string{"شماره ملی", "شماره دانشجویی", "نام", "نام خانوادگی", "وضعیت نظام وظیفه"}

// SahamInstructorHeaders سرستون‌های رسمی آموزشگران — ۳۷ ستون.
var SahamInstructorHeaders = []string{
	"نام موسسه آموزش عالی", "کد دانشکده / مرکز / واحد", "نام  دانشکده / مرکز / واحد",
	"استان محل استقرار دانشکده یا محل خدمت", "شهر محل استقرار دانشکده یا محل خدمت",
	"نام گروه آموزشی", "نام", "نام خانوادگی", "نام پدر", "جنسیت", "کد ملی", "شماره شناسنامه",
	"سال تولد", "استان محل تولد", "شهر محل تولد", "وضعیت تاهل", "آخرین مدرک تحصیلی",
	"رشته تحصیلی آخرین مدرک تحصیلی", "گروه تحصیلی آخرین مدرک تحصیلی",
	"سال اخذ آخرین مدرک تحصیلی", "کشور محل اخذ آخرین مدرک تحصیلی",
	"موسسه آموزش عالی محل اخذ آخرین مدرک تحصیلی", "نوع استخدام آموزشگران",
	"نوع خدمت آموزشگران", "نوع آموزشگر موسسه آموزش عالی", "نوع هیات علمی", "سمت",
	"تاریخ انتصاب", "مرتبه علمی", "پایه", "سال استخدام", "شماره مستخدم",
	"تعداد واحد تدریس", "تلفن همراه", "تلفن ثابت", "پست الکترونیکی", "شماره شناسایی استاد",
}

func sahamStrVal(m map[string]map[string]string, field string, v string) string {
	vp := v
	return str(m, field, &vp)
}

func str(m map[string]map[string]string, field string, v *string) string {
	return SahamMapClosed(m, field, v)
}

func orEmpty(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func orEmptyI(v *int) string {
	if v == nil {
		return ""
	}
	return strconv.Itoa(*v)
}

// SahamStudentRow تبدیل ردیف خام به ۵۲ ستون سهام (پورت toSahamRow).
func SahamStudentRow(r SahamStudent, maps map[string]map[string]string, code *SahamInstituteCode, geo *SahamGeoTitles) []string {
	instCode, instTitle := "", orEmpty(r.FacultyTitle)
	provName, cityName := "", ""
	if code != nil {
		instCode, instTitle = code.Code, code.Title
		if code.ProvinceCode != nil {
			provName = geo.Province[*code.ProvinceCode]
		}
		cityName = sahamCityTitle(geo, code.ProvinceCode, code.CityCode)
	}
	teaching := "حضوری"
	if r.TeachingMode != nil && *r.TeachingMode != "" {
		teaching = str(maps, "teaching_mode", r.TeachingMode)
	}
	thesis := ""
	if r.IsThesis == 1 {
		thesis = "بله"
	} else if r.IsThesis == 0 {
		thesis = "خیر"
	}
	return []string{
		r.UniversityTitle, instCode, instTitle, provName, cityName,
		teaching, str(maps, "study_type", r.StudyType),
		orEmpty(r.DegreeCode), str(maps, "degree", r.DegreeTitle),
		orEmpty(r.MajorCode), orEmpty(r.MajorTitle),
		sahamStatusCodeStr(maps, r.Status), sahamStrVal(maps, "student_status", r.Status),
		str(maps, "term_status", r.TermStatusTitle), str(maps, "transfer_guest", r.TransferGuest),
		orEmpty(r.LastTermCode), r.StudentCode, SahamEntryYear(r.EntryYear, r.EntryTerm),
		r.FirstName, r.LastName, str(maps, "gender", r.Gender), orEmpty(r.FatherName),
		orEmpty(r.BirthCertNo), r.NationalCode, str(maps, "marital", r.MaritalStatus),
		str(maps, "religion", r.Religion), SahamBirthYear(r.BirthDate),
		orEmpty(r.BirthProvince), orEmpty(r.BirthCity), SahamNative(r.NativeType),
		orEmpty(r.ResProvince), orEmpty(r.ResCity), orEmpty(r.PostalCode),
		orEmpty(r.HomeTell), orEmpty(r.Mobile), orEmpty(r.Email),
		sahamCountry(r), str(maps, "admission_type", r.AcceptanceType), str(maps, "admission_method", r.AdmissionMethod),
		str(maps, "quota", r.QuotaType), str(maps, "tuition_payment", r.TuitionPayment),
		str(maps, "scholarship", r.ScholarshipType), orEmpty(r.EntranceRank),
		orEmptyI(r.TermCourseCount), orEmptyI(r.LeaveSemesters), orEmptyI(r.ProbationSemesters),
		orEmpty(r.TotalPassedUnits), orEmpty(r.UnitsRemaining), orEmpty(r.TotalAverage),
		thesis, orEmpty(r.ForeignStudentID),
	}
}

func sahamStatusCodeStr(maps map[string]map[string]string, status string) string {
	if code, ok := sahamStatusCode[status]; ok {
		return code
	}
	return ""
}

func sahamCountry(r SahamStudent) string {
	if r.CountryTitle != nil && *r.CountryTitle != "" {
		return *r.CountryTitle
	}
	if r.Nationality != nil && *r.Nationality == "120001" {
		return "ایران"
	}
	return ""
}

// SahamGraduateRow تبدیل به ۴۳ ستون دانش‌آموختگان (پورت toSahamGraduateRow).
func SahamGraduateRow(r SahamStudent, maps map[string]map[string]string, code *SahamInstituteCode, geo *SahamGeoTitles) []string {
	instCode, instTitle := "", orEmpty(r.FacultyTitle)
	provName, cityName := "", ""
	if code != nil {
		instCode, instTitle = code.Code, code.Title
		if code.ProvinceCode != nil {
			provName = geo.Province[*code.ProvinceCode]
		}
		cityName = sahamCityTitle(geo, code.ProvinceCode, code.CityCode)
	}
	teaching := "حضوری"
	if r.TeachingMode != nil && *r.TeachingMode != "" {
		teaching = str(maps, "teaching_mode", r.TeachingMode)
	}
	gradTerm := ""
	if r.EduEndYear != nil {
		gradTerm = SahamEntryYear(r.EduEndYear, r.EduEndSem)
	} else {
		gradTerm = SahamGradTermFromDate(r.GraduateDate)
	}
	country := sahamCountry(r)
	return []string{
		r.UniversityTitle, instCode, instTitle, provName, cityName,
		teaching, str(maps, "study_type", r.StudyType),
		orEmpty(r.DegreeCode), str(maps, "degree", r.DegreeTitle),
		orEmpty(r.MajorCode), orEmpty(r.MajorTitle),
		sahamStrVal(maps, "student_status", r.Status), sahamStatusCodeStr(maps, r.Status),
		r.StudentCode, SahamEntryYear(r.EntryYear, r.EntryTerm), gradTerm,
		r.FirstName, r.LastName, str(maps, "gender", r.Gender), orEmpty(r.FatherName),
		orEmpty(r.BirthCertNo), r.NationalCode, str(maps, "marital", r.MaritalStatus),
		str(maps, "religion", r.Religion), SahamBirthYear(r.BirthDate),
		orEmpty(r.BirthProvince), orEmpty(r.BirthCity), SahamNative(r.NativeType),
		orEmpty(r.ResProvince), orEmpty(r.ResCity), orEmpty(r.PostalCode),
		orEmpty(r.Address), orEmpty(r.HomeTell), orEmpty(r.Mobile), orEmpty(r.Email),
		country, country,
		orEmptyI(r.LeaveSemesters), orEmptyI(r.ProbationSemesters),
		orEmpty(r.TotalAverage), orEmpty(r.TotalPassedUnits), orEmpty(r.TotalFailedUnits),
		orEmpty(r.ForeignStudentID),
	}
}

// SahamMilitaryRow شیت نظام وظیفه (پورت toSahamMilitaryRow).
func SahamMilitaryRow(r SahamStudent) []string {
	// ستون نظام وظیفه در دیتابیس فعلی موجود نیست → خالی.
	return []string{r.NationalCode, r.StudentCode, r.FirstName, r.LastName, ""}
}

// SahamInstructor ردیف خام آموزشگر.
type SahamInstructor struct {
	UniversityID         int64
	UniversityTitle      string
	FacultyID            *int64
	InstituteTitle       *string
	DeptTitle            *string
	FirstName            string
	LastName             string
	FatherName           *string
	Gender               *string
	NationalCode         string
	BirthCertNo          *string
	BirthDate            *string
	BirthProvince        string
	BirthCity            string
	BirthCityFallback    string
	MaritalStatus        *string
	Degree               *string
	FieldMain            *string
	FieldOfStudy         *string
	LastDegreeYear       *int
	LastDegreeCountry    *string
	LastDegreeUniversity *string
	EmploymentType       *string
	CooperationType      *string
	StaffType            *string
	AcademicRank         *string
	Title                *string
	HireDate             *string
	AcademicBase         *string
	PersonnelNo          *string
	TeachUnits           *string
	Mobile               *string
	Phone                *string
	Email                *string
	StaffCode            string
}

// SahamCountInstructors تعداد اساتید دارای ارائهٔ فعال در نیمسال.
func (s *Service) SahamCountInstructors(ctx context.Context, universityID, termID int64) (int64, error) {
	var n int64
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT count(DISTINCT o."professorId")::int
		FROM course_offerings o JOIN staff st ON st.id = o."professorId"
		WHERE o."termId" = $1 AND o."professorId" IS NOT NULL AND o."isActive" = 1
		  AND st."universityId" = $2`, termID, universityID).Scan(&n)
	return n, err
}

// SahamFetchInstructors استخراج آموزشگران نیمسال (پورت fetchSahamInstructors).
func (s *Service) SahamFetchInstructors(ctx context.Context, universityID, termID int64, limit int) ([]SahamInstructor, error) {
	if limit <= 0 {
		limit = SahamDefaultLimit
	}
	if limit > SahamMaxLimit {
		limit = SahamMaxLimit
	}
	rows, err := s.DB.Pool.Query(ctx, `
		WITH load AS (
		  SELECT o."professorId", sum(c.units)::numeric AS units
		  FROM course_offerings o
		  JOIN courses c ON c.id = o."courseId"
		  WHERE o."termId" = $1 AND o."professorId" IS NOT NULL AND o."isActive" = 1
		  GROUP BY o."professorId"
		)
		SELECT st."universityId", u2."title", st."facultyId", f."name", dp."name",
		  us."firstName", us."lastName", us."fatherName", us."gender", us."nationalCode", us."birthCertNo",
		  to_char(us."birthDate", 'YYYY-MM-DD'),
		  COALESCE(st."birthProvince", ''), COALESCE(st."birthCity", ''), COALESCE(us."placeOfBirth", ''),
		  st."maritalStatus", st."degree", st."fieldMain", st."fieldOfStudy", st."lastDegreeYear",
		  gc."title", st."lastDegreeUniversity", st."employmentType", st."cooperationType", st."staffType",
		  st."academicRank", st."title", st."hireDate"::text, st."academicBase", st."personnelNo",
		  load.units::text, us."mobile", st."phone", us."email", st."staffCode"
		FROM staff st
		JOIN users us ON us.id = st."userId"
		JOIN universities u2 ON u2.id = st."universityId"
		JOIN load ON load."professorId" = st.id
		LEFT JOIN faculties f ON f.id = st."facultyId"
		LEFT JOIN departments dp ON dp.id = st."departmentId"
		LEFT JOIN geo_countries gc ON gc."code" = st."lastDegreeCountryCode"
		WHERE st."universityId" = $2
		ORDER BY us."lastName", us."firstName"
		LIMIT $3`, termID, universityID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SahamInstructor{}
	for rows.Next() {
		var r SahamInstructor
		if err := rows.Scan(&r.UniversityID, &r.UniversityTitle, &r.FacultyID, &r.InstituteTitle, &r.DeptTitle,
			&r.FirstName, &r.LastName, &r.FatherName, &r.Gender, &r.NationalCode, &r.BirthCertNo,
			&r.BirthDate, &r.BirthProvince, &r.BirthCity, &r.BirthCityFallback,
			&r.MaritalStatus, &r.Degree, &r.FieldMain, &r.FieldOfStudy, &r.LastDegreeYear,
			&r.LastDegreeCountry, &r.LastDegreeUniversity, &r.EmploymentType, &r.CooperationType, &r.StaffType,
			&r.AcademicRank, &r.Title, &r.HireDate, &r.AcademicBase, &r.PersonnelNo,
			&r.TeachUnits, &r.Mobile, &r.Phone, &r.Email, &r.StaffCode); err == nil {
			out = append(out, r)
		}
	}
	return out, rows.Err()
}

// SahamInstructorRow تبدیل به ۳۷ ستون آموزشگران (پورت toSahamInstructorRow).
func SahamInstructorRow(r SahamInstructor, maps map[string]map[string]string, code *SahamInstituteCode, geo *SahamGeoTitles) []string {
	instCode, instTitle := "", orEmpty(r.InstituteTitle)
	provName, cityName := "", ""
	if code != nil {
		instCode, instTitle = code.Code, code.Title
		if code.ProvinceCode != nil {
			provName = geo.Province[*code.ProvinceCode]
		}
		cityName = sahamCityTitle(geo, code.ProvinceCode, code.CityCode)
	}
	hireYear := ""
	if r.HireDate != nil && len(*r.HireDate) >= 4 {
		hireYear = (*r.HireDate)[:4]
	}
	field18 := orEmpty(r.FieldOfStudy)
	if field18 == "" {
		field18 = orEmpty(r.FieldMain)
	}
	return []string{
		r.UniversityTitle, instCode, instTitle, provName, cityName,
		orEmpty(r.DeptTitle), r.FirstName, r.LastName, orEmpty(r.FatherName),
		str(maps, "gender", r.Gender), r.NationalCode, orEmpty(r.BirthCertNo),
		SahamBirthYear(r.BirthDate), r.BirthProvince,
		firstNonEmpty(r.BirthCity, r.BirthCityFallback),
		str(maps, "marital", r.MaritalStatus), str(maps, "last_degree", r.Degree),
		field18, orEmpty(r.FieldMain),
		orEmptyI(r.LastDegreeYear), orEmpty(r.LastDegreeCountry), orEmpty(r.LastDegreeUniversity),
		str(maps, "employment_type", r.EmploymentType), str(maps, "service_type", r.CooperationType),
		orEmpty(r.StaffType),
		// «نوع هیات علمی» فهرست رسمی ندارد — عمداً خالی می‌ماند.
		"", orEmpty(r.Title), orEmpty(r.HireDate), str(maps, "academic_rank", r.AcademicRank),
		orEmpty(r.AcademicBase), hireYear, orEmpty(r.PersonnelNo), orEmpty(r.TeachUnits),
		orEmpty(r.Mobile), orEmpty(r.Phone), orEmpty(r.Email), r.StaffCode,
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// ═══════════════ ساخت خروجی CSV (پورت build.ts — با CSV به‌جای xlsx) ═══════════════

// SahamKind نوع گزارش سهام.
type SahamKind string

const (
	SahamStudents    SahamKind = "students"
	SahamGraduates   SahamKind = "graduates"
	SahamInstructors SahamKind = "instructors"
)

// SahamBuildFile خروجی CSV یک یا چند دانشگاه — سه برگه در فایل‌های مجزا نیست؛
// خروجی اصلی + شیت نظام وظیفه به‌صورت دو CSV در یک بایت‌استریم می‌آید وقتی لازم است.
// برای سادگی مصرف‌کننده: student/graduate → CSV اصلی؛ military همان RDN عطف نامستقل.
type SahamBuildResult struct {
	CSV      []byte
	FileName string
	Count    int
	Total    int64
	HasMore  bool
}

func sahamWriteCSV(headers []string, rows [][]string) []byte {
	var buf bytes.Buffer
	buf.WriteString("\uFEFF") // BOM تا اکسل UTF-8 را درست بخواند
	w := csv.NewWriter(&buf)
	w.UseCRLF = true
	_ = w.Write(headers)
	_ = w.WriteAll(rows)
	w.Flush()
	return buf.Bytes()
}

// SahamBuildWorkbook ساخت خروجی رسمی برای یک یا چند دانشگاه (پورت buildSahamWorkbook/Many).
func (s *Service) SahamBuildWorkbook(ctx context.Context, universityIDs []int64, kind SahamKind, f SahamStudentFilters) (*SahamBuildResult, error) {
	if len(universityIDs) == 0 {
		return nil, errors.New("مؤسسه‌ای برای خروجی یافت نشد.")
	}
	maps := s.SahamLoadValueMaps(ctx)
	codes := s.SahamLoadInstituteCodes(ctx)
	geo, _ := s.SahamLoadGeoTitles(ctx)

	if kind == SahamInstructors {
		if f.TermID <= 0 {
			return nil, errors.New("برای گزارش آموزشگران انتخاب نیمسال لازم است.")
		}
		rows := [][]string{}
		for _, id := range universityIDs {
			list, err := s.SahamFetchInstructors(ctx, id, f.TermID, f.Limit)
			if err != nil {
				return nil, err
			}
			for _, r := range list {
				rows = append(rows, SahamInstructorRow(r, maps, SahamPickCode(codes, r.UniversityID, r.FacultyID), geo))
			}
		}
		suffix := sahamSuffix(universityIDs)
		return &SahamBuildResult{
			CSV:      sahamWriteCSV(SahamInstructorHeaders, rows),
			FileName: fmt.Sprintf("SAHAM-Instructors-%s.csv", suffix),
			Count:    len(rows), Total: int64(len(rows)), HasMore: false,
		}, nil
	}

	sf := f
	if kind == SahamGraduates {
		sf.Status = "GRADUATED"
	}
	all := []SahamStudent{}
	var total int64
	hasMore := false
	for _, id := range universityIDs {
		rows, t, more, err := s.SahamFetchStudents(ctx, id, sf)
		if err != nil {
			return nil, err
		}
		all = append(all, rows...)
		total += t
		hasMore = hasMore || more
	}
	// مرتب‌سازی بر اساس شماره دانشجویی
	for i := 1; i < len(all); i++ {
		for j := i; j > 0 && all[j].StudentCode < all[j-1].StudentCode; j-- {
			all[j], all[j-1] = all[j-1], all[j]
		}
	}

	data := [][]string{}
	mil := [][]string{}
	for _, r := range all {
		code := SahamPickCode(codes, r.UniversityID, r.FacultyID)
		if kind == SahamGraduates {
			data = append(data, SahamGraduateRow(r, maps, code, geo))
		} else {
			data = append(data, SahamStudentRow(r, maps, code, geo))
		}
		mil = append(mil, SahamMilitaryRow(r))
	}
	suffix := sahamSuffix(universityIDs)
	var res *SahamBuildResult
	if kind == SahamGraduates {
		// شیت نظام وظیفه به‌صورت بخش دوم همان فایل با سرستون جدا می‌آید.
		body := append(sahamWriteCSV(SahamGraduateHeaders, data), sahamWriteCSV(SahamMilitaryHeaders, mil)...)
		res = &SahamBuildResult{CSV: body, FileName: fmt.Sprintf("SAHAM-Graduates-%s.csv", suffix), Count: len(all), Total: total, HasMore: hasMore}
	} else {
		body := append(sahamWriteCSV(SahamStudentHeaders, data), sahamWriteCSV(SahamMilitaryHeaders, mil)...)
		res = &SahamBuildResult{CSV: body, FileName: fmt.Sprintf("SAHAM-Students-%s.csv", suffix), Count: len(all), Total: total, HasMore: hasMore}
	}
	return res, nil
}

func sahamSuffix(ids []int64) string {
	if len(ids) == 1 {
		return fmt.Sprintf("uni%d", ids[0])
	}
	return fmt.Sprintf("%duni", len(ids))
}

// ═══════════════ تنظیمات کد مؤسسه (پورت settings/actions.ts) ═══════════════

// SahamInstituteCodeInput ورودی ذخیرهٔ کد مؤسسه.
type SahamInstituteCodeInput struct {
	ID           int64  `json:"id"`
	UniversityID int64  `json:"universityId"`
	FacultyID    *int64 `json:"facultyId"`
	Title        string `json:"title"`
	Code         string `json:"code"`
	ProvinceCode string `json:"provinceCode"`
	CityCode     string `json:"cityCode"`
	IsDefault    bool   `json:"isDefault"`
	IsActive     bool   `json:"isActive"`
}

// SahamSaveInstituteCode ذخیره (درج/ویرایش) یک سطر کد مؤسسه.
func (s *Service) SahamSaveInstituteCode(ctx context.Context, in SahamInstituteCodeInput) (int64, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return 0, errors.New("عنوان واحد لازم است.")
	}
	code := strings.TrimSpace(in.Code)
	re := regexp.MustCompile(`^\d{12}$`)
	if !re.MatchString(code) {
		return 0, errors.New("کد واحد باید دقیقاً ۱۲ رقم باشد.")
	}
	if in.UniversityID <= 0 {
		return 0, errors.New("دانشگاه الزامی است.")
	}
	var prov, city any
	if strings.TrimSpace(in.ProvinceCode) != "" {
		prov = strings.TrimSpace(in.ProvinceCode)
	}
	if strings.TrimSpace(in.CityCode) != "" {
		city = strings.TrimSpace(in.CityCode)
	}
	var savedID int64
	if in.ID > 0 {
		tag, err := s.DB.Pool.Exec(ctx, `
			update saham_institute_codes set "universityId" = $2, "facultyId" = $3, title = $4, code = $5,
			       "provinceCode" = $6, "cityCode" = $7, "isDefault" = $8, "isActive" = $9 where id = $1`,
			in.ID, in.UniversityID, in.FacultyID, title, code, prov, city, boolInt(in.IsDefault), boolInt(in.IsActive))
		if err != nil {
			return 0, errors.New("این کد قبلاً برای همین دانشگاه ثبت شده است.")
		}
		if tag.RowsAffected() == 0 {
			return 0, errors.New("سطر یافت نشد.")
		}
		savedID = in.ID
	} else {
		if err := s.DB.Pool.QueryRow(ctx, `
			insert into saham_institute_codes ("universityId","facultyId",title,code,"provinceCode","cityCode","isDefault","isActive")
			values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
			in.UniversityID, in.FacultyID, title, code, prov, city, boolInt(in.IsDefault), boolInt(in.IsActive)).Scan(&savedID); err != nil {
			return 0, errors.New("این کد قبلاً برای همین دانشگاه ثبت شده است.")
		}
	}
	// فقط یک پیش‌فرض برای هر دانشگاه — بقیه صفر می‌شوند
	if in.IsDefault && savedID > 0 {
		_, _ = s.DB.Pool.Exec(ctx, `
			update saham_institute_codes set "isDefault" = 0
			 where "universityId" = $1 and id <> $2`, in.UniversityID, savedID)
	}
	return savedID, nil
}

// SahamDeleteInstituteCode حذف یک سطر.
func (s *Service) SahamDeleteInstituteCode(ctx context.Context, id int64) error {
	_, err := s.DB.Pool.Exec(ctx, `delete from saham_institute_codes where id = $1`, id)
	return err
}

// SahamSettingsBundle دادهٔ صفحهٔ تنظیمات سهام.
func (s *Service) SahamSettingsBundle(ctx context.Context) (map[string]any, error) {
	out := map[string]any{}
	universities := []map[string]any{}
	ur, err := s.DB.Pool.Query(ctx, `select id, code, title, kind from universities where "isActive" = 1 order by id`)
	if err == nil {
		for ur.Next() {
			var id int64
			var code, title, kind string
			if ur.Scan(&id, &code, &title, &kind) == nil {
				universities = append(universities, map[string]any{"id": id, "code": code, "title": title, "kind": kind})
			}
		}
		ur.Close()
	}
	out["universities"] = universities

	faculties := []map[string]any{}
	fr, err := s.DB.Pool.Query(ctx, `select id, "universityId", "name" from faculties order by "universityId", "name"`)
	if err == nil {
		for fr.Next() {
			var id, uni int64
			var name string
			if fr.Scan(&id, &uni, &name) == nil {
				faculties = append(faculties, map[string]any{"id": id, "universityId": uni, "name": name})
			}
		}
		fr.Close()
	}
	out["faculties"] = faculties

	provinces := []map[string]any{}
	pr, err := s.DB.Pool.Query(ctx, `select code, title from geo_provinces order by title`)
	if err == nil {
		for pr.Next() {
			var code, title string
			if pr.Scan(&code, &title) == nil {
				provinces = append(provinces, map[string]any{"code": code, "title": title})
			}
		}
		pr.Close()
	}
	out["provinces"] = provinces

	cities := []map[string]any{}
	cr, err := s.DB.Pool.Query(ctx, `select "provinceCode", code, title from geo_cities order by title`)
	if err == nil {
		for cr.Next() {
			var pc, code, title string
			if cr.Scan(&pc, &code, &title) == nil {
				cities = append(cities, map[string]any{"provinceCode": pc, "code": code, "title": title})
			}
		}
		cr.Close()
	}
	out["cities"] = cities

	codes := []map[string]any{}
	coder, err := s.DB.Pool.Query(ctx, `
		select id, "universityId", "facultyId", title, code, coalesce("provinceCode",''), coalesce("cityCode",''),
		       coalesce("isDefault",0), coalesce("isActive",1)
		  from saham_institute_codes order by "universityId", id`)
	if err == nil {
		for coder.Next() {
			var id, uni int64
			var fid *int64
			var title, code, prov, city string
			var isDefault, isActive int
			if coder.Scan(&id, &uni, &fid, &title, &code, &prov, &city, &isDefault, &isActive) == nil {
				codes = append(codes, map[string]any{"id": id, "universityId": uni, "facultyId": fid,
					"title": title, "code": code, "provinceCode": prov, "cityCode": city,
					"isDefault": isDefault, "isActive": isActive})
			}
		}
		coder.Close()
	}
	out["codes"] = codes
	return out, nil
}

// SahamAuthorizer فهرست دانشگاه‌های مجاز برای کاربر (پورت authorizedIds سمت سرور).
func (s *Service) SahamAuthorizer(ctx context.Context, user *session.User, uniCookie string) []int64 {
	if id := s.UniversityID(ctx, user, uniCookie); id != nil {
		return []int64{*id}
	}
	rows, err := s.DB.Pool.Query(ctx, `select id from universities where "isActive" = 1 order by id`)
	if err != nil {
		return []int64{}
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			out = append(out, id)
		}
	}
	return out
}
