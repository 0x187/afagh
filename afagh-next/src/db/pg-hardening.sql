-- ════════════════════════════════════════════════════════════════════
--  سخت‌سازی PostgreSQL — پس از drizzle-kit push (سند §۲۰۹۳–۲۲۴۰)
--   ① ایندکس‌های جداول داغ  ② پارتیشن‌بندی ترمی  ③ امنیت سطح-ردیف RLS
--   ④ آرشیو سرد  ⑤ نگهداشت خودکار
-- ════════════════════════════════════════════════════════════════════

-- ① ایندکس‌های داغ (آینهٔ فاز صفر + کاربردهای کالبد)
CREATE INDEX IF NOT EXISTS idx_enr_student_pg ON "enrollments"("studentId");
CREATE INDEX IF NOT EXISTS idx_enr_offering_pg ON "enrollments"("offeringId");
CREATE INDEX IF NOT EXISTS idx_off_term_pg ON "course_offerings"("termId");
CREATE INDEX IF NOT EXISTS idx_sched_offering_pg ON "schedules"("offeringId");
CREATE INDEX IF NOT EXISTS idx_sessions_user_pg ON "sessions"("userId");
CREATE INDEX IF NOT EXISTS idx_notif_user_pg ON "notifications"("userId");
CREATE INDEX IF NOT EXISTS idx_docs_staff_pg ON "electronic_documents"("staffId");
CREATE INDEX IF NOT EXISTS idx_req_status_pg ON "student_requests"("status");
CREATE INDEX IF NOT EXISTS idx_att_session_pg ON "student_class_attendance"("sessionId");

-- ② پارتیشن‌بندی ترمی (سند §۲۰۹۹) — الگو برای جداول حجیم:
--    در پروداکشن، enrollments/student_class_attendance به صورت LIST/TABLE partition
--    روی termId ساخته می‌شوند؛ نمونهٔ الگو:
-- CREATE TABLE enrollments (...) PARTITION BY RANGE ("termId");
-- CREATE TABLE enrollments_14051 PARTITION OF enrollments FOR VALUES FROM (2) TO (3);

-- ③ امنیت سطح-ردیف — RLS (سند §۲۱۷۰) — نسخهٔ ۳: ماتریس کامل داده‌های حساس
-- ════════════════════════════════════════════════════════════════════════
--  اصول (پاسخ به بازبینی مهندسی — «RLS فقط چهار جدول» دیگر کافی نیست):
--   • نقش afagh_app فقط از مسیر withUserRls استفاده می‌شود (set_config در همان
--     تراکنش)؛ نبودِ app.user_id → هیچ ردیفی دیده نمی‌شود.
--   • هر جدول دادهٔ شخصی/مالی/آموزشی → RLS فعال + سیاست «فقط ردیف خود کاربر».
--   • جداول دارای راز/بایگانی (system_settings با کلیدهای cron، integrations_config
--     با اعتبارنامه‌ها، audit_logs و…) → RLS فعال بدون سیاست = deny-all برای نقش اپ.
--   • نوشتن فقط با گرنت ستونی: دانشجو می‌تواند status و waitlistPosition را تغییر
--     دهد، اما نه gradeValue/approvedBy/… → Mass Assignment در سطح دیتابیس قفل شد.
--   • مالک (afagh) BYPASSRLS است؛ داشبوردهای مدیریتی/BI بدون تغییر کار می‌کنند.
-- ════════════════════════════════════════════════════════════════════════

-- ── نقش اپلیکیشن (idempotent) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afagh_app') THEN
    CREATE ROLE afagh_app LOGIN PASSWORD '__AFAGH_APP_PASSWORD__' NOSUPERUSER NOBYPASSRLS;
  ELSE
    -- P0-1: چرخش رمز باید واقعاً اعمال شود. پیش از این اگر نقش از قبل بود، رمزِ
    -- .env روی نقش نمی‌نشست؛ یعنی «رمز را عوض کردیم» فقط روی کاغذ بود و
    -- اپلیکیشن با رمز قدسی (یا ضعیفِ پیشین) به دیتابیس وصل می‌شد/می‌شد و شکست.
    ALTER ROLE afagh_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '__AFAGH_APP_PASSWORD__';
  END IF;
END $$;
-- __AFAGH_DB__ توسط scripts/hardening.mjs از DATABASE_URL پر می‌شود
-- (پیش از این «afagh_db» هاردکد بود و هر نصبی با نام دیتابیس دیگر در گام سخت‌سازی می‌شکست)
GRANT CONNECT ON DATABASE "__AFAGH_DB__" TO afagh_app;
GRANT USAGE ON SCHEMA public TO afagh_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO afagh_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO afagh_app;

-- ══ ۱) فعال‌سازی RLS روی همهٔ جداول دادهٔ حساس ══
--    (بدون ENABLE، سیاست‌ها بی‌اثرند؛ لیست بر اساس ماتریس طبقه‌بندی داده)
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "students" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cart_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transcript_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_clearances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "seat_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_class_attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "military_service_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kyc_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "grade_appeals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "grade_objections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "grade_submission_otps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doc_sign_otps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "professor_term_contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "professor_class_attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "professor_exam_attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "electronic_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_statements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_minutes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "physical_access_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "request_step_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "request_parallel_checkpoints" ENABLE ROW LEVEL SECURITY;

-- ══ ۲) deny-all: جداول راز/بایگانی — RLS بدون سیاست + REVOKE صریح ══
--    app role هرگز نباید این‌ها را ببیند (کلیدهای cron، اعتبارنامه‌ها، لاگ‌ها،
--    دادهٔ خام پذیرش، پاسخ‌های ارزشیابی بدون کلید کاربر).
REVOKE SELECT ON "system_settings", "integrations_config", "audit_logs", "api_audit_logs",
             "admissions_staging", "person_source_identities", "sanjesh_mappings", "evaluation_responses",
             "verification_otps", "step_api_actions", "document_signatures",
             "curriculum_approvals",
             "sanjesh_templates", "sanjesh_files", "sanjesh_file_fields",
             "sanjesh_file_rows", "sanjesh_value_maps"
  FROM afagh_app;
ALTER TABLE "system_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integrations_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admissions_staging" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_source_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sanjesh_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evaluation_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_otps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "step_api_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_signatures" ENABLE ROW LEVEL SECURITY;
-- چرخهٔ تأیید برنامهٔ درسی: دفتر ممیزیِ فقط-مالک (بدون سیاست = deny-all برای نقش اپ)
ALTER TABLE "curriculum_approvals" ENABLE ROW LEVEL SECURITY;
-- ماژول سازمان سنجش (مهاجرت 0128): دادهٔ خام داوطلبان = PII کامل ⇒ deny-all
ALTER TABLE "sanjesh_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sanjesh_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sanjesh_file_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sanjesh_file_rows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sanjesh_value_maps" ENABLE ROW LEVEL SECURITY;

