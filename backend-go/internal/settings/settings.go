// ═══ پیکربندی متمرکز سامانه — پورت وفادار از src/lib/settings.ts ═══
//
// ترتیب اولویت هر مقدار: ۱) جدول system_settings  ۲) متغیر محیطی  ۳) پیش‌فرض.
// کش درون‌پردازه‌ای ۱۵ ثانیه‌ای (همان CACHE_TTL_MS) + Invalidate() برای پنل مدیر.
// کلیدهای envOnly فقط از ENV خوانده می‌شوند (پیش از اتصال دیتابیس لازم‌اند).
package settings

import (
	"context"
	"errors"
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

// Save ذخیرهٔ مقدار در جدول system_settings (پنل مدیر).
func (s *Store) Save(ctx context.Context, key, value string) error {
	def, ok := s.defs[key]
	if !ok {
		return errors.New("تنظیم ناشناخته: " + key)
	}
	if def.EnvOnly {
		return errors.New("این تنظیم فقط از ENV خوانده می‌شود و در دیتابیس ذخیره نمی‌شود: " + key)
	}
	if s.reader == nil {
		return errors.New("اتصال دیتابیس در دسترس نیست.")
	}
	if _, err := s.pool().Exec(ctx, `
		insert into system_settings ("key", value) values ($1,$2)
		on conflict ("key") do update set value = excluded.value`, key, value); err != nil {
		return err
	}
	s.Invalidate()
	return nil
}

// Delete حذف ردیف (بازگشت به پیش‌فرض).
func (s *Store) Delete(ctx context.Context, key string) error {
	if s.reader == nil {
		return errors.New("اتصال دیتابیس در دسترس نیست.")
	}
	if _, err := s.pool().Exec(ctx, `delete from system_settings where "key" = $1`, key); err != nil {
		return err
	}
	s.Invalidate()
	return nil
}

// AllDefs تعریف‌های ثبت‌شده را برمی‌گرداند (برای پنل مدیر).
func (s *Store) AllDefs() []Def {
	out := make([]Def, 0, len(s.defs))
	for _, d := range s.defs {
		out = append(out, d)
	}
	return out
}

// pool استخر زیرین (nil-safe برای تست).
func (s *Store) pool() *pgxpool.Pool {
	if p, ok := s.reader.(pgReader); ok {
		return p.pool
	}
	return nil
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
	{Key: "BYPASS_CRON_SECRET", Env: "BYPASS_CRON_SECRET", Default: ""},
	{Key: "CHEQUE_CRON_SECRET", Env: "CHEQUE_CRON_SECRET", Default: ""},
	{Key: "WORKFLOW_CRON_SECRET", Env: "WORKFLOW_CRON_SECRET", Default: ""},
	{Key: "SCHED_WARN_CRON_SECRET", Env: "SCHED_WARN_CRON_SECRET", Default: ""},
	{Key: "SCHED_WARN_CHANNELS", Env: "SCHED_WARN_CHANNELS", Default: ""},
	{Key: "PREVIOUS_TICKET_TOKEN_SECRET", Env: "PREVIOUS_TICKET_TOKEN_SECRET", Default: "", EnvOnly: true},
	{Key: "SESSION_LOCK_MINUTES", Env: "SESSION_LOCK_MINUTES", Default: "15"},
	{Key: "SESSION_LOCK_MINUTES_ROLES", Env: "SESSION_LOCK_MINUTES_ROLES", Default: ""},
	{Key: "SESSION_REAUTH_MINUTES", Env: "SESSION_REAUTH_MINUTES", Default: "30"},
	{Key: "UNIVERSITY_NAME", Env: "AFAGH_UNIVERSITY_NAME", Default: "دانشگاه آفاق"},
	{Key: "UNIVERSITY_LOGO", Env: "AFAGH_UNIVERSITY_LOGO", Default: ""},

	// ── انتخاب واحد (فاز ۳) — عیناً از SETTING_DEFS سیستم فعلی ──
	{Key: "ENROLLMENT_WINDOW_OPEN", Env: "AFAGH_ENROLLMENT_WINDOW_OPEN", Default: "true"},
	{Key: "ENROLL_REQUIRE_CURRICULUM_CHART", Env: "AFAGH_ENROLL_REQUIRE_CURRICULUM_CHART", Default: "true"},
	{Key: "EMERGENCY_WITHDRAW_OPEN", Env: "AFAGH_EMERGENCY_WITHDRAW_OPEN", Default: "false"},
	{Key: "ENFORCE_TERM_ACTIVATION", Env: "AFAGH_ENFORCE_TERM_ACTIVATION", Default: "false"},
	{Key: "ENROLLMENT_DEBT_THRESHOLD", Env: "AFAGH_ENROLLMENT_DEBT_THRESHOLD", Default: "0"},
	{Key: "PUBLIC_BASE_URL", Env: "AFAGH_PUBLIC_BASE_URL", Default: "http://localhost:8080"},
	{Key: "TRANSCRIPT_TTL_MINUTES", Env: "TRANSCRIPT_TTL_MINUTES", Default: "10080"},
	{Key: "EXAM_TICKET_TTL_MINUTES", Env: "EXAM_TICKET_TTL_MINUTES", Default: "180"},
	{Key: "ENROLL_CONFIRM_TTL_MINUTES", Env: "ENROLL_CONFIRM_TTL_MINUTES", Default: "20160"},

	// ── کلاس مجازی / BBB (فاز ۳/۱۰) ──
	{Key: "BBB_URL", Env: "BIGBLUEBUTTON_URL", Default: ""},
	{Key: "BBB_SECRET", Env: "BIGBLUEBUTTON_SECRET", Default: ""},
	{Key: "BBB_MODERATOR_PW", Env: "BIGBLUEBUTTON_MODERATOR_PW", Default: ""},
	{Key: "BBB_ATTENDEE_PW", Env: "BIGBLUEBUTTON_ATTENDEE_PW", Default: ""},
	{Key: "BBB_AUTO_RECORD", Env: "BIGBLUEBUTTON_AUTO_RECORD", Default: "false"},

	// ── مالی (فاز ۳) ──
	{Key: "CHEQUE_REMIND_DAYS", Env: "AFAGH_CHEQUE_REMIND_DAYS", Default: "7"},
	{Key: "FINANCE_STMT_TTL_MINUTES", Env: "FINANCE_STMT_TTL_MINUTES", Default: "10080"},

	// ── فارغ‌التحصیلی و پایان‌نامه (فاز ۳) ──
	{Key: "GRAD_MIN_GPA", Env: "GRAD_MIN_GPA", Default: "12"},
	{Key: "GRAD_REQUIRE_SAJJAD", Env: "GRAD_REQUIRE_SAJJAD", Default: "true"},
	{Key: "GRAD_REQUIRE_PHOTO", Env: "GRAD_REQUIRE_PHOTO", Default: "true"},
	{Key: "SAJJAD_PORTAL_URL", Env: "SAJJAD_PORTAL_URL", Default: "https://portal.saorg.ir"},
	{Key: "NOTIFY_CHANNELS", Env: "NOTIFY_CHANNELS", Default: "INAPP,SMS"},
	{Key: "FA_YEAR", Env: "FA_YEAR", Default: ""},

	// ── قرارداد و حق‌التدریس (فاز ۴) ──
	{Key: "HOURLY_RATE_TMN", Env: "HOURLY_RATE_TMN", Default: "850000"},
	{Key: "CONTRACT_TAX_PERCENT", Env: "CONTRACT_TAX_PERCENT", Default: "10"},
	{Key: "CONTRACT_INSURANCE_PERCENT", Env: "CONTRACT_INSURANCE_PERCENT", Default: "7"},
	{Key: "CONTRACT_MINUTES_PER_UNIT", Env: "CONTRACT_MINUTES_PER_UNIT", Default: "0"},

	// ── ارزشیابی/عملکرد/اعلان‌ها (فاز ۶) ──
	{Key: "EVAL_FLAG_THRESHOLD", Env: "EVAL_FLAG_THRESHOLD", Default: "3.5"},
	{Key: "EVAL_TREND_TERMS", Env: "EVAL_TREND_TERMS", Default: "3"},
	{Key: "PERF_SLA_TARGET", Env: "PERF_SLA_TARGET", Default: "90"},
	{Key: "PERF_EVAL_TARGET", Env: "PERF_EVAL_TARGET", Default: "4"},
	{Key: "PERF_SESSION_HOLD_TARGET", Env: "PERF_SESSION_HOLD_TARGET", Default: "90"},
	{Key: "PERF_INCENTIVE_PERCENT", Env: "PERF_INCENTIVE_PERCENT", Default: "10"},
	{Key: "BI_STOPWORDS", Env: "BI_STOPWORDS", Default: "و,به,از,که,در,این,آن,با,را,برای,است,بود,شد,هم,نیز,تا,یا,اما,خیلی,بسیار,بر,دارد,می,های,یک,دو,سه,من,او,ما,شما,باید,نمی,کنم,کرد,کردم,کنند,مورد,همه,چون,اگر,روی,بی,هر,چه,می‌شود,بودن,کلاس,استاد,درس"},
	{Key: "NOTIFY_ENABLED", Env: "NOTIFY_ENABLED", Default: "false"},
	{Key: "NOTIFY_SIGNATURE", Env: "NOTIFY_SIGNATURE", Default: ""},
	{Key: "EXAM_GRADE_DEADLINE_DAYS", Env: "EXAM_GRADE_DEADLINE_DAYS", Default: "5"},
	{Key: "GRADE_EDIT_NOTIFY_BOARD", Env: "GRADE_EDIT_NOTIFY_BOARD", Default: "true"},
}
