// ═══ پنل ادمین هستهٔ آموزشی (فاز ۶) ═══
package admin

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/authn"
	"backend-go/internal/db"
	"backend-go/internal/scope"
	"backend-go/internal/session"
)

// Service سرویس ادمین.
type Service struct {
	DB    *db.DB
	Scope *scope.Service
}

func New(database *db.DB, scopeSvc *scope.Service) *Service {
	return &Service{DB: database, Scope: scopeSvc}
}

// UniversityID دانشگاه فعال از کوکی/دسترسی.
func (s *Service) UniversityID(ctx context.Context, user *session.User, cookie string) *int64 {
	uni, err := s.Scope.CurrentUniversity(ctx, user, cookie)
	if err != nil || uni.ID <= 0 || uni.Kind == "NONE" {
		return nil
	}
	id := uni.ID
	return &id
}

// DashboardStats آمار داشبورد.
type DashboardStats struct {
	StudentsTotal  int `json:"studentsTotal"`
	StudentsActive int `json:"studentsActive"`
	Offerings      int `json:"offerings"`
	Enrollments    int `json:"enrollments"`
	RequestsOpen   int `json:"requestsOpen"`
	RequestsTotal  int `json:"requestsTotal"`
}

// InboxRow ردیف کارتابل.
type InboxRow struct {
	ID      int64   `json:"id"`
	Track   string  `json:"trackingCode"`
	Status  string  `json:"status"`
	Created *string `json:"created"`
	Student string  `json:"studentName"`
	Code    string  `json:"studentCode"`
	Process *string `json:"processTitle"`
}

// GradeLive فعالیت زندهٔ نمرات.
type GradeLive struct {
	Actor       string  `json:"actor"`
	ActorRole   *string `json:"actorRole"`
	StudentCode *string `json:"studentCode"`
	Course      *string `json:"course"`
	Grade       *string `json:"grade"`
	At          *string `json:"at"`
}

// DashboardResponse پاسخ داشبورد.
type DashboardResponse struct {
	UniversityTitle string         `json:"universityTitle"`
	Stats           DashboardStats `json:"stats"`
	Inbox           []InboxRow     `json:"inbox"`
	QueueLength     int            `json:"queueLength"`
	WarmedOfferings int            `json:"warmedOfferings"`
	GradeLive       []GradeLive    `json:"gradeLive"`
}

