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
| ۱۲ | کارت دانشجویی (صدور/تمدید/ابطال/چاپ QR) + مسیر امن عکس | `admin/student_cards`, `/photo/:userId` | AdminStudentCardsPage، StudentCardPrintPage | برش ۱۱ |
| ۱۲ | پذیرش سنجش (Staging/ورود دسته‌ای/فرمول/ثبت دستی/تست ایرانداک) + کارت سکونت خوابگاه | `admin/admissions`, `irandoc`, `admin/dorm` | AdminAdmissionsPage، AdminDormPage | برش ۱۲ |
| ۱۲ | تأیید انتخاب واحد + صدور تأییدیهٔ انتخاب واحد | `admin/enrollment_approvals`, `student.IssueEnrollConfirmFor` | AdminEnrollmentApprovalsPage، AdminEnrollmentConfirmationPage | برش ۱۳ |
| ۱۲ | ادغام دروس + خوشه‌های هم‌ارز | `admin/course_merge`, `admin/equivalence_clusters` | AdminCourseMergePage، AdminEquivalenceClustersPage | برش ۱۴ |
| ۱۲ | ثبت‌نام دستی کارشناس (کاتالوگ/تک/دسته‌جمعی/فعال‌سازی ترم/تاریخچه) | `admin/manual_enroll` | AdminManualEnrollPage | برش ۱۵ |
| ۱۲ | انتقال دانشجو بین گروه‌های یک درس | `admin/group_transfer` | AdminGroupTransferPage | برش ۱۶ |
| ۱۲ | موتور شهریه (قواعد، درون‌ریزی قواعد قدیمی، حالت معادل‌سازی) + تعرفهٔ سالانه (گروه‌بندی کد قیمت، ذخیره، کپی سال) | `admin/tuition_ui` | AdminTuitionRulesPage، AdminTuitionTariffPage | برش ۱۷ |
| ۱۲ | برنامه‌ریزی دفاع: هیئت/گروه‌ها، تأیید پروپوزال و استاد راهنما، زمان‌بندی با انتخاب خودکار استخر/اتاق، ثبت نتیجه، مدیریت استخر داوران | `admin/defense` | AdminDefenseSchedulingPage | برش ۱۸ |
| ۱۲ | دوره‌های آزاد: تعریف دوره، شرکت‌کننده، تأیید واریز، حضور/نمره، صدور/ابطال گواهینامه با اثر انگشت و استعلام عمومی، کد تخفیف، همگام‌سازی شمارش | `admin/short_courses` | AdminShortCoursesPage | برش ۱۹ |
| ۱۲ | پایش طرح درس ارائه‌ها + الزام/اطلاع‌رسانی؛ بررسی آیین‌نامه‌ای کدهای سما (اسکن/اصلاح دسته‌ای با لاگ، فارغ‌التحصیل بدون نمره)؛ تأیید دومرحله‌ای step-up با کوکی مشترک Next | `admin/lesson_plans`, `admin/regulation_check`, `/step-up` | AdminLessonPlansPage، AdminRegulationCheckPage | برش ۲۰ |
| ۱۲ | کدهای وضعیت نمره: بانک دروس (ایجاد/ویرایش کامل فیلدهای سما، صفحه‌بندی/جستجو)، کد قبولی/مردودی چارت، آستانه‌های نمره کیفی و حالت نمایش کارنامه، دروس ارائه‌شده با فیلتر | `admin/grade_codes`, `admin/course_bank`, `/admin/curriculum/*`, `/admin/grade-thresholds` | AdminGradeCodesPage | برش ۲۱ |
| ۱۲ | هوش تجاری ارزشیابی: داشبورد مدیریتی (استاد/روند/علامت‌گذاری)، امکانات کلاس‌ها، وضعیت کش، ابر کلمات، پنل استاد، بازسازی داشبورد/کامل و پاک‌سازی کش | `bi` (extras) | AdminBiPage | برش ۲۲ |

وضعیت فعلی: **۲۶ بستهٔ تست Go سبز** (شامل مالی/شهریه/تعرفه/گزارش/BI/فارغ‌التحصیلی/آیین‌نامه/دروس
و ۱۷ تست پکیج حقوق)، **۲۸ تست Vitest سبز**، بیلد Go و TS/Vite سبز.

## سطوح API

- مسیرهای Go: **۳۷۸** در ۳۱ فایل `internal/httpapi/*.go` (شامل auth، scope،
  student، enroll، professor، groupmanager، admin، payroll، workflow، public، cron، reports، bi).
