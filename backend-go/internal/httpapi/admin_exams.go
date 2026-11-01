// ═══ Admin panel endpoints (phase 6) ═══
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (a *AdminAPI) exams(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetExams(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) createExamSession(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		TermID   int64  `json:"termId"`
		ExamDate string `json:"examDate"`
		Start    string `json:"start"`
		End      string `json:"end"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.TermID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.CreateExamSession(c.Request.Context(), user, a.uniCookie(c), body.TermID, body.ExamDate, body.Start, body.End); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) assignExamSession(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		OfferingID int64 `json:"offeringId"`
		SessionID  int64 `json:"sessionId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.OfferingID <= 0 || body.SessionID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.AssignExamSession(c.Request.Context(), user, a.uniCookie(c), body.OfferingID, body.SessionID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) createExamHall(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		Name      string `json:"name"`
		Capacity  int    `json:"capacity"`
		RowsCount int    `json:"rowsCount"`
		ColsCount int    `json:"colsCount"`
		Building  string `json:"buildingName"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.CreateExamHall(c.Request.Context(), user, a.uniCookie(c), body.Name, body.Capacity, body.RowsCount, body.ColsCount, body.Building); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) generateExamSeats(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	allocated, sessions, err := a.Svc.GenerateExamSeats(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "allocated": allocated, "sessionCount": sessions})
}
