import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock4, Lock, Sparkles, Trash2, Unlock } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, faRial } from '@/lib/fa';
import {
  createTuitionOverride, deleteTuitionOverride, getTimeControl, getTuitionOverrides,
  saveAccountingPeriod, updateTuitionOverride, type TuitionOverride,
} from '@/lib/admin-api';
import { getPayrollTerms } from '@/lib/payroll-api';

// ═══ Financial registration time control + student-specific formula ═══

export function AdminFinanceAdvancedPage() {
  const [tab, setTab] = useState<'time' | 'formula'>('time');
  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-rose-900 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-5">
          <div>
            <h1 className="text-base font-black">ابزارهای پیشرفتهٔ مالی</h1>
            <p className="mt-0.5 text-xs text-rose-100">کنترل زمانی ثبت مالی و فرمول ویژهٔ شهریهٔ دانشجو (override)</p>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant={tab === 'time' ? 'default' : 'outline'} className="bg-white/15 text-white hover:bg-white/25" onClick={() => setTab('time')}><Clock4 className="size-4" aria-hidden /> کنترل زمانی</Button>
            <Button size="sm" variant={tab === 'formula' ? 'default' : 'outline'} className="bg-white/15 text-white hover:bg-white/25" onClick={() => setTab('formula')}><Sparkles className="size-4" aria-hidden /> فرمول ویژه</Button>
          </div>
        </CardContent>
      </Card>
      {tab === 'time' ? <TimeControlTab /> : <FormulaTab />}
    </div>
  );
}

