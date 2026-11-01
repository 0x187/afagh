// ═══ Virtual classes, documents, and lesson plan (phase 3) ═══
package student

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
)

// VirtualSession is a virtual-class session.
type VirtualSession struct {
	CourseID                int64  `json:"courseId"`
	CourseCode              string `json:"courseCode"`
	CourseTitle             string `json:"courseTitle"`
	ProfessorName           string `json:"professorName"`
	MeetingID               string `json:"meetingId"`
	StartTime               string `json:"startTime"`
	EndTime                 string `json:"endTime"`
	IsRunning               bool   `json:"isRunning"`
	ActiveParticipantsCount int    `json:"activeParticipantsCount"`
	RecordingsCount         int    `json:"recordingsCount"`
}

// ListVirtualClasses ports listTermVirtualClasses.
func (s *Service) ListVirtualClasses(ctx context.Context, studentID int64, termID *int64) ([]VirtualSession, error) {
	rows, err := s.Pool.Query(ctx, `
		select c.id, coalesce(c.code,''), coalesce(c.title,''),
		       coalesce((pu."firstName" || ' ' || pu."lastName"),''),
		       vc."bbbMeetingId",
		       coalesce(min(sc."startTime")::text,''),
		       coalesce(max(sc."endTime")::text,''),
		       coalesce(vc."isRunning",0),
		       coalesce(vc."currentAttendanceCount",0),
		       (select count(*)::int from virtual_class_recordings vr where vr."classroomId" = vc.id)
		  from enrollments en
		  join course_offerings o on o.id = en."offeringId"
		  join courses c on c.id = o."courseId"
		  join virtual_classrooms vc on vc."courseOfferingId" = o.id
		  left join staff st on st.id = o."professorId"
		  left join users pu on pu.id = st."userId"
		  left join schedules sc on sc."offeringId" = o.id and sc."scheduleType" = 'CLASS'
		 where en."studentId" = $1
		   and ($2::int is null or o."termId" = $2::int)
		 group by c.id, c.code, c.title, pu."firstName", pu."lastName",
		          vc.id, vc."bbbMeetingId", vc."isRunning", vc."currentAttendanceCount"
		 order by c.code, vc."bbbMeetingId"`, studentID, termID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VirtualSession{}
	for rows.Next() {
		var v VirtualSession
		var running int
		var start, end string
		if err := rows.Scan(&v.CourseID, &v.CourseCode, &v.CourseTitle, &v.ProfessorName,
			&v.MeetingID, &start, &end, &running, &v.ActiveParticipantsCount, &v.RecordingsCount); err != nil {
			return nil, err
		}
		v.StartTime = hhmm(start)
		v.EndTime = hhmm(end)
		v.IsRunning = running != 0
		out = append(out, v)
	}
	return out, rows.Err()
}

func hhmm(v string) string {
	if strings.TrimSpace(v) == "" {
		return "—"
	}
	parts := strings.SplitN(v, ":", 2)
	if len(parts) != 2 || len(parts[0]) > 2 || len(parts[1]) < 2 {
		return "—"
	}
	return strings.Repeat("0", maxInt(0, 2-len(parts[0]))) + parts[0] + ":" + parts[1][:2]
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// JoinVirtualClass ports joinVirtualClassAction + getBigBlueButtonJoinUrl.
// The role is decided server-side: professor of the same offering or fallback roles = MODERATOR.
func (s *Service) JoinVirtualClass(ctx context.Context, userID int64, roles []string, meetingID string) (string, error) {
	meetingID = strings.TrimSpace(meetingID)
	if meetingID == "" {
		return "", errors.New("شناسهٔ جلسه نامعتبر است.")
	}
	if s.Settings == nil {
		return "", errors.New("سرویس کلاس مجازی پیکربندی نشده است.")
	}
	bbbURL, _ := s.Settings.Get(ctx, "BBB_URL")
	secret, _ := s.Settings.Get(ctx, "BBB_SECRET")
	modPW, _ := s.Settings.Get(ctx, "BBB_MODERATOR_PW")
	attPW, _ := s.Settings.Get(ctx, "BBB_ATTENDEE_PW")
	if strings.TrimSpace(bbbURL) == "" || strings.TrimSpace(secret) == "" {
		return "", errors.New("سرویس کلاس مجازی پیکربندی نشده است — پنل مدیر ← پیکربندی سامانه ← کلاس مجازی")
	}

	role := "ATTENDEE"
	// Professor of the same offering or a fallback role?
	var staffID *int64
	_ = s.Pool.QueryRow(ctx, `select id from staff where "userId" = $1 limit 1`, userID).Scan(&staffID)
	if staffID != nil {
		var professorID *int64
		_ = s.Pool.QueryRow(ctx, `
			select o."professorId" from virtual_classrooms vc
			  join course_offerings o on o.id = vc."courseOfferingId"
			 where vc."bbbMeetingId" = $1 limit 1`, meetingID).Scan(&professorID)
		if professorID != nil && *professorID == *staffID {
			role = "MODERATOR"
		} else {
			var one int
			if err := s.Pool.QueryRow(ctx, `
				select 1 from virtual_classrooms vc
				  join offering_professors op on op."offeringId" = vc."courseOfferingId"
				 where vc."bbbMeetingId" = $1 and op."staffId" = $2 limit 1`, meetingID, *staffID).Scan(&one); err == nil {
				role = "MODERATOR"
			}
		}
	}
	support := map[string]bool{"ADMIN": true, "VICE_EDU": true, "EDU_EXPERT": true, "DEP_HEAD": true}
	for _, r := range roles {
		if support[r] {
			role = "MODERATOR"
		}
	}

	var userName string
	_ = s.Pool.QueryRow(ctx, `
		select (u."firstName" || ' ' || u."lastName") from users u where u.id = $1`, userID).Scan(&userName)
	userName = strings.TrimSpace(userName)

	password := attPW
	if role == "MODERATOR" {
		password = modPW
	}
	// Key order is exactly like the current system's URLSearchParams so the checksum stays compatible.
	pairs := [][2]string{
		{"fullName", userName},
		{"meetingID", meetingID},
		{"password", password},
		{"redirect", "true"},
		{"joinViaHtml5", "true"},
	}
	if s.Settings.GetBool(ctx, "BBB_AUTO_RECORD") {
		pairs = append(pairs, [2]string{"record", "true"})
	}
	parts := make([]string, 0, len(pairs))
	for _, p := range pairs {
		parts = append(parts, url.QueryEscape(p[0])+"="+url.QueryEscape(p[1]))
	}
	queryString := strings.Join(parts, "&")
	sum := sha1.Sum([]byte("join" + queryString + secret))
	checksum := hex.EncodeToString(sum[:])
	return strings.TrimRight(bbbURL, "/") + "/join?" + queryString + "&checksum=" + checksum, nil
}

// Document is a student document row.
type Document struct {
	ID         int64   `json:"id"`
	FileName   *string `json:"fileName"`
	Status     string  `json:"status"`
	Reason     *string `json:"reason"`
	UploadedAt *string `json:"uploadedAt"`
	Category   *string `json:"category"`
	Type       *string `json:"type"`
}

// ListDocuments ports the documents page.
func (s *Service) ListDocuments(ctx context.Context, userID int64) ([]Document, error) {
	rows, err := s.Pool.Query(ctx, `
		select d.id, d."fileName", coalesce(d."verificationStatus",'PENDING'),
		       d."rejectionReason", d."uploadedAt"::text,
		       c.title, t.title
		  from student_documents d
		  left join document_categories c on c.id = d."categoryId"
		  left join document_types t on t.id = d."typeId"
		 where d."personUserId" = $1
		 order by d.id desc`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Document{}
	for rows.Next() {
		var d Document
		if err := rows.Scan(&d.ID, &d.FileName, &d.Status, &d.Reason, &d.UploadedAt, &d.Category, &d.Type); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// LessonPlanSession is a lesson-plan session.
type LessonPlanSession struct {
	ID          int64   `json:"id"`
	SessionNo   int     `json:"sessionNo"`
	SessionKind string  `json:"sessionKind"`
	Topic       string  `json:"topic"`
	Details     *string `json:"details"`
}

// LessonPlanWeight is an evaluation weight.
type LessonPlanWeight struct {
	ID      int64   `json:"id"`
	Title   string  `json:"title"`
	Percent float64 `json:"percent"`
}

// LessonPlanView is the lesson-plan response.
type LessonPlanView struct {
	Published   bool                `json:"published"`
	CourseTitle string              `json:"courseTitle"`
	Plan        *LessonPlanInfo     `json:"plan"`
	Sessions    []LessonPlanSession `json:"sessions"`
	Weights     []LessonPlanWeight  `json:"weights"`
}

// LessonPlanInfo is the plan summary.
type LessonPlanInfo struct {
	ID            int64   `json:"id"`
	CourseMode    string  `json:"courseMode"`
	TotalSessions int     `json:"totalSessions"`
	Objectives    string  `json:"objectives"`
	Resources     string  `json:"resources"`
	Status        string  `json:"status"`
	SubmittedAt   *string `json:"submittedAt"`
}

// GetLessonPlan ports getPlanForStudent with the student-enrollment gate.
func (s *Service) GetLessonPlan(ctx context.Context, userID, offeringID int64) (*LessonPlanView, error) {
	me, err := s.Resolve(ctx, userID)
	if err != nil {
		return nil, err
	}
	if me == nil {
		return nil, errNoStudent
	}
	var enrolled int
	if err := s.Pool.QueryRow(ctx, `
		select 1 from enrollments
		 where "studentId" = $1 and "offeringId" = $2 and status <> 'DROPPED' limit 1`,
		me.ID, offeringID).Scan(&enrolled); err != nil {
		return nil, errors.New("این درس در سوابق شما ثبت نشده است.")
	}

	var courseTitle string
	if err := s.Pool.QueryRow(ctx, `
		select c.title from course_offerings o join courses c on c.id = o."courseId"
		 where o.id = $1`, offeringID).Scan(&courseTitle); err != nil {
		return nil, errors.New("ارائهٔ درس یافت نشد.")
	}
	view := &LessonPlanView{Published: false, CourseTitle: courseTitle, Sessions: []LessonPlanSession{}, Weights: []LessonPlanWeight{}}

	var planID int64
	var courseMode, objectives, resources, status string
	var totalSessions int
	var submittedAt *string
	err = s.Pool.QueryRow(ctx, `
		select id, coalesce("courseMode",''), coalesce("totalSessions",0),
		       coalesce(objectives,''), coalesce(resources,''), coalesce(status,''),
		       "submittedAt"::text
		  from lesson_plans where "offeringId" = $1 limit 1`, offeringID).
		Scan(&planID, &courseMode, &totalSessions, &objectives, &resources, &status, &submittedAt)
	if err != nil || status != "SUBMITTED" {
		return view, nil
	}
	view.Published = true
	view.Plan = &LessonPlanInfo{
		ID: planID, CourseMode: courseMode, TotalSessions: totalSessions,
		Objectives: objectives, Resources: resources, Status: status, SubmittedAt: submittedAt,
	}
	srows, err := s.Pool.Query(ctx, `
		select id, "sessionNo", coalesce("sessionKind",'THEORY'), coalesce(topic,''), details
		  from lesson_plan_sessions where "planId" = $1 order by "sessionNo"`, planID)
	if err == nil {
		for srows.Next() {
			var x LessonPlanSession
			if err := srows.Scan(&x.ID, &x.SessionNo, &x.SessionKind, &x.Topic, &x.Details); err == nil {
				view.Sessions = append(view.Sessions, x)
			}
		}
		srows.Close()
	}
	wrows, err := s.Pool.Query(ctx, `
		select id, title, percent from lesson_plan_weights
		 where "planId" = $1 order by "sortOrder", id`, planID)
	if err == nil {
		for wrows.Next() {
			var w LessonPlanWeight
			if err := wrows.Scan(&w.ID, &w.Title, &w.Percent); err == nil {
				view.Weights = append(view.Weights, w)
			}
		}
		wrows.Close()
	}
	sort.SliceStable(view.Weights, func(i, j int) bool { return view.Weights[i].ID < view.Weights[j].ID })
	return view, nil
}

var _ = fmt.Sprintf
