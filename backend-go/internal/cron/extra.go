// ═══ Added crons — port of api/cron/{greetings, graduation-scan, ═══
// ═══ messenger-link-purge, bi-refresh} as methods on cron.Engine ═══
//
//	Each job has the same conditions/messages as Next; the HTTP route and secret come from
//	internal/httpapi/cron_extra.go (x-cron-secret, fail-closed).
//	GET is status-only (no side effects); actual execution only via POST.
package cron

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"backend-go/internal/bi"
	"backend-go/internal/graduation"
	"backend-go/internal/logger"
	"backend-go/internal/messaging"
)

// collectRows is the minimal pgx rows interface for collecting recipients.
type collectRows interface {
	Next() bool
	Scan(dest ...any) error
	Close()
}

// Graduation service — since Engine has no field for it and cron.go is shared,
// main.go calls cron.SetGraduationService(adminAPI.Graduation) once.
var auxGrad *graduation.Service

// SetGraduationService passes the graduation service to the scan cron (from main).
func SetGraduationService(g *graduation.Service) { auxGrad = g }

var extraLog = logger.For("cron.extra")

// settingRaw reads keys that are not yet in PhaseOneDefs —
// 1) system_settings table  2) ENV  3) default (the messaging service provides this reader).
func (e *Engine) settingRaw(ctx context.Context, key, env, fallback string) string {
	return messaging.SettingRaw(ctx, messaging.New(e.Pool, e.Settings), key, env, fallback)
}

// ─────────────────── greetings — automatic congratulations ───────────────────

// greetingText is the text of a generic message from settings; placeholders are filled with actual values.
func (e *Engine) greetingText(ctx context.Context, key, env, fallback string, vars map[string]string) string {
	t := strings.TrimSpace(e.settingRaw(ctx, key, env, fallback))
	if t == "" {
		t = fallback
	}
	for k, v := range vars {
		t = strings.ReplaceAll(t, "{"+k+"}", v)
	}
	return t
}

// runBirthdayGreetings daily birthday greetings: active users whose birthday month/day
// (Gregorian) matches today. Deduplication: each user only once per day (BIRTHDAY).
func (e *Engine) runBirthdayGreetings(ctx context.Context) (map[string]any, error) {
	done := map[int64]bool{}
	rows, err := e.Pool.Query(ctx, `
		select distinct "userId" from notification_deliveries
		 where "eventCode" = 'BIRTHDAY' and "createdAt" >= CURRENT_DATE`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			done[id] = true
		}
	}
	rows.Close()

	type cand struct {
		ID        int64
		FirstName *string
	}
	rows, err = e.Pool.Query(ctx, `
		select id, "firstName" from users
		 where "isActive" = 1
		   and to_char("birthDate", 'MM-DD') = to_char(NOW(), 'MM-DD')
		 limit 5000`)
	if err != nil {
		return nil, err
	}
	cands := []cand{}
	for rows.Next() {
		var c cand
		if rows.Scan(&c.ID, &c.FirstName) == nil {
			cands = append(cands, c)
		}
	}
	rows.Close()

	tpl := e.greetingText(ctx, "GREET_BIRTHDAY_TEXT", "GREET_BIRTHDAY_TEXT",
		"🎂 {name} عزیز، تولدت مبارک! دانشگاه آفاق برایت سالی سرشار از موفقیت آرزو می‌کند.", nil)
	sent, skipped := 0, 0
	for _, c := range cands {
		if done[c.ID] {
			skipped++
			continue
		}
		name := "دوست عزیز"
		if c.FirstName != nil && strings.TrimSpace(*c.FirstName) != "" {
			name = strings.TrimSpace(*c.FirstName)
		}
		e.notifyUser(ctx, c.ID, "BIRTHDAY", strings.ReplaceAll(tpl, "{name}", name))
		sent++
	}
	return map[string]any{"found": len(cands), "sent": sent, "skipped": skipped}, nil
}

