import { toNum, toMs } from './numbers';
import type { AppliedAmount } from './discounts';
import { CREDIT_LEDGER_TYPES, DEBT_LEDGER_TYPES } from '../ledger-balance';
import { normalizeTermCode } from '../scheduling-core';

// ══════════════════════════════════════════════════════════════════════
//  کارنامهٔ مالی ترم‌به‌ترم
//
//  قرارداد علامت (یکپارچه با تراز کانونی ledger-balance.ts):
//  مثبت = بدهی دانشجو. charges/netPayable/balance همگی با همین قراردادند.
//  تنها استثنا StatementEvent.sign است که «جهت نمایشی رویداد» است
//  (۱+ = به نفع دانشجو/سبز، ۱− = به زیان او/قرمز) و مصرف‌کننده‌هایش
//  (صفحات کارنامه) به همین شکل به آن تکیه دارند — دست نخورده می‌ماند.
// ══════════════════════════════════════════════════════════════════════

export interface LedgerTxn {
  id: number;
  termId: number | null;
  transactionType: string | null;
  amount: number | string | null;
  description?: string | null;
  createdAt?: string | Date | null;
  /**
   * تاریخ واقعی واریز (از فیش بانکی / StdPays سما) — جدا از createdAt که
   * فقط زمان «ثبت در سیستم» است. برای واریزهای مهاجرتی، createdAt تاریخ
   * ایمپورت است و هیچ ارزشی برای کارنامه ندارد.
   */
  depositDate?: string | Date | null;
  /** نوع واریز: نقدی، چک، کارت‌خوان سامان، … (از paytype سما) */
  depositType?: string | null;
  // ── مستندسازت پرداختِ مهاجرت‌یافته از سیستم قدیمی (سما، مهاجرت ۰۱۲۱) ──
  payerName?: string | null;
  payerNationalCode?: string | null;
  receiptNo?: string | null;
  voucherNo?: string | null;
  payTypeCode?: number | null;
  accountNo?: string | null;
  cardNo?: string | null;
  bankName?: string | null;
  branchName?: string | null;
  recorderCode?: number | null;
  recorderName?: string | null;
  legacyRem?: string | null;
}

export interface ChequeRow {
  id: number;
  termId: number | null;
  chequeNo?: string | null;
  bankName?: string | null;
  amount: number | string | null;
  dueDate?: string | Date | null;
  status: string | null;
  remindedAt?: string | Date | null;
}

export interface LoanRow {
  id: number;
  termId: number | null;
  amount: number | string | null;
  lender?: string | null;
  status: string | null;
}

/**
 * انواع تراکنش دفتر مالی که «بدهی» می‌سازند — عینِ واژگان کانونی
 * (DEBT_LEDGER_TYPES). تعریف محلیِ جدا ممنوع است تا کارنامه و گیت‌ها
 * واگرا نشوند؛ مثبت = بدهی دانشجو.
 */
export const CHARGE_TYPES = DEBT_LEDGER_TYPES;
/**
 * انواع تراکنش دفتر مالی که «اعتبار» می‌سازند (کاهش بدهی) — عینِ
 * واژگان کانونی (CREDIT_LEDGER_TYPES).
 */
export const PAYMENT_TYPES = CREDIT_LEDGER_TYPES;
/** چک با این وضعیت پرداخت شمرده می‌شود */
export const CHEQUE_CLEARED = 'CLEARED';
/** وام با این وضعیت به مانده اثر می‌گذارد — فقط ACTIVE؛ وام SETTLED (تسویه‌شده،
 *  یعنی بدهی‌اش برگشته) هرگز بدهی را کم نمی‌کند، وگرنه مانده برای همیشه منفیِ کاذب می‌ماند. */
export const LOAN_ACTIVE = ['ACTIVE'] as const;

const CHARGE_SET: ReadonlySet<string> = new Set(CHARGE_TYPES);
const PAYMENT_SET: ReadonlySet<string> = new Set(PAYMENT_TYPES);

