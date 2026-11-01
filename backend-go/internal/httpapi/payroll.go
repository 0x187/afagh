// ═══ Teaching pay (phase 7 — payroll) endpoints ═══
package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/admin"
	"backend-go/internal/payroll"
	"backend-go/internal/scope"
	"backend-go/internal/session"
)

// PayrollAPI teaching pay engine handlers.
type PayrollAPI struct {
	Engine    *payroll.Engine
	Approvals *payroll.Approvals
	Store     *session.Store
	Pool      *pgxpool.Pool
	Scope     *scope.Service
	Admin     *admin.Service
}

// uniCookie active university from the cookie.
func (a *PayrollAPI) uniCookie(c *gin.Context) string {
	if v, err := c.Cookie(scope.UniversityCookie); err == nil {
		return v
	}
	return ""
}

var payrollViewRoles = []string{"ADMIN", "EDU_EXPERT", "VICE_EDU", "FINANCE_EXPERT", "FINANCE", "DEP_HEAD"}

func payrollHasRole(u *session.User, role string) bool {
	for _, r := range u.Roles {
		if r == role {
			return true
		}
	}
	return false
}

func payrollHasAnyRole(u *session.User, roles []string) bool {
	for _, r := range roles {
		if payrollHasRole(u, r) {
			return true
		}
	}
	return false
}

func (a *PayrollAPI) requireRoles(c *gin.Context, roles []string) *session.User {
	user := a.requirePayrollUser(c)
	if user == nil {
		return nil
	}
	if !payrollHasAnyRole(user, roles) {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی غیرمجاز."})
		return nil
	}
	return user
}

// requirePayrollUser session gate + panel roles (same adminRoles set).
func (a *PayrollAPI) requirePayrollUser(c *gin.Context) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	user, _ := a.Store.Get(c.Request.Context(), token, false)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	if !payrollHasAnyRole(user, adminRoles) {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی به پنل مدیریت مجاز نیست."})
		return nil
	}
	return user
}

