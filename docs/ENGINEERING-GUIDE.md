# راهنمای مهندسی آفاق — Go + React

> مخاطب: هر کسی که میخواهد به این ریپو قابلیت اضافه کند.
> هدف: کد همیشه قابل توسعه بماند — افزودن فیچر نباید نیاز به خواندن ۳٬۰۰۰ خط داشته باشد.
> این سند قراردادهای ساختاری نسخهٔ Go/React است؛ معماری کل سامانه در [`ARCHITECTURE.md`](./ARCHITECTURE.md) است.

## ۱) نقشهٔ ریپو

```
backend-go/
  cmd/afagh/main.go        ← فقط: config + logger + app.New + lifecycle
  internal/app/            ← مونتاژ برنامه (وایرینگ)
    app.go                 ← App struct، New، Serve/Shutdown/Close
    infra.go               ← db/redis/settings/session/ratelimit/signer/scope
    services.go            ← سرویسهای دامنه + اتصالهای بینسرویسی
    http.go                ← gin engine + ثبت تمام مسیرهای /api/v2 (ترتیب مهم)
    adapters.go            ← آداپتور اینترفیس بین پکیجها
    spa.go                 ← پروکسی/فایل SPA
  internal/<domain>/       ← منطق دامنه؛ مالک SQL و تراکنشها (student, enroll, admin, payroll, …)
  internal/httpapi/        ← لایهٔ HTTP نازک: Bind → سرویس → پاکت پاسخ
  internal/middleware/     ← CSRF، security headers، access log
  internal/edge/           ← لبهٔ strangler (مالکیت مسیرها → Next/SPA/gin)
frontend-react/
  src/lib/<domain>-api.ts  ← کلاینت API (apiGet/apiPost + تایپها)
  src/routes/<role>/       ← صفحات؛ هر مسیر یک کامپوننت
  src/components/{ui,shell,schedule}/
  src/App.tsx              ← فقط تعریف مسیرها
docs/                      ← معماری، راهنماها، وضعیت بازنویسی
```

## ۲) قوانین طلایی (در بازبینی بررسی میشوند)

1. **لایهٔ HTTP نازک است.** هندلر فقط: گارد نقش → Bind → یک صدا به سرویس → `{"ok":true,data}` یا `a.fail(c,err)`. SQL و تراکنش در `internal/<domain>` است.
2. **مرز دانشگاه fail-closed.** هر کوئری دادهٔ چنددانشگاهی یا با `s.UniversityID(ctx,user,cookie)` محدود میشود یا صراحتاً سراسری بودنش مستند است (`schedScopeCond` الگوی مرجع است).
3. **پیامهای کاربر فارسی، کامنت انگلیسی.** خطاهای زیرساختی نباید به مرورگر نشت کنند (الگوی `failClassroom`).
4. **پاکت پاسخ واحد:** `{"ok":true,"data":…}` / `{"ok":false,"error:"پیام فارسی"}`.
5. **تغییر دادهٔ حساس = audit.** نوشتن در جدولهای مالی/آموزشی/حذفها باید در `audit_logs` ثبت شود (الگوی `writeAdminAudit`).
6. **هر API یک `Register(gin.IRouter)`.** ثبت مسیر فقط در `internal/app/http.go` انجام میشود؛ ترتیب ثبت را تغییر ندهید (gin روی تداخل مسیر panic میکند).
7. **فایل بزرگ = فریز.** روی فایلهای بزرگتر از ~۱٬۵۰۰ خط (`last_pages.go`، `migration_center.go`، `scheduling_suite.go`) فیچر جدید اضافه نمیشود؛ قابلیت جدید در پکیج/فایل جدید میرود و از همانجا extract فرصتی انجام میشود.
8. **کامنت/doc-comment فقط انگلیسی؛** تست و بیلد سبز شرط کامیت است.

## ۳) افزودن یک قابلیت بک‌اند — دستور پخت

مثال: «مدیریت X» با فهرست/ذخیره/حذف.

