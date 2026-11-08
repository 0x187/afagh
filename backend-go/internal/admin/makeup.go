// Makeup class requests inbox — port of app/admin/makeup-actions.ts.
// The rows are real class_sessions flagged as makeup (PROPOSED = waiting for
// the education office to assign a hall); approving assigns the room and
// schedules the session, rejecting records the reason for the professor.
package admin

import (
	"context"
	"strings"

	"backend-go/internal/session"
)

// STAFF decision roles for the makeup inbox.
var makeupRoles = map[string]bool{"ADMIN": true, "EDU_EXPERT": true, "VICE_EDU": true}

// MakeupInboxRow is one makeup request card.
type MakeupInboxRow struct {
	ID                int64   `json:"id"`
	CourseTitle       string  `json:"courseTitle"`
	CourseCode        string  `json:"courseCode"`
	GroupNumber       int     `json:"groupNumber"`
	ProfessorName     string  `json:"professorName"`
	StaffCode         *string `json:"staffCode"`
	ReplacedSessionNo *int    `json:"replacedSessionNo"`
	AbsenceReason     *string `json:"absenceReason"`
	SessionDate       *string `json:"sessionDate"`
	SessionTime       string  `json:"sessionTime"`
	Topic             *string `json:"topic"`
	Status            string  `json:"status"`
	RoomName          *string `json:"roomName"`
	RejectionReason   *string `json:"rejectionReason"`
	EnrolledCount     int     `json:"enrolledCount"`
}

// MakeupRoom is a hall available for assignment.
type MakeupRoom struct {
	ID           int64   `json:"id"`
	Name         string  `json:"name"`
	Capacity     int     `json:"capacity"`
	BuildingName *string `json:"buildingName"`
}

// CanDecideMakeup reports whether the user may decide makeup requests.
func CanDecideMakeup(roles []string) bool {
	for _, r := range roles {
		if makeupRoles[r] {
			return true
		}
	}
	return false
}

// GetMakeupInbox returns the pending/decided makeup requests and the rooms.
func (s *Service) GetMakeupInbox(ctx context.Context, user *session.User, uniCookie string) ([]MakeupInboxRow, []MakeupRoom, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	rows := []MakeupInboxRow{}
	q := `
		select cs.id, c.title, c.code, co."groupNumber",
		       coalesce(u."firstName" || ' ' || u."lastName", ''),
		       st."staffCode", cs."replacedSessionId", cs."absenceReason",
		       cs."sessionDate"::text, cs."startTime", cs."endTime", cs.topic,
		       cs.status, cr.name, cs."rejectionReason",
		       coalesce(co."enrolledCount", 0)
		  from class_sessions cs
		  join course_offerings co on co.id = cs."offeringId"
		  join courses c on c.id = co."courseId"
		  left join staff st on st.id = co."professorId"
		  left join users u on u.id = st."userId"
		  left join classrooms cr on cr.id = cs."roomId"
		 where cs."isMakeUpSession" = 1
		   and ($1::int is null or co."universityId" = $1)
		   and cs.status in ('PROPOSED','SCHEDULED','REJECTED')
		 order by cs.id desc
		 limit 60`
	rrows, err := s.DB.Pool.Query(ctx, q, uniID)
	if err != nil {
		return rows, nil, err
	}
	defer rrows.Close()

	replaced := map[int64]int{}
	needReplaced := []int64{}
	raw := []struct {
		r          MakeupInboxRow
		replacedID *int
		start, end *string
	}{}
	for rrows.Next() {
		var r MakeupInboxRow
		var replacedID *int
		var start, end *string
		if err := rrows.Scan(&r.ID, &r.CourseTitle, &r.CourseCode, &r.GroupNumber,
			&r.ProfessorName, &r.StaffCode, &replacedID, &r.AbsenceReason,
			&r.SessionDate, &start, &end, &r.Topic,
			&r.Status, &r.RoomName, &r.RejectionReason, &r.EnrolledCount); err != nil {
			continue
		}
		if start != nil && end != nil {
			r.SessionTime = *start + " الی " + *end
		}
		if replacedID != nil {
			needReplaced = append(needReplaced, int64(*replacedID))
		}
		raw = append(raw, struct {
			r          MakeupInboxRow
			replacedID *int
			start, end *string
		}{r, replacedID, start, end})
	}
	rrows.Close()

	// The REPLACED session number (not the makeup session's own number).
	if len(needReplaced) > 0 {
		rr, err := s.DB.Pool.Query(ctx,
			`select id, coalesce("sessionNo",0) from class_sessions where id = any($1)`, needReplaced)
		if err == nil {
			for rr.Next() {
				var id int64
				var no int
				if err := rr.Scan(&id, &no); err == nil {
					replaced[id] = no
				}
			}
			rr.Close()
		}
	}
	for _, x := range raw {
		if x.replacedID != nil {
			if no, ok := replaced[int64(*x.replacedID)]; ok && no > 0 {
				v := no
				x.r.ReplacedSessionNo = &v
			}
		}
		rows = append(rows, x.r)
	}

	rooms := []MakeupRoom{}
	qr, err := s.DB.Pool.Query(ctx, `
		select id, name, coalesce(capacity,0), "buildingName"
		  from classrooms
		 where ($1::int is null or "universityId" = $1)
		 order by name limit 200`, uniID)
	if err == nil {
		for qr.Next() {
			var r MakeupRoom
			if err := qr.Scan(&r.ID, &r.Name, &r.Capacity, &r.BuildingName); err == nil {
				rooms = append(rooms, r)
			}
		}
		qr.Close()
	}
	return rows, rooms, nil
}

