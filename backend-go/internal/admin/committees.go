// ═══ کمیته انضباطی + شورای آموزشی — پورت api/admin/discipline و council ═══
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"backend-go/internal/fa"
	"backend-go/internal/session"
)

// ─────────────────── کمیتهٔ انضباطی ───────────────────

var disciplineStatuses = map[string]bool{
	"در حال بررسی": true, "در کمیته": true, "تصمیم‌گیری‌شده": true, "تجدیدنظر": true,
}

var disciplineDecisions = map[string]bool{
	"تذکر شفاهی": true, "تذکر کتبی": true, "اخطار": true, "تعلیق موقت": true, "اخراج": true, "تبرئه": true,
}

const disciplinePageSize = 50

// DisciplineCase ردیف پروندهٔ انضباطی.
type DisciplineCase struct {
	ID                int64   `json:"id"`
	StudentID         int64   `json:"studentId"`
	StudentCode       string  `json:"studentCode"`
	StudentName       string  `json:"studentName"`
	ViolationType     string  `json:"violationType"`
	Description       *string `json:"description"`
	ReporterName      *string `json:"reporterName"`
	Status            string  `json:"status"`
	CommitteeDecision *string `json:"committeeDecision"`
	DecisionNotes     *string `json:"decisionNotes"`
	CaseDate          *string `json:"caseDate"`
	DecidedAt         *string `json:"decidedAt"`
	CreatedAt         *string `json:"createdAt"`
	DocumentCount     int     `json:"documentCount"`
}

