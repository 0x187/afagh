// ═══ Admin Manual/Control Attendance — port of admin/attendance-manual and attendance-control ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"backend-go/internal/jalali"
	"backend-go/internal/session"
)

// ManualRow is a session row for manual confirmation.
type ManualRow struct {
	SessionID        int64   `json:"sessionId"`
	SessionNo        int     `json:"sessionNo"`
	SessionDate      string  `json:"sessionDate"`
	StartTime        string  `json:"startTime"`
	EndTime          string  `json:"endTime"`
	IsMakeUp         bool    `json:"isMakeUp"`
	IsHoliday        bool    `json:"isHoliday"`
	SessionStatus    string  `json:"sessionStatus"`
	CourseCode       string  `json:"courseCode"`
	CourseTitle      string  `json:"courseTitle"`
	ProfessorName    string  `json:"professorName"`
	Method           *string `json:"method"`
	Status           *string `json:"status"`
	SharedKey        *string `json:"sharedScheduleGroupKey"`
	Merged           bool    `json:"merged"`
	MemberCount      int     `json:"memberCount"`
	MemberSessionIDs []int64 `json:"memberSessionIds"`
}

// ManualAttendanceData is the manual confirmation page response.
type ManualAttendanceData struct {
	Term  AdminTerm   `json:"term"`
	Terms []EvalTerm  `json:"terms"`
	Rows  []ManualRow `json:"rows"`
}

// GetManualAttendance ports attendance-manual (read).
func (s *Service) GetManualAttendance(ctx context.Context, user *session.User, uniCookie string) (*ManualAttendanceData, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	resp := &ManualAttendanceData{Terms: []EvalTerm{}, Rows: []ManualRow{}}
	if uniID == nil {
		return resp, nil
	}
	trows, err := s.DB.Pool.Query(ctx, `
		select id, title, "termCode", coalesce("isCurrent",0) from academic_terms
		 where "universityId" = $1 order by id desc limit 30`, *uniID)
	if err == nil {
		for trows.Next() {
			var t EvalTerm
			if err := trows.Scan(&t.ID, &t.Title, &t.TermCode); err == nil {
				resp.Terms = append(resp.Terms, t)
			}
		}
		trows.Close()
	}
	var termID int64
	var title, code string
	var isCurrent int
	if err := s.DB.Pool.QueryRow(ctx, `
		select id, title, "termCode", coalesce("isCurrent",0) from academic_terms
		 where "isCurrent" = 1 and "universityId" = $1 order by id desc limit 1`, *uniID).
		Scan(&termID, &title, &code, &isCurrent); err != nil {
		return resp, nil
	}
	resp.Term = AdminTerm{ID: &termID, Title: title, Code: code}

	rows, err := s.DB.Pool.Query(ctx, `
		select cs.id, coalesce(cs."sessionNo",0), cs."sessionDate"::text, cs."startTime"::text, cs."endTime"::text,
		       coalesce(cs."isMakeUpSession",0), coalesce(cs."isHoliday",0), coalesce(cs.status,'SCHEDULED'),
		       c.code, c.title,
		       coalesce(u2."firstName" || ' ' || u2."lastName",'—'),
		       pca."verificationMethod", pca.status, o."sharedScheduleGroupKey"
		  from class_sessions cs
		  join course_offerings o on o.id = cs."offeringId"
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = o."professorId"
		  left join users u2 on u2.id = st."userId"
		  left join professor_class_attendance pca
		         on pca."sessionId" = cs.id and pca."staffId" = o."professorId"
		 where o."termId" = $1 and (o."universityId" = $2 or o."universityId" is null)
		 order by cs."sessionDate" desc, cs."startTime" limit 400`, termID, *uniID)
	if err != nil {
		return resp, nil
	}
	defer rows.Close()
	byKey := map[string][]ManualRow{}
	for rows.Next() {
		var r ManualRow
		var makeUp, holiday int
		if err := rows.Scan(&r.SessionID, &r.SessionNo, &r.SessionDate, &r.StartTime, &r.EndTime,
			&makeUp, &holiday, &r.SessionStatus, &r.CourseCode, &r.CourseTitle,
			&r.ProfessorName, &r.Method, &r.Status, &r.SharedKey); err == nil {
			r.IsMakeUp = makeUp != 0
			r.IsHoliday = holiday != 0
			r.StartTime = clock5(r.StartTime)
			r.EndTime = clock5(r.EndTime)
			resp.Rows = append(resp.Rows, r)
		}
	}
	for i := range resp.Rows {
		k := ""
		if resp.Rows[i].SharedKey != nil {
			k = strings.TrimSpace(*resp.Rows[i].SharedKey)
		}
		if k == "" || strings.HasPrefix(k, "SOLO-") {
			resp.Rows[i].MemberSessionIDs = []int64{resp.Rows[i].SessionID}
			continue
		}
		byKey[k] = append(byKey[k], resp.Rows[i])
	}
	// Manual group merge: primary representative + members.
	out := []ManualRow{}
	mergedKeys := map[string]bool{}
	for _, r := range resp.Rows {
		k := ""
		if r.SharedKey != nil {
			k = strings.TrimSpace(*r.SharedKey)
		}
		if k == "" || strings.HasPrefix(k, "SOLO-") || mergedKeys[k] {
			if mergedKeys[k] {
				continue
			}
			out = append(out, r)
			continue
		}
		list := byKey[k]
		if len(list) <= 1 {
			out = append(out, r)
			continue
		}
		mergedKeys[k] = true
		primary := list[0]
		ids := []int64{}
		for _, m := range list {
			ids = append(ids, m.SessionID)
		}
		primary.Merged = true
		primary.MemberCount = len(list)
		primary.MemberSessionIDs = ids
		out = append(out, primary)
	}
	resp.Rows = out
	return resp, nil
}

