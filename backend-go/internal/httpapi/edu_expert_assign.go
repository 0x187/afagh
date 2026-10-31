// ═══ تخصیص کارشناس آموزشی — هندلرهای HTTP (پورت admin/edu-expert-assign در Next) ═══
//
// struct مستقل EduExpertAPI — رجیستری در main.go:
//
//	(&httpapi.EduExpertAPI{Svc: adminSvc, Store: store}).Register(ginEngine.Group(""))
//
// دسترسی مرجع: requireRoleOrPermission(['ADMIN','EDU_EXPERT'], ['scheduling:manage_chart'])
// — بکند Go سیستم پرمیشن ندارد؛ همان دو نقش بررسی می‌شود.
package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
	"backend-go/internal/scope"
	"backend-go/internal/session"
)

var eduExpertRoles = []string{"ADMIN", "EDU_EXPERT"}

// EduExpertAPI هندلرهای تخصیص کارشناس آموزشی.
type EduExpertAPI struct {
	Svc   *admin.Service
	Store *session.Store
}

// Register مسیرهای تخصیص کارشناس — همه زیر /admin/edu-expert-assign/*.
func (a *EduExpertAPI) Register(r gin.IRouter) {
	r.GET("/admin/edu-expert-assign", a.eduExpertInit)
	r.POST("/admin/edu-expert-assign/classroom/department", a.eduExpertSetClassroomDept)
	r.POST("/admin/edu-expert-assign/classroom/add", a.eduExpertAddClassroom)
	r.POST("/admin/edu-expert-assign/classroom/remove", a.eduExpertRemoveClassroom)
	r.POST("/admin/edu-expert-assign/classroom/set", a.eduExpertSetClassroom)
	r.POST("/admin/edu-expert-assign/classroom/clear-all", a.eduExpertClearAllClassroom)
	r.POST("/admin/edu-expert-assign/offering/set", a.eduExpertSetOffering)
	r.POST("/admin/edu-expert-assign/offering/set-list", a.eduExpertSetOfferingList)
	r.POST("/admin/edu-expert-assign/offering/add", a.eduExpertAddOffering)
	r.POST("/admin/edu-expert-assign/offering/remove", a.eduExpertRemoveOffering)
	r.POST("/admin/edu-expert-assign/offering/bulk-set", a.eduExpertBulkSetOffering)
	r.POST("/admin/edu-expert-assign/offering/bulk-add", a.eduExpertBulkAddOffering)
	r.POST("/admin/edu-expert-assign/term/clear", a.eduExpertClearTerm)
}

// requireRoles — الگوی student_cards.go.
func (a *EduExpertAPI) requireRoles(c *gin.Context, roles []string) *session.User {
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
	for _, r := range user.Roles {
		for _, want := range roles {
			if r == want {
				return user
			}
		}
	}
	c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی غیرمجاز"})
	return nil
}

func (a *EduExpertAPI) uniCookie(c *gin.Context) string {
	if v, err := c.Cookie(scope.UniversityCookie); err == nil {
		return v
	}
	return ""
}

func (a *EduExpertAPI) fail(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
}

// eduExpertInit دادهٔ اولیهٔ کامل صفحه (ترم‌ها، کاندیدها، گروه‌ها، اتاق‌ها، استثناها).
func (a *EduExpertAPI) eduExpertInit(c *gin.Context) {
	user := a.requireRoles(c, eduExpertRoles)
	if user == nil {
		return
	}
	var termID *int64
	if v := c.Query("term"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			termID = &n
		}
	}
	res, err := a.Svc.ListEduExpertAssignInit(c.Request.Context(), user, a.uniCookie(c), termID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

// eduExpertSetClassroomDept تعیین/برداشتنِ گروهِ مسئولِ اتاق.
func (a *EduExpertAPI) eduExpertSetClassroomDept(c *gin.Context) {
	user := a.requireRoles(c, eduExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		ClassroomID  int64  `json:"classroomId"`
		DepartmentID *int64 `json:"departmentId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		a.fail(c, errors.New("ورودی نامعتبر است."))
		return
	}
	if err := a.Svc.SetClassroomDepartment(c.Request.Context(), user, a.uniCookie(c), in.ClassroomID, in.DepartmentID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// eduExpertAddClassroom افزودن یک کارشناس به یک یا چند اتاق.
func (a *EduExpertAPI) eduExpertAddClassroom(c *gin.Context) {
	user := a.requireRoles(c, eduExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		ClassroomIDs []int64 `json:"classroomIds"`
		UserID       int64   `json:"userId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		a.fail(c, errors.New("ورودی نامعتبر است."))
		return
	}
	updated, err := a.Svc.AddClassroomExperts(c.Request.Context(), user, a.uniCookie(c), in.ClassroomIDs, in.UserID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"updated": updated}})
}

