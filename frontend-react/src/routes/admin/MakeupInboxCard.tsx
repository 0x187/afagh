import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { apiGet, apiPost } from '@/lib/api';
import { faDigits, faNumber } from '@/lib/fa';

// ═══ Makeup class requests inbox — port of MakeupInboxClient.tsx ═══
// Real professor-submitted makeup sessions (class_sessions PROPOSED) —
// approving assigns a hall and officially schedules the session.

type MakeupRow = {
  id: number;
  courseTitle: string;
  courseCode: string;
  groupNumber: number;
  professorName: string;
  staffCode: string;
  replacedSessionNo: number | null;
  absenceReason: string | null;
  sessionDate: string | null;
  sessionTime: string;
  topic: string | null;
  status: string;
  roomName: string | null;
  rejectionReason: string | null;
  enrolledCount: number;
};

type MakeupRoom = { id: number; name: string; capacity: number; buildingName: string | null };

export function MakeupInboxCard() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [selectedRooms, setSelectedRooms] = useState<Record<number, number>>({});
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectionText, setRejectionText] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: ['makeup-inbox'],
    queryFn: () => apiGet<{ ok: boolean; data: { rows: MakeupRow[]; rooms: MakeupRoom[] } }>('/admin/makeup-inbox'),
    staleTime: 15_000,
    retry: false,
  });
  const rows = data?.data.rows ?? [];
  const rooms = data?.data.rooms ?? [];

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 8000);
  };

  const approve = async (id: number) => {
    const roomId = selectedRooms[id] ?? rooms[0]?.id;
    if (!roomId) {
      showToast('err', 'سالنی در سیستم تعریف نشده است.');
      return;
    }
    setBusy(id);
    const res = await apiPost<{ ok: boolean; error?: string }>(`/admin/makeup/${id}/approve`, { roomId });
    setBusy(null);
    if (!res.ok) {
      showToast('err', res.error ?? 'خطا');
      return;
    }
    const room = rooms.find(r => r.id === roomId);
    showToast('ok', `✓ جلسهٔ جبرانی تأیید و سالن «${room?.name ?? ''}» تخصیص داده شد.`);
    void queryClient.invalidateQueries({ queryKey: ['makeup-inbox'] });
  };

  const reject = async (id: number) => {
    setBusy(id);
    const res = await apiPost<{ ok: boolean; error?: string }>(`/admin/makeup/${id}/reject`, { reason: rejectionText });
    setBusy(null);
    if (!res.ok) {
      showToast('err', res.error ?? 'خطا');
      return;
    }
    setRejectingId(null);
    setRejectionText('');
    showToast('ok', '✕ درخواست رد شد و به استاد اطلاع‌رسانی می‌شود.');
    void queryClient.invalidateQueries({ queryKey: ['makeup-inbox'] });
  };

  const filtered = rows.filter(r => {
    if (filter === 'PENDING') return r.status === 'PROPOSED';
    if (filter === 'APPROVED') return r.status === 'SCHEDULED';
    if (filter === 'REJECTED') return r.status === 'REJECTED';
    return true;
  });
  const pendingCount = rows.filter(r => r.status === 'PROPOSED').length;

  return (
    <div className="card space-y-4 border-l-4 border-l-indigo-600 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 text-xl shadow-xs">🏛️</div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-slate-800 sm:text-base">
                کارتابل درخواست‌های کلاس جبرانی اساتید (تخصیص سالن و تایید آموزش)
              </h2>
              {pendingCount > 0 && (
                <span className="animate-pulse rounded-full bg-rose-500 px-2.5 py-0.5 text-xs font-black text-white">
                  {faNumber(pendingCount)} نیازمند بررسی
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">درخواست‌های واقعی ثبت‌شده توسط اساتید — تأیید یعنی تخصیص سالن و ابلاغ رسمی</p>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 text-xs font-bold">
          {([
            ['ALL', `همه (${faNumber(rows.length)})`],
            ['PENDING', `⏳ در انتظار تخصیص (${faNumber(pendingCount)})`],
            ['APPROVED', `✓ تایید و ابلاغ‌شده (${faNumber(rows.filter(r => r.status === 'SCHEDULED').length)})`],
            ['REJECTED', `✕ ردشده (${faNumber(rows.filter(r => r.status === 'REJECTED').length)})`],
          ] as [typeof filter, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-lg px-3 py-1.5 transition ${
                filter === key ? 'bg-white text-indigo-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {toast && (
        <div className={`flex items-center justify-between rounded-xl border p-3 text-xs font-bold ${
          toast.kind === 'ok'
            ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
            : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
        }`}>
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} className="font-black">✕</button>
        </div>
      )}

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-400">
            درخواستی با وضعیت انتخابی در کارتابل موجود نیست.
          </div>
        ) : filtered.map(req => {
          const isPending = req.status === 'PROPOSED';
          const isApproved = req.status === 'SCHEDULED';
          const isRejected = req.status === 'REJECTED';
          return (
            <div
              key={req.id}
              className={`rounded-2xl border p-4 transition-all ${
                isPending ? 'border-amber-200 bg-amber-50/40 shadow-xs'
                : isApproved ? 'border-emerald-200 bg-emerald-50/30'
                : 'border-rose-200 bg-rose-50/30'
              }`}
            >
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div className="flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black text-slate-900">{req.courseTitle}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">کد: {req.courseCode} · گروه {faNumber(req.groupNumber)}</span>
                    <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-extrabold text-indigo-900">
                      استاد: {req.professorName} ({faDigits(req.staffCode)})
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      isPending ? 'border border-amber-300 bg-amber-200 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
                      : isApproved ? 'border border-emerald-300 bg-emerald-200 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                      : 'border border-rose-300 bg-rose-200 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200'
                    }`}>
                      {isPending ? '⏳ نیازمند تخصیص کلاس آموزش' : isApproved ? '✓ تایید و ابلاغ رسمی شده' : '✕ رد شده'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                    {req.replacedSessionNo != null && (
                      <span><strong className="text-slate-800">جلسه جبران‌شده:</strong> جلسه {faNumber(req.replacedSessionNo)}</span>
                    )}
                    {req.absenceReason && <span><strong className="text-slate-800">علت غیبت:</strong> {req.absenceReason}</span>}
                    <span><strong className="text-slate-800">زمان پیشنهادی:</strong> {faDigits(req.sessionDate ?? '—')} ساعت {req.sessionTime}</span>
                    <span><strong className="text-slate-800">تعداد دانشجویان:</strong> {faNumber(req.enrolledCount)} نفر</span>
                  </div>

                  {req.topic && (
                    <p className="inline-block rounded-lg border border-slate-200 bg-white/80 p-2 text-xs text-slate-700">
                      <strong>سرفصل مبحث:</strong> {req.topic}
                    </p>
                  )}

                  {isApproved && (
                    <div className="rounded-xl border border-emerald-300 bg-emerald-100/80 p-2.5 text-xs font-bold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                      🏛️ کلاس تخصیص‌یافته: <strong>{req.roomName ?? '—'}</strong>
                    </div>
                  )}
                  {isRejected && (
                    <div className="rounded-xl border border-rose-300 bg-rose-100/80 p-2 text-xs font-bold text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
                      دلیل عدم تایید: {req.rejectionReason ?? '—'}
                    </div>
                  )}
                </div>

                {isPending && (
                  <div className="flex min-w-[280px] flex-col gap-2 rounded-xl border border-amber-200 bg-white p-3 shadow-xs">
                    <label className="text-[11px] font-bold text-slate-700">🏢 انتخاب کلاس خالی دانشگاه در این سانس:</label>
                    <select
                      value={selectedRooms[req.id] ?? rooms[0]?.id ?? ''}
                      onChange={e => setSelectedRooms({ ...selectedRooms, [req.id]: Number(e.target.value) })}
                      className="rounded-lg border border-slate-300 bg-slate-50 p-2 text-xs font-bold text-slate-800 focus:bg-white"
                    >
                      {rooms.map(rm => (
                        <option key={rm.id} value={rm.id}>
                          🟢 {rm.name}{rm.capacity ? ` (ظرفیت ${faNumber(rm.capacity)} نفر)` : ''}{rm.buildingName ? ` - ${rm.buildingName}` : ''}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => approve(req.id)}
                        disabled={busy === req.id}
                        className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <span>{busy === req.id ? '⏳…' : '✓ تایید و تخصیص کلاس'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRejectingId(req.id); setRejectionText(''); }}
                        className="rounded-lg bg-rose-100 px-3 py-2 text-xs font-bold text-rose-800 transition hover:bg-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:hover:bg-rose-900"
                      >
                        رد
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {rejectingId === req.id && (
                <div className="mt-3 space-y-2 rounded-xl border border-rose-300 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-950">
                  <label className="block text-xs font-bold text-rose-900 dark:text-rose-200">دلیل رد درخواست جبرانی (جهت اطلاع استاد):</label>
                  <input
                    type="text"
                    value={rejectionText}
                    onChange={e => setRejectionText(e.target.value)}
                    placeholder="مثلاً: تداخل با آزمون‌های هماهنگ دانشگاه در این تاریخ..."
                    className="w-full rounded-lg border border-rose-300 bg-white p-2 text-xs font-bold"
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setRejectingId(null)} className="rounded bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">انصراف</button>
                    <button
                      type="button"
                      onClick={() => reject(req.id)}
                      disabled={busy === req.id}
                      className="rounded bg-rose-700 px-4 py-1 text-xs font-extrabold text-white shadow-xs hover:bg-rose-800 disabled:opacity-50"
                    >
                      {busy === req.id ? '⏳…' : 'ثبت رد درخواست'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
