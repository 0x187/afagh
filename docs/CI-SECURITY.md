# امنیت مستمر در CI

این سند توضیح می‌دهد در `D:\afagh` چه سازوکارهای امنیتی خودکار اجرا می‌شوند،
چگونه شاخه‌ها را محافظت کنیم، و وقتی یک یافتهٔ امنیتی ظاهر شد چگونه آن را
تriage کنیم.

> گردش‌کار امنیتی **مستقل** از `ci.yml` است. `ci.yml` دست‌نخورده باقی می‌ماند و
> همچنان دروازهٔ صحت کد (تایپ/تست/بیلد/RLS) است؛ فایل
> `.github/workflows/security.yml` فقط ابزارهای امنیتی را اجرا می‌کند تا خرابی
> یک ابزار، CI اصلی را قفل نکند.

---

## ۱) چه چیزی و کِی اجرا می‌شود

### ۱-۱. Dependabot — به‌روزرسانی خودکار وابستگی‌ها (`.github/dependabot.yml`)

| اکوسیستم | مسیر | زمان‌بندی |
|---|---|---|
| `npm` | `/afagh-next` | هفتگی (شنبه‌ها) |
| `docker` | `/afagh-next` (فایل `Dockerfile`) | هفتگی |
| `docker` | `/` (`docker-compose.yml`) | هفتگی |

- به‌روزرسانی‌های **minor/patch** در یک PR گروه‌بندی می‌شوند؛ **major** جداگانه
  می‌آید تا بازبینی دقیق‌تر شود.
- برای `next` به‌روزرسانی **major** نادیده گرفته می‌شود (ارتقای major نِکست نیازمند
  تست دستی build است — تجربهٔ `16.3.4 → 16.4.2`).
- برچسب‌های `dependencies` و `security` روی PRها گذاشته می‌شود تا در فهرست PRها
  سریع پیدا شوند.

### ۱-۲. گردش‌کار `Security` (`.github/workflows/security.yml`)

| رویداد | زمان |
|---|---|
| `push` روی `main` و `FINAL` | هر push |
| `pull_request` | هر PR (به هر شاخه) |
| `schedule` | هفتگی، شنبه‌ها ۰۳:۳۰ UTC |
| `workflow_dispatch` | اجرای دستی از تب Actions |

سه جاب مستقل:

1. **`secret-scan` — Gitleaks**
   کل تاریخچهٔ گیت (`fetch-depth: 0`) را برای کلید/توکن/رمز لو‌رفته اسکن می‌کند.
   این مهم است چون رازِ کامیت‌شده در گذشته هم تا وقتی از تاریخچه پاک نشود خطرناک است.
2. **`dependency-audit` — npm audit**
   - گام «گزارش آسیب‌پذیری‌ها»: `npm audit --omit=dev` — **غیرمسدودکننده**، فقط برای
     این‌که خلاصهٔ یافته‌ها در لاگ باشد.
   - گام «دروازهٔ high/critical»: `npm audit --omit=dev --audit-level=high` —
     **مسدودکننده**؛ اگر آسیب‌پذیری `high` یا `critical` در وابستگی‌های production
     باشد CI قرمز می‌شود.
   - فقط وابستگی‌های production (`--omit=dev`) سنجیده می‌شوند؛ یافته در ابزارهای
     توسعه اولویت پایین‌تری دارد و نباید انتشار را قفل کند.
3. **`typecheck` — تایپ‌چک**
   اگر اسکریپت `typecheck` در `afagh-next/package.json` موجود باشد
   (`npm run typecheck` = `tsc --noEmit`) اجرا می‌شود، وگرنه مستقیم `npx tsc --noEmit`.

> نکته: `ci.yml` نیز ممیزی وابستگی دارد اما از اسکریپت مقاوم
> `scripts/ci-audit.mjs` استفاده می‌کند که در برابر قطعی endpoint رجیستری npm
> تحمل دارد. `security.yml` از دستور خام `npm audit` استفاده می‌کند؛ در صورت
> قطعی رجیستری، لطفاً همان اجرا را از تب Actions دوباره اجرا کنید (Re-run).

---

## ۲) فعال‌سازی محافظت از شاخه (Branch protection)

هدف: هیچ کامیتی بدون عبور از دروازه‌های امنیتی روی `FINAL` (و در صورت نیاز `main`)
قرار نگیرد.

مسیر در GitHub:

`Settings → Branches → Add branch protection rule` (یا `Add ruleset`)

روی الگوی `FINAL` (و جداگانه `main`):

1. ✅ **Require a pull request before merging**
   - `Require approvals`: حداقل ۱.
   - `Dismiss stale pull request approvals when new commits are pushed`.
2. ✅ **Require status checks to pass before merging**
   - `Require branches to be up to date before merging`.
   - وضعیت‌های زیر را الزامی کنید (نام‌ها همان‌طور که در تب Actions دیده می‌شوند):
     - `رازها — Gitleaks`
     - `وابستگی‌ها — npm audit`
     - `کالبد — تایپ‌چک امنیتی`
     - و دروازه‌های `ci.yml`: `کالبد — تایپ، تست و بیلد`، `RLS — اثبات جداسازی سطری (P0)`
3. ✅ **Require conversation resolution before merging**
4. ✅ **Do not allow bypassing the above settings** (روی حساب‌های غیرمدیر).
5. (اختیاری) ✅ **Require linear history** و **Require signed commits**.

