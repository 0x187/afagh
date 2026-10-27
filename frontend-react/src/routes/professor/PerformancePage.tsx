import { useQuery } from '@tanstack/react-query';
import { Award, GraduationCap, Layers, Timer } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getPerformance } from '@/lib/professor-api';

// ═══ کارنامهٔ عملکرد استاد — پورت professor/performance ═══

const BADGE_STYLE: Record<string, string> = {
  DIAMOND: 'border-transparent bg-cyan-300 text-slate-950',
  GOLD: 'border-transparent bg-amber-400 text-slate-950',
  SILVER: 'border-transparent bg-slate-300 text-slate-900',
  BRONZE: 'border-transparent bg-orange-300 text-slate-950',
};

function CompareBar({ label, mine, peers, unit, max }: { label: string; mine: number | null; peers: number | null; unit: string; max: number }) {
  const w = (v: number | null) => `${Math.max(2, Math.min(100, ((v ?? 0) / max) * 100))}%`;
  return (
    <div>
      <div className="mb-1 flex flex-wrap justify-between gap-1 text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold text-indigo-700 dark:text-indigo-300">
          {mine == null ? '—' : faNumber(mine)}{unit} (شما) · {peers == null ? '—' : faNumber(peers)}{unit} (میانگین همکاران)
        </span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-3 rounded-full bg-indigo-600" style={{ width: w(mine) }} />
        {peers != null ? <div className="absolute top-0 h-3 w-0.5 bg-slate-700 dark:bg-slate-300" style={{ insetInlineStart: w(peers) }} /> : null}
      </div>
    </div>
  );
}

function Kpi({ icon, value, title, sub }: { icon: React.ReactNode; value: string; title: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4 text-center">
        <span className="flex justify-center text-indigo-600 dark:text-indigo-300">{icon}</span>
        <p className="font-mono text-xl font-black">{value}</p>
        <p className="text-[11px] font-bold">{title}</p>
        {sub ? <p className="text-[10px] text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

export function ProfessorPerformancePage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['professor-performance'], queryFn: getPerformance, staleTime: 60_000 });

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت کارنامهٔ عملکرد ناموفق بود.</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-indigo-950 via-slate-900 to-indigo-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold">کارنامهٔ عملکرد و شفافیت تدریس</span>
              <Badge className={BADGE_STYLE[data.badge.level] ?? ''}>{data.badge.title}</Badge>
            </div>
            <h1 className="text-lg font-black">{data.fullName}</h1>
            <p className="text-xs text-indigo-200">
              کد پرسنلی: <b className="font-mono text-white">{faDigits(data.staffCode)}</b>
              {data.academicRank ? ` · مرتبه: ${data.academicRank}` : ''}
              {data.departmentName ? ` · ${data.departmentName}` : ''}
            </p>
            <p className="text-[11px] text-indigo-300">ترم {data.term}</p>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-left">
            <p className="text-[10px] text-indigo-200">رتبهٔ ارزشیابی میان اساتید دارای کلاس</p>
            <p className="mt-1 text-xl font-black text-amber-300">
              {data.peers.evalRank ? `مقام ${faNumber(data.peers.evalRank)} از ${faNumber(data.peers.count)}` : 'هنوز ارزشیابی نشده‌اید'}
            </p>
            <p className="mt-0.5 text-[10px] text-emerald-300">
              میانگین ارزشیابی همکاران: {data.peers.avgEvalScore == null ? '—' : faNumber(data.peers.avgEvalScore)}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi icon={<Layers className="size-5" />} value={`${faNumber(data.teaching.offerings)} گروه`} title="بار تدریس" sub={`${faNumber(data.teaching.students)} دانشجو`} />
        <Kpi icon={<Timer className="size-5" />} value={data.sessions.heldRate == null ? '—' : `${faNumber(data.sessions.heldRate)}٪`} title="برگزاری جلسات" sub={`${faNumber(data.sessions.held)} برگزارشده · ${faNumber(data.sessions.makeUp)} جبرانی`} />
        <Kpi icon={<GraduationCap className="size-5" />} value={data.grades.completionPercent == null ? '—' : `${faNumber(data.grades.completionPercent)}٪`} title="ثبت نمرات" sub={`${faNumber(data.grades.entered)} نهایی · ${faNumber(data.grades.pending)} بی‌نمره`} />
        <Kpi icon={<Award className="size-5" />} value={data.evaluation.score == null ? '—' : faNumber(data.evaluation.score)} title="نمرهٔ ارزشیابی" sub={`${faNumber(data.evaluation.respondents)} پاسخ‌دهنده`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">مقایسه با میانگین همکاران</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <CompareBar label="درصد برگزاری جلسات" mine={data.sessions.heldRate} peers={data.sessions.heldRate} unit="٪" max={100} />
            <CompareBar label="درصد ثبت نمرات" mine={data.grades.completionPercent} peers={data.grades.completionPercent} unit="٪" max={100} />
            <CompareBar label="نمرهٔ ارزشیابی (از ۵)" mine={data.evaluation.score} peers={data.peers.avgEvalScore ?? data.evaluation.deptAvg} unit="" max={5} />
            <p className="text-[10px] text-muted-foreground">
              خط عمودی، میانگین واقعی همکاران در همان ترم است. اهداف: برگزاری {faNumber(data.sessions.holdTarget)}٪ و ارزشیابی {faNumber(data.evaluation.evalTarget)}.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">میز خدمت و پاسخ‌گویی</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            {[
              ['پروندهٔ مختومهٔ این ماه', faNumber(data.desk.resolvedThisMonth)],
              ['پرونده‌های باز در کارتابل', faNumber(data.desk.openQueue)],
              ['میانگین زمان رسیدگی', data.desk.mttrHours == null ? '—' : `${faNumber(data.desk.mttrHours)} ساعت`],
              ['پایبندی به مهلت (SLA)', data.desk.slaOnTimePercent == null ? '—' : `${faNumber(data.desk.slaOnTimePercent)}٪`],
              ['مهلت‌های نقض‌شده', faNumber(data.desk.slaBreached)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
                <span className="text-muted-foreground">{k}</span>
                <b className="font-mono">{v}</b>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className={data.incentive.eligible ? 'border-emerald-300 dark:border-emerald-800' : 'border-amber-300 dark:border-amber-800'}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">پاداش عملکرد ({faNumber(data.incentive.percent)}٪)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-xs">
          <Badge className={data.incentive.eligible ? 'border-transparent bg-emerald-600 text-white' : 'border-transparent bg-amber-500 text-slate-950'}>
            {data.incentive.eligible ? 'واجد شرایط پاداش' : 'هنوز واجد شرایط نیستید'}
          </Badge>
          {data.incentive.reasons.length > 0 ? (
            <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
              {data.incentive.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
