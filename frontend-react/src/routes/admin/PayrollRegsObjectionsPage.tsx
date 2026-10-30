import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Gavel, Plus, Scale, ScrollText, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  activateRegulation, createRegulation, deleteRegulation, getObjectionHistory,
  getOpenObjections, getRegulations, reviewObjection, type OpenObjection,
} from '@/lib/payroll-api';

// ═══ آیین‌نامه‌ها + اعتراض‌های فیش — پورت payroll/regulations و objections ═══

const OBJ_STATUS_FA: Record<string, string> = { OPEN: 'باز', RESOLVED: 'رسیدگی شد', REJECTED: 'وارد نیست' };
const OBJ_CLS: Record<string, string> = {
  OPEN: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  RESOLVED: 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  REJECTED: 'border-transparent bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
};

export function PayrollRegsObjectionsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'objections' | 'regulations'>('objections');
  const [msg, setMsg] = useState<string | null>(null);
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ['payroll-objections'] });
    void qc.invalidateQueries({ queryKey: ['payroll-regulations'] });
  };

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-indigo-900 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-base font-black"><Scale className="size-5" aria-hidden /> آیین‌نامه‌ها و اعتراض‌های فیش</h1>
            <p className="mt-0.5 text-xs text-indigo-100">نسخه‌های آیین‌نامهٔ حق‌التدریس و رسیدگی به اعتراض استادان</p>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant={tab === 'objections' ? 'default' : 'outline'} className="bg-white/15 text-white hover:bg-white/25" onClick={() => setTab('objections')}><Gavel className="size-4" aria-hidden /> اعتراض‌ها</Button>
            <Button size="sm" variant={tab === 'regulations' ? 'default' : 'outline'} className="bg-white/15 text-white hover:bg-white/25" onClick={() => setTab('regulations')}><ScrollText className="size-4" aria-hidden /> آیین‌نامه‌ها</Button>
          </div>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      {tab === 'objections' ? <ObjectionsTab onMsg={setMsg} onDone={refreshAll} /> : <RegulationsTab onMsg={setMsg} onDone={refreshAll} />}
    </div>
  );
}

