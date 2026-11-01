// ═══ Tuition engine: rules, annual tariff and equivalence policy — port of admin/tuition ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"backend-go/internal/session"
	"backend-go/internal/tuition"
)

// TuitionRuleRow tuition rule.
type TuitionRuleRow struct {
	ID                int64   `json:"id"`
	DegreeLevelID     *int64  `json:"degreeLevelId"`
	TermType          *string `json:"termType"`
	OfferingType      *string `json:"offeringType"`
	FixedTuition      float64 `json:"fixedTuition"`
	PerUnitTuition    float64 `json:"perUnitTuition"`
	EffectiveFromYear *int    `json:"effectiveFromYear"`
	IsActive          bool    `json:"isActive"`
	Note              *string `json:"note"`
}

// TuitionDegree degree option.
type TuitionDegree struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

// TuitionRulesData tuition engine page data.
type TuitionRulesData struct {
	Rules          []TuitionRuleRow `json:"rules"`
	Degrees        []TuitionDegree  `json:"degrees"`
	EquivFixedMode string           `json:"equivFixedMode"`
}

// TuitionRules list of rules + degree levels + equivalence policy.
func (s *Service) TuitionRules(ctx context.Context, user *session.User, cookie string) (*TuitionRulesData, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := &TuitionRulesData{Rules: []TuitionRuleRow{}, Degrees: []TuitionDegree{}, EquivFixedMode: "ONCE"}
	if uniID == nil {
		return out, errors.New("دانشگاه فعال مشخص نیست.")
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "degreeLevelId", "termType", "offeringType",
		       coalesce("fixedAmount",0)::float8, coalesce("perUnitTheory",0)::float8,
		       "entryYearFrom", coalesce("isActive",1), note
		  from tuition_rules where "universityId" = $1 order by id`, *uniID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var r TuitionRuleRow
		var active int
		if err := rows.Scan(&r.ID, &r.DegreeLevelID, &r.TermType, &r.OfferingType,
			&r.FixedTuition, &r.PerUnitTuition, &r.EffectiveFromYear, &active, &r.Note); err == nil {
			r.IsActive = active != 0
			out.Rules = append(out.Rules, r)
		}
	}
	rows.Close()
	drows, err := s.DB.Pool.Query(ctx, `
		select id, title from degree_level_configs
		 where "universityId" = $1 or "universityId" is null order by id`, *uniID)
	if err == nil {
		for drows.Next() {
			var d TuitionDegree
			if err := drows.Scan(&d.ID, &d.Title); err == nil {
				out.Degrees = append(out.Degrees, d)
			}
		}
		drows.Close()
	}
	if s.Store != nil {
		if v, err := s.Store.Get(ctx, "EQUIV_FIXED_TUITION_MODE"); err == nil {
			out.EquivFixedMode = normalizeEquivMode(v)
		}
	}
	return out, nil
}

func normalizeEquivMode(v string) string {
	u := strings.ToUpper(strings.TrimSpace(v))
	if u == "PER_TERM" || u == "NONE" {
		return u
	}
	return "ONCE"
}

// TuitionRuleInput rule save input.
type TuitionRuleInput struct {
	ID                *int64  `json:"id"`
	DegreeLevelID     *int64  `json:"degreeLevelId"`
	TermType          *string `json:"termType"`
	OfferingType      *string `json:"offeringType"`
	FixedTuition      float64 `json:"fixedTuition"`
	PerUnitTuition    float64 `json:"perUnitTuition"`
	EffectiveFromYear *int    `json:"effectiveFromYear"`
	IsActive          *bool   `json:"isActive"`
	Note              *string `json:"note"`
}

func cleanPtr(p *string) *string {
	if p == nil {
		return nil
	}
	v := strings.TrimSpace(*p)
	if v == "" || v == "null" || v == "undefined" {
		return nil
	}
	return &v
}

func nonNegRound(v float64) float64 {
	if v < 0 {
		return 0
	}
	return float64(int64(v + 0.5))
}

// SaveTuitionRule create/edit rule.
func (s *Service) SaveTuitionRule(ctx context.Context, user *session.User, cookie string, in TuitionRuleInput) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	fixed := nonNegRound(in.FixedTuition)
	perUnit := nonNegRound(in.PerUnitTuition)
	if fixed == 0 && perUnit == 0 {
		return errors.New("دست‌کم یکی از مقادیر «شهریهٔ ثابت» یا «شهریهٔ هر واحد» باید بزرگ‌تر از صفر باشد.")
	}
	active := 1
	if in.IsActive != nil && !*in.IsActive {
		active = 0
	}
	if in.ID != nil && *in.ID > 0 {
		var rowUni *int64
		if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from tuition_rules where id = $1`, *in.ID).Scan(&rowUni); err != nil {
			return errors.New("قاعده یافت نشد.")
		}
		if rowUni != nil && *rowUni != *uniID {
			return errors.New("قاعده متعلق به دانشگاه دیگری است.")
		}
		_, err := s.DB.Pool.Exec(ctx, `
			update tuition_rules set "degreeLevelId" = $2, "termType" = $3, "offeringType" = $4,
			       "fixedAmount" = $5, "perUnitTheory" = $6, "perUnitPractical" = $6, "perUnitGeneral" = $6,
			       "entryYearFrom" = $7, "isActive" = $8, note = $9, "updatedAt" = now()
			 where id = $1 and ("universityId" = $10 or "universityId" is null)`,
			*in.ID, in.DegreeLevelID, cleanPtr(in.TermType), cleanPtr(in.OfferingType),
			fmtNum(fixed), fmtNum(perUnit), in.EffectiveFromYear, active, cleanPtr(in.Note), *uniID)
		return err
	}
	_, err := s.DB.Pool.Exec(ctx, `
		insert into tuition_rules ("universityId","degreeLevelId","termType","offeringType",
		  "fixedAmount","perUnitTheory","perUnitPractical","perUnitGeneral","entryYearFrom","isActive",note,"updatedAt")
		values ($1,$2,$3,$4,$5,$6,$6,$6,$7,$8,$9,now())`,
		*uniID, in.DegreeLevelID, cleanPtr(in.TermType), cleanPtr(in.OfferingType),
		fmtNum(fixed), fmtNum(perUnit), in.EffectiveFromYear, active, cleanPtr(in.Note))
	return err
}

