# گزارش دور ۹ — چک کامل سلامت پروژه + سبزسازی سه گیتِ قرمز CI

**تاریخ:** ۹ سپتامبر ۲۰۲۶ — **وضعیت: ✅ سه نقص پیدا و رفع شد (همه با اجرای واقعی تأیید شده‌اند)**

> سؤال این دور: «پروژه چه شکلی شده، خوبه؟» — پاسخ کوتاه: **معماری و کد سالم‌اند، ولی سه گیتِ
> کیفیت CI روی این شاخه قرمز بود** (PR #9). حالا هر سه سبز شده‌اند.

---

## ۱) چک‌لیست سلامت (روی همین HEAD اجرا شد، نه ادعا)

| بررسی | ابزار | نتیجه |
|---|---|---|
| تایپ‌چک کل کالبد | `npx tsc --noEmit` (۳۲۲ فایل TS/TSX) | ✅ صفر خطا |
| تست واحد (۱۶ سوئیت) | `npm test` | ✅ همه سبز (۲۴+۲۳+… asserts) |
| بیلد پروداکشن | `npm run build` (Next 16 / Turbopack) | ✅ ۱۹ ثانیه، صفر خطا |
| گارد Server Actionها | `node scripts/audit-actions.mjs` | ❌ **۸ اکشن بدون گارد** → ✅ رفع شد |
| زنجیرهٔ استقرار روی PG واقعی | migrate → patches → seed → hardening | ❌ **شکست در hardening** → ✅ رفع شد |
| اثبات RLS + همزمانی | `rls-test.mjs` / `concurrency-test.mjs` | ❌ **هرگز اجرا نمی‌شد** → ✅ ۲۲/۲۲ و ۵/۵ |
| `npm audit` | `node scripts/ci-audit.mjs` | ✅ high/critical = ۰ (۴ تا moderate) |
| فاز صفر | `node --check` + بالا آوردن سرور | ✅ HTTP 200 |
| بدهی کد | شمارش TODO/FIXME، `as never`، `@ts-ignore`، `catch {}` خالی | ۴ / ۰ / ۰ / ۰ |

**بازتولید شکست‌ها در سندباکس:** با PostgreSQL واقعی (بدون داکر، `embedded-postgres` روی پورت
۵۴۳۲۹) دقیقاً همان پایپ‌لاین CI اجرا شد؛ لاگ‌های گیتهاب در دسترس نبودند (انقضا)، ولی ترتیب
موفق/ناموفق گام‌ها از `gh api …/jobs` گرفته شد و با بازتولید محلی یکی بود.

---

## ۲) نقص ۱ — `student_term_states` در هیچ مهاجرتی ساخته نمی‌شد (P0 استقرار)

**ریشه:** جدول در `src/db/schema.ts` تعریف شده، سیاست RLS‌اش به `src/db/pg-hardening.sql`
اضافه شده و در `admin/students/actions.ts#getTranscript` کوئری می‌شود — اما **هیچ فایل
`drizzle/*.sql` آن را نمی‌ساخت**. تنها جایی که ساخته می‌شد `scripts/import-sama-afagh.mjs`
بود (یک `CREATE TABLE IF NOT EXISTS` ad-hoc حین واردسازی سما). نتیجه:

- در سرورِ از قبل مهاجرت‌شده (که ETL روی آن اجرا شده) همه‌چیز کار می‌کرد؛
- در **نصب تازه** (CI، سرور نو، `docker compose up`) جدول وجود نداشت →
  `خطا در اجرای سخت‌سازی: relation "student_term_states" does not exist` →
  گام `hardening.mjs` قرمز → **سه آزمون امنیتی بعدی (RLS، همزمانی، اتاق انتظار) Skipped می‌شدند**؛
- یعنی عملاً اثبات P0 جداسازی سطری در CI اجرا نمی‌شد — و `getTranscript` هم با
  `try/catch` خاموش به حالت ناقص می‌افتاد (کارنامه بدون وضعیت نیمسال).

**فیکس:** مهاجرت نسخه‌دار `drizzle/0011_student_term_states.sql` (با `IF NOT EXISTS` تا روی
دیتابیس‌های دارای جدول بی‌اثر باشد) + ثبت در `drizzle/meta/_journal.json` مطابق رویهٔ
پروژه (مهاجرت دست‌نویس + ژورنال). ایندکس جدا برای `studentId` لازم نیست؛ قید یکتایی مرکب
همان پیشوند را پوشش می‌دهد.

✅ بعد از فیکس: `12/12 مهاجرت`، و `hardening` می‌گوید
`RLS فعال است (41/41)` + `پوشش RLS کامل: 54 جدول`.

## ۳) نقص ۲ — هشت Server Action بدون گارد (P0 امنیت)

`scripts/audit-actions.mjs` (گام ۷ CI) با خروجی ۱ پایان می‌یافت و ۸ اکشن را گزارش می‌کرد:

| فایل | اکشن | وضعیت واقعی |
|---|---|---|
| `admin/departments` | `listDepartments` `listStaffPicks` `listFaculties` `countOrphanCourses` | **واقعاً بدون گارد** — ساختار دانشکده/گروه + نام و عنوان اعضای کارکنان برای هر کلاینت ناشناس قابل صدا زدن بود |
| `admin/codes` | `countRows` | **واقعاً بدون گارد** — شمارش کل رکوردهای جدول‌های مرجع |
| `admin/codes` | `missingCodeSummary` `exportCodesCsv` | گارد غیرمستقیم داشتند (از راه `codeStats`/`listCodes`) |
| `admin/reports` | `exportReport` | گارد غیرمستقیم (از راه `runReport`)؛ خروجی تا ۵۰۰۰ ردیف |

**فیکس:** گارد صریح با همان مجموعهٔ نقشِ صفحهٔ میزبان اضافه شد
(`ADMIN/VICE_EDU` برای departments، `ADMIN/VICE_EDU/EDU_EXPERT` برای codes، `ROLES` برای reports).
هیچ رفتار UI تغییر نکرد؛ فقط لایهٔ دوم دفاع اضافه شد.

✅ `🔎 اکشن‌های ممیزی‌شده: 243 — ✅ همهٔ Server Actionهای غیرعمومی گارد دارند.`

## ۴) نقص ۳ — آزمون RLS به دادهٔ seed وابسته بود (ثبات ناپذیری تست)

`seed-base.mjs` در این شاخه **عمداً** ساخت آیین‌نامهٔ demo را حذف کرد («فقط ۶ سند تجمیعی
معتبر» + اسکریپت `cleanup-regulations.mjs`)، ولی `rls-test.mjs` همچنان
`if (!deg || !reg) throw new Error('seed-base اجرا نشده؟')` داشت → حتی بعد از رفع نقص ۱،
آزمون RLS در CI قرمز می‌شد (خطایی که شکست hardening پشت آن پنهان کرده بود).

**فیکس:** آزمون فیکسچر خودش را می‌سازد (اگر هیچ آیین‌نامه‌ای نبود، یک
«آیین‌نامهٔ تست RLS» درج می‌کند) — همان کاری که برای ترم/درس/فرآیند انجام می‌داد. وابستگی
تست یکپارچه به seed حذف شد.

✅ `🔒 نتیجهٔ آزمون RLS: 22 موفق، 0 ناموفق` · `⚙️ آزمون همزمانی: 5 موفق، 0 ناموفق`

---

## ۵) چیزهایی که بررسی شد و سالم است

- **تطبیق schema↔مهاجرت:** تک‌تک ۱۴۱ جدول `schema.ts` با `drizzle/*.sql` + `patches.sql` مقایسه
  شد؛ جز `student_term_states` هیچ جدولِ بی‌مهاجرتی نبود (`curriculum_versions/courses` هم
  در ۰۰۰۲ با RENAME ساخته می‌شوند، پس سالم‌اند).
- **پوشش RLS:** کوئری پوشش hardening روی DB واقعی ۵۴ جدول دارای ستون هویتی/مالی را همه
  با RLS می‌بیند؛ ۱۰ جدول deny-all و گرنت ستونیِ نقش `afagh_app` (بدون SUPERUSER/BYPASSRLS) برقرار.
- **آخرین کامیت (pin column widths + RTL pager):** `DataTable.tsx` ساختار تمیزی دارد (دو حالت
  کلاینتی/سروری، بدون `any`، بدون eslint-disable)؛ `table-fixed + colgroup` راه‌حل درستی برای
  پرش ستون هنگام سورت است.
- **فاز صفر (`afagh-erp`):** بدون وابستگی سنگین، seed و سرور بالا می‌آید (۲۰۰) — مستقل از
  کالبد سالم است.

## ۶) توصیه‌های باقی‌مانده (اولویت‌دار — در این دور اعمال نشد)

| اولویت | مورد | چرا |
|---|---|---|
| P2 | افزودن **ESLint** به CI (`eslint-config-next`) | درخت هیچ `eslint-disable` ندارد ولی هیچ lint gate هم نیست؛ ریسک رگرسیون هوک‌های React |
| P2 | خروج **Redis** از «تست‌های محلی» — اجرای `waiting-room-zset.test.mts` | در سندباکس به دلیل نبود باینری Redis قابل اجرا نبود؛ تنها گام CI است که محلی تأیید نشد (کد آن تغییر نکرده) |
| P2 | ۴ مورد `TODO/FIXME` و `catch`های خاموشِ کوئری در `getTranscript` | با وجود جدول، بهتر است خطا لاگ شود نه silent |
| P3 | مگاکامپوننت‌های بالای ۱۷۰۰ خط (`DepartmentPlanningClient` ۲۳۵۸، `CurriculumManagerClient` ۱۸۳۱، `StudentsManagerClient` ۱۷۴۵) | ادامهٔ همان نقشهٔ ریفکتور دور ۸ (گام ۴ و بعد) |
| P3 | ۴ آسیب‌پذیری moderate در `npm audit` | فعلاً زیر آستانهٔ CI (high) است؛ با آپدیت `postcss`/زنجیرهٔ build قابل بستن |

## ۷) تغییرات این دور (فایل‌ها)

```
afagh-next/drizzle/0011_student_term_states.sql        +  مهاجرت ساخت جدول (new)
afagh-next/drizzle/meta/_journal.json                  +7 ثبت مهاجرت در دفتر
afagh-next/scripts/rls-test.mjs                        +11 -2  فیکسچر آیین‌نامهٔ خودساخته
afagh-next/src/app/admin/departments/actions.ts        +4  گارد چهار اکشن خواندن
afagh-next/src/app/admin/codes/actions.ts              +5  گارد سه اکشن
afagh-next/src/app/admin/reports/actions.ts            +1  گارد exportReport
```

هر چهار گام سبزِ CI (`tsc`، `npm test`، `audit-actions`، `build`) و زنجیرهٔ کامل
`migrate → patches → seed → hardening → rls-test → concurrency-test` محلی سبز شدند.
