import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { academic_terms } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { bypassInboxForExpert, bypassOverviewForVice } from '@/lib/bypass-requests';
import { saveBypassSettingsAction } from './actions';
import BypassBoardClient from './BypassBoardClient';

export const dynamic = 'force-dynamic';

export default async function AdminBypassPage() {
  const user = await requireRole(['ADMIN', 'VICE_EDU', 'EDU_EXPERT']);
  const isVice = user.roles.includes('VICE_EDU') || user.roles.includes('ADMIN');
  const isExpert = user.roles.includes('EDU_EXPERT');
  const isAdmin = user.roles.includes('ADMIN');

  const [expertRows, viceRows, currentTerms] = await Promise.all([
    isExpert ? bypassInboxForExpert(user.id) : Promise.resolve([]),
    isVice ? bypassOverviewForVice() : Promise.resolve([]),
    isAdmin
      ? db.select({
          id: academic_terms.id,
          title: academic_terms.title,
          termCode: academic_terms.termCode,
          bypassManagerHours: academic_terms.bypassManagerHours,
          bypassExpertHours: academic_terms.bypassExpertHours,
          bypassReminderHours: academic_terms.bypassReminderHours,
        }).from(academic_terms).where(eq(academic_terms.isCurrent, 1))
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-lg font-black text-slate-900">درخواست‌های بدون رعایت پیش‌نیاز / تداخل امتحانی</h1>
        <p className="mt-1 text-xs leading-6 text-slate-600">
          درخواست‌های ارجاع‌شده به کارشناس آموزش رشته اینجا دیده می‌شوند. صندلی درس تا زمان تصمیم برای دانشجو
          رزرو می‌ماند؛ اگر تا پایان مهلت تصمیمی ثبت نشود، درخواست به‌صورت خودکار رد و صندلی آزاد می‌شود.
          معاون آموزش می‌تواند تصمیم بگیرد یا درخواست را به مدیر گروه / کارشناس برگرداند.
        </p>
      </div>

      {isAdmin && currentTerms.length > 0 && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 shadow-sm space-y-3">
          <div>
            <h2 className="text-sm font-black text-indigo-950">⏱️ مهلت‌های تصمیم‌گیری (تنظیمات نیمسال جاری)</h2>
            <p className="mt-0.5 text-2xs leading-5 text-indigo-800">
              مدیر گروه تا پایان «مهلت مدیر» فرصت دارد؛ پس از آن درخواست به کارشناس آموزش رشته ارجاع می‌شود و
              کارشناس تا پایان «مهلت کارشناس» فرصت دارد. «یادآوری» یعنی چند ساعت قبل از پایان هر مهلت، پیام
              یادآوری ارسال شود. پس از پایان مهلت کارشناس بدون تصمیم، درخواست خودکار رد می‌شود.
            </p>
          </div>
          {currentTerms.map(t => (
            <form
              key={t.id}
              action={saveBypassSettingsAction}
              className="flex flex-wrap items-end gap-3 rounded-xl bg-white border border-indigo-200 p-3"
            >
              <input type="hidden" name="termId" value={t.id} />
              <div className="text-xs font-bold text-slate-800 min-w-40">
                {t.title}
                <span className="block font-mono text-3xs text-slate-500" dir="ltr">{t.termCode}</span>
              </div>
              <label className="text-2xs font-bold text-slate-700 space-y-1">
                <span className="block">مهلت مدیر گروه (ساعت)</span>
                <input
                  type="number" name="bypassManagerHours" min={1} max={720} step={1}
                  defaultValue={t.bypassManagerHours ?? 48}
                  className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-xs font-mono"
                />
              </label>
              <label className="text-2xs font-bold text-slate-700 space-y-1">
                <span className="block">مهلت کارشناس (ساعت)</span>
                <input
                  type="number" name="bypassExpertHours" min={1} max={720} step={1}
                  defaultValue={t.bypassExpertHours ?? 12}
                  className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-xs font-mono"
                />
              </label>
              <label className="text-2xs font-bold text-slate-700 space-y-1">
                <span className="block">یادآوری قبل از مهلت (ساعت)</span>
                <input
                  type="number" name="bypassReminderHours" min={1} max={720} step={1}
                  defaultValue={t.bypassReminderHours ?? 10}
                  className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-xs font-mono"
                />
              </label>
              <button
                type="submit"
                className="rounded-lg bg-indigo-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-900"
              >
                ذخیره
              </button>
            </form>
          ))}
        </div>
      )}

      <BypassBoardClient expertRows={expertRows} viceRows={viceRows} isVice={isVice} isExpert={isExpert} />
    </div>
  );
}
