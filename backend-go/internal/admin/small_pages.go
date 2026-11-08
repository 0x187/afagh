// ═══ Small admin pages — port of 4 missing reference pages ═══
//
// Sections (the other two pages of the batch already have backend engines):
//   • /admin/terms            — admin/terms page.tsx + actions.ts (list all universities'
//     terms, single/bulk activate, sync-with-date)
//   • /admin/grades/audit     — grades audit page.tsx + admin/grades actions reviewUnfinalizeAction
//   • finance statement approval badge for /admin/finance/student/[id]
//   • /admin/compliance-policy — compliance-policy lib (catalog + legal defaults + layered
//     resolver) + compliance-policy-server (overrides CRUD + 1402 graduate seed)
//
// Saham settings and the student-card print page already have complete Go ports
// (internal/admin/saham.go SahamSettingsBundle and internal/admin/student_cards.go).
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"backend-go/internal/messaging"
	"backend-go/internal/scope"
	"backend-go/internal/session"
)

// ════════════════════════════════════════════════════════════════════════════
//  /admin/terms — port of admin/terms/page.tsx + actions.ts
// ════════════════════════════════════════════════════════════════════════════

// SmallTermRow is one academic_terms row with the containsToday flag computed
// server-side from startDate/endDate (port of termContainsToday).
type SmallTermRow struct {
	ID            int64      `json:"id"`
	UniversityID  *int64     `json:"universityId"`
	TermCode      string     `json:"termCode"`
	Title         string     `json:"title"`
	TermType      *string    `json:"termType"`
	AcademicYear  *int       `json:"academicYear"`
	StartDate     *time.Time `json:"startDate"`
	EndDate       *time.Time `json:"endDate"`
	IsCurrent     bool       `json:"isCurrent"`
	ContainsToday bool       `json:"containsToday"`
}

// SmallUniversity is a minimal university row (code+title for grouping).
type SmallUniversity struct {
	ID    int64  `json:"id"`
	Code  string `json:"code"`
	Title string `json:"title"`
}

// TermsAdminBundle is the /admin/terms page response.
type TermsAdminBundle struct {
	Today           string            `json:"today"`
	Universities    []SmallUniversity `json:"universities"`
	Terms           []SmallTermRow    `json:"terms"`
	ActiveCount     int               `json:"activeCount"`
	ContainingCount int               `json:"containingCount"`
}

// SmallTermsBundle lists every term of every university (not just the active
// one) with the chronological order of sortTermsChronologically.
func (s *Service) SmallTermsBundle(ctx context.Context) (*TermsAdminBundle, error) {
	out := &TermsAdminBundle{Terms: []SmallTermRow{}, Universities: []SmallUniversity{}}

	ur, err := s.DB.Pool.Query(ctx, `select id, code, title from universities order by code`)
	if err != nil {
		return nil, err
	}
	for ur.Next() {
		var u SmallUniversity
		if err := ur.Scan(&u.ID, &u.Code, &u.Title); err == nil {
			out.Universities = append(out.Universities, u)
		}
	}
	ur.Close()

	tr, err := s.DB.Pool.Query(ctx, `
		select id, "universityId", "termCode", title, "termType", "academicYear",
		       "startDate", "endDate", "isCurrent"
		  from academic_terms order by id desc`)
	if err != nil {
		return nil, err
	}
	defer tr.Close()
	scoped := []scope.TermScope{}
	uniByID := map[int64]*int64{}
	for tr.Next() {
		var (
			id                       int64
			uniID                    *int64
			code, title              string
			termType                 *string
			academicYear             *int
			startDate, endDate       *time.Time
			isCurrent                int
		)
		if err := tr.Scan(&id, &uniID, &code, &title, &termType, &academicYear, &startDate, &endDate, &isCurrent); err != nil {
			continue
		}
		uniByID[id] = uniID
		scoped = append(scoped, scope.TermScope{
			ID: id, TermCode: code, Title: title,
			StartDate: startDate, EndDate: endDate,
			IsCurrent: isCurrent == 1, TermType: termType, AcademicYear: academicYear,
		})
	}
	ordered := scope.SortTermsChronologically(scoped)
	today := time.Now()
	for _, t := range ordered {
		row := SmallTermRow{
			ID: t.ID, UniversityID: uniByID[t.ID], TermCode: t.TermCode, Title: t.Title,
			TermType: t.TermType, AcademicYear: t.AcademicYear,
			StartDate: t.StartDate, EndDate: t.EndDate, IsCurrent: t.IsCurrent,
			ContainsToday: scope.TermContainsToday(t, today),
		}
		if row.IsCurrent {
			out.ActiveCount++
		}
		if row.ContainsToday {
			out.ContainingCount++
		}
		out.Terms = append(out.Terms, row)
	}
	out.Today = today.UTC().Format(time.RFC3339)
	return out, nil
}

// smallTermActivationResult is the shared result of the activation actions
// (shape-compatible with TermActivationResult of the reference).
type smallTermActivationResult struct {
	OK        bool     `json:"ok"`
	Message   string   `json:"message,omitempty"`
	Error     string   `json:"error,omitempty"`
	Activated int      `json:"activated"`
	Cleared   int      `json:"cleared"`
	Missing   []string `json:"missing"`
}

