// ═══ Students dossier manager — port of afagh-next/src/app/admin/students ═══
//
// Server-side data layer for the comprehensive student dossier manager
// (StudentsManagerClient). Ported from:
//
//   - page.tsx            → GetStudentsDossierList / GetStudentsDossierMeta / GetStudentDossier
//   - actions.ts          → transcript, regulation, cohort stats, account ops, profile patches, staff bundle
//   - grades/actions.ts   → AdminSetGrade / StudentGradeAuditLog / ResolveSamaCodeForGrade
//   - staff-data.ts       → LoadStaffBundle
//
// Idioms match admin.go: s.DB.Pool, s.UniversityID (fail-closed — every query is
// university-scoped), *session.User. All SQL uses bound parameters; dynamic WHERE
// fragments are fixed strings with numbered placeholders only (table names in the
// bulk ops come from a fixed switch, never from user input).
package admin

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/authn"
	"backend-go/internal/fa"
	"backend-go/internal/gpa"
	"backend-go/internal/gradestatus"
	"backend-go/internal/jalali"
	"backend-go/internal/session"
)

// ═══════════════════════════════════════════════════════════════════════
//  shared helpers
// ═══════════════════════════════════════════════════════════════════════

// uniFailClosed returns the active university ID or fails closed — the port of
// `getCurrentUniversity().catch(() => null)` + "دانشگاه فعال نامشخص است." gates.
func uniFailClosed(ctx context.Context, s *Service, user *session.User, cookie string) (*int64, error) {
	id := s.UniversityID(ctx, user, cookie)
	if id == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	return id, nil
}

// hasRole mirrors requireRole(role) guards of the server actions.
func hasRole(user *session.User, want ...string) bool {
	for _, r := range user.Roles {
		for _, w := range want {
			if r == w {
				return true
			}
		}
	}
	return false
}

// faNormCol is the port of normCol (persian-search.ts) — an inline SQL REPLACE
// chain so the DB needs no helper function.
func faNormCol(col string) string {
	return "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(" +
		col + ", 'ي', 'ی'), 'ك', 'ک'), 'ة', 'ه'), 'ؤ', 'و'), 'ئ', 'ی'), 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا')"
}

var (
	reDigits10    = regexp.MustCompile(`^\d{10}$`)
	reYear4       = regexp.MustCompile(`^\d{4}$`)
	reBirthDateRe = regexp.MustCompile(`^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$`)
)

// cleanStr is the port of the action's clean(): trim; empty → nil (skip); slice to max.
func patchCleanStr(v any, max int) *string {
	if v == nil {
		return nil
	}
	s := strings.TrimSpace(stringOf(v))
	if s == "" {
		return nil
	}
	if len(s) > max {
		s = s[:max]
	}
	return &s
}

// cleanStrDash also drops the "—" placeholder (staff patch clean()).
func patchCleanStrDash(v any, max int) *string {
	p := patchCleanStr(v, max)
	if p == nil {
		return nil
	}
	if strings.TrimSpace(*p) == "—" {
		return nil
	}
	return p
}

func stringOf(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		b, _ := json.Marshal(x)
		return strings.Trim(string(b), `"`)
	default:
		return ""
	}
}

func numOf(v any) *float64 {
	if v == nil {
		return nil
	}
	switch x := v.(type) {
	case float64:
		return &x
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(x), 64); err == nil {
			return &f
		}
	}
	return nil
}

func intPtrOf(v any) *int {
	if f := numOf(v); f != nil {
		n := int(*f)
		return &n
	}
	return nil
}

// numericArg normalizes JSON numbers for integer columns (pgx encodes float64
// into int4 only when integral; keep the value integral explicitly).
func numericArg(v any) any {
	if n := numOf(v); n != nil {
		if *n == float64(int(*n)) {
			return int(*n)
		}
		return *n
	}
	return nil
}

func strp(s string) *string { return &s }

func orDash(s *string) string {
	if s == nil {
		return "—"
	}
	return *s
}

// GradeChangeEntry is one grade_change_log row.
type GradeChangeEntry struct {
	EnrollmentID      int64
	StudentID         int64
	OfferingID        int64
	Action            string
	OldGradeValue     *string
	NewGradeValue     *string
	OldGradeStatus    *string
	NewGradeStatus    *string
	OldSamaStatusCode *string
	NewSamaStatusCode *string
	Reason            *string
	ActorUserID       *int64
	ActorRole         *string
	UniversityID      *int64
}

