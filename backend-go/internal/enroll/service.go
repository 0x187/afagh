// ═══ سرویس انتخاب واحد — وابستگی‌ها و ابزارهای مشترک ═══
package enroll

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"backend-go/internal/db"
	"backend-go/internal/finance"
	"backend-go/internal/scope"
)

// Pool نام کوتاه برای استخر اتصال.
type Pool = pgxpool.Pool

// Settings حداقل تنظیمات لازم.
type Settings interface {
	Get(ctx context.Context, key string) (string, error)
	GetNumber(ctx context.Context, key string, fallback float64) float64
	GetBool(ctx context.Context, key string) bool
}

// Service موتور انتخاب واحد.
type Service struct {
	DB         *db.DB
	WR         *WaitingRoom
	Settings   Settings
	Scope      *scope.Service
	Production bool
}

func NewService(database *db.DB, rdb *redis.Client, settings Settings, scopeSvc *scope.Service, production bool) *Service {
	wr := NewWaitingRoom(database.Pool, rdb)
	return &Service{DB: database, WR: wr, Settings: settings, Scope: scopeSvc, Production: production}
}

// StartWorker کارگر صف را در پروسه فعال می‌کند (اگر Redis در دسترس باشد).
func (s *Service) StartWorker() {
	s.WR.EnsureWorker(func(ctx context.Context, uid, sid int64, risk bool) any {
		return s.ProcessQueuedSubmit(ctx, uid, sid, risk)
	})
}

// ledgerBalance تراز کانونی دفتر دانشجو.
func (s *Service) ledgerBalance(ctx context.Context, studentID int64) float64 {
	rows, err := s.DB.Pool.Query(ctx, `
		select "transactionType", amount::float8 from student_ledger where "studentId" = $1`, studentID)
	if err != nil {
		return 0
	}
	defer rows.Close()
	list := []finance.LedgerBalanceRow{}
	for rows.Next() {
		var r finance.LedgerBalanceRow
		if err := rows.Scan(&r.TransactionType, &r.Amount); err == nil {
			list = append(list, r)
		}
	}
	return finance.LedgerBalance(list)
}

// LiveCapacities نمای زندهٔ ظرفیت از Redis.
func (s *Service) LiveCapacities(ctx context.Context, ids []int64) map[int64]CapacityInfo {
	return s.WR.PeekCapacities(ctx, ids)
}
