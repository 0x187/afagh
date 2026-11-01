// ═══ Enrollment confirmation and certificate issuance endpoints ═══
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

var enrollmentAdminRoles = []string{"ADMIN", "EDU_EXPERT", "VICE_EDU"}

func (a *AdminAPI) enrollmentApprovals(c *gin.Context) {
	user := a.requireRoles(c, enrollmentAdminRoles)
	if user == nil {
		return
	}
	action := c.Query("action")
	if action == "students" {
		hits, err := a.Svc.SearchApprovalStudents(c.Request.Context(), user, a.uniCookie(c), c.Query("q"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"hits": hits}})
		return
	}
	if action == "offerings" {
		hits, err := a.Svc.SearchApprovalOfferings(c.Request.Context(), user, a.uniCookie(c), c.Query("q"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"hits": hits}})
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	res, err := a.Svc.ListEnrollApprovals(c.Request.Context(), user, a.uniCookie(c), c.Query("q"), c.Query("status"), page)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) enrollmentApprovalCreate(c *gin.Context) {
	user := a.requireRoles(c, enrollmentAdminRoles)
	if user == nil {
		return
	}
	var in struct {
		StudentID  int64   `json:"studentId"`
		OfferingID int64   `json:"offeringId"`
		Note       *string `json:"note"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.StudentID <= 0 || in.OfferingID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_body"})
		return
	}
	id, err := a.Svc.CreateEnrollApproval(c.Request.Context(), user, a.uniCookie(c), in.StudentID, in.OfferingID, in.Note)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true, "data": gin.H{"id": id, "status": "PENDING"}})
}

func (a *AdminAPI) enrollmentApprovalUpdate(c *gin.Context) {
	user := a.requireRoles(c, enrollmentAdminRoles)
	if user == nil {
		return
	}
	var in struct {
		ID     int64   `json:"id"`
		Status *string `json:"status"`
		Note   *string `json:"note"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_id"})
		return
	}
	if err := a.Svc.UpdateEnrollApproval(c.Request.Context(), user, a.uniCookie(c), in.ID, in.Status, in.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) enrollmentApprovalDelete(c *gin.Context) {
	user := a.requireRoles(c, enrollmentAdminRoles)
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
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "forbidden"})
		return
	}
	var in struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_id"})
		return
	}
	if err := a.Svc.DeleteEnrollApproval(c.Request.Context(), user, a.uniCookie(c), in.ID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// enrollmentConfirmation issue the course enrollment certificate (education expert).
func (a *AdminAPI) enrollmentConfirmation(c *gin.Context) {
	user := a.requireRoles(c, enrollmentAdminRoles)
	if user == nil {
		return
	}
	ctx := c.Request.Context()
	uniID := a.Svc.UniversityID(ctx, user, a.uniCookie(c))
	if uniID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشگاه فعال نامشخص است."})
		return
	}
	if c.Query("action") == "terms" {
		terms, err := a.Svc.AdminTermsForUniversity(ctx, *uniID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"terms": terms}})
		return
	}
	studentID, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	if studentID <= 0 || termID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ دانشجو یا نیمسال نامعتبر است."})
		return
	}
	if err := a.Svc.CheckStudentInUniversity(ctx, user, a.uniCookie(c), studentID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": err.Error()})
		return
	}
	var studentUni, termUni *int64
	_ = a.Svc.DB.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, studentID).Scan(&studentUni)
	if err := a.Svc.DB.Pool.QueryRow(ctx, `select "universityId" from academic_terms where id = $1`, termID).Scan(&termUni); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "term_not_found"})
		return
	}
	if termUni != nil && studentUni != nil && *termUni != *studentUni {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "این نیمسال به دانشگاه دیگری تعلق دارد."})
		return
	}
	token, expiresAt, err := a.StudentFinance.IssueEnrollConfirmFor(ctx, studentID, termID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "issue_failed"})
		return
	}
	base := "http://localhost:8080"
	if a.Svc.Store != nil {
		if v, err := a.Svc.Store.Get(ctx, "PUBLIC_BASE_URL"); err == nil && v != "" {
			base = v
			for len(base) > 0 && base[len(base)-1] == '/' {
				base = base[:len(base)-1]
			}
		}
	}
	verifyURL := base + "/verify-enrollment/" + token
	a.Svc.AuditAction(ctx, user.ID, "ENROLL_CONFIRM_ISSUED", "student", studentID,
		`{"termId":`+strconv.FormatInt(termID, 10)+`,"expiresAt":"`+expiresAt+`"}`)
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"token": token, "verifyUrl": verifyURL, "expiresAt": expiresAt,
	}})
}
