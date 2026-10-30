// ═══ اندپوینت‌های انتقال بین گروه‌ها ═══
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

var groupTransferRoles = []string{"ADMIN", "EDU_EXPERT"}

func (a *AdminAPI) transferTargets(c *gin.Context) {
	user := a.requireRoles(c, groupTransferRoles)
	if user == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	courses, err := a.Svc.TransferTargets(c.Request.Context(), user, a.uniCookie(c), termID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"courses": courses}})
}

func (a *AdminAPI) transferRoster(c *gin.Context) {
	user := a.requireRoles(c, groupTransferRoles)
	if user == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	offeringID, _ := strconv.ParseInt(c.Query("offeringId"), 10, 64)
	res, err := a.Svc.TransferGroupRoster(c.Request.Context(), user, a.uniCookie(c), termID, offeringID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"offer": res.Offer, "roster": res.Roster}})
}

func (a *AdminAPI) transferTargetGroups(c *gin.Context) {
	user := a.requireRoles(c, groupTransferRoles)
	if user == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	offeringID, _ := strconv.ParseInt(c.Query("offeringId"), 10, 64)
	res, err := a.Svc.TransferTargetGroups(c.Request.Context(), user, a.uniCookie(c), termID, offeringID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) transferStudent(c *gin.Context) {
	user := a.requireRoles(c, groupTransferRoles)
	if user == nil {
		return
	}
	var in struct {
		EnrollmentID   int64  `json:"enrollmentId"`
		ToOfferingID   int64  `json:"toOfferingId"`
		OverrideReason string `json:"overrideReason"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.EnrollmentID <= 0 || in.ToOfferingID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res := a.Svc.TransferStudent(c.Request.Context(), user, a.uniCookie(c), in.EnrollmentID, in.ToOfferingID, in.OverrideReason)
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}
