import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import { getSanjeshMatched, stageSanjeshMatched } from '@/lib/sanjesh-drilldown-api';

import { SanjeshCounter, SanjeshFlash, SanjeshSteps } from './_ui';

// ═══ /admin/sanjesh/:id/matched — port of sanjesh/[id]/matched/page.tsx ═══
// Valid rows of the file that are ready for the admissions queue. INVALID,
// DUPLICATE and IGNORED rows stay out. The "existing student" column is
// informational only — it does not block staging.

export function SanjeshMatchedPage() {
  const params = useParams();
  const fileId = Number(params.id);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sanjesh-matched', fileId],
    queryFn: () => getSanjeshMatched(fileId),
    enabled: Number.isFinite(fileId) && fileId > 0,
  });

  const stage = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const message = await stageSanjeshMatched(fileId);
      setMsg({ kind: 'ok', text: message });
      await qc.invalidateQueries({ queryKey: ['sanjesh-matched', fileId] });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'انتقال ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  };

  if (!Number.isFinite(fileId) || fileId <= 0)
    return <p className="p-6 text-sm text-red-600">شناسهٔ فایل نامعتبر است.</p>;
  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data)
    return <p className="p-6 text-sm text-red-600">{error instanceof Error ? error.message : 'فایل یافت نشد.'}</p>;

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <SanjeshSteps fileId={fileId} active="matched" />
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-base font-black text-foreground">تطبیق داده شده — {data.file.title}</h1>
          <p className="text-[11px] text-muted-foreground">
            ردیف‌های معتبر این فایل که آمادهٔ ورود به صف پذیرش‌اند. ردیف‌های «نامعتبر»، «تکراری» و «نادیده‌گرفته‌شده» منتقل
            نمی‌شوند. ستون «دانشجوی موجود» فقط نشان می‌دهد داوطلب از قبل در سامانه هست یا نه؛ مانع انتقال نیست.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <SanjeshCounter label="آمادهٔ انتقال" value={data.readyCount} tone="emerald" />
          <SanjeshCounter label="دانشجوی موجود" value={data.counters.matched} tone="sky" />
          <SanjeshCounter label="منتقل‌شده" value={data.stagedCount} tone="sky" />
          <SanjeshCounter label="نامعتبر" value={data.counters.invalid} tone="red" />
        </div>
      </header>

      <SanjeshFlash msg={msg?.kind === 'ok' ? msg.text : null} err={msg?.kind === 'err' ? msg.text : null} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || data.readyCount === 0} onClick={stage}>
          انتقال {faNumber(data.readyCount)} ردیف به پذیرش
        </Button>
        <Link
          to="/admin/admissions"
          className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-bold text-indigo-800 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200"
        >
          ادامه: صف پذیرش و نگاشت رشته ←
        </Link>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="max-h-[60vh] overflow-auto rounded-xl border border-border">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                <tr>
                  <th className="sticky right-0 z-20 w-12 bg-muted p-2 font-bold shadow-[-2px_0_0_0_rgba(148,163,184,0.5)]">ردیف</th>
                  <th className="p-2 font-bold">نام</th>
                  <th className="p-2 font-bold">کد ملی</th>
                  <th className="p-2 font-bold">دانشجوی موجود</th>
                  <th className="p-2 font-bold">زمان تطبیق</th>
                </tr>
              </thead>
              <tbody>
                {data.readyRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-muted-foreground">
                      ردیف معتبری برای انتقال نیست (همه نامعتبر، تکراری یا نادیده‌گرفته شده‌اند).
                    </td>
                  </tr>
                ) : (
                  data.readyRows.map((r) => (
                    <tr key={r.id} className="border-t border-border/50">
                      <td className="sticky right-0 z-10 bg-inherit p-2 text-center tabular-nums text-muted-foreground shadow-[-2px_0_0_0_rgba(148,163,184,0.35)]">
                        {faNumber(r.rowNo)}
                      </td>
                      <td className="p-2">{r.fullName ?? '—'}</td>
                      <td className="p-2 tabular-nums" dir="ltr">
                        {r.nationalCode ?? '—'}
                      </td>
                      <td className="p-2 text-[11px]">
                        {r.matchStatus === 'MATCHED' ? (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 font-bold text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                            بله · شناسه {faNumber(r.studentId)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">داوطلب جدید</span>
                        )}
                      </td>
                      <td className="p-2 text-[10px] text-muted-foreground" dir="ltr">
                        {r.matchedAt ? r.matchedAt.replace('T', ' ').slice(0, 19) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {data.readyRows.length === 300 && (
            <p className="mt-2 text-[10px] text-muted-foreground">فقط ۳۰۰ ردیف اول نمایش داده شده است.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