```go
// internal/x/service.go
package x

type Service struct { DB *db.DB; Scope *scope.Service; Settings *settings.Store }

func New(db *db.DB, sc *scope.Service, st *settings.Store) *Service { … }

func (s *Service) ListItems(ctx context.Context, user *session.User, uniCookie string) ([]Item, error) {
    uni := s.Scope.UniversityID(ctx, user, uniCookie) // fail-closed
    …
}
```

```go
// internal/httpapi/x.go
type XAPI struct { Svc *x.Service; Store *session.Store }

func (a *XAPI) Register(r gin.IRouter) {
    r.GET("/admin/x", a.list)
    r.POST("/admin/x", a.save)
}
// هندلر: گارد → Bind → سرویس → c.JSON(http.StatusOK, gin.H{"ok":true,"data":res})
```

سیمکشی (دو خط):
- `internal/app/services.go`: `a.xSvc = x.New(a.DB, a.scopeSvc, a.settings)`
- `internal/app/http.go`: `(&httpapi.XAPI{Svc: a.xSvc, Store: a.store}).Register(g)`

برای **تنظیم جدید**: کلید را در `settings.PhaseOneDefs` ثبت کنید (DB>ENV>default خودکار اعمال میشود).
برای **کرون جدید**: موتور در `internal/cron` + ثبت در `CronExtraAPI` با گارد `x-cron-secret`.
برای **صفحهٔ عمومی جدید**: پیشوند را به `AFAGH_OWNED_PREFIXES` اضافه کنید و در `edge` مالکیت بگیرید.

## ۴) افزودن یک قابلیت فرانت

1. تایپها و توابع API در `src/lib/<domain>-api.ts` (با `apiGet/apiPost`؛ پاکت خودکار باز میشود).
2. صفحه در `src/routes/<role>/<Feature>Page.tsx` فقط با کامپوننتهای `components/ui`.
3. مسیر در `src/App.tsx` + کاشی در `DashboardPage.MODULES` (ادمین) یا لینک نوار موبایل `MobileTabBar`.
4. خطاهای API با `e.message` نمایش داده میشوند؛ پیام موفقیت از `data.message`.

## ۵) تست و راستی‌آزمایی

| چه چیزی | دستور |
|---|---|
| بک‌ند | `cd backend-go && go build ./... && go vet ./... && go test ./...` |
| فرانت | `docker run --rm -v $PWD/frontend-react:/app -v afagh_npm_cache:/root/.npm -w /app node:22-bookworm-slim sh -c "npx tsc --noEmit && npm test -- --run && npm run build"` |
| دود runtime | بیلد بک‌ند، اجرا با `.zcode/dev-go.env`، `curl /api/v2/health` → ۲۰۰ و لاگین ادمین → نمونهٔ API نقش‌دار |

تعریف «تمامشده»: کد + تست + بیلد سبز + بررسی مرورگری برای UI + ثبت در `REWRITE-STATUS.md`.
قبل از کامیت در بک‌ند: `gofmt -w .` (کل بک‌ند فرمت‌شده نگه داشته میشود).

## ۶) فهرست بدهی فنی ساختاری (به‌ترتیب اولویت)

| مورد | جایگزین هدف |
|---|---|
| `internal/admin` با ۴۰+ فایل و فایلهای ۳هزار خطی | قابلیت جدید در پکیج دامنهٔ خودش (مثل `admin/classrooms.go` الگوی خوب) و بهمرور extract |
| `internal/httpapi/admin.go` (۱٬۸۰۰ خط) | تقسیم به فایلهای per-domain با همان `AdminAPI` |
| هندلرهای قدیمی با SQL داخلی | هنگام دست زدن، SQL به سرویس دامنه منتقل شود |
| فاقد ESLint در فرانت | افزودن ESLint + `staticcheck/gosec` به CI |
| باندل واحد ۱٫۷MB فرانت | code-splitting بر اساس نقش |
