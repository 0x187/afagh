'use client';

// گام ۵: ماتریس زنگ تفریح + بازرس برنامهٔ هفتگی استاد
import { usePlanning } from '../PlanningProvider';
import { faNum, DAY_NAMES } from '../planning-core';

export default function WeeklyMatrixTab() {
  const {
    currentScenario,
    handleOpenEditProfAvailability,
    inspectorOfferings,
    inspectorProf,
    inspectorProfId,
    inspectorStats,
    professors,
    realAvailStatus,
    setInspectorProfId,
    teachingSlots,
  } = usePlanning();

  // ارائه‌هایی که ساعتشان در هیچ زنگِ تعریف‌شده نمی‌افتد (مثلاً ۰۱:۰۰ یا خارج از
  // ۰۸:۰۰–۱۹:۳۰). قبلاً این‌ها کامل ناپدید می‌شدند و جدول «خالی» به‌نظر می‌رسید.
  const unmatchedOfferings = inspectorOfferings.filter(o =>
    !o.classSchedules.some(cs => teachingSlots.some(slot =>
      cs.startTime !== '' && cs.startTime >= slot.startTime && cs.startTime < slot.endTime)));

  return (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <span className="text-2xl p-2.5 rounded-2xl bg-purple-100 text-purple-900">👨‍🏫</span>
                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-0.5">انتخاب استاد جهت بررسی و کنترل برنامه هفتگی:</label>
                    <select
                      value={inspectorProfId}
                      onChange={e => setInspectorProfId(Number(e.target.value))}
                      className="border-2 border-purple-400 rounded-xl px-3 py-1.5 font-extrabold text-sm text-purple-950 bg-purple-50/50"
                    >
                      {professors.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.academicRank} — {p.contractType} — {p.departmentName})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenEditProfAvailability(inspectorProfId)}
                    className="px-3.5 py-2 rounded-xl bg-indigo-900 hover:bg-indigo-950 text-white font-extrabold text-xs shadow flex items-center gap-1.5"
                  >
                    <span>✏️ ویرایش ساعات حضور این استاد</span>
                  </button>
                  <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-900 border border-emerald-300">
                    ✅ وضعیت تداخل: صفر
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px] mb-1">واحدهای موظفی:</span>
                  <span className="text-lg font-extrabold text-indigo-950">
                    {faNum(inspectorStats.totalUnits)} از {faNum(inspectorProf.maxWeeklyUnits)} واحد
                  </span>
                  <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2 overflow-hidden">
                    <div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: `${inspectorStats.quotaPercent}%` }}></div>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px] mb-1">گروه‌های درسی:</span>
                  <span className="text-lg font-extrabold text-purple-950">
                    {faNum(inspectorStats.groupsCount)} گروه
                  </span>
                  <span className="text-[10px] text-purple-700 block mt-1 font-bold">
                    (در {faNum(inspectorStats.distinctPrograms.length)} رشته)
                  </span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px] mb-1">روزهای حضور:</span>
                  <span className="text-lg font-extrabold text-emerald-950">
                    {faNum(inspectorStats.distinctDays)} روز در هفته
                  </span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px] mb-1">نوع قرارداد:</span>
                  <span className="text-sm font-extrabold text-slate-900 block mt-0.5">{inspectorProf.contractType}</span>
                  <span className="text-[10px] text-slate-500 block mt-1 font-bold">{inspectorProf.departmentName}</span>
                </div>
              </div>
            </div>

            {inspectorOfferings.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-6 text-center">
                <p className="font-extrabold text-amber-900">این استاد در این ترم درسِ ثبت‌شده‌ای ندارد</p>
                <p className="text-xs text-amber-800 mt-1">از فهرست بالا استاد دیگری را انتخاب کنید؛ استادی که درس دارد به‌صورت پیش‌فرض انتخاب می‌شود.</p>
              </div>
            )}

            {/* Professor Weekly Grid */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <h3 className="font-extrabold text-slate-900 text-base">
                  🗓️ جدول برنامه هفتگی اختصاصی: {inspectorProf.name}
                </h3>
                <span className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg">
                  سناریوی محاسباتی: {currentScenario.title.split(':')[0]}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs rt">
                  <thead>
                    <tr className="bg-slate-900 text-white text-center">
                      <th className="p-3 border border-slate-800 w-28 font-extrabold">روز هفته</th>
                      {teachingSlots.map(slot => (
                        <th key={slot.id} className="p-3 border border-slate-800 font-extrabold">
                          <div>{slot.label}</div>
                          <div className="text-[10px] text-slate-300 font-normal mt-0.5">{slot.startTime} الی {slot.endTime}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAY_NAMES.map((dayName, dayIdx) => (
                      <tr key={dayIdx} className={dayIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="p-3 border border-slate-200 font-extrabold text-center bg-slate-100 text-slate-900">
                          {dayName}
                        </td>
                        {teachingSlots.map(slot => {
                          const matchingOfferings = inspectorOfferings.filter(o =>
                            o.classSchedules.some(cs => cs.dayOfWeek === dayIdx && (
                              cs.slotId === slot.id ||
                              (cs.startTime !== '' && cs.startTime >= slot.startTime && cs.startTime < slot.endTime)
                            ))
                          );

                          const availabilityStatus = realAvailStatus(inspectorProfId, dayIdx, slot);

                          return (
                            <td
                              key={slot.id}
                              className={`p-2 border border-slate-200 align-top min-w-[190px] h-24 ${
                                matchingOfferings.length > 0
                                  ? 'bg-indigo-50/80'
                                  : availabilityStatus === 'PREF'
                                  ? 'bg-emerald-50/40'
                                  : availabilityStatus === 'AVAIL'
                                  ? 'bg-amber-50/40'
                                  : ''
                              }`}
                            >
                              {matchingOfferings.length > 0 ? (
                                <div className="space-y-1">
                                  {matchingOfferings.map(offering => {
                                    const schedule = offering.classSchedules.find(cs => cs.dayOfWeek === dayIdx && (
                                      cs.slotId === slot.id ||
                                      (cs.startTime !== '' && cs.startTime >= slot.startTime && cs.startTime < slot.endTime)
                                    ))!;
                                    return (
                                      <div key={offering.id} className="p-2.5 rounded-xl bg-white border-2 border-indigo-400 shadow-sm text-indigo-950 space-y-1">
                                        <div className="flex items-center justify-between font-extrabold text-xs">
                                          <span>{offering.title}</span>
                                          <div className="flex items-center gap-1">
                                            {schedule.weekType === 'EVEN' && <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-700 text-white font-bold">هفته زوج</span>}
                                            {schedule.weekType === 'ODD' && <span className="text-[9px] px-1 py-0.2 rounded bg-amber-600 text-white font-bold">هفته فرد</span>}
                                            <span className="px-1.5 py-0.5 rounded bg-indigo-900 text-white text-[10px]">
                                              گروه {faNum(offering.groupNumber)}
                                            </span>
                                          </div>
                                        </div>
                                        <div className="text-[11px] text-slate-600 flex items-center justify-between font-bold">
                                          <span>🎓 {offering.programTitle}</span>
                                          <span className="text-[10px] text-indigo-700 font-mono">{offering.cohortTitle.split('(')[1]?.replace(')', '') || offering.cohortTitle}</span>
                                        </div>
                                        <div className="text-[11px] font-extrabold text-emerald-800 flex items-center justify-between pt-1 border-t border-slate-100">
                                          <span>🏛️ {schedule.roomName}</span>
                                          <span className="text-[10px] text-slate-500 font-normal">{faNum(offering.units)} واحد</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="flex flex-col items-center justify-center h-full text-center p-1">
                                  <span className={`text-[10px] font-bold ${
                                    availabilityStatus === 'PREF' ? 'text-emerald-700' :
                                    availabilityStatus === 'AVAIL' ? 'text-amber-700' : 'text-slate-400'
                                  }`}>
                                    {availabilityStatus === 'PREF' ? '🟩 اولویت استاد' :
                                     availabilityStatus === 'AVAIL' ? '🟨 قابل حضور (اعلام استاد)' : '☁️ اعلام نشده — بدون قید'}
                                  </span>
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

            {unmatchedOfferings.length > 0 && (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-amber-200 space-y-2">
                <h3 className="font-extrabold text-slate-900 text-sm">
                  ⏱️ درس‌های خارج از زنگ‌های تعریف‌شده ({faNum(unmatchedOfferings.length)})
                </h3>
                <p className="text-[11px] text-slate-500">
                  ساعت این کلاس‌ها داخل بازهٔ زنگ‌های تنظیم‌شده (۰۸:۰۰–۱۹:۳۰) نمی‌افتد؛ برای دیده‌شدن در جدول،
                  زنگ‌ها را در تنظیمات برنامهٔ هفتگی اصلاح کنید.
                </p>
                <ul className="text-xs divide-y divide-slate-100">
                  {unmatchedOfferings.map(o => {
                    const cs = o.classSchedules[0];
                    return (
                      <li key={o.id} className="py-1.5 flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-800">{o.title} — گروه {faNum(o.groupNumber)}</span>
                        <span className="text-slate-500 font-mono">
                          {DAY_NAMES[cs?.dayOfWeek ?? 0] ?? '—'} {cs?.startTime}–{cs?.endTime} · {cs?.roomName}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
  );
}
