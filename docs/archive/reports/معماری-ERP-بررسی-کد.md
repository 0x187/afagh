# بررسی معماری کد — سامانه جامع آموزشی دانشگاه آفاق (فاز صفر / ERP)

> **مسیر:** `afagh/afagh-erp` — پشته: Node.js خالص + SQLite (better-sqlite3، جایگزین نود: `node:sqlite`) — بدون هیچ وابستگی خارجی دیگر
> **اصل بنیادین (از README):** هیچ قانون آموزشی/اداری در کد هاردکد نشده؛ همهٔ قوانین از جداول داده خوانده می‌شوند. تغییر قوانین = تغییر داده، نه استقرار مجدد.

---

## ۱. نمای کلی

| مؤلفه | حجم | نقش |
|---|---|---|
| `src/db/schema.sql` | ۸۵۰ خط، ۷۳ جدول | اسکیمای ۱۲ لایه + ویو `v_student_balance` |
| `src/db/seed.js` | ۸۳۶ خط | دادهٔ سناریومحور (قوانین، دروس، دانشجویان دمو، BPM، مالی) |
| `src/db/index.js` | ~۱۱۰ خط | اتصال SQLite + Proxy خودکار + scrypt |
| `src/server.js` | ۷۴۷ خط | HTTP خالص + ~۸۰ مسیر REST API + زمان‌بندهای پس‌زمینه |
| `src/engines/*` | ۱۳ موتور (~۳,۳۰۰ خط) | منطق دامنه |
| `public/index.html` | تک‌فایل RTL | پنل وب کامل (بدون CDN) |
| `scripts/stress.js` | ۱۹۵ خط | تست بار ۲۰۰۰ کاربر همزمان |

**طراحی کلیدی:** دو بخش بودن (سرور / پنل)، USهیچ فریم‌ورکی استفاده نشده — هم صفر وابستگی (به استثنای بهتر-اس‌کیولایت) و هم «مطابق سند طراحی» برای مهاجرت به PostgreSQL/Next.js در فاز بعد (`afagh-next/`).

---

## ۲. لایه‌های دوازده‌گانهٔ داده (schema.sql)

```
لایه ۰  → roles / permissions / role_permissions / users / user_roles / sessions        (RBAC داده‌محور)
لایه ۱  → degree_level_configs / faculties / departments / majors / sanjesh_mappings /
           admissions_staging / student_id_formulas / students / staff                    (هسته هویتی)
لایه ۲  → educational_regulations (.rulesConfig JSON)                                      (آیین‌نامه‌ها = داده)
لایه ۳  → courses / syllabuses / syllabus_courses / course_rules (.logicTree JSON)        (چارت + درخت پیش‌نیاز)
لایه ۴  → academic_terms / classrooms / course_offerings / offering_professors /
           schedules / professor_availabilities                                           (ترم و ارائه)
لایه ۵  → cart_items / enrollments / grade_appeals / grade_submission_otps /
           transcript_snapshots                                                           (انتخاب واحد + نمرات)
لایه ۶  → evaluation_periods / evaluation_forms / evaluation_questions / question_options /
           form_assignments / evaluation_responses                                        (ارزشیابی گمنام)
لایه ۷  → process_definitions / process_steps / process_transitions / student_requests /
           request_step_logs                                                              (BPM + SLA)
لایه ۸  → term_financial_rules / student_ledger / financial_clearances                     (مالی)
لایه ۹  → exam_halls / exam_sessions / seat_allocations / invigilators                     (امتحانات)
لایه ۱۰ → teaching_rates / teaching_coefficients / payroll_calculation_rules /
           professor_term_contracts / payroll_statements / class_sessions /
           student_class_attendance / professor_class_attendance / physical_access_logs /
           electronic_documents / document_signatures / verification_otps                  (حق‌التدریس + حضور و غیاب + E-Sign)
لایه ۱۱ → military_service_records / document_categories / document_types /
           student_documents / kyc_verifications                                           (سخا + بایگانی)
لایه ۱۲ → notification_templates / notifications / audit_logs / system_settings            (پیام + امنیت)
```

**نکتهٔ فنی:** فیلدهای JSONB طرح اصلی اینجا `TEXT` با محتوای JSON هستند و با `json_extract`/`JSON.parse` خوانده می‌شوند — مهاجرت مستقیم به PostgreSQL. ایندکس‌گذاری جدول‌های داغ (enrollments, schedules, financial_clearances) + `busy_timeout=5000` + `synchronous=NORMAL` + صفحه‌کش ۳۲MB با WAL برای بار بالا.

