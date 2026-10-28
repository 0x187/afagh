// ═══ اندپوینت‌های پنل ادمین (فاز ۶) ═══
package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
	"backend-go/internal/scope"
	"backend-go/internal/session"
	"backend-go/internal/student"
)

// AdminAPI هندلرهای ادمین.
type AdminAPI struct {
	Svc            *admin.Service
	Store          *session.Store
	StudentFinance *student.Service
}

func (a *AdminAPI) Register(r gin.IRouter) {
	r.GET("/admin/dashboard", a.dashboard)
	r.GET("/admin/students", a.students)
	r.POST("/admin/students/active", a.studentActive)
	r.POST("/admin/students/reset-password", a.studentResetPassword)
	r.GET("/admin/departments", a.departments)
	r.GET("/admin/staff", a.staff)
	r.GET("/admin/offerings", a.offerings)
	r.POST("/admin/offerings/window", a.offeringsWindow)
	r.POST("/admin/offerings/targeting", a.offeringsTargeting)
	r.POST("/admin/offerings/type", a.offeringsType)
	r.GET("/admin/evaluations", a.evaluations)
	r.POST("/admin/evaluations", a.createEvaluation)
	r.POST("/admin/evaluations/toggle", a.toggleEvaluation)
	r.POST("/admin/evaluations/delete", a.deleteEvaluation)
	r.GET("/admin/weekly-board", a.weeklyBoard)
	r.GET("/admin/settings", a.settings)
	r.POST("/admin/settings", a.saveSetting)
	r.POST("/admin/settings/reset", a.resetSetting)
	r.GET("/admin/exams", a.exams)
	r.POST("/admin/exams/sessions", a.createExamSession)
	r.POST("/admin/exams/assign", a.assignExamSession)
	r.POST("/admin/exams/halls", a.createExamHall)
	r.POST("/admin/exams/seats", a.generateExamSeats)
	r.GET("/admin/attendance/manual", a.attendanceManual)
	r.POST("/admin/attendance/confirm", a.attendanceConfirm)
	r.POST("/admin/attendance/status", a.attendanceStatus)
	r.GET("/admin/attendance/control", a.attendanceControl)
	r.POST("/admin/attendance/record", a.attendanceRecord)
	r.GET("/admin/finance", a.financeStudents)
	r.GET("/admin/finance/student/:id", a.financeStudent)
	r.POST("/admin/finance/adjust", a.financeAdjust)
	r.GET("/admin/course-finance", a.courseFinance)
	r.POST("/admin/course-finance", a.setCourseFinance)
	r.GET("/admin/finance/rules", a.financeRules)
	r.POST("/admin/finance/rules/discount-type", a.saveDiscountType)
	r.POST("/admin/finance/rules/discount-type/delete", a.deleteDiscountType)
	r.POST("/admin/finance/rules/sponsor", a.saveSponsor)
	r.POST("/admin/finance/rules/sponsor/delete", a.deleteSponsor)
	r.POST("/admin/finance/rules/loan-product", a.saveLoanProduct)
	r.POST("/admin/finance/rules/loan-product/delete", a.deleteLoanProduct)
	r.POST("/admin/finance/rules/formula", a.saveFormula)
	r.POST("/admin/finance/rules/formula/delete", a.deleteFormula)
	r.GET("/admin/pos/terminals", a.posTerminals)
	r.GET("/admin/pos/transactions", a.posTransactions)
	r.POST("/admin/pos/sale", a.posSale)
	r.POST("/admin/pos/void", a.posVoid)
}

var adminRoles = []string{
	"ADMIN", "EDU_EXPERT", "ARCHIVE_EXPERT", "GRADUATEAFFAIRS", "MILITARY_OFFICER",
	"FINANCE_EXPERT", "FINANCE", "VAULT_MANAGER", "VICE_EDU", "DEP_HEAD", "PROCTOR",
}