-- جداول پشتیبان دستیِ اطلاعات شخصی (مثل enr_extra_backup_14051 که با studentId ساخته
-- شده‌اند): اگر موجود باشند RLS می‌گیرند (بدون سیاست = deny-all برای نقش اپ) تا چک
-- پوششِ hardening قرمز نشود. روی نصب تازه وجود ندارند → بلوک بی‌اثر است.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname LIKE 'enr\_extra\_backup\_%'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ══ ۳) سیاست‌های خواندن (SELECT) — تعریف مشترک uid ══
-- uid = nullif(current_setting('app.user_id', true), '')::int
--    (نبودِ تنظیم → NULL → استفاده در مقایسه FALSE → صفر ردیف)

DROP POLICY IF EXISTS users_self_read ON "users";
CREATE POLICY users_self_read ON "users" FOR SELECT TO afagh_app
  USING ("id" = nullif(current_setting('app.user_id', true), '')::int);

DROP POLICY IF EXISTS students_self_read ON "students";
CREATE POLICY students_self_read ON "students" FOR SELECT TO afagh_app
  USING ("userId" = nullif(current_setting('app.user_id', true), '')::int);

DROP POLICY IF EXISTS staff_self_read ON "staff";
CREATE POLICY staff_self_read ON "staff" FOR SELECT TO afagh_app
  USING ("userId" = nullif(current_setting('app.user_id', true), '')::int);

DROP POLICY IF EXISTS sessions_self_read ON "sessions";
CREATE POLICY sessions_self_read ON "sessions" FOR SELECT TO afagh_app
  USING ("userId" = nullif(current_setting('app.user_id', true), '')::int);

-- (الگوی مشترک: سطرهای دانشجویی → از طریق students؛ سطرهای کارکنان → از طریق staff)
DROP POLICY IF EXISTS transcript_self_read ON "transcript_snapshots";
CREATE POLICY transcript_self_read ON "transcript_snapshots" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS ledger_self_read ON "student_ledger";
CREATE POLICY ledger_self_read ON "student_ledger" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS clearance_self_read ON "financial_clearances";
CREATE POLICY clearance_self_read ON "financial_clearances" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS seat_self_read ON "seat_allocations";
CREATE POLICY seat_self_read ON "seat_allocations" FOR SELECT TO afagh_app
  USING ("enrollmentId" IN (SELECT e."id" FROM "enrollments" e
    JOIN "students" s ON s."id" = e."studentId"
    WHERE s."userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS attendance_self_read ON "student_class_attendance";
CREATE POLICY attendance_self_read ON "student_class_attendance" FOR SELECT TO afagh_app
  USING ("enrollmentId" IN (SELECT e."id" FROM "enrollments" e
    JOIN "students" s ON s."id" = e."studentId"
    WHERE s."userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS doc_self_read ON "student_documents";
CREATE POLICY doc_self_read ON "student_documents" FOR SELECT TO afagh_app
  USING ("personUserId" = nullif(current_setting('app.user_id', true), '')::int);

DROP POLICY IF EXISTS military_self_read ON "military_service_records";
CREATE POLICY military_self_read ON "military_service_records" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS kyc_self_read ON "kyc_verifications";
CREATE POLICY kyc_self_read ON "kyc_verifications" FOR SELECT TO afagh_app
  USING ("userId" = nullif(current_setting('app.user_id', true), '')::int);

DROP POLICY IF EXISTS appeal_self_read ON "grade_appeals";
CREATE POLICY appeal_self_read ON "grade_appeals" FOR SELECT TO afagh_app
  USING ("enrollmentId" IN (SELECT e."id" FROM "enrollments" e
    JOIN "students" s ON s."id" = e."studentId"
    WHERE s."userId" = nullif(current_setting('app.user_id', true), '')::int));

-- اعتراض به نمره (grade_objections): دانشجو فقط اعتراض‌های خودش را می‌بیند.
-- درج/به‌روزرسانی از نقش مالک (مسیر owner db، BYPASSRLS) انجام می‌شود —
-- همانند grade_appeals؛ پس فقط سیاست خواندنِ خود-دانشجو کافی است.
DROP POLICY IF EXISTS objection_self_read ON "grade_objections";
CREATE POLICY objection_self_read ON "grade_objections" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

-- ── کارکنان: ردیف‌های مرتبط با خودشان ──
DROP POLICY IF EXISTS gsotp_self_read ON "grade_submission_otps";
CREATE POLICY gsotp_self_read ON "grade_submission_otps" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS dsotp_self_read ON "doc_sign_otps";
CREATE POLICY dsotp_self_read ON "doc_sign_otps" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS contract_self_read ON "professor_term_contracts";
CREATE POLICY contract_self_read ON "professor_term_contracts" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS pclass_self_read ON "professor_class_attendance";
CREATE POLICY pclass_self_read ON "professor_class_attendance" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

-- حضور مراقب/استاد در جلسهٔ امتحان: خودِ شخص + نقش‌های مجاز (مراقب/کارشناس/مدیر)
ALTER TABLE "exam_session_staff_attendance" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exam_staff_att_read ON "exam_session_staff_attendance";
CREATE POLICY exam_staff_att_read ON "exam_session_staff_attendance" FOR SELECT TO afagh_app
  USING (
    "staffId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
    OR EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
               WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
                 AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'VICE_EDU', 'PROCTOR', 'VAULT_MANAGER'))
  );
DROP POLICY IF EXISTS exam_staff_att_ins ON "exam_session_staff_attendance";
CREATE POLICY exam_staff_att_ins ON "exam_session_staff_attendance" FOR INSERT TO afagh_app
  WITH CHECK (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
                      WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
                        AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'PROCTOR')));
DROP POLICY IF EXISTS exam_staff_att_upd ON "exam_session_staff_attendance";
CREATE POLICY exam_staff_att_upd ON "exam_session_staff_attendance" FOR UPDATE TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
                 WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
                   AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'PROCTOR')))
  WITH CHECK (true);