---

## ۳. `db/index.js` — نکات معماری

- **Proxy هوشمند:** `db` یک `Proxy` است که اگر فایل DB از بیرون جایگزین شود (مثلاً `npm run reset` حین فعال‌بودن سرور)، اتصال خودکار به فایل جدید بازمی‌گردد (بررسی inode حداکثر هر ۵۰۰ms) → سرور نیازی به ری‌استارت ندارد.
- **scrypt با هزینهٔ قابل تنظیم:** `AFAGH_SCRYPT_N` (پیش‌فرض 16384)؛ تأیید رمز **async** روی threadpool لایب‌یو (`UV_THREADPOOL_SIZE=8`) تا ۲۰۰۰ ورود همزمان event-loop را بلاک نکند. تأیید با `timingSafeEqual` (ضد timing attack). هزینهٔ عمدی CPU-بر = ضد بروت‌فورس.
- **پشتیبانی دوبل:** اگر better-sqlite3 نصب نشود، خودکار به `node:sqlite` (Node 22+) سوییچ می‌کند — نیاز به کامپایلر C++ نیست.
- **تراکنش‌ها:** `tx(fn)` — همهٔ عملیات چندمرحله‌ای (ثبت سبد، گردش کار، پرداخت) در `BEGIN/COMMIT/ROLLBACK` انجام می‌شوند.

---

## ۴. `server.js` — الگوهای سرور

۱. **~۸۰ مسیر REST** دستی (بدون فریم‌ورک): `auth` (Bearer/Cookie/QueryString)، `readBody` (سقف ۱MB)، `json()`.
۲. **زمان‌بندهای پس‌زمینه `.unref()`:**
   - هر ۶۰ ثانیه: `runSlaSweeper` (BPM) + `runGradeSlaSweeper` (ددلاین نمرات) + `finalizeExpiredAbsences` (غیبت امتحان) + `runDrDeadlineSweeper` (معرفی به استاد) + `runExpirySweeper` (سخا)
   - هر ۵ دقیقه: `runCorrelation` (موتور تطبیق حضور استاد)
   - **الگو:** همهٔ «کارهای زمان‌دار» به‌صورت data-driven (SLAها از DB خوانده می‌شوند)، نه هاردکد.
3. **سوآپ مهاجرت:** اگر DB خالی باشد، `seed` خودکار اجرا می‌شود.
4. **سه دستهٔ API:** `/api/prof/*` (استاد)، `/api/admin/*` (مدیریت)، `/api/integrations/*` (وب‌هوک گیت اثر انگشت، وب‌هوک سخا) + مسیرهای دانشجو/متقاضی.

---

## ۵. موتور آیین‌نامه‌ها (`regulations.js`) — مغز سیستم

- **قاعده = داده:** هر دانشجو به `educational_regulations.rulesConfig` (JSON) متصل است؛ چارچوب:
  ```json
  {
    "regular_term_rules": { "minUnits": 12, "maxUnits": 20, "probationMaxUnits": 14, "gpaAMaxUnits": 24 },
    "summer_term_rules": { "defaultMaxUnits": 6, "graduatingMaxUnits": 10 },
    "graduating_term_rules": { "canTakeWithProbation": true, "maxUnits": 24 },
    "quota_overrides": { "SHAHED_ISARGAR": { ... } },
    "failed_course_gpa_policy": "KEEP_ALWAYS" | "EXCLUDE_IF_PASSED",
    "probation_gpa_threshold": 12, "max_allowed_probations": 3, "max_study_semesters": 8, "gpaA_threshold": 17
  }
  ```
- **ترتیب اعمال سقف واحد (مطابق سند):** پایه → مشروطی → معدل الف → ترم آخر → تابستان → سهمیه (Override) — خروجی `{minUnits, maxUnits, reasons[]}` که دلیل هر تصمیم را هم برمی‌گرداند (شفافیت برای دانشجو).
- **تشخیص ترم آخر:** `minTotalUnitsToGraduate - passedUnits <= 8` — از سیلابس نسخه‌بندی‌شدهٔ دانشجو.
- **سیاست نمره ردی:** `KEEP_ALWAYS` (آیین‌نامه ۱۳۹۰: ردی در معدل می‌ماند حتی پس از قبولی) در برابر `EXCLUDE_IF_PASSED` (سیاست ۱۴۰۳) — هر دو با دادهٔ جدول، نه if در کد → سناریوی دموی «حسن».

