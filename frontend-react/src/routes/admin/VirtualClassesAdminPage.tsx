import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  getVirtualClasses,
  syncVirtualClassRecordings,
  syncVirtualClassStatus,
  type VirtualClassRow,
} from '@/lib/admin-modules6-api';

// ═══ گزارش کلاس‌های آنلاین (BigBlueButton) — port of admin/virtual-classes ═══

const STATUS_FILTERS = [
  { key: 'ALL', label: 'همه' },
  { key: 'RUNNING', label: 'در حال برگزاری' },
  { key: 'DONE', label: 'برگزار شده' },
  { key: 'FUTURE', label: 'برگزار نشده' },
] as const;

function statusOf(r: VirtualClassRow): { text: string; cls: string } {
  if (r.isRunning) return { text: '● در حال برگزاری', cls: 'bg-rose-100 text-rose-800 border-rose-300' };
  if (r.lastRunningAt) return { text: '✓ برگزار شده', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
  return { text: '○ آینده / برگزار نشده', cls: 'bg-slate-100 text-slate-700 border-slate-300' };
}

const fmtDateTime = (s: string | null) => (s ? s.slice(0, 16).replace('T', ' ') : '—');

export function VirtualClassesAdminPage() {
  const qc = useQueryClient();
  const [termId, setTermId] = useState<number | ''>('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]['key']>('ALL');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ['admin-virtual-classes', termId],
    queryFn: () => getVirtualClasses(termId === '' ? null : termId),
  });

  const rows = (q.data?.rows ?? []).filter((r) => {
    if (statusFilter === 'RUNNING') return r.isRunning;
    if (statusFilter === 'DONE') return !r.isRunning && !!r.lastRunningAt;
    if (statusFilter === 'FUTURE') return !r.isRunning && !r.lastRunningAt;
    return true;
  });

  const run = async <T extends { ok: boolean; error?: string }>(fn: () => Promise<T>, done: (r: T) => void) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      done(r);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const syncStatus = () =>
    run(
      () => syncVirtualClassStatus(null),
      (r) => {
        if (r.ok) {
          setMsg(`✓ ${faNumber(r.updated ?? 0)} کلاس همگام شد.`);
          void qc.invalidateQueries({ queryKey: ['admin-virtual-classes'] });
        } else setMsg(`✗ ${r.error ?? ''}`);
      },
    );

  const syncRecs = () =>
    run(
      () => syncVirtualClassRecordings(null),
      (r) => {
        if (r.ok) {
          setMsg(`✓ ${faNumber(r.added ?? 0)} ضبط تازه از ${faNumber(r.classrooms ?? 0)} کلاس ثبت شد.`);
          void qc.invalidateQueries({ queryKey: ['admin-virtual-classes'] });
        } else setMsg(`✗ ${r.error ?? ''}`);
      },
    );

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-900 to-indigo-900 text-white">
        <CardContent className="p-5">
          <h1 className="text-base font-black">📡 گزارش کلاس‌های آنلاین (BigBlueButton)</h1>
          <p className="mt-1 text-xs leading-6 text-indigo-100">
            فهرست همهٔ کلاس‌های آنلاین تعریف‌شده، وضعیت برگزاری، استاد، درس، نیم‌سال، تعداد دانشجو، ضبط‌ها و آخرین همگام‌سازی با سرور بیگ‌بلوباتن.
          </p>
        </CardContent>
      </Card>

      {msg ? <Card><CardContent className="px-4 py-2.5 text-xs font-bold text-foreground">{msg}</CardContent></Card> : null}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
            نیم‌سال:
            <select
              value={String(termId)}
              onChange={(e) => setTermId(e.target.value === '' ? '' : Number(e.target.value))}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-bold"
            >
              <option value="">همهٔ نیم‌سال‌ها</option>
              {(q.data?.terms ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.title} ({t.termCode})</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
            وضعیت:
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_FILTERS)[number]['key'])}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-bold"
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </label>
          <Button size="sm" disabled={busy} onClick={() => void syncStatus()} className="bg-amber-500 text-slate-950 hover:bg-amber-400">
            🔄 همگام‌سازی وضعیت از BBB
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void syncRecs()}>
            🎬 همگام‌سازی ضبط‌ها
          </Button>
          <span className="mr-auto text-xs text-muted-foreground">{faNumber(rows.length)} کلاس</span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto">
          {q.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : q.isError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">دریافت کلاس‌های آنلاین ناموفق بود.</p>
          ) : (
            <table className="w-full border-collapse text-right text-[11px]">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  {['درس', 'استاد', 'نیم‌سال', 'گروه', 'دانشجو', 'وضعیت', 'حاضرین', 'ضبط', 'آخرین همگام‌سازی', 'آخرین برگزاری'].map((h) => (
                    <th key={h} className="p-2.5 text-right font-black">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={10} className="p-6 text-center font-bold text-muted-foreground">کلاس آنلاینی با این فیلتر یافت نشد.</td></tr>
                ) : (
                  rows.map((r) => {
                    const st = statusOf(r);
                    return (
                      <tr key={r.id} className="border-t border-border/50">
                        <td className="p-2.5 font-extrabold">
                          {r.courseCode ? <span className="ml-1 font-mono text-[10px] text-indigo-700" dir="ltr">{r.courseCode}</span> : null}
                          {r.courseTitle}
                        </td>
                        <td className="p-2.5 font-bold">{r.professorName || '—'}</td>
                        <td className="p-2.5">{r.termTitle ?? '—'}</td>
                        <td className="p-2.5">{faDigits(r.groupNumber)}</td>
                        <td className="p-2.5">{faDigits(r.enrolledCount)}</td>
                        <td className="p-2.5"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${st.cls}`}>{st.text}</span></td>
                        <td className="p-2.5">{faDigits(r.participantCount)}</td>
                        <td className="p-2.5">{faDigits(r.recordingsCount)}</td>
                        <td className="p-2.5 text-[10px] text-muted-foreground" dir="ltr">{fmtDateTime(r.lastSyncedAt)}</td>
                        <td className="p-2.5 text-[10px] text-muted-foreground" dir="ltr">{fmtDateTime(r.lastRunningAt)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-[10px] text-muted-foreground">
        <Badge variant="outline">نکته</Badge> دکمه‌های همگام‌سازی مستقیماً با سرور بیگ‌بلوباتن تماس می‌گیرند؛ اگر پیکربندی کلاس مجازی خالی باشد خطا برمی‌گردد.
      </p>
    </div>
  );
}
