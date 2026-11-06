-- منبع پذیرش هر پرونده دانشجویی (سنجش / متفرقه / قدیمی)
-- پرونده‌های موجود قبل از این مهاجرت منبعشان ثبت نشده، پس LEGACY علامت می‌خورند.
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "admissionSource" varchar(20);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "sanjeshFileId" integer;
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "sanjeshRowNo" integer;
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "manualReason" text;
--> statement-breakpoint
UPDATE "students" SET "admissionSource" = 'LEGACY' WHERE "admissionSource" IS NULL;
--> statement-breakpoint
ALTER TABLE "students" ALTER COLUMN "admissionSource" SET DEFAULT 'LEGACY';
--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_admission_source_check"
  CHECK ("admissionSource" IN ('SANJESH', 'MANUAL', 'LEGACY'));
