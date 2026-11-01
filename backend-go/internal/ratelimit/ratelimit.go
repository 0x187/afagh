// ═══ Global rate limit — faithful port of src/lib/rateLimit.ts ═══
//
// Atomic counter in Redis (INCR + EXPIRE on the first count). If Redis is
// unavailable, an in-memory fallback is used so that no high-risk path
// is left 'unlimited' — even at the cost of losing counts after a restart.
// The 30-second breaker key prevents requests from piling up during
// a Redis outage (same as BREAKER_MS in TS).
package ratelimit

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

const breakerDuration = 30 * time.Second

type memCount struct {
	count   int
	resetAt time.Time
}

// Limiter implements the RateLimiter contract of phase 1.
type Limiter struct {
	rdb *redis.Client

	mu        sync.Mutex
	mem       map[string]*memCount
	downUntil time.Time
}

// New is the constructor — rdb may be nil (in-memory-only mode for tests/development).
func New(rdb *redis.Client) *Limiter {
	l := &Limiter{rdb: rdb, mem: make(map[string]*memCount)}
	if rdb != nil {
		// ready means the connection was re-established -> the breaker should close (same as rlRedis.on('ready'))
		rdb.AddHook(readyHook{l: l})
	}
	return l
}

// readyHook closes the breaker on every successful command (a replacement for the ready
// event of ioredis, which go-redis has no direct equivalent of).
type readyHook struct{ l *Limiter }

func (h readyHook) DialHook(next redis.DialHook) redis.DialHook { return next }
func (h readyHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		err := next(ctx, cmd)
		if err == nil {
			h.l.mu.Lock()
			h.l.downUntil = time.Time{}
			h.l.mu.Unlock()
		}
		return err
	}
}
func (h readyHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error { return next(ctx, cmds) }
}

func (l *Limiter) redisAvailable() bool {
	if l.rdb == nil {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return time.Now().After(l.downUntil)
}

func (l *Limiter) tripBreaker() {
	l.mu.Lock()
	l.downUntil = time.Now().Add(breakerDuration)
	l.mu.Unlock()
}

func (l *Limiter) memSweepLocked(now time.Time) {
	if len(l.mem) > 10000 {
		for k, v := range l.mem {
			if !v.resetAt.After(now) {
				delete(l.mem, k)
			}
		}
	}
}

// Allow ports rateLimit(): counts the request and returns whether it is allowed.
// The retryAfterSec output is only meaningful when allowed=false.
func (l *Limiter) Allow(ctx context.Context, key string, limit, windowSec int) (bool, int, error) {
	rkey := "rl:" + key
	if l.redisAvailable() {
		n, err := l.rdb.Incr(ctx, rkey).Result()
		if err == nil {
			if n == 1 {
				_ = l.rdb.Expire(ctx, rkey, time.Duration(windowSec)*time.Second).Err()
			}
			if n > int64(limit) {
				ttl, terr := l.rdb.TTL(ctx, rkey).Result()
				retry := int(ttl / time.Second)
				if terr != nil || retry < 1 {
					retry = windowSec
				}
				return false, retry, nil
			}
			return true, 0, nil
		}
		l.tripBreaker()
	}

	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.memSweepLocked(now)
	rec, ok := l.mem[rkey]
	if !ok || !rec.resetAt.After(now) {
		l.mem[rkey] = &memCount{count: 1, resetAt: now.Add(time.Duration(windowSec) * time.Second)}
		return true, 0, nil
	}
	rec.count++
	if rec.count > limit {
		retry := int(time.Until(rec.resetAt)/time.Second) + 1
		return false, retry, nil
	}
	return true, 0, nil
}

// Peek ports peekRateLimit(): check without counting — for gates that must only count
// failures (e.g. login: a success must not burn the quota).
func (l *Limiter) Peek(ctx context.Context, key string, limit, windowSec int) (bool, int, error) {
	rkey := "rl:" + key
	if l.redisAvailable() {
		n, err := l.rdb.Get(ctx, rkey).Int()
		if err == redis.Nil {
			return true, 0, nil
		}
		if err == nil {
			if n >= limit {
				ttl, terr := l.rdb.TTL(ctx, rkey).Result()
				retry := int(ttl / time.Second)
				if terr != nil || retry < 1 {
					retry = windowSec
				}
				return false, retry, nil
			}
			return true, 0, nil
		}
		l.tripBreaker()
	}

	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	rec, ok := l.mem[rkey]
	if ok && rec.resetAt.After(now) && rec.count >= limit {
		return false, int(time.Until(rec.resetAt)/time.Second) + 1, nil
	}
	return true, 0, nil
}

// Hit ports hitRateLimit(): count only (no check).
func (l *Limiter) Hit(ctx context.Context, key string, windowSec int) error {
	rkey := "rl:" + key
	if l.redisAvailable() {
		n, err := l.rdb.Incr(ctx, rkey).Result()
		if err == nil {
			if n == 1 {
				_ = l.rdb.Expire(ctx, rkey, time.Duration(windowSec)*time.Second).Err()
			}
			return nil
		}
		l.tripBreaker()
	}

	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.memSweepLocked(now)
	rec, ok := l.mem[rkey]
	if !ok || !rec.resetAt.After(now) {
		l.mem[rkey] = &memCount{count: 1, resetAt: now.Add(time.Duration(windowSec) * time.Second)}
	} else {
		rec.count++
	}
	return nil
}

// Count ports getRateLimitCount(): current count without incrementing.
func (l *Limiter) Count(ctx context.Context, key string) (int, error) {
	rkey := "rl:" + key
	if l.redisAvailable() {
		n, err := l.rdb.Get(ctx, rkey).Int()
		if err == redis.Nil {
			return 0, nil
		}
		if err == nil {
			return n, nil
		}
		l.tripBreaker()
	}

	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if rec, ok := l.mem[rkey]; ok && rec.resetAt.After(now) {
		return rec.count, nil
	}
	return 0, nil
}

// Release ports releaseRateLimit(): releases a reservation (returns one count).
func (l *Limiter) Release(ctx context.Context, key string) error {
	rkey := "rl:" + key
	if l.redisAvailable() {
		n, err := l.rdb.Decr(ctx, rkey).Result()
		if err == nil {
			if n <= 0 {
				_ = l.rdb.Del(ctx, rkey).Err()
			}
			return nil
		}
		l.tripBreaker()
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	if rec, ok := l.mem[rkey]; ok && rec.resetAt.After(time.Now()) {
		rec.count--
		if rec.count <= 0 {
			delete(l.mem, rkey)
		}
	}
	return nil
}

// ProgressiveDelayMs ports progressiveDelayMs: 200ms, 400ms, … capped at 10 seconds.
func ProgressiveDelayMs(failCount int) int {
	if failCount < 0 {
		failCount = 0
	}
	ms := 200 * (failCount + 1)
	if ms > 10_000 {
		ms = 10_000
	}
	return ms
}

// ProgressiveDelay is a progressive sleep — the caller must await it.
func ProgressiveDelay(ctx context.Context, failCount int) {
	t := time.NewTimer(time.Duration(ProgressiveDelayMs(failCount)) * time.Millisecond)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

// HashKeyPart is a shortened sha256 for keys containing IP/identifiers — equivalent to sha256(ip).slice(0,24).
func HashKeyPart(hexDigest string) string {
	if len(hexDigest) > 24 {
		return hexDigest[:24]
	}
	return hexDigest
}

// Describe is for log/error messages.
func Describe(key string) string {
	if i := strings.IndexByte(key, ':'); i > 0 {
		return key[:i]
	}
	return fmt.Sprintf("%.16s", key)
}