// smallApplyActivation ports applyActivation — for every (university, term)
// pick: zero the current flag of the other terms of that university, then set
// the pick. One transaction, one rule: max one active term per university.
func (s *Service) smallApplyActivation(ctx context.Context, picks map[int64]int64) (activated, cleared int, err error) {
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for uniID, termID := range picks {
		ct, err := tx.Exec(ctx, `
			update academic_terms set "isCurrent" = 0
			 where "universityId" = $1 and id <> $2 and "isCurrent" = 1`, uniID, termID)
		if err != nil {
			return 0, 0, err
		}
		cleared += int(ct.RowsAffected())

		st, err := tx.Exec(ctx, `
			update academic_terms set "isCurrent" = 1
			 where id = $1 and "universityId" = $2`, termID, uniID)
		if err != nil {
			return 0, 0, err
		}
		activated += int(st.RowsAffected())
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return activated, cleared, nil
}

// SmallTermActivate ports activateTermAction — single activation with the same
// Persian messages and validations.
func (s *Service) SmallTermActivate(ctx context.Context, termID int64) (*smallTermActivationResult, error) {
	res := &smallTermActivationResult{Missing: []string{}}
	if termID <= 0 {
		res.OK, res.Error = false, "شناسهٔ نیمسال نامعتبر است"
		return res, nil
	}
	var (
		uniID    *int64
		code     string
		isCurrent int
	)
	err := s.DB.Pool.QueryRow(ctx, `
		select "universityId", "termCode", "isCurrent" from academic_terms where id = $1`, termID).
		Scan(&uniID, &code, &isCurrent)
	if err != nil {
		res.OK, res.Error = false, "نیمسال یافت نشد"
		return res, nil
	}
	if uniID == nil {
		res.OK, res.Error = false, "این نیمسال به دانشگاهی وصل نیست و قابل فعال‌سازی نیست"
		return res, nil
	}
	if isCurrent == 1 {
		res.OK, res.Message = true, fmt.Sprintf("نیمسال %s از قبل فعال است", code)
		return res, nil
	}
	activated, cleared, err := s.smallApplyActivation(ctx, map[int64]int64{*uniID: termID})
	if err != nil {
		return nil, errors.New("خطا در فعال‌سازی نیمسال")
	}
	res.OK, res.Activated, res.Cleared = true, activated, cleared
	res.Message = fmt.Sprintf("نیمسال %s فعال شد و پرچم فعالِ سایر نیمسال‌های این دانشگاه صفر شد", code)
	return res, nil
}

// SmallTermsBulkActivate ports bulkActivateTermsAction — one pick per
// university; unknown/mismatched picks are reported in Missing.
func (s *Service) SmallTermsBulkActivate(ctx context.Context, picks [][2]int64) (*smallTermActivationResult, error) {
	res := &smallTermActivationResult{Missing: []string{}}
	// Clean + dedupe by university (last pick wins) — same as the reference map.
	byUniversity := map[int64]int64{}
	for _, p := range picks {
		if p[0] > 0 && p[1] > 0 {
			byUniversity[p[0]] = p[1]
		}
	}
	if len(byUniversity) == 0 {
		res.OK, res.Error = false, "هیچ نیمسالی برای فعال‌سازی انتخاب نشده است"
		return res, nil
	}

	type termRef struct {
		uni *int64
		code string
	}
	rows := map[int64]termRef{}
	ids := make([]int64, 0, len(byUniversity))
	for _, termID := range byUniversity {
		ids = append(ids, termID)
	}
	for _, id := range ids {
		var uniID *int64
		var code string
		if err := s.DB.Pool.QueryRow(ctx, `select "universityId", "termCode" from academic_terms where id = $1`, id).
			Scan(&uniID, &code); err == nil {
			rows[id] = termRef{uni: uniID, code: code}
		}
	}
	uniName := map[int64]string{}
	ur, err := s.DB.Pool.Query(ctx, `select id, code, title from universities`)
	if err == nil {
		for ur.Next() {
			var id int64
			var code, title string
			if ur.Scan(&id, &code, &title) == nil {
				uniName[id] = fmt.Sprintf("%s (%s)", title, code)
			}
		}
		ur.Close()
	}
	label := func(id int64) string {
		if n, ok := uniName[id]; ok {
			return n
		}
		return fmt.Sprintf("دانشگاه %d", id)
	}

	valid := map[int64]int64{}
	for uniID, termID := range byUniversity {
		if r, ok := rows[termID]; !ok || r.uni == nil || *r.uni != uniID {
			res.Missing = append(res.Missing, fmt.Sprintf("نیمسال با شناسهٔ %d برای %s پیدا نشد", termID, label(uniID)))
			continue
		}
		valid[uniID] = termID
	}
	if len(valid) == 0 {
		res.OK, res.Error = false, "هیچ‌کدام از نیمسال‌های انتخابی معتبر نبود"
		return res, nil
	}

	activated, cleared, err := s.smallApplyActivation(ctx, valid)
	if err != nil {
		return nil, errors.New("خطا در فعال‌سازی گروهی")
	}
	codes := make([]string, 0, len(valid))
	for _, termID := range valid {
		if r, ok := rows[termID]; ok {
			codes = append(codes, r.code)
		}
	}
	missingNote := ""
	if len(res.Missing) > 0 {
		missingNote = fmt.Sprintf(" — %d مورد نادیده گرفته شد", len(res.Missing))
	}
	res.OK, res.Activated, res.Cleared = true, activated, cleared
	res.Message = fmt.Sprintf("فعال‌سازی گروهی برای %d دانشگاه انجام شد — نیمسال‌های فعال: %s%s",
		len(valid), strings.Join(codes, "، "), missingNote)
	return res, nil
}

// TermSyncEntry is one university line of the sync report.
type TermSyncEntry struct {
	University string `json:"university"`
	TermCode   string `json:"termCode"`
	TermID     int64  `json:"termId"`
}

// TermsSyncResult is the sync-with-date report.
type TermsSyncResult struct {
	OK           bool            `json:"ok"`
	Error        string          `json:"error,omitempty"`
	Message      string          `json:"message,omitempty"`
	Activated    []TermSyncEntry `json:"activated"`
	Unchanged    []TermSyncEntry `json:"unchanged"`
	NoContaining []string        `json:"noContaining"`
	Cleared      int             `json:"cleared"`
}

// SmallTermsSyncWithDate ports syncTermsWithDateAction — for each university,
// activate the term whose date range contains today; universities without such
// a term are explicitly reported and left untouched.
func (s *Service) SmallTermsSyncWithDate(ctx context.Context) (*TermsSyncResult, error) {
	out := &TermsSyncResult{
		Activated: []TermSyncEntry{}, Unchanged: []TermSyncEntry{}, NoContaining: []string{},
	}
	today := time.Now()

	type syncTerm struct {
		id        int64
		uniID     *int64
		code      string
		startDate *time.Time
		endDate   *time.Time
		isCurrent bool
	}
	tr, err := s.DB.Pool.Query(ctx, `
		select id, "universityId", "termCode", "startDate", "endDate", "isCurrent"
		  from academic_terms`)
	if err != nil {
		return nil, errors.New("خطا در همگام‌سازی با تاریخ")
	}
	defer tr.Close()
	all := []syncTerm{}
	for tr.Next() {
		var t syncTerm
		var isCurrent int
		if err := tr.Scan(&t.id, &t.uniID, &t.code, &t.startDate, &t.endDate, &isCurrent); err == nil {
			t.isCurrent = isCurrent == 1
			all = append(all, t)
		}
	}

	uniName := map[int64]string{}
	ur, err := s.DB.Pool.Query(ctx, `select id, code, title from universities`)
	if err == nil {
		for ur.Next() {
			var id int64
			var code, title string
			if ur.Scan(&id, &code, &title) == nil {
				uniName[id] = fmt.Sprintf("%s (%s)", title, code)
			}
		}
		ur.Close()
	}
	label := func(id int64) string {
		if n, ok := uniName[id]; ok {
			return n
		}
		return fmt.Sprintf("دانشگاه %d", id)
	}

	byUniversity := map[int64][]syncTerm{}
	for _, t := range all {
		if t.uniID == nil {
			continue
		}
		byUniversity[*t.uniID] = append(byUniversity[*t.uniID], t)
	}

	picks := map[int64]int64{}
	uniIDs := make([]int64, 0, len(uniName))
	for id := range uniName {
		uniIDs = append(uniIDs, id)
	}
	for id := range byUniversity {
		if _, seen := uniName[id]; !seen {
			uniIDs = append(uniIDs, id)
		}
	}
	for _, uniID := range uniIDs {
		list := byUniversity[uniID]
		// Winner = latest startDate among the terms containing today (id tiebreak).
		// termContainsToday guarantees every candidate has a startDate.
		var winner *syncTerm
		for i := range list {
			t := &list[i]
			if !scope.TermContainsToday(scope.TermScope{StartDate: t.startDate, EndDate: t.endDate}, today) {
				continue
			}
			if winner == nil || t.startDate.After(*winner.startDate) ||
				(t.startDate.Equal(*winner.startDate) && t.id > winner.id) {
				winner = t
			}
		}
		if winner == nil {
			reason := "هیچ نیمسالی بازهٔ تاریخ امروز را پوشش نمی‌دهد"
			if len(list) == 0 {
				reason = "هیچ نیمسالی ثبت نشده است"
			}
			out.NoContaining = append(out.NoContaining, fmt.Sprintf("%s — %s", label(uniID), reason))
			continue
		}
		staleOthers := false
		for _, t := range list {
			if t.isCurrent && t.id != winner.id {
				staleOthers = true
				break
			}
		}
		if winner.isCurrent && !staleOthers {
			out.Unchanged = append(out.Unchanged, TermSyncEntry{University: label(uniID), TermCode: winner.code, TermID: winner.id})
			continue
		}
		picks[uniID] = winner.id
		out.Activated = append(out.Activated, TermSyncEntry{University: label(uniID), TermCode: winner.code, TermID: winner.id})
	}

	if len(picks) > 0 {
		_, cleared, err := s.smallApplyActivation(ctx, picks)
		if err != nil {
			return nil, errors.New("خطا در همگام‌سازی با تاریخ")
		}
		out.Cleared = cleared
	}

	parts := []string{}
	if len(out.Activated) > 0 {
		parts = append(parts, fmt.Sprintf("%d دانشگاه: نیمسال شامل تاریخ امروز فعال شد", len(out.Activated)))
	}
	if len(out.Unchanged) > 0 {
		parts = append(parts, fmt.Sprintf("%d دانشگاه: از قبل مطابق تاریخ بود", len(out.Unchanged)))
	}
	if out.Cleared > 0 {
		parts = append(parts, fmt.Sprintf("%d پرچم فعالِ کهنه صفر شد", out.Cleared))
	}
	if len(out.NoContaining) > 0 {
		parts = append(parts, fmt.Sprintf("%d دانشگاه بدون نیمسالِ شامل امروز — دست نخورده ماند", len(out.NoContaining)))
	}
	if len(parts) == 0 {
		out.Message = "همهٔ نیمسال‌ها با تاریخ امروز هم‌خوان بود"
	} else {
		out.Message = strings.Join(parts, " — ")
	}
	out.OK = true
	return out, nil
}

// ════════════════════════════════════════════════════════════════════════════
//  /admin/grades/audit — port of grades/audit/page.tsx + reviewUnfinalizeAction
// ════════════════════════════════════════════════════════════════════════════

// GradesAuditPendingRow is one unfinalize request row.
type GradesAuditPendingRow struct {
	ID              int64   `json:"id"`
	OfferingID      int64   `json:"offeringId"`
	Reason          string  `json:"reason"`
	Status          string  `json:"status"`
	CreatedAt       *string `json:"createdAt"`
	CourseCode      *string `json:"courseCode"`
	CourseTitle     *string `json:"courseTitle"`
	TermCode        *string `json:"termCode"`
	RequesterFirst  *string `json:"requesterFirstName"`
	RequesterLast   *string `json:"requesterLastName"`
}

// GradesAuditLogRow is one grade_change_log row.
type GradesAuditLogRow struct {
	ID           int64   `json:"id"`
	StudentID    *int64  `json:"studentId"`
	StudentCode  *string `json:"studentCode"`
	Action       string  `json:"action"`
	OldGrade     *string `json:"oldGradeValue"`
	NewGrade     *string `json:"newGradeValue"`
	Reason       *string `json:"reason"`
	ActorUserID  *int64  `json:"actorUserId"`
	ActorRole    *string `json:"actorRole"`
	CreatedAt    *string `json:"createdAt"`
	ActorFirst   *string `json:"actorFirstName"`
	ActorLast    *string `json:"actorLastName"`
	CourseCode   *string `json:"courseCode"`
	CourseTitle  *string `json:"courseTitle"`
	TermCode     *string `json:"termCode"`
}

// GradesAuditBundle is the /admin/grades/audit page response.
type GradesAuditBundle struct {
	Pending  []GradesAuditPendingRow `json:"pending"`
	Rows     []GradesAuditLogRow     `json:"rows"`
	Page     int                     `json:"page"`
	PageSize int                     `json:"pageSize"`
	HasNext  bool                    `json:"hasNext"`
}

// SmallGradesAuditPageSize mirrors PAGE_SIZE = 50 of the reference.
const SmallGradesAuditPageSize = 50

// SmallGradesAudit ports the two page queries with the same university scoping
// (universityId match, or legacy NULL rows attributed through offering/student).
func (s *Service) SmallGradesAudit(ctx context.Context, uniID int64, page int) (*GradesAuditBundle, error) {
	out := &GradesAuditBundle{Pending: []GradesAuditPendingRow{}, Rows: []GradesAuditLogRow{}, PageSize: SmallGradesAuditPageSize}
	if page < 1 {
		page = 1
	}
	out.Page = page
	offset := (page - 1) * SmallGradesAuditPageSize

	pr, err := s.DB.Pool.Query(ctx, `
		select r.id, r."offeringId", r.reason, r.status, r."createdAt"::text,
		       c.code, c.title, t."termCode", u."firstName", u."lastName"
		  from grade_unfinalize_requests r
		  left join course_offerings o on o.id = r."offeringId"
		  left join courses c on c.id = o."courseId"
		  left join academic_terms t on t.id = o."termId"
		  left join users u on u.id = r."requestedByUserId"
		 where r."universityId" = $1
		    or (r."universityId" is null
		        and r."offeringId" in (select id from course_offerings where "universityId" = $1))
		 order by r."createdAt" desc
		 limit 50`, uniID)
	if err != nil {
		return nil, err
	}
	for pr.Next() {
		var row GradesAuditPendingRow
		if err := pr.Scan(&row.ID, &row.OfferingID, &row.Reason, &row.Status, &row.CreatedAt,
			&row.CourseCode, &row.CourseTitle, &row.TermCode, &row.RequesterFirst, &row.RequesterLast); err == nil {
			out.Pending = append(out.Pending, row)
		}
	}
	pr.Close()

	lr, err := s.DB.Pool.Query(ctx, `
		select g.id, g."studentId", st."studentCode", g.action, g."oldGradeValue", g."newGradeValue",
		       g.reason, g."actorUserId", g."actorRole", g."createdAt"::text,
		       u."firstName", u."lastName", c.code, c.title, t."termCode"
		  from grade_change_log g
		  left join users u on u.id = g."actorUserId"
		  left join students st on st.id = g."studentId"
		  left join course_offerings o on o.id = g."offeringId"
		  left join courses c on c.id = o."courseId"
		  left join academic_terms t on t.id = o."termId"
		 where g."universityId" = $1
		    or (g."universityId" is null
		        and (g."studentId" is null
		             or g."studentId" in (select id from students where "universityId" = $1)))
		 order by g."createdAt" desc
		 limit $2 offset $3`, uniID, SmallGradesAuditPageSize+1, offset)
	if err != nil {
		return nil, err
	}
	defer lr.Close()
	for lr.Next() {
		var row GradesAuditLogRow
		if err := lr.Scan(&row.ID, &row.StudentID, &row.StudentCode, &row.Action, &row.OldGrade, &row.NewGrade,
			&row.Reason, &row.ActorUserID, &row.ActorRole, &row.CreatedAt,
			&row.ActorFirst, &row.ActorLast, &row.CourseCode, &row.CourseTitle, &row.TermCode); err == nil {
			out.Rows = append(out.Rows, row)
		}
	}
	if len(out.Rows) > SmallGradesAuditPageSize {
		out.HasNext = true
		out.Rows = out.Rows[:SmallGradesAuditPageSize]
	}
	return out, nil
}

const smallUnfinalizeStaleError = "UNFINALIZE_STALE"

// SmallGradesUnfinalizeReview ports reviewUnfinalizeAction — the two-stage gate
// (stage 1: ADMIN/GRADUATEAFFAIRS, stage 2: VICE_EDU only), the step-up gate
// (checked via the HTTP layer; STEPUP_REQUIRED sentinel at the same point as
// the reference), university scoping of both the request and the offering, and
// on APPROVED: gradesFinalizedAt=NULL + gradesTemporaryAt=now (+ optional
// custom deadline) + UNFINALIZE bulk log + a fire-and-forget notification to
// the requesting professor.
func (s *Service) SmallGradesUnfinalizeReview(ctx context.Context, user *session.User, uniID int64, requestID int64, decision, note, extendTo string, stepUpOK bool, msg *messaging.Service) error {
	cleanNote := strings.TrimSpace(note)
	has := func(role string, roles []string) bool {
		for _, r := range roles {
			if r == role {
				return true
			}
		}
		return false
	}
	roles := user.Roles

	// ── Role gate by decision (same catch semantics as the reference) ──
	if decision == "REVIEWED" {
		if !has("ADMIN", roles) && !has("GRADUATEAFFAIRS", roles) {
			return errors.New("شما مجوز بررسی درخواست بازگشایی را ندارید.")
		}
	} else if decision == "APPROVED" || decision == "REJECTED" {
		if !has("ADMIN", roles) && !has("GRADUATEAFFAIRS", roles) && !has("VICE_EDU", roles) {
			return errors.New("شما مجوز بررسی درخواست بازگشایی را ندارید.")
		}
	} else {
		return errors.New("درخواست نامعتبر است.")
	}

	var (
		offeringID    int64
		reqUni        *int64
		reqStatus     string
		requestedBy   int64
	)
	err := s.DB.Pool.QueryRow(ctx, `
		select "offeringId", "universityId", status, "requestedByUserId"
		  from grade_unfinalize_requests where id = $1`, requestID).
		Scan(&offeringID, &reqUni, &reqStatus, &requestedBy)
	if err != nil {
		return errors.New("درخواست یافت نشد.")
	}

	// ── Exact stage gate ──
	switch reqStatus {
	case "PENDING":
		if decision == "APPROVED" {
			return errors.New("این درخواست هنوز مرحلهٔ اول را نگذرانده است؛ ابتدا بررسی مرحلهٔ اول لازم است.")
		}
		if !has("ADMIN", roles) && !has("GRADUATEAFFAIRS", roles) {
			return errors.New("بررسی مرحلهٔ اول فقط با مدیر یا کارشناس فارغ‌التحصیلان است.")
		}
	case "REVIEWED":
		// REVIEWED → APPROVED|REJECTED: exclusive to VICE_EDU.
		if !has("VICE_EDU", roles) {
			return errors.New("تأیید نهایی فقط با معاون آموزشی است.")
		}
	default:
		return errors.New("این درخواست قبلاً تعیین‌تکلیف شده است.")
	}

	// 🔐 Two-step verification — same contract as adminSetGradeAction.
	if !stepUpOK {
		return errors.New("STEPUP_REQUIRED")
	}

	// ── University scope of the request and the offering (fail-closed) ──
	if reqUni != nil && *reqUni != uniID {
		return errors.New("درخواست متعلق به دانشگاه دیگری است.")
	}
	var offUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from course_offerings where id = $1`, offeringID).
		Scan(&offUni); err != nil {
		return errors.New("ارائهٔ درخواست یافت نشد.")
	}
	if offUni != nil && *offUni != uniID {
		return errors.New("ارائه متعلق به دانشگاه دیگری است.")
	}
	offUniID := offUni

	if decision == "APPROVED" {
		// Optional custom grade deadline: only a real date within (now, now+60d)
		// is accepted; otherwise silently ignored (like the reference).
		var extDate *time.Time
		if t := strings.TrimSpace(extendTo); t != "" {
			if parsed, perr := time.Parse("2006-01-02", t); perr == nil {
				now := time.Now()
				if parsed.After(now) && parsed.Before(now.Add(60*24*time.Hour)) {
					extDate = &parsed
				}
			}
		}
		// Anti-TOCTOU: lock the row + re-check status inside the transaction and
		// keep the WHERE status='REVIEWED' guard verified through affected rows.
		tx, txErr := s.DB.Pool.Begin(ctx)
		if txErr != nil {
			return txErr
		}
		defer func() { _ = tx.Rollback(ctx) }()
		var lockedStatus string
		if err := tx.QueryRow(ctx, `select status from grade_unfinalize_requests where id = $1 for update`, requestID).
			Scan(&lockedStatus); err != nil {
			return err
		}
		if lockedStatus != "REVIEWED" {
			return errors.New(smallUnfinalizeStaleError)
		}
		ct, err := tx.Exec(ctx, `
			update grade_unfinalize_requests
			   set status = 'APPROVED', "reviewedByUserId" = $2, "reviewNote" = $3, "reviewedAt" = now()
			 where id = $1 and status = 'REVIEWED'`, requestID, user.ID, nullableString(cleanNote))
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return errors.New(smallUnfinalizeStaleError)
		}
		if extDate != nil {
			if offUniID != nil {
				_, err = tx.Exec(ctx, `
					update course_offerings
					   set "gradesFinalizedAt" = null, "gradesTemporaryAt" = now(), "customGradeDeadline" = $3
					 where id = $1 and "universityId" = $2`, offeringID, *offUniID, extDate)
			} else {
				_, err = tx.Exec(ctx, `
					update course_offerings
					   set "gradesFinalizedAt" = null, "gradesTemporaryAt" = now(), "customGradeDeadline" = $2
					 where id = $1`, offeringID, extDate)
			}
		} else {
			if offUniID != nil {
				_, err = tx.Exec(ctx, `
					update course_offerings
					   set "gradesFinalizedAt" = null, "gradesTemporaryAt" = now()
					 where id = $1 and "universityId" = $2`, offeringID, *offUniID)
			} else {
				_, err = tx.Exec(ctx, `
					update course_offerings
					   set "gradesFinalizedAt" = null, "gradesTemporaryAt" = now()
					 where id = $1`, offeringID)
			}
		}
		if err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		// UNFINALIZE bulk log for every enrollment of the offering (best effort).
		s.smallLogUnfinalize(ctx, offeringID, user.ID, cleanNote)
	} else {
		// REVIEWED or REJECTED at stage 1: just update the request row.
		if _, err := s.DB.Pool.Exec(ctx, `
			update grade_unfinalize_requests
			   set status = $2, "reviewedByUserId" = $3, "reviewNote" = $4, "reviewedAt" = now()
			 where id = $1`, requestID, decision, user.ID, nullableString(cleanNote)); err != nil {
			return err
		}
	}

	// Notify the requesting professor (fire-and-forget).
	if msg != nil {
		decisionFa := map[string]string{
			"APPROVED":  "تأیید نهایی شد ✅",
			"REVIEWED":  "مرحلهٔ اول تأیید شد و در انتظار معاون آموزشی است ⏳",
			"REJECTED":  "رد شد ❌",
		}[decision]
		text := fmt.Sprintf("📬 نتیجهٔ درخواست بازگشایی نمرات (ارائهٔ %d): %s", offeringID, decisionFa)
		if cleanNote != "" {
			text += fmt.Sprintf(" — توضیح: %s", cleanNote)
		}
		go msg.NotifyExternal(context.Background(), requestedBy, "GRADE_UNFINALIZE_DECIDED", text)
	}
	return nil
}

// smallLogUnfinalize ports logBulkGradeChange(..., 'UNFINALIZE') — one log row
// per enrollment of the offering; silent on failure like the reference.
func (s *Service) smallLogUnfinalize(ctx context.Context, offeringID, actorUserID int64, reason string) {
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "studentId", "gradeValue", "gradeStatus", "samaGradeStatusCode"
		  from enrollments where "offeringId" = $1`, offeringID)
	if err != nil {
		return
	}
	defer rows.Close()
	type enr struct {
		id, studentID int64
		grade         *string
		status        *string
		sama          *string
	}
	list := []enr{}
	for rows.Next() {
		var e enr
		if rows.Scan(&e.id, &e.studentID, &e.grade, &e.status, &e.sama) == nil {
			list = append(list, e)
		}
	}
	rows.Close()
	for _, e := range list {
		_, _ = s.DB.Pool.Exec(ctx, `
			insert into grade_change_log
			       ("enrollmentId","studentId","offeringId",action,
			        "oldGradeValue","newGradeValue","oldGradeStatus","newGradeStatus",
			        "oldSamaStatusCode","reason","actorUserId","actorRole")
			values ($1,$2,$3,'UNFINALIZE',$4,$4,$5,'TEMPORARY',$6,$7,$8,'ADMIN')`,
			e.id, e.studentID, offeringID, e.grade, e.status, e.sama,
			nullableString(reason), actorUserID)
	}
}

