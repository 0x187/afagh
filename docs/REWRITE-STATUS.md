# وضعیت بازنویسی آفاق (Go + React) — فاز ۱۱

این سند «تصویر لحظه‌ای» بازنویسی کامل ERP دانشگاه آفاق است: چه ماژول‌هایی
به بک‌ند Go و فرانت React منتقل شده‌اند، چه چیزهایی هنوز در Next.js است، و
چطور بدون داون‌تایم و بدون لاگین مجدد کاربران سوییچ انجام می‌شود.

## معماری (strangler)

```
Caddy ─▶ Go edge (:8091)
           ├─ /api/v2/*            → API جدید (Gin + pgx + Redis + MinIO)
           ├─ /app/*               → SPA (React 19 + Vite + Tailwind v4 + TanStack Query)
           ├─ /verify-*، /id، /exam-ticket، /open-courses → SPA (صفحات عمومی)
           └─ هر چیز دیگر          → پروکسی به Next.js (نسخهٔ فعلی، زنده)
```

- **سشن مشترک:** کوکی `token`/`__Host-afagh_session` و جدول `sessions` مشترک
  است؛ کاربر لاگین‌شده بین UI قدیم و جدید جابه‌جا می‌شود.
- **اسکیما دست‌نخورده:** migrator/Drizzle مالک اسکیما می‌ماند؛ Go فقط مصرف‌کننده است.
- **RLS:** همان الگوی `set_config('app.user_id', …)` (fail-closed در production).
- **سوییچ هر ماژول = یک پیشوند** در `AFAGH_OWNED_PREFIXES`
  (پیش‌فرض: `/api/v2,/app`؛ صفحات عمومی: `/verify-transcript,/verify-finance,
  /verify-enrollment,/exam-ticket,/id,/verify-degree,/verify-certificate,/open-courses`).

## ماژول‌های منتقل‌شده (کامیت‌ها روی main)

| فاز | ماژول | بک‌ند | فرانت | کامیت‌ها |
|---|---|---|---|---|
| ۰–۱ | زیرساخت، auth، سشن مشترک، تغییر رمز، قفل idle، سوییچ دانشگاه/نیمسال | `authn`, `session`, `scope` | `login`, `ChangePassword`, `AppShell` | تا فاز ۱ |
| ۲ | کتابخانه‌های خالص (جلالی، جست‌وجوی فارسی، پول، PII، safe-input، زمان‌بندی، GPA، شهریه) | `jalali`, `fa`, `money`, `gpa`, `tuition` | تست‌ها (vitest) | فاز ۲ |
| ۳ | پورتال دانشجو (۱۴ صفحه) شامل انتخاب واحد با waiting-room (Lua + صف Redis) | `student`, `enroll` | ۱۴ صفحهٔ `/student/*` | فاز ۳ |
| ۴ | پورتال استاد (۱۱ صفحه) شامل حضور/غیاب، دفتر نمرات، قرارداد و امضای OTP، اسناد، ارزشیابی، عملکرد، سرفصل | `professor` | ۱۱ صفحهٔ `/professor/*` | فاز ۴ |
| ۵ | مدیر گروه (۷ صفحه) | `groupmanager` | `/group-manager/*` | فاز ۵ |
| ۶ | ادمین آموزشی: داشبورد، دانشجویان، ارائه‌ها/پنجره، ارزشیابی، تختهٔ هفتگی، تنظیمات، امتحانات، حضور دستی/کنترلی | `admin` (+`finance`, `student`) | ۸ صفحهٔ `/admin/*` | 1f35abe.. |
| ۷ | مالی: کارتابل/کارنامهٔ مالی، نوع درس مالی، تعاریف موتور مالی، POS، حقوق و دستمزد (موتور، زنجیرهٔ تأیید، CSV بانکی) | `admin/finance*`, `payroll`, `tuition.Engine` | FinancePages، FinanceRulesPage، PosPage، PayrollPage | 1f35abe, 0d9e004, 6df651d |
| ۸ | گردش‌کار: کارتابل + موتور پیشبرد + گذرگاه رویداد + SLA + طراح فرایند؛ کمیتهٔ انضباطی؛ شورا | `workflow`, `admin/committees`, `tuition` | WorkflowsPage، DisciplinePage، CouncilPage | acb702b, e2bbb6b |
| ۹ | استعلام عمومی: کارنامه، مالی، انتخاب واحد، کارت آزمون، کارت دانشجویی، مدرک، گواهینامه، دوره‌های آزاد | `publicverify`, `opencourses` | صفحات ریشهٔ `/verify-*`, `/id/:token`, `/exam-ticket/:token`, `/open-courses` | bc7220a, 84b12e9, b1c1fa3 |
| ۱۰ | کرون‌ها (پویش مهلت bypass، یادآوری چک، رویدادهای گردش‌کار)، ارسال چندکاناله (SMS + ۵ پیام‌رسان)، بایگانی MinIO | `cron`, `messaging`, `archive` | AdminArchivePage | faeae24, d104c12 |
| ۱۲ | حقوق تکمیلی: سمت‌های موظفی و انتساب ترمی، نقش‌های تدریس، نقش دستی ارائه، پوشش فرمول، ابلاغ‌ها، آیین‌نامه‌ها، اعتراض + فیش پورتال استاد، پرداخت‌های امتحانی، دفتر پایان‌نامه | `payroll` (roles/decrees/objections/regulations/exam_payments/thesis_ledger) | PayrollRolesPage، TeachingRolesPage، PayrollCoveragePage، PayrollDecreesPage، PayrollRegsObjectionsPage، PayrollOperationsPage، ProfessorPayrollPage | 120f761..f220bee |
| ۱۲ | مالی تکمیلی: ضریب نیمسال (با سقف ±۲۰٪)، نوع مبلغ موضوعی، تخصیص دانشجو | `admin/finance_extra` | تب ویرایشگر در FinanceRulesPage | 996e254 |
| ۱۲ | کنترل زمانی ثبت مالی + فرمول ویژهٔ دانشجو (override) | `admin/finance_timecontrol`, `admin/finance_override` | AdminFinanceAdvancedPage | b7398d2 |
| ۱۲ | صندوق رفاه: صندوق‌ها، وام‌ها و انتساب صندوق به وام | `admin/finance_welfare` | AdminWelfarePage | 096b9a8 |
| ۱۲ | مرکز گزارش‌های مالی (۷ گزارش + CSV) و صورت‌حساب/کارنامهٔ مالی رسمی با ریز دروس تعرفهٔ سما | `reports`, `bi`, `tuition/tariff`, `student/statement` | AdminFinanceReportsPage، AdminStudentStatementPage + FinancialTranscript | 44ad9fc |
| ۱۲ | هشدارهای زمان‌بندی‌شده + کرون ارسال چندکاناله (`scheduled-warnings`, `SCHED_WARN_CHANNELS`) | `admin/warnings`, `cron/warnings` | AdminWarningsPage | 4da2e12 |
| ۱۲ | میز فارغ‌التحصیلی: پویش/پرونده، تأیید، ایرانداک، تسویه موازی، سجاد/کد صحت، تمبر، صدور و تحویل مدرک، دپارتمان‌های تسویه، خدمات دانش‌آموختگان | `graduation` | AdminGraduationPage | eed697e |

