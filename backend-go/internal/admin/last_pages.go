// ═══ شش صفحهٔ باقی‌ماندهٔ ادمین — پیام همگانی، تأیید bypass، جلسات کلاس،
// زنجیرهٔ تحویل امتحان، ویرایشگر ارائه، رفع تداخل برنامه ═══
//
// پورت شش ماژول afagh-next/src/app/admin/{broadcast,bypass,class-sessions,
// exams/handover,offering-editor,schedule-conflicts} به‌همراه کتابخانه‌های
// سرورشان (bypass-requests.ts، schedule-conflicts.ts، exam-actions.ts).
// قرارداد پاسخ: {"ok":true,"data":...} / {"ok":false,"error":"فارسی"}.
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/messaging"
	"backend-go/internal/qr"
	"backend-go/internal/scheduleconflicts"
	"backend-go/internal/session"
	"backend-go/internal/verification"
)

// ─────────────────────────── ابزارهای مشترک ───────────────────────────

// lpNotify نتیجهٔ یک ارسال بیرونی برای گزارش.
type lpNotify struct {
	Channel string
	Status  string // SENT | SKIPPED | FAILED
}

var lpValidChannels = map[string]bool{
	"INAPP": true, "SMS": true, "SOROUSH": true, "BALE": true, "EITAA": true,
}

// lpActiveChannels فهرست کانال‌های فعال از NOTIFY_CHANNELS (پورت activeChannels).
func (s *Service) lpActiveChannels(ctx context.Context) []string {
	raw := ""
	if s.Store != nil {
		if v, err := s.Store.Get(ctx, "NOTIFY_CHANNELS"); err == nil {
			raw = v
		}
	}
	if strings.TrimSpace(raw) == "" {
		raw = "INAPP"
	}
	out := []string{}
	for _, c := range strings.Split(raw, ",") {
		c = strings.ToUpper(strings.TrimSpace(c))
		if lpValidChannels[c] {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		return []string{"INAPP"}
	}
	return out
}

// lpNotifyMultichannel پورت notifyUserMultichannel: پیام داخل پورتال همیشه
// درج می‌شود؛ کانال‌های بیرونی فقط اگر NOTIFY_ENABLED روشن باشد ارسال و در
// notification_deliveries ثبت می‌شوند.
func (s *Service) lpNotifyMultichannel(ctx context.Context, userID int64, eventCode, text string, channels []string) ([]lpNotify, error) {
	if userID <= 0 {
		return nil, errors.New("کاربر نامعتبر است.")
	}
	payload := `{"text":` + lpJSONString(text) + `}`
	if _, err := s.DB.Pool.Exec(ctx,
		`insert into notifications ("userId","eventCode",payload) values ($1,$2,$3)`,
		userID, eventCode, payload); err != nil {
		return nil, err
	}

	ext := []string{}
	if channels == nil {
		for _, c := range s.lpActiveChannels(ctx) {
			if c != "INAPP" {
				ext = append(ext, c)
			}
		}
	} else {
		for _, c := range channels {
			c = strings.ToUpper(strings.TrimSpace(c))
			if c != "INAPP" && lpValidChannels[c] {
				ext = append(ext, c)
			}
		}
	}
	if len(ext) == 0 {
		return []lpNotify{}, nil
	}
	enabled := false
	if s.Store != nil {
		if v, err := s.Store.Get(ctx, "NOTIFY_ENABLED"); err == nil {
			v = strings.ToLower(strings.TrimSpace(v))
			enabled = v == "1" || v == "true" || v == "yes" || v == "on"
		}
	}
	if !enabled || messaging.Default == nil {
		return []lpNotify{}, nil
	}

	signature := ""
	if s.Store != nil {
		if v, err := s.Store.Get(ctx, "NOTIFY_SIGNATURE"); err == nil {
			signature = strings.TrimSpace(v)
		}
	}
	body := text
	if signature != "" {
		body = text + "\n" + signature
	}

	out := []lpNotify{}
	for _, ch := range ext {
		target := lpChannelAddress(ctx, s.DB.Pool, userID, ch)
		var r messaging.DeliveryResult
		if target == nil {
			r = messaging.DeliveryResult{Channel: ch, Status: "SKIPPED"}
		} else if ch == "SMS" {
			r = messaging.Default.SendSMS(ctx, *target, body)
		} else {
			r = messaging.Default.SendMessenger(ctx, ch, *target, body)
		}
		_, _ = s.DB.Pool.Exec(ctx, `
			insert into notification_deliveries ("userId","eventCode",channel,target,status,"providerRef",error,body,"durationMs")
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			userID, eventCode, r.Channel, r.Target, r.Status, r.ProviderRef, r.Error, truncStr(body, 1000), r.DurationMs)
		out = append(out, lpNotify{Channel: r.Channel, Status: r.Status})
	}
	return out, nil
}

func lpChannelAddress(ctx context.Context, pool pgxQuerier, userID int64, channel string) *string {
	var address *string
	var active *int
	if err := pool.QueryRow(ctx, `
		select address, "isActive" from notification_channels
		 where "userId" = $1 and channel = $2 limit 1`, userID, channel).Scan(&address, &active); err == nil &&
		address != nil && active != nil && *active == 1 && *address != "" {
		return address
	}
	if channel == "SMS" {
		var mobile *string
		if err := pool.QueryRow(ctx, `select mobile from users where id = $1`, userID).Scan(&mobile); err == nil {
			return mobile
		}
	}
	return nil
}

func lpJSONString(v string) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func truncStr(v string, n int) string {
	if len(v) <= n {
		return v
	}
	return v[:n]
}

// lpStatsAdd جمع زدن آمار کانال‌ها.
func lpStatsAdd(stats map[string]*BroadcastChannelStat, channel, status string) {
	st, ok := stats[channel]
	if !ok {
		st = &BroadcastChannelStat{Channel: channel}
		stats[channel] = st
	}
	switch status {
	case "SENT":
		st.Sent++
	case "SKIPPED":
		st.Skipped++
	default:
		st.Failed++
	}
}

func lpStatsList(stats map[string]*BroadcastChannelStat) []BroadcastChannelStat {
	keys := make([]string, 0, len(stats))
	for k := range stats {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]BroadcastChannelStat, 0, len(keys))
	for _, k := range keys {
		out = append(out, *stats[k])
	}
	return out
}

// lpTermPick انتخاب ترم: درخواستی ← ترم مؤثر ← آخرین فهرست.
func lpTermPick(terms []LPTermOption, wanted int64) LPTermOption {
	for _, t := range terms {
		if t.ID == wanted {
			return t
		}
	}
	for _, t := range terms {
		if t.IsCurrent == 1 {
			return t
		}
	}
	if len(terms) > 0 {
		return terms[len(terms)-1]
	}
	return LPTermOption{}
}

// lpTermsList ترم‌های دانشگاه برای انتخاب‌گر (جدیدترین اول).
func (s *Service) lpTermsList(ctx context.Context, uniID *int64) []LPTermOption {
	rows, err := s.DB.Pool.Query(ctx, `
		select id, coalesce(title, "termCode"), coalesce("isCurrent",0)
		  from academic_terms
		 where ($1::int is null or "universityId" = $1)
		 order by id desc limit 24`, uniID)
	if err != nil {
		return []LPTermOption{}
	}
	defer rows.Close()
	out := []LPTermOption{}
	for rows.Next() {
		var t LPTermOption
		if rows.Scan(&t.ID, &t.Title, &t.IsCurrent) == nil {
			out = append(out, t)
		}
	}
	return out
}

// lpScopeTerms ترم‌های دانشگاه با کد برای صفحات جلسات/تحویل (پورت termsFor).
func (s *Service) lpScopeTerms(ctx context.Context, uniID *int64) []LPTermOption {
	if uniID == nil || *uniID <= 0 {
		return []LPTermOption{}
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, coalesce(title, "termCode"), coalesce("isCurrent",0)
		  from academic_terms where "universityId" = $1 order by id asc`, *uniID)
	if err != nil {
		return []LPTermOption{}
	}
	defer rows.Close()
	out := []LPTermOption{}
	for rows.Next() {
		var t LPTermOption
		if rows.Scan(&t.ID, &t.Title, &t.IsCurrent) == nil {
			out = append(out, t)
		}
	}
	return out
}

// ─────────────────────────── ۱) پیام همگانی (broadcast) ───────────────────────────

// LPTermOption گزینهٔ ترم.
type LPTermOption struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	IsCurrent int    `json:"isCurrent"`
}

// LPIdName شناسه + نام.
type LPIdName struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// LPDepartment گروه آموزشی.
type LPDepartment struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	FacultyID int64  `json:"facultyId"`
}

// LPMajor رشته.
type LPMajor struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	DepartmentID *int64 `json:"departmentId"`
}

// BroadcastFiltersResp فیلترهای صفحهٔ پیام همگانی.
type BroadcastFiltersResp struct {
	Faculties   []LPIdName     `json:"faculties"`
	Departments []LPDepartment `json:"departments"`
	Majors      []LPMajor      `json:"majors"`
	EntryYears  []int          `json:"entryYears"`
	Terms       []LPTermOption `json:"terms"`
}

// ListBroadcastFilters پورت getBroadcastFilters.
func (s *Service) ListBroadcastFilters(ctx context.Context, user *session.User, uniCookie string) (*BroadcastFiltersResp, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	resp := &BroadcastFiltersResp{
		Faculties: []LPIdName{}, Departments: []LPDepartment{}, Majors: []LPMajor{},
		EntryYears: []int{}, Terms: []LPTermOption{},
	}
	if uniID == nil {
		return resp, nil
	}
	if rows, err := s.DB.Pool.Query(ctx, `
		select id, name from faculties where "universityId" = $1 order by name limit 500`, *uniID); err == nil {
		for rows.Next() {
			var r LPIdName
			if rows.Scan(&r.ID, &r.Name) == nil {
				resp.Faculties = append(resp.Faculties, r)
			}
		}
		rows.Close()
	}
	if rows, err := s.DB.Pool.Query(ctx, `
		select id, name, "facultyId" from departments where "universityId" = $1 order by name limit 2000`, *uniID); err == nil {
		for rows.Next() {
			var r LPDepartment
			if rows.Scan(&r.ID, &r.Name, &r.FacultyID) == nil {
				resp.Departments = append(resp.Departments, r)
			}
		}
		rows.Close()
	}
	if rows, err := s.DB.Pool.Query(ctx, `
		select id, name, "departmentId" from majors where "universityId" = $1 order by name limit 5000`, *uniID); err == nil {
		for rows.Next() {
			var r LPMajor
			if rows.Scan(&r.ID, &r.Name, &r.DepartmentID) == nil {
				resp.Majors = append(resp.Majors, r)
			}
		}
		rows.Close()
	}
	if rows, err := s.DB.Pool.Query(ctx, `
		select distinct "entryYear" from students
		 where "universityId" = $1 and "entryYear" is not null
		 order by "entryYear" limit 60`, *uniID); err == nil {
		for rows.Next() {
			var y int
			if rows.Scan(&y) == nil {
				resp.EntryYears = append(resp.EntryYears, y)
			}
		}
		rows.Close()
	}
	resp.Terms = s.lpTermsList(ctx, uniID)
	return resp, nil
}

// BroadcastTermOffering کلاس یک ترم برای فیلتر «دانشجویان یک کلاس».
type BroadcastTermOffering struct {
	ID       int64  `json:"id"`
	Label    string `json:"label"`
	Enrolled int    `json:"enrolled"`
}

