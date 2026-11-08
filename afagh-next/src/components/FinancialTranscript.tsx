import type { ReactNode } from 'react';
import { toJalaliFromDate, faDigits } from '@/lib/calendar';
import { PAY_TYPE_LABELS } from '@/lib/finance-rules/statement';
import { courseTypeLabelOf } from '@/lib/mali-types';
import { COURSE_TYPE_FA, QUOTA_FA, SAMA_STATUS_TITLE, STUDENT_STATUS_FA } from '@/lib/student-labels';

/**
 * ══════════════════════════════════════════════════════════════════════
 *  کارنامهٔ مالی رسمی — «نوع الف»
 *
 *  بازسازی چیدمان کارنامهٔ مالی سیستم قدیمی (سما):
 *   • سربرگ با جفت‌های «کد=عنوان» (مقطع، نوع دوره، وضعیت، سهمیه)
 *   • ریز دروس هر نیمسال با تمام ستون‌ها (واحد نظری/عملی، نوع درس، …)
 *   • جدول مالی هر نیمسال با ردیف‌های اخذ / شهریهٔ ثابت / متغیر / پرداختی /
 *     ماندهٔ نیمسال / ماندهٔ قبلی / تخفیف‌ها / مبلغ موضوعی / معدل / گذرانده / …
 *   • فهرست اسناد پرداخت (بانک، تاریخ، شمارهٔ فیش، حساب، مبلغ)
 *
 *  قرارداد علامت: مثبت = بدهی دانشجو.
 *  عمداً بدون وابستگی سروری است تا در صفحات سروری و کلاینتی کار کند.
 * ══════════════════════════════════════════════════════════════════════
 */

const fa = (n: number | null | undefined) => Number(n || 0).toLocaleString('fa-IR');

/** نرخ/نوع درس — برچسبِ نوع درس مالی (همان کدی که مبلغ را می‌سازد) */
const courseTypeLabel = (c: TranscriptCourseView) => courseTypeLabelOf(c);

/** «مبنای نرخ» — یکسان در نوع الف و نوع ب */
const rateBasisLabel = (t: TranscriptTermView): string =>
  t.coursesBasis === 'TARIFF' ? 'تعرفهٔ رسمی همان سال' : 'محاسباتی (دفتر کل)';

/**
 * تاریخ شمسی خوانا؛ تهی → خط تیره.
 * تاریخ‌های سما از قبل شمسی‌اند («1400-07-01») و نباید دوباره تبدیل شوند.
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

/**
 * کد مقطعِ سما (SAMA-5 / HAMAVA-5 …) → عدد خالص همان سند قدیمی.
 * عنوان‌های استاندارد هم اینجا نگه داشته می‌شوند تا اگر عنوانِ DB عنوانِ
 * فنی («مقطع ۵») بود، سند همان عبارت رسمی را نشان دهد.
 */
const SAMA_DEGREE_FA: Record<string, string> = {
  '1': 'کاردانی پیوسته',
  '2': 'کاردانی ناپیوسته',
  '3': 'کارشناسی پیوسته',
  '4': 'کارشناسی ارشد',
  '5': 'کارشناسی ناپیوسته',
  '6': 'دکتری',
  '7': 'دکتری حرفه‌ای',
};

function legacyNumericCode(code: string | number | null | undefined): string | null {
  if (code == null) return null;
  const s = String(code).trim();
  if (!s) return null;
  const m = /^[A-Za-z_]+-(\d+)$/.exec(s);
  if (m) return m[1];
  return s;
}

/** «کد=عنوان» — همان قرارداد سیستم قدیمی */
function codeLabel(code: string | number | null | undefined, title: string | null | undefined): string {
  const c = code == null ? '' : String(code).trim();
  const t = title == null ? '' : String(title).trim();
  if (c && t) return `${faDigits(c)}=${t}`;
  if (c) return faDigits(c);
  return t || '—';
}