// DisciplineListResponse پاسخ فهرست.
type DisciplineListResponse struct {
	Rows     []DisciplineCase `json:"rows"`
	Total    int              `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
}

// ListDisciplineCases پورت GET /api/admin/discipline.
func (s *Service) ListDisciplineCases(ctx context.Context, user *session.User, uniCookie, status, q, dateFrom, dateTo string, studentID int64, page int) (*DisciplineListResponse, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال معتبر نیست.")
	}
	if status != "" && !disciplineStatuses[status] {
		return nil, errors.New("وضعیت نامعتبر است.")
	}
	if dateFrom != "" {
		if _, err := time.Parse("2006-01-02", dateFrom); err != nil {
			return nil, errors.New("تاریخ شروع نامعتبر است.")
		}
	}
	if dateTo != "" {
		if _, err := time.Parse("2006-01-02", dateTo); err != nil {
			return nil, errors.New("تاریخ پایان نامعتبر است.")
		}
	}
	if page < 1 {
		page = 1
	}
	if page > 1_000_000 {
		page = 1_000_000
	}
	args := []any{*uniID}
	where := ` where c."universityId" = $1`
	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(` and c.status = $%d`, len(args))
	}
	if studentID > 0 {
		args = append(args, studentID)
		where += fmt.Sprintf(` and c."studentId" = $%d`, len(args))
	}
	if dateFrom != "" {
		args = append(args, dateFrom)
		where += fmt.Sprintf(` and c."caseDate" >= $%d::date`, len(args))
	}
	if dateTo != "" {
		args = append(args, dateTo)
		where += fmt.Sprintf(` and c."caseDate" <= $%d::date`, len(args))
	}
	if q = strings.TrimSpace(q); q != "" {
		like := "%" + fa.EscapeLikeChars(fa.ToEnDigits(q)) + "%"
		args = append(args, like)
		where += fmt.Sprintf(` and (st."studentCode" like $%d escape '\' or (u."firstName" || ' ' || u."lastName") like $%d escape '\')`, len(args), len(args))
	}
	var total int
	countSQL := `select count(*)::int from discipline_cases c
		join students st on st.id = c."studentId"
		join users u on u.id = st."userId"` + where
	if err := s.DB.Pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	offset := (page - 1) * disciplinePageSize
	args = append(args, disciplinePageSize, offset)
	rows, err := s.DB.Pool.Query(ctx, `
		select c.id, c."studentId", st."studentCode",
		       coalesce(u."firstName" || ' ' || u."lastName",''),
		       c."violationType", c.description, c."reporterName", c.status,
		       c."committeeDecision", c."decisionNotes", c."caseDate"::text, c."decidedAt"::text, c."createdAt"::text,
		       (select count(*)::int from discipline_case_documents d where d."caseId" = c.id)
		  from discipline_cases c
		  join students st on st.id = c."studentId"
		  join users u on u.id = st."userId"`+where+`
		 order by c."caseDate" desc nulls last, c.id desc
		 limit $`+fmt.Sprintf("%d", len(args)-1)+` offset $`+fmt.Sprintf("%d", len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &DisciplineListResponse{Rows: []DisciplineCase{}, Total: total, Page: page, PageSize: disciplinePageSize}
	for rows.Next() {
		var c DisciplineCase
		if err := rows.Scan(&c.ID, &c.StudentID, &c.StudentCode, &c.StudentName,
			&c.ViolationType, &c.Description, &c.ReporterName, &c.Status,
			&c.CommitteeDecision, &c.DecisionNotes, &c.CaseDate, &c.DecidedAt, &c.CreatedAt, &c.DocumentCount); err == nil {
			c.StudentName = strings.TrimSpace(c.StudentName)
			out.Rows = append(out.Rows, c)
		}
	}
	return out, nil
}

// DisciplineStudentHit نتیجهٔ جست‌وجوی دانشجو.
type DisciplineStudentHit struct {
	StudentID   int64  `json:"studentId"`
	StudentCode string `json:"studentCode"`
	Name        string `json:"name"`
	EntryYear   *int   `json:"entryYear"`
}

// SearchDisciplineStudents پورت action=students (q>=2).
func (s *Service) SearchDisciplineStudents(ctx context.Context, user *session.User, uniCookie, q string) ([]DisciplineStudentHit, error) {
	out := []DisciplineStudentHit{}
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال معتبر نیست.")
	}
	q = strings.TrimSpace(fa.ToEnDigits(q))
	if len(q) < 2 {
		return out, nil
	}
	like := "%" + fa.EscapeLikeChars(q) + "%"
	rows, err := s.DB.Pool.Query(ctx, `
		select st.id, st."studentCode", coalesce(u."firstName" || ' ' || u."lastName",''), st."entryYear"
		  from students st join users u on u.id = st."userId"
		 where st."universityId" = $1
		   and (st."studentCode" = $2 or (u."firstName" || ' ' || u."lastName") like $3 escape '\')
		 order by st."studentCode" limit 20`, *uniID, q, like)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var h DisciplineStudentHit
		if err := rows.Scan(&h.StudentID, &h.StudentCode, &h.Name, &h.EntryYear); err == nil {
			h.Name = strings.TrimSpace(h.Name)
			out = append(out, h)
		}
	}
	return out, nil
}

// CreateDisciplineInput ورودی ایجاد پرونده.
type CreateDisciplineInput struct {
	StudentID     int64  `json:"studentId"`
	ViolationType string `json:"violationType"`
	Description   string `json:"description"`
	ReporterName  string `json:"reporterName"`
	CaseDate      string `json:"caseDate"`
}

