'use client';

// مودال: تعریف درس جدید در بانک از صفر
import { useCurriculum } from '../curriculum-context';
import { faNum } from '../curriculum-core';

export default function NewCourseModal() {
  const {
    bank,
    busy,
    depts,
    deptsLoading,
    handleCreateBankCourse,
    modal,
    newCourseForm,
    setModal,
    setNewCourseForm,
  } = useCurriculum();

  return (
    <>
      {/* ── Modal: New bank course (معرفی درس جدید از صفر) ── */}
      {modal === 'NEW_COURSE' && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-5 space-y-3">
            <h3 className="font-extrabold text-slate-900 text-sm">✨ معرفی درس جدید در بانک دروس</h3>
            <p className="text-2xs text-slate-500 font-bold leading-relaxed">
              درس از صفر در بانک سراسری تعریف می‌شود؛ پس از ثبت، همان‌جا برای افزودن به نسخه انتخاب می‌شود. پیش‌نیاز/هم‌نیاز هر درس در سطح کاتالوگ (تب «دروس کاتالوگ» ← قواعد) ثبت می‌گردد.
            </p>
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <label className="block font-bold text-slate-700">
                  شماره درس (کد) *:
                  <input value={newCourseForm.code} onChange={e => setNewCourseForm({ ...newCourseForm, code: e.target.value })}
                    placeholder="مثلاً 5122305" dir="ltr" className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-mono font-bold" />
                </label>
                <label className="block font-bold text-slate-700 col-span-2">
                  نام درس *:
                  <input value={newCourseForm.title} onChange={e => setNewCourseForm({ ...newCourseForm, title: e.target.value })}
                    placeholder="مثلاً یادگیری ماشین" className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold" />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block font-bold text-slate-700">
                  واحد نظری:
                  <input type="number" min={0} step="0.5" value={newCourseForm.theo} onChange={e => setNewCourseForm({ ...newCourseForm, theo: Number(e.target.value) })}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold" dir="ltr" />
                </label>
                <label className="block font-bold text-slate-700">
                  واحد عملی:
                  <input type="number" min={0} step="0.5" value={newCourseForm.prac} onChange={e => setNewCourseForm({ ...newCourseForm, prac: Number(e.target.value) })}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold" dir="ltr" />
                </label>
                <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-2 text-center">
                  <div className="text-3xs text-slate-500 font-bold">تعداد واحد</div>
                  <div className="font-black text-indigo-900 text-base">{faNum((Number(newCourseForm.theo) || 0) + (Number(newCourseForm.prac) || 0))}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block font-bold text-slate-700">
                  نوع درس:
                  <select value={newCourseForm.courseType} onChange={e => setNewCourseForm({ ...newCourseForm, courseType: e.target.value })}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold bg-white">
                    {['عمومی', 'پایه', 'تخصصی', 'اختیاری'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="block font-bold text-slate-700">
                  گروه آموزشی:
                  <select value={newCourseForm.departmentId} onChange={e => setNewCourseForm({ ...newCourseForm, departmentId: e.target.value })}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold bg-white">
                    <option value="">— عمومی / بدون گروه —</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block font-bold text-slate-700">
                  نمره‌دهی:
                  <select value={newCourseForm.grading} onChange={e => setNewCourseForm({ ...newCourseForm, grading: e.target.value })}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold bg-white">
                    <option value="NUMERIC">عددی</option>
                    <option value="PASS_FAIL">قبول / رد</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 pt-5">
                  <input type="checkbox" checked={newCourseForm.gpa} onChange={e => setNewCourseForm({ ...newCourseForm, gpa: e.target.checked })} className="size-4 accent-indigo-700" />
                  موثر بر معدل
                </label>
              </div>
              {deptsLoading && <p className="text-3xs text-slate-400 font-bold">در حال بارگیری گروه‌ها…</p>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className="px-4 py-1.5 rounded-lg bg-slate-200 text-slate-700 font-bold text-xs">انصراف</button>
              <button onClick={handleCreateBankCourse} disabled={busy || !newCourseForm.code.trim() || !newCourseForm.title.trim()} className="px-5 py-1.5 rounded-lg bg-indigo-700 text-white font-extrabold text-xs disabled:opacity-50">
                ثبت درس در بانک
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