// DeleteTuitionRule delete rule.
func (s *Service) DeleteTuitionRule(ctx context.Context, user *session.User, cookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	var rowUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from tuition_rules where id = $1`, id).Scan(&rowUni); err != nil {
		return errors.New("قاعده یافت نشد.")
	}
	if rowUni != nil && *rowUni != *uniID {
		return errors.New("قاعده متعلق به دانشگاه دیگری است.")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		delete from tuition_rules where id = $1 and ("universityId" = $2 or "universityId" is null)`, id, *uniID)
	return err
}

// ImportLegacyResult import result.
type ImportLegacyResult struct {
	Created int `json:"created"`
	Skipped int `json:"skipped"`
}

// ImportLegacyFeeRules port of importLegacyFeeRulesAction.
func (s *Service) ImportLegacyFeeRules(ctx context.Context, user *session.User, cookie string) (*ImportLegacyResult, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال مشخص نیست.")
	}
	type legacy struct {
		DegreeLevelID  *int64
		Fixed, PerUnit float64
		TermID         int64
		TermCode       string
		TermType       *string
		IsSummer       *int
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select r."degreeLevelId", coalesce(r."fixedTuition",0)::float8, coalesce(r."perUnitTuition",0)::float8,
		       t.id, coalesce(t."termCode",''), t."termType", t."isSummer"
		  from term_financial_rules r
		  join academic_terms t on t.id = r."termId"
		 where (r."universityId" = $1 or r."universityId" is null)
		   and (t."universityId" = $1 or t."universityId" is null)`, *uniID)
	if err != nil {
		return nil, err
	}
	list := []legacy{}
	for rows.Next() {
		var l legacy
		if err := rows.Scan(&l.DegreeLevelID, &l.Fixed, &l.PerUnit, &l.TermID, &l.TermCode, &l.TermType, &l.IsSummer); err == nil {
			list = append(list, l)
		}
	}
	rows.Close()

	// Grouping by (degree, term type) — the last term wins.
	type key struct {
		Degree int64
		Type   string
	}
	type draft struct {
		DegreeLevelID  *int64
		TermType       string
		Fixed, PerUnit float64
		Note           *string
	}
	best := map[key]legacy{}
	for _, l := range list {
		t := string(tuition.TermTypeOf(tuition.TermInput{TermType: l.TermType, TermCode: &l.TermCode, IsSummer: l.IsSummer}))
		deg := int64(0)
		if l.DegreeLevelID != nil {
			deg = *l.DegreeLevelID
		}
		k := key{deg, t}
		prev, ok := best[k]
		if !ok || l.TermID > prev.TermID {
			best[k] = l
		}
	}
	drafts := []draft{}
	for k, l := range best {
		fixed, per := float64(int64(l.Fixed+0.5)), float64(int64(l.PerUnit+0.5))
		if fixed <= 0 && per <= 0 {
			continue
		}
		var d *int64
		if k.Degree > 0 {
			v := k.Degree
			d = &v
		}
		note := "درون‌ریزی از قواعد مالی قدیمی"
		if l.TermCode != "" {
			note = "درون‌ریزی از قواعد مالی قدیمی — نرخ ترم " + l.TermCode
		}
		drafts = append(drafts, draft{DegreeLevelID: d, TermType: k.Type, Fixed: fixed, PerUnit: per, Note: &note})
	}
	sort.Slice(drafts, func(i, j int) bool {
		di, dj := int64(0), int64(0)
		if drafts[i].DegreeLevelID != nil {
			di = *drafts[i].DegreeLevelID
		}
		if drafts[j].DegreeLevelID != nil {
			dj = *drafts[j].DegreeLevelID
		}
		if di != dj {
			return di < dj
		}
		return drafts[i].TermType < drafts[j].TermType
	})

	res := &ImportLegacyResult{}
	for _, d := range drafts {
		var exists int
		err := s.DB.Pool.QueryRow(ctx, `
			select 1 from tuition_rules
			 where ("universityId" = $1 or "universityId" is null)
			   and (("degreeLevelId" = $2) or ($2::bigint is null and "degreeLevelId" is null))
			   and "termType" = $3 and "offeringType" is null and "entryYearFrom" is null limit 1`,
			*uniID, d.DegreeLevelID, d.TermType).Scan(&exists)
		if err == nil {
			res.Skipped++
			continue
		}
		_, err = s.DB.Pool.Exec(ctx, `
			insert into tuition_rules ("universityId","degreeLevelId","majorId","termType","offeringType",
			  "entryYearFrom","entryYearTo","fixedAmount","perUnitTheory","perUnitPractical","perUnitGeneral","isActive",note,"updatedAt")
			values ($1,$2,null,$3,null,null,null,$4,$5,$5,$5,1,$6,now())`,
			*uniID, d.DegreeLevelID, d.TermType, fmtNum(d.Fixed), fmtNum(d.PerUnit), d.Note)
		if err == nil {
			res.Created++
		}
	}
	return res, nil
}

// SetEquivFixedMode save the equivalence policy.
func (s *Service) SetEquivFixedMode(ctx context.Context, user *session.User, mode string) (string, error) {
	value := normalizeEquivMode(mode)
	if s.Store == nil {
		return value, nil
	}
	return value, s.Store.Save(ctx, "EQUIV_FIXED_TUITION_MODE", value)
}

// ─────────────────── Annual tariff ───────────────────

// TariffRate course type rate.
type TariffRate struct {
	MaliType int     `json:"maliType"`
	TH       float64 `json:"th"`
	OP       float64 `json:"op"`
}

// TariffMajor majors/entry cohorts of a group.
type TariffMajor struct {
	Code       string `json:"code"`
	Title      string `json:"title"`
	Faculty    string `json:"faculty"`
	EntryYears []int  `json:"entryYears"`
}

// TariffGroup tariff group (price code).
type TariffGroup struct {
	UPriceCode string        `json:"uPriceCode"`
	Source     string        `json:"source"`
	Rates      []TariffRate  `json:"rates"`
	Majors     []TariffMajor `json:"majors"`
}

// TariffData tariff page data.
type TariffData struct {
	UniversityTitle string        `json:"universityTitle"`
	Years           []int         `json:"years"`
	Year            int           `json:"year"`
	Groups          []TariffGroup `json:"groups"`
}

// Tariff lists the tariff groups for a year.
func (s *Service) Tariff(ctx context.Context, user *session.User, cookie string, wantYear int) (*TariffData, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := &TariffData{Years: []int{}, Groups: []TariffGroup{}}
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال مشخص نیست.")
	}
	_ = s.DB.Pool.QueryRow(ctx, `select title from universities where id = $1`, *uniID).Scan(&out.UniversityTitle)
	yrows, err := s.DB.Pool.Query(ctx, `
		select distinct "termYear" from tuition_term_tariff where "universityId" = $1 order by "termYear" desc`, *uniID)
	if err == nil {
		for yrows.Next() {
			var y *int
			if err := yrows.Scan(&y); err == nil && y != nil && *y > 0 {
				out.Years = append(out.Years, *y)
			}
		}
		yrows.Close()
	}
	year := 0
	for _, y := range out.Years {
		if y == wantYear {
			year = y
		}
	}
	if year == 0 && len(out.Years) > 0 {
		year = out.Years[0]
	}
	out.Year = year
	if year == 0 {
		return out, nil
	}
	type trow struct {
		UPriceCode *string
		MaliType   int
		TH, OP     float64
		EntryYear  int
		MajorCode  *string
		MajorTitle *string
		Faculty    *string
		Source     *string
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select t."uPriceCode", t."maliType", coalesce(t."thPrice",0)::float8, coalesce(t."opPrice",0)::float8,
		       coalesce(t."entryYear",0), m."majorCode", m.name, f.name, t.source
		  from tuition_term_tariff t
		  left join majors m on m.id = t."majorId"
		  left join faculties f on f.id = m."facultyId"
		 where t."universityId" = $1 and t."termYear" = $2
		 order by t."uPriceCode", t."maliType"`, *uniID, year)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	rateByCode := map[string]map[int]TariffRate{}
	majorByCode := map[string]map[string]*TariffMajor{}
	sourceByCode := map[string]string{}
	codes := []string{}
	for rows.Next() {
		var r trow
		if err := rows.Scan(&r.UPriceCode, &r.MaliType, &r.TH, &r.OP, &r.EntryYear,
			&r.MajorCode, &r.MajorTitle, &r.Faculty, &r.Source); err != nil {
			continue
		}
		code := "—"
		if r.UPriceCode != nil && strings.TrimSpace(*r.UPriceCode) != "" {
			code = *r.UPriceCode
		}
		if rateByCode[code] == nil {
			rateByCode[code] = map[int]TariffRate{}
			majorByCode[code] = map[string]*TariffMajor{}
			codes = append(codes, code)
			if r.Source != nil {
				sourceByCode[code] = *r.Source
			}
		}
		if _, ok := rateByCode[code][r.MaliType]; !ok {
			rateByCode[code][r.MaliType] = TariffRate{MaliType: r.MaliType, TH: r.TH, OP: r.OP}
		}
		mkey := ""
		if r.MajorCode != nil {
			mkey = *r.MajorCode
		}
		m := majorByCode[code][mkey]
		if m == nil {
			title := ""
			if r.MajorTitle != nil {
				title = *r.MajorTitle
			}
			faculty := ""
			if r.Faculty != nil {
				faculty = *r.Faculty
			}
			m = &TariffMajor{Code: mkey, Title: title, Faculty: faculty, EntryYears: []int{}}
			majorByCode[code][mkey] = m
		}
		found := false
		for _, y := range m.EntryYears {
			if y == r.EntryYear {
				found = true
				break
			}
		}
		if !found {
			m.EntryYears = append(m.EntryYears, r.EntryYear)
		}
	}
	sort.Strings(codes)
	for _, code := range codes {
		g := TariffGroup{UPriceCode: code, Source: sourceByCode[code], Rates: []TariffRate{}, Majors: []TariffMajor{}}
		for _, rate := range rateByCode[code] {
			g.Rates = append(g.Rates, rate)
		}
		sort.Slice(g.Rates, func(i, j int) bool { return g.Rates[i].MaliType < g.Rates[j].MaliType })
		for _, m := range majorByCode[code] {
			sort.Ints(m.EntryYears)
			g.Majors = append(g.Majors, *m)
		}
		sort.Slice(g.Majors, func(i, j int) bool { return g.Majors[i].Code < g.Majors[j].Code })
		out.Groups = append(out.Groups, g)
	}
	return out, nil
}

