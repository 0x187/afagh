// ═══ Student card and photo display endpoints ═══
package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/session"
)

var cardRoles = []string{"ADMIN", "EDU_EXPERT"}
var cardPrintRoles = []string{"ADMIN", "EDU_EXPERT", "ARCHIVE_EXPERT", "MILITARY_OFFICER", "GRADUATEAFFAIRS"}
var photoViewerRoles = []string{"ADMIN", "EDU_EXPERT", "ARCHIVE_EXPERT", "VICE_EDU", "DEP_HEAD", "PROCTOR"}

func (a *AdminAPI) requireRoles(c *gin.Context, roles []string) *session.User {
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

func (a *AdminAPI) studentCardsList(c *gin.Context) {
	user := a.requireRoles(c, cardRoles)
	if user == nil {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	res, err := a.Svc.ListStudentCards(c.Request.Context(), user, a.uniCookie(c), c.Query("q"), page)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) studentCardIssue(c *gin.Context) {
	user := a.requireRoles(c, cardRoles)
	if user == nil {
		return
	}
	var in struct {
		StudentID int64 `json:"studentId"`
		Force     bool  `json:"force"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.StudentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه دانشجو نامعتبر است."})
		return
	}
	res, err := a.Svc.IssueStudentCard(c.Request.Context(), user, a.uniCookie(c), in.StudentID, in.Force)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *AdminAPI) studentCardRevoke(c *gin.Context) {
	user := a.requireRoles(c, cardRoles)
	if user == nil {
		return
	}
	var in struct {
		StudentID int64  `json:"studentId"`
		Status    string `json:"status"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.StudentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه دانشجو نامعتبر است."})
		return
	}
	if err := a.Svc.RevokeStudentCard(c.Request.Context(), user, a.uniCookie(c), in.StudentID, in.Status); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *AdminAPI) studentCardPrint(c *gin.Context) {
	if a.requireRoles(c, cardPrintRoles) == nil {
		return
	}
	studentID, _ := strconv.ParseInt(c.Query("studentId"), 10, 64)
	if studentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسه دانشجو نامعتبر است."})
		return
	}
	data, err := a.Svc.StudentCardPrintData(c.Request.Context(), studentID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": data})
}

// photo serves a person's photo from object storage — with the same access rules as TS.
func (a *AdminAPI) photo(c *gin.Context) {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	me, _ := a.Store.Get(c.Request.Context(), token, false)
	if me == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, _ := strconv.ParseInt(c.Param("userId"), 10, 64)
	if userID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "شناسهٔ نامعتبر"})
		return
	}
	privileged := false
	for _, r := range me.Roles {
		for _, want := range photoViewerRoles {
			if r == want {
				privileged = true
			}
		}
	}
	if !privileged && me.ID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	var photoKey, photoMime *string
	var targetUni *int64
	if err := a.Svc.DB.Pool.QueryRow(c.Request.Context(), `
		select to_jsonb(u)->>'photoKey', to_jsonb(u)->>'photoMime', u."universityId" from users u where u.id = $1`, userID).
		Scan(&photoKey, &photoMime, &targetUni); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if me.ID != userID && targetUni != nil && !a.Svc.Scope.CanActOnUniversity(c.Request.Context(), me, targetUni) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	if photoKey == nil || *photoKey == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "برای این شخص عکسی ثبت نشده است."})
		return
	}
	key := *photoKey
	if strings.HasPrefix(key, "/") || strings.Contains(key, "..") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid key"})
		return
	}
	if a.Archive == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "آرشیو پیکربندی نشده است."})
		return
	}
	data, mime, err := a.Archive.Get(c.Request.Context(), key)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "فایل عکس در انبار فایل پیدا نشد."})
		return
	}
	allowed := map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true, "image/gif": true, "image/bmp": true}
	ct := "application/octet-stream"
	if mime != "" && allowed[strings.ToLower(mime)] {
		ct = mime
	}
	if photoMime != nil && allowed[strings.ToLower(*photoMime)] {
		ct = *photoMime
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:")
	c.Header("Cache-Control", "private, max-age=300")
	c.Data(http.StatusOK, ct, data)
}
