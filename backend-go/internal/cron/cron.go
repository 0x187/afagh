// ═══ کرون‌جاب‌های پس‌زمینه — پورت api/cron/* ═══
//
//  هر جاب با هدر x-cron-secret و کلید تنظیمی خودش (fail-closed) اجرا می‌شود،
//  ممیزی زنجیره‌هش می‌نویسد و GET فقط وضعیت است (بدون اثر جانبی).
package cron

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/finance"
	"backend-go/internal/jalali"
	"backend-go/internal/settings"
	"backend-go/internal/workflow"
	"backend-go/internal/messaging"
)

// Engine موتور کرون.
type Engine struct {
	Pool      *pgxpool.Pool
	Settings  *settings.Store
	Workflow  *workflow.Engine
	mu        sync.Mutex
}

// New ساخت موتور.
func New(pool *pgxpool.Pool, settingsStore *settings.Store, wf *workflow.Engine) *Engine {
	return &Engine{Pool: pool, Settings: settingsStore, Workflow: wf}
}

// JobFunc اجزای یک جاب.
type JobFunc func(ctx context.Context) (map[string]any, error)

// Job تعریف جاب.
type Job struct {
	Name        string // slug مسیر
	SecretKey   string // تنظیم حاوی راز
	RateKey     string // پیشوند محدودیت نرخ
	Description string
	Run         JobFunc
}

// Jobs فهرست جاب‌ها.
func (e *Engine) Jobs() []Job {
	return []Job{
		{Name: "bypass-deadlines", SecretKey: "BYPASS_CRON_SECRET", RateKey: "cron:bypass",
			Description: "پویش مهلت درخواست‌های بدون پیش‌نیاز (یادآوری/ارجاع/رد خودکار)",
			Run:         e.runBypassDeadlines},
		{Name: "cheque-reminders", SecretKey: "CHEQUE_CRON_SECRET", RateKey: "cron:cheque",
			Description: "یادآوری چک‌های در شرف سررسید",
			Run:         e.runChequeReminders},
		{Name: "workflow-events", SecretKey: "WORKFLOW_CRON_SECRET", RateKey: "cron:workflow-events",
			Description: "اجرای دوبارهٔ رویدادهای ناموفق گردش کار",
			Run:         e.runWorkflowEvents},
	}
}

// Find جاب با نام.
func (e *Engine) Find(name string) *Job {
	for _, j := range e.Jobs() {
		if j.Name == name {
			jj := j
			return &jj
		}
	}
	return nil
}

// SecretMatches مقایسهٔ زمان‌ثابت راز.
func SecretMatches(provided, expected string) bool {
	provided = strings.TrimSpace(provided)
	expected = strings.TrimSpace(expected)
	if provided == "" || expected == "" || len(provided) != len(expected) {
		return false
	}
	return subtleEqual([]byte(provided), []byte(expected))
}

func subtleEqual(a, b []byte) bool {
	var v byte
	for i := range a {
		v |= a[i] ^ b[i]
	}
	return v == 0
}

// Audit ثبت ممیزی جاب (بهترین تلاش).
func (e *Engine) Audit(ctx context.Context, action string, details map[string]any) {
	dj, _ := json.Marshal(details)
	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	var prev string
	if err := tx.QueryRow(ctx, `select coalesce(hash,'') from audit_logs order by id desc limit 1 for update`).Scan(&prev); err != nil && err != pgx.ErrNoRows {
		prev = ""
	}
	h := sha256.Sum256([]byte(prev + "|" + action + "|cron||" + string(dj)))
	if _, err := tx.Exec(ctx, `
		insert into audit_logs ("actorUserId", action, "entityType", details, "prevHash", hash)
		values (null,$1,'cron',$2,$3,$4)`, action, string(dj), prev, hex.EncodeToString(h[:])); err != nil {
		return
	}
	_ = tx.Commit(ctx)
}

