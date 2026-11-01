import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Printer, ScanLine } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getEnrollConfirm } from '@/lib/student-api';

// ═══ Enrollment confirmation (printable with QR) — port of student/enroll-confirm ═══

const STATUS_FA: Record<string, string> = {
  REGISTERED: 'ثبت قطعی',
  FINALIZED: 'نهایی‌شده',
  WAITLISTED: 'لیست انتظار',
  PENDING_COUNCIL: 'در انتظار شورا',
  DROPPED: 'حذف‌شده',
};

function faDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  } catch {
    return faDigits(iso.slice(0, 10));
  }
}

function faDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return faDigits(iso);
  }
}

export function StudentEnrollConfirmPage() {
  const [printing, setPrinting] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-enroll-confirm'],
    queryFn: getEnrollConfirm,
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
    return <div className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-[60vh] w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت تأییدیه ناموفق بود.</CardContent></Card>;
  }

  if (data.blocked || !data.data) {
    return (
      <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
        <CardContent className="py-6 text-center text-xs text-amber-900 dark:text-amber-100">
          {data.emptyMessage || data.blocked || 'تأییدیه‌ای برای این نیمسال صادر نشد.'}
        </CardContent>
      </Card>
    );
  }

  const d = data.data;

  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-xs">
        <div className="text-xs text-muted-foreground">
          تأییدیهٔ انتخاب واحد <b className="text-foreground">{data.termTitle}</b> — معتبر تا {faDate(data.expiresAt)}
        </div>
        <Button size="sm" onClick={doPrint} disabled={printing}>
          <Printer className="size-4" aria-hidden />
          چاپ تأییدیه
        </Button>
      </div>

      <div className="print-area rounded-2xl border-2 border-slate-800 bg-white p-5 text-slate-900 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-slate-800 pb-3">
          <div>
            <h1 className="text-base font-black">تأییدیهٔ انتخاب واحد</h1>
            <p className="mt-0.5 text-[11px] text-slate-500">
              دانشگاه آفاق — سامانهٔ جامع آموزشی · {data.termTitle}
            </p>
          </div>
          {data.qrSvg ? (
            <div className="size-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white" dangerouslySetInnerHTML={{ __html: data.qrSvg }} />
          ) : (
            <BadgeCheck className="size-10 text-slate-300" aria-hidden />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 py-3 text-xs sm:grid-cols-4">
          {([
            ['نام دانشجو', d.studentName],
            ['شمارهٔ دانشجویی', faDigits(d.studentCode)],
            ['کد ملی (ماسک‌شده)', faDigits(d.nationalIdMasked)],
            ['رشتهٔ تحصیلی', d.majorName ?? '—'],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] font-bold text-slate-500">{k}</div>
              <div className="mt-0.5 text-[12px] font-black text-slate-800">{v}</div>
            </div>
          ))}
        </div>

        <table className="w-full border-collapse text-right text-xs">
          <thead>
            <tr className="border-y-2 border-slate-800 text-slate-600">
              <th className="p-2">ردیف</th>
              <th className="p-2">درس</th>
              <th className="p-2">کد</th>
              <th className="p-2 text-center">واحد</th>
              <th className="p-2 text-center">گروه</th>
              <th className="p-2">استاد</th>
              <th className="p-2">وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {d.courses.map((c, i) => (
              <tr key={`${c.courseCode}-${i}`} className="border-b border-slate-200">
                <td className="p-2 text-slate-500">{faNumber(i + 1)}</td>
                <td className="p-2 font-bold">{c.courseTitle}</td>
                <td className="p-2 font-mono" dir="ltr">{c.courseCode}</td>
                <td className="p-2 text-center">{faNumber(c.units)}</td>
                <td className="p-2 text-center">{faNumber(c.groupNumber)}</td>
                <td className="p-2">{c.professorName ?? '—'}</td>
                <td className="p-2">{STATUS_FA[c.status] ?? c.status}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-800 font-black">
              <td className="p-2" colSpan={3}>جمع</td>
              <td className="p-2 text-center">{faNumber(d.totalUnits)} واحد</td>
              <td className="p-2 text-center" colSpan={3}>{faNumber(d.courses.length)} درس</td>
            </tr>
          </tfoot>
        </table>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3 text-[10px] text-slate-500">
          <div className="min-w-0 break-all">
            {data.verifyUrl ? (
              <>
                <span className="flex items-center gap-1 font-bold text-slate-700">
                  <ScanLine className="size-3" aria-hidden /> استعلام اصالت:
                </span>
                <span dir="ltr" className="font-mono">{data.verifyUrl}</span>
                <br />
              </>
            ) : null}
            صدور: {faDateTime(d.checkedAt)}
          </div>
          <div className="shrink-0 text-center">
            <div className="h-10" />
            <div className="border-t border-slate-400 px-6 pt-1">مهر و امضای آموزش</div>
          </div>
        </div>
      </div>
    </div>
  );
}
