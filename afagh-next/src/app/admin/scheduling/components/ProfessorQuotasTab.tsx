'use client';

// گام ۲: سقف واحدها و فرم درٔ دسترس بودن اساتید
import { usePlanning } from '../PlanningProvider';
import Link from 'next/link';
import { faNum } from '../planning-core';

export default function ProfessorQuotasTab() {
  const {
    handleOpenEditProfAvailability,
    handleUpdateProfMaxUnits,
    profAssignedUnitsMap,
    professors,
    setActiveMainTab,
    setInspectorProfId,
  } = usePlanning();

  return (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">👨‍🏫</span>
                  <h3 className="font-extrabold text-slate-900 text-base">
                    مدیریت سقف واحدها و ویرایش مستقیم ساعات حضور اساتید توسط مدیر گروه
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  فرم درٔ دسترس بودن فقط توسط خودِ استاد از پنل او ثبت می‌شود؛ این‌جا فقط «وضعیت اعلام» و جزئیات واقعی آن نمایش داده می‌شود.
                </p>
              </div>

              <Link prefetch={false}
                href="/professor/availability"
                className="px-4 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-extrabold text-xs shadow transition flex items-center gap-1.5"
              >
                <span>👁️ پرتال استاد</span>
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {professors.map(prof => {
                const assignedUnits = profAssignedUnitsMap[prof.id]?.units || 0;
                const isOver = assignedUnits > prof.maxWeeklyUnits;

                return (
                  <div key={prof.id} className="bg-white rounded-2xl p-4 border-2 border-slate-200 shadow-sm flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-2xs font-extrabold px-2 py-0.5 rounded bg-indigo-100 text-indigo-900">
                          {prof.academicRank} — {prof.contractType}
                        </span>
                        <span className={`text-3xs font-bold px-2 py-0.5 rounded-full ${
                          prof.hasSubmittedAvailability ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {prof.hasSubmittedAvailability ? '✅ فرم حضور ثبت‌شده' : '⏳ در انتظار تکمیل'}
                        </span>
                      </div>

                      <h4 className="text-base font-extrabold text-slate-900">{prof.name}</h4>
                      <p className="text-xs text-slate-500 font-mono mb-2">کد پرسنلی: {prof.staffCode}</p>

                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-2 mb-2">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 font-bold">سقف مجاز واحد در هفته:</span>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={prof.maxWeeklyUnits}
                              onChange={e => handleUpdateProfMaxUnits(prof.id, Number(e.target.value))}
                              className="w-16 border border-slate-300 rounded px-2 py-0.5 font-mono text-center font-extrabold text-indigo-900 bg-white"
                            />
                            <span className="text-slate-500">واحد</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                          <span className="text-slate-600 font-bold">واحدهای اختصاص‌یافته فعلی:</span>
                          <span className={`font-extrabold ${isOver ? 'text-rose-700' : 'text-emerald-800'}`}>
                            {faNum(assignedUnits)} واحد
                          </span>
                        </div>
                      </div>


                    </div>

                    {/* Edit Professor Availability Button */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleOpenEditProfAvailability(prof.id)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-900 hover:bg-indigo-950 text-white font-extrabold text-xs shadow flex items-center gap-1 transition"
                      >
                        <span>📖 مشاهدهٔ فرم اعلامی استاد</span>
                      </button>

                      <button
                        onClick={() => {
                          setInspectorProfId(prof.id);
                          setActiveMainTab('PROFESSOR_SCHEDULE');
                        }}
                        className="text-xs text-slate-500 hover:text-indigo-900 font-bold"
                      >
                        برنامه ⬅️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
  );
}
