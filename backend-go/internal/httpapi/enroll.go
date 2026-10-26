// ═══ اندپوینت‌های انتخاب واحد (فاز ۳) ═══
package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/enroll"
)

// RegisterEnrollRoutes مسیرها را روی گروه API ثبت می‌کند.
func (a *StudentAPI) RegisterEnrollRoutes(r gin.IRouter, svc *enroll.Service) {
	a.Enroll = svc
	r.GET("/student/enroll", a.enrollPage)
	r.POST("/student/enroll/cart", a.enrollCartAdd)
	r.POST("/student/enroll/cart/remove", a.enrollCartRemove)
	r.POST("/student/enroll/cart/clear", a.enrollCartClear)
	r.POST("/student/enroll/auto-fill", a.enrollAutoFill)
	r.POST("/student/enroll/submit", a.enrollSubmit)
	r.GET("/student/enroll/status", a.enrollStatus)
	r.GET("/student/enroll/live-capacity", a.enrollLiveCapacity)
	r.GET("/student/enroll/preview-exam-conflicts", a.enrollPreviewConflicts)
	r.POST("/student/enroll/refer-council", a.enrollReferCouncil)
	r.POST("/student/enroll/bypass", a.enrollBypass)
	r.POST("/student/enroll/bypass/cancel", a.enrollBypassCancel)
}

func (a *StudentAPI) enrollRec(c *gin.Context) (userID, studentID int64, ok bool) {
	user := a.requireStudent(c)
	if user == nil {
		return 0, 0, false
	}
	rec, err := a.Svc.Resolve(c.Request.Context(), user.ID)
	if err != nil || rec == nil {
		c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "پروندهٔ دانشجویی یافت نشد."})
		return 0, 0, false
	}
	return user.ID, rec.ID, true
}

func (a *StudentAPI) enrollFail(c *gin.Context, err error) {
	var ae *enroll.ActionError
	if errors.As(err, &ae) {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": ae.Message})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
}

func (a *StudentAPI) enrollPage(c *gin.Context) {
	user := a.requireStudent(c)
	if user == nil {
		return
	}
	resp, err := a.Enroll.GetEnrollPage(c.Request.Context(), user.ID, user.Name, termIDQueryOrCookie(c))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": resp})
}

type offeringBody struct {
	OfferingID int64 `json:"offeringId"`
}

func (a *StudentAPI) enrollCartAdd(c *gin.Context) {
	_, studentID, ok := a.enrollRec(c)
	if !ok {
		return
	}
	var body offeringBody
	if err := c.ShouldBindJSON(&body); err != nil || body.OfferingID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ ارائه نامعتبر است."})
		return
	}
	if err := a.Enroll.AddToCart(c.Request.Context(), studentID, body.OfferingID); err != nil {
		a.enrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *StudentAPI) enrollCartRemove(c *gin.Context) {
	_, studentID, ok := a.enrollRec(c)
	if !ok {
		return
	}
	var body offeringBody
	if err := c.ShouldBindJSON(&body); err != nil || body.OfferingID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ ارائه نامعتبر است."})
		return
	}
	if err := a.Enroll.RemoveFromCart(c.Request.Context(), studentID, body.OfferingID); err != nil {
		a.enrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *StudentAPI) enrollCartClear(c *gin.Context) {
	_, studentID, ok := a.enrollRec(c)
	if !ok {
		return
	}
	if err := a.Enroll.ClearCart(c.Request.Context(), studentID); err != nil {
		a.enrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *StudentAPI) enrollAutoFill(c *gin.Context) {
	_, studentID, ok := a.enrollRec(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": a.Enroll.AutoFillCart(c.Request.Context(), studentID)})
}

func (a *StudentAPI) enrollSubmit(c *gin.Context) {
	userID, studentID, ok := a.enrollRec(c)
	if !ok {
		return
	}
	var body struct {
		AcceptSameDayRisk bool `json:"acceptSameDayRisk"`
	}
	_ = c.ShouldBindJSON(&body)
	tick := a.Enroll.SubmitCart(c.Request.Context(), userID, studentID, body.AcceptSameDayRisk)
	c.JSON(http.StatusOK, tick)
}

func (a *StudentAPI) enrollStatus(c *gin.Context) {
	userID, _, ok := a.enrollRec(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": a.Enroll.MyStatus(c.Request.Context(), userID)})
}

func (a *StudentAPI) enrollLiveCapacity(c *gin.Context) {
	if _, _, ok := a.enrollRec(c); !ok {
		return
	}
	raw := strings.TrimSpace(c.Query("ids"))
	ids := []int64{}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		var id int64
		if _, err := fmtSscanInt(part, &id); err == nil {
			ids = append(ids, id)
		}
	}
	c.JSON(http.StatusOK, a.Enroll.LiveCapacities(c.Request.Context(), ids))
}

func (a *StudentAPI) enrollPreviewConflicts(c *gin.Context) {
	_, studentID, ok := a.enrollRec(c)
	if !ok {
		return
	}
	hard, soft, err := a.Enroll.PreviewExamConflicts(c.Request.Context(), studentID)
	if err != nil {
		a.enrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "hard": hard, "soft": soft})
}

func (a *StudentAPI) enrollReferCouncil(c *gin.Context) {
	userID, studentID, ok := a.enrollRec(c)
	if !ok {
		return
	}
	var body struct {
		OfferingID int64  `json:"offeringId"`
		Reason     string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.OfferingID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ ارائه نامعتبر است."})
		return
	}
	if err := a.Enroll.ReferCouncil(c.Request.Context(), userID, studentID, body.OfferingID, strings.TrimSpace(body.Reason)); err != nil {
		a.enrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *StudentAPI) enrollBypass(c *gin.Context) {
	_, studentID, ok := a.enrollRec(c)
	if !ok {
		return
	}
	var body struct {
		OfferingID int64  `json:"offeringId"`
		Kind       string `json:"kind"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.OfferingID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ ارائه نامعتبر است."})
		return
	}
	if err := a.Enroll.RequestBypass(c.Request.Context(), studentID, body.OfferingID, body.Kind); err != nil {
		a.enrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (a *StudentAPI) enrollBypassCancel(c *gin.Context) {
	_, studentID, ok := a.enrollRec(c)
	if !ok {
		return
	}
	var body struct {
		RequestID int64 `json:"requestId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.RequestID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ درخواست نامعتبر است."})
		return
	}
	if err := a.Enroll.CancelBypass(c.Request.Context(), studentID, body.RequestID); err != nil {
		a.enrollFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func fmtSscanInt(v string, out *int64) (int, error) {
	var n int64
	for _, ch := range v {
		if ch < '0' || ch > '9' {
			return 0, errors.New("bad int")
		}
		n = n*10 + int64(ch-'0')
	}
	*out = n
	return 1, nil
}
