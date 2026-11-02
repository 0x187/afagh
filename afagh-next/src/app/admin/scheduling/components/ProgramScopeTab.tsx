'use client';

// فاز ۰: انتخاب رشته × نیمسال ورود/ترم چارت — پیش‌نیاز همهٔ فازهای بعدی
import { usePlanning } from '../PlanningProvider';
import { faNum } from '../planning-core';

/**
 * چرا این تب اول است؟
 *
 * یک گروه ممکن است سه رشته داشته باشد و تابلو نمی‌تواند همهٔ دروسِ همهٔ
 * رشته‌ها را هم‌زمان هندل کند. مدیرگروه اینجا «رشته × ترم چارت» را انتخاب
 * می‌کند، آن را تا آخر می‌برد و برمی‌گردد سراغ ترم بعد یا رشتهٔ بعد.
 */
export default function ProgramScopeTab() {
  const { applyScope, currentTerm, programMatrix, programs, selectedProgramId, selectedSemester, setSelectedProgramId, setSelectedSemester } = usePlanning();

  const chosen = programMatrix.find(p => p.id === selectedProgramId) ?? null;
  const totalDone = programMatrix.reduce((n, p) => n + p.semesters.filter(s => s.complete).length, 0);
  const totalAll = programMatrix.reduce((n, p) => n + p.semesters.length, 0);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🎯</span>
              <h3 className="font-extrabold text-slate-900 text-base">
                فاز ۰ — انتخاب رشته و ترم چارت برای برنامه‌ریزی
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              برنامه‌ریزی رشته‌به‌رشته و ترم‌به‌ترم انجام می‌شود: یک ترم را کامل کن، برگرد، سراغ ترم بعد برو.
              وضعیت هر ترم از دادهٔ واقعی همین نیمسال ({currentTerm?.title ?? '—'}) محاسبه می‌شود.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <span className="px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-900">
              {faNum(totalDone)} ترم کامل
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700">
              از {faNum(totalAll)} ترم چارت
            </span>
          </div>
        </div>
      </div>

      {programMatrix.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-6 text-center">
          <p className="font-extrabold text-amber-900">هیچ رشته‌ای در دامنهٔ شما پیدا نشد</p>
          <p className="mt-1 text-xs font-bold text-amber-800">ابتدا رشته‌های گروه را در چارت درسی تعریف کنید.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {programMatrix.map(p => (
          <div
            key={p.id}
            className={`rounded-2xl border-2 bg-white p-4 shadow-sm transition ${
              p.id === selectedProgramId ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="min-w-0">
                <h4 className="font-extrabold text-slate-900 text-sm truncate" title={p.title}>🎓 {p.title} <span className="text-slate-500 font-mono text-xs">({p.code})</span></h4>
                <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                  {faNum(p.semesters.reduce((n, s) => n + s.total, 0))} درس در این نیمسال
                </p>
              </div>
              {p.semesters.length > 0 && p.semesters.every(s => s.complete) && (
                <span className="shrink-0 px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-black">
                  ✅ برنامهٔ این رشته کامل است
                </span>
              )}
            </div>

            {p.semesters.length === 0 ? (
              <p className="text-[11px] font-bold text-slate-400 py-3 text-center">
                درسی برای این رشته در نیمسال جاری ثبت نشده است
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {p.semesters.map(s => {
                  const key = s.semester ?? 'NONE';
                  const active = p.id === selectedProgramId && selectedSemester === key;
                  const label = s.semester == null ? 'ترم نامشخص' : `ترم ${faNum(s.semester)}`;
                  return (
                    <button
                      key={String(key)}
                      type="button"
                      onClick={() => applyScope(p.id, key as number | 'NONE')}
                      title={
                        s.complete
                          ? 'همهٔ دروس استاد و جایگاه هفتگی دارند'
                          : `${faNum(s.missingProf)} درس بدون استاد · ${faNum(s.unscheduled)} درس بدون جایگاه در هفته`
                      }
                      className={`px-3 py-2 rounded-xl border-2 text-[11px] font-black transition ${
                        active
                          ? 'bg-indigo-900 text-white border-indigo-900'
                          : s.complete
                            ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                            : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                      }`}
                    >
                      {s.complete ? '✅' : '⏳'} {label}
                      <span className="block text-[9px] font-bold opacity-80">
                        {faNum(s.total)} درس
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <p className="text-xs font-bold text-slate-600">
          {chosen
            ? `دامنهٔ فعلی: رشتهٔ «${chosen.title}» — ${selectedSemester === 'ALL' ? 'همهٔ ترم‌ها' : selectedSemester === 'NONE' ? 'بدون ترم' : `ترم ${faNum(selectedSemester)}`}`
            : 'برای شروع، یکی از ترتیب‌های بالا را انتخاب کنید.'}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setSelectedProgramId(selectedProgramId); setSelectedSemester('ALL'); }}
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-extrabold"
          >
            نمایش همهٔ ترم‌ها
          </button>
          <button
            type="button"
            disabled={!programs.length}
            onClick={() => applyScope(selectedProgramId || programs[0]?.id || 0, selectedSemester)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-900 to-indigo-950 text-white text-xs font-extrabold shadow-md disabled:opacity-50"
          >
            رفتن به گام ۱ — تخصیص دروس و اساتید ←
          </button>
        </div>
      </div>
    </div>
  );
}
