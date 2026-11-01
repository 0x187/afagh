// ═══ /api/v2/scope — university/semester switcher (port of /api/scope/*) ═══
//
// Intentional difference from the Next version: those routes returned a POST form + 303 redirect;
// here it returns JSON {ok:true} with Set-Cookie and the SPA refreshes itself.
// Cookie names, target validation and lifetime (365 days) are preserved exactly.
package httpapi

import (
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/scope"
	"backend-go/internal/session"
)

// areaRoles — same AREA_ROLES as in api/scope/university/route.ts: only these roles
// are allowed to change the active university.
var areaRoles = map[string]bool{
	"ADMIN": true, "EDU_EXPERT": true, "ARCHIVE_EXPERT": true, "FINANCE_EXPERT": true,
	"FINANCE": true, "MILITARY_OFFICER": true, "VAULT_MANAGER": true, "DEP_HEAD": true, "VICE_EDU": true,
}

// ScopeAPI scope handlers.
type ScopeAPI struct {
	Store      *session.Store
	Svc        *scope.Service
	Production bool // for the cookie secure flag (same simple secureCookie of the scope routes)
}

func (a *ScopeAPI) Register(r gin.IRouter) {
	r.GET("/scope", a.getScope)
	r.POST("/scope/university", a.setUniversity)
	r.POST("/scope/term", a.setTerm)
}

// secureCookie port of the scope routes' secureCookie: explicit true/false, otherwise production.
func (a *ScopeAPI) secureCookie() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("AFAGH_COOKIE_SECURE"))) {
	case "true":
		return true
	case "false":
		return false
	}
	return a.Production
}

func (a *ScopeAPI) currentUser(c *gin.Context) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		return nil
	}
	u, _ := a.Store.Get(c.Request.Context(), token, false)
	return u
}

// getScope current state + allowed list for the switchers.
func (a *ScopeAPI) getScope(c *gin.Context) {
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	ctx := c.Request.Context()
	wantCode := cookieValue(c, scope.UniversityCookie)
	uni, err := a.Svc.CurrentUniversity(ctx, user, wantCode)
	if err != nil {
		uni = scope.DenyUni
	}
	universities, _ := a.Svc.ListUniversities(ctx, user)

	wantedTerm := termIDFromCookie(c)
	selection := a.Svc.GetTermScope(ctx, &uni.ID, wantedTerm)

	resp := gin.H{
		"ok":              true,
		"universityId":    nil,
		"universityCode":  nil,
		"universities":    universities,
		"terms":           selection.Terms,
		"termId":          selection.SelectedID,
		"selectedTermId":  selection.SelectedID,
		"effectiveTermId": selection.EffectiveID,
	}
	if uni.ID > 0 {
		resp["universityId"] = uni.ID
		resp["universityCode"] = uni.Code
	}
	c.JSON(http.StatusOK, resp)
}

type setUniversityBody struct {
	Code         string `json:"code"`
	UniversityID *int64 `json:"universityId"` // SPA client compatibility
}

// setUniversity port of POST /api/scope/university.
func (a *ScopeAPI) setUniversity(c *gin.Context) {
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	allowedRole := false
	for _, r := range user.Roles {
		if areaRoles[r] {
			allowedRole = true
			break
		}
	}
	if !allowedRole {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "اجازهٔ تغییر دانشگاه فعال را ندارید."})
		return
	}

	var body setUniversityBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	code := strings.TrimSpace(body.Code)
	if len(code) > 20 {
		code = code[:20]
	}
	if code == "" && body.UniversityID != nil && *body.UniversityID > 0 {
		// The SPA client sends an ID; it is converted to a code (the single boundary is the same).
		universities, _ := a.Svc.ListUniversities(c.Request.Context(), user)
		for i := range universities {
			if universities[i].ID == *body.UniversityID {
				code = universities[i].Code
				break
			}
		}
	}
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشگاه را انتخاب کنید."})
		return
	}

	// Single boundary: the same computation CurrentUniversity bases its decision on.
	universities, _ := a.Svc.ListUniversities(c.Request.Context(), user)
	var target *scope.UniScope
	for i := range universities {
		if universities[i].Code == code {
			target = &universities[i]
			break
		}
	}
	if target == nil || !a.Svc.CanActOnUniversity(c.Request.Context(), user, &target.ID) {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "این دانشگاه برای شما مجاز نیست."})
		return
	}

	c.SetCookie(scope.UniversityCookie, target.Code, 365*24*3600, "/", "", a.secureCookie(), true)
	c.JSON(http.StatusOK, gin.H{"ok": true, "universityId": target.ID, "universityCode": target.Code})
}

type setTermBody struct {
	TermID *int64 `json:"termId"` // null/0 = «همهٔ نیمسال‌ها» (clear the cookie)
}

// setTerm port of POST /api/scope/term.
func (a *ScopeAPI) setTerm(c *gin.Context) {
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	var body setTermBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}

	uni, _ := a.Svc.CurrentUniversity(c.Request.Context(), user, cookieValue(c, scope.UniversityCookie))
	if uni.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "دانشگاه فعال مشخص نیست."})
		return
	}

	if body.TermID == nil || *body.TermID <= 0 {
		// «همهٔ نیمسال‌ها» = clear the cookie
		c.SetCookie(scope.TermCookie, "", -1, "/", "", a.secureCookie(), true)
		c.JSON(http.StatusOK, gin.H{"ok": true, "termId": nil})
		return
	}
	if !a.Svc.ValidateTermForUniversity(c.Request.Context(), *body.TermID, uni.ID) {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "این نیمسال متعلق به دانشگاه فعال نیست."})
		return
	}
	c.SetCookie(scope.TermCookie, strconv.FormatInt(*body.TermID, 10), 365*24*3600, "/", "", a.secureCookie(), true)
	c.JSON(http.StatusOK, gin.H{"ok": true, "termId": *body.TermID})
}

func cookieValue(c *gin.Context, name string) string {
	if v, err := c.Cookie(name); err == nil {
		return v
	}
	return ""
}

func termIDFromCookie(c *gin.Context) *int64 {
	raw := strings.TrimSpace(cookieValue(c, scope.TermCookie))
	if raw == "" {
		return nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 {
		return nil
	}
	return &n
}
