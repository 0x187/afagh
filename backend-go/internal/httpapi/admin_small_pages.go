// ═══ Small admin pages HTTP layer — self-contained registration ═══
//
// Routes (all under the /api/v2 group that calls RegisterSmallPages):
//   GET  /admin/terms                       — list every term of every university
//   POST /admin/terms/activate              — {termId}
//   POST /admin/terms/activate-bulk         — {picks: [{universityId, termId}]}
//   POST /admin/terms/sync-with-date        — activate the term containing today per university
//   GET  /admin/grades/audit                — pending unfinalize requests + change log (paged)
//   POST /admin/grades/audit/unfinalize-review — {requestId, decision, note, extendDeadlineTo} (step-up gated)
//   GET  /admin/finance/student-approval    — ?studentId= APPROVED FINANCE_STATEMENT badge
//   GET  /admin/compliance-policy           — policy catalog + resolved values + provenance
//   POST /admin/compliance-policy/save      — {key, value, reason, ...scope}
//   POST /admin/compliance-policy/reset     — {id}
//   POST /admin/compliance-policy/seed-1402 — idempotent 1402 MS/PhD regulation rows
//
// The saham settings page and the student-card print page reuse the existing
// endpoints (GET/POST /admin/saham/settings, GET /admin/student-cards/print).
package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

var (
	smallTermsRoles    = []string{"ADMIN"}
	smallAuditRoles    = []string{"ADMIN", "GRADUATEAFFAIRS", "EDU_EXPERT", "VICE_EDU"}
	smallComplianceRoles = []string{"ADMIN", "EDU_EXPERT"}
)

// RegisterSmallPages registers the small admin page endpoints. Call it next to
// the other Register* calls in internal/app/http.go.
func (a *AdminAPI) RegisterSmallPages(r gin.IRouter) {
	// /admin/terms
	r.GET("/admin/terms", a.smallTermsList)
	r.POST("/admin/terms/activate", a.smallTermActivate)
	r.POST("/admin/terms/activate-bulk", a.smallTermsActivateBulk)
	r.POST("/admin/terms/sync-with-date", a.smallTermsSyncWithDate)

	// /admin/grades/audit
	r.GET("/admin/grades/audit", a.smallGradesAudit)
	r.POST("/admin/grades/audit/unfinalize-review", a.smallGradesUnfinalizeReview)

	// finance statement approval badge (finance/student/[id] print header)
	r.GET("/admin/finance/student-approval", a.smallFinanceStatementApproval)

	// /admin/compliance-policy
	r.GET("/admin/compliance-policy", a.smallComplianceBundle)
	r.POST("/admin/compliance-policy/save", a.smallComplianceSave)
	r.POST("/admin/compliance-policy/reset", a.smallComplianceReset)
	r.POST("/admin/compliance-policy/seed-1402", a.smallComplianceSeed1402)
}

// ── /admin/terms ──

func (a *AdminAPI) smallTermsList(c *gin.Context) {
	user := a.requireRoles(c, smallTermsRoles)
	if user == nil {
		return
	}
	bundle, err := a.Svc.SmallTermsBundle(c.Request.Context())
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": bundle})
}