// nullableString maps an empty string to SQL NULL (bound parameter helper).
func nullableString(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// ════════════════════════════════════════════════════════════════════════════
//  Finance statement approval badge — port of getFinanceStatementApproval
// ════════════════════════════════════════════════════════════════════════════

// SmallFinanceStatementApproval is the APPROVED FINANCE_STATEMENT request of a
// student (enables the trusted print QR).
type SmallFinanceStatementApproval struct {
	RequestID    int64   `json:"requestId"`
	TrackingCode *string `json:"trackingCode"`
	ApprovedAt   *string `json:"approvedAt"`
}

// SmallFinanceStatementApproval finds the latest approved FINANCE_STATEMENT request.
func (s *Service) SmallFinanceStatementApproval(ctx context.Context, studentID int64) (*SmallFinanceStatementApproval, error) {
	if studentID <= 0 {
		return nil, nil
	}
	var out SmallFinanceStatementApproval
	err := s.DB.Pool.QueryRow(ctx, `
		select r.id, r."trackingCode", r."updatedAt"::text
		  from student_requests r
		  join process_definitions p on p.id = r."processId"
		 where r."studentId" = $1 and p.code = 'FINANCE_STATEMENT' and r.status = 'APPROVED'
		 order by r.id desc
		 limit 1`, studentID).Scan(&out.RequestID, &out.TrackingCode, &out.ApprovedAt)
	if err != nil {
		return nil, nil // no approval — the page shows the "without approval" badge
	}
	return &out, nil
}

// ════════════════════════════════════════════════════════════════════════════
//  /admin/compliance-policy — port of lib/compliance-policy(.ts|-server.ts)
// ════════════════════════════════════════════════════════════════════════════

// Compliance groups (identical labels to the reference).
const (
	complianceGroup1 = "گام ۱ · معدل، فراغت و پذیرش"
	complianceGroup2 = "گام ۲ · یکسانسازی پیکربندی"
	complianceGroup3 = "گام ۳ · سنوات، غیبت و اعتراض"
	complianceGroup4 = "گام ۴ · تحصیلات تکمیلی"
	complianceGroup5 = "گام ۵ · معادلسازی (مادهٔ ۱۲)"
)

var complianceGroups = []string{complianceGroup1, complianceGroup2, complianceGroup3, complianceGroup4, complianceGroup5}

// CompliancePolicyDef is one entry of the policy catalog (PolicyDef of the TS).
type CompliancePolicyDef struct {
	Key      string    `json:"key"`
	Label    string    `json:"label"`
	Group    string    `json:"group"`
	Kind     string    `json:"kind"` // number | boolean | enum | text | list | map
	Guard    string    `json:"-"`    // BINDING | CONFIGURABLE | FUNC (failed_course_gpa_policy)
	Options  *[]string `json:"options,omitempty"`
	Min      *float64  `json:"min,omitempty"`
	Max      *float64  `json:"max,omitempty"`
	Reference string   `json:"reference"`
	Help     string    `json:"help"`
}

func complianceNumDef(key, label, group, reference, help string, min, max float64, binding bool) CompliancePolicyDef {
	g := "CONFIGURABLE"
	if binding {
		g = "BINDING"
	}
	return CompliancePolicyDef{Key: key, Label: label, Group: group, Kind: "number", Guard: g, Min: &min, Max: &max, Reference: reference, Help: help}
}

func complianceBoolDef(key, label, group, reference, help string, binding bool) CompliancePolicyDef {
	g := "CONFIGURABLE"
	if binding {
		g = "BINDING"
	}
	return CompliancePolicyDef{Key: key, Label: label, Group: group, Kind: "boolean", Guard: g, Reference: reference, Help: help}
}

func complianceEnumDef(key, label, group, reference, help string, options []string, binding bool) CompliancePolicyDef {
	g := "CONFIGURABLE"
	if binding {
		g = "BINDING"
	}
	return CompliancePolicyDef{Key: key, Label: label, Group: group, Kind: "enum", Guard: g, Options: &options, Reference: reference, Help: help}
}

// CompliancePolicyDefs is the policy catalog — same order and texts as POLICY_DEFS.
func CompliancePolicyDefs() []CompliancePolicyDef {
	return []CompliancePolicyDef{
		// ── گام ۱ ──
		{Key: "failed_course_gpa_policy", Label: "سیاست نمرهٔ مردودی در معدل کل", Group: complianceGroup1, Kind: "enum", Guard: "FUNC",
			Options: &([]string{"EXCLUDE_ALWAYS", "EXCLUDE_IF_PASSED", "EXCLUDE_IF_PASSED_1391", "KEEP_ALWAYS"}),
			Reference: "مادهٔ ۱۱ + بخشنامهٔ ۲/۲۱/۲۸۳۴۲۸ (۱۴۰۳/۱۰/۱۶) و دادنامهٔ ۲۱۵۶۰۳۱ هیئت عمومی دیوان عدالت اداری",
			Help: "نمرهٔ مردودی در ریزنمرات و میانگین نیمسال میماند، ولی در معدل کل هیچ اثری ندارد. برای ورودیهای قدیمی (مادهٔ ۵۳) سیاست آییننامهٔ خودشان حفظ میشود."},
		complianceNumDef("grad_min_gpa", "حداقل معدل کل برای فراغت", complianceGroup1, "مواد ۲۴ (۱۲)، ۳۷ (۱۴) و ۴۹ (۱۶)", "کاردانی/کارشناسی ۱۲ · کارشناسی ارشد ۱۴ · دکتری تخصصی ۱۶. جایگزین تنظیم سراسری GRAD_MIN_GPA.", 0, 20, true),
		complianceNumDef("max_total_probations", "سقف مشروطی متناوب", complianceGroup1, "مادهٔ ۱۶ (۲ برای کاردانی/ناپیوسته، ۳ برای کارشناسی پیوسته)", "پیشفرض کد قبلاً ۴ بود؛ اکنون بر اساس گروه مقطع ۲ یا ۳ است.", 1, 12, true),
		complianceEnumDef("regulation_resolution", "روش تعیین آییننامه در پذیرش", complianceGroup1, "مادهٔ ۵۳", "SMART = سال ورود + مقطع + دانشگاه + بازهٔ اثر. FIRST_ROW = رفتار قدیمی (اولین ردیف جدول)، فقط برای عیبیابی.", []string{"SMART", "FIRST_ROW"}, true),
		complianceNumDef("probation_gpa_threshold", "مرز معدل مشروطی", complianceGroup1, "مواد ۱۵، ۳۱، ۴۳", "۱۲ برای کاردانی/کارشناسی · ۱۴ ارشد · ۱۶ دکتری.", 0, 20, false),
		complianceNumDef("default_passing_grade", "کف نمرهٔ قبولی درس", complianceGroup1, "مواد ۱۰، ۲۹، ۴۰", "۱۰ / ۱۲ / ۱۴ بر حسب مقطع؛ مبنای پیشنیازها و تجمیع معدل.", 0, 20, false),
		// ── گام ۲ ──
		complianceBoolDef("seed_1402_graduate_regulations", "ایجاد خودکار ردیفهای ۱۴۰۲ ارشد/دکتری", complianceGroup2, "مادهٔ ۵۳", "اگر ردیف ۱۴۰۲ مقطعی وجود نداشته باشد، موتور از پریست قانونی استفاده میکند؛ با این گزینه ردیفها هم در دیتابیس ساخته میشوند.", false),
		complianceBoolDef("single_source_passing_grade", "یک منبع حقیقت برای کف قبولی", complianceGroup2, "P1-۱ ممیزی", "روشن = پیشنیازها کف قبولی را از سیاست انطباق میگیرند نه degree_level_configs.", false),
		// ── گام ۳ ──
		complianceBoolDef("count_summer_in_tenure", "شمردن نیمسال تابستان در سنوات", complianceGroup3, "تبصرهٔ ۵ مادهٔ ۱۷", "پیشفرض خاموش: بازهٔ تابستان نیمسال محسوب نمیشود و سقف سنوات را جابهجا نمیکند.", true),
		complianceNumDef("absence_ratio_numerator", "صورت کسر غیبت مجاز", complianceGroup3, "مادهٔ ۷ (بند ۳/۱۶)", "تعداد جلسات غیبتی که از آن پس نمره صفر میشود.", 0, 100, false),
		complianceNumDef("absence_ratio_denominator", "مخرج کسر غیبت مجاز", complianceGroup3, "مادهٔ ۷ (بند ۳/۱۶)", "مبنای ۱۶ جلسه؛ قابل تغییر برای دورههای فشرده.", 1, 200, false),
		complianceBoolDef("absence_auto_zero", "اعمال خودکار نمرهٔ صفر هنگام تجاوز از حد غیبت", complianceGroup3, "مادهٔ ۷", "هشدار ظاهری بهتنهایی کافی نیست؛ ثبت حضور، نمرهٔ نهایی درس را صفر میکند.", false),
		complianceEnumDef("absence_excused_policy", "رفتار غیبت موجه", complianceGroup3, "مادهٔ ۷ تبصره", "DROP_FROM_TERM = درس از مجموع واحدهای نیمسال حذف میشود.", []string{"DROP_FROM_TERM", "NO_EFFECT"}, false),
		complianceNumDef("grade_objection_window_days", "مهلت اعتراض به نمره (روز)", complianceGroup3, "مادهٔ ۸", "۱۰ روز کاردانی/کارشناسی · ۲۰ روز ارشد/دکتری، از تاریخ اعلام نمرهٔ نهایی.", 1, 90, true),
		complianceTextDef("grade_objection_explicit_deadline", "مهلت صریح سراسری (YYYY-MM-DD)", complianceGroup3, "مادهٔ ۸", "سازگاری با تنظیم قدیمی GRADE_OBJECTION_DEADLINE؛ اگر پر باشد بر پنجرهٔ مقطعی مقدم است. خالی = محاسبهٔ خودکار.", false),
		// ── گام ۴ ──
		complianceBoolDef("comprehensive_exam_required", "الزام ارزیابی جامع دکتری", complianceGroup4, "مادهٔ ۴۱", "روشن = دروازهٔ فراغت دکتری بدون ارزیابی جامع عبور نمیکند.", true),
		complianceNumDef("comprehensive_exam_min_gpa", "معدل کل لازم برای ورود به جامع", complianceGroup4, "مادهٔ ۴۱", "پیشفرض ۱۶.", 0, 20, true),
		complianceNumDef("comprehensive_exam_pass_grade", "نمرهٔ قبولی ارزیابی جامع", complianceGroup4, "مادهٔ ۴۱", "پیشفرض ۱۶.", 0, 20, true),
		complianceNumDef("comprehensive_exam_max_attempts", "حداکثر دفعات شرکت در جامع", complianceGroup4, "مادهٔ ۴۱ (فقط یک بار تجدید)", "پیشفرض ۲ (یک بار اصلی + یک تجدید).", 1, 10, true),
		complianceBoolDef("comprehensive_exam_language_required", "احراز بسندگی زبان پیش از جامع", complianceGroup4, "مادهٔ ۴۱", "در صورت نبود سند زبان، مجوز شرکت صادر نمیشود.", false),
		complianceListDef("comprehensive_exam_alternatives", "جایگزینهای مادهٔ ۴۴", complianceGroup4, "مادهٔ ۴۴", "فهرست کدهای جایگزین (مثلاً GPA_18، ARTICLE_ISI، PATENT) که با تأیید دانشگاه جای تجدید جامع را میگیرند. با ویرگول جدا کنید.", false),
		complianceEnumDef("thesis_grade_mode", "مقیاس نمرهٔ پایاننامه/رساله", complianceGroup4, "مواد ۳۶ و ۴۸", "پیشفرض کیفی و خارج از معدل؛ مطابق آییننامه.", []string{"QUALITATIVE", "NUMERIC"}, true),
		complianceListDef("thesis_qualitative_labels", "درجات کیفی پایاننامه/رساله", complianceGroup4, "مواد ۳۶ و ۴۸", "با ویرگول جدا کنید؛ ترتیب از بالاترین درجه به مردود.", false),
		complianceNumDef("proposal_deadline_semester", "آخرین نیمسال تصویب پیشنهاده", complianceGroup4, "مواد ۳۳ و ۴۵", "شمارهٔ نیمسال تحصیلی؛ پیشفرض ۲ (ارشد) / ۴ (دکتری).", 1, 20, false),
		complianceNumDef("supervisor_deadline_semester", "آخرین نیمسال معرفی استاد راهنما", complianceGroup4, "مواد ۳۲ و ۴۵", "شمارهٔ نیمسال تحصیلی.", 1, 20, false),
		complianceEnumDef("graduation_date_source", "مبنای تاریخ دانشآموختگی", complianceGroup4, "مواد ۳۸ و ۵۰", "DEFENSE_DATE = تاریخ دفاع، تاریخ دانشآموختگی است.", []string{"DEFENSE_DATE", "MANUAL"}, true),
		// ── گام ۵ ──
		complianceNumDef("equiv_min_grade", "حداقل نمرهٔ قابل معادلسازی", complianceGroup5, "مادهٔ ۱۲ (الف) — ۱۲ / ۱۴ / ۱۶", "کاردانی و کارشناسی ۱۲ · ارشد ۱۴ · دکتری تخصصی ۱۶.", 0, 20, true),
		complianceNumDef("equiv_term_units", "واحدهای هر نیمسال معادلسازی", complianceGroup5, "مادهٔ ۱۲ (هر ۲۰ واحد / ارشد ۱۳ واحد)", "هر ۲۰ واحد (ارشد ۱۳) یک نیمسال معادلسازی و یک ترم کسر از سنوات.", 1, 60, true),
		complianceNumDef("equiv_max_years", "حداکثر فاصلهٔ زمانی مجاز (سال)", complianceGroup5, "مادهٔ ۱۲ (الف) اصلاحی — ۵ سال", "قابل اعمال فقط وقتی مبدأ ثبت شده باشد.", 0, 40, true),
		complianceEnumDef("equiv_clock_anchor", "مبدأ محاسبهٔ پنج سال", complianceGroup5, "اصلاحیهٔ ۲/۱۵۵۶۵۵ (۱۴۰۲/۰۶/۲۷)", "EXIT_DATE = «از زمان انصراف یا اخراج دانشجو در دورهٔ قبلی» (قانون جاری).", []string{"EXIT_DATE", "COURSE_PASS_DATE"}, true),
		complianceTextDef("equiv_notification_date", "تاریخ ابلاغ اصلاحیه (مرز گذار)", complianceGroup5, "ابلاغیهٔ ۲/۱۵۵۶۵۵ — ۱۴۰۲/۰۶/۲۷", "برای ورودیهای ۱۴۰۳-۱۴۰۲ و ۱۴۰۴-۱۴۰۳ فقط دروس گذراندهنشده تا این تاریخ مشمول قاعدهٔ گذاراند.", true),
		complianceListDef("equiv_transition_entry_years", "سالهای ورود مشمول قاعدهٔ گذار", complianceGroup5, "اصلاحیهٔ مادهٔ ۱۲، بند ۲", "پیشفرض ۱۴۰۲ و ۱۴۰۳ (یعنی ورودیهای ۱۴۰۳-۱۴۰۲ و ۱۴۰۴-۱۴۰۳). با ویرگول جدا کنید.", true),
		complianceNumDef("equiv_cap_percent", "سقف معادلسازی برای انصرافی/اخراجی (درصد)", complianceGroup5, "مادهٔ ۱۲ بند ۴ — ۵۰٪", "فقط برای WITHDRAWN / EXPELLED؛ تغییر رشته و انتقالی بدون سقفاند.", 0, 100, true),
		complianceListDef("equiv_cap_statuses", "وضعیت‌های مشمول سقف ۵۰٪", complianceGroup5, "مادهٔ ۱۲ بند ۴", "پیشفرض WITHDRAWN,EXPELLED.", true),
		complianceBoolDef("equiv_allow_over_max_years_if_curriculum_unchanged", "استثنای بیش از ۵ سال با عدم تغییر برنامهٔ درسی", complianceGroup5, "تبصرهٔ الحاقی اصلاحیهٔ مادهٔ ۱۲", "به شرط تأیید دانشگاه مقصد و ثبت نسخهٔ چارت بدون تغییر.", true),
		complianceBoolDef("equiv_require_destination_confirmation", "الزام تأیید دانشگاه مقصد (عدم تغییر محتوا)", complianceGroup5, "تبصرهٔ الحاقی اصلاحیهٔ مادهٔ ۱۲", "فیلد ساختاریافته‌ای روی پروندهٔ دانشجو ثبت میشود.", false),
		complianceBoolDef("equiv_quality_coefficient_required", "اعمال ضریب کیفیت دانشگاه/رشته (ج)", complianceGroup5, "مادهٔ ۱۲ (ج)", "ضریب کیفیت بهعنوان دادهٔ ساختاریافته بررسی میشود.", true),
		complianceBoolDef("equiv_official_degree_exclusion", "منع معادلسازی از دورهٔ منتهی به مدرک رسمی (ب)", complianceGroup5, "مادهٔ ۱۲ (ب)", "دروسی که پیشتر مدرک رسمی با آنها صادر شده قابل معادلسازی مجدد نیستند.", true),
		complianceMapDef("equiv_form_templates", "قالب‌های فرم‌های آموزشی", complianceGroup5, "مواد ۲۰، ۲۱، ۲۲ و فرم‌های اداری", "نگاشت کد فرم → عنوان قالب: مرخصی، انصراف، تغییر رشته/انتقال، استاد مشاور. فرمت JSON.", false),
	}
}

func complianceTextDef(key, label, group, reference, help string, binding bool) CompliancePolicyDef {
	g := "CONFIGURABLE"
	if binding {
		g = "BINDING"
	}
	return CompliancePolicyDef{Key: key, Label: label, Group: group, Kind: "text", Guard: g, Reference: reference, Help: help}
}

func complianceListDef(key, label, group, reference, help string, binding bool) CompliancePolicyDef {
	g := "CONFIGURABLE"
	if binding {
		g = "BINDING"
	}
	return CompliancePolicyDef{Key: key, Label: label, Group: group, Kind: "list", Guard: g, Reference: reference, Help: help}
}

func complianceMapDef(key, label, group, reference, help string, binding bool) CompliancePolicyDef {
	g := "CONFIGURABLE"
	if binding {
		g = "BINDING"
	}
	return CompliancePolicyDef{Key: key, Label: label, Group: group, Kind: "map", Guard: g, Reference: reference, Help: help}
}

func complianceDefByKey(key string) *CompliancePolicyDef {
	for i := range complianceCatalog {
		if complianceCatalog[i].Key == key {
			return &complianceCatalog[i]
		}
	}
	return nil
}

// complianceCatalog is the shared catalog snapshot (same for every request —
// pure data).
var complianceCatalog = CompliancePolicyDefs()

// ComplianceContext is the resolution context (family/level/year + scopes).
type ComplianceContext struct {
	Family            string  `json:"family"` // REG_1402 | LEGACY
	Level             string  `json:"level"`  // SHORT | LONG | MS | PHD
	EntryYear         int     `json:"entryYear"`
	LegacyFailedPolicy *string `json:"-"`
	UniversityID      *int64  `json:"-"`
	RegulationID      *int64  `json:"-"`
	DegreeLevelID     *int64  `json:"-"`
}

// complianceIsBinding evaluates the guard — failed_course_gpa_policy is
// binding for the 1402 era (family REG_1402 or entry year >= 1402).
func complianceIsBinding(def *CompliancePolicyDef, ctx *ComplianceContext) bool {
	if def.Guard == "FUNC" {
		return ctx.Family == "REG_1402" || ctx.EntryYear >= 1402
	}
	return def.Guard == "BINDING"
}

var complianceFormTemplates = map[string]string{
	"LEAVE":       "فرم درخواست مرخصی تحصیلی",
	"WITHDRAWAL":  "فرم انصراف از تحصیل",
	"MAJOR_CHANGE": "فرم تغییر رشته",
	"TRANSFER":    "فرم انتقال / تغییر رشته توأم با انتقال",
	"ADVISOR":     "فرم معرفی استاد مشاور",
}

// complianceLegalDefaults ports legalDefaults — the legal values as a function
// of level, entry year and regulation family.
func complianceLegalDefaults(ctx *ComplianceContext) map[string]any {
	graduate := ctx.Level == "MS" || ctx.Level == "PHD"
	phd := ctx.Level == "PHD"
	short := ctx.Level == "SHORT"
	is1402 := ctx.Family == "REG_1402" || ctx.EntryYear >= 1402

	gradMin := 16.0
	switch ctx.Level {
	case "SHORT", "LONG":
		gradMin = 12
	case "MS":
		gradMin = 14
	}
	passing := 16.0
	switch ctx.Level {
	case "SHORT", "LONG":
		passing = 10
	case "MS":
		passing = 12
	}
	probation := passing

	failedPolicy := "EXCLUDE_IF_PASSED"
	if is1402 {
		failedPolicy = "EXCLUDE_ALWAYS"
	} else if ctx.LegacyFailedPolicy != nil && *ctx.LegacyFailedPolicy != "" {
		failedPolicy = *ctx.LegacyFailedPolicy
	}

	equivMin := 16.0
	switch ctx.Level {
	case "SHORT", "LONG":
		equivMin = 12
	case "MS":
		equivMin = 14
	}

	labels := []string{"عالی", "خیلی خوب", "خوب", "قابل قبول", "مردود"}
	alternatives := []string{"GPA_18", "ARTICLE_ISI", "PATENT"}
	transitionYears := []any{1402, 1403}
	capStatuses := []string{"WITHDRAWN", "EXPELLED"}
	templates := map[string]any{}
	for k, v := range complianceFormTemplates {
		templates[k] = v
	}

	maxProbations := 3.0
	if graduate || short {
		maxProbations = 2
	}

	return map[string]any{
		"failed_course_gpa_policy": failedPolicy,
		"grad_min_gpa":             gradMin,
		"max_total_probations":     maxProbations,
		"regulation_resolution":    "SMART",
		"probation_gpa_threshold":  float64(probation),
		"default_passing_grade":    float64(passing),

		"seed_1402_graduate_regulations": true,
		"single_source_passing_grade":    true,

		"count_summer_in_tenure":          false,
		"absence_ratio_numerator":         float64(3),
		"absence_ratio_denominator":       float64(16),
		"absence_auto_zero":               true,
		"absence_excused_policy":          "DROP_FROM_TERM",
		"grade_objection_window_days":     func() float64 { if graduate { return 20 }; return 10 }(),
		"grade_objection_explicit_deadline": "",

		"comprehensive_exam_required":         true,
		"comprehensive_exam_min_gpa":          float64(16),
		"comprehensive_exam_pass_grade":       float64(16),
		"comprehensive_exam_max_attempts":     float64(2),
		"comprehensive_exam_language_required": true,
		"comprehensive_exam_alternatives":      alternatives,
		"thesis_grade_mode":                    "QUALITATIVE",
		"thesis_qualitative_labels":            labels,
		"proposal_deadline_semester":           func() float64 { if phd { return 4 }; return 2 }(),
		"supervisor_deadline_semester":         func() float64 { if phd { return 2 }; return 1 }(),
		"graduation_date_source":               "DEFENSE_DATE",

		"equiv_min_grade":                 equivMin,
		"equiv_term_units":                func() float64 { if graduate { return 13 }; return 20 }(),
		"equiv_max_years":                 float64(5),
		"equiv_clock_anchor":              "EXIT_DATE",
		"equiv_notification_date":         "1402/06/27",
		"equiv_transition_entry_years":    transitionYears,
		"equiv_cap_percent":               float64(50),
		"equiv_cap_statuses":              capStatuses,
		"equiv_allow_over_max_years_if_curriculum_unchanged": true,
		"equiv_require_destination_confirmation":             true,
		"equiv_quality_coefficient_required":                 true,
		"equiv_official_degree_exclusion":                    true,
		"equiv_form_templates":                               templates,
	}
}

// complianceNormalize ports normalizePolicyValue — converts a raw layer value
// to the policy type; nil means "this layer is invalid".
func complianceNormalize(def *CompliancePolicyDef, raw any) any {
	if raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case string:
		if strings.TrimSpace(v) == "" {
			return nil
		}
	case json.Number:
		// handled per-kind below
	}
	switch def.Kind {
	case "number":
		var n float64
		switch v := raw.(type) {
		case float64:
			n = v
		case json.Number:
			pn, err := v.Float64()
			if err != nil {
				return nil
			}
			n = pn
		case string:
			s := strings.TrimSpace(v)
			if s == "" {
				return nil
			}
			pn, err := json.Number(s).Float64()
			if err != nil || math.IsNaN(pn) || math.IsInf(pn, 0) {
				return nil
			}
			n = pn
		default:
			return nil
		}
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return nil
		}
		// Clamp, not reject: an incomplete config must not break the engine.
		if def.Min != nil && n < *def.Min {
			n = *def.Min
		}
		if def.Max != nil && n > *def.Max {
			n = *def.Max
		}
		return n
	case "boolean":
		switch v := raw.(type) {
		case bool:
			return v
		case string:
			s := strings.ToLower(strings.TrimSpace(v))
			switch s {
			case "1", "true", "yes", "on", "بله":
				return true
			case "0", "false", "no", "off", "خیر":
				return false
			}
			return nil
		case float64:
			if v == 1 {
				return true
			}
			if v == 0 {
				return false
			}
			return nil
		}
		return nil
	case "enum":
		s := strings.TrimSpace(fmt.Sprintf("%v", raw))
		if def.Options != nil {
			for _, o := range *def.Options {
				if o == s {
					return s
				}
			}
		}
		return nil
	case "text":
		s := strings.TrimSpace(fmt.Sprintf("%v", raw))
		if len([]rune(s)) > 200 {
			s = string([]rune(s)[:200])
		}
		return s
	case "list":
		var items []string
		switch v := raw.(type) {
		case []any:
			for _, x := range v {
				s := strings.TrimSpace(fmt.Sprintf("%v", x))
				if s != "" {
					items = append(items, s)
				}
			}
		case string:
			for _, part := range regexp.MustCompile(`[,،|\n\r]+`).Split(v, -1) {
				if s := strings.TrimSpace(part); s != "" {
					items = append(items, s)
				}
			}
		default:
			return nil
		}
		if items == nil {
			return nil
		}
		// Year lists accept only valid numbers.
		if def.Key == "equiv_transition_entry_years" {
			out := []any{}
			for _, s := range items {
				n, err := json.Number(s).Float64()
				if err == nil && n > 1300 && n < 1500 {
					out = append(out, n)
				}
			}
			return out
		}
		return items
	case "map":
		switch v := raw.(type) {
		case map[string]any:
			out := map[string]string{}
			for k, val := range v {
				kk := strings.TrimSpace(k)
				if kk == "" {
					continue
				}
				out[kk] = strings.TrimSpace(fmt.Sprintf("%v", val))
			}
			return out
		case string:
			s := strings.TrimSpace(v)
			if !strings.HasPrefix(s, "{") {
				return nil
			}
			var m map[string]any
			if err := json.Unmarshal([]byte(s), &m); err != nil {
				return nil
			}
			out := map[string]string{}
			for k, val := range m {
				kk := strings.TrimSpace(k)
				if kk == "" {
					continue
				}
				out[kk] = strings.TrimSpace(fmt.Sprintf("%v", val))
			}
			return out
		}
		return nil
	}
	return nil
}

