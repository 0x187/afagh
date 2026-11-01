// ═══ Codes center — HTTP handlers (port of admin/codes in Next) ═══
//
// Standalone CodesAPI struct — registry in main.go:
//
//	codesAPI := &httpapi.CodesAPI{Svc: adminSvc, Store: store}
//	codesAPI.Register(ginEngine.Group(""))
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
	"backend-go/internal/scope"
	"backend-go/internal/session"
)

// codesViewRoles / codesEditRoles — the same roles as the Next actions:
// read: ADMIN/VICE_EDU/EDU_EXPERT · write: ADMIN/VICE_EDU
// (exception: term schedule editing in Next is open to read roles — preserved as is.)
var (
	codesViewRoles = []string{"ADMIN", "VICE_EDU", "EDU_EXPERT"}
	codesEditRoles = []string{"ADMIN", "VICE_EDU"}
)

// CodesAPI is the codes center handlers.
type CodesAPI struct {
	Svc   *admin.Service
	Store *session.Store
}

// Register registers the codes center routes — all under /admin/codes/*.
func (a *CodesAPI) Register(r gin.IRouter) {
	r.GET("/admin/codes/stats", a.codesStats)
	r.GET("/admin/codes/rows", a.codesRows)
	r.GET("/admin/codes/missing-summary", a.codesMissingSummary)
	r.GET("/admin/codes/export", a.codesExport)
	r.GET("/admin/codes/count", a.codesCount)
	r.GET("/admin/codes/form-options", a.codesFormOptions)
	r.GET("/admin/codes/row", a.codesGetRow)
	r.POST("/admin/codes/set-code", a.codesSetCode)
	r.POST("/admin/codes/create", a.codesCreate)
	r.POST("/admin/codes/row/update", a.codesUpdateRow)
	r.GET("/admin/codes/degree", a.codesGetDegree)
	r.POST("/admin/codes/degree/update", a.codesUpdateDegree)
	r.GET("/admin/codes/term", a.codesGetTerm)
	r.POST("/admin/codes/term/update", a.codesUpdateTerm)
	r.POST("/admin/codes/delete", a.codesDelete)
}

// requireRoles — the student_cards.go pattern.
func (a *CodesAPI) requireRoles(c *gin.Context, roles []string) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	user, _ := a.Store.Get(c.Request.Context(), token, false)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	for _, r := range user.Roles {
		for _, want := range roles {
			if r == want {
				return user
			}
		}
	}
	c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی غیرمجاز"})
	return nil
}

func (a *CodesAPI) uniCookie(c *gin.Context) string {
	if v, err := c.Cookie(scope.UniversityCookie); err == nil {
		return v
	}
	return ""
}

func (a *CodesAPI) fail(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
}

func codesQueryID(c *gin.Context) int64 {
	n, _ := strconv.ParseInt(c.Query("id"), 10, 64)
	return n
}

// codesStats returns code health stats (cards at the top of the page).
func (a *CodesAPI) codesStats(c *gin.Context) {
	user := a.requireRoles(c, codesViewRoles)
	if user == nil {
		return
	}
	stats, err := a.Svc.CodeStats(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"stats": stats}})
}

// codesRows lists the codes of a table (with optional q search).
func (a *CodesAPI) codesRows(c *gin.Context) {
	user := a.requireRoles(c, codesViewRoles)
	if user == nil {
		return
	}
	rows, err := a.Svc.ListCodes(c.Request.Context(), user, a.uniCookie(c), c.Query("table"), c.Query("q"))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows}})
}

// codesMissingSummary summarizes records without a code.
func (a *CodesAPI) codesMissingSummary(c *gin.Context) {
	user := a.requireRoles(c, codesViewRoles)
	if user == nil {
		return
	}
	summary, err := a.Svc.MissingCodeSummary(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"missing": summary}})
}

// codesExport exports a table as CSV (download from text).
func (a *CodesAPI) codesExport(c *gin.Context) {
	user := a.requireRoles(c, codesViewRoles)
	if user == nil {
		return
	}
	csv, err := a.Svc.ExportCodesCsv(c.Request.Context(), user, a.uniCookie(c), c.Query("table"))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"csv": csv}})
}

