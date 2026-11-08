import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits } from '@/lib/fa';
import {
  deleteSavedReport, listSavedReports, runSavedReport,
  type BuilderResult, type SavedReportRow,
} from '@/lib/reports-builder-api';

// ═══ Saved reports list — port of admin/reports/saved/SavedReportsClient.tsx ═══

const VIS_FA: Record<string, string> = {
  PRIVATE: '🔒 خصوصی',
  ROLE: '👥 نقش‌های مشخص',
  PUBLIC: '🌐 عمومی',
};

const faNum = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '—' : faDigits(String(v));

function jalaliSmart(value: unknown, withTime = false): string {
  if (value === null || value === undefined || value === '') return '—';
  const raw = String(value).trim();
  if (/^1[34]\d{2}[/-]\d{1,2}[/-]\d{1,2}/.test(raw)) return faDigits(raw.replace(/-/g, '/'));
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return faDigits(raw);
  try {
    const date = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
    if (!withTime) return date;
    return `${date} ${faDigits(String(d.getHours()).padStart(2, '0'))}:${faDigits(String(d.getMinutes()).padStart(2, '0'))}`;
  } catch {
    return faDigits(raw);
  }
}

function fmtCell(value: unknown, format?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (format) {
    case 'DATE': return jalaliSmart(value);
    case 'DATETIME': return jalaliSmart(value, true);
    case 'MONEY': return `${faNum(Math.round(Number(value) || 0).toLocaleString('en-US'))} ریال`;
    case 'NUMBER': return faNum(Number(value).toLocaleString('en-US'));
    default: return String(value);
  }
}

export function AdminReportsSavedPage() {
  const queryClient = useQueryClient();
  const { data: reports, isLoading } = useQuery({
    queryKey: ['reports-saved-list'],
    queryFn: listSavedReports,
    staleTime: 15_000,
  });

  const [active, setActive] = useState<number | null>(null);
  const [result, setResult] = useState<BuilderResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(id: number, page = 1) {
    setBusy(true);
    setErr('');
    try {
      const res = await runSavedReport(id, page);
      setActive(id);
      setResult(res);
    } catch (e) {
      setResult(null);
      setErr(e instanceof Error ? e.message : 'خطای نامشخص در اجرای گزارش');
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(r: SavedReportRow) {
    if (!window.confirm(`گزارشِ «${r.name}» حذف شود؟`)) return;
    setBusy(true);
    setErr('');
    try {
      await deleteSavedReport(r.id);
      if (active === r.id) {
        setActive(null);
        setResult(null);
      }
      await queryClient.invalidateQueries({ queryKey: ['reports-saved-list'] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطای نامشخص در حذف گزارش');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <Skeleton className="h-72 w-full" />;

  if (!reports?.length) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <FolderOpen className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">هنوز گزارشی ذخیره نشده است.</p>
          <Link to="/admin/reports/builder">
            <Button size="sm">🛠️ ساختِ گزارش تازه</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link to="/admin/reports/builder">
          <Button size="sm">🛠️ گزارش‌ساز</Button>
        </Link>
      </div>

      {err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{err}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <Card key={r.id}>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black">{r.sourceIcon} {r.name}</div>
                  {r.description && (
                    <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{r.description}</div>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  {VIS_FA[r.visibility] ?? r.visibility}
                </span>
              </div>

              <div className="text-[10px] text-muted-foreground/80">
                منبع: {r.sourceTitle} · سازنده: {r.ownerName} · {faNum(r.config?.columns?.length ?? 0)} ستون
              </div>

              <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                <Button size="sm" onClick={() => void run(r.id, 1)} disabled={busy}>▶ اجرا</Button>
                {r.isOwner && (
                  <>
                    <Link to={`/admin/reports/builder?edit=${r.id}`}>
                      <Button size="sm" variant="outline" disabled={busy}>✏️ ویرایش</Button>
                    </Link>
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => void doDelete(r)}>🗑 حذف</Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {result && active !== null && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-black">نتیجهٔ گزارش</h2>
              <span className="text-[11px] text-muted-foreground">
                {result.total.toLocaleString('fa-IR')} ردیف · صفحهٔ {result.page.toLocaleString('fa-IR')} از {result.totalPages.toLocaleString('fa-IR')}
              </span>
            </div>

            {!!result.notes?.length && (
              <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {result.notes.join(' ')}
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-xs">
                <thead className="border-b border-border font-bold text-muted-foreground">
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c.key} className="whitespace-nowrap p-2">{c.title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                      {result.columns.map((c) => (
                        <td key={c.key} className="whitespace-nowrap p-2">{fmtCell(r[c.key], c.format)}</td>
                      ))}
                    </tr>
                  ))}
                  {!result.rows.length && (
                    <tr>
                      <td colSpan={result.columns.length} className="p-4 text-center text-muted-foreground">
                        ردیفی برای نمایش نیست.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {result.totalPages > 1 && (
              <div className="mt-2 flex items-center justify-center gap-2">
                <Button size="sm" variant="outline" disabled={result.page <= 1} onClick={() => void run(active, Math.max(1, result.page - 1))}>قبلی</Button>
                <span className="text-[11px] text-muted-foreground">صفحهٔ {result.page.toLocaleString('fa-IR')}</span>
                <Button size="sm" variant="outline" disabled={result.page >= result.totalPages} onClick={() => void run(active, Math.min(result.totalPages, result.page + 1))}>بعدی</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
