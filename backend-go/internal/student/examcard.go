// ═══ کارت آزمون / ورود به جلسه — پورت student/exam-card ═══
package student

import (
	"context"
	"fmt"
	"strings"
	"time"

	"backend-go/internal/finance"
	"backend-go/internal/jalali"
	"backend-go/internal/qr"
)

// ExamCardCourse ردیف درس در کارت آزمون.
type ExamCardCourse struct {
	EnrollmentID  int64   `json:"enrollmentId"`
	CourseCode    string  `json:"courseCode"`
	CourseTitle   string  `json:"courseTitle"`
	Units         int     `json:"units"`
	ProfessorName string  `json:"professorName"`
	ClassRoomName *string `json:"classRoomName"`
	ExamDate      string  `json:"examDate"`
	ExamTime      string  `json:"examTime"`
	ExamHall      *string `json:"examHall"`
	SeatNumber    *int    `json:"seatNumber"`
	HasEvaluated  bool    `json:"hasEvaluated"`
}

// ExamCard کارت آزمون دانشجو.
type ExamCard struct {
	StudentID          int64            `json:"studentId"`
	StudentCode        string           `json:"studentCode"`
	FullName           string           `json:"fullName"`
	NationalIDMasked   string           `json:"nationalIdMasked"`
	MajorName          *string          `json:"majorName"`
	EntryYear          int              `json:"entryYear"`
	TermTitle          string           `json:"termTitle"`
	DebtRials          int64            `json:"debtRials"`
	IsFinancialCleared bool             `json:"isFinancialCleared"`
	Courses            []ExamCardCourse `json:"courses"`
}

// EvaluationWindowStatus وضعیت پنجرهٔ ارزشیابی.
type EvaluationWindowStatus struct {
	Open    bool   `json:"open"`
	Message string `json:"message"`
	Title   string `json:"title"`
}

// ExamTicketInfo توکن امضاشدهٔ کارت ورود.
type ExamTicketInfo struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expiresAt"`
}

// ExamCardQR بلوک QR.
type ExamCardQR struct {
	URL string `json:"url"`
	SVG string `json:"svg"`
}

// ExamCardResponse پاسخ کامل کارت آزمون.
type ExamCardResponse struct {
	Card              *ExamCard               `json:"card"`
	ExamTicket        *ExamTicketInfo         `json:"examTicket"`
	ExamTicketBlocked *string                 `json:"examTicketBlocked"`
	TicketQR          *ExamCardQR             `json:"ticketQr"`
	EvaluationWindow  *EvaluationWindowStatus `json:"evaluationWindow"`
	University        UniversityInfo          `json:"university"`
	NoCourses         bool                    `json:"noCourses"`
}