func (a *AdminAPI) smallTermActivate(c *gin.Context) {
	user := a.requireRoles(c, smallTermsRoles)
	if user == nil {
		return
	}
	var body struct {
		TermID int64 `json:"termId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res, err := a.Svc.SmallTermActivate(c.Request.Context(), body.TermID)
	if err != nil {
		a.fail(c, err)
		return
	}
	if !res.OK {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": res.Error, "activated": res.Activated, "cleared": res.Cleared, "missing": res.Missing})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) smallTermsActivateBulk(c *gin.Context) {
	user := a.requireRoles(c, smallTermsRoles)
	if user == nil {
		return
	}
	var body struct {
		Picks []struct {
			UniversityID int64 `json:"universityId"`
			TermID       int64 `json:"termId"`
		} `json:"picks"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	picks := make([][2]int64, 0, len(body.Picks))
	for _, p := range body.Picks {
		picks = append(picks, [2]int64{p.UniversityID, p.TermID})
	}
	res, err := a.Svc.SmallTermsBulkActivate(c.Request.Context(), picks)
	if err != nil {
		a.fail(c, err)
		return
	}
	if !res.OK {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": res.Error, "activated": res.Activated, "cleared": res.Cleared, "missing": res.Missing})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) smallTermsSyncWithDate(c *gin.Context) {
	user := a.requireRoles(c, smallTermsRoles)
	if user == nil {
		return
	}
	res, err := a.Svc.SmallTermsSyncWithDate(c.Request.Context())
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

// ── /admin/grades/audit ──

func (a *AdminAPI) smallGradesAudit(c *gin.Context) {
	user := a.requireRoles(c, smallAuditRoles)
	if user == nil {
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if uniID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشگاه فعال نامشخص است."})
		return
	}
	page := 1
	if v, err := strconv.Atoi(c.Query("page")); err == nil && v > 0 {
		page = v
	}
	bundle, err := a.Svc.SmallGradesAudit(c.Request.Context(), *uniID, page)
	if err != nil {
		a.fail(c, err)
		return
	}
	canFinalApprove := false
	for _, r := range user.Roles {
		if r == "VICE_EDU" {
			canFinalApprove = true
			break
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": bundle, "canFinalApprove": canFinalApprove})
}

func (a *AdminAPI) smallGradesUnfinalizeReview(c *gin.Context) {
	user := a.requireRoles(c, smallAuditRoles)
	if user == nil {
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if uniID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشگاه فعال نامشخص است."})
		return
	}
	var body struct {
		RequestID         int64  `json:"requestId"`
		Decision          string `json:"decision"`
		Note              string `json:"note"`
		ExtendDeadlineTo  string `json:"extendDeadlineTo"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.RequestID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	decision := strings.ToUpper(strings.TrimSpace(body.Decision))
	// 🔐 Two-step verification (same scope as adminSetGradeAction) — the service
	// requests it at the same point as the reference (after the stage gate).
	stepUpOK := CheckStepUp(c.Request, a.Signer, user.ID, "grades:edit")
	err := a.Svc.SmallGradesUnfinalizeReview(c.Request.Context(), user, *uniID, body.RequestID, decision, body.Note, body.ExtendDeadlineTo, stepUpOK, a.Messaging)
	if err != nil {
		switch err.Error() {
		case "UNFINALIZE_STALE":
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "این درخواست هم‌زمان توسط دیگری تعیین‌تکلیف شد؛ لطفاً فهرست را تازه کنید."})
			return
		case "STEPUP_REQUIRED":
			c.JSON(http.StatusBadRequest, gin.H{"ok": false,
				"error": "STEPUP_REQUIRED:برای بررسی درخواست بازگشایی، ابتدا رمز عبور خود را تأیید کنید (تأیید دومرحله‌ای — ۱۰ دقیقه معتبر است)."})
			return
		}
		a.fail(c, err)
		return
	}
	message := map[string]string{
		"APPROVED":  "نمرات به «موقت» بازگشایی شد.",
		"REVIEWED":  "مرحلهٔ اول ثبت شد؛ در انتظار معاون آموزشی.",
		"REJECTED":  "درخواست رد شد.",
	}[decision]
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": message})
}

// ── finance statement approval badge ──

func (a *AdminAPI) smallFinanceStatementApproval(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	studentID, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	if studentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ دانشجو نامعتبر است."})
		return
	}
	approval, err := a.Svc.SmallFinanceStatementApproval(c.Request.Context(), studentID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": approval})
}

// ── /admin/compliance-policy ──

func (a *AdminAPI) smallComplianceBundle(c *gin.Context) {
	user := a.requireRoles(c, smallComplianceRoles)
	if user == nil {
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	entryYear := 0
	if v, err := strconv.Atoi(strings.TrimSpace(c.Query("entryYear"))); err == nil {
		entryYear = v
	}
	level := strings.TrimSpace(c.Query("level"))
	family := strings.TrimSpace(c.Query("family"))
	var regulationID *int64
	if v, err := strconv.ParseInt(strings.TrimSpace(c.Query("regulationId")), 10, 64); err == nil && v > 0 {
		regulationID = &v
	}
	bundle, err := a.Svc.SmallComplianceBundle(c.Request.Context(), uniID, entryYear, level, family, regulationID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": bundle})
}

func (a *AdminAPI) smallComplianceSave(c *gin.Context) {
	user := a.requireRoles(c, smallComplianceRoles)
	if user == nil {
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	var body struct {
		Key           string `json:"key"`
		Value         any    `json:"value"`
		Reason        string `json:"reason"`
		DegreeLevelID *int64 `json:"degreeLevelId"`
		RegulationID  *int64 `json:"regulationId"`
		EntryYear     *int64 `json:"entryYear"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Key) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	var updatedBy *int64
	if user.ID > 0 {
		updatedBy = &user.ID
	}
	if err := a.Svc.SmallComplianceSaveOverride(c.Request.Context(), uniID, updatedBy, strings.TrimSpace(body.Key), body.Value, body.Reason, body.DegreeLevelID, body.RegulationID, body.EntryYear); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) smallComplianceReset(c *gin.Context) {
	user := a.requireRoles(c, smallComplianceRoles)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SmallComplianceDeleteOverride(c.Request.Context(), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) smallComplianceSeed1402(c *gin.Context) {
	user := a.requireRoles(c, smallComplianceRoles)
	if user == nil {
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	// The reference seeds on uni?.id ?? 1 — the fallback university.
	if uniID == nil {
		fallback := int64(1)
		uniID = &fallback
	}
	res := a.Svc.SmallComplianceSeed1402(c.Request.Context(), *uniID)
	if !res.OK {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": res.Error, "created": res.Created, "skipped": res.Skipped})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}