// logGradeChange is the port of lib/grade-change-log.logGradeChange.
func logGradeChange(ctx context.Context, pool *pgxpool.Pool, in GradeChangeEntry) error {
	_, err := pool.Exec(ctx, `
		insert into grade_change_log
			("enrollmentId","studentId","offeringId","action","oldGradeValue","newGradeValue",
			 "oldGradeStatus","newGradeStatus","oldSamaStatusCode","newSamaStatusCode",
			 "reason","actorUserId","actorRole","universityId")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		in.EnrollmentID, in.StudentID, in.OfferingID, in.Action,
		in.OldGradeValue, in.NewGradeValue, in.OldGradeStatus, in.NewGradeStatus,
		in.OldSamaStatusCode, in.NewSamaStatusCode, in.Reason,
		in.ActorUserID, in.ActorRole, in.UniversityID)
	return err
}

// randomOneTimePassword is the port of randomOneTimePassword — 96-bit entropy,
// never derived from the national code.
func randomOneTimePassword() string {
	buf := make([]byte, 12)
	_, _ = rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)[:16]
}

// markStatOf parses the legacy raw JSON for the markStat code.
func markStatOf(raw *string) *string {
	if raw == nil || *raw == "" {
		return nil
	}
	var j struct {
		MarkStat any `json:"markStat"`
	}
	if json.Unmarshal([]byte(*raw), &j) != nil {
		return nil
	}
	ms := strings.TrimSpace(stringOf(j.MarkStat))
	if ms == "" {
		return nil
	}
	return &ms
}

// legacySourceCodeFor is the port of transcript-utils.legacySourceCodeFor:
// legacy_grades is scoped by sourceCode = universities.code (never an unscoped join).
func legacySourceCodeFor(universityCode *string) *string {
	if universityCode == nil {
		return nil
	}
	c := strings.ToUpper(strings.TrimSpace(*universityCode))
	if regexp.MustCompile(`^[A-Z0-9_-]{2,50}$`).MatchString(c) {
		return &c
	}
	return nil
}

// passwordPolicyCheck is the port of checkNewPassword (student minimum).
const (
	passwordMinLength = 10
	passwordMaxLength = 128
)

var commonPasswords = map[string]bool{
	"1234567890": true, "0123456789": true, "9876543210": true, "1234567891": true,
	"12345678901": true, "123456789012": true, "1111111111": true, "0000000000": true,
	"2222222222": true, "1212121212": true, "1122334455": true, "1234512345": true,
	"password": true, "password1": true, "password12": true, "password123": true,
	"passw0rd": true, "p@ssword": true, "p@ssw0rd": true, "qwertyuiop": true,
	"qwerty1234": true, "qwerty123456": true, "asdfghjkl": true, "abcdefghij": true,
	"abc123456789": true, "iloveyou": true, "letmein123": true, "welcome123": true,
	"changeme": true, "changeme1": true, "administrator": true, "afagh1234": true,
	"afagh12345": true, "afagh123456": true, "afagh@1234": true, "afagh@123456": true,
	"afaghafagh": true, "sanjesh1404": true, "sanjesh1405": true, "tehran1234": true,
	"iran123456": true, "iran1234567": true,
}

func isSequentialOrRepeated(s string) bool {
	if len(s) == 0 {
		return false
	}
	same := true
	for i := 1; i < len(s); i++ {
		if s[i] != s[0] {
			same = false
			break
		}
	}
	if same {
		return true
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	digits := make([]int, 0, len(s))
	for _, r := range s {
		digits = append(digits, int(r-'0'))
	}
	step := digits[1] - digits[0]
	if step != 1 && step != -1 {
		return false
	}
	for i := 1; i < len(digits); i++ {
		if digits[i]-digits[i-1] != step {
			return false
		}
	}
	return true
}

// checkNewPassword port — returns a Persian error message or empty when OK.
func checkNewPassword(pw string) string {
	p := strings.TrimSpace(pw)
	if len([]rune(p)) < passwordMinLength {
		return "رمز جدید باید حداقل ۱۰ کاراکتر باشد."
	}
	if len([]rune(p)) > passwordMaxLength {
		return "رمز جدید باید حداکثر ۱۲۸ کاراکتر باشد."
	}
	lower := strings.ToLower(p)
	if commonPasswords[lower] || isSequentialOrRepeated(p) {
		return "این رمز خیلی رایج یا قابل حدس است؛ رمز دیگری انتخاب کنید."
	}
	return ""
}

// ensureAccountRoles is the port of ensureAccountRoles — fills missing
// user_roles rows from the student/staff records of the account.
func (s *Service) ensureAccountRoles(ctx context.Context, userID int64) {
	var hasStudent, hasStaff bool
	_ = s.DB.Pool.QueryRow(ctx, `select count(*) > 0 from students where "userId" = $1`, userID).Scan(&hasStudent)
	_ = s.DB.Pool.QueryRow(ctx, `select count(*) > 0 from staff where "userId" = $1`, userID).Scan(&hasStaff)
	codes := []string{}
	if hasStudent {
		codes = append(codes, "STUDENT")
	}
	if hasStaff {
		codes = append(codes, "PROFESSOR")
	}
	for _, code := range codes {
		_, _ = s.DB.Pool.Exec(ctx, `
			insert into user_roles ("userId","roleId")
			select $1, r.id from roles r where r.code = $2
			on conflict ("userId","roleId") do nothing`, userID, code)
	}
}

// studentUniversityGate fails closed when the student belongs to another university.
func studentUniversityGate(ctx context.Context, s *Service, studentID int64, uniID *int64) error {
	var stuUni *int64
	err := s.DB.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, studentID).Scan(&stuUni)
	if err != nil {
		return errors.New("دانشجو یافت نشد.")
	}
	if stuUni != nil && uniID != nil && *stuUni != *uniID {
		return errors.New("دانشجو متعلق به دانشگاه دیگری است.")
	}
	return nil
}

// ═══════════════════════════════════════════════════════════════════════
//  Group A — list + meta + single dossier (port of page.tsx)
// ═══════════════════════════════════════════════════════════════════════

// DossierStudent is the StudentItem contract of types.ts (camelCase JSON).
type DossierStudent struct {
	ID           int64   `json:"id"`
	StudentCode  string  `json:"studentCode"`
	NationalCode string  `json:"nationalCode"`
	FirstName    string  `json:"firstName"`
	LastName     string  `json:"lastName"`
	Mobile       string  `json:"mobile"`
	EntryYear    int     `json:"entryYear"`
	EntryTerm    int     `json:"entryTerm"`
	EntryDate    *string `json:"entryDate"`
	Status       string  `json:"status"`
	SamaStatus   *string `json:"samaStatusCode"`
	QuotaType    string  `json:"quotaType"`
	CurrentTerm  int     `json:"currentTermNo"`
	MajorName    string  `json:"majorName"`
	MajorCode    string  `json:"majorCode"`
	FacultyName  string  `json:"facultyName"`
	DegreeLevel  string  `json:"degreeLevel"`
	DegreeLevelI int64   `json:"degreeLevelId"`
	DegreeCode   string  `json:"degreeCode"`
	RegTitle     string  `json:"regulationTitle"`
	RegulationID *int64  `json:"regulationId"`

	FatherName   string  `json:"fatherName"`
	BirthCertNo  string  `json:"birthCertNo"`
	BirthDate    *string `json:"birthDate"`
	Gender       *string `json:"gender"`
	IsActive     int     `json:"isActive"`
	UserID       *int64  `json:"userId"`
	PlaceOfBirth string  `json:"placeOfBirth"`
	PlaceOfIssue string  `json:"placeOfIssue"`
	Nationality  *string `json:"nationality"`
	PhotoKey     *string `json:"photoKey"`

	AcceptanceType       *string `json:"acceptanceType"`
	AcceptanceAlloc      *string `json:"acceptanceAllocation"`
	StudyingMode         *string `json:"studyingMode"`
	TrainingMethod       *string `json:"trainingMethod"`
	GraduateDate         *string `json:"graduateDate"`
	GradDegreeLevelID    *int64  `json:"graduateDegreeLevelId"`
	FirstNameEn          string  `json:"firstNameEn"`
	LastNameEn           string  `json:"lastNameEn"`
	PassportNumber       string  `json:"passportNumber"`
	Email                *string `json:"email"`
	PostalCode           *string `json:"postalCode"`
	Address              *string `json:"address"`
	UniversityID         *int64  `json:"universityId"`
	SenderUniversityCode *string `json:"senderUniversityCode"`
	Role                 string  `json:"role"`
	// ── Sama supplementary dossier (dorm, guardian, documents, military…) ──
	AdvisorCode        *string `json:"advisorCode"`
	DocumentStatus     *string `json:"documentStatus"`
	ScholarshipType    *string `json:"scholarshipType"`
	MilitaryStatus     *string `json:"militaryStatus"`
	MilitaryExemptNo   *string `json:"militaryExemptionNo"`
	HomeTell           *string `json:"homeTell"`
	StudentCardStatus  *string `json:"studentCardStatus"`
	ArchiveNo          *string `json:"archiveNo"`
	ParvandehNo        *string `json:"parvandehNo"`
	DormName           *string `json:"dormName"`
	DormRoom           *string `json:"dormRoom"`
	HasDorm            *int    `json:"hasDorm"`
	GuardianJobTitle   *string `json:"guardianJobTitle"`
	GuardianPhone      *string `json:"guardianPhone"`
	GuardianAddress    *string `json:"guardianAddress"`
	GuardianEmail      *string `json:"guardianEmail"`
	DiplomaType        *string `json:"diplomaType"`
	DiplomaPlace       *string `json:"diplomaPlace"`
	DiplomaYear        *string `json:"diplomaYear"`
	DiplomaGrade       *string `json:"diplomaGrade"`
	PishdPlace         *string `json:"pishdPlace"`
	PishdYear          *string `json:"pishdYear"`
	PishdGrade         *string `json:"pishdGrade"`
	TuitionType        *string `json:"tuitionType"`
	TuitionPayer       *int    `json:"tuitionPayer"`
	EnglishExamType    *string `json:"englishExamType"`
	EnglishScore       *string `json:"englishScore"`
	InsertDate         *string `json:"insertDate"`
	InsertTime         *string `json:"insertTime"`
	CertIssued3m       *int    `json:"certIssued3m"`
	DocumentDeficiency *string `json:"documentDeficiency"`
	UnitsRemaining     *int    `json:"unitsRemaining"`
	EqSemesters        *int    `json:"eqSemesters"`
}

// dossierStudentColumns is the shared column list of the big select in page.tsx.
const dossierStudentColumns = `
	st.id, st."studentCode", coalesce(u."nationalCode",''), coalesce(u."firstName",''), coalesce(u."lastName",''),
	coalesce(u."mobile",'—'), st."entryYear", coalesce(st."entryTerm",1), st."entryDate"::text, st.status,
	st."samaStatusCode", coalesce(st."quotaType",'NORMAL'), coalesce(st."currentTermNo",1),
	coalesce(m.name,'—'), coalesce(m."majorCode",'—'), coalesce(f.name,'—'),
	coalesce(d.title,'—'), coalesce(d.id,0), coalesce(d.code,'—'), coalesce(er.title,'—'), st."regulationId",
	coalesce(u."fatherName",'—'), coalesce(u."birthCertNo",'—'), u."birthDate"::text, u.gender,
	coalesce(u."isActive",1), u.id, coalesce(u."placeOfBirth",'—'), coalesce(u."placeOfIssue",'—'),
	u.nationality, u."photoKey",
	st."acceptanceType", st."acceptanceAllocation", st."studyingMode", st."trainingMethod",
	st."graduateDate", st."graduateDegreeLevelId", coalesce(u."firstNameEn",'—'), coalesce(u."lastNameEn",'—'),
	coalesce(u."passportNumber",'—'), u.email, u."postalCode", u.address,
	st."universityId", st."senderUniversityCode",
	st."advisorCode", st."documentStatus", st."scholarshipType", st."militaryStatus", st."militaryExemptionNo",
	st."homeTell", st."studentCardStatus", st."archiveNo", st."parvandehNo", st."dormName", st."dormRoom",
	st."hasDorm", st."guardianJobTitle", st."guardianPhone", st."guardianAddress", st."guardianEmail",
	st."diplomaType", st."diplomaPlace", st."diplomaYear", st."diplomaGrade",
	st."pishdPlace", st."pishdYear", st."pishdGrade", st."tuitionType", st."tuitionPayer",
	st."englishExamType", st."englishScore", st."insertDate", st."insertTime",
	st."certIssued3m", st."documentDeficiency", st."unitsRemaining", st."eqSemesters"`

const dossierStudentJoins = `
	from students st
	join users u on u.id = st."userId"
	left join majors m on m.id = st."majorId"
	left join faculties f on f.id = m."facultyId"
	left join degree_level_configs d on d.id = st."degreeLevelId"
	left join educational_regulations er on er.id = st."regulationId"`

func scanDossierStudent(row pgx.Row) (DossierStudent, error) {
	var s DossierStudent
	err := row.Scan(&s.ID, &s.StudentCode, &s.NationalCode, &s.FirstName, &s.LastName,
		&s.Mobile, &s.EntryYear, &s.EntryTerm, &s.EntryDate, &s.Status,
		&s.SamaStatus, &s.QuotaType, &s.CurrentTerm,
		&s.MajorName, &s.MajorCode, &s.FacultyName,
		&s.DegreeLevel, &s.DegreeLevelI, &s.DegreeCode, &s.RegTitle, &s.RegulationID,
		&s.FatherName, &s.BirthCertNo, &s.BirthDate, &s.Gender,
		&s.IsActive, &s.UserID, &s.PlaceOfBirth, &s.PlaceOfIssue,
		&s.Nationality, &s.PhotoKey,
		&s.AcceptanceType, &s.AcceptanceAlloc, &s.StudyingMode, &s.TrainingMethod,
		&s.GraduateDate, &s.GradDegreeLevelID, &s.FirstNameEn, &s.LastNameEn,
		&s.PassportNumber, &s.Email, &s.PostalCode, &s.Address,
		&s.UniversityID, &s.SenderUniversityCode,
		&s.AdvisorCode, &s.DocumentStatus, &s.ScholarshipType, &s.MilitaryStatus, &s.MilitaryExemptNo,
		&s.HomeTell, &s.StudentCardStatus, &s.ArchiveNo, &s.ParvandehNo, &s.DormName, &s.DormRoom,
		&s.HasDorm, &s.GuardianJobTitle, &s.GuardianPhone, &s.GuardianAddress, &s.GuardianEmail,
		&s.DiplomaType, &s.DiplomaPlace, &s.DiplomaYear, &s.DiplomaGrade,
		&s.PishdPlace, &s.PishdYear, &s.PishdGrade, &s.TuitionType, &s.TuitionPayer,
		&s.EnglishExamType, &s.EnglishScore, &s.InsertDate, &s.InsertTime,
		&s.CertIssued3m, &s.DocumentDeficiency, &s.UnitsRemaining, &s.EqSemesters)
	if err == nil {
		s.Role = "دانشجو"
		if s.Nationality == nil {
			n := "120001"
			s.Nationality = &n
		}
	}
	return s, err
}

// DossierListQuery is the request of the students list (server-side filters).
type DossierListQuery struct {
	Q      string
	Status string
	Degree int64
	Page   int
	Sort   string
	FCode  string
	FName  string
	FMajor string
	FYear  string
	// FNC is the national-code column filter — kept OUT of the app URL in the UI
	// (privacy), passed only to this same-origin API call.
	FNC string
}

// DossierListResponse is the server-paginated list bundle.
type DossierListResponse struct {
	Total        int              `json:"total"`
	Page         int              `json:"page"`
	Per          int              `json:"per"`
	TotalPages   int              `json:"totalPages"`
	Q            string           `json:"q"`
	Status       string           `json:"status"`
	Degree       int64            `json:"degree"`
	Sort         string           `json:"sort"`
	FCode        string           `json:"f_code"`
	FName        string           `json:"f_name"`
	FMajor       string           `json:"f_major"`
	FYear        string           `json:"f_year"`
	Rows         []DossierStudent `json:"rows"`
	StatusCounts []StatusCount    `json:"statusCounts"`
}

// StatusCount is one status chip count.
type StatusCount struct {
	Status string `json:"status"`
	N      int    `json:"n"`
}

const dossierPerPage = 50

// GetStudentsDossierList ports page.tsx (filters + sort + pagination + status counts).
func (s *Service) GetStudentsDossierList(ctx context.Context, user *session.User, cookie string, q DossierListQuery) (*DossierListResponse, error) {
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return nil, err
	}
	if q.Page < 1 {
		q.Page = 1
	}
	conds := []string{`st."universityId" = $1`}
	args := []any{*uniID}
	narg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}

	// EDU_EXPERT major scoping — port of scopedMajorIds (departments/faculties of the expert);
	// without any scope rows the expert sees everything (same as the reference).
	if hasRole(user, "EDU_EXPERT") {
		uid := narg(user.ID)
		conds = append(conds, `(
			st."majorId" in (
				select m2.id from majors m2
				where m2."departmentId" in (select es."scopeId"::int from expert_scopes es where es."userId" = `+uid+` and es."scopeType" = 'DEPARTMENT' and (es."universityId" is null or es."universityId" = $1))
				   or m2."facultyId" in (select es2."scopeId"::int from expert_scopes es2 where es2."userId" = `+uid+` and es2."scopeType" = 'FACULTY' and (es2."universityId" is null or es2."universityId" = $1))
			) or not exists (
				select 1 from expert_scopes es3 where es3."userId" = `+uid+`
				  and (es3."universityId" is null or es3."universityId" = $1)
				  and es3."scopeType" in ('DEPARTMENT','FACULTY')
			)
		)`)
	}

	st := strings.ToUpper(strings.TrimSpace(q.Status))
	if st != "" && st != "ALL" {
		conds = append(conds, `st.status = `+narg(st))
	}
	if q.Degree > 0 {
		conds = append(conds, `st."degreeLevelId" = `+narg(q.Degree))
	}
	if qs := strings.TrimSpace(fa.ToEnDigits(q.Q)); qs != "" {
		like := "%" + fa.EscapeLikeChars(qs) + "%"
		faLike := "%" + fa.EscapeLikeChars(fa.NormalizeFa(q.Q)) + "%"
		conds = append(conds, `(st."studentCode" ilike `+narg(like)+` or u."nationalCode" ilike `+narg(like)+
			` or `+faNormCol(`u."firstName"`)+` ilike `+narg(faLike)+` or `+faNormCol(`u."lastName"`)+` ilike `+narg(faLike)+`)`)
	}
	// Column filters (portal-style ServerTh filter row).
	if f := strings.TrimSpace(q.FCode); f != "" {
		conds = append(conds, `st."studentCode" ilike `+narg("%"+fa.EscapeLikeChars(fa.ToEnDigits(f))+"%"))
	}
	if f := strings.TrimSpace(q.FName); f != "" {
		faLike := "%" + fa.EscapeLikeChars(fa.NormalizeFa(f)) + "%"
		conds = append(conds, `(`+faNormCol(`u."firstName"`)+` ilike `+narg(faLike)+` or `+faNormCol(`u."lastName"`)+` ilike `+narg(faLike)+`)`)
	}
	if f := strings.TrimSpace(q.FNC); f != "" {
		conds = append(conds, `u."nationalCode" ilike `+narg("%"+fa.EscapeLikeChars(fa.ToEnDigits(f))+"%"))
	}
	if f := strings.TrimSpace(q.FMajor); f != "" {
		conds = append(conds, faNormCol(`m.name`)+` ilike `+narg("%"+fa.EscapeLikeChars(fa.NormalizeFa(f))+"%"))
	}
	if reYear4.MatchString(strings.TrimSpace(fa.ToEnDigits(q.FYear))) {
		conds = append(conds, `st."entryYear" = `+narg(intPtrOf(strings.TrimSpace(fa.ToEnDigits(q.FYear)))))
	}

	where := strings.Join(conds, " and ")

	// Column sort: key → asc → desc → newest first (port of the SORTABLE map).
	sortKey, sortDir := "", "asc"
	if parts := strings.Split(strings.TrimSpace(q.Sort), ":"); len(parts) >= 1 {
		sortKey = parts[0]
		if len(parts) > 1 && parts[1] == "desc" {
			sortDir = "desc"
		}
	}
	orderClause := "st.id desc"
	switch sortKey {
	case "studentCode":
		orderClause = pgOrder(sortDir, `st."studentCode"`)
	case "name":
		orderClause = pgOrder(sortDir, `u."lastName"`) + ", " + pgOrder(sortDir, `u."firstName"`)
	case "nc":
		orderClause = pgOrder(sortDir, `u."nationalCode"`)
	case "major":
		orderClause = pgOrder(sortDir, `m.name`)
	case "degree":
		orderClause = pgOrder(sortDir, `d.title`)
	case "year":
		orderClause = pgOrder(sortDir, `st."entryYear"`)
	case "status":
		orderClause = pgOrder(sortDir, `st.status`)
	}

	resp := &DossierListResponse{
		Page: q.Page, Per: dossierPerPage, TotalPages: 1,
		Q: q.Q, Status: st, Degree: q.Degree,
		Sort: q.Sort, FCode: q.FCode, FName: q.FName, FMajor: q.FMajor, FYear: q.FYear,
		Rows: []DossierStudent{}, StatusCounts: []StatusCount{},
	}
	if err := s.DB.Pool.QueryRow(ctx, `
		select count(*) from students st
		join users u on u.id = st."userId"
		left join majors m on m.id = st."majorId"
		where `+where, args...).Scan(&resp.Total); err != nil {
		return nil, err
	}
	if resp.Total < 0 {
		resp.Total = 0
	}
	resp.TotalPages = (resp.Total + dossierPerPage - 1) / dossierPerPage
	if resp.TotalPages < 1 {
		resp.TotalPages = 1
	}
	page := q.Page
	if page > resp.TotalPages {
		page = resp.TotalPages
	}
	resp.Page = page

	offset := (page - 1) * dossierPerPage
	qrows, err := s.DB.Pool.Query(ctx, `select `+dossierStudentColumns+dossierStudentJoins+` where `+where+`
		order by `+orderClause+` limit `+strconv.Itoa(dossierPerPage)+` offset `+strconv.Itoa(offset), args...)
	if err != nil {
		return nil, err
	}
	defer qrows.Close()
	for qrows.Next() {
		stu, err := scanDossierStudent(qrows)
		if err != nil {
			return nil, err
		}
		resp.Rows = append(resp.Rows, stu)
	}
	if err := qrows.Err(); err != nil {
		return nil, err
	}

	// Status chips — current university only (port of statusCounts).
	crows, err := s.DB.Pool.Query(ctx, `
		select status, count(*)::int from students where "universityId" = $1 group by status order by count(*) desc`, *uniID)
	if err == nil {
		defer crows.Close()
		for crows.Next() {
			var c StatusCount
			if crows.Scan(&c.Status, &c.N) == nil {
				resp.StatusCounts = append(resp.StatusCounts, c)
			}
		}
	}
	return resp, nil
}

func pgOrder(dir, col string) string {
	if dir == "desc" {
		return col + " desc"
	}
	return col + " asc"
}

// PickRow is a generic id/title pick.
type PickRow struct {
	ID   int64  `json:"id"`
	Text string `json:"title"`
}

// GeoPlace is one birth/issue place option (title + ministry code).
type GeoPlace struct {
	Title        string  `json:"title"`
	MinistryCode *string `json:"ministryCode"`
}

// CodeLabelMaps is the Sama code label bundle for the transcript header.
type CodeLabelMaps struct {
	Accept         map[string]string `json:"accept"`
	AcceptByTarget map[string]string `json:"acceptByTarget"`
	Period         map[string]string `json:"period"`
	Quota          map[string]string `json:"quota"`
}

// RoleRow is one assignable role (roles modal).
type DossierRoleRow struct {
	ID       int64  `json:"id"`
	Code     string `json:"code"`
	Title    string `json:"title"`
	IsSystem *int   `json:"isSystem"`
}

// UniversityPick is one university (origin/dissolved resolution in the transcript).
type UniversityPick struct {
	ID        int64   `json:"id"`
	Code      string  `json:"code"`
	Title     string  `json:"title"`
	Kind      string  `json:"kind"`
	SaminCode *string `json:"saminCode"`
}

// RegulationPick is one regulation for the dossier dropdown.
type RegulationPick struct {
	ID            int64  `json:"id"`
	Title         string `json:"title"`
	DegreeLevelID int64  `json:"degreeLevelId"`
}

// DossierMeta is the page-level lookup bundle (rendered once per page).
type DossierMeta struct {
	Degrees               []PickRow        `json:"degrees"`
	Regulations           []RegulationPick `json:"regulations"`
	GeoPlaces             []GeoPlace       `json:"geoPlaces"`
	CodeLabels            CodeLabelMaps    `json:"codeLabels"`
	Universities          []UniversityPick `json:"universities"`
	RolesAll              []DossierRoleRow `json:"rolesAll"`
	StatusCounts          []StatusCount    `json:"statusCounts"`
	CurrentUniversityCode string           `json:"currentUniversityCode"`
	CurrentUniversityID   *int64           `json:"currentUniversityId"`
	LogoURL               string           `json:"logoUrl"`
	CanEditGrades         bool             `json:"canEditGrades"`
}

// GetStudentsDossierMeta ports page.tsx lookup queries (degrees, regulations, geo, code maps, roles, universities, logo).
func (s *Service) GetStudentsDossierMeta(ctx context.Context, user *session.User, cookie string) (*DossierMeta, error) {
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return nil, err
	}
	meta := &DossierMeta{
		Degrees: []PickRow{}, Regulations: []RegulationPick{}, GeoPlaces: []GeoPlace{},
		Universities: []UniversityPick{}, RolesAll: []DossierRoleRow{}, StatusCounts: []StatusCount{},
		CodeLabels: CodeLabelMaps{
			Accept: map[string]string{}, AcceptByTarget: map[string]string{},
			Period: map[string]string{}, Quota: map[string]string{},
		},
		CurrentUniversityCode: "AFAGH",
	}
	meta.CanEditGrades = hasRole(user, "ADMIN", "GRADUATEAFFAIRS")

	// Active university code/logo.
	var logoURL, uniCode *string
	_ = s.DB.Pool.QueryRow(ctx, `select code, coalesce("logoUrl",'') from universities where id = $1`, *uniID).Scan(&uniCode, &logoURL)
	if uniCode != nil && strings.TrimSpace(*uniCode) != "" {
		meta.CurrentUniversityCode = *uniCode
	}
	id := *uniID
	meta.CurrentUniversityID = &id
	if meta.LogoURL == "" && s.Store != nil {
		if v, gerr := s.Store.Get(ctx, "UNIVERSITY_LOGO"); gerr == nil {
			meta.LogoURL = v
		}
	}

	// Degrees.
	drows, derr := s.DB.Pool.Query(ctx, `select id, title from degree_level_configs order by id`)
	if derr == nil {
		for drows.Next() {
			var p PickRow
			if drows.Scan(&p.ID, &p.Text) == nil {
				meta.Degrees = append(meta.Degrees, p)
			}
		}
		drows.Close()
	}
	// Regulations.
	rrows, rerr := s.DB.Pool.Query(ctx, `select id, title, coalesce("degreeLevelId",0) from educational_regulations order by "effectiveFromYear", id`)
	if rerr == nil {
		for rrows.Next() {
			var p RegulationPick
			if rrows.Scan(&p.ID, &p.Title, &p.DegreeLevelID) == nil {
				meta.Regulations = append(meta.Regulations, p)
			}
		}
		rrows.Close()
	}
	// Geo places (unique titles with a ministry code).
	grows, gerr := s.DB.Pool.Query(ctx, `
		select distinct title, "ministryCode" from geo_cities
		 where coalesce(title,'') <> '' and "ministryCode" is not null order by title limit 2000`)
	if gerr == nil {
		seen := map[string]bool{}
		for grows.Next() {
			var g GeoPlace
			if grows.Scan(&g.Title, &g.MinistryCode) == nil && !seen[g.Title] {
				seen[g.Title] = true
				meta.GeoPlaces = append(meta.GeoPlaces, g)
			}
		}
		grows.Close()
	}
	// Code label maps (accept/period/quota).
	mrows, merr := s.DB.Pool.Query(ctx, `
		select domain, coalesce("legacyCode",''), coalesce("legacyTitle",''), coalesce("targetCode",'')
		  from legacy_code_maps
		 where domain in ('ACCEPT_TYPE','PERIOD_TYPE','QUOTA')`)
	if merr == nil {
		for mrows.Next() {
			var domain, code, title, target string
			if mrows.Scan(&domain, &code, &title, &target) == nil && code != "" && title != "" {
				switch domain {
				case "ACCEPT_TYPE":
					meta.CodeLabels.Accept[code] = title
					if target != "" {
						meta.CodeLabels.AcceptByTarget[target] = title
					}
				case "PERIOD_TYPE":
					meta.CodeLabels.Period[code] = title
				case "QUOTA":
					meta.CodeLabels.Quota[code] = title
				}
			}
		}
		mrows.Close()
	}
	// Universities.
	urows, uerr := s.DB.Pool.Query(ctx, `
		select id, code, title, kind, "saminCode" from universities where "isActive" = 1 order by id`)
	if uerr == nil {
		for urows.Next() {
			var u UniversityPick
			if urows.Scan(&u.ID, &u.Code, &u.Title, &u.Kind, &u.SaminCode) == nil {
				meta.Universities = append(meta.Universities, u)
			}
		}
		urows.Close()
	}
	// Roles (for the roles modal).
	rrRows, rrerr := s.DB.Pool.Query(ctx, `select id, code, coalesce(title,''), "isSystem" from roles order by id`)
	if rrerr == nil {
		for rrRows.Next() {
			var r DossierRoleRow
			if rrRows.Scan(&r.ID, &r.Code, &r.Title, &r.IsSystem) == nil {
				meta.RolesAll = append(meta.RolesAll, r)
			}
		}
		rrRows.Close()
	}
	// Status chips.
	crows, cerr := s.DB.Pool.Query(ctx, `
		select status, count(*)::int from students where "universityId" = $1 group by status order by count(*) desc`, *uniID)
	if cerr == nil {
		defer crows.Close()
		for crows.Next() {
			var c StatusCount
			if crows.Scan(&c.Status, &c.N) == nil {
				meta.StatusCounts = append(meta.StatusCounts, c)
			}
		}
	}
	return meta, nil
}

// TermStateRow is one student_term_states row (transcript term header).
type TermStateRow struct {
	TermCode  string  `json:"termCode"`
	Title     *string `json:"statusTitle"`
	Probation *bool   `json:"probation"`
}

// GradeAuditRow is one grade_change_log entry (audit modal).
type GradeAuditRow struct {
	ID             int64   `json:"id"`
	EnrollmentID   int64   `json:"enrollmentId"`
	OfferingID     int64   `json:"offeringId"`
	Action         string  `json:"action"`
	OldGradeValue  *string `json:"oldGradeValue"`
	NewGradeValue  *string `json:"newGradeValue"`
	OldGradeStatus *string `json:"oldGradeStatus"`
	NewGradeStatus *string `json:"newGradeStatus"`
	OldSamaCode    *string `json:"oldSamaStatusCode"`
	NewSamaCode    *string `json:"newSamaStatusCode"`
	Reason         *string `json:"reason"`
	ActorUserID    *int64  `json:"actorUserId"`
	ActorRole      *string `json:"actorRole"`
	CreatedAt      *string `json:"createdAt"`
	ActorName      string  `json:"actorName"`
	CourseCode     *string `json:"courseCode"`
	CourseTitle    *string `json:"courseTitle"`
	TermCode       *string `json:"termCode"`
	TermTitle      *string `json:"termTitle"`
}

// StudentDossier is the full per-student dossier payload (drawer body).
type StudentDossier struct {
	Student       DossierStudent  `json:"student"`
	TermStates    []TermStateRow  `json:"termStates"`
	GradeActivity []GradeAuditRow `json:"gradeActivity"`
	EnrollmentN   int             `json:"enrollmentCount"`
	FinalizedN    int             `json:"finalizedCount"`
	DocsStatus    *string         `json:"documentStatus"`
	DocDeficiency *string         `json:"documentDeficiency"`
	ArchiveNo     *string         `json:"archiveNo"`
	ParvandehNo   *string         `json:"parvandehNo"`
}

// GetStudentDossier is the one-student full dossier fetch — identity, KYC/sama
// supplementary fields, documents status and recent grade activity.
func (s *Service) GetStudentDossier(ctx context.Context, user *session.User, cookie string, studentID int64) (*StudentDossier, error) {
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return nil, err
	}
	if err := studentUniversityGate(ctx, s, studentID, uniID); err != nil {
		return nil, err
	}
	out := &StudentDossier{TermStates: []TermStateRow{}, GradeActivity: []GradeAuditRow{}}
	srow := s.DB.Pool.QueryRow(ctx, `select `+dossierStudentColumns+dossierStudentJoins+` where st.id = $1`, studentID)
	stu, err := scanDossierStudent(srow)
	if err != nil {
		return nil, errors.New("دانشجو یافت نشد.")
	}
	out.Student = stu
	out.DocsStatus = stu.DocumentStatus
	out.DocDeficiency = stu.DocumentDeficiency
	out.ArchiveNo = stu.ArchiveNo
	out.ParvandehNo = stu.ParvandehNo

	// Term states (term header of the official transcript).
	trows, terr := s.DB.Pool.Query(ctx, `
		select "termCode", "statusTitle", "isProbation" from student_term_states where "studentId" = $1`, studentID)
	if terr == nil {
		for trows.Next() {
			var t TermStateRow
			var prob *int
			if trows.Scan(&t.TermCode, &t.Title, &prob) == nil {
				if prob != nil {
					b := *prob == 1
					t.Probation = &b
				}
				out.TermStates = append(out.TermStates, t)
			}
		}
		trows.Close()
	}
	// Activity snippets + counts.
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*)::int, count(*) filter (where e."gradeStatus" = 'FINALIZED')::int
		  from enrollments e where e."studentId" = $1`, studentID).Scan(&out.EnrollmentN, &out.FinalizedN)
	grows, gerr := s.DB.Pool.Query(ctx, `
		select g.id, g."enrollmentId", g."offeringId", g.action, g."oldGradeValue", g."newGradeValue",
		       g."oldGradeStatus", g."newGradeStatus", g."oldSamaStatusCode", g."newSamaStatusCode",
		       g.reason, g."actorUserId", g."actorRole", g."createdAt"::text,
		       coalesce(u2."firstName" || ' ' || u2."lastName", ''),
		       c.code, c.title, t."termCode", t.title
		  from grade_change_log g
		  left join users u2 on u2.id = g."actorUserId"
		  left join course_offerings o on o.id = g."offeringId"
		  left join courses c on c.id = o."courseId"
		  left join academic_terms t on t.id = o."termId"
		 where g."studentId" = $1
		 order by g."createdAt" desc limit 10`, studentID)
	if gerr == nil {
		for grows.Next() {
			var g GradeAuditRow
			var actor string
			if grows.Scan(&g.ID, &g.EnrollmentID, &g.OfferingID, &g.Action, &g.OldGradeValue, &g.NewGradeValue,
				&g.OldGradeStatus, &g.NewGradeStatus, &g.OldSamaCode, &g.NewSamaCode,
				&g.Reason, &g.ActorUserID, &g.ActorRole, &g.CreatedAt,
				&actor, &g.CourseCode, &g.CourseTitle, &g.TermCode, &g.TermTitle) == nil {
				g.ActorName = strings.TrimSpace(actor)
				out.GradeActivity = append(out.GradeActivity, g)
			}
		}
		grows.Close()
	}
	return out, nil
}

