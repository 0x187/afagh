-- 0131_formula_add_year.sql
-- افزودن متغیر سال به فرمول شمارهٔ دانشجویی تا شماره‌گذاری هر سال مستقل باشد
-- و بتوان برای هر رشته در هر سال از ۰۰۱ شروع کرد.
-- کد حاصل: 4051 + سال(۲) + کد رشته(۳) + سریال(۳).

BEGIN;

-- ۱) فرمول‌های موجود با پیشوند 4051: درج {Year:2} بلافاصله پس از پیشوند.
--    شرط NOT LIKE باعث می‌شود اجرای دوبارهٔ مهاجرت بی‌اثر باشد (idempotent).
UPDATE student_id_formulas
SET formula = regexp_replace(formula, '^4051(\{)', '4051{Year:2}\1')
WHERE formula LIKE '4051{%'
  AND formula NOT LIKE '%{Year:%';

-- ۲) مقاطعی که دانشجو دارند ولی ردیف فرمول ندارند: فرمول استاندارد بساز تا
--    کدهای جدید هم‌قالب با کدهای موجود (پیشوند 4051) و سال‌محور باشند.
INSERT INTO student_id_formulas ("universityId", "degreeLevelId", "entryYear", formula, "currentSequence")
SELECT 1, d.dl, 1405, '4051{Year:2}{MajorCode:3}{Seq:3}', 0
FROM (SELECT DISTINCT "degreeLevelId" AS dl FROM students WHERE "degreeLevelId" IS NOT NULL) d
WHERE NOT EXISTS (
  SELECT 1 FROM student_id_formulas f WHERE f."degreeLevelId" = d.dl
);

COMMIT;
