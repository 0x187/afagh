// ═══ Sanjesh conversion drill-down HTTP layer — self-contained registration ═══
//
// Port of the server actions of admin/sanjesh/[id]/* and admin/sanjesh/templates/*.
// Routes (all under the /api/v2 group that calls RegisterSanjeshDrilldown):
//
//	GET  /admin/sanjesh/files/:id/fields                — file + counters + mapping rows
//	POST /admin/sanjesh/files/:id/field-mapping         — {updates:[{colIndex,target}]} + remap
//	POST /admin/sanjesh/files/:id/field-mapping/auto    — apply the template mapping
//	GET  /admin/sanjesh/files/:id/rows                  — ?q&status&page (50/page)
//	GET  /admin/sanjesh/files/:id/rows/:rowId           — every stored column + raw line
//	POST /admin/sanjesh/files/:id/rows/:rowId/status    — {status: PENDING|IGNORED|INVALID}
//	GET  /admin/sanjesh/files/:id/matched               — ready rows (≤300) + staged count
//	POST /admin/sanjesh/files/:id/stage                 — stage valid rows to admissions
//	GET  /admin/sanjesh/files/:id/enrolled              — admissions_staging rows (≤500)
//	GET  /admin/sanjesh/files/:id/values                — decode table rows
//	POST /admin/sanjesh/files/:id/value-maps            — upsert {field, sanjeshValue, ...}
//	POST /admin/sanjesh/files/:id/value-maps/delete     — {id}
//	POST /admin/sanjesh/files/:id/value-maps/seed-from-template
//	GET  /admin/sanjesh/templates                       — list (DB + builtin fallback)
//	GET  /admin/sanjesh/templates/detail/:key           — editor bundle (template + db id/builtin)
//	POST /admin/sanjesh/templates/seed                  — idempotent builtin seeding
//	POST /admin/sanjesh/templates/clone                 — {sourceKey, newKey, title, examYear}
//	POST /admin/sanjesh/templates/save                  — create/update + columns
//	POST /admin/sanjesh/templates/build-from-file       — multipart survey of a sample file
//
// NOTE: /admin/sanjesh/preview and /admin/sanjesh/commit (previous-major import)
// stay registered in admin.go's Register; no path overlaps with them.
package httpapi

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

// urlPathUnescape decodes a path parameter (template keys are ASCII, but be safe).
func urlPathUnescape(v string) (string, error) {
	return url.PathUnescape(v)
}

// sanjeshDrilldownRoles — the reference pages require ADMIN or EDU_EXPERT.
var sanjeshDrilldownRoles = []string{"ADMIN", "EDU_EXPERT"}

// RegisterSanjeshDrilldown registers the sanjesh conversion drill-down
// endpoints. Call it next to the other Register* calls in internal/app/http.go.
func (a *AdminAPI) RegisterSanjeshDrilldown(r gin.IRouter) {
	// files/:id/*
	r.GET("/admin/sanjesh/files/:id/fields", a.sanjeshFieldsView)
	r.POST("/admin/sanjesh/files/:id/field-mapping", a.sanjeshSaveFieldMapping)
	r.POST("/admin/sanjesh/files/:id/field-mapping/auto", a.sanjeshAutoMapFields)
	r.GET("/admin/sanjesh/files/:id/rows", a.sanjeshRowsView)
	r.GET("/admin/sanjesh/files/:id/rows/:rowId", a.sanjeshRowDetail)
	r.POST("/admin/sanjesh/files/:id/rows/:rowId/status", a.sanjeshSetRowStatus)
	r.POST("/admin/sanjesh/files/:id/run-match", a.sanjeshRunMatch)
	r.GET("/admin/sanjesh/files/:id/matched", a.sanjeshMatchedView)
	r.POST("/admin/sanjesh/files/:id/stage", a.sanjeshStageMatched)
	r.GET("/admin/sanjesh/files/:id/enrolled", a.sanjeshEnrolledView)
	r.GET("/admin/sanjesh/files/:id/values", a.sanjeshValuesView)
	r.POST("/admin/sanjesh/files/:id/value-maps", a.sanjeshSaveValueMap)
	r.POST("/admin/sanjesh/files/:id/value-maps/delete", a.sanjeshDeleteValueMap)
	r.POST("/admin/sanjesh/files/:id/value-maps/seed-from-template", a.sanjeshSeedValueMaps)

	// templates/*
	r.GET("/admin/sanjesh/templates", a.sanjeshTemplatesList)
	r.GET("/admin/sanjesh/templates/detail/:key", a.sanjeshTemplateDetail)
	r.POST("/admin/sanjesh/templates/seed", a.sanjeshTemplatesSeed)
	r.POST("/admin/sanjesh/templates/clone", a.sanjeshTemplateClone)
	r.POST("/admin/sanjesh/templates/save", a.sanjeshTemplateSave)
	r.POST("/admin/sanjesh/templates/build-from-file", a.sanjeshTemplateBuildFromFile)
}