// TariffRateInput is the rate input.
type TariffRateInput struct {
	MaliType int     `json:"maliType"`
	TH       float64 `json:"th"`
	OP       float64 `json:"op"`
}

func tariffYearOK(y int) bool { return y >= 1380 && y <= 1450 }

// SaveTariffGroup saves the rates of one tariff group for a year.
func (s *Service) SaveTariffGroup(ctx context.Context, user *session.User, cookie string, year int, uPriceCode string, rates []TariffRateInput) (int, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال مشخص نیست.")
	}
	code := strings.TrimSpace(uPriceCode)
	if !tariffYearOK(year) || code == "" {
		return 0, errors.New("سال یا گروه تعرفه نامعتبر است.")
	}
	if len(rates) == 0 {
		return 0, errors.New("نرخی برای ذخیره نیامده است.")
	}
	updated := 0
	for _, r := range rates {
		th := nonNegRound(r.TH)
		op := nonNegRound(r.OP)
		tag, err := s.DB.Pool.Exec(ctx, `
			update tuition_term_tariff set "thPrice" = $5, "opPrice" = $6, source = 'MANUAL', "updatedAt" = now()
			 where "universityId" = $1 and "termYear" = $2 and "uPriceCode" = $3 and "maliType" = $4`,
			*uniID, year, code, r.MaliType, fmtNum(th), fmtNum(op))
		if err == nil {
			updated += int(tag.RowsAffected())
		}
	}
	return updated, nil
}