func (a *PayrollAPI) Register(r gin.IRouter) {
	r.GET("/admin/payroll", a.payrollOverview)
	r.POST("/admin/payroll/compute", a.payrollCompute)
	r.GET("/admin/payroll/payslip", a.payrollPayslip)
	r.POST("/admin/payroll/midterm", a.payrollMidterm)
	r.POST("/admin/payroll/settle", a.payrollSettle)
	r.GET("/admin/payroll/approvals", a.payrollApprovalsGet)
	r.POST("/admin/payroll/approvals", a.payrollApprovalsPost)
	r.GET("/admin/payroll/export", a.payrollExportCSV)
	r.GET("/admin/payroll/config", a.payrollConfig)
	r.GET("/admin/payroll/duty-roles", a.dutyRoles)
	r.POST("/admin/payroll/duty-roles", a.dutyRoleCreate)
	r.POST("/admin/payroll/duty-roles/update", a.dutyRoleUpdate)
	r.POST("/admin/payroll/duty-roles/delete", a.dutyRoleDelete)
	r.GET("/admin/payroll/staff-search", a.payrollStaffSearch)
	r.GET("/admin/payroll/assignments", a.payrollAssignments)
	r.POST("/admin/payroll/assignments", a.payrollAssign)
	r.POST("/admin/payroll/assignments/unassign", a.payrollUnassign)
	r.GET("/admin/payroll/terms", a.payrollTerms)
	r.GET("/admin/payroll/role-defs", a.roleDefs)
	r.POST("/admin/payroll/role-defs", a.roleDefCreate)
	r.POST("/admin/payroll/role-defs/update", a.roleDefUpdate)
	r.POST("/admin/payroll/role-defs/delete", a.roleDefDelete)
	r.POST("/admin/payroll/offering-extras", a.setOfferingPayRole)
	r.GET("/admin/payroll/coverage", a.payrollCoverage)
	r.GET("/admin/payroll/decrees", a.payrollDecrees)
	r.POST("/admin/payroll/decrees/issue", a.payrollDecreeIssue)
	r.GET("/admin/payroll/decrees/detail", a.payrollDecreeDetail)
	r.POST("/admin/payroll/decrees/finalize", a.payrollDecreeFinalize)
	r.POST("/admin/payroll/decrees/delete", a.payrollDecreeDelete)
	r.GET("/admin/payroll/objections/open", a.payrollObjectionsOpen)
	r.GET("/admin/payroll/objections/history", a.payrollObjectionsHistory)
	r.POST("/admin/payroll/objections/review", a.payrollObjectionsReview)
	r.GET("/admin/payroll/thesis", a.payrollThesis)
	r.POST("/admin/payroll/thesis", a.payrollThesisCreate)
	r.POST("/admin/payroll/thesis/status", a.payrollThesisStatus)
	r.POST("/admin/payroll/thesis/delete", a.payrollThesisDelete)
	r.GET("/admin/payroll/thesis/draws", a.payrollThesisDraws)
	r.POST("/admin/payroll/thesis/draws", a.payrollThesisDrawCreate)
	r.POST("/admin/payroll/thesis/draws/delete", a.payrollThesisDrawDelete)
	r.GET("/admin/payroll/exam-payments", a.payrollExamPayments)
	r.POST("/admin/payroll/exam-payments", a.payrollExamPaymentCreate)
	r.POST("/admin/payroll/exam-payments/delete", a.payrollExamPaymentDelete)
	r.GET("/admin/payroll/regulations", a.payrollRegulations)
	r.POST("/admin/payroll/regulations", a.payrollRegulationCreate)
	r.POST("/admin/payroll/regulations/activate", a.payrollRegulationActivate)
	r.POST("/admin/payroll/regulations/delete", a.payrollRegulationDelete)
	r.GET("/professor/payroll/payslip", a.professorPayslip)
	r.GET("/professor/payroll/objections", a.professorObjections)
	r.POST("/professor/payroll/objections", a.professorObjectionCreate)
}

// ─────────────────── Payroll management (positions/roles/coverage) ───────────────────

func (a *PayrollAPI) dutyRoles(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	rows, err := a.Engine.ListDutyRoles(c.Request.Context(), uniID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"roles": rows}})
}

func (a *PayrollAPI) dutyRoleCreate(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var body payroll.CreateDutyRoleInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	row, err := a.Engine.CreateDutyRole(c.Request.Context(), uniID, body)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"role": row}})
}

func (a *PayrollAPI) dutyRoleUpdate(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
		payroll.CreateDutyRoleInput
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if err := a.Engine.UpdateDutyRole(c.Request.Context(), uniID, body.ID, body.CreateDutyRoleInput); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *PayrollAPI) dutyRoleDelete(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if err := a.Engine.DeleteDutyRole(c.Request.Context(), uniID, body.ID); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *PayrollAPI) payrollStaffSearch(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	list, err := a.Engine.SearchPayrollStaff(c.Request.Context(), c.Query("q"))
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"list": list}})
}

func (a *PayrollAPI) payrollAssignments(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	staffID, _ := strconv.ParseInt(c.Query("staffId"), 10, 64)
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	if staffID <= 0 || termID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ استاد/ترم نامعتبر است."})
		return
	}
	sum, err := a.Engine.AssignmentSummary(c.Request.Context(), staffID, termID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": sum})
}

func (a *PayrollAPI) payrollAssign(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	var body struct {
		StaffID   int64 `json:"staffId"`
		TermID    int64 `json:"termId"`
		RoleID    int64 `json:"roleId"`
		IsPrimary bool  `json:"isPrimary"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	if err := a.Engine.AssignStaffTermRole(c.Request.Context(), body.StaffID, body.TermID, body.RoleID, body.IsPrimary); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *PayrollAPI) payrollUnassign(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	var body struct {
		AssignmentID int64 `json:"assignmentId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	if err := a.Engine.UnassignStaffTermRole(c.Request.Context(), body.AssignmentID); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *PayrollAPI) payrollTerms(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	rows, err := a.Engine.ListTerms(c.Request.Context(), uniID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"terms": rows}})
}

func (a *PayrollAPI) roleDefs(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT", "VICE_EDU", "FINANCE"})
	if user == nil {
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	rows, err := a.Engine.ListRoleDefs(c.Request.Context(), uniID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"roleDefs": rows}})
}

