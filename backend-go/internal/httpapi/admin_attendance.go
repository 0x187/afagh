// ═══ Admin panel endpoints (phase 6) ═══
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (a *AdminAPI) attendanceManual(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetManualAttendance(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) attendanceConfirm(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		SessionID int64 `json:"sessionId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.SessionID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.ConfirmProfessorAttendance(c.Request.Context(), user, body.SessionID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) attendanceStatus(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		SessionID int64  `json:"sessionId"`
		Status    string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.SessionID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.MarkClassHeld(c.Request.Context(), user, body.SessionID, body.Status); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) attendanceControl(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetControl(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) attendanceRecord(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		SessionID int64 `json:"sessionId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.SessionID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.RecordClassPresence(c.Request.Context(), user, body.SessionID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
