// ═══ اندپوینت‌های پنل مدیر گروه (فاز ۵) ═══
package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/groupmanager"
	"backend-go/internal/session"
)

// GroupManagerAPI هندلرهای مدیر گروه.
type GroupManagerAPI struct {
	Svc   *groupmanager.Service
	Store *session.Store
}

func (a *GroupManagerAPI) Register(r gin.IRouter) {
	r.GET("/group-manager/courses", a.courses)
	r.POST("/group-manager/courses", a.saveCourse)
	r.POST("/group-manager/courses/delete", a.deleteCourse)
	r.GET("/group-manager/offerings", a.offerings)
	r.POST("/group-manager/offerings", a.saveOffering)
	r.POST("/group-manager/offerings/deactivate", a.deactivateOffering)
	r.POST("/group-manager/offerings/schedule", a.addSchedule)
	r.POST("/group-manager/offerings/schedule/delete", a.deleteSchedule)
	r.GET("/group-manager/classrooms", a.classrooms)
	r.POST("/group-manager/classrooms", a.saveClassroom)
	r.POST("/group-manager/classrooms/delete", a.deleteClassroom)
	r.GET("/group-manager/grants", a.grants)
	r.POST("/group-manager/grants", a.saveGrant)
	r.GET("/group-manager/compensatory", a.compensatory)
	r.POST("/group-manager/compensatory", a.saveCompensatory)
	r.POST("/group-manager/compensatory/bulk", a.bulkCompensatory)
	r.GET("/group-manager/bypass", a.bypass)
	r.POST("/group-manager/bypass/decide", a.decideBypass)
	r.GET("/group-manager/equivalence", a.equivalence)
	r.POST("/group-manager/equivalence", a.submitEquivalence)
	r.GET("/group-manager/me", a.me)
}

func (a *GroupManagerAPI) currentUser(c *gin.Context) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		return nil
	}
	u, _ := a.Store.Get(c.Request.Context(), token, false)
	return u
}

func (a *GroupManagerAPI) requireHead(c *gin.Context) (*session.User, *groupmanager.Ctx) {
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil, nil
	}
	allowed := false
	for _, r := range user.Roles {
		if r == "DEP_HEAD" || r == "ADMIN" {
			allowed = true
		}
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی به پنل مدیر گروه مجاز نیست."})
		return nil, nil
	}
	var wanted *int64
	if cookie, err := c.Cookie("gm_dept"); err == nil {
		if n, err := strconv.ParseInt(strings.TrimSpace(cookie), 10, 64); err == nil && n > 0 {
			wanted = &n
		}
	}
	ctx, err := a.Svc.Resolve(c.Request.Context(), user.ID, wanted)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "ساخته نشده") {
			c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": msg, "reason": "no-staff"})
			return nil, nil
		}
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": msg, "reason": "no-dept"})
		return nil, nil
	}
	return user, ctx
}

func (a *GroupManagerAPI) fail(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
}

func (a *GroupManagerAPI) me(c *gin.Context) {
	if _, ctx := a.requireHead(c); ctx == nil {
		return
	} else {
		c.JSON(http.StatusOK, gin.H{"ok": true, "dept": ctx.Dept, "depts": ctx.Depts, "staff": gin.H{"id": ctx.Staff.ID, "name": ctx.Staff.Name}})
	}
}

