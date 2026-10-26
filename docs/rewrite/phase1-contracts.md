# قرارداد API فاز ۱ — Auth و پوسته (مرجع مشترک ایجنت‌ها)

این سند تک‌منبع حقیقت قرارداد بین بکند Go و فرانت React در فاز ۱ است.
اصول کلی: **پاکت پاسخ `{ok: boolean, error?: string, ...payload}`**، پیام‌های خطا **فارسی و عیناً همان رشته‌های** afagh-next، کوکی‌ها همان نام‌ها/سمانتیک‌های فعلی، گاردها پورت `getSessionUser`.

## اندپوینت‌ها

### POST /api/v2/auth/login
پورت `login()` در `afagh-next/src/lib/auth.ts` + تبدیل پیام `login.actions.ts`.
- بدنه: `{identifier: string, password: string}`
- موفق (یک حساب): `200 {ok:true, mustChange:boolean}` + ست کوکی سشن
- موفق (چند حساب هم‌رمز): `200 {ok:false, needChoice:true, token, candidates:[{id,name,staffCodes[],universityTitle,roles[]}]}` — `token` از TokenSigner با TTL ۵ دقیقه، payload `{uids:"1,2", ident}`
- شکست: `200 {ok:false, error:"شناسه یا رمز نادرست است."}`
- محدودیت IP تمام‌شده: `429 {ok:false, error:"<همان پیام عمومی login.actions.ts>"}`
- قواعد حیاتی: نرمال‌سازی ارقام فارسی (toEnDigits)، رزرو پیش‌از-scrypt برای سقف IP (100/10min) و حساب (5/10min)، تأخیر تصاعدی per-account قبل از رمز، پدینگ زمان‌ثابت با هش ساختگی وقتی کاندیدای فعال نیست، پسوند رمز نرمال‌شده، گسترش هم‌شخصی با STAFF_NC_MAP (اگر فایل generated در دسترس بود؛ وگرنه بدون آن پورت شود و در گزارش ذکر شود)، issueSessionFor = حذف نشست‌های منقضی + همهٔ نشست‌های کاربر + درج نشست تازه + پاک‌کردن قفل idle (ClearLock) + ست کوکی.

### POST /api/v2/auth/choose-account
پورت `chooseLoginAccount`. بدنه `{token, userId}` → `{ok, mustChange?}` | `{ok:false, error}`. سقف 10/10min با کلید `choose:<ip>`.

### POST /api/v2/auth/logout
پورت `logout()`: حذف همهٔ نشست‌های کاربر (fallback حذف با توکن)، پاک‌کردن قفل idle، حذف هر دو نام کوکی → `{ok:true}`.

### POST /api/v2/auth/change-password
پورت `changePassword` (auth.ts خط‌به‌خط): گارد با allowPendingPasswordChange=true، تأیید رمز فعلی (+ واریانت ارقام فارسی)، اعتبارسنجی‌ها با همان پیام‌ها (حداقل ۱۰، حداکثر ۱۲۸، حرف+رقم، عدم برابری)، هش scrypt، `mustChangePassword=0`، ابطال سایر نشست‌ها (نشست جاری می‌ماند) → `{ok:true}` | `{ok:false, error}`.

### POST /api/v2/auth/switch-account
پورت `src/lib/account-switch.ts`: ورود به حساب هم‌شخص دیگر با رمز همان حساب → `{ok, mustChange?}` | `{ok:false, error}` + کوکی سشن جدید.

### GET /api/v2/session/ping
پورت `src/app/api/session/ping/route.ts` + `session-lock.ts`: heartbeat با معنای دقیق فعلی (`{active:true}` تازه‌سازی last-seen، `{active:false}` ممکن است قفل بزند) — کلیدهای Redis **عیناً** `sesslock:{id}` و `sessseen:{id}` تا با سیستم قدیم مشترک بماند.

### POST /api/v2/session/unlock
پورت `unlock`: رمز کاربر جاری، سقف 5/15min per-user + per-IP با همان پیام‌ها، موفق = رفع قفل → `{ok:true}` | `{ok:false, error}`.

### GET /api/v2/scope
وضعیت جاری: `{ok, universityId|null, termId|null, universities:[{id,title}], terms:[...]}` — از کوکی‌های `afagh_uni`/`afagh_term` + مجوزها (پورت university-scope.ts/term-scope.ts).

### POST /api/v2/scope/university  |  POST /api/v2/scope/term
پورت `/api/scope/*` (CSRF + اعتبارسنجی مجاز‌بودن هدف برای این کاربر) → ست کوکی → `{ok:true}` | `{ok:false, error}`.

