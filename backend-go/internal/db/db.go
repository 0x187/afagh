// ═══ Database access layer — faithful port from afagh-next/src/db/index.ts ═══
//
// Two connection pools:
//   - Pool (schema owner, role afagh, max 20)   → all management/engine queries
//   - AppPool (restricted role afagh_app, max 10)   → only knowledge-kit reads/writes with RLS
//
// withUserRls follows the same transaction-per-request pattern as Next:
//
//	BEGIN; set_config('app.user_id', $uid, true); ... ; COMMIT
//
// set_config lives only in that transaction; by INVALIDATING the RLS infrastructure,
// in production we never fall back to the owner pool (FAIL-CLOSED — review clause 6).
package db

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/logger"
)

type DB struct {
	Pool    *pgxpool.Pool // owner
	AppPool *pgxpool.Pool // restricted (RLS) — may be nil if DATABASE_URL_APP is not set
	log     *logger.Logger
}

// Connect creates both pools. The owner pool is mandatory; the RLS pool is optional
// (in production only a warning — RLS consumers fail closed themselves).
func Connect(ctx context.Context, databaseURL, databaseURLApp string) (*DB, error) {
	log := logger.For("db")
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("[db] DATABASE_URL نامعتبر است: %w", err)
	}
	cfg.MaxConns = 20
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("[db] ساخت استخر مالک شکست خورد: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("[db] اتصال به دیتابیس برقرار نشد: %w", err)
	}

	d := &DB{Pool: pool, log: log}

	if databaseURLApp != "" {
		appCfg, err := pgxpool.ParseConfig(databaseURLApp)
		if err != nil {
			return nil, fmt.Errorf("[db] DATABASE_URL_APP نامعتبر است: %w", err)
		}
		appCfg.MaxConns = 10
		appPool, err := pgxpool.NewWithConfig(ctx, appCfg)
		if err != nil {
			return nil, fmt.Errorf("[db] ساخت استخر RLS شکست خورد: %w", err)
		}
		if err := appPool.Ping(ctx); err != nil {
			appPool.Close()
			log.Warn("rls_pool_unreachable", logger.Fields{"error": err.Error()})
		} else {
			d.AppPool = appPool
		}
	}
	return d, nil
}

// Close closes both pools.
func (d *DB) Close() {
	if d.AppPool != nil {
		d.AppPool.Close()
	}
	d.Pool.Close()
}

// errRLSInfra detects an "RLS infrastructure problem" — the same error catalog as in withUserRls.ts:
// password/permission/missing table/missing database/read-only transaction/reference to afagh_app.
func errRLSInfra(err error) bool {
	if err == nil {
		return false
	}
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) {
		switch pgErr.SQLState() {
		case pgerrcode.InvalidPassword, // 28P01
			pgerrcode.InsufficientPrivilege,             // 42501
			pgerrcode.UndefinedTable,                    // 42P01
			pgerrcode.InvalidCatalogName,                // 3D000
			pgerrcode.InvalidAuthorizationSpecification, // 28000
			pgerrcode.ReadOnlySQLTransaction:            // 25006
			return true
		}
	}
	msg := err.Error()
	return strings.Contains(msg, "afagh_app") ||
		strings.Contains(msg, "permission denied") ||
		strings.Contains(msg, "does not exist") ||
		strings.Contains(msg, "connection")
}

// WithUserRls runs fn inside a transaction with the user's RLS context — direct port of withUserRls.
//
// FAIL-CLOSED in production: if the RLS infrastructure (afagh_app role, grants, RLS patches)
// is lost, we never fall back to the owner connection (BYPASSRLS); a safe Persian message is returned.
// Only in development is falling back to the owner pool with a loud warning allowed (debugging without a local afagh_app).
func (d *DB) WithUserRls(ctx context.Context, userID int64, isProduction bool, fn func(tx pgx.Tx) error) error {
	run := func(pool *pgxpool.Pool) error {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
		if _, err := tx.Exec(ctx, `select set_config('app.user_id', $1, true)`, fmt.Sprintf("%d", userID)); err != nil {
			return err
		}
		if err := fn(tx); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	if d.AppPool != nil {
		err := run(d.AppPool)
		if err == nil || !errRLSInfra(err) {
			return err
		}
		d.log.Error("rls_infra_lost", logger.Fields{"error": err.Error()})
		if isProduction {
			return errors.New("خطای امنیتی زیرساخت (RLS). با مدیر سامانه تماس بگیرید.")
		}
		d.log.Warn("rls_dev_fallback_enabled", nil)
	}
	if d.AppPool == nil && isProduction {
		// The RLS pool was not created at all — in production there is no fallback path.
		d.log.Error("rls_infra_lost", logger.Fields{"reason": "DATABASE_URL_APP تنظیم نشده است"})
		return errors.New("خطای امنیتی زیرساخت (RLS). با مدیر سامانه تماس بگیرید.")
	}
	return run(d.Pool)
}
