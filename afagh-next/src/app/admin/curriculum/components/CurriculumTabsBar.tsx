'use client';

// نوار ۵ تب + برچسب نسخهٔ فعال
import { useCurriculum } from '../curriculum-context';
import { STATUS_UI, TABS } from '../curriculum-core';

export default function CurriculumTabsBar() {
  const {
    activeTab,
    selectedVersion,
    setActiveTab,
  } = useCurriculum();

  return (
    <>
      <div className="bg-slate-200/80 rounded-2xl p-1.5 flex flex-wrap items-center gap-1.5 text-xs font-bold">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-xl transition-all whitespace-nowrap ${
              activeTab === t.key
                ? 'bg-indigo-900 text-white shadow-md'
                : 'bg-white text-slate-600 hover:bg-indigo-100 hover:text-indigo-900'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
        {selectedVersion && (
          <span className="mr-auto px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-800 text-2xs font-black">
            نسخهٔ فعال: {selectedVersion.versionCode} — {(STATUS_UI[selectedVersion.status] ?? { label: selectedVersion.status }).label}
          </span>
        )}
      </div>
    </>
  );
}
