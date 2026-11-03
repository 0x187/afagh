'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import {
  DECISION_TYPES, IMPLEMENTATION_STATUSES,
  decisionTypeBadgeClass, implementationStatusBadgeClass,
  splitLines,
} from '@/lib/council';
import { askConfirm } from '@/lib/ui-feedback';

type Msg = { text: string; kind: 'ok' | 'error' } | null;

type MeetingRow = {
  id: number;
  title: string;
  meetingDate: string | null;
  members: string | null;
  agenda: string | null;
  minutes: string | null;
  decisionsCount: number;
};

type DecisionRow = {
  id: number;
  meetingId: number;
  meetingTitle: string | null;
  meetingDate: string | null;
  studentId: number | null;
  studentName: string | number | null;
  studentCode?: string | null;
  decisionType: string;
  content: string;
  implementationStatus: string;
  deadline: string | null;
};

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

function toJalali(iso: string | Date | null): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  const gy = d.getFullYear(), gm = d.getMonth() + 1, gd = d.getDate();
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100)
    + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
}

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `خطا (${res.status})`);
  return data;
}

export default function CouncilClient() {
  const [tab, setTab] = useState<'meetings' | 'decisions'>('meetings');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, startTransition] = useTransition();

  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [mTotal, setMTotal] = useState(0);
  const [mPage, setMPage] = useState(1);
  const [mLoading, setMLoading] = useState(true);

  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [dTotal, setDTotal] = useState(0);
  const [dPage, setDPage] = useState(1);
  const [dLoading, setDLoading] = useState(true);
  const [dStatus, setDStatus] = useState('');
  const [dType, setDType] = useState('');

  const [showMeetingForm, setShowMeetingForm] = useState<MeetingRow | 'new' | null>(null);
  const [showDecisionForm, setShowDecisionForm] = useState<DecisionRow | 'new' | null>(null);

  const loadMeetings = useCallback(async (page: number) => {
    setMLoading(true);
    try {
      const data = await api(`/api/admin/council?page=${page}`);
      setMeetings(data.rows || []);
      setMTotal(data.total || 0);
      setMPage(data.page || page);
    } catch (e: any) { setMsg({ text: e.message, kind: 'error' }); }
    finally { setMLoading(false); }
  }, []);

  const loadDecisions = useCallback(async (page: number, status: string, type: string) => {
    setDLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page) });
      if (status) p.set('status', status);
      if (type) p.set('type', type);
      const data = await api(`/api/admin/council/decisions?${p}`);
      setDecisions(data.rows || []);
      setDTotal(data.total || 0);
      setDPage(data.page || page);
    } catch (e: any) { setMsg({ text: e.message, kind: 'error' }); }
    finally { setDLoading(false); }
  }, []);

  useEffect(() => { loadMeetings(1); }, [loadMeetings]);
  useEffect(() => { loadDecisions(1, '', ''); }, [loadDecisions]);

  const refreshAll = () => startTransition(() => { loadMeetings(mPage); loadDecisions(dPage, dStatus, dType); });

  const mPageSize = 50, dPageSize = 50;
  const mPages = Math.max(1, Math.ceil(mTotal / mPageSize));
  const dPages = Math.max(1, Math.ceil(dTotal / dPageSize));

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-800">شورای آموزشی</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowMeetingForm('new')}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg"
          >＋ جلسه جدید</button>
          <button
            onClick={() => setShowDecisionForm('new')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-2 rounded-lg"
          >＋ مصوبه جدید</button>
        </div>
      </div>

      {msg && (
        <div className={`px-3 py-2 rounded-lg text-sm border ${msg.kind === 'ok'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-rose-50 border-rose-200 text-rose-800'}`}>{msg.text}</div>
      )}

      {/* تب‌ها */}
      <div className="flex gap-1 border-b border-slate-200">
        {([['meetings', `جلسات (${mTotal})`], ['decisions', `مصوبات (${dTotal})`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm rounded-t-lg border-b-2 -mb-px ${
              tab === k ? 'border-blue-600 text-blue-700 font-medium bg-blue-50/50'
                        : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'meetings' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm rt">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-2 text-right">#</th>
                <th className="p-2 text-right">عنوان</th>
                <th className="p-2 text-right">تاریخ جلسه</th>
                <th className="p-2 text-right">اعضا</th>
                <th className="p-2 text-right">مصوبات</th>
                <th className="p-2 text-right">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {mLoading ? (
                <tr><td colSpan={6} className="p-6 text-center text-slate-400">در حال بارگذاری…</td></tr>
              ) : meetings.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-slate-400">جلسه‌ای ثبت نشده.</td></tr>
              ) : meetings.map((m) => (
                <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-2 text-slate-500">{m.id}</td>
                  <td className="p-2 font-medium">{m.title}</td>
                  <td className="p-2 text-xs">{toJalali(m.meetingDate)}</td>
                  <td className="p-2 text-xs text-slate-500">{splitLines(m.members).length} نفر</td>
                  <td className="p-2 text-center">
                    <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full text-xs">{m.decisionsCount}</span>
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <button onClick={() => setShowMeetingForm(m)} className="text-blue-600 hover:underline text-xs ml-2">ویرایش</button>
                    <button onClick={async () => {
                      if (!(await askConfirm({ title: 'تأیید عملیات', body: `جلسه «${m.title}» و همهٔ مصوباتش حذف شود؟`, confirmText: 'تأیید', cancelText: 'انصراف', danger: true }))) return;
                      startTransition(async () => {
                        try {
                          await api(`/api/admin/council?id=${m.id}`, { method: 'DELETE' });
                          setMsg({ text: 'جلسه حذف شد.', kind: 'ok' });
                          loadMeetings(mPage);
                        } catch (e: any) { setMsg({ text: e.message, kind: 'error' }); }
                      });
                    }} className="text-rose-600 hover:underline text-xs">حذف</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {mPages > 1 && (
            <div className="flex items-center justify-center gap-2 text-sm p-3">
              <button disabled={mPage <= 1} onClick={() => loadMeetings(mPage - 1)}
                className="px-3 py-1 border border-slate-300 rounded-lg disabled:opacity-40">قبلی</button>
              <span className="text-slate-600">صفحه {mPage} از {mPages}</span>
              <button disabled={mPage >= mPages} onClick={() => loadMeetings(mPage + 1)}
                className="px-3 py-1 border border-slate-300 rounded-lg disabled:opacity-40">بعدی</button>
            </div>
          )}
        </div>
      )}

      {tab === 'decisions' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <select value={dType} onChange={(e) => { setDType(e.target.value); loadDecisions(1, dStatus, e.target.value); }}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white">
              <option value="">همهٔ انواع</option>
              {DECISION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={dStatus} onChange={(e) => { setDStatus(e.target.value); loadDecisions(1, e.target.value, dType); }}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white">
              <option value="">همهٔ وضعیت‌ها</option>
              {IMPLEMENTATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm rt">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2 text-right">#</th>
                  <th className="p-2 text-right">جلسه</th>
                  <th className="p-2 text-right">دانشجو</th>
                  <th className="p-2 text-right">نوع</th>
                  <th className="p-2 text-right">متن</th>
                  <th className="p-2 text-right">وضعیت اجرا</th>
                  <th className="p-2 text-right">مهلت</th>
                  <th className="p-2 text-right">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {dLoading ? (
                  <tr><td colSpan={8} className="p-6 text-center text-slate-400">در حال بارگذاری…</td></tr>
                ) : decisions.length === 0 ? (
                  <tr><td colSpan={8} className="p-6 text-center text-slate-400">مصوبه‌ای یافت نشد.</td></tr>
                ) : decisions.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-2 text-slate-500">{d.id}</td>
                    <td className="p-2 text-xs">{d.meetingTitle}</td>
                    <td className="p-2 text-xs">
                      {d.studentId
                        ? `${typeof d.studentName === 'string' ? d.studentName : `دانشجو #${d.studentId}`}${d.studentCode ? ` (${d.studentCode})` : ''}`
                        : <span className="text-slate-300">عمومی</span>}
                    </td>
                    <td className="p-2"><span className={`px-2 py-0.5 rounded-full text-xs border ${decisionTypeBadgeClass(d.decisionType)}`}>{d.decisionType}</span></td>
                    <td className="p-2 text-xs max-w-md truncate" title={d.content}>{d.content}</td>
                    <td className="p-2"><span className={`px-2 py-0.5 rounded-full text-xs border ${implementationStatusBadgeClass(d.implementationStatus)}`}>{d.implementationStatus}</span></td>
                    <td className="p-2 text-xs">{toJalali(d.deadline)}</td>
                    <td className="p-2 whitespace-nowrap">
                      <button onClick={() => setShowDecisionForm(d)} className="text-blue-600 hover:underline text-xs ml-2">ویرایش</button>
                      <button onClick={async () => {
                        if (!(await askConfirm({ title: 'تأیید عملیات', body: 'این مصوبه حذف شود؟', confirmText: 'تأیید', cancelText: 'انصراف', danger: true }))) return;
                        startTransition(async () => {
                          try {
                            await api(`/api/admin/council/decisions?id=${d.id}`, { method: 'DELETE' });
                            setMsg({ text: 'مصوبه حذف شد.', kind: 'ok' });
                            loadDecisions(dPage, dStatus, dType);
                          } catch (e: any) { setMsg({ text: e.message, kind: 'error' }); }
                        });
                      }} className="text-rose-600 hover:underline text-xs">حذف</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dPages > 1 && (
              <div className="flex items-center justify-center gap-2 text-sm p-3">
                <button disabled={dPage <= 1} onClick={() => loadDecisions(dPage - 1, dStatus, dType)}
                  className="px-3 py-1 border border-slate-300 rounded-lg disabled:opacity-40">قبلی</button>
                <span className="text-slate-600">صفحه {dPage} از {dPages}</span>
                <button disabled={dPage >= dPages} onClick={() => loadDecisions(dPage + 1, dStatus, dType)}
                  className="px-3 py-1 border border-slate-300 rounded-lg disabled:opacity-40">بعدی</button>
              </div>
            )}
          </div>
        </div>
      )}

      {showMeetingForm && (
        <MeetingForm
          meeting={showMeetingForm === 'new' ? null : showMeetingForm}
          onClose={() => setShowMeetingForm(null)}
          onSaved={(m) => { setMsg({ text: m, kind: 'ok' }); setShowMeetingForm(null); refreshAll(); }}
        />
      )}
      {showDecisionForm && (
        <DecisionForm
          decision={showDecisionForm === 'new' ? null : showDecisionForm}
          meetings={meetings}
          onClose={() => setShowDecisionForm(null)}
          onSaved={(m) => { setMsg({ text: m, kind: 'ok' }); setShowDecisionForm(null); refreshAll(); }}
        />
      )}
    </div>
  );
}

// ═══════════ فرم جلسه ═══════════

function MeetingForm({ meeting, onClose, onSaved }: {
  meeting: MeetingRow | null;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const [title, setTitle] = useState(meeting?.title || '');
  const [meetingDate, setMeetingDate] = useState(() => {
    const src = meeting?.meetingDate;
    if (src) return new Date(src).toISOString().slice(0, 16);
    return '';
  });
  const [members, setMembers] = useState(meeting?.members || '');
  const [agenda, setAgenda] = useState(meeting?.agenda || '');
  const [minutes, setMinutes] = useState(meeting?.minutes || '');
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState('');

  const save = () => startTransition(async () => {
    setErr('');
    if (!title.trim()) { setErr('عنوان جلسه الزامی است.'); return; }
    try {
      const body = JSON.stringify({
        title: title.trim(),
        meetingDate: meetingDate || null,
        members: members || null,
        agenda: agenda || null,
        minutes: minutes || null,
      });
      if (meeting) await api(`/api/admin/council?id=${meeting.id}`, { method: 'PATCH', body });
      else await api('/api/admin/council', { method: 'POST', body });
      onSaved(meeting ? 'جلسه به‌روزرسانی شد.' : 'جلسه ثبت شد.');
    } catch (e: any) { setErr(e.message); }
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800">{meeting ? 'ویرایش جلسه' : 'جلسه جدید شورای آموزشی'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>
        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2 rounded-lg">{err}</div>}

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">عنوان جلسه *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="مثلاً جلسهٔ عادی شورای آموزشی — بررسی حذف و اضافه" />
        </label>

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">تاریخ و ساعت برگزاری</span>
          <input type="datetime-local" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">اعضا (هر نفر در یک خط — نام — سِمت)</span>
          <textarea value={members} onChange={(e) => setMembers(e.target.value)} rows={3}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono text-xs" />
        </label>

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">دستور جلسه (هر بند در یک خط)</span>
          <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={3}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">صورت‌جلسه</span>
          <textarea value={minutes} onChange={(e) => setMinutes(e.target.value)} rows={5}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600">انصراف</button>
          <button onClick={save} disabled={busy}
            className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════ فرم مصوبه ═══════════

function DecisionForm({ decision, meetings, onClose, onSaved }: {
  decision: DecisionRow | null;
  meetings: MeetingRow[];
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const [meetingId, setMeetingId] = useState(decision?.meetingId || (meetings[0]?.id ?? 0));
  const [studentQuery, setStudentQuery] = useState(decision?.studentId ? String(decision.studentName ?? '') : '');
  const [studentId, setStudentId] = useState<number | null>(decision?.studentId ?? null);
  const [hits, setHits] = useState<{ studentId: number; studentCode: string; name: string; entryYear: number | null }[]>([]);
  const [picked, setPicked] = useState<{ studentId: number; studentCode: string; name: string } | null>(
    decision?.studentId && typeof decision.studentName === 'string'
      ? { studentId: decision.studentId, studentCode: decision.studentCode || '', name: decision.studentName }
      : null,
  );
  const [decisionType, setDecisionType] = useState(decision?.decisionType || DECISION_TYPES[0]);
  const [content, setContent] = useState(decision?.content || '');
  const [implementationStatus, setImplementationStatus] = useState(decision?.implementationStatus || IMPLEMENTATION_STATUSES[0]);
  const [deadline, setDeadline] = useState(() => decision?.deadline ? decision.deadline.slice(0, 10) : '');
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState('');

  const search = (q: string) => {
    setStudentQuery(q);
    setPicked(null);
    setStudentId(null);
    if (q.trim().length < 2) { setHits([]); return; }
    setTimeout(async () => {
      try {
        const data = await api(`/api/admin/discipline?action=students&q=${encodeURIComponent(q.trim())}`);
        setHits(data.hits || []);
      } catch { setHits([]); }
    }, 300);
  };

  const save = () => startTransition(async () => {
    setErr('');
    if (!meetingId) { setErr('جلسه را انتخاب کنید.'); return; }
    if (!content.trim()) { setErr('متن مصوبه الزامی است.'); return; }
    try {
      const body = JSON.stringify({
        meetingId,
        studentId: studentId || null,
        decisionType,
        content: content.trim(),
        implementationStatus,
        deadline: deadline || null,
      });
      if (decision) await api(`/api/admin/council/decisions?id=${decision.id}`, { method: 'PATCH', body });
      else await api('/api/admin/council/decisions', { method: 'POST', body });
      onSaved(decision ? 'مصوبه به‌روزرسانی شد.' : 'مصوبه ثبت شد.');
    } catch (e: any) { setErr(e.message); }
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800">{decision ? 'ویرایش مصوبه' : 'مصوبه جدید'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>
        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2 rounded-lg">{err}</div>}

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">جلسه *</span>
          <select value={meetingId} onChange={(e) => setMeetingId(Number(e.target.value))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value={0}>— انتخاب جلسه —</option>
            {meetings.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </label>

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">دانشجوی ذی‌نفع (خالی = مصوبه عمومی)</span>
          <input
            value={picked ? `${picked.name} (${picked.studentCode})` : studentQuery}
            onChange={(e) => search(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="نام یا شماره دانشجو…" />
          {hits.length > 0 && !picked && (
            <div className="border border-slate-200 rounded-lg max-h-36 overflow-y-auto divide-y divide-slate-100">
              {hits.map((h) => (
                <button key={h.studentId} type="button"
                  onClick={() => { setPicked(h); setStudentId(h.studentId); setHits([]); setStudentQuery(h.name); }}
                  className="w-full text-right px-3 py-2 text-sm hover:bg-blue-50">
                  {h.name} <span className="text-xs text-slate-400 font-mono">{h.studentCode}</span>
                </button>
              ))}
            </div>
          )}
          {picked && (
            <button type="button" onClick={() => { setPicked(null); setStudentId(null); setStudentQuery(''); }}
              className="text-rose-500 text-xs hover:underline">حذف انتخاب دانشجو</button>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-slate-500 space-y-1">
            <span className="block">نوع</span>
            <select value={decisionType} onChange={(e) => setDecisionType(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
              {DECISION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block text-xs text-slate-500 space-y-1">
            <span className="block">وضعیت اجرا</span>
            <select value={implementationStatus} onChange={(e) => setImplementationStatus(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
              {IMPLEMENTATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">متن مصوبه *</span>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>

        <label className="block text-xs text-slate-500 space-y-1">
          <span className="block">مهلت اجرا</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600">انصراف</button>
          <button onClick={save} disabled={busy}
            className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </div>
      </div>
    </div>
  );
}
