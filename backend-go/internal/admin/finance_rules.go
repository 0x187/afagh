// ═══ تعاریف موتور مالی — پورت admin/finance/rules ═══
package admin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"

	"backend-go/internal/session"
)

// ─────────────────── خواندن کاتالوگ‌ها ───────────────────

// DiscountType نوع تخفیف.
type DiscountType struct {
	ID               int64    `json:"id"`
	Code             string   `json:"code"`
	Title            string   `json:"title"`
	Kind             string   `json:"kind"`
	DefaultPercent   float64  `json:"defaultPercent"`
	DefaultAmount    float64  `json:"defaultAmount"`
	MaxPercent       *float64 `json:"maxPercent"`
	RequiresApproval bool     `json:"requiresApproval"`
	RequiresDocument bool     `json:"requiresDocument"`
	IsActive         bool     `json:"isActive"`
	Note             *string  `json:"note"`
}

// Sponsor بنیاد حامی.
type Sponsor struct {
	ID               int64   `json:"id"`
	Code             string  `json:"code"`
	Title            string  `json:"title"`
	ContactInfo      *string `json:"contactInfo"`
	SettlementMethod string  `json:"settlementMethod"`
	IsActive         bool    `json:"isActive"`
	Note             *string `json:"note"`
}

// TuitionFormula فرمول شهریه.
type TuitionFormula struct {
	ID             int64    `json:"id"`
	Code           string   `json:"code"`
	Title          string   `json:"title"`
	DegreeLevelID  *int64   `json:"degreeLevelId"`
	MajorID        *int64   `json:"majorId"`
	EntryYearFrom  *int     `json:"entryYearFrom"`
	EntryYearTo    *int     `json:"entryYearTo"`
	FixedAmount    float64  `json:"fixedAmount"`
	PerUnitTheory  float64  `json:"perUnitTheory"`
	PerUnitPractical float64 `json:"perUnitPractical"`
	PerUnitGeneral float64  `json:"perUnitGeneral"`
	Priority       int      `json:"priority"`
	IsActive       bool     `json:"isActive"`
	Note           *string  `json:"note"`
}

// LoanProduct نهاد وام.
type LoanProduct struct {
	ID                  int64    `json:"id"`
	Code                string   `json:"code"`
	Title               string   `json:"title"`
	Lender              string   `json:"lender"`
	MaxAmount           *float64 `json:"maxAmount"`
	DefaultAmount       float64  `json:"defaultAmount"`
	DefaultInstallments int      `json:"defaultInstallments"`
	IsInterestFree      bool     `json:"isInterestFree"`
	RequiresApproval    bool     `json:"requiresApproval"`
	IsActive            bool     `json:"isActive"`
	Note                *string  `json:"note"`
}

// TuitionCoefficient ضریب افزایشی نیمسال.
type TuitionCoefficient struct {
	ID                int64   `json:"id"`
	TermID            *int64  `json:"termId"`
	VariableCoefficient float64 `json:"variableCoefficient"`
	FixedCoefficient  float64 `json:"fixedCoefficient"`
	Note              *string `json:"note"`
	TermTitle         *string `json:"termTitle"`
	TermCode          *string `json:"termCode"`
}

// SubjectFeeType مبلغ موضوعی.
type SubjectFeeType struct {
	ID              int64   `json:"id"`
	Code            string  `json:"code"`
	Title           string  `json:"title"`
	Kind            string  `json:"kind"`
	FixedAmount     float64 `json:"fixedAmount"`
	VariablePercent float64 `json:"variablePercent"`
	AppliesTo       *string `json:"appliesTo"`
	IsActive        bool    `json:"isActive"`
	Note            *string `json:"note"`
}

// OptionItem گزینهٔ انتخابی.
type OptionItem struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

// TermOption گزینهٔ ترم.
type TermOption struct {
	ID       int64  `json:"id"`
	TermCode string `json:"termCode"`
	TermTitle string `json:"termTitle"`
}

