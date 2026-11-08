// ═══ /api/v2/admin/backup — ADMIN-only backup endpoints ═══
//
// Port of the Next.js backup actions (afagh-next/src/app/admin/settings/
// backup-actions.ts) plus the streaming download route, following the same
// session idioms as admin.go: session.ReadToken(parseCookies(...)) +
// Store.Get, checked inline in every handler.
package httpapi

import (
	"io"
	"net/http"
	"net/url"
	"strconv"

	"github.com/gin-gonic/gin"

	"backend-go/internal/backup"
	"backend-go/internal/middleware"
	"backend-go/internal/session"
)

// BackupAPI exposes the backup service over HTTP. Store is the session store;
// Svc is wired from the app graph (see .zcode/notes/backup.md).
type BackupAPI struct {
	Svc   *backup.Service
	Store *session.Store
}

// Register mounts the admin backup routes on any gin router group.
func (b *BackupAPI) Register(r gin.IRouter) {
	r.POST("/admin/backup/start", b.start)
	r.GET("/admin/backup/status/:jobId", b.status)
	r.GET("/admin/backup/list", b.list)
	r.GET("/admin/backup/download/:jobId", b.download)
	r.POST("/admin/backup/verify/:jobId", b.verify)
}

// requirePlatformAdmin authenticates the caller and enforces the ADMIN role
// (the backup/restore surface is platform-admin only, like the reference).
// Responses are Persian, no-redirect, so the SPA can show them directly.
func (b *BackupAPI) requirePlatformAdmin(c *gin.Context) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" || !session.ValidTokenShape(token) {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	user, _ := b.Store.Get(c.Request.Context(), token, false)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	if !hasRole(user, "ADMIN") {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "این عملیات فقط برای مدیر سامانه مجاز است."})
		return nil
	}
	return user
}

type backupStartBody struct {
	IncludeFiles   bool `json:"includeFiles"`
	IncludeSecrets bool `json:"includeSecrets"`
}

// start launches a database dump job (and optionally a MinIO bundle job) in
// the background; the response returns immediately with the jobId(s).
func (b *BackupAPI) start(c *gin.Context) {
	user := b.requirePlatformAdmin(c)
	if user == nil {
		return
	}
	var body backupStartBody
	// Untrusted input: an empty/invalid body simply means "defaults".
	_ = c.ShouldBindJSON(&body)
	// Non-ADMIN callers were already rejected; untrusted booleans are still
	// only ever able to widen the backup, never to touch other routes.
	jobID, filesID, err := b.Svc.StartDump(c.Request.Context(), backup.Options{
		IncludeFiles:   body.IncludeFiles,
		IncludeSecrets: body.IncludeSecrets,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "آغاز پشتیبانگیری ناموفق بود."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "jobId": jobID, "filesJobId": filesID})
}

func (b *BackupAPI) status(c *gin.Context) {
	user := b.requirePlatformAdmin(c)
	if user == nil {
		return
	}
	job, err := b.Svc.JobStatus(c.Param("jobId"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "job": job})
}

func (b *BackupAPI) list(c *gin.Context) {
	user := b.requirePlatformAdmin(c)
	if user == nil {
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "jobs": b.Svc.ListJobs()})
}

// download streams the finished artifact (gzip) straight from disk with a
// Content-Disposition attachment header — no full-file buffering.
func (b *BackupAPI) download(c *gin.Context) {
	user := b.requirePlatformAdmin(c)
	if user == nil {
		return
	}
	f, name, size, err := b.Svc.ReadDumpFile(c.Param("jobId"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": err.Error()})
		return
	}
	defer f.Close()

	middleware.NoStore(c.Writer)
	c.Header("Content-Type", "application/gzip")
	c.Header("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(name))
	c.Header("Content-Length", strconv.FormatInt(size, 10))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, f)
}

// verify recomputes the HMAC of the stored dump and reports the verdict.
func (b *BackupAPI) verify(c *gin.Context) {
	user := b.requirePlatformAdmin(c)
	if user == nil {
		return
	}
	if err := b.Svc.VerifyDump(c.Param("jobId")); err != nil {
		// ok stays true: the request succeeded, the signature did not.
		c.JSON(http.StatusOK, gin.H{"ok": true, "valid": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "valid": true})
}
