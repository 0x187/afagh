import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, PlusCircle, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  addSchedule,
  deactivateOffering,
  deleteSchedule,
  getOfferings,
  saveOffering,
  type GmOffering,
} from '@/lib/groupmanager-api';
import { GmLayout } from './GmLayout';

// ═══ Offerings and weekly schedule — port of group-manager/offerings ═══

const DAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

function OfferingCard({ offering }: { offering: GmOffering }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    group: offering.groupNumber,
    capacity: offering.capacity,
    waitCapacity: offering.waitlistCapacity,
    professorId: offering.professorId ? String(offering.professorId) : '',
    targetDegreeLevelId: offering.targetDegreeLevelId ? String(offering.targetDegreeLevelId) : '',
    targetMajorId: offering.targetMajorId ? String(offering.targetMajorId) : '',
    entryYearStart: offering.entryYearStart ? String(offering.entryYearStart) : '',
    entryYearEnd: offering.entryYearEnd ? String(offering.entryYearEnd) : '',
  });
  const [newSchedule, setNewSchedule] = useState({ day: '0', start: '', end: '', roomId: '' });

  const saveMut = useMutation({
    mutationFn: () =>
      saveOffering({
        id: offering.id,
        courseId: offering.courseId,
        termId: 0,
        group: form.group,
        capacity: form.capacity,
        waitCapacity: form.waitCapacity,
        professorId: form.professorId ? Number(form.professorId) : null,
        targetDegreeLevelId: form.targetDegreeLevelId ? Number(form.targetDegreeLevelId) : null,
        targetMajorId: form.targetMajorId ? Number(form.targetMajorId) : null,
        entryYearStart: form.entryYearStart ? Number(form.entryYearStart) : null,
        entryYearEnd: form.entryYearEnd ? Number(form.entryYearEnd) : null,
      }),
    onSuccess: async () => {
      setMsg('ارائه به‌روزرسانی شد.');
      await qc.invalidateQueries({ queryKey: ['gm-offerings'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const deactivateMut = useMutation({
    mutationFn: () => deactivateOffering(offering.id),
    onSuccess: async (m) => {
      setMsg(m);
      await qc.invalidateQueries({ queryKey: ['gm-offerings'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const scheduleMut = useMutation({
    mutationFn: () =>
      addSchedule({
        offeringId: offering.id,
        day: Number(newSchedule.day),
        start: newSchedule.start,
        end: newSchedule.end,
        roomId: newSchedule.roomId ? Number(newSchedule.roomId) : null,
      }),
    onSuccess: async (m) => {
      setMsg(m);
      setNewSchedule({ ...newSchedule, start: '', end: '' });
      await qc.invalidateQueries({ queryKey: ['gm-offerings'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const delSchedMut = useMutation({
    mutationFn: (id: number) => deleteSchedule(id),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ['gm-offerings'] }),
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <Card>
      <CardContent className="space-y-2.5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex flex-wrap items-center gap-2 text-sm font-black">
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]" dir="ltr">{offering.code}</span>
            {offering.title}
            <Badge variant="outline" className="text-[10px]">گروه {faNumber(offering.groupNumber)}</Badge>
          </p>
          <p className="text-[11px] text-muted-foreground">
            ثبت‌نام: {faNumber(offering.enrolledCount)}/{faNumber(offering.capacity)} · استاد: {offering.professorName ?? '—'}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2 text-[11px]">
          <div className="w-16"><Label>گروه</Label><Input type="number" min={1} value={form.group} onChange={(e) => setForm({ ...form, group: Number(e.target.value) })} className="mt-1 h-7" /></div>
          <div className="w-20"><Label>ظرفیت</Label><Input type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} className="mt-1 h-7" /></div>
          <div className="w-24"><Label>لیست انتظار</Label><Input type="number" min={0} value={form.waitCapacity} onChange={(e) => setForm({ ...form, waitCapacity: Number(e.target.value) })} className="mt-1 h-7" /></div>
          <div className="w-20"><Label>مقطع</Label><Input type="number" value={form.targetDegreeLevelId} onChange={(e) => setForm({ ...form, targetDegreeLevelId: e.target.value })} className="mt-1 h-7" /></div>
          <div className="w-20"><Label>رشته</Label><Input type="number" value={form.targetMajorId} onChange={(e) => setForm({ ...form, targetMajorId: e.target.value })} className="mt-1 h-7" /></div>
          <div className="w-20"><Label>ورودی از</Label><Input type="number" value={form.entryYearStart} onChange={(e) => setForm({ ...form, entryYearStart: e.target.value })} className="mt-1 h-7" /></div>
          <div className="w-20"><Label>تا</Label><Input type="number" value={form.entryYearEnd} onChange={(e) => setForm({ ...form, entryYearEnd: e.target.value })} className="mt-1 h-7" /></div>
          <Button size="sm" variant="outline" className="h-7" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}><Save className="size-3.5" aria-hidden /> ذخیره</Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2 text-[11px]">
          <span className="text-muted-foreground">برنامه:</span>
          {offering.schedules.map((s) => (
            <span key={s.id} className="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1">
              {s.dayOfWeek == null ? '—' : DAYS[s.dayOfWeek]} {faDigits(s.startTime)}–{faDigits(s.endTime)}{s.roomName ? ` · ${s.roomName}` : ''}
              <button type="button" className="text-rose-600" onClick={() => delSchedMut.mutate(s.id)} aria-label="حذف برنامه">×</button>
            </span>
          ))}
          <span className="flex flex-wrap items-center gap-1">
            <select value={newSchedule.day} onChange={(e) => setNewSchedule({ ...newSchedule, day: e.target.value })} className="h-7 rounded border border-input bg-transparent px-1 text-[10px]">
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
            <Input type="time" value={newSchedule.start} onChange={(e) => setNewSchedule({ ...newSchedule, start: e.target.value })} className="h-7 w-24" dir="ltr" />
            <Input type="time" value={newSchedule.end} onChange={(e) => setNewSchedule({ ...newSchedule, end: e.target.value })} className="h-7 w-24" dir="ltr" />
            <Button size="sm" variant="ghost" className="h-7 px-1.5" disabled={!newSchedule.start || !newSchedule.end || scheduleMut.isPending} onClick={() => scheduleMut.mutate()}>
              <PlusCircle className="size-3.5" aria-hidden />
            </Button>
          </span>
          <Button size="sm" variant="ghost" className="ms-auto h-7 px-2 text-rose-600" disabled={deactivateMut.isPending} onClick={() => deactivateMut.mutate()}>
            <Trash2 className="size-3.5" aria-hidden /> {offering.enrolledCount > 0 ? 'غیرفعال‌سازی' : 'حذف ارائه'}
          </Button>
        </div>
        {msg ? <p className="text-[10px] text-muted-foreground">{msg}</p> : null}
      </CardContent>
    </Card>
  );
}

export function GmOfferingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['gm-offerings'], queryFn: getOfferings, staleTime: 20_000 });
  const [form, setForm] = useState({ courseId: '', group: 1, capacity: 30, waitCapacity: 0, professorId: '', targetDegreeLevelId: '', targetMajorId: '', entryYearStart: '', entryYearEnd: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const createMut = useMutation({
    mutationFn: () =>
      saveOffering({
        courseId: Number(form.courseId),
        termId: data?.term.id ?? 0,
        group: form.group,
        capacity: form.capacity,
        waitCapacity: form.waitCapacity,
        professorId: form.professorId ? Number(form.professorId) : null,
        targetDegreeLevelId: form.targetDegreeLevelId ? Number(form.targetDegreeLevelId) : null,
        targetMajorId: form.targetMajorId ? Number(form.targetMajorId) : null,
        entryYearStart: form.entryYearStart ? Number(form.entryYearStart) : null,
        entryYearEnd: form.entryYearEnd ? Number(form.entryYearEnd) : null,
      }),
    onSuccess: async () => {
      setMsg('ارائه ساخته شد — حالا برنامهٔ هفتگی را تعریف کنید.');
      setForm({ ...form, courseId: '' });
      await qc.invalidateQueries({ queryKey: ['gm-offerings'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <GmLayout>
      {isLoading ? <Skeleton className="h-72 w-full" /> : isError || !data ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت ارائه‌ها ناموفق بود.</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><CalendarPlus className="size-4 text-emerald-600" aria-hidden /> ارائهٔ جدید — {data.term.title || 'ترم جاری'}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!data.requireChart ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
                  چارت تحصیلی در انتخاب واحد الزامی نیست؛ تعیین «رشتهٔ مجاز» و «ورودی مجاز از» برای هر ارائه الزامی است.
                </p>
              ) : null}
              <div className="flex flex-wrap items-end gap-2 text-[11px]">
                <div className="min-w-52"><Label>درس</Label>
                  <select value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                    <option value="">— انتخاب —</option>
                    {data.courses.map((c) => <option key={c.id} value={c.id}>{c.title} ({c.code})</option>)}
                  </select>
                </div>
                <div className="w-16"><Label>گروه</Label><Input type="number" min={1} value={form.group} onChange={(e) => setForm({ ...form, group: Number(e.target.value) })} className="mt-1 h-8" /></div>
                <div className="w-20"><Label>ظرفیت</Label><Input type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} className="mt-1 h-8" /></div>
                <div className="w-24"><Label>لیست انتظار</Label><Input type="number" min={0} value={form.waitCapacity} onChange={(e) => setForm({ ...form, waitCapacity: Number(e.target.value) })} className="mt-1 h-8" /></div>
                <div className="min-w-36"><Label>استاد</Label>
                  <select value={form.professorId} onChange={(e) => setForm({ ...form, professorId: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                    <option value="">—</option>
                    {data.professors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="w-24"><Label>مقطع</Label>
                  <select value={form.targetDegreeLevelId} onChange={(e) => setForm({ ...form, targetDegreeLevelId: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                    <option value="">همه</option>
                    {data.degrees.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                </div>
                <div className="w-32"><Label>رشته</Label>
                  <select value={form.targetMajorId} onChange={(e) => setForm({ ...form, targetMajorId: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                    <option value="">همه</option>
                    {data.majors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div className="w-24"><Label>ورودی از</Label><Input type="number" value={form.entryYearStart} onChange={(e) => setForm({ ...form, entryYearStart: e.target.value })} className="mt-1 h-8" /></div>
                <div className="w-20"><Label>تا</Label><Input type="number" value={form.entryYearEnd} onChange={(e) => setForm({ ...form, entryYearEnd: e.target.value })} className="mt-1 h-8" /></div>
                <Button size="sm" disabled={createMut.isPending || !form.courseId} onClick={() => createMut.mutate()}>ایجاد ارائه</Button>
              </div>
              {msg ? <p className="text-[11px] text-muted-foreground">{msg}</p> : null}
            </CardContent>
          </Card>

          <div className="space-y-2">
            {data.offerings.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">ارائه‌ای برای این ترم در گروه شما نیست.</CardContent></Card>
            ) : (
              data.offerings.map((o) => <OfferingCard key={o.id} offering={o} />)
            )}
          </div>
        </>
      )}
    </GmLayout>
  );
}
