// ═══ Free-course management endpoints ═══
package httpapi

import (
	"net/http"
	"strconv"

	"backend-go/internal/admin"

	"github.com/gin-gonic/gin"
)

var shortCourseRoles = []string{"ADMIN", "EDU_EXPERT"}

func (a *AdminAPI) shortCourses(c *gin.Context) {
	user := a.requireRoles(c, shortCourseRoles)
	if user == nil {
		return
	}
	data, err := a.Svc.ShortCourses(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": data})
}

func (a *AdminAPI) shortCourseCreate(c *gin.Context) {
	user := a.requireRoles(c, shortCourseRoles)
	if user == nil {
		return
	}
	var in struct {
		Code           string `json:"code"`
		Title          string `json:"title"`
		TitleEn        string `json:"titleEn"`
		Category       string `json:"category"`
		Hours          int    `json:"hours"`
		TuitionPrice   int    `json:"tuitionPrice"`
		Capacity       int    `json:"capacity"`
		InstructorName string `json:"instructorName"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	id, code, err := a.Svc.CreateShortCourse(c.Request.Context(), user, a.uniCookie(c), admin.ShortCourseCreateInput{
		Code: in.Code, Title: in.Title, TitleEn: in.TitleEn, Category: in.Category,
		InstructorName: in.InstructorName, Hours: in.Hours, TuitionPrice: in.TuitionPrice, Capacity: in.Capacity,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id, "code": code}})
}

func (a *AdminAPI) shortCourseAddLearner(c *gin.Context) {
	user := a.requireRoles(c, shortCourseRoles)
	if user == nil {
		return
	}
	var in struct {
		CourseID   int64  `json:"courseId"`
		FullName   string `json:"fullName"`
		FullNameEn string `json:"fullNameEn"`
		NationalID string `json:"nationalId"`
		Mobile     string `json:"mobile"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	learnerID, regID, tracking, err := a.Svc.AddShortTermLearner(c.Request.Context(), user, a.uniCookie(c), admin.ShortCourseLearnerInput{
		CourseID: in.CourseID, FullName: in.FullName, FullNameEn: in.FullNameEn,
		NationalID: in.NationalID, Mobile: in.Mobile,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"learnerId": learnerID, "registrationId": regID, "trackingCode": tracking,
	}})
}

func (a *AdminAPI) shortCourseUpdateRegistration(c *gin.Context) {
	user := a.requireRoles(c, shortCourseRoles)
	if user == nil {
		return
	}
	var in struct {
		RegistrationID int64    `json:"registrationId"`
		Attendance     *int     `json:"attendanceCount"`
		FinalGrade     *float64 `json:"finalGrade"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.RegistrationID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	passed, grade, att, err := a.Svc.UpdateShortTermRegistration(c.Request.Context(), user, a.uniCookie(c), in.RegistrationID, in.Attendance, in.FinalGrade)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"registrationId": in.RegistrationID, "isPassed": passed, "finalGrade": grade, "attendanceCount": att,
	}})
}

func (a *AdminAPI) shortCourseIssueCertificate(c *gin.Context) {
	user := a.requireRoles(c, shortCourseRoles)
	if user == nil {
		return
	}
	var in struct {
		RegistrationID int64 `json:"registrationId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.RegistrationID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res, err := a.Svc.IssueShortTermCertificate(c.Request.Context(), user, a.uniCookie(c), in.RegistrationID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) shortCourseRevokeCertificate(c *gin.Context) {
	user := a.requireRoles(c, shortCourseRoles)
	if user == nil {
		return
	}
	var in struct {
		CertificateNumber string `json:"certificateNumber"`
		Reason            string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Svc.RevokeShortTermCertificate(c.Request.Context(), user, a.uniCookie(c), in.CertificateNumber, in.Reason); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"certificateNumber": in.CertificateNumber}})
}

func (a *AdminAPI) shortCourseStatus(c *gin.Context) {
	user := a.requireRoles(c, shortCourseRoles)
	if user == nil {
		return
	}
	var in struct {
		CourseID int64  `json:"courseId"`
		Status   string `json:"status"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.CourseID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Svc.UpdateShortCourseStatus(c.Request.Context(), user, a.uniCookie(c), in.CourseID, in.Status); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) shortCourseSync(c *gin.Context) {
	user := a.requireRoles(c, shortCourseRoles)
	if user == nil {
		return
	}
	if err := a.Svc.SyncShortCourseCounts(c.Request.Context(), user, a.uniCookie(c)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"synced": true}})
}

func (a *AdminAPI) shortCourseDiscounts(c *gin.Context) {
	user := a.requireRoles(c, shortCourseRoles)
	if user == nil {
		return
	}
	var courseID *int64
	if v := c.Query("courseId"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			courseID = &n
		}
	}
	rows, err := a.Svc.ListShortTermDiscounts(c.Request.Context(), user, a.uniCookie(c), courseID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows}})
}

func (a *AdminAPI) shortCourseDiscountCreate(c *gin.Context) {
	user := a.requireRoles(c, shortCourseRoles)
	if user == nil {
		return
	}
	var in struct {
		Code              string `json:"code"`
		CourseID          *int64 `json:"courseId"`
		DiscountPercent   int    `json:"discountPercent"`
		MaxDiscountAmount *int64 `json:"maxDiscountAmount"`
		MaxUsage          *int   `json:"maxUsage"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	id, code, err := a.Svc.CreateShortTermDiscount(c.Request.Context(), user, a.uniCookie(c), admin.ShortTermDiscountInput{
		Code: in.Code, CourseID: in.CourseID, DiscountPercent: in.DiscountPercent,
		MaxDiscountAmount: in.MaxDiscountAmount, MaxUsage: in.MaxUsage,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id, "code": code}})
}

func (a *AdminAPI) shortCourseDiscountToggle(c *gin.Context) {
	user := a.requireRoles(c, shortCourseRoles)
	if user == nil {
		return
	}
	var in struct {
		ID       int64 `json:"id"`
		IsActive bool  `json:"isActive"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Svc.ToggleShortTermDiscount(c.Request.Context(), user, a.uniCookie(c), in.ID, in.IsActive); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) shortCoursePayment(c *gin.Context) {
	user := a.requireRoles(c, shortCourseRoles)
	if user == nil {
		return
	}
	var in struct {
		RegistrationID int64   `json:"registrationId"`
		PaymentRefID   string  `json:"paymentRefId"`
		AmountPaid     float64 `json:"amountPaid"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Svc.ConfirmShortTermPayment(c.Request.Context(), user, a.uniCookie(c), in.RegistrationID, in.PaymentRefID, in.AmountPaid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
