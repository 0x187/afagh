// ═══ میز خدمات / گردش‌کار درخواست‌های دانشجو (فاز ۳) ═══
//
// پورت بخش دانشجویی workflow-engine: فهرست فرایندها، ثبت درخواست (مسیر عمومی +
// گواهی اشتغال به تحصیل + تسویهٔ فارغ‌التحصیلی) و امتیاز رضایت.
package student

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/jalali"
	"backend-go/internal/safeinput"
)

// ProcessStep مرحلهٔ فرایند.
type ProcessStep struct {
	StepOrder int    `json:"stepOrder"`
	Title     string `json:"title"`
	StepType  string `json:"stepType"`
	RoleCode  string `json:"roleCode"`
	SLAHours  int    `json:"slaHours"`
}

// ProcessDef فرایند قابل درخواست.
type ProcessDef struct {
	ID          int64           `json:"id"`
	Code        string          `json:"code"`
	Title       string          `json:"title"`
	Category    string          `json:"category"`
	Description string          `json:"description"`
	FeeAmount   float64         `json:"feeAmount"`
	FormSchema  json.RawMessage `json:"formSchema"`
	Steps       []ProcessStep   `json:"steps"`
}

// RequestLog لاگ مرحله.
type RequestLog struct {
	ID              int64   `json:"id"`
	ActorRole       *string `json:"actorRole"`
	Action          *string `json:"action"`
	Note            *string `json:"note"`
	AssignedAt      *string `json:"assignedAt"`
	CompletedAt     *string `json:"completedAt"`
	DurationMinutes *int    `json:"durationMinutes"`
	SLAStatus       *string `json:"slaStatus"`
}

// RequestCheckpoint چک‌پوینت موازی.
type RequestCheckpoint struct {
	ID              int64   `json:"id"`
	DepartmentCode  string  `json:"departmentCode"`
	DepartmentTitle string  `json:"departmentTitle"`
	IsCleared       int     `json:"isCleared"`
	Notes           *string `json:"notes"`
}

// RequestRow درخواست دانشجو.
type RequestRow struct {
	ID                int64               `json:"id"`
	TrackingCode      string              `json:"trackingCode"`
	Status            string              `json:"status"`
	Created           *string             `json:"created"`
	Updated           *string             `json:"updated"`
	FormData          json.RawMessage     `json:"formData"`
	ProcessCode       string              `json:"processCode"`
	ProcessTitle      string              `json:"processTitle"`
	Category          string              `json:"category"`
	CertificateNumber *string             `json:"certificateNumber"`
	DigitalStampHash  *string             `json:"digitalStampHash"`
	SatisfactionScore *int                `json:"satisfactionScore"`
	FeedbackText      *string             `json:"feedbackText"`
	Logs              []RequestLog        `json:"logs"`
	Checkpoints       []RequestCheckpoint `json:"checkpoints"`
}

// RequestsStudent اطلاعات حداقلی دانشجو در سربرگ.
type RequestsStudent struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

// RequestsResponse پاسخ صفحهٔ میز خدمات.
type RequestsResponse struct {
	Student         RequestsStudent `json:"student"`
	StudentCode     string          `json:"studentCode"`
	NationalCode    *string         `json:"nationalCode"`
	MajorName       string          `json:"majorName"`
	DegreeTitle     string          `json:"degreeTitle"`
	UniversityTitle string          `json:"universityTitle"`
	UniversityLogo  *string         `json:"universityLogo"`
	Processes       []ProcessDef    `json:"processes"`
	MyRequests      []RequestRow    `json:"myRequests"`
}

