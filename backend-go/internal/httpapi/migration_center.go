// ═══ Data migration, stocks and Thamin endpoints ═══
package httpapi

import (
	"encoding/base64"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
	"backend-go/internal/session"
)

var migrationAdminRoles = []string{"ADMIN"}

func (a *MigrationAdminAPI) require(c *gin.Context) *session.User {
	return a.Admin.requireRoles(c, migrationAdminRoles)
}

// MigrationAdminAPI migration/stocks/Thamin handlers (ADMIN only).
type MigrationAdminAPI struct {
	Admin *AdminAPI
}

func (a *MigrationAdminAPI) Register(r gin.IRouter) {
	g := r.Group("")
	m := a
	// ── Migration ──
	g.GET("/admin/migration/overview", m.migrationOverview)
	g.GET("/admin/migration/sources", m.migrationSources)
	g.POST("/admin/migration/sources", m.migrationSourceSave)
	g.GET("/admin/migration/batches", m.migrationBatches)
	g.POST("/admin/migration/import", m.migrationImport)
	g.POST("/admin/migration/reprocess", m.migrationReprocess)
	g.POST("/admin/migration/batch/delete", m.migrationBatchDelete)
	g.GET("/admin/migration/batch/rows", m.migrationBatchRows)
	g.GET("/admin/migration/grades/compare", m.migrationGradesCompare)
	g.POST("/admin/migration/grades/apply", m.migrationGradesApply)
	g.POST("/admin/migration/grades/clear", m.migrationGradesClear)
	g.GET("/admin/migration/grades/stats", m.migrationGradesStats)
	g.GET("/admin/migration/codemap", m.migrationCodeMap)
	g.POST("/admin/migration/codemap/save", m.migrationCodeMapSave)
	g.POST("/admin/migration/codemap/new-code", m.migrationCodeMapNewCode)
	g.POST("/admin/migration/codemap/auto-suggest", m.migrationCodeMapAutoSuggest)
	g.POST("/admin/migration/codemap/confirm", m.migrationCodeMapConfirm)
	g.POST("/admin/migration/codemap/add", m.migrationCodeMapAdd)
	g.GET("/admin/migration/formulas", m.migrationFormulas)
	g.POST("/admin/migration/formulas/compare", m.migrationFormulasCompare)
	g.POST("/admin/migration/formulas/apply", m.migrationFormulasApply)
	g.POST("/admin/migration/formulas/accept-balance", m.migrationFormulasAcceptBalance)
	g.GET("/admin/migration/audit", m.migrationAudit)
	g.POST("/admin/migration/rollback", m.migrationRollback)
	// ── Stocks ──
	g.GET("/admin/saham", m.sahamDashboard)
	g.GET("/admin/saham/settings", m.sahamSettings)
	g.POST("/admin/saham/settings", m.sahamSettingsSave)
	g.POST("/admin/saham/settings/delete", m.sahamSettingsDelete)
	g.POST("/admin/saham/export", m.sahamExport)
	// ── Thamin ──
	g.GET("/admin/samin", m.saminOverview)
	g.POST("/admin/samin/enqueue", m.saminEnqueue)
	g.POST("/admin/samin/send", m.saminSend)
	g.POST("/admin/samin/sample", m.saminSample)
	g.POST("/admin/samin/trace", m.saminTrace)
}

// ── Migration ──

func (a *MigrationAdminAPI) migrationOverview(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	res, err := a.Admin.Svc.MigrationOverview(c.Request.Context(), c.Query("sourceCode"))
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *MigrationAdminAPI) migrationSources(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	rows, err := a.Admin.Svc.ListSources(c.Request.Context())
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"sources": rows}})
}

func (a *MigrationAdminAPI) migrationSourceSave(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct{ Code, Title, Kind, Note string }
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Admin.Svc.SaveMigrationSource(in); err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *MigrationAdminAPI) migrationBatches(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	rows, err := a.Admin.Svc.ListMigrationBatches(c.Request.Context(), c.Query("sourceCode"))
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"batches": rows}})
}

