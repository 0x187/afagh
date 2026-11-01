// ═══ Admin panel endpoints (phase 6) ═══
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (a *AdminAPI) evaluations(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetEvaluations(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) createEvaluation(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		Title    string `json:"title"`
		TermID   int64  `json:"termId"`
		Start    string `json:"start"`
		End      string `json:"end"`
		IsActive bool   `json:"isActive"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.CreateEvalPeriod(c.Request.Context(), user, a.uniCookie(c), body.Title, body.TermID, body.Start, body.End, body.IsActive); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) toggleEvaluation(c *gin.Context) {
	user := a.requireAdmin(c)
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
	if err := a.Svc.ToggleEvalPeriod(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) deleteEvaluation(c *gin.Context) {
	user := a.requireAdmin(c)
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
	if err := a.Svc.DeleteEvalPeriod(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) weeklyBoard(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetWeeklyBoard(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}
