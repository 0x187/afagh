// ═══ پیکربندی متمرکز سامانه — پورت وفادار از src/lib/settings.ts ═══
//
// ترتیب اولویت هر مقدار: ۱) جدول system_settings  ۲) متغیر محیطی  ۳) پیش‌فرض.
// کش درون‌پردازه‌ای ۱۵ ثانیه‌ای (همان CACHE_TTL_MS) + Invalidate() برای پنل مدیر.
// کلیدهای envOnly فقط از ENV خوانده می‌شوند (پیش از اتصال دیتابیس لازم‌اند).
package settings

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const cacheTTL = 15 * time.Second

// Def تعریف یک تنظیم — معادل SettingDef (زیرمجموعهٔ لازم فاز ۱).
type Def struct {
	Key     string
	Env     string
	Default string
	EnvOnly bool
}

// DBReader خواندن یک تنظیم از DB — برای تست بدون دیتابیس قابل جایگزینی است.
type DBReader interface {
	// ReadAll همهٔ ردیف‌های system_settings را برمی‌گرداند (key→value).
	ReadAll(ctx context.Context) (map[string]string, error)
}

// pgReader پیاده‌سازی DBReader روی استخر pgx.
type pgReader struct{ pool *pgxpool.Pool }

func (p pgReader) ReadAll(ctx context.Context) (map[string]string, error) {
	rows, err := p.pool.Query(ctx, `select "key", value from system_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

type cacheEntry struct {
	at   time.Time
	rows map[string]string
}

// Store سرویس تنظیمات.
type Store struct {
	reader DBReader
	defs   map[string]Def

	mu    sync.Mutex
	cache *cacheEntry
}

// New سازنده — pool می‌تواند nil باشد (فقط ENV/پیش‌فرض؛ تست/توسعه).
func New(pool *pgxpool.Pool, defs []Def) *Store {
	s := &Store{defs: make(map[string]Def, len(defs))}
	for _, d := range defs {
		s.defs[d.Key] = d
	}
	if pool != nil {
		s.reader = pgReader{pool: pool}
	}
	return s
}

// NewWithReader برای تست — خوانندهٔ ساختگی.
func NewWithReader(reader DBReader, defs []Def) *Store {
	s := New(nil, defs)
	s.reader = reader
	return s
}

func (s *Store) dbSettings(ctx context.Context) map[string]string {
	s.mu.Lock()
	if s.cache != nil && time.Since(s.cache.at) < cacheTTL {
		rows := s.cache.rows
		s.mu.Unlock()
		return rows
	}
	s.mu.Unlock()

	rows := map[string]string{}
	if s.reader != nil {
		if got, err := s.reader.ReadAll(ctx); err == nil {
			rows = got
		}
		// خطا (جدول هنوز ساخته نشده) → با ENV/پیش‌فرض ادامه می‌دهیم (همان TS)
	}
	s.mu.Lock()
	s.cache = &cacheEntry{at: time.Now(), rows: rows}
	s.mu.Unlock()
	return rows
}

// Invalidate پاک‌کردن کش (معادل invalidateSettingsCache).
func (s *Store) Invalidate() {
	s.mu.Lock()
	s.cache = nil
	s.mu.Unlock()
}

func envOf(d Def) string {
	v := os.Getenv(d.Env)
	if v == "" {
		return ""
	}
	return v
}

// Get مقدار تنظیم با ترتیب دیتابیس ← ENV ← پیش‌فرض. تنظیم ناشناخته خطا می‌دهد
// (همان رفتار getSetting در TS).
func (s *Store) Get(ctx context.Context, key string) (string, error) {
	def, ok := s.defs[key]
	if !ok {
		return "", fmt.Errorf("تنظیم ناشناخته: %s", key)
	}
	if def.EnvOnly {
		if v := envOf(def); v != "" {
			return v, nil
		}
		return def.Default, nil
	}
	rows := s.dbSettings(ctx)
	if v, ok := rows[key]; ok && v != "" {
		return v, nil
	}
	if v := envOf(def); v != "" {
		return v, nil
	}
	return def.Default, nil
}

// GetNumber پورت getNumber: مقدار عددی؛ نامعتبر → fallback.
func (s *Store) GetNumber(ctx context.Context, key string, fallback float64) float64 {
	raw, err := s.Get(ctx, key)
	if err != nil {
		return fallback
	}
	n, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return fallback
	}
	return n
}

// GetBool پورت getBool.
func (s *Store) GetBool(ctx context.Context, key string) bool {
	raw, err := s.Get(ctx, key)
	if err != nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// PhaseOneDefs تعریف کلیدهای لازم فاز ۱ — رشته‌های کلید/ENV عیناً از
// SETTING_DEFS در settings.ts.
var PhaseOneDefs = []Def{
	{Key: "TICKET_TOKEN_SECRET", Env: "TICKET_TOKEN_SECRET", Default: ""},
	{Key: "PREVIOUS_TICKET_TOKEN_SECRET", Env: "PREVIOUS_TICKET_TOKEN_SECRET", Default: "", EnvOnly: true},
	{Key: "SESSION_LOCK_MINUTES", Env: "SESSION_LOCK_MINUTES", Default: "15"},
	{Key: "SESSION_LOCK_MINUTES_ROLES", Env: "SESSION_LOCK_MINUTES_ROLES", Default: ""},
	{Key: "SESSION_REAUTH_MINUTES", Env: "SESSION_REAUTH_MINUTES", Default: "30"},
	{Key: "UNIVERSITY_NAME", Env: "AFAGH_UNIVERSITY_NAME", Default: "دانشگاه آفاق"},
	{Key: "UNIVERSITY_LOGO", Env: "AFAGH_UNIVERSITY_LOGO", Default: ""},
}