// FinanceRulesResponse پاسخ صفحهٔ تعاریف موتور مالی.
type FinanceRulesResponse struct {
	DiscountTypes  []DiscountType        `json:"discountTypes"`
	Sponsors       []Sponsor             `json:"sponsors"`
	Formulas       []TuitionFormula      `json:"formulas"`
	Degrees        []OptionItem          `json:"degrees"`
	Majors         []OptionItem          `json:"majors"`
	LoanProducts   []LoanProduct         `json:"loanProducts"`
	Coefficients   []TuitionCoefficient  `json:"coefficients"`
	SubjectFees    []SubjectFeeType      `json:"subjectFeeTypes"`
	Terms          []TermOption          `json:"terms"`
}

// ListFinanceRules پورت page admin/finance/rules — همهٔ کاتالوگ‌ها در یک پاسخ.
func (s *Service) ListFinanceRules(ctx context.Context, user *session.User, uniCookie string) (*FinanceRulesResponse, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	resp := &FinanceRulesResponse{
		DiscountTypes: []DiscountType{}, Sponsors: []Sponsor{}, Formulas: []TuitionFormula{},
		Degrees: []OptionItem{}, Majors: []OptionItem{}, LoanProducts: []LoanProduct{},
		Coefficients: []TuitionCoefficient{}, SubjectFees: []SubjectFeeType{}, Terms: []TermOption{},
	}
	if uniID == nil {
		return resp, nil
	}
	uni := *uniID
	scope := ` where ("universityId" = $1 or "universityId" is null)`

	// انواع تخفیف
	rows, err := s.DB.Pool.Query(ctx, `
		select id, coalesce(code,''), coalesce(title,''), coalesce(kind,'PERCENT'),
		       "defaultPercent"::float8, "defaultAmount"::float8, "maxPercent"::float8,
		       "requiresApproval", "requiresDocument", "isActive", note
		  from tuition_discount_types`+scope+` order by title`, uni)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d DiscountType
		var appr, doc, active *int
		if err := rows.Scan(&d.ID, &d.Code, &d.Title, &d.Kind, &d.DefaultPercent, &d.DefaultAmount, &d.MaxPercent,
			&appr, &doc, &active, &d.Note); err == nil {
			d.RequiresApproval = appr != nil && *appr == 1
			d.RequiresDocument = doc != nil && *doc == 1
			d.IsActive = active != nil && *active == 1
			resp.DiscountTypes = append(resp.DiscountTypes, d)
		}
	}
	rows.Close()

	// بنیادها
	rows, err = s.DB.Pool.Query(ctx, `
		select id, coalesce(code,''), coalesce(title,''), "contactInfo",
		       coalesce("settlementMethod",'DIRECT'), "isActive", note
		  from tuition_sponsors`+scope+` order by title`, uni)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var sp Sponsor
		var active *int
		if err := rows.Scan(&sp.ID, &sp.Code, &sp.Title, &sp.ContactInfo, &sp.SettlementMethod, &active, &sp.Note); err == nil {
			sp.IsActive = active != nil && *active == 1
			resp.Sponsors = append(resp.Sponsors, sp)
		}
	}
	rows.Close()

	// فرمول‌ها
	rows, err = s.DB.Pool.Query(ctx, `
		select id, coalesce(code,''), coalesce(title,''), "degreeLevelId", "majorId",
		       "entryYearFrom", "entryYearTo", "fixedAmount"::float8, "perUnitTheory"::float8,
		       "perUnitPractical"::float8, "perUnitGeneral"::float8, priority, "isActive", note
		  from tuition_rules`+scope+` order by priority, id`, uni)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var f TuitionFormula
		var active *int
		if err := rows.Scan(&f.ID, &f.Code, &f.Title, &f.DegreeLevelID, &f.MajorID,
			&f.EntryYearFrom, &f.EntryYearTo, &f.FixedAmount, &f.PerUnitTheory,
			&f.PerUnitPractical, &f.PerUnitGeneral, &f.Priority, &active, &f.Note); err == nil {
			f.IsActive = active != nil && *active == 1
			resp.Formulas = append(resp.Formulas, f)
		}
	}
	rows.Close()

	// مقاطع
	rows, err = s.DB.Pool.Query(ctx, `
		select id, title from degree_level_configs`+scope+` order by title`, uni)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d OptionItem
		if err := rows.Scan(&d.ID, &d.Title); err == nil {
			resp.Degrees = append(resp.Degrees, d)
		}
	}
	rows.Close()

	// رشته‌ها
	rows, err = s.DB.Pool.Query(ctx, `
		select id, name from majors`+scope+` order by name`, uni)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var m OptionItem
		if err := rows.Scan(&m.ID, &m.Title); err == nil {
			resp.Majors = append(resp.Majors, m)
		}
	}
	rows.Close()

	// نهادهای وام
	rows, err = s.DB.Pool.Query(ctx, `
		select id, coalesce(code,''), coalesce(title,''), coalesce(lender,''),
		       "maxAmount"::float8, "defaultAmount"::float8, "defaultInstallments",
		       "isInterestFree", "requiresApproval", "isActive", note
		  from loan_products`+scope+` order by title`, uni)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var l LoanProduct
		var free, appr, active *int
		if err := rows.Scan(&l.ID, &l.Code, &l.Title, &l.Lender, &l.MaxAmount, &l.DefaultAmount,
			&l.DefaultInstallments, &free, &appr, &active, &l.Note); err == nil {
			l.IsInterestFree = free != nil && *free == 1
			l.RequiresApproval = appr != nil && *appr == 1
			l.IsActive = active != nil && *active == 1
			resp.LoanProducts = append(resp.LoanProducts, l)
		}
	}
	rows.Close()

	// ضرایب نیمسال
	rows, err = s.DB.Pool.Query(ctx, `
		select tc.id, tc."termId", tc."variable_coefficient"::float8, tc."fixed_coefficient"::float8,
		       tc.note, t.title, t."termCode"
		  from tuition_coefficients tc
		  left join academic_terms t on t.id = tc."termId"
		 where (tc."universityId" = $1 or tc."universityId" is null)
		 order by tc.id`, uni)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var c TuitionCoefficient
		if err := rows.Scan(&c.ID, &c.TermID, &c.VariableCoefficient, &c.FixedCoefficient, &c.Note, &c.TermTitle, &c.TermCode); err == nil {
			resp.Coefficients = append(resp.Coefficients, c)
		}
	}
	rows.Close()

	// مبالغ موضوعی
	rows, err = s.DB.Pool.Query(ctx, `
		select id, coalesce(code,''), coalesce(title,''), coalesce(kind,''),
		       "fixed_amount"::float8, "variable_percent"::float8, "applies_to", "is_active", note
		  from subject_fee_types`+scope+` order by code`, uni)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var f SubjectFeeType
		var active *int
		if err := rows.Scan(&f.ID, &f.Code, &f.Title, &f.Kind, &f.FixedAmount, &f.VariablePercent, &f.AppliesTo, &active, &f.Note); err == nil {
			f.IsActive = active != nil && *active == 1
			resp.SubjectFees = append(resp.SubjectFees, f)
		}
	}
	rows.Close()

	// ترم‌ها
	rows, err = s.DB.Pool.Query(ctx, `
		select id, coalesce("termCode",''), title from academic_terms`+scope+` order by "termCode"`, uni)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var t TermOption
		if err := rows.Scan(&t.ID, &t.TermCode, &t.TermTitle); err == nil {
			resp.Terms = append(resp.Terms, t)
		}
	}
	rows.Close()

	return resp, nil
}

