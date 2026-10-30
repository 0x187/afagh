// ═══ اندپوینت‌های مرکز گزارش‌های مالی و صورت‌حساب دانشجو ═══
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/reports"
	"backend-go/internal/session"
)

var financeReportRoles = []string{
	"ADMIN", "EDU_EXPERT", "ARCHIVE_EXPERT", "MILITARY_OFFICER",
	"FINANCE_EXPERT", "FINANCE", "CASHIER",
}

// requireFinanceReport گیت مرکز گزارش‌های مالی — همان ROLES در actions.ts.
func (a *AdminAPI) requireFinanceReport(c *gin.Context) *session.User {
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
	allowed := false
	for _, r := range user.Roles {
		for _, want := range financeReportRoles {
			if r == want {
				allowed = true
			}
		}
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی به مرکز گزارش‌های مالی مجاز نیست."})
		return nil
	}
	return user
}

func (a *AdminAPI) financeReportOptions(c *gin.Context) {
	user := a.requireFinanceReport(c)
	if user == nil {
		return
	}
	if a.Reports == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "سرویس گزارش در دسترس نیست."})
		return
	}
	opts, err := a.Reports.Options(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": opts})
}

type reportRunInput struct {
	Kind    string          `json:"kind"`
	Filters reports.Filters `json:"filters"`
}

func (a *AdminAPI) financeReportRun(c *gin.Context) {
	user := a.requireFinanceReport(c)
	if user == nil {
		return
	}
	var in reportRunInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if in.Kind == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "نوع گزارش الزامی است."})
		return
	}
	res, err := a.Reports.Run(c.Request.Context(), user, a.uniCookie(c), in.Kind, in.Filters)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) financeReportExport(c *gin.Context) {
	user := a.requireFinanceReport(c)
	if user == nil {
		return
	}
	var in reportRunInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if in.Kind == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "نوع گزارش الزامی است."})
		return
	}
	res, err := a.Reports.Export(c.Request.Context(), user, a.uniCookie(c), in.Kind, in.Filters)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) financeStatementStudents(c *gin.Context) {
	user := a.requireFinanceReport(c)
	if user == nil {
		return
	}
	rows, err := a.Reports.StudentsPicker(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"students": rows}})
}

// financeStudentStatement صورت‌حساب رسمی یک دانشجو — همان موتور کارنامهٔ مالی.
func (a *AdminAPI) financeStudentStatement(c *gin.Context) {
	user := a.requireFinanceReport(c)
	if user == nil {
		return
	}
	studentID, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	if studentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه دانشجو الزامی است"})
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if uniID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشگاه فعال یافت نشد"})
		return
	}
	var exists int
	if err := a.Svc.DB.Pool.QueryRow(c.Request.Context(), `
		select 1 from students where id = $1 and "universityId" = $2`, studentID, *uniID).Scan(&exists); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "دانشجو یافت نشد"})
		return
	}
	stmt, err := a.StudentFinance.GetStudentStatement(c.Request.Context(), studentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": stmt})
}
