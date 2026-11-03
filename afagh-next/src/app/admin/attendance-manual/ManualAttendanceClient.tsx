'use client';

import { useMemo, useState, useTransition } from 'react';
import { confirmProfessorAttendanceAction, markClassHeldAction } from './actions';

export interface ManualRow {
  sessionId: number;
  sessionNo: number;
  sessionDate: string;
  time: string;
  isMakeUp: boolean;
  isHoliday: boolean;
  isExtraSession: boolean;
  sessionStatus: string;
  courseCode: string | null;
  courseTitle: string | null;
  staffId: number | null;
  professorName: string;
  method: string | null;
  status: string | null;
  note: string | null;
  punches: number;
  /** کلیدِ ادغامِ دستیِ عرضه (برای گروه‌بندی در سرور) */
  sharedScheduleGroupKey?: string | null;
  /** این ردیف یک «کلاس ادغامی» است — چند عرضه در یک جلسهٔ فیزیکی */
  merged?: boolean;
  /** چند عرضه در این کلاس ادغام شده‌اند */
  memberCount?: number;
  /** همهٔ شناسهٔ جلسه‌های عضو (ثبت روی همهٔ این‌ها اعمال می‌شود) */
  memberSessionIds?: number[];
  /** برچسبِ کوتاهِ نشانِ ادغام */
  memberTitles?: string;
}

const faNum = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

const METHOD_FA: Record<string, string> = {
  MANUAL_BY_EXPERT: 'تأیید دستی کارشناس',
  MANUAL_ATTENDANCE_SHEET: 'برگهٔ حضور استاد',
  FINGERPRINT: 'اثر انگشت (گیت)',
  BIOMETRIC_CHAIN: 'زنجیرهٔ اثر انگشت',
};

/**
 * رابط مجزای «تأیید دستی حضور استاد» — جست‌وجو + تأیید/لغو تک‌کلیکی.
 * وضعیت خودکار (اثر انگشت) و وضعیت ثبت‌شده کنار هم نشان داده می‌شود.
 */
