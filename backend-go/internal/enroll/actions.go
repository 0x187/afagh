// ═══ Enrollment operations — port of student/enroll/actions.ts ═══
package enroll

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ActionError is a displayable error.
type ActionError struct{ Message string }

func (e *ActionError) Error() string { return e.Message }

func actionErr(msg string) error { return &ActionError{Message: msg} }

// currentTermForStudent is the current term of the same university (fail-closed).
func (s *Service) currentTermForStudent(ctx context.Context, studentID int64) (int64, int64, error) {
	var uni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, studentID).Scan(&uni); err != nil {
		return 0, 0, err
	}
	if uni == nil {
		return 0, 0, actionErr("دانشگاه شما مشخص نیست.")
	}
	var termID int64
	err := s.DB.Pool.QueryRow(ctx, `
		select id from academic_terms where "isCurrent" = 1 and "universityId" = $1
		 order by id desc limit 1`, *uni).Scan(&termID)
	if err != nil {
		return 0, 0, actionErr("ترم جاری فعال نیست")
	}
	return termID, *uni, nil
}

type scopedOffering struct {
	ID                  int64
	CourseID            int64
	TermID              int64
	UniversityID        *int64
	TargetDegreeLevelID *int64
	TargetMajorID       *int64
	EntryYearStart      *int
	EntryYearEnd        *int
	Units               float64
	Title               string
	OfferingType        string
}

// offeringInMyScope checks the offering in the university/term/active.
func (s *Service) offeringInMyScope(ctx context.Context, universityID *int64, termID, offeringID int64) (*scopedOffering, error) {
	if universityID == nil {
		return nil, actionErr("این ارائه برای دانشگاه/نیمسال شما در دسترس نیست")
	}
	var o scopedOffering
	err := s.DB.Pool.QueryRow(ctx, `
		select o.id, o."courseId", o."termId", o."universityId", o."targetDegreeLevelId",
		       o."targetMajorId", o."entryYearStart", o."entryYearEnd", c.units, c.title,
		       coalesce(o."offeringType",'NORMAL')
		  from course_offerings o join courses c on c.id = o."courseId"
		 where o.id = $1 and o."termId" = $2 and o."isActive" = 1 and o."universityId" = $3`,
		offeringID, termID, *universityID).
		Scan(&o.ID, &o.CourseID, &o.TermID, &o.UniversityID, &o.TargetDegreeLevelID,
			&o.TargetMajorID, &o.EntryYearStart, &o.EntryYearEnd, &o.Units, &o.Title, &o.OfferingType)
	if err != nil {
		return nil, actionErr("این ارائه برای دانشگاه/نیمسال شما در دسترس نیست")
	}
	return &o, nil
}

func (s *Service) studentScope(ctx context.Context, studentID int64) (StudentScope, error) {
	var (
		degreeLevelID, majorID *int64
		entryYear              int
	)
	err := s.DB.Pool.QueryRow(ctx, `select "degreeLevelId", "majorId", "entryYear" from students where id = $1`, studentID).
		Scan(&degreeLevelID, &majorID, &entryYear)
	if err != nil {
		return StudentScope{}, err
	}
	return StudentScope{DegreeLevelID: degreeLevelID, MajorID: majorID, EntryYear: entryYear}, nil
}