export interface TranscriptEventView {
  kind: string;
  label: string;
  amount: number;
  dateMs: number | null;
  sign: 1 | -1;
  depositType?: string | null;
  datedByDeposit?: boolean;
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
  grade?: number | null;
  courseNature?: string | null;
  /** نوع درس مالی سما — همان کدی که نرخ هر واحد را تعیین می‌کند */
  maliType?: number | null;
  offeringType?: string | null;
  theoreticalUnits?: number;
  practicalUnits?: number;
  /** کد/برچسب وضعیت ثبت درس (پیش‌فرض: ۱=انتخاب واحد) */
  registrationCode?: string | number | null;
  registrationTitle?: string | null;
}

export interface TranscriptTermView {
  termId: number;
  termTitle: string;
  termCode?: string | null;
  statusTitle?: string | null;
  /** کد وضعیت دانشجو در این نیمسال (student_term_states.statusCode) */
  statusCode?: string | null;
  charges: number;
  tuitionFixed?: number;
  tuitionVariable?: number;
  discounts: number;
  /** تفکیک تخفیف بر اساس قلمروی اثر (ستون‌های تخفیف ثابت/متغیر/مبلغی) */
  discountsFixed?: number;
  discountsVariable?: number;
  discountsAmount?: number;
  /** مبالغ موضوعی (اضافه/کاهش) همان ترم */
  subjectFees?: number;
  /** مساعدهٔ ترم */
  assistance?: number;
  /** معدل ترم */
  termAvg?: number | null;
  /** واحدهای گذرانده در ترم */
  passedUnits?: number | null;
  sponsorships: number;
  sponsorshipsFromDeposits?: number;
  charityCoverage?: number;
  netPayable: number;
  payments: number;
  chequesCleared: number;
  chequesPending: number;
  chequesBounced: number;
  loans: number;
  balance: number;
  events: TranscriptEventView[];
  courses?: TranscriptCourseView[];
  coursesBasis?: 'TARIFF' | 'LEDGER';
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
  /** کد رشته در سیستم قدیمی (majors.majorCode) */
  majorCode?: string | null;
  degreeTitle?: string | null;
  /** کد مقطع (degree_level_configs.code) */
  degreeCode?: string | null;
  entryYear?: number | null;
  entryTerm?: number | null;
  status?: string | null;
  /** کد وضعیت دانشجو در سیستم قدیمی */
  statusCode?: string | null;
  facultyTitle?: string | null;
  quotaType?: string | null;
  /** کد سهمیه در سیستم قدیمی */
  quotaCode?: string | null;
  courseType?: string | null;
  /** کد نوع دوره (studyingMode / COURSTYPE) */
  courseTypeCode?: string | null;
  admissionMethod?: string | null;
  entryDate?: string | Date | null;
  settlementDate?: string | Date | null;
  photoUrl?: string | null;
  birthCertNo?: string | null;
  birthDate?: string | Date | null;
  documentNo?: string | null;
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

function balanceBadge(balance: number): { text: string; cls: string } {
  if (balance > 0) return { text: 'بدهکار', cls: 'bg-rose-100 text-rose-800 border-rose-300' };
  if (balance < 0) return { text: 'بستانکار', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
  return { text: 'تسویه', cls: 'bg-slate-100 text-slate-700 border-slate-300' };
}

function toNum(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function last4(s: string | null | undefined): string {
  if (!s) return '';
  return s.length > 4 ? '••••' + s.slice(-4) : s;
}
function maskNC(nc: string | null | undefined, isFinance: boolean): string {
  if (!nc) return '';
  if (isFinance) return nc;
  return nc.length > 4 ? '••••' + nc.slice(-4) : nc;
}

export interface FinancialTranscriptProps {
  student: TranscriptStudentView;
  terms: TranscriptTermView[];
  totals: TranscriptTotalsView;
  universityTitle?: string | null;
  logoUrl?: string | null;
  issuedAt?: string | null;
  scopeLabel?: string;
  showEvents?: boolean;
  viewerRole?: 'STUDENT' | 'FINANCE' | 'ADMIN';
  official?: boolean;
  cheques?: TranscriptChequeView[];
  loans?: TranscriptLoanView[];
  leadBlock?: ReactNode;
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
  const grand = balanceBadge(totals.balance);
  const isFinance = viewerRole === 'FINANCE' || viewerRole === 'ADMIN';

  // ماندهٔ قبلی هر ترم = جمع ماندهٔ ترم‌های پیش از آن (به ترتیب زمانی)
  const priorByTermId = new Map<number, number>();
  {
    let running = 0;
    for (const t of terms) { priorByTermId.set(t.termId, running); running += t.balance; }
  }

  const sumFixed = terms.reduce((a, t) => a + (t.tuitionFixed ?? 0), 0);
  const sumVariable = terms.reduce((a, t) => a + (t.tuitionVariable ?? 0), 0);
  const sumPayments = terms.reduce((a, t) => a + t.payments + t.chequesCleared, 0);

  // آخرین کد وضعیتِ دانشجو برای سربرگ (از جدیدترین ترم)
  const headerStatusCode = student.statusCode
    ?? terms.map((t) => t.statusCode).filter(Boolean).slice(-1)[0]
    ?? null;
  // عنوان وضعیت: اول از کد سما، بعد از وضعیت داخلی (فارسی)، در نهایت مقدار خام
  const headerStatusTitle = headerStatusCode
    ? (SAMA_STATUS_TITLE[String(headerStatusCode)] ?? student.status ?? null)
    : (student.status ? (STUDENT_STATUS_FA[student.status] ?? student.status) : null);
  const courseTypeTitle = student.courseTypeCode
    ? (COURSE_TYPE_FA[String(student.courseTypeCode)] ?? student.courseType ?? null)
    : (student.courseType ?? null);
  const quotaTitle = student.quotaType ? (QUOTA_FA[student.quotaType] ?? student.quotaType) : null;
  const degreeCode = legacyNumericCode(student.degreeCode);
  const degreeTitle = (degreeCode && SAMA_DEGREE_FA[degreeCode]) || student.degreeTitle;

  return (
    <div dir="rtl" className="transcript-print-area tr-root tr-fin-root bg-white border-2 border-slate-800 text-[10px] text-slate-900 print:shadow-none">
      {/* ═══════════ سربرگ ═══════════ */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 border-b-2 border-slate-800 px-3 py-2">
        {/* ستون راست: هویت دانشجو */}
        <div className="space-y-0.5 text-right leading-4">
          <p className="text-[9px] font-bold text-slate-600">نام خانوادگی و نام</p>
          <p className="text-[11px] font-black">{student.fullName || '—'}</p>
          <p className="text-[9px] text-slate-600">
            شمارهٔ دانشجو: <b className="font-mono" dir="ltr">{faDigits(student.studentCode || '—')}</b>
          </p>
          <p className="text-[9px] text-slate-600">
            شمارهٔ ملی: <b className="font-mono" dir="ltr">{faDigits(student.nationalCode || '—')}</b>
          </p>
          <p className="text-[9px] text-slate-600">
            رشته: <b>{codeLabel(student.majorCode, student.majorTitle)}</b>
          </p>
          <p className="text-[9px] text-slate-600">
            دانشکده: <b>{student.facultyTitle || '—'}</b>
          </p>
        </div>

        {/* ستون میانی: نشان و عنوان سند */}
        <div className="flex min-w-[150px] flex-col items-center justify-center px-2">
          {logoUrl ? (
            <img src={logoUrl} alt="آرم دانشگاه" className="mb-1 h-10 w-10 object-contain" />
          ) : (
            <span className="mb-1 rounded border border-dashed border-slate-300 px-1 py-0.5 text-[8px] text-slate-400">ارم دانشگاه</span>
          )}
          <h1 className="whitespace-nowrap text-[13px] font-black tracking-tight">کارنامهٔ مالی دانشجو</h1>
          <p className="mt-0.5 text-center text-[8px] leading-3 text-slate-600">{universityTitle || 'موسسهٔ آموزش عالی'}</p>
          <p className="text-center text-[8px] leading-3 text-slate-600">معاونت اداری و مالی — ادارهٔ امور مالی</p>
        </div>

        {/* ستون چپ: کدهای ثبتی */}
        <div className="space-y-0.5 text-left leading-4">
          <p className="text-[9px] text-slate-600">
            مقطع: <b>{codeLabel(degreeCode, degreeTitle)}</b>
          </p>
          <p className="text-[9px] text-slate-600">
            نوع دوره: <b>{codeLabel(student.courseTypeCode, courseTypeTitle)}</b>
          </p>
          <p className="text-[9px] text-slate-600">
            وضعیت: <b>{codeLabel(headerStatusCode, headerStatusTitle)}</b>
          </p>
          <p className="text-[9px] text-slate-600">
            سهمیهٔ نهایی: <b>{codeLabel(student.quotaCode, quotaTitle)}</b>
          </p>
          <p className="text-[9px] text-slate-600">تاریخ: <b>{issuedAt || '—'}</b></p>
          <p className="text-[9px] text-slate-600">صفحه: <b>۱</b></p>
        </div>
      </div>

      {/* نوار اعتبار سند — فقط نمای دانشجو */}
      {!isFinance && !official && (
        <div className="mx-3 mb-1 mt-1 flex flex-wrap items-center justify-between gap-2 border-2 border-amber-700 bg-amber-50 px-2 py-0.5 text-[9px] font-black text-amber-950">
          <span>⚠️ این کارنامه تا تأیید و مهر کارشناس امور مالی <u>غیرقابل استناد</u> است.</span>
          <span className="shrink-0 font-mono text-[8px]">وضعیت: در انتظار تأیید</span>
        </div>
      )}
      {!isFinance && official && (
        <div className="mx-3 mb-1 mt-1 flex flex-wrap items-center justify-between gap-2 border-2 border-emerald-700 bg-emerald-50 px-2 py-0.5 text-[9px] font-black text-emerald-950">
          <span>✅ این کارنامه با تأیید کارشناس امور مالی، دارای <u>رمز استعلام اصالت (QR)</u> است.</span>
          <span className="shrink-0 font-mono text-[8px]">وضعیت: تأییدشده</span>
        </div>
      )}

      {/* ═══════════ مشخصات تکمیلی (جفت‌های کد=عنوان) ═══════════ */}
      <div className="px-3 pb-1">
        <table className="w-full border-collapse border border-slate-500 text-[9px]">
          <colgroup>
            <col style={{ width: '13%' }} /><col style={{ width: '20%' }} />
            <col style={{ width: '13%' }} /><col style={{ width: '20%' }} />
            <col style={{ width: '13%' }} /><col style={{ width: '21%' }} />
          </colgroup>
          <tbody>
            <tr>
              <td className="border border-slate-400 bg-slate-100 px-1 py-0.5 font-bold">نیمسال ورود</td>
              <td className="border border-slate-400 px-1 py-0.5">
                {student.entryTerm
                  ? `${TERM_FA[student.entryTerm] ?? `نیمسال ${fa(student.entryTerm)}`}${student.entryYear ? ' ' + fa(student.entryYear) : ''}`
                  : (student.entryYear ? fa(student.entryYear) : '—')}
              </td>
              <td className="border border-slate-400 bg-slate-100 px-1 py-0.5 font-bold">تاریخ ورود</td>
              <td className="border border-slate-400 px-1 py-0.5">{jdate(student.entryDate)}</td>
              <td className="border border-slate-400 bg-slate-100 px-1 py-0.5 font-bold">تاریخ تسویه</td>
              <td className="border border-slate-400 px-1 py-0.5">{jdate(student.settlementDate)}</td>
            </tr>
            <tr>
              <td className="border border-slate-400 bg-slate-100 px-1 py-0.5 font-bold">روش پذیرش</td>
              <td className="border border-slate-400 px-1 py-0.5">{student.admissionMethod || '—'}</td>
              <td className="border border-slate-400 bg-slate-100 px-1 py-0.5 font-bold">تاریخ تولد</td>
              <td className="border border-slate-400 px-1 py-0.5">{jdate(student.birthDate)}</td>
              <td className="border border-slate-400 bg-slate-100 px-1 py-0.5 font-bold">شمارهٔ شناسنامه</td>
              <td className="border border-slate-400 px-1 py-0.5 font-mono">{faDigits(student.birthCertNo || '—')}</td>
            </tr>
            <tr>
              <td className="border border-slate-400 bg-slate-100 px-1 py-0.5 font-bold">وضعیت مالی</td>
              <td className="border border-slate-400 px-1 py-0.5">
                <span className={`rounded-full border px-1.5 py-px text-[8px] font-black ${grand.cls}`}>{grand.text}</span>
                <span className="ms-1 font-bold">{fa(Math.abs(totals.balance))} ریال</span>
              </td>
              <td className="border border-slate-400 bg-slate-100 px-1 py-0.5 font-bold">شمارهٔ سند</td>
              <td className="border border-slate-400 px-1 py-0.5 font-mono">{student.documentNo ? faDigits(student.documentNo) : '—'}</td>
              <td className="border border-slate-400 bg-slate-100 px-1 py-0.5 font-bold">دانشگاه مبدأ</td>
              <td className="border border-slate-400 px-1 py-0.5">{student.originUniversityTitle || '—'}</td>
            </tr>
          </tbody>
        </table>
        {student.photoUrl ? (
          <div className="mt-1 flex justify-end">
            <img src={student.photoUrl} alt="عکس دانشجو" className="h-[22mm] w-[17mm] border border-slate-400 object-cover" />
          </div>
        ) : null}
      </div>

      {leadBlock}

      {/* ═══════════ جمع کل دوره ═══════════ */}
      <div className="px-3 pb-2">
        <h2 className="border-b border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-black text-white">
          {scopeLabel || 'جمع کل دوره'}
        </h2>
        <table className="w-full border-collapse border border-slate-500 text-center text-[9px]">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-400 px-1 py-0.5">جمع شهریه</th>
              <th className="border border-slate-400 px-1 py-0.5">شهریهٔ ثابت</th>
              <th className="border border-slate-400 px-1 py-0.5">شهریهٔ متغیر</th>
              <th className="border border-slate-400 px-1 py-0.5">تخفیف‌ها</th>
              <th className="border border-slate-400 px-1 py-0.5">پوشش بنیاد/خیرین</th>
              <th className="border border-slate-400 px-1 py-0.5">پرداختی</th>
              <th className="border border-slate-400 px-1 py-0.5">ماندهٔ نهایی</th>
            </tr>
          </thead>
          <tbody>
            <tr className="font-bold">
              <td className="border border-slate-400 px-1 py-0.5">{fa(totals.charges)}</td>
              <td className="border border-slate-400 px-1 py-0.5">{fa(sumFixed)}</td>
              <td className="border border-slate-400 px-1 py-0.5">{fa(sumVariable)}</td>
              <td className="border border-slate-400 px-1 py-0.5 text-violet-700">{fa(totals.discounts)}</td>
              <td className="border border-slate-400 px-1 py-0.5 text-indigo-700">{fa(totals.sponsorships)}</td>
              <td className="border border-slate-400 px-1 py-0.5 text-emerald-700">{fa(sumPayments)}</td>
              <td className={`border border-slate-400 px-1 py-0.5 text-[11px] font-black ${totals.balance > 0 ? 'text-rose-700' : totals.balance < 0 ? 'text-emerald-700' : ''}`}>
                {fa(Math.abs(totals.balance))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ═══════════ ریز نیمسال‌ها ═══════════ */}
      {terms.length === 0 ? (
        <p className="px-3 py-6 text-center text-slate-500">هیچ تراکنش مالی برای این دانشجو ثبت نشده است.</p>
      ) : terms.map((t) => {
        const prior = priorByTermId.get(t.termId) ?? 0;
        const b = balanceBadge(t.balance);
        const coursesTotal = (t.courses ?? []).reduce((a, c) => a + (Number(c.amount) || 0), 0);
        const sumTheory = (t.courses ?? []).reduce((a, c) => a + (Number(c.theoreticalUnits) || 0), 0);
        const sumPractical = (t.courses ?? []).reduce((a, c) => a + (Number(c.practicalUnits) || 0), 0);
        const paymentEvents = t.events.filter((e) => e.kind === 'PAYMENT' || e.kind === 'SPONSOR' || e.kind === 'LOAN' || e.kind === 'CHARITY');

        return (
          <section key={t.termId} className="tr-breakdown break-inside-avoid px-3 pb-3">
            {/* سربرگ ترم — دقیقاً با عبارت سیستم قدیمی */}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-1 border border-slate-600 bg-slate-100 px-2 py-0.5 text-[9px] font-bold">
              <span>
                نیمسال {faDigits(t.termCode || '—')} : وضعیت دانشجو{' '}
                {codeLabel(t.statusCode, t.statusTitle || (t.statusCode ? SAMA_STATUS_TITLE[String(t.statusCode)] : null))}
              </span>
              <span className="font-mono text-[8px] text-slate-600">
                مبنای نرخ: {rateBasisLabel(t)} · کد گروه تعرفه: {t.tariffGroupCode || '—'}
              </span>
              <span className={`rounded-full border px-1.5 text-[8px] font-black ${b.cls}`}>{b.text}</span>
            </div>

            {/* ریز دروس — تمام ستون‌های کارنامهٔ قدیمی */}
            {t.courses && t.courses.length > 0 ? (
              <table className="w-full border-collapse border border-slate-500 text-[8px]" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '4%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '23%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '7%' }} />
                </colgroup>
                <thead>
                  <tr className="bg-slate-200 text-slate-800">
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">ردیف</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">کد درس</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">نام درس</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">واحد نظری</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">واحد عملی</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">نوع درس آموزش</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">نوع درس انتخابی</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">شهریه ثابت</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">شهریه متغیر</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">نمره</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">شروع انتخاب</th>
                  </tr>
                </thead>
                <tbody>
                  {t.courses.map((c, i) => (
                    <tr key={i} className={i % 2 ? 'bg-slate-50' : ''}>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-center">{fa(i + 1)}</td>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono" dir="ltr">{c.courseCode || '—'}</td>
                      <td className="border border-slate-300 px-0.5 py-0.5 font-medium">{c.courseTitle || '—'}</td>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono">{fa(c.theoreticalUnits ?? 0)}</td>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono">{fa(c.practicalUnits ?? 0)}</td>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-center">
                        {c.maliType != null ? `${fa(c.maliType)}=${courseTypeLabel(c)}` : courseTypeLabel(c)}
                      </td>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-center">
                        {codeLabel(c.registrationCode ?? 1, c.registrationTitle ?? 'انتخاب واحد')}
                      </td>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-center text-slate-400" title="در دفتر مالیِ سامانه در سطح نیمسال ثبت می‌شود">—</td>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-left font-bold">{fa(c.amount)}</td>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono">{c.grade != null ? fa(c.grade) : '—'}</td>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-center text-slate-400" title="در سامانه ثبت نمی‌شود">—</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-black">
                    <td colSpan={3} className="border border-slate-400 px-1 py-0.5">جمع</td>
                    <td className="border border-slate-400 px-0.5 py-0.5 text-center font-mono">{fa(sumTheory)}</td>
                    <td className="border border-slate-400 px-0.5 py-0.5 text-center font-mono">{fa(sumPractical)}</td>
                    <td colSpan={2} className="border border-slate-400 px-1 py-0.5 text-center">
                      جمع واحد: {fa(t.courses.reduce((a, c) => a + (Number(c.units) || 0), 0))}
                    </td>
                    <td className="border border-slate-400 px-0.5 py-0.5 text-center">—</td>
                    <td className="border border-slate-400 px-0.5 py-0.5 text-left">{fa(coursesTotal)}</td>
                    <td colSpan={2} className="border border-slate-400 px-1 py-0.5" />
                  </tr>
                </tbody>
              </table>
            ) : null}

            {/* اسناد پرداخت — چیدمان کارنامهٔ قدیمی */}
            {showEvents && paymentEvents.length > 0 ? (
              <table className="w-full border-collapse border border-slate-500 text-[8px]">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">شرح پرداخت</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">بانک / شعبه</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">تاریخ</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">شمارهٔ فیش</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">شمارهٔ حساب</th>
                    <th className="border border-slate-400 px-0.5 py-0.5 font-bold">مبلغ (ریال)</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentEvents.map((e, i) => (
                    <tr key={i}>
                      <td className="border border-slate-300 px-0.5 py-0.5">
                        {EVENT_LABEL[e.kind] || e.kind}
                        {e.depositType ? ` — ${e.depositType}` : ''}
                        {e.payerName ? ` — ${e.payerName}` : ''}
                        {isFinance && e.payerNationalCode ? ` (${faDigits(e.payerNationalCode)})` : ''}
                        {e.payTypeCode != null ? ` — ${PAY_TYPE_LABELS[e.payTypeCode] ?? e.payTypeCode}` : ''}
                      </td>
                      <td className="border border-slate-300 px-0.5 py-0.5">
                        {e.bankName || '—'}{e.branchName ? ` / ${e.branchName}` : ''}
                      </td>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono">
                        {e.dateMs ? jdate(new Date(e.dateMs)) : '—'}
                      </td>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono" dir="ltr">
                        {e.receiptNo ? faDigits(e.receiptNo) : (e.voucherNo ? faDigits(e.voucherNo) : '—')}
                      </td>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-center font-mono" dir="ltr">
                        {e.accountNo ? faDigits(isFinance ? e.accountNo : last4(e.accountNo)) : '—'}
                      </td>
                      <td className="border border-slate-300 px-0.5 py-0.5 text-left font-bold">{fa(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {/* جدول مالی ترم — دقیقاً ردیف‌های کارنامهٔ قدیمی */}
            <table className="w-full border-collapse border border-slate-500 text-[9px]" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                {[0, 1, 2, 3].map((i) => <col key={i} style={{ width: '25%' }} />)}
              </colgroup>
              <tbody>
                <tr>
                  <FinCell label="اخذ" value={fa(coursesTotal)} />
                  <FinCell label="شهریهٔ ثابت" value={fa(t.tuitionFixed ?? 0)} />
                  <FinCell label="شهریهٔ متغیر" value={fa(t.tuitionVariable ?? 0)} />
                  <FinCell label="پرداختی" value={fa(t.payments + t.chequesCleared)} cls="text-emerald-700" />
                </tr>
                <tr>
                  <FinCell label="ماندهٔ نیمسال" value={fa(Math.abs(t.balance))} cls={t.balance > 0 ? 'text-rose-700' : t.balance < 0 ? 'text-emerald-700' : ''} bold />
                  <FinCell label="ماندهٔ قبلی" value={fa(Math.abs(prior))} />
                  <FinCell label="تخفیف ثابت" value={fa(t.discountsFixed ?? 0)} cls="text-violet-700" />
                  <FinCell label="تخفیف متغیر" value={fa(t.discountsVariable ?? 0)} cls="text-violet-700" />
                </tr>
                <tr>
                  <FinCell label="تخفیف مبلغی" value={fa(t.discountsAmount ?? 0)} cls="text-violet-700" />
                  <FinCell label="مبلغ موضوعی" value={fa(t.subjectFees ?? 0)} />
                  <FinCell label="مساعده" value={fa(t.assistance ?? 0)} />
                  <FinCell label="معدل" value={t.termAvg != null ? fa(t.termAvg) : '—'} />
                </tr>
                <tr>
                  <FinCell label="مبلغ قابل پرداخت" value={fa(t.netPayable)} bold />
                  <FinCell label="گذرانده" value={t.passedUnits != null ? fa(t.passedUnits) : '—'} />
                  <FinCell label="شهریهٔ نیمسال" value={fa(t.charges)} />
                  <FinCell label="بستانکاری نیمسال" value={fa(Math.max(0, -t.balance))} cls="text-emerald-700" />
                </tr>
                <tr>
                  <FinCell label="بدهکار" value={fa(Math.max(0, t.balance))} cls="text-rose-700" bold />
                  <FinCell label="پوشش بنیاد/خیرین" value={fa(t.sponsorships)} cls="text-indigo-700" />
                  <FinCell label="چک در انتظار" value={fa(t.chequesPending)} cls="text-amber-700" />
                  <FinCell label="وام" value={fa(t.loans)} cls="text-sky-700" />
                </tr>
              </tbody>
            </table>
          </section>
        );
      })}

      {/* ═══════════ چک‌ها و وام‌ها ═══════════ */}
      {cheques.length > 0 && (
        <div className="tr-breakdown break-inside-avoid px-3 pb-2">
          <h3 className="border-b border-slate-700 pb-0.5 text-[10px] font-black">چک‌های دانشجو</h3>
          <table className="w-full border-collapse border border-slate-500 text-center text-[8px]">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-400 px-0.5 py-0.5">شمارهٔ چک</th>
                <th className="border border-slate-400 px-0.5 py-0.5">بانک</th>
                <th className="border border-slate-400 px-0.5 py-0.5">مبلغ (ریال)</th>
                <th className="border border-slate-400 px-0.5 py-0.5">سررسید</th>
                <th className="border border-slate-400 px-0.5 py-0.5">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {cheques.map((c) => (
                <tr key={c.id}>
                  <td className="border border-slate-300 px-0.5 py-0.5 font-mono" dir="ltr">{faDigits(c.chequeNo || '—')}</td>
                  <td className="border border-slate-300 px-0.5 py-0.5">{c.bankName || '—'}</td>
                  <td className="border border-slate-300 px-0.5 py-0.5 font-bold">{fa(toNum(c.amount))}</td>
                  <td className="border border-slate-300 px-0.5 py-0.5">{jdate(c.dueDate)}</td>
                  <td className="border border-slate-300 px-0.5 py-0.5">
                    {c.status === 'CLEARED' ? 'وصول‌شده' : c.status === 'BOUNCED' ? 'برگشتی' : c.status === 'CANCELLED' ? 'باطل‌شده' : 'در انتظار وصول'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loans.length > 0 && (
        <div className="tr-breakdown break-inside-avoid px-3 pb-2">
          <h3 className="border-b border-slate-700 pb-0.5 text-[10px] font-black">وام‌های دانشجو</h3>
          <table className="w-full border-collapse border border-slate-500 text-center text-[8px]">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-400 px-0.5 py-0.5">نوع وام</th>
                <th className="border border-slate-400 px-0.5 py-0.5">پرداخت‌کننده</th>
                <th className="border border-slate-400 px-0.5 py-0.5">مبلغ (ریال)</th>
                <th className="border border-slate-400 px-0.5 py-0.5">اقساط</th>
                <th className="border border-slate-400 px-0.5 py-0.5">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id}>
                  <td className="border border-slate-300 px-0.5 py-0.5">{l.productTitle || '—'}</td>
                  <td className="border border-slate-300 px-0.5 py-0.5">{l.lender || '—'}</td>
                  <td className="border border-slate-300 px-0.5 py-0.5 font-bold">{fa(toNum(l.amount))}</td>
                  <td className="border border-slate-300 px-0.5 py-0.5">{l.installments != null ? fa(l.installments) : '—'}</td>
                  <td className="border border-slate-300 px-0.5 py-0.5">
                    {l.status === 'ACTIVE' ? 'فعال' : l.status === 'SETTLED' ? 'تسویه‌شده' : 'لغوشده'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(isFinance || official) && verifyBlock ? <div className="px-3 pb-2 tr-fin-verify">{verifyBlock}</div> : null}

      {/* ═══════════ امضا و مهر ═══════════ */}
      <div className="grid grid-cols-3 gap-2 border-t border-slate-400 px-3 pb-3 pt-2 text-center text-[9px] text-slate-600">
        <div>
          <p className="mb-6 font-medium">کارشناس امور مالی</p>
          <div className="border-t border-slate-400 pt-0.5">نام و امضا</div>
        </div>
        <div>
          <p className="mb-6 font-medium">مهر ادارهٔ مالی</p>
          <div className="border-t border-slate-400 pt-0.5">مهر</div>
        </div>
        <div>
          <p className="mb-6 font-medium">مدیر مالی</p>
          <div className="border-t border-slate-400 pt-0.5">نام و امضا</div>
        </div>
      </div>
    </div>
  );
}

/** یک خانهٔ «برچسب/مقدار» در جدول مالی ترم — چیدمان فشردهٔ سند قدیمی */
function FinCell({ label, value, cls, bold }: { label: string; value: string; cls?: string; bold?: boolean }) {
  return (
    <td className="border border-slate-400 px-1 py-0.5 align-top">
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[8px] text-slate-600">{label}</span>
        <span className={`shrink-0 font-mono ${bold ? 'font-black' : 'font-bold'} ${cls || ''}`}>{value}</span>
      </div>
    </td>
  );
}