func (a *GroupManagerAPI) courses(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	resp, err := a.Svc.ListCourses(c.Request.Context(), ctx)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *GroupManagerAPI) saveCourse(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var body groupmanager.SaveCourse
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	var err error
	if body.ID != nil {
		err = a.Svc.UpdateCourse(c.Request.Context(), ctx, body)
	} else {
		err = a.Svc.CreateCourse(c.Request.Context(), ctx, body)
	}
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *GroupManagerAPI) deleteCourse(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteCourse(c.Request.Context(), ctx, body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *GroupManagerAPI) offerings(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	resp, err := a.Svc.ListOfferings(c.Request.Context(), ctx)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *GroupManagerAPI) saveOffering(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var body groupmanager.SaveOffering
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	var err error
	if body.ID != nil {
		err = a.Svc.UpdateOffering(c.Request.Context(), ctx, body)
	} else {
		err = a.Svc.CreateOffering(c.Request.Context(), ctx, body)
	}
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *GroupManagerAPI) deactivateOffering(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	msg, err := a.Svc.DeactivateOffering(c.Request.Context(), ctx, body.ID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": msg})
}

func (a *GroupManagerAPI) addSchedule(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var body groupmanager.ScheduleInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	msg, err := a.Svc.AddSchedule(c.Request.Context(), ctx, body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": msg})
}

func (a *GroupManagerAPI) deleteSchedule(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteSchedule(c.Request.Context(), ctx, body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *GroupManagerAPI) classrooms(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	resp, err := a.Svc.ListClassrooms(c.Request.Context(), ctx)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *GroupManagerAPI) saveClassroom(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var body groupmanager.SaveClassroom
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveClassroomAction(c.Request.Context(), ctx, body); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *GroupManagerAPI) deleteClassroom(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteClassroom(c.Request.Context(), ctx, body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *GroupManagerAPI) grants(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var majorID *int64
	var year *int
	var studentID *int64
	if v := strings.TrimSpace(c.Query("major")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			majorID = &n
		}
	}
	if v := strings.TrimSpace(c.Query("year")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			year = &n
		}
	}
	if v := strings.TrimSpace(c.Query("student")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			studentID = &n
		}
	}
	resp, err := a.Svc.GetGrants(c.Request.Context(), ctx, majorID, year, studentID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *GroupManagerAPI) saveGrant(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var body struct {
		StudentID int64  `json:"studentId"`
		CourseID  int64  `json:"courseId"`
		Reason    string `json:"reason"`
		Revoke    bool   `json:"revoke"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.StudentID <= 0 || body.CourseID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveGrant(c.Request.Context(), ctx, body.StudentID, body.CourseID, body.Reason, body.Revoke); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *GroupManagerAPI) compensatory(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var year *int
	if v := strings.TrimSpace(c.Query("year")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			year = &n
		}
	}
	resp, err := a.Svc.GetCompensatory(c.Request.Context(), ctx, year)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *GroupManagerAPI) saveCompensatory(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var body groupmanager.SaveCompensatory
	if err := c.ShouldBindJSON(&body); err != nil || body.StudentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveCompensatoryAction(c.Request.Context(), ctx, body); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *GroupManagerAPI) bulkCompensatory(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var body struct {
		Year  int `json:"year"`
		Units int `json:"units"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Year <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.BulkCompensatory(c.Request.Context(), ctx, body.Year, body.Units); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *GroupManagerAPI) bypass(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	resp, err := a.Svc.GetBypass(c.Request.Context(), ctx)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "requests": resp})
}

func (a *GroupManagerAPI) decideBypass(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var body struct {
		RequestID  int64  `json:"requestId"`
		Approve    bool   `json:"approve"`
		ReasonCode string `json:"reasonCode"`
		ReasonText string `json:"reasonText"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.RequestID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.DecideBypass(c.Request.Context(), ctx, body.RequestID, body.Approve, body.ReasonCode, body.ReasonText); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *GroupManagerAPI) equivalence(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	resp, err := a.Svc.GetEquivalence(c.Request.Context(), ctx)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *GroupManagerAPI) submitEquivalence(c *gin.Context) {
	_, ctx := a.requireHead(c)
	if ctx == nil {
		return
	}
	var body struct {
		RequestID int64                    `json:"requestId"`
		Items     []groupmanager.EquivItem `json:"items"`
		Note      string                   `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.RequestID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SubmitEquivalence(c.Request.Context(), ctx, body.RequestID, body.Items, body.Note); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
