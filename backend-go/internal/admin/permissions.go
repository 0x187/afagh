// ═══ RBAC permissions matrix — admin/permissions port ═══
//
// Port of afagh-next/src/app/admin/permissions/{actions.ts,AdminPermissionsClient.tsx}.
// Everything sits on the real roles / permissions / role_permissions tables;
// role permission sets are replaced atomically and every change lands in the
// audit chain. The ADMIN role always keeps system:manage_roles so the platform
// can never lock itself out of this page.
package admin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"backend-go/internal/session"
)

// PermissionRow is one catalog entry.
type PermissionRow struct {
	ID          int64  `json:"id"`
	Code        string `json:"code"`
	Title       string `json:"title"`
	Category    string `json:"category"`
	Description string `json:"description"`
}

// RoleRow is one role with its users count and permission codes.
type RoleRow struct {
	ID          int64    `json:"id"`
	Code        string   `json:"code"`
	Title       string   `json:"title"`
	IsSystem    bool     `json:"isSystem"`
	UserCount   int      `json:"userCount"`
	Permissions []string `json:"permissions"`
}

// PermissionsWorkspace is the full page data (PermissionsWorkspace port).
type PermissionsWorkspace struct {
	Roles       []RoleRow       `json:"roles"`
	Permissions []PermissionRow `json:"permissions"`
	Categories  []string        `json:"categories"`
}

// isPlatformAdmin only the ADMIN role may mutate roles/permissions.
func isPlatformAdmin(user *session.User) bool {
	for _, r := range user.Roles {
		if r == "ADMIN" {
			return true
		}
	}
	return false
}

// permAudit appends one chained audit_logs row (same pattern as the rest of
// this codebase: take the last hash, hash prev|action|entity|id|now).
func (s *Service) permAudit(ctx context.Context, actorUserID int64, action, entityType string, entityID int64, details map[string]any) {
	var prev string
	_ = s.DB.Pool.QueryRow(ctx, `select coalesce(hash,'') from audit_logs order by id desc limit 1`).Scan(&prev)
	dj, _ := json.Marshal(details)
	nowISO := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	sum := sha256.Sum256([]byte(prev + "|" + action + "|" + entityType + "|" + fmt.Sprint(entityID) + "|" + nowISO))
	_, _ = s.DB.Pool.Exec(ctx, `
		insert into audit_logs ("actorUserId", action, "entityType", "entityId", details, "prevHash", hash)
		values ($1, $2, $3, $4, $5, $6, $7)`,
		actorUserID, action, entityType, entityID, string(dj), prev, hex.EncodeToString(sum[:]))
}

