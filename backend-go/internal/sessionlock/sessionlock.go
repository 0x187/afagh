// ═══ server-side idle lock — line-by-line port of src/lib/session-lock.ts ═══
//
// Redis keys exactly `sesslock:{id}` and `sessseen:{id}` — the old and new systems
// must see the same lock state. "clear" is written as the value '0' (tombstone)
// so that other processes clear their in-memory mirror (with DEL, a stale mirror could keep a lock in another process for up to 24
// hours). TTL of both is 24 hours.
package sessionlock

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	breakerDuration = 30 * time.Second
	keyTTL          = 24 * time.Hour
)

// SettingsStore minimal settings dependency (SESSION_LOCK_MINUTES and …).
type SettingsStore interface {
	Get(ctx context.Context, key string) (string, error)
	GetNumber(ctx context.Context, key string, fallback float64) float64
}

// Service idle lock with an in-memory mirror during Redis outages.
type Service struct {
	rdb      *redis.Client
	settings SettingsStore

	mu           sync.Mutex
	downUntil    time.Time
	memLock      map[int64]time.Time // userId → lock expiry
	pendingClear map[int64]bool
	seenMem      map[int64]int64 // userId → last activity (ms epoch)
	pendingSeen  map[int64]int64
}

// New constructor — rdb may be nil (in-memory mode for testing/development).
func New(rdb *redis.Client, settings SettingsStore) *Service {
	return &Service{
		rdb: rdb, settings: settings,
		memLock:      make(map[int64]time.Time),
		pendingClear: make(map[int64]bool),
		seenMem:      make(map[int64]int64),
		pendingSeen:  make(map[int64]int64),
	}
}

func lockKey(id int64) string { return fmt.Sprintf("sesslock:%d", id) }
func seenKey(id int64) string { return fmt.Sprintf("sessseen:%d", id) }

func (s *Service) redisAvailable() bool {
	if s.rdb == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return time.Now().After(s.downUntil)
}

func (s *Service) tripBreaker() {
	s.mu.Lock()
	s.downUntil = time.Now().Add(breakerDuration)
	s.mu.Unlock()
}

func (s *Service) sweepLocked(now time.Time) {
	for k, v := range s.memLock {
		if !v.After(now) {
			delete(s.memLock, k)
		}
	}
}

// flushClears retries the missed clears — '0' instead of DEL.
func (s *Service) flushClears(ctx context.Context) {
	s.mu.Lock()
	if len(s.pendingClear) == 0 {
		s.mu.Unlock()
		return
	}
	ids := make([]int64, 0, len(s.pendingClear))
	for id := range s.pendingClear {
		ids = append(ids, id)
	}
	s.mu.Unlock()

	if !s.redisAvailable() {
		return
	}
	for _, id := range ids {
		if err := s.rdb.Set(ctx, lockKey(id), "0", keyTTL).Err(); err != nil {
			s.tripBreaker()
			return
		}
		s.mu.Lock()
		delete(s.pendingClear, id)
		s.mu.Unlock()
	}
}

func (s *Service) flushSeen(ctx context.Context) {
	s.mu.Lock()
	if len(s.pendingSeen) == 0 {
		s.mu.Unlock()
		return
	}
	pending := make(map[int64]int64, len(s.pendingSeen))
	for k, v := range s.pendingSeen {
		pending[k] = v
	}
	s.mu.Unlock()

	if !s.redisAvailable() {
		return
	}
	for id, at := range pending {
		if err := s.rdb.Set(ctx, seenKey(id), strconv.FormatInt(at, 10), keyTTL).Err(); err != nil {
			s.tripBreaker()
			return
		}
		s.mu.Lock()
		if s.pendingSeen[id] == at {
			delete(s.pendingSeen, id)
		}
		s.mu.Unlock()
	}
}

