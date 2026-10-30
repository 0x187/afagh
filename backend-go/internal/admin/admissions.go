// ═══ پذیرش: نگاشت سنجش، Staging، ورود دسته‌ای، ثبت دستی و تست ایرانداک ═══
package admin

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"backend-go/internal/authn"
	"backend-go/internal/fa"
	"backend-go/internal/irandoc"
)

// StagingItem ردیف داوطلب در Staging.
type StagingItem struct {
	ID              int64          `json:"id"`
	NationalCode    string         `json:"nationalCode"`
	FullName        *string        `json:"fullName"`
	MappedMajorID   *int64         `json:"mappedMajorId"`
	MappedMajorName *string        `json:"mappedMajorName"`
	Status          *string        `json:"status"`
	QuotaType       *string        `json:"quotaType"`
	StudentID       *int64         `json:"studentId"`
	Mobile          *string        `json:"mobile"`
	RawSanjeshData  map[string]any `json:"rawSanjeshData"`
}

// MappingItem نگاشت کد سنجش.
type MappingItem struct {
	ID              int64   `json:"id"`
	SanjeshCode     string  `json:"sanjeshCode"`
	InternalMajorID *int64  `json:"internalMajorId"`
	MajorName       *string `json:"majorName"`
	SanjeshQuota    *string `json:"sanjeshQuota"`
}

// MajorOption رشته.
type MajorOption struct {
	ID            int64   `json:"id"`
	Name          string  `json:"name"`
	MajorCode     *string `json:"majorCode"`
	DegreeLevelID *int64  `json:"degreeLevelId"`
}

// DegreeLevelOption مقطع.
type DegreeLevelOption struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
	Code  string `json:"code"`
}

// FormulaItem فرمول شماره دانشجویی.
type FormulaItem struct {
	DegreeLevelID   *int64  `json:"degreeLevelId"`
	DegreeTitle     *string `json:"degreeTitle"`
	Formula         string  `json:"formula"`
	CurrentSequence *int    `json:"currentSequence"`
}

// ApiAuditItem لاگ استعلام‌ها.
type ApiAuditItem struct {
	ID             int64   `json:"id"`
	ServiceName    string  `json:"serviceName"`
	RequestURL     string  `json:"requestUrl"`
	ResponseStatus *int    `json:"responseStatus"`
	DurationMs     *int    `json:"durationMs"`
	IsSuccess      *int    `json:"isSuccess"`
	ExecutedAt     *string `json:"executedAt"`
}

// AdmissionsData بستهٔ اولیهٔ صفحه.
type AdmissionsData struct {
	StagingList  []StagingItem       `json:"stagingList"`
	Mappings     []MappingItem       `json:"mappings"`
	Majors       []MajorOption       `json:"majors"`
	DegreeLevels []DegreeLevelOption `json:"degreeLevels"`
	Formulas     []FormulaItem       `json:"formulas"`
	APILogs      []ApiAuditItem      `json:"apiLogs"`
}

// EnsureDefaultSanjeshMappings فقط وقتی جدول خالی است، نگاشت‌های پیش‌فرض را می‌سازد.
func (s *Service) EnsureDefaultSanjeshMappings(ctx context.Context) {
	var n int
	if err := s.DB.Pool.QueryRow(ctx, `select count(*)::int from sanjesh_mappings`).Scan(&n); err != nil || n > 0 {
		return
	}
	rows, err := s.DB.Pool.Query(ctx, `select id, name from majors order by id`)
	if err != nil {
		return
	}
	type mj struct {
		ID   int64
		Name string
	}
	list := []mj{}
	for rows.Next() {
		var m mj
		if err := rows.Scan(&m.ID, &m.Name); err == nil {
			list = append(list, m)
		}
	}
	rows.Close()
	for _, d := range DefaultSanjeshMappings {
		prefix := strings.TrimSpace(strings.SplitN(d.MajorName, " - ", 2)[0])
		var found *int64
		for _, m := range list {
			if strings.Contains(m.Name, prefix) {
				id := m.ID
				found = &id
				break
			}
		}
		if found == nil {
			continue
		}
		_, _ = s.DB.Pool.Exec(ctx, `
			insert into sanjesh_mappings ("sanjeshCode","internalMajorId","sanjeshQuota","internalQuotaCode")
			values ($1,$2,$3,1)`, d.Code, *found, d.Quota)
	}
}

