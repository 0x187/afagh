import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getSanjeshRowDetail } from '@/lib/sanjesh-drilldown-api';

import { SanjeshSteps } from './_ui';

// ═══ /admin/sanjesh/:id/rows/:rowId — port of sanjesh/[id]/rows/[rowId]/page.tsx ═══
// Every stored column of the applicant — mapped or not. This page is the proof
// that no data from the file is thrown away.

export function SanjeshRowDetailPage() {
  const params = useParams();
  const fileId = Number(params.id);
  const rowId = Number(params.rowId);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sanjesh-row-detail', fileId, rowId],
    queryFn: () => getSanjeshRowDetail(fileId, rowId),
    enabled: Number.isFinite(fileId) && fileId > 0 && Number.isFinite(rowId) && rowId > 0,
  });

  if (!Number.isFinite(fileId) || fileId <= 0 || !Number.isFinite(rowId) || rowId <= 0)
    return <p className="p-6 text-sm text-red-600">شناسهٔ نامعتبر است.</p>;
  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data)
    return <p className="p-6 text-sm text-red-600">{error instanceof Error ? error.message : 'ردیف یافت نشد.'}</p>;

  const rawCols = data.dataJson?.columns ?? {};
  const mappedByCol = new Map(data.fields.map((f) => [f.colIndex, f]));
  const totalCols = Math.max(data.fields.length, Object.keys(rawCols).length);

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <SanjeshSteps fileId={fileId} active="rows" />

      <header className="mb-3">
        <h1 className="text-base font-black text-foreground">
          داوطلب ردیف {faNumber(data.row.rowNo)} — {data.row.fullName ?? 'بدون نام'}
        </h1>
        <p className="text-[10px] text-muted-foreground" dir="ltr">
          nationalCode={data.row.nationalCode ?? '—'} · applicantNo={data.row.applicantNo ?? '—'} · uniqueId=
          {data.row.uniqueId ?? '—'} · hash={data.rowHash ?? '—'}
        </p>
      </header>

      <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
        <span className="inline-block rounded-full bg-muted px-2 py-0.5 font-bold text-muted-foreground">
          وضعیت: {data.row.matchStatus}
        </span>
        {data.row.studentId && (
          <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            شناسهٔ دانشجو: {faNumber(data.row.studentId)}
          </span>
        )}
        <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 font-bold text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
          {faNumber(totalCols)} ستون ذخیره‌شده
        </span>
        <Link
          to={`/admin/sanjesh/${fileId}/rows`}
          className="inline-block rounded-full border border-border bg-card px-2 py-0.5 font-bold text-teal-700 hover:underline dark:text-teal-400"
        >
          ← بازگشت به لیست
        </Link>
      </div>

      <Card className="mb-3">
        <CardContent className="pt-4">
          <h2 className="mb-2 text-sm font-bold">همهٔ ستون‌های فایل</h2>
          <div className="max-h-[60vh] overflow-auto rounded-xl border border-border">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                <tr>
                  <th className="sticky right-0 z-20 w-12 bg-muted p-2 font-bold shadow-[-2px_0_0_0_rgba(148,163,184,0.5)]">#</th>
                  <th className="p-2 font-bold">عنوان سنجش</th>
                  <th className="p-2 font-bold">فیلد مقصد</th>
                  <th className="p-2 font-bold">مقدار خام</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: totalCols }, (_, i) => i + 1).map((c) => {
                  const f = mappedByCol.get(c);
                  const raw = rawCols[String(c)] ?? '';
                  const unmapped = !f?.isMapped;
                  return (
                    <tr key={c} className={unmapped ? 'border-t border-border/50 bg-amber-50/50 dark:bg-amber-950/20' : 'border-t border-border/50'}>
                      <td className="sticky right-0 z-10 bg-inherit p-2 text-center tabular-nums text-muted-foreground shadow-[-2px_0_0_0_rgba(148,163,184,0.35)]">
                        {faDigits(c)}
                      </td>
                      <td className="p-2">{f?.sanjeshTitle ?? `ستون ${faDigits(c)}`}</td>
                      <td className="p-2 text-muted-foreground" dir="ltr">
                        {f?.targetField ?? <span className="text-amber-700 dark:text-amber-400">نگاشت‌نشده</span>}
                      </td>
                      <td className="p-2" dir="auto">
                        {raw === '' ? <span className="text-muted-foreground/50">—</span> : raw}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <h2 className="mb-2 text-sm font-bold">خط اصلی فایل (بدون دستکاری)</h2>
          <pre className="max-h-48 overflow-auto rounded-xl bg-slate-900 p-3 text-[10px] leading-5 text-slate-200" dir="ltr">
            {data.rawLine}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