// ListRequests پورت student/requests/page.tsx.
func (s *Service) ListRequests(ctx context.Context, userID int64, userName string) (*RequestsResponse, error) {
	me, err := s.Resolve(ctx, userID)
	if err != nil {
		return nil, err
	}
	if me == nil {
		return nil, errNoStudent
	}
	resp := &RequestsResponse{
		Student:     RequestsStudent{ID: me.ID, Name: userName, Status: me.Status},
		StudentCode: me.StudentCode,
		Processes:   []ProcessDef{},
		MyRequests:  []RequestRow{},
	}
	if me.MajorID != nil {
		_ = s.Pool.QueryRow(ctx, `select name from majors where id = $1`, *me.MajorID).Scan(&resp.MajorName)
	}
	if me.DegreeLevelID != nil {
		_ = s.Pool.QueryRow(ctx, `select title from degree_level_configs where id = $1`, *me.DegreeLevelID).Scan(&resp.DegreeTitle)
	}
	_ = s.Pool.QueryRow(ctx, `select "nationalCode" from users where id = $1`, userID).Scan(&resp.NationalCode)
	uni := s.universityInfo(ctx, me.UniversityID)
	resp.UniversityTitle = uni.Title
	resp.UniversityLogo = uni.LogoURL

	// فرایندهای فعال (به‌جز درخواست پیش‌نیاز که از انتخاب واحد ثبت می‌شود).
	prows, err := s.Pool.Query(ctx, `
		select id, code, title, coalesce(category,'عمومی'), coalesce(description,''),
		       coalesce("feeAmount",0), coalesce("formSchema",'[]')
		  from process_definitions where "isActive" = 1 order by id`)
	if err == nil {
		defer prows.Close()
		for prows.Next() {
			var p ProcessDef
			var schema string
			if err := prows.Scan(&p.ID, &p.Code, &p.Title, &p.Category, &p.Description, &p.FeeAmount, &schema); err != nil {
				continue
			}
			if p.Code == "PREREQ_WAIVER" {
				continue
			}
			if json.Valid([]byte(schema)) {
				p.FormSchema = json.RawMessage(schema)
			} else {
				p.FormSchema = json.RawMessage("[]")
			}
			steps, err := s.Pool.Query(ctx, `
				select "stepOrder", title, coalesce("stepType",'USER'), coalesce("roleCode",'USER'), coalesce("slaHours",48)
				  from process_steps where "processId" = $1 order by "stepOrder"`, p.ID)
			if err == nil {
				p.Steps = []ProcessStep{}
				for steps.Next() {
					var st ProcessStep
					if err := steps.Scan(&st.StepOrder, &st.Title, &st.StepType, &st.RoleCode, &st.SLAHours); err == nil {
						p.Steps = append(p.Steps, st)
					}
				}
				steps.Close()
			}
			resp.Processes = append(resp.Processes, p)
		}
	}

	// درخواست‌های خود دانشجو.
	rrows, err := s.Pool.Query(ctx, `
		select r.id, r."trackingCode", r.status, r."createdAt"::text, r."updatedAt"::text,
		       coalesce(r."formData",'{}'), r."processId", p.code, p.title,
		       coalesce(p.category,'عمومی'), r."certificateNumber", r."digitalStampHash",
		       r."satisfactionScore", r."feedbackText"
		  from student_requests r
		  join process_definitions p on p.id = r."processId"
		 where r."studentId" = $1 order by r.id desc`, me.ID)
	if err != nil {
		return nil, err
	}
	rows := []RequestRow{}
	for rrows.Next() {
		var r RequestRow
		var formData string
		var processID int64
		if err := rrows.Scan(&r.ID, &r.TrackingCode, &r.Status, &r.Created, &r.Updated,
			&formData, &processID, &r.ProcessCode, &r.ProcessTitle, &r.Category,
			&r.CertificateNumber, &r.DigitalStampHash, &r.SatisfactionScore, &r.FeedbackText); err != nil {
			continue
		}
		if json.Valid([]byte(formData)) {
			r.FormData = json.RawMessage(formData)
		} else {
			r.FormData = json.RawMessage("{}")
		}
		r.Logs = []RequestLog{}
		r.Checkpoints = []RequestCheckpoint{}
		rows = append(rows, r)
	}
	rrows.Close()

	for i := range rows {
		lrows, err := s.Pool.Query(ctx, `
			select id, "actorRole", action, note, "assignedAt"::text, "completedAt"::text,
			       "durationMinutes", "slaStatus"
			  from request_step_logs where "requestId" = $1 order by id`, rows[i].ID)
		if err == nil {
			for lrows.Next() {
				var l RequestLog
				if err := lrows.Scan(&l.ID, &l.ActorRole, &l.Action, &l.Note, &l.AssignedAt,
					&l.CompletedAt, &l.DurationMinutes, &l.SLAStatus); err == nil {
					rows[i].Logs = append(rows[i].Logs, l)
				}
			}
			lrows.Close()
		}
		crows, err := s.Pool.Query(ctx, `
			select id, "departmentCode", "departmentTitle", coalesce("isCleared",0), notes
			  from request_parallel_checkpoints where "requestId" = $1`, rows[i].ID)
		if err == nil {
			for crows.Next() {
				var c RequestCheckpoint
				if err := crows.Scan(&c.ID, &c.DepartmentCode, &c.DepartmentTitle, &c.IsCleared, &c.Notes); err == nil {
					rows[i].Checkpoints = append(rows[i].Checkpoints, c)
				}
			}
			crows.Close()
		}
	}
	resp.MyRequests = rows
	return resp, nil
}

