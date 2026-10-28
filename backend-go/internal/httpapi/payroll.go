// ═══ اندپوینت‌های حق‌التدریس (فاز ۷ — حقوق و دستمزد) ═══
package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/payroll"
	"backend-go/internal/scope"
	"backend-go/internal/session"
)

// PayrollAPI هندلرهای موتور حق‌التدریس.
type PayrollAPI struct {
	Engine    *payroll.Engine
	Approvals *payroll.Approvals
	Store     *session.Store
	Pool      *pgxpool.Pool
	Scope     *scope.Service
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

// requirePayrollUser گیت نشست + نقش‌های پنل (همان مجموعهٔ adminRoles).
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
}

// staffRefOf پروندهٔ کارمندی کاربر — برای دامنهٔ مدیر گروه.
func (a *PayrollAPI) staffRefOf(ctx context.Context, userID int64) (*payroll.StaffRef, error) {
	var ref payroll.StaffRef
	err := a.Pool.QueryRow(ctx, `select id, "departmentId", "universityId" from staff where "userId" = $1 limit 1`, userID).
		Scan(&ref.StaffID, &ref.DepartmentID, &ref.UniversityID)
	if err != nil {
		return nil, errors.New("پروندهٔ کارمندی شما یافت نشد.")
	}
	return &ref, nil
}

// headedDeptIDs گروه‌های زیر نظر یک استاد (همان منطق headedDepartments؛
// در نبود ستون headStaffId به عضویت کارمندی تکیه می‌کنیم).
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

// canActUni مرز دانشگاهی کاربر.
func (a *PayrollAPI) canActUni(ctx context.Context, user *session.User, universityID int64) bool {
	id := universityID
	return a.Scope.CanActOnUniversity(ctx, user, &id)
}

// getScopedOverview پورت getScopedOverview: نمای دامنه‌دار.
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
		// مانده‌ها از جمع حذف می‌شوند تا اعداد کارتابل با فهرست بخواند
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
	// 🔒 مرز دانشگاه: فیش هر استاد فقط برای کاربران مجاز همان دانشگاه
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
