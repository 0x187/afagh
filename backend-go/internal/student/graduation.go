// ═══ Student graduation — port of getStudentTracker / auditStudent / advanceDossier ═══
package student

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"backend-go/internal/enroll"
	"backend-go/internal/finance"
	"backend-go/internal/gpa"
	"backend-go/internal/jalali"
	"backend-go/internal/safeinput"
	"backend-go/internal/messaging"
)

// MissingCourse is a remaining curriculum course.
type MissingCourse struct {
	Code  string  `json:"code"`
	Title string  `json:"title"`
	Units float64 `json:"units"`
}

// AuditResult is the transcript-vs-curriculum audit result.
type AuditResult struct {
	StudentID     int64           `json:"studentId"`
	StudentCode   string          `json:"studentCode"`
	FullName      string          `json:"fullName"`
	MajorName     *string         `json:"majorName"`
	DegreeCode    *string         `json:"degreeCode"`
	RequiredUnits float64         `json:"requiredUnits"`
	PassedUnits   float64         `json:"passedUnits"`
	GPA           *float64        `json:"gpa"`
	Missing       []MissingCourse `json:"missing"`
	CatalogOk     bool            `json:"catalogOk"`
	Reasons       []string        `json:"reasons"`
}

// AuditInfo is a graduation-dossier row.
type AuditInfo struct {
	ID                 int64           `json:"id"`
	StudentID          int64           `json:"studentId"`
	WorkflowStatus     string          `json:"workflowStatus"`
	RequiredUnits      float64         `json:"requiredUnits"`
	PassedUnits        float64         `json:"passedUnits"`
	GPA                *float64        `json:"gpa"`
	MissingCourses     []MissingCourse `json:"missingCourses"`
	CatalogOk          bool            `json:"catalogOk"`
	HeadApprovalStatus int             `json:"headApprovalStatus"`
	HeadNote           *string         `json:"headNote"`
	ThesisRequired     int             `json:"thesisRequired"`
	IrandocStatus      *string         `json:"irandocStatus"`
	SajjadStatus       *string         `json:"sajjadStatus"`
	SajjadRequestCode  *string         `json:"sajjadRequestCode"`
	PhotoDocumentID    *int64          `json:"photoDocumentId"`
	StampFeePaid       int             `json:"stampFeePaid"`
	StampFeeAmount     float64         `json:"stampFeeAmount"`
	StartedAt          *string         `json:"startedAt"`
	LastEventAt        *string         `json:"lastEventAt"`
	CompletedAt        *string         `json:"completedAt"`
	Note               *string         `json:"note"`
}

// ClearanceItem is a settlement row.
type ClearanceItem struct {
	ID          int64   `json:"id"`
	Department  string  `json:"department"`
	Title       string  `json:"title"`
	Status      string  `json:"status"`
	AmountDue   float64 `json:"amountDue"`
	Detail      *string `json:"detail"`
	AutoChecked bool    `json:"autoChecked"`
	ResolvedAt  *string `json:"resolvedAt"`
}

// DegreeItem is an issued degree.
type DegreeItem struct {
	ID          int64  `json:"id"`
	DegreeType  string `json:"degreeType"`
	SerialNo    string `json:"serialNo"`
	VerifyCode  string `json:"verifyCode"`
	IsDelivered bool   `json:"isDelivered"`
	IssuedAt    string `json:"issuedAt"`
}

// TrackerStudent is the student info in the dossier.
type TrackerStudent struct {
	StudentCode string  `json:"studentCode"`
	FullName    string  `json:"fullName"`
	MajorName   *string `json:"majorName"`
	DegreeTitle *string `json:"degreeTitle"`
	Status      string  `json:"status"`
}

// TrackerDossier is the open dossier.
type TrackerDossier struct {
	Audit     AuditInfo       `json:"audit"`
	Student   TrackerStudent  `json:"student"`
	Checklist []ClearanceItem `json:"checklist"`
	Degrees   []DegreeItem    `json:"degrees"`
}

// TrackerStep is a workflow step.
type TrackerStep struct {
	Code  string `json:"code"`
	Title string `json:"title"`
	Actor string `json:"actor"`
	State string `json:"state"`
}

