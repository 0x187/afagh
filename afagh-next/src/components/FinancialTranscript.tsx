import type { ReactNode } from 'react';
import { toJalaliFromDate, faDigits } from '@/lib/calendar';
import { normalizeTermCode } from '@/lib/scheduling-core';
import { PAY_TYPE_LABELS } from '@/lib/finance-rules/statement';
import { courseTypeLabelOf } from '@/lib/mali-types';

/**
 * ══════════════════════════════════════════════════════════════════════
 *  کارنامهٔ مالی رسمی — سند یکپارچهٔ حرفه‌ای به سبک کارنامهٔ تحصیلی
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
 * برچسبِ «نوع درس» برای ستون کارنامه (جایگزینِ «نرخ واحد» — درخواست کاربر):
 * نرخ هر واحد در سما از «نوع درس مالی» می‌آید، نه از واحد؛ پس همان چیزی که
 * واقعاً مبلغ را می‌سازد نمایش داده می‌شود. منطقش در `mali-types` است تا
 * جداگانه تست شود.
 */
const courseTypeLabel = (c: TranscriptCourseView) => courseTypeLabelOf(c);

/**
 * تاریخ شمسی خوانا؛ تهی → خط تیره.
 *
 * ⚠ تاریخ‌هایی که از سما آمده‌اند (مثل `students.entryDate`) **از قبل شمسی**
 * هستند («1400-07-01»)؛ `new Date` آن‌ها را سالِ میلادی ۱۴۰۰ می‌فهمد و تبدیلِ
 * دوباره سالِ سه‌رقمیِ بی‌معنا (۷۷۹) می‌سازد. پس ورودی شمسیِ رشته‌ای
 * دست‌نخورده (فقط با ارقام فارسی) برمی‌گردد.
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
  // ── سربرگِ رسمی (عکس و شناسنامه‌ای) ──
  /** مسیر عکس دانشجو (‎/api/photo/{userId}‎) — خالی = کادر «عکس» */
  photoUrl?: string | null;
  /** شمارهٔ شناسنامه (users.birthCertNo) */
  birthCertNo?: string | null;
  /** تاریخ تولد (users.birthDate) */
  birthDate?: string | Date | null;
  /** شمارهٔ سند/نامهٔ صدور — در ستون چپ سربرگ */
  documentNo?: string | null;
  /** نام دانشگاه مبدأ (دانشجوی انتقالی) */
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
  if (!norm) return <>{t.termTitle}</>;
  if (norm.termType === 'EQUIVALENCE') return <>نیمسال معادل‌سازی</>;
  const year = <span dir="ltr">{faDigits(norm.displayYear)}</span>;
  // ترم تابستان در کارنامه با عنوان «دوره تابستانی» آورده می‌شود (درخواست کاربر).
  if (norm.termType === 'SUMMER') return <>دوره تابستانی {year}</>;
  return <>{`${norm.displaySemester} سال تحصیلی `}{year}</>;
}