// ═══════════════════════════════════════════════════════════════════════
//  Group B — transcript (port of actions.getTranscript / getTranscriptRegulation / getCohortStats)
// ═══════════════════════════════════════════════════════════════════════

// TranscriptRow is one transcript row (actions.ts TranscriptRow contract).
type TranscriptRow struct {
	EnrollmentID *int64  `json:"enrollmentId"`
	OfferingID   *int64  `json:"offeringId"`
	TermCode     string  `json:"termCode"`
	TermTitle    *string `json:"termTitle"`
	CourseCode   string  `json:"courseCode"`
	CourseTitle  string  `json:"courseTitle"`
	Units        *string `json:"units"`
	CourseType   *string `json:"courseType"`
	GradeValue   *string `json:"gradeValue"`
	GradeStatus  string  `json:"gradeStatus"`
	StatusTitle  *string `json:"gradeStatusTitle"`
	StatusCode   *string `json:"gradeStatusCode"`
	OfferingType *string `json:"offeringType"`
	TermStatus   *string `json:"termStatusTitle"`
	TermProb     *bool   `json:"termProbation"`
	// ExcludedByRegulation is set when a failed course was later passed (1391 policy).
	ExcludedByRegulation *string `json:"_excludedByRegulation,omitempty"`
}

// gradeStatusTitleMap: static GRADE_STATUS codes first, then the university's
// legacy_code_maps GRADE_STATUS rows override the titles.
func (s *Service) gradeStatusTitleMap(ctx context.Context) map[string]string {
	m := map[string]string{}
	for _, c := range gradestatus.Codes {
		if _, ok := m[c.Code]; !ok {
			m[c.Code] = c.Title
		}
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select "legacyCode", "legacyTitle" from legacy_code_maps where domain = 'GRADE_STATUS'`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var code string
			var title *string
			if rows.Scan(&code, &title) == nil && code != "" && title != nil && *title != "" {
				m[code] = *title
			}
		}
	}
	return m
}

// GetStudentTranscript ports actions.getTranscript — enrollments + legacy rows of
// the same sourceCode only + dropped-only legacy rows + fallback to legacy.
func (s *Service) GetStudentTranscript(ctx context.Context, user *session.User, cookie string, studentID int64) ([]TranscriptRow, error) {
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return nil, err
	}
	if err := studentUniversityGate(ctx, s, studentID, uniID); err != nil {
		return nil, err
	}

	// Student code + owning university code (legacy source scope).
	var studentCode string
	var uniCode *string
	if err := s.DB.Pool.QueryRow(ctx, `
		select st."studentCode", u2.code from students st
		left join universities u2 on u2.id = st."universityId"
		where st.id = $1`, studentID).Scan(&studentCode, &uniCode); err != nil {
		return nil, errors.New("دانشجو یافت نشد.")
	}
	legacySource := legacySourceCodeFor(uniCode)

	titles := s.gradeStatusTitleMap(ctx)
	exactTitle := func(code *string) *string {
		if code == nil {
			return nil
		}
		if t, ok := titles[*code]; ok {
			return &t
		}
		return nil
	}

	// Term states — one query for all terms.
	termStates := map[string]TermStateRow{}
	trows, terr := s.DB.Pool.Query(ctx, `
		select "termCode", "statusTitle", "isProbation" from student_term_states where "studentId" = $1`, studentID)
	if terr == nil {
		for trows.Next() {
			var t TermStateRow
			var prob *int
			if trows.Scan(&t.TermCode, &t.Title, &prob) == nil {
				if prob != nil {
					b := *prob == 1
					t.Probation = &b
				}
				termStates[t.TermCode] = t
			}
		}
		trows.Close()
	}

	out := []TranscriptRow{}
	if legacySource != nil {
		// enrollments (new system) + the same-source legacy raw join.
		erows, qerr := s.DB.Pool.Query(ctx, `
			select e.id, e."offeringId", t."termCode", t.title, c.code, c.title, c.units::text, c."courseType",
			       e."gradeValue"::text, e."gradeStatus", o."offeringType", e."samaGradeStatusCode",
			       lg.raw, lg."sourceCode"
			  from enrollments e
			  join course_offerings o on o.id = e."offeringId"
			  join courses c on c.id = o."courseId"
			  join academic_terms t on t.id = o."termId"
			  left join legacy_grades lg
			    on lg."studentCode" = $2 and lg."termCode" = t."termCode" and lg."courseCode" = c.code and lg."sourceCode" = $3
			 where e."studentId" = $1`, studentID, studentCode, *legacySource)
		if qerr != nil {
			return nil, qerr
		}
		seen := map[string]bool{}
		for erows.Next() {
			var r TranscriptRow
			var enrollmentID, offeringID int64
			var units, gradeValue *string
			var legacyRaw, legacySourceCode *string
			var samaCode *string
			if err := erows.Scan(&enrollmentID, &offeringID, &r.TermCode, &r.TermTitle, &r.CourseCode, &r.CourseTitle,
				&units, &r.CourseType, &gradeValue, &r.GradeStatus, &r.OfferingType, &samaCode,
				&legacyRaw, &legacySourceCode); err != nil {
				erows.Close()
				return nil, err
			}
			r.EnrollmentID = &enrollmentID
			r.OfferingID = &offeringID
			r.Units = units
			r.GradeValue = gradeValue
			// Only the raw of the SAME source may stamp the status code.
			code := samaCode
			if code == nil {
				if ls := legacySourceCodeFor(legacySourceCode); ls != nil && *ls == *legacySource {
					code = markStatOf(legacyRaw)
				}
			}
			r.StatusCode = code
			r.StatusTitle = exactTitle(code)
			if ts, ok := termStates[r.TermCode]; ok {
				r.TermStatus = ts.Title
				r.TermProb = ts.Probation
			}
			seen[r.TermCode+"|"+r.CourseCode] = true
			out = append(out, r)
		}
		erows.Close()
		if err := erows.Err(); err != nil {
			return nil, err
		}

		// Dropped courses without an enrollment (medical drop 14, council 7, …)
		// are display-only rows; add-drop drop (-1) never appears.
		lrows, lerr := s.DB.Pool.Query(ctx, `
			select "sourceCode", "termCode", "courseCode", coalesce("courseTitle",''), units::text,
			       "gradeValue"::text, "gradeStatus", raw
			  from legacy_grades
			 where "studentCode" = $1 and "sourceCode" = $2 limit 1000`, studentCode, *legacySource)
		if lerr == nil {
			for lrows.Next() {
				var sourceCode, termCode, courseCode, courseTitle string
				var units, gradeValue, raw *string
				var gradeStatus string
				if lrows.Scan(&sourceCode, &termCode, &courseCode, &courseTitle, &units, &gradeValue, &gradeStatus, &raw) != nil {
					continue
				}
				if ls := legacySourceCodeFor(&sourceCode); ls == nil || *ls != *legacySource {
					continue
				}
				if seen[termCode+"|"+courseCode] {
					continue
				}
				code := markStatOf(raw)
				if code == nil || *code == "-1" || !gradestatus.IsDropped(*code) {
					continue
				}
				title := courseTitle
				if strings.TrimSpace(title) == "" {
					title = "درس " + courseCode
				}
				r := TranscriptRow{
					TermCode: termCode, CourseCode: courseCode, CourseTitle: title,
					Units: units, GradeValue: gradeValue, GradeStatus: gradeStatus,
					StatusCode: code, StatusTitle: exactTitle(code),
				}
				if ts, ok := termStates[termCode]; ok {
					r.TermStatus = ts.Title
					r.TermProb = ts.Probation
				}
				out = append(out, r)
			}
			lrows.Close()
		}
	}
	if len(out) > 0 {
		sort.SliceStable(out, func(i, j int) bool {
			if out[i].TermCode != out[j].TermCode {
				return out[i].TermCode > out[j].TermCode
			}
			return out[i].CourseCode < out[j].CourseCode
		})
		return out, nil
	}
	// Fallback: legacy only (not yet promoted) — same source scope, max 500.
	if legacySource == nil {
		return out, nil
	}
	frows, ferr := s.DB.Pool.Query(ctx, `
		select "termCode", "courseCode", coalesce("courseTitle",''), units::text, "gradeValue"::text, "gradeStatus", raw
		  from legacy_grades
		 where "studentCode" = $1 and "sourceCode" = $2
		 order by "termCode" desc, "courseCode" asc limit 500`, studentCode, *legacySource)
	if ferr != nil {
		return nil, ferr
	}
	defer frows.Close()
	for frows.Next() {
		var termCode, courseCode, courseTitle string
		var units, gradeValue, raw *string
		var gradeStatus string
		if frows.Scan(&termCode, &courseCode, &courseTitle, &units, &gradeValue, &gradeStatus, &raw) != nil {
			continue
		}
		code := markStatOf(raw)
		title := courseTitle
		if strings.TrimSpace(title) == "" {
			title = "درس " + courseCode
		}
		r := TranscriptRow{
			TermCode: termCode, CourseCode: courseCode, CourseTitle: title,
			Units: units, GradeValue: gradeValue, GradeStatus: gradeStatus,
			StatusCode: code, StatusTitle: exactTitle(code),
		}
		if ts, ok := termStates[termCode]; ok {
			r.TermStatus = ts.Title
			r.TermProb = ts.Probation
		}
		out = append(out, r)
	}
	return out, frows.Err()
}

// RegConfig is the minimal RegulationConfig shape the transcript core consumes.
type RegConfig struct {
	GradingAndGPA struct {
		DefaultPassingGrade   *float64 `json:"default_passing_grade"`
		FailedSamaStatusCode  string   `json:"failed_sama_status_code"`
		RetakeMinGrade        *float64 `json:"retakeMinGrade"`
		FailedCourseGpaPolicy string   `json:"failed_course_gpa_policy"`
		RegulationLabel       string   `json:"regulationLabel"`
		DedupeRepeatedCourses bool     `json:"dedupeRepeatedCourses"`
	} `json:"grading_and_gpa"`
	ProbationAndTenure struct {
		ProbationGpaThreshold *float64 `json:"probation_gpa_threshold"`
	} `json:"probation_and_tenure"`
	RegularTermRules struct {
		MinUnits *float64 `json:"min_units"`
	} `json:"regular_term_rules"`
	Levels struct {
		LONG  struct {
			MinUnits *float64 `json:"min_units"`
		} `json:"LONG"`
		SHORT struct {
			MinUnits *float64 `json:"min_units"`
		} `json:"SHORT"`
	} `json:"levels"`
}

// TranscriptRegulation is the port of getTranscriptRegulation.
type TranscriptRegulation struct {
	Title  *string    `json:"title"`
	Config *RegConfig `json:"config"`
}

// GetStudentTranscriptRegulation returns the operative regulation config of the student.
func (s *Service) GetStudentTranscriptRegulation(ctx context.Context, user *session.User, cookie string, studentID int64) (*TranscriptRegulation, error) {
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return nil, err
	}
	if err := studentUniversityGate(ctx, s, studentID, uniID); err != nil {
		return nil, err
	}
	var regID *int64
	var degreeLevelID int64
	err = s.DB.Pool.QueryRow(ctx, `
		select st."regulationId", st."degreeLevelId" from students st where st.id = $1`, studentID).
		Scan(&regID, &degreeLevelID)
	if err != nil {
		return nil, errors.New("دانشجو یافت نشد.")
	}
	out := &TranscriptRegulation{}
	if regID != nil {
		_ = s.DB.Pool.QueryRow(ctx, `select title from educational_regulations where id = $1`, *regID).Scan(&out.Title)
		var raw *string
		if s.DB.Pool.QueryRow(ctx, `select "rulesConfig" from educational_regulations where id = $1`, *regID).Scan(&raw) == nil && raw != nil {
			var cfg RegConfig
			if json.Unmarshal([]byte(*raw), &cfg) == nil {
				out.Config = &cfg
			}
		}
	}
	return out, nil
}

// CohortStats is the rank footer of the official transcript (port of getCohortStats).
type CohortStats struct {
	Scope     string   `json:"scope"`
	Rank      *int     `json:"rank"`
	Total     int      `json:"total"`
	AvgGpa    *float64 `json:"avgGpa"`
	AvgPassed *float64 `json:"avgPassed"`
}

// cohortGPACap bounds the per-student GPA computation (rank footer only).
const cohortGPACap = 400

// officialGpaOfStudent computes the official GPA of one student with the pure gpa
// core (same rules as calculateOfficialGPA: policy + retake bar + dedupe).
func (s *Service) officialGpaOfStudent(ctx context.Context, studentID int64) (gpaVal float64, passed float64, ok bool) {
	var regID *int64
	if s.DB.Pool.QueryRow(ctx, `select "regulationId" from students where id = $1`, studentID).
		Scan(&regID) != nil {
		return 0, 0, false
	}
	passing := 10.0
	retake := 10.0
	policy := "EXCLUDE_IF_PASSED"
	dedupe := false
	if regID != nil {
		var raw *string
		if s.DB.Pool.QueryRow(ctx, `select "rulesConfig" from educational_regulations where id = $1`, *regID).Scan(&raw) == nil && raw != nil {
			var cfg RegConfig
			if json.Unmarshal([]byte(*raw), &cfg) == nil {
				if cfg.GradingAndGPA.DefaultPassingGrade != nil && *cfg.GradingAndGPA.DefaultPassingGrade > 0 {
					passing = *cfg.GradingAndGPA.DefaultPassingGrade
				}
				if cfg.GradingAndGPA.RetakeMinGrade != nil && *cfg.GradingAndGPA.RetakeMinGrade > 0 {
					retake = *cfg.GradingAndGPA.RetakeMinGrade
				} else {
					retake = passing
				}
				if cfg.GradingAndGPA.FailedCourseGpaPolicy != "" {
					policy = cfg.GradingAndGPA.FailedCourseGpaPolicy
				}
				dedupe = cfg.GradingAndGPA.DedupeRepeatedCourses
			}
		}
	}
	// GPA-eligible rows (same rule as loadOfficialGpaRows).
	rows, qerr := s.DB.Pool.Query(ctx, `
		select c.code, c.units::text, e."gradeValue"::text, e."gradeStatus", e."samaGradeStatusCode",
		       c."gradingType", c."affectsGpa", c."minPassedMark"::text
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1 and e."gradeStatus" in ('FINALIZED','EXEMPT','PASSED_NO_GRADE')`, studentID)
	if qerr != nil {
		return 0, 0, false
	}
	defer rows.Close()
	gpaRows := []gpa.Row{}
	for rows.Next() {
		var r gpa.Row
		if rows.Scan(&r.Code, &r.Units, &r.GradeValue, &r.GradeStatus, &r.SamaGradeStatusCode,
			&r.GradingType, &r.AffectsGpa, &r.CourseMinMark) != nil {
			return 0, 0, false
		}
		gpaRows = append(gpaRows, r)
	}
	if err := rows.Err(); err != nil {
		return 0, 0, false
	}
	core := gpa.AggregateOfficialGpaRows(gpaRows, gpa.OfficialInput{
		PassingGrade: passing, RetakeMinGrade: retake, Policy: policy, DedupeRepeated: dedupe,
	})
	return core.GPA, core.PassedUnits, core.TotalUnits > 0 && core.GPA > 0
}

// GetStudentCohortStats ports getCohortStats — rank of the student among
// same-major + same-entry-year (+ same entry term in term scope) students.
func (s *Service) GetStudentCohortStats(ctx context.Context, user *session.User, cookie string, studentID int64, scope string) (*CohortStats, error) {
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return nil, err
	}
	if err := studentUniversityGate(ctx, s, studentID, uniID); err != nil {
		return nil, err
	}
	var majorID *int64
	var entryYear *int
	var entryTerm *int
	var stuUni *int64
	qerr := s.DB.Pool.QueryRow(ctx, `
		select "majorId", "entryYear", "entryTerm", "universityId" from students where id = $1`, studentID).
		Scan(&majorID, &entryYear, &entryTerm, &stuUni)
	if qerr != nil || majorID == nil || entryYear == nil {
		return nil, nil
	}
	conds := []string{`"majorId" = $1`, `"entryYear" = $2`,
		`status not in ('NO_SHOW','WITHDRAWN','EXPELLED')`}
	args := []any{*majorID, *entryYear}
	idx := 3
	if scope == "term" && entryTerm != nil {
		conds = append(conds, fmt.Sprintf(`"entryTerm" = $%d`, idx))
		args = append(args, *entryTerm)
		idx++
	}
	if stuUni != nil {
		conds = append(conds, fmt.Sprintf(`"universityId" = $%d`, idx))
		args = append(args, *stuUni)
		idx++
	}
	rows, qerr2 := s.DB.Pool.Query(ctx, `select id from students where `+strings.Join(conds, " and ")+` limit `+strconv.Itoa(cohortGPACap), args...)
	if qerr2 != nil {
		return nil, qerr2
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	if len(ids) == 0 {
		return nil, nil
	}
	type cohortGpa struct {
		id     int64
		gpa    float64
		passed float64
	}
	gpas := []cohortGpa{}
	for _, id := range ids {
		gv, pv, ok := s.officialGpaOfStudent(ctx, id)
		if ok {
			gpas = append(gpas, cohortGpa{id, gv, pv})
		}
	}
	if len(gpas) == 0 {
		return nil, nil
	}
	out := &CohortStats{Scope: scope, Total: len(gpas)}
	sumG, sumP := 0.0, 0.0
	for _, g := range gpas {
		sumG += g.gpa
		sumP += g.passed
		if g.id == studentID {
			rank := 1
			for _, o := range gpas {
				if o.gpa > g.gpa {
					rank++
				}
			}
			out.Rank = &rank
		}
	}
	avgG := sumG / float64(len(gpas))
	avgP := sumP / float64(len(gpas))
	out.AvgGpa = &avgG
	out.AvgPassed = &avgP
	return out, nil
}

// ═══════════════════════════════════════════════════════════════════════
//  Group C — regulation change + admin grade editing
//  (port of setStudentRegulationAction + grades/actions.ts)
// ═══════════════════════════════════════════════════════════════════════

// SetStudentRegulation ports setStudentRegulationAction — change the operative
// regulation + cascade-recompute the status codes of all finalized grades.
func (s *Service) SetStudentRegulation(ctx context.Context, user *session.User, cookie string, studentID, regulationID int64) (scanned, updated int, err error) {
	if !hasRole(user, "ADMIN", "EDU_EXPERT", "GRADUATEAFFAIRS") {
		return 0, 0, errors.New("دسترسی لازم را ندارید.")
	}
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return 0, 0, err
	}
	if studentID <= 0 || regulationID <= 0 {
		return 0, 0, errors.New("دانشجو یا آیین‌نامه نامعتبر است.")
	}
	if err := studentUniversityGate(ctx, s, studentID, uniID); err != nil {
		return 0, 0, err
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		update students set "regulationId" = $2 where id = $1 and ("universityId" = $3 or "universityId" is null)`,
		studentID, regulationID, *uniID); err != nil {
		return 0, 0, err
	}

	// Cascade: recompute codes of finalized grades with the new regulation.
	var actorRolePtr *string
	switch {
	case hasRole(user, "ADMIN"):
		actorRolePtr = strp("ADMIN")
	case hasRole(user, "GRADUATEAFFAIRS"):
		actorRolePtr = strp("GRADUATEAFFAIRS")
	}

	resolver := newSamaResolver(ctx, s)
	enrows, qerr := s.DB.Pool.Query(ctx, `
		select e.id, e."offeringId", e."gradeValue"::float8, e."samaGradeStatusCode"
		  from enrollments e
		 where e."studentId" = $1 and e."gradeStatus" = 'FINALIZED'`, studentID)
	if qerr != nil {
		return 0, 0, nil // regulation already changed — code-review errors are not reported
	}
	type enrRow struct {
		id         int64
		offeringID int64
		grade      *float64
		code       *string
	}
	enrs := []enrRow{}
	for enrows.Next() {
		var e enrRow
		if enrows.Scan(&e.id, &e.offeringID, &e.grade, &e.code) == nil {
			enrs = append(enrs, e)
		}
	}
	enrows.Close()
	scanned = len(enrs)
	reason := "بازبینی خودکار کد وضعیت پس از تغییر آیین‌نامه ملاک دانشجو"
	courseIDs := map[int64]bool{}
	for _, e := range enrs {
		cur := ptrTrim(e.code)
		// Special pass codes (like 12 compensatory, set manually) are preserved.
		if cur != nil && *cur != "1" && gradestatus.IsPassed(*cur) {
			courseIDs[e.offeringID] = true
			continue
		}
		// Frozen codes (5/6/7/22) never change by a regulation cascade.
		if cur != nil && gradestatus.RegulationFrozenCodes[*cur] {
			courseIDs[e.offeringID] = true
			continue
		}
		correct := resolver.resolve(studentID, e.offeringID, e.grade, e.code)
		correctPtr := ptrTrim(&correct)
		if strPtrEq(correctPtr, cur) {
			courseIDs[e.offeringID] = true
			continue
		}
		var codeArg any
		if correctPtr != nil {
			codeArg = *correctPtr
		}
		if _, err := s.DB.Pool.Exec(ctx, `
			update enrollments set "samaGradeStatusCode" = $2,
			       "originalSamaCode" = coalesce("originalSamaCode", "samaGradeStatusCode")
			 where id = $1`, e.id, codeArg); err != nil {
			continue
		}
		_ = logGradeChange(ctx, s.DB.Pool, GradeChangeEntry{
			EnrollmentID: e.id, StudentID: studentID, OfferingID: e.offeringID,
			Action: "REGULATION_CASCADE",
			OldGradeStatus: strp("FINALIZED"), NewGradeStatus: strp("FINALIZED"),
			OldSamaStatusCode: cur, NewSamaStatusCode: correctPtr,
			Reason: &reason, ActorUserID: &user.ID, ActorRole: actorRolePtr,
			UniversityID: uniID,
		})
		updated++
	}
	// Chain sync per course of the touched offerings (effect of a failed grade
	// after a later pass).
	for _, e := range enrs {
		var cid int64
		if s.DB.Pool.QueryRow(ctx, `select "courseId" from course_offerings where id = $1`, e.offeringID).Scan(&cid) == nil && cid > 0 {
			courseIDs[cid] = true
		}
	}
	for cid := range courseIDs {
		if cid <= 0 {
			continue
		}
		_, _, _ = s.SyncStudentCourseRegulations(ctx, studentID, cid, &user.ID, actorRolePtr)
	}
	return scanned, updated, nil
}