// eduExpertRemoveClassroom حذف یک کارشناس از یک اتاق.
func (a *EduExpertAPI) eduExpertRemoveClassroom(c *gin.Context) {
	user := a.requireRoles(c, eduExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		ClassroomID int64 `json:"classroomId"`
		UserID      int64 `json:"userId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		a.fail(c, errors.New("ورودی نامعتبر است."))
		return
	}
	userIDs, err := a.Svc.RemoveClassroomExpert(c.Request.Context(), user, a.uniCookie(c), in.ClassroomID, in.UserID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"userIds": userIDs}})
}

// eduExpertSetClassroom جایگزینی کامل فهرست کارشناسان یک اتاق.
func (a *EduExpertAPI) eduExpertSetClassroom(c *gin.Context) {
	user := a.requireRoles(c, eduExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		ClassroomID int64   `json:"classroomId"`
		UserIDs     []int64 `json:"userIds"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		a.fail(c, errors.New("ورودی نامعتبر است."))
		return
	}
	userIDs, err := a.Svc.SetClassroomExperts(c.Request.Context(), user, a.uniCookie(c), in.ClassroomID, in.UserIDs)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"userIds": userIDs}})
}

// eduExpertClearAllClassroom آزاد کردن همهٔ تخصیص‌های سطح اتاق.
func (a *EduExpertAPI) eduExpertClearAllClassroom(c *gin.Context) {
	user := a.requireRoles(c, eduExpertRoles)
	if user == nil {
		return
	}
	updated, err := a.Svc.ClearAllClassroomExperts(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"updated": updated}})
}

// eduExpertSetOffering تخصیص یک کلاس به یک کارشناس (یا آزاد کردن با userId = null).
func (a *EduExpertAPI) eduExpertSetOffering(c *gin.Context) {
	user := a.requireRoles(c, eduExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		OfferingID int64  `json:"offeringId"`
		UserID     *int64 `json:"userId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		a.fail(c, errors.New("ورودی نامعتبر است."))
		return
	}
	if err := a.Svc.SetOfferingEduExpert(c.Request.Context(), user, a.uniCookie(c), in.OfferingID, in.UserID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// eduExpertSetOfferingList جایگزینی کامل فهرست کارشناسان یک کلاس (چند‌کارشناسه).
func (a *EduExpertAPI) eduExpertSetOfferingList(c *gin.Context) {
	user := a.requireRoles(c, eduExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		OfferingID int64   `json:"offeringId"`
		UserIDs    []int64 `json:"userIds"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		a.fail(c, errors.New("ورودی نامعتبر است."))
		return
	}
	userIDs, err := a.Svc.SetOfferingEduExpertList(c.Request.Context(), user, a.uniCookie(c), in.OfferingID, in.UserIDs)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"userIds": userIDs}})
}

// eduExpertAddOffering افزودن یک کارشناس به یک کلاس بدون دست‌زدن به بقیه.
func (a *EduExpertAPI) eduExpertAddOffering(c *gin.Context) {
	user := a.requireRoles(c, eduExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		OfferingID int64 `json:"offeringId"`
		UserID     int64 `json:"userId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		a.fail(c, errors.New("ورودی نامعتبر است."))
		return
	}
	if err := a.Svc.AddOfferingEduExpert(c.Request.Context(), user, a.uniCookie(c), in.OfferingID, in.UserID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// eduExpertRemoveOffering حذف یک کارشناس از یک کلاس (بقیه می‌مانند).
func (a *EduExpertAPI) eduExpertRemoveOffering(c *gin.Context) {
	user := a.requireRoles(c, eduExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		OfferingID int64 `json:"offeringId"`
		UserID     int64 `json:"userId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		a.fail(c, errors.New("ورودی نامعتبر است."))
		return
	}
	userIDs, err := a.Svc.RemoveOfferingEduExpert(c.Request.Context(), user, a.uniCookie(c), in.OfferingID, in.UserID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"userIds": userIDs}})
}

// eduExpertBulkSetOffering تخصیص گروهی — جایگزینی کامل.
func (a *EduExpertAPI) eduExpertBulkSetOffering(c *gin.Context) {
	user := a.requireRoles(c, eduExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		OfferingIDs []int64 `json:"offeringIds"`
		UserID      *int64  `json:"userId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		a.fail(c, errors.New("ورودی نامعتبر است."))
		return
	}
	updated, err := a.Svc.BulkSetOfferingEduExpert(c.Request.Context(), user, a.uniCookie(c), in.OfferingIDs, in.UserID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"updated": updated}})
}

// eduExpertBulkAddOffering تخصیص گروهی — افزودنی.
func (a *EduExpertAPI) eduExpertBulkAddOffering(c *gin.Context) {
	user := a.requireRoles(c, eduExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		OfferingIDs []int64 `json:"offeringIds"`
		UserID      int64   `json:"userId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		a.fail(c, errors.New("ورودی نامعتبر است."))
		return
	}
	updated, err := a.Svc.BulkAddOfferingEduExpert(c.Request.Context(), user, a.uniCookie(c), in.OfferingIDs, in.UserID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"updated": updated}})
}

// eduExpertClearTerm آزاد کردن همهٔ تخصیص‌های یک ترم.
func (a *EduExpertAPI) eduExpertClearTerm(c *gin.Context) {
	user := a.requireRoles(c, eduExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		TermID int64 `json:"termId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.TermID <= 0 {
		a.fail(c, errors.New("ترم نامعتبر است."))
		return
	}
	updated, err := a.Svc.ClearTermEduExperts(c.Request.Context(), user, a.uniCookie(c), in.TermID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"updated": updated}})
}
