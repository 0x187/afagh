# تاریخچهٔ کامل کامیت‌های مخزن آفاق

این سند **۱٬۰۰۱ کامیت نخست** مخزن را از نخستین کامیت (2026-08-29) تا کامیت `2aebfce` (2026-10-31) نگه می‌دارد. ۶ کامیت پایانی (پس از `2aebfce`) نیز در بخش «آخرین کامیت‌ها» در انتهای سند، همراه با ترجمهٔ انگلیسی، اضافه شده‌اند. موضوع هر کامیت عیناً از گیت گرفته شده است و ترتیب، قدیمی‌ترین به جدیدترین است. برای دیدن فایل‌های تغییرکردهٔ هر کامیت: `git show <hash> --stat`.

> پیام اصلی کامیت‌ها در گیت دست‌نخورده است (تاریخچه بازنویسی نشد)؛ ترجمهٔ انگلیسی ۶ کامیت پایانی در انتهای همین سند آمده است.

تاریخ مخزن دو دوره دارد:

1. **ساخت سامانهٔ مرجع Next.js — ۹۱۵ کامیت** (2026-08-29 تا 2026-10-25): خودِ سامانهٔ فعلی که مبنای پورت خط‌به‌خط بود.
2. **بازنویسی Go + React — ۸۶ کامیت** (2026-10-25 تا 2026-10-31): مهاجرت strangler به بک‌ند Go و SPA React.

جزئیات فازی دورهٔ دوم، جدول ماژول‌ها، آمار خطوط و راهنمای سوییچ در [`docs/REWRITE-STATUS.md`](./REWRITE-STATUS.md) آمده است؛ این سند فقط تاریخچهٔ کامل را فهرست می‌کند.

## نمای کلی

| دوره | بازه | کامیت‌ها | feat | fix | سایر |
|---|---|---|---|---|---|
| ساخت Next.js | 2026-08-29 → 2026-10-25 | **۹۱۵** | ۳۶۶ | ۳۹۶ | ۱۵۳ |
| بازنویسی Go + React | 2026-10-25 → 2026-10-31 | **۸۶** | ۷۴ | ۰ | ۱۲ |
| **جمع** | 2026-08-29 → 2026-10-31 | **۱٬۰۰۱** | ۴۴۰ | ۳۹۶ | ۱۶۵ |

| ماه | دوره | کامیت‌ها | feat | fix | سایر |
|---|---|---|---|---|---|
| 2026-08 | ساخت Next.js | ۵۸ | ۴۷ | ۶ | ۵ |
| 2026-09 | ساخت Next.js | ۳۷۴ | ۱۴۲ | ۱۶۲ | ۷۰ |
| 2026-10 | ساخت Next.js | ۴۸۳ | ۱۷۷ | ۲۲۸ | ۷۸ |
| 2026-10 | بازنویسی | ۸۶ | ۷۴ | ۰ | ۱۲ |

> «سایر» شامل docs، test، chore، refactor، security، perf، merge و پیام‌های بدون پیشوند است.

## دورهٔ ۱ — ساخت سامانهٔ Next.js (۹۱۵ کامیت)

این دوره خودِ سامانهٔ مرجع است؛ از فاز صفر و ETL مهاجرت داده تا بلوغ کامل ماژول‌های آموزشی، مالی، امتحانات، امنیت و موبایل. همهٔ رفتارهای نهایی این دوره در بازنویسی Go + React پوشش داده شده و ممیزی ۱۴۵ مسیرهٔ پارتی در `REWRITE-STATUS.md` ثبت شده است.

_پایه‌گذاری: فاز صفر، ETL مهاجرت داده، انتخاب واحد، پنل مدیر گروه._

### 2026-08 — ۵۸ کامیت

#### 2026-08-29 — ۷ کامیت

- `766ddd9` — 🎓 سامانه جامع آفاق — فاز صفر (۱۲ ماژول SQLite) + کالبد Next.js/PostgreSQL/Redis/MinIO
- `f938c58` — ci: تایپ‌چک و بیلد خودکار در هر push (GitHub Actions)
- `93fb637` — feat(db): support native node:sqlite for Node 22+ without Visual Studio build tools
- `e0a2cb2` — feat: سامانهٔ مهاجرت داده از سیستم قدیمی (ETL) — آموزشی + مالی
- `9b57635` — feat(next): support native sqlite fallback for migration script
- `b300e90` — feat: پنجرهٔ زمانی انتخاب واحد + هدف‌گیری ارائه‌ها (مقطع/رشته/ورودی)
- `233b707` — feat: پنل مدیر گروه — تعریف درس، ظرفیت و برنامهٔ کلاس‌ها

#### 2026-08-31 — ۵۱ کامیت

- `e1aa5b6` — fix(next): use npx for drizzle-kit in package.json scripts
- `77bbefc` — feat(auth): support login with both nationalCode and studentCode
- `f91c5f6` — feat(db): add cross-platform hardening script and graceful fallback for RLS pool
- `f3dbc41` — feat(student): add requests tracking section to student home dashboard
- `c4dbc95` — feat(student): separate transcript/grades and workflow requests into dedicated tabs with active navigation
- `2decb96` — feat(admin): add direct approve and reject actions in workflow inbox with live course registration and notification
- `1a98fbc` — feat(student): implement full official academic transcript with semester breakdown, cumulative GPA, and print PDF support
- `c744421` — feat(student): redesign transcript as authentic official Iranian university academic transcript paper format
- `fed91c2` — feat: fix descriptive grading &amp; GPA in transcript, add regulation citation, curriculum chart catalog, smart auto-enroll prefill, and admissions e-KYC desk
- `8ab67e9` — fix(archive): support robust local file fallback and official SVG preview without 500 error
- `0fd4c23` — feat(admin): separate archive and add full comprehensive student/staff credentials &amp; academic dossier management
- `8e4365d` — feat(admin): complete student &amp; professor registration forms with all tabs, complementary data, alumni clearance, and quick action tiles
- `ae5fb89` — feat(curriculum): add full degree catalog, majors management, course entry, type rules, and transfer matching SIS screenshots
- `71a0fac` — feat(curriculum): add semester term planning, graduation audit matrix, and auto-enrollment synchronization
- `43e675a` — fix(enroll): add clear all cart button, fix auto-fill term chart logic to 20-unit ceiling, and enable row-level add/remove toggles
- `537e46c` — feat(enroll): add multi-group section selection, real-time class &amp; exam conflict detection, capacity-aware auto-scheduling, and 1-click group switching
- `4de73c0` — fix(enroll): format all numbers, groups, units, and dates using Persian RTL numerals to prevent bidi text merging
- `38105eb` — feat(schedule): add official enrollment confirmation certificate with weekly timetable, show classrooms in enrollment, and add department head course planning dashboard
- `8a81160` — feat(scheduling): add AI-powered multi-scenario automatic timetable generator with 3 optimized models (compact, balanced, prof-preference)
- `1d28d66` — feat(scheduling): add full professor availability matrix editor, empty classrooms &amp; lab inventory manager, and dynamic AI solver engine
- `28f3fc0` — feat(scheduling): add hierarchical Term/Program/Cohort context selectors and dedicated Professor Multi-Group Weekly Timetable Inspector
- `a3eeced` — feat(scheduling): add customizable university bell schedule presets (90m, 120m, 60m) and bi-weekly alternating odd/even week course session scheduling
- `ac7488c` — feat(scheduling): add customizable time slots manager with prepend morning and append evening quick-add actions, in-place editor, and auto-sort
- `c1578a5` — feat(scheduling): add 4th smart optimization model for working/employed students (afternoon/evening clustered &amp; 100% morning free) with program shift preference selector
- `ddc2c27` — feat(scheduling): implement end-to-end operational workflow: Curriculum faculty assignment, professor availability submission portal, max teaching units cap policy, allocated rooms selection, and centralized AI scheduling
- `28ead70` — feat(scheduling): allow Department Chair to directly edit, override and coordinate professor weekly availability matrix with presets and notes
- `c3ce124` — feat(professor): add attendance system, grade weighting rubric (sum=20 validation), co-teaching (theory+lab) shared courses, adjunct contract form with digital signature, weekly teaching schedule, and submission notifications
- `e7b3400` — fix(grades &amp; attendance): enforce strict rubric clamping on score inputs, dynamic session switching with 16-session history, fingerprint verification status, make-up session creation with future date validation, education empty room allocation, and academic term calendar generator
- `0069de8` — fix(professor): resolve undefined professor name, allow direct free classroom selection by professor with fallback to education queue, and remove admin approval buttons from professor view
- `01ed82c` — feat(admin &amp; exams): add dedicated exam planning module with two scheduling modes (auto matrix &amp; manual), conflict engine, hall seating &amp; cards, plus make-up sessions cartable in admin dashboard
- `848124d` — feat(exams): add ability to create dynamic exam slots and configure exam hall capacities with auto-computed starting/ending seat number ranges and sequential numbering
- `e111e2e` — feat(proctor): add dedicated PROCTOR role in RBAC, login routing, and full smart exam attendance portal with live QR-Code / barcode scanner, seat roster verification, cheating violation reporting, and digitally signed minutes
- `1b9f2ae` — feat(evaluation &amp; exam card): implement dual-checkpoint exam card gating (financial clearance + smart professor/facility evaluation) before entrance card release, with quality bottleneck analytics and automatic facility maintenance ticket dispatch
- `103f2dd` — feat(seating &amp; absence): add 3-phase anti-cheating seating allocation engine (prof/course grouping, Fisher-Yates randomization, alternating zig-zag &amp; even/odd strategies) and 48h absence medical certificate SMS dispatch
- `3bd3159` — feat(templates): add comprehensive dynamic notification template engine with unhardcoded text editor, clickable variable chips, tone presets, real-time mobile preview, and live SMS dispatch test
- `5eb489a` — feat(payroll,exams): implement Grade Deadline SLA tracker, Electronic Exam Minutes with proctor remuneration, professor exam attendance, and comprehensive Faculty Teaching Remuneration &amp; Payroll Engine
- `2008faf` — feat(payroll,attendance): implement Biometric Gate &amp; Chain Matching attendance engine, Electronic Teaching Appointment Decrees, and E-Signature enforcement gates
- `7b525bb` — feat(student/enroll): add CourseCart component with Optimistic UI, Row-level loading, conflict resolver, smart alternatives and live timer
- `7fbe18d` — feat(professor/grades): upgrade Professor Grades Dashboard with Mobile Adaptive Cards, Rubric Calculator, Grade Distribution Analytics, Auto-Save and 2FA OTP Finalization
- `024bf0b` — feat(short-courses): implement Continuing Education, Bootcamps, Online Checkout, Certificate Engine with QR &amp; SHA256 Verification
- `088e562` — feat(verify): add Zero-Loading Server Component for QR certificate verification (/verify/[code]), masked national ID, invalid state handling and certificate engine
- `982b463` — feat(id-cards,exams): implement Smart Student ID Card QR Verification (/id/[token]), Exam Ticket Gate Verification (/exam-ticket/[token]), Time-Fenced Proctor App, Hybrid Attendance with Promissory Permits, and Multi-Course Sheet Packet Handover to Vault
- `9a11026` — feat(payroll,exams,rbac): implement Multi-Hall Exam Aggregation Barrier, Physical Archive Return Gate (No Sheet No Pay), Daily Social Security Insurance, 10% Tax Withholding, and Selective Advance Remuneration with RBAC middleware
- `98f0649` — feat(payroll,proctor): add Flexible Payment Tranches (Full Term End vs Milestone Installments) and Demo Accounts for Proctor &amp; Vault Manager
- `7e097fd` — feat(lms-rbac): add Dynamic RBAC permissions matrix and Moodle BBB virtual classroom integration
- `49d6c0e` — feat(workflow): implement complete BPM E-Requests engine, dynamic form builder, SLA management, and bottleneck KPI analytics
- `38fe5c8` — feat(admissions-executive): implement Sanjesh Staging &amp; Dynamic Student ID, Irandoc Plagiarism API, Executive Real-time Ops and Staff Self-Dashboard
- `e565d6d` — docs: generate comprehensive Afagh ERP user manual PDF with high-res screenshots and markdown guide
- `abbae4a` — docs: add root and public copy of user manual PDF and in-app interactive manual viewer
- `4741c34` — docs: enrich user manual with professor workflows, exam anti-cheating, and redis student enrollment
- `36241ea` — feat: implement Regulation Control Center, dynamic degree levels, probation/tenure rules, sajjad commission workflow, summer unit overrides, and update comprehensive user manual


_ساخت هستهٔ آموزشی: کارنامه، حضور و نمرات، برنامه‌ریزی، امتحانات، امنیت و تست._

### 2026-09 — ۳۷۴ کامیت

#### 2026-09-01 — ۲۱ کامیت

- `d8ebcd8` — feat: enhance grade appeal workflow with rubric component editing and in-roster appeal indicators
- `ff85d04` — feat: student portal redesign, desktop right sidebar, clean print exam card with SVG QR, Shamsi dates, LMS and Shaparak gateway integration
- `c61a192` — fix: سازگاری با Next.js 15/16 — cookies/headers/params/searchParams همگی async شدند
- `7e0a439` — Merge pull request #1 from jafarfarzi-stack/arena/01a05b9a-afagh
- `4bebbd2` — feat: مهاجرت رسمی به Next.js 16 + React 19
- `530c796` — Merge pull request #2 from jafarfarzi-stack/arena/01a05b9a-afagh
- `f42ba9e` — feat: complete full multi-instructor grading, OTP digital signature workflow, group scheduling, user manual, and portal enhancements
- `c535e37` — merge: bring branch arena/01a04ce1-afagh into arena/01a05c13-afagh
- `8b19a95` — feat(install): Docker-first installer for Windows/Linux (PostgreSQL + Redis + MinIO in containers)
- `030a077` — feat(deploy): app listens on 8080 + full Docker deployment for Debian 13
- `3646f6d` — feat(config): central settings system — nothing hardcoded, editable via web or ENV
- `2a41a5d` — feat(deploy): single root docker-compose.yml + Makefile + optional HTTPS overlay
- `9908316` — fix(docker): build no longer OOMs — skip in-image type check, lighter migrator stage
- `04f3a95` — fix(auth): رفع حلقهٔ بی‌پایان ورود — کوکی نشست با پروتکل تطبیق می‌یابد
- `f0faf75` — feat(migration): میز کار انتقال دادهٔ سرورهای قدیمی — تطبیق کد، شهریه و نمرات با اکسل
- `860f6b8` — feat(migration): ناحیهٔ موقت، نگاشت ستون، مانده اولیه و واگرد کامل عملیات
- `451693b` — feat(graduation): ماژول فارغ‌التحصیلی رویدادمحور، تسویهٔ موازی، صدور مدرک و پورتال دانش‌آموختگان
- `f4a3a3a` — fix(alumni): گارد دسترسی در صفحهٔ پورتال دانش‌آموختگان (رندر موازی با layout)
- `4b7663f` — feat(graduation): گام اجباری «درخواست کد صحت در سجاد» توسط دانشجو پیش از کارشناس صدور
- `a44981e` — feat(notify): اطلاع‌رسانی چندکاناله (پیامک/تلگرام/بله/ایتا) + پیام تبریک و یادآوری تسویه‌حساب در شروع فرآیند فارغ‌التحصیلی
- `b0bc830` — perf(regulations): تراکنش اتمی ارجاع کمیسیون، حذف کوئری‌های متوالی، محاسبهٔ معدل با اعداد صحیح و ایمنی نمرات خالی

#### 2026-09-02 — ۳۴ کامیت

- `ce984d3` — perf(workflow,payroll): موتور گردش کار تراکنشی + گذرگاه رویداد، و موتور حق‌التدریس PostgreSQL بدون N+1
- `98714ce` — feat(bi): موتور هوش تجاری ارزشیابی با کوئری تجمیعی، تحلیل متن در PostgreSQL و کش
- `9bbc1e3` — feat(professor): کارنامهٔ عملکرد استاد کاملاً زنده (حذف دادهٔ نمونه)
- `57b6da2` — feat(verification): زنده‌سازی درگاه‌های استعلام عمومی (کارت دانشجویی، کارت آزمون، گواهینامه)
- `6e22f7d` — fix(admin): ماژول «انتقال داده» در منوی افقیِ تک‌ردیفه پنهان بود — منو شد wrap + کارت داشبورد
- `74bfab8` — feat(print): چاپ «فقط فرم» برای همهٔ فرم‌ها — همان رفتار کارت ورود به جلسه
- `614c91a` — fix(install): پس از نصب، سرور خودکار روی ۸۰ بالا می‌آید + start.ps1
- `1fe3a5e` — feat(admin): داشبورد کارتیِ نقش‌محور + ماژول «امور مالی دانشجویان»
- `21d08fb` — feat(responsive): ریسپانسیو موبایل برای همهٔ کارتابل‌ها
- `90d4331` — fix(admin-ui): کارت‌ها خوانا، ناوبری بالای داشبورد حذف، شبکهٔ سه‌ستونه + update.ps1
- `0d65d94` — chore: میانبر update.ps1 داخل afagh-next تا از هر دو پوشه اجرا شود
- `51573f7` — fix(db): کارتابل دانشجو دیگر با خطای سرور نمی‌افتد — fallback جامع RLS
- `21993ac` — chore: update.cmd برای دور زدن Execution Policy ویندوز (ریشه و afagh-next)
- `05195b4` — chore: BOM به update.ps1/start.ps1 — رفع به‌هم‌ریختگی فارسی در PowerShell 5.1
- `2d6fd76` — chore: update.ps1 پس از compose up تا بالا آمدن 5432 صبر و در غیر این صورت هشدار روشن‌بودن Docker می‌دهد
- `e70fc97` — fix(enroll): خالی‌کردن سبد، اتاق انتظار، تاریخ شمسی و برنامه هفتگی موقت
- `9522c51` — feat(equivalence): پیوست درخواست‌ها، معادل‌سازی هوشمند و ترم‌های ۲۰واحدی
- `5c2fe3f` — feat(qr): موتور QR واقعی + حذف معادل‌سازی از مشروطیت
- `dcdb337` — fix(regulations): کسر سنوات بابت معادل‌سازی + شفاف‌سازی معدل کل
- `4acb829` — feat(migration): غنی‌سازی پروندهٔ دانشجو — اطلاعات شناسنامه + مقطع/رشته
- `629be22` — feat(equivalence): فرم رسمی ممهور + موتور شهریهٔ قابل تنظیم
- `c196f0c` — fix(equivalence-form): idempotency بر اساس امضای سند نه نوع سند
- `a6ae99b` — fix(tuition): شهریهٔ ثابت فقط از قواعد سطح ترم + تست واقعی موتور قواعد
- `49f2e87` — fix(tuition): ترم‌های معادل‌سازی قدیمی هم نرخ معادل‌سازی بگیرند
- `d71ff32` — feat(tuition): پل درون‌ریزی قواعد مالی قدیمی به موتور جدید
- `deaa889` — fix(tuition): پل درون‌ریزی effectiveFromYear را پر نکند
- `42d940b` — feat(tuition): سیاست شهریهٔ ثابت معادل‌سازی قابل انتخاب توسط مدیر
- `c85a6af` — fix(tuition): صفرشدن شهریه باید شارژ قبلی را هم صفر کند
- `89aefb0` — chore: اجرای تست‌ها در update.ps1 + مستندسازی EQUIV_FIXED_TUITION_MODE
- `b17440b` — fix(update): اجرای تست‌ها نباید استقرار را روی Node قدیمی بشکند
- `c55bdce` — fix(update): شکست npm install باید صریح گزارش شود نه با خطای گمراه‌کنندهٔ بیلد
- `39227a9` — feat(finance): کارتابل کارشناس مالی — کارنامهٔ مالی، تخفیف، بنیاد، چک، وام و فرمول تخصیص
- `c9dfda7` — fix(finance): یکسان‌سازی محاسبهٔ تخفیف تا کارتابل و کارنامه یک عدد بدهند
- `d563aa2` — feat(student): صفحهٔ امور مالی دانشجو — حلقهٔ پیام سررسید چک بسته شد

