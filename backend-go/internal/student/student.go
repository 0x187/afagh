// ═══ سرویس دادهٔ پرتال دانشجو (فاز ۳) ═══
//
// رفع پروندهٔ دانشجو و برنامهٔ هفتگی — پورت student/schedule/page.tsx و
// getStudentByUser. قاعدهٔ انتخاب پرونده: ACTIVE اول، سپس جدیدترین (id desc).
package student

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/scope"
	"backend-go/internal/verification"
)

// Record پروندهٔ دانشجو.
type Record struct {
	ID            int64
	UserID        int64
	StudentCode   string
	UniversityID  *int64
	MajorID       *int64
	DegreeLevelID *int64
	RegulationID  *int64
	EntryYear     int
	EntryTerm     *int
	CurrentTermNo *int
	Status        string
	StudyType     *string
}

var errNoStudent = errors.New("پروندهٔ دانشجویی یافت نشد.")

// Settings حداقل وابستگی تنظیمات برای TTL توکن‌ها.
type Settings interface {
	Get(ctx context.Context, key string) (string, error)
	GetNumber(ctx context.Context, key string, fallback float64) float64
}

// Service دسترسی به دادهٔ دانشجو.
type Service struct {
	Pool     *pgxpool.Pool
	Scope    *scope.Service
	Settings Settings
	Signer   *verification.Signer
}

func New(pool *pgxpool.Pool, scopeSvc *scope.Service, settings Settings, signer *verification.Signer) *Service {
	return &Service{Pool: pool, Scope: scopeSvc, Settings: settings, Signer: signer}
}

func expiresAtISO(ttlSec int) string {
	return time.Now().Add(time.Duration(ttlSec) * time.Second).UTC().Format(time.RFC3339)
}