// SubmitRequestResult نتیجهٔ ثبت.
type SubmitRequestResult struct {
	OK           bool   `json:"ok"`
	TrackingCode string `json:"trackingCode"`
	Status       string `json:"status"`
	Error        string `json:"error,omitempty"`
}

// SubmitRequest پورت submitStudentRequest (مسیرهای عمومی، گواهی اشتغال و تسویه).
func (s *Service) SubmitRequest(ctx context.Context, userID, studentID int64, processCode string, formData map[string]any) SubmitRequestResult {
	inputRaw, err := json.Marshal(formData)
	if err != nil || len(inputRaw) > 100*1024 {
		return SubmitRequestResult{Error: "اطلاعات فرم بیش از حد بزرگ است."}
	}
	clean := safeinput.SanitizeRequestFormData(inputRaw, studentID)
	if !clean.OK {
		return SubmitRequestResult{Error: clean.Error}
	}
	raw, err := json.Marshal(clean.Data)
	if err != nil || len(raw) > 100*1024 {
		return SubmitRequestResult{Error: "اطلاعات فرم بیش از حد بزرگ است."}
	}

	var procID int64
	var procTitle string
	var fee float64
	if err := s.Pool.QueryRow(ctx, `
		select id, title, coalesce("feeAmount",0) from process_definitions where code = $1 and "isActive" = 1 limit 1`,
		processCode).Scan(&procID, &procTitle, &fee); err != nil {
		return SubmitRequestResult{Error: "فرآیند مورد نظر یافت نشد."}
	}
	var firstStepID *int64
	var firstStepTitle, firstStepRole string
	if err := s.Pool.QueryRow(ctx, `
		select id, title, coalesce("roleCode",'USER') from process_steps
		 where "processId" = $1 order by "stepOrder" limit 1`, procID).
		Scan(&firstStepID, &firstStepTitle, &firstStepRole); err != nil {
		return SubmitRequestResult{Error: "مراحل این فرآیند هنوز پیکربندی نشده است."}
	}

	prefix := "REQ"
	if s.Settings != nil {
		if v, err := s.Settings.Get(ctx, "REQ_TRACKING_PREFIX"); err == nil && strings.TrimSpace(v) != "" {
			prefix = strings.TrimSpace(v)
		}
	}
	year := ""
	if s.Settings != nil {
		if v, err := s.Settings.Get(ctx, "FA_YEAR"); err == nil {
			year = strings.TrimSpace(v)
		}
	}
	if year == "" {
		year = fmt.Sprintf("%d", jalaliYear(time.Now()))
	}

	var result SubmitRequestResult
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return SubmitRequestResult{Error: "خطای داخلی سرور."}
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	tracking, err := nextTrackingCode(ctx, tx, prefix, year)
	if err != nil {
		return SubmitRequestResult{Error: "خطای داخلی سرور."}
	}
	now := time.Now().UTC().Format(time.RFC3339)
	status := "SUBMITTED"
	var digitalHash, certNumber *string

	switch processCode {
	case "ENROLLMENT_CERT":
		var hasEnrollment bool
		var currentTermID *int64
		_ = tx.QueryRow(ctx, `select id from academic_terms where "isCurrent" = 1 order by id desc limit 1`).Scan(&currentTermID)
		if currentTermID != nil {
			var n int
			_ = tx.QueryRow(ctx, `
				select count(*) from enrollments e
				  join course_offerings o on o.id = e."offeringId"
				 where e."studentId" = $1 and o."termId" = $2
				   and e.status in ('REGISTERED','FINALIZED')`, studentID, *currentTermID).Scan(&n)
			hasEnrollment = n > 0
		}
		balance := s.ledgerBalanceTx(ctx, tx, studentID)
		autoApprove := hasEnrollment && balance <= 0
		sum := sha256.Sum256([]byte(tracking + ":" + fmt.Sprintf("%d", studentID) + ":" + now + ":AFAGH_CERT"))
		h := hex.EncodeToString(sum[:])
		digitalHash = &h
		cert := strings.Replace(tracking, prefix, "CERT", 1)
		certNumber = &cert
		if autoApprove {
			status = "APPROVED"
		} else {
			status = "IN_REVIEW"
		}
		var rowID int64
		if err := tx.QueryRow(ctx, `
			insert into student_requests
				("trackingCode","studentId","processId","currentStepId","formData",status,
				 "digitalStampHash","certificateNumber","issuedAt","updatedAt")
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) returning id`,
			tracking, studentID, procID, firstStepID, string(raw), status,
			digitalHash, certNumber, boolToTime(autoApprove, time.Now())).Scan(&rowID); err != nil {
			return SubmitRequestResult{Error: "ثبت درخواست ناموفق بود: " + err.Error()}
		}
		note := ""
		if autoApprove {
			note = fmt.Sprintf("احراز صلاحیت خودکار: ثبت‌نام ترم جاری و تراز مالی (%s ریال) تأیید و گواهی صادر شد.", jalali.GroupThousands(balance))
		} else {
			enr := "بدون انتخاب واحد در ترم جاری"
			if hasEnrollment {
				enr = "ثبت‌نام ترم جاری دارد"
			}
			note = fmt.Sprintf("عدم احراز شرایط خودکار (%s؛ تراز مالی %s ریال) — در انتظار بررسی کارشناس آموزش.", enr, jalali.GroupThousands(balance))
		}
		_, _ = tx.Exec(ctx, `
			insert into request_step_logs ("requestId","stepId","assignedAt","completedAt","actorRole",action,note,"slaStatus")
			values ($1,$2,now(),$3,'SYSTEM_BOT',$4,$5,'ON_TIME')`,
			rowID, firstStepID, boolToTime(autoApprove, time.Now()), map[bool]string{true: "APPROVE", false: "SUBMIT"}[autoApprove], note)
		if fee > 0 {
			_, _ = tx.Exec(ctx, `
				insert into student_ledger ("studentId","termId","transactionType",amount,description)
				values ($1,$2,'CHARGE',$3,$4)`, studentID, currentTermID, fee,
				fmt.Sprintf("هزینهٔ فرایند «%s» — %s", procTitle, tracking))
		}
		text := fmt.Sprintf("درخواست گواهی اشتغال به تحصیل شما با کد رهگیری %s ثبت شد.", tracking)
		if autoApprove {
			text = fmt.Sprintf("گواهی اشتغال به تحصیل شما به شماره %s صادر شد و آمادهٔ دریافت/چاپ است.", cert)
		}
		notifyText(ctx, tx, userID, "REQUEST_SUBMITTED", text)
		result = SubmitRequestResult{OK: true, TrackingCode: tracking, Status: status}

	case "GRADUATION_CHECKOUT":
		status = "IN_REVIEW"
		var rowID int64
		if err := tx.QueryRow(ctx, `
			insert into student_requests
				("trackingCode","studentId","processId","currentStepId","formData",status,"updatedAt")
			values ($1,$2,$3,$4,$5,$6,now()) returning id`,
			tracking, studentID, procID, firstStepID, string(raw), status).Scan(&rowID); err != nil {
			return SubmitRequestResult{Error: "ثبت درخواست ناموفق بود: " + err.Error()}
		}
		checkpoints := [][2]string{
			{"FINANCE", "امور مالی و شهریه (عدم بدهی)"},
			{"LIBRARY", "کتابخانه مرکزی (عدم امانت کتاب)"},
			{"WELFARE_FUND", "صندوق رفاه دانشجویان (تسویه وام)"},
			{"LABORATORY", "آزمایشگاه‌ها و کارگاه‌های تخصصی"},
			{"DORMITORY", "امور خوابگاه‌ها و اسکان"},
		}
		for _, cp := range checkpoints {
			_, _ = tx.Exec(ctx, `
				insert into request_parallel_checkpoints ("requestId","departmentCode","departmentTitle","isCleared")
				values ($1,$2,$3,0)`, rowID, cp[0], cp[1])
		}
		_, _ = tx.Exec(ctx, `
			insert into request_step_logs ("requestId","stepId","assignedAt","actorRole",action,note,"slaStatus")
			values ($1,$2,now(),'MULTI_CHECKPOINT','SUBMIT',$3,'ON_TIME')`,
			rowID, firstStepID, "پرونده تسویه حساب موازی تشکیل شد و برای واحدهای پنج‌گانه ارسال گردید.")
		notifyText(ctx, tx, userID, "REQUEST_SUBMITTED",
			fmt.Sprintf("پروندهٔ تسویه حساب فارغ‌التحصیلی شما با کد رهگیری %s تشکیل شد.", tracking))
		result = SubmitRequestResult{OK: true, TrackingCode: tracking, Status: status}

	default:
		status = "SUBMITTED"
		var rowID int64
		if err := tx.QueryRow(ctx, `
			insert into student_requests
				("trackingCode","studentId","processId","currentStepId","formData",status,"updatedAt")
			values ($1,$2,$3,$4,$5,$6,now()) returning id`,
			tracking, studentID, procID, firstStepID, string(raw), status).Scan(&rowID); err != nil {
			return SubmitRequestResult{Error: "ثبت درخواست ناموفق بود: " + err.Error()}
		}
		_, _ = tx.Exec(ctx, `
			insert into request_step_logs ("requestId","stepId","assignedAt","actorRole",action,note,"slaStatus")
			values ($1,$2,now(),$3,'SUBMIT',$4,'ON_TIME')`,
			rowID, firstStepID, firstStepRole,
			fmt.Sprintf("درخواست با موفقیت ثبت و به کارتابل %s ارجاع داده شد.", firstStepTitle))
		if fee > 0 {
			var currentTermID *int64
			_ = tx.QueryRow(ctx, `select id from academic_terms where "isCurrent" = 1 order by id desc limit 1`).Scan(&currentTermID)
			_, _ = tx.Exec(ctx, `
				insert into student_ledger ("studentId","termId","transactionType",amount,description)
				values ($1,$2,'CHARGE',$3,$4)`, studentID, currentTermID, fee,
				fmt.Sprintf("هزینهٔ فرایند «%s» — %s", procTitle, tracking))
		}
		notifyText(ctx, tx, userID, "REQUEST_SUBMITTED",
			fmt.Sprintf("درخواست «%s» با کد رهگیری %s ثبت و به کارتابل %s ارجاع شد.", procTitle, tracking, firstStepTitle))
		result = SubmitRequestResult{OK: true, TrackingCode: tracking, Status: status}
	}
	if err := tx.Commit(ctx); err != nil {
		return SubmitRequestResult{Error: "ثبت درخواست ناموفق بود."}
	}
	return result
}

