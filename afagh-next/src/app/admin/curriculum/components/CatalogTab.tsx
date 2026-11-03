'use client';

// تب ۱: کاتالوگ نسخه‌های رشته (انتخاب/ایجاد/میان‌بری)
import { useCurriculum } from '../curriculum-context';
import { STATUS_UI, faNum } from '../curriculum-core';
import RoleTargetsCard from './RoleTargetsCard';

export default function CatalogTab() {
  const {
    activeTab,
    isDraft,
    majorVersions,
    openEditVersion,
    selectedVersionId,
    setSelectedVersionId,
  } = useCurriculum();

  return (
    <>
      {/* Versions Table — تب: تعریف کاتالوگ رشته */}
      {activeTab === 'CATALOG' && (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-slate-900 text-sm">🗂️ نسخه‌های این رشته</h3>
          <span className="text-2xs text-slate-500 font-bold">{isDraft ? 'حالت پیش‌نویس: ویرایش فعال' : 'حالت فقط‌خواندنی (بسته به وضعیت)'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs rt">
            <thead>
              <tr className="bg-slate-900 text-white text-center">
                <th className="p-2.5 border border-slate-800">کد نسخه</th>
                <th className="p-2.5 border border-slate-800">عنوان</th>
                <th className="p-2.5 border border-slate-800">ورودی</th>
                <th className="p-2.5 border border-slate-800">واحد الزامی</th>
                <th className="p-2.5 border border-slate-800">تعداد درس</th>
                <th className="p-2.5 border border-slate-800">وضعیت</th>
                <th className="p-2.5 border border-slate-800 w-28">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {majorVersions.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-slate-400 font-bold">هنوز نسخه‌ای برای این رشته ساخته نشده است.</td></tr>
              )}
              {majorVersions.map(v => {
                const st = STATUS_UI[v.status] ?? { label: v.status, cls: 'bg-slate-200 text-slate-800' };
                return (
                  <tr key={v.id} className={`text-center transition ${selectedVersionId === v.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                    <td className="p-2.5 border border-slate-200 font-mono font-black text-indigo-900">{v.versionCode}</td>
                    <td className="p-2.5 border border-slate-200 font-bold text-slate-800 text-right">{v.title}</td>
                    <td className="p-2.5 border border-slate-200">{faNum(v.entryYearFrom)}{v.entryYearTo ? `–${faNum(v.entryYearTo)}` : ' به بعد'}</td>
                    <td className="p-2.5 border border-slate-200 font-extrabold">{faNum(v.totalRequiredUnits)}</td>
                    <td className="p-2.5 border border-slate-200 font-extrabold">{faNum(v.courseCount)} درس</td>
                    <td className="p-2.5 border border-slate-200">
                      <span className={`px-2.5 py-0.5 rounded-full text-3xs font-black ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="p-2.5 border border-slate-200">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => setSelectedVersionId(v.id)}
                          className={`px-3 py-1.5 rounded-lg font-extrabold text-2xs transition ${
                            selectedVersionId === v.id ? 'bg-indigo-900 text-white' : 'bg-indigo-100 text-indigo-900 hover:bg-indigo-200'
                          }`}
                        >
                          {selectedVersionId === v.id ? 'باز است' : 'باز کردن'}
                        </button>
                        {v.status === 'DRAFT' ? (
                          <button
                            onClick={() => openEditVersion(v)}
                            title="ویرایش کد/عنوان/ورودی/واحد الزامی/سقف ترم"
                            className="px-3 py-1.5 rounded-lg font-extrabold text-2xs transition bg-amber-100 text-amber-900 hover:bg-amber-200"
                          >
                            ✏️ ویرایش
                          </button>
                        ) : (
                          <button
                            onClick={() => openEditVersion(v)}
                            title="پس از انتشار فقط «ورودی از/تا» قابل ویرایش است — برای تغییر محتوا نسخهٔ R+1 بسازید"
                            className="px-3 py-1.5 rounded-lg font-extrabold text-2xs transition bg-slate-100 text-slate-700 hover:bg-slate-200"
                          >
                            🗓️ ورودی
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}
      {/* سهم واحد هر نوع درس — همان‌جا که نسخه تعریف می‌شود (تب ۱) */}
      {activeTab === 'CATALOG' && <RoleTargetsCard />}
    </>
  );
}
