import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CheckCheck, ClipboardList, PlusCircle, RefreshCw, Save, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  generateAttendanceSessions,
  getAttendance,
  saveAttendance,
  scheduleMakeup,
  type AttendanceOffering,
  type AttendanceSession,
  type AttendanceStatus,
} from '@/lib/professor-api';

// ═══ حضور و غیاب استاد — پورت professor/attendance ═══

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'حاضر',
  LATE: 'تأخیر',
  ABSENT: 'غایب',
  EXCUSED: 'موجه',
};

const STATUS_STYLE: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-emerald-600 text-white border-emerald-700',
  LATE: 'bg-amber-500 text-white border-amber-600',
  ABSENT: 'bg-rose-600 text-white border-rose-700',
  EXCUSED: 'bg-sky-600 text-white border-sky-700',
};

const MAKEUP_STATUS: Record<string, string> = {
  SCHEDULED: 'ثبت مستقیم توسط استاد',
  PROPOSED: 'در انتظار تأیید اداره آموزش',
  REJECTED: 'ردشده',
  HELD: 'برگزارشده',
};

export function ProfessorAttendancePage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['professor-attendance'], queryFn: () => getAttendance(), staleTime: 20_000 });
  const [offeringID, setOfferingID] = useState<number | null>(null);
  const [sessionID, setSessionID] = useState<number | null>(null);
  const [statuses, setStatuses] = useState<Record<number, AttendanceStatus>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [showMakeup, setShowMakeup] = useState(false);
  const [makeup, setMakeup] = useState({
    sessionDate: '',
    startTime: '',
    endTime: '',
    roomName: '',
    topic: '',
    absenceReason: '',
    isDirect: true,
  });

  useEffect(() => {
    if (data && offeringID == null) {
      const def = data.defaultOfferingId ?? data.offerings[0]?.id ?? null;
      setOfferingID(def);
    }
  }, [data, offeringID]);

  const offering: AttendanceOffering | undefined = useMemo(
    () => data?.offerings.find((o) => o.id === offeringID) ?? data?.offerings[0],
    [data, offeringID],
  );
  const session: AttendanceSession | undefined = useMemo(
    () => offering?.sessions.find((s) => s.id === sessionID) ?? offering?.sessions[0],
    [offering, sessionID],
  );

  useEffect(() => {
    if (!session) {
      setStatuses({});
      return;
    }
    const next: Record<number, AttendanceStatus> = {};
    for (const st of offering?.students ?? []) {
      next[st.id] = (session.studentStatuses[String(st.id)]?.status ?? 'PRESENT') as AttendanceStatus;
    }
    setStatuses(next);
    setSessionID(session.id);
  }, [session?.id, offering?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const generateMut = useMutation({
    mutationFn: (id: number) => generateAttendanceSessions(id),
    onSuccess: async (r) => {
      setMsg(r.already ? 'جلسات این درس قبلاً تولید شده است.' : `${faNumber(r.generated)} جلسه تولید شد.`);
      await qc.invalidateQueries({ queryKey: ['professor-attendance'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const saveMut = useMutation({
    mutationFn: () =>
      saveAttendance(
        session!.id,
        Object.entries(statuses).map(([studentId, status]) => ({ studentId: Number(studentId), status })),
      ),
    onSuccess: async (r) => {
      setMsg(`حضور ثبت شد (${faNumber(r.savedCount)} ردیف، ${faNumber(r.sessionCount)} جلسه).`);
      await qc.invalidateQueries({ queryKey: ['professor-attendance'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const makeupMut = useMutation({
    mutationFn: () =>
      scheduleMakeup({
        offeringId: offering!.id,
        replacedSessionId: session?.id ?? null,
        sessionDate: makeup.sessionDate,
        startTime: makeup.startTime,
        endTime: makeup.endTime,
        roomName: makeup.roomName,
        isDirect: makeup.isDirect,
        topic: makeup.topic,
        absenceReason: makeup.absenceReason,
      }),
    onSuccess: async () => {
      setMsg('جلسهٔ جبرانی ثبت شد.');
      setShowMakeup(false);
      setMakeup({ sessionDate: '', startTime: '', endTime: '', roomName: '', topic: '', absenceReason: '', isDirect: true });
      await qc.invalidateQueries({ queryKey: ['professor-attendance'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت صفحهٔ حضور و غیاب ناموفق بود.</CardContent></Card>;
  }

  if (data.offerings.length === 0) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">در نیمسال انتخاب‌شده درسی به شما تخصیص نیافته است.</CardContent></Card>;
  }

  const students = offering?.students ?? [];
  const count = (st: AttendanceStatus) => students.filter((s) => statuses[s.id] === st).length;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-emerald-700 to-teal-700 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15">
              <ClipboardList className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-base font-black">حضور و غیاب کلاس</h1>
              <p className="mt-0.5 text-xs text-white/85">{data.professor.name} · {data.termTitle} · امروز {data.todayJalali}</p>
            </div>
          </div>
          <div className="text-xs text-white/85">{faNumber(data.offerings.length)} گروه درسی</div>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      <div className="flex flex-wrap gap-2">
        {data.offerings.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              setOfferingID(o.id);
              setSessionID(null);
              setMsg(null);
            }}
            className={`rounded-xl border px-3 py-2 text-right text-xs shadow-xs transition ${offering?.id === o.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40'}`}
          >
            <span className="flex items-center gap-1.5 font-black">
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]" dir="ltr">{o.code}</span>
              {o.title}
              {o.merged ? <Badge variant="outline" className="text-[9px]">ادغامی</Badge> : null}
            </span>
            <span className="mt-1 block text-[10px] text-muted-foreground">
              {o.scheduleTime || 'زمان ثبت نشده'} · {faNumber(o.students.length)} دانشجو · {faNumber(o.sessions.length)} جلسه
            </span>
          </button>
        ))}
      </div>

      {offering && offering.sessions.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-6 text-center">
            <p className="text-sm font-bold">هنوز جلسه‌ای برای این درس ساخته نشده است.</p>
            <p className="text-xs text-muted-foreground">
              {offering.canGenerate ? 'با یک کلیک، جلسات هفتگی ترم از روی برنامهٔ کلاس ساخته می‌شود.' : 'برای تولید جلسات، ابتدا زمان‌بندی هفتگی (CLASS) درس باید توسط آموزش ثبت شود.'}
            </p>
            <Button size="sm" disabled={!offering.canGenerate || generateMut.isPending} onClick={() => generateMut.mutate(offering.id)}>
              <RefreshCw className="size-4" aria-hidden /> تولید جلسات ترم
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {offering && offering.sessions.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">جلسات</CardTitle></CardHeader>
            <CardContent className="max-h-[60vh] space-y-1.5 overflow-y-auto">
              {offering.sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSessionID(s.id);
                    setMsg(null);
                  }}
                  className={`w-full rounded-xl border p-2 text-right text-[11px] transition ${session?.id === s.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50'}`}
                >
                  <span className="flex items-center justify-between gap-1 font-black">
                    <span>جلسهٔ {faNumber(s.sessionNo)}</span>
                    {s.isHeld ? <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 text-[9px]">ثبت‌شده</Badge> : <Badge variant="secondary" className="text-[9px]">در انتظار</Badge>}
                  </span>
                  <span className="mt-0.5 block text-muted-foreground">{faDigits(s.sessionDate)} · {faDigits(s.startTime)}–{faDigits(s.endTime)}</span>
                  {s.isMakeUp ? <span className="text-violet-700 dark:text-violet-300">جبرانی{s.replacedSessionNo ? ` (جایگزین ${faNumber(s.replacedSessionNo)})` : ''}</span> : null}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2">
              <div>
                <CardTitle className="text-sm">
                  {session ? `جلسهٔ ${faNumber(session.sessionNo)} — ${faDigits(session.sessionDate)}` : 'جلسه'}
                </CardTitle>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {session?.roomName || offering.roomName || '—'} · {session ? `${faDigits(session.startTime)} تا ${faDigits(session.endTime)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setStatuses(Object.fromEntries(students.map((s) => [s.id, 'PRESENT' as AttendanceStatus])))}>
                  <CheckCheck className="size-4" aria-hidden /> همه حاضر
                </Button>
                <Button size="sm" variant="outline" onClick={() => setStatuses(Object.fromEntries(students.map((s) => [s.id, 'ABSENT' as AttendanceStatus])))}>
                  همه غایب
                </Button>
                <Button size="sm" disabled={saveMut.isPending || students.length === 0} onClick={() => saveMut.mutate()}>
                  <Save className="size-4" aria-hidden /> ثبت حضور
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-3">
              <div className="flex flex-wrap gap-2 text-[11px]">
                {(Object.keys(STATUS_LABEL) as AttendanceStatus[]).map((st) => (
                  <Badge key={st} variant="secondary">{STATUS_LABEL[st]}: {faNumber(count(st))}</Badge>
                ))}
                <Badge variant="outline"><Users className="me-1 size-3" aria-hidden /> {faNumber(students.length)} دانشجو</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                      <th className="p-2">#</th>
                      <th className="p-2">دانشجو</th>
                      <th className="p-2">شمارهٔ دانشجویی</th>
                      <th className="p-2 text-center">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((st, i) => {
                      const status = statuses[st.id] ?? 'PRESENT';
                      return (
                        <tr key={st.id} className="border-b border-border/50 last:border-0">
                          <td className="p-2 text-muted-foreground">{faNumber(i + 1)}</td>
                          <td className="p-2 font-semibold">{st.fullName}</td>
                          <td className="p-2 font-mono text-[10px]" dir="ltr">{st.studentCode}</td>
                          <td className="p-2">
                            <div className="flex flex-wrap justify-center gap-1">
                              {(Object.keys(STATUS_LABEL) as AttendanceStatus[]).map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => setStatuses((prev) => ({ ...prev, [st.id]: option }))}
                                  className={`rounded-md border px-2 py-1 text-[10px] font-bold transition ${status === option ? STATUS_STYLE[option] : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}
                                >
                                  {STATUS_LABEL[option]}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><CalendarPlus className="size-4 text-violet-600" aria-hidden /> جلسات جبرانی</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowMakeup((v) => !v)}>
            <PlusCircle className="size-4" aria-hidden /> ثبت جلسهٔ جبرانی
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {showMakeup ? (
            <div className="grid gap-2 rounded-xl border border-violet-200 bg-violet-50/50 p-3 sm:grid-cols-3 dark:border-violet-900 dark:bg-violet-950/30">
              <div><Label>تاریخ (شمسی)</Label><Input value={makeup.sessionDate} onChange={(e) => setMakeup((p) => ({ ...p, sessionDate: e.target.value }))} placeholder="۱۴۰۵/۰۸/۲۰" className="mt-1" /></div>
              <div><Label>ساعت شروع</Label><Input value={makeup.startTime} onChange={(e) => setMakeup((p) => ({ ...p, startTime: e.target.value }))} placeholder="10:00" className="mt-1" dir="ltr" /></div>
              <div><Label>ساعت پایان</Label><Input value={makeup.endTime} onChange={(e) => setMakeup((p) => ({ ...p, endTime: e.target.value }))} placeholder="11:30" className="mt-1" dir="ltr" /></div>
              <div>
                <Label>سالن</Label>
                <select value={makeup.roomName} onChange={(e) => setMakeup((p) => ({ ...p, roomName: e.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                  <option value="">— بدون سالن —</option>
                  {data.rooms.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
                </select>
              </div>
              <div><Label>موضوع</Label><Input value={makeup.topic} onChange={(e) => setMakeup((p) => ({ ...p, topic: e.target.value }))} className="mt-1" /></div>
              <div><Label>علت جبرانی</Label><Input value={makeup.absenceReason} onChange={(e) => setMakeup((p) => ({ ...p, absenceReason: e.target.value }))} className="mt-1" /></div>
              <label className="flex items-center gap-2 text-xs font-bold">
                <input type="checkbox" checked={makeup.isDirect} onChange={(e) => setMakeup((p) => ({ ...p, isDirect: e.target.checked }))} />
                ثبت مستقیم (بدون نیاز به تأیید آموزش)
              </label>
              <div className="flex items-end justify-end gap-2 sm:col-span-2">
                <Button variant="outline" size="sm" onClick={() => setShowMakeup(false)}>انصراف</Button>
                <Button size="sm" disabled={makeupMut.isPending} onClick={() => makeupMut.mutate()}>ثبت جلسه</Button>
              </div>
            </div>
          ) : null}

          {data.initialMakeupHistory.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">جلسهٔ جبرانی ثبت نشده است.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-[11px]">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                    <th className="p-1.5">درس</th>
                    <th className="p-1.5 text-center">جایگزین جلسه</th>
                    <th className="p-1.5 text-center">تاریخ</th>
                    <th className="p-1.5 text-center">ساعت</th>
                    <th className="p-1.5">سالن</th>
                    <th className="p-1.5">وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {data.initialMakeupHistory.map((m) => (
                    <tr key={m.id} className="border-b border-border/50 last:border-0">
                      <td className="p-1.5 font-semibold">{m.courseTitle}</td>
                      <td className="p-1.5 text-center">{m.replacedSessionNo ? faNumber(m.replacedSessionNo) : '—'}</td>
                      <td className="p-1.5 text-center">{faDigits(m.sessionDate)}</td>
                      <td className="p-1.5 text-center">{faDigits(m.sessionTime)}</td>
                      <td className="p-1.5">{m.roomName || '—'}</td>
                      <td className="p-1.5">{MAKEUP_STATUS[m.status] ?? m.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