// GetPermissionsWorkspace ports getPermissionsWorkspaceAction: roles + user
// counts + catalog + current matrix. Categories follow catalog order, not
// alphabetical, so the table layout stays stable.
func (s *Service) GetPermissionsWorkspace(ctx context.Context, user *session.User, cookie string) (*PermissionsWorkspace, error) {
	if !isPlatformAdmin(user) {
		return nil, errors.New("فقط مدیر ارشد سامانه.")
	}
	ws := &PermissionsWorkspace{Roles: []RoleRow{}, Permissions: []PermissionRow{}, Categories: []string{}}

	roleRows := map[int64]*RoleRow{}
	order := []int64{}
	rr, err := s.DB.Pool.Query(ctx, `select id, code, title, coalesce("isSystem",0) <> 0 from roles order by id`)
	if err != nil {
		return nil, err
	}
	for rr.Next() {
		var id int64
		var code, title string
		var isSystem bool
		if err := rr.Scan(&id, &code, &title, &isSystem); err != nil {
			rr.Close()
			return nil, err
		}
		roleRows[id] = &RoleRow{ID: id, Code: code, Title: title, IsSystem: isSystem, Permissions: []string{}}
		order = append(order, id)
	}
	rr.Close()
	if err := rr.Err(); err != nil {
		return nil, err
	}

	codeByID := map[int64]string{}
	pr, err := s.DB.Pool.Query(ctx, `
		select id, code, title, coalesce(category,'عمومی'), coalesce(description,'')
		  from permissions order by id`)
	if err != nil {
		return nil, err
	}
	for pr.Next() {
		var p PermissionRow
		if err := pr.Scan(&p.ID, &p.Code, &p.Title, &p.Category, &p.Description); err != nil {
			pr.Close()
			return nil, err
		}
		codeByID[p.ID] = p.Code
		ws.Permissions = append(ws.Permissions, p)
		if !containsString(ws.Categories, p.Category) {
			ws.Categories = append(ws.Categories, p.Category)
		}
	}
	pr.Close()
	if err := pr.Err(); err != nil {
		return nil, err
	}

	mr, err := s.DB.Pool.Query(ctx, `select "roleId", "permissionId" from role_permissions`)
	if err != nil {
		return nil, err
	}
	for mr.Next() {
		var roleID, permID int64
		if err := mr.Scan(&roleID, &permID); err != nil {
			mr.Close()
			return nil, err
		}
		if code, ok := codeByID[permID]; ok {
			if role, ok := roleRows[roleID]; ok {
				role.Permissions = append(role.Permissions, code)
			}
		}
	}
	mr.Close()
	if err := mr.Err(); err != nil {
		return nil, err
	}

	cr, err := s.DB.Pool.Query(ctx, `select "roleId", count(*)::int from user_roles group by "roleId"`)
	if err == nil {
		for cr.Next() {
			var roleID int64
			var n int
			if cr.Scan(&roleID, &n) == nil {
				if role, ok := roleRows[roleID]; ok {
					role.UserCount = n
				}
			}
		}
		cr.Close()
	}

	for _, id := range order {
		ws.Roles = append(ws.Roles, *roleRows[id])
	}
	return ws, nil
}

// SaveRolePermissions ports saveRolePermissionsAction — replace the whole
// permission set of one role in a transaction (delete + insert), with the
// ADMIN lock-out guard and an audit row.
func (s *Service) SaveRolePermissions(ctx context.Context, user *session.User, cookie string, roleID int64, codes []string) (int, error) {
	if !isPlatformAdmin(user) {
		return 0, errors.New("فقط مدیر ارشد سامانه.")
	}
	if roleID <= 0 {
		return 0, errors.New("شناسهٔ نقش نامعتبر است.")
	}
	var roleCode string
	if err := s.DB.Pool.QueryRow(ctx, `select code from roles where id = $1 limit 1`, roleID).Scan(&roleCode); err != nil {
		return 0, errors.New("نقش یافت نشد.")
	}

	// Deduplicate + trim the requested codes.
	requested := []string{}
	seen := map[string]bool{}
	for _, c := range codes {
		c = strings.TrimSpace(c)
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		requested = append(requested, c)
	}

	// Resolve codes → ids; unknown codes are rejected like the reference.
	permIDs := []int64{}
	if len(requested) > 0 {
		known := map[string]int64{}
		krows, err := s.DB.Pool.Query(ctx, `select id, code from permissions where code = any($1::text[])`, requested)
		if err != nil {
			return 0, err
		}
		for krows.Next() {
			var id int64
			var code string
			if krows.Scan(&id, &code) == nil {
				known[code] = id
			}
		}
		krows.Close()
		unknown := []string{}
		for _, c := range requested {
			if id, ok := known[c]; ok {
				permIDs = append(permIDs, id)
			} else {
				unknown = append(unknown, c)
			}
		}
		if len(unknown) > 0 {
			return 0, errors.New("این مجوزها در کاتالوگ سامانه تعریف نشده‌اند: " + strings.Join(unknown, "، "))
		}
	}

	// Lock-out guard: ADMIN must keep system:manage_roles.
	if roleCode == "ADMIN" && !seen["system:manage_roles"] {
		return 0, errors.New("مجوز «مدیریت نقش و دسترسی» را نمی‌توان از نقش مدیر ارشد برداشت (خطر قفل‌شدن سامانه).")
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from role_permissions where "roleId" = $1`, roleID); err != nil {
		return 0, err
	}
	if len(permIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			insert into role_permissions ("roleId","permissionId")
			select $1, x from unnest($2::int[]) as t(x)
			on conflict do nothing`, roleID, permIDs); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	s.permAudit(ctx, user.ID, "ROLE_PERMISSIONS_UPDATED", "roles", roleID, map[string]any{
		"roleCode": roleCode, "after": requested,
	})
	return len(permIDs), nil
}

