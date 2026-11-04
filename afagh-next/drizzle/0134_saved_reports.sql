-- 0134_saved_reports.sql
-- گزارش‌ساز: تعریفِ گزارش‌ها به‌صورت «داده» ذخیره می‌شود، نه کد.
-- هر مدیر می‌تواند منبع/ستون/شرط/گروه‌بندی را خودش بچیند، به گزارش نام بدهد
-- و آن را (خصوصی یا اشتراکی) برای اجرا در اختیار دیگران بگذارد.
--
-- چرا jsonb: شکلِ گزارش پیوسته تغییر می‌کند (ستون تازه، شرط تازه، تجمیع تازه)؛
-- با jsonb افزودن قابلیت تازه به گزارش‌ساز هیچ مهاجرتِ اسکیمایی نمی‌خواهد.
--
-- 🔒 این جدول دادهٔ دانشجویی نگه نمی‌دارد (آن در student_ledger است)؛ فقط
-- «تعریفِ گزارش» است. هیچ SQL آزادی اینجا ذخیره نمی‌شود: نامِ ستون و
-- عملگر از کاتالوگِ کد می‌آید و فقط مقدارِ فیلتر bind parameter می‌شود.

BEGIN;

CREATE TABLE IF NOT EXISTS saved_reports (
  id             serial PRIMARY KEY,
  "universityId" integer NOT NULL REFERENCES universities(id),
  name           varchar(150) NOT NULL,
  description    text,
  "sourceKey"    varchar(60) NOT NULL,
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility     varchar(20) NOT NULL DEFAULT 'PRIVATE',
  "allowedRoles" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "ownerUserId"  integer NOT NULL REFERENCES users(id),
  "createdAt"    timestamp NOT NULL DEFAULT now(),
  "updatedAt"    timestamp NOT NULL DEFAULT now()
);

-- نامِ گزارش در هر دانشگاه یکتاست تا دو گزارش هم‌نام مبهم نشوند
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_reports_uni_name
  ON saved_reports ("universityId", name);

CREATE INDEX IF NOT EXISTS idx_saved_reports_uni
  ON saved_reports ("universityId");

CREATE INDEX IF NOT EXISTS idx_saved_reports_owner
  ON saved_reports ("ownerUserId");

COMMIT;
