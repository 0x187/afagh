-- ────────────────────────────────────────────────────────────────────────
--  «جبرانی» (COMPENSATORY) نهمین نقشِ رسمیِ چارت می‌شود.
--
--  تا پیش از این درسِ جبرانی فقط به‌عنوان «سهم واحد» (خارج از چارت رسمی)
--  در ویرایشگر سطرِ نقش معنا داشت و در ستون roleType ذخیره نمی‌شد؛ نتیجه
--  این بود که در لیستِ «نوع درس» همهٔ انواع نمایش داده نمی‌شد و مدیر گروه
--  نمی‌توانست یک درس را صراحتاً «جبرانی» علامت بزند.
--
--  اکنون نقش نهم اضافه می‌شود: COMPENSATORY = جبرانی.
--  (همچنین SPECIALIZED که در مهاجرت ۰۱۲۳ روی دیتابیس زنده اعمال شده بود ولی
--   در schema.ts جا مانده بود، اینجا در لیستِ کامل بازنویسی می‌شود تا دو
--   منبع همگام بمانند.)
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "curriculum_courses" DROP CONSTRAINT IF EXISTS "curriculum_courses_role_check";
--> statement-breakpoint
ALTER TABLE "curriculum_courses" ADD CONSTRAINT "curriculum_courses_role_check"
  CHECK ("roleType"::text = ANY (ARRAY[
    'CORE'::character varying,        -- پایه
    'MAJOR'::character varying,       -- اصلی
    'SPECIALIZED'::character varying, -- تخصصی
    'ELECTIVE'::character varying,    -- اختیاری
    'GENERAL'::character varying,     -- عمومی
    'THESIS'::character varying,      -- پایان‌نامه
    'INTERNSHIP'::character varying,  -- کارآموزی
    'WORKSHOP'::character varying,    -- کارگاه
    'COMPENSATORY'::character varying -- جبرانی
  ]::text[]));