func (a *PayrollAPI) roleDefCreate(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var body payroll.RoleDefInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	row, err := a.Engine.CreateRoleDef(c.Request.Context(), uniID, body)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"roleDef": row}})
}

func (a *PayrollAPI) roleDefUpdate(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
		payroll.RoleDefInput
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	if err := a.Engine.UpdateRoleDef(c.Request.Context(), body.ID, body.RoleDefInput); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *PayrollAPI) roleDefDelete(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	if err := a.Engine.DeleteRoleDef(c.Request.Context(), body.ID); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *PayrollAPI) setOfferingPayRole(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	offeringID, _ := strconv.ParseInt(c.Query("offeringId"), 10, 64)
	staffID, _ := strconv.ParseInt(c.Query("staffId"), 10, 64)
	var body struct {
		PayRoleOverride *string `json:"payRoleOverride"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if err := a.Engine.SetOfferingPayRole(c.Request.Context(), uniID, offeringID, staffID, body.PayRoleOverride); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *PayrollAPI) payrollCoverage(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	var termID *int64
	if raw := c.Query("termId"); raw != "" {
		if v, err := strconv.ParseInt(raw, 10, 64); err == nil && v > 0 {
			termID = &v
		}
	}
	rows, err := a.Engine.ComputeRuleCoverage(c.Request.Context(), termID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows}})
}

// staffRefOf user's staff record — for the group manager scope.
func (a *PayrollAPI) staffRefOf(ctx context.Context, userID int64) (*payroll.StaffRef, error) {
	var ref payroll.StaffRef
	err := a.Pool.QueryRow(ctx, `select id, "departmentId", "universityId" from staff where "userId" = $1 limit 1`, userID).
		Scan(&ref.StaffID, &ref.DepartmentID, &ref.UniversityID)
	if err != nil {
		return nil, errors.New("پروندهٔ کارمندی شما یافت نشد.")
	}
	return &ref, nil
}

// headedDeptIDs departments headed by a professor (same headedDepartments logic;
// in the absence of a headStaffId column we rely on staff membership).
func (a *PayrollAPI) headedDeptIDs(ctx context.Context, staffID int64, ownDeptID *int64) ([]int64, error) {
	out := []int64{}
	rows, err := a.Pool.Query(ctx, `select id from departments where "headStaffId" = $1 order by name`, staffID)
	if err == nil {
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err == nil {
				out = append(out, id)
			}
		}
		rows.Close()
	}
	if len(out) == 0 && ownDeptID != nil {
		var id int64
		if err := a.Pool.QueryRow(ctx, `select id from departments where id = $1`, *ownDeptID).Scan(&id); err == nil {
			out = []int64{id}
		}
	}
	return out, nil
}

// canActUni user's university boundary.
func (a *PayrollAPI) canActUni(ctx context.Context, user *session.User, universityID int64) bool {
	id := universityID
	return a.Scope.CanActOnUniversity(ctx, user, &id)
}

// getScopedOverview port of getScopedOverview: scoped view.
func (a *PayrollAPI) getScopedOverview(ctx context.Context, user *session.User) (*payroll.Overview, bool, error) {
	ov, err := a.Engine.GetOverview(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	isDeptOnly := payrollHasRole(user, "DEP_HEAD") &&
		!payrollHasAnyRole(user, []string{"ADMIN", "EDU_EXPERT", "VICE_EDU", "FINANCE", "FINANCE_EXPERT"})
	if !isDeptOnly {
		return ov, false, nil
	}
	ref, err := a.staffRefOf(ctx, user.ID)
	if err != nil {
		return nil, false, err
	}
	depts, err := a.headedDeptIDs(ctx, ref.StaffID, ref.DepartmentID)
	if err != nil {
		return nil, false, err
	}
	deptSet := map[int64]bool{}
	for _, d := range depts {
		deptSet[d] = true
	}
	filtered := []payroll.PayrollOverviewItem{}
	for _, x := range ov.List {
		var deptID *int64
		_ = a.Pool.QueryRow(ctx, `select "departmentId" from staff where id = $1`, x.ID).Scan(&deptID)
		if deptID != nil && deptSet[*deptID] {
			filtered = append(filtered, x)
			continue
		}
		// Remaining balances are excluded from totals so the worklist numbers match the list
		ov.Totals.Budget -= x.Net
		ov.Totals.Paid -= x.MidtermPaid + x.FinalPaid
		ov.Totals.Remaining -= x.Remaining
		ov.Totals.StaffCount--
	}
	ov.List = filtered
	return ov, true, nil
}

func (a *PayrollAPI) payrollOverview(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	ov, scoped, err := a.getScopedOverview(c.Request.Context(), user)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"overview": ov, "scoped": scoped}})
}

func (a *PayrollAPI) payrollCompute(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	actorID := user.ID
	res, err := a.Engine.ComputeTermPayroll(c.Request.Context(), &actorID, nil)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *PayrollAPI) payrollPayslip(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	staffID, err := strconv.ParseInt(c.Query("staffId"), 10, 64)
	if err != nil || staffID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ استاد نامعتبر است."})
		return
	}
	// 🔒 University boundary: each professor's payslip only for authorized users of the same university
	var uniID *int64
	if err := a.Pool.QueryRow(c.Request.Context(), `select "universityId" from staff where id = $1`, staffID).Scan(&uniID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "استاد یافت نشد."})
		return
	}
	if uniID != nil && !a.canActUni(c.Request.Context(), user, *uniID) {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "این استاد در دانشگاه شما نیست."})
		return
	}
	resp, err := a.Engine.GetStaffPayslip(c.Request.Context(), staffID, nil)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *PayrollAPI) payrollMidterm(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var body struct {
		StaffID int64 `json:"staffId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.StaffID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ استاد نامعتبر است."})
		return
	}
	actorID := user.ID
	amount, err := a.Engine.PayMidterm(c.Request.Context(), body.StaffID, &actorID, nil)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"amount": amount}})
}

