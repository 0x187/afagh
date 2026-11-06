'use client';

// مودال: ایجاد نسخهٔ جدید (با کپی عمیق از نسخهٔ دیگر)
import { useCurriculum } from '../curriculum-context';
import { STATUS_UI } from '../curriculum-core';

export default function NewVersionModal() {
  const {
    busy,
    handleCreateVersion,
    majors,
    modal,
    newVersionForm,
    selectedMajorId,
    selectedVersionId,
    setModal,
    setNewVersionForm,
    versions,
  } = useCurriculum();

  return (
    <>
      {/* ── Modal: New version ── */}
      {modal === 'NEW_VERSION' && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-5 space-y-3">
            <h3 className="font-extrabold text-slate-900 text-sm">➕ ایجاد نسخهٔ جدید برای «{majors.find(m => m.id === selectedMajorId)?.name}»</h3>
            <div className="space-y-2 text-xs">
              <label className="block font-bold text-slate-700">
                کد نسخه (مثل ۱۴۰۴ یا ۱۴۰۴-R1):
                <input value={newVersionForm.versionCode} onChange={e => setNewVersionForm({ ...newVersionForm, versionCode: e.target.value })}
                  placeholder="1405-R1" className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-mono font-bold" />
              </label>
              <label className="block font-bold text-slate-700">
                عنوان:
                <input value={newVersionForm.title} onChange={e => setNewVersionForm({ ...newVersionForm, title: e.target.value })}
                  placeholder="برنامهٔ …" className="mt-1 w-full border border-slate-300 rounded-lg p-2" />
              </label>
              <label className="block font-bold text-slate-700">
                کپی عمیق از نسخهٔ دیگر (انتقال کاتالوگ — دروس + پیش‌نیازها + ترم‌بندی + نمره‌ها):
                <select
                  value={newVersionForm.cloneFromId}
                  onChange={e => setNewVersionForm({ ...newVersionForm, cloneFromId: e.target.value })}
                  className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold bg-white"
                >
                  <option value="">بدون کپی (نسخهٔ خالی)</option>
                  {versions.filter(v => v.id !== selectedVersionId).map(v => (
                    <option key={v.id} value={v.id}>
                      {v.versionCode} — {v.title} ({STATUS_UI[v.status]?.label ?? v.status})
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <label className="block font-bold text-slate-700">
                  ورودی از:
                  <input type="number" value={newVersionForm.entryYearFrom} onChange={e => setNewVersionForm({ ...newVersionForm, entryYearFrom: Number(e.target.value) })}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2" />
                </label>
                <label className="block font-bold text-slate-700">
                  ورودی تا:
                  <input type="number" placeholder="خالی = به بعد" value={newVersionForm.entryYearTo}
                    onChange={e => setNewVersionForm({ ...newVersionForm, entryYearTo: e.target.value })}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2" />
                </label>
                <label className="block font-bold text-slate-700">
                  کل واحد:
                  <input type="number" value={newVersionForm.totalRequiredUnits} onChange={e => setNewVersionForm({ ...newVersionForm, totalRequiredUnits: Number(e.target.value) })}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2" />
                </label>
                <label className="block font-bold text-slate-700">
                  سقف ترم:
                  <input type="number" value={newVersionForm.maxUnitsPerTerm} onChange={e => setNewVersionForm({ ...newVersionForm, maxUnitsPerTerm: Number(e.target.value) })}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2" />
                </label>
              </div>
              <p className="text-3xs text-slate-400 font-bold">
                «ورودی تا» را خالی بگذارید اگر کاتالوگ برای همهٔ ورودی‌های بعد از «ورودی از» معتبر است (کاتالوگی که سال‌ها تغییر نمی‌کند).
              </p>
              <p className="text-3xs text-slate-400 font-bold">
                (کپی عمیق از نسخهٔ مرجع = از دکمهٔ «ایجاد نسخهٔ جدید R+1» روی همان نسخه استفاده کنید)
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className="px-4 py-1.5 rounded-lg bg-slate-200 text-slate-700 font-bold text-xs">انصراف</button>
              <button onClick={handleCreateVersion} disabled={busy} className="px-5 py-1.5 rounded-lg bg-emerald-700 text-white font-extrabold text-xs disabled:opacity-50">
                ایجاد نسخه
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