// complianceJSONEqual compares two normalized values by their JSON form (same
// semantics as JSON.stringify comparison in the reference).
func complianceJSONEqual(a, b any) bool {
	ab, aerr := json.Marshal(a)
	bb, berr := json.Marshal(b)
	if aerr != nil || berr != nil {
		return false
	}
	return string(ab) == string(bb)
}

// ComplianceProvenance is the per-key origin record.
type ComplianceProvenance struct {
	Source        string `json:"source"`
	Legal         any    `json:"legal"`
	LegalConflict bool   `json:"legalConflict"`
	Shadowed      any    `json:"shadowed,omitempty"`
}

// ComplianceResolved is the resolution output.
type ComplianceResolved struct {
	Values     map[string]any                  `json:"values"`
	Provenance map[string]ComplianceProvenance `json:"provenance"`
	Context    *ComplianceContext              `json:"context"`
}

// ComplianceLayers is the input layers (overrides/regulation/settings).
type ComplianceLayers struct {
	Overrides  map[string]any
	Regulation map[string]any
	Settings   map[string]any
}

// ComplianceResolve ports resolveCompliance — the layered precedence with the
// BINDING guard: old layers cannot bypass the law, but an explicit reasoned
// override always wins.
func ComplianceResolve(ctx *ComplianceContext, layers ComplianceLayers) *ComplianceResolved {
	legal := complianceLegalDefaults(ctx)
	values := map[string]any{}
	for k, v := range legal {
		values[k] = v
	}
	provenance := map[string]ComplianceProvenance{}

	for i := range complianceCatalog {
		def := &complianceCatalog[i]
		key := def.Key
		binding := complianceIsBinding(def, ctx)
		var shadowed any
		conflict := false

		type candidate struct {
			source string
			raw    any
		}
		var candidates []candidate
		if binding {
			// Layers 2/3 deliberately come after the law so they cannot bypass it.
			candidates = []candidate{
				{"override", layers.Overrides[key]},
				{"legal", legal[key]},
				{"regulation", layers.Regulation[key]},
				{"setting", layers.Settings[key]},
			}
		} else {
			candidates = []candidate{
				{"override", layers.Overrides[key]},
				{"regulation", layers.Regulation[key]},
				{"setting", layers.Settings[key]},
				{"legal", legal[key]},
			}
		}

		chosenSource := "legal"
		chosen := legal[key]
		legalSeen := false

		for _, c := range candidates {
			if c.source == "legal" {
				norm := complianceNormalize(def, c.raw)
				if norm == nil {
					norm = legal[key]
				}
				if chosenSource == "legal" && !legalSeen {
					chosen = norm
					legalSeen = true
				}
				continue
			}
			if c.raw == nil {
				continue
			}
			if s, ok := c.raw.(string); ok && strings.TrimSpace(s) == "" {
				continue
			}
			norm := complianceNormalize(def, c.raw)
			if norm == nil {
				continue
			}
			if binding && c.source != "override" {
				// Legacy/incompatible config: recorded but not applied.
				if !complianceJSONEqual(norm, legal[key]) {
					shadowed = norm
					conflict = true
				}
				continue
			}
			chosen = norm
			chosenSource = c.source
			break
		}

		values[key] = chosen
		src := chosenSource
		if binding && chosenSource == "legal" {
			src = "legal-guard"
		}
		provenance[key] = ComplianceProvenance{Source: src, Legal: legal[key], LegalConflict: conflict, Shadowed: shadowed}
	}
	return &ComplianceResolved{Values: values, Provenance: provenance, Context: ctx}
}

