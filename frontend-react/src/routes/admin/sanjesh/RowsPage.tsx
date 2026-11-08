import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getSanjeshRows, runSanjeshMatch, setSanjeshRowStatus } from '@/lib/sanjesh-drilldown-api';

import {
  SANJESH_MATCH_STATUS_BADGE,
  SANJESH_MATCH_STATUS_LABEL,
  SanjeshCounter,
  SanjeshFlash,
  SanjeshSteps,
} from './_ui';

// ═══ /admin/sanjesh/:id/rows — port of sanjesh/[id]/rows/page.tsx ═══
// Every raw column of every row is stored in the database; the detail page
// shows them all. Matching runs on the national code within the university.

export function SanjeshRowsPage() {
  const params = useParams();
  const fileId = Number(params.id);
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const q = (searchParams.get('q') ?? '').trim();
  const status = (searchParams.get('status') ?? '').trim();

  const [search, setSearch] = useState(q);
  const [searchStatus, setSearchStatus] = useState(status);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sanjesh-rows', fileId, q, status, page],
    queryFn: () => getSanjeshRows(fileId, { q, status, page }),
    enabled: Number.isFinite(fileId) && fileId > 0,
  });

  const applyFilter = () => {
    const p = new URLSearchParams();
    if (search.trim()) p.set('q', search.trim());
    if (searchStatus) p.set('status', searchStatus);
    setSearchParams(p);
  };

  const runMatch = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const message = await runSanjeshMatch(fileId);
      setMsg({ kind: 'ok', text: message });
      await qc.invalidateQueries({ queryKey: ['sanjesh-rows', fileId] });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'تطبیق ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  };

  const toggleIgnore = async (rowId: number, ignored: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const message = await setSanjeshRowStatus(fileId, rowId, ignored ? 'PENDING' : 'IGNORED');
      setMsg({ kind: 'ok', text: message });
      await qc.invalidateQueries({ queryKey: ['sanjesh-rows', fileId] });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'تغییر وضعیت ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  };

  if (!Number.isFinite(fileId) || fileId <= 0)
    return <p className="p-6 text-sm text-red-600">شناسهٔ فایل نامعتبر است.</p>;
  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data)
    return <p className="p-6 text-sm text-red-600">{error instanceof Error ? error.message : 'فایل یافت نشد.'}</p>;

  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    for (const [k, v] of Object.entries(over)) p.set(k, String(v));
    return `?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <SanjeshSteps fileId={fileId} active="rows" />
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-base font-black text-foreground">لیست سنجش — {data.file.title}</h1>
          <p className="text-[11px] text-muted-foreground">
            همهٔ ستون‌های خام هر ردیف در دیتابیس ذخیره شده است؛ برای دیدن جزئیات روی «مشاهده» بزنید.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <SanjeshCounter label="کل" value={data.counters.total} />
          <SanjeshCounter label="تطبیق‌یافته" value={data.counters.matched} tone="emerald" />
          <SanjeshCounter label="در انتظار" value={data.counters.pending} tone="amber" />
          <SanjeshCounter label="تکراری" value={data.counters.duplicate} tone="sky" />
          <SanjeshCounter label="نامعتبر" value={data.counters.invalid} tone="red" />
        </div>
      </header>

      <SanjeshFlash msg={msg?.kind === 'ok' ? msg.text : null} err={msg?.kind === 'err' ? msg.text : null} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={runMatch}>
          تطبیق با دانشجویان (کد ملی)
        </Button>
        <div className="flex items-center gap-1">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilter();
            }}
            placeholder="کد ملی / نام / شماره داوطلب"
            className="w-56 rounded-lg border border-input bg-card px-2 py-1 text-xs"
          />
          <select
            value={searchStatus}
            onChange={(e) => setSearchStatus(e.target.value)}
            className="w-32 rounded-lg border border-input bg-card px-2 py-1 text-xs"
          >
            <option value="">همه وضعیت‌ها</option>
            {Object.entries(SANJESH_MATCH_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={applyFilter}>
            جستجو
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="overflow-auto rounded-xl border border-border">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                <tr>
                  <th className="sticky right-0 z-20 w-12 bg-muted p-2 font-bold shadow-[-2px_0_0_0_rgba(148,163,184,0.5)]">ردیف</th>
                  <th className="p-2 font-bold">نام</th>
                  <th className="p-2 font-bold">کد ملی</th>
                  <th className="p-2 font-bold">شماره داوطلب</th>
                  <th className="p-2 font-bold">شناسه یکتا</th>
                  <th className="p-2 font-bold">وضعیت</th>
                  <th className="p-2 font-bold">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      ردیفی با این فیلتر یافت نشد.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-border/50">
                      <td className="sticky right-0 z-10 bg-inherit p-2 text-center tabular-nums text-muted-foreground shadow-[-2px_0_0_0_rgba(148,163,184,0.35)]">
                        {faNumber(r.rowNo)}
                      </td>
                      <td className="p-2">{r.fullName ?? '—'}</td>
                      <td className="p-2 tabular-nums" dir="ltr">
                        {r.nationalCode ?? '—'}
                        {!r.nationalCodeValid && r.nationalCode && (
                          <span className="ms-1 text-[10px] text-red-600">(نامعتبر)</span>
                        )}
                      </td>
                      <td className="p-2 tabular-nums" dir="ltr">
                        {r.applicantNo ?? '—'}
                      </td>
                      <td className="p-2 tabular-nums text-muted-foreground" dir="ltr">
                        {r.uniqueId ?? '—'}
                      </td>
                      <td className="p-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${SANJESH_MATCH_STATUS_BADGE[r.matchStatus] ?? 'bg-muted text-muted-foreground'}`}>
                          {SANJESH_MATCH_STATUS_LABEL[r.matchStatus] ?? r.matchStatus}
                        </span>
                        {r.matchNote && <div className="mt-0.5 text-[10px] text-muted-foreground">{r.matchNote}</div>}
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <Link to={`/admin/sanjesh/${fileId}/rows/${r.id}`} className="text-[11px] text-teal-700 hover:underline dark:text-teal-400">
                            مشاهده
                          </Link>
                          <button
                            type="button"
                            className="text-[11px] text-muted-foreground hover:underline disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void toggleIgnore(r.id, r.matchStatus === 'IGNORED')}
                          >
                            {r.matchStatus === 'IGNORED' ? 'بازگردانی' : 'نادیده'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {data.pages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-1 text-xs">
              {page > 1 && (
                <Button size="sm" variant="ghost" asChild>
                  <Link to={`/admin/sanjesh/${fileId}/rows${qs({ page: page - 1 })}`}>قبلی</Link>
                </Button>
              )}
              <span className="px-2 text-muted-foreground">
                صفحهٔ {faDigits(page)} از {faDigits(data.pages)} · {faNumber(data.total)} ردیف
              </span>
              {page < data.pages && (
                <Button size="sm" variant="ghost" asChild>
                  <Link to={`/admin/sanjesh/${fileId}/rows${qs({ page: page + 1 })}`}>بعدی</Link>
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