DROP POLICY IF EXISTS pexam_self_read ON "professor_exam_attendance";
CREATE POLICY pexam_self_read ON "professor_exam_attendance" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS edoc_self_read ON "electronic_documents";
CREATE POLICY edoc_self_read ON "electronic_documents" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS payroll_self_read ON "payroll_statements";
CREATE POLICY payroll_self_read ON "payroll_statements" FOR SELECT TO afagh_app
  USING ("contractId" IN (SELECT c."id" FROM "professor_term_contracts" c
    JOIN "staff" st ON st."id" = c."staffId"
    WHERE st."userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS minutes_self_read ON "exam_minutes";
CREATE POLICY minutes_self_read ON "exam_minutes" FOR SELECT TO afagh_app
  USING ("supervisorStaffId" IN (SELECT "id" FROM "staff"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS accesslog_self_read ON "physical_access_logs";
CREATE POLICY accesslog_self_read ON "physical_access_logs" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS reqlog_self_read ON "request_step_logs";
CREATE POLICY reqlog_self_read ON "request_step_logs" FOR SELECT TO afagh_app
  USING ("requestId" IN (SELECT r."id" FROM "student_requests" r
    JOIN "students" s ON s."id" = r."studentId"
    WHERE s."userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS checkpoint_self_read ON "request_parallel_checkpoints";
CREATE POLICY checkpoint_self_read ON "request_parallel_checkpoints" FOR SELECT TO afagh_app
  USING ("requestId" IN (SELECT r."id" FROM "student_requests" r
    JOIN "students" s ON s."id" = r."studentId"
    WHERE s."userId" = nullif(current_setting('app.user_id', true), '')::int));

-- ══ ۴) نوشتن تحت RLS: سیاست‌ها + گرنت ستونی (ضد Mass Assignment) ══
-- دانشجو فقط این ستون‌ها را می‌تواند عوض کند؛ gradeValue/approvedBy/financial…
-- از نقش اپ غیرقابل نوشتن‌اند (گرنت ستونی + سیاست ردیف).
GRANT INSERT ON "enrollments" TO afagh_app;
GRANT UPDATE ("status", "waitlistPosition") ON "enrollments" TO afagh_app;
GRANT INSERT, DELETE ON "cart_items" TO afagh_app;
GRANT INSERT ON "notifications" TO afagh_app;
-- student_requests: هیچ مسیری از نقش اپ نمی‌نویسد (همه از نقش مالک) → revoke
REVOKE INSERT, UPDATE ON "student_requests" FROM afagh_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO afagh_app;   -- serialها برای INSERT

DROP POLICY IF EXISTS enroll_self_read ON "enrollments";
CREATE POLICY enroll_self_read ON "enrollments" FOR SELECT TO afagh_app USING (
  "studentId" IN (SELECT "id" FROM "students"
                  WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
);
DROP POLICY IF EXISTS enroll_self_ins ON "enrollments";
CREATE POLICY enroll_self_ins ON "enrollments" FOR INSERT TO afagh_app
  WITH CHECK ("studentId" IN (SELECT "id" FROM "students"
                              WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));
DROP POLICY IF EXISTS enroll_self_upd ON "enrollments";
CREATE POLICY enroll_self_upd ON "enrollments" FOR UPDATE TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students"
                         WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int))
  WITH CHECK ("studentId" IN (SELECT "id" FROM "students"
                              WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

-- RLS برای درخواست‌های بدون رعایت پیش‌نیاز/تداخل امتحانی (پوشش کامل migrator)
ALTER TABLE "enroll_bypass_requests" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bypass_app_access ON "enroll_bypass_requests";
CREATE POLICY bypass_app_access ON "enroll_bypass_requests" FOR ALL TO afagh_app
  USING (nullif(current_setting('app.user_id', true), '') IS NOT NULL)
  WITH CHECK (nullif(current_setting('app.user_id', true), '') IS NOT NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON "enroll_bypass_requests" TO afagh_app;

DROP POLICY IF EXISTS cart_self_read ON "cart_items";
CREATE POLICY cart_self_read ON "cart_items" FOR SELECT TO afagh_app USING (
  "studentId" IN (SELECT "id" FROM "students"
                  WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
);
DROP POLICY IF EXISTS cart_self_ins ON "cart_items";
CREATE POLICY cart_self_ins ON "cart_items" FOR INSERT TO afagh_app
  WITH CHECK ("studentId" IN (SELECT "id" FROM "students"
                              WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));
DROP POLICY IF EXISTS cart_self_del ON "cart_items";
CREATE POLICY cart_self_del ON "cart_items" FOR DELETE TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students"
                         WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

DROP POLICY IF EXISTS notif_self_read ON "notifications";
CREATE POLICY notif_self_read ON "notifications" FOR SELECT TO afagh_app USING (
  "userId" = nullif(current_setting('app.user_id', true), '')::int
);
DROP POLICY IF EXISTS notif_self_ins ON "notifications";
CREATE POLICY notif_self_ins ON "notifications" FOR INSERT TO afagh_app
  WITH CHECK ("userId" = nullif(current_setting('app.user_id', true), '')::int);

DROP POLICY IF EXISTS request_self_read ON "student_requests";
CREATE POLICY request_self_read ON "student_requests" FOR SELECT TO afagh_app USING (
  "studentId" IN (SELECT "id" FROM "students"
                  WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
);

-- الگوی استفاده در اپ: appDb.transaction → set_config('app.user_id', <uid>, true) → کوئری
-- (set_config با is_local=true فقط در همان تراکنش می‌ماند — امن در استخر اتصال؛
--  گسترش مسیرهای خواندنِ دانشجو/استاد به باUserRls گام بعدی است — فعلاً نوشتن‌ها تحت RLS و
--  خواندن‌ها با اسکوپ صریح در لایهٔ اپ + این آزمون‌های CI)

-- ④ آرشیو سرد (سند §۲۱۰۲): انتقال ترم‌های قدیمی به دیتابیس ارزان‌تر
--    INSERT INTO archive_db.enrollments SELECT * FROM enrollments WHERE "termId" < ...;
--    DELETE FROM enrollments WHERE ...;

-- ⑤ نگهداشت: VACUUM FULL در ساعات کم‌ترافیک + حذف ایندکس‌های بدون استفاده (سند §۲۱۳۰)
-- cron: 0 3 * * 6  psql -c 'VACUUM (ANALYZE, VERBOSE);'

-- ⑥ قیدهای یکتایی که در schema.ts تعریف شده‌اند
--    `drizzle-kit push` این قیدهای نام‌دار را همیشه نمی‌سازد، ولی کد اپ در چند
--    مسیر (ثبت درس تطبیق‌شده، کانال‌های اعلان) به `ON CONFLICT` روی همین ستون‌ها
--    تکیه می‌کند؛ نبودِ قید = خطای 42P10 در زمان اجرا. اینجا idempotent ساخته
--    می‌شوند و پیش از آن، ردیفهای تکراریِ احتمالی پاک می‌شوند.
DELETE FROM "enrollments" a USING "enrollments" b
 WHERE a.id > b.id AND a."studentId" = b."studentId" AND a."offeringId" = b."offeringId";
ALTER TABLE "enrollments" DROP CONSTRAINT IF EXISTS "uq_enrollments";
ALTER TABLE "enrollments" ADD CONSTRAINT "uq_enrollments" UNIQUE ("studentId", "offeringId");

DELETE FROM "notification_channels" a USING "notification_channels" b
 WHERE a.id > b.id AND a."userId" = b."userId" AND a.channel = b.channel;
ALTER TABLE "notification_channels" DROP CONSTRAINT IF EXISTS "uq_notification_channels";
ALTER TABLE "notification_channels" ADD CONSTRAINT "uq_notification_channels" UNIQUE ("userId", channel);

-- ⑦ ایندکس‌های گزارش‌های هوش تجاری (BI)
--    موتور bi-engine روی «همهٔ پاسخ‌ها × همهٔ اساتید/کلاس‌ها» کوئری تجمیعی
--    می‌زند (GROUP BY)؛ بدون این ایندکس‌ها هر بار Seq Scan روی
--    evaluation_responses و schedules انجام می‌شود. idempotent هستند.
CREATE INDEX IF NOT EXISTS "idx_eval_resp_period_offering" ON "evaluation_responses" ("periodId", "offeringId");
CREATE INDEX IF NOT EXISTS "idx_eval_resp_question"        ON "evaluation_responses" ("questionId");
CREATE INDEX IF NOT EXISTS "idx_eval_resp_offering"        ON "evaluation_responses" ("offeringId");
CREATE INDEX IF NOT EXISTS "idx_eval_q_form_axis"          ON "evaluation_questions" ("formId", "axisLabel");
CREATE INDEX IF NOT EXISTS "idx_schedules_room_type"       ON "schedules" ("roomId", "scheduleType");
CREATE INDEX IF NOT EXISTS "idx_offering_prof_role"        ON "offering_professors" ("role", "staffId");
CREATE INDEX IF NOT EXISTS "idx_analytics_snapshots_type"  ON "analytics_snapshots" ("reportType");


-- ════════════════════════════════════════════════════════════════════════
--  ⑧ تکمیل پوشش RLS — ۲۱ جدول هویتی/مالی باقی‌مانده (بازبینی ۴)
--
--  ماتریس اولیه ۳۸ جدول را پوشش می‌داد؛ این جدول‌ها بعداً به اسکیما اضافه
--  شدند و بدون RLS بودند → نقش اپ (afagh_app) می‌توانست کل ستون‌های آن‌ها را
--  بدون محدودیت بخواند. اینجا برای هر یک: ENABLE ROW LEVEL SECURITY + پالیسی
--  self-read (همان الگوی بخش ③). جدول‌های بدون مالکیت مشخص (legacy_code_maps)
--  با deny-all صریح بسته می‌شوند. همهٔ دستورها idempotent‌اند.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE "payment_cheques" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_cheques_self_read ON "payment_cheques";
CREATE POLICY payment_cheques_self_read ON "payment_cheques" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

-- ── جدول‌های مالی جدید (میگریشن 0041) ────────────────────────────────────
-- گیت پوشش RLS هر جدولی که ستون studentId دارد را ملزم می‌کند RLS داشته باشد.
ALTER TABLE "payment_transactions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_transactions_self_read ON "payment_transactions";
CREATE POLICY payment_transactions_self_read ON "payment_transactions" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "pos_transactions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_transactions_self_read ON "pos_transactions";
CREATE POLICY pos_transactions_self_read ON "pos_transactions" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "student_discounts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS student_discounts_self_read ON "student_discounts";
CREATE POLICY student_discounts_self_read ON "student_discounts" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "student_sponsorships" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS student_sponsorships_self_read ON "student_sponsorships";
CREATE POLICY student_sponsorships_self_read ON "student_sponsorships" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "student_loans" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS student_loans_self_read ON "student_loans";
CREATE POLICY student_loans_self_read ON "student_loans" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "student_cards" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS student_cards_self_read ON "student_cards";
CREATE POLICY student_cards_self_read ON "student_cards" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "student_term_states" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS student_term_states_self_read ON "student_term_states";
CREATE POLICY student_term_states_self_read ON "student_term_states" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "clearance_checklist" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clearance_checklist_self_read ON "clearance_checklist";
CREATE POLICY clearance_checklist_self_read ON "clearance_checklist" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "issued_degrees" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS issued_degrees_self_read ON "issued_degrees";
CREATE POLICY issued_degrees_self_read ON "issued_degrees" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "exam_attendances" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exam_attendances_self_read ON "exam_attendances";
CREATE POLICY exam_attendances_self_read ON "exam_attendances" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "graduation_audits" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS graduation_audits_self_read ON "graduation_audits";
CREATE POLICY graduation_audits_self_read ON "graduation_audits" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

-- Thesis Progress Tracking RLS
ALTER TABLE "thesis_progress" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS thesis_progress_self_read ON "thesis_progress";
CREATE POLICY thesis_progress_self_read ON "thesis_progress" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

-- Professor (supervisor/advisor) can read thesis progress for their students
DROP POLICY IF EXISTS thesis_progress_supervisor_read ON "thesis_progress";
CREATE POLICY thesis_progress_supervisor_read ON "thesis_progress" FOR SELECT TO afagh_app
  USING (("supervisorId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int))
      OR ("advisorId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)));

-- ── الگوی «مدیر/کارشناس همه را می‌بیند» ──
--    کارشناس از روی دادهٔ واقعیِ نقش‌ها تشخیص داده می‌شود (user_roles ⋈ roles.code) —
--    دقیقاً همان زنجیره‌ای که auth.ts:78-88 برای SessionUser.roles می‌خواند.
--    دلیل این تغییر: app.user_role هیچ‌جا ست نمی‌شد (فقط همین فایل به آن اشاره داشت)
--    → current_setting(...,true) مقدار NULL می‌داد → NULL IN (...) مقدار NULL
--    → سیاست همیشه FALSE → مدیر/کارشناس صفر ردیف می‌دید.
--    app.user_id تنها GUCی است که withUserRls (src/db/index.ts:102) در همان تراکنش
--    می‌نویسد؛ نبودِ آن → uid NULL → EXISTS صفر → همچنان fail-closed.
--    نکته: user_roles خودش RLS فعال دارد و سیاستش روی همین userId است، پس این
--    زیرپرسمان فقط نقش‌های خودِ کاربر جاری را می‌بیند (بازگشتِ بی‌نهایت هم ندارد).
DROP POLICY IF EXISTS thesis_progress_admin_read ON "thesis_progress";
CREATE POLICY thesis_progress_admin_read ON "thesis_progress" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT')));

ALTER TABLE "thesis_progress_reports" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS thesis_reports_self_read ON "thesis_progress_reports";
CREATE POLICY thesis_reports_self_read ON "thesis_progress_reports" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

-- Supervisor can read/confirm reports
DROP POLICY IF EXISTS thesis_reports_supervisor_read ON "thesis_progress_reports";
CREATE POLICY thesis_reports_supervisor_read ON "thesis_progress_reports" FOR SELECT TO afagh_app
  USING ("thesisProgressId" IN (SELECT "id" FROM "thesis_progress" WHERE "supervisorId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)));

-- Admin/Expert can read all (همان الگوی نقش‌محور بالا — بدون GUC نقش)
DROP POLICY IF EXISTS thesis_reports_admin_read ON "thesis_progress_reports";
CREATE POLICY thesis_reports_admin_read ON "thesis_progress_reports" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT')));

ALTER TABLE "defense_sessions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS defense_sessions_self_read ON "defense_sessions";
CREATE POLICY defense_sessions_self_read ON "defense_sessions" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

-- Jury members can read
DROP POLICY IF EXISTS defense_sessions_jury_read ON "defense_sessions";
CREATE POLICY defense_sessions_jury_read ON "defense_sessions" FOR SELECT TO afagh_app
  USING ("chairId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "supervisorId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "internalId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "externalId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

-- Admin/Expert can read all (همان الگوی نقش‌محور — بدون GUC نقش)
DROP POLICY IF EXISTS defense_sessions_admin_read ON "defense_sessions";
CREATE POLICY defense_sessions_admin_read ON "defense_sessions" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT')));

ALTER TABLE "irandoc_logs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS irandoc_logs_self_read ON "irandoc_logs";
CREATE POLICY irandoc_logs_self_read ON "irandoc_logs" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

-- Admin/Expert can read all (همان الگوی نقش‌محور — بدون GUC نقش)
DROP POLICY IF EXISTS irandoc_logs_admin_read ON "irandoc_logs";
CREATE POLICY irandoc_logs_admin_read ON "irandoc_logs" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT')));

-- تنها سیاستِ این جدول: استخرِ داوران دادهٔ مرجع است و studentId ندارد، پس «ردیف خودِ
-- کاربر» معنا ندارد → فقط مدیر/کارشناس (الگوی نقش‌محور). دانشجو/استاد صفر ردیف می‌بینند.
ALTER TABLE "defense_jury_pools" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS defense_jury_pools_admin_read ON "defense_jury_pools";
CREATE POLICY defense_jury_pools_admin_read ON "defense_jury_pools" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT')));

ALTER TABLE "alumni_profiles" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alumni_profiles_self_read ON "alumni_profiles";
CREATE POLICY alumni_profiles_self_read ON "alumni_profiles" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "alumni_requests" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alumni_requests_self_read ON "alumni_requests";
CREATE POLICY alumni_requests_self_read ON "alumni_requests" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

-- ══ جدول‌های امتحانات — RLS بر پایهٔ app.user_id (اصلاح ردهٔ app.university_id) ══
--
--  چرا این بازنویسی لازم بود (همان ردهٔ بند ۲٫۵ بالا، برای ۷ جدول امتحانی):
--  • app.university_id برای نقش afagh_app هرگز ست نمی‌شود. تنها نقطهٔ ست‌کردنش
--    src/app/admin/exams/actions.ts:26 است که روی استخرِ مالک (BYPASSRLS) اجرا می‌شود
--    و آن‌جا اصلاً RLS اعمال نمی‌شود ⇒ «"universityId" = current_setting('app.university_id',true)»
--    برای نقش اپ همیشه NULL بود ⇒ NULL = x ⇒ NULL ⇒ سیاست همیشه FALSE (دقیقاً همان باگی که
--    در scripts/hardening.mjs:75-79 گزارش شده بود). آن تابع حتی فراخوانی‌نشده است (dead code).
--  • app.user_role هم هیچ‌جا در اپ ست نمی‌شود (در کل این فایل فقط همین ۷ سیاست از آن
--    استفاده می‌کردند و حذف شد).
--  • تنها GUC قابل‌اتکا: app.user_id که withUserRls (src/db/index.ts:102) در همان تراکنش
--    و روی همین نقشِ غیر-BYPASSRLS می‌نویسد. دانشگاهِ کاربر هم از دادهٔ خودش استخراج
--    می‌شود (students/staff."universityId")، نه از یک GUC.
--
--  الگوهای به‌کاررفته (همه با DROP+CREATE ⇒ idempotent روی هر استقرار):
--   ۱) نقش‌محور (مدیر/کارشناس همه را می‌بیند) — عین الگوی thesis_* بالا.
--   ۲) کاتالوگ سراسری: "universityId" IS NULL (سطر جهانی/پیش‌فرض) یا دانشگاهِ خودِ کاربر.
--   ۳) خودِ کاربر: دانشجو فقط صندلی/سشن خودش، مراقب فقط تخصیص خودش (همان joinهایی که
--      پنل /proctor و کارت امتحان دانشجو می‌زنند ⇒ اگر روزی به withUserRls منتقل شد، کار می‌کند).
--
--  ⚠ بازگشتِ بی‌نهایت ندارد: زنجیرهٔ زیرپرسمان‌ها students ← enrollments ← seat_allocations
--  و staff ← invigilators است و هیچ‌کدام به جدولِ سیاستِ بالا برنمی‌گردند؛
--  user_roles هم سیاستِ خودش را روی "userId" = app.user_id دارد (پایین) ⇒ فقط نقش‌های خودِ
--  کاربر دیده می‌شود، و roles اصلاً RLS ندارد.
--  همهٔ این ۷ جدول فقط SELECT دارند (هیچ GRANT نوشتنی به afagh_app داده نشده) ⇒
--  FOR SELECT بدون WITH CHECK؛ نوشتن از مسیر مالک (BYPASSRLS) انجام می‌شود.

-- سشن‌های امتحان: مدیر/کارشناس همه؛ دانشجو فقط سشنِ صندلیِ خودش؛ مراقب فقط سشنِ تخصیصیِ خودش
ALTER TABLE "exam_sessions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exam_sessions_uni ON "exam_sessions";
CREATE POLICY exam_sessions_uni ON "exam_sessions" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT'))
      OR "id" IN (SELECT sa."sessionId" FROM "seat_allocations" sa
                  JOIN "enrollments" e ON e."id" = sa."enrollmentId"
                  JOIN "students" s ON s."id" = e."studentId"
                  WHERE s."userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "id" IN (SELECT iv."sessionId" FROM "invigilators" iv
                  JOIN "staff" st ON st."id" = iv."staffId"
                  WHERE st."userId" = nullif(current_setting('app.user_id', true), '')::int));

-- سالن‌های امتحان — کاتالوگ (نام/ظرفیت، بدون دادهٔ شخصی): سطر جهانی + دانشگاهِ خودِ کاربر + مدیر
ALTER TABLE "exam_halls" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exam_halls_uni ON "exam_halls";
CREATE POLICY exam_halls_uni ON "exam_halls" FOR SELECT TO afagh_app
  USING ("universityId" IS NULL
      OR "universityId" IN (SELECT "universityId" FROM "students"
                            WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int
                              AND "universityId" IS NOT NULL)
      OR "universityId" IN (SELECT "universityId" FROM "staff"
                            WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int
                              AND "universityId" IS NOT NULL)
      OR EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
                 WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
                   AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT')));

-- زون‌بندی تقویم — کاتالوگِ ترمی (تاریخ‌ها، بدون دادهٔ شخصی): سطر جهانی + دانشگاهِ کاربر + مدیر
ALTER TABLE "exam_calendar_configs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exam_cal_uni ON "exam_calendar_configs";
CREATE POLICY exam_cal_uni ON "exam_calendar_configs" FOR SELECT TO afagh_app
  USING ("universityId" IS NULL
      OR "universityId" IN (SELECT "universityId" FROM "students"
                            WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int
                              AND "universityId" IS NOT NULL)
      OR "universityId" IN (SELECT "universityId" FROM "staff"
                            WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int
                              AND "universityId" IS NOT NULL)
      OR EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
                 WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
                   AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT')));

-- مراقبانِ سالن: پروندهٔ پرسنلیِ خودِ کاربر (بدون قیدِ دانشگاه — کارمند یک دانشگاهِ واحد ندارد؛
-- staff."userId" ستونِ درست است) یا نقش‌محور برای مدیر/کارشناس
ALTER TABLE "invigilators" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invigilators_self_read ON "invigilators";
CREATE POLICY invigilators_self_read ON "invigilators" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "staff" s
                  WHERE s."userId" = nullif(current_setting('app.user_id', true), '')::int
                    AND s."id" = "staffId")
      OR EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
                 WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
                   AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT')));

-- شیفت/ثبت‌ورود مراقب در آزمون — همان الگوی خودِ کاربر
ALTER TABLE "exam_invigilators" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exam_invigilators_self_read ON "exam_invigilators";
CREATE POLICY exam_invigilators_self_read ON "exam_invigilators" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "staff" s
                  WHERE s."userId" = nullif(current_setting('app.user_id', true), '')::int
                    AND s."id" = "staffId")
      OR EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
                 WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
                   AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT')));

-- صندلی‌ها: دانشجو فقط صندلیِ خودش (سیاستِ seat_self_read بالا هم همین را می‌دهد)،
-- مراقب فقط صندلیِ سشنِ تخصیصیِ خودش (رستور پنل /proctor)، مدیر/کارشناس همه.
-- قیدِ "universityId" عمداً اینجا نیست: صندلی دادهٔ شخصیِ دانشجوست و سطرِ NULL
-- به معنای «عمومی» نیست ⇒ دسترسی از مسیر رابطه (enrollment/staff) تعریف می‌شود.
ALTER TABLE "seat_allocations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS seat_alloc_uni ON "seat_allocations";
CREATE POLICY seat_alloc_uni ON "seat_allocations" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "enrollments" e JOIN "students" s ON s."id" = e."studentId"
                  WHERE e."id" = "enrollmentId"
                    AND s."userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "sessionId" IN (SELECT iv."sessionId" FROM "invigilators" iv
                         JOIN "staff" st ON st."id" = iv."staffId"
                         WHERE st."userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
                 WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
                   AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT')));

-- نرخ‌های حق‌التدریس/امتحان — کاتالوگِ نرخ (غیرشخصی): سطر جهانی + دانشگاهِ کاربر + مدیر.
-- (هیچ مسیرِ خواندنی در اپ ندارد؛ فقط scripts/exam-load-seed.mjs از نقش مالک می‌نویسد.)
ALTER TABLE "exam_remuneration_rates" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exam_remun_uni ON "exam_remuneration_rates";
CREATE POLICY exam_remun_uni ON "exam_remuneration_rates" FOR SELECT TO afagh_app
  USING ("universityId" IS NULL
      OR "universityId" IN (SELECT "universityId" FROM "students"
                            WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int
                              AND "universityId" IS NOT NULL)
      OR "universityId" IN (SELECT "universityId" FROM "staff"
                            WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int
                              AND "universityId" IS NOT NULL)
      OR EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
                 WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
                   AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT')));

ALTER TABLE "offering_professors" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS offering_professors_self_read ON "offering_professors";
CREATE POLICY offering_professors_self_read ON "offering_professors" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "professor_availabilities" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS professor_availabilities_self_read ON "professor_availabilities";
CREATE POLICY professor_availabilities_self_read ON "professor_availabilities" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

-- فاز ۱۱ (واقعی‌سازی): جدول‌های جدیدِ دارای staffId باید در پوشش RLS بیایند،
-- وگرنه گیت «پوشش کامل RLS» در hardening.mjs استقرار را متوقف می‌کند (fail-closed).
ALTER TABLE "professor_availability_notes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prof_avail_note_self_read ON "professor_availability_notes";
CREATE POLICY prof_avail_note_self_read ON "professor_availability_notes" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "signature_otps" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sigotp_self_read ON "signature_otps";
CREATE POLICY sigotp_self_read ON "signature_otps" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "staff_roles" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_roles_self_read ON "staff_roles";
CREATE POLICY staff_roles_self_read ON "staff_roles" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

ALTER TABLE "notification_channels" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_channels_self_read ON "notification_channels";
CREATE POLICY notification_channels_self_read ON "notification_channels" FOR SELECT TO afagh_app
  USING ("userId" = nullif(current_setting('app.user_id', true), '')::int);

ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_deliveries_self_read ON "notification_deliveries";
CREATE POLICY notification_deliveries_self_read ON "notification_deliveries" FOR SELECT TO afagh_app
  USING ("userId" = nullif(current_setting('app.user_id', true), '')::int);

ALTER TABLE "notification_logs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_logs_self_read ON "notification_logs";
CREATE POLICY notification_logs_self_read ON "notification_logs" FOR SELECT TO afagh_app
  USING ("userId" = nullif(current_setting('app.user_id', true), '')::int);

ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_roles_self_read ON "user_roles";
CREATE POLICY user_roles_self_read ON "user_roles" FOR SELECT TO afagh_app
  USING ("userId" = nullif(current_setting('app.user_id', true), '')::int);

-- expert_scopes: کارشناس فقط ردیف‌های خودش را می‌خواند (expert-scope.ts)؛
-- مدیر/کارشناس ارشد همه را (الگوی نقش‌محور). نوشتن ادمین از اتصال مالک (BYPASSRLS) می‌گذرد.
ALTER TABLE "expert_scopes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expert_scopes_self_read ON "expert_scopes";
CREATE POLICY expert_scopes_self_read ON "expert_scopes" FOR SELECT TO afagh_app
  USING ("userId" = nullif(current_setting('app.user_id', true), '')::int);
DROP POLICY IF EXISTS expert_scopes_admin_read ON "expert_scopes";
CREATE POLICY expert_scopes_admin_read ON "expert_scopes" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'VICE_EDU')));

-- classroom_edu_experts: کارشناس آموزش فقط ردیف‌های خودش (تخصیص به اتاق) را می‌خواند؛
-- مدیر/کارشناس ارشد همه را (الگوی نقش‌محور، هم‌ردیف expert_scopes). نوشتن از اتصال مالک (BYPASSRLS) می‌گذرد.
ALTER TABLE "classroom_edu_experts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS classroom_edu_experts_self_read ON "classroom_edu_experts";
CREATE POLICY classroom_edu_experts_self_read ON "classroom_edu_experts" FOR SELECT TO afagh_app
  USING ("userId" = nullif(current_setting('app.user_id', true), '')::int);
DROP POLICY IF EXISTS classroom_edu_experts_admin_read ON "classroom_edu_experts";
CREATE POLICY classroom_edu_experts_admin_read ON "classroom_edu_experts" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'VICE_EDU')));

-- course_offering_edu_experts: همین الگو (تخصیص کارشناس به ارائه).
ALTER TABLE "course_offering_edu_experts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS course_offering_edu_experts_self_read ON "course_offering_edu_experts";
CREATE POLICY course_offering_edu_experts_self_read ON "course_offering_edu_experts" FOR SELECT TO afagh_app
  USING ("userId" = nullif(current_setting('app.user_id', true), '')::int);
DROP POLICY IF EXISTS course_offering_edu_experts_admin_read ON "course_offering_edu_experts";
CREATE POLICY course_offering_edu_experts_admin_read ON "course_offering_edu_experts" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'VICE_EDU')));

ALTER TABLE "grade_change_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS grade_change_log_self_read ON "grade_change_log";
CREATE POLICY grade_change_log_self_read ON "grade_change_log" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));

-- ═══════════════════════════════════════════════════════════════════════
--  ⑨ جدول‌های جدید ماژول‌های الحاقی (مهاجرت 0075-0092) — پوشش RLS کامل
-- ═══════════════════════════════════════════════════════════════════════

-- ── کمیته انضباطی (discipline_cases): مالکیت دانشجو + مدیر/کارشناس ──
ALTER TABLE "discipline_cases" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS discipline_cases_self_read ON "discipline_cases";
CREATE POLICY discipline_cases_self_read ON "discipline_cases" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));
DROP POLICY IF EXISTS discipline_cases_admin_read ON "discipline_cases";
CREATE POLICY discipline_cases_admin_read ON "discipline_cases" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── جلسات شورای آموزشی (council_meetings): کاتالوگ سراسری + دانشگاه کاربر + مدیر ──
ALTER TABLE "council_meetings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS council_meetings_uni ON "council_meetings";
CREATE POLICY council_meetings_uni ON "council_meetings" FOR SELECT TO afagh_app
  USING ("universityId" IS NULL
      OR "universityId" IN (SELECT "universityId" FROM "students"
                            WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int
                              AND "universityId" IS NOT NULL)
      OR "universityId" IN (SELECT "universityId" FROM "staff"
                            WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int
                              AND "universityId" IS NOT NULL)
      OR EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
                 WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
                   AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── مصوبات شورای آموزشی (council_decisions): اگر studentId داری → دانشجو/استاد، وگرنه کاتالوگ + مدیر ──
ALTER TABLE "council_decisions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS council_decisions_self_read ON "council_decisions";
CREATE POLICY council_decisions_self_read ON "council_decisions" FOR SELECT TO afagh_app
  USING ("studentId" IS NOT NULL AND "studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
                 WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
                   AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── کارت‌های سکونت خوابگاه (dorm_residences): مالکیت دانشجو + مدیر ──
ALTER TABLE "dorm_residences" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dorm_residences_self_read ON "dorm_residences";
CREATE POLICY dorm_residences_self_read ON "dorm_residences" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));
DROP POLICY IF EXISTS dorm_residences_admin_read ON "dorm_residences";
CREATE POLICY dorm_residences_admin_read ON "dorm_residences" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── تأیید انتخاب واحد انگلیسی (english_enrollment_approvals): مالکیت دانشجو + تصمیم‌گیرنده/ایجادکننده + مدیر ──
ALTER TABLE "english_enrollment_approvals" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS english_enrollment_approvals_self_read ON "english_enrollment_approvals";
CREATE POLICY english_enrollment_approvals_self_read ON "english_enrollment_approvals" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "requestedBy" = nullif(current_setting('app.user_id', true), '')::int
      OR "decidedBy" = nullif(current_setting('app.user_id', true), '')::int);
