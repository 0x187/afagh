'use client';

// تب ۴: سربرگ چرخهٔ حیات + سهم واحد نقش‌ها + یافته‌های اعتبارسنجی
import { useCurriculum } from '../curriculum-context';
import { STATUS_UI, faNum } from '../curriculum-core';
import RoleTargetsCard from './RoleTargetsCard';

export default function VerifyTab() {
  const {
    activeTab,
    busy,
    detail,
    detailLoading,
    handleApprove,
    handleArchive,
    handleCreateRevision,
    handlePublish,
    handleSubmit,
    handleUpdateMaxUnits,
    handleValidate,
    isDraft,
    selectedVersion,
    setModal,
  } = useCurriculum();

  if (!selectedVersion) return null;

  return (
    <>
      {/* Detail header + transitions — تب: بررسی و خاتمه */}
      {activeTab === 'VERIFY' && (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-extrabold text-slate-900 text-base">📄 {selectedVersion.title}</h3>
              <span className={`px-2.5 py-0.5 rounded-full text-3xs font-black ${(STATUS_UI[selectedVersion.status] ?? { cls: 'bg-slate-200 text-slate-800' }).cls}`}>
                {(STATUS_UI[selectedVersion.status] ?? { label: selectedVersion.status }).label}
              </span>
              {isDraft && <span className="px-2 py-0.5 rounded-full text-3xs font-black bg-emerald-100 text-emerald-800">✏️ قابل ویرایش</span>}
            </div>
            <p className="text-2xs text-slate-500 mt-1">
              کد {selectedVersion.versionCode} · ورودی {faNum(selectedVersion.entryYearFrom)}{selectedVersion.entryYearTo ? ` تا ${faNum(selectedVersion.entryYearTo)}` : ' به بعد'}
              {' '}· واحد الزامی {faNum(selectedVersion.totalRequiredUnits)}
              {' '}· سقف ترم {isDraft ? (
                <span className="inline-flex items-center gap-1.5">
                  <input
                    type="number"
                    defaultValue={detail?.version.maxUnitsPerTerm ?? ''}
                    key={detail?.version.maxUnitsPerTerm ?? 'none'}
                    onBlur={e => { const v = Number(e.target.value); if (v && v !== detail?.version.maxUnitsPerTerm) handleUpdateMaxUnits(v); }}
                    className="w-16 border border-slate-300 rounded px-1.5 py-0.5 font-bold text-center"
                  />
                  <span className="text-3xs text-slate-400">واحد (Enter/Blur برای ذخیره)</span>
                </span>
              ) : `${faNum(detail?.version.maxUnitsPerTerm ?? '—')} واحد`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={handleValidate} disabled={busy} className="px-3 py-2 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-900 font-extrabold text-2xs disabled:opacity-50">
              🔍 اعتبارسنجی کامل
            </button>
            {selectedVersion.status === 'DRAFT' && (
              <button
                onClick={() => handleSubmit('')}
                disabled={busy}
                className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-2xs disabled:opacity-50"
              >
                📤 ارجاع به بازبینی (REVIEW)
              </button>
            )}
            {selectedVersion.status === 'REVIEW' && (
              <>
                <button onClick={() => handleApprove('')} disabled={busy} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-2xs disabled:opacity-50">
                  ✓ تأیید (APPROVED)
                </button>
                <button onClick={() => setModal('REJECT')} disabled={busy} className="px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-2xs disabled:opacity-50">
                  ✕ رد و بازگشت به پیش‌نویس
                </button>
              </>
            )}
            {selectedVersion.status === 'APPROVED' && (
              <button onClick={handlePublish} disabled={busy} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-2xs disabled:opacity-50">
                🚀 انتشار (PUBLISHED)
              </button>
            )}
            {selectedVersion.status === 'PUBLISHED' && (
              <button onClick={handleArchive} disabled={busy} className="px-3 py-2 rounded-lg bg-slate-600 hover:bg-slate-700 text-white font-extrabold text-2xs disabled:opacity-50">
                🗃️ بایگانی (ARCHIVED)
              </button>
            )}
            {(selectedVersion.status === 'APPROVED' || selectedVersion.status === 'PUBLISHED' || selectedVersion.status === 'ARCHIVED') && (
              <button onClick={handleCreateRevision} disabled={busy} className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-2xs disabled:opacity-50">
                🔁 ایجاد نسخهٔ جدید (R+1)
              </button>
            )}
          </div>
        </div>
        {detailLoading && <div className="text-center text-xs text-slate-400 font-bold py-4">در حال بارگذاری جزئیات از سرور…</div>}
      </div>
      )}

      {/* Role unit targets — تب: بررسی و خاتمه (همان کارت مشترک با تب کاتالوگ) */}
      {activeTab === 'VERIFY' && detail && <RoleTargetsCard showHint={false} />}

      {/* Checks — تب: بررسی و خاتمه */}
      {activeTab === 'VERIFY' && detail && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
          <h4 className="font-extrabold text-slate-900 text-sm">🧪 نتایج اعتبارسنجی (Validator — از موتور واقعی)</h4>
          {detail.checks.length === 0 && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center text-xs font-bold text-emerald-800">
              بدون یافته — برنامهٔ درسی سالم است. ✓
            </div>
          )}
          <div className="space-y-2">
            {detail.checks.map((c, i) => (
              <div
                key={i}
                className={`p-3 rounded-xl border text-xs space-y-1 ${
                  c.severity === 'ERROR' ? 'bg-rose-50 border-rose-300' : 'bg-amber-50 border-amber-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-black text-slate-900">
                    {c.severity === 'ERROR' ? '⛔' : '⚠️'} {c.check}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-3xs font-black shrink-0 ${
                    c.severity === 'ERROR' ? 'bg-rose-200 text-rose-900' : 'bg-amber-200 text-amber-900'
                  }`}>
                    {c.severity === 'ERROR' ? 'مانع تأیید' : 'هشدار'}
                  </span>
                </div>
                <p className="text-slate-700 leading-relaxed font-bold">{c.message}</p>
                {c.affected.length > 0 && (
                  <p className="text-3xs text-slate-500 font-mono">{c.affected.map(a => faNum(a)).join('، ')}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
