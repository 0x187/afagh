-- ────────────────────────────────────────────────────────────────────────
--  ماژول «تبدیل اطلاعات سازمان سنجش» — بازسازی جریان ۶ مرحله‌ای ساما
--
--  پنج جدول جدید:
--    sanjesh_templates   ← قالب ساختار فایل؛ **کاربر می‌تواند تعریف کند**
--    sanjesh_files       ← هر فایل بارگذاری‌شده (یک آزمون/یک سال)
--    sanjesh_file_fields ← تطبیق فیلدها: شماره ستون ↔ فیلد مقصد
--    sanjesh_file_rows   ← دادهٔ خام هر داوطلب (کامل و بی‌کم‌وکاست)
--    sanjesh_value_maps  ← جدول «براورد» (کد سنجش ↔ عنوان/کد داخلی)
--
--  اصل طراحی: **هیچ داده‌ای از فایل سنجش دور ریخته نمی‌شود.**
--  ستون‌هایی که به فیلد مقصد نگاشت نشده‌اند هم در dataJson با کلید
--  شمارهٔ ستون ذخیره می‌شوند. تغییر ساختار در سال‌های آینده (کم/زیاد شدن
--  فیلدها) داده‌ای از دست نمی‌دهد و پارس شکست نمی‌خورد.
--
--  ⚠ همهٔ جدول‌ها RLS فعال دارند (deny-all برای نقش afagh_app) چون
--    ستون‌های هویتی دارند (userId / studentId) و گاردِ fail-closed
--    scripts/hardening.mjs بدون آن‌ها استقرار را متوقف می‌کند.
--
--  ⚠ چنددانشگاهی: `universityId` روی **همهٔ** پنج جدول هست. حتی جدول‌های
--    فرزند (fields/rows/value_maps) آن را از فایل والد به ارث می‌برند تا
--    هر کوئری بتواند بدون JOIN هم دامنه را محدود کند. هیچ کوئری‌ای نباید
--    بدون فیلتر دانشگاه اجرا شود.
-- ────────────────────────────────────────────────────────────────────────

