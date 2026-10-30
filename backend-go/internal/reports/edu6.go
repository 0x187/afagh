// ═══ گزارش‌های پایان‌نامه/دفاع — پورت r-thesis ═══
package reports

import (
	"context"
	"fmt"

	"backend-go/internal/jalali"
)

var proposalFa = map[string]string{
	"NOT_STARTED": "شروع‌نشده", "SUBMITTED": "ثبت‌شده", "SIMILARITY_CHECK": "بررسی همانندی",
	"SIMILARITY_PASSED": "همانندی قبول", "SIMILARITY_HIGH": "همانندی بالا",
	"EXPERT_REVIEW": "بررسی کارشناس", "APPROVED": "تصویب‌شده", "REJECTED": "ردشده",
	"PRIOR_REJECTED": "رد استعلام پیشین",
}

var defenseReqFa = map[string]string{
	"NOT_REQUESTED": "درخواست نشده", "SUPERVISOR_REVIEW": "بررسی استاد راهنما",
	"SUPERVISOR_REJECTED": "رد استاد راهنما", "EXPERT_REVIEW": "بررسی کارشناس",
	"SCHEDULED": "زمان‌بندی‌شده", "CONDUCTED": "برگزارشده", "PASSED": "قبول", "FAILED": "مردود",
}

var sessionFa = map[string]string{
	"SCHEDULED": "زمان‌بندی‌شده", "CONDUCTED": "برگزارشده", "CANCELLED": "لغوشده", "RESCHEDULED": "زمان‌بندی مجدد",
}

var resultFa = map[string]string{"PASSED": "قبول", "FAILED": "مردود", "CONDITIONAL": "مشروط"}

func mapFa(m map[string]string, v any) string {
	if v == nil {
		return "—"
	}
	k := fmt.Sprint(v)
	if s, ok := m[k]; ok {
		return s
	}
	return k
}

const thesisFrom = `FROM thesis_progress tp
	JOIN students s ON s.id = tp."studentId"
	JOIN users u ON u.id = s."userId"
	LEFT JOIN majors m ON m.id = s."majorId"
	LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
	LEFT JOIN staff sup ON sup.id = tp."supervisorId"
	LEFT JOIN users su ON su.id = sup."userId"`