// RateSatisfaction پورت submitRequestSatisfaction با مالکیت.
func (s *Service) RateSatisfaction(ctx context.Context, studentID, requestID int64, score int, feedback string) error {
	if score < 1 {
		score = 1
	}
	if score > 5 {
		score = 5
	}
	var fb *string
	if strings.TrimSpace(feedback) != "" {
		v := strings.TrimSpace(feedback)
		fb = &v
	}
	tag, err := s.Pool.Exec(ctx, `
		update student_requests set "satisfactionScore" = $1, "feedbackText" = $2, "updatedAt" = now()
		 where id = $3 and "studentId" = $4`, score, fb, requestID, studentID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("درخواست یافت نشد.")
	}
	return nil
}

// ── ابزارها ──

func notifyText(ctx context.Context, tx pgx.Tx, userID int64, eventCode, text string) {
	payload, _ := json.Marshal(map[string]string{"text": text})
	_, _ = tx.Exec(ctx, `insert into notifications ("userId","eventCode",payload) values ($1,$2,$3)`,
		userID, eventCode, string(payload))
}

func boolToTime(ok bool, t time.Time) *time.Time {
	if !ok {
		return nil
	}
	v := t
	return &v
}

func (s *Service) ledgerBalanceTx(ctx context.Context, tx pgx.Tx, studentID int64) float64 {
	rows, err := tx.Query(ctx, `select "transactionType", amount::float8 from student_ledger where "studentId" = $1`, studentID)
	if err != nil {
		return 0
	}
	defer rows.Close()
	debtTypes := map[string]bool{
		"TUITION_FIXED": true, "TUITION_VARIABLE": true, "TUITION_CHARGE": true,
		"CHARGE": true, "FINE": true, "PENALTY": true, "TUITION_ADJUST_DEC": true,
	}
	creditTypes := map[string]bool{
		"PAYMENT": true, "POS_PAYMENT": true, "DISCOUNT": true, "SCHOLARSHIP": true,
		"TUITION_ADJUST_INC": true, "REFUND": true,
	}
	debt, credit := 0.0, 0.0
	for rows.Next() {
		var t *string
		var amount float64
		if err := rows.Scan(&t, &amount); err != nil {
			continue
		}
		key := ""
		if t != nil {
			key = strings.ToUpper(strings.TrimSpace(*t))
		}
		if debtTypes[key] {
			debt += amount
		} else if creditTypes[key] {
			credit += amount
		}
	}
	return debt - credit
}

