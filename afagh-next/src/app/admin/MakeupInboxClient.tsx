'use client';

import { useState } from 'react';
import { approveMakeupSession, rejectMakeupSession, type MakeupInboxRow } from './makeup-actions';

interface Props {
  initialRows: MakeupInboxRow[];
  rooms: { id: number; name: string; capacity: number; buildingName: string | null }[];
}

export default function MakeupInboxClient({ initialRows, rooms }: Props) {
  const [rows, setRows] = useState<MakeupInboxRow[]>(initialRows);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [selectedRooms, setSelectedRooms] = useState<Record<number, number>>({});
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectionText, setRejectionText] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

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
    const res = await approveMakeupSession(id, roomId);
    setBusy(null);
    if (!res.ok) {
      showToast('err', res.error);
      return;
    }
    const room = rooms.find(r => r.id === roomId);
    setRows(prev => prev.map(r => (r.id === id ? { ...r, status: 'SCHEDULED', roomName: room?.name ?? null } : r)));
    showToast('ok', `✓ جلسهٔ جبرانی تأیید و سالن «${room?.name ?? ''}» تخصیص داده شد.`);
  };

  const reject = async (id: number) => {
    setBusy(id);
    const res = await rejectMakeupSession(id, rejectionText);
    setBusy(null);
    if (!res.ok) {
      showToast('err', res.error);
      return;
    }
    setRejectingId(null);
    setRejectionText('');
    setRows(prev => prev.map(r => (r.id === id ? { ...r, status: 'REJECTED', rejectionReason: rejectionText } : r)));
    showToast('ok', '✕ درخواست رد شد و به استاد اطلاع‌رسانی می‌شود.');
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
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-xl shadow-xs">
            🏛️
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-extrabold text-slate-800 text-sm sm:text-base">
                کارتابل درخواست‌های کلاس جبرانی اساتید (تخصیص سالن و تایید آموزش)
              </h2>
              {pendingCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-500 text-white animate-pulse">
                  {pendingCount} نیازمند بررسی
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              درخواست‌های واقعی ثبت‌شده توسط اساتید — تأیید یعنی تخصیص سالن و ابلاغ رسمی
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
          <button onClick={() => setFilter('ALL')} className={`px-3 py-1.5 rounded-lg transition ${filter === 'ALL' ? 'bg-white text-indigo-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>
            همه ({rows.length})
          </button>
          <button onClick={() => setFilter('PENDING')} className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${filter === 'PENDING' ? 'bg-amber-500 text-white shadow-xs' : 'text-amber-800 hover:bg-amber-100/60'}`}>
            <span>⏳ در انتظار تخصیص</span>
            <span className="px-1.5 py-0.2 rounded-full bg-amber-700/40 text-3xs">{pendingCount}</span>
          </button>
          <button onClick={() => setFilter('APPROVED')} className={`px-3 py-1.5 rounded-lg transition ${filter === 'APPROVED' ? 'bg-emerald-600 text-white shadow-xs' : 'text-emerald-800 hover:bg-emerald-100/60'}`}>
            ✓ تایید و ابلاغ‌شده ({rows.filter(r => r.status === 'SCHEDULED').length})
          </button>
          <button onClick={() => setFilter('REJECTED')} className={`px-3 py-1.5 rounded-lg transition ${filter === 'REJECTED' ? 'bg-rose-600 text-white shadow-xs' : 'text-rose-800 hover:bg-rose-100/60'}`}>
            ✕ ردشده ({rows.filter(r => r.status === 'REJECTED').length})
          </button>
        </div>
      </div>

      {toast && (
        <div className={`p-3 border rounded-xl text-xs font-bold flex items-center justify-between ${toast.kind === 'ok' ? 'bg-emerald-50 border-emerald-300 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-red-50 border-red-300 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'}`}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} className="font-black">✕</button>
        </div>
      )}

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-xs">
            درخواستی با وضعیت انتخابی در کارتابل موجود نیست.
          </div>
        ) : (
          filtered.map(req => {
            const isPending = req.status === 'PROPOSED';
            const isApproved = req.status === 'SCHEDULED';
            const isRejected = req.status === 'REJECTED';
            return (
              <div
                key={req.id}
                className={`p-4 rounded-2xl border transition-all ${
                  isPending ? 'bg-amber-50/40 border-amber-200 shadow-xs'
                  : isApproved ? 'bg-emerald-50/30 border-emerald-200'
                  : 'bg-rose-50/30 border-rose-200'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-black text-slate-900 text-sm">{req.courseTitle}</span>
                      <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">کد: {req.courseCode} · گروه {req.groupNumber}</span>
                      <span className="text-xs font-extrabold text-indigo-900 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-full">
                        استاد: {req.professorName} ({req.staffCode})
                      </span>
                      <span className={`text-2xs px-2.5 py-0.5 rounded-full font-bold ${
                        isPending ? 'bg-amber-200 text-amber-900 border border-amber-300 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
                        : isApproved ? 'bg-emerald-200 text-emerald-900 border border-emerald-300 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                        : 'bg-rose-200 text-rose-900 border border-rose-300 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200'
                      }`}>
                        {isPending ? '⏳ نیازمند تخصیص کلاس آموزش' : isApproved ? '✓ تایید و ابلاغ رسمی شده' : '✕ رد شده'}
                      </span>
                    </div>

                    <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
                      {req.replacedSessionNo != null && (
                        <span><strong className="text-slate-800">جلسه جبران‌شده:</strong> جلسه {req.replacedSessionNo}</span>
                      )}
                      {req.absenceReason && (
                        <span><strong className="text-slate-800">علت غیبت:</strong> {req.absenceReason}</span>
                      )}
                      <span><strong className="text-slate-800">زمان پیشنهادی:</strong> {req.sessionDate} ساعت {req.sessionTime}</span>
                      <span><strong className="text-slate-800">تعداد دانشجویان:</strong> {req.enrolledCount} نفر</span>
                    </div>

                    {req.topic && (
                      <p className="text-xs text-slate-700 bg-white/80 p-2 rounded-lg border border-slate-200 inline-block">
                        <strong>سرفصل مبحث:</strong> {req.topic}
                      </p>
                    )}

                    {isApproved && (
                      <div className="p-2.5 bg-emerald-100/80 border border-emerald-300 rounded-xl text-xs text-emerald-900 font-bold dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                        🏛️ کلاس تخصیص‌یافته: <strong>{req.roomName ?? '—'}</strong>
                      </div>
                    )}

                    {isRejected && (
                      <div className="p-2 bg-rose-100/80 border border-rose-300 rounded-xl text-xs text-rose-900 font-bold dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
                        دلیل عدم تایید: {req.rejectionReason ?? '—'}
                      </div>
                    )}
                  </div>

                  {isPending && (
                    <div className="bg-white p-3 rounded-xl border border-amber-200 shadow-xs flex flex-col gap-2 min-w-[280px]">
                      <label className="text-2xs font-bold text-slate-700">🏢 انتخاب کلاس خالی دانشگاه در این سانس:</label>
                      <select
                        value={selectedRooms[req.id] ?? rooms[0]?.id ?? ''}
                        onChange={e => setSelectedRooms({ ...selectedRooms, [req.id]: Number(e.target.value) })}
                        className="text-xs border border-slate-300 rounded-lg p-2 font-bold text-slate-800 bg-slate-50 focus:bg-white"
                      >
                        {rooms.map(rm => (
                          <option key={rm.id} value={rm.id}>
                            🟢 {rm.name}{rm.capacity ? ` (ظرفیت ${rm.capacity} نفر)` : ''}{rm.buildingName ? ` - ${rm.buildingName}` : ''}
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => approve(req.id)}
                          disabled={busy === req.id}
                          className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-xs transition disabled:opacity-50"
                        >
                          <span>{busy === req.id ? '⏳…' : '✓ تایید و تخصیص کلاس'}</span>
                        </button>
                        <button
                          onClick={() => { setRejectingId(req.id); setRejectionText(''); }}
                          className="py-2 px-3 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-xs transition dark:bg-rose-950 dark:text-rose-200 dark:hover:bg-rose-900"
                        >
                          رد
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {rejectingId === req.id && (
                  <div className="mt-3 p-3 bg-rose-50 rounded-xl border border-rose-300 space-y-2 dark:border-rose-800 dark:bg-rose-950">
                    <label className="text-xs font-bold text-rose-900 block dark:text-rose-200">دلیل رد درخواست جبرانی (جهت اطلاع استاد):</label>
                    <input
                      type="text"
                      value={rejectionText}
                      onChange={e => setRejectionText(e.target.value)}
                      placeholder="مثلاً: تداخل با آزمون‌های هماهنگ دانشگاه در این تاریخ..."
                      className="w-full text-xs border border-rose-300 rounded-lg p-2 bg-white font-bold"
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setRejectingId(null)} className="px-3 py-1 rounded bg-slate-200 text-slate-700 text-xs font-bold">انصراف</button>
                      <button onClick={() => reject(req.id)} disabled={busy === req.id} className="px-4 py-1 rounded bg-rose-700 hover:bg-rose-800 text-white text-xs font-extrabold shadow-xs disabled:opacity-50">
                        {busy === req.id ? '⏳…' : 'ثبت رد درخواست'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
