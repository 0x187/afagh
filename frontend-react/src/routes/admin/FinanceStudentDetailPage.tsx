import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Printer } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FinancialTranscript } from '@/components/FinancialTranscript';
import { toJalaliFromDate, faDigits } from '@/lib/calendar';
import { doPrintTranscript } from '@/lib/print';
import { getStudentFinanceDetail } from '@/lib/admin-api';
import { getFinanceStatementApproval } from '@/lib/small-pages-api';
import type { FinanceTerm } from '@/lib/student-api';

// ═══ /admin/finance/student/:id — printable financial transcript (کارنامهٔ مالی) ═══
// Port of admin/finance/student/[id]/page.tsx (the print side). The data comes
// from the shared canonical engine GET /api/v2/admin/finance/student/:id —
// the same engine the student statement uses, so the cartable number and the
// finance statement cannot diverge. Two document layouts: «نوع الف» = the card
// style (shared FinancialTranscript component) and «نوع ب» = flat and compact
// (the reference FinancialTranscriptFlat, inlined in its essential scope).
// The management sections (discounts/cheques/loans editing) live on the
// existing AdminStudentFinanceRoute; this page adds the printable document.

const fa = (n: number | null | undefined) => Number(n || 0).toLocaleString('en-US');

/** Persian readable date; empty → dash. Jalali strings pass through untouched. */
function jdate(d: string | null | undefined): string {
  if (!d) return '—';
  if (/^1[34]\d{2}[/-]/.test(d.trim())) return faDigits(d.trim().replace(/-/g, '/'));
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const { jy, jm, jd } = toJalaliFromDate(date);
  return faDigits(`${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`);
}