// sanjeshFileID parses the :id path parameter.
func sanjeshFileID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ فایل نامعتبر است."})
		return 0, false
	}
	return id, true
}

// ── fields page ──

func (a *AdminAPI) sanjeshFieldsView(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	view, err := a.Svc.SanjeshFieldsView(c.Request.Context(), user, a.uniCookie(c), fileID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": view})
}

func (a *AdminAPI) sanjeshSaveFieldMapping(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	var body struct {
		Updates []admin.SanjeshFieldMappingUpdate `json:"updates"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res, err := a.Svc.SanjeshSaveFieldMapping(c.Request.Context(), user, a.uniCookie(c), fileID, body.Updates)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": res["message"], "data": res})
}

func (a *AdminAPI) sanjeshAutoMapFields(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	res, err := a.Svc.SanjeshAutoMapFields(c.Request.Context(), user, a.uniCookie(c), fileID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": res["message"], "data": res})
}

// ── rows pages ──

func (a *AdminAPI) sanjeshRowsView(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	view, err := a.Svc.SanjeshRowsView(c.Request.Context(), user, a.uniCookie(c),
		strings.TrimSpace(c.Query("q")), strings.TrimSpace(c.Query("status")), int(fileID), page)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": view})
}

func (a *AdminAPI) sanjeshRowDetail(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	rowID, err := strconv.ParseInt(c.Param("rowId"), 10, 64)
	if err != nil || rowID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ ردیف نامعتبر است."})
		return
	}
	detail, err := a.Svc.SanjeshRowDetail(c.Request.Context(), user, a.uniCookie(c), fileID, rowID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": detail})
}

func (a *AdminAPI) sanjeshSetRowStatus(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	rowID, err := strconv.ParseInt(c.Param("rowId"), 10, 64)
	if err != nil || rowID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ ردیف نامعتبر است."})
		return
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	status := strings.TrimSpace(body.Status)
	if status == "" {
		status = "PENDING"
	}
	if err := a.Svc.SanjeshSetRowStatus(c.Request.Context(), user, a.uniCookie(c), fileID, rowID, status); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "وضعیت ردیف به‌روزرسانی شد."})
}

// sanjeshRunMatch ports runMatchAction — match pending rows against students.
func (a *AdminAPI) sanjeshRunMatch(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	res, err := a.Svc.SanjeshRunMatch(c.Request.Context(), user, a.uniCookie(c), fileID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":      true,
		"message": fmt.Sprintf("%v تطبیق یافت · %v بدون تطبیق · %v مبهم", res["matched"], res["unmatched"], res["ambiguous"]),
		"data":    res,
	})
}

// ── matched page ──

func (a *AdminAPI) sanjeshMatchedView(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	view, err := a.Svc.SanjeshMatchedView(c.Request.Context(), user, a.uniCookie(c), fileID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": view})
}

func (a *AdminAPI) sanjeshStageMatched(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	res, err := a.Svc.SanjeshStageMatched(c.Request.Context(), user, a.uniCookie(c), fileID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": res.Message, "data": res})
}

// ── enrolled page ──

func (a *AdminAPI) sanjeshEnrolledView(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	view, err := a.Svc.SanjeshEnrolledView(c.Request.Context(), user, a.uniCookie(c), fileID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": view})
}

// ── values page ──

func (a *AdminAPI) sanjeshValuesView(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	view, err := a.Svc.SanjeshValuesView(c.Request.Context(), user, a.uniCookie(c), fileID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": view})
}

func (a *AdminAPI) sanjeshSaveValueMap(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	var body struct {
		Field         string `json:"field"`
		SanjeshValue  string `json:"sanjeshValue"`
		SanjeshLabel  string `json:"sanjeshLabel"`
		InternalValue string `json:"internalValue"`
		InternalLabel string `json:"internalLabel"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	trimPtr := func(v string) *string {
		v = strings.TrimSpace(v)
		if v == "" {
			return nil
		}
		return &v
	}
	if err := a.Svc.SanjeshSaveValueMap(c.Request.Context(), user, a.uniCookie(c), fileID,
		body.Field, body.SanjeshValue,
		trimPtr(body.SanjeshLabel), trimPtr(body.InternalValue), trimPtr(body.InternalLabel)); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "براورد «" + strings.TrimSpace(body.SanjeshValue) + "» ذخیره شد."})
}

