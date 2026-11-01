// ═══ Educational Expert Assignment — HTTP handlers (port of admin/edu-expert-assign in Next) ═══
//
// Standalone EduExpertAPI struct — registered in main.go:
//
//	(&httpapi.EduExpertAPI{Svc: adminSvc, Store: store}).Register(ginEngine.Group(""))
//
// Reference access: requireRoleOrPermission(['ADMIN','EDU_EXPERT'], ['scheduling:manage_chart'])
// — the Go backend has no permission system; only these two roles are checked.
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

// EduExpertAPI educational expert assignment handlers.
type EduExpertAPI struct {
	Svc   *admin.Service
	Store *session.Store
}

// Register expert assignment routes — all under /admin/edu-expert-assign/*.
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

// requireRoles — pattern from student_cards.go.
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

// eduExpertInit full initial page data (terms, candidates, groups, rooms, exceptions).
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

// eduExpertSetClassroomDept set/clear the room's responsible group.
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

// eduExpertAddClassroom add an expert to one or more rooms.
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

// eduExpertRemoveClassroom remove an expert from a room.
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

// eduExpertSetClassroom fully replace a room's expert list.
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

// eduExpertClearAllClassroom release all room-level assignments.
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

// eduExpertSetOffering assign a class to an expert (or release it with userId = null).
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

// eduExpertSetOfferingList fully replace a class's expert list (multi-expert).
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

// eduExpertAddOffering add an expert to a class without touching the others.
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

// eduExpertRemoveOffering remove an expert from a class (the rest remain).
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

// eduExpertBulkSetOffering bulk assignment — full replacement.
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

// eduExpertBulkAddOffering bulk assignment — additive.
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

// eduExpertClearTerm release all assignments of a term.
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
