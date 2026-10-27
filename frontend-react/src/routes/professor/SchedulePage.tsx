import { useQuery } from '@tanstack/react-query';
import { CalendarDays, MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';

import { WeekGrid, type WeekGridEntry } from '@/components/schedule/WeekGrid';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { collapseCalendarEntries, filterByWeek, type CalendarWeekFilter } from '@/lib/calendar-layout';
import { faDigits, faNumber } from '@/lib/fa';
import { getProfessorSchedule } from '@/lib/professor-api';

// ═══ برنامهٔ هفتگی استاد — پورت professor/schedule ═══

const FILTERS: { key: CalendarWeekFilter; label: string }[] = [
  { key: 'ALL', label: 'همه' },
  { key: 'EVEN', label: 'هفته زوج' },
  { key: 'ODD', label: 'هفته فرد' },
];

export function ProfessorSchedulePage() {
  const [filter, setFilter] = useState<CalendarWeekFilter>('ALL');
  const { data, isLoading, isError } = useQuery({ queryKey: ['professor-schedule'], queryFn: getProfessorSchedule, staleTime: 60_000 });

  const entries: WeekGridEntry[] = useMemo(() => {
    const list = (data?.rows ?? [])
      .filter((r) => r.hasSchedule && r.dayOfWeek != null)
      .map((r) => ({
        id: r.id,
        dayOfWeek: r.dayOfWeek,
        startTime: r.startTime,
        endTime: r.endTime,
        weekType: r.weekType,
        code: r.code,
        title: r.title,
        groupNumber: r.group,
        roomName: r.roomName,
        buildingName: r.buildingName,
        professorName: '',
        courseType: r.courseType,
        sharedScheduleGroupKey: null,
      }));
    return filterByWeek(collapseCalendarEntries(list), filter);
  }, [data, filter]);

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت برنامهٔ استاد ناموفق بود.</CardContent></Card>;
  }

  const p = data.professor;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-indigo-700 to-sky-600 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15">
              <CalendarDays className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-base font-black">برنامهٔ هفتگی استاد</h1>
              <p className="mt-0.5 text-xs text-white/85">
                {p.name} · کد پرسنلی {faDigits(p.staffCode)} · {data.term.title || '—'}
              </p>
            </div>
          </div>
          <div className="flex gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${filter === f.key ? 'bg-white text-indigo-900' : 'bg-white/10 text-white hover:bg-white/20'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <WeekGrid entries={entries} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">فهرست کلاس‌ها</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                <th className="p-2">کد</th>
                <th className="p-2">درس</th>
                <th className="p-2 text-center">گروه</th>
                <th className="p-2 text-center">واحد</th>
                <th className="p-2">زمان</th>
                <th className="p-2">مکان</th>
                <th className="p-2 text-center">ظرفیت</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={`${r.id}-${i}`} className="border-b border-border/50 last:border-0">
                  <td className="p-2 font-mono" dir="ltr">{r.code}</td>
                  <td className="p-2 font-semibold">{r.title}</td>
                  <td className="p-2 text-center">{faDigits(r.group)}</td>
                  <td className="p-2 text-center">{faNumber(r.units)}</td>
                  <td className="p-2">
                    {r.hasSchedule ? `${r.dayName} ${faDigits(r.startTime)}–${faDigits(r.endTime)}` : 'ثبت نشده'}
                  </td>
                  <td className="p-2">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <MapPin className="size-3" aria-hidden /> {r.roomName || '—'}
                    </span>
                  </td>
                  <td className="p-2 text-center">
                    <Badge variant="secondary">{faNumber(r.enrolledCount)} / {faNumber(r.capacity)}</Badge>
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