func (a *AdminAPI) sanjeshDeleteValueMap(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SanjeshDeleteValueMap(c.Request.Context(), user, a.uniCookie(c), fileID, body.ID); err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "ردیف براورد حذف شد."})
}

func (a *AdminAPI) sanjeshSeedValueMaps(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	fileID, ok := sanjeshFileID(c)
	if !ok {
		return
	}
	res, err := a.Svc.SanjeshSeedValueMapsFromTemplate(c.Request.Context(), user, a.uniCookie(c), fileID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": res["message"], "data": res})
}

// ── templates ──

func (a *AdminAPI) sanjeshTemplatesList(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	rows, err := a.Svc.SanjeshListTemplates(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"templates": rows}})
}

func (a *AdminAPI) sanjeshTemplateDetail(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))
	if uniID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشگاه فعال نامشخص است."})
		return
	}
	key, err := urlPathUnescape(c.Param("key"))
	if err != nil || strings.TrimSpace(key) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "کلید قالب نامعتبر است."})
		return
	}
	tpl, err := a.Svc.SanjeshLoadTemplateByKey(c.Request.Context(), key, *uniID)
	if err != nil {
		a.fail(c, err)
		return
	}
	dbInfo, err := a.Svc.SanjeshTemplateDBInfo(c.Request.Context(), key, *uniID)
	if err != nil {
		a.fail(c, err)
		return
	}
	if tpl == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "قالب «" + key + "» یافت نشد."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"template": tpl, "db": dbInfo}})
}

func (a *AdminAPI) sanjeshTemplatesSeed(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	res, err := a.Svc.SanjeshSeedBuiltinTemplates(c.Request.Context())
	if err != nil {
		a.fail(c, err)
		return
	}
	msg := strconv.Itoa(res["inserted"]) + " قالب پیش‌فرض درج شد · " + strconv.Itoa(res["skipped"]) + " از قبل موجود بود"
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": msg, "data": res})
}

func (a *AdminAPI) sanjeshTemplateClone(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	var body struct {
		SourceKey string `json:"sourceKey"`
		NewKey    string `json:"newKey"`
		Title     string `json:"title"`
		ExamYear  int    `json:"examYear"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	tpl, err := a.Svc.SanjeshCloneTemplate(c.Request.Context(), user, a.uniCookie(c),
		body.SourceKey, body.NewKey, body.Title, body.ExamYear)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "قالب کپی شد؛ اکنون می‌توانید ستون‌ها را ویرایش کنید.", "data": tpl})
}

func (a *AdminAPI) sanjeshTemplateSave(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	var body admin.SanjeshSaveTemplateInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	tpl, err := a.Svc.SanjeshSaveTemplate(c.Request.Context(), user, a.uniCookie(c), &body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "قالب ذخیره شد.", "data": tpl})
}

// sanjeshTemplateBuildFromFile ports buildTemplateFromFileAction — the column
// count and lengths come from the sample file itself.
func (a *AdminAPI) sanjeshTemplateBuildFromFile(c *gin.Context) {
	user := a.requireRoles(c, sanjeshDrilldownRoles)
	if user == nil {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, admin.SanjeshFileLimit+(2<<20))
	if err := c.Request.ParseMultipartForm(admin.SanjeshFileLimit); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "فایل نمونه انتخاب نشده است."})
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "فایل انتخاب نشده است."})
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, admin.SanjeshFileLimit+1))
	if err != nil || len(raw) > admin.SanjeshFileLimit {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "حجم فایل بیش از حد مجاز است."})
		return
	}
	examYear, _ := strconv.Atoi(strings.TrimSpace(c.PostForm("examYear")))
	tpl, err := a.Svc.SanjeshBuildTemplateFromFile(c.Request.Context(), user, a.uniCookie(c),
		header.Filename,
		strings.TrimSpace(c.PostForm("key")),
		strings.TrimSpace(c.PostForm("title")),
		strings.TrimSpace(c.PostForm("examKind")),
		examYear, raw)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":      true,
		"message": "قالب با " + strconv.Itoa(tpl.ColumnCount) + " ستون ساخته شد؛ فیلدهای مقصد را تعیین کنید.",
		"data":    tpl,
	})
}
