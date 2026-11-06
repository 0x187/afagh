'use client';

// تب ۳: ترم‌بندی چارت با درگ‌اندراپ + سقف واحد + فیلتر/مرتب‌سازی زنده
import { useMemo, useState } from 'react';
import { useCurriculum } from '../curriculum-context';
import { ROLE_LABELS, STATUS_UI, faNum, semesterUnitTotal, dependencyWarningText, depWarningBadge, compareCourseCode } from '../curriculum-core';
import { SUMMER_SEMESTER, isSummerSemester } from '@/lib/term-plan';
import type { CourseRow } from '../types';

type SortKey = 'CODE' | 'TITLE' | 'UNITS';

export default function SemestersTab() {
  const {
    activeTab,
    chartTermCount,
    degreeMajor,
    depWarnings,
    detail,
    detailLoading,
    dragCourseId,
    dropTarget,
    gridTerms,
    handleAssignSemester,
    isDraft,
    isOverflowTerm,
    onCourseDragEnd,
    onCourseDragStart,
    onDropToSemester,
    planTerms,
    selectedVersion,
    semesterCourses,
    setDropTarget,
    totalPlannedUnits,
    typeSummary,
    unassignedCourses,
    universityTitle,
  } = useCurriculum();

  // ── فیلتر/مرتب‌سازی زندهٔ چارت (کد، عنوان، نقش) ──
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('CODE');

  const matches = (c: CourseRow): boolean => {
    if (roleFilter && c.roleType !== roleFilter) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return c.code.toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle);
  };

  // filter آرایهٔ جدید می‌دهد؛ sort روی همان کپی انجام می‌شود (state دست‌نخورده می‌ماند)
  const refine = (list: CourseRow[]): CourseRow[] =>
    list.filter(matches).sort((a, b) =>
      sortBy === 'TITLE' ? a.title.localeCompare(b.title, 'fa')
        : sortBy === 'UNITS' ? (Number(b.units) || 0) - (Number(a.units) || 0)
          : compareCourseCode(a.code, b.code));

  const filterActive = query.trim() !== '' || roleFilter !== '' || sortBy !== 'CODE';
  const shownCount = useMemo(
    () => [...semesterCourses.values()].flat().filter(matches).length + unassignedCourses.filter(matches).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [semesterCourses, unassignedCourses, query, roleFilter],
  );
  const totalCount = useMemo(
    () => [...semesterCourses.values()].flat().length + unassignedCourses.length,
    [semesterCourses, unassignedCourses],
  );

  // کارتِ هشدار پوشش/ترم‌بندی پیش‌نیاز و هم‌نیاز — با نام دروس، نه فقط کد
  const renderDepWarn = (courseId: number) => {
    const warns = depWarnings?.get(courseId);
    if (!warns || warns.length === 0) return null;
    const badge = depWarningBadge(warns);
    if (!badge) return null;
    const toneCls = badge.tone === 'red'
      ? 'bg-rose-600 text-white'
      : badge.tone === 'blue' ? 'bg-sky-100 text-sky-900' : 'bg-amber-100 text-rose-700';
    return (
      <div
        className={`mt-0.5 text-[9px] font-extrabold leading-tight rounded px-1.5 py-0.5 ${toneCls}`}
        title={warns.map(dependencyWarningText).join('\n')}
      >
        {badge.icon} {badge.label}
      </div>
    );
  };

  if (!selectedVersion) return null;

  if (activeTab === 'SEMESTERS' && !detail) {
    if (detailLoading) {
      return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 text-center text-[12px] font-bold text-slate-500">
          در حال بارگذاری ترم‌بندی…
        </div>
      );
    }
    return null;
  }

  return (
    <>
      {/* ترمبندی چارت — تب: ترمبندی چارت */}
      {activeTab === 'SEMESTERS' && detail && (
        <div className="curriculum-print-area bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
          {/* هدر چاپی: دانشگاه / رشته / مقطع / پنجرهٔ ورودی — فقط روی کاغذ */}
          <div className="chart-print-header hidden print:!block border-b-2 border-slate-800 pb-2 text-center">
            <div className="t">{universityTitle || 'دانشگاه'}</div>
            <div>
              برنامهٔ درسی — {degreeMajor?.name ?? '—'} ({degreeMajor?.code ?? '—'})
              {' '}· مقطع: {degreeMajor?.degreeTitle ?? '—'}{degreeMajor?.degreeIsGraduate === 1 ? ' (تکمیلی)' : ''}
            </div>
            <div>
              ورودی‌های {faNum(selectedVersion?.entryYearFrom ?? 0)}
              {selectedVersion?.entryYearTo != null ? ` تا ${faNum(selectedVersion.entryYearTo)}` : ' به بعد'}
              {' '}· نسخه: {selectedVersion?.title ?? '—'}
            </div>
          </div>
          <div className="print:hidden flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-extrabold text-slate-900 text-sm">🗺️ ترمبندی چارت — {selectedVersion.title}</h4>
              <p className="text-2xs text-slate-500 font-bold mt-0.5">
                چارت {faNum(chartTermCount)} ترمه (مقطع: {degreeMajor?.degreeTitle ?? '—'}{degreeMajor?.degreeIsGraduate === 1 ? ' · تکمیلی' : ''}) + تابستان؛
                موتور انتخاب واحد و تطبیق فارغالتحصیلی بر اساس همین ترمبندی عمل میکنند.
              </p>
            </div>
            <div className="text-2xs bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2 font-black text-indigo-900">
              مجموع واحدهای چارت: {faNum(totalPlannedUnits)} از {faNum(detail.version.totalRequiredUnits)} واحد الزامی
              {detail.version.maxUnitsPerTerm != null ? ` · سقف هر ترم: ${faNum(detail.version.maxUnitsPerTerm)} واحد` : ''}
            </div>
          </div>

          {!isDraft && (
            <div className="print:hidden p-3 rounded-xl bg-slate-50 border border-slate-200 text-2xs font-bold text-slate-600">
              ⚠️ این نسخه «{(STATUS_UI[selectedVersion.status] ?? { label: selectedVersion.status }).label}» است و فقط مشاهده مجاز است؛ برای تغییر ترمبندی از «🔁 ایجاد نسخهٔ جدید (R+1)» یک پیشنویس بسازید.
            </div>
          )}

          {/* نوار فیلتر و مرتب‌سازی — روی شبکهٔ ترم‌ها و استخر «بدون ترم» هم‌زمان اثر دارد */}
          <div className="print:hidden flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="🔍 جست‌وجوی کد یا نام درس…"
              className="flex-1 min-w-[180px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-2xs font-bold outline-none focus:border-indigo-500"
            />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-2xs font-bold"
              title="فیلتر بر اساس نقش درس"
            >
              <option value="">همهٔ نقش‌ها</option>
              {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-2xs font-bold"
              title="ترتیب نمایش دروس"
            >
              <option value="CODE">مرتب: کد درس</option>
              <option value="TITLE">مرتب: نام درس</option>
              <option value="UNITS">مرتب: واحد (نزولی)</option>
            </select>
            {filterActive && (
              <button
                onClick={() => { setQuery(''); setRoleFilter(''); setSortBy('CODE'); }}
                className="rounded-lg bg-slate-200 hover:bg-slate-300 px-2.5 py-1.5 text-2xs font-extrabold text-slate-700"
              >
                ✕ پاک‌کردن فیلتر
              </button>
            )}
            <span className={`text-3xs font-black ${shownCount === totalCount ? 'text-slate-500' : 'text-indigo-800'}`}>
              {faNum(shownCount)} از {faNum(totalCount)} درس
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {gridTerms.map(sem => {
              const list = refine(semesterCourses.get(sem) ?? []);
              const units = semesterUnitTotal(list);
              const over = detail.version.maxUnitsPerTerm != null && units > (detail.version.maxUnitsPerTerm as number);
              const isDropHere = isDraft && dropTarget === sem;
              const summer = isSummerSemester(sem);
              const overflow = isOverflowTerm(sem);
              const cardCls = summer
                ? 'border-amber-300 bg-amber-50/70'
                : over ? 'border-rose-300 bg-rose-50' : 'border-emerald-200 bg-emerald-50/50';
              return (
                <div
                  key={sem}
                  onDragOver={isDraft ? (e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget(sem); }) : undefined}
                  onDragLeave={isDraft ? (() => setDropTarget(cur => (cur === sem ? null : cur))) : undefined}
                  onDrop={isDraft ? (e => onDropToSemester(e, sem)) : undefined}
                  className={`rounded-xl border-2 p-3 space-y-2 transition-colors ${cardCls} ${isDropHere ? '!border-indigo-500 !bg-indigo-50 shadow-lg' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-black text-emerald-950 text-xs">
                      {summer ? '☀️ تابستان' : `ترم ${faNum(sem)}`}
                      {overflow && <span className="mr-1 rounded bg-slate-200 px-1.5 py-0.5 text-[9px] text-slate-600">خارج چارت</span>}
                    </span>
                    <span className={`text-3xs font-black px-2 py-0.5 rounded-full ${over ? 'bg-rose-200 text-rose-900' : summer ? 'bg-amber-200 text-amber-900' : 'bg-emerald-200 text-emerald-900'}`}>
                      {faNum(units)} واحد
                    </span>
                  </div>
                  {over && <div className="text-3xs font-bold text-rose-700">⚠️ بیش از سقف ترم!</div>}
                  {list.length === 0 && <div className="text-3xs text-slate-400 font-bold py-2 text-center">{isDropHere ? '⬇ رها کنید' : '— بدون درس —'}</div>}
                  <div className="space-y-1.5 min-h-[28px]">
                    {list.map(c => (
                      <div key={c.courseId} className="space-y-1.5">
                        <div
                          draggable={isDraft}
                          onDragStart={e => onCourseDragStart(e, c.courseId)}
                          onDragEnd={onCourseDragEnd}
                          title={isDraft ? 'بکشید و در ترم موردنظر رها کنید' : c.title}
                          className={`flex items-center justify-between gap-1 bg-white rounded-lg px-2 py-1 border border-emerald-100 text-2xs ${isDraft ? 'cursor-grab active:cursor-grabbing' : ''} ${dragCourseId === c.courseId ? 'opacity-40' : ''}`}
                        >
                          {isDraft && <span className="text-slate-300 shrink-0 select-none">⠿</span>}
                          <span className="font-mono text-indigo-900 text-3xs">{c.code}</span>
                          <span className="truncate font-bold flex-1">{c.title}</span>
                          <span className="text-slate-400 text-3xs">{faNum(c.units)}</span>
                          {isDraft && (
                            <button
                              onClick={() => handleAssignSemester(c.courseId, null)}
                              title="حذف از این ترم (نامشخص)"
                              className="text-rose-500 hover:text-rose-700 font-black px-1"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        {renderDepWarn(c.courseId)}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            onDragOver={isDraft ? (e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget('pool'); }) : undefined}
            onDragLeave={isDraft ? (() => setDropTarget(cur => (cur === 'pool' ? null : cur))) : undefined}
            onDrop={isDraft ? (e => onDropToSemester(e, null)) : undefined}
            className={`rounded-xl border-2 bg-slate-50 p-3 space-y-2 transition-colors ${isDraft && dropTarget === 'pool' ? '!border-indigo-500 !bg-indigo-50 shadow-lg' : 'border-slate-200'}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-black text-slate-800 text-xs">🌫️ دروس بدون ترم (نامشخص) — {faNum(unassignedCourses.length)} درس</span>
              <span className="text-3xs text-slate-400 font-bold">{isDraft ? 'بکشید و روی ترم موردنظر رها کنید — یا از منوی هر درس ترم بدهید' : 'با انتخاب «ترم» از منوی هر درس، به ترمبندی اضافه میشود'}</span>
            </div>
            {unassignedCourses.length === 0 && <div className="text-3xs text-slate-400 font-bold py-2 text-center">{isDraft && dropTarget === 'pool' ? '⬇ اینجا رها کنید تا از ترم خارج شود' : 'همهٔ دروس ترمبندی شدهاند. ✓'}</div>}
            {unassignedCourses.length > 0 && refine(unassignedCourses).length === 0 && (
              <div className="text-3xs text-slate-400 font-bold py-2 text-center">هیچ درسی با فیلتر فعلی مطابقت ندارد.</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 min-h-[28px]">
              {refine(unassignedCourses).map(c => (
                <div key={c.courseId} className="space-y-1.5">
                  <div
                    draggable={isDraft}
                    onDragStart={e => onCourseDragStart(e, c.courseId)}
                    onDragEnd={onCourseDragEnd}
                    title={isDraft ? 'بکشید و روی ترم موردنظر رها کنید' : c.title}
                    className={`flex items-center gap-2 bg-white rounded-lg px-2 py-1.5 border border-slate-200 text-2xs ${isDraft ? 'cursor-grab active:cursor-grabbing' : ''} ${dragCourseId === c.courseId ? 'opacity-40' : ''}`}
                  >
                    {isDraft && <span className="text-slate-300 shrink-0 select-none">⠿</span>}
                    <span className="font-mono text-indigo-900 text-3xs">{c.code}</span>
                    <span className="truncate font-bold flex-1">{c.title}</span>
                    <span className="text-slate-400 text-3xs">{faNum(c.units)} واحد</span>
                    {isDraft ? (
                      <select
                        value=""
                        onChange={e => e.target.value && handleAssignSemester(c.courseId, Number(e.target.value))}
                        className="border border-slate-300 rounded px-1 py-0.5 font-bold text-3xs bg-white"
                      >
                        <option value="">ترم…</option>
                        {planTerms.map(s => <option key={s} value={s}>ترم {faNum(s)}</option>)}
                        <option value={SUMMER_SEMESTER}>تابستان</option>
                      </select>
                    ) : (
                      <span className="text-3xs text-slate-400 font-bold">نامشخص</span>
                    )}
                  </div>
                  {renderDepWarn(c.courseId)}
                </div>
              ))}
            </div>
          </div>

          {/* خلاصهٔ نوع درس در پایین چاپ: از هر نوع چند درس / چند واحد */}
          <div className="chart-print-footer hidden print:!block border-t-2 border-slate-800 pt-2">
            <div className="font-extrabold mb-1">خلاصهٔ دروس بر اساس نوع (تعداد دروس / واحد):</div>
            {typeSummary.length > 0 ? (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="border border-slate-400 px-1 py-0.5 text-center">نوع درس</th>
                    {typeSummary.map(r => (
                      <th key={r.role} className="border border-slate-400 px-1 py-0.5 text-center">{ROLE_LABELS[r.role] ?? r.role}</th>
                    ))}
                    <th className="border border-slate-400 px-1 py-0.5 text-center">جمع</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-400 px-1 py-0.5 text-center font-bold">تعداد دروس</td>
                    {typeSummary.map(r => <td key={r.role} className="border border-slate-400 px-1 py-0.5 text-center">{faNum(r.count)}</td>)}
                    <td className="border border-slate-400 px-1 py-0.5 text-center font-extrabold">{faNum(typeSummary.reduce((s, r) => s + r.count, 0))}</td>
                  </tr>
                  <tr>
                    <td className="border border-slate-400 px-1 py-0.5 text-center font-bold">واحد</td>
                    {typeSummary.map(r => <td key={r.role} className="border border-slate-400 px-1 py-0.5 text-center">{faNum(r.units)}</td>)}
                    <td className="border border-slate-400 px-1 py-0.5 text-center font-extrabold">{faNum(typeSummary.reduce((s, r) => s + r.units, 0))}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div>در این نسخه درسی تعریف نشده است.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
