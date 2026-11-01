// ═══ Offerings and weekly schedule — port of group-manager/offerings ═══
package groupmanager

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// TermInfo is the current term.
type TermInfo struct {
	ID    *int64 `json:"id"`
	Title string `json:"title"`
}

// OfferingRow is an offering with details.
type OfferingRow struct {
	ID                  int64      `json:"id"`
	CourseID            int64      `json:"courseId"`
	Code                string     `json:"code"`
	Title               string     `json:"title"`
	GroupNumber         int        `json:"groupNumber"`
	Capacity            int        `json:"capacity"`
	WaitlistCapacity    int        `json:"waitlistCapacity"`
	EnrolledCount       int        `json:"enrolledCount"`
	ProfessorID         *int64     `json:"professorId"`
	ProfessorName       *string    `json:"professorName"`
	TargetDegreeLevelID *int64     `json:"targetDegreeLevelId"`
	TargetMajorID       *int64     `json:"targetMajorId"`
	EntryYearStart      *int       `json:"entryYearStart"`
	EntryYearEnd        *int       `json:"entryYearEnd"`
	Schedules           []Schedule `json:"schedules"`
}

// Schedule is a weekly session.
type Schedule struct {
	ID       int64   `json:"id"`
	Day      *int    `json:"dayOfWeek"`
	Start    string  `json:"startTime"`
	End      string  `json:"endTime"`
	RoomID   *int64  `json:"roomId"`
	RoomName *string `json:"roomName"`
}

// OfferingOption is a professor/room option.
type OfferingOption struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// DegreeOption is a degree level.
type DegreeOption struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

// MajorOption is a major.
type MajorOption struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// OfferingsData is the page response.
type OfferingsData struct {
	Term         TermInfo         `json:"term"`
	DeptName     string           `json:"deptName"`
	Courses      []CourseOption   `json:"courses"`
	Offerings    []OfferingRow    `json:"offerings"`
	Professors   []OfferingOption `json:"professors"`
	Rooms        []OfferingOption `json:"rooms"`
	Degrees      []DegreeOption   `json:"degrees"`
	Majors       []MajorOption    `json:"majors"`
	RequireChart bool             `json:"requireChart"`
}

// CourseOption is an offerable course.
type CourseOption struct {
	ID    int64  `json:"id"`
	Code  string `json:"code"`
	Title string `json:"title"`
}

func (s *Service) currentTerm(ctx context.Context, c *Ctx) TermInfo {
	info := TermInfo{}
	if c.Staff.UniversityID == nil {
		return info
	}
	var id int64
	var title string
	if err := s.DB.Pool.QueryRow(ctx, `
		select id, title from academic_terms where "isCurrent" = 1 and "universityId" = $1
		 order by id desc limit 1`, *c.Staff.UniversityID).Scan(&id, &title); err == nil {
		info.ID = &id
		info.Title = title
	}
	return info
}

