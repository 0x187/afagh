// ═══ اندپوینت‌های صفحهٔ اتصال پیام‌رسان (/messenger) ═══
//
//	پورت server actionهای messenger-link-actions.ts به REST:
//	  ۱) POST /messenger/link/token   — صدور کد اتصال (۱۰ دقیقه اعتبار)
//	  ۲) GET  /messenger/link/status  — بررسی سبک وضعیت جفت‌سازی (تأیید خودکار کلاینت)
//	  ۳) POST /messenger/link/confirm — تأیید نهایی پس از /start در بات
//	  ۴) GET  /messenger/channels     — کانال‌های ثبت‌شدهٔ کاربر (وضعیت اتصال)
//	  ۵) POST /messenger/channels/revoke — لغو اتصال یک پیام‌رسان
//	همه نیازمند نشست پورتال‌اند (همهٔ نقش‌ها — همان redirect('/login') در Next).
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"backend-go/internal/messaging"
	"backend-go/internal/ratelimit"
	"backend-go/internal/session"
)

// MessengerAPI هندلرهای اتصال پیام‌رسان.
type MessengerAPI struct {
	Store   *session.Store
	Svc     *messaging.Service
	Limiter *ratelimit.Limiter
}

// Register ثبت مسیرها.
func (a *MessengerAPI) Register(r gin.IRouter) {
	r.POST("/messenger/link/token", a.mintToken)
	r.GET("/messenger/link/status", a.pairingStatus)
	r.POST("/messenger/link/confirm", a.confirmLink)
	r.GET("/messenger/channels", a.listChannels)
	r.POST("/messenger/channels/revoke", a.revokeChannel)
}

// requireUser نشست پورتال — همان «ابتدا وارد سامانه شوید» در کنش‌های Next.
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

// mintToken صدور کد اتصال برای یک کانال — پورت mintLinkTokenAction.
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
		// خطای منطقی (کانال فریز / سقف نرخ) — همان پاکت کنش سروری.
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

// pairingStatus بررسی اینکه آیا بات /start را دریافت کرده (بدون تأیید نهایی).
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

// confirmLink تأیید نهایی اتصال پس از ارسال /start در بات.
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

// listChannels وضعیت کانال‌های ثبت‌شدهٔ کاربر.
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

// revokeChannel لغو اتصال یک پیام‌رسان — حذف نشانی کانال (معادل
// saveUserChannel با رشتهٔ خالی)؛ فقط برای پنج پیام‌رسان مجاز است.
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
