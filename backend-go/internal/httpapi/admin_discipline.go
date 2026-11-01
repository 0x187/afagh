// ═══ Admin panel endpoints (phase 6) ═══
package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

func (a *AdminAPI) disciplineList(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	sid, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	resp, err := a.Svc.ListDisciplineCases(c.Request.Context(), user, a.uniCookie(c),
		strings.TrimSpace(c.Query("status")), strings.TrimSpace(c.Query("q")),
		strings.TrimSpace(c.Query("dateFrom")), strings.TrimSpace(c.Query("dateTo")), sid, page)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) disciplineStudents(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	hits, err := a.Svc.SearchDisciplineStudents(c.Request.Context(), user, a.uniCookie(c), c.Query("q"))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"hits": hits}})
}

func (a *AdminAPI) disciplineCreate(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.CreateDisciplineInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	id, err := a.Svc.CreateDisciplineCase(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) disciplineUpdate(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
		admin.UpdateDisciplineInput
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه پرونده نامعتبر است."})
		return
	}
	if err := a.Svc.UpdateDisciplineCase(c.Request.Context(), user, a.uniCookie(c), body.ID, body.UpdateDisciplineInput); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) disciplineDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه پرونده نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteDisciplineCase(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) councilMeetings(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	rows, total, p, err := a.Svc.ListCouncilMeetings(c.Request.Context(), user, a.uniCookie(c),
		strings.TrimSpace(c.Query("q")), strings.TrimSpace(c.Query("dateFrom")), strings.TrimSpace(c.Query("dateTo")), page)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows, "total": total, "page": p, "pageSize": 50}})
}

func (a *AdminAPI) councilMeetingSave(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.MeetingInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	id, err := a.Svc.SaveCouncilMeeting(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) councilMeetingDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه جلسه نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteCouncilMeeting(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) councilDecisions(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	mid, _ := strconv.ParseInt(c.Query("meetingId"), 10, 64)
	sid, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	rows, total, p, err := a.Svc.ListCouncilDecisions(c.Request.Context(), user, a.uniCookie(c),
		strings.TrimSpace(c.Query("status")), strings.TrimSpace(c.Query("type")), mid, sid, page)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows, "total": total, "page": p, "pageSize": 50}})
}

func (a *AdminAPI) councilDecisionSave(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.DecisionInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "داده ورودی معتبر نیست."})
		return
	}
	id, err := a.Svc.SaveCouncilDecision(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) councilDecisionDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه مصوبه نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteCouncilDecision(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─────────────────── Document archive ───────────────────
