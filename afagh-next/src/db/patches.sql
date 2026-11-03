CREATE TABLE IF NOT EXISTS api_audit_logs (
  id SERIAL PRIMARY KEY,
  service_name VARCHAR(50),
  endpoint VARCHAR(255),
  request_body TEXT,
  response_body TEXT,
  status_code INTEGER,
  response_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id SERIAL PRIMARY KEY,
  event_code VARCHAR(50),
  title VARCHAR(255),
  channel VARCHAR(50),
  template_text TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE process_definitions ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE process_definitions ADD COLUMN IF NOT EXISTS "category" varchar(50) DEFAULT 'عمومی';
ALTER TABLE process_definitions ADD COLUMN IF NOT EXISTS "formSchema" text;
ALTER TABLE process_definitions ADD COLUMN IF NOT EXISTS "outputTemplate" varchar(50);
ALTER TABLE process_definitions ADD COLUMN IF NOT EXISTS "feeAmount" integer DEFAULT 0;
ALTER TABLE process_definitions ADD COLUMN IF NOT EXISTS "isActive" integer DEFAULT 1;

ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS "timeoutEscalateToRole" varchar(50);
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS "slaHours" integer DEFAULT 24;
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS "timeoutAction" varchar(50) DEFAULT 'AUTO_ESCALATE';
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS "stepOrder" integer DEFAULT 1;
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS "stepType" varchar(30) DEFAULT 'APPROVAL';
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS "serviceTaskType" varchar(50);
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS "autoConditionsJson" text;
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS "assignedStaffId" integer;

ALTER TABLE educational_regulations ADD COLUMN IF NOT EXISTS "rulesConfig" text DEFAULT '{}';
ALTER TABLE students ADD COLUMN IF NOT EXISTS "quotaType" varchar(50) DEFAULT 'NORMAL';
ALTER TABLE students ADD COLUMN IF NOT EXISTS "extraAllowedSemesters" integer DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS "extraAllowedProbations" integer DEFAULT 0;

-- کش گزارش‌های هوش تجاری (bi-engine)؛ همان تعریف schema.ts، idempotent
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id SERIAL PRIMARY KEY,
  "cacheKey" VARCHAR(160) NOT NULL UNIQUE,
  "reportType" VARCHAR(60) NOT NULL,
  payload TEXT NOT NULL,
  "rowCount" INTEGER,
  "durationMs" INTEGER,
  "computedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP
);

-- ایندکس‌های کوئری‌های تجمیعی BI (بخش ⑦ pg-hardening.sql)
CREATE INDEX IF NOT EXISTS "idx_eval_resp_period_offering" ON evaluation_responses ("periodId", "offeringId");
CREATE INDEX IF NOT EXISTS "idx_eval_resp_question"        ON evaluation_responses ("questionId");
CREATE INDEX IF NOT EXISTS "idx_eval_resp_offering"        ON evaluation_responses ("offeringId");
CREATE INDEX IF NOT EXISTS "idx_eval_q_form_axis"          ON evaluation_questions ("formId", "axisLabel");
CREATE INDEX IF NOT EXISTS "idx_schedules_room_type"       ON schedules ("roomId", "scheduleType");
CREATE INDEX IF NOT EXISTS "idx_offering_prof_role"        ON offering_professors ("role", "staffId");
CREATE INDEX IF NOT EXISTS "idx_analytics_snapshots_type"  ON analytics_snapshots ("reportType");

-- ═══ پچ‌های امنیتی پذیرش (فاز اصلاح) ═══
ALTER TABLE users ADD COLUMN IF NOT EXISTS "mustChangePassword" integer DEFAULT 0;