// ApproveMakeupSession assigns the room and schedules the session.
func (s *Service) ApproveMakeupSession(ctx context.Context, user *session.User, uniCookie string, id, roomID int64) (bool, string, error) {
	if id <= 0 || roomID <= 0 {
		return false, "کلاس انتخاب نشده است.", nil
	}
	uniID := s.UniversityID(ctx, user, uniCookie)
	var status string
	err := s.DB.Pool.QueryRow(ctx, `select status from class_sessions where id = $1`, id).Scan(&status)
	if err != nil {
		return false, "درخواست یافت نشد.", nil
	}
	if status != "PROPOSED" {
		return false, "این درخواست قبلاً بررسی شده است.", nil
	}
	ct, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return false, "", err
	}
	defer ct.Rollback(ctx)
	_, err = ct.Exec(ctx,
		`update class_sessions set "roomId" = $2, status = 'SCHEDULED', "rejectionReason" = null where id = $1`,
		id, roomID)
	if err != nil {
		return false, "", err
	}
	if err := ct.Commit(ctx); err != nil {
		return false, "", err
	}
	_ = uniID
	return true, "", nil
}

// RejectMakeupSession records the rejection reason.
func (s *Service) RejectMakeupSession(ctx context.Context, user *session.User, uniCookie string, id int64, reason string) (bool, string, error) {
	r := strings.TrimSpace(reason)
	if id <= 0 {
		return false, "درخواست نامعتبر است.", nil
	}
	if r == "" {
		return false, "دلیل رد را بنویسید.", nil
	}
	if len(r) > 500 {
		r = r[:500]
	}
	var status string
	err := s.DB.Pool.QueryRow(ctx, `select status from class_sessions where id = $1`, id).Scan(&status)
	if err != nil {
		return false, "درخواست یافت نشد.", nil
	}
	if status != "PROPOSED" {
		return false, "این درخواست قبلاً بررسی شده است.", nil
	}
	_, err = s.DB.Pool.Exec(ctx,
		`update class_sessions set status = 'REJECTED', "rejectionReason" = $2 where id = $1`, id, r)
	if err != nil {
		return false, "", err
	}
	return true, "", nil
}
