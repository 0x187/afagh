// ═══ ابلاغ‌های آموزشی — پورت lib/payroll-decrees.ts ═══
package payroll

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// DecreeListItem ردیف فهرست ابلاغ.
type DecreeListItem struct {
	ID            int64   `json:"id"`
	StaffID       int64   `json:"staffId"`
	StaffName     string  `json:"staffName"`
	StaffCode     *string `json:"staffCode"`
	TermID        int64   `json:"termId"`
	TermTitle     *string `json:"termTitle"`
	SecretariatNo int     `json:"secretariatNo"`
	Status        string  `json:"status"`
	IssuedAt      *string `json:"issuedAt"`
	CreatedAt     *string `json:"createdAt"`
}

// ListDecrees فهرست ابلاغ‌های یک ترم (اختیاری: فقط یک استاد).
func (e *Engine) ListDecrees(ctx context.Context, termID int64, universityID, staffID *int64) ([]DecreeListItem, error) {
	args := []any{termID}
	where := ` where d."termId" = $1`
	if universityID != nil {
		args = append(args, *universityID)
		where += fmt.Sprintf(` and d."universityId" = $%d`, len(args))
	}
	if staffID != nil {
		args = append(args, *staffID)
		where += fmt.Sprintf(` and d."staffId" = $%d`, len(args))
	}
	rows, err := e.Pool.Query(ctx, `
		select d.id, d."staffId", d."termId", d."secretariatNo", d.status,
		       d."issuedAt"::text, d."createdAt"::text, t.title, st."staffCode",
		       coalesce(u."firstName" || ' ' || u."lastName",'')
		  from teaching_decrees d
		  join academic_terms t on t.id = d."termId"
		  join staff st on st.id = d."staffId"
		  join users u on u.id = st."userId"`+where+`
		 order by d."secretariatNo" desc`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DecreeListItem{}
	for rows.Next() {
		var d DecreeListItem
		if err := rows.Scan(&d.ID, &d.StaffID, &d.TermID, &d.SecretariatNo, &d.Status,
			&d.IssuedAt, &d.CreatedAt, &d.TermTitle, &d.StaffCode, &d.StaffName); err == nil {
			d.StaffName = strings.TrimSpace(d.StaffName)
			if d.StaffName == "" {
				d.StaffName = "—"
			}
			out = append(out, d)
		}
	}
	return out, nil
}

// DecreeItemRow اقلام ۷ بخش.
type DecreeItemRow struct {
	ID      int64    `json:"id"`
	Section string   `json:"section"`
	Title   string   `json:"title"`
	Units   *float64 `json:"units"`
	Amount  *float64 `json:"amount"`
}

// DecreeSigner امضاکننده.
type DecreeSigner struct {
	Title string `json:"title"`
	Name  string `json:"name"`
}

// DecreeDetail جزئیات ابلاغ.
type DecreeDetail struct {
	DecreeListItem
	Snapshot      map[string]any   `json:"snapshot"`
	Signers       []DecreeSigner   `json:"signers"`
	Items         []DecreeItemRow  `json:"items"`
	IssuedByName  *string          `json:"issuedByName"`
}

// GetDecreeDetail جزئیات یک ابلاغ + اقلام.
func (e *Engine) GetDecreeDetail(ctx context.Context, id int64) (*DecreeDetail, error) {
	var d DecreeDetail
	var snapshotJSON, signersJSON *string
	var issuedBy *int64
	err := e.Pool.QueryRow(ctx, `
		select id, "staffId", "termId", "secretariatNo", status,
		       "issuedAt"::text, "createdAt"::text, "snapshotJson", "signersJson", "issuedBy"
		  from teaching_decrees where id = $1`, id).
		Scan(&d.ID, &d.StaffID, &d.TermID, &d.SecretariatNo, &d.Status,
			&d.IssuedAt, &d.CreatedAt, &snapshotJSON, &signersJSON, &issuedBy)
	if err != nil {
		return nil, nil
	}
	d.Snapshot = map[string]any{}
	if snapshotJSON != nil && strings.TrimSpace(*snapshotJSON) != "" {
		_ = json.Unmarshal([]byte(*snapshotJSON), &d.Snapshot)
	}
	d.Signers = []DecreeSigner{}
	if signersJSON != nil {
		var raw []DecreeSigner
		if json.Unmarshal([]byte(*signersJSON), &raw) == nil {
			d.Signers = raw
		}
	}
	_ = e.Pool.QueryRow(ctx, `
		select st."staffCode", coalesce(u."firstName" || ' ' || u."lastName",'')
		  from staff st join users u on u.id = st."userId" where st.id = $1`, d.StaffID).
		Scan(&d.StaffCode, &d.StaffName)
	d.StaffName = strings.TrimSpace(d.StaffName)
	if d.StaffName == "" {
		d.StaffName = "—"
	}
	_ = e.Pool.QueryRow(ctx, `select title from academic_terms where id = $1`, d.TermID).Scan(&d.TermTitle)
	d.Items = []DecreeItemRow{}
	irows, err := e.Pool.Query(ctx, `
		select id, section, title, units::float8, amount::float8
		  from decree_items where "decreeId" = $1 order by id`, id)
	if err == nil {
		for irows.Next() {
			var it DecreeItemRow
			if err := irows.Scan(&it.ID, &it.Section, &it.Title, &it.Units, &it.Amount); err == nil {
				d.Items = append(d.Items, it)
			}
		}
		irows.Close()
	}
	if issuedBy != nil {
		var name string
		if err := e.Pool.QueryRow(ctx, `select coalesce("firstName" || ' ' || "lastName",'') from users where id = $1`, *issuedBy).Scan(&name); err == nil {
			n := strings.TrimSpace(name)
			if n != "" {
				d.IssuedByName = &n
			}
		}
	}
	return &d, nil
}

// nextSecretariatNo شمارهٔ دبیرخانهٔ بعدی (اتمیک: upsert شمارنده).
func (e *Engine) nextSecretariatNo(ctx context.Context, tx pgx.Tx, universityID int64) (int, error) {
	var lastNo int
	err := tx.QueryRow(ctx, `
		insert into decree_counters ("universityId","lastNo") values ($1,1)
		on conflict ("universityId") do update set "lastNo" = decree_counters."lastNo" + 1
		returning "lastNo"`, universityID).Scan(&lastNo)
	return lastNo, err
}

// IssueDecree صدور ابلاغ: اسنپ‌شات محاسبه + اقلام بخش‌ها + شمارهٔ دبیرخانه.
func (e *Engine) IssueDecree(ctx context.Context, staffID, termID, universityID int64, signers []DecreeSigner) (int64, error) {
	var dupID int64
	var dupStatus string
	err := e.Pool.QueryRow(ctx, `
		select id, status from teaching_decrees
		 where "staffId" = $1 and "termId" = $2 limit 1`, staffID, termID).Scan(&dupID, &dupStatus)
	if err == nil {
		if dupStatus == "ISSUED" {
			return 0, errors.New("برای این استاد در این ترم ابلاغ صادرشده وجود دارد.")
		}
		return 0, errors.New("برای این استاد در این ترم پیش‌نویس ابلاغ وجود دارد؛ ابتدا آن را نهایی یا حذف کنید.")
	}

	// محاسبهٔ زندهٔ فیش → مبنای اسنپ‌شات (fail-closed).
	calc, err := CalcStaffPayrollFromTerm(ctx, e, staffID, termID)
	if err != nil {
		return 0, fmt.Errorf("محاسبهٔ فیش ناموفق بود: %w", err)
	}
	if !calc.HasContract {
		return 0, errors.New("استاد در این ترم قرارداد ندارد؛ ابتدا قرارداد بسازید.")
	}

	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	secretariatNo, err := e.nextSecretariatNo(ctx, tx, universityID)
	if err != nil {
		return 0, err
	}
	cleanSigners := []DecreeSigner{}
	for _, s := range signers {
		t := strings.TrimSpace(s.Title)
		n := strings.TrimSpace(s.Name)
		if t == "" && n == "" {
			continue
		}
		cleanSigners = append(cleanSigners, DecreeSigner{Title: t, Name: n})
		if len(cleanSigners) >= 4 {
			break
		}
	}
	snapshot := map[string]any{
		"staff": calc.Staff, "rate": calc.Rate, "rateSource": calc.RateSource,
		"dutyUnits": calc.DutyUnits, "taxRate": calc.TaxRate,
		"totalEquivalentUnits": calc.TotalEquivalentUnits, "totalEffectiveUnits": calc.TotalEffectiveUnits,
		"payableUnits": calc.PayableUnits, "gross": calc.Gross, "tax": calc.Tax,
		"absenceDeductionRial": calc.AbsenceDeductionRial, "net": calc.Net,
		"issuedAt": time.Now().UTC().Format(time.RFC3339),
	}
	snapB, _ := json.Marshal(snapshot)
	signersB, _ := json.Marshal(cleanSigners)
	var decreeID int64
	if err := tx.QueryRow(ctx, `
		insert into teaching_decrees ("staffId","termId","secretariatNo",status,"snapshotJson","signersJson","universityId")
		values ($1,$2,$3,'DRAFT',$4,$5,$6) returning id`,
		staffID, termID, secretariatNo, string(snapB), string(signersB), universityID).Scan(&decreeID); err != nil {
		return 0, err
	}

	// اقلام بخش‌ها از همان محاسبه.
	type itemRow struct {
		section  string
		title    string
		units    *string
		amount   string
		metaJSON string
	}
	items := []itemRow{}
	for _, r := range calc.Rows {
		isThesis := r.OfferingType == "THESIS" || r.PayRole == "SUPERVISOR" || r.PayRole == "ADVISOR"
		section := "COURSES"
		if isThesis {
			section = "THESIS"
		}
		group := "—"
		if r.GroupNumber != nil {
			group = strconv.Itoa(*r.GroupNumber)
		}
		units := strconv.FormatFloat(r.EquivalentUnits, 'f', -1, 64)
		amount := strconv.Itoa(int(math.Round(r.GrossRial)))
		meta, _ := json.Marshal(map[string]any{"offeringId": r.OfferingID, "courseCode": r.CourseCode, "ruleTitle": r.RuleTitle})
		items = append(items, itemRow{section: section, title: fmt.Sprintf("%s (گروه %s)", r.CourseTitle, group),
			units: &units, amount: amount, metaJSON: string(meta)})
	}
	// فعالیت‌های تأییدشدهٔ ترم.
	acts, err := e.Pool.Query(ctx, `
		select t.title, a.quantity::float8, t."quantFactor"::float8
		  from staff_activity_entries a
		  join qualitative_activity_types t on t.id = a."activityTypeId"
		 where a."staffId" = $1 and a."termId" = $2 and a.status = 'APPROVED'`, staffID, termID)
	if err == nil {
		for acts.Next() {
			var title string
			var quantity, factor float64
			if err := acts.Scan(&title, &quantity, &factor); err == nil {
				units := strconv.FormatFloat(math.Round(quantity*factor*100)/100, 'f', -1, 64)
				meta, _ := json.Marshal(map[string]any{"kind": "activity"})
				items = append(items, itemRow{section: "ACTIVITIES",
					title:  fmt.Sprintf("%s — %s مورد", title, intToStr(int(quantity))),
					units:  &units, amount: "0", metaJSON: string(meta)})
			}
		}
		acts.Close()
	}
	// پرداخت‌های امتحانی ترم.
	srcFA := map[string]string{"INVIGILATION": "مراقبت", "CORRECTION": "تصحیح", "EXEC": "اجرا"}
	pays, err := e.Pool.Query(ctx, `
		select source, coalesce("sessionCount",0), amount::float8
		  from exam_payments where "staffId" = $1 and "termId" = $2`, staffID, termID)
	if err == nil {
		for pays.Next() {
			var source string
			var sessions int
			var amount float64
			if err := pays.Scan(&source, &sessions, &amount); err == nil {
				label := srcFA[source]
				if label == "" {
					label = source
				}
				meta, _ := json.Marshal(map[string]any{"kind": "exam", "source": source})
				items = append(items, itemRow{section: "EXAM",
					title:  fmt.Sprintf("%s — %d جلسه", label, sessions),
					amount: strconv.Itoa(int(math.Round(amount))), metaJSON: string(meta)})
			}
		}
		pays.Close()
	}
	// جمع‌بندی.
	summaryUnits := strconv.FormatFloat(calc.PayableUnits, 'f', -1, 64)
	summaryTitle := fmt.Sprintf("جمع قابل پرداخت: %s واحد — خالص %s ریال",
		strconv.FormatFloat(calc.PayableUnits, 'f', -1, 64), groupThousands(calc.Net))
	summaryMeta, _ := json.Marshal(map[string]any{"kind": "summary", "gross": calc.Gross, "tax": calc.Tax})
	items = append(items, itemRow{section: "SUMMARY", title: summaryTitle, units: &summaryUnits,
		amount: strconv.Itoa(int(math.Round(calc.Net))), metaJSON: string(summaryMeta)})

	for _, it := range items {
		if _, err := tx.Exec(ctx, `
			insert into decree_items ("decreeId",section,title,units,amount,"metaJson")
			values ($1,$2,$3,$4,$5,$6)`, decreeID, it.section, it.title, it.units, it.amount, it.metaJSON); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return decreeID, nil
}

// CalcStaffPayrollFromTerm فیش یک استاد در ترم مشخص (برای ابلاغ).
func CalcStaffPayrollFromTerm(ctx context.Context, e *Engine, staffID, termID int64) (*StaffPayroll, error) {
	data, err := e.LoadTermPayrollData(ctx, termID)
	if err != nil {
		return nil, err
	}
	return CalcStaffPayrollFromData(data, staffID)
}

func intToStr(v int) string {
	if v < 0 {
		return "0"
	}
	return fmt.Sprintf("%d", v)
}

// FinalizeDecree نهایی‌سازی پیش‌نویس (DRAFT → ISSUED).
func (e *Engine) FinalizeDecree(ctx context.Context, id, actorUserID int64) error {
	var status string
	if err := e.Pool.QueryRow(ctx, `select status from teaching_decrees where id = $1`, id).Scan(&status); err != nil {
		return errors.New("ابلاغ یافت نشد.")
	}
	if status != "DRAFT" {
		return errors.New("فقط پیش‌نویس نهایی می‌شود.")
	}
	_, err := e.Pool.Exec(ctx, `
		update teaching_decrees set status = 'ISSUED', "issuedBy" = $2, "issuedAt" = now() where id = $1`, id, actorUserID)
	return err
}

// DeleteDraftDecree حذف پیش‌نویس (ابلاغ صادرشده حذف نمی‌شود).
func (e *Engine) DeleteDraftDecree(ctx context.Context, id int64) error {
	var status string
	if err := e.Pool.QueryRow(ctx, `select status from teaching_decrees where id = $1`, id).Scan(&status); err != nil {
		return errors.New("ابلاغ یافت نشد.")
	}
	if status != "DRAFT" {
		return errors.New("ابلاغ صادرشده حذف نمی‌شود.")
	}
	if _, err := e.Pool.Exec(ctx, `delete from decree_items where "decreeId" = $1`, id); err != nil {
		return err
	}
	_, err := e.Pool.Exec(ctx, `delete from teaching_decrees where id = $1`, id)
	return err
}