// regulationFailExcludeCodeOf is the port of getRegulationFailExcludeCode.
func regulationFailExcludeCodeOf(regTitle *string, cfg *RegConfig) *string {
	if cfg != nil {
		if c := strings.TrimSpace(cfg.GradingAndGPA.FailedSamaStatusCode); c != "" {
			return &c
		}
	}
	policy := ""
	if cfg != nil {
		policy = cfg.GradingAndGPA.FailedCourseGpaPolicy
	}
	if policy == "EXCLUDE_IF_PASSED_1391" {
		return strp("-91")
	}
	if regTitle != nil {
		t := *regTitle
		if strings.Contains(t, "۹۴") || strings.Contains(t, "94") {
			return strp("941")
		}
		if strings.Contains(t, "۹۵") || strings.Contains(t, "95") {
			return strp("951")
		}
	}
	if policy == "EXCLUDE_ALWAYS" {
		return nil
	}
	if policy == "EXCLUDE_IF_PASSED" {
		return strp("931")
	}
	return nil
}

// retakeBarOf is the port of resolveRetakeBar.
func retakeBarOf(policy string, retakeMin, passing float64) float64 {
	if policy != "EXCLUDE_IF_PASSED_1391" {
		return passing
	}
	if retakeMin > 0 {
		return retakeMin
	}
	if passing > 0 {
		return passing
	}
	return 10
}

