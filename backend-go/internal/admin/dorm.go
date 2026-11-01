// ═══ Dorm residence card — lib/dorm-cards.ts port ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"backend-go/internal/session"
)

// DormResidenceRow residence row.
type DormResidenceRow struct {
	ID           int64      `json:"id"`
	StudentID    int64      `json:"studentId"`
	StudentCode  string     `json:"studentCode"`
	FullName     string     `json:"fullName"`
	MajorName    *string    `json:"majorName"`
	DegreeLevel  *string    `json:"degreeLevel"`
	DormName     *string    `json:"dormName"`
	RoomNo       *string    `json:"roomNo"`
	BedNo        *string    `json:"bedNo"`
	AcademicYear *string    `json:"academicYear"`
	ValidFrom    *time.Time `json:"validFrom"`
	ValidTo      *time.Time `json:"validTo"`
	Status       string     `json:"status"`
	CreatedAt    *time.Time `json:"createdAt"`
}

// DormInput residence create/edit input.
type DormInput struct {
	StudentID    int64   `json:"studentId"`
	DormName     *string `json:"dormName"`
	RoomNo       *string `json:"roomNo"`
	BedNo        *string `json:"bedNo"`
	AcademicYear *string `json:"academicYear"`
	ValidFrom    *string `json:"validFrom"`
	ValidTo      *string `json:"validTo"`
	Status       *string `json:"status"`
}

func validDormStatus(s string) bool {
	return s == "active" || s == "ended" || s == "revoked"
}

func parseDormDate(raw *string) (*time.Time, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, nil
	}
	raw2 := strings.TrimSpace(*raw)
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, raw2); err == nil {
			v := t.UTC()
			return &v, nil
		}
	}
	return nil, errors.New("تاریخ نامعتبر است.")
}

// ListDormResidences list residences of the active university.
func (s *Service) ListDormResidences(ctx context.Context, user *session.User, cookie, status string, studentID int64) ([]DormResidenceRow, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := []DormResidenceRow{}
	if uniID == nil {
		return out, nil
	}
	args := []any{*uniID}
	conds := []string{`d."universityId" = $1`}
	if studentID > 0 {
		args = append(args, studentID)
		conds = append(conds, `d."studentId" = $`+strconv.Itoa(len(args)))
	}
	if status != "" {
		if !validDormStatus(status) {
			return nil, errors.New("وضعیت نامعتبر است.")
		}
		args = append(args, status)
		conds = append(conds, `d.status = $`+strconv.Itoa(len(args)))
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select d.id, d."studentId", coalesce(st."studentCode",''),
		       coalesce(u."firstName" || ' ' || u."lastName",''), m.name, dl.title,
		       d."dormName", d."roomNo", d."bedNo", d."academicYear",
		       d."validFrom", d."validTo", coalesce(d.status,'active'), d."createdAt"
		  from dorm_residences d
		  join students st on st.id = d."studentId"
		  left join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		  left join degree_level_configs dl on dl.id = st."degreeLevelId"
		 where `+strings.Join(conds, " and ")+`
		 order by d.id desc limit 2000`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r DormResidenceRow
		if err := rows.Scan(&r.ID, &r.StudentID, &r.StudentCode, &r.FullName, &r.MajorName, &r.DegreeLevel,
			&r.DormName, &r.RoomNo, &r.BedNo, &r.AcademicYear,
			&r.ValidFrom, &r.ValidTo, &r.Status, &r.CreatedAt); err == nil {
			out = append(out, r)
		}
	}
	return out, nil
}

// CreateDormResidence record residence + audit in one transaction.
func (s *Service) CreateDormResidence(ctx context.Context, user *session.User, cookie string, in DormInput) (int64, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال نامشخص است.")
	}
	if in.StudentID <= 0 {
		return 0, errors.New("شناسهٔ دانشجو نامعتبر است.")
	}
	var studentUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, in.StudentID).Scan(&studentUni); err != nil {
		return 0, errors.New("دانشجو یافت نشد.")
	}
	if studentUni != nil && *studentUni != *uniID {
		return 0, errors.New("دانشجو متعلق به دانشگاه دیگری است.")
	}
	status := "active"
	if in.Status != nil && *in.Status != "" {
		status = *in.Status
	}
	if !validDormStatus(status) {
		return 0, errors.New("وضعیت نامعتبر است.")
	}
	from, err := parseDormDate(in.ValidFrom)
	if err != nil {
		return 0, err
	}
	to, err := parseDormDate(in.ValidTo)
	if err != nil {
		return 0, err
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var id int64
	if err := tx.QueryRow(ctx, `
		insert into dorm_residences ("studentId","dormName","roomNo","bedNo","academicYear","validFrom","validTo",status,"universityId")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
		in.StudentID, nilEmpty(in.DormName), nilEmpty(in.RoomNo), nilEmpty(in.BedNo), nilEmpty(in.AcademicYear),
		from, to, status, studentUni).Scan(&id); err != nil {
		return 0, err
	}
	details := fmt.Sprintf(`{"studentId":%d,"dormName":%s,"roomNo":%s,"bedNo":%s,"academicYear":%s}`,
		in.StudentID, jsonQuote(derefOr(in.DormName)), jsonQuote(derefOr(in.RoomNo)),
		jsonQuote(derefOr(in.BedNo)), jsonQuote(derefOr(in.AcademicYear)))
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "DORM_RESIDENCE_CREATE", "dorm_residence", id, details); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return id, nil
}

