// ═══ Report builder (Wave 2) — saved reports endpoints ═══
//
// Ports the server actions of admin/reports/saved (list/save/delete/run) plus
// the sources catalog + preview used by the builder page. Session/role gating
// follows the same requireAdmin-style idiom as admin.go / reports.go.
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/reports"
	"backend-go/internal/scope"
	"backend-go/internal/session"
)

// ReportsBuilderAPI serves the report-builder (saved reports) endpoints.
type ReportsBuilderAPI struct {
	Pool  *pgxpool.Pool
	Store *session.Store
	Scope *scope.Service
	Svc   *reports.BuilderService
}

// NewReportsBuilderAPI constructs the API with its engine.
func NewReportsBuilderAPI(pool *pgxpool.Pool, store *session.Store, sc *scope.Service) *ReportsBuilderAPI {
	return &ReportsBuilderAPI{
		Pool: pool, Store: store, Scope: sc,
		Svc: reports.NewBuilder(pool, sc),
	}
}

// Register wires the builder routes (called from app wiring; see
// .zcode/notes/report-builder.md for the exact snippet).
func (b *ReportsBuilderAPI) Register(r gin.IRouter) {
	r.GET("/admin/reports/saved", b.list)
	r.POST("/admin/reports/saved", b.save)
	r.POST("/admin/reports/saved/:id/delete", b.remove)
	r.POST("/admin/reports/saved/:id/run", b.run)
	r.POST("/admin/reports/preview", b.preview)
	r.GET("/admin/reports/sources", b.sources)
}

// ─────────────────── gates + helpers ───────────────────

func (b *ReportsBuilderAPI) requireRoles(c *gin.Context, roles []string, denyMsg string) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	user, _ := b.Store.Get(c.Request.Context(), token, false)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	allowed := false
	for _, r := range user.Roles {
		for _, want := range roles {
			if r == want {
				allowed = true
			}
		}
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": denyMsg})
		return nil
	}
	return user
}

// requireRunner — same RUNNER_ROLES as actions.ts.
func (b *ReportsBuilderAPI) requireRunner(c *gin.Context) *session.User {
	return b.requireRoles(c, []string{
		"ADMIN", "EDU_EXPERT", "ARCHIVE_EXPERT", "MILITARY_OFFICER",
		"FINANCE_EXPERT", "FINANCE", "CASHIER",
	}, "دسترسی به گزارش‌های ذخیره‌شده مجاز نیست.")
}

// requireBuilder — same BUILDER_ROLES as actions.ts.
func (b *ReportsBuilderAPI) requireBuilder(c *gin.Context) *session.User {
	return b.requireRoles(c, []string{"ADMIN", "EDU_EXPERT", "FINANCE_EXPERT", "FINANCE"},
		"دسترسی به گزارش‌ساز مجاز نیست.")
}

func (b *ReportsBuilderAPI) uniCookieOf(c *gin.Context) string {
	if v, err := c.Cookie(scope.UniversityCookie); err == nil {
		return v
	}
	return ""
}

func (b *ReportsBuilderAPI) fail(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
}

func (b *ReportsBuilderAPI) pathID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ گزارش نامعتبر است."})
		return 0, false
	}
	return id, true
}

// ─────────────────── handlers ───────────────────

func (b *ReportsBuilderAPI) list(c *gin.Context) {
	user := b.requireRunner(c)
	if user == nil {
		return
	}
	if b.Svc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "سرویس گزارش‌ساز در دسترس نیست."})
		return
	}
	rows, err := b.Svc.ListSaved(c.Request.Context(), user, b.uniCookieOf(c))
	if err != nil {
		b.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "rows": rows})
}

func (b *ReportsBuilderAPI) save(c *gin.Context) {
	user := b.requireBuilder(c)
	if user == nil {
		return
	}
	if b.Svc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "سرویس گزارش‌ساز در دسترس نیست."})
		return
	}
	var in reports.BuilderSaveInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	id, err := b.Svc.SaveSaved(c.Request.Context(), user, b.uniCookieOf(c), &in)
	if err != nil {
		b.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id})
}

func (b *ReportsBuilderAPI) remove(c *gin.Context) {
	user := b.requireBuilder(c)
	if user == nil {
		return
	}
	if b.Svc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "سرویس گزارش‌ساز در دسترس نیست."})
		return
	}
	id, ok := b.pathID(c)
	if !ok {
		return
	}
	if err := b.Svc.DeleteSaved(c.Request.Context(), user, b.uniCookieOf(c), id); err != nil {
		b.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (b *ReportsBuilderAPI) run(c *gin.Context) {
	user := b.requireRunner(c)
	if user == nil {
		return
	}
	if b.Svc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "سرویس گزارش‌ساز در دسترس نیست."})
		return
	}
	id, ok := b.pathID(c)
	if !ok {
		return
	}
	// page is optional — an empty body means page 1
	var in struct {
		Page int `json:"page"`
	}
	_ = c.ShouldBindJSON(&in)
	res, err := b.Svc.RunSaved(c.Request.Context(), user, b.uniCookieOf(c), id, in.Page)
	if err != nil {
		b.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (b *ReportsBuilderAPI) preview(c *gin.Context) {
	user := b.requireBuilder(c)
	if user == nil {
		return
	}
	if b.Svc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "سرویس گزارش‌ساز در دسترس نیست."})
		return
	}
	var in struct {
		SourceKey string                `json:"sourceKey"`
		Config    reports.SavedReportConfig `json:"config"`
		Page      int                   `json:"page"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res, err := b.Svc.PreviewSaved(c.Request.Context(), user, b.uniCookieOf(c), in.SourceKey, &in.Config, in.Page)
	if err != nil {
		b.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

// sources serves the code-defined catalog (SQL-free) + dynamic filter options.
func (b *ReportsBuilderAPI) sources(c *gin.Context) {
	user := b.requireBuilder(c)
	if user == nil {
		return
	}
	if b.Svc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "سرویس گزارش‌ساز در دسترس نیست."})
		return
	}
	uniID, err := b.Svc.UniversityIDForOptions(c.Request.Context(), user, b.uniCookieOf(c))
	if err != nil {
		b.fail(c, err)
		return
	}
	opts, err := b.Svc.CatalogOptions(c.Request.Context(), uniID)
	if err != nil {
		b.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "sources": reports.BuilderSourceMetas(), "options": opts})
}
