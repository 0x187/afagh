import { useQuery } from '@tanstack/react-query';
import { BookOpen, ClipboardList, Target } from 'lucide-react';
import { useParams } from 'react-router-dom';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getLessonPlan } from '@/lib/student-api';

// ═══ طرح درس (سرفصل) دانشجو — پورت student/lesson-plan/[offeringId] ═══
export function StudentLessonPlanPage() {
  const { offeringId } = useParams<{ offeringId: string }>();
  const id = Number(offeringId ?? 0);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-lesson-plan', id],
    queryFn: () => getLessonPlan(id),
    enabled: id > 0,
    staleTime: 60_000,
  });

  if (!id) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">شناسهٔ ارائهٔ درس نامعتبر است.</CardContent></Card>;
  }
  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت طرح درس ناموفق بود.</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-indigo-700 to-sky-700 text-white">
        <CardContent className="p-5">
          <p className="text-[11px] text-white/75">طرح درس منتشرشده</p>
          <h1 className="mt-1 text-lg font-black">{data.courseTitle}</h1>
          {data.plan ? (
            <p className="mt-1 text-xs text-white/85">
              {data.plan.courseMode ? `${data.plan.courseMode} · ` : ''}
              {faNumber(data.plan.totalSessions)} جلسه
              {data.plan.submittedAt ? ` · انتشار: ${faDigits(data.plan.submittedAt.slice(0, 10))}` : ''}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {!data.published || !data.plan ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            طرح درس این ارائه هنوز منتشر نشده است.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm"><Target className="size-4 text-emerald-600" aria-hidden /> اهداف درس</CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {data.plan.objectives || '—'}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm"><BookOpen className="size-4 text-sky-600" aria-hidden /> منابع</CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {data.plan.resources || '—'}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm"><ClipboardList className="size-4 text-indigo-600" aria-hidden /> سرفصل جلسات</CardTitle>
            </CardHeader>
            <CardContent>
              {data.sessions.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">جلسه‌ای ثبت نشده است.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="p-2">جلسه</th>
                        <th className="p-2">نوع</th>
                        <th className="p-2">موضوع</th>
                        <th className="p-2">توضیحات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sessions.map((s) => (
                        <tr key={s.id} className="border-b border-border/60 last:border-0">
                          <td className="p-2 font-mono">{faNumber(s.sessionNo)}</td>
                          <td className="p-2">{s.sessionKind === 'LAB' ? 'آزمایشگاه' : s.sessionKind === 'TUTORIAL' ? 'حل تمرین' : 'نظری'}</td>
                          <td className="p-2 font-bold">{s.topic || '—'}</td>
                          <td className="p-2 text-muted-foreground">{s.details || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {data.weights.length > 0 ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">وزن ارزشیابی</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.weights.map((w) => (
                  <div key={w.id} className="flex items-center gap-2 text-xs">
                    <span className="w-40 shrink-0 truncate font-medium">{w.title}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, w.percent)}%` }} />
                    </div>
                    <span className="w-12 text-left font-mono font-bold">{faNumber(w.percent)}٪</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
