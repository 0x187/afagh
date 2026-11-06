'use client';

// گام ۱: چارت دروس و انتساب اساتید
import { usePlanning } from '../PlanningProvider';
import { ProfessorSelect } from './ProfessorSelect';
import { faNum, DEMAND_PAGE, NO_PROFESSOR, MAX_GROUPS_PER_COURSE, suggestGroupsCount } from '../planning-core';

export default function CurriculumAssignTab() {
  const {
    chartRange,
    currentProgram,
    displayedDemands,
    filteredDemands,
    handleAssignCoProfessor,
    handleAssignProfessorToCourse,
    handleAssignProfessorToGroup,
    handleToggleCoTeaching,
    handleToggleCohortMerge,
    handleToggleDemandExamMode,
    handleUpdateCoWeights,
    handleUpdateCourseGroupsCount,
    handleUpdateDemandExamDate,
    isDeptScope,
    profAssignedUnitsMap,
    professors,
    setActiveMainTab,
    setDemandLimit,
  } = usePlanning();

  return (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">📚</span>
                  <h3 className="font-extrabold text-slate-900 text-base">
                    چارت درسی رشته «{currentProgram?.title ?? '—'}» ({currentProgram?.code ?? ''}) و انتساب اساتید به دروس
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  برای هر درس چارت، نام استاد مدرس و تعداد گروه‌ها را مشخص فرمایید. کنترل سقف واحد مجاز اساتید به صورت زنده انجام می‌شود.
                </p>
                <p className={`mt-1 text-2xs font-black ${chartRange ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {chartRange
                    ? `📗 چارت معتبر برای ورودی‌های ${faNum(chartRange.from)} تا ${chartRange.to ? faNum(chartRange.to) : 'به بعد'}`
                    : '📙 برای این رشته چارت مصوبی تعریف نشده است — دروس از فهرست ارائه‌های گروه نمایش داده می‌شود'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveMainTab('SCENARIOS')}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-900 to-indigo-950 hover:from-indigo-950 hover:to-slate-950 text-white font-extrabold text-xs shadow-md flex items-center gap-2 transition"
                >
                  <span>🧠 رفتن به موتور پیشنهاد هوشمند و تأمین گروه‌ها</span>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
              <table className="w-full border-collapse text-xs rt">
                <thead>
                  <tr className="bg-slate-900 text-white text-center">
                    <th className="p-3 border border-slate-800 w-12">ردیف</th>
                    <th className="p-3 border border-slate-800">کد درس</th>
                    <th className="p-3 border border-slate-800">عنوان درس چارت</th>
                    <th className="p-3 border border-slate-800">نیمسال ورود</th>
                    <th className="p-3 border border-slate-800">واحد</th>
                    <th className="p-3 border border-slate-800">نوع درس</th>
                    <th className="p-3 border border-slate-800">تعداد گروه‌ها</th>
                    <th className="p-3 border border-slate-800">انتخاب استاد مدرس</th>
                    <th className="p-3 border border-slate-800">وضعیت سقف تدریس استاد</th>
                    <th className="p-3 border border-slate-800">تنظیم تاریخ امتحان (دو حالت)</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedDemands.map((demand, idx) => {
                    // کشویی استاد فقط استادانِ «گروه صاحب درس» را نشان می‌دهد.
                    // اگر آن گروه هنوز استادی ندارد، به فهرست کامل برمی‌گردیم تا
                    // کشویی خالی و بی‌استفاده نشود.
                    const deptProfs = professors.filter(p => p.departmentId != null && p.departmentId === demand.courseDeptId);
                    // مدیرگروه فقط استادان گروه خودش را ببیند؛ fallback فقط برای ادمین.
                    const pool = isDeptScope ? deptProfs : (deptProfs.length ? deptProfs : professors);
                    const assignedProf = pool.find(p => p.id === demand.preferredProfId)
                      || professors.find(p => p.id === demand.preferredProfId)
                      || pool[0] || NO_PROFESSOR;
                    const coProf = demand.coProfId
                      ? (professors.find(p => p.id === demand.coProfId) ?? null)
                      : null;
                    const profLoad = profAssignedUnitsMap[assignedProf.id]?.units || 0;
                    const coLoad = coProf ? (profAssignedUnitsMap[coProf.id]?.units || 0) : 0;
                    const isOverQuota = profLoad > assignedProf.maxWeeklyUnits;
                    // پیشنهاد خودکار تعداد گروه از روی تعداد دانشجو (ثبت‌نام/ظرفیت)
                    const suggestedGroups = suggestGroupsCount({
                      enrolled: demand.enrolledCount, capacity: demand.capacity,
                    });
                    const typeRank = demand.courseTypeRank ?? 6;
                    const typeTone = typeRank <= 1
                      ? 'bg-sky-100 text-sky-900 border border-sky-300'
                      : typeRank <= 3
                        ? 'bg-indigo-100 text-indigo-900 border border-indigo-300'
                        : 'bg-amber-100 text-amber-900 border border-amber-300';

                    return (
                      <tr key={demand.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}>
                        <td className="p-2 border border-slate-200 text-center font-bold text-slate-500">{faNum(idx + 1)}</td>
                        <td className="p-2 border border-slate-200 font-mono text-center font-bold text-indigo-900">{demand.code}</td>
                        <td className="p-2 border border-slate-200 font-extrabold text-slate-900">{demand.title}</td>
                        <td className="p-2 border border-slate-200 text-center">
                          <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-bold text-3xs">
                            {demand.cohortTitle.split('(')[1]?.replace(')', '') || demand.cohortTitle}
                          </span>
                          {/* ورودی بهمنِ کم‌جمعیت: کلاس جدا لازم نیست — با مهر یکی شود */}
                          <button
                            type="button"
                            onClick={() => handleToggleCohortMerge(demand.id, !demand.cohortMerged)}
                            title={
                              demand.cohortMerged
                                ? 'این ارائه برای هر دو نیمسال ورود اعلام شده — برای جدا کردن کلیک کنید'
                                : 'اگر ورودی بهمن این درس کم‌جمعیت است، با ورودی مهر همان ترم یک کلاس بگیرد'
                            }
                            className={`mt-1 block w-full px-1.5 py-0.5 rounded text-[9px] font-black transition ${
                              demand.cohortMerged
                                ? 'bg-emerald-100 text-emerald-900 border border-emerald-300 hover:bg-emerald-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-300 hover:bg-slate-200'
                            }`}
                          >
                            {demand.cohortMerged ? '🔗 ادغام مهر+بهمن ✓' : '🔗 ادغام مهر+بهمن'}
                          </button>
                        </td>
                        <td className="p-2 border border-slate-200 text-center font-extrabold text-slate-900">{faNum(demand.units)}</td>
                        <td className="p-2 border border-slate-200 text-center">
                          <span className={`px-2 py-0.5 rounded text-3xs font-bold ${typeTone}`}>
                            {demand.courseType}
                          </span>
                        </td>

                        <td className="p-2 border border-slate-200 text-center">
                          {/* تعداد گروه آزاد است (نه فقط ۱..۳) — با پله‌های − / + */}
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              title="کاهش گروه"
                              onClick={() => handleUpdateCourseGroupsCount(demand.id, demand.groupsCount - 1)}
                              className="w-6 h-6 rounded-md border border-slate-300 bg-white text-slate-700 font-black leading-none hover:bg-slate-100"
                            >
                              −
                            </button>
                            <input
                              key={`groups-${demand.groupsCount}`}
                              type="number"
                              min={1}
                              max={MAX_GROUPS_PER_COURSE}
                              defaultValue={demand.groupsCount}
                              onBlur={e => handleUpdateCourseGroupsCount(demand.id, Number(e.target.value))}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              title={`تعداد گروه‌های موازی (۱ تا ${MAX_GROUPS_PER_COURSE})`}
                              className="w-14 border border-slate-300 rounded px-1 py-1 text-center font-black bg-white text-indigo-900"
                            />
                            <button
                              type="button"
                              title="افزایش گروه"
                              onClick={() => handleUpdateCourseGroupsCount(demand.id, demand.groupsCount + 1)}
                              className="w-6 h-6 rounded-md border border-slate-300 bg-white text-slate-700 font-black leading-none hover:bg-slate-100"
                            >
                              +
                            </button>
                          </div>
                          <div className="text-[9px] font-bold text-slate-500 mt-0.5">
                            {faNum(demand.groupsCount)} گروه · {faNum(demand.enrolledCount)} دانشجو
                          </div>
                          {suggestedGroups !== demand.groupsCount && (
                            <button
                              type="button"
                              onClick={() => handleUpdateCourseGroupsCount(demand.id, suggestedGroups)}
                              title={`بر اساس ${faNum(Math.max(demand.enrolledCount, demand.capacity))} دانشجو ÷ ${faNum(40)} نفر در هر گروه`}
                              className="mt-1 px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-[9px] font-black whitespace-nowrap"
                            >
                              💡 پیشنهاد: {faNum(suggestedGroups)} گروه
                            </button>
                          )}
                        </td>

                        <td className="p-2 border border-slate-200 min-w-[280px]">
                          {!demand.isCoTaught ? (
                            demand.groupsCount === 1 ? (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1.5">
                                  <ProfessorSelect
                                    professors={pool}
                                    value={demand.preferredProfId}
                                    onChange={id => handleAssignProfessorToCourse(demand.id, id)}
                                    label={p => `${p.name} (${p.academicRank} — ${p.contractType})`}
                                    className="w-full border-2 border-indigo-400/80 rounded-lg px-2 py-1 font-extrabold bg-indigo-50/50 text-indigo-950 focus:ring-2 focus:ring-indigo-500"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleToggleCoTeaching(demand.id)}
                                    title="تخصیص دو استاد مشترک (تئوری + عملی)"
                                    className="px-2 py-1 rounded bg-purple-100 hover:bg-purple-200 text-purple-900 font-bold text-3xs whitespace-nowrap transition"
                                  >
                                    👥 مشترک
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-2 p-2 bg-slate-50 rounded-xl border border-slate-200">
                                <div className="flex items-center justify-between pb-1 border-b border-slate-200 text-3xs font-bold text-slate-600">
                                  <span>انتساب اساتید به گروه‌های مجزا:</span>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleCoTeaching(demand.id)}
                                    className="text-purple-700 font-black hover:underline"
                                  >
                                    👥 تبدیل به مشترک
                                  </button>
                                </div>
                                {Array.from({ length: demand.groupsCount }).map((_, gIdx) => {
                                  const gNo = gIdx + 1;
                                  const curProfId = demand.groupProfessors?.[gNo] || demand.preferredProfId;
                                  return (
                                    <div key={gNo} className="flex items-center gap-1 text-2xs">
                                      <span className="px-1.5 py-0.5 rounded bg-indigo-900 text-white font-bold text-3xs whitespace-nowrap">
                                        گروه {faNum(gNo)}:
                                      </span>
                                      <ProfessorSelect
                                        professors={pool}
                                        value={curProfId}
                                        onChange={id => handleAssignProfessorToGroup(demand.id, gNo, id)}
                                        className="w-full border border-indigo-300 rounded px-1.5 py-0.5 font-bold bg-white text-indigo-950 text-xs"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            )
                          ) : (
                            <div className="p-2 rounded-xl bg-purple-50 border border-purple-200 space-y-2">
                              <div className="flex items-center justify-between pb-1 border-b border-purple-200/60">
                                <span className="font-extrabold text-3xs text-purple-950">👥 درس مشترک با دو استاد:</span>
                                <button
                                  type="button"
                                  onClick={() => handleToggleCoTeaching(demand.id)}
                                  className="text-3xs text-purple-700 hover:underline font-bold"
                                >
                                  لغو (تک‌استاد)
                                </button>
                              </div>

                              {/* Theory Professor */}
                              <div className="space-y-0.5">
                                <div className="flex items-center justify-between text-3xs font-bold text-slate-700">
                                  <span>📖 استاد بخش تئوری:</span>
                                  <span className="text-indigo-900">سهم: {faNum((demand.theoryWeightRatio || 0.7) * 100)}٪ ({faNum((demand.theoryWeightRatio || 0.7) * 20)} نمره)</span>
                                </div>
                                <ProfessorSelect
                                  professors={pool}
                                  value={demand.preferredProfId}
                                  onChange={id => handleAssignProfessorToCourse(demand.id, id)}
                                  className="w-full border border-indigo-300 rounded px-2 py-1 font-extrabold bg-white text-indigo-950 text-xs"
                                />
                              </div>

                              {/* Lab / Practical Professor */}
                              <div className="space-y-0.5">
                                <div className="flex items-center justify-between text-3xs font-bold text-slate-700">
                                  <span>🔬 استاد بخش عملی:</span>
                                  <span className="text-purple-900">سهم: {faNum((demand.labWeightRatio || 0.3) * 100)}٪ ({faNum((demand.labWeightRatio || 0.3) * 20)} نمره)</span>
                                </div>
                                <ProfessorSelect
                                  professors={pool}
                                  value={demand.coProfId ?? pool[0]?.id ?? 0}
                                  onChange={id => handleAssignCoProfessor(demand.id, id)}
                                  className="w-full border border-purple-300 rounded px-2 py-1 font-extrabold bg-white text-purple-950 text-xs"
                                />
                              </div>

                              {/* Weighting Slider */}
                              <div className="pt-1 border-t border-purple-200/50">
                                <div className="flex items-center justify-between text-[9px] font-bold text-slate-600 mb-0.5">
                                  <span>سهم‌بندی مدیر گروه:</span>
                                  <span>{faNum((demand.theoryWeightRatio || 0.7) * 100)}٪ تئوری / {faNum((demand.labWeightRatio || 0.3) * 100)}٪ عملی</span>
                                </div>
                                <input
                                  type="range"
                                  min={10}
                                  max={90}
                                  step={5}
                                  value={Math.round((demand.theoryWeightRatio || 0.7) * 100)}
                                  onChange={e => handleUpdateCoWeights(demand.id, Number(e.target.value))}
                                  className="w-full h-1.5 bg-purple-200 rounded-lg appearance-none cursor-pointer"
                                />
                              </div>
                            </div>
                          )}
                        </td>

                        <td className="p-2 border border-slate-200 text-center">
                          {!demand.isCoTaught ? (
                            <div className={`p-1.5 rounded-lg text-2xs font-bold ${
                              isOverQuota ? 'bg-rose-100 text-rose-900 border border-rose-300' : 'bg-emerald-100 text-emerald-900'
                            }`}>
                              <span>{faNum(profLoad)} از {faNum(assignedProf.maxWeeklyUnits)} واحد</span>
                              {isOverQuota && <span className="block text-[9px] font-black text-rose-700 mt-0.5">⚠️ تجاوز از سقف مجاز!</span>}
                            </div>
                          ) : (
                            <div className="space-y-1 text-3xs font-bold">
                              <div className={`p-1 rounded ${profLoad > assignedProf.maxWeeklyUnits ? 'bg-rose-100 text-rose-900' : 'bg-indigo-100 text-indigo-900'}`}>
                                <span>تئوری ({assignedProf.name}): {faNum(profLoad)}/{faNum(assignedProf.maxWeeklyUnits)} واحد</span>
                              </div>
                              <div className={`p-1 rounded ${coProf && coLoad > coProf.maxWeeklyUnits ? 'bg-rose-100 text-rose-900' : 'bg-purple-100 text-purple-900'}`}>
                                {coProf
                                  ? <span>عملی ({coProf.name}): {faNum(coLoad)}/{faNum(coProf.maxWeeklyUnits)} واحد</span>
                                  : <span>عملی: استاد بخش عملی تعیین نشده</span>}
                              </div>
                            </div>
                          )}
                        </td>

                        <td className="p-2 border border-slate-200 text-center min-w-[150px]">
                          <div className="space-y-1">
                            <button
                              type="button"
                              onClick={() => handleToggleDemandExamMode(demand.id)}
                              className={`px-2 py-0.5 rounded-full text-3xs font-black transition ${
                                demand.examSchedulingMode === 'MANUAL'
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                                  : 'bg-emerald-100 text-emerald-900 border border-emerald-300 hover:bg-emerald-200'
                              }`}
                              title="برای تغییر بین حالت خودکار و دستی کلیک کنید"
                            >
                              {demand.examSchedulingMode === 'MANUAL' ? '✍️ دستی مدیر' : '🤖 خودکار ترم'}
                            </button>
                            <input
                              type="text"
                              value={demand.examDate}
                              onChange={e => handleUpdateDemandExamDate(demand.id, e.target.value)}
                              className="w-full border border-slate-300 rounded p-1 font-mono font-bold text-center text-2xs bg-white text-slate-800"
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {displayedDemands.length < filteredDemands.length && (
                <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs">
                  <span className="font-bold text-slate-600">
                    نمایش {faNum(displayedDemands.length)} ردیف از {faNum(filteredDemands.length)} ردیف
                  </span>
                  <button
                    type="button"
                    onClick={() => setDemandLimit(n => n + DEMAND_PAGE)}
                    className="rounded-lg bg-indigo-900 px-4 py-2 font-black text-white transition hover:bg-indigo-950"
                  >
                    نمایش {faNum(Math.min(DEMAND_PAGE, filteredDemands.length - displayedDemands.length))} ردیف بعدی
                  </button>
                </div>
              )}
            </div>
          </div>
  );
}