// AdmissionsList بستهٔ اولیهٔ صفحه.
func (s *Service) AdmissionsList(ctx context.Context, uniID int64) (*AdmissionsData, error) {
	s.EnsureDefaultSanjeshMappings(ctx)
	out := &AdmissionsData{
		StagingList: []StagingItem{}, Mappings: []MappingItem{}, Majors: []MajorOption{},
		DegreeLevels: []DegreeLevelOption{}, Formulas: []FormulaItem{}, APILogs: []ApiAuditItem{},
	}
	scope := `("universityId" = $1 or "universityId" is null)`

	// رشته‌ها و مقاطع
	if rows, err := s.DB.Pool.Query(ctx, `select id, name, "majorCode", "degreeLevelId" from majors where `+scope+` order by id`, uniID); err == nil {
		for rows.Next() {
			var m MajorOption
			if err := rows.Scan(&m.ID, &m.Name, &m.MajorCode, &m.DegreeLevelID); err == nil {
				out.Majors = append(out.Majors, m)
			}
		}
		rows.Close()
	}
	if rows, err := s.DB.Pool.Query(ctx, `select id, title, code from degree_level_configs where `+scope+` order by id`, uniID); err == nil {
		for rows.Next() {
			var d DegreeLevelOption
			if err := rows.Scan(&d.ID, &d.Title, &d.Code); err == nil {
				out.DegreeLevels = append(out.DegreeLevels, d)
			}
		}
		rows.Close()
	}
	majorName := map[int64]string{}
	for _, m := range out.Majors {
		majorName[m.ID] = m.Name
	}

	// نگاشت‌ها
	if rows, err := s.DB.Pool.Query(ctx, `
		select id, "sanjeshCode", "internalMajorId", "sanjeshQuota" from sanjesh_mappings where `+scope, uniID); err == nil {
		for rows.Next() {
			var m MappingItem
			if err := rows.Scan(&m.ID, &m.SanjeshCode, &m.InternalMajorID, &m.SanjeshQuota); err == nil {
				if m.InternalMajorID != nil {
					if name, ok := majorName[*m.InternalMajorID]; ok {
						v := name
						m.MajorName = &v
					}
				}
				out.Mappings = append(out.Mappings, m)
			}
		}
		rows.Close()
	}

	// فرمول‌ها
	levelTitle := map[int64]string{}
	for _, d := range out.DegreeLevels {
		levelTitle[d.ID] = d.Title
	}
	if rows, err := s.DB.Pool.Query(ctx, `
		select "degreeLevelId", formula, coalesce("currentSequence",0) from student_id_formulas where `+scope, uniID); err == nil {
		for rows.Next() {
			var f FormulaItem
			if err := rows.Scan(&f.DegreeLevelID, &f.Formula, &f.CurrentSequence); err == nil {
				if f.DegreeLevelID != nil {
					if title, ok := levelTitle[*f.DegreeLevelID]; ok {
						v := title
						f.DegreeTitle = &v
					}
				}
				out.Formulas = append(out.Formulas, f)
			}
		}
		rows.Close()
	}

	// Staging — ۵۰ ردیف آخر
	if rows, err := s.DB.Pool.Query(ctx, `
		select id, "nationalCode", "fullName", "mappedMajorId", status, "quotaType", "studentId", "mobile", "rawSanjeshData"
		  from admissions_staging where `+scope+` order by id desc limit 50`, uniID); err == nil {
		for rows.Next() {
			var it StagingItem
			var raw *string
			if err := rows.Scan(&it.ID, &it.NationalCode, &it.FullName, &it.MappedMajorID,
				&it.Status, &it.QuotaType, &it.StudentID, &it.Mobile, &raw); err != nil {
				continue
			}
			it.RawSanjeshData = map[string]any{}
			if raw != nil && strings.TrimSpace(*raw) != "" {
				_ = json.Unmarshal([]byte(*raw), &it.RawSanjeshData)
				if it.RawSanjeshData == nil {
					it.RawSanjeshData = map[string]any{}
				}
			}
			if it.MappedMajorID != nil {
				if name, ok := majorName[*it.MappedMajorID]; ok {
					v := name
					it.MappedMajorName = &v
				}
			}
			out.StagingList = append(out.StagingList, it)
		}
		rows.Close()
	}

	// لاگ استعلام‌ها (جدول در برخی نسخه‌ها نیست — خطا بی‌صدا)
	if rows, err := s.DB.Pool.Query(ctx, `
		select id, "serviceName", "requestUrl", "responseStatus", "durationMs", coalesce("isSuccess",1), "executedAt"::text
		  from api_audit_logs order by id desc limit 20`); err == nil {
		for rows.Next() {
			var l ApiAuditItem
			if err := rows.Scan(&l.ID, &l.ServiceName, &l.RequestURL, &l.ResponseStatus, &l.DurationMs, &l.IsSuccess, &l.ExecutedAt); err == nil {
				out.APILogs = append(out.APILogs, l)
			}
		}
		rows.Close()
	}
	return out, nil
}

