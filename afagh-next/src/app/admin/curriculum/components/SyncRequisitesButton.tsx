'use client';

// دکمهٔ «همگام‌سازی پیش‌نیاز از جدول دروس».
// منبعِ قواعد در سامانهٔ قدیمی «جدول دروس» بود؛ چون course_rules به نسخه
// مقیّد است، این دکمه متنِ درس‌ها را برای همین نسخه مادی‌سازی می‌کند.
// اکشن در Provider صدا زده می‌شود (قاعدهٔ معماری ماژول: هیچ کامپوننتی
// Server Action را مستقیم import نمی‌کند).
import { useCurriculum } from '../curriculum-context';

export default function SyncRequisitesButton() {
  const { busy, handleSyncRequisites, selectedVersionId } = useCurriculum();

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => handleSyncRequisites(false)}
        disabled={busy || selectedVersionId == null}
        title="خواندن پیش‌نیاز و هم‌نیاز از جدول دروس و ثبت آن در قواعد این نسخه (قواعد موجود دست‌نخورده می‌مانند)"
        className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-xs border border-white/20 transition"
      >
        {busy ? '⏳ در حال خواندن…' : '🔗 پیش‌نیاز از جدول دروس'}
      </button>
      <button
        type="button"
        onClick={() => handleSyncRequisites(true)}
        disabled={busy || selectedVersionId == null}
        title="بازسازی کامل: قواعد پیش‌نیاز/هم‌نیاز این نسخه از متن جدول دروس از نو نوشته می‌شوند (برای اصلاح قواعد اشتباهِ مهاجرت)"
        className="px-3 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-amber-100 font-extrabold text-xs border border-amber-300/40 transition"
      >
        ♻️ بازسازی قواعد
      </button>
    </div>
  );
}
