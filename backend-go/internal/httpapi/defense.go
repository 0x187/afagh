// ═══ Thesis defense desk endpoints ═══
package httpapi

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

var defenseBoardRoles = []string{"ADMIN", "EDU_EXPERT", "GRADUATION_EXPERT", "DEP_HEAD", "PROFESSOR"}
var defenseExpertRoles = []string{"ADMIN", "EDU_EXPERT", "GRADUATION_EXPERT"}

func (a *AdminAPI) defenseBoard(c *gin.Context) {
	user := a.requireRoles(c, defenseBoardRoles)
	if user == nil {
		return
	}
	board, err := a.Svc.DefenseBoardData(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"board": board}})
}

func (a *AdminAPI) defenseApproveProposal(c *gin.Context) {
	user := a.requireRoles(c, defenseExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		AuditID             int64  `json:"auditId"`
		IrandocTrackingCode string `json:"irandocTrackingCode"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.AuditID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Svc.ApproveProposal(c.Request.Context(), user, a.uniCookie(c), in.AuditID, in.IrandocTrackingCode); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	if a.Graduation != nil {
		_, _ = a.Graduation.Advance(c.Request.Context(), in.AuditID)
	}
	board, _ := a.Svc.DefenseBoardData(c.Request.Context(), user, a.uniCookie(c))
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"board": board}})
}

func (a *AdminAPI) defenseSupervisorApprove(c *gin.Context) {
	user := a.requireRoles(c, []string{"PROFESSOR", "DEP_HEAD", "ADMIN"})
	if user == nil {
		return
	}
	var in struct {
		AuditID  int64 `json:"auditId"`
		Approved bool  `json:"approved"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.AuditID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Svc.SupervisorApproveDefense(c.Request.Context(), user, a.uniCookie(c), in.AuditID, in.Approved); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	board, _ := a.Svc.DefenseBoardData(c.Request.Context(), user, a.uniCookie(c))
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"board": board}})
}

func (a *AdminAPI) defenseSchedule(c *gin.Context) {
	user := a.requireRoles(c, defenseExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		AuditID     int64  `json:"auditId"`
		ScheduledAt string `json:"scheduledAt"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.AuditID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	at, err := time.Parse(time.RFC3339, in.ScheduledAt)
	if err != nil {
		if v, e := time.Parse("2006-01-02T15:04", in.ScheduledAt); e == nil {
			at = v
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "تاریخ و ساعت دفاع را کامل انتخاب کنید."})
			return
		}
	}
	if err := a.Svc.ScheduleDefenseTime(c.Request.Context(), user, a.uniCookie(c), in.AuditID, at); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	board, _ := a.Svc.DefenseBoardData(c.Request.Context(), user, a.uniCookie(c))
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"board": board}})
}

func (a *AdminAPI) defenseRecordResult(c *gin.Context) {
	user := a.requireRoles(c, defenseExpertRoles)
	if user == nil {
		return
	}
	var in struct {
		AuditID     int64  `json:"auditId"`
		Result      string `json:"result"`
		Minutes     string `json:"minutes"`
		ConductedAt string `json:"conductedAt"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.AuditID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	at, err := time.Parse(time.RFC3339, in.ConductedAt)
	if err != nil {
		if v, e := time.Parse("2006-01-02T15:04", in.ConductedAt); e == nil {
			at = v
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "تاریخ برگزاری دفاع را کامل انتخاب کنید."})
			return
		}
	}
	if err := a.Svc.RecordDefenseResult(c.Request.Context(), user, a.uniCookie(c), in.AuditID, in.Result, in.Minutes, at); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	board, _ := a.Svc.DefenseBoardData(c.Request.Context(), user, a.uniCookie(c))
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"board": board}})
}

func (a *AdminAPI) defensePoolSave(c *gin.Context) {
	user := a.requireRoles(c, defenseExpertRoles)
	if user == nil {
		return
	}
	var in admin.DefensePoolInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Svc.SaveDefensePool(c.Request.Context(), user, a.uniCookie(c), in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	board, _ := a.Svc.DefenseBoardData(c.Request.Context(), user, a.uniCookie(c))
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"board": board}})
}

func (a *AdminAPI) defensePoolToggle(c *gin.Context) {
	user := a.requireRoles(c, defenseExpertRoles)
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
	if err := a.Svc.ToggleDefensePool(c.Request.Context(), user, a.uniCookie(c), in.ID, in.IsActive); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	board, _ := a.Svc.DefenseBoardData(c.Request.Context(), user, a.uniCookie(c))
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"board": board}})
}
