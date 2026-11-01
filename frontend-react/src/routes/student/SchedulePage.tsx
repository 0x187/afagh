import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, GraduationCap, MapPin, User } from 'lucide-react';

import { WeekGrid, type WeekGridEntry } from '@/components/schedule/WeekGrid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { collapseCalendarEntries, filterByWeek, type CalendarWeekFilter } from '@/lib/calendar-layout';
import { faDigits } from '@/lib/fa';
import { getStudentSchedule, type StudentScheduleCourse } from '@/lib/student-api';

// ═══ Student weekly schedule — port of student/schedule (server + ScheduleClient) ═══
// Data from /api/v2/student/schedule; layout via the calendar-layout core.

const FILTER_LABELS: Record<CalendarWeekFilter, string> = {
  ALL: 'همه',
  EVEN: 'هفته زوج',
  ODD: 'هفته فرد',
};

const STATUS_LABELS: Record<string, string> = {
  REGISTERED: 'ثبت نهایی',
  FINALIZED: 'ثبت نهایی',
  WAITLISTED: 'ذخیره',
  PENDING_COUNCIL: 'در انتظار شورا',
};

function courseEntries(courses: StudentScheduleCourse[]): WeekGridEntry[] {
  const out: WeekGridEntry[] = [];
  for (const c of courses) {
    for (const cls of c.classes) {
      out.push({
        id: c.offeringId,
        dayOfWeek: cls.dayOfWeek,
        startTime: cls.startTime,
        endTime: cls.endTime,
        weekType: cls.weekType,
        code: c.code,
        title: c.title,
        groupNumber: c.group,
        roomName: cls.room,
        buildingName: cls.building,
        professorName: c.professor,
        courseType: c.courseType,
        sharedScheduleGroupKey: c.sharedScheduleGroupKey,
      });
    }
  }
  return collapseCalendarEntries(out);
}

export function StudentSchedulePage() {
  const [filter, setFilter] = useState<CalendarWeekFilter>('ALL');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-schedule'],
    queryFn: () => getStudentSchedule(),
    staleTime: 60_000,
  });

  const entries = useMemo(() => {
    const all = courseEntries(data?.courses ?? []);
    return filterByWeek(all, filter);
  }, [data, filter]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">دریافت برنامهٔ هفتگی ناموفق بود.</CardContent></Card>;
  }

  const s = data.student;

  return (
    <div className="space-y-4">
      {/* Info header */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <GraduationCap className="size-6" aria-hidden />
            </div>
            <div>
              <div className="text-base font-black">{s.name}</div>
              <div className="text-xs text-muted-foreground">
                {s.majorName} — {s.degreeTitle}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="accent">شماره دانشجویی: {faDigits(s.studentCode)}</Badge>
            <Badge variant="secondary">ترم {faDigits(s.currentTermNo)}</Badge>
            <Badge variant="outline">
              <CalendarDays aria-hidden /> {data.term.title} ({faDigits(data.term.termCode)})
            </Badge>
          </div>
          <div className="ms-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
            {(Object.keys(FILTER_LABELS) as CalendarWeekFilter[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? 'default' : 'ghost'}
                onClick={() => setFilter(f)}
              >
                {FILTER_LABELS[f]}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Weekly grid */}
      {(data.courses.length === 0 || entries.length === 0) ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {data.courses.length === 0
              ? `برای نیمسال «${data.term.title}» هیچ درس ثبت‌نام‌شده‌ای ندارید؛ برنامهٔ هفتگی و زمان‌بندی امتحان نمایش داده نمی‌شود.`
              : 'در فیلتر انتخابی جلسه‌ای وجود ندارد.'}
          </CardContent>
        </Card>
      ) : (
        <WeekGrid entries={entries} />
      )}

      {/* Course list */}
      {data.courses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>دروس این نیمسال ({faDigits(data.courses.length)} درس)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.courses.map((c) => (
              <div key={c.enrollmentId} className="rounded-xl border border-border bg-card p-3 text-xs shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">
                    {c.code} — {c.title}
                  </span>
                  <Badge variant="secondary">{faDigits(c.units)} واحد</Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-muted-foreground">
                  <span className="flex items-center gap-1"><User className="size-3" aria-hidden />{c.professor}</span>
                  <span>گروه {faDigits(c.group)}</span>
                  <Badge variant={c.status === 'WAITLISTED' ? 'warning' : 'success'}>
                    {STATUS_LABELS[c.status] ?? c.status}
                  </Badge>
                </div>
                {c.classes.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                    {c.classes.map((cls, i) => (
                      <span key={i} className="rounded bg-muted px-1.5 py-0.5">
                        {cls.dayName} {cls.startTime.slice(0, 5)}–{cls.endTime.slice(0, 5)}
                        {cls.room ? ` · ${cls.room}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Exams */}
      {data.courses.some((c) => c.exam) && (
        <Card>
          <CardHeader>
            <CardTitle>زمان‌بندی امتحان‌ها</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.courses.filter((c) => c.exam).map((c) => (
              <div key={c.enrollmentId} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border px-3 py-2 text-xs">
                <span className="font-bold">{c.code} — {c.title}</span>
                <span className="text-muted-foreground">{c.exam!.examDate}</span>
                <span className="text-muted-foreground">
                  {c.exam!.startTime.slice(0, 5)}–{c.exam!.endTime.slice(0, 5)}
                </span>
                {c.exam!.room ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <MapPin className="size-3" aria-hidden /> {c.exam!.room}
                  </span>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
