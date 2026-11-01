// ═══ centralized system configuration — faithful port from src/lib/settings.ts ═══
//
// priority order for each value: 1) system_settings table  2) environment variable  3) default.
// 15-second in-process cache (same as CACHE_TTL_MS) + Invalidate() for the admin panel.
// envOnly keys are read only from ENV (needed before the DB is connected).
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

// Def is one setting definition — equivalent to SettingDef (the Phase 1 subset).
type Def struct {
	Key     string
	Env     string
	Default string
	EnvOnly bool
}

// DBReader reads one setting from DB — replaceable for tests without a database.
type DBReader interface {
	// ReadAll returns all system_settings rows (key→value).
	ReadAll(ctx context.Context) (map[string]string, error)
}

// pgReader implements DBReader on the pgx pool.
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

// Store is the settings service.
type Store struct {
	reader DBReader
	defs   map[string]Def

	mu    sync.Mutex
	cache *cacheEntry
}

// New is the constructor — pool may be nil (ENV/default only; tests/dev).
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

// NewWithReader is for tests — a fake reader.
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
		// Error (table not created yet) → continue with ENV/default (same as TS)
	}
	s.mu.Lock()
	s.cache = &cacheEntry{at: time.Now(), rows: rows}
	s.mu.Unlock()
	return rows
}

// Save stores a value in system_settings (admin panel).
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

// Delete removes a row (back to default).
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

// AllDefs returns the registered definitions (for the admin panel).
func (s *Store) AllDefs() []Def {
	out := make([]Def, 0, len(s.defs))
	for _, d := range s.defs {
		out = append(out, d)
	}
	return out
}

// pool is the underlying pool (nil-safe for tests).
func (s *Store) pool() *pgxpool.Pool {
	if p, ok := s.reader.(pgReader); ok {
		return p.pool
	}
	return nil
}

// Invalidate clears the cache (equivalent to invalidateSettingsCache).
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

// Get returns the setting value with the DB ← ENV ← default order. An unknown setting errors
// (same behavior as getSetting in TS).
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

// GetNumber ports getNumber: numeric value; invalid → fallback.
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

// GetBool ports getBool.
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