// ListTermOfferings پورت getTermOfferings — فقط ارائه‌های فعال با برچسب درس/گروه/استاد.
func (s *Service) ListTermOfferings(ctx context.Context, user *session.User, uniCookie string, termID int64) ([]BroadcastTermOffering, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	out := []BroadcastTermOffering{}
	if termID <= 0 {
		return out, nil
	}
	cond := ""
	args := []any{termID}
	if uniID != nil {
		cond = ` and o."universityId" = $2`
		args = append(args, *uniID)
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, o."groupNumber", coalesce(o."enrolledCount",0), coalesce(c.code,''), c.title, o."professorId"
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		 where o."termId" = $1 and o."isActive" = 1`+cond+`
		 order by c.title, o."groupNumber" limit 3000`, args...)
	if err != nil {
		return out, nil
	}
	type offRow struct {
		id          int64
		group       *int
		enrolled    int
		code        string
		title       string
		professorID *int64
	}
	offs := []offRow{}
	for rows.Next() {
		var r offRow
		if rows.Scan(&r.id, &r.group, &r.enrolled, &r.code, &r.title, &r.professorID) == nil {
			offs = append(offs, r)
		}
	}
	rows.Close()

	names := map[int64]string{}
	profIDs := []int64{}
	seen := map[int64]bool{}
	for _, o := range offs {
		if o.professorID != nil && !seen[*o.professorID] {
			seen[*o.professorID] = true
			profIDs = append(profIDs, *o.professorID)
		}
	}
	if len(profIDs) > 0 {
		if prows, err := s.DB.Pool.Query(ctx, `
			select st.id, coalesce(u."firstName",''), coalesce(u."lastName",'')
			  from staff st join users u on u.id = st."userId"
			 where st.id = any($1::int[]) limit 2000`, profIDs); err == nil {
			for prows.Next() {
				var id int64
				var fn, ln string
				if prows.Scan(&id, &fn, &ln) == nil {
					names[id] = strings.TrimSpace(fn + " " + ln)
				}
			}
			prows.Close()
		}
	}
	for _, o := range offs {
		group := 1
		if o.group != nil {
			group = *o.group
		}
		label := fmt.Sprintf("%s %s — گروه %d", o.code, o.title, group)
		if o.professorID != nil && names[*o.professorID] != "" {
			label += " — " + names[*o.professorID]
		}
		out = append(out, BroadcastTermOffering{ID: o.id, Label: label, Enrolled: o.enrolled})
	}
	return out, nil
}

// BroadcastAudience مخاطبان پیام همگانی.
type BroadcastAudience struct {
	Role         string `json:"role"` // student | staff | both
	FacultyID    *int64 `json:"facultyId"`
	DepartmentID *int64 `json:"departmentId"`
	MajorID      *int64 `json:"majorId"`
	EntryYear    *int64 `json:"entryYear"`
	TermID       *int64 `json:"termId"`
	OfferingID   *int64 `json:"offeringId"`
	ActiveOnly   bool   `json:"activeOnly"`
}

// PreviewBroadcastCount پورت previewBroadcastCount — شمارش مخاطبان (سقف ۵۰۰۰).
func (s *Service) PreviewBroadcastCount(ctx context.Context, user *session.User, uniCookie string, a BroadcastAudience) (int, bool, error) {
	ids, capped, err := s.lpAudienceUserIDs(ctx, s.UniversityID(ctx, user, uniCookie), a)
	if err != nil {
		return 0, false, err
	}
	return len(ids), capped, nil
}

// lpAudienceUserIDs پورت audienceUserIds — حداکثر ۵۰۰۰ نفر در هر ارسال.
func (s *Service) lpAudienceUserIDs(ctx context.Context, uniID *int64, a BroadcastAudience) ([]int64, bool, error) {
	const cap = 5000
	out := map[int64]bool{}
	order := []int64{}
	add := func(id int64) {
		if len(order) >= cap {
			return
		}
		if !out[id] {
			out[id] = true
			order = append(order, id)
		}
	}

	activeStuCond := ""
	if a.ActiveOnly {
		activeStuCond = ` and st.status = 'ACTIVE'`
	}

	if a.Role == "student" || a.Role == "both" {
		if a.OfferingID != nil && *a.OfferingID > 0 {
			rows, err := s.DB.Pool.Query(ctx, `
				select u.id from enrollments e
				  join students st on st.id = e."studentId"
				  join users u on u.id = st."userId"
				 where e."offeringId" = $1 and u."isActive" = 1`+activeStuCond+` limit 5000`, *a.OfferingID)
			if err != nil {
				return nil, false, err
			}
			for rows.Next() {
				var id int64
				if rows.Scan(&id) == nil {
					add(id)
				}
			}
			rows.Close()
		} else {
			conds := []string{`u."isActive" = 1`}
			args := []any{}
			idx := 1
			if uniID != nil {
				conds = append(conds, fmt.Sprintf(`st."universityId" = $%d`, idx))
				args = append(args, *uniID)
				idx++
			}
			if a.ActiveOnly {
				conds = append(conds, `st.status = 'ACTIVE'`)
			}
			if a.EntryYear != nil && *a.EntryYear > 0 {
				conds = append(conds, fmt.Sprintf(`st."entryYear" = $%d`, idx))
				args = append(args, *a.EntryYear)
				idx++
			}
			// سلسله‌مراتب: رشتهٔ دقیق‌تر، سطح بالاتر را بی‌اثر می‌کند.
			switch {
			case a.MajorID != nil && *a.MajorID > 0:
				conds = append(conds, fmt.Sprintf(`st."majorId" = $%d`, idx))
				args = append(args, *a.MajorID)
				idx++
			case a.DepartmentID != nil && *a.DepartmentID > 0:
				conds = append(conds, fmt.Sprintf(`st."majorId" in (select id from majors where "departmentId" = $%d limit 5000)`, idx))
				args = append(args, *a.DepartmentID)
				idx++
			case a.FacultyID != nil && *a.FacultyID > 0:
				conds = append(conds, fmt.Sprintf(`st."majorId" in (select id from majors where "facultyId" = $%d limit 5000)`, idx))
				args = append(args, *a.FacultyID)
				idx++
			}
			rows, err := s.DB.Pool.Query(ctx, `
				select u.id from students st join users u on u.id = st."userId"
				 where `+strings.Join(conds, " and ")+` limit 5000`, args...)
			if err != nil {
				return nil, false, err
			}
			for rows.Next() {
				var id int64
				if rows.Scan(&id) == nil {
					add(id)
				}
			}
			rows.Close()
		}
	}

	if (a.Role == "staff" || a.Role == "both") && len(order) < cap {
		if a.OfferingID != nil && *a.OfferingID > 0 {
			sids := []int64{}
			seen := map[int64]bool{}
			if rows, err := s.DB.Pool.Query(ctx, `
				select "staffId" from offering_professors where "offeringId" = $1 limit 20`, *a.OfferingID); err == nil {
				for rows.Next() {
					var sid int64
					if rows.Scan(&sid) == nil && !seen[sid] {
						seen[sid] = true
						sids = append(sids, sid)
					}
				}
				rows.Close()
			}
			var owner *int64
			if err := s.DB.Pool.QueryRow(ctx, `
				select "professorId" from course_offerings where id = $1`, *a.OfferingID).Scan(&owner); err == nil && owner != nil && !seen[*owner] {
				sids = append(sids, *owner)
			}
			activeStaffCond := ""
			if a.ActiveOnly {
				activeStaffCond = ` and st."isActive" = 1`
			}
			if len(sids) > 0 {
				rows, err := s.DB.Pool.Query(ctx, `
					select u.id from staff st join users u on u.id = st."userId"
					 where st.id = any($1::int[]) and u."isActive" = 1`+activeStaffCond+` limit 100`, sids)
				if err != nil {
					return nil, false, err
				}
				for rows.Next() {
					var id int64
					if rows.Scan(&id) == nil {
						add(id)
					}
				}
				rows.Close()
			}
		} else {
			conds := []string{`u."isActive" = 1`}
			args := []any{}
			idx := 1
			if uniID != nil {
				conds = append(conds, fmt.Sprintf(`st."universityId" = $%d`, idx))
				args = append(args, *uniID)
				idx++
			}
			if a.ActiveOnly {
				conds = append(conds, `st."isActive" = 1`)
			}
			// گروه دقیق‌تر از دانشکده است؛ اگر هر دو انتخاب شده باشند فقط گروه اعمال می‌شود.
			if a.DepartmentID != nil && *a.DepartmentID > 0 {
				conds = append(conds, fmt.Sprintf(`st."departmentId" = $%d`, idx))
				args = append(args, *a.DepartmentID)
				idx++
			} else if a.FacultyID != nil && *a.FacultyID > 0 {
				conds = append(conds, fmt.Sprintf(`st."facultyId" = $%d`, idx))
				args = append(args, *a.FacultyID)
				idx++
			}
			rows, err := s.DB.Pool.Query(ctx, `
				select u.id from staff st join users u on u.id = st."userId"
				 where `+strings.Join(conds, " and ")+` limit 5000`, args...)
			if err != nil {
				return nil, false, err
			}
			for rows.Next() {
				var id int64
				if rows.Scan(&id) == nil {
					add(id)
				}
			}
			rows.Close()
		}
	}
	return order, len(order) >= cap, nil
}

// BroadcastChannelStat آمار یک کانال.
type BroadcastChannelStat struct {
	Channel string `json:"channel"`
	Sent    int    `json:"sent"`
	Skipped int    `json:"skipped"`
	Failed  int    `json:"failed"`
}

// BroadcastSendReport گزارش ارسال همگانی.
type BroadcastSendReport struct {
	Total          int                    `json:"total"`
	Inbox          int                    `json:"inbox"`
	FailedRequests int                    `json:"failedRequests"`
	Channels       []BroadcastChannelStat `json:"channels"`
}

// SendBroadcast پورت sendBroadcast — بسته‌های ۱۰تایی موازی، کد رهگیری با فرستنده.
func (s *Service) SendBroadcast(ctx context.Context, user *session.User, uniCookie string, a BroadcastAudience, channels []string, text string) (*BroadcastSendReport, error) {
	body := strings.TrimSpace(text)
	if len([]rune(body)) < 3 {
		return nil, errors.New("متن پیام خیلی کوتاه است.")
	}
	if len([]rune(body)) > 2000 {
		return nil, errors.New("متن پیام حداکثر ۲۰۰۰ نویسه.")
	}
	ch := []string{}
	seenCh := map[string]bool{}
	for _, c := range channels {
		c = strings.ToUpper(strings.TrimSpace(c))
		if lpValidChannels[c] && !seenCh[c] {
			seenCh[c] = true
			ch = append(ch, c)
		}
	}
	if len(ch) == 0 {
		return nil, errors.New("حداقل یک کانال انتخاب کنید.")
	}

	ids, _, err := s.lpAudienceUserIDs(ctx, s.UniversityID(ctx, user, uniCookie), a)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, errors.New("هیچ مخاطبی با این فیلترها پیدا نشد.")
	}

	// کد رهگیری شامل فرستنده است تا در تاریخچه معلوم باشد کی فرستاده.
	eventCode := fmt.Sprintf("BROADCAST_%d_%d", user.ID, time.Now().UnixMilli())
	stats := map[string]*BroadcastChannelStat{}
	report := &BroadcastSendReport{Total: len(ids), Channels: []BroadcastChannelStat{}}

	for i := 0; i < len(ids); i += 10 {
		end := i + 10
		if end > len(ids) {
			end = len(ids)
		}
		chunk := ids[i:end]
		type resT struct {
			dels []lpNotify
			ok   bool
		}
		results := make([]resT, len(chunk))
		done := make(chan struct{})
		for j, id := range chunk {
			go func(j int, id int64) {
				dels, err := s.lpNotifyMultichannel(ctx, id, eventCode, body, ch)
				results[j] = resT{dels: dels, ok: err == nil}
				done <- struct{}{}
			}(j, id)
		}
		for range chunk {
			<-done
		}
		close(done)
		for _, r := range results {
			if !r.ok {
				report.FailedRequests++
				continue
			}
			report.Inbox++
			for _, d := range r.dels {
				lpStatsAdd(stats, d.Channel, d.Status)
			}
		}
	}
	report.Channels = lpStatsList(stats)
	return report, nil
}

// BroadcastHistoryRecord یک رکورد تاریخچه.
type BroadcastHistoryRecord struct {
	EventCode string                 `json:"eventCode"`
	Sender    string                 `json:"sender"`
	SentAt    *string                `json:"sentAt"`
	Body      string                 `json:"body"`
	Total     int                    `json:"total"`
	Inbox     int                    `json:"inbox"`
	Channels  []BroadcastChannelStat `json:"channels"`
}

// lpParseBroadcastSender قالب BROADCAST_<adminId>_<ts>؛ قدیمی‌ها nil.
func lpParseBroadcastSender(eventCode string) *int64 {
	parts := strings.Split(eventCode, "_")
	if len(parts) >= 3 && parts[0] == "BROADCAST" {
		var n int64
		if _, err := fmt.Sscanf(parts[1], "%d", &n); err == nil && n > 0 {
			return &n
		}
	}
	return nil
}

// ListBroadcastHistory پورت listBroadcastHistory — جدیدترین اول.
func (s *Service) ListBroadcastHistory(ctx context.Context, user *session.User, uniCookie string, limit int) ([]BroadcastHistoryRecord, error) {
	if limit < 1 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	out := []BroadcastHistoryRecord{}

	codes := []string{}
	crows, err := s.DB.Pool.Query(ctx, `
		select "eventCode" as code, max(id) as m
		  from notification_deliveries
		 where "eventCode" like 'BROADCAST%' or "eventCode" like 'PROFMSG%'
		 group by "eventCode"
		 order by m desc limit $1`, limit)
	if err != nil {
		return out, nil
	}
	for crows.Next() {
		var code string
		var m int64
		if crows.Scan(&code, &m) == nil {
			codes = append(codes, code)
		}
	}
	crows.Close()
	if len(codes) == 0 {
		return out, nil
	}

	inboxBy := map[string]int{}
	if irows, err := s.DB.Pool.Query(ctx, `
		select "eventCode", count(*) from notifications
		 where "eventCode" = any($1::text[]) group by 1`, codes); err == nil {
		for irows.Next() {
			var code string
			var n int
			if irows.Scan(&code, &n) == nil {
				inboxBy[code] = n
			}
		}
		irows.Close()
	}

	statsBy := map[string]map[string]*BroadcastChannelStat{}
	totals := map[string]map[int64]bool{}
	for _, c := range codes {
		statsBy[c] = map[string]*BroadcastChannelStat{}
		totals[c] = map[int64]bool{}
	}
	if drows, err := s.DB.Pool.Query(ctx, `
		select "eventCode", channel, status, count(*) from notification_deliveries
		 where "eventCode" = any($1::text[]) group by 1,2,3`, codes); err == nil {
		for drows.Next() {
			var code, channel, status string
			var n int
			if drows.Scan(&code, &channel, &status, &n) == nil && statsBy[code] != nil {
				for i := 0; i < n; i++ {
					lpStatsAdd(statsBy[code], channel, status)
				}
			}
		}
		drows.Close()
	}
	if urows, err := s.DB.Pool.Query(ctx, `
		select "eventCode", "userId" from notification_deliveries
		 where "eventCode" = any($1::text[]) limit 200000`, codes); err == nil {
		for urows.Next() {
			var code string
			var uid int64
			if urows.Scan(&code, &uid) == nil && totals[code] != nil {
				totals[code][uid] = true
			}
		}
		urows.Close()
	}

	metaAt := map[string]*string{}
	metaBody := map[string]string{}
	if mrows, err := s.DB.Pool.Query(ctx, `
		select "eventCode" as code, min("createdAt")::text as at,
		       (array_agg(body order by id limit 1))[1] as sample
		  from notification_deliveries
		 where "eventCode" = any($1::text[])
		 group by "eventCode"`, codes); err == nil {
		for mrows.Next() {
			var code string
			var at *string
			var sample *string
			if mrows.Scan(&code, &at, &sample) == nil {
				metaAt[code] = at
				if sample != nil {
					metaBody[code] = truncStr(*sample, 300)
				}
			}
		}
		mrows.Close()
	}

	senderNames := map[int64]string{}
	ids := []int64{}
	seen := map[int64]bool{}
	for _, c := range codes {
		if sid := lpParseBroadcastSender(c); sid != nil && !seen[*sid] {
			seen[*sid] = true
			ids = append(ids, *sid)
		}
	}
	if len(ids) > 0 {
		if nrows, err := s.DB.Pool.Query(ctx, `
			select id, coalesce("firstName",''), coalesce("lastName",'') from users
			 where id = any($1::int[])`, ids); err == nil {
			for nrows.Next() {
				var id int64
				var fn, ln string
				if nrows.Scan(&id, &fn, &ln) == nil {
					name := strings.TrimSpace(fn + " " + ln)
					if name == "" {
						name = fmt.Sprintf("کاربر %d", id)
					}
					senderNames[id] = name
				}
			}
			nrows.Close()
		}
	}

	for _, code := range codes {
		sender := "—"
		if sid := lpParseBroadcastSender(code); sid != nil {
			if name, ok := senderNames[*sid]; ok {
				sender = name
			} else {
				sender = fmt.Sprintf("کاربر %d", *sid)
			}
		}
		total := len(totals[code])
		channels := []BroadcastChannelStat{}
		for _, st := range lpStatsList(statsBy[code]) {
			channels = append(channels, st)
		}
		out = append(out, BroadcastHistoryRecord{
			EventCode: code,
			Sender:    sender,
			SentAt:    metaAt[code],
			Body:      metaBody[code],
			Total:     total,
			Inbox:     inboxBy[code],
			Channels:  channels,
		})
	}
	return out, nil
}

// ─────────────────────────── ۲) تأیید bypass مدیر گروه ───────────────────────────

// BypassRequestJSON ردیف کارتابل bypass.
type BypassRequestJSON struct {
	ID                int64   `json:"id"`
	StudentID         int64   `json:"studentId"`
	OfferingID        int64   `json:"offeringId"`
	Kind              string  `json:"kind"`
	Status            string  `json:"status"`
	ReasonCode        *string `json:"reasonCode"`
	ReasonText        *string `json:"reasonText"`
	ManagerDeadlineAt *string `json:"managerDeadlineAt"`
	ExpertDeadlineAt  *string `json:"expertDeadlineAt"`
	DecidedRole       *string `json:"decidedRole"`
	DecidedAt         *string `json:"decidedAt"`
	CreatedAt         *string `json:"createdAt"`
	CourseTitle       string  `json:"courseTitle"`
	CourseCode        string  `json:"courseCode"`
	Units             float64 `json:"units"`
	StudentName       string  `json:"studentName"`
	StudentCode       string  `json:"studentCode"`
	MajorName         *string `json:"majorName"`
}

var lpBypassKindLabels = map[string]string{
	"PREREQ": "پیش‌نیاز", "EXAM_CONFLICT": "تداخل امتحانی",
}

var lpBypassReasonLabels = map[string]string{
	"LOW_GPA_PREV_TERM":          "معدل پایین ترم قبل",
	"GROUP_COUNCIL_DISAGREE":     "مخالفت شورای گروه",
	"UNRESOLVABLE_EXAM_CONFLICT": "تداخل امتحانی غیرقابل رفع",
	"OTHER":                      "سایر (توضیح تکمیلی)",
	"NO_RESPONSE":                "بدون پاسخ در مهلت تعیین‌شده",
}

const lpBypassSelect = `
	select r.id, r."studentId", r."offeringId", r.kind, r.status, r."reasonCode", r."reasonText",
	       r."managerDeadlineAt"::text, r."expertDeadlineAt"::text, r."decidedRole", r."decidedAt"::text,
	       r."createdAt"::text, c.title, c.code, coalesce(c.units,0)::float8,
	       coalesce(u."firstName" || ' ' || u."lastName", st."studentCode"),
	       st."studentCode", m.name
	  from enroll_bypass_requests r
	  join course_offerings o on o.id = r."offeringId"
	  join courses c on c.id = o."courseId"
	  join students st on st.id = r."studentId"
	  join users u on u.id = st."userId"
	  left join majors m on m.id = st."majorId"`

func lpScanBypassRow(rows pgx.Rows) (BypassRequestJSON, error) {
	var r BypassRequestJSON
	err := rows.Scan(&r.ID, &r.StudentID, &r.OfferingID, &r.Kind, &r.Status, &r.ReasonCode, &r.ReasonText,
		&r.ManagerDeadlineAt, &r.ExpertDeadlineAt, &r.DecidedRole, &r.DecidedAt, &r.CreatedAt,
		&r.CourseTitle, &r.CourseCode, &r.Units, &r.StudentName, &r.StudentCode, &r.MajorName)
	return r, err
}

// BypassBoardData دادهٔ صفحهٔ bypass بر پایهٔ نقش‌ها.
type BypassBoardData struct {
	ExpertRows   []BypassRequestJSON `json:"expertRows"`
	ViceRows     []BypassRequestJSON `json:"viceRows"`
	IsVice       bool                `json:"isVice"`
	IsExpert     bool                `json:"isExpert"`
	IsAdmin      bool                `json:"isAdmin"`
	CurrentTerms []BypassTermRow     `json:"currentTerms"`
}

// BypassTermRow نیمسال جاری با مهلت‌های تصمیم‌گیری.
type BypassTermRow struct {
	ID                  int64  `json:"id"`
	Title               string `json:"title"`
	TermCode            string `json:"termCode"`
	BypassManagerHours  *int   `json:"bypassManagerHours"`
	BypassExpertHours   *int   `json:"bypassExpertHours"`
	BypassReminderHours *int   `json:"bypassReminderHours"`
}

// BypassBoard پورت bypassInboxForExpert + bypassOverviewForVice + ترم جاری.
func (s *Service) BypassBoard(ctx context.Context, user *session.User) (*BypassBoardData, error) {
	resp := &BypassBoardData{ExpertRows: []BypassRequestJSON{}, ViceRows: []BypassRequestJSON{}, CurrentTerms: []BypassTermRow{}}
	for _, r := range user.Roles {
		switch r {
		case "ADMIN":
			resp.IsAdmin, resp.IsVice = true, true
		case "VICE_EDU":
			resp.IsVice = true
		case "EDU_EXPERT":
			resp.IsExpert = true
		}
	}

	if resp.IsExpert {
		rows, err := s.DB.Pool.Query(ctx, lpBypassSelect+`
			where r.status = 'ESCALATED_EXPERT' and (
			      st."majorId" in (select "scopeId" from expert_scopes where "userId" = $1 and "scopeType" = 'MAJOR' and "scopeId" is not null)
			   or m."departmentId" in (select "scopeId" from expert_scopes where "userId" = $1 and "scopeType" = 'DEPARTMENT' and "scopeId" is not null)
			   or m."facultyId" in (select "scopeId" from expert_scopes where "userId" = $1 and "scopeType" = 'FACULTY' and "scopeId" is not null)
			   or (not exists (select 1 from expert_scopes where "userId" = $1 and "scopeType" in ('MAJOR','DEPARTMENT','FACULTY'))
			       and exists (select 1 from expert_scopes where "userId" = $1 and "scopeType" = 'UNIVERSITY')))
			order by r.id desc limit 500`, user.ID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				if r, err := lpScanBypassRow(rows); err == nil {
					resp.ExpertRows = append(resp.ExpertRows, r)
				}
			}
		}
	}

	if resp.IsVice {
		rows, err := s.DB.Pool.Query(ctx, lpBypassSelect+`
			where r.status in ('PENDING_MANAGER','ESCALATED_EXPERT','AUTO_REJECTED','REJECTED')
			order by r."createdAt" limit 500`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				if r, err := lpScanBypassRow(rows); err == nil {
					resp.ViceRows = append(resp.ViceRows, r)
				}
			}
		}
	}

	if resp.IsAdmin {
		if rows, err := s.DB.Pool.Query(ctx, `
			select id, coalesce(title, "termCode"), coalesce("termCode",''),
			       "bypassManagerHours", "bypassExpertHours", "bypassReminderHours"
			  from academic_terms where "isCurrent" = 1 order by id desc limit 10`); err == nil {
			defer rows.Close()
			for rows.Next() {
				var t BypassTermRow
				if rows.Scan(&t.ID, &t.Title, &t.TermCode, &t.BypassManagerHours, &t.BypassExpertHours, &t.BypassReminderHours) == nil {
					resp.CurrentTerms = append(resp.CurrentTerms, t)
				}
			}
		}
	}
	return resp, nil
}

// lpBypassGuard نقشِ مجازِ تصمیم‌گیرنده — معاون/مدیر روی همه؛ کارشناس فقط صندوقش.
func (s *Service) lpBypassGuard(ctx context.Context, user *session.User, requestID int64) (int64, string, error) {
	isVice := false
	isExpert := false
	for _, r := range user.Roles {
		if r == "ADMIN" || r == "VICE_EDU" {
			isVice = true
		}
		if r == "EDU_EXPERT" {
			isExpert = true
		}
	}
	if isVice {
		return user.ID, "VICE", nil
	}
	if !isExpert {
		return 0, "", errors.New("دسترسی ندارید.")
	}
	var n int
	err := s.DB.Pool.QueryRow(ctx, `
		select count(*) from enroll_bypass_requests r
		  join course_offerings o on o.id = r."offeringId"
		  join courses c on c.id = o."courseId"
		  join students st on st.id = r."studentId"
		  left join majors m on m.id = st."majorId"
		 where r.id = $2 and r.status = 'ESCALATED_EXPERT' and (
		       st."majorId" in (select "scopeId" from expert_scopes where "userId" = $1 and "scopeType" = 'MAJOR' and "scopeId" is not null)
		    or m."departmentId" in (select "scopeId" from expert_scopes where "userId" = $1 and "scopeType" = 'DEPARTMENT' and "scopeId" is not null)
		    or m."facultyId" in (select "scopeId" from expert_scopes where "userId" = $1 and "scopeType" = 'FACULTY' and "scopeId" is not null)
		    or (not exists (select 1 from expert_scopes where "userId" = $1 and "scopeType" in ('MAJOR','DEPARTMENT','FACULTY'))
		        and exists (select 1 from expert_scopes where "userId" = $1 and "scopeType" = 'UNIVERSITY')))
		 limit 1`, user.ID, requestID).Scan(&n)
	if err != nil || n == 0 {
		return 0, "", errors.New("این درخواست در دامنهٔ رشتهٔ شما نیست یا هنوز به شما ارجاع نشده است.")
	}
	return user.ID, "EXPERT", nil
}

// lpBypassLoad درخواست باز از جدول.
type lpBypassReq struct {
	ID           int64
	StudentID    int64
	OfferingID   int64
	TermID       int64
	Kind         string
	Status       string
	SeatReserved int
}

func (s *Service) lpBypassLoad(ctx context.Context, requestID int64) (*lpBypassReq, error) {
	var r lpBypassReq
	err := s.DB.Pool.QueryRow(ctx, `
		select id, "studentId", "offeringId", "termId", kind, status, coalesce("seatReserved",0)
		  from enroll_bypass_requests where id = $1`, requestID).
		Scan(&r.ID, &r.StudentID, &r.OfferingID, &r.TermID, &r.Kind, &r.Status, &r.SeatReserved)
	if err != nil {
		return nil, errors.New("درخواست یافت نشد.")
	}
	return &r, nil
}

func (s *Service) lpBypassNotifyUser(ctx context.Context, userID int64, eventCode, text string) {
	_, _ = s.lpNotifyMultichannel(ctx, userID, eventCode, text, nil)
}

func (s *Service) lpBypassStudentUserID(ctx context.Context, studentID int64) *int64 {
	var uid int64
	if err := s.DB.Pool.QueryRow(ctx, `select "userId" from students where id = $1`, studentID).Scan(&uid); err != nil || uid <= 0 {
		return nil
	}
	return &uid
}

func (s *Service) lpBypassCourseTitle(ctx context.Context, offeringID int64) string {
	var title string
	if err := s.DB.Pool.QueryRow(ctx, `
		select c.title from course_offerings o join courses c on c.id = o."courseId" where o.id = $1`,
		offeringID).Scan(&title); err != nil {
		return ""
	}
	return title
}

// lpBypassReleaseSeat آزادسازی صندلی رزروشده (هرگز منفی نمی‌شود).
func (s *Service) lpBypassReleaseSeat(ctx context.Context, offeringID int64) {
	_, _ = s.DB.Pool.Exec(ctx, `update course_offerings set "enrolledCount" = greatest("enrolledCount" - 1, 0) where id = $1`, offeringID)
}

// lpBypassManagers شناسهٔ کاربری مدیر گروهِ درس (سرگروهی گروه آموزشی).
func (s *Service) lpBypassManagers(ctx context.Context, courseID int64) []int64 {
	out := []int64{}
	var headStaffID *int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select d."headStaffId" from courses c join departments d on d.id = c."departmentId"
		 where c.id = $1`, courseID).Scan(&headStaffID); err != nil || headStaffID == nil {
		return out
	}
	var uid int64
	if err := s.DB.Pool.QueryRow(ctx, `select "userId" from staff where id = $1`, *headStaffID).Scan(&uid); err == nil && uid > 0 {
		out = append(out, uid)
	}
	return out
}

