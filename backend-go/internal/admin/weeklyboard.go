// ═══ تختهٔ هفتگی — پورت admin/weekly-board (نمای خواندنی) ═══
package admin

import (
	"context"
	"strings"

	"backend-go/internal/session"
)

// BoardRow یک جلسهٔ هفتگی.
type BoardRow struct {
	OfferingID    int64   `json:"offeringId"`
	Group         int     `json:"groupNumber"`
	Code          string  `json:"courseCode"`
	Title         string  `json:"courseTitle"`
	CourseType    string  `json:"courseType"`
	DayOfWeek     *int    `json:"dayOfWeek"`
	StartTime     string  `json:"startTime"`
	EndTime       string  `json:"endTime"`
	RoomID        *int64  `json:"roomId"`
	RoomName      *string `json:"roomName"`
	BuildingName  *string `json:"buildingName"`
	Professor     string  `json:"professor"`
	Department    *string `json:"departmentName"`
	EnrolledCount int     `json:"enrolledCount"`
	Capacity      int     `json:"capacity"`
}

// WeeklyBoardData پاسخ تخته.
type WeeklyBoardData struct {
	Term        AdminTerm  `json:"term"`
	Rows        []BoardRow `json:"rows"`
	Rooms       []Option   `json:"rooms"`
	Departments []Option   `json:"departments"`
	Professors  []Option   `json:"professors"`
}

// GetWeeklyBoard فهرست جلسات هفتگی ترم جاری با گزینه‌های فیلتر.
func (s *Service) GetWeeklyBoard(ctx context.Context, user *session.User, uniCookie string) (*WeeklyBoardData, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	resp := &WeeklyBoardData{Rows: []BoardRow{}, Rooms: []Option{}, Departments: []Option{}, Professors: []Option{}}
	if uniID == nil {
		return resp, nil
	}
	var termID int64
	var title, code string
	var flag int
	if err := s.DB.Pool.QueryRow(ctx, `
		select id, title, "termCode", coalesce("isEnrollmentOpen",0) from academic_terms
		 where "isCurrent" = 1 and "universityId" = $1 order by id desc limit 1`, *uniID).
		Scan(&termID, &title, &code, &flag); err != nil {
		return resp, nil
	}
	resp.Term = AdminTerm{ID: &termID, Title: title, Code: code, IsOpen: flag != 0}

	rows, err := s.DB.Pool.Query(ctx, `
		select s."offeringId", coalesce(o."groupNumber",0), c.code, c.title,
		       coalesce(c."courseNature",''), s."dayOfWeek", s."startTime"::text, s."endTime"::text,
		       s."roomId", cr.name, cr."buildingName",
		       coalesce(u."firstName" || ' ' || u."lastName",''),
		       d.name, coalesce(o."enrolledCount",0), o.capacity
		  from schedules s
		  join course_offerings o on o.id = s."offeringId"
		  join courses c on c.id = o."courseId"
		  left join classrooms cr on cr.id = s."roomId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		  left join departments d on d.id = c."departmentId"
		 where o."termId" = $1 and s."scheduleType" = 'CLASS' and s."dayOfWeek" is not null
		 order by s."dayOfWeek", s."startTime", c.title`, termID)
	if err != nil {
		return resp, nil
	}
	defer rows.Close()
	for rows.Next() {
		var r BoardRow
		if err := rows.Scan(&r.OfferingID, &r.Group, &r.Code, &r.Title, &r.CourseType,
			&r.DayOfWeek, &r.StartTime, &r.EndTime, &r.RoomID, &r.RoomName, &r.BuildingName,
			&r.Professor, &r.Department, &r.EnrolledCount, &r.Capacity); err == nil {
			r.StartTime = clock5(r.StartTime)
			r.EndTime = clock5(r.EndTime)
			r.Professor = strings.TrimSpace(r.Professor)
			resp.Rows = append(resp.Rows, r)
		}
	}
	rooms := map[int64]Option{}
	for _, r := range resp.Rows {
		if r.RoomID != nil && r.RoomName != nil {
			rooms[*r.RoomID] = Option{ID: *r.RoomID, Title: *r.RoomName}
		}
	}
	for id, o := range rooms {
		resp.Rooms = append(resp.Rooms, Option{ID: id, Title: o.Title})
	}
	sortOptions(resp.Rooms)
	depts := map[int64]Option{}
	for _, r := range resp.Rows {
		if r.Department != nil && *r.Department != "" {
			depts[0] = Option{ID: 0, Title: *r.Department}
		}
	}
	for _, o := range depts {
		resp.Departments = append(resp.Departments, o)
	}
	sortOptions(resp.Departments)
	profSeen := map[string]bool{}
	for _, r := range resp.Rows {
		if r.Professor != "" && !profSeen[r.Professor] {
			profSeen[r.Professor] = true
			resp.Professors = append(resp.Professors, Option{ID: 0, Title: r.Professor})
		}
	}
	sortOptions(resp.Professors)
	return resp, nil
}

func sortOptions(list []Option) {
	for i := 1; i < len(list); i++ {
		for j := i; j > 0 && list[j].Title < list[j-1].Title; j-- {
			list[j], list[j-1] = list[j-1], list[j]
		}
	}
}

func clock5(v string) string {
	if len(v) >= 5 {
		return v[:5]
	}
	return v
}