وضعیت فعلی: **۲۵ بستهٔ تست Go سبز** (شامل مالی/شهریه/تعرفه/گزارش/BI/فارغ‌التحصیلی
و ۱۷ تست پکیج حقوق)، **۲۸ تست Vitest سبز**، بیلد Go و TS/Vite سبز.

## سطوح API

- مسیرهای Go: **۲۸۰** در ۱۷ فایل `internal/httpapi/*.go` (شامل auth، scope،
  student، enroll، professor، groupmanager، admin، payroll، workflow، public، cron، reports).
- نقاط مسئله‌دار که بایت‌به‌بایت سازگار پورت شده‌اند: زنجیرهٔ هش `audit_logs`،
  اسکریپت‌های Lua.waiting-room، تراز کانونی دفتر مالی (`ledger-balance`)،
  فرمت توکن `T1.<b64>.<sig>` + چرخش کلید، canonical JSON مدرک،
  اثر انگشت گواهینامهٔ دورهٔ آزاد.

## چه چیزی هنوز در Next.js است (پروکسی می‌شود)

تا وقتی این فهرست خالی نشده، Next.js باید زنده بماند:

- **حقوق:** شبیه‌ساز سناریو (`?tab=simulator` — دادهٔ نمایشی).
- **مالی:** `tuition` (کل موتور شهریه UI). مرکز گزارش‌های مالی و
  صورت‌حساب/کارنامهٔ مالی منتقل شدند.
- **ادمین:** `reports` (مرکز گزارش‌های آموزشی)، `admissions`، `student-cards`،
  `saham`، `samin`، `bi`،
  `dorm`، `discipline`/`council`/`warnings`/`graduation` (منتقل شده)، `defense-scheduling`،
  `enrollment-approvals`/`enrollment-confirmation`، `manual-enroll`،
  `group-transfer`، `course-merge`، `equivalence-clusters`، `curriculum`،
  `regulation-check`، `grade-status-codes`، `lesson-plans`، `templates`، `codes`،
  `migration`، `sanjesh-import`، `short-courses`، `c/[group]`.
