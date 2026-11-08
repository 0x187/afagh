// ═══ Sama weekly sync — admin/sama-sync port (status + history) ═══
//
// Port of afagh-next/src/app/admin/sama-sync/{page.tsx,actions.ts} (the read
// side): the active university, its terms, and the latest SAMA_SYNC_APPLY
// runs from the audit chain (listSyncRuns port).
//
// The write side (TSV upload → parse/plan/apply) is intentionally NOT ported
// here: the reference marks the upload UI as temporary and the stable plan is
// a server-side cron; the weekly engine must run on the server with real
// files, so the Go trigger endpoint only reports availability. The frontend
// uses `available` to keep the run button disabled until the cron lands.
package admin

import (
	"context"
	"encoding/json"
	"errors"

	"backend-go/internal/session"
)

// SamaTerm is a term option of the target picker.
type SamaTerm struct {
	TermCode  string `json:"termCode"`
	Title     string `json:"title"`
	IsCurrent int    `json:"isCurrent"`
}

// SamaSyncRun is one recorded apply run (SyncRunRow port).
type SamaSyncRun struct {
	ID      int64          `json:"id"`
	At      string         `json:"at"`
	Actor   *string        `json:"actor"`
	Term    *string        `json:"termCode"`
	Added   int64          `json:"inserted"`
	Grades  int64          `json:"gradesFilled"`
	Details map[string]any `json:"-"`
}

// SamaSyncStatus is the page response.
type SamaSyncStatus struct {
	Available       bool          `json:"available"`
	UniversityTitle string        `json:"universityTitle"`
	Terms           []SamaTerm    `json:"terms"`
	CurrentTermCode *string       `json:"currentTermCode"`
	Runs            []SamaSyncRun `json:"runs"`
}

// SamaSyncStatus ports the page load (listTerms + listSyncRuns).
func (s *Service) SamaSyncStatus(ctx context.Context, user *session.User, cookie string) (*SamaSyncStatus, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال مشخص نیست.")
	}
	st := &SamaSyncStatus{Available: false, Terms: []SamaTerm{}, Runs: []SamaSyncRun{}}

	_ = s.DB.Pool.QueryRow(ctx, `select title from universities where id = $1`, *uniID).Scan(&st.UniversityTitle)
	if st.UniversityTitle == "" {
		st.UniversityTitle = "دانشگاه آفاق"
	}

	trows, err := s.DB.Pool.Query(ctx, `
		select coalesce("termCode",''), title, coalesce("isCurrent",0)
		  from academic_terms
		 where "universityId" = $1
		 order by id desc limit 30`, *uniID)
	if err != nil {
		return nil, err
	}
	for trows.Next() {
		var t SamaTerm
		var isCurrent int
		if err := trows.Scan(&t.TermCode, &t.Title, &isCurrent); err != nil {
			trows.Close()
			return nil, err
		}
		t.IsCurrent = isCurrent
		if isCurrent == 1 {
			code := t.TermCode
			st.CurrentTermCode = &code
		}
		st.Terms = append(st.Terms, t)
	}
	trows.Close()
	if err := trows.Err(); err != nil {
		return nil, err
	}

	// Latest apply runs from the audit chain — the same source as listSyncRuns.
	rrows, err := s.DB.Pool.Query(ctx, `
		select a.id, a."createdAt"::text, a.details, u."firstName" || ' ' || u."lastName"
		  from audit_logs a
		  left join users u on u.id = a."actorUserId"
		 where a.action = 'SAMA_SYNC_APPLY'
		 order by a.id desc limit 10`)
	if err != nil {
		return st, nil // status stays useful even if the audit read fails
	}
	defer rrows.Close()
	for rrows.Next() {
		var (
			r       SamaSyncRun
			details *string
			actor   *string
		)
		if err := rrows.Scan(&r.ID, &r.At, &details, &actor); err != nil {
			return st, nil
		}
		r.Actor = actor
		r.Term = nil
		r.Added = 0
		r.Grades = 0
		if details != nil && *details != "" {
			// audit details are wrapped as {auditFormat, data: "json-string"}.
			var outer map[string]any
			if json.Unmarshal([]byte(*details), &outer) == nil {
				if innerRaw, ok := outer["data"].(string); ok {
					var inner map[string]any
					if json.Unmarshal([]byte(innerRaw), &inner) == nil {
						r.Details = inner
					}
				} else {
					r.Details = outer
				}
			}
		}
		if r.Details != nil {
			if v, ok := r.Details["termCode"].(string); ok {
				r.Term = &v
			}
			r.Added = numAsInt64(r.Details["inserted"])
			r.Grades = numAsInt64(r.Details["gradesFilled"])
		}
		st.Runs = append(st.Runs, r)
	}
	return st, nil
}

func numAsInt64(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case json.Number:
		n, _ := x.Int64()
		return n
	case int64:
		return x
	case int:
		return int64(x)
	}
	return 0
}

// TriggerSamaSync — the manual run trigger. The weekly Sama→Afagh engine is a
// server-side job by design (the browser never sends the plan; it is rebuilt
// server-side from the real file). Until that cron is ported to Go this
// endpoint stays a guarded stub and reports unavailability.
func (s *Service) TriggerSamaSync(ctx context.Context, user *session.User, cookie string) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	return errors.New("موتور اجرای همگام‌سازی سما روی نسخهٔ فعلی فعال نیست؛ اجرای هفتگی باید از سرور (cron) انجام شود. این صفحه فقط وضعیت و سوابق اجرا را نشان می‌دهد.")
}
