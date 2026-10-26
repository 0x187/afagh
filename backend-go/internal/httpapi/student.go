// ═══ اندپوینت‌های پرتال دانشجو (فاز ۳) ═══
package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/enroll"
	"backend-go/internal/session"
	"backend-go/internal/settings"
	"backend-go/internal/student"
)

// StudentAPI هندلرهای دادهٔ دانشجو.
type StudentAPI struct {
	Svc      *student.Service
	Enroll   *enroll.Service
	Store    *session.Store
	Settings *settings.Store
}

func (a *StudentAPI) Register(r gin.IRouter) {
	r.GET("/student/me", a.me)
	r.GET("/student/schedule", a.schedule)
	r.GET("/student/dashboard", a.dashboard)
	r.GET("/student/transcript", a.transcript)
	r.GET("/student/exam-card", a.examCard)
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
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	termID := termIDQueryOrCookie(c)

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

// requireStudent کاربر را از سشن می‌خواند و نقش دانشجو را بررسی می‌کند.
func (a *StudentAPI) requireStudent(c *gin.Context) *session.User {
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	if !hasRole(user, "STUDENT") {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی به پرتال دانشجو مجاز نیست."})
		return nil
	}
	return user
}

// termIDQueryOrCookie ترم انتخابی: ?termId= سپس کوکی انتخاب نیمسال.
func termIDQueryOrCookie(c *gin.Context) *int64 {
	raw := strings.TrimSpace(c.Query("termId"))
	if raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
			return &n
		}
		return nil
	}
	return termIDFromCookie(c)
}

func (a *StudentAPI) fail(c *gin.Context, err error) {
	fmt.Printf("[student-api] %s: %v\n", c.FullPath(), err)
	msg := err.Error()
	if strings.Contains(msg, "پروندهٔ دانشجویی یافت نشد") {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": msg})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
}

func (a *StudentAPI) publicBaseURL(c *gin.Context) string {
	if a.Settings != nil {
		if v, err := a.Settings.Get(c.Request.Context(), "PUBLIC_BASE_URL"); err == nil {
			if v = strings.TrimSpace(v); v != "" {
				return strings.TrimRight(v, "/")
			}
		}
	}
	proto := c.GetHeader("X-Forwarded-Proto")
	if proto == "" {
		if c.Request.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	host := c.GetHeader("X-Forwarded-Host")
	if host == "" {
		host = c.Request.Host
	}
	return proto + "://" + host
}

// dashboard دادهٔ صفحهٔ اول دانشجو.
func (a *StudentAPI) dashboard(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetDashboard(c.Request.Context(), user.ID, user.Name, termIDQueryOrCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

// transcript کارنامهٔ تحصیلی — ?record= برای مقطع دیگر، ?termId= برای فیلتر ترم.
func (a *StudentAPI) transcript(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	var recordID *int64
	if raw := strings.TrimSpace(c.Query("record")); raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
			recordID = &n
		}
	}
	resp, err := a.Svc.GetTranscript(c.Request.Context(), user.ID, user.Name, recordID, termIDQueryOrCookie(c), a.publicBaseURL(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

// examCard کارت آزمون + توکن ورود + QR.
func (a *StudentAPI) examCard(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetExamCard(c.Request.Context(), user.ID, termIDQueryOrCookie(c), a.publicBaseURL(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}