## کوکی سشن (پورت sessionTransport در proxy-trust.ts — عین ماتریس)
- نام‌ها: `token` (همیشه) + `__Host-afagh_session` فقط اگر `AFAGH_SESSION_COOKIE_PREFIX=host` **و** Secure.
- Secure: production ⇒ همیشه true؛ غیر production: `AFAGH_COOKIE_SECURE=true/false` یا بر اساس https بودن `AFAGH_PUBLIC_BASE_URL` (auto).
- SameSite: `AFAGH_COOKIE_SAMESITE=none|strict` وگرنه lax؛ «none بدون Secure» ⇒ برگشت به lax با هشدار.
- httpOnly, Path=/, بدون Domain, MaxAge=AFAGH_SESSION_MAX_HOURS (پیش‌فرض 4، بازهٔ 1..24).
- حذف خروج: هر دو نام با MaxAge=0.

## scrypt (پارت با Node)
فرمت ذخیره: `salt:hash` هگز؛ salt=16 بایت تصادفی، keyLen=32، N=AFAGH_SCRYPT_N (پیش‌فرض 16384، کف production)، r=8، p=1 — `golang.org/x/crypto/scrypt` سازگار است. مقایسه timing-safe + هش ساختگی `000...:000...`.

## اینترفیس‌های مشترک (امضاها باید دقیقاً همین باشند تا یکپارچه‌سازی ساده بماند)
```go
// پکیج مصرف‌کننده، اینترفیس خودش را تعریف می‌کند — پیاده‌سازی:
type RateLimiter interface { // پکیج ratelimit
    Allow(ctx context.Context, key string, limit int, windowSec int) (allowed bool, retryAfterSec int, err error)
    Count(ctx context.Context, key string) (int, error)
    Release(ctx context.Context, key string) error
}
type SettingsStore interface { // پکیج settings
    Get(ctx context.Context, key string) (string, error) // DB > ENV > default؛ ناگته‌ها به خطا نه
}
type TokenSigner interface { // پکیج verification
    Sign(ctx context.Context, payload map[string]any, ttlSec int) (string, error)
    Verify(ctx context.Context, token string) (payload map[string]any, ok bool, err error)
}
type LockClearer interface { // پکیج sessionlock
    ClearLock(ctx context.Context, userID int64) error
}
```

## مالکیت فایل‌ها (هر ایجنت فقط فایل‌های خودش را می‌نویسد)
- **Go-auth**: `internal/authn/*` (شامل کوکی سشن)، `internal/httpapi/auth.go`
- **Go-infra**: `internal/ratelimit/*`، `internal/settings/*`، `internal/verification/*`
- **Go-lock**: `internal/sessionlock/*`، `internal/httpapi/sessionlock.go`
- **Go-scope**: `internal/scope/*`، `internal/httpapi/scope.go`
- **FE-auth**: `src/routes/login/*`، `src/routes/ChangePassword.tsx`، `src/lib/auth-api.ts`، `src/lib/home-route.ts` (+تست‌هایش)
- **FE-shell**: `src/components/shell/*` (فایل‌های جدید)، `src/lib/scope-api.ts`، `src/lib/idle-lock.ts` (+تست‌هایش)
- ممنوع لمس: `cmd/afagh/main.go`، `go.mod/go.sum`، `package.json`، `src/App.tsx`، `src/components/shell/AppShell.tsx` (یکپارچه‌سازی با من)، `internal/session/` و `internal/edge/` و `internal/httpapi/session.go` (پورت‌شدهٔ فاز ۰).
- اجازهٔ افزودن وابستگی npm/go وجود ندارد؛ اگر لازم شد در گزارش بنویسید.

## تست و بیلد (هر ایجنت موظف است سبز کند)
- Go: `cd backend-go && go build ./... && go vet ./... && go test ./...` (تست واحد برای هر قاعدهٔ حساس: ماتریس کوکی، نرمال‌سازی، اعتبارسنجی رمز، پارتی scrypt با بردار شناخته‌شده، مسیر خطای verify).
- FE: `docker run --rm --user $(id -u):$(id -g) -e HOME=/tmp -v /home/sr/git/afagh/frontend-react:/w -v afagh_npm_cache:/tmp/.npm -e npm_config_cache=/tmp/.npm -w /w node:22-bookworm-slim npm run test` (تست برای home-route، نرمال‌سازی ارقام، اعتبارسنجی فرم، منطق heartbeat/قفل).
