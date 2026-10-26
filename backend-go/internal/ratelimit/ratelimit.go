// ═══ Rate-Limit سراسری — پورت وفادار از src/lib/rateLimit.ts ═══
//
// شمارندهٔ اتمیک در Redis (INCR + EXPIRE در نخستین شمارش). اگر Redis در
// دسترس نباشد، fallback درون‌حافظه استفاده می‌شود تا هیچ مسیر پرخطر
// «بدون محدودیت» نماند — حتی به قیمت از دست رفتن شمارش پس از ری‌استارت.
// کلید قطع‌کنندهٔ ۳۰ثانیه‌ای (breaker) مانع تلنبار شدن درخواست‌ها هنگام
// قطعی Redis می‌شود (همان BREAKER_MS در TS).
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

// Limiter پیاده‌سازی RateLimiter قرارداد فاز ۱.
type Limiter struct {
	rdb *redis.Client

	mu           sync.Mutex
	mem          map[string]*memCount
	downUntil    time.Time
	onRedisReady bool
}

// New سازنده — rdb می‌تواند nil باشد (حالت فقط درون‌حافظه برای تست/توسعه).
func New(rdb *redis.Client) *Limiter {
	l := &Limiter{rdb: rdb, mem: make(map[string]*memCount)}
	if rdb != nil {
		// ready یعنی اتصال دوباره برقرار شد → breaker بسته شود (همان rlRedis.on('ready'))
		rdb.AddHook(readyHook{l: l})
	}
	return l
}

// readyHook بر پایهٔ هر فرمانِ موفق، breaker را می‌بندد (جایگزین رویداد ready
// ioredis که در go-redis معادل مستقیم ندارد).
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

// Allow پورت rateLimit(): درخواست را می‌شمارد و مجاز بودن را برمی‌گرداند.
// خروجی retryAfterSec فقط وقتی allowed=false معنا دارد.
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

// Peek پورت peekRateLimit(): بررسی بدون شمارش — برای گیت‌هایی که فقط خطاها
// باید بشمارند (مثل ورود: موفقیت نباید سهمیه بسوزاند).
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

// Hit پورت hitRateLimit(): فقط شمارش (بدون بررسی).
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

// Count پورت getRateLimitCount(): شمارش فعلی بدون افزایش.
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

// Release پورت releaseRateLimit(): آزادسازی یک رزرو (برگرداندن یک شمارش).
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

// ProgressiveDelayMs پورت progressiveDelayMs: 200ms، 400ms، … سقف ۱۰ ثانیه.
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

// ProgressiveDelay خواب تصاعدی — فراخواننده باید await کند.
func ProgressiveDelay(ctx context.Context, failCount int) {
	t := time.NewTimer(time.Duration(ProgressiveDelayMs(failCount)) * time.Millisecond)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

// HashKeyPart کوتاه‌سازی sha256 برای کلیدهای حاوی IP/شناسه — معادل sha256(ip).slice(0,24).
func HashKeyPart(hexDigest string) string {
	if len(hexDigest) > 24 {
		return hexDigest[:24]
	}
	return hexDigest
}

// Describe برای پیام لاگ/خطا.
func Describe(key string) string {
	if i := strings.IndexByte(key, ':'); i > 0 {
		return key[:i]
	}
	return fmt.Sprintf("%.16s", key)
}
