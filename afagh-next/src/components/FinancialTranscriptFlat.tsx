import type { ReactNode } from 'react';
import { toJalaliFromDate, faDigits } from '@/lib/calendar';
import { normalizeTermCode } from '@/lib/scheduling-core';
import { PAY_TYPE_LABELS } from '@/lib/finance-rules/statement';
import { courseTypeLabelOf } from '@/lib/mali-types';

/**
 * ══════════════════════════════════════════════════════════════════════
 *  کارنامهٔ مالی — مدل دوم: چیدمانِ تخت و فشرده (جدول‌های پیوسته)
 *
 *  این نسخه پس از بازگشت به مدلِ کارتیِ اصلی، به‌عنوان «مدل دومِ کارنامه»
 *  نگه داشته شد (درخواست کاربر). ریشهٔ کلاسِ آن `tr-flat-root` است تا
 *  قواعد چاپش با مدل کارتی تداخل نکند.
 *
 *  الگوی بصری از سربرگِ کارنامهٔ رسمیِ دانشگاه‌ها گرفته شده است:
 *     ① نوارِ سربرگ در چهار ناحیه: [شمارهٔ نامه/تاریخ] | [دانشکده/رشته/مقطع/نوع دوره]
 *        | [کد ملی/شمارهٔ دانشجویی/تاریخ تولد/وضعیت] | [عکس]
 *     ② نوارِ جمع (خلاصهٔ مالی) درست زیر سربرگ
 *     ③ **جدول‌های تخت و فشرده**: ریزِ شهریهٔ متغیرِ دروس،
 *        خلاصهٔ ترم‌به‌ترم، و دفترِ رویدادهای مالی
 *     ④ پانوشتِ حقوقی + نوارِ امضا و مهر در پاصفحهٔ چاپ
 *
 *  چرا تخت و فشرده؟ کارشناسِ مالی باید بتواند کلِ سند را روی یک برگ ببیند و
 *  ردیف‌ها را روی هم تایی کند؛ کارت‌های رنگیِ جفتی این را ناممکن می‌کنند.
 *  رنگ‌ها هم عمداً محدودند (سیاه/خاکستری + یک قرمز برای بدهی) تا سند
 *  «اداری» به نظر برسد، نه «داشبورد».
 *
 *  عمداً هیچ وابستگی سروری (server-only / db / auth) ندارد تا هم در
 *  صفحات سروری (ادمین و دانشجو) و هم در کامپوننت کلاینتی صورت‌حساب
 *  (reports/student-statement) قابل استفاده باشد. تنها ورودی، دادهٔ
 *  آمادهٔ موتور کانونی مالی (getStudentFinance / API صورت‌حساب) است.
 *
 *  قرارداد علامت (یکپارچه با موتور): مثبت = بدهی دانشجو.
 * ══════════════════════════════════════════════════════════════════════
 */

const fa = (n: number | null | undefined) => Number(n || 0).toLocaleString('fa-IR');

/**
 * تاریخ شمسی خوانا؛ تهی → خط تیره.
 * ورودیِ رشته‌ایِ از قبل شمسی (مثل `students.entryDate` = «1400-07-01») نباید
 * دوباره میلادی تفسیر شود؛ وگرنه سال سه‌رقمی (۷۷۹) چاپ می‌شود.
 */
function jdate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  if (typeof d === 'string' && /^1[34]\d{2}[\/-]/.test(d.trim())) {
    return faDigits(d.trim().replace(/-/g, '/'));
  }
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const { jy, jm, jd } = toJalaliFromDate(date);
  return faDigits(`${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`);
}

