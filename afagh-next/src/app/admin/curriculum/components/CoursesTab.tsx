'use client';

// تب ۲: دروس کاتالوگ (نقش، الزامی، پیش‌نیاز، تأییدیه‌ها) + سورت/فیلتر ستون‌ها
import { useMemo, useState } from 'react';
import { useCurriculum } from '../curriculum-context';
import { ROLE_LABELS, compareCourseCode, faDate, faNum, semLabel, dependencyWarningText, depWarningBadge, roleLabel } from '../curriculum-core';
import { describeLogicNode } from '@/lib/curriculum-types';
import { SUMMER_SEMESTER } from '@/lib/term-plan';
import { GRADE_STATUS_CODES, gradeStatusOptionLabel, gradeStatusTitleOf } from '@/lib/grade-status-codes';
import { roleFromBankType } from '@/lib/bank-roles';

type CourseSortKey = 'CODE' | 'TITLE' | 'UNITS' | 'ROLE' | 'SEM';

export default function CoursesTab() {
  const {
    activeTab,
    busy,
    courseCodeOf,
    depWarnings,
    detail,
    handleAssignSemester,
    handleMarkGradReq,
    handleRemoveCourse,
    handleSyncRoles,
    handleUpdateGradeStatusCodes,
    handleUpdateGradReq,
    handleUpdateRequired,
    handleUpdateRole,
    isDraft,
    openRules,
    planTerms,
    roleTargets,
    ruleText,
    setModal,
    totalPlannedUnits,
    typeSummary,
  } = useCurriculum();

  // ── سورت و فیلتر ستون‌های جدول دروس ──
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [semFilter, setSemFilter] = useState(''); // '' همه · 'NONE' نامشخص · کد ترم/تابستان
  const [sortBy, setSortBy] = useState<CourseSortKey>('CODE');
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const toggleSort = (k: CourseSortKey) => {
    if (sortBy === k) setSortDir(d => (d === 1 ? -1 : 1));
    else { setSortBy(k); setSortDir(1); }
  };

  const filtersActive = query.trim() !== '' || roleFilter !== '' || semFilter !== '';

  const visibleCourses = useMemo(() => {
    const courses = detail?.courses ?? [];
    const needle = query.trim().toLowerCase();
    const list = courses.filter(c => {
      if (roleFilter && c.roleType !== roleFilter) return false;
      if (semFilter === 'NONE') { if (c.recommendedSemester != null) return false; }
      else if (semFilter !== '' && String(c.recommendedSemester) !== semFilter) return false;
      if (!needle) return true;
      return c.code.toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle);
    });
    const cmp: Record<CourseSortKey, (a: typeof list[number], b: typeof list[number]) => number> = {
      CODE: (a, b) => compareCourseCode(a.code, b.code),
      TITLE: (a, b) => a.title.localeCompare(b.title, 'fa'),
      UNITS: (a, b) => (Number(a.units) || 0) - (Number(b.units) || 0),
      ROLE: (a, b) => a.roleType.localeCompare(b.roleType),
      SEM: (a, b) => (a.recommendedSemester ?? 999) - (b.recommendedSemester ?? 999),
    };
    return [...list].sort((a, b) => cmp[sortBy](a, b) * sortDir);
  }, [detail?.courses, query, roleFilter, semFilter, sortBy, sortDir]);

  /** سرستون مرتب‌شونده — کلیک: صعودی/نزولی */
  const sortTh = (k: CourseSortKey, label: React.ReactNode, title?: string) => (
    <th
      onClick={() => toggleSort(k)}
      title={title ?? 'برای مرتب‌سازی کلیک کنید'}
      className="p-2.5 border border-slate-800 cursor-pointer select-none hover:bg-slate-700"
    >
      {label}
      <span className="text-amber-300">{sortBy === k ? (sortDir === 1 ? ' ▲' : ' ▼') : ' ⇅'}</span>
    </th>
  );

  // هشدار پوشش/ترتیب پیش‌نیاز و هم‌نیاز — با **نام** دروس، نه فقط کد
  const depWarnNode = (courseId: number) => {
    const warns = depWarnings?.get(courseId);
    if (!warns || warns.length === 0) return null;
    const badge = depWarningBadge(warns);
    if (!badge) return null;
    const toneCls = badge.tone === 'red'
      ? 'bg-rose-600 text-white'
      : badge.tone === 'blue' ? 'bg-sky-100 text-sky-900' : 'bg-amber-100 text-rose-700';
    return (
      <div
        className={`mt-1 text-[9px] font-extrabold leading-tight rounded px-1 py-0.5 ${toneCls}`}
        title={warns.map(dependencyWarningText).join('\n')}
      >
        {badge.icon} {badge.label}
      </div>
    );
  };

  return (
    <>
      {/* Courses — تب: دروس کاتالوگ */}
      {activeTab === 'COURSES' && detail && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="min-w-0">
              <h4 className="font-extrabold text-slate-900 text-sm">📖 دروس نسخه</h4>
              <p className="text-2xs text-slate-500 font-bold mt-0.5">
                {faNum(detail.courses.length)} درس در این نسخه
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setModal('NEW_COURSE')}
                className="px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-2xs transition-colors"
              >
                ✨ تعریف درس جدید
              </button>
              {isDraft && (
                <>
                  <button
                    onClick={() => setModal('ADD_COURSE')}
                    className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-2xs transition-colors"
                  >
                    ➕ افزودن درس از بانک
                  </button>
                  {detail.courses.length > 0 && (
                    <button
                      onClick={handleSyncRoles}
                      disabled={busy}
                      title="نقش همهٔ دروس نسخه از روی ستون «نوع درس» بانک بازخوانی می‌شود (تغییرات دستی بازنویسی می‌شود)"
                      className="px-3 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-2xs disabled:opacity-50 transition-colors"
                    >
                      🔄 همگام‌سازی نقش از بانک
                    </button>
                  )}
                  {detail.courses.length > 0 && (
                    <button
                      onClick={handleMarkGradReq}
                      disabled={busy}
                      title="همهٔ دروس الزامی (تیک «الزامی در ترم») و نقش‌های تخصصی/پایه به‌عنوان «شرط فارغ‌التحصیلی» علامت می‌خورند؛ مواردی که قبلاً علامت خورده‌اند دست‌نخورده می‌مانند"
                      className="px-3 py-1.5 rounded-lg bg-teal-100 hover:bg-teal-200 text-teal-900 font-bold text-2xs disabled:opacity-50 transition-colors"
                    >
                      🎓 شرط فارغ‌التحصیلی برای دروس الزامی
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          {detail.courses.length === 0 && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs font-bold text-slate-500">
              هنوز درسی به این نسخه افزوده نشده است.
            </div>
          )}
          {/* نوار سورت/فیلتر ستون‌ها */}
          {detail.courses.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="🔍 جست‌وجوی کد یا نام درس…"
                className="flex-1 min-w-[180px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-2xs font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
              />
              <select
                value={roleFilter}
                onChange={e => setRoleFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-2xs font-bold"
                title="فیلتر نقش درس"
              >
                <option value="">همهٔ نقش‌ها</option>
                {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select
                value={semFilter}
                onChange={e => setSemFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-2xs font-bold"
                title="فیلتر ترم پیشنهادی"
              >
                <option value="">همهٔ ترم‌ها</option>
                <option value="NONE">بدون ترم (نامشخص)</option>
                {planTerms.map(s => <option key={s} value={String(s)}>ترم {faNum(s)}</option>)}
                <option value={String(SUMMER_SEMESTER)}>تابستان</option>
              </select>
              {filtersActive && (
                <button
                  onClick={() => { setQuery(''); setRoleFilter(''); setSemFilter(''); }}
                  className="rounded-lg bg-slate-200 hover:bg-slate-300 px-2.5 py-1.5 text-2xs font-extrabold text-slate-700 transition-colors"
                >
                  ✕ پاک‌کردن فیلتر
                </button>
              )}
              <span className={`ms-auto text-2xs font-black ${visibleCourses.length === detail.courses.length ? 'text-slate-500' : 'text-indigo-800'}`}>
                {faNum(visibleCourses.length)} از {faNum(detail.courses.length)} درس
              </span>
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full border-collapse text-xs rt">
              <thead>
                <tr className="bg-slate-900 text-white text-center">
                  <th className="p-2.5 border border-slate-800 w-10">ردیف</th>
                  {sortTh('CODE', 'کد')}
                  {sortTh('TITLE', 'عنوان درس')}
                  {sortTh('UNITS', 'واحد')}
                  {sortTh('ROLE', 'نقش')}
                  {sortTh('SEM', 'ترم پیشنهادی')}
                  <th className="p-2.5 border border-slate-800">الزامی در ترم</th>
                  <th className="p-2.5 border border-slate-800" title="درس‌هایی که گذراندن‌شان برای فارغ‌التحصیلی اجباری است؛ موتور تطبیق فارغ‌التحصیلی فقط همین‌ها را چک می‌کند">شرط فارغ‌التحصیلی</th>
                  <th className="p-2.5 border border-slate-800" title="کد وضعیت سما هنگام قبولی (از curriculum_courses.passGradeStatusCode)">کد قبولی</th>
                  <th className="p-2.5 border border-slate-800" title="کد وضعیت سما هنگام مردودی (از curriculum_courses.failGradeStatusCode)">کد مردودی</th>
                  <th className="p-2.5 border border-slate-800">پیش‌نیاز / هم‌نیاز</th>
                  <th className="p-2.5 border border-slate-800">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {visibleCourses.map((c, idx) => (
                  <tr key={c.courseId} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                    <td className="p-2 border border-slate-200 text-center text-slate-500 font-bold">{faNum(idx + 1)}</td>
                    <td className="p-2 border border-slate-200 font-mono text-center font-bold text-indigo-900">{c.code}</td>
                    <td className="p-2 border border-slate-200 font-extrabold text-right">{c.title}</td>
                    <td className="p-2 border border-slate-200 text-center font-black">{faNum(c.units)}</td>
                    <td className="p-2 border border-slate-200 text-center">
                      {isDraft ? (
                        <select
                          value={c.roleType}
                          onChange={e => handleUpdateRole(c.courseId, e.target.value)}
                          title={c.courseType ? `نوع درس در بانک: ${c.courseType} (نقش پیشنهادی: ${ROLE_LABELS[roleFromBankType(c.courseType)] ?? '—'})` : undefined}
                          className="border border-slate-300 rounded px-1.5 py-1 font-bold bg-white"
                        >
                          {Object.entries(ROLE_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-bold">{ROLE_LABELS[c.roleType] ?? c.roleType}</span>
                      )}
                      {/* منبعِ پیش‌فرضِ نقش، «نوع درس» بانک است؛ اگر دستی عوض شده، زرد می‌شود */}
                      {c.courseType && (
                        <div
                          className={`mt-0.5 text-[9px] font-bold ${roleFromBankType(c.courseType) === c.roleType ? 'text-slate-400' : 'text-amber-700'}`}
                          title="نوع درس در بانک — نقش پیش‌فرض از همین گرفته می‌شود"
                        >
                          بانک: {c.courseType}
                        </div>
                      )}
                    </td>
                    <td className="p-2 border border-slate-200 text-center">
                      {isDraft ? (
                        <select
                          value={c.recommendedSemester ?? ''}
                          onChange={e => handleAssignSemester(c.courseId, e.target.value ? Number(e.target.value) : null)}
                          className="border border-slate-300 rounded px-1.5 py-1 font-bold bg-white"
                        >
                          <option value="">نامشخص</option>
                          {planTerms.map(s => <option key={s} value={s}>ترم {faNum(s)}</option>)}
                          <option value={SUMMER_SEMESTER}>تابستان</option>
                        </select>
                      ) : (
                        <span className="font-bold">{semLabel(c.recommendedSemester)}</span>
                      )}
                      {depWarnNode(c.courseId)}
                    </td>
                    <td className="p-2 border border-slate-200 text-center">
                      <input
                        type="checkbox"
                        checked={c.isRequired === 1}
                        disabled={!isDraft}
                        title="الزامی در ترم: این درس برای دانشجوی این ورودی اجباری است و در مجموع واحد الزامی شمرده می‌شود. با تیک‌زدن، «شرط فارغ‌التحصیلی» هم خودکار تیک می‌خورد."
                        onChange={e => handleUpdateRequired(c.courseId, e.target.checked ? 1 : 0)}
                        className="accent-indigo-700 w-4 h-4"
                      />
                    </td>
                    <td className="p-2 border border-slate-200 text-center">
                      <input
                        type="checkbox"
                        checked={c.isGraduationRequired === 1}
                        disabled={!isDraft}
                        title="شرط فارغ‌التحصیلی: بدون گذراندن این درس، دانشجو فارغ‌التحصیل نمی‌شود (حتی اگر الزامیِ ترم نباشد، مثل پایان‌نامه/کارآموزی)."
                        onChange={e => handleUpdateGradReq(c.courseId, e.target.checked ? 1 : 0)}
                        className="accent-indigo-700 w-4 h-4"
                      />
                    </td>
                    <td className="p-2 border border-slate-200 text-center">
                      {isDraft ? (
                        <select
                          value={c.passGradeStatusCode ?? ''}
                          onChange={e => handleUpdateGradeStatusCodes(c.courseId, e.target.value || null, c.failGradeStatusCode)}
                          className="border border-slate-300 rounded px-1 py-0.5 text-3xs font-bold bg-white max-w-[140px]"
                          title={gradeStatusTitleOf(c.passGradeStatusCode) ?? 'پیش‌فرض: 1 (قبول عادی)'}
                        >
                          <option value="">پیش‌فرض (1)</option>
                          {GRADE_STATUS_CODES.filter(g => g.passed).map(g => (
                            <option key={g.code} value={g.code}>{gradeStatusOptionLabel(g)}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-mono font-bold text-2xs" title={gradeStatusTitleOf(c.passGradeStatusCode) ?? undefined}>
                          {c.passGradeStatusCode || '1'}
                        </span>
                      )}
                    </td>
                    <td className="p-2 border border-slate-200 text-center">
                      {isDraft ? (
                        <select
                          value={c.failGradeStatusCode ?? ''}
                          onChange={e => handleUpdateGradeStatusCodes(c.courseId, c.passGradeStatusCode, e.target.value || null)}
                          className="border border-slate-300 rounded px-1 py-0.5 text-3xs font-bold bg-white max-w-[140px]"
                          title={gradeStatusTitleOf(c.failGradeStatusCode) ?? 'پیش‌فرض: 2 (مردود عادی)'}
                        >
                          <option value="">پیش‌فرض (2)</option>
                          {GRADE_STATUS_CODES.filter(g => !g.passed).map(g => (
                            <option key={g.code} value={g.code}>{gradeStatusOptionLabel(g)}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-mono font-bold text-2xs" title={gradeStatusTitleOf(c.failGradeStatusCode) ?? undefined}>
                          {c.failGradeStatusCode || '2'}
                        </span>
                      )}
                    </td>
                    <td className="p-2 border border-slate-200 text-right align-top">
                      <div className="text-3xs font-bold text-slate-600 leading-snug">
                        {(() => {
                          const pre = ruleText(c.courseId, 'PREREQ');
                          const co = ruleText(c.courseId, 'COREQ');
                          if (!pre && !co && c.minGrade == null) return <span className="text-slate-300">—</span>;
                          // یک خط با «نام» دروس (نه کد)؛ شرط‌های غیردرسی مثل «۴۷ واحد پاس‌کرده»
                          // و «حداقل ترم ۷» هم داخل همین متن می‌آیند. عرض ستون آزاد است.
                          return (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              {pre && <span className="text-rose-800" title={`پیش‌نیاز: ${pre}`}>پیش: {pre}</span>}
                              {co && <span className="text-indigo-800" title={`هم‌نیاز: ${co}`}>هم: {co}</span>}
                              {c.minGrade != null && <span className="text-indigo-700">کف نمره: {faNum(c.minGrade)}</span>}
                            </div>
                          );
                        })()}
                      </div>
                      {isDraft && (
                        <button
                          onClick={() => openRules(c.courseId)}
                          className="mt-1 px-2 py-1 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-900 font-extrabold text-3xs"
                        >
                          🔗 ویرایش
                        </button>
                      )}
                    </td>
                    <td className="p-2 border border-slate-200 text-center">
                      {isDraft && (
                        <button
                          onClick={() => handleRemoveCourse(c.courseId)}
                          className="px-2 py-1 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 font-extrabold text-3xs"
                        >
                          حذف
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* جمع‌بندی نوع درس — معادل «نمایش اطلاعات نوع درس» مدل قدیم (جمع ۲) */}
          {detail.courses.length > 0 && (
            <div className="pt-3 border-t border-slate-200 space-y-2">
              <h5 className="font-extrabold text-slate-900 text-xs">📊 جمع‌بندی نوع درس (ثبت‌شده در این نسخه)</h5>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs rt">
                  <thead>
                    <tr className="bg-slate-900 text-white text-center">
                      <th className="p-2.5 border border-slate-800">نوع درس</th>
                      <th className="p-2.5 border border-slate-800">تعداد درس (جمع ۲)</th>
                      <th className="p-2.5 border border-slate-800">مجموع واحد</th>
                      <th className="p-2.5 border border-slate-800" title="سهم واحد مقرر این نقش — در تب «بررسی و خاتمه» تنظیم می‌شود">سهم مقرر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typeSummary.map(r => {
                      const target = roleTargets[r.role];
                      const short = target != null && r.units < target;
                      return (
                        <tr key={r.role} className={`text-center ${short ? 'bg-amber-50' : ''}`}>
                          <td className="p-2 border border-slate-200 font-extrabold">{roleLabel(r.role)}</td>
                          <td className="p-2 border border-slate-200 font-black">{faNum(r.count)}</td>
                          <td className={`p-2 border border-slate-200 font-black ${short ? 'text-amber-700' : ''}`}>
                            {faNum(r.units)}{short && ` (کسری ${faNum(target - r.units)})`}
                          </td>
                          <td className="p-2 border border-slate-200 font-black text-slate-500">{target != null ? `${faNum(target)} واحد` : '—'}</td>
                        </tr>
                      );
                    })}
                    <tr className="text-center bg-indigo-50 font-black">
                      <td className="p-2 border border-indigo-200">جمع کل</td>
                      <td className="p-2 border border-indigo-200">{faNum(detail.courses.length)} درس</td>
                      <td className="p-2 border border-indigo-200">{faNum(totalPlannedUnits)} از {faNum(detail.version.totalRequiredUnits)} واحد الزامی</td>
                      <td className="p-2 border border-indigo-200">
                        {Object.keys(roleTargets).length > 0
                          ? `${faNum(Object.values(roleTargets).reduce((s, v) => s + v, 0))} واحد مقرر`
                          : 'تعیین‌نشده'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-3xs text-slate-400 font-bold">حداقل تعداد هر نقش (COURSE_TYPES_COMPLETE) و سهم واحد هر نقش (ROLE_UNITS_COVERAGE) در تب «بررسی و خاتمه» کنترل می‌شود.</p>
            </div>
          )}

          {/* Rules */}
          {(detail.rules.length > 0) && (
            <div className="pt-3 border-t border-slate-200 space-y-2">
              <h5 className="font-extrabold text-slate-900 text-xs">🔗 قواعد پیش‌نیاز / هم‌نیاز / نمرهٔ قبولی (از course_rules — درخت منطقی)</h5>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {detail.rules.map((r, i) => (
                  <div key={i} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-2xs">
                    <span className="font-black text-indigo-900">{courseCodeOf.get(r.courseId) ?? r.courseId}</span>
                    <span className="text-slate-400 mx-1">·</span>
                    <span className="font-bold text-slate-600">
                      {r.ruleType === 'PREREQ' ? 'پیش‌نیاز' : r.ruleType === 'COREQ' ? 'هم‌نیاز' : r.ruleType === 'PASSING_GRADE' ? 'نمرهٔ قبولی' : r.ruleType}
                    </span>
                    <div className="text-slate-700 font-bold mt-1">{describeLogicNode(r.logicTree, code => courseCodeOf.get(Number(code)) ?? code) || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Approvals */}
          {(detail.approvals.length > 0) && (
            <div className="pt-3 border-t border-slate-200 space-y-1.5">
              <h5 className="font-extrabold text-slate-900 text-xs">📜 تاریخچهٔ تأیید (append-only)</h5>
              {detail.approvals.map((a, i) => (
                <div key={a.id ?? i} className="flex items-center justify-between gap-2 bg-indigo-50/60 rounded-lg p-2 text-2xs">
                  <span className="font-bold text-slate-700">
                    {a.fromStatus} ← {a.toStatus} <span className="text-slate-400">({a.approvalType})</span>
                  </span>
                  <span className="text-slate-500">{faDate(a.approvedAt)}{a.decisionNote ? ` — ${a.decisionNote}` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
