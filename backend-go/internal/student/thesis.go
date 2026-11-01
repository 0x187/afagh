// ═══ Student thesis and proposal — port of student/thesis-proposal ═══
package student

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"backend-go/internal/safeinput"
)

// ThesisProgressData is the thesis progress.
type ThesisProgressData struct {
	ID                     int64    `json:"id"`
	SupervisorID           *int64   `json:"supervisorId"`
	AdvisorID              *int64   `json:"advisorId"`
	TitleFa                *string  `json:"titleFa"`
	TitleEn                *string  `json:"titleEn"`
	Keywords               *string  `json:"keywords"`
	Abstract               *string  `json:"abstract"`
	IrandocPriorStatus     *string  `json:"irandocPriorStatus"`
	IrandocPriorTracking   *string  `json:"irandocPriorTracking"`
	ProposalFileID         *int64   `json:"proposalFileId"`
	ProposalSubmittedAt    *string  `json:"proposalSubmittedAt"`
	ProposalSimilarity     *float64 `json:"proposalSimilarity"`
	ProposalStatus         *string  `json:"proposalStatus"`
	ProposalApprovedAt     *string  `json:"proposalApprovedAt"`
	IrandocUploadTracking  *string  `json:"irandocUploadTracking"`
	IrandocUploadStatus    *string  `json:"irandocUploadStatus"`
	DefenseRequestedAt     *string  `json:"defenseRequestedAt"`
	DefenseRequestStatus   *string  `json:"defenseRequestStatus"`
	DefenseScheduledAt     *string  `json:"defenseScheduledAt"`
	DefenseConductedAt     *string  `json:"defenseConductedAt"`
	DefenseResult          *string  `json:"defenseResult"`
	DefenseNote            *string  `json:"defenseNote"`
	FinalThesisFileID      *int64   `json:"finalThesisFileId"`
	FinalThesisSubmittedAt *string  `json:"finalThesisSubmittedAt"`
	FinalIrandocStatus     *string  `json:"finalIrandocStatus"`
	NextProgressReportDue  *string  `json:"nextProgressReportDue"`
}

// IRandocLog is a similarity-check log.
type IRandocLog struct {
	ID                   int64    `json:"id"`
	CheckType            string   `json:"checkType"`
	TrackingCode         *string  `json:"trackingCode"`
	SimilarityPercentage *float64 `json:"similarityPercentage"`
	Decision             *string  `json:"decision"`
	CheckedAt            *string  `json:"checkedAt"`
}

// StaffOption is a professor option.
type StaffOption struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Rank string `json:"rank"`
}

// ThesisStudent is the student info.
type ThesisStudent struct {
	Name        string `json:"name"`
	StudentCode string `json:"studentCode"`
}

// ThesisResponse is the thesis page response.
type ThesisResponse struct {
	Open           bool                `json:"open"`
	ThesisDegree   bool                `json:"thesisDegree"`
	InTrack        bool                `json:"inTrack"`
	Student        ThesisStudent       `json:"student"`
	DegreeTitle    *string             `json:"degreeTitle"`
	AuditID        *int64              `json:"auditId"`
	WorkflowStatus *string             `json:"workflowStatus"`
	Progress       *ThesisProgressData `json:"progress"`
	Logs           []IRandocLog        `json:"logs"`
	StaffList      []StaffOption       `json:"staffList"`
	Audit          *AuditResult        `json:"audit"`
}

var maghtaPrefix = regexp.MustCompile(`^[A-Za-z]+-`)

func isThesisDegreeCode(code *string) bool {
	if code == nil {
		return false
	}
	m := strings.ToUpper(maghtaPrefix.ReplaceAllString(strings.TrimSpace(*code), ""))
	return m == "3" || m == "MS" || m == "4" || m == "6" || m == "7" || m == "8" || m == "PHD"
}

