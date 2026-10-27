// ═══ سرویس بکند Go آفاق — نقطهٔ شروع ═══
//
// فاز ۰ (زیرساخت): لبهٔ مسیریابی strangler + سشن مشترک با Next.js + health.
// اجرای محلی:
//
//	AFAGH_NEXT_UPSTREAM=http://127.0.0.1:8080 PORT=8090 go run ./cmd/afagh
package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"backend-go/internal/admin"
	"backend-go/internal/archive"
	"backend-go/internal/authn"
	"backend-go/internal/config"
	"backend-go/internal/db"
	"backend-go/internal/edge"
	"backend-go/internal/enroll"
	"backend-go/internal/groupmanager"
	"backend-go/internal/httpapi"
	"backend-go/internal/logger"
	"backend-go/internal/professor"
	"backend-go/internal/ratelimit"
	"backend-go/internal/scope"
	"backend-go/internal/session"
	"backend-go/internal/sessionlock"
	"backend-go/internal/settings"
	"backend-go/internal/student"
	"backend-go/internal/verification"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		logger.For("config").Error("startup_failed", logger.Fields{"error": err.Error()})
		os.Exit(1)
	}
	logger.Configure(cfg.LogLevel, cfg.LogFormat, cfg.LogApp, cfg.Env)
	log := logger.For("main")
	log.Info("starting", logger.Fields{
		"version": cfg.Version, "env": cfg.Env, "port": cfg.Port,
		"next_upstream": cfg.NextUpstream, "owned": cfg.OwnedPrefixes,
	})

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	database, err := db.Connect(ctx, cfg.DatabaseURL, cfg.DatabaseURLApp)
	if err != nil {
		log.Error("db_connect_failed", logger.Fields{"error": err.Error()})
		os.Exit(1)
	}
	defer database.Close()

	store := session.NewStore(database.Pool)

	// ── سرویس‌های فاز ۱: تنظیمات، rate-limit، امضای توکن، قفل، scope ──
	settingsStore := settings.New(database.Pool, settings.PhaseOneDefs)

	var rdb *redis.Client
	if cfg.RedisURL != "" {
		opt, err := redis.ParseURL(cfg.RedisURL)
		if err != nil {
			log.Error("redis_url_invalid", logger.Fields{"error": err.Error()})
			os.Exit(1)
		}
		rdb = redis.NewClient(opt)
		defer rdb.Close()
	}
	limiter := ratelimit.New(rdb)
	signer := verification.New(settingsStore)
	locks := sessionlock.New(rdb, settingsStore)
	authCfg := authn.ConfigFromEnv()
	authSvc := authn.NewService(database.Pool, authCfg, limiter, signer, locks)
	scopeSvc := scope.New(database.Pool)

	// ── gin API (/api/v2) ──
	if cfg.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}
	ginEngine := gin.New()
	ginEngine.Use(gin.Recovery())
	healthAPI := &httpapi.Health{
		DB:         database,
		RedisURL:   cfg.RedisURL,
		S3Endpoint: cfg.S3Endpoint, S3Bucket: cfg.S3Bucket,
		S3AccessKey: cfg.S3AccessKey, S3SecretKey: cfg.S3SecretKey,
		Version: cfg.Version,
	}
	ginEngine.GET("/health", healthAPI.HealthGET)
	sessionAPI := &httpapi.SessionAPI{Store: store}
	sessionAPI.Register(ginEngine.Group(""))

	authAPI := &httpapi.AuthAPI{Svc: authSvc}
	authAPI.Register(ginEngine.Group(""))
	lockAPI := &httpapi.SessionLockAPI{
		Store: store, Locks: locks, Limiter: limiter, Verifier: authSvc,
	}
	lockAPI.Register(ginEngine.Group(""))
	scopeAPI := &httpapi.ScopeAPI{Store: store, Svc: scopeSvc, Production: cfg.IsProduction()}
	scopeAPI.Register(ginEngine.Group(""))
	studentSvc := student.New(database.Pool, scopeSvc, settingsStore, signer)
	if ar, err := archive.New(cfg.S3Endpoint, cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3Bucket); err == nil {
		studentSvc.Archive = ar
	}
	enrollSvc := enroll.NewService(database, rdb, settingsStore, scopeSvc, cfg.IsProduction())
	enrollSvc.StartWorker()
	studentAPI := &httpapi.StudentAPI{Svc: studentSvc, Store: store, Settings: settingsStore}
	studentAPI.Register(ginEngine.Group(""))
	studentAPI.RegisterEnrollRoutes(ginEngine.Group(""), enrollSvc)
	professorSvc := professor.New(database, settingsStore, scopeSvc)
	professorSvc.Production = cfg.IsProduction()
	professorAPI := &httpapi.ProfessorAPI{Svc: professorSvc, Store: store}
	professorAPI.Register(ginEngine.Group(""))
	gmSvc := groupmanager.New(database, settingsStore, scopeSvc)
	gmAPI := &httpapi.GroupManagerAPI{Svc: gmSvc, Store: store}
	gmAPI.Register(ginEngine.Group(""))
	adminSvc := admin.New(database, scopeSvc)
	adminSvc.SetStore(&settingsStoreAdapter{store: settingsStore})
	adminAPI := &httpapi.AdminAPI{Svc: adminSvc, Store: store}
	adminAPI.Register(ginEngine.Group(""))
	publicAPI := &httpapi.PublicAPI{Pool: database.Pool, Settings: settingsStore}
	publicAPI.Register(ginEngine.Group(""))

	// ── SPA: پروکسی (dev/Vite) یا فایل‌های dist (production) ──
	var spaHandler http.Handler
	if cfg.SpaUpstream != "" {
		u, err := url.Parse(cfg.SpaUpstream)
		if err != nil {
			log.Error("spa_upstream_invalid", logger.Fields{"error": err.Error()})
			os.Exit(1)
		}
		p := newHostPreservingProxy(u)
		spaHandler = p
	}

	nextUpstream, err := url.Parse(cfg.NextUpstream)
	if err != nil {
		log.Error("next_upstream_invalid", logger.Fields{"error": err.Error()})
		os.Exit(1)
	}

	root := edge.Root(cfg.OwnedPrefixes, ginEngine, spaHandler, cfg.SpaDist, nextUpstream, cfg.AllowedExtraOrigins)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           root,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Info("listening", logger.Fields{"addr": srv.Addr})
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("listen_failed", logger.Fields{"error": err.Error()})
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	log.Info("shutting_down", nil)
	shutCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		log.Error("shutdown_failed", logger.Fields{"error": err.Error()})
	}
	log.Info("stopped", nil)
}

