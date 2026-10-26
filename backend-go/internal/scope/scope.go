// ═══ دانشگاه/نیمسال — پورت از university-scope.ts و term-scope.ts ═══
//
// کوکی‌ها فقط «انتخاب»اند نه «مجوز»: مرز امنیتی چندمؤسسه‌ای =
// users.universityId + expert_scopes (UNIVERSITY)؛ ADMIN بدون universityId
// حساب پلتفرمی است و همه را می‌بیند. DENY означает fail-closed (شناسهٔ ۰).
package scope

import (
	"context"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/fa"
	"backend-go/internal/session"
)

// نام کوکی‌های scope — عیناً سامانهٔ فعلی.
const (
	UniversityCookie  = "afagh_uni"
	TermCookie        = "afagh_term"
	TermSwitcherLimit = 30
)

// UniScope دانشگاه قابل انتخاب.
type UniScope struct {
	ID      int64   `json:"id"`
	Code    string  `json:"code"`
	Title   string  `json:"title"`
	Kind    string  `json:"kind"`
	LogoURL *string `json:"logoUrl"`
}

// DenyUni دانشگاهِ «هیچ‌کدام» — وقتی کاربر به هیچ دانشگاهی مجاز نیست.
var DenyUni = UniScope{ID: 0, Code: "", Title: "—", Kind: "NONE"}

// FallbackUni پیش‌فرض وقتی جدول دانشگاه‌ها هنوز ساخته نشده (نصب تازه).
var FallbackUni = UniScope{ID: 1, Code: "AFAGH", Title: "دانشگاه آفاق", Kind: "OWN"}

// TermScope یک نیمسال در سوییچر.
type TermScope struct {
	ID                 int64      `json:"id"`
	TermCode           string     `json:"termCode"`
	Title              string     `json:"title"`
	StartDate          *time.Time `json:"startDate"`
	EndDate            *time.Time `json:"endDate"`
	IsCurrent          bool       `json:"isCurrent"`
	IsEffectiveCurrent bool       `json:"isEffectiveCurrent"`
	TermType           *string    `json:"termType"`
	AcademicYear       *int       `json:"academicYear"`
	SortOrder          *int       `json:"sortOrder"`
}

