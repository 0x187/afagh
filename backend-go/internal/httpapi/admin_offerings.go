// ═══ Admin panel endpoints (phase 6) ═══
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (a *AdminAPI) offerings(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetOfferings(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) offeringsWindow(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		TermID int64  `json:"termId"`
		Open   bool   `json:"open"`
		Start  string `json:"start"`
		End    string `json:"end"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.TermID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveWindow(c.Request.Context(), user, a.uniCookie(c), body.TermID, body.Open, body.Start, body.End); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) offeringsTargeting(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		OfferingID     int64  `json:"offeringId"`
		Degree         *int64 `json:"degree"`
		Major          *int64 `json:"major"`
		EntryYearStart *int   `json:"entryYearStart"`
		EntryYearEnd   *int   `json:"entryYearEnd"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.OfferingID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveTargeting(c.Request.Context(), user, a.uniCookie(c), body.OfferingID, body.Degree, body.Major, body.EntryYearStart, body.EntryYearEnd); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) offeringsType(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		OfferingID int64  `json:"offeringId"`
		Type       string `json:"type"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.OfferingID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveOfferingType(c.Request.Context(), user, a.uniCookie(c), body.OfferingID, body.Type); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
