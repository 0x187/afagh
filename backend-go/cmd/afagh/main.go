// ═══ Afagh Go Backend Service — Entry Point ═══
//
// The binary only loads configuration, builds the application graph
// (internal/app), and manages the process lifecycle. Everything else
// lives in internal/* — see docs/ENGINEERING-GUIDE.md.
//
// Running locally:
//
//	AFAGH_NEXT_UPSTREAM=http://127.0.0.1:8080 PORT=8090 go run ./cmd/afagh
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"backend-go/internal/app"
	"backend-go/internal/config"
	"backend-go/internal/logger"
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

	application, err := app.New(ctx, cfg)
	if err != nil {
		log.Error("startup_failed", logger.Fields{"error": err.Error()})
		os.Exit(1)
	}

	serveErr := application.Serve()

	select {
	case err := <-serveErr:
		if err != nil {
			log.Error("listen_failed", logger.Fields{"error": err.Error()})
			os.Exit(1)
		}
		return
	case <-ctx.Done():
	}

	log.Info("shutting_down", nil)
	shutCtx, cancel := context.WithTimeout(context.Background(), app.DefaultShutdownTimeout)
	defer cancel()
	if err := application.Shutdown(shutCtx); err != nil {
		log.Error("shutdown_failed", logger.Fields{"error": err.Error()})
	}
	log.Info("stopped", nil)
	application.Close()
}
