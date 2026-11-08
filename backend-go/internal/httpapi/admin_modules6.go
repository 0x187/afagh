// ═══ HTTP handlers for the 6 admin modules (virtual-classes, grade-objections,
// expert-scopes, permissions, universities, sama-sync) ═══
//
// Self-contained registration: call `a.RegisterModule6(r)` next to the existing
// `a.Register(r)` — nothing in admin.go changes.
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

// RegisterModule6 registers the module-6 admin endpoints.
func (a *AdminAPI) RegisterModule6(r gin.IRouter) {
	// Virtual classes (BigBlueButton report + sync).
	r.GET("/admin/virtual-classes", a.virtualClassesAdmin)
	r.POST("/admin/virtual-classes/sync-status", a.virtualClassesSyncStatus)
	r.POST("/admin/virtual-classes/sync-recordings", a.virtualClassesSyncRecordings)

	// Grade objections review queue.
	r.GET("/admin/grade-objections", a.gradeObjections)
	r.POST("/admin/grade-objections/review", a.gradeObjectionsReview)

	// Expert scopes.
	r.GET("/admin/expert-scopes", a.expertScopes)
	r.POST("/admin/expert-scopes/save", a.expertScopesSave)

	// RBAC permissions matrix.
	r.GET("/admin/permissions", a.permissionsWorkspace)
	r.POST("/admin/permissions/save", a.permissionsSaveRole)
	r.POST("/admin/permissions/roles", a.permissionsCreateRole)
	r.POST("/admin/permissions/roles/delete", a.permissionsDeleteRole)

	// Universities management.
	r.GET("/admin/universities", a.universitiesAdmin)
	r.POST("/admin/universities", a.universitiesAdminUpsert)
	r.POST("/admin/universities/delete", a.universitiesAdminDelete)

	// Sama weekly sync (status + history + guarded trigger).
	r.GET("/admin/sama-sync", a.samaSync)
	r.POST("/admin/sama-sync/trigger", a.samaSyncTrigger)
}

// module6 role sets — passed to the shared requireRoles helper.
var (
	module6EduRoles   = []string{"ADMIN", "EDU_EXPERT", "VICE_EDU"}
	module6AdminRoles = []string{"ADMIN"}
)

// optionalID parses an optional positive integer from a JSON body field.
func optionalID(v int64) *int64 {
	if v > 0 {
		return &v
	}
	return nil
}

// ── Virtual classes ──

func (a *AdminAPI) virtualClassesAdmin(c *gin.Context) {
	user := a.requireRoles(c, module6EduRoles)
	if user == nil {
		return
	}
	var termID *int64
	if v, err := strconv.ParseInt(c.Query("termId"), 10, 64); err == nil && v > 0 {
		termID = &v
	}
	rows, err := a.Svc.ListVirtualClassroomsAdmin(c.Request.Context(), user, a.uniCookie(c), termID)
	if err != nil {
		a.fail(c, err)
		return
	}
	terms, _ := a.Svc.ListVirtualClassTerms(c.Request.Context(), user, a.uniCookie(c))
	c.JSON(http.StatusOK, gin.H{"ok": true, "rows": rows, "terms": terms})
}

func (a *AdminAPI) virtualClassesSyncStatus(c *gin.Context) {
	user := a.requireRoles(c, module6EduRoles)
	if user == nil {
		return
	}
	var body struct {
		ClassroomID int64 `json:"classroomId"`
	}
	_ = c.ShouldBindJSON(&body)
	updated, err := a.Svc.SyncVirtualClassStatus(c.Request.Context(), user, a.uniCookie(c), optionalID(body.ClassroomID))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "updated": updated})
}

func (a *AdminAPI) virtualClassesSyncRecordings(c *gin.Context) {
	user := a.requireRoles(c, module6EduRoles)
	if user == nil {
		return
	}
	var body struct {
		ClassroomID int64 `json:"classroomId"`
	}
	_ = c.ShouldBindJSON(&body)
	classrooms, added, err := a.Svc.SyncBbbRecordings(c.Request.Context(), user, a.uniCookie(c), optionalID(body.ClassroomID))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "classrooms": classrooms, "added": added})
}

// ── Grade objections ──