// decideMembers expands member sessions (manual merge) or just itself.
func (s *Service) decideMembers(ctx context.Context, sessionID int64) ([]int64, string, error) {
	var offeringID int64
	var sharedKey *string
	if err := s.DB.Pool.QueryRow(ctx, `
		select cs."offeringId", o."sharedScheduleGroupKey"
		  from class_sessions cs join course_offerings o on o.id = cs."offeringId"
		 where cs.id = $1`, sessionID).Scan(&offeringID, &sharedKey); err != nil {
		return nil, "", errors.New("جلسه یافت نشد.")
	}
	if sharedKey == nil || strings.TrimSpace(*sharedKey) == "" || strings.HasPrefix(strings.TrimSpace(*sharedKey), "SOLO-") {
		return []int64{sessionID}, "", nil
	}
	key := strings.TrimSpace(*sharedKey)
	var sessionDate, start, end string
	_ = s.DB.Pool.QueryRow(ctx, `select "sessionDate"::text, "startTime"::text, "endTime"::text from class_sessions where id = $1`, sessionID).
		Scan(&sessionDate, &start, &end)
	rows, err := s.DB.Pool.Query(ctx, `
		select cs.id from class_sessions cs
		  join course_offerings o on o.id = cs."offeringId"
		 where o."sharedScheduleGroupKey" = $1 and cs."sessionDate"::text = $2
		   and cs."startTime"::text = $3 and coalesce(cs."isActive",1) = 1`,
		key, sessionDate, start)
	if err != nil {
		return []int64{sessionID}, key, nil
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		ids = []int64{sessionID}
	}
	return ids, key, nil
}

// ConfirmProfessorAttendance manually confirms the professor's attendance for one session (and merged members).
func (s *Service) ConfirmProfessorAttendance(ctx context.Context, user *session.User, sessionID int64) error {
	ids, _, err := s.decideMembers(ctx, sessionID)
	if err != nil {
		return err
	}
	for _, sid := range ids {
		var offeringID int64
		var professorID *int64
		if err := s.DB.Pool.QueryRow(ctx, `
			select cs."offeringId", o."professorId" from class_sessions cs
			  join course_offerings o on o.id = cs."offeringId"
			 where cs.id = $1`, sid).Scan(&offeringID, &professorID); err != nil {
			continue
		}
		if professorID == nil {
			continue
		}
		if _, err := s.DB.Pool.Exec(ctx, `
			delete from professor_class_attendance where "sessionId" = $1 and "staffId" = $2`, sid, *professorID); err != nil {
			return err
		}
		if _, err := s.DB.Pool.Exec(ctx, `
			insert into professor_class_attendance ("sessionId","staffId","verificationMethod",status,"recordedAt",note)
			values ($1,$2,'MANUAL_EDU_EXPERT','VALID',now(),$3)`, sid, *professorID,
			"تأیید دستی توسط کارشناس آموزش"); err != nil {
			return err
		}
	}
	return nil
}

// MarkClassHeld records that the class was held (session status).
func (s *Service) MarkClassHeld(ctx context.Context, user *session.User, sessionID int64, status string) error {
	if status != "HELD" && status != "ABSENT" && status != "SCHEDULED" {
		return errors.New("وضعیت نامعتبر است.")
	}
	ids, _, err := s.decideMembers(ctx, sessionID)
	if err != nil {
		return err
	}
	for _, sid := range ids {
		if _, err := s.DB.Pool.Exec(ctx, `update class_sessions set status = $1 where id = $2`, status, sid); err != nil {
			return err
		}
	}
	return nil
}

// ControlRow is today's session for a hall (control).
type ControlRow struct {
	RoomID       int64   `json:"roomId"`
	RoomName     string  `json:"roomName"`
	BuildingName *string `json:"buildingName"`
	SessionID    int64   `json:"sessionId"`
	StartTime    string  `json:"startTime"`
	EndTime      string  `json:"endTime"`
	CourseTitle  string  `json:"courseTitle"`
	CourseCode   string  `json:"courseCode"`
	GroupNumber  int     `json:"groupNumber"`
	Professor    string  `json:"professorName"`
	Recorded     bool    `json:"recorded"`
	RecordedAt   *string `json:"recordedAt"`
	Merged       bool    `json:"merged"`
	MemberCount  int     `json:"memberCount"`
}