export function isChargeType(type: string | null): boolean {
  return CHARGE_SET.has(String(type || '').trim().toUpperCase());
}

export function isPaymentType(type: string | null): boolean {
  return PAYMENT_SET.has(String(type || '').trim().toUpperCase());
}

/**
 * انواعِ «اعتبار» که در واقع **تخفیف/کسر** هستند، نه واریزِ دانشجو.
 *
 * سما این‌ها را در ستون‌های `TermAms.Fix_Bates` / `Units_Bates` / `Mab_Bates`
 * نگه می‌داشت و فرمولش هم `TermAcc = TermPays − (fix + units + bates) + adjust`
 * بود؛ یعنی «بیتس» از بدهی کم می‌شد. هنگام مهاجرت به آفاق، به‌صورت ردیفِ
 * `TUITION_BATES` در دفتر مالی درج شد. اگر این ردیف در شاخهٔ «پرداخت» بیفتد،
 * سند رسمی یک تخفیف را «واریز دانشجو» نشان می‌دهد — همان اشتباهی که کاربر
 * دید و پرسید «بیتس شهریهٔ قدیمی یعنی چی؟».
 */
export const LEDGER_DISCOUNT_TYPES: ReadonlySet<string> = new Set([
  'TUITION_BATES',
  'DISCOUNT_FIXED',
  'DISCOUNT_VARIABLE',
  'SUBJECT_DEDUCTIVE',
  'TUITION_ADJUST_INC',
]);

/** برچسبِ فارسیِ ردیف‌های تخفیفِ دفتری — نامِ خامِ دیتابیس گمراه‌کننده است. */
export function ledgerCreditLabel(
  type: string,
  description: string | null | undefined,
  reason?: string | null,
): string {
  const t = String(type || '').trim().toUpperCase();
  /**
   * دلیلِ تخفیف از سما (`PercentBates.Rem` / `Mab_Bates.Rem`) — مثلاً
   * «تخفيف بدستور رياست»، «رتبه برتر»، «ايثارگري». در `legacyRem` نگه داشته
   * می‌شود. سندی که فقط بنویسد «تخفیف» و دلیلش را نگوید، برای auditing
   * بی‌فایده است؛ پس به برچسب چسبانده می‌شود.
   */
  const why = String(reason ?? '').trim();
  const suffix = why && why !== '0' ? ` — ${why}` : '';
  switch (t) {
    case 'TUITION_BATES':
      // «بیتس» در سما یعنی تخفیف درصدی/مبلغی (رتبهٔ علمی، ایثارگری، …)؛
      // برچسبِ قدیمی «بیتس شهریهٔ قدیمی» آن را شبیهِ بدهی می‌کرد.
      return `تخفیف بیتس (سما)${suffix}`;
    case 'TUITION_ADJUST_INC':
      return `تعدیل افزایشی شهریه (سما)${suffix}`;
    case 'DISCOUNT_FIXED':
      return `${description || 'تخفیف شهریهٔ ثابت (سما)'}${suffix}`;
    case 'DISCOUNT_VARIABLE':
      return `${description || 'تخفیف شهریهٔ متغیر (سما)'}${suffix}`;
    case 'SUBJECT_DEDUCTIVE':
      return `${description || 'کاهش مبلغ موضوعی (سما)'}${suffix}`;
    default:
      return `${description || 'تخفیف'}${suffix}`;
  }
}

/**
 * انواعِ «اعتبار» که در واقع **پوششِ شخص ثالث** هستند، نه واریزِ دانشجو.
 * (همان تفکیکی که برای تخفیف انجام شد؛ پوشش بنیاد هم از بدهی کم می‌کند.)
 */
export const LEDGER_SPONSORSHIP_TYPES: ReadonlySet<string> = new Set(['SPONSORSHIP']);

