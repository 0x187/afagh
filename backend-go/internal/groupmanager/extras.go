// ═══ تخصیص درس، جبرانی، بایپس و معادل‌سازی — پیکربندی مدیر گروه ═══
package groupmanager

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"backend-go/internal/enroll"
	"backend-go/internal/scope"
	"backend-go/internal/messaging"
)

// ───────────────────────── تخصیص درس ترم بالاتر ─────────────────────────

// GrantStudent دانشجو در فهرست.
type GrantStudent struct {
	ID          int64  `json:"id"`
	StudentCode string `json:"studentCode"`
	EntryYear   int    `json:"entryYear"`
	EntryTerm   *int   `json:"entryTerm"`
	MajorName   string `json:"majorName"`
	FullName    string `json:"fullName"`
}

// GrantChartRow ردیف چارت.
type GrantChartRow struct {
	CourseID    int64   `json:"courseId"`
	Code        string  `json:"code"`
	Title       string  `json:"title"`
	Units       float64 `json:"units"`
	Recommended *int    `json:"recommendedSemester"`
	Granted     bool    `json:"granted"`
	IsHigher    bool    `json:"isHigher"`
}

// GrantsData پاسخ صفحه.
type GrantsData struct {
	Majors        []MajorOption   `json:"majors"`
	Years         []int           `json:"years"`
	MajorID       int64           `json:"majorId"`
	Year          int             `json:"year"`
	Students      []GrantStudent  `json:"students"`
	Selected      *GrantStudent   `json:"selected"`
	TermOrdinal   *int            `json:"termOrdinal"`
	VersionCode   *string         `json:"versionCode"`
	ChartRows     []GrantChartRow `json:"chartRows"`
	ChartResolved bool            `json:"chartResolved"`
}