// GetDashboard پورت admin/page.tsx (خلاصه).
func (s *Service) GetDashboard(ctx context.Context, user *session.User, uniCookie string) (*DashboardResponse, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	resp := &DashboardResponse{Inbox: []InboxRow{}, GradeLive: []GradeLive{}}
	if uniID != nil {
		_ = s.DB.Pool.QueryRow(ctx, `select title from universities where id = $1`, *uniID).Scan(&resp.UniversityTitle)
	}
	if resp.UniversityTitle == "" {
		resp.UniversityTitle = "دانشگاه آفاق"
	}

	// آمار دانشجو/ارائه/ثبت‌نام.
	if uniID != nil {
		_ = s.DB.Pool.QueryRow(ctx, `
			select count(*), count(*) filter (where status = 'ACTIVE')
			  from students where "universityId" = $1`, *uniID).
			Scan(&resp.Stats.StudentsTotal, &resp.Stats.StudentsActive)
		_ = s.DB.Pool.QueryRow(ctx, `
			select count(*) from course_offerings o
			  join academic_terms t on t.id = o."termId"
			 where o."universityId" = $1 and o."isActive" = 1 and t."isCurrent" = 1`, *uniID).
			Scan(&resp.Stats.Offerings)
		_ = s.DB.Pool.QueryRow(ctx, `
			select count(*) from enrollments e
			  join course_offerings o on o.id = e."offeringId"
			  join academic_terms t on t.id = o."termId"
			 where o."universityId" = $1 and t."isCurrent" = 1 and e.status <> 'DROPPED'`, *uniID).
			Scan(&resp.Stats.Enrollments)
	}

	// کارتابل درخواست‌ها (همین دانشگاه + سراسری).
	scopeCond := `(r."universityId" is null or ($1::int is not null and r."universityId" = $1))`
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*), count(*) filter (where status in ('SUBMITTED','IN_REVIEW','RETURNED'))
		  from student_requests r where `+scopeCond, uniID).
		Scan(&resp.Stats.RequestsTotal, &resp.Stats.RequestsOpen)

	rows, err := s.DB.Pool.Query(ctx, `
		select r.id, r."trackingCode", r.status, r."createdAt"::text,
		       coalesce(u."firstName" || ' ' || u."lastName",''), st."studentCode", p.title
		  from student_requests r
		  join students st on st.id = r."studentId"
		  join users u on u.id = st."userId"
		  left join process_definitions p on p.id = r."processId"
		 where `+scopeCond+`
		 order by r.id desc limit 20`, uniID)
	if err == nil {
		for rows.Next() {
			var r InboxRow
			if err := rows.Scan(&r.ID, &r.Track, &r.Status, &r.Created, &r.Student, &r.Code, &r.Process); err == nil {
				r.Student = strings.TrimSpace(r.Student)
				resp.Inbox = append(resp.Inbox, r)
			}
		}
		rows.Close()
	}

	// فعالیت زندهٔ نمرات ۳۰ دقیقهٔ اخیر.
	grows, err := s.DB.Pool.Query(ctx, `
		select coalesce(u2."firstName" || ' ' || u2."lastName",'—'), g."actorRole",
		       st."studentCode", c.title, g."newGradeValue"::text, g."createdAt"::text
		  from grade_change_log g
		  left join users u2 on u2.id = g."actorUserId"
		  left join students st on st.id = g."studentId"
		  left join course_offerings o on o.id = g."offeringId"
		  left join courses c on c.id = o."courseId"
		 where g."createdAt" > now() - interval '30 minutes'
		 order by g.id desc limit 15`)
	if err == nil {
		for grows.Next() {
			var g GradeLive
			if err := grows.Scan(&g.Actor, &g.ActorRole, &g.StudentCode, &g.Course, &g.Grade, &g.At); err == nil {
				resp.GradeLive = append(resp.GradeLive, g)
			}
		}
		grows.Close()
	}
	return resp, nil
}

// StudentRow ردیف دانشجو.
type StudentRow struct {
	ID           int64   `json:"id"`
	StudentCode  string  `json:"studentCode"`
	FullName     string  `json:"fullName"`
	NationalCode *string `json:"nationalCode"`
	EntryYear    int     `json:"entryYear"`
	EntryTerm    *int    `json:"entryTerm"`
	Status       string  `json:"status"`
	MajorName    *string `json:"majorName"`
	DegreeTitle  *string `json:"degreeTitle"`
	IsActive     int     `json:"isActive"`
}

// StudentsResponse فهرست دانشجویان.
type StudentsResponse struct {
	Total int          `json:"total"`
	Page  int          `json:"page"`
	Rows  []StudentRow `json:"rows"`
}

// ListStudents پورت admin/students (جست‌وجو/صفحه‌بندی).
func (s *Service) ListStudents(ctx context.Context, user *session.User, uniCookie, q, status string, page int) (*StudentsResponse, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if page < 1 {
		page = 1
	}
	const perPage = 50
	resp := &StudentsResponse{Page: page, Rows: []StudentRow{}}
	conds := []string{}
	args := []any{}
	idx := 1
	if uniID != nil {
		conds = append(conds, `st."universityId" = $`+itoa(int64(idx)))
		args = append(args, *uniID)
		idx++
	}
	if status != "" && strings.ToUpper(status) != "ALL" {
		conds = append(conds, `st.status = $`+itoa(int64(idx)))
		args = append(args, strings.ToUpper(status))
		idx++
	}
	if q = strings.TrimSpace(q); q != "" {
		like := "%" + q + "%"
		conds = append(conds, `(st."studentCode" ilike $`+itoa(int64(idx))+` or u."nationalCode" ilike $`+itoa(int64(idx))+` or (u."firstName" || ' ' || u."lastName") ilike $`+itoa(int64(idx))+`)`)
		args = append(args, like)
		idx++
	}
	where := "1=1"
	if len(conds) > 0 {
		where = strings.Join(conds, " and ")
	}
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*) from students st join users u on u.id = st."userId" where `+where, args...).Scan(&resp.Total)
	rows, err := s.DB.Pool.Query(ctx, `
		select st.id, st."studentCode", coalesce(u."firstName" || ' ' || u."lastName",''),
		       u."nationalCode", st."entryYear", st."entryTerm", st.status,
		       m.name, d.title, coalesce(u."isActive",1)
		  from students st
		  join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		  left join degree_level_configs d on d.id = st."degreeLevelId"
		 where `+where+`
		 order by st.id desc limit 50 offset `+itoa(int64((page-1)*perPage)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r StudentRow
		if err := rows.Scan(&r.ID, &r.StudentCode, &r.FullName, &r.NationalCode, &r.EntryYear,
			&r.EntryTerm, &r.Status, &r.MajorName, &r.DegreeTitle, &r.IsActive); err == nil {
			r.FullName = strings.TrimSpace(r.FullName)
			resp.Rows = append(resp.Rows, r)
		}
	}
	return resp, rows.Err()
}

// SetUserActive فعال/غیرفعال کردن حساب.
func (s *Service) SetUserActive(ctx context.Context, userID int64, active bool) error {
	tag, err := s.DB.Pool.Exec(ctx, `update users set "isActive" = $1 where id = $2`, boolInt(active), userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("کاربر یافت نشد.")
	}
	return nil
}