-- ═══ پچ‌های مهاجرت از دیتابیس قدیمی (رشته‌ها و اساتید) ═══
ALTER TABLE faculties ADD COLUMN IF NOT EXISTS "facultyCode" varchar(10);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS "departmentCode" varchar(10);
ALTER TABLE majors ADD COLUMN IF NOT EXISTS "facultyId" integer;
ALTER TABLE majors ADD COLUMN IF NOT EXISTS "minUnits" integer;
ALTER TABLE majors ADD COLUMN IF NOT EXISTS "standardCode" varchar(20);
ALTER TABLE majors ADD COLUMN IF NOT EXISTS "establishedDate" varchar(10);
ALTER TABLE majors ADD COLUMN IF NOT EXISTS "terminatedDate" varchar(10);
ALTER TABLE majors ADD COLUMN IF NOT EXISTS "isActive" integer DEFAULT 1;
ALTER TABLE majors ADD COLUMN IF NOT EXISTS "headStaffCode" varchar(20);
ALTER TABLE majors ADD COLUMN IF NOT EXISTS "expertName" varchar(150);
ALTER TABLE majors ADD COLUMN IF NOT EXISTS "lastCouncilDate" varchar(10);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "title" varchar(50);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "facultyId" integer;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "isActive" integer DEFAULT 1;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "cooperationType" varchar(50);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "personnelNo" varchar(50);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "employmentType" varchar(50);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "hireDate" varchar(10);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "lastDegreeYear" integer;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "fieldOfStudy" varchar(200);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "maritalStatusCode" integer;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "maritalStatus" varchar(20);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "lastDegreeCountryCode" varchar(10);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "lastDegreeUniversity" varchar(200);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "academicBase" varchar(20);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "birthProvince" varchar(100);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "birthCity" varchar(100);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "bankAccountNo" varchar(50);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "phone" varchar(20);
-- قید یکتایی فرمول شمارهٔ دانشجویی (پایهٔ افزایش اتمیک + onConflictDoNothing).
-- اگر ردیف تکراری قدیمی وجود داشته باشد، به‌جای شکستن استارت‌آپ،
-- ایندکس ساخته نشده و در لاگ هشدار داده می‌شود.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_id_formulas_degreeLevelId_unique') THEN
    IF (SELECT COUNT(*) FROM (
          SELECT "degreeLevelId" FROM student_id_formulas
          WHERE "degreeLevelId" IS NOT NULL GROUP BY "degreeLevelId" HAVING COUNT(*) > 1) d) = 0 THEN
      CREATE UNIQUE INDEX IF NOT EXISTS "student_id_formulas_degreeLevelId_unique"
        ON student_id_formulas ("degreeLevelId");
    ELSE
      RAISE WARNING 'student_id_formulas دارای ردیف تکراری degreeLevelId است — قید یکتایی ساخته نشد';
    END IF;
  END IF;
END $$;

-- M-4: ایندکس‌های پاکسازی/چرخش نشست‌ها (در drizzle push برای نصب‌های قدیمی ساخته نمی‌شود)
CREATE INDEX IF NOT EXISTS "sessions_userId_idx" ON sessions ("userId");
CREATE INDEX IF NOT EXISTS "sessions_expiresAt_idx" ON sessions ("expiresAt");

