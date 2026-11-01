// ═══ Graduation desk and document issuance endpoints ═══
package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/graduation"
	"backend-go/internal/session"
)

var graduationRoles = []string{"ADMIN", "GRADUATEAFFAIRS"}

func (a *AdminAPI) requireGraduationUser(c *gin.Context) *session.User {
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
		for _, want := range graduationRoles {
			if r == want {
				return user
			}
		}
	}
	c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی غیرمجاز"})
	return nil
}

func (a *AdminAPI) gradDossier(c *gin.Context, auditID int64) {
	d, err := a.Graduation.GetDossier(c.Request.Context(), auditID)
	if err != nil || d == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پرونده یافت نشد."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"dossier": d}})
}

// graduationSeed initial page data.
func (a *AdminAPI) graduationSeed(c *gin.Context) {
	user := a.requireGraduationUser(c)
	if user == nil {
		return
	}
	ctx := c.Request.Context()
	uniID := a.Svc.UniversityID(ctx, user, a.uniCookie(c))
	if err := a.Graduation.EnsureDepartments(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": err.Error()})
		return
	}
	rows, err := a.Graduation.ListDossiers(ctx, uniID, "", "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": err.Error()})
		return
	}
	stats, err := a.Graduation.PipelineStats(ctx, uniID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": err.Error()})
		return
	}
	deps, err := a.Graduation.Departments(ctx, uniID, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": err.Error()})
		return
	}
	alumni, err := a.Graduation.AllRequests(ctx, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"rows": rows, "stats": stats, "departments": deps,
		"alumniRequests": alumni, "services": a.Graduation.ServiceCatalog(ctx),
		"steps": graduation.WorkflowSteps,
	}})
}

func (a *AdminAPI) graduationScan(c *gin.Context) {
	user := a.requireGraduationUser(c)
	if user == nil {
		return
	}
	var in struct {
		Force         bool   `json:"force"`
		StudentIDsCSV string `json:"studentIdsCsv"`
	}
	_ = c.ShouldBindJSON(&in)
	ids := []int64{}
	for _, part := range strings.FieldsFunc(in.StudentIDsCSV, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\n' || r == '\t'
	}) {
		if v, err := strconv.ParseInt(part, 10, 64); err == nil && v > 0 {
			ids = append(ids, v)
		}
	}
	force := in.Force || len(ids) > 0
	res, err := a.Graduation.Scan(c.Request.Context(), ids, nil, force)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	rows, _ := a.Graduation.ListDossiers(c.Request.Context(), a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c)), "", "")
	stats, _ := a.Graduation.PipelineStats(c.Request.Context(), a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c)))
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"scan": res, "rows": rows, "stats": stats}})
}

func (a *AdminAPI) graduationList(c *gin.Context) {
	user := a.requireGraduationUser(c)
	if user == nil {
		return
	}
	var in struct {
		Status string `json:"status"`
		Q      string `json:"q"`
	}
	_ = c.ShouldBindJSON(&in)
	ctx := c.Request.Context()
	uniID := a.Svc.UniversityID(ctx, user, a.uniCookie(c))
	rows, err := a.Graduation.ListDossiers(ctx, uniID, in.Status, in.Q)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	stats, err := a.Graduation.PipelineStats(ctx, uniID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows, "stats": stats}})
}

func (a *AdminAPI) graduationDossier(c *gin.Context) {
	if a.requireGraduationUser(c) == nil {
		return
	}
	var in struct {
		ID int64 `json:"id"`
	}
	_ = c.ShouldBindJSON(&in)
	a.gradDossier(c, in.ID)
}

func (a *AdminAPI) graduationHeadApprove(c *gin.Context) {
	user := a.requireGraduationUser(c)
	if user == nil {
		return
	}
	var in struct {
		AuditID int64   `json:"auditId"`
		Note    *string `json:"note"`
	}
	_ = c.ShouldBindJSON(&in)
	if err := a.Graduation.ApproveByHead(c.Request.Context(), in.AuditID, user.ID, in.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	a.gradDossier(c, in.AuditID)
}

func (a *AdminAPI) graduationHold(c *gin.Context) {
	if a.requireGraduationUser(c) == nil {
		return
	}
	var in struct {
		AuditID int64  `json:"auditId"`
		Reason  string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&in)
	if err := a.Graduation.Hold(c.Request.Context(), in.AuditID, in.Reason); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	a.gradDossier(c, in.AuditID)
}

func (a *AdminAPI) graduationResume(c *gin.Context) {
	if a.requireGraduationUser(c) == nil {
		return
	}
	var in struct {
		AuditID int64 `json:"auditId"`
	}
	_ = c.ShouldBindJSON(&in)
	if err := a.Graduation.Resume(c.Request.Context(), in.AuditID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	a.gradDossier(c, in.AuditID)
}

func (a *AdminAPI) graduationIrandoc(c *gin.Context) {
	if a.requireGraduationUser(c) == nil {
		return
	}
	var in struct {
		AuditID      int64  `json:"auditId"`
		TrackingCode string `json:"trackingCode"`
		ThesisTitle  string `json:"thesisTitle"`
	}
	_ = c.ShouldBindJSON(&in)
	res, err := a.Graduation.RunIrandoc(c.Request.Context(), in.AuditID, in.TrackingCode, in.ThesisTitle)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	d, _ := a.Graduation.GetDossier(c.Request.Context(), in.AuditID)
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"result": res, "dossier": d}})
}

