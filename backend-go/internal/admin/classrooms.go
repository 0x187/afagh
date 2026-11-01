// Classroom management for the admin settings screen.
//
// Ported from afagh-next/src/app/admin/settings/ClassroomManager.tsx and
// actions.ts. All reads and writes are constrained to the active university;
// delete operations refuse rooms that are still referenced by weekly schedules.
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

const (
	maxClassroomNameLen     = 200
	maxClassroomCodeLen     = 50
	maxClassroomRoomTypeLen = 60
	maxClassroomFloorLen    = 20
	maxClassroomCapacity    = 100000
	maxSeatDimension        = 100
)

// AdminClassroom is a schedulable room returned to the admin settings UI.
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

// AdminClassroomsResponse is the room list plus the faculties of the active
// university. Faculties are empty when no university scope is available.
type AdminClassroomsResponse struct {
	Classrooms []AdminClassroom `json:"classrooms"`
	Faculties  []SimpleOption   `json:"faculties"`
}

// AdminClassroomInput is the create/update payload for a single room.
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

// AdminClassroomResult is the user-facing message for a mutation.
type AdminClassroomResult struct {
	Message string `json:"message"`
	NewID   *int64 `json:"newId,omitempty"`
}

// sameClassroomUni compares nullable university ids; NULL == NULL is a valid
// match for global rows, mirroring the Next.js classroomOwnedBy helper.
func sameClassroomUni(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// classroomStrPtr trims a string and returns nil for empty values so optional
// text columns stay NULL instead of ”.
func classroomStrPtr(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}

// ListAdminClassrooms returns every room of the active university, including
// inactive rows, sorted by name.
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

// validateAdminClassroomInput applies the same mandatory checks as the Next
// form plus defensive length/range limits before hitting the database.
func validateAdminClassroomInput(in AdminClassroomInput) error {
	name := strings.TrimSpace(in.Name)
	if name == "" || in.Capacity <= 0 {
		return errors.New("نام کلاس و ظرفیت مثبت الزامی است.")
	}
	if len([]rune(name)) > maxClassroomNameLen {
		return fmt.Errorf("نام کلاس حداکثر %d نویسه است.", maxClassroomNameLen)
	}
	if len([]rune(strings.TrimSpace(in.Code))) > maxClassroomCodeLen {
		return fmt.Errorf("کد کلاس حداکثر %d نویسه است.", maxClassroomCodeLen)
	}
	if len([]rune(strings.TrimSpace(in.RoomType))) > maxClassroomRoomTypeLen {
		return fmt.Errorf("نوع کلاس حداکثر %d نویسه است.", maxClassroomRoomTypeLen)
	}
	if len([]rune(strings.TrimSpace(in.Floor))) > maxClassroomFloorLen {
		return fmt.Errorf("طبقه حداکثر %d نویسه است.", maxClassroomFloorLen)
	}
	if in.Capacity > maxClassroomCapacity {
		return fmt.Errorf("ظرفیت کلاس حداکثر %d نفر است.", maxClassroomCapacity)
	}
	if in.Rows != nil && (*in.Rows < 0 || *in.Rows > maxSeatDimension) {
		return fmt.Errorf("تعداد ردیف باید بین ۰ تا %d باشد.", maxSeatDimension)
	}
	if in.Cols != nil && (*in.Cols < 0 || *in.Cols > maxSeatDimension) {
		return fmt.Errorf("تعداد ستون باید بین ۰ تا %d باشد.", maxSeatDimension)
	}
	return nil
}

// SaveAdminClassroom creates or updates a room. Updates are guarded by the
// room's university id so a forged id cannot cross tenant boundaries.
func (s *Service) SaveAdminClassroom(ctx context.Context, user *session.User, uniCookie string, in AdminClassroomInput) (*AdminClassroomResult, error) {
	if err := validateAdminClassroomInput(in); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(in.Name)
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
		tag, err := s.DB.Pool.Exec(ctx, `
			update classrooms set name = $1, code = $2, capacity = $3, "roomType" = $4,
			       "facultyId" = $5, "buildingName" = $6, floor = $7, "rowsCount" = $8,
			       "colsCount" = $9, "isActive" = $10
			 where id = $11 and ("universityId" is not distinct from $12::bigint)`,
			name, code, in.Capacity, roomType, in.FacultyID, facultyName, floor, in.Rows, in.Cols, active, *in.ID, uni)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() == 0 {
			return nil, errors.New("این کلاس متعلق به دانشگاه شما نیست.")
		}
		s.auditClassroom(ctx, user, "CLASSROOM_UPDATED", *in.ID, map[string]any{
			"name": name, "code": code, "facultyId": in.FacultyID, "isActive": active,
		})
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
	s.auditClassroom(ctx, user, "CLASSROOM_CREATED", newID, map[string]any{
		"name": name, "code": code, "facultyId": in.FacultyID, "isActive": active,
	})
	return &AdminClassroomResult{Message: fmt.Sprintf("کلاس «%s» افزوده شد.", name), NewID: &newID}, nil
}

// DeleteAdminClassroom deletes a single room. The DELETE itself checks for
// schedule references to avoid a check-then-delete race.
func (s *Service) DeleteAdminClassroom(ctx context.Context, user *session.User, uniCookie string, id int64) (*AdminClassroomResult, error) {
	if id <= 0 {
		return nil, errors.New("کلاس نامعتبر است.")
	}
	uni := s.UniversityID(ctx, user, uniCookie)
	var roomUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from classrooms where id = $1`, id).Scan(&roomUni); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("این کلاس متعلق به دانشگاه شما نیست.")
		}
		return nil, err
	}
	if !sameClassroomUni(roomUni, uni) {
		return nil, errors.New("این کلاس متعلق به دانشگاه شما نیست.")
	}

	tag, err := s.DB.Pool.Exec(ctx, `
		delete from classrooms c
		 where c.id = $1
		   and not exists (select 1 from schedules s where s."roomId" = c.id)`, id)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, errors.New("این کلاس در برنامهٔ هفتگی استفاده می‌شود — ابتدا برنامه را حذف کنید.")
	}
	s.auditClassroom(ctx, user, "CLASSROOM_DELETED", id, map[string]any{})
	return &AdminClassroomResult{Message: "کلاس حذف شد."}, nil
}

// BulkAdminClassrooms activates, deactivates, or deletes the selected rooms.
// Ownership is checked row by row; delete skips rooms referenced by schedules
// instead of failing the whole batch.
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
		tag, err := s.DB.Pool.Exec(ctx, `
			delete from classrooms c
			 where c.id = any($1::bigint[])
			   and not exists (select 1 from schedules s where s."roomId" = c.id)`, owned)
		if err != nil {
			return nil, err
		}
		deleted := int(tag.RowsAffected())
		blocked := len(owned) - deleted
		if deleted == 0 {
			return nil, fmt.Errorf("هیچ‌کدام حذف نشد — هر %d کلاس در برنامهٔ هفتگی استفاده می‌شود.", blocked)
		}
		note := ""
		if blocked > 0 {
			note = fmt.Sprintf(" %d کلاس به‌دلیل داشتن برنامهٔ هفتگی حذف نشد.", blocked)
		}
		s.auditClassroom(ctx, user, "CLASSROOMS_BULK_DELETE", 0, map[string]any{"ids": owned, "blocked": blocked})
		return &AdminClassroomResult{Message: fmt.Sprintf("%d کلاس حذف شد.%s%s", deleted, note, tail)}, nil
	}
	return nil, errors.New("عملیات گروهی نامعتبر است.")
}

// auditClassroom writes a best-effort audit entry; audit failures must not
// roll back a successful mutation.
func (s *Service) auditClassroom(ctx context.Context, user *session.User, action string, entityID int64, details map[string]any) {
	if user == nil {
		return
	}
	raw, _ := json.Marshal(details)
	s.AuditAction(ctx, user.ID, action, "CLASSROOM", entityID, string(raw))
}