const balanceBadge = (balance: number) =>
  balance > 0
    ? { text: 'بدهکار', cls: 'border-transparent bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200' }
    : balance < 0
      ? { text: 'بستانکار', cls: 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' }
      : { text: 'تسویه', cls: 'border-transparent bg-muted text-foreground/80' };

/** «نوع ب» — flat compact document: dense tables on one sheet, office style. */
function FlatTranscript({ terms, student, universityTitle, issuedAt }: {
  terms: FinanceTerm[];
  student: { fullName: string | null; studentCode: string | null; nationalCode?: string | null; majorTitle?: string | null; degreeTitle?: string | null; entryYear?: number | null };
  universityTitle?: string | null;
  issuedAt?: string | null;
}) {
  const rateBasisLabel = (t: FinanceTerm) => (t.coursesBasis === 'TARIFF' ? 'تعرفهٔ رسمی همان سال' : 'محاسباتی (دفتر کل)');
  return (
    <div dir="rtl" className="transcript-print-area tr-flat-root bg-white border-2 border-slate-800 text-[9px] text-slate-900 print:shadow-none">
      {/* سربرگ اداری */}
      <div className="flex items-stretch justify-between gap-2 border-b-2 border-slate-800 bg-slate-50 px-2 py-1">
        <div>
          <p className="text-[13px] font-black">{universityTitle || ''}</p>
          <p className="text-[8px] text-slate-600">کارنامهٔ مالی دانشجو — نوع ب (تخت و فشرده)</p>
        </div>
        <div className="text-[8px] text-slate-600 leading-4">
          <p>دانشجو: <b>{student.fullName ?? '—'}</b></p>
          <p>شمارهٔ دانشجویی: <b className="font-mono">{student.studentCode ?? '—'}</b>{student.nationalCode ? ` — کد ملی: ${student.nationalCode}` : ''}</p>
          <p>{student.majorTitle ?? ''}{student.degreeTitle ? ` — ${student.degreeTitle}` : ''}{student.entryYear ? ` — ورودی ${student.entryYear}` : ''}</p>
          <p>تاریخ صدور: {issuedAt ?? '—'}</p>
        </div>
      </div>

      {/* جدول‌های تخت ترم‌به‌ترم */}
      {terms.map((t) => {
        const coursesTotal = (t.courses ?? []).reduce((a, c) => a + (Number(c.amount) || 0), 0);
        return (
          <div key={t.termId} className="border-b border-slate-300 px-2 py-1.5">
            <p className="mb-1 flex flex-wrap items-center gap-2 font-black text-[9px]">
              <span>{t.termTitle}{t.termCode ? ` (${t.termCode})` : ''}</span>
              {t.statusTitle ? <span className="font-bold text-slate-600">{t.statusTitle}</span> : null}
              {t.termAvg != null ? <span className="font-bold text-slate-600">معدل: {fa(t.termAvg)}</span> : null}
              {t.passedUnits != null ? <span className="font-bold text-slate-600">واحد گذرانده: {fa(t.passedUnits)}</span> : null}
              <span className="font-normal text-slate-500">مبنای نرخ: {rateBasisLabel(t)}</span>
            </p>
            <table className="tr-doc w-full border-collapse table-fixed text-right">
              <thead>
                <tr className="bg-slate-100 border-y border-slate-400 font-bold">
                  <th className="border border-slate-400 px-0.5 py-0.5 w-[16%]">کد درس</th>
                  <th className="border border-slate-400 px-0.5 py-0.5">عنوان درس</th>
                  <th className="border border-slate-400 px-0.5 py-0.5 w-[10%]">واحد</th>
                  <th className="border border-slate-400 px-0.5 py-0.5 w-[12%]">نرخ واحد</th>
                  <th className="border border-slate-400 px-0.5 py-0.5 w-[14%]">مبلغ (ریال)</th>
                </tr>
              </thead>
              <tbody>
                {(t.courses ?? []).map((c, i) => (
                  <tr key={`${t.termId}-${i}`} className="border-b border-slate-300">
                    <td className="border-x border-slate-300 px-0.5 py-0.5 font-mono">{c.courseCode ?? '—'}</td>
                    <td className="border-x border-slate-300 px-0.5 py-0.5">{c.courseTitle ?? '—'}</td>
                    <td className="border-x border-slate-300 px-0.5 py-0.5 text-center">{fa(c.units)}</td>
                    <td className="border-x border-slate-300 px-0.5 py-0.5 text-left font-mono">{fa(c.perUnit)}</td>
                    <td className="border-x border-slate-300 px-0.5 py-0.5 text-left font-mono">{fa(c.amount)}</td>
                  </tr>
                ))}
                {(!t.courses || t.courses.length === 0) && (
                  <tr><td colSpan={5} className="border-x border-b border-slate-300 px-0.5 py-1 text-center text-slate-500">درسی ثبت نشده است.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-800 font-black bg-slate-50">
                  <td colSpan={4} className="border-x border-slate-400 px-0.5 py-0.5">جمع شهریهٔ متغیر دروس (ریال)</td>
                  <td className="border-x border-slate-400 px-0.5 py-0.5 text-left font-mono">{fa(coursesTotal)}</td>
                </tr>
              </tfoot>
            </table>
            <table className="tr-doc mt-1 w-full border-collapse table-fixed text-right">
              <tbody>
                <tr className="font-bold">
                  <td className="border border-slate-400 bg-slate-50 px-0.5 py-0.5 w-[20%]">شهریه ثابت</td>
                  <td className="border border-slate-400 px-0.5 py-0.5 text-left font-mono">{fa(t.tuitionFixed ?? 0)}</td>
                  <td className="border border-slate-400 bg-slate-50 px-0.5 py-0.5 w-[20%]">شهریه متغیر</td>
                  <td className="border border-slate-400 px-0.5 py-0.5 text-left font-mono">{fa(t.tuitionVariable ?? 0)}</td>
                  <td className="border border-slate-400 bg-slate-50 px-0.5 py-0.5 w-[20%]">مبالغ موضوعی</td>
                  <td className="border border-slate-400 px-0.5 py-0.5 text-left font-mono">{fa(t.subjectFees ?? 0)}</td>
                </tr>
                <tr className="font-bold">
                  <td className="border border-slate-400 bg-slate-50 px-0.5 py-0.5">تخفیف</td>
                  <td className="border border-slate-400 px-0.5 py-0.5 text-left font-mono text-emerald-800">{fa(t.discounts)}</td>
                  <td className="border border-slate-400 bg-slate-50 px-0.5 py-0.5">پوشش بنیاد</td>
                  <td className="border border-slate-400 px-0.5 py-0.5 text-left font-mono text-emerald-800">{fa(t.sponsorships)}</td>
                  <td className="border border-slate-400 bg-slate-50 px-0.5 py-0.5">مساعده</td>
                  <td className="border border-slate-400 px-0.5 py-0.5 text-left font-mono text-emerald-800">{fa(t.assistance ?? 0)}</td>
                </tr>
                <tr className="font-bold">
                  <td className="border border-slate-400 bg-slate-50 px-0.5 py-0.5">پرداخت نقدی</td>
                  <td className="border border-slate-400 px-0.5 py-0.5 text-left font-mono">{fa(t.payments)}</td>
                  <td className="border border-slate-400 bg-slate-50 px-0.5 py-0.5">چک وصولی</td>
                  <td className="border border-slate-400 px-0.5 py-0.5 text-left font-mono">{fa(t.chequesCleared)}</td>
                  <td className="border border-slate-400 bg-slate-50 px-0.5 py-0.5">وام</td>
                  <td className="border border-slate-400 px-0.5 py-0.5 text-left font-mono">{fa(t.loans)}</td>
                </tr>
                <tr className="font-black">
                  <td className="border border-slate-400 bg-slate-100 px-0.5 py-0.5">مانده ترم</td>
                  <td colSpan={2} className={`border border-slate-400 px-0.5 py-0.5 text-left font-mono ${t.balance > 0 ? 'text-rose-700' : 'text-slate-900'}`}>{fa(t.balance)}</td>
                  <td className="border border-slate-400 bg-slate-100 px-0.5 py-0.5">بدهی نیمسال (خالص)</td>
                  <td colSpan={2} className="border border-slate-400 px-0.5 py-0.5 text-left font-mono">{fa(t.netPayable)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}

      <p className="px-2 py-1 text-[7px] leading-4 text-slate-600">
        این سند از موتور کانونی کارنامهٔ مالی تولید شده است؛ جمع ریز دروس هر ترم با «شهریهٔ متغیر» دفتر کل همان ترم برابر است.
        علامت قراردادی: مثبت = بدهی دانشجو.
      </p>
    </div>
  );
}

export function FinanceStudentDetailPage() {
  const { id } = useParams();
  const studentId = Number(id ?? 0);
  const [searchParams, setSearchParams] = useSearchParams();
  const flatView = searchParams.get('format') === 'flat';
  const [printing, setPrinting] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-student-finance', studentId],
    queryFn: () => getStudentFinanceDetail(studentId),
    enabled: studentId > 0,
  });
  const { data: approval } = useQuery({
    queryKey: ['finance-student-approval', studentId],
    queryFn: () => getFinanceStatementApproval(studentId),
    enabled: studentId > 0,
  });

  if (!studentId)
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">شناسهٔ دانشجو نامعتبر است.</CardContent></Card>;
  if (isLoading)
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-[60vh] w-full" /></div>;
  if (isError || !data)
    return <Card><CardContent className="py-8 text-center text-sm font-bold text-rose-700">دریافت کارنامهٔ مالی ناموفق بود.</CardContent></Card>;

  const finance = data.finance;
  const t = finance.totals;

  const setFormat = (format: 'card' | 'flat') => {
    const sp = new URLSearchParams(searchParams);
    if (format === 'flat') sp.set('format', 'flat');
    else sp.delete('format');
    setSearchParams(sp, { replace: true });
  };

  const doPrint = () => {
    setPrinting(true);
    window.setTimeout(() => {
      doPrintTranscript('portrait');
      setPrinting(false);
    }, 60);
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── سربرگ premium (بدون دکمه‌های عملیاتی؛ آنها زیر سربرگ با استایل خودشان) ── */}
      <div className="no-print">
        <Card className="border-0 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 text-white">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h1 className="text-lg font-black">📄 کارنامهٔ مالی دانشجو</h1>
              <p className="mt-1 text-xs text-emerald-50/90">
                {finance.student.fullName} — {finance.student.studentCode || 'بدون شمارهٔ دانشجویی'}
              </p>
            </div>
            <Button size="sm" variant="outline" asChild className="border-white/25 bg-white/10 text-white hover:bg-white/20">
              <Link to="/admin/finance"><ArrowRight className="size-3.5" aria-hidden /> بازگشت به کارتابل</Link>
            </Button>
          </CardContent>
        </Card>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={doPrint} disabled={printing}>
            <Printer className="size-4" aria-hidden /> {printing ? 'در حال آماده‌سازی…' : 'چاپ کارنامه'}
          </Button>
          {/* نوع سند: الف = کارتی · ب = تخت و فشرده */}
          <div className="flex overflow-hidden rounded-lg border border-input text-xs font-bold">
            <button
              onClick={() => setFormat('card')}
              className={!flatView ? 'bg-foreground px-3 py-1.5 text-background' : 'px-3 py-1.5 text-muted-foreground hover:bg-muted'}
            >
              نوع الف
            </button>
            <button
              onClick={() => setFormat('flat')}
              className={flatView ? 'border-r border-input bg-foreground px-3 py-1.5 text-background' : 'border-r border-input px-3 py-1.5 text-muted-foreground hover:bg-muted'}
            >
              نوع ب
            </button>
          </div>
          {/* وضعیت تأیید برای چاپ معتبر (درخواست FINANCE_STATEMENT) */}
          <span className={`rounded-lg border px-2.5 py-1.5 text-2xs font-bold ${approval ? 'border-emerald-400/50 bg-emerald-400/20 text-emerald-800 dark:text-emerald-200' : 'border-amber-400/50 bg-amber-400/20 text-amber-800 dark:text-amber-200'}`}>
            {approval
              ? `✅ تأییدشده برای چاپ معتبر${approval.trackingCode ? ` — ${approval.trackingCode}` : ''}`
              : '⏳ بدون تأیید کارشناس مالی (QR برای دانشجو غیرفعال)'}
          </span>
          <Badge className={balanceBadge(t.balance).cls}>
            {balanceBadge(t.balance).text}: {fa(Math.abs(t.balance))} ریال
          </Badge>
        </div>
      </div>

      {/* ═══ بخش چاپ‌شدنی ═══ */}
      <div className="print-area space-y-4">
        {flatView ? (
          <FlatTranscript
            student={{
              fullName: finance.student.fullName,
              studentCode: finance.student.studentCode,
              nationalCode: finance.student.nationalCode,
              majorTitle: finance.student.majorTitle,
              degreeTitle: finance.student.degreeTitle,
              entryYear: finance.student.entryYear,
            }}
            universityTitle={finance.university.title}
            terms={finance.terms}
            issuedAt={jdate(finance.issuedAt)}
          />
        ) : (
          <FinancialTranscript
            student={{
              fullName: finance.student.fullName,
              studentCode: finance.student.studentCode,
              nationalCode: finance.student.nationalCode,
              majorTitle: finance.student.majorTitle,
              majorCode: finance.student.majorCode,
              degreeTitle: finance.student.degreeTitle,
              degreeCode: finance.student.degreeCode,
              entryYear: finance.student.entryYear,
              entryTerm: finance.student.entryTerm,
              status: finance.student.status,
              statusCode: finance.student.statusCode,
              facultyTitle: finance.student.facultyTitle,
              quotaType: finance.student.quotaType,
              quotaCode: finance.student.quotaCode,
              courseType: finance.student.courseType,
              courseTypeCode: finance.student.courseTypeCode,
              admissionMethod: finance.student.admissionMethod,
              entryDate: finance.student.entryDate,
            }}
            terms={finance.terms}
            totals={t}
            universityTitle={finance.university.title}
            issuedAt={jdate(finance.issuedAt)}
            viewerRole="FINANCE"
            official={!!finance.qr}
            cheques={finance.cheques}
            loans={finance.loans}
            verifyBlock={finance.qr ? (
              <div className="flex items-center gap-3 rounded border border-slate-400 bg-slate-50 p-2">
                <div className="size-20 shrink-0" dangerouslySetInnerHTML={{ __html: finance.qr.svg }} />
                <div className="text-[9px] leading-4">
                  <p className="font-black">رمز استعلام اصالت</p>
                  <p className="text-slate-600">اعتبار تا: {faDigits(finance.qr.expiresAt)}</p>
                  <p className="text-slate-500" dir="ltr">{finance.qr.url}</p>
                </div>
              </div>
            ) : undefined}
          />
        )}
      </div>

      {/* چک‌ها و وام‌ها (خارج از سند، برای کارشناس) */}
      {!flatView && (finance.cheques.length > 0 || finance.loans.length > 0) && (
        <Card className="no-print">
          <CardContent className="grid gap-3 pt-4 text-xs sm:grid-cols-2">
            {finance.cheques.length > 0 && (
              <div>
                <h2 className="mb-1 font-black">چک‌ها</h2>
                <table className="w-full text-right">
                  <thead className="border-b border-border text-muted-foreground"><tr><th className="py-1">شماره</th><th>بانک</th><th>مبلغ (ریال)</th><th>سررسید</th><th>وضعیت</th></tr></thead>
                  <tbody>
                    {finance.cheques.map((c) => (
                      <tr key={c.id} className="border-b border-border/40">
                        <td className="py-1 font-mono">{c.chequeNo ?? '—'}</td>
                        <td>{c.bankName ?? '—'}</td>
                        <td className="font-mono">{fa(c.amount)}</td>
                        <td className="font-mono">{c.dueDate ? jdate(c.dueDate) : '—'}</td>
                        <td>{c.status ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {finance.loans.length > 0 && (
              <div>
                <h2 className="mb-1 font-black">وام‌ها</h2>
                <table className="w-full text-right">
                  <thead className="border-b border-border text-muted-foreground"><tr><th className="py-1">محصول</th><th>پرداخت‌کننده</th><th>مبلغ (ریال)</th><th>اقساط</th><th>وضعیت</th></tr></thead>
                  <tbody>
                    {finance.loans.map((l) => (
                      <tr key={l.id} className="border-b border-border/40">
                        <td className="py-1">{l.productTitle ?? '—'}</td>
                        <td>{l.lender ?? '—'}</td>
                        <td className="font-mono">{fa(l.amount)}</td>
                        <td className="font-mono">{l.installments != null ? fa(l.installments) : '—'}</td>
                        <td>{l.status ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