func (a *PayrollAPI) payrollSettle(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var body struct {
		StaffID int64 `json:"staffId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.StaffID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ استاد نامعتبر است."})
		return
	}
	res, err := a.Approvals.SettleApproved(c.Request.Context(), payroll.ToPayrollUser(user.ID, user.Roles), body.StaffID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *PayrollAPI) payrollApprovalsGet(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	if raw := strings.TrimSpace(c.Query("statementId")); raw != "" {
		sid, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || sid <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ فیش نامعتبر است."})
			return
		}
		history, err := a.Approvals.GetApprovalHistory(c.Request.Context(), payroll.ToPayrollUser(user.ID, user.Roles), sid)
		if err != nil {
			a.payrollFail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"history": history}})
		return
	}
	ov, scoped, err := a.getScopedOverview(c.Request.Context(), user)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"overview": ov, "scoped": scoped}})
}

func (a *PayrollAPI) payrollApprovalsPost(c *gin.Context) {
	user := a.requirePayrollUser(c)
	if user == nil {
		return
	}
	var body struct {
		Op          string  `json:"op"`
		StatementID int64   `json:"statementId"`
		StaffID     int64   `json:"staffId"`
		Note        *string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	var res *payroll.ApprovalResult
	var err error
	switch body.Op {
	case "settle":
		if body.StaffID <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ استاد نامعتبر است."})
			return
		}
		res, err = a.Approvals.SettleApproved(c.Request.Context(), payroll.ToPayrollUser(user.ID, user.Roles), body.StaffID)
	case "approve-dept":
		res, err = a.Approvals.ApproveDept(c.Request.Context(), payroll.ToPayrollUser(user.ID, user.Roles), body.StatementID, body.Note)
	case "approve-dean":
		res, err = a.Approvals.ApproveDean(c.Request.Context(), payroll.ToPayrollUser(user.ID, user.Roles), body.StatementID, body.Note)
	case "return":
		note := ""
		if body.Note != nil {
			note = *body.Note
		}
		res, err = a.Approvals.Return(c.Request.Context(), payroll.ToPayrollUser(user.ID, user.Roles), body.StatementID, note)
	case "reject":
		note := ""
		if body.Note != nil {
			note = *body.Note
		}
		res, err = a.Approvals.Reject(c.Request.Context(), payroll.ToPayrollUser(user.ID, user.Roles), body.StatementID, note)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "عملیات نامعتبر است."})
		return
	}
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *PayrollAPI) payrollExportCSV(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	csv, _, _, err := a.Engine.ExportBatch(c.Request.Context(), nil)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.Header("Content-Disposition", "attachment; filename=payroll-batch.csv")
	c.Data(http.StatusOK, "text/csv; charset=utf-8", []byte("\ufeff"+csv))
}

func (a *PayrollAPI) payrollConfig(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	cfg, err := a.Engine.ListPayConfiguration(c.Request.Context())
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": cfg})
}

func (a *PayrollAPI) payrollFail(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
}

// ─────────────────── Teaching assignment notices ───────────────────

func (a *PayrollAPI) payrollDecrees(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	if termID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ ترم نامعتبر است."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	var staffID *int64
	if raw := c.Query("staffId"); raw != "" {
		if v, err := strconv.ParseInt(raw, 10, 64); err == nil && v > 0 {
			staffID = &v
		}
	}
	rows, err := a.Engine.ListDecrees(c.Request.Context(), termID, uniID, staffID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"list": rows}})
}

func (a *PayrollAPI) payrollDecreeIssue(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	var body struct {
		StaffID int64                  `json:"staffId"`
		TermID  int64                  `json:"termId"`
		Signers []payroll.DecreeSigner `json:"signers"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.StaffID <= 0 || body.TermID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if uniID == nil {
		a.payrollFail(c, errors.New("دانشگاه فعال مشخص نیست."))
		return
	}
	id, err := a.Engine.IssueDecree(c.Request.Context(), body.StaffID, body.TermID, *uniID, body.Signers)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *PayrollAPI) payrollDecreeDetail(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	id, _ := strconv.ParseInt(c.Query("id"), 10, 64)
	d, err := a.Engine.GetDecreeDetail(c.Request.Context(), id)
	if err != nil || d == nil {
		a.payrollFail(c, errors.New("ابلاغ یافت نشد."))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"decree": d}})
}

