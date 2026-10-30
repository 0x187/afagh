// ═══ اندپوینت‌های پنل ادمین (فاز ۶) ═══
package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
	"backend-go/internal/archive"
	"backend-go/internal/graduation"
	"backend-go/internal/reports"
	"backend-go/internal/scope"
	"backend-go/internal/session"
	"backend-go/internal/student"
)

// AdminAPI هندلرهای ادمین.
type AdminAPI struct {
	Svc            *admin.Service
	Store          *session.Store
	StudentFinance *student.Service
	Archive        *archive.Store
	Reports        *reports.Service
	Graduation     *graduation.Service
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
	r.GET("/admin/finance/reports/options", a.financeReportOptions)
	r.POST("/admin/finance/reports/run", a.financeReportRun)
	r.POST("/admin/finance/reports/export", a.financeReportExport)
	r.GET("/admin/finance/reports/students", a.financeStatementStudents)
	r.GET("/admin/finance/reports/student-statement", a.financeStudentStatement)
	r.GET("/admin/warnings", a.warningsList)
	r.GET("/admin/warnings/students", a.warningsStudents)
	r.POST("/admin/warnings", a.warningsCreate)
	r.POST("/admin/warnings/update", a.warningsUpdate)
	r.POST("/admin/warnings/delete", a.warningsDelete)
	r.GET("/admin/graduation", a.graduationSeed)
	r.POST("/admin/graduation/scan", a.graduationScan)
	r.POST("/admin/graduation/list", a.graduationList)
	r.POST("/admin/graduation/dossier", a.graduationDossier)
	r.POST("/admin/graduation/head-approve", a.graduationHeadApprove)
	r.POST("/admin/graduation/hold", a.graduationHold)
	r.POST("/admin/graduation/resume", a.graduationResume)
	r.POST("/admin/graduation/irandoc", a.graduationIrandoc)
	r.POST("/admin/graduation/start-clearance", a.graduationStartClearance)
	r.POST("/admin/graduation/auto-clearance", a.graduationAutoClearance)
	r.POST("/admin/graduation/set-clearance", a.graduationSetClearance)
	r.POST("/admin/graduation/advance", a.graduationAdvance)
	r.POST("/admin/graduation/ministry-code", a.graduationMinistryCode)
	r.POST("/admin/graduation/waive-sajjad", a.graduationWaiveSajjad)
	r.POST("/admin/graduation/issue", a.graduationIssue)
	r.POST("/admin/graduation/deliver", a.graduationDeliver)
	r.POST("/admin/graduation/department/save", a.graduationDepartmentSave)
	r.POST("/admin/graduation/department/delete", a.graduationDepartmentDelete)
	r.POST("/admin/graduation/alumni/requests", a.graduationAlumniRequests)
	r.POST("/admin/graduation/alumni/resolve", a.graduationAlumniResolve)
	r.GET("/admin/student-cards", a.studentCardsList)
	r.POST("/admin/student-cards/issue", a.studentCardIssue)
	r.POST("/admin/student-cards/revoke", a.studentCardRevoke)
	r.GET("/admin/student-cards/print", a.studentCardPrint)
	r.GET("/photo/:userId", a.photo)
	r.GET("/admin/dorm", a.dormList)
	r.POST("/admin/dorm", a.dormCreate)
	r.POST("/admin/dorm/update", a.dormUpdate)
	r.POST("/admin/dorm/delete", a.dormDelete)
	r.GET("/admin/students/search", a.adminStudentSearch)
	r.GET("/admin/admissions", a.admissionsBundle)
	r.POST("/admin/admissions/stage", a.admissionsStage)
	r.POST("/admin/admissions/import", a.admissionsImport)
	r.POST("/admin/admissions/mapping", a.admissionsMapping)
	r.POST("/admin/admissions/formula", a.admissionsFormula)
	r.POST("/admin/admissions/manual", a.admissionsManual)
	r.POST("/admin/admissions/irandoc-test", a.admissionsIrandoc)
	r.GET("/admin/enrollment-approvals", a.enrollmentApprovals)
	r.POST("/admin/enrollment-approvals", a.enrollmentApprovalCreate)
	r.POST("/admin/enrollment-approvals/update", a.enrollmentApprovalUpdate)
	r.POST("/admin/enrollment-approvals/delete", a.enrollmentApprovalDelete)
	r.GET("/admin/enrollment-confirmation", a.enrollmentConfirmation)
	r.GET("/admin/offering-merge", a.offeringMergeGroups)
	r.POST("/admin/offering-merge/update", a.offeringMergeUpdate)
	r.GET("/admin/equivalence-clusters", a.equivalenceClusters)
	r.POST("/admin/equivalence-clusters", a.equivalenceClusterCreate)
	r.POST("/admin/equivalence-clusters/update", a.equivalenceClusterUpdate)
	r.POST("/admin/equivalence-clusters/delete", a.equivalenceClusterDelete)
	r.POST("/admin/equivalence-clusters/members", a.equivalenceClusterMembers)
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
	r.GET("/admin/discipline", a.disciplineList)
	r.GET("/admin/discipline/students", a.disciplineStudents)
	r.POST("/admin/discipline", a.disciplineCreate)
	r.POST("/admin/discipline/update", a.disciplineUpdate)
	r.POST("/admin/discipline/delete", a.disciplineDelete)
	r.GET("/admin/council", a.councilMeetings)
	r.POST("/admin/council", a.councilMeetingSave)
	r.POST("/admin/council/delete", a.councilMeetingDelete)
	r.GET("/admin/council/decisions", a.councilDecisions)
	r.POST("/admin/council/decisions", a.councilDecisionSave)
	r.POST("/admin/council/decisions/delete", a.councilDecisionDelete)
	r.GET("/admin/finance/student-formula", a.financeStudentFormula)
	r.POST("/admin/finance/student-formula", a.financeStudentFormulaCreate)
	r.POST("/admin/finance/student-formula/update", a.financeStudentFormulaUpdate)
	r.POST("/admin/finance/student-formula/delete", a.financeStudentFormulaDelete)
	r.GET("/admin/finance/welfare", a.financeWelfareFunds)
	r.GET("/admin/finance/welfare/loans", a.financeWelfareLoans)
	r.POST("/admin/finance/welfare", a.financeWelfareFundCreate)
	r.POST("/admin/finance/welfare/update", a.financeWelfareFundUpdate)
	r.POST("/admin/finance/welfare/delete", a.financeWelfareFundDelete)
	r.POST("/admin/finance/welfare/assign-loan", a.financeWelfareAssignLoan)
	r.GET("/admin/finance/time-control", a.financeTimeControl)
	r.POST("/admin/finance/time-control", a.financeTimeControlSave)
	r.GET("/admin/finance/coefficients", a.financeCoefficients)
	r.POST("/admin/finance/coefficients", a.financeCoefficientSave)
	r.POST("/admin/finance/coefficients/delete", a.financeCoefficientDelete)
	r.GET("/admin/finance/subject-fees", a.financeSubjectFees)
	r.POST("/admin/finance/subject-fees", a.financeSubjectFeeSave)
	r.POST("/admin/finance/subject-fees/delete", a.financeSubjectFeeDelete)
	r.GET("/admin/finance/subject-fees/assign", a.financeSubjectFeeAssignments)
	r.POST("/admin/finance/subject-fees/assign", a.financeSubjectFeeAssign)
	r.POST("/admin/finance/subject-fees/assign/delete", a.financeSubjectFeeAssignDelete)
	r.GET("/admin/archive/documents", a.archiveDocuments)
	r.POST("/admin/archive/verify", a.archiveVerify)
	r.POST("/admin/archive/upload", a.archiveUpload)
	r.GET("/admin/archive/file/:id", a.archiveFile)
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

// ─────────────────── کمیتهٔ انضباطی / شورا ───────────────────

func (a *AdminAPI) disciplineList(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	sid, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	resp, err := a.Svc.ListDisciplineCases(c.Request.Context(), user, a.uniCookie(c),
		strings.TrimSpace(c.Query("status")), strings.TrimSpace(c.Query("q")),
		strings.TrimSpace(c.Query("dateFrom")), strings.TrimSpace(c.Query("dateTo")), sid, page)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) disciplineStudents(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	hits, err := a.Svc.SearchDisciplineStudents(c.Request.Context(), user, a.uniCookie(c), c.Query("q"))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"hits": hits}})
}

