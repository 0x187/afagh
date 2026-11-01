// ═══ Student dashboard — port of student/page.tsx (data part) ═══
package student

import (
	"context"
	"strings"

	"backend-go/internal/finance"
)

// VirtualClass is a student virtual-class session.
type VirtualClass struct {
	ID                     int64  `json:"id"`
	CourseTitle            string `json:"courseTitle"`
	MeetingID              string `json:"meetingId"`
	IsRunning              bool   `json:"isRunning"`
	CurrentAttendanceCount int    `json:"currentAttendanceCount"`
	Professor              string `json:"professor"`
}

// UpcomingExam is an upcoming exam with a seat number.
type UpcomingExam struct {
	Code       string  `json:"code"`
	Title      string  `json:"title"`
	Group      int     `json:"group"`
	Units      int     `json:"units"`
	Professor  string  `json:"professor"`
	ExamDate   *string `json:"examDate"`
	ExamTime   *string `json:"examTime"`
	Room       *string `json:"room"`
	SeatNumber *int    `json:"seatNumber"`
}

// DashboardResponse is the full dashboard data.
type DashboardResponse struct {
	Student            StudentInfo    `json:"student"`
	Term               TermInfo       `json:"term"`
	University         UniversityInfo `json:"university"`
	VirtualClasses     []VirtualClass `json:"virtualClasses"`
	UpcomingExams      []UpcomingExam `json:"upcomingExams"`
	DebtRials          int64          `json:"debtRials"`
	IsFinancialCleared bool           `json:"isFinancialCleared"`
	TermHasEnrollment  bool           `json:"termHasEnrollment"`
}

// GetDashboard ports the StudentDashboardPage function (without demo/messenger parts).
//
// Term order is exactly like the home page: the cookie-selected term, otherwise the current effective term;
// in "all terms" mode the effective term itself is the basis (not the isCurrent column).
func (s *Service) GetDashboard(ctx context.Context, userID int64, userName string, termCookie *int64) (*DashboardResponse, error) {
	me, err := s.Resolve(ctx, userID)
	if err != nil {
		return nil, err
	}
	if me == nil {
		return nil, errNoStudent
	}

	info, termID, termTitle, termCode := s.describeStudent(ctx, me, userName, termCookie)
	if err != nil {
		return nil, err
	}

	resp := &DashboardResponse{
		Student:        info,
		Term:           TermInfo{ID: termID, Title: termTitle, TermCode: termCode},
		University:     s.universityInfo(ctx, me.UniversityID),
		VirtualClasses: []VirtualClass{},
		UpcomingExams:  []UpcomingExam{},
	}
	if termTitle == "" {
		resp.Term.Title = "نیمسال نامشخص"
	}
	if termCode == "" {
		resp.Term.TermCode = "—"
	}

	// Financial debt from the canonical ledger — every known transaction type.
	ledgerRows, err := s.Pool.Query(ctx, `
		select "transactionType", amount::float8 from student_ledger where "studentId" = $1`, me.ID)
	if err != nil {
		return nil, err
	}
	ledger := []finance.LedgerBalanceRow{}
	for ledgerRows.Next() {
		var r finance.LedgerBalanceRow
		if err := ledgerRows.Scan(&r.TransactionType, &r.Amount); err != nil {
			ledgerRows.Close()
			return nil, err
		}
		ledger = append(ledger, r)
	}
	ledgerRows.Close()
	if err := ledgerRows.Err(); err != nil {
		return nil, err
	}
	balance := finance.LedgerBalance(ledger)
	if balance < 0 {
		balance = 0
	}
	resp.DebtRials = int64(balance + 0.5)
	resp.IsFinancialCleared = resp.DebtRials == 0

	if termID == nil {
		return resp, nil
	}

	// Term enrollments (including dropped ones — for stats and seats).
	enrollments, err := s.loadTermEnrollments(ctx, me.ID, *termID)
	if err != nil {
		return nil, err
	}
	resp.TermHasEnrollment = len(enrollments) > 0

	// Seat number from exam allocations (if any).
	seats := map[int64]int{}
	seatRows, err := s.Pool.Query(ctx, `
		select sa."enrollmentId", sa."seatNumber"
		  from seat_allocations sa
		  join enrollments e on e.id = sa."enrollmentId"
		 where e."studentId" = $1`, me.ID)
	if err == nil {
		for seatRows.Next() {
			var enID int64
			var seat *int
			if err := seatRows.Scan(&enID, &seat); err == nil && seat != nil {
				seats[enID] = *seat
			}
		}
		seatRows.Close()
	}

	// Class/exam sessions from schedules.
	offeringIDs := make([]int64, 0, len(enrollments))
	for _, e := range enrollments {
		offeringIDs = append(offeringIDs, e.OfferingID)
	}
	examByOffering := map[int64]ExamSlot{}
	if len(offeringIDs) > 0 {
		srows, err := s.Pool.Query(ctx, `
			select sc."offeringId", sc."examDate"::text, sc."startTime"::text, sc."endTime"::text, cr.name
			  from schedules sc
			  left join classrooms cr on cr.id = sc."roomId"
			 where sc."offeringId" = any($1) and sc."scheduleType" = 'EXAM'`, offeringIDs)
		if err != nil {
			return nil, err
		}
		for srows.Next() {
			var offeringID int64
			var examDate, start, end, room *string
			if err := srows.Scan(&offeringID, &examDate, &start, &end, &room); err != nil {
				srows.Close()
				return nil, err
			}
			slot := ExamSlot{}
			if examDate != nil {
				slot.ExamDate = *examDate
			}
			if start != nil {
				slot.StartTime = clock5(*start)
			}
			if end != nil {
				slot.EndTime = clock5(*end)
			}
			if room != nil {
				slot.Room = *room
			}
			examByOffering[offeringID] = slot
		}
		srows.Close()
		if err := srows.Err(); err != nil {
			return nil, err
		}
	}

	for _, e := range enrollments {
		if slot, ok := examByOffering[e.OfferingID]; ok {
			examDate := slot.ExamDate
			examTime := slot.StartTime
			room := slot.Room
			var seat *int
			if v, ok := seats[e.EnrollmentID]; ok {
				seat = &v
			}
			item := UpcomingExam{
				Code: e.Code, Title: e.Title, Group: e.Group, Units: e.Units,
				Professor: e.Professor, SeatNumber: seat,
			}
			if examDate != "" {
				item.ExamDate = &examDate
			}
			if examTime != "" {
				item.ExamTime = &examTime
			}
			if room != "" {
				item.Room = &room
			}
			resp.UpcomingExams = append(resp.UpcomingExams, item)
			if len(resp.UpcomingExams) >= 3 {
				break
			}
		}
	}

	// Term virtual classes.
	vcRows, err := s.Pool.Query(ctx, `
		select vc.id, c.title, coalesce(vc."bbbMeetingId", ''), coalesce(vc."isRunning", 0),
		       coalesce(vc."currentAttendanceCount", 0), o."professorId"
		  from virtual_classrooms vc
		  join course_offerings o on o.id = vc."courseOfferingId"
		  join courses c on c.id = o."courseId"
		 where o."termId" = $1 and o.id = any($2)`, *termID, offeringIDs)
	if err == nil {
		profNames := s.professorNames(ctx, enrollments)
		for vcRows.Next() {
			var v VirtualClass
			var profID *int64
			var running int
			if err := vcRows.Scan(&v.ID, &v.CourseTitle, &v.MeetingID, &running, &v.CurrentAttendanceCount, &profID); err != nil {
				vcRows.Close()
				return nil, err
			}
			v.IsRunning = running != 0
			v.Professor = "نامشخص"
			if profID != nil {
				if n, ok := profNames[*profID]; ok && n != "" {
					v.Professor = n
				}
			}
			resp.VirtualClasses = append(resp.VirtualClasses, v)
		}
		vcRows.Close()
	}

	return resp, nil
}

