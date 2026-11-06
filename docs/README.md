# مستندات آفاق — نقشهٔ راه

> ورودیهای سریع: راهنمای توسعه → [`ENGINEERING-GUIDE.md`](./ENGINEERING-GUIDE.md) · وضعیت بازنویسی → [`REWRITE-STATUS.md`](./REWRITE-STATUS.md) · معماری → [`ARCHITECTURE.md`](./ARCHITECTURE.md)
> تاریخ هر فایل، آخرین کامیت آن است؛ اسناد مهر/آبانِ ۱۴۰۵ میراث دورهٔ Next.js هستند (مفاهیمشان مبنای پورت بود) و اسناد آبان ۱ الانِ نسخهٔ Go/Reactاند.

## ۱) شروع و توسعه

| سند | محتوا | تاریخ |
|---|---|---|
| [`../README.md`](../README.md) | معرفی سامانه و اجرا | — |
| [`../INSTALL.md`](../INSTALL.md) | نصب و راهاندازی | — |
| [`ENGINEERING-GUIDE.md`](./ENGINEERING-GUIDE.md) | **راهنمای مهندسی Go/React**: ساختار، قوانین، دستور پخت افزودن فیچر | 2026-11-01 |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | هاب معماری (چهار بخش در `architecture/`) | 2026-10-13 |
| [`architecture/01-foundation.md`](./architecture/01-foundation.md) · [`02-student.md`](./architecture/02-student.md) · [`03-professor.md`](./architecture/03-professor.md) · [`04-admin-engines.md`](./architecture/04-admin-engines.md) | دیدگاه نرمافزاری به تفکیک | 2026-10-13 |
| [`REWRITE-STATUS.md`](./REWRITE-STATUS.md) | وضعیت بازنویسی Go+React، ممیزی پاریتی، سوییچ | 2026-11-01 |
| [`CODE-REVIEW.md`](./CODE-REVIEW.md) | استاندارد و فرآیند بازبینی کد | 2026-11-01 |
| [`COMMIT-HISTORY.md`](./COMMIT-HISTORY.md) | تاریخچهٔ کامل کامیت‌های مخزن | 2026-11-06 |
| [`design/`](./design/) | طراحی زمانبندی/کاتالوگ + ممیزیها + ERD | 2026-10-24 |
| [`design-system/`](./design-system/) | توکنهای CSS و نمونهٔ دیزاینسیستم | 2026-10-18 |
| [`rewrite/phase1-contracts.md`](./rewrite/phase1-contracts.md) | قراردادهای فاز ۱ بازنویسی | 2026-10-25 |

## ۲) عملیات و استقرار (`ops/` و ریشه)

| سند | محتوا | تاریخ |
|---|---|---|
| [`DEPLOY-FINAL-RUNBOOK.md`](./DEPLOY-FINAL-RUNBOOK.md) | رانبوک استقرار نهایی | 2026-10-19 |
| [`DEPLOY-SECURITY-CHECKLIST.md`](./DEPLOY-SECURITY-CHECKLIST.md) | چکلیست امنیتی استقرار | 2026-10-19 |
| [`POST-DEPLOY-SMOKE.md`](./POST-DEPLOY-SMOKE.md) | دود آزمایش پس از استقرار | 2026-10-19 |
| [`RELEASE-READINESS.md`](./RELEASE-READINESS.md) | آمادگی ریلیز | 2026-10-19 |
| [`MONITORING.md`](./MONITORING.md) | پایش | 2026-10-19 |
| [`INCIDENT-RESPONSE-RUNBOOK.md`](./INCIDENT-RESPONSE-RUNBOOK.md) | واکنش به رخداد | 2026-10-19 |
| [`DR-DRILL.md`](./DR-DRILL.md) · [`BACKUP-DR-REVIEW.md`](./BACKUP-DR-REVIEW.md) | بازیابی فاجعه | 2026-10-19 |
| [`DATA-RETENTION-POLICY.md`](./DATA-RETENTION-POLICY.md) | نگهداشت داده | 2026-10-19 |
| [`CI-BASELINE.md`](./CI-BASELINE.md) · [`CI-SECURITY.md`](./CI-SECURITY.md) | CI | 2026-10-19 |
| [`ops/اعمال-تغییرات-روی-سرور.md`](./ops/اعمال-تغییرات-روی-سرور.md) | رانبوک اعمال پچ روی سرور | 2026-10-25 |
| [`ops/بروزرسانی-سرور-ماتریس-دسترسی.md`](./ops/بروزرسانی-سرور-ماتریس-دسترسی.md) | بروزرسانی بدون بیلد | 2026-10-25 |

## ۳) امنیت و حریم خصوصی

[`SECURITY-POLICY.md`](./SECURITY-POLICY.md) · [`SECRETS-MANAGEMENT-REVIEW.md`](./SECRETS-MANAGEMENT-REVIEW.md) · [`SECRETS-ROTATION-PROCEDURE.md`](./SECRETS-ROTATION-PROCEDURE.md) · [`ACCESS-REVIEW-PROCEDURE.md`](./ACCESS-REVIEW-PROCEDURE.md) · [`DPIA.md`](./DPIA.md) · [`PENTEST-REPORT.md`](./PENTEST-REPORT.md) — همگی 2026-10-19.

## ۴) راهنمای قابلیتها (میراث دورهٔ Next.js — مبنای پورت)

[`MIGRATION.md`](./MIGRATION.md) (2026-09-01) · [`GRADUATION.md`](./GRADUATION.md) (2026-09-01) · [`REGULATIONS.md`](./REGULATIONS.md) (2026-09-01) · [`PAYROLL.md`](./PAYROLL.md) (2026-09-02) · [`WORKFLOW.md`](./WORKFLOW.md) (2026-09-02) · [`VERIFICATION.md`](./VERIFICATION.md) (2026-09-02) · [`BI.md`](./BI.md) (2026-09-02) · [`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md) (2026-10-18) · [`USER_MANUAL.md`](./USER_MANUAL.md) (2026-08-31) · تصاویر در [`images/`](./images/).
