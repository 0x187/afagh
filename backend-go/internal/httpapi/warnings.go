// ═══ اندپوینت‌های هشدارهای زمان‌بندی‌شده ═══
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
	"backend-go/internal/session"
)

var warningRoles = []string{"ADMIN", "EDU_EXPERT", "VICE_EDU"}

func (a *AdminAPI) requireWarningUser(c *gin.Context) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	user, _ := a.Store.Get(c.Request.Context(), token, false)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	for _, r := range user.Roles {
		for _, want := range warningRoles {
			if r == want {
				return user
			}
		}
	}
	c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی غیرمجاز"})
	return nil
}

func (a *AdminAPI) warningsList(c *gin.Context) {
	user := a.requireWarningUser(c)
	if user == nil {
		return
	}
	f := admin.WarningFilters{
		Q: c.Query("q"), Status: c.Query("status"), Type: c.Query("type"),
		DateFrom: c.Query("dateFrom"), DateTo: c.Query("dateTo"),
	}
	if v := c.Query("studentId"); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil || id <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه دانشجو نامعتبر است."})
			return
		}
		f.StudentID = id
	}
	if v := c.Query("page"); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil || p < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شماره صفحه نامعتبر است."})
			return
		}
		f.Page = p
	}
	res, err := a.Svc.ListWarnings(c.Request.Context(), user, a.uniCookie(c), f)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) warningsStudents(c *gin.Context) {
	user := a.requireWarningUser(c)
	if user == nil {
		return
	}
	hits, err := a.Svc.SearchWarningStudents(c.Request.Context(), user, a.uniCookie(c), c.Query("q"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"hits": hits}})
}

func (a *AdminAPI) warningsCreate(c *gin.Context) {
	user := a.requireWarningUser(c)
	if user == nil {
		return
	}
	var in admin.WarningCreateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات فرم نامعتبر است."})
		return
	}
	id, err := a.Svc.CreateWarning(c.Request.Context(), user, a.uniCookie(c), in)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "دانشجو در دانشگاه فعال یافت نشد." {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) warningsUpdate(c *gin.Context) {
	user := a.requireWarningUser(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
		admin.WarningPatchInput
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات فرم نامعتبر است."})
		return
	}
	if err := a.Svc.UpdateWarning(c.Request.Context(), user, a.uniCookie(c), body.ID, body.WarningPatchInput); err != nil {
		status := http.StatusBadRequest
		if err.Error() == "هشدار پیدا نشد." {
			status = http.StatusNotFound
		} else if err.Error() == "دانشجو در دانشگاه فعال یافت نشد." {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) warningsDelete(c *gin.Context) {
	user := a.requireWarningUser(c)
	if user == nil {
		return
	}
	isAdmin := false
	for _, r := range user.Roles {
		if r == "ADMIN" {
			isAdmin = true
		}
	}
	if !isAdmin {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "دسترسی غیرمجاز"})
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه هشدار نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteWarning(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		status := http.StatusBadRequest
		if err.Error() == "هشدار پیدا نشد." {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