#### 2026-09-03 — ۱۱ کامیت

- `e6cdaf9` — feat(finance): زمان‌بند cron + کاتالوگ وام
- `95c3413` — fix(deploy): اجرای محلی نباید output:standalone داشته باشد + گارد سلامت بیلد
- `4f67f18` — feat(db): base reference data + legacy-migration fields + security columns
- `959a5fc` — fix(auth): forced password change + self-healing student dossier
- `ac746f6` — fix(admissions): secure default password, atomic student-id sequence, transactional import
- `eee2aa8` — fix(graduation): wrap degree issuance in a single transaction
- `eb227db` — fix(student): graduation pages use self-healing student lookup
- `3873fa9` — feat(import): legacy TSV importer for majors &amp; professors
- `171ff0e` — refactor(erp): align SQLite schema with legacy-migration fields
- `8ef7506` — docs: architecture review of phase-zero ERP module
- `967ff6e` — security(P0): ۶ اصلاح امنیتی — RLS fail-closed، CSRF سراسری، whitelist آپلود/سرو امن، secrets+شبکه internal، DEMO_MODE، migrator برای پچ‌ها

#### 2026-09-04 — ۴۸ کامیت

- `0b59c14` — security(M): رفع ریسک‌های باز — M-1 ریت‌لیمیت سراسری+قفل ورود، M-2 cron secrets خودکار+volume مشترک، M-3 کلید مستقل BI، M-4 پاکسازی/چرخش نشست‌ها+ایندکس، M-6 تست‌ها با tsx روی Node 20+CI
- `8946b80` — refactor(M-3): ثابت ۲۰ واحد معادل‌سازی به منبع واحد (regulations-engine ← enroll-engine) + مستندسازی cron secrets خودکار در .env.prod.example
- `f3f971d` — docs: به‌روزرسانی گزارش رفع ریسک‌های باز (M-3 کامل شد)
- `d8d5ec6` — security(review-P0/P1): RLS ماتریس کامل ۳۸ جدول+گرنت ستونی، آزمون RLS در CI، گیت دومرحله‌ای دمو، ابطال نشست‌ها، قفل/پشتیبان مهاجرت، params/async برای Next 16 + ارتقای تأییدشده به next@16.3.4/react@19.2.8
- `057262a` — security(review-2): تراکنش+قفل ردیف clearCheque، approve/reject تراکنشی با انتقال شرطی، گارد origin سراسری Server Actions (۲۳ اکشن مالی + ورود/تغییر رمز + درخواست‌ها)، مجوز سطح-شیء مالی، قفل دمو در build تولید (NEXT_PUBLIC_AFAGH_DEMO_LOCK)، حذف کامل AFAGH_RLS_FALLBACK در prod، ممیزی ۱۴۳ اکشن + اثبات پوشش RLS در CI + گزارش بازبینی دوم
- `742925d` — fix(security): fail-closed requireStudentScope + finance: server-side status, chained audit, safeRials, delete policy (بازبینی ۳)
- `7def79d` — docs: گزارش بازبینی سوم — fail-closed scope، وضعیت مالی سمت سرور، audit زنجیره‌ای، safeRials، سیاست حذف، تأیید اسکیما، آزمون همزمانی
- `81e0bda` — fix(security): fail-closed CSRF origin + IDOR scope در ۹ اکشن مالی id-based + رفع شکست CI (بازبینی ۴)
- `025f75b` — chore(next16): package-lock بازسازی برای next@16.3.4 + drizzle-orm@0.45.2 و خروجی build
- `11cb18d` — fix(ci): پوشش RLS ۲۱ جدول هویتی/مالی باقی‌مانده + دروازهٔ audit مقاوم به ۵۰۳ رجیستری (بازبینی ۴)
- `b5edc36` — test(rls): رفع باگ‌های نهفتهٔ فیکسچر — categoryId سند (NOT NULL) و FK نوع تخفیف در concurrency-test
- `b02bd93` — test(rls): اجراپذیری واقعی سناریوها — set_config با SELECT، تراکنش سه‌پرس‌وجویی (پارامتر ≠ چند دستور)، ROLLBACK پس از خطای موردانتظار
- `caca5f1` — test(rls): deny-all های ACL-محور (REVOKE) → پذیرش 42501 به‌عنوان اثبات دسترسی صفر
- `cd08819` — test(rls): هر چک deny-all در تراکنش تازه — جلوگیری از 25P02 پس از abort ناشی از 42501
- `e5e1b82` — docs: گزارش بازبینی چهارم — fail-closed CSRF، بستن IDOR مالی id-based (۹ اکشن)، سبز شدن CI واقعی (۳/۳) + یافته‌های کشف‌شده (vuln drizzle، RLS ۲۱ جدول، باگ‌های نهفتهٔ تست‌ها)
- `e0f02f6` — fix(workflow): کد رهگیری با دنبالهٔ DB (بدون حلقهٔ ۵۰تایی) + حذف کش محلی processCache (بازبینی ۵)
- `52deeb5` — docs: متن خالص تغییرات کلیدی دور ۵ برای Code Review بازبین (محتوای متنی بهجای خروجی باینری)
- `dfec319` — feat(persistence &amp; ui): گام‌های ۲-۴ سند طراحی — ZSET Waiting Room، تکمیل امنیت گام ۳، الگوهای React 19 گام ۴
- `aeec5b2` — docs: جمعبندی امروز + ادامهٔ طراحی سند (ZSET/امنیت/فرانت پیاده شد؛ CI/CD و محدودیتهای بعدی)
- `c07f90e` — refactor(grades,payroll): جراحی معماری فرانت حجیم طبق نقشه (گام ۱-۳)
- `2a9e50e` — docs: گزارش دور ۸ — رفاکتور فرانت نمرات/حقوق (گام ۱-۳ طرح)
- `a9d463b` — test(load): تست سنگین ۳۰۰۰ دانشجو/۱۵۰۰ استاد روی PG زنده + بهینه‌سازی ۴۹× تسویه نهایی
- `c001e50` — feat(exam): موتور چرخهٔ امتحانات + تست سنگین ۱۰۰۰ دانشجوی هم‌زمان (۱۰ سالن، ۲۰ مراقب، ۳۰ درس، ۱۵ استاد)
- `c8d9ed5` — fix(exam-eng,security): رفع High SQL Injection + لایهٔ Server Actions با احراز هویت/مالکیت
- `da92a0e` — fix(exam): بستن HIGH sql.raw با تست واحد اثبات‌کننده + بازنویسی همزمانی موتور
- `298d213` — fix(deps): خداحافظ push --force — مهاجرت‌های نسخه‌دار + فعال‌سازی Branch Protection
- `6075901` — fix(ci): مسیر پشتیبان در runner — AFAGH_BACKUP_DIR قابل نوشتن (تولید همچنان /backups)
- `caa664f` — fix(ci): حذف کومنت از env (سازگاری پارسر GitHub)
- `cb3c80a` — fix(ci): AFAGH_BACKUP_DIR از طریق RUNNER_TEMP (بدون expression در env — پارسر GitHub)
- `0a1f46c` — chore(ci): مهاجرت‌های نسخه‌دار + Branch Protection (#5)
- `0baf6cb` — feat(scheduling): موتور برنامه‌ریزی درسی — تأمین/تخصیص/بازبینی/نشر + تست
- `1fca95e` — chore: re-trigger CI
- `7be813a` — Merge remote-tracking branch 'origin/main' into arena/01a05c13-afagh-next16
- `316cbeb` — docs(design): سند طراحی نهایی Curriculum/Scheduling V1 + ERD منطقی (استخراج ۱۳۱ جدول موجود، Gap Matrix، State Machine، Validator و نقشهٔ راه ۷ فازی)
- `3bd1020` — feat(curriculum): فاز ۱ — Domain Model برنامهٔ درسی — State Machine (DRAFT→…→ARCHIVED)، کدگذاری نسخه (1404-R1)، نرمال‌سازی درخت قاعده، Resolution نسخهٔ قابل اعمال + ۵۱ تست
- `84034c0` — docs(review): بررسی مهندسی سراسری همهٔ ماژول‌ها — Scorecard ۳۰ ماژول، ۹ یافتهٔ ساختاری (۷ کلاینت Mock، RLS adoption ناقص، تبارشناسی schema)، ماتریس P0/P1/P2 و نقشهٔ ۱۰ گامی ادامه
- `c5acf71` — feat(curriculum): فاز ۲ — مهاجرت نسخه‌دار ۰۰۰۲ (D1: syllabuses → curriculum_versions) — rename اسکیما + چرخهٔ حیات + گرایش + تأیید append-only + قیدهای جزئی؛ بازپرشدن امن دادهٔ موجود؛ ۱۷ رفرنس کد؛ RLS روی approvals؛ تأیید ۲۳ آزمون روی PostgreSQL واقعی
- `93e6ea5` — feat(curriculum): فاز ۳ — ۲۱ Server Action گارددار (D3) + هستهٔ Validator واقعی — چرخهٔ حیات کامل (submit/approve/reject/publish/archive/revision) با appendAudit و assertTransition، کپی عمیق نسخه (clone/R1)، قواعد درخت پیش‌نیاز/هم‌نیاز (D2)، گیت تأیید با ۶ چک واقعی + ۱۹ تست
- `d1fc529` — feat(curriculum): فاز ۴ — تکمیل Validation Engine — ۵ چک جدید (SEMESTER_LOAD با سقف سه‌لایهٔ نسخه←مقطع←۲۰، COURSE_TYPES_COMPLETE با مینیمم نقش‌ها و الزام پایان‌نامهٔ ارشد/دکتری، TRACK_INTEGRITY، EQUIVALENCY_DISJOINT، SEMESTER_UNASSIGNED) + اتصال کامل به Actions و ۳۶ تست
- `67e87ab` — feat(curriculum): فاز ۵ — اتصال واقعی موتورها به نسخهٔ حل‌شده — curriculum-apply.ts (Resolution DB-backed + پیام صریح دلیل)، سیم‌کشی enroll/graduation/regulations (حذف نشت قواعد نسخهٔ DRAFT به انتخاب واحد)، فیلتر وضعیت PUBLISHED/ARCHIVED در پیش‌بینی تقاضا، selectEffectiveRules با رفع باگ null===null + ۱۰ تست
- `03a2a5c` — feat(scheduling): فاز ۶ — اتصال واقعی Scheduling — ۴ اکشن گارددار (داشبورد/چک قیود/چرخهٔ فاز/تولید جلسات)، تولیدکنندهٔ class_sessions واقعی (idempotent، هفتگی/زوج/فرد، تاریخ شمسی)، قیود سخت detectScheduleConflicts (سالن/استاد دوم/ظرفیت) + sessionDatesFor، سیم‌کشی page.tsx به Client (جایگزینی Mock‌های ترم/سالن/استاد) + ۲۴ تست
- `2f83f04` — feat(curriculum): فاز ۷الف — Thin Client واقعی — page.tsx با CurriculumInitialData از سرور، حذف Mock ها (کاتالوگ/نوع‌درس/درس/ترم‌بندی)، بارگیری lazy جزئیات نسخه، اتصال همهٔ عملیات به Server Actions (ترم‌بندی/نقش/سقف/انتقال بانک با roleType/Deep Clone ورودی/Transfer/Revision به‌جای حذف/چرخهٔ DRAFT→PUBLISHED)، تب اعتبارسنجی با ۱۱ چک موتور (حذف نشانگرهای ساختگی ۱۰۰٪)
- `05af99c` — feat(scheduling): فاز ۶ (ادغام واقعی دو شاخهٔ موازی) — تولید جلسات واقعی class_sessions از schedules+startDate (تراکنشی + pg_advisory_xact_lock + گیت قیود سخت + dryRun + audit + idempotent-skip + هفتگی/زوج/فرد + شمسی)؛ scheduling-core با هر دو ست قیود (detectScheduleConflicts/sessionDatesFor از ریموت + detectHardConflicts/computeSessionDates از ما؛ ۱۱۰ تست)؛ ۵ اکشن گارددار (کارتابل + تولید + گذار فاز + داشبورد + چک قیود)؛ صفحه/کلاینت بدون هیچ Mock (نیمسال/رشته/ورودی/سالن/استاد/تقاضا/برنامهٔ مصوب از DB؛ جبرانی read-only؛ KPI از DB؛ سناریو فقط پیش‌نمایش)
- `0719f5f` — feat(curriculum): فاز ۷ (ادغام واقعی ۷الف ریموت + Thin Client ما) — CurriculumManagerClient بدون هیچ Mock با initial غنی‌سازی‌شده (dept/faculty/minUnits/tracks)؛ جزئیات lazy از server action + رندر واقعی CheckResult[]؛ چرخهٔ حیات کامل (submit/approve/reject/publish/archive/revision)؛ ویرایش DRAFT (افزودن تکی/گروهی بانک با roleType، حذف/نقش/ترم/الزامی/شرط فارغ‌التحصیلی/سقف واحد)؛ کپی عمیق/انتقال کاتالوگ با cloneFromId؛ اکشن‌های two-way-merged (۲۱ اکشن + Act&lt;T&gt;)؛ V1: فاز ۶+۷ به‌روز
- `351f90f` — feat(exams): گام ۵ — اتصال واقعی صفحهٔ اداری امتحانات — admin/exams/actions.ts (کارتابل واقعی: exam_sessions + schedules EXAM + exam_halls + invigilators + بسته‌های course_exam_sessions + تداخل همزمانی؛ اکشن‌های صدور حضور/صورتجلسه/تحویل از exam-engine) + Thin Client امتحانات (بدون Mock)؛ گیت ۱۷۸/۱۷۸
- `3ef9cbf` — feat(exams): فاز ۹ — موتور برنامه‌ریزی امتحانات (ادغام واقعی «طراحی سامانهٔ جامع آموزشی») — exam-scheduler.ts خالص (زون‌بندی ۳ قانون: ارشد=۳ هفته/عمومی=هفتهٔ اول/تخصصی=هفتهٔ ۲–۳؛ HARD=هم‌روز+هم‌ساعت / SOFT=هم‌روز شیفت متفاوت؛ گلوگاه ظرفیت + تجزیهٔ شیفت‌بندی؛ امتیازدهی عصرِ ارشد/شاغل؛ تخصیص قطعی صندلی+بلوک) + exam-planning.ts (کارتابل DB + قفل توافقی + audit + رادار ظرفیت + رزرو شیفت + امتحان تجمیعی خوشهٔ هم‌ارز + ۴ پیشنهاد طلایی) + مهاجرت ۰۰۰۳ (exam_calendar_configs، majors.isWorkingClassMajority) + تب «برنامه‌ریزی امتحانات» در کلاینت اداری + ۳۸ تست
- `2763acb` — feat(exams): فاز ۱۰ — روز امتحان و دانشجو — گارد تداخل امتحان در انتخاب واحد (پیش‌بینی HARD/SOFT پیش از ثبت + مودال تأیید عواقب + ذخیرهٔ hasAcceptedSameDayExam به‌عنوان امضای دیجیتال در ردیف ثبت‌نام، سرور و کلاینت) + اتصال ورود مراقبین/زنجیرهٔ تحویل از exam-actions + تخصیص صندلی (سالن/شماره/بلوک) که کارت ورود دانشجو (QR + صندلی + سالن) را پر می‌کند؛ REVIEW: گام ۵ب/۵ج
- `6a51848` — fix(exams): تبدیل ISO↔شمسی فرم‌های زون‌بندی/رزرو — فیلدهای date میلادی‌اند اما موتور/ذخیره‌سازی شمسی است؛ سپس push

#### 2026-09-05 — ۲۱ کامیت

- `bcc40db` — feat(realism): فاز ۱۱ — ممیزی واقعیسازی همهٔ ماژولها و حذف کد/دادهٔ Mock + ۲ کاربر دموی مدیر گروه
- `5e1033a` — feat(scheduling): فاز ۱۲ گام ۱و۲ — اتصال واقعی موتور زمانبندی + حذف Solver کلاینت
- `c50b582` — docs(scheduling): ثبت شناسهٔ کامیت فاز ۱۲ در سند ممیزی
- `beb19e7` — fix(deploy): شکست migrator با exit 1 — پوشش RLS جدولهای فاز ۱۱ در گیت سختسازی
- `a8128c1` — docs: بازیابی تنها فایل منحصربه‌فرد شاخهٔ arena/01a05c13-afagh (بازیابی-نهایی-گیت.md)
- `1c24fc7` — fix(deploy): رفع شکست بیلد داکر با exit code 137 (OOM) روی سرور کم‌حافظه
- `6840802` — Merge pull request #8 from jafarfarzi-stack/arena/01a07092-afagh
- `7a6367b` — docs: گزارش مقایسهٔ شاخهٔ کلون‌شده arena/01a05c13-afagh با کد فعلی
- `cffea8b` — feat: ادغام به‌روزترین موارد از سایر شاخه‌ها
- `97b8b98` — fix(ui): رفع چهار کرش ۵۰۰ در حالت خالی (دیتابیس تازه‌نصب)
- `f1d8223` — feat(admin/permissions): ماتریس واقعی RBAC با ذخیره‌سازی پایدار و ممیزی
- `06302c2` — chore(rbac): اسکریپت مستقل seed مجوزها + راهنمای به‌روزرسانی سرور
- `73ea2d4` — chore(deploy): مسیر به‌روزرسانی بدون ریسک بیلد برای ماتریس دسترسی‌ها
- `8d5a907` — feat(migration): انتقال کاملِ درس از سیستم قدیمی (مقطع، گروه، واحد نظری/عملی)
- `41b583e` — feat(migration): انتقال دانشکده/گروه/رشته+گرایش/استاد + جایگزینی کد قدیمی با کد جدید
- `c74642e` — feat(migration): عکس افراد + پرسیدن ستون‌ها از کاربر پیش از انتقال
- `1ec4c28` — fix: تطبیق انتقال با سرستون‌های واقعی فایل‌های دانشگاه
- `3fa10b2` — fix: رفع اشکالات باز سایت: ۴۰۴ درگاه مدرک، صفحات خطا، و searchParams در Next 16
- `cc6b208` — fix: رفع خرابی صفحه‌ها: کرش کل سرور، ۵۰۰ قرارداد، و پرت‌شدن به صفحهٔ ورود
- `991e98f` — feat: مدیریت گروه‌های آموزشی: تعریف گروه، انتصاب مدیر، و ادغام کارتابل استاد و مدیر گروه
- `17bd6bc` — feat: کد به‌عنوان سند اصالت در انتقال داده: تطبیق «کد-اول» و رفع خطر هم‌نامی

#### 2026-09-06 — ۱۰ کامیت

- `482dcb9` — feat: مرکز کدها، رفع دکمه‌های گم‌شدهٔ بارگذاری، و ستون کد در قالب‌های اکسل
- `077670f` — docs: راهنمای درست اعمال تغییرات روی سرور
- `5b5c5ee` — fix: رفع کرش migrator روی سرور دارای دادهٔ واقعی (exit 1 در seed-base)
- `ba1efeb` — docs: اصلاح شمارهٔ کامیت رفع باگ migrator
- `c77bde4` — fix: رفع exit 1 در migrator: نصب postgresql-client-16 هماهنگ با سرور + تشخیص ناسازگاری نسخه + بنر هر گام
- `cc7f043` — feat: مرکز کدها: افزودن مقطع تحصیلی، دانشکده و رشتهٔ جدید + حذف محافظت‌شده
- `b84c039` — feat: مرکز کدها: ترم افزودنی شد (کد پس از ثبت غیرقابل تغییر) + حذف محافظت‌شده + لاتین‌سازی ارقام کد
- `68e9765` — feat: ظرفیت اتمیک انتخاب واحد: رزرو شرطی، شمارش واقعی لیست انتظار و جبران صندلی (ERP + Next)
- `d2f8149` — security: سخت‌سازی احراز هویت: حذف توکن کوئری، logout، rate-limit ورود، CORS ثابت و چک شکل توکن در لبه
- `2c4b4c6` — chore: سخت‌سازی استقرار: تولید AFAGH_APP_DB_PASSWORD، fail-fast سکرت‌ها و قرارداد یکسان کامپوز/.env

#### 2026-09-08 — ۲۲ کامیت

- `bbe0d0e` — feat(sama): فارسی‌سازی سما، صفحه‌بندی، گزارش‌ها و هاب ثمین
- `c758a76` — feat(deploy): اسکریپت یک‌دستور انتقال دادهٔ سما به آفاق (import-sama.sh)
- `cfa1007` — fix(deploy): خواندن مقاوم رمز پستگرس در import-sama.sh (fallback به کانتینر afagh_pg)
- `c8ec8d0` — fix(deploy): کشف خودکار شبکه و کانتینر پستگرس در import-sama.sh
- `c5443b6` — fix(import): خودترمیم seed دانشگاه‌ها در فاز pre + mount زنده scripts در import-sama.sh
- `a2ba89e` — feat(deploy): اجرای یکجای رتبه اساتید همراه import-sama (update_profs_rank --dir)
- `be6bbfe` — feat(import): معادل‌سازی همهٔ کدهای مرجع (رتبه استاد، مقطع، نوع درس/دوره، نظام وظیفه، وضعیت نیمسال) در codemap
- `3eea061` — fix(import): تطبیق عنوان درس از tatbigh dars.txt (مرحله courses)
- `52387c4` — feat(ui): ادغام تب‌های پرونده دانشجو و استاد + لیست به‌عنوان تب اول
- `4d8912c` — fix(import): تطبیق وضع نمره، مدرک استاد و همه هدرهای فارسی در codemap
- `76ef214` — fix(import): اعمال واقعی عنوان مقطع‌ها از مقطعها.txt روی degree_level_configs
- `fee221b` — feat(import): غنی‌سازی پرونده اساتید از اساتید2.txt با کلید کد استاد
- `f4bd2f6` — fix(import): اصلاح import-professors2 برای dry-run بدون DB + لاگ بهتر خطا
- `4978a0b` — feat(import): حالت professors2 برای اجرای فقط غنی‌سازی اساتید
- `cfa087c` — fix(import): اتصال دروس به گروه و پاکسازی گروه‌های بدون‌کد
- `37efaa6` — feat(import): فاز groups/links + ساخت مجدد اساتید + حذف گروه‌های بی‌کد
- `9db92d9` — feat(ui): کارنامه رسمی با چاپ + منوی کشویی ادمین + فارسی وضع نمره
- `5a85493` — feat(import): بازنویسی کامل اساتید از صفر + حذف دموها
- `864848e` — fix(import): پشتیبانی از Ostadan.txt + اصلاح نگاشت رشته/رشته‌گرایش
- `b69d437` — feat(import): بازسازی اساتید فقط از ostadan.txt
- `b203c1c` — feat(transcript): عین عنوان فایل وضع نمره جلوی وضعیت
- `049b9c2` — fix(import): رفع خطای 0x00 در codemap + تفکیک فایل مقطعها

#### 2026-09-09 — ۲۹ کامیت

- `ff62016` — fix(ui): اتصال فرم اساتید به دیتابیس (گروه/دانشکده/رشته واقعی)
- `eb2e4b8` — feat(transcript): فرمت سما + ارم دانشگاه + نگاشت آیین‌نامه‌ها
- `2f8140f` — feat(hardening): نویسنده سریال ممیزی + نگهبان اتصال + راستی‌آزمایی زنجیره
- `c481ec8` — feat(regulations): آیین‌نامه‌های اجرایی ۱۴۰۲/۱۳۹۳/۱۳۹۱ + تغییر آیین‌نامه دانشجو
- `cb3b454` — feat(regulations): پریست اجرایی ارشد/دکتری ۱۳۹۴ + انتخاب مقطعی
- `6f02572` — feat(regulations): تجمیع به ۶ سند + چاپ WYSIWYG کارنامه
- `f8dd920` — feat(transcript): اکشن پیکربندی آیین‌نامه ملاک کارنامه
- `21a65ac` — feat(ui): سورت و فیلتر ستونی همه لیست‌های افراد
- `39fd00c` — fix(ui): تراز ستون‌ها، دکمه پرونده اول، فلش‌های RTL، ریمانت فرم با تعویض پرونده
- `cfe443f` — feat(search): نرمال‌سازی فارسی/عربی در جست‌وجوی ادمین
- `0dac83f` — feat(curriculum): بازگشت ۵ تب کاتالوگ + تعریف درس از صفر + ویرایشگر پیش‌نیاز/هم‌نیاز/کف‌نمره
- `c2e3545` — fix(curriculum): توقف حلقه بی‌نهایت بارگذاری جزئیات — showToast با useCallback پایدار شد تا افکت detail/bank فقط با تغییر ورودی اجرا شود (رفع چشمک «در حال بارگذاری…» و پرش صفحه)
- `4030bf3` — fix(security): پوشش RLS برای student_term_states — migrator روی جدول دادهٔ شخصی بدون RLS متوقف می‌شد (hardening.mjs coverage check)
- `d757520` — fix(curriculum): افزودن گروهی از بانک بدون ترم — ترم‌بندی مرحلهٔ دوم در تب ترم‌بندی (UX برای ۵۰ درس)
- `1ebd4a5` — feat(curriculum): سلکتور درختی رشته + مودال بانک قدیمی‌سبک + جمع‌بندی نوع درس
- `0384ba0` — feat(curriculum): درگ‌اندراپ ترم‌بندی — کشیدن درس از حوضچه به ترم و جابه‌جایی بین ترم‌ها (بومی، با فallback منوی ترم)
- `09b1fcf` — feat(curriculum): خواندن نوع اولیه از بانک + همگام‌سازی نقش‌ها
- `60c71e4` — feat(curriculum): per-degree chart length (4/8) + summer term 9\n\n- degree_level_configs: termCount + isGraduate (schema, seed, codes UI with edit)\n- lib/term-plan.ts single source of truth; tests/term-plan.test.ts (24 cases)\n- curriculum term grid follows degree (4-term AD/MS/PHD, 8-term BS) + amber summer card\n- assign validation 1..9; THESIS rule uses isGraduate flag
- `f147148` — fix(curriculum): migration 0009 for degree termCount/isGraduate
- `dbf161e` — feat(curriculum): per-version role unit targets (ROLE_UNITS_COVERAGE)
- `bfbb7fe` — fix(regulations): guard effective years + wire cleanup script
- `0700a63` — fix(tables): pin column widths (table-fixed + colgroup) + RTL pager arrows
- `9447f47` — fix(ci): سبزسازی سه گیت — مهاجرت student_term_states + گارد ۸ اکشن + فیکسچر RLS
- `6cf7fac` — refactor(scheduling): شکستن مگاکامپوننت ۲۳۵۸ سطری کارتابل برنامه‌ریزی + هستهٔ خالصِ تست‌شدنی
- `8639a74` — ری‌فکتور (دور ۱۱): شکستن مگاکامپوننت پنل دانشجویان + هستهٔ خالص کارنامه با تست
- `c0ce0bb` — ری‌فکتور (دور ۱۲): شکستن مگاکامپوننت برنامهٔ درسی + رفع باگ مهاجرت createdAt
- `dfd8ef8` — refactor(curriculum): شکستن actions.ts یکپارچه به ۵ فایل اکشن + لایهٔ مشترک
- `93ceebb` — release-hardening: رفع ۴ P0 و ۲ P1 مسیر پروداکشن (secrets، backup، migration، bootstrap)
- `98bf790` — release-hardening: دو نقصی که CI گرفت + همگام‌سازی رمز نقش afagh_app

#### 2026-09-10 — ۱۹ کامیت

- `310b3e3` — fix(docker): include drizzle in build context for migrator
- `cd4ced5` — fix: handle pg_restore --list format mismatch in PG16
- `aa047a5` — fix: quote isActive column in create-admin reset
- `db2357a` — fix: migrator exit-1 on empty backup + unified ETL script
- `dcceab4` — fix: ON CONFLICT + null safety in professor user insert
- `96e9ae5` — fix: transcript layout + course type display + facultyId on conflict + professor null safety
- `2f2511a` — fix: correct TSV column mappings for student2.txt (93 cols) and ostdan.txt (80 cols)
- `ffa4944` — fix: allow multiple student records per person (kardani + karshenasi)
- `ec2c7da` — fix: multi-program students + professors INSERT column count
- `a11fea0` — fix: dedup users by nationalCode, keep one student per stno (multi-program)
- `81068b9` — fix: merge both student files, key students by stno
- `fcdf4aa` — fix: load majorsByCode from DB in phaseStudents + fix existing students majorId
- `bcf1629` — fix: log full error with stack trace
- `f788fad` — fix: cast majorCode to text for string comparison in Map lookup and UPDATE
- `75544f7` — fix: students1.txt as primary student file (base)
- `4dc2efb` — fix: dynamic majorCode/facultyName + add degree level field to student form
- `a1a142c` — fix: replace all hardcoded fields in student form with dynamic data
- `9e999e5` — feat: backup/restore panel in admin settings (DB SQL dump + MinIO files)
- `be3cf5b` — feat: محاسبه خودکار وضعیت نمرات + سیاست حذف مردودی بر اساس آیین‌نامه

#### 2026-09-11 — ۵ کامیت

- `a6389d5` — fix(login): دکمه ورود دیگر گروگان state نیست + name/autoComplete برای سازگاری با مرورگرهای قدیمی
- `959443a` — feat(regulations): سوییچ ادمینی برای حذف تکرار درسِ ازقبل‌قبول‌شده در معدل کل
- `a9a25bb` — fix(security): گارد ADMIN روی ۶ Server Action بدون‌محافظ بکاپ/ری‌استور
- `25487ed` — fix(print): چاپ کارنامه به‌هم نریزد — نوار عنوان/دکمه‌ها پنهان شود + تناقض @page حذف شد
- `4e084fd` — fix(scripts): مرحلهٔ ۳ recompute-grade-status.mjs با ستون text کرش می‌کرد

#### 2026-09-12 — ۱۲ کامیت

- `1c14670` — fix(transcript): متن بلند وضع نمره ستون را به‌هم می‌ریخت — به کد + راهنمای پایین کارنامه تبدیل شد
- `efd57fb` — feat(curriculum): کد وضع نمرهٔ سما (قبولی/مردودی) مختص هر تخصیص درس در کاتالوگ
- `b186654` — fix(scripts): ensureRegulation NaN guard — entryYear/maghta خالی باعث NaN در SQL نشه
- `621b68c` — fix(recompute): بازمحاسبه وضع نمره از دیتای خام سما (markStat) + نمایش توزیع کدها
- `f43ddd7` — fix(recompute): syntax error apostrophe in string
- `55667a6` — fix(recompute): table name legacy_code_maps not codemaps
- `ed2d7f8` — fix(recompute): correct column names legacyCode/legacyTitle + sourceCode filter
- `312b183` — fix(recompute): enrollments JOIN via students/course_offerings/courses/academic_terms
- `afcf42d` — fix(recompute): courses.code not courseCode
- `32989e9` — fix: دروس حذف/حذف آیین‌نامه حین ایمپورت رد نشن + ثبت تغییرات نمره + migration 0015
- `95e41df` — feat(grades): ثبت و ویرایش نمره توسط ادمین و کارشناس فارغ‌التحصیلان + لاگ ممیزی کامل + محاسبه خودکار کد وضعیت سما
- `f92e16d` — fix(identity): نام فارسی اساتید، جنسیت و محل تولد دانشجویان + مدیریت حساب وب در پنل

#### 2026-09-13 — ۱۵ کامیت

- `c40157e` — feat(students): پروندهٔ تکمیلی دانشجو از سما — نمایش و ذخیرهٔ دستی در پنل ادمین
- `ff84ad0` — fix(students): خواندن استاد راهنما و نوع شهریه از students1 + نوشتن insertDate/insertTime
- `ae6f18e` — fix(admin): ساخت خودکار نقش در بازنشانی رمز + بازنشانی گروهی رمز و ترمیم نقش‌های جاافتاده (norole)
- `b168911` — feat(staff): ثبت کارشناس/کارمند جدید (اطلاعات شناسنامه‌ای + حساب وب) + تخصیص نقش به هر فرد
- `78e3f56` — feat(staff): دکمهٔ «اضافه کردن استاد/کارکن» حالا واقعی و در بالای تب اساتید + فیلتر سمت در لیست
- `f66edaa` — feat(staff): تخصیص نقش‌ها از تب اساتید پنل دانشجویان (کارشناس/استاد)
- `736b8de` — feat(permissions): دکمهٔ «همهٔ ماتریس» برای دادن/گرفتن تمام مجوزها به یک نقش
- `72c5acc` — fix(staff): دکمهٔ «نقش‌ها» در بالای پروندهٔ استاد + برچسب صحیح وضعیت برای سمت اداری + نقش استادِ خودکار برای تایپ آموزشی
- `49e09f7` — feat(multi-uni): سوئیچر دانشگاه + migration universityId + فیلتر کوئری‌ها
- `fb9f597` — feat(reports): فیلتر دانشگاه در گزارش‌ها + types
- `e23364e` — feat(reports): عملیاتی‌سازی ۴ گزارش به‌زودی (tuition/payesh/jame/docs)
- `cd1e7da` — feat(telegram): بات تعاملی تلگرام + اعلان‌های خودکار (انتخاب واحد/مشروطی/سنوات) + webhook
- `b4c0ca8` — fix(telegram): webhook URL از AFAGH_PUBLIC_BASE_URL هم بخواند
- `b3e687e` — feat(messengers): پشتیبانی از بله/سروش/ایتا/ای‌گپ + وب‌هوک یکپارچه + بات تعاملی چندپیام‌رسانه
- `59e548e` — fix: اصلاح EGAP → IGAP در همه فایل‌ها

#### 2026-09-14 — ۱۳ کامیت

- `a12a446` — fix(security): اتصال حساب بات پیام‌رسان فقط با کد ملی، بدون رمز، قابل‌سوءاستفاده بود
- `70a2176` — fix: فیلتر دانشگاه رکوردهای NULL را هم شامل شود (قبل از migration)
- `bcf4f03` — feat(soroush): کارت سروش در تنظیمات پیام‌رسان‌ها (UI + save + load)
- `434ef06` — debug: اضافه‌کردن console.log برای عیب‌یابی کارنامه خالی
- `1ad57fb` — fix(soroush): اضافه‌کردن سروش به تست ارسال پیام
- `d1cf2b5` — fix: try-catch برای universities + فیلتر _prefix Next.js در university param
- `7725847` — fix(migrate): ثبت 0015 و 0016 در journal + students safety در 0016
- `211ee87` — feat(finance): جدول یکپارچه tuition_rules + resolver با اولویت مقطع&gt;رشته
- `2f8166e` — fix: include حذف آموزشی in qualitative grade map + set enrollment.status=DROPPED in applyGrades
- `93c4290` — fix: make backup non-fatal in migrate-db.mjs + add حذف آموزشی to grade map + DROPPED enrollment status in applyGrades
- `ed56d51` — fix: add grade_change_log to RLS coverage (pg-hardening.sql + hardening.mjs) + make backup non-fatal + حذف آموزشی grade map
- `fd1694e` — fix: parseGrade now uses status code mapping for numeric grades + add code 7 (حذف آموزشی) to GRADE_STATUS_CODES
- `f357c09` — fix(grades): always refresh coursesByCode in import + backfill enrollments for dropped (markStat=7)

#### 2026-09-15 — ۹ کامیت

- `e2ea135` — fix: اولویت samaGradeStatusCode بر markStat قدیمی در کارنامه ادمین
- `4fb2d97` — fix: resolveSamaGradeStatusCode از resolveStudentCurriculum برای نسخه صحیح برنامه درسی استفاده می‌کند
- `1e9e5db` — feat: نمایش و ویرایش کد وضعیت نمره (قبولی/مردودی) مستقیماً در جدول دروس کاتالوگ
- `1df143d` — feat: صفحه مستقل کدهای وضعیت نمره دروس + کاشی دسترسی سریع در داشبورد ادمین
- `d0bb0ed` — fix: APIهای صفحه کدهای وضعیت نمره - استفاده از getSessionUser بجای requireRole + اصلاح نام فیلد majorCode
- `0cb9859` — feat: ادغام فایل‌های جدید جمینی - مدیریت کلاس/استاد/ادغام ارائه‌ها + موتور نمره‌دهی + type های scheduling
- `b4c798a` — test: اضافه کردن تست‌های جدید جمینی - scheduling-engine, grade-engine, waiting-room
- `690f3d2` — fix: re-export کلاس‌های actions1 در actions.ts برای رفع خطای build
- `43814f4` — feat(regulations): add RegulationEngine, LegacyStatusMapper, CrosswalkService + legacy mapping tables

#### 2026-09-16 — ۱۶ کامیت

- `aaebe27` — fix(scheduling): remove re-exports from actions.ts, fix imports to use actions1 directly
- `15781a7` — Revert "fix(scheduling): remove re-exports from actions.ts, fix imports to use actions1 directly"
- `6788d8f` — Revert "feat(regulations): add RegulationEngine, LegacyStatusMapper, CrosswalkService + legacy mapping tables"
- `35d0739` — Revert "fix: re-export کلاس‌های actions1 در actions.ts برای رفع خطای build"
- `0cab65d` — Revert "test: اضافه کردن تست‌های جدید جمینی - scheduling-engine, grade-engine, waiting-room"
- `7a800cb` — Revert "feat: ادغام فایل‌های جدید جمینی - مدیریت کلاس/استاد/ادغام ارائه‌ها + موتور نمره‌دهی + type های scheduling"
- `41cec46` — مدیریت دروس و کدهای وضعیت نمره: بانک دروس + فرم تعریف + ویرایش
- `e85090e` — انتقال فرم ویرایش بالای جدول بانک دروس
- `4593107` — مدیریت دروس: مودال کامل مشابه سما + ۱۱ ستون جدید + مهاجرت + ایمپورت
- `a6e8ff4` — کدهای وضعیت نمره از DOROS.txt + فیلدهای ناقص مودال (حذف اضطراری/همنیاز/فعال)
- `bd17edb` — سیستم نمره کیفی: جدول grade_thresholds + توابع تبدیل + UI تنظیمات
- `e6a6b34` — تب دروس ارائه‌شده + passGrade بهینه + ارم Docker volume
- `f365b25` — feat(financial): سیستم مالی مشابه سما — فاز ۱+۲+۳
- `0cd3dc8` — feat(course-equiv): فیلد هم‌ارزی دروس — equivalentCourseCodes
- `a8ad990` — feat(multitenant): add universityId to all remaining tables
- `f93f9fe` — fix: repair corrupted comment in issued_degrees table

#### 2026-09-18 — ۱۲ کامیت

- `166775b` — fix(import): universityId on all inserts + duplicate studentCode handling + groups-before-majors order
- `e78c580` — fix(import): auto-load universityId per phase for reusable single-step runs (ALLAME/SHAMS/ZARINE)
- `8887049` — feat(multitenant): global university switcher in admin header (cookie) + strict uni filter on students/courses
- `9971f0a` — fix(multitenant): sync page uni dropdown to global cookie
- `528e1c3` — feat(import): multitenant professors import (--source + universityId + dashless names)
- `dfa3592` — feat(import): normalize 3-digit term codes to 5-digit (zarine 871-&gt;13871)
- `f66bfac` — fix(import): scope faculty/dept lookups per university (fix cross-uni code collision)
- `5020e98` — fix(import): clamp out-of-range hours/marks (zarine total-hours data)
- `f1f9658` — feat(multitenant): per-university unique studentCode/courseCode/staffCode + scoped import caches
- `383c171` — feat(multitenant): migration 0024 per-uni unique studentCode/courseCode/staffCode
- `8c30c66` — fix(import): per-university synthetic national codes (SA/SL/SZ/SH prefix)
- `02053b1` — fix(import): dedupe stterm batch (hamava multi-rows per student-term)

#### 2026-09-19 — ۹ کامیت

- `e0c76f0` — feat(multitenant): per-uni termCode unique + scoped term cache (shams/nazhand collision)
- `9a0ad60` — feat(multitenant): uni filter across curriculum/staff/offerings/tuition + remove dup switcher
- `fe27bc8` — feat(grades): per-course passing threshold in GPA engine + unfilter global degrees
- `bb6b59b` — feat(ui): per-uni theme + global switcher filtering + dynamic per-course pass threshold
- `d23f6d7` — feat(theme): auto hash-based uni themes + colored custom switcher + themed nav
- `4d7dd80` — fix(theme): wire theme through nav + colored dot switcher (auto for future unis)
- `7b78ea1` — feat(audit+search): per-student course in audit modal + global /grades/audit + fa-normalized search (ي/ک/ه) across 7 clients
- `40931a8` — fix(build): split university-theme client-safe from server scope (fix Turbopack pg/dns error)
- `e81f05d` — feat(report): one-shot transfer verification script (per-uni + GPA diff + orphan + broken JOIN)

#### 2026-09-20 — ۲ کامیت

- `d152e50` — feat(migration-v2): identity core, term normalization, and offering synchronization pipeline
- `a2cd6d2` — fix(migration-v2): add multi-platform path candidates for schedule sync

#### 2026-09-21 — ۳ کامیت

- `03e9950` — feat(multitenant): complete sama import pipeline and multi-tenant migration 0027
- `dc8189c` — feat(regulations): auto sama status resolution, cascade fix, regulation-check diagnostics and original code preservation
- `29756ab` — feat(grades): complete grade-engine rollout, 941-masters fix, shams degree remap

#### 2026-09-22 — ۷ کامیت

- `56f0736` — feat(pipeline): idempotent post-import grade pipeline for server and local
- `fe0d68f` — feat(deploy): auto post-import grade pipeline in install.sh and import-sama.sh
- `edf37a0` — fix(hardening): add person_source_identities to RLS deny-all tables
- `89f08b6` — feat(etl): convert-all-universities wrapper - ETL all 5 unis plus post-import pipeline
- `cd30996` — fix(pipeline): safeguard fix-shams-degrees against missing degree level configs in dry runs
- `d0b04c8` — perf(backfill): preload offerings and enrollments into memory to reduce round-trips from O(N) to O(1)
- `80fdc7e` — feat(etl): self-contained sama import - enrollments with sama codes and dropped status, legacy marking, course accept codes, shams degree override (no backfill needed for fresh imports)

#### 2026-09-23 — ۳ کامیت

- `a9a5cca` — chore(etl): wrapper pipeline now runs only the grade engine (backfill/codes/regs/shams folded into import)
- `d4b2067` — fix(migration): drop both case variants of legacy global unique constraints (drizzle stores mixed-case names)
- `87f882a` — chore(gitignore): ignore ETL logs and grade-audit reports that contain student codes

#### 2026-09-24 — ۶ کامیت

- `2373b70` — fix: improve student transcript layout and print structure with uniform term grid blocks
- `751a84d` — fix(fresh-install): restore single-col uniques for seed-base + handle missing term_id in 0023
- `68f7c78` — fix(patches): keep only system_settings unique; majors/faculties per-university (0027) must stay composite for multi-uni ETL
- `0a5cd10` — fix(etl): make students1.txt join equal with other student files (supp2) for AFAGH --full 3-file join
- `b11282e` — fix(professors): separate payeh (numeric) from academicRank (text) and promote doctorate from مربی to استادیار
- `e52f5fd` — fix(docker): make apt-get in migrator resilient to network failure (|| true) for offline build

#### 2026-09-25 — ۲۲ کامیت

- `94b9646` — professors: academicRank from اساتید2.txt col12 (مرتبه علمی) — not AdjectiveCode/PositionTitle
- `002ab82` — feat(compare): per-student legacy-vs-engine transcript comparison + 7/5 taken-only fix
- `8351c47` — feat(engine): --uni filter for per-university rerun; fix-student-profile uni scope + NEZAM titles + birthDate
- `ef268a7` — feat(students): fix-student-profile also reads studentraw data.txt as fallback source
- `4894fa9` — feat(professors): fix-professors-nc replaces synthetic NC + wrong birthdates from ostadan/rank2, renames faculties by code
- `bc57de1` — fix(dates): correct broken Jalali-&gt;Gregorian conversion (wrong day/month in 4 scripts + normalize.ts); professor NC placeholder/clash diagnostics; student --fix-bd repairs corrupted birthdates
- `53d9948` — feat(professors): classify BD replacements by old-bug signature (corrupt/filled/other) before apply
- `ed04f44` — chore(professors): report unmatched department groups (grpName miss detail)
- `5efae6c` — feat(student): --fix-nc replace synthetic national code from students1 col12
- `f015586` — feat(universities): per-university logo (logoUrl column + upload UI + transcript fallback to global logo)
- `8106fbd` — feat(students): backfill profile fields from SAMA files (homeTell column, full NEZAM military status, studyingMode/trainingMethod codes) + fix UI code-&gt;title mapping (course type/training method/acceptance type) + visible add-university button
- `97015dd` — perf(admin): speed up loading — legacy_grades studentCode index (transcript was scanning 615k rows ~250ms), uni-scoped statusCounts, conditional count joins
- `5c11b3e` — fix(seed): majors/departments/faculties uni-scoped (uq_majors_uni_code) + adopt legacy NULL-uni rows
- `6bb3629` — feat: shared name-resolver module + import guard (no more نامشخص firstName) + multi-DB idempotent fix-unknown-names + university scoping for all admin pages
- `5020d55` — fix: missing &lt;div in exams page return (unterminated regexp)
- `20930bc` — fix: remove unused imports (COMPOUND_PREFIX, VALID_COMPOUND_FN_PREFIXES) from fix-unknown-names
- `b94f206` — fix: export isFamilyParticle and hasFamilySuffix from name-resolver
- `5cd26d2` — feat: term code normalization for transcript — 5-digit standard, equivalence-first ordering, academic year grouping (1394-1395 format)
- `63b8837` — fix: transcript JSX structure - close header div before table
- `21be48b` — fix: transcript JSX comments causing build failure
- `8115ff1` — fix: transcript JSX structure - summary inside outer div
- `e7d90b9` — fix: transcript JSX - close yearGroup div and outer wrapper

#### 2026-09-26 — ۴ کامیت

- `6b0c1ad` — fix: transcript JSX map closure - close year wrapper and outer academicYears map, drop extra div
- `50d6437` — fix: staff search crash on null staffCode/nationalCode - null-safe faIncludes filter + source coercion
- `01db335` — fix: scope exams by university - terms/sessions/courses/halls filter, client keeps universityId on reload, RLS uni policies for exam tables
- `6c92f8f` — feat: exam engine uni scoping end-to-end + seed adoption for faculties/departments + migration 0032 (missing universityId columns)

#### 2026-09-27 — ۱۳ کامیت

- `22a69a7` — fix: transcript code 6 emergency drop counts as taken-only like 7 and 5 (taken yes, passed/failed/GPA no) + test
- `93e1cbf` — fix: Sama-like transcript print - A4 landscape, taken-only code 6, dropped/effective units, term title, page counter + tests (120 pass)
- `0f6ddd6` — fix: transcript print v2 - fa term titles, equal-height term grid, portrait mode, dissolved origin, full entry date, print options (legend/breakdown/rank/photo/logo/thesis-qualitative), cohort rank year+term excl no-show/withdrawn/expelled + tests (137 pass)
- `7e07997` — fix: Sama legend format code=title + thesis qualitative ranges footnote (thesisLegend) + tests (139 pass)
- `50bc946` — fix: portrait print actually portrait (orientation param was ignored), fill last info-grid row, robust unknown nationality
- `d13273d` — fix: visible cohort-rank error state + server warn log for empty GPA set
- `3f1470d` — fix: portrait print stays 3-col compact + bundle Vazirmatn font for transcript print
- `75c0277` — fix: fa digits everywhere, running header on later pages, isolated print root (no blank pages), breakdown flows naturally + tests (143 pass)
- `ca2b0c6` — fix: full header+info repeat via table thead, studyMode map from Sama files, remove running-head hack
- `7d742f2` — fix: signatures repeat under every page via tfoot, fa digits for course/status codes
- `f84bc34` — fix: study mode from trainingMethod, course type from studyingMode (columns were swapped) + guards + tests (153 pass)
- `9b08fa1` — fix: regulations engine overhaul — retakeMinGrade applied, frozen 931 codes (5/6/7/22), sync respects frozen, seed normalizer, retake bar in transcript, course type swap fixed, auditStudent uses regulation, portal presets per degree + retakeMinGrade/failed_sama_status_code fields, signature tfoot, fa digits course/status codes, running header via thead + tests (156 pass)
- `c1b40ae` — fix: sync skips non-FINALIZED rows (no 931 on gradeless), frozen 5/6/7/22 everywhere, retakeMinGrade, enroll cap on term total, auditStudent regulation-aware, seed normalizer, portal presets per level

#### 2026-09-28 — ۸ کامیت

- `4b5812d` — fix: self-healing frozen codes in sync (restore 5/6/7/22 originals), no regulation flag on frozen rows + tests (158 pass)
- `7ecd57a` — feat: audit-gpa-vs-legacy script - engine GPA vs Sama termAvg/totalAverage per university
- `e38dbf2` — fix: 1391 retake bar enforced in sync/resolve (heals stale -91), resolveRetakeBar helper + tests (164 pass)
- `04f9d0c` — fix: stray duplicate brace in resolve (build fix)
- `75b140a` — feat: add entryDate + graduateDegreeLevelId for precise graduation info in transcript
- `f0a8678` — feat: add graduateDegreeLevelId + entryDate with full date import, fix BASE_DEGREES export for transcript
- `565947b` — fix: use client-safe DEGREE_LEVEL_CONFIGS for transcript, remove server-only imports
- `4d475bc` — fix: create client-safe degree-configs.ts for transcript, remove server imports from client


_بلوغ سامانه: BI، کلاس ادغامی، ارزشیابی، تخصیص درس، موبایل/PWA، سخت‌سازی RLS و پشتیبان‌گیری._

### 2026-10 — ۴۸۳ کامیت

#### 2026-10-01 — ۱ کامیت

- `855a4f1` — fix(terms): canonical 5-digit term codes end-to-end — digit-rule typing, equivalence-first transcript, DB-titled buckets

#### 2026-10-02 — ۲۳ کامیت

- `cc53dc6` — fix(terms): tighten sane academic-year range to 1300-1420
- `22f9a5a` — fix(codes): scope duplicate detection by university/faculty instead of global
- `99f86b8` — fix(import): use HAMAVA degree levels for SHAMS instead of forcing SAMA
- `d78a881` — fix(import): remove duplicate const accept (pre-existing SyntaxError)
- `c88a926` — fix(import): resolve graduation degree via ensureDegree (lookups.maghta never existed)
- `03db8b3` — fix(codes): filter by active university; unify summer/equivalence titles
- `d7ac85a` — feat(codes): clickable column sorting (code/title/context) with fa locale
- `a45b2d8` — fix(codes): filter degrees by active university (owned/shared/used)
- `f17dd70` — feat(scope): university filter on finance rules and grade audit pages
- `09c9ad4` — fix: resolve all tsc errors (eq import, SQL type, degree ref, duplicate test keys)
- `07ccfc8` — fix: guard null offeringId in sample script
- `16e11c6` — feat(codes): term editing — dates columns + full schedule form (enrollment/add-drop/exams/appeals)
- `e686b5f` — migration: 0035 add addDropStartDate/addDropEndDate to academic_terms
- `de4f2b5` — feat(finance): complete SMA-compatible financial system overhaul
- `a31353d` — feat: ministry/standard code columns (0036) + uni filter &amp; sort on inbox/departments/regulations
- `4b8d05a` — fix: export-utils DOCX paragraph syntax (alignment misplaced in array)
- `370b0f6` — fix: move emergency-drop section inside root div (JSX structure)
- `a421689` — refactor: split finance mega-files into submodule folders (finance-rules, finance-engine, enroll-engine, finance actions)
- `ec601ad` — feat: thesis/defense UI + workflow migrations 0038-0040 fixes + report rewrite + typecheck &amp; dependency fixes
- `fa02819` — db: 0041 finance schema sync (financial_terms, growth rates, payment gateways/transactions, POS tables + missing columns/indexes/constraints)
- `9da802c` — fix(finance): university scoping on student finance detail/payments + RLS for payment_transactions &amp; pos_transactions
- `4cadcf4` — fix(graduation): await async settings, nullable title/status guards, room id resolution
- `82cd0ce` — feat(codes): Jalali date inputs, modal popup for add/edit forms, drop ministry code fields from term; db: 0042 fix pos heartbeat column name

#### 2026-10-03 — ۴ کامیت

- `caea8ad` — feat(codes): single standard-code field, edit button for faculty/department/major/course with generic update action + faculty options
- `9c83a03` — fix(codes): courses.code column name in generic edit reader
- `f80329d` — fix(codes): use middle-dot separator for department faculty label
- `fba0c05` — fix(db): اجرای واقعی مهاجرات‌ها + ۷ سیاست RLS مرده + رفع بلاکر بیلد

#### 2026-10-04 — ۸ کامیت

- `ab8bc6c` — feat(geo): 0043 geo reference tables + ministry shared codes seed
- `91a4864` — feat(samin): wire geo + shared codes (birthplace dropdowns, samin location/military, MILITARY seed)
- `b0b7c6b` — fix(samin): V0.6 alignment
- `2d7cc38` — fix(status): Zarineh code 43 is NO_SHOW + SAMIN_MASTER_KEY wiring
- `ac2284d` — chore(compose): pass SAMIN_MASTER_KEY to containers
- `87eff01` — fix(status): Zarine 39/40/41/42 graduated overrides + transcript uniCode
- `26a4d61` — fix(samin): map empty/0 nationality to 120001
- `adaff92` — feat(reconcile): مبنای امنِ تطبیق کارنامهٔ بین‌دانشگاهی + ترمیم کد ملی زرینه/علامه

#### 2026-10-05 — ۱۵ کامیت

- `376ca2c` — feat: major fixes across reports, admissions, payroll, scheduling, exams, build
- `28ea43c` — fix: LivePayrollClient JSX syntax error (missing : null in ternary)
- `6edaf15` — fix: LivePayrollClient fragment wrapping in ternary
- `96b7c87` — fix: LivePayrollClient fragment wrapped in parentheses for ternary
- `5561f65` — fix: LivePayrollClient use div instead of fragment in ternary
- `2bbaa23` — fix: LivePayrollClient use &amp;&amp; for conditional rendering inside div
- `951d88b` — fix: LivePayrollClient wrap overview ternary in fragment
- `a94416b` — fix: LivePayrollClient use &amp;&amp; instead of ternary with fragment (TSX parse fix)
- `493d36c` — Merge remote-tracking branch 'origin/FINAL' into FINAL
- `587815b` — merge: integrate origin/FINAL fixes (user) with local samin/geo/codes work
- `9dad2dd` — fix(db): register 0035-0037 migrations in journal + make 0037 idempotent
- `0f38f3b` — fix(curriculum): stamp universityId on version create/revision + backfill legacy NULL rows
- `bf855b9` — fix(db): collision-safe universityId backfill (inherit uni from major for versions)
- `8f57725` — merge: بازگرداندن کار ترمیم کد ملی + مبنای تطبیق کارنامه پس از force-push
- `ecc3fea` — fix(tuition): درسِ منتقل‌شده هرگز دوباره شارژ نشود + جای‌گذاری هم‌ترم عادی

#### 2026-10-06 — ۱۷ کامیت

- `d78458c` — fix: catalog version edit + UNITS_COVER_MIN false-positive
- `b6d6e8e` — fix: create-admin also creates staff row (required for curriculum approvals)
- `8fb925e` — fix: scope orphan-course count and bulk-assign to current university
- `660e590` — feat: manage version courses inside edit modal (remove/add from bank)
- `f8c8dba` — fix: bounded regulation scan (2000 rows) + fresh uni filter; backfill course degree levels from sama file
- `833f09c` — fix: uni-scoped curriculum APIs + per-group content panel + orphan triage + course type/degree backfill support in import
- `dc2bf41` — feat: 60+ new reports wired + grouped admin navigation + per-report matrix permissions
- `634958e` — fix: move shared report helpers to report-helpers module (server-action export rule)
- `1267d41` — fix: move LINK_CARDS to client-safe report-links module (server bundle leak)
- `cda2f1f` — ux: reports flow cleanup (auto-scroll, links to bottom, visible errors) + nav regroup
- `cc678b6` — fix: dedupe report filter dropdowns (terms/majors/faculties/departments scoped, degrees title-matched)
- `9a054c5` — ux: clickable dashboard title to home + cool soft background
- `3f82b2d` — debug: log runReport server stack for invisible client errors
- `126979e` — feat(saham): SAHAM annual report fields — 12 new student columns + institute codes + value maps; fix gradeValue numeric regex
- `146446e` — feat: professor login fix + full user deactivation + university-scoped terms
- `a53800a` — feat: revert staff merge, login by NC-or-staffCode with account picker, real staff edit-save
- `b79b86b` — feat: person-linked login candidates via source-file staffCode-NC map

#### 2026-10-07 — ۱۹ کامیت

- `7809fbf` — feat: cross-account switcher banner (staff + student siblings by shared NC)
- `efe53f1` — chore: reset unusable password hashes (35,749 accounts) with backup
- `082c071` — chore(db): register idx_students_userid in drizzle schema
- `74ccf26` — fix(samin): show per-university queue counts and empty-state hint
- `9a120bd` — fix(student): replace fabricated curriculum chart and dashboard cards with real data
- `90efda8` — fix(student): drop fabricated identity fallbacks in dashboard hero
- `44a3ffd` — fix(student-portal): correct transcript, sidebar and thesis-proposal P1 defects
- `b84caeb` — feat(terms): term scope cookie and date-based term resolver
- `a11fdec` — feat(student): term filter switcher for admin and student portfolio
- `d1b30f2` — feat(student): term filter for exam card, finance and virtual classes
- `b8412f8` — feat(terms): admin bulk activation with date sync
- `6299561` — refactor(terms): date-based current-term resolution
- `e99b7c2` — fix(professor): replace hardcoded portfolio data with real database queries
- `b2b51bb` — feat(demo): shared demo-account detection helpers
- `c10d5a2` — feat(professor): demo showcase data for demo professor account
- `1317710` — feat(student): demo showcase data for demo student account
- `eb9069c` — feat(professor): term filter switcher for professor portfolio
- `6c5b8b8` — fix(terms): hide equivalence terms and sort switcher chronologically
- `e1d4728` — feat(help): role-based help center at /help with per-role PDFs

#### 2026-10-08 — ۳۶ کامیت

- `072860c` — fix(professor): reconcile dashboard course list with weekly schedule
- `0b31b10` — fix(fonts): anchor the intended Persian font on &lt;body&gt; and preload Vazirmatn
- `41934ec` — feat(help): role-based in-app help center with screenshots
- `94f145b` — fix(fonts): preload Vazirmatn 700 subsets so guide headings stop flashing Tahoma
- `1390162` — fix(professor): generate class sessions from attendance page
- `fc52d86` — feat(professor): printable tidy weekly schedule with even-odd weeks
- `050d394` — feat(professor): unified attendance and grades for merged courses
- `920e45a` — feat(professor): calendar-style weekly grid with days as columns
- `71a0730` — fix(build): move pure professor grid row type+helper to client-safe module
- `a710d63` — feat(staff): unique staff code per university
- `b848ac8` — feat(professor): prominent two-code portal switch
- `9536d5e` — fix(scheduling): unify weekday convention to 1..7 and chunk session inserts
- `cd735d3` — fix(scheduling): restore Sama 0-based weekdays and unshift imported data
- `ae429f9` — fix(build): unexport non-action const from use-server module
- `e72c6ca` — fix(professor): collapse merged and even-odd entries in calendar grid
- `6973334` — fix(professor): print room in calendar cards, isolate term title bidi, taller print rows
- `b877aab` — fix(professor): print only the week grid from dashboard
- `ed7b7cd` — fix(contract): count merged courses as one in teaching contract
- `97aefe3` — feat(student): rebuild schedule on shared calendar grid with room and print header
- `063f3df` — feat(print): university logo in print headers and wider print columns
- `9b43fe6` — feat(professor): attendance bulk actions, roster filter-sort and save feedback
- `b8898b5` — perf(student): scope dashboard queries and parallelize awaits
- `023eb42` — perf(professor): parallelize dashboard and de-N-squared attendance
- `0a2ef75` — perf(db): missing indexes for hot paths
- `5fc86fb` — perf(enroll): batch submit roundtrips; scope session generation
- `0eb6889` — test: wire new perf and attendance suites into npm test
- `35c84aa` — test: wire new suites with minimal diff
- `a046ae3` — test: wire new suites with minimal diff
- `fe2b867` — fix(contract): merged units from primary course; payable minutes-per-unit setting; student print grid-only
- `d36c777` — fix(login): normalize Persian/Arabic digits in identifier and password
- `5e268c2` — feat(login): redesigned login page with showcase + admin management
- `dd96c58` — fix(uploads): serve /uploads via route handler with fresh disk reads
- `f79f5d6` — fix(login,help): global logo fallback on login; public shared help for guests
- `26a7b6e` — fix(login): slider arrow clicks now work (link only on background image)
- `03d51b6` — feat(help): 43 real screenshots for all help pages (PII redacted)
- `ebd47b1` — feat(ui): system-wide dark mode support

#### 2026-10-09 — ۲۵ کامیت

- `d5346cc` — feat(saham): per-university SAHAM export module (52-col workbook, institute codes, value maps, admin dashboard + download API)
- `470e9f4` — fix(saham): drop us.phone reference (column does not exist — landline comes from students.homeTell)
- `bd71a52` — fix(saham): ASCII filename header (ByteString crash on Persian filename) + RFC5987 filename*
- `87620cf` — feat(saham): migration 0052 — backfill birth city/province from users.placeOfBirth via geo_cities, residence from address token match
- `01fcc94` — feat(saham): all 3 reports (students+graduates+instructors) with server filters, preview count, row cap; CTE-optimized query; migration 0053 staff birthplace
- `2315921` — feat(saham,lesson-plan): jalali birth year, glued entry year, native map, value-maps 0054, lesson-plan module + migration 0055, per-uni filters
- `f66f025` — fix(migration): quote camelCase columns in 0054 (sourceValue folded to lowercase, migrator exit 1, app down)
- `826fa47` — fix(saham): real leave/probation counts, scoped city lookup, exact-or-blank institute codes, institute settings UI, instructor dept fix
- `f5193d6` — fix(deploy): RLS policy for staff_term_roles (hardening gate halted deploy, app down)
- `503dadb` — fix(admin): real makeup-request cartable (room/topic/reason columns + approve/reject), term switcher hard reload
- `9a321cd` — fix(deploy): RLS policy for messenger_link_tokens (hardening gate)
- `23b9153` — feat(soroush): polling-lite upgrade per official bot docs (getUpdates confirmed) + api.splus.ir base
- `b0d1cb5` — feat(messenger): portal connect page (/messenger) with one-time code mint + confirm
- `1046dd3` — fix(soroush): correct API base fallback to api.splus.ir (old base 404s)
- `9fee133` — fix(messenger): surface server-action errors on connect page (stale deployment guidance)
- `0a0c721` — feat(notify): real template test-send via shared sender + bare-code pairing accept
- `ee360ab` — feat(notify): real template test-send + custom variables + template persistence (0062) + messenger onboarding banner
- `678be38` — feat(greetings): birthday cron + term-start bulk greetings (route, lib, scheduler, seed, settings)
- `81b81b5` — fix(responsive): admin header overflow, transcript stacking, dropdown contrast
- `3439db3` — chore(dev): reusable PII-redacting help-screenshot capture script
- `b850cbd` — fix(transcript,print): students list scroll on mobile; landscape fit guards
- `0c9cacf` — fix(notify): test-send resolves all accounts sharing a mobile, clearer skip error
- `fdb6428` — fix(login): actionable error diagnostics; dark-mode notice contrast
- `59abf22` — Fix professor save (birthDate Date, NC tolerate-unchanged), remove misleading volunteer-list button, NC search normalization, dark-mode contrast across admin/login/help/messenger
- `dba7473` — feat(auth,messenger): staff/student-code-only login; messenger auto-confirm + poller boot; OTP via messenger; compact university switcher

#### 2026-10-10 — ۱۷ کامیت

- `a27179a` — fix(greetings): term-start bulk only to ACTIVE students
- `b1bdc4f` — fix(deploy): RLS policy for user_notification_prefs (hardening gate)
- `7d503b5` — feat(account): same-session student-professor portal switcher + dedupe session roles
- `8ca733c` — fix(cron,messenger): scheduler advances next-run on ok (was re-running all scans every tick, starving interactive requests); mint auto-retries once on transport failure
- `f65789a` — feat(account): professor-portal switcher in alumni layout (graduated dual-role users land here, not /student)
- `a37c015` — fix(messenger): test-dispatch accepts direct chat ids (not just mobiles); guard pairing poll against concurrent ticks double-confirming
- `16df53d` — feat(templates): test-dispatch resolves staff/student code, mobile, national code -&gt; auto-finds messenger address per channel
- `d524eda` — feat(notify,staff): term-start greets enrolled-ACTIVE students + teaching staff of that term; staff active toggle (single+bulk) in admin; onboard banner third state for adding another messenger + alumni coverage
- `fce38b9` — feat(notify): editable greeting texts in settings (textarea type) + admin broadcast page for targeted bulk messaging (major/dept/faculty/entry, staff/student)
- `b8dc72d` — feat(broadcast): class-in-term filter (term + offering pickers, students enrolled + lecturers); editable greeting texts wired
- `df75812` — fix(broadcast): load current term offerings on mount (list stayed empty until manual term change)
- `26b1aa0` — feat(broadcast): searchable class combobox (code/group/professor, fa-digit tolerant) instead of 1500-option select
- `9315cfc` — feat(broadcast): honest per-channel delivery report + sender-tagged history log + professor self-class messaging page
- `530816c` — fix(broadcast): hierarchical org filters (dept implies faculty, major implies both) so combined faculty+dept no longer over-filters to ~nobody
- `c926ded` — feat(lms): read-only pull API for Moodle (terms/courses/users/enrollments/schedule) with MOODLE_PULL_TOKEN + live doc
- `0a46b43` — fix(student): prefer ACTIVE (alumni: GRADUATED) record when a user has multiple student rows; unordered limit(1) picked the wrong file
- `65fee41` — fix(account): same ACTIVE-first ordering for sibling-banner student code display

#### 2026-10-11 — ۳۹ کامیت

- `74684e6` — feat(terms): classStartDate/classEndDate (teaching period distinct from term start) + session generator bases on it (mig 0064)
- `43de832` — feat(professor): all-sessions view — flat clickable list of every class session across all courses (date-sorted) opening straight into the session
- `385b69b` — feat(professor): all-sessions view grouped per course (section header per درس instead of one flat table)
- `30fedcc` — feat(professor): accordion all-sessions view — click course header to collapse/expand its session list
- `88ee350` — fix(dark): systemic dark-mode contrast — map all light color tints (emerald/indigo/amber/rose/red/sky/blue/purple/teal/orange/green/cyan/yellow/lime/fuchsia/pink) + gray, 900-level text, tint borders, white-opacity bgs; hardcoded error color to var
- `af14e8b` — feat(multiuni): universityId on all important data tables (notifications, deliveries, channels, link tokens, lesson plans, staff roles, signatures, workflow, payroll, legacy_* staging) — migration 0065 with backfill via user/staff/offering
- `5f7413b` — feat(finance): legacy ueams migration script — TermAms→student_ledger (TUITION_FIXED/VARIABLE), StdPays→PAYMENT, clearances; per-university (uni+code) matching, idempotent via referenceId
- `0a0121b` — feat(finance): uems full-range migration (1383-1405, 5-digit terms) + rial reconciliation verifier (ledger net vs legacy TermAcc)
- `5f40fb2` — feat(expert-enroll): manual/bulk enroll+drop by EDU_EXPERT with catalog guide (prereq via enroll-engine) + override-with-reason + full audit (who/when/why); master switches enrollment window &amp; emergency withdraw; mig 0066
- `604c94c` — feat(authz): expert access scopes (uni/faculty/dept/major) + admin scopes page; rule-warnings panel (probation/tenure/finance) + council-ruling override w/ overriddenRules audit; conflicts (weekly/exam) shown &amp; gated; mig 0067-0069
- `248cf8f` — feat(authz): per-expert canEditGrades flag (scope page + grade action guard + graduated/inactive reason gate); apply expert scopes to admin student/staff listings
- `23fcb08` — feat(term): per-term activation for students (bulk via expert filters, tracked by/at) + optional enroll gate (ENFORCE_TERM_ACTIVATION); weekly board page printable (admin/expert, scoped) mig 0071
- `172b5f3` — fix(finance): column aliasing (StnO vs Stno) so uems TermAms maps correctly — full run relaunched
- `99c50d9` — feat(student): term ordinal derived from entry term (14032→N) in schedule + dashboard; schedulete-m sw default=effective term; RBAC custom roles now effective (permission cache loads all roles, module visibility + pages check permissions, students page opens with students:view_dossier); admin can edit entry year/term in student info form (mig entryDate); offering-editor tsc fixes
- `974643d` — feat(authz): admin layout lets custom roles with any permission enter /admin (their module guard still applies)
- `ace9362` — refactor(admin): consolidate code tooling into settings — code-hub tile groups مركز كدها + grade-status-codes + regulation-check (3 edu tiles off grid, still in nav); add group-transfer module to edu (agent-built)
- `2aeb3f0` — feat(reports): split report centers — edu (/admin/reports, tabs+search) and finance (/admin/finance/reports, own gate) with reports:edu/reports:finance center permissions (assert+allowed); chart.js/file-saver deps; fix term chip locale + ??/&amp;&amp; build errors
- `6a55d43` — feat(offering-editor): register module in admin registry (plan group, scheduling:manage_chart perm); gates accept custom roles with permission; add uems educational extract+migrate scripts (LT7/CSRUnit/LT51/LT52/LT55/SUS/history, entry-scoped chart)
- `dbd934f` — feat(security): P0 finance (POS void/sale atomic + canonical ledger balance), grade finalize lock + ownership + appeal fix, QR phase-0 sizes, tenant-pinning (server-side uni everywhere + cookie guards), login per-account throttle, idle SessionLock (setting-driven), grade step-up 2FA + live board + messenger alerts + prof notify, bulk force-password-change
- `e3f205c` — feat(grades): two-stage unfinalize workflow (professor request -&gt; stage-1 ADMIN/GRADUATEAFFAIRS -&gt; stage-2 VICE_EDU final approval), deadline/thesis badges in roster, audit pending-review UI with step-up; fix finance migration (dedupe index + batch commits + progress logs)
- `d56ab7e` — fix(exams): normalize legacy Gregorian exam_sessions dates to Jalali YYYY/MM/DD in admin workspace (contract is Shamsi; old rows were YYYY-MM-DD)
- `1f9cd42` — fix(rls): enable RLS on expert_scopes (self-read + admin-read policies) — migrator coverage gate stopped deploy
- `08b03df` — fix(messenger-poll): skip tokenless channels once (no per-minute warn spam), distinct http-status errors incl 409-conflict note, fix stale BALE-only comments
- `149802f` — fix(weekly-board): extract print button to Client Component — onClick in Server Component crashed /admin/weekly-board
- `8e4f882` — feat(weekly-board): per-classroom door-poster mode (room filter + big printable header), merged offerings collapsed like professor/student schedules (codes joined, enrolled summed, amber badge), print-hidden filter form
- `48ba379` — feat(weekly-board): print header shows faculty + term + classroom explicitly; landscape @page for door-poster mode
- `2e0f2e3` — feat(weekly-board): university logo (uni logoUrl, else UNIVERSITY_LOGO) on door-poster and board headers
- `7aa9195` — feat(weekly-board): calendar rowSpan blocks with exact from-to, prof honorifics (doctor for associate+, Mr/Ms by gender, firstname toggle via settings), uni-scoped deduped faculty filter, fail-closed empty scope, condensed poster header
- `ce466f0` — feat(weekly-board): prof/student schedule tabs (staff-code/student-number search, co-taught included, uni-scoped, printable) + smart header prefixes (no duplicate nimسال/daneshgah)
- `434b512` — fix(verify-rial): O(n^2) onlyOur loop via amsKeys Set (was re-scanning 95k TermAms rows per ledger key — hours of CPU)
- `cb97aac` — feat(weekly-board): drop explicit from-to line in blocks (position in hourly grid shows time)
- `ea56614` — feat(weekly-board): short-honorific toggle (خانم/آقای) + firstname toggle wired everywhere
- `a1046ec` — feat(weekly-board): engineer prefix for Morabi rank (uniform titles: doctor/engineer)
- `5f96ce0` — feat(weekly-board): unify board rendering on BoardGrid (stacked same-hour blocks, merged multi-titles, no headcount on door poster)
- `cf3e397` — feat(weekly-board): headcount screen-only (print:hidden, hidden on door poster print)
- `457a119` — fix(verify-rial): StnO header case -&gt; Stno (zero rows were matching)
- `2dd5ad3` — fix(weekly-board): smart prefix on main board header (no duplicate daneshgah)
- `6f1273a` — feat(weekly-board): 15-min calendar rows, rooms dropdown deduped + only rooms with classes + faculty-aware, single-faculty door poster (room faculty else mode), explicit same-day-only placement guard, fail-closed foreign room
- `aa678c4` — feat(weekly-board): reuse professor calendar grid for board/poster (placeMode professor, showCode toggle, merged groupLabel) + tighter print CSS

#### 2026-10-12 — ۲۴ کامیت

- `5ccaf7b` — fix(print): stop hiding last line of professor week card in print (was swallowing the professor-name line)
- `18a27aa` — feat(weekly-board): co-teacher fallback (single most-relevant) so professor name never blank; doorPrint block format (title/group+time/professor, no headcount) for door poster print
- `e76635f` — feat(weekly-board): co-teacher slot matching incl even/odd parity (chronological slot rank = teacher rank)
- `d40496c` — fix(security-integration): permission-cache invalidation on all role mutations, grade offering-uni + unfinalize NULL-uni hardening, backup otpHash redaction, 6-digit OTP UI
- `c790143` — feat(db): migration 0074 integrity constraints (partial unique tuition charge, payroll status check, ledgerTxnId FKs) + schema CHECK aligned to 15 ledger types
- `4ce5e64` — chore(deploy): pass AFAGH_OTP_PEPPER and BI_CRON_SECRET into app container
- `88f5dfa` — feat(finance): insert-tuition-bates script + verify includes TUITION_BATES in fees — rial diff now ZERO (49.38B reconciled)
- `7ef4f27` — feat(weekly-board): option to toggle Mr/Ms (جناب آقای / سرکار خانم) + shrink print font for professor name to fit perfectly
- `08dcc6b` — feat(weekly-board): default to short Mr/Ms (آقای/خانم) instead of جناب/سرکار for compact print
- `5f899ef` — feat(weekly-board): show student count on screen (next to course), hide in print, vertically center print card content
- `f70b5b0` — feat(weekly-board): optional student-count in print (toggle in filter form, default off) + schema TUITION_ADJUST type
- `df55311` — feat(finance): TUITION_ADJUST_DEC/INC ledger types + bates as credit (schema 0075 + ledger-balance)
- `ce6467f` — feat(finance): insert-tuition-adjust (DEC/INC from TSUMMab_Subject) + verify against TermAcc formula (pays-(fix+units)+bates+sub)
- `9b4eee1` — feat(weekly-board): larger course title in print (8.5pt) + single title for merged offerings
- `cce661e` — fix(finance): TUITION_ADJUST_DEC is debt (negative subject fee) + reports include bates/adjust; print cards vertically centered
- `b3e4a21` — fix(finance): worklist uses canonical DEBT/CREDIT vocab incl legacy tuition, bates and adjust discounts
- `0d7d609` — security: H1-H7 + M3-M9 fixes; tailscale lx.afagh.ac.ir config (BASE_URL, COOKIE_SECURE, ERP CORS)
- `92326c4` — fix(build): sync package-lock.json with zod dependency
- `7c2b354` — fix(proxy): restore missing quote in matcher (M-5 typo)
- `32d5017` — fix(auth): restore cookies + ensureBaseReferenceData imports dropped by M-7
- `0dc2ec6` — security(next): 8-agent hardening — session fixation+TTL+policy, React19 types, Zod routes, LMS header-only, cron secrets, object-scope default
- `587295d` — fix(build): revert xlsx to 0.18.5 (0.18.12 not in npm registry)
- `b1c8d44` — fix(build): sync lockfile after package.json security pins
- `4dce6ce` — fix(cron): add 3 new dedicated cron secrets to scheduler env

#### 2026-10-13 — ۲۸ کامیت

- `01aab62` — feat(directed-reading): offering type control with contract exclusion
- `d19696a` — fix(build): missing crypto and permission-cache imports
- `17cfcf2` — data(reference): add KODING legacy code lists + Pamtek reference catalog + standard-code mapping
- `eab7369` — fix(grade-thresholds): zod schema rejected the client payload (typecheck error)
- `fadce31` — fix(db): quote camelCase sortOrder in financial_terms ordering
- `aa72dc6` — fix(db): missing GROUP BY in virtual classes query
- `c29a8e6` — docs: architecture guide with real help screenshots
- `00b3c3f` — fix(db): make the migration chain work on an empty database (fresh deploy was impossible)
- `553dec5` — chore(scripts): demo session seeder for local/automated logins
- `b3cf287` — fix(help): remove broken 32MB enroll-2.png (1536x187713 full-page capture, Firefox decode spike)
- `203394e` — feat: missing modules from Sama guides (discipline, council, warnings, dorm, enrollment approvals+confirmation with QR, finance export/time-control) + teachersalary comparison
- `08390ad` — feat(finance-0081): welfare fund catalog + per-student tuition override
- `0c5ae2e` — feat(finance-stmt): official printable financial statement with QR verification
- `b345092` — feat(payroll): manual course merge + crowded tiers + 1-50 rate switch + objections (0083-0088)
- `0c69030` — merge(everywhere): manual merge wins in board+schedules+prints, per-slot merged cells with joint codes
- `25aa62e` — feat(payroll): readable formula vars (TH/PH/WH/UN/ST/RT/CF/BS/HR + legacy aliases) + rule-coverage view with miss diagnosis (0089-0092)
- `4e3fdd2` — fix(migrations): monotonic folderMillis for 0081+ so drizzle applies them (whens were colliding)
- `45fdbfa` — fix(payroll): repair brace imbalance in rate-resolution block; split warning constants into client-safe module
- `25a95d8` — fix(build): resolve 55 TS errors across new modules
- `805f444` — fix(ts): resolve final 6 type errors (dorm nullish input, welfare patch, rule partial schema, warnings log, approvals uni scope)
- `cfd3e0b` — fix(ts): dorm patch schema type (omit studentId)
- `37cc946` — fix(db): 0086 rule formula migration referenced nonexistent teaching_rules table
- `0af38bf` — fix(db): add RLS policies for 14 new tables (discipline, council, dorm, english approvals, warnings, tuition overrides, thesis, decrees, payroll extras, activities, cash extras, exam payments, objections, role defs)
- `5a8f14c` — fix(db): add 14 new tables to hardening.mjs RLS_TABLES checklist
- `30253fd` — feat(payroll): rewrite rules tab to expression system (variable palette + live validation + live test calc + card list)
- `76278ce` — fix(payroll rules tab): valid-formula guard, save-error rollback, dark-mode conformance
- `f5c4017` — feat(payroll): base-aware rate resolution in contract engine + rank/base/rate columns in live payroll table + seed 1405 approved rates (0093)
- `7c66447` — fix(ts): add dutyUnits to OverviewItem

#### 2026-10-14 — ۲۳ کامیت

- `e3ceb99` — fix(ts): hoist rateSource to PayrollOverviewItem, keep strict union type
- `8da34ef` — feat(payroll): teaching role catalog API (CRUD with in_use guard) + per-offering role override API + /admin/payroll/teaching-roles page + nav links
- `5e8cf27` — fix(payroll): rethrow NEXT_REDIRECT from requireRole instead of logging as error
- `803a7eb` — feat(payroll): show academic base in base-rates tab (violet badge / all-bases chip) + dynamic effective year
- `265ef9f` — fix(critical): requireRole returns SessionUser (truthy) - remove if(denied) crash on 6 pages; skip orphan staff in overview/coverage instead of killing whole term
- `ab644a4` — fix(ts): numeric columns as string in decree items insert
- `83dd4ad` — feat(payroll): decrees + thesis ledger + regulations + exam payments + objections pages with server actions
- `b73093d` — fix(ts): serialize decree dates in listAction
- `cdd7ccf` — fix(security): bind university boundary to session, not forgeable cookie
- `0995e3a` — fix(security): block self-service CREDIT forgery in student_ledger
- `bdea5c9` — fix(security): enforce real FINALIZED grade lock across all writers
- `ade357e` — fix(security): enforce CSRF gate on all write API routes
- `9835d10` — fix(security): peppered 6-digit HMAC OTP for grade-lock and contract signatures
- `bb6cbe8` — fix(security): wire the SSRF guard to every settings-driven outbound fetch
- `47f4358` — fix(release): twins collapse, README versions, fail-closed backup gate
- `809dd02` — fix(security): cron subsystem — POST dispatch, per-endpoint secrets, hardening
- `5db1680` — fix(security): harden telegram webhook to poll-channel standard + codeHash index
- `bc48321` — docs(env): document all per-endpoint cron secrets in .env.example
- `fbd3cd6` — fix(security): P2 hygiene wave — password policy, LIKE escaping, error masking, list caps
- `1cc5440` — fix(dark): remap white gradient stops so cards stay readable in dark mode
- `82031e7` — feat(help): top bar with back-to-panel link on all help pages
- `54b3290` — feat(help): payroll/finance/weekly-board guides, soft-redact screenshots, current login text
- `4323e16` — feat(help): regenerate role PDFs from print pages (payroll sections included)

#### 2026-10-15 — ۱۲ کامیت

- `de1feb9` — fix(offering-editor): scroll edit panel into view on open
- `effcca4` — feat(manual-enroll,migration,help): chart-scoped catalog + enrollment rules + curriculum import + admin help topics
- `ad81229` — feat(help): manual-enroll + curriculum-migration topics for print/PDF, real screenshots, admin.pdf (3 pages)
- `4c13dd3` — manual-enroll add entryTerm filter bulk activate session-lock single-search-auto
- `bc32ab2` — fix: clearSessionLock instead of setSessionLock in verifyOwnPasswordAction
- `78875d2` — session-lock: persist idle lock server-side (lockNowAction + initialLocked in layouts) so refresh cannot bypass
- `16f1179` — fix(tsc): import type BulkFilter in ManualEnrollClient
- `a955aad` — fix(tsc): wrap countBulk onClick handler
- `9fe3df5` — manual-enroll: cohort (سال+نیمسال ورود) filter + catalog redesign (own courses only, chart-first)
- `0ecdbdb` — curriculum: entry term (نیمسال ورود) resolution for charts + migration import
- `3282a42` — fix(tsc): entryTerm in chart page context, migration insert cast, test mocks
- `e4c52aa` — fix(tsc): drizzleLike entryTermId default null

#### 2026-10-16 — ۱۳ کامیت

- `b88d108` — finance: professional official-style FinancialTranscript in admin, student and statement views
- `008202e` — fix(tsc): restore faDigits import used by jdate helper
- `eb8f189` — finance: premium dashboard/report redesign + chronological transcript term order
- `2d89090` — finance: premium statement picker + unified finance headers + complete dark-mode mapping and print theme guard
- `08a8971` — finance transcript: official 3-column header with university logo + verify QR on admin views
- `9ad888a` — fix: restore finance-verify helper and QR block component files
- `46d6862` — fix: repair duplicated FinancialTranscript JSX and stray tag in academic transcript
- `17f78ad` — fix: remove assistant commentary from FinancialTranscript page
- `94fb658` — fix: remove leftover duplicate props from FinancialTranscript call
- `f4786c6` — fix: remove duplicate imports for finance-verify wiring
- `c261350` — finance transcript: per-course variable tuition breakdown in each term card
- `aa70010` — fix(scope): platform admin without home university sees all universities (unhide header switcher)
- `c814307` — finance(worktab): scope every KPI by active term; close deny-all university leak

#### 2026-10-17 — ۲۶ کامیت

- `fb9fa5a` — finance(tuition): load real SAMA/UEMS tariff + make per-course breakdown ledger-exact
- `70bd484` — test(tuition): cover university scoping and yearly fallback rules in the resolver
- `1c72642` — finance(tuition): reproduce the official per-course breakdown from SAMA's detailed tariff
- `a82c790` — finance(transcript): per-course breakdown is the official tariff itself, not an allocation
- `50bda79` — finance(tariff): SAMA rates are yearly, and a course without a Mali type costs zero
- `5c2cbb2` — finance(transcript): the stored SAMA amount is the document — tariff gives the weights
- `4b78244` — finance(tuition): summer terms charge half the fixed tuition (SAMA IsHalfTerm)
- `dabbdc2` — finance(transcript): one shared path for the per-course breakdown in every view
- `83f4b18` — finance(tuition): annual variable-tariff editor with copy-from-previous-year
- `6ba1b4b` — fix(students): show person photos in the admin students pages + journal migration 0096
- `2263c94` — fix(transcript): scan-safe QR block and three-column print for the financial transcript
- `d85b057` — feat(verify): online authenticity QR for the academic transcript
- `cac881a` — fix(verify): transcript token TTL is a known setting + never break on a missing setting
- `40c814d` — feat(students): authenticity QR in the admin transcript view
- `d41e9db` — feat(exams): proctor scans the exam-card QR to record attendance + printable student card with QR
- `adfc3a2` — fix(exams): exam-ticket verification 500 (date cast) + session/schedule date matching
- `54da8f1` — feat(exams): chain-of-custody QR handovers, manual staff presence, active-term fixes
- `d64c5c6` — fix(db): RLS for the new exam_session_staff_attendance table
- `ea4521f` — fix(exams): qualify the outer column in the handover page subqueries (ambiguous id)
- `2e9aafe` — feat(verify): photo + university emblem + full national id + per-term status on verification pages; fix transcript mismatch
- `5754b55` — fix(gpa): merge legacy grades into the official GPA so verification matches the printed transcript
- `b668380` — fix(gpa): read legacy course units from the catalog (the legacy units column is empty)
- `7c202ff` — security: server-authoritative idle lock + per-role timeout; login cross-browser fixes; scope guards (discipline/warnings), public PII masking, card-token lookup auth; remove public server-actions in src/lib
- `b631c4a` — fix(saham): official closed-list coding + entry/grad-term year format + military sheet for students; feat(samin): sample-graduates send; docs: pamtek stage-4 spec
- `ef420fd` — feat(saham): derive 'isThesis' from the current/selected term's thesis course (courses.isThesis) instead of always-null
- `b2f0941` — feat(saham): apply-filters button + stale-count invalidation + multi-university single-file export (authorized scope); isThesis per user-selected term; docs: dormitory entity fields

#### 2026-10-18 — ۲۸ کامیت

- `93f6c9d` — feat(verify): pin the exact student record inside every document QR (student code + uid + university)
- `5856385` — feat(transcript): let a multi-level graduate open each degree level's transcript (own QR per level)
- `ece388e` — feat(finance): multi-level students can open each degree level's financial statement
- `ec6f57d` — chore(security): ignore .env backups so a secret file can never be committed
- `c43e78f` — feat(verify): mask the national id on every verification page and add a "confirm by entering" check
- `82cf7ea` — chore(security): shorter verification-token TTLs, noindex/no-store on verification pages, and the remaining scope guards
- `22f1b28` — fix(finance): print the financial transcript with the academic transcript's print logic
- `302c373` — feat(reports): top students with three GPA bases, entry term, rank — plus a fail-closed university guard
- `5886667` — fix(reports): P0 data-correctness bugs — ledger vocabulary, weighted GPA, regulation-based probation and unit caps
- `66fc1fc` — fix(reports): apply the SHORT degree group's probation caps (کاردانی/کارشناسی ناپیوسته = ۲)
- `f625ce7` — fix(regulations): strip any provider prefix in maghtaGroup (HAMAVA- codes fell into LONG)
- `cf52ebf` — feat(reports): top-students filters matched to the legacy form (top-N, term range, gender, status, quota)
- `28c7bf4` — feat(reports): attendance list rebuilt to the legacy form (per student×course, filters, ordering, finance)
- `709b813` — feat(professor): printable "all sessions on one sheet" attendance form for the lecturer
- `441befb` — feat(sessions): class-session flags + audit stamps (migration 0101) and the real «مدیریت جلسات درس» page
- `e1f617c` — feat(reports): Jalali/money cell formatting everywhere + filters that were shown but ignored
- `ee5fb9f` — fix(session): the idle lock is now SET by the server (closing the tab no longer bypasses it) + merge the "class held" tick into the manual attendance page
- `cf3922b` — fix(scheduling): fail-closed university scope in the term-planning module
- `0e871ec` — fix(build): remove unguarded dead action and non-page export
- `5f64e22` — ci: run on FINAL and stop audit-actions reporting false positives
- `e550c60` — chore(deps): next 16.4.2, xlsx 0.20.3, source-map-js 1.2.2
- `b618e83` — docs: code review standard, design system, and CI baseline
- `dab3291` — ci(rls): create afagh_app role before migrate — 4 RLS migrations (0058/0061/0063/0099) create policies FOR … TO afagh_app and fail with 42704 on an empty CI database; hardening.mjs (idempotent) later sets password and grants
- `c61a60e` — docs(ci): record RLS root cause (role afagh_app missing before migrations) and the verified scratch-service run; correct the xlsx claim (generateXLSX has no call sites; Excel button is client-side CSV)
- `8528da0` — fix(student-cards): 504 in production — aggregate student_ledger once instead of a correlated subquery per student (48,361 students x 343,097 ledger rows, no index on studentId), and move search+pagination to the server (50/page) so the page stops shipping every student to the browser
- `f0ce51c` — fix(login): pre-hydration submit leaked credentials in the URL — form had no method, so a native submit sent GET /login?code=…&amp;password=… (browser history, access logs, Referer). Add method=post and keep the submit disabled until hydration
- `f64a799` — chore(deps)+db: drop xlsx entirely (its only consumer generateXLSX had no call sites) and add idx_student_ledger_student (migration 0102) — removes the cdn.sheetjs.com build dependency and indexes the column every ledger lookup filters on
- `6bc26df` — fix(security): scope /admin/student-cards by university — closes confirmed tenant leak

#### 2026-10-19 — ۳۴ کامیت

- `c3fe6d6` — docs(loadtest): گزارش و هارنس تست بار — انتخاب واحد، زنجیره امتحان، سقف مقطع
- `cde564d` — lt4(harness): افزودن سناریوی «ثبت وام» (A2) — شارژ ۵M + اعتبار LOAN ۵M → ثبت‌نام مجاز؛
- `1f5830a` — docs(loadtest): تست ۴ — افزودن سناریوی «ثبت وام» (A2) و مستندسازی قفل‌نبودنِ وسط انتخاب‌واحد
- `fee0c3f` — fix(enroll): اعمال هدف‌گیری ارائه (G1) + فیلتر isActive سبد (G4) + رفع FK گیت مالی (F1)
- `ed90d10` — fix(group-manager): گاردهای تداخل/اختیار برای ارائه، برنامهٔ هفتگی و کلاس‌ها (G2/G3/G5/G6/G7)
- `47327c5` — chore(scripts): تکمیل استاب‌های هارنس lt1/lt2/lt4 برای تایپ‌چک تمیز
- `c0fae08` — qa(gm1): هارنس تست روند ارائهٔ مدیر گروه روی استیجینگ — ۳۸/۳۸ پاس + استخراج مرجع یگانهٔ گاردها
- `f13ea447` — fix(ux): سوییچر واحد نقش/حساب، پایان نشست پس از غیبت طولانی، رفع ۴۰۴ تعویض دانشگاه/نیمسال
- `209e878` — fix(qa): بستن یافته‌های H1/H2/H3 — یکتایی DB، soft-drop سبد کهنه، اعتبارسنجی بازهٔ ورودی
- `37df6ab` — fix(print): keep transcript tables inside term cards
- `3a16445` — docs(qa): نتیجهٔ اجرای دوم gm1 روی استیجینگ — ۴۵/۴۵ پاس (دو اجرای متوالی)
- `56338d9` — fix(h1): ایندکس یکتای جزئی + ابزار رفع تکراری‌های ارائه (رفع ریسک مهاجرت تولید)
- `ed89cf1` — fix(print): keep only financial transcript fix; revert educational transcript changes
- `ed915cd` — feat(branding): نام/لوگو گواهی و salt از ENV؛ حذف universityId هاردکد؛ اسکریپت دانشگاه نمونه
- `0162a6d` — fix(security): phase1 hardening - XSS links, CSV injection, login/session, tenant scope, input validation, finance rules
- `99b7edb` — docs(digest): دیجست فشردهٔ جلسه — QA ارائه/ثبت‌نام + H1/H2/H3 + هاردنینگ مهاجرت
- `6a6ee58` — docs(digest): دیجست فشردهٔ جلسه — QA ارائه/ثبت‌نام + H1/H2/H3 + هاردنینگ مهاجرت
- `44979df` — fix(security): تکمیل اصلاحات فاز ۱ (تایپ‌چک: POS، خروج، دامنه دانشگاه، اسکریپت بار)
- `18dab41` — feat(print): کارنامهٔ مالی — چاپ عمودی A4، فشرده و کم‌مصرف
- `76bed69` — fix(security): close remaining phase-one API gaps
- `b9b2c7b` — fix(print): خلاصهٔ ترم در پایین کارت و سه‌قلم‌در‌سطر — چیدمان کارنامهٔ مالی
- `eae1178` — fix(security): phase2 infra hardening + phase3 data/PII/abuse controls
- `bedfd36` — fix(security): رفع خطاهای تایپ‌چک (mustChangePassword بولی، امضای audit)
- `926deed` — feat(print): سربرگ در هر صفحه، QR استعلام در چاپ، شمارهٔ دانشجویی و نیمسال ورود
- `8d7e760` — feat(print): عنوان کامل ترم در کارنامهٔ مالی — «نیمسال اول سال تحصیلی ۱۴۰۴-۱۴۰۵»
- `d50a1f5` — fix(security): کاهش سقف نشست به ۴ ساعت (قابل تنظیم با AFAGH_SESSION_MAX_HOURS)
- `1cb2486` — fix(security): فاز ۴ — تکمیل اعتبارسنجی، CSRF، مجوز، لاگ، پشتیبان، سکرت، فرانت‌اند، تست، مستندات
- `b6339a0` — fix(print): بازهٔ سال تحصیلی در عنوان ترم برعکس چاپ می‌شد (باگ bidi خط تیره)
- `11b92c3` — fix(security): رفع خطاهای تایپ‌چک فاز ۴ (unknown→number، sql import، castها)
- `e586f59` — fix(security): رفع خطاهای باقی‌مانده فاز ۴ (note cast, id unknown)
- `9047ccb` — merge(security): ادغام فازهای ۱ تا ۴ امنیتی در FINAL
- `77a1fe5` — fix(security): فاز ۵ — استقرار، مهاجرت PII، پایش، تست نفوذ، امنیت مستمر، مستندات
- `57b4da1` — fix(ui): سوییچر دانشگاه/نیمسال بدون جاوااسکریپت + راست‌چین‌کردن شمارهٔ دانشجویی + حذف نام هاردکد
- `73722eb` — fix(transcript): نام دانشگاه در کارنامهٔ تحصیلی از دیتابیس/تنظیمات، نه متن هاردکد

#### 2026-10-20 — ۳۶ کامیت

- `0ddeff2` — fix(requests): نام و آرم دانشگاه در گواهی چاپی از تنظیمات، نه متن هاردکد
- `58e5bcf` — fix(branding): حذف آخرین نام‌های هاردکد دانشگاه در ابلاغیه، فیش، بایگانی و کارت دانشجویی
- `f847ea3` — fix(reports): Jalali dates and money formatting on the remaining report families; course-level reports hide student filters they ignore
- `9a649f8` — feat(weekly-board): door sign header readable from a distance (large room name, wrapped lines, no truncation) and larger door print grid text
- `3e2bc53` — fix(weekly-board): remove duplicate 'کلاس' in door sign title; prevent card text overlap (min-height, gap, clamped title)
- `8883197` — fix(weekly-board): door print cards scale text to card width (no overlap in narrow parallel classes); drop 'استاد:' label in print
- `78a2bde` — fix(weekly-board): door print card text visible (fixed sizes, overflow visible, no clamp)
- `af63fec` — fix(weekly-board): door print card shows course name (8pt) + combined meta line; drop 'استاد:' label
- `57f1644` — fix(weekly-board): جا شدن نام درس در کارت‌ها و رفع رویهم‌افتادن متن در چاپ پوستر
- `eb93e2f` — revert(weekly-board): restore door sign print to original layout (user requested)
- `eba935c` — feat(curriculum): add print button + print-area to semester chart (terms side by side)
- `7d008e1` — feat(pii): safe-stage migration - Enc/BlindIndex columns + backfill (37,046 rows)
- `0fd0291` — fix(courses): add 'اصلی' to course type dropdowns (was merged into 'تخصصی')
- `7044b81` — fix(courses): افزودن ۱۲ کد SAMA به SAMA_TYPEMAP + حفظ نوع درس در مهاجرت UEMS
- `1a21064` — fix(curriculum): همیشه نمایش همهٔ نقش‌ها (از جمله اصلی) در جمع‌بندی نوع درس + اصلاح برچسب نقش در COURSE_TYPES_COMPLETE
- `d4be554` — feat(curriculum): add compensatory (جبرانی) toggle + summary row in CoursesTab
- `1157920` — feat(curriculum): clean print layout for term scheduling chart (hide pool, drag handles, controls)
- `24a3f0d` — feat(curriculum): show major/degree/entry-year in term-chart print header
- `c6a886b` — feat(curriculum): include degree code in term-chart header
- `c13ce9e` — feat(curriculum): جستجوی مستقیم کد/نام رشته در کاتالوگ
- `cca519e` — feat(curriculum): جمع‌بندی نوع درس + چک‌لیست تیک در چاپ چارت
- `663cbaf` — feat(student): چک‌لیست پیشرفت + دکمهٔ چاپ در چارت دانشجو
- `3eec784` — fix(curriculum): ترمیم JSX چاپ چارت (بستن تگ div استخر دروس)
- `4039b2a` — feat(enroll): پیشنهاد دروس بر اساس چارت سرفصل و ترم جاری دانشجو
- `dc0c365` — feat(weekly-board): سردر کلاسی مبتنی بر اتاق + QR حضور + بارکد + پایهٔ دادهٔ کلاس
- `700c106` — fix(drizzle): drop dangling 0108 journal entry (SQL never committed) so migrator chain stays 0106/0107
- `600c2ab` — feat(attendance): مسیر /p/room-* برای ثبت حضور استاد با اسکن QR سردر کلاسی
- `2374820` — feat(enroll/curriculum): compensatory units, honors, min/max, bypass workflow, prereq map, sanjesh importer
- `1236f3f` — fix(rls): enable RLS on enroll_bypass_requests for migrator hardening
- `6a0d49e` — feat(sanjesh): client-side PDF structure extractor (PDF -&gt; JSON)
- `7e76ac1` — fix(weekly-board): چاپ سردر کلاسی به برگهٔ جدا + حلِ اتاق از برنامهٔ هفتگی
- `6b7d907` — fix(door-sign): عنوان = نام کلاس، فونت تیتر، کادر بستهٔ جدول، QR بزرگ‌تر، کارت‌های بدون بُرش
- `e4c6216` — fix(door-sign): فونت Sahel برای تیتر و سرصفحه‌ها + آرم بزرگ‌تر + خط نیم‌ساعت
- `ebea76f` — feat(curriculum): مدیریت خوشه های هم ارزی و گسترش پیش نیاز
- `9958741` — fix(door-sign): یک برگ A4 افقی با یک دکمه، فونت Shabnam، نردبان اولویت متن
- `205f6d6` — fix(door-sign): نام استاد با ارتفاعِ کارت مقیاس می‌گیرد (بدون بُرش) + پدینگ فشرده‌تر

#### 2026-10-21 — ۴ کامیت

- `8b42da2` — fix(door-sign): سانس‌های هم‌زمانِ یک اتاق کنارِ هم می‌نشینند (نه روی هم)
- `5403da4` — fix(door-sign): بارکدِ خالی، تاریخِ میلادیِ پاصفحه، و عرضِ اسکن‌پذیر
- `0316931` — revert(curriculum): بازگشت طراحی کاتالوگ/ترم‌بندی به وضعیت ۶ مهر (9a054c5) و حذف تب نقشه پیش‌نیاز
- `242893d` — feat(weekly-board): پوستر سردر کلاسی — مدل ب، محور زمان قابل‌تنظیم، اصلاح ترازِ برچسب ساعت

#### 2026-10-22 — ۱۷ کامیت

- `baf1745` — fix(door-sign): سلسله‌مراتبِ کارت بر پایهٔ اولویت + فونتِ shrink-to-fit
- `ee17518` — feat(door-sign): shrink-to-fit واقعی برای عنوان درس
- `26ce3c4` — feat(admin): تخصیص کارشناس آموزش به کلاس — دو سطح (کلاس + نقش)
- `1148cd2` — feat(door-sign): سه حالتِ کارت (فقط درس / +استاد / +استاد+ساعت) + فونتِ محاسبه‌شده + محور ۸→۲۰
- `4dca59a` — feat(edu-expert-assign): ستونِ «کلاس (اتاق)» + فیلترِ «فقط کلاس‌های دارای برنامه»
- `c127323` — fix(door-sign): فونتِ استاندارد (بدونِ رشدِ خودکار) + اعمالِ سه حالت در چاپ
- `fc157d9` — fix(curriculum): await reloadDetail پس از افزودن گروهی + select-all روی ردیف‌های visible
- `ee8a5e3` — feat(edu-expert): یک کلاس، چند کارشناس آموزش (جدولِ واسط ۰۱۱۱)
- `1a3ae25` — merge: اتصالِ خطِ FINAL با کارهای پوسترِ سردر + تخصیص چندکارشناسهٔ آموزش
- `41f83c8` — feat(edu-expert): تخصیص بر پایهٔ اتاق — واحدِ واقعیِ مسئولیت (۰۱۱۲)
- `782e4fb` — feat(qr-room): نمایشِ برنامهٔ هفتگیِ اتاق روی صفحهٔ اسکنِ سردر
- `c8dffa9` — fix(qr-room): دکمهٔ ثبت حضور فقط وقتی جلسهٔ امروز واقعاً ساخته شده باشد
- `c61ca6a` — feat(qr-room): پیشنهادِ اتاق‌های هم‌نام وقتی این اتاق برنامه ندارد
- `9e7b474` — feat(attendance): نقش کنترل‌کنندهٔ حضور + ادغام تخصیص اتاق با مدیرگروه + رفع باگ فیلتر/تاریخ
- `f1eeb0c` — fix(edu-expert-assign): مرزِ دانشگاه + مقاومتی در برابر مهاجرتِ اجرا‌نشده + خوانایی انتخاب‌گرها
- `325f7fc` — docs: دیجست فشردهٔ جلسهٔ حضور و غیاب + تخصیص اتاق (۲۰۲۶-۱۰-۲۲)
- `3d77945` — fix(rls): فعال‌سازی RLS برای classroom_edu_experts و course_offering_edu_experts (رفع بلوکِ migrator)

#### 2026-10-23 — ۱۲ کامیت

- `e922ffc` — feat(mobile): لایه‌بندی چهارگانهٔ موبایل (A/B/C/D) + برندینگ دانشگاه
- `054486b` — feat(tuition): کارتابل «نوع درس مالی دروس» + رفع دو خطای مبلغ
- `01f3fff` — feat(scheduling): گزارش تداخل‌های واقعی برنامهٔ هفتگی + رفع/پذیرش توسط کارشناس
- `cf06398` — fix(mobile): پنل استاد موبایل‌محور + هدر ادمین تمیز
- `c24d2bf` — fix(mobile): تمیز شدن هدر پنل استاد در موبایل
- `f398a2c` — refactor(mobile): صفحهٔ اول استاد کاملاً کارتی + هدر یک‌ردیفه
- `237ca22` — mobile: professor-style headers (admin+professor) + snappy bottom tab bar
- `9164d93` — fix(student): بازسازی موبایل پنل دانشجو + رفع باگ‌های دادهٔ دانشجوی چندشماره‌ای
- `c125913` — test(student): همگام‌سازی تست سالن امتحانات با حذف پیش‌فرض جعلی
- `4e5295e` — feat(enroll): اعمال چارت تحصیلی در کاتالوگ انتخاب واحد + فیلتر بر اساس ترم دانشجو
- `af06c40` — fix(enroll): کاتالوگ انتخاب واحد در صورت عدم انتشار چارت تحصیلی خالی می‌شود
- `07178cc` — feat(enroll): کلید الزام چارت در انتخاب واحد + قانون ترم پایین‌تر/بالاتر + هدف‌گیری اجباری وقتی چارت لازم نیست

#### 2026-10-24 — ۸ کامیت

- `8ea95d6` — fix(hardening): جاروب عمومی RLS برای جدول‌های پشتیبان دستی دارای ستون هویتی (مثل enr_extra_backup_14051 و cee_dup_backup_14051) تا migrator قرمز نشود
- `41a76b2` — feat(grants): تخصیص درس ترم بالاتر توسط مدیر گروه (جدول student_course_grants + RLS + پنل group-manager + اعمال در اسکوپ انتخاب واحد)
- `de55157` — feat(evaluation): پنجرهٔ باز/بستهٔ ارزشیابی اساتید و کلاس‌ها — اعمال دورهٔ فعال در ثبت ارزشیابی + پنل مدیریت /admin/evaluations + نمایش وضعیت به دانشجو
- `2850b49` — feat(scheduling): نمایشِ گروهیِ تداخل‌ها + ادغام/پذیرشِ گروهی و اصلاحِ اولویتِ کارتابل پس از ورود
- `29acd20` — fix(student): ارم دانشگاه جای حرف «آ» در سربرگ + خوش‌آمدگویی و نام رشته به‌جای «کارتابل دانشجو» + برچسب کامل دکمه‌های نوار پایین موبایل
- `5d5ed72` — refactor(student): ادغام کارت هیروی سبز در سربرگ + حذف کارت‌های آماری تکراری با دسترسی سریع در داشبورد دانشجو
- `68ec2c6` — feat(attendance): کلاس ادغامی — یک ردیف برای ثبت، ثبت خودکار روی همهٔ عرضه‌ها
- `92e6638` — refactor(professor): ادغام کارت هیروی بنفش در سربرگ + حذف دکمه‌های تکراری با دسترسی سریع در کارتابل استاد

#### 2026-10-25 — ۱۴ کامیت

- `f6545c6` — fix(classrooms): جلوگیری از نویگیتِ صفحه پس از ذخیرهٔ کلاس
- `90875f1` — feat: افزودن «کد کلاس» و تک‌سطری‌کردن هدر پنل مدیریت
- `7730274` — fix(weekly-board): رفع اشکال فیلتر دانشکده/کلاس و پاسخ‌دهیِ سردر کلاسی به فیلترها
- `340cad8` — feat(admin/settings): افزودن فیلد «کد کلاس» + اصلاح نویگیت و بخشِ قابل‌جمع‌شدن
- `58f1456` — fix(admin/settings): باز بودنِ پیش‌فرضِ بخش کلاس‌ها تا ستون «کد» بلافاصله دیده شود
- `41305cb` — feat(mobile): بازطراحی موبایل‌اول کارتابل استاد و دانشجو
- `96eb0f7` — feat(pwa): نصب روی صفحهٔ اصلی + آفلاین سبک (manifest + service worker)
- `25da02a` — fix(mobile): رفع سرریز افقی سربرگ + انتقال کاشی‌های وضعیت از سربرگ به داشبورد
- `a2c55ce` — fix(ui): پنل سوییچر نیمسال در موبایل از لبهٔ راست باز شود
- `8544494` — feat(mobile): بازطراحی موبایل شاخهٔ مدیریت + مخفی‌کردن ویجت کلاس مجازی
- `bc11976` — fix(ui): پنل سوییچرها مستقیم زیر ردیف دکمه‌ها باز شود (نه شیت پایین صفحه)
- `5a15e13` — fix(admin): کد کلاس اولین ستون جدول اتاق‌ها + سرسطرهای هم‌تراز
- `2672e24` — style(admin/settings): فرم افزودن کلاس به گرید منظم تبدیل شد
- `f94a9c4` — feat(admin/settings): سورت و فیلتر ستون‌های کلاس‌ها + انتخاب چندگانه و عملیات گروهی


## دورهٔ ۲ — بازنویسی Go + React (۸۶ کامیت)

هر کامیت این دوره یک فاز یا برش مستقل است: فاز ۰ زیرساخت strangler، فاز ۱ auth، فاز ۲ کتابخانه‌های خالص با تست پارتی، فاز ۳ تا ۹ پورتال‌ها و استعلام‌های عمومی، فاز ۱۰ کرون/یکپارچه‌ها، فاز ۱۱ ممیزی و فاز ۱۲ در ۲۹ برش تکمیلی تا رسیدن به پاریتی کامل. نگاشت فاز به فایل‌ها و APIها در `docs/REWRITE-STATUS.md` است.

### 2026-10 — ۸۶ کامیت

#### 2026-10-25 — ۱ کامیت

- `808b9f4` — feat(rewrite): فاز ۰ — زیرساخت بازنویسی Go+React با الگوی strangler

#### 2026-10-26 — ۸ کامیت

- `6900187` — feat(rewrite): فاز ۱ — Auth و پوسته (ورود/تغییر رمز/قفل بیکاری/سوییچرها)
- `0236820` — feat(rewrite): فاز ۲ (۱/۴) — کتابخانه‌های خالص پایه در Go با تست پارتی
- `7aaa040` — feat(rewrite): فاز ۲ (۲/۴) — هستهٔ زمان‌بندی و تشخیص تداخل در Go
- `3a6caf9` — feat(rewrite): فاز ۲ (۳/۴ و ۴/۴) — معدل، شهریه و رمزنگاری PII در Go
- `561e26e` — feat(rewrite): فاز ۲ تکمیل شد — finance-rules در Go (تریگر پرداخت/کارنامه/چک)
- `6262513` — feat(rewrite): فاز ۳ (برش ۱) — برنامهٔ هفتگی دانشجو در Go + React
- `1cbb81a` — feat(rewrite): فاز ۳ (برش ۲) — داشبورد، کارنامه و کارت آزمون دانشجو
- `bdcbddf` — feat(rewrite): فاز ۳ (برش ۳) — انتخاب واحد کامل با موتور واتاق انتظار

#### 2026-10-27 — ۱۶ کامیت

- `68e2d5d` — feat(rewrite): فاز ۳ — تأییدیهٔ انتخاب واحد با QR امضاشده
- `541e67a` — feat(rewrite): فاز ۳ — کلاس مجازی، مدارک و طرح درس دانشجو
- `45ad42a` — feat(rewrite): فاز ۳ — میز خدمات و گردش‌کار درخواست‌های دانشجو
- `24b36c7` — feat(rewrite): فاز ۳ — کارنامهٔ مالی دانشجو با چک، وام و QR
- `7731f8a` — feat(rewrite): فاز ۳ — چارت درسی، مالی، فارغ‌التحصیلی و پایان‌نامه
- `be835a1` — feat(rewrite): فاز ۴ (برش ۱) — داشبورد، برنامه، قرارداد، اسناد، پیام کلاسی و ساعات حضور استاد
- `e6488ad` — feat(rewrite): فاز ۴ (برش ۲) — حضور و غیاب استاد
- `4bb63e9` — feat(rewrite): فاز ۴ (برش ۳) — نمرات، ارزشیابی، عملکرد و طرح درس استاد
- `a41076b` — feat(rewrite): فاز ۵ — پنل مدیر گروه
- `28576a7` — feat(rewrite): فاز ۶ (برش ۱) — داشبورد ادمین، دانشجویان، دانشکده‌ها و کارکنان
- `03ef30f` — feat(rewrite): فاز ۶ (برش ۲) — پنجرهٔ انتخاب واحد، هدف‌گیری ارائه‌ها و دوره‌های ارزشیابی
- `6fad225` — feat(rewrite): فاز ۶ (برش ۳) — تختهٔ هفتگی کلاس‌ها با فیلتر و چاپ
- `8effe50` — feat(rewrite): فاز ۶ (برش ۴) — تنظیمات سامانه با ذخیره/بازگشت به پیش‌فرض
- `f2f448e` — feat(rewrite): فاز ۶ (برش ۵) — کارتابل امتحانات: سشن، سالن، اتصال ارائه و تخصیص صندلی
- `5041b50` — feat(rewrite): فاز ۶ (برش ۶) — تأیید دستی حضور استاد و کارتابل کنترل تشکیل کلاس
- `1f35abe` — feat(rewrite): فاز ۷ (برش ۱) — کارتابل مالی ادمین + نوع درس مالی

#### 2026-10-28 — ۷ کامیت

- `0d9e004` — feat(rewrite): فاز ۷ (برش ۲) — موتور حق‌التدریس اساتید + زنجیرهٔ تأیید
- `6df651d` — feat(rewrite): فاز ۷ (برش ۳) — تعاریف موتور مالی + ترمینال POS
- `acb702b` — feat(rewrite): فاز ۸ (برش ۱) — کارتابل گردش کار + گذرگاه رویداد + موتور شهریه
- `e2bbb6b` — feat(rewrite): فاز ۸ (برش ۲) — کمیتهٔ انضباطی + شورای آموزشی
- `bc7220a` — feat(rewrite): فاز ۹ (برش ۱) — استعلام عمومی اسناد امضاشده (verify-*)
- `84b12e9` — feat(rewrite): فاز ۹ (برش ۲) — استعلام کارت دانشجویی، مدرک و گواهینامه
- `b1c1fa3` — feat(rewrite): فاز ۹ (برش ۳) — کاتالوگ و ثبت‌نام عمومی دوره‌های آزاد

#### 2026-10-29 — ۵ کامیت

- `faeae24` — feat(rewrite): فاز ۱۰ (برش ۱) — کرون‌جاب‌ها + ارسال چندکانالهٔ اعلان
- `d104c12` — feat(rewrite): فاز ۱۰ (برش ۲) — بایگانی الکترونیک مدارک (MinIO)
- `54d2933` — docs(rewrite): فاز ۱۱ — سند وضعیت و ممیزی پارتی + راهنمای سوییچ/بازنشستگی Next
- `120f761` — feat(rewrite): فاز ۱۲ (برش ۱) — سمتهای موظفی، نقشهای تدریس، نقش دستی ارائه، پوشش فرمول
- `20bd7d9` — feat(rewrite): فاز ۱۲ (برش ۲) — ابلاغ‌های آموزشی تدریس

#### 2026-10-30 — ۴۲ کامیت

- `562dffa` — feat(rewrite): فاز ۱۲ (برش ۳) — آیین‌نامه‌ها، اعتراض به فیش، فیش پورتال استاد
- `f220bee` — feat(rewrite): فاز ۱۲ (برش ۴) — پرداخت‌های امتحانی + دفتر پایان‌نامه
- `996e254` — feat(rewrite): فاز ۱۲ (برش ۵) — ضرایب نیمسال و مبالغ موضوعی با CRUD
- `05c1af6` — docs(rewrite): به‌روزرسانی وضعیت پس از فاز ۱۲ (حقوق تکمیلی + مالی ضرایب/مبالغ موضوعی)
- `b7398d2` — feat(rewrite): فاز ۱۲ (برش ۶) — کنترل زمانی ثبت مالی + فرمول ویژهٔ دانشجو
- `096b9a8` — feat(rewrite): فاز ۱۲ (برش ۷) — صندوق رفاه (صندوق‌ها و انتساب وام)
- `315d201` — docs(rewrite): به‌روزرسانی وضعیت پس از برش‌های ۶ و ۷ فاز ۱۲
- `44ad9fc` — feat(rewrite): فاز ۱۲ (برش ۸) — مرکز گزارش‌های مالی + صورت‌حساب/کارنامهٔ مالی دانشجو
- `5ac66f8` — docs(rewrite): ثبت برش ۸ فاز ۱۲ (گزارش‌های مالی + صورت‌حساب)
- `4da2e12` — feat(rewrite): فاز ۱۲ (برش ۹) — هشدارهای زمان‌بندی‌شده + کرون ارسال چندکاناله
- `eed697e` — feat(rewrite): فاز ۱۲ (برش ۱۰) — میز فارغ‌التحصیلی، تسویه موازی و صدور مدارک
- `db32533` — docs(rewrite): ثبت برش‌های ۹ و ۱۰ فاز ۱۲ (هشدارها و فارغ‌التحصیلی)
- `1821b3c` — feat(rewrite): فاز ۱۲ (برش ۱۱) — کارت دانشجویی (صدور/تمدید/ابطال/چاپ QR) + مسیر عکس
- `7822e89` — feat(rewrite): فاز ۱۲ (برش ۱۲) — پذیرش سنجش و کارت سکونت خوابگاه
- `333e691` — docs(rewrite): ثبت برش‌های ۱۱ و ۱۲ فاز ۱۲ (کارت دانشجویی، پذیرش، خوابگاه)
- `90253ee` — feat(rewrite): فاز ۱۲ (برش ۱۳) — تأیید انتخاب واحد و صدور تأییدیهٔ انتخاب واحد
- `de80183` — feat(rewrite): فاز ۱۲ (برش ۱۴) — ادغام دروس و خوشه‌های هم‌ارز
- `ae45bf2` — feat(rewrite): فاز ۱۲ (برش ۱۵) — ثبت‌نام دستی کارشناس (تک/دسته‌جمعی) با گیت‌های آیین‌نامه
- `25bdebc` — feat(rewrite): فاز ۱۲ (برش ۱۶) — انتقال دانشجو بین گروه‌های یک درس
- `c6f0a9d` — docs(rewrite): ثبت برش‌های ۱۳ تا ۱۶ فاز ۱۲ (تأیید/ثبت دستی/ادغام/انتقال)
- `618b6b6` — feat(rewrite): فاز ۱۲ (برش ۱۷) — موتور شهریه و تعرفهٔ سالانهٔ متغیر (UI کامل)
- `92201d4` — feat(rewrite): فاز ۱۲ (برش ۱۸) — میز برنامه‌ریزی و ثبت نتیجهٔ دفاع پایان‌نامه
- `43a31a6` — feat(admin): دوره‌های آزاد — تعریف دوره، شرکت‌کننده، واریز، نمره، گواهینامه با استعلام عمومی
- `e562a54` — feat(admin): پایش طرح درس، بررسی آیین‌نامه سما و تأیید دومرحله‌ای
- `4669579` — feat(admin): مدیریت دروس و کدهای وضعیت نمره
- `4c86a1b` — feat(admin): داشبورد هوش تجاری ارزشیابی (BI)
- `e498ecb` — feat(admin): درون‌ریزی رشتهٔ قبلی از فایل ثابت‌عرض سنجش
- `bb70e03` — feat(admin): مرکز گزارش‌های آموزشی (هستهٔ ۱۶ گزارش)
- `4602e3d` — feat(reports): گزارش‌های کلاس/فضا و فهرست‌های تکمیلی
- `1496606` — feat(reports): گزارش‌های امتحانات و اساتید
- `7ecd825` — feat(reports): گزارش‌های وضعیت و عملیات دانشجو
- `55955c4` — feat(reports): گزارش‌های پروپوزال و دفاع
- `35b6701` — feat(reports): شورای آموزشی و گواهی‌ها
- `f8cafd1` — docs: به‌روزرسانی فهرست باقی‌ماندهٔ مرکز گزارش‌ها
- `253eeea` — feat(reports): تکمیل خانواده‌های باقی‌ماندهٔ مرکز گزارش‌ها
- `985896e` — feat(admin): کاشی‌های دسته‌بندی /admin/c/[group]
- `a7bef81` — feat(admin): سرفصل/برنامهٔ درسی (کاتالوگ) + کاشی‌های دسته‌بندی
- `0cc7b4f` — feat(admin): قالب‌های اعلان + پیام آزمایشی
- `b3ec197` — feat: پیام‌رسان (اتصال/توکن/poll worker)، کرون‌های باقی‌مانده و صفحات عمومی
- `3e92917` — feat(admin): مرکز کدها — فهرست/آمار/ویرایش ردیف/CSV
- `d737612` — feat(admin): مهاجرت داده + گزارش سهام + هاب ثمین
- `36ada50` — docs(status): فهرست Next خالی شد — پایان فاز ۱۲، آمادهٔ فاز ۱۳

#### 2026-10-31 — ۷ کامیت

- `796c329` — feat(admin): صفحات کوچک باقیمانده + مسیرهای alias
- `3945bd9` — feat(admin): سوئیت برنامه‌ریزی، آیین‌نامه‌ها و تخصیص کارشناس آموزشی
- `fb8733c` — feat(admin): ۶ صفحهٔ آخر — پیام همگانی، bypass، جلسات کلاس، تحویل امتحان، ویرایشگر ارائه، رفع تداخل
- `08cb52b` — docs(status): ممیزی نهایی پارتی — ۱۴۵ مسیر Next صفر جامانده، مهاجرت کامل
- `446e5da` — feat: صفحهٔ عمومی تحویل اوراق امتحان + شبیه‌ساز حقوق
- `59a04ac` — docs(status): افزودن تاریخچهٔ کامل ۸۵ کامیت مهاجرت (۴۴۵ فایل، +۱۳۵ هزار خط)
- `2aebfce` — docs(status): آمار دقیق خطوط و فایل‌های مهاجرت

## آخرین کامیت‌ها — ترجمهٔ انگلیسی (پس از `2aebfce`)

| بازه | کامیت‌ها | فایل‌ها | خطوط |
|---|---:|---:|---:|
| `2aebfce..eaadb5c` | ۶ | ۲۴ | +۴٬۳۳۹ / −۲۵۸ |

| # | کامیت | تاریخ | موضوع فارسی (اصلی) | English subject |
|---|---|---|---|---|
| ۱ | `66d6064` | 2026-11-01 | docs: تاریخچهٔ کامل ۱٬۰۰۱ کامیت مخزن (دورهٔ Next.js + بازنویسی) | docs: complete history of 1,001 commits (Next.js era + Go/React rewrite) |
| ۲ | `783f8ac` | 2026-11-01 | feat: مدیر کلاس‌های تنظیمات ادمین + نوار پایین موبایل (پورت کامیت‌های پایانی Next) | feat: admin settings classroom manager + mobile bottom navigation (port of the final Next.js commits) |
| ۳ | `1c4ed58` | 2026-11-01 | feat(admin): غنی‌سازی سوئیت برنامه‌ریزی و مرکز آیین‌نامه‌ها + ترمیم توالی | feat(admin): richer scheduling suite and regulations center + sequence repair |
| ۴ | `11df4b9` | 2026-11-01 | feat(mobile): کاشی‌های ماژول ادمین در سه ستون موبایل (هم‌راستا با Next) | feat(mobile): three-column admin module tiles on mobile (aligned with Next.js) |
| ۵ | `cff768f` | 2026-11-01 | feat(admin): پیشنهاد هوشمند زمان‌بندی + سقف واحدها و فرم حضور استاد | feat(admin): scheduling smart suggestions + weekly unit caps and professor availability form |
| ۶ | `eaadb5c` | 2026-11-01 | fix(security): اسکوپ دانشگاه، حذف بدون مسابقه، سخت‌سازی ورودی و پاک‌سازی با مستندات انگلیسی | fix(security): university scoping, race-free classroom deletion, input hardening, and cleanup with English documentation |

### نتیجهٔ بررسی این ۶ کامیت

- هر شش کامیت بازبینی شدند؛ تاریخچه/پیام اصلی دست‌نخورده ماند و ترجمه فقط در همین سند ثبت شد.
- کامیت‌های `783f8ac`، `1c4ed58` و `cff768f` با فراخوانی واقعی API و بررسی مرورگری (مدیر کلاس‌ها، نوار موبایل، تب‌های برنامه‌ریزی و آیین‌نامه) تست شدند.
- کامیت `eaadb5c` شامل رفع اسکوپ دانشگاه، حذف بدون مسابقه، سخت‌سازی ورودی/خطا و تست‌های واحد است؛ جزئیات در [`docs/CODE-REVIEW-2026-11-01.md`](./CODE-REVIEW-2026-11-01.md).
- در زمان ثبت این بخش: `go vet`/`go test` و `tsc`/`vite build`/۲۸ تست Vitest سبز بودند و هیچ فایل تغییرنیافتهٔ ثبت‌نشده وجود نداشت.