DROP POLICY IF EXISTS english_enrollment_approvals_admin_read ON "english_enrollment_approvals";
CREATE POLICY english_enrollment_approvals_admin_read ON "english_enrollment_approvals" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── هشدارهای زمان‌بندی‌شده (scheduled_warnings): مالکیت دانشجو + ایجادکننده + مدیر ──
ALTER TABLE "scheduled_warnings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scheduled_warnings_self_read ON "scheduled_warnings";
CREATE POLICY scheduled_warnings_self_read ON "scheduled_warnings" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "createdBy" = nullif(current_setting('app.user_id', true), '')::int);
DROP POLICY IF EXISTS scheduled_warnings_admin_read ON "scheduled_warnings";
CREATE POLICY scheduled_warnings_admin_read ON "scheduled_warnings" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── فرمول ویژهٔ شهریه (student_tuition_overrides): مالکیت دانشجو + ایجادکننده + مدیر ──
ALTER TABLE "student_tuition_overrides" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tuition_overrides_self_read ON "student_tuition_overrides";
CREATE POLICY tuition_overrides_self_read ON "student_tuition_overrides" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "createdBy" = nullif(current_setting('app.user_id', true), '')::int);
DROP POLICY IF EXISTS tuition_overrides_admin_read ON "student_tuition_overrides";
CREATE POLICY tuition_overrides_admin_read ON "student_tuition_overrides" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── نظارت پایان‌نامه (thesis_supervisions): مالکیت استاد + دانشجو (در صورت وجود) + مدیر ──
ALTER TABLE "thesis_supervisions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS thesis_supervisions_self_read ON "thesis_supervisions";
CREATE POLICY thesis_supervisions_self_read ON "thesis_supervisions" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR ("studentId" IS NOT NULL AND "studentId" IN (SELECT "id" FROM "students" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int))
      OR "createdBy" = nullif(current_setting('app.user_id', true), '')::int);
