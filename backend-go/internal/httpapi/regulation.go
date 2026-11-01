// ═══ Lesson plan monitoring and regulation review endpoints ═══
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

var regulationRoles = []string{"ADMIN"}

func (a *AdminAPI) lessonPlansAdmin(c *gin.Context) {
	user := a.requireRoles(c, regulationRoles)
	if user == nil {
		return
	}
	data, err := a.Svc.GetAdminLessonPlans(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": data})
}

func (a *AdminAPI) lessonPlansSettings(c *gin.Context) {
	user := a.requireRoles(c, regulationRoles)
	if user == nil {
		return
	}
	var in struct {
		IsRequired bool   `json:"isRequired"`
		Notice     string `json:"notice"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Svc.SetLessonPlanRequired(c.Request.Context(), user, a.uniCookie(c), in.IsRequired, in.Notice); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) regulationScan(c *gin.Context) {
	user := a.requireRoles(c, regulationRoles)
	if user == nil {
		return
	}
	res, err := a.Svc.ScanMismatchedSamaCodes(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) regulationApply(c *gin.Context) {
	user := a.requireRoles(c, regulationRoles)
	if user == nil {
		return
	}
	if !CheckStepUp(c.Request, a.Signer, user.ID, "grades:edit") {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false,
			"error": "STEPUP_REQUIRED:برای اعمال اصلاحات کد سما، ابتدا رمز عبور خود را تأیید کنید (تأیید دومرحله‌ای — ۱۰ دقیقه معتبر است)."})
		return
	}
	var in struct {
		EnrollmentIDs []int64 `json:"enrollmentIds"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	applied, err := a.Svc.ApplyCorrectedSamaCodes(c.Request.Context(), user, a.uniCookie(c), in.EnrollmentIDs)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"applied": applied}})
}

func (a *AdminAPI) regulationStatusScan(c *gin.Context) {
	user := a.requireRoles(c, regulationRoles)
	if user == nil {
		return
	}
	var in struct {
		Limit int `json:"limit"`
	}
	_ = c.ShouldBindJSON(&in)
	rows, err := a.Svc.ScanGraduatedWithoutGrades(c.Request.Context(), user, a.uniCookie(c), in.Limit)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows, "total": len(rows)}})
}