// codesCount counts a table's records without loading them all.
func (a *CodesAPI) codesCount(c *gin.Context) {
	user := a.requireRoles(c, codesViewRoles)
	if user == nil {
		return
	}
	n, err := a.Svc.CountRows(c.Request.Context(), user, a.uniCookie(c), c.Query("table"))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"count": n}})
}

// codesFormOptions are the parent options for the create form.
func (a *CodesAPI) codesFormOptions(c *gin.Context) {
	user := a.requireRoles(c, codesViewRoles)
	if user == nil {
		return
	}
	options, err := a.Svc.CodeFormOptionsOf(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": options})
}

// codesGetRow reads one row for the generic edit form.
func (a *CodesAPI) codesGetRow(c *gin.Context) {
	user := a.requireRoles(c, codesViewRoles)
	if user == nil {
		return
	}
	row, err := a.Svc.GetCodeRow(c.Request.Context(), user, a.uniCookie(c), c.Query("table"), codesQueryID(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"row": row}})
}

// codesSetCode edits a record's code (with a uniqueness check).
func (a *CodesAPI) codesSetCode(c *gin.Context) {
	user := a.requireRoles(c, codesEditRoles)
	if user == nil {
		return
	}
	var in admin.SetCodeInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SetCodeAction(c.Request.Context(), user, a.uniCookie(c), in); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type codesRowValuesInput struct {
	Table  string            `json:"table"`
	ID     int64             `json:"id"`
	Values map[string]string `json:"values"`
}

// codesCreate creates a new reference record (degree/faculty/major/term).
func (a *CodesAPI) codesCreate(c *gin.Context) {
	user := a.requireRoles(c, codesEditRoles)
	if user == nil {
		return
	}
	var in codesRowValuesInput
	if err := c.ShouldBindJSON(&in); err != nil || in.Table == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	id, err := a.Svc.CreateCodeRow(c.Request.Context(), user, a.uniCookie(c), in.Table, in.Values)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

// codesUpdateRow edits a row generically (faculty/group/major/course).
func (a *CodesAPI) codesUpdateRow(c *gin.Context) {
	user := a.requireRoles(c, codesEditRoles)
	if user == nil {
		return
	}
	var in codesRowValuesInput
	if err := c.ShouldBindJSON(&in); err != nil || in.Table == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.UpdateCodeRow(c.Request.Context(), user, a.uniCookie(c), in.Table, in.ID, in.Values); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// codesGetDegree reads a degree level for the edit form.
func (a *CodesAPI) codesGetDegree(c *gin.Context) {
	user := a.requireRoles(c, codesViewRoles)
	if user == nil {
		return
	}
	d, err := a.Svc.GetDegreeRow(c.Request.Context(), user, a.uniCookie(c), codesQueryID(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"degree": d}})
}

// codesUpdateDegree edits a degree level — all fields of the create form.
func (a *CodesAPI) codesUpdateDegree(c *gin.Context) {
	user := a.requireRoles(c, codesEditRoles)
	if user == nil {
		return
	}
	var in codesRowValuesInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.UpdateDegreeRow(c.Request.Context(), user, a.uniCookie(c), in.ID, in.Values); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// codesGetTerm reads a term for the schedule edit form.
func (a *CodesAPI) codesGetTerm(c *gin.Context) {
	user := a.requireRoles(c, codesViewRoles)
	if user == nil {
		return
	}
	row, err := a.Svc.GetTermRow(c.Request.Context(), user, a.uniCookie(c), codesQueryID(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"term": row}})
}

// codesUpdateTerm edits the term schedule — in Next it is open to read roles
// (requireRole(['ADMIN','VICE_EDU','EDU_EXPERT'])) — preserved exactly.
func (a *CodesAPI) codesUpdateTerm(c *gin.Context) {
	user := a.requireRoles(c, codesViewRoles)
	if user == nil {
		return
	}
	var in codesRowValuesInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.UpdateTermRow(c.Request.Context(), user, a.uniCookie(c), in.ID, in.Values); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// codesDelete deletes a reference record (only when unused).
func (a *CodesAPI) codesDelete(c *gin.Context) {
	user := a.requireRoles(c, codesEditRoles)
	if user == nil {
		return
	}
	var in codesRowValuesInput
	if err := c.ShouldBindJSON(&in); err != nil || in.Table == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "بدنهٔ درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.DeleteCodeRow(c.Request.Context(), user, a.uniCookie(c), in.Table, in.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