// CreateDisciplineCase پورت POST /api/admin/discipline.
func (s *Service) CreateDisciplineCase(ctx context.Context, user *session.User, uniCookie string, in CreateDisciplineInput) (int64, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال معتبر نیست.")
	}
	if in.StudentID <= 0 {
		return 0, errors.New("داده ورودی معتبر نیست.")
	}
	violation := strings.TrimSpace(in.ViolationType)
	if violation == "" || len([]rune(violation)) > 150 {
		return 0, errors.New("داده ورودی معتبر نیست.")
	}
	if len([]rune(in.Description)) > 4000 || len([]rune(in.ReporterName)) > 150 {
		return 0, errors.New("داده ورودی معتبر نیست.")
	}
	var caseDate any
	if d := strings.TrimSpace(in.CaseDate); d != "" {
		if _, err := time.Parse("2006-01-02", d); err != nil {
			return 0, errors.New("داده ورودی معتبر نیست.")
		}
		caseDate = d
	} else {
		caseDate = time.Now().Format("2006-01-02")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var stuExists bool
	_ = tx.QueryRow(ctx, `select exists(select 1 from students where id = $1 and "universityId" = $2)`, in.StudentID, *uniID).Scan(&stuExists)
	if !stuExists {
		return 0, errors.New("دانشجو یافت نشد.")
	}
	var id int64
	if err := tx.QueryRow(ctx, `
		insert into discipline_cases ("studentId","violationType",description,"reporterName",status,"caseDate","universityId")
		values ($1,$2,$3,$4,'در حال بررسی',$5,$6) returning id`,
		in.StudentID, violation, cleanStr(in.Description), cleanStr(in.ReporterName), caseDate, *uniID).Scan(&id); err != nil {
		return 0, errors.New("خطا در ذخیرهٔ پرونده.")
	}
	details, _ := json.Marshal(map[string]any{"studentId": in.StudentID, "violationType": violation})
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "DISCIPLINE_CASE_CREATED", "discipline_cases", id, string(details)); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return id, nil
}

// UpdateDisciplineInput ورودی تغییر وضعیت/تصمیم.
type UpdateDisciplineInput struct {
	Status            *string `json:"status"`
	CommitteeDecision *string `json:"committeeDecision"`
	DecisionNotes     *string `json:"decisionNotes"`
}

