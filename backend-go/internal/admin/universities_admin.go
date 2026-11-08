// ═══ Universities management (multi-tenant) — admin/universities port ═══
//
// Port of afagh-next/src/app/admin/universities/{actions.ts,UniversitiesClient.tsx}
// (the CRUD core: list / upsert / delete; the Samin connection and logo/brand
// upload flows stay on the Next.js side for now).
package admin

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"backend-go/internal/session"
)

// UniversityAdminRow is one university row of the management list.
type UniversityAdminRow struct {
	ID          int64   `json:"id"`
	Code        string  `json:"code"`
	Title       string  `json:"title"`
	Kind        string  `json:"kind"`
	Status      string  `json:"status"`
	SaminCode   *string `json:"saminCode"`
	Province    *string `json:"province"`
	DissolvedAt *string `json:"dissolvedAt"`
	IsActive    int     `json:"isActive"`
	LogoURL     *string `json:"logoUrl"`
	// Samin connection summary (hasSecret never exposes the secret itself).
	SaminConnected bool    `json:"saminConnected"`
	SaminEnabled   bool    `json:"saminEnabled"`
	LastSyncAt     *string `json:"lastSyncAt"`
}

// ListUniversitiesAdmin ports the page.tsx load: all universities with a
// summary of their Samin connection. This is a platform-level read.
func (s *Service) ListUniversitiesAdmin(ctx context.Context, user *session.User, cookie string) ([]UniversityAdminRow, error) {
	if !isPlatformAdmin(user) {
		return nil, errors.New("فقط مدیر ارشد سامانه.")
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select u.id, u.code, u.title, u.kind, u.status, u."saminCode", u.province,
		       u."dissolvedAt", coalesce(u."isActive",1), u."logoUrl",
		       (c."clientId" is not null), coalesce(c."isEnabled",0) <> 0, c."lastSyncAt"::text
		  from universities u
		  left join samin_connections c on c."universityId" = u.id
		 order by u.code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UniversityAdminRow{}
	for rows.Next() {
		var r UniversityAdminRow
		if err := rows.Scan(&r.ID, &r.Code, &r.Title, &r.Kind, &r.Status, &r.SaminCode,
			&r.Province, &r.DissolvedAt, &r.IsActive, &r.LogoURL,
			&r.SaminConnected, &r.SaminEnabled, &r.LastSyncAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

var uniCodeRe = regexp.MustCompile(`^[A-Z0-9_-]{2,30}$`)

// UpsertUniversityAdmin ports upsertUniversity. A new university is created
// with just code+title (kind default DISSOLVED like the reference); updating
// keeps it active.
func (s *Service) UpsertUniversityAdmin(ctx context.Context, user *session.User, cookie string, id int64, code, title, kind, saminCode string) error {
	if !isPlatformAdmin(user) {
		return errors.New("فقط مدیر ارشد سامانه.")
	}
	code = strings.ToUpper(strings.TrimSpace(code))
	title = strings.TrimSpace(title)
	if code == "" || title == "" {
		return errors.New("کد و عنوان الزامی است.")
	}
	if !uniCodeRe.MatchString(code) {
		return errors.New("کد فقط A-Z 0-9 _ -")
	}
	if kind != "OWN" && kind != "DISSOLVED" && kind != "MERGED" {
		kind = "DISSOLVED"
	}
	var saminPtr *string
	if sc := strings.TrimSpace(saminCode); sc != "" {
		saminPtr = &sc
	}
	if id > 0 {
		tag, err := s.DB.Pool.Exec(ctx, `
			update universities
			   set code = $2, title = $3, kind = $4, "saminCode" = $5, "isActive" = 1
			 where id = $1`, id, code, title, kind, saminPtr)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errors.New("دانشگاه یافت نشد.")
		}
		return nil
	}
	_, err := s.DB.Pool.Exec(ctx, `
		insert into universities (code, title, kind, "saminCode")
		values ($1, $2, $3, $4)
		on conflict do nothing`, code, title, kind, saminPtr)
	return err
}

// DeleteUniversityAdmin ports deleteUniversity. Only an ADMIN may remove a
// university row; database FKs block removal while data still references it.
func (s *Service) DeleteUniversityAdmin(ctx context.Context, user *session.User, cookie string, id int64) error {
	if !isPlatformAdmin(user) {
		return errors.New("فقط مدیر ارشد سامانه.")
	}
	if id <= 0 {
		return errors.New("شناسه نامعتبر است.")
	}
	tag, err := s.DB.Pool.Exec(ctx, `delete from universities where id = $1`, id)
	if err != nil {
		return errors.New("حذف دانشگاه ناموفق بود — ابتدا داده‌های متصل را منتقل کنید.")
	}
	if tag.RowsAffected() == 0 {
		return errors.New("دانشگاه یافت نشد.")
	}
	return nil
}
