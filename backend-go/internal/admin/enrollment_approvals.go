// ═══ Enrollment approval (language courses) and enrollment confirmation issuance ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"backend-go/internal/fa"
	"backend-go/internal/session"
)

// EnrollApprovalRow approval request row.
type EnrollApprovalRow struct {
	ID          int64      `json:"id"`
	StudentID   int64      `json:"studentId"`
	StudentCode string     `json:"studentCode"`
	StudentName string     `json:"studentName"`
	OfferingID  int64      `json:"offeringId"`
	CourseTitle string     `json:"courseTitle"`
	CourseCode  string     `json:"courseCode"`
	TermTitle   string     `json:"termTitle"`
	GroupNumber *int       `json:"groupNumber"`
	Status      string     `json:"status"`
	Note        *string    `json:"note"`
	RequestedBy *int64     `json:"requestedBy"`
	DecidedBy   *int64     `json:"decidedBy"`
	DecidedAt   *time.Time `json:"decidedAt"`
	CreatedAt   *time.Time `json:"createdAt"`
}

// EnrollApprovalsPage list response.
type EnrollApprovalsPage struct {
	Rows     []EnrollApprovalRow `json:"rows"`
	Total    int                 `json:"total"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"pageSize"`
}

// OfferingHit offering search result.
type OfferingHit struct {
	OfferingID    int64  `json:"offeringId"`
	CourseTitle   string `json:"courseTitle"`
	CourseCode    string `json:"courseCode"`
	TermTitle     string `json:"termTitle"`
	GroupNumber   *int   `json:"groupNumber"`
	Capacity      int    `json:"capacity"`
	EnrolledCount int    `json:"enrolledCount"`
}

// ConfirmTerm semester option for the confirmation.
type ConfirmTerm struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	IsCurrent int    `json:"isCurrent"`
}

// ListEnrollApprovals list requests with filters/pagination.
func (s *Service) ListEnrollApprovals(ctx context.Context, user *session.User, cookie, q, status string, page int) (*EnrollApprovalsPage, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := &EnrollApprovalsPage{Rows: []EnrollApprovalRow{}, Page: 1, PageSize: 50}
	if uniID == nil {
		return out, nil
	}
	if page < 1 {
		page = 1
	}
	args := []any{*uniID}
	conds := []string{`a."universityId" = $1`}
	if status == "PENDING" || status == "APPROVED" || status == "REJECTED" {
		args = append(args, status)
		conds = append(conds, `a.status = $`+strconv.Itoa(len(args)))
	}
	if q = strings.TrimSpace(q); q != "" {
		like := "%" + fa.EscapeLikeChars(fa.ToEnDigits(q)) + "%"
		args = append(args, like)
		p := "$" + strconv.Itoa(len(args))
		conds = append(conds, fmt.Sprintf(`(st."studentCode" ILIKE %s ESCAPE '\' OR c.title ILIKE %s ESCAPE '\' OR (u."firstName" || ' ' || u."lastName") ILIKE %s ESCAPE '\')`, p, p, p))
	}
	where := strings.Join(conds, " and ")
	var total int
	if err := s.DB.Pool.QueryRow(ctx, `
		select count(*)::int from english_enrollment_approvals a
		  join students st on st.id = a."studentId"
		  join course_offerings o on o.id = a."offeringId"
		  join courses c on c.id = o."courseId"
		  join users u on u.id = st."userId"
		 where `+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	totalPages := (total + 49) / 50
	if totalPages < 1 {
		totalPages = 1
	}
	if page > totalPages {
		page = totalPages
	}
	dataArgs := append([]any{}, args...)
	dataArgs = append(dataArgs, 50, (page-1)*50)
	rows, err := s.DB.Pool.Query(ctx, `
		select a.id, a."studentId", coalesce(st."studentCode",''), (u."firstName" || ' ' || u."lastName"),
		       a."offeringId", c.title, c.code, t.title, o."groupNumber", a.status, a.note,
		       a."requestedBy", a."decidedBy", a."decidedAt", a."createdAt"
		  from english_enrollment_approvals a
		  join students st on st.id = a."studentId"
		  join users u on u.id = st."userId"
		  join course_offerings o on o.id = a."offeringId"
		  join courses c on c.id = o."courseId"
		  join academic_terms t on t.id = o."termId"
		 where `+where+`
		 order by a."createdAt" desc limit $`+strconv.Itoa(len(dataArgs)-1)+` offset $`+strconv.Itoa(len(dataArgs)), dataArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r EnrollApprovalRow
		if err := rows.Scan(&r.ID, &r.StudentID, &r.StudentCode, &r.StudentName, &r.OfferingID,
			&r.CourseTitle, &r.CourseCode, &r.TermTitle, &r.GroupNumber, &r.Status, &r.Note,
			&r.RequestedBy, &r.DecidedBy, &r.DecidedAt, &r.CreatedAt); err == nil {
			out.Rows = append(out.Rows, r)
		}
	}
	out.Total = total
	out.Page = page
	return out, nil
}

// SearchApprovalStudents student search (at least 1 character — same as the route behavior).
func (s *Service) SearchApprovalStudents(ctx context.Context, user *session.User, cookie, q string) ([]WarningStudentHit, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := []WarningStudentHit{}
	if uniID == nil || strings.TrimSpace(q) == "" {
		return out, nil
	}
	like := "%" + fa.EscapeLikeChars(fa.ToEnDigits(q)) + "%"
	rows, err := s.DB.Pool.Query(ctx, `
		select st.id, coalesce(st."studentCode",''), (u."firstName" || ' ' || u."lastName"), st."entryYear"
		  from students st join users u on u.id = st."userId"
		 where st."universityId" = $1
		   and (st."studentCode" = $2 or (u."firstName" || ' ' || u."lastName") like $3 escape '\')
		 order by st."studentCode" limit 20`, *uniID, strings.TrimSpace(q), like)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var h WarningStudentHit
		if err := rows.Scan(&h.StudentID, &h.StudentCode, &h.Name, &h.EntryYear); err == nil {
			out = append(out, h)
		}
	}
	return out, nil
}