func (a *AdminAPI) disciplineCreate(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.CreateDisciplineInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	id, err := a.Svc.CreateDisciplineCase(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) disciplineUpdate(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
		admin.UpdateDisciplineInput
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه پرونده نامعتبر است."})
		return
	}
	if err := a.Svc.UpdateDisciplineCase(c.Request.Context(), user, a.uniCookie(c), body.ID, body.UpdateDisciplineInput); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) disciplineDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه پرونده نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteDisciplineCase(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) councilMeetings(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	rows, total, p, err := a.Svc.ListCouncilMeetings(c.Request.Context(), user, a.uniCookie(c),
		strings.TrimSpace(c.Query("q")), strings.TrimSpace(c.Query("dateFrom")), strings.TrimSpace(c.Query("dateTo")), page)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows, "total": total, "page": p, "pageSize": 50}})
}

func (a *AdminAPI) councilMeetingSave(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.MeetingInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	id, err := a.Svc.SaveCouncilMeeting(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) councilMeetingDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه جلسه نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteCouncilMeeting(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) councilDecisions(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	mid, _ := strconv.ParseInt(c.Query("meetingId"), 10, 64)
	sid, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	rows, total, p, err := a.Svc.ListCouncilDecisions(c.Request.Context(), user, a.uniCookie(c),
		strings.TrimSpace(c.Query("status")), strings.TrimSpace(c.Query("type")), mid, sid, page)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows, "total": total, "page": p, "pageSize": 50}})
}