func (s *Service) runEduThesis(ctx context.Context, kind string, f Filters) (*Result, error) {
	switch kind {
	case "proposals", "defenses", "pending-requests":
	default:
		return nil, nil
	}
	switch kind {
	case "proposals":
		args := []any{}
		where := studentWhere(f, &args)
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
			 m.name AS major, d.title AS degree, s."entryYear" AS y, tp."titleFa" AS title,
			 su."firstName" || ' ' || su."lastName" AS supervisor, tp."proposalStatus" AS pst,
			 tp."proposalSubmittedAt" AS submitted`,
			thesisFrom, where, "", `ORDER BY tp."proposalSubmittedAt" DESC NULLS LAST, s."studentCode"`, args, f.Page)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			r["pst"] = mapFa(proposalFa, r["pst"])
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "degree", Title: "مقطع"}, {Key: "y", Title: "ورودی", Format: "NUMBER"},
			{Key: "title", Title: "عنوان پایان‌نامه"}, {Key: "supervisor", Title: "استاد راهنما"},
			{Key: "pst", Title: "وضعیت پروپوزال"}, {Key: "submitted", Title: "تاریخ ثبت", Format: "DATETIME"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s پرونده پروپوزال", jalali.GroupThousands(float64(total)))}, nil

	case "defenses":
		args := []any{}
		where := studentWhere(f, &args)
		from := `FROM defense_sessions ds
			JOIN thesis_progress tp ON tp.id = ds."thesisProgressId"
			JOIN students s ON s.id = ds."studentId"
			JOIN users u ON u.id = s."userId"
			LEFT JOIN majors m ON m.id = s."majorId"
			LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
			LEFT JOIN staff sup ON sup.id = ds."supervisorId"
			LEFT JOIN users su ON su.id = sup."userId"
			LEFT JOIN classrooms r ON r.id = ds."roomId"`
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
			 m.name AS major, d.title AS degree, ds."scheduledAt" AS scheduled, r.name AS room,
			 su."firstName" || ' ' || su."lastName" AS supervisor, ds.status AS st, ds.result AS res`,
			from, where, "", `ORDER BY ds."scheduledAt" DESC NULLS LAST, s."studentCode"`, args, f.Page)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			r["st"] = mapFa(sessionFa, r["st"])
			if r["res"] == nil {
				r["res"] = "—"
			} else {
				r["res"] = mapFa(resultFa, r["res"])
			}
		}
		var scheduled int
		_ = s.Pool.QueryRow(ctx, `select count(*)::int from defense_sessions where status = 'SCHEDULED'`).Scan(&scheduled)
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "degree", Title: "مقطع"}, {Key: "scheduled", Title: "زمان دفاع", Format: "DATETIME"},
			{Key: "room", Title: "سالن"}, {Key: "supervisor", Title: "استاد راهنما"},
			{Key: "st", Title: "وضعیت جلسه"}, {Key: "res", Title: "نتیجه"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s جلسه دفاع — %s زمان‌بندی‌شده", jalali.GroupThousands(float64(total)), jalali.GroupThousands(float64(scheduled)))}, nil

	case "pending-requests":
		proposalPending := `tp."proposalStatus" IN ('SUBMITTED','SIMILARITY_CHECK','SIMILARITY_PASSED','SIMILARITY_HIGH','EXPERT_REVIEW')`
		defensePending := `tp."defenseRequestStatus" IN ('SUPERVISOR_REVIEW','EXPERT_REVIEW','SCHEDULED')`
		args := []any{}
		where := studentWhere(f, &args) + ` AND (` + proposalPending + ` OR ` + defensePending + `)`
		reqExpr := `CASE WHEN ` + defensePending + ` AND ` + proposalPending + ` THEN 'پروپوزال + دفاع'
			WHEN ` + defensePending + ` THEN 'دفاع' ELSE 'پروپوزال' END`
		rows, total, pages, err := s.pagedQuery(ctx,
			`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
			 m.name AS major, d.title AS degree, tp."titleFa" AS title,
			 su."firstName" || ' ' || su."lastName" AS supervisor, `+reqExpr+` AS req,
			 tp."proposalStatus" AS pst, tp."defenseRequestStatus" AS dst,
			 tp."proposalSubmittedAt" AS submitted, tp."defenseRequestedAt" AS requested`,
			thesisFrom, where, "", `ORDER BY s."studentCode"`, args, f.Page)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			r["pst"] = mapFa(proposalFa, r["pst"])
			r["dst"] = mapFa(defenseReqFa, r["dst"])
		}
		return &Result{Columns: []Column{
			{Key: "code", Title: "شماره دانشجویی"}, {Key: "name", Title: "نام"}, {Key: "major", Title: "رشته"},
			{Key: "degree", Title: "مقطع"}, {Key: "title", Title: "عنوان پایان‌نامه"}, {Key: "supervisor", Title: "استاد راهنما"},
			{Key: "req", Title: "نوع درخواست"}, {Key: "pst", Title: "وضعیت پروپوزال"},
			{Key: "dst", Title: "وضعیت دفاع"}, {Key: "submitted", Title: "ثبت پروپوزال", Format: "DATETIME"},
			{Key: "requested", Title: "درخواست دفاع", Format: "DATETIME"},
		}, Rows: rows, Total: total, Page: f.Page, Per: Per, TotalPages: pages,
			Summary: fmt.Sprintf("%s درخواست درانتظار (پروپوزال/دفاع)", jalali.GroupThousands(float64(total)))}, nil
	}
	return nil, nil
}