// lpBypassExpertsForMajor کارشناسان آموزشِ مسئول رشته (از expert_scopes).
func (s *Service) lpBypassExpertsForMajor(ctx context.Context, majorID *int64) []int64 {
	out := []int64{}
	seen := map[int64]bool{}
	if majorID == nil || *majorID <= 0 {
		return out
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select distinct es."userId" from expert_scopes es join majors m on m.id = $1
		 where (es."scopeType" = 'MAJOR' and es."scopeId" = $1)
		    or (m."departmentId" is not null and es."scopeType" = 'DEPARTMENT' and es."scopeId" = m."departmentId")
		    or (m."facultyId" is not null and es."scopeType" = 'FACULTY' and es."scopeId" = m."facultyId")`, *majorID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var uid int64
		if rows.Scan(&uid) == nil && !seen[uid] {
			seen[uid] = true
			out = append(out, uid)
		}
	}
	return out
}

func (s *Service) lpBypassVices(ctx context.Context) []int64 {
	out := []int64{}
	rows, err := s.DB.Pool.Query(ctx, `
		select distinct ur."userId" from user_roles ur
		  join roles r on r.id = ur."roleId" where r.code = 'VICE_EDU'`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var uid int64
		if rows.Scan(&uid) == nil {
			out = append(out, uid)
		}
	}
	return out
}

func lpFaDateTime(t time.Time) string {
	return t.Format("2006-01-02 15:04")
}

// BypassApprove پورت approveBypassRequest — ثبت خودکار درس + پیام به دانشجو.
func (s *Service) BypassApprove(ctx context.Context, user *session.User, requestID int64) error {
	actorID, actorRole, err := s.lpBypassGuard(ctx, user, requestID)
	if err != nil {
		return err
	}
	req, err := s.lpBypassLoad(ctx, requestID)
	if err != nil {
		return err
	}
	if req.Status != "PENDING_MANAGER" && req.Status != "ESCALATED_EXPERT" {
		return errors.New("این درخواست قبلاً بسته شده است.")
	}

	kindLabel := lpBypassKindLabels[req.Kind]
	if kindLabel == "" {
		kindLabel = "محدودیت"
	}
	overrideReason := fmt.Sprintf("تأیید درخواست بدون رعایت %s", kindLabel)

	var uniID *int64
	_ = s.DB.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, req.StudentID).Scan(&uniID)

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		insert into enrollments ("studentId","offeringId",status,"universityId","enrollOverride","enrollOverrideReason","enrolledByUserId")
		values ($1,$2,'REGISTERED',$3,1,$4,$5)
		on conflict ("studentId","offeringId") do update set
		  status = 'REGISTERED', "enrollOverride" = 1,
		  "enrollOverrideReason" = excluded."enrollOverrideReason",
		  "enrolledByUserId" = excluded."enrolledByUserId"`,
		req.StudentID, req.OfferingID, uniID, overrideReason, actorID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from cart_items where "studentId" = $1 and "offeringId" = $2`,
		req.StudentID, req.OfferingID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update enroll_bypass_requests set status = 'APPROVED', "decidedRole" = $2,
		       "decidedByUserId" = $3, "decidedAt" = now(), "seatReserved" = 0, "updatedAt" = now()
		 where id = $1`, requestID, actorRole, actorID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	if uid := s.lpBypassStudentUserID(ctx, req.StudentID); uid != nil {
		title := s.lpBypassCourseTitle(ctx, req.OfferingID)
		s.lpBypassNotifyUser(ctx, *uid, "BYPASS_APPROVED",
			fmt.Sprintf("درخواست ثبت درس «%s» بدون رعایت %s تأیید شد و درس به‌صورت خودکار در انتخاب واحد شما ثبت گردید.", title, kindLabel))
	}
	return nil
}

// BypassReject پورت rejectBypassRequest — دلیل الزامی، صندلی آزاد، اطلاع دانشجو.
func (s *Service) BypassReject(ctx context.Context, user *session.User, requestID int64, reasonCode, reasonText string) error {
	if reasonCode == "" {
		return errors.New("دلیل رد الزامی است.")
	}
	valid := map[string]bool{"LOW_GPA_PREV_TERM": true, "GROUP_COUNCIL_DISAGREE": true, "UNRESOLVABLE_EXAM_CONFLICT": true, "OTHER": true}
	if !valid[reasonCode] {
		return errors.New("دلیل رد نامعتبر است.")
	}
	if reasonCode == "OTHER" && strings.TrimSpace(reasonText) == "" {
		return errors.New("برای «سایر» توضیح تکمیلی الزامی است.")
	}
	actorID, actorRole, err := s.lpBypassGuard(ctx, user, requestID)
	if err != nil {
		return err
	}
	req, err := s.lpBypassLoad(ctx, requestID)
	if err != nil {
		return err
	}
	if req.Status != "PENDING_MANAGER" && req.Status != "ESCALATED_EXPERT" {
		return errors.New("این درخواست قبلاً بسته شده است.")
	}

	var textPtr *string
	if strings.TrimSpace(reasonText) != "" {
		t := strings.TrimSpace(reasonText)
		textPtr = &t
	}
	if _, err := s.DB.Pool.Exec(ctx, `
		update enroll_bypass_requests set status = 'REJECTED', "reasonCode" = $2, "reasonText" = $3,
		       "decidedRole" = $4, "decidedByUserId" = $5, "decidedAt" = now(), "seatReserved" = 0, "updatedAt" = now()
		 where id = $1`, requestID, reasonCode, textPtr, actorRole, actorID); err != nil {
		return err
	}
	if req.SeatReserved != 0 {
		s.lpBypassReleaseSeat(ctx, req.OfferingID)
	}

	if uid := s.lpBypassStudentUserID(ctx, req.StudentID); uid != nil {
		kindLabel := lpBypassKindLabels[req.Kind]
		if kindLabel == "" {
			kindLabel = "محدودیت"
		}
		reason := lpBypassReasonLabels[reasonCode]
		if reason == "" {
			reason = reasonCode
		}
		extra := strings.TrimSpace(reasonText)
		msg := fmt.Sprintf("درخواست ثبت درس «%s» بدون رعایت %s رد شد. دلیل: %s.", s.lpBypassCourseTitle(ctx, req.OfferingID), kindLabel, reason)
		if extra != "" {
			msg += " " + extra
		}
		msg += " این درس طبق قوانین آموزشی برایتان ثبت نشد."
		s.lpBypassNotifyUser(ctx, *uid, "BYPASS_REJECTED", msg)
	}
	return nil
}

// lpBypassHoursOf مقدار مهلت با fallback (پورت hoursOf).
func lpBypassHoursOf(v *int, fallback int) int {
	if v != nil && *v > 0 && *v <= 720 {
		return *v
	}
	return fallback
}

// BypassReturn پورت returnBypassRequest — بازگرداندن توسط معاون آموزش.
func (s *Service) BypassReturn(ctx context.Context, user *session.User, requestID int64, target string) error {
	if target != "MANAGER" && target != "EXPERT" {
		return errors.New("مقصد بازگشت نامعتبر است.")
	}
	actorID, actorRole, err := s.lpBypassGuard(ctx, user, requestID)
	if err != nil {
		return err
	}
	if actorRole != "VICE" {
		return errors.New("بازگرداندن درخواست فقط توسط معاون آموزش انجام می‌شود.")
	}
	_ = actorID
	req, err := s.lpBypassLoad(ctx, requestID)
	if err != nil {
		return err
	}
	if req.Status != "PENDING_MANAGER" && req.Status != "ESCALATED_EXPERT" {
		return errors.New("این درخواست بسته شده و قابل بازگشت نیست.")
	}

	var managerHours, expertHours *int
	_ = s.DB.Pool.QueryRow(ctx, `select "bypassManagerHours", "bypassExpertHours" from academic_terms where id = $1`, req.TermID).
		Scan(&managerHours, &expertHours)

	var courseID int64
	var courseTitle string
	if err := s.DB.Pool.QueryRow(ctx, `
		select o."courseId", c.title from course_offerings o join courses c on c.id = o."courseId" where o.id = $1`,
		req.OfferingID).Scan(&courseID, &courseTitle); err != nil {
		return errors.New("درخواست یافت نشد.")
	}

	stuName := "دانشجو"
	var majorID *int64
	var stuUID *int64
	{
		var fn, ln *string
		err := s.DB.Pool.QueryRow(ctx, `
			select u."firstName", u."lastName", st."majorId", st."userId"
			  from students st join users u on u.id = st."userId" where st.id = $1`, req.StudentID).
			Scan(&fn, &ln, &majorID, &stuUID)
		if err == nil {
			name := strings.TrimSpace(fmt.Sprintf("%s %s", lpStr(fn), lpStr(ln)))
			if name != "" {
				stuName = name
			}
		}
	}

	kindLabel := lpBypassKindLabels[req.Kind]
	if kindLabel == "" {
		kindLabel = "محدودیت"
	}
	now := time.Now()

	if target == "MANAGER" {
		deadline := now.Add(time.Duration(lpBypassHoursOf(managerHours, 48)) * time.Hour)
		if _, err := s.DB.Pool.Exec(ctx, `
			update enroll_bypass_requests set status = 'PENDING_MANAGER', "managerDeadlineAt" = $2,
			       "expertDeadlineAt" = null, "escalatedAt" = null, "managerReminderAt" = null,
			       "expertReminderAt" = null, "studentWarnedAt" = null, "decidedRole" = null,
			       "decidedByUserId" = null, "decidedAt" = null, "updatedAt" = now()
			 where id = $1`, requestID, deadline); err != nil {
			return err
		}
		for _, uid := range s.lpBypassManagers(ctx, courseID) {
			s.lpBypassNotifyUser(ctx, uid, "BYPASS_SUBMITTED",
				fmt.Sprintf("درخواست %s برای ثبت درس «%s» بدون رعایت %s از سوی معاون آموزش برای بررسی مجدد به شما بازگردانده شد. مهلت بررسی: %s.",
					stuName, courseTitle, kindLabel, lpFaDateTime(deadline)))
		}
		return nil
	}

	deadline := now.Add(time.Duration(lpBypassHoursOf(expertHours, 12)) * time.Hour)
	if _, err := s.DB.Pool.Exec(ctx, `
		update enroll_bypass_requests set status = 'ESCALATED_EXPERT', "expertDeadlineAt" = $2,
		       "escalatedAt" = now(), "managerReminderAt" = null, "expertReminderAt" = null,
		       "studentWarnedAt" = null, "decidedRole" = null, "decidedByUserId" = null,
		       "decidedAt" = null, "updatedAt" = now()
		 where id = $1`, requestID, deadline); err != nil {
		return err
	}
	for _, uid := range s.lpBypassExpertsForMajor(ctx, majorID) {
		s.lpBypassNotifyUser(ctx, uid, "BYPASS_ESCALATED_TO_EXPERT",
			fmt.Sprintf("درخواست %s برای ثبت درس «%s» بدون رعایت %s از سوی معاون آموزش با دستور بررسی به شما ارجاع شد. مهلت بررسی: %s.",
				stuName, courseTitle, kindLabel, lpFaDateTime(deadline)))
	}
	_ = stuUID
	return nil
}

func lpStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// BypassSaveSettings پورت saveBypassSettingsAction — مهلت‌های تصمیم‌گیری نیمسال جاری.
func (s *Service) BypassSaveSettings(ctx context.Context, user *session.User, termID int64, managerHours, expertHours, reminderHours int) error {
	isAdmin := false
	for _, r := range user.Roles {
		if r == "ADMIN" {
			isAdmin = true
		}
	}
	if !isAdmin {
		return errors.New("دسترسی ندارید.")
	}
	if termID <= 0 {
		return errors.New("ترم نامعتبر است.")
	}
	clean := func(n, fallback int) int {
		if n > 0 && n <= 720 {
			return n
		}
		return fallback
	}
	_, err := s.DB.Pool.Exec(ctx, `
		update academic_terms set "bypassManagerHours" = $2, "bypassExpertHours" = $3, "bypassReminderHours" = $4
		 where id = $1`,
		termID, clean(managerHours, 48), clean(expertHours, 12), clean(reminderHours, 10))
	return err
}

// ─────────────────────────── ۳) مدیریت جلسات کلاس ───────────────────────────

// ClassSessionOffering ردیف درس با شمار جلسات.
type ClassSessionOffering struct {
	ID            int64   `json:"id"`
	Code          string  `json:"code"`
	Title         string  `json:"title"`
	GroupNumber   int     `json:"groupNumber"`
	ProfessorName *string `json:"professorName"`
	StaffCode     *string `json:"staffCode"`
	SessionCount  int     `json:"sessionCount"`
	HolidayCount  int     `json:"holidayCount"`
}

// ClassSessionItem یک جلسهٔ کلاس.
type ClassSessionItem struct {
	ID                int64   `json:"id"`
	SessionNo         *int    `json:"sessionNo"`
	SessionDate       string  `json:"sessionDate"`
	StartTime         string  `json:"startTime"`
	EndTime           string  `json:"endTime"`
	Status            string  `json:"status"`
	IsMakeUp          *int    `json:"isMakeUp"`
	IsHoliday         int     `json:"isHoliday"`
	IsExtraSession    int     `json:"isExtraSession"`
	IsActive          int     `json:"isActive"`
	CreatedAt         *string `json:"createdAt"`
	ProfessorViewedAt *string `json:"professorViewedAt"`
	UpdatedAt         *string `json:"updatedAt"`
	RoomName          *string `json:"roomName"`
	Topic             *string `json:"topic"`
}

// ClassSessionsBoardData دادهٔ صفحهٔ مدیریت جلسات.
type ClassSessionsBoardData struct {
	Terms              []LPTermOption         `json:"terms"`
	TermID             int64                  `json:"termId"`
	TermCode           string                 `json:"termCode"`
	TermTitle          string                 `json:"termTitle"`
	Offerings          []ClassSessionOffering `json:"offerings"`
	SelectedOfferingID int64                  `json:"selectedOfferingId"`
	Sessions           []ClassSessionItem     `json:"sessions"`
}

// ClassSessionsBoard پورت صفحهٔ admin/class-sessions.
func (s *Service) ClassSessionsBoard(ctx context.Context, user *session.User, uniCookie string, termID int64, q string, offeringID int64) (*ClassSessionsBoardData, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	resp := &ClassSessionsBoardData{Terms: s.lpScopeTerms(ctx, uniID), Offerings: []ClassSessionOffering{}, Sessions: []ClassSessionItem{}}
	term := lpTermPick(resp.Terms, termID)
	resp.TermID = term.ID
	resp.TermTitle = term.Title

	var termCode string
	_ = s.DB.Pool.QueryRow(ctx, `select coalesce("termCode",'') from academic_terms where id = $1`, term.ID).Scan(&termCode)
	resp.TermCode = termCode

	if term.ID > 0 {
		conds := []string{`o."termId" = $1`}
		args := []any{term.ID}
		idx := 2
		if uniID != nil {
			conds = append(conds, fmt.Sprintf(`o."universityId" = $%d`, idx))
			args = append(args, *uniID)
			idx++
		}
		if qq := strings.TrimSpace(q); qq != "" {
			conds = append(conds, fmt.Sprintf(`(c.code ilike $%d or c.title ilike $%d or st."staffCode" ilike $%d or u."lastName" ilike $%d)`, idx, idx, idx, idx))
			args = append(args, "%"+qq+"%")
			idx++
		}
		rows, err := s.DB.Pool.Query(ctx, `
			select o.id, c.code, c.title, coalesce(o."groupNumber",1),
			       nullif(trim(coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",'')), ''),
			       st."staffCode",
			       (select count(*) from class_sessions cs where cs."offeringId" = o.id)::int,
			       (select count(*) from class_sessions cs where cs."offeringId" = o.id and cs."isHoliday" = 1)::int
			  from course_offerings o
			  join courses c on c.id = o."courseId"
			  left join staff st on st.id = o."professorId"
			  left join users u on u.id = st."userId"
			 where `+strings.Join(conds, " and ")+`
			 order by c.code, o."groupNumber" limit 400`, args...)
		if err == nil {
			for rows.Next() {
				var r ClassSessionOffering
				if rows.Scan(&r.ID, &r.Code, &r.Title, &r.GroupNumber, &r.ProfessorName, &r.StaffCode, &r.SessionCount, &r.HolidayCount) == nil {
					resp.Offerings = append(resp.Offerings, r)
				}
			}
			rows.Close()
		}
	}

	selected := int64(0)
	for _, o := range resp.Offerings {
		if o.ID == offeringID {
			selected = offeringID
			break
		}
	}
	if selected == 0 && len(resp.Offerings) > 0 {
		selected = resp.Offerings[0].ID
	}
	resp.SelectedOfferingID = selected

	if selected > 0 {
		rows, err := s.DB.Pool.Query(ctx, `
			select s.id, s."sessionNo", coalesce(s."sessionDate"::text,''), coalesce(s."startTime",''), coalesce(s."endTime",''),
			       coalesce(s.status,''), s."isMakeUpSession", coalesce(s."isHoliday",0), coalesce(s."isExtraSession",0),
			       coalesce(s."isActive",0), s."createdAt"::text, s."professorViewedAt"::text, s."updatedAt"::text,
			       cr.name, s.topic
			  from class_sessions s
			  left join classrooms cr on cr.id = s."roomId"
			 where s."offeringId" = $1
			 order by s."sessionNo", s."sessionDate" limit 400`, selected)
		if err == nil {
			for rows.Next() {
				var r ClassSessionItem
				if rows.Scan(&r.ID, &r.SessionNo, &r.SessionDate, &r.StartTime, &r.EndTime, &r.Status, &r.IsMakeUp,
					&r.IsHoliday, &r.IsExtraSession, &r.IsActive, &r.CreatedAt, &r.ProfessorViewedAt, &r.UpdatedAt,
					&r.RoomName, &r.Topic) == nil {
					resp.Sessions = append(resp.Sessions, r)
				}
			}
			rows.Close()
		}
	}
	return resp, nil
}

// ClassSessionToggleFlag پورت toggleSessionFlagAction — تعطیل/فوق‌برنامه/فعال.
func (s *Service) ClassSessionToggleFlag(ctx context.Context, user *session.User, uniCookie string, sessionID int64, flag string) (int, error) {
	if sessionID <= 0 {
		return 0, errors.New("جلسه نامعتبر است.")
	}
	if flag != "isHoliday" && flag != "isExtraSession" && flag != "isActive" {
		return 0, errors.New("پرچم نامعتبر است.")
	}
	var isHoliday, isExtra, isActive *int
	var uniID *int64
	err := s.DB.Pool.QueryRow(ctx, `
		select s."isHoliday", s."isExtraSession", s."isActive", o."universityId"
		  from class_sessions s
		  join course_offerings o on o.id = s."offeringId"
		 where s.id = $1`, sessionID).Scan(&isHoliday, &isExtra, &isActive, &uniID)
	if err != nil {
		return 0, errors.New("جلسه یافت نشد.")
	}
	if uniID != nil && !s.Scope.CanActOnUniversity(ctx, user, uniID) {
		return 0, errors.New("این جلسه در دانشگاه شما نیست.")
	}
	current := isHoliday
	if flag == "isExtraSession" {
		current = isExtra
	} else if flag == "isActive" {
		current = isActive
	}
	next := 1
	if current != nil && *current == 1 {
		next = 0
	}
	sqlStr := `update class_sessions set ` + flag + ` = $2, "updatedAt" = now() where id = $1`
	if _, err := s.DB.Pool.Exec(ctx, sqlStr, sessionID, next); err != nil {
		return 0, errors.New("تغییر پرچم ممکن نشد.")
	}
	return next, nil
}

// ─────────────────────────── ۴) زنجیرهٔ تحویل اوراق امتحان ───────────────────────────

// ExamHandoverSession ردیف جلسهٔ امتحان در زنجیره.
type ExamHandoverSession struct {
	SessionID     int64  `json:"sessionId"`
	ExamDate      string `json:"examDate"`
	Time          string `json:"time"`
	HallID        *int64 `json:"hallId"`
	HallName      string `json:"hallName"`
	Present       int    `json:"present"`
	Total         int    `json:"total"`
	MinutesSigned int    `json:"minutesSigned"`
	VaultReceived int    `json:"vaultReceived"`
	Packets       int    `json:"packets"`
}

// ExamHandoverDelivery ردیف تحویل به استاد.
type ExamHandoverDelivery struct {
	DeliveryID        int64   `json:"deliveryId"`
	OfferingID        int64   `json:"offeringId"`
	Status            string  `json:"status"`
	SheetCount        int     `json:"sheetCount"`
	ReturnedToArchive bool    `json:"returnedToArchive"`
	ReturnedAt        *string `json:"returnedAt"`
	CourseCode        *string `json:"courseCode"`
	CourseTitle       *string `json:"courseTitle"`
	ProfessorName     string  `json:"professorName"`
}

// ExamHandoverBoardData دادهٔ صفحهٔ زنجیرهٔ تحویل.
type ExamHandoverBoardData struct {
	Terms      []LPTermOption         `json:"terms"`
	TermID     int64                  `json:"termId"`
	TermTitle  string                 `json:"termTitle"`
	Sessions   []ExamHandoverSession  `json:"sessions"`
	Deliveries []ExamHandoverDelivery `json:"deliveries"`
}

// ExamHandoverBoard پورت صفحهٔ admin/exams/handover.
func (s *Service) ExamHandoverBoard(ctx context.Context, user *session.User, uniCookie string, termID int64) (*ExamHandoverBoardData, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	resp := &ExamHandoverBoardData{Terms: s.lpScopeTerms(ctx, uniID), Sessions: []ExamHandoverSession{}, Deliveries: []ExamHandoverDelivery{}}
	term := lpTermPick(resp.Terms, termID)
	resp.TermID = term.ID
	resp.TermTitle = term.Title
	if term.ID <= 0 {
		return resp, nil
	}

	cond := ""
	args := []any{term.ID}
	if uniID != nil {
		cond = ` and es."universityId" = $2`
		args = append(args, *uniID)
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select es.id, coalesce(es."examDate"::text,''), coalesce(es."startTime",''), coalesce(es."endTime",''),
		       (select sa."hallId" from seat_allocations sa where sa."sessionId" = es.id limit 1),
		       (select h.name from seat_allocations sa join exam_halls h on h.id = sa."hallId" where sa."sessionId" = es.id limit 1),
		       (select count(*) from exam_attendances ea where ea."examId" = es.id and ea."isPresent" = 1)::int,
		       (select count(*) from exam_attendances ea where ea."examId" = es.id)::int,
		       (select count(*) from exam_minutes m where m."sessionId" = es.id and m."isSignedAndFinalized" = 1)::int,
		       (select count(*) from exam_minutes m where m."sessionId" = es.id and m."vaultReceivedAt" is not null)::int,
		       (select count(*) from exam_course_packets p where p."examId" = es.id)::int
		  from exam_sessions es
		 where es."termId" = $1`+cond+`
		 order by es."examDate" desc limit 120`, args...)
	if err == nil {
		for rows.Next() {
			var r ExamHandoverSession
			var st, en string
			if rows.Scan(&r.SessionID, &r.ExamDate, &st, &en, &r.HallID, &r.HallName, &r.Present, &r.Total,
				&r.MinutesSigned, &r.VaultReceived, &r.Packets) == nil {
				r.Time = st + "–" + en
				if r.HallName == "" {
					r.HallName = "—"
				}
				resp.Sessions = append(resp.Sessions, r)
			}
		}
		rows.Close()
	}

	dcond := ""
	dargs := []any{term.ID}
	if uniID != nil {
		dcond = ` and o."universityId" = $2`
		dargs = append(dargs, *uniID)
	}
	drows, err := s.DB.Pool.Query(ctx, `
		select d.id, d."courseOfferingId", coalesce(d.status,''), coalesce(d."sheetCount",0),
		       coalesce(d."papersReturnedToArchive",0), d."returnedAt"::text,
		       c.code, c.title, coalesce(u."firstName" || ' ' || u."lastName", '—')
		  from instructor_deliveries d
		  join course_offerings o on o.id = d."courseOfferingId"
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = d."instructorId"
		  left join users u on u.id = st."userId"
		 where o."termId" = $1`+dcond+`
		 order by d.id desc limit 120`, dargs...)
	if err == nil {
		for drows.Next() {
			var r ExamHandoverDelivery
			var returned int
			if drows.Scan(&r.DeliveryID, &r.OfferingID, &r.Status, &r.SheetCount, &returned, &r.ReturnedAt,
				&r.CourseCode, &r.CourseTitle, &r.ProfessorName) == nil {
				r.ReturnedToArchive = returned == 1
				resp.Deliveries = append(resp.Deliveries, r)
			}
		}
		drows.Close()
	}
	return resp, nil
}

// ExamHandoverQRData پاسخ ساخت QR تحویل.
type ExamHandoverQRData struct {
	URL       string `json:"url"`
	QR        string `json:"qr"`
	ExpiresAt string `json:"expiresAt"`
	Step      string `json:"step"`
}

// ExamHandoverQR پورت GET /api/admin/exams/handover-qr — توکن امضاشدهٔ ۳ ساعته.
func (s *Service) ExamHandoverQR(ctx context.Context, user *session.User, uniCookie string, signer *verification.Signer, step string, sessionID, hallID, offeringID int64) (*ExamHandoverQRData, error) {
	step = strings.ToUpper(strings.TrimSpace(step))
	switch step {
	case "VAULT", "FINALIZE", "INSTRUCTOR", "ARCHIVE":
	default:
		return nil, errors.New("نوع تحویل نامعتبر است")
	}
	if (step == "INSTRUCTOR" || step == "ARCHIVE") && offeringID <= 0 {
		return nil, errors.New("ارائهٔ درس الزامی است")
	}
	if step != "INSTRUCTOR" && step != "ARCHIVE" && sessionID <= 0 {
		return nil, errors.New("جلسهٔ امتحان الزامی است")
	}
	// بررسی دامنهٔ دانشگاه برای جلسه/ارائهٔ هدف.
	if sessionID > 0 {
		var uniID *int64
		var termUni *int64
		if err := s.DB.Pool.QueryRow(ctx, `
			select es."universityId", t."universityId" from exam_sessions es
			  left join academic_terms t on t.id = es."termId"
			 where es.id = $1`, sessionID).Scan(&uniID, &termUni); err != nil {
			return nil, errors.New("جلسهٔ امتحان یافت نشد.")
		}
		target := uniID
		if target == nil {
			target = termUni
		}
		if !s.Scope.CanActOnUniversity(ctx, user, target) {
			return nil, errors.New("دسترسی: این مورد متعلق به دانشگاه شما نیست.")
		}
	}
	if offeringID > 0 {
		var uniID *int64
		if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from course_offerings where id = $1`, offeringID).Scan(&uniID); err != nil {
			return nil, errors.New("ارائهٔ درس یافت نشد.")
		}
		if !s.Scope.CanActOnUniversity(ctx, user, uniID) {
			return nil, errors.New("دسترسی: این مورد متعلق به دانشگاه شما نیست.")
		}
	}
	if signer == nil {
		return nil, errors.New("امضای توکن پیکربندی نشده است.")
	}
	payload := map[string]any{
		"kind": "EXAM_HANDOVER", "step": step,
		"sid": sessionID, "hid": hallID, "oid": offeringID,
	}
	token, err := signer.Sign(ctx, payload, 180*60)
	if err != nil {
		return nil, err
	}
	publicBase := ""
	if s.Store != nil {
		if v, err := s.Store.Get(ctx, "PUBLIC_BASE_URL"); err == nil {
			publicBase = strings.TrimRight(strings.TrimSpace(v), "/")
		}
	}
	verifyURL := publicBase + "/exam-handover/" + token
	svg, err := qr.SVG(verifyURL, qr.Options{Level: "Q", Size: 128, Margin: 4})
	if err != nil {
		return nil, err
	}
	return &ExamHandoverQRData{
		URL:       verifyURL,
		QR:        svg,
		ExpiresAt: time.Now().Add(180 * time.Minute).Format(time.RFC3339),
		Step:      step,
	}, nil
}