// ─────────────────── کمکی‌های مرز دانشگاه ───────────────────

// assertRowUni رکورد باید متعلق به دانشگاه فعال (یا سراسری) باشد.
func (s *Service) assertRowUni(ctx context.Context, table string, id, uniID int64) error {
	var rowUni *int64
	err := s.DB.Pool.QueryRow(ctx, `select "universityId" from `+table+` where id = $1`, id).Scan(&rowUni)
	if err != nil {
		return errors.New("رکورد یافت نشد.")
	}
	if rowUni != nil && *rowUni != uniID {
		return errors.New("رکورد متعلق به دانشگاه دیگری است.")
	}
	return nil
}

func cleanStr(v string) *string {
	t := strings.TrimSpace(v)
	if t == "" || t == "null" || t == "undefined" {
		return nil
	}
	return &t
}

func boolToDigit(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ─────────────────── ذخیره/حذف انواع تخفیف ───────────────────

// DiscountTypeInput ورودی ذخیرهٔ نوع تخفیف.
type DiscountTypeInput struct {
	ID               int64    `json:"id"`
	Code             string   `json:"code"`
	Title            string   `json:"title"`
	Kind             string   `json:"kind"`
	DefaultPercent   float64  `json:"defaultPercent"`
	DefaultAmount    float64  `json:"defaultAmount"`
	MaxPercent       *float64 `json:"maxPercent"`
	RequiresApproval bool     `json:"requiresApproval"`
	RequiresDocument bool     `json:"requiresDocument"`
	IsActive         bool     `json:"isActive"`
	Note             string   `json:"note"`
}

// SaveDiscountType پورت saveDiscountTypeAction.
func (s *Service) SaveDiscountType(ctx context.Context, user *session.User, uniCookie string, in DiscountTypeInput) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	code := strings.TrimSpace(in.Code)
	title := strings.TrimSpace(in.Title)
	if code == "" || title == "" {
		return errors.New("کد و عنوان الزامی است")
	}
	if in.DefaultAmount < 0 {
		return errors.New("مبلغ نامعتبر است (می‌بایست عدد صحیح ریال باشد).")
	}
	kind := "PERCENT"
	if in.Kind == "FIXED" {
		kind = "FIXED"
	}
	pct := clampF(in.DefaultPercent, 0, 100)
	var maxPct *string
	if in.MaxPercent != nil {
		v := strconv.FormatFloat(clampF(*in.MaxPercent, 0, 1e12), 'f', -1, 64)
		maxPct = &v
	}
	if in.ID > 0 {
		if err := s.assertRowUni(ctx, "tuition_discount_types", in.ID, *uniID); err != nil {
			return err
		}
		_, err := s.DB.Pool.Exec(ctx, `
			update tuition_discount_types set code=$2, title=$3, kind=$4,
			  "defaultPercent"=$5, "defaultAmount"=$6, "maxPercent"=$7,
			  "requiresApproval"=$8, "requiresDocument"=$9, "isActive"=$10, note=$11
			 where id=$1 and ("universityId"=$12 or "universityId" is null)`,
			in.ID, code, title, kind,
			strconv.FormatFloat(pct, 'f', -1, 64), strconv.FormatFloat(in.DefaultAmount, 'f', -1, 64), maxPct,
			boolToDigit(in.RequiresApproval), boolToDigit(in.RequiresDocument), boolToDigit(in.IsActive),
			cleanStr(in.Note), *uniID)
		return err
	}
	_, err := s.DB.Pool.Exec(ctx, `
		insert into tuition_discount_types (code, title, kind, "defaultPercent", "defaultAmount", "maxPercent",
		  "requiresApproval", "requiresDocument", "isActive", note, "universityId")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		code, title, kind,
		strconv.FormatFloat(pct, 'f', -1, 64), strconv.FormatFloat(in.DefaultAmount, 'f', -1, 64), maxPct,
		boolToDigit(in.RequiresApproval), boolToDigit(in.RequiresDocument), boolToDigit(in.IsActive),
		cleanStr(in.Note), *uniID)
	return err
}

// DeleteDiscountType پورت deleteDiscountTypeAction — تخصیص‌یافته حذف نمی‌شود.
func (s *Service) DeleteDiscountType(ctx context.Context, user *session.User, uniCookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	if err := s.assertRowUni(ctx, "tuition_discount_types", id, *uniID); err != nil {
		return err
	}
	var used bool
	_ = s.DB.Pool.QueryRow(ctx, `select exists(select 1 from student_discounts where "discountTypeId" = $1)`, id).Scan(&used)
	if used {
		return errors.New("این نوع تخفیف به دانشجو تخصیص یافته؛ به‌جای حذف، غیرفعالش کنید")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		delete from tuition_discount_types where id = $1 and ("universityId" = $2 or "universityId" is null)`, id, *uniID)
	return err
}

