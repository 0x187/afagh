-- «نوع واریز» و «تاریخ واریز» در دفتر مالی — گزارش تفکیک وصولی
--
-- چرا؟ صفحهٔ /admin/student-finance می‌خواست وصولی‌ها را بر اساس روش پرداخت
-- (نقدی، چک، کارت‌خوان، پرداخت آنلاین، وام، سهم بنیاد، …) تفکیک کند، ولی
-- `student_ledger` هیچ ستون ساختاریافته‌ای برای این کار نداشت و تنها منبع،
-- متنِ آزادِ `description` بود. گزارش‌گیری روی متنِ آزاد شکننده است.
--
-- ستون‌ها nullable هستند تا ردیف‌های موجود بی‌خطر بمانند. پرکردنِ `depositType`
-- از متنِ شرح در `scripts/backfill-deposit-type.sql` انجام می‌شود (جدا از مهاجرت،
-- تا روی دیتابیسِ بزرگ ۱۵۳ هزار ردیفی، مهاجرت سبک بماند و اجرای دوباره‌اش ارزان).
--
-- `depositDate` عمداً در مهاجرت از سیستم قدیمی منتقل نشده و NULL می‌ماند:
-- جداول جزئیاتِ چک/پرداخت آنلاینِ سما برای این ترم خالی‌اند و تاریخ واقعیِ واریز
-- در دادهٔ موجود نیست. تا وقتی از مبدأ دوباره وارد نشود، NULL صادقانه‌ترین مقدار است.
--
-- idempotent است: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE "student_ledger" ADD COLUMN IF NOT EXISTS "depositType" varchar(50);
ALTER TABLE "student_ledger" ADD COLUMN IF NOT EXISTS "depositDate" timestamp;

-- فیلترِ گزارشِ تفکیک وصولی بر اساس نوع واریز.
CREATE INDEX IF NOT EXISTS "idx_student_ledger_deposit_type"
  ON "student_ledger" ("depositType");
