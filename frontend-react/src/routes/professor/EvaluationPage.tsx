import { useQuery } from '@tanstack/react-query';
import { BarChart3, MessageSquareText } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import { getEvaluation } from '@/lib/professor-api';

// ═══ کارنامهٔ ارزشیابی استاد — پورت professor/evaluation ═══

function Radar({ axes }: { axes: { label: string; mine: number | null; dept: number | null }[] }) {
  if (axes.length < 3) {
    return <p className="py-6 text-center text-xs text-muted-foreground">برای رسم رادار حداقل سه شاخص لازم است.</p>;
  }
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 62;
  const max = 5;
  const pt = (i: number, v: number): [number, number] => {
    const ang = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    const r = (Math.max(0, Math.min(max, v)) / max) * R;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  };
  const poly = (key: 'mine' | 'dept') =>
    axes.map((a, i) => pt(i, a[key] ?? 0).map((n) => n.toFixed(1)).join(',')).join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto max-w-full" role="img" aria-label="نمودار راداری شاخص‌ها">
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon
          key={k}
          points={axes.map((_, i) => pt(i, max * k).map((n) => n.toFixed(1)).join(',')).join(' ')}
          fill="none"
          stroke="currentColor"
          className="text-border"
          strokeWidth={1}
        />
      ))}
      {axes.map((a, i) => {
        const [x, y] = pt(i, max);
        const [lx, ly] = pt(i, max * 1.2);
        return (
          <g key={a.label}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="currentColor" className="text-border" strokeWidth={1} />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="currentColor" className="text-muted-foreground">
              {a.label}
            </text>
          </g>
        );
      })}
      <polygon points={poly('dept')} fill="rgba(148,163,184,0.15)" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4,3" />
      <polygon points={poly('mine')} fill="rgba(99,102,241,0.28)" stroke="#6366f1" strokeWidth={2} />
      {axes.map((a, i) => {
        const [x, y] = pt(i, a.mine ?? 0);
        return <circle key={a.label} cx={x} cy={y} r={3} fill="#818cf8" />;
      })}
    </svg>
  );
}

export function ProfessorEvaluationPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['professor-evaluation'], queryFn: getEvaluation, staleTime: 60_000 });

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-80 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت کارنامهٔ ارزشیابی ناموفق بود.</CardContent></Card>;
  }

  const hasAny = data.axes.length > 0 || data.trend.length > 0 || data.words.length > 0 || data.respondents > 0;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-indigo-950 via-slate-900 to-indigo-900 text-white">
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold">کارنامهٔ ارزشیابی من</span>
            {data.flagged ? <Badge className="border-transparent bg-rose-500 text-white">زیر آستانهٔ بحرانی</Badge> : null}
          </div>
          <h1 className="text-lg font-black">{data.name}{data.rank ? ` — ${data.rank}` : ''}</h1>
          <p className="text-xs text-indigo-200">
            {data.department ? `${data.department} · ` : ''}ترم {data.term}{data.period ? ` · دورهٔ ${data.period}` : ''}
          </p>
          {hasAny ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['نمرهٔ من', data.score == null ? '—' : faNumber(data.score), data.flagged ? 'text-rose-300' : 'text-emerald-300'],
                ['میانگین گروه', data.deptAvg == null ? '—' : faNumber(data.deptAvg), 'text-slate-200'],
                ['پاسخ‌دهنده', faNumber(data.respondents), 'text-indigo-200'],
                ['آستانهٔ بحرانی', faNumber(data.threshold), 'text-amber-300'],
              ].map(([k, v, cls]) => (
                <div key={k} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[11px] text-indigo-200/80">{k}</div>
                  <div className={`mt-1 font-mono text-2xl font-extrabold ${cls}`}>{v}</div>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!hasAny ? (
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <p className="text-4xl">📈</p>
            <h2 className="text-sm font-black">هنوز داده‌ای ثبت نشده است</h2>
            <p className="mx-auto max-w-md text-xs leading-6 text-muted-foreground">
              تا این لحظه پاسخ ارزشیابی‌ای برای شما ثبت نشده است. پس از اجرای دورهٔ ارزشیابی توسط ادارهٔ آموزش،
              نمره و شاخص‌ها همین‌جا نمایش داده می‌شود.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">شاخص‌ها (مقایسه با میانگین گروه)</CardTitle></CardHeader>
            <CardContent>
              <Radar axes={data.axes} />
              <div className="mt-2 flex flex-wrap justify-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-indigo-500" /> من</span>
                <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-slate-400" /> میانگین گروه</span>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><BarChart3 className="size-4 text-indigo-600" aria-hidden /> روند نمره</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.trend.length === 0 ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">دادهٔ روندی موجود نیست.</p>
                ) : (
                  data.trend.slice(-6).map((t, i) => (
                    <div key={`${t.period}-${i}`} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="truncate">{t.period} <span className="text-muted-foreground">({t.term})</span></span>
                        <b className="font-mono">{t.score == null ? '—' : faNumber(t.score)}</b>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, ((t.score ?? 0) / 5) * 100)}%` }} />
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><MessageSquareText className="size-4 text-emerald-600" aria-hidden /> واژه‌های پرتکرار نظرات</CardTitle></CardHeader>
              <CardContent>
                {data.words.length === 0 ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">نظر تشریحی ثبت نشده است.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {data.words.map((w) => (
                      <span key={w.word} className="rounded-lg bg-secondary px-2 py-1 text-[11px] font-bold text-secondary-foreground">
                        {w.word} <span className="text-muted-foreground">({faNumber(w.count)})</span>
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