func nextTrackingCode(ctx context.Context, tx pgx.Tx, prefix, year string) (string, error) {
	var n int64
	// دنباله ممکن است در محیط توسعه ساخته نشده باشد؛ بدون SAVEPOINT خطا کل
	// تراکنش را abort می‌کند (25P02) و ثبت درخواست همیشه شکست می‌خورد.
	_, _ = tx.Exec(ctx, `SAVEPOINT tracking_seq`)
	if err := tx.QueryRow(ctx, `select nextval('tracking_code_seq')`).Scan(&n); err == nil && n > 0 {
		_, _ = tx.Exec(ctx, `RELEASE SAVEPOINT tracking_seq`)
		return fmt.Sprintf("%s-%s-%05d", prefix, year, n), nil
	}
	_, _ = tx.Exec(ctx, `ROLLBACK TO SAVEPOINT tracking_seq`)
	var count int64
	_ = tx.QueryRow(ctx, `select count(*) from student_requests where "trackingCode" like $1`, "%"+year+"%").Scan(&count)
	base := count + 1
	for i := 0; i < 50; i++ {
		code := fmt.Sprintf("%s-%s-%05d", prefix, year, base+int64(i))
		var one int
		if err := tx.QueryRow(ctx, `select 1 from student_requests where "trackingCode" = $1 limit 1`, code).Scan(&one); err != nil {
			return code, nil
		}
	}
	return fmt.Sprintf("%s-%s-%s", prefix, year, strings.ToUpper(fmt.Sprintf("%x", time.Now().UnixNano())[:6])), nil
}

