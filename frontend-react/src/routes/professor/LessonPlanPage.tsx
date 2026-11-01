import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, Save, Send, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import {
  getProfessorPlan,
  getProfessorSchedule,
  saveProfessorPlan,
  type ProfPlanData,
} from '@/lib/professor-api';

// ═══ Professor lesson-plan editor — port of professor/lesson-plan ═══

const KIND_LABEL: Record<string, string> = { THEORY: 'نظری', PRACTICAL: 'عملی', COMBINED: 'ترکیبی' };
const MODE_LABEL: Record<string, string> = { THEORY: 'نظری', PRACTICAL: 'عملی', COMBINED: 'ترکیبی' };

type SessionDraft = { sessionNo: number; sessionKind: string; topic: string; details: string; weightId: number | null };

function Editor({ data }: { data: ProfPlanData }) {
  const qc = useQueryClient();
  const [courseMode, setCourseMode] = useState(data.plan?.courseMode ?? data.courseModeDefault);
  const [total, setTotal] = useState(data.plan?.totalSessions ?? 16);
  const [objectives, setObjectives] = useState(data.plan?.objectives ?? '');
  const [resources, setResources] = useState(data.plan?.resources ?? '');
  const [weights, setWeights] = useState(data.weights.length ? data.weights.map((w) => ({ title: w.title, percent: w.percent })) : [{ title: 'میان‌ترم', percent: 30 }, { title: 'پایان‌ترم', percent: 50 }, { title: 'فعالیت', percent: 20 }]);
  const [sessions, setSessions] = useState<SessionDraft[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const existing = new Map(data.sessions.map((s) => [s.sessionNo, s]));
    const rows: SessionDraft[] = [];
    for (let i = 1; i <= total; i++) {
      const ex = existing.get(i);
      rows.push({
        sessionNo: i,
        sessionKind: ex?.sessionKind ?? 'THEORY',
        topic: ex?.topic ?? '',
        details: ex?.details ?? '',
        weightId: ex?.weightId ?? null,
      });
    }
    setSessions(rows);
  }, [data.sessions, total]);

  const saveMut = useMutation({
    mutationFn: (status: 'DRAFT' | 'SUBMITTED') =>
      saveProfessorPlan(data.offeringId, {
        courseMode,
        totalSessions: total,
        objectives,
        resources,
        status,
        sessions,
        weights,
      }),
    onSuccess: async (_r, status) => {
      setMsg(status === 'SUBMITTED' ? 'طرح درس ثبت نهایی شد و برای دانشجویان قابل مشاهده است.' : 'پیش‌نویس ذخیره شد.');
      await qc.invalidateQueries({ queryKey: ['professor-plan', data.offeringId] });
      await qc.invalidateQueries({ queryKey: ['professor-plans'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const weightTotal = weights.reduce((s, w) => s + (Number(w.percent) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 shadow-xs">
        <div>
          <h1 className="text-sm font-black">طرح درس — {data.courseTitle}</h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            وضعیت فعلی: {data.plan ? (data.plan.status === 'SUBMITTED' ? 'ثبت نهایی‌شده' : 'پیش‌نویس') : 'بدون طرح'}
            {data.plan?.submittedAt ? ` · انتشار: ${data.plan.submittedAt.slice(0, 10)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={saveMut.isPending} onClick={() => saveMut.mutate('DRAFT')}>
            <Save className="size-4" aria-hidden /> ذخیرهٔ پیش‌نویس
          </Button>
          <Button size="sm" disabled={saveMut.isPending || weightTotal !== 100} onClick={() => saveMut.mutate('SUBMITTED')}>
            <Send className="size-4" aria-hidden /> ثبت نهایی
          </Button>
        </div>
      </div>

      {data.required ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          تکمیل طرح درس برای این دانشگاه الزامی است.{data.notice ? ` ${data.notice}` : ''}
        </div>
      ) : null}

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">مشخصات کلی</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>حالت درس</Label>
              <select value={courseMode} onChange={(e) => setCourseMode(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <Label>تعداد جلسات</Label>
              <Input type="number" min={1} max={32} value={total} onChange={(e) => setTotal(Math.max(1, Math.min(32, Number(e.target.value) || 1)))} className="mt-1" />
            </div>
            <div>
              <Label>اهداف درس</Label>
              <textarea value={objectives} onChange={(e) => setObjectives(e.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm" placeholder="اهداف آموزشی و انتظارات از دانشجو…" />
            </div>
            <div>
              <Label>منابع</Label>
              <textarea value={resources} onChange={(e) => setResources(e.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm" placeholder="کتاب‌ها، جزوات و منابع مرجع…" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">وزن ارزشیابی</CardTitle>
            <Badge className={weightTotal === 100 ? 'border-transparent bg-emerald-600 text-white' : 'border-transparent bg-rose-600 text-white'}>
              جمع: {faNumber(weightTotal)}٪
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {weights.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={w.title} onChange={(e) => setWeights((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="عنوان مؤلفه" className="h-8 text-xs" />
                <Input type="number" min={0} max={100} value={w.percent} onChange={(e) => setWeights((prev) => prev.map((x, j) => (j === i ? { ...x, percent: Number(e.target.value) } : x)))} className="h-8 w-20 text-center text-xs" />
                <span className="text-xs">٪</span>
                <button type="button" aria-label="حذف" onClick={() => setWeights((prev) => prev.filter((_, j) => j !== i))} className="rounded p-1 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950">
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setWeights((prev) => [...prev, { title: '', percent: 0 }])}>
              <Plus className="size-4" aria-hidden /> افزودن مؤلفه
            </Button>
            <p className="text-[10px] text-muted-foreground">جمع درصدها برای ثبت نهایی باید دقیقاً ۱۰۰ باشد.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><BookOpen className="size-4 text-indigo-600" aria-hidden /> جلسات ({faNumber(sessions.length)})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-[11px]">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                <th className="p-1.5 text-center">جلسه</th>
                <th className="p-1.5 text-center">نوع</th>
                <th className="p-1.5">موضوع</th>
                <th className="p-1.5">توضیحات</th>
                <th className="p-1.5 text-center">مؤلفه</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={s.sessionNo} className="border-b border-border/50 last:border-0">
                  <td className="p-1.5 text-center font-mono">{faNumber(s.sessionNo)}</td>
                  <td className="p-1.5">
                    <select value={s.sessionKind} onChange={(e) => setSessions((prev) => prev.map((x, j) => (j === i ? { ...x, sessionKind: e.target.value } : x)))} className="h-7 w-full rounded border border-input bg-transparent px-1 text-[10px]">
                      {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td className="p-1.5"><Input value={s.topic} onChange={(e) => setSessions((prev) => prev.map((x, j) => (j === i ? { ...x, topic: e.target.value } : x)))} className="h-7 text-[11px]" placeholder="موضوع جلسه" /></td>
                  <td className="p-1.5"><Input value={s.details} onChange={(e) => setSessions((prev) => prev.map((x, j) => (j === i ? { ...x, details: e.target.value } : x)))} className="h-7 text-[11px]" placeholder="توضیحات (اختیاری)" /></td>
                  <td className="p-1.5">
                    <select
                      value={s.weightId ?? ''}
                      onChange={(e) => setSessions((prev) => prev.map((x, j) => (j === i ? { ...x, weightId: e.target.value === '' ? null : Number(e.target.value) } : x)))}
                      className="h-7 w-full rounded border border-input bg-transparent px-1 text-[10px]"
                    >
                      <option value="">—</option>
                      {data.weights.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
                    </select>
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

export function ProfessorLessonPlanPage() {
  const { offeringId } = useParams<{ offeringId?: string }>();
  const navigate = useNavigate();
  const selected = Number(offeringId ?? 0) || null;
  const schedule = useQuery({ queryKey: ['professor-schedule'], queryFn: getProfessorSchedule, staleTime: 60_000 });

  const offerings = useMemo(() => {
    const map = new Map<number, { id: number; code: string; title: string }>();
    for (const r of schedule.data?.rows ?? []) {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, code: r.code, title: r.title });
    }
    return [...map.values()];
  }, [schedule.data]);

  useEffect(() => {
    if (!selected && offerings[0]) {
      navigate(`/professor/lesson-plan/${offerings[0].id}`, { replace: true });
    }
  }, [selected, offerings, navigate]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['professor-plan', selected],
    queryFn: () => getProfessorPlan(selected!),
    enabled: !!selected,
    staleTime: 30_000,
  });

  if (schedule.isLoading || (selected && isLoading)) {
    return <div className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-72 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت طرح درس ناموفق بود.</CardContent></Card>;
  }

  return (
    <div className="space-y-3">
      <div className="no-print">
        <label className="text-xs font-bold" htmlFor="plan-course">درس</label>
        <select
          id="plan-course"
          value={selected ?? ''}
          onChange={(e) => navigate(`/professor/lesson-plan/${e.target.value}`)}
          className="mt-1 h-9 w-full max-w-md rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {offerings.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.title}</option>)}
        </select>
      </div>
      <Editor data={data} />
    </div>
  );
}