// ─────────────────── شمارهٔ دانشجویی ───────────────────

type queryExec interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// GenerateStudentID پورت generateStudentId با افزایش اتمیک شمارنده.
func (s *Service) GenerateStudentID(ctx context.Context, q queryExec, degreeLevelID int64, entryYear int, majorCode string, quotaCode int) (string, error) {
	var levelCode *string
	_ = q.QueryRow(ctx, `select code from degree_level_configs where id = $1 limit 1`, degreeLevelID).Scan(&levelCode)

	var formulaID int64
	var formula string
	var seq int
	err := q.QueryRow(ctx, `select id, formula, coalesce("currentSequence",0) from student_id_formulas where "degreeLevelId" = $1 limit 1`,
		degreeLevelID).Scan(&formulaID, &formula, &seq)
	if err == nil {
		if err := q.QueryRow(ctx, `
			update student_id_formulas set "currentSequence" = "currentSequence" + 1
			 where id = $1 returning "currentSequence"`, formulaID).Scan(&seq); err != nil {
			return "", err
		}
	} else {
		formula = "{Year:2}{DegreeCode:1}{MajorCode:3}{Seq:3}"
		var newID int64
		var newSeq int
		errInsert := q.QueryRow(ctx, `
			insert into student_id_formulas ("degreeLevelId","entryYear",formula,"currentSequence")
			values ($1,$2,$3,1)
			on conflict ("degreeLevelId") do nothing
			returning id, "currentSequence"`, degreeLevelID, entryYear, formula).Scan(&newID, &newSeq)
		if errInsert == nil {
			formulaID, seq = newID, newSeq
		} else {
			if err := q.QueryRow(ctx, `
				select id, formula from student_id_formulas where "degreeLevelId" = $1 limit 1`,
				degreeLevelID).Scan(&formulaID, &formula); err != nil {
				return "", errors.New("ایجاد فرمول شمارهٔ دانشجویی ممکن نشد.")
			}
			if err := q.QueryRow(ctx, `
				update student_id_formulas set "currentSequence" = "currentSequence" + 1
				 where id = $1 returning "currentSequence"`, formulaID).Scan(&seq); err != nil {
				return "", err
			}
		}
	}

	year2 := fmt.Sprintf("%02d", entryYear%100)
	degreeDigit := "1"
	if levelCode != nil {
		switch strings.ToUpper(*levelCode) {
		case "BS":
			degreeDigit = "1"
		case "MS":
			degreeDigit = "2"
		case "PHD":
			degreeDigit = "3"
		}
	}
	if strings.TrimSpace(majorCode) == "" {
		majorCode = "412"
	}
	major3 := fmt.Sprintf("%03d", atoiSafe(majorCode)%1000)
	seq3 := fmt.Sprintf("%03d", seq)
	if quotaCode <= 0 {
		quotaCode = 1
	}
	generated := formula
	generated = strings.ReplaceAll(generated, "{Year:2}", year2)
	generated = strings.ReplaceAll(generated, "{DegreeCode:1}", degreeDigit)
	generated = strings.ReplaceAll(generated, "{MajorCode:3}", major3)
	generated = strings.ReplaceAll(generated, "{Seq:3}", seq3)
	generated = strings.ReplaceAll(generated, "{QuotaCode:1}", strconv.Itoa(quotaCode))
	if generated == "" || generated == formula {
		generated = year2 + degreeDigit + major3 + seq3
	}
	return generated, nil
}

func atoiSafe(v string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(v))
	return n
}

// ─────────────────── پارس و Staging ───────────────────

