import { useQuery } from '@tanstack/react-query';
import { Printer, ReceiptText, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { FinancialTranscript } from '@/components/FinancialTranscript';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, faRial } from '@/lib/fa';
import { getFinance } from '@/lib/student-api';

// ═══ Student finance — port of student/finance (the transcript itself is the
// shared type-A FinancialTranscript component; the page keeps the records
// selector, the QR verification block and the due-cheque reminders) ═══

export function StudentFinancePage() {
  const [params, setParams] = useSearchParams();
  const record = params.get('record') ? Number(params.get('record')) : null;
  const [printing, setPrinting] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-finance', record],
    queryFn: () => getFinance({ record }),
    staleTime: 30_000,
  });

  function doPrint() {
    setPrinting(true);
    window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 60);
  }

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-[60vh] w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت اطلاعات مالی ناموفق بود.</CardContent></Card>;
  }

  const t = data.totals;

  return (
    <div className="space-y-4">
      {data.records.length > 1 ? (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 text-xs shadow-xs">
          <span className="font-bold text-muted-foreground">پروندهٔ مالی (مقطع):</span>
          {data.records.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('record', String(r.id));
                setParams(next, { replace: true });
              }}
              className={`rounded-lg border px-2.5 py-1 font-bold transition ${
                r.id === data.activeRecordId ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {r.degreeTitle ?? 'مقطع نامشخص'} · <span className="font-mono" dir="ltr">{faDigits(r.studentCode)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            <ReceiptText className="size-4.5" aria-hidden />
          </span>
          <div>
            <h1 className="text-sm font-bold">امور مالی من</h1>
            <p className="text-[11px] text-muted-foreground">کارنامهٔ مالی ترم‌به‌ترم، چک‌ها و وام‌ها</p>
          </div>
        </div>
        <Button size="sm" onClick={doPrint} disabled={printing}>
          <Printer className="size-4" aria-hidden /> چاپ کارنامهٔ مالی
        </Button>
      </div>

      {data.dueSoon.length > 0 ? (
        <div className="no-print rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/50">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-100">
            <TriangleAlert className="size-4" aria-hidden /> چک در شرف سررسید
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-900 dark:text-amber-100">
            {data.dueSoon.map((c) => (
              <li key={c.id}>
                چک شمارهٔ {faDigits(c.chequeNo || '—')}{c.bankName ? ` بانک ${c.bankName}` : ''} به مبلغ {faRial(c.amount)} —{' '}
                {c.overdue ? (
                  <b className="text-rose-700 dark:text-rose-300">از سررسید گذشته است</b>
                ) : c.daysLeft === 0 ? (
                  <b>امروز سررسید می‌شود</b>
                ) : (
                  <span>{faNumber(c.daysLeft ?? 0)} روز تا سررسید</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-amber-800 dark:text-amber-200">لطفاً پیش از سررسید نسبت به تأمین موجودی اقدام کنید تا چک برگشت نخورد.</p>
        </div>
      ) : null}

      {data.notifications.length > 0 ? (
        <Card className="no-print">
          <CardContent className="space-y-1.5 p-4">
            <h2 className="border-b border-border/60 pb-2 text-sm font-bold">پیام‌های مالی</h2>
            {data.notifications.map((n) => (
              <p key={n.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>{n.text || n.event}</span>
                <span className="text-[10px] text-muted-foreground">
                  {n.dateMs ? faDigits(new Date(n.dateMs).toLocaleDateString('fa-IR')) : '—'}
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="print-area">
        <FinancialTranscript
          student={{
            fullName: data.student.fullName,
            studentCode: data.student.studentCode,
            nationalCode: data.student.nationalCode,
            majorTitle: data.student.majorTitle,
            majorCode: data.student.majorCode,
            degreeTitle: data.student.degreeTitle,
            degreeCode: data.student.degreeCode,
            entryYear: data.student.entryYear,
            entryTerm: data.student.entryTerm,
            status: data.student.status,
            statusCode: data.student.statusCode,
            facultyTitle: data.student.facultyTitle,
            quotaType: data.student.quotaType,
            quotaCode: data.student.quotaCode,
            courseType: data.student.courseType,
            courseTypeCode: data.student.courseTypeCode,
            admissionMethod: data.student.admissionMethod,
            entryDate: data.student.entryDate,
          }}
          terms={data.terms}
          totals={t}
          universityTitle={data.university.title}
          issuedAt={faDigits(data.issuedAt)}
          official={!!data.qr}
          cheques={data.cheques}
          loans={data.loans}
          verifyBlock={data.qr ? (
            <div className="flex items-center gap-3 rounded border border-slate-400 bg-slate-50 p-2">
              <div className="size-20 shrink-0" dangerouslySetInnerHTML={{ __html: data.qr.svg }} />
              <div className="text-[9px] leading-4">
                <p className="font-black">رمز استعلام اصالت</p>
                <p className="text-slate-600">اعتبار تا: {faDigits(data.qr.expiresAt)}</p>
                <p className="text-slate-500" dir="ltr">{data.qr.url}</p>
              </div>
            </div>
          ) : undefined}
        />
      </div>
    </div>
  );
}