// Service دسترسی به دانشگاه/ترم روی استخر مالک.
type Service struct{ Pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Service { return &Service{Pool: pool} }

// ─────────────────────────── دانشگاه ───────────────────────────

// allUniversities همان allUniversities در university-scope.ts.
func (s *Service) allUniversities(ctx context.Context) ([]UniScope, error) {
	rows, err := s.Pool.Query(ctx,
		`select id, code, title, kind, "logoUrl" from universities order by id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UniScope{}
	for rows.Next() {
		var u UniScope
		if err := rows.Scan(&u.ID, &u.Code, &u.Title, &u.Kind, &u.LogoURL); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// authorizedUniversityIDs فهرست مجاز — خروجی nil یعنی «نامحدود» (حساب پلتفرمی).
func (s *Service) authorizedUniversityIDs(ctx context.Context, user *session.User) ([]int64, error) {
	if user == nil {
		return []int64{}, nil
	}
	ids := map[int64]bool{}
	if user.UniversityID != nil {
		ids[*user.UniversityID] = true
	}
	hasRole := func(r string) bool {
		for _, x := range user.Roles {
			if x == r {
				return true
			}
		}
		return false
	}

	// مدیر پلتفرمی باید پیش از fallbackهای students/staff شناسایی شود.
	if len(ids) == 0 && hasRole("ADMIN") {
		return nil, nil
	}

	if hasRole("EDU_EXPERT") {
		rows, err := s.Pool.Query(ctx,
			`select "scopeType", "scopeId", "universityId" from expert_scopes where "userId" = $1`, user.ID)
		if err == nil {
			for rows.Next() {
				var st string
				var scopeID, uniID *int64
				if err := rows.Scan(&st, &scopeID, &uniID); err != nil {
					break
				}
				var id *int64
				if st == "UNIVERSITY" {
					if scopeID != nil {
						id = scopeID
					} else {
						id = uniID
					}
				} else {
					id = uniID
				}
				if id != nil {
					ids[*id] = true
				}
			}
			rows.Close()
		}
	}

	// کاربری که فقط از راه رکورد دانشجو/کارمند به دانشگاه وصل است.
	if len(ids) == 0 {
		var uniID *int64
		if err := s.Pool.QueryRow(ctx,
			`select "universityId" from students where "userId" = $1 limit 1`, user.ID).Scan(&uniID); err == nil && uniID != nil {
			ids[*uniID] = true
		}
		uniID = nil
		if err := s.Pool.QueryRow(ctx,
			`select "universityId" from staff where "userId" = $1 limit 1`, user.ID).Scan(&uniID); err == nil && uniID != nil {
			ids[*uniID] = true
		}
	}

	if len(ids) == 0 {
		if hasRole("ADMIN") {
			return nil, nil
		}
		return []int64{}, nil
	}
	out := make([]int64, 0, len(ids))
	for id := range ids {
		out = append(out, id)
	}
	return out, nil
}

// CurrentUniversity دانشگاه فعال — کوکی فقط درون دانشگاه‌های مجاز پذیرفته می‌شود.
func (s *Service) CurrentUniversity(ctx context.Context, user *session.User, wantCode string) (UniScope, error) {
	all, err := s.allUniversities(ctx)
	if err != nil {
		return DenyUni, nil // fail-closed
	}
	allowed, err := s.authorizedUniversityIDs(ctx, user)
	if err != nil {
		allowed = []int64{}
	}
	if len(all) == 0 {
		if allowed == nil {
			return FallbackUni, nil
		}
		return DenyUni, nil
	}

	pool := all
	if allowed != nil {
		allowedSet := map[int64]bool{}
		for _, id := range allowed {
			allowedSet[id] = true
		}
		pool = pool[:0:0]
		for _, u := range all {
			if allowedSet[u.ID] {
				pool = append(pool, u)
			}
		}
	}
	if len(pool) == 0 {
		return DenyUni, nil
	}
	want := strings.TrimSpace(wantCode)
	if want != "" {
		for _, u := range pool {
			if u.Code == want {
				return u, nil
			}
		}
	}
	return pool[0], nil
}

// ListUniversities همهٔ دانشگاه‌های مجاز برای سوییچر سربرگ.
func (s *Service) ListUniversities(ctx context.Context, user *session.User) ([]UniScope, error) {
	all, err := s.allUniversities(ctx)
	if err != nil {
		return []UniScope{}, nil
	}
	allowed, _ := s.authorizedUniversityIDs(ctx, user)
	if len(all) == 0 {
		if allowed == nil {
			return []UniScope{FallbackUni}, nil
		}
		return []UniScope{}, nil
	}
	if allowed == nil {
		return all, nil
	}
	allowedSet := map[int64]bool{}
	for _, id := range allowed {
		allowedSet[id] = true
	}
	out := []UniScope{}
	for _, u := range all {
		if allowedSet[u.ID] {
			out = append(out, u)
		}
	}
	return out, nil
}

// CanActOnUniversity آیا کاربر اجازهٔ کار با این دانشگاه را دارد؟
func (s *Service) CanActOnUniversity(ctx context.Context, user *session.User, universityID *int64) bool {
	if universityID == nil {
		return false
	}
	allowed, _ := s.authorizedUniversityIDs(ctx, user)
	if allowed == nil {
		return true // حساب پلتفرمی
	}
	for _, id := range allowed {
		if id == *universityID {
			return true
		}
	}
	return false
}

// ─────────────────────────── نیمسال ───────────────────────────

var hiddenTermTypes = map[string]bool{"EQUIVALENCE": true, "SPECIAL": true}

func normalizeTermType(t *string) string {
	if t == nil {
		return ""
	}
	return strings.ToUpper(strings.TrimSpace(*t))
}

// isTeachingTerm ترم آموزشی = هر چیزی جز EQUIVALENCE/SPECIAL.
func isTeachingTerm(t *string) bool {
	typ := normalizeTermType(t)
	if typ == "" {
		return true
	}
	return !hiddenTermTypes[typ]
}

// TermSemesterIndex ایندکس نیمسال از رقم آخر کد ترم (ارقام فارسی هم پذیرفته).
func TermSemesterIndex(termCode string) int {
	digits := fa.ToEnDigits(strings.TrimSpace(termCode))
	if digits == "" {
		return 3
	}
	switch digits[len(digits)-1] {
	case '1':
		return 0
	case '2':
		return 1
	case '3':
		return 2
	}
	return 3
}

// TermAcademicYear سال تحصیلی — ستون، وگرنه ۴ رقم اول کد.
func TermAcademicYear(t TermScope) *int {
	if t.AcademicYear != nil {
		return t.AcademicYear
	}
	code := fa.ToEnDigits(strings.TrimSpace(t.TermCode))
	if len(code) < 4 {
		return nil
	}
	head := code[:4]
	n := 0
	for _, r := range head {
		if r < '0' || r > '9' {
			return nil
		}
		n = n*10 + int(r-'0')
	}
	return &n
}

// TermCodeNumber عدد کد ترم (ارقام فارسی → لاتین)؛ نامعتبر = کمترین.
func TermCodeNumber(termCode string) float64 {
	digits := fa.ToEnDigits(strings.TrimSpace(termCode))
	if digits == "" {
		return math.Inf(-1)
	}
	var n float64
	for _, r := range digits {
		if r < '0' || r > '9' {
			return math.Inf(-1)
		}
		n = n*10 + float64(r-'0')
	}
	return n
}

// SortTermsChronologically مرتب‌سازی زمانی — پورت sortTermsChronologically.
func SortTermsChronologically(terms []TermScope) []TermScope {
	type ranked struct {
		t     TermScope
		index int
		year  float64
		sem   int
		code  float64
		id    float64
	}
	items := make([]ranked, 0, len(terms))
	for i, t := range terms {
		year := math.Inf(-1)
		if y := TermAcademicYear(t); y != nil {
			year = float64(*y)
		}
		id := math.Inf(-1)
		if t.ID > 0 {
			id = float64(t.ID)
		}
		items = append(items, ranked{t: t, index: i, year: year, sem: TermSemesterIndex(t.TermCode), code: TermCodeNumber(t.TermCode), id: id})
	}
	sort.SliceStable(items, func(a, b int) bool {
		x, y := items[a], items[b]
		if x.year != y.year {
			return x.year > y.year
		}
		if x.sem != y.sem {
			return x.sem < y.sem
		}
		if x.code != y.code {
			return x.code > y.code
		}
		if x.id != y.id {
			return x.id < y.id
		}
		return x.index < y.index
	})
	out := make([]TermScope, 0, len(items))
	for _, it := range items {
		out = append(out, it.t)
	}
	return out
}

// TermContainsToday آیا امروز بین شروع و پایان ترم است؟
func TermContainsToday(t TermScope, today time.Time) bool {
	if t.StartDate == nil {
		return false
	}
	if today.Before(*t.StartDate) {
		return false
	}
	if t.EndDate == nil {
		return true
	}
	return !today.After(*t.EndDate)
}

// PickEffectiveTerm ترم مؤثر: شامل امروز → پرچم isCurrent → آخرین شروع‌شده → نزدیک‌ترین آینده.
func PickEffectiveTerm(terms []TermScope, today time.Time) *TermScope {
	if len(terms) == 0 {
		return nil
	}
	byStartDesc := func(list []TermScope) []TermScope {
		out := make([]TermScope, len(list))
		copy(out, list)
		sort.SliceStable(out, func(a, b int) bool {
			var av, bv time.Time
			if out[a].StartDate != nil {
				av = *out[a].StartDate
			}
			if out[b].StartDate != nil {
				bv = *out[b].StartDate
			}
			// نزولی: تاریخ شروع جدیدتر اول — معادل (b - a) در byStartDesc.ts
			return av.After(bv)
		})
		return out
	}
	containing := []TermScope{}
	for _, t := range terms {
		if TermContainsToday(t, today) {
			containing = append(containing, t)
		}
	}
	if len(containing) > 0 {
		return &byStartDesc(containing)[0]
	}
	flagged := []TermScope{}
	for _, t := range terms {
		if t.IsCurrent {
			flagged = append(flagged, t)
		}
	}
	if len(flagged) > 0 {
		return &byStartDesc(flagged)[0]
	}
	started := []TermScope{}
	for _, t := range terms {
		if t.StartDate != nil && !t.StartDate.After(today) {
			started = append(started, t)
		}
	}
	if len(started) > 0 {
		return &byStartDesc(started)[0]
	}
	upcoming := []TermScope{}
	for _, t := range terms {
		if t.StartDate != nil && t.StartDate.After(today) {
			upcoming = append(upcoming, t)
		}
	}
	if len(upcoming) == 0 {
		return nil
	}
	// نزدیک‌ترین آینده = کوچک‌ترین startDate
	sort.SliceStable(upcoming, func(a, b int) bool {
		return upcoming[a].StartDate.Before(*upcoming[b].StartDate)
	})
	return &upcoming[0]
}

// loadOrderedTerms واکشی + فیلتر آموزشی + مرتب‌سازی + علامت ترم مؤثر.
func (s *Service) loadOrderedTerms(ctx context.Context, universityID *int64) []TermScope {
	if universityID == nil || *universityID <= 0 {
		return []TermScope{}
	}
	rows, err := s.Pool.Query(ctx,
		`select id, "termCode", title, "startDate", "endDate", "isCurrent", "termType", "academicYear", "sortOrder"
		   from academic_terms where "universityId" = $1 order by id desc`, *universityID)
	if err != nil {
		return []TermScope{}
	}
	defer rows.Close()
	visible := []TermScope{}
	for rows.Next() {
		var t TermScope
		var isCurrent *int
		if err := rows.Scan(&t.ID, &t.TermCode, &t.Title, &t.StartDate, &t.EndDate, &isCurrent, &t.TermType, &t.AcademicYear, &t.SortOrder); err != nil {
			return []TermScope{}
		}
		t.IsCurrent = isCurrent != nil && *isCurrent != 0
		if isTeachingTerm(t.TermType) {
			visible = append(visible, t)
		}
	}
	ordered := SortTermsChronologically(visible)
	if eff := PickEffectiveTerm(ordered, time.Now()); eff != nil {
		for i := range ordered {
			if ordered[i].ID == eff.ID {
				ordered[i].IsEffectiveCurrent = true
			}
		}
	}
	return ordered
}

// ListTermsForUniversity فهرست ترم‌های آموزشی (سقف ۳۰) — پورت listTermsForUniversity.
func (s *Service) ListTermsForUniversity(ctx context.Context, universityID *int64) []TermScope {
	ordered := s.loadOrderedTerms(ctx, universityID)
	if len(ordered) > TermSwitcherLimit {
		ordered = ordered[:TermSwitcherLimit]
	}
	return ordered
}

// TermSelection نتیجهٔ انتخاب ترم: فهرست + شناسهٔ انتخاب‌شده + ترم مؤثر.
type TermSelection struct {
	Terms       []TermScope `json:"terms"`
	SelectedID  *int64      `json:"selectedId"`
	EffectiveID *int64      `json:"effectiveId"`
}

// GetTermScope پورت getTermScope — کوکی فقط اگر در فهرست باشد؛ انتخاب‌شدهٔ
// خارج از سقف به فهرست افزوده می‌شود (resolveSelectedTerm).
func (s *Service) GetTermScope(ctx context.Context, universityID *int64, wantedID *int64) TermSelection {
	ordered := s.loadOrderedTerms(ctx, universityID)
	var effectiveID *int64
	for _, t := range ordered {
		if t.IsEffectiveCurrent {
			id := t.ID
			effectiveID = &id
			break
		}
	}

	capped := ordered
	if len(capped) > TermSwitcherLimit {
		capped = capped[:TermSwitcherLimit]
	}
	sel := TermSelection{Terms: capped, EffectiveID: effectiveID}
	if wantedID != nil {
		var picked *TermScope
		for i := range ordered {
			if ordered[i].ID == *wantedID {
				picked = &ordered[i]
				break
			}
		}
		if picked != nil {
			sel.SelectedID = wantedID
			found := false
			for _, t := range capped {
				if t.ID == *wantedID {
					found = true
					break
				}
			}
			if !found {
				sel.Terms = append(append([]TermScope{}, capped...), *picked)
			}
		}
	}
	return sel
}

// ValidateTermForUniversity آیا ترم متعلق به این دانشگاه است؟ (برای POST scope/term)
func (s *Service) ValidateTermForUniversity(ctx context.Context, termID, universityID int64) bool {
	var id int64
	err := s.Pool.QueryRow(ctx,
		`select id from academic_terms where id = $1 and "universityId" = $2`, termID, universityID).Scan(&id)
	return err == nil
}

// ListAllTermsForUniversity فهرست بدون سقف ترم‌ها — برای محاسبهٔ شمارهٔ ترم.
func (s *Service) ListAllTermsForUniversity(ctx context.Context, universityID *int64) []TermScope {
	return s.loadOrderedTerms(ctx, universityID)
}

// TermOrdinalForEntry پورت termOrdinalForEntry: شمارهٔ ترتیب ترم تحصیلی بر مبنای
// ورودی — هر سال = ۲ نیمسال؛ مستقل از تعداد ترم‌های ثبت‌شده.
func TermOrdinalForEntry(entryYear *int, entryTerm *int, targetTermCode string) *int {
	if entryYear == nil || strings.TrimSpace(targetTermCode) == "" {
		return nil
	}
	et := 1
	if entryTerm != nil {
		et = *entryTerm
	}
	entryCode := float64(*entryYear*10 + et)
	targetCode := TermCodeNumber(targetTermCode)
	if math.IsInf(targetCode, -1) {
		return nil
	}
	semOf := func(code float64) float64 {
		return math.Floor(code/10)*2 + math.Mod(code, 10)
	}
	ord := int(semOf(targetCode) - semOf(entryCode) + 1)
	if ord < 1 {
		return nil
	}
	return &ord
}
