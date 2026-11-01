import { useQuery } from '@tanstack/react-query';
import {
  BookOpenCheck,
  CalendarDays,
  ClipboardList,
  FileSignature,
  GraduationCap,
  MonitorPlay,
  ScrollText,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { WeekGrid, type WeekGridEntry } from '@/components/schedule/WeekGrid';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getProfessorDashboard, type ProfScheduleRow } from '@/lib/professor-api';

// ═══ Professor dashboard — port of professor/page.tsx ═══

export function scheduleEntries(rows: ProfScheduleRow[]): WeekGridEntry[] {
  return rows
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
}

const QUICK = [
  { to: '/professor/attendance', label: 'حضور و غیاب', icon: ClipboardList, tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  { to: '/professor/grades', label: 'دفترچهٔ نمرات', icon: ScrollText, tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' },
  { to: '/professor/schedule', label: 'برنامهٔ هفتگی', icon: CalendarDays, tone: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  { to: '/professor/evaluation', label: 'ارزشیابی من', icon: BookOpenCheck, tone: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  { to: '/professor/performance', label: 'عملکرد آموزشی', icon: GraduationCap, tone: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' },
  { to: '/professor/availability', label: 'ساعات حضور', icon: CalendarDays, tone: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' },
  { to: '/professor/contract', label: 'قرارداد تدریس', icon: FileSignature, tone: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300' },
  { to: '/professor/broadcast', label: 'پیام به کلاس', icon: Wallet, tone: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
];

export function ProfessorDashboardPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['professor-dashboard'], queryFn: getProfessorDashboard, staleTime: 30_000 });

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت داشبورد استاد ناموفق بود.</CardContent></Card>;
  }

  const p = data.professor;
  const contractLabel =
    data.stats.contractStatus === 'SIGNED' ? 'امضا شده' : data.stats.contractStatus === 'PENDING' ? 'در انتظار امضا' : 'ثبت نشده';

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-0 bg-gradient-to-l from-indigo-700 via-indigo-600 to-sky-600 text-white shadow-lg">
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <GraduationCap className="size-7" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-black">{p.name}</h1>
              <Badge className="border-transparent bg-white/15 text-white">{p.academicRank ?? 'هیئت علمی'}</Badge>
              {p.departmentName ? <Badge className="border-transparent bg-white/15 text-white">{p.departmentName}</Badge> : null}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/85">
              <span>کد پرسنلی: <b className="font-mono">{faDigits(p.staffCode)}</b></span>
              <span>نیمسال: <b>{data.term.title || '—'}</b></span>
              <span>{data.university.title}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-4 overflow-hidden rounded-2xl border border-border bg-card shadow-xs [&>*+*]:border-s border-border">
        {[
          ['📚', `${faNumber(data.stats.classCount)} گروه`, 'کلاس‌ها'],
          ['⏰', data.stats.availabilityCount > 0 ? `${faNumber(data.stats.availabilityCount)} بازه` : 'ثبت نشده', 'ساعات حضور'],
          ['📑', contractLabel, 'قرارداد'],
          ['🗓️', data.stats.gradeDeadline ? faDigits(data.stats.gradeDeadline.slice(0, 10)) : 'تعیین نشده', 'مهلت نمرات'],
        ].map(([icon, value, label]) => (
          <div key={label} className="px-1.5 py-2.5 text-center">
            <div className="text-base leading-none">{icon}</div>
            <div className="mt-1 truncate text-[11px] font-extrabold">{value}</div>
            <div className="truncate text-[10px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {QUICK.map((q) => {
          const Icon = q.icon;
          return (
            <Link key={q.to} to={q.to} className="group rounded-2xl border border-border bg-card p-3 shadow-xs transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <span className={`flex size-9 items-center justify-center rounded-xl ${q.tone}`}>
                <Icon className="size-4.5" aria-hidden />
              </span>
              <p className="mt-2 text-xs font-black">{q.label}</p>
            </Link>
          );
        })}
      </div>

      {data.vcConfigured ? (
        <Card>
          <CardHeader className="flex-row items-center gap-2 border-b border-border/70 pb-3">
            <MonitorPlay className="size-4 text-sky-600" aria-hidden />
            <CardTitle className="text-sm">کلاس‌های آنلاین و جلسات وبینار</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-3">
            {data.liveSessions.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 p-3">
                <div>
                  <p className="flex items-center gap-2 text-xs font-black">
                    <span className={`size-2 rounded-full ${s.isRunning ? 'animate-pulse bg-emerald-500' : 'bg-amber-400'}`} />
                    {s.courseTitle}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    اتاق: <span dir="ltr">{s.meetingId}</span> · {faNumber(s.activeParticipantsCount)} شرکت‌کننده · {faNumber(s.recordingsCount)} ضبط
                  </p>
                </div>
                <Badge className={s.isRunning ? 'border-transparent bg-emerald-600 text-white' : 'border-transparent bg-secondary text-secondary-foreground'}>
                  {s.isRunning ? 'در حال برگزاری' : 'غیرفعال'}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {data.cards.length > 0 ? (
        <section className="space-y-2">
          <h2 className="px-1 text-sm font-black">کلاس‌های این نیمسال</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.cards.map((c) => (
              <Card key={c.key}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-bold" dir="ltr">{c.code}</span>
                        <Badge variant="outline" className="text-[10px]">گروه {faDigits(c.group)}</Badge>
                        <Badge variant="outline" className="text-[10px]">{faNumber(c.units)} واحد</Badge>
                      </div>
                      <h3 className="mt-1 text-sm font-black">{c.title}</h3>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{c.roomLine} · {c.timeLine}</p>
                  {c.isCoTaught ? <p className="text-[11px] text-violet-700 dark:text-violet-300">درس مشترک با {c.coTeacherName ?? 'همکار'}</p> : null}
                  <p className="text-[11px] text-muted-foreground">
                    ظرفیت: <b className="text-foreground">{faNumber(c.enrolled)}</b> / {faNumber(c.capacity)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between border-b border-border/70 pb-3">
          <CardTitle className="text-sm">برنامهٔ هفتگی</CardTitle>
          <Link to="/professor/schedule" className="rounded-lg bg-secondary px-2.5 py-1 text-[11px] font-bold">جزئیات کامل ←</Link>
        </CardHeader>
        <CardContent className="pt-3">
          <WeekGrid entries={scheduleEntries(data.weekRows)} />
        </CardContent>
      </Card>
    </div>
  );
}
