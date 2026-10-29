// ═══ مدیریت حقوق: سمت‌های موظفی، نقش‌های تدریس، نقش دستی ارائه، پوشش فرمول ═══
package payroll

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// ─────────────────── سمت‌های موظفی (payroll_duty_roles) ───────────────────

// DutyRole سمت موظفی.
type DutyRole struct {
	ID             int64    `json:"id"`
	Code           string   `json:"code"`
	Title          string   `json:"title"`
	DutyUnits      *float64 `json:"dutyUnits"`
	ReductionUnits float64  `json:"reductionUnits"`
	IsTeaching     bool     `json:"isTeaching"`
	SortOrder      int      `json:"sortOrder"`
}

var roleCodeRe = regexp.MustCompile(`^[A-Z0-9_]{2,40}$`)

// ListDutyRoles فهرست سمت‌ها (سراسری + دانشگاه جاری).
func (e *Engine) ListDutyRoles(ctx context.Context, universityID *int64) ([]DutyRole, error) {
	args := []any{}
	where := ` where "universityId" is null`
	if universityID != nil {
		where = ` where ("universityId" = $1 or "universityId" is null)`
		args = append(args, *universityID)
	}
	rows, err := e.Pool.Query(ctx, `
		select id, code, title, "dutyUnits"::float8, "reductionUnits"::float8, "isTeaching", "sortOrder"
		  from payroll_duty_roles`+where+` order by "sortOrder", id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DutyRole{}
	for rows.Next() {
		var r DutyRole
		var teaching *int
		if err := rows.Scan(&r.ID, &r.Code, &r.Title, &r.DutyUnits, &r.ReductionUnits, &teaching, &r.SortOrder); err == nil {
			r.IsTeaching = teaching != nil && *teaching == 1
			out = append(out, r)
		}
	}
	return out, nil
}

// CreateDutyRoleInput ورودی ساخت سمت.
type CreateDutyRoleInput struct {
	Code           string   `json:"code"`
	Title          string   `json:"title"`
	DutyUnits      *float64 `json:"dutyUnits"`
	ReductionUnits float64  `json:"reductionUnits"`
	IsTeaching     bool     `json:"isTeaching"`
	SortOrder      int      `json:"sortOrder"`
}

func validateDutyRole(title string, dutyUnits *float64, reduction float64) error {
	if l := len([]rune(title)); l < 2 || l > 150 {
		return errors.New("عنوان سمت باید ۲ تا ۱۵۰ نویسه باشد.")
	}
	if dutyUnits != nil && (*dutyUnits < 0 || *dutyUnits > 40) {
		return errors.New("موظفی باید بین ۰ تا ۴۰ باشد (یا خالی).")
	}
	if reduction < 0 || reduction > 40 {
		return errors.New("کسر موظفی باید بین ۰ تا ۴۰ باشد.")
	}
	return nil
}

// CreateDutyRole پورت createDutyRole.
func (e *Engine) CreateDutyRole(ctx context.Context, universityID *int64, in CreateDutyRoleInput) (*DutyRole, error) {
	code := strings.ToUpper(strings.TrimSpace(in.Code))
	code = strings.ReplaceAll(code, " ", "_")
	if !roleCodeRe.MatchString(code) {
		return nil, errors.New("کد سمت باید ۲ تا ۴۰ نویسهٔ لاتین/عدد/زیرخط باشد.")
	}
	if err := validateDutyRole(in.Title, in.DutyUnits, in.ReductionUnits); err != nil {
		return nil, err
	}
	var duty any
	if in.DutyUnits != nil {
		duty = strconv.FormatFloat(*in.DutyUnits, 'f', -1, 64)
	}
	var row DutyRole
	var teaching *int
	err := e.Pool.QueryRow(ctx, `
		insert into payroll_duty_roles ("universityId", code, title, "dutyUnits", "reductionUnits", "isTeaching", "sortOrder")
		values ($1,$2,$3,$4,$5,$6,$7)
		returning id, code, title, "dutyUnits"::float8, "reductionUnits"::float8, "isTeaching", "sortOrder"`,
		universityID, code, strings.TrimSpace(in.Title), duty,
		strconv.FormatFloat(in.ReductionUnits, 'f', -1, 64), boolToInt(in.IsTeaching), in.SortOrder).
		Scan(&row.ID, &row.Code, &row.Title, &row.DutyUnits, &row.ReductionUnits, &teaching, &row.SortOrder)
	if err != nil {
		return nil, err
	}
	row.IsTeaching = teaching != nil && *teaching == 1
	return &row, nil
}

// UpdateDutyRole پورت updateDutyRole (کد ثابت می‌ماند).
func (e *Engine) UpdateDutyRole(ctx context.Context, universityID *int64, id int64, patch CreateDutyRoleInput) error {
	if err := validateDutyRole(patch.Title, patch.DutyUnits, patch.ReductionUnits); err != nil {
		return err
	}
	var duty any
	if patch.DutyUnits != nil {
		duty = strconv.FormatFloat(*patch.DutyUnits, 'f', -1, 64)
	}
	args := []any{id, strings.TrimSpace(patch.Title), duty,
		strconv.FormatFloat(patch.ReductionUnits, 'f', -1, 64), boolToInt(patch.IsTeaching), patch.SortOrder}
	where := `id = $1`
	if universityID != nil {
		args = append(args, *universityID)
		where += fmt.Sprintf(` and "universityId" = $%d`, len(args))
	}
	tag, err := e.Pool.Exec(ctx, `
		update payroll_duty_roles set title = $2, "dutyUnits" = $3, "reductionUnits" = $4,
		  "isTeaching" = $5, "sortOrder" = $6 where `+where, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("سمت یافت نشد.")
	}
	return nil
}

// DeleteDutyRole حذف سمت (انتساب‌ها cascade).
func (e *Engine) DeleteDutyRole(ctx context.Context, universityID *int64, id int64) error {
	args := []any{id}
	where := `id = $1`
	if universityID != nil {
		args = append(args, *universityID)
		where += fmt.Sprintf(` and "universityId" = $%d`, len(args))
	}
	_, err := e.Pool.Exec(ctx, `delete from payroll_duty_roles where `+where, args...)
	return err
}

// ─────────────────── انتساب ترمی ───────────────────

// StaffTermRole انتساب نقش به استاد در ترم.
type StaffTermRole struct {
	AssignmentID   int64    `json:"assignmentId"`
	RoleID         int64    `json:"roleId"`
	Code           string   `json:"code"`
	Title          string   `json:"title"`
	DutyUnits      *float64 `json:"dutyUnits"`
	ReductionUnits float64  `json:"reductionUnits"`
	IsTeaching     bool     `json:"isTeaching"`
	SortOrder      int      `json:"sortOrder"`
	IsPrimary      bool     `json:"isPrimary"`
}

// ListStaffTermRoles پورت listStaffTermRoles.
func (e *Engine) ListStaffTermRoles(ctx context.Context, staffID, termID int64) ([]StaffTermRole, error) {
	rows, err := e.Pool.Query(ctx, `
		select str.id, r.id, r.code, r.title, r."dutyUnits"::float8, r."reductionUnits"::float8,
		       r."isTeaching", r."sortOrder", str."isPrimary"
		  from staff_term_roles str
		  join payroll_duty_roles r on r.id = str."roleId"
		 where str."staffId" = $1 and str."termId" = $2`, staffID, termID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StaffTermRole{}
	for rows.Next() {
		var r StaffTermRole
		var teaching, primary *int
		if err := rows.Scan(&r.AssignmentID, &r.RoleID, &r.Code, &r.Title, &r.DutyUnits, &r.ReductionUnits,
			&teaching, &r.SortOrder, &primary); err == nil {
			r.IsTeaching = teaching != nil && *teaching == 1
			r.IsPrimary = primary != nil && *primary == 1
			out = append(out, r)
		}
	}
	return out, nil
}

// AssignmentsSummary پاسخ assignmentsAction.
type AssignmentsSummary struct {
	Assigned      []StaffTermRole `json:"assigned"`
	EffectiveDuty *float64        `json:"effectiveDuty"`
	FallbackDuty  float64         `json:"fallbackDuty"`
}

// ComputeEffectiveDuty پورت computeEffectiveDuty:
// base = dutyUnits اولین نقش تدریسی (کمینه sortOrder)؛ effective = max(0, base − Σ reduction).
func ComputeEffectiveDuty(assigned []StaffTermRole) *float64 {
	teaching := []StaffTermRole{}
	for _, r := range assigned {
		if r.IsTeaching {
			teaching = append(teaching, r)
		}
	}
	if len(teaching) == 0 {
		return nil
	}
	sort.SliceStable(teaching, func(i, j int) bool { return teaching[i].SortOrder < teaching[j].SortOrder })
	base := 0.0
	for _, r := range teaching {
		if r.DutyUnits != nil {
			base = *r.DutyUnits
			break
		}
	}
	reduction := 0.0
	for _, r := range assigned {
		reduction += r.ReductionUnits
	}
	eff := base - reduction
	if eff < 0 {
		eff = 0
	}
	return &eff
}

// AssignmentSummary موظفی مؤثر + fallback قرارداد.
func (e *Engine) AssignmentSummary(ctx context.Context, staffID, termID int64) (*AssignmentsSummary, error) {
	assigned, err := e.ListStaffTermRoles(ctx, staffID, termID)
	if err != nil {
		return nil, err
	}
	var fallback *float64
	_ = e.Pool.QueryRow(ctx, `
		select "baseDutyUnits"::float8 from professor_term_contracts
		 where "staffId" = $1 and "termId" = $2 limit 1`, staffID, termID).Scan(&fallback)
	out := &AssignmentsSummary{Assigned: assigned, EffectiveDuty: ComputeEffectiveDuty(assigned)}
	if fallback != nil {
		out.FallbackDuty = *fallback
	}
	return out, nil
}

// AssignStaffTermRole پورت assignStaffTermRole (idempotent).
func (e *Engine) AssignStaffTermRole(ctx context.Context, staffID, termID, roleID int64, isPrimary bool) error {
	if staffID <= 0 || termID <= 0 {
		return errors.New("شناسهٔ استاد/ترم نامعتبر است.")
	}
	var exists bool
	if err := e.Pool.QueryRow(ctx, `select exists(select 1 from staff where id = $1)`, staffID).Scan(&exists); err != nil || !exists {
		return errors.New("استاد یافت نشد.")
	}
	if err := e.Pool.QueryRow(ctx, `select exists(select 1 from academic_terms where id = $1)`, termID).Scan(&exists); err != nil || !exists {
		return errors.New("ترم یافت نشد.")
	}
	if err := e.Pool.QueryRow(ctx, `select exists(select 1 from payroll_duty_roles where id = $1)`, roleID).Scan(&exists); err != nil || !exists {
		return errors.New("سمت یافت نشد.")
	}
	var id int64
	err := e.Pool.QueryRow(ctx, `
		select id from staff_term_roles where "staffId" = $1 and "termId" = $2 and "roleId" = $3 limit 1`,
		staffID, termID, roleID).Scan(&id)
	if err == nil {
		_, uerr := e.Pool.Exec(ctx, `update staff_term_roles set "isPrimary" = $2 where id = $1`, id, boolToInt(isPrimary))
		return uerr
	}
	_, ierr := e.Pool.Exec(ctx, `
		insert into staff_term_roles ("staffId","termId","roleId","isPrimary") values ($1,$2,$3,$4)`,
		staffID, termID, roleID, boolToInt(isPrimary))
	return ierr
}

// UnassignStaffTermRole حذف یک انتساب.
func (e *Engine) UnassignStaffTermRole(ctx context.Context, assignmentID int64) error {
	if assignmentID <= 0 {
		return errors.New("شناسهٔ انتساب نامعتبر است.")
	}
	_, err := e.Pool.Exec(ctx, `delete from staff_term_roles where id = $1`, assignmentID)
	return err
}

// SearchStaffHit نتیجهٔ جست‌وجوی استاد.
type SearchStaffHit struct {
	ID         int64   `json:"id"`
	StaffCode  *string `json:"staffCode"`
	Name       string  `json:"name"`
	Rank       *string `json:"rank"`
}

// SearchPayrollStaff پورت searchStaffAction.
func (e *Engine) SearchPayrollStaff(ctx context.Context, q string) ([]SearchStaffHit, error) {
	q = strings.TrimSpace(q)
	if len([]rune(q)) < 2 {
		return nil, errors.New("حداقل ۲ نویسه جست‌وجو کنید.")
	}
	like := "%" + q + "%"
	rows, err := e.Pool.Query(ctx, `
		select st.id, st."staffCode", coalesce(u."firstName" || ' ' || u."lastName",''), st."academicRank"
		  from staff st join users u on u.id = st."userId"
		 where st."staffCode" like $1 or u."firstName" like $1 or u."lastName" like $1
		 limit 20`, like)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SearchStaffHit{}
	for rows.Next() {
		var h SearchStaffHit
		if err := rows.Scan(&h.ID, &h.StaffCode, &h.Name, &h.Rank); err == nil {
			h.Name = strings.TrimSpace(h.Name)
			out = append(out, h)
		}
	}
	return out, nil
}

// ─────────────────── کاتالوگ نقش تدریس ───────────────────

// RoleDef نقش تدریس قابل‌تعریف.
type RoleDef struct {
	ID          int64   `json:"id"`
	Code        string  `json:"code"`
	Title       string  `json:"title"`
	Description *string `json:"description"`
	IsActive    bool    `json:"isActive"`
}

var roleDefCodeRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*$`)

// ListRoleDefs کاتالوگ نقش‌های تدریس (سراسری + دانشگاه جاری).
func (e *Engine) ListRoleDefs(ctx context.Context, universityID *int64) ([]RoleDef, error) {
	args := []any{}
	where := ` where "universityId" is null`
	if universityID != nil {
		where = ` where ("universityId" = $1 or "universityId" is null)`
		args = append(args, *universityID)
	}
	rows, err := e.Pool.Query(ctx, `
		select id, code, title, description, "isActive" from teaching_role_defs`+where+` order by code`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RoleDef{}
	for rows.Next() {
		var r RoleDef
		var active *int
		if err := rows.Scan(&r.ID, &r.Code, &r.Title, &r.Description, &active); err == nil {
			r.IsActive = active != nil && *active == 1
			out = append(out, r)
		}
	}
	return out, nil
}

// RoleDefInput ورودی ذخیرهٔ نقش.
type RoleDefInput struct {
	Code        string  `json:"code"`
	Title       string  `json:"title"`
	Description *string `json:"description"`
	IsActive    *bool   `json:"isActive"`
}

func validateRoleDef(code, title string, description *string) (string, error) {
	code = strings.TrimSpace(code)
	title = strings.TrimSpace(title)
	if !roleDefCodeRe.MatchString(code) || len(code) < 2 || len(code) > 50 {
		return "", errors.New("کد فقط حروف لاتین/رقم/زیرخط")
	}
	if l := len([]rune(title)); l < 1 || l > 100 {
		return "", errors.New("عنوان باید ۱ تا ۱۰۰ نویسه باشد.")
	}
	if description != nil && len([]rune(*description)) > 500 {
		return "", errors.New("توضیح حداکثر ۵۰۰ نویسه.")
	}
	return strings.ToUpper(code), nil
}

// CreateRoleDef پورت POST role-defs (کد یکتا).
func (e *Engine) CreateRoleDef(ctx context.Context, universityID *int64, in RoleDefInput) (*RoleDef, error) {
	code, err := validateRoleDef(in.Code, in.Title, in.Description)
	if err != nil {
		return nil, err
	}
	desc := trimmedPtr(in.Description)
	active := 1
	if in.IsActive != nil && !*in.IsActive {
		active = 0
	}
	var r RoleDef
	var activeOut *int
	err = e.Pool.QueryRow(ctx, `
		insert into teaching_role_defs (code, title, description, "isActive", "universityId")
		values ($1,$2,$3,$4,$5) returning id, code, title, description, "isActive"`,
		code, strings.TrimSpace(in.Title), desc, active, universityID).
		Scan(&r.ID, &r.Code, &r.Title, &r.Description, &activeOut)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "23505") {
			return nil, errors.New("این کد نقش قبلاً ثبت شده است.")
		}
		return nil, err
	}
	r.IsActive = activeOut != nil && *activeOut == 1
	return &r, nil
}

