// ═══ Class/space reports and supplementary lists — port of r-class and r-edu-roster ═══
package reports

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"backend-go/internal/fa"
	"backend-go/internal/jalali"
)

func (s *Service) runEduExtra(ctx context.Context, kind string, f Filters) (*Result, error) {
	switch kind {
	case "empty-rooms", "weekly-timetable", "room-conflicts", "low-enrollment", "makeup-courses":
		return s.runClassReport(ctx, kind, f)
	case "offered-course-roster", "no-photo", "graduates-info":
		return s.runRosterReport(ctx, kind, f)
	}
	return nil, nil
}

func (s *Service) runClassReport(ctx context.Context, kind string, f Filters) (*Result, error) {
	term := f.Term
	if term == "" {
		term = s.latestTermCode(ctx)
	}
	args := []any{term}
	switch kind {
	case "empty-rooms":
		conds := []string{`(r."universityId" = $2 OR r."universityId" IS NULL)`}
		args = append(args, f.UniversityID)
		if strings.TrimSpace(f.Q) != "" {
			like := "%" + fa.EscapeLikeChars(strings.TrimSpace(f.Q)) + "%"
			args = append(args, like)
			p := fmt.Sprintf("$%d", len(args))
			conds = append(conds, `(r.name ILIKE `+p+` ESCAPE '\' OR r."buildingName" ILIKE `+p+` ESCAPE '\')`)
		}
		conds = append(conds, `NOT EXISTS (SELECT 1 FROM schedules sch
			JOIN course_offerings o ON o.id = sch."offeringId"
			JOIN academic_terms t ON t.id = o."termId"
			WHERE sch."roomId" = r.id AND t."termCode" = $1 AND o."isActive" = 1)`)
		rows, total, pages, err := s.pagedQuery(ctx,
			`r.id AS id, r.name AS room, r."buildingName" AS building, r.capacity AS capacity, r."roomType" AS type`,
			`FROM classrooms r`, strings.Join(conds, " AND "), "",
			`ORDER BY r."buildingName" NULLS LAST, r.name`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "id", Title: "شناسه"}, {Key: "room", Title: "کلاس"}, {Key: "building", Title: "ساختمان"},
			{Key: "capacity", Title: "ظرفیت", Format: "NUMBER"}, {Key: "type", Title: "نوع"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s کلاس بدون برنامه در ترم %s (مبنا: schedules)", jalali.GroupThousands(float64(total)), term)}, nil

	case "weekly-timetable":
		conds := []string{`t."termCode" = $1`, `(sch."universityId" = $2 OR sch."universityId" IS NULL)`}
		args = append(args, f.UniversityID)
		if strings.TrimSpace(f.Q) != "" {
			like := "%" + fa.EscapeLikeChars(strings.TrimSpace(f.Q)) + "%"
			args = append(args, like)
			p := fmt.Sprintf("$%d", len(args))
			conds = append(conds, `(r.name ILIKE `+p+` ESCAPE '\' OR c.title ILIKE `+p+` ESCAPE '\' OR c.code ILIKE `+p+` ESCAPE '\')`)
		}
		rows, total, pages, err := s.pagedQuery(ctx,
			`r.name AS room, sch."dayOfWeek" AS day, to_char(sch."startTime",'HH24:MI') AS start,
			 to_char(sch."endTime",'HH24:MI') AS "end", sch."scheduleType" AS type,
			 c.code AS course_code, c.title AS course_title, o."groupNumber" AS grp`,
			`FROM schedules sch
			 JOIN course_offerings o ON o.id = sch."offeringId"
			 JOIN academic_terms t ON t.id = o."termId"
			 JOIN courses c ON c.id = o."courseId"
			 LEFT JOIN classrooms r ON r.id = sch."roomId"`,
			strings.Join(conds, " AND "), "", `ORDER BY room NULLS LAST, day NULLS LAST, start`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "room", Title: "کلاس"}, {Key: "day", Title: "روز هفته (عدد)"}, {Key: "start", Title: "از ساعت"},
			{Key: "end", Title: "تا ساعت"}, {Key: "type", Title: "نوع سانس"}, {Key: "course_code", Title: "کد درس"},
			{Key: "course_title", Title: "نام درس"}, {Key: "grp", Title: "گروه"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s سانس در ترم %s", jalali.GroupThousands(float64(total)), term)}, nil

	case "room-conflicts":
		conds := []string{`ta."termCode" = $1`, `ta.id = tb.id`,
			`(a."universityId" = $2 OR a."universityId" IS NULL)`}
		args = append(args, f.UniversityID)
		rows, total, pages, err := s.pagedQuery(ctx,
			`r.name AS room, a."dayOfWeek" AS day,
			 to_char(a."startTime",'HH24:MI') AS a_start, to_char(a."endTime",'HH24:MI') AS a_end,
			 to_char(b."startTime",'HH24:MI') AS b_start, to_char(b."endTime",'HH24:MI') AS b_end,
			 oa.id AS offering_a, ob.id AS offering_b`,
			`FROM schedules a
			 JOIN schedules b ON b."roomId" = a."roomId" AND b."dayOfWeek" = a."dayOfWeek"
			   AND b.id > a.id AND b."startTime" < a."endTime" AND b."endTime" > a."startTime"
			 JOIN course_offerings oa ON oa.id = a."offeringId"
			 JOIN course_offerings ob ON ob.id = b."offeringId"
			 JOIN academic_terms ta ON ta.id = oa."termId"
			 JOIN academic_terms tb ON tb.id = ob."termId"
			 LEFT JOIN classrooms r ON r.id = a."roomId"`,
			strings.Join(conds, " AND "), "", `ORDER BY room, day, a_start`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "room", Title: "کلاس"}, {Key: "day", Title: "روز هفته (عدد)"},
			{Key: "a_start", Title: "شروع اول"}, {Key: "a_end", Title: "پایان اول"},
			{Key: "b_start", Title: "شروع دوم"}, {Key: "b_end", Title: "پایان دوم"},
			{Key: "offering_a", Title: "ارائه اول"}, {Key: "offering_b", Title: "ارائه دوم"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s جفت متداخل در ترم %s", jalali.GroupThousands(float64(total)), term)}, nil

	case "low-enrollment":
		raw, _ := strconv.ParseFloat(strings.TrimSpace(f.Q), 64)
		threshold := 0.5
		if raw > 0 && raw <= 100 {
			if raw > 1 {
				threshold = raw / 100
			} else {
				threshold = raw
			}
		}
		conds := []string{`t."termCode" = $1`, `o."isActive" = 1`, `o.capacity > 0`,
			`o."enrolledCount" < o.capacity * $2`, `(o."universityId" = $3 OR o."universityId" IS NULL)`}
		args = append(args, threshold, f.UniversityID)
		rows, total, pages, err := s.pagedQuery(ctx,
			`c.code AS code, c.title AS title, o."groupNumber" AS grp, o.capacity AS capacity,
			 o."enrolledCount" AS enrolled, ROUND(o."enrolledCount" * 100.0 / o.capacity, 1)::float8 AS pct, t."termCode" AS term`,
			`FROM course_offerings o JOIN courses c ON c.id = o."courseId"
			 JOIN academic_terms t ON t.id = o."termId"`,
			strings.Join(conds, " AND "), "", `ORDER BY pct ASC NULLS FIRST`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "کد درس"}, {Key: "title", Title: "نام درس"}, {Key: "grp", Title: "گروه"},
			{Key: "capacity", Title: "ظرفیت", Format: "NUMBER"}, {Key: "enrolled", Title: "ثبت‌نام‌شده", Format: "NUMBER"},
			{Key: "pct", Title: "درصد پرشدن", Format: "NUMBER"}, {Key: "term", Title: "ترم"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s ارائه زیر حدنصاب %s٪ در ترم %s", jalali.GroupThousands(float64(total)), jalali.GroupThousands(threshold*100), term)}, nil

	case "makeup-courses":
		conds := []string{`(t."termType" = 'EQUIVALENCE'
			OR o."offeringType" ILIKE '%EQUIV%'
			OR c."courseType" ILIKE ANY (ARRAY['%جبران%','%COMPENS%','%EQUIV%','%پیش%'])
			OR c.title ILIKE '%جبرانی%' OR c.title ILIKE '%پیش‌دانشگاهی%'
			OR c.title ILIKE '%پیش دانشگاهی%' OR c.title ILIKE '%پیشدانشگاهی%')`,
			`(o."universityId" = $2 OR o."universityId" IS NULL)`}
		if f.Term != "" {
			conds = append(conds, `t."termCode" = $1`)
		}
		args = append(args, f.UniversityID)
		rows, total, pages, err := s.pagedQuery(ctx,
			`c.code AS code, c.title AS title, c."courseType" AS course_type, o."offeringType" AS offering_type,
			 t."termCode" AS term, t."termType" AS term_type, o."groupNumber" AS grp, o."enrolledCount" AS enrolled`,
			`FROM course_offerings o JOIN courses c ON c.id = o."courseId"
			 JOIN academic_terms t ON t.id = o."termId"`,
			strings.Join(conds, " AND "), "", `ORDER BY term DESC, code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "کد درس"}, {Key: "title", Title: "نام درس"}, {Key: "course_type", Title: "نوع درس"},
			{Key: "offering_type", Title: "نوع ارائه"}, {Key: "term", Title: "ترم"}, {Key: "term_type", Title: "نوع ترم"},
			{Key: "grp", Title: "گروه"}, {Key: "enrolled", Title: "ثبت‌نام‌شده", Format: "NUMBER"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s ارائه جبرانی/معادل‌سازی (بازبینی دستی شود)", jalali.GroupThousands(float64(total)))}, nil
	}
	return nil, nil
}

func (s *Service) runRosterReport(ctx context.Context, kind string, f Filters) (*Result, error) {
	switch kind {
	case "offered-course-roster":
		term := strings.TrimSpace(f.Term)
		q := strings.TrimSpace(f.Q)
		cols := []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"},
			{Key: "major", Title: "رشته"}, {Key: "groupNumber", Title: "شماره گروه"},
			{Key: "gradeValue", Title: "نمره", Format: "NUMBER"}, {Key: "gradeStatus", Title: "وضعیت نمره"},
		}
		if term == "" || q == "" {
			msg := "نخست ترم را انتخاب کنید."
			if term != "" {
				msg = "کد یا نام درس را وارد کنید تا ارائه‌های آن ترم پیدا شود."
			}
			return &Result{Columns: cols, Rows: []map[string]any{}, Total: 0, Page: 1, Per: Per, TotalPages: 1, Summary: msg}, nil
		}
		args := []any{term, "%" + fa.EscapeLikeChars(q) + "%"}
		rest := f
		rest.Q = ""
		conds := []string{`t."termCode" = $1`, `(c.code ILIKE $2 ESCAPE '\' OR c.title ILIKE $2 ESCAPE '\')`, studentWhere(rest, &args)}
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			 o."groupNumber" AS "groupNumber", e."gradeValue"::float8 AS "gradeValue", e."gradeStatus" AS "gradeStatus"`,
			`FROM enrollments e JOIN course_offerings o ON o.id = e."offeringId"
			 JOIN courses c ON c.id = o."courseId" JOIN academic_terms t ON t.id = o."termId"
			 JOIN students s ON s.id = e."studentId" JOIN users u ON u.id = s."userId"
			 LEFT JOIN majors m ON m.id = s."majorId"`,
			strings.Join(conds, " AND "), "", `ORDER BY code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: cols, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s ثبت‌نام در درس «%s» — ترم %s", jalali.GroupThousands(float64(total)), q, term)}, nil

	case "no-photo":
		r, err := s.studentList(ctx, []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "nc", Title: "کد ملی"},
			{Key: "major", Title: "رشته"}, {Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
			{Key: "st", Title: "وضعیت"},
		}, `(to_jsonb(u)->>'photoKey') IS NULL`, f)
		if r != nil {
			r.Summary = fmt.Sprintf("%s دانشجو فاقد عکس", jalali.GroupThousands(float64(r.Total)))
		}
		return r, err

	case "graduates-info":
		args := []any{}
		conds := []string{studentWhere(f, &args), `s.status = 'GRADUATED'`}
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			 d.title AS degree, s."graduateDate" AS "graduateDate", s."eduEndYear" AS "eduEndYear",
			 s."totalAverage"::float8 AS avg`,
			stuFrom, strings.Join(conds, " AND "), "",
			`ORDER BY s."graduateDate" DESC NULLS LAST, s."studentCode"`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "degree", Title: "مقطع"}, {Key: "graduateDate", Title: "تاریخ فراغت", Format: "DATE"},
			{Key: "eduEndYear", Title: "سال پایان تحصیل"}, {Key: "avg", Title: "معدل کل", Format: "NUMBER"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s دانش‌آموخته", jalali.GroupThousands(float64(total)))}, nil
	}
	return nil, nil
}