// AddToCart ports addToCartAction.
func (s *Service) AddToCart(ctx context.Context, studentID, offeringID int64) error {
	termID, uni, err := s.currentTermForStudent(ctx, studentID)
	if err != nil {
		return err
	}
	_ = uni
	var studentUni *int64
	_ = s.DB.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, studentID).Scan(&studentUni)
	off, err := s.offeringInMyScope(ctx, studentUni, termID, offeringID)
	if err != nil {
		return err
	}
	// Duplicate registration of the same offering is forbidden — the row does not get into the cart.
	var already int
	_ = s.DB.Pool.QueryRow(ctx, `
		select 1 from enrollments
		 where "studentId" = $1 and "offeringId" = $2
		   and status in ('REGISTERED','FINALIZED','WAITLISTED','PENDING_COUNCIL') limit 1`,
		studentID, offeringID).Scan(&already)
	if already == 1 {
		return actionErr("این درس قبلاً برای شما ثبت شده است.")
	}
	scope, err := s.studentScope(ctx, studentID)
	if err != nil {
		return err
	}
	if !OfferingVisible(Targeting{
		TargetDegreeLevelID: off.TargetDegreeLevelID, TargetMajorID: off.TargetMajorID,
		EntryYearStart: off.EntryYearStart, EntryYearEnd: off.EntryYearEnd,
	}, scope) {
		return actionErr("این ارائه به مقطع/رشته/سال ورودی شما اختصاص ندارد.")
	}

	// Removing other groups of the same course from the cart (group replacement).
	if _, err := s.DB.Pool.Exec(ctx, `
		delete from cart_items where "studentId" = $1 and "offeringId" in (
			select id from course_offerings where "termId" = $2 and "courseId" = $3
		)`, studentID, termID, off.CourseID); err != nil {
		return err
	}
	// The schema contract has no uniqueness on (studentId, offeringId); delete+insert inside the transaction
	// gives the same effect without needing a unique index (current system behavior).
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `delete from cart_items where "studentId" = $1 and "offeringId" = $2`, studentID, offeringID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into cart_items ("studentId", "offeringId", "createdAt") values ($1, $2, now())`, studentID, offeringID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RemoveFromCart ports removeFromCartAction.
func (s *Service) RemoveFromCart(ctx context.Context, studentID, offeringID int64) error {
	_, err := s.DB.Pool.Exec(ctx, `delete from cart_items where "studentId" = $1 and "offeringId" = $2`, studentID, offeringID)
	return err
}

// ClearCart ports clearCartAction (works with cart columns without universityId too).
func (s *Service) ClearCart(ctx context.Context, studentID int64) error {
	_, err := s.DB.Pool.Exec(ctx, `delete from cart_items where "studentId" = $1`, studentID)
	return err
}

// SubmitTick is the result of entering the queue/direct registration.
type SubmitTick struct {
	Queued   bool          `json:"queued"`
	TicketID string        `json:"ticketId"`
	Position int           `json:"position"`
	Limited  bool          `json:"limited,omitempty"`
	Direct   bool          `json:"direct,omitempty"`
	Result   *SubmitResult `json:"result,omitempty"`
	Error    string        `json:"error,omitempty"`
}

// SubmitCart ports submitCartAction.
func (s *Service) SubmitCart(ctx context.Context, userID, studentID int64, acceptSameDayRisk bool) SubmitTick {
	if !s.WR.RateLimitSubmit(ctx, userID) {
		return SubmitTick{Limited: true}
	}
	// Queue worker; direct path when Redis is absent.
	s.WR.EnsureWorker(func(wctx context.Context, uid, sid int64, risk bool) any {
		return s.ProcessQueuedSubmit(wctx, uid, sid, risk)
	})
	if !s.WR.Available(ctx) {
		res := s.ProcessQueuedSubmit(ctx, userID, studentID, acceptSameDayRisk)
		return SubmitTick{Direct: true, Result: &res}
	}
	ticket, position, err := s.WR.EnqueueSubmit(ctx, userID, studentID, acceptSameDayRisk)
	if err != nil {
		res := s.ProcessQueuedSubmit(ctx, userID, studentID, acceptSameDayRisk)
		return SubmitTick{Direct: true, Result: &res}
	}
	return SubmitTick{Queued: true, TicketID: ticket.ID, Position: position}
}

// MyStatus is the user's queue status.
func (s *Service) MyStatus(ctx context.Context, userID int64) WrStatus {
	return s.WR.MyStatus(ctx, userID)
}

// ExamConflict is an exam conflict in the preview.
type ExamConflict struct {
	OfferingID int64  `json:"offeringId"`
	CourseCode string `json:"courseCode"`
	Title      string `json:"title"`
	ExamDate   string `json:"examDate"`
	StartTime  string `json:"startTime"`
	WithCourse string `json:"withCourse"`
}

// PreviewExamConflicts ports previewExamConflictsAction.
func (s *Service) PreviewExamConflicts(ctx context.Context, studentID int64) (hard, soft []ExamConflict, err error) {
	termID, _, err := s.currentTermForStudent(ctx, studentID)
	if err != nil {
		return nil, nil, err
	}
	ids := map[int64]bool{}
	if rows, err := s.DB.Pool.Query(ctx, `
		select "offeringId" from cart_items where "studentId" = $1`, studentID); err == nil {
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err == nil {
				ids[id] = true
			}
		}
		rows.Close()
	}
	if rows, err := s.DB.Pool.Query(ctx, `
		select e."offeringId" from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		 where e."studentId" = $1 and o."termId" = $2
		   and e.status in ('REGISTERED','PENDING_COUNCIL')`, studentID, termID); err == nil {
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err == nil {
				ids[id] = true
			}
		}
		rows.Close()
	}
	allIDs := []int64{}
	for id := range ids {
		allIDs = append(allIDs, id)
	}
	hard, soft = []ExamConflict{}, []ExamConflict{}
	if len(allIDs) < 2 {
		return hard, soft, nil
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select sc."offeringId", c.code, c.title, sc."examDate"::text, sc."startTime"::text, sc."endTime"::text
		  from schedules sc
		  join course_offerings o on o.id = sc."offeringId"
		  join courses c on c.id = o."courseId"
		 where sc."scheduleType" = 'EXAM' and sc."examDate" is not null and sc."offeringId" = any($1)`, allIDs)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	type er struct {
		offeringID       int64
		code, title      string
		date, start, end *string
	}
	list := []er{}
	for rows.Next() {
		var r er
		if err := rows.Scan(&r.offeringID, &r.code, &r.title, &r.date, &r.start, &r.end); err == nil {
			list = append(list, r)
		}
	}
	for i := 0; i < len(list); i++ {
		for j := i + 1; j < len(list); j++ {
			a, b := list[i], list[j]
			if a.date == nil || b.date == nil || *a.date != *b.date {
				continue
			}
			as, ae := strDeref(a.start), strDeref(a.end)
			bs, be := strDeref(b.start), strDeref(b.end)
			info := ExamConflict{OfferingID: a.offeringID, CourseCode: a.code, Title: a.title, ExamDate: *a.date, StartTime: clock5(as), WithCourse: b.code}
			if timeOverlap(as, ae, bs, be) {
				hard = append(hard, info)
			} else {
				soft = append(soft, info)
			}
		}
	}
	return hard, soft, nil
}

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ReferCouncil ports referCouncilAction.
func (s *Service) ReferCouncil(ctx context.Context, userID, studentID, offeringID int64, reason string) error {
	termID, _, err := s.currentTermForStudent(ctx, studentID)
	if err != nil {
		return err
	}
	var studentUni *int64
	_ = s.DB.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, studentID).Scan(&studentUni)
	off, err := s.offeringInMyScope(ctx, studentUni, termID, offeringID)
	if err != nil {
		return err
	}

	var enrollmentID int64
	err = s.DB.Pool.QueryRow(ctx, `
		insert into enrollments ("studentId", "offeringId", status)
		values ($1,$2,'PENDING_COUNCIL')
		on conflict ("studentId","offeringId") do update set status = 'PENDING_COUNCIL'
		returning id`, studentID, offeringID).Scan(&enrollmentID)
	if err != nil {
		return err
	}

	var procID int64
	if err := s.DB.Pool.QueryRow(ctx, `select id from process_definitions where code = 'PREREQ_WAIVER' limit 1`).Scan(&procID); err == nil {
		var firstStepID *int64
		_ = s.DB.Pool.QueryRow(ctx, `
			select id from process_steps where "processId" = $1 order by "stepOrder" limit 1`, procID).Scan(&firstStepID)
		tracking := fmt.Sprintf("WR-%06d%02d", time.Now().UnixMilli()%1000000, rand.Intn(90)+10)
		reasons := []string{"خطای نرم انتخاب واحد"}
		if strings.TrimSpace(reason) != "" {
			reasons = []string{reason}
		}
		formData, _ := json.Marshal(map[string]any{
			"offeringId": offeringID, "offeringTitle": off.Title, "reasons": reasons,
		})
		var requestID int64
		err := s.DB.Pool.QueryRow(ctx, `
			insert into student_requests ("trackingCode","studentId","processId","currentStepId","status","formData","relatedEnrollmentId")
			values ($1,$2,$3,$4,'SUBMITTED',$5,$6) returning id`,
			tracking, studentID, procID, firstStepID, string(formData), enrollmentID).Scan(&requestID)
		if err == nil {
			_, _ = s.DB.Pool.Exec(ctx, `update enrollments set "workflowRequestId" = $1 where id = $2`, requestID, enrollmentID)
		}
	}

	_, _ = s.DB.Pool.Exec(ctx, `delete from cart_items where "studentId" = $1 and "offeringId" = $2`, studentID, offeringID)
	payload, _ := json.Marshal(map[string]any{"course": off.Title, "termId": termID})
	_, _ = s.DB.Pool.Exec(ctx, `
		insert into notifications ("userId","eventCode",payload) values ($1,'COUNCIL_REFERRAL',$2)`, userID, string(payload))
	return nil
}