پس از این تنظیمات، PR تا وقتی هر سه جاب امنیتی سبز نشوند قابل merge نیست.

> اگر یک وضعیت (status) در فهرست دیده نشد، یعنی این گردش‌کار هنوز یک‌بار روی آن
> شاخه اجرا نشده است؛ ابتدا یک PR/اجرای دستی بسازید تا نام وضعیت ثبت شود.

---

## ۳) Triage یافته‌ها

### ۳-۱. Gitleaks (راز پیدا شد)

1. تب **Actions → Security → secret-scan** را باز کنید؛ Gitleaks می‌گوید کدام
   قاعده، کدام فایل و کدام **خط**.
2. تصمیم بگیرید:
   - **راز واقعی است** →
     1. راز را **فوراً باطل/چرخش کنید** (rotate). فرض کنید لو رفته است.
     2. مقدار را از سورس حذف و از متغیر محیطی/سکرت GitHub بخوانید.
     3. اگر راز در تاریخچهٔ گیت است، پاک‌سازی تاریخچه یا ابطال کلید لازم است —
        حذف از کامیت جدید کافی نیست.
     - مرجع: `docs/SECRETS-ROTATION-PROCEDURE.md` و `docs/SECRETS-MANAGEMENT-REVIEW.md`.
   - **مثبت کاذب است** (مثل مقدار تکراری در تست/فیکسچر) →
     یک فایل `.gitleaks.toml` در ریشهٔ مخزن بسازید و الگوی مورد را در
     `[allowlist]` قرار دهید (با `useDefault = true` تا قواعد پیش‌فرض حفظ شوند)،
     و در توضیح PR دلیل را بنویسید.
3. Gitleaks روی PR یک کامنت می‌گذارد؛ همان‌جا هم قابل پیگیری است.

### ۳-۲. npm audit (آسیب‌پذیری وابستگی)

1. در لاگ جاب `dependency-audit`، نام بسته و شدت (`high`/`critical`) را ببینید.
2. مسیر رفع به ترتیب اولویت:
   - `npm audit fix` داخل `afagh-next` (فقط اگر بدون شکستن قیود version باشد).
   - ارتقای هدفمند خود بسته با PR جدا + اجرای `npm test` و تست دستی مسیر مرتبط.
   - اگر رفع بالادستی وجود ندارد و ریسک واقعی نیست، آن را در
     `docs/archive/security-phase4-dependency-audit.md` مستند کنید (ریسک پذیرفته‌شده) و از
     مسیر `overrides` در `package.json` استفاده کنید — الگوی پیشین: `source-map-js`.
3. پس از رفع، `npm ci && npm audit --omit=dev --audit-level=high` را محلی اجرا و
   سبزی را تأیید کنید؛ سپس PR بفرستید تا Dependabot هم‌زمان redundant نشود.

> اگر شکست فقط به‌خاطر **قطعی رجیستری npm** بود (متن خطا شامل `503`/`Service
> Unavailable`)، هیچ یافته‌ای وجود ندارد: اجرا را Re-run کنید.

### ۳-۳. typecheck (خطای تایپ)

- خطای تایپ معمولاً نشانهٔ ناسازگاری تغییر جدید با نوع‌هاست، نه آسیب‌پذیری.
  مسیر فایل و خط را از لاگ بردارید، محلی `cd afagh-next && npx tsc --noEmit` بزنید
  و خطا را برطرف کنید. (توجه: `tsc --noEmit` خطاهای نوعِ تولیدی Next مثل
  `TS2344` در `page.tsx` را نمی‌بیند؛ برای تغییرهای P0 شاهدِ build لازم است —
  `docs/CI-BASELINE.md`.)

### ۳-۴. Dependabot

- PRهای Dependabot از همان دروازهٔ `Security` عبور می‌کنند. اگر سبز شد، پس از یک
  بازبینی کوتاه merge کنید.
- برای major، ابتدا `npm test` و build محلی (`docs/CI-BASELINE.md`، Node 22) را
  تأیید کنید.
- برای docker، ایمیج پایه را در محیط دورریز تست کنید پیش از merge.

---

## ۴) دستورهای بازتولید محلی

```bash
# رازها (نیازمند نصب gitleaks)
gitleaks detect --source . --verbose

# وابستگی‌های production
cd afagh-next
npm ci
npm audit --omit=dev
npm audit --omit=dev --audit-level=high   # دروازهٔ مسدودکننده

# تایپ‌چک
npm run typecheck
```

---

## ۵) پیوست‌ها

- `docs/SECURITY-POLICY.md` — سیاست کلی امنیت
- `docs/SECRETS-ROTATION-PROCEDURE.md` — چرخش رازها
- `docs/SECRETS-MANAGEMENT-REVIEW.md` — بازبینی مدیریت رازها
- `docs/DEPLOY-SECURITY-CHECKLIST.md` — چک‌لیست استقرار
- `docs/INCIDENT-RESPONSE-RUNBOOK.md` — واکنش به رخداد
- `docs/archive/security-phase4-dependency-audit.md` — ممیزی وابستگی‌ها
- `docs/CI-BASELINE.md` — وضعیت پایهٔ CI
- `.github/workflows/ci.yml` — دروازهٔ صحت کد (دست‌نخورده)
- `.github/workflows/security.yml` — همین گردش‌کار امنیتی