// complianceOverrideRow is one row of compliance_policy_overrides.
type complianceOverrideRow struct {
	ID            int64           `json:"id"`
	UniversityID  *int64          `json:"universityId"`
	DegreeLevelID *int64          `json:"degreeLevelId"`
	RegulationID  *int64          `json:"regulationId"`
	EntryYear     *int            `json:"entryYear"`
	Key           string          `json:"key"`
	Value         json.RawMessage `json:"value"`
	Reason        string          `json:"reason"`
	UpdatedAt     *string         `json:"updatedAt"`
}

// smallComplianceOverrides reads all override rows (fail-open to empty: a
// database without the migration just means no overrides).
func (s *Service) smallComplianceOverrides(ctx context.Context) []complianceOverrideRow {
	out := []complianceOverrideRow{}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "universityId", "degreeLevelId", "regulationId", "entryYear", key, value, reason, "updatedAt"::text
		  from compliance_policy_overrides`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var r complianceOverrideRow
		var reason *string
		if err := rows.Scan(&r.ID, &r.UniversityID, &r.DegreeLevelID, &r.RegulationID, &r.EntryYear,
			&r.Key, &r.Value, &reason, &r.UpdatedAt); err == nil {
			if reason != nil {
				r.Reason = *reason
			}
			out = append(out, r)
		}
	}
	return out
}

func complianceScopeScore(r complianceOverrideRow) int {
	score := 0
	if r.UniversityID != nil {
		score++
	}
	if r.DegreeLevelID != nil {
		score += 2
	}
	if r.RegulationID != nil {
		score += 4
	}
	if r.EntryYear != nil {
		score += 8
	}
	return score
}

func complianceScopeMatches(r complianceOverrideRow, ctx *ComplianceContext) bool {
	if r.UniversityID != nil && (ctx.UniversityID == nil || *r.UniversityID != *ctx.UniversityID) {
		return false
	}
	if r.DegreeLevelID != nil && (ctx.DegreeLevelID == nil || *r.DegreeLevelID != *ctx.DegreeLevelID) {
		return false
	}
	if r.RegulationID != nil && (ctx.RegulationID == nil || *r.RegulationID != *ctx.RegulationID) {
		return false
	}
	if r.EntryYear != nil && *r.EntryYear != ctx.EntryYear {
		return false
	}
	return true
}

func complianceOverridesFor(ctx *ComplianceContext, rows []complianceOverrideRow) map[string]any {
	out := map[string]any{}
	best := map[string]int{}
	for _, r := range rows {
		if !complianceScopeMatches(r, ctx) {
			continue
		}
		sc := complianceScopeScore(r)
		if best[r.Key] <= sc {
			var v any
			if err := json.Unmarshal(r.Value, &v); err == nil {
				best[r.Key] = sc
				out[r.Key] = v
			}
		}
	}
	return out
}

// complianceMaghtaGroup ports maghtaGroup of regulations-types.ts — strips the
// SAMA-/HAMAVA- prefix and maps code/title to the level group.
func complianceMaghtaGroup(codeOrTitle any) string {
	m := strings.ToUpper(strings.TrimSpace(fmt.Sprintf("%v", codeOrTitle)))
	m = regexp.MustCompile(`^[A-Za-z]+-`).ReplaceAllString(m, "")
	switch m {
	case "3", "MS":
		return "MS"
	case "4", "6", "7", "8", "PHD":
		return "PHD"
	case "1", "5", "9", "10", "AD":
		return "SHORT"
	}
	// Persian titles of the degree_level_configs.
	if strings.Contains(m, "دکتر") && strings.Contains(m, "حرفه") {
		return "PHD"
	}
	if strings.Contains(m, "دکتر") {
		return "PHD"
	}
	if strings.Contains(m, "ارشد") || strings.Contains(m, "کارشناسی ارشد") {
		return "MS"
	}
	if strings.Contains(m, "کاردانی") {
		return "SHORT"
	}
	return "LONG"
}

// complianceToRegulationFamily ports toRegulationFamily — "آیین‌نامهٔ ۱۴۰۲" is
// recognized with any Persian/Latin label.
func complianceToRegulationFamily(title any, effectiveFromYear any, rulesConfig any) string {
	hay := fmt.Sprintf("%v %v", title, rulesConfig)
	has1402 := regexp.MustCompile(`۱۴۰۲|1402`).MatchString(hay)
	y := 0.0
	switch v := effectiveFromYear.(type) {
	case int:
		y = float64(v)
	case int64:
		y = float64(v)
	case float64:
		y = v
	case *int:
		if v != nil {
			y = float64(*v)
		}
	case nil:
		y = 0
	}
	return map[bool]string{
		true: "REG_1402",
		false: "LEGACY",
	}[(has1402 && y >= 1402) || (y == 0 && has1402)]
}

// ComplianceBundle is the /admin/compliance-policy page response.
type ComplianceBundle struct {
	Rows          []map[string]any `json:"rows"`
	Groups        []string         `json:"groups"`
	Context       map[string]any   `json:"context"`
	OverrideCount int              `json:"overrideCount"`
}

// SmallComplianceBundle ports the compliance-policy page loader: resolve with
// the overrides + system_settings layers for the given context.
func (s *Service) SmallComplianceBundle(ctx context.Context, universityID *int64, entryYear int, level, family string, regulationID *int64) (*ComplianceBundle, error) {
	if entryYear <= 0 {
		entryYear = 1405
	}
	if level == "" {
		level = "LONG"
	}
	if family == "" {
		family = "REG_1402"
	}

	// makeContext — when a regulation is given, derive family/level from it.
	legacyFailedPolicy := ""
	if regulationID != nil {
		var (
			title            *string
			effectiveFrom    *int
			rulesConfig      *string
			regDegreeLevelID *int64
		)
		if err := s.DB.Pool.QueryRow(ctx, `
			select title, "effectiveFromYear", "rulesConfig", "degreeLevelId"
			  from educational_regulations where id = $1`, *regulationID).
			Scan(&title, &effectiveFrom, &rulesConfig, &regDegreeLevelID); err == nil {
			family = complianceToRegulationFamily(title, effectiveFrom, rulesConfig)
			if rulesConfig != nil {
				var rules map[string]any
				if json.Unmarshal([]byte(*rulesConfig), &rules) == nil {
					if gg, ok := rules["grading_and_gpa"].(map[string]any); ok {
						if p, ok := gg["failed_course_gpa_policy"].(string); ok {
							legacyFailedPolicy = p
						}
					}
				}
			}
			if level == "LONG" && regDegreeLevelID != nil {
				var code, title *string
				if err := s.DB.Pool.QueryRow(ctx, `select code, title from degree_level_configs where id = $1`, *regDegreeLevelID).
					Scan(&code, &title); err == nil {
					if code != nil {
						level = complianceMaghtaGroup(*code)
					} else if title != nil {
						level = complianceMaghtaGroup(*title)
					}
				}
			}
		}
	}

	cctx := &ComplianceContext{
		Family: family, Level: level, EntryYear: entryYear,
		UniversityID: universityID, RegulationID: regulationID,
	}
	if legacyFailedPolicy != "" {
		cctx.LegacyFailedPolicy = &legacyFailedPolicy
	}

	// Regulation layer: rulesConfig.compliance of the given regulation.
	regLayer := map[string]any{}
	if regulationID != nil {
		var rulesConfig *string
		if err := s.DB.Pool.QueryRow(ctx, `select "rulesConfig" from educational_regulations where id = $1`, *regulationID).
			Scan(&rulesConfig); err == nil && rulesConfig != nil {
			var rules map[string]any
			if json.Unmarshal([]byte(*rulesConfig), &rules) == nil {
				if c, ok := rules["compliance"].(map[string]any); ok {
					regLayer = c
				}
			}
		}
	}

	// Settings layer — the two legacy system_settings keys (empty = no candidate).
	settingsLayer := map[string]any{}
	if s.Store != nil {
		if v, err := s.Store.Get(ctx, "GRAD_MIN_GPA"); err == nil && strings.TrimSpace(v) != "" {
			if n, nerr := json.Number(strings.TrimSpace(v)).Float64(); nerr == nil {
				settingsLayer["grad_min_gpa"] = n
			}
		}
		if v, err := s.Store.Get(ctx, "GRADE_OBJECTION_DEADLINE"); err == nil && strings.TrimSpace(v) != "" {
			settingsLayer["grade_objection_explicit_deadline"] = strings.TrimSpace(v)
		}
	}

	rows := s.smallComplianceOverrides(ctx)
	resolved := ComplianceResolve(cctx, ComplianceLayers{
		Overrides:  complianceOverridesFor(cctx, rows),
		Regulation: regLayer,
		Settings:   settingsLayer,
	})

	out := &ComplianceBundle{Rows: []map[string]any{}, Groups: complianceGroups}
	// Overrides visible to this university: global (NULL) or same university.
	visible := []complianceOverrideRow{}
	for _, r := range rows {
		if universityID == nil || r.UniversityID == nil || *r.UniversityID == *universityID {
			visible = append(visible, r)
		}
	}
	sort.SliceStable(visible, func(i, j int) bool {
		if complianceScopeScore(visible[i]) != complianceScopeScore(visible[j]) {
			return complianceScopeScore(visible[i]) > complianceScopeScore(visible[j])
		}
		return visible[i].Key < visible[j].Key
	})
	// Latest override per key for the UI badges.
	ovByKey := map[string]*complianceOverrideRow{}
	for i := range visible {
		r := visible[i]
		if _, ok := ovByKey[r.Key]; !ok {
			rr := r
			ovByKey[r.Key] = &rr
		}
	}

	for i := range complianceCatalog {
		def := &complianceCatalog[i]
		p := resolved.Provenance[def.Key]
		sourceLabel := map[string]string{
			"override":    "اورراید مدیر",
			"regulation":  "پیکربندی آیین‌نامه",
			"setting":     "تنظیمات سراسری",
			"legal":       "پیش‌فرض قانونی",
			"legal-guard": "پیش‌فرض قانونی (محافظت‌شده)",
		}[p.Source]
		row := map[string]any{
			"key":          def.Key,
			"label":        def.Label,
			"group":        def.Group,
			"kind":         def.Kind,
			"reference":    def.Reference,
			"help":         def.Help,
			"binding":      complianceIsBinding(def, cctx),
			"value":        resolved.Values[def.Key],
			"legal":        p.Legal,
			"source":       p.Source,
			"sourceLabel":  sourceLabel,
			"legalConflict": p.LegalConflict,
		}
		if def.Options != nil {
			row["options"] = *def.Options
		}
		if def.Min != nil {
			row["min"] = *def.Min
		}
		if def.Max != nil {
			row["max"] = *def.Max
		}
		if p.Shadowed != nil {
			row["shadowed"] = p.Shadowed
		} else {
			row["shadowed"] = nil
		}
		if ov, ok := ovByKey[def.Key]; ok {
			row["overrideId"] = ov.ID
			row["overrideReason"] = ov.Reason
		} else {
			row["overrideId"] = nil
			row["overrideReason"] = ""
		}
		out.Rows = append(out.Rows, row)
	}
	out.OverrideCount = len(visible)
	out.Context = map[string]any{
		"family":       cctx.Family,
		"level":        cctx.Level,
		"entryYear":    cctx.EntryYear,
		"universityId": universityID,
	}
	return out, nil
}

// SmallComplianceSaveOverride ports saveComplianceOverride — validates the key
// and value, requires a reason (>= 3 chars) and upserts on the exact scope.
func (s *Service) SmallComplianceSaveOverride(ctx context.Context, universityID *int64, updatedBy *int64, key string, value any, reason string, degreeLevelID, regulationID, entryYear *int64) error {
	def := complianceDefByKey(key)
	if def == nil {
		return errors.New("کلید سیاست ناشناخته است.")
	}
	normalized := complianceNormalize(def, value)
	if normalized == nil {
		return errors.New("مقدار واردشده برای این سیاست معتبر نیست.")
	}
	reason = strings.TrimSpace(reason)
	if len([]rune(reason)) < 3 {
		return errors.New("برای تغییر یک حکم آیین‌نامه‌ای ثبت دلیل الزامی است.")
	}

	raw, err := json.Marshal(normalized)
	if err != nil {
		return errors.New("خطا در ذخیرهٔ اورراید.")
	}

	var uni, deg, reg, ey any
	if universityID != nil {
		uni = *universityID
	}
	if degreeLevelID != nil {
		deg = *degreeLevelID
	}
	if regulationID != nil {
		reg = *regulationID
	}
	if entryYear != nil {
		ey = *entryYear
	}

	// Upsert on the exact scope (NULLs unified by the COALESCE unique index).
	tag, err := s.DB.Pool.Exec(ctx, `
		update compliance_policy_overrides
		   set value = $6::jsonb, reason = $7, "updatedBy" = $8, "updatedAt" = now()
		 where key = $5
		   and coalesce("universityId", 0) = coalesce($1::int, 0)
		   and coalesce("degreeLevelId", 0) = coalesce($2::int, 0)
		   and coalesce("regulationId", 0) = coalesce($3::int, 0)
		   and coalesce("entryYear", 0) = coalesce($4::int, 0)`,
		uni, deg, reg, ey, key, string(raw), reason, updatedBy)
	if err == nil && tag.RowsAffected() == 0 {
		_, err = s.DB.Pool.Exec(ctx, `
			insert into compliance_policy_overrides
			       ("universityId", "degreeLevelId", "regulationId", "entryYear", key, value, reason, "updatedBy")
			values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
			uni, deg, reg, ey, key, string(raw), reason, updatedBy)
	}
	if err != nil {
		return errors.New("خطا در ذخیرهٔ اورراید.")
	}
	return nil
}

