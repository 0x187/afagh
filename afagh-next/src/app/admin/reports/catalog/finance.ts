/**
 * ══════════════════════════════════════════════════════════════════════
 *  کاتالوگ مالی — منابع و ستون‌های قابل گزارش‌گیری
 * ══════════════════════════════════════════════════════════════════════
 *  منبعِ حقیقتِ «چه چیزهایی در گزارش‌ساز مالی دیده می‌شوند».
 *  هر عبارت SQL اینجا **ثابت و کدی** است؛ کاربر فقط انتخاب می‌کند.
 *
 *  🔒 نکتهٔ سازگاریِ اعداد: تعریفِ CHARGE/DISC/PAID اینجا عیناً همان چیزی است
 *  که در گزارشِ آمادهٔ «صورت‌حساب شهریه» (r-finance.ts) به کار رفته تا عددِ
 *  «مانده» در گزارش‌ساز با گزارش آماده یکی دربیاید و کاربر گیج نشود.
 */

import type { ReportSource, ReportField } from './types';

/** ۱۷ نوع تراکنش دفتر مالی (منبع حقیقت: ck_student_ledger_txn_type در schema.ts) */
export const LEDGER_TYPES: { value: string; label: string }[] = [
  { value: 'TUITION_FIXED', label: 'شهریه ثابت' },
  { value: 'TUITION_VARIABLE', label: 'شهریه متغیر' },
  { value: 'TUITION_CHARGE', label: 'شارژ شهریهٔ ترم' },
  { value: 'CHARGE', label: 'شارژ سایر' },
  { value: 'SUBJECT_ADDITIVE', label: 'اضافه‌بارِ درس' },
  { value: 'POS_REFUND', label: 'برگشت وجهِ کارت‌خوان' },
  { value: 'TUITION_ADJUST_DEC', label: 'تعدیل کاهشی شهریه' },
  { value: 'PAYMENT', label: 'پرداخت' },
  { value: 'POS_PAYMENT', label: 'پرداخت کارت‌خوان' },
  { value: 'DISCOUNT_FIXED', label: 'تخفیف ثابت' },
  { value: 'DISCOUNT_VARIABLE', label: 'تخفیف متغیر' },
  { value: 'SUBJECT_DEDUCTIVE', label: 'کسرِ درس' },
  { value: 'SPONSORSHIP', label: 'سازمانِ حامی' },
  { value: 'LOAN', label: 'وام' },
  { value: 'CREDIT', label: 'بستانکاری' },
  { value: 'TUITION_BATES', label: 'بیتسِ قدیمی (اعتبار)' },
  { value: 'TUITION_ADJUST_INC', label: 'تعدیل افزایشی شهریه' },
];

/** انواع واریز — پر می‌شود از DISTINCT روی student_ledger.depositType */
export const DEPOSIT_TYPES: { value: string; label: string }[] = [
  { value: 'CASH', label: 'نقدی' },
  { value: 'POS', label: 'کارت‌خوان' },
  { value: 'ONLINE', label: 'درگاه اینترنتی' },
  { value: 'CHEQUE', label: 'چک' },
  { value: 'TRANSFER', label: 'حوالهٔ بانکی' },
  { value: 'LOAN', label: 'وام' },
  { value: 'OTHER', label: 'سایر' },
];

/** وضعیت پرداخت درگاه */
export const PAYMENT_STATUSES: { value: string; label: string }[] = [
  { value: 'INITIATED', label: 'آغازشده' },
  { value: 'REDIRECTED', label: 'هدایت‌شده به درگاه' },
  { value: 'VERIFIED', label: 'تأییدشده' },
  { value: 'FAILED', label: 'ناموفق' },
  { value: 'CANCELLED', label: 'لغوشده' },
  { value: 'EXPIRED', label: 'منقضی' },
];

// ── گروه‌های تراکنش (عین r-finance.ts) ──
const CHARGE_TYPES = `('TUITION_FIXED','TUITION_VARIABLE','SUBJECT_ADDITIVE','TUITION_CHARGE','CHARGE','TUITION_ADJUST_DEC')`;
const DISC_TYPES = `('DISCOUNT_FIXED','DISCOUNT_VARIABLE','SUBJECT_DEDUCTIVE','TUITION_BATES','TUITION_ADJUST_INC')`;
const PAID_TYPES = `('PAYMENT','POS_PAYMENT','LOAN','SPONSORSHIP')`;

