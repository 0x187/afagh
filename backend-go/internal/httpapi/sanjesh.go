// ═══ اندپوینت‌های درون‌ریزی فایل سنجش ═══
package httpapi

import (
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
)

func (a *AdminAPI) sanjeshInput(c *gin.Context) ([]admin.SanjeshColumn, string, bool) {
	user := a.requireRoles(c, regulationRoles)
	if user == nil {
		return nil, "", false
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, admin.SanjeshFileLimit+(2<<20))
	if err := c.Request.ParseMultipartForm(admin.SanjeshFileLimit); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "فایل یا ساختار ارسال نشده است."})
		return nil, "", false
	}
	cols, err := admin.ParseSanjeshColumns(c.PostForm("structure"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return nil, "", false
	}
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "فایل داده را انتخاب کنید."})
		return nil, "", false
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, admin.SanjeshFileLimit+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "خواندن فایل ناموفق بود."})
		return nil, "", false
	}
	if len(raw) > admin.SanjeshFileLimit {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "حجم فایل بیش از حد مجاز است."})
		return nil, "", false
	}
	return cols, string(raw), true
}

func (a *AdminAPI) sanjeshPreview(c *gin.Context) {
	cols, text, ok := a.sanjeshInput(c)
	if !ok {
		return
	}
	rows := admin.ParseFixedWidthText(text, cols)
	sample := rows
	if len(sample) > 15 {
		sample = sample[:15]
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"count": len(rows), "sample": sample}})
}

func (a *AdminAPI) sanjeshCommit(c *gin.Context) {
	user := a.requireRoles(c, regulationRoles)
	if user == nil {
		return
	}
	cols, text, ok := a.sanjeshInput(c)
	if !ok {
		return
	}
	rows := admin.ParseFixedWidthText(text, cols)
	res, err := a.Svc.CommitSanjesh(c.Request.Context(), user, rows)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}
