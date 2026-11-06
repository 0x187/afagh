'use client';

// گام ۷: تقویم نیمسال و تولید خودکار جلسات
import { usePlanning } from '../PlanningProvider';
import { faNum } from '../planning-core';

export default function TermCalendarTab() {
  const {
    calendarConfig,
    generatedTermSessionsCount,
    handleGenerateSessions,
    hardConflictCount,
    isDeptScope,
    isGeneratingSessions,
    makeupSessions,
    sessionsByOffering,
    setCalendarConfig,
  } = usePlanning();

  return (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">
                    📅 تعریف بازه نیمسال و تقویم آموزشی دانشگاه (تولید خودکار جلسات)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    از روی سطرهای واقعی جدول schedules (روز هفته، ساعت، سالن) و تاریخ شروع نیمسال، تاریخ جلسات شمسی ساخته و در class_sessions ثبت می‌شود؛ پیش از تولید، گیت قیود سخت (تداخل استاد/سالن) اجرا می‌گردد.
                  </p>
                </div>

                {isDeptScope ? (
                  <span className="px-4 py-2.5 rounded-xl bg-slate-100 border border-slate-300 text-slate-600 font-bold text-xs">
                    🔒 تولید جلسات ترم برای کل دانشگاه در اختیار مدیر آموزش است
                  </span>
                ) : (
                  <button
                    onClick={handleGenerateSessions}
                    disabled={isGeneratingSessions}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 text-white font-extrabold text-xs shadow-md flex items-center gap-2 transition disabled:opacity-50 disabled:cursor-wait"
                  >
                    <span>{isGeneratingSessions ? '⏳ در حال تولید جلسات از برنامهٔ مصوب…' : `⚡ تولید و زمان‌بندی خودکار ${faNum(calendarConfig.sessionsCount)} جلسه ترم برای کلیه دروس`}</span>
                  </button>
                )}
              </div>

              {/* Calendar Settings Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">تاریخ شروع کلاس‌ها:</label>
                  <input
                    type="text"
                    value={calendarConfig.classStartDate}
                    onChange={e => setCalendarConfig({ ...calendarConfig, classStartDate: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold bg-white"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">تاریخ پایان کلاس‌ها:</label>
                  <input
                    type="text"
                    value={calendarConfig.classEndDate}
                    onChange={e => setCalendarConfig({ ...calendarConfig, classEndDate: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold bg-white"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">شروع امتحانات پایان‌ترم:</label>
                  <input
                    type="text"
                    value={calendarConfig.examStartDate}
                    onChange={e => setCalendarConfig({ ...calendarConfig, examStartDate: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold bg-white"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">پایان امتحانات پایان‌ترم:</label>
                  <input
                    type="text"
                    value={calendarConfig.examEndDate}
                    onChange={e => setCalendarConfig({ ...calendarConfig, examEndDate: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold bg-white"
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-4 pt-2 border-t border-slate-200">
                  <label className="font-bold text-slate-700 block mb-1">تعطیلات رسمی تقویم آموزشی ترم (حذف خودکار از جلسات):</label>
                  <input
                    type="text"
                    value={calendarConfig.holidays}
                    onChange={e => setCalendarConfig({ ...calendarConfig, holidays: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg p-2 text-xs font-bold bg-white"
                  />
                </div>
              </div>

              {/* Generated Sessions KPI Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-200">
                  <span className="text-indigo-700 font-bold block mb-0.5">جلسات تولیدشدهٔ این ترم:</span>
                  <span className="text-lg font-black text-indigo-950">{faNum(generatedTermSessionsCount)} جلسه</span>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                  <span className="text-emerald-700 font-bold block mb-0.5">درس‌های دارای جلسهٔ تولیدشده:</span>
                  <span className="text-lg font-black text-emerald-950">{faNum(Object.keys(sessionsByOffering).length)} درس</span>
                </div>
                <div className={`p-3 rounded-xl border ${hardConflictCount === 0 ? 'bg-purple-50 border-purple-200' : 'bg-rose-50 border-rose-300'}`}>
                  <span className={`font-bold block mb-0.5 ${hardConflictCount === 0 ? 'text-purple-700' : 'text-rose-700'}`}>گیت قیود سخت (استاد/سالن/ظرفیت):</span>
                  <span className={`text-lg font-black ${hardConflictCount === 0 ? 'text-purple-950' : 'text-rose-950'}`}>
                    {hardConflictCount === 0 ? 'پاک ✓' : `${faNum(hardConflictCount)} تداخل سخت!`}
                  </span>
                </div>
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                  <span className="text-amber-700 font-bold block mb-0.5">جلسات جبرانی ثبت‌شده:</span>
                  <span className="text-lg font-black text-amber-950">{faNum(makeupSessions.length)} جلسه</span>
                </div>
              </div>

              {/* Admin Make-up Session Approval Table */}
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-extrabold text-slate-900 text-sm">
                    🏛️ کارتابل اداره آموزش: جلسات جبرانی ثبت‌شدهٔ این نیمسال
                  </h4>
                  <span className="text-xs text-slate-500 font-bold">
                    (منبع: class_sessions با isMakeUpSession = ۱)
                  </span>
                </div>

                {makeupSessions.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs font-bold text-slate-500">
                    در این نیمسال هیچ جلسهٔ جبرانی ثبت نشده است.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {makeupSessions.map(item => (
                      <div key={item.id} className="p-3.5 rounded-xl border text-xs space-y-1.5 bg-emerald-50/40 border-emerald-200">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-slate-900">{item.courseTitle}</span>
                            <span className="text-indigo-900 font-bold">({item.profName})</span>
                            <span className="text-slate-500">· جبران جلسهٔ {faNum(item.sessionNo)}</span>
                          </div>
                          <span className="px-2.5 py-0.5 rounded-full text-3xs font-black self-start sm:self-auto bg-indigo-100 text-indigo-900">
                            {item.replacedSessionId ? 'جایگزین جلسهٔ معلق' : 'ثبت‌شده'}
                          </span>
                        </div>
                        <div className="text-slate-600 flex flex-wrap items-center justify-between gap-2">
                          <span>تاریخ: <strong>{faNum(item.sessionDate)}</strong> ساعت <strong>{faNum(item.sessionTime)}</strong></span>
                          <span className="font-mono text-3xs text-slate-400">کد درس: {item.courseCode}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
  );
}