func (a *PayrollAPI) payrollDecreeFinalize(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	if err := a.Engine.FinalizeDecree(c.Request.Context(), body.ID, user.ID); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *PayrollAPI) payrollDecreeDelete(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	if err := a.Engine.DeleteDraftDecree(c.Request.Context(), body.ID); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─────────────────── Payslip objections + regulations ───────────────────

func (a *PayrollAPI) payrollObjectionsOpen(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	rows, err := a.Engine.ListOpenObjections(c.Request.Context(), uniID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"open": rows}})
}

func (a *PayrollAPI) payrollObjectionsHistory(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	rows, err := a.Engine.ListObjectionsHistory(c.Request.Context(), uniID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"history": rows}})
}

func (a *PayrollAPI) payrollObjectionsReview(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT", "FINANCE"})
	if user == nil {
		return
	}
	var body struct {
		ID        int64  `json:"id"`
		Decision  string `json:"decision"`
		ReviewNote string `json:"reviewNote"`
		Reopen    bool   `json:"reopen"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	if a.Approvals == nil {
		a.payrollFail(c, errors.New("زنجیرهٔ تأیید در دسترس نیست."))
		return
	}
	_, err := a.Engine.ReviewObjection(c.Request.Context(), a.Approvals, payroll.ReviewObjectionInput{
		ID: body.ID, Decision: body.Decision, ReviewNote: body.ReviewNote,
		Reopen: body.Reopen, ReviewerUserID: user.ID,
	})
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *PayrollAPI) payrollRegulations(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	rows, err := a.Engine.ListRegulations(c.Request.Context(), uniID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows}})
}

func (a *PayrollAPI) payrollRegulationCreate(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var body struct {
		Code        string  `json:"code"`
		Title       string  `json:"title"`
		Year        *int    `json:"year"`
		Description *string `json:"description"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	id, err := a.Engine.CreateRegulation(c.Request.Context(), uniID, body.Code, body.Title, body.Year, body.Description, user.ID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *PayrollAPI) payrollRegulationActivate(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if err := a.Engine.ActivateRegulation(c.Request.Context(), uniID, body.ID); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *PayrollAPI) payrollRegulationDelete(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	if err := a.Engine.DeleteRegulation(c.Request.Context(), body.ID); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// professorObjections professor's objections (their own payslip).
func (a *PayrollAPI) professorObjections(c *gin.Context) {
	user := a.requireProfessorUser(c)
	if user == nil {
		return
	}
	st, err := a.payrollStaffOf(c.Request.Context(), user)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	var termID *int64
	if raw := strings.TrimSpace(c.Query("termId")); raw != "" {
		if v, err := strconv.ParseInt(raw, 10, 64); err == nil && v > 0 {
			termID = &v
		}
	}
	rows, err := a.Engine.ListObjectionsForStaff(c.Request.Context(), st, termID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"objections": rows}})
}

// professorObjectionCreate submit an objection to their own payslip.
func (a *PayrollAPI) professorObjectionCreate(c *gin.Context) {
	user := a.requireProfessorUser(c)
	if user == nil {
		return
	}
	st, err := a.payrollStaffOf(c.Request.Context(), user)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	var body struct {
		StatementID int64  `json:"statementId"`
		Text        string `json:"text"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.StatementID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	id, err := a.Engine.CreateObjection(c.Request.Context(), payroll.CreateObjectionInput{
		StatementID: body.StatementID, StaffID: st, Text: body.Text,
		CreatedBy: user.ID, UniversityID: uniID,
	})
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

// requireProfessorUser professor role gate for professor portal routes.
func (a *PayrollAPI) requireProfessorUser(c *gin.Context) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	user, _ := a.Store.Get(c.Request.Context(), token, false)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	isProf := false
	for _, r := range user.Roles {
		if r == "PROFESSOR" || r == "ADMIN" {
			isProf = true
		}
	}
	if !isProf {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی غیرمجاز."})
		return nil
	}
	return user
}

// payrollStaffOf user's staff.id.
func (a *PayrollAPI) payrollStaffOf(ctx context.Context, user *session.User) (int64, error) {
	var id int64
	err := a.Pool.QueryRow(ctx, `select id from staff where "userId" = $1 limit 1`, user.ID).Scan(&id)
	if err != nil {
		return 0, errors.New("پروندهٔ کارمندی شما یافت نشد.")
	}
	return id, nil
}

// professorPayslip professor's teaching pay slip (port of getStaffPayslip in the professor portal).
func (a *PayrollAPI) professorPayslip(c *gin.Context) {
	user := a.requireProfessorUser(c)
	if user == nil {
		return
	}
	st, err := a.payrollStaffOf(c.Request.Context(), user)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	resp, err := a.Engine.GetStaffPayslip(c.Request.Context(), st, nil)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

// ─────────────────── Exam payments ───────────────────

func (a *PayrollAPI) payrollExamPayments(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	if termID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ ترم نامعتبر است."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	rows, err := a.Engine.ListExamPayments(c.Request.Context(), termID, uniID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	notReady, err := a.Engine.NotReadyForTerm(c.Request.Context(), termID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"list": rows, "notReady": notReady}})
}

func (a *PayrollAPI) payrollExamPaymentCreate(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	var body struct {
		StaffID      int64   `json:"staffId"`
		TermID       int64   `json:"termId"`
		Source       string  `json:"source"`
		SessionCount int     `json:"sessionCount"`
		UnitCount    float64 `json:"unitCount"`
		Amount       float64 `json:"amount"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.StaffID <= 0 || body.TermID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	id, err := a.Engine.CreateExamPayment(c.Request.Context(), payroll.CreateExamPaymentInput{
		StaffID: body.StaffID, TermID: body.TermID, Source: body.Source,
		SessionCount: body.SessionCount, UnitCount: body.UnitCount, Amount: body.Amount,
		UniversityID: uniID, CreatedBy: user.ID,
	})
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *PayrollAPI) payrollExamPaymentDelete(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	if err := a.Engine.DeleteExamPayment(c.Request.Context(), body.ID); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─────────────────── Thesis office ───────────────────

func (a *PayrollAPI) payrollThesis(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	var staffID *int64
	if raw := c.Query("staffId"); raw != "" {
		if v, err := strconv.ParseInt(raw, 10, 64); err == nil && v > 0 {
			staffID = &v
		}
	}
	rows, err := a.Engine.ListThesisSupervisions(c.Request.Context(), uniID, staffID)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"list": rows}})
}

