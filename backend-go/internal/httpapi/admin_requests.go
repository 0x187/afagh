// Admin request decisions — port of app/admin/actions.ts approve/reject
// (council inbox): a DECIDABLE-guarded status flip with university scope and
// the chained audit row. The enrollment-linked follow-up of the reference
// action is explicitly gated until its port lands.
package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// requestDecision — POST /admin/requests/:id/decision  {action: APPROVE|REJECT, reason?}
func (a *AdminAPI) requestDecision(c *gin.Context) {
	user := a.requireAdmin(c)
	if user == nil {
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	var body struct {
		Action string `json:"action"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "درخواست نامعتبر است."})
		return
	}
	action := strings.ToUpper(strings.TrimSpace(body.Action))
	if action != "APPROVE" && action != "REJECT" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "اقدام نامعتبر است."})
		return
	}
	uniID := a.Svc.UniversityID(c.Request.Context(), user, a.uniCookie(c))

	newStatus := "APPROVED"
	if action == "REJECT" {
		newStatus = "REJECTED"
	}

	tx, err := a.Svc.DB.Pool.Begin(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
		return
	}
	defer tx.Rollback(c.Request.Context())

	// University scope (fail-closed): the request belongs to the active
	// university or is global.
	var (
		reqID         int64
		studentID     int64
		track         string
		relatedEnroll *int64
	)
	qerr := tx.QueryRow(c.Request.Context(), `
		update student_requests r set status = $2, "updatedAt" = now()
		 where r.id = $1 and r.status in ('SUBMITTED','IN_REVIEW','DRAFT')
		   and (r."universityId" is null or ($3::int is not null and r."universityId" = $3))
		 returning r.id, r."studentId", r."trackingCode", r."relatedEnrollmentId"`,
		id, newStatus, uniID).Scan(&reqID, &studentID, &track, &relatedEnroll)
	if qerr != nil {
		var cur string
		_ = a.Svc.DB.Pool.QueryRow(c.Request.Context(),
			`select status from student_requests where id = $1`, id).Scan(&cur)
		msg := "درخواست یافت نشد."
		if cur != "" {
			msg = "این درخواست قبلاً پردازش شده است."
		}
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": msg})
		return
	}
	if relatedEnroll != nil && *relatedEnroll > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "این درخواست به اخذ درس متصل است؛ پردازش کامل آن هنوز پورت نشده — از کارتابل گردش‌کار استفاده کنید."})
		return
	}

	// Chained audit row (same pattern as the rest of the codebase).
	var prev string
	_ = tx.QueryRow(c.Request.Context(), `select coalesce(hash,'') from audit_logs order by id desc limit 1`).Scan(&prev)
	details, _ := json.Marshal(map[string]any{
		"action": action, "trackingCode": track, "reason": body.Reason,
	})
	nowISO := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	sum := sha256.Sum256([]byte(prev + "|" + action + "|student_requests|" + strconv.FormatInt(id, 10) + "|" + nowISO))
	ip := strings.TrimSpace(strings.Split(c.GetHeader("x-forwarded-for"), ",")[0])
	if ip == "" {
		ip = c.ClientIP()
	}
	_, _ = tx.Exec(c.Request.Context(), `
		insert into audit_logs ("actorUserId", action, "entityType", "entityId", details, "prevHash", hash, "ipAddress")
		values ($1, $2, 'student_requests', $3, $4, $5, $6, nullif($7,''))`,
		user.ID, "REQUEST_"+newStatus, id, string(details), prev, hex.EncodeToString(sum[:]), ip)

	if err := tx.Commit(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "خطای داخلی سرور."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": newStatus})
}