func (a *AdminAPI) requireAdmin(c *gin.Context) *session.User {
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
		for _, want := range adminRoles {
			if r == want {
				allowed = true
			}
		}
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی به پنل مدیریت مجاز نیست."})
		return nil
	}
	return user
}

func (a *AdminAPI) uniCookie(c *gin.Context) string {
	if v, err := c.Cookie(scope.UniversityCookie); err == nil {
		return v
	}
	return ""
}

func (a *AdminAPI) fail(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
}

func (a *AdminAPI) dashboard(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetDashboard(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) students(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	page, _ := strconv.Atoi(strings.TrimSpace(c.Query("page")))
	resp, err := a.Svc.ListStudents(c.Request.Context(), user, a.uniCookie(c),
		strings.TrimSpace(c.Query("q")), strings.TrimSpace(c.Query("status")), page)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) studentActive(c *gin.Context) {
	if a.requireAdmin(c) == nil {
		return
	}
	var body struct {
		UserID int64 `json:"userId"`
		Active bool  `json:"active"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.UserID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SetUserActive(c.Request.Context(), body.UserID, body.Active); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) studentResetPassword(c *gin.Context) {
	if a.requireAdmin(c) == nil {
		return
	}
	var body struct {
		UserID int64 `json:"userId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.UserID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.ResetPasswordToNationalCode(c.Request.Context(), body.UserID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) departments(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.ListDepartments(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) offerings(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetOfferings(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) offeringsWindow(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		TermID int64  `json:"termId"`
		Open   bool   `json:"open"`
		Start  string `json:"start"`
		End    string `json:"end"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.TermID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveWindow(c.Request.Context(), user, a.uniCookie(c), body.TermID, body.Open, body.Start, body.End); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) offeringsTargeting(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		OfferingID     int64  `json:"offeringId"`
		Degree         *int64 `json:"degree"`
		Major          *int64 `json:"major"`
		EntryYearStart *int   `json:"entryYearStart"`
		EntryYearEnd   *int   `json:"entryYearEnd"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.OfferingID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveTargeting(c.Request.Context(), user, a.uniCookie(c), body.OfferingID, body.Degree, body.Major, body.EntryYearStart, body.EntryYearEnd); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) offeringsType(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		OfferingID int64  `json:"offeringId"`
		Type       string `json:"type"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.OfferingID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveOfferingType(c.Request.Context(), user, a.uniCookie(c), body.OfferingID, body.Type); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) evaluations(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetEvaluations(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) createEvaluation(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		Title    string `json:"title"`
		TermID   int64  `json:"termId"`
		Start    string `json:"start"`
		End      string `json:"end"`
		IsActive bool   `json:"isActive"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.CreateEvalPeriod(c.Request.Context(), user, a.uniCookie(c), body.Title, body.TermID, body.Start, body.End, body.IsActive); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) toggleEvaluation(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.ToggleEvalPeriod(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) deleteEvaluation(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteEvalPeriod(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) weeklyBoard(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetWeeklyBoard(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) settings(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	allowed := false
	for _, r := range user.Roles {
		if r == "ADMIN" {
			allowed = true
		}
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "تنظیمات فقط برای مدیر سامانه است."})
		return
	}
	resp, err := a.Svc.GetSettings(c.Request.Context(), user)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) saveSetting(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Key) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveSetting(c.Request.Context(), user, body.Key, body.Value); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) resetSetting(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		Key string `json:"key"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Key) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.ResetSetting(c.Request.Context(), user, body.Key); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) exams(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetExams(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) createExamSession(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		TermID   int64  `json:"termId"`
		ExamDate string `json:"examDate"`
		Start    string `json:"start"`
		End      string `json:"end"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.TermID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.CreateExamSession(c.Request.Context(), user, a.uniCookie(c), body.TermID, body.ExamDate, body.Start, body.End); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) assignExamSession(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		OfferingID int64 `json:"offeringId"`
		SessionID  int64 `json:"sessionId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.OfferingID <= 0 || body.SessionID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.AssignExamSession(c.Request.Context(), user, a.uniCookie(c), body.OfferingID, body.SessionID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) createExamHall(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		Name      string `json:"name"`
		Capacity  int    `json:"capacity"`
		RowsCount int    `json:"rowsCount"`
		ColsCount int    `json:"colsCount"`
		Building  string `json:"buildingName"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.CreateExamHall(c.Request.Context(), user, a.uniCookie(c), body.Name, body.Capacity, body.RowsCount, body.ColsCount, body.Building); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) generateExamSeats(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	allocated, sessions, err := a.Svc.GenerateExamSeats(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "allocated": allocated, "sessionCount": sessions})
}

func (a *AdminAPI) attendanceManual(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetManualAttendance(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) attendanceConfirm(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		SessionID int64 `json:"sessionId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.SessionID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.ConfirmProfessorAttendance(c.Request.Context(), user, body.SessionID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) attendanceStatus(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		SessionID int64  `json:"sessionId"`
		Status    string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.SessionID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.MarkClassHeld(c.Request.Context(), user, body.SessionID, body.Status); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) attendanceControl(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetControl(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) attendanceRecord(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		SessionID int64 `json:"sessionId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.SessionID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.RecordClassPresence(c.Request.Context(), user, body.SessionID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) financeStudents(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.ListFinanceStudents(c.Request.Context(), user, a.uniCookie(c),
		strings.TrimSpace(c.Query("q")), c.Query("debtors") == "1")
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) financeStudent(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ دانشجو نامعتبر است."})
		return
	}
	resp, err := a.StudentFinance.GetFinanceByStudentID(c.Request.Context(), id, termIDFromCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	txns, err := a.Svc.ListLedgerTxns(c.Request.Context(), id)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"finance": resp, "txns": txns}})
}

