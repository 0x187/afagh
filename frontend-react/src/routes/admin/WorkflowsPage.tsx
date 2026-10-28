import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, ArrowUpCircle, Check, CornerDownLeft, GitBranch, RotateCcw, Timer, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  advanceWorkflowStep,
  clearCheckpoint,
  getWorkflowEvents,
  getWorkflows,
  retryWorkflowEvents,
  runSlaCheck,
  saveProcess,
  type WfInboxItem,
  type WfProcess,
} from '@/lib/workflow-api';

// ═══ کارتابل گردش کار — پورت admin/workflows ═══

const STATUS_FA: Record<string, string> = {
  SUBMITTED: 'ثبت‌شده', IN_REVIEW: 'در بررسی', RETURNED: 'بازگشت برای اصلاح',
  APPROVED: 'تأیید نهایی', REJECTED: 'ردّ نهایی', CANCELLED: 'لغو',
};

const STATUS_BADGE: Record<string, string> = {
  SUBMITTED: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  IN_REVIEW: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  RETURNED: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  REJECTED: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
};

const LEVEL_FA: Record<string, { label: string; cls: string }> = {
  NORMAL: { label: 'عادی', cls: 'text-emerald-700 dark:text-emerald-300' },
  WARNING: { label: 'هشدار', cls: 'text-amber-700 dark:text-amber-300' },
  BOTTLENECK: { label: 'گلوگاه', cls: 'text-rose-700 dark:text-rose-300' },
};

const EVENT_STATUS_FA: Record<string, string> = { PENDING: 'در انتظار', PROCESSED: 'اجراشده', FAILED: 'ناموفق', SKIPPED: 'بدون هندلر' };