// termEnrollment is the term-enrollment row.
type termEnrollment struct {
	EnrollmentID int64
	OfferingID   int64
	Code         string
	Title        string
	Units        int
	Group        int
	Professor    string
	ProfessorID  *int64
	Status       string
}

func (s *Service) loadTermEnrollments(ctx context.Context, studentID, termID int64) ([]termEnrollment, error) {
	rows, err := s.Pool.Query(ctx, `
		select e.id, e."offeringId", c.code, c.title, coalesce(c.units, 0)::int,
		       coalesce(o."groupNumber", 0), o."professorId", e.status
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1 and o."termId" = $2
		   and e.status in ('REGISTERED','FINALIZED','WAITLISTED','PENDING_COUNCIL','DROPPED')
		 order by c.title`, studentID, termID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []termEnrollment{}
	for rows.Next() {
		var e termEnrollment
		if err := rows.Scan(&e.EnrollmentID, &e.OfferingID, &e.Code, &e.Title, &e.Units,
			&e.Group, &e.ProfessorID, &e.Status); err != nil {
			return nil, err
		}
		e.Professor = "نامشخص"
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	profNames := s.professorNames(ctx, out)
	for i := range out {
		if out[i].ProfessorID != nil {
			if n, ok := profNames[*out[i].ProfessorID]; ok && n != "" {
				out[i].Professor = n
			}
		}
	}
	return out, nil
}

func (s *Service) professorNames(ctx context.Context, list []termEnrollment) map[int64]string {
	names := map[int64]string{}
	ids := []int64{}
	seen := map[int64]bool{}
	for _, e := range list {
		if e.ProfessorID != nil && !seen[*e.ProfessorID] {
			seen[*e.ProfessorID] = true
			ids = append(ids, *e.ProfessorID)
		}
	}
	if len(ids) == 0 {
		return names
	}
	rows, err := s.Pool.Query(ctx, `
		select st.id, u."firstName", u."lastName"
		  from staff st join users u on u.id = st."userId"
		 where st.id = any($1)`, ids)
	if err != nil {
		return names
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var fn, ln string
		if err := rows.Scan(&id, &fn, &ln); err == nil {
			names[id] = strings.TrimSpace(fn + " " + ln)
		}
	}
	return names
}
