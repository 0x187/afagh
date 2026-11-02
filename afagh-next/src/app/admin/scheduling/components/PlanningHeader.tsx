'use client';

// بنر سراسری + نوار زمینه: نیمسال/رشته/ورودی/شیفت/نمای هفته
import { useMemo } from 'react';
import { usePlanning } from '../PlanningProvider';
import Link from 'next/link';
import { faNum, PHASE_LABELS, SHIFT_MODELS } from '../planning-core';
import type { ProgramShiftType } from '../types';

export default function PlanningHeader() {
  const {
    cohortOrdinal,
    cohorts,
    currentPhase,
    effectiveSemester,
    currentTerm,
    isLoadingWorkspace,
    isDeptScope,
    programs,
    reloadWorkspace,
    selectedCohortId,
    selectedProgramId,
    selectedTermId,
    selectedWeekFilter,
    setSelectedCohortId,
    setSelectedProgramId,
    setSelectedTermId,
    setSelectedWeekFilter,
    setTargetShiftPreference,
    targetShiftPreference,
    terms,
  } = usePlanning();

  // کوهورت‌ها (ورودی‌ها) بر اساس رشتهٔ انتخاب‌شده فیلتر و جمع می‌شوند —
  // تا «جمع تعداد دانشجو» با فیلتر رشته و نیمسال ورود هم‌خوان شود.
  const visibleCohorts = useMemo(() => {
    const filtered = selectedProgramId > 0
      ? cohorts.filter(c => c.majorId == null || c.majorId === selectedProgramId)
      : cohorts;
    const map = new Map<string, typeof cohorts[number]>();
    for (const c of filtered) {
      const prev = map.get(c.id);
      if (prev) {
        prev.expectedStudents += c.expectedStudents;
      } else {
        map.set(c.id, { ...c });
      }
    }
    return [...map.values()];
  }, [cohorts, selectedProgramId]);

  return (
        <div className="bg-gradient-to-l from-indigo-950 via-indigo-900 to-slate-900 text-white rounded-2xl p-5 shadow-lg border border-indigo-700/50 space-y-4">
      
          {/* Title Bar */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-400 text-slate-950">
                  {isDeptScope ? 'کارتابل برنامه‌ریزی دپارتمان' : 'سامانه جامع چیدمان متمرکز دانشگاهی'}
                </span>
                <span className="text-xs text-indigo-200">{currentTerm?.title ?? 'نیمسال تعریف‌نشده'}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-700/60 text-indigo-100 font-bold mr-2">
                  فاز: {PHASE_LABELS[currentPhase] ?? currentPhase}{isLoadingWorkspace ? ' — در حال بارگذاری…' : ''}
                </span>
              </div>
              <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight">
                🗓️ {isDeptScope ? 'برنامه‌ریزی درسی هوشمند دپارتمان' : 'کارتابل یکپارچه برنامه‌ریزی درسی و چیدمان متمرکز مدیر گروه'}
              </h1>
              {isDeptScope && (
                <p className="mt-1 text-[11px] sm:text-xs text-indigo-200 font-bold">
                  داده‌ها فقط دپارتمان‌های تحت مدیریت شما را نشان می‌دهد — گذار فاز و تولید جلسات ترم در اختیار مدیر آموزش است.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={reloadWorkspace}
                disabled={isLoadingWorkspace}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-extrabold text-xs sm:text-sm shadow-md transition transform active:scale-95 disabled:opacity-50"
              >
                <span>{isLoadingWorkspace ? '⏳ در حال بازخوانی…' : '📥 بازخوانی کارتابل از سرور'}</span>
              </button>
              <Link
                href={isDeptScope ? '/group-manager' : '/admin/exams'}
                className="px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-700 to-indigo-800 hover:from-indigo-800 hover:to-indigo-900 text-white font-extrabold text-xs border border-indigo-500/50 flex items-center gap-1.5 shadow-md transition"
              >
                <span>{isDeptScope ? '← بازگشت به کارتابل مدیر گروه' : '📝 ماژول مدیریت و تخصیص امتحانات ←'}</span>
              </Link>
              {!isDeptScope && (
                <Link
                  href="/admin/curriculum"
                  className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/20 transition"
                >
                  📚 چارت کلی دانشگاه
                </Link>
              )}
            </div>
          </div>

          {/* Global Context Bar */}
          <div className="bg-white/10 backdrop-blur-md p-3.5 rounded-xl border border-white/15 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
            <div>
              <label className="text-indigo-200 font-bold block mb-1">۱. نیمسال تحصیلی:</label>
              <select
                value={selectedTermId}
                onChange={e => setSelectedTermId(Number(e.target.value))}
                className="w-full bg-slate-900/90 text-white border border-indigo-400/50 rounded-lg px-2.5 py-2 font-bold focus:ring-2 focus:ring-amber-400"
              >
                {terms.map(t => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-indigo-200 font-bold block mb-1">۲. رشته و دپارتمان:</label>
              <select
                value={selectedProgramId}
                onChange={e => setSelectedProgramId(Number(e.target.value))}
                className="w-full bg-slate-900/90 text-white border border-indigo-400/50 rounded-lg px-2.5 py-2 font-bold focus:ring-2 focus:ring-amber-400"
              >
                {programs.map(p => (
                  <option key={p.id} value={p.id}>{p.title} ({p.code}) — {p.facultyName}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-indigo-200 font-bold block mb-1">۳. نیمسال ورود (دانشجویان در حال تحصیل):</label>
              <select
                value={selectedCohortId}
                onChange={e => setSelectedCohortId(e.target.value)}
                className="w-full bg-slate-900/90 text-white border border-indigo-400/50 rounded-lg px-2.5 py-2 font-bold focus:ring-2 focus:ring-amber-400"
              >
                <option value="ALL">کلیه نیمسال‌های ورود</option>
                {visibleCohorts.map(c => (
                  <option key={c.id} value={c.id}>{c.title} — {faNum(c.expectedStudents)} دانشجوی در حال تحصیل</option>
                ))}
              </select>
              {cohortOrdinal != null && (
                <p className="mt-1 text-[10px] font-black text-amber-300">
                  این ورودی الان در ترم {faNum(cohortOrdinal)} است — چارت به همان ترم محدود شد
                </p>
              )}
              {cohortOrdinal == null && selectedCohortId !== 'ALL' && effectiveSemester !== 'ALL' && (
                <p className="mt-1 text-[10px] font-bold text-indigo-200">
                  نمایش ترم {faNum(effectiveSemester === 'NONE' ? 0 : Number(effectiveSemester))} چارت
                </p>
              )}
            </div>

            <div>
              <label className="text-amber-300 font-bold block mb-1">۴. ترجیح شیفت زمانی:</label>
              <select
                value={targetShiftPreference}
                onChange={e => {
                  const shift = e.target.value as ProgramShiftType;
                  setTargetShiftPreference(shift);

                }}
                className="w-full bg-amber-500/20 text-amber-200 border border-amber-400/60 rounded-lg px-2.5 py-2 font-extrabold focus:ring-2 focus:ring-amber-400"
              >
                <option value="AFTERNOON_WORKING" className="bg-slate-900 text-white">🌆 شیفت عصر/شب (دانشجویان شاغل)</option>
                <option value="MORNING" className="bg-slate-900 text-white">☀️ شیفت صبح (دانشجویان تمام‌وقت)</option>
                <option value="FLEXIBLE" className="bg-slate-900 text-white">⚡ شناور و متوازن</option>
              </select>
              <p className="mt-1 text-[10px] font-bold text-amber-200/80">
                {faNum(SHIFT_MODELS.length)} مدل چیدمان — همین تعداد در گام ۴
              </p>
            </div>

            <div>
              <label className="text-indigo-200 font-bold block mb-1">۵. نمای هفته (زوج / فرد):</label>
              <div className="grid grid-cols-3 gap-1 bg-slate-900/90 p-1 rounded-lg border border-indigo-400/50">
                <button
                  onClick={() => setSelectedWeekFilter('ALL_VIEW')}
                  className={`py-1 rounded font-bold text-[10px] transition ${
                    selectedWeekFilter === 'ALL_VIEW' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  کلیه
                </button>
                <button
                  onClick={() => setSelectedWeekFilter('EVEN')}
                  className={`py-1 rounded font-bold text-[10px] transition ${
                    selectedWeekFilter === 'EVEN' ? 'bg-cyan-600 text-white' : 'text-cyan-300 hover:text-white'
                  }`}
                >
                  زوج 🔷
                </button>
                <button
                  onClick={() => setSelectedWeekFilter('ODD')}
                  className={`py-1 rounded font-bold text-[10px] transition ${
                    selectedWeekFilter === 'ODD' ? 'bg-amber-600 text-white' : 'text-amber-300 hover:text-white'
                  }`}
                >
                  فرد 🔶
                </button>
              </div>
            </div>
          </div>

        </div>
  );
}