// UpdateDisciplineCase پورت PATCH /api/admin/discipline.
func (s *Service) UpdateDisciplineCase(ctx context.Context, user *session.User, uniCookie string, id int64, in UpdateDisciplineInput) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال معتبر نیست.")
	}
	if id <= 0 {
		return errors.New("شناسه پرونده نامعتبر است.")
	}
	if in.Status != nil && strings.TrimSpace(*in.Status) != "" && !disciplineStatuses[strings.TrimSpace(*in.Status)] {
		return errors.New("وضعیت نامعتبر است.")
	}
	if in.CommitteeDecision != nil && strings.TrimSpace(*in.CommitteeDecision) != "" && !disciplineDecisions[strings.TrimSpace(*in.CommitteeDecision)] {
		return errors.New("تصمیم نامعتبر است.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var studentID int64
	var curStatus string
	var curDecision *string
	err = tx.QueryRow(ctx, `
		select "studentId", status, "committeeDecision" from discipline_cases
		 where id = $1 and "universityId" = $2 for update`, id, *uniID).Scan(&studentID, &curStatus, &curDecision)
	if err != nil {
		return errors.New("پرونده یافت نشد.")
	}
	setStatus := curStatus
	if in.Status != nil && strings.TrimSpace(*in.Status) != "" {
		setStatus = strings.TrimSpace(*in.Status)
	}
	decDone := false
	if in.CommitteeDecision != nil {
		decDone = strings.TrimSpace(*in.CommitteeDecision) != ""
	}
	if _, err := tx.Exec(ctx, `
		update discipline_cases set status = $2,
		  "committeeDecision" = case when $3::boolean then $4 else "committeeDecision" end,
		  "decisionNotes" = case when $5::boolean then $6 else "decisionNotes" end,
		  "decidedAt" = case when $3::boolean then now() else "decidedAt" end,
		  "updatedAt" = now()
		 where id = $1 and "universityId" = $7`,
		id, setStatus, decDone, nullableTrim(in.CommitteeDecision),
		in.DecisionNotes != nil, nullableTrim(in.DecisionNotes), *uniID); err != nil {
		return errors.New("خطا در به‌روزرسانی پرونده.")
	}
	details, _ := json.Marshal(map[string]any{
		"from": map[string]any{"status": curStatus, "decision": curDecision},
		"to":   map[string]any{"status": setStatus, "decision": nullableTrim(in.CommitteeDecision)},
	})
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "DISCIPLINE_CASE_UPDATED", "discipline_cases", id, string(details)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func nullableTrim(v *string) *string {
	if v == nil {
		return nil
	}
	t := strings.TrimSpace(*v)
	if t == "" {
		return nil
	}
	return &t
}

// DeleteDisciplineCase پورت DELETE (فقط ADMIN).
func (s *Service) DeleteDisciplineCase(ctx context.Context, user *session.User, uniCookie string, id int64) error {
	isAdmin := false
	for _, r := range user.Roles {
		if r == "ADMIN" {
			isAdmin = true
		}
	}
	if !isAdmin {
		return errors.New("دسترسی غیرمجاز")
	}
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال معتبر نیست.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var studentID int64
	var violation string
	err = tx.QueryRow(ctx, `
		select "studentId", "violationType" from discipline_cases
		 where id = $1 and "universityId" = $2 for update`, id, *uniID).Scan(&studentID, &violation)
	if err != nil {
		return errors.New("پرونده یافت نشد.")
	}
	if _, err := tx.Exec(ctx, `delete from discipline_cases where id = $1 and "universityId" = $2`, id, *uniID); err != nil {
		return errors.New("خطا در حذف پرونده.")
	}
	details, _ := json.Marshal(map[string]any{"id": id, "studentId": studentID, "violationType": violation})
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "DISCIPLINE_CASE_DELETED", "discipline_cases", id, string(details)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─────────────────── شورای آموزشی ───────────────────

var councilDecisionTypes = map[string]bool{"مصوبه": true, "توصیه": true, "درخواست تجدیدنظر": true}
var councilImplementationStatuses = map[string]bool{"در انتظار اجرا": true, "در حال اجرا": true, "اجراشده": true}

const councilPageSize = 50

// CouncilMeeting جلسه.
type CouncilMeeting struct {
	ID             int64   `json:"id"`
	Title          string  `json:"title"`
	MeetingDate    *string `json:"meetingDate"`
	Members        *string `json:"members"`
	Agenda         *string `json:"agenda"`
	Minutes        *string `json:"minutes"`
	UniversityID   *int64  `json:"universityId"`
	CreatedBy      *int64  `json:"createdBy"`
	DecisionsCount int     `json:"decisionsCount"`
	CreatedAt      *string `json:"createdAt"`
	UpdatedAt      *string `json:"updatedAt"`
}

// CouncilDecision مصوبه.
type CouncilDecision struct {
	ID                   int64   `json:"id"`
	MeetingID            int64   `json:"meetingId"`
	MeetingTitle         *string `json:"meetingTitle"`
	MeetingDate          *string `json:"meetingDate"`
	StudentID            *int64  `json:"studentId"`
	StudentName          *string `json:"studentName"`
	StudentCode          *string `json:"studentCode"`
	DecisionType         string  `json:"decisionType"`
	Content              string  `json:"content"`
	ImplementationStatus string  `json:"implementationStatus"`
	Deadline             *string `json:"deadline"`
	CreatedAt            *string `json:"createdAt"`
	UpdatedAt            *string `json:"updatedAt"`
}

// ListCouncilMeetings پورت GET /api/admin/council.
func (s *Service) ListCouncilMeetings(ctx context.Context, user *session.User, uniCookie, q, dateFrom, dateTo string, page int) ([]CouncilMeeting, int, int, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return nil, 0, 0, errors.New("دانشگاه فعال معتبر نیست.")
	}
	if page < 1 {
		page = 1
	}
	args := []any{*uniID}
	where := ` where m."universityId" = $1`
	if dateFrom != "" {
		if _, err := time.Parse("2006-01-02", dateFrom); err != nil {
			return nil, 0, 0, errors.New("تاریخ نامعتبر است.")
		}
		args = append(args, dateFrom)
		where += fmt.Sprintf(` and m."meetingDate" >= $%d::date`, len(args))
	}
	if dateTo != "" {
		if _, err := time.Parse("2006-01-02", dateTo); err != nil {
			return nil, 0, 0, errors.New("تاریخ نامعتبر است.")
		}
		args = append(args, dateTo)
		where += fmt.Sprintf(` and m."meetingDate" <= $%d::date`, len(args))
	}
	if q = strings.TrimSpace(q); q != "" {
		like := "%" + fa.EscapeLikeChars(q) + "%"
		args = append(args, like)
		where += fmt.Sprintf(` and (m.title ilike $%d escape '\' or m.agenda ilike $%d escape '\')`, len(args), len(args))
	}
	var total int
	if err := s.DB.Pool.QueryRow(ctx, `select count(*)::int from council_meetings m`+where, args...).Scan(&total); err != nil {
		return nil, 0, 0, err
	}
	args = append(args, councilPageSize, (page-1)*councilPageSize)
	rows, err := s.DB.Pool.Query(ctx, `
		select m.id, m.title, m."meetingDate"::text, m.members, m.agenda, m.minutes,
		       m."universityId", m."createdBy", (select count(*)::int from council_decisions d where d."meetingId" = m.id),
		       m."createdAt"::text, m."updatedAt"::text
		  from council_meetings m`+where+`
		 order by m."meetingDate" desc nulls last, m.id desc
		 limit $`+fmt.Sprintf("%d", len(args)-1)+` offset $`+fmt.Sprintf("%d", len(args)), args...)
	if err != nil {
		return nil, 0, 0, err
	}
	defer rows.Close()
	out := []CouncilMeeting{}
	for rows.Next() {
		var m CouncilMeeting
		if err := rows.Scan(&m.ID, &m.Title, &m.MeetingDate, &m.Members, &m.Agenda, &m.Minutes,
			&m.UniversityID, &m.CreatedBy, &m.DecisionsCount, &m.CreatedAt, &m.UpdatedAt); err == nil {
			out = append(out, m)
		}
	}
	return out, total, page, nil
}

// MeetingInput ورودی ذخیرهٔ جلسه.
type MeetingInput struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	MeetingDate string `json:"meetingDate"`
	Members     string `json:"members"`
	Agenda      string `json:"agenda"`
	Minutes     string `json:"minutes"`
	Deleted     bool   `json:"deleted"`
}

// SaveCouncilMeeting ایجاد/ویرایش جلسه.
func (s *Service) SaveCouncilMeeting(ctx context.Context, user *session.User, uniCookie string, in MeetingInput) (int64, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال معتبر نیست.")
	}
	title := strings.TrimSpace(in.Title)
	if title == "" || len([]rune(title)) > 250 {
		return 0, errors.New("داده ورودی معتبر نیست.")
	}
	var meetingDate any
	if d := strings.TrimSpace(in.MeetingDate); d != "" {
		if _, err := time.Parse("2006-01-02", d); err != nil {
			return 0, errors.New("داده ورودی معتبر نیست.")
		}
		meetingDate = d
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if in.ID > 0 {
		var exists bool
		_ = tx.QueryRow(ctx, `select exists(select 1 from council_meetings where id = $1 and "universityId" = $2)`, in.ID, *uniID).Scan(&exists)
		if !exists {
			return 0, errors.New("جلسه یافت نشد.")
		}
		if _, err := tx.Exec(ctx, `
			update council_meetings set title = $2, "meetingDate" = $3, members = $4, agenda = $5, minutes = $6, "updatedAt" = now()
			 where id = $1`, in.ID, title, meetingDate, cleanStr(in.Members), cleanStr(in.Agenda), cleanStr(in.Minutes)); err != nil {
			return 0, err
		}
		details, _ := json.Marshal(map[string]any{"title": title})
		if err := s.writeAdminAuditTx(ctx, tx, user.ID, "COUNCIL_MEETING_UPDATED", "council_meetings", in.ID, string(details)); err != nil {
			return 0, err
		}
		if err := tx.Commit(ctx); err != nil {
			return 0, err
		}
		return in.ID, nil
	}
	var id int64
	if err := tx.QueryRow(ctx, `
		insert into council_meetings (title, "meetingDate", members, agenda, minutes, "universityId", "createdBy")
		values ($1,$2,$3,$4,$5,$6,$7) returning id`,
		title, meetingDate, cleanStr(in.Members), cleanStr(in.Agenda), cleanStr(in.Minutes), *uniID, user.ID).Scan(&id); err != nil {
		return 0, err
	}
	details, _ := json.Marshal(map[string]any{"title": title})
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "COUNCIL_MEETING_CREATED", "council_meetings", id, string(details)); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return id, nil
}