func trimmedPtr(v *string) *string {
	if v == nil {
		return nil
	}
	t := strings.TrimSpace(*v)
	if t == "" {
		return nil
	}
	return &t
}

// UpdateRoleDef پورت PUT role-defs/:id.
func (e *Engine) UpdateRoleDef(ctx context.Context, id int64, in RoleDefInput) error {
	if id <= 0 {
		return errors.New("شناسهٔ نامعتبر است.")
	}
	code, err := validateRoleDef(in.Code, in.Title, in.Description)
	if err != nil {
		return err
	}
	var dup bool
	_ = e.Pool.QueryRow(ctx, `select exists(select 1 from teaching_role_defs where code = $1 and id <> $2)`, code, id).Scan(&dup)
	if dup {
		return errors.New("این کد نقش قبلاً ثبت شده است.")
	}
	var active any
	if in.IsActive != nil {
		active = boolToInt(*in.IsActive)
	}
	tag, err := e.Pool.Exec(ctx, `
		update teaching_role_defs set code = $2, title = $3, description = $4,
		  "isActive" = coalesce($5, "isActive") where id = $1`,
		id, code, strings.TrimSpace(in.Title), trimmedPtr(in.Description), active)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("نقش یافت نشد.")
	}
	return nil
}

// DeleteRoleDef حذف؛ اگر روی ارائه‌ای اعمال شده باشد ممنوع.
func (e *Engine) DeleteRoleDef(ctx context.Context, id int64) error {
	if id <= 0 {
		return errors.New("شناسهٔ نامعتبر است.")
	}
	var code string
	if err := e.Pool.QueryRow(ctx, `select code from teaching_role_defs where id = $1`, id).Scan(&code); err != nil {
		return errors.New("نقش یافت نشد.")
	}
	var used int
	_ = e.Pool.QueryRow(ctx, `select count(*)::int from offering_payroll_extras where "payRoleOverride" = $1`, code).Scan(&used)
	if used > 0 {
		return fmt.Errorf("این نقش روی %d ارائهٔ تدریس اعمال شده است. ابتدا نقش دستی آن ارائه‌ها را بردارید یا نقش را غیرفعال کنید.", used)
	}
	_, err := e.Pool.Exec(ctx, `delete from teaching_role_defs where id = $1`, id)
	return err
}

