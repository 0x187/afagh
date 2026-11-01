// HTTP handlers for the admin classroom manager.
//
// These endpoints are restricted to ADMIN and EDU_EXPERT, matching the Next.js
// server actions. Infrastructure errors are logged and returned as a generic
// Persian message so database details never reach the browser.
package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"

	"backend-go/internal/admin"
	"backend-go/internal/logger"
	"backend-go/internal/session"
)

// requireClassroomEditor authenticates the session and allows only roles that
// may change room definitions.
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

// failClassroom masks database/driver errors while preserving validation
// messages written for end users.
func (a *AdminAPI) failClassroom(c *gin.Context, err error) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		logger.For("admin-classrooms").Error("classroom_operation_failed", logger.Fields{
			"error": err.Error(),
		})
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطا در انجام عملیات کلاس."})
		return
	}
	a.fail(c, err)
}

// adminClassrooms lists rooms for the active university.
func (a *AdminAPI) adminClassrooms(c *gin.Context) {
	user := a.requireClassroomEditor(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.ListAdminClassrooms(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.failClassroom(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

// adminSaveClassroom creates or updates one room.
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
		a.failClassroom(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

// adminDeleteClassroom deletes one room.
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
		a.failClassroom(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

// adminBulkClassrooms applies activate/deactivate/delete to selected rooms.
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
		a.failClassroom(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}