// ControlData is the control inbox response.
type ControlData struct {
	TodayJalali string       `json:"todayJalali"`
	Rows        []ControlRow `json:"rows"`
}

// GetControl ports attendance-control (subset: all rooms of the university).
func (s *Service) GetControl(ctx context.Context, user *session.User, uniCookie string) (*ControlData, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	now := time.Now()
	resp := &ControlData{Rows: []ControlRow{}, TodayJalali: func() string {
		d := jalali.ToJalaliFromTime(now)
		return jalali.FaDigits(fmt.Sprintf("%04d/%02d/%02d", d.Y, d.M, d.D))
	}()}
	if uniID == nil {
		return resp, nil
	}
	today := jalali.ToJalaliFromTime(now)
	todayStr := fmt.Sprintf("%04d/%02d/%02d", today.Y, today.M, today.D)
	rows, err := s.DB.Pool.Query(ctx, `
		select cs.id, cs."roomId", cr.name, cr."buildingName", cs."startTime"::text, cs."endTime"::text,
		       c.title, c.code, coalesce(o."groupNumber",0),
		       coalesce(u2."firstName" || ' ' || u2."lastName",'—'),
		       pca.id, pca."recordedAt"::text, o."sharedScheduleGroupKey"
		  from class_sessions cs
		  join course_offerings o on o.id = cs."offeringId"
		  join courses c on c.id = o."courseId"
		  left join classrooms cr on cr.id = cs."roomId"
		  left join staff st on st.id = o."professorId"
		  left join users u2 on u2.id = st."userId"
		  left join professor_class_attendance pca
		         on pca."sessionId" = cs.id and pca."staffId" = o."professorId"
		 where replace(cs."sessionDate",'/','-') = $1
		   and (o."universityId" = $2 or o."universityId" is null)
		 order by cs."startTime"`, strings.ReplaceAll(todayStr, "/", "-"), *uniID)
	if err != nil {
		return resp, nil
	}
	defer rows.Close()
	for rows.Next() {
		var r ControlRow
		var pcaID *int64
		var recordedAt *string
		var sharedKey *string
		var roomID *int64
		if err := rows.Scan(&r.SessionID, &roomID, &r.RoomName, &r.BuildingName, &r.StartTime, &r.EndTime,
			&r.CourseTitle, &r.CourseCode, &r.GroupNumber, &r.Professor,
			&pcaID, &recordedAt, &sharedKey); err == nil {
			if roomID != nil {
				r.RoomID = *roomID
			}
			r.StartTime = clock5(r.StartTime)
			r.EndTime = clock5(r.EndTime)
			r.Professor = strings.TrimSpace(r.Professor)
			r.Recorded = pcaID != nil
			r.RecordedAt = recordedAt
			if sharedKey != nil && strings.TrimSpace(*sharedKey) != "" && !strings.HasPrefix(strings.TrimSpace(*sharedKey), "SOLO-") {
				r.Merged = true
			}
			// Merged member count (manual).
			if r.Merged {
				var n int
				_ = s.DB.Pool.QueryRow(ctx, `
					select count(*) from course_offerings o2 where o2."sharedScheduleGroupKey" = $1`,
					strings.TrimSpace(*sharedKey)).Scan(&n)
				r.MemberCount = n
			} else {
				r.MemberCount = 1
			}
			resp.Rows = append(resp.Rows, r)
		}
	}
	return resp, nil
}

// RecordClassPresence records «تشکیل کلاس» by the controller on the session and merged members.
func (s *Service) RecordClassPresence(ctx context.Context, user *session.User, sessionID int64) error {
	ids, _, err := s.decideMembers(ctx, sessionID)
	if err != nil {
		return err
	}
	for _, sid := range ids {
		var offeringID int64
		var professorID *int64
		if err := s.DB.Pool.QueryRow(ctx, `
			select cs."offeringId", o."professorId" from class_sessions cs
			  join course_offerings o on o.id = cs."offeringId"
			 where cs.id = $1`, sid).Scan(&offeringID, &professorID); err != nil {
			continue
		}
		if _, err := s.DB.Pool.Exec(ctx, `update class_sessions set status = 'HELD' where id = $1`, sid); err != nil {
			return err
		}
		if professorID == nil {
			continue
		}
		if _, err := s.DB.Pool.Exec(ctx, `
			delete from professor_class_attendance where "sessionId" = $1 and "staffId" = $2`, sid, *professorID); err != nil {
			return err
		}
		if _, err := s.DB.Pool.Exec(ctx, `
			insert into professor_class_attendance ("sessionId","staffId","verificationMethod",status,"recordedAt",note)
			values ($1,$2,'CONTROLLER_ROOM_CHECKIN','VALID',now(),$3)`, sid, *professorID,
			"ثبت تشکیل کلاس توسط کنترل‌کنندهٔ حضور"); err != nil {
			return err
		}
	}
	return nil
}
