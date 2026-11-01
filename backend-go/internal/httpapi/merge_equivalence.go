// ═══ Course merge and equivalent cluster endpoints ═══
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

var mergeRoles = []string{"ADMIN", "EDU_EXPERT", "VICE_EDU"}

func (a *AdminAPI) offeringMergeGroups(c *gin.Context) {
	user := a.requireRoles(c, mergeRoles)
	if user == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	if termID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_term"})
		return
	}
	groups, err := a.Svc.CourseMergeGroups(c.Request.Context(), user, a.uniCookie(c), termID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"groups": groups}})
}

func (a *AdminAPI) offeringMergeUpdate(c *gin.Context) {
	user := a.requireRoles(c, mergeRoles)
	if user == nil {
		return
	}
	var in struct {
		OfferingIDs []int64 `json:"offeringIds"`
		Mode        string  `json:"mode"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_body"})
		return
	}
	if err := a.Svc.UpdateCourseMerge(c.Request.Context(), user, a.uniCookie(c), in.OfferingIDs, in.Mode); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"mode": in.Mode, "count": len(in.OfferingIDs)}})
}

func (a *AdminAPI) equivalenceClusters(c *gin.Context) {
	user := a.requireRoles(c, mergeRoles)
	if user == nil {
		return
	}
	data, err := a.Svc.EquivalenceClusters(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": data})
}

func (a *AdminAPI) equivalenceClusterCreate(c *gin.Context) {
	user := a.requireRoles(c, mergeRoles)
	if user == nil {
		return
	}
	var in struct {
		ClusterTitle     string `json:"clusterTitle"`
		IsGeneralService bool   `json:"isGeneralService"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_body"})
		return
	}
	id, err := a.Svc.CreateEquivCluster(c.Request.Context(), user, a.uniCookie(c), in.ClusterTitle, in.IsGeneralService)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) equivalenceClusterUpdate(c *gin.Context) {
	user := a.requireRoles(c, mergeRoles)
	if user == nil {
		return
	}
	var in struct {
		ID               int64   `json:"id"`
		ClusterTitle     *string `json:"clusterTitle"`
		IsGeneralService *bool   `json:"isGeneralService"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_body"})
		return
	}
	if err := a.Svc.UpdateEquivCluster(c.Request.Context(), user, a.uniCookie(c), in.ID, in.ClusterTitle, in.IsGeneralService); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) equivalenceClusterDelete(c *gin.Context) {
	user := a.requireRoles(c, mergeRoles)
	if user == nil {
		return
	}
	var in struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_body"})
		return
	}
	if err := a.Svc.DeleteEquivCluster(c.Request.Context(), user, a.uniCookie(c), in.ID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) equivalenceClusterMembers(c *gin.Context) {
	user := a.requireRoles(c, mergeRoles)
	if user == nil {
		return
	}
	var in struct {
		ClusterID int64   `json:"clusterId"`
		CourseIDs []int64 `json:"courseIds"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ClusterID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_body"})
		return
	}
	if err := a.Svc.SetEquivClusterMembers(c.Request.Context(), user, a.uniCookie(c), in.ClusterID, in.CourseIDs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"count": len(in.CourseIDs)}})
}
