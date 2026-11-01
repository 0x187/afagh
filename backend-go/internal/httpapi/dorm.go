// ═══ Dormitory residence card endpoints ═══
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

var dormRoles = []string{"ADMIN", "EDU_EXPERT", "VICE_EDU"}

func (a *AdminAPI) dormList(c *gin.Context) {
	user := a.requireRoles(c, dormRoles)
	if user == nil {
		return
	}
	studentID, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	rows, err := a.Svc.ListDormResidences(c.Request.Context(), user, a.uniCookie(c), c.Query("status"), studentID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows, "total": len(rows)}})
}

func (a *AdminAPI) dormCreate(c *gin.Context) {
	user := a.requireRoles(c, dormRoles)
	if user == nil {
		return
	}
	var in admin.DormInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_body"})
		return
	}
	id, err := a.Svc.CreateDormResidence(c.Request.Context(), user, a.uniCookie(c), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) dormUpdate(c *gin.Context) {
	user := a.requireRoles(c, dormRoles)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
		admin.DormInput
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_body"})
		return
	}
	if err := a.Svc.UpdateDormResidence(c.Request.Context(), user, a.uniCookie(c), body.ID, body.DormInput); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) dormDelete(c *gin.Context) {
	user := a.requireRoles(c, dormRoles)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ سکونت نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteDormResidence(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// adminStudentSearch searches students for admin selectors (at least 2 letters).
func (a *AdminAPI) adminStudentSearch(c *gin.Context) {
	user := a.requireRoles(c, dormRoles)
	if user == nil {
		return
	}
	hits, err := a.Svc.StudentSearchForAdmin(c.Request.Context(), user, a.uniCookie(c), c.Query("q"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"hits": hits}})
}