// SyncStudentCourseRegulations is the port of syncStudentCourseRegulations —
// chain-sync every attempt of one course for one student. Returns the update count.
func (s *Service) SyncStudentCourseRegulations(ctx context.Context, studentID, courseID int64, actorUserID *int64, actorRole *string) (int, *string, error) {
	var regTitle *string
	var rawCfg *string
	err := s.DB.Pool.QueryRow(ctx, `
		select er.title, er."rulesConfig" from students st
		left join educational_regulations er on er.id = st."regulationId"
		 where st.id = $1`, studentID).Scan(&regTitle, &rawCfg)
	if err != nil {
		return 0, nil, nil
	}
	var cfg *RegConfig
	if rawCfg != nil {
		var c RegConfig
		if json.Unmarshal([]byte(*rawCfg), &c) == nil {
			cfg = &c
		}
	}
	targetExclude := regulationFailExcludeCodeOf(regTitle, cfg)
	policy := ""
	retakeMin := 0.0
	passing := 10.0
	if cfg != nil {
		policy = cfg.GradingAndGPA.FailedCourseGpaPolicy
		if cfg.GradingAndGPA.DefaultPassingGrade != nil && *cfg.GradingAndGPA.DefaultPassingGrade > 0 {
			passing = *cfg.GradingAndGPA.DefaultPassingGrade
		}
		if cfg.GradingAndGPA.RetakeMinGrade != nil {
			retakeMin = *cfg.GradingAndGPA.RetakeMinGrade
		}
	}
	var gradingType *string
	var courseMin *float64
	var defaultReject *string
	if err := s.DB.Pool.QueryRow(ctx, `
		select "gradingType", "minPassedMark"::float8, "defaultRejectMarkState"
		  from courses where id = $1`, courseID).Scan(&gradingType, &courseMin, &defaultReject); err != nil {
		return 0, nil, nil
	}
	if courseMin != nil && *courseMin > 0 {
		passing = *courseMin
	}
	retakeBar := retakeBarOf(policy, retakeMin, passing)

	rows, qerr := s.DB.Pool.Query(ctx, `
		select e.id, e."offeringId", e."gradeValue"::text, e."gradeStatus", e."samaGradeStatusCode",
		       e."originalSamaCode", t."termCode", t."sortOrder"
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  left join academic_terms t on t.id = o."termId"
		 where e."studentId" = $1 and o."courseId" = $2`, studentID, courseID)
	if qerr != nil {
		return 0, nil, qerr
	}
	type attempt struct {
		id, offeringID int64
		grade          *string
		status         string
		code, orig     *string
		termCode       *string
		sortOrder      *int
	}
	all := []attempt{}
	for rows.Next() {
		var a attempt
		if rows.Scan(&a.id, &a.offeringID, &a.grade, &a.status, &a.code, &a.orig, &a.termCode, &a.sortOrder) == nil {
			all = append(all, a)
		}
	}
	rows.Close()
	if len(all) == 0 {
		return 0, targetExclude, nil
	}
	sort.SliceStable(all, func(i, j int) bool {
		return termChronologicalValue(all[i].termCode, all[i].sortOrder) < termChronologicalValue(all[j].termCode, all[j].sortOrder)
	})
	isPassedAttempt := func(a attempt, bar float64) bool {
		if a.status == "EXEMPT" || a.status == "PASSED_NO_GRADE" {
			return true
		}
		if a.code != nil && gradestatus.IsPassed(*a.code) {
			return true
		}
		if a.status != "FINALIZED" {
			return false
		}
		g := numOf(*a.grade)
		if g == nil {
			return false
		}
		if gradingType != nil && *gradingType == "DESCRIPTIVE" {
			return *g == 1
		}
		return *g >= bar
	}
	updated := 0
	for i := range all {
		cur := all[i]
		if isPassedAttempt(cur, passing) {
			continue // passing records stay untouched
		}
		if cur.status != "FINALIZED" {
			continue // pending rows never receive regulation-drop codes
		}
		oldCode := ptrTrim(cur.code)
		origCode := ptrTrim(cur.orig)
		// Self-heal: a frozen original code that was overwritten comes back.
		if origCode != nil && gradestatus.RegulationFrozenCodes[*origCode] &&
			(oldCode == nil || !gradestatus.RegulationFrozenCodes[*oldCode]) {
			if _, err := s.DB.Pool.Exec(ctx, `update enrollments set "samaGradeStatusCode" = $2 where id = $1`, cur.id, *origCode); err == nil {
				reason := fmt.Sprintf("بازگردانی خودکار کد منجمد %s (کد %s به‌اشتباه با آیین‌نامه نشسته بود)", *origCode, orDash(oldCode))
				_ = logGradeChange(ctx, s.DB.Pool, GradeChangeEntry{
					EnrollmentID: cur.id, StudentID: studentID, OfferingID: cur.offeringID,
					Action: "REGULATION_CASCADE",
					OldGradeValue: cur.grade, NewGradeValue: cur.grade,
					OldGradeStatus: &cur.status, NewGradeStatus: &cur.status,
					OldSamaStatusCode: oldCode, NewSamaStatusCode: origCode,
					Reason: &reason, ActorUserID: actorUserID, ActorRole: actorRole,
				})
				updated++
			}
			continue
		}
		// Student/administrative codes are never touched by the regulation.
		if oldCode != nil && frozenCascadeSkip[*oldCode] {
			continue
		}
		// A course with a special fail code (not 2) is not retouched.
		if dr := ptrTrim(defaultReject); dr != nil && *dr != "2" && *dr != "931" && *dr != "-91" && *dr != "941" {
			continue
		}
		hasLaterPass := false
		for j := i + 1; j < len(all); j++ {
			if isPassedAttempt(all[j], retakeBar) {
				hasLaterPass = true
				break
			}
		}
		newCode := "2"
		if hasLaterPass && targetExclude != nil {
			newCode = *targetExclude
		}
		if oldCode == nil || *oldCode != newCode {
			if _, err := s.DB.Pool.Exec(ctx, `update enrollments set "samaGradeStatusCode" = $2 where id = $1`, cur.id, newCode); err == nil {
				reason := "تبدیل خودکار نمره مردودی به کد حذف آیین‌نامه (" + newCode + ") پس از قبولی در ترم بعد"
				if !hasLaterPass {
					reason = "بازگشت خودکار کد مردودی به ۲ پس از حذف/عدم احراز قبولی بعدی"
				}
				_ = logGradeChange(ctx, s.DB.Pool, GradeChangeEntry{
					EnrollmentID: cur.id, StudentID: studentID, OfferingID: cur.offeringID,
					Action: "REGULATION_CASCADE",
					OldGradeValue: cur.grade, NewGradeValue: cur.grade,
					OldGradeStatus: &cur.status, NewGradeStatus: &cur.status,
					OldSamaStatusCode: oldCode, NewSamaStatusCode: strp(newCode),
					Reason: &reason, ActorUserID: actorUserID, ActorRole: actorRole,
				})
				updated++
			}
		}
	}
	return updated, targetExclude, nil
}

// frozenCascadeSkip mirrors the protected-code list of the TS chain sync.
var frozenCascadeSkip = map[string]bool{
	"3": true, "4": true, "5": true, "6": true, "7": true, "14": true, "16": true,
	"17": true, "18": true, "22": true, "32": true, "40": true, "44": true, "50": true,
	"51": true, "53": true, "52": true, "300": true, "400": true,
	"-1": true, "-5": true, "-4": true, "-3": true, "0": true, "8": true, "9": true,
	"10": true, "13": true, "15": true, "19": true, "20": true, "28": true, "29": true,
	"36": true, "46": true,
}

// ResolveSamaCodeForGrade ports resolveSamaCodeForGradeAction (preview for the modal).
func (s *Service) ResolveSamaCodeForGrade(ctx context.Context, user *session.User, cookie string, studentID, offeringID int64, gradeValue *float64) (code *string, title string, err error) {
	if !hasRole(user, "ADMIN", "EDU_EXPERT", "VICE_EDU") {
		return nil, "نامشخص", errors.New("دسترسی لازم را ندارید.")
	}
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return nil, "نامشخص", err
	}
	if gerr := studentUniversityGate(ctx, s, studentID, uniID); gerr != nil {
		return nil, "نامشخص", nil
	}
	resolver := newSamaResolver(ctx, s)
	c := resolver.resolve(studentID, offeringID, gradeValue, nil)
	code = ptrTrim(&c)
	title = "نامشخص"
	if code != nil {
		if t := gradestatus.TitleOf(*code); t != nil {
			title = *t
		}
	}
	return code, title, nil
}

// AdminGradeInput is the payload of the grade modal (adminSetGradeAction).
type AdminGradeInput struct {
	EnrollmentID *int64   `json:"enrollmentId"`
	OfferingID   *int64   `json:"offeringId"`
	StudentID    int64    `json:"studentId"`
	StudentCode  string   `json:"studentCode"`
	TermCode     *string  `json:"termCode"`
	CourseCode   *string  `json:"courseCode"`
	GradeValue   *float64 `json:"gradeValue"`
	CustomCode   *string  `json:"customSamaStatusCode"`
	Reason       string   `json:"reason"`
}

// AdminSetGradeResult mirrors AdminGradeState.
type AdminSetGradeResult struct {
	Message string `json:"message,omitempty"`
}

