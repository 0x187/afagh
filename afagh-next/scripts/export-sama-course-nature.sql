-- export-sama-course-nature.sql
-- خروجی TSV از «نوع درس آموزشی» سما (LT9.Title) برای هر درس (LT7.Code).
-- اجرا:
--   sqlcmd -S "127.0.0.1,62133" -E -d uems -f 65001 -y 0 \
--     -i scripts/export-sama-course-nature.sql -o scripts/sama-course-nature.tsv
SELECT
    CAST(l.Code AS varchar(20)) + CHAR(9) + ISNULL(n.Title, '')
FROM LT7 l
LEFT JOIN LT9 n ON n.Code = l.Type
WHERE n.Title IS NOT NULL AND LTRIM(RTRIM(n.Title)) <> N''
ORDER BY l.Code;
