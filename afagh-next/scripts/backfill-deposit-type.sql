-- ══════════════════════════════════════════════════════════════════
--  پرکردنِ «نوع واریز» (student_ledger."depositType") از متنِ شرح
--
--  چرا لازم است؟ ردیف‌های مالیِ منتقل‌شده از سیستم قدیمی، نوع واریز را فقط
--  در انتهای متنِ آزادِ description نگه داشته‌اند:
--
--      «پرداخت از سیستم قدیمی — فیش 12345 (نقدي)»
--
--  مهاجرت ۰۱۱۹ ستون ساختاریافتهٔ depositType را می‌سازد ولی مقداری در آن
--  نمی‌گذارد. این اسکریپت همان پرانتزِ آخرِ شرح را استخراج می‌کند تا گزارش
--  «تفکیک وصولی بر اساس نوع واریز» بدون وابستگی به متنِ آزاد کار کند.
--
--  اجرا (مستقیم روی کانتینر postgres):
--
--    docker compose exec -T postgres psql -U afagh -d afagh_db \
--      < afagh-next/scripts/backfill-deposit-type.sql
--
--  idempotent است: فقط ردیف‌هایی را پر می‌کند که depositType شان NULL است،
--  پس اجرای دوباره هیچ چیزی را بازنویسی نمی‌کند و مقدارِ دستی‌ویرایش‌شده را
--  از بین نمی‌برد.
--
--  اعتبارسنجی روی دادهٔ واقعی (۱۴۰۵/۰۸، ترم‌های ۱۴۰۵۱ و قبل):
--    ۱۵۲٬۹۲۸ ردیف PAYMENT — ۰ ردیف بی‌تطبیق، ۱۳ نوع واریز متمایز.
--
--  ⚠️ این اسکریپت فقط «نوع» را از متن استخراج می‌کند و «تاریخ واریز»
--  (depositDate) را دست نمی‌زند — چون متنِ شرح هیچ تاریخی ندارد. تاریخ از
--  جدول StdPays.Fish_Date در دیتابیس سما می‌آید (کلید: referenceId =
--  stdpaysId) و یک‌بار به‌صورت داده‌ای (COPY + UPDATE) منتقل شده است؛
--  برای بازتولید: StdPays را از سما خارج کن، Fish_Date شمسی را با
--  src/lib/calendar.ts (j2d/d2g) به میلادی تبدیل کن، تاریخ‌های خارج از
--  بازهٔ ۱۳۸۵–۱۴۰۵ را NULL بگذار، و در یک TEMP TABLE با COPY بریز و با
--  UPDATE ... FROM به student_ledger."depositDate" وصل کن.
-- ══════════════════════════════════════════════════════════════════
BEGIN;

UPDATE student_ledger
SET "depositType" = substring(description from '\(([^()]*)\)\s*$')
WHERE "transactionType" = 'PAYMENT'
  AND "depositType" IS NULL
  AND description IS NOT NULL
  AND substring(description from '\(([^()]*)\)\s*$') IS NOT NULL;

-- ردیف‌هایی که شرحشان الگو را ندارد (پرداخت‌های ثبت‌شده در خود آفاق) با
-- برچسب صریح مشخص می‌شوند تا در گزارش به‌جای «NULL» زیر «نامشخص» بیایند
-- و از پرداخت‌های واقعاً بی‌نوع قابل تفکیک باشند.
UPDATE student_ledger
SET "depositType" = 'نامشخص'
WHERE "transactionType" = 'PAYMENT'
  AND "depositType" IS NULL;

COMMIT;

-- گزارش تأیید پس از اجرا:
--   SELECT "depositType", count(*), sum(amount)
--   FROM student_ledger WHERE "transactionType" = 'PAYMENT'
--   GROUP BY 1 ORDER BY 2 DESC;
