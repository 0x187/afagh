// ═══ Admin panel endpoints (phase 6) ═══
package httpapi

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

func (a *AdminAPI) archiveDocuments(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.ListArchiveDocuments(c.Request.Context(), user, a.uniCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *AdminAPI) archiveVerify(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	allowed := false
	for _, r := range user.Roles {
		if r == "ADMIN" || r == "ARCHIVE_EXPERT" {
			allowed = true
		}
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی غیرمجاز"})
		return
	}
	var body struct {
		DocID    int64  `json:"docId"`
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.DocID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "پارامتر ناقص"})
		return
	}
	if err := a.Svc.VerifyArchiveDoc(c.Request.Context(), user, a.uniCookie(c), body.DocID, body.Decision, body.Reason); err != nil {
		a.fail(c, err)
		return
	}
	dec := "VERIFIED"
	if body.Decision == "REJECTED" {
		dec = "REJECTED"
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"docId": body.DocID, "decision": dec}})
}

func (a *AdminAPI) archiveUpload(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "فایل ارسال نشد"})
		return
	}
	if file.Size > 10*1024*1024 {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"ok": false, "error": "حجم بیش از ۱۰MB"})
		return
	}
	f, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "فایل نامعتبر است"})
		return
	}
	defer f.Close()
	data := make([]byte, file.Size)
	if _, err := f.Read(data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خواندن فایل ناموفق بود"})
		return
	}
	in := admin.ArchiveUploadInput{
		FileName: file.Filename, ClaimedType: file.Header.Get("Content-Type"), Data: data,
	}
	in.StudentUserID, _ = strconv.ParseInt(c.PostForm("studentUserId"), 10, 64)
	in.CategoryID, _ = strconv.ParseInt(c.PostForm("categoryId"), 10, 64)
	if raw := strings.TrimSpace(c.PostForm("typeId")); raw != "" {
		if v, err := strconv.ParseInt(raw, 10, 64); err == nil && v > 0 {
			in.TypeID = &v
		}
	}
	if in.StudentUserID <= 0 || in.CategoryID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "پارامتر ناقص"})
		return
	}
	id, err := a.Svc.UploadArchiveDocument(c.Request.Context(), user, a.uniCookie(c), a.Archive, in)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"docId": id}})
}

// archiveFile securely serves a file — only allowed types render, the rest as attachment.

func (a *AdminAPI) archiveFile(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	if a.Archive == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "بایگانی پیکربندی نشده است."})
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ سند نامعتبر است."})
		return
	}
	doc, err := a.Svc.GetArchiveDocForDownload(c.Request.Context(), user, a.uniCookie(c), id)
	if err != nil {
		a.fail(c, err)
		return
	}
	data, storedMime, err := a.Archive.Get(c.Request.Context(), doc.Key)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "فایل در بایگانی یافت نشد."})
		return
	}
	safeMime := map[string]bool{
		"image/jpeg": true, "image/png": true, "image/webp": true, "image/gif": true, "image/bmp": true, "application/pdf": true,
	}
	mime := strings.ToLower(doc.MimeType)
	if mime == "" {
		mime = strings.ToLower(storedMime)
	}
	forceDownload := !safeMime[mime]
	if !safeMime[mime] {
		mime = "application/octet-stream"
	}
	disp := "inline"
	if forceDownload {
		disp = "attachment"
	}
	c.Header("X-Watermark", url.QueryEscape(user.Name+" | "+time.Now().UTC().Format(time.RFC3339)))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:")
	c.Header("Content-Disposition", fmt.Sprintf("%s; filename*=UTF-8''%s", disp, url.PathEscape(doc.FileName)))
	c.Header("Cache-Control", "private, max-age=300")
	c.Data(http.StatusOK, mime, data)
}

// ─────────────────── Semester coefficients + subject amounts ───────────────────
