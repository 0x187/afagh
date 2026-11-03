'use client';

// مودال: ویرایش مشخصات نسخهٔ پیش‌نویس (کد/عنوان/ورودی/واحد الزامی/سقف ترم)
// + مدیریت دروس همان نسخه (حذف تخصیص / افزودن از بانک) — بدون خروج از مودال
import { useCurriculum } from '../curriculum-context';
import { ROLE_LABELS, STATUS_UI, faNum } from '../curriculum-core';
import { roleFromBankType } from '@/lib/bank-roles';

export default function EditVersionModal() {
  const {
    bankFiltered,
    bankLoading,
    bankQuery,
    bankSelected,
    bankVisible,
    busy,
    codePrefix,
    detail,
    editVersionForm,
    editVersionId,
    handleBulkAddCoursesKeepOpen,
    handleRemoveCourse,
    handleUpdateVersion,
    isDraft,
    majorVersions,
    modal,
    roleForBank,
    setAddCourseForm,
    setBank,
    setBankQuery,
    setBankRoles,
    setBankSelected,
    setCodePrefix,
    setEditVersionForm,
    setModal,
  } = useCurriculum();

  const courses = detail && detail.version.id === editVersionId ? detail.courses : null;
  // پس از انتشار فقط «ورودی از/تا» قابل ویرایش است (بقیهٔ محتوا فقط با نسخهٔ R+1)
  const editingVersion = (majorVersions ?? []).find((v) => v.id === editVersionId);
  const entryOnly = editingVersion ? editingVersion.status !== 'DRAFT' : !isDraft;
  const lockedCls = entryOnly ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : '';

  return (
    <>
      {modal === 'EDIT_VERSION' && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-extrabold text-slate-900 text-sm">
              {entryOnly ? '🗓️ پنجرهٔ ورودی نسخه' : '✏️ ویرایش مشخصات نسخه (فقط پیش‌نویس)'}
            </h3>
            {entryOnly && (
              <p className="text-2xs font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2 leading-relaxed">
                این نسخه «{(STATUS_UI[editingVersion?.status ?? ''] ?? { label: editingVersion?.status ?? '' }).label}» است؛
                فقط «ورودی از/تا» قابل تغییر است. علتش این است که اگر «ورودی تا» نامشخص بماند و بعد چارت جدید بیاید،
                دو نسخه روی یک ورودی منطبق می‌شوند و نیم‌سال‌ها تداخل می‌کنند. برای تغییر کد/عنوان/واحدها یا دروس،
                «🔁 ایجاد نسخهٔ جدید (R+1)» را بزنید.
              </p>
            )}
            <div className="space-y-2 text-xs">
              <label className="block font-bold text-slate-700">
                کد نسخه:
                <input value={editVersionForm.versionCode} disabled={entryOnly} onChange={e => setEditVersionForm({ ...editVersionForm, versionCode: e.target.value })}
                  className={`mt-1 w-full border border-slate-300 rounded-lg p-2 font-mono font-bold ${lockedCls}`} />
              </label>
              <label className="block font-bold text-slate-700">
                عنوان:
                <input value={editVersionForm.title} disabled={entryOnly} onChange={e => setEditVersionForm({ ...editVersionForm, title: e.target.value })}
                  className={`mt-1 w-full border border-slate-300 rounded-lg p-2 ${lockedCls}`} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block font-bold text-slate-700">
                  ورودی از:
                  <input type="number" value={editVersionForm.entryYearFrom} onChange={e => setEditVersionForm({ ...editVersionForm, entryYearFrom: Number(e.target.value) })}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2" />
                </label>
                <label className="block font-bold text-slate-700">
                  ورودی تا (خالی = به بعد):
                  <input value={editVersionForm.entryYearTo} onChange={e => setEditVersionForm({ ...editVersionForm, entryYearTo: e.target.value })}
                    placeholder="مثلاً ۱۴۰۸" className="mt-1 w-full border border-slate-300 rounded-lg p-2" />
                </label>
                <label className="block font-bold text-slate-700">
                  کل واحد الزامی:
                  <input type="number" value={editVersionForm.totalRequiredUnits} disabled={entryOnly} onChange={e => setEditVersionForm({ ...editVersionForm, totalRequiredUnits: Number(e.target.value) })}
                    className={`mt-1 w-full border border-slate-300 rounded-lg p-2 ${lockedCls}`} />
                </label>
                <label className="block font-bold text-slate-700">
                  سقف واحد ترم:
                  <input type="number" value={editVersionForm.maxUnitsPerTerm} disabled={entryOnly} onChange={e => setEditVersionForm({ ...editVersionForm, maxUnitsPerTerm: Number(e.target.value) })}
                    className={`mt-1 w-full border border-slate-300 rounded-lg p-2 ${lockedCls}`} />
                </label>
              </div>
            </div>

            {/* ── دروس این نسخه ── */}
            <div className="border-t border-slate-200 pt-3 space-y-2">
              <h4 className="font-extrabold text-slate-900 text-xs">
                📖 دروس این نسخه{courses ? ` (${faNum(courses.length)} درس)` : ' — در حال بارگذاری…'}
              </h4>
              {courses && courses.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {courses.map(c => (
                    <div key={c.courseId} className="flex items-center gap-2 px-2.5 py-1.5 text-2xs font-bold hover:bg-slate-50">
                      <span className="font-mono text-indigo-900 shrink-0">{c.code}</span>
                      <span className="truncate flex-1">{c.title}</span>
                      <span className="text-slate-400 shrink-0">({faNum(c.units)} واحد)</span>
                      {isDraft && (
                        <button
                          onClick={() => handleRemoveCourse(c.courseId)}
                          disabled={busy}
                          title="برداشتن تخصیص این درس از نسخه"
                          className="rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 px-2 py-0.5 font-extrabold text-3xs disabled:opacity-50 shrink-0"
                        >
                          ❌ برداشتن
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {courses && courses.length === 0 && (
                <p className="text-2xs text-slate-400 font-bold">هنوز درسی به این نسخه تخصیص نیافته است.</p>
              )}

              {isDraft && (
                <div className="space-y-2 rounded-xl bg-emerald-50/60 border border-emerald-100 p-2.5">
                  <div className="font-extrabold text-emerald-900 text-2xs">➕ افزودن درس از بانک</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={bankQuery}
                      onChange={e => setBankQuery(e.target.value)}
                      placeholder="جستجو (کد یا عنوان)…"
                      className="border border-slate-300 rounded-lg p-2 font-bold text-xs bg-white"
                    />
                    <div className="flex gap-2">
                      <input
                        value={codePrefix}
                        onChange={e => setCodePrefix(e.target.value)}
                        placeholder="پیشوند کد…"
                        dir="ltr"
                        className="w-full border border-slate-300 rounded-lg p-2 font-bold font-mono text-xs bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => { setBank([]); }}
                        className="px-3 rounded-lg bg-indigo-100 text-indigo-900 font-extrabold text-3xs shrink-0"
                      >
                        {bankLoading ? '…' : 'به‌روزرسانی'}
                      </button>
                    </div>
                  </div>
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
                    {bankVisible.map(b => (
                      <div key={b.id} className="flex items-center gap-2 px-2.5 py-1.5 text-2xs font-bold hover:bg-emerald-50">
                        <input
                          type="checkbox"
                          className="accent-emerald-700 w-3.5 h-3.5 shrink-0"
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
                        <select
                          value={roleForBank(b)}
                          onChange={e => setBankRoles(prev => ({ ...prev, [b.id]: e.target.value }))}
                          className="border border-slate-300 rounded px-1 py-0.5 font-bold text-3xs bg-white shrink-0"
                        >
                          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </div>
                    ))}
                    {bankFiltered.length > bankVisible.length && (
                      <div className="px-2.5 py-1.5 text-3xs text-slate-400 font-bold text-center">
                        … و {faNum(bankFiltered.length - bankVisible.length)} مورد دیگر — فیلتر را دقیق‌تر کنید
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={handleBulkAddCoursesKeepOpen}
                      disabled={busy || bankSelected.size === 0}
                      className="px-4 py-1.5 rounded-lg bg-emerald-700 text-white font-extrabold text-xs disabled:opacity-50"
                    >
                    گذاشتن {bankSelected.size > 0 ? faNum(bankSelected.size) : ''} درس منتخب در نسخه
                    </button>
                  </div>
                </div>
              )}
            </div>

            <p className="text-3xs text-slate-400 font-bold">
              سهم واحد هر نقش از تب «بررسی و خاتمه» تنظیم می‌شود؛ پس از ذخیره، اعتبارسنجی را دوباره اجرا کنید.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setModal(null)} className="px-4 py-1.5 rounded-lg bg-slate-200 text-slate-700 font-bold text-xs">انصراف</button>
              <button onClick={handleUpdateVersion} disabled={busy} className="px-5 py-1.5 rounded-lg bg-indigo-700 text-white font-extrabold text-xs disabled:opacity-50">
                ذخیره تغییرات
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
