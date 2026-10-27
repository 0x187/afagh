// ═══ سرویس پورتال استاد (فاز ۴) ═══
package professor

import (
	"context"
	"errors"
	"strings"
	"time"

	"backend-go/internal/archive"
	"backend-go/internal/db"
	"backend-go/internal/scope"
)

// Settings حداقل تنظیمات.
type Settings interface {
	Get(ctx context.Context, key string) (string, error)
	GetNumber(ctx context.Context, key string, fallback float64) float64
	GetBool(ctx context.Context, key string) bool
}

// Service سرویس استاد.
type Service struct {
	DB         *db.DB
	Settings   Settings
	Scope      *scope.Service
	Archive    *archive.Store
	Production bool
}

func New(database *db.DB, settings Settings, scopeSvc *scope.Service) *Service {
	return &Service{DB: database, Settings: settings, Scope: scopeSvc}
}

// Staff پروندهٔ هیئت علمی.
type Staff struct {
	ID              int64
	UserID          int64
	StaffCode       string
	UniversityID    *int64
	DepartmentID    *int64
	AcademicRank    *string
	CooperationType *string
	EmploymentType  *string
	StaffType       *string
	Name            string
}

// ResolveStaff پورت getStaffByUser.
func (s *Service) ResolveStaff(ctx context.Context, userID int64) (*Staff, error) {
	var st Staff
	err := s.DB.Pool.QueryRow(ctx, `
		select st.id, st."userId", st."staffCode", st."universityId", st."departmentId",
		       st."academicRank", st."cooperationType", st."employmentType", st."staffType",
		       coalesce(u."firstName" || ' ' || u."lastName", '')
		  from staff st join users u on u.id = st."userId"
		 where st."userId" = $1 limit 1`, userID).
		Scan(&st.ID, &st.UserID, &st.StaffCode, &st.UniversityID, &st.DepartmentID,
			&st.AcademicRank, &st.CooperationType, &st.EmploymentType, &st.StaffType, &st.Name)
	if err != nil {
		return nil, nil
	}
	st.Name = strings.TrimSpace(st.Name)
	return &st, nil
}

// TermInfo ترم فعال.
type TermInfo struct {
	ID            *int64  `json:"id"`
	Title         string  `json:"title"`
	TermCode      string  `json:"termCode"`
	GradeDeadline *string `json:"gradeEntryDeadline"`
}

// ResolveTerm پورت professorTermFilter: ترم انتخابی کوکی، وگرنه ترم مؤثر.
func (s *Service) ResolveTerm(ctx context.Context, universityID *int64, cookie *int64) TermInfo {
	selection := s.Scope.GetTermScope(ctx, universityID, cookie)
	termID := selection.EffectiveID
	if selection.SelectedID != nil {
		termID = selection.SelectedID
	}
	info := TermInfo{ID: termID}
	if termID == nil {
		return info
	}
	var deadline *string
	_ = s.DB.Pool.QueryRow(ctx, `select title, "termCode", "gradeEntryDeadline"::text from academic_terms where id = $1`, *termID).
		Scan(&info.Title, &info.TermCode, &deadline)
	info.GradeDeadline = deadline
	return info
}

// ownedOfferings شرط ارائه‌های استاد (مدرس اصلی یا عضو درس مشترک).
func (s *Service) ownedOfferings(ctx context.Context, staffID, termID int64, universityID *int64) ([]int64, error) {
	q := `select o.id from course_offerings o
	       where o."termId" = $1 and (o."professorId" = $2 or exists (
	         select 1 from offering_professors op where op."offeringId" = o.id and op."staffId" = $2))`
	args := []any{termID, staffID}
	if universityID != nil {
		q += ` and o."universityId" = $3`
		args = append(args, *universityID)
	}
	rows, err := s.DB.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			out = append(out, id)
		}
	}
	return out, rows.Err()
}

// ScheduleRow ردیف برنامهٔ استاد.
type ScheduleRow struct {
	ID            int64   `json:"id"`
	Code          string  `json:"code"`
	Title         string  `json:"title"`
	Units         float64 `json:"units"`
	CourseType    string  `json:"courseType"`
	GroupNumber   int     `json:"group"`
	EnrolledCount int     `json:"enrolledCount"`
	Capacity      int     `json:"capacity"`
	DayOfWeek     *int    `json:"dayOfWeek"`
	DayName       string  `json:"dayName"`
	StartTime     string  `json:"startTime"`
	EndTime       string  `json:"endTime"`
	RoomName      string  `json:"roomName"`
	BuildingName  string  `json:"buildingName"`
	WeekType      string  `json:"weekType"`
	IsCoTaught    bool    `json:"isCoTaught"`
	CoPartnerName *string `json:"coPartnerName"`
	HasSchedule   bool    `json:"hasSchedule"`
	SharedKey     *string `json:"sharedScheduleGroupKey"`
}

