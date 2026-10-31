// ═══ عمومی: تحویل اوراق امتحان (verify + confirm) ═══
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"backend-go/internal/session"
)

// ExamHandoverPublicAPI توکن تحویل اوراق — verify عمومی + confirm با نشست.
type ExamHandoverPublicAPI struct {
	Admin *AdminAPI
}

func (a *ExamHandoverPublicAPI) Register(r gin.IRouter) {
	r.GET("/public/exam-handover/:token", a.examHandoverVerify)
	r.POST("/public/exam-handover/:token/confirm", a.examHandoverConfirm)
}

func (a *ExamHandoverPublicAPI) examHandoverVerify(c *gin.Context) {
	res, err := a.Admin.Svc.VerifyExamHandover(c.Request.Context(), c.Param("token"), a.Admin.Signer)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *ExamHandoverPublicAPI) examHandoverConfirm(c *gin.Context) {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "برای تأیید تحویل باید وارد شوید."})
		return
	}
	user, _ := a.Admin.Store.Get(c.Request.Context(), token, false)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "نشست منقضی شده است."})
		return
	}
	res, err := a.Admin.Svc.ConfirmExamHandover(c.Request.Context(), user, c.Param("token"), a.Admin.Signer)
	if err != nil {
		a.Admin.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}
