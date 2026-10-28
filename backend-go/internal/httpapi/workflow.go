// ═══ اندپوینت‌های گردش کار (فاز ۸) ═══
package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/internal/admin"
	"backend-go/internal/session"
	"backend-go/internal/workflow"
)

// WorkflowAPI هندلرهای کارتابل گردش کار.
type WorkflowAPI struct {
	Engine *workflow.Engine
	Store  *session.Store
	Admin  *admin.Service
}

var workflowRoles = []string{"ADMIN", "EDU_EXPERT"}

func (a *WorkflowAPI) requireWorkflowUser(c *gin.Context, roles []string) *session.User {
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
	c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "دسترسی غیرمجاز."})
	return nil
}

// uniCookie دانشگاه فعال از کوکی (برای دامنهٔ کارتابل).
func (a *WorkflowAPI) uniCookie(c *gin.Context) string {
	if v, err := c.Cookie("afagh_uni"); err == nil {
		return v
	}
	return ""
}

func (a *WorkflowAPI) uniID(c *gin.Context, user *session.User) *int64 {
	return a.Admin.UniversityID(c.Request.Context(), user, a.uniCookie(c))
}

func (a *WorkflowAPI) Register(r gin.IRouter) {
	r.GET("/admin/workflows", a.workflows)
	r.POST("/admin/workflows/step", a.workflowStep)
	r.POST("/admin/workflows/checkpoint/clear", a.workflowCheckpointClear)
	r.POST("/admin/workflows/sla-run", a.workflowSLARun)
	r.POST("/admin/workflows/process", a.workflowSaveProcess)
	r.GET("/admin/workflows/events", a.workflowEvents)
	r.POST("/admin/workflows/events/retry", a.workflowEventsRetry)
}

func (a *WorkflowAPI) workflows(c *gin.Context) {
	user := a.requireWorkflowUser(c, workflowRoles)
	if user == nil {
		return
	}
	data, err := a.Engine.LoadAdminWorkflows(c.Request.Context(), a.uniID(c, user))
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": data})
}

// assertRequestInUni درخواست باید متعلق به دانشگاه فعال باشد.
func (a *WorkflowAPI) assertRequestInUni(c *gin.Context, user *session.User, requestID int64) error {
	uniID := a.uniID(c, user)
	if uniID == nil {
		return errPlain("دانشگاه فعال نامشخص است.")
	}
	return a.Engine.AssertRequestUniversity(c.Request.Context(), requestID, *uniID)
}

func (a *WorkflowAPI) workflowStep(c *gin.Context) {
	user := a.requireWorkflowUser(c, workflowRoles)
	if user == nil {
		return
	}
	var body struct {
		RequestID int64  `json:"requestId"`
		Action    string `json:"action"`
		Note      string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.RequestID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	switch body.Action {
	case "APPROVE", "REJECT", "RETURN_FOR_REVISION", "ESCALATE":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "عملیات نامعتبر است."})
		return
	}
	if err := a.assertRequestInUni(c, user, body.RequestID); err != nil {
		a.fail(c, err)
		return
	}
	role := "ADMIN"
	if len(user.Roles) > 0 {
		role = user.Roles[0]
	}
	res, err := a.Engine.AdvanceWorkflowStep(c.Request.Context(), body.RequestID,
		workflow.Actor{Role: role, UserID: user.ID}, body.Action, body.Note)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *WorkflowAPI) workflowCheckpointClear(c *gin.Context) {
	user := a.requireWorkflowUser(c, workflowRoles)
	if user == nil {
		return
	}
	var body struct {
		CheckpointID int64  `json:"checkpointId"`
		Notes        string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.CheckpointID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	reqID, err := a.Engine.CheckpointRequestID(c.Request.Context(), body.CheckpointID)
	if err != nil {
		a.fail(c, err)
		return
	}
	if err := a.assertRequestInUni(c, user, reqID); err != nil {
		a.fail(c, err)
		return
	}
	res, err := a.Engine.ClearParallelCheckpoint(c.Request.Context(), body.CheckpointID, nil, body.Notes)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *WorkflowAPI) workflowSLARun(c *gin.Context) {
	user := a.requireWorkflowUser(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	items, err := a.Engine.CheckAndTriggerSLATimeouts(c.Request.Context())
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"count": len(items), "items": items}})
}

func (a *WorkflowAPI) workflowSaveProcess(c *gin.Context) {
	user := a.requireWorkflowUser(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var body workflow.SaveProcessInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	id, err := a.Engine.SaveProcessDefinition(c.Request.Context(), a.uniID(c, user), body)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"processId": id}})
}

func (a *WorkflowAPI) workflowEvents(c *gin.Context) {
	user := a.requireWorkflowUser(c, workflowRoles)
	if user == nil {
		return
	}
	rid, err := strconv.ParseInt(strings.TrimSpace(c.Query("requestId")), 10, 64)
	if err != nil || rid <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "شناسهٔ درخواست نامعتبر است."})
		return
	}
	if err := a.assertRequestInUni(c, user, rid); err != nil {
		a.fail(c, err)
		return
	}
	rows, err := a.Engine.EventsForRequest(c.Request.Context(), rid)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": gin.H{"events": rows}})
}

func (a *WorkflowAPI) workflowEventsRetry(c *gin.Context) {
	user := a.requireWorkflowUser(c, []string{"ADMIN"})
	if user == nil {
		return
	}
	var body struct {
		Limit int `json:"limit"`
	}
	_ = c.ShouldBindJSON(&body)
	res, err := a.Engine.RetryPendingWorkflowEvents(c.Request.Context(), body.Limit)
	if err != nil {
		a.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "data": res})
}

func (a *WorkflowAPI) fail(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
}

type plainErr string

func (e plainErr) Error() string { return string(e) }

func errPlain(msg string) error { return plainErr(msg) }