func (a *MigrationAdminAPI) migrationImport(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "فایل داده را انتخاب کنید."})
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, 20<<20))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خواندن فایل ناموفق بود."})
		return
	}
	columnMap := map[string]int{}
	for k, v := range c.Request.MultipartForm.Value {
		if idx, err := strconv.Atoi(v[0]); err == nil && strings.HasPrefix(k, "col_") {
			columnMap[strings.TrimPrefix(k, "col_")] = idx
		}
	}
	content := string(raw)
	if strings.Contains(header.Filename, ".xlsx") || strings.Contains(header.Filename, ".xls") {
		content = base64.StdEncoding.EncodeToString(raw)
	}
	rep, err := a.Admin.Svc.MigrationImport(c.Request.Context(), user, c.PostForm("kind"), c.PostForm("sourceCode"), header.Filename, content, columnMap)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": rep})
}

func (a *MigrationAdminAPI) migrationReprocess(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		BatchID int64 `json:"batchId"`
		All     bool  `json:"all"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.BatchID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ دسته نامعتبر است."})
		return
	}
	rep, ins, upd, inv, err := a.Admin.Svc.ReprocessMigrationBatch(c.Request.Context(), in.BatchID, in.All)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"reprocessed": rep, "inserted": ins, "updated": upd, "invalid": inv}})
}

func (a *MigrationAdminAPI) migrationBatchDelete(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct {
		BatchID int64 `json:"batchId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.BatchID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ دسته نامعتبر است."})
		return
	}
	if err := a.Admin.Svc.DeleteMigrationBatch(c.Request.Context(), in.BatchID); err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *MigrationAdminAPI) migrationBatchRows(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	batchID, _ := strconv.ParseInt(c.Query("batchId"), 10, 64)
	rows, err := a.Admin.Svc.MigrationBatchRows(c.Request.Context(), batchID, c.Query("status"))
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"rows": rows}})
}

func (a *MigrationAdminAPI) migrationGradesCompare(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	res, err := a.Admin.Svc.CompareMigrationGrades(c.Request.Context(), c.Query("sourceCode"), c.Query("termCode"))
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *MigrationAdminAPI) migrationGradesApply(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		SourceCode string   `json:"sourceCode"`
		TermCode   string   `json:"termCode"`
		Statuses   []string `json:"statuses"`
		Overwrite  bool     `json:"overwrite"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res, err := a.Admin.Svc.ApplyMigrationGrades(c.Request.Context(), user, in.SourceCode, in.TermCode, in.Statuses, in.Overwrite)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *MigrationAdminAPI) migrationGradesClear(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	n, err := a.Admin.Svc.ClearMigrationGradeStaging(c.Request.Context(), c.Query("sourceCode"))
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"deleted": n}})
}

func (a *MigrationAdminAPI) migrationGradesStats(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	rows, err := a.Admin.Svc.MigrationGradeStats(c.Request.Context(), c.Query("sourceCode"))
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"stats": rows}})
}

func (a *MigrationAdminAPI) migrationCodeMap(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	maps, options, stats, err := a.Admin.Svc.ListMigrationCodeMaps(c.Request.Context(), c.Query("sourceCode"), c.Query("domain"))
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"maps": maps, "options": options, "stats": stats}})
}

func (a *MigrationAdminAPI) migrationCodeMapSave(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		ID         int64   `json:"id"`
		TargetCode *string `json:"targetCode"`
		Status     string  `json:"status"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Admin.Svc.SaveMigrationMap(c.Request.Context(), user, in.ID, in.TargetCode, in.Status); err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *MigrationAdminAPI) migrationCodeMapNewCode(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		ID      int64  `json:"id"`
		NewCode string `json:"newCode"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Admin.Svc.SetMigrationNewCode(c.Request.Context(), user, in.ID, in.NewCode); err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *MigrationAdminAPI) migrationCodeMapAutoSuggest(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	suggested, confirmed, untouched, err := a.Admin.Svc.MigAutoSuggest(c.Request.Context(), c.Query("sourceCode"), c.Query("domain"))
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"suggested": suggested, "confirmed": confirmed, "untouched": untouched}})
}

func (a *MigrationAdminAPI) migrationCodeMapConfirm(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		SourceCode string `json:"sourceCode"`
		Domain     string `json:"domain"`
		MinScore   int    `json:"minScore"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	n, err := a.Admin.Svc.MigConfirmSuggestions(c.Request.Context(), user, in.SourceCode, in.Domain, in.MinScore)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"confirmed": n}})
}