var nationalCodeRe = regexp.MustCompile(`^\d{10}$`)
var partsSplitRe = regexp.MustCompile(`[,;\t|]|\s{2,}`)

// StagedRow نتیجهٔ stage یک خط.
type StagedRow struct {
	ID              int64   `json:"id"`
	NationalCode    string  `json:"nationalCode"`
	FullName        string  `json:"fullName"`
	SanjeshCode     string  `json:"sanjeshCode"`
	Status          string  `json:"status"`
	MappedMajorName *string `json:"mappedMajorName"`
}

// ParseAndStageSanjesh پورت parseAndStageSanjeshData.
func (s *Service) ParseAndStageSanjesh(ctx context.Context, uniID int64, rawText string, entryYear int) ([]StagedRow, error) {
	s.EnsureDefaultSanjeshMappings(ctx)
	if entryYear <= 0 {
		entryYear = 1405
	}
	lines := []string{}
	for _, l := range strings.Split(rawText, "\n") {
		l = strings.TrimSpace(l)
		if l != "" {
			lines = append(lines, l)
		}
	}

	type mapping struct {
		SanjeshCode string
		MajorID     int64
	}
	mappings := []mapping{}
	if rows, err := s.DB.Pool.Query(ctx, `select "sanjeshCode", "internalMajorId" from sanjesh_mappings where "internalMajorId" is not null`); err == nil {
		for rows.Next() {
			var code string
			var id int64
			if err := rows.Scan(&code, &id); err == nil {
				mappings = append(mappings, mapping{code, id})
			}
		}
		rows.Close()
	}
	majorName := map[int64]string{}
	if rows, err := s.DB.Pool.Query(ctx, `select id, name from majors`); err == nil {
		for rows.Next() {
			var id int64
			var name string
			if err := rows.Scan(&id, &name); err == nil {
				majorName[id] = name
			}
		}
		rows.Close()
	}
	var defaultLevel int64 = 1
	_ = s.DB.Pool.QueryRow(ctx, `select id from degree_level_configs order by id limit 1`).Scan(&defaultLevel)

	existing := map[string]bool{}
	if rows, err := s.DB.Pool.Query(ctx, `select "nationalCode" from admissions_staging`); err == nil {
		for rows.Next() {
			var nc string
			if err := rows.Scan(&nc); err == nil {
				existing[nc] = true
			}
		}
		rows.Close()
	}

	out := []StagedRow{}
	for _, line := range lines {
		parts := []string{}
		for _, p := range partsSplitRe.Split(line, -1) {
			p = strings.TrimSpace(p)
			if p != "" {
				parts = append(parts, p)
			}
		}
		if len(parts) < 4 {
			continue
		}
		nationalCode := parts[0]
		firstName := parts[1]
		lastName := parts[2]
		sanjeshCode := parts[3]
		quota := "سهمیه عادی"
		if len(parts) > 4 && parts[4] != "" {
			quota = parts[4]
		}
		mobile := ""
		if len(parts) > 5 {
			mobile = parts[5]
		}
		var rank any
		if len(parts) > 6 && parts[6] != "" {
			if n, err := strconv.Atoi(parts[6]); err == nil {
				rank = n
			}
		}
		examType := optPart(parts, 7)
		degreeLevel := optPart(parts, 8)
		majorGroup := optPart(parts, 9)
		universityCode := optPart(parts, 10)

		if !nationalCodeRe.MatchString(nationalCode) {
			continue
		}
		if existing[nationalCode] {
			continue
		}
		existing[nationalCode] = true

		var mapped *int64
		for _, m := range mappings {
			if m.SanjeshCode == sanjeshCode {
				id := m.MajorID
				mapped = &id
				break
			}
		}
		status := "PENDING_MAPPING"
		if mapped != nil {
			status = "RESOLVED"
		}
		raw := map[string]any{
			"firstName": firstName, "lastName": lastName, "sanjeshCode": sanjeshCode,
			"quota": quota, "rank": rank, "examType": examType, "degreeLevel": degreeLevel,
			"majorGroup": majorGroup, "universityCode": universityCode,
		}
		if mobile != "" {
			raw["mobile"] = mobile
		}
		rawJSON, _ := json.Marshal(raw)
		var id int64
		err := s.DB.Pool.QueryRow(ctx, `
			insert into admissions_staging ("nationalCode","fullName","rawSanjeshData","mappedMajorId",
			  "entryYear","degreeLevelId","quotaType","mobile",status,"onboardingStatus","universityId")
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'IMPORTED',$10) returning id`,
			nationalCode, strings.TrimSpace(firstName+" "+lastName), string(rawJSON), mapped,
			entryYear, defaultLevel, quota, nilIfBlankStr(mobile), status, uniID).Scan(&id)
		if err != nil {
			continue
		}
		item := StagedRow{
			ID: id, NationalCode: nationalCode, FullName: strings.TrimSpace(firstName + " " + lastName),
			SanjeshCode: sanjeshCode, Status: status,
		}
		if mapped != nil {
			if name, ok := majorName[*mapped]; ok {
				v := name
				item.MappedMajorName = &v
			}
		}
		out = append(out, item)
	}
	return out, nil
}

