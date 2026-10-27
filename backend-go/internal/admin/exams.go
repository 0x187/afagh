// ═══ برنامه‌ریزی امتحانات (ادمین) — زیرمجموعهٔ کاربردی ═══
package admin

import (
	"context"
	"errors"
	"strings"

	"backend-go/internal/session"
)

// ExamSession جلسهٔ امتحان.
type ExamSession struct {
	ID        int64  `json:"id"`
	TermID    *int64 `json:"termId"`
	ExamDate  string `json:"examDate"`
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime"`
	Allocated int    `json:"allocated"`
}

// ExamCourse درس با جلسهٔ امتحان ثبت‌شده در برنامهٔ هفتگی.
type ExamCourse struct {
	OfferingID int64   `json:"offeringId"`
	Code       string  `json:"courseCode"`
	Title      string  `json:"courseTitle"`
	Group      int     `json:"groupNumber"`
	ExamDate   string  `json:"examDate"`
	StartTime  string  `json:"startTime"`
	EndTime    string  `json:"endTime"`
	RoomName   *string `json:"roomName"`
	SessionID  *int64  `json:"sessionId"`
}

// ExamHall سالن.
type ExamHall struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	Capacity  int     `json:"capacity"`
	RowsCount *int    `json:"rowsCount"`
	ColsCount *int    `json:"colsCount"`
	Building  *string `json:"buildingName"`
}

// ExamsData پاسخ کارتابل.
type ExamsData struct {
	Term           AdminTerm     `json:"term"`
	Sessions       []ExamSession `json:"sessions"`
	Courses        []ExamCourse  `json:"courses"`
	Halls          []ExamHall    `json:"halls"`
	AllocatedTotal int           `json:"allocatedTotal"`
}

// GetExams پورت getExamWorkspaceAction (زیرمجموعه).
func (s *Service) GetExams(ctx context.Context, user *session.User, uniCookie string) (*ExamsData, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	resp := &ExamsData{Sessions: []ExamSession{}, Courses: []ExamCourse{}, Halls: []ExamHall{}}
	if uniID == nil {
		return resp, nil
	}
	var termID int64
	var title, code string
	if err := s.DB.Pool.QueryRow(ctx, `
		select id, title, "termCode" from academic_terms
		 where "isCurrent" = 1 and "universityId" = $1 order by id desc limit 1`, *uniID).
		Scan(&termID, &title, &code); err != nil {
		return resp, nil
	}
	resp.Term = AdminTerm{ID: &termID, Title: title, Code: code}

	srows, err := s.DB.Pool.Query(ctx, `
		select es.id, es."termId", es."examDate", es."startTime", es."endTime",
		       (select count(*)::int from seat_allocations sa where sa."sessionId" = es.id)
		  from exam_sessions es
		 where es."termId" = $1 and (es."universityId" = $2 or es."universityId" is null)
		 order by es."examDate", es."startTime"`, termID, *uniID)
	if err == nil {
		for srows.Next() {
			var e ExamSession
			if err := srows.Scan(&e.ID, &e.TermID, &e.ExamDate, &e.StartTime, &e.EndTime, &e.Allocated); err == nil {
				resp.Sessions = append(resp.Sessions, e)
			}
		}
		srows.Close()
	}

	crows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.code, c.title, coalesce(o."groupNumber",0),
		       sc."examDate"::text, sc."startTime"::text, sc."endTime"::text, cr.name
		  from schedules sc
		  join course_offerings o on o.id = sc."offeringId"
		  join courses c on c.id = o."courseId"
		  left join classrooms cr on cr.id = sc."roomId"
		 where o."termId" = $1 and sc."scheduleType" = 'EXAM'
		 order by sc."examDate", sc."startTime"`, termID)
	if err == nil {
		for crows.Next() {
			var cc ExamCourse
			if err := crows.Scan(&cc.OfferingID, &cc.Code, &cc.Title, &cc.Group, &cc.ExamDate,
				&cc.StartTime, &cc.EndTime, &cc.RoomName); err == nil {
				cc.StartTime = clock5(cc.StartTime)
				cc.EndTime = clock5(cc.EndTime)
				resp.Courses = append(resp.Courses, cc)
			}
		}
		crows.Close()
	}
	// نگاشت جلسه‌ها بر اساس تاریخ/ساعت.
	for i := range resp.Courses {
		for _, es := range resp.Sessions {
			if resp.Courses[i].ExamDate == es.ExamDate && resp.Courses[i].StartTime == clock5(es.StartTime) {
				id := es.ID
				resp.Courses[i].SessionID = &id
				break
			}
		}
	}

	hrows, err := s.DB.Pool.Query(ctx, `
		select id, name, coalesce("totalCapacity", coalesce("rowsCount",0)*coalesce("colsCount",0)),
		       "rowsCount", "colsCount", "buildingName"
		  from exam_halls where "universityId" = $1 order by name`, *uniID)
	if err == nil {
		for hrows.Next() {
			var h ExamHall
			if err := hrows.Scan(&h.ID, &h.Name, &h.Capacity, &h.RowsCount, &h.ColsCount, &h.Building); err == nil {
				resp.Halls = append(resp.Halls, h)
			}
		}
		hrows.Close()
	}
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*)::int from seat_allocations sa
		  join exam_sessions es on es.id = sa."sessionId"
		 where es."termId" = $1`, termID).Scan(&resp.AllocatedTotal)
	return resp, nil
}