func (a *AdminAPI) gradeObjections(c *gin.Context) {
	user := a.requireRoles(c, module6EduRoles)
	if user == nil {
		return
	}
	pendingOnly := c.Query("status") != "OTHER"
	rows, err := a.Svc.ListGradeObjections(c.Request.Context(), user, a.uniCookie(c), pendingOnly)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "rows": rows})
}

func (a *AdminAPI) gradeObjectionsReview(c *gin.Context) {
	user := a.requireRoles(c, module6EduRoles)
	if user == nil {
		return
	}
	var body struct {
		ID       int64  `json:"id"`
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.ReviewGradeObjection(c.Request.Context(), user, a.uniCookie(c), body.ID, body.Decision, body.Note); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Expert scopes ──

func (a *AdminAPI) expertScopes(c *gin.Context) {
	user := a.requireRoles(c, module6AdminRoles)
	if user == nil {
		return
	}
	candidates, err := a.Svc.ListExpertScopeCandidates(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	sel, err := a.Svc.GetExpertScopeSelect(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "candidates": candidates, "select": sel})
}

func (a *AdminAPI) expertScopesSave(c *gin.Context) {
	user := a.requireRoles(c, module6AdminRoles)
	if user == nil {
		return
	}
	var body struct {
		UserID        int64                    `json:"userId"`
		Scopes        []admin.ExpertScopeEntry `json:"scopes"`
		CanEditGrades bool                     `json:"canEditGrades"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.UserID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveExpertScopes(c.Request.Context(), user, a.uniCookie(c), body.UserID, body.Scopes, body.CanEditGrades); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Permissions (RBAC) ──

func (a *AdminAPI) permissionsWorkspace(c *gin.Context) {
	user := a.requireRoles(c, module6AdminRoles)
	if user == nil {
		return
	}
	ws, err := a.Svc.GetPermissionsWorkspace(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": ws})
}

func (a *AdminAPI) permissionsSaveRole(c *gin.Context) {
	user := a.requireRoles(c, module6AdminRoles)
	if user == nil {
		return
	}
	var body struct {
		RoleID int64    `json:"roleId"`
		Codes  []string `json:"codes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	count, err := a.Svc.SaveRolePermissions(c.Request.Context(), user, a.uniCookie(c), body.RoleID, body.Codes)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "count": count})
}

func (a *AdminAPI) permissionsCreateRole(c *gin.Context) {
	user := a.requireRoles(c, module6AdminRoles)
	if user == nil {
		return
	}
	var body struct {
		Code  string `json:"code"`
		Title string `json:"title"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	id, err := a.Svc.CreateRole(c.Request.Context(), user, a.uniCookie(c), body.Code, body.Title)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id})
}

func (a *AdminAPI) permissionsDeleteRole(c *gin.Context) {
	user := a.requireRoles(c, module6AdminRoles)
	if user == nil {
		return
	}
	var body struct {
		RoleID int64 `json:"roleId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.RoleID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteRole(c.Request.Context(), user, a.uniCookie(c), body.RoleID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Universities ──

func (a *AdminAPI) universitiesAdmin(c *gin.Context) {
	user := a.requireRoles(c, module6AdminRoles)
	if user == nil {
		return
	}
	rows, err := a.Svc.ListUniversitiesAdmin(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "rows": rows})
}

func (a *AdminAPI) universitiesAdminUpsert(c *gin.Context) {
	user := a.requireRoles(c, module6AdminRoles)
	if user == nil {
		return
	}
	var body struct {
		ID        int64  `json:"id"`
		Code      string `json:"code"`
		Title     string `json:"title"`
		Kind      string `json:"kind"`
		SaminCode string `json:"saminCode"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.UpsertUniversityAdmin(c.Request.Context(), user, a.uniCookie(c), body.ID, body.Code, body.Title, body.Kind, body.SaminCode); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) universitiesAdminDelete(c *gin.Context) {
	user := a.requireRoles(c, module6AdminRoles)
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
	if err := a.Svc.DeleteUniversityAdmin(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Sama sync ──

func (a *AdminAPI) samaSync(c *gin.Context) {
	user := a.requireRoles(c, module6AdminRoles)
	if user == nil {
		return
	}
	st, err := a.Svc.SamaSyncStatus(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": st})
}

func (a *AdminAPI) samaSyncTrigger(c *gin.Context) {
	user := a.requireRoles(c, module6AdminRoles)
	if user == nil {
		return
	}
	if err := a.Svc.TriggerSamaSync(c.Request.Context(), user, a.uniCookie(c)); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