export interface TranscriptEventView {
  kind: string;
  label: string;
  amount: number;
  dateMs: number | null;
  sign: 1 | -1;
  /** نوع واریز (نقدی، چک، کارت‌خوان سامان، …) — فقط رویدادهای پرداخت */
  depositType?: string | null;
  /** تاریخِ نمایش، تاریخ واقعی واریز است نه زمان ثبت رکورد */
  datedByDeposit?: boolean;
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

export interface TranscriptCourseView {
  courseCode: string | null;
  courseTitle: string | null;
  units: number;
  perUnit: number;
  amount: number;
  /** نمرهٔ نهایی درس (اگر نهایی شده باشد) */
  grade?: number | null;
  /** ماهیت درس (نظری/عملی/…) */
  courseNature?: string | null;
  /** نوع درس مالی سما (LT7.Mali_type) — همان کدی که نرخ هر واحد را تعیین می‌کند */
  maliType?: number | null;
  /** سطلِ نوع درس در موتور یکپارچه (نظری/عملی/عمومی) — پشتیبانِ maliType */
  offeringType?: string | null;
  theoreticalUnits?: number;
  practicalUnits?: number;
}

/**
 * برچسبِ «نوع درس» برای ستون کارنامه.
 *
 * نرخ هر واحد در سما از «نوع درس مالی» می‌آید، نه از واحد؛ پس همان چیزی که
 * واقعاً مبلغ را می‌سازد نمایش داده می‌شود. منطقش در `mali-types` است تا
 * جداگانه تست شود.
 */
const courseTypeLabel = (c: TranscriptCourseView) => courseTypeLabelOf(c);

/** «مبنای نرخ» — یکسان در نوع الف و نوع ب تا دو سند با هم نخوانند. */
const rateBasisLabel = (t: TranscriptTermView): string =>
  t.coursesBasis === 'TARIFF' ? 'تعرفهٔ رسمی همان سال' : 'محاسباتی (دفتر کل)';

export interface TranscriptTermView {
  termId: number;
  termTitle: string;
  /** کد ۵ رقمی ترم؛ اگر باشد عنوان کامل «نیمسال اول سال تحصیلی ...» ساخته می‌شود */
  termCode?: string | null;
  /** وضعیت نیمسال دانشجو (در حال تحصیل / مرخصی / مهمان / انصراف / …) — نمایش در سرآیند ترم */
  statusTitle?: string | null;
  charges: number;
  /**
   * تفکیکِ شهریهٔ ترم به «ثابت» و «متغیر» (از نوعِ تراکنش دفتر مالی).
   * سما همین دو قلم را جدا نشان می‌دهد؛ نبودشان در کارنامه یعنی کارشناس مالی
   * نمی‌تواند بفهمد عددِ شهریه از کجا آمده. اگر ترمی این تفکیک را نداشته باشد
   * (دادهٔ قدیمی)، ردیفش چاپ نمی‌شود.
   */
  tuitionFixed?: number;
  tuitionVariable?: number;
  discounts: number;
  sponsorships: number;
  /** بخشی از پوشش که از واریزِ واقعیِ بنیاد/سازمان دولتی آمده است */
  sponsorshipsFromDeposits?: number;
  /** پوششِ صندوق خیریه — با برچسب مستقل «پوشش خیرین» چاپ می‌شود */
  charityCoverage?: number;
  netPayable: number;
  payments: number;
  chequesCleared: number;
  chequesPending: number;
  chequesBounced: number;
  loans: number;
  balance: number;
  events: TranscriptEventView[];
  /** ریز شهریهٔ متغیر دروس ترم (محاسباتی/اطلاعاتی) */
  courses?: TranscriptCourseView[];
  /**
   * منبعِ «وزن» ریز دروس:
   *   ▸ TARIFF = تعرفهٔ رسمی تفصیلی همان سال (نظری×نرخ + عملی×نرخِ نوع درس مالی)
   *   ▸ LEDGER = موتور یکپارچهٔ شهریه (نیمسال‌هایی که تعرفهٔ تفصیلی ندارند)
   * مبلغ هر درس در هر دو حالت به تناسب وزن از جمع «شهریهٔ متغیر» دفتر کل تخصیص
   * می‌یابد (جمع دفتر کل، سند معتبر است).
   */
  coursesBasis?: 'TARIFF' | 'LEDGER';
  /** «کد گروه تعرفه» (uPriceCode) — همان گروهی که نرخ نوع درس مالی از آن آمد */
  tariffGroupCode?: string | null;
}

export interface TranscriptTotalsView {
  charges: number;
  discounts: number;
  sponsorships: number;
  sponsorshipsFromDeposits?: number;
  charityCoverage?: number;
  payments: number;
  chequesCleared: number;
  chequesPending: number;
  chequesBounced: number;
  loans: number;
  balance: number;
}

export interface TranscriptStudentView {
  fullName: string | null;
  studentCode: string | null;
  nationalCode?: string | null;
  majorTitle?: string | null;
  degreeTitle?: string | null;
  entryYear?: number | null;
  /** نیمسال ورود: ۱=مهر، ۲=بهمن، ۳=تابستان (students.entryTerm) */
  entryTerm?: number | null;
  status?: string | null;
  // ── فیلدهای سربرگ (انعکاس سیستم قدیمی) ──
  facultyTitle?: string | null;
  quotaType?: string | null;
  courseType?: string | null;
  admissionMethod?: string | null;
  entryDate?: string | Date | null;
  settlementDate?: string | Date | null;
  // ── سربرگِ رسمی (سبک کارنامهٔ دانشگاهی) ──
  /** مسیر عکسِ دانشجو (معمولاً ‎/api/photo/{userId}‎) — خالی = فقط کادر «عکس» */
  photoUrl?: string | null;
  /** شمارهٔ شناسنامه (persons.birthCertNo) */
  birthCertNo?: string | null;
  /** تاریخ تولد (persons.birthDate) */
  birthDate?: string | Date | null;
  /** شمارهٔ سند/نامهٔ صدور — در سربرگِ سمت راست چاپ می‌شود */
  documentNo?: string | null;
  /** نام دانشگاهِ مبدأ (برای دانشجوی انتقالی) */
  originUniversityTitle?: string | null;
}

export interface TranscriptChequeView {
  id: number;
  chequeNo?: string | null;
  bankName?: string | null;
  amount: number | string | null;
  dueDate?: string | Date | null;
  status?: string | null;
}

export interface TranscriptLoanView {
  id: number;
  productTitle?: string | null;
  lender?: string | null;
  amount: number | string | null;
  installments?: number | null;
  status?: string | null;
}

const EVENT_LABEL: Record<string, string> = {
  CHARGE: 'بدهی',
  DISCOUNT: 'تخفیف',
  SPONSOR: 'پوشش بنیاد',
  CHARITY: 'پوشش خیرین',
  PAYMENT: 'پرداخت',
  CHEQUE: 'چک',
  LOAN: 'وام',
  CLEARANCE: 'تسویه',
};

/** نیمسال ورود (students.entryTerm): ۱=مهر، ۲=بهمن، ۳=تابستان */
const TERM_FA: Record<number, string> = { 1: 'مهر', 2: 'بهمن', 3: 'تابستان' };

/**
 * عنوان کامل ترم — همان عبارت‌بندی کارنامهٔ تحصیلی:
 *   نیمسال اول سال تحصیلی ۱۴۰۴-۱۴۰۵ / نیمسال تابستان ... / نیمسال معادل‌سازی
 * منبع: termCode پنج‌رقمی (سال + رقم نیمسال) از academic_terms.termCode.
 *
 * ⚠️ نکتهٔ چاپ: بازهٔ سال باید داخل `dir="ltr"` باشد. خط تیره (-) در متن راست‌به‌چپ
 * بین دو عدد فارسی، جداکنندهٔ دوجهته نیست و مرورگر دو عدد را جابه‌جا می‌چاپ می‌کند
 * («۱۴۰۵-۱۴۰۴» به‌جای «۱۴۰۴-۱۴۰۵»). با span LTR ترتیب درست تضمین می‌شود.
 */
function TermTitle({ t }: { t: TranscriptTermView }) {
  const norm = normalizeTermCode(t.termCode);
  if (!norm) return <>{t.termTitle || '—'}</>;
  if (norm.termType === 'EQUIVALENCE') return <>نیمسال معادل‌سازی</>;
  const year = <span dir="ltr">{faDigits(norm.displayYear)}</span>;
  // ترم تابستان در کارنامه با عنوان «دوره تابستانی» آورده می‌شود (درخواست کاربر).
  if (norm.termType === 'SUMMER') return <>دوره تابستانی {year}</>;
  return <>{`${norm.displaySemester} سال تحصیلی `}{year}</>;
}

/**
 * برچسبِ فشردهٔ ترم برای ستونِ جدول‌های تخت — «۱۴۰۴-۱۴۰۵ / ۱».
 * ستونِ «نیمسال» در جدولِ تخت جای گروه‌بندیِ سالی را می‌گیرد.
 */
function termShort(t: TranscriptTermView): ReactNode {
  const norm = normalizeTermCode(t.termCode);
  if (!norm) return <span className="text-[7.5pt]">{t.termTitle || '—'}</span>;
  if (norm.termType === 'EQUIVALENCE') return <span className="text-[7.5pt]">معادل‌سازی</span>;
  if (norm.termType === 'SUMMER') return <span className="text-[7.5pt]">تابستان <span dir="ltr">{faDigits(norm.displayYear)}</span></span>;
  return (
    <span className="text-[7.5pt] whitespace-nowrap">
      <span dir="ltr">{faDigits(norm.displayYear)}</span>
      <span className="mx-0.5 text-slate-400">/</span>
      <span dir="ltr">{faDigits(norm.semester)}</span>
    </span>
  );
}

const STATUS_FA: Record<string, string> = { ACTIVE: 'فعال',
  INACTIVE: 'غیرفعال',
  GRADUATED: 'دانش‌آموخته',
  WITHDRAWN: 'انصرافی',
  EXPELLED: 'اخراجی',
  SUSPENDED: 'معلق',
};

/** نگاشت کد سهمیه (students.quotaType) به برچسب فارسی — ناشناخته = مقدار خام */
const QUOTA_FA: Record<string, string> = {
  NORMAL: 'منطقه‌ای (آزاد)',
  REGION1: 'منطقه ۱',
  REGION2: 'منطقه ۲',
  REGION3: 'منطقه ۳',
  SHAHRIYE: 'شهریه‌پرداز',
  MARTYR: 'خانوادهٔ شهید',
  MEMORIAL: 'ایثارگران',
  RURAL: 'روستایی',
};
const quotaLabel = (q: string | null | undefined) => (q ? (QUOTA_FA[q] ?? q) : '—');

function balanceBadge(balance: number): { text: string; cls: string } {
  if (balance > 0) return { text: 'بدهکار', cls: 'bg-rose-100 text-rose-800 border-rose-300' };
  if (balance < 0) return { text: 'بستانکار', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
  return { text: 'تسویه', cls: 'bg-slate-100 text-slate-700 border-slate-300' };
}

function toNum(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** نمایش ۴ رقم آخر (برای ماسک‌کردن شماره حساب در نمای دانشجو) */
function last4(s: string | null | undefined): string {
  if (!s) return '';
  return s.length > 4 ? '••••' + s.slice(-4) : s;
}
/** ماسک‌کردن کد ملی: در نمای کارشناس مالی کامل، در نمای دانشجو ۴ رقم آخر */
function maskNC(nc: string | null | undefined, isFinance: boolean): string {
  if (!nc) return '';
  if (isFinance) return nc;
  return nc.length > 4 ? '••••' + nc.slice(-4) : nc;
}

/**
 * یک قلمِ فرادادهٔ پرداخت — «برچسب: مقدار» در یک تکه‌ی جدا‌نشدنی.
 *
 * چرا کامپوننت و نه span تکراری؟ چون این اقلام ۷ تا ۸ عددند و اگر هر کدام
 * `block` باشند، هر پرداخت ۸ سطر کاغذ می‌خورد و کارنامه پخش‌وپلا می‌شود.
 * با `whitespace-nowrap` هر قلم سالم می‌ماند و شکستن فقط بینِ اقلام رخ می‌دهد.
 */
function Meta({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap" title={`${k}: ${v}`}>
      <span className="text-slate-400">{k}:</span>
      <b className={`font-bold text-slate-700 ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : undefined}>{v}</b>
    </span>
  );
}

export interface FinancialTranscriptProps {
  student: TranscriptStudentView;
  terms: TranscriptTermView[];
  totals: TranscriptTotalsView;
  /** عنوان دانشگاه در سربرگ — از رکورد دانشگاه یا تنظیمات سراسری (UNIVERSITY_NAME) */
  universityTitle?: string | null;
  /** آرم/نشان اختصاصی دانشگاه در مدخل میانی سربرگ؛ خالی = نشان دایره‌ای پیش‌فرض */
  logoUrl?: string | null;
  /** تاریخ صدور شمسی در سربرگ (اگر داده نشود، چاپ نمی‌شود — برای جلوگیری از ناهماهنگی hydration در کلاینت) */
  issuedAt?: string | null;
  /** عنوان بخش جمع (پیش‌فرض: «جمع کل دوره») */
  scopeLabel?: string;
  /** رویدادهای هر ترم نمایش داده شوند؟ (پیش‌فرض: بله) */
  showEvents?: boolean;
  /** نقش بیننده: دانشجو فقط ماسک‌شده می‌بیند؛ کارشناس مالی/ادمین مستندات کامل (شماره حساب/کارت) را می‌بیند */
  viewerRole?: 'STUDENT' | 'FINANCE' | 'ADMIN';
  /** نسخهٔ رسمی تأییدشده (درخواست FINANCE_STATEMENT تأیید شده) — نوار «غیرقابل استناد» حذف و QR فعال می‌شود */
  official?: boolean;
  /** جدول چک‌ها / وام‌ها (اگر خالی باشند، بخششان چاپ نمی‌شود) */
  cheques?: TranscriptChequeView[];
  loans?: TranscriptLoanView[];
  /** بلوک الحاقی بعد از مشخصات (مثلاً جعبهٔ ضریب شهریه در نمای ادمین) */
  leadBlock?: ReactNode;
  /** بلوک رسمیت انتهای سند (مثلاً QR استعلام + مهر در نمای دانشجو) */
  verifyBlock?: ReactNode;
}

export default function FinancialTranscriptFlat({
  student,
  terms,
  totals,
  universityTitle,
  logoUrl,
  issuedAt,
  scopeLabel,
  showEvents = true,
  viewerRole = 'STUDENT',
  official = false,
  cheques = [],
  loans = [],
  leadBlock,
  verifyBlock,
}: FinancialTranscriptProps) {
  const paidTotal = totals.payments + totals.chequesCleared + totals.loans;
  const grand = balanceBadge(totals.balance);
  const isFinance = viewerRole === 'FINANCE' || viewerRole === 'ADMIN';

  // ── جدولِ تخت: همهٔ دروسِ همهٔ ترم‌ها در یک فهرستِ پیوسته ──
  // چرا تخت؟ کارشناسِ مالی باید کلِ ریزِ شهریه را یک‌جا و روی یک برگ ببیند؛
  // کارت‌های جفتی (سابق) مقایسهٔ بین ترم‌ها را سخت می‌کرد.
  const courseRows: { term: TranscriptTermView; c: TranscriptCourseView }[] = [];
  for (const t of terms) for (const c of (t.courses ?? [])) courseRows.push({ term: t, c });

  // ماندهٔ قبلی (انتقالی) هر ترم = جمعِ ماندهٔ همهٔ ترم‌های پیش از آن (به ترتیب زمانی)
  const priorByTermId = new Map<number, number>();
  {
    let running = 0;
    for (const t of terms) { priorByTermId.set(t.termId, running); running += t.balance; }
  }

  // جمعِ شهریهٔ ثابت/متغیرِ کل دوره — برای تفکیکِ خانهٔ «جمع شهریه» در نوارِ جمع
  const sumFixed = terms.reduce((a, t) => a + (t.tuitionFixed ?? 0), 0);
  const sumVariable = terms.reduce((a, t) => a + (t.tuitionVariable ?? 0), 0);

  // جمعِ «خالص» کل دوره — از خودِ ردیف‌های ترم جمع زده می‌شود نه از فرمول،
  // تا با تعریفِ موتور مالی (netPayable) سنت برابر بماند.
  const totalNet = terms.reduce((a, t) => a + t.netPayable, 0);

  // جمعِ واحدهای نظری/عملیِ ریزِ دروس — برای نوارِ پایانی (ستون «واحد» حذف شد)
  const totalTheoryUnits = courseRows.reduce((a, r) => a + (Number(r.c.theoreticalUnits) || 0), 0);
  const totalPracticalUnits = courseRows.reduce((a, r) => a + (Number(r.c.practicalUnits) || 0), 0);
  const totalListedAmount = courseRows.reduce((a, r) => a + (Number(r.c.amount) || 0), 0);

  // همهٔ رویدادهای مالی در یک دفترِ پیوسته (مثل دفترِ کل)
  const allEvents = terms.flatMap(t => t.events.map(e => ({ term: t, e })));

  return (
    <div dir="rtl" className="transcript-print-area tr-root tr-flat-root bg-white border-2 border-slate-900 shadow-xl print:shadow-none text-slate-900 text-xs">
      {/* ساختار سند به سبک کارنامهٔ رسمی: table.tr-doc با thead/tfoot تا سربرگ
          و بلوک امضا در همهٔ صفحات چاپ تکرار شوند و ردیف‌ها بین دو صفحه نشکنند. */}
      <table className="tr-doc rt w-full max-w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <td className="tr-doc-cell">

              {/* ═══ ① نوارِ عنوانِ بالای سند ═══
                  آرمِ دانشگاه در بالای سربرگ می‌نشیند (مثلِ کارنامهٔ رسمیِ دانشگاهی)
                  تا سند از همان نگاهِ اول، رسمی و رسمیت‌دار به‌نظر برسد. */}
              <div className="tr-fin-titlebar border-b-2 border-slate-900 px-4 pt-2 pb-1.5">
                <div className="flex flex-col items-center text-center">
                  {logoUrl ? (
                    <img src={logoUrl} alt="آرم دانشگاه" className="mb-1 h-[10mm] w-[10mm] shrink-0 object-contain" />
                  ) : (
                    <span className="mb-1 flex h-[10mm] w-[10mm] shrink-0 items-center justify-center rounded border border-dashed border-slate-300 text-[6.5pt] text-slate-400">
                      ارم
                    </span>
                  )}
                  <p className="text-[10.5pt] font-black tracking-wide">جمهوری اسلامی ایران</p>
                  <p className="text-[8.5pt] font-bold">وزارت علوم، تحقیقات و فناوری</p>
                  {universityTitle ? <p className="text-[11pt] font-black">{universityTitle}</p> : null}
                  <p className="text-[7.5pt] text-slate-600">معاونت اداری و مالی — ادارهٔ امور مالی و امور دانشجویی</p>
                  <h2 className="mt-1 inline-block border border-slate-900 px-3 py-0.5 text-[9.5pt] font-black">کارنامهٔ مالی دانشجو</h2>
                </div>
              </div>

              {/* ═══ ② سربرگِ چهارناحیه‌ای (الگوی کارنامهٔ رسمی) ═══
                  ناحیه‌ها از راست به چپ: شمارهٔ نامه | دانشکده/رشته/مقطع | هویت | عکس */}
              <div className="tr-fin-head grid grid-cols-4 border-b-2 border-slate-900 text-[8pt]">
                {/* ناحیهٔ ۱ (راست‌ترین): شمارهٔ نامه و تاریخ‌های سند */}
                <div className="tr-fin-head-col border-l border-slate-400 px-2 py-1.5">
                  <p className="mb-1 border-b border-slate-300 pb-1 text-center text-[7.5pt] font-black">
                    شمارهٔ نامه
                  </p>
                  <dl className="space-y-0.5">
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">شمارهٔ سند:</dt>
                      <dd className="truncate font-mono font-bold" dir="ltr">{student.documentNo || faDigits(student.studentCode || '—')}</dd>
                    </div>
                    {issuedAt ? (
                      <div className="flex gap-1">
                        <dt className="shrink-0 text-slate-500">تاریخ صدور:</dt>
                        <dd className="font-bold" dir="ltr">{issuedAt}</dd>
                      </div>
                    ) : null}
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">تاریخ ورود:</dt>
                      <dd className="font-bold" dir="ltr">{jdate(student.entryDate)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">تاریخ تسویه:</dt>
                      <dd className="font-bold" dir="ltr">{jdate(student.settlementDate)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">شمارهٔ پرونده:</dt>
                      <dd className="truncate font-mono font-bold" dir="ltr">{faDigits(student.studentCode || '—')}</dd>
                    </div>
                    <div className="flex gap-1 items-center">
                      <dt className="shrink-0 text-slate-500">وضعیت مالی:</dt>
                      <dd><span className={`rounded-full border px-1.5 py-px text-[6.5pt] font-black ${grand.cls}`}>{grand.text}</span></dd>
                    </div>
                  </dl>
                </div>

                {/* ناحیهٔ ۲: دانشکده / رشته / مقطع / نوع دوره */}
                <div className="tr-fin-head-col border-l border-slate-400 px-2 py-1.5">
                  <p className="mb-1 border-b border-slate-300 pb-1 text-center text-[7.5pt] font-black">
                    مشخصات تحصیلی
                  </p>
                  <dl className="space-y-0.5">
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">دانشکده:</dt>
                      <dd className="truncate font-bold">{student.facultyTitle || '—'}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">رشته:</dt>
                      <dd className="truncate font-bold">{student.majorTitle || '—'}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">مقطع:</dt>
                      <dd className="truncate font-bold">{student.degreeTitle || '—'}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">نوع دوره:</dt>
                      <dd className="truncate font-bold">{student.courseType || '—'}</dd>
                    </div>
                    {student.originUniversityTitle ? (
                      <div className="flex gap-1">
                        <dt className="shrink-0 text-slate-500">دانشگاه مبدأ:</dt>
                        <dd className="truncate font-bold">{student.originUniversityTitle}</dd>
                      </div>
                    ) : null}
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">نیمسال ورود:</dt>
                      <dd className="truncate font-bold">
                        {student.entryTerm
                          ? `${TERM_FA[student.entryTerm] ?? `نیمسال ${fa(student.entryTerm)}`}${student.entryYear ? ' ' + fa(student.entryYear) : ''}`
                          : (student.entryYear ? fa(student.entryYear) : '—')}
                      </dd>
                    </div>
                    {student.admissionMethod ? (
                      <div className="flex gap-1">
                        <dt className="shrink-0 text-slate-500">روش پذیرش:</dt>
                        <dd className="truncate font-bold">{student.admissionMethod}</dd>
                      </div>
                    ) : null}
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">سهمیه:</dt>
                      <dd className="truncate font-bold">{quotaLabel(student.quotaType)}</dd>
                    </div>
                  </dl>
                </div>

                {/* ناحیهٔ ۳: هویت دانشجو */}
                <div className="tr-fin-head-col border-l border-slate-400 px-2 py-1.5">
                  <p className="mb-1 border-b border-slate-300 pb-1 text-center text-[7.5pt] font-black">
                    مشخصات فردی
                  </p>
                  <dl className="space-y-0.5">
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">نام و نام خانوادگی:</dt>
                      <dd className="truncate font-bold">{student.fullName || '—'}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">شمارهٔ دانشجویی:</dt>
                      <dd className="truncate font-mono font-bold" dir="ltr">{faDigits(student.studentCode || '—')}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">کد ملی:</dt>
                      <dd className="truncate font-mono font-bold" dir="ltr">{faDigits(maskNC(student.nationalCode, isFinance) || '—')}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">تاریخ تولد:</dt>
                      <dd className="font-bold" dir="ltr">{jdate(student.birthDate)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">شمارهٔ شناسنامه:</dt>
                      <dd className="truncate font-mono font-bold" dir="ltr">{faDigits(student.birthCertNo || '—')}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="shrink-0 text-slate-500">وضعیت:</dt>
                      <dd className="truncate font-bold">{(student.status && STATUS_FA[student.status]) || student.status || '—'}</dd>
                    </div>
                  </dl>
                </div>

                {/* ناحیهٔ ۴ (چپ‌ترین): عکس دانشجو — درست مثل کارنامهٔ رسمی دانشگاهی.
                    آرمِ دانشگاه از اینجا برداشته شد و به بالای سربرگ (نوارِ عنوان) منتقل شد. */}
                <div className="tr-fin-head-col flex flex-col items-center justify-start px-2 py-1.5">
                  {student.photoUrl ? (
                    <img
                      src={student.photoUrl}
                      alt="عکس دانشجو"
                      className="h-[22mm] w-[17mm] shrink-0 border border-slate-500 object-cover"
                    />
                  ) : (
                    <div className="flex h-[22mm] w-[17mm] shrink-0 items-center justify-center border border-dashed border-slate-400 text-[7pt] text-slate-400">
                      عکس
                    </div>
                  )}
                </div>
              </div>

              {/* نوارِ وضعیت سند — فقط در نمای دانشجو.
                  • تأییدنشده: «غیرقابل استناد / در انتظار تأیید»
                  • تأییدشده: نوار سبز رسمیت + QR. */}
              {!isFinance && !official && (
                <div className="tr-unverified-band mx-4 mb-2 mt-1.5 flex flex-wrap items-center justify-between gap-2 border-2 border-amber-700 bg-amber-50 px-2 py-1 text-[9px] font-black text-amber-950">
                  <span>⚠️ این کارنامه تا تأیید و مهر کارشناس امور مالی <u>غیرقابل استناد</u> است.</span>
                  <span className="shrink-0 font-mono text-[8px] text-amber-900">وضعیت: در انتظار تأیید</span>
                </div>
              )}
              {!isFinance && official && (
                <div className="tr-official-band mx-4 mb-2 mt-1.5 flex flex-wrap items-center justify-between gap-2 border-2 border-emerald-700 bg-emerald-50 px-2 py-1 text-[9px] font-black text-emerald-950">
                  <span>✅ این کارنامه با تأیید کارشناس امور مالی، دارای <u>رمز استعلام اصالت (QR)</u> است.</span>
                  <span className="shrink-0 font-mono text-[8px] text-emerald-900">وضعیت: تأییدشده</span>
                </div>
              )}
            </td>
          </tr>
        </thead>
        <tbody>
          {/* ═══ ردیفِ اول: نوارِ جمعِ کل + جدولِ ریزِ شهریهٔ متغیر ═══ */}
          <tr className="tr-doc-row">
            <td className="tr-doc-cell">
              <div className="px-4 pt-1 pb-3">

                {/* ── ③ نوارِ جمع (خلاصهٔ مالی) ── */}
                <div className="tr-fin-breakdown break-inside-avoid border border-slate-900">
                  <h3 className="border-b border-slate-900 bg-slate-100 px-2 py-1 text-[8pt] font-black">
                    {scopeLabel || 'جمع کل دوره'} — به ریال
                  </h3>
                  <table className="tr-fin-totals w-full border-collapse text-center text-[8pt]">
                    <thead>
                      <tr className="bg-slate-50 text-slate-700">
                        <th className="border border-slate-300 px-1 py-1 font-bold">جمع شهریه</th>
                        <th className="border border-slate-300 px-1 py-1 font-bold">تخفیف‌ها</th>
                        <th className="border border-slate-300 px-1 py-1 font-bold">پوشش بنیاد / خیرین</th>
                        <th className="border border-slate-300 px-1 py-1 font-bold">پرداخت / چک وصولی / وام</th>
                        <th className="border border-slate-300 px-1 py-1 font-bold">ماندهٔ نهایی</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="font-bold">
                        <td className="border border-slate-300 px-1 py-1">
                          {fa(totals.charges)}
                          {/* تفکیکِ شهریه در همان خانه — کارشناس مالی بدون بازکردن ترم‌ها
                              می‌بیند چه سهمی ثابت و چه سهمی متغیر است. */}
                          {(sumFixed > 0 || sumVariable > 0) && (
                            <span className="mt-0.5 block text-[6.8pt] font-medium text-slate-500">
                              ثابت {fa(sumFixed)} · متغیر {fa(sumVariable)}
                            </span>
                          )}
                        </td>
                        <td className="border border-slate-300 px-1 py-1">{fa(totals.discounts)}</td>
                        <td className="border border-slate-300 px-1 py-1">
                          {fa(totals.sponsorships)}
                          {/* تفکیک: چه بخشی از پوشش از واریزِ واقعیِ بنیاد آمده است.
                              بدون این خط، کارشناس مالی نمی‌فهمد پوشش «سندِ واریز» دارد
                              یا فقط تخفیفِ دفتری است. */}
                          {(totals.sponsorshipsFromDeposits ?? 0) > 0 && (
                            <span className="mt-0.5 block text-[6.8pt] font-medium text-slate-500">
                              از واریز بنیاد {fa(totals.sponsorshipsFromDeposits ?? 0)}
                            </span>
                          )}
                          {(totals.charityCoverage ?? 0) > 0 && (
                            <span className="mt-0.5 block text-[6.8pt] font-medium text-slate-500">
                              از خیرین {fa(totals.charityCoverage ?? 0)}
                            </span>
                          )}
                        </td>
                        <td className="border border-slate-300 px-1 py-1">{fa(paidTotal)}</td>
                        <td className={`border border-slate-300 px-1 py-1 text-[9.5pt] font-black ${totals.balance > 0 ? 'text-rose-700' : totals.balance < 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                          {fa(Math.abs(totals.balance))}
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={5} className="border border-slate-300 bg-slate-50 px-2 py-1 text-[8pt] font-bold text-slate-700">
                          {totals.balance > 0
                            ? `ماندهٔ بدهی دانشجو: ${fa(totals.balance)} ریال`
                            : totals.balance < 0
                              ? `بستانکاری دانشجو: ${fa(Math.abs(totals.balance))} ریال`
                              : 'حساب تسویه است'}
                          {totals.chequesPending > 0 && (
                            <span className="text-amber-700"> — ⚠️ {fa(totals.chequesPending)} ریال چک وصول‌نشده در مانده لحاظ نشده است</span>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {leadBlock}

                {/* ── ④ جدولِ تختِ ریزِ شهریهٔ متغیرِ دروس ── */}
                <div className="tr-fin-block break-inside-avoid mt-3">
                  <h3 className="tr-fin-block-title border-b-2 border-slate-900 pb-0.5 text-[8.5pt] font-black">
                    ریزِ شهریهٔ متغیرِ دروس
                  </h3>
                  {/* مدل تخت سربرگِ کارت ندارد؛ نام کامل نیمسال + وضع نیمسال +
                      مبنای نرخ + کد گروه تعرفه در همین جدول میآید و چاپ میشود. */}
                  {terms.length > 0 && (
                    <table className="tr-term-meta w-full border-collapse text-[7.5pt]">
                      <colgroup>
                        <col style={{ width: '40%' }} />
                        <col style={{ width: '20%' }} />
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '18%' }} />
                      </colgroup>
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">نام نیمسال</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">وضع نیمسال</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">مبنای نرخ</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">کد گروه تعرفه</th>
                        </tr>
                      </thead>
                      <tbody>
                        {terms.map((t) => (
                          <tr key={t.termId} className="border-b border-slate-200">
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center"><TermTitle t={t} /></td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center">{t.statusTitle || '—'}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center">{rateBasisLabel(t)}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono" dir="ltr">{t.tariffGroupCode || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {courseRows.length === 0 ? (
                    <p className="border border-slate-300 bg-slate-50 py-3 text-center text-[8pt] text-slate-500">
                      ریزِ شهریهٔ متغیر برای این دانشجو ثبت نشده است.
                    </p>
                  ) : (
                    <table className="tr-fin-table w-full border-collapse text-[7.5pt]">
                      <colgroup>
                        <col style={{ width: '4%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '27%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '15%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '11%' }} />
                      </colgroup>
                      <thead>
                        <tr className="bg-slate-100 text-slate-800">
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">ردیف</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">نیمسال</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">کد درس</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 font-bold">عنوان درس</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">نمره</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">نوع درس مالی</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">واحد نظری</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">واحد عملی</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">مبلغ متغیر (ریال)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {courseRows.map((r, i) => (
                          <tr key={`${r.term.termId}-${i}`} className="border-b border-slate-200">
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center text-slate-500">{fa(i + 1)}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center">{termShort(r.term)}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono" dir="ltr">{r.c.courseCode || '—'}</td>
                            <td className="tr-course-title border border-slate-200 px-0.5 py-0.5 font-medium">{r.c.courseTitle || '—'}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono">{r.c.grade != null ? fa(r.c.grade) : '—'}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center">
                              {courseTypeLabel(r.c)}
                              {r.c.maliType != null && (
                                <span className="tr-mali-code ms-1 font-mono font-bold text-slate-700">({fa(r.c.maliType)})</span>
                              )}
                            </td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono">{fa(r.c.theoreticalUnits ?? 0)}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono">{fa(r.c.practicalUnits ?? 0)}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-left font-bold">{fa(r.c.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-900 bg-slate-50 font-black">
                          <td colSpan={8} className="border border-slate-300 px-1 py-0.5 text-center">
                            جمع ریزِ دروس ({fa(courseRows.length)} ردیف — نظری {fa(totalTheoryUnits)} · عملی {fa(totalPracticalUnits)} واحد)
                          </td>
                          <td className="border border-slate-300 px-0.5 py-0.5 text-left">{fa(totalListedAmount)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>

                {/* ── ⑤ جدولِ تختِ خلاصهٔ ترم‌به‌ترم ── */}
                <div className="tr-fin-block break-inside-avoid mt-3">
                  <h3 className="tr-fin-block-title border-b-2 border-slate-900 pb-0.5 text-[8.5pt] font-black">
                    خلاصهٔ مالیِ ترم‌به‌ترم — به ریال
                  </h3>
                  <table className="tr-fin-table w-full border-collapse text-[7pt]">
                    <colgroup>
                      <col style={{ width: '13%' }} />
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '9%' }} />
                      <col style={{ width: '9%' }} />
                      <col style={{ width: '9%' }} />
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '8%' }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-100 text-slate-800">
                        <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">نیمسال</th>
                        <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">وضع نیمسال</th>
                        <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">شهریه (بدهی)</th>
                        <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">ثابت</th>
                        <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">متغیر</th>
                        <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">تخفیف</th>
                        <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">پوشش</th>
                        <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">خالص</th>
                        <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">پرداخت</th>
                        <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">چک</th>
                        <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">وام</th>
                        <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">ماندهٔ ترم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {terms.map(t => {
                        const prior = priorByTermId.get(t.termId) ?? 0;
                        const b = balanceBadge(t.balance);
                        return (
                          <tr key={t.termId} className="border-b border-slate-200">
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-bold">{termShort(t)}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center text-[6.8pt]">{t.statusTitle || '—'}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono">{fa(t.charges)}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono">{t.tuitionFixed ? fa(t.tuitionFixed) : '—'}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono">{t.tuitionVariable ? fa(t.tuitionVariable) : '—'}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono">{fa(t.discounts)}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono">{fa(t.sponsorships)}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono font-bold">{fa(t.netPayable)}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono">{fa(t.payments)}</td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono">
                              {fa(t.chequesCleared)}
                              {t.chequesPending > 0 ? <span className="block text-[6pt] font-normal text-amber-700">در انتظار: {fa(t.chequesPending)}</span> : null}
                              {t.chequesBounced > 0 ? <span className="block text-[6pt] font-normal text-rose-700">برگشتی: {fa(t.chequesBounced)}</span> : null}
                            </td>
                            <td className="border border-slate-200 px-0.5 py-0.5 text-center font-mono">{fa(t.loans)}</td>
                            <td className={`border border-slate-200 px-0.5 py-0.5 text-center font-mono font-black ${t.balance > 0 ? 'text-rose-700' : t.balance < 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                              {fa(Math.abs(t.balance))}
                              {prior !== 0 ? (
                                <span className="block text-[6pt] font-normal text-slate-400">قبلی: {fa(Math.abs(prior))}</span>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-900 bg-slate-50 font-black">
                        <td colSpan={2} className="border border-slate-300 px-1 py-0.5 text-center">جمع کل دوره</td>
                        <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono">{fa(totals.charges)}</td>
                        <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono">{fa(sumFixed)}</td>
                        <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono">{fa(sumVariable)}</td>
                        <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono">{fa(totals.discounts)}</td>
                        <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono">{fa(totals.sponsorships)}</td>
                        <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono">{fa(totalNet)}</td>
                        <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono">{fa(totals.payments)}</td>
                        <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono">{fa(totals.chequesCleared)}</td>
                        <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono">{fa(totals.loans)}</td>
                        <td className={`border border-slate-300 px-0.5 py-0.5 text-center font-mono ${totals.balance > 0 ? 'text-rose-700' : totals.balance < 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                          {fa(Math.abs(totals.balance))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* ── ⑥ دفترِ رویدادهای مالی ── */}
                {showEvents && allEvents.length > 0 && (
                  <div className="tr-fin-block break-inside-avoid mt-3">
                    <h3 className="tr-fin-block-title border-b-2 border-slate-900 pb-0.5 text-[8.5pt] font-black">
                      دفترِ رویدادهای مالی — به ریال
                    </h3>
                    <table className="tr-fin-table w-full border-collapse text-[7.5pt]">
                      <colgroup>
                        <col style={{ width: '4%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '50%' }} />
                        <col style={{ width: '12%' }} />
                      </colgroup>
                      <thead>
                        <tr className="bg-slate-100 text-slate-800">
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">ردیف</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">تاریخ</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">نیمسال</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">نوع</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 font-bold">شرح</th>
                          <th className="border border-slate-400 px-0.5 py-0.5 text-center font-bold">مبلغ (ریال)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allEvents.map((row, i) => {
                          const e = row.e;
                          return (
                            <tr key={i} className="border-b border-slate-200 align-top">
                              <td className="border border-slate-200 px-0.5 py-0.5 text-center text-slate-500">{fa(i + 1)}</td>
                              <td className="border border-slate-200 px-0.5 py-0.5 text-center" dir="ltr">
                                {e.dateMs ? jdate(new Date(e.dateMs)) : '—'}
                                {e.datedByDeposit ? <span className="block text-[6pt] text-slate-400">تاریخ واریز</span> : null}
                              </td>
                              <td className="border border-slate-200 px-0.5 py-0.5 text-center">{termShort(row.term)}</td>
                              <td className="border border-slate-200 px-0.5 py-0.5 text-center font-bold">
                                {EVENT_LABEL[e.kind] || e.kind}
                                {e.depositType ? (
                                  <span className="mt-0.5 block text-[6pt] font-normal text-slate-500">{e.depositType}</span>
                                ) : null}
                              </td>
                              <td className="border border-slate-200 px-0.5 py-0.5">
                                <span className="break-words">{e.label}</span>
                                {/* ── مستندسازت پرداخت (مهاجرت ۰۱۲۱) ──
                                    همهٔ اقلام در **یک خطِ فشرده** با جداکنندهٔ نقطه
                                    می‌آیند (درخواست کاربر: هر قلم یک سطر نشود و
                                    متن «پخش‌وپلا» دیده نشود). فقط وقتی عرضِ کارت
                                    کم بیاید، خودِ مرورگر به سطر بعد می‌شکند.
                                    در نمای کارشناس مالی/ادمین شماره حساب و کارت
                                    کامل است؛ در نمای دانشجو حساب ماسک و کارت حذف. */}
                                {/* گیتِ نمایشِ مستندسازت عمداً به `kind` وابسته نیست:
                                    واریزِ بنیاد و وام هم رویدادِ SPONSOR/LOAN
                                    می‌شوند ولی فیش و سند و پرداخت‌کننده دارند و
                                    باید دیده شوند. هر رویدادی که این اقلام را
                                    داشته باشد، نمایش داده می‌شود. */}
                                {(e.receiptNo || e.payerName || e.accountNo || e.cardNo || e.voucherNo || e.payTypeCode != null || e.recorderName || e.legacyRem) && (
                                  <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0 text-[6.5pt] leading-tight text-slate-500">
                                    {e.receiptNo && <Meta k="فیش" v={faDigits(e.receiptNo)} mono />}
                                    {e.payerName && (
                                      <Meta
                                        k="پرداخت‌کننده"
                                        v={e.payerName + (isFinance && e.payerNationalCode ? ` (${faDigits(maskNC(e.payerNationalCode, isFinance))})` : '')}
                                      />
                                    )}
                                    {e.accountNo && <Meta k="حساب" v={faDigits(isFinance ? e.accountNo : last4(e.accountNo))} mono />}
                                    {isFinance && e.cardNo && <Meta k="کارت" v={faDigits(e.cardNo)} mono />}
                                    {e.payTypeCode != null && <Meta k="نوع" v={String(PAY_TYPE_LABELS[e.payTypeCode] ?? e.payTypeCode)} />}
                                    {e.voucherNo && <Meta k="سند" v={faDigits(e.voucherNo)} mono />}
                                    {isFinance && e.recorderName && <Meta k="ثبت" v={e.recorderName} />}
                                    {isFinance && e.legacyRem && (
                                      <span className="block w-full truncate text-[6pt] text-slate-400" title={e.legacyRem}>
                                        یادداشت اصل: {e.legacyRem}
                                      </span>
                                    )}
                                  </span>
                                )}
                              </td>
                              <td className={`border border-slate-200 px-0.5 py-0.5 text-center font-mono font-bold ${e.sign === 1 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                {e.sign === 1 ? '+' : '−'}{fa(e.amount)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {terms.length === 0 ? (
                  <p className="mt-3 border border-slate-300 bg-slate-50 py-4 text-center text-slate-500">
                    هیچ تراکنش مالی برای این دانشجو ثبت نشده است.
                  </p>
                ) : null}
              </div>
            </td>
          </tr>

          {/* ── ردیفِ پایانی: چک‌ها، وام‌ها و بلوک رسمیت ──
              جدا از ردیفِ ترم‌ها تا اگر جای کافی نبود، یک‌جا به صفحهٔ بعد برود
              و بین دو نیمه نشکند. */}
          {(cheques.length > 0 || loans.length > 0 || !!verifyBlock) && (
            <tr className="tr-doc-row">
              <td className="tr-doc-cell">
                <div className="space-y-3 px-4 pb-4">

                  {/* ── چک‌ها ── */}
                  {cheques.length > 0 && (
                    <div className="tr-fin-block break-inside-avoid">
                      <h3 className="tr-fin-block-title border-b-2 border-slate-900 pb-0.5 text-[8.5pt] font-black">چک‌های دانشجو</h3>
                      <table className="tr-fin-table w-full border-collapse text-center text-[7.5pt]">
                        <thead>
                          <tr className="bg-slate-100 text-slate-800">
                            <th className="border border-slate-400 px-1 py-0.5 font-bold">شمارهٔ چک</th>
                            <th className="border border-slate-400 px-1 py-0.5 font-bold">بانک</th>
                            <th className="border border-slate-400 px-1 py-0.5 font-bold">مبلغ (ریال)</th>
                            <th className="border border-slate-400 px-1 py-0.5 font-bold">سررسید</th>
                            <th className="border border-slate-400 px-1 py-0.5 font-bold">وضعیت</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cheques.map((c) => (
                            <tr key={c.id}>
                              <td className="border border-slate-200 px-1 py-0.5 font-mono" dir="ltr">{faDigits(c.chequeNo || '—')}</td>
                              <td className="border border-slate-200 px-1 py-0.5">{c.bankName || '—'}</td>
                              <td className="border border-slate-200 px-1 py-0.5 font-bold font-mono">{fa(toNum(c.amount))}</td>
                              <td className="border border-slate-200 px-1 py-0.5" dir="ltr">{jdate(c.dueDate)}</td>
                              <td className="border border-slate-200 px-1 py-0.5">
                                {c.status === 'CLEARED' ? 'وصول‌شده' : c.status === 'BOUNCED' ? 'برگشتی' : c.status === 'CANCELLED' ? 'باطل‌شده' : 'در انتظار وصول'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* ── وام‌ها ── */}
                  {loans.length > 0 && (
                    <div className="tr-fin-block break-inside-avoid">
                      <h3 className="tr-fin-block-title border-b-2 border-slate-900 pb-0.5 text-[8.5pt] font-black">وام‌های دانشجو</h3>
                      <table className="tr-fin-table w-full border-collapse text-center text-[7.5pt]">
                        <thead>
                          <tr className="bg-slate-100 text-slate-800">
                            <th className="border border-slate-400 px-1 py-0.5 font-bold">نوع وام</th>
                            <th className="border border-slate-400 px-1 py-0.5 font-bold">پرداخت‌کننده</th>
                            <th className="border border-slate-400 px-1 py-0.5 font-bold">مبلغ (ریال)</th>
                            <th className="border border-slate-400 px-1 py-0.5 font-bold">اقساط</th>
                            <th className="border border-slate-400 px-1 py-0.5 font-bold">وضعیت</th>
                          </tr>
                        </thead>
                        <tbody>
                          {loans.map((l) => (
                            <tr key={l.id}>
                              <td className="border border-slate-200 px-1 py-0.5">{l.productTitle || '—'}</td>
                              <td className="border border-slate-200 px-1 py-0.5">{l.lender || '—'}</td>
                              <td className="border border-slate-200 px-1 py-0.5 font-bold font-mono">{fa(toNum(l.amount))}</td>
                              <td className="border border-slate-200 px-1 py-0.5 font-mono">{l.installments != null ? fa(l.installments) : '—'}</td>
                              <td className="border border-slate-200 px-1 py-0.5">
                                {l.status === 'ACTIVE' ? 'فعال' : l.status === 'SETTLED' ? 'تسویه‌شده' : 'لغوشده'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* بلوک رسمیت: QR استعلام برخط — کارشناس/ادمین همیشه؛ دانشجو فقط نسخهٔ تأییدشده. */}
                  {(isFinance || official) && verifyBlock ? <div className="tr-fin-verify">{verifyBlock}</div> : null}

                </div>
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="tr-doc-cell">
              {/* ── پانوشتِ حقوقیِ سند (در پایینِ هر صفحهٔ چاپ تکرار می‌شود) ── */}
              <div className="tr-fin-note border-t-2 border-slate-900 px-4 py-1.5 text-[7pt] leading-relaxed text-slate-700">
                <p>
                  <b>تذکر:</b> این صورت‌حساب به ریال و بر پایهٔ دفتر مالیِ سامانه تنظیم شده و تا
                  تأیید و مهرِ کارشناس امور مالی <b>فاقد اعتبار اداری (غیرقابل استناد)</b> است.
                  ارقامِ «شهریهٔ ثابت» و «شهریهٔ متغیر» از نوعِ تراکنشِ دفتر تفکیک شده‌اند و
                  جمعِ آن‌ها با جمعِ شهریهٔ همان نیمسال برابر است. چک‌های وصول‌نشده در ماندهٔ
                  ترم لحاظ نمی‌شوند.
                </p>
              </div>
              {/* ── امضا و مهر (در پایین هر صفحهٔ چاپ تکرار می‌شود) ── */}
              <div className="tr-signatures grid grid-cols-3 gap-2 px-4 pb-4 pt-3 text-center text-[8pt] text-slate-700">
                <div>
                  <p className="mb-8 font-bold">کارشناس امور مالی</p>
                  <div className="border-t border-slate-400 pt-1">نام و امضا</div>
                </div>
                <div>
                  <p className="mb-8 font-bold">مهر ادارهٔ امور مالی</p>
                  <div className="border-t border-slate-400 pt-1">مهر</div>
                </div>
                <div>
                  <p className="mb-8 font-bold">مدیر امور مالی</p>
                  <div className="border-t border-slate-400 pt-1">نام و امضا</div>
                </div>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