// AdminSetGrade ports adminSetGradeAction — admin/graduate-affairs grade write
// with audit log + automatic sama code (step-up is enforced by the HTTP layer).
func (s *Service) AdminSetGrade(ctx context.Context, user *session.User, cookie string, in AdminGradeInput) (*AdminSetGradeResult, error) {
	if !hasRole(user, "ADMIN", "GRADUATEAFFAIRS") {
		return nil, errors.New("فقط مدیر سیستم یا کارشناس فارغ‌التحصیلان اجازه ثبت نمره دارد.")
	}
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return nil, err
	}
	// Validation.
	if in.GradeValue != nil && (*in.GradeValue < 0 || *in.GradeValue > 20) {
		return nil, errors.New("نمره باید بین ۰ تا ۲۰ باشد.")
	}
	if len([]rune(strings.TrimSpace(in.Reason))) < 3 {
		return nil, errors.New("دلیل تغییر الزامی است (حداقل ۳ نویسه).")
	}
	if gerr := studentUniversityGate(ctx, s, in.StudentID, uniID); gerr != nil {
		return nil, gerr
	}
	var stuStatus string
	_ = s.DB.Pool.QueryRow(ctx, `select status from students where id = $1`, in.StudentID).Scan(&stuStatus)
	// Graduated/inactive students: a full reason (>=10 chars) is mandatory.
	if stuStatus != "" && stuStatus != "ACTIVE" && stuStatus != "PROBATION" {
		if len([]rune(strings.TrimSpace(in.Reason))) < 10 {
			label := "غیرفعال"
			if stuStatus == "GRADUATED" {
				label = "فارغ‌التحصیل"
			}
			return nil, errors.New("دانشجو " + label + " است — تغییر نمره نیازمند دلیل کامل‌تر (≥۱۰ نویسه) و تأیید خاص است.")
		}
	}
	// The legacy sync scope of THIS university only.
	var uniCode *string
	_ = s.DB.Pool.QueryRow(ctx, `select code from universities where id = $1`, *uniID).Scan(&uniCode)
	legacySource := legacySourceCodeFor(uniCode)

	gradeStr := (*string)(nil)
	if in.GradeValue != nil {
		v := strconv.FormatFloat(*in.GradeValue, 'f', -1, 64)
		gradeStr = &v
	}
	role := "GRADUATEAFFAIRS"
	if hasRole(user, "ADMIN") {
		role = "ADMIN"
	}

	targetOffering := int64(0)
	var existingID int64
	var existingOffering int64
	var existingGrade, existingStatus, existingCode *string
	hasExisting := false

	if in.EnrollmentID != nil && *in.EnrollmentID > 0 {
		var eUni, eStudent *int64
		err := s.DB.Pool.QueryRow(ctx, `
			select id, "offeringId", "gradeValue"::text, "gradeStatus", "samaGradeStatusCode", "universityId", "studentId"
			  from enrollments where id = $1`, *in.EnrollmentID).
			Scan(&existingID, &existingOffering, &existingGrade, &existingStatus, &existingCode, &eUni, &eStudent)
		if err == nil {
			if eUni != nil && *eUni != *uniID {
				return nil, errors.New("ثبت‌نام متعلق به دانشگاه دیگری است.")
			}
			if eStudent == nil || *eStudent != in.StudentID {
				return nil, errors.New("ثبت‌نام متعلق به این دانشجو نیست.")
			}
			hasExisting = true
			targetOffering = existingOffering
		}
	}
	if !hasExisting && in.OfferingID != nil && *in.OfferingID > 0 {
		targetOffering = *in.OfferingID
		var eID int64
		var eUni *int64
		err := s.DB.Pool.QueryRow(ctx, `
			select id, "gradeValue"::text, "gradeStatus", "samaGradeStatusCode", "universityId"
			  from enrollments where "studentId" = $1 and "offeringId" = $2`, in.StudentID, targetOffering).
			Scan(&eID, &existingGrade, &existingStatus, &existingCode, &eUni)
		if err == nil {
			if eUni != nil && *eUni != *uniID {
				return nil, errors.New("ثبت‌نام متعلق به دانشگاه دیگری است.")
			}
			existingID = eID
			existingOffering = targetOffering
			hasExisting = true
		} else {
			// Direct offering without an enrollment — the university ownership is checked too.
			var offUni *int64
			if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from course_offerings where id = $1`, targetOffering).Scan(&offUni); err != nil {
				return nil, errors.New("ارائه یافت نشد.")
			}
			if offUni != nil && *offUni != *uniID {
				return nil, errors.New("ارائه متعلق به دانشگاه دیگری است.")
			}
		}
	}
	// No offering but term+course known → find or create a TRANSFER offering.
	if targetOffering <= 0 && in.TermCode != nil && strings.TrimSpace(*in.TermCode) != "" &&
		in.CourseCode != nil && strings.TrimSpace(*in.CourseCode) != "" {
		var courseID, termID int64
		cerr := s.DB.Pool.QueryRow(ctx, `
			select id from courses where code = $1 and ("universityId" = $2 or "universityId" is null) limit 1`, *in.CourseCode, *uniID).Scan(&courseID)
		terr := s.DB.Pool.QueryRow(ctx, `
			select id from academic_terms where "termCode" = $1 and ("universityId" = $2 or "universityId" is null) limit 1`, *in.TermCode, *uniID).Scan(&termID)
		if cerr == nil && terr == nil {
			var offID int64
			oerr := s.DB.Pool.QueryRow(ctx, `
				select id from course_offerings where "termId" = $1 and "courseId" = $2 limit 1`, termID, courseID).Scan(&offID)
			if oerr != nil {
				insErr := s.DB.Pool.QueryRow(ctx, `
					insert into course_offerings ("universityId","termId","courseId","groupNumber","capacity","offeringType")
					values ($1,$2,$3,1,999,'TRANSFER') returning id`, *uniID, termID, courseID).Scan(&offID)
				if insErr != nil {
					return nil, errors.New("شناسه ارائه درس یا درس و ترم مربوطه یافت نشد.")
				}
			}
			targetOffering = offID
			var eID int64
			if s.DB.Pool.QueryRow(ctx, `
				select id, "gradeValue"::text, "gradeStatus", "samaGradeStatusCode"
				  from enrollments where "studentId" = $1 and "offeringId" = $2`, in.StudentID, offID).
				Scan(&eID, &existingGrade, &existingStatus, &existingCode) == nil {
				existingID = eID
				existingOffering = offID
				hasExisting = true
			}
		}
	}
	if targetOffering <= 0 {
		return nil, errors.New("شناسه ارائه درس یا درس و ترم مربوطه یافت نشد.")
	}

	// Finalize-lock: writing over FINALIZED rows only with an approved reopen request.
	if gate := s.gradeWriteGate(ctx, targetOffering); gate != nil {
		return nil, gate
	}

	// Manual codes must come from the known list; unknown codes are rejected.
	rawCustom := ptrTrim(in.CustomCode)
	if rawCustom != nil && gradestatus.TitleOf(*rawCustom) == nil {
		return nil, errors.New("کد وضعیت سما (" + *rawCustom + ") در فهرست کدهای شناخته‌شده نیست؛ از فهرست معتبر انتخاب کنید.")
	}
	samaCode := ""
	if rawCustom != nil {
		samaCode = *rawCustom
	} else {
		resolver := newSamaResolver(ctx, s)
		var cur *string
		if hasExisting {
			cur = existingCode
		}
		samaCode = resolver.resolve(in.StudentID, targetOffering, in.GradeValue, cur)
	}
	var samaArg any
	if samaCode != "" {
		samaArg = samaCode
	}

	enrollmentID := existingID
	if hasExisting {
		if _, err := s.DB.Pool.Exec(ctx, `
			update enrollments set "gradeValue" = $2, "gradeStatus" = 'FINALIZED', "samaGradeStatusCode" = $3
			 where id = $1 and ("universityId" = $4 or "universityId" is null)`,
			existingID, gradeStr, samaArg, *uniID); err != nil {
			return nil, err
		}
	} else {
		if err := s.DB.Pool.QueryRow(ctx, `
			insert into enrollments ("universityId","studentId","offeringId","status","gradeValue","gradeStatus","samaGradeStatusCode")
			values ($1,$2,$3,'REGISTERED',$4,'FINALIZED',$5) returning id`,
			*uniID, in.StudentID, targetOffering, gradeStr, samaArg).Scan(&enrollmentID); err != nil {
			return nil, err
		}
	}
	reason := strings.TrimSpace(in.Reason)
	var newSama *string
	if samaCode != "" {
		newSama = strp(samaCode)
	}
	_ = logGradeChange(ctx, s.DB.Pool, GradeChangeEntry{
		EnrollmentID: enrollmentID, StudentID: in.StudentID, OfferingID: targetOffering,
		Action: "ADMIN_OVERRIDE",
		OldGradeValue: existingGrade, NewGradeValue: gradeStr,
		OldGradeStatus: existingStatus, NewGradeStatus: strp("FINALIZED"),
		OldSamaStatusCode: existingCode, NewSamaStatusCode: newSama,
		Reason: &reason, ActorUserID: &user.ID, ActorRole: &role,
		UniversityID: uniID,
	})

	// legacy_grades sync when term+course match (same source scope only).
	if in.TermCode != nil && strings.TrimSpace(*in.TermCode) != "" &&
		in.CourseCode != nil && strings.TrimSpace(*in.CourseCode) != "" && legacySource != nil {
		_, _ = s.DB.Pool.Exec(ctx, `
			update legacy_grades set "gradeValue" = $4, "gradeStatus" = 'FINALIZED'
			 where "studentCode" = $1 and "termCode" = $2 and "courseCode" = $3 and "sourceCode" = $5`,
			in.StudentCode, *in.TermCode, *in.CourseCode, gradeStr, *legacySource)
	}

	// Chain sync of the regulation for every attempt of this course.
	var courseID int64
	if s.DB.Pool.QueryRow(ctx, `select "courseId" from course_offerings where id = $1`, targetOffering).Scan(&courseID) == nil {
		_, _, _ = s.SyncStudentCourseRegulations(ctx, in.StudentID, courseID, &user.ID, &role)
	}
	return &AdminSetGradeResult{Message: "نمره و کد وضعیت با موفقیت ثبت شد."}, nil
}

// gradeWriteGate is the port of assertGradeWriteAllowed (finalize-lock): a
// gradesFinalizedAt stamp means the offering is locked until an APPROVED
// reopen request exists (the approval itself is consumed by the reopen flow).
func (s *Service) gradeWriteGate(ctx context.Context, offeringID int64) error {
	var finalizedAt *string
	if err := s.DB.Pool.QueryRow(ctx, `select "gradesFinalizedAt"::text from course_offerings where id = $1`, offeringID).Scan(&finalizedAt); err != nil {
		return nil // unknown offering — other gates will fail
	}
	if finalizedAt == nil {
		return nil
	}
	var approved bool
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*) > 0 from grade_unfinalize_requests
		 where "offeringId" = $1 and status = 'APPROVED'`, offeringID).Scan(&approved)
	if !approved {
		return errors.New("نمرات این درس نهایی شده است. برای هر تغییر، ابتدا درخواست بازگشایی نمره ثبت و پس از تأیید معاون آموزشی اقدام کنید.")
	}
	return nil
}

// StudentGradeAuditLog ports getStudentGradeAuditLog (with course/term columns).
func (s *Service) StudentGradeAuditLog(ctx context.Context, user *session.User, cookie string, studentID int64) ([]GradeAuditRow, error) {
	if !hasRole(user, "ADMIN", "GRADUATEAFFAIRS", "EDU_EXPERT") {
		return nil, errors.New("دسترسی لازم را ندارید.")
	}
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return nil, err
	}
	var stuUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, studentID).Scan(&stuUni); err != nil {
		return []GradeAuditRow{}, nil
	}
	if stuUni != nil && *stuUni != *uniID {
		return []GradeAuditRow{}, nil
	}
	rows, qerr := s.DB.Pool.Query(ctx, `
		select g.id, g."enrollmentId", g."offeringId", g.action, g."oldGradeValue", g."newGradeValue",
		       g."oldGradeStatus", g."newGradeStatus", g."oldSamaStatusCode", g."newSamaStatusCode",
		       g.reason, g."actorUserId", g."actorRole", g."createdAt"::text,
		       coalesce(u2."firstName" || ' ' || u2."lastName", ''),
		       c.code, c.title, t."termCode", t.title
		  from grade_change_log g
		  left join users u2 on u2.id = g."actorUserId"
		  left join course_offerings o on o.id = g."offeringId"
		  left join courses c on c.id = o."courseId"
		  left join academic_terms t on t.id = o."termId"
		 where g."studentId" = $1
		 order by g."createdAt" desc`, studentID)
	if qerr != nil {
		return nil, qerr
	}
	defer rows.Close()
	out := []GradeAuditRow{}
	for rows.Next() {
		var g GradeAuditRow
		var actor string
		if rows.Scan(&g.ID, &g.EnrollmentID, &g.OfferingID, &g.Action, &g.OldGradeValue, &g.NewGradeValue,
			&g.OldGradeStatus, &g.NewGradeStatus, &g.OldSamaCode, &g.NewSamaCode,
			&g.Reason, &g.ActorUserID, &g.ActorRole, &g.CreatedAt,
			&actor, &g.CourseCode, &g.CourseTitle, &g.TermCode, &g.TermTitle) == nil {
			g.ActorName = strings.TrimSpace(actor)
			out = append(out, g)
		}
	}
	return out, rows.Err()
}

// ═══════════════════════════════════════════════════════════════════════
//  Group D — account management (port of actions.ts account ops)
// ═══════════════════════════════════════════════════════════════════════

