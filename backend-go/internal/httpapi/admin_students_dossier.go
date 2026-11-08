// ═══ HTTP handlers for the comprehensive student dossier manager ═══
//
// Port of afagh-next/src/app/admin/students (page.tsx + actions.ts + the
// grade-edit actions it uses). Self-contained registration: call
// `a.RegisterStudentsDossier(r)` next to the existing `a.Register(r)` —
// nothing in admin.go changes.
//
// Session idioms match admin.go: requireRoles/requireAdmin + a.uniCookie(c),
// and the university scope is resolved fail-closed inside the service.
package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
	"backend-go/internal/qr"
)

// Role sets — the viewer roles of the students page + the admin-only sets.
var (
	// dossierViewerRoles is the requireRoleOrPermission set of page.tsx
	// (roles OR the students:view_dossier permission; permission checks are
	// handled by the RBAC layer, here the role set is enforced).
	dossierViewerRoles = []string{"ADMIN", "EDU_EXPERT", "ARCHIVE_EXPERT", "MILITARY_OFFICER", "GRADUATEAFFAIRS"}
	dossierAdminRoles  = []string{"ADMIN"}
	dossierGradeRoles  = []string{"ADMIN", "GRADUATEAFFAIRS"}
	dossierAuditRoles  = []string{"ADMIN", "GRADUATEAFFAIRS", "EDU_EXPERT"}
	dossierResolveRole = []string{"ADMIN", "EDU_EXPERT", "VICE_EDU"}
)

// RegisterStudentsDossier registers the dossier endpoints under
// /admin/students/dossier/....
func (a *AdminAPI) RegisterStudentsDossier(r gin.IRouter) {
	// List + meta + single dossier (read).
	r.GET("/admin/students/dossier/list", a.dossierList)
	r.GET("/admin/students/dossier/meta", a.dossierMeta)
	r.GET("/admin/students/dossier/student/:id", a.dossierStudent)

	// Transcript (official view data).
	r.GET("/admin/students/dossier/transcript", a.dossierTranscript)
	r.GET("/admin/students/dossier/transcript-regulation", a.dossierTranscriptRegulation)
	r.GET("/admin/students/dossier/cohort-stats", a.dossierCohortStats)
	r.GET("/admin/students/dossier/transcript-qr", a.dossierTranscriptQR)

	// Lazy staff bundle (professors tab).
	r.GET("/admin/students/dossier/staff", a.dossierStaffList)

	// Grade editing + audit.
	r.GET("/admin/students/dossier/grade-audit", a.dossierGradeAudit)
	r.GET("/admin/students/dossier/resolve-sama-code", a.dossierResolveSamaCode)
	r.POST("/admin/students/dossier/grade", a.dossierSetGrade)

	// Regulation change (cascading status-code recompute).
	r.POST("/admin/students/dossier/regulation", a.dossierSetRegulation)

	// Profile patches (student identity/KYC + staff form).
	r.POST("/admin/students/dossier/profile", a.dossierStudentProfile)
	r.POST("/admin/students/dossier/staff-profile", a.dossierStaffProfile)

	// Account management (admin only).
	r.POST("/admin/students/dossier/user-active", a.dossierUserActive)
	r.POST("/admin/students/dossier/reset-password", a.dossierResetPassword)
	r.POST("/admin/students/dossier/bulk-reset-random", a.dossierBulkResetRandom)
	r.POST("/admin/students/dossier/bulk-reset-password", a.dossierBulkResetPassword)
	r.POST("/admin/students/dossier/bulk-force-change", a.dossierBulkForceChange)
	r.POST("/admin/students/dossier/backfill-roles", a.dossierBackfillRoles)
	r.POST("/admin/students/dossier/create-staff", a.dossierCreateStaff)
	r.POST("/admin/students/dossier/save-roles", a.dossierSaveRoles)
}

// ── small helpers ──

func (a *AdminAPI) dossierIDParam(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ دانشجو نامعتبر است."})
		return 0, false
	}
	return id, true
}

func (a *AdminAPI) dossierQueryID(c *gin.Context, key string) (int64, bool) {
	id, err := strconv.ParseInt(strings.TrimSpace(c.Query(key)), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ دانشجو الزامی است."})
		return 0, false
	}
	return id, true
}

func (a *AdminAPI) dossierOK(c *gin.Context, payload gin.H) {
	payload["ok"] = true
	c.JSON(http.StatusOK, payload)
}

// ── list / meta / dossier ──

