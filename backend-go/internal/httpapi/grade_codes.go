// ═══ Courses, chart and grade status code endpoints ═══
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

var (
	gradeCodesViewRoles = []string{"ADMIN", "EDU_EXPERT", "VICE_EDU"}
	gradeCodesEditRoles = []string{"ADMIN", "EDU_EXPERT"}
)

func queryInt(c *gin.Context, key string) int64 {
	n, _ := strconv.ParseInt(c.Query(key), 10, 64)
	return n
}

func (a *AdminAPI) gradeStatusCodes(c *gin.Context) {
	if a.requireRoles(c, gradeCodesViewRoles) == nil {
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"codes": admin.GradeStatusCodes()}})
}

func (a *AdminAPI) curriculumMajors(c *gin.Context) {
	user := a.requireRoles(c, gradeCodesEditRoles)
	if user == nil {
		return
	}
	rows, err := a.Svc.GradeMajors(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"majors": rows}})
}

func (a *AdminAPI) curriculumDepartments(c *gin.Context) {
	user := a.requireRoles(c, gradeCodesViewRoles)
	if user == nil {
		return
	}
	rows, err := a.Svc.GradeDepartments(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"departments": rows}})
}

func (a *AdminAPI) curriculumClusters(c *gin.Context) {
	user := a.requireRoles(c, gradeCodesViewRoles)
	if user == nil {
		return
	}
	rows, err := a.Svc.GradeClusters(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"clusters": rows}})
}

func (a *AdminAPI) curriculumDegreeLevels(c *gin.Context) {
	if a.requireRoles(c, gradeCodesViewRoles) == nil {
		return
	}
	rows, err := a.Svc.GradeDegreeLevels(c.Request.Context())
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"degreeLevels": rows}})
}

func (a *AdminAPI) curriculumVersions(c *gin.Context) {
	user := a.requireRoles(c, gradeCodesEditRoles)
	if user == nil {
		return
	}
	rows, err := a.Svc.GradeVersions(c.Request.Context(), user, a.uniCookie(c), queryInt(c, "majorId"))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"versions": rows}})
}

func (a *AdminAPI) curriculumCourses(c *gin.Context) {
	user := a.requireRoles(c, gradeCodesEditRoles)
	if user == nil {
		return
	}
	rows, err := a.Svc.GradeCurriculumCourses(c.Request.Context(), user, a.uniCookie(c), queryInt(c, "versionId"))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"courses": rows}})
}

func (a *AdminAPI) curriculumOffered(c *gin.Context) {
	user := a.requireRoles(c, gradeCodesViewRoles)
	if user == nil {
		return
	}
	rows, err := a.Svc.GradeOffered(c.Request.Context(), user, a.uniCookie(c),
		c.Query("q"), queryInt(c, "majorId"), queryInt(c, "degreeLevelId"), queryInt(c, "versionId"))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"courses": rows}})
}

func (a *AdminAPI) curriculumBank(c *gin.Context) {
	user := a.requireRoles(c, gradeCodesViewRoles)
	if user == nil {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	res, err := a.Svc.BankCourses(c.Request.Context(), user, a.uniCookie(c), c.Query("q"), page, limit)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) curriculumBankUpdate(c *gin.Context) {
	user := a.requireRoles(c, gradeCodesViewRoles)
	if user == nil {
		return
	}
	id := queryInt(c, "id")
	var raw map[string]any
	if err := c.ShouldBindJSON(&raw); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.UpdateBankCourse(c.Request.Context(), user, a.uniCookie(c), id, raw); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) curriculumGradeCodes(c *gin.Context) {
	user := a.requireRoles(c, gradeCodesEditRoles)
	if user == nil {
		return
	}
	var in struct {
		PassGradeStatusCode *string `json:"passGradeStatusCode"`
		FailGradeStatusCode *string `json:"failGradeStatusCode"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	err := a.Svc.SetCurriculumGradeCodes(c.Request.Context(), user, a.uniCookie(c),
		queryInt(c, "versionId"), queryInt(c, "courseId"), in.PassGradeStatusCode, in.FailGradeStatusCode)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) gradeThresholdsGet(c *gin.Context) {
	user := a.requireRoles(c, gradeCodesEditRoles)
	if user == nil {
		return
	}
	rows, mode, err := a.Svc.GetGradeThresholds(c.Request.Context(), user, a.uniCookie(c), queryInt(c, "degreeLevelId"))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"thresholds": rows, "transcriptDisplayMode": mode,
	}})
}

func (a *AdminAPI) gradeThresholdsSave(c *gin.Context) {
	user := a.requireRoles(c, gradeCodesEditRoles)
	if user == nil {
		return
	}
	var in struct {
		DegreeLevelID         int64                  `json:"degreeLevelId"`
		TranscriptDisplayMode string                 `json:"transcriptDisplayMode"`
		Thresholds            []admin.ThresholdInput `json:"thresholds"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveGradeThresholds(c.Request.Context(), user, a.uniCookie(c),
		in.DegreeLevelID, in.TranscriptDisplayMode, in.Thresholds); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": "آستانه‌ها ذخیره شد."}})
}
