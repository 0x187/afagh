import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, DoorOpen, Ticket } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  assignExamSession,
  createExamHall,
  createExamSession,
  generateExamSeats,
  getExams,
} from '@/lib/admin-api';

// ═══ کارتابل امتحانات — پورت admin/exams (زیرمجموعهٔ کاربردی) ═══

export function AdminExamsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-exams'], queryFn: getExams, staleTime: 20_000 });
  const [msg, setMsg] = useState<string | null>(null);
  const [sessionForm, setSessionForm] = useState({ examDate: '', start: '', end: '' });
  const [hallForm, setHallForm] = useState({ name: '', capacity: 100, rowsCount: 10, colsCount: 10, buildingName: '' });
  const [assign, setAssign] = useState<Record<number, string>>({});

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-exams'] });
  const sessionMut = useMutation({
    mutationFn: () => createExamSession({ termId: data!.term.id!, examDate: sessionForm.examDate, start: sessionForm.start, end: sessionForm.end }),
    onSuccess: async () => {
      setMsg('سشن امتحان ساخته شد.');
      setSessionForm({ examDate: '', start: '', end: '' });
      await refresh();
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const hallMut = useMutation({
    mutationFn: () => createExamHall(hallForm),
    onSuccess: async () => {
      setMsg('سالن ساخته شد.');
      setHallForm({ ...hallForm, name: '' });
      await refresh();
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const assignMut = useMutation({
    mutationFn: ({ offeringId, sessionId }: { offeringId: number; sessionId: number }) => assignExamSession(offeringId, sessionId),
    onSuccess: async () => {
      setMsg('ارائه به سشن متصل شد.');
      await refresh();
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const seatsMut = useMutation({
    mutationFn: () => generateExamSeats(),
    onSuccess: async (r) => {
      setMsg(`${faNumber(r.allocated)} صندلی در ${faNumber(r.sessionCount)} سشن تخصیص یافت.`);
      await refresh();
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت کارتابل امتحانات ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-sky-900 to-cyan-800 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="text-base font-black">کارتابل امتحانات — {data.term.title || 'بدون ترم'}</h1>
            <p className="mt-0.5 text-xs text-sky-100">{faNumber(data.sessions.length)} سشن · {faNumber(data.courses.length)} درس امتحانی · {faNumber(data.allocatedTotal)} صندلی تخصیص‌یافته</p>
          </div>
          <Button size="sm" className="bg-white/15 hover:bg-white/25" disabled={seatsMut.isPending} onClick={() => seatsMut.mutate()}>
            <Ticket className="size-4" aria-hidden /> تخصیص صندلی‌ها
          </Button>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><CalendarPlus className="size-4 text-sky-600" aria-hidden /> سشن امتحان جدید</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2 text-[11px]">
            <div className="w-32"><Label>تاریخ (شمسی)</Label><Input value={sessionForm.examDate} onChange={(e) => setSessionForm({ ...sessionForm, examDate: e.target.value })} className="mt-1 h-8" placeholder="۱۴۰۵/۰۸/۱۵" /></div>
            <div className="w-28"><Label>شروع</Label><Input value={sessionForm.start} onChange={(e) => setSessionForm({ ...sessionForm, start: e.target.value })} className="mt-1 h-8" dir="ltr" placeholder="09:00" /></div>
            <div className="w-28"><Label>پایان</Label><Input value={sessionForm.end} onChange={(e) => setSessionForm({ ...sessionForm, end: e.target.value })} className="mt-1 h-8" dir="ltr" placeholder="11:00" /></div>
            <Button size="sm" disabled={sessionMut.isPending || !sessionForm.examDate} onClick={() => sessionMut.mutate()}>ایجاد</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><DoorOpen className="size-4 text-violet-600" aria-hidden /> سالن امتحان جدید</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2 text-[11px]">
            <div className="w-32"><Label>نام</Label><Input value={hallForm.name} onChange={(e) => setHallForm({ ...hallForm, name: e.target.value })} className="mt-1 h-8" placeholder="سالن ۳" /></div>
            <div className="w-20"><Label>ظرفیت</Label><Input type="number" min={1} value={hallForm.capacity} onChange={(e) => setHallForm({ ...hallForm, capacity: Number(e.target.value) })} className="mt-1 h-8" /></div>
            <div className="w-16"><Label>ردیف</Label><Input type="number" min={0} value={hallForm.rowsCount} onChange={(e) => setHallForm({ ...hallForm, rowsCount: Number(e.target.value) })} className="mt-1 h-8" /></div>
            <div className="w-16"><Label>ستون</Label><Input type="number" min={0} value={hallForm.colsCount} onChange={(e) => setHallForm({ ...hallForm, colsCount: Number(e.target.value) })} className="mt-1 h-8" /></div>
            <div className="w-28"><Label>ساختمان</Label><Input value={hallForm.buildingName} onChange={(e) => setHallForm({ ...hallForm, buildingName: e.target.value })} className="mt-1 h-8" /></div>
            <Button size="sm" disabled={hallMut.isPending || !hallForm.name} onClick={() => hallMut.mutate()}>ایجاد</Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">سشن‌ها ({faNumber(data.sessions.length)})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-xs">
            <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2">تاریخ</th><th className="p-2">ساعت</th><th className="p-2 text-center">صندلی</th></tr></thead>
            <tbody>
              {data.sessions.length === 0 ? (
                <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">سشن‌ای تعریف نشده است.</td></tr>
              ) : data.sessions.map((s) => (
                <tr key={s.id} className="border-b border-border/50 last:border-0">
                  <td className="p-2">{faDigits(s.examDate)}</td>
                  <td className="p-2 font-mono" dir="ltr">{faDigits(s.startTime)}–{faDigits(s.endTime)}</td>
                  <td className="p-2 text-center"><Badge variant="secondary">{faNumber(s.allocated)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">دروس امتحانی و اتصال به سشن</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-xs">
            <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2">درس</th><th className="p-2">تاریخ</th><th className="p-2">ساعت</th><th className="p-2">سالن برنامه</th><th className="p-2">سشن متصل</th></tr></thead>
            <tbody>
              {data.courses.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">جلسهٔ امتحانی در برنامهٔ هفتگی ثبت نشده است.</td></tr>
              ) : data.courses.map((c) => (
                <tr key={c.offeringId} className="border-b border-border/50 last:border-0">
                  <td className="p-2 font-semibold">{c.courseTitle} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{c.courseCode}</span></td>
                  <td className="p-2">{faDigits(c.examDate)}</td>
                  <td className="p-2 font-mono" dir="ltr">{faDigits(c.startTime)}–{faDigits(c.endTime)}</td>
                  <td className="p-2">{c.roomName ?? '—'}</td>
                  <td className="p-2">
                    <select
                      value={assign[c.offeringId] ?? (c.sessionId ? String(c.sessionId) : '')}
                      onChange={(e) => setAssign((prev) => ({ ...prev, [c.offeringId]: e.target.value }))}
                      className="h-7 rounded border border-input bg-transparent px-1 text-[10px]"
                    >
                      <option value="">— بدون سشن —</option>
                      {data.sessions.map((s) => <option key={s.id} value={s.id}>{faDigits(s.examDate)} {faDigits(s.startTime)}</option>)}
                    </select>
                    {assign[c.offeringId] ? (
                      <Button size="sm" variant="outline" className="ms-1 h-7" disabled={assignMut.isPending} onClick={() => assignMut.mutate({ offeringId: c.offeringId, sessionId: Number(assign[c.offeringId]) })}>اتصال</Button>
                    ) : null}
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