DROP POLICY IF EXISTS thesis_supervisions_admin_read ON "thesis_supervisions";
CREATE POLICY thesis_supervisions_admin_read ON "thesis_supervisions" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── ابلاغ‌های آموزشی (teaching_decrees): مالکیت استاد + صادرکننده + مدیر ──
ALTER TABLE "teaching_decrees" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teaching_decrees_self_read ON "teaching_decrees";
CREATE POLICY teaching_decrees_self_read ON "teaching_decrees" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "issuedBy" = nullif(current_setting('app.user_id', true), '')::int);
DROP POLICY IF EXISTS teaching_decrees_admin_read ON "teaching_decrees";
CREATE POLICY teaching_decrees_admin_read ON "teaching_decrees" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── افزوده‌های حق‌التدریس درس-استاد (offering_payroll_extras): مالکیت استاد + ایجادکننده + مدیر ──
ALTER TABLE "offering_payroll_extras" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS offering_payroll_extras_self_read ON "offering_payroll_extras";
CREATE POLICY offering_payroll_extras_self_read ON "offering_payroll_extras" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "createdBy" = nullif(current_setting('app.user_id', true), '')::int);
DROP POLICY IF EXISTS offering_payroll_extras_admin_read ON "offering_payroll_extras";
CREATE POLICY offering_payroll_extras_admin_read ON "offering_payroll_extras" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── ثبت فعالیت‌های کیفی استاد (staff_activity_entries): مالکیت استاد + تصمیم‌گیرنده/ایجادکننده + مدیر ──
ALTER TABLE "staff_activity_entries" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_activity_entries_self_read ON "staff_activity_entries";
CREATE POLICY staff_activity_entries_self_read ON "staff_activity_entries" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "createdBy" = nullif(current_setting('app.user_id', true), '')::int
      OR "decidedBy" = nullif(current_setting('app.user_id', true), '')::int);