func clampF(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// ─────────────────── بنیادها ───────────────────

// SponsorInput ورودی ذخیرهٔ بنیاد.
type SponsorInput struct {
	ID               int64  `json:"id"`
	Code             string `json:"code"`
	Title            string `json:"title"`
	ContactInfo      string `json:"contactInfo"`
	SettlementMethod string `json:"settlementMethod"`
	IsActive         bool   `json:"isActive"`
	Note             string `json:"note"`
}

// SaveSponsor پورت saveSponsorAction.
func (s *Service) SaveSponsor(ctx context.Context, user *session.User, uniCookie string, in SponsorInput) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	code := strings.TrimSpace(in.Code)
	title := strings.TrimSpace(in.Title)
	if code == "" || title == "" {
		return errors.New("کد و عنوان الزامی است")
	}
	method := "DIRECT"
	if in.SettlementMethod == "REIMBURSE" {
		method = "REIMBURSE"
	}
	if in.ID > 0 {
		if err := s.assertRowUni(ctx, "tuition_sponsors", in.ID, *uniID); err != nil {
			return err
		}
		_, err := s.DB.Pool.Exec(ctx, `
			update tuition_sponsors set code=$2, title=$3, "contactInfo"=$4, "settlementMethod"=$5,
			  "isActive"=$6, note=$7
			 where id=$1 and ("universityId"=$8 or "universityId" is null)`,
			in.ID, code, title, cleanStr(in.ContactInfo), method, boolToDigit(in.IsActive), cleanStr(in.Note), *uniID)
		return err
	}
	_, err := s.DB.Pool.Exec(ctx, `
		insert into tuition_sponsors (code, title, "contactInfo", "settlementMethod", "isActive", note, "universityId")
		values ($1,$2,$3,$4,$5,$6,$7)`,
		code, title, cleanStr(in.ContactInfo), method, boolToDigit(in.IsActive), cleanStr(in.Note), *uniID)
	return err
}

