'use client';

import { useState } from 'react';
import { usePlanning } from '../PlanningProvider';
import { faNum } from '../planning-core';
import {
  allocateRoomQuotasAction,
  releaseRoomShiftAction,
  borrowReleasedShiftAction,
  upsertRoomGrantAction,
} from '../actions';

const SHIFT_LABEL: Record<string, string> = { MORNING: 'صبح', EVENING: 'عصر' };

export default function DeptRoomsTab() {
  const { classrooms, currentProgram, isDeptScope, selectedTermId, reloadWorkspace, roomGrants, initial } = usePlanning();
  const departments = (initial?.departments ?? []) as { id: number; name: string }[];
  const deptName = (id: number) => {
    const d = departments.find(x => x.id === id);
    return d ? `${d.name} (#${d.id})` : `دپارتمان #${id}`;
  };

  const [allocating, setAllocating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [facultyFilter, setFacultyFilter] = useState<number | 'ALL'>('ALL');

  // فرم تخصیص جدید
  const [newDept, setNewDept] = useState<number>(departments[0]?.id ?? 0);
  const [newShift, setNewShift] = useState<'MORNING' | 'EVENING'>('MORNING');
  const [newRoom, setNewRoom] = useState<number>(classrooms[0]?.id ?? 0);

  const facultyOptions = Array.from(new Set(classrooms.map(c => c.facultyId).filter((x): x is number => x != null)));
  const visibleRooms = (isDeptScope ? classrooms.filter(c => c.isAllocatedToDept) : classrooms)
    .filter(c => c.isActive)
    .filter(c => facultyFilter === 'ALL' || c.facultyId === facultyFilter);
  const grantsOf = (roomId: number) => roomGrants.filter(g => g.classroomId === roomId);

  const run = async (key: string, fn: () => Promise<any>, okMsg: string) => {
    setBusyKey(key);
    setMsg(null);
    try {
      const res = await fn();
      if (res?.ok) {
        setMsg(okMsg);
        reloadWorkspace();
      } else {
        setMsg(`⚠️ ${res?.error ?? 'خطا'}`);
      }
    } catch (e: any) {
      setMsg(`⚠️ ${e?.message ?? 'خطا'}`);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🏛️</span>
            <h3 className="font-extrabold text-slate-900 text-base">
              سالن‌ها و سهمیهٔ دپارتمان‌ها — «{currentProgram?.title ?? '—'}»
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            تخصیص/لغو/واگذاری سهمیهٔ سالن‌ها به دپارتمان‌ها. لغو یک سهمیه آن را برای پر کردن جای خالی توسط گروه‌های دیگر آزاد می‌کند.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={facultyFilter}
            onChange={e => setFacultyFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold bg-white"
          >
            <option value="ALL">همهٔ دانشکده‌ها</option>
            {facultyOptions.map(fid => {
              const name = classrooms.find(c => c.facultyId === fid)?.facultyName ?? `دانشکده #${fid}`;
              return <option key={fid} value={fid}>{name}</option>;
            })}
          </select>
          <span className="px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-900 font-extrabold text-xs">
            {isDeptScope
              ? `${faNum(visibleRooms.length)} سالن سهمیه‌دار این گروه`
              : `${faNum(classrooms.filter(c => c.isAllocatedToDept).length)} سالن سهمیه‌دار از ${faNum(classrooms.length)} سالن`}
          </span>
          {!isDeptScope && (
            <>
              <button
                type="button"
                disabled={allocating || !selectedTermId}
                onClick={async () => {
                  setAllocating(true);
                  setMsg(null);
                  try {
                    const res = await allocateRoomQuotasAction(selectedTermId);
                    if (res?.ok) {
                      setMsg(`✅ ${faNum(res.grants ?? 0)} سهمیهٔ سالن تخصیص یافت.`);
                      reloadWorkspace();
                    } else setMsg(`⚠️ ${res?.error ?? 'خطا'}`);
                  } catch (e: any) {
                    setMsg(`⚠️ ${e?.message ?? 'خطا'}`);
                  } finally {
                    setAllocating(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-indigo-900 hover:bg-indigo-950 text-white font-extrabold text-xs shadow disabled:opacity-50"
              >
                {allocating ? '⏳ در حال تخصیص…' : '🏛️ تخصیص خودکار سهمیه‌ها'}
              </button>
              <button
                type="button"
                disabled={allocating || !selectedTermId || !roomGrants.some(g => g.status === 'ALLOCATED')}
                onClick={async () => {
                  if (!confirm('همهٔ سهمیه‌های تخصیص‌یافته لغو شوند؟')) return;
                  setAllocating(true);
                  setMsg(null);
                  try {
                    const allocated = roomGrants.filter(g => g.status === 'ALLOCATED');
                    let okCount = 0;
                    for (const g of allocated) {
                      const res = await releaseRoomShiftAction({ termId: selectedTermId, departmentId: g.ownerDepartmentId, classroomId: g.classroomId, shift: g.shift as 'MORNING' | 'EVENING' });
                      if (res?.ok) okCount++;
                      else { setMsg(`⚠️ ${res?.error ?? 'خطا'}`); break; }
                    }
                    setMsg(`✅ ${faNum(okCount)} سهمیه لغو شد.`);
                    reloadWorkspace();
                  } catch (e: any) {
                    setMsg(`⚠️ ${e?.message ?? 'خطا'}`);
                  } finally {
                    setAllocating(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow disabled:opacity-50"
              >
                {allocating ? '⏳…' : '🗑️ لغو همهٔ سهمیه‌ها'}
              </button>
            </>
          )}
        </div>
      </div>

      {msg && <div className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">{msg}</div>}

      {!isDeptScope && classrooms.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3">
          <h4 className="font-extrabold text-slate-900 text-sm">➕ تخصیص دستی سالن به دپارتمان</h4>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={newRoom}
              onChange={e => setNewRoom(Number(e.target.value))}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold bg-white"
            >
              {classrooms.map(r => (
                <option key={r.id} value={r.id}>{r.name} ({faNum(r.capacity)} نفر)</option>
              ))}
            </select>
            <select
              value={newDept}
              onChange={e => setNewDept(Number(e.target.value))}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold bg-white"
            >
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name} (#{d.id})</option>
              ))}
            </select>
            <select
              value={newShift}
              onChange={e => setNewShift(e.target.value as 'MORNING' | 'EVENING')}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold bg-white"
            >
              <option value="MORNING">شیفت صبح</option>
              <option value="EVENING">شیفت عصر</option>
            </select>
            <button
              type="button"
              disabled={busyKey === 'new' || !selectedTermId || !newRoom || !newDept}
              onClick={() => run('new', () => upsertRoomGrantAction({ termId: selectedTermId, classroomId: newRoom, shift: newShift, departmentId: newDept }), '✅ سالن به دپارتمان تخصیص یافت.')}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow disabled:opacity-50"
            >
              {busyKey === 'new' ? '⏳…' : '➕ تخصیص'}
            </button>
          </div>
        </div>
      )}

      {isDeptScope && visibleRooms.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-6 text-center">
          <p className="font-extrabold text-amber-900">سالنی به این گروه سهمیه داده نشده است</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleRooms.map(room => {
          const grants = grantsOf(room.id);
          return (
            <div key={room.id} className="p-4 rounded-2xl border-2 border-slate-200 bg-white shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-extrabold text-slate-900">{room.name}</h4>
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900">
                  {room.roomType === 'LAB' ? 'آزمایشگاه' : room.roomType === 'GYM' ? 'سالن ورزش' : 'کلاس'}
                </span>
              </div>
              <p className="text-xs text-slate-500">{room.buildingName} — ظرفیت {faNum(room.capacity)} نفر</p>

              {grants.length === 0 ? (
                <p className="text-xs text-slate-400 font-bold">بدون سهمیهٔ ثبت‌شده</p>
              ) : (
                <div className="space-y-2">
                  {grants.map(g => {
                    const key = `${g.id}`;
                    const isReleased = g.status === 'RELEASED';
                    return (
                      <div key={g.id} className={`p-2.5 rounded-xl border text-xs space-y-2 ${isReleased ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-300'}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-slate-900">
                            شیفت {SHIFT_LABEL[g.shift] ?? g.shift} — {deptName(g.ownerDepartmentId)}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isReleased ? 'bg-amber-200 text-amber-900' : 'bg-emerald-200 text-emerald-900'}`}>
                            {isReleased ? 'آزاد/لغو شده' : 'تخصیص یافته'}
                          </span>
                        </div>
                        {isReleased ? (
                          <div className="flex items-center gap-2">
                            <select
                              defaultValue={g.ownerDepartmentId}
                              onChange={e => (g as any)._target = Number(e.target.value)}
                              className="border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold bg-white"
                            >
                              {departments.map(d => (
                                <option key={d.id} value={d.id}>{d.name} (#{d.id})</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={busyKey === key}
                              onClick={() => {
                                const sel = (g as any)._target ?? g.ownerDepartmentId;
                                run(key, () => borrowReleasedShiftAction({ termId: selectedTermId, classroomId: room.id, shift: g.shift as 'MORNING' | 'EVENING', departmentId: sel }), '✅ سهمیه واگذار شد.');
                              }}
                              className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-[11px] disabled:opacity-50"
                            >
                              {busyKey === key ? '⏳…' : '🔄 واگذاری'}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={busyKey === key}
                            onClick={() => run(key, () => releaseRoomShiftAction({ termId: selectedTermId, departmentId: g.ownerDepartmentId, classroomId: room.id, shift: g.shift as 'MORNING' | 'EVENING' }), '✅ سهمیه لغو شد (برای پر کردن جای خالی آزاد شد).')}
                            className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[11px] disabled:opacity-50"
                          >
                            {busyKey === key ? '⏳…' : '🗑️ لغو سهمیه'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
