// ═══ اندپوینت‌های پورتال استاد (فاز ۴) ═══
package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/professor"
	"backend-go/internal/session"
)

// ProfessorAPI هندلرهای استاد.
type ProfessorAPI struct {
	Svc   *professor.Service
	Store *session.Store
}

func (a *ProfessorAPI) Register(r gin.IRouter) {
	r.GET("/professor/dashboard", a.dashboard)
	r.GET("/professor/schedule", a.schedule)
	r.GET("/professor/contract", a.contract)
	r.POST("/professor/contract/otp", a.contractOTP)
	r.POST("/professor/contract/sign", a.contractSign)
	r.GET("/professor/documents", a.documents)
	r.GET("/professor/documents/:id", a.document)
	r.POST("/professor/documents/:id/otp", a.documentOTP)
	r.POST("/professor/documents/:id/sign", a.documentSign)
	r.GET("/professor/broadcast", a.broadcast)
	r.POST("/professor/broadcast/preview", a.broadcastPreview)
	r.POST("/professor/broadcast/send", a.broadcastSend)
	r.GET("/professor/availability", a.availability)
	r.POST("/professor/availability", a.saveAvailability)
}

func (a *ProfessorAPI) currentUser(c *gin.Context) *session.User {
	token := session.ReadToken(parseCookies(c.Request))
	if token == "" {
		return nil
	}
	u, _ := a.Store.Get(c.Request.Context(), token, false)
	return u
}

func (a *ProfessorAPI) requireProfessor(c *gin.Context) *session.User {
	user := a.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "ابتدا وارد شوید."})
		return nil
	}
	allowed := false
	for _, r := range user.Roles {
		if r == "PROFESSOR" || r == "ADMIN" {
			allowed = true
		}
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی به پرتال استاد مجاز نیست."})
		return nil
	}
	return user
}

func (a *ProfessorAPI) fail(c *gin.Context, err error) {
	msg := err.Error()
	if strings.Contains(msg, "پروندهٔ هیئت علمی یافت نشد") {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": msg})
		return
	}
	c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": msg})
}

func (a *ProfessorAPI) dashboard(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetDashboard(c.Request.Context(), user.ID, termIDFromCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *ProfessorAPI) schedule(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetSchedule(c.Request.Context(), user.ID, termIDFromCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *ProfessorAPI) contract(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetContract(c.Request.Context(), user.ID, termIDFromCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *ProfessorAPI) contractOTP(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	var body struct {
		DocumentID int64 `json:"documentId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.DocumentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "سند نامعتبر است."})
		return
	}
	code, err := a.Svc.SendContractOTP(c.Request.Context(), user.ID, body.DocumentID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	resp := gin.H{"ok": true, "expiresInSeconds": 300}
	if code != "" {
		resp["devOtp"] = code
	}
	c.JSON(http.StatusOK, resp)
}

func (a *ProfessorAPI) contractSign(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	var body struct {
		DocumentID int64  `json:"documentId"`
		OTP        string `json:"otp"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.DocumentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	ip, ua := clientMeta(c)
	if err := a.Svc.SignContract(c.Request.Context(), user.ID, body.DocumentID, body.OTP, ip, ua); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *ProfessorAPI) documents(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	docs, err := a.Svc.ListDocuments(c.Request.Context(), user.ID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "documents": docs})
}

func (a *ProfessorAPI) documentID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ سند نامعتبر است."})
		return 0, false
	}
	return id, true
}

func (a *ProfessorAPI) document(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	id, ok := a.documentID(c)
	if !ok {
		return
	}
	detail, err := a.Svc.GetDocument(c.Request.Context(), user.ID, id)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": detail})
}

func (a *ProfessorAPI) documentOTP(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	id, ok := a.documentID(c)
	if !ok {
		return
	}
	code, err := a.Svc.SendDocumentOTP(c.Request.Context(), user.ID, id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	resp := gin.H{"ok": true, "expiresInSeconds": 120}
	if code != "" {
		resp["devOtp"] = code
	}
	c.JSON(http.StatusOK, resp)
}

func (a *ProfessorAPI) documentSign(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	id, ok := a.documentID(c)
	if !ok {
		return
	}
	var body struct {
		OTP string `json:"otp"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	ip, ua := clientMeta(c)
	if err := a.Svc.VerifyDocumentSign(c.Request.Context(), user.ID, id, body.OTP, ip, ua); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *ProfessorAPI) broadcast(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetBroadcast(c.Request.Context(), user.ID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *ProfessorAPI) broadcastPreview(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	var body struct {
		OfferingID int64 `json:"offeringId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.OfferingID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "کلاس نامعتبر است."})
		return
	}
	count, err := a.Svc.PreviewClass(c.Request.Context(), user.ID, body.OfferingID)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "count": count})
}

func (a *ProfessorAPI) broadcastSend(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	var body struct {
		OfferingID int64    `json:"offeringId"`
		Channels   []string `json:"channels"`
		Text       string   `json:"text"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.OfferingID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	res := a.Svc.SendClassMessage(c.Request.Context(), user.ID, body.OfferingID, body.Channels, body.Text)
	if !res.OK {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": res.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "report": res.Report})
}

func (a *ProfessorAPI) availability(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	resp, err := a.Svc.GetAvailability(c.Request.Context(), user.ID, termIDFromCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

func (a *ProfessorAPI) saveAvailability(c *gin.Context) {
	user := a.requireProfessor(c)
	if user == nil {
		return
	}
	var body struct {
		TermID int64                        `json:"termId"`
		Cells  []professor.AvailabilityCell `json:"cells"`
		Notes  string                       `json:"notes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.TermID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	if err := a.Svc.SaveAvailability(c.Request.Context(), user.ID, body.TermID, body.Cells, body.Notes); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func clientMeta(c *gin.Context) (string, string) {
	ip := c.GetHeader("X-Forwarded-For")
	if ip != "" {
		ip = strings.TrimSpace(strings.Split(ip, ",")[0])
	}
	if ip == "" {
		ip = c.ClientIP()
	}
	return ip, c.GetHeader("User-Agent")
}