func (e *Engine) notifyUser(ctx context.Context, userID int64, eventCode, text string) {
	if userID <= 0 {
		return
	}
	payload, _ := json.Marshal(map[string]string{"text": text})
	_, _ = e.Pool.Exec(ctx, `insert into notifications ("userId","eventCode",payload) values ($1,$2,$3)`,
		userID, eventCode, string(payload))
	messaging.NotifyExternalDefault(ctx, userID, eventCode, text)
}

func (e *Engine) notifyUsers(ctx context.Context, userIDs []int64, eventCode, text string) {
	seen := map[int64]bool{}
	for _, id := range userIDs {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		e.notifyUser(ctx, id, eventCode, text)
	}
}

// ─────────────────── cheque-reminders ───────────────────

// runChequeReminders پورت runChequeReminderScan.
func (e *Engine) runChequeReminders(ctx context.Context) (map[string]any, error) {
	remindDays := math.Max(0, math.Round(e.Settings.GetNumber(ctx, "CHEQUE_REMIND_DAYS", 0)))
	enabledRaw, _ := e.Settings.Get(ctx, "CHEQUE_REMIND_ENABLED")
	enabled := strings.TrimSpace(enabledRaw) != "0"
	dryRun := !enabled

	rows, err := e.Pool.Query(ctx, `
		select c.id, c."studentId", st."userId", c."chequeNo", c."bankName",
		       c.amount::float8, c."dueDate", c.status, c."remindedAt"::text
		  from payment_cheques c
		  join students st on st.id = c."studentId"
		 where c.status = 'PENDING'`)
	if err != nil {
		return nil, err
	}
	type chq struct {
		ID, StudentID, UserID int64
		ChequeNo, BankName    *string
		Amount                float64
		DueDate               any
		Status                *string
		RemindedAt            *string
	}
	list := []chq{}
	for rows.Next() {
		var c chq
		if err := rows.Scan(&c.ID, &c.StudentID, &c.UserID, &c.ChequeNo, &c.BankName, &c.Amount, &c.DueDate, &c.Status, &c.RemindedAt); err == nil {
			list = append(list, c)
		}
	}
	rows.Close()

	nowMs := time.Now().UnixMilli()
	res := map[string]any{"scanned": len(list), "reminded": 0, "failed": 0, "skipped": 0, "dryRun": dryRun}
	reminded, failed, skipped := 0, 0, 0
	items := []map[string]any{}
	for _, c := range list {
		decision := finance.ChequeNeedsReminder(finance.ChequeReminderRow{
			ID: c.ID, ChequeNo: c.ChequeNo, Amount: c.Amount, DueDate: c.DueDate,
			Status: c.Status, RemindedAt: c.RemindedAt,
		}, nowMs, remindDays)
		if !decision.Remind {
			skipped++
			continue
		}
		sent := false
		if !dryRun && c.UserID > 0 {
			text := finance.BuildChequeReminderText(finance.ReminderTextInput{
				ChequeNo: c.ChequeNo, Amount: c.Amount, DueDate: c.DueDate, BankName: c.BankName,
			}, decision.DaysLeft, decision.Overdue)
			e.notifyUser(ctx, c.UserID, "FINANCE_CHEQUE_DUE", text)
			if _, err := e.Pool.Exec(ctx, `update payment_cheques set "remindedAt" = now() where id = $1`, c.ID); err != nil {
				failed++
				continue
			}
			sent = true
			reminded++
		} else {
			skipped++
		}
		item := map[string]any{"chequeId": c.ID, "studentId": c.StudentID, "daysLeft": decision.DaysLeft, "overdue": decision.Overdue, "sent": sent}
		items = append(items, item)
	}
	res["reminded"], res["failed"], res["skipped"], res["items"] = reminded, failed, skipped, items
	return res, nil
}

// ─────────────────── workflow-events ───────────────────

