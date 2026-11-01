// ═══ Authentication — faithful port of afagh-next/src/lib/auth.ts (phase 1) ═══
//
// Go backend core for login/logout/password change/account switch. File layout:
//
//	authn.go          — service, configuration, injected interfaces, result types
//	password.go       — scrypt Verify/Hash + dummy hash (constant-time padding)
//	cookies.go        — cookie transport matrix (port of proxy-trust.ts) + write/clear
//	login.go          — login/chooseLoginAccount + same-person expansion
//	changepassword.go — password change with the same validation messages
//	switch.go         — switch to a same-person account (port of account-switch.ts)
//	persian.go        — toEnDigits (Persian/Arabic digit normalization)
//	staffncmap_gen.go — generated staff code → national ID map
//
// The response contract matches Next.js (envelope {ok, error?, ...}) so the SPA works
// on both backends without logic changes; error messages are exactly the auth.ts and
// login.actions.ts strings.
//
// Environment variables (same afagh-next contract; since internal/config is not owned
// by this phase, they are read directly via os.Getenv):
//
//	NODE_ENV                    — «production» ⇒ production mode (Secure cookie required)
//	AFAGH_PUBLIC_BASE_URL       — https detection for Secure in auto mode
//	AFAGH_COOKIE_SECURE         — auto|true|false (default auto)
//	AFAGH_COOKIE_SAMESITE       — auto|lax|none|strict (default lax)
//	AFAGH_SESSION_COOKIE_PREFIX — «host» ⇒ dual-write of the __Host-afagh_session name
//	AFAGH_SESSION_MAX_HOURS     — absolute session limit (default 4, range 1..24)
//	AFAGH_SCRYPT_N              — scrypt N parameter (default 16384, allowed floor)
package authn

import (
	"context"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/logger"
	"backend-go/internal/session"
)

// loggerFor is the module logger — only for infrastructure warnings (broken limiter, invalid N).
func loggerFor() *logger.Logger { return logger.For("authn") }

// Injected interfaces — signatures exactly from the phase 1 contract (docs/rewrite/phase1-contracts.md).
// Implementations live in infra packages; here we are only consumers.

// RateLimiter is an atomic rate limit (INCR+EXPIRE equivalent) — implementation: internal/ratelimit.
type RateLimiter interface {
	Allow(ctx context.Context, key string, limit int, windowSec int) (allowed bool, retryAfterSec int, err error)
	Count(ctx context.Context, key string) (int, error)
	Release(ctx context.Context, key string) error
}

// TokenSigner signs/validates account-selection tokens — implementation: internal/verification.
type TokenSigner interface {
	Sign(ctx context.Context, payload map[string]any, ttlSec int) (string, error)
	Verify(ctx context.Context, token string) (payload map[string]any, ok bool, err error)
}

// LockClearer clears the session idle lock — implementation: internal/sessionlock.
type LockClearer interface {
	ClearLock(ctx context.Context, userID int64) error
}

// UNKNOWN_CLIENT_IP is the same as in proxy-trust.ts — the rate-limit key
// when no identity is available.
const UNKNOWN_CLIENT_IP = "unknown"

// Error messages — exactly the auth.ts and login.actions.ts strings (Persian, unchanged).
const (
	msgLoginFailed      = "شناسه یا رمز نادرست است."
	msgChooseSignedOut  = "نشست انتخاب حساب منقضی شده است. دوباره وارد شوید."
	msgChooseInvalidAcc = "حساب معتبر نیست."
	msgChooseInactive   = "حساب غیرفعال است."
	msgRateLimitGeneric = "تلاش بیش از حد مجاز. چند دقیقه دیگر دوباره تلاش کنید."
	msgSignFailed       = "خطای داخلی در آماده‌سازی انتخاب حساب. لطفاً با کد پرسنلی/دانشجویی هر حساب جداگانه وارد شوید."
	msgUserNotFound     = "کاربر یافت نشد."
)

// LoginRateLimitError means the login limit from one IP is exhausted — the HTTP handler turns it into the
// generic login.actions.ts message (and status 429); raw text is never returned.
type LoginRateLimitError struct {
	RetryAfterSec int
}

func (e *LoginRateLimitError) Error() string { return "LOGIN_RATE_LIMITED" }

// LoginCandidate is the display summary for the «انتخاب حساب» page — same LoginCandidate.
type LoginCandidate struct {
	ID              int64    `json:"id"`
	Name            string   `json:"name"`
	StaffCodes      []string `json:"staffCodes"`
	UniversityTitle *string  `json:"universityTitle"`
	Roles           []string `json:"roles"`
}