// SetOfferingPayRole پورت PUT offering-extras — نقش دستی ارائه/استاد.
func (e *Engine) SetOfferingPayRole(ctx context.Context, universityID *int64, offeringID, staffID int64, code *string) error {
	if offeringID <= 0 || staffID <= 0 {
		return errors.New("شناسهٔ ارائه یا استاد نامعتبر است.")
	}
	var clean *string
	if code != nil && strings.TrimSpace(*code) != "" {
		v := strings.TrimSpace(*code)
		var active *int
		if err := e.Pool.QueryRow(ctx, `select "isActive" from teaching_role_defs where code = $1`, v).Scan(&active); err != nil {
			return errors.New("این کد نقش در کاتالوگ ثبت نشده است.")
		}
		if active == nil || *active != 1 {
			return errors.New("این نقش غیرفعال است؛ ابتدا فعالش کنید.")
		}
		clean = &v
	}
	var id int64
	err := e.Pool.QueryRow(ctx, `
		select id from offering_payroll_extras where "offeringId" = $1 and "staffId" = $2 limit 1`,
		offeringID, staffID).Scan(&id)
	if err != nil {
		var reason any
		if clean != nil {
			reason = "نقش دستی تدریس"
		}
		_, ierr := e.Pool.Exec(ctx, `
			insert into offering_payroll_extras ("offeringId","staffId","extraUnits","flatAmount",reason,"payRoleOverride","universityId")
			values ($1,$2,'0',0,$3,$4,$5)`, offeringID, staffID, reason, clean, universityID)
		return ierr
	}
	_, uerr := e.Pool.Exec(ctx, `update offering_payroll_extras set "payRoleOverride" = $2 where id = $1`, id, clean)
	return uerr
}