func optPart(parts []string, i int) string {
	if i >= 0 && i < len(parts) {
		return parts[i]
	}
	return ""
}

func nilIfBlankStr(v string) *string {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	s := strings.TrimSpace(v)
	return &s
}

// ─────────────────── ورود دسته‌ای ───────────────────

// ImportedStudent نتیجهٔ ورود یک ردیف.
type ImportedStudent struct {
	StagingID    int64  `json:"stagingId"`
	StudentCode  string `json:"studentCode"`
	FullName     string `json:"fullName"`
	NationalCode string `json:"nationalCode"`
}

// ImportFailure خطای یک ردیف.
type ImportFailure struct {
	StagingID int64  `json:"stagingId"`
	Error     string `json:"error"`
}

// ImportResult نتیجهٔ ورود دسته‌ای.
type ImportResult struct {
	Imported []ImportedStudent `json:"imported"`
	Failures []ImportFailure   `json:"failures"`
}

var longDigitsRe = regexp.MustCompile(`\d{10,}`)

func maskSecretsText(v string) string {
	return longDigitsRe.ReplaceAllString(v, "[REDACTED]")
}

func randomPassword() string {
	b := make([]byte, 9)
	if _, err := rand.Read(b); err != nil {
		return "ChangeMe1234"
	}
	return base64.RawURLEncoding.EncodeToString(b)[:12]
}