-- ── مقطع درس (مهاجرت داده): فایل قدیمی ستون «مقطع» دارد ولی کاتالوگ جدید
--    جایی برای نگه‌داشتنش نداشت. NULL = درس مشترک بین همهٔ مقاطع.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS "degreeLevelId" integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'courses_degreeLevelId_fkey') THEN
    ALTER TABLE courses
      ADD CONSTRAINT "courses_degreeLevelId_fkey"
      FOREIGN KEY ("degreeLevelId") REFERENCES degree_level_configs(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "courses_degreeLevelId_idx" ON courses ("degreeLevelId");
CREATE INDEX IF NOT EXISTS "courses_departmentId_idx" ON courses ("departmentId");

-- ── عکس افراد (مهاجرت از سیستم قدیمی) ──
--    فایل عکس در Object Storage می‌ماند؛ اینجا فقط کلید و فراداده.
--    photoFileName نام فایل در فایل اکسل قدیمی است تا آرشیو ZIP عکس‌ها
--    بتواند هر عکس را به صاحبش وصل کند حتی وقتی نام فایل با کد شخص یکی نیست.
ALTER TABLE users ADD COLUMN IF NOT EXISTS "photoKey" varchar(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS "photoMime" varchar(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS "photoFileName" varchar(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS "photoUpdatedAt" timestamp;
CREATE INDEX IF NOT EXISTS "users_photoFileName_idx" ON users ("photoFileName");

-- ── ستون‌هایی که در فایل‌های واقعی reshtelist/professorslist هست ولی جایی نداشت ──
ALTER TABLE staff  ADD COLUMN IF NOT EXISTS "fieldMain" varchar(200);
ALTER TABLE majors ADD COLUMN IF NOT EXISTS "headName"  varchar(150);

-- ── مدیر گروه و نوع گروه آموزشی ──
--    headStaffId روی خودِ گروه است (نه روی staff) چون مدیر گروهِ «دروس عمومی
--    و مشترک» معمولاً عضو آن گروه نیست و یک نفر می‌تواند مدیر چند گروه باشد.
ALTER TABLE departments ADD COLUMN IF NOT EXISTS "headStaffId" integer;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS "kind" varchar(20) DEFAULT 'ACADEMIC';
ALTER TABLE departments ADD COLUMN IF NOT EXISTS "isActive" integer DEFAULT 1;
CREATE INDEX IF NOT EXISTS "departments_headStaffId_idx" ON departments ("headStaffId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_headStaffId_fkey') THEN
    ALTER TABLE departments
      ADD CONSTRAINT "departments_headStaffId_fkey"
      FOREIGN KEY ("headStaffId") REFERENCES staff(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── یکتایی کد دانشکده و کد گروه ──
--    کد سند اصالت است؛ اگر تکراری باشد، تطبیق «کد-اول» در انتقال داده بی‌معنا
--    می‌شود. ایندکس جزئی است تا رکوردهای بدون کد (NULL) مانع نشوند.
--    اگر کد تکراری در داده هست، ایندکس ساخته نمی‌شود و پیام می‌دهیم تا دستی
--    اصلاح شود — عمداً داده حذف یا بازنویسی نمی‌کنیم.
DO $$
BEGIN
  IF EXISTS (SELECT "facultyCode" FROM faculties WHERE "facultyCode" IS NOT NULL
             GROUP BY "facultyCode" HAVING count(*) > 1) THEN
    RAISE WARNING 'کد دانشکدهٔ تکراری هست — ایندکس یکتا ساخته نشد. در /admin/departments اصلاح کنید.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "faculties_facultyCode_uq"
      ON faculties ("facultyCode") WHERE "facultyCode" IS NOT NULL;
  END IF;

  IF EXISTS (SELECT "departmentCode" FROM departments WHERE "departmentCode" IS NOT NULL
             GROUP BY "departmentCode" HAVING count(*) > 1) THEN
    RAISE WARNING 'کد گروه آموزشی تکراری هست — ایندکس یکتا ساخته نشد. در /admin/departments اصلاح کنید.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "departments_departmentCode_uq"
      ON departments ("departmentCode") WHERE "departmentCode" IS NOT NULL;
  END IF;
END $$;

-- ── قید یکتایی system_settings.key (برای seed-base.mjs که ON CONFLICT (key) دارد) ──
--  بقیهٔ یکتایی‌های تک‌ستونی (faculties/departments/majors) عمداً بازگردانده نمی‌شوند
--  چون 0027 آنها را به UNIQUE(universityId, code) تبدیل کرد تا کد رشته/گروه
--  بین دانشگاه‌های مختلف تکراری باشد (مثلاً یک کد در AFAGH و ZARINE).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'system_settings_key_unique') THEN
    ALTER TABLE system_settings ADD CONSTRAINT system_settings_key_unique UNIQUE ("key");
  END IF;
END $$;

-- ── پروندهٔ تکمیلی دانشجو از سما (خوابگاه، ولی، مدرک، نظام وظیفه و…) — هم‌گام با schema.ts ──
ALTER TABLE students ADD COLUMN IF NOT EXISTS "advisorCode" varchar(50);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "documentStatus" varchar(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "scholarshipType" varchar(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "militaryStatus" varchar(50);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "militaryExemptionNo" varchar(50);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "studentCardStatus" varchar(50);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "archiveNo" varchar(50);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "parvandehNo" varchar(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "dormName" varchar(150);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "dormRoom" varchar(50);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "hasDorm" integer DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS "guardianJobTitle" varchar(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "guardianPhone" varchar(30);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "guardianAddress" varchar(300);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "guardianEmail" varchar(150);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "diplomaType" varchar(50);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "diplomaPlace" varchar(200);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "diplomaYear" varchar(10);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "diplomaGrade" varchar(20);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "pishdPlace" varchar(200);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "pishdYear" varchar(10);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "pishdGrade" varchar(20);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "tuitionType" varchar(50);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "tuitionPayer" integer DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS "englishExamType" varchar(50);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "englishScore" varchar(20);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "insertDate" varchar(20);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "insertTime" varchar(20);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "certIssued3m" integer DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS "documentDeficiency" varchar(200);
ALTER TABLE students ADD COLUMN IF NOT EXISTS "unitsRemaining" integer;
ALTER TABLE students ADD COLUMN IF NOT EXISTS "eqSemesters" integer DEFAULT 0;

-- ══════════════════════════════════════════════════════════════════════
-- Migration V2: لایه هویت مستقل و رتبه‌بندی زمانی ترم‌ها
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "persons" (
  "id" serial PRIMARY KEY NOT NULL,
  "canonicalFirstName" varchar(100),
  "canonicalLastName" varchar(100),
  "canonicalFatherName" varchar(100),
  "canonicalNationalCode" varchar(10),
  "canonicalBirthDate" date,
  "createdAt" timestamp DEFAULT now(),
  "updatedAt" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_persons_national_code" ON "persons" ("canonicalNationalCode") WHERE "canonicalNationalCode" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "person_source_identities" (
  "id" serial PRIMARY KEY NOT NULL,
  "personId" integer REFERENCES "persons"("id") ON DELETE SET NULL,
  "universityId" integer NOT NULL REFERENCES "universities"("id") ON DELETE RESTRICT,
  "studentId" integer REFERENCES "students"("id") ON DELETE SET NULL,
  "sourceStudentCode" varchar(50) NOT NULL,
  "sourceNationalCode" varchar(10),
  "sourceFirstName" varchar(100),
  "sourceLastName" varchar(100),
  "sourceFatherName" varchar(100),
  "sourceBirthDate" date,
  "normalizedFirstName" varchar(100),
  "normalizedLastName" varchar(100),
  "normalizedFatherName" varchar(100),
  "identityStatus" varchar(40) DEFAULT 'UNRESOLVED' NOT NULL,
  "matchMethod" varchar(60),
  "matchConfidence" numeric(5, 4),
  "isPrimarySource" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp DEFAULT now(),
  "updatedAt" timestamp DEFAULT now(),
  CONSTRAINT "uq_person_source_identity" UNIQUE ("universityId", "sourceStudentCode")
);

CREATE INDEX IF NOT EXISTS "idx_person_source_identity_person" ON "person_source_identities" ("personId");
CREATE INDEX IF NOT EXISTS "idx_person_source_identity_national" ON "person_source_identities" ("sourceNationalCode");
CREATE INDEX IF NOT EXISTS "idx_person_source_identity_student" ON "person_source_identities" ("studentId");

CREATE TABLE IF NOT EXISTS "identity_resolution_reviews" (
  "id" serial PRIMARY KEY NOT NULL,
  "sourceIdentityId" integer NOT NULL REFERENCES "person_source_identities"("id") ON DELETE CASCADE,
  "candidatePersonId" integer REFERENCES "persons"("id") ON DELETE SET NULL,
  "candidateSourceIdentityId" integer REFERENCES "person_source_identities"("id") ON DELETE SET NULL,
  "resolution" varchar(40) NOT NULL,
  "matchMethod" varchar(60),
  "confidence" numeric(5, 4),
  "sourceNationalCode" varchar(10),
  "candidateNationalCode" varchar(10),
  "sourceStudentCode" varchar(50),
  "candidateStudentCode" varchar(50),
  "sourceUniversityId" integer,
  "candidateUniversityId" integer,
  "reason" text,
  "reviewStatus" varchar(30) DEFAULT 'PENDING' NOT NULL,
  "reviewedBy" integer,
  "reviewedAt" timestamp,
  "createdAt" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_identity_reviews_source" ON "identity_resolution_reviews" ("sourceIdentityId");
CREATE INDEX IF NOT EXISTS "idx_identity_reviews_candidate" ON "identity_resolution_reviews" ("candidatePersonId");
CREATE INDEX IF NOT EXISTS "idx_identity_reviews_status" ON "identity_resolution_reviews" ("reviewStatus");
CREATE INDEX IF NOT EXISTS "idx_identity_reviews_resolution" ON "identity_resolution_reviews" ("resolution");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "personId" integer REFERENCES "persons"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_users_personId" ON "users" ("personId");

ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "personId" integer REFERENCES "persons"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_students_personId" ON "students" ("personId");

ALTER TABLE "academic_terms" ADD COLUMN IF NOT EXISTS "sortOrder" integer;
ALTER TABLE "academic_terms" ADD COLUMN IF NOT EXISTS "academicYear" integer;
CREATE INDEX IF NOT EXISTS "idx_academic_terms_sortOrder" ON "academic_terms" ("sortOrder");

ALTER TABLE IF EXISTS "student_term_states" ADD COLUMN IF NOT EXISTS "sourceStatusCode" varchar(20);
ALTER TABLE IF EXISTS "student_term_states" ADD COLUMN IF NOT EXISTS "sourceStatusTitle" varchar(150);
ALTER TABLE IF EXISTS "student_term_states" ADD COLUMN IF NOT EXISTS "sourceTermAvg" numeric(4, 2);
ALTER TABLE IF EXISTS "student_term_states" ADD COLUMN IF NOT EXISTS "normalizedStatusCode" varchar(20);
ALTER TABLE IF EXISTS "student_term_states" ADD COLUMN IF NOT EXISTS "normalizedStatusTitle" varchar(150);
ALTER TABLE IF EXISTS "student_term_states" ADD COLUMN IF NOT EXISTS "normalizedTermAvg" numeric(4, 2);
ALTER TABLE IF EXISTS "student_term_states" ADD COLUMN IF NOT EXISTS "sourceProbation" integer;
ALTER TABLE IF EXISTS "student_term_states" ADD COLUMN IF NOT EXISTS "calculatedProbation" integer;
ALTER TABLE IF EXISTS "student_term_states" ADD COLUMN IF NOT EXISTS "sourceCompletedUnits" numeric(4, 1);
ALTER TABLE IF EXISTS "student_term_states" ADD COLUMN IF NOT EXISTS "sourcePassedUnits" numeric(4, 1);
ALTER TABLE IF EXISTS "student_term_states" ADD COLUMN IF NOT EXISTS "sourceAttemptedUnits" numeric(4, 1);

ALTER TABLE IF EXISTS "degree_level_configs" ADD COLUMN IF NOT EXISTS "termCount" integer;
ALTER TABLE IF EXISTS "degree_level_configs" ADD COLUMN IF NOT EXISTS "isGraduate" integer;

-- ── دامنهٔ دانشگاه (universityId): دادهٔ قدیمی این ستون را ندارد و زیر فیلتر
--    دانشگاهِ فعال (curriculum/actions/read.ts) نامرئی می‌ماند. فقط ردیف‌هایی
--    جابه‌جا می‌شوند که کدشان زیر uni=1 آزاد باشد (برخورد با uq_*_uni_code
--    کل تراکنش را برمی‌گرداند)؛ برخوردها دستی تصمیم می‌خواهند. ──
UPDATE "majors" AS m SET "universityId" = 1 WHERE m."universityId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "majors" x WHERE x."universityId" = 1 AND x."majorCode" = m."majorCode");

UPDATE "departments" AS d SET "universityId" = 1 WHERE d."universityId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "departments" x WHERE x."universityId" = 1 AND x."departmentCode" = d."departmentCode");

-- نسخه‌های برنامهٔ درسی، دانشگاهِ رشتهٔ خودشان را ارث می‌برند (دادهٔ چنددانشگاهی)
UPDATE "curriculum_versions" AS v SET "universityId" = COALESCE(m."universityId", 1)
  FROM "majors" m WHERE m.id = v."majorId" AND v."universityId" IS NULL;


-- ── قواعد پیش‌نیاز از «جدول دروس» (مهاجرت از سیستم قدیمی) ──
-- متن خام ستون «پیش‌نیاز» روی خودِ درس نگه داشته می‌شود؛ چون course_rules
-- مقیّد به نسخهٔ برنامه است و یک درس می‌تواند در چند نسخه باشد.
ALTER TABLE IF EXISTS "courses" ADD COLUMN IF NOT EXISTS "prereqText" text;

-- ── «تعداد واحد گذراندهٔ لازم» و «ترم لازم» از تعریف درس در سیستم قدیمی ──
-- این دو ستون در خروجی‌های متنی سما نبودند (فقط پیش‌نیاز/هم‌نیاز/هم‌ارز بود)،
-- پس داده‌شان دستی/از فایل دیگری پر می‌شود و در درخت قاعده به
-- unitsPassed / minSemester ترجمه می‌شوند.
ALTER TABLE IF EXISTS "courses" ADD COLUMN IF NOT EXISTS "prereqMinUnits" integer;
ALTER TABLE IF EXISTS "courses" ADD COLUMN IF NOT EXISTS "prereqMinTerm" integer;

-- ── اعتراض به نمره (دانشجو → کارشناس آموزش) ──
CREATE TABLE IF NOT EXISTS "grade_objections" (
  "id" serial PRIMARY KEY,
  "studentId" integer NOT NULL REFERENCES "students"("id"),
  "enrollmentId" integer NOT NULL REFERENCES "enrollments"("id"),
  "termId" integer REFERENCES "academic_terms"("id"),
  "courseCode" varchar(30),
  "courseTitle" varchar(200),
  "gradeAtObjection" numeric(6,2),
  "requestText" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "reviewerId" integer REFERENCES "staff"("id"),
  "reviewerNote" text,
  "resolvedAt" timestamp,
  "createdAt" timestamp DEFAULT now(),
  "updatedAt" timestamp DEFAULT now(),
  "universityId" integer REFERENCES "universities"("id")
);

-- ═══════════════════════════════════════════════════════════════════════════
--  ایندکس‌های عملکردی برای صفحهٔ اول و کارتابل‌ها
--  ───────────────────────────────────────────────────────────────────────────
--  چرا: جدول `student_requests` فقط ایندکسِ `status` داشت، ولی همهٔ کوئری‌های
--  کارتابل با `WHERE universityId = X OR universityId IS NULL` و
--  `ORDER BY id DESC LIMIT 20` اجرا می‌شوند؛ بدون ایندکس روی `universityId`
--  این‌ها به اسکنِ کاملِ جدول می‌افتادند و همان چیزی می‌شد که کاربر «کندیِ
--  شدیدِ صفحهٔ اول» توصیف کرد.
--
--  ⚠ `CONCURRENTLY` عمداً استفاده نشده: `apply-patches.mjs` کلِ این فایل را در
--  یک تراکنش اجرا می‌کند و `CREATE INDEX CONCURRENTLY` داخل تراکنش خطا می‌دهد.
--  `IF NOT EXISTS` هم اجرای مکرر در هر دیپلوی را بی‌خطر می‌کند.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS "idx_req_uni_created" ON "student_requests" ("universityId", "id" DESC);
CREATE INDEX IF NOT EXISTS "idx_req_uni_status"  ON "student_requests" ("universityId", "status");
CREATE INDEX IF NOT EXISTS "idx_req_student"     ON "student_requests" ("studentId");
CREATE INDEX IF NOT EXISTS "idx_req_process"     ON "student_requests" ("processId");

-- فهرست درخواست‌های دانشجو و کارتابل‌های شخصی بر اساسِ وضعیت
CREATE INDEX IF NOT EXISTS "idx_req_student_status" ON "student_requests" ("studentId", "status");

-- ═══════════════════════════════════════════════════════════════════════════
--  ایندکس‌های «گلوگاهِ حقوق و مالی» — پروفایلِ pg_stat_activity روی سرور
--  ───────────────────────────────────────────────────────────────────────────
--  دو کوئری‌ای که در پروفایلِ واقعی بیشترین زمان را می‌گرفتند:
--
--    ۱) select s.id as "staffId", count(e.id) as "pendingGrades" ...   → ۱ تا ۵ ثانیه
--    ۲) select l."transactionType", l.amount::float8 ...               → ۰.۶۶ ثانیه
--
--  علتِ ریشه‌ای (نه تئوری — با `\di` روی دیتابیس تأیید شد):
--
--    • جدولِ `offering_professors` با **۱۶۰ ارجاع در کد** هیچ ایندکسی روی
--      `offeringId` نداشت. تنها ایندکسش `(role, staffId)` بود که برای
--      `where "offeringId" = X` بی‌فایده است. نتیجه: هر جست‌وجوی «اساتیدِ این
--      ارائه» یک Seq Scan روی کلِ جدول.
--
--    • `course_offerings` هیچ ایندکسی روی `professorId` نداشت، در حالی که
--      کارتابلِ استاد، حقوق، عملکردِ استاد و صورت‌جلسه‌ها همه با
--      `where "professorId" = X` فیلتر می‌کنند.
--
--    • `student_ledger` ایندکسِ `universityId` نداشت؛ صفحاتِ مالی با
--      `where ("universityId" = X or "universityId" is null)` می‌خوانند.
--
--  ⚠ `CONCURRENTLY` باز هم استفاده نشده (توضیحش بالاتر: تراکنشِ واحد).
--    ساختنِ این ایندکس‌ها روی چند صد هزار ردیف در حدِ چند ثانیه است و چون
--    زیرِ `pg_advisory_lock` اجرا می‌شود، هم‌زمانیِ دو دیپلوی مشکلی نمی‌سازد.
-- ═══════════════════════════════════════════════════════════════════════════

-- ۱) اساتیدِ هر ارائه (جهتِ «ارائه → استاد») و برعکس (جهتِ «استاد → ارائه»).
--    هر دو جهت لازم است: کارتابلِ استاد از دومی می‌خواند، حقوق/گلوگاه از اولی.
CREATE INDEX IF NOT EXISTS "idx_op_offering_staff" ON "offering_professors" ("offeringId", "staffId");
CREATE INDEX IF NOT EXISTS "idx_op_staff_offering" ON "offering_professors" ("staffId", "offeringId");

-- ۲) ارائه‌های یک استاد در یک ترم (کارتابلِ استاد، حقوق، صورت‌جلسه).
CREATE INDEX IF NOT EXISTS "idx_co_prof_term" ON "course_offerings" ("professorId", "termId");

-- ۳) گلوگاهِ «نمراتِ قطعی‌نشده» — ایندکسِ جزئی.
--    فقط ثبت‌نام‌های REGISTERED که نمره‌شان FINALIZED نیست ایندکس می‌شوند؛
--    یعنی در عمل چند هزار ردیف، نه کلِ جدول. کوئریِ گلوگاه دقیقاً همین شرط را
--    دارد، پس PostgreSQL می‌تواند فقط همین ایندکس را بخواند و به جدول دست نزند.
--    (`coalesce` تابعِ IMMUTABLE است، پس در predicate مجاز است.)
CREATE INDEX IF NOT EXISTS "idx_enr_pending_grade"
  ON "enrollments" ("offeringId")
  WHERE "status" = 'REGISTERED' AND coalesce("gradeStatus", '') <> 'FINALIZED';

-- ۴) دفتر مالی: «آخرین تراکنش‌های دانشگاه» با `order by id desc limit 10`.
--    ترتیبِ نزولیِ `id` داخلِ خودِ ایندکس است تا Sort حذف شود.
CREATE INDEX IF NOT EXISTS "idx_ledger_uni_id" ON "student_ledger" ("universityId", "id" DESC);

-- ۵) تفکیکِ وصولی بر اساسِ نوع واریز: `where "transactionType"='PAYMENT'`
--    به‌همراهِ محدودهٔ دانشگاه.
CREATE INDEX IF NOT EXISTS "idx_ledger_uni_type" ON "student_ledger" ("universityId", "transactionType", "depositType");