-- ── ۱. قالب‌های ساختار (قابل تعریف توسط کاربر) ──
CREATE TABLE IF NOT EXISTS "sanjesh_templates" (
  "id" serial PRIMARY KEY,
  -- کلید یکتا؛ برای قالب‌های پیش‌فرض همان کلید کد است (FANI_1405 …)
  "key" varchar(60) NOT NULL,
  "title" varchar(200) NOT NULL,
  "examKind" varchar(20) NOT NULL,                    -- FANI | ARSHAD | K2K | SARASARI
  "examYear" integer NOT NULL,
  "columnCount" integer NOT NULL,
  "pdfRowCount" integer,
  -- آرایهٔ ستون‌ها: [{ colIndex, sanjeshTitle, charCount, targetField }]
  "columnsJson" jsonb NOT NULL,
  -- جدول‌های براورد: { gender: [{ value, label, internalValue }], … }
  "decodeTablesJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- ردیف‌هایی که در ساختار PDF بسط خورده‌اند (فقط برای توضیح در UI)
  "expandedRowsJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notes" text,
  -- قالب پیش‌فرض کد؛ در UI فقط «کپی» می‌شود نه ویرایش
  "isBuiltin" boolean NOT NULL DEFAULT false,
  "verifiedWithRealFile" boolean NOT NULL DEFAULT false,
  "isActive" boolean NOT NULL DEFAULT true,
  "universityId" integer REFERENCES "universities"("id"),
  "createdByUserId" integer REFERENCES "users"("id"),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
-- کلید قالب در دامنهٔ هر دانشگاه یکتاست؛ قالب‌های سراسری (universityId = NULL)
-- با COALESCE به ۰ نگاشت می‌شوند تا قید یکتایی NULL-متمایز را دور بزنیم.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sanjesh_templates_key"
  ON "sanjesh_templates" (COALESCE("universityId", 0), "key");
CREATE INDEX IF NOT EXISTS "idx_sanjesh_templates_kind_year"
  ON "sanjesh_templates" ("examKind", "examYear");
CREATE INDEX IF NOT EXISTS "idx_sanjesh_templates_uni"
  ON "sanjesh_templates" ("universityId");

-- ── ۲. فایل‌های بارگذاری‌شده ──
CREATE TABLE IF NOT EXISTS "sanjesh_files" (
  "id" serial PRIMARY KEY,
  "universityId" integer REFERENCES "universities"("id"),
  "termId" integer REFERENCES "academic_terms"("id"),
  "degreeLevelId" integer REFERENCES "degree_level_configs"("id"),
  "templateId" integer REFERENCES "sanjesh_templates"("id"),
  "templateKey" varchar(60),
  "title" varchar(200) NOT NULL,
  "examKind" varchar(20),
  "examYear" integer,
  "fileName" varchar(255),
  "fileSize" integer,
  "fileHash" varchar(64),                              -- SHA-256 برای تشخیص بارگذاری تکراری
  "encoding" varchar(20),                              -- utf-16le | utf-8 | windows-1256
  "columnCount" integer NOT NULL DEFAULT 0,
  "rowCount" integer NOT NULL DEFAULT 0,
  -- DRAFT | FIELDS_READY | VALUED | STAGED | DONE
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "warningsJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "uploadedByUserId" integer REFERENCES "users"("id"),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_sanjesh_files_status" ON "sanjesh_files" ("status");
CREATE INDEX IF NOT EXISTS "idx_sanjesh_files_term" ON "sanjesh_files" ("termId");
CREATE INDEX IF NOT EXISTS "idx_sanjesh_files_hash" ON "sanjesh_files" ("fileHash");
CREATE INDEX IF NOT EXISTS "idx_sanjesh_files_uni" ON "sanjesh_files" ("universityId");

-- ── ۳. تطبیق فیلدها (ستون ↔ فیلد مقصد) ──
CREATE TABLE IF NOT EXISTS "sanjesh_file_fields" (
  "id" serial PRIMARY KEY,
  "fileId" integer NOT NULL REFERENCES "sanjesh_files"("id") ON DELETE CASCADE,
  -- از فایل والد به ارث می‌رسد تا دامنه‌بندی بدون JOIN ممکن باشد
  "universityId" integer REFERENCES "universities"("id"),
  "colIndex" integer NOT NULL,
  "sanjeshTitle" varchar(200) NOT NULL,
  "charCount" integer NOT NULL DEFAULT 0,
  "targetField" varchar(60),                           -- null ⇒ نگاشت‌نشده
  "sampleValue" text,
  "observedLength" integer,
  "isMapped" boolean NOT NULL DEFAULT false,
  CONSTRAINT "uq_sanjesh_file_fields" UNIQUE ("fileId", "colIndex")
);
CREATE INDEX IF NOT EXISTS "idx_sanjesh_file_fields_file" ON "sanjesh_file_fields" ("fileId");
CREATE INDEX IF NOT EXISTS "idx_sanjesh_file_fields_uni" ON "sanjesh_file_fields" ("universityId");

-- ── ۴. دادهٔ خام هر داوطلب — کامل و بی‌کم‌وکاست ──
CREATE TABLE IF NOT EXISTS "sanjesh_file_rows" (
  "id" serial PRIMARY KEY,
  "fileId" integer NOT NULL REFERENCES "sanjesh_files"("id") ON DELETE CASCADE,
  -- از فایل والد به ارث می‌رسد؛ این جدول PII کامل دارد
  "universityId" integer REFERENCES "universities"("id"),
  "rowNo" integer NOT NULL,
  -- خط اصلی فایل، بدون هیچ دستکاری (برای بازتولید و ممیزی)
  "rawLine" text NOT NULL,
  -- { fields: {targetField: value}, columns: {"1": "…"}, meta: {…} }
  "dataJson" jsonb NOT NULL,
  -- استخراج‌شده برای جستجو/تطبیق (منبع حقیقت همچنان dataJson است)
  "nationalCode" varchar(10),
  "nationalCodeEnc" text,
  "nationalCodeBlindIndex" text,
  "nationalCodeValid" boolean NOT NULL DEFAULT false,
  "applicantNo" varchar(40),
  "uniqueId" varchar(40),
  "fullName" varchar(200),
  "rowHash" varchar(16),                               -- تشخیص ردیف تکراری
  -- نتیجهٔ تطبیق
  "studentId" integer REFERENCES "students"("id"),
  "matchStatus" varchar(20) NOT NULL DEFAULT 'PENDING', -- PENDING | MATCHED | DUPLICATE | INVALID | IGNORED
  "matchNote" text,
  "matchedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "uq_sanjesh_file_rows" UNIQUE ("fileId", "rowNo")
);
CREATE INDEX IF NOT EXISTS "idx_sanjesh_file_rows_file" ON "sanjesh_file_rows" ("fileId");
CREATE INDEX IF NOT EXISTS "idx_sanjesh_file_rows_nc" ON "sanjesh_file_rows" ("nationalCode");
CREATE INDEX IF NOT EXISTS "idx_sanjesh_file_rows_nc_blind" ON "sanjesh_file_rows" ("nationalCodeBlindIndex");
CREATE INDEX IF NOT EXISTS "idx_sanjesh_file_rows_status" ON "sanjesh_file_rows" ("matchStatus");
CREATE INDEX IF NOT EXISTS "idx_sanjesh_file_rows_hash" ON "sanjesh_file_rows" ("fileId", "rowHash");
CREATE INDEX IF NOT EXISTS "idx_sanjesh_file_rows_uni" ON "sanjesh_file_rows" ("universityId");

-- ── ۵. جدول براورد (کد سنجش ↔ عنوان) ──
CREATE TABLE IF NOT EXISTS "sanjesh_value_maps" (
  "id" serial PRIMARY KEY,
  -- fileId تهی ⇒ نگاشت سراسری (پیش‌فرض همهٔ فایل‌ها)
  "fileId" integer REFERENCES "sanjesh_files"("id") ON DELETE CASCADE,
  "universityId" integer REFERENCES "universities"("id"),
  "field" varchar(60) NOT NULL,
  "sanjeshValue" varchar(100) NOT NULL,
  "sanjeshLabel" varchar(200),
  "internalValue" varchar(60),
  "internalLabel" varchar(200),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "uq_sanjesh_value_maps" UNIQUE ("fileId", "field", "sanjeshValue")
);
CREATE INDEX IF NOT EXISTS "idx_sanjesh_value_maps_field" ON "sanjesh_value_maps" ("field");
CREATE INDEX IF NOT EXISTS "idx_sanjesh_value_maps_uni" ON "sanjesh_value_maps" ("universityId");

-- ── ۶. گسترش جدول‌های موجود (بدون جدول موازی) ──
ALTER TABLE "admissions_staging"
  ADD COLUMN IF NOT EXISTS "fileId" integer REFERENCES "sanjesh_files"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "rowNo" integer,
  ADD COLUMN IF NOT EXISTS "assignedStudentCode" varchar(14),
  ADD COLUMN IF NOT EXISTS "matchedAt" timestamp;

CREATE INDEX IF NOT EXISTS "idx_adm_stg_file" ON "admissions_staging" ("fileId", "rowNo");

-- sanjesh_mappings: fileId تهی ⇒ نگاشت سراسری؛ مقدار‌دار ⇒ override همان فایل
ALTER TABLE "sanjesh_mappings"
  ADD COLUMN IF NOT EXISTS "fileId" integer REFERENCES "sanjesh_files"("id") ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS "note" varchar(200);

CREATE INDEX IF NOT EXISTS "idx_sanjesh_mappings_file" ON "sanjesh_mappings" ("fileId");

-- ── ۷. RLS — deny-all برای نقش اپ (دسترسی فقط از استخر مالک) ──
ALTER TABLE "sanjesh_templates"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sanjesh_files"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sanjesh_file_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sanjesh_file_rows"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sanjesh_value_maps"  ENABLE ROW LEVEL SECURITY;
