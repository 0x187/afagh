import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  GitBranch,
  Layout,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, toEnDigits } from '@/lib/fa';
import {
  allocateRoomQuotas,
  allocateSections,
  checkSchedConflicts,
  deleteRegulation,
  eduExpertSetClassroomDept,
  generateSchedSessions,
  getEduExpertInit,
  getRegulationCenter,
  getSchedDashboard,
  getSchedHardConflicts,
  getSchedHealth,
  getSchedWorkspace,
  saveRegulation,
  transitionSchedPhase,
  type RegulationDegreeLevel,
  type RegulationRow,
  type SchedHardConflictsData,
  type SchedHealthData,
  type SchedWorkspaceData,
} from '@/lib/scheduling-suite-api';

// ═══ آیین‌نامه‌ها + تخصیص کارشناس + سوئیت برنامه‌ریزی ═══

type MsgState = { kind: 'ok' | 'err'; text: string } | null;

function Msg({ msg }: { msg: MsgState }) {
  if (!msg) return null;
  return <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>{msg.text}</div>;
}

function Stat({ label, value, tone = '' }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card px-3 py-2 ${tone}`}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-black">{typeof value === 'number' ? faNumber(value) : value}</p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap p-2 text-right text-[10px] font-black text-muted-foreground">{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`p-2 align-top text-[11px] ${className}`}>{children}</td>;
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return <tr><td colSpan={colSpan} className="p-4 text-center text-[11px] text-muted-foreground">{children}</td></tr>;
}

// ─── آیین‌نامه‌ها ───

type RegForm = {
  id?: number;
  title: string;
  degreeLevelId: string;
  effectiveFromYear: string;
  effectiveToYear: string;
  rulesConfig: string;
};

const EMPTY_REG_FORM: RegForm = {
  title: '',
  degreeLevelId: '',
  effectiveFromYear: '1404',
  effectiveToYear: '',
  rulesConfig: '',
};

function prettyJSON(value: unknown): string {
  try {
    return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value ?? {}, null, 2);
  } catch {
    return typeof value === 'string' ? value : '{}';
  }
}

function rulesSummary(raw: unknown): string {
  try {
    const cfg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, Record<string, unknown> | undefined> | null;
    const units = cfg?.['regular_term_rules']?.['max_units'];
    const prob = cfg?.['probation_and_tenure']?.['probation_gpa_threshold'];
    const pass = cfg?.['grading_and_gpa']?.['default_passing_grade'];
    const parts: string[] = [];
    if (units != null) parts.push(`حداکثر ${faNumber(Number(units))} واحد`);
    if (prob != null) parts.push(`آستانهٔ مشروطی ${faNumber(Number(prob))}`);
    if (pass != null) parts.push(`کف قبولی ${faNumber(Number(pass))}`);
    return parts.length ? parts.join(' · ') : 'پیکربندی سفارشی';
  } catch {
    return 'پیکربندی JSON';
  }
}

function degreeTitle(levels: RegulationDegreeLevel[], id: number): string {
  return levels.find((l) => l.id === id)?.title || levels.find((l) => l.id === id)?.levelName || `مقطع ${id}`;
}

export function AdminRegulationsPage() {
  const qc = useQueryClient();
  const center = useQuery({ queryKey: ['regulations'], queryFn: getRegulationCenter });
  const [msg, setMsg] = useState<MsgState>(null);
  const [form, setForm] = useState<RegForm>(EMPTY_REG_FORM);

  const rows = center.data?.regulations ?? [];
  const levels = center.data?.degreeLevels ?? [];
  const presets = center.data?.presets ?? {};
  const presetKeys = Object.keys(presets);
  const degreeValue = form.degreeLevelId || String(levels[0]?.id ?? '');

  const save = useMutation({
    mutationFn: () => {
      let cfg: unknown;
      try {
        cfg = JSON.parse(form.rulesConfig.trim() || '{}');
      } catch {
        throw new Error('rulesConfig معتبر نیست؛ JSON را بررسی کنید.');
      }
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
        throw new Error('rulesConfig باید یک شیء JSON باشد.');
      }
      const degreeLevelId = Number(toEnDigits(degreeValue));
      if (!degreeLevelId) throw new Error('مقطع تحصیلی را انتخاب کنید.');
      return saveRegulation({
        id: form.id,
        title: form.title.trim(),
        degreeLevelId,
        effectiveFromYear: Number(toEnDigits(form.effectiveFromYear)),
        effectiveToYear: form.effectiveToYear.trim() ? Number(toEnDigits(form.effectiveToYear)) : null,
        rulesConfig: cfg as Record<string, unknown>,
      });
    },
    onSuccess: async () => {
      setMsg({ kind: 'ok', text: form.id ? 'آیین‌نامه به‌روزرسانی شد.' : 'آیین‌نامهٔ جدید ذخیره شد.' });
      setForm({ ...EMPTY_REG_FORM, degreeLevelId: degreeValue });
      await qc.invalidateQueries({ queryKey: ['regulations'] });
    },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  const startEdit = (r: RegulationRow) => {
    setMsg(null);
    setForm({
      id: r.id,
      title: r.title,
      degreeLevelId: String(r.degreeLevelId),
      effectiveFromYear: String(r.effectiveFromYear),
      effectiveToYear: r.effectiveToYear == null ? '' : String(r.effectiveToYear),
      rulesConfig: prettyJSON(r.rulesConfig),
    });
    window.setTimeout(() => document.getElementById('reg-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const remove = async (id: number) => {
    if (!window.confirm('این آیین‌نامه حذف شود؟ این عمل قابل بازگشت نیست.')) return;
    try {
      await deleteRegulation(id);
      if (form.id === id) setForm({ ...EMPTY_REG_FORM, degreeLevelId: degreeValue });
      setMsg({ kind: 'ok', text: 'آیین‌نامه حذف شد.' });
      await qc.invalidateQueries({ queryKey: ['regulations'] });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا در حذف آیین‌نامه.' });
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-amber-900 via-orange-900 to-rose-900 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-lg font-black">⚖️ مرکز مدیریت آیین‌نامه‌ها</h1>
          <p className="mt-1 text-xs text-amber-100/85">قواعد واحد، مشروطی، سنوات و نمره — نسخه‌بندی‌شده بر اساس سال اعتبار و مقطع.</p>
        </CardContent>
      </Card>

      <Msg msg={msg} />

      <Card id="reg-form">
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-black">{form.id ? `ویرایش آیین‌نامه #${faNumber(form.id)}` : 'آیین‌نامهٔ جدید'}</h2>
            {form.id ? (
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setForm({ ...EMPTY_REG_FORM, degreeLevelId: degreeValue })}>
                انصراف از ویرایش
              </Button>
            ) : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-[10px] font-bold text-muted-foreground">
              عنوان *
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="مثلاً آیین‌نامهٔ کارشناسی ۱۴۰۴" className="h-8 text-[11px]" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-bold text-muted-foreground">
              مقطع تحصیلی *
              <select value={degreeValue} onChange={(e) => setForm({ ...form, degreeLevelId: e.target.value })} className="h-8 rounded-lg border border-input bg-card px-2 text-[11px]">
                {levels.length === 0 ? <option value="">—</option> : null}
                {levels.map((l) => <option key={l.id} value={l.id}>{l.title || l.levelName}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-bold text-muted-foreground">
              سال شروع اعتبار *
              <Input value={form.effectiveFromYear} onChange={(e) => setForm({ ...form, effectiveFromYear: e.target.value })} className="h-8 font-mono text-[11px]" dir="ltr" inputMode="numeric" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-bold text-muted-foreground">
              سال پایان (خالی = بدون پایان)
              <Input value={form.effectiveToYear} onChange={(e) => setForm({ ...form, effectiveToYear: e.target.value })} className="h-8 font-mono text-[11px]" dir="ltr" inputMode="numeric" />
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-[10px] font-bold text-muted-foreground">
              الگوی آماده (پریست وزارتی)
              <select
                value=""
                onChange={(e) => {
                  const key = e.target.value;
                  if (!key) return;
                  setForm((prev) => ({ ...prev, rulesConfig: prettyJSON(presets[key]) }));
                }}
                className="h-8 rounded-lg border border-input bg-card px-2 text-[11px]"
              >
                <option value="">— انتخاب الگو —</option>
                {presetKeys.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-[11px]"
              onClick={() => setForm((prev) => ({ ...prev, rulesConfig: prettyJSON(presets[presetKeys[0]] ?? {}) }))}
              disabled={presetKeys.length === 0}
            >
              درج الگوی پیش‌فرض
            </Button>
            <Button size="sm" className="h-8 text-[11px]" disabled={save.isPending || !form.title.trim()} onClick={() => save.mutate()}>
              {save.isPending ? 'در حال ذخیره…' : form.id ? 'به‌روزرسانی' : 'ذخیرهٔ آیین‌نامه'}
            </Button>
          </div>

          <label className="block space-y-1 text-[10px] font-bold text-muted-foreground">
            <span>rulesConfig — پیکربندی کامل (JSON)</span>
            <textarea
              value={form.rulesConfig}
              onChange={(e) => setForm({ ...form, rulesConfig: e.target.value })}
              rows={10}
              dir="ltr"
              spellCheck={false}
              placeholder='{"regular_term_rules":{"min_units":12,"max_units":20}}'
              className="w-full rounded-lg border border-input bg-card px-2 py-1.5 font-mono text-[10px]"
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <h2 className="text-sm font-black">آیین‌نامه‌های ثبت‌شده ({faNumber(rows.length)})</h2>
          {center.isLoading ? <Skeleton className="h-32 w-full" /> : null}
          {center.isError ? <p className="text-xs text-destructive">دریافت آیین‌نامه‌ها ناموفق بود.</p> : null}
          {!center.isLoading && rows.length === 0 ? <p className="text-xs text-muted-foreground">هنوز آیین‌نامه‌ای ثبت نشده است.</p> : null}
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card p-2.5 text-[11px]">
                <div className="min-w-40 flex-1">
                  <p className="font-black">{r.title}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{rulesSummary(r.rulesConfig)}</p>
                </div>
                <Badge variant="secondary" className="text-[9px]">{degreeTitle(levels, r.degreeLevelId)}</Badge>
                <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                  {r.effectiveFromYear}{r.effectiveToYear ? `–${r.effectiveToYear}` : '+'}
                </span>
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => startEdit(r)}>
                  <Pencil className="size-3" aria-hidden /> ویرایش
                </Button>
                <Button size="sm" variant="destructive" className="h-6 px-2" onClick={() => void remove(r.id)}>
                  <Trash2 className="size-3" aria-hidden /> حذف
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── تخصیص کارشناس آموزشی ───

export function AdminEduExpertAssignPage() {
  const data = useQuery({ queryKey: ['edu-expert-assign'], queryFn: getEduExpertInit });
  const [msg, setMsg] = useState<MsgState>(null);
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
              {classrooms.length === 0 ? <EmptyRow colSpan={4}>کلاسی یافت نشد.</EmptyRow> : null}
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

const CONFLICT_FA: Record<string, string> = {
  ROOM_OVERLAP: 'تداخل سالن',
  PROFESSOR_OVERLAP: 'تداخل استاد',
  CAPACITY_OVERFLOW: 'سرریز ظرفیت',
};

type SchedTab = 'DEMANDS' | 'APPROVED' | 'SESSIONS' | 'HEALTH' | 'CONFLICTS' | 'ACTIONS';

export function AdminSchedulingPage() {
  const qc = useQueryClient();
  const [termId, setTermId] = useState<number | null>(null);
  const [tab, setTab] = useState<SchedTab>('DEMANDS');
  const [q, setQ] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [deptId, setDeptId] = useState('');
  const [msg, setMsg] = useState<MsgState>(null);
  const [busy, setBusy] = useState(false);

  const dash = useQuery({ queryKey: ['sched-dash', termId], queryFn: () => getSchedDashboard(termId ?? undefined) });
  useEffect(() => {
    if (termId == null && dash.data?.activeTermId) setTermId(dash.data.activeTermId);
  }, [dash.data, termId]);

  const ws = useQuery({ queryKey: ['sched-ws', termId], queryFn: () => getSchedWorkspace(termId ?? undefined), enabled: !!termId });
  const health = useQuery({ queryKey: ['sched-health', termId], queryFn: () => getSchedHealth(termId ?? 0), enabled: !!termId });
  const hard = useQuery({ queryKey: ['sched-hard', termId], queryFn: () => getSchedHardConflicts(termId ?? 0), enabled: !!termId });

  const workspace: SchedWorkspaceData | undefined = ws.data;
  const phase = dash.data?.phase ?? workspace?.phases?.[String(termId)] ?? '—';
  const phaseIdx = PHASES.indexOf(phase);
  const conflictCount = hard.data?.report?.Total ?? workspace?.hardConflictCount ?? 0;

  const profName = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of workspace?.professors ?? []) map.set(p.id, p.name);
    return (id: number | null) => (id == null ? '—' : (map.get(id) ?? `#${id}`));
  }, [workspace]);

  const demands = useMemo(() => {
    const needle = toEnDigits(q.trim().toLowerCase());
    return (workspace?.demands ?? []).filter((d) => {
      if (programFilter && d.programTitle !== programFilter) return false;
      if (!needle) return true;
      const hay = toEnDigits(`${d.code} ${d.title} ${profName(d.professorId)} ${d.programTitle} ${d.cohortTitle}`.toLowerCase());
      return hay.includes(needle);
    });
  }, [workspace, q, programFilter, profName]);

  const programOptions = useMemo(
    () => [...new Set((workspace?.demands ?? []).map((d) => d.programTitle).filter(Boolean))],
    [workspace],
  );

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      setMsg({ kind: 'ok', text });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['sched-dash'] }),
        qc.invalidateQueries({ queryKey: ['sched-ws'] }),
        qc.invalidateQueries({ queryKey: ['sched-health'] }),
        qc.invalidateQueries({ queryKey: ['sched-hard'] }),
      ]);
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطا در اجرای عملیات.' });
    } finally {
      setBusy(false);
    }
  }

  const tabButton = (key: SchedTab, label: string, count?: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setTab(key)}
      className={`rounded-xl px-3 py-1.5 text-[11px] font-black transition ${tab === key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
    >
      {label}{count != null ? ` (${faNumber(count)})` : ''}
    </button>
  );

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-cyan-900 via-blue-950 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-black"><Layout className="size-5" aria-hidden /> سوئیت برنامه‌ریزی درسی</h1>
            <p className="mt-1 text-xs text-cyan-100/80">چرخهٔ کامل: نیازمندی‌ها ← تأمین ← گروه‌بندی ← فضا ← جلسات ← انتشار</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={termId ?? ''}
              onChange={(e) => { setTermId(Number(e.target.value) || null); setMsg(null); }}
              className="h-9 rounded-lg border border-white/25 bg-white/10 px-2 text-xs font-bold text-white"
            >
              <option value="" className="text-slate-900">— نیمسال —</option>
              {(dash.data?.terms ?? []).map((t) => (
                <option key={t.id} value={t.id} className="text-slate-900">{t.title}{t.isCurrent ? ' (جاری)' : ''}</option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 border-white/25 bg-white/10 text-[11px] text-white hover:bg-white/20"
              disabled={busy}
              onClick={() => void run(async () => { await qc.invalidateQueries(); return 'همهٔ داده‌ها تازه‌سازی شد.'; })}
            >
              <RefreshCw className="size-3.5" aria-hidden /> تازه‌سازی
            </Button>
          </div>
        </CardContent>
      </Card>

      <Msg msg={msg} />

      {!termId ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{dash.isLoading ? 'در حال دریافت نیمسال‌ها…' : 'نیمسالی برای برنامه‌ریزی یافت نشد.'}</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="نیازمندی‌ها" value={workspace?.demands.length ?? 0} />
            <Stat label="کلاس‌های مصوب" value={workspace?.approvedOfferings.length ?? 0} />
            <Stat label="جلسات تولیدشده" value={workspace?.sessionsTotal ?? 0} />
            <Stat label="تداخل سخت" value={conflictCount} tone={conflictCount > 0 ? 'border-destructive/40 text-destructive' : ''} />
            <Stat label="کلاس‌های تعریف‌شده" value={workspace?.classrooms.length ?? 0} />
            <Stat label="فضاهای تخصیص‌یافته" value={workspace?.allocatedRoomIds.length ?? 0} />
          </div>

          <Card>
            <CardContent className="space-y-3 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-black">فاز جاری: {PHASE_FA[phase] ?? phase}</span>
                <div className="ms-auto flex flex-wrap gap-1">
                  {PHASES.map((p, i) => (
                    <Button
                      key={p}
                      size="sm"
                      variant={p === phase ? 'default' : 'outline'}
                      className="h-6 px-2 text-[10px]"
                      disabled={busy || !termId || i !== phaseIdx + 1}
                      onClick={() => void run(async () => {
                        await transitionSchedPhase(termId ?? 0, p);
                        return `فاز به «${PHASE_FA[p]}» تغییر کرد.`;
                      })}
                    >
                      {PHASE_FA[p]}
                    </Button>
                  ))}
                </div>
              </div>
              {workspace?.termCalendar ? (
                <p className="text-[11px] text-muted-foreground">
                  تقویم ترم: <b>{faDigits(workspace.termCalendar.startJalali)}</b> تا <b>{faDigits(workspace.termCalendar.endJalali)}</b>
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-4">
              <div className="flex flex-wrap items-center gap-1 border-b border-border/60 pb-2">
                {tabButton('DEMANDS', 'نیازمندی‌ها', workspace?.demands.length)}
                {tabButton('APPROVED', 'کلاس‌های مصوب', workspace?.approvedOfferings.length)}
                {tabButton('SESSIONS', 'جلسات و تقویم', workspace?.sessionsTotal)}
                {tabButton('HEALTH', 'سلامت برنامه')}
                {tabButton('CONFLICTS', 'تداخل‌ها', conflictCount)}
                {tabButton('ACTIONS', 'اقدامات')}
              </div>

              {ws.isLoading ? <Skeleton className="h-48 w-full" /> : null}

              {tab === 'DEMANDS' ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو: کد، درس، استاد…" className="h-8 max-w-64 text-[11px]" />
                    <select value={programFilter} onChange={(e) => setProgramFilter(e.target.value)} className="h-8 rounded-lg border border-input bg-card px-2 text-[11px]">
                      <option value="">همهٔ برنامه‌ها</option>
                      {programOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <span className="text-[10px] text-muted-foreground">نمایش {faNumber(demands.length)} از {faNumber(workspace?.demands.length ?? 0)}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-right">
                      <thead className="bg-muted/60"><tr><Th>کد</Th><Th>درس</Th><Th>واحد</Th><Th>نوع</Th><Th>گروه</Th><Th>ظرفیت</Th><Th>ثبت‌نام</Th><Th>استاد</Th><Th>برنامه / ورودی</Th><Th>وضعیت</Th></tr></thead>
                      <tbody>
                        {demands.map((d) => (
                          <tr key={d.offeringId} className="border-t border-border/50">
                            <Td className="font-mono">{d.code}</Td>
                            <Td className="font-bold">{d.title}</Td>
                            <Td>{faDigits(d.units)}</Td>
                            <Td>{d.courseType || '—'}</Td>
                            <Td>{faNumber(d.groupNumber)}</Td>
                            <Td>{faNumber(d.capacity)}</Td>
                            <Td>{faNumber(d.enrolledCount)}</Td>
                            <Td>{profName(d.professorId)}</Td>
                            <Td className="text-[10px]">{d.programTitle} / {d.cohortTitle}</Td>
                            <Td>
                              <span className="flex flex-wrap gap-1">
                                {d.isSharedService ? <Badge variant="warning" className="text-[9px]">مشترک</Badge> : null}
                                {d.isCoTaught ? <Badge variant="secondary" className="text-[9px]">هم‌تدریس</Badge> : null}
                                {d.professorId == null ? <Badge variant="destructive" className="text-[9px]">بدون استاد</Badge> : null}
                              </span>
                            </Td>
                          </tr>
                        ))}
                        {demands.length === 0 ? <EmptyRow colSpan={10}>نیازمندی‌ای با این فیلترها یافت نشد.</EmptyRow> : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {tab === 'APPROVED' ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right">
                    <thead className="bg-muted/60"><tr><Th>کد</Th><Th>درس</Th><Th>گروه</Th><Th>استاد</Th><Th>روز</Th><Th>ساعت</Th><Th>کلاس</Th><Th>ظرفیت / ثبت‌نام</Th></tr></thead>
                    <tbody>
                      {(workspace?.approvedOfferings ?? []).map((o) => (
                        <tr key={o.offeringId} className="border-t border-border/50">
                          <Td className="font-mono">{o.code}</Td>
                          <Td className="font-bold">{o.title}</Td>
                          <Td>{faNumber(o.groupNumber)}</Td>
                          <Td>{o.professorName || profName(o.professorId)}</Td>
                          <Td>{o.dayName}</Td>
                          <Td className="font-mono text-[10px]">{o.startTime}–{o.endTime}</Td>
                          <Td>{o.roomName}{o.buildingName ? ` (${o.buildingName})` : ''}</Td>
                          <Td>{faNumber(o.capacity)} / {faNumber(o.enrolledCount)}</Td>
                        </tr>
                      ))}
                      {(workspace?.approvedOfferings ?? []).length === 0 ? <EmptyRow colSpan={8}>هنوز کلاس مصوبی ثبت نشده است.</EmptyRow> : null}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {tab === 'SESSIONS' ? (
                <div className="space-y-3">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-right">
                      <thead className="bg-muted/60"><tr><Th>کد</Th><Th>درس</Th><Th>جلسات تولیدشده</Th><Th>جلسات جبرانی</Th><Th>اولین جلسه</Th></tr></thead>
                      <tbody>
                        {(workspace?.approvedOfferings ?? []).map((o) => {
                          const s = workspace?.sessionsByOffering?.[String(o.offeringId)];
                          return (
                            <tr key={o.offeringId} className="border-t border-border/50">
                              <Td className="font-mono">{o.code}</Td>
                              <Td className="font-bold">{o.title}</Td>
                              <Td>{s ? faNumber(s.total) : '۰'}</Td>
                              <Td>{s ? faNumber(s.makeup) : '۰'}</Td>
                              <Td className="font-mono text-[10px]">{s?.firstDate ? faDigits(s.firstDate) : '—'}</Td>
                            </tr>
                          );
                        })}
                        {(workspace?.approvedOfferings ?? []).length === 0 ? <EmptyRow colSpan={5}>کلاس مصوبی برای نمایش جلسات نیست.</EmptyRow> : null}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <h3 className="mb-1 text-xs font-black">جلسات جبرانی ({faNumber(workspace?.makeupSessions.length ?? 0)})</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-right">
                        <thead className="bg-muted/60"><tr><Th>درس</Th><Th>استاد</Th><Th>جلسه</Th><Th>تاریخ</Th><Th>ساعت</Th><Th>جایگزین</Th></tr></thead>
                        <tbody>
                          {(workspace?.makeupSessions ?? []).map((m) => (
                            <tr key={m.id} className="border-t border-border/50">
                              <Td className="font-bold">{m.courseTitle}</Td>
                              <Td>{m.profName}</Td>
                              <Td>{faNumber(m.sessionNo)}</Td>
                              <Td className="font-mono text-[10px]">{faDigits(m.sessionDate)}</Td>
                              <Td className="font-mono text-[10px]">{m.sessionTime}</Td>
                              <Td>{m.replacedSessionId == null ? '—' : faNumber(m.replacedSessionId)}</Td>
                            </tr>
                          ))}
                          {(workspace?.makeupSessions ?? []).length === 0 ? <EmptyRow colSpan={6}>جلسهٔ جبرانی ثبت نشده است.</EmptyRow> : null}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === 'HEALTH' ? <HealthPanel health={health.data} loading={health.isLoading} /> : null}

              {tab === 'CONFLICTS' ? <ConflictsPanel data={hard.data} loading={hard.isLoading} /> : null}

              {tab === 'ACTIONS' ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={busy || !termId} onClick={() => void run(async () => {
                      const r = await allocateRoomQuotas(termId ?? 0);
                      return `${faNumber(r.allocated)} سهمیهٔ فضا تخصیص یافت.`;
                    })}><CalendarClock className="size-3" aria-hidden /> تخصیص فضاهای آموزشی</Button>
                    <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={busy || !termId} onClick={() => void run(async () => {
                      const r = await checkSchedConflicts(termId ?? 0);
                      const count = typeof r['count'] === 'number' ? ` — ${faNumber(r['count'] as number)} مورد` : '';
                      return `بررسی تداخل انجام شد${count}.`;
                    })}><ClipboardCheck className="size-3" aria-hidden /> بررسی تداخل</Button>
                    <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={busy || !termId} onClick={() => void run(async () => {
                      const r = await generateSchedSessions({ termId, dryRun: false });
                      return `${faNumber(Number(r['generated'] ?? 0))} جلسه تولید شد، ${faNumber(Number(r['skipped'] ?? 0))} رد شد.`;
                    })}><GitBranch className="size-3" aria-hidden /> تولید جلسات</Button>
                  </div>
                  <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border/70 bg-muted/20 p-3">
                    <label className="flex min-w-48 flex-col gap-1 text-[10px] font-bold text-muted-foreground">
                      گروه‌بندی خودکار برای گروه آموزشی
                      <select value={deptId} onChange={(e) => setDeptId(e.target.value)} className="h-8 rounded-lg border border-input bg-card px-2 text-[11px]">
                        <option value="">— انتخاب گروه —</option>
                        {(workspace?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </label>
                    <Button
                      size="sm"
                      className="h-8 text-[10px]"
                      disabled={busy || !termId || !deptId}
                      onClick={() => void run(async () => {
                        const ids = (workspace?.demands ?? []).filter((d) => String(d.courseDeptId ?? '') === deptId).map((d) => d.offeringId);
                        if (ids.length === 0) throw new Error('برای این گروه درسی نیازمندی‌ای ثبت نشده است.');
                        const r = await allocateSections({ termId: termId ?? 0, departmentId: Number(deptId), offeringIds: ids });
                        return `${faNumber(r.allocated)} ارائه گروه‌بندی شد.`;
                      })}
                    >
                      گروه‌بندی ارائه‌ها ({faNumber((workspace?.demands ?? []).filter((d) => String(d.courseDeptId ?? '') === deptId).length)})
                    </Button>
                    <p className="text-[10px] text-muted-foreground">پس از گروه‌بندی، فضا و جلسات را مرحله‌به‌مرحله تخصیص دهید. هر اقدام در زنجیرهٔ حسابرسی ثبت می‌شود.</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                    <Badge variant="outline">دانشکده‌ها: {faNumber(workspace?.departments.length ?? 0)}</Badge>
                    <Badge variant="outline">استادان: {faNumber(workspace?.professors.length ?? 0)}</Badge>
                    <Badge variant="outline">بازه‌های حضور: {faNumber(workspace?.availabilities.length ?? 0)}</Badge>
                    <Badge variant="outline">ورودی‌ها: {faNumber(workspace?.cohorts.length ?? 0)}</Badge>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function HealthPanel({ health, loading }: { health?: SchedHealthData; loading: boolean }) {
  if (loading) return <Skeleton className="h-48 w-full" />;
  if (!health) return <p className="text-xs text-muted-foreground">گزارش سلامت در دسترس نیست.</p>;
  const sections: Array<[string, number]> = [
    ['تداخل پنهان استاد/مکان', health.hiddenConflicts.length],
    ['عرضه در برابر تقاضا', health.supplyVsDemand.length],
    ['کلاس مشترک بدون تخصیص', health.unallocatedShared.length],
    ['بهره‌وری سالن‌ها', health.roomShiftUsage.length],
    ['شیفت آزادشدهٔ مصرف‌نشده', health.releasedUnused.length],
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {sections.map(([label, count]) => (
          <Badge key={label} variant={count > 0 ? 'warning' : 'success'} className="text-[9px]">{label}: {faNumber(count)}</Badge>
        ))}
      </div>
      <ul className="space-y-1 rounded-xl border border-border/60 bg-muted/20 p-3 text-[11px] leading-6">
        {health.lines.map((line, i) => <li key={i}>{line}</li>)}
      </ul>

      {health.hiddenConflicts.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right">
            <thead className="bg-muted/60"><tr><Th>نوع</Th><Th>روز</Th><Th>ساعت</Th><Th>ارائه‌ها</Th></tr></thead>
            <tbody>
              {health.hiddenConflicts.map((c, i) => (
                <tr key={i} className="border-t border-border/50">
                  <Td>{CONFLICT_FA[c.kind] ?? c.kind}</Td>
                  <Td>{faNumber(c.dayOfWeek + 1)}</Td>
                  <Td className="font-mono text-[10px]">{c.startTime}–{c.endTime}</Td>
                  <Td className="font-mono text-[10px]">{c.a} / {c.b}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {health.supplyVsDemand.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right">
            <thead className="bg-muted/60"><tr><Th>درس</Th><Th>گروه‌های تأمین‌شده</Th><Th>گروه پیشنهادی</Th><Th>کمبود</Th><Th>دانشجوی واجد</Th></tr></thead>
            <tbody>
              {health.supplyVsDemand.map((r) => (
                <tr key={r.courseId} className="border-t border-border/50">
                  <Td className="font-bold">{r.title}</Td>
                  <Td>{faNumber(r.suppliedGroups)}</Td>
                  <Td>{faNumber(r.suggestedGroups)}</Td>
                  <Td className={r.gap > 0 ? 'font-black text-destructive' : ''}>{faNumber(r.gap)}</Td>
                  <Td>{faNumber(r.eligibleStudents)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {health.roomShiftUsage.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right">
            <thead className="bg-muted/60"><tr><Th>سالن</Th><Th>شیفت</Th><Th>دقیقهٔ اشغال</Th><Th>بهره‌وری</Th></tr></thead>
            <tbody>
              {health.roomShiftUsage.map((r, i) => (
                <tr key={`${r.classroomId}-${r.shift}-${i}`} className="border-t border-border/50">
                  <Td className="font-bold">{r.classroomName}</Td>
                  <Td>{r.shift}</Td>
                  <Td>{faNumber(r.occupiedMinutes)}</Td>
                  <Td>{faNumber(Math.round(r.utilization * 100))}٪</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {health.unallocatedShared.length > 0 ? (
        <p className="text-[11px] text-warning">
          کلاس‌های مشترک بدون تخصیص: {health.unallocatedShared.map((u) => `#${u.offeringId} (گروه ${faNumber(u.groupNumber)})`).join('، ')}
        </p>
      ) : null}
      {health.releasedUnused.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          شیفت‌های آزادشده: {health.releasedUnused.map((r) => `سالن ${faNumber(r.classroomId)}/${r.shift}`).join('، ')}
        </p>
      ) : null}
    </div>
  );
}