function ObjectionsTab({ onMsg, onDone }: { onMsg: (m: string) => void; onDone: () => void }) {
  const [reviewing, setReviewing] = useState<OpenObjection | null>(null);
  const [note, setNote] = useState('');
  const [reopen, setReopen] = useState(false);
  const open = useQuery({ queryKey: ['payroll-objections', 'open'], queryFn: getOpenObjections, staleTime: 15_000 });
  const history = useQuery({ queryKey: ['payroll-objections', 'history'], queryFn: getObjectionHistory, staleTime: 15_000 });

  const reviewMut = useMutation({
    mutationFn: (decision: 'RESOLVED' | 'REJECTED') => reviewObjection({
      id: reviewing!.id, decision, reviewNote: note || ' ', reopen,
    }),
    onSuccess: () => { onMsg('رسیدگی ثبت شد.'); setReviewing(null); setNote(''); setReopen(false); onDone(); },
    onError: (e: Error) => onMsg(e.message),
  });

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">اعتراض‌های باز</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {open.isLoading ? <Skeleton className="h-32 w-full" /> : (open.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">اعتراض بازی وجود ندارد.</p>
          ) : (open.data ?? []).map((o) => (
            <div key={o.id} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">{o.staffName} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{o.staffCode ? faDigits(o.staffCode) : ''}</span></span>
                <span className="text-muted-foreground">{o.termTitle ?? '—'} · فیش #{faNumber(o.statementId)}</span>
              </div>
              <p className="mt-1 leading-5">{o.text}</p>
              {reviewing?.id === o.id ? (
                <div className="mt-2 space-y-1.5 rounded-lg border border-border bg-background/60 p-2">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت بررسی (الزامی)" className="h-7 text-[11px]" />
                  <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={reopen} onChange={(e) => setReopen(e.target.checked)} /> بازگشایی فیش برای اصلاح (فقط فیش تأییدشده)</label>
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-7 bg-emerald-700 text-[11px] text-white hover:bg-emerald-800" disabled={reviewMut.isPending || note.length < 3} onClick={() => reviewMut.mutate('RESOLVED')}>رسیدگی شد</Button>
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={reviewMut.isPending || note.length < 3} onClick={() => reviewMut.mutate('REJECTED')}>وارد نیست</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => { setReviewing(null); setNote(''); setReopen(false); }}>انصراف</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="mt-2 h-7 text-[11px]" onClick={() => setReviewing(o)}>رسیدگی</Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">تاریخچه</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {history.isLoading ? <Skeleton className="h-24 w-full" /> : (
            <table className="w-full border-collapse text-right text-[11px]">
              <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">استاد</th><th className="p-1.5">ترم</th><th className="p-1.5">وضعیت</th><th className="p-1.5">یادداشت</th><th className="p-1.5 text-center">بازگشایی</th></tr></thead>
              <tbody>
                {(history.data ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">اعتراضی ثبت نشده است.</td></tr>
                ) : (history.data ?? []).map((h) => (
                  <tr key={h.id} className="border-b border-border/40 last:border-0">
                    <td className="p-1.5">{h.staffName} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{h.staffCode ? faDigits(h.staffCode) : ''}</span></td>
                    <td className="p-1.5">{h.termTitle ?? '—'}</td>
                    <td className="p-1.5"><Badge className={OBJ_CLS[h.status] ?? ''}>{OBJ_STATUS_FA[h.status] ?? h.status}</Badge></td>
                    <td className="p-1.5 text-muted-foreground">{h.reviewNote ?? '—'}</td>
                    <td className="p-1.5 text-center">{h.reopenedStatement === 1 ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const emptyReg = { code: '', title: '', year: '', description: '' };

function RegulationsTab({ onMsg, onDone }: { onMsg: (m: string) => void; onDone: () => void }) {
  const [form, setForm] = useState({ ...emptyReg });
  const regs = useQuery({ queryKey: ['payroll-regulations'], queryFn: getRegulations, staleTime: 30_000 });
  const createMut = useMutation({
    mutationFn: () => createRegulation({
      code: form.code, title: form.title,
      year: form.year === '' ? null : Number(form.year),
      description: form.description || null,
    }),
    onSuccess: () => { onMsg('نسخه ساخته شد.'); setForm({ ...emptyReg }); onDone(); },
    onError: (e: Error) => onMsg(e.message),
  });
  const activateMut = useMutation({
    mutationFn: activateRegulation,
    onSuccess: () => { onMsg('نسخه فعال شد.'); onDone(); },
    onError: (e: Error) => onMsg(e.message),
  });
  const delMut = useMutation({
    mutationFn: deleteRegulation,
    onSuccess: () => { onMsg('حذف شد.'); onDone(); },
    onError: (e: Error) => onMsg(e.message),
  });

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Plus className="size-4" aria-hidden /> نسخهٔ آیین‌نامهٔ جدید</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div><Label className="text-[11px]">کد</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div className="lg:col-span-2"><Label className="text-[11px]">عنوان</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 h-8" /></div>
          <div><Label className="text-[11px]">سال</Label><Input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" placeholder="—" /></div>
          <div className="flex items-end">
            <Button size="sm" disabled={createMut.isPending || !form.code || !form.title} onClick={() => createMut.mutate()}><BadgeCheck className="size-4" aria-hidden /> ساخت</Button>
          </div>
          <div className="sm:col-span-2 lg:col-span-5"><Label className="text-[11px]">توضیح</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 h-8" /></div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto pt-4">
          <table className="w-full border-collapse text-right text-xs">
            <thead><tr className="border-b border-border bg-muted/60 text-muted-foreground"><th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2 text-center">سال</th><th className="p-2">توضیح</th><th className="p-2 text-center">فعال</th><th className="p-2"></th></tr></thead>
            <tbody>
              {(regs.data ?? []).length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">نسخه‌ای ثبت نشده است.</td></tr>
              ) : (regs.data ?? []).map((r) => (
                <tr key={r.id} className="border-b border-border/40 last:border-0">
                  <td className="p-2 font-mono text-[10px]" dir="ltr">{r.code}</td>
                  <td className="p-2 font-semibold">{r.title}</td>
                  <td className="p-2 text-center font-mono">{r.year == null ? '—' : faDigits(r.year)}</td>
                  <td className="p-2 text-muted-foreground">{r.description ?? '—'}</td>
                  <td className="p-2 text-center">
                    {r.isActive ? <Badge className="border-transparent bg-emerald-100 text-emerald-800">فعال</Badge> : (
                      <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={activateMut.isPending} onClick={() => activateMut.mutate(r.id)}>فعال‌سازی</Button>
                    )}
                  </td>
                  <td className="p-2">
                    {!r.isActive ? (
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delMut.isPending} onClick={() => { if (confirm(`حذف نسخهٔ «${r.title}»؟`)) delMut.mutate(r.id); }}><Trash2 className="size-3.5" aria-hidden /></Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
