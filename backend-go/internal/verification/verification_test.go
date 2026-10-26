package verification

import (
	"context"
	"strings"
	"testing"
)

type fakeSettings map[string]string

func (f fakeSettings) Get(_ context.Context, key string) (string, error) {
	return f[key], nil
}

func TestSignVerifyRoundTrip(t *testing.T) {
	s := New(fakeSettings{"TICKET_TOKEN_SECRET": "unit-test-secret-1234567890abcdef"})
	ctx := context.Background()
	tok, err := s.Sign(ctx, map[string]any{"uids": "1,2", "ident": "31412001"}, 300)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(tok, "T1.") {
		t.Fatalf("قالب توکن نادرست: %s", tok)
	}
	payload, ok, err := s.Verify(ctx, tok)
	if err != nil || !ok {
		t.Fatalf("توکن معتبر باید تأیید شود: %v", err)
	}
	if payload["uids"] != "1,2" || payload["ident"] != "31412001" {
		t.Fatalf("payload نادرست: %v", payload)
	}
	if _, hasJti := payload["jti"]; !hasJti {
		t.Fatal("jti باید در payload باشد")
	}
}

func TestVerifyRejectsTamperedAndExpired(t *testing.T) {
	s := New(fakeSettings{"TICKET_TOKEN_SECRET": "unit-test-secret-1234567890abcdef"})
	ctx := context.Background()

	tok, err := s.Sign(ctx, map[string]any{"uid": 1}, 300)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(tok, ".")
	tampered := parts[0] + "." + parts[1] + "x." + parts[2]
	if _, ok, _ := s.Verify(ctx, tampered); ok {
		t.Fatal("توکن دستکاری‌شده نباید تأیید شود")
	}

	expired, err := s.Sign(ctx, map[string]any{"uid": 1}, -10)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := s.Verify(ctx, expired); ok || err != ErrExpired {
		t.Fatalf("توکن منقضی باید ErrExpired بدهد: ok=%v err=%v", ok, err)
	}

	if _, ok, err := s.Verify(ctx, "garbage"); ok || err != ErrMalformed {
		t.Fatalf("توکن بدشکل باید ErrMalformed بدهد: %v", err)
	}
}

// چرخش نرم کلید: توکنِ امضاشده با کلید قبلی باید معتبر بماند.
func TestPreviousSecretRotation(t *testing.T) {
	oldSettings := fakeSettings{"TICKET_TOKEN_SECRET": "old-secret-1234567890abcdefgh"}
	oldSigner := New(oldSettings)
	ctx := context.Background()
	tok, err := oldSigner.Sign(ctx, map[string]any{"uid": 7}, 300)
	if err != nil {
		t.Fatal(err)
	}

	rotated := New(fakeSettings{
		"TICKET_TOKEN_SECRET":          "new-secret-1234567890abcdefgh",
		"PREVIOUS_TICKET_TOKEN_SECRET": "old-secret-1234567890abcdefgh",
	})
	if _, ok, err := rotated.Verify(ctx, tok); !ok || err != nil {
		t.Fatalf("توکن کلید قبلی باید در دورهٔ چرخش معتبر باشد: %v", err)
	}
}

func TestMissingSecret(t *testing.T) {
	s := New(fakeSettings{})
	if _, err := s.Sign(context.Background(), map[string]any{}, 60); err == nil {
		t.Fatal("نبودِ کلید باید خطا بدهد")
	}
}
