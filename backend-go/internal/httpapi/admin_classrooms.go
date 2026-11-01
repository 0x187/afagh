// ═══ اندپوینت‌های مدیریت کلاس‌ها در تنظیمات ادمین ═══
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
	"backend-go/internal/session"
)

func (a *AdminAPI) requireClassroomEditor(c *gin.Context) *session.User {
	user := a.requireAdmin(c)
	if user == nil {
		return nil
	}
	for _, r := range user.Roles {
		if r == "ADMIN" || r == "EDU_EXPERT" {
			return user
		}
	}
	c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "مدیریت کلاس‌ها فقط برای مدیر سامانه و کارشناس آموزش مجاز است."})
	return nil
}

func (a *AdminAPI) adminClassrooms(c *gin.Context) {
	user := a.requireClassroomEditor(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.ListAdminClassrooms(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) adminSaveClassroom(c *gin.Context) {
	user := a.requireClassroomEditor(c)
	if user == nil {
		return
	}
	var in admin.AdminClassroomInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res, err := a.Svc.SaveAdminClassroom(c.Request.Context(), user, a.uniCookie(c), in)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) adminDeleteClassroom(c *gin.Context) {
	user := a.requireClassroomEditor(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "کلاس نامعتبر است."})
		return
	}
	res, err := a.Svc.DeleteAdminClassroom(c.Request.Context(), user, a.uniCookie(c), body.ID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) adminBulkClassrooms(c *gin.Context) {
	user := a.requireClassroomEditor(c)
	if user == nil {
		return
	}
	var body struct {
		Op  string  `json:"op"`
		IDs []int64 `json:"ids"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res, err := a.Svc.BulkAdminClassrooms(c.Request.Context(), user, a.uniCookie(c), body.Op, body.IDs)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}
