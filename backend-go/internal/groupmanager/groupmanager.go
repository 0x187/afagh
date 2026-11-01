// ═══ Department head panel (phase 5) ═══
package groupmanager

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"backend-go/internal/db"
	"backend-go/internal/scope"
)

// Settings is the minimal settings.
type Settings interface {
	Get(ctx context.Context, key string) (string, error)
	GetNumber(ctx context.Context, key string, fallback float64) float64
	GetBool(ctx context.Context, key string) bool
}

// Service is the department head service.
type Service struct {
	DB       *db.DB
	Settings Settings
	Scope    *scope.Service
}

func New(database *db.DB, settings Settings, scopeSvc *scope.Service) *Service {
	return &Service{DB: database, Settings: settings, Scope: scopeSvc}
}

// Staff is the staff record.
type Staff struct {
	ID           int64
	UserID       int64
	StaffCode    string
	UniversityID *int64
	DepartmentID *int64
	Name         string
}

// Dept is the academic department.
type Dept struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
	Via  string `json:"via"`
}

// Ctx is the department head context.
type Ctx struct {
	Staff *Staff
	Depts []Dept
	Dept  Dept
}

var errNoStaff = errors.New("پروندهٔ کارمندی شما ساخته نشده است.")
var errNoDept = errors.New("پروندهٔ شما به گروه آموزشی وصل نیست.")

// Resolve ports requireDepHead.
func (s *Service) Resolve(ctx context.Context, userID int64, wantedDeptID *int64) (*Ctx, error) {
	var st Staff
	err := s.DB.Pool.QueryRow(ctx, `
		select st.id, st."userId", st."staffCode", st."universityId", st."departmentId",
		       coalesce(u."firstName" || ' ' || u."lastName",'')
		  from staff st join users u on u.id = st."userId"
		 where st."userId" = $1 limit 1`, userID).
		Scan(&st.ID, &st.UserID, &st.StaffCode, &st.UniversityID, &st.DepartmentID, &st.Name)
	if err != nil {
		return nil, errNoStaff
	}
	st.Name = strings.TrimSpace(st.Name)

	depts := []Dept{}
	// The headStaffId/kind/isActive columns are not present in all installations; when they are missing
	// we rely on staff membership (a safe behavior compatible with the current schema).
	rows, err := s.DB.Pool.Query(ctx, `
		select id, name from departments where "headStaffId" = $1 order by name`, st.ID)
	if err == nil {
		for rows.Next() {
			var d Dept
			if err := rows.Scan(&d.ID, &d.Name); err == nil {
				d.Kind = "ACADEMIC"
				d.Via = "HEAD"
				depts = append(depts, d)
			}
		}
		rows.Close()
	}
	if len(depts) == 0 && st.DepartmentID != nil {
		var d Dept
		if err := s.DB.Pool.QueryRow(ctx, `select id, name from departments where id = $1`, *st.DepartmentID).
			Scan(&d.ID, &d.Name); err == nil {
			d.Kind = "ACADEMIC"
			d.Via = "MEMBER"
			depts = []Dept{d}
		}
	}
	if len(depts) == 0 {
		return nil, errNoDept
	}
	active := depts[0]
	if wantedDeptID != nil {
		for _, d := range depts {
			if d.ID == *wantedDeptID {
				active = d
				break
			}
		}
	}
	return &Ctx{Staff: &st, Depts: depts, Dept: active}, nil
}

func (c *Ctx) deptIDs() []int64 {
	out := []int64{}
	for _, d := range c.Depts {
		out = append(out, d.ID)
	}
	return out
}

func (c *Ctx) hasDept(id int64) bool {
	for _, d := range c.Depts {
		if d.ID == id {
			return true
		}
	}
	return false
}

// Course is a department course.
type Course struct {
	ID               int64    `json:"id"`
	Code             string   `json:"code"`
	Title            string   `json:"title"`
	TheoreticalUnits *float64 `json:"theoreticalUnits"`
	PracticalUnits   *float64 `json:"practicalUnits"`
	Units            *float64 `json:"units"`
	CourseType       *string  `json:"courseType"`
	GradingType      *string  `json:"gradingType"`
	AffectsGpa       *int     `json:"affectsGpa"`
	LegacyMaliType   *int     `json:"legacyMaliType"`
}

