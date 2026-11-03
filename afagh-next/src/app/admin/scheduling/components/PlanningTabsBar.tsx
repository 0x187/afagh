'use client';

// نوار ۷ گام عملیاتی
import { usePlanning } from '../PlanningProvider';
import { faNum, SHIFT_MODELS } from '../planning-core';

export default function PlanningTabsBar() {
  const {
    activeMainTab,
    approvedOfferings,
    classrooms,
    displayedDemands,
    generatedTermSessionsCount,
    programMatrix,
    setActiveMainTab,
  } = usePlanning();

  return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-2 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveMainTab('PROGRAM_SCOPE')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition ${
              activeMainTab === 'PROGRAM_SCOPE' ? 'bg-indigo-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>🎯 فاز ۰: انتخاب رشته و ترم</span>
            <span className="px-1.5 py-0.5 rounded-full text-3xs bg-indigo-100 text-indigo-800 font-bold">
              {faNum(programMatrix.length)} رشته
            </span>
          </button>

          <button
            onClick={() => setActiveMainTab('CURRICULUM_ASSIGN')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition ${
              activeMainTab === 'CURRICULUM_ASSIGN' ? 'bg-indigo-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>📚 گام ۱: چارت دروس و انتساب اساتید</span>
            <span className="px-1.5 py-0.5 rounded-full text-3xs bg-amber-400 text-slate-950 font-bold">
              {faNum(displayedDemands.length)} درس
            </span>
          </button>

          <button
            onClick={() => setActiveMainTab('PROF_QUOTAS')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition ${
              activeMainTab === 'PROF_QUOTAS' ? 'bg-indigo-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>👨‍🏫 گام ۲: سقف واحدها و ویرایش حضور اساتید</span>
            <span className="px-1.5 py-0.5 rounded-full text-3xs bg-purple-100 text-purple-900 font-bold">
              ویرایش ساعات
            </span>
          </button>

          <button
            onClick={() => setActiveMainTab('DEPT_ROOMS')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition ${
              activeMainTab === 'DEPT_ROOMS' ? 'bg-indigo-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>🏛️ گام ۳: کلاس‌های اختصاص‌یافته به گروه</span>
            <span className="px-1.5 py-0.5 rounded-full text-3xs bg-emerald-100 text-emerald-800 font-bold">
              {faNum(classrooms.filter(c => c.isAllocatedToDept).length)} کلاس
            </span>
          </button>

          <button
            onClick={() => setActiveMainTab('SCENARIOS')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition ${
              activeMainTab === 'SCENARIOS' ? 'bg-indigo-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>🤖 گام ۴: موتور هوشمند چیدمان متمرکز ({faNum(SHIFT_MODELS.length)} مدل)</span>
            <span className="px-1.5 py-0.5 rounded-full text-3xs bg-amber-400 text-slate-950 font-bold">
              {faNum(SHIFT_MODELS.length)} سناریو
            </span>
          </button>

          <button
            onClick={() => setActiveMainTab('PROFESSOR_SCHEDULE')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition ${
              activeMainTab === 'PROFESSOR_SCHEDULE' ? 'bg-indigo-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>🗓️ گام ۵: کنترل برنامه هفتگی اختصاصی استاد</span>
          </button>

          <button
            onClick={() => setActiveMainTab('APPROVED')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition ${
              activeMainTab === 'APPROVED' ? 'bg-indigo-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>📋 گام ۶: برنامه مصوب و ثبت نهایی</span>
            <span className="px-1.5 py-0.5 rounded-full text-3xs bg-emerald-100 text-emerald-800 font-bold">
              {faNum(approvedOfferings.length)} کلاس
            </span>
          </button>

          <button
            onClick={() => setActiveMainTab('TERM_CALENDAR')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition ${
              activeMainTab === 'TERM_CALENDAR' ? 'bg-indigo-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>📅 تقویم ترم و تولید خودکار جلسات آموزشی</span>
            <span className="px-1.5 py-0.5 rounded-full text-3xs bg-cyan-100 text-cyan-900 font-bold">
              {faNum(generatedTermSessionsCount)} جلسه
            </span>
          </button>
        </div>
  );
}