const STATUS_FA: Record<string, string> = {  ACTIVE: 'فعال',
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
 * یک قلمِ فرادادهٔ پرداخت — «برچسب: مقدار» در یک تکهٔ جدا‌نشدنی.
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

export default function FinancialTranscript({
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

  // دو ترم در هر ردیف — همان تعداد ستون چاپ عمودی A4 تا هیچ خانه‌ای خالی نماند
  const chunks: TranscriptTermView[][] = [];
  for (let i = 0; i < terms.length; i += 2) chunks.push(terms.slice(i, i + 2));

  // ماندهٔ قبلی (انتقالی) هر ترم = جمعِ ماندهٔ همهٔ ترم‌های پیش از آن (به ترتیب زمانی)
  const priorByTermId = new Map<number, number>();
  {
    let running = 0;
    for (const t of terms) { priorByTermId.set(t.termId, running); running += t.balance; }
  }

  // جمعِ شهریهٔ ثابت/متغیرِ کل دوره — برای تفکیکِ خانهٔ «جمع شهریه» در جدول بالا
  const sumFixed = terms.reduce((a, t) => a + (t.tuitionFixed ?? 0), 0);
  const sumVariable = terms.reduce((a, t) => a + (t.tuitionVariable ?? 0), 0);

  return (
    <div dir="rtl" className="transcript-print-area tr-root tr-fin-root bg-white border-2 border-slate-800 shadow-xl print:shadow-none text-xs text-slate-800">
      {/* ساختار سند به سبک کارنامهٔ تحصیلی: table.tr-doc با thead/tfoot تا سربرگ
          و بلوک امضا در همهٔ صفحات چاپ تکرار شوند و ردیف‌ها بین دو صفحه نشکنند. */}
      <table className="tr-doc rt w-full max-w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <td className="tr-doc-cell">
      {/* ── سربرگ سه‌بخشی رسمی دانشگاه (همان مدل کارنامهٔ تحصیلی: right/center/left) ── */}
      <div className="px-4 pt-4 pb-2 border-b-2 border-slate-800">
        <div className="grid grid-cols-3 items-center text-center">
          {/* ستون راست */}
          <div className="text-right space-y-1">
            <p className="font-bold text-slate-800">جمهوری اسلامی ایران</p>
            <p className="font-semibold text-slate-700">وزارت علوم، تحقیقات و فناوری</p>
            {/* نام دانشگاه فقط از تنظیمات/رکورد دانشگاه می‌آید — هیچ نامی هاردکد نیست */}
            {universityTitle ? <p className="font-extrabold text-slate-900 text-sm">{universityTitle}</p> : null}
            <p className="text-2xs text-slate-500">معاونت اداری و مالی — ادارهٔ امور مالی</p>
          </div>
          {/* ستون وسط (نشان و عنوان سند) */}
          <div className="flex flex-col items-center justify-center">
            {/* آرم از تنظیمات سراسری/دانشگاه می‌آید؛ اگر تعریف نشده باشد کادرِ
                جای‌نگهدار چاپ می‌شود (مثل کارنامهٔ تحصیلی) تا جای ارم خالی نماند */}
            {logoUrl ? (
              <img src={logoUrl} alt="آرم دانشگاه" className="mb-1 h-12 w-12 shrink-0 object-contain" />
            ) : (
              <span className="mb-1 rounded border border-dashed border-slate-300 px-1.5 py-1 text-[9px] text-slate-400">ارم دانشگاه</span>
            )}
            <h2 className="border-b border-slate-800 pb-0.5 px-4 text-base font-black tracking-wide text-slate-950">کارنامهٔ مالی دانشجو</h2>
            <p className="mt-0.5 text-3xs text-slate-600">صورت وضعیت بدهی، تخفیف، پوشش، پرداخت، چک و وام — ترم‌به‌ترم</p>
          </div>
          {/* ستون چپ (اطلاعات سند) */}
          <div className="space-y-1 text-left font-mono text-2xs">
            {student.documentNo ? <p><span className="font-sans text-slate-500">شماره سند: </span><b>{student.documentNo}</b></p> : null}
            <p><span className="font-sans text-slate-500">شماره پرونده: </span><b>{faDigits(student.studentCode || '—')}</b></p>
            {issuedAt ? <p><span className="font-sans text-slate-500">تاریخ صدور: </span><b>{issuedAt}</b></p> : null}
            {/* شمارهٔ صفحهٔ واقعی را پاصفحهٔ چاپ (@page) می‌زند؛ این خط ثابت در چاپ حذف می‌شود */}
            <p className="tr-print-hide"><span className="font-sans text-slate-500">صفحه: </span><b>۱ از ۱</b></p>
            <p><span className="font-sans text-slate-500">وضعیت: </span><b>{(student.status && STATUS_FA[student.status]) || student.status || '—'}</b></p>
          </div>
        </div>
      </div>
      {/* نوار وضعیت سند — فقط در نمای دانشجو (سندِ کارشناس/ادمین سندِ کاری رسمی است).
          • تأییدنشده: «غیرقابل استناد / در انتظار تأیید»
          • تأییدشده (درخواست FINANCE_STATEMENT در وضعیت APPROVED): نوار سبز رسمیت.
          متن + کادر ضخیم (نه فقط پس‌زمینه) تا در چاپ سیاه‌وسفید هم خوانده شود. */}
      {!isFinance && !official && (
        <div className="tr-unverified-band mx-4 mb-2 mt-1.5 flex flex-wrap items-center justify-between gap-2 border-2 border-amber-700 bg-amber-50 px-2 py-1 text-3xs font-black text-amber-950">
          <span>⚠️ این کارنامه تا تأیید و مهر کارشناس امور مالی <u>غیرقابل استناد</u> است.</span>
          <span className="shrink-0 font-mono text-[9px] text-amber-900">وضعیت: در انتظار تأیید</span>
        </div>
      )}
      {!isFinance && official && (
        <div className="tr-official-band mx-4 mb-2 mt-1.5 flex flex-wrap items-center justify-between gap-2 border-2 border-emerald-700 bg-emerald-50 px-2 py-1 text-3xs font-black text-emerald-950">
          <span>✅ این کارنامه با تأیید کارشناس امور مالی، دارای <u>رمز استعلام اصالت (QR)</u> است.</span>
          <span className="shrink-0 font-mono text-[9px] text-emerald-900">وضعیت: تأییدشده</span>
        </div>
      )}
            </td>
          </tr>
        </thead>
        <tbody>
          <tr className="tr-doc-row">
            <td className="tr-doc-cell">
      <div className="space-y-3 p-4">
        {/* ── مشخصات فشرده (۳ جفت در هر سطر) + عکس در سمت چپ (درخواست کاربر) ── */}
        <div className="flex items-stretch gap-1.5">
          <table className="tr-fin-info w-full border-collapse border border-slate-700 text-3xs rt">
          <tbody>
            <tr>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">نام و نام خانوادگی</td>
              <td className="border border-slate-300 px-1.5 py-1 font-medium">{student.fullName || '—'}</td>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">کد ملی</td>
              <td className="border border-slate-300 px-1.5 py-1">{faDigits(student.nationalCode || '—')}</td>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">شمارهٔ دانشجویی</td>
              <td className="border border-slate-300 px-1.5 py-1 font-mono" dir="ltr">{faDigits(student.studentCode || '—')}</td>
            </tr>
            <tr>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">مقطع</td>
              <td className="border border-slate-300 px-1.5 py-1">{student.degreeTitle || '—'}</td>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">رشته</td>
              <td className="border border-slate-300 px-1.5 py-1">{student.majorTitle || '—'}</td>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">نیمسال ورود</td>
              <td className="border border-slate-300 px-1.5 py-1">
                {student.entryTerm
                  ? `${TERM_FA[student.entryTerm] ?? `نیمسال ${fa(student.entryTerm)}`}${student.entryYear ? ' ' + fa(student.entryYear) : ''}`
                  : (student.entryYear ? fa(student.entryYear) : '—')}
              </td>
            </tr>
            <tr>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">دانشکده</td>
              <td className="border border-slate-300 px-1.5 py-1">{student.facultyTitle || '—'}</td>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">سهمیه</td>
              <td className="border border-slate-300 px-1.5 py-1">{quotaLabel(student.quotaType)}</td>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">نوع دوره</td>
              <td className="border border-slate-300 px-1.5 py-1">{student.courseType || '—'}</td>
            </tr>
            <tr>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">تاریخ ورود</td>
              <td className="border border-slate-300 px-1.5 py-1">{jdate(student.entryDate)}</td>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">روش پذیرش</td>
              <td className="border border-slate-300 px-1.5 py-1">{student.admissionMethod || '—'}</td>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">تاریخ تسویه</td>
              <td className="border border-slate-300 px-1.5 py-1">{jdate(student.settlementDate)}</td>
            </tr>
            <tr>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">تاریخ تولد</td>
              <td className="border border-slate-300 px-1.5 py-1">{jdate(student.birthDate)}</td>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">شمارهٔ شناسنامه</td>
              <td className="border border-slate-300 px-1.5 py-1">{faDigits(student.birthCertNo || '—')}</td>
              <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">وضعیت مالی</td>
              <td className="border border-slate-300 px-1.5 py-1">
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${grand.cls}`}>{grand.text}</span>
              </td>
            </tr>
            {student.originUniversityTitle ? (
              <tr>
                <td className="border border-slate-300 bg-slate-100 px-1.5 py-1 font-bold text-slate-700">دانشگاه مبدأ</td>
                <td colSpan={5} className="border border-slate-300 px-1.5 py-1">{student.originUniversityTitle}</td>
              </tr>
            ) : null}
          </tbody>
          </table>
          {/* عکس — چسبیده به سمت چپ جدول مشخصات */}
          <div className="flex w-[17mm] shrink-0 items-start justify-center border border-slate-400">
            {student.photoUrl ? (
              <img src={student.photoUrl} alt="عکس دانشجو" className="h-[22mm] w-[17mm] object-cover" />
            ) : (
              <div className="flex h-[22mm] w-[17mm] items-center justify-center text-[9px] text-slate-400">عکس</div>
            )}
          </div>
        </div>

        {leadBlock}

        {/* ── جمع کل دوره ── */}
        <div className="tr-breakdown break-inside-avoid rounded-lg border border-slate-700">
          <h3 className="border-b border-slate-700 bg-indigo-900 px-3 py-1.5 text-[12px] font-black text-white">
            {scopeLabel || 'جمع کل دوره'}
          </h3>
          <table className="tr-fin-totals w-full border-collapse text-center text-2xs rt">
            <thead>
              <tr className="bg-slate-100 text-slate-700">
                <th className="border border-slate-300 px-1 py-1.5">جمع شهریه (ریال)</th>
                <th className="border border-slate-300 px-1 py-1.5">تخفیف‌ها</th>
                <th className="border border-slate-300 px-1 py-1.5">پوشش بنیاد / خیرین</th>
                <th className="border border-slate-300 px-1 py-1.5">پرداخت / چک وصولی / وام</th>
                <th className="border border-slate-300 px-1 py-1.5">ماندهٔ نهایی</th>
              </tr>
            </thead>
            <tbody>
              <tr className="font-bold">
                <td className="border border-slate-300 px-1 py-1.5">
                  {fa(totals.charges)}
                  {/* تفکیکِ شهریه در همان خانه — کارشناس مالی بدون بازکردن ترم‌ها
                      می‌بیند چه سهمی ثابت و چه سهمی متغیر است. */}
                  {(sumFixed > 0 || sumVariable > 0) && (
                    <span className="mt-0.5 block text-[9px] font-medium text-slate-500">
                      ثابت {fa(sumFixed)} · متغیر {fa(sumVariable)}
                    </span>
                  )}
                </td>
                <td className="border border-slate-300 px-1 py-1.5 text-violet-700">{fa(totals.discounts)}</td>
                <td className="border border-slate-300 px-1 py-1.5 text-indigo-700">
                  {fa(totals.sponsorships)}
                  {/* تفکیک: چه بخشی از پوشش از واریزِ واقعیِ بنیاد آمده است.
                      بدون این خط، کارشناس مالی نمی‌فهمد پوشش «سندِ واریز» دارد
                      یا فقط تخفیفِ دفتری است. */}
                  {(totals.sponsorshipsFromDeposits ?? 0) > 0 && (
                    <span className="mt-0.5 block text-[9px] font-medium text-slate-500">
                      از واریز بنیاد {fa(totals.sponsorshipsFromDeposits ?? 0)}
                    </span>
                  )}
                  {(totals.charityCoverage ?? 0) > 0 && (
                    <span className="mt-0.5 block text-[9px] font-medium text-teal-700">
                      از خیرین {fa(totals.charityCoverage ?? 0)}
                    </span>
                  )}
                </td>
                <td className="border border-slate-300 px-1 py-1.5 text-emerald-700">{fa(paidTotal)}</td>
                <td className={`border border-slate-300 px-1 py-1.5 text-[13px] font-black ${totals.balance > 0 ? 'text-rose-700' : totals.balance < 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                  {fa(Math.abs(totals.balance))}
                </td>
              </tr>
              <tr>
                <td colSpan={5} className="border border-slate-300 bg-slate-50 px-2 py-1.5 text-2xs font-bold text-slate-700">
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

        {/* ── عنوان بخش ترم‌ها (همراه با جدول مشخصات/جمع در همان ردیف) ── */}
        <h3 className="tr-courses-title border-b-2 border-slate-800 pb-1 text-[12px] font-black text-slate-900">ریز ترم‌به‌ترم</h3>
        {terms.length === 0 ? (
          <p className="rounded-lg border border-slate-300 bg-slate-50 py-6 text-center text-slate-500">هیچ تراکنش مالی برای این دانشجو ثبت نشده است.</p>
        ) : null}
      </div>
            </td>
          </tr>

          {/* ── هر ردیفِ ترم‌ها یک <tr> مستقل است ──
              چرا؟ پیش‌تر **کل** سند در یک `<tr>` جا می‌گرفت. Chrome ردیفِ
              بسیار بلندِ جدول را بین صفحه‌ها نمی‌شکند؛ نتیجه این بود که محتوای
              بعد از صفحهٔ اول بریده می‌شد یا از کادر بیرون می‌زد — همان
              «چاپِ به‌هم‌ریخته»ای که کاربر گزارش کرد. با یک <tr> برای هر جفت
              ترم، شکستنِ صفحه بینِ ردیف‌ها انجام می‌شود و هیچ کارتی نصف نمی‌شود. */}
          {chunks.map((group, gi) => (
            <tr key={`terms-${gi}`} className="tr-doc-row">
              <td className="tr-doc-cell">
                <div className="px-4 pb-2">
                <div className="tr-fin-row break-inside-avoid grid gap-2 sm:grid-cols-2">
                  {group.map((t) => {
                    const b = balanceBadge(t.balance);
                    return (
                      <div key={t.termId} className="term-block break-inside-avoid overflow-hidden rounded-lg border border-slate-700">
                        <div className="flex items-center justify-between gap-1 border-b border-slate-700 bg-slate-100 px-2 py-1.5">
                          <div className="min-w-0">
                            <h4 className="text-2xs font-black text-slate-900"><TermTitle t={t} /></h4>
                            {t.statusTitle ? (
                              <p className="mt-px text-[9px] font-medium text-slate-600">
                                وضعیت: <span className="font-bold text-slate-800">{t.statusTitle}</span>
                              </p>
                            ) : null}
                          </div>
                          <span className={`shrink-0 rounded-full border px-1.5 py-px text-[9px] font-black ${b.cls}`}>{b.text}</span>
                        </div>
                        {t.courses && t.courses.length > 0 && (
                          <div className="border-t border-slate-200">
                            <p className="bg-slate-50 px-2 py-1 text-[9px] font-black text-slate-700">ریز شهریه متغیر دروس</p>
                            <table className="tr-term-table tr-fin-courses w-full border-collapse text-[9px] rt" style={{ tableLayout: 'fixed' }}>
                              <colgroup>
                                <col style={{ width: '6%' }} />
                                <col style={{ width: '14%' }} />
                                <col style={{ width: '27%' }} />
                                <col style={{ width: '6%' }} />
                                <col style={{ width: '9%' }} />
                                <col style={{ width: '16%' }} />
                                <col style={{ width: '22%' }} />
                              </colgroup>
                              <thead>
                                <tr className="bg-slate-50 text-slate-600">
                                  <th className="border-t border-slate-200 px-1 py-0.5 text-center font-bold">ردیف</th>
                                  <th className="border-t border-slate-200 px-1 py-0.5 text-center font-bold">کد درس</th>
                                  <th className="border-t border-slate-200 px-1 py-0.5 font-bold">نام درس</th>
                                  <th className="border-t border-slate-200 px-1 py-0.5 text-center font-bold">واحد</th>
                                  <th className="border-t border-slate-200 px-1 py-0.5 text-center font-bold">نمره</th>
                                  <th className="border-t border-slate-200 px-1 py-0.5 text-center font-bold">نوع درس</th>
                                  <th className="border-t border-slate-200 px-1 py-0.5 text-center font-bold">مبلغ متغیر</th>
                                </tr>
                              </thead>
                              <tbody>
                                {t.courses.map((c, i) => (
                                  <tr key={i} className="border-t border-slate-100">
                                    <td className="px-1 py-0.5 text-center text-slate-500">{fa(i + 1)}</td>
                                    <td className="px-1 py-0.5 text-center font-mono" dir="ltr">{c.courseCode || '—'}</td>
                                    <td className="tr-course-title px-1 py-0.5 font-medium">{c.courseTitle || '—'}</td>
                                    <td className="px-1 py-0.5 text-center font-mono">{fa(c.units)}</td>
                                    <td className="px-1 py-0.5 text-center font-mono">{c.grade != null ? fa(c.grade) : '—'}</td>
                                    <td className="px-1 py-0.5 text-center">
                                      {courseTypeLabel(c)}
                                      {c.maliType != null ? <span className="tr-print-hide font-mono text-[7px] text-slate-400"> {fa(c.maliType)}</span> : null}
                                    </td>
                                    <td className="px-1 py-0.5 text-left font-bold">{fa(c.amount)}</td>
                                  </tr>
                                ))}
                                <tr className="border-t border-slate-200 bg-slate-50/60">
                                  <td colSpan={6} className="px-1 py-0.5 font-black">جمع متغیر دروس</td>
                                  <td className="px-1 py-0.5 text-left font-black">{fa(t.courses.reduce((a, c) => a + (Number(c.amount) || 0), 0))}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                        {showEvents && t.events.length > 0 && (
                          <ul className="space-y-0.5 border-t border-slate-200 bg-slate-50/60 px-2 py-1.5">
                            {t.events.map((e, i) => (
                              <li key={i} className="flex items-start justify-between gap-1 text-[9px]">
                                <span className="min-w-0 flex-1 text-slate-600">
                                  <span className="font-bold text-slate-700">{EVENT_LABEL[e.kind] || e.kind}:</span>{' '}
                                  <span className="break-words">{e.label}</span>
                                  {/* نوع واریز — ستون مستقل، نه تکرارِ داخل پرانتزِ شرح */}
                                  {e.depositType ? (
                                    <span className="mx-1 inline-block whitespace-nowrap rounded border border-sky-300 bg-sky-50 px-1 py-px align-middle text-[8px] font-bold text-sky-800">
                                      {e.depositType}
                                    </span>
                                  ) : null}
                                  {e.dateMs ? (
                                    <span className="text-slate-500">
                                      {' — '}
                                      <span dir="ltr">{jdate(new Date(e.dateMs))}</span>
                                      {e.datedByDeposit ? ' (تاریخ واریز)' : ''}
                                    </span>
                                  ) : null}
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
                                    <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0 text-[8px] leading-tight text-slate-500">
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
                                        <span
                                          className="block w-full truncate text-[7px] text-slate-400"
                                          title={e.legacyRem}
                                        >
                                          یادداشت اصل: {e.legacyRem}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </span>
                                <span className={`shrink-0 font-bold ${e.sign === 1 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                  {e.sign === 1 ? '+' : '−'}{fa(e.amount)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {/* خلاصهٔ ترم — پایین کارت (نه بالا)، سه قلم در هر سطر تا فشرده شود */}
                        <div className="border-t border-slate-300 bg-slate-100/70">
                          <TermSummary t={t} priorBalance={priorByTermId.get(t.termId) ?? 0} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                </div>
              </td>
            </tr>
          ))}

          {/* ── ردیف پایانی: چک‌ها، وام‌ها و بلوک رسمیت ──
              جدا از ردیف ترم‌ها تا اگر جای کافی نبود، یک‌جا به صفحهٔ بعد برود
              و بین دو نیمه نشکند. */}
          {(cheques.length > 0 || loans.length > 0 || !!verifyBlock) && (
            <tr className="tr-doc-row">
              <td className="tr-doc-cell">
                <div className="space-y-3 px-4 pb-4">

        {/* ── چک‌ها ── */}
        {cheques.length > 0 && (
          <div className="tr-breakdown break-inside-avoid">
            <h3 className="mb-1 border-b-2 border-slate-800 pb-1 text-[12px] font-black text-slate-900">چک‌های دانشجو</h3>
            <table className="tr-fin-list w-full border-collapse border border-slate-700 text-center text-3xs rt">
              <thead>
                <tr className="bg-slate-100 text-slate-700">
                  <th className="border border-slate-300 px-1 py-1">شمارهٔ چک</th>
                  <th className="border border-slate-300 px-1 py-1">بانک</th>
                  <th className="border border-slate-300 px-1 py-1">مبلغ (ریال)</th>
                  <th className="border border-slate-300 px-1 py-1">سررسید</th>
                  <th className="border border-slate-300 px-1 py-1">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {cheques.map((c) => (
                  <tr key={c.id}>
                    <td className="border border-slate-300 px-1 py-1">{faDigits(c.chequeNo || '—')}</td>
                    <td className="border border-slate-300 px-1 py-1">{c.bankName || '—'}</td>
                    <td className="border border-slate-300 px-1 py-1 font-bold">{fa(toNum(c.amount))}</td>
                    <td className="border border-slate-300 px-1 py-1">{jdate(c.dueDate)}</td>
                    <td className="border border-slate-300 px-1 py-1">
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
          <div className="tr-breakdown break-inside-avoid">
            <h3 className="mb-1 border-b-2 border-slate-800 pb-1 text-[12px] font-black text-slate-900">وام‌های دانشجو</h3>
            <table className="tr-fin-list w-full border-collapse border border-slate-700 text-center text-3xs rt">
              <thead>
                <tr className="bg-slate-100 text-slate-700">
                  <th className="border border-slate-300 px-1 py-1">نوع وام</th>
                  <th className="border border-slate-300 px-1 py-1">پرداخت‌کننده</th>
                  <th className="border border-slate-300 px-1 py-1">مبلغ (ریال)</th>
                  <th className="border border-slate-300 px-1 py-1">اقساط</th>
                  <th className="border border-slate-300 px-1 py-1">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l) => (
                  <tr key={l.id}>
                    <td className="border border-slate-300 px-1 py-1">{l.productTitle || '—'}</td>
                    <td className="border border-slate-300 px-1 py-1">{l.lender || '—'}</td>
                    <td className="border border-slate-300 px-1 py-1 font-bold">{fa(toNum(l.amount))}</td>
                    <td className="border border-slate-300 px-1 py-1">{l.installments != null ? fa(l.installments) : '—'}</td>
                    <td className="border border-slate-300 px-1 py-1">
                      {l.status === 'ACTIVE' ? 'فعال' : l.status === 'SETTLED' ? 'تسویه‌شده' : 'لغوشده'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* بلوک رسمیت: QR استعلام برخط + نشانی — برای کارشناس/ادمین همیشه و برای
            دانشجو فقط در نسخهٔ تأییدشده (official). */}
        {(isFinance || official) && verifyBlock ? <div className="tr-fin-verify">{verifyBlock}</div> : null}

                </div>
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="tr-doc-cell tr-signatures">
              {/* ── امضا و مهر (در پایین هر صفحهٔ چاپ تکرار می‌شود) ── */}
              <div className="grid grid-cols-3 gap-2 px-4 pb-4 pt-3 text-center text-3xs text-slate-600">
                <div>
                  <p className="mb-8 font-medium">کارشناس امور مالی</p>
                  <div className="border-t border-slate-400 pt-1">نام و امضا</div>
                </div>
                <div>
                  <p className="mb-8 font-medium">مهر ادارهٔ مالی</p>
                  <div className="border-t border-slate-400 pt-1">مهر</div>
                </div>
                <div>
                  <p className="mb-8 font-medium">مدیر مالی</p>
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

/**
 * خلاصهٔ ترم — سه قلم در هر سطر (به‌جای جدول ۸ تا ۱۰ ردیفی عمودی).
 * سه ردیف سه‌ستونه + یک ردیف «ماندهٔ ترم» در پایین؛ حدود ۵ ردیف کاغذ کمتر برای هر ترم.
 */
function TermSummary({ t, priorBalance = 0 }: { t: TranscriptTermView; priorBalance?: number }) {
  type Cell = { label: string; value: string; cls?: string; bold?: boolean };
  /**
   * پوششِ خیرین از «پوشش بنیاد» جدا چاپ می‌شود (درخواست کاربر: صندوق خیریه
   * بنیاد نیست و نباید زیر همان عنوان بیاید). جمعِ این دو همان
   * `t.sponsorships` است، پس خواننده می‌تواند هر دو را با هم ببیند.
   */
  const charity = t.charityCoverage ?? 0;
  const sponsorOnly = Math.max(0, t.sponsorships - charity);
  const items: Cell[] = [
    { label: 'شهریه (بدهی)', value: fa(t.charges) },
    /**
     * تفکیکِ شهریه — همان دو قلمی که سما زیر هر ترم می‌نویسد.
     * پیش‌تر فقط جمعِ «شهریه (بدهی)» دیده می‌شد و کارشناس مالی نمی‌توانست
     * بفهمد چه سهمی ثابت و چه سهمی متغیر (واحد×نرخ) است.
     */
    ...(t.tuitionFixed ? [{ label: 'شهریهٔ ثابت', value: fa(t.tuitionFixed) }] : []),
    ...(t.tuitionVariable ? [{ label: 'شهریهٔ متغیر', value: fa(t.tuitionVariable) }] : []),
    { label: 'تخفیف', value: fa(t.discounts), cls: 'text-violet-700' },
    { label: 'پوشش بنیاد', value: fa(sponsorOnly), cls: 'text-indigo-700' },
    ...(charity ? [{ label: 'پوشش خیرین', value: fa(charity), cls: 'text-teal-700' }] : []),
    { label: 'خالص', value: fa(t.netPayable), bold: true },
    { label: 'پرداخت', value: fa(t.payments), cls: 'text-emerald-700' },
    { label: 'چک وصول‌شده', value: fa(t.chequesCleared), cls: 'text-emerald-700' },
  ];
  if (t.chequesPending > 0) items.push({ label: 'چک در انتظار', value: fa(t.chequesPending), cls: 'text-amber-700' });
  if (t.chequesBounced > 0) items.push({ label: 'چک برگشتی', value: fa(t.chequesBounced), cls: 'text-rose-700' });
  items.push({ label: 'وام', value: fa(t.loans), cls: 'text-sky-700' });
  // پرکردن ردیف آخر تا شبکهٔ سه‌ستونه به‌هم نریزد
  while (items.length % 3 !== 0) items.push({ label: '', value: '' });
  const rows: Cell[][] = [];
  for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3));

  return (
    <table className="tr-fin-sum w-full border-collapse text-[9px] rt" style={{ tableLayout: 'fixed' }}>
      <colgroup>
        {[0, 1, 2].map((i) => (
          <col key={i} style={{ width: '33.33%' }} />
        ))}
      </colgroup>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-t border-slate-200">
            {r.map((c, ci) => (
              <td key={ci} className="tr-sum-cell px-1 py-0.5 align-top">
                {/* برچسب و مبلغ در یک سلول تا هیچ‌کدام بریده نشود */}
                <div className="flex items-baseline justify-between gap-1">
                  <span className={`text-slate-600 ${c.bold ? 'font-bold text-slate-800' : ''}`}>{c.label}</span>
                  <span className={`shrink-0 ${c.bold ? 'font-black text-slate-900' : 'font-bold'} ${c.cls || ''}`}>{c.value}</span>
                </div>
              </td>
            ))}
          </tr>
        ))}
        {priorBalance !== 0 && (
          <tr className="border-t border-slate-200 bg-slate-100/60">
            <td colSpan={2} className="px-1 py-0.5 font-bold text-slate-600">ماندهٔ قبلی (انتقالی)</td>
            <td className="px-1 py-0.5 text-left font-bold text-slate-700">
              {fa(Math.abs(priorBalance))}{priorBalance > 0 ? ' بدهکار' : ' بستانکار'}
            </td>
          </tr>
        )}
        <tr className="border-t border-slate-400 bg-slate-200/60">
          <td colSpan={2} className="px-1 py-0.5 font-black text-slate-800">ماندهٔ ترم</td>
          <td className={`px-1 py-0.5 text-left font-black ${t.balance > 0 ? 'text-rose-700' : t.balance < 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
            {fa(Math.abs(t.balance))}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
