// ═══ /api/v2/session — وضعیت نشست جاری برای SPA ═══
//
// پورت getSessionUser با یک افزودنیِ سازگار: چون Next وقتی کاربر باید رمز را
// عوض کند «بدون نشست» برمی‌گرداند، SPA برای تصمیم مسیریابی به ریشهٔ تغییر رمز
// نیاز به تمایز دارد؛ پس GET/session دو بار نگاه می‌کند:
//   - user معتبر ⇒ {ok, user}
//   - فقط مانع mustChangePassword ⇒ {ok, user:null, pendingPasswordChange:true}
//   - هیچ نشستی ⇒ {ok, user:null}
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"backend-go/internal/middleware"
	"backend-go/internal/session"
)

type SessionAPI struct {
	Store *session.Store
}

// parseCookies مپ نام→مقدار از درخواست می‌سازد (dual-read در session.ReadToken).
func parseCookies(r *http.Request) map[string]string {
	m := make(map[string]string, len(r.Cookies()))
	for _, ck := range r.Cookies() {
		if _, exists := m[ck.Name]; !exists {
			m[ck.Name] = ck.Value
		}
	}
	return m
}

func (s *SessionAPI) Register(r gin.IRouter) {
	r.GET("/session", s.get)
}

func (s *SessionAPI) get(c *gin.Context) {
	middleware.NoStore(c.Writer)

	token := session.ReadToken(parseCookies(c.Request))
	if token == "" || !session.ValidTokenShape(token) {
		c.JSON(http.StatusOK, gin.H{"ok": true, "user": nil})
		return
	}

	user, err := s.Store.Get(c.Request.Context(), token, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
		return
	}
	if user != nil {
		c.JSON(http.StatusOK, gin.H{"ok": true, "user": user})
		return
	}

	// تمایز «باید رمز عوض کند» از «بدون نشست» — فقط برای مسیریابی UI.
	if pending, perr := s.Store.Get(c.Request.Context(), token, true); perr == nil && pending != nil {
		c.JSON(http.StatusOK, gin.H{"ok": true, "user": nil, "pendingPasswordChange": true})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "user": nil})
}