// ListOfferings ports group-manager/offerings.
func (s *Service) ListOfferings(ctx context.Context, c *Ctx) (*OfferingsData, error) {
	resp := &OfferingsData{
		Term: s.currentTerm(ctx, c), Courses: []CourseOption{}, Offerings: []OfferingRow{},
		Professors: []OfferingOption{}, Rooms: []OfferingOption{}, Degrees: []DegreeOption{}, Majors: []MajorOption{},
	}
	_ = s.DB.Pool.QueryRow(ctx, `select name from departments where id = $1`, c.Dept.ID).Scan(&resp.DeptName)
	if s.Settings != nil {
		resp.RequireChart = s.Settings.GetBool(ctx, "ENROLL_REQUIRE_CURRICULUM_CHART")
	}
	crows, err := s.DB.Pool.Query(ctx, `select id, code, title from courses where "departmentId" = $1 order by code`, c.Dept.ID)
	if err == nil {
		for crows.Next() {
			var x CourseOption
			if err := crows.Scan(&x.ID, &x.Code, &x.Title); err == nil {
				resp.Courses = append(resp.Courses, x)
			}
		}
		crows.Close()
	}
	prows, err := s.DB.Pool.Query(ctx, `
		select st.id, coalesce(u."firstName" || ' ' || u."lastName",'')
		  from staff st join users u on u.id = st."userId"
		 where st."departmentId" = $1 and coalesce(st."isActive",1) = 1 order by u."lastName"`, c.Dept.ID)
	if err == nil {
		for prows.Next() {
			var x OfferingOption
			if err := prows.Scan(&x.ID, &x.Name); err == nil {
				resp.Professors = append(resp.Professors, x)
			}
		}
		prows.Close()
	}
	if c.Staff.UniversityID != nil {
		rrows, err := s.DB.Pool.Query(ctx, `
			select id, name from classrooms
			 where "universityId" = $1 and coalesce("isActive",1) = 1 order by name`, *c.Staff.UniversityID)
		if err == nil {
			for rrows.Next() {
				var x OfferingOption
				if err := rrows.Scan(&x.ID, &x.Name); err == nil {
					resp.Rooms = append(resp.Rooms, x)
				}
			}
			rrows.Close()
		}
	}
	drows, err := s.DB.Pool.Query(ctx, `select id, title from degree_level_configs order by id`)
	if err == nil {
		for drows.Next() {
			var x DegreeOption
			if err := drows.Scan(&x.ID, &x.Title); err == nil {
				resp.Degrees = append(resp.Degrees, x)
			}
		}
		drows.Close()
	}
	mrows, err := s.DB.Pool.Query(ctx, `select id, name from majors order by name`)
	if err == nil {
		for mrows.Next() {
			var x MajorOption
			if err := mrows.Scan(&x.ID, &x.Name); err == nil {
				resp.Majors = append(resp.Majors, x)
			}
		}
		mrows.Close()
	}

	if resp.Term.ID == nil || len(resp.Courses) == 0 {
		return resp, nil
	}
	courseIDs := []int64{}
	for _, cc := range resp.Courses {
		courseIDs = append(courseIDs, cc.ID)
	}
	orows, err := s.DB.Pool.Query(ctx, `
		select o.id, o."courseId", c.code, c.title, coalesce(o."groupNumber",0), o.capacity,
		       coalesce(o."waitlistCapacity",0), coalesce(o."enrolledCount",0), o."professorId",
		       coalesce(u."firstName" || ' ' || u."lastName",''),
		       o."targetDegreeLevelId", o."targetMajorId", o."entryYearStart", o."entryYearEnd"
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		 where o."termId" = $1 and o."isActive" = 1 and o."courseId" = any($2)
		 order by c.title, o."groupNumber"`, *resp.Term.ID, courseIDs)
	if err != nil {
		return nil, err
	}
	offeringIDs := []int64{}
	for orows.Next() {
		var o OfferingRow
		var profName *string
		if err := orows.Scan(&o.ID, &o.CourseID, &o.Code, &o.Title, &o.GroupNumber, &o.Capacity,
			&o.WaitlistCapacity, &o.EnrolledCount, &o.ProfessorID, &profName,
			&o.TargetDegreeLevelID, &o.TargetMajorID, &o.EntryYearStart, &o.EntryYearEnd); err == nil {
			if profName != nil && strings.TrimSpace(*profName) != "" {
				v := strings.TrimSpace(*profName)
				o.ProfessorName = &v
			}
			o.Schedules = []Schedule{}
			resp.Offerings = append(resp.Offerings, o)
			offeringIDs = append(offeringIDs, o.ID)
		}
	}
	orows.Close()

	if len(offeringIDs) > 0 {
		srows, err := s.DB.Pool.Query(ctx, `
			select s.id, s."offeringId", s."dayOfWeek", s."startTime"::text, s."endTime"::text,
			       s."roomId", cr.name
			  from schedules s left join classrooms cr on cr.id = s."roomId"
			 where s."offeringId" = any($1) and s."scheduleType" = 'CLASS'
			 order by s."offeringId", s."dayOfWeek"`, offeringIDs)
		if err == nil {
			byOffering := map[int64][]Schedule{}
			for srows.Next() {
				var sid, oid int64
				var day *int
				var start, end string
				var roomID *int64
				var roomName *string
				if err := srows.Scan(&sid, &oid, &day, &start, &end, &roomID, &roomName); err == nil {
					byOffering[oid] = append(byOffering[oid], Schedule{
						ID: sid, Day: day, Start: clock5(start), End: clock5(end), RoomID: roomID, RoomName: roomName,
					})
				}
			}
			srows.Close()
			for i := range resp.Offerings {
				if list, ok := byOffering[resp.Offerings[i].ID]; ok {
					resp.Offerings[i].Schedules = list
				}
			}
		}
	}
	return resp, nil
}

func clock5(v string) string {
	if len(v) >= 5 {
		return v[:5]
	}
	return v
}