function ConflictsPanel({ data, loading }: { data?: SchedHardConflictsData; loading: boolean }) {
  if (loading) return <Skeleton className="h-32 w-full" />;
  const conflicts = data?.report?.Conflicts ?? [];
  if (conflicts.length === 0) {
    return <div className="rounded-xl border border-success/30 bg-success/10 p-3 text-xs font-bold text-success">✅ تداخل سختی در برنامه یافت نشد.</div>;
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Badge variant="destructive" className="text-[9px]">{faNumber(data?.report?.Total ?? conflicts.length)} تداخل</Badge>
        {data?.report?.Truncated ? <span className="text-[10px] text-muted-foreground">فهرست کوتاه شده است.</span> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-right">
          <thead className="bg-muted/60"><tr><Th>نوع</Th><Th>پیام</Th><Th>ارائه‌ها</Th></tr></thead>
          <tbody>
            {conflicts.map((c, i) => (
              <tr key={i} className="border-t border-border/50">
                <Td><span className="flex items-center gap-1 font-bold text-destructive"><AlertTriangle className="size-3" aria-hidden />{CONFLICT_FA[c.Kind] ?? c.Kind}</span></Td>
                <Td>{c.Message}</Td>
                <Td className="font-mono text-[10px]">{c.OfferingIDs.join('، ')}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
