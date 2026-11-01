// ═══ Lesson plan monitoring for offerings (admin) — port of admin/lesson-plans ═══
package admin

import (
	"context"
	"errors"
	"strings"

	"backend-go/internal/session"
)

// LessonPlanStatusRow: lesson plan status of an offering.
type LessonPlanStatusRow struct {
	OfferingID    int64   `json:"offeringId"`
	CourseTitle   string  `json:"courseTitle"`
	ProfessorName string  `json:"professorName"`
	Status        string  `json:"status"`
	SessionsCount int     `json:"sessionsCount"`
	WeightsSum    float64 `json:"weightsSum"`
	UpdatedAt     *string `json:"updatedAt"`
}

// AdminLessonPlansData: monitoring page response.
type AdminLessonPlansData struct {
	Rows     []LessonPlanStatusRow `json:"rows"`
	Required bool                  `json:"required"`
	Notice   *string               `json:"notice"`
	Title    string                `json:"universityTitle"`
}

// GetAdminLessonPlans port of listLessonPlanStatus + settings.
func (s *Service) GetAdminLessonPlans(ctx context.Context, user *session.User, cookie string) (*AdminLessonPlansData, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال مشخص نیست.")
	}
	resp := &AdminLessonPlansData{Rows: []LessonPlanStatusRow{}}
	_ = s.DB.Pool.QueryRow(ctx, `select title from universities where id = $1`, *uniID).Scan(&resp.Title)
	var required int
	_ = s.DB.Pool.QueryRow(ctx, `
		select coalesce("isRequired",0), notice from lesson_plan_settings where "universityId" = $1 limit 1`,
		*uniID).Scan(&required, &resp.Notice)
	resp.Required = required != 0

	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.title,
		       coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",''),
		       coalesce(lp.status,'NONE'),
		       coalesce((select count(*) from lesson_plan_sessions ps where ps."planId" = lp.id),0)::int,
		       coalesce((select sum(pw.percent) from lesson_plan_weights pw where pw."planId" = lp.id),0)::float8,
		       lp."updatedAt"::text
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		  left join lesson_plans lp on lp."offeringId" = o.id
		 where o."universityId" = $1
		 order by o.id`, *uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r LessonPlanStatusRow
		if err := rows.Scan(&r.OfferingID, &r.CourseTitle, &r.ProfessorName, &r.Status,
			&r.SessionsCount, &r.WeightsSum, &r.UpdatedAt); err != nil {
			return nil, err
		}
		r.ProfessorName = strings.TrimSpace(r.ProfessorName)
		if r.ProfessorName == "" {
			r.ProfessorName = "—"
		}
		resp.Rows = append(resp.Rows, r)
	}
	return resp, rows.Err()
}

// SetLessonPlanRequired port of setLessonPlanRequired — informational banner only; not a technical block.
func (s *Service) SetLessonPlanRequired(ctx context.Context, user *session.User, cookie string, isRequired bool, notice string) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	var one int
	if err := s.DB.Pool.QueryRow(ctx, `select 1 from universities where id = $1`, *uniID).Scan(&one); err != nil {
		return errors.New("دانشگاه یافت نشد.")
	}
	clean := strings.TrimSpace(notice)
	if len([]rune(clean)) > 2000 {
		clean = string([]rune(clean)[:2000])
	}
	var noticePtr *string
	if clean != "" {
		noticePtr = &clean
	}
	val := 0
	if isRequired {
		val = 1
	}
	_, err := s.DB.Pool.Exec(ctx, `
		insert into lesson_plan_settings ("universityId","isRequired",notice,"updatedAt")
		values ($1,$2,$3,now())
		on conflict ("universityId") do update
		   set "isRequired" = excluded."isRequired", notice = excluded.notice, "updatedAt" = now()`,
		*uniID, val, noticePtr)
	return err
}