/**
 * جمعِ دفترِ مالیِ یک دانشجو — به‌ازای هر دانشجو **یک** ردیف.
 *
 * ⚠ چرا LATERAL و نه یک JOIN ساده؟
 *   یک JOIN ساده به student_ledger باعث «تکثیرِ ردیف» می‌شد: هر ردیفِ دفترِ
 *   مالی یک ردیفِ گزارش می‌ساخت (برای دانشگاهی با ۸۰۷ دانشجو، ۷٬۴۸۸ ردیف!).
 *   اینجا جمع‌ها *قبل* از JOIN و در سطحِ همان دانشجو محاسبه می‌شوند، پس
 *   خروجی دقیقاً «یک ردیف به‌ازای هر دانشجو» است — همان چیزی که عنوانِ منبع
 *   وعده می‌دهد.
 *   از ایندکسِ پوشانِ idx_ledger_balance_cover(studentId, transactionType, amount)
 *   استفاده می‌کند.
 *
 * 🔒 شرطِ هم‌دانشگاهی: ردیف‌های دفترِ مالیِ دانشجویی که دانشگاهشان با خودِ
 *   دانشجو نمی‌خواند (دادهٔ کهنه/ناهماهنگ) شمرده نمی‌شوند.
 */
const BALANCE_LEDGER_JOIN = `LEFT JOIN LATERAL (
      SELECT sl2."studentId" AS "studentId",
        COALESCE(SUM(sl2."amount") FILTER (WHERE sl2."transactionType" IN ${CHARGE_TYPES}), 0)::bigint AS "charge",
        COALESCE(SUM(sl2."amount") FILTER (WHERE sl2."transactionType" IN ${DISC_TYPES}), 0)::bigint AS "discount",
        COALESCE(SUM(sl2."amount") FILTER (WHERE sl2."transactionType" IN ${PAID_TYPES}), 0)::bigint AS "paid",
        COUNT(sl2.id)::int AS "txnCount"
      FROM student_ledger sl2
      WHERE sl2."studentId" = s.id
        AND (sl2."universityId" = s."universityId" OR sl2."universityId" IS NULL)
      GROUP BY sl2."studentId"
    ) sl ON TRUE`;

// ══════════════════════════════════════════════════════════════════════
// ۱) گردش حساب دانشجو — ردیف‌به‌ردیفِ دفتر مالی
// ══════════════════════════════════════════════════════════════════════
const LEDGER_FIELDS: ReportField[] = [
  { key: 'studentCode', title: 'شمارهٔ دانشجویی', sql: `s."studentCode"`, type: 'text', filterable: true, ops: ['eq', 'like'], groupable: true },
  { key: 'studentName', title: 'نام دانشجو', sql: `u."firstName" || ' ' || u."lastName"`, type: 'text', filterable: true, ops: ['like'] },
  { key: 'nationalCode', title: 'کد ملی', sql: `u."nationalCode"`, type: 'text', filterable: true, ops: ['eq', 'like'] },
  { key: 'major', title: 'رشته', sql: `m.name`, type: 'text', filterable: true, ops: ['like'], groupable: true },
  { key: 'degree', title: 'مقطع', sql: `d.title`, type: 'text', filterable: true, ops: ['like'], groupable: true },
  { key: 'entryYear', title: 'سال ورود', sql: `s."entryYear"`, type: 'number', filterable: true, ops: ['eq', 'gte', 'lte', 'between'], groupable: true },
  { key: 'termCode', title: 'نیمسال', sql: `t."termCode"`, type: 'text', filterable: true, ops: ['eq', 'in'], ref: 'terms', groupable: true },
  { key: 'finTermCode', title: 'نیمسال مالی', sql: `ft."termCode"`, type: 'text', filterable: true, ops: ['eq', 'in'], ref: 'financialTerms', groupable: true },
  {
    key: 'transactionType', title: 'نوع تراکنش', sql: `sl."transactionType"`, type: 'text',
    filterable: true, ops: ['eq', 'in'], ref: 'ledgerTypes', groupable: true,
  },
  {
    key: 'amount', title: 'مبلغ', sql: `sl."amount"`, type: 'money', format: 'MONEY',
    filterable: true, ops: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'],
    agg: ['sum', 'avg', 'min', 'max'], hint: 'قابل تجمیع (جمع/میانگین)',
  },
  { key: 'description', title: 'شرح', sql: `sl.description`, type: 'text', filterable: true, ops: ['like'] },
  { key: 'depositType', title: 'نوع واریز', sql: `sl."depositType"`, type: 'text', filterable: true, ops: ['eq', 'in'], ref: 'depositTypes', groupable: true },
  { key: 'depositDate', title: 'تاریخ واریز', sql: `sl."depositDate"`, type: 'datetime', format: 'DATETIME', filterable: true, ops: ['gte', 'lte', 'between'] },
  { key: 'receiptNo', title: 'شمارهٔ فیش', sql: `sl."receiptNo"`, type: 'text', filterable: true, ops: ['eq', 'like'] },
  { key: 'voucherNo', title: 'شمارهٔ سند', sql: `sl."voucherNo"`, type: 'text', filterable: true, ops: ['eq', 'like'] },
  { key: 'payerName', title: 'پرداخت‌کننده', sql: `sl."payerName"`, type: 'text', filterable: true, ops: ['like'] },
  { key: 'bankName', title: 'بانک', sql: `sl."bankName"`, type: 'text', filterable: true, ops: ['like'], groupable: true },
  { key: 'createdAt', title: 'تاریخ ثبت', sql: `sl."createdAt"`, type: 'datetime', format: 'DATETIME', filterable: true, ops: ['gte', 'lte', 'between'] },
];

