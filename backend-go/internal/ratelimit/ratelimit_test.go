package ratelimit

import (
	"context"
	"testing"
	"time"
)

// حالت درون‌حافظه (Redis=nil) — همان سمانتیک INCR+EXPIRE و سقف پنجره.
func TestAllowInMemory(t *testing.T) {
	l := New(nil)
	ctx := context.Background()
	key := "login:acc:test"
	for i := 0; i < 3; i++ {
		ok, _, err := l.Allow(ctx, key, 3, 60)
		if err != nil || !ok {
			t.Fatalf("تلاش %d باید مجاز باشد", i+1)
		}
	}
	ok, retry, err := l.Allow(ctx, key, 3, 60)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("تلاش چهارم باید رد شود")
	}
	if retry < 1 {
		t.Fatalf("retryAfter باید ≥۱ باشد، شد %d", retry)
	}
}

func TestPeekHitCountRelease(t *testing.T) {
	l := New(nil)
	ctx := context.Background()
	key := "stepup:pw:1"

	ok, _, _ := l.Peek(ctx, key, 5, 900)
	if !ok {
		t.Fatal("کلید خالی باید مجاز باشد")
	}
	for i := 1; i <= 5; i++ {
		_ = l.Hit(ctx, key, 900)
		if n, _ := l.Count(ctx, key); n != i {
			t.Fatalf("count=%d want %d", n, i)
		}
	}
	ok, _, _ = l.Peek(ctx, key, 5, 900)
	if ok {
		t.Fatal("پس از ۵ خطا باید قفل شود")
	}
	_ = l.Release(ctx, key)
	if n, _ := l.Count(ctx, key); n != 4 {
		t.Fatalf("پس از release باید ۴ باشد، شد %d", n)
	}
}

// پنجره پس از انقضا باز می‌شود.
func TestAllowWindowExpiry(t *testing.T) {
	l := New(nil)
	ctx := context.Background()
	key := "win"
	if ok, _, _ := l.Allow(ctx, key, 1, 1); !ok {
		t.Fatal("اولین درخواست باید مجاز باشد")
	}
	if ok, _, _ := l.Allow(ctx, key, 1, 1); ok {
		t.Fatal("دومین درخواست در پنجره باید رد شود")
	}
	time.Sleep(1100 * time.Millisecond)
	if ok, _, _ := l.Allow(ctx, key, 1, 1); !ok {
		t.Fatal("پس از انقضای پنجره باید مجاز باشد")
	}
}

// تأخیر تصاعدی — دقیقاً 200*(n+1) با سقف ۱۰ ثانیه.
func TestProgressiveDelayMs(t *testing.T) {
	cases := map[int]int{
		-1: 200, 0: 200, 1: 400, 4: 1000, 49: 10000, 100: 10000,
	}
	for n, want := range cases {
		if got := ProgressiveDelayMs(n); got != want {
			t.Fatalf("ProgressiveDelayMs(%d)=%d want %d", n, got, want)
		}
	}
}

func TestHashKeyPart(t *testing.T) {
	if got := HashKeyPart("0123456789abcdef0123456789abcdef"); got != "0123456789abcdef01234567" {
		t.Fatalf("برش ۲۴ کاراکتری نادرست: %s", got)
	}
}
