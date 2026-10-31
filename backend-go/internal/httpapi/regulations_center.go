// ═══ مرکز مدیریت آیین‌نامه‌ها — هندلرهای HTTP (پورت admin/regulations در Next) ═══
//
// struct مستقل RegulationsAPI — رجیستری در main.go:
//
//	(&httpapi.RegulationsAPI{Svc: adminSvc, Store: store}).Register(ginEngine.Group(""))
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
	"backend-go/internal/scope"
	"backend-go/internal/session"
)

// regulationsRoles نقش‌های خواندن/نوشتن آیین‌نامه (requireRole(['ADMIN','EDU_EXPERT'])).
var regulationsRoles = []string{"ADMIN", "EDU_EXPERT"}

// RegulationsAPI هندلرهای مرکز مدیریت آیین‌نامه‌ها.
type RegulationsAPI struct {
	Svc   *admin.Service
	Store *session.Store
}

// Register مسیرهای مرکز آیین‌نامه‌ها — همه زیر /admin/regulations/*.
func (a *RegulationsAPI) Register(r gin.IRouter) {
	r.GET("/admin/regulations", a.regulationsList)
	r.GET("/admin/regulations/presets", a.regulationsPresets)
	r.POST("/admin/regulations/save", a.regulationsSave)
	r.POST("/admin/regulations/delete", a.regulationsDelete)
}

// requireRoles — الگوی student_cards.go.
func (a *RegulationsAPI) requireRoles(c *gin.Context, roles []string) *session.User {
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
		for _, want := range roles {
			if r == want {
				return user
			}
		}
	}
	c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی غیرمجاز"})
	return nil
}

func (a *RegulationsAPI) uniCookie(c *gin.Context) string {
	if v, err := c.Cookie(scope.UniversityCookie); err == nil {
		return v
	}
	return ""
}

// regulationsList فهرست آیین‌نامه‌ها + مقاطع + پریست‌ها.
func (a *RegulationsAPI) regulationsList(c *gin.Context) {
	user := a.requireRoles(c, regulationsRoles)
	if user == nil {
		return
	}
	res, err := a.Svc.ListEducationalRegulations(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

// regulationsPresets فقط پریست‌های آماده (الگوهای وزارتی).
func (a *RegulationsAPI) regulationsPresets(c *gin.Context) {
	user := a.requireRoles(c, regulationsRoles)
	if user == nil {
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"presets": admin.EducationalRegulationPresets()}})
}

// regulationsSave ساخت یا ویرایش آیین‌نامه (پورت saveRegulationAction).
func (a *RegulationsAPI) regulationsSave(c *gin.Context) {
	user := a.requireRoles(c, regulationsRoles)
	if user == nil {
		return
	}
	var in admin.RegulationSaveInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ورودی نامعتبر است."})
		return
	}
	if err := a.Svc.SaveEducationalRegulation(c.Request.Context(), user, a.uniCookie(c), in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "آیین‌نامه با موفقیت ذخیره گردید."})
}

// regulationsDelete حذف آیین‌نامه — فقط ADMIN (پورت deleteRegulationAction).
func (a *RegulationsAPI) regulationsDelete(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var in struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه آیین‌نامه نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteEducationalRegulation(c.Request.Context(), user, a.uniCookie(c), in.ID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "آیین‌نامه حذف شد."})
}