// SmallComplianceDeleteOverride ports deleteComplianceOverride.
func (s *Service) SmallComplianceDeleteOverride(ctx context.Context, id int64) error {
	_, err := s.DB.Pool.Exec(ctx, `delete from compliance_policy_overrides where id = $1`, id)
	if err != nil {
		return errors.New("خطا در حذف اورراید.")
	}
	return nil
}

// SmallComplianceSeedResult is the 1402 seed report.
type SmallComplianceSeedResult struct {
	OK      bool     `json:"ok"`
	Created []string `json:"created"`
	Skipped []string `json:"skipped"`
	Error   string   `json:"error,omitempty"`
}

// SmallComplianceSeed1402 ports seed1402GraduateRegulations — idempotent
// creation of the 1402 MS/PhD regulation rows from the legal presets.
func (s *Service) SmallComplianceSeed1402(ctx context.Context, universityID int64) *SmallComplianceSeedResult {
	out := &SmallComplianceSeedResult{OK: true, Created: []string{}, Skipped: []string{}}

	type target struct {
		degreeID int64
		title    string
		label    string
		config   func() RegulationConfig
	}
	degrees := []struct {
		id    int64
		code  *string
		title *string
	}{}
	dr, err := s.DB.Pool.Query(ctx, `select id, code, title from degree_level_configs`)
	if err != nil {
		out.OK, out.Error = false, "خطا در ایجاد ردیف‌ها."
		return out
	}
	for dr.Next() {
		var id int64
		var code, title *string
		if dr.Scan(&id, &code, &title) == nil {
			degrees = append(degrees, struct {
				id    int64
				code  *string
				title *string
			}{id, code, title})
		}
	}
	dr.Close()

	masters := []target{}
	phds := []target{}
	for _, d := range degrees {
		hay := ""
		if d.code != nil {
			hay += *d.code + " "
		}
		if d.title != nil {
			hay += *d.title
		}
		if regexp.MustCompile(`(?i)MS|ارشد`).MatchString(hay) {
			masters = append(masters, target{degreeID: d.id, title: strPtrVal(d.title), label: "کارشناسی ارشد", config: smallReg1402MasterFor})
		} else if regexp.MustCompile(`(?i)PHD|دکتري تخصص|دکتری تخصص`).MatchString(hay) && !regexp.MustCompile(`حرفه`).MatchString(hay) {
			// Article 1: professional doctorate is out of scope.
			phds = append(phds, target{degreeID: d.id, title: strPtrVal(d.title), label: "دکتری تخصصی", config: smallReg1402PhdFor})
		}
	}

	for _, group := range [][]target{masters, phds} {
		for _, t := range group {
			var existsID int64
			err := s.DB.Pool.QueryRow(ctx, `
				select id from educational_regulations
				 where "degreeLevelId" = $1 and "effectiveFromYear" = 1402 and "universityId" = $2
				 limit 1`, t.degreeID, universityID).Scan(&existsID)
			if err == nil {
				out.Skipped = append(out.Skipped, t.label+" / "+t.title)
				continue
			}
			cfg, err := json.Marshal(t.config())
			if err != nil {
				out.OK, out.Error = false, "خطا در ایجاد ردیف‌ها."
				return out
			}
			_, err = s.DB.Pool.Exec(ctx, `
				insert into educational_regulations
				       ("universityId", title, "degreeLevelId", "effectiveFromYear", "effectiveToYear", "rulesConfig")
				values ($1, $2, $3, 1402, null, $4)`,
				universityID, fmt.Sprintf("آیین نامه ۱۴۰۲ — %s", t.label), t.degreeID, string(cfg))
			if err != nil {
				out.OK, out.Error = false, "خطا در ایجاد ردیف‌ها."
				return out
			}
			out.Created = append(out.Created, t.label+" / "+t.title)
		}
	}
	return out
}

