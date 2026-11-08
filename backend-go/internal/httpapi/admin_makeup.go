// Makeup inbox HTTP handlers — thin layer over admin.MakeupInbox*.
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/session"

	"backend-go/internal/admin"
)

// makeupInbox — GET /admin/makeup-inbox
func (a *AdminAPI) makeupInbox(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	if !a.canDecideMakeup(user) {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی غیرمجاز"})
		return
	}
	rows, rooms, err := a.Svc.GetMakeupInbox(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows, "rooms": rooms}})
}

// makeupDecide — POST /admin/makeup/:id/approve  {roomId}
//
//	POST /admin/makeup/:id/reject   {reason}
func (a *AdminAPI) makeupDecide(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	if !a.canDecideMakeup(user) {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی غیرمجاز"})
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	approve := c.FullPath() == "/api/v2/admin/makeup/:id/approve"
	var body struct {
		RoomID int64  `json:"roomId"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil && !approve {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	var ok bool
	var msg string
	if approve {
		ok, msg, err = a.Svc.ApproveMakeupSession(c.Request.Context(), user, a.uniCookie(c), id, body.RoomID)
	} else {
		ok, msg, err = a.Svc.RejectMakeupSession(c.Request.Context(), user, a.uniCookie(c), id, body.Reason)
	}
	if err != nil {
		a.fail(c, err)
		return
	}
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": msg})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// canDecideMakeup — ADMIN / EDU_EXPERT / VICE_EDU decide the makeup inbox.
func (a *AdminAPI) canDecideMakeup(user *session.User) bool {
	return admin.CanDecideMakeup(user.Roles)
}
