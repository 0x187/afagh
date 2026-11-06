-- 0121_legacy_payment_provenance
-- افزودن ستون‌های مستندسازت پرداختِ مهاجرت‌یافته از سیستم قدیمی (سما) به
-- student_ledger. کلید اتصال بک‌فیل: referenceId = StdPays.stdpaysId.
-- جدول از پیش RLS دارد (ستون studentId)؛ این افزودنی‌ها سیاست را تغییر نمی‌دهند.

ALTER TABLE "public"."student_ledger"
  ADD COLUMN IF NOT EXISTS "payerName" varchar(120),
  ADD COLUMN IF NOT EXISTS "payerNationalCode" varchar(12),
  ADD COLUMN IF NOT EXISTS "receiptNo" varchar(40),
  ADD COLUMN IF NOT EXISTS "voucherNo" varchar(80),
  ADD COLUMN IF NOT EXISTS "payTypeCode" integer,
  ADD COLUMN IF NOT EXISTS "accountNo" varchar(30),
  ADD COLUMN IF NOT EXISTS "cardNo" varchar(30),
  ADD COLUMN IF NOT EXISTS "bankName" varchar(60),
  ADD COLUMN IF NOT EXISTS "branchName" varchar(60),
  ADD COLUMN IF NOT EXISTS "recorderCode" integer,
  ADD COLUMN IF NOT EXISTS "recorderName" varchar(120),
  ADD COLUMN IF NOT EXISTS "legacyRem" text;

-- شاخص کمکی برای جستجوی پرداخت‌ها بر اساس شماره فیش (گزارش‌های مالی).
CREATE INDEX IF NOT EXISTS "idx_student_ledger_receipt_no"
  ON "public"."student_ledger" ("receiptNo");
