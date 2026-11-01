// ═══ /api/v2/session — current session state for SPA ═══
//
// Port of getSessionUser with a compatible addition: because when the user must
// change the password, Next returns "no session", so the SPA needs the password-change root for routing decisions;
// it needs to distinguish them, so GET/session checks twice:
//   - valid user ⇒ {ok, user}
//   - only the mustChangePassword blocker ⇒ {ok, user:null, pendingPasswordChange:true}
//   - no session ⇒ {ok, user:null}
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

// parseCookies builds a name→value map from the request (dual-read in session.ReadToken).
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

	// Distinguishing "must change password" from "no session" — only for UI routing.
	if pending, perr := s.Store.Get(c.Request.Context(), token, true); perr == nil && pending != nil {
		c.JSON(http.StatusOK, gin.H{"ok": true, "user": nil, "pendingPasswordChange": true})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "user": nil})
}