// ─────────────────── نمای پوشش فرمول ───────────────────

// CoverageRow ردیف پوشش: هر ارائهٔ هر استاد → قانون برنده یا علت نبود فرمول.
type CoverageRow struct {
	StaffID        int64   `json:"staffId"`
	StaffName      string  `json:"staffName"`
	OfferingID     int64   `json:"offeringId"`
	CourseCode     string  `json:"courseCode"`
	CourseTitle    string  `json:"courseTitle"`
	GroupNumber    *int    `json:"groupNumber"`
	OfferingType   string  `json:"offeringType"`
	OfferingTypeFa string  `json:"offeringTypeFa"`
	Role           string  `json:"role"`
	RoleFa         string  `json:"roleFa"`
	Enrolled       int     `json:"enrolled"`
	HasClass       bool    `json:"hasClass"`
	Nth            int     `json:"nth"`
	Merged         bool    `json:"merged"`
	MemberCount    int     `json:"memberCount"`
	RuleID         *int64  `json:"ruleId"`
	RuleTitle      *string `json:"ruleTitle"`
	Expression     *string `json:"expression"`
	MissDim        *string `json:"missDim"`
	MissReason     *string `json:"missReason"`
	OverrideCode   *string `json:"overrideCode"`
	OverrideTitle  *string `json:"overrideTitle"`
}