// CoursesData is the courses page response.
type CoursesData struct {
	DeptName string   `json:"deptName"`
	Courses  []Course `json:"courses"`
}

// ListCourses ports group-manager/courses.
func (s *Service) ListCourses(ctx context.Context, c *Ctx) (*CoursesData, error) {
	var deptName string
	_ = s.DB.Pool.QueryRow(ctx, `select name from departments where id = $1`, c.Dept.ID).Scan(&deptName)
	rows, err := s.DB.Pool.Query(ctx, `
		select id, code, title, "theoreticalUnits", "practicalUnits", units,
		       "courseType", "gradingType", "affectsGpa", "legacyMaliType"
		  from courses where "departmentId" = $1 order by code`, c.Dept.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Course{}
	for rows.Next() {
		var x Course
		if err := rows.Scan(&x.ID, &x.Code, &x.Title, &x.TheoreticalUnits, &x.PracticalUnits,
			&x.Units, &x.CourseType, &x.GradingType, &x.AffectsGpa, &x.LegacyMaliType); err == nil {
			out = append(out, x)
		}
	}
	return &CoursesData{DeptName: deptName, Courses: out}, nil
}

// SaveCourse is the course input.
type SaveCourse struct {
	ID         *int64  `json:"id"`
	Code       string  `json:"code"`
	Title      string  `json:"title"`
	Theory     float64 `json:"theory"`
	Practical  float64 `json:"practical"`
	CourseType string  `json:"courseType"`
	Grading    string  `json:"grading"`
	AffectsGpa bool    `json:"affectsGpa"`
	MaliType   *int    `json:"maliType"`
}

// CreateCourse ports createCourseAction.
func (s *Service) CreateCourse(ctx context.Context, c *Ctx, in SaveCourse) error {
	in.Code = strings.TrimSpace(in.Code)
	in.Title = strings.TrimSpace(in.Title)
	if in.Code == "" || in.Title == "" {
		return errors.New("کد و عنوان درس الزامی است.")
	}
	if in.Theory < 0 || in.Practical < 0 || in.Theory+in.Practical == 0 {
		return errors.New("واحد درس نامعتبر است.")
	}
	if in.MaliType == nil {
		return errors.New("نوع درس مالی را انتخاب کنید.")
	}
	if *in.MaliType < 0 || *in.MaliType > 99 {
		return errors.New("نوع درس مالی نامعتبر است.")
	}
	var dup int64
	if err := s.DB.Pool.QueryRow(ctx, `select id from courses where code = $1 limit 1`, in.Code).Scan(&dup); err == nil {
		return errors.New("کد درس تکراری است: " + in.Code)
	}
	courseType := in.CourseType
	if courseType == "" {
		courseType = "تخصصی"
	}
	grading := in.Grading
	if grading == "" {
		grading = "NUMERIC"
	}
	affects := 0
	if in.AffectsGpa {
		affects = 1
	}
	_, err := s.DB.Pool.Exec(ctx, `
		insert into courses (code, title, "theoreticalUnits", "practicalUnits", units,
		       "courseType", "gradingType", "affectsGpa", "departmentId", "universityId", "legacyMaliType")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		in.Code, in.Title, fmt.Sprintf("%g", in.Theory), fmt.Sprintf("%g", in.Practical),
		fmt.Sprintf("%g", in.Theory+in.Practical), courseType, grading, affects,
		c.Dept.ID, c.Staff.UniversityID, *in.MaliType)
	return err
}

// UpdateCourse ports updateCourseAction.
func (s *Service) UpdateCourse(ctx context.Context, c *Ctx, in SaveCourse) error {
	if in.ID == nil || *in.ID <= 0 {
		return errors.New("درس نامعتبر است.")
	}
	if !s.courseInDept(ctx, *in.ID, c) {
		return errors.New("این درس متعلق به گروه شما نیست.")
	}
	if strings.TrimSpace(in.Code) == "" || strings.TrimSpace(in.Title) == "" {
		return errors.New("کد و عنوان درس الزامی است.")
	}
	if in.Theory < 0 || in.Practical < 0 || in.Theory+in.Practical == 0 {
		return errors.New("واحد درس نامعتبر است.")
	}
	courseType := in.CourseType
	if courseType == "" {
		courseType = "تخصصی"
	}
	grading := in.Grading
	if grading == "" {
		grading = "NUMERIC"
	}
	affects := 0
	if in.AffectsGpa {
		affects = 1
	}
	_, err := s.DB.Pool.Exec(ctx, `
		update courses set code = $1, title = $2, "theoreticalUnits" = $3, "practicalUnits" = $4,
		       units = $5, "courseType" = $6, "gradingType" = $7, "affectsGpa" = $8
		 where id = $9`,
		strings.TrimSpace(in.Code), strings.TrimSpace(in.Title), fmt.Sprintf("%g", in.Theory),
		fmt.Sprintf("%g", in.Practical), fmt.Sprintf("%g", in.Theory+in.Practical),
		courseType, grading, affects, *in.ID)
	return err
}

// DeleteCourse ports deleteCourseAction.
func (s *Service) DeleteCourse(ctx context.Context, c *Ctx, courseID int64) error {
	if !s.courseInDept(ctx, courseID, c) {
		return errors.New("این درس متعلق به گروه شما نیست.")
	}
	var offers int
	_ = s.DB.Pool.QueryRow(ctx, `select count(*) from course_offerings where "courseId" = $1`, courseID).Scan(&offers)
	if offers > 0 {
		return fmt.Errorf("حذف ممکن نیست — این درس %d ارائهٔ ثبت‌شده دارد. ابتدا ارائه را حذف/غیرفعال کنید.", offers)
	}
	_, err := s.DB.Pool.Exec(ctx, `delete from courses where id = $1`, courseID)
	return err
}

func (s *Service) courseInDept(ctx context.Context, courseID int64, c *Ctx) bool {
	var deptID *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "departmentId" from courses where id = $1`, courseID).Scan(&deptID); err != nil {
		return false
	}
	return deptID != nil && c.hasDept(*deptID)
}

// Classroom is a classroom.
type Classroom struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Code        *string `json:"code"`
	Capacity    int     `json:"capacity"`
	RoomType    *string `json:"roomType"`
	FacultyID   *int64  `json:"facultyId"`
	FacultyName *string `json:"facultyName"`
	Floor       *string `json:"floor"`
	RowsCount   *int    `json:"rowsCount"`
	ColsCount   *int    `json:"colsCount"`
	IsActive    int     `json:"isActive"`
}

