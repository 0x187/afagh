// ═══ Evaluation business intelligence (BI) endpoints ═══
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"backend-go/internal/bi"
)

var biAdminRoles = []string{"ADMIN"}
var biPanelRoles = []string{"ADMIN", "EDU_EXPERT", "DEPT_HEAD"}

func (a *AdminAPI) biDashboard(c *gin.Context) {
	if a.requireRoles(c, biAdminRoles) == nil || a.BI == nil {
		return
	}
	ctx := c.Request.Context()
	cache, _ := a.BI.CacheStatus(ctx)
	if cache == nil {
		cache = []bi.CacheEntry{}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"overview":   a.BI.ManagementOverview(ctx),
		"facilities": a.BI.FacilitiesReport(ctx),
		"cache":      cache,
	}})
}

func (a *AdminAPI) biRefreshDashboards(c *gin.Context) {
	if a.requireRoles(c, biAdminRoles) == nil || a.BI == nil {
		return
	}
	ctx := c.Request.Context()
	ov := a.BI.ManagementOverviewForce(ctx)
	fac := a.BI.FacilitiesReportForce(ctx)
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"staff": len(ov.List), "rooms": len(fac.Rooms),
	}})
}

func (a *AdminAPI) biRefreshAll(c *gin.Context) {
	if a.requireRoles(c, biAdminRoles) == nil || a.BI == nil {
		return
	}
	var in struct {
		TermID *int64 `json:"termId"`
	}
	_ = c.ShouldBindJSON(&in)
	res, err := a.BI.RefreshAllCaches(c.Request.Context(), in.TermID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) biInvalidate(c *gin.Context) {
	if a.requireRoles(c, biAdminRoles) == nil || a.BI == nil {
		return
	}
	var in struct {
		Prefix string `json:"prefix"`
	}
	_ = c.ShouldBindJSON(&in)
	if err := a.BI.InvalidateBiCache(c.Request.Context(), in.Prefix); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) biStatus(c *gin.Context) {
	if a.requireRoles(c, biAdminRoles) == nil || a.BI == nil {
		return
	}
	rows, err := a.BI.CacheStatus(c.Request.Context())
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"cache": rows}})
}

func (a *AdminAPI) biProfessorPanel(c *gin.Context) {
	if a.requireRoles(c, biPanelRoles) == nil || a.BI == nil {
		return
	}
	var in struct {
		StaffID int64 `json:"staffId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.StaffID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ استاد نامعتبر است."})
		return
	}
	panel, err := a.BI.ProfessorPanel(c.Request.Context(), in.StaffID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": panel})
}
