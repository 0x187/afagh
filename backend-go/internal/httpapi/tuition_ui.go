// ═══ Tuition engine and annual tariff endpoints ═══
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

var tuitionRoles = []string{"ADMIN", "FINANCE_EXPERT", "FINANCE"}

func (a *AdminAPI) tuitionRules(c *gin.Context) {
	user := a.requireRoles(c, tuitionRoles)
	if user == nil {
		return
	}
	data, err := a.Svc.TuitionRules(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": data})
}

func (a *AdminAPI) tuitionRuleSave(c *gin.Context) {
	user := a.requireRoles(c, tuitionRoles)
	if user == nil {
		return
	}
	var in admin.TuitionRuleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر است."})
		return
	}
	if err := a.Svc.SaveTuitionRule(c.Request.Context(), user, a.uniCookie(c), in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) tuitionRuleDelete(c *gin.Context) {
	user := a.requireRoles(c, tuitionRoles)
	if user == nil {
		return
	}
	var in struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteTuitionRule(c.Request.Context(), user, a.uniCookie(c), in.ID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) tuitionImportLegacy(c *gin.Context) {
	user := a.requireRoles(c, tuitionRoles)
	if user == nil {
		return
	}
	res, err := a.Svc.ImportLegacyFeeRules(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) tuitionEquivMode(c *gin.Context) {
	user := a.requireRoles(c, tuitionRoles)
	if user == nil {
		return
	}
	var in struct {
		Mode string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر است."})
		return
	}
	saved, err := a.Svc.SetEquivFixedMode(c.Request.Context(), user, in.Mode)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"saved": saved}})
}

func (a *AdminAPI) tuitionTariff(c *gin.Context) {
	user := a.requireRoles(c, tuitionRoles)
	if user == nil {
		return
	}
	year, _ := strconv.Atoi(c.Query("year"))
	data, err := a.Svc.Tariff(c.Request.Context(), user, a.uniCookie(c), year)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": data})
}

func (a *AdminAPI) tuitionTariffSave(c *gin.Context) {
	user := a.requireRoles(c, tuitionRoles)
	if user == nil {
		return
	}
	var in struct {
		Year       int                     `json:"year"`
		UPriceCode string                  `json:"uPriceCode"`
		Rates      []admin.TariffRateInput `json:"rates"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر است."})
		return
	}
	updated, err := a.Svc.SaveTariffGroup(c.Request.Context(), user, a.uniCookie(c), in.Year, in.UPriceCode, in.Rates)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"updated": updated}})
}

func (a *AdminAPI) tuitionTariffCopy(c *gin.Context) {
	user := a.requireRoles(c, tuitionRoles)
	if user == nil {
		return
	}
	var in struct {
		FromYear  int  `json:"fromYear"`
		ToYear    int  `json:"toYear"`
		Overwrite bool `json:"overwrite"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر است."})
		return
	}
	inserted, err := a.Svc.CopyTariffYear(c.Request.Context(), user, a.uniCookie(c), in.FromYear, in.ToYear, in.Overwrite)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"inserted": inserted}})
}
