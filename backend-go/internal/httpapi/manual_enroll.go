// ═══ اندپوینت‌های ثبت‌نام دستی کارشناس ═══
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

var manualEnrollRoles = []string{"ADMIN", "EDU_EXPERT"}

func (a *AdminAPI) manualStudents(c *gin.Context) {
	user := a.requireRoles(c, manualEnrollRoles)
	if user == nil {
		return
	}
	items, err := a.Svc.SearchManualStudents(c.Request.Context(), user, a.uniCookie(c), c.Query("q"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"items": items}})
}

func (a *AdminAPI) manualOfferings(c *gin.Context) {
	user := a.requireRoles(c, manualEnrollRoles)
	if user == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	items, err := a.Svc.ListManualOfferings(c.Request.Context(), user, a.uniCookie(c), termID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"items": items}})
}

func (a *AdminAPI) manualCatalog(c *gin.Context) {
	user := a.requireRoles(c, manualEnrollRoles)
	if user == nil {
		return
	}
	studentID, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	if studentID <= 0 || termID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res, err := a.Svc.StudentCatalog(c.Request.Context(), user, a.uniCookie(c), studentID, termID, c.Query("q"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) manualWarnings(c *gin.Context) {
	user := a.requireRoles(c, manualEnrollRoles)
	if user == nil {
		return
	}
	studentID, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	items, err := a.Svc.ManualStudentWarnings(c.Request.Context(), user, a.uniCookie(c), studentID, termID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"items": items}})
}

func (a *AdminAPI) manualEnroll(c *gin.Context) {
	user := a.requireRoles(c, manualEnrollRoles)
	if user == nil {
		return
	}
	var in admin.ManualEnrollInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	id, err := a.Svc.ManualEnroll(c.Request.Context(), user, a.uniCookie(c), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"enrollmentId": id}})
}

func (a *AdminAPI) manualDrop(c *gin.Context) {
	user := a.requireRoles(c, manualEnrollRoles)
	if user == nil {
		return
	}
	var in struct {
		EnrollmentID int64  `json:"enrollmentId"`
		Reason       string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.EnrollmentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Svc.DropManualEnrollment(c.Request.Context(), user, a.uniCookie(c), in.EnrollmentID, in.Reason); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) manualHistory(c *gin.Context) {
	user := a.requireRoles(c, manualEnrollRoles)
	if user == nil {
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	items, err := a.Svc.ManualEnrollHistory(c.Request.Context(), user, a.uniCookie(c), limit)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"items": items}})
}

func (a *AdminAPI) manualBulkCount(c *gin.Context) {
	user := a.requireRoles(c, manualEnrollRoles)
	if user == nil {
		return
	}
	var in admin.BulkFilter
	_ = c.ShouldBindJSON(&in)
	count, err := a.Svc.CountBulkStudents(c.Request.Context(), user, a.uniCookie(c), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"count": count}})
}

func (a *AdminAPI) manualBulkEnroll(c *gin.Context) {
	user := a.requireRoles(c, manualEnrollRoles)
	if user == nil {
		return
	}
	var in struct {
		Filter      admin.BulkFilter `json:"filter"`
		OfferingIDs []int64          `json:"offeringIds"`
		Override    bool             `json:"override"`
		Reason      string           `json:"reason"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res, err := a.Svc.BulkEnroll(c.Request.Context(), user, a.uniCookie(c), in.Filter, in.OfferingIDs, in.Override, in.Reason)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) manualBulkDrop(c *gin.Context) {
	user := a.requireRoles(c, manualEnrollRoles)
	if user == nil {
		return
	}
	var in struct {
		Filter      admin.BulkFilter `json:"filter"`
		OfferingIDs []int64          `json:"offeringIds"`
		Reason      string           `json:"reason"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res, err := a.Svc.BulkDrop(c.Request.Context(), user, a.uniCookie(c), in.Filter, in.OfferingIDs, in.Reason)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) manualActivateTerm(c *gin.Context) {
	user := a.requireRoles(c, manualEnrollRoles)
	if user == nil {
		return
	}
	var in struct {
		Filter admin.BulkFilter `json:"filter"`
		Active bool             `json:"active"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	n, err := a.Svc.ActivateTermForFilter(c.Request.Context(), user, a.uniCookie(c), in.Filter, in.Active)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"updated": n}})
}
