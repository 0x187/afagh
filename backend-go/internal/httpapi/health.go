// ═══ /api/v2/health — faithful port of src/app/api/health/route.ts ═══
//
// Three backends are checked (same statuses: ok | down | skipped):
//   - db    → always (select 1)
//   - redis → only if REDIS_URL is set (PING)
//   - minio → only if S3_ENDPOINT/S3_BUCKET is set (bucketExists)
//
// No sensitive data is returned. Each check has a 3-second timeout so it doesn't hang under LB load.
package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/redis/go-redis/v9"

	"backend-go/internal/db"
)

const checkTimeout = 3 * time.Second

type Health struct {
	DB          *db.DB
	RedisURL    string
	S3Endpoint  string
	S3Bucket    string
	S3AccessKey string
	S3SecretKey string
	Version     string
}

// HealthGET JSON response with a uniform shape: {ok, checks:{db,redis,minio}, version}.
func (h *Health) HealthGET(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	checks := map[string]string{"db": "down", "redis": "skipped", "minio": "skipped"}

	done := make(chan struct{}, 3)
	go func() {
		ctx, cancel := context.WithTimeout(c.Request.Context(), checkTimeout)
		defer cancel()
		if err := h.DB.Pool.Ping(ctx); err == nil {
			checks["db"] = "ok"
		}
		done <- struct{}{}
	}()
	go func() {
		if h.RedisURL == "" {
			done <- struct{}{}
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), checkTimeout)
		defer cancel()
		// A single quick attempt — failure = down (same healthRedis policy as route.ts)
		opt, err := redis.ParseURL(h.RedisURL)
		if err != nil {
			checks["redis"] = "down"
			done <- struct{}{}
			return
		}
		opt.DialTimeout = 1500 * time.Millisecond
		opt.ReadTimeout = checkTimeout
		opt.WriteTimeout = checkTimeout
		client := redis.NewClient(opt)
		defer client.Close()
		pong, err := client.Ping(ctx).Result()
		if err == nil && pong == "PONG" {
			checks["redis"] = "ok"
		} else {
			checks["redis"] = "down"
		}
		done <- struct{}{}
	}()
	go func() {
		if h.S3Endpoint == "" && h.S3Bucket == "" {
			done <- struct{}{}
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), checkTimeout)
		defer cancel()
		client, err := minio.New(h.S3Endpoint, &minio.Options{
			Creds:  credentials.NewStaticV4(h.S3AccessKey, h.S3SecretKey, ""),
			Secure: false,
		})
		if err != nil {
			checks["minio"] = "down"
			done <- struct{}{}
			return
		}
		exists, err := client.BucketExists(ctx, h.S3Bucket)
		if err == nil && exists {
			checks["minio"] = "ok"
		} else {
			checks["minio"] = "down"
		}
		done <- struct{}{}
	}()

	for i := 0; i < 3; i++ {
		<-done
	}

	ok := checks["db"] == "ok" && checks["redis"] != "down" && checks["minio"] != "down"
	status := http.StatusOK
	if !ok {
		status = http.StatusServiceUnavailable
	}
	c.JSON(status, gin.H{"ok": ok, "checks": checks, "version": h.Version})
}