// ══════════════════════════════════════════════════════════════════════
// ۲) صورت‌حساب و ماندهٔ دانشجو — یک ردیف به‌ازای هر دانشجو
// ══════════════════════════════════════════════════════════════════════
const BALANCE_FIELDS: ReportField[] = [
  { key: 'studentCode', title: 'شمارهٔ دانشجویی', sql: `s."studentCode"`, type: 'text', filterable: true, ops: ['eq', 'like'], groupable: true },
  { key: 'studentName', title: 'نام دانشجو', sql: `u."firstName" || ' ' || u."lastName"`, type: 'text', filterable: true, ops: ['like'], groupable: true },
  { key: 'nationalCode', title: 'کد ملی', sql: `u."nationalCode"`, type: 'text', filterable: true, ops: ['eq', 'like'] },
  { key: 'major', title: 'رشته', sql: `m.name`, type: 'text', filterable: true, ops: ['like'], groupable: true },
  { key: 'degree', title: 'مقطع', sql: `d.title`, type: 'text', filterable: true, ops: ['like'], groupable: true },
  { key: 'entryYear', title: 'سال ورود', sql: `s."entryYear"`, type: 'number', filterable: true, ops: ['eq', 'gte', 'lte', 'between'], groupable: true },
  { key: 'charge', title: 'بدهی شهریه', sql: `COALESCE(sl."charge", 0)::bigint`, type: 'money', format: 'MONEY', hint: 'جمعِ اقلامِ بدهی‌ساز' },
  { key: 'discount', title: 'تخفیف', sql: `COALESCE(sl."discount", 0)::bigint`, type: 'money', format: 'MONEY', hint: 'جمعِ اقلامِ اعتباری' },
  { key: 'paid', title: 'پرداختی', sql: `COALESCE(sl."paid", 0)::bigint`, type: 'money', format: 'MONEY', hint: 'جمعِ پرداخت/وام/حمایت' },
  {
    key: 'balance', title: 'ماندهٔ بدهی',
    sql: `(COALESCE(sl."charge", 0) - COALESCE(sl."discount", 0) - COALESCE(sl."paid", 0))::bigint`,
    type: 'money', format: 'MONEY', hint: 'بدهی − تخفیف − پرداختی',
  },
  { key: 'txnCount', title: 'تعداد تراکنش', sql: `COALESCE(sl."txnCount", 0)::int`, type: 'number', format: 'NUMBER' },
];