// DeleteCouncilMeeting حذف جلسه (cascade مصوبات).
func (s *Service) DeleteCouncilMeeting(ctx context.Context, user *session.User, uniCookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال معتبر نیست.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var title string
	err = tx.QueryRow(ctx, `select title from council_meetings where id = $1 and "universityId" = $2 for update`, id, *uniID).Scan(&title)
	if err != nil {
		return errors.New("جلسه یافت نشد.")
	}
	if _, err := tx.Exec(ctx, `delete from council_meetings where id = $1`, id); err != nil {
		return err
	}
	details, _ := json.Marshal(map[string]any{"title": title})
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "COUNCIL_MEETING_DELETED", "council_meetings", id, string(details)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ListCouncilDecisions پورت GET /api/admin/council/decisions.
func (s *Service) ListCouncilDecisions(ctx context.Context, user *session.User, uniCookie, status, typ string, meetingID, studentID int64, page int) ([]CouncilDecision, int, int, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return nil, 0, 0, errors.New("دانشگاه فعال معتبر نیست.")
	}
	if status != "" && !councilImplementationStatuses[status] {
		return nil, 0, 0, errors.New("وضعیت اجرا نامعتبر است.")
	}
	if typ != "" && !councilDecisionTypes[typ] {
		return nil, 0, 0, errors.New("نوع مصوبه نامعتبر است.")
	}
	if page < 1 {
		page = 1
	}
	args := []any{*uniID}
	where := ` where d."universityId" = $1`
	if meetingID > 0 {
		args = append(args, meetingID)
		where += fmt.Sprintf(` and d."meetingId" = $%d`, len(args))
	}
	if studentID > 0 {
		args = append(args, studentID)
		where += fmt.Sprintf(` and d."studentId" = $%d`, len(args))
	}
	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(` and d."implementationStatus" = $%d`, len(args))
	}
	if typ != "" {
		args = append(args, typ)
		where += fmt.Sprintf(` and d."decisionType" = $%d`, len(args))
	}
	var total int
	if err := s.DB.Pool.QueryRow(ctx, `select count(*)::int from council_decisions d`+where, args...).Scan(&total); err != nil {
		return nil, 0, 0, err
	}
	args = append(args, councilPageSize, (page-1)*councilPageSize)
	rows, err := s.DB.Pool.Query(ctx, `
		select d.id, d."meetingId", m.title, m."meetingDate"::text,
		       d."studentId", st."studentCode",
		       case when st.id is null then null else coalesce(u."firstName" || ' ' || u."lastName",'') end,
		       d."decisionType", d.content, d."implementationStatus", d.deadline::text,
		       d."createdAt"::text, d."updatedAt"::text
		  from council_decisions d
		  join council_meetings m on m.id = d."meetingId"
		  left join students st on st.id = d."studentId"
		  left join users u on u.id = st."userId"`+where+`
		 order by d.id desc
		 limit $`+fmt.Sprintf("%d", len(args)-1)+` offset $`+fmt.Sprintf("%d", len(args)), args...)
	if err != nil {
		return nil, 0, 0, err
	}
	defer rows.Close()
	out := []CouncilDecision{}
	for rows.Next() {
		var d CouncilDecision
		if err := rows.Scan(&d.ID, &d.MeetingID, &d.MeetingTitle, &d.MeetingDate,
			&d.StudentID, &d.StudentCode, &d.StudentName,
			&d.DecisionType, &d.Content, &d.ImplementationStatus, &d.Deadline,
			&d.CreatedAt, &d.UpdatedAt); err == nil {
			if d.StudentName != nil {
				t := strings.TrimSpace(*d.StudentName)
				d.StudentName = &t
			}
			out = append(out, d)
		}
	}
	return out, total, page, nil
}

