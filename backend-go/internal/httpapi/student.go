// ═══ اندپوینت‌های پرتال دانشجو (فاز ۳) ═══
package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/session"
	"backend-go/internal/student"
)

// StudentAPI هندلرهای دادهٔ دانشجو.
type StudentAPI struct {
	Svc   *student.Service
	Store *session.Store
}

func (a *StudentAPI) Register(r gin.IRouter) {
	r.GET("/student/me", a.me)
	r.GET("/student/schedule", a.schedule)
}

func (a *StudentAPI) currentUser(c *gin.Context) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		return nil
	}
	u, _ := a.Store.Get(c.Request.Context(), token, false)
	return u
}

func hasRole(u *session.User, role string) bool {
	for _, r := range u.Roles {
		if r == role || r == "ADMIN" {
			return true
		}
	}
	return false
}

// me مشخصات پروندهٔ دانشجوی جاری.
func (a *StudentAPI) me(c *gin.Context) {
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	if !hasRole(user, "STUDENT") {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی به پرتال دانشجو مجاز نیست."})
		return
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
		return
	}
	if rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok": true,
		"student": gin.H{
			"id": rec.ID, "studentCode": rec.StudentCode, "status": rec.Status,
			"entryYear": rec.EntryYear, "majorId": rec.MajorID,
			"degreeLevelId": rec.DegreeLevelID, "universityId": rec.UniversityID,
		},
	})
}

// schedule برنامهٔ هفتگی — ?termId= برای انتخاب ترم (اختیاری؛ کوکی هم پشتیبانی می‌شود).
func (a *StudentAPI) schedule(c *gin.Context) {
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	if !hasRole(user, "STUDENT") {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی به پرتال دانشجو مجاز نیست."})
		return
	}
	var termID *int64
	raw := strings.TrimSpace(c.Query("termId"))
	if raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
			termID = &n
		}
	} else if v := termIDFromCookie(c); v != nil {
		termID = v
	}

	resp, err := a.Svc.GetSchedule(c.Request.Context(), user.ID, user.Name, termID)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "پروندهٔ دانشجویی یافت نشد") {
			c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": msg})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}