- نقاط مسئله‌دار که بایت‌به‌بایت سازگار پورت شده‌اند: زنجیرهٔ هش `audit_logs`،
  اسکریپت‌های Lua.waiting-room، تراز کانونی دفتر مالی (`ledger-balance`)،
  فرمت توکن `T1.<b64>.<sig>` + چرخش کلید، canonical JSON مدرک،
  اثر انگشت گواهینامهٔ دورهٔ آزاد.

## چه چیزی هنوز در Next.js است (پروکسی می‌شود)

تا وقتی این فهرست خالی نشده، Next.js باید زنده بماند:

- **حقوق:** شبیه‌ساز سناریو (`?tab=simulator` — دادهٔ نمایشی).
- **ادمین:** `reports` (مرکز گزارش‌های آموزشی)، `saham`، `samin`،
  `curriculum`، `templates`، `codes`، `migration`،
  `sanjesh-import`، `c/[group]`. (فارغ‌التحصیلی، پذیرش، کارت دانشجویی، خوابگاه،
  تأیید/تأییدیهٔ انتخاب واحد، ثبت دستی، انتقال گروه، ادغام درس، خوشه‌های هم‌ارز،
  موتور شهریه/تعرفه، برنامه‌ریزی دفاع، دوره‌های آزاد، پایش طرح درس،
  بررسی آیین‌نامه، کدهای وضعیت نمره و BI منتقل شدند.)
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

- `go build ./...` و `go test ./...` (۲۶ پکیج) سبز؛ `go vet` پکیج‌های جدید سبز.
- `tsc -b` و `vite build` سبز؛ `vitest` (۲۸ تست) سبز.
- QA مرورگر برای: کارتابل مالی/حقوق/گردش‌کار/انضباطی/شورا/بایگانی،
  تعاریف مالی، POS، مرکز گزارش‌های مالی (اجرای گزارش شهریه/کارتابل/BI)،
  صورت‌حساب رسمی دانشجو (کارت‌ها، ریز دروس، نمودار)، هشدارهای زمان‌بندی‌شده
  (ثبت→ارسال فوری→کرون→ارسال‌شده) و میز فارغ‌التحصیلی (خط لوله، پرونده،
  دپارتمان‌ها، دانش‌آموختگان؛ صدور/استعلام آزمایشی سند)، پذیرش (Stage/نگاشت/
  نمایش داوطلبان)، خوابگاه و کارت دانشجویی (صدور/چاپ/ابطال)، موتور شهریه
  (قواعد/درون‌ریزی/معدل‌سازی) و تعرفهٔ سالانه (ذخیره/کپی)، برنامه‌ریزی دفاع
  (هیئت/استخر/زمان‌بندی/نتیجه) و دوره‌های آزاد (دوره→شرکت‌کننده→واریز→نمره→
  صدور/ابطال گواهینامه→استعلام عمومی)، پایش طرح درس، بررسی آیین‌نامه
  (اسکن→انتخاب→step-up→اصلاح→اسکن مجدد)، و APIهای کدهای وضعیت نمره
  (بانک دروس ایجاد/ویرایش، کد چارت، آستانه‌های کیفی، دروس ارائه‌شده)
  و BI (داشبورد/امکانات/کش/ابر واژه/پنل استاد/بازسازی) با دادهٔ واقعی DB
  و صفحات عمومی استعلام
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
- **بانک دروس — ستون مقطع:** Drizzle ستون `courses.degreeLevelId` را دارد ولی بعضی
  نصب‌های ساخته‌شده از مهاجرت‌ها آن را ندارند؛ خواندن با `to_jsonb` انجام می‌شود و
  نوشتنِ مقدار غیرخالی فقط در صورت وجود ستون با پیام روشن رد می‌شود (نه خطای ۵۰۰).
- **بانک دروس — `affectsGpa` در ایجاد:** TS به‌خاطر `? 1 : 1` همیشه ۱ می‌نوشت؛
  در Go مقدار ارسالی (۰/۱) محترم شمرده می‌شود.
- **حالت نمایش کارنامه:** API قدیمی فقط `NUMERIC|LETTER|GPA` را می‌پذیرفت ولی UI
  `QUALITATIVE|BOTH` می‌فرستاد؛ Go هر دو خانوادهٔ مقدار را می‌پذیرد.
- **کدهای وضعیت چارت:** ویرایش فقط برای نسخه‌های دانشگاه جاری/سراسری مجاز است.
