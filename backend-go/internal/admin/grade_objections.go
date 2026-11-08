// ═══ Grade objections review — admin/grade-objections port ═══
//
// Port of afagh-next/src/app/admin/grade-objections/{page.tsx,GradeObjectionsClient.tsx}.
// The grade_objections table is created by afagh-next/src/db/patches.sql and
// already exists on the databases.
package admin

import (
	"context"
	"errors"
	"strings"

	"backend-go/internal/session"
)

// GradeObjectionStatusFA is the Persian label map of the objection statuses.
var GradeObjectionStatusFA = map[string]string{
	"PENDING":  "در حال بررسی",
	"REVIEWED": "بررسی شد",
	"ACCEPTED": "پذیرفته شد",
	"REJECTED": "رد شد",
}

// GradeObjectionRow is one objection row (GradeObjectionItem port).
type GradeObjectionRow struct {
	ID               int64   `json:"id"`
	StudentName      string  `json:"studentName"`
	StudentCode      *string `json:"studentCode"`
	TermTitle        *string `json:"termTitle"`
	CourseCode       *string `json:"courseCode"`
	CourseTitle      *string `json:"courseTitle"`
	GradeAtObjection *string `json:"gradeAtObjection"`
	GradeStatus      *string `json:"gradeStatus"`
	RequestText      string  `json:"requestText"`
	Status           string  `json:"status"`
	ReviewerNote     *string `json:"reviewerNote"`
	CreatedAt        *string `json:"createdAt"`
}

const gradeObjectionsSelect = `
	select go.id,
	       coalesce(u."firstName" || ' ' || u."lastName", ''),
	       st."studentCode",
	       t.title,
	       go."courseCode", go."courseTitle",
	       go."gradeAtObjection"::text,
	       e."gradeStatus",
	       go."requestText", go.status,
	       go."reviewerNote",
	       go."createdAt"::text
	  from grade_objections go
	  join students st on st.id = go."studentId"
	  join users u on u.id = st."userId"
	  left join academic_terms t on t.id = go."termId"
	  left join enrollments e on e.id = go."enrollmentId"`

func scanGradeObjection(scan func(dest ...any) error) (GradeObjectionRow, error) {
	var r GradeObjectionRow
	err := scan(&r.ID, &r.StudentName, &r.StudentCode, &r.TermTitle,
		&r.CourseCode, &r.CourseTitle, &r.GradeAtObjection, &r.GradeStatus,
		&r.RequestText, &r.Status, &r.ReviewerNote, &r.CreatedAt)
	r.StudentName = strings.TrimSpace(r.StudentName)
	return r, err
}

// ListGradeObjections ports loadRows: pendingOnly=true → the review queue
// (PENDING, up to 100), false → the resolved history (up to 200).
func (s *Service) ListGradeObjections(ctx context.Context, user *session.User, cookie string, pendingOnly bool) ([]GradeObjectionRow, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	statusCond := `go.status <> 'PENDING'`
	limit := 200
	if pendingOnly {
		statusCond = `go.status = 'PENDING'`
		limit = 100
	}
	rows, err := s.DB.Pool.Query(ctx, gradeObjectionsSelect+`
		 where `+statusCond+`
		   and ($1::int is null or go."universityId" = $1::int)
		 order by go."createdAt" desc
		 limit `+itoa(int64(limit)), uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GradeObjectionRow{}
	for rows.Next() {
		r, err := scanGradeObjection(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ReviewGradeObjection ports the page-level reviewAction: ACCEPTED/REJECTED
// with a mandatory note (min 3 chars), the reviewer's staff record and a
// best-effort notification to the student.
func (s *Service) ReviewGradeObjection(ctx context.Context, user *session.User, cookie string, id int64, decision, note string) error {
	decision = strings.ToUpper(strings.TrimSpace(decision))
	if decision != "ACCEPTED" && decision != "REJECTED" {
		return errors.New("تصمیم نامعتبر است.")
	}
	note = strings.TrimSpace(note)
	if len(note) < 3 {
		return errors.New("یادداشت بررسی الزامی است (حداقل ۳ کاراکتر).")
	}
	uniID := s.UniversityID(ctx, user, cookie)

	// The reviewer must have a staff record (same gate as the reference).
	var staffID int64
	if err := s.DB.Pool.QueryRow(ctx, `select id from staff where "userId" = $1 limit 1`, user.ID).
		Scan(&staffID); err != nil {
		return errors.New("پروندهٔ کارمندی یافت نشد.")
	}

	// Load the objection with a fail-closed university check.
	var (
		objStatus    string
		objStudentID int64
		objCourse    *string
	)
	if err := s.DB.Pool.QueryRow(ctx, `
		select status, "studentId", "courseTitle"
		  from grade_objections
		 where id = $1
		   and ($2::int is null or "universityId" = $2::int)
		 limit 1`, id, uniID).
		Scan(&objStatus, &objStudentID, &objCourse); err != nil {
		return errors.New("اعتراض یافت نشد.")
	}
	if objStatus != "PENDING" {
		return errors.New("این اعتراض قبلاً بررسی شده است.")
	}

	if _, err := s.DB.Pool.Exec(ctx, `
		update grade_objections
		   set status = $2, "reviewerId" = $3, "reviewerNote" = $4,
		       "resolvedAt" = now(), "updatedAt" = now()
		 where id = $1 and status = 'PENDING'`, id, decision, staffID, note); err != nil {
		return err
	}

	// Best-effort student notification — its failure never affects the review.
	courseTitle := "درس"
	if objCourse != nil && strings.TrimSpace(*objCourse) != "" {
		courseTitle = *objCourse
	}
	var studentUserID int64
	if err := s.DB.Pool.QueryRow(ctx, `select "userId" from students where id = $1`, objStudentID).
		Scan(&studentUserID); err == nil && studentUserID > 0 {
		eventCode := "GRADE_OBJECTION_REJECTED"
		text := "اعتراض شما به نمرهٔ " + courseTitle + " بررسی و رد شد. یادداشت کارشناس: " + note
		if decision == "ACCEPTED" {
			eventCode = "GRADE_OBJECTION_ACCEPTED"
			text = "اعتراض شما به نمرهٔ " + courseTitle + " بررسی و پذیرفته شد."
		}
		s.lpBypassNotifyUser(ctx, studentUserID, eventCode, text)
	}
	return nil
}