// DeleteSponsor پورت deleteSponsorAction.
func (s *Service) DeleteSponsor(ctx context.Context, user *session.User, uniCookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	if err := s.assertRowUni(ctx, "tuition_sponsors", id, *uniID); err != nil {
		return err
	}
	var used bool
	_ = s.DB.Pool.QueryRow(ctx, `select exists(select 1 from student_sponsorships where "sponsorId" = $1)`, id).Scan(&used)
	if used {
		return errors.New("این بنیاد پوشش ثبت‌شده دارد؛ به‌جای حذف، غیرفعالش کنید")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		delete from tuition_sponsors where id = $1 and ("universityId" = $2 or "universityId" is null)`, id, *uniID)
	return err
}

// ─────────────────── نهادهای وام ───────────────────

// LoanProductInput ورودی ذخیرهٔ نهاد وام.
type LoanProductInput struct {
	ID                  int64    `json:"id"`
	Code                string   `json:"code"`
	Title               string   `json:"title"`
	Lender              string   `json:"lender"`
	MaxAmount           *float64 `json:"maxAmount"`
	DefaultAmount       float64  `json:"defaultAmount"`
	DefaultInstallments int      `json:"defaultInstallments"`
	IsInterestFree      bool     `json:"isInterestFree"`
	RequiresApproval    bool     `json:"requiresApproval"`
	IsActive            bool     `json:"isActive"`
	Note                string   `json:"note"`
}

// SaveLoanProduct پورت saveLoanProductAction.
func (s *Service) SaveLoanProduct(ctx context.Context, user *session.User, uniCookie string, in LoanProductInput) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	code := strings.TrimSpace(in.Code)
	title := strings.TrimSpace(in.Title)
	lender := strings.TrimSpace(in.Lender)
	if code == "" || title == "" {
		return errors.New("کد و عنوان الزامی است")
	}
	if lender == "" {
		return errors.New("نام نهاد پرداخت‌کننده الزامی است")
	}
	if in.DefaultAmount < 0 {
		return errors.New("مبلغ نامعتبر است")
	}
	var maxAmount *string
	if in.MaxAmount != nil {
		if *in.MaxAmount < 0 {
			return errors.New("مبلغ نامعتبر است")
		}
		if in.DefaultAmount > *in.MaxAmount {
			return errors.New("مبلغ پیش‌فرض نمی‌تواند از سقف مجاز بیشتر باشد")
		}
		v := strconv.FormatFloat(*in.MaxAmount, 'f', -1, 64)
		maxAmount = &v
	}
	installments := in.DefaultInstallments
	if installments < 1 {
		installments = 1
	}
	if in.ID > 0 {
		if err := s.assertRowUni(ctx, "loan_products", in.ID, *uniID); err != nil {
			return err
		}
		tag, err := s.DB.Pool.Exec(ctx, `
			update loan_products set code=$2, title=$3, lender=$4, "maxAmount"=$5, "defaultAmount"=$6,
			  "defaultInstallments"=$7, "isInterestFree"=$8, "requiresApproval"=$9, "isActive"=$10, note=$11
			 where id=$1 and ("universityId"=$12 or "universityId" is null)`,
			in.ID, code, title, lender, maxAmount, strconv.FormatFloat(in.DefaultAmount, 'f', -1, 64),
			installments, boolToDigit(in.IsInterestFree), boolToDigit(in.RequiresApproval), boolToDigit(in.IsActive),
			cleanStr(in.Note), *uniID)
		if err != nil {
			return errors.New("خطا در ذخیرهٔ نهاد وام")
		}
		if tag.RowsAffected() != 1 {
			return errors.New("نهاد وام یافت نشد یا ویرایش همزمانی دارد")
		}
		return nil
	}
	var newID int64
	err := s.DB.Pool.QueryRow(ctx, `
		insert into loan_products (code, title, lender, "maxAmount", "defaultAmount", "defaultInstallments",
		  "isInterestFree", "requiresApproval", "isActive", note, "universityId")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
		code, title, lender, maxAmount, strconv.FormatFloat(in.DefaultAmount, 'f', -1, 64),
		installments, boolToDigit(in.IsInterestFree), boolToDigit(in.RequiresApproval), boolToDigit(in.IsActive),
		cleanStr(in.Note), *uniID).Scan(&newID)
	if err != nil {
		return errors.New("خطا در ذخیرهٔ نهاد وام")
	}
	details := `{"code":` + jsonStr(code) + `,"maxAmount":` + jsonNumPtr(in.MaxAmount) + `,"defaultAmount":` + jsonNum(in.DefaultAmount) + `}`
	_ = s.writeAdminAudit(ctx, user.ID, "FINANCE_LOAN_PRODUCT_CREATED", "loan_products", newID, details)
	return nil
}

