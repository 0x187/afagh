// ═══ مدیریت کلاس‌ها از سطح تنظیمات ادمین — پورت admin/settings/ClassroomManager ═══
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/session"
)

// AdminClassroom یک اتاق/کلاس قابل برنامه‌ریزی.
type AdminClassroom struct {
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

// AdminClassroomsResponse پاسخ فهرست کلاس‌ها + دانشکده‌های دانشگاه فعال.
type AdminClassroomsResponse struct {
	Classrooms []AdminClassroom `json:"classrooms"`
	Faculties  []SimpleOption   `json:"faculties"`
}

// AdminClassroomInput ورودی ذخیرهٔ یک کلاس (هم افزودن و هم ویرایش).
type AdminClassroomInput struct {
	ID        *int64 `json:"id"`
	Code      string `json:"code"`
	Name      string `json:"name"`
	Capacity  int    `json:"capacity"`
	RoomType  string `json:"roomType"`
	FacultyID *int64 `json:"facultyId"`
	Floor     string `json:"floor"`
	Rows      *int   `json:"rows"`
	Cols      *int   `json:"cols"`
	IsActive  *int   `json:"isActive"`
}

// AdminClassroomResult نتیجهٔ ذخیره.
type AdminClassroomResult struct {
	Message string `json:"message"`
	NewID   *int64 `json:"newId,omitempty"`
}

func sameClassroomUni(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func classroomStrPtr(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}

// ListAdminClassrooms فهرست کامل کلاس‌های دانشگاه فعال (شامل غیرفعال‌ها).
func (s *Service) ListAdminClassrooms(ctx context.Context, user *session.User, uniCookie string) (*AdminClassroomsResponse, error) {
	uni := s.UniversityID(ctx, user, uniCookie)
	resp := &AdminClassroomsResponse{Classrooms: []AdminClassroom{}, Faculties: []SimpleOption{}}

	rows, err := s.DB.Pool.Query(ctx, `
		select cl.id, cl.name, cl.code, coalesce(cl.capacity,0), cl."roomType", cl."facultyId",
		       f.name, cl.floor, cl."rowsCount", cl."colsCount", coalesce(cl."isActive",1)
		  from classrooms cl left join faculties f on f.id = cl."facultyId"
		 where (($1::bigint is null and cl."universityId" is null) or cl."universityId" = $1::bigint)
		 order by cl.name`, uni)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r AdminClassroom
		if err := rows.Scan(&r.ID, &r.Name, &r.Code, &r.Capacity, &r.RoomType, &r.FacultyID,
			&r.FacultyName, &r.Floor, &r.RowsCount, &r.ColsCount, &r.IsActive); err == nil {
			resp.Classrooms = append(resp.Classrooms, r)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if uni != nil {
		frows, err := s.DB.Pool.Query(ctx, `select id, name from faculties where "universityId" = $1 order by name`, *uni)
		if err != nil {
			return nil, err
		}
		defer frows.Close()
		for frows.Next() {
			var f SimpleOption
			if err := frows.Scan(&f.ID, &f.Name); err == nil {
				resp.Faculties = append(resp.Faculties, f)
			}
		}
		if err := frows.Err(); err != nil {
			return nil, err
		}
	}
	return resp, nil
}

// SaveAdminClassroom افزودن/ویرایش یک کلاس با گیت مالکیت دانشگاه.
func (s *Service) SaveAdminClassroom(ctx context.Context, user *session.User, uniCookie string, in AdminClassroomInput) (*AdminClassroomResult, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" || in.Capacity <= 0 {
		return nil, errors.New("نام کلاس و ظرفیت مثبت الزامی است.")
	}
	uni := s.UniversityID(ctx, user, uniCookie)

	if in.ID != nil {
		var roomUni *int64
		if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from classrooms where id = $1`, *in.ID).Scan(&roomUni); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, errors.New("این کلاس متعلق به دانشگاه شما نیست.")
			}
			return nil, err
		}
		if !sameClassroomUni(roomUni, uni) {
			return nil, errors.New("این کلاس متعلق به دانشگاه شما نیست.")
		}
	}

	var facultyName *string
	if in.FacultyID != nil {
		if uni == nil {
			return nil, errors.New("دانشکدهٔ انتخاب‌شده متعلق به دانشگاه فعال نیست.")
		}
		var fid int64
		var fname string
		if err := s.DB.Pool.QueryRow(ctx, `select id, name from faculties where id = $1 and "universityId" = $2`,
			*in.FacultyID, *uni).Scan(&fid, &fname); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, errors.New("دانشکدهٔ انتخاب‌شده متعلق به دانشگاه فعال نیست.")
			}
			return nil, err
		}
		facultyName = &fname
	}

	active := 1
	if in.IsActive != nil && *in.IsActive == 0 {
		active = 0
	}
	code := classroomStrPtr(in.Code)
	roomType := classroomStrPtr(in.RoomType)
	floor := classroomStrPtr(in.Floor)

	if in.ID != nil {
		_, err := s.DB.Pool.Exec(ctx, `
			update classrooms set name = $1, code = $2, capacity = $3, "roomType" = $4,
			       "facultyId" = $5, "buildingName" = $6, floor = $7, "rowsCount" = $8,
			       "colsCount" = $9, "isActive" = $10
			 where id = $11`,
			name, code, in.Capacity, roomType, in.FacultyID, facultyName, floor, in.Rows, in.Cols, active, *in.ID)
		if err != nil {
			return nil, err
		}
		s.auditClassroom(ctx, user, "CLASSROOM_UPDATED", *in.ID, map[string]any{"name": name, "code": code, "facultyId": in.FacultyID, "isActive": active})
		return &AdminClassroomResult{Message: fmt.Sprintf("کلاس «%s» ذخیره شد.", name)}, nil
	}

	var newID int64
	err := s.DB.Pool.QueryRow(ctx, `
		insert into classrooms (name, code, capacity, "roomType", "facultyId", "buildingName",
		                        floor, "rowsCount", "colsCount", "isActive", "universityId")
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		returning id`,
		name, code, in.Capacity, roomType, in.FacultyID, facultyName, floor, in.Rows, in.Cols, active, uni).Scan(&newID)
	if err != nil {
		return nil, err
	}
	s.auditClassroom(ctx, user, "CLASSROOM_CREATED", newID, map[string]any{"name": name, "code": code, "facultyId": in.FacultyID, "isActive": active})
	return &AdminClassroomResult{Message: fmt.Sprintf("کلاس «%s» افزوده شد.", name), NewID: &newID}, nil
}

// DeleteAdminClassroom حذف یک کلاس — کلاس دارای برنامهٔ هفتگی حذف نمی‌شود.
func (s *Service) DeleteAdminClassroom(ctx context.Context, user *session.User, uniCookie string, id int64) (*AdminClassroomResult, error) {
	if id <= 0 {
		return nil, errors.New("کلاس نامعتبر است.")
	}
	var roomUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from classrooms where id = $1`, id).Scan(&roomUni); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("این کلاس متعلق به دانشگاه شما نیست.")
		}
		return nil, err
	}
	if !sameClassroomUni(roomUni, s.UniversityID(ctx, user, uniCookie)) {
		return nil, errors.New("این کلاس متعلق به دانشگاه شما نیست.")
	}
	var used int
	if err := s.DB.Pool.QueryRow(ctx, `select count(*) from schedules where "roomId" = $1`, id).Scan(&used); err != nil {
		return nil, err
	}
	if used > 0 {
		return nil, errors.New("این کلاس در برنامهٔ هفتگی استفاده می‌شود — ابتدا برنامه را حذف کنید.")
	}
	if _, err := s.DB.Pool.Exec(ctx, `delete from classrooms where id = $1`, id); err != nil {
		return nil, err
	}
	s.auditClassroom(ctx, user, "CLASSROOM_DELETED", id, map[string]any{})
	return &AdminClassroomResult{Message: "کلاس حذف شد."}, nil
}

