// ═══ میز فارغ‌التحصیلی (ادمین) — پورت lib/graduation-engine.ts (بخش مدیریتی) ═══
//
// موتور دانشجو (auditStudent/advanceDossier/startClearance/GetTracker) در
// پکیج student پیاده شده و این‌جا فقط بازاستفاده می‌شود تا منطق دو نسخه نشود.
package graduation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/messaging"
	"backend-go/internal/student"
)

// Settings حداقل وابستگی تنظیمات.
type Settings interface {
	Get(ctx context.Context, key string) (string, error)
	GetNumber(ctx context.Context, key string, fallback float64) float64
	GetBool(ctx context.Context, key string) bool
}

// Service سرویس فارغ‌التحصیلی ادمین.
type Service struct {
	Pool     *pgxpool.Pool
	Settings Settings
	Students *student.Service
}

// New ساخت سرویس.
func New(pool *pgxpool.Pool, settings Settings, students *student.Service) *Service {
	return &Service{Pool: pool, Settings: settings, Students: students}
}

// Step یک مرحلهٔ گردش‌کار.
type Step struct {
	Code  string `json:"code"`
	Title string `json:"title"`
	Actor string `json:"actor"`
}

// WorkflowSteps مراحل گردش‌کار (پورت WORKFLOW_STEPS).
var WorkflowSteps = []Step{
	{Code: "CATALOG_REVIEW", Title: "تطبیق سرفصل و بررسی واحدها", Actor: "سیستم"},
	{Code: "HEAD_APPROVAL", Title: "تأیید مدیر گروه", Actor: "مدیر گروه"},
	{Code: "IRANDOC_VERIFICATION", Title: "استعلام همانندجویی ایرانداک", Actor: "سیستم"},
	{Code: "CLEARANCE", Title: "تسویه‌حساب موازی دپارتمان‌ها", Actor: "سیستم / کارشناسان"},
	{Code: "SAJJAD_REQUEST", Title: "ثبت درخواست کد صحت در سامانهٔ سجاد", Actor: "دانشجو"},
	{Code: "FINAL_DOCS", Title: "مدارک پایانی (عکس و تمبر)", Actor: "دانشجو"},
	{Code: "READY_TO_ISSUE", Title: "کارشناس صدور مدرک", Actor: "اداره آموزش"},
	{Code: "ISSUED", Title: "مدرک صادر شد", Actor: "—"},
}

// StepsFor مراحل واقعی بر اساس الزام پایان‌نامه/سجاد.
func StepsFor(thesisRequired, sajjadRequired bool) []Step {
	out := []Step{}
	for _, s := range WorkflowSteps {
		if s.Code == "IRANDOC_VERIFICATION" && !thesisRequired {
			continue
		}
		if s.Code == "SAJJAD_REQUEST" && !sajjadRequired {
			continue
		}
		out = append(out, s)
	}
	return out
}

// DefaultDept دپارتمان تسویهٔ پیش‌فرض.
type DefaultDept struct {
	Code, Title, AutoCheck string
	SortOrder              int
	ResponsibleRoleCode    string
	Hint                   string
}

// DefaultDepartments هم‌تراز DEFAULT_DEPARTMENTS در Next.
var DefaultDepartments = []DefaultDept{
	{"FINANCE", "امور مالی و شهریه", "FINANCE_LEDGER", 10, "FINANCE_EXPERT", "مانده بدهی از دفتر مالی دانشجو محاسبه می‌شود."},
	{"LIBRARY", "کتابخانه مرکزی", "NONE", 20, "LIBRARIAN", "در صورت وجود سرویس کتابخانه، نشانی API را در همین صفحه ثبت کنید."},
	{"DORMITORY", "خوابگاه", "NONE", 30, "DORM_EXPERT", ""},
	{"WELFARE_FUND", "صندوق رفاه دانشجویان", "NONE", 40, "FINANCE_EXPERT", "بازپرداخت وام‌های دانشجویی"},
	{"LAB", "آزمایشگاه و کارگاه", "NONE", 50, "EDU_EXPERT", ""},
	{"EDU_OFFICE", "اداره آموزش (پروندهٔ تحصیلی)", "NONE", 60, "EDU_EXPERT", "کنترل نهایی پرونده و مدارک ورودی"},
	{"MILITARY", "نظام وظیفه", "NONE", 70, "MILITARY_OFFICER", "فقط برای مشمولان — در غیر این صورت «معاف از بررسی» بزنید."},
}