func (a *MigrationAdminAPI) migrationCodeMapAdd(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct {
		SourceCode string `json:"sourceCode"`
		Domain     string `json:"domain"`
		LegacyCode string `json:"legacyCode"`
		LegacyTite string `json:"legacyTitle"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	if err := a.Admin.Svc.MigAddCode(c.Request.Context(), in.SourceCode, in.Domain, in.LegacyCode, in.LegacyTite); err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *MigrationAdminAPI) migrationFormulas(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	rows, err := a.Admin.Svc.ListMigrationFormulas(c.Request.Context(), c.Query("sourceCode"))
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"formulas": rows}})
}

func (a *MigrationAdminAPI) migrationFormulasCompare(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		SourceCode string  `json:"sourceCode"`
		TermCode   string  `json:"termCode"`
		Tolerance  float64 `json:"tolerance"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res, err := a.Admin.Svc.RunMigrationTuitionCompare(c.Request.Context(), user, in.SourceCode, in.TermCode, in.Tolerance)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *MigrationAdminAPI) migrationFormulasApply(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		SourceCode string `json:"sourceCode"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	applied, skipped, err := a.Admin.Svc.ApplyMigrationFormulas(c.Request.Context(), user, in.SourceCode)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"applied": applied, "skipped": skipped}})
}

func (a *MigrationAdminAPI) migrationFormulasAcceptBalance(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		SourceCode string `json:"sourceCode"`
		TermCode   string `json:"termCode"`
		RunID      int64  `json:"runId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res, err := a.Admin.Svc.AcceptMigrationLegacyBalance(c.Request.Context(), user, in.SourceCode, in.TermCode, in.RunID)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *MigrationAdminAPI) migrationAudit(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var batchID *int64
	if v := c.Query("batchId"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			batchID = &n
		}
	}
	rows, err := a.Admin.Svc.MigAuditSummary(c.Request.Context(), batchID, c.Query("opGroup"), c.Query("sourceCode"))
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	groups, _ := a.Admin.Svc.MigAuditGroups(c.Request.Context(), c.Query("sourceCode"))
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"summary": rows, "groups": groups}})
}