// ExamHandoverFinalize پورت examFinalizeHandoverAction + engine.finalizeVaultHandover.
func (s *Service) ExamHandoverFinalize(ctx context.Context, user *session.User, uniCookie string, sessionID int64) (map[string]any, error) {
	var uniID, termUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select es."universityId", t."universityId" from exam_sessions es
		  left join academic_terms t on t.id = es."termId"
		 where es.id = $1`, sessionID).Scan(&uniID, &termUni); err != nil {
		return nil, errors.New("جلسهٔ امتحان یافت نشد.")
	}
	target := uniID
	if target == nil {
		target = termUni
	}
	if !s.Scope.CanActOnUniversity(ctx, user, target) {
		return nil, errors.New("دسترسی: این مورد متعلق به دانشگاه شما نیست.")
	}
	var vaultManagerID int64
	if err := s.DB.Pool.QueryRow(ctx, `select id from staff where "userId" = $1 limit 1`, user.ID).Scan(&vaultManagerID); err != nil {
		return nil, errors.New("پروندهٔ پرسنلی یافت نشد.")
	}

	// برگهٔ واقعی هر بسته = تعداد حاضرِ همان درس در کل جلسه.
	type cntRow struct {
		cid    int64
		sheets int
	}
	counts := []cntRow{}
	crows, err := s.DB.Pool.Query(ctx, `
		select co."courseId" as cid, count(*) filter (where a."isPresent" = 1)::int as sheets
		  from seat_allocations sa
		  join enrollments e on e.id = sa."enrollmentId"
		  join course_offerings co on co.id = e."offeringId"
		  left join exam_attendances a on a."examId" = sa."sessionId" and a."studentId" = e."studentId"
		 where sa."sessionId" = $1
		 group by co."courseId"`, sessionID)
	if err != nil {
		return nil, err
	}
	for crows.Next() {
		var r cntRow
		if crows.Scan(&r.cid, &r.sheets) == nil {
			counts = append(counts, r)
		}
	}
	crows.Close()

	cids := make([]int64, len(counts))
	sheets := make([]int, len(counts))
	for i, c := range counts {
		cids[i] = c.cid
		sheets[i] = c.sheets
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// قفل توافقی — نهایی‌سازی همزمان با تحویل سالن‌ها تداخل ندارد.
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
		fmt.Sprintf("exam_finalize:%d:0", sessionID)); err != nil {
		return nil, err
	}
	var packets int64
	if len(cids) > 0 {
		ct, err := tx.Exec(ctx, `
			update exam_course_packets p set
			  "actualDeliveredCount" = v.sheets,
			  "handoverStatus" = case when p."expectedSheetCount" = v.sheets then 'RECEIVED_BY_VAULT' else 'DISCREPANCY' end,
			  "receivedByVaultManagerId" = $4,
			  "handoverCompletedAt" = now(),
			  "discrepancyNote" = case when p."expectedSheetCount" <> v.sheets then
			    'تعداد برگهٔ دریافتی (' || v.sheets || ') با برگهٔ مورد انتظار (' || p."expectedSheetCount" || ') مغایرت دارد.' end
			from (select unnest($2::int[]) as cid, unnest($3::int[]) as sheets) v
			where p."examId" = $1 and p."courseId" = v.cid`,
			sessionID, cids, sheets, vaultManagerID)
		if err != nil {
			return nil, err
		}
		packets = ct.RowsAffected()
	}
	var collected int64
	if err := tx.QueryRow(ctx, `
		with upd as (
		  update course_exam_sessions set "isFullyCollected" = 1, "notificationSentAt" = now()
		   where "isFullyCollected" = 0 and "receivedHallsCount" >= "totalHallsCount"
		   returning id
		) select count(*) from upd`).Scan(&collected); err != nil {
		return nil, err
	}
	var discrepancies int64
	if err := tx.QueryRow(ctx, `
		select count(*) from exam_course_packets
		 where "examId" = $1 and "handoverStatus" = 'DISCREPANCY'`, sessionID).Scan(&discrepancies); err != nil {
		return nil, err
	}
	details, _ := json.Marshal(map[string]any{
		"vaultManagerId": vaultManagerID, "packets": packets,
		"fullyCollected": collected, "discrepancies": discrepancies,
	})
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "EXAM_VAULT_FINALIZED", "exam_session", sessionID, string(details)); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return map[string]any{
		"packets": packets, "fullyCollected": collected, "discrepancies": discrepancies,
	}, nil
}

// ─────────────────────────── ۵) ویرایشگر ارائه ───────────────────────────

// OfferingEditorClassRow یک ردیف برنامهٔ کلاس.
type OfferingEditorClassRow struct {
	ID     int64   `json:"id"`
	Day    *int    `json:"day"`
	Start  *string `json:"start"`
	End    *string `json:"end"`
	RoomID *int64  `json:"roomId"`
}

// OfferingEditorExamRow ردیف امتحان.
type OfferingEditorExamRow struct {
	ID    int64   `json:"id"`
	Date  *string `json:"date"`
	Start *string `json:"start"`
	End   *string `json:"end"`
}

// OfferingEditorRow ردیف ارائه برای ویرایش.
type OfferingEditorRow struct {
	OfferingID        int64                    `json:"offeringId"`
	Code              string                   `json:"code"`
	Title             string                   `json:"title"`
	GroupNumber       int                      `json:"groupNumber"`
	Units             *float64                 `json:"units"`
	ProfessorName     string                   `json:"professorName"`
	Capacity          int                      `json:"capacity"`
	EnrolledCount     int                      `json:"enrolledCount"`
	DepartmentID      *int64                   `json:"departmentId"`
	EduExpertUserID   *int64                   `json:"eduExpertUserId"`
	EduExpertUserIDs  []int64                  `json:"eduExpertUserIds"`
	RoomExpertUserIDs []int64                  `json:"roomExpertUserIds"`
	ClassRows         []OfferingEditorClassRow `json:"classRows"`
	Exam              *OfferingEditorExamRow   `json:"exam"`
}

// lpExpertScopeForUser دامنهٔ کارشناس آموزش (پورت currentExpertFilters).
func (s *Service) lpExpertScopeForUser(ctx context.Context, user *session.User) (departmentIDs, facultyIDs []int64, hasScope bool) {
	isExpert := false
	for _, r := range user.Roles {
		if r == "EDU_EXPERT" {
			isExpert = true
		}
	}
	if !isExpert {
		return nil, nil, false
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select "scopeType", "scopeId" from expert_scopes where "userId" = $1`, user.ID)
	if err != nil {
		return nil, nil, false
	}
	defer rows.Close()
	depts := []int64{}
	facs := []int64{}
	any := false
	for rows.Next() {
		var t string
		var id *int64
		if rows.Scan(&t, &id) == nil && id != nil {
			switch t {
			case "DEPARTMENT":
				depts = append(depts, *id)
				any = true
			case "FACULTY":
				facs = append(facs, *id)
				any = true
			case "MAJOR", "UNIVERSITY":
				any = true
			}
		}
	}
	if !any || (len(depts) == 0 && len(facs) == 0) {
		// دامنه فقط رشته/دانشگاه — در سطح درس محدودسازی رشته‌ای اعمال نمی‌کنیم
		// (هم‌رفتار scopeOffConds که فقط department/faculty را می‌بندد).
		return nil, nil, false
	}
	return depts, facs, true
}