// SaveOffering is the create/edit offering input.
type SaveOffering struct {
	ID             *int64 `json:"id"`
	CourseID       int64  `json:"courseId"`
	TermID         int64  `json:"termId"`
	Group          int    `json:"group"`
	Capacity       int    `json:"capacity"`
	WaitCapacity   int    `json:"waitCapacity"`
	ProfessorID    *int64 `json:"professorId"`
	TargetDegree   *int64 `json:"targetDegreeLevelId"`
	TargetMajor    *int64 `json:"targetMajorId"`
	EntryYearStart *int   `json:"entryYearStart"`
	EntryYearEnd   *int   `json:"entryYearEnd"`
}

func validateEntryRange(ys, ye *int) error {
	if ys != nil && ye != nil && *ys > *ye {
		return fmt.Errorf("بازهٔ سال ورودی نامعتبر است: سال شروع (%d) بعد از سال پایان (%d) است", *ys, *ye)
	}
	return nil
}

func (s *Service) offeringInDept(ctx context.Context, offeringID int64, c *Ctx) (int64, bool) {
	var courseID int64
	if err := s.DB.Pool.QueryRow(ctx, `select "courseId" from course_offerings where id = $1`, offeringID).Scan(&courseID); err != nil {
		return 0, false
	}
	return courseID, s.courseInDept(ctx, courseID, c)
}

func (s *Service) professorOK(ctx context.Context, c *Ctx, professorID *int64) bool {
	if professorID == nil {
		return true
	}
	var uni *int64
	var active *int
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId", "isActive" from staff where id = $1`, *professorID).Scan(&uni, &active); err != nil {
		return false
	}
	if active != nil && *active == 0 {
		return false
	}
	return (uni == nil && c.Staff.UniversityID == nil) || (uni != nil && c.Staff.UniversityID != nil && *uni == *c.Staff.UniversityID)
}

func (s *Service) duplicateOffering(ctx context.Context, termID, courseID int64, group int, excludeID *int64) bool {
	q := `select id from course_offerings where "termId" = $1 and "courseId" = $2 and "groupNumber" = $3 and "isActive" = 1`
	args := []any{termID, courseID, group}
	if excludeID != nil {
		q += ` and id <> $4`
		args = append(args, *excludeID)
	}
	var id int64
	return s.DB.Pool.QueryRow(ctx, q+" limit 1", args...).Scan(&id) == nil
}