// shiftPriceCodeYear is a port of shiftPriceCodeYear.
func shiftPriceCodeYear(code *string, fromYear, toYear int) *string {
	if code == nil {
		return nil
	}
	c := strings.TrimSpace(*code)
	if len(c) < 5 || len(c) > 8 {
		if c == "" {
			return nil
		}
		return &c
	}
	allDigits := true
	for _, r := range c {
		if r < '0' || r > '9' {
			allDigits = false
			break
		}
	}
	if !allDigits {
		return &c
	}
	idx := len(c) - 4
	if c[idx] != byte('0'+fromYear%10) {
		return &c
	}
	out := c[:idx] + string(byte('0'+toYear%10)) + c[idx+1:]
	return &out
}

// CopyTariffYear copies one year's tariff to the next year, rewriting the year digit in the price code.
func (s *Service) CopyTariffYear(ctx context.Context, user *session.User, cookie string, fromYear, toYear int, overwrite bool) (int, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال مشخص نیست.")
	}
	if !tariffYearOK(fromYear) || !tariffYearOK(toYear) || toYear <= fromYear {
		return 0, errors.New("سال‌ها نامعتبرند (سال مقصد باید بعد از مبدأ باشد).")
	}
	type row struct {
		MajorID    *int64
		EntryYear  *int
		MaliType   int
		TH, OP     string
		UPriceCode *string
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select "majorId", "entryYear", "maliType", "thPrice"::text, "opPrice"::text, "uPriceCode"
		  from tuition_term_tariff where "universityId" = $1 and "termYear" = $2`, *uniID, fromYear)
	if err != nil {
		return 0, err
	}
	list := []row{}
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.MajorID, &r.EntryYear, &r.MaliType, &r.TH, &r.OP, &r.UPriceCode); err == nil {
			list = append(list, r)
		}
	}
	rows.Close()
	if len(list) == 0 {
		return 0, fmt.Errorf("تعرفه‌ای برای سال %d ثبت نشده است.", fromYear)
	}
	var existing int
	_ = s.DB.Pool.QueryRow(ctx, `
		select 1 from tuition_term_tariff where "universityId" = $1 and "termYear" = $2 limit 1`, *uniID, toYear).Scan(&existing)
	if existing == 1 && !overwrite {
		return 0, fmt.Errorf("تعرفهٔ سال %d از قبل وجود دارد. برای بازنویسی، «بازنویسی» را بزنید.", toYear)
	}
	if existing == 1 {
		if _, err := s.DB.Pool.Exec(ctx, `
			delete from tuition_term_tariff where "universityId" = $1 and "termYear" = $2`, *uniID, toYear); err != nil {
			return 0, err
		}
	}
	termCode := strconv.Itoa(toYear) + "1"
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	for _, r := range list {
		if _, err := tx.Exec(ctx, `
			insert into tuition_term_tariff ("universityId","termCode","termYear","majorId","entryYear","maliType",
			  "thPrice","opPrice","uPriceCode",source,"updatedAt")
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'MANUAL',now())`,
			*uniID, termCode, toYear, r.MajorID, r.EntryYear, r.MaliType, r.TH, r.OP,
			shiftPriceCodeYear(r.UPriceCode, fromYear, toYear)); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(list), nil
}