// SetLock activates the idle lock — it is not lifted even by a refresh/new tab.
func (s *Service) SetLock(ctx context.Context, userID int64) error {
	s.mu.Lock()
	delete(s.pendingClear, userID)
	s.memLock[userID] = time.Now().Add(keyTTL)
	s.mu.Unlock()

	if !s.redisAvailable() {
		return nil
	}
	if err := s.rdb.Set(ctx, lockKey(userID), "1", keyTTL).Err(); err != nil {
		s.tripBreaker()
		return nil
	}
	return nil
}

// ClearLock reopens with the correct password — and records an "activity" from this moment.
func (s *Service) ClearLock(ctx context.Context, userID int64) error {
	s.mu.Lock()
	delete(s.memLock, userID)
	s.pendingClear[userID] = true
	s.mu.Unlock()
	s.flushClears(ctx)
	// unlock = activity: the idle clock is counted anew from this moment.
	s.TouchActivity(ctx, userID)
	return nil
}

// IsLocked is the user currently locked? (Redis is the source of truth, the mirror only for outages)
func (s *Service) IsLocked(ctx context.Context, userID int64) bool {
	s.mu.Lock()
	s.sweepLocked(time.Now())
	s.mu.Unlock()
	s.flushClears(ctx)

	if s.redisAvailable() {
		v, err := s.rdb.Get(ctx, lockKey(userID)).Result()
		if err != nil && err != redis.Nil {
			s.tripBreaker()
		} else if err == nil {
			switch v {
			case "1":
				s.mu.Lock()
				s.memLock[userID] = time.Now().Add(keyTTL)
				s.mu.Unlock()
				return true
			case "0":
				s.mu.Lock()
				delete(s.memLock, userID)
				s.mu.Unlock()
				return false
			}
			// not the key; if this process has an active in-memory lock, the previous write had not
			// arrived → record it again (fail-closed), otherwise it is open.
			s.mu.Lock()
			m, ok := s.memLock[userID]
			s.mu.Unlock()
			if ok && m.After(time.Now()) {
				_ = s.rdb.Set(ctx, lockKey(userID), "1", keyTTL).Err()
				return true
			}
			return false
		}
	}
	// during a Redis outage → in-memory mirror (fail-closed)
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.memLock[userID]
	return ok && m.After(time.Now())
}

// TouchActivity records one user "activity".
func (s *Service) TouchActivity(ctx context.Context, userID int64) {
	at := time.Now().UnixMilli()
	cutoff := at - keyTTL.Milliseconds()
	s.mu.Lock()
	for k, v := range s.seenMem {
		if v < cutoff {
			delete(s.seenMem, k)
		}
	}
	s.seenMem[userID] = at
	s.pendingSeen[userID] = at
	s.mu.Unlock()
	s.flushSeen(ctx)
}