// SetUserActiveFull ports setUserActiveAction — full enable/disable of a web
// account: sessions are killed, staff dossiers flip, pending OTPs are voided.
func (s *Service) SetUserActiveFull(ctx context.Context, user *session.User, userID int64, active bool) error {
	if !hasRole(user, "ADMIN") {
		return errors.New("فقط مدیر سیستم (ADMIN) اجازه فعال/غیرفعال‌سازی کاربر را دارد.")
	}
	if userID <= 0 {
		return errors.New("کاربر نامعتبر است.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	activeInt := 0
	if active {
		activeInt = 1
	}
	if _, err := tx.Exec(ctx, `update users set "isActive" = $2 where id = $1`, userID, activeInt); err != nil {
		return err
	}
	if !active {
		// 1) all active sessions are deleted (the user is logged out everywhere)
		if _, err := tx.Exec(ctx, `delete from sessions where "userId" = $1`, userID); err != nil {
			return err
		}
		// 2) staff dossiers are deactivated so they disappear from planning lists
		if _, err := tx.Exec(ctx, `update staff set "isActive" = 0 where "userId" = $1`, userID); err != nil {
			return err
		}
		// 3) pending OTPs of this user's staff dossiers are voided
		if _, err := tx.Exec(ctx, `
			delete from signature_otps where "isUsed" = 0 and "staffId" in (select id from staff where "userId" = $1)`, userID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			delete from doc_sign_otps where "isUsed" = 0 and "staffId" in (select id from staff where "userId" = $1)`, userID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			delete from grade_submission_otps where "isUsed" = 0 and "staffId" in (select id from staff where "userId" = $1)`, userID); err != nil {
			return err
		}
	} else {
		// Activation: the staff dossier becomes active again.
		if _, err := tx.Exec(ctx, `update staff set "isActive" = 1 where "userId" = $1`, userID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ResetUserPassword ports resetUserPasswordAction — admin password change with
// the same policy as the system standard (10..128) + session invalidation.
func (s *Service) ResetUserPassword(ctx context.Context, user *session.User, userID int64, newPassword string) error {
	if !hasRole(user, "ADMIN") {
		return errors.New("فقط مدیر سیستم (ADMIN) اجازه تغییر رمز کاربران را دارد.")
	}
	if userID <= 0 {
		return errors.New("کاربر نامعتبر است.")
	}
	if msg := checkNewPassword(newPassword); msg != "" {
		return errors.New(msg)
	}
	hash, err := authn.HashPassword(strings.TrimSpace(newPassword))
	if err != nil {
		return err
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `
		update users set "passwordHash" = $2, "mustChangePassword" = 1 where id = $1`, userID, hash); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from sessions where "userId" = $1`, userID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.ensureAccountRoles(ctx, userID)
	return nil
}

// bulkScopeWhere builds the EXISTS scope of the bulk password ops (bound params
// only — the scope table name comes from a fixed switch, never from user input).
func bulkScopeWhere(scope, alias string) (string, string, error) {
	if scope == "professor" {
		return `EXISTS (SELECT 1 FROM staff st WHERE st."userId" = ` + alias + `.id)`, "PROFESSOR", nil
	}
	if scope == "student" {
		return `EXISTS (SELECT 1 FROM students st WHERE st."userId" = ` + alias + `.id)`, "STUDENT", nil
	}
	return "", "", errors.New("گروه نامعتبر است.")
}

// BulkPasswordRow is one generated one-time password (returned once).
type BulkPasswordRow struct {
	NationalCode string `json:"nationalCode"`
	Password     string `json:"password"`
}

// BulkResetRandomPasswords ports bulkResetToNationalCodeAction — one-time random
// passwords (never derived from the national code), returned once to the admin.
func (s *Service) BulkResetRandomPasswords(ctx context.Context, user *session.User, cookie, scope string) (int, []BulkPasswordRow, error) {
	if !hasRole(user, "ADMIN") {
		return 0, nil, errors.New("فقط مدیر سیستم (ADMIN) اجازه این عملیات را دارد.")
	}
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return 0, nil, err
	}
	scopeWhere, roleCode, err := bulkScopeWhere(scope, "users")
	if err != nil {
		return 0, nil, err
	}
	rows, qerr := s.DB.Pool.Query(ctx, `
		select id, "nationalCode" from users
		 where "isActive" = 1 and "nationalCode" is not null and length("nationalCode") = 10
		   and `+scopeWhere+` and ("universityId" = $1 or "universityId" is null)`, *uniID)
	if qerr != nil {
		return 0, nil, qerr
	}
	type target struct {
		id int64
		nc string
	}
	targets := []target{}
	for rows.Next() {
		var t target
		if rows.Scan(&t.id, &t.nc) == nil {
			targets = append(targets, t)
		}
	}
	rows.Close()

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	affected := []int64{}
	passwords := []BulkPasswordRow{}
	for _, t := range targets {
		oneTime := randomOneTimePassword()
		hash, herr := authn.HashPassword(oneTime)
		if herr != nil {
			return 0, nil, herr
		}
		if _, err := tx.Exec(ctx, `
			update users set "passwordHash" = $2, "mustChangePassword" = 1 where id = $1`, t.id, hash); err != nil {
			return 0, nil, err
		}
		affected = append(affected, t.id)
		passwords = append(passwords, BulkPasswordRow{NationalCode: t.nc, Password: oneTime})
	}
	if len(affected) > 0 {
		if _, err := tx.Exec(ctx, `delete from sessions where "userId" = any($1)`, affected); err != nil {
			return 0, nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, nil, err
	}
	// Backfill the missing role rows of the group.
	scopeWhereU, _, serr := bulkScopeWhere(scope, "u")
	if serr != nil {
		return len(passwords), passwords, nil
	}
	_, _ = s.DB.Pool.Exec(ctx, `
		insert into user_roles ("userId","roleId")
		select u.id, r.id from users u
		join roles r on r.code = $2
		where `+scopeWhereU+`
		  and (u."universityId" = $1 or u."universityId" is null)
		  and not exists (select 1 from user_roles ur where ur."userId" = u.id and ur."roleId" = r.id)
		on conflict ("userId","roleId") do nothing`, *uniID, roleCode)
	return len(passwords), passwords, nil
}

// BulkResetPasswords ports bulkResetPasswordsAction — one shared password for the
// whole group (policy-checked) + session invalidation + role backfill.
func (s *Service) BulkResetPasswords(ctx context.Context, user *session.User, cookie, scope, newPassword string) (int, error) {
	if !hasRole(user, "ADMIN") {
		return 0, errors.New("فقط مدیر سیستم (ADMIN) اجازه این عملیات را دارد.")
	}
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return 0, err
	}
	if msg := checkNewPassword(newPassword); msg != "" {
		return 0, errors.New(msg)
	}
	scopeWhere, roleCode, err := bulkScopeWhere(scope, "users")
	if err != nil {
		return 0, err
	}
	hash, err := authn.HashPassword(strings.TrimSpace(newPassword))
	if err != nil {
		return 0, err
	}
	affected := []int64{}
	idRows, qerr := s.DB.Pool.Query(ctx, `
		select id from users where "isActive" = 1 and `+scopeWhere+`
		  and ("universityId" = $1 or "universityId" is null)`, *uniID)
	if qerr != nil {
		return 0, qerr
	}
	for idRows.Next() {
		var id int64
		if idRows.Scan(&id) == nil {
			affected = append(affected, id)
		}
	}
	idRows.Close()

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	tag, uerr := tx.Exec(ctx, `
		update users set "passwordHash" = $2, "mustChangePassword" = 1
		 where "isActive" = 1 and `+scopeWhere+` and ("universityId" = $1 or "universityId" is null)`, *uniID, hash)
	if uerr != nil {
		return 0, uerr
	}
	if len(affected) > 0 {
		if _, err := tx.Exec(ctx, `delete from sessions where "userId" = any($1)`, affected); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	scopeWhereU2, _, serr2 := bulkScopeWhere(scope, "u")
	if serr2 != nil {
		return int(tag.RowsAffected()), nil
	}
	_, _ = s.DB.Pool.Exec(ctx, `
		insert into user_roles ("userId","roleId")
		select u.id, r.id from users u
		join roles r on r.code = $2
		where `+scopeWhereU2+`
		  and (u."universityId" = $1 or u."universityId" is null)
		  and not exists (select 1 from user_roles ur where ur."userId" = u.id and ur."roleId" = r.id)
		on conflict ("userId","roleId") do nothing`, *uniID, roleCode)
	return int(tag.RowsAffected()), nil
}

// BulkForcePasswordChange ports bulkForcePasswordChangeAction — current passwords
// stay untouched; every active account of the group must change on next login.
func (s *Service) BulkForcePasswordChange(ctx context.Context, user *session.User, cookie, scope string) (int, error) {
	if !hasRole(user, "ADMIN") {
		return 0, errors.New("فقط مدیر سیستم (ADMIN) اجازه این عملیات را دارد.")
	}
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return 0, err
	}
	scopeWhere, _, err := bulkScopeWhere(scope, "users")
	if err != nil {
		return 0, err
	}
	affected := []int64{}
	idRows, qerr := s.DB.Pool.Query(ctx, `
		select id from users where "isActive" = 1 and `+scopeWhere+`
		  and ("universityId" = $1 or "universityId" is null)`, *uniID)
	if qerr != nil {
		return 0, qerr
	}
	for idRows.Next() {
		var id int64
		if idRows.Scan(&id) == nil {
			affected = append(affected, id)
		}
	}
	idRows.Close()

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	tag, uerr := tx.Exec(ctx, `
		update users set "mustChangePassword" = 1
		 where "isActive" = 1 and `+scopeWhere+` and ("universityId" = $1 or "universityId" is null)`, *uniID)
	if uerr != nil {
		return 0, uerr
	}
	if len(affected) > 0 {
		if _, err := tx.Exec(ctx, `delete from sessions where "userId" = any($1)`, affected); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// BackfillRoles ports backfillRolesAction — rebuild missing STUDENT/PROFESSOR role rows.
func (s *Service) BackfillRoles(ctx context.Context, user *session.User) (int, error) {
	if !hasRole(user, "ADMIN") {
		return 0, errors.New("فقط مدیر سیستم (ADMIN) اجازه این عملیات را دارد.")
	}
	inserted := 0
	for _, pair := range [][2]string{{"STUDENT", "students"}, {"PROFESSOR", "staff"}} {
		tag, err := s.DB.Pool.Exec(ctx, `
			insert into user_roles ("userId","roleId")
			select u.id, r.id from users u
			join roles r on r.code = $1
			where EXISTS (SELECT 1 FROM `+pair[1]+` st WHERE st."userId" = u.id)
			  and not exists (select 1 from user_roles ur where ur."userId" = u.id and ur."roleId" = r.id)
			on conflict ("userId","roleId") do nothing`, pair[0])
		if err != nil {
			return inserted, err
		}
		inserted += int(tag.RowsAffected())
	}
	return inserted, nil
}

// CreateStaffExpertInput is the create-staff modal payload.
type CreateStaffExpertInput struct {
	NationalCode string `json:"nationalCode"`
	FirstName    string `json:"firstName"`
	LastName     string `json:"lastName"`
	FatherName   string `json:"fatherName"`
	BirthCertNo  string `json:"birthCertNo"`
	Gender       string `json:"gender"`
	Mobile       string `json:"mobile"`
	Email        string `json:"email"`
	StaffCode    string `json:"staffCode"`
	StaffType    string `json:"staffType"`
}

// CreateStaffExpert ports createStaffExpertAction — a new staff/expert web account
// (first login with the national code + forced password change).
func (s *Service) CreateStaffExpert(ctx context.Context, user *session.User, cookie string, in CreateStaffExpertInput) (int64, error) {
	if !hasRole(user, "ADMIN") {
		return 0, errors.New("فقط مدیر سیستم (ADMIN) می‌تواند حساب ایجاد کند.")
	}
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return 0, err
	}
	nc := strings.TrimSpace(in.NationalCode)
	fn := strings.TrimSpace(in.FirstName)
	ln := strings.TrimSpace(in.LastName)
	sc := strings.TrimSpace(in.StaffCode)
	if sc == "" {
		sc = nc
	}
	if nc == "" || fn == "" || ln == "" {
		return 0, errors.New("کد ملی، نام و نام خانوادگی الزامی است.")
	}
	if !reDigits10.MatchString(nc) {
		return 0, errors.New("کد ملی باید ۱۰ رقم باشد.")
	}
	var dup int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select id from users where "nationalCode" = $1 and ("universityId" = $2 or "universityId" is null) limit 1`, nc, *uniID).Scan(&dup); err == nil {
		return 0, errors.New("کاربری با این کد ملی از قبل وجود دارد.")
	}
	if err := s.DB.Pool.QueryRow(ctx, `
		select id from staff where "staffCode" = $1 and ("universityId" = $2 or "universityId" is null) limit 1`, sc, *uniID).Scan(&dup); err == nil {
		return 0, errors.New("کد پرسنلی تکراری است.")
	}
	buf := make([]byte, 9)
	_, _ = rand.Read(buf)
	tempPassword := base64.RawURLEncoding.EncodeToString(buf)[:12]
	hash, err := authn.HashPassword(tempPassword)
	if err != nil {
		return 0, err
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var userID int64
	if err := tx.QueryRow(ctx, `
		insert into users ("universityId","nationalCode","firstName","lastName","fatherName","birthCertNo",
		                   "gender","mobile","email","passwordHash","isActive","mustChangePassword")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,1) returning id`,
		*uniID, nc, fn, ln, emptyOrNil(in.FatherName), emptyOrNil(in.BirthCertNo),
		emptyOrNil(in.Gender), emptyOrNil(in.Mobile), emptyOrNil(in.Email), hash).Scan(&userID); err != nil {
		return 0, err
	}
	staffType := strings.TrimSpace(in.StaffType)
	if staffType == "" {
		staffType = "اداری"
	}
	if _, err := tx.Exec(ctx, `
		insert into staff ("universityId","userId","staffCode","staffType")
		values ($1,$2,$3,$4) on conflict do nothing`, *uniID, userID, sc, staffType); err != nil {
		return 0, err
	}
	if strings.Contains(staffType, "هیئت") || strings.Contains(staffType, "مربی") || strings.Contains(staffType, "استاد") {
		if _, err := tx.Exec(ctx, `
			insert into user_roles ("userId","roleId")
			select $1, r.id from roles r where r.code = 'PROFESSOR'
			on conflict ("userId","roleId") do nothing`, userID); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return userID, nil
}

func emptyOrNil(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return strings.TrimSpace(s)
}

// SaveUserRoles ports saveUserRolesAction — role assignment with session
// invalidation + the admin self-lockout guard.
func (s *Service) SaveUserRoles(ctx context.Context, user *session.User, userID int64, roleIDs []int64) (added, removed int, err error) {
	if !hasRole(user, "ADMIN") {
		return 0, 0, errors.New("فقط مدیر سیستم (ADMIN) می‌تواند نقش‌ها را تغییر دهد.")
	}
	if userID <= 0 {
		return 0, 0, errors.New("کاربر نامعتبر است.")
	}
	want := map[int64]bool{}
	for _, id := range roleIDs {
		if id > 0 {
			want[id] = true
		}
	}
	have := map[int64]bool{}
	hrows, qerr := s.DB.Pool.Query(ctx, `select "roleId" from user_roles where "userId" = $1`, userID)
	if qerr != nil {
		return 0, 0, qerr
	}
	for hrows.Next() {
		var id int64
		if hrows.Scan(&id) == nil {
			have[id] = true
		}
	}
	hrows.Close()
	// Lockout guard: the senior admin cannot remove their own ADMIN role.
	if len(want) < len(have) {
		var adminRoleID int64
		if s.DB.Pool.QueryRow(ctx, `select id from roles where code = 'ADMIN' limit 1`).Scan(&adminRoleID) == nil {
			if user.ID == userID && have[adminRoleID] && !want[adminRoleID] {
				return 0, 0, errors.New("نقش «مدیر ارشد» را نمی‌توان از خودتان برداشت (خطر قفل‌شدن سامانه).")
			}
		}
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	for id := range want {
		if !have[id] {
			if _, err := tx.Exec(ctx, `
				insert into user_roles ("userId","roleId") values ($1,$2)
				on conflict ("userId","roleId") do nothing`, userID, id); err != nil {
				return 0, 0, err
			}
			added++
		}
	}
	for id := range have {
		if !want[id] {
			if _, err := tx.Exec(ctx, `delete from user_roles where "userId" = $1 and "roleId" = $2`, userID, id); err != nil {
				return 0, 0, err
			}
			removed++
		}
	}
	if added > 0 || removed > 0 {
		if _, err := tx.Exec(ctx, `delete from sessions where "userId" = $1`, userID); err != nil {
			return 0, 0, err
		}
	}
	return added, removed, tx.Commit(ctx)
}

// ═══════════════════════════════════════════════════════════════════════
//  Group E — profile patches (port of updateStudentProfileAction / updateStaffProfileAction)
// ═══════════════════════════════════════════════════════════════════════

// studentUserPatchFields: field → max length (users table allow-list).
var studentUserPatchFields = map[string]int{
	"fatherName": 100, "birthCertNo": 20, "placeOfBirth": 150, "placeOfIssue": 150,
	"gender": 10, "mobile": 11, "email": 150, "postalCode": 10, "address": 300,
	"passportNumber": 20, "nationality": 10,
}

// studentStuPatchFields: students-table string allow-list (max 300 like the zod gate).
var studentStuPatchFields = []string{
	"advisorCode", "documentStatus", "scholarshipType", "militaryStatus", "militaryExemptionNo", "homeTell",
	"studentCardStatus", "archiveNo", "parvandehNo", "dormName", "dormRoom", "guardianJobTitle",
	"guardianPhone", "guardianAddress", "guardianEmail", "diplomaType", "diplomaPlace",
	"diplomaYear", "diplomaGrade", "pishdPlace", "pishdYear", "pishdGrade", "tuitionType",
	"englishExamType", "englishScore", "documentDeficiency", "entryDate",
}

// studentStuNumFields: students-table numeric allow-list.
var studentStuNumFields = []string{
	"hasDorm", "tuitionPayer", "certIssued3m", "unitsRemaining", "eqSemesters", "entryYear", "entryTerm",
}

// resolveCityMinistryByTitle is the port of resolveCityMinistry — the title must
// match exactly one city (with both codes) or the code stays untouched.
func (s *Service) resolveCityMinistryByTitle(ctx context.Context, title string) *string {
	t := fa.NormalizeFa(title)
	if t == "" {
		return nil
	}
	rows, qerr := s.DB.Pool.Query(ctx, `
		select c.title, c."ministryCode", p."ministryCode"
		  from geo_cities c join geo_provinces p on p.code = c."provinceCode"`)
	if qerr != nil {
		return nil
	}
	defer rows.Close()
	matched := map[string]bool{}
	var code *string
	for rows.Next() {
		var cityTitle string
		var cityCode, provCode *string
		if rows.Scan(&cityTitle, &cityCode, &provCode) != nil {
			continue
		}
		if cityCode == nil || provCode == nil || fa.NormalizeFa(cityTitle) != t {
			continue
		}
		matched[*provCode+"::"+*cityCode] = true
		code = cityCode
	}
	if len(matched) != 1 || code == nil {
		return nil
	}
	return code
}

// setFragments turns an ordered allow-list into "col = $n" fragments with args.
// Base offsets: the WHERE keys ($1..) come first, values continue after them.
type fragBuilder struct {
	base int // number of placeholders already used by the WHERE keys
	set  []string
	args []any
}

func (b *fragBuilder) add(col string, arg any) {
	b.set = append(b.set, `"`+col+`" = $`+strconv.Itoa(len(b.args)+b.base+1))
	b.args = append(b.args, arg)
}

// UpdateStudentProfile ports updateStudentProfileAction — allow-listed patch of the
// identity fields (users) + the sama supplementary fields (students).
func (s *Service) UpdateStudentProfile(ctx context.Context, user *session.User, cookie string, studentID int64, patch map[string]any) error {
	if !hasRole(user, "ADMIN") {
		return errors.New("فقط مدیر سیستم (ADMIN) اجازه ویرایش پروندهٔ دانشجو را دارد.")
	}
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return err
	}
	if studentID <= 0 {
		return errors.New("شناسهٔ دانشجو یا مقادیر نامعتبر است.")
	}
	// Entry year/term gates (the 5-digit entry code of the client).
	if v, ok := patch["entryYear"]; ok && v != nil {
		if n := intPtrOf(v); n != nil && (*n < 1300 || *n > 1500) {
			return errors.New("سال ورود باید عددی صحیح بین ۱۳۰۰ تا ۱۵۰۰ باشد.")
		}
	}
	if v, ok := patch["entryTerm"]; ok && v != nil {
		if n := intPtrOf(v); n != nil && (*n < 1 || *n > 3) {
			return errors.New("ترم ورود باید ۱ (مهر)، ۲ (بهمن) یا ۳ (تابستان) باشد.")
		}
	}
	var userID *int64
	var stuUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "userId", "universityId" from students where id = $1`, studentID).Scan(&userID, &stuUni); err != nil {
		return errors.New("دانشجو یافت نشد.")
	}
	if stuUni != nil && *stuUni != *uniID {
		return errors.New("دانشجو متعلق به دانشگاه دیگری است.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// ── users (WHERE key: id = $1 → values start at $2) ──
	ub := &fragBuilder{base: 1}
	for k, max := range studentUserPatchFields {
		if v, ok := patch[k]; ok {
			if c := patchCleanStr(v, max); c != nil {
				ub.add(k, *c)
			} else {
				ub.add(k, nil)
			}
		}
	}
	// Birth/issue place: the geo dropdown title also stamps the ministry code.
	if v, ok := patch["placeOfBirth"]; ok {
		if c := patchCleanStr(v, 150); c != nil {
			if code := s.resolveCityMinistryByTitle(ctx, *c); code != nil {
				ub.add("birthPlaceCode", *code)
			}
		}
	}
	if v, ok := patch["placeOfIssue"]; ok {
		if c := patchCleanStr(v, 150); c != nil {
			if code := s.resolveCityMinistryByTitle(ctx, *c); code != nil {
				ub.add("issuePlaceCode", *code)
			}
		}
	}
	if len(ub.set) > 0 && userID != nil {
		q := `update users set ` + strings.Join(ub.set, ", ") + ` where id = $1`
		if _, err := tx.Exec(ctx, q, append([]any{*userID}, ub.args...)...); err != nil {
			return err
		}
	}

	// ── students (WHERE keys: id = $1, universityId = $2 → values start at $3) ──
	sb := &fragBuilder{base: 2}
	for _, k := range studentStuPatchFields {
		if v, ok := patch[k]; ok {
			if c := patchCleanStr(v, 300); c != nil {
				sb.add(k, *c)
			} else {
				sb.add(k, nil)
			}
		}
	}
	for _, k := range studentStuNumFields {
		if v, ok := patch[k]; ok {
			sb.add(k, numericArg(v))
		}
	}
	if len(sb.set) > 0 {
		q := `update students set ` + strings.Join(sb.set, ", ") +
			` where id = $1 and ("universityId" = $2 or "universityId" is null)`
		if _, err := tx.Exec(ctx, q, append([]any{studentID, *uniID}, sb.args...)...); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// staffUserPatchFields: users-table allow-list of the staff form (field → max).
var staffUserPatchFields = map[string]int{
	"firstName": 100, "lastName": 100, "mobile": 11, "email": 150, "address": 300,
}

// staffTablePatchFields: staff-table allow-list (field → max).
var staffTablePatchFields = map[string]int{
	"academicRank": 50, "degree": 50, "cooperationType": 50, "staffType": 50,
	"personnelNo": 50, "hireDate": 10, "bankAccountNo": 50, "academicBase": 20,
	"fieldOfStudy": 200, "lastDegreeUniversity": 200, "lastDegreeCountryCode": 10,
	"maritalStatus": 20, "phone": 20,
}

// UpdateStaffProfile ports updateStaffProfileAction — the professor/employee form
// (F2 save): identity fields + employment fields + jalali birthDate conversion.
func (s *Service) UpdateStaffProfile(ctx context.Context, user *session.User, cookie string, staffID int64, patch map[string]any) error {
	if !hasRole(user, "ADMIN") {
		return errors.New("فقط مدیر سیستم (ADMIN) اجازه ویرایش پروندهٔ استاد را دارد.")
	}
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return err
	}
	if staffID <= 0 {
		return errors.New("شناسهٔ پرونده یا مقادیر نامعتبر است.")
	}
	var userID *int64
	var staffUni *int64
	var curNC *string
	if err := s.DB.Pool.QueryRow(ctx, `
		select st."userId", st."universityId", u."nationalCode"
		  from staff st left join users u on u.id = st."userId"
		 where st.id = $1`, staffID).Scan(&userID, &staffUni, &curNC); err != nil {
		return errors.New("پرونده یافت نشد.")
	}
	if staffUni != nil && *staffUni != *uniID {
		return errors.New("پرونده متعلق به دانشگاه دیگری است.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// ── users (WHERE key: id = $1 → values start at $2) ──
	ub := &fragBuilder{base: 1}
	for k, max := range staffUserPatchFields {
		if v, ok := patch[k]; ok {
			if c := patchCleanStrDash(v, max); c != nil {
				ub.add(k, *c)
			}
		}
	}
	if v, ok := patch["nationalCode"]; ok {
		if c := patchCleanStrDash(v, 10); c != nil && (curNC == nil || *c != *curNC) {
			if !reDigits10.MatchString(*c) {
				return errors.New("کد ملی باید ۱۰ رقم باشد.")
			}
			ub.add("nationalCode", *c)
		}
	}
	if v, ok := patch["birthDate"]; ok {
		if raw := patchCleanStrDash(v, 10); raw != nil {
			m := reBirthDateRe.FindStringSubmatch(*raw)
			if m == nil {
				return errors.New("قالب تاریخ تولد نامعتبر است (نمونه: ۱۳۶۰/۰۱/۰۱).")
			}
			jy, _ := strconv.Atoi(fa.ToEnDigits(m[1]))
			jm, _ := strconv.Atoi(fa.ToEnDigits(m[2]))
			jd, _ := strconv.Atoi(fa.ToEnDigits(m[3]))
			if jy < 1300 || jy > 1450 || jm < 1 || jm > 12 || jd < 1 || jd > 31 {
				return errors.New("تاریخ تولد خارج از بازهٔ مجاز است.")
			}
			g := jalali.ToGregorian(jy, jm, jd)
			birthISO := fmt.Sprintf("%04d-%02d-%02d", g.Y, g.M, g.D)
			ub.add("birthDate", birthISO)
		}
	}
	if len(ub.set) > 0 && userID != nil {
		q := `update users set ` + strings.Join(ub.set, ", ") + ` where id = $1`
		if _, err := tx.Exec(ctx, q, append([]any{*userID}, ub.args...)...); err != nil {
			return err
		}
	}

	// ── staff (WHERE keys: id = $1, universityId = $2 → values start at $3) ──
	sb := &fragBuilder{base: 2}
	for k, max := range staffTablePatchFields {
		if v, ok := patch[k]; ok {
			if c := patchCleanStrDash(v, max); c != nil {
				sb.add(k, *c)
			}
		}
	}
	if v, ok := patch["isActive"]; ok {
		if n := intPtrOf(v); n != nil && (*n == 0 || *n == 1) {
			sb.add("isActive", *n)
		}
	}
	if len(sb.set) > 0 {
		q := `update staff set ` + strings.Join(sb.set, ", ") +
			` where id = $1 and ("universityId" = $2 or "universityId" is null)`
		if _, err := tx.Exec(ctx, q, append([]any{staffID, *uniID}, sb.args...)...); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ═══════════════════════════════════════════════════════════════════════
//  Group F — lazy staff bundle (port of staff-data.ts / loadStaffListAction)
// ═══════════════════════════════════════════════════════════════════════

// StaffItem is the StaffItem contract of types.ts.
type StaffItem struct {
	ID              int64   `json:"id"`
	StaffCode       string  `json:"staffCode"`
	NationalCode    string  `json:"nationalCode"`
	FirstName       string  `json:"firstName"`
	LastName        string  `json:"lastName"`
	Mobile          string  `json:"mobile"`
	AcademicRank    string  `json:"academicRank"`
	Degree          string  `json:"degree"`
	StaffType       string  `json:"staffType"`
	Role            string  `json:"role"`
	Department      string  `json:"departmentName"`
	DepartmentCode  *string `json:"departmentCode"`
	Faculty         string  `json:"facultyName"`
	FacultyCode     *string `json:"facultyCode"`
	FieldOfStudy    *string `json:"fieldOfStudy"`
	FieldMain       *string `json:"fieldMain"`
	LastDegreeUni   *string `json:"lastDegreeUniversity"`
	LastDegreeCC    *string `json:"lastDegreeCountryCode"`
	PersonnelNo     *string `json:"personnelNo"`
	HireDate        *string `json:"hireDate"`
	BankAccountNo   *string `json:"bankAccountNo"`
	CooperationType *string `json:"cooperationType"`
	BirthDate       *string `json:"birthDate"`
	Phone           *string `json:"phone"`
	Address         *string `json:"address"`
	Email           *string `json:"email"`
	MaritalStatus   *string `json:"maritalStatus"`
	AcademicBase    *string `json:"academicBase"`
	IsActive        int     `json:"isActive"`
	UserID          *int64  `json:"userId"`
	UserIsActive    int     `json:"userIsActive"`
	PhotoKey        *string `json:"photoKey"`
}

// StaffBundleResponse is the lazy staff list + role map + total.
type StaffBundleResponse struct {
	StaffList   []StaffItem       `json:"staffList"`
	UserRoleIDs map[int64][]int64 `json:"userRoleIds"`
	Total       int               `json:"total"`
}

// LoadStaffBundle ports loadStaffBundle — server-side Persian-normalized search,
// max `limit` rows (default 100), university + EDU_EXPERT scoped.
func (s *Service) LoadStaffBundle(ctx context.Context, user *session.User, cookie, q string, limit int) (*StaffBundleResponse, error) {
	uniID, err := uniFailClosed(ctx, s, user, cookie)
	if err != nil {
		return nil, err
	}
	if limit < 1 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	conds := []string{`st."universityId" = $1`}
	args := []any{*uniID}
	narg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	// EDU_EXPERT sees only their departments/faculties (port of staffScopeConds).
	if hasRole(user, "EDU_EXPERT") {
		uid := narg(user.ID)
		conds = append(conds, `(
			st."departmentId" in (select es."scopeId"::int from expert_scopes es where es."userId" = `+uid+` and es."scopeType" = 'DEPARTMENT' and (es."universityId" is null or es."universityId" = $1))
			or st."facultyId" in (select es2."scopeId"::int from expert_scopes es2 where es2."userId" = `+uid+` and es2."scopeType" = 'FACULTY' and (es2."universityId" is null or es2."universityId" = $1))
			or not exists (select 1 from expert_scopes es3 where es3."userId" = `+uid+` and (es3."universityId" is null or es3."universityId" = $1) and es3."scopeType" in ('DEPARTMENT','FACULTY'))
		)`)
	}
	if qs := strings.TrimSpace(q); qs != "" {
		pat := fa.FaLikePattern(qs)
		conds = append(conds, `(
			`+faNormCol(`u."firstName"`)+` ilike `+narg(pat)+` or `+faNormCol(`u."lastName"`)+` ilike `+narg(pat)+
			` or `+faNormCol(`u."firstName" || ' ' || u."lastName"`)+` ilike `+narg(pat)+
			` or `+faNormCol(`st."staffCode"`)+` ilike `+narg(pat)+` or `+faNormCol(`u."nationalCode"`)+` ilike `+narg(pat)+`)`)
	}
	where := strings.Join(conds, " and ")

	out := &StaffBundleResponse{StaffList: []StaffItem{}, UserRoleIDs: map[int64][]int64{}}
	if err := s.DB.Pool.QueryRow(ctx, `
		select count(*) from staff st join users u on u.id = st."userId" where `+where, args...).Scan(&out.Total); err != nil {
		return nil, err
	}
	rows, qerr := s.DB.Pool.Query(ctx, `
		select st.id, coalesce(st."staffCode",''), coalesce(u."nationalCode",''),
		       coalesce(u."firstName",''), coalesce(u."lastName",''),
		       coalesce(nullif(u."mobile",''),'—'),
		       coalesce(nullif(st."academicRank",''), coalesce(st."academicBase",''),'—'),
		       coalesce(nullif(st."degree",''), coalesce(st."fieldOfStudy",''),'—'),
		       coalesce(nullif(st."cooperationType",''), coalesce(st."employmentType",''), coalesce(st."staffType",''),'—'),
		       coalesce(nullif(d.name,''),'—'), d."departmentCode",
		       coalesce(nullif(f.name,''),'—'), f."facultyCode",
		       st."fieldOfStudy", st."fieldMain", st."lastDegreeUniversity", st."lastDegreeCountryCode",
		       st."personnelNo", st."hireDate", st."bankAccountNo", st."cooperationType",
		       u."birthDate"::text, st.phone, u.address, u.email, st."maritalStatus", st."academicBase",
		       coalesce(st."isActive",1), u.id, coalesce(u."isActive",1), u."photoKey"
		  from staff st
		  join users u on u.id = st."userId"
		  left join departments d on d.id = st."departmentId"
		  left join faculties f on f.id = st."facultyId"
		 where `+where+`
		 order by st.id desc limit `+strconv.Itoa(limit), args...)
	if qerr != nil {
		return nil, qerr
	}
	defer rows.Close()
	staffUserIDs := []int64{}
	for rows.Next() {
		var it StaffItem
		if err := rows.Scan(&it.ID, &it.StaffCode, &it.NationalCode, &it.FirstName, &it.LastName,
			&it.Mobile, &it.AcademicRank, &it.Degree, &it.StaffType,
			&it.Department, &it.DepartmentCode, &it.Faculty, &it.FacultyCode,
			&it.FieldOfStudy, &it.FieldMain, &it.LastDegreeUni, &it.LastDegreeCC,
			&it.PersonnelNo, &it.HireDate, &it.BankAccountNo, &it.CooperationType,
			&it.BirthDate, &it.Phone, &it.Address, &it.Email, &it.MaritalStatus, &it.AcademicBase,
			&it.IsActive, &it.UserID, &it.UserIsActive, &it.PhotoKey); err != nil {
			return nil, err
		}
		it.Role = "استاد / هیئت علمی"
		out.StaffList = append(out.StaffList, it)
		if it.UserID != nil {
			staffUserIDs = append(staffUserIDs, *it.UserID)
			out.UserRoleIDs[*it.UserID] = []int64{}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(staffUserIDs) > 0 {
		urRows, uerr := s.DB.Pool.Query(ctx, `select "userId", "roleId" from user_roles where "userId" = any($1)`, staffUserIDs)
		if uerr == nil {
			defer urRows.Close()
			for urRows.Next() {
				var uid, rid int64
				if urRows.Scan(&uid, &rid) == nil {
					out.UserRoleIDs[uid] = append(out.UserRoleIDs[uid], rid)
				}
			}
		}
	}
	return out, nil
}