DROP POLICY IF EXISTS staff_activity_entries_admin_read ON "staff_activity_entries";
CREATE POLICY staff_activity_entries_admin_read ON "staff_activity_entries" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── مبالغ نقدی جنبی ترم استاد (payroll_cash_extras): مالکیت استاد + ایجادکننده + مدیر ──
ALTER TABLE "payroll_cash_extras" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_cash_extras_self_read ON "payroll_cash_extras";
CREATE POLICY payroll_cash_extras_self_read ON "payroll_cash_extras" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "createdBy" = nullif(current_setting('app.user_id', true), '')::int);
DROP POLICY IF EXISTS payroll_cash_extras_admin_read ON "payroll_cash_extras";
CREATE POLICY payroll_cash_extras_admin_read ON "payroll_cash_extras" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── پرداخت امتحانی (exam_payments): مالکیت استاد + ایجادکننده + مدیر ──
ALTER TABLE "exam_payments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exam_payments_self_read ON "exam_payments";
CREATE POLICY exam_payments_self_read ON "exam_payments" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "createdBy" = nullif(current_setting('app.user_id', true), '')::int);
DROP POLICY IF EXISTS exam_payments_admin_read ON "exam_payments";
CREATE POLICY exam_payments_admin_read ON "exam_payments" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── اعتراضات استاد (payroll_objections): مالکیت استاد + بررسی‌کننده + مدیر ──
ALTER TABLE "payroll_objections" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_objections_self_read ON "payroll_objections";
CREATE POLICY payroll_objections_self_read ON "payroll_objections" FOR SELECT TO afagh_app
  USING ("staffId" IN (SELECT "id" FROM "staff" WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int)
      OR "createdBy" = nullif(current_setting('app.user_id', true), '')::int
      OR "reviewedBy" = nullif(current_setting('app.user_id', true), '')::int);
