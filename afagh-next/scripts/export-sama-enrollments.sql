/*
 * ══════════════════════════════════════════════════════════════════════
 *  استخراجِ فایل انتخاب واحد سما برای همگام‌سازی هفتگی
 * ══════════════════════════════════════════════════════════════════════
 *
 *  خروجی این کوئری همان چیزی است که `scripts/sama-sync.ts` می‌خواند.
 *
 *  ── اجرا (روی ویندوزِ آموزش، همان‌جا که SQL Server سما هست) ──
 *    sqlcmd -S "127.0.0.1,62133" -E -d uems -f 65001 -y 0 \
 *           -i export-sama-enrollments.sql -o enr.tsv
 *
 *  ⚠ نکته‌ها:
 *   • `-f 65001` لازم است، وگرنه فارسی/ارقام خراب می‌شود. با `-y 0` هیچ
 *     ستونی بریده نمی‌شود؛ `-W` و `-h` را با `-y 0` قاطی نکنید (تعارض دارند).
 *   • پارامتر ترم را عوض کنید یا با `-v TermCode=14051` بدهید.
 *   • ستون‌ها عمداً به ترتیبِ متعارف‌اند تا اگر روزی سرستون حذف شد، پارسر
 *     بتواند فایل را بخواند.
 *
 *  ── نقشهٔ جداول سما ──
 *    انتخاب واحد : LT52 (ارائهٔ ترم) + StdCourse
 *    درس         : LT7.Code
 *    گروه        : LT52.GroupNo
 *    نمره        : StdCourse.Mark
 *    وضعیت نمره  : StdCourse.Status (کد وضعیت سما)
 */

SET NOCOUNT ON;

DECLARE @TermCode INT = $(TermCode);

SELECT
    LTRIM(RTRIM(CONVERT(VARCHAR(20), sc.Stno)))            AS Stno,
    CONVERT(VARCHAR(10), sc.TermCode)                       AS TermCode,
    LTRIM(RTRIM(CONVERT(VARCHAR(20), sc.LessonCode)))       AS LessonCode,
    LTRIM(RTRIM(CONVERT(VARCHAR(10), sc.LessonGroup)))      AS LessonGroup,
    CASE WHEN sc.Mark IS NULL THEN '' ELSE CONVERT(VARCHAR(10), sc.Mark) END AS Mark,
    ISNULL(LTRIM(RTRIM(CONVERT(VARCHAR(10), sc.Status))), '') AS Status
FROM StdCourse sc
WHERE sc.TermCode = @TermCode
ORDER BY sc.Stno, sc.LessonCode, sc.LessonGroup;
