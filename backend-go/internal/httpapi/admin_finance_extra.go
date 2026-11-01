// ═══ Admin panel endpoints (phase 6) ═══
package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

func (a *AdminAPI) financeCoefficients(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	rows, err := a.Svc.ListCoefficients(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows}})
}

func (a *AdminAPI) financeCoefficientSave(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.SaveCoefficientInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	id, err := a.Svc.SaveCoefficient(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) financeCoefficientDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه الزامی است"})
		return
	}
	if err := a.Svc.DeleteCoefficient(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) financeSubjectFees(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	rows, err := a.Svc.ListSubjectFeeTypes(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows}})
}

func (a *AdminAPI) financeSubjectFeeSave(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.SubjectFeeKindInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	id, err := a.Svc.SaveSubjectFeeType(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) financeSubjectFeeDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه الزامی است"})
		return
	}
	if err := a.Svc.DeleteSubjectFeeType(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) financeSubjectFeeAssignments(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	studentID, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	termID, _ := strconv.ParseInt(c.Query("termId"), 10, 64)
	rows, err := a.Svc.ListSubjectFeeAssignments(c.Request.Context(), user, a.uniCookie(c), studentID, termID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows}})
}

func (a *AdminAPI) financeSubjectFeeAssign(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.AssignSubjectFeeInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	id, err := a.Svc.AssignSubjectFee(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) financeSubjectFeeAssignDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه الزامی است"})
		return
	}
	if err := a.Svc.DeleteSubjectFeeAssignment(c.Request.Context(), user, a.uniCookie(c), body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─────────────────── Financial registration time control ───────────────────

func (a *AdminAPI) financeTimeControl(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	state, err := a.Svc.GetLockState(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": state})
}

func (a *AdminAPI) financeTimeControlSave(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.SavePeriodInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "پارامترهای نامعتبر (نام دوره، تاریخ شروع و پایان الزامی است)"})
		return
	}
	state, err := a.Svc.SaveAccountingPeriod(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": state})
}

// ─────────────────── Student-specific formula ───────────────────

func (a *AdminAPI) financeStudentFormula(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	sid, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	rows, total, err := a.Svc.ListTuitionOverrides(c.Request.Context(), user, a.uniCookie(c),
		strings.TrimSpace(c.Query("q")), sid, c.Query("active") == "1", page)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows, "total": total, "page": page, "pageSize": 50}})
}

func (a *AdminAPI) financeStudentFormulaCreate(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.SaveTuitionOverrideInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_body"})
		return
	}
	id, err := a.Svc.CreateTuitionOverride(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) financeStudentFormulaUpdate(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
		admin.UpdateTuitionOverrideInput
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_id"})
		return
	}
	if err := a.Svc.UpdateTuitionOverride(c.Request.Context(), user, body.ID, body.UpdateTuitionOverrideInput); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) financeStudentFormulaDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_id"})
		return
	}
	if err := a.Svc.DeleteTuitionOverride(c.Request.Context(), user, body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─────────────────── Welfare fund ───────────────────

func (a *AdminAPI) financeWelfareFunds(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	funds, err := a.Svc.ListWelfareFunds(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"funds": funds}})
}

func (a *AdminAPI) financeWelfareLoans(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	raw := strings.TrimSpace(c.Query("fundId"))
	var fundID *int64
	if raw != "" && raw != "unassigned" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_fund"})
			return
		}
		fundID = &v
	}
	page, _ := strconv.Atoi(c.Query("page"))
	rows, total, err := a.Svc.ListWelfareLoans(c.Request.Context(), user, a.uniCookie(c), fundID, page)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows, "total": total, "page": page, "pageSize": 50}})
}

func (a *AdminAPI) financeWelfareFundCreate(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body admin.WelfareFundInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_body"})
		return
	}
	id, err := a.Svc.CreateWelfareFund(c.Request.Context(), user, a.uniCookie(c), body)
	if err != nil {
		if err.Error() == "duplicate_code" {
			c.JSON(http.StatusConflict, gin.H{"ok": false, "error": "duplicate_code"})
			return
		}
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *AdminAPI) financeWelfareFundUpdate(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
		admin.WelfareFundInput
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_id"})
		return
	}
	if err := a.Svc.UpdateWelfareFund(c.Request.Context(), user, body.ID, body.WelfareFundInput); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) financeWelfareFundDelete(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_id"})
		return
	}
	if err := a.Svc.DeleteWelfareFund(c.Request.Context(), user, body.ID); err != nil {
		if strings.HasPrefix(err.Error(), "fund_in_use:") {
			c.JSON(http.StatusConflict, gin.H{"ok": false, "error": "fund_in_use", "loanCount": strings.TrimPrefix(err.Error(), "fund_in_use:")})
			return
		}
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) financeWelfareAssignLoan(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	var body map[string]json.RawMessage
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid_loan"})
		return
	}
	var loanID int64
	if raw, ok := body["loanId"]; ok {
		_ = json.Unmarshal(raw, &loanID)
	}
	fundRaw, fundSet := body["fundId"]
	var fundID *int64
	if fundSet && string(fundRaw) != "null" {
		var v int64
		if err := json.Unmarshal(fundRaw, &v); err == nil {
			fundID = &v
		}
	}
	in := admin.AssignLoanInput{LoanID: loanID, FundID: fundID, FundIDSet: fundSet}
	if err := a.Svc.AssignLoanToFund(c.Request.Context(), user, a.uniCookie(c), in); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