// DeleteLoanProduct پورت deleteLoanProductAction.
func (s *Service) DeleteLoanProduct(ctx context.Context, user *session.User, uniCookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	var used bool
	_ = s.DB.Pool.QueryRow(ctx, `select exists(select 1 from student_loans where "loanProductId" = $1)`, id).Scan(&used)
	if used {
		return errors.New("این نوع وام به دانشجو تخصیص یافته؛ به‌جای حذف، غیرفعالش کنید")
	}
	if err := s.assertRowUni(ctx, "loan_products", id, *uniID); err != nil {
		return err
	}
	tag, err := s.DB.Pool.Exec(ctx, `
		delete from loan_products where id = $1 and ("universityId" = $2 or "universityId" is null)`, id, *uniID)
	if err != nil {
		return errors.New("خطا در حذف نهاد وام")
	}
	if tag.RowsAffected() != 1 {
		return errors.New("نهاد وام یافت نشد")
	}
	_ = s.writeAdminAudit(ctx, user.ID, "FINANCE_LOAN_PRODUCT_DELETED", "loan_products", id, `{}`)
	return nil
}

// ─────────────────── فرمول‌های شهریه ───────────────────

// FormulaInput ورودی ذخیرهٔ فرمول (پورت saveFormulaAction).
type FormulaInput struct {
	ID               int64   `json:"id"`
	Code             string  `json:"code"`
	Title            string  `json:"title"`
	DegreeLevelID    *int64  `json:"degreeLevelId"`
	MajorID          *int64  `json:"majorId"`
	EntryYearFrom    *int    `json:"entryYearFrom"`
	EntryYearTo      *int    `json:"entryYearTo"`
	FixedAmount      float64 `json:"fixedAmount"`
	PerUnitTheory    float64 `json:"perUnitTheory"`
	PerUnitPractical float64 `json:"perUnitPractical"`
	PerUnitGeneral   float64 `json:"perUnitGeneral"`
	Priority         int     `json:"priority"`
	IsActive         bool    `json:"isActive"`
	Note             string  `json:"note"`
}