func (a *AdminAPI) graduationStartClearance(c *gin.Context) {
	if a.requireGraduationUser(c) == nil {
		return
	}
	var in struct {
		AuditID int64 `json:"auditId"`
	}
	_ = c.ShouldBindJSON(&in)
	if _, err := a.Graduation.StartClearance(c.Request.Context(), in.AuditID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	a.gradDossier(c, in.AuditID)
}

func (a *AdminAPI) graduationAutoClearance(c *gin.Context) {
	if a.requireGraduationUser(c) == nil {
		return
	}
	var in struct {
		AuditID int64 `json:"auditId"`
	}
	_ = c.ShouldBindJSON(&in)
	res, err := a.Graduation.RunAutoClearance(c.Request.Context(), in.AuditID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	d, _ := a.Graduation.GetDossier(c.Request.Context(), in.AuditID)
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"result": res, "dossier": d}})
}

func (a *AdminAPI) graduationSetClearance(c *gin.Context) {
	user := a.requireGraduationUser(c)
	if user == nil {
		return
	}
	var in struct {
		ChecklistID int64    `json:"checklistId"`
		AuditID     int64    `json:"auditId"`
		Status      string   `json:"status"`
		Detail      *string  `json:"detail"`
		AmountDue   *float64 `json:"amountDue"`
	}
	_ = c.ShouldBindJSON(&in)
	if err := a.Graduation.SetClearance(c.Request.Context(), in.ChecklistID, in.Status, in.Detail, in.AmountDue, user.ID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	a.gradDossier(c, in.AuditID)
}

func (a *AdminAPI) graduationAdvance(c *gin.Context) {
	if a.requireGraduationUser(c) == nil {
		return
	}
	var in struct {
		AuditID int64 `json:"auditId"`
	}
	_ = c.ShouldBindJSON(&in)
	res, err := a.Graduation.Advance(c.Request.Context(), in.AuditID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	d, _ := a.Graduation.GetDossier(c.Request.Context(), in.AuditID)
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"advance": res, "dossier": d}})
}

func (a *AdminAPI) graduationMinistryCode(c *gin.Context) {
	if a.requireGraduationUser(c) == nil {
		return
	}
	var in struct {
		AuditID int64 `json:"auditId"`
	}
	_ = c.ShouldBindJSON(&in)
	res, err := a.Graduation.RequestMinistryCode(c.Request.Context(), in.AuditID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	d, _ := a.Graduation.GetDossier(c.Request.Context(), in.AuditID)
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"code": res.Code, "online": res.Online, "dossier": d}})
}

func (a *AdminAPI) graduationWaiveSajjad(c *gin.Context) {
	if a.requireGraduationUser(c) == nil {
		return
	}
	var in struct {
		AuditID int64   `json:"auditId"`
		Note    *string `json:"note"`
	}
	_ = c.ShouldBindJSON(&in)
	if err := a.Graduation.WaiveSajjad(c.Request.Context(), in.AuditID, in.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	a.gradDossier(c, in.AuditID)
}

func (a *AdminAPI) graduationIssue(c *gin.Context) {
	user := a.requireGraduationUser(c)
	if user == nil {
		return
	}
	var in struct {
		AuditID                  int64   `json:"auditId"`
		DegreeType               string  `json:"degreeType"`
		MinistryVerificationCode *string `json:"ministryVerificationCode"`
	}
	_ = c.ShouldBindJSON(&in)
	res, err := a.Graduation.IssueDegree(c.Request.Context(), in.AuditID, in.DegreeType, user.ID, in.MinistryVerificationCode)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	d, _ := a.Graduation.GetDossier(c.Request.Context(), in.AuditID)
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"serialNo": res.SerialNo, "verifyCode": res.VerifyCode, "dossier": d,
	}})
}

func (a *AdminAPI) graduationDeliver(c *gin.Context) {
	if a.requireGraduationUser(c) == nil {
		return
	}
	var in struct {
		DegreeID    int64  `json:"degreeId"`
		AuditID     int64  `json:"auditId"`
		DeliveredTo string `json:"deliveredTo"`
	}
	_ = c.ShouldBindJSON(&in)
	if err := a.Graduation.MarkDelivered(c.Request.Context(), in.DegreeID, in.DeliveredTo); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	a.gradDossier(c, in.AuditID)
}

func (a *AdminAPI) graduationDepartmentSave(c *gin.Context) {
	user := a.requireGraduationUser(c)
	if user == nil {
		return
	}
	var in graduation.DeptInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات فرم نامعتبر است."})
		return
	}
	deps, err := a.Graduation.SaveDepartment(c.Request.Context(), a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c)), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"departments": deps}})
}

func (a *AdminAPI) graduationDepartmentDelete(c *gin.Context) {
	user := a.requireGraduationUser(c)
	if user == nil {
		return
	}
	var in struct {
		ID int64 `json:"id"`
	}
	_ = c.ShouldBindJSON(&in)
	if err := a.Graduation.DeleteDepartment(c.Request.Context(), a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c)), in.ID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) graduationAlumniRequests(c *gin.Context) {
	if a.requireGraduationUser(c) == nil {
		return
	}
	var in struct {
		Status string `json:"status"`
	}
	_ = c.ShouldBindJSON(&in)
	rows, err := a.Graduation.AllRequests(c.Request.Context(), in.Status)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows}})
}

func (a *AdminAPI) graduationAlumniResolve(c *gin.Context) {
	user := a.requireGraduationUser(c)
	if user == nil {
		return
	}
	var in graduation.ResolveAlumniInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات فرم نامعتبر است."})
		return
	}
	in.UserID = user.ID
	if err := a.Graduation.ResolveRequest(c.Request.Context(), in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	rows, _ := a.Graduation.AllRequests(c.Request.Context(), "")
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows}})
}
