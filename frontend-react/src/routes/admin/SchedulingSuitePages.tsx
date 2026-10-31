import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ClipboardCheck, GitBranch, Layout, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import {
  allocateRoomQuotas, checkSchedConflicts, deleteRegulation,
  eduExpertSetClassroomDept, generateSchedSessions, getEduExpertInit, getRegulations, getSchedDashboard,
  getSchedHealth, saveRegulation, transitionSchedPhase,
} from '@/lib/scheduling-suite-api';

// ═══ آیین‌نامه‌ها + تخصیص کارشناس + سوئیت برنامه‌ریزی — صفحات فشرده ═══

function Msg({ msg }: { msg: { kind: 'ok' | 'err'; text: string } | null }) {
  if (!msg) return null;
  return <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>{msg.text}</div>;
}

// ─── آیین‌نامه‌ها ───

export function AdminRegulationsPage() {
  const qc = useQueryClient();
  const rows = useQuery({ queryKey: ['regulations'], queryFn: getRegulations });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [form, setForm] = useState({ title: '', degreeLevelId: '', effectiveFromYear: '1404', effectiveToYear: '', rulesConfig: '{}' });

  const save = useMutation({
    mutationFn: () => saveRegulation({
      title: form.title, degreeLevelId: Number(form.degreeLevelId) || null,
      effectiveFromYear: Number(form.effectiveFromYear),
      effectiveToYear: form.effectiveToYear ? Number(form.effectiveToYear) : null,
      rulesConfig: form.rulesConfig,
    }),
    onSuccess: async () => { setMsg({ kind: 'ok', text: 'آیین‌نامه ذخیره شد.' }); await qc.invalidateQueries({ queryKey: ['regulations'] }); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-black">⚖️ مرکز مدیریت آیین‌نامه‌ها</h1>
      <Msg msg={msg} />
      <Card><CardContent className="space-y-3 pt-4">
        <h2 className="text-sm font-black">آیین‌نامهٔ جدید</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="عنوان *" className="h-8 text-[11px]" />
          <Input value={form.degreeLevelId} onChange={(e) => setForm({ ...form, degreeLevelId: e.target.value })} placeholder="شناسهٔ مقطع" className="h-8 text-[11px] font-mono" dir="ltr" />
          <Input value={form.effectiveFromYear} onChange={(e) => setForm({ ...form, effectiveFromYear: e.target.value })} placeholder="از سال" className="h-8 text-[11px] font-mono" dir="ltr" />
        </div>
        <label className="block space-y-1 text-[10px] font-bold text-muted-foreground"><span>rulesConfig (JSON)</span>
          <textarea value={form.rulesConfig} onChange={(e) => setForm({ ...form, rulesConfig: e.target.value })} rows={6} dir="ltr" className="w-full rounded-lg border border-input bg-card px-2 py-1.5 font-mono text-[10px]" />
        </label>
        <Button size="sm" disabled={save.isPending || !form.title} onClick={() => save.mutate()}>ذخیره</Button>
      </CardContent></Card>
      <Card><CardContent className="space-y-1 pt-4">
        <h2 className="text-sm font-black">آیین‌نامه‌های ثبت‌شده ({faNumber(rows.data?.length ?? 0)})</h2>
        {rows.isLoading ? <Skeleton className="h-32 w-full" /> : null}
        {(rows.data ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2 text-[11px]">
            <b>{r.title}</b>
            <Badge variant="secondary" className="text-[9px]">مقطع {faNumber(r.degreeLevelId)}</Badge>
            <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{r.effectiveFromYear}{r.effectiveToYear ? `–${r.effectiveToYear}` : '+'}</span>
            <Button size="sm" variant="destructive" className="ms-auto h-6 px-2" onClick={async () => {
              try { await deleteRegulation(r.id); await qc.invalidateQueries({ queryKey: ['regulations'] }); } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' }); }
            }}><Trash2 className="size-3" aria-hidden /></Button>
          </div>
        ))}
      </CardContent></Card>
    </div>
  );
}

// ─── تخصیص کارشناس آموزشی ───

export function AdminEduExpertAssignPage() {
  const data = useQuery({ queryKey: ['edu-expert-assign'], queryFn: getEduExpertInit });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  if (data.isLoading) return <Skeleton className="h-72 w-full" />;
  if (data.isError || !data.data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت اطلاعات تخصیص ناموفق بود.</CardContent></Card>;
  const d = data.data as Record<string, unknown>;
  const classrooms = (d['classrooms'] ?? []) as Record<string, unknown>[];
  const staff = (d['staff'] ?? []) as Record<string, unknown>[];
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-black">🧑‍💼 تخصیص کارشناس آموزشی</h1>
      <Msg msg={msg} />
      <Card><CardContent className="space-y-2 pt-4">
        <h2 className="text-sm font-black">کلاس‌ها و کارشناسان</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-[11px]">
            <thead className="bg-muted/60 text-muted-foreground"><tr>{['کلاس', 'گروه', 'کارشناس فعلی', ''].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead>
            <tbody>
              {classrooms.map((cr, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="p-2 font-bold">{String(cr['name'] ?? '—')}</td>
                  <td className="p-2">{String(cr['department'] ?? '—')}</td>
                  <td className="p-2">{String(cr['expertName'] ?? '—')}</td>
                  <td className="p-2">
                    <select value="" onChange={async (e) => {
                      if (!e.target.value) return;
                      try { await eduExpertSetClassroomDept({ classroomId: cr['id'], staffId: Number(e.target.value) }); await data.refetch(); } catch (err) { setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'خطا' }); }
                    }} className="h-6 rounded border border-input bg-card px-1 text-[10px]">
                      <option value="">تخصیص…</option>
                      {staff.map((s) => <option key={String(s['id'])} value={String(s['id'])}>{String(s['name'])}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {classrooms.length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">کلاسی یافت نشد.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}

// ─── سوئیت برنامه‌ریزی ───

const PHASE_FA: Record<string, string> = {
  DRAFT: 'پیش‌نویس', DEMANDS: 'نیازمندی‌ها', SUPPLY: 'تأمین', SECTIONS: 'گروه‌بندی',
  ROOMS: 'تخصیص فضا', SESSIONS: 'جلسات', PUBLISHED: 'منتشرشده',
};
const PHASES = Object.keys(PHASE_FA);

export function AdminSchedulingPage() {
  const qc = useQueryClient();
  const [termIdStr, setTermIdStr] = useState('');
  const termId = Number(termIdStr) || undefined;
  const dash = useQuery({ queryKey: ['sched-dash', termId], queryFn: () => getSchedDashboard(termId) });
  const health = useQuery({ queryKey: ['sched-health', termId], queryFn: () => getSchedHealth(termId ?? 0), enabled: !!termId });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try { setMsg({ kind: 'ok', text: await fn() }); await qc.invalidateQueries({ queryKey: ['sched-dash', termId] }); } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا' }); } finally { setBusy(false); }
  }

  const phase = String(dash.data?.['phase'] ?? '—');
  const phaseIdx = PHASES.indexOf(phase);

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-cyan-900 via-blue-950 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-black"><Layout className="size-5" aria-hidden /> سوئیت برنامه‌ریزی درسی</h1>
            <p className="mt-1 text-xs text-cyan-100/80">چرخهٔ کامل: نیازمندی‌ها ← تأمین ← گروه‌بندی ← فضا ← جلسات ← انتشار</p>
          </div>
          <Input value={termIdStr} onChange={(e) => setTermIdStr(e.target.value)} placeholder="شناسهٔ ترم" className="h-9 max-w-32 bg-white/10 font-mono text-white placeholder:text-white/50" dir="ltr" />
        </CardContent>
      </Card>

      <Msg msg={msg} />

      <Card><CardContent className="space-y-2 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-black">فاز جاری: {PHASE_FA[phase] ?? phase}</h2>
          <div className="ms-auto flex flex-wrap gap-1">
            {PHASES.map((p, i) => (
              <Button key={p} size="sm" variant={p === phase ? 'default' : 'outline'} className="h-6 px-2 text-[10px]"
                disabled={busy || !termId || i !== phaseIdx + 1}
                onClick={() => void run(async () => {
                  await transitionSchedPhase(termId ?? 0, p);
                  return `فاز به ${PHASE_FA[p]} تغییر کرد.`;
                })}>{PHASE_FA[p]}</Button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={busy || !termId} onClick={() => void run(async () => {
            const r = await allocateRoomQuotas(termId ?? 0);
            return `${faNumber(r.allocated)} سهمیهٔ فضا تخصیص یافت.`;
          })}><CalendarClock className="size-3" aria-hidden /> تخصیص فضاهای آموزشی</Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={busy || !termId} onClick={() => void run(async () => {
            const r = await checkSchedConflicts(termId ?? 0);
            return JSON.stringify(r).slice(0, 200);
          })}><ClipboardCheck className="size-3" aria-hidden /> بررسی تداخل</Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={busy || !termId} onClick={() => void run(async () => {
            const r = await generateSchedSessions({ termId, dryRun: false });
            return `${faNumber(r['generated'] as number)} جلسه تولید شد، ${faNumber(r['skipped'] as number)} رد شد.`;
          })}><GitBranch className="size-3" aria-hidden /> تولید جلسات</Button>
        </div>
      </CardContent></Card>

      {dash.isLoading ? <Skeleton className="h-64 w-full" /> : null}
      {dash.data ? (
        <Card><CardContent className="space-y-2 pt-4">
          <h2 className="text-sm font-black">داشبورد</h2>
          <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted/20 p-2 text-[10px]" dir="ltr">{JSON.stringify(dash.data, null, 1).slice(0, 5000)}</pre>
        </CardContent></Card>
      ) : null}
      {health.data ? (
        <Card><CardContent className="space-y-2 pt-4">
          <h2 className="text-sm font-black">سلامت برنامه‌ریزی</h2>
          <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-muted/20 p-2 text-[10px]" dir="ltr">{JSON.stringify(health.data, null, 1).slice(0, 3000)}</pre>
        </CardContent></Card>
      ) : null}
    </div>
  );
}
