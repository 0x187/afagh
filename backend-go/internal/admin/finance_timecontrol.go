// ═══ Finance posting time control — port of lib/finance-time-control.ts + api route ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"backend-go/internal/jalali"
	"backend-go/internal/session"
)

// AccountingPeriod: fiscal period.
type AccountingPeriod struct {
	ID         int64   `json:"id"`
	PeriodName *string `json:"periodName"`
	OpensAt    string  `json:"opensAt"`
	ClosesAt   string  `json:"closesAt"`
	IsLocked   bool    `json:"isLocked"`
}

// LockState: lock state for UI.
type LockState struct {
	Configured   bool              `json:"configured"`
	Locked       bool              `json:"locked"`
	EntryAllowed bool              `json:"entryAllowed"`
	Reason       string            `json:"reason"`
	Period       *AccountingPeriod `json:"period"`
	Now          string            `json:"now"`
}

// latestPeriod: latest posted period (row with the largest id).
func (s *Service) latestPeriod(ctx context.Context) (*AccountingPeriod, error) {
	var p AccountingPeriod
	var name *string
	var opens, closes time.Time
	var locked bool
	err := s.DB.Pool.QueryRow(ctx, `
		select id, period_name, opens_at, closes_at, is_locked
		  from accounting_periods order by id desc limit 1`).
		Scan(&p.ID, &name, &opens, &closes, &locked)
	if err != nil {
		return nil, nil
	}
	p.PeriodName = name
	p.OpensAt = opens.UTC().Format(time.RFC3339)
	p.ClosesAt = closes.UTC().Format(time.RFC3339)
	p.IsLocked = locked
	return &p, nil
}

// financeNow: current time text for messages (Solar Hijri).
func financeNow(t time.Time) string {
	j := jalali.ToJalaliFromTime(t)
	return jalali.FaDigits(fmt.Sprintf("%04d/%02d/%02d %02d:%02d", j.Y, j.M, j.D, t.Hour(), t.Minute()))
}

// GetLockState port of getLockState.
func (s *Service) GetLockState(ctx context.Context, user *session.User, uniCookie string) (*LockState, error) {
	now := time.Now()
	row, err := s.latestPeriod(ctx)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return &LockState{
			Configured: false, Locked: false, EntryAllowed: true,
			Reason: "دورهٔ مالی تعریف نشده است — ثبت مالی در حال حاضر محدودیتی ندارد.",
			Period: nil, Now: now.UTC().Format(time.RFC3339),
		}, nil
	}
	opens, _ := time.Parse(time.RFC3339, row.OpensAt)
	closes, _ := time.Parse(time.RFC3339, row.ClosesAt)
	name := "#" + fmt.Sprintf("%d", row.ID)
	if row.PeriodName != nil && strings.TrimSpace(*row.PeriodName) != "" {
		name = strings.TrimSpace(*row.PeriodName)
	}
	entryAllowed := true
	reason := fmt.Sprintf("دورهٔ مالی «%s» باز است؛ ثبت مالی مجاز است.", name)
	switch {
	case row.IsLocked:
		entryAllowed = false
		reason = fmt.Sprintf("ثبت مالی مجاز نیست: دورهٔ مالی «%s» توسط مدیر قفل شده است.", name)
	case now.Before(opens):
		entryAllowed = false
		reason = fmt.Sprintf("ثبت مالی مجاز نیست: زمان ثبت (%s) پیش از آغاز دورهٔ مالی «%s» (%s تا %s) است.",
			financeNow(now), name, financeNow(opens), financeNow(closes))
	case now.After(closes):
		entryAllowed = false
		reason = fmt.Sprintf("ثبت مالی مجاز نیست: زمان ثبت (%s) پس از پایان دورهٔ مالی «%s» (%s تا %s) است.",
			financeNow(now), name, financeNow(opens), financeNow(closes))
	}
	return &LockState{
		Configured: true, Locked: row.IsLocked, EntryAllowed: entryAllowed,
		Reason: reason, Period: row, Now: now.UTC().Format(time.RFC3339),
	}, nil
}

// SavePeriodInput: period save input.
type SavePeriodInput struct {
	ID         int64  `json:"id"`
	PeriodName string `json:"periodName"`
	OpensAt    string `json:"opensAt"`
	ClosesAt   string `json:"closesAt"`
	IsLocked   bool   `json:"isLocked"`
}

// SaveAccountingPeriod port of POST time-control — create/update + audit.
func (s *Service) SaveAccountingPeriod(ctx context.Context, user *session.User, uniCookie string, in SavePeriodInput) (*LockState, error) {
	opens, err1 := time.Parse(time.RFC3339, in.OpensAt)
	closes, err2 := time.Parse(time.RFC3339, in.ClosesAt)
	if err1 != nil || err2 != nil {
		// Attempt with datetime-local format ("2006-01-02T15:04")
		if o, e1 := time.Parse("2006-01-02T15:04", in.OpensAt); e1 == nil {
			opens, err1 = o, nil
		}
		if c, e2 := time.Parse("2006-01-02T15:04", in.ClosesAt); e2 == nil {
			closes, err2 = c, nil
		}
	}
	if err1 != nil || err2 != nil {
		return nil, errors.New("تاریخ شروع/پایان دوره نامعتبر است")
	}
	if !closes.After(opens) {
		return nil, errors.New("پایان دوره باید پس از آغاز آن باشد")
	}
	if len([]rune(in.PeriodName)) > 150 {
		return nil, errors.New("پارامترهای نامعتبر (نام دوره، تاریخ شروع و پایان الزامی است)")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	details := fmt.Sprintf(`{"periodName":%q,"opensAt":%q,"closesAt":%q,"isLocked":%v}`,
		strings.TrimSpace(in.PeriodName), opens.UTC().Format(time.RFC3339), closes.UTC().Format(time.RFC3339), in.IsLocked)
	if in.ID > 0 {
		var exists bool
		_ = tx.QueryRow(ctx, `select exists(select 1 from accounting_periods where id = $1 for update)`, in.ID).Scan(&exists)
		if !exists {
			return nil, errors.New("دورهٔ مالی یافت نشد")
		}
		if _, err := tx.Exec(ctx, `
			update accounting_periods set period_name = $2, opens_at = $3, closes_at = $4, is_locked = $5, updated_at = now()
			 where id = $1`, in.ID, cleanStr(in.PeriodName), opens, closes, in.IsLocked); err != nil {
			return nil, err
		}
		if err := s.writeAdminAuditTx(ctx, tx, user.ID, "FINANCE_PERIOD_UPDATED", "accounting_periods", in.ID, details); err != nil {
			return nil, err
		}
	} else {
		var id int64
		if err := tx.QueryRow(ctx, `
			insert into accounting_periods (period_name, opens_at, closes_at, is_locked)
			values ($1,$2,$3,$4) returning id`,
			cleanStr(in.PeriodName), opens, closes, in.IsLocked).Scan(&id); err != nil {
			return nil, errors.New("خطا در ذخیرهٔ دورهٔ مالی")
		}
		if err := s.writeAdminAuditTx(ctx, tx, user.ID, "FINANCE_PERIOD_CREATED", "accounting_periods", id, details); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetLockState(ctx, user, uniCookie)
}