// UpdateDormResidence edit residence (nil field = no change, same as ?? in TS).
func (s *Service) UpdateDormResidence(ctx context.Context, user *session.User, cookie string, id int64, in DormInput) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	if id <= 0 {
		return errors.New("شناسهٔ سکونت نامعتبر است.")
	}
	var existingStudent int64
	var exDorm, exRoom, exBed, exYear, exStatus *string
	var exFrom, exTo *time.Time
	var exUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select "studentId", "dormName", "roomNo", "bedNo", "academicYear", "validFrom", "validTo", coalesce(status,'active'), "universityId"
		  from dorm_residences where id = $1`, id).
		Scan(&existingStudent, &exDorm, &exRoom, &exBed, &exYear, &exFrom, &exTo, &exStatus, &exUni); err != nil {
		return errors.New("رکورد سکونت یافت نشد.")
	}
	if exUni != nil && *exUni != *uniID {
		return errors.New("دانشجو متعلق به دانشگاه دیگری است.")
	}
	if err := s.studentInUniversity(ctx, user, cookie, existingStudent); err != nil {
		return err
	}
	status := *exStatus
	if in.Status != nil && *in.Status != "" {
		status = *in.Status
	}
	if !validDormStatus(status) {
		return errors.New("وضعیت نامعتبر است.")
	}
	if in.ValidFrom != nil {
		v, err := parseDormDate(in.ValidFrom)
		if err != nil {
			return err
		}
		if v != nil {
			exFrom = v
		}
	}
	if in.ValidTo != nil {
		v, err := parseDormDate(in.ValidTo)
		if err != nil {
			return err
		}
		if v != nil {
			exTo = v
		}
	}
	if in.DormName != nil {
		exDorm = in.DormName
	}
	if in.RoomNo != nil {
		exRoom = in.RoomNo
	}
	if in.BedNo != nil {
		exBed = in.BedNo
	}
	if in.AcademicYear != nil {
		exYear = in.AcademicYear
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		update dorm_residences set "dormName" = $2, "roomNo" = $3, "bedNo" = $4, "academicYear" = $5,
		       "validFrom" = $6, "validTo" = $7, status = $8, "updatedAt" = now() where id = $1`,
		id, exDorm, exRoom, exBed, exYear, exFrom, exTo, status); err != nil {
		return err
	}
	details := fmt.Sprintf(`{"studentId":%d,"status":%s}`, existingStudent, jsonQuote(status))
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "DORM_RESIDENCE_UPDATE", "dorm_residence", id, details); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeleteDormResidence delete an erroneous residence + audit.
func (s *Service) DeleteDormResidence(ctx context.Context, user *session.User, cookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	var studentID int64
	var rowUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "studentId", "universityId" from dorm_residences where id = $1`, id).
		Scan(&studentID, &rowUni); err != nil {
		return errors.New("رکورد سکونت یافت نشد.")
	}
	if rowUni != nil && *rowUni != *uniID {
		return errors.New("دسترسی ندارید.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from dorm_residences where id = $1`, id); err != nil {
		return err
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "DORM_RESIDENCE_DELETE", "dorm_residence", id,
		fmt.Sprintf(`{"studentId":%d}`, studentID)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// StudentSearchForAdmin student search for admin pickers (at least 2 characters).
func (s *Service) StudentSearchForAdmin(ctx context.Context, user *session.User, cookie, q string) ([]WarningStudentHit, error) {
	return s.SearchWarningStudents(ctx, user, cookie, q)
}

func nilEmpty(p *string) *string {
	if p == nil {
		return nil
	}
	v := strings.TrimSpace(*p)
	if v == "" {
		return nil
	}
	return &v
}

func derefOr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