// ComputeRuleCoverage پورت computeRuleCoverage.
func (e *Engine) ComputeRuleCoverage(ctx context.Context, termID *int64) ([]CoverageRow, error) {
	term, err := e.CurrentTerm(ctx, termID)
	if err != nil {
		return nil, err
	}
	if term == nil {
		return nil, errors.New("ترم جاری مشخص نیست.")
	}
	data, err := e.LoadTermPayrollData(ctx, term.ID)
	if err != nil {
		return nil, err
	}
	rows := []CoverageRow{}
	staffIDs := make([]int64, 0, len(data.OfferingsByStaff))
	for sid := range data.OfferingsByStaff {
		staffIDs = append(staffIDs, sid)
	}
	sort.Slice(staffIDs, func(i, j int) bool { return staffIDs[i] < staffIDs[j] })
	for _, staffID := range staffIDs {
		info, ok := data.StaffInfo[staffID]
		if !ok {
			continue
		}
		collapsed := collapseMergedOfferings(data.OfferingsByStaff[staffID], func(id int64) string {
			return data.SlotsByOffering[id]
		})
		for _, o := range collapsed {
			memberIDs := o.MergedMemberIds
			if memberIDs == nil {
				memberIDs = []int64{o.OfferingID}
			}
			hasClass := false
			for _, id := range memberIDs {
				if _, ok := data.SlotsByOffering[id]; ok {
					hasClass = true
					break
				}
			}
			nth := data.RepeatCount[fmt.Sprintf("%d:%d", staffID, o.CourseID)] + 1
			rank := info.Info.Rank
			m := RuleMatch{
				OfferingType: o.OfferingType, Role: o.PayRole, Rank: rank, HasClass: hasClass,
				Enrolled: o.EnrolledCount, DeptID: o.DeptID, CourseType: o.CourseType, Nth: nth,
			}
			rule := MatchRule(data.Rules, m)
			row := CoverageRow{
				StaffID: staffID, StaffName: info.Info.Name,
				OfferingID: o.OfferingID, CourseCode: o.CourseCode, CourseTitle: o.CourseTitle,
				GroupNumber: o.GroupNumber, OfferingType: o.OfferingType,
				OfferingTypeFa: offeringTypeFA(o.OfferingType),
				Role:           o.PayRole, RoleFa: roleLabel(data, o.PayRole),
				Enrolled: o.EnrolledCount, HasClass: hasClass, Nth: nth,
				Merged: len(memberIDs) > 1, MemberCount: len(memberIDs),
			}
			if rule != nil {
				id := rule.ID
				row.RuleID = &id
				row.RuleTitle = rule.Title
				row.Expression = rule.Expression
			} else {
				dim, reason := DiagnoseRuleMiss(data.Rules, m)
				row.MissDim = &dim
				row.MissReason = &reason
			}
			rows = append(rows, row)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		ri, rj := 0, 0
		if rows[i].RuleID != nil {
			ri = 1
		}
		if rows[j].RuleID != nil {
			rj = 1
		}
		if ri != rj {
			return ri < rj
		}
		return rows[i].CourseTitle < rows[j].CourseTitle
	})
	return rows, nil
}

// TermsOption ترم برای انتخاب‌گر.
type TermsOption struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	TermCode  string `json:"termCode"`
	IsCurrent bool   `json:"isCurrent"`
}

// ListTerms پورت فهرست ترم‌های صفحهٔ حقوق.
func (e *Engine) ListTerms(ctx context.Context, universityID *int64) ([]TermsOption, error) {
	args := []any{}
	where := ""
	if universityID != nil {
		where = ` where "universityId" = $1`
		args = append(args, *universityID)
	}
	rows, err := e.Pool.Query(ctx, `
		select id, title, coalesce("termCode",''), coalesce("isCurrent",0)
		  from academic_terms`+where+` order by "sortOrder" desc`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TermsOption{}
	for rows.Next() {
		var t TermsOption
		var cur *int
		if err := rows.Scan(&t.ID, &t.Title, &t.TermCode, &cur); err == nil {
			t.IsCurrent = cur != nil && *cur == 1
			out = append(out, t)
		}
	}
	return out, nil
}