// GetThesis ports the thesis-proposal page.
func (s *Service) GetThesis(ctx context.Context, userID int64, userName string) (*ThesisResponse, error) {
	me, err := s.Resolve(ctx, userID)
	if err != nil {
		return nil, err
	}
	if me == nil {
		return nil, errNoStudent
	}
	resp := &ThesisResponse{
		Student: ThesisStudent{Name: userName, StudentCode: me.StudentCode},
		Logs:    []IRandocLog{}, StaffList: []StaffOption{},
	}
	var degreeCode, degreeTitle *string
	if me.DegreeLevelID != nil {
		_ = s.Pool.QueryRow(ctx, `select code, title from degree_level_configs where id = $1`, *me.DegreeLevelID).
			Scan(&degreeCode, &degreeTitle)
	}
	resp.DegreeTitle = degreeTitle
	resp.ThesisDegree = isThesisDegreeCode(degreeCode)

	var auditID int64
	var workflowStatus string
	err = s.Pool.QueryRow(ctx, `select id, "workflowStatus" from graduation_audits where "studentId" = $1 limit 1`, me.ID).
		Scan(&auditID, &workflowStatus)
	hasAudit := err == nil

	var progressID int64
	var progressAuditID *int64
	_ = s.Pool.QueryRow(ctx, `
		select id, "auditId" from thesis_progress where "studentId" = $1 limit 1`, me.ID).
		Scan(&progressID, &progressAuditID)
	hasProgress := progressID != 0

	var proposalRequest int
	_ = s.Pool.QueryRow(ctx, `
		select 1 from student_requests r
		  join process_definitions p on p.id = r."processId"
		 where r."studentId" = $1 and p.code in ('PROPOSAL_TRACKING','THESIS_DEFENSE') limit 1`, me.ID).
		Scan(&proposalRequest)

	if !hasAudit {
		resp.InTrack = resp.ThesisDegree || hasProgress || proposalRequest != 0
		if !resp.InTrack {
			return resp, nil
		}
		audit, err := s.auditStudent(ctx, me.ID)
		if err != nil {
			return nil, err
		}
		resp.Audit = audit
		return resp, nil
	}
	resp.Open = true
	resp.AuditID = &auditID
	resp.WorkflowStatus = &workflowStatus
	resp.InTrack = true

	// Create/get the progress record.
	if progressID == 0 {
		_ = s.Pool.QueryRow(ctx, `
			insert into thesis_progress ("auditId","studentId","proposalStatus","defenseRequestStatus")
			values ($1,$2,'NOT_STARTED','NOT_REQUESTED') returning id`, auditID, me.ID).Scan(&progressID)
	}
	p := &ThesisProgressData{ID: progressID}
	_ = s.Pool.QueryRow(ctx, `
		select "supervisorId", "advisorId", "titleFa", "titleEn", keywords, abstract,
		       "irandocPriorStatus", "irandocPriorTracking",
		       "proposalFileId", "proposalSubmittedAt"::text, "proposalSimilarity",
		       "proposalStatus", "proposalApprovedAt"::text,
		       "irandocUploadTracking", "irandocUploadStatus",
		       "defenseRequestedAt"::text, "defenseRequestStatus", "defenseScheduledAt"::text,
		       "defenseConductedAt"::text, "defenseResult", "defenseNote",
		       "finalThesisFileId", "finalThesisSubmittedAt"::text, "finalIrandocStatus",
		       "nextProgressReportDue"::text
		  from thesis_progress where id = $1`, progressID).
		Scan(&p.SupervisorID, &p.AdvisorID, &p.TitleFa, &p.TitleEn, &p.Keywords, &p.Abstract,
			&p.IrandocPriorStatus, &p.IrandocPriorTracking,
			&p.ProposalFileID, &p.ProposalSubmittedAt, &p.ProposalSimilarity,
			&p.ProposalStatus, &p.ProposalApprovedAt,
			&p.IrandocUploadTracking, &p.IrandocUploadStatus,
			&p.DefenseRequestedAt, &p.DefenseRequestStatus, &p.DefenseScheduledAt,
			&p.DefenseConductedAt, &p.DefenseResult, &p.DefenseNote,
			&p.FinalThesisFileID, &p.FinalThesisSubmittedAt, &p.FinalIrandocStatus,
			&p.NextProgressReportDue)
	resp.Progress = p

	// Irandoc logs.
	lrows, err := s.Pool.Query(ctx, `
		select id, coalesce("checkType",'—'), "trackingCode", "similarityPercentage", decision, "checkedAt"::text
		  from irandoc_logs where "studentId" = $1 order by id desc limit 20`, me.ID)
	if err == nil {
		for lrows.Next() {
			var l IRandocLog
			if err := lrows.Scan(&l.ID, &l.CheckType, &l.TrackingCode, &l.SimilarityPercentage, &l.Decision, &l.CheckedAt); err == nil {
				resp.Logs = append(resp.Logs, l)
			}
		}
		lrows.Close()
	}

	// Professors.
	srows, err := s.Pool.Query(ctx, `
		select st.id, (u."firstName" || ' ' || u."lastName"),
		       coalesce(st."academicRank", st."staffType", '')
		  from staff st join users u on u.id = st."userId"
		 where coalesce(st."isActive",1) = 1
		 order by u."lastName" limit 500`)
	if err == nil {
		for srows.Next() {
			var st StaffOption
			if err := srows.Scan(&st.ID, &st.Name, &st.Rank); err == nil {
				resp.StaffList = append(resp.StaffList, st)
			}
		}
		srows.Close()
	}
	return resp, nil
}