// GetGrants پورت group-manager/grants (خواندن).
func (s *Service) GetGrants(ctx context.Context, c *Ctx, majorID *int64, year *int, studentID *int64) (*GrantsData, error) {
	resp := &GrantsData{Majors: []MajorOption{}, Years: []int{}, Students: []GrantStudent{}, ChartRows: []GrantChartRow{}}
	rows, err := s.DB.Pool.Query(ctx, `select id, name from majors where "departmentId" = any($1) order by name`, c.deptIDs())
	if err == nil {
		for rows.Next() {
			var m MajorOption
			if err := rows.Scan(&m.ID, &m.Name); err == nil {
				resp.Majors = append(resp.Majors, m)
			}
		}
		rows.Close()
	}
	if len(resp.Majors) == 0 {
		return resp, nil
	}
	majorIDs := []int64{}
	for _, m := range resp.Majors {
		majorIDs = append(majorIDs, m.ID)
	}
	yrows, err := s.DB.Pool.Query(ctx, `
		select distinct "entryYear" from students where "majorId" = any($1) order by "entryYear" desc`, majorIDs)
	if err == nil {
		for yrows.Next() {
			var y *int
			if err := yrows.Scan(&y); err == nil && y != nil {
				resp.Years = append(resp.Years, *y)
			}
		}
		yrows.Close()
	}
	if majorID != nil {
		resp.MajorID = *majorID
	} else {
		resp.MajorID = resp.Majors[0].ID
	}
	if year != nil {
		resp.Year = *year
	} else if len(resp.Years) > 0 {
		resp.Year = resp.Years[0]
	}
	if resp.MajorID == 0 || resp.Year == 0 {
		return resp, nil
	}
	srows, err := s.DB.Pool.Query(ctx, `
		select st.id, st."studentCode", st."entryYear", st."entryTerm", m.name,
		       coalesce(u."firstName" || ' ' || u."lastName",'')
		  from students st
		  join majors m on m.id = st."majorId"
		  join users u on u.id = st."userId"
		 where st."majorId" = $1 and st."entryYear" = $2
		 order by u."lastName", u."firstName"`, resp.MajorID, resp.Year)
	if err == nil {
		for srows.Next() {
			var st GrantStudent
			if err := srows.Scan(&st.ID, &st.StudentCode, &st.EntryYear, &st.EntryTerm, &st.MajorName, &st.FullName); err == nil {
				st.FullName = strings.TrimSpace(st.FullName)
				resp.Students = append(resp.Students, st)
			}
		}
		srows.Close()
	}

	if studentID != nil {
		for i := range resp.Students {
			if resp.Students[i].ID == *studentID {
				v := resp.Students[i]
				resp.Selected = &v
				break
			}
		}
		if resp.Selected == nil {
			var st GrantStudent
			if err := s.DB.Pool.QueryRow(ctx, `
				select st.id, st."studentCode", st."entryYear", st."entryTerm", m.name,
				       coalesce(u."firstName" || ' ' || u."lastName",'')
				  from students st join majors m on m.id = st."majorId" join users u on u.id = st."userId"
				 where st.id = $1`, *studentID).
				Scan(&st.ID, &st.StudentCode, &st.EntryYear, &st.EntryTerm, &st.MajorName, &st.FullName); err == nil {
				st.FullName = strings.TrimSpace(st.FullName)
				resp.Selected = &st
			}
		}
	}

	if resp.Selected != nil {
		// شمارهٔ ترم جاری دانشجو.
		var termCode string
		if c.Staff.UniversityID != nil {
			_ = s.DB.Pool.QueryRow(ctx, `
				select "termCode" from academic_terms where "isCurrent" = 1 and "universityId" = $1
				 order by id desc limit 1`, *c.Staff.UniversityID).Scan(&termCode)
		}
		if termCode != "" {
			resp.TermOrdinal = scope.TermOrdinalForEntry(&resp.Selected.EntryYear, resp.Selected.EntryTerm, termCode)
		}
		version, err := enroll.ResolveStudentCurriculum(ctx, s.DB.Pool, resp.Selected.ID)
		if err == nil && version != nil {
			resp.ChartResolved = true
			v := version.VersionCode
			resp.VersionCode = &v
			granted := map[int64]bool{}
			grows, err := s.DB.Pool.Query(ctx, `select "courseId" from student_course_grants where "studentId" = $1`, resp.Selected.ID)
			if err == nil {
				for grows.Next() {
					var cid *int64
					if err := grows.Scan(&cid); err == nil && cid != nil {
						granted[*cid] = true
					}
				}
				grows.Close()
			}
			crows, err := s.DB.Pool.Query(ctx, `
				select cc."courseId", c.code, c.title, c.units, cc."recommendedSemester"
				  from curriculum_courses cc join courses c on c.id = cc."courseId"
				 where cc."curriculumVersionId" = $1`, version.ID)
			if err == nil {
				for crows.Next() {
					var row GrantChartRow
					if err := crows.Scan(&row.CourseID, &row.Code, &row.Title, &row.Units, &row.Recommended); err == nil {
						row.Granted = granted[row.CourseID]
						row.IsHigher = row.Recommended != nil && resp.TermOrdinal != nil && *row.Recommended > *resp.TermOrdinal
						resp.ChartRows = append(resp.ChartRows, row)
					}
				}
				crows.Close()
			}
		}
	}
	return resp, nil
}