- **عمومی:** `verify` (کد QR قدیمی `verify/[code]`)، `verify/search`،
  `verify/document`، `verify-degree/search`، `help`، `manual`، `alumni`،
  `proctor`، `messenger` (صفحهٔ اتصال پیام‌رسان)، `p/[code]`.
- **یکپارچه‌ها:** poll worker پنج پیام‌رسان + توکن‌های اتصال (inbound جفت‌سازی)،
  کرون‌های `greetings`، `graduation-scan`، `messenger-link-purge`، `bi-refresh`
  (کرون `scheduled-warnings` منتقل شد).

## راهنمای سوییچ تدریجی (بدون داون‌تایم)

1. هر ماژول که در React پیاده شد، پیشوند آن را به `AFAGH_OWNED_PREFIXES` اضافه
   کنید (مثال `/admin/finance` فقط وقتی تمام زیرصفحه‌های همان مسیر منتقل شده‌اند).
2. `crontab` را برای جاب‌های منتقل‌شده به `/api/v2/cron/<job>` با هدر
   `x-cron-secret` تغییر دهید. رازها: `BYPASS_CRON_SECRET`،
   `CHEQUE_CRON_SECRET`، `WORKFLOW_CRON_SECRET` (در جدول `system_settings` یا ENV؛
   بدون راز، جاب fail-closed رد می‌شود).
3. پس از خالی‌شدن فهرست بالا: حذف پروکسی Next، توقف سرویس Next و حذف
   `AFAGH_NEXT_UPSTREAM`.

## پیکربندی لازم (production)

```
DATABASE_URL, REDIS_URL, PORT=8091
AFAGH_SPA_DIST=/path/to/frontend-react/dist
AFAGH_OWNED_PREFIXES=/api/v2,/app,…   # پیشوندهای منتقل‌شده
TICKET_TOKEN_SECRET / PREVIOUS_TICKET_TOKEN_SECRET   # امضای توکن‌های T1
S3_ENDPOINT, S3_BUCKET=afagh-archive, S3_ACCESS_KEY, S3_SECRET_KEY
NEXT: AFAGH_NEXT_UPSTREAM=http://127.0.0.1:8080 (تا پایان مهاجرت)
```

`TICKET_TOKEN_SECRET` و رازهای کرون در production الزامی‌اند (بدون آن‌ها
استعلام‌ها/جاب‌ها fail-closed می‌شوند؛ همان رفتار TS).

## راستی‌آزمایی انجام‌شده در این محیط

- `go build ./...` و `go test ./...` (۲۲ پکیج) سبز؛ `go vet` پکیج‌های جدید سبز.
- `tsc -b` و `vite build` سبز؛ `vitest` (۲۸ تست) سبز.
- QA مرورگر برای: کارتابل مالی/حقوق/گردش‌کار/انضباطی/شورا/بایگانی،
  تعاریف مالی، POS، مرکز گزارش‌های مالی (اجرای گزارش شهریه/کارتابل/BI)،
  صورت‌حساب رسمی دانشجو (کارت‌ها، ریز دروس، نمودار)، هشدارهای زمان‌بندی‌شده
  (ثبت→ارسال فوری→کرون→ارسال‌شده) و میز فارغ‌التحصیلی (خط لوله، پرونده،
  دپارتمان‌ها، دانش‌آموختگان؛ صدور/استعلام آزمایشی سند) و صفحات عمومی استعلام
  (کارنامه، مالی، انتخاب واحد، کارت آزمون، کارت دانشجویی، مدرک، گواهینامه،
  دوره‌های آزاد) — با دادهٔ واقعی DB.

## انحراف‌های آگاهانه (بدون باگ)

- **POS:** فروش عمداً `PENDING` می‌ماند و در دفتر مالی ثبت نمی‌شود تا
  راستی‌آزمایی بانکی؛ ویدی فقط روی ردیف `APPROVED` با برگشتی پیونددار.
- **اعلان بیرونی داخل تراکنش:** در دو نقطهٔ درون-تراکنشی (ثبت درخواست دانشجو و
  ثبت واحد) فقط پیام درون‌سامانه درج می‌شود؛ ارسال بیرونی پس از commit انجام
  نمی‌شود تا در rollback، پیام کاذب نرود (TS پس از commit می‌فرستد؛ در این دو
  نقطه ارسال بیرونی به‌صورت آگاهانه محدود شده است).
- **Bypass هشدار مدیر گروه:** ارجاع به کارشناس از `expert_scopes` خوانده می‌شود؛
  در نبود scope، معاونت آموزش (همان fallback TS).
