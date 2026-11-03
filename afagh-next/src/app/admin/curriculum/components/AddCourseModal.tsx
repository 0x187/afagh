'use client';

// مودال: افزودن درس از بانک (تک‌ای و گروهی)
import { useCurriculum } from '../curriculum-context';
import { ROLE_LABELS, faNum } from '../curriculum-core';
import { roleFromBankType } from '@/lib/bank-roles';

export default function AddCourseModal() {
  const {
    addCourseForm,
    allFilteredSelected,
    bank,
    bankFiltered,
    bankLoading,
    bankQuery,
    bankSelected,
    bankShowAll,
    bankVisible,
    showMoreBank,
    busy,
    closeAddCourse,
    codePrefix,
    handleAddCourse,
    handleBulkAddCourses,
    modal,
    roleForBank,
    setAddCourseForm,
    setBank,
    setBankQuery,
    setBankRoles,
    setBankSelected,
    setBulkRoleType,
    setCodePrefix,
    toggleSelectAllBank,
  } = useCurriculum();

  return (
    <>
      {/* ── Modal: Add course from bank ── */}
      {modal === 'ADD_COURSE' && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl p-5 space-y-3">
            <h3 className="font-extrabold text-slate-900 text-sm">➕ افزودن درس از بانک دروس</h3>
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <label className="block font-bold text-slate-700">
                  جستجو (کد یا عنوان):
                  <input
                    value={bankQuery}
                    onChange={e => setBankQuery(e.target.value)}
                    placeholder="مثلاً ریاضی یا 101…"
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold"
                  />
                </label>
                <label className="block font-bold text-slate-700">
                  پیشوند کد رشته (مثل 99):
                  <div className="mt-1 flex gap-2">
                    <input
                      value={codePrefix}
                      onChange={e => setCodePrefix(e.target.value)}
                      placeholder="مثلاً 99…"
                      dir="ltr"
                      className="w-full border border-slate-300 rounded-lg p-2 font-bold font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => { setBank([]); }}
                      className="px-3 rounded-lg bg-indigo-100 text-indigo-900 font-extrabold text-3xs shrink-0"
                    >
                      {bankLoading ? '…' : 'به‌روزرسانی'}
                    </button>
                  </div>
                </label>
              </div>
              {bank.length > 0 && (
                <>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-indigo-50/70 border border-indigo-100 px-2.5 py-1.5">
                    <label className="flex items-center gap-2 font-black text-indigo-900 cursor-pointer text-2xs">
                      <input
                        type="checkbox"
                        className="accent-indigo-700 w-4 h-4"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllBank}
                      />
                      انتخاب همهٔ نمایش‌داده‌شده ({faNum(bankVisible.length)} درس)
                    </label>
                    <span className="text-3xs font-black text-indigo-700">{faNum(bankSelected.size)} انتخاب شد</span>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                    {bankVisible.map(b => (
                      <div key={b.id} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-indigo-50 text-2xs font-bold">
                        <input
                          type="checkbox"
                          className="accent-indigo-700 w-3.5 h-3.5 shrink-0"
                          checked={bankSelected.has(b.id)}
                          onChange={e => {
                            const next = new Set(bankSelected);
                            if (e.target.checked) {
                              next.add(b.id);
                              setAddCourseForm(f => ({ ...f, courseId: String(b.id) }));
                              setBankRoles(prev => (b.id in prev ? prev : { ...prev, [b.id]: roleFromBankType(b.courseType) }));
                            } else {
                              next.delete(b.id);
                              setBankRoles(prev => { const nx = { ...prev }; delete nx[b.id]; return nx; });
                            }
                            setBankSelected(next);
                          }}
                        />
                        <span className="font-mono text-indigo-900 shrink-0">{b.code}</span>
                        <span className="truncate flex-1">{b.title}</span>
                        <span className="text-slate-400 shrink-0">({faNum(b.units)} واحد)</span>
                        <select
                          value={roleForBank(b)}
                          onChange={e => setBankRoles(prev => ({ ...prev, [b.id]: e.target.value }))}
                          title={`نوع بانک: ${b.courseType}`}
                          className="border border-slate-300 rounded px-1 py-0.5 font-bold text-3xs bg-white shrink-0"
                        >
                          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}{roleFromBankType(b.courseType) === k ? ' •' : ''}</option>)}
                        </select>
                      </div>
                    ))}
                    {bankFiltered.length > bankVisible.length && (
                      <div className="px-2.5 py-1.5 text-3xs text-slate-400 font-bold text-center space-y-1">
                        <div>… و {faNum(bankFiltered.length - bankVisible.length)} مورد دیگر</div>
                        <button
                          type="button"
                          onClick={showMoreBank}
                          className="px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-900 font-extrabold text-3xs hover:bg-indigo-200"
                        >
                          نمایش همهٔ {faNum(bankFiltered.length)} مورد
                        </button>
                      </div>
                    )}
                    {bankShowAll && bankFiltered.length > 0 && (
                      <div className="px-2.5 py-1.5 text-3xs text-emerald-700 font-bold text-center">
                        همهٔ {faNum(bankFiltered.length)} مورد نمایش داده شد.
                      </div>
                    )}
                  </div>
                </>
              )}
              <label className="block font-bold text-slate-700">
                نقش دروس منتخب (اعمال به همه):
                <select value={addCourseForm.roleType} onChange={e => {
                    const v = e.target.value;
                    setAddCourseForm({ ...addCourseForm, roleType: v });
                    setBulkRoleType(v);
                    setBankRoles(prev => { const next = { ...prev }; bankSelected.forEach(id => { next[id] = v; }); return next; });
                  }}
                  className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold bg-white">
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <p className="text-2xs text-slate-500 font-bold leading-relaxed">
                نوع هر ردیف به‌صورت پیش‌فرض از بانک خوانده می‌شود (•) و تکی قابل تغییر است. دروس بدون ترم افزوده می‌شوند؛ ترم‌بندی در مرحلهٔ بعد — تب «📅 ترم‌بندی چارت».
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={closeAddCourse} className="px-4 py-1.5 rounded-lg bg-slate-200 text-slate-700 font-bold text-xs">انصراف</button>
              <button onClick={handleAddCourse} disabled={busy || !addCourseForm.courseId} className="px-3 py-1.5 rounded-lg bg-indigo-100 text-indigo-900 font-extrabold text-xs disabled:opacity-50">
                افزودن انتخابی
              </button>
              <button onClick={handleBulkAddCourses} disabled={busy || bankSelected.size === 0} className="px-5 py-1.5 rounded-lg bg-emerald-700 text-white font-extrabold text-xs disabled:opacity-50">
                افزودن {bankSelected.size > 0 ? faNum(bankSelected.size) : ''} درس منتخب
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