---

## ۶. خط لولهٔ پنج‌فیلتری انتخاب واحد (`enrollment.js`) — قلب سیستم

```
submitEnrollment(studentId, offeringIds, {allowCouncil})   ← همه در یک تراکنش
```

| # | فیلتر | نوع خطا | منطق |
|---|---|---|---|
| ۱ | **گیت مالی (علی‌الحساب)** | سخت | `financial_clearances` — بدون تسویه، سبد اصلاً باز نمی‌شود |
| ۲ | وضعیت/بازه/تکرار درس + **ظرفیت (اتمیک)** | سخت | ظرفیت با `enrolledCount` (شمارنده) + لیست انتظار جدا |
| ۳ | **سقف واحد** (در سطح کل سبد) | سخت | از `getUnitLimits` موتور آیین‌نامه‌ها |
| ۴ | **درخت پیش‌نیاز AND/OR** | نرم | `course_rules.logicTree` با `evaluateLogicTree` بازگشتی + حد قبولی ویژه (مثلاً ۱۲ در چارت ۱۴۰۳) |
| ۵ | **تداخل کلاس و امتحان** | نرم | `overlaps()` + مقایسهٔ تاریخ/ساعت امتحان‌ها |

**خطاهای نرم → شورا:** اگر `allowCouncil` فعال باشد، به‌جای رد، `PENDING_COUNCIL` ثبت و پروندهٔ گردش کار `PREREQ_WAIVER` با کد رهگیری `AF-XXXXXX` ساخته می‌شود؛ پس از تأیید نهایی، ثبت + صدور وجه **تراکنشی** انجام می‌شود.

**Waitlist رتبه‌ای:** موقعیت از `COUNT(WAITLISTED)+1`؛ در `dropEnrollment` → بازپرداخت CREDIT به دفتر کل → **ارتقای خودکار نفر بعد** + اعلان از `notification_templates` (قالب پویا با جایگزینی `{vars}`).

**Silent Billing:** هزینهٔ متغیر (`perUnitTuition × units` از `term_financial_rules`) در `student_ledger` ثبت می‌شود ولی انتخاб واحد را مسدود نمی‌کند (بدهی پنهان برای گلوگاه‌های مالی فاز بعد).

---

## ۷. موتور BPM داده‌محور (`workflow.js`)

- **توصیف فرآیند = داده:** `process_definitions` → `process_steps` (نقش مسئول + `slaHours` + `timeoutAction`) → `process_transitions` (اقدام مجاز هر مرحله).
- **کارتابل:** `getInbox({roleCode, staffId})` — هر ردیف `slaState` محاسبه می‌کند: `ON_TIME / WARNING (<20%) / BREACHED`.
- **اقدام:** `actOnRequest` — تراکنشی؛ مدت‌اقامت و `slaStatus` در `request_step_logs` ثبت می‌شود → **مبنای KPI و MTTR** (گلوگاه‌ها).
- **SLA Sweeper:** هر ۶۰ ثانیه، مراحل منقضی را طبق `timeoutAction` پردازش می‌کند: `ESCALATE` (مدیر گروه ۱۲h) / `AUTO_REJECT` / `AUTO_APPROVE` / `NOTIFY` (معاون 24h) — دکمهٔ اجرای دستی هم در صفحهٔ KPI هست.

---

## ۸. چرخهٔ حیات نمره (`grades.js`)

```
PENDING → DRAFT → TEMPORARY → APPEALED → FINALIZED
```

| قابلیت | مکانیزم |
|---|---|
| **گیت ارزشیابی** | بدون فرم گمنام، دانشجو نمره را نمی‌بیند؛ پاسخ‌ها بدون ارجاع به دانشجو ذخیره می‌شوند |
| **اعتراض BPM** | به کارتابل استاد؛ مهلت `professorAppealSlaDays`؛ تایم‌اوت → قطعی خودکار + گزارش به مدیر گروه |
| **OTP نهایی‌سازی** | ۵ رقمی، ۲ دقیقه اعتبار، ۳ تلاش؛ تلاش سوم = قفل + هشدار امنیتی (سطح بانکی) |
| **امضای دیجیتال** | SHA-256 کل لیست فریز می‌شود؛ `verify-grades` در پنل مدیر، دستکاری مستقیم DB را فوراً کشف می‌کند |
| **بستن ترم خودکار** | اسنپ‌شات کارنامه + `evaluateEndOfTerm` (مشروطی/اتمام سنوات → `BLOCKED_COMMISSION` + کمیسیون) |
| **ددلاین هوشمند** | یادآور ۷۲h و ۲۴h؛ گذشت مهلت → ارجاع به مدیر گروه |