// strPtrVal dereferences an optional string (empty for nil).
func strPtrVal(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// smallReg1402MasterFor ports reg1402MasterFor — the 1394 master preset with
// the 1402 grading rules (materiel 49: GPA 14 floor, passing 12).
func smallReg1402MasterFor() RegulationConfig {
	c := regulationPreset1394Master()
	c.GradingAndGpa = RegulationGradingAndGpa{
		FailedCourseGpaPolicy: "EXCLUDE_ALWAYS",
		DefaultPassingGrade:   12.0,
		RetakeMinGrade:        regFloat(12),
		RegulationLabel:       strPtr("آیین‌نامه ۱۴۰۲ — کارشناسی ارشد"),
	}
	return c
}

// smallReg1402PhdFor ports reg1402PhdFor — the 1394 PhD preset with the 1402
// grading rules (materiel 49: GPA 16 floor, passing 14).
func smallReg1402PhdFor() RegulationConfig {
	c := regulationPreset1394Phd()
	c.GradingAndGpa = RegulationGradingAndGpa{
		FailedCourseGpaPolicy: "EXCLUDE_ALWAYS",
		DefaultPassingGrade:   14.0,
		RetakeMinGrade:        regFloat(14),
		RegulationLabel:       strPtr("آیین‌نامه ۱۴۰۲ — دکتری تخصصی"),
	}
	return c
}

// Ensure scope import is used even if future refactors drop direct references.
var _ = scope.TermContainsToday
