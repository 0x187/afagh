// ═══ Expert scopes — admin/expert-scopes port ═══
//
// Port of afagh-next/src/app/admin/expert-scopes/{actions.ts,ExpertScopesClient.tsx}.
// expert_scopes rows (UNIVERSITY | FACULTY | DEPARTMENT | MAJOR) limit an
// EDU_EXPERT user to part of the university; no rows = whole university.
// The "canEditGrades" flag is kept in a CONFIG row when no scope exists.
package admin

import (
	"context"
	"errors"
	"strings"

	"backend-go/internal/session"
)

// ExpertScopeEntry is one scope chip (type + physical id).
type ExpertScopeEntry struct {
	Type string `json:"type"` // UNIVERSITY | FACULTY | DEPARTMENT | MAJOR
	ID   *int64 `json:"id"`
	Uni  *int64 `json:"uni,omitempty"`
}

// ExpertScopeCandidate is one EDU_EXPERT user with its current scopes.
type ExpertScopeCandidate struct {
	UserID        int64              `json:"userId"`
	Name          string             `json:"name"`
	CanEditGrades bool               `json:"canEditGrades"`
	Scopes        []ExpertScopeEntry `json:"scopes"`
}

// ExpertScopeSelect is the picker data for the editor (ScopeSelect port).
type ExpertScopeSelect struct {
	Universities []ExpertScopeOption `json:"universities"`
	Faculties    []ExpertScopeOption `json:"faculties"`
	Departments  []ExpertScopeDept   `json:"departments"`
	Majors       []ExpertScopeMajor  `json:"majors"`
}

// ExpertScopeOption is a simple id+label option.
type ExpertScopeOption struct {
	ID    int64  `json:"id"`
	Label string `json:"label"`
}

// ExpertScopeDept is a department option with its faculty link.
type ExpertScopeDept struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	FacultyID int64  `json:"facultyId"`
}

// ExpertScopeMajor is a major option with its department link.
type ExpertScopeMajor struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	DepartmentID *int64 `json:"departmentId"`
}

