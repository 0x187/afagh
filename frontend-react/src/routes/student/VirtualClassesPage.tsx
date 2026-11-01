import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarClock, MonitorPlay, Radio, Users, Video } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getVirtualClasses, joinVirtualClass } from '@/lib/student-api';

// ═══ Student online classes — port of student/virtual-classes ═══
export function StudentVirtualClassesPage() {
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-virtual-classes'],
    queryFn: getVirtualClasses,
    staleTime: 30_000,
  });
  const joinMut = useMutation({
    mutationFn: joinVirtualClass,
    onSuccess: (url) => {
      // Only open absolute HTTP(S) links returned by the API, and isolate the
      // new tab from this window (noopener/noreferrer).
      if (url && /^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
    },
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }

  const sessions = data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-emerald-700/50 bg-emerald-900 p-6 text-white shadow-xl">
        <div>
          <span className="rounded-full bg-emerald-400 px-3 py-1 text-xs font-bold text-slate-950">کلاس آنلاین</span>
          <h1 className="mt-2 text-xl font-black sm:text-2xl">کلاس‌های آنلاین من</h1>
          <p className="mt-1 text-xs text-emerald-200">
            ورود تک‌کلیکه با احراز هویت خودکار (SSO) · ثبت حضور در دفتر نمره
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-[11px] text-emerald-100">
          <span className="flex items-center gap-1"><Radio className="size-3" aria-hidden /> {faNumber(sessions.filter((s) => s.isRunning).length)} جلسهٔ در حال برگزاری</span>
          <span className="flex items-center gap-1"><Video className="size-3" aria-hidden /> {faNumber(sessions.reduce((n, s) => n + s.recordingsCount, 0))} ضبط موجود</span>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100">
          {error}
        </div>
      ) : null}

      {isError ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت جلسات کلاس مجازی ناموفق بود.</CardContent></Card>
      ) : sessions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            برای دروس این نیمسال جلسهٔ کلاس مجازی ثبت نشده است.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sessions.map((s) => (
            <Card key={`${s.courseId}-${s.meetingId}`} className={s.isRunning ? 'border-emerald-300 dark:border-emerald-800' : ''}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-bold" dir="ltr">{s.courseCode}</span>
                      {s.isRunning ? (
                        <Badge className="border-transparent bg-emerald-600 text-white">
                          <span className="me-1 size-1.5 animate-pulse rounded-full bg-white" /> در حال برگزاری
                        </Badge>
                      ) : (
                        <Badge variant="secondary">غیرفعال</Badge>
                      )}
                    </div>
                    <h3 className="mt-1 truncate text-sm font-black">{s.courseTitle}</h3>
                    <p className="text-[11px] text-muted-foreground">استاد: {s.professorName || 'نامشخص'}</p>
                  </div>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                    <MonitorPlay className="size-4" aria-hidden />
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><CalendarClock className="size-3" aria-hidden /> {faDigits(s.startTime)} – {faDigits(s.endTime)}</span>
                  <span className="flex items-center gap-1"><Users className="size-3" aria-hidden /> {faNumber(s.activeParticipantsCount)} شرکت‌کننده</span>
                  {s.recordingsCount > 0 ? <span className="flex items-center gap-1"><Video className="size-3" aria-hidden /> {faNumber(s.recordingsCount)} ضبط</span> : null}
                  <span className="font-mono text-[10px] text-muted-foreground/80" dir="ltr">اتاق: {s.meetingId}</span>
                </div>
                <Button
                  className="w-full"
                  variant={s.isRunning ? 'default' : 'outline'}
                  disabled={joinMut.isPending}
                  onClick={() => joinMut.mutate(s.meetingId)}
                >
                  ورود به کلاس
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
