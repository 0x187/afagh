import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, ClipboardList, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  addThesisDraw, createExamPayment, createThesisSupervision, deleteExamPayment,
  deleteThesisDraw, deleteThesisSupervision, getExamPayments, getPayrollTerms,
  getThesisDraws, getThesisSupervisions, searchPayrollStaff, setThesisStatus,
  type SupervisionItem,
} from '@/lib/payroll-api';

// ═══ Exam payments + thesis ledger — port of payroll/exam-payments and thesis ═══

const SRC_FA: Record<string, string> = { INVIGILATION: 'مراقبت', CORRECTION: 'تصحیح', EXEC: 'اجرا' };
const STATUS_FA: Record<string, string> = { ONGOING: 'در جریان', COMPLETED: 'تکمیل‌شده', CANCELLED: 'لغوشده' };
const ROLE_FA: Record<string, string> = { SUPERVISOR: 'راهنما', ADVISOR: 'مشاور' };

export function PayrollOperationsPage() {
  const [tab, setTab] = useState<'exam' | 'thesis'>('exam');
  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-slate-800 via-teal-900 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-5">
          <div>
            <h1 className="text-base font-black">عملیات مالی حقوق</h1>
            <p className="mt-0.5 text-xs text-teal-100">پرداخت‌های امتحانی (مراقبت/تصحیح/اجرا) و دفتر پایان‌نامه (راهنما/مشاور)</p>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant={tab === 'exam' ? 'default' : 'outline'} className="bg-white/15 text-white hover:bg-white/25" onClick={() => setTab('exam')}><ClipboardList className="size-4" aria-hidden /> پرداخت امتحانی</Button>
            <Button size="sm" variant={tab === 'thesis' ? 'default' : 'outline'} className="bg-white/15 text-white hover:bg-white/25" onClick={() => setTab('thesis')}><BookMarked className="size-4" aria-hidden /> دفتر پایان‌نامه</Button>
          </div>
        </CardContent>
      </Card>
      {tab === 'exam' ? <ExamPaymentsTab /> : <ThesisTab />}
    </div>
  );
}

// ─────────────────── Exam payments ───────────────────

