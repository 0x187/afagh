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
)

// AdminAPI هندلرهای ادمین.
type AdminAPI struct {
	Svc   *admin.Service
	Store *session.Store
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