// Resolve پورت getStudentByUser: ACTIVE اول، بعد جدیدترین.
func (s *Service) Resolve(ctx context.Context, userID int64) (*Record, error) {
	var r Record
	err := s.Pool.QueryRow(ctx, `
		select id, "userId", "studentCode", "universityId", "majorId", "degreeLevelId",
		       "regulationId", "entryYear", "entryTerm", "currentTermNo", status,
		       "studyType"
		  from students
		 where "userId" = $1
		 order by case when status = 'ACTIVE' then 0 else 1 end, id desc
		 limit 1`, userID).
		Scan(&r.ID, &r.UserID, &r.StudentCode, &r.UniversityID, &r.MajorID, &r.DegreeLevelID,
			&r.RegulationID, &r.EntryYear, &r.EntryTerm, &r.CurrentTermNo, &r.Status,
			&r.StudyType)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// ClassSlot یک جلسهٔ هفتگی کلاس.
type ClassSlot struct {
	DayOfWeek *int   `json:"dayOfWeek"`
	DayName   string `json:"dayName"`
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime"`
	Room      string `json:"room"`
	Building  string `json:"building"`
	WeekType  string `json:"weekType"`
}

// ExamSlot زمان/سالن امتحان.
type ExamSlot struct {
	ExamDate  string `json:"examDate"`
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime"`
	Room      string `json:"room"`
}

// Course درس ثبت‌نام‌شده به‌همراه جلسات.
type Course struct {
	EnrollmentID           int64       `json:"enrollmentId"`
	OfferingID             int64       `json:"offeringId"`
	Code                   string      `json:"code"`
	Title                  string      `json:"title"`
	Units                  int         `json:"units"`
	CourseType             string      `json:"courseType"`
	Group                  int         `json:"group"`
	Status                 string      `json:"status"`
	Professor              string      `json:"professor"`
	EnrolledCount          *int        `json:"enrolledCount"`
	Capacity               *int        `json:"capacity"`
	SharedScheduleGroupKey *string     `json:"sharedScheduleGroupKey"`
	Classes                []ClassSlot `json:"classes"`
	Exam                   *ExamSlot   `json:"exam"`
}

// StudentInfo اطلاعات نمایشی دانشجو.
type StudentInfo struct {
	Name          string `json:"name"`
	StudentCode   string `json:"studentCode"`
	MajorName     string `json:"majorName"`
	DegreeTitle   string `json:"degreeTitle"`
	CurrentTermNo int    `json:"currentTermNo"`
	EntryYear     int    `json:"entryYear"`
}

// TermInfo اطلاعات ترم نمایشی.
type TermInfo struct {
	ID       *int64 `json:"id"`
	Title    string `json:"title"`
	TermCode string `json:"termCode"`
}

// UniversityInfo اطلاعات دانشگاه.
type UniversityInfo struct {
	Title   string  `json:"title"`
	LogoURL *string `json:"logoUrl"`
}

// ScheduleResponse پاسخ برنامهٔ هفتگی.
type ScheduleResponse struct {
	Student    StudentInfo    `json:"student"`
	Term       TermInfo       `json:"term"`
	University UniversityInfo `json:"university"`
	Courses    []Course       `json:"courses"`
	WeekFilter []string       `json:"weekFilters"`
}

var dayNames = []string{"شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"}

func classWeekType(scheduleType *string) string {
	if scheduleType == nil {
		return "ALL"
	}
	switch strings.ToUpper(*scheduleType) {
	case "EVEN":
		return "EVEN"
	case "ODD":
		return "ODD"
	}
	return "ALL"
}

func clock5(v string) string {
	if len(v) >= 5 {
		return v[:5]
	}
	return v
}

// describeStudent اطلاعات نمایشی دانشجو + ترم مؤثر را می‌سازد. مشترک بین
// برنامهٔ هفتگی، داشبورد و کارنامه تا هر سه یک ترم و یک عنوان ببینند.
func (s *Service) describeStudent(ctx context.Context, me *Record, userName string, termCookie *int64) (StudentInfo, *int64, string, string) {
	selection := s.Scope.GetTermScope(ctx, me.UniversityID, termCookie)
	termID := selection.EffectiveID
	if selection.SelectedID != nil {
		termID = selection.SelectedID
	}
	var termTitle, termCode string
	if termID != nil {
		_ = s.Pool.QueryRow(ctx, `select title, "termCode" from academic_terms where id = $1`, *termID).
			Scan(&termTitle, &termCode)
	}

	// شمارهٔ ترم بر مبنای ورودی (نه ستون currentTermNo).
	var ordinal *int
	if termID != nil && termCode != "" {
		ordinal = scope.TermOrdinalForEntry(&me.EntryYear, me.EntryTerm, termCode)
	}

	majorName, degreeTitle := "مهندسی کامپیوتر", "کارشناسی پیوسته"
	if me.MajorID != nil {
		var v string
		if err := s.Pool.QueryRow(ctx, `select name from majors where id = $1`, *me.MajorID).Scan(&v); err == nil {
			majorName = v
		}
	}
	if me.DegreeLevelID != nil {
		var v string
		if err := s.Pool.QueryRow(ctx, `select title from degree_level_configs where id = $1`, *me.DegreeLevelID).Scan(&v); err == nil {
			degreeTitle = v
		}
	}

	termNo := 1
	if ordinal != nil {
		termNo = *ordinal
	} else if me.CurrentTermNo != nil && *me.CurrentTermNo > 0 {
		termNo = *me.CurrentTermNo
	}
	return StudentInfo{
		Name: userName, StudentCode: me.StudentCode,
		MajorName: majorName, DegreeTitle: degreeTitle,
		CurrentTermNo: termNo, EntryYear: me.EntryYear,
	}, termID, termTitle, termCode
}

// universityInfo عنوان/آرم دانشگاه دانشجو (با پشتوانهٔ نام پیش‌فرض سامانه).
func (s *Service) universityInfo(ctx context.Context, universityID *int64) UniversityInfo {
	info := UniversityInfo{Title: "دانشگاه آفاق"}
	if universityID == nil {
		return info
	}
	var title string
	var logo *string
	if err := s.Pool.QueryRow(ctx, `select title, "logoUrl" from universities where id = $1`, *universityID).
		Scan(&title, &logo); err == nil {
		if title != "" {
			info.Title = title
		}
		info.LogoURL = logo
	}
	return info
}

// GetSchedule پورت student/schedule/page.tsx.
func (s *Service) GetSchedule(ctx context.Context, userID int64, userName string, termCookie *int64) (*ScheduleResponse, error) {
	me, err := s.Resolve(ctx, userID)
	if err != nil {
		return nil, err
	}
	if me == nil {
		return nil, errNoStudent
	}

	info, termID, termTitle, termCode := s.describeStudent(ctx, me, userName, termCookie)
	resp := &ScheduleResponse{
		Student:    info,
		Term:       TermInfo{ID: termID, Title: termTitle, TermCode: termCode},
		University: s.universityInfo(ctx, me.UniversityID),
		Courses:    []Course{},
		WeekFilter: []string{"ALL", "EVEN", "ODD"},
	}
	if termTitle == "" {
		resp.Term.Title = "نیمسال نامشخص"
	}
	if termCode == "" {
		resp.Term.TermCode = "—"
	}

	if termID == nil {
		return resp, nil
	}

	// ثبت‌نام‌های ترم با جلسات.
	rows, err := s.Pool.Query(ctx, `
		select e.id, e."offeringId", e.status,
		       o."courseId", c.code, c.title, coalesce(c.units, 0)::int,
		       coalesce(c."courseType", 'تخصصی'), o."groupNumber",
		       o."professorId", o."enrolledCount", o.capacity, o."sharedScheduleGroupKey"
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1 and o."termId" = $2
		   and e.status in ('REGISTERED','FINALIZED','WAITLISTED','PENDING_COUNCIL')
		 order by c.title`, me.ID, *termID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type pending struct {
		course      Course
		courseID    int64
		professorID *int64
	}
	list := []pending{}
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.course.EnrollmentID, &p.course.OfferingID, &p.course.Status,
			&p.courseID, &p.course.Code, &p.course.Title, &p.course.Units,
			&p.course.CourseType, &p.course.Group, &p.professorID,
			&p.course.EnrolledCount, &p.course.Capacity, &p.course.SharedScheduleGroupKey); err != nil {
			return nil, err
		}
		p.course.Classes = []ClassSlot{}
		p.course.Professor = "نامشخص"
		list = append(list, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// نام استادها.
	profNames := map[int64]string{}
	profIDs := []int64{}
	for _, p := range list {
		if p.professorID != nil {
			profIDs = append(profIDs, *p.professorID)
		}
	}
	if len(profIDs) > 0 {
		prows, err := s.Pool.Query(ctx, `
			select st.id, u."firstName", u."lastName"
			  from staff st join users u on u.id = st."userId"
			 where st.id = any($1)`, profIDs)
		if err == nil {
			for prows.Next() {
				var id int64
				var fn, ln string
				if err := prows.Scan(&id, &fn, &ln); err == nil {
					profNames[id] = strings.TrimSpace(fn + " " + ln)
				}
			}
			prows.Close()
		}
	}

	// جلسات کلاس/امتحان.
	offeringIDs := []int64{}
	for _, p := range list {
		offeringIDs = append(offeringIDs, p.course.OfferingID)
	}
	classMap := map[int64][]ClassSlot{}
	examMap := map[int64]*ExamSlot{}
	if len(offeringIDs) > 0 {
		srows, err := s.Pool.Query(ctx, `
			select sc."offeringId", sc."scheduleType", sc."dayOfWeek", sc."examDate"::text,
			       sc."startTime"::text, sc."endTime"::text, cr.name, cr."buildingName"
			  from schedules sc
			  join course_offerings o on o.id = sc."offeringId"
			  left join classrooms cr on cr.id = sc."roomId"
			 where o."termId" = $1 and sc."offeringId" = any($2)`, *termID, offeringIDs)
		if err != nil {
			return nil, err
		}
		for srows.Next() {
			var offeringID int64
			var scheduleType, startTime, endTime *string
			var dayOfWeek *int
			var examDate *string
			var roomName, buildingName *string
			if err := srows.Scan(&offeringID, &scheduleType, &dayOfWeek, &examDate,
				&startTime, &endTime, &roomName, &buildingName); err != nil {
				srows.Close()
				return nil, err
			}
			st, et := "", ""
			if startTime != nil {
				st = clock5(*startTime)
			}
			if endTime != nil {
				et = clock5(*endTime)
			}
			if scheduleType != nil && strings.ToUpper(*scheduleType) == "EXAM" && examDate != nil {
				room := ""
				if roomName != nil {
					room = *roomName
				}
				examMap[offeringID] = &ExamSlot{ExamDate: *examDate, StartTime: st, EndTime: et, Room: room}
				continue
			}
			if dayOfWeek == nil {
				continue
			}
			name := fmt.Sprintf("روز %d", *dayOfWeek)
			if *dayOfWeek >= 0 && *dayOfWeek < len(dayNames) {
				name = dayNames[*dayOfWeek]
			}
			room, building := "", ""
			if roomName != nil {
				room = *roomName
			}
			if buildingName != nil {
				building = *buildingName
			}
			classMap[offeringID] = append(classMap[offeringID], ClassSlot{
				DayOfWeek: dayOfWeek, DayName: name,
				StartTime: st, EndTime: et, Room: room, Building: building,
				WeekType: classWeekType(scheduleType),
			})
		}
		srows.Close()
	}

	for _, p := range list {
		c := p.course
		if p.professorID != nil {
			if n, ok := profNames[*p.professorID]; ok && n != "" {
				c.Professor = n
			}
		}
		if cls, ok := classMap[c.OfferingID]; ok {
			c.Classes = cls
		}
		if ex, ok := examMap[c.OfferingID]; ok {
			c.Exam = ex
		}
		resp.Courses = append(resp.Courses, c)
	}
	return resp, nil
}
