'use client';

// تب ۵: انتقال/کپی کاتالوگ به رشتهٔ دیگر
import { useCurriculum } from '../curriculum-context';

export default function TransferTab() {
  const {
    activeTab,
    busy,
    handleCreateRevision,
    handleTransferToMajor,
    majors,
    selectedMajorId,
    selectedVersion,
    setTransferEntryTermId,
    setTransferMajorId,
    terms,
    transferEntryTermId,
    transferMajorId,
  } = useCurriculum();

  if (!selectedVersion) return null;

  return (
    <>
      {/* انتقال کاتالوگ — تب: انتقال کاتالوگ */}
      {activeTab === 'TRANSFER' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
          <h4 className="font-extrabold text-slate-900 text-sm">🔄 انتقال / کپی عمیق کاتالوگ «{selectedVersion.versionCode}»</h4>
          <p className="text-2xs text-slate-500 font-bold leading-relaxed">
            کپی عمیق = کل چارت (دروس + پیشنیازها + همنیازها + ترمبندی + نمرهها + سقف واحد) به یک نسخهٔ جدید منتقل میشود؛ هیچ دادهٔ مشترکی بین دو نسخه باقی نمیماند.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <span className="font-black text-xs text-slate-800">1️⃣ نسخهٔ جدید (R+1) از همین نسخه</span>
              <p className="text-2xs text-slate-500 font-bold">مناسب اصلاحات پس از انتشار/تأیید — نسخههای نهایی هرگز درجا ویرایش نمیشوند.</p>
              <button
                onClick={handleCreateRevision}
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs disabled:opacity-50"
              >
                🔁 ایجاد نسخهٔ جدید R+1
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <span className="font-black text-xs text-slate-800">2️⃣ کپی به رشتهٔ دیگر (انتقال چارت)</span>
              <p className="text-2xs text-slate-500 font-bold">همان کاتالوگ به یک رشتهٔ مقصد کپی میشود (نسخهٔ DRAFT در مقصد).</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex-1 min-w-40 text-2xs font-bold text-slate-600">
                  رشتهٔ مقصد:
                  <select
                    value={transferMajorId || selectedMajorId}
                    onChange={e => setTransferMajorId(Number(e.target.value))}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold bg-white text-xs"
                  >
                    {majors.map(m => (
                      <option key={m.id} value={m.id}>{m.name}{m.degreeTitle ? ` — ${m.degreeTitle}` : ''}</option>
                    ))}
                  </select>
                </label>
                {/* نیم‌سال ورودی نسخهٔ مقصد — بدون آن، نسخهٔ کپی‌شده روی «همه نیم‌سال‌ها»
                    می‌افتد و با چارت‌های دیگر تداخل می‌کند */}
                <label className="flex-1 min-w-40 text-2xs font-bold text-slate-600">
                  نیم‌سال ورودی (اختیاری):
                  <select
                    value={transferEntryTermId || 0}
                    onChange={e => setTransferEntryTermId(Number(e.target.value))}
                    className="mt-1 w-full border border-slate-300 rounded-lg p-2 font-bold bg-white text-xs"
                  >
                    <option value={0}>همه نیم‌سال‌ها (تعیین‌نشده)</option>
                    {terms.map(t => (
                      <option key={t.id} value={t.id}>{t.title}{t.termCode ? ` (${t.termCode})` : ''}</option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={handleTransferToMajor}
                  disabled={busy}
                  className="px-4 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs disabled:opacity-50"
                >
                  ⇄ انتقال کاتالوگ
                </button>
              </div>
              <p className="text-3xs text-slate-400 font-bold">
                اگر «نیم‌سال ورودی» را تعیین کنید، نسخهٔ مقصد فقط به دانشجویان همان نیم‌سال ورودی تخصیص می‌یابد؛
                تعیین‌نکردن آن یعنی نسخه برای همهٔ نیم‌سال‌ها معتبر است (و ممکن است با چارت قبلی تداخل کند).
              </p>
              {terms.length === 0 && (
                <p className="text-3xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                  ⚠️ فهرست نیم‌سال‌ها خالی است — هنوز هیچ نیم‌سال مالی در سیستم تعریف نشده است.
                  ابتدا از بخش «📅 نیمسال‌ها» در پنل مدیریت نیم‌سال‌ها را تعریف کنید تا این فهرست پر شود.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-2xs font-bold text-amber-900">
            💡 همچنین میتوانید از دکمهٔ «➕ نسخهٔ جدید» در بالای صفحه استفاده کنید و «کپی عمیق از نسخهٔ دیگر» را انتخاب نمایید.
          </div>
        </div>
      )}
    </>
  );
}
