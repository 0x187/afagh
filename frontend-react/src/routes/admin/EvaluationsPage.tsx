import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  createEvaluationPeriod,
  deleteEvaluationPeriod,
  getAdminEvaluations,
  toggleEvaluationPeriod,
} from '@/lib/admin-api';

// ═══ Evaluation periods — port of admin/evaluations ═══

function nowLocal(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 16);
}

export function AdminEvaluationsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-evaluations'], queryFn: getAdminEvaluations, staleTime: 30_000 });
  const [form, setForm] = useState({ title: '', termId: '', start: nowLocal(), end: nowLocal(7), isActive: true });
  const [msg, setMsg] = useState<string | null>(null);
  const createMut = useMutation({
    mutationFn: () => createEvaluationPeriod({ title: form.title, termId: Number(form.termId), start: form.start, end: form.end, isActive: form.isActive }),
    onSuccess: async () => {
      setMsg('دورهٔ ارزشیابی ساخته شد.');
      setForm({ ...form, title: '' });
      await qc.invalidateQueries({ queryKey: ['admin-evaluations'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const toggleMut = useMutation({
    mutationFn: (id: number) => toggleEvaluationPeriod(id),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ['admin-evaluations'] }),
    onError: (e: Error) => setMsg(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteEvaluationPeriod(id),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ['admin-evaluations'] }),
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت دوره‌ها ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-indigo-800 to-violet-700 text-white">
        <CardContent className="p-5">
          <h1 className="text-base font-black">پنجرهٔ ارزشیابی اساتید و کلاس‌ها</h1>
          <p className="mt-0.5 text-xs text-indigo-100">ارزشیابی فقط داخل دورهٔ فعال و بازهٔ تعیین‌شده پذیرفته می‌شود.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Plus className="size-4 text-indigo-600" aria-hidden /> دورهٔ جدید</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-end gap-2 text-[11px]">
            <div className="w-44"><Label>عنوان</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 h-8" placeholder="ارزشیابی نیمسال…" /></div>
            <div className="w-44"><Label>ترم</Label>
              <select value={form.termId} onChange={(e) => setForm({ ...form, termId: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2">
                <option value="">— انتخاب —</option>
                {data.terms.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
            <div className="w-44"><Label>شروع</Label><Input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="mt-1 h-8" dir="ltr" /></div>
            <div className="w-44"><Label>پایان</Label><Input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="mt-1 h-8" dir="ltr" /></div>
            <label className="flex items-center gap-1.5 pb-1 font-bold"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> فعال</label>
            <Button size="sm" disabled={createMut.isPending || !form.title || !form.termId} onClick={() => createMut.mutate()}>ساخت دوره</Button>
          </div>
          {msg ? <p className="text-[11px] text-muted-foreground">{msg}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><CalendarCheck className="size-4 text-emerald-600" aria-hidden /> دوره‌های تعیین‌شده ({faNumber(data.periods.length)})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-xs">
            <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2">عنوان</th><th className="p-2">ترم</th><th className="p-2">شروع</th><th className="p-2">پایان</th><th className="p-2">وضعیت</th><th className="p-2">عملیات</th></tr></thead>
            <tbody>
              {data.periods.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">دوره‌ای ساخته نشده است.</td></tr>
              ) : data.periods.map((p) => (
                <tr key={p.id} className="border-b border-border/50 last:border-0">
                  <td className="p-2 font-bold">{p.title}</td>
                  <td className="p-2">{p.termTitle ?? '—'}</td>
                  <td className="p-2 font-mono text-[10px]" dir="ltr">{p.startDate ? faDigits(p.startDate.slice(0, 16).replace('T', ' ')) : '—'}</td>
                  <td className="p-2 font-mono text-[10px]" dir="ltr">{p.endDate ? faDigits(p.endDate.slice(0, 16).replace('T', ' ')) : '—'}</td>
                  <td className="p-2">
                    {p.isActive === 0 ? <Badge variant="secondary">غیرفعال</Badge>
                      : p.open ? <Badge className="border-transparent bg-emerald-600 text-white">باز</Badge>
                      : <Badge className="border-transparent bg-amber-500 text-slate-950">خارج از بازه</Badge>}
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7" disabled={toggleMut.isPending} onClick={() => toggleMut.mutate(p.id)}>{p.isActive ? 'غیرفعال' : 'فعال'}</Button>
                      <Button size="sm" variant="ghost" className="h-7 px-1.5 text-rose-600" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate(p.id)}><Trash2 className="size-3.5" aria-hidden /></Button>
                    </div>
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