function ExamPaymentsTab() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [termId, setTermId] = useState(0);
  const [staffQuery, setStaffQuery] = useState('');
  const [staffId, setStaffId] = useState(0);
  const [, setSelectedStaff] = useState('');
  const [form, setForm] = useState({ source: 'INVIGILATION', sessionCount: 0, unitCount: 0, amount: 0 });

  const terms = useQuery({ queryKey: ['payroll-terms'], queryFn: getPayrollTerms, staleTime: 60_000 });
  const current = (terms.data ?? []).find((t) => t.isCurrent) ?? (terms.data ?? [])[0];
  const effectiveTerm = termId || (current?.id ?? 0);
  const data = useQuery({
    queryKey: ['exam-payments', effectiveTerm],
    queryFn: () => getExamPayments(effectiveTerm),
    enabled: effectiveTerm > 0,
  });
  const hits = useQuery({
    queryKey: ['payroll-staff', staffQuery],
    queryFn: () => searchPayrollStaff(staffQuery),
    enabled: staffQuery.trim().length >= 2,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['exam-payments', effectiveTerm] });

  const createMut = useMutation({
    mutationFn: () => createExamPayment({ staffId, termId: effectiveTerm, ...form }),
    onSuccess: () => { setMsg('پرداخت ثبت شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const delMut = useMutation({
    mutationFn: deleteExamPayment,
    onSuccess: () => { setMsg('حذف شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });

  if (terms.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 p-3">
          <div>
            <Label className="text-[11px]">ترم</Label>
            <select value={effectiveTerm} onChange={(e) => setTermId(Number(e.target.value))} className="mt-1 h-8 rounded-lg border border-input bg-transparent px-2 text-xs">
              {(terms.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>
          <div className="min-w-48 flex-1">
            <Label className="text-[11px]">جست‌وجوی استاد</Label>
            <Input value={staffQuery} onChange={(e) => setStaffQuery(e.target.value)} className="mt-1 h-8" placeholder="کد پرسنلی یا نام…" />
            {(hits.data ?? []).length > 0 ? (
              <div className="mt-1 space-y-0.5">
                {(hits.data ?? []).map((h) => (
                  <button key={h.id} type="button" onClick={() => { setStaffId(h.id); setSelectedStaff(h.name); setStaffQuery(''); }}
                    className={`block w-full rounded border px-2 py-0.5 text-right text-[11px] ${staffId === h.id ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950' : 'border-border'}`}>
                    {h.name} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{h.staffCode}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div><Label className="text-[11px]">منبع</Label>
            <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="mt-1 h-8 rounded-lg border border-input bg-transparent px-2 text-xs">
              <option value="INVIGILATION">مراقبت</option>
              <option value="CORRECTION">تصحیح</option>
              <option value="EXEC">اجرا</option>
            </select>
          </div>
          <div className="w-24"><Label className="text-[11px]">جلسات</Label><Input type="number" value={form.sessionCount} onChange={(e) => setForm({ ...form, sessionCount: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div className="w-24"><Label className="text-[11px]">واحد</Label><Input type="number" value={form.unitCount} onChange={(e) => setForm({ ...form, unitCount: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <div className="w-32"><Label className="text-[11px]">مبلغ (ریال)</Label><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
          <Button size="sm" disabled={createMut.isPending || !staffId || !effectiveTerm} onClick={() => createMut.mutate()}><Plus className="size-4" aria-hidden /> ثبت</Button>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      {data.data && data.data.notReady.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
          <CardHeader className="pb-1"><CardTitle className="text-xs font-black text-amber-900 dark:text-amber-200">اوراق بازگشت‌نشده به بایگانی — شرط پرداخت تصحیح برقرار نیست</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-1.5 text-[11px]">
            {data.data.notReady.map((n) => (
              <span key={n.staffId} className="rounded-lg border border-amber-300 bg-white px-2 py-0.5 dark:border-amber-800 dark:bg-slate-900">
                {n.name} — {faNumber(n.pending)} مورد باز
              </span>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="overflow-x-auto pt-4">
          {data.isLoading ? <Skeleton className="h-32 w-full" /> : (
            <table className="w-full border-collapse text-right text-xs">
              <thead><tr className="border-b border-border bg-muted/60 text-muted-foreground">
                <th className="p-2">استاد</th><th className="p-2">منبع</th><th className="p-2 text-center">جلسات</th>
                <th className="p-2 text-center">واحد</th><th className="p-2 text-left">مبلغ</th><th className="p-2 text-center">بایگانی</th><th className="p-2"></th>
              </tr></thead>
              <tbody>
                {(data.data?.list ?? []).length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">پرداختی ثبت نشده است.</td></tr>
                ) : (data.data?.list ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0">
                    <td className="p-2">{r.staffName} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{r.staffCode ? faDigits(r.staffCode) : ''}</span></td>
                    <td className="p-2">{SRC_FA[r.source] ?? r.source}</td>
                    <td className="p-2 text-center font-mono">{faNumber(r.sessionCount)}</td>
                    <td className="p-2 text-center font-mono">{faNumber(r.unitCount)}</td>
                    <td className="p-2 text-left font-mono">{faNumber(r.amount)}</td>
                    <td className="p-2 text-center">
                      {r.archivePending > 0 ? <Badge className="border-transparent bg-rose-100 text-rose-800">{faNumber(r.archivePending)} باز</Badge> : <Badge className="border-transparent bg-emerald-100 text-emerald-800">کامل</Badge>}
                    </td>
                    <td className="p-2">
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delMut.isPending} onClick={() => { if (confirm('حذف این پرداخت؟')) delMut.mutate(r.id); }}><Trash2 className="size-3.5" aria-hidden /></Button>
                    </td>
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

// ─────────────────── Thesis ledger ───────────────────

const emptySup = { title: '', totalUnits: 4, role: 'SUPERVISOR', studentNameManual: '', startTermId: '' };

function ThesisTab() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [rawStaffQuery, setRawStaffQuery] = useState('');
  const [staffId, setStaffId] = useState(0);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [form, setForm] = useState({ ...emptySup });
  const [openSup, setOpenSup] = useState<SupervisionItem | null>(null);
  const [drawTermId, setDrawTermId] = useState(0);
  const [drawUnits, setDrawUnits] = useState(1);
  const [drawNote, setDrawNote] = useState('');

  const terms = useQuery({ queryKey: ['payroll-terms'], queryFn: getPayrollTerms, staleTime: 60_000 });
  const current = (terms.data ?? []).find((t) => t.isCurrent) ?? (terms.data ?? [])[0];
  const effectiveTerm = drawTermId || (current?.id ?? 0);
  const list = useQuery({ queryKey: ['thesis-supervisions'], queryFn: () => getThesisSupervisions(), staleTime: 15_000 });
  const hits = useQuery({
    queryKey: ['payroll-staff', rawStaffQuery],
    queryFn: () => searchPayrollStaff(rawStaffQuery),
    enabled: rawStaffQuery.trim().length >= 2,
  });
  const draws = useQuery({
    queryKey: ['thesis-draws', openSup?.id],
    queryFn: () => getThesisDraws(openSup!.id),
    enabled: !!openSup,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['thesis-supervisions'] });
    void qc.invalidateQueries({ queryKey: ['thesis-draws'] });
  };
  const createMut = useMutation({
    mutationFn: () => createThesisSupervision({
      staffId,
      title: form.title,
      totalUnits: form.totalUnits,
      role: form.role,
      studentNameManual: form.studentNameManual || null,
      startTermId: form.startTermId ? Number(form.startTermId) : undefined,
    }),
    onSuccess: () => { setMsg('سرجمع ثبت شد.'); setForm({ ...emptySup }); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => setThesisStatus(id, status),
    onSuccess: () => { setMsg('وضعیت ثبت شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const delMut = useMutation({
    mutationFn: deleteThesisSupervision,
    onSuccess: () => { setMsg('سرجمع حذف شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const drawAddMut = useMutation({
    mutationFn: () => addThesisDraw({ supervisionId: openSup!.id, termId: effectiveTerm, units: drawUnits, note: drawNote || null }),
    onSuccess: () => { setMsg('برداشت ثبت شد.'); setDrawNote(''); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const drawDelMut = useMutation({
    mutationFn: deleteThesisDraw,
    onSuccess: () => { setMsg('برداشت حذف شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });

  if (terms.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-3">
      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">سرجمع جدید (راهنمایی/مشاوره)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label className="text-[11px]">استاد</Label>
              <Input value={rawStaffQuery} onChange={(e) => setRawStaffQuery(e.target.value)} className="mt-1 h-8" placeholder="کد پرسنلی یا نام…" />
              {(hits.data ?? []).length > 0 ? (
                <div className="mt-1 space-y-0.5">
                  {(hits.data ?? []).map((h) => (
                    <button key={h.id} type="button" onClick={() => { setStaffId(h.id); setSelectedStaff(h.name); setRawStaffQuery(''); }}
                      className={`block w-full rounded border px-2 py-0.5 text-right text-[11px] ${staffId === h.id ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950' : 'border-border'}`}>
                      {h.name}
                    </button>
                  ))}
                </div>
              ) : null}
              {selectedStaff ? <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">انتخاب: {selectedStaff}</p> : null}
            </div>
            <div><Label className="text-[11px]">نام دستی دانشجو (اگر پرونده ندارد)</Label><Input value={form.studentNameManual} onChange={(e) => setForm({ ...form, studentNameManual: e.target.value })} className="mt-1 h-8" /></div>
            <div className="lg:col-span-2"><Label className="text-[11px]">عنوان پایان‌نامه</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 h-8" /></div>
            <div><Label className="text-[11px]">سقف واحد</Label><Input type="number" value={form.totalUnits} onChange={(e) => setForm({ ...form, totalUnits: Number(e.target.value) })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
            <div><Label className="text-[11px]">نقش</Label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                <option value="SUPERVISOR">راهنما</option>
                <option value="ADVISOR">مشاور</option>
              </select>
            </div>
            <div><Label className="text-[11px]">ترم شروع</Label>
              <select value={form.startTermId} onChange={(e) => setForm({ ...form, startTermId: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                <option value="">—</option>
                {(terms.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <Button size="sm" disabled={createMut.isPending || !staffId || form.title.trim().length < 3} onClick={() => createMut.mutate()}><Plus className="size-4" aria-hidden /> ثبت سرجمع</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">سرجمع‌ها</CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          {list.isLoading ? <Skeleton className="h-24 w-full" /> : (list.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">سرجمعی ثبت نشده است.</p>
          ) : (list.data ?? []).map((s) => (
            <div key={s.id} className={`rounded-xl border p-2.5 text-[11px] ${openSup?.id === s.id ? 'border-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20' : 'border-border'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className="text-right font-bold underline decoration-dotted underline-offset-4" onClick={() => setOpenSup(openSup?.id === s.id ? null : s)}>
                  {s.title}
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{ROLE_FA[s.role] ?? s.role}</Badge>
                  <Badge className={s.status === 'COMPLETED' ? 'border-transparent bg-emerald-100 text-emerald-800' : s.status === 'CANCELLED' ? 'border-transparent bg-rose-100 text-rose-800' : 'border-transparent bg-sky-100 text-sky-800'}>
                    {STATUS_FA[s.status] ?? s.status}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">{faNumber(s.drawnUnits)} / {faNumber(s.totalUnits)} واحد</span>
                  <select value={s.status} onChange={(e) => statusMut.mutate({ id: s.id, status: e.target.value })} className="h-6 rounded border border-input bg-transparent px-1 text-[10px]">
                    <option value="ONGOING">در جریان</option>
                    <option value="COMPLETED">تکمیل‌شده</option>
                    <option value="CANCELLED">لغوشده</option>
                  </select>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" onClick={() => { if (confirm('حذف سرجمع؟')) delMut.mutate(s.id); }}><Trash2 className="size-3" aria-hidden /></Button>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                <span>{s.staffName}</span><span>·</span><span>{s.studentName}</span>
                {s.startTermTitle ? <><span>·</span><span>{s.startTermTitle}</span></> : null}
                <span>·</span><span>باقی‌مانده: {faNumber(s.remainingUnits)} واحد</span>
              </div>
              {openSup?.id === s.id ? (
                <div className="mt-2 space-y-1.5 rounded-lg border border-border bg-background/60 p-2">
                  <div className="flex flex-wrap items-end gap-1.5">
                    <select value={effectiveTerm} onChange={(e) => setDrawTermId(Number(e.target.value))} className="h-7 rounded border border-input bg-transparent px-1 text-[11px]">
                      {(terms.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                    </select>
                    <Input type="number" value={drawUnits} onChange={(e) => setDrawUnits(Number(e.target.value))} className="h-7 w-16 font-mono text-[11px]" dir="ltr" title="واحد" />
                    <Input value={drawNote} onChange={(e) => setDrawNote(e.target.value)} className="h-7 min-w-40 flex-1 text-[11px]" placeholder="یادداشت برداشت" />
                    <Button size="sm" className="h-7 text-[11px]" disabled={drawAddMut.isPending || drawUnits <= 0} onClick={() => drawAddMut.mutate()}>ثبت برداشت</Button>
                  </div>
                  {(draws.data ?? []).length === 0 ? <p className="text-[10px] text-muted-foreground">برداشتی ثبت نشده است.</p> : (draws.data ?? []).map((d) => (
                    <div key={d.id} className="flex items-center justify-between rounded border border-border px-2 py-0.5 text-[11px]">
                      <span>{d.termTitle} — {faNumber(d.units)} واحد {d.note ? `· ${d.note}` : ''}</span>
                      <Button size="sm" variant="ghost" className="h-5 px-1 text-rose-600" onClick={() => drawDelMut.mutate(d.id)}><Trash2 className="size-3" aria-hidden /></Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