func newHostPreservingProxy(u *url.URL) http.Handler {
	p := httputil.NewSingleHostReverseProxy(u)
	orig := p.Director
	p.Director = func(req *http.Request) {
		orig(req)
		req.Host = u.Host
	}
	return p
}

// settingsStoreAdapter سازگارساز settings.Store با رابط بستهٔ admin.
type settingsStoreAdapter struct {
	store *settings.Store
}

func (a *settingsStoreAdapter) Get(ctx context.Context, key string) (string, error) {
	return a.store.Get(ctx, key)
}

func (a *settingsStoreAdapter) Save(ctx context.Context, key, value string) error {
	return a.store.Save(ctx, key, value)
}

func (a *settingsStoreAdapter) Delete(ctx context.Context, key string) error {
	return a.store.Delete(ctx, key)
}

func (a *settingsStoreAdapter) AllDefs() []admin.SettingsDef {
	defs := a.store.AllDefs()
	out := make([]admin.SettingsDef, 0, len(defs))
	for _, d := range defs {
		out = append(out, admin.SettingsDef{Key: d.Key, Env: d.Env, Default: d.Default, EnvOnly: d.EnvOnly})
	}
	return out
}

func (a *settingsStoreAdapter) Invalidate() {
	a.store.Invalidate()
}