// getOrCreateThesisProgress helper.
func (s *Service) getOrCreateThesisProgress(ctx context.Context, auditID, studentID int64) (int64, error) {
	var id int64
	err := s.Pool.QueryRow(ctx, `select id from thesis_progress where "auditId" = $1 limit 1`, auditID).Scan(&id)
	if err == nil {
		return id, nil
	}
	err = s.Pool.QueryRow(ctx, `
		insert into thesis_progress ("auditId","studentId","proposalStatus","defenseRequestStatus")
		values ($1,$2,'NOT_STARTED','NOT_REQUESTED') returning id`, auditID, studentID).Scan(&id)
	return id, err
}

func (s *Service) ownAudit(ctx context.Context, studentID, auditID int64) error {
	var owner int64
	if err := s.Pool.QueryRow(ctx, `select "studentId" from graduation_audits where id = $1`, auditID).Scan(&owner); err != nil || owner != studentID {
		return errors.New("دسترسی به این پرونده مجاز نیست.")
	}
	return nil
}

// uploadStudentDocument stores the file in the archive + a document row.
func (s *Service) uploadStudentDocument(ctx context.Context, userID, studentID int64, categoryTitle, fileName, mime string, data []byte) (int64, error) {
	if len(data) == 0 || len(data) > MaxUploadBytes {
		return 0, errors.New("حجم فایل باید بیش از صفر و حداکثر ۱۰ مگابایت باشد.")
	}
	check := safeinput.CheckUpload(fileName, mime, data)
	if !check.OK {
		return 0, errors.New(check.Error)
	}
	if s.Archive == nil {
		return 0, errors.New("آرشیو پیکربندی نشده است.")
	}
	var categoryID int64
	if err := s.Pool.QueryRow(ctx, `select id from document_categories where title = $1 limit 1`, categoryTitle).Scan(&categoryID); err != nil {
		_ = s.Pool.QueryRow(ctx, `
			insert into document_categories (title, scope) values ($1,'STUDENT') returning id`, categoryTitle).Scan(&categoryID)
	}
	key := fmt.Sprintf("students/%d/%s-%d.%s", studentID, strings.ReplaceAll(categoryTitle, " ", "-"), time.Now().UnixMilli(), check.Ext)
	if err := s.Archive.Put(ctx, key, check.Mime, data); err != nil {
		return 0, errors.New("ذخیرهٔ فایل ناموفق بود: " + err.Error())
	}
	var docID int64
	if err := s.Pool.QueryRow(ctx, `
		insert into student_documents ("personUserId","categoryId","fileName","fileUrl","mimeType","verificationStatus")
		values ($1,$2,$3,$4,$5,'PENDING') returning id`,
		userID, categoryID, fileName, key, check.Mime).Scan(&docID); err != nil {
		return 0, err
	}
	return docID, nil
}

// SubmitThesisTitle is phase 1: register the supervisor and title.
func (s *Service) SubmitThesisTitle(ctx context.Context, userID, studentID, auditID int64, supervisorID int64, titleFa, titleEn, keywords, abstract string) error {
	if err := s.ownAudit(ctx, studentID, auditID); err != nil {
		return err
	}
	titleFa = strings.TrimSpace(titleFa)
	if len([]rune(titleFa)) < 3 {
		return errors.New("عنوان فارسی پایان‌نامه را کامل وارد کنید.")
	}
	var one int
	if err := s.Pool.QueryRow(ctx, `select 1 from staff where id = $1`, supervisorID).Scan(&one); err != nil {
		return errors.New("استاد راهنمای انتخاب‌شده یافت نشد.")
	}
	pid, err := s.getOrCreateThesisProgress(ctx, auditID, studentID)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `
		update thesis_progress
		   set "supervisorId" = $1, "titleFa" = $2, "titleEn" = $3, keywords = $4, abstract = $5,
		       "irandocPriorStatus" = 'SKIPPED', "irandocPriorCheckedAt" = now(),
		       "proposalStatus" = case when "proposalStatus" is null or "proposalStatus" = 'PRIOR_REJECTED'
		                               then 'NOT_STARTED' else "proposalStatus" end,
		       "updatedAt" = now()
		 where id = $6`,
		supervisorID, titleFa, nilIfEmpty(titleEn), nilIfEmpty(keywords), nilIfEmpty(abstract), pid)
	return err
}

