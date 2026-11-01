// ═══ teaching-fee statement approval chain — port of lib/payroll-approvals.ts ═══
//
//	State machine (on payroll_statements.status):
//	  DRAFT ─┬─→ MID_TERM_PAID ─┬─→ DEPT_HEAD_APPROVED
//	         └─→ DEPT_HEAD_APPROVED  (department head)
//	               → DEAN_APPROVED (academic deputy)
//	               → FINAL_SETTLED (financial settlement — engine, with precondition)
//	  DEPT_HEAD_APPROVED|DEAN_APPROVED ─(RETURN)→ DRAFT or MID_TERM_PAID
//	  * ─(REJECT)→ REJECTED (terminal)
package payroll

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// SessionUser is the acting user — minimal roles and ID.
type SessionUser struct {
	ID    int64
	Roles []string
}

// ToPayrollUser converts session.User to an approval-chain acting user.
func ToPayrollUser(id int64, roles []string) *SessionUser {
	return &SessionUser{ID: id, Roles: roles}
}

func hasRole(u *SessionUser, role string) bool {
	for _, r := range u.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// actingRole is the acting role — ADMIN always wins.
func actingRole(u *SessionUser, candidates []string) string {
	if hasRole(u, "ADMIN") {
		return "ADMIN"
	}
	for _, c := range candidates {
		if hasRole(u, c) {
			return c
		}
	}
	if len(u.Roles) > 0 {
		return u.Roles[0]
	}
	return "UNKNOWN"
}

var (
	deptRoles   = []string{"DEP_HEAD"}
	deanRoles   = []string{"VICE_EDU", "EDU_EXPERT"}
	returnRoles = []string{"DEP_HEAD", "VICE_EDU", "EDU_EXPERT"}
)

// HeadedDepartments: department-head scope — injected from outside (groupmanager).
type HeadedDepartments func(ctx context.Context, staffID int64, ownDeptID *int64) ([]int64, error)

// StaffRef is the staff reference for scope.
type StaffRef struct {
	StaffID      int64
	DepartmentID *int64
	UniversityID *int64
}

// StaffByUser resolves the staff member from the user — injected.
type StaffByUser func(ctx context.Context, userID int64) (*StaffRef, error)

// CanActOnUniversity: university boundary — injected (scope) with the acting user.
type CanActOnUniversity func(ctx context.Context, user *SessionUser, universityID int64) bool

// Approvals is the approval-chain service.
type Approvals struct {
	Engine      *Engine
	HeadedDepts HeadedDepartments
	StaffByUser StaffByUser
	CanActUni   CanActOnUniversity
}

// NewApprovals constructs the service.
func NewApprovals(engine *Engine) *Approvals {
	return &Approvals{Engine: engine}
}

// ApprovalResult is the approval-step result.
type ApprovalResult struct {
	Ok     bool     `json:"ok"`
	Info   *string  `json:"info,omitempty"`
	Amount *float64 `json:"amount,omitempty"`
}

// ApprovalError is the step error message.
type ApprovalError struct{ Msg string }

func (e *ApprovalError) Error() string { return e.Msg }

func errF(format string, args ...any) error {
	return &ApprovalError{Msg: fmt.Sprintf(format, args...)}
}

type statementCtx struct {
	id              int64
	status          string
	staffID         int64
	departmentID    *int64
	universityID    *int64
	professorUserID int64
	midtermPaid     float64
}

func loadStatementTx(ctx context.Context, tx pgx.Tx, statementID int64) (*statementCtx, error) {
	var c statementCtx
	var status *string
	err := tx.QueryRow(ctx, `
		select ps.id, ps.status, ps."midtermPaidAmount"::float8,
		       pc."staffId", st."departmentId", st."universityId", st."userId"
		  from payroll_statements ps
		  join professor_term_contracts pc on pc.id = ps."contractId"
		  join staff st on st.id = pc."staffId"
		 where ps.id = $1
		 for update of ps`, statementID).
		Scan(&c.id, &status, &c.midtermPaid, &c.staffID, &c.departmentID, &c.universityID, &c.professorUserID)
	if err != nil {
		return nil, errors.New("فیش یافت نشد.")
	}
	c.status = "DRAFT"
	if status != nil && *status != "" {
		c.status = *status
	}
	return &c, nil
}

// writeApprovalAudit: hash chain — same pattern as the engine.
func writeApprovalAudit(ctx context.Context, tx pgx.Tx, actorUserID int64, action string, entityID int64, details map[string]any) error {
	var prev string
	if err := tx.QueryRow(ctx, `select coalesce(hash,'') from audit_logs order by id desc limit 1 for update`).Scan(&prev); err != nil && err != pgx.ErrNoRows {
		prev = ""
	}
	dj, _ := json.Marshal(details)
	h := sha256.Sum256([]byte(prev + "|" + action + "|payroll_statement|" + strconv.FormatInt(entityID, 10) + "|" + string(dj)))
	hash := hex.EncodeToString(h[:])
	_, err := tx.Exec(ctx, `
		insert into audit_logs ("actorUserId", action, "entityType", "entityId", details, "prevHash", hash)
		values ($1,$2,'payroll_statement',$3,$4,$5,$6)`,
		actorUserID, action, entityID, string(dj), prev, hash)
	return err
}

func recordApprovalTx(ctx context.Context, tx pgx.Tx, statementID int64, stage string, user *SessionUser, role, action, from, to string, note *string) error {
	if _, err := tx.Exec(ctx, `
		insert into payroll_approvals ("statementId", stage, "actorUserId", "actorRole", action, note)
		values ($1,$2,$3,$4,$5,$6)`, statementID, stage, user.ID, role, action, note); err != nil {
		return err
	}
	return writeApprovalAudit(ctx, tx, user.ID, "PAYROLL_"+action+"_"+stage, statementID, map[string]any{
		"actorRole": role, "from": from, "to": to, "note": note,
	})
}

// assertDeptScope: department-head scope — the statement must belong to a department under their supervision (ADMIN exempt).
func (a *Approvals) assertDeptScope(ctx context.Context, user *SessionUser, c *statementCtx) error {
	if hasRole(user, "ADMIN") {
		return nil
	}
	if a.StaffByUser == nil {
		return errF("پیکربندی ناقص تأیید.")
	}
	actor, err := a.StaffByUser(ctx, user.ID)
	if err != nil || actor == nil {
		return errF("پروندهٔ کارمندی شما یافت نشد؛ تأیید ممکن نیست.")
	}
	if c.departmentID == nil {
		return errF("گروه آموزشی استاد مشخص نیست؛ تأیید مدیر گروه ممکن نیست.")
	}
	if a.HeadedDepts == nil {
		return errF("پیکربندی ناقص تأیید.")
	}
	depts, err := a.HeadedDepts(ctx, actor.StaffID, actor.DepartmentID)
	if err != nil {
		return err
	}
	for _, d := range depts {
		if d == *c.departmentID {
			return nil
		}
	}
	return errF("این فیش متعلق به گروه آموزشی شما نیست.")
}

// assertUniScope: fail-closed university boundary.
func (a *Approvals) assertUniScope(ctx context.Context, user *SessionUser, c *statementCtx) error {
	if c.universityID == nil {
		return errF("دانشگاه استادِ این فیش مشخص نیست؛ تأیید ممکن نیست.")
	}
	if a.CanActUni == nil || !a.CanActUni(ctx, user, *c.universityID) {
		return errF("این فیش متعلق به دانشگاه شما نیست.")
	}
	return nil
}

// ApproveDept step 1 — department-head approval.
func (a *Approvals) ApproveDept(ctx context.Context, user *SessionUser, statementID int64, note *string) (*ApprovalResult, error) {
	if !hasRole(user, "ADMIN") && !hasRole(user, "DEP_HEAD") {
		return nil, errF("دسترسی غیرمجاز.")
	}
	role := actingRole(user, deptRoles)
	var professorUserID int64
	noop := false
	tx, err := a.Engine.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	c, err := loadStatementTx(ctx, tx, statementID)
	if err != nil {
		return nil, err
	}
	if err := a.assertDeptScope(ctx, user, c); err != nil {
		return nil, err
	}
	if c.status == "DEPT_HEAD_APPROVED" || c.status == "DEAN_APPROVED" || c.status == "FINAL_SETTLED" {
		noop = true
	} else if c.status == "REJECTED" {
		return nil, errF("این فیش ردّ نهایی شده است؛ تأیید ممکن نیست.")
	} else if c.status != "DRAFT" && c.status != "MID_TERM_PAID" {
		return nil, errF("وضعیت «%s» قابل تأیید مدیر گروه نیست.", c.status)
	}
	if !noop {
		if _, err := tx.Exec(ctx, `update payroll_statements set status = 'DEPT_HEAD_APPROVED' where id = $1`, c.id); err != nil {
			return nil, err
		}
		if err := recordApprovalTx(ctx, tx, c.id, "DEPT_HEAD", user, role, "APPROVE", c.status, "DEPT_HEAD_APPROVED", note); err != nil {
			return nil, err
		}
		professorUserID = c.professorUserID
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	if noop {
		info := "این فیش قبلاً در همین مرحله یا مراحل بعد تأیید شده است."
		return &ApprovalResult{Ok: true, Info: &info}, nil
	}
	a.Engine.notify(ctx, professorUserID, "PAYROLL_DEPT_APPROVED", "فیش حق‌التدریس شما به تأیید مدیر گروه رسید.")
	return &ApprovalResult{Ok: true}, nil
}

// ApproveDean step 2 — academic deputy approval.
func (a *Approvals) ApproveDean(ctx context.Context, user *SessionUser, statementID int64, note *string) (*ApprovalResult, error) {
	if !hasRole(user, "ADMIN") && !hasRole(user, "VICE_EDU") && !hasRole(user, "EDU_EXPERT") {
		return nil, errF("دسترسی غیرمجاز.")
	}
	role := actingRole(user, deanRoles)
	noop := false
	tx, err := a.Engine.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	c, err := loadStatementTx(ctx, tx, statementID)
	if err != nil {
		return nil, err
	}
	if err := a.assertUniScope(ctx, user, c); err != nil {
		return nil, err
	}
	var professorUserID int64
	if c.status == "DEAN_APPROVED" || c.status == "FINAL_SETTLED" {
		noop = true
	} else if c.status == "REJECTED" {
		return nil, errF("این فیش ردّ نهایی شده است؛ تأیید ممکن نیست.")
	} else if c.status == "DEPT_HEAD_APPROVED" {
		if _, err := tx.Exec(ctx, `update payroll_statements set status = 'DEAN_APPROVED' where id = $1`, c.id); err != nil {
			return nil, err
		}
		if err := recordApprovalTx(ctx, tx, c.id, "DEAN", user, role, "APPROVE", c.status, "DEAN_APPROVED", note); err != nil {
			return nil, err
		}
		professorUserID = c.professorUserID
	} else {
		return nil, errF("پیش از تأیید معاونت آموزشی، مدیر گروه باید فیش را تأیید کند.")
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	if noop {
		info := "این فیش قبلاً به تأیید معاونت آموزشی رسیده است."
		return &ApprovalResult{Ok: true, Info: &info}, nil
	}
	a.Engine.notify(ctx, professorUserID, "PAYROLL_DEAN_APPROVED", "فیش حق‌التدریس شما به تأیید معاونت آموزشی رسید و آمادهٔ تسویهٔ مالی است.")
	return &ApprovalResult{Ok: true}, nil
}

// Return: send back for correction — note required.
func (a *Approvals) Return(ctx context.Context, user *SessionUser, statementID int64, note string) (*ApprovalResult, error) {
	if strings.TrimSpace(note) == "" {
		return nil, errF("برای بازگشت، درج یادداشت اصلاح الزامی است.")
	}
	if !hasRole(user, "ADMIN") && !hasAnyRole(user, returnRoles) {
		return nil, errF("دسترسی غیرمجاز.")
	}
	role := actingRole(user, returnRoles)
	tx, err := a.Engine.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	c, err := loadStatementTx(ctx, tx, statementID)
	if err != nil {
		return nil, err
	}
	if role == "DEP_HEAD" || (!hasRole(user, "ADMIN") && hasRole(user, "DEP_HEAD")) {
		if err := a.assertDeptScope(ctx, user, c); err != nil {
			return nil, err
		}
	}
	if c.status != "DEPT_HEAD_APPROVED" && c.status != "DEAN_APPROVED" {
		return nil, errF("فقط فیشِ تأییدشده (مدیر گروه/معاونت) قابل بازگشت برای اصلاح است.")
	}
	to := "DRAFT"
	if c.midtermPaid > 0 {
		to = "MID_TERM_PAID"
	}
	stage := "DEPT_HEAD"
	if c.status == "DEAN_APPROVED" {
		stage = "DEAN"
	}
	trimmed := strings.TrimSpace(note)
	if _, err := tx.Exec(ctx, `update payroll_statements set status = $1 where id = $2`, to, c.id); err != nil {
		return nil, err
	}
	if err := recordApprovalTx(ctx, tx, c.id, stage, user, role, "RETURN", c.status, to, &trimmed); err != nil {
		return nil, err
	}
	professorUserID := c.professorUserID
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	a.Engine.notify(ctx, professorUserID, "PAYROLL_RETURNED", "فیش حق‌التدریس برای اصلاح بازگردانده شد: "+trimmed)
	return &ApprovalResult{Ok: true}, nil
}

// Reject: final rejection — terminal; note required.
func (a *Approvals) Reject(ctx context.Context, user *SessionUser, statementID int64, note string) (*ApprovalResult, error) {
	if strings.TrimSpace(note) == "" {
		return nil, errF("برای ردّ نهایی، درج دلیل الزامی است.")
	}
	if !hasRole(user, "ADMIN") && !hasAnyRole(user, returnRoles) {
		return nil, errF("دسترسی غیرمجاز.")
	}
	role := actingRole(user, returnRoles)
	tx, err := a.Engine.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	c, err := loadStatementTx(ctx, tx, statementID)
	if err != nil {
		return nil, err
	}
	if role == "DEP_HEAD" || (!hasRole(user, "ADMIN") && hasRole(user, "DEP_HEAD")) {
		if err := a.assertDeptScope(ctx, user, c); err != nil {
			return nil, err
		}
	}
	if c.status == "FINAL_SETTLED" {
		return nil, errF("فیش تسویه‌شده را نمی‌توان رد کرد.")
	}
	if c.status == "REJECTED" {
		info := "این فیش قبلاً رد شده است."
		return &ApprovalResult{Ok: true, Info: &info}, nil
	}
	stage := "DEPT_HEAD"
	if c.status == "DEAN_APPROVED" {
		stage = "DEAN"
	}
	trimmed := strings.TrimSpace(note)
	if _, err := tx.Exec(ctx, `update payroll_statements set status = 'REJECTED' where id = $1`, c.id); err != nil {
		return nil, err
	}
	if err := recordApprovalTx(ctx, tx, c.id, stage, user, role, "REJECT", c.status, "REJECTED", &trimmed); err != nil {
		return nil, err
	}
	professorUserID := c.professorUserID
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	a.Engine.notify(ctx, professorUserID, "PAYROLL_REJECTED", "فیش حق‌التدریس رد شد: "+trimmed)
	return &ApprovalResult{Ok: true}, nil
}

// SettleApproved step 3 — financial settlement with the stage precondition (engine settleFinal).
func (a *Approvals) SettleApproved(ctx context.Context, user *SessionUser, staffID int64) (*ApprovalResult, error) {
	if !hasRole(user, "ADMIN") {
		return nil, errF("دسترسی غیرمجاز.")
	}
	role := actingRole(user, []string{"ADMIN"})
	term, err := a.Engine.CurrentTerm(ctx, nil)
	if err != nil {
		return nil, err
	}
	if term == nil {
		return nil, errF("ترم جاری مشخص نیست.")
	}
	var psID int64
	var status *string
	err = a.Engine.Pool.QueryRow(ctx, `
		select ps.id, ps.status
		  from payroll_statements ps
		  join professor_term_contracts pc on pc.id = ps."contractId"
		 where pc."staffId" = $1 and pc."termId" = $2
		 limit 1`, staffID, term.ID).Scan(&psID, &status)
	if err != nil {
		return nil, errF("ابتدا فیش ترم را محاسبه کنید.")
	}
	st := ""
	if status != nil {
		st = *status
	}
	if st == "FINAL_SETTLED" {
		info := "این فیش قبلاً تسویه شده است."
		return &ApprovalResult{Ok: true, Info: &info}, nil
	}
	if st != "DEAN_APPROVED" {
		return nil, errF("تسویهٔ نهایی فقط پس از تأیید معاونت آموزشی ممکن است (وضعیت فعلی نیازمند طی زنجیرهٔ تأیید است).")
	}
	actorID := user.ID
	termID := term.ID
	amount, _, err := a.Engine.SettleFinal(ctx, staffID, &actorID, &termID, func(tx pgx.Tx, statementID int64) error {
		return recordApprovalTx(ctx, tx, statementID, "FINANCE", user, role, "APPROVE", "DEAN_APPROVED", "FINAL_SETTLED", nil)
	})
	if err != nil {
		return nil, err
	}
	return &ApprovalResult{Ok: true, Amount: &amount}, nil
}

// ApprovalHistoryRow is an approval-history row.
type ApprovalHistoryRow struct {
	ID          int64   `json:"id"`
	StatementID int64   `json:"statementId"`
	Stage       string  `json:"stage"`
	ActorUserID *int64  `json:"actorUserId"`
	ActorRole   *string `json:"actorRole"`
	Action      string  `json:"action"`
	Note        *string `json:"note"`
	CreatedAt   *string `json:"createdAt"`
}

// GetApprovalHistory: approval history of a statement (with university boundary).
func (a *Approvals) GetApprovalHistory(ctx context.Context, user *SessionUser, statementID int64) ([]ApprovalHistoryRow, error) {
	var uniID *int64
	err := a.Engine.Pool.QueryRow(ctx, `
		select st."universityId"
		  from payroll_statements ps
		  join professor_term_contracts pc on pc.id = ps."contractId"
		  join staff st on st.id = pc."staffId"
		 where ps.id = $1`, statementID).Scan(&uniID)
	if err != nil {
		return []ApprovalHistoryRow{}, nil
	}
	if uniID != nil && a.CanActUni != nil && !a.CanActUni(ctx, user, *uniID) {
		return []ApprovalHistoryRow{}, nil
	}
	rows, err := a.Engine.Pool.Query(ctx, `
		select id, "statementId", stage, "actorUserId", "actorRole", action, note, "createdAt"::text
		  from payroll_approvals where "statementId" = $1 order by id`, statementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ApprovalHistoryRow{}
	for rows.Next() {
		var r ApprovalHistoryRow
		if err := rows.Scan(&r.ID, &r.StatementID, &r.Stage, &r.ActorUserID, &r.ActorRole, &r.Action, &r.Note, &r.CreatedAt); err == nil {
			out = append(out, r)
		}
	}
	return out, nil
}

func hasAnyRole(u *SessionUser, roles []string) bool {
	for _, r := range roles {
		if hasRole(u, r) {
			return true
		}
	}
	return false
}
