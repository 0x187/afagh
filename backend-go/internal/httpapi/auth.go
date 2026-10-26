// ═══ اندپوینت‌های /api/v2/auth/* — پورت login.actions.ts به REST ═══
//
// قرارداد (docs/rewrite/phase1-contracts.md): پاکت {ok, error?, ...}، پیام‌های
// فارسی عیناً afagh-next، سقف ورود = 429 با پیام عمومی login.actions.ts.
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"backend-go/internal/authn"
	"backend-go/internal/logger"
	"backend-go/internal/session"
)

// AuthAPI هندلرهای احراز هویت.
type AuthAPI struct {
	Svc *authn.Service
	// ClientIP هویت کلاینت — پیش‌فرض gin؛ لایهٔ proxy-trust در ادامهٔ فاز وصل می‌شود.
	ClientIP func(c *gin.Context) string
}

func (a *AuthAPI) clientIP(c *gin.Context) string {
	if a.ClientIP != nil {
		return a.ClientIP(c)
	}
	return c.ClientIP()
}

func (a *AuthAPI) currentToken(c *gin.Context) string {
	return session.ReadToken(parseCookies(c.Request))
}

func (a *AuthAPI) Register(r gin.IRouter) {
	r.POST("/auth/login", a.login)
	r.POST("/auth/choose-account", a.chooseAccount)
	r.POST("/auth/logout", a.logout)
	r.POST("/auth/change-password", a.changePassword)
	r.POST("/auth/switch-account", a.switchAccount)
	r.GET("/auth/siblings", a.siblings)
}

type loginBody struct {
	Identifier string `json:"identifier"`
	Password   string `json:"password"`
}

func (a *AuthAPI) login(c *gin.Context) {
	var body loginBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res, err := a.Svc.Login(c.Request.Context(), c.Writer, body.Identifier, body.Password, a.clientIP(c))
	if err != nil {
		var rl *authn.LoginRateLimitError
		if asLoginRateLimit(err, &rl) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"ok":    false,
				"error": "تلاش‌های ورود بیش از حد مجاز شد. چند دقیقه دیگر دوباره تلاش کنید.",
			})
			return
		}
		logger.For("httpapi").Error("login_failed", logger.Fields{"error": err.Error()})
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
		return
	}
	if res.NeedChoice {
		c.JSON(http.StatusOK, gin.H{
			"ok": false, "needChoice": true,
			"token": res.Token, "candidates": res.Candidates,
		})
		return
	}
	if !res.OK {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": res.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "mustChange": res.MustChange})
}

type chooseBody struct {
	Token  string `json:"token"`
	UserID int64  `json:"userId"`
}

func (a *AuthAPI) chooseAccount(c *gin.Context) {
	var body chooseBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res, err := a.Svc.ChooseLoginAccount(c.Request.Context(), c.Writer, body.Token, body.UserID, a.clientIP(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
		return
	}
	if !res.OK {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": res.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "mustChange": res.MustChange})
}

func (a *AuthAPI) logout(c *gin.Context) {
	if err := a.Svc.Logout(c.Request.Context(), c.Writer, a.currentToken(c)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type changePasswordBody struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (a *AuthAPI) changePassword(c *gin.Context) {
	var body changePasswordBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res, err := a.Svc.ChangePassword(c.Request.Context(), a.currentToken(c), body.CurrentPassword, body.NewPassword)
	if err != nil {
		logger.For("httpapi").Error("change_password_failed", logger.Fields{"error": err.Error()})
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
		return
	}
	if !res.OK {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": res.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type switchAccountBody struct {
	Kind     string `json:"kind"`
	Code     string `json:"code"`
	Password string `json:"password"`
}

func (a *AuthAPI) switchAccount(c *gin.Context) {
	var body switchAccountBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res, err := a.Svc.SwitchAccount(c.Request.Context(), c.Writer, body.Kind, body.Code, body.Password, a.currentToken(c), a.clientIP(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
		return
	}
	if !res.OK {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": res.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "mustChange": res.MustChange})
}

func (a *AuthAPI) siblings(c *gin.Context) {
	token := a.currentToken(c)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	me, err := a.Svc.Store.Get(c.Request.Context(), token, false)
	if err != nil || me == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return
	}
	accounts, err := a.Svc.GetSiblingAccounts(c.Request.Context(), me.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "accounts": accounts})
}

// asLoginRateLimit type-assert بدون ایمپورت errors در امضای هندلر.
func asLoginRateLimit(err error, out **authn.LoginRateLimitError) bool {
	if e, ok := err.(*authn.LoginRateLimitError); ok {
		*out = e
		return true
	}
	return false
}