// ClassroomsData is the classrooms page response.
type ClassroomsData struct {
	Classrooms []Classroom `json:"classrooms"`
	Faculties  []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	} `json:"faculties"`
}

// ListClassrooms ports group-manager/classrooms.
func (s *Service) ListClassrooms(ctx context.Context, c *Ctx) (*ClassroomsData, error) {
	resp := &ClassroomsData{Classrooms: []Classroom{}}
	if c.Staff.UniversityID == nil {
		return resp, nil
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select cl.id, cl.name, cl.code, coalesce(cl.capacity,0), cl."roomType", cl."facultyId",
		       f.name, cl.floor, cl."rowsCount", cl."colsCount", coalesce(cl."isActive",1)
		  from classrooms cl left join faculties f on f.id = cl."facultyId"
		 where cl."universityId" = $1 and coalesce(cl."isActive",1) = 1
		 order by cl.name`, *c.Staff.UniversityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r Classroom
		if err := rows.Scan(&r.ID, &r.Name, &r.Code, &r.Capacity, &r.RoomType, &r.FacultyID,
			&r.FacultyName, &r.Floor, &r.RowsCount, &r.ColsCount, &r.IsActive); err == nil {
			resp.Classrooms = append(resp.Classrooms, r)
		}
	}
	frows, err := s.DB.Pool.Query(ctx, `select id, name from faculties where "universityId" = $1 order by name`, *c.Staff.UniversityID)
	if err == nil {
		for frows.Next() {
			var f struct {
				ID   int64  `json:"id"`
				Name string `json:"name"`
			}
			if err := frows.Scan(&f.ID, &f.Name); err == nil {
				resp.Faculties = append(resp.Faculties, f)
			}
		}
		frows.Close()
	}
	if resp.Faculties == nil {
		resp.Faculties = []struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
		}{}
	}
	return resp, nil
}

// SaveClassroom is the classroom input.
type SaveClassroom struct {
	ID        *int64 `json:"id"`
	Name      string `json:"name"`
	Code      string `json:"code"`
	Capacity  int    `json:"capacity"`
	RoomType  string `json:"roomType"`
	FacultyID *int64 `json:"facultyId"`
	Floor     string `json:"floor"`
	Rows      *int   `json:"rows"`
	Cols      *int   `json:"cols"`
	IsActive  *int   `json:"isActive"`
}

// SaveClassroomAction ports saveClassroomAction.
func (s *Service) SaveClassroomAction(ctx context.Context, c *Ctx, in SaveClassroom) error {
	if strings.TrimSpace(in.Name) == "" || in.Capacity <= 0 {
		return errors.New("نام کلاس و ظرفیت مثبت الزامی است.")
	}
	if c.Staff.UniversityID == nil {
		return errors.New("دانشگاه شما مشخص نیست.")
	}
	if in.ID != nil {
		var uni *int64
		if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from classrooms where id = $1`, *in.ID).Scan(&uni); err != nil {
			return errors.New("این کلاس متعلق به دانشگاه شما نیست.")
		}
		if uni == nil || *uni != *c.Staff.UniversityID {
			return errors.New("این کلاس متعلق به دانشگاه شما نیست.")
		}
	}
	var facultyName *string
	if in.FacultyID != nil {
		var fid int64
		var name string
		if err := s.DB.Pool.QueryRow(ctx, `select id, name from faculties where id = $1 and "universityId" = $2`,
			*in.FacultyID, *c.Staff.UniversityID).Scan(&fid, &name); err != nil {
			return errors.New("دانشکدهٔ انتخاب‌شده متعلق به دانشگاه شما نیست.")
		}
		facultyName = &name
	}
	active := 1
	if in.IsActive != nil && *in.IsActive == 0 {
		active = 0
	}
	vals := []any{
		strings.TrimSpace(in.Name), nilIfEmpty(in.Code), in.Capacity, nilIfEmpty(in.RoomType),
		in.FacultyID, facultyName, nilIfEmpty(in.Floor), in.Rows, in.Cols, active,
	}
	if in.ID != nil {
		args := append(vals, *in.ID)
		_, err := s.DB.Pool.Exec(ctx, `
			update classrooms set name = $1, code = $2, capacity = $3, "roomType" = $4,
			       "facultyId" = $5, "buildingName" = $6, floor = $7, "rowsCount" = $8,
			       "colsCount" = $9, "isActive" = $10
			 where id = $11`, args...)
		return err
	}
	args := append(vals, *c.Staff.UniversityID)
	_, err := s.DB.Pool.Exec(ctx, `
		insert into classrooms (name, code, capacity, "roomType", "facultyId", "buildingName",
		       floor, "rowsCount", "colsCount", "isActive", "universityId")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, args...)
	return err
}

// DeleteClassroom ports deleteClassroomAction.
func (s *Service) DeleteClassroom(ctx context.Context, c *Ctx, classID int64) error {
	var uni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from classrooms where id = $1`, classID).Scan(&uni); err != nil {
		return errors.New("این کلاس متعلق به دانشگاه شما نیست.")
	}
	if uni == nil || c.Staff.UniversityID == nil || *uni != *c.Staff.UniversityID {
		return errors.New("این کلاس متعلق به دانشگاه شما نیست.")
	}
	var used int
	_ = s.DB.Pool.QueryRow(ctx, `select count(*) from schedules where "roomId" = $1`, classID).Scan(&used)
	if used > 0 {
		return errors.New("این کلاس در برنامهٔ هفتگی استفاده می‌شود — ابتدا برنامه را حذف کنید.")
	}
	_, err := s.DB.Pool.Exec(ctx, `delete from classrooms where id = $1`, classID)
	return err
}

func nilIfEmpty(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}

func nowISO() string { return time.Now().UTC().Format(time.RFC3339) }
