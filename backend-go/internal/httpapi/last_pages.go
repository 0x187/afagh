// ═══ اندپوینت‌های شش صفحهٔ باقی‌ماندهٔ ادمین ═══
// broadcast · bypass · class-sessions · exams/handover · offering-editor · schedule-conflicts
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
	"backend-go/internal/session"
)

var lpBroadcastRoles = []string{"ADMIN", "EDU_EXPERT"}
var lpBypassRoles = []string{"ADMIN", "VICE_EDU", "EDU_EXPERT"}
var lpClassSessionsRoles = []string{"ADMIN", "EDU_EXPERT", "DEP_HEAD"}
var lpHandoverRoles = []string{"ADMIN", "EDU_EXPERT", "VAULT_MANAGER", "PROCTOR"}
var lpHandoverFinalizeRoles = []string{"ADMIN", "EDU_EXPERT"}
var lpEditorRoles = []string{"ADMIN", "EDU_EXPERT"}
var lpConflictsRoles = []string{"ADMIN", "EDU_EXPERT", "VICE_EDU"}

// LastPagesAPI هندلرهای صفحات آخر — struct مستقل با دسترسی به AdminAPI.
type LastPagesAPI struct {
	Admin *AdminAPI
}

func (a *LastPagesAPI) require(c *gin.Context, roles []string) *session.User {
	return a.Admin.requireRoles(c, roles)
}

func (a *LastPagesAPI) uniID(c *gin.Context, user *session.User) *int64 {
	return a.Admin.Svc.UniversityID(c.Request.Context(), user, a.Admin.uniCookie(c))
}

// Register مسیرهای هر شش ماژول.
func (a *LastPagesAPI) Register(r gin.IRouter) {
	// ── پیام همگانی ──
	r.GET("/admin/broadcast/filters", a.lpBroadcastFilters)
	r.GET("/admin/broadcast/offerings", a.lpBroadcastOfferings)
	r.POST("/admin/broadcast/preview", a.lpBroadcastPreview)
	r.POST("/admin/broadcast/send", a.lpBroadcastSend)
	r.GET("/admin/broadcast/history", a.lpBroadcastHistory)
	// ── تأیید bypass ──
	r.GET("/admin/bypass/board", a.lpBypassBoard)
	r.POST("/admin/bypass/approve", a.lpBypassApprove)
	r.POST("/admin/bypass/reject", a.lpBypassReject)
	r.POST("/admin/bypass/return", a.lpBypassReturn)
	r.POST("/admin/bypass/settings", a.lpBypassSettings)
	// ── مدیریت جلسات کلاس ──
	r.GET("/admin/class-sessions/board", a.lpClassSessionsBoard)
	r.POST("/admin/class-sessions/toggle-flag", a.lpClassSessionsToggle)
	// ── زنجیرهٔ تحویل اوراق امتحان ──
	r.GET("/admin/exams/handover/board", a.lpHandoverBoard)
	r.GET("/admin/exams/handover/qr", a.lpHandoverQR)
	r.POST("/admin/exams/handover/finalize", a.lpHandoverFinalize)
	// ── ویرایشگر ارائه ──
	r.GET("/admin/offering-editor/terms", a.lpEditorTerms)
	r.GET("/admin/offering-editor/offerings", a.lpEditorOfferings)
	r.GET("/admin/offering-editor/meta", a.lpEditorMeta)
	r.POST("/admin/offering-editor/save", a.lpEditorSave)
	r.POST("/admin/offering-editor/expert/add", a.lpEditorExpertAdd)
	r.POST("/admin/offering-editor/expert/remove", a.lpEditorExpertRemove)
	// ── رفع تداخل برنامه ──
	r.GET("/admin/schedule-conflicts/terms", a.lpConflictsTerms)
	r.POST("/admin/schedule-conflicts/load", a.lpConflictsLoad)
	r.POST("/admin/schedule-conflicts/review", a.lpConflictsReview)
	r.POST("/admin/schedule-conflicts/review-group", a.lpConflictsReviewGroup)
	r.POST("/admin/schedule-conflicts/undo", a.lpConflictsUndo)
	r.POST("/admin/schedule-conflicts/undo-group", a.lpConflictsUndoGroup)
	r.POST("/admin/schedule-conflicts/merge", a.lpConflictsMerge)
	r.POST("/admin/schedule-conflicts/merge-bulk", a.lpConflictsMergeBulk)
}

// ─────────────────────────── پیام همگانی ───────────────────────────

