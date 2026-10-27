import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, DoorOpen, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  confirmAttendance,
  getAttendanceControl,
  getManualAttendance,
  recordClassPresence,
  setSessionStatus,
} from '@/lib/admin-api';

// ═══ تأیید دستی حضور استاد — پورت admin/attendance-manual ═══

const SESSION_STATUS: Record<string, string> = {
  SCHEDULED: 'برنامه‌ریزی‌شده', HELD: 'برگزارشده', ABSENT: 'غایب/تشکیل نشد',
};

export function AdminManualAttendancePage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-attendance-manual'], queryFn: getManualAttendance, staleTime: 20_000 });
  const [msg, setMsg] = useState<string | null>(null);
  const confirmMut = useMutation({
    mutationFn: confirmAttendance,
    onSuccess: async () => {
      setMsg('حضور استاد تأیید شد.');
      await qc.invalidateQueries({ queryKey: ['admin-attendance-manual'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const statusMut = useMutation({
    mutationFn: ({ sessionId, status }: { sessionId: number; status: string }) => setSessionStatus(sessionId, status),
    onSuccess: async () => {
      setMsg('وضعیت جلسه تغییر کرد.');
      await qc.invalidateQueries({ queryKey: ['admin-attendance-manual'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت جلسات ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-emerald-800 to-teal-700 text-white">
        <CardContent className="p-5">
          <h1 className="text-base font-black">تأیید دستی حضور استاد — {data.term.title || '—'}</h1>
          <p className="mt-0.5 text-xs text-emerald-100">جلسه‌های بدون ثبت حضور را تأیید کنید؛ ثبت روی اعضای کلاس ادغامی هم اعمال می‌شود.</p>
        </CardContent>
      </Card>
      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}
      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                <th className="p-2">تاریخ</th><th className="p-2">ساعت</th><th className="p-2">درس</th>
                <th className="p-2">استاد</th><th className="p-2">وضعیت جلسه</th><th className="p-2">حضور ثبت‌شده</th><th className="p-2">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">جلسه‌ای برای این ترم وجود ندارد.</td></tr>
              ) : data.rows.map((r) => (
                <tr key={r.sessionId} className="border-b border-border/50 last:border-0">
                  <td className="p-2">{faDigits(r.sessionDate)}{r.isMakeUp ? <Badge variant="outline" className="ms-1 text-[9px]">جبرانی</Badge> : null}</td>
                  <td className="p-2 font-mono" dir="ltr">{faDigits(r.startTime)}–{faDigits(r.endTime)}</td>
                  <td className="p-2 font-semibold">{r.courseTitle} {r.merged ? <Badge variant="outline" className="text-[9px]">ادغامی ({faNumber(r.memberCount)})</Badge> : null}</td>
                  <td className="p-2">{r.professorName}</td>
                  <td className="p-2"><Badge variant="secondary" className="text-[10px]">{SESSION_STATUS[r.sessionStatus] ?? r.sessionStatus}</Badge></td>
                  <td className="p-2">
                    {r.method ? (
                      <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 text-[10px]">✓ {r.method}</Badge>
                    ) : <span className="text-muted-foreground">ثبت نشده</span>}
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      {!r.method ? <Button size="sm" variant="outline" className="h-7" disabled={confirmMut.isPending} onClick={() => confirmMut.mutate(r.sessionId)}>تأیید حضور</Button> : null}
                      {r.sessionStatus !== 'HELD' ? <Button size="sm" variant="ghost" className="h-7 text-emerald-700" disabled={statusMut.isPending} onClick={() => statusMut.mutate({ sessionId: r.sessionId, status: 'HELD' })}>تشکیل شد</Button> : null}
                      {r.sessionStatus !== 'ABSENT' ? <Button size="sm" variant="ghost" className="h-7 text-rose-600" disabled={statusMut.isPending} onClick={() => statusMut.mutate({ sessionId: r.sessionId, status: 'ABSENT' })}>تشکیل نشد</Button> : null}
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

// ═══ کارتابل کنترل حضور — پورت admin/attendance-control ═══

export function AdminAttendanceControlPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-attendance-control'], queryFn: getAttendanceControl, staleTime: 15_000, refetchInterval: 60_000 });
  const [msg, setMsg] = useState<string | null>(null);
  const recordMut = useMutation({
    mutationFn: recordClassPresence,
    onSuccess: async () => {
      setMsg('تشکیل کلاس ثبت شد.');
      await qc.invalidateQueries({ queryKey: ['admin-attendance-control'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت جلسات امروز ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-indigo-800 to-violet-700 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-base font-black"><ShieldCheck className="size-5" aria-hidden /> کنترل تشکیل کلاس‌ها</h1>
          <p className="mt-0.5 text-xs text-indigo-100">امروز {data.todayJalali} · {faNumber(data.rows.length)} جلسه در سالن‌های دانشگاه</p>
        </CardContent>
      </Card>
      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}
      {data.rows.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">امروز جلسه‌ای در سالن‌ها ثبت نشده است.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {data.rows.map((r) => (
            <Card key={r.sessionId}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-xs font-black">
                    <DoorOpen className="size-4 text-indigo-600" aria-hidden />
                    {r.roomName || 'بدون سالن'}
                    <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{r.courseCode}</span>
                    {r.merged ? <Badge variant="outline" className="text-[9px]">ادغامی ({faNumber(r.memberCount)})</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {r.courseTitle} · گروه {faNumber(r.groupNumber)} · استاد: {r.professorName}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-[11px] font-mono" dir="ltr"><CalendarClock className="size-3.5 text-muted-foreground" aria-hidden /> {faDigits(r.startTime)}–{faDigits(r.endTime)}</span>
                  {r.recorded ? (
                    <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                      <CheckCircle2 className="me-1 size-3" aria-hidden /> ثبت‌شده{r.recordedAt ? ` ${faDigits(r.recordedAt.slice(11, 16))}` : ''}
                    </Badge>
                  ) : (
                    <Button size="sm" disabled={recordMut.isPending} onClick={() => recordMut.mutate(r.sessionId)}>ثبت تشکیل</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