/**
 * یکسان‌سازی حروف عربی/فارسی و فاصله‌ها.
 *
 * دادهٔ مهاجرت‌یافته از سما با `ي`/`ك` عربی ذخیره شده، ولی متنِ نمایشی و
 * جست‌وجوهای بعدی با `ی`/`ک` فارسی نوشته می‌شوند. بدون یکسان‌سازی،
 * تطبیقِ «سهم بنياد» به‌طور تصادفی شکست می‌خورد.
 */
function normFaText(s: string): string {
  return s
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * نوع واریزهایی که پرداخت‌کننده‌شان **شخص ثالث** است، نه خودِ دانشجو.
 *
 * سما مبلغ را در `TermAms.TermPays` می‌آورد (یعنی از نظر تراز، «واریز»
 * است) ولی `StdPays.pay_type`/شرح نشان می‌دهد بنیاد یا سازمان دولتی
 * پرداخت کرده. در کارنامه باید در ردیف «پوشش بنیاد» دیده شود، وگرنه
 * کاربر ردیفِ «پوشش بنیاد: ۰» را در کنار فهرست واریزها می‌بیند و
 * تناقض به نظر می‌رسد.
 */
const THIRD_PARTY_DEPOSIT = /سهم\s*بنیاد|سازمان\s*دولتی/;

/**
 * «صندوق خيريه» — پوششِ صندوقِ خیریه، نه پرداختِ دانشجو.
 *
 * چرا برچسبِ جدا از بنیاد: عنوان ردیفِ بنیاد «پوشش بنیاد» است و صندوق خیریه
 * بنیاد نیست. کاربر خواست با برچسب مستقل دیده شود، پس ردیف «پوشش خیرین»
 * جدا می‌شود تا سند هم دقیق بماند و هم خوانا.
 */
const CHARITY_DEPOSIT = /صندوق\s*خیریه/;

/** واریزِ وامِ تحصیلی — از صندوق رفاه/بانک، نه از جیب دانشجو */
const LOAN_DEPOSIT = /وام\s*تحصیلی|وام\s*دانشجویی/;

export function isSponsorDeposit(depositType: string | null | undefined): boolean {
  const d = normFaText(String(depositType ?? ''));
  return d.length > 0 && THIRD_PARTY_DEPOSIT.test(d);
}

export function isCharityDeposit(depositType: string | null | undefined): boolean {
  const d = normFaText(String(depositType ?? ''));
  return d.length > 0 && CHARITY_DEPOSIT.test(d);
}

export function isLoanDeposit(depositType: string | null | undefined): boolean {
  const d = normFaText(String(depositType ?? ''));
  return d.length > 0 && LOAN_DEPOSIT.test(d);
}

/** رویداد کارنامهٔ مالی — «چه اتفاقی افتاده» */
export interface StatementEvent {
  kind: 'CHARGE' | 'DISCOUNT' | 'SPONSOR' | 'CHARITY' | 'PAYMENT' | 'CHEQUE' | 'LOAN' | 'CLEARANCE';
  label: string;
  amount: number;
  dateMs: number | null;
  /** مثبت = به نفع دانشجو (کاهش بدهی)، منفی = به زیان او */
  sign: 1 | -1;
  /** نوع واریز (فقط رویدادهای PAYMENT) — نمایش به‌صورت برچسب جدا از شرح */
  depositType?: string | null;
  /** true = تاریخِ نمایش، تاریخ واقعی واریز است نه زمان ثبت رکورد */
  datedByDeposit?: boolean;
  // ── مستندسازت پرداختِ مهاجرت‌یافته از سیستم قدیمی (سما، مهاجرت ۰۱۲۱) ──
  /** پرداخت‌کننده (VW_StdPays.NAME) */
  payerName?: string | null;
  /** کد ملی پرداخت‌کننده (VW_StdPays.NationalCode) */
  payerNationalCode?: string | null;
  /** شماره فیش (StdPays.Fish_no) */
  receiptNo?: string | null;
  /** شماره سند (StdPays.SanadNumber) */
  voucherNo?: string | null;
  /** کد نوع پرداخت سما (StdPays.pay_type) */
  payTypeCode?: number | null;
  /** شماره حساب وصولی دانشگاه (StdPays.Acc_No) */
  accountNo?: string | null;
  /** شماره کارت پرداخت‌کننده (استخراج‌شده از StdPays.Rem) */
  cardNo?: string | null;
  /** نام بانک / شعبه (StdPays.BankName / BranchName) */
  bankName?: string | null;
  branchName?: string | null;
  /** ثبت‌کننده (StdPays.userCode → Users) */
  recorderCode?: number | null;
  recorderName?: string | null;
  /** یادداشت آزاد اصل (StdPays.Rem) — شامل کارت/بانک/حساب به‌صورت خام */
  legacyRem?: string | null;
}

/** نگاشت کد نوع پرداختِ سما به برچسب فارسی (نمایش مکملِ depositType) */
export const PAY_TYPE_LABELS: Record<number, string> = {
  0: 'نامشخص',
  1: 'نقدی',
  2: 'چک',
  3: 'کارت‌خوان',
  4: 'انتقال',
  6: 'ساتنا',
  7: 'سپرده',
  8: 'سایر',
  102: 'اینترنتی سامان',
  108: 'درگاه بانکی',
  157: 'آنلاین سامان',
  201: 'دستگاه کارت‌خوان',
};

/**
 * شرح واریز بدون «(نوع واریز)» انتهایی.
 *
 * هنگام مهاجرت، نوع واریز در انتهای شرح داخل پرانتز نوشته شده بود
 * («… — فیش ۱۲۳ (نقدي)»). حالا که نوع، ستون مستقل خودش را دارد،
 * تکرارش در متن حذف می‌شود — فقط اگر عیناً با depositType یکی باشد،
 * تا پرانتزهای دیگرِ شرح دست‌نخورده بمانند.
 */
function stripDepositSuffix(label: string, depositType: string | null): string {
  if (!depositType) return label;
  const m = /\(([^()]*)\)\s*$/.exec(label);
  if (!m) return label;
  if (m[1].trim() !== depositType.trim()) return label;
  return label.slice(0, m.index).replace(/[\s—–-]+$/, '').trim() || label;
}

export interface TermStatement {
  termId: number;
  termTitle: string;
  /** کد ۵ رقمی ترم (سال+نیمسال) — برای عنوان کامل «نیمسال اول سال تحصیلی ...» */
  termCode?: string | null;
  /** وضعیت نیمسال دانشجو (در حال تحصیل / مرخصی / مهمان / انصراف / …) — برای نمایش */
  statusTitle?: string | null;
  charges: number;
  /**
   * تفکیکِ شهریهٔ همان ترم به «ثابت» و «متغیر» — از نوعِ تراکنشِ دفتر مالی
   * (`TUITION_FIXED` / `TUITION_VARIABLE`). سما همین دو قلم را جدا نشان
   * می‌دهد و کارشناس مالی برای تطبیق باید هر دو را ببیند، نه فقط جمع را.
   */
  tuitionFixed?: number;
  tuitionVariable?: number;
  discounts: number;
  sponsorships: number;
  /**
   * بخشی از `sponsorships` که از **واریزِ واقعیِ بنیاد/سازمان دولتی** آمده،
   * نه از جدول پوشش‌ها. برای نمایشِ «از واریز» زیر جمع کل لازم است.
   */
  sponsorshipsFromDeposits?: number;
  /**
   * پوششِ صندوق خیریه (از واریز) — زیرمجموعهٔ `sponsorships` است ولی در
   * کارنامه با برچسبِ مستقل «پوشش خیرین» چاپ می‌شود.
   */
  charityCoverage?: number;
  payments: number;
  chequesCleared: number;
  chequesPending: number;
  chequesBounced: number;
  loans: number;
  /** ناخالص − تخفیف − پوشش بنیاد */
  netPayable: number;
  /** مثبت = دانشجو بدهکار است */
  balance: number;
  events: StatementEvent[];
}

export interface TranscriptInput {
  ledger: LedgerTxn[];
  discounts?: AppliedAmount[];
  sponsorships?: AppliedAmount[];
  cheques?: ChequeRow[];
  loans?: LoanRow[];
  /** عنوان ترم‌ها برای نمایش؛ کلید = شناسهٔ ترم */
  termTitles?: Record<string, string>;
  /**
   * کد ترم‌ها (۵ رقمی سال+نیمسال) برای مرتب‌سازی زمانی کارنامه؛
   * کلید = شناسهٔ ترم. در دادهٔ مهاجرتی (TermAms) شناسهٔ ترم ترتیب
   * زمانی ندارد، پس ترتیب سطرها حتماً باید از کد ترم استخراج شود.
   */
  termCodes?: Record<string, string>;
  /**
   * وضعیتِ هر نیمسال دانشجو (از student_term_states) برای نمایش در کارنامه؛
   * کلید = شناسهٔ ترم. اگر ترمی وضعیت نداشته باشد، نادیده گرفته می‌شود.
   */
  termStatuses?: Record<string, string | null>;
}

/**
 * ساخت کارنامهٔ مالی ترم‌به‌ترم از دفتر مالی و اقلام جانبی.
 *
 * تخفیف‌ها و پوشش بنیادها در ورودی «اعمال‌شده» دریافت می‌شوند چون محاسبهٔ
 * آن‌ها به شهریهٔ همان ترم نیاز دارد و در موتور شهریه انجام شده است.
 * تراکنش‌های بدون ترم (termId تهی) در سطر «بدون ترم» جمع می‌شوند تا هیچ
 * رویداد مالی گم نشود.
 */
export function buildTranscript(input: TranscriptInput): TermStatement[] {
  const termIds = new Set<number>();
  const NO_TERM = 0;

  for (const t of input.ledger || []) {
    termIds.add(t.termId === null || t.termId === undefined ? NO_TERM : t.termId);
  }
  for (const c of input.cheques || []) {
    termIds.add(c.termId === null || c.termId === undefined ? NO_TERM : c.termId);
  }
  for (const l of input.loans || []) {
    termIds.add(l.termId === null || l.termId === undefined ? NO_TERM : l.termId);
  }

  const titles = input.termTitles || {};
  const discountByTerm = input.discounts || [];
  const sponsorByTerm = input.sponsorships || [];

  const statements: TermStatement[] = [];

  // ── ترتیب زمانی ترم‌ها: از قدیم به جدید ──
  // ملاک، کد ترم (۵ رقمی = سال + نوع ترم) است، نه شناسه؛ شناسهٔ ترم‌های
  // مهاجرتی (TermAms) ترتیب زمانی ندارد و کارنامه را به‌هم می‌ریخت.
  // سه گروه: کدهای معتبر (به ترتیب زمانی) ← کدهای ناشناخته (به ترتیب شناسه)
  // ← «بدون ترم» (آخر کارنامه).
  const chronKey = (termId: number): [number, number, number] => {
    if (termId === NO_TERM) return [2, 0, termId];
    const norm = normalizeTermCode((input.termCodes || {})[String(termId)]);
    if (norm) return [0, norm.sortKey, termId];
    return [1, 0, termId];
  };
  const orderedTermIds = Array.from(termIds).sort((a, b) => {
    const ka = chronKey(a);
    const kb = chronKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });

  for (const termId of orderedTermIds) {
    const inTerm = <T extends { termId: number | null }>(rows: T[]): T[] =>
      rows.filter((r) => (r.termId === null || r.termId === undefined ? NO_TERM : r.termId) === termId);

    const events: StatementEvent[] = [];
    let charges = 0;
    let payments = 0;
    let tuitionFixed = 0;
    let tuitionVariable = 0;
    /**
     * تخفیف/پوششی که مستقیماً در دفتر مالی ثبت شده است (نه در جدول تخفیف‌ها).
     *
     * ⚠ چرا جدا شد: در واژگان کانونی، `TUITION_BATES` و `DISCOUNT_*` و
     * `SUBJECT_DEDUCTIVE` و `TUITION_ADJUST_INC` و `SPONSORSHIP` همه «اعتبار»
     * (کاهش بدهی) هستند. پیش‌تر همین‌ها زیرِ شاخهٔ «پرداخت» می‌افتادند و
     * کارنامه یک تخفیف را «پرداخت» نشان می‌داد — مثلاً «بیتس» سما که تخفیف
     * درصدی/مبلغی است، به‌عنوان واریز دانشجو چاپ می‌شد. تفکیک این دو، هیچ
     * تغییری در مانده ایجاد نمی‌کند (هر دو از بدهی کم می‌شوند) ولی سند را
     * درست می‌کند.
     */
    let ledgerDiscounts = 0;
    let ledgerSponsorships = 0;
    /**
     * پوشش/وامِ برخاسته از **واریزِ واقعیِ شخص ثالث** (بنیاد، سازمان دولتی،
     * صندوق وام). این مبالغ پولِ واقعی و فیش‌دارند، پس برخلاف پوششِ جدولی
     * **سقف نمی‌خورند**: ۴۵۵ دانشجو-ترم در دادهٔ فعلی پوششی بیش از شهریهٔ
     * همان ترم دارند و اگر سقف بخورد، مازاد ناپدید و ماندهٔ دانشجو کاذب
     * بزرگ‌تر می‌شود.
     */
    let depositSponsorships = 0;
    let depositCharity = 0;
    let depositLoans = 0;

    for (const txn of inTerm(input.ledger || [])) {
      const amount = toNum(txn.amount);
      const dateMs = toMs(txn.createdAt);
      if (isChargeType(txn.transactionType)) {
        charges += amount;
        // تفکیک نمایشی: شهریهٔ ثابت و متغیر جدا شمرده می‌شوند (جمعشان بخشی از charges است)
        const tt = String(txn.transactionType || '').trim().toUpperCase();
        if (tt === 'TUITION_FIXED') tuitionFixed += amount;
        else if (tt === 'TUITION_VARIABLE') tuitionVariable += amount;
        events.push({
          kind: 'CHARGE',
          label: txn.description || 'ثبت شهریه',
          amount,
          dateMs,
          sign: -1
        });
      } else if (isPaymentType(txn.transactionType)) {
        const creditType = String(txn.transactionType || '').trim().toUpperCase();
        // تخفیف/پوششی که در خودِ دفتر ثبت شده — «پرداخت» نیست
        const isLedgerDiscount = LEDGER_DISCOUNT_TYPES.has(creditType);
        const isLedgerSponsor = LEDGER_SPONSORSHIP_TYPES.has(creditType);
        if (isLedgerDiscount || isLedgerSponsor) {
          if (isLedgerSponsor) ledgerSponsorships += amount;
          else ledgerDiscounts += amount;
          events.push({
            kind: isLedgerSponsor ? 'SPONSOR' : 'DISCOUNT',
            label: ledgerCreditLabel(creditType, txn.description, txn.legacyRem),
            amount,
            dateMs,
            sign: 1,
          });
          continue;
        }
        const depositType = String(txn.depositType || '').trim() || null;
        // تاریخ واقعی واریز اولویت دارد؛ createdAt فقط تاریخ ایمپورت است
        const paidAtMs = toMs(txn.depositDate);
        const event: StatementEvent = {
          kind: 'PAYMENT',
          label: stripDepositSuffix(txn.description || 'پرداخت', depositType),
          amount,
          dateMs: paidAtMs ?? dateMs,
          sign: 1,
          depositType,
          datedByDeposit: paidAtMs !== null,
          payerName: txn.payerName ?? null,
          payerNationalCode: txn.payerNationalCode ?? null,
          receiptNo: txn.receiptNo ?? null,
          voucherNo: txn.voucherNo ?? null,
          payTypeCode: txn.payTypeCode ?? null,
          accountNo: txn.accountNo ?? null,
          cardNo: txn.cardNo ?? null,
          bankName: txn.bankName ?? null,
          branchName: txn.branchName ?? null,
          recorderCode: txn.recorderCode ?? null,
          recorderName: txn.recorderName ?? null,
          legacyRem: txn.legacyRem ?? null,
        };

        /**
         * ── واریزی که پرداخت‌کننده‌اش شخص ثالث است ──
         *
         * سما این مبلغ را در `TermAms.TermPays` می‌آورد، پس از نظر تراز
         * «واریز» است و مانده را درست می‌سازد. ولی در سندِ چاپی باید زیر
         * «پوشش بنیاد»/«وام» دیده شود، وگرنه دانشجو (و کارشناس مالی)
         * ردیفِ «پوشش بنیاد: ۰» را کنار فهرستِ واریزی می‌بیند که خودِ
         * همان فهرست نوشته «سهم بنیاد یا سازمان دولتی» — تناقضِ آشکار.
         *
         * ⚠ مانده تغییر نمی‌کند: پوشش از «خالص» کم می‌شود، واریز از
         * «مانده»؛ جابه‌جاییِ همین مبلغ بین این دو، حاصلِ جبریِ یکسان
         * می‌دهد (به شرطِ نبودِ سقف — که برای واریزها اعمال نمی‌شود).
         */
        if (isSponsorDeposit(depositType)) {
          depositSponsorships += amount;
          events.push({ ...event, kind: 'SPONSOR' });
          continue;
        }
        if (isCharityDeposit(depositType)) {
          depositCharity += amount;
          events.push({ ...event, kind: 'CHARITY' });
          continue;
        }
        if (isLoanDeposit(depositType)) {
          depositLoans += amount;
          events.push({ ...event, kind: 'LOAN' });
          continue;
        }

        payments += amount;
        events.push(event);
      }
    }

    let discounts = 0;
    for (const d of discountByTerm) {
      if ((d as { termId?: number | null }).termId !== undefined &&
          ((d as { termId?: number | null }).termId ?? NO_TERM) !== termId) continue;
      discounts += toNum(d.amount);
      events.push({
        kind: 'DISCOUNT',
        label: d.title || 'تخفیف شهریه',
        amount: toNum(d.amount),
        dateMs: null,
        sign: 1
      });
    }

    let sponsorships = 0;
    for (const s of sponsorByTerm) {
      if ((s as { termId?: number | null }).termId !== undefined &&
          ((s as { termId?: number | null }).termId ?? NO_TERM) !== termId) continue;
      sponsorships += toNum(s.amount);
      events.push({
        kind: 'SPONSOR',
        label: s.title || 'پوشش بنیاد',
        amount: toNum(s.amount),
        dateMs: null,
        sign: 1
      });
    }

    let chequesCleared = 0;
    let chequesPending = 0;
    let chequesBounced = 0;

    for (const c of inTerm(input.cheques || [])) {
      const amount = toNum(c.amount);
      const status = String(c.status || '').toUpperCase();
      const label = `چک ${c.chequeNo || ''}${c.bankName ? ` — ${c.bankName}` : ''}`.trim();
      const dateMs = toMs(c.dueDate);

      if (status === CHEQUE_CLEARED) {
        chequesCleared += amount;
        events.push({ kind: 'CHEQUE', label: `${label} (وصول شد)`, amount, dateMs, sign: 1 });
      } else if (status === 'BOUNCED') {
        chequesBounced += amount;
        events.push({ kind: 'CHEQUE', label: `${label} (برگشتی)`, amount, dateMs, sign: -1 });
      } else if (status === 'CANCELLED') {
        events.push({ kind: 'CHEQUE', label: `${label} (باطل‌شده)`, amount, dateMs, sign: 1 });
      } else {
        chequesPending += amount;
        events.push({ kind: 'CHEQUE', label: `${label} (در انتظار وصول)`, amount, dateMs, sign: 1 });
      }
    }

    let loans = depositLoans;
    for (const l of inTerm(input.loans || [])) {
      const status = String(l.status || '').toUpperCase();
      if (!LOAN_ACTIVE.includes(status as (typeof LOAN_ACTIVE)[number])) continue;
      const amount = toNum(l.amount);
      loans += amount;
      events.push({
        kind: 'LOAN',
        label: l.lender ? `وام — ${l.lender}` : 'وام',
        amount,
        dateMs: toMs((l as { createdAt?: string | Date | null }).createdAt),
        sign: 1
      });
    }

    // 🔒 سقف: جمع تخفیف+پوشش هرگز از شهریهٔ همان ترم بیشتر نمی‌شود؛
    // خالصِ قابل‌پرداخت منفی (طلبِ کاذب به نفع دانشجو) ساخته نمی‌شود.
    // تخفیفِ دفتری (مثل بیتسِ سما) و تخفیفِ جدول تخفیف‌ها هر دو از بدهی کم
    // می‌کنند؛ سقف مشترک تا «خالص» منفی نشود.
    const cappedDiscounts = Math.min(discounts + ledgerDiscounts, charges);
    const cappedTableSponsorships = Math.min(
      sponsorships + ledgerSponsorships,
      Math.max(0, charges - cappedDiscounts),
    );
    /**
     * پوششِ جدولی سقف می‌خورد (تا «خالص» منفیِ کاذب نشود)، ولی پوششِ
     * برخاسته از واریز **نه** — آن پول واقعاً پرداخت شده و اگر بیشتر از
     * شهریه باشد، مازادش بستانکاریِ دانشجو است. نادیده‌گرفتنش مانده را
     * به‌اندازهٔ مازاد باد می‌کرد.
     */
    const cappedSponsorships = cappedTableSponsorships + depositSponsorships + depositCharity;
    const netPayable = charges - cappedDiscounts - cappedSponsorships;
    const balance = netPayable - payments - chequesCleared - loans;

    events.sort((a, b) => {
      const am = a.dateMs ?? 0;
      const bm = b.dateMs ?? 0;
      if (am !== bm) return am - bm;
      return a.kind.localeCompare(b.kind);
    });

    statements.push({
      termId,
      termTitle: termId === NO_TERM ? 'بدون ترم' : titles[String(termId)] || `ترم ${termId}`,
      termCode: termId === NO_TERM ? null : (input.termCodes || {})[String(termId)] ?? null,
      statusTitle: termId === NO_TERM ? null : (input.termStatuses || {})[String(termId)] ?? null,
      charges,
      tuitionFixed,
      tuitionVariable,
      discounts: cappedDiscounts,
      sponsorships: cappedSponsorships,
      sponsorshipsFromDeposits: depositSponsorships,
      charityCoverage: depositCharity,
      payments,
      chequesCleared,
      chequesPending,
      chequesBounced,
      loans,
      netPayable,
      balance,
      events
    });
  }

  return statements;
}

/** جمع کل کارنامه — ماندهٔ نهایی دانشجو (مثبت = بدهکار) */
export function transcriptTotals(statements: TermStatement[]): {
  charges: number;
  discounts: number;
  sponsorships: number;
  sponsorshipsFromDeposits: number;
  charityCoverage: number;
  payments: number;
  chequesCleared: number;
  chequesPending: number;
  chequesBounced: number;
  loans: number;
  balance: number;
} {
  const sum = (key: keyof TermStatement) =>
    (statements || []).reduce((acc, s) => acc + toNum(s[key]), 0);

  return {
    charges: sum('charges'),
    discounts: sum('discounts'),
    sponsorships: sum('sponsorships'),
    sponsorshipsFromDeposits: sum('sponsorshipsFromDeposits'),
    charityCoverage: sum('charityCoverage'),
    payments: sum('payments'),
    chequesCleared: sum('chequesCleared'),
    chequesPending: sum('chequesPending'),
    chequesBounced: sum('chequesBounced'),
    loans: sum('loans'),
    balance: sum('balance')
  };
}