func (a *AdminAPI) financeAdjust(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.AdjustInput
	if err := c.ShouldBindJSON(&body); err != nil || body.StudentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.AdjustLedger(c.Request.Context(), user, a.uniCookie(c), body); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) courseFinance(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.ListCourseFinance(c.Request.Context(), user, a.uniCookie(c), strings.TrimSpace(c.Query("q")))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) setCourseFinance(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		CourseID int64 `json:"courseId"`
		MaliType int   `json:"maliType"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.CourseID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SetCourseFinanceType(c.Request.Context(), user, body.CourseID, body.MaliType); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) financeRules(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.ListFinanceRules(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) saveDiscountType(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.DiscountTypeInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveDiscountType(c.Request.Context(), user, a.uniCookie(c), body); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) deleteDiscountType(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteDiscountType(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) saveSponsor(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.SponsorInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveSponsor(c.Request.Context(), user, a.uniCookie(c), body); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) deleteSponsor(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteSponsor(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) saveLoanProduct(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.LoanProductInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveLoanProduct(c.Request.Context(), user, a.uniCookie(c), body); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) deleteLoanProduct(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteLoanProduct(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) saveFormula(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.FormulaInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveFormula(c.Request.Context(), user, a.uniCookie(c), body); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) deleteFormula(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteFormula(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) posTerminals(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetPosTerminals(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"terminals": resp}})
}

func (a *AdminAPI) posTransactions(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	resp, err := a.Svc.GetPosTransactions(c.Request.Context(), user, a.uniCookie(c),
		strings.TrimSpace(c.Query("studentCode")), strings.TrimSpace(c.Query("status")), limit)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"transactions": resp}})
}

func (a *AdminAPI) posSale(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.PosSaleInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	resp, err := a.Svc.RecordPosSale(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp, "pending": true})
}

func (a *AdminAPI) posVoid(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		TerminalCode string `json:"terminalCode"`
		Stan         string `json:"stan"`
		Reason       string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.VoidPosTransaction(c.Request.Context(), user, a.uniCookie(c), body.TerminalCode, body.Stan, body.Reason); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) staff(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	rows, err := a.Svc.ListStaff(c.Request.Context(), user, a.uniCookie(c), strings.TrimSpace(c.Query("q")))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "rows": rows})
}
