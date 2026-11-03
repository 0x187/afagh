'use client';

// گام ۶: برنامهٔ مصوب (منبع: schedules)
import { usePlanning } from '../PlanningProvider';
import { faNum } from '../planning-core';

export default function ApprovedTab() {
  const { approvedOfferings } = usePlanning();

  return (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3 className="font-extrabold text-slate-900 text-base">
                  📋 برنامه مصوب و نهایی نیمسال جاری ({faNum(approvedOfferings.length)} کلاس فعال)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  منبع: جدول برنامهٔ مصوب (schedules) — روز، ساعت و سالن واقعی هر کلاس
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs rt">
                <thead>
                  <tr className="bg-slate-900 text-white text-center">
                    <th className="p-3 border border-slate-800 w-12">ردیف</th>
                    <th className="p-3 border border-slate-800">کد درس</th>
                    <th className="p-3 border border-slate-800">عنوان درس</th>
                    <th className="p-3 border border-slate-800">گروه</th>
                    <th className="p-3 border border-slate-800">تواتر هفته</th>
                    <th className="p-3 border border-slate-800">استاد مدرس</th>
                    <th className="p-3 border border-slate-800">زمان‌بندی</th>
                    <th className="p-3 border border-slate-800">محل کلاس</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedOfferings.map((item, idx) => (
                    <tr key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="p-2 border border-slate-200 text-center font-bold text-slate-500">{faNum(idx + 1)}</td>
                      <td className="p-2 border border-slate-200 font-mono text-center font-bold text-indigo-900">{item.code}</td>
                      <td className="p-2 border border-slate-200 font-extrabold text-slate-900">
                        <div>{item.title}</div>
                        {item.isCoTaught && (
                          <div className="text-3xs text-purple-700 font-bold mt-0.5">
                            👥 مشترک: تئوری ({faNum((item.theoryWeightRatio || 0.7) * 100)}٪) + عملی ({faNum((item.labWeightRatio || 0.3) * 100)}٪)
                          </div>
                        )}
                      </td>
                      <td className="p-2 border border-slate-200 text-center font-bold bg-indigo-50/50">گروه {faNum(item.groupNumber)}</td>
                      <td className="p-2 border border-slate-200 text-center">
                        {item.classSchedules[0]?.weekType === 'EVEN' ? (
                          <span className="px-2 py-0.5 rounded bg-cyan-100 text-cyan-900 font-bold text-3xs">هفته زوج 🔷</span>
                        ) : item.classSchedules[0]?.weekType === 'ODD' ? (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-3xs">هفته فرد 🔶</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 font-bold text-3xs">هر هفته</span>
                        )}
                      </td>
                      <td className="p-2 border border-slate-200 font-bold text-slate-800">
                        <div>{item.professorName}</div>
                        {item.isCoTaught && item.coProfName && (
                          <div className="text-3xs text-purple-800">همکار عملی: {item.coProfName}</div>
                        )}
                      </td>
                      <td className="p-2 border border-slate-200 text-slate-800 font-bold">
                        {item.classSchedules[0]?.dayName} {faNum(item.classSchedules[0]?.startTime)} تا {faNum(item.classSchedules[0]?.endTime)}
                      </td>
                      <td className="p-2 border border-slate-200 font-extrabold text-emerald-900">
                        🏛️ {item.classSchedules[0]?.roomName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
  );
}
