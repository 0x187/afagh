import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits } from '@/lib/fa';
import { getStudentCardPrint } from '@/lib/student-cards-api';

// ═══ Printed student card with security-gate QR — port of admin/student-cards/card/[studentId] ═══

function Row({ label, value, strong, mono }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-32 shrink-0 font-bold text-slate-500">{label}:</span>
      <span className={`min-w-0 flex-1 ${strong ? 'font-black' : 'font-bold'} text-slate-800 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

export function StudentCardPrintPage() {
  const { studentId: raw } = useParams();
  const studentId = Number(raw ?? 0);
  const [photoFailed, setPhotoFailed] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-card-print', studentId],
    queryFn: () => getStudentCardPrint(studentId),
    enabled: studentId > 0,
    retry: false,
  });

  if (!studentId) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">شناسهٔ دانشجو نامعتبر است.</CardContent></Card>;
  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm font-bold text-rose-700">دریافت کارت ناموفق بود.</CardContent></Card>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-sm font-black">🪪 کارت دانشجویی — {data.fullName}</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to="/admin/student-cards"><ArrowRight className="size-3.5" aria-hidden /> بازگشت</Link>
          </Button>
          <Button size="sm" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> چاپ</Button>
        </div>
      </div>

      {!data.cardToken ? (
        <div className="no-print rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          برای این دانشجو کارتی صادر نشده است؛ ابتدا از فهرست «صدور و مدیریت کارت دانشجویی» کارت صادر کنید تا QR فعال شود.
        </div>
      ) : null}

      <div className="print-area overflow-hidden rounded-2xl border-2 border-slate-800 bg-white text-slate-900 shadow-xl print:shadow-none">
        <div className="flex items-center justify-between gap-3 border-b-2 border-slate-800 bg-slate-50 px-4 py-2">
          <div className="flex items-center gap-2">
            {data.logoUrl ? <img src={data.logoUrl} alt="آرم دانشگاه" className="h-10 w-10 object-contain" /> : null}
            <div>
              <p className="text-[13px] font-black">{data.universityTitle || '—'}</p>
              <p className="text-[10px] text-slate-600">کارت شناسایی دانشجویی</p>
            </div>
          </div>
          <p className="text-[10px] font-bold text-slate-600">{faDigits(data.studentCode)}</p>
        </div>

        <div className="flex flex-wrap gap-4 p-4">
          <div className="shrink-0">
            {data.hasPhoto && !photoFailed ? (
              <img
                src={`/api/v2/photo/${data.userId}`}
                alt="عکس دانشجو"
                className="h-40 w-32 rounded-lg border-2 border-slate-400 bg-slate-100 object-cover shadow-inner"
                onError={() => setPhotoFailed(true)}
              />
            ) : (
              <div className="flex h-40 w-32 flex-col items-center justify-center rounded-lg border-2 border-slate-400 bg-slate-200 text-slate-500 shadow-inner">
                <span className="text-3xl">👤</span>
                <span className="mt-1 text-[10px] font-bold">عکس دانشجو</span>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1.5 text-[11px]">
            <Row label="نام و نام خانوادگی" value={data.fullName} strong />
            <Row label="شمارهٔ دانشجویی" value={faDigits(data.studentCode)} mono />
            <Row label="کد ملی" value={data.nationalCode ? faDigits(data.nationalCode) : '—'} mono />
            <Row label="رشته" value={data.majorName ?? '—'} />
            <Row label="مقطع" value={data.degreeTitle ?? '—'} />
            <Row label="سال ورود" value={faDigits(String(data.entryYear))} />
            <Row label="وضعیت کارت" value={data.cardStatus ?? 'PENDING'} />
            {data.validUntil ? <Row label="اعتبار کارت تا" value={data.validUntil} /> : null}
          </div>

          <div className="shrink-0 text-center">
            {data.qrSvg ? (
              <div
                className="h-32 w-32 overflow-hidden rounded border border-slate-300 bg-white p-1 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: data.qrSvg }}
              />
            ) : (
              <div className="flex h-32 w-32 items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-slate-400">QR در دسترس نیست</div>
            )}
            <p className="mt-1 text-[9px] font-bold text-slate-600">اسکن برای استعلام هویت</p>
          </div>
        </div>

        <div className="border-t border-slate-300 bg-slate-50 px-4 py-1.5 text-[9px] leading-4 text-slate-600">
          این کارت امانت است و در صورت درخواست مأموران باید ارائه شود. استعلام برخط هویت از پایگاه دادهٔ مرکزی دانشگاه انجام می‌شود
          {data.verifyUrl ? <> — نشانی: <span className="font-mono" dir="ltr">{data.verifyUrl}</span></> : null}.
        </div>
      </div>
    </div>
  );
}