// runWorkflowEvents اجرای دوبارهٔ رویدادهای FAILED/SKIPPED با قفل مشورتی.
func (e *Engine) runWorkflowEvents(ctx context.Context) (map[string]any, error) {
	if e.Workflow == nil {
		return map[string]any{"retried": 0, "ok": 0, "failed": 0}, nil
	}
	var got bool
	_ = e.Pool.QueryRow(ctx, `select pg_try_advisory_lock(hashtext('afagh:workflow:events'))`).Scan(&got)
	if !got {
		return map[string]any{"retried": 0, "ok": 0, "failed": 0, "skipped": true}, nil
	}
	defer func() { _, _ = e.Pool.Exec(ctx, `select pg_advisory_unlock(hashtext('afagh:workflow:events'))`) }()
	res, err := e.Workflow.RetryPendingWorkflowEvents(ctx, 100)
	if err != nil {
		return nil, err
	}
	return map[string]any{"retried": res.Retried, "ok": res.OK, "failed": res.Failed}, nil
}

// ─────────────────── bypass-deadlines ───────────────────

func hoursOf(v *int, fallback int) int {
	if v == nil || *v <= 0 {
		return fallback
	}
	return *v
}

func faDate(d time.Time) string {
	j := jalali.ToJalaliFromTime(d)
	return jalali.FaDigits(fmt.Sprintf("%04d/%02d/%02d %02d:%02d", j.Y, j.M, j.D, d.Hour(), d.Minute()))
}

var bypassKindLabel = map[string]string{
	"PREREQUISITE": "پیش‌نیاز", "EXAM_CONFLICT": "تداخل امتحانی",
	"TIME_CONFLICT": "تداخل زمانی", "CAPACITY": "ظرفیت", "OTHER": "محدودیت",
}