// Tracker is the tracker response.
type Tracker struct {
	Open           bool            `json:"open"`
	Audit          *AuditResult    `json:"audit,omitempty"`
	NeedPhoto      bool            `json:"needPhoto"`
	SajjadRequired bool            `json:"sajjadRequired"`
	NeedSajjad     bool            `json:"needSajjad"`
	SajjadPortal   string          `json:"sajjadPortal"`
	Dossier        *TrackerDossier `json:"dossier,omitempty"`
	Steps          []TrackerStep   `json:"steps,omitempty"`
}

var workflowSteps = []struct{ Code, Title, Actor string }{
	{"CATALOG_REVIEW", "تطبیق سرفصل و بررسی واحدها", "سیستم"},
	{"HEAD_APPROVAL", "تأیید مدیر گروه", "مدیر گروه"},
	{"IRANDOC_VERIFICATION", "استعلام همانندجویی ایرانداک", "سیستم"},
	{"CLEARANCE", "تسویه‌حساب موازی دپارتمان‌ها", "سیستم / کارشناسان"},
	{"SAJJAD_REQUEST", "ثبت درخواست کد صحت در سامانهٔ سجاد", "دانشجو"},
	{"FINAL_DOCS", "مدارک پایانی (عکس و تمبر)", "دانشجو"},
	{"READY_TO_ISSUE", "کارشناس صدور مدرک", "اداره آموزش"},
	{"ISSUED", "مدرک صادر شد", "—"},
}

func stepsFor(thesisRequired, sajjadRequired bool) []TrackerStep {
	out := []TrackerStep{}
	for _, s := range workflowSteps {
		if s.Code == "IRANDOC_VERIFICATION" && !thesisRequired {
			continue
		}
		if s.Code == "SAJJAD_REQUEST" && !sajjadRequired {
			continue
		}
		out = append(out, TrackerStep{Code: s.Code, Title: s.Title, Actor: s.Actor})
	}
	return out
}

func stepState(current, code string) string {
	ci, si := -1, -1
	for i, s := range workflowSteps {
		if s.Code == current {
			ci = i
		}
		if s.Code == code {
			si = i
		}
	}
	if ci < 0 || si < 0 {
		return "TODO"
	}
	if si < ci {
		return "DONE"
	}
	if si == ci {
		if current == "ISSUED" {
			return "DONE"
		}
		return "CURRENT"
	}
	return "TODO"
}