// ListOfferingsForEditor پورت listOfferingsForEditor — کارشناس فقط دامنهٔ خودش.
func (s *Service) ListOfferingsForEditor(ctx context.Context, user *session.User, uniCookie string, termID int64) ([]OfferingEditorRow, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	out := []OfferingEditorRow{}
	if termID <= 0 {
		return out, nil
	}
	conds := []string{`o."termId" = $1`, `o."isActive" = 1`}
	args := []any{termID}
	idx := 2
	if uniID != nil {
		conds = append(conds, fmt.Sprintf(`o."universityId" = $%d`, idx))
		args = append(args, *uniID)
		idx++
	}
	if depts, facs, hasScope := s.lpExpertScopeForUser(ctx, user); hasScope {
		switch {
		case len(depts) > 0:
			conds = append(conds, fmt.Sprintf(`c."departmentId" = any($%d::int[])`, idx))
			args = append(args, depts)
			idx++
		case len(facs) > 0:
			conds = append(conds, fmt.Sprintf(`c."departmentId" in (select id from departments where "facultyId" = any($%d::int[]))`, idx))
			args = append(args, facs)
			idx++
		}
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.code, c.title, coalesce(o."groupNumber",1), c.units::float8, o."professorId",
		       coalesce(o."capacity",0), coalesce(o."enrolledCount",0), c."departmentId", o."eduExpertUserId"
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		 where `+strings.Join(conds, " and ")+`
		 order by c.title, o."groupNumber" limit 4000`, args...)
	if err != nil {
		return out, nil
	}
	type offRow struct {
		r           OfferingEditorRow
		professorID *int64
	}
	offs := []offRow{}
	offIDs := []int64{}
	for rows.Next() {
		var o offRow
		o.r.EduExpertUserIDs = []int64{}
		o.r.RoomExpertUserIDs = []int64{}
		o.r.ClassRows = []OfferingEditorClassRow{}
		if rows.Scan(&o.r.OfferingID, &o.r.Code, &o.r.Title, &o.r.GroupNumber, &o.r.Units, &o.professorID,
			&o.r.Capacity, &o.r.EnrolledCount, &o.r.DepartmentID, &o.r.EduExpertUserID) == nil {
			offs = append(offs, o)
			offIDs = append(offIDs, o.r.OfferingID)
		}
	}
	rows.Close()

	// برنامهٔ هفتگی + امتحان
	type schedRow struct {
		id         int64
		offeringID int64
		typ        string
		day        *int
		start      *string
		end        *string
		examDate   *string
		roomID     *int64
	}
	scheds := []schedRow{}
	roomIDs := []int64{}
	roomSeen := map[int64]bool{}
	if len(offIDs) > 0 {
		if srows, err := s.DB.Pool.Query(ctx, `
			select id, "offeringId", "scheduleType", "dayOfWeek", "startTime"::text, "endTime"::text, "examDate"::text, "roomId"
			  from schedules where "offeringId" = any($1::int[])`, offIDs); err == nil {
			for srows.Next() {
				var r schedRow
				if srows.Scan(&r.id, &r.offeringID, &r.typ, &r.day, &r.start, &r.end, &r.examDate, &r.roomID) == nil {
					scheds = append(scheds, r)
					if r.typ != "EXAM" && r.roomID != nil && !roomSeen[*r.roomID] {
						roomSeen[*r.roomID] = true
						roomIDs = append(roomIDs, *r.roomID)
					}
				}
			}
			srows.Close()
		}
	}

	// نام استادها
	profNames := map[int64]string{}
	profIDs := []int64{}
	profSeen := map[int64]bool{}
	for _, o := range offs {
		if o.professorID != nil && !profSeen[*o.professorID] {
			profSeen[*o.professorID] = true
			profIDs = append(profIDs, *o.professorID)
		}
	}
	if len(profIDs) > 0 {
		if prows, err := s.DB.Pool.Query(ctx, `
			select st.id, coalesce(u."firstName",''), coalesce(u."lastName",'')
			  from staff st join users u on u.id = st."userId"
			 where st.id = any($1::int[])`, profIDs); err == nil {
			for prows.Next() {
				var id int64
				var fn, ln string
				if prows.Scan(&id, &fn, &ln) == nil {
					profNames[id] = strings.TrimSpace(fn + " " + ln)
				}
			}
			prows.Close()
		}
	}

	// کارشناسانِ سطح کلاس (چندبه‌چند)
	expertsByOff := map[int64][]int64{}
	if len(offIDs) > 0 {
		if erows, err := s.DB.Pool.Query(ctx, `
			select "offeringId", "userId" from course_offering_edu_experts
			 where "offeringId" = any($1::int[]) order by id`, offIDs); err == nil {
			for erows.Next() {
				var oid, uid int64
				if erows.Scan(&oid, &uid) == nil {
					found := false
					for _, v := range expertsByOff[oid] {
						if v == uid {
							found = true
						}
					}
					if !found {
						expertsByOff[oid] = append(expertsByOff[oid], uid)
					}
				}
			}
			erows.Close()
		}
	}

	// کارشناسانِ سطح اتاق (ارث‌بری از اتاقِ سانس‌ها)
	expertsByRoom := map[int64][]int64{}
	if len(roomIDs) > 0 {
		if rrows, err := s.DB.Pool.Query(ctx, `
			select "classroomId", "userId" from classroom_edu_experts
			 where "classroomId" = any($1::int[]) order by id`, roomIDs); err == nil {
			for rrows.Next() {
				var rid, uid int64
				if rrows.Scan(&rid, &uid) == nil {
					found := false
					for _, v := range expertsByRoom[rid] {
						if v == uid {
							found = true
						}
					}
					if !found {
						expertsByRoom[rid] = append(expertsByRoom[rid], uid)
					}
				}
			}
			rrows.Close()
		}
	}

	for _, o := range offs {
		r := o.r
		classRows := []OfferingEditorClassRow{}
		var exam *OfferingEditorExamRow
		for _, srow := range scheds {
			if srow.offeringID != r.OfferingID {
				continue
			}
			if srow.typ == "CLASS" {
				classRows = append(classRows, OfferingEditorClassRow{ID: srow.id, Day: srow.day, Start: srow.start, End: srow.end, RoomID: srow.roomID})
			} else if srow.typ == "EXAM" && exam == nil {
				exam = &OfferingEditorExamRow{ID: srow.id, Date: srow.examDate, Start: srow.start, End: srow.end}
			}
		}
		r.ClassRows = classRows
		r.Exam = exam
		if pn, ok := profNames[*o.professorID]; o.professorID != nil && ok && pn != "" {
			r.ProfessorName = pn
		} else {
			r.ProfessorName = "—"
		}
		if ids, ok := expertsByOff[r.OfferingID]; ok && len(ids) > 0 {
			r.EduExpertUserIDs = ids
			r.EduExpertUserID = &ids[0]
		} else if r.EduExpertUserID != nil {
			r.EduExpertUserIDs = []int64{*r.EduExpertUserID}
		}
		roomExperts := map[int64]bool{}
		for _, c := range classRows {
			if c.RoomID == nil {
				continue
			}
			for _, uid := range expertsByRoom[*c.RoomID] {
				roomExperts[uid] = true
			}
		}
		for uid := range roomExperts {
			r.RoomExpertUserIDs = append(r.RoomExpertUserIDs, uid)
		}
		sort.Slice(r.RoomExpertUserIDs, func(i, j int) bool { return r.RoomExpertUserIDs[i] < r.RoomExpertUserIDs[j] })
		out = append(out, r)
	}
	return out, nil
}

// ListRoomsForEditor پورت getRoomsForEditor — سالن‌های دانشگاه (یا مشترک).
func (s *Service) ListRoomsForEditor(ctx context.Context, user *session.User, uniCookie string) ([]LPIdName, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	out := []LPIdName{}
	cond := ""
	args := []any{}
	if uniID != nil {
		cond = ` where ("universityId" = $1 or "universityId" is null)`
		args = append(args, *uniID)
	}
	rows, err := s.DB.Pool.Query(ctx, `select id, name from classrooms`+cond+` order by name limit 3000`, args...)
	if err != nil {
		return out, nil
	}
	defer rows.Close()
	for rows.Next() {
		var r LPIdName
		if rows.Scan(&r.ID, &r.Name) == nil {
			out = append(out, r)
		}
	}
	return out, nil
}

// ListTermsForEditor پورت listTermsForEditor.
func (s *Service) ListTermsForEditor(ctx context.Context, user *session.User, uniCookie string) ([]LPTermOption, error) {
	return s.lpTermsList(ctx, s.UniversityID(ctx, user, uniCookie)), nil
}

// ListEduExpertsForEditor پورت listEduExpertsForEditor.
func (s *Service) ListEduExpertsForEditor(ctx context.Context, user *session.User, uniCookie string) ([]EduExpertCandidate, error) {
	return s.listEduExpertCandidates(ctx, s.UniversityID(ctx, user, uniCookie))
}

// OfferingEditorSaveInput ورودی ذخیرهٔ ویرایشگر ارائه.
type OfferingEditorSaveInput struct {
	OfferingID     int64                    `json:"offeringId"`
	Capacity       int                      `json:"capacity"`
	ClassRows      []OfferingEditorClassRow `json:"classRows"`
	Exam           *OfferingEditorExamRow   `json:"exam"`
	OverrideReason string                   `json:"overrideReason"`
}

// lpEditorToMin «HH:MM» → دقیقه.
func lpEditorToMin(s string) int {
	var h, m int
	if _, err := fmt.Sscanf(s, "%d:%d", &h, &m); err != nil {
		return 0
	}
	return h*60 + m
}

// SaveOfferingEditor پورت saveOfferingEditorAction — ظرفیت + زمان کلاس/امتحان با گارد تداخل.
func (s *Service) SaveOfferingEditor(ctx context.Context, user *session.User, uniCookie string, in OfferingEditorSaveInput) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	var offID, courseID, termID int64
	var offUni *int64
	var offProfessor *int64
	err := s.DB.Pool.QueryRow(ctx, `
		select id, "courseId", "termId", "universityId", "professorId"
		  from course_offerings where id = $1`, in.OfferingID).
		Scan(&offID, &courseID, &termID, &offUni, &offProfessor)
	if err != nil {
		return errors.New("ارائه یافت نشد.")
	}
	if uniID != nil && offUni != nil && *offUni != *uniID {
		return errors.New("این ارائه متعلق به دانشگاه دیگری است.")
	}
	if uniID != nil && offUni == nil {
		return errors.New("دانشگاه ارائه نامشخص است.")
	}

	// IDOR: هر شناسهٔ برنامه/امتحانِ ارسالی باید متعلق به همین ارائه باشد.
	supplied := []int64{}
	seenSup := map[int64]bool{}
	for _, c := range in.ClassRows {
		if c.ID > 0 && !seenSup[c.ID] {
			seenSup[c.ID] = true
			supplied = append(supplied, c.ID)
		}
	}
	if in.Exam != nil && in.Exam.ID > 0 && !seenSup[in.Exam.ID] {
		seenSup[in.Exam.ID] = true
		supplied = append(supplied, in.Exam.ID)
	}
	if len(supplied) > 0 {
		var owned int
		if err := s.DB.Pool.QueryRow(ctx, `
			select count(distinct id) from schedules where id = any($1::int[]) and "offeringId" = $2`,
			supplied, in.OfferingID).Scan(&owned); err != nil || owned != len(supplied) {
			return errors.New("شناسهٔ برنامه نامعتبر است.")
		}
	}

	// سالن‌ها باید متعلق به همین دانشگاه باشند.
	roomIDs := []int64{}
	roomSeen := map[int64]bool{}
	for _, c := range in.ClassRows {
		if c.RoomID != nil && *c.RoomID > 0 && !roomSeen[*c.RoomID] {
			roomSeen[*c.RoomID] = true
			roomIDs = append(roomIDs, *c.RoomID)
		}
	}
	if len(roomIDs) > 0 && uniID != nil {
		rows, err := s.DB.Pool.Query(ctx, `select "universityId" from classrooms where id = any($1::int[])`, roomIDs)
		if err != nil {
			return errors.New("سالن نامعتبر است.")
		}
		n := 0
		bad := false
		for rows.Next() {
			var ru *int64
			if rows.Scan(&ru) == nil {
				n++
				if ru != nil && *ru != *uniID {
					bad = true
				}
			}
		}
		rows.Close()
		if bad {
			return errors.New("این سالن متعلق به دانشگاه دیگری است.")
		}
		if n != len(roomIDs) {
			return errors.New("سالن نامعتبر است.")
		}
	}

	// دامنهٔ کارشناس آموزش روی گروه/دانشکدهٔ درس.
	if depts, facs, hasScope := s.lpExpertScopeForUser(ctx, user); hasScope {
		var courseDept *int64
		_ = s.DB.Pool.QueryRow(ctx, `select "departmentId" from courses where id = $1`, courseID).Scan(&courseDept)
		inScope := false
		if len(depts) > 0 {
			if courseDept != nil {
				for _, d := range depts {
					if d == *courseDept {
						inScope = true
					}
				}
			}
		} else if len(facs) > 0 {
			if courseDept != nil {
				var facID *int64
				_ = s.DB.Pool.QueryRow(ctx, `select "facultyId" from departments where id = $1`, *courseDept).Scan(&facID)
				if facID != nil {
					for _, f := range facs {
						if f == *facID {
							inScope = true
						}
					}
				}
			}
		}
		if !inScope {
			return errors.New("این درس در دامنهٔ شما نیست.")
		}
	}

	// گارد تداخل: جلسات/امتحاناتِ دیگرِ همین ترم.
	type otherRow struct {
		offeringID int64
		day        *int
		start      *string
		end        *string
		examDate   *string
		typ        string
		roomID     *int64
		professor  *int64
	}
	others := []otherRow{}
	orows, err := s.DB.Pool.Query(ctx, `
		select s."offeringId", s."dayOfWeek", s."startTime"::text, s."endTime"::text,
		       s."examDate"::text, s."scheduleType", s."roomId", o."professorId"
		  from schedules s
		  join course_offerings o on o.id = s."offeringId"
		 where o."termId" = $1 and s."offeringId" <> $2`, termID, in.OfferingID)
	if err == nil {
		for orows.Next() {
			var r otherRow
			if orows.Scan(&r.offeringID, &r.day, &r.start, &r.end, &r.examDate, &r.typ, &r.roomID, &r.professor) == nil {
				others = append(others, r)
			}
		}
		orows.Close()
	}
	conflicts := []string{}
	for _, c := range in.ClassRows {
		if c.Day == nil || c.Start == nil || c.End == nil {
			continue
		}
		cs, ce := lpEditorToMin(*c.Start), lpEditorToMin(*c.End)
		for _, o := range others {
			if o.typ == "EXAM" || o.day == nil || o.start == nil || o.end == nil {
				continue
			}
			if *c.Day != *o.day {
				continue
			}
			os, oe := lpEditorToMin(*o.start), lpEditorToMin(*o.end)
			if cs < oe && os < ce {
				if c.RoomID != nil && o.roomID != nil && *o.roomID == *c.RoomID {
					conflicts = append(conflicts, fmt.Sprintf("تداخل سالن در %d %s–%s", *c.Day, *c.Start, *c.End))
				}
				if o.professor != nil && offProfessor != nil && *o.professor == *offProfessor {
					conflicts = append(conflicts, fmt.Sprintf("تداخل استاد در %d", *c.Day))
				}
			}
		}
	}
	if in.Exam != nil && in.Exam.Date != nil && *in.Exam.Date != "" && in.Exam.Start != nil && in.Exam.End != nil {
		es, ee := lpEditorToMin(*in.Exam.Start), lpEditorToMin(*in.Exam.End)
		for _, o := range others {
			if o.typ != "EXAM" || o.examDate == nil || o.start == nil || o.end == nil {
				continue
			}
			if *in.Exam.Date == *o.examDate {
				os, oe := lpEditorToMin(*o.start), lpEditorToMin(*o.end)
				if es < oe && os < ee {
					conflicts = append(conflicts, fmt.Sprintf("تداخل امتحان در %s", *in.Exam.Date))
				}
			}
		}
	}
	if len(conflicts) > 0 && strings.TrimSpace(in.OverrideReason) == "" {
		return fmt.Errorf("تداخل: %s — برای ذخیره با وجود تداخل، دلیل (حکم/مجوز) را وارد کن.", conflicts[0])
	}

	// ظرفیت
	if in.Capacity >= 0 {
		if uniID != nil {
			_, _ = s.DB.Pool.Exec(ctx, `update course_offerings set "capacity" = $2 where id = $1 and "universityId" = $3`,
				in.OfferingID, in.Capacity, *uniID)
		} else {
			_, _ = s.DB.Pool.Exec(ctx, `update course_offerings set "capacity" = $2 where id = $1`, in.OfferingID, in.Capacity)
		}
	}

	// جلسات کلاس + امتحان در یک تراکنش
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for _, c := range in.ClassRows {
		day := 0
		if c.Day != nil {
			day = *c.Day
		}
		start := "00:00"
		if c.Start != nil && *c.Start != "" {
			start = *c.Start
		}
		end := "00:00"
		if c.End != nil && *c.End != "" {
			end = *c.End
		}
		if _, err := tx.Exec(ctx, `
			update schedules set "dayOfWeek" = $3, "startTime" = $4, "endTime" = $5, "roomId" = $6
			 where id = $1 and "offeringId" = $2`,
			c.ID, in.OfferingID, day, start, end, c.RoomID); err != nil {
			return err
		}
	}
	if in.Exam != nil {
		date := ""
		if in.Exam.Date != nil {
			date = strings.TrimSpace(*in.Exam.Date)
		}
		start := ""
		if in.Exam.Start != nil {
			start = strings.TrimSpace(*in.Exam.Start)
		}
		end := start
		if in.Exam.End != nil && strings.TrimSpace(*in.Exam.End) != "" {
			end = strings.TrimSpace(*in.Exam.End)
		}
		if in.Exam.ID > 0 {
			if _, err := tx.Exec(ctx, `
				update schedules set "examDate" = $3, "startTime" = $4, "endTime" = $5
				 where id = $1 and "offeringId" = $2`,
				in.Exam.ID, in.OfferingID, lpNilIfEmpty(date), lpNilIfEmpty(start), lpNilIfEmpty(end)); err != nil {
				return err
			}
		} else if date != "" && start != "" {
			if _, err := tx.Exec(ctx, `
				insert into schedules ("offeringId","scheduleType","examDate","startTime","endTime","universityId")
				values ($1,'EXAM',$2,$3,$4,$5)`,
				in.OfferingID, date, start, end, offUni); err != nil {
				return err
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}

func lpNilIfEmpty(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

// ─────────────────────────── ۶) رفع تداخل برنامهٔ هفتگی ───────────────────────────

// ConflictsReviewRow وضعیت «بررسی شد» یک اثرانگشت.
type ConflictsReviewRow struct {
	Fingerprint    string  `json:"fingerprint"`
	Status         string  `json:"status"`
	ReasonCode     *string `json:"reasonCode"`
	ReasonText     *string `json:"reasonText"`
	ReviewedByName *string `json:"reviewedByName"`
	ReviewedAt     *string `json:"reviewedAt"`
}

// ConflictsReportData گزارش تداخل‌ها (پورت ScheduleConflictReport).
type ConflictsReportData struct {
	TermID             int64                         `json:"termId"`
	Pairs              []ConflictsPairJSON           `json:"pairs"`
	Groups             []ConflictsGroupJSON          `json:"groups"`
	Reviewed           map[string]ConflictsReviewRow `json:"reviewed"`
	Summary            ConflictsSummaryJSON          `json:"summary"`
	RawOverlaps        int                           `json:"rawOverlaps"`
	MergedSkipped      int                           `json:"mergedSkipped"`
	SlotsScanned       int                           `json:"slotsScanned"`
	DuplicateSlots     int                           `json:"duplicateSlots"`
	ReviewedCount      int                           `json:"reviewedCount"`
	OpenIssues         int                           `json:"openIssues"`
	TotalIssues        int                           `json:"totalIssues"`
	LikelyMergedIssues int                           `json:"likelyMergedIssues"`
}

// ConflictsSlotJSON ردیف برنامه در گزارش.
type ConflictsSlotJSON struct {
	ScheduleID             int64   `json:"scheduleId"`
	OfferingID             int64   `json:"offeringId"`
	DayOfWeek              *int    `json:"dayOfWeek"`
	StartTime              string  `json:"startTime"`
	EndTime                string  `json:"endTime"`
	RoomID                 *int64  `json:"roomId"`
	RoomName               *string `json:"roomName"`
	ProfessorID            *int64  `json:"professorId"`
	ProfessorName          *string `json:"professorName"`
	CourseCode             string  `json:"courseCode"`
	CourseTitle            string  `json:"courseTitle"`
	GroupNumber            int     `json:"groupNumber"`
	EnrolledCount          int     `json:"enrolledCount"`
	SharedScheduleGroupKey *string `json:"sharedScheduleGroupKey"`
}

// ConflictsPairJSON جفت تداخل.
type ConflictsPairJSON struct {
	Kind           string            `json:"kind"`
	EntityID       int64             `json:"entityId"`
	EntityName     string            `json:"entityName"`
	DayOfWeek      int               `json:"dayOfWeek"`
	DayName        string            `json:"dayName"`
	A              ConflictsSlotJSON `json:"a"`
	B              ConflictsSlotJSON `json:"b"`
	OverlapMinutes int               `json:"overlapMinutes"`
	OverlapFrom    int               `json:"overlapFrom"`
	OverlapTo      int               `json:"overlapTo"`
	LikelyMerged   bool              `json:"likelyMerged"`
	Fingerprint    string            `json:"fingerprint"`
}

// ConflictsEntityJSON موجودیت درگیر.
type ConflictsEntityJSON struct {
	Kind string `json:"kind"`
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// ConflictsGroupJSON یک «مسئله».
type ConflictsGroupJSON struct {
	Key            string                `json:"key"`
	Kind           string                `json:"kind"`
	Kinds          []string              `json:"kinds"`
	Entities       []ConflictsEntityJSON `json:"entities"`
	EntityName     string                `json:"entityName"`
	DayOfWeek      int                   `json:"dayOfWeek"`
	DayName        string                `json:"dayName"`
	WindowFrom     int                   `json:"windowFrom"`
	WindowTo       int                   `json:"windowTo"`
	OverlapMinutes int                   `json:"overlapMinutes"`
	OverlapFrom    int                   `json:"overlapFrom"`
	OverlapTo      int                   `json:"overlapTo"`
	Slots          []ConflictsSlotJSON   `json:"slots"`
	Pairs          []ConflictsPairJSON   `json:"pairs"`
	LikelyMerged   bool                  `json:"likelyMerged"`
	Students       int                   `json:"students"`
	Reviewed       bool                  `json:"reviewed"`
}

// ConflictsSummaryJSON خلاصهٔ بالای صفحه.
type ConflictsSummaryJSON struct {
	Professor           int `json:"professor"`
	Room                int `json:"room"`
	ProfessorEntities   int `json:"professorEntities"`
	RoomEntities        int `json:"roomEntities"`
	StudentsAtRisk      int `json:"studentsAtRisk"`
	WorstOverlapMinutes int `json:"worstOverlapMinutes"`
}

func lpSlotJSON(s scheduleconflicts.ConflictSlot) ConflictsSlotJSON {
	return ConflictsSlotJSON{
		ScheduleID: s.ScheduleID, OfferingID: s.OfferingID, DayOfWeek: s.DayOfWeek,
		StartTime: s.StartTime, EndTime: s.EndTime, RoomID: s.RoomID, RoomName: s.RoomName,
		ProfessorID: s.ProfessorID, ProfessorName: s.ProfessorName,
		CourseCode: s.CourseCode, CourseTitle: s.CourseTitle,
		GroupNumber: s.GroupNumber, EnrolledCount: s.EnrolledCount,
		SharedScheduleGroupKey: s.SharedScheduleGroupKey,
	}
}

func lpPairJSON(p scheduleconflicts.ConflictPair) ConflictsPairJSON {
	return ConflictsPairJSON{
		Kind: p.Kind, EntityID: p.EntityID, EntityName: p.EntityName,
		DayOfWeek: p.DayOfWeek, DayName: p.DayName,
		A: lpSlotJSON(p.A), B: lpSlotJSON(p.B),
		OverlapMinutes: p.OverlapMinutes, OverlapFrom: p.OverlapFrom, OverlapTo: p.OverlapTo,
		LikelyMerged: p.LikelyMerged, Fingerprint: p.Fingerprint,
	}
}

// LoadScheduleConflicts پورت loadScheduleConflicts — خواندن از DB + هستهٔ تشخیص.
func (s *Service) LoadScheduleConflicts(ctx context.Context, user *session.User, uniCookie string, termID int64) (*ConflictsReportData, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil || *uniID <= 0 {
		return nil, errors.New("دانشگاه فعال مشخص نیست.")
	}
	if termID <= 0 {
		return nil, errors.New("ترم نامعتبر است.")
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select s.id, s."offeringId", s."dayOfWeek",
		       to_char(s."startTime", 'HH24:MI'), to_char(s."endTime", 'HH24:MI'),
		       s."roomId", cr.name, o."professorId",
		       nullif(trim(coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",'')), ''),
		       c.code, c.title, coalesce(o."groupNumber",1), coalesce(o."enrolledCount",0),
		       o."sharedScheduleGroupKey"
		  from schedules s
		  join course_offerings o on o.id = s."offeringId"
		  join courses c on c.id = o."courseId"
		  left join classrooms cr on cr.id = s."roomId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		 where o."termId" = $1 and s."scheduleType" = 'CLASS' and s."dayOfWeek" is not null
		   and o."isActive" = 1 and o."universityId" = $2`, termID, *uniID)
	if err != nil {
		return nil, err
	}
	slots := []scheduleconflicts.ConflictSlot{}
	for rows.Next() {
		var sl scheduleconflicts.ConflictSlot
		var start, end string
		if rows.Scan(&sl.ScheduleID, &sl.OfferingID, &sl.DayOfWeek, &start, &end, &sl.RoomID, &sl.RoomName,
			&sl.ProfessorID, &sl.ProfessorName, &sl.CourseCode, &sl.CourseTitle, &sl.GroupNumber,
			&sl.EnrolledCount, &sl.SharedScheduleGroupKey) == nil {
			sl.StartTime = start
			sl.EndTime = end
			slots = append(slots, sl)
		}
	}
	rows.Close()

	scan := scheduleconflicts.DetectScheduleConflicts(slots)

	reviewed := map[string]ConflictsReviewRow{}
	if rrows, err := s.DB.Pool.Query(ctx, `
		select r."fingerprint", r.status, r."reasonCode", r."reasonText",
		       nullif(trim(coalesce(ru."firstName",'') || ' ' || coalesce(ru."lastName",'')), ''),
		       to_char(r."reviewedAt", 'YYYY-MM-DD HH24:MI')
		  from schedule_conflict_reviews r
		  left join users ru on ru.id = r."reviewedByUserId"
		 where r."termId" = $1`, termID); err == nil {
		for rrows.Next() {
			var row ConflictsReviewRow
			var fp string
			if rrows.Scan(&fp, &row.Status, &row.ReasonCode, &row.ReasonText, &row.ReviewedByName, &row.ReviewedAt) == nil && fp != "" {
				row.Fingerprint = fp
				reviewed[fp] = row
			}
		}
		rrows.Close()
	}

	isReviewed := func(p scheduleconflicts.ConflictPair) bool {
		_, ok := reviewed[p.Fingerprint]
		return ok
	}
	coreGroups := scheduleconflicts.GroupConflictPairs(scan.Pairs, isReviewed)

	pairsJSON := make([]ConflictsPairJSON, 0, len(scan.Pairs))
	for _, p := range scan.Pairs {
		pairsJSON = append(pairsJSON, lpPairJSON(p))
	}
	groupsJSON := make([]ConflictsGroupJSON, 0, len(coreGroups))
	openIssues := 0
	likely := 0
	for _, g := range coreGroups {
		gj := ConflictsGroupJSON{
			Key: g.Key, Kind: g.Kind, Kinds: g.Kinds,
			Entities:   make([]ConflictsEntityJSON, 0, len(g.Entities)),
			EntityName: g.EntityName, DayOfWeek: g.DayOfWeek, DayName: g.DayName,
			WindowFrom: g.WindowFrom, WindowTo: g.WindowTo,
			OverlapMinutes: g.OverlapMinutes, OverlapFrom: g.OverlapFrom, OverlapTo: g.OverlapTo,
			Slots:        make([]ConflictsSlotJSON, 0, len(g.Slots)),
			Pairs:        make([]ConflictsPairJSON, 0, len(g.Pairs)),
			LikelyMerged: g.LikelyMerged, Students: g.Students, Reviewed: g.Reviewed,
		}
		for _, e := range g.Entities {
			gj.Entities = append(gj.Entities, ConflictsEntityJSON{Kind: e.Kind, ID: e.ID, Name: e.Name})
		}
		for _, sl := range g.Slots {
			gj.Slots = append(gj.Slots, lpSlotJSON(sl))
		}
		for _, p := range g.Pairs {
			gj.Pairs = append(gj.Pairs, lpPairJSON(p))
		}
		if !g.Reviewed {
			openIssues++
			if g.LikelyMerged {
				likely++
			}
		}
		groupsJSON = append(groupsJSON, gj)
	}
	sum := scheduleconflicts.SummarizeConflicts(scan.Pairs)

	return &ConflictsReportData{
		TermID: termID,
		Pairs:  pairsJSON, Groups: groupsJSON, Reviewed: reviewed,
		Summary: ConflictsSummaryJSON{
			Professor: sum.Professor, Room: sum.Room,
			ProfessorEntities: sum.ProfessorEntities, RoomEntities: sum.RoomEntities,
			StudentsAtRisk: sum.StudentsAtRisk, WorstOverlapMinutes: sum.WorstOverlapMinutes,
		},
		RawOverlaps: scan.RawOverlaps, MergedSkipped: scan.MergedSkipped,
		SlotsScanned: scan.SlotsScanned, DuplicateSlots: scan.DuplicateSlots,
		ReviewedCount: len(reviewed), OpenIssues: openIssues,
		TotalIssues: len(groupsJSON), LikelyMergedIssues: likely,
	}, nil
}