var dayNames = []string{"شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"}

func mapCourseType(raw string) string {
	switch {
	case strings.Contains(raw, "عملی"), strings.Contains(raw, "کارگاه"), strings.Contains(raw, "آزمایش"):
		return "عملی"
	case strings.Contains(raw, "پایه"):
		return "پایه"
	case strings.Contains(raw, "تخصصی"):
		return "تخصصی"
	case strings.Contains(raw, "عمومی"):
		return "عمومی"
	}
	return "اصلی"
}

func mapWeekType(raw string) string {
	switch strings.ToUpper(raw) {
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

// ScheduleRows پورت professorScheduleRows.
func (s *Service) ScheduleRows(ctx context.Context, staffID, termID int64, universityID *int64) ([]ScheduleRow, error) {
	ids, err := s.ownedOfferings(ctx, staffID, termID, universityID)
	if err != nil || len(ids) == 0 {
		return []ScheduleRow{}, err
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.code, c.title, c.units, coalesce(c."courseNature",''),
		       coalesce(o."groupNumber",0), coalesce(o."enrolledCount",0), o.capacity,
		       sc.id, sc."scheduleType", sc."dayOfWeek", sc."startTime"::text, sc."endTime"::text,
		       cr.name, cr."buildingName", o."sharedScheduleGroupKey"
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join schedules sc on sc."offeringId" = o.id
		  left join classrooms cr on cr.id = sc."roomId"
		 where o.id = any($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// همکاران درس مشترک.
	partners := s.coTaughtPartners(ctx, ids)

	seen := map[string]bool{}
	out := []ScheduleRow{}
	for rows.Next() {
		var (
			r              ScheduleRow
			courseNature   string
			scheduleID     *int64
			scheduleType   *string
			day            *int
			start, end     *string
			room, building *string
			sharedKey      *string
		)
		if err := rows.Scan(&r.ID, &r.Code, &r.Title, &r.Units, &courseNature,
			&r.GroupNumber, &r.EnrolledCount, &r.Capacity, &scheduleID, &scheduleType,
			&day, &start, &end, &room, &building, &sharedKey); err != nil {
			continue
		}
		key := itoa64(r.ID) + ":"
		if scheduleID != nil {
			key += itoa64(*scheduleID)
		} else {
			key += "none"
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		// جلسات امتحان در برنامهٔ هفتگی تدریس نمایش داده نمی‌شوند.
		if scheduleType != nil && strings.ToUpper(*scheduleType) == "EXAM" {
			continue
		}
		r.CourseType = mapCourseType(courseNature)
		if day != nil {
			r.DayOfWeek = day
			if *day >= 0 && *day < len(dayNames) {
				r.DayName = dayNames[*day]
			}
		}
		if start != nil {
			r.StartTime = clock5(*start)
		}
		if end != nil {
			r.EndTime = clock5(*end)
		}
		if room != nil {
			r.RoomName = *room
		}
		if building != nil {
			r.BuildingName = *building
		}
		wt := ""
		if scheduleType != nil {
			wt = *scheduleType
		}
		r.WeekType = mapWeekType(wt)
		r.HasSchedule = r.DayOfWeek != nil && r.StartTime != "" && r.EndTime != ""
		r.SharedKey = sharedKey
		if p, ok := partners[r.ID]; ok {
			r.IsCoTaught = true
			name := p
			r.CoPartnerName = &name
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Service) coTaughtPartners(ctx context.Context, offeringIDs []int64) map[int64]string {
	out := map[int64]string{}
	if len(offeringIDs) == 0 {
		return out
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select op."offeringId", coalesce(u."firstName" || ' ' || u."lastName",''),
		       coalesce(op."sharePercentage",0)
		  from offering_professors op
		  join staff st on st.id = op."staffId"
		  join users u on u.id = st."userId"
		 where op."offeringId" = any($1)`, offeringIDs)
	if err != nil {
		return out
	}
	defer rows.Close()
	best := map[int64]float64{}
	for rows.Next() {
		var oid int64
		var name string
		var share float64
		if err := rows.Scan(&oid, &name, &share); err != nil {
			continue
		}
		if cur, ok := best[oid]; !ok || share > cur {
			best[oid] = share
			out[oid] = strings.TrimSpace(name)
		}
	}
	return out
}

func itoa64(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	buf := [20]byte{}
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func nowISO() string { return time.Now().UTC().Format(time.RFC3339) }

var errNoStaff = errors.New("پروندهٔ هیئت علمی یافت نشد.")
