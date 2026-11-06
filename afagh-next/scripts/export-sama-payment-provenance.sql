-- export-sama-payment-provenance.sql
-- خروجیِ TSV (جداکنندهٔ TAB) از سما برای بک‌فیلِ مستندسازت پرداخت در آفاق.
-- اجرا روی سرور سما (SQL Server) با sqlcmd و ذخیره در فایل:
--
--   sqlcmd -S "127.0.0.1,62133" -E -d uems -f 65001 -h -1 -W \
--     -i scripts/export-sama-payment-provenance.sql -o scripts/legacy-payment-provenance.tsv
--
-- نکته: رشته‌ها با CHAR(9) (تب) به‌هم چسبانده شده‌اند؛ مقادیر NULL با ''
-- جایگزین شده‌اند. ستون Rem به‌صورت خام می‌آید و استخراج «شماره کارت»
-- در سمت Node (اسکریپت بک‌فیل) انجام می‌شود.

SELECT
    CAST(p.stdpaysId AS varchar(20)) + CHAR(9) +
    ISNULL(v.NAME, '')            + CHAR(9) +
    ISNULL(v.NationalCode, '')    + CHAR(9) +
    CAST(p.Fish_no AS varchar(40)) + CHAR(9) +
    ISNULL(p.SanadNumber, '')     + CHAR(9) +
    CAST(p.pay_type AS varchar(10)) + CHAR(9) +
    ISNULL(CAST(p.Acc_No AS varchar(30)), '') + CHAR(9) +
    ISNULL(p.BankName, '')        + CHAR(9) +
    ISNULL(p.BranchName, '')      + CHAR(9) +
    CAST(ISNULL(p.userCode, -1) AS varchar(10)) + CHAR(9) +
    ISNULL(u.FullName, '')        + CHAR(9) +
    ISNULL(p.Rem, '')
FROM StdPays p
LEFT JOIN VW_StdPays v
    ON v.Stno = p.Stno AND v.TermCode = p.TermCode AND v.Fish_no = p.Fish_no
LEFT JOIN Users u
    ON u.Code = p.userCode
ORDER BY p.stdpaysId;