func (a *LastPagesAPI) lpBroadcastFilters(c *gin.Context) {
	user := a.require(c, lpBroadcastRoles)
	if user == nil {
		return
	}
	res, err := a.Admin.Svc.ListBroadcastFilters(c.Request.Context(), user, a.Admin.uniCookie(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *LastPagesAPI) lpBroadcastOfferings(c *gin.Context) {
	user := a.require(c, lpBroadcastRoles)
	if user == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	res, err := a.Admin.Svc.ListTermOfferings(c.Request.Context(), user, a.Admin.uniCookie(c), termID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"offerings": res}})
}

func (a *LastPagesAPI) lpBroadcastPreview(c *gin.Context) {
	user := a.require(c, lpBroadcastRoles)
	if user == nil {
		return
	}
	var in struct {
		Audience map[string]any `json:"audience"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ورودی نامعتبر است."})
		return
	}
	aud := lpParseAudience(in.Audience)
	count, capped, err := a.Admin.Svc.PreviewBroadcastCount(c.Request.Context(), user, a.Admin.uniCookie(c), aud)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"count": count, "capped": capped}})
}

func (a *LastPagesAPI) lpBroadcastSend(c *gin.Context) {
	user := a.require(c, lpBroadcastRoles)
	if user == nil {
		return
	}
	var in struct {
		Audience map[string]any `json:"audience"`
		Channels []string       `json:"channels"`
		Text     string         `json:"text"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ورودی نامعتبر است."})
		return
	}
	res, err := a.Admin.Svc.SendBroadcast(c.Request.Context(), user, a.Admin.uniCookie(c),
		lpParseAudience(in.Audience), in.Channels, in.Text)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *LastPagesAPI) lpBroadcastHistory(c *gin.Context) {
	user := a.require(c, lpBroadcastRoles)
	if user == nil {
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	res, err := a.Admin.Svc.ListBroadcastHistory(c.Request.Context(), user, a.Admin.uniCookie(c), limit)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"records": res}})
}

// lpParseAudience پارس امن مخاطبان از JSON عمومی.
func lpParseAudience(in map[string]any) (aud admin.BroadcastAudience) {
	role, _ := in["role"].(string)
	aud.Role = role
	aud.FacultyID = lpAudienceID(in["facultyId"])
	aud.DepartmentID = lpAudienceID(in["departmentId"])
	aud.MajorID = lpAudienceID(in["majorId"])
	aud.EntryYear = lpAudienceID(in["entryYear"])
	aud.TermID = lpAudienceID(in["termId"])
	aud.OfferingID = lpAudienceID(in["offeringId"])
	if b, ok := in["activeOnly"].(bool); ok {
		aud.ActiveOnly = b
	}
	return aud
}

func lpAudienceID(v any) *int64 {
	switch n := v.(type) {
	case float64:
		if n > 0 {
			id := int64(n)
			return &id
		}
	case int:
		if n > 0 {
			id := int64(n)
			return &id
		}
	case int64:
		if n > 0 {
			return &n
		}
	}
	return nil
}

// ─────────────────────────── تأیید bypass ───────────────────────────

