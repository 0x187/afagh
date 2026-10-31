// ═══ اندپوینت‌های سوئیت برنامه‌ریزی درسی — پورت admin/scheduling ═══
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
	"backend-go/internal/session"
)

// SchedulingSuiteAPI هندلرهای سوئیت برنامه‌ریزی.
type SchedulingSuiteAPI struct {
	Admin *AdminAPI
}

func (a *SchedulingSuiteAPI) Register(r gin.IRouter) {
	r.GET("/admin/scheduling/dashboard", a.schedDashboard)
	r.GET("/admin/scheduling/workspace", a.schedWorkspace)
	r.GET("/admin/scheduling/demands", a.schedDemands)
	r.POST("/admin/scheduling/transition", a.schedTransition)
	r.POST("/admin/scheduling/supply-drafts", a.schedSupplyDrafts)
	r.POST("/admin/scheduling/allocate-sections", a.schedAllocateSections)
	r.POST("/admin/scheduling/allocate-room-quotas", a.schedAllocateRooms)
	r.POST("/admin/scheduling/smart-suggestions", a.schedSmartSuggestions)
	r.GET("/admin/scheduling/health", a.schedHealth)
	r.POST("/admin/scheduling/generate-sessions", a.schedGenerateSessions)
	r.POST("/admin/scheduling/check-conflicts", a.schedCheckConflicts)
	r.GET("/admin/scheduling/hard-conflicts", a.schedHardConflicts)
}

func (a *SchedulingSuiteAPI) require(c *gin.Context) *session.User {
	return a.Admin.requireRoles(c, schedSuiteRoles)
}

var schedSuiteRoles = []string{"ADMIN", "EDU_EXPERT", "VICE_EDU"}

func schedTermID(c *gin.Context) *int64 {
	v := c.Query("termId")
	if v == "" {
		return nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n <= 0 {
		return nil
	}
	return &n
}

func (a *SchedulingSuiteAPI) schedDashboard(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	res, err := a.Admin.Svc.GetSchedulingDashboard(c.Request.Context(), user, a.Admin.uniCookie(c), schedTermID(c))
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *SchedulingSuiteAPI) schedWorkspace(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	res, err := a.Admin.Svc.GetSchedulingWorkspace(c.Request.Context(), user, a.Admin.uniCookie(c), schedTermID(c))
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *SchedulingSuiteAPI) schedDemands(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	programID, _ := strconv.ParseInt(c.Query("programId"), 10, 64)
	rows, err := a.Admin.Svc.GetCurriculumDemands(c.Request.Context(), user, a.Admin.uniCookie(c), termID, programID)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"demands": rows}})
}

func (a *SchedulingSuiteAPI) schedTransition(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		TermID int64  `json:"termId"`
		To     string `json:"to"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.TermID <= 0 || in.To == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res, err := a.Admin.Svc.TransitionSchedulingPhase(c.Request.Context(), user, a.Admin.uniCookie(c), in.TermID, in.To)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *SchedulingSuiteAPI) schedSupplyDrafts(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var px admin.SchedSupplyInput
	if err := c.ShouldBindJSON(&px); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res, err := a.Admin.Svc.SupplyGroupDrafts(c.Request.Context(), user, a.Admin.uniCookie(c), px)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *SchedulingSuiteAPI) schedAllocateSections(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		TermID       int64   `json:"termId"`
		DepartmentID int64   `json:"departmentId"`
		OfferingIDs  []int64 `json:"offeringIds"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.TermID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	n, err := a.Admin.Svc.AllocateSections(c.Request.Context(), user, a.Admin.uniCookie(c), in.TermID, in.DepartmentID, in.OfferingIDs)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"allocated": n}})
}

func (a *SchedulingSuiteAPI) schedAllocateRooms(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		TermID int64 `json:"termId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.TermID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	n, err := a.Admin.Svc.AllocateRoomQuotas(c.Request.Context(), user, a.Admin.uniCookie(c), in.TermID)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"allocated": n}})
}

func (a *SchedulingSuiteAPI) schedSmartSuggestions(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var px admin.SchedSuggestInput
	if err := c.ShouldBindJSON(&px); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res, err := a.Admin.Svc.GetSmartSuggestions(c.Request.Context(), px)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"suggestions": res}})
}

func (a *SchedulingSuiteAPI) schedHealth(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	res, err := a.Admin.Svc.GetSchedulingHealth(c.Request.Context(), termID)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *SchedulingSuiteAPI) schedGenerateSessions(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var px admin.SchedGenerateInput
	if err := c.ShouldBindJSON(&px); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res, err := a.Admin.Svc.GenerateClassSessions(c.Request.Context(), user, a.Admin.uniCookie(c), px)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *SchedulingSuiteAPI) schedCheckConflicts(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		TermID int64 `json:"termId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.TermID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res, err := a.Admin.Svc.CheckScheduleConflicts(c.Request.Context(), user, a.Admin.uniCookie(c), in.TermID)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *SchedulingSuiteAPI) schedHardConflicts(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	res, n := a.Admin.Svc.InspectSchedulingHardConflicts(c.Request.Context(), termID)
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"report": res, "count": n}})
}