// CreateExamSession پورت ایجاد سشن امتحان.
func (s *Service) CreateExamSession(ctx context.Context, user *session.User, uniCookie string, termID int64, examDate, start, end string) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	if strings.TrimSpace(examDate) == "" || strings.TrimSpace(start) == "" || strings.TrimSpace(end) == "" {
		return errors.New("تاریخ و ساعت جلسه الزامی است.")
	}
	if termID <= 0 {
		return errors.New("ترم نامعتبر است.")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		insert into exam_sessions ("termId","examDate","startTime","endTime","universityId")
		values ($1,$2,$3,$4,$5)`, termID, examDate, start, end, *uniID)
	return err
}

// AssignExamSession ارائه را به سشن می‌بندد: برنامهٔ EXAM همان ارائه به
// تاریخ/ساعت سشن به‌روزرسانی می‌شود (یک منبع حقیقت: schedules).
func (s *Service) AssignExamSession(ctx context.Context, user *session.User, uniCookie string, offeringID, sessionID int64) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	var examDate, start, end string
	if err := s.DB.Pool.QueryRow(ctx, `
		select "examDate", "startTime", "endTime" from exam_sessions where id = $1`, sessionID).
		Scan(&examDate, &start, &end); err != nil {
		return errors.New("سشن یافت نشد.")
	}
	tag, err := s.DB.Pool.Exec(ctx, `
		update schedules set "examDate" = $1, "startTime" = $2, "endTime" = $3
		 where "offeringId" = $4 and "scheduleType" = 'EXAM'`, examDate, start, end, offeringID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var universityID *int64
		_ = s.DB.Pool.QueryRow(ctx, `select "universityId" from course_offerings where id = $1`, offeringID).Scan(&universityID)
		_, err = s.DB.Pool.Exec(ctx, `
			insert into schedules ("offeringId","scheduleType","examDate","startTime","endTime","universityId")
			values ($1,'EXAM',$2,$3,$4,$5)`, offeringID, examDate, start, end, universityID)
	}
	return err
}

// CreateExamHall پورت ایجاد سالن.
func (s *Service) CreateExamHall(ctx context.Context, user *session.User, uniCookie string, name string, capacity, rowsCount, colsCount int, building string) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	if strings.TrimSpace(name) == "" {
		return errors.New("نام سالن الزامی است.")
	}
	if capacity <= 0 {
		if rowsCount > 0 && colsCount > 0 {
			capacity = rowsCount * colsCount
		} else {
			return errors.New("ظرفیت یا تعداد ردیف/ستون را وارد کنید.")
		}
	}
	var buildingPtr *string
	if strings.TrimSpace(building) != "" {
		v := strings.TrimSpace(building)
		buildingPtr = &v
	}
	var rows, cols *int
	if rowsCount > 0 {
		rows = &rowsCount
	}
	if colsCount > 0 {
		cols = &colsCount
	}
	_, err := s.DB.Pool.Exec(ctx, `
		insert into exam_halls (name, "totalCapacity", "rowsCount", "colsCount", "buildingName", "universityId")
		values ($1,$2,$3,$4,$5,$6)`, strings.TrimSpace(name), capacity, rows, cols, buildingPtr, *uniID)
	return err
}

// GenerateExamSeats تخصیص صندلی برای سشن‌ها (ساده و قطعی): دانشجویانِ ارائه‌های
// هر سشن به ترتیب شمارهٔ دانشجویی، صندلی ۱..n در سالن اولِ جادار.
func (s *Service) GenerateExamSeats(ctx context.Context, user *session.User, uniCookie string) (int, int, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return 0, 0, errors.New("دانشگاه فعال مشخص نیست.")
	}
	var termID int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select id from academic_terms where "isCurrent" = 1 and "universityId" = $1 order by id desc limit 1`, *uniID).
		Scan(&termID); err != nil {
		return 0, 0, errors.New("ترم جاری تعریف نشده است.")
	}
	srows, err := s.DB.Pool.Query(ctx, `
		select id, "termId", "examDate", "startTime", "endTime" from exam_sessions
		 where "termId" = $1 and ("universityId" = $2 or "universityId" is null)
		 order by "examDate", "startTime"`, termID, *uniID)
	if err != nil {
		return 0, 0, err
	}
	sessions := []ExamSession{}
	for srows.Next() {
		var es ExamSession
		if err := srows.Scan(&es.ID, &es.TermID, &es.ExamDate, &es.StartTime, &es.EndTime); err == nil {
			sessions = append(sessions, es)
		}
	}
	srows.Close()
	if len(sessions) == 0 {
		return 0, 0, errors.New("هیچ سشن امتحانی تعریف نشده است؛ ابتدا سشن بسازید.")
	}
	halls, err := s.GetExamsHallsOnly(ctx, uniID)
	if err != nil {
		return 0, 0, err
	}
	if len(halls) == 0 {
		return 0, 0, errors.New("هیچ سالنی ثبت نشده است؛ ابتدا سالن امتحان بسازید.")
	}
	allocated := 0
	sessionCount := 0
	for _, es := range sessions {
		// ارائه‌های این سشن بر اساس تطبیق تاریخ/ساعت.
		offRows, err := s.DB.Pool.Query(ctx, `
			select o.id from schedules sc
			  join course_offerings o on o.id = sc."offeringId"
			 where o."termId" = $1 and sc."scheduleType" = 'EXAM'
			   and replace(sc."examDate"::text,'-','/') = $2 and left(sc."startTime"::text,5) = $3`, termID, es.ExamDate, es.StartTime)
		if err != nil {
			continue
		}
		offeringIDs := []int64{}
		for offRows.Next() {
			var oid int64
			if err := offRows.Scan(&oid); err == nil {
				offeringIDs = append(offeringIDs, oid)
			}
		}
		offRows.Close()
		if len(offeringIDs) == 0 {
			continue
		}
		// دانشجویان این ارائه‌ها.
		enRows, err := s.DB.Pool.Query(ctx, `
			select e.id from enrollments e
			  join students st on st.id = e."studentId"
			 where e."offeringId" = any($1) and e.status <> 'DROPPED'
			 order by st."studentCode"`, offeringIDs)
		if err != nil {
			continue
		}
		enrollmentIDs := []int64{}
		for enRows.Next() {
			var eid int64
			if err := enRows.Scan(&eid); err == nil {
				enrollmentIDs = append(enrollmentIDs, eid)
			}
		}
		enRows.Close()
		if len(enrollmentIDs) == 0 {
			continue
		}
		tx, err := s.DB.Pool.Begin(ctx)
		if err != nil {
			return 0, 0, err
		}
		_, _ = tx.Exec(ctx, `delete from seat_allocations where "sessionId" = $1`, es.ID)
		seat := 1
		hallIdx := 0
		for _, eid := range enrollmentIDs {
			if hallIdx >= len(halls) {
				break
			}
			hall := halls[hallIdx]
			if _, err := tx.Exec(ctx, `
				insert into seat_allocations ("enrollmentId","sessionId","hallId","seatNumber","universityId")
				values ($1,$2,$3,$4,$5)`,
				eid, es.ID, hall.ID, seat, *uniID); err != nil {
				tx.Rollback(ctx)
				return 0, 0, err
			}
			seat++
			allocated++
			if seat > hall.Capacity {
				hallIdx++
				seat = 1
			}
		}
		if err := tx.Commit(ctx); err != nil {
			return 0, 0, err
		}
		sessionCount++
	}
	return allocated, sessionCount, nil
}

func (s *Service) GetExamsHallsOnly(ctx context.Context, uniID *int64) ([]ExamHall, error) {
	halls := []ExamHall{}
	hrows, err := s.DB.Pool.Query(ctx, `
		select id, name, coalesce("totalCapacity",0), "rowsCount", "colsCount", "buildingName"
		  from exam_halls where "universityId" = $1 order by name`, *uniID)
	if err != nil {
		return nil, err
	}
	defer hrows.Close()
	for hrows.Next() {
		var h ExamHall
		if err := hrows.Scan(&h.ID, &h.Name, &h.Capacity, &h.RowsCount, &h.ColsCount, &h.Building); err == nil {
			halls = append(halls, h)
		}
	}
	return halls, nil
}
