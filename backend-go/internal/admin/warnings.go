// ═══ هشدارهای زمان‌بندی‌شدهٔ دانشجو — پورت api/admin/warnings ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"backend-go/internal/fa"
	"backend-go/internal/session"
)

// WarningStatuses وضعیت‌های مجاز.
var WarningStatuses = []string{"pending", "sent", "cancelled"}

// WarningTypes انواع مجاز هشدار.
var WarningTypes = []string{
	"TUITION_DEADLINE", "LOW_ATTENDANCE", "MISSING_DOCS",
	"EXAM_REMINDER", "ENROLL_DEADLINE", "CUSTOM",
}

// WarningTypeLabel برچسب فارسی نوع.
var WarningTypeLabel = map[string]string{
	"TUITION_DEADLINE": "یادآوری شهریه",
	"LOW_ATTENDANCE":   "هشدار غیبت",
	"MISSING_DOCS":     "نقص مدارک",
	"EXAM_REMINDER":    "یادآوری امتحان",
	"ENROLL_DEADLINE":  "مهلت انتخاب واحد",
	"CUSTOM":           "دلخواه",
}

// WarningTypeLabelOf برچسب امن (نوع ناشناخته → خودش).
func WarningTypeLabelOf(t string) string {
	if v, ok := WarningTypeLabel[strings.ToUpper(strings.TrimSpace(t))]; ok {
		return v
	}
	if strings.TrimSpace(t) == "" {
		return "—"
	}
	return t
}

// IsWarningType اعتبار نوع.
func IsWarningType(v string) bool {
	v = strings.ToUpper(strings.TrimSpace(v))
	for _, t := range WarningTypes {
		if t == v {
			return true
		}
	}
	return false
}

// IsWarningStatus اعتبار وضعیت.
func IsWarningStatus(v string) bool {
	for _, s := range WarningStatuses {
		if s == v {
			return true
		}
	}
	return false
}

// WarningRow ردیف هشدار.
type WarningRow struct {
	ID          int64      `json:"id"`
	StudentID   int64      `json:"studentId"`
	StudentCode *string    `json:"studentCode"`
	StudentName *string    `json:"studentName"`
	WarningType *string    `json:"warningType"`
	Title       *string    `json:"title"`
	Message     *string    `json:"message"`
	SendAt      time.Time  `json:"sendAt"`
	SentAt      *time.Time `json:"sentAt"`
	Status      string     `json:"status"`
	CreatedAt   *time.Time `json:"createdAt"`
}

// WarningListResult پاسخ فهرست.
type WarningListResult struct {
	Rows     []WarningRow `json:"rows"`
	Total    int          `json:"total"`
	Page     int          `json:"page"`
	PageSize int          `json:"pageSize"`
}

// WarningFilters فیلترهای فهرست.
type WarningFilters struct {
	Q         string
	Status    string
	Type      string
	DateFrom  string
	DateTo    string
	StudentID int64
	Page      int
}

// WarningStudentHit نتیجهٔ جست‌وجوی دانشجو.
type WarningStudentHit struct {
	StudentID   int64  `json:"studentId"`
	StudentCode string `json:"studentCode"`
	Name        string `json:"name"`
	EntryYear   *int   `json:"entryYear"`
}

// WarningCreateInput ورودی ثبت.
type WarningCreateInput struct {
	StudentID   int64   `json:"studentId"`
	WarningType string  `json:"warningType"`
	Title       *string `json:"title"`
	Message     *string `json:"message"`
	SendAt      string  `json:"sendAt"`
}

// WarningPatchInput ورودی ویرایش/لغو/ارسال فوری.
type WarningPatchInput struct {
	Title       *string `json:"title"`
	Message     *string `json:"message"`
	WarningType *string `json:"warningType"`
	SendAt      *string `json:"sendAt"`
	Status      *string `json:"status"`
	SendNow     bool    `json:"sendNow"`
}

const warningPageSize = 50

// warningUni گارد دانشگاه فعال.
func (s *Service) warningUni(ctx context.Context, user *session.User, cookie string) (*int64, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال معتبر نیست.")
	}
	return uniID, nil
}

