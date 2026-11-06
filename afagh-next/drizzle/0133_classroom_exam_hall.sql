-- 0133: افزودن قابلیت «سالن امتحان» و ظرفیت امتحان به کلاس‌ها
ALTER TABLE classrooms
  ADD COLUMN IF NOT EXISTS "isExamHall" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "examCapacity" integer;

-- بروزرسانی ردیف‌های موجود: به‌طور پیش‌فرض غیرفعال
UPDATE classrooms SET "isExamHall" = 0 WHERE "isExamHall" IS NULL;