// ═══ قفل بیکاری سرور-محور — پورت خط‌به‌خط src/lib/session-lock.ts ═══
//
// کلیدهای Redis عیناً `sesslock:{id}` و `sessseen:{id}` — سیستم قدیم و جدید
// باید یک وضعیت قفل را ببینند. «پاک‌سازی» با مقدار '0' (سنگ‌قبر) نوشته می‌شود
// تا پروسه‌های دیگر آینهٔ حافظه‌ای خود را پاک کنند (با DEL، آینهٔ کهنه تا ۲۴
// ساعت می‌توانست در پروسهٔ دیگر قفل نگه دارد). TTL هر دو ۲۴ ساعت.
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

// SettingsStore حداقل وابستگی تنظیمات (SESSION_LOCK_MINUTES و …).
type SettingsStore interface {
	Get(ctx context.Context, key string) (string, error)
	GetNumber(ctx context.Context, key string, fallback float64) float64
}

// Service قفل بیکاری با آینهٔ درون‌حافظه هنگام قطعی Redis.
type Service struct {
	rdb      *redis.Client
	settings SettingsStore

	mu           sync.Mutex
	downUntil    time.Time
	memLock      map[int64]time.Time // userId → انقضای قفل
	pendingClear map[int64]bool
	seenMem      map[int64]int64 // userId → آخرین فعالیت (ms epoch)
	pendingSeen  map[int64]int64
}

// New سازنده — rdb می‌تواند nil باشد (حالت درون‌حافظه برای تست/توسعه).
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

// flushClears تلاش دوباره برای پاک‌سازی‌های عقب‌افتاده — '0' به‌جای DEL.
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

// SetLock فعال‌سازی قفل بیکاری — با رفرش/تب جدید هم برداشته نمی‌شود.
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

// ClearLock بازگشایی با رمز درست — و ثبت «فعالیت» از این لحظه.
func (s *Service) ClearLock(ctx context.Context, userID int64) error {
	s.mu.Lock()
	delete(s.memLock, userID)
	s.pendingClear[userID] = true
	s.mu.Unlock()
	s.flushClears(ctx)
	// بازگشایی = فعالیت: ساعت بیکاری از این لحظه از نو شمرده شود.
	s.TouchActivity(ctx, userID)
	return nil
}

// IsLocked آیا کاربر هم‌اکنون قفل است؟ (Redis منبع حقیقت است، آینه فقط برای قطعی)
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
			// کلید نیست؛ اگر این پروسه قفلِ فعال در حافظه دارد، نوشتن قبلی نرسیده
			// بود → دوباره ثبت کن (fail-closed)، وگرنه باز است.
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
	// دوران قطعی Redis → آینهٔ درون‌حافظه (fail-closed)
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.memLock[userID]
	return ok && m.After(time.Now())
}

// TouchActivity ثبت یک «فعالیت» کاربر.
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

// LastActivityAt زمان آخرین فعالیت — nil یعنی هنوز ثبت نشده.
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

// IsIdle آیا از آخرین فعالیت بیش از timeoutMin دقیقه گذشته؟ (بدون به‌روزرسانی)
func (s *Service) IsIdle(ctx context.Context, userID int64, timeoutMin float64) bool {
	if !(timeoutMin > 0) {
		return false
	}
	at := s.LastActivityAt(ctx, userID)
	if at == nil {
		return false // نخستین مشاهده — مبنایی برای بیکاری نیست
	}
	return time.Since(time.UnixMilli(*at)) > time.Duration(timeoutMin*float64(time.Minute))
}

// EvaluateIdleLock ارزیابی هنگام رندر/درخواست:
//  1. پرچم قفل صریح روشن → قفل
//  2. بیکاری بیش از حد → قفل را همین‌جا ثبت کن و true
//  3. در حال کار → همین بازدید «فعالیت» ثبت و بدون قفل ادامه بده
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

// ResolveIdleTimeoutMinutes سقف قفل بر پایهٔ نقش‌ها —
// SESSION_LOCK_MINUTES_ROLES یک JSON اختیاری مثل {"ADMIN":30,"STUDENT":0}.
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
	// پارس مینیمال JSON بدون وابستگی: {"ROLE": number, ...}
	parsed := parseRoleMinutes(raw)
	for _, r := range roles {
		if v, ok := parsed[r]; ok && v != nil {
			return clampMinutes(*v)
		}
	}
	return clampMinutes(fallback)
}

// ResolveReauthMinutes سقف «غیبت طولانی» — مقدار مؤثر هرگز کمتر از
// «سقف قفل بیکاری + ۵ دقیقه» نیست (همان resolveReauthMinutes).
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

// parseRoleMinutes پارس JSON ساده {string: number|null} — null/رشتهٔ خالی یعنی
// «این نقش را نادیده بگیر» (مطابق TS: undefined/null/” → continue).
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

// splitTopLevel جداکردن اعضای یک آبجکت تخت JSON (بدون تودرتویی واقعی).
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