// ImportStaged پورت importStagedToStudents — هر ردیف تراکنش مستقل.
func (s *Service) ImportStaged(ctx context.Context, uniID int64, ids []int64) (*ImportResult, error) {
	res := &ImportResult{Imported: []ImportedStudent{}, Failures: []ImportFailure{}}
	if len(ids) == 0 {
		return res, nil
	}
	var defaultReg *int64
	var regID int64
	if err := s.DB.Pool.QueryRow(ctx, `select id from educational_regulations order by id limit 1`).Scan(&regID); err == nil {
		defaultReg = &regID
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "nationalCode", "fullName", "mappedMajorId", status, "degreeLevelId", coalesce("entryYear",1405),
		       coalesce("quotaType",'NORMAL'), coalesce("mobile",''), "rawSanjeshData", "universityId"
		  from admissions_staging where id = any($1) and ("universityId" = $2 or "universityId" is null)`, ids, uniID)
	if err != nil {
		return nil, err
	}
	type srow struct {
		ID           int64
		NationalCode string
		FullName     *string
		MajorID      *int64
		Status       *string
		DegreeID     *int64
		EntryYear    int
		QuotaType    string
		Mobile       string
		Raw          *string
		UniversityID *int64
	}
	list := []srow{}
	for rows.Next() {
		var r srow
		if err := rows.Scan(&r.ID, &r.NationalCode, &r.FullName, &r.MajorID, &r.Status, &r.DegreeID,
			&r.EntryYear, &r.QuotaType, &r.Mobile, &r.Raw, &r.UniversityID); err == nil {
			list = append(list, r)
		}
	}
	rows.Close()

	for _, r := range list {
		if r.MajorID == nil || r.Status == nil || *r.Status != "RESOLVED" {
			continue
		}
		majorID := *r.MajorID
		degreeID := int64(1)
		if r.DegreeID != nil && *r.DegreeID > 0 {
			degreeID = *r.DegreeID
		}
		rowUni := uniID
		if r.UniversityID != nil && *r.UniversityID > 0 {
			rowUni = *r.UniversityID
		}
		parsed := map[string]any{}
		if r.Raw != nil {
			_ = json.Unmarshal([]byte(*r.Raw), &parsed)
		}
		first := strOf(parsed["firstName"])
		last := strOf(parsed["lastName"])
		if first == "" && r.FullName != nil {
			first = strings.SplitN(*r.FullName, " ", 2)[0]
		}
		if last == "" && r.FullName != nil {
			parts := strings.SplitN(*r.FullName, " ", 2)
			if len(parts) > 1 {
				last = parts[1]
			}
		}
		if first == "" {
			first = "دانشجو"
		}
		if last == "" {
			last = "پذیرفته‌شده"
		}
		mobile := r.Mobile
		if mobile == "" {
			mobile = strOf(parsed["mobile"])
		}

		imported, failure := s.importOne(ctx, r.ID, r.NationalCode, first, last, mobile, majorID, degreeID, r.EntryYear, r.QuotaType, rowUni, defaultReg)
		if failure != "" {
			res.Failures = append(res.Failures, ImportFailure{StagingID: r.ID, Error: maskSecretsText(failure)})
			continue
		}
		res.Imported = append(res.Imported, imported)
	}
	return res, nil
}

func (s *Service) importOne(ctx context.Context, stagingID int64, nationalCode, first, last, mobile string,
	majorID, degreeID int64, entryYear int, quotaType string, uniID int64, defaultReg *int64) (ImportedStudent, string) {
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return ImportedStudent{}, err.Error()
	}
	defer tx.Rollback(ctx)

	var userID int64
	var uFirst, uLast *string
	err = tx.QueryRow(ctx, `
		select id, "firstName", "lastName" from users
		 where "nationalCode" = $1 and "universityId" = $2 limit 1`, nationalCode, uniID).
		Scan(&userID, &uFirst, &uLast)
	if err != nil {
		hash, herr := authn.HashPassword(randomPassword())
		if herr != nil {
			return ImportedStudent{}, herr.Error()
		}
		if err := tx.QueryRow(ctx, `
			insert into users ("nationalCode","firstName","lastName",mobile,"passwordHash","isActive","mustChangePassword","universityId")
			values ($1,$2,$3,$4,$5,1,1,$6) returning id`,
			nationalCode, first, last, nilIfBlankStr(mobile), hash, uniID).Scan(&userID); err != nil {
			return ImportedStudent{}, err.Error()
		}
		uFirst, uLast = &first, &last
	}

	var studentID int64
	var studentCode string
	err = tx.QueryRow(ctx, `select id, "studentCode" from students where "userId" = $1 limit 1`, userID).
		Scan(&studentID, &studentCode)
	if err != nil {
		var majorCode *string
		_ = tx.QueryRow(ctx, `select "majorCode" from majors where id = $1`, majorID).Scan(&majorCode)
		code := "412"
		if majorCode != nil && strings.TrimSpace(*majorCode) != "" {
			code = *majorCode
		}
		generated, gerr := s.GenerateStudentID(ctx, tx, degreeID, entryYear, code, 1)
		if gerr != nil {
			return ImportedStudent{}, gerr.Error()
		}
		studentCode = generated
		var reg any
		if defaultReg != nil {
			reg = *defaultReg
		}
		if err := tx.QueryRow(ctx, `
			insert into students ("userId","studentCode","majorId","degreeLevelId","regulationId",
			  "entryYear","entryTerm",status,"quotaType","currentTermNo","universityId")
			values ($1,$2,$3,$4,$5,$6,1,'ACTIVE',$7,1,$8) returning id`,
			userID, studentCode, majorID, degreeID, reg, entryYear, quotaType, uniID).Scan(&studentID); err != nil {
			return ImportedStudent{}, err.Error()
		}
	}
	if _, err := tx.Exec(ctx, `
		update admissions_staging set status = 'IMPORTED', "studentId" = $2, "userId" = $3,
		       "onboardingStatus" = 'COMPLETED' where id = $1`, stagingID, studentID, userID); err != nil {
		return ImportedStudent{}, err.Error()
	}
	if err := tx.Commit(ctx); err != nil {
		return ImportedStudent{}, err.Error()
	}
	full := strings.TrimSpace(derefStr(uFirst) + " " + derefStr(uLast))
	return ImportedStudent{
		StagingID: stagingID, StudentCode: studentCode, FullName: full, NationalCode: nationalCode,
	}, ""
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func strOf(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

// ─────────────────── ثبت دستی ───────────────────

// ManualStudentInput ورودی ثبت دستی.
type ManualStudentInput struct {
	NationalCode  string `json:"nationalCode"`
	FirstName     string `json:"firstName"`
	LastName      string `json:"lastName"`
	Mobile        string `json:"mobile"`
	MajorID       int64  `json:"majorId"`
	DegreeLevelID int64  `json:"degreeLevelId"`
	EntryYear     int    `json:"entryYear"`
	EntryTerm     int    `json:"entryTerm"`
	QuotaType     string `json:"quotaType"`
	AdmissionType string `json:"admissionType"`
}

// ManualStudentResult نتیجهٔ ثبت دستی.
type ManualStudentResult struct {
	StudentID   int64  `json:"studentId"`
	UserID      int64  `json:"userId"`
	StudentCode string `json:"studentCode"`
	FullName    string `json:"fullName"`
}

// RegisterManualStudent پورت registerManualStudent.
func (s *Service) RegisterManualStudent(ctx context.Context, uniID int64, in ManualStudentInput) (*ManualStudentResult, error) {
	nc := fa.ToEnDigits(strings.TrimSpace(in.NationalCode))
	if !nationalCodeRe.MatchString(nc) {
		return nil, errors.New("کد ملی باید ۱۰ رقم باشد.")
	}
	first := strings.TrimSpace(in.FirstName)
	last := strings.TrimSpace(in.LastName)
	if first == "" || last == "" {
		return nil, errors.New("نام و نام خانوادگی الزامی است.")
	}
	if in.MajorID <= 0 || in.DegreeLevelID <= 0 {
		return nil, errors.New("رشته و مقطع الزامی است.")
	}
	var majorUni *int64
	var majorCode *string
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId", "majorCode" from majors where id = $1`, in.MajorID).
		Scan(&majorUni, &majorCode); err != nil {
		return nil, errors.New("رشته یافت نشد.")
	}
	if majorUni != nil && *majorUni != uniID {
		return nil, errors.New("رشته متعلق به دانشگاه دیگری است.")
	}
	var degUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from degree_level_configs where id = $1`, in.DegreeLevelID).
		Scan(&degUni); err != nil {
		return nil, errors.New("مقطع یافت نشد.")
	}
	if degUni != nil && *degUni != uniID {
		return nil, errors.New("مقطع متعلق به دانشگاه دیگری است.")
	}
	entryYear := in.EntryYear
	if entryYear <= 0 {
		entryYear = 1405
	}
	entryTerm := in.EntryTerm
	if entryTerm <= 0 {
		entryTerm = 1
	}
	quota := strings.TrimSpace(in.QuotaType)
	if quota == "" {
		quota = "NORMAL"
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var regID any
	var id int64
	if err := tx.QueryRow(ctx, `select id from educational_regulations order by id limit 1`).Scan(&id); err == nil {
		regID = id
	}
	var userID int64
	var uFirst, uLast *string
	err = tx.QueryRow(ctx, `
		select id, "firstName", "lastName" from users where "nationalCode" = $1 and "universityId" = $2 limit 1`,
		nc, uniID).Scan(&userID, &uFirst, &uLast)
	if err != nil {
		hash, herr := authn.HashPassword(randomPassword())
		if herr != nil {
			return nil, herr
		}
		if err := tx.QueryRow(ctx, `
			insert into users ("nationalCode","firstName","lastName",mobile,"passwordHash","isActive","mustChangePassword","universityId")
			values ($1,$2,$3,$4,$5,1,1,$6) returning id`,
			nc, first, last, nilIfBlankStr(in.Mobile), hash, uniID).Scan(&userID); err != nil {
			return nil, err
		}
		uFirst, uLast = &first, &last
	}
	code := "412"
	if majorCode != nil && strings.TrimSpace(*majorCode) != "" {
		code = *majorCode
	}
	studentCode, err := s.GenerateStudentID(ctx, tx, in.DegreeLevelID, entryYear, code, 1)
	if err != nil {
		return nil, err
	}
	var studentID int64
	if err := tx.QueryRow(ctx, `
		insert into students ("userId","studentCode","majorId","degreeLevelId","regulationId",
		  "entryYear","entryTerm",status,"quotaType","currentTermNo","universityId")
		values ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8,1,$9) returning id`,
		userID, studentCode, in.MajorID, in.DegreeLevelID, regID, entryYear, entryTerm, quota, uniID).Scan(&studentID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &ManualStudentResult{
		StudentID: studentID, UserID: userID, StudentCode: studentCode,
		FullName: strings.TrimSpace(derefStr(uFirst) + " " + derefStr(uLast)),
	}, nil
}

// ─────────────────── نگاشت و فرمول ───────────────────

// SaveSanjeshMapping پورت saveSanjeshMappingAction.
func (s *Service) SaveSanjeshMapping(ctx context.Context, uniID int64, sanjeshCode string, internalMajorID int64, quota string) error {
	code := strings.TrimSpace(sanjeshCode)
	if code == "" {
		return errors.New("کد سنجش الزامی است.")
	}
	var majorUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from majors where id = $1`, internalMajorID).Scan(&majorUni); err != nil {
		return errors.New("رشتهٔ داخلی یافت نشد.")
	}
	if majorUni != nil && *majorUni != uniID {
		return errors.New("رشته متعلق به دانشگاه دیگری است.")
	}
	if strings.TrimSpace(quota) == "" {
		quota = "سهمیه عادی"
	}
	var existingID int64
	err := s.DB.Pool.QueryRow(ctx, `
		select id from sanjesh_mappings where "sanjeshCode" = $1 and ("universityId" = $2 or "universityId" is null) limit 1`,
		code, uniID).Scan(&existingID)
	if err == nil {
		if _, err := s.DB.Pool.Exec(ctx, `
			update sanjesh_mappings set "internalMajorId" = $2, "sanjeshQuota" = $3 where id = $1`,
			existingID, internalMajorID, quota); err != nil {
			return err
		}
	} else {
		if _, err := s.DB.Pool.Exec(ctx, `
			insert into sanjesh_mappings ("universityId","sanjeshCode","internalMajorId","sanjeshQuota","internalQuotaCode")
			values ($1,$2,$3,$4,1)`, uniID, code, internalMajorID, quota); err != nil {
			return err
		}
	}
	_, err = s.DB.Pool.Exec(ctx, `
		update admissions_staging set "mappedMajorId" = $2, status = 'RESOLVED'
		 where status = 'PENDING_MAPPING' and ("universityId" = $1 or "universityId" is null)`, uniID, internalMajorID)
	return err
}

