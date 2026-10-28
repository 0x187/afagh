import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, Plus, Save, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  DISCIPLINE_DECISIONS, DISCIPLINE_STATUSES, DISCIPLINE_VIOLATION_TYPES,
  createDiscipline, deleteDiscipline, listDiscipline, searchDisciplineStudents, updateDiscipline,
  type DisciplineCase,
} from '@/lib/committees-api';

// ═══ کمیتهٔ انضباطی — پورت admin/discipline ═══

const STATUS_BADGE: Record<string, string> = {
  'در حال بررسی': 'border-transparent bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  'در کمیته': 'border-transparent bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  'تصمیم‌گیری‌شده': 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  'تجدیدنظر': 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
};

export function AdminDisciplinePage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DisciplineCase | null>(null);
  const [form, setForm] = useState({ studentCode: '', studentName: '', violationType: DISCIPLINE_VIOLATION_TYPES[0], description: '', reporterName: '', caseDate: '' });
  const [studentId, setStudentId] = useState(0);
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['discipline', status, q, page],
    queryFn: () => listDiscipline({ status, q, page }),
    staleTime: 10_000,
  });
  const hitsQuery = useQuery({
    queryKey: ['discipline-students', form.studentCode],
    queryFn: () => searchDisciplineStudents(form.studentCode),
    enabled: showForm && !editing && form.studentCode.trim().length >= 2,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['discipline'] });

  const createMut = useMutation({
    mutationFn: () => createDiscipline({
      studentId,
      violationType: form.violationType,
      description: form.description,
      reporterName: form.reporterName,
      caseDate: form.caseDate || undefined,
    }),
    onSuccess: () => { setMsg('پرونده ثبت شد.'); setShowForm(false); setForm({ studentCode: '', studentName: '', violationType: DISCIPLINE_VIOLATION_TYPES[0], description: '', reporterName: '', caseDate: '' }); setStudentId(0); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const updateMut = useMutation({
    mutationFn: () => updateDiscipline(editing!.id, {
      status: editing!.status,
      committeeDecision: editing!.committeeDecision ?? undefined,
      decisionNotes: editing!.decisionNotes ?? undefined,
    }),
    onSuccess: () => { setMsg('پرونده به‌روزرسانی شد.'); setEditing(null); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const delMut = useMutation({
    mutationFn: deleteDiscipline,
    onSuccess: () => { setMsg('پرونده حذف شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت پرونده‌ها ناموفق بود.</CardContent></Card>;

  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-rose-800 via-slate-800 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-base font-black"><ShieldAlert className="size-5" aria-hidden /> کمیتهٔ انضباطی</h1>
            <p className="mt-0.5 text-xs text-rose-100">ثبت پرونده، پیگیری وضعیت و ثبت تصمیم کمیته — {faNumber(data.total)} پرونده</p>
          </div>
          <Button size="sm" className="bg-white/15 text-white hover:bg-white/25" onClick={() => { setShowForm(!showForm); setEditing(null); }}>
            <Plus className="size-4" aria-hidden /> پروندهٔ جدید
          </Button>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 p-3">
          <div className="min-w-48 flex-1"><Label className="text-[11px]">جست‌وجو (کد دانشجویی / نام)</Label><Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="mt-1 h-8" /></div>
          <div className="w-40"><Label className="text-[11px]">وضعیت</Label>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
              <option value="">همه</option>
              {DISCIPLINE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      {showForm ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">ثبت پروندهٔ انضباطی جدید</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label className="text-[11px]">کد دانشجویی</Label>
              <Input value={form.studentCode} onChange={(e) => setForm({ ...form, studentCode: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" />
              {(hitsQuery.data ?? []).length > 0 ? (
                <div className="mt-1 space-y-0.5">
                  {(hitsQuery.data ?? []).map((h) => (
                    <button key={h.studentId} type="button" onClick={() => { setStudentId(h.studentId); setForm({ ...form, studentCode: h.studentCode, studentName: h.name }); }} className={`block w-full rounded border px-2 py-0.5 text-right text-[11px] ${studentId === h.studentId ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950' : 'border-border'}`}>
                      {h.name} — <span className="font-mono" dir="ltr">{faDigits(h.studentCode)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {form.studentName ? <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">انتخاب: {form.studentName}</p> : null}
            </div>
            <div><Label className="text-[11px]">نوع تخلف</Label>
              <select value={form.violationType} onChange={(e) => setForm({ ...form, violationType: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                {DISCIPLINE_VIOLATION_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div><Label className="text-[11px]">گزارش‌دهنده</Label><Input value={form.reporterName} onChange={(e) => setForm({ ...form, reporterName: e.target.value })} className="mt-1 h-8" /></div>
            <div><Label className="text-[11px]">تاریخ وقوع</Label><Input type="date" value={form.caseDate} onChange={(e) => setForm({ ...form, caseDate: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
            <div className="sm:col-span-2 lg:col-span-3"><Label className="text-[11px]">شرح</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 h-8" /></div>
            <div className="flex items-end gap-2">
              <Button size="sm" disabled={createMut.isPending || !studentId || !form.violationType} onClick={() => createMut.mutate()}><Plus className="size-4" aria-hidden /> ثبت پرونده</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>انصراف</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                <th className="p-2">دانشجو</th><th className="p-2">تخلف</th><th className="p-2">وضعیت</th>
                <th className="p-2">تصمیم</th><th className="p-2">تاریخ</th><th className="p-2 text-center">اسناد</th><th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">پرونده‌ای یافت نشد.</td></tr>
              ) : data.rows.map((r) => (
                <tr key={r.id} className="border-b border-border/40 last:border-0">
                  <td className="p-2">
                    <div className="font-bold">{r.studentName}</div>
                    <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{faDigits(r.studentCode)}</div>
                  </td>
                  <td className="p-2">
                    <div>{r.violationType}</div>
                    {r.reporterName ? <div className="text-[10px] text-muted-foreground">گزارش: {r.reporterName}</div> : null}
                  </td>
                  <td className="p-2"><Badge className={STATUS_BADGE[r.status] ?? ''}>{r.status}</Badge></td>
                  <td className="p-2">{r.committeeDecision ?? '—'}{r.decisionNotes ? <div className="text-[10px] text-muted-foreground">{r.decisionNotes}</div> : null}</td>
                  <td className="p-2 font-mono text-[10px]" dir="ltr">{r.caseDate ? faDigits(r.caseDate.slice(0, 10)) : '—'}</td>
                  <td className="p-2 text-center font-mono">{faNumber(r.documentCount)}</td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setEditing(editing?.id === r.id ? null : r)}><Gavel className="size-3.5" aria-hidden /></Button>
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" disabled={delMut.isPending} onClick={() => { if (confirm(`حذف پروندهٔ «${r.studentName}»؟`)) delMut.mutate(r.id); }}><Trash2 className="size-3.5" aria-hidden /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {editing ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">ثبت وضعیت/تصمیم — {editing.studentName}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div><Label className="text-[11px]">وضعیت</Label>
              <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                {DISCIPLINE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div><Label className="text-[11px]">تصمیم کمیته</Label>
              <select value={editing.committeeDecision ?? ''} onChange={(e) => setEditing({ ...editing, committeeDecision: e.target.value || null })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                <option value="">—</option>
                {DISCIPLINE_DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="lg:col-span-1"><Label className="text-[11px]">یادداشت تصمیم</Label><Input value={editing.decisionNotes ?? ''} onChange={(e) => setEditing({ ...editing, decisionNotes: e.target.value })} className="mt-1 h-8" /></div>
            <div className="flex items-end gap-2">
              <Button size="sm" disabled={updateMut.isPending} onClick={() => updateMut.mutate()}><Save className="size-4" aria-hidden /> ذخیره</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>انصراف</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>قبلی</Button>
          <span className="text-xs text-muted-foreground">صفحهٔ {faNumber(page)} از {faNumber(pageCount)}</span>
          <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>بعدی</Button>
        </div>
      ) : null}
    </div>
  );
}