// runBypassDeadlines پورت runBypassDeadlines (یادآوری/ارجاع/رد خودکار + آزادسازی صندلی).
func (e *Engine) runBypassDeadlines(ctx context.Context) (map[string]any, error) {
	now := time.Now()
	stats := map[string]any{"reminders": 0, "escalated": 0, "studentWarnings": 0, "expired": 0}
	reminders, escalated, studentWarnings, expired := 0, 0, 0, 0

	rows, err := e.Pool.Query(ctx, `
		select b.id, b."studentId", b."offeringId", b.kind, b.status, b."seatReserved",
		       b."managerDeadlineAt", b."expertDeadlineAt",
		       b."managerReminderAt"::text, b."expertReminderAt"::text, b."studentWarnedAt"::text,
		       c.title, c.id, t."bypassManagerHours", t."bypassExpertHours", t."bypassReminderHours"
		  from enroll_bypass_requests b
		  join course_offerings o on o.id = b."offeringId"
		  join courses c on c.id = o."courseId"
		  join academic_terms t on t.id = b."termId"
		 where b.status in ('PENDING_MANAGER','ESCALATED_EXPERT')`)
	if err != nil {
		return nil, err
	}
	type brow struct {
		ID, StudentID, OfferingID, CourseID int64
		Kind, Status                        string
		SeatReserved                        *int
		ManagerDeadlineAt, ExpertDeadlineAt *time.Time
		ManagerReminderAt, ExpertReminderAt, StudentWarnedAt *string
		CourseTitle                         string
		ManagerHours, ExpertHours, ReminderHours *int
	}
	list := []brow{}
	for rows.Next() {
		var b brow
		if err := rows.Scan(&b.ID, &b.StudentID, &b.OfferingID, &b.Kind, &b.Status, &b.SeatReserved,
			&b.ManagerDeadlineAt, &b.ExpertDeadlineAt,
			&b.ManagerReminderAt, &b.ExpertReminderAt, &b.StudentWarnedAt,
			&b.CourseTitle, &b.CourseID, &b.ManagerHours, &b.ExpertHours, &b.ReminderHours); err == nil {
			list = append(list, b)
		}
	}
	rows.Close()

	for _, b := range list {
		warningHours := hoursOf(b.ReminderHours, 10)
		warningDur := time.Duration(warningHours) * time.Hour
		kindLabel := bypassKindLabel[strings.ToUpper(b.Kind)]
		if kindLabel == "" {
			kindLabel = "محدودیت"
		}
		var firstName, lastName string
		var userID, majorID *int64
		var majorName, majorDeptID, majorFacultyID *int64
		var majorTitle *string
		_ = e.Pool.QueryRow(ctx, `
			select st."userId", st."majorId", coalesce(u."firstName",''), coalesce(u."lastName",''),
			       m.name, m."departmentId", m."facultyId"
			  from students st
			  join users u on u.id = st."userId"
			  left join majors m on m.id = st."majorId"
			 where st.id = $1`, b.StudentID).
			Scan(&userID, &majorID, &firstName, &lastName, &majorTitle, &majorDeptID, &majorFacultyID)
		_ = majorName
		name := strings.TrimSpace(firstName + " " + lastName)

		if strings.ToUpper(b.Status) == "PENDING_MANAGER" {
			if b.ManagerDeadlineAt != nil && !b.ManagerDeadlineAt.After(now) {
				expertHours := hoursOf(b.ExpertHours, 12)
				expertDeadline := now.Add(time.Duration(expertHours) * time.Hour)
				if _, err := e.Pool.Exec(ctx, `
					update enroll_bypass_requests set status = 'ESCALATED_EXPERT', "escalatedAt" = $2,
					  "expertDeadlineAt" = $3, "updatedAt" = $2 where id = $1`, b.ID, now, expertDeadline); err != nil {
					continue
				}
				escalated++
				experts := e.expertUserIDsForMajor(ctx, *majorID, majorDeptID, majorFacultyID)
				if len(experts) == 0 {
					experts = e.viceEducationUserIDs(ctx)
				}
				e.notifyUsers(ctx, experts, "BYPASS_ESCALATED_TO_EXPERT",
					fmt.Sprintf("درخواست %s برای درس «%s» بدون رعایت %s به دلیل عدم پاسخ مدیر گروه به شما ارجاع شد. مهلت بررسی: %s.",
						name, b.CourseTitle, kindLabel, faDate(expertDeadline)))
				continue
			}
			if b.ManagerReminderAt == nil && b.ManagerDeadlineAt != nil && !b.ManagerDeadlineAt.Add(-warningDur).After(now) {
				managers := e.managerUserIDsForCourse(ctx, b.CourseID)
				e.notifyUsers(ctx, managers, "BYPASS_REMINDER_MANAGER",
					fmt.Sprintf("درخواست %s برای درس «%s» هنوز بررسی نشده و مهلت آن تا %s است.",
						name, b.CourseTitle, faDate(*b.ManagerDeadlineAt)))
				_, _ = e.Pool.Exec(ctx, `update enroll_bypass_requests set "managerReminderAt" = $2, "updatedAt" = $2 where id = $1`, b.ID, now)
				reminders++
			}
			continue
		}

		// ESCALATED_EXPERT
		if b.ExpertDeadlineAt == nil {
			continue
		}
		if !b.ExpertDeadlineAt.After(now) {
			if _, err := e.Pool.Exec(ctx, `
				update enroll_bypass_requests set status = 'AUTO_REJECTED', "reasonCode" = 'NO_RESPONSE',
				  "decidedRole" = 'SYSTEM', "decidedAt" = $2, "seatReserved" = 0, "updatedAt" = $2 where id = $1`, b.ID, now); err != nil {
				continue
			}
			if b.SeatReserved != nil && *b.SeatReserved == 1 {
				_, _ = e.Pool.Exec(ctx, `update course_offerings set "enrolledCount" = greatest("enrolledCount" - 1, 0) where id = $1`, b.OfferingID)
			}
			expired++
			if userID != nil {
				majorNameStr := "رشته"
				if majorTitle != nil && *majorTitle != "" {
					majorNameStr = *majorTitle
				}
				e.notifyUser(ctx, *userID, "BYPASS_AUTO_REJECTED",
					fmt.Sprintf("درس «%s» به دلیل عدم رعایت %s و طبق قوانین آموزشی برایتان ثبت نشد (بدون پاسخ در مهلت تعیین‌شده). برای پیگیری به آموزش %s مراجعه کنید.",
						b.CourseTitle, kindLabel, majorNameStr))
			}
			e.notifyUsers(ctx, e.viceEducationUserIDs(ctx), "BYPASS_VICE_NOTICE",
				fmt.Sprintf("یک درخواست بدون رعایت %s برای درس «%s» (%s) در مهلت پاسخ‌دهی بی‌پاسخ ماند و به‌صورت خودکار رد شد. جهت بررسی به داشبورد معاون آموزش مراجعه فرمایید.",
					kindLabel, b.CourseTitle, name))
			continue
		}
		if b.StudentWarnedAt == nil && !b.ExpertDeadlineAt.Add(-warningDur).After(now) {
			if userID != nil {
				e.notifyUser(ctx, *userID, "BYPASS_STUDENT_FOLLOWUP_WARNING",
					fmt.Sprintf("درخواست شما برای ثبت درس «%s» بدون رعایت %s هنوز بررسی نشده است. لطفاً سریعاً از آموزش رشته پیگیری کنید، وگرنه این درس برایتان ثبت نخواهد شد.",
						b.CourseTitle, kindLabel))
			}
			_, _ = e.Pool.Exec(ctx, `update enroll_bypass_requests set "studentWarnedAt" = $2, "updatedAt" = $2 where id = $1`, b.ID, now)
			studentWarnings++
		}
		if b.ExpertReminderAt == nil && !b.ExpertDeadlineAt.Add(-warningDur).After(now) {
			experts := e.expertUserIDsForMajor(ctx, *majorID, majorDeptID, majorFacultyID)
			e.notifyUsers(ctx, experts, "BYPASS_REMINDER_EXPERT",
				fmt.Sprintf("درخواست %s برای درس «%s» هنوز بررسی نشده و مهلت آن تا %s است.",
					name, b.CourseTitle, faDate(*b.ExpertDeadlineAt)))
			_, _ = e.Pool.Exec(ctx, `update enroll_bypass_requests set "expertReminderAt" = $2, "updatedAt" = $2 where id = $1`, b.ID, now)
			reminders++
		}
	}

	stats["reminders"], stats["escalated"], stats["studentWarnings"], stats["expired"] = reminders, escalated, studentWarnings, expired
	return stats, nil
}