func (a *AdminAPI) dossierList(c *gin.Context) {
	user := a.requireRoles(c, dossierViewerRoles)
	if user == nil {
		return
	}
	page, _ := strconv.Atoi(strings.TrimSpace(c.Query("page")))
	degree, _ := strconv.ParseInt(strings.TrimSpace(c.Query("degree")), 10, 64)
	resp, err := a.Svc.GetStudentsDossierList(c.Request.Context(), user, a.uniCookie(c), admin.DossierListQuery{
		Q:      strings.TrimSpace(c.Query("q")),
		Status: strings.TrimSpace(c.Query("status")),
		Degree: degree,
		Page:   page,
		Sort:   strings.TrimSpace(c.Query("sort")),
		FCode:  strings.TrimSpace(c.Query("f_code")),
		FName:  strings.TrimSpace(c.Query("f_name")),
		FMajor: strings.TrimSpace(c.Query("f_major")),
		FYear:  strings.TrimSpace(c.Query("f_year")),
		FNC:    strings.TrimSpace(c.Query("f_nc")),
	})
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"data": resp})
}

func (a *AdminAPI) dossierMeta(c *gin.Context) {
	user := a.requireRoles(c, dossierViewerRoles)
	if user == nil {
		return
	}
	meta, err := a.Svc.GetStudentsDossierMeta(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"data": meta})
}

func (a *AdminAPI) dossierStudent(c *gin.Context) {
	user := a.requireRoles(c, dossierViewerRoles)
	if user == nil {
		return
	}
	id, ok := a.dossierIDParam(c)
	if !ok {
		return
	}
	resp, err := a.Svc.GetStudentDossier(c.Request.Context(), user, a.uniCookie(c), id)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"data": resp})
}

// ── transcript ──

func (a *AdminAPI) dossierTranscript(c *gin.Context) {
	user := a.requireRoles(c, dossierViewerRoles)
	if user == nil {
		return
	}
	id, ok := a.dossierQueryID(c, "studentId")
	if !ok {
		return
	}
	rows, err := a.Svc.GetStudentTranscript(c.Request.Context(), user, a.uniCookie(c), id)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"rows": rows})
}

func (a *AdminAPI) dossierTranscriptRegulation(c *gin.Context) {
	user := a.requireRoles(c, dossierViewerRoles)
	if user == nil {
		return
	}
	id, ok := a.dossierQueryID(c, "studentId")
	if !ok {
		return
	}
	resp, err := a.Svc.GetStudentTranscriptRegulation(c.Request.Context(), user, a.uniCookie(c), id)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"data": resp})
}

func (a *AdminAPI) dossierCohortStats(c *gin.Context) {
	user := a.requireRoles(c, dossierViewerRoles)
	if user == nil {
		return
	}
	id, ok := a.dossierQueryID(c, "studentId")
	if !ok {
		return
	}
	scope := c.DefaultQuery("scope", "year")
	if scope != "year" && scope != "term" {
		scope = "year"
	}
	resp, err := a.Svc.GetStudentCohortStats(c.Request.Context(), user, a.uniCookie(c), id, scope)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"data": resp})
}

// dossierTranscriptQR ports /api/admin/students/transcript-qr — the verify QR
// block of the official transcript (a missing key must not break the transcript).
func (a *AdminAPI) dossierTranscriptQR(c *gin.Context) {
	user := a.requireRoles(c, dossierViewerRoles)
	if user == nil {
		return
	}
	id, ok := a.dossierQueryID(c, "studentId")
	if !ok {
		return
	}
	if a.Signer == nil {
		a.dossierOK(c, gin.H{})
		return
	}
	dossier, err := a.Svc.GetStudentDossier(c.Request.Context(), user, a.uniCookie(c), id)
	if err != nil {
		a.fail(c, err)
		return
	}
	stu := dossier.Student
	if stu.UserID == nil || *stu.UserID <= 0 {
		a.fail(c, errDossier("این دانشجو حساب کاربری ندارد؛ استعلام ممکن نیست."))
		return
	}
	uni := int64(0)
	if stu.UniversityID != nil {
		uni = *stu.UniversityID
	}
	ttlMin := 10080.0
	if a.Svc.Store != nil {
		if v, gerr := a.Svc.Store.Get(c.Request.Context(), "TRANSCRIPT_TTL_MINUTES"); gerr == nil && strings.TrimSpace(v) != "" {
			if f, perr := strconv.ParseFloat(strings.TrimSpace(v), 64); perr == nil && f > 0 {
				ttlMin = f
			}
		}
	}
	if ttlMin > 525600 {
		ttlMin = 525600
	}
	ttlSec := int(ttlMin) * 60
	token, err := a.Signer.Sign(c.Request.Context(), map[string]any{
		"uid":  float64(*stu.UserID),
		"sid":  float64(stu.ID),
		"sc":   stu.StudentCode,
		"uni":  float64(uni),
		"kind": "TRANSCRIPT",
	}, ttlSec)
	if err != nil {
		a.fail(c, err)
		return
	}
	base := ""
	if a.Svc.Store != nil {
		if v, gerr := a.Svc.Store.Get(c.Request.Context(), "PUBLIC_BASE_URL"); gerr == nil {
			base = strings.TrimRight(strings.TrimSpace(v), "/")
		}
	}
	url := base + "/verify-transcript/" + token
	payload := gin.H{"url": url, "expiresAt": time.Now().UTC().Add(time.Duration(ttlSec) * time.Second).Format(time.RFC3339)}
	if svg, serr := qr.SVG(url, qr.Options{Level: "Q", Size: 128, Margin: 4}); serr == nil {
		payload["qr"] = svg
	}
	a.dossierOK(c, payload)
}