// GetExamCard پورت getExamCardData + صفحهٔ exam-card.
//
// نیمسال: اگر termID داده نشود، ترم مؤثر جاری دانشگاه مبنا است (مثل
// getExamCardData وقتی resolvedTerm داده نشود).
func (s *Service) GetExamCard(ctx context.Context, userID int64, termCookie *int64, publicBaseURL string) (*ExamCardResponse, error) {
	me, err := s.Resolve(ctx, userID)
	if err != nil {
		return nil, err
	}
	if me == nil {
		return nil, errNoStudent
	}

	selection := s.Scope.GetTermScope(ctx, me.UniversityID, termCookie)
	termID := selection.EffectiveID
	if selection.SelectedID != nil {
		termID = selection.SelectedID
	}
	termTitle := ""
	if termID != nil {
		_ = s.Pool.QueryRow(ctx, `select title from academic_terms where id = $1`, *termID).Scan(&termTitle)
	}
	if termTitle == "" {
		termTitle = "—"
	}

	var fullName, nationalCode, majorName *string
	_ = s.Pool.QueryRow(ctx, `
		select (u."firstName" || ' ' || u."lastName"), u."nationalCode", m.name
		  from students st
		  join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		 where st.id = $1`, me.ID).Scan(&fullName, &nationalCode, &majorName)

	card := &ExamCard{
		StudentID:        me.ID,
		StudentCode:      me.StudentCode,
		EntryYear:        me.EntryYear,
		TermTitle:        termTitle,
		NationalIDMasked: maskNationalCode(nationalCode),
		MajorName:        majorName,
		Courses:          []ExamCardCourse{},
	}
	if fullName != nil {
		card.FullName = strings.TrimSpace(*fullName)
	}

	// بدهی مالی.
	card.DebtRials = s.debtRials(ctx, me.ID)
	card.IsFinancialCleared = card.DebtRials == 0

	// دروس + تخصیص صندلی (یک کوئری، مثل getExamCardData).
	rows, err := s.Pool.Query(ctx, `
		select en.id as "enrollmentId",
		       c.code as "courseCode", c.title as "courseTitle", coalesce(c.units,0)::int as "units",
		       (pu."firstName" || ' ' || pu."lastName") as "professorName",
		       cr.name as "classRoomName",
		       coalesce(es."examDate", sc."examDate"::text, '') as "examDate",
		       coalesce(es."startTime", sc."startTime"::text, '') as "startTime",
		       coalesce(es."endTime", sc."endTime"::text, '') as "endTime",
		       eh.name as "hallName", sa."seatNumber" as "seatNumber",
		       coalesce(en."hasEvaluated",0)::int as "hasEvaluated"
		  from enrollments en
		  join course_offerings o on o.id = en."offeringId"
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = o."professorId"
		  left join users pu on pu.id = st."userId"
		  left join schedules sc on sc."offeringId" = o.id and sc."scheduleType" = 'EXAM'
		  left join classrooms cr on cr.id = sc."roomId"
		  left join seat_allocations sa on sa."enrollmentId" = en.id
		  left join exam_sessions es on es.id = sa."sessionId"
		  left join exam_halls eh on eh.id = sa."hallId"
		 where en."studentId" = $1
		   and ($2::int is null or o."termId" = $2::int)
		 order by coalesce(es."examDate", sc."examDate"::text, ''), coalesce(es."startTime", sc."startTime"::text, '')`,
		me.ID, termID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c ExamCardCourse
		var examDate, startTime, endTime string
		var profName *string
		var hasEvaluated int
		if err := rows.Scan(&c.EnrollmentID, &c.CourseCode, &c.CourseTitle, &c.Units,
			&profName, &c.ClassRoomName, &examDate, &startTime, &endTime,
			&c.ExamHall, &c.SeatNumber, &hasEvaluated); err != nil {
			return nil, err
		}
		c.ProfessorName = "نامشخص"
		if profName != nil && strings.TrimSpace(*profName) != "" {
			c.ProfessorName = strings.TrimSpace(*profName)
		}
		if examDate != "" {
			c.ExamDate = examDate
		} else {
			c.ExamDate = "—"
		}
		if startTime != "" {
			c.ExamTime = clock5(startTime) + " – " + clock5(endTime)
		} else {
			c.ExamTime = "—"
		}
		c.HasEvaluated = hasEvaluated != 0
		card.Courses = append(card.Courses, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	resp := &ExamCardResponse{
		Card:       card,
		University: s.universityInfo(ctx, me.UniversityID),
		NoCourses:  len(card.Courses) == 0,
	}

	// توکن کارت ورود — فقط وقتی پرونده هست (مثل صفحهٔ اصلی).
	if s.Signer != nil {
		ttlMin := 180.0
		if s.Settings != nil {
			ttlMin = s.Settings.GetNumber(ctx, "EXAM_TICKET_TTL_MINUTES", 180)
		}
		if !(ttlMin > 0) {
			msg := "مدت اعتبار کارت ورود به جلسه (EXAM_TICKET_TTL_MINUTES) باید عددی بزرگ‌تر از صفر باشد."
			resp.ExamTicketBlocked = &msg
		} else {
			if ttlMin > 4320 {
				ttlMin = 4320
			}
			ttlSec := int(ttlMin) * 60
			if token, err := s.Signer.Sign(ctx, map[string]any{"uid": userID, "kind": "EXAM"}, ttlSec); err == nil {
				resp.ExamTicket = &ExamTicketInfo{Token: token, ExpiresAt: expiresAtISO(ttlSec)}
				if publicBaseURL != "" {
					url := strings.TrimRight(publicBaseURL, "/") + "/exam-ticket/" + token
					if svg, err := qr.SVG(url, qr.Options{Level: "Q", Size: 160, Margin: 4}); err == nil {
						resp.TicketQR = &ExamCardQR{URL: url, SVG: svg}
					}
				}
			} else {
				msg := err.Error()
				resp.ExamTicketBlocked = &msg
			}
		}
	}

	// پنجرهٔ ارزشیابی.
	resp.EvaluationWindow = s.evaluationWindow(ctx, me.UniversityID, termID)
	return resp, nil
}

func (s *Service) debtRials(ctx context.Context, studentID int64) int64 {
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
	return int64(balance + 0.5)
}

// evaluationWindow پورت getEvaluationWindow (fail-closed).
func (s *Service) evaluationWindow(ctx context.Context, universityID, termID *int64) *EvaluationWindowStatus {
	status := &EvaluationWindowStatus{
		Open:    false,
		Title:   "",
		Message: "پنجرهٔ ارزشیابی برای این ترم تعیین نشده است — ارزشیابی در حال حاضر بسته است.",
	}
	q := `select title, "startDate", "endDate" from evaluation_periods where "isActive" = 1`
	args := []any{}
	idx := 1
	if termID != nil {
		q += fmt.Sprintf(` and ("termId" = $%d or "termId" is null)`, idx)
		args = append(args, *termID)
		idx++
	}
	if universityID != nil {
		q += fmt.Sprintf(` and ("universityId" = $%d or "universityId" is null)`, idx)
		args = append(args, *universityID)
		idx++
	}
	q += ` order by id desc limit 5`
	rows, err := s.Pool.Query(ctx, q, args...)
	if err != nil {
		return status
	}
	defer rows.Close()
	type period struct {
		title string
		start *time.Time
		end   *time.Time
	}
	list := []period{}
	for rows.Next() {
		var p period
		if err := rows.Scan(&p.title, &p.start, &p.end); err == nil {
			list = append(list, p)
		}
	}
	if len(list) == 0 {
		return status
	}
	now := time.Now()
	var open *period
	for i := range list {
		p := list[i]
		if p.start != nil && p.end != nil && !now.Before(*p.start) && !now.After(*p.end) {
			open = &list[i]
			break
		}
	}
	if open != nil {
		status.Open = true
		status.Title = open.title
		status.Message = fmt.Sprintf("پنجرهٔ ارزشیابی باز است (%s تا %s).", faDateTime(open.start), faDateTime(open.end))
		return status
	}
	pick := list[0]
	status.Title = pick.title
	if pick.end != nil && now.After(*pick.end) {
		status.Message = fmt.Sprintf("پنجرهٔ ارزشیابی در %s بسته شده است. تا آن زمان ثبت ارزشیابی ممکن نیست.", faDateTime(pick.end))
	} else {
		status.Message = fmt.Sprintf("پنجرهٔ ارزشیابی از %s باز می‌شود. تا آن زمان ثبت ارزشیابی ممکن نیست.", faDateTime(pick.start))
	}
	return status
}

func faDateTime(t *time.Time) string {
	if t == nil {
		return "—"
	}
	d := jalali.ToJalaliFromTime(*t)
	date := fmt.Sprintf("%04d/%02d/%02d", d.Y, d.M, d.D)
	clock := fmt.Sprintf("%02d:%02d", t.Hour(), t.Minute())
	return jalali.FaDigits(date + " " + clock)
}