// runTermStartGreetings bulk term-start greetings: terms whose class start date
// is today. Recipients are only two groups: students currently studying in this term
// (registered for courses and status=ACTIVE) and professors teaching in this term.
// Channels come from GREET_TERM_CHANNELS (default only INAPP so no SMS cost is incurred).
// Deduplication per user+term (eventCode=TERM_START_<termId>).
func (e *Engine) runTermStartGreetings(ctx context.Context) (map[string]any, error) {
	raw := strings.ToUpper(strings.TrimSpace(e.settingRaw(ctx, "GREET_TERM_CHANNELS", "GREET_TERM_CHANNELS", "INAPP")))
	channels := []string{}
	for _, c := range strings.Split(raw, ",") {
		if c = strings.TrimSpace(c); c != "" {
			channels = append(channels, c)
		}
	}

	type term struct {
		ID           int64
		UniversityID *int64
		Title        string
	}
	rows, err := e.Pool.Query(ctx, `
		select id, "universityId", title from academic_terms
		 where "startDate"::date = CURRENT_DATE and "termType" in ('NORMAL','SUMMER')
		 limit 20`)
	if err != nil {
		return nil, err
	}
	terms := []term{}
	for rows.Next() {
		var t term
		if rows.Scan(&t.ID, &t.UniversityID, &t.Title) == nil {
			terms = append(terms, t)
		}
	}
	rows.Close()

	sent, skipped := 0, 0
	for _, t := range terms {
		if t.UniversityID == nil {
			continue
		}
		code := fmt.Sprintf("TERM_START_%d", t.ID)
		done := map[int64]bool{}
		drows, err := e.Pool.Query(ctx, `
			select distinct "userId" from notification_deliveries
			 where "eventCode" = $1 and "createdAt" >= CURRENT_DATE - interval '2 days'`, code)
		if err != nil {
			return nil, err
		}
		for drows.Next() {
			var id int64
			if drows.Scan(&id) == nil {
				done[id] = true
			}
		}
		drows.Close()

		// ── Recipients: students studying in the term + professors teaching the same term ──
		stuRows, err := e.Pool.Query(ctx, `
			select distinct users.id from students
			  join enrollments on enrollments."studentId" = students.id
			  join course_offerings on course_offerings.id = enrollments."offeringId"
			  join users on users.id = students."userId"
			 where course_offerings."termId" = $1 and students.status = 'ACTIVE' and users."isActive" = 1
			 limit 60000`, t.ID)
		if err != nil {
			return nil, err
		}
		profRows, err := e.Pool.Query(ctx, `
			select distinct users.id from staff
			  join offering_professors on offering_professors."staffId" = staff.id
			  join course_offerings on course_offerings.id = offering_professors."offeringId"
			  join users on users.id = staff."userId"
			 where course_offerings."termId" = $1 and users."isActive" = 1
			 limit 60000`, t.ID)
		if err != nil {
			stuRows.Close()
			return nil, err
		}

		tpl := e.greetingText(ctx, "GREET_TERM_TEXT", "GREET_TERM_TEXT",
			"🎓 سال تحصیلی جدید ({term}) آغاز شد! دانشگاه آفاق نیمسالی موفق برایتان آرزو می‌کند. برنامهٔ کلاسی خود را در پورتال ببینید.",
			map[string]string{"term": t.Title})
		members := []int64{}
		seen := map[int64]bool{}
		collect := func(rows collectRows) {
			defer rows.Close()
			for rows.Next() {
				var id int64
				if rows.Scan(&id) == nil && !seen[id] {
					seen[id] = true
					members = append(members, id)
				}
			}
		}
		collect(stuRows)
		collect(profRows)

		for _, id := range members {
			if done[id] {
				skipped++
				continue
			}
			done[id] = true // A person who is both a student and a professor of the term should receive the message once
			e.notifyUserChannels(ctx, id, code, tpl, channels)
			sent++
		}
		extraLog.Info("term_start_greeted", logger.Fields{"termId": t.ID, "sent": sent, "members": len(members)})
	}
	return map[string]any{"terms": len(terms), "sent": sent, "skipped": skipped}, nil
}

// RunGreetingsCron ports runGreetingScans — failure of each sub-scan yields a zero result for that
// section (the same catch as in TS) and never brings down the whole job.
func (e *Engine) RunGreetingsCron(ctx context.Context) (map[string]any, error) {
	birthdays := map[string]any{"found": 0, "sent": 0, "skipped": 0}
	if b, err := e.runBirthdayGreetings(ctx); err != nil {
		extraLog.Error("birthday_scan_failed", logger.Fields{"error": err.Error()})
	} else {
		birthdays = b
	}
	termStarts := map[string]any{"terms": 0, "sent": 0, "skipped": 0}
	if t, err := e.runTermStartGreetings(ctx); err != nil {
		extraLog.Error("termstart_scan_failed", logger.Fields{"error": err.Error()})
	} else {
		termStarts = t
	}
	return map[string]any{"birthdays": birthdays, "termStarts": termStarts}, nil
}

// ─────────────────── graduation-scan — graduation scan ───────────────────

// RunGraduationScanCron is the scheduled graduation scan — it calls the existing service
// (backend-go/internal/graduation — Scan with GRAD_AUTO_SCAN/force).
func (e *Engine) RunGraduationScanCron(ctx context.Context, force bool) (map[string]any, error) {
	if auxGrad == nil {
		return nil, errors.New("سرویس فارغ‌التحصیلی به موتور کرون متصل نیست (cron.SetGraduationService در main.go).")
	}
	res, err := auxGrad.Scan(ctx, nil, nil, force)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"scanned":     res.Scanned,
		"opened":      res.Opened,
		"alreadyOpen": res.AlreadyOpen,
		"notEligible": res.NotEligible,
		"opinions":    res.Opinions,
	}, nil
}

// ─────────────────── messenger-link-purge — token cleanup ───────────────────

// RunLinkPurgeCron daily cleanup of messenger connection tokens
// (used or expired more than one day ago).
func (e *Engine) RunLinkPurgeCron(ctx context.Context) (map[string]any, error) {
	svc := messaging.New(e.Pool, e.Settings)
	deleted, err := svc.PurgeExpiredLinkTokens(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"deleted": deleted}, nil
}

// ─────────────────── bi-refresh — BI cache refresh ───────────────────

// RunBiRefreshCron offline refresh of business intelligence reports — calls the existing bi service
// (backend-go/internal/bi — RefreshAllCaches: management dashboard,
// facilities analysis and the word cloud of all professors).
func (e *Engine) RunBiRefreshCron(ctx context.Context, termID *int64) (map[string]any, error) {
	svc := bi.New(e.Pool, e.Settings)
	res, err := svc.RefreshAllCaches(ctx, termID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"termId":     res.TermID,
		"staff":      res.Staff,
		"rooms":      res.Rooms,
		"wordClouds": res.WordClouds,
		"durationMs": res.DurationMs,
	}, nil
}

// BiCacheStatus BI cache status for the status-only GET.
func (e *Engine) BiCacheStatus(ctx context.Context) (any, error) {
	return bi.New(e.Pool, e.Settings).CacheStatus(ctx)
}