func (a *AdminAPI) councilDecisionSave(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.DecisionInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	id, err := a.Svc.SaveCouncilDecision(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) councilDecisionDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه مصوبه نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteCouncilDecision(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─────────────────── بایگانی مدارک ───────────────────

func (a *AdminAPI) archiveDocuments(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.ListArchiveDocuments(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) archiveVerify(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	allowed := false
	for _, r := range user.Roles {
		if r == "ADMIN" || r == "ARCHIVE_EXPERT" {
			allowed = true
		}
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی غیرمجاز"})
		return
	}
	var body struct {
		DocID    int64  `json:"docId"`
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.DocID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "پارامتر ناقص"})
		return
	}
	if err := a.Svc.VerifyArchiveDoc(c.Request.Context(), user, a.uniCookie(c), body.DocID, body.Decision, body.Reason); err != nil {
		a.fail(c, err)
		return
	}
	dec := "VERIFIED"
	if body.Decision == "REJECTED" {
		dec = "REJECTED"
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"docId": body.DocID, "decision": dec}})
}

func (a *AdminAPI) archiveUpload(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "فایل ارسال نشد"})
		return
	}
	if file.Size > 10*1024*1024 {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"ok": false, "error": "حجم بیش از ۱۰MB"})
		return
	}
	f, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "فایل نامعتبر است"})
		return
	}
	defer f.Close()
	data := make([]byte, file.Size)
	if _, err := f.Read(data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خواندن فایل ناموفق بود"})
		return
	}
	in := admin.ArchiveUploadInput{
		FileName: file.Filename, ClaimedType: file.Header.Get("Content-Type"), Data: data,
	}
	in.StudentUserID, _ = strconv.ParseInt(c.PostForm("studentUserId"), 10, 64)
	in.CategoryID, _ = strconv.ParseInt(c.PostForm("categoryId"), 10, 64)
	if raw := strings.TrimSpace(c.PostForm("typeId")); raw != "" {
		if v, err := strconv.ParseInt(raw, 10, 64); err == nil && v > 0 {
			in.TypeID = &v
		}
	}
	if in.StudentUserID <= 0 || in.CategoryID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "پارامتر ناقص"})
		return
	}
	id, err := a.Svc.UploadArchiveDocument(c.Request.Context(), user, a.uniCookie(c), a.Archive, in)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"docId": id}})
}

// archiveFile سرو امن فایل — فقط نوع‌های مجاز رندر، بقیه attachment.
func (a *AdminAPI) archiveFile(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	if a.Archive == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "بایگانی پیکربندی نشده است."})
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ سند نامعتبر است."})
		return
	}
	doc, err := a.Svc.GetArchiveDocForDownload(c.Request.Context(), user, a.uniCookie(c), id)
	if err != nil {
		a.fail(c, err)
		return
	}
	data, storedMime, err := a.Archive.Get(c.Request.Context(), doc.Key)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "فایل در بایگانی یافت نشد."})
		return
	}
	safeMime := map[string]bool{
		"image/jpeg": true, "image/png": true, "image/webp": true, "image/gif": true, "image/bmp": true, "application/pdf": true,
	}
	mime := strings.ToLower(doc.MimeType)
	if mime == "" {
		mime = strings.ToLower(storedMime)
	}
	forceDownload := !safeMime[mime]
	if !safeMime[mime] {
		mime = "application/octet-stream"
	}
	disp := "inline"
	if forceDownload {
		disp = "attachment"
	}
	c.Header("X-Watermark", url.QueryEscape(user.Name+" | "+time.Now().UTC().Format(time.RFC3339)))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:")
	c.Header("Content-Disposition", fmt.Sprintf("%s; filename*=UTF-8''%s", disp, url.PathEscape(doc.FileName)))
	c.Header("Cache-Control", "private, max-age=300")
	c.Data(http.StatusOK, mime, data)
}

// ─────────────────── ضرایب نیمسال + مبالغ موضوعی ───────────────────

func (a *AdminAPI) financeCoefficients(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	rows, err := a.Svc.ListCoefficients(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows}})
}

func (a *AdminAPI) financeCoefficientSave(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.SaveCoefficientInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	id, err := a.Svc.SaveCoefficient(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) financeCoefficientDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه الزامی است"})
		return
	}
	if err := a.Svc.DeleteCoefficient(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) financeSubjectFees(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	rows, err := a.Svc.ListSubjectFeeTypes(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows}})
}