// errDossier wraps a static Persian message as an error.
func errDossier(msg string) error { return &dossierError{msg} }

type dossierError struct{ msg string }

func (e *dossierError) Error() string { return e.msg }

// ── staff bundle ──

func (a *AdminAPI) dossierStaffList(c *gin.Context) {
	user := a.requireRoles(c, dossierViewerRoles)
	if user == nil {
		return
	}
	limit, _ := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("limit", "100")))
	resp, err := a.Svc.LoadStaffBundle(c.Request.Context(), user, a.uniCookie(c), strings.TrimSpace(c.Query("q")), limit)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"staffList": resp.StaffList, "userRoleIds": resp.UserRoleIDs, "total": resp.Total})
}

// ── grades ──

func (a *AdminAPI) dossierGradeAudit(c *gin.Context) {
	user := a.requireRoles(c, dossierAuditRoles)
	if user == nil {
		return
	}
	id, ok := a.dossierQueryID(c, "studentId")
	if !ok {
		return
	}
	rows, err := a.Svc.StudentGradeAuditLog(c.Request.Context(), user, a.uniCookie(c), id)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"rows": rows})
}

func (a *AdminAPI) dossierResolveSamaCode(c *gin.Context) {
	user := a.requireRoles(c, dossierResolveRole)
	if user == nil {
		return
	}
	id, ok := a.dossierQueryID(c, "studentId")
	if !ok {
		return
	}
	offeringID, err := strconv.ParseInt(strings.TrimSpace(c.Query("offeringId")), 10, 64)
	if err != nil || offeringID <= 0 {
		a.dossierOK(c, gin.H{"code": nil, "title": "نامشخص"})
		return
	}
	var grade *float64
	if gv := strings.TrimSpace(c.Query("gradeValue")); gv != "" {
		if f, perr := strconv.ParseFloat(gv, 64); perr == nil {
			grade = &f
		}
	}
	code, title, err := a.Svc.ResolveSamaCodeForGrade(c.Request.Context(), user, a.uniCookie(c), id, offeringID, grade)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"code": code, "title": title})
}

func (a *AdminAPI) dossierSetGrade(c *gin.Context) {
	user := a.requireRoles(c, dossierGradeRoles)
	if user == nil {
		return
	}
	var in admin.AdminGradeInput
	if err := c.ShouldBindJSON(&in); err != nil || in.StudentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	// Two-step verification (grades:edit) — the client opens the password box
	// on the STEPUP_REQUIRED prefix (same contract as adminSetGradeAction).
	if !CheckStepUp(c.Request, a.Signer, user.ID, "grades:edit") {
		c.JSON(http.StatusOK, gin.H{
			"ok":    false,
			"error": "STEPUP_REQUIRED:برای ثبت نمره، ابتدا رمز عبور خود را تأیید کنید (تأیید دومرحله‌ای — ۱۰ دقیقه معتبر است).",
		})
		return
	}
	resp, err := a.Svc.AdminSetGrade(c.Request.Context(), user, a.uniCookie(c), in)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"message": resp.Message})
}

// ── regulation ──