// ListTermsForConflicts پورت listTermsForConflicts — جدیدترین اول.
func (s *Service) ListTermsForConflicts(ctx context.Context, user *session.User, uniCookie string) ([]LPIdName, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	out := []LPIdName{}
	if uniID == nil || *uniID <= 0 {
		return out, nil
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, coalesce(title, "termCode") from academic_terms
		 where "universityId" = $1 order by "termCode" desc limit 40`, *uniID)
	if err != nil {
		return out, nil
	}
	defer rows.Close()
	for rows.Next() {
		var r LPIdName
		if rows.Scan(&r.ID, &r.Name) == nil {
			out = append(out, r)
		}
	}
	return out, nil
}

// ConflictsMarkInput ورودی «بررسی شد» تک‌جفتی.
type ConflictsMarkInput struct {
	TermID      int64  `json:"termId"`
	Fingerprint string `json:"fingerprint"`
	Kind        string `json:"kind"`
	EntityID    int64  `json:"entityId"`
	DayOfWeek   int    `json:"dayOfWeek"`
	ScheduleAID int64  `json:"scheduleAId"`
	ScheduleBID int64  `json:"scheduleBId"`
	ReasonCode  string `json:"reasonCode"`
	ReasonText  string `json:"reasonText"`
}

// MarkConflictReviewed پورت markConflictReviewedAction — پذیرش یک جفت با دلیل.
func (s *Service) MarkConflictReviewed(ctx context.Context, user *session.User, uniCookie string, in ConflictsMarkInput) (string, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil || *uniID <= 0 {
		return "", errors.New("دانشگاه فعال مشخص نیست.")
	}
	if in.TermID <= 0 {
		return "", errors.New("ترم نامعتبر است.")
	}
	fp := strings.TrimSpace(in.Fingerprint)
	if fp == "" {
		return "", errors.New("اثرانگشتِ تداخل نامعتبر است.")
	}
	if in.Kind != "PROFESSOR" && in.Kind != "ROOM" {
		return "", errors.New("نوع تداخل نامعتبر است.")
	}
	reasonCode := in.ReasonCode
	valid := false
	for _, c := range scheduleconflicts.ConflictReasonCodes {
		if c == reasonCode {
			valid = true
		}
	}
	if !valid {
		reasonCode = "OTHER"
	}
	var reasonText *string
	if t := strings.TrimSpace(in.ReasonText); t != "" {
		v := truncStr(t, 500)
		reasonText = &v
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		insert into schedule_conflict_reviews
		  ("termId","universityId","kind","entityId","dayOfWeek","scheduleAId","scheduleBId",
		   "fingerprint","status","reasonCode","reasonText","reviewedByUserId","reviewedAt","updatedAt")
		values ($1,$2,$3,$4,$5,$6,$7,$8,'REVIEWED',$9,$10,$11,now(),now())
		on conflict ("termId","fingerprint") do update set
		  "status" = 'REVIEWED', "reasonCode" = excluded."reasonCode",
		  "reasonText" = excluded."reasonText", "reviewedByUserId" = excluded."reviewedByUserId",
		  "reviewedAt" = now(), "updatedAt" = now()`,
		in.TermID, *uniID, in.Kind, in.EntityID, in.DayOfWeek, in.ScheduleAID, in.ScheduleBID,
		fp, reasonCode, reasonText, user.ID); err != nil {
		return "", err
	}
	details, _ := json.Marshal(map[string]any{"fingerprint": fp, "kind": in.Kind, "reasonCode": reasonCode})
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "SCHEDULE_CONFLICT_REVIEWED", "schedule_conflict", in.TermID, string(details)); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return "بررسی شد.", nil
}