func (a *LastPagesAPI) lpBypassBoard(c *gin.Context) {
	user := a.require(c, lpBypassRoles)
	if user == nil {
		return
	}
	res, err := a.Admin.Svc.BypassBoard(c.Request.Context(), user)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *LastPagesAPI) lpBypassApprove(c *gin.Context) {
	user := a.require(c, lpBypassRoles)
	if user == nil {
		return
	}
	var in struct {
		RequestID int64 `json:"requestId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.RequestID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Admin.Svc.BypassApprove(c.Request.Context(), user, in.RequestID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *LastPagesAPI) lpBypassReject(c *gin.Context) {
	user := a.require(c, lpBypassRoles)
	if user == nil {
		return
	}
	var in struct {
		RequestID  int64  `json:"requestId"`
		ReasonCode string `json:"reasonCode"`
		ReasonText string `json:"reasonText"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.RequestID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Admin.Svc.BypassReject(c.Request.Context(), user, in.RequestID, in.ReasonCode, in.ReasonText); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *LastPagesAPI) lpBypassReturn(c *gin.Context) {
	user := a.require(c, lpBypassRoles)
	if user == nil {
		return
	}
	var in struct {
		RequestID int64  `json:"requestId"`
		Target    string `json:"target"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.RequestID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Admin.Svc.BypassReturn(c.Request.Context(), user, in.RequestID, in.Target); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *LastPagesAPI) lpBypassSettings(c *gin.Context) {
	user := a.require(c, lpBypassRoles)
	if user == nil {
		return
	}
	var in struct {
		TermID        int64 `json:"termId"`
		ManagerHours  int   `json:"bypassManagerHours"`
		ExpertHours   int   `json:"bypassExpertHours"`
		ReminderHours int   `json:"bypassReminderHours"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.TermID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ترم نامعتبر است."})
		return
	}
	if err := a.Admin.Svc.BypassSaveSettings(c.Request.Context(), user, in.TermID,
		in.ManagerHours, in.ExpertHours, in.ReminderHours); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─────────────────────────── مدیریت جلسات کلاس ───────────────────────────

func (a *LastPagesAPI) lpClassSessionsBoard(c *gin.Context) {
	user := a.require(c, lpClassSessionsRoles)
	if user == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	offeringID, _ := strconv.ParseInt(c.Query("offeringId"), 10, 64)
	res, err := a.Admin.Svc.ClassSessionsBoard(c.Request.Context(), user, a.Admin.uniCookie(c),
		termID, c.Query("q"), offeringID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *LastPagesAPI) lpClassSessionsToggle(c *gin.Context) {
	user := a.require(c, lpClassSessionsRoles)
	if user == nil {
		return
	}
	var in struct {
		SessionID int64  `json:"sessionId"`
		Flag      string `json:"flag"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ورودی نامعتبر است."})
		return
	}
	value, err := a.Admin.Svc.ClassSessionToggleFlag(c.Request.Context(), user, a.Admin.uniCookie(c), in.SessionID, in.Flag)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"value": value}})
}

// ─────────────────────────── زنجیرهٔ تحویل اوراق ───────────────────────────

func (a *LastPagesAPI) lpHandoverBoard(c *gin.Context) {
	user := a.require(c, lpHandoverRoles)
	if user == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	res, err := a.Admin.Svc.ExamHandoverBoard(c.Request.Context(), user, a.Admin.uniCookie(c), termID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *LastPagesAPI) lpHandoverQR(c *gin.Context) {
	user := a.require(c, lpHandoverRoles)
	if user == nil {
		return
	}
	sessionID, _ := strconv.ParseInt(c.Query("sessionId"), 10, 64)
	hallID, _ := strconv.ParseInt(c.Query("hallId"), 10, 64)
	offeringID, _ := strconv.ParseInt(c.Query("offeringId"), 10, 64)
	res, err := a.Admin.Svc.ExamHandoverQR(c.Request.Context(), user, a.Admin.uniCookie(c),
		a.Admin.Signer, c.Query("step"), sessionID, hallID, offeringID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *LastPagesAPI) lpHandoverFinalize(c *gin.Context) {
	user := a.require(c, lpHandoverFinalizeRoles)
	if user == nil {
		return
	}
	var in struct {
		SessionID int64 `json:"sessionId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.SessionID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "جلسه نامعتبر است."})
		return
	}
	res, err := a.Admin.Svc.ExamHandoverFinalize(c.Request.Context(), user, a.Admin.uniCookie(c), in.SessionID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

// ─────────────────────────── ویرایشگر ارائه ───────────────────────────

func (a *LastPagesAPI) lpEditorTerms(c *gin.Context) {
	user := a.require(c, lpEditorRoles)
	if user == nil {
		return
	}
	res, err := a.Admin.Svc.ListTermsForEditor(c.Request.Context(), user, a.Admin.uniCookie(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"terms": res}})
}

func (a *LastPagesAPI) lpEditorOfferings(c *gin.Context) {
	user := a.require(c, lpEditorRoles)
	if user == nil {
		return
	}
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	res, err := a.Admin.Svc.ListOfferingsForEditor(c.Request.Context(), user, a.Admin.uniCookie(c), termID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": res}})
}

func (a *LastPagesAPI) lpEditorMeta(c *gin.Context) {
	user := a.require(c, lpEditorRoles)
	if user == nil {
		return
	}
	rooms, err := a.Admin.Svc.ListRoomsForEditor(c.Request.Context(), user, a.Admin.uniCookie(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	experts, err := a.Admin.Svc.ListEduExpertsForEditor(c.Request.Context(), user, a.Admin.uniCookie(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rooms": rooms, "experts": experts}})
}

func (a *LastPagesAPI) lpEditorSave(c *gin.Context) {
	user := a.require(c, lpEditorRoles)
	if user == nil {
		return
	}
	var in admin.OfferingEditorSaveInput
	if err := c.ShouldBindJSON(&in); err != nil || in.OfferingID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ورودی نامعتبر است."})
		return
	}
	if err := a.Admin.Svc.SaveOfferingEditor(c.Request.Context(), user, a.Admin.uniCookie(c), in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *LastPagesAPI) lpEditorExpertAdd(c *gin.Context) {
	user := a.require(c, lpEditorRoles)
	if user == nil {
		return
	}
	var in struct {
		OfferingID int64 `json:"offeringId"`
		UserID     int64 `json:"userId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.OfferingID <= 0 || in.UserID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ورودی نامعتبر است."})
		return
	}
	if err := a.Admin.Svc.AddOfferingEduExpert(c.Request.Context(), user, a.Admin.uniCookie(c), in.OfferingID, in.UserID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *LastPagesAPI) lpEditorExpertRemove(c *gin.Context) {
	user := a.require(c, lpEditorRoles)
	if user == nil {
		return
	}
	var in struct {
		OfferingID int64 `json:"offeringId"`
		UserID     int64 `json:"userId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.OfferingID <= 0 || in.UserID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ورودی نامعتبر است."})
		return
	}
	ids, err := a.Admin.Svc.RemoveOfferingEduExpert(c.Request.Context(), user, a.Admin.uniCookie(c), in.OfferingID, in.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"userIds": ids}})
}

// ─────────────────────────── رفع تداخل برنامه ───────────────────────────

func (a *LastPagesAPI) lpConflictsTerms(c *gin.Context) {
	user := a.require(c, lpConflictsRoles)
	if user == nil {
		return
	}
	res, err := a.Admin.Svc.ListTermsForConflicts(c.Request.Context(), user, a.Admin.uniCookie(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"terms": res}})
}

func (a *LastPagesAPI) lpConflictsLoad(c *gin.Context) {
	user := a.require(c, lpConflictsRoles)
	if user == nil {
		return
	}
	var in struct {
		TermID int64 `json:"termId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.TermID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ترم نامعتبر است."})
		return
	}
	res, err := a.Admin.Svc.LoadScheduleConflicts(c.Request.Context(), user, a.Admin.uniCookie(c), in.TermID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *LastPagesAPI) lpConflictsReview(c *gin.Context) {
	user := a.require(c, lpConflictsRoles)
	if user == nil {
		return
	}
	var in admin.ConflictsMarkInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ورودی نامعتبر است."})
		return
	}
	msg, err := a.Admin.Svc.MarkConflictReviewed(c.Request.Context(), user, a.Admin.uniCookie(c), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
}

func (a *LastPagesAPI) lpConflictsReviewGroup(c *gin.Context) {
	user := a.require(c, lpConflictsRoles)
	if user == nil {
		return
	}
	var in struct {
		TermID     int64                            `json:"termId"`
		ReasonCode string                           `json:"reasonCode"`
		ReasonText string                           `json:"reasonText"`
		Items      []admin.ConflictsGroupReviewItem `json:"items"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ورودی نامعتبر است."})
		return
	}
	msg, err := a.Admin.Svc.MarkConflictGroupReviewed(c.Request.Context(), user, a.Admin.uniCookie(c),
		in.TermID, in.ReasonCode, in.ReasonText, in.Items)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
}

func (a *LastPagesAPI) lpConflictsUndo(c *gin.Context) {
	user := a.require(c, lpConflictsRoles)
	if user == nil {
		return
	}
	var in struct {
		TermID      int64  `json:"termId"`
		Fingerprint string `json:"fingerprint"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ورودی نامعتبر است."})
		return
	}
	msg, err := a.Admin.Svc.UndoConflictReview(c.Request.Context(), user, a.Admin.uniCookie(c), in.TermID, in.Fingerprint)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
}

func (a *LastPagesAPI) lpConflictsUndoGroup(c *gin.Context) {
	user := a.require(c, lpConflictsRoles)
	if user == nil {
		return
	}
	var in struct {
		TermID       int64    `json:"termId"`
		Fingerprints []string `json:"fingerprints"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ورودی نامعتبر است."})
		return
	}
	msg, err := a.Admin.Svc.UndoConflictGroup(c.Request.Context(), user, a.Admin.uniCookie(c), in.TermID, in.Fingerprints)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
}

func (a *LastPagesAPI) lpConflictsMerge(c *gin.Context) {
	user := a.require(c, lpConflictsRoles)
	if user == nil {
		return
	}
	var in struct {
		TermID      int64   `json:"termId"`
		OfferingIDs []int64 `json:"offeringIds"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ورودی نامعتبر است."})
		return
	}
	msg, err := a.Admin.Svc.MarkOfferingsMerged(c.Request.Context(), user, a.Admin.uniCookie(c), in.TermID, in.OfferingIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
}

func (a *LastPagesAPI) lpConflictsMergeBulk(c *gin.Context) {
	user := a.require(c, lpConflictsRoles)
	if user == nil {
		return
	}
	var in struct {
		TermID int64     `json:"termId"`
		Groups [][]int64 `json:"groups"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "ورودی نامعتبر است."})
		return
	}
	msg, err := a.Admin.Svc.MarkOfferingsMergedBulk(c.Request.Context(), user, a.Admin.uniCookie(c), in.TermID, in.Groups)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"message": msg}})
}
