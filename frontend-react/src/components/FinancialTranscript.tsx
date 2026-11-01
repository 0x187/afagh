import type { ReactNode } from 'react';

import { faDigits } from '@/lib/fa';

// ═══ Official financial transcript — port of components/FinancialTranscript.tsx ═══
//
// Unified term-by-term document; it only takes prepared data from the canonical financial engine.
// Sign convention: positive = student owes.

const fa = (n: number | null | undefined) => Number(n || 0).toLocaleString('fa-IR');

/** Readable Jalali date; empty → dash */
function jdate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return '—';
  }
}

export interface TranscriptEventView {
  kind: string;
  label: string;
  amount: number;
  dateMs: number | null;
  sign: 1 | -1;
}

export interface TranscriptCourseView {
  courseCode: string | null;
  courseTitle: string | null;
  units: number;
  perUnit: number;
  amount: number;
}

export interface TranscriptTermView {
  termId: number;
  termTitle: string;
  termCode?: string | null;
  charges: number;
  discounts: number;
  sponsorships: number;
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
}

export interface TranscriptTotalsView {
  charges: number;
  discounts: number;
  sponsorships: number;
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
  entryTerm?: number | null;
  status?: string | null;
}

const EVENT_LABEL: Record<string, string> = {
  CHARGE: 'بدهی',
  DISCOUNT: 'تخفیف',
  SPONSOR: 'پوشش بنیاد',
  PAYMENT: 'پرداخت',
  CHEQUE: 'چک',
  LOAN: 'وام',
  CLEARANCE: 'تسویه',
};

const TERM_FA: Record<number, string> = { 1: 'مهر', 2: 'بهمن', 3: 'تابستان' };

const STATUS_FA: Record<string, string> = {
  ACTIVE: 'فعال',
  INACTIVE: 'غیرفعال',
  GRADUATED: 'دانش‌آموخته',
  WITHDRAWN: 'انصرافی',
  EXPELLED: 'اخراجی',
  SUSPENDED: 'معلق',
};

/** Full term title from the 5-digit code; if there is no valid code, the stored title. */
function TermTitle({ t }: { t: TranscriptTermView }) {
  const code = String(t.termCode ?? '').trim();
  if (!/^\d{5}$/.test(code)) return <>{t.termTitle}</>;
  const year = Number(code.slice(0, 4));
  const semester = Number(code.slice(4, 5));
  if (semester === 5) return <>نیمسال معادل‌سازی</>;
  if (year < 1300 || year > 1420) return <>{t.termTitle}</>;
  const yearLabel = <span dir="ltr">{faDigits(year)}-{faDigits(year + 1)}</span>;
  if (semester === 3) return <>نیمسال تابستان {yearLabel}</>;
  const name = semester === 1 ? 'نیمسال اول' : semester === 2 ? 'نیمسال دوم' : 'نیمسال نامشخص';
  return <>{name} سال تحصیلی {yearLabel}</>;
}