// PhaseOneDefs defines the Phase 1 keys — key/ENV strings copied verbatim from
// SETTING_DEFS in settings.ts.
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

	// ── Enrollment (phase 3) — copied verbatim from the current system's SETTING_DEFS ──
	{Key: "ENROLLMENT_WINDOW_OPEN", Env: "AFAGH_ENROLLMENT_WINDOW_OPEN", Default: "true"},
	{Key: "ENROLL_REQUIRE_CURRICULUM_CHART", Env: "AFAGH_ENROLL_REQUIRE_CURRICULUM_CHART", Default: "true"},
	{Key: "EMERGENCY_WITHDRAW_OPEN", Env: "AFAGH_EMERGENCY_WITHDRAW_OPEN", Default: "false"},
	{Key: "ENFORCE_TERM_ACTIVATION", Env: "AFAGH_ENFORCE_TERM_ACTIVATION", Default: "false"},
	{Key: "ENROLLMENT_DEBT_THRESHOLD", Env: "AFAGH_ENROLLMENT_DEBT_THRESHOLD", Default: "0"},
	{Key: "PUBLIC_BASE_URL", Env: "AFAGH_PUBLIC_BASE_URL", Default: "http://localhost:8080"},
	{Key: "TRANSCRIPT_TTL_MINUTES", Env: "TRANSCRIPT_TTL_MINUTES", Default: "10080"},
	{Key: "EXAM_TICKET_TTL_MINUTES", Env: "EXAM_TICKET_TTL_MINUTES", Default: "180"},
	{Key: "ENROLL_CONFIRM_TTL_MINUTES", Env: "ENROLL_CONFIRM_TTL_MINUTES", Default: "20160"},

	// ── Virtual class / BBB (phase 3/10) ──
	{Key: "BBB_URL", Env: "BIGBLUEBUTTON_URL", Default: ""},
	{Key: "BBB_SECRET", Env: "BIGBLUEBUTTON_SECRET", Default: ""},
	{Key: "BBB_MODERATOR_PW", Env: "BIGBLUEBUTTON_MODERATOR_PW", Default: ""},
	{Key: "BBB_ATTENDEE_PW", Env: "BIGBLUEBUTTON_ATTENDEE_PW", Default: ""},
	{Key: "BBB_AUTO_RECORD", Env: "BIGBLUEBUTTON_AUTO_RECORD", Default: "false"},

	// ── Finance (phase 3) ──
	{Key: "CHEQUE_REMIND_DAYS", Env: "AFAGH_CHEQUE_REMIND_DAYS", Default: "7"},
	{Key: "FINANCE_STMT_TTL_MINUTES", Env: "FINANCE_STMT_TTL_MINUTES", Default: "10080"},

	// ── Graduation and thesis (phase 3) ──
	{Key: "GRAD_MIN_GPA", Env: "GRAD_MIN_GPA", Default: "12"},
	{Key: "GRAD_REQUIRE_SAJJAD", Env: "GRAD_REQUIRE_SAJJAD", Default: "true"},
	{Key: "GRAD_REQUIRE_PHOTO", Env: "GRAD_REQUIRE_PHOTO", Default: "true"},
	{Key: "GRAD_AUTO_SCAN", Env: "GRAD_AUTO_SCAN", Default: "true"},
	{Key: "GRAD_THESIS_DEGREE_CODES", Env: "GRAD_THESIS_DEGREE_CODES", Default: "MSC,PHD"},
	{Key: "GRAD_IRANDOC_MAX_SIMILARITY", Env: "GRAD_IRANDOC_MAX_SIMILARITY", Default: "20"},
	{Key: "GRAD_STAMP_FEE", Env: "GRAD_STAMP_FEE", Default: "0"},
	{Key: "GRAD_SERIAL_PREFIX", Env: "GRAD_SERIAL_PREFIX", Default: "AF"},
	{Key: "IRANDOC_BASE_URL", Env: "IRANDOC_BASE_URL", Default: ""},
	{Key: "IRANDOC_TOKEN", Env: "IRANDOC_TOKEN", Default: ""},
	{Key: "SAJJAD_BASE_URL", Env: "SAJJAD_BASE_URL", Default: ""},
	{Key: "SAJJAD_PORTAL_URL", Env: "SAJJAD_PORTAL_URL", Default: "https://portal.saorg.ir"},
	{Key: "API_TIMEOUT_SECONDS", Env: "API_TIMEOUT_SECONDS", Default: "10"},
	{Key: "ALUMNI_FEE_TRANSCRIPT", Env: "ALUMNI_FEE_TRANSCRIPT", Default: "0"},
	{Key: "ALUMNI_FEE_TRANSLATION", Env: "ALUMNI_FEE_TRANSLATION", Default: "0"},
	{Key: "ALUMNI_FEE_RELEASE", Env: "ALUMNI_FEE_RELEASE", Default: "0"},
	{Key: "ALUMNI_FEE_DUPLICATE", Env: "ALUMNI_FEE_DUPLICATE", Default: "0"},
	{Key: "NOTIFY_CHANNELS", Env: "NOTIFY_CHANNELS", Default: "INAPP,SMS"},
	{Key: "FA_YEAR", Env: "FA_YEAR", Default: ""},
	{Key: "STUDENT_CARD_VALID_DAYS", Env: "STUDENT_CARD_VALID_DAYS", Default: "365"},
	{Key: "ENROLL_EXPERT_OVERRIDE", Env: "AFAGH_ENROLL_EXPERT_OVERRIDE", Default: "true"},
	{Key: "EQUIV_FIXED_TUITION_MODE", Env: "EQUIV_FIXED_TUITION_MODE", Default: "ONCE"},

	// ── Contract and teaching pay (phase 4) ──
	{Key: "HOURLY_RATE_TMN", Env: "HOURLY_RATE_TMN", Default: "850000"},
	{Key: "CONTRACT_TAX_PERCENT", Env: "CONTRACT_TAX_PERCENT", Default: "10"},
	{Key: "CONTRACT_INSURANCE_PERCENT", Env: "CONTRACT_INSURANCE_PERCENT", Default: "7"},
	{Key: "CONTRACT_MINUTES_PER_UNIT", Env: "CONTRACT_MINUTES_PER_UNIT", Default: "0"},

	// ── Evaluation/performance/notifications (phase 6) ──
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