// DecisionInput ورودی ذخیرهٔ مصوبه.
type DecisionInput struct {
	ID                   int64  `json:"id"`
	MeetingID            int64  `json:"meetingId"`
	StudentID            *int64 `json:"studentId"`
	DecisionType         string `json:"decisionType"`
	Content              string `json:"content"`
	ImplementationStatus string `json:"implementationStatus"`
	Deadline             string `json:"deadline"`
}

// SaveCouncilDecision ایجاد/ویرایش مصوبه.
func (s *Service) SaveCouncilDecision(ctx context.Context, user *session.User, uniCookie string, in DecisionInput) (int64, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال معتبر نیست.")
	}
	if strings.TrimSpace(in.Content) == "" || len([]rune(in.Content)) > 8000 {
		return 0, errors.New("داده ورودی معتبر نیست.")
	}
	if !councilDecisionTypes[strings.TrimSpace(in.DecisionType)] {
		return 0, errors.New("نوع مصوبه نامعتبر است.")
	}
	if !councilImplementationStatuses[strings.TrimSpace(in.ImplementationStatus)] {
		return 0, errors.New("وضعیت اجرا نامعتبر است.")
	}
	var deadline any
	if d := strings.TrimSpace(in.Deadline); d != "" {
		if _, err := time.Parse("2006-01-02", d); err != nil {
			return 0, errors.New("داده ورودی معتبر نیست.")
		}
		deadline = d
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if in.ID > 0 {
		tag, err := tx.Exec(ctx, `
			update council_decisions set "meetingId" = $2, "studentId" = $3, "decisionType" = $4,
			  content = $5, "implementationStatus" = $6, deadline = $7, "updatedAt" = now()
			 where id = $1 and "universityId" = $8`,
			in.ID, in.MeetingID, in.StudentID, strings.TrimSpace(in.DecisionType), strings.TrimSpace(in.Content),
			strings.TrimSpace(in.ImplementationStatus), deadline, *uniID)
		if err != nil || tag.RowsAffected() == 0 {
			return 0, errors.New("مصوبه یافت نشد.")
		}
		details, _ := json.Marshal(map[string]any{"meetingId": in.MeetingID})
		if err := s.writeAdminAuditTx(ctx, tx, user.ID, "COUNCIL_DECISION_UPDATED", "council_decisions", in.ID, string(details)); err != nil {
			return 0, err
		}
		if err := tx.Commit(ctx); err != nil {
			return 0, err
		}
		return in.ID, nil
	}
	var meetingExists bool
	_ = tx.QueryRow(ctx, `select exists(select 1 from council_meetings where id = $1 and "universityId" = $2)`, in.MeetingID, *uniID).Scan(&meetingExists)
	if !meetingExists {
		return 0, errors.New("جلسه یافت نشد.")
	}
	var id int64
	if err := tx.QueryRow(ctx, `
		insert into council_decisions ("meetingId","studentId","decisionType",content,"implementationStatus",deadline,"universityId")
		values ($1,$2,$3,$4,$5,$6,$7) returning id`,
		in.MeetingID, in.StudentID, strings.TrimSpace(in.DecisionType), strings.TrimSpace(in.Content),
		strings.TrimSpace(in.ImplementationStatus), deadline, *uniID).Scan(&id); err != nil {
		return 0, err
	}
	details, _ := json.Marshal(map[string]any{"meetingId": in.MeetingID})
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "COUNCIL_DECISION_CREATED", "council_decisions", id, string(details)); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return id, nil
}

// DeleteCouncilDecision حذف مصوبه.
func (s *Service) DeleteCouncilDecision(ctx context.Context, user *session.User, uniCookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال معتبر نیست.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `delete from council_decisions where id = $1 and "universityId" = $2`, id, *uniID)
	if err != nil || tag.RowsAffected() == 0 {
		return errors.New("مصوبه یافت نشد.")
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "COUNCIL_DECISION_DELETED", "council_decisions", id, `{}`); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
