// ═══ Curriculum (syllabus) endpoints ═══
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

var curriculumRoles = []string{"ADMIN", "EDU_EXPERT"}

func (a *AdminAPI) curriculumOverview(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	res, err := a.Svc.GetCurriculumOverview(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) curriculumDetail(c *gin.Context) {
	if a.requireRoles(c, curriculumRoles) == nil {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	res, err := a.Svc.GetCurriculumDetail(c.Request.Context(), id)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) curriculumValidate(c *gin.Context) {
	if a.requireRoles(c, curriculumRoles) == nil {
		return
	}
	var in struct {
		VersionID int64 `json:"versionId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.VersionID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ نسخه نامعتبر است."})
		return
	}
	checks, blocked, err := a.Svc.RunCurriculumChecks(c.Request.Context(), in.VersionID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"checks": checks, "blocked": blocked}})
}

func (a *AdminAPI) curriculumCreate(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	var in admin.CurriculumCreateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	id, msg, err := a.Svc.CreateCurriculumVersion(c.Request.Context(), user, a.uniCookie(c), in)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id, "message": msg}})
}

func (a *AdminAPI) curriculumUpdateMeta(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	var in admin.CurriculumMetaPatch
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := a.Svc.UpdateCurriculumMeta(c.Request.Context(), user, id, in); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": "مشخصات نسخه بهروزرسانی شد."}})
}

func (a *AdminAPI) curriculumRevision(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	newID, msg, err := a.Svc.CreateCurriculumRevision(c.Request.Context(), user, a.uniCookie(c), id)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": newID, "message": msg}})
}

func (a *AdminAPI) curriculumSubmit(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	var in struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&in)
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	checks, msg, err := a.Svc.SubmitCurriculum(c.Request.Context(), user, id, in.Note)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error(), "checks": checks})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg, "checks": checks}})
}

func (a *AdminAPI) curriculumTransition(action, from, to, approvalType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		user := a.requireRoles(c, curriculumRoles)
		if user == nil {
			return
		}
		var in struct {
			Note string `json:"note"`
		}
		_ = c.ShouldBindJSON(&in)
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		var msg string
		var err error
		if action == "publish" {
			var superseded []string
			superseded, msg, err = a.Svc.PublishCurriculum(c.Request.Context(), user, id, in.Note)
			if err == nil {
				c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg, "superseded": superseded}})
				return
			}
		} else {
			msg, err = a.Svc.TransitionCurriculum(c.Request.Context(), user, id, to, approvalType, action, in.Note)
			if err == nil {
				c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
				return
			}
		}
		a.fail(c, err)
	}
}

func (a *AdminAPI) curriculumAddCourse(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	var in admin.CurriculumAddCourse
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	msg, err := a.Svc.AddCurriculumCourse(c.Request.Context(), user, id, in)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
}

func (a *AdminAPI) curriculumBulkAdd(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	var in struct {
		Items []admin.CurriculumAddCourse `json:"items"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	added, skipped, msg, err := a.Svc.BulkAddCurriculumCourses(c.Request.Context(), user, id, in.Items)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg, "added": added, "skipped": skipped}})
}

func (a *AdminAPI) curriculumRemoveCourse(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	var in struct {
		CourseID int64 `json:"courseId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.CourseID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ درس نامعتبر است."})
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	msg, err := a.Svc.RemoveCurriculumCourse(c.Request.Context(), user, id, in.CourseID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
}

func (a *AdminAPI) curriculumUpdateCourse(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	var in struct {
		CourseID int64                       `json:"courseId"`
		Patch    admin.CurriculumCoursePatch `json:"patch"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.CourseID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := a.Svc.UpdateCurriculumCourse(c.Request.Context(), user, id, in.CourseID, in.Patch); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": "مشخصات درس بهروزرسانی شد."}})
}

func (a *AdminAPI) curriculumAssignSemester(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	var in struct {
		CourseID    int64 `json:"courseId"`
		SemesterNo  *int  `json:"semesterNo"`
		HasSemester bool  `json:"hasSemester"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.CourseID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	var semester *int
	if in.HasSemester {
		semester = in.SemesterNo
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	msg, err := a.Svc.AssignCurriculumSemester(c.Request.Context(), user, id, in.CourseID, semester)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
}

func (a *AdminAPI) curriculumSyncRoles(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	updated, msg, err := a.Svc.SyncCurriculumRoles(c.Request.Context(), user, id)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg, "updated": updated}})
}

func (a *AdminAPI) curriculumMarkGrad(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	updated, total, msg, err := a.Svc.MarkGradRequiredBulk(c.Request.Context(), user, id)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg, "updated": updated, "total": total}})
}

func (a *AdminAPI) curriculumSetRule(ruleType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		user := a.requireRoles(c, curriculumRoles)
		if user == nil {
			return
		}
		var in struct {
			CourseID int64          `json:"courseId"`
			Tree     map[string]any `json:"tree"`
			HasTree  bool           `json:"hasTree"`
		}
		if err := c.ShouldBindJSON(&in); err != nil || in.CourseID <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
			return
		}
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		var tree map[string]any
		if in.HasTree {
			tree = in.Tree
		}
		var msg string
		var err error
		if ruleType == "PREREQ" {
			msg, err = a.Svc.SetCurriculumPrereq(c.Request.Context(), user, id, in.CourseID, tree)
		} else {
			msg, err = a.Svc.SetCurriculumCoreq(c.Request.Context(), user, id, in.CourseID, tree)
		}
		if err != nil {
			a.fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
	}
}

func (a *AdminAPI) curriculumPassingGrade(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	var in struct {
		CourseID int64    `json:"courseId"`
		MinGrade *float64 `json:"minGrade"`
		HasGrade bool     `json:"hasGrade"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.CourseID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	var grade *float64
	if in.HasGrade {
		grade = in.MinGrade
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	msg, err := a.Svc.SetCurriculumPassingGrade(c.Request.Context(), user, id, in.CourseID, grade)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
}

func (a *AdminAPI) curriculumCourseCodes(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	var in struct {
		CourseID int64   `json:"courseId"`
		PassCode *string `json:"passGradeStatusCode"`
		FailCode *string `json:"failGradeStatusCode"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.CourseID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := a.Svc.SetCurriculumCourseGradeCodes(c.Request.Context(), user, id, in.CourseID, in.PassCode, in.FailCode); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": "کد وضع نمرهٔ قبولی/مردودی این درس ثبت شد."}})
}

func (a *AdminAPI) curriculumBankNew(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	var in admin.CurriculumBankInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	id, msg, err := a.Svc.CreateCurriculumBankCourse(c.Request.Context(), user, in)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id, "message": msg}})
}

func (a *AdminAPI) curriculumBankEdit(c *gin.Context) {
	user := a.requireRoles(c, curriculumRoles)
	if user == nil {
		return
	}
	var in admin.CurriculumBankInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	msg, err := a.Svc.UpdateCurriculumBankCourse(c.Request.Context(), user, id, in)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
}
