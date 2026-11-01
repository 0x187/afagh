package app

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"

	"backend-go/internal/db"
	"backend-go/internal/logger"
	"backend-go/internal/ratelimit"
	"backend-go/internal/scope"
	"backend-go/internal/session"
	"backend-go/internal/settings"
	"backend-go/internal/verification"
)

// buildInfra connects the shared infrastructure: database pools, Redis
// (optional), settings store, session store, rate limiter, token signer.
func (a *App) buildInfra(ctx context.Context) error {
	log := logger.For("app")

	database, err := db.Connect(ctx, a.Cfg.DatabaseURL, a.Cfg.DatabaseURLApp)
	if err != nil {
		log.Error("db_connect_failed", logger.Fields{"error": err.Error()})
		return fmt.Errorf("connect db: %w", err)
	}
	a.DB = database
	// Close order is reverse registration: redis closes before the DB pools.
	a.closes = append(a.closes, database.Close)

	a.store = session.NewStore(database.Pool)
	a.settings = settings.New(database.Pool, settings.PhaseOneDefs)

	if a.Cfg.RedisURL != "" {
		opt, err := redis.ParseURL(a.Cfg.RedisURL)
		if err != nil {
			log.Error("redis_url_invalid", logger.Fields{"error": err.Error()})
			return fmt.Errorf("parse redis url: %w", err)
		}
		a.Redis = redis.NewClient(opt)
		a.closes = append(a.closes, func() { _ = a.Redis.Close() })
	}
	a.limiter = ratelimit.New(a.Redis)
	a.signer = verification.New(a.settings)
	a.scopeSvc = scope.New(database.Pool)
	return nil
}
