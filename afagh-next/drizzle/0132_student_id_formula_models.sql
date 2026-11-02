-- 0132_student_id_formula_models.sql
-- کتابخانهٔ «مدل‌های فرمول شمارهٔ دانشجویی» — مثل فهرست مدل‌های ساما.
-- کارشناس چند مدل می‌سازد و هنگام تعریف فرمولِ هر مقطع، از بین آن‌ها انتخاب می‌کند.
-- این جدول فقط «الگو» نگه می‌دارد؛ فرمولِ فعالِ هر مقطع همچنان در
-- student_id_formulas می‌ماند.

BEGIN;

CREATE TABLE IF NOT EXISTS student_id_formula_models (
  id            serial PRIMARY KEY,
  "universityId" integer REFERENCES universities(id),
  title         varchar(150) NOT NULL,
  formula       varchar(255) NOT NULL,
  note          varchar(200),
  "isActive"    boolean NOT NULL DEFAULT true,
  "createdAt"   timestamp NOT NULL DEFAULT now()
);

-- عنوان مدل در هر دانشگاه یکتا (مدل‌های سراسری با universityId = NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_formula_models_uni_title
  ON student_id_formula_models (COALESCE("universityId", 0), title);

-- مدل‌های پایه — فقط اگر جدول خالی باشد (اجرای دوبارهٔ مهاجرت بی‌اثر است)
INSERT INTO student_id_formula_models ("universityId", title, formula, note)
SELECT NULL, v.title, v.formula, v.note
FROM (VALUES
  ('سال + رشته + سریال',            '4051{Year:2}{MajorCode:3}{Seq:3}',    'هر سال از ۰۰۱ شروع می‌شود'),
  ('رشته + سریال (بدون سال)',       '4051{MajorCode:3}{Seq:3}',            'سریال پیوسته در طول سال‌ها'),
  ('سال + مقطع + رشته + سریال',     '4051{Year:2}{DegreeCode:1}{MajorCode:3}{Seq:3}', 'کد مقطع در شماره می‌آید'),
  ('سال ۴ رقمی + رشته + سریال',     '4051{Year:4}{MajorCode:3}{Seq:3}',    'سال کامل مثل ۱۴۰۵'),
  ('سال + رشته + سریال ۴ رقمی',     '4051{Year:2}{MajorCode:3}{Seq:4}',    'ظرفیت ۹۹۹۹ در هر سال'),
  ('سال + رشته + سریال + سال',      '4051{Year:2}{MajorCode:3}{Seq:3}{Year:2}', 'سال در انتها تکرار می‌شود'),
  ('مقطع + رشته + سریال',           '4051{DegreeCode:1}{MajorCode:3}{Seq:3}', 'بدون سال'),
  ('سال + رشته + جنسیت + سریال',    '4051{Year:2}{MajorCode:3}{Gender:1}{Seq:3}', 'جنسیت از فایل سنجش'),
  ('سال + استان + رشته + سریال',    '4051{Year:2}{Province:2}{MajorCode:3}{Seq:3}', 'کد استان محل سکونت'),
  ('سال + رشته + بومی + سریال',     '4051{Year:2}{MajorCode:3}{Settlement:1}{Seq:3}', '۱=بومی، ۲=غیربومی')
) AS v(title, formula, note)
WHERE NOT EXISTS (SELECT 1 FROM student_id_formula_models);

COMMIT;
