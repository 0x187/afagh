-- ────────────────────────────────────────────────────────────────────────
--  «اصلی» و «تخصصی» دو نوعِ متفاوت‌اند، نه یکی.
--
--  در بانک دروس (courses.courseType) شش نوع جدا داریم — عمومی، پایه، اصلی،
--  تخصصی، اختیاری، جبرانی — و هر کدام کد و تعریف خودش را دارد. ولی نقشِ
--  چارت فقط هفت مقدار داشت و «تخصصی» بی‌صدا به «اصلی» (MAJOR) تبدیل می‌شد؛
--  نتیجه: در کاتالوگ هیچ درسی با برچسب «تخصصی» دیده نمی‌شد.
--
--  اکنون نقش هشتم اضافه می‌شود: SPECIALIZED = تخصصی.
--  (MAJOR همان «اصلی» می‌ماند تا ۴۰۳ ردیف موجود جابه‌جا نشوند.)
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
    'WORKSHOP'::character varying     -- کارگاه
  ]::text[]));