// SaveGrant پورت grantCourseAction / revokeGrantAction.
func (s *Service) SaveGrant(ctx context.Context, c *Ctx, studentID, courseID int64, reason string, revoke bool) error {
	var majorID *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "majorId" from students where id = $1`, studentID).Scan(&majorID); err != nil {
		return errors.New("دانشجو یافت نشد.")
	}
	if majorID == nil {
		return errors.New("رشتهٔ دانشجو مشخص نیست.")
	}
	var deptID *int64
	_ = s.DB.Pool.QueryRow(ctx, `select "departmentId" from majors where id = $1`, *majorID).Scan(&deptID)
	if deptID == nil || !c.hasDept(*deptID) {
		return errors.New("این دانشجو متعلق به گروه شما نیست.")
	}
	if revoke {
		_, err := s.DB.Pool.Exec(ctx, `delete from student_course_grants where "studentId" = $1 and "courseId" = $2`, studentID, courseID)
		return err
	}
	version, err := enroll.ResolveStudentCurriculum(ctx, s.DB.Pool, studentID)
	if err != nil || version == nil {
		return errors.New("برای این دانشجو چارت منتشرشده‌ای حل نشده است؛ تخصیص ممکن نیست.")
	}
	var exists int
	_ = s.DB.Pool.QueryRow(ctx, `
		select 1 from curriculum_courses where "curriculumVersionId" = $1 and "courseId" = $2 limit 1`,
		version.ID, courseID).Scan(&exists)
	if exists == 0 {
		return errors.New("این درس داخل چارت دانشجو نیست.")
	}
	reason = strings.TrimSpace(reason)
	var reasonPtr *string
	if reason != "" {
		reasonPtr = &reason
	}
	_, err = s.DB.Pool.Exec(ctx, `
		insert into student_course_grants ("studentId","courseId","curriculumVersionId",reason,"grantedByStaffId")
		values ($1,$2,$3,$4,$5)
		on conflict ("studentId","courseId") do update set reason = excluded.reason, "grantedByStaffId" = excluded."grantedByStaffId"`,
		studentID, courseID, version.ID, reasonPtr, c.Staff.ID)
	return err
}

// ───────────────────────── دانشجویان جبرانی ─────────────────────────

// CompensatoryRow ردیف دانشجوی جبرانی.
type CompensatoryRow struct {
	ID                    int64   `json:"id"`
	StudentCode           string  `json:"studentCode"`
	EntryYear             int     `json:"entryYear"`
	FullName              string  `json:"fullName"`
	MajorName             string  `json:"majorName"`
	CompensatoryUnits     *int    `json:"compensatoryUnits"`
	PreviousMajorCode     *string `json:"previousMajorCode"`
	PreviousMajorTitle    *string `json:"previousMajorTitle"`
	PreviousMajorRelation *string `json:"previousMajorRelation"`
	HonorsOverride        *int    `json:"honorsOverride"`
}

// CompensatoryData پاسخ صفحه.
type CompensatoryData struct {
	Majors   []MajorOption     `json:"majors"`
	Years    []int             `json:"years"`
	Year     int               `json:"year"`
	Students []CompensatoryRow `json:"students"`
}

// GetCompensatory پورت group-manager/compensatory.
func (s *Service) GetCompensatory(ctx context.Context, c *Ctx, year *int) (*CompensatoryData, error) {
	resp := &CompensatoryData{Majors: []MajorOption{}, Years: []int{}, Students: []CompensatoryRow{}}
	rows, err := s.DB.Pool.Query(ctx, `select id, name from majors where "departmentId" = any($1) order by name`, c.deptIDs())
	if err != nil {
		return nil, err
	}
	majorIDs := []int64{}
	for rows.Next() {
		var m MajorOption
		if err := rows.Scan(&m.ID, &m.Name); err == nil {
			resp.Majors = append(resp.Majors, m)
			majorIDs = append(majorIDs, m.ID)
		}
	}
	rows.Close()
	if len(majorIDs) == 0 {
		return resp, nil
	}
	yrows, err := s.DB.Pool.Query(ctx, `
		select distinct "entryYear" from students where "majorId" = any($1) order by "entryYear" desc`, majorIDs)
	if err == nil {
		for yrows.Next() {
			var y *int
			if err := yrows.Scan(&y); err == nil && y != nil {
				resp.Years = append(resp.Years, *y)
			}
		}
		yrows.Close()
	}
	if year != nil {
		resp.Year = *year
	} else if len(resp.Years) > 0 {
		resp.Year = resp.Years[0]
	}
	if resp.Year == 0 {
		return resp, nil
	}
	srows, err := s.DB.Pool.Query(ctx, `
		select st.id, st."studentCode", st."entryYear", m.name,
		       coalesce(u."firstName" || ' ' || u."lastName",''),
		       st."compensatoryUnits", st."previousMajorCode", st."previousMajorTitle",
		       st."previousMajorRelation", st."honorsOverride"
		  from students st
		  join majors m on m.id = st."majorId"
		  join users u on u.id = st."userId"
		 where st."majorId" = any($1) and st."entryYear" = $2
		 order by u."lastName", u."firstName"`, majorIDs, resp.Year)
	if err != nil {
		return nil, err
	}
	defer srows.Close()
	for srows.Next() {
		var r CompensatoryRow
		if err := srows.Scan(&r.ID, &r.StudentCode, &r.EntryYear, &r.MajorName, &r.FullName,
			&r.CompensatoryUnits, &r.PreviousMajorCode, &r.PreviousMajorTitle,
			&r.PreviousMajorRelation, &r.HonorsOverride); err == nil {
			r.FullName = strings.TrimSpace(r.FullName)
			resp.Students = append(resp.Students, r)
		}
	}
	return resp, nil
}

// SaveCompensatory ورودی تنظیم جبرانی.
type SaveCompensatory struct {
	StudentID             int64  `json:"studentId"`
	PreviousMajorCode     string `json:"previousMajorCode"`
	PreviousMajorTitle    string `json:"previousMajorTitle"`
	PreviousMajorRelation string `json:"previousMajorRelation"`
	CompensatoryUnits     int    `json:"compensatoryUnits"`
	HonorsOverride        *int   `json:"honorsOverride"`
}

// SaveCompensatoryAction پورت saveCompensatoryAction.
func (s *Service) SaveCompensatoryAction(ctx context.Context, c *Ctx, in SaveCompensatory) error {
	var majorID *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "majorId" from students where id = $1`, in.StudentID).Scan(&majorID); err != nil {
		return errors.New("دانشجو یافت نشد.")
	}
	if majorID == nil {
		return errors.New("رشتهٔ دانشجو مشخص نیست.")
	}
	var deptID *int64
	_ = s.DB.Pool.QueryRow(ctx, `select "departmentId" from majors where id = $1`, *majorID).Scan(&deptID)
	if deptID == nil || !c.hasDept(*deptID) {
		return errors.New("این دانشجو متعلق به گروه شما نیست.")
	}
	relation := in.PreviousMajorRelation
	if relation != "RELATED" && relation != "PARTIAL" && relation != "UNRELATED" {
		relation = ""
	}
	units := in.CompensatoryUnits
	if units < 0 {
		units = 0
	}
	_, err := s.DB.Pool.Exec(ctx, `
		update students set "previousMajorCode" = $1, "previousMajorTitle" = $2,
		       "previousMajorRelation" = $3, "compensatoryUnits" = $4, "honorsOverride" = $5
		 where id = $6`,
		nilIfEmpty(in.PreviousMajorCode), nilIfEmpty(in.PreviousMajorTitle),
		nilIfEmpty(relation), units, in.HonorsOverride, in.StudentID)
	return err
}

