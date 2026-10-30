import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import { getLessonPlans, saveLessonPlanSettings, type LessonPlanRow } from '@/lib/regulation-api';

// ═══ پایش طرح درس ارائه‌ها — پورت admin/lesson-plans ═══

function statusBadge(status: string) {
  const s = String(status).toUpperCase();
  if (s === 'SUBMITTED') return <Badge variant="success" className="text-[10px]">ثبت نهایی</Badge>;
  if (s === 'DRAFT') return <Badge variant="warning" className="text-[10px]">پیش‌نویس</Badge>;
  return <Badge variant="secondary" className="text-[10px]">ثبت نشده</Badge>;
}

export function AdminLessonPlansPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-lesson-plans'], queryFn: getLessonPlans, staleTime: 15_000 });
  const [isRequired, setIsRequired] = useState(false);
  const [notice, setNotice] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setIsRequired(data.required);
    setNotice(data.notice ?? '');
  }, [data]);

  const refreshMut = useMutation({
    mutationFn: getLessonPlans,
    onSuccess: (fresh) => qc.setQueryData(['admin-lesson-plans'], fresh),
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  const saveMut = useMutation({
    mutationFn: () => saveLessonPlanSettings({ isRequired, notice }),
    onSuccess: async () => {
      setMsg({ kind: 'ok', text: 'تنظیمات الزام طرح درس ذخیره شد.' });
      await qc.invalidateQueries({ queryKey: ['admin-lesson-plans'] });
    },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت وضعیت طرح درس ناموفق بود.</CardContent></Card>;

  const total = data.rows.length;
  const submitted = data.rows.filter((r) => String(r.status).toUpperCase() === 'SUBMITTED').length;
  const pct = total === 0 ? 0 : Math.round((submitted / total) * 100);

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-900 via-indigo-950 to-slate-900 text-white">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-[11px] font-bold text-slate-950">{data.universityTitle || 'دانشگاه'}</span>
              <h1 className="mt-1 flex items-center gap-2 text-lg font-black"><ClipboardList className="size-5" aria-hidden /> پایش طرح درس ارائه‌ها</h1>
              <p className="mt-1 text-xs text-indigo-200">{faNumber(submitted)} از {faNumber(total)} ارائه ثبت نهایی شده‌اند ({faNumber(pct)}٪)</p>
            </div>
            <Button size="sm" variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20" disabled={refreshMut.isPending} onClick={() => refreshMut.mutate()}>
              <RefreshCw className="size-4" aria-hidden /> {refreshMut.isPending ? 'در حال به‌روزرسانی…' : 'به‌روزرسانی جدول'}
            </Button>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </CardContent>
      </Card>

      {msg ? (
        <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>{msg.text}</div>
      ) : null}

      <Card>
        <CardContent className="space-y-3 pt-4">
          <h2 className="text-sm font-black">الزام تکمیل طرح درس</h2>
          <p className="text-[11px] text-muted-foreground">این تنظیم فقط بنر اطلاع‌رسانی و فشار برای ثبت نهایی است؛ ذخیرهٔ پیش‌نویس همیشه آزاد است.</p>
          <label className="flex items-center gap-2 text-xs font-bold">
            <input type="checkbox" className="size-4 accent-indigo-600" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
            تکمیل طرح درس برای استادان الزامی باشد
          </label>
          <label className="block space-y-1 text-[10px] text-muted-foreground">
            <span>متن اطلاع‌رسانی (اختیاری)</span>
            <textarea value={notice} onChange={(e) => setNotice(e.target.value)} rows={2} maxLength={2000} className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-[11px]" />
          </label>
          <div className="flex justify-end">
            <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}><CheckCircle2 className="size-4" aria-hidden /> ذخیرهٔ تنظیمات</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-[11px]">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>{['درس', 'استاد', 'وضعیت', 'جلسات', 'جمع بارم', 'آخرین به‌روزرسانی'].map((h) => <th key={h} className="whitespace-nowrap p-2 text-right font-black">{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.rows.map((r) => <Row key={r.offeringId} r={r} />)}
                {data.rows.length === 0 ? <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">ارائه‌ای ثبت نشده است.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ r }: { r: LessonPlanRow }) {
  return (
    <tr className="border-t border-border/50">
      <td className="p-2 font-bold">{r.courseTitle}</td>
      <td className="p-2">{r.professorName}</td>
      <td className="p-2">{statusBadge(r.status)}</td>
      <td className="p-2 font-mono">{faNumber(r.sessionsCount)}</td>
      <td className="p-2 font-mono">{faNumber(r.weightsSum)}</td>
      <td className="p-2 font-mono text-[10px] text-muted-foreground" dir="ltr">{r.updatedAt ?? '—'}</td>
    </tr>
  );
}