func (a *AdminAPI) financeSubjectFeeSave(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.SubjectFeeKindInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	id, err := a.Svc.SaveSubjectFeeType(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) financeSubjectFeeDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه الزامی است"})
		return
	}
	if err := a.Svc.DeleteSubjectFeeType(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) financeSubjectFeeAssignments(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	studentID, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	rows, err := a.Svc.ListSubjectFeeAssignments(c.Request.Context(), user, a.uniCookie(c), studentID, termID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows}})
}

func (a *AdminAPI) financeSubjectFeeAssign(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.AssignSubjectFeeInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	id, err := a.Svc.AssignSubjectFee(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) financeSubjectFeeAssignDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه الزامی است"})
		return
	}
	if err := a.Svc.DeleteSubjectFeeAssignment(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─────────────────── کنترل زمانی ثبت مالی ───────────────────

func (a *AdminAPI) financeTimeControl(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	state, err := a.Svc.GetLockState(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": state})
}

func (a *AdminAPI) financeTimeControlSave(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.SavePeriodInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "پارامترهای نامعتبر (نام دوره، تاریخ شروع و پایان الزامی است)"})
		return
	}
	state, err := a.Svc.SaveAccountingPeriod(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": state})
}

// ─────────────────── فرمول ویژهٔ دانشجو ───────────────────

func (a *AdminAPI) financeStudentFormula(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	sid, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	rows, total, err := a.Svc.ListTuitionOverrides(c.Request.Context(), user, a.uniCookie(c),
		strings.TrimSpace(c.Query("q")), sid, c.Query("active") == "1", page)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows, "total": total, "page": page, "pageSize": 50}})
}

func (a *AdminAPI) financeStudentFormulaCreate(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.SaveTuitionOverrideInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_body"})
		return
	}
	id, err := a.Svc.CreateTuitionOverride(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) financeStudentFormulaUpdate(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
		admin.UpdateTuitionOverrideInput
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_id"})
		return
	}
	if err := a.Svc.UpdateTuitionOverride(c.Request.Context(), user, body.ID, body.UpdateTuitionOverrideInput); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) financeStudentFormulaDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_id"})
		return
	}
	if err := a.Svc.DeleteTuitionOverride(c.Request.Context(), user, body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─────────────────── صندوق رفاه ───────────────────

func (a *AdminAPI) financeWelfareFunds(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	funds, err := a.Svc.ListWelfareFunds(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"funds": funds}})
}

func (a *AdminAPI) financeWelfareLoans(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	raw := strings.TrimSpace(c.Query("fundId"))
	var fundID *int64
	if raw != "" && raw != "unassigned" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_fund"})
			return
		}
		fundID = &v
	}
	page, _ := strconv.Atoi(c.Query("page"))
	rows, total, err := a.Svc.ListWelfareLoans(c.Request.Context(), user, a.uniCookie(c), fundID, page)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows, "total": total, "page": page, "pageSize": 50}})
}

func (a *AdminAPI) financeWelfareFundCreate(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.WelfareFundInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_body"})
		return
	}
	id, err := a.Svc.CreateWelfareFund(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		if err.Error() == "duplicate_code" {
			c.JSON(http.StatusConflict, gin.H{"ok": false, "error": "duplicate_code"})
			return
		}
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) financeWelfareFundUpdate(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
		admin.WelfareFundInput
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_id"})
		return
	}
	if err := a.Svc.UpdateWelfareFund(c.Request.Context(), user, body.ID, body.WelfareFundInput); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) financeWelfareFundDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_id"})
		return
	}
	if err := a.Svc.DeleteWelfareFund(c.Request.Context(), user, body.ID); err != nil {
		if strings.HasPrefix(err.Error(), "fund_in_use:") {
			c.JSON(http.StatusConflict, gin.H{"ok": false, "error": "fund_in_use", "loanCount": strings.TrimPrefix(err.Error(), "fund_in_use:")})
			return
		}
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) financeWelfareAssignLoan(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body map[string]json.RawMessage
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_loan"})
		return
	}
	var loanID int64
	if raw, ok := body["loanId"]; ok {
		_ = json.Unmarshal(raw, &loanID)
	}
	fundRaw, fundSet := body["fundId"]
	var fundID *int64
	if fundSet && string(fundRaw) != "null" {
		var v int64
		if err := json.Unmarshal(fundRaw, &v); err == nil {
			fundID = &v
		}
	}
	in := admin.AssignLoanInput{LoanID: loanID, FundID: fundID, FundIDSet: fundSet}
	if err := a.Svc.AssignLoanToFund(c.Request.Context(), user, a.uniCookie(c), in); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
