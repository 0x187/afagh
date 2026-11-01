// ═══ Go service configuration (Afagh backend rewrite) ═══
//
// The environment variable contract is deliberately the same as afagh-next so that one
// compose container can feed both services. In production the critical variables
// (DATABASE_URL) are mandatory — the same fail-closed "requireEnvInProd" policy as in
// afagh-next/src/db/index.ts: an empty or whitespace-only value counts as "unset"
// and the service does not start.
package config

import (
	"fmt"
	"os"
	"strings"
)

// Config holds all the configuration the service needs.
type Config struct {
	// Infrastructure (shared with afagh-next)
	DatabaseURL    string // Schema owner pool (role afagh)
	DatabaseURLApp string // Restricted afagh_app pool with RLS — only created in phase 0
	RedisURL       string // empty = redis check in health is "skipped"
	S3Endpoint     string // empty = minio check in health is "skipped"
	S3Bucket       string
	S3AccessKey    string
	S3SecretKey    string

	// Service behavior
	Port    string // PORT (default 8090)
	Env     string // NODE_ENV compatibility: production | development
	Version string // AFAGH_VERSION | APP_VERSION | dev

	// Routing edge (strangler)
	NextUpstream  string   // Next.js service address — every "unowned" route is proxied here
	SpaUpstream   string   // If set, the SPA is proxied from this address (dev: Vite)
	SpaDist       string   // otherwise the path to the SPA's built dist folder (production)
	OwnedPrefixes []string // Prefixes the Go service answers itself; the rest → Next

	// Security (the same ENVs as afagh-next)
	AllowedExtraOrigins []string // ALLOWED_EXTRA_ORIGINS — CSRF allowlist
	SessionCookiePrefix string   // AFAGH_SESSION_COOKIE_PREFIX: "host" = dual-read with __Host-afagh_session

	// Logging
	LogLevel  string
	LogFormat string // json | pretty (default: pretty outside production)
	LogApp    string
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func isProduction(env string) bool { return env == "production" }

// Load reads the configuration from the environment; in production a missing DATABASE_URL is a fatal error.
func Load() (*Config, error) {
	cfg := &Config{
		Env:                 env("NODE_ENV", "development"),
		Port:                env("PORT", "8090"),
		Version:             env("AFAGH_VERSION", env("APP_VERSION", "dev")),
		NextUpstream:        env("AFAGH_NEXT_UPSTREAM", "http://127.0.0.1:8080"),
		SpaUpstream:         strings.TrimSpace(os.Getenv("AFAGH_SPA_UPSTREAM")),
		SpaDist:             strings.TrimSpace(os.Getenv("AFAGH_SPA_DIST")),
		SessionCookiePrefix: strings.ToLower(env("AFAGH_SESSION_COOKIE_PREFIX", "")),
		LogLevel:            strings.ToLower(env("LOG_LEVEL", "info")),
		LogFormat:           strings.ToLower(env("LOG_FORMAT", "")),
		LogApp:              env("LOG_APP_NAME", "afagh"),
	}

	// ── requireEnvInProd — faithful port from src/db/index.ts ──
	cfg.DatabaseURL = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if cfg.DatabaseURL == "" {
		if isProduction(cfg.Env) {
			return nil, fmt.Errorf("[config] در production متغیر DATABASE_URL اجباری است و نمی‌تواند خالی بماند (پیش‌فرض توسعه‌ای در production پذیرفته نمی‌شود)")
		}
		cfg.DatabaseURL = "postgres://afagh:afagh@localhost:5432/afagh_db"
	}
	// RLS pool: in production its absence is not an error (it is needed only when the
	// RLS knowledge-kit routes are enabled); in later phases its consumers have their own fail-closed handling.
	cfg.DatabaseURLApp = strings.TrimSpace(os.Getenv("DATABASE_URL_APP"))
	if cfg.DatabaseURLApp == "" && !isProduction(cfg.Env) {
		cfg.DatabaseURLApp = "postgres://afagh_app:afagh_app@127.0.0.1:5432/afagh_db"
	}

	cfg.RedisURL = strings.TrimSpace(os.Getenv("REDIS_URL"))
	cfg.S3Endpoint = strings.TrimSpace(os.Getenv("S3_ENDPOINT"))
	cfg.S3Bucket = strings.TrimSpace(os.Getenv("S3_BUCKET"))
	cfg.S3AccessKey = strings.TrimSpace(os.Getenv("S3_ACCESS_KEY"))
	cfg.S3SecretKey = strings.TrimSpace(os.Getenv("S3_SECRET_KEY"))

	cfg.AllowedExtraOrigins = nil
	for _, o := range strings.Split(os.Getenv("ALLOWED_EXTRA_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			cfg.AllowedExtraOrigins = append(cfg.AllowedExtraOrigins, o)
		}
	}

	cfg.OwnedPrefixes = nil
	for _, p := range strings.Split(env("AFAGH_OWNED_PREFIXES", "/api/v2,/app"), ",") {
		if p = strings.TrimSpace(p); p != "" {
			if !strings.HasPrefix(p, "/") {
				return nil, fmt.Errorf("[config] AFAGH_OWNED_PREFIXES: پیشوند باید با «/» شروع شود: %q", p)
			}
			cfg.OwnedPrefixes = append(cfg.OwnedPrefixes, p)
		}
	}
	return cfg, nil
}

// IsProduction reports whether the service is running in production mode.
func (c *Config) IsProduction() bool { return isProduction(c.Env) }