// managerUserIDsForCourse مدیر گروه درس (از headStaffId گروه).
func (e *Engine) managerUserIDsForCourse(ctx context.Context, courseID int64) []int64 {
	var deptID *int64
	_ = e.Pool.QueryRow(ctx, `select "departmentId" from courses where id = $1`, courseID).Scan(&deptID)
	if deptID == nil {
		return nil
	}
	var headStaffID *int64
	_ = e.Pool.QueryRow(ctx, `select "headStaffId" from departments where id = $1`, *deptID).Scan(&headStaffID)
	if headStaffID == nil {
		return nil
	}
	var userID int64
	if err := e.Pool.QueryRow(ctx, `select "userId" from staff where id = $1`, *headStaffID).Scan(&userID); err != nil {
		return nil
	}
	return []int64{userID}
}

// expertUserIDsForMajor کارشناسان آموزش مسئول رشته (expert_scopes).
func (e *Engine) expertUserIDsForMajor(ctx context.Context, majorID int64, deptID, facultyID *int64) []int64 {
	if majorID <= 0 {
		return nil
	}
	args := []any{majorID}
	where := `(("scopeType" = 'MAJOR' and "scopeId" = $1)`
	if deptID != nil {
		args = append(args, *deptID)
		where += fmt.Sprintf(` or ("scopeType" = 'DEPARTMENT' and "scopeId" = $%d)`, len(args))
	}
	if facultyID != nil {
		args = append(args, *facultyID)
		where += fmt.Sprintf(` or ("scopeType" = 'FACULTY' and "scopeId" = $%d)`, len(args))
	}
	where += `)`
	rows, err := e.Pool.Query(ctx, `select distinct "userId" from expert_scopes where `+where, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			out = append(out, id)
		}
	}
	return out
}

// viceEducationUserIDs کاربران با نقش VICE_EDU.
func (e *Engine) viceEducationUserIDs(ctx context.Context) []int64 {
	rows, err := e.Pool.Query(ctx, `
		select distinct ur."userId" from user_roles ur
		  join roles r on r.id = ur."roleId" where r.code = 'VICE_EDU'`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			out = append(out, id)
		}
	}
	return out
}