// RequestBypass ports requestBypassAction + createBypassRequest.
func (s *Service) RequestBypass(ctx context.Context, studentID, offeringID int64, kind string) error {
	if kind != "PREREQ" && kind != "EXAM_CONFLICT" {
		return actionErr("نوع درخواست نامعتبر است.")
	}
	termID, _, err := s.currentTermForStudent(ctx, studentID)
	if err != nil {
		return err
	}
	var studentUni *int64
	_ = s.DB.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, studentID).Scan(&studentUni)
	off, err := s.offeringInMyScope(ctx, studentUni, termID, offeringID)
	if err != nil {
		return err
	}
	// Duplicate registration of the same offering is forbidden — the row does not get into the cart.
	var already int
	_ = s.DB.Pool.QueryRow(ctx, `
		select 1 from enrollments
		 where "studentId" = $1 and "offeringId" = $2
		   and status in ('REGISTERED','FINALIZED','WAITLISTED','PENDING_COUNCIL') limit 1`,
		studentID, offeringID).Scan(&already)
	if already == 1 {
		return actionErr("این درس قبلاً برای شما ثبت شده است.")
	}
	scope, err := s.studentScope(ctx, studentID)
	if err != nil {
		return err
	}
	if !OfferingVisible(Targeting{
		TargetDegreeLevelID: off.TargetDegreeLevelID, TargetMajorID: off.TargetMajorID,
		EntryYearStart: off.EntryYearStart, EntryYearEnd: off.EntryYearEnd,
	}, scope) {
		return actionErr("این ارائه به مقطع/رشته/سال ورودی شما اختصاص ندارد.")
	}

	if kind == "PREREQ" {
		prereq, err := BuildPrereqContext(ctx, s.DB.Pool, studentID)
		if err == nil {
			if rule := prereq.RuleByCourse[off.CourseID]; rule != nil {
				if ok, _ := EvaluateLogicTree(rule, prereq.Passed); ok {
					return actionErr("پیش‌نیاز این درس را پاس کرده‌اید؛ نیازی به درخواست نیست.")
				}
			}
		}
	}

	if kind == "EXAM_CONFLICT" {
		targetExams := s.loadSchedules(ctx, []int64{offeringID})
		if !hasExam(targetExams) {
			return actionErr("برای این درس جلسهٔ امتحانی ثبت نشده است.")
		}
		regRows, _ := s.DB.Pool.Query(ctx, `
			select e."offeringId" from enrollments e
			  join course_offerings o on o.id = e."offeringId"
			 where e."studentId" = $1 and o."termId" = $2
			   and e.status in ('REGISTERED','PENDING_COUNCIL')`, studentID, termID)
		regIDs := []int64{}
		if regRows != nil {
			for regRows.Next() {
				var id int64
				if err := regRows.Scan(&id); err == nil {
					regIDs = append(regIDs, id)
				}
			}
			regRows.Close()
		}
		regExams := s.loadSchedules(ctx, regIDs)
		hasConflict := false
		for _, te := range targetExams {
			if strings.ToUpper(te.ScheduleType) != "EXAM" {
				continue
			}
			for _, re := range regExams {
				if strings.ToUpper(re.ScheduleType) != "EXAM" {
					continue
				}
				if te.ExamDate != nil && re.ExamDate != nil && *te.ExamDate == *re.ExamDate &&
					timeOverlap(te.StartTime, te.EndTime, re.StartTime, re.EndTime) {
					hasConflict = true
				}
			}
		}
		if !hasConflict {
			return actionErr("تداخل امتحانی برای این درس با دروس ثبت‌شدهٔ شما یافت نشد.")
		}
	}

	// duplicate.
	var dup int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select b.id from enroll_bypass_requests b
		  join course_offerings o on o.id = b."offeringId"
		 where b."studentId" = $1 and o."courseId" = $2
		   and b.status in ('PENDING_MANAGER','ESCALATED_EXPERT') limit 1`, studentID, off.CourseID).Scan(&dup); err == nil {
		return actionErr("برای این درس یک درخواست باز دارید.")
	}

	// Unit cap: registered + open requests + this course.
	var registeredUnits, pendingUnits float64
	_ = s.DB.Pool.QueryRow(ctx, `
		select coalesce(sum(c.units),0)::float8 from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1 and o."termId" = $2
		   and e.status in ('REGISTERED','PENDING_COUNCIL')`, studentID, termID).Scan(&registeredUnits)
	_ = s.DB.Pool.QueryRow(ctx, `
		select coalesce(sum(c.units),0)::float8 from enroll_bypass_requests b
		  join course_offerings o on o.id = b."offeringId"
		  join courses c on c.id = o."courseId"
		 where b."studentId" = $1 and o."termId" = $2
		   and b.status in ('PENDING_MANAGER','ESCALATED_EXPERT')`, studentID, termID).Scan(&pendingUnits)
	if summary, err := EvaluateStudentRegulationStatus(ctx, s.DB.Pool, studentID, &termID); err == nil {
		used := registeredUnits + pendingUnits + off.Units
		if used > summary.EffectiveMaxUnits {
			return actionErr(fmt.Sprintf("سقف واحد مجاز این ترم %s واحد است و با این درس %s واحد می‌شود. ابتدا واحدهای دیگر را حذف کنید.",
				faNum(summary.EffectiveMaxUnits), faNum(used)))
		}
	}

	// Seat reservation.
	if !s.claimSeats(ctx, []int64{offeringID})[offeringID] {
		return actionErr("ظرفیت این درس پر است.")
	}

	managerHours := 48
	var rawHours *int
	_ = s.DB.Pool.QueryRow(ctx, `select "bypassManagerHours" from academic_terms where id = $1`, termID).Scan(&rawHours)
	if rawHours != nil && *rawHours > 0 {
		managerHours = *rawHours
	}
	deadline := time.Now().Add(time.Duration(managerHours) * time.Hour)
	// University: from the student, otherwise from the term.
	uni := studentUni
	if uni == nil {
		_ = s.DB.Pool.QueryRow(ctx, `select "universityId" from academic_terms where id = $1`, termID).Scan(&uni)
	}
	_, err = s.DB.Pool.Exec(ctx, `
		insert into enroll_bypass_requests
			("studentId","offeringId","termId","universityId",kind,status,"managerDeadlineAt","seatReserved")
		values ($1,$2,$3,$4,$5,'PENDING_MANAGER',$6,1)`,
		studentID, offeringID, termID, uni, kind, deadline)
	if err != nil {
		s.compensateSeat(ctx, offeringID)
		return actionErr("ثبت درخواست ناموفق بود: " + err.Error())
	}
	return nil
}

func hasExam(list []scheduleRow) bool {
	for _, s := range list {
		if strings.ToUpper(s.ScheduleType) == "EXAM" {
			return true
		}
	}
	return false
}

// CancelBypass ports cancelBypassRequest.
func (s *Service) CancelBypass(ctx context.Context, studentID, requestID int64) error {
	var (
		offeringID   int64
		owner        int64
		status       string
		seatReserved int
	)
	err := s.DB.Pool.QueryRow(ctx, `
		select "offeringId","studentId",status,coalesce("seatReserved",0)
		  from enroll_bypass_requests where id = $1`, requestID).
		Scan(&offeringID, &owner, &status, &seatReserved)
	if errors.Is(err, pgx.ErrNoRows) || owner != studentID {
		return actionErr("درخواست یافت نشد.")
	}
	if err != nil {
		return err
	}
	if status != "PENDING_MANAGER" && status != "ESCALATED_EXPERT" {
		return actionErr("این درخواست قابل لغو نیست.")
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		update enroll_bypass_requests set status = 'CANCELLED', "seatReserved" = 0, "updatedAt" = now()
		 where id = $1`, requestID); err != nil {
		return err
	}
	if seatReserved != 0 {
		s.compensateSeat(ctx, offeringID)
	}
	return nil
}
