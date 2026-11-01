// ═══ Messenger connection page endpoints (/messenger) ═══
//
//	Port of the server actions in messenger-link-actions.ts to REST:
//	  1) POST /messenger/link/token   — issue a link code (valid for 10 minutes)
//	  2) GET  /messenger/link/status  — lightweight pairing status check (client auto-confirm)
//	  3) POST /messenger/link/confirm — final confirmation after /start in the bot
//	  4) GET  /messenger/channels     — user's registered channels (connection status)
//	  5) POST /messenger/channels/revoke — revoke a messenger connection
//	All require a portal session (all roles — same redirect('/login') as in Next).
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"backend-go/internal/messaging"
	"backend-go/internal/ratelimit"
	"backend-go/internal/session"
)

// MessengerAPI messenger connection handlers.
type MessengerAPI struct {
	Store   *session.Store
	Svc     *messaging.Service
	Limiter *ratelimit.Limiter
}

// Register route registration.
func (a *MessengerAPI) Register(r gin.IRouter) {
	r.POST("/messenger/link/token", a.mintToken)
	r.GET("/messenger/link/status", a.pairingStatus)
	r.POST("/messenger/link/confirm", a.confirmLink)
	r.GET("/messenger/channels", a.listChannels)
	r.POST("/messenger/channels/revoke", a.revokeChannel)
}

// requireUser portal session — same "log in to the system first" as in the Next actions.
func (a *MessengerAPI) requireUser(c *gin.Context) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد سامانه شوید."})
		return nil
	}
	user, _ := a.Store.Get(c.Request.Context(), token, false)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد سامانه شوید."})
		return nil
	}
	return user
}

// mintToken issue a link code for a channel — port of mintLinkTokenAction.
func (a *MessengerAPI) mintToken(c *gin.Context) {
	user := a.requireUser(c)
	if user == nil {
		return
	}
	var in struct {
		Channel string `json:"channel"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res := a.Svc.MintLinkToken(c.Request.Context(), user.ID, in.Channel)
	if !res.OK {
		// Business error (frozen channel / rate limit) — same server action envelope.
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": res.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":          true,
		"code":        res.Code,
		"token":       res.Token,
		"deepLink":    res.DeepLink,
		"pairingText": res.PairingText,
		"expiresAt":   res.ExpiresAt,
	})
}

// pairingStatus check whether the bot received /start (without final confirmation).
func (a *MessengerAPI) pairingStatus(c *gin.Context) {
	user := a.requireUser(c)
	if user == nil {
		return
	}
	st := a.Svc.CheckPairingStatus(c.Request.Context(), user.ID, c.Query("code"))
	out := gin.H{"ok": st.OK}
	if st.Error != "" {
		out["error"] = st.Error
	}
	if st.OK {
		out["paired"] = st.Paired
		out["channel"] = st.Channel
	}
	c.JSON(http.StatusOK, out)
}

// confirmLink final connection confirmation after sending /start in the bot.
func (a *MessengerAPI) confirmLink(c *gin.Context) {
	user := a.requireUser(c)
	if user == nil {
		return
	}
	var in struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res := a.Svc.ConfirmLinkToken(c.Request.Context(), user.ID, in.Code)
	if !res.OK {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": res.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "channel": res.Channel})
}

// listChannels status of the user's registered channels.
func (a *MessengerAPI) listChannels(c *gin.Context) {
	user := a.requireUser(c)
	if user == nil {
		return
	}
	rows, err := a.Svc.ListUserChannels(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خواندن کانال‌ها ناموفق بود؛ دوباره تلاش کنید."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": rows})
}

// revokeChannel revoke a messenger connection — remove the channel address (equivalent to
// saveUserChannel with an empty string); allowed only for the five messengers.
func (a *MessengerAPI) revokeChannel(c *gin.Context) {
	user := a.requireUser(c)
	if user == nil {
		return
	}
	var in struct {
		Channel string `json:"channel"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if !messaging.IsMessengerChannel(in.Channel) {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "کانال نامعتبر است."})
		return
	}
	if err := a.Svc.SaveUserChannel(c.Request.Context(), user.ID, in.Channel, ""); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "لغو اتصال ناموفق بود؛ دوباره تلاش کنید."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