DROP POLICY IF EXISTS payroll_objections_admin_read ON "payroll_objections";
CREATE POLICY payroll_objections_admin_read ON "payroll_objections" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

-- ── کاتالوگ نقش‌های استاد (teaching_role_defs): کاتالوگ مدیریتی → فقط مدیر/کارشناس ──
ALTER TABLE "teaching_role_defs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teaching_role_defs_admin_read ON "teaching_role_defs";
CREATE POLICY teaching_role_defs_admin_read ON "teaching_role_defs" FOR SELECT TO afagh_app
  USING (EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" IN ('ADMIN', 'EDU_EXPERT', 'GRADUATION_EXPERT', 'VICE_EDU')));

ALTER TABLE "legacy_code_maps" ENABLE ROW LEVEL SECURITY;
-- targetId عمومی/داخلی است و کاربرد نقش اپ ندارد → برای نقش اپ «هیچ» (deny-all صریح)
DROP POLICY IF EXISTS legacy_code_maps_deny_all ON "legacy_code_maps";
CREATE POLICY legacy_code_maps_deny_all ON "legacy_code_maps" FOR ALL TO afagh_app USING (false);

-- ── گزارش‌ساز: گزارش‌های ذخیره‌شده (saved_reports) ──
-- این جدول «تعریفِ گزارش» است، نه دادهٔ دانشجویی. سه دامنهٔ دیده‌شدن:
--   PRIVATE → فقط مالک
--   ROLE    → مالک + اعضای نقش‌های فهرست‌شده در allowedRoles
--   PUBLIC  → همهٔ کاربرانی که به مرکز گزارش‌ها دسترسی دارند
-- نوشتن (ساخت/ویرایش/حذف) همیشه فقط برای مالک.
-- نکته: like سایر سیاست‌های نقش‌محور، app.user_id تنها GUCی است که withUserRls
-- (src/db/index.ts) در همان تراکنش می‌نویسد؛ نبودِ آن ⇒ uid NULL ⇒ EXISTS صفر
-- ⇒ همچنان fail-closed. زیرپرسمانِ user_roles خودش RLS دارد و روی همین userId
-- است، پس فقط نقش‌های خودِ کاربر جاری دیده می‌شود (بازگشتِ بی‌نهایت هم ندارد).
ALTER TABLE "saved_reports" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_reports_read ON "saved_reports";
CREATE POLICY saved_reports_read ON "saved_reports" FOR SELECT TO afagh_app
  USING (
    "ownerUserId" = nullif(current_setting('app.user_id', true), '')::int
    OR "visibility" = 'PUBLIC'
    OR ("visibility" = 'ROLE' AND EXISTS (
          SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = nullif(current_setting('app.user_id', true), '')::int
            AND r."code" = ANY (SELECT jsonb_array_elements_text(saved_reports."allowedRoles"))
        ))
  );
DROP POLICY IF EXISTS saved_reports_write ON "saved_reports";
CREATE POLICY saved_reports_write ON "saved_reports" FOR ALL TO afagh_app
  USING ("ownerUserId" = nullif(current_setting('app.user_id', true), '')::int)
  WITH CHECK ("ownerUserId" = nullif(current_setting('app.user_id', true), '')::int);

-- ── ارزیابی جامع دکتری (comprehensive_exams، مهاجرت 0135) ──
-- دادهٔ شخصیِ دانشجو (studentId + نمره/نتیجه). الگوی مشترک جداول دانشجویی:
-- دانشجو فقط ردیفِ خودش را می‌بیند (از طریق students.userId)؛ دسترسی اداری/نوشتن
-- از مسیر نقش مالک (BYPASSRLS) انجام می‌شود — همانند transcript_snapshots.
ALTER TABLE "comprehensive_exams" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comprehensive_exams_self_read ON "comprehensive_exams";
CREATE POLICY comprehensive_exams_self_read ON "comprehensive_exams" FOR SELECT TO afagh_app
  USING ("studentId" IN (SELECT "id" FROM "students"
    WHERE "userId" = nullif(current_setting('app.user_id', true), '')::int));