// ResetPasswordToNationalCode بازنشانی رمز به کد ملی + اجبار تغییر.
func (s *Service) ResetPasswordToNationalCode(ctx context.Context, userID int64) error {
	var nationalCode *string
	if err := s.DB.Pool.QueryRow(ctx, `select "nationalCode" from users where id = $1`, userID).Scan(&nationalCode); err != nil {
		return errors.New("کاربر یافت نشد.")
	}
	if nationalCode == nil || strings.TrimSpace(*nationalCode) == "" {
		return errors.New("کد ملی کاربر ثبت نشده است.")
	}
	hash, err := authn.HashPassword(strings.TrimSpace(*nationalCode))
	if err != nil {
		return err
	}
	_, err = s.DB.Pool.Exec(ctx, `
		update users set "passwordHash" = $1, "mustChangePassword" = 1 where id = $2`, hash, userID)
	return err
}

// DepartmentRow ردیف دانشکده/گروه.
type DepartmentRow struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	Code      *string `json:"code"`
	FacultyID int64   `json:"facultyId"`
	Faculty   string  `json:"facultyName"`
}

// FacultyRow دانشکده.
type FacultyRow struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// DepartmentsResponse پاسخ صفحه.
type DepartmentsResponse struct {
	Faculties   []FacultyRow    `json:"faculties"`
	Departments []DepartmentRow `json:"departments"`
}

// ListDepartments پورت admin/departments (خواندن).
func (s *Service) ListDepartments(ctx context.Context, user *session.User, uniCookie string) (*DepartmentsResponse, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	resp := &DepartmentsResponse{Faculties: []FacultyRow{}, Departments: []DepartmentRow{}}
	if uniID == nil {
		return resp, nil
	}
	frows, err := s.DB.Pool.Query(ctx, `select id, name from faculties where "universityId" = $1 order by name`, *uniID)
	if err != nil {
		return nil, err
	}
	for frows.Next() {
		var f FacultyRow
		if err := frows.Scan(&f.ID, &f.Name); err == nil {
			resp.Faculties = append(resp.Faculties, f)
		}
	}
	frows.Close()
	rows, err := s.DB.Pool.Query(ctx, `
		select d.id, d.name, d."departmentCode", d."facultyId", coalesce(f.name,'')
		  from departments d left join faculties f on f.id = d."facultyId"
		 where f."universityId" = $1 or d."universityId" = $1
		 order by f.name, d.name`, *uniID)
	if err != nil {
		return resp, nil
	}
	defer rows.Close()
	for rows.Next() {
		var d DepartmentRow
		if err := rows.Scan(&d.ID, &d.Name, &d.Code, &d.FacultyID, &d.Faculty); err == nil {
			resp.Departments = append(resp.Departments, d)
		}
	}
	return resp, nil
}

// StaffRow ردیف کارمند/استاد.
type StaffRow struct {
	ID           int64   `json:"id"`
	StaffCode    string  `json:"staffCode"`
	FullName     string  `json:"fullName"`
	NationalCode *string `json:"nationalCode"`
	AcademicRank *string `json:"academicRank"`
	StaffType    *string `json:"staffType"`
	Department   *string `json:"departmentName"`
	IsActive     int     `json:"isActive"`
}

// ListStaff پورت admin/staff (خواندن+جست‌وجو).
func (s *Service) ListStaff(ctx context.Context, user *session.User, uniCookie, q string) ([]StaffRow, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	out := []StaffRow{}
	if uniID == nil {
		return out, nil
	}
	args := []any{*uniID}
	extra := ""
	if q = strings.TrimSpace(q); q != "" {
		extra = ` and (st."staffCode" ilike $2 or (u."firstName" || ' ' || u."lastName") ilike $2 or u."nationalCode" ilike $2)`
		args = append(args, "%"+q+"%")
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select st.id, st."staffCode", coalesce(u."firstName" || ' ' || u."lastName",''),
		       u."nationalCode", st."academicRank", st."staffType", d.name, coalesce(st."isActive",u."isActive",1)
		  from staff st
		  join users u on u.id = st."userId"
		  left join departments d on d.id = st."departmentId"
		 where st."universityId" = $1`+extra+`
		 order by u."lastName" limit 200`, args...)
	if err != nil {
		return out, nil
	}
	defer rows.Close()
	for rows.Next() {
		var r StaffRow
		if err := rows.Scan(&r.ID, &r.StaffCode, &r.FullName, &r.NationalCode, &r.AcademicRank,
			&r.StaffType, &r.Department, &r.IsActive); err == nil {
			r.FullName = strings.TrimSpace(r.FullName)
			out = append(out, r)
		}
	}
	return out, nil
}

func itoa(v int64) string { return strconv.FormatInt(v, 10) }

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

var _ = pgxpool.Pool{}
