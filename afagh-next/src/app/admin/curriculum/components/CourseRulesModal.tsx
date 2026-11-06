'use client';

// مودال: پیش‌نیاز/هم‌نیاز و کف نمرهٔ یک درس
import { useMemo, useState } from 'react';
import { useCurriculum } from '../curriculum-context';
import { faNum, leafCourseCodesOf, leafTotalOf, compareCourseCode } from '../curriculum-core';
import { GRADE_STATUS_CODES, gradeStatusOptionLabel } from '@/lib/grade-status-codes';
import type { CourseRow } from '../types';

/**
 * انتخابگر درس با تایپ‌کردن (autocomplete) — جای فهرست بلندِ چک‌باکسی.
 * تایپ می‌کنید، فهرست زنده فیلتر می‌شود (کد یا نام)، کلیک/Enter انتخاب می‌کند.
 * دروس انتخاب‌شده به‌صورت چیپ بالای کادر می‌آیند (بر اساس کد مرتب).
 */
function CoursePicker({
  courses,
  selected,
  excludeId,
  onToggle,
  placeholder,
  tone,
}: {
  courses: CourseRow[];
  selected: string[];
  excludeId: number;
  onToggle: (code: string) => void;
  placeholder: string;
  tone: 'rose' | 'indigo';
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();

  const matches = useMemo(() => {
    const pool = courses.filter((c) => c.courseId !== excludeId);
    const hit = needle
      ? pool.filter((c) => c.code.toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle))
      : pool;
    // مرتب‌سازی بر اساس کد + سقف ۶۰ ردیف تا فهرست سنگین نشود
    return [...hit].sort((a, b) => compareCourseCode(a.code, b.code)).slice(0, 60);
  }, [courses, excludeId, needle]);

  const chipCls = tone === 'rose'
    ? 'bg-rose-100 text-rose-900 border-rose-200'
    : 'bg-indigo-100 text-indigo-900 border-indigo-200';
  const rowSelCls = tone === 'rose' ? 'bg-rose-50' : 'bg-indigo-50';

  return (
    <div className="space-y-1.5">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {[...selected].sort(compareCourseCode).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => onToggle(code)}
              title="حذف از انتخاب"
              className={`rounded-full border px-2 py-0.5 text-3xs font-extrabold ${chipCls}`}
            >
              {courses.find((c) => c.code === code)?.title ?? code} ✕
            </button>
          ))}
        </div>
      )}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches.length > 0) {
            e.preventDefault();
            onToggle(matches[0].code);
            setQ('');
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-2xs font-bold outline-none focus:border-indigo-500"
      />
      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
        {matches.length === 0 && (
          <div className="px-2.5 py-2 text-2xs font-bold text-slate-400">درسی با این عبارت یافت نشد.</div>
        )}
        {matches.map((c) => {
          const on = selected.includes(c.code);
          return (
            <button
              key={c.courseId}
              type="button"
              onClick={() => onToggle(c.code)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-right hover:bg-slate-50 text-2xs font-bold ${on ? rowSelCls : ''}`}
            >
              <span className={`w-3.5 h-3.5 shrink-0 rounded border ${on ? 'bg-indigo-700 border-indigo-700 text-white' : 'border-slate-300'} text-[9px] leading-3 text-center`}>
                {on ? '✓' : ''}
              </span>
              <span className="font-mono text-indigo-900 shrink-0">{c.code}</span>
              <span className="truncate">{c.title}</span>
            </button>
          );
        })}
      </div>
      <p className="text-3xs font-bold text-slate-400">
        {faNum(matches.length)} گزینه{needle ? ' مطابق جست‌وجو' : ''} — با Enter اولین مورد انتخاب/حذف می‌شود.
      </p>
    </div>
  );
}

export default function CourseRulesModal() {
  const {
    busy,
    detail,
    handleSaveRules,
    modal,
    ruleCourse,
    ruleForm,
    setModal,
    setRuleCourseId,
    setRuleForm,
    toggleRuleCode,
  } = useCurriculum();

  const versionCourses = detail?.courses ?? [];

  return (
    <>
{/* ── Modal: Rules (پیش‌نیاز / هم‌نیاز درس) ── */}
      {modal === 'RULES' && ruleCourse && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-5 space-y-3 max-h-[92vh] overflow-y-auto">
            <h3 className="font-extrabold text-slate-900 text-sm">🔗 پیش‌نیاز / هم‌نیاز — {ruleCourse.code} · {ruleCourse.title}</h3>
            <p className="text-2xs text-slate-500 font-bold leading-relaxed">
              فقط از دروس همین نسخه می‌توان انتخاب کرد (کد نامعتبر و خودارجاعی ممکن نیست). برای پیدا کردن سریع، کد یا بخشی از نام درس را تایپ کنید.
              خالی گذاشتن یک گروه + «ثبت» = حذف آن قاعده. نتیجه بلافاصله در تب «بررسی و خاتمه» اعتبارسنجی می‌شود (تشخیص دور و مغایرت ترمی).
            </p>
            {(() => {
              const trees = (detail?.rules ?? []).filter(r => r.courseId === ruleCourse.courseId && (r.ruleType === 'PREREQ' || r.ruleType === 'COREQ'));
              const complex = trees.some(t => leafTotalOf(t.logicTree) !== leafCourseCodesOf(t.logicTree).length);
              if (!complex) return null;
              return <p className="text-2xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">⚠️ قاعدهٔ فعلی این درس شرط ترکیبی/واحدی دارد؛ با «ثبت»، کل درخت با انتخاب‌های زیر جایگزین می‌شود.</p>;
            })()}
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-black text-xs text-slate-800">پیش‌نیازها (باید قبلاً گذرانده شود)</span>
                <select value={ruleForm.preOp} onChange={e => setRuleForm({ ...ruleForm, preOp: e.target.value === 'OR' ? 'OR' : 'AND' })}
                  className="border border-slate-300 rounded-lg px-2 py-1 font-bold text-2xs bg-white">
                  <option value="AND">همه (AND)</option>
                  <option value="OR">یکی (OR)</option>
                </select>
              </div>
              <CoursePicker
                courses={versionCourses}
                selected={ruleForm.pre}
                excludeId={ruleCourse.courseId}
                onToggle={(code) => toggleRuleCode('pre', code)}
                placeholder="🔍 کد یا نام درس پیش‌نیاز را تایپ کنید…"
                tone="rose"
              />
              {ruleForm.pre.length > 0 && <p className="text-3xs font-black text-rose-700">{faNum(ruleForm.pre.length)} درس به‌عنوان پیش‌نیاز انتخاب شد.</p>}
            </div>

            {/* شرط‌های غیردرسی — همان ستون‌های «واحد گذراندهٔ لازم» و «ترم لازم» جدول دروس قدیم */}
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <p className="font-black text-xs text-slate-800">شرط‌های غیردرسی (اختیاری)</p>
              <p className="text-2xs text-slate-500 font-bold leading-relaxed">
                بعضی دروس به‌جای (یا علاوه بر) درسِ مشخص، شرط عددی دارند: «۴۷ واحد پاس‌کرده باشی» یا «حداقل ترم ۷ باشی».
                این دو مقدار به‌صورت AND با پیش‌نیازهای بالا ذخیره و در انتخاب واحد بررسی می‌شوند.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="block font-bold text-slate-700 text-2xs">
                  واحد گذراندهٔ لازم:
                  <input
                    type="number" min={0} step="1" dir="ltr"
                    value={ruleForm.minUnits}
                    onChange={e => setRuleForm({ ...ruleForm, minUnits: e.target.value })}
                    placeholder="مثلاً 47"
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold"
                  />
                </label>
                <label className="block font-bold text-slate-700 text-2xs">
                  حداقل ترم لازم:
                  <input
                    type="number" min={1} max={20} step="1" dir="ltr"
                    value={ruleForm.minTerm}
                    onChange={e => setRuleForm({ ...ruleForm, minTerm: e.target.value })}
                    placeholder="مثلاً 7"
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-black text-xs text-slate-800">هم‌نیازها (باید هم‌زمان اخذ شود)</span>
                <select value={ruleForm.coOp} onChange={e => setRuleForm({ ...ruleForm, coOp: e.target.value === 'OR' ? 'OR' : 'AND' })}
                  className="border border-slate-300 rounded-lg px-2 py-1 font-bold text-2xs bg-white">
                  <option value="AND">همه (AND)</option>
                  <option value="OR">یکی (OR)</option>
                </select>
              </div>
              <CoursePicker
                courses={versionCourses}
                selected={ruleForm.co}
                excludeId={ruleCourse.courseId}
                onToggle={(code) => toggleRuleCode('co', code)}
                placeholder="🔍 کد یا نام درس هم‌نیاز را تایپ کنید…"
                tone="indigo"
              />
              {ruleForm.co.length > 0 && <p className="text-3xs font-black text-indigo-700">{faNum(ruleForm.co.length)} درس به‌عنوان هم‌نیاز انتخاب شد.</p>}
            </div>
            <div className="rounded-xl border border-slate-200 p-3 space-y-1.5">
              <label className="block font-bold text-xs text-slate-800">
                کف نمره قبولی این درس در این نسخه (۰ تا ۲۰) — خالی = بدون کف خاص:
                <input type="number" min={0} max={20} step="0.5" value={ruleForm.minGrade}
                  onChange={e => setRuleForm({ ...ruleForm, minGrade: e.target.value })}
                  placeholder="مثلاً ۱۲" dir="ltr"
                  className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold" />
              </label>
            </div>
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <p className="text-2xs text-slate-500 font-bold leading-relaxed">
                کد وضع نمرهٔ سما (میز تطبیق GRADE_STATUS) که هنگام قبولی/مردودیِ دانشجو در همین درس
                ثبت می‌شود. چون همین درس ممکن است در کاتالوگ دیگری «جبرانی» ارائه شود، این تنظیم
                فقط مخصوص همین نسخه است، نه سراسری. خالی = پیش‌فرض سیستم (کد ۱ قبولی / ۲ مردودی).
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="block font-bold text-slate-700 text-2xs">
                  کد وضع در صورت قبولی:
                  <select value={ruleForm.passGradeStatusCode}
                    onChange={e => setRuleForm({ ...ruleForm, passGradeStatusCode: e.target.value })}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold bg-white">
                    <option value="">پیش‌فرض سیستم (کد ۱)</option>
                    {GRADE_STATUS_CODES.filter(g => g.passed).map(g => (
                      <option key={g.code} value={g.code}>{gradeStatusOptionLabel(g)}</option>
                    ))}
                  </select>
                </label>
                <label className="block font-bold text-slate-700 text-2xs">
                  کد وضع در صورت مردودی:
                  <select value={ruleForm.failGradeStatusCode}
                    onChange={e => setRuleForm({ ...ruleForm, failGradeStatusCode: e.target.value })}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold bg-white">
                    <option value="">پیش‌فرض سیستم (کد ۲)</option>
                    {GRADE_STATUS_CODES.filter(g => !g.passed).map(g => (
                      <option key={g.code} value={g.code}>{gradeStatusOptionLabel(g)}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => { setModal(null); setRuleCourseId(null); }} className="px-4 py-1.5 rounded-lg bg-slate-200 text-slate-700 font-bold text-xs">انصراف</button>
              <button onClick={handleSaveRules} disabled={busy} className="px-5 py-1.5 rounded-lg bg-indigo-700 text-white font-extrabold text-xs disabled:opacity-50">
                ثبت قواعد
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