// SaveFormula پورت saveFormulaAction.
func (s *Service) SaveFormula(ctx context.Context, user *session.User, uniCookie string, in FormulaInput) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	code := strings.TrimSpace(in.Code)
	title := strings.TrimSpace(in.Title)
	if code == "" || title == "" {
		return errors.New("کد و عنوان الزامی است")
	}
	if in.EntryYearFrom != nil && in.EntryYearTo != nil && *in.EntryYearFrom > *in.EntryYearTo {
		return errors.New("آغاز بازهٔ ورودی نمی‌تواند پس از پایان آن باشد")
	}
	for _, a := range []float64{in.FixedAmount, in.PerUnitTheory, in.PerUnitPractical, in.PerUnitGeneral} {
		if a < 0 {
			return errors.New("مبلغ نامعتبر است (می‌بایست عدد صحیح ریال باشد).")
		}
	}
	priority := in.Priority
	if priority == 0 {
		priority = 100
	}
	if in.ID > 0 {
		if err := s.assertRowUni(ctx, "tuition_rules", in.ID, *uniID); err != nil {
			return err
		}
		_, err := s.DB.Pool.Exec(ctx, `
			update tuition_rules set code=$2, title=$3, "degreeLevelId"=$4, "majorId"=$5,
			  "entryYearFrom"=$6, "entryYearTo"=$7, "fixedAmount"=$8, "perUnitTheory"=$9,
			  "perUnitPractical"=$10, "perUnitGeneral"=$11, priority=$12, "isActive"=$13, note=$14,
			  "updatedAt"=now()
			 where id=$1 and ("universityId"=$15 or "universityId" is null)`,
			in.ID, code, title, in.DegreeLevelID, in.MajorID, in.EntryYearFrom, in.EntryYearTo,
			fmtNum(in.FixedAmount), fmtNum(in.PerUnitTheory), fmtNum(in.PerUnitPractical), fmtNum(in.PerUnitGeneral),
			priority, boolToDigit(in.IsActive), cleanStr(in.Note), *uniID)
		return err
	}
	_, err := s.DB.Pool.Exec(ctx, `
		insert into tuition_rules (code, title, "degreeLevelId", "majorId", "entryYearFrom", "entryYearTo",
		  "fixedAmount", "perUnitTheory", "perUnitPractical", "perUnitGeneral", priority, "isActive", note, "universityId")
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		code, title, in.DegreeLevelID, in.MajorID, in.EntryYearFrom, in.EntryYearTo,
		fmtNum(in.FixedAmount), fmtNum(in.PerUnitTheory), fmtNum(in.PerUnitPractical), fmtNum(in.PerUnitGeneral),
		priority, boolToDigit(in.IsActive), cleanStr(in.Note), *uniID)
	return err
}

// DeleteFormula پورت deleteFormulaAction.
func (s *Service) DeleteFormula(ctx context.Context, user *session.User, uniCookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	if err := s.assertRowUni(ctx, "tuition_rules", id, *uniID); err != nil {
		return err
	}
	_, err := s.DB.Pool.Exec(ctx, `delete from tuition_rules where id = $1 and ("universityId" = $2 or "universityId" is null)`, id, *uniID)
	return err
}

// ─────────────────── کمکی‌های JSON/حسابرسی ───────────────────

func fmtNum(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func jsonStr(v string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range v {
		switch r {
		case '"':
			b.WriteString("\\\"")
		case '\\':
			b.WriteString("\\\\")
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

func jsonNum(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func jsonNumPtr(v *float64) string {
	if v == nil {
		return "null"
	}
	return strconv.FormatFloat(*v, 'f', -1, 64)
}

// writeAdminAudit درج ردیف حسابرسی زنجیره‌هش (بی‌صدا — خطا مانع عملیات نیست).
func (s *Service) writeAdminAudit(ctx context.Context, actorUserID int64, action, entityType string, entityID int64, details string) error {
	var prev string
	_ = s.DB.Pool.QueryRow(ctx, `select coalesce(hash,'') from audit_logs order by id desc limit 1`).Scan(&prev)
	h := sha256.Sum256([]byte(prev + "|" + action + "|" + entityType + "|" + strconv.FormatInt(entityID, 10) + "|" + details))
	hash := hex.EncodeToString(h[:])
	_, err := s.DB.Pool.Exec(ctx, `
		insert into audit_logs ("actorUserId", action, "entityType", "entityId", details, "prevHash", hash)
		values ($1,$2,$3,$4,$5,$6,$7)`,
		actorUserID, action, entityType, entityID, details, prev, hash)
	return err
}