// auditStudent ports auditStudent.
func (s *Service) auditStudent(ctx context.Context, studentID int64) (*AuditResult, error) {
	var (
		studentCode, firstName, lastName   string
		majorName, degreeCode, degreeTitle *string
		degreeLevelID, regulationID        *int64
		entryYear                          int
		entryTerm                          *int
	)
	err := s.Pool.QueryRow(ctx, `
		select st."studentCode", coalesce(u."firstName",''), coalesce(u."lastName",''),
		       m.name, d.code, d.title, st."degreeLevelId", st."regulationId",
		       st."entryYear", st."entryTerm"
		  from students st
		  join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		  left join degree_level_configs d on d.id = st."degreeLevelId"
		 where st.id = $1`, studentID).
		Scan(&studentCode, &firstName, &lastName, &majorName, &degreeCode, &degreeTitle,
			&degreeLevelID, &regulationID, &entryYear, &entryTerm)
	if err != nil {
		return nil, nil
	}
	_ = degreeTitle
	_ = entryYear
	_ = entryTerm

	cfg := enroll.LoadRegulationConfig(ctx, s.Pool, regulationID, degreeLevelID)
	passing := cfg.PassingGrade
	if passing <= 0 {
		passing = 10
	}
	minGPA := 12.0
	if s.Settings != nil {
		minGPA = s.Settings.GetNumber(ctx, "GRAD_MIN_GPA", 12)
	}

	rows, err := s.Pool.Query(ctx, `
		select o."courseId", c.code, c.units, c."affectsGpa", c."minPassedMark",
		       e."gradeValue", e."gradeStatus", e."samaGradeStatusCode", c."gradingType"
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1
		   and e."gradeStatus" in ('FINALIZED','EXEMPT','PASSED_NO_GRADE')`, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	gpaRows := []gpa.Row{}
	for rows.Next() {
		var (
			courseID                       int64
			code                           string
			units                          float64
			affects                        *int
			minMark                        *float64
			gradeVal                       *float64
			gradeStatus, sama, gradingType *string
		)
		if err := rows.Scan(&courseID, &code, &units, &affects, &minMark,
			&gradeVal, &gradeStatus, &sama, &gradingType); err != nil {
			continue
		}
		var gv any
		if gradeVal != nil {
			gv = *gradeVal
		}
		var mm any
		if minMark != nil {
			mm = *minMark
		}
		gpaRows = append(gpaRows, gpa.Row{
			CourseID: &courseID, Code: code, Units: units, GradeValue: gv,
			GradeStatus: gradeStatus, SamaGradeStatusCode: sama,
			GradingType: gradingType, AffectsGpa: affects, CourseMinMark: mm,
		})
	}
	core := gpa.AggregateAuditTranscript(gpaRows, passing)
	passedIDs := core.PassedIDs
	passedUnits := core.PassedUnits
	gpaVal := core.GPA

	version, _ := enroll.ResolveStudentCurriculum(ctx, s.Pool, studentID)
	requiredUnits := 0.0
	missing := []MissingCourse{}
	reasons := []string{}
	if version != nil {
		requiredUnits = float64(version.TotalRequiredUID)
		vrows, err := s.Pool.Query(ctx, `
			select cc."courseId", c.code, c.title, c.units
			  from curriculum_courses cc join courses c on c.id = cc."courseId"
			 where cc."curriculumVersionId" = $1`, version.ID)
		if err == nil {
			for vrows.Next() {
				var cid int64
				var code, title string
				var units float64
				if err := vrows.Scan(&cid, &code, &title, &units); err != nil {
					continue
				}
				if !passedIDs[cid] {
					missing = append(missing, MissingCourse{Code: code, Title: title, Units: units})
				}
			}
			vrows.Close()
		}
		if requiredUnits == 0 {
			for _, m := range missing {
				requiredUnits += m.Units
			}
			requiredUnits += passedUnits
		}
	} else {
		reasons = append(reasons, "برای این رشته/سال ورود، نسخهٔ برنامهٔ درسی قابل اعمالی ثبت نشده است؛ تشکیل خودکار پرونده ممکن نیست و نیازمند بررسی کارشناس آموزش است.")
	}

	if len(missing) > 0 {
		reasons = append(reasons, fmt.Sprintf("%d درس اجباری سرفصل هنوز پاس نشده است.", len(missing)))
	}
	if requiredUnits > 0 && passedUnits < requiredUnits {
		reasons = append(reasons, fmt.Sprintf("واحد گذرانده (%s) کمتر از حداقل لازم (%s) است.", faDecimal(passedUnits), faDecimal(requiredUnits)))
	}
	if gpaVal != nil && *gpaVal < minGPA {
		reasons = append(reasons, fmt.Sprintf("معدل کل (%s) کمتر از حداقل مجاز (%s) است.", faDecimal(*gpaVal), faDecimal(minGPA)))
	}
	if gpaVal == nil {
		reasons = append(reasons, "هنوز هیچ نمرهٔ عددی قطعی‌ای ثبت نشده است.")
	}
	catalogOk := version != nil && len(missing) == 0 &&
		(requiredUnits == 0 || passedUnits >= requiredUnits) &&
		gpaVal != nil && *gpaVal >= minGPA

	return &AuditResult{
		StudentID: studentID, StudentCode: studentCode,
		FullName:  strings.TrimSpace(firstName + " " + lastName),
		MajorName: majorName, DegreeCode: degreeCode,
		RequiredUnits: requiredUnits, PassedUnits: passedUnits, GPA: gpaVal,
		Missing: missing, CatalogOk: catalogOk, Reasons: reasons,
	}, nil
}

// AuditStudentForAdmin audits the transcript against the curriculum — for the admin graduation desk.
// (same internal auditStudent so the audit logic does not fork into two versions.)
func (s *Service) AuditStudentForAdmin(ctx context.Context, studentID int64) (*AuditResult, error) {
	return s.auditStudent(ctx, studentID)
}

// AdvanceDossierByID recomputes the dossier status with the same internal engine.
func (s *Service) AdvanceDossierByID(ctx context.Context, auditID int64) error {
	return s.advanceDossier(ctx, auditID, 0)
}

// StartClearanceForAudit builds the checklist and auto-checks the finance ledger.
func (s *Service) StartClearanceForAudit(ctx context.Context, auditID int64) error {
	var studentID int64
	if err := s.Pool.QueryRow(ctx, `select "studentId" from graduation_audits where id = $1`, auditID).Scan(&studentID); err != nil {
		return errors.New("پرونده یافت نشد.")
	}
	return s.startClearance(ctx, auditID, studentID)
}

// LedgerBalanceOfStudent is the canonical student balance (positive = debt, negative → zero).
func (s *Service) LedgerBalanceOfStudent(ctx context.Context, studentID int64) float64 {
	return s.ledgerBalanceStudent(ctx, studentID)
}

// GetTracker ports getStudentTracker.
func (s *Service) GetTracker(ctx context.Context, studentID int64) (*Tracker, error) {
	var auditID int64
	err := s.Pool.QueryRow(ctx, `select id from graduation_audits where "studentId" = $1 limit 1`, studentID).Scan(&auditID)
	if err != nil {
		audit, err := s.auditStudent(ctx, studentID)
		if err != nil {
			return nil, err
		}
		return &Tracker{Open: false, Audit: audit}, nil
	}

	var (
		studentIDRow                                  int64
		workflowStatus                                string
		reqUnits, passUnits, stampFee                 float64
		auditGPA                                      *float64
		missingJSON                                   string
		catalogOk, headApproval, thesisRequired       int
		stampFeePaid                                  int
		irandocStatus, sajjadStatus, sajjadCode, note *string
		photoDocID                                    *int64
		headNote                                      *string
		startedAt, lastEventAt, completedAt           *string
	)
	err = s.Pool.QueryRow(ctx, `
		select "studentId", "workflowStatus", coalesce("requiredUnits",0), coalesce("passedUnits",0),
		       gpa, coalesce("missingCourses",'[]')::text, coalesce("catalogOk",0),
		       coalesce("headApprovalStatus",0), "headNote", coalesce("thesisRequired",0),
		       "irandocStatus", "sajjadStatus", "sajjadRequestCode",
		       "photoDocumentId", coalesce("stampFeePaid",0), coalesce("stampFeeAmount",0),
		       "startedAt"::text, "lastEventAt"::text, "completedAt"::text, note
		  from graduation_audits where id = $1`, auditID).
		Scan(&studentIDRow, &workflowStatus, &reqUnits, &passUnits, &auditGPA, &missingJSON,
			&catalogOk, &headApproval, &headNote, &thesisRequired, &irandocStatus,
			&sajjadStatus, &sajjadCode, &photoDocID, &stampFeePaid, &stampFee,
			&startedAt, &lastEventAt, &completedAt, &note)
	if err != nil {
		return nil, err
	}
	missing := []MissingCourse{}
	_ = json.Unmarshal([]byte(missingJSON), &missing)

	requirePhoto := s.Settings != nil && s.Settings.GetBool(ctx, "GRAD_REQUIRE_PHOTO")
	requireSajjad := s.Settings != nil && s.Settings.GetBool(ctx, "GRAD_REQUIRE_SAJJAD")
	sajjadSkipped := sajjadStatus != nil && (*sajjadStatus == "SKIPPED" || *sajjadStatus == "CONFIRMED")
	sajjadRequired := requireSajjad && !sajjadSkipped
	needSajjad := requireSajjad && !sajjadSkipped && (sajjadCode == nil || *sajjadCode == "")
	portal := "https://portal.saorg.ir"
	if s.Settings != nil {
		if v, err := s.Settings.Get(ctx, "SAJJAD_PORTAL_URL"); err == nil && strings.HasPrefix(v, "http") {
			portal = v
		}
	}

	tracker := &Tracker{
		Open: true, NeedPhoto: requirePhoto, SajjadRequired: sajjadRequired,
		NeedSajjad: needSajjad, SajjadPortal: portal,
	}
	steps := stepsFor(thesisRequired != 0, sajjadRequired)
	for i := range steps {
		steps[i].State = stepState(workflowStatus, steps[i].Code)
	}
	tracker.Steps = steps

	var (
		studentCode, firstName, lastName string
		majorName, degreeTitle           *string
		status                           string
	)
	_ = s.Pool.QueryRow(ctx, `
		select st."studentCode", coalesce(u."firstName",''), coalesce(u."lastName",''),
		       m.name, d.title, st.status
		  from students st
		  join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		  left join degree_level_configs d on d.id = st."degreeLevelId"
		 where st.id = $1`, studentIDRow).
		Scan(&studentCode, &firstName, &lastName, &majorName, &degreeTitle, &status)

	info := AuditInfo{
		ID: auditID, StudentID: studentIDRow, WorkflowStatus: workflowStatus,
		RequiredUnits: reqUnits, PassedUnits: passUnits, GPA: auditGPA,
		MissingCourses: missing, CatalogOk: catalogOk != 0,
		HeadApprovalStatus: headApproval, HeadNote: headNote,
		ThesisRequired: thesisRequired, IrandocStatus: irandocStatus,
		SajjadStatus: sajjadStatus, SajjadRequestCode: sajjadCode,
		PhotoDocumentID: photoDocID, StampFeePaid: stampFeePaid, StampFeeAmount: stampFee,
		StartedAt: startedAt, LastEventAt: lastEventAt, CompletedAt: completedAt, Note: note,
	}

	checklist := []ClearanceItem{}
	crows, err := s.Pool.Query(ctx, `
		select cc.id, cc.department, coalesce(cd.title, cc.department), cc.status,
		       coalesce(cc."amountDue",0), cc.detail, coalesce(cc."autoChecked",0), cc."resolvedAt"::text
		  from clearance_checklist cc
		  left join clearance_departments cd on cd.code = cc.department
		 where cc."auditId" = $1`, auditID)
	if err == nil {
		for crows.Next() {
			var c ClearanceItem
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
		select id, "degreeType", "serialNo", "verifyCode", coalesce("isDelivered",0), "issuedAt"::text
		  from issued_degrees where "studentId" = $1 order by id desc`, studentIDRow)
	if err == nil {
		for drows.Next() {
			var d DegreeItem
			var delivered int
			if err := drows.Scan(&d.ID, &d.DegreeType, &d.SerialNo, &d.VerifyCode, &delivered, &d.IssuedAt); err == nil {
				d.IsDelivered = delivered != 0
				degrees = append(degrees, d)
			}
		}
		drows.Close()
	}

	tracker.Dossier = &TrackerDossier{
		Audit: info,
		Student: TrackerStudent{
			StudentCode: studentCode, FullName: strings.TrimSpace(firstName + " " + lastName),
			MajorName: majorName, DegreeTitle: degreeTitle, Status: status,
		},
		Checklist: checklist, Degrees: degrees,
	}
	return tracker, nil
}

// SubmitSajjad ports submitSajjadRequest.
func (s *Service) SubmitSajjad(ctx context.Context, studentID, auditID int64, code string) error {
	code = strings.TrimSpace(code)
	if len([]rune(code)) < 4 {
		return errors.New("کد رهگیری درخواست سجاد را کامل وارد کنید.")
	}
	var owner int64
	if err := s.Pool.QueryRow(ctx, `select "studentId" from graduation_audits where id = $1`, auditID).Scan(&owner); err != nil || owner != studentID {
		return errors.New("دسترسی به این پرونده مجاز نیست.")
	}
	if _, err := s.Pool.Exec(ctx, `
		update graduation_audits set "sajjadRequestCode" = $1, "sajjadStatus" = 'SUBMITTED',
		       "sajjadRequestedAt" = now(), "lastEventAt" = now()
		 where id = $2`, code, auditID); err != nil {
		return err
	}
	return s.advanceDossier(ctx, auditID, 0)
}

// AttachGraduationPhoto uploads a 4×3 photo and attaches it to the dossier.
func (s *Service) AttachGraduationPhoto(ctx context.Context, userID, studentID, auditID int64, fileName, mime string, data []byte) error {
	var owner int64
	if err := s.Pool.QueryRow(ctx, `select "studentId" from graduation_audits where id = $1`, auditID).Scan(&owner); err != nil || owner != studentID {
		return errors.New("دسترسی به این پرونده مجاز نیست.")
	}
	if len(data) == 0 || len(data) > MaxUploadBytes {
		return errors.New("حجم عکس باید بیش از صفر و حداکثر ۱۰ مگابایت باشد.")
	}
	check := safeinput.CheckUpload(fileName, mime, data)
	if !check.OK {
		return errors.New(check.Error)
	}
	if !strings.HasPrefix(check.Mime, "image/") {
		return errors.New("برای عکس پرسنلی فقط فایل تصویری مجاز است.")
	}
	if s.Archive == nil {
		return errors.New("آرشیو پیکربندی نشده است.")
	}
	var categoryID int64
	if err := s.Pool.QueryRow(ctx, `select id from document_categories where title = 'عکس پرسنلی' limit 1`).Scan(&categoryID); err != nil {
		_ = s.Pool.QueryRow(ctx, `
			insert into document_categories (title, scope) values ('عکس پرسنلی','STUDENT') returning id`).Scan(&categoryID)
	}
	key := fmt.Sprintf("students/%d/photo-%d.%s", studentID, time.Now().UnixMilli(), check.Ext)
	if err := s.Archive.Put(ctx, key, check.Mime, data); err != nil {
		return errors.New("ذخیرهٔ عکس ناموفق بود: " + err.Error())
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	var docID int64
	if err := s.Pool.QueryRow(ctx, `
		insert into student_documents ("personUserId","categoryId","fileName","fileUrl","mimeType","contentHash","verificationStatus")
		values ($1,$2,$3,$4,$5,$6,'PENDING') returning id`,
		userID, categoryID, fileName, key, check.Mime, hash).Scan(&docID); err != nil {
		return err
	}
	if _, err := s.Pool.Exec(ctx, `
		update graduation_audits set "photoDocumentId" = $1, "lastEventAt" = now() where id = $2`,
		docID, auditID); err != nil {
		return err
	}
	return s.advanceDossier(ctx, auditID, 0)
}

// advanceDossier ports advanceDossier (the student subset).
func (s *Service) advanceDossier(ctx context.Context, auditID int64, depth int) error {
	if depth > 3 {
		return nil
	}
	var (
		studentID                    int64
		status                       string
		headApproval, thesisRequired int
		irandocStatus, sajjadCode    *string
		sajjadStatus                 *string
		photoDocID                   *int64
		stampFeePaid                 int
		stampFee                     float64
	)
	err := s.Pool.QueryRow(ctx, `
		select "studentId", "workflowStatus", coalesce("headApprovalStatus",0),
		       coalesce("thesisRequired",0), "irandocStatus", "sajjadRequestCode",
		       "sajjadStatus", "photoDocumentId", coalesce("stampFeePaid",0), coalesce("stampFeeAmount",0)
		  from graduation_audits where id = $1`, auditID).
		Scan(&studentID, &status, &headApproval, &thesisRequired, &irandocStatus,
			&sajjadCode, &sajjadStatus, &photoDocID, &stampFeePaid, &stampFee)
	if err != nil {
		return err
	}
	if status == "ISSUED" || status == "ON_HOLD" {
		return nil
	}

	next := status
	switch {
	case headApproval == 0:
		next = "HEAD_APPROVAL"
	case thesisRequired != 0 && (irandocStatus == nil || (*irandocStatus != "PASSED" && *irandocStatus != "SKIPPED")):
		next = "IRANDOC_VERIFICATION"
	default:
		var total, openCount int
		_ = s.Pool.QueryRow(ctx, `
			select count(*), count(*) filter (where status not in ('CLEARED','WAIVED'))
			  from clearance_checklist where "auditId" = $1`, auditID).Scan(&total, &openCount)
		if total == 0 {
			if err := s.startClearance(ctx, auditID, studentID); err != nil {
				return err
			}
			return s.advanceDossier(ctx, auditID, depth+1)
		}
		if openCount > 0 {
			next = "CLEARANCE"
		} else {
			requireSajjad := s.Settings != nil && s.Settings.GetBool(ctx, "GRAD_REQUIRE_SAJJAD")
			sajjadDone := sajjadStatus != nil && (*sajjadStatus == "SKIPPED" || *sajjadStatus == "CONFIRMED")
			needSajjad := requireSajjad && !sajjadDone && (sajjadCode == nil || *sajjadCode == "")
			if needSajjad {
				next = "SAJJAD_REQUEST"
			} else {
				needPhoto := s.Settings != nil && s.Settings.GetBool(ctx, "GRAD_REQUIRE_PHOTO")
				photoOK := !needPhoto || photoDocID != nil
				feeOK := stampFee <= 0 || stampFeePaid != 0
				if photoOK && feeOK {
					next = "READY_TO_ISSUE"
				} else {
					next = "FINAL_DOCS"
				}
			}
		}
	}
	if next == status {
		return nil
	}
	if _, err := s.Pool.Exec(ctx, `
		update graduation_audits set "workflowStatus" = $1, "lastEventAt" = now() where id = $2`, next, auditID); err != nil {
		return err
	}
	var userID int64
	_ = s.Pool.QueryRow(ctx, `select "userId" from students where id = $1`, studentID).Scan(&userID)
	if userID != 0 {
		text := ""
		switch next {
		case "SAJJAD_REQUEST":
			text = "تمام تأییدیه‌ها و تسویه‌حساب‌های پروندهٔ شما کامل شد. برای ادامه، در سامانهٔ سجاد درخواست «کد صحت مدرک» ثبت کنید و کد رهگیری را در بخش «فارغ‌التحصیلی من» وارد نمایید."
		case "FINAL_DOCS":
			text = "تمام تأییدیه‌های سیستمی پروندهٔ شما سبز شد. لطفاً مدارک پایانی (عکس و تمبر) را تکمیل کنید."
		case "READY_TO_ISSUE":
			text = "پروندهٔ فارغ‌التحصیلی شما کامل شد و در نوبت صدور گواهینامهٔ موقت است."
		}
		if text != "" {
			payload, _ := json.Marshal(map[string]string{"text": text})
			_, _ = s.Pool.Exec(ctx, `
				insert into notifications ("userId","eventCode",payload) values ($1,$2,$3)`,
				userID, "GRADUATION_"+next, string(payload))
			messaging.NotifyExternalDefault(ctx, userID, "GRADUATION_"+next, text)
		}
	}
	return nil
}

type department struct {
	Code, Title, AutoCheck string
}

func (s *Service) startClearance(ctx context.Context, auditID, studentID int64) error {
	deps, err := s.ensureDepartments(ctx)
	if err != nil {
		return err
	}
	for _, d := range deps {
		_, _ = s.Pool.Exec(ctx, `
			insert into clearance_checklist ("studentId","auditId",department,status)
			values ($1,$2,$3,'PENDING')`, studentID, auditID, d.Code)
	}
	_, _ = s.Pool.Exec(ctx, `update graduation_audits set "workflowStatus"='CLEARANCE', "lastEventAt"=now() where id = $1`, auditID)

	balance := s.ledgerBalanceStudent(ctx, studentID)
	for _, d := range deps {
		if d.AutoCheck != "FINANCE_LEDGER" {
			continue
		}
		status := "HAS_DEBT"
		detail := "مانده بدهی: " + jalali.GroupThousands(balance) + " ریال"
		var resolved any
		if balance <= 0 {
			status = "CLEARED"
			detail = "بدهی مالی صفر است — تأیید خودکار سیستم."
			resolved = time.Now()
		}
		_, _ = s.Pool.Exec(ctx, `
			update clearance_checklist set status = $1, "amountDue" = $2, detail = $3,
			       "autoChecked" = 1, "resolvedAt" = $4
			 where "auditId" = $5 and department = $6`,
			status, maxFloat(balance, 0), detail, resolved, auditID, d.Code)
	}
	return nil
}

func (s *Service) ensureDepartments(ctx context.Context) ([]department, error) {
	rows, err := s.Pool.Query(ctx, `
		select code, title, coalesce("autoCheck",'NONE') from clearance_departments
		 where coalesce("isActive",1) = 1 order by "sortOrder"`)
	if err != nil {
		return nil, err
	}
	out := []department{}
	for rows.Next() {
		var d department
		if err := rows.Scan(&d.Code, &d.Title, &d.AutoCheck); err == nil {
			out = append(out, d)
		}
	}
	rows.Close()
	if len(out) > 0 {
		return out, nil
	}
	defaults := []department{
		{"FINANCE", "امور مالی و شهریه", "FINANCE_LEDGER"},
		{"LIBRARY", "کتابخانه مرکزی", "NONE"},
		{"DORMITORY", "خوابگاه", "NONE"},
		{"WELFARE_FUND", "صندوق رفاه دانشجویان", "NONE"},
		{"LAB", "آزمایشگاه و کارگاه", "NONE"},
		{"EDU_OFFICE", "اداره آموزش (پروندهٔ تحصیلی)", "NONE"},
		{"MILITARY", "نظام وظیفه", "NONE"},
	}
	for i, d := range defaults {
		_, _ = s.Pool.Exec(ctx, `
			insert into clearance_departments (code,title,"autoCheck","sortOrder","isActive")
			values ($1,$2,$3,$4,1) on conflict do nothing`, d.Code, d.Title, d.AutoCheck, (i+1)*10)
	}
	return defaults, nil
}

func (s *Service) ledgerBalanceStudent(ctx context.Context, studentID int64) float64 {
	rows, err := s.Pool.Query(ctx, `
		select "transactionType", amount::float8 from student_ledger where "studentId" = $1`, studentID)
	if err != nil {
		return 0
	}
	defer rows.Close()
	list := []finance.LedgerBalanceRow{}
	for rows.Next() {
		var r finance.LedgerBalanceRow
		if err := rows.Scan(&r.TransactionType, &r.Amount); err == nil {
			list = append(list, r)
		}
	}
	balance := finance.LedgerBalance(list)
	if balance < 0 {
		balance = 0
	}
	return balance
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func faDecimal(v float64) string {
	if v == float64(int64(v)) {
		return jalali.GroupThousands(v)
	}
	s := strconv.FormatFloat(v, 'f', 2, 64)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	return jalali.FaDigits(s)
}

// ChannelRow is a user's channel address.
type ChannelRow struct {
	Channel string `json:"channel"`
	Address string `json:"address"`
}

// ChannelsResponse is the notification channels.
type ChannelsResponse struct {
	Active []string     `json:"active"`
	Mine   []ChannelRow `json:"mine"`
}

// GetChannels ports myChannelsAction.
func (s *Service) GetChannels(ctx context.Context, userID int64) *ChannelsResponse {
	active := []string{"INAPP"}
	if s.Settings != nil {
		if raw, err := s.Settings.Get(ctx, "NOTIFY_CHANNELS"); err == nil && strings.TrimSpace(raw) != "" {
			active = []string{}
			for _, c := range strings.Split(raw, ",") {
				c = strings.ToUpper(strings.TrimSpace(c))
				switch c {
				case "INAPP", "SMS", "TELEGRAM", "BALE", "EITAA":
					active = append(active, c)
				}
			}
			if len(active) == 0 {
				active = []string{"INAPP"}
			}
		}
	}
	mine := []ChannelRow{}
	rows, err := s.Pool.Query(ctx, `
		select channel, address from notification_channels where "userId" = $1 order by channel`, userID)
	if err == nil {
		for rows.Next() {
			var c ChannelRow
			if err := rows.Scan(&c.Channel, &c.Address); err == nil {
				mine = append(mine, c)
			}
		}
		rows.Close()
	}
	return &ChannelsResponse{Active: active, Mine: mine}
}

var smsRe = regexp.MustCompile(`^09\d{9}$`)

// SaveChannel ports saveUserChannel.
func (s *Service) SaveChannel(ctx context.Context, userID int64, channel, address string) error {
	channel = strings.ToUpper(strings.TrimSpace(channel))
	switch channel {
	case "SMS", "TELEGRAM", "BALE", "EITAA":
	default:
		return errors.New("کانال نامعتبر است.")
	}
	value := strings.TrimSpace(address)
	if value == "" {
		_, err := s.Pool.Exec(ctx, `delete from notification_channels where "userId" = $1 and channel = $2`, userID, channel)
		return err
	}
	if channel == "SMS" && !smsRe.MatchString(value) {
		return errors.New("شمارهٔ موبایل باید ۱۱ رقم و با ۰۹ آغاز شود.")
	}
	_, err := s.Pool.Exec(ctx, `
		insert into notification_channels ("userId", channel, address, "isActive")
		values ($1,$2,$3,1)
		on conflict ("userId", channel) do update set address = excluded.address, "isActive" = 1`,
		userID, channel, value)
	return err
}