func jalaliYear(t time.Time) int {
	return jalali.ToJalaliFromTime(t).Y
}

// MaxUploadBytes سقف پیوست درخواست (۱۰ مگابایت).
const MaxUploadBytes = 10 * 1024 * 1024

// UploadedAttachment متادیتای پیوست ذخیره‌شده.
type UploadedAttachment struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	MimeType string `json:"mimeType"`
}

// UploadRequestAttachment پورت uploadRequestAttachmentAction.
func (s *Service) UploadRequestAttachment(ctx context.Context, studentID int64, fileName, claimedType string, data []byte) (*UploadedAttachment, error) {
	if len(data) == 0 {
		return nil, errors.New("فایلی انتخاب نشده است.")
	}
	if len(data) > MaxUploadBytes {
		return nil, errors.New("حجم پیوست نباید بیش از ۱۰ مگابایت باشد.")
	}
	check := safeinput.CheckUpload(fileName, claimedType, data)
	if !check.OK {
		return nil, errors.New(check.Error)
	}
	if s.Archive == nil {
		return nil, errors.New("خطا در ذخیرهٔ پیوست (Object Storage در دسترس نیست).")
	}
	key := fmt.Sprintf("requests/%d/attach-%d-%03d.%s", studentID, time.Now().UnixMilli(), rand.Intn(900)+100, check.Ext)
	if err := s.Archive.Put(ctx, key, check.Mime, data); err != nil {
		return nil, errors.New("خطا در ذخیرهٔ پیوست (Object Storage در دسترس نیست): " + err.Error())
	}
	return &UploadedAttachment{Key: key, Name: fileName, Size: int64(len(data)), MimeType: check.Mime}, nil
}
