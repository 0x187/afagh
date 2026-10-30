// ═══ گزارش‌های وضعیت/عملیات دانشجو — پورت r-status-ops (بخش خواندنی) ═══
package reports

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"backend-go/internal/jalali"
)

func (s *Service) runEduStatusOps(ctx context.Context, kind string, f Filters) (*Result, error) {
	switch kind {
	case "status-report", "major-change-report", "status-change-report", "gpa-refresh-preview", "profile-refresh", "portal-export":
	default:
		return nil, nil
	}
	onlyStale := true
	if f.OnlyStale != nil {
		onlyStale = *f.OnlyStale
	}

	switch kind {
	case "status-report":
		args := []any{}
		conds := studentWhere(f, &args)
		if f.Status != "" {
			args = append(args, f.Status)
			conds += fmt.Sprintf(` AND s.status = $%d`, len(args))
		}
		rows, total, pages, err := s.pagedQuery(ctx, stuCols, stuFrom, conds, "", `ORDER BY s."studentCode"`, args, f.Page)
		if err != nil {
			return nil, err
		}
		mapStatusRows(rows, "st")
		aggArgs := []any{}
		aggWhere := studentWhere(f, &aggArgs)
		if f.Status != "" {
			aggArgs = append(aggArgs, f.Status)
			aggWhere += fmt.Sprintf(` AND s.status = $%d`, len(aggArgs))
		}
		agg, err := s.Pool.Query(ctx, `select s.status as st, count(*)::int as n `+stuFrom+` WHERE `+aggWhere+` GROUP BY s.status ORDER BY n DESC`, aggArgs...)
		parts := []string{}
		totalAll := 0
		if err == nil {
			for agg.Next() {
				var st string
				var n int
				if err := agg.Scan(&st, &n); err == nil {
					totalAll += n
					parts = append(parts, faStatus(st)+": "+jalali.GroupThousands(float64(n)))
				}
			}
			agg.Close()
		}
		summary := fmt.Sprintf("جمع: %s نفر", jalali.GroupThousands(float64(totalAll)))
		if len(parts) > 0 {
			summary += " — " + strings.Join(parts, " | ")
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "nc", Title: "کد ملی"},
			{Key: "major", Title: "رشته"}, {Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
			{Key: "st", Title: "وضعیت"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages, Summary: summary}, nil

	case "major-change-report":
		args := []any{}
		conds := studentWhere(f, &args)
		conds += ` AND (s."samaStatusCode" IN ('4','14') OR s."studyingMode" IN ('2','8'))`
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, u."nationalCode" AS nc,
			 m.name AS major, d.title AS degree, s."entryYear" AS y, s.status AS st,
			 s."samaStatusCode" AS sama, s."studyingMode" AS mode`,
			stuFrom, conds, "", `ORDER BY s."studentCode"`, args, f.Page)
		if err != nil {
			return nil, err
		}
		mapStatusRows(rows, "st")
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "nc", Title: "کد ملی"},
			{Key: "major", Title: "رشتهٔ فعلی"}, {Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
			{Key: "st", Title: "وضعیت"}, {Key: "sama", Title: "کد سما"}, {Key: "mode", Title: "شیوه آموزش"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("NEEDS-SCHEMA — جدول تاریخچهٔ تغییر رشته وجود ندارد؛ این فهرست تصویر لحظه‌ای واقعی است (%s نفر با نشانهٔ تغییر رشته در وضعیت فعلی سما). برای تاریخچهٔ کامل، DDL پیشنهادی را اعمال کنید.", jalali.GroupThousands(float64(total)))}, nil

	case "status-change-report":
		args := []any{}
		conds := `ch.stt IS DISTINCT FROM ch.prev_stt AND ` + studentWhere(f, &args)
		from := `FROM (
			SELECT sts."studentId" AS sid, t."termCode" AS tc,
			  COALESCE(sts."normalizedStatusTitle", sts."statusTitle", sts."sourceStatusTitle") AS stt,
			  LAG(COALESCE(sts."normalizedStatusTitle", sts."statusTitle", sts."sourceStatusTitle")) OVER w AS prev_stt,
			  LAG(t."termCode") OVER w AS prev_tc
			FROM student_term_states sts JOIN academic_terms t ON t.id = sts."termId"
			WINDOW w AS (PARTITION BY sts."studentId" ORDER BY t."sortOrder" NULLS LAST, t."termCode")
		) ch
		JOIN students s ON s.id = ch.sid
		JOIN users u ON u.id = s."userId"
		LEFT JOIN majors m ON m.id = s."majorId"`
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			 ch.prev_tc AS from_term, ch.prev_stt AS from_st, ch.tc AS to_term, ch.stt AS to_st`,
			from, conds, "", `ORDER BY to_term DESC, code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "from_term", Title: "از ترم"}, {Key: "from_st", Title: "وضعیت قبل"},
			{Key: "to_term", Title: "تا ترم"}, {Key: "to_st", Title: "وضعیت بعد"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s گذار وضعیت بین نیمسال‌ها (از student_term_states؛ تغییرات درون‌ترمی ثبت نمی‌شود)", jalali.GroupThousands(float64(total)))}, nil

	case "gpa-refresh-preview":
		args := []any{}
		conds := studentWhere(f, &args)
		if f.Term != "" {
			args = append(args, f.Term)
			conds += fmt.Sprintf(` AND t."termCode" = $%d`, len(args))
		}
		stored := `COALESCE(sts."normalizedTermAvg", sts."termAvg", sts."sourceTermAvg")`
		from := `FROM student_term_states sts
			JOIN academic_terms t ON t.id = sts."termId"
			JOIN students s ON s.id = sts."studentId"
			JOIN users u ON u.id = s."userId"
			LEFT JOIN majors m ON m.id = s."majorId"
			JOIN LATERAL (
			  SELECT ROUND(
			      SUM(e."gradeValue"::numeric * COALESCE(c.units,0))
			        FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND e."gradeValue"::text ~ '^[0-9]+(\.[0-9]+)?$' AND COALESCE(c."affectsGpa",1) = 1)
			      / NULLIF(SUM(COALESCE(c.units,0))
			        FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND e."gradeValue"::text ~ '^[0-9]+(\.[0-9]+)?$' AND COALESCE(c."affectsGpa",1) = 1),0)
			    , 2)::float8 AS reavg,
			    COUNT(*) FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND e."gradeValue"::text ~ '^[0-9]+(\.[0-9]+)?$')::int AS n
			  FROM enrollments e JOIN course_offerings o ON o.id = e."offeringId"
			    LEFT JOIN courses c ON c.id = o."courseId"
			  WHERE e."studentId" = s.id AND o."termId" = sts."termId"
			) g ON true`
		if onlyStale {
			conds += ` AND ` + stored + ` IS DISTINCT FROM g.reavg`
		}
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			 t."termCode" AS term, `+stored+`::float8 AS stored_avg, g.reavg AS recomputed_avg,
			 g.n AS final_count, ROUND((g.reavg - `+stored+`)::numeric,2)::float8 AS diff`,
			from, conds, "", `ORDER BY term DESC, code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		summary := fmt.Sprintf("%s نیمسال", jalali.GroupThousands(float64(total)))
		if onlyStale {
			summary = fmt.Sprintf("%s نیمسال با معدل ناهمگام", jalali.GroupThousands(float64(total)))
		}
		summary += " (فقط پیش‌نمایش — هیچ رکوردی تغییر نکرد)"
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "term", Title: "ترم"}, {Key: "stored_avg", Title: "معدل ذخیره‌شده", Format: "NUMBER"},
			{Key: "recomputed_avg", Title: "معدل بازمحاسبه‌شده", Format: "NUMBER"},
			{Key: "final_count", Title: "درس نهایی", Format: "NUMBER"}, {Key: "diff", Title: "اختلاف", Format: "NUMBER"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages, Summary: summary}, nil

	case "profile-refresh":
		args := []any{}
		conds := studentWhere(f, &args)
		if len(f.IDs) > 0 {
			ids := make([]string, 0, len(f.IDs))
			for _, id := range f.IDs {
				if id > 0 {
					args = append(args, id)
					ids = append(ids, "$"+strconv.Itoa(len(args)))
				}
			}
			if len(ids) > 0 {
				conds += ` AND s.id IN (` + strings.Join(ids, ",") + `)`
			}
		}
		from := `FROM students s
			JOIN users u ON u.id = s."userId"
			LEFT JOIN majors m ON m.id = s."majorId"
			JOIN LATERAL (
			  SELECT COALESCE(SUM(c.units) FILTER (WHERE e.status <> 'DROPPED'),0)::int AS taken_u,
			    COALESCE(SUM(c.units) FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND e."gradeValue"::text ~ '^[0-9]+(\.[0-9]+)?$' AND e."gradeValue"::numeric >= 10),0)::int AS passed_u,
			    ROUND(
			      SUM(e."gradeValue"::numeric * COALESCE(c.units,0))
			        FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND e."gradeValue"::text ~ '^[0-9]+(\.[0-9]+)?$' AND COALESCE(c."affectsGpa",1) = 1)
			      / NULLIF(SUM(COALESCE(c.units,0))
			        FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND e."gradeValue"::text ~ '^[0-9]+(\.[0-9]+)?$' AND COALESCE(c."affectsGpa",1) = 1),0)
			    ,2)::float8 AS reavg
			  FROM enrollments e
			    LEFT JOIN course_offerings o ON o.id = e."offeringId"
			    LEFT JOIN courses c ON c.id = o."courseId"
			  WHERE e."studentId" = s.id
			) g ON true`
		if onlyStale {
			conds += ` AND (s."totalTakenUnits" IS DISTINCT FROM g.taken_u OR s."totalPassedUnits" IS DISTINCT FROM g.passed_u OR s."totalAverage"::float8 IS DISTINCT FROM g.reavg)`
		}
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
			 s."totalTakenUnits" AS stored_taken, g.taken_u AS calc_taken,
			 s."totalPassedUnits" AS stored_passed, g.passed_u AS calc_passed,
			 s."totalAverage"::float8 AS stored_avg, g.reavg AS calc_avg`,
			from, conds, "", `ORDER BY code`, args, f.Page)
		if err != nil {
			return nil, err
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "stored_taken", Title: "اخذشدهٔ ذخیره", Format: "NUMBER"}, {Key: "calc_taken", Title: "اخذشدهٔ محاسباتی", Format: "NUMBER"},
			{Key: "stored_passed", Title: "قبول‌شدهٔ ذخیره", Format: "NUMBER"}, {Key: "calc_passed", Title: "قبول‌شدهٔ محاسباتی", Format: "NUMBER"},
			{Key: "stored_avg", Title: "معدل ذخیره", Format: "NUMBER"}, {Key: "calc_avg", Title: "معدل محاسباتی", Format: "NUMBER"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s پروندهٔ ناهمگام (فقط پیش‌نمایش)", jalali.GroupThousands(float64(total)))}, nil

	case "portal-export":
		args := []any{}
		conds := studentWhere(f, &args) + ` AND s.status = 'GRADUATED' AND ap.id IS NULL`
		from := `FROM students s
			JOIN users u ON u.id = s."userId"
			LEFT JOIN majors m ON m.id = s."majorId"
			LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
			LEFT JOIN alumni_profiles ap ON ap."studentId" = s.id`
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, u."nationalCode" AS nc,
			 m.name AS major, d.title AS degree, s."entryYear" AS y, s."graduateDate" AS gdate`,
			from, conds, "", `ORDER BY s."studentCode"`, args, f.Page)
		if err != nil {
			return nil, err
		}
		var done int
		_ = s.Pool.QueryRow(ctx, `select count(*)::int from alumni_profiles ap join students s on s.id = ap."studentId" where s.status = 'GRADUATED'`).Scan(&done)
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "nc", Title: "کد ملی"},
			{Key: "major", Title: "رشته"}, {Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
			{Key: "gdate", Title: "تاریخ فراغت", Format: "DATE"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s فارغ‌التحصیل آمادهٔ ارسال به پرتال — %s نفر قبلاً ارسال شده‌اند", jalali.GroupThousands(float64(total)), jalali.GroupThousands(float64(done)))}, nil
	}
	return nil, nil
}