// BulkAdminClassrooms عملیات گروهی فعال/غیرفعال/حذف روی کلاس‌های انتخاب‌شده.
func (s *Service) BulkAdminClassrooms(ctx context.Context, user *session.User, uniCookie, op string, ids []int64) (*AdminClassroomResult, error) {
	op = strings.TrimSpace(op)
	if op != "activate" && op != "deactivate" && op != "delete" {
		return nil, errors.New("عملیات گروهی نامعتبر است.")
	}
	uniq := make([]int64, 0, len(ids))
	seen := map[int64]bool{}
	for _, id := range ids {
		if id > 0 && !seen[id] {
			seen[id] = true
			uniq = append(uniq, id)
		}
	}
	if len(uniq) == 0 {
		return nil, errors.New("هیچ کلاسی انتخاب نشده است.")
	}
	uni := s.UniversityID(ctx, user, uniCookie)

	rows, err := s.DB.Pool.Query(ctx, `select id, "universityId" from classrooms where id = any($1::bigint[])`, uniq)
	if err != nil {
		return nil, err
	}
	owned := make([]int64, 0, len(uniq))
	for rows.Next() {
		var id int64
		var roomUni *int64
		if err := rows.Scan(&id, &roomUni); err == nil && sameClassroomUni(roomUni, uni) {
			owned = append(owned, id)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(owned) == 0 {
		return nil, errors.New("کلاس‌های انتخاب‌شده متعلق به دانشگاه فعال نیستند.")
	}
	rejected := len(uniq) - len(owned)
	tail := ""
	if rejected > 0 {
		tail = fmt.Sprintf(" (%d مورد خارج از دانشگاه فعال نادیده گرفته شد)", rejected)
	}

	switch op {
	case "activate", "deactivate":
		on := 1
		word := "فعال"
		if op == "deactivate" {
			on = 0
			word = "غیرفعال"
		}
		if _, err := s.DB.Pool.Exec(ctx, `update classrooms set "isActive" = $1 where id = any($2::bigint[])`, on, owned); err != nil {
			return nil, err
		}
		s.auditClassroom(ctx, user, "CLASSROOMS_BULK_"+strings.ToUpper(op), 0, map[string]any{"ids": owned, "op": op})
		return &AdminClassroomResult{Message: fmt.Sprintf("%d کلاس %s شد.%s", len(owned), word, tail)}, nil

	case "delete":
		usedRows, err := s.DB.Pool.Query(ctx, `select distinct "roomId" from schedules where "roomId" = any($1::bigint[])`, owned)
		if err != nil {
			return nil, err
		}
		used := map[int64]bool{}
		for usedRows.Next() {
			var roomID *int64
			if err := usedRows.Scan(&roomID); err == nil && roomID != nil {
				used[*roomID] = true
			}
		}
		usedRows.Close()
		if err := usedRows.Err(); err != nil {
			return nil, err
		}
		deletable := make([]int64, 0, len(owned))
		for _, id := range owned {
			if !used[id] {
				deletable = append(deletable, id)
			}
		}
		blocked := len(owned) - len(deletable)
		if len(deletable) == 0 {
			return nil, fmt.Errorf("هیچ‌کدام حذف نشد — هر %d کلاس در برنامهٔ هفتگی استفاده می‌شود.", blocked)
		}
		if _, err := s.DB.Pool.Exec(ctx, `delete from classrooms where id = any($1::bigint[])`, deletable); err != nil {
			return nil, err
		}
		note := ""
		if blocked > 0 {
			note = fmt.Sprintf(" %d کلاس به‌دلیل داشتن برنامهٔ هفتگی حذف نشد.", blocked)
		}
		s.auditClassroom(ctx, user, "CLASSROOMS_BULK_DELETE", 0, map[string]any{"ids": deletable, "blocked": blocked})
		return &AdminClassroomResult{Message: fmt.Sprintf("%d کلاس حذف شد.%s%s", len(deletable), note, tail)}, nil
	}
	return nil, errors.New("عملیات گروهی نامعتبر است.")
}

func (s *Service) auditClassroom(ctx context.Context, user *session.User, action string, entityID int64, details map[string]any) {
	if user == nil {
		return
	}
	raw, _ := json.Marshal(details)
	s.AuditAction(ctx, user.ID, action, "CLASSROOM", entityID, string(raw))
}