// SubmitThesisProposal is phase 2: upload the proposal.
func (s *Service) SubmitThesisProposal(ctx context.Context, userID, studentID, auditID int64, fileName, mime string, data []byte) error {
	if err := s.ownAudit(ctx, studentID, auditID); err != nil {
		return err
	}
	pid, err := s.getOrCreateThesisProgress(ctx, auditID, studentID)
	if err != nil {
		return err
	}
	var titleFa *string
	var prior *string
	_ = s.Pool.QueryRow(ctx, `select "titleFa", "irandocPriorStatus" from thesis_progress where id = $1`, pid).
		Scan(&titleFa, &prior)
	if titleFa == nil || strings.TrimSpace(*titleFa) == "" {
		return errors.New("ابتدا عنوان و استاد راهنما را ثبت کنید (فاز ۱).")
	}
	if prior != nil && *prior == "REJECTED" {
		return errors.New("پیشینهٔ ایرانداک رد شده؛ ابتدا عنوان را تغییر دهید.")
	}
	docID, err := s.uploadStudentDocument(ctx, userID, studentID, "پروپوزال پایان‌نامه", fileName, mime, data)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `
		update thesis_progress
		   set "proposalFileId" = $1, "proposalSubmittedAt" = now(),
		       "proposalSimilarity" = 0, "proposalStatus" = 'SIMILARITY_PASSED', "updatedAt" = now()
		 where id = $2`, docID, pid)
	return err
}

// RequestThesisDefense is phase 3: request the defense (after expert approval of the proposal).
func (s *Service) RequestThesisDefense(ctx context.Context, studentID, auditID int64) error {
	if err := s.ownAudit(ctx, studentID, auditID); err != nil {
		return err
	}
	pid, err := s.getOrCreateThesisProgress(ctx, auditID, studentID)
	if err != nil {
		return err
	}
	var proposalStatus, irandocStatus *string
	_ = s.Pool.QueryRow(ctx, `select "proposalStatus", "irandocUploadStatus" from thesis_progress where id = $1`, pid).
		Scan(&proposalStatus, &irandocStatus)
	if proposalStatus == nil || *proposalStatus != "APPROVED" {
		return errors.New("پروپوزال هنوز تأیید نشده است؛ پس از تأیید کارشناس آموزش و آپلود در ایرانداک، درخواست دفاع فعال می‌شود.")
	}
	if irandocStatus == nil || *irandocStatus != "UPLOADED" {
		return errors.New("پروپوزال در ایرانداک آپلود نشده است.")
	}
	_, err = s.Pool.Exec(ctx, `
		update thesis_progress
		   set "defenseRequestStatus" = 'SUPERVISOR_REVIEW', "defenseRequestedAt" = now(),
		       "nextProgressReportDue" = now() + interval '3 months', "updatedAt" = now()
		 where id = $1`, pid)
	return err
}

// SubmitFinalThesis uploads the final thesis (after a successful defense).
func (s *Service) SubmitFinalThesis(ctx context.Context, userID, studentID, auditID int64, fileName, mime string, data []byte) error {
	if err := s.ownAudit(ctx, studentID, auditID); err != nil {
		return err
	}
	pid, err := s.getOrCreateThesisProgress(ctx, auditID, studentID)
	if err != nil {
		return err
	}
	var defense *string
	_ = s.Pool.QueryRow(ctx, `select "defenseRequestStatus" from thesis_progress where id = $1`, pid).Scan(&defense)
	if defense == nil || *defense != "PASSED" {
		return errors.New("دفاع هنوز انجام نشده یا تأیید نشده است.")
	}
	docID, err := s.uploadStudentDocument(ctx, userID, studentID, "پایان‌نامهٔ نهایی", fileName, mime, data)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `
		update thesis_progress
		   set "finalThesisFileId" = $1, "finalThesisSubmittedAt" = now(),
		       "finalIrandocStatus" = 'PENDING', "updatedAt" = now()
		 where id = $2`, docID, pid)
	return err
}

func nilIfEmpty(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}