// BulkCompensatory پورت bulkCompensatoryAction.
func (s *Service) BulkCompensatory(ctx context.Context, c *Ctx, year, units int) error {
	majorIDs := []int64{}
	rows, err := s.DB.Pool.Query(ctx, `select id from majors where "departmentId" = any($1)`, c.deptIDs())
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			majorIDs = append(majorIDs, id)
		}
	}
	rows.Close()
	if len(majorIDs) == 0 {
		return nil
	}
	_, err = s.DB.Pool.Exec(ctx, `
		update students set "compensatoryUnits" = $1
		 where "majorId" = any($2) and "entryYear" = $3 and "previousMajorRelation" = 'UNRELATED'`,
		units, majorIDs, year)
	return err
}

// ───────────────────────── بایپس پیش‌نیاز / تداخل ─────────────────────────

// BypassRow درخواست بایپس.
type BypassRow struct {
	ID          int64   `json:"id"`
	StudentID   int64   `json:"studentId"`
	StudentCode string  `json:"studentCode"`
	StudentName string  `json:"studentName"`
	CourseTitle string  `json:"courseTitle"`
	CourseCode  string  `json:"courseCode"`
	Kind        string  `json:"kind"`
	Status      string  `json:"status"`
	ReasonText  *string `json:"reasonText"`
	CreatedAt   *string `json:"createdAt"`
}

