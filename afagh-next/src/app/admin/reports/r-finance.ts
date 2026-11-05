import type { ReportFilters, ReportResult } from './report-helpers';
import { paged, studentWhere } from './report-helpers';
import { sql } from 'drizzle-orm';
import { escapeLikeChars } from '@/lib/persian-search';
import { requireRole } from '@/lib/auth';

const ROLES = ['ADMIN', 'EDU_EXPERT', 'FINANCE_EXPERT', 'FINANCE', 'CASHIER'];

export const CARDS = [
  { kind: 'tuition-tariff', icon: '💰', title: 'تعرفه تحصیلی' },
  { kind: 'tuition-statement', icon: '🧾', title: 'صورت‌حساب شهریه دانشجو', needsTerm: true },
  // ── گزارش‌های پرداختی (هم‌ریخت با اسناد رسمی سما) ──
  { kind: 'total-payments', icon: '📊', title: 'گزارش کل پرداختی دانشجویان' },
  { kind: 'student-payments', icon: '🧾', title: 'گزارش پرداختی دانشجویان (تفصیلی)', needsTerm: true },
  { kind: 'term-payments', icon: '💳', title: 'گزارش مبلغ پرداختی نیمسال', needsTerm: true },
  { kind: 'accounting-voucher', icon: '📑', title: 'سند حسابداری (دفتر روزنامه)', needsTerm: true },
  { kind: 'term-financial', icon: '📈', title: 'گزارش مالی نیمسال (تجمیعی)', needsTerm: true },
  // ── گزارش‌های مدیریتی تجمیعی شهریه ──
  { kind: 'tuition-overview', icon: '🧮', title: 'مدیریت کلان وضعیت شهریه (هر دانشجو)', needsTerm: true },
  { kind: 'tuition-faculty-detail', icon: '🏛️', title: 'تفصیلی مالی (دانشکده × مقطع)', needsTerm: true },
  { kind: 'faculty-financial', icon: '🏢', title: 'گزارش مالی دانشکده‌ها', needsTerm: true },
  { kind: 'major-financial', icon: '📚', title: 'گزارش مالی نیمسال (مقطع × رشته)', needsTerm: true },
];

const CHARGE = sql`sl."transactionType" IN ('TUITION_FIXED','TUITION_VARIABLE','SUBJECT_ADDITIVE','TUITION_CHARGE','CHARGE','TUITION_ADJUST_DEC')`;
const DISC = sql`sl."transactionType" IN ('DISCOUNT_FIXED','DISCOUNT_VARIABLE','SUBJECT_DEDUCTIVE','TUITION_BATES','TUITION_ADJUST_INC')`;
const PAID = sql`sl."transactionType" IN ('PAYMENT','POS_PAYMENT','LOAN','SPONSORSHIP')`;

/** برچسب فارسی نوع واریز — برای ستون «نوع پرداخت» */
const DEPOSIT_FA: Record<string, string> = {
  CASH: 'نقدی',
  ONLINE: 'آنلاین',
  CARD: 'کارت‌خوان',
  CHECK: 'چک',
  LOAN: 'وام',
  SPONSOR: 'حامی مالی',
  TRANSFER: 'انتقال بانکی',
};
/** روش/نوع پرداخت از transactionType وقتی depositType خالی است */
const TXN_FA: Record<string, string> = {
  PAYMENT: 'پرداخت',
  POS_PAYMENT: 'پرداخت کارت‌خوان',
  LOAN: 'وام',
  SPONSORSHIP: 'حمایت مالی',
};