// Dept دپارتمان تسویه (نمای مدیریتی).
type Dept struct {
	ID                  int64   `json:"id"`
	Code                string  `json:"code"`
	Title               string  `json:"title"`
	AutoCheck           string  `json:"autoCheck"`
	APIURL              *string `json:"apiUrl"`
	ResponsibleRoleCode *string `json:"responsibleRoleCode"`
	SortOrder           int     `json:"sortOrder"`
	IsActive            bool    `json:"isActive"`
	Hint                *string `json:"hint"`
	UniversityID        *int64  `json:"universityId"`
}

// EnsureDepartments فقط بار اول دپارتمان‌های پیش‌فرض را می‌سازد.
func (s *Service) EnsureDepartments(ctx context.Context) error {
	var n int
	if err := s.Pool.QueryRow(ctx, `select count(*)::int from clearance_departments`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	for _, d := range DefaultDepartments {
		var hint any
		if strings.TrimSpace(d.Hint) != "" {
			hint = d.Hint
		}
		_, _ = s.Pool.Exec(ctx, `
			insert into clearance_departments (code,title,"autoCheck","sortOrder","isActive","responsibleRoleCode",hint)
			values ($1,$2,$3,$4,1,$5,$6) on conflict (code) do nothing`,
			d.Code, d.Title, d.AutoCheck, d.SortOrder, d.ResponsibleRoleCode, hint)
	}
	return nil
}

// Departments فهرست دپارتمان‌ها؛ universityId ⇒ همان دانشگاه + عمومی (NULL).
func (s *Service) Departments(ctx context.Context, universityID *int64, activeOnly bool) ([]Dept, error) {
	if err := s.EnsureDepartments(ctx); err != nil {
		return nil, err
	}
	args := []any{}
	conds := []string{}
	if universityID != nil {
		args = append(args, *universityID)
		conds = append(conds, `("universityId" = $1 or "universityId" is null)`)
	}
	if activeOnly {
		conds = append(conds, `coalesce("isActive",1) = 1`)
	}
	where := ""
	if len(conds) > 0 {
		where = " where " + strings.Join(conds, " and ")
	}
	rows, err := s.Pool.Query(ctx, `
		select id, code, title, coalesce("autoCheck",'NONE'), "apiUrl", "responsibleRoleCode",
		       coalesce("sortOrder",100), coalesce("isActive",1), hint, "universityId"
		  from clearance_departments`+where+` order by "sortOrder", id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Dept{}
	for rows.Next() {
		var d Dept
		var active int
		if err := rows.Scan(&d.ID, &d.Code, &d.Title, &d.AutoCheck, &d.APIURL, &d.ResponsibleRoleCode,
			&d.SortOrder, &active, &d.Hint, &d.UniversityID); err == nil {
			d.IsActive = active != 0
			out = append(out, d)
		}
	}
	return out, nil
}

// Row ردیف خط لولهٔ پرونده‌ها.
type Row struct {
	ID             int64      `json:"id"`
	StudentID      int64      `json:"studentId"`
	WorkflowStatus string     `json:"workflowStatus"`
	GPA            *float64   `json:"gpa"`
	PassedUnits    float64    `json:"passedUnits"`
	RequiredUnits  float64    `json:"requiredUnits"`
	HeadApproved   bool       `json:"headApproved"`
	ThesisRequired bool       `json:"thesisRequired"`
	IrandocStatus  *string    `json:"irandocStatus"`
	StudentCode    string     `json:"studentCode"`
	FullName       string     `json:"fullName"`
	MajorName      *string    `json:"majorName"`
	DegreeTitle    *string    `json:"degreeTitle"`
	StartedAt      *time.Time `json:"startedAt"`
	LastEventAt    *time.Time `json:"lastEventAt"`
}

// ListDossiers پورت listDossiers (حداکثر ۳۰۰ ردیف، مرتب آخرین رویداد).
func (s *Service) ListDossiers(ctx context.Context, universityID *int64, status, q string) ([]Row, error) {
	args := []any{}
	conds := []string{}
	if status != "" && status != "ALL" {
		args = append(args, status)
		conds = append(conds, `g."workflowStatus" = $`+fmt.Sprint(len(args)))
	}
	if universityID != nil {
		args = append(args, *universityID)
		conds = append(conds, `st."universityId" = $`+fmt.Sprint(len(args)))
	}
	where := ""
	if len(conds) > 0 {
		where = " where " + strings.Join(conds, " and ")
	}
	rows, err := s.Pool.Query(ctx, `
		select g.id, g."studentId", g."workflowStatus", g.gpa::float8,
		       coalesce(g."passedUnits",0)::float8, coalesce(g."requiredUnits",0)::float8,
		       coalesce(g."headApprovalStatus",0), coalesce(g."thesisRequired",0), g."irandocStatus",
		       st."studentCode", (u."firstName" || ' ' || u."lastName"), m.name, d.title,
		       g."startedAt", g."lastEventAt"
		  from graduation_audits g
		  join students st on st.id = g."studentId"
		  join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		  left join degree_level_configs d on d.id = st."degreeLevelId"`+where+`
		 order by g."lastEventAt" desc nulls last limit 300`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Row{}
	for rows.Next() {
		var r Row
		var head, thesis int
		if err := rows.Scan(&r.ID, &r.StudentID, &r.WorkflowStatus, &r.GPA,
			&r.PassedUnits, &r.RequiredUnits, &head, &thesis, &r.IrandocStatus,
			&r.StudentCode, &r.FullName, &r.MajorName, &r.DegreeTitle,
			&r.StartedAt, &r.LastEventAt); err == nil {
			r.HeadApproved = head != 0
			r.ThesisRequired = thesis != 0
			out = append(out, r)
		}
	}
	q = strings.TrimSpace(q)
	if q == "" {
		return out, nil
	}
	filtered := []Row{}
	for _, r := range out {
		if strings.Contains(r.StudentCode, q) || strings.Contains(r.FullName, q) {
			filtered = append(filtered, r)
		}
	}
	return filtered, nil
}

// StepCount شمارش مرحله.
type StepCount struct {
	Code  string `json:"code"`
	Title string `json:"title"`
	Count int    `json:"count"`
}

// Stats آمار خط لوله.
type Stats struct {
	Steps       []StepCount `json:"steps"`
	OnHold      int         `json:"onHold"`
	IssuedDocs  int         `json:"issuedDocs"`
	Undelivered int         `json:"undelivered"`
}

// PipelineStats پورت pipelineStats.
func (s *Service) PipelineStats(ctx context.Context, universityID *int64) (*Stats, error) {
	args := []any{}
	where := ""
	if universityID != nil {
		args = append(args, *universityID)
		where = ` where st."universityId" = $1`
	}
	rows, err := s.Pool.Query(ctx, `
		select g."workflowStatus", count(*)::int
		  from graduation_audits g join students st on st.id = g."studentId"`+where+`
		 group by g."workflowStatus"`, args...)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err == nil {
			counts[st] = n
		}
	}
	rows.Close()
	steps := []StepCount{}
	for _, st := range WorkflowSteps {
		steps = append(steps, StepCount{Code: st.Code, Title: st.Title, Count: counts[st.Code]})
	}
	var issued, undelivered int
	_ = s.Pool.QueryRow(ctx, `select count(*)::int from issued_degrees`).Scan(&issued)
	_ = s.Pool.QueryRow(ctx, `select count(*)::int from issued_degrees where coalesce("isDelivered",0) = 0`).Scan(&undelivered)
	return &Stats{Steps: steps, OnHold: counts["ON_HOLD"], IssuedDocs: issued, Undelivered: undelivered}, nil
}

// DossierAudit پروندهٔ کامل (نمای ادمین).
type DossierAudit struct {
	ID                     int64                   `json:"id"`
	StudentID              int64                   `json:"studentId"`
	WorkflowStatus         string                  `json:"workflowStatus"`
	RequiredUnits          float64                 `json:"requiredUnits"`
	PassedUnits            float64                 `json:"passedUnits"`
	GPA                    *float64                `json:"gpa"`
	MissingCourses         []student.MissingCourse `json:"missingCourses"`
	CatalogOK              bool                    `json:"catalogOk"`
	HeadApprovalStatus     int                     `json:"headApprovalStatus"`
	HeadNote               *string                 `json:"headNote"`
	ThesisRequired         bool                    `json:"thesisRequired"`
	ThesisTitle            *string                 `json:"thesisTitle"`
	IrandocTrackingCode    *string                 `json:"irandocTrackingCode"`
	IrandocSimilarityScore *float64                `json:"irandocSimilarityScore"`
	IrandocStatus          *string                 `json:"irandocStatus"`
	SajjadStatus           *string                 `json:"sajjadStatus"`
	SajjadRequestCode      *string                 `json:"sajjadRequestCode"`
	SajjadRequestedAt      *time.Time              `json:"sajjadRequestedAt"`
	SajjadConfirmedAt      *time.Time              `json:"sajjadConfirmedAt"`
	PhotoDocumentID        *int64                  `json:"photoDocumentId"`
	StampFeePaid           bool                    `json:"stampFeePaid"`
	StampFeeAmount         float64                 `json:"stampFeeAmount"`
	Note                   *string                 `json:"note"`
	HeadApprovedAt         *time.Time              `json:"headApprovedAt"`
	IrandocCheckedAt       *time.Time              `json:"irandocCheckedAt"`
	FinalDocsAt            *time.Time              `json:"finalDocsAt"`
	StartedAt              *time.Time              `json:"startedAt"`
	LastEventAt            *time.Time              `json:"lastEventAt"`
	CompletedAt            *time.Time              `json:"completedAt"`
}

// DossierStudent هویت دانشجو در پرونده.
type DossierStudent struct {
	StudentCode string  `json:"studentCode"`
	FullName    string  `json:"fullName"`
	MajorName   *string `json:"majorName"`
	DegreeTitle *string `json:"degreeTitle"`
	Status      string  `json:"status"`
}

// ChecklistItem ردیف تسویه.
type ChecklistItem struct {
	ID          int64      `json:"id"`
	Department  string     `json:"department"`
	Title       string     `json:"title"`
	Status      string     `json:"status"`
	AmountDue   float64    `json:"amountDue"`
	Detail      *string    `json:"detail"`
	AutoChecked bool       `json:"autoChecked"`
	ResolvedAt  *time.Time `json:"resolvedAt"`
}

// DegreeItem مدرک صادرشده.
type DegreeItem struct {
	ID                       int64     `json:"id"`
	DegreeType               string    `json:"degreeType"`
	SerialNo                 string    `json:"serialNo"`
	VerifyCode               string    `json:"verifyCode"`
	MinistryVerificationCode *string   `json:"ministryVerificationCode"`
	IsDelivered              bool      `json:"isDelivered"`
	IssuedAt                 time.Time `json:"issuedAt"`
	DocumentHash             string    `json:"documentHash"`
}

// DeliveryItem تحویل پیام بیرونی.
type DeliveryItem struct {
	ID           int64      `json:"id"`
	EventCode    string     `json:"eventCode"`
	Channel      string     `json:"channel"`
	ChannelLabel string     `json:"channelLabel"`
	Target       *string    `json:"target"`
	Status       string     `json:"status"`
	Error        *string    `json:"error"`
	CreatedAt    *time.Time `json:"createdAt"`
}

// Dossier پاسخ کامل یک پرونده.
type Dossier struct {
	Audit      DossierAudit    `json:"audit"`
	Student    DossierStudent  `json:"student"`
	Checklist  []ChecklistItem `json:"checklist"`
	Degrees    []DegreeItem    `json:"degrees"`
	Deliveries []DeliveryItem  `json:"deliveries"`
}

// GetDossier پورت getDossier.
func (s *Service) GetDossier(ctx context.Context, auditID int64) (*Dossier, error) {
	var a DossierAudit
	var missingJSON string
	var catalogOK, headApproval, thesis, stampPaid int
	err := s.Pool.QueryRow(ctx, `
		select id, "studentId", "workflowStatus", coalesce("requiredUnits",0)::float8,
		       coalesce("passedUnits",0)::float8, gpa::float8,
		       coalesce("missingCourses",'[]')::text, coalesce("catalogOk",0),
		       coalesce("headApprovalStatus",0), "headNote",
		       coalesce("thesisRequired",0), "thesisTitle", "irandocTrackingCode",
		       "irandocSimilarityScore"::float8, "irandocStatus",
		       "sajjadStatus", "sajjadRequestCode", "sajjadRequestedAt", "sajjadConfirmedAt",
		       "photoDocumentId", coalesce("stampFeePaid",0), coalesce("stampFeeAmount",0)::float8,
		       note, "headApprovedAt", "irandocCheckedAt", "finalDocsAt",
		       "startedAt", "lastEventAt", "completedAt"
		  from graduation_audits where id = $1`, auditID).
		Scan(&a.ID, &a.StudentID, &a.WorkflowStatus, &a.RequiredUnits, &a.PassedUnits, &a.GPA,
			&missingJSON, &catalogOK, &headApproval, &a.HeadNote,
			&thesis, &a.ThesisTitle, &a.IrandocTrackingCode,
			&a.IrandocSimilarityScore, &a.IrandocStatus,
			&a.SajjadStatus, &a.SajjadRequestCode, &a.SajjadRequestedAt, &a.SajjadConfirmedAt,
			&a.PhotoDocumentID, &stampPaid, &a.StampFeeAmount,
			&a.Note, &a.HeadApprovedAt, &a.IrandocCheckedAt, &a.FinalDocsAt,
			&a.StartedAt, &a.LastEventAt, &a.CompletedAt)
	if err != nil {
		return nil, nil
	}
	a.CatalogOK = catalogOK != 0
	a.HeadApprovalStatus = headApproval
	a.ThesisRequired = thesis != 0
	a.StampFeePaid = stampPaid != 0
	a.MissingCourses = []student.MissingCourse{}
	_ = json.Unmarshal([]byte(missingJSON), &a.MissingCourses)

	var stu DossierStudent
	_ = s.Pool.QueryRow(ctx, `
		select st."studentCode", (u."firstName" || ' ' || u."lastName"), m.name, d.title, st.status
		  from students st join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		  left join degree_level_configs d on d.id = st."degreeLevelId"
		 where st.id = $1`, a.StudentID).
		Scan(&stu.StudentCode, &stu.FullName, &stu.MajorName, &stu.DegreeTitle, &stu.Status)

	checklist := []ChecklistItem{}
	crows, err := s.Pool.Query(ctx, `
		select cc.id, cc.department, coalesce(cd.title, cc.department), cc.status,
		       coalesce(cc."amountDue",0)::float8, cc.detail, coalesce(cc."autoChecked",0), cc."resolvedAt"
		  from clearance_checklist cc
		  left join clearance_departments cd on cd.code = cc.department
		 where cc."auditId" = $1 order by cc.id`, auditID)
	if err == nil {
		for crows.Next() {
			var c ChecklistItem
			var auto int
			if err := crows.Scan(&c.ID, &c.Department, &c.Title, &c.Status, &c.AmountDue,
				&c.Detail, &auto, &c.ResolvedAt); err == nil {
				c.AutoChecked = auto != 0
				checklist = append(checklist, c)
			}
		}
		crows.Close()
	}

	degrees := []DegreeItem{}
	drows, err := s.Pool.Query(ctx, `
		select id, "degreeType", "serialNo", "verifyCode", "ministryVerificationCode",
		       coalesce("isDelivered",0), "issuedAt", "documentHash"
		  from issued_degrees where "studentId" = $1 order by id desc`, a.StudentID)
	if err == nil {
		for drows.Next() {
			var d DegreeItem
			var delivered int
			if err := drows.Scan(&d.ID, &d.DegreeType, &d.SerialNo, &d.VerifyCode,
				&d.MinistryVerificationCode, &delivered, &d.IssuedAt, &d.DocumentHash); err == nil {
				d.IsDelivered = delivered != 0
				degrees = append(degrees, d)
			}
		}
		drows.Close()
	}

	deliveries := []DeliveryItem{}
	var userID int64
	if err := s.Pool.QueryRow(ctx, `select "userId" from students where id = $1`, a.StudentID).Scan(&userID); err == nil {
		lrows, err := s.Pool.Query(ctx, `
			select id, "eventCode", channel, target, status, error, "createdAt"
			  from notification_deliveries where "userId" = $1 order by id desc limit 12`, userID)
		if err == nil {
			for lrows.Next() {
				var d DeliveryItem
				if err := lrows.Scan(&d.ID, &d.EventCode, &d.Channel, &d.Target, &d.Status, &d.Error, &d.CreatedAt); err == nil {
					d.ChannelLabel = channelLabel(d.Channel)
					deliveries = append(deliveries, d)
				}
			}
			lrows.Close()
		}
	}

	return &Dossier{Audit: a, Student: stu, Checklist: checklist, Degrees: degrees, Deliveries: deliveries}, nil
}

var channelLabels = map[string]string{
	"INAPP": "داخل‌پورتال", "SMS": "پیامک", "TELEGRAM": "تلگرام", "BALE": "بله",
	"EITAA": "ایتا", "SOROUSH": "سروش", "IGAP": "ای‌گپ",
}

func channelLabel(ch string) string {
	if l, ok := channelLabels[strings.ToUpper(ch)]; ok {
		return l
	}
	return ch
}

// ─────────────────── اعلان‌ها ───────────────────

func (s *Service) notifyUser(ctx context.Context, userID int64, eventCode, text string) {
	if userID <= 0 {
		return
	}
	payload, _ := json.Marshal(map[string]string{"text": text})
	if _, err := s.Pool.Exec(ctx, `insert into notifications ("userId","eventCode",payload) values ($1,$2,$3)`,
		userID, eventCode, string(payload)); err != nil {
		return
	}
	messaging.NotifyExternalDefault(ctx, userID, eventCode, text)
}

func (s *Service) notifyRole(ctx context.Context, roleCode, eventCode, text string) {
	roleCode = strings.TrimSpace(roleCode)
	if roleCode == "" {
		return
	}
	rows, err := s.Pool.Query(ctx, `
		select u.id from users u
		  join user_roles ur on ur."userId" = u.id
		  join roles r on r.id = ur."roleId"
		 where r.code = $1 and coalesce(u."isActive",1) = 1 limit 50`, roleCode)
	if err != nil {
		return
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		s.notifyUser(ctx, id, eventCode, text)
	}
}

// ─────────────────── پویش و باز کردن پرونده ───────────────────

// ScanResult نتیجهٔ پویش.
type ScanResult struct {
	Scanned     int           `json:"scanned"`
	Opened      int           `json:"opened"`
	AlreadyOpen int           `json:"alreadyOpen"`
	NotEligible int           `json:"notEligible"`
	Opinions    []ScanOpinion `json:"opinions"`
}

// ScanOpinion یادداشت یک دانشجو.
type ScanOpinion struct {
	StudentCode string `json:"studentCode"`
	FullName    string `json:"fullName"`
	Status      string `json:"status"`
	Note        string `json:"note"`
}

// Scan پورت runGraduationScan.
func (s *Service) Scan(ctx context.Context, studentIDs []int64, majorID *int64, force bool) (*ScanResult, error) {
	res := &ScanResult{Opinions: []ScanOpinion{}}
	enabled := s.Settings != nil && s.Settings.GetBool(ctx, "GRAD_AUTO_SCAN")
	if !enabled && !force {
		res.Opinions = append(res.Opinions, ScanOpinion{StudentCode: "-", FullName: "-", Status: "DISABLED", Note: "پویش خودکار در تنظیمات غیرفعال است."})
		return res, nil
	}
	args := []any{}
	conds := []string{`status in ('ACTIVE','PENDING_GRADUATION')`}
	if len(studentIDs) > 0 {
		args = append(args, studentIDs)
		conds = append(conds, fmt.Sprintf(`id = any($%d)`, len(args)))
	}
	if majorID != nil {
		args = append(args, *majorID)
		conds = append(conds, fmt.Sprintf(`"majorId" = $%d`, len(args)))
	}
	rows, err := s.Pool.Query(ctx, `select id from students where `+strings.Join(conds, " and "), args...)
	if err != nil {
		return nil, err
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()

	existing := map[int64]struct {
		ID     int64
		Status string
	}{}
	erows, _ := s.Pool.Query(ctx, `select id, "studentId", "workflowStatus" from graduation_audits`)
	if erows != nil {
		for erows.Next() {
			var id, sid int64
			var status string
			if err := erows.Scan(&id, &sid, &status); err == nil {
				existing[sid] = struct {
					ID     int64
					Status string
				}{ID: id, Status: status}
			}
		}
		erows.Close()
	}

	for _, sid := range ids {
		res.Scanned++
		audit, err := s.Students.AuditStudentForAdmin(ctx, sid)
		if err != nil || audit == nil {
			continue
		}
		missingJSON, _ := json.Marshal(audit.Missing)
		if open, ok := existing[sid]; ok {
			_, _ = s.Pool.Exec(ctx, `
				update graduation_audits set "requiredUnits" = $2, "passedUnits" = $3,
				       gpa = $4, "missingCourses" = $5, "catalogOk" = $6, "lastEventAt" = now()
				 where id = $1`,
				open.ID, audit.RequiredUnits, audit.PassedUnits, audit.GPA, string(missingJSON), boolInt(audit.CatalogOk))
			res.AlreadyOpen++
			continue
		}
		if !audit.CatalogOk {
			res.NotEligible++
			continue
		}
		if _, err := s.openDossier(ctx, audit); err != nil {
			continue
		}
		res.Opened++
		res.Opinions = append(res.Opinions, ScanOpinion{
			StudentCode: audit.StudentCode, FullName: audit.FullName,
			Status: "OPENED", Note: "پرونده به‌صورت خودکار باز شد.",
		})
	}
	return res, nil
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

// openDossier ساخت پرونده و ارجاع به کارتابل مدیر گروه.
func (s *Service) openDossier(ctx context.Context, audit *student.AuditResult) (int64, error) {
	thesisRequired := false
	codes := "MSC,PHD"
	if s.Settings != nil {
		if v, err := s.Settings.Get(ctx, "GRAD_THESIS_DEGREE_CODES"); err == nil && strings.TrimSpace(v) != "" {
			codes = v
		}
	}
	if audit.DegreeCode != nil {
		for _, c := range strings.Split(codes, ",") {
			if strings.EqualFold(strings.TrimSpace(c), *audit.DegreeCode) {
				thesisRequired = true
			}
		}
	}
	var termID *int64
	var id int64
	_ = s.Pool.QueryRow(ctx, `select id from academic_terms where "isCurrent" = 1 limit 1`).Scan(&id)
	if id > 0 {
		termID = &id
	}
	stampFee := 0.0
	if s.Settings != nil {
		stampFee = s.Settings.GetNumber(ctx, "GRAD_STAMP_FEE", 0)
	}
	missingJSON, _ := json.Marshal(audit.Missing)
	irandocStatus := "SKIPPED"
	if thesisRequired {
		irandocStatus = "PENDING"
	}
	var auditID int64
	err := s.Pool.QueryRow(ctx, `
		insert into graduation_audits ("studentId","workflowStatus","requiredUnits","passedUnits",gpa,
		  "missingCourses","catalogOk","thesisRequired","irandocStatus","graduationTermId","stampFeeAmount")
		values ($1,'HEAD_APPROVAL',$2,$3,$4,$5,$6,$7,$8,$9,$10)
		on conflict ("studentId") do nothing returning id`,
		audit.StudentID, audit.RequiredUnits, audit.PassedUnits, audit.GPA, string(missingJSON),
		boolInt(audit.CatalogOk), boolInt(thesisRequired), irandocStatus, termID, stampFee).Scan(&auditID)
	if err != nil {
		_ = s.Pool.QueryRow(ctx, `select id from graduation_audits where "studentId" = $1 limit 1`, audit.StudentID).Scan(&auditID)
	}
	_, _ = s.Pool.Exec(ctx, `update students set status = 'PENDING_GRADUATION' where id = $1`, audit.StudentID)
	var userID int64
	if err := s.Pool.QueryRow(ctx, `select "userId" from students where id = $1`, audit.StudentID).Scan(&userID); err == nil && userID > 0 {
		gpaPart := ""
		if audit.GPA != nil {
			gpaPart = fmt.Sprintf(" (معدل کل %s)", trimFloat(*audit.GPA))
		}
		s.notifyUser(ctx, userID, "GRADUATION_STARTED", strings.Join([]string{
			audit.FullName + " عزیز، اتمام دوره تحصیلی شما را صمیمانه تبریک می‌گوییم! 🎓",
			"بر اساس تکمیل واحدهای سرفصل" + gpaPart + "، پروندهٔ فارغ‌التحصیلی شما به‌صورت خودکار تشکیل شد و نیازی به ثبت درخواست ندارید.",
			"مرحلهٔ بعد، تأیید مدیر گروه و سپس تسویه‌حساب با واحدهای دانشگاه است؛ لطفاً وضعیت بدهی مالی، امانت کتاب و خوابگاه خود را پیگیری کنید تا فرآیند بدون وقفه پیش برود.",
			"پیگیری لحظه‌ای مراحل: بخش «فارغ‌التحصیلی من» در سامانه.",
		}, "\n"))
	}
	s.notifyRole(ctx, "EDU_EXPERT", "GRADUATION_HEAD_APPROVAL",
		fmt.Sprintf("پروندهٔ فارغ‌التحصیلی %s (%s) آمادهٔ بررسی و تأیید مدیر گروه است.", audit.FullName, audit.StudentCode))
	return auditID, nil
}

func trimFloat(v float64) string {
	if v == float64(int64(v)) {
		return fmt.Sprintf("%d", int64(v))
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", v), "0"), ".")
}

// ─────────────────── اعتبارسنجی کد دپارتمان ───────────────────

var deptCodeRe = regexp.MustCompile(`^[A-Z0-9_]{2,40}$`)

// ErrDeptCode کد نامعتبر.
var ErrDeptCode = errors.New("کد فقط حروف لاتین بزرگ/عدد/زیرخط.")