func (a *MigrationAdminAPI) migrationRollback(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		BatchID *int64 `json:"batchId"`
		OpGroup string `json:"opGroup"`
		Source  string `json:"sourceCode"`
		Force   bool   `json:"force"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	res, err := a.Admin.Svc.RollbackMigrationBatch(c.Request.Context(), in.BatchID, in.OpGroup, in.Source, in.Force, user.ID)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

// ── Stocks ──

func (a *MigrationAdminAPI) sahamDashboard(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	stats, err := a.Admin.Svc.GetSahamStats(c.Request.Context())
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	lookups, err := a.Admin.Svc.GetSahamLookups(c.Request.Context())
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	totalStudents, totalGrads, totalInst := 0, 0, 0
	withCode := 0
	for _, s := range stats {
		totalStudents += s.Students
		totalGrads += s.Graduates
		totalInst += s.Instructors
		if s.SahamCodeCount > 0 {
			withCode++
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{
		"stats": stats, "lookups": lookups,
		"totals": gin.H{"students": totalStudents, "graduates": totalGrads, "instructors": totalInst, "withCode": withCode},
	}})
}

func (a *MigrationAdminAPI) sahamSettings(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	res, err := a.Admin.Svc.SahamSettingsBundle(c.Request.Context())
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *MigrationAdminAPI) sahamSettingsSave(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in admin.SahamInstituteCodeInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	id, err := a.Admin.Svc.SahamSaveInstituteCode(c.Request.Context(), in)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"id": id}})
}

func (a *MigrationAdminAPI) sahamSettingsDelete(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه نامعتبر است."})
		return
	}
	if err := a.Admin.Svc.SahamDeleteInstituteCode(c.Request.Context(), in.ID); err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *MigrationAdminAPI) sahamExport(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	var in struct {
		Kind         string `json:"kind"`
		UniversityID int64  `json:"universityId"`
		All          bool   `json:"all"`
		MajorID      int64  `json:"majorId"`
		FacultyID    int64  `json:"facultyId"`
		Status       string `json:"status"`
		TermID       int64  `json:"termId"`
		EntryYear    int64  `json:"entryYear"`
		EntryYearTo  int64  `json:"entryYearTo"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اطلاعات نامعتبر."})
		return
	}
	var entryTo *int
	if in.EntryYearTo > 0 {
		v := int(in.EntryYearTo)
		entryTo = &v
	}
	f := admin.SahamStudentFilters{
		MajorID: in.MajorID, FacultyID: in.FacultyID,
		Status: in.Status, TermID: in.TermID, EntryTo: entryTo,
	}
	if in.EntryYear > 0 {
		v := int(in.EntryYear)
		f.EntryFrom = &v
	}
	var uniIDs []int64
	if in.All {
		uniIDs = a.Admin.Svc.SahamAuthorizer(c.Request.Context(), user, a.Admin.uniCookie(c))
	} else {
		uniIDs = []int64{in.UniversityID}
	}
	res, err := a.Admin.Svc.SahamBuildWorkbook(c.Request.Context(), uniIDs, admin.SahamKind(in.Kind), f)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

// ── Thamin ──

func (a *MigrationAdminAPI) saminOverview(c *gin.Context) {
	user := a.require(c)
	if user == nil {
		return
	}
	res, err := a.Admin.Svc.SaminOverview(c.Request.Context(), user, a.Admin.uniCookie(c), c.Query("uni"))
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *MigrationAdminAPI) saminEnqueue(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct {
		UniversityID int64 `json:"universityId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.UniversityID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ دانشگاه نامعتبر است."})
		return
	}
	inserted, skipped, err := a.Admin.Svc.SaminEnqueue(c.Request.Context(), in.UniversityID)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"inserted": inserted, "skipped": skipped}})
}

func (a *MigrationAdminAPI) saminSend(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct {
		UniversityID int64  `json:"universityId"`
		EntityCode   string `json:"entityCode"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.UniversityID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ دانشگاه نامعتبر است."})
		return
	}
	entity := in.EntityCode
	if entity == "" {
		entity = "1000"
	}
	res, err := a.Admin.Svc.SaminSendRows(c.Request.Context(), in.UniversityID, entity)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *MigrationAdminAPI) saminSample(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct {
		UniversityID int64 `json:"universityId"`
		Count        int   `json:"count"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.UniversityID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ دانشگاه نامعتبر است."})
		return
	}
	if in.Count <= 0 {
		in.Count = 2
	}
	res, err := a.Admin.Svc.SaminSendSampleGraduates(c.Request.Context(), in.UniversityID, in.Count)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *MigrationAdminAPI) saminTrace(c *gin.Context) {
	if a.require(c) == nil {
		return
	}
	var in struct {
		UniversityID int64 `json:"universityId"`
		TraceID      int64 `json:"traceId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.UniversityID <= 0 || in.TraceID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ دانشگاه یا رهگیری نامعتبر است."})
		return
	}
	res, err := a.Admin.Svc.SaminTrace(c.Request.Context(), in.UniversityID, in.TraceID)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}
