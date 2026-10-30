// ═══ گزارش‌های شورا/مکاتبات و گواهی‌ها — پورت r-council-letters ═══
package reports

import (
	"context"
	"fmt"
	"strings"

	"backend-go/internal/fa"
	"backend-go/internal/jalali"
)

func (s *Service) runEduCouncil(ctx context.Context, kind string, f Filters) (*Result, error) {
	switch kind {
	case "council-edu", "letter-templates", "transcript-card", "exam-entry-card", "student-card", "study-cert", "edu-confirm", "grad-cert", "military-defer":
	default:
		return nil, nil
	}
	switch kind {
	case "council-edu":
		args := []any{}
		conds := []string{`ce.status = 'PENDING_COUNCIL'`}
		if f.Term != "" {
			args = append(args, f.Term)
			conds = append(conds, fmt.Sprintf(`t."termCode" = $%d`, len(args)))
		}
		conds = append(conds, studentWhere(f, &args))
		from := `FROM enrollments ce
			JOIN course_offerings o ON o.id = ce."offeringId"
			JOIN courses c ON c.id = o."courseId"
			JOIN academic_terms t ON t.id = o."termId"
			JOIN students s ON s.id = ce."studentId"
			JOIN users u ON u.id = s."userId"
			LEFT JOIN majors m ON m.id = s."majorId"
			LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"`
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			 d.title AS degree, c.code AS course_code, c.title AS course_title, t."termCode" AS term`,
			from, strings.Join(conds, " AND "), "", `ORDER BY code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		sum := fmt.Sprintf("%s اخذ در انتظار بررسی شورا", jalali.GroupThousands(float64(total)))
		if f.Term != "" {
			sum += " در ترم " + f.Term
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "degree", Title: "مقطع"}, {Key: "course_code", Title: "کد درس"},
			{Key: "course_title", Title: "نام درس"}, {Key: "term", Title: "ترم"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages, Summary: sum}, nil

	case "letter-templates":
		args := []any{}
		conds := []string{}
		if f.UniversityID > 0 {
			args = append(args, f.UniversityID)
			conds = append(conds, fmt.Sprintf(`(dt."universityId" = $%d OR dt."universityId" IS NULL)`, len(args)))
		}
		if strings.TrimSpace(f.Q) != "" {
			args = append(args, "%"+fa.EscapeLikeChars(strings.TrimSpace(f.Q))+"%")
			p := fmt.Sprintf("$%d", len(args))
			conds = append(conds, `(dt.code ILIKE `+p+` ESCAPE '\' OR dt.title ILIKE `+p+` ESCAPE '\')`)
		}
		where := ""
		if len(conds) > 0 {
			where = strings.Join(conds, " AND ")
		}
		rows, total, pages, err := s.pagedQuery(ctx, `dt.code AS code, dt.title AS title`,
			`FROM document_templates dt`, where, "", `ORDER BY code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{{Key: "code", Title: "کد قالب"}, {Key: "title", Title: "عنوان قالب"}},
			Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s قالب مکاتبات", jalali.GroupThousands(float64(total)))}, nil

	case "transcript-card":
		args := []any{}
		where := studentWhere(f, &args)
		from := `FROM students s JOIN users u ON u.id = s."userId"
			LEFT JOIN majors m ON m.id = s."majorId"
			LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"`
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			 d.title AS degree, s."entryYear" AS y,
			 (SELECT COUNT(*)::int FROM transcript_snapshots ts WHERE ts."studentId" = s.id) AS snaps,
			 (SELECT COUNT(*)::int FROM enrollments e WHERE e."studentId" = s.id AND e."gradeStatus" = 'FINALIZED') AS fin`,
			from, where, "", `ORDER BY code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
			{Key: "snaps", Title: "اسنپ‌شات کارنامه", Format: "NUMBER"}, {Key: "fin", Title: "درس نهایی‌شده", Format: "NUMBER"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s پرونده کارنامه", jalali.GroupThousands(float64(total)))}, nil

	case "exam-entry-card":
		term := f.Term
		if term == "" {
			term = s.latestTermCode(ctx)
		}
		args := []any{term}
		conds := []string{`t."termCode" = $1`, studentWhere(f, &args)}
		from := `FROM seat_allocations sa
			JOIN enrollments e ON e.id = sa."enrollmentId"
			JOIN exam_sessions es ON es.id = sa."sessionId"
			JOIN academic_terms t ON t.id = es."termId"
			JOIN students s ON s.id = e."studentId"
			JOIN users u ON u.id = s."userId"
			LEFT JOIN majors m ON m.id = s."majorId"`
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			 es."examDate" AS exam_date, COUNT(sa.id)::int AS seats`,
			from, strings.Join(conds, " AND "), `s."studentCode", u."firstName", u."lastName", m.name, es."examDate"`,
			`ORDER BY code, exam_date`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "exam_date", Title: "تاریخ آزمون", Format: "DATE"}, {Key: "seats", Title: "صندلی", Format: "NUMBER"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s رکورد کارت ورود در ترم %s", jalali.GroupThousands(float64(total)), term)}, nil

	case "student-card":
		args := []any{}
		where := `s.status = 'ACTIVE' AND ` + studentWhere(f, &args)
		from := `FROM students s JOIN users u ON u.id = s."userId"
			LEFT JOIN majors m ON m.id = s."majorId"
			LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
			LEFT JOIN student_cards sc ON sc."studentId" = s.id`
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			 d.title AS degree, COALESCE(sc."printStatus", '— ثبت‌نشده —') AS card, sc."issuedAt" AS issued`,
			from, where, "", `ORDER BY code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "degree", Title: "مقطع"}, {Key: "card", Title: "وضعیت کارت"},
			{Key: "issued", Title: "تاریخ صدور", Format: "DATE"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s دانشجوی فعال واجد کارت", jalali.GroupThousands(float64(total)))}, nil

	case "study-cert":
		r, err := s.studentList(ctx, []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "nc", Title: "کد ملی"},
			{Key: "major", Title: "رشته"}, {Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
		}, `s.status = 'ACTIVE'`, f)
		if r != nil {
			r.Summary = fmt.Sprintf("%s دانشجوی فعال واجد گواهی اشتغال", jalali.GroupThousands(float64(r.Total)))
		}
		return r, err

	case "edu-confirm":
		args := []any{}
		where := `(p.code ILIKE '%CONFIRM%' OR p.title ILIKE '%تاییدیه%' OR p.title ILIKE '%تأییدیه%') AND ` + studentWhere(f, &args)
		from := `FROM student_requests r
			JOIN students s ON s.id = r."studentId"
			JOIN users u ON u.id = s."userId"
			JOIN process_definitions p ON p.id = r."processId"
			LEFT JOIN majors m ON m.id = s."majorId"`
		rows, total, pages, err := s.pagedQuery(ctx,
			`r."trackingCode" AS track, u."firstName" || ' ' || u."lastName" AS name,
			 s."studentCode" AS code, m.name AS major, p.title AS process, r.status AS st, r."createdAt" AS created`,
			from, where, "", `ORDER BY created DESC`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "track", Title: "کد رهگیری"}, {Key: "name", Title: "نام"}, {Key: "code", Title: "شماره دانشجویی"},
			{Key: "major", Title: "رشته"}, {Key: "process", Title: "فرایند"}, {Key: "st", Title: "وضعیت"},
			{Key: "created", Title: "ثبت", Format: "DATETIME"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s درخواست تاییدیه تحصیلی", jalali.GroupThousands(float64(total)))}, nil

	case "grad-cert":
		args := []any{}
		where := `s.status = 'GRADUATED' AND ` + studentWhere(f, &args)
		from := `FROM students s JOIN users u ON u.id = s."userId"
			LEFT JOIN majors m ON m.id = s."majorId"
			LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
			LEFT JOIN issued_degrees ig ON ig."studentId" = s.id AND ig."degreeType" IN ('TEMPORARY','PERMANENT')`
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			 d.title AS degree, s."entryYear" AS y,
			 COALESCE(ig."serialNo", '— ثبت‌نشده —') AS doc, ig."issuedAt" AS issued`,
			from, where, "", `ORDER BY code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
			{Key: "doc", Title: "سریال مدرک"}, {Key: "issued", Title: "تاریخ صدور", Format: "DATE"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s فارغ‌التحصیل", jalali.GroupThousands(float64(total)))}, nil

	case "military-defer":
		args := []any{}
		where := `s.status = 'ACTIVE' AND u.gender = 'MALE' AND ` + studentWhere(f, &args)
		from := `FROM students s JOIN users u ON u.id = s."userId"
			LEFT JOIN majors m ON m.id = s."majorId"
			LEFT JOIN military_service_records msr ON msr."studentId" = s.id`
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			 s."entryYear" AS y, COALESCE(to_jsonb(s)->>'militaryStatus','—') AS mil, COALESCE(msr.status,'—') AS sakha`,
			from, where, "", `ORDER BY code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "y", Title: "ورودی", Format: "NUMBER"}, {Key: "mil", Title: "وضعیت نظام‌وظیفه"},
			{Key: "sakha", Title: "وضعیت سخا"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s مشمول فعال واجد معافیت تحصیلی", jalali.GroupThousands(float64(total)))}, nil
	}
	return nil, nil
}