// ListExpertScopeCandidates ports listExpertCandidates: all users holding the
// EDU_EXPERT role with their scope rows.
func (s *Service) ListExpertScopeCandidates(ctx context.Context, user *session.User, cookie string) ([]ExpertScopeCandidate, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	rows, err := s.DB.Pool.Query(ctx, `
		select u.id,
		       trim(coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",'')),
		       es."scopeType", es."scopeId", es."universityId",
		       coalesce(es."canEditGrades",0) <> 0
		  from users u
		  join user_roles ur on ur."userId" = u.id
		  join roles r on r.id = ur."roleId" and r.code = 'EDU_EXPERT'
		  left join expert_scopes es on es."userId" = u.id
		 where ($1::int is null or u."universityId" is null or u."universityId" = $1::int)
		 order by u."lastName", u.id`, uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byUser := map[int64]*ExpertScopeCandidate{}
	order := []int64{}
	for rows.Next() {
		var (
			id        int64
			name      string
			scopeType *string
			scopeID   *int64
			scopeUni  *int64
			canEdit   bool
		)
		if err := rows.Scan(&id, &name, &scopeType, &scopeID, &scopeUni, &canEdit); err != nil {
			return nil, err
		}
		c, ok := byUser[id]
		if !ok {
			c = &ExpertScopeCandidate{UserID: id, Name: name, Scopes: []ExpertScopeEntry{}}
			byUser[id] = c
			order = append(order, id)
		}
		if canEdit {
			c.CanEditGrades = true
		}
		if scopeType != nil {
			c.Scopes = append(c.Scopes, ExpertScopeEntry{Type: *scopeType, ID: scopeID, Uni: scopeUni})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]ExpertScopeCandidate, 0, len(order))
	for _, id := range order {
		out = append(out, *byUser[id])
	}
	return out, nil
}

// GetExpertScopeSelect ports getScopeSelect — universities plus the
// faculties/departments/majors visible in the active university.
func (s *Service) GetExpertScopeSelect(ctx context.Context, user *session.User, cookie string) (*ExpertScopeSelect, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	sel := &ExpertScopeSelect{
		Universities: []ExpertScopeOption{},
		Faculties:    []ExpertScopeOption{},
		Departments:  []ExpertScopeDept{},
		Majors:       []ExpertScopeMajor{},
	}

	// Universities are listed whole (the picker assigns cross-university scopes).
	ur, err := s.DB.Pool.Query(ctx, `select id, code, title from universities order by id`)
	if err != nil {
		return nil, err
	}
	for ur.Next() {
		var (
			id          int64
			code, title string
		)
		if err := ur.Scan(&id, &code, &title); err != nil {
			ur.Close()
			return nil, err
		}
		sel.Universities = append(sel.Universities, ExpertScopeOption{ID: id, Label: title + " (" + code + ")"})
	}
	ur.Close()
	if err := ur.Err(); err != nil {
		return nil, err
	}

	// Faculties: only this university (or all for the platform view).
	fr, err := s.DB.Pool.Query(ctx, `
		select id, name from faculties
		 where ($1::int is null or "universityId" = $1::int)
		 order by name`, uniID)
	if err != nil {
		return nil, err
	}
	facByID := map[int64]bool{}
	for fr.Next() {
		var f ExpertScopeOption
		if err := fr.Scan(&f.ID, &f.Label); err != nil {
			fr.Close()
			return nil, err
		}
		facByID[f.ID] = true
		sel.Faculties = append(sel.Faculties, f)
	}
	fr.Close()
	if err := fr.Err(); err != nil {
		return nil, err
	}

	// Departments: of kept faculties (or standalone university-owned ones).
	dr, err := s.DB.Pool.Query(ctx, `
		select d.id, d.name, d."facultyId" from departments d
		 where ($1::int is null or d."universityId" = $1::int)
		 order by d.name`, uniID)
	if err != nil {
		return nil, err
	}
	depByID := map[int64]bool{}
	for dr.Next() {
		var (
			id        int64
			name      string
			facultyID int64
		)
		if err := dr.Scan(&id, &name, &facultyID); err != nil {
			dr.Close()
			return nil, err
		}
		if uniID != nil && len(facByID) > 0 && !facByID[facultyID] {
			continue
		}
		depByID[id] = true
		sel.Departments = append(sel.Departments, ExpertScopeDept{ID: id, Name: name, FacultyID: facultyID})
	}
	dr.Close()
	if err := dr.Err(); err != nil {
		return nil, err
	}

	// Majors: of kept departments.
	mr, err := s.DB.Pool.Query(ctx, `
		select m.id, m.name, m."departmentId" from majors m
		 where ($1::int is null or m."universityId" = $1::int)
		 order by m.name`, uniID)
	if err != nil {
		return nil, err
	}
	for mr.Next() {
		var (
			id           int64
			name         string
			departmentID *int64
		)
		if err := mr.Scan(&id, &name, &departmentID); err != nil {
			mr.Close()
			return nil, err
		}
		if uniID != nil && departmentID != nil && len(depByID) > 0 && !depByID[*departmentID] {
			continue
		}
		sel.Majors = append(sel.Majors, ExpertScopeMajor{ID: id, Name: name, DepartmentID: departmentID})
	}
	mr.Close()
	if err := mr.Err(); err != nil {
		return nil, err
	}
	return sel, nil
}

// SaveExpertScopes ports saveExpertScopes — fully replace the user's scopes
// plus the canEditGrades flag. An empty scope list with the grade flag on
// keeps a single CONFIG row so the flag survives.
func (s *Service) SaveExpertScopes(ctx context.Context, user *session.User, cookie string, targetUserID int64, scopes []ExpertScopeEntry, canEditGrades bool) error {
	if targetUserID <= 0 {
		return errors.New("کاربر نامعتبر است.")
	}
	// The target must be an existing account.
	var exists int
	if err := s.DB.Pool.QueryRow(ctx, `select 1 from users where id = $1`, targetUserID).Scan(&exists); err != nil {
		return errors.New("کاربر یافت نشد.")
	}

	gradeFlag := 0
	if canEditGrades {
		gradeFlag = 1
	}
	type row struct {
		scopeType string
		scopeID   *int64
		uniID     *int64
	}
	vals := []row{}
	for _, sc := range scopes {
		t := strings.ToUpper(strings.TrimSpace(sc.Type))
		if t != "UNIVERSITY" && t != "FACULTY" && t != "DEPARTMENT" && t != "MAJOR" {
			continue
		}
		if t == "UNIVERSITY" {
			if sc.ID != nil && *sc.ID > 0 {
				vals = append(vals, row{scopeType: t, scopeID: nil, uniID: sc.ID})
			}
			continue
		}
		if sc.ID != nil && *sc.ID > 0 {
			uni := sc.Uni
			vals = append(vals, row{scopeType: t, scopeID: sc.ID, uniID: uni})
		}
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from expert_scopes where "userId" = $1`, targetUserID); err != nil {
		return err
	}
	if len(vals) > 0 {
		for _, v := range vals {
			if _, err := tx.Exec(ctx, `
				insert into expert_scopes ("userId","scopeType","scopeId","universityId","canEditGrades")
				values ($1,$2,$3,$4,$5)
				on conflict do nothing`,
				targetUserID, v.scopeType, v.scopeID, v.uniID, gradeFlag); err != nil {
				return err
			}
		}
	} else if canEditGrades {
		// Only the grade flag with no restriction → keep it in a CONFIG row.
		if _, err := tx.Exec(ctx, `
			insert into expert_scopes ("userId","scopeType","scopeId","universityId","canEditGrades")
			values ($1,'CONFIG',null,null,1)
			on conflict do nothing`, targetUserID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