// CreateOffering ports createOfferingAction.
func (s *Service) CreateOffering(ctx context.Context, c *Ctx, in SaveOffering) error {
	if in.CourseID <= 0 || !s.courseInDept(ctx, in.CourseID, c) {
		return errors.New("درس انتخاب‌شده متعلق به گروه شما نیست.")
	}
	if in.Capacity <= 0 {
		return errors.New("ظرفیت باید مثبت باشد.")
	}
	if in.TermID <= 0 {
		return errors.New("ترم جاری یافت نشد.")
	}
	if !s.professorOK(ctx, c, in.ProfessorID) {
		return errors.New("استاد انتخاب‌شده در این دانشگاه یافت نشد.")
	}
	if err := validateEntryRange(in.EntryYearStart, in.EntryYearEnd); err != nil {
		return err
	}
	requireChart := true
	if s.Settings != nil {
		requireChart = s.Settings.GetBool(ctx, "ENROLL_REQUIRE_CURRICULUM_CHART")
	}
	if !requireChart {
		if in.TargetMajor == nil {
			return errors.New("چون چارت تحصیلی در انتخاب واحد الزامی نیست، باید «رشتهٔ مجاز» هر ارائه مشخص شود.")
		}
		if in.EntryYearStart == nil {
			return errors.New("چون چارت تحصیلی الزامی نیست، باید «ورودی مجاز از» هر ارائه مشخص شود.")
		}
	}
	group := in.Group
	if group <= 0 {
		group = 1
	}
	if s.duplicateOffering(ctx, in.TermID, in.CourseID, group, nil) {
		return errors.New("این درس با همین گروه در ترم جاری قبلاً ارائه شده است.")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		insert into course_offerings ("termId","courseId","groupNumber",capacity,"waitlistCapacity",
		       "professorId","targetDegreeLevelId","targetMajorId","entryYearStart","entryYearEnd","universityId","isActive")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)`,
		in.TermID, in.CourseID, group, in.Capacity, in.WaitCapacity, in.ProfessorID,
		in.TargetDegree, in.TargetMajor, in.EntryYearStart, in.EntryYearEnd, c.Staff.UniversityID)
	return err
}

// UpdateOffering ports updateOfferingAction.
func (s *Service) UpdateOffering(ctx context.Context, c *Ctx, in SaveOffering) error {
	if in.ID == nil {
		return errors.New("ارائه نامعتبر است.")
	}
	if _, ok := s.offeringInDept(ctx, *in.ID, c); !ok {
		return errors.New("این ارائه متعلق به گروه شما نیست.")
	}
	var (
		curTerm, curCourse, enrolled int64
	)
	_ = s.DB.Pool.QueryRow(ctx, `select "termId","courseId",coalesce("enrolledCount",0) from course_offerings where id = $1`, *in.ID).
		Scan(&curTerm, &curCourse, &enrolled)
	if int64(in.Capacity) < enrolled {
		return fmt.Errorf("ظرفیت نمی‌تواند کمتر از ثبت‌نام‌های انجام‌شده (%d) باشد.", enrolled)
	}
	if !s.professorOK(ctx, c, in.ProfessorID) {
		return errors.New("استاد انتخاب‌شده در این دانشگاه یافت نشد.")
	}
	if err := validateEntryRange(in.EntryYearStart, in.EntryYearEnd); err != nil {
		return err
	}
	requireChart := true
	if s.Settings != nil {
		requireChart = s.Settings.GetBool(ctx, "ENROLL_REQUIRE_CURRICULUM_CHART")
	}
	if !requireChart {
		if in.TargetMajor == nil {
			return errors.New("چون چارت تحصیلی در انتخاب واحد الزامی نیست، باید «رشتهٔ مجاز» هر ارائه مشخص شود.")
		}
		if in.EntryYearStart == nil {
			return errors.New("چون چارت تحصیلی الزامی نیست، باید «ورودی مجاز از» هر ارائه مشخص شود.")
		}
	}
	group := in.Group
	if group <= 0 {
		group = 1
	}
	exclude := *in.ID
	if s.duplicateOffering(ctx, curTerm, curCourse, group, &exclude) {
		return errors.New("این درس با همین گروه در ترم جاری قبلاً ارائه شده است.")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		update course_offerings set capacity = $1, "waitlistCapacity" = $2, "groupNumber" = $3,
		       "professorId" = $4, "targetDegreeLevelId" = $5, "targetMajorId" = $6,
		       "entryYearStart" = $7, "entryYearEnd" = $8
		 where id = $9`,
		in.Capacity, in.WaitCapacity, group, in.ProfessorID, in.TargetDegree,
		in.TargetMajor, in.EntryYearStart, in.EntryYearEnd, *in.ID)
	return err
}

// DeactivateOffering ports deactivateOfferingAction.
func (s *Service) DeactivateOffering(ctx context.Context, c *Ctx, offeringID int64) (string, error) {
	if _, ok := s.offeringInDept(ctx, offeringID, c); !ok {
		return "", errors.New("این ارائه متعلق به گروه شما نیست.")
	}
	var enrolled int
	_ = s.DB.Pool.QueryRow(ctx, `select coalesce("enrolledCount",0) from course_offerings where id = $1`, offeringID).Scan(&enrolled)
	_, _ = s.DB.Pool.Exec(ctx, `delete from cart_items where "offeringId" = $1`, offeringID)
	if enrolled > 0 {
		_, err := s.DB.Pool.Exec(ctx, `update course_offerings set "isActive" = 0 where id = $1`, offeringID)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("ارائه دارای %d ثبت‌نام است → غیرفعال شد (حذف نشد).", enrolled), nil
	}
	if _, err := s.DB.Pool.Exec(ctx, `delete from schedules where "offeringId" = $1`, offeringID); err != nil {
		return "", err
	}
	if _, err := s.DB.Pool.Exec(ctx, `delete from course_offerings where id = $1`, offeringID); err != nil {
		return "", err
	}
	return "ارائه بدون ثبت‌نام بود → کاملاً حذف شد.", nil
}

// ScheduleInput is the schedule input.
type ScheduleInput struct {
	OfferingID int64  `json:"offeringId"`
	ScheduleID *int64 `json:"scheduleId"`
	Day        int    `json:"day"`
	Start      string `json:"start"`
	End        string `json:"end"`
	RoomID     *int64 `json:"roomId"`
}

func hm(v string) (int, bool) {
	var h, m int
	if _, err := fmt.Sscanf(strings.TrimSpace(v), "%d:%d", &h, &m); err != nil {
		return 0, false
	}
	if h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, false
	}
	return h*60 + m, true
}

