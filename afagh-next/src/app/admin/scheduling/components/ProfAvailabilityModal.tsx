'use client';

// مودال «برنامهٔ اعلامی استاد» برای مدیر گروه — اکنون قابل ویرایش است.
// قبلاً فقط‌خواندنی بود و اگر استاد اعلام نمی‌کرد یا اشتباه اعلام می‌کرد،
// مدیر گروه دستش بسته بود. حالا همان ماتریس سه‌حالتهٔ پرتال استاد را دارد و
// با مجوز مدیر/کارشناس ذخیره می‌شود (saveProfessorAvailabilityForStaffAction).
import { useMemo, useState } from 'react';
import { usePlanning } from '../PlanningProvider';
import { faNum, DAY_NAMES } from '../planning-core';
import { saveProfessorAvailabilityForStaffAction } from '../availability-actions';

type Status = 'PREF' | 'AVAIL' | 'UNAVAIL';

export default function ProfAvailabilityModal() {
  const {
    editingProf, editingProfId, isProfAvailabilityModalOpen, realAvailRows,
    selectedTermId, setIsProfAvailabilityModalOpen, teachingSlots,
  } = usePlanning();

  const [grid, setGrid] = useState<Record<string, Status>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ماتریس اولیه از ردیف‌های واقعی همان استاد (روز + ساعت شروع/پایان)
  const initial = useMemo(() => {
    const g: Record<string, Status> = {};
    for (let d = 0; d < 7; d++) {
      for (const s of teachingSlots) {
        const row = realAvailRows.find(r =>
          r.staffId === editingProfId && r.dayOfWeek === d &&
          String(r.startTime ?? '').slice(0, 5) === s.startTime &&
          String(r.endTime ?? '').slice(0, 5) === s.endTime);
        g[`${d}:${s.id}`] = (row?.status as Status) || 'UNAVAIL';
      }
    }
    return g;
  }, [realAvailRows, editingProfId, teachingSlots]);

  if (!isProfAvailabilityModalOpen) return null;

  const current = (d: number, sid: number): Status => grid[`${d}:${sid}`] ?? initial[`${d}:${sid}`] ?? 'UNAVAIL';
  const toggle = (d: number, sid: number) => {
    const cur = current(d, sid);
    const next: Status = cur === 'PREF' ? 'AVAIL' : cur === 'AVAIL' ? 'UNAVAIL' : 'PREF';
    setGrid(g => ({ ...g, [`${d}:${sid}`]: next }));
  };

  /** «انتخاب همه» — کل ماتریس را یک‌جا روی یک وضعیت می‌برد */
  const applyAll = (st: Status) => {
    const g: Record<string, Status> = {};
    for (let d = 0; d < 7; d++) for (const s of teachingSlots) g[`${d}:${s.id}`] = st;
    setGrid(g);
  };

  const save = async () => {
    if (!selectedTermId) { setMsg('ترمی انتخاب نشده است.'); return; }
    setSaving(true);
    setMsg(null);
    const cells: { dayIndex: number; slotIndex: number; status: Status; startTime: string; endTime: string }[] = [];
    for (let d = 0; d < 7; d++) {
      for (const s of teachingSlots) {
        cells.push({
          dayIndex: d, slotIndex: s.id, status: current(d, s.id),
          startTime: s.startTime, endTime: s.endTime,
        });
      }
    }
    const res = await saveProfessorAvailabilityForStaffAction(editingProfId, selectedTermId, cells);
    setSaving(false);
    if (!res.ok) { setMsg(res.error || 'ذخیره نشد.'); return; }
    setMsg('✅ ذخیره شد — موتور زمان‌بندی از همین بازه‌ها استفاده می‌کند.');
    setTimeout(() => { window.location.reload(); }, 900);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-4 bg-indigo-950 text-white flex items-center justify-between">
          <div>
            <h3 className="font-extrabold text-sm sm:text-base">
              📖 برنامهٔ اعلامی استاد: {editingProf.name}
            </h3>
            <span className="text-xs text-indigo-200">
              {editingProf.academicRank} — {editingProf.departmentName}
            </span>
          </div>
          <button onClick={() => setIsProfAvailabilityModalOpen(false)} className="text-white/60 hover:text-white">✕</button>
        </div>

        <div className="p-4 overflow-auto space-y-3 text-xs">
          <p className="text-2xs text-slate-600 font-bold">
            مدیر گروه می‌تواند این ماتریس را به‌نام استاد اصلاح کند. روی هر خانه کلیک کنید:
            <b className="text-emerald-700"> 🟩 اولویت</b> · <b className="text-amber-700"> 🟨 در صورت نیاز</b> · <b className="text-rose-700"> 🟥 عدم حضور</b>
          </p>

          {/* انتخاب همه — یک کلیک برای کل ماتریس */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-3xs font-black text-slate-500">انتخاب همه:</span>
            <button type="button" onClick={() => applyAll('PREF')} className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-900 font-bold text-2xs hover:bg-emerald-200">🟩 همه اولویت</button>
            <button type="button" onClick={() => applyAll('AVAIL')} className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 font-bold text-2xs hover:bg-amber-200">🟨 همه در صورت نیاز</button>
            <button type="button" onClick={() => applyAll('UNAVAIL')} className="px-2.5 py-1 rounded-lg bg-rose-100 text-rose-900 font-bold text-2xs hover:bg-rose-200">🟥 همه عدم حضور</button>
            <button type="button" onClick={() => setGrid({})} className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold text-2xs hover:bg-slate-200">↺ بازگردانی</button>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full border-collapse text-xs rt">
              <thead>
                <tr className="bg-slate-900 text-white text-center">
                  <th className="p-2 border border-slate-800 font-extrabold w-24">روز</th>
                  {teachingSlots.map(s => (
                    <th key={s.id} className="p-2 border border-slate-800 font-extrabold whitespace-nowrap">
                      {s.startTime}–{s.endTime}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAY_NAMES.slice(0, 7).map((day, d) => (
                  <tr key={d} className={d % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="p-2 border border-slate-200 font-extrabold text-center bg-slate-100">{day}</td>
                    {teachingSlots.map(s => {
                      const st = current(d, s.id);
                      const cls = st === 'PREF'
                        ? 'bg-emerald-600 text-white border-emerald-700'
                        : st === 'AVAIL'
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : 'bg-rose-100 text-rose-900 border-rose-300';
                      return (
                        <td key={s.id} className="p-1.5 border border-slate-200 text-center">
                          <button
                            type="button"
                            onClick={() => toggle(d, s.id)}
                            className={`w-full py-2 rounded-lg border font-extrabold text-3xs ${cls}`}
                          >
                            {st === 'PREF' ? '🟩 اولویت' : st === 'AVAIL' ? '🟨 در صورت نیاز' : '🟥 عدم حضور'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-3xs text-slate-500 font-bold">
            {faNum(teachingSlots.length)} زنگ در روز · ترتیب زنگ‌ها از تنظیمات دانشگاه می‌آید (ساعت کلاس و برنامه‌ریزی).
          </div>
          {msg && <div className="p-2 rounded-lg bg-slate-100 text-slate-800 font-bold">{msg}</div>}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
          <span className="text-3xs font-bold text-slate-500">
            {selectedTermId ? `ترم فعال: ${faNum(selectedTermId)}` : 'ترمی انتخاب نشده'}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setIsProfAvailabilityModalOpen(false)} className="px-4 py-1.5 rounded-lg bg-slate-200 text-slate-700 font-bold text-xs">
              بستن
            </button>
            <button
              onClick={save}
              disabled={saving || !selectedTermId}
              className="px-4 py-1.5 rounded-lg bg-indigo-900 hover:bg-indigo-950 text-white font-extrabold text-xs disabled:opacity-50"
            >
              {saving ? 'در حال ذخیره…' : '💾 ذخیرهٔ برنامهٔ استاد'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