function balanceBadge(balance: number): { text: string; cls: string } {
  if (balance > 0) return { text: 'بدهکار', cls: 'bg-rose-100 text-rose-800 border-rose-300' };
  if (balance < 0) return { text: 'بستانکار', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
  return { text: 'تسویه', cls: 'bg-slate-100 text-slate-700 border-slate-300' };
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
  leadBlock?: ReactNode;
  verifyBlock?: ReactNode;
}

export function FinancialTranscript({
  student,
  terms,
  totals,
  universityTitle,
  logoUrl,
  issuedAt,
  scopeLabel,
  showEvents = true,
  leadBlock,
  verifyBlock,
}: FinancialTranscriptProps) {
  const paidTotal = totals.payments + totals.chequesCleared + totals.loans;
  const grand = balanceBadge(totals.balance);

  // Two terms per row — same column count as A4 portrait print
  const chunks: TranscriptTermView[][] = [];
  for (let i = 0; i < terms.length; i += 2) chunks.push(terms.slice(i, i + 2));

  return (
    <div dir="rtl" className="transcript-print-area tr-root tr-fin-root border-2 border-slate-800 bg-white text-xs text-slate-800 shadow-xl print:shadow-none">
      <table className="tr-doc rt w-full border-collapse">
        <thead>
          <tr>
            <td className="tr-doc-cell">
              <div className="border-b-2 border-slate-800 px-4 pb-2 pt-4">
                <div className="grid grid-cols-3 items-center text-center">
                  <div className="space-y-1 text-right">
                    <p className="font-bold text-slate-800">جمهوری اسلامی ایران</p>
                    <p className="font-semibold text-slate-700">وزارت علوم، تحقیقات و فناوری</p>
                    {universityTitle ? <p className="text-sm font-extrabold text-slate-900">{universityTitle}</p> : null}
                    <p className="text-[11px] text-slate-500">معاونت اداری و مالی — ادارهٔ امور مالی</p>
                  </div>
                  <div className="flex flex-col items-center justify-center">
                    {logoUrl ? <img src={logoUrl} alt="آرم دانشگاه" className="mb-1 h-12 w-12 shrink-0 object-contain" /> : null}
                    <h2 className="border-b border-slate-800 px-4 pb-0.5 text-base font-black tracking-wide text-slate-950">کارنامهٔ مالی دانشجو</h2>
                    <p className="mt-0.5 text-[10px] text-slate-600">صورت وضعیت بدهی، تخفیف، پوشش، پرداخت، چک و وام — ترم‌به‌ترم</p>
                  </div>
                  <div className="space-y-1 text-left font-mono text-[11px]">
                    <p><span className="font-sans text-slate-500">شماره پرونده: </span><b>{student.studentCode ? faDigits(student.studentCode) : '—'}</b></p>
                    {issuedAt ? <p><span className="font-sans text-slate-500">تاریخ صدور: </span><b>{issuedAt}</b></p> : null}
                    <p className="tr-print-hide"><span className="font-sans text-slate-500">صفحه: </span><b>۱ از ۱</b></p>
                    <p><span className="font-sans text-slate-500">وضعیت: </span><b>{(student.status && STATUS_FA[student.status]) || student.status || '—'}</b></p>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr className="tr-doc-row">
            <td className="tr-doc-cell">
              <div className="space-y-3 p-4">
                {/* ── Details table ── */}
                <table className="tr-fin-info rt w-full border-collapse border border-slate-700 text-[11px]">
                  <tbody>
                    <tr>
                      <td className="border border-slate-300 bg-slate-100 px-2 py-1.5 font-bold text-slate-700">نام و نام خانوادگی</td>
                      <td className="border border-slate-300 px-2 py-1.5 font-medium">{student.fullName || '—'}</td>
                      <td className="border border-slate-300 bg-slate-100 px-2 py-1.5 font-bold text-slate-700">کد ملی</td>
                      <td className="border border-slate-300 px-2 py-1.5">{student.nationalCode ? faDigits(student.nationalCode) : '—'}</td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 bg-slate-100 px-2 py-1.5 font-bold text-slate-700">شمارهٔ دانشجویی</td>
                      <td className="border border-slate-300 px-2 py-1.5 text-right font-mono" dir="ltr">{student.studentCode ? faDigits(student.studentCode) : '—'}</td>
                      <td className="border border-slate-300 bg-slate-100 px-2 py-1.5 font-bold text-slate-700">مقطع</td>
                      <td className="border border-slate-300 px-2 py-1.5">{student.degreeTitle || '—'}</td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 bg-slate-100 px-2 py-1.5 font-bold text-slate-700">رشته</td>
                      <td className="border border-slate-300 px-2 py-1.5">{student.majorTitle || '—'}</td>
                      <td className="border border-slate-300 bg-slate-100 px-2 py-1.5 font-bold text-slate-700">نیمسال ورود</td>
                      <td className="border border-slate-300 px-2 py-1.5">
                        {student.entryTerm
                          ? `${TERM_FA[student.entryTerm] ?? `نیمسال ${fa(student.entryTerm)}`}${student.entryYear ? ' ' + fa(student.entryYear) : ''}`
                          : (student.entryYear ? fa(student.entryYear) : '—')}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 bg-slate-100 px-2 py-1.5 font-bold text-slate-700">وضعیت مالی کل</td>
                      <td colSpan={3} className="border border-slate-300 px-2 py-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${grand.cls}`}>{grand.text}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>

                {leadBlock}

                {/* ── Whole program total ── */}
                <div className="tr-breakdown break-inside-avoid rounded-lg border border-slate-700">
                  <h3 className="border-b border-slate-700 bg-indigo-900 px-3 py-1.5 text-[12px] font-black text-white">
                    {scopeLabel || 'جمع کل دوره'}
                  </h3>
                  <table className="tr-fin-totals rt w-full border-collapse text-center text-[11px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="border border-slate-300 px-1 py-1.5">جمع شهریه (ریال)</th>
                        <th className="border border-slate-300 px-1 py-1.5">تخفیف‌ها</th>
                        <th className="border border-slate-300 px-1 py-1.5">پوشش بنیادها</th>
                        <th className="border border-slate-300 px-1 py-1.5">پرداخت / چک وصولی / وام</th>
                        <th className="border border-slate-300 px-1 py-1.5">ماندهٔ نهایی</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="font-bold">
                        <td className="border border-slate-300 px-1 py-1.5">{fa(totals.charges)}</td>
                        <td className="border border-slate-300 px-1 py-1.5 text-violet-700">{fa(totals.discounts)}</td>
                        <td className="border border-slate-300 px-1 py-1.5 text-indigo-700">{fa(totals.sponsorships)}</td>
                        <td className="border border-slate-300 px-1 py-1.5 text-emerald-700">{fa(paidTotal)}</td>
                        <td className={`border border-slate-300 px-1 py-1.5 text-[13px] font-black ${totals.balance > 0 ? 'text-rose-700' : totals.balance < 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                          {fa(Math.abs(totals.balance))}
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={5} className="border border-slate-300 bg-slate-50 px-2 py-1.5 text-[11px] font-bold text-slate-700">
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

                {/* ── Term blocks ── */}
                <div>
                  <h3 className="mb-2 border-b-2 border-slate-800 pb-1 text-[12px] font-black text-slate-900">ریز ترم‌به‌ترم</h3>
                  {terms.length === 0 ? (
                    <p className="rounded-lg border border-slate-300 bg-slate-50 py-6 text-center text-slate-500">هیچ تراکنش مالی برای این دانشجو ثبت نشده است.</p>
                  ) : (
                    <div className="space-y-3">
                      {chunks.map((group, gi) => (
                        <div key={gi} className="tr-fin-row grid gap-2 break-inside-avoid sm:grid-cols-2">
                          {group.map((t) => {
                            const b = balanceBadge(t.balance);
                            return (
                              <div key={t.termId} className="term-block overflow-hidden rounded-lg border border-slate-700 break-inside-avoid">
                                <div className="flex items-center justify-between gap-1 border-b border-slate-700 bg-slate-100 px-2 py-1.5">
                                  <h4 className="text-[11px] font-black text-slate-900"><TermTitle t={t} /></h4>
                                  <span className={`rounded-full border px-1.5 py-px text-[9px] font-black ${b.cls}`}>{b.text}</span>
                                </div>
                                {t.courses && t.courses.length > 0 && (
                                  <div className="border-t border-slate-200">
                                    <p className="bg-slate-50 px-2 py-1 text-[9px] font-black text-slate-700">
                                      ریز شهریه متغیر دروس{' '}
                                      <span className="tr-print-hide font-medium text-slate-500">
                                        {t.coursesBasis === 'TARIFF'
                                          ? '(بر پایهٔ تعرفهٔ رسمی همان سال — نظری×نرخ + عملی×نرخِ نوع درس؛ تخصیص‌یافته به جمع دفتر کل)'
                                          : '(محاسباتی — مبنای سند، جمع دفتر کل است)'}
                                      </span>
                                    </p>
                                    <table className="tr-term-table tr-fin-courses rt w-full border-collapse text-[9px]" style={{ tableLayout: 'fixed' }}>
                                      <colgroup>
                                        <col style={{ width: '6%' }} />
                                        <col style={{ width: '14%' }} />
                                        <col style={{ width: '30%' }} />
                                        <col style={{ width: '7%' }} />
                                        <col style={{ width: '22%' }} />
                                        <col style={{ width: '21%' }} />
                                      </colgroup>
                                      <thead>
                                        <tr className="bg-slate-50 text-slate-600">
                                          <th className="border-t border-slate-200 px-1 py-0.5 text-center font-bold">ردیف</th>
                                          <th className="border-t border-slate-200 px-1 py-0.5 text-center font-bold">کد درس</th>
                                          <th className="border-t border-slate-200 px-1 py-0.5 font-bold">نام درس</th>
                                          <th className="border-t border-slate-200 px-1 py-0.5 text-center font-bold">واحد</th>
                                          <th className="border-t border-slate-200 px-1 py-0.5 text-center font-bold">نرخ واحد</th>
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
                                            <td className="px-1 py-0.5 text-center font-mono">{fa(c.perUnit)}</td>
                                            <td className="px-1 py-0.5 text-left font-bold">{fa(c.amount)}</td>
                                          </tr>
                                        ))}
                                        <tr className="border-t border-slate-200 bg-slate-50/60">
                                          <td colSpan={5} className="px-1 py-0.5 font-black">جمع متغیر دروس</td>
                                          <td className="px-1 py-0.5 text-left font-black">{fa(t.courses.reduce((a, c) => a + (Number(c.amount) || 0), 0))}</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                                {showEvents && t.events.length > 0 && (
                                  <ul className="space-y-0.5 border-t border-slate-200 bg-slate-50/60 px-2 py-1.5">
                                    {t.events.map((e, i) => (
                                      <li key={i} className="flex items-center justify-between gap-1 text-[9px]">
                                        <span className="truncate text-slate-600">
                                          <span className="font-bold text-slate-700">{EVENT_LABEL[e.kind] || e.kind}:</span> {e.label}
                                          {e.dateMs ? <span className="text-slate-400"> — {jdate(new Date(e.dateMs))}</span> : null}
                                        </span>
                                        <span className={`shrink-0 font-bold ${e.sign === 1 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                          {e.sign === 1 ? '+' : '−'}{fa(e.amount)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                <div className="border-t border-slate-300 bg-slate-100/70">
                                  <TermSummary t={t} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {verifyBlock ? <div className="tr-fin-verify">{verifyBlock}</div> : null}
              </div>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td className="tr-doc-cell tr-signatures">
              <div className="grid grid-cols-3 gap-2 px-4 pb-4 pt-3 text-center text-[10px] text-slate-600">
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

function TermSummary({ t }: { t: TranscriptTermView }) {
  type Cell = { label: string; value: string; cls?: string; bold?: boolean };
  const items: Cell[] = [
    { label: 'شهریه (بدهی)', value: fa(t.charges) },
    { label: 'تخفیف', value: fa(t.discounts), cls: 'text-violet-700' },
    { label: 'پوشش بنیاد', value: fa(t.sponsorships), cls: 'text-indigo-700' },
    { label: 'خالص', value: fa(t.netPayable), bold: true },
    { label: 'پرداخت', value: fa(t.payments), cls: 'text-emerald-700' },
    { label: 'چک وصول‌شده', value: fa(t.chequesCleared), cls: 'text-emerald-700' },
  ];
  if (t.chequesPending > 0) items.push({ label: 'چک در انتظار', value: fa(t.chequesPending), cls: 'text-amber-700' });
  if (t.chequesBounced > 0) items.push({ label: 'چک برگشتی', value: fa(t.chequesBounced), cls: 'text-rose-700' });
  items.push({ label: 'وام', value: fa(t.loans), cls: 'text-sky-700' });
  while (items.length % 3 !== 0) items.push({ label: '', value: '' });
  const rows: Cell[][] = [];
  for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3));

  return (
    <table className="tr-fin-sum rt w-full border-collapse text-[9px]" style={{ tableLayout: 'fixed' }}>
      <colgroup>{[0, 1, 2].map((i) => <col key={i} style={{ width: '33.33%' }} />)}</colgroup>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-t border-slate-200">
            {r.map((c, ci) => (
              <td key={ci} className="tr-sum-cell px-1 py-0.5 align-top">
                <div className="flex items-baseline justify-between gap-1">
                  <span className={`text-slate-600 ${c.bold ? 'font-bold text-slate-800' : ''}`}>{c.label}</span>
                  <span className={`shrink-0 ${c.bold ? 'font-black text-slate-900' : 'font-bold'} ${c.cls || ''}`}>{c.value}</span>
                </div>
              </td>
            ))}
          </tr>
        ))}
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