// AddSchedule ports addScheduleAction (with room, professor and conflict guards).
func (s *Service) AddSchedule(ctx context.Context, c *Ctx, in ScheduleInput) (string, error) {
	if _, ok := s.offeringInDept(ctx, in.OfferingID, c); !ok {
		return "", errors.New("این ارائه متعلق به گروه شما نیست.")
	}
	st, ok1 := hm(in.Start)
	en, ok2 := hm(in.End)
	if !ok1 || !ok2 {
		return "", errors.New("ساعت شروع و پایان الزامی است.")
	}
	if en <= st {
		return "", errors.New("ساعت پایان باید بعد از شروع باشد.")
	}
	var (
		termID      int64
		professorID *int64
		capacity    int
	)
	if err := s.DB.Pool.QueryRow(ctx, `select "termId","professorId",capacity from course_offerings where id = $1`, in.OfferingID).
		Scan(&termID, &professorID, &capacity); err != nil {
		return "", errors.New("این ارائه متعلق به گروه شما نیست.")
	}
	var roomCapacity *int
	if in.RoomID != nil {
		var uni *int64
		var cap *int
		if err := s.DB.Pool.QueryRow(ctx, `select "universityId", capacity from classrooms where id = $1`, *in.RoomID).Scan(&uni, &cap); err != nil {
			return "", errors.New("سالن نامعتبر است.")
		}
		allowed := uni == nil || (c.Staff.UniversityID != nil && *uni == *c.Staff.UniversityID)
		if !allowed {
			return "", errors.New("این سالن متعلق به دانشگاه دیگری است.")
		}
		roomCapacity = cap
	}

	// Conflict with other offerings in the term.
	rows, err := s.DB.Pool.Query(ctx, `
		select s."dayOfWeek", s."startTime"::text, s."endTime"::text, s."roomId", o."professorId", c2.title
		  from schedules s
		  join course_offerings o on o.id = s."offeringId"
		  join courses c2 on c2.id = o."courseId"
		 where o."termId" = $1 and s."offeringId" <> $2 and s."scheduleType" = 'CLASS'`, termID, in.OfferingID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	for rows.Next() {
		var day *int
		var start, end string
		var roomID, profID *int64
		var title string
		if err := rows.Scan(&day, &start, &end, &roomID, &profID, &title); err != nil {
			continue
		}
		if day == nil || *day != in.Day {
			continue
		}
		s1, ok1 := hm(start)
		e1, ok2 := hm(end)
		if !ok1 || !ok2 || !(st < e1 && s1 < en) {
			continue
		}
		if in.RoomID != nil && roomID != nil && *roomID == *in.RoomID {
			return "", errors.New("تداخل سالن: این سالن در همین روز و ساعت برای ارائهٔ دیگری رزرو شده است.")
		}
		if professorID != nil && profID != nil && *profID == *professorID {
			return "", errors.New("تداخل استاد: استاد این ارائه در همین روز و ساعت کلاس دیگری دارد.")
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		insert into schedules ("offeringId","scheduleType","dayOfWeek","startTime","endTime","roomId","universityId")
		values ($1,'CLASS',$2,$3,$4,$5,$6)`,
		in.OfferingID, in.Day, in.Start, in.End, in.RoomID, c.Staff.UniversityID); err != nil {
		return "", err
	}
	if roomCapacity != nil && *roomCapacity < capacity {
		return fmt.Sprintf("برنامهٔ هفتگی ثبت شد. ⚠ توجه: ظرفیت سالن (%d) کمتر از ظرفیت ارائه (%d) است.", *roomCapacity, capacity), nil
	}
	return "برنامهٔ هفتگی ثبت شد.", nil
}

// DeleteSchedule ports deleteScheduleAction.
func (s *Service) DeleteSchedule(ctx context.Context, c *Ctx, scheduleID int64) error {
	var offeringID int64
	if err := s.DB.Pool.QueryRow(ctx, `select "offeringId" from schedules where id = $1`, scheduleID).Scan(&offeringID); err != nil {
		return errors.New("این برنامه متعلق به گروه شما نیست.")
	}
	if _, ok := s.offeringInDept(ctx, offeringID, c); !ok {
		return errors.New("این برنامه متعلق به گروه شما نیست.")
	}
	_, err := s.DB.Pool.Exec(ctx, `delete from schedules where id = $1`, scheduleID)
	return err
}
