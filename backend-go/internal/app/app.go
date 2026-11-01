// Package app assembles the Afagh Go backend: infrastructure, domain
// services, HTTP routing, and server lifecycle.
//
// Layout of this package:
//
//	app.go       — App struct, constructor, lifecycle (Serve/Shutdown/Close)
//	infra.go     — infrastructure singletons (db, redis, settings, auth, scope…)
//	services.go  — domain services and cross-service wiring
//	http.go      — gin engine + every /api/v2 route registration
//	adapters.go  — interface adapters between packages
//	spa.go       — SPA proxy/static handler
//
// Adding a feature: create/extend a domain service under internal/<domain>,
// expose it through a small API struct in internal/httpapi with a Register
// method, then wire it in services.go + http.go. See docs/ENGINEERING-GUIDE.md.
package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"backend-go/internal/admin"
	"backend-go/internal/archive"
	"backend-go/internal/authn"
	"backend-go/internal/bi"
	"backend-go/internal/config"
	"backend-go/internal/cron"
	"backend-go/internal/db"
	"backend-go/internal/enroll"
	"backend-go/internal/groupmanager"
	"backend-go/internal/httpapi"
	"backend-go/internal/logger"
	"backend-go/internal/messaging"
	"backend-go/internal/payroll"
	"backend-go/internal/professor"
	"backend-go/internal/ratelimit"
	"backend-go/internal/scope"
	"backend-go/internal/session"
	"backend-go/internal/sessionlock"
	"backend-go/internal/settings"
	"backend-go/internal/student"
	"backend-go/internal/tuition"
	"backend-go/internal/verification"
	"backend-go/internal/workflow"
)

// App holds every long-lived object the backend needs.
type App struct {
	Cfg   *config.Config
	DB    *db.DB
	Redis *redis.Client // nil when REDIS_URL is empty

	// Server is the root HTTP server (strangler edge + gin API + SPA).
	Server *http.Server

	gin        *gin.Engine
	spa        http.Handler
	store      *session.Store
	settings   *settings.Store
	limiter    *ratelimit.Limiter
	signer     *verification.Signer
	scopeSvc   *scope.Service
	production bool

	// Auth stack.
	authSvc *authn.Service
	locks   *sessionlock.Service

	// Domain services / engines wired in services.go and consumed in http.go.
	archiveStore     *archive.Store
	studentSvc       *student.Service
	enrollSvc        *enroll.Service
	professorSvc     *professor.Service
	gmSvc            *groupmanager.Service
	admin            *admin.Service
	adminAPI         *httpapi.AdminAPI
	payrollEngine    *payroll.Engine
	payrollApprovals *payroll.Approvals
	biSvc            *bi.Service
	messagingSvc     *messaging.Service
	tuitionEngine    *tuition.Engine
	workflowEngine   *workflow.Engine
	cronEngine       *cron.Engine

	// closes run in reverse registration order on Close (redis before db).
	closes []func()
}

// New builds the whole application graph. It returns the first infrastructure
// error; HTTP handlers never run when New fails.
func New(ctx context.Context, cfg *config.Config) (*App, error) {
	a := &App{Cfg: cfg, production: cfg.IsProduction()}

	if cfg.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}
	a.gin = gin.New()
	a.gin.Use(gin.Recovery())

	if err := a.buildInfra(ctx); err != nil {
		return nil, fmt.Errorf("infra: %w", err)
	}
	a.buildServices()
	a.buildHTTP()
	if err := a.buildServer(); err != nil {
		return nil, fmt.Errorf("server: %w", err)
	}
	return a, nil
}

// Serve starts the HTTP server in a goroutine and returns an error channel
// that yields the ListenAndServe failure (if any).
func (a *App) Serve() <-chan error {
	errCh := make(chan error, 1)
	go func() {
		logger.For("main").Info("listening", logger.Fields{"addr": a.Server.Addr})
		err := a.Server.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		errCh <- err
	}()
	return errCh
}

// Shutdown gracefully drains in-flight requests.
func (a *App) Shutdown(ctx context.Context) error {
	return a.Server.Shutdown(ctx)
}

// DefaultShutdownTimeout mirrors the previous hard-coded drain window.
const DefaultShutdownTimeout = 15 * time.Second

// Close releases infrastructure in reverse construction order.
func (a *App) Close() {
	for i := len(a.closes) - 1; i >= 0; i-- {
		a.closes[i]()
	}
}
