package sessionlock

import (
	"context"
	"testing"
	"time"
)

func nowMinusMinutes(m int) int64 {
	return time.Now().Add(-time.Duration(m) * time.Minute).UnixMilli()
}

// fakeSettings fake settings for tests — same contract as SettingsStore.
type fakeSettings map[string]string

func (f fakeSettings) Get(_ context.Context, key string) (string, error) { return f[key], nil }
func (f fakeSettings) GetNumber(_ context.Context, key string, fallback float64) float64 {
	switch f[key] {
	case "30":
		return 30
	case "20":
		return 20
	case "15":
		return 15
	case "0":
		return 0
	}
	return fallback
}

func TestRoleMinutesParsing(t *testing.T) {
	s := New(nil, fakeSettings{})
	ctx := context.Background()

	// valid JSON: an existing role wins, 0 means disabled
	s = New(nil, fakeSettings{
		"SESSION_LOCK_MINUTES":       "15",
		"SESSION_LOCK_MINUTES_ROLES": `{"ADMIN":30,"STUDENT":0}`,
	})
	if got := s.ResolveIdleTimeoutMinutes(ctx, []string{"ADMIN"}); got != 30 {
		t.Fatalf("ADMIN باید ۳۰ دقیقه باشد: %v", got)
	}
	if got := s.ResolveIdleTimeoutMinutes(ctx, []string{"STUDENT"}); got != 0 {
		t.Fatalf("STUDENT باید ۰ باشد: %v", got)
	}
	// the first matching role wins
	if got := s.ResolveIdleTimeoutMinutes(ctx, []string{"STUDENT", "ADMIN"}); got != 0 {
		t.Fatalf("اولین نقش منطبق (STUDENT) باید برنده شود: %v", got)
	}
	// missing role → default
	if got := s.ResolveIdleTimeoutMinutes(ctx, []string{"PROFESSOR"}); got != 15 {
		t.Fatalf("نقش ناموجود باید پیش‌فرض ۱۵ باشد: %v", got)
	}
	// malformed JSON → default
	s = New(nil, fakeSettings{
		"SESSION_LOCK_MINUTES_ROLES": "not-json",
	})
	if got := s.ResolveIdleTimeoutMinutes(ctx, []string{"ADMIN"}); got != 15 {
		t.Fatalf("JSON خراب باید پیش‌فرض بدهد: %v", got)
	}
}

func TestReauthMinutesFloor(t *testing.T) {
	ctx := context.Background()
	s := New(nil, fakeSettings{"SESSION_REAUTH_MINUTES": "20"})
	// 30-minute lock ⇒ reauth at least 35
	if got := s.ResolveReauthMinutes(ctx, 30); got != 35 {
		t.Fatalf("reauth باید حداقل idle+5 باشد: %v", got)
	}
	if got := s.ResolveReauthMinutes(ctx, 10); got != 20 {
		t.Fatalf("reauth باید مقدار تنظیم‌شده را حفظ کند: %v", got)
	}
}

func TestLockLifecycleInMemory(t *testing.T) {
	s := New(nil, nil)
	ctx := context.Background()

	if s.IsLocked(ctx, 7) {
		t.Fatal("کاربر تازه نباید قفل باشد")
	}
	_ = s.SetLock(ctx, 7)
	if !s.IsLocked(ctx, 7) {
		t.Fatal("پس از SetLock باید قفل باشد")
	}
	_ = s.ClearLock(ctx, 7)
	if s.IsLocked(ctx, 7) {
		t.Fatal("پس از ClearLock نباید قفل باشد")
	}
}

func TestIdleEvaluation(t *testing.T) {
	s := New(nil, nil)
	ctx := context.Background()

	// first observation: no basis for idleness
	if s.EvaluateIdleLock(ctx, 8, 15) {
		t.Fatal("نخستین مشاهده نباید قفل کند")
	}
	// simulate idleness: move the activity back 20 minutes
	s.mu.Lock()
	s.seenMem[8] = nowMinusMinutes(20)
	s.mu.Unlock()
	if !s.EvaluateIdleLock(ctx, 8, 15) {
		t.Fatal("بیکاری ۲۰ دقیقه‌ای با سقف ۱۵ باید قفل کند")
	}
	if !s.IsLocked(ctx, 8) {
		t.Fatal("قفل باید ثبت شده باشد (نه فقط گزارش)")
	}
}

func TestNoLockWhenTimeoutDisabled(t *testing.T) {
	s := New(nil, nil)
	ctx := context.Background()
	s.TouchActivity(ctx, 9)
	s.mu.Lock()
	s.seenMem[9] = nowMinusMinutes(120)
	s.mu.Unlock()
	if s.EvaluateIdleLock(ctx, 9, 0) {
		t.Fatal("سقف ۰ یعنی هرگز قفل نشود")
	}
}
