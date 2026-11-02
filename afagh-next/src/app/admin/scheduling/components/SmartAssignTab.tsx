'use client';

// گام ۴: گذار فاز، تأمین گروه و پیشنهاد هوشمند موتور
import { useState } from 'react';
import { usePlanning } from '../PlanningProvider';
import { faNum, DAY_NAMES, PHASE_LABELS } from '../planning-core';
import { allocateRoomQuotasAction } from '../actions';

export default function SmartAssignTab() {
  const [allocatingRooms, setAllocatingRooms] = useState(false);
  const [roomMsg, setRoomMsg] = useState<string | null>(null);
  const {
    initial,
    courseDemands,
    currentPhase,
    currentRealScenario,
    currentScenario,
    displayedDemands,
    displayedScenarioOfferings,
    generatedTermSessionsCount,
    handlePhaseTransition,
    handleRunHealth,
    handleSuggestForDemand,
    handleSupplyFromSuggestion,
    hardConflictCount,
    health,
    healthLoading,
    isDeptScope,
    ownedDeptId,
    phaseBusy,
    reloadWorkspace,
    selectedTermId,
    setActiveMainTab,
    setOwnedDeptId,
    suggestLoading,
    suggestedDemandId,
    suggestions,
    supplying,
    teachingSlots,
  } = usePlanning();

  return (
          <div className="space-y-5">
            <div className="bg-gradient-to-r from-indigo-900 via-indigo-950 to-slate-950 text-white rounded-2xl p-4 sm:p-5 space-y-3 border border-indigo-700/50">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="font-extrabold text-sm sm:text-base">
                    🧠 پیشنهاد هوشمند موتور زمان‌بندی (واقعی — روی سرور)
                  </h2>
                  <p className="text-xs text-indigo-200 leading-relaxed">
                    اسلات‌های پیشنهادی از روی <b>درٔ دسترس بودنِ اعلام‌شدهٔ استاد</b> (پنل استاد)، <b>اشغال واقعی سالن‌ها</b>،
                    <b>زونینگ دانشکده</b> و <b>تناسب ظرفیت</b> محاسبه می‌شوند. ثبت هر پیشنهاد = درج واقعی
                    offering + schedule + استاد در پایگاه داده (تراکنشی + قفل + audit).
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSuggestForDemand(suggestedDemandId ?? displayedDemands[0]?.id ?? 0)}
                    disabled={suggestLoading || !displayedDemands.length}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-extrabold transition shadow flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <span>{suggestLoading ? '⏳ در حال محاسبه…' : '⚡ دریافت پیشنهاد موتور'}</span>
                  </button>
                  <button
                    onClick={handleRunHealth}
                    disabled={healthLoading || !selectedTermId}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-extrabold transition border border-white/20 disabled:opacity-50"
                  >
                    <span>{healthLoading ? '⏳ …' : '🩺 عارضه‌یابی برنامه (Health)'}</span>
                  </button>
                </div>
              </div>

              {/* ماشین فازها — گذار واقعی (گیت انتشار در سرور) */}
              <div className="bg-white/10 rounded-xl p-3 border border-white/15 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-indigo-200">ماشین فاز برنامه‌ریزی:</span>
                  {(['SUPPLY', 'ALLOCATION', 'REVIEW', 'PUBLISHED'] as const).map(ph => (
                    <span key={ph}
                      className={`px-2.5 py-1 rounded-full font-extrabold text-[11px] border ${
                        currentPhase === ph
                          ? 'bg-amber-400 text-slate-950 border-amber-300'
                          : 'bg-white/10 text-indigo-100 border-white/20'
                      }`}
                    >
                      {PHASE_LABELS[ph] ?? ph}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-indigo-200 font-bold">
                    تداخل سخت فعلی: {faNum(hardConflictCount)} — انتشار فقط بدون قید سخت
                  </span>
                  {isDeptScope ? (
                    <span className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-[11px] font-bold text-indigo-100">
                      🔒 گذار فاز در اختیار مدیر آموزش است
                    </span>
                  ) : (
                    <>
                      {currentPhase === 'SUPPLY' && (
                        <button onClick={() => handlePhaseTransition('ALLOCATION')} disabled={phaseBusy}
                          className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-extrabold disabled:opacity-50">
                          {phaseBusy ? '…' : 'تأیید تأمین ← تخصیص'}
                        </button>
                      )}
                      {currentPhase === 'ALLOCATION' && (
                        <button onClick={() => handlePhaseTransition('REVIEW')} disabled={phaseBusy}
                          className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-extrabold disabled:opacity-50">
                          {phaseBusy ? '…' : 'تأیید تخصیص ← بازبینی کارشناس'}
                        </button>
                      )}
                      {currentPhase === 'REVIEW' && (
                        <button onClick={() => handlePhaseTransition('PUBLISHED')} disabled={phaseBusy}
                          className="px-3.5 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-extrabold disabled:opacity-50"
                          title={hardConflictCount > 0 ? 'ابتدا تداخل‌های سخت را رفع کنید' : ''}
                        >
                          {phaseBusy ? '…' : '🚀 انتشار برنامهٔ نهایی'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* گزارش سلامت (در صورت اجرا) */}
              {health && (
                <div className="bg-emerald-50/10 border border-emerald-300/30 rounded-xl p-3 text-[11px] text-emerald-100 space-y-1">
                  <b>گزارش سلامت ترم (واقعی):</b>
                  <div>• تداخل‌های پنهان استاد/سالن: {faNum(health.hiddenConflicts.length)}</div>
                  <div>• عرضه در برابر تقاضا (گروه‌های کم‌عرضه): {faNum((health.supplyVsDemand ?? []).filter(x => (x.gap ?? 0) > 0).length)}</div>
                  <div>• کلاس‌های مشترک بدون تخصیص: {faNum(health.unallocatedShared.length)}</div>
                  <div>• سالن‌های با بهره‌وری کمتر از ۵۰٪: {faNum((health.roomShiftUsage ?? []).filter(x => x.utilization < 0.5).length)}</div>
                  <div className={health.examConflicts?.hard?.length ? 'text-rose-200 font-black' : ''}>
                    • تداخل قطعی امتحانی: {faNum(health.examConflicts?.hard?.length ?? 0)}
                    {(health.examConflicts?.soft?.length ?? 0) > 0 && ` · همان‌روز (نرم): ${faNum(health.examConflicts.soft.length)}`}
                  </div>
                  <div className={(health.fragmentedProfessorDays?.length ?? 0) > 0 ? 'text-amber-200 font-black' : ''}>
                    • روزهای استاد با ساعت خالی: {faNum(health.fragmentedProfessorDays?.length ?? 0)}
                    {(health.fragmentedProfessorDays?.length ?? 0) > 0 && ` (بیشترین ${faNum(health.fragmentedProfessorDays[0].gaps)} ساعت)`}
                  </div>
                  {(health.examConflicts?.hard?.length ?? 0) > 0 && (
                    <div className="mt-1 space-y-0.5 border-t border-rose-300/30 pt-1">
                      {health.examConflicts.hard.slice(0, 3).map((c, i) => (
                        <div key={`${c.a}-${c.b}-${i}`} className="text-[10px] text-rose-100">— {c.message}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* انتخاب درس برای پیشنهاد */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <div className="flex-1">
                  <label className="text-xs font-extrabold text-slate-700 block mb-1.5">درس متقاضی (از ارائه‌های واقعی ترم):</label>
                  <select
                    value={suggestedDemandId ?? ''}
                    onChange={e => handleSuggestForDemand(Number(e.target.value))}
                    className="w-full border-2 border-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold bg-white focus:border-indigo-600"
                  >
                    <option value="" disabled>— انتخاب درس —</option>
                    {displayedDemands.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.code} — {d.title} (گروه {faNum(d.groupNumber)} — ظرفیت {faNum(d.capacity)}) {d.preferredProfId ? '' : '⚠ بدون استاد'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-full sm:w-72">
                  <label className="text-xs font-extrabold text-slate-700 block mb-1.5">گروه سازنده (ownerDepartmentId — پیش‌فرض: گروه درس):</label>
                  <select
                    value={ownedDeptId}
                    onChange={e => setOwnedDeptId(Number(e.target.value))}
                    className="w-full border-2 border-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold bg-white focus:border-indigo-600"
                  >
                    {initial.departments.map(dep => (
                      <option key={dep.id} value={dep.id}>{dep.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* پیشنهادهای موتور */}
              {suggestLoading ? (
                <div className="text-center py-8 text-xs font-bold text-slate-500">⏳ موتور در حال محاسبهٔ اسلات‌های ممکن است…</div>
              ) : suggestions.length === 0 ? (
                <div className="text-center py-8 text-xs font-bold text-slate-500 space-y-1">
                  <div>📭 هنوز پیشنهادی محاسبه نشده است.</div>
                  <div className="text-[10px] text-slate-400">یک درس انتخاب کنید؛ اگر استاد درٔ دسترس بودن اعلام نکرده باشد، موتور صادقانه هیچ پیشنهادی برمی‌گرداند.</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {suggestions.map((slot, idx) => {
                    const d = courseDemands.find(x => x.id === suggestedDemandId);
                    return (
                      <div key={idx} className="border-2 border-indigo-100 rounded-2xl p-3.5 bg-gradient-to-br from-indigo-50/60 to-white space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold text-indigo-900">
                            {DAY_NAMES[slot.dayOfWeek] ?? '—'} — {slot.startTime} تا {slot.endTime}
                          </span>
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                            امتیاز {faNum(slot.score)}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 font-bold">
                          🏫 {slot.classroomName} (ظرفیت {faNum(slot.classroomCapacity)})
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {slot.reasons.map((r, i) => (
                            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold">{r}</span>
                          ))}
                        </div>
                        <button
                          onClick={() => d && handleSupplyFromSuggestion(d, slot)}
                          disabled={supplying || !d?.preferredProfId}
                          className="w-full py-2 rounded-xl bg-indigo-900 hover:bg-indigo-950 text-white font-extrabold text-xs shadow disabled:opacity-40"
                        >
                          {supplying ? '⏳ در حال ثبت در سرور…' : '📦 عرضهٔ گروه از این پیشنهاد (درج واقعی در DB)'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* وضعیت واقعی برنامه — KPI محاسبه‌شده از DB */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="rounded-2xl p-4 border-2 border-slate-200 bg-white shadow-sm">
                <div className="text-[10px] text-slate-400 font-bold">کلاس‌های مصوب</div>
                <div className="text-xl font-extrabold text-slate-900">{faNum(currentRealScenario.offerings.length)}</div>
              </div>
              <div className="rounded-2xl p-4 border-2 border-slate-200 bg-white shadow-sm">
                <div className="text-[10px] text-slate-400 font-bold">جلسات تولیدشده</div>
                <div className="text-xl font-extrabold text-slate-900">{faNum(generatedTermSessionsCount)}</div>
              </div>
              <div className="rounded-2xl p-4 border-2 border-slate-200 bg-white shadow-sm">
                <div className="text-[10px] text-slate-400 font-bold">تداخل سخت فعلی</div>
                <div className={`text-xl font-extrabold ${hardConflictCount > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{faNum(hardConflictCount)}</div>
              </div>
              <div className="rounded-2xl p-4 border-2 border-slate-200 bg-white shadow-sm">
                <div className="text-[10px] text-slate-400 font-bold">سالن‌های دارای سهمیه</div>
                <div className="text-xl font-extrabold text-slate-900">{faNum(initial.allocatedRoomIds.length)} / {faNum(initial.classrooms.length)}</div>
                <button
                  type="button"
                  onClick={() => setActiveMainTab('DEPT_ROOMS')}
                  className="mt-1 px-3 py-1 rounded-lg bg-indigo-900 hover:bg-indigo-950 text-white font-extrabold text-[10px] shadow"
                >
                  🏛️ مدیریت سهمیهٔ سالن‌ها
                </button>
              </div>
            </div>

            {/* جدول هفتگی برنامهٔ مصوب */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">
                    جدول هفتگی: {currentScenario.title}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">{currentScenario.description}</p>
                </div>
                <button
                  onClick={() => setActiveMainTab('APPROVED')}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs shadow-md flex items-center gap-1.5 transition"
                >
                  <span>📋 رفتن به گام ۶ (برنامهٔ مصوب و ثبت نهایی)</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs rt">
                  <thead>
                    <tr className="bg-slate-900 text-white text-center">
                      <th className="p-3 border border-slate-800 w-28 font-extrabold">روز هفته</th>
                      {teachingSlots.map(slot => (
                        <th key={slot.id} className="p-3 border border-slate-800 font-extrabold">
                          <div>{slot.label}</div>
                          <div className="text-[10px] text-slate-300 font-normal mt-0.5">{slot.startTime} تا {slot.endTime}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAY_NAMES.map((dayName, dayIdx) => (
                      <tr key={dayIdx} className={dayIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}>
                        <td className="p-3 border border-slate-200 font-extrabold text-center bg-slate-100 text-slate-900">
                          {dayName}
                        </td>
                        {teachingSlots.map(slot => {
                          const matchingOfferings = displayedScenarioOfferings.filter(o =>
                            o.classSchedules.some(cs =>
                              cs.dayOfWeek === dayIdx &&
                              cs.startTime !== '' &&
                              cs.startTime >= slot.startTime &&
                              cs.startTime < slot.endTime
                            )
                          );
                          return (
                            <td
                              key={slot.id}
                              className={`p-2 border border-slate-200 align-top min-w-[200px] h-24 ${
                                matchingOfferings.length === 0 ? 'bg-slate-50/30' : ''
                              }`}
                            >
                              {matchingOfferings.length === 0 ? (
                                <span className="text-[10px] text-slate-300 flex items-center justify-center h-full">
                                  — خالی —
                                </span>
                              ) : (
                                <div className="space-y-1.5">
                                  {matchingOfferings.map(offering => {
                                    const schedule = offering.classSchedules.find(cs =>
                                      cs.dayOfWeek === dayIdx && cs.startTime >= slot.startTime && cs.startTime < slot.endTime
                                    )!;
                                    return (
                                      <div
                                        key={offering.id}
                                        className="rounded-lg bg-indigo-50 border border-indigo-200 p-2 text-[10px] space-y-0.5"
                                      >
                                        <div className="font-extrabold text-indigo-900">{offering.code} — {offering.title}</div>
                                        <div className="text-slate-600 font-bold">
                                          گروه {faNum(offering.groupNumber)} · {offering.professorName} · {schedule.roomName}
                                        </div>
                                        <div className="text-slate-400 font-mono">{schedule.startTime} تا {schedule.endTime}</div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
  );
}