// SearchApprovalOfferings offering search (default: language/English courses).
func (s *Service) SearchApprovalOfferings(ctx context.Context, user *session.User, cookie, q string) ([]OfferingHit, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := []OfferingHit{}
	if uniID == nil {
		return out, nil
	}
	args := []any{*uniID}
	conds := []string{`coalesce(o."isActive",1) = 1`, `(o."universityId" = $1 or o."universityId" is null)`}
	if q = strings.TrimSpace(q); q != "" {
		like := "%" + fa.EscapeLikeChars(q) + "%"
		args = append(args, like)
		p := "$" + strconv.Itoa(len(args))
		conds = append(conds, fmt.Sprintf(`(c.title ILIKE %s ESCAPE '\' OR c.code ILIKE %s ESCAPE '\')`, p, p))
	} else {
		conds = append(conds, `(c.title like '%انگلیس%' or c.title like '%زبان%' or c.title ilike '%english%')`)
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.title, c.code, t.title, o."groupNumber", coalesce(o.capacity,0), coalesce(o."enrolledCount",0)
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  join academic_terms t on t.id = o."termId"
		 where `+strings.Join(conds, " and ")+`
		 order by t."sortOrder" desc, c.title, o."groupNumber" limit 20`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var h OfferingHit
		if err := rows.Scan(&h.OfferingID, &h.CourseTitle, &h.CourseCode, &h.TermTitle,
			&h.GroupNumber, &h.Capacity, &h.EnrolledCount); err == nil {
			out = append(out, h)
		}
	}
	return out, nil
}

// CreateEnrollApproval record an approval request.
func (s *Service) CreateEnrollApproval(ctx context.Context, user *session.User, cookie string, studentID, offeringID int64, note *string) (int64, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال نامشخص است.")
	}
	var offeringUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from course_offerings where id = $1`, offeringID).Scan(&offeringUni); err != nil {
		return 0, errors.New("ارائهٔ درس یافت نشد.")
	}
	var exists int
	if err := s.DB.Pool.QueryRow(ctx, `select 1 from students where id = $1`, studentID).Scan(&exists); err != nil {
		return 0, errors.New("دانشجو یافت نشد.")
	}
	if err := s.studentInUniversity(ctx, user, cookie, studentID); err != nil {
		return 0, err
	}
	uni := *uniID
	if offeringUni != nil && *offeringUni > 0 {
		uni = *offeringUni
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var id int64
	if err := tx.QueryRow(ctx, `
		insert into english_enrollment_approvals ("studentId","offeringId",status,"requestedBy",note,"universityId")
		values ($1,$2,'PENDING',$3,$4,$5) returning id`,
		studentID, offeringID, user.ID, note, uni).Scan(&id); err != nil {
		return 0, err
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "ENROLL_APPROVAL_CREATED", "english_enrollment_approval", id,
		fmt.Sprintf(`{"studentId":%d,"offeringId":%d}`, studentID, offeringID)); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return id, nil
}

// UpdateEnrollApproval approve/reject/note.
func (s *Service) UpdateEnrollApproval(ctx context.Context, user *session.User, cookie string, id int64, status *string, note *string) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	if status == nil && note == nil {
		return errors.New("empty_patch")
	}
	if status != nil && *status != "PENDING" && *status != "APPROVED" && *status != "REJECTED" {
		return errors.New("وضعیت نامعتبر است.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var before string
	if err := tx.QueryRow(ctx, `
		select status from english_enrollment_approvals where id = $1 and "universityId" = $2 for update`,
		id, *uniID).Scan(&before); err != nil {
		return errors.New("درخواست یافت نشد.")
	}
	sets := []string{}
	args := []any{}
	if status != nil {
		args = append(args, *status)
		sets = append(sets, "status = $"+strconv.Itoa(len(args)))
		args = append(args, user.ID)
		sets = append(sets, `"decidedBy" = $`+strconv.Itoa(len(args)))
		sets = append(sets, `"decidedAt" = now()`)
	}
	if note != nil {
		args = append(args, nilIfBlank(note))
		sets = append(sets, "note = $"+strconv.Itoa(len(args)))
	}
	args = append(args, id)
	if _, err := tx.Exec(ctx, `update english_enrollment_approvals set `+strings.Join(sets, ", ")+` where id = $`+strconv.Itoa(len(args)), args...); err != nil {
		return err
	}
	to := before
	if status != nil {
		to = *status
	}
	details := fmt.Sprintf(`{"from":%s,"to":%s}`, jsonQuote(before), jsonQuote(to))
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "ENROLL_APPROVAL_UPDATED", "english_enrollment_approval", id, details); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeleteEnrollApproval delete a request (ADMIN only — gate at HTTP).
func (s *Service) DeleteEnrollApproval(ctx context.Context, user *session.User, cookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var deleted int64
	if err := tx.QueryRow(ctx, `
		delete from english_enrollment_approvals where id = $1 and "universityId" = $2 returning id`,
		id, *uniID).Scan(&deleted); err != nil {
		return errors.New("درخواست یافت نشد.")
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "ENROLL_APPROVAL_DELETED", "english_enrollment_approval", id,
		fmt.Sprintf(`{"id":%d}`, id)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AdminTermsForUniversity university semesters (max 60).
func (s *Service) AdminTermsForUniversity(ctx context.Context, uniID int64) ([]ConfirmTerm, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select id, title, coalesce("isCurrent",0) from academic_terms
		 where "universityId" = $1 order by id desc limit 60`, uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ConfirmTerm{}
	for rows.Next() {
		var t ConfirmTerm
		if err := rows.Scan(&t.ID, &t.Title, &t.IsCurrent); err == nil {
			out = append(out, t)
		}
	}
	return out, nil
}

// AuditAction generic audit record for HTTP services.
func (s *Service) AuditAction(ctx context.Context, actorUserID int64, action, entityType string, entityID int64, details string) {
	_ = s.writeAdminAudit(ctx, actorUserID, action, entityType, entityID, details)
}

// CheckStudentInUniversity university boundary gate for HTTP services.
func (s *Service) CheckStudentInUniversity(ctx context.Context, user *session.User, cookie string, studentID int64) error {
	return s.studentInUniversity(ctx, user, cookie, studentID)
}
