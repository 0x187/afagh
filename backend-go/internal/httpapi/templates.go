// ═══ Notification template endpoints ═══
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

var templateRoles = []string{"ADMIN", "EDU_EXPERT"}

func (a *AdminAPI) templatesList(c *gin.Context) {
	if a.requireRoles(c, templateRoles) == nil {
		return
	}
	rows, err := a.Svc.ListNotificationTemplates(c.Request.Context())
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"templates": rows}})
}

func (a *AdminAPI) templatesSave(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var in admin.SavedTemplateRow
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Svc.SaveNotificationTemplate(c.Request.Context(), in); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) templatesTest(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var in struct {
		Channel    string `json:"channel"`
		Identifier string `json:"identifier"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if a.Messaging == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "سرویس پیام‌رسان در دسترس نیست."})
		return
	}
	msg, err := a.Svc.SendTemplateTestMessage(c.Request.Context(), a.Pool, user, a.Messaging, in.Channel, in.Identifier)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
}
