// ═══ اندپوینت‌های پذیرش (سنجش، ورود دسته‌ای، ثبت دستی) ═══
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

var admissionsRoles = []string{"ADMIN", "EDU_EXPERT"}

func (a *AdminAPI) admissionsBundle(c *gin.Context) {
	user := a.requireRoles(c, admissionsRoles)
	if user == nil {
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if uniID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشگاه فعال نامشخص است."})
		return
	}
	data, err := a.Svc.AdmissionsList(c.Request.Context(), *uniID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": data})
}

func (a *AdminAPI) admissionsStage(c *gin.Context) {
	user := a.requireRoles(c, admissionsRoles)
	if user == nil {
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if uniID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشگاه فعال نامشخص است."})
		return
	}
	var in struct {
		RawText   string `json:"rawText"`
		EntryYear int    `json:"entryYear"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خطا در پردازش فایل سنجش."})
		return
	}
	items, err := a.Svc.ParseAndStageSanjesh(c.Request.Context(), *uniID, in.RawText, in.EntryYear)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"count": len(items), "items": items}})
}

func (a *AdminAPI) admissionsImport(c *gin.Context) {
	user := a.requireRoles(c, admissionsRoles)
	if user == nil {
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if uniID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشگاه فعال نامشخص است."})
		return
	}
	var in struct {
		IDs []int64 `json:"ids"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خطا در ثبت نهایی دانشجویان."})
		return
	}
	res, err := a.Svc.ImportStaged(c.Request.Context(), *uniID, in.IDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) admissionsMapping(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if uniID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشگاه فعال نامشخص است."})
		return
	}
	var in struct {
		SanjeshCode     string `json:"sanjeshCode"`
		InternalMajorID int64  `json:"internalMajorId"`
		Quota           string `json:"quota"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خطا در ذخیره نگاشت."})
		return
	}
	if err := a.Svc.SaveSanjeshMapping(c.Request.Context(), *uniID, in.SanjeshCode, in.InternalMajorID, in.Quota); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) admissionsFormula(c *gin.Context) {
	user := a.requireRoles(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if uniID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشگاه فعال نامشخص است."})
		return
	}
	var in struct {
		DegreeLevelID int64  `json:"degreeLevelId"`
		Formula       string `json:"formula"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خطا در ذخیره فرمول شماره دانشجویی."})
		return
	}
	if err := a.Svc.SaveStudentIDFormula(c.Request.Context(), *uniID, in.DegreeLevelID, in.Formula); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) admissionsManual(c *gin.Context) {
	user := a.requireRoles(c, admissionsRoles)
	if user == nil {
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if uniID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشگاه فعال نامشخص است."})
		return
	}
	var in admin.ManualStudentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خطا در ثبت‌نام دستی دانشجو."})
		return
	}
	res, err := a.Svc.RegisterManualStudent(c.Request.Context(), *uniID, in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"student": res}})
}

func (a *AdminAPI) admissionsIrandoc(c *gin.Context) {
	if a.requireRoles(c, admissionsRoles) == nil {
		return
	}
	var in struct {
		NationalCode        string  `json:"nationalCode"`
		TrackingCode        string  `json:"trackingCode"`
		ThesisTitle         string  `json:"thesisTitle"`
		MaxAllowedThreshold float64 `json:"maxAllowedThreshold"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خطا در استعلام ایرانداک."})
		return
	}
	res := a.Svc.TestIrandoc(c.Request.Context(), in.NationalCode, in.TrackingCode, in.ThesisTitle, in.MaxAllowedThreshold)
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"result": res}})
}