// LoginResult is the multi-state login result — the HTTP handler converts it to the contract envelope.
type LoginResult struct {
	OK         bool
	Error      string
	MustChange bool
	NeedChoice bool
	Token      string
	Candidates []LoginCandidate
}

// SimpleResult is the result of choose-account / change-password / switch-account.
type SimpleResult struct {
	OK         bool
	Error      string
	MustChange bool
}

// Config holds the behavioral values authn needs — populated from ConfigFromEnv so that, without
// depending on internal/config (outside this phase's ownership), the same afagh-next ENV vars
// are read.
type Config struct {
	Production          bool   // NODE_ENV == "production"
	PublicBaseURL       string // AFAGH_PUBLIC_BASE_URL
	CookieSecure        string // AFAGH_COOKIE_SECURE
	CookieSameSite      string // AFAGH_COOKIE_SAMESITE
	SessionCookiePrefix string // AFAGH_SESSION_COOKIE_PREFIX (lowercased)
	SessionMaxHours     int    // Absolute session limit — port of SESSION_MAX_HOURS
}

// ConfigFromEnv reads configuration from ENV — variable names exactly as afagh-next.
func ConfigFromEnv() Config {
	return Config{
		Production:          strings.TrimSpace(os.Getenv("NODE_ENV")) == "production",
		PublicBaseURL:       os.Getenv("AFAGH_PUBLIC_BASE_URL"),
		CookieSecure:        os.Getenv("AFAGH_COOKIE_SECURE"),
		CookieSameSite:      os.Getenv("AFAGH_COOKIE_SAMESITE"),
		SessionCookiePrefix: strings.ToLower(strings.TrimSpace(os.Getenv("AFAGH_SESSION_COOKIE_PREFIX"))),
		SessionMaxHours:     sessionMaxHours(os.Getenv("AFAGH_SESSION_MAX_HOURS")),
	}
}

// Service holds all authentication logic on the schema-owner pool — the only place sessions are created.
type Service struct {
	Pool   *pgxpool.Pool
	Store  *session.Store
	Cfg    Config
	Rate   RateLimiter
	Signer TokenSigner
	Locks  LockClearer
}

// NewService creates the service; the phase 0 shared session Store is built from the same pool
// so cookie dual-read and the sessions table stay identical between the two services.
func NewService(pool *pgxpool.Pool, cfg Config, rate RateLimiter, signer TokenSigner, locks LockClearer) *Service {
	return &Service{
		Pool:   pool,
		Store:  session.NewStore(pool),
		Cfg:    cfg,
		Rate:   rate,
		Signer: signer,
		Locks:  locks,
	}
}

// allowRate checks the rate limit. Error policy (structural difference from TS): the TS implementation never
// returns an error (it has an in-memory fallback); if it still errors despite the fallback,
// we do not block login (fail-open) and only log — locking the whole system
// because of a broken limiter is more dangerous than a temporary limit breach. (Noted in the port report.)
func (s *Service) allowRate(ctx context.Context, key string, limit, windowSec int) bool {
	if s.Rate == nil {
		return true
	}
	allowed, _, err := s.Rate.Allow(ctx, key, limit, windowSec)
	if err != nil {
		loggerFor().Error("rate_limit_error", map[string]any{"key": key, "error": err.Error()})
		return true
	}
	return allowed
}

// countRate returns the key's current count (for exponential backoff) — error ⇒ 0 (same as .catch(() => 0)).
func (s *Service) countRate(ctx context.Context, key string) int {
	if s.Rate == nil {
		return 0
	}
	n, err := s.Rate.Count(ctx, key)
	if err != nil {
		return 0
	}
	return n
}

// releaseRate releases the reservation (returns the count) — errors are ignored,
// same as releaseRateLimit in TS, which has its own internal fallback.
func (s *Service) releaseRate(ctx context.Context, keys ...string) {
	if s.Rate == nil {
		return
	}
	for _, k := range keys {
		_ = s.Rate.Release(ctx, k)
	}
}

// clearLock clears the idle lock — errors are always ignored
// (same as clearSessionLock(userId).catch(() => {}) in auth.ts).
func (s *Service) clearLock(ctx context.Context, userID int64) {
	if s.Locks == nil {
		return
	}
	_ = s.Locks.ClearLock(ctx, userID)
}