// GetBypass پورت bypassInboxForManager.
func (s *Service) GetBypass(ctx context.Context, c *Ctx) ([]BypassRow, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select r.id, r."studentId", st."studentCode",
		       coalesce(u."firstName" || ' ' || u."lastName",''),
		       co.title, co.code, r.kind, r.status, r."reasonText", r."createdAt"::text
		  from enroll_bypass_requests r
		  join course_offerings o on o.id = r."offeringId"
		  join courses co on co.id = o."courseId"
		  join students st on st.id = r."studentId"
		  join users u on u.id = st."userId"
		 where r.status in ('PENDING_MANAGER','ESCALATED_EXPERT')
		   and co."departmentId" = any($1)
		 order by r.id`, c.deptIDs())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BypassRow{}
	for rows.Next() {
		var r BypassRow
		if err := rows.Scan(&r.ID, &r.StudentID, &r.StudentCode, &r.StudentName,
			&r.CourseTitle, &r.CourseCode, &r.Kind, &r.Status, &r.ReasonText, &r.CreatedAt); err == nil {
			r.StudentName = strings.TrimSpace(r.StudentName)
			out = append(out, r)
		}
	}
	return out, nil
}

func (s *Service) bypassInScope(ctx context.Context, c *Ctx, requestID int64) (studentID, offeringID int64, kind, status string, seatReserved int, err error) {
	err = s.DB.Pool.QueryRow(ctx, `
		select r."studentId", r."offeringId", r.kind, r.status, coalesce(r."seatReserved",0)
		  from enroll_bypass_requests r
		  join course_offerings o on o.id = r."offeringId"
		  join courses co on co.id = o."courseId"
		 where r.id = $1`, requestID).Scan(&studentID, &offeringID, &kind, &status, &seatReserved)
	if err != nil {
		return 0, 0, "", "", 0, errors.New("درخواست یافت نشد.")
	}
	var deptID *int64
	_ = s.DB.Pool.QueryRow(ctx, `select "departmentId" from courses co join course_offerings o on o."courseId" = co.id where o.id = $1`, offeringID).Scan(&deptID)
	if deptID == nil || !c.hasDept(*deptID) {
		return 0, 0, "", "", 0, errors.New("این درخواست در دامنهٔ گروه شما نیست.")
	}
	return studentID, offeringID, kind, status, seatReserved, nil
}

// DecideBypass پورت approveBypassAction/rejectBypassAction.
func (s *Service) DecideBypass(ctx context.Context, c *Ctx, requestID int64, approve bool, reasonCode, reasonText string) error {
	studentID, offeringID, kind, status, seatReserved, err := s.bypassInScope(ctx, c, requestID)
	if err != nil {
		return err
	}
	if status != "PENDING_MANAGER" && status != "ESCALATED_EXPERT" {
		return errors.New("این درخواست قبلاً بسته شده است.")
	}
	kindLabel := "محدودیت"
	if kind == "PREREQ" {
		kindLabel = "پیش‌نیاز"
	} else if kind == "EXAM_CONFLICT" {
		kindLabel = "تداخل امتحانی"
	}
	if approve {
		var universityID *int64
		_ = s.DB.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, studentID).Scan(&universityID)
		tx, err := s.DB.Pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx) //nolint:errcheck
		if _, err := tx.Exec(ctx, `
			insert into enrollments ("studentId","offeringId",status,"universityId","enrollOverride","enrollOverrideReason","enrolledByUserId")
			values ($1,$2,'REGISTERED',$3,1,$4,$5)
			on conflict ("studentId","offeringId") do update
			   set status = 'REGISTERED', "enrollOverride" = 1,
			       "enrollOverrideReason" = excluded."enrollOverrideReason",
			       "enrolledByUserId" = excluded."enrolledByUserId"`,
			studentID, offeringID, universityID, "تأیید درخواست بدون رعایت "+kindLabel, c.Staff.UserID); err != nil {
			return err
		}
		_, _ = tx.Exec(ctx, `delete from cart_items where "studentId" = $1 and "offeringId" = $2`, studentID, offeringID)
		if _, err := tx.Exec(ctx, `
			update enroll_bypass_requests set status = 'APPROVED', "decidedRole" = 'MANAGER',
			       "decidedByUserId" = $1, "decidedAt" = now(), "seatReserved" = 0, "updatedAt" = now()
			 where id = $2`, c.Staff.UserID, requestID); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		s.notifyStudent(ctx, studentID, "BYPASS_APPROVED", fmt.Sprintf(
			"درخواست ثبت درس «%s» بدون رعایت %s تأیید شد و درس به‌صورت خودکار در انتخاب واحد شما ثبت گردید.", s.courseTitle(ctx, offeringID), kindLabel))
		return nil
	}

	if reasonCode == "" {
		return errors.New("دلیل رد الزامی است.")
	}
	if reasonCode == "OTHER" && strings.TrimSpace(reasonText) == "" {
		return errors.New("برای گزینهٔ «سایر» توضیح تکمیلی الزامی است.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `
		update enroll_bypass_requests set status = 'REJECTED', "reasonCode" = $1, "reasonText" = $2,
		       "decidedRole" = 'MANAGER', "decidedByUserId" = $3, "decidedAt" = now(),
		       "seatReserved" = 0, "updatedAt" = now()
		 where id = $4`, reasonCode, nilIfEmpty(reasonText), c.Staff.UserID, requestID); err != nil {
		return err
	}
	if seatReserved != 0 {
		_, _ = tx.Exec(ctx, `update course_offerings set "enrolledCount" = greatest("enrolledCount" - 1, 0) where id = $1`, offeringID)
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	reasonLabel := map[string]string{
		"LOW_GPA_PREV_TERM":          "معدل ترم قبل پایین است",
		"GROUP_COUNCIL_DISAGREE":     "نظر مخالف شورای گروه",
		"UNRESOLVABLE_EXAM_CONFLICT": "تداخل امتحانی غیرقابل رفع است",
		"OTHER":                      "سایر",
	}[reasonCode]
	if reasonLabel == "" {
		reasonLabel = reasonCode
	}
	extra := strings.TrimSpace(reasonText)
	msg := fmt.Sprintf("درخواست ثبت درس «%s» بدون رعایت %s رد شد. دلیل: %s.", s.courseTitle(ctx, offeringID), kindLabel, reasonLabel)
	if extra != "" {
		msg += " " + extra
	}
	s.notifyStudent(ctx, studentID, "BYPASS_REJECTED", msg)
	return nil
}

func (s *Service) courseTitle(ctx context.Context, offeringID int64) string {
	var title string
	_ = s.DB.Pool.QueryRow(ctx, `
		select c.title from course_offerings o join courses c on c.id = o."courseId" where o.id = $1`, offeringID).Scan(&title)
	return title
}

func (s *Service) notifyStudent(ctx context.Context, studentID int64, eventCode, text string) {
	var userID int64
	if err := s.DB.Pool.QueryRow(ctx, `select "userId" from students where id = $1`, studentID).Scan(&userID); err != nil {
		return
	}
	payload, _ := json.Marshal(map[string]string{"text": text})
	_, _ = s.DB.Pool.Exec(ctx, `insert into notifications ("userId","eventCode",payload) values ($1,$2,$3)`,
		userID, eventCode, string(payload))
	messaging.NotifyExternalDefault(ctx, userID, eventCode, text)
}

// ───────────────────────── معادل‌سازی ─────────────────────────

// EquivRequest درخواست معادل‌سازی.
type EquivRequest struct {
	ID                 int64       `json:"id"`
	TrackingCode       string      `json:"trackingCode"`
	CreatedAt          string      `json:"createdAt"`
	StudentName        string      `json:"studentName"`
	StudentCode        string      `json:"studentCode"`
	PreviousUniversity string      `json:"previousUniversity"`
	SourceCourseTitle  string      `json:"sourceCourseTitle"`
	SourceGrade        *float64    `json:"sourceGrade"`
	SourceUnits        *float64    `json:"sourceUnits"`
	SyllabusNote       string      `json:"syllabusNote"`
	Items              []EquivItem `json:"items"`
}

// EquivItem نگاشت.
type EquivItem struct {
	SourceTitle       string   `json:"sourceTitle"`
	SourceUnits       *float64 `json:"sourceUnits"`
	SourceGrade       *float64 `json:"sourceGrade"`
	TargetCourseCode  string   `json:"targetCourseCode"`
	TargetCourseTitle string   `json:"targetCourseTitle"`
	HeadComment       string   `json:"headComment"`
}

// EquivData پاسخ صفحه.
type EquivData struct {
	Requests   []EquivRequest `json:"requests"`
	OurCourses []struct {
		Code  string  `json:"code"`
		Title string  `json:"title"`
		Units float64 `json:"units"`
	} `json:"ourCourses"`
}

// GetEquivalence پورت group-manager/equivalence.
func (s *Service) GetEquivalence(ctx context.Context, c *Ctx) (*EquivData, error) {
	resp := &EquivData{Requests: []EquivRequest{}}
	resp.OurCourses = []struct {
		Code  string  `json:"code"`
		Title string  `json:"title"`
		Units float64 `json:"units"`
	}{}
	rows, err := s.DB.Pool.Query(ctx, `
		select r.id, r."trackingCode", r."createdAt"::text, r."formData",
		       coalesce(u."firstName" || ' ' || u."lastName",''), st."studentCode"
		  from student_requests r
		  join students st on st.id = r."studentId"
		  join users u on u.id = st."userId"
		  join process_definitions p on p.id = r."processId"
		  left join process_steps ps on ps.id = r."currentStepId"
		 where p.code = 'COURSE_TRANSFER' and ps."roleCode" = 'DEPARTMENT_HEAD'
		 order by r.id desc`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var req EquivRequest
		var formData string
		if err := rows.Scan(&req.ID, &req.TrackingCode, &req.CreatedAt, &formData, &req.StudentName, &req.StudentCode); err != nil {
			continue
		}
		req.StudentName = strings.TrimSpace(req.StudentName)
		var parsed map[string]any
		if json.Unmarshal([]byte(formData), &parsed) == nil {
			if v, ok := parsed["previousUniversity"].(string); ok {
				req.PreviousUniversity = v
			}
			if v, ok := parsed["sourceCourseTitle"].(string); ok {
				req.SourceCourseTitle = v
			}
			if v, ok := parsed["sourceGrade"].(float64); ok {
				req.SourceGrade = &v
			}
			if v, ok := parsed["sourceUnits"].(float64); ok {
				req.SourceUnits = &v
			}
			if v, ok := parsed["syllabusNote"].(string); ok {
				req.SyllabusNote = v
			}
			if rawItems, ok := parsed["items"].([]any); ok {
				for _, it := range rawItems {
					im, ok := it.(map[string]any)
					if !ok {
						continue
					}
					item := EquivItem{}
					if v, ok := im["sourceTitle"].(string); ok {
						item.SourceTitle = v
					}
					if v, ok := im["targetCourseCode"].(string); ok {
						item.TargetCourseCode = v
					}
					if v, ok := im["targetCourseTitle"].(string); ok {
						item.TargetCourseTitle = v
					}
					if v, ok := im["headComment"].(string); ok {
						item.HeadComment = v
					}
					req.Items = append(req.Items, item)
				}
			}
		}
		if req.Items == nil {
			req.Items = []EquivItem{}
		}
		resp.Requests = append(resp.Requests, req)
	}
	rows.Close()
	crows, err := s.DB.Pool.Query(ctx, `select code, title, coalesce(units,0) from courses order by code`)
	if err == nil {
		for crows.Next() {
			var cc struct {
				Code  string  `json:"code"`
				Title string  `json:"title"`
				Units float64 `json:"units"`
			}
			if err := crows.Scan(&cc.Code, &cc.Title, &cc.Units); err == nil {
				resp.OurCourses = append(resp.OurCourses, cc)
			}
		}
		crows.Close()
	}
	return resp, nil
}

// SubmitEquivalence پورت submitEquivalenceMappingAction.
func (s *Service) SubmitEquivalence(ctx context.Context, c *Ctx, requestID int64, items []EquivItem, note string) error {
	valid := []EquivItem{}
	for _, it := range items {
		if strings.TrimSpace(it.SourceTitle) == "" || strings.TrimSpace(it.TargetCourseCode) == "" {
			continue
		}
		if it.SourceGrade == nil || *it.SourceGrade < 12 {
			return fmt.Errorf("بر اساس آیین‌نامه، نمرهٔ «%s» باید ۱۲ یا بالاتر باشد.", it.SourceTitle)
		}
		valid = append(valid, it)
	}
	if len(valid) == 0 {
		return errors.New("حداقل یک درس نگاشت‌شده با کد مقصد الزامی است.")
	}
	var (
		studentID int64
		formData  string
	)
	if err := s.DB.Pool.QueryRow(ctx, `select "studentId", coalesce("formData",'{}') from student_requests where id = $1`, requestID).
		Scan(&studentID, &formData); err != nil {
		return errors.New("درخواست یافت نشد.")
	}
	var majorID *int64
	_ = s.DB.Pool.QueryRow(ctx, `select "majorId" from students where id = $1`, studentID).Scan(&majorID)
	if majorID != nil {
		var deptID *int64
		_ = s.DB.Pool.QueryRow(ctx, `select "departmentId" from majors where id = $1`, *majorID).Scan(&deptID)
		if deptID == nil || !c.hasDept(*deptID) {
			return errors.New("این درخواست متعلق به گروه شما نیست.")
		}
	}
	var parsed map[string]any
	_ = json.Unmarshal([]byte(formData), &parsed)
	if parsed == nil {
		parsed = map[string]any{}
	}
	parsed["items"] = valid
	parsed["headMappedBy"] = c.Staff.Name
	parsed["headMappedAt"] = nowISO()
	raw, _ := json.Marshal(parsed)
	if _, err := s.DB.Pool.Exec(ctx, `update student_requests set "formData" = $1 where id = $2`, string(raw), requestID); err != nil {
		return err
	}
	// گام بعدی گردش‌کار.
	var currentStepID *int64
	var processID int64
	if err := s.DB.Pool.QueryRow(ctx, `select "currentStepId", "processId" from student_requests where id = $1`, requestID).
		Scan(&currentStepID, &processID); err != nil {
		return err
	}
	var nextStepID *int64
	if currentStepID != nil {
		var order int
		_ = s.DB.Pool.QueryRow(ctx, `select "stepOrder" from process_steps where id = $1`, *currentStepID).Scan(&order)
		var id int64
		if err := s.DB.Pool.QueryRow(ctx, `
			select id from process_steps where "processId" = $1 and "stepOrder" > $2 order by "stepOrder" limit 1`,
			processID, order).Scan(&id); err == nil {
			nextStepID = &id
		}
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `
		update student_requests set "currentStepId" = $1,
		       status = case when $1::int is null then 'IN_REVIEW' else status end, "updatedAt" = now()
		 where id = $2`, nextStepID, requestID); err != nil {
		return err
	}
	stepNote := strings.TrimSpace(note)
	if stepNote == "" {
		stepNote = "تأیید علمی و انطباق سرفصل توسط مدیر گروه"
	}
	if _, err := tx.Exec(ctx, `
		insert into request_step_logs ("requestId","stepId","assignedAt","completedAt","actorStaffId","actorRole",action,note,"slaStatus")
		values ($1,$2,now(),now(),$3,'DEPARTMENT_HEAD','APPROVE',$4,'ON_TIME')`,
		requestID, currentStepID, c.Staff.ID, stepNote); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