// ─────────────────── Time control ───────────────────

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TimeControlTab() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const state = useQuery({ queryKey: ['time-control'], queryFn: getTimeControl, staleTime: 10_000 });
  const [form, setForm] = useState({ id: 0, name: '', opensAt: '', closesAt: '', locked: false });

  useEffect(() => {
    if (state.data?.period) {
      setForm({
        id: state.data.period.id,
        name: state.data.period.periodName ?? '',
        opensAt: toLocalInput(state.data.period.opensAt),
        closesAt: toLocalInput(state.data.period.closesAt),
        locked: state.data.period.isLocked,
      });
    }
  }, [state.data?.period]);

  const saveMut = useMutation({
    mutationFn: () => saveAccountingPeriod({
      id: form.id || undefined,
      periodName: form.name || undefined,
      opensAt: new Date(form.opensAt).toISOString(),
      closesAt: new Date(form.closesAt).toISOString(),
      isLocked: form.locked,
    }),
    onSuccess: async (s) => {
      setMsg(`دورهٔ مالی ذخیره شد — ${s.reason}`);
      await qc.invalidateQueries({ queryKey: ['time-control'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (state.isLoading) return <Skeleton className="h-64 w-full" />;
  if (state.isError || !state.data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت وضعیت کنترل زمانی ناموفق بود.</CardContent></Card>;

  const s = state.data;
  return (
    <div className="space-y-3">
      <Card className={`border ${s.entryAllowed ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20' : 'border-rose-300 bg-rose-50/50 dark:border-rose-800 dark:bg-rose-950/20'}`}>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4 text-xs">
          <div className="flex items-center gap-2">
            <span className={`flex size-8 items-center justify-center rounded-full ${s.entryAllowed ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
              {s.entryAllowed ? <Unlock className="size-4" aria-hidden /> : <Lock className="size-4" aria-hidden />}
            </span>
            <div>
              <p className="font-black">{s.entryAllowed ? 'ثبت مالی مجاز است' : 'ثبت مالی مسدود است'}</p>
              <p className="text-muted-foreground">{s.reason}</p>
            </div>
          </div>
          <Badge variant="outline">{s.configured ? (s.locked ? 'قفل مدیر' : 'بازهٔ زمانی') : 'تعریف‌نشده'}</Badge>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{s.configured ? `ویرایش دورهٔ «${s.period?.periodName ?? '#' + s.period?.id}»` : 'تعریف دورهٔ مالی'}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label className="text-[11px]">نام دوره</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 h-8" /></div>
          <div><Label className="text-[11px]">آغاز</Label><Input type="datetime-local" value={form.opensAt} onChange={(e) => setForm({ ...form, opensAt: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label className="text-[11px]">پایان</Label><Input type="datetime-local" value={form.closesAt} onChange={(e) => setForm({ ...form, closesAt: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={form.locked} onChange={(e) => setForm({ ...form, locked: e.target.checked })} /> قفل ثبت</label>
            <Button size="sm" disabled={saveMut.isPending || !form.opensAt || !form.closesAt} onClick={() => saveMut.mutate()}>ذخیره</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────── Student-specific formula ───────────────────

function FormulaTab() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ studentId: '', termId: '', fixed: 0, perUnit: 0, reason: '' });
  const terms = useQuery({ queryKey: ['payroll-terms'], queryFn: getPayrollTerms, staleTime: 60_000 });
  const list = useQuery({ queryKey: ['tuition-overrides', query, page], queryFn: () => getTuitionOverrides({ q: query, page }), staleTime: 10_000 });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['tuition-overrides'] });

  const createMut = useMutation({
    mutationFn: () => createTuitionOverride({
      studentId: Number(form.studentId),
      termId: form.termId ? Number(form.termId) : null,
      fixedAmount: form.fixed,
      perUnitAmount: form.perUnit,
      reason: form.reason || null,
    }),
    onSuccess: () => { setMsg('فرمول ویژه ثبت شد و فرمول‌های متعارض همان دامنه غیرفعال شدند.'); setForm({ ...form, fixed: 0, perUnit: 0, reason: '' }); refresh(); },
    onError: (e: Error) => setMsg(e.message === 'zero_formula' ? 'هر دو مبلغ صفر است — حداقل یکی باید مثبت باشد.' : e.message),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => updateTuitionOverride(id, { isActive: active }),
    onSuccess: () => { setMsg('وضعیت فرمول تغییر کرد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const delMut = useMutation({
    mutationFn: deleteTuitionOverride,
    onSuccess: () => { setMsg('حذف شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });

  if (list.isLoading) return <Skeleton className="h-64 w-full" />;
  const pageCount = Math.max(1, Math.ceil((list.data?.total ?? 0) / 50));

  return (
    <div className="space-y-3">
      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">تعریف فرمول ویژه (نرخ ثابت + نرخ هر واحد)</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div><Label className="text-[11px]">شناسهٔ دانشجو</Label><Input value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label className="text-[11px]">ترم (خالی = همه)</Label>
            <select value={form.termId} onChange={(e) => setForm({ ...form, termId: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
              <option value="">همهٔ ترم‌ها</option>
              {(terms.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>
          <div><Label className="text-[11px]">مبلغ ثابت (ریال)</Label><Input type="number" value={form.fixed} onChange={(e) => setForm({ ...form, fixed: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div><Label className="text-[11px]">نرخ هر واحد</Label><Input type="number" value={form.perUnit} onChange={(e) => setForm({ ...form, perUnit: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div className="lg:col-span-1"><Label className="text-[11px]">دلیل</Label><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="mt-1 h-8" /></div>
          <div className="flex items-end">
            <Button size="sm" disabled={createMut.isPending || !form.studentId || (form.fixed === 0 && form.perUnit === 0)} onClick={() => createMut.mutate()}><Sparkles className="size-4" aria-hidden /> ثبت</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="کد دانشجویی یا نام…" className="min-w-56 flex-1" onKeyDown={(e) => { if (e.key === 'Enter') { setQuery(q); setPage(1); } }} />
          <Button size="sm" variant="outline" onClick={() => { setQuery(q); setPage(1); }}>جست‌وجو</Button>
          <span className="text-[11px] text-muted-foreground">{faNumber(list.data?.total ?? 0)} فرمول</span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto pt-4">
          <table className="w-full border-collapse text-right text-xs">
            <thead><tr className="border-b border-border bg-muted/60 text-muted-foreground">
              <th className="p-2">دانشجو</th><th className="p-2">دامنه</th><th className="p-2 text-left">ثابت</th>
              <th className="p-2 text-left">هر واحد</th><th className="p-2">دلیل</th><th className="p-2 text-center">فعال</th><th className="p-2"></th>
            </tr></thead>
            <tbody>
              {(list.data?.rows ?? []).length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">فرمول ویژه‌ای ثبت نشده است.</td></tr>
              ) : (list.data?.rows ?? []).map((r: TuitionOverride) => (
                <tr key={r.id} className="border-b border-border/40 last:border-0">
                  <td className="p-2">{r.studentName} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{faDigits(r.studentCode)}</span></td>
                  <td className="p-2">{r.termTitle}</td>
                  <td className="p-2 text-left font-mono">{faRial(r.fixedAmount)}</td>
                  <td className="p-2 text-left font-mono">{faRial(r.perUnitAmount)}</td>
                  <td className="p-2 text-muted-foreground">{r.reason ?? '—'}</td>
                  <td className="p-2 text-center">
                    <button type="button" disabled={toggleMut.isPending} onClick={() => toggleMut.mutate({ id: r.id, active: !r.isActive })}>
                      <Badge className={r.isActive ? 'border-transparent bg-emerald-100 text-emerald-800' : 'border-transparent bg-slate-100 text-slate-700'}>{r.isActive ? 'فعال' : 'غیرفعال'}</Badge>
                    </button>
                  </td>
                  <td className="p-2"><Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delMut.isPending} onClick={() => { if (confirm('حذف فرمول ویژه؟')) delMut.mutate(r.id); }}><Trash2 className="size-3.5" aria-hidden /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {pageCount > 1 ? (
            <div className="mt-2 flex items-center justify-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>قبلی</Button>
              <span className="text-[11px] text-muted-foreground">صفحهٔ {faNumber(page)} از {faNumber(pageCount)}</span>
              <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>بعدی</Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
