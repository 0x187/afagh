import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';

import { WeekGrid, type WeekGridEntry } from '@/components/schedule/WeekGrid';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { collapseCalendarEntries } from '@/lib/calendar-layout';
import { faDigits, faNumber } from '@/lib/fa';
import { getWeeklyBoard } from '@/lib/admin-api';

// ═══ Weekly board — port of admin/weekly-board (read-only view + print) ═══

const DAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

export function AdminWeeklyBoardPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-weekly-board'], queryFn: getWeeklyBoard, staleTime: 60_000 });
  const [day, setDay] = useState('');
  const [room, setRoom] = useState('');
  const [professor, setProfessor] = useState('');
  const [dept, setDept] = useState('');

  const rows = data?.rows ?? [];
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (day !== '' && String(r.dayOfWeek ?? '') !== day) return false;
        if (room && r.roomId !== Number(room)) return false;
        if (professor && r.professor !== professor) return false;
        if (dept && r.departmentName !== dept) return false;
        return true;
      }),
    [rows, day, room, professor, dept],
  );

  const entries: WeekGridEntry[] = useMemo(
    () =>
      collapseCalendarEntries(
        filtered.map((r) => ({
          id: r.offeringId,
          dayOfWeek: r.dayOfWeek,
          startTime: r.startTime,
          endTime: r.endTime,
          weekType: 'ALL' as const,
          code: r.courseCode,
          title: r.courseTitle,
          groupNumber: r.groupNumber,
          roomName: r.roomName ?? '',
          buildingName: r.buildingName ?? '',
          professorName: r.professor,
          courseType: r.courseType,
          sharedScheduleGroupKey: null,
        })),
      ),
    [filtered],
  );

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت تختهٔ هفتگی ناموفق بود.</CardContent></Card>;
  }

  return (
    <div className="space-y-3">
      <Card className="print:hidden border-0 bg-gradient-to-l from-sky-800 to-indigo-800 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-base font-black"><CalendarRange className="size-5" aria-hidden /> تختهٔ هفتگی کلاس‌ها — {data.term.title}</h1>
          <p className="mt-0.5 text-xs text-sky-100">{faNumber(data.rows.length)} جلسهٔ هفتگی در ترم جاری</p>
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardContent className="flex flex-wrap items-end gap-2 p-3 text-[11px]">
          <div>
            <label className="block font-bold">روز</label>
            <select value={day} onChange={(e) => setDay(e.target.value)} className="mt-1 h-8 rounded-lg border border-input bg-transparent px-2">
              <option value="">همهٔ روزها</option>
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-bold">کلاس</label>
            <select value={room} onChange={(e) => setRoom(e.target.value)} className="mt-1 h-8 rounded-lg border border-input bg-transparent px-2">
              <option value="">همهٔ سالن‌ها</option>
              {data.rooms.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-bold">استاد</label>
            <select value={professor} onChange={(e) => setProfessor(e.target.value)} className="mt-1 h-8 rounded-lg border border-input bg-transparent px-2">
              <option value="">همهٔ اساتید</option>
              {data.professors.map((p, i) => <option key={`${p.title}-${i}`} value={p.title}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-bold">گروه آموزشی</label>
            <select value={dept} onChange={(e) => setDept(e.target.value)} className="mt-1 h-8 rounded-lg border border-input bg-transparent px-2">
              <option value="">همهٔ گروه‌ها</option>
              {data.departments.map((d, i) => <option key={`${d.title}-${i}`} value={d.title}>{d.title}</option>)}
            </select>
          </div>
          <div className="ms-auto">
            <Button size="sm" onClick={() => window.setTimeout(() => window.print(), 60)}>
              <Printer className="size-4" aria-hidden /> چاپ تخته
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="print-area border-2 border-slate-800">
        <CardHeader className="border-b-2 border-slate-800 pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>برنامهٔ هفتگی کلاس‌ها — {data.term.title}</span>
            <span className="text-[10px] font-normal text-muted-foreground">{faNumber(filtered.length)} جلسه</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <WeekGrid entries={entries} />
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader className="pb-2"><CardTitle className="text-sm">فهرست جلسات</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                <th className="p-2">روز</th><th className="p-2">ساعت</th><th className="p-2">درس</th>
                <th className="p-2 text-center">گروه</th><th className="p-2">استاد</th><th className="p-2">کلاس</th>
                <th className="p-2 text-center">ظرفیت</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.offeringId}-${i}`} className="border-b border-border/50 last:border-0">
                  <td className="p-2">{r.dayOfWeek == null ? '—' : DAYS[r.dayOfWeek]}</td>
                  <td className="p-2 font-mono" dir="ltr">{faDigits(r.startTime)}–{faDigits(r.endTime)}</td>
                  <td className="p-2 font-semibold">{r.courseTitle} <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{r.courseCode}</span></td>
                  <td className="p-2 text-center">{faNumber(r.groupNumber)}</td>
                  <td className="p-2">{r.professor || '—'}</td>
                  <td className="p-2">{r.roomName ?? '—'}</td>
                  <td className="p-2 text-center">{faNumber(r.enrolledCount)} / {faNumber(r.capacity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