---

## ۹. موتور امتحانات (`exams.js`) — چیدمان سه‌فازی ضدتقلب

1. **گروه‌بندی ساختاریافته:** بلوک بر اساس کد استاد → کد درس → شماره گروه (برگه‌ها مرتب در روز امتحان)
2. **درهم‌سازی:** Fisher-Yates داخل هر بلوک (دوستان هم‌درس کنار هم نمی‌نشینند)
3. **استراتژی فیزیکی:** عادی (پشت‌سرهم) / زوج‌فرد (بلوک اول صندلی فرد) / یک‌درمیان (زیگزاگ)

- **کارت ورود به جلسه = سه گلوگاه:** تراز مالی صفر + ارزشیابی کامل اساتید + صندلی تخصیص‌یافته → چاپ با سالن/صندلی/بارکد.
- **غیبت سیستمی:** پیامک قالب `EXAM_ABSENCE` با مهلت ۴۸ ساعته → درخواست موجه در کارتابل کارشناس → تأیید = حذف درس / رد = `unexcused_absence_policy` (نمره صفر قطعی) + بستن خودکار ترم.

---

## ۱۰. حضور و غیاب + قرارداد الکترونیک (`attendance.js`)

- **جلسات ۱۶گانه** خودکار از برنامهٔ هفتگی + شماره جلسه + جلسهٔ جبرانی (`isMakeUpSession`).
- **تأیید غیرمستقیم حضور استاد:** ثبت فیش حضور و غیاب در بازهٔ کلاس ← جلسه `HELD` + رکورد `ROLL_CALL`.
- **Geofencing:** ثبت فقط از رنج IP های شبکهٔ دانشگاه (`system_settings.CAMPUS_IP_RANGES` — داده‌محور)؛ خارج از ساعت (+۵ دقیقه) → `FLAGGED_SUSPICIOUS`.
- **موتور تطبیق هوشمند:** ① Chain Matching (کلاس قبلی با وقفه ≤۳۰ دقیقه → `CHAIN_CONTINUITY`) ← ② پانچ گیت اثر انگشت در پنجره [۶۰− تا ۱۵+ دقیقه] ← ③ کارتابل «نیازمند بازبینی».
- **گلوگاه قرارداد:** بدون امضای الکترونیکی ترم، لیست حضور و غیاب باز نمی‌شود. E-Sign: قالبِ سند فریزشده + هش SHA-256 + OTP → ثبت زمان/IP/دستگاه (Non-repudiation).

---

## ۱۱. مالی: فیش حقوقی + فرمول‌ساز (`payroll.js` + `payRules.js`)

- **قوانین داده‌محور:** `payroll_calculation_rules` — فرمول‌ساز از پنل مدیر (CRUD + ممیزی).
- **سه نوع فرمول:** ضریب واحد (نرخ×واحد×ضریب — راهنما ×۱.۵) / ضریب دانشجو (×دانشجو×ضریب — ممتحن ×۰.۳۳) / مقطوع (داور دفاع ۲.۵M).
- **تطبیق خاص‌ترین قاعده:** نوع ارائه × نقش استاد × مرتبه؛ قواعد عمومی مجاز نیستند.
- **چند-نقشی:** احمدی راهنما (۸.۵۵M) + کاظمی مشاور (۱.۸۶M) + رضایی داور (۲.۵M) از `offering_professors.role`.
- **ابلاغیهٔ سه‌بخشی:** برنامهٔ هفتگی + فعالیت‌های پژوهشی + برآورد ریالی → کارتابل استاد → امضای OTP.
- **سناریوی بخشنامه:** تغییر یک عدد (۰.۵→۱.۰) ← برآورد و فیش بازمحاسبه‌شده.

---

## ۱۲. ماژول‌های مرزی (معرفی به استاد / سخا / بایگانی)

