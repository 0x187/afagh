// ═══ Exam reports — port of r-exam ═══
package reports

import (
	"context"
	"fmt"
	"strings"

	"backend-go/internal/fa"
	"backend-go/internal/jalali"
)

func (s *Service) runEduExam(ctx context.Context, kind string, f Filters) (*Result, error) {
	switch kind {
	case "exam-session-sheet", "seat-numbers", "final-exam-schedule", "grade-entry-report", "grade-deadline":
	default:
		return nil, nil
	}
	term := f.Term
	if term == "" {
		term = s.latestTermCode(ctx)
	}
	if term == "" {
		return &Result{Columns: []Column{}, Rows: []map[string]any{}, Page: 1, Per: 1, TotalPages: 1, Summary: "هیچ ترم تحصیلی در سیستم ثبت نشده است."}, nil
	}
	uni := f.UniversityID

	switch kind {
	case "exam-session-sheet":
		args := []any{term, uni}
		from := `FROM exam_sessions es
			JOIN academic_terms t ON t.id = es."termId"
			LEFT JOIN seat_allocations sa ON sa."sessionId" = es.id
			LEFT JOIN exam_attendances ea ON ea."examId" = es.id
			LEFT JOIN exam_course_packets ep ON ep."examId" = es.id
			LEFT JOIN courses c ON c.id = ep."courseId"
			LEFT JOIN exam_minutes em ON em."sessionId" = es.id
			LEFT JOIN exam_halls h ON h.id = em."hallId"`
		cols := `es.id AS session_id, es."examDate" AS exam_date, es."startTime" AS start_time, es."endTime" AS end_time,
			COALESCE(NULLIF(STRING_AGG(DISTINCT c.title, '، '), ''), '—') AS courses,
			COALESCE(NULLIF(STRING_AGG(DISTINCT h.name, '، '), ''), '—') AS halls,
			COUNT(DISTINCT sa."enrollmentId")::int AS enrolled,
			CASE WHEN COUNT(ea.id) = 0 THEN NULL ELSE COUNT(DISTINCT CASE WHEN ea."isPresent" = 1 THEN ea.id END)::int END AS present,
			CASE WHEN COUNT(ea.id) = 0 THEN NULL ELSE COUNT(DISTINCT CASE WHEN COALESCE(ea."isPresent",0) = 0 THEN ea.id END)::int END AS absent,
			CASE WHEN COUNT(ea.id) = 0 THEN 'حضور ثبت نشده — فقط تعداد ثبت‌نامی' ELSE 'حضور ثبت شده' END AS attendance_note`
		rows, total, pages, err := s.pagedQuery(ctx, cols, from,
			`t."termCode" = $1 AND (es."universityId" = $2 OR es."universityId" IS NULL)`,
			`es.id, es."examDate", es."startTime", es."endTime"`, `ORDER BY exam_date, start_time`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "session_id", Title: "شناسه سانس"}, {Key: "exam_date", Title: "تاریخ امتحان", Format: "DATE"},
			{Key: "start_time", Title: "شروع"}, {Key: "end_time", Title: "پایان"},
			{Key: "courses", Title: "دروس"}, {Key: "halls", Title: "سالن‌ها"},
			{Key: "enrolled", Title: "ثبت‌نامی", Format: "NUMBER"}, {Key: "present", Title: "حاضر", Format: "NUMBER"},
			{Key: "absent", Title: "غایب", Format: "NUMBER"}, {Key: "attendance_note", Title: "وضعیت حضور"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s سانس امتحانی در ترم %s — ثبت‌نامی از seat_allocations، حضور از exam_attendances", jalali.GroupThousands(float64(total)), term)}, nil

	case "seat-numbers":
		args := []any{term, uni}
		conds := []string{`t."termCode" = $1`, `(sa."universityId" = $2 OR sa."universityId" IS NULL)`}
		conds = append(conds, studentWhere(f, &args))
		if f.SessionID > 0 {
			args = append(args, f.SessionID)
			conds = append(conds, fmt.Sprintf(`es.id = $%d`, len(args)))
		}
		from := `FROM seat_allocations sa
			JOIN exam_sessions es ON es.id = sa."sessionId"
			JOIN academic_terms t ON t.id = es."termId"
			JOIN enrollments e ON e.id = sa."enrollmentId"
			JOIN students s ON s.id = e."studentId"
			JOIN users u ON u.id = s."userId"
			LEFT JOIN majors m ON m.id = s."majorId"
			LEFT JOIN course_offerings o ON o.id = e."offeringId"
			LEFT JOIN courses c ON c.id = o."courseId"
			LEFT JOIN exam_halls h ON h.id = sa."hallId"`
		cols := `sa."seatNumber" AS seat, s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
			COALESCE(c.title, '—') AS course, COALESCE(h.name, '—') AS hall, es."examDate" AS exam_date, es."startTime" AS start_time`
		rows, total, pages, err := s.pagedQuery(ctx, cols, from, strings.Join(conds, " AND "), "", `ORDER BY hall, seat`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "seat", Title: "شماره صندلی", Format: "NUMBER"}, {Key: "code", Title: "شماره دانشجویی"},
			{Key: "name", Title: "نام"}, {Key: "course", Title: "درس"}, {Key: "hall", Title: "سالن"},
			{Key: "exam_date", Title: "تاریخ امتحان", Format: "DATE"}, {Key: "start_time", Title: "ساعت شروع"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s صندلی تخصیص‌یافته در ترم %s", jalali.GroupThousands(float64(total)), term)}, nil

	case "final-exam-schedule":
		args := []any{term, uni}
		from := `FROM schedules sc
			JOIN course_offerings o ON o.id = sc."offeringId"
			JOIN courses c ON c.id = o."courseId"
			JOIN academic_terms t ON t.id = o."termId"
			LEFT JOIN exam_halls h ON h.id = sc."roomId"
			LEFT JOIN staff st ON st.id = o."professorId"
			LEFT JOIN users pu ON pu.id = st."userId"`
		cols := `sc."examDate" AS exam_date, sc."startTime" AS start_time, sc."endTime" AS end_time,
			c.code AS course_code, c.title AS course, o."groupNumber" AS grp,
			COALESCE(pu."firstName" || ' ' || pu."lastName", 'تخصیص‌نیافته') AS professor,
			COALESCE(h.name, '—') AS room, o."enrolledCount" AS enrolled`
		rows, total, pages, err := s.pagedQuery(ctx, cols, from,
			`sc."scheduleType" = 'EXAM' AND sc."examDate" IS NOT NULL AND t."termCode" = $1 AND (o."universityId" = $2 OR o."universityId" IS NULL)`,
			"", `ORDER BY exam_date, start_time, course_code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "exam_date", Title: "تاریخ امتحان", Format: "DATE"}, {Key: "start_time", Title: "شروع"},
			{Key: "end_time", Title: "پایان"}, {Key: "course_code", Title: "کد درس"},
			{Key: "course", Title: "نام درس"}, {Key: "grp", Title: "گروه"}, {Key: "professor", Title: "استاد"},
			{Key: "room", Title: "سالن"}, {Key: "enrolled", Title: "ثبت‌نامی", Format: "NUMBER"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s امتحان برنامه‌ریزی‌شده در ترم %s", jalali.GroupThousands(float64(total)), term)}, nil

	case "grade-entry-report":
		args := []any{term, uni}
		qCond := "1=1"
		if strings.TrimSpace(f.Q) != "" {
			like := "%" + fa.EscapeLikeChars(strings.TrimSpace(f.Q)) + "%"
			args = append(args, like)
			p := fmt.Sprintf("$%d", len(args))
			qCond = `(st."staffCode" ILIKE ` + p + ` ESCAPE '\' OR pu."firstName" ILIKE ` + p + ` ESCAPE '\' OR pu."lastName" ILIKE ` + p + ` ESCAPE '\')`
		}
		from := `FROM offering_professors op
			JOIN course_offerings o ON o.id = op."offeringId"
			JOIN academic_terms t ON t.id = o."termId"
			JOIN staff st ON st.id = op."staffId"
			JOIN users pu ON pu.id = st."userId"`
		cols := `st."staffCode" AS code, pu."firstName" || ' ' || pu."lastName" AS professor,
			COUNT(DISTINCT op."offeringId")::int AS offerings,
			COUNT(DISTINCT CASE WHEN o."gradesFinalizedAt" IS NOT NULL THEN op."offeringId" END)::int AS finalized,
			COUNT(DISTINCT CASE WHEN o."gradesFinalizedAt" IS NULL THEN op."offeringId" END)::int AS pending`
		rows, total, pages, err := s.pagedQuery(ctx, cols, from,
			`t."termCode" = $1 AND (o."universityId" = $2 OR o."universityId" IS NULL) AND `+qCond,
			`st."staffCode", pu."firstName", pu."lastName"`, `ORDER BY pending DESC, professor`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "کد استاد"}, {Key: "professor", Title: "استاد"},
			{Key: "offerings", Title: "تعداد ارائه", Format: "NUMBER"},
			{Key: "finalized", Title: "نهایی‌شده", Format: "NUMBER"}, {Key: "pending", Title: "در انتظار ثبت", Format: "NUMBER"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s استاد دارای ارائه در ترم %s", jalali.GroupThousands(float64(total)), term)}, nil

	case "grade-deadline":
		args := []any{term, uni}
		from := `FROM course_offerings o
			JOIN academic_terms t ON t.id = o."termId"
			JOIN courses c ON c.id = o."courseId"
			LEFT JOIN staff st ON st.id = o."professorId"
			LEFT JOIN users pu ON pu.id = st."userId"`
		dl := `COALESCE(o."customGradeDeadline", t."gradeEntryDeadline")`
		cols := `c.code AS course_code, c.title AS course, o."groupNumber" AS grp,
			COALESCE(pu."firstName" || ' ' || pu."lastName", 'تخصیص‌نیافته') AS professor,
			` + dl + ` AS deadline,
			EXTRACT(DAY FROM (` + dl + ` - NOW()))::int AS days_left,
			CASE WHEN o."gradesFinalizedAt" IS NOT NULL THEN 'ثبت نهایی شده'
			  WHEN ` + dl + ` < NOW() THEN 'مهلت گذشته'
			  WHEN ` + dl + ` <= NOW() + INTERVAL '3 days' THEN 'فوری (≤۳ روز)'
			  ELSE 'باز' END AS status,
			CASE WHEN o."customGradeDeadline" IS NOT NULL THEN 'اختصاصی ارائه' ELSE 'مهلت ترم' END AS deadline_source`
		where := `t."termCode" = $1 AND (o."universityId" = $2 OR o."universityId" IS NULL) AND ` + dl + ` IS NOT NULL`
		rows, total, pages, err := s.pagedQuery(ctx, cols, from, where, "", `ORDER BY deadline`, args, f.Page)
		if err != nil {
			return nil, err
		}
		aggRows, err := s.Pool.Query(ctx, `SELECT CASE WHEN o."gradesFinalizedAt" IS NOT NULL THEN 'ثبت نهایی شده'
			WHEN `+dl+` < NOW() THEN 'مهلت گذشته' ELSE 'باز/فوری' END AS status, COUNT(*)::int AS n
			`+from+` WHERE `+where+` GROUP BY 1 ORDER BY 1`, args...)
		parts := []string{}
		if err == nil {
			for aggRows.Next() {
				var st string
				var n int
				if err := aggRows.Scan(&st, &n); err == nil {
					parts = append(parts, st+": "+jalali.GroupThousands(float64(n)))
				}
			}
			aggRows.Close()
		}
		extra := ""
		if len(parts) > 0 {
			extra = " (" + strings.Join(parts, " — ") + ")"
		}
		return &Result{Columns: []Column{
			{Key: "course_code", Title: "کد درس"}, {Key: "course", Title: "نام درس"}, {Key: "grp", Title: "گروه"},
			{Key: "professor", Title: "استاد"}, {Key: "deadline", Title: "مهلت ثبت", Format: "DATETIME"},
			{Key: "days_left", Title: "روز مانده", Format: "NUMBER"}, {Key: "status", Title: "وضعیت"},
			{Key: "deadline_source", Title: "منبع مهلت"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s ارائه دارای مهلت در ترم %s%s", jalali.GroupThousands(float64(total)), term, extra)}, nil
	}
	return nil, nil
}