func (a *AdminAPI) dossierSetRegulation(c *gin.Context) {
	user := a.requireRoles(c, dossierViewerRoles)
	if user == nil {
		return
	}
	var body struct {
		StudentID    int64 `json:"studentId"`
		RegulationID int64 `json:"regulationId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.StudentID <= 0 || body.RegulationID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشجو یا آیین‌نامه نامعتبر است."})
		return
	}
	scanned, updated, err := a.Svc.SetStudentRegulation(c.Request.Context(), user, a.uniCookie(c), body.StudentID, body.RegulationID)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"scanned": scanned, "updated": updated})
}

// ── profile patches ──

func (a *AdminAPI) dossierStudentProfile(c *gin.Context) {
	user := a.requireRoles(c, dossierAdminRoles)
	if user == nil {
		return
	}
	var body struct {
		StudentID int64          `json:"studentId"`
		Patch     map[string]any `json:"patch"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.StudentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.UpdateStudentProfile(c.Request.Context(), user, a.uniCookie(c), body.StudentID, body.Patch); err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{})
}

func (a *AdminAPI) dossierStaffProfile(c *gin.Context) {
	user := a.requireRoles(c, dossierAdminRoles)
	if user == nil {
		return
	}
	var body struct {
		StaffID int64          `json:"staffId"`
		Patch   map[string]any `json:"patch"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.StaffID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.UpdateStaffProfile(c.Request.Context(), user, a.uniCookie(c), body.StaffID, body.Patch); err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{})
}

// ── account management ──

func (a *AdminAPI) dossierUserActive(c *gin.Context) {
	user := a.requireRoles(c, dossierAdminRoles)
	if user == nil {
		return
	}
	var body struct {
		UserID int64 `json:"userId"`
		Active bool  `json:"active"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.UserID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SetUserActiveFull(c.Request.Context(), user, body.UserID, body.Active); err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{})
}

func (a *AdminAPI) dossierResetPassword(c *gin.Context) {
	user := a.requireRoles(c, dossierAdminRoles)
	if user == nil {
		return
	}
	var body struct {
		UserID   int64  `json:"userId"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.UserID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.ResetUserPassword(c.Request.Context(), user, body.UserID, body.Password); err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{})
}

func (a *AdminAPI) dossierBulkResetRandom(c *gin.Context) {
	user := a.requireRoles(c, dossierAdminRoles)
	if user == nil {
		return
	}
	var body struct {
		Scope string `json:"scope"`
	}
	_ = c.ShouldBindJSON(&body)
	count, passwords, err := a.Svc.BulkResetRandomPasswords(c.Request.Context(), user, a.uniCookie(c), body.Scope)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"count": count, "passwords": passwords})
}

func (a *AdminAPI) dossierBulkResetPassword(c *gin.Context) {
	user := a.requireRoles(c, dossierAdminRoles)
	if user == nil {
		return
	}
	var body struct {
		Scope    string `json:"scope"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	count, err := a.Svc.BulkResetPasswords(c.Request.Context(), user, a.uniCookie(c), body.Scope, body.Password)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"count": count})
}

func (a *AdminAPI) dossierBulkForceChange(c *gin.Context) {
	user := a.requireRoles(c, dossierAdminRoles)
	if user == nil {
		return
	}
	var body struct {
		Scope string `json:"scope"`
	}
	_ = c.ShouldBindJSON(&body)
	count, err := a.Svc.BulkForcePasswordChange(c.Request.Context(), user, a.uniCookie(c), body.Scope)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"count": count})
}

func (a *AdminAPI) dossierBackfillRoles(c *gin.Context) {
	user := a.requireRoles(c, dossierAdminRoles)
	if user == nil {
		return
	}
	inserted, err := a.Svc.BackfillRoles(c.Request.Context(), user)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"inserted": inserted})
}

func (a *AdminAPI) dossierCreateStaff(c *gin.Context) {
	user := a.requireRoles(c, dossierAdminRoles)
	if user == nil {
		return
	}
	var in admin.CreateStaffExpertInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	userID, err := a.Svc.CreateStaffExpert(c.Request.Context(), user, a.uniCookie(c), in)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"userId": userID})
}

func (a *AdminAPI) dossierSaveRoles(c *gin.Context) {
	user := a.requireRoles(c, dossierAdminRoles)
	if user == nil {
		return
	}
	var body struct {
		UserID  int64   `json:"userId"`
		RoleIDs []int64 `json:"roleIds"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.UserID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	added, removed, err := a.Svc.SaveUserRoles(c.Request.Context(), user, body.UserID, body.RoleIDs)
	if err != nil {
		a.fail(c, err)
		return
	}
	a.dossierOK(c, gin.H{"added": added, "removed": removed})
}