var roleCodeRe = regexp.MustCompile(`^[A-Z][A-Z0-9_]{2,31}$`)

// CreateRole ports createRoleAction — a new non-system role.
func (s *Service) CreateRole(ctx context.Context, user *session.User, cookie string, code, title string) (int64, error) {
	if !isPlatformAdmin(user) {
		return 0, errors.New("فقط مدیر ارشد سامانه.")
	}
	code = strings.ToUpper(strings.TrimSpace(code))
	// Collapse whitespace runs into underscores like the reference.
	code = regexp.MustCompile(`\s+`).ReplaceAllString(code, "_")
	title = strings.TrimSpace(title)
	if code == "" || title == "" {
		return 0, errors.New("کد و عنوان نقش الزامی است.")
	}
	if !roleCodeRe.MatchString(code) {
		return 0, errors.New("کد نقش باید ۳ تا ۳۲ نویسهٔ لاتین بزرگ، رقم یا زیرخط باشد و با حرف شروع شود (مثل: REGISTRATION_STAFF).")
	}
	var dup int64
	if err := s.DB.Pool.QueryRow(ctx, `select id from roles where code = $1 limit 1`, code).Scan(&dup); err == nil {
		return 0, errors.New("نقشی با کد «" + code + "» از قبل وجود دارد.")
	}
	var newID int64
	if err := s.DB.Pool.QueryRow(ctx, `
		insert into roles (code, title, "isSystem") values ($1, $2, 0) returning id`, code, title).
		Scan(&newID); err != nil {
		return 0, errors.New("ایجاد نقش ناموفق بود.")
	}
	s.permAudit(ctx, user.ID, "ROLE_CREATED", "roles", newID, map[string]any{"code": code, "title": title})
	return newID, nil
}

// DeleteRole ports deleteRoleAction — only non-system roles with no user.
func (s *Service) DeleteRole(ctx context.Context, user *session.User, cookie string, roleID int64) error {
	if !isPlatformAdmin(user) {
		return errors.New("فقط مدیر ارشد سامانه.")
	}
	var (
		roleCode, roleTitle string
		isSystem            bool
	)
	if err := s.DB.Pool.QueryRow(ctx, `select code, title, coalesce("isSystem",0) <> 0 from roles where id = $1 limit 1`, roleID).
		Scan(&roleCode, &roleTitle, &isSystem); err != nil {
		return errors.New("نقش یافت نشد.")
	}
	if isSystem {
		return errors.New("نقش‌های سیستمی سامانه قابل حذف نیستند.")
	}
	var used int
	if err := s.DB.Pool.QueryRow(ctx, `select count(*)::int from user_roles where "roleId" = $1`, roleID).Scan(&used); err == nil && used > 0 {
		return errors.New("این نقش به " + itoa(int64(used)) + " کاربر تخصیص یافته است؛ ابتدا نقش کاربران را تغییر دهید.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from role_permissions where "roleId" = $1`, roleID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from roles where id = $1`, roleID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.permAudit(ctx, user.ID, "ROLE_DELETED", "roles", roleID, map[string]any{"code": roleCode, "title": roleTitle})
	return nil
}