export async function run(kind: string, f: ReportFilters): Promise<ReportResult | null> {
  await requireRole(ROLES);

  // ── تعرفه تحصیلی: قواعد tuition_rules ──
  if (kind === 'tuition-tariff') {
    const from = sql`FROM tuition_rules tr
      LEFT JOIN degree_level_configs d ON d.id = tr."degreeLevelId"
      LEFT JOIN majors m ON m.id = tr."majorId"
      LEFT JOIN faculties fc ON fc.id = tr."facultyId"
      LEFT JOIN financial_terms fct ON fct.id = tr."currentTermId"
      LEFT JOIN academic_terms at ON at.id = fct."academicTermId"`;
    const conds = [];
    if (f.universityId) conds.push(sql`(tr."universityId" = ${f.universityId} OR tr."universityId" IS NULL)`);
    if (f.degreeId) conds.push(sql`tr."degreeLevelId" = ${f.degreeId}`);
    if (f.facultyId) conds.push(sql`tr."facultyId" = ${f.facultyId}`);
    if (f.majorId) conds.push(sql`tr."majorId" = ${f.majorId}`);
    if (f.entryYear) conds.push(sql`(tr."entryYearFrom" IS NULL OR tr."entryYearFrom" <= ${f.entryYear}) AND (tr."entryYearTo" IS NULL OR tr."entryYearTo" >= ${f.entryYear})`);
    if (f.term) conds.push(sql`(tr."currentTermId" IS NULL OR at."termCode" = ${f.term})`);
    if (f.q) {
      // 🔒 فرار wildcard ورودی کاربر (با ESCAPE '\')
      const like = `%${escapeLikeChars(String(f.q))}%`;
      conds.push(sql`(tr.code ILIKE ${like} ESCAPE '\\' OR tr.title ILIKE ${like} ESCAPE '\\')`);
    }
    const cols = sql`tr.code AS code, tr.title AS title, d.title AS degree, m.name AS major,
      tr."entryYearFrom" AS yfrom, tr."entryYearTo" AS yto, tr."termType" AS termtype,
      tr."fixedAmount" AS fixed, tr."perUnitTheory" AS theory, tr."perUnitPractical" AS practical,
      tr."perUnitGeneral" AS general,
      CASE WHEN tr."isActive" = 1 THEN 'فعال' ELSE 'غیرفعال' END AS active`;
    const r = await paged(
      [
        { key: 'code', title: 'کد تعرفه' }, { key: 'title', title: 'عنوان' },
        { key: 'degree', title: 'مقطع' }, { key: 'major', title: 'رشته' },
        { key: 'yfrom', title: 'ورودی از' }, { key: 'yto', title: 'ورودی تا' },
        { key: 'termtype', title: 'نوع ترم' }, { key: 'fixed', title: 'شهریه ثابت', format: 'MONEY' },
        { key: 'theory', title: 'نظری/واحد', format: 'MONEY' }, { key: 'practical', title: 'عملی/واحد', format: 'MONEY' },
        { key: 'general', title: 'عمومی/واحد', format: 'MONEY' }, { key: 'active', title: 'وضعیت' },
      ],
      from, conds, cols, sql`ORDER BY tr.priority, tr.id`, f,
    );
    r.summary = `${r.total.toLocaleString('fa-IR')} قاعده تعرفه`;
    return r;
  }

  // ── صورت‌حساب شهریه دانشجو: تجمیع student_ledger ──
  if (kind === 'tuition-statement') {
    const ledgerJoin = f.term
      ? sql`LEFT JOIN student_ledger sl ON sl."studentId" = s.id AND sl."termId" = (SELECT id FROM academic_terms WHERE "termCode" = ${f.term} LIMIT 1)`
      : sql`LEFT JOIN student_ledger sl ON sl."studentId" = s.id`;
    const from = sql`FROM students s JOIN users u ON u.id = s."userId"
      LEFT JOIN majors m ON m.id = s."majorId"
      LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
      ${ledgerJoin}`;
    const cols = sql`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
      m.name AS major, d.title AS degree, s."entryYear" AS y,
      COALESCE(SUM(sl.amount) FILTER (WHERE ${CHARGE}), 0)::bigint AS charge,
      COALESCE(SUM(sl.amount) FILTER (WHERE ${DISC}), 0)::bigint AS discount,
      COALESCE(SUM(sl.amount) FILTER (WHERE ${PAID}), 0)::bigint AS paid,
      (COALESCE(SUM(sl.amount) FILTER (WHERE ${CHARGE}), 0)
        - COALESCE(SUM(sl.amount) FILTER (WHERE ${DISC}), 0)
        - COALESCE(SUM(sl.amount) FILTER (WHERE ${PAID}), 0))::bigint AS balance,
      COUNT(sl.id)::int AS txns`;
    const r = await paged(
      [
        { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
        { key: 'major', title: 'رشته' }, { key: 'degree', title: 'مقطع' },
        { key: 'y', title: 'ورودی' }, { key: 'charge', title: 'بدهی شهریه', format: 'MONEY' },
        { key: 'discount', title: 'تخفیف', format: 'MONEY' }, { key: 'paid', title: 'پرداختی', format: 'MONEY' },
        { key: 'balance', title: 'مانده بدهی', format: 'MONEY' }, { key: 'txns', title: 'تراکنش' },
      ],
      from, studentWhere(f), cols, sql`ORDER BY balance DESC`, f,
      sql`s.id, s."studentCode", u."firstName", u."lastName", m.name, d.title, s."entryYear"`,
    );
   r.summary = `${r.total.toLocaleString('fa-IR')} دانشجو${f.term ? ` — ترم ${f.term}` : ' — همه ترم‌ها'} (مانده = بدهی − تخفیف − پرداختی)`;
    return r;
  }

  // ══════════════════════════════════════════════════════════════════
  //  گزارش‌های پرداختی — هم‌ریخت با اسناد رسمی (سما)
  // ══════════════════════════════════════════════════════════════════

  const termJoin = f.term
    ? sql`JOIN academic_terms t ON t.id = sl."termId" AND t."termCode" = ${f.term}`
    : sql`LEFT JOIN academic_terms t ON t.id = sl."termId"`;
  const uniCond = f.universityId
    ? sql`(sl."universityId" = ${f.universityId} OR sl."universityId" IS NULL)`
    : sql`1 = 1`;

  // ── ۱) گزارش کل پرداختی دانشجویان: مانده حساب + کل پرداختی هر دانشجو ──
  if (kind === 'total-payments') {
    const from = sql`FROM students s
      JOIN users u ON u.id = s."userId"
      LEFT JOIN majors m ON m.id = s."majorId"
      LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
      LEFT JOIN student_ledger sl ON sl."studentId" = s.id`;
    const cols = sql`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
      m.name AS major, d.title AS degree,
      (COALESCE(SUM(sl.amount) FILTER (WHERE ${CHARGE}), 0)
        - COALESCE(SUM(sl.amount) FILTER (WHERE ${DISC}), 0)
        - COALESCE(SUM(sl.amount) FILTER (WHERE ${PAID}), 0))::bigint AS balance,
      COALESCE(SUM(sl.amount) FILTER (WHERE ${PAID}), 0)::bigint AS paid`;
    const r = await paged(
      [
        { key: 'code', title: 'شماره دانشجو' },
        { key: 'name', title: 'نام و نام خانوادگی' },
        { key: 'major', title: 'رشته' },
        { key: 'balance', title: 'مانده حساب', format: 'MONEY' },
        { key: 'paid', title: 'کل پرداختی', format: 'MONEY' },
      ],
      from, [...studentWhere(f), uniCond], cols, sql`ORDER BY s."studentCode"`, f,
      sql`s.id, s."studentCode", u."firstName", u."lastName", m.name, d.title`,
    );
    const totalPaid = r.rows.reduce((a, x) => a + Number(x.paid ?? 0), 0);
    r.summary = `${r.total.toLocaleString('fa-IR')} دانشجو — جمع پرداختی: ${totalPaid.toLocaleString('fa-IR')} ریال`;
    return r;
  }

  // ── ۲) گزارش پرداختی دانشجویان (تفصیلی): هر فیش پرداخت ──
  if (kind === 'student-payments') {
    const from = sql`FROM student_ledger sl
      JOIN students s ON s.id = sl."studentId"
      JOIN users u ON u.id = s."userId"
      LEFT JOIN majors m ON m.id = s."majorId"
      ${termJoin}`;
    const conds = [PAID, uniCond];
    if (f.q) {
      const like = `%${escapeLikeChars(String(f.q))}%`;
      conds.push(sql`(s."studentCode" ILIKE ${like} ESCAPE '\\'
        OR (u."firstName" || ' ' || u."lastName") ILIKE ${like} ESCAPE '\\'
        OR sl."receiptNo" ILIKE ${like} ESCAPE '\\')`);
    }
    const cols = sql`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
      m.name AS major,
      COALESCE(sl."depositType", sl."transactionType") AS paytype,
      COALESCE(sl."depositDate", sl."createdAt") AS paydate,
      sl."receiptNo" AS receipt, sl."accountNo" AS account,
      sl."referenceId"::text AS track, sl."bankName" AS bank,
      sl.amount AS amount`;
    const r = await paged(
      [
        { key: 'code', title: 'شماره دانشجو' },
        { key: 'name', title: 'نام و نام خانوادگی' },
        { key: 'major', title: 'رشته' },
        { key: 'paytype', title: 'نوع پرداخت' },
        { key: 'paydate', title: 'تاریخ', format: 'DATE' },
        { key: 'receipt', title: 'شماره فیش' },
        { key: 'account', title: 'شماره حساب' },
        { key: 'track', title: 'شماره پیگیری' },
        { key: 'bank', title: 'بانک' },
        { key: 'amount', title: 'مبلغ', format: 'MONEY' },
      ],
      from, conds, cols, sql`ORDER BY COALESCE(sl."depositDate", sl."createdAt") DESC, sl.id DESC`, f,
    );
    r.rows = r.rows.map(x => {
      const k = String(x.paytype ?? '');
      return { ...x, paytype: DEPOSIT_FA[k] ?? TXN_FA[k] ?? (k || '—') };
    });
    const sum = r.rows.reduce((a, x) => a + Number(x.amount ?? 0), 0);
    r.summary = `${r.total.toLocaleString('fa-IR')} فیش پرداخت — جمع صفحهٔ جاری: ${sum.toLocaleString('fa-IR')} ریال`;
    return r;
  }

  // ── ۳) گزارش مبلغ پرداختی نیمسال: واحد، پرداختی، شهریه، تخفیف، مانده ──
  if (kind === 'term-payments') {
    const from = sql`FROM students s
      JOIN users u ON u.id = s."userId"
      LEFT JOIN majors m ON m.id = s."majorId"
      LEFT JOIN student_ledger sl ON sl."studentId" = s.id
      ${f.term ? sql`AND sl."termId" = (SELECT id FROM academic_terms WHERE "termCode" = ${f.term} LIMIT 1)` : sql``}`;
    const units = sql`(SELECT COUNT(*)::int FROM enrollments en
      WHERE en."studentId" = s.id
      ${f.term ? sql`AND en."offeringId" IN (SELECT co.id FROM course_offerings co WHERE co."termId" = (SELECT id FROM academic_terms WHERE "termCode" = ${f.term} LIMIT 1))` : sql``}
    )`;
    const cols = sql`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
      m.name AS major, ${units} AS units,
      COALESCE(SUM(sl.amount) FILTER (WHERE ${PAID}), 0)::bigint AS paid,
      COALESCE(SUM(sl.amount) FILTER (WHERE ${CHARGE}), 0)::bigint AS tuition,
      COALESCE(SUM(sl.amount) FILTER (WHERE ${DISC}), 0)::bigint AS discount,
      (COALESCE(SUM(sl.amount) FILTER (WHERE ${CHARGE}), 0)
        - COALESCE(SUM(sl.amount) FILTER (WHERE ${DISC}), 0)
        - COALESCE(SUM(sl.amount) FILTER (WHERE ${PAID}), 0))::bigint AS balance`;
    const r = await paged(
      [
        { key: 'code', title: 'شماره دانشجو' },
        { key: 'name', title: 'نام و نام خانوادگی' },
        { key: 'major', title: 'رشته' },
        { key: 'units', title: 'واحد' },
        { key: 'paid', title: 'پرداختی', format: 'MONEY' },
        { key: 'tuition', title: 'شهریه', format: 'MONEY' },
        { key: 'discount', title: 'تخفیف/معافیت', format: 'MONEY' },
        { key: 'balance', title: 'مانده', format: 'MONEY' },
      ],
      from, [...studentWhere(f), uniCond], cols, sql`ORDER BY s."studentCode"`, f,
      sql`s.id, s."studentCode", u."firstName", u."lastName", m.name`,
    );
    r.summary = `${r.total.toLocaleString('fa-IR')} دانشجو${f.term ? ` — نیمسال ${f.term}` : ''} (پرداختی / شهریه / تخفیف / مانده)`;
    return r;
  }

  // ── ۴) سند حسابداری: تجمیع دفتر روزنامه بر پایهٔ شمارهٔ سند ──
  if (kind === 'accounting-voucher') {
    const from = sql`FROM student_ledger sl
      JOIN students s ON s.id = sl."studentId"
      LEFT JOIN users u ON u.id = s."userId"
      ${termJoin}`;
    const conds = [uniCond];
    if (f.voucherNo) {
      conds.push(sql`sl."voucherNo" ILIKE ${`%${escapeLikeChars(String(f.voucherNo))}%`} ESCAPE '\\'`);
    }
    const cols = sql`COALESCE(sl."voucherNo", '—') AS voucher,
      MIN(sl."description") AS descr,
      COALESCE(MAX(sl."depositDate"), MAX(sl."createdAt")) AS vdate,
      COALESCE(SUM(sl.amount) FILTER (WHERE ${CHARGE}), 0)::bigint AS debit,
      COALESCE(SUM(sl.amount) FILTER (WHERE ${DISC} OR ${PAID}), 0)::bigint AS credit,
      COUNT(sl.id)::int AS lines`;
    const r = await paged(
      [
        { key: 'voucher', title: 'شماره سند' },
        { key: 'descr', title: 'شرح سند' },
        { key: 'vdate', title: 'تاریخ', format: 'DATE' },
        { key: 'debit', title: 'مبلغ جزء بدهکار', format: 'MONEY' },
        { key: 'credit', title: 'مبلغ جزء بستانکار', format: 'MONEY' },
        { key: 'lines', title: 'تعداد ردیف' },
      ],
      from, conds, cols, sql`ORDER BY COALESCE(MAX(sl."depositDate"), MAX(sl."createdAt")) DESC NULLS LAST, COALESCE(sl."voucherNo", '—')`, f,
      sql`COALESCE(sl."voucherNo", '—')`,
    );
    const debit = r.rows.reduce((a, x) => a + Number(x.debit ?? 0), 0);
    const credit = r.rows.reduce((a, x) => a + Number(x.credit ?? 0), 0);
    r.summary = `${r.total.toLocaleString('fa-IR')} سند — جمع بدهکار ${debit.toLocaleString('fa-IR')} / جمع بستانکار ${credit.toLocaleString('fa-IR')} ریال`;
    return r;
  }

  // ── ۵) گزارش مالی نیمسال (تجمیعی) ──
  if (kind === 'term-financial') {
    const from = sql`FROM student_ledger sl
      JOIN students s ON s.id = sl."studentId"
      JOIN users u ON u.id = s."userId"
      LEFT JOIN majors m ON m.id = s."majorId"
      LEFT JOIN academic_terms t ON t.id = sl."termId"
      ${f.term ? sql`AND t."termCode" = ${f.term}` : sql``}`;
    const cols = sql`COALESCE(t."termCode", '—') AS term, s."studentCode" AS code,
      u."firstName" || ' ' || u."lastName" AS name, m.name AS major,
      COALESCE(SUM(sl.amount) FILTER (WHERE ${DISC}), 0)::bigint AS discount,
      COALESCE(SUM(sl.amount) FILTER (WHERE ${PAID}), 0)::bigint AS paid,
      COALESCE(SUM(sl.amount) FILTER (WHERE ${CHARGE}), 0)::bigint AS charge,
      (COALESCE(SUM(sl.amount) FILTER (WHERE ${CHARGE}), 0)
        - COALESCE(SUM(sl.amount) FILTER (WHERE ${DISC}), 0)
        - COALESCE(SUM(sl.amount) FILTER (WHERE ${PAID}), 0))::bigint AS balance`;
    const r = await paged(
      [
        { key: 'term', title: 'ترم' },
        { key: 'code', title: 'شماره دانشجو' },
        { key: 'name', title: 'نام و نام خانوادگی' },
        { key: 'major', title: 'رشته' },
        { key: 'discount', title: 'تخفیفات', format: 'MONEY' },
        { key: 'paid', title: 'پرداختی', format: 'MONEY' },
        { key: 'charge', title: 'شهریه', format: 'MONEY' },
        { key: 'balance', title: 'مانده', format: 'MONEY' },
      ],
      from, [uniCond], cols, sql`ORDER BY COALESCE(t."termCode", '—') DESC, s."studentCode"`, f,
      sql`t."termCode", s.id, s."studentCode", u."firstName", u."lastName", m.name`,
    );
    r.summary = `${r.total.toLocaleString('fa-IR')} ردیف مالی${f.term ? ` — نیمسال ${f.term}` : ' — همهٔ ترم‌ها'}`;
    return r;
  }

  // ══════════════════════════════════════════════════════════════════
  //  گزارش‌های مدیریتی شهریه (تجمیعی دانشکده / مقطع / رشته / ورودی)
  //  نگاشت ستون‌ها به واژگان دفتر کل:
  //    شهریه ثابت   = TUITION_FIXED | TUITION_CHARGE | CHARGE
  //    شهریه متغیر  = TUITION_VARIABLE | SUBJECT_ADDITIVE
  //    تعدیل کاهشی  = TUITION_ADJUST_DEC   (به بدهی اضافه می‌شود)
  //    تخفیف متفرقه = DISCOUNT_FIXED | DISCOUNT_VARIABLE | SUBJECT_DEDUCTIVE | TUITION_ADJUST_INC
  //    تخفیف پرداخت = TUITION_BATES       (بیتسِ ثبت‌شده هنگام پرداخت)
  //    مساعده       = LOAN
  //    پرداختی ترم  = PAYMENT | POS_PAYMENT | SPONSORSHIP
  // ══════════════════════════════════════════════════════════════════
  const FIXED = sql`sl."transactionType" IN ('TUITION_FIXED','TUITION_CHARGE','CHARGE')`;
  const VARIABLE = sql`sl."transactionType" IN ('TUITION_VARIABLE','SUBJECT_ADDITIVE')`;
  const ADJ_DEC = sql`sl."transactionType" = 'TUITION_ADJUST_DEC'`;
  const DISC_MISC = sql`sl."transactionType" IN ('DISCOUNT_FIXED','DISCOUNT_VARIABLE','SUBJECT_DEDUCTIVE','TUITION_ADJUST_INC')`;
  const DISC_PAY = sql`sl."transactionType" = 'TUITION_BATES'`;
  const ADVANCE = sql`sl."transactionType" = 'LOAN'`;
  const PAY_ONLY = sql`sl."transactionType" IN ('PAYMENT','POS_PAYMENT','SPONSORSHIP')`;

  const SUM = (cond: ReturnType<typeof sql>) =>
    sql`COALESCE(SUM(sl.amount) FILTER (WHERE ${cond}), 0)::bigint`;

  /** بدنهٔ مشترک: ستون‌های مالی + فیلتر ترم/دانشگاه */
  const finBody = () => {
    const fixed = SUM(FIXED);
    const variable = SUM(VARIABLE);
    const adjDec = SUM(ADJ_DEC);
    const discMisc = SUM(DISC_MISC);
    const discPay = SUM(DISC_PAY);
    const advance = SUM(ADVANCE);
    const paid = SUM(PAY_ONLY);
    const charge = sql`(${fixed} + ${variable} + ${adjDec})`;
    const disc = sql`(${discMisc} + ${discPay})`;
    const balance = sql`(${charge} - ${disc} - ${paid})`;
    return {
      cols: sql`${fixed} AS fixed, ${variable} AS variable, ${adjDec} AS adjdec,
        ${discMisc} AS discmisc, ${discPay} AS discpay, ${disc}::bigint AS disctotal,
        ${advance} AS advanceamt,
        ${charge}::bigint AS charge, ${paid} AS paid,
        ${balance}::bigint AS balance,
        GREATEST(${balance}, 0)::bigint AS debtor,
        GREATEST(-(${balance}), 0)::bigint AS creditor`,
      charge, disc, balance, paid,
    };
  };

  const finCols = (extra: { key: string; title: string; format?: 'MONEY' | 'NUMBER' | 'DATE' }[]) => [
    ...extra,
    { key: 'fixed', title: 'شهریه ثابت', format: 'MONEY' as const },
    { key: 'variable', title: 'شهریه متغیر', format: 'MONEY' as const },
    { key: 'discmisc', title: 'تخفیفات متفرقه', format: 'MONEY' as const },
    { key: 'discpay', title: 'تخفیفات پرداختی‌ها', format: 'MONEY' as const },
    { key: 'disctotal', title: 'جمع تخفیفات', format: 'MONEY' as const },
    { key: 'advanceamt', title: 'مبالغ مساعده', format: 'MONEY' as const },
    { key: 'charge', title: 'جمع بدهکار', format: 'MONEY' as const },
    { key: 'paid', title: 'پرداختی این نیمسال', format: 'MONEY' as const },
    { key: 'debtor', title: 'بدهکار', format: 'MONEY' as const },
    { key: 'creditor', title: 'بستانکار', format: 'MONEY' as const },
    { key: 'balance', title: 'مانده کل', format: 'MONEY' as const },
  ];

  // ── ۶) گزارش مدیریت کلان وضعیت شهریه (یک ردیف برای هر دانشجو) ──
  if (kind === 'tuition-overview') {
    const f6 = finBody();
    const units = sql`(SELECT COUNT(*)::int FROM enrollments en
      WHERE en."studentId" = s.id
      ${f.term ? sql`AND en."offeringId" IN (SELECT co.id FROM course_offerings co WHERE co."termId" = (SELECT id FROM academic_terms WHERE "termCode" = ${f.term} LIMIT 1))` : sql``}
    )`;
    const from = sql`FROM students s
      JOIN users u ON u.id = s."userId"
      LEFT JOIN majors m ON m.id = s."majorId"
      LEFT JOIN faculties fc ON fc.id = m."facultyId"
      LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
      LEFT JOIN student_ledger sl ON sl."studentId" = s.id
      ${f.term ? sql`AND sl."termId" = (SELECT id FROM academic_terms WHERE "termCode" = ${f.term} LIMIT 1)` : sql``}`;
    const cols = sql`s."studentCode" AS code, fc.name AS faculty, d.title AS degree,
      s."entryYear" AS y, ${units} AS units, ${f6.cols}`;
    const r = await paged(
      finCols([
        { key: 'code', title: 'کد دانشجو' },
        { key: 'faculty', title: 'دانشکده' },
        { key: 'degree', title: 'مقطع' },
        { key: 'y', title: 'سال ورودی', format: 'NUMBER' },
        { key: 'units', title: 'تعداد واحد ثبت‌شده', format: 'NUMBER' },
      ]),
      from, [...studentWhere(f), uniCond], cols,
      sql`ORDER BY fc.name NULLS LAST, s."entryYear", s."studentCode"`, f,
      sql`s.id, s."studentCode", fc.name, d.title, s."entryYear"`,
    );
    r.summary = `${r.total.toLocaleString('fa-IR')} دانشجو${f.term ? ` — نیمسال ${f.term}` : ' — همهٔ ترم‌ها'}`;
    return r;
  }

  // ── ۷) گزارش تفصیلی مالی دانشجویان به تفکیک دانشکده و مقطع ──
  if (kind === 'tuition-faculty-detail') {
    const f7 = finBody();
    const from = sql`FROM students s
      JOIN users u ON u.id = s."userId"
      LEFT JOIN majors m ON m.id = s."majorId"
      LEFT JOIN faculties fc ON fc.id = m."facultyId"
      LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
      LEFT JOIN student_ledger sl ON sl."studentId" = s.id
      ${f.term ? sql`AND sl."termId" = (SELECT id FROM academic_terms WHERE "termCode" = ${f.term} LIMIT 1)` : sql``}`;
    const cols = sql`COALESCE(fc.name, '—') AS faculty, COALESCE(d.title, '—') AS degree,
      COUNT(DISTINCT s.id)::int AS students, ${f7.cols}`;
    const r = await paged(
      finCols([
        { key: 'faculty', title: 'دانشکده' },
        { key: 'degree', title: 'مقطع' },
        { key: 'students', title: 'تعداد دانشجو', format: 'NUMBER' },
      ]),
      from, [...studentWhere(f), uniCond], cols,
      sql`ORDER BY COALESCE(fc.name, '—'), COALESCE(d.title, '—')`, f,
      sql`fc.name, d.title`,
    );
    r.summary = `${r.total.toLocaleString('fa-IR')} ردیف (دانشکده × مقطع)${f.term ? ` — نیمسال ${f.term}` : ''}`;
    return r;
  }

  // ── ۸) گزارش مالی دانشکده‌ها (دانشکده × ترم × سال ورودی) ──
  if (kind === 'faculty-financial') {
    const f8 = finBody();
    const from = sql`FROM students s
      JOIN users u ON u.id = s."userId"
      LEFT JOIN majors m ON m.id = s."majorId"
      LEFT JOIN faculties fc ON fc.id = m."facultyId"
      LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
      LEFT JOIN student_ledger sl ON sl."studentId" = s.id
      LEFT JOIN academic_terms t ON t.id = sl."termId"
      ${f.term ? sql`AND t."termCode" = ${f.term}` : sql``}`;
    const cols = sql`COALESCE(fc.name, '—') AS faculty, s."entryYear" AS y,
      COALESCE(t."termCode", '—') AS term,
      COUNT(DISTINCT s.id)::int AS students, ${f8.cols}`;
    const r = await paged(
      finCols([
        { key: 'faculty', title: 'دانشکده' },
        { key: 'term', title: 'ترم' },
        { key: 'y', title: 'سال ورودی', format: 'NUMBER' },
        { key: 'students', title: 'تعداد دانشجو', format: 'NUMBER' },
      ]),
      from, [...studentWhere(f), uniCond], cols,
      sql`ORDER BY COALESCE(fc.name, '—'), s."entryYear"`, f,
      sql`fc.name, s."entryYear", t."termCode"`,
    );
    r.summary = `${r.total.toLocaleString('fa-IR')} ردیف (دانشکده × ورودی × ترم)${f.term ? ` — نیمسال ${f.term}` : ''}`;
    return r;
  }

  // ── ۹) گزارش مالی نیمسال به تفکیک مقطع و رشته (و ورودی) ──
  if (kind === 'major-financial') {
    const f9 = finBody();
    const from = sql`FROM students s
      JOIN users u ON u.id = s."userId"
      LEFT JOIN majors m ON m.id = s."majorId"
      LEFT JOIN faculties fc ON fc.id = m."facultyId"
      LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
      LEFT JOIN student_ledger sl ON sl."studentId" = s.id
      ${f.term ? sql`AND sl."termId" = (SELECT id FROM academic_terms WHERE "termCode" = ${f.term} LIMIT 1)` : sql``}`;
    const cols = sql`COALESCE(d.title, '—') AS degree, COALESCE(fc.name, '—') AS faculty,
      COALESCE(m.name, '—') AS major, s."entryYear" AS y,
      COUNT(DISTINCT s.id)::int AS students, ${f9.cols}`;
    const r = await paged(
      finCols([
        { key: 'degree', title: 'مقطع' },
        { key: 'faculty', title: 'دانشکده' },
        { key: 'major', title: 'رشته' },
        { key: 'y', title: 'سال ورودی', format: 'NUMBER' },
        { key: 'students', title: 'تعداد دانشجو', format: 'NUMBER' },
      ]),
      from, [...studentWhere(f), uniCond], cols,
      sql`ORDER BY COALESCE(d.title, '—'), COALESCE(fc.name, '—'), COALESCE(m.name, '—'), s."entryYear"`, f,
      sql`d.title, fc.name, m.name, s."entryYear"`,
    );
    r.summary = `${r.total.toLocaleString('fa-IR')} ردیف (مقطع × رشته × ورودی)${f.term ? ` — نیمسال ${f.term}` : ''}`;
    return r;
  }

  return null;
}




