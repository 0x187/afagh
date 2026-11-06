-- ══════════════════════════════════════════════════════════════════════
--  استخراج «دلیل تخفیف» از سما (UEMS) برای backfill در آفاق
-- ══════════════════════════════════════════════════════════════════════
--
--  دلیل تخفیف در سما دو جا نگه داشته می‌شود:
--    ▸ PercentBates.Rem — تخفیف‌های درصدی (Fix_Per / Units_Per)
--    ▸ Mab_Bates.Rem     — تخفیف‌های مبلغی
--  یک دانشجو-ترم می‌تواند چند ردیف داشته باشد (تا ۴ مورد دیده شده)، پس
--  دلایل یکتا با « · » به هم چسبانده می‌شوند.
--
--  اجرا (خروجی UTF-8 با جداکنندهٔ | و بدون سرستون):
--
--    sqlcmd -S "127.0.0.1,62133" -E -d uems -f 65001 -W -s "|" -h -1 ^
--           -i export-bates-reason.sql -o bates_reason.tsv
--
--  سپس: node scripts/backfill-bates-reason.mjs <dir>
-- ══════════════════════════════════════════════════════════════════════
SET NOCOUNT ON;

WITH r AS (
  SELECT stno, TermCode,
         NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(ISNULL(Rem, ''), CHAR(13), ' '), CHAR(10), ' '))), '') AS rem
    FROM PercentBates
  UNION ALL
  SELECT stno, TermCode,
         NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(ISNULL(Rem, ''), CHAR(13), ' '), CHAR(10), ' '))), '') AS rem
    FROM Mab_Bates
),
d AS (
  SELECT DISTINCT stno, TermCode, rem
    FROM r
   WHERE rem IS NOT NULL
     AND rem <> '0'   -- «0» یعنی دلیلی ثبت نشده، نه دلیلِ صفر
)
SELECT stno, TermCode, STRING_AGG(rem, ' · ') WITHIN GROUP (ORDER BY rem) AS reason
  FROM d
 GROUP BY stno, TermCode
 ORDER BY stno, TermCode;