// ══════════════════════════════════════════════════════════════════════
// ۳) پرداخت‌های درگاه اینترنتی
// ══════════════════════════════════════════════════════════════════════
const PAYMENT_FIELDS: ReportField[] = [
  { key: 'authority', title: 'شناسهٔ پرداخت', sql: `pt."authority"`, type: 'text', filterable: true, ops: ['eq', 'like'] },
  { key: 'amount', title: 'مبلغ', sql: `pt."amount"`, type: 'money', format: 'MONEY', filterable: true, ops: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'], agg: ['sum', 'avg', 'min', 'max'] },
  { key: 'status', title: 'وضعیت', sql: `pt."status"`, type: 'text', filterable: true, ops: ['eq', 'in'], ref: 'paymentStatuses', groupable: true },
  { key: 'gatewayStatus', title: 'پاسخ درگاه', sql: `pt."gatewayStatus"`, type: 'text', filterable: true, ops: ['like'] },
  { key: 'gateway', title: 'درگاه', sql: `g.title`, type: 'text', filterable: true, ops: ['like'], groupable: true },
  { key: 'bankRefId', title: 'پیگیری بانک', sql: `pt."bankRefId"`, type: 'text', filterable: true, ops: ['like'] },
  { key: 'payerName', title: 'پرداخت‌کننده', sql: `pt."payerName"`, type: 'text', filterable: true, ops: ['like'] },
  { key: 'payerMobile', title: 'موبایل پرداخت‌کننده', sql: `pt."payerMobile"`, type: 'text', filterable: true, ops: ['eq', 'like'] },
  { key: 'studentCode', title: 'شمارهٔ دانشجویی', sql: `s."studentCode"`, type: 'text', filterable: true, ops: ['eq', 'like'], groupable: true },
  { key: 'studentName', title: 'نام دانشجو', sql: `u."firstName" || ' ' || u."lastName"`, type: 'text', filterable: true, ops: ['like'] },
  { key: 'nationalCode', title: 'کد ملی', sql: `u."nationalCode"`, type: 'text', filterable: true, ops: ['eq', 'like'] },
  { key: 'major', title: 'رشته', sql: `m.name`, type: 'text', filterable: true, ops: ['like'], groupable: true },
  { key: 'termCode', title: 'نیمسال', sql: `t."termCode"`, type: 'text', filterable: true, ops: ['eq', 'in'], ref: 'terms', groupable: true },
  { key: 'description', title: 'شرح', sql: `pt.description`, type: 'text', filterable: true, ops: ['like'] },
  { key: 'createdAt', title: 'زمان ایجاد', sql: `pt."createdAt"`, type: 'datetime', format: 'DATETIME', filterable: true, ops: ['gte', 'lte', 'between'] },
  { key: 'verifiedAt', title: 'زمان تأیید', sql: `pt."verifiedAt"`, type: 'datetime', format: 'DATETIME', filterable: true, ops: ['gte', 'lte', 'between'] },
];

// ══════════════════════════════════════════════════════════════════════
// ۴) تعرفهٔ تحصیلی (tuition_rules)
// ══════════════════════════════════════════════════════════════════════
const TARIFF_FIELDS: ReportField[] = [
  { key: 'code', title: 'کد تعرفه', sql: `tr.code`, type: 'text', filterable: true, ops: ['eq', 'like'] },
  { key: 'title', title: 'عنوان', sql: `tr.title`, type: 'text', filterable: true, ops: ['like'] },
  { key: 'degree', title: 'مقطع', sql: `d.title`, type: 'text', filterable: true, ops: ['like'], groupable: true },
  { key: 'major', title: 'رشته', sql: `m.name`, type: 'text', filterable: true, ops: ['like'], groupable: true },
  { key: 'faculty', title: 'دانشکده', sql: `fc.name`, type: 'text', filterable: true, ops: ['like'], groupable: true },
  { key: 'termCode', title: 'نیمسال مالی', sql: `fct."termCode"`, type: 'text', filterable: true, ops: ['eq', 'in'], ref: 'financialTerms', groupable: true },
  { key: 'entryYearFrom', title: 'ورودی از', sql: `tr."entryYearFrom"`, type: 'number', filterable: true, ops: ['gte', 'lte', 'between'] },
  { key: 'entryYearTo', title: 'ورودی تا', sql: `tr."entryYearTo"`, type: 'number', filterable: true, ops: ['gte', 'lte', 'between'] },
  { key: 'fixed', title: 'شهریهٔ ثابت', sql: `tr."fixedAmount"`, type: 'money', format: 'MONEY', filterable: true, ops: ['eq', 'gt', 'lte', 'between'], agg: ['sum', 'avg', 'min', 'max'] },
  { key: 'theory', title: 'نظری / واحد', sql: `tr."perUnitTheory"`, type: 'money', format: 'MONEY', filterable: true, ops: ['eq', 'gt', 'lte'], agg: ['sum', 'avg', 'min', 'max'] },
  { key: 'practical', title: 'عملی / واحد', sql: `tr."perUnitPractical"`, type: 'money', format: 'MONEY', filterable: true, ops: ['eq', 'gt', 'lte'], agg: ['sum', 'avg', 'min', 'max'] },
  { key: 'general', title: 'عمومی / واحد', sql: `tr."perUnitGeneral"`, type: 'money', format: 'MONEY', filterable: true, ops: ['eq', 'gt', 'lte'], agg: ['sum', 'avg', 'min', 'max'] },
  { key: 'priority', title: 'اولویت', sql: `tr.priority`, type: 'number', filterable: true, ops: ['eq', 'lte', 'gte'], groupable: true },
  { key: 'isActive', title: 'وضعیت', sql: `CASE WHEN tr."isActive" = 1 THEN 'فعال' ELSE 'غیرفعال' END`, type: 'text', filterable: true, ops: ['eq'], groupable: true },
  { key: 'note', title: 'یادداشت', sql: `tr.note`, type: 'text', filterable: true, ops: ['like'] },
];

export const FINANCE_SOURCES: ReportSource[] = [
  {
    key: 'finance-ledger',
    title: 'گردش حساب دانشجو',
    icon: '📒',
    description: 'ریزِ تراکنش‌های دفتر مالی: شهریه، پرداخت، تخفیف، وام و…',
    baseFrom: `FROM student_ledger sl
      JOIN students s ON s.id = sl."studentId"
      JOIN users u ON u.id = s."userId"
      LEFT JOIN majors m ON m.id = s."majorId"
      LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
      LEFT JOIN academic_terms t ON t.id = sl."termId"
      LEFT JOIN financial_terms ft ON ft.id = sl."financialTermId"`,
    // 🔒 اسکوپ بر پایهٔ «دانشگاهِ خودِ دانشجو» (نه ستونِ دفتر مالی):
    //    ستونِ دفتر مالی می‌تواند در دادهٔ کهنه NULL یا ناهماهنگ باشد، ولی
    //    مالکیتِ دانشجو همیشه معتبر است. این کار از «نشتِ بین‌دانشگاهی» جلوگیری می‌کند.
    universityColumn: 's."universityId"',
    roles: ['ADMIN', 'FINANCE_EXPERT', 'FINANCE', 'CASHIER', 'EDU_EXPERT'],
    fields: LEDGER_FIELDS,
    maxRows: 20000,
  },
  {
    key: 'finance-balance',
    title: 'صورت‌حساب و ماندهٔ دانشجو',
    icon: '🧾',
    description: 'یک ردیف به‌ازای هر دانشجو: بدهی، تخفیف، پرداختی و مانده',
    baseFrom: `FROM students s
      JOIN users u ON u.id = s."userId"
      LEFT JOIN majors m ON m.id = s."majorId"
      LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
      ${BALANCE_LEDGER_JOIN}`,
    universityColumn: 's."universityId"',
    roles: ['ADMIN', 'FINANCE_EXPERT', 'FINANCE', 'CASHIER', 'EDU_EXPERT'],
    fields: BALANCE_FIELDS,
    maxRows: 20000,
  },
  {
    key: 'finance-payments',
    title: 'پرداخت‌های درگاه',
    icon: '💳',
    description: 'تراکنش‌های پرداخت اینترنتی: وضعیت، درگاه، پیگیری بانک',
    baseFrom: `FROM payment_transactions pt
      JOIN students s ON s.id = pt."studentId"
      JOIN users u ON u.id = s."userId"
      LEFT JOIN majors m ON m.id = s."majorId"
      LEFT JOIN payment_gateways g ON g.id = pt."gatewayId"
      LEFT JOIN academic_terms t ON t.id = pt."termId"`,
    universityColumn: 's."universityId"',
    roles: ['ADMIN', 'FINANCE_EXPERT', 'FINANCE', 'CASHIER'],
    fields: PAYMENT_FIELDS,
    maxRows: 20000,
  },
  {
    key: 'finance-tariff',
    title: 'تعرفهٔ تحصیلی',
    icon: '🏷️',
    description: 'قواعد نرخ‌گذاری شهریه به‌ازای مقطع/رشته/ورودی',
    baseFrom: `FROM tuition_rules tr
      LEFT JOIN degree_level_configs d ON d.id = tr."degreeLevelId"
      LEFT JOIN majors m ON m.id = tr."majorId"
      LEFT JOIN faculties fc ON fc.id = tr."facultyId"
      LEFT JOIN financial_terms fct ON fct.id = tr."currentTermId"
      LEFT JOIN academic_terms at ON at.id = fct."academicTermId"`,
    universityColumn: 'tr."universityId"',
    roles: ['ADMIN', 'FINANCE_EXPERT', 'FINANCE', 'EDU_EXPERT'],
    fields: TARIFF_FIELDS,
    maxRows: 20000,
  },
];
