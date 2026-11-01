// ═══ Enrollment service — dependencies and shared helpers ═══
package enroll

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"backend-go/internal/db"
	"backend-go/internal/finance"
	"backend-go/internal/scope"
)

// Pool short name for the connection pool.
type Pool = pgxpool.Pool

// Settings minimum required settings.
type Settings interface {
	Get(ctx context.Context, key string) (string, error)
	GetNumber(ctx context.Context, key string, fallback float64) float64
	GetBool(ctx context.Context, key string) bool
}

// Service enrollment engine.
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

// StartWorker starts the queue worker in-process (if Redis is available).
func (s *Service) StartWorker() {
	s.WR.EnsureWorker(func(ctx context.Context, uid, sid int64, risk bool) any {
		return s.ProcessQueuedSubmit(ctx, uid, sid, risk)
	})
}

// ledgerBalance canonical student ledger balance.
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

// LiveCapacities live capacity view from Redis.
func (s *Service) LiveCapacities(ctx context.Context, ids []int64) map[int64]CapacityInfo {
	return s.WR.PeekCapacities(ctx, ids)
}