// LastActivityAt time of the last activity — nil means not yet recorded.
func (s *Service) LastActivityAt(ctx context.Context, userID int64) *int64 {
	if s.redisAvailable() {
		s.flushSeen(ctx)
		v, err := s.rdb.Get(ctx, seenKey(userID)).Result()
		if err == nil {
			if n, perr := strconv.ParseInt(v, 10, 64); perr == nil {
				s.mu.Lock()
				s.seenMem[userID] = n
				s.mu.Unlock()
				return &n
			}
		} else if err != redis.Nil {
			s.tripBreaker()
		} else {
			s.mu.Lock()
			n, ok := s.seenMem[userID]
			s.mu.Unlock()
			if ok {
				return &n
			}
			return nil
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if n, ok := s.seenMem[userID]; ok {
		return &n
	}
	return nil
}

// IsIdle has more than timeoutMin minutes passed since the last activity? (no update)
func (s *Service) IsIdle(ctx context.Context, userID int64, timeoutMin float64) bool {
	if !(timeoutMin > 0) {
		return false
	}
	at := s.LastActivityAt(ctx, userID)
	if at == nil {
		return false // first observation — no basis for idleness
	}
	return time.Since(time.UnixMilli(*at)) > time.Duration(timeoutMin*float64(time.Minute))
}

// EvaluateIdleLock evaluation at render/request time:
//  1. explicit lock flag is on → locked
//  2. idle beyond the limit → record the lock right here and return true
//  3. actively working → record this visit as an "activity" and continue without a lock
func (s *Service) EvaluateIdleLock(ctx context.Context, userID int64, timeoutMin float64) bool {
	if !(timeoutMin > 0) {
		return false
	}
	if s.IsLocked(ctx, userID) {
		return true
	}
	if s.IsIdle(ctx, userID, timeoutMin) {
		_ = s.SetLock(ctx, userID)
		return true
	}
	s.TouchActivity(ctx, userID)
	return false
}

func clampMinutes(n float64) float64 {
	if n <= 0 || n != n {
		return 0
	}
	if n > 24*60 {
		return 24 * 60
	}
	return float64(int(n))
}

// ResolveIdleTimeoutMinutes lock timeout cap based on roles —
// SESSION_LOCK_MINUTES_ROLES is an optional JSON like {"ADMIN":30,"STUDENT":0}.
func (s *Service) ResolveIdleTimeoutMinutes(ctx context.Context, roles []string) float64 {
	fallback := 15.0
	if s.settings != nil {
		fallback = s.settings.GetNumber(ctx, "SESSION_LOCK_MINUTES", 15)
	}
	raw := ""
	if s.settings != nil {
		raw, _ = s.settings.Get(ctx, "SESSION_LOCK_MINUTES_ROLES")
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return clampMinutes(fallback)
	}
	// minimal dependency-free JSON parsing: {"ROLE": number, ...}
	parsed := parseRoleMinutes(raw)
	for _, r := range roles {
		if v, ok := parsed[r]; ok && v != nil {
			return clampMinutes(*v)
		}
	}
	return clampMinutes(fallback)
}

// ResolveReauthMinutes cap on long absence — the effective value is never less than
// "idle lock cap + 5 minutes" (same as resolveReauthMinutes).
func (s *Service) ResolveReauthMinutes(ctx context.Context, idleTimeoutMin float64) float64 {
	n := clampMinutes(30)
	if s.settings != nil {
		n = clampMinutes(s.settings.GetNumber(ctx, "SESSION_REAUTH_MINUTES", 30))
	}
	if n <= 0 {
		return 0
	}
	if idleTimeoutMin > 0 && n < idleTimeoutMin+5 {
		n = idleTimeoutMin + 5
	}
	return n
}

// parseRoleMinutes parses a simple {string: number|null} JSON — null/empty string means
// "skip this role" (matching TS: undefined/null/” → continue).
func parseRoleMinutes(raw string) map[string]*float64 {
	out := map[string]*float64{}
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "{") || !strings.HasSuffix(raw, "}") {
		return out
	}
	body := strings.TrimSpace(raw[1 : len(raw)-1])
	if body == "" {
		return out
	}
	for _, part := range splitTopLevel(body) {
		kv := strings.SplitN(part, ":", 2)
		if len(kv) != 2 {
			continue
		}
		key := strings.Trim(strings.TrimSpace(kv[0]), `"`)
		val := strings.TrimSpace(kv[1])
		if val == "null" || val == `""` || val == "" {
			out[key] = nil
			continue
		}
		if f, err := strconv.ParseFloat(strings.Trim(val, `"`), 64); err == nil {
			v := f
			out[key] = &v
		}
	}
	return out
}

// splitTopLevel splits members of a flat JSON object (no real nesting).
func splitTopLevel(body string) []string {
	parts := []string{}
	depth, last := 0, 0
	inStr := false
	for i, r := range body {
		switch r {
		case '"':
			inStr = !inStr
		case '{', '[':
			if !inStr {
				depth++
			}
		case '}', ']':
			if !inStr {
				depth--
			}
		case ',':
			if !inStr && depth == 0 {
				parts = append(parts, body[last:i])
				last = i + 1
			}
		}
	}
	if last < len(body) {
		parts = append(parts, body[last:])
	}
	return parts
}
