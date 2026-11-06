'use client';

// سربرگ نسخه + وضعیت، در همهٔ تب‌ها جز «بررسی و خاتمه»
import { useCurriculum } from '../curriculum-context';
import { STATUS_UI, faNum } from '../curriculum-core';

export default function DetailHeaderBar() {
  const {
    activeTab,
    busy,
    detail,
    handleCreateRevision,
    selectedVersion,
    totalPlannedUnits,
  } = useCurriculum();

  if (!selectedVersion) return null;

  return (
    <>
      {activeTab !== 'VERIFY' && (
        <div className="bg-indigo-900/95 text-white rounded-2xl shadow-sm border border-indigo-700/50 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-extrabold">📄 {selectedVersion.title}</span>
              <span className={`px-2.5 py-0.5 rounded-full text-3xs font-black ${(STATUS_UI[selectedVersion.status] ?? { cls: 'bg-slate-200 text-slate-800' }).cls}`}>
                {(STATUS_UI[selectedVersion.status] ?? { label: selectedVersion.status }).label}
              </span>
            </div>
            <p className="text-2xs text-indigo-200 mt-1 font-bold">
              کد {selectedVersion.versionCode} · ورودی {faNum(selectedVersion.entryYearFrom)}
              {' '}· واحد الزامی {faNum(selectedVersion.totalRequiredUnits)}
              {detail ? ` · ${faNum(detail.courses.length)} درس · مجموع ${faNum(totalPlannedUnits)} واحد` : ''}
              {detail?.version.maxUnitsPerTerm != null ? ` · سقف ترم ${faNum(detail.version.maxUnitsPerTerm)} واحد` : ''}
            </p>
          </div>
          <button
            onClick={handleCreateRevision}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-2xs disabled:opacity-50"
          >
            🔁 ایجاد نسخهٔ جدید (R+1)
          </button>
        </div>
      )}
    </>
  );
}
