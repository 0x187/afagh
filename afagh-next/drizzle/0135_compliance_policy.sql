-- 0135_compliance_policy.sql
-- انطباق آییننامهٔ ۱۴۰۲ + اصلاحیهٔ مادهٔ ۱۲ + بخشنامهٔ مادهٔ ۱۱
--
-- رفتار صحیح قانونی در کد «پیشفرض» است؛ این مهاجرت فقط جای «قابل تغییر
-- کردنش» را فراهم میکند:
--   ۱) اورراید دامنهدار (دانشگاه / مقطع / آییننامه / سال ورود) همراه با دلیل،
--   ۲) موجودیت «ارزیابی جامع» دکتری (مادهٔ ۴۱)،
--   ۳) دادهٔ ساختاریافتهای که مادهٔ ۱۲ اصلاحی برای اجرا لازم دارد
--      (تاریخ انصراف/اخراج، تأیید دانشگاه مقصد، ضریب کیفیت، مدرک رسمی)،
--   ۴) نمرهٔ کیفی پایاننامه/رساله (مواد ۳۶ و ۴۸).
--
-- همهٔ عبارتها idempotentاند تا اجرای دوباره یا استقرار روی محیط نیمههمگام
-- نشکند. هیچ دادهٔ موجودی بازنویسی نمیشود.

BEGIN;

CREATE TABLE IF NOT EXISTS compliance_policy_overrides (
  id             serial PRIMARY KEY,
  "universityId" integer REFERENCES universities(id),
  "degreeLevelId" integer,
  "regulationId" integer,
  "entryYear"    integer,
  key            varchar(80) NOT NULL,
  value          jsonb NOT NULL,
  reason         text NOT NULL DEFAULT '',
  "updatedBy"    integer,
  "updatedAt"    timestamp NOT NULL DEFAULT now(),
  "createdAt"    timestamp NOT NULL DEFAULT now()
);

-- یک اورراید بهازای هر دامنهٔ دقیق؛ NULLها با ۰ یکسانسازی میشوند تا
-- «سراسری» و «همهدانشگاهها» تداخل نکنند.
CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_override_scope
  ON compliance_policy_overrides (
    COALESCE("universityId", 0),
    COALESCE("degreeLevelId", 0),
    COALESCE("regulationId", 0),
    COALESCE("entryYear", 0),
    key
  );
CREATE INDEX IF NOT EXISTS idx_compliance_override_uni
  ON compliance_policy_overrides ("universityId");
CREATE INDEX IF NOT EXISTS idx_compliance_override_key
  ON compliance_policy_overrides (key);

-- مادهٔ ۴۱: ارزیابی جامع دکتری (قبل از این هیچ جدولی وجود نداشت)
CREATE TABLE IF NOT EXISTS comprehensive_exams (
  id              serial PRIMARY KEY,
  "studentId"     integer NOT NULL REFERENCES students(id),
  "attemptNo"     integer NOT NULL DEFAULT 1,
  "examDate"      varchar(10),
  "gradeValue"    numeric(5,2),
  result          varchar(20) NOT NULL DEFAULT 'PENDING',
  "languageConfirmed" integer NOT NULL DEFAULT 0,
  "alternativeCode" varchar(50),
  "alternativeConfirmed" integer NOT NULL DEFAULT 0,
  notes           text,
  "universityId"  integer REFERENCES universities(id),
  "createdAt"     timestamp NOT NULL DEFAULT now(),
  "updatedAt"     timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_comprehensive_exam_attempt
  ON comprehensive_exams ("studentId", "attemptNo");
CREATE INDEX IF NOT EXISTS idx_comprehensive_exam_student
  ON comprehensive_exams ("studentId");

-- اصلاحیهٔ ۲/۱۵۵۶۵۵: مبدأ پنج سال «تاریخ انصراف یا اخراج در دورهٔ قبلی» است
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS "withdrawalOrExpulsionDate" varchar(10),
  ADD COLUMN IF NOT EXISTS "previousProgramExitType" varchar(30),
  ADD COLUMN IF NOT EXISTS "equivDestinationConfirmed" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "equivDestinationNote" text,
  ADD COLUMN IF NOT EXISTS "equivCurriculumVersionCode" varchar(50),
  ADD COLUMN IF NOT EXISTS "equivQualityCoefficient" numeric(5,3),
  ADD COLUMN IF NOT EXISTS "equivSourceOfficialDegree" integer NOT NULL DEFAULT 0;

-- مادهٔ ۷ (بند ۳/۱۶): پرچم «مشمول نمرهٔ صفر» روی ثبتنام درس
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS "absencePenalty" integer NOT NULL DEFAULT 0;

-- مواد ۳۶ و ۴۸: نمرهٔ کیفی پایاننامه/رساله، خارج از معدل
ALTER TABLE defense_sessions
  ADD COLUMN IF NOT EXISTS "qualitativeGrade" varchar(50),
  ADD COLUMN IF NOT EXISTS "defenseDate" varchar(10);

COMMIT;