export default function ManualAttendanceClient({
  terms,
  termId,
  termTitle,
  rows,
}: {
  terms: { id: number; title: string; termCode: string; isCurrent: boolean; isActive: boolean }[];
  termId: number;
  termTitle: string;
  rows: ManualRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [done, setDone] = useState<Record<number, { present: boolean; note?: string }>>({});
  const [heldMap, setHeldMap] = useState<Record<number, boolean>>({});
  const isHeld = (r: ManualRow) => heldMap[r.sessionId] ?? (r.sessionStatus === 'HELD');

  /** تیک زندهٔ «تشکیل کلاس» — همان منبع شمارش جلسات برگزارشده در حق‌الزحمه */
  const markHeld = (r: ManualRow, held: boolean) => {
    startTransition(async () => {
      const res = await markClassHeldAction({ sessionId: r.sessionId, held });
      if (res.ok) {
        setHeldMap(prev => ({ ...prev, [r.sessionId]: held }));
        setMsg({ ok: true, text: held ? `تشکیل کلاس جلسهٔ ${faNum(r.sessionNo)} ثبت شد.` : `تیک تشکیل جلسهٔ ${faNum(r.sessionNo)} لغو شد.` });
      } else {
        setMsg({ ok: false, text: res.error ?? 'ثبت تشکیل کلاس ممکن نشد.' });
      }
    });
  };

  const filtered = useMemo(() => {
    const needle = q.trim();
    return rows.filter(r => {
      const recorded = done[r.sessionId]?.present ?? (r.status === 'VALID');
      if (onlyMissing && recorded) return false;
      if (!needle) return true;
      return `${r.courseCode ?? ''} ${r.courseTitle ?? ''} ${r.professorName} ${r.sessionDate}`.includes(needle);
    });
  }, [rows, q, onlyMissing, done]);

  const act = (r: ManualRow, present: boolean) => {
    if (!r.staffId) { setMsg({ ok: false, text: 'استاد این درس ثبت نشده است.' }); return; }
    startTransition(async () => {
      const res = await confirmProfessorAttendanceAction({ sessionId: r.sessionId, staffId: r.staffId as number, isPresent: present });
      if (res.ok) {
        setDone(prev => ({ ...prev, [r.sessionId]: { present } }));
        setMsg({ ok: true, text: present ? `حضور ${r.professorName} برای جلسهٔ ${faNum(r.sessionNo)} تأیید شد.` : `تأیید حضور جلسهٔ ${faNum(r.sessionNo)} لغو شد.` });
      } else {
        setMsg({ ok: false, text: res.error ?? 'ثبت ممکن نشد.' });
      }
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="overflow-hidden rounded-2xl border border-indigo-900/20 bg-gradient-to-l from-indigo-800 via-indigo-700 to-slate-900 p-4 text-white shadow-lg">
        <h1 className="text-lg font-black">🧑‍🏫 حضور و تشکیل کلاس — تأیید دستی کارشناس</h1>
        <p className="mt-1 text-xs text-indigo-50/90">
          دو کار در یک صفحه: (۱) <b>تیک «تشکیل کلاس»</b> به‌صورت زنده — همان چیزی که استاد در کارتابل خودش
          می‌زند و مبنای شمارش جلسات برگزارشده در حق‌الزحمه است؛ (۲) <b>تأیید دستی حضور استاد</b> وقتی سامانهٔ
          اثر انگشت ثبت نکرده (روش ثبت: «تأیید دستی کارشناس» + یادداشت و هویت تأییدکننده در ممیزی).
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-300 bg-white p-3">
        <label className="text-2xs font-bold text-slate-700">
          نیمسال
          <select
            value={termId}
            onChange={e => { window.location.href = `/admin/attendance-manual?term=${e.target.value}`; }}
            className="mt-1 block min-w-[220px] rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          >
            {terms.map(t => (
              <option key={t.id} value={t.id}>
                {t.title} ({t.termCode}){t.isActive ? ' — نیمسال فعال' : t.isCurrent ? ' — جاری' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-2xs font-bold text-slate-700">
          جست‌وجو (درس/استاد/تاریخ)
          <input value={q} onChange={e => setQ(e.target.value)} className="mt-1 block w-56 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
        </label>
        <label className="flex items-center gap-1 pb-2 text-2xs font-bold text-slate-700">
          <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} />
          فقط جلسه‌های بدون تأیید
        </label>
        <span className="mr-auto text-2xs text-slate-500">
          {faNum(filtered.length)} جلسه از {faNum(rows.length)} — {termTitle}
        </span>
      </div>

      {msg && (
        <div className={`rounded-lg border px-3 py-2 text-xs font-bold ${msg.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-rose-300 bg-rose-50 text-rose-800'}`}>
          {msg.text}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
        <table className="w-full text-xs rt">
          <thead>
            <tr className="bg-slate-900 text-center text-2xs text-white">
              <th className="p-2.5">جلسه</th>
              <th className="p-2.5">تاریخ / ساعت</th>
              <th className="p-2.5">درس</th>
              <th className="p-2.5">استاد</th>
              <th className="p-2.5">اثر انگشت (گیت)</th>
              <th className="p-2.5">وضعیت ثبت‌شده</th>
              <th className="p-2.5">تشکیل کلاس (زنده)</th>
              <th className="p-2.5">تأیید دستی حضور</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const recorded = done[r.sessionId]?.present ?? (r.status === 'VALID');
              const manual = (done[r.sessionId] ? true : r.method === 'MANUAL_BY_EXPERT');
              return (
                <tr key={r.sessionId} className={`border-b border-slate-100 ${recorded ? 'bg-emerald-50/40' : ''}`}>
                  <td className="p-2.5 text-center font-mono font-black text-slate-700">
                    {faNum(r.sessionNo)}
                    {r.isMakeUp && <span className="mr-1 rounded bg-amber-100 px-1 text-[9px] font-black text-amber-800">جبرانی</span>}
                  </td>
                  <td className="p-2.5 text-center text-slate-600">
                    <span className="block font-mono">{faNum(r.sessionDate)}</span>
                    <span className="block text-3xs text-slate-400" dir="ltr">{r.time}</span>
                  </td>
                  <td className="p-2.5">
                    <span className="font-black text-indigo-950">{r.courseCode}</span>
                    <span className="block text-3xs text-slate-500">{r.courseTitle}</span>
                    {r.merged ? (
                      <span
                        title={`این کلاس از ${faNum(r.memberCount ?? 2)} عرضه تشکیل شده و ثبت روی همهٔ آن‌ها اعمال می‌شود.`}
                        className="mt-0.5 inline-block rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-black text-violet-800 border border-violet-200"
                      >
                        🔗 {r.memberTitles ?? 'کلاس ادغامی'}
                      </span>
                    ) : null}
                  </td>
                  <td className="p-2.5 font-bold text-slate-800">{r.professorName}</td>
                  <td className="p-2.5 text-center">
                    {r.punches > 0
                      ? <span className="rounded-full bg-teal-100 px-2 py-0.5 text-3xs font-black text-teal-800">✓ {faNum(r.punches)} تردد</span>
                      : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-3xs font-black text-slate-500">ثبت نشده</span>}
                  </td>
                  <td className="p-2.5 text-center">
                    {recorded
                      ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-3xs font-black text-emerald-800">✓ حاضر {manual ? '(دستی)' : ''}</span>
                      : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-3xs font-black text-slate-500">—</span>}
                    {r.note && <span className="mt-1 block text-[9px] text-slate-500">{r.note}</span>}
                  </td>
                  <td className="p-2.5 text-center">
                    {r.isHoliday && <span className="ml-1 rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-black text-rose-800">تعطیل</span>}
                    {r.isExtraSession && <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-black text-violet-800">فوق‌برنامه</span>}
                    {isHeld(r) ? (
                      <>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-3xs font-black text-emerald-800">✓ برگزار شد</span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => markHeld(r, false)}
                          className="mr-1 rounded-lg border border-slate-300 px-2 py-0.5 text-3xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                        >
                          لغو
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => markHeld(r, true)}
                        className="rounded-lg bg-indigo-700 px-2.5 py-1 text-3xs font-black text-white transition hover:bg-indigo-800 disabled:opacity-40"
                      >
                        تیک تشکیل کلاس
                      </button>
                    )}
                  </td>
                  <td className="p-2.5 text-center">
                    <button
                      type="button"
                      disabled={pending || !r.staffId}
                      onClick={() => act(r, true)}
                      className="rounded-lg bg-emerald-700 px-2.5 py-1 text-3xs font-black text-white transition hover:bg-emerald-800 disabled:opacity-40"
                    >
                      تأیید حضور
                    </button>
                    {recorded && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => act(r, false)}
                        className="mr-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1 text-3xs font-black text-rose-800 transition hover:bg-rose-100 disabled:opacity-40"
                      >
                        لغو
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-slate-500">جلسه‌ای با این فیلتر یافت نشد.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
