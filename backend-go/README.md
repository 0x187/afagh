# بکند Go آفاق (backend-go)

بازنویسی بkend سامانهٔ جامع آفاق با Go — فاز ۰ (زیرساخت strangler).

## معماری

سرویس Go **لبهٔ مسیریابی** است (Caddy → Go):

- مسیرهای مالک‌شده (`AFAGH_OWNED_PREFIXES`، پیش‌فرض `/api/v2` و `/app`):
  - `/api/v2/*` → API این سرویس (Gin) + هدرهای امنیتی + CSRF
  - `/app/*` → SPA جدید (`frontend-react`) — پروکسی به `AFAGH_SPA_UPSTREAM` (dev) یا فایل‌های `AFAGH_SPA_DIST` (production)
- بقیهٔ مسیرها → پروکسی به Next.js (`AFAGH_NEXT_UPSTREAM`)

سوییچ هر ماژول = افزودن یک پیشوند به `AFAGH_OWNED_PREFIXES` — بدون تغییر Caddy و بدون داون‌تایم.

## پارتی با afagh-next (قراردادهای حفظ‌شده)

| موضوع | مرجع قدیم | اینجا |
|---|---|---|
| سشن | `src/lib/auth.ts` — توکن ۶۴-hex، ذخیرهٔ sha256، dual-read `__Host-afagh_session` | `internal/session` |
| RLS | `src/db/index.ts` — `withUserRls` با `set_config('app.user_id')` | `internal/db.WithUserRls` (fail-closed در production) |
| CSRF | `src/lib/security.ts` — Origin/Referer + `ALLOWED_EXTRA_ORIGINS` | `internal/middleware/csrf.go` |
| هدرهای امنیتی | `next.config.mjs` | `internal/middleware/security.go` |
| health | `src/app/api/health/route.ts` — db/redis/minio با مهلت ۳ ثانیه | `/api/v2/health` |
| لاگ | `src/lib/logger.ts` — JSON یک‌خطی `level/time/app/env/msg` | `internal/logger` |
| کوکی/transport | `src/lib/proxy-trust.ts` | فاز ۱ (هنگام ست‌کردن کوکی در login) |

## اجرای محلی

```bash
# زیرساخت dev (پستگرس/ردیس/مینیو) — از afagh-next:
cd ../afagh-next && docker compose -p afagh-dev up -d

# سرویس Go:
cd ../backend-go
go build -o backend-go-dev ./cmd/afagh
DATABASE_URL='postgres://afagh:afagh@127.0.0.1:5432/afagh_db' \
REDIS_URL='redis://127.0.0.1:6380' \
PORT=8091 \
AFAGH_SPA_DIST=../frontend-react/dist \
./backend-go-dev

# تست:
go test ./...
```

## ساختار

```
cmd/afagh/          نقطهٔ شروع
internal/config/    ENVها (همان قرارداد afagh-next، fail-closed در production)
internal/logger/    لاگر JSON
internal/db/        دو استخر pgx (مالک + RLS) با withUserRls
internal/session/   سشن مشترک با Next (sha256، dual-read کوکی)
internal/httpapi/   هندلرهای /api/v2 (health، session)
internal/middleware/ هدرهای امنیتی، CSRF، لاگ دسترسی/ریکاوری
internal/edge/      لبهٔ مسیریابی strangler + سرو SPA
```