func (a *PayrollAPI) payrollThesisCreate(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	var body struct {
		StaffID           int64   `json:"staffId"`
		StudentID         *int64  `json:"studentId"`
		StudentNameManual *string `json:"studentNameManual"`
		Title             string  `json:"title"`
		TotalUnits        float64 `json:"totalUnits"`
		Role              string  `json:"role"`
		StartTermID       *int64  `json:"startTermId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.StaffID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	id, err := a.Engine.CreateSupervision(c.Request.Context(), payroll.CreateSupervisionInput{
		StaffID: body.StaffID, StudentID: body.StudentID, StudentNameManual: body.StudentNameManual,
		Title: body.Title, TotalUnits: body.TotalUnits, Role: body.Role,
		StartTermID: body.StartTermID, CreatedBy: &user.ID, UniversityID: uniID,
	})
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *PayrollAPI) payrollThesisStatus(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	var body struct {
		ID     int64  `json:"id"`
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	if err := a.Engine.SetSupervisionStatus(c.Request.Context(), body.ID, body.Status); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *PayrollAPI) payrollThesisDelete(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	if err := a.Engine.DeleteSupervision(c.Request.Context(), body.ID); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *PayrollAPI) payrollThesisDraws(c *gin.Context) {
	user := a.requireRoles(c, payrollViewRoles)
	if user == nil {
		return
	}
	sid, _ := strconv.ParseInt(c.Query("supervisionId"), 10, 64)
	rows, err := a.Engine.ListThesisDraws(c.Request.Context(), sid)
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"draws": rows}})
}

func (a *PayrollAPI) payrollThesisDrawCreate(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	var body struct {
		SupervisionID int64   `json:"supervisionId"`
		TermID        int64   `json:"termId"`
		Units         float64 `json:"units"`
		Note          *string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.SupervisionID <= 0 || body.TermID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	uniID := a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	id, err := a.Engine.AddThesisDraw(c.Request.Context(), payroll.AddThesisDrawInput{
		SupervisionID: body.SupervisionID, TermID: body.TermID, Units: body.Units,
		Note: body.Note, CreatedBy: &user.ID, UniversityID: uniID,
	})
	if err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *PayrollAPI) payrollThesisDrawDelete(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN", "EDU_EXPERT"})
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	if err := a.Engine.DeleteThesisDraw(c.Request.Context(), body.ID); err != nil {
		a.payrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