// ConflictsGroupReviewItem یک جفت برای ثبت گروهی.
type ConflictsGroupReviewItem struct {
	Fingerprint string `json:"fingerprint"`
	Kind        string `json:"kind"`
	EntityID    int64  `json:"entityId"`
	DayOfWeek   int    `json:"dayOfWeek"`
	ScheduleAID int64  `json:"scheduleAId"`
	ScheduleBID int64  `json:"scheduleBId"`
}

// MarkConflictGroupReviewed پورت markConflictGroupReviewedAction — پذیرش کلِ یک مسئله.
func (s *Service) MarkConflictGroupReviewed(ctx context.Context, user *session.User, uniCookie string, termID int64, reasonCode, reasonText string, items []ConflictsGroupReviewItem) (string, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil || *uniID <= 0 {
		return "", errors.New("دانشگاه فعال مشخص نیست.")
	}
	if termID <= 0 {
		return "", errors.New("ترم نامعتبر است.")
	}
	clean := []ConflictsGroupReviewItem{}
	for _, it := range items {
		if strings.TrimSpace(it.Fingerprint) == "" || (it.Kind != "PROFESSOR" && it.Kind != "ROOM") {
			continue
		}
		clean = append(clean, it)
	}
	if len(clean) == 0 {
		return "", errors.New("موردی برای ثبت وجود ندارد.")
	}
	rc := reasonCode
	valid := false
	for _, c := range scheduleconflicts.ConflictReasonCodes {
		if c == rc {
			valid = true
		}
	}
	if !valid {
		rc = "OTHER"
	}
	var rt *string
	if t := strings.TrimSpace(reasonText); t != "" {
		v := truncStr(t, 500)
		rt = &v
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	for _, it := range clean {
		if _, err := tx.Exec(ctx, `
			insert into schedule_conflict_reviews
			  ("termId","universityId","kind","entityId","dayOfWeek","scheduleAId","scheduleBId",
			   "fingerprint","status","reasonCode","reasonText","reviewedByUserId","reviewedAt","updatedAt")
			values ($1,$2,$3,$4,$5,$6,$7,$8,'REVIEWED',$9,$10,$11,now(),now())
			on conflict ("termId","fingerprint") do update set
			  "status" = 'REVIEWED', "reasonCode" = excluded."reasonCode",
			  "reasonText" = excluded."reasonText", "reviewedByUserId" = excluded."reviewedByUserId",
			  "reviewedAt" = now(), "updatedAt" = now()`,
			termID, *uniID, it.Kind, it.EntityID, it.DayOfWeek, it.ScheduleAID, it.ScheduleBID,
			strings.TrimSpace(it.Fingerprint), rc, rt, user.ID); err != nil {
			return "", err
		}
	}
	fps := make([]string, 0, len(clean))
	for _, it := range clean {
		fps = append(fps, strings.TrimSpace(it.Fingerprint))
	}
	details, _ := json.Marshal(map[string]any{"count": len(clean), "reasonCode": rc, "fingerprints": fps})
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "SCHEDULE_CONFLICT_GROUP_REVIEWED", "schedule_conflict", termID, string(details)); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return fmt.Sprintf("%d جفت تداخل پذیرفته شد.", len(clean)), nil
}

