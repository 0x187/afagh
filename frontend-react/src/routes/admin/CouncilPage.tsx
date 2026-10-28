import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Landmark, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import {
  COUNCIL_DECISION_TYPES, COUNCIL_IMPLEMENTATION_STATUSES,
  deleteCouncilDecision, deleteCouncilMeeting, listCouncilDecisions, listCouncilMeetings,
  saveCouncilDecision, saveCouncilMeeting,
  type CouncilDecision, type CouncilMeeting,
} from '@/lib/committees-api';

// ═══ شورای آموزشی — پورت admin/council ═══

const IMPL_BADGE: Record<string, string> = {
  'در انتظار اجرا': 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  'در حال اجرا': 'border-transparent bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  'اجراشده': 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
};

const TYPE_BADGE: Record<string, string> = {
  'مصوبه': 'border-transparent bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  'توصیه': 'border-transparent bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  'درخواست تجدیدنظر': 'border-transparent bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
};

const emptyMeeting = { id: 0, title: '', meetingDate: '', members: '', agenda: '', minutes: '' };
const emptyDecision = { id: 0, meetingId: 0, decisionType: 'مصوبه', content: '', implementationStatus: 'در انتظار اجرا', deadline: '' };

export function AdminCouncilPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [meetingForm, setMeetingForm] = useState({ ...emptyMeeting });
  const [decisionForm, setDecisionForm] = useState({ ...emptyDecision });
  const [showMeetingForm, setShowMeetingForm] = useState(false);
  const [showDecisionForm, setShowDecisionForm] = useState(false);

  const meetings = useQuery({ queryKey: ['council-meetings'], queryFn: () => listCouncilMeetings({}), staleTime: 15_000 });
  const decisions = useQuery({ queryKey: ['council-decisions'], queryFn: () => listCouncilDecisions({}), staleTime: 15_000 });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['council-meetings'] });
    void qc.invalidateQueries({ queryKey: ['council-decisions'] });
  };

  const saveMeetingMut = useMutation({
    mutationFn: () => saveCouncilMeeting({
      id: meetingForm.id || undefined,
      title: meetingForm.title,
      meetingDate: meetingForm.meetingDate || undefined,
      members: meetingForm.members,
      agenda: meetingForm.agenda,
      minutes: meetingForm.minutes,
    }),
    onSuccess: () => { setMsg('جلسه ذخیره شد.'); setMeetingForm({ ...emptyMeeting }); setShowMeetingForm(false); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const delMeetingMut = useMutation({
    mutationFn: deleteCouncilMeeting,
    onSuccess: () => { setMsg('جلسه و مصوباتش حذف شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const saveDecisionMut = useMutation({
    mutationFn: () => saveCouncilDecision({
      id: decisionForm.id || undefined,
      meetingId: decisionForm.meetingId,
      decisionType: decisionForm.decisionType,
      content: decisionForm.content,
      implementationStatus: decisionForm.implementationStatus,
      deadline: decisionForm.deadline || undefined,
    }),
    onSuccess: () => { setMsg('مصوبه ذخیره شد.'); setDecisionForm({ ...emptyDecision }); setShowDecisionForm(false); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const delDecisionMut = useMutation({
    mutationFn: deleteCouncilDecision,
    onSuccess: () => { setMsg('مصوبه حذف شد.'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });

  if (meetings.isLoading || decisions.isLoading) return <Skeleton className="h-72 w-full" />;
  if (meetings.isError || decisions.isError) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت دادهٔ شورا ناموفق بود.</CardContent></Card>;

  const meetingRows = meetings.data?.rows ?? [];
  const decisionRows = decisions.data?.rows ?? [];

  return (
    <div className="space-y-3">
      <Card className="border-0 bg-gradient-to-l from-indigo-800 via-slate-800 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-base font-black"><Landmark className="size-5" aria-hidden /> شورای آموزشی</h1>
            <p className="mt-0.5 text-xs text-indigo-100">جلسات، صورت‌جلسه و مصوبات — {faNumber(meetingRows.length)} جلسه، {faNumber(decisionRows.length)} مصوبه</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="bg-white/15 text-white hover:bg-white/25" onClick={() => { setMeetingForm({ ...emptyMeeting }); setShowMeetingForm(true); }}><CalendarDays className="size-4" aria-hidden /> جلسهٔ جدید</Button>
            <Button size="sm" className="bg-white/15 text-white hover:bg-white/25" disabled={meetingRows.length === 0} onClick={() => { setDecisionForm({ ...emptyDecision, meetingId: meetingRows[0]?.id ?? 0 }); setShowDecisionForm(true); }}><Plus className="size-4" aria-hidden /> مصوبهٔ جدید</Button>
          </div>
        </CardContent>
      </Card>

      {msg ? <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs shadow-xs">{msg}</div> : null}

      {showMeetingForm ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{meetingForm.id ? 'ویرایش جلسه' : 'جلسهٔ جدید'}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2"><Label className="text-[11px]">عنوان</Label><Input value={meetingForm.title} onChange={(e) => setMeetingForm({ ...meetingForm, title: e.target.value })} className="mt-1 h-8" /></div>
            <div><Label className="text-[11px]">تاریخ جلسه</Label><Input type="date" value={meetingForm.meetingDate} onChange={(e) => setMeetingForm({ ...meetingForm, meetingDate: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
            <div className="flex items-end gap-2">
              <Button size="sm" disabled={saveMeetingMut.isPending || !meetingForm.title} onClick={() => saveMeetingMut.mutate()}><Save className="size-4" aria-hidden /> ذخیره</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowMeetingForm(false)}>انصراف</Button>
            </div>
            <div><Label className="text-[11px]">اعضا (هر عضو یک خط)</Label><textarea value={meetingForm.members} onChange={(e) => setMeetingForm({ ...meetingForm, members: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-input bg-transparent p-2 text-xs" /></div>
            <div><Label className="text-[11px]">دستور جلسه</Label><textarea value={meetingForm.agenda} onChange={(e) => setMeetingForm({ ...meetingForm, agenda: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-input bg-transparent p-2 text-xs" /></div>
            <div className="lg:col-span-2"><Label className="text-[11px]">صورت‌جلسه</Label><textarea value={meetingForm.minutes} onChange={(e) => setMeetingForm({ ...meetingForm, minutes: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-input bg-transparent p-2 text-xs" /></div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">جلسات</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {meetingRows.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">جلسه‌ای ثبت نشده است.</p> : meetingRows.map((m) => (
              <MeetingRow key={m.id} m={m} onEdit={() => { setMeetingForm({ id: m.id, title: m.title, meetingDate: m.meetingDate?.slice(0, 10) ?? '', members: m.members ?? '', agenda: m.agenda ?? '', minutes: m.minutes ?? '' }); setShowMeetingForm(true); }} onDelete={() => { if (confirm(`حذف جلسهٔ «${m.title}» و همهٔ مصوباتش؟`)) delMeetingMut.mutate(m.id); }} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">مصوبات</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {decisionRows.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">مصوبه‌ای ثبت نشده است.</p> : decisionRows.map((d) => (
              <DecisionRow key={d.id} d={d} onEdit={() => { setDecisionForm({ id: d.id, meetingId: d.meetingId, decisionType: d.decisionType, content: d.content, implementationStatus: d.implementationStatus, deadline: d.deadline?.slice(0, 10) ?? '' }); setShowDecisionForm(true); }} onDelete={() => { if (confirm('حذف این مصوبه؟')) delDecisionMut.mutate(d.id); }} />
            ))}
          </CardContent>
        </Card>
      </div>

      {showDecisionForm ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{decisionForm.id ? 'ویرایش مصوبه' : 'مصوبهٔ جدید'}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div><Label className="text-[11px]">جلسه</Label>
              <select value={decisionForm.meetingId} onChange={(e) => setDecisionForm({ ...decisionForm, meetingId: Number(e.target.value) })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                {meetingRows.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </div>
            <div><Label className="text-[11px]">نوع</Label>
              <select value={decisionForm.decisionType} onChange={(e) => setDecisionForm({ ...decisionForm, decisionType: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                {COUNCIL_DECISION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><Label className="text-[11px]">وضعیت اجرا</Label>
              <select value={decisionForm.implementationStatus} onChange={(e) => setDecisionForm({ ...decisionForm, implementationStatus: e.target.value })} className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs">
                {COUNCIL_IMPLEMENTATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div><Label className="text-[11px]">مهلت اجرا</Label><Input type="date" value={decisionForm.deadline} onChange={(e) => setDecisionForm({ ...decisionForm, deadline: e.target.value })} className="mt-1 h-8 font-mono" dir="ltr" /></div>
            <div className="sm:col-span-2 lg:col-span-3"><Label className="text-[11px]">متن مصوبه</Label><Input value={decisionForm.content} onChange={(e) => setDecisionForm({ ...decisionForm, content: e.target.value })} className="mt-1 h-8" /></div>
            <div className="flex items-end gap-2">
              <Button size="sm" disabled={saveDecisionMut.isPending || !decisionForm.content || !decisionForm.meetingId} onClick={() => saveDecisionMut.mutate()}><Save className="size-4" aria-hidden /> ذخیره</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowDecisionForm(false)}>انصراف</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function MeetingRow({ m, onEdit, onDelete }: { m: CouncilMeeting; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border px-2.5 py-1.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="text-right font-bold underline decoration-dotted underline-offset-4" onClick={() => setOpen(!open)}>{m.title}</button>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{m.meetingDate ? faDigits(m.meetingDate.slice(0, 10)) : '—'}</span>
          <Badge variant="outline" className="text-[10px]">{faNumber(m.decisionsCount)} مصوبه</Badge>
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={onEdit}><Save className="size-3" aria-hidden /></Button>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" onClick={onDelete}><Trash2 className="size-3" aria-hidden /></Button>
        </div>
      </div>
      {open ? (
        <div className="mt-1.5 space-y-1 border-t border-border/50 pt-1.5 text-muted-foreground">
          {m.members ? <p><b className="text-foreground">اعضا:</b> {m.members}</p> : null}
          {m.agenda ? <p><b className="text-foreground">دستور:</b> {m.agenda}</p> : null}
          {m.minutes ? <p><b className="text-foreground">صورت‌جلسه:</b> {m.minutes}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function DecisionRow({ d, onEdit, onDelete }: { d: CouncilDecision; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="rounded-lg border border-border px-2.5 py-1.5 text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className={TYPE_BADGE[d.decisionType] ?? ''}>{d.decisionType}</Badge>
          <Badge className={IMPL_BADGE[d.implementationStatus] ?? ''}>{d.implementationStatus}</Badge>
          <span className="text-muted-foreground">{d.meetingTitle} · {d.meetingDate ? faDigits(d.meetingDate.slice(0, 10)) : '—'}</span>
        </div>
        <div className="flex items-center gap-1">
          {d.deadline ? <span className="font-mono text-[10px] text-amber-700 dark:text-amber-300" dir="ltr">مهلت: {faDigits(d.deadline.slice(0, 10))}</span> : null}
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={onEdit}><Save className="size-3" aria-hidden /></Button>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-rose-600" onClick={onDelete}><Trash2 className="size-3" aria-hidden /></Button>
        </div>
      </div>
      <p className="mt-1">{d.content}</p>
      {d.studentName ? <p className="text-[10px] text-muted-foreground">دانشجو: {d.studentName} <span className="font-mono" dir="ltr">{d.studentCode ? faDigits(d.studentCode) : ''}</span></p> : null}
    </div>
  );
}