export function AdminWorkflowsPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ['workflows'], queryFn: getWorkflows, staleTime: 10_000 });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['workflows'] });
  const slaMut = useMutation({
    mutationFn: runSlaCheck,
    onSuccess: (r) => {
      setMsg(r.count > 0 ? `${faNumber(r.count)} پروندهٔ منقضی به‌صورت خودکار اقدام شد.` : 'هیچ پروندهٔ منقضی‌ای یافت نشد.');
      refresh();
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const retryMut = useMutation({
    mutationFn: () => retryWorkflowEvents(50),
    onSuccess: (r) => { setMsg(`اجرای دوباره: ${faNumber(r.retried)} رویداد — موفق ${faNumber(r.ok)}، ناموفق ${faNumber(r.failed)}.`); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت کارتابل گردش کار ناموفق بود.</CardContent></Card>;

  const s = data.analytics.summary;
  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-indigo-800 via-slate-800 to-slate-900 text-white">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="flex items-center gap-2 text-base font-black"><GitBranch className="size-5" aria-hidden /> کارتابل گردش کار</h1>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="bg-white/15 hover:bg-white/25 text-white" disabled={slaMut.isPending} onClick={() => slaMut.mutate()}>
                <AlarmClock className="size-4" aria-hidden /> پویش مهلت‌ها (SLA)
              </Button>
              <Button size="sm" className="bg-white/15 hover:bg-white/25 text-white" disabled={retryMut.isPending} onClick={() => retryMut.mutate()}>
                <RotateCcw className="size-4" aria-hidden /> اجرای دوبارهٔ رویدادها
              </Button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ['کل درخواست‌ها', faNumber(s.totalRequests)],
              ['در جریان', faNumber(s.activeRequests)],
              ['تأییدشده', faNumber(s.approvedRequests)],
              ['رد/بازگشت', faNumber(s.rejectedRequests)],
              ['نرخ بازگشت', `${faNumber(s.bounceRatePercent)}٪`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/10 px-3 py-2">
                <div className="text-[10px] text-indigo-100/80">{k}</div>
                <div className="mt-0.5 font-mono text-sm font-black">{v}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">کارتابل درخواست‌ها</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                  <th className="p-2">رهگیری</th><th className="p-2">دانشجو</th><th className="p-2">فرایند</th>
                  <th className="p-2">مرحلهٔ جاری</th><th className="p-2 text-center">SLA</th><th className="p-2">وضعیت</th><th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.inbox.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">درخواستی در کارتابل نیست.</td></tr>
                ) : data.inbox.map((r) => <InboxRow key={r.id} item={r} onMsg={setMsg} onDone={refresh} />)}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">صف بخش‌ها</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {data.analytics.departmentQueues.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">صفی ثبت نشده است.</p> : data.analytics.departmentQueues.map((q) => (
              <div key={q.roleCode} className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-[11px]">
                <span className="font-bold">{q.roleTitleFa}</span>
                <span className="text-muted-foreground">در انتظار: <b className="font-mono text-foreground">{faNumber(q.pendingCount)}</b> · قدیمی‌ترین: <b className="font-mono">{faNumber(q.oldestPendingHours)}</b> ساعت</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Timer className="size-4" aria-hidden /> نقشهٔ حرارتی مراحل — گلوگاه‌ها</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-[11px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="p-1.5">فرایند</th><th className="p-1.5">مرحله</th><th className="p-1.5">نقش</th>
                <th className="p-1.5 text-center">SLA هدف</th><th className="p-1.5 text-center">میانگین توقف</th>
                <th className="p-1.5 text-center">در انتظار</th><th className="p-1.5 text-center">نقض SLA</th><th className="p-1.5 text-center">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {data.analytics.heatmap.length === 0 ? (
                <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">مرحله‌ای ثبت نشده است.</td></tr>
              ) : data.analytics.heatmap.map((h) => {
                const lv = LEVEL_FA[h.statusLevel] ?? LEVEL_FA.NORMAL;
                return (
                  <tr key={h.stepId} className="border-b border-border/40 last:border-0">
                    <td className="p-1.5">{h.processTitle}</td>
                    <td className="p-1.5 font-semibold">{h.stepTitle}</td>
                    <td className="p-1.5">{h.roleCode}</td>
                    <td className="p-1.5 text-center font-mono">{faNumber(h.targetSlaHours)}</td>
                    <td className="p-1.5 text-center font-mono">{faNumber(h.avgDurationHours)}</td>
                    <td className="p-1.5 text-center font-mono">{faNumber(h.pendingCount)}</td>
                    <td className="p-1.5 text-center font-mono">{faNumber(h.breachCount)}</td>
                    <td className={`p-1.5 text-center font-bold ${lv.cls}`}>{lv.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <ProcessDesigner processes={data.processes} onMsg={setMsg} onDone={refresh} />
    </div>
  );
}

function InboxRow({ item, onMsg, onDone }: { item: WfInboxItem; onMsg: (m: string) => void; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const { data: events } = useQuery({
    queryKey: ['wf-events', item.id],
    queryFn: () => getWorkflowEvents(item.id),
    enabled: open,
  });
  const act = useMutation({
    mutationFn: (action: 'APPROVE' | 'REJECT' | 'RETURN_FOR_REVISION' | 'ESCALATE') => advanceWorkflowStep(item.id, action, note || undefined),
    onSuccess: (r) => {
      const st = r.result.status;
      onMsg(st === 'APPROVED_FINAL' ? `پرونده ${item.trackingCode} نهایی شد (${r.result.certificateNumber}).`
        : st === 'MOVED_TO_NEXT_STEP' ? `به مرحلهٔ «${r.result.nextStepTitle}» ارجاع شد.`
        : st === 'ESCALATED' ? `ارجاع به ${r.result.targetRole}.`
        : st === 'ALREADY_FINAL' ? 'پرونده قبلاً مختومه شده است.' : 'انجام شد.');
      setNote('');
      onDone();
    },
    onError: (e: Error) => onMsg(e.message),
  });
  const cpMut = useMutation({
    mutationFn: (cpId: number) => clearCheckpoint(cpId, 'تسویه از کارتابل'),
    onSuccess: () => { onMsg('چک‌پوینت تسویه شد.'); onDone(); },
    onError: (e: Error) => onMsg(e.message),
  });

  const finished = item.status === 'APPROVED' || item.status === 'REJECTED';
  return (
    <>
      <tr className={`border-b border-border/40 last:border-0 ${open ? 'bg-muted/40' : 'hover:bg-muted/40'}`}>
        <td className="p-2 font-mono text-[10px]" dir="ltr">{item.trackingCode}</td>
        <td className="p-2">
          <button type="button" className="text-right font-bold underline decoration-dotted underline-offset-4" onClick={() => setOpen(!open)}>{item.studentName || '—'}</button>
          <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{faDigits(item.studentCode)}</div>
        </td>
        <td className="p-2">{item.processTitle}</td>
        <td className="p-2">{item.currentStepTitle ?? '—'}{item.currentRoleCode ? <div className="text-[10px] text-muted-foreground">{item.currentRoleCode}</div> : null}</td>
        <td className="p-2 text-center">
          <span className={`font-mono ${item.isBreached ? 'font-black text-rose-600 dark:text-rose-300' : ''}`}>{faNumber(item.hoursElapsed)}</span>
          <span className="text-[10px] text-muted-foreground"> / {faNumber(item.slaHours)}h</span>
        </td>
        <td className="p-2"><Badge className={`border-transparent ${STATUS_BADGE[item.status] ?? ''}`}>{STATUS_FA[item.status] ?? item.status}</Badge></td>
        <td className="p-2">
          {!finished ? (
            <div className="flex gap-1">
              <Button size="sm" className="h-6 bg-emerald-700 px-1.5 text-[10px] text-white hover:bg-emerald-800" disabled={act.isPending} onClick={() => act.mutate('APPROVE')}><Check className="size-3" aria-hidden /> تأیید</Button>
              <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" disabled={act.isPending} onClick={() => act.mutate('ESCALATE')}><ArrowUpCircle className="size-3" aria-hidden /> ارجاع</Button>
            </div>
          ) : <span className="text-[10px] text-muted-foreground">مختومه</span>}
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-border/40 bg-background/60">
          <td colSpan={7} className="p-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold">اقدام</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت (برای ردّ/بازگشت الزامی)" className="h-7 min-w-48 flex-1 text-[11px]" />
                  <Button size="sm" variant="outline" className="h-7 text-[11px] text-amber-700" disabled={act.isPending || !note} onClick={() => act.mutate('RETURN_FOR_REVISION')}><CornerDownLeft className="size-3.5" aria-hidden /> بازگشت</Button>
                  <Button size="sm" variant="outline" className="h-7 text-[11px] text-rose-700" disabled={act.isPending || !note} onClick={() => act.mutate('REJECT')}><X className="size-3.5" aria-hidden /> ردّ</Button>
                </div>
                {item.checkpoints.length > 0 ? (
                  <div className="space-y-1 pt-1">
                    <p className="text-[11px] font-bold">تسویه‌های موازی</p>
                    {item.checkpoints.map((cp) => (
                      <div key={cp.id} className="flex items-center justify-between rounded-lg border border-border px-2 py-1 text-[11px]">
                        <span>{cp.departmentTitle} <span className="text-muted-foreground" dir="ltr">({cp.departmentCode})</span></span>
                        {cp.isCleared ? <Badge className="border-transparent bg-emerald-100 text-emerald-800 text-[10px]">تسویه</Badge> : (
                          <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={cpMut.isPending} onClick={() => cpMut.mutate(cp.id)}>تسویه</Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="pt-1 text-[10px] text-muted-foreground" dir="ltr">
                  <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2">{JSON.stringify(item.formData, null, 1)}</pre>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold">رویدادهای شلیک‌شده</p>
                {(events ?? []).length === 0 ? <p className="text-[11px] text-muted-foreground">رویدادی ثبت نشده است.</p> : (events ?? []).map((ev) => (
                  <div key={ev.id} className="rounded-lg border border-border px-2 py-1 text-[11px]">
                    <span className="font-mono text-[10px]" dir="ltr">{ev.eventCode}</span> · {ev.handler} ·{' '}
                    <span className={ev.status === 'PROCESSED' ? 'text-emerald-700 dark:text-emerald-300' : ev.status === 'FAILED' ? 'text-rose-700 dark:text-rose-300' : ''}>
                      {EVENT_STATUS_FA[ev.status] ?? ev.status}
                    </span>
                    {ev.error ? <span className="text-rose-600 dark:text-rose-300"> — {ev.error}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ProcessDesigner({ processes, onMsg, onDone }: { processes: WfProcess[]; onMsg: (m: string) => void; onDone: () => void }) {
  const [edit, setEdit] = useState<WfProcess | null>(null);
  const [form, setForm] = useState({ code: '', title: '', category: 'عمومی', description: '', feeAmount: 0 });
  const [steps, setSteps] = useState<{ stepOrder: number; title: string; roleCode: string; slaHours: number; timeoutAction: string }[]>([]);
  const [open, setOpen] = useState(false);

  const startNew = () => {
    setEdit(null);
    setForm({ code: '', title: '', category: 'عمومی', description: '', feeAmount: 0 });
    setSteps([{ stepOrder: 1, title: 'بررسی کارشناس', roleCode: 'EDU_EXPERT', slaHours: 48, timeoutAction: 'ESCALATE' }]);
    setOpen(true);
  };
  const startEdit = (p: WfProcess) => {
    setEdit(p);
    setForm({ code: p.code, title: p.title, category: p.category, description: p.description, feeAmount: p.feeAmount });
    setSteps(p.steps.map((s) => ({ stepOrder: s.stepOrder, title: s.title, roleCode: s.roleCode, slaHours: s.slaHours, timeoutAction: s.timeoutAction })));
    setOpen(true);
  };
  const saveMut = useMutation({
    mutationFn: () => saveProcess({
      id: edit?.id,
      code: form.code,
      title: form.title,
      category: form.category,
      description: form.description,
      feeAmount: form.feeAmount,
      formSchema: edit?.formSchema ?? [],
      steps: steps.map((s, i) => ({ ...s, stepOrder: i + 1, stepType: 'USER' })),
    }),
    onSuccess: () => { onMsg('فرایند ذخیره شد.'); setOpen(false); onDone(); },
    onError: (e: Error) => onMsg(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>فرایندهای گردش کار</span>
          <Button size="sm" variant="outline" onClick={startNew} disabled={open}>+ فرایند جدید</Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {processes.map((p) => (
            <button key={p.id} type="button" onClick={() => startEdit(p)} className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-bold hover:bg-muted">
              {p.title} <span className="font-mono text-[9px] text-muted-foreground" dir="ltr">{p.code}</span> · {faNumber(p.steps.length)} گام
            </button>
          ))}
        </div>
        {open ? (
          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div><label className="text-[11px] font-bold">کد</label><Input value={form.code} disabled={!!edit} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
              <div><label className="text-[11px] font-bold">عنوان</label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 h-8" /></div>
              <div><label className="text-[11px] font-bold">دسته</label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 h-8" /></div>
              <div><label className="text-[11px] font-bold">هزینه (ریال)</label><Input type="number" value={form.feeAmount} onChange={(e) => setForm({ ...form, feeAmount: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold">گام‌ها</p>
              {steps.map((s, i) => (
                <div key={i} className="grid gap-1.5 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                  <Input value={s.title} onChange={(e) => setSteps(steps.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} className="h-7 text-[11px]" placeholder="عنوان مرحله" />
                  <Input value={s.roleCode} onChange={(e) => setSteps(steps.map((x, j) => j === i ? { ...x, roleCode: e.target.value } : x))} className="h-7 font-mono text-[11px]" dir="ltr" placeholder="EDU_EXPERT" />
                  <Input type="number" value={s.slaHours} onChange={(e) => setSteps(steps.map((x, j) => j === i ? { ...x, slaHours: Number(e.target.value) } : x))} className="h-7 font-mono text-[11px]" dir="ltr" title="SLA ساعت" />
                  <select value={s.timeoutAction} onChange={(e) => setSteps(steps.map((x, j) => j === i ? { ...x, timeoutAction: e.target.value } : x))} className="h-7 rounded-lg border border-input bg-transparent px-1 text-[10px]">
                    <option value="ESCALATE">ارجاع</option>
                    <option value="AUTO_APPROVE">تأیید خودکار</option>
                    <option value="AUTO_REJECT">رد خودکار</option>
                    <option value="NOTIFY">فقط اطلاع</option>
                  </select>
                  <Button size="sm" variant="ghost" className="h-7 px-1.5 text-rose-600" onClick={() => setSteps(steps.filter((_, j) => j !== i))}><X className="size-3.5" aria-hidden /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setSteps([...steps, { stepOrder: steps.length + 1, title: '', roleCode: 'EDU_EXPERT', slaHours: 48, timeoutAction: 'ESCALATE' }])}>+ گام</Button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={saveMut.isPending || !form.title || (!edit && !form.code)} onClick={() => saveMut.mutate()}>ذخیرهٔ فرایند</Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>انصراف</Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
