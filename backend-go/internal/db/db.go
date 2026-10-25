// ═══ لایهٔ دسترسی دیتابیس — پورت وفادار از afagh-next/src/db/index.ts ═══
//
// دو استخر اتصال:
//   - Pool (مالک اسکیما، نقش afagh، max 20)   → همهٔ کوئری‌های مدیریتی/موتورها
//   - AppPool (نقش محدود afagh_app، max 10)   → فقط خواندن/نوشتن دانشکیت با RLS
//
// withUserRls همان الگوی تراکنش-به-درخواست Next را دارد:
//
//	BEGIN; set_config('app.user_id', $uid, true); ... ; COMMIT
//
// set_config فقط در همان تراکنش زنده است؛ با INVALID کردن RLS زیرساخت،
// در production هرگز به استخر مالک برنمی‌گردیم (FAIL-CLOSED — بازبینی بند ۶).
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
	Pool    *pgxpool.Pool // مالک
	AppPool *pgxpool.Pool // محدود (RLS) — ممکن است nil باشد اگر DATABASE_URL_APP ست نباشد
	log     *logger.Logger
}

// Connect دو استخر را می‌سازد. استخر مالک اجباری است؛ استخر RLS اختیاری
// (در production فقط هشدار — مصرف‌کننده‌های RLS خودشان fail-closed می‌دهند).
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

// Close هر دو استخر را می‌بندد.
func (d *DB) Close() {
	if d.AppPool != nil {
		d.AppPool.Close()
	}
	d.Pool.Close()
}

// errRLSInfra تشخیص «مشکل زیرساخت RLS» — همان سیاههٔ خطاها در withUserRls.ts:
// رمز/مجوز/جدول ناموجود/دیتابیس ناموجود/تراکنش فقط-خواندنی/اشاره به afagh_app.
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

// WithUserRls اجرای fn داخل تراکنش با زمینهٔ RLS کاربر — پورت مستقیم withUserRls.
//
// FAIL-CLOSED در production: اگر زیرساخت RLS (نقش afagh_app، grantها، پچ‌های RLS)
// از دست برود، هرگز به اتصال مالک (BYPASSRLS) برنمی‌گردیم؛ پیام امنِ فارسی برمی‌گردد.
// فقط در توسعه fallback به استخر مالک با هشدار بلند مجاز است (دباگ بدون afagh_app محلی).
func (d *DB) WithUserRls(ctx context.Context, userID int64, isProduction bool, fn func(tx pgx.Tx) error) error {
	run := func(pool *pgxpool.Pool) error {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx) //nolint:errcheck // rollback پس از commit فقط no-op است
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
		// استخر RLS اصلاً ساخته نشده — در production هیچ مسیر جایگزینی وجود ندارد.
		d.log.Error("rls_infra_lost", logger.Fields{"reason": "DATABASE_URL_APP تنظیم نشده است"})
		return errors.New("خطای امنیتی زیرساخت (RLS). با مدیر سامانه تماس بگیرید.")
	}
	return run(d.Pool)
}
