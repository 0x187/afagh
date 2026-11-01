// ═══ Instructor/attendance reports — port of r-staff ═══
package reports

import (
	"context"
	"fmt"
	"strings"

	"backend-go/internal/fa"
	"backend-go/internal/finance"
	"backend-go/internal/jalali"
)

func (s *Service) runEduStaff(ctx context.Context, kind string, f Filters) (*Result, error) {
	switch kind {
	case "staff-list", "staff-courses", "staff-timetable", "attendance-list":
	default:
		return nil, nil
	}
	term := f.Term
	uni := f.UniversityID

	switch kind {
	case "staff-list":
		args := []any{}
		conds := []string{}
		if uni > 0 {
			args = append(args, uni)
			conds = append(conds, fmt.Sprintf(`(st."universityId" = $%d OR st."universityId" IS NULL)`, len(args)))
		}
		if f.DepartmentID > 0 {
			args = append(args, f.DepartmentID)
			conds = append(conds, fmt.Sprintf(`st."departmentId" = $%d`, len(args)))
		}
		if f.FacultyID > 0 {
			args = append(args, f.FacultyID)
			conds = append(conds, fmt.Sprintf(`st."facultyId" = $%d`, len(args)))
		}
		if strings.TrimSpace(f.Q) != "" {
			args = append(args, "%"+fa.EscapeLikeChars(strings.TrimSpace(f.Q))+"%")
			p := fmt.Sprintf("$%d", len(args))
			conds = append(conds, `(st."staffCode" ILIKE `+p+` ESCAPE '\' OR u."firstName" ILIKE `+p+` ESCAPE '\' OR u."lastName" ILIKE `+p+` ESCAPE '\')`)
		}
		offCount := `(SELECT COUNT(DISTINCT o.id) FROM course_offerings o LEFT JOIN offering_professors op ON op."offeringId" = o.id WHERE (o."professorId" = st.id OR op."staffId" = st.id)) AS offerings`
		countArgs := append([]any{}, args...)
		if term != "" {
			args = append(args, term)
			offCount = fmt.Sprintf(`(SELECT COUNT(DISTINCT o.id) FROM course_offerings o JOIN academic_terms t ON t.id = o."termId" LEFT JOIN offering_professors op ON op."offeringId" = o.id WHERE (o."professorId" = st.id OR op."staffId" = st.id) AND t."termCode" = $%d) AS offerings`, len(args))
		}
		where := ""
		if len(conds) > 0 {
			where = strings.Join(conds, " AND ")
		}
		rows, total, pages, err := s.pagedQueryArgs(ctx,
			`st."staffCode" AS code, u."firstName" || ' ' || u."lastName" AS name, st."academicRank" AS rank,
			 dep.name AS department, st."staffType" AS type, `+offCount,
			`FROM staff st JOIN users u ON u.id = st."userId" LEFT JOIN departments dep ON dep.id = st."departmentId"`,
			where, "", `ORDER BY code`, countArgs, args, f.Page)
		if err != nil {
			return nil, err
		}
		sum := fmt.Sprintf("%s استاد", jalali.GroupThousands(float64(total)))
		if term != "" {
			sum += " — ترم " + term
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "کد استاد"}, {Key: "name", Title: "نام"}, {Key: "rank", Title: "مرتبه"},
			{Key: "department", Title: "گروه"}, {Key: "type", Title: "نوع همکاری"},
			{Key: "offerings", Title: "تعداد ارائه", Format: "NUMBER"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages, Summary: sum}, nil

	case "staff-courses":
		args := []any{}
		conds := []string{}
		if uni > 0 {
			args = append(args, uni)
			conds = append(conds, fmt.Sprintf(`(o."universityId" = $%d OR o."universityId" IS NULL)`, len(args)))
		}
		if term != "" {
			args = append(args, term)
			conds = append(conds, fmt.Sprintf(`t."termCode" = $%d`, len(args)))
		}
		if f.DepartmentID > 0 {
			args = append(args, f.DepartmentID)
			conds = append(conds, fmt.Sprintf(`c."departmentId" = $%d`, len(args)))
		}
		if strings.TrimSpace(f.Q) != "" {
			args = append(args, "%"+fa.EscapeLikeChars(strings.TrimSpace(f.Q))+"%")
			p := fmt.Sprintf("$%d", len(args))
			conds = append(conds, `(c.code ILIKE `+p+` ESCAPE '\' OR c.title ILIKE `+p+` ESCAPE '\' OR st."staffCode" ILIKE `+p+` ESCAPE '\' OR u."firstName" ILIKE `+p+` ESCAPE '\' OR u."lastName" ILIKE `+p+` ESCAPE '\')`)
		}
		where := ""
		if len(conds) > 0 {
			where = strings.Join(conds, " AND ")
		}
		rows, total, pages, err := s.pagedQuery(ctx,
			`st."staffCode" AS staff_code, u."firstName" || ' ' || u."lastName" AS staff_name,
			 c.code AS course_code, c.title AS course_title, o."groupNumber" AS grp,
			 o.capacity AS capacity, o."enrolledCount" AS enrolled, t."termCode" AS term`,
			`FROM course_offerings o JOIN academic_terms t ON t.id = o."termId"
			 JOIN courses c ON c.id = o."courseId" LEFT JOIN staff st ON st.id = o."professorId"
			 LEFT JOIN users u ON u.id = st."userId"`,
			where, "", `ORDER BY staff_code, course_code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		sum := fmt.Sprintf("%s ارائه", jalali.GroupThousands(float64(total)))
		if term != "" {
			sum += " در ترم " + term
		}
		return &Result{Columns: []Column{
			{Key: "staff_code", Title: "کد استاد"}, {Key: "staff_name", Title: "نام استاد"},
			{Key: "course_code", Title: "کد درس"}, {Key: "course_title", Title: "عنوان درس"},
			{Key: "grp", Title: "گروه"}, {Key: "capacity", Title: "ظرفیت", Format: "NUMBER"},
			{Key: "enrolled", Title: "ثبت‌نامی", Format: "NUMBER"}, {Key: "term", Title: "ترم"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages, Summary: sum}, nil

	case "staff-timetable":
		args := []any{}
		conds := []string{`s."scheduleType" <> 'EXAM'`}
		if uni > 0 {
			args = append(args, uni)
			conds = append(conds, fmt.Sprintf(`(o."universityId" = $%d OR o."universityId" IS NULL)`, len(args)))
		}
		if term != "" {
			args = append(args, term)
			conds = append(conds, fmt.Sprintf(`t."termCode" = $%d`, len(args)))
		}
		if strings.TrimSpace(f.Q) != "" {
			args = append(args, "%"+fa.EscapeLikeChars(strings.TrimSpace(f.Q))+"%")
			p := fmt.Sprintf("$%d", len(args))
			conds = append(conds, `(st."staffCode" ILIKE `+p+` ESCAPE '\' OR u."firstName" ILIKE `+p+` ESCAPE '\' OR u."lastName" ILIKE `+p+` ESCAPE '\' OR c.title ILIKE `+p+` ESCAPE '\')`)
		}
		rows, total, pages, err := s.pagedQuery(ctx,
			`st."staffCode" AS code, u."firstName" || ' ' || u."lastName" AS professor,
			 s."dayOfWeek" AS day, to_char(s."startTime",'HH24:MI') AS start,
			 to_char(s."endTime",'HH24:MI') AS finish, c.title AS course, r.name AS room`,
			`FROM schedules s JOIN course_offerings o ON o.id = s."offeringId"
			 JOIN academic_terms t ON t.id = o."termId" JOIN courses c ON c.id = o."courseId"
			 LEFT JOIN staff st ON st.id = o."professorId" LEFT JOIN users u ON u.id = st."userId"
			 LEFT JOIN classrooms r ON r.id = s."roomId"`,
			strings.Join(conds, " AND "), "", `ORDER BY s."dayOfWeek", s."startTime"`, args, f.Page)
		if err != nil {
			return nil, err
		}
		sum := fmt.Sprintf("%s جلسه هفتگی", jalali.GroupThousands(float64(total)))
		if term != "" {
			sum += " در ترم " + term
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "کد استاد"}, {Key: "professor", Title: "نام استاد"}, {Key: "day", Title: "روز هفته"},
			{Key: "start", Title: "شروع"}, {Key: "finish", Title: "پایان"}, {Key: "course", Title: "درس"},
			{Key: "room", Title: "کلاس"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages, Summary: sum}, nil

	case "attendance-list":
		showFinance := f.ShowFinance == "1" || strings.EqualFold(f.ShowFinance, "true")
		args := []any{}
		conds := []string{`e.status <> 'DROPPED'`}
		conds = append(conds, studentWhere(f, &args))
		if uni > 0 {
			args = append(args, uni)
			conds = append(conds, fmt.Sprintf(`(o."universityId" = $%d OR o."universityId" IS NULL)`, len(args)))
		}
		if term != "" {
			args = append(args, term)
			conds = append(conds, fmt.Sprintf(`t."termCode" = $%d`, len(args)))
		}
		if code := strings.TrimSpace(f.CourseCode); code != "" {
			args = append(args, code)
			conds = append(conds, fmt.Sprintf(`c.code = $%d`, len(args)))
		}
		if code := strings.TrimSpace(f.ProfessorCode); code != "" {
			args = append(args, code)
			conds = append(conds, fmt.Sprintf(`st."staffCode" = $%d`, len(args)))
		}
		if strings.TrimSpace(f.Q) != "" {
			args = append(args, "%"+fa.EscapeLikeChars(strings.TrimSpace(f.Q))+"%")
			p := fmt.Sprintf("$%d", len(args))
			conds = append(conds, `(c.code ILIKE `+p+` ESCAPE '\' OR c.title ILIKE `+p+` ESCAPE '\' OR st."staffCode" ILIKE `+p+` ESCAPE '\' OR u."lastName" ILIKE `+p+` ESCAPE '\' OR s."studentCode" ILIKE `+p+` ESCAPE '\')`)
		}
		financeCol := ""
		countArgs := append([]any{}, args...)
		columns := []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام دانشجو"},
			{Key: "course_code", Title: "کد درس"}, {Key: "course_title", Title: "عنوان درس"},
			{Key: "grp", Title: "گروه"}, {Key: "prof", Title: "کد استاد"}, {Key: "term", Title: "ترم"},
			{Key: "sessions", Title: "جلسات ثبت‌شده", Format: "NUMBER"}, {Key: "present", Title: "حاضر", Format: "NUMBER"},
			{Key: "absent", Title: "غایب", Format: "NUMBER"}, {Key: "present_pct", Title: "درصد حضور", Format: "NUMBER"},
		}
		if showFinance {
			debtIn := inList(&args, finance.DebtLedgerTypes)
			creditIn := inList(&args, finance.CreditLedgerTypes)
			financeCol = fmt.Sprintf(`, CASE WHEN COALESCE((SELECT SUM(CASE WHEN sl."transactionType" IN (%s) THEN sl.amount ELSE 0 END) - SUM(CASE WHEN sl."transactionType" IN (%s) THEN sl.amount ELSE 0 END) FROM student_ledger sl WHERE sl."studentId" = s.id),0) > 0 THEN 'بدهکار' ELSE 'تسویه' END AS finance`, debtIn, creditIn)
			columns = append(columns, Column{Key: "finance", Title: "وضعیت مالی"})
		}
		cols := `st."staffCode" AS prof, s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
			c.code AS course_code, c.title AS course_title, o."groupNumber" AS grp, t."termCode" AS term,
			att.sessions AS sessions, att.present AS present, att.absent AS absent,
			(CASE WHEN att.sessions > 0 THEN ROUND(100.0 * att.present / att.sessions)::float8 ELSE NULL END) AS present_pct` + financeCol
		from := `FROM enrollments e
			JOIN course_offerings o ON o.id = e."offeringId"
			JOIN academic_terms t ON t.id = o."termId"
			JOIN courses c ON c.id = o."courseId"
			JOIN students s ON s.id = e."studentId"
			JOIN users u ON u.id = s."userId"
			LEFT JOIN staff st ON st.id = o."professorId"
			LEFT JOIN LATERAL (
			  SELECT COUNT(*)::int AS sessions,
			         COUNT(*) FILTER (WHERE sca.status = 'PRESENT')::int AS present,
			         COUNT(*) FILTER (WHERE sca.status = 'ABSENT')::int AS absent
			    FROM student_class_attendance sca WHERE sca."enrollmentId" = e.id
			) att ON true`
		groupBy := `e.id, s.id, st."staffCode", s."studentCode", u."firstName", u."lastName", c.code, c.title,
			o."groupNumber", t."termCode", att.sessions, att.present, att.absent`
		orderBy := "name, code, course_code"
		orderLabel := "نام و نام خانوادگی"
		switch strings.ToUpper(f.OrderBy) {
		case "CODE":
			orderBy, orderLabel = "code, course_code", "شمارهٔ دانشجویی"
		case "PROF":
			orderBy, orderLabel = "prof, course_code, name", "کد استاد و درس"
		}
		rows, total, pages, err := s.pagedQueryArgs(ctx, cols, from, strings.Join(conds, " AND "), groupBy, "ORDER BY "+orderBy, countArgs, args, f.Page)
		if err != nil {
			return nil, err
		}
		sum := fmt.Sprintf("%s ردیف دانشجو×درس", jalali.GroupThousands(float64(total)))
		if term != "" {
			sum += " در ترم " + term
		}
		sum += " — ترتیب: " + orderLabel
		if showFinance {
			sum += " · ستون وضعیت مالی بر پایهٔ دفتر کل کانونی"
		}
		return &Result{Columns: columns, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages, Summary: sum}, nil
	}
	return nil, nil
}
