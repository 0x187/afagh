package app

import (
	"fmt"
	"net/http"
	"net/url"
	"time"

	"backend-go/internal/edge"
	"backend-go/internal/httpapi"
	"backend-go/internal/logger"
	"backend-go/internal/opencourses"
	"backend-go/internal/publicverify"
)

// buildHTTP registers every /api/v2 route on the gin engine.
//
// Registration order matches the original wiring exactly; gin panics on
// conflicting routes, so do not reorder entries here without checking.
func (a *App) buildHTTP() {
	g := a.gin.Group("")

	healthAPI := &httpapi.Health{
		DB:         a.DB,
		RedisURL:   a.Cfg.RedisURL,
		S3Endpoint: a.Cfg.S3Endpoint, S3Bucket: a.Cfg.S3Bucket,
		S3AccessKey: a.Cfg.S3AccessKey, S3SecretKey: a.Cfg.S3SecretKey,
		Version: a.Cfg.Version,
	}
	a.gin.GET("/health", healthAPI.HealthGET)

	// ── Phase 1: auth, session, scope ──
	(&httpapi.SessionAPI{Store: a.store}).Register(g)
	(&httpapi.AuthAPI{Svc: a.authSvc}).Register(g)
	(&httpapi.SessionLockAPI{
		Store: a.store, Locks: a.locks, Limiter: a.limiter, Verifier: a.authSvc,
	}).Register(g)
	(&httpapi.StepUpAPI{
		Store: a.store, Signer: a.signer, Verifier: a.authSvc, Limiter: a.limiter,
		Secure: a.production,
	}).Register(g)
	(&httpapi.ScopeAPI{Store: a.store, Svc: a.scopeSvc, Production: a.production}).Register(g)

	// ── Phase 3: student portal ──
	studentAPI := &httpapi.StudentAPI{Svc: a.studentSvc, Store: a.store, Settings: a.settings}
	studentAPI.Register(g)
	studentAPI.RegisterEnrollRoutes(g, a.enrollSvc)

	// ── Phase 4/5: professor + group manager ──
	(&httpapi.ProfessorAPI{Svc: a.professorSvc, Store: a.store}).Register(g)
	(&httpapi.GroupManagerAPI{Svc: a.gmSvc, Store: a.store}).Register(g)

	// ── Phase 6+: admin core and satellites ──
	a.adminAPI.Register(g)
	(&httpapi.CodesAPI{Svc: a.admin, Store: a.store}).Register(g)
	(&httpapi.MigrationAdminAPI{Admin: a.adminAPI}).Register(g)
	(&httpapi.SmallAdminAPI{Admin: a.adminAPI}).Register(g)
	(&httpapi.RegulationsAPI{Svc: a.admin, Store: a.store}).Register(g)
	(&httpapi.EduExpertAPI{Svc: a.admin, Store: a.store}).Register(g)
	(&httpapi.SchedulingSuiteAPI{Admin: a.adminAPI}).Register(g)
	(&httpapi.LastPagesAPI{Admin: a.adminAPI}).Register(g)
	(&httpapi.ExamHandoverPublicAPI{Admin: a.adminAPI}).Register(g)

	// ── Phase 7: payroll ──
	(&httpapi.PayrollAPI{
		Engine: a.payrollEngine, Approvals: a.payrollApprovals, Store: a.store,
		Pool: a.DB.Pool, Scope: a.scopeSvc, Admin: a.admin,
	}).Register(g)

	// ── Phase 8/10: workflow, crons, messengers, public pages ──
	(&httpapi.WorkflowAPI{Engine: a.workflowEngine, Store: a.store, Admin: a.admin}).Register(g)
	(&httpapi.CronAPI{Engine: a.cronEngine, Limiter: a.limiter}).Register(g)
	(&httpapi.CronExtraAPI{Engine: a.cronEngine, Limiter: a.limiter}).Register(g)
	(&httpapi.MessengerAPI{Store: a.store, Svc: a.messagingSvc, Limiter: a.limiter}).Register(g)
	(&httpapi.PublicAPI{
		Pool: a.DB.Pool, Settings: a.settings,
		Verify:  &publicverify.Service{Student: a.studentSvc, Signer: a.signer, Pool: a.DB.Pool},
		Open:    &opencourses.Service{Pool: a.DB.Pool},
		Limiter: a.limiter,
	}).Register(g)
	(&httpapi.PublicExtraAPI{
		Pool: a.DB.Pool, Store: a.store,
		Settings: a.settings, Limiter: a.limiter, Signer: a.signer,
	}).Register(g)
}

// buildServer wraps the gin engine in the strangler edge and creates the
// root http.Server.
func (a *App) buildServer() error {
	var spaHandler http.Handler
	if a.Cfg.SpaUpstream != "" {
		u, err := url.Parse(a.Cfg.SpaUpstream)
		if err != nil {
			logger.For("app").Error("spa_upstream_invalid", logger.Fields{"error": err.Error()})
			return fmt.Errorf("parse spa upstream: %w", err)
		}
		spaHandler = newHostPreservingProxy(u)
	}
	var nextUpstream *url.URL
	if a.Cfg.NextUpstream != "" {
		u, err := url.Parse(a.Cfg.NextUpstream)
		if err != nil {
			logger.For("app").Error("next_upstream_invalid", logger.Fields{"error": err.Error()})
			return fmt.Errorf("parse next upstream: %w", err)
		}
		nextUpstream = u
	}

	root := edge.Root(a.Cfg.OwnedPrefixes, a.gin, spaHandler, a.Cfg.SpaDist, nextUpstream, a.Cfg.AllowedExtraOrigins)
	a.Server = &http.Server{
		Addr:              ":" + a.Cfg.Port,
		Handler:           root,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	return nil
}