func (s *Service) warningStudentInUni(ctx context.Context, studentID, uniID int64) (string, error) {
	var code string
	err := s.DB.Pool.QueryRow(ctx, `
		select coalesce("studentCode",'') from students where id = $1 and "universityId" = $2`,
		studentID, uniID).Scan(&code)
	if err != nil {
		return "", errors.New("دانشجو در دانشگاه فعال یافت نشد.")
	}
	return code, nil
}

// ListWarnings پورت GET api/admin/warnings.
func (s *Service) ListWarnings(ctx context.Context, user *session.User, cookie string, f WarningFilters) (*WarningListResult, error) {
	uniID, err := s.warningUni(ctx, user, cookie)
	if err != nil {
		return nil, err
	}
	if f.Status != "" && !IsWarningStatus(f.Status) {
		return nil, errors.New("وضعیت نامعتبر است.")
	}
	if f.Type != "" && !IsWarningType(f.Type) {
		return nil, errors.New("نوع هشدار نامعتبر است.")
	}
	page := f.Page
	if page < 1 {
		page = 1
	}
	if page > 1_000_000 {
		page = 1_000_000
	}

	args := []any{*uniID}
	conds := []string{`w."universityId" = $1`}
	add := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	if f.Status != "" {
		conds = append(conds, `w.status = `+add(f.Status))
	}
	if f.Type != "" {
		conds = append(conds, `w."warningType" = `+add(f.Type))
	}
	if f.StudentID > 0 {
		conds = append(conds, `w."studentId" = `+add(f.StudentID))
	}
	if f.DateFrom != "" {
		if len(f.DateFrom) != 10 {
			return nil, errors.New("تاریخ شروع نامعتبر است.")
		}
		d, perr := time.Parse("2006-01-02", f.DateFrom)
		if perr != nil {
			return nil, errors.New("تاریخ شروع نامعتبر است.")
		}
		conds = append(conds, `w."sendAt" >= `+add(d))
	}
	if f.DateTo != "" {
		if len(f.DateTo) != 10 {
			return nil, errors.New("تاریخ پایان نامعتبر است.")
		}
		d, perr := time.Parse("2006-01-02T15:04:05", f.DateTo+"T23:59:59")
		if perr != nil {
			return nil, errors.New("تاریخ پایان نامعتبر است.")
		}
		conds = append(conds, `w."sendAt" <= `+add(d))
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		like := "%" + fa.EscapeLikeChars(q) + "%"
		p := add(like)
		conds = append(conds, fmt.Sprintf(`(s."studentCode" LIKE %s ESCAPE '\' OR (u."firstName" || ' ' || u."lastName") LIKE %s ESCAPE '\' OR w.title LIKE %s ESCAPE '\')`, p, p, p))
	}
	where := strings.Join(conds, " AND ")
	from := `from scheduled_warnings w
		left join students s on s.id = w."studentId"
		left join users u on u.id = s."userId"`

	var total int
	if err := s.DB.Pool.QueryRow(ctx, `select count(*)::int `+from+` where `+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	dataArgs := append([]any{}, args...)
	dataArgs = append(dataArgs, warningPageSize, (page-1)*warningPageSize)
	rows, err := s.DB.Pool.Query(ctx, `
		select w.id, w."studentId", s."studentCode",
		       case when s.id is null then null else (u."firstName" || ' ' || u."lastName") end,
		       w."warningType", w.title, w.message, w."sendAt", w."sentAt", w.status, w."createdAt"
		  `+from+` where `+where+`
		 order by w."sendAt"
		 limit $`+strconv.Itoa(len(dataArgs)-1)+` offset $`+strconv.Itoa(len(dataArgs)), dataArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WarningRow{}
	for rows.Next() {
		var r WarningRow
		if err := rows.Scan(&r.ID, &r.StudentID, &r.StudentCode, &r.StudentName,
			&r.WarningType, &r.Title, &r.Message, &r.SendAt, &r.SentAt, &r.Status, &r.CreatedAt); err == nil {
			out = append(out, r)
		}
	}
	return &WarningListResult{Rows: out, Total: total, Page: page, PageSize: warningPageSize}, nil
}

// SearchWarningStudents جست‌وجوی دانشجو برای انتخاب‌گر (حداقل ۲ حرف).
func (s *Service) SearchWarningStudents(ctx context.Context, user *session.User, cookie, q string) ([]WarningStudentHit, error) {
	uniID, err := s.warningUni(ctx, user, cookie)
	if err != nil {
		return nil, err
	}
	q = strings.TrimSpace(q)
	out := []WarningStudentHit{}
	if len([]rune(q)) < 2 {
		return out, nil
	}
	like := "%" + fa.EscapeLikeChars(q) + "%"
	rows, err := s.DB.Pool.Query(ctx, `
		select s.id, coalesce(s."studentCode",''),
		       (u."firstName" || ' ' || u."lastName"), s."entryYear"
		  from students s join users u on u.id = s."userId"
		 where s."universityId" = $1
		   and (s."studentCode" = $2 or (u."firstName" || ' ' || u."lastName") like $3 escape '\')
		 order by s."studentCode" limit 20`, *uniID, q, like)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var h WarningStudentHit
		if err := rows.Scan(&h.StudentID, &h.StudentCode, &h.Name, &h.EntryYear); err == nil {
			out = append(out, h)
		}
	}
	return out, nil
}

// CreateWarning ثبت هشدار جدید.
func (s *Service) CreateWarning(ctx context.Context, user *session.User, cookie string, in WarningCreateInput) (int64, error) {
	uniID, err := s.warningUni(ctx, user, cookie)
	if err != nil {
		return 0, err
	}
	if in.StudentID <= 0 {
		return 0, errors.New("شناسه دانشجو نامعتبر است.")
	}
	if !IsWarningType(in.WarningType) {
		return 0, errors.New("نوع هشدار نامعتبر است.")
	}
	if _, err := s.warningStudentInUni(ctx, in.StudentID, *uniID); err != nil {
		return 0, err
	}
	sendAt, perr := time.Parse(time.RFC3339, in.SendAt)
	if perr != nil {
		if d, e := time.Parse("2006-01-02T15:04", in.SendAt); e == nil {
			sendAt = d
		} else {
			return 0, errors.New("زمان ارسال نامعتبر است.")
		}
	}
	// ستون timestamp بدون منطقه‌زمان است؛ برای هم‌خوانی با now() دیتابیس
	// (UTC) همیشه دیوارهٔ ساعت UTC ذخیره می‌شود.
	sendAt = sendAt.UTC()
	var id int64
	err = s.DB.Pool.QueryRow(ctx, `
		insert into scheduled_warnings ("studentId","warningType",title,message,"sendAt",status,"createdBy","universityId")
		values ($1,$2,$3,$4,$5,'pending',$6,$7) returning id`,
		in.StudentID, strings.ToUpper(in.WarningType), nilIfBlank(in.Title), nilIfBlank(in.Message),
		sendAt, user.ID, *uniID).Scan(&id)
	if err != nil {
		return 0, errors.New("ثبت هشدار ناموفق بود؛ دوباره تلاش کنید.")
	}
	details := fmt.Sprintf(`{"studentId":%d,"warningType":%s,"sendAt":%s}`,
		in.StudentID, jsonQuote(strings.ToUpper(in.WarningType)), jsonQuote(sendAt.UTC().Format(time.RFC3339)))
	_ = s.writeAdminAudit(ctx, user.ID, "SCHED_WARNING_CREATED", "scheduled_warning", id, details)
	return id, nil
}

// UpdateWarning ویرایش/لغو/ارسال فوری.
func (s *Service) UpdateWarning(ctx context.Context, user *session.User, cookie string, id int64, in WarningPatchInput) error {
	uniID, err := s.warningUni(ctx, user, cookie)
	if err != nil {
		return err
	}
	if id <= 0 {
		return errors.New("شناسه هشدار نامعتبر است.")
	}
	var studentID int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select "studentId" from scheduled_warnings where id = $1 and "universityId" = $2`,
		id, *uniID).Scan(&studentID); err != nil {
		return errors.New("هشدار پیدا نشد.")
	}
	if _, err := s.warningStudentInUni(ctx, studentID, *uniID); err != nil {
		return err
	}
	if in.WarningType != nil && !IsWarningType(*in.WarningType) {
		return errors.New("نوع هشدار نامعتبر است.")
	}
	if in.Status != nil && *in.Status != "pending" && *in.Status != "cancelled" {
		return errors.New("وضعیت نامعتبر است.")
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var prevStatus string
	if err := tx.QueryRow(ctx, `
		select status from scheduled_warnings where id = $1 and "universityId" = $2 for update`,
		id, *uniID).Scan(&prevStatus); err != nil {
		return errors.New("هشدار پیدا نشد.")
	}

	sets := []string{}
	args := []any{}
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, col+" = $"+strconv.Itoa(len(args)))
	}
	if in.Title != nil {
		add("title", nilIfBlank(in.Title))
	}
	if in.Message != nil {
		add("message", nilIfBlank(in.Message))
	}
	if in.WarningType != nil {
		add(`"warningType"`, strings.ToUpper(*in.WarningType))
	}
	if in.SendAt != nil && *in.SendAt != "" {
		d, perr := time.Parse(time.RFC3339, *in.SendAt)
		if perr != nil {
			if d2, e := time.Parse("2006-01-02T15:04", *in.SendAt); e == nil {
				d = d2
			} else {
				return errors.New("زمان ارسال نامعتبر است.")
			}
		}
		add(`"sendAt"`, d.UTC())
	}
	if in.Status != nil {
		add("status", *in.Status)
	}
	if in.SendNow {
		add("status", "pending")
		add(`"sendAt"`, time.Now().UTC())
	}
	if len(sets) > 0 {
		args = append(args, id)
		if _, err := tx.Exec(ctx, `update scheduled_warnings set `+strings.Join(sets, ", ")+` where id = $`+strconv.Itoa(len(args)), args...); err != nil {
			return err
		}
	}
	details := fmt.Sprintf(`{"from":%s,"patch":[%s]}`, jsonQuote(prevStatus), patchKeys(sets))
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "SCHED_WARNING_UPDATED", "scheduled_warning", id, details); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeleteWarning حذف هشدار (فقط ADMIN — در لایهٔ HTTP هم گیت شده است).
func (s *Service) DeleteWarning(ctx context.Context, user *session.User, cookie string, id int64) error {
	uniID, err := s.warningUni(ctx, user, cookie)
	if err != nil {
		return err
	}
	if id <= 0 {
		return errors.New("شناسه هشدار نامعتبر است.")
	}
	var studentID int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select "studentId" from scheduled_warnings where id = $1 and "universityId" = $2`,
		id, *uniID).Scan(&studentID); err != nil {
		return errors.New("هشدار پیدا نشد.")
	}
	if _, err := s.warningStudentInUni(ctx, studentID, *uniID); err != nil {
		return err
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var deleted int64
	if err := tx.QueryRow(ctx, `
		delete from scheduled_warnings where id = $1 and "universityId" = $2 returning id`,
		id, *uniID).Scan(&deleted); err != nil {
		return errors.New("هشدار پیدا نشد.")
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "SCHED_WARNING_DELETED", "scheduled_warning", id,
		fmt.Sprintf(`{"id":%d}`, id)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func nilIfBlank(p *string) *string {
	if p == nil {
		return nil
	}
	v := strings.TrimSpace(*p)
	if v == "" {
		return nil
	}
	return &v
}

func patchKeys(sets []string) string {
	keys := make([]string, 0, len(sets))
	for _, s := range sets {
		col := strings.TrimSpace(strings.SplitN(s, "=", 2)[0])
		keys = append(keys, jsonQuote(col))
	}
	return strings.Join(keys, ",")
}

// jsonQuote نقل‌قول امن رشته برای جزئیات ممیزی.
func jsonQuote(v string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range v {
		switch r {
		case '"', '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}