// UndoConflictReview پورت undoConflictReviewAction — لغو پذیرش یک جفت.
func (s *Service) UndoConflictReview(ctx context.Context, user *session.User, uniCookie string, termID int64, fingerprint string) (string, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil || *uniID <= 0 {
		return "", errors.New("دانشگاه فعال مشخص نیست.")
	}
	fp := strings.TrimSpace(fingerprint)
	if termID <= 0 || fp == "" {
		return "", errors.New("ورودی نامعتبر است.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from schedule_conflict_reviews where "termId" = $1 and "fingerprint" = $2`, termID, fp); err != nil {
		return "", err
	}
	details, _ := json.Marshal(map[string]any{"fingerprint": fp})
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "SCHEDULE_CONFLICT_REVIEW_UNDO", "schedule_conflict", termID, string(details)); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return "به فهرستِ باز برگشت.", nil
}

// UndoConflictGroup پورت undoConflictGroupAction — بازگرداندن همهٔ جفت‌های یک مسئله.
func (s *Service) UndoConflictGroup(ctx context.Context, user *session.User, uniCookie string, termID int64, fingerprints []string) (string, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil || *uniID <= 0 {
		return "", errors.New("دانشگاه فعال مشخص نیست.")
	}
	seen := map[string]bool{}
	fps := []string{}
	for _, f := range fingerprints {
		f = strings.TrimSpace(f)
		if f != "" && !seen[f] {
			seen[f] = true
			fps = append(fps, f)
		}
	}
	if termID <= 0 || len(fps) == 0 {
		return "", errors.New("ورودی نامعتبر است.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from schedule_conflict_reviews where "termId" = $1 and "fingerprint" = any($2::text[])`, termID, fps); err != nil {
		return "", err
	}
	details, _ := json.Marshal(map[string]any{"count": len(fps), "fingerprints": fps})
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "SCHEDULE_CONFLICT_GROUP_REVIEW_UNDO", "schedule_conflict", termID, string(details)); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return fmt.Sprintf("%d جفت به فهرستِ باز برگشت.", len(fps)), nil
}

// MarkOfferingsMerged پورت markOfferingsMergedAction — کلید ادغام MC- برای جفت/گروه.
func (s *Service) MarkOfferingsMerged(ctx context.Context, user *session.User, uniCookie string, termID int64, offeringIDs []int64) (string, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil || *uniID <= 0 {
		return "", errors.New("دانشگاه فعال مشخص نیست.")
	}
	if termID <= 0 {
		return "", errors.New("ترم نامعتبر است.")
	}
	ids := lpDedupeIDs(offeringIDs)
	if len(ids) < 2 {
		return "", errors.New("حداقل دو کلاس برای ادغام لازم است.")
	}
	if n, err := s.lpCountOfferingsInTerm(ctx, ids, termID, *uniID); err != nil || n != len(ids) {
		return "", errors.New("یکی از کلاس‌ها یافت نشد یا به این ترم/دانشگاه تعلق ندارد.")
	}
	minID := ids[0]
	for _, id := range ids {
		if id < minID {
			minID = id
		}
	}
	key := fmt.Sprintf("MC-%d-%d", termID, minID)
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		update course_offerings set "sharedScheduleGroupKey" = $3
		 where id = any($1::int[]) and "termId" = $2`, ids, termID, key); err != nil {
		return "", err
	}
	details, _ := json.Marshal(map[string]any{"offeringIds": ids, "termId": termID, "key": key})
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "SCHEDULE_CONFLICT_MERGED", "course_offering", minID, string(details)); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return fmt.Sprintf("%d کلاس با کلید «%s» ادغام شد.", len(ids), key), nil
}

// MarkOfferingsMergedBulk پورت markOfferingsMergedBulkAction — ادغام گروهی مسائل.
func (s *Service) MarkOfferingsMergedBulk(ctx context.Context, user *session.User, uniCookie string, termID int64, groups [][]int64) (string, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil || *uniID <= 0 {
		return "", errors.New("دانشگاه فعال مشخص نیست.")
	}
	if termID <= 0 {
		return "", errors.New("ترم نامعتبر است.")
	}
	cleaned := [][]int64{}
	seenGroup := map[string]bool{}
	for _, g := range groups {
		ids := lpDedupeIDs(g)
		if len(ids) < 2 {
			continue
		}
		k := fmt.Sprint(ids)
		if seenGroup[k] {
			continue
		}
		seenGroup[k] = true
		cleaned = append(cleaned, ids)
	}
	if len(cleaned) == 0 {
		return "", errors.New("گروهِ قابل ادغامی ارسال نشد.")
	}
	all := map[int64]bool{}
	for _, g := range cleaned {
		for _, id := range g {
			all[id] = true
		}
	}
	allIDs := make([]int64, 0, len(all))
	for id := range all {
		allIDs = append(allIDs, id)
	}
	sort.Slice(allIDs, func(i, j int) bool { return allIDs[i] < allIDs[j] })
	if n, err := s.lpCountOfferingsInTerm(ctx, allIDs, termID, *uniID); err != nil || n != len(allIDs) {
		return "", errors.New("برخی کلاس‌ها یافت نشد یا به این ترم/دانشگاه تعلق ندارند.")
	}
	keys := []string{}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	for _, ids := range cleaned {
		minID := ids[0]
		for _, id := range ids {
			if id < minID {
				minID = id
			}
		}
		key := fmt.Sprintf("MC-%d-%d", termID, minID)
		keys = append(keys, key)
		if _, err := tx.Exec(ctx, `
			update course_offerings set "sharedScheduleGroupKey" = $3
			 where id = any($1::int[]) and "termId" = $2`, ids, termID, key); err != nil {
			return "", err
		}
	}
	details, _ := json.Marshal(map[string]any{"termId": termID, "groups": cleaned, "keys": keys})
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "SCHEDULE_CONFLICT_MERGED_BULK", "course_offering", termID, string(details)); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return fmt.Sprintf("%d مسئله (%d کلاس) ادغام شد.", len(cleaned), len(allIDs)), nil
}

func lpDedupeIDs(in []int64) []int64 {
	seen := map[int64]bool{}
	out := []int64{}
	for _, v := range in {
		if v > 0 && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

func (s *Service) lpCountOfferingsInTerm(ctx context.Context, ids []int64, termID, uniID int64) (int, error) {
	var n int
	err := s.DB.Pool.QueryRow(ctx, `
		select count(*) from course_offerings
		 where id = any($1::int[]) and "termId" = $2 and "universityId" = $3`, ids, termID, uniID).Scan(&n)
	return n, err
}

// pgxQuerier رابط مشترک استخر برای helpers (فقط QueryRow لازم است).
type pgxQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}