- **Micro-Offering (`directedReading.js`):** بررسی هوشمند شرایط (آستانهٔ فارغ‌التحصیلی + سقف ۲ درس/۴ واحد) ← جادوی تک‌تراکنش (کلاس ایزوله با ظرفیت ۱، نقش EXAMINER، ثبت قطعی بدون صف، Silent Billing) ← ددلاین مستقل نمرهٔ ۲۰ روزه + یادآور پیامکی از ۷ روز مانده.
- **سخا (`sakha.js`):** کارتابل سه‌صندوقی (ثبت‌نام جدید / تمدید سنوات / ابطال) + گلوگاه مالی («اولین فیلتر نیت واقعی») + چرخهٔ تمدید با نظارت انسانی (پیش‌نویس خودکار → ارسال → وب‌هوک) + شمارشگر قرمز ≤۳۰ روز + قفل انتخاب واحد در روز انقضا (`BLOCKED_MILITARY`) و بازگشایی خودکار با وب‌هوک.
- **بایگانی (`archive.js`):** تزریق قبولی (رمز = کد ملی) ← ویزارد ۴ گامی متقاضی ← e-KYC سه‌لایه (شاهکار/ثبت احوال/لایونس، آستانه ۹۰/۷۰ درصد) ← صدور شمارهٔ دانشجویی از فرمول‌ساز `{Year:2}{Degree}{Major:3}{Seq:3}` ← زونکن دیجیتال با RBAC پوشه‌ای + **واترمارک** (کارشناس|تاریخ|IP) در هر مشاهده.

---

## ۱۳. امنیت (`rbac.js`)

- **دسترسی داده‌محور:** نقش‌ها/دسترسی‌ها جدول‌اند، نه هاردکد؛ گیت‌ها در هر route با `rbac.hasPermission`.
- **Audit Trail غیرقابل تغییر (زنجیرهٔ هش):** هر رکورد `hash = sha256(JSON{...prevHash, t})` — مثل بلاک‌چین؛ دستکاری سوابق گذشته فوراً با شکستن زنجیره کشف می‌شود.
- احراز هویت با توکن ۶۴-هگز session (اعتبار ۲ روز) + log همهٔ رویدادهای حساس (LOGIN، DR_CREATED، MILITARY_*، ARCHIVE_DOC_VIEWED).

---

## ۱۴. جمع‌بندی نقاط قوت و نکات

**نقاط قوت:**
- معماری «قانون = داده» واقعاً پیاده شده: تغییر آیین‌نامه، فرمول مالی یا فرآیند بدون دیپلوی.
- صفر وابستگی سنگین؛ قابل اجرا روی سخت‌افزار حداقلی؛ پشتیبان `node:sqlite` برای Node 22+.
- سناریوهای دموی هدفمند با قابلیت تست E2E زنده (هر ۱۱ سناریو در README مستند است).
- جداسازی صحیح: hard error (مسدود) vs soft error (شورا/گردش کار) — الگوی درست برای سیستم آموزشی.
- عملکرد: p95 ثبت سبد ۳۴ms در همزمانی ۲۵۰ / توان ۲۸۹ درخواست بر ثانیه در آذرخش ۲۰۰۰تایی.

**نکات/بدهی فنی (واقع‌بینانه):**
- مسیرهای API به‌صورت یک `api()` بزرگ با if/else — برای فاز بعد که ماژول‌ها زیاد می‌شوند می‌تواند به روتینگ جدولی یا Express/Fastify مهاجرت کند.
- اسکیمای ۷۳ جدولی در فایل SQL کوه‌مانند است؛ برای نگهداری بهتر است به فایل‌های migration شکسته شود (در `afagh-next` با Drizzle این کار انجام شده).
- زمان‌بندها داخل همان process سرور هستند (`setInterval.unref()`)؛ در پروداکشن چند‌اینستنسی باید به job queue/Redis مهاجرت کنند (طرح خودش اتاق انتظار Redis را برای فاز بعد پیش‌بینی کرده).
- `public/index.html` تک‌فایل بزرگ RTL است — نگهداری‌پذیر برای فاز صفر، ولی Next.js مسیر نهایی است.

**مسیر بعدی (طبق سند):** همان مدل داده در `afagh-next/` (Next.js 14 + PostgreSQL/Drizzle + Redis + MinIO + RLS) نگاشت مستقیم دارد — schema.sql فعلی «Drizzle Design → SQLite» است.