// SaveStudentIDFormula پورت saveStudentIdFormulaAction.
func (s *Service) SaveStudentIDFormula(ctx context.Context, uniID int64, degreeLevelID int64, formula string) error {
	formula = strings.TrimSpace(formula)
	if formula == "" || len(formula) > 255 {
		return errors.New("فرمول نامعتبر است.")
	}
	var existingID int64
	err := s.DB.Pool.QueryRow(ctx, `
		select id from student_id_formulas where "degreeLevelId" = $1 and ("universityId" = $2 or "universityId" is null) limit 1`,
		degreeLevelID, uniID).Scan(&existingID)
	if err == nil {
		_, err = s.DB.Pool.Exec(ctx, `update student_id_formulas set formula = $2 where id = $1`, existingID, formula)
		return err
	}
	_, err = s.DB.Pool.Exec(ctx, `
		insert into student_id_formulas ("universityId","degreeLevelId","entryYear",formula,"currentSequence")
		values ($1,$2,1405,$3,0)
		on conflict ("degreeLevelId") do update set formula = excluded.formula`, uniID, degreeLevelID, formula)
	return err
}

// settingsNumbers آداپتور GetNumber روی settingsStore.
type settingsNumbers struct{ store settingsStore }

func (w settingsNumbers) Get(ctx context.Context, key string) (string, error) {
	return w.store.Get(ctx, key)
}
func (w settingsNumbers) GetNumber(ctx context.Context, key string, fallback float64) float64 {
	raw, err := w.store.Get(ctx, key)
	if err != nil {
		return fallback
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return fallback
	}
	return v
}

// TestIrandoc استعلام آزمایشی ایرانداک.
func (s *Service) TestIrandoc(ctx context.Context, nationalCode, trackingCode, thesisTitle string, threshold float64) irandoc.Result {
	return irandoc.Check(ctx, settingsNumbers{store: s.Store}, irandoc.Params{
		NationalCode: nationalCode, TrackingCode: trackingCode,
		ThesisTitle: thesisTitle, Threshold: threshold,
	})
}
