import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { listTerms } from '@/lib/sama-sync/snapshot';
import { listSyncRuns } from './actions';
import SamaSyncClient from './SamaSyncClient';

export const dynamic = 'force-dynamic';

/**
 * «همگام‌سازی سما → آفاق» — صفحهٔ موقتِ اجرای هفتگی.
 *
 * چرا موقت؟ چون در حالت پایدار باید یک سرویسِ زمان‌بندی‌شده (cron روی سرور)
 * فایل را از سما بگیرد و بدون دخالتِ انسان اجرا کند. تا آن زمان، این صفحه
 * همان موتور را با یک کلیک در اختیار کارشناس می‌گذارد و همه‌چیز را در
 * زنجیرهٔ حسابرسی ثبت می‌کند.
 */
export default async function SamaSyncPage() {
  await requireRole(['ADMIN']);
  const uni = await getCurrentUniversity().catch(() => null);
  if (!uni || !(uni.id > 0)) {
    return <div className="p-6 text-sm text-rose-700">دانشگاه فعال مشخص نیست.</div>;
  }

  const [terms, runs] = await Promise.all([
    listTerms(uni.id),
    listSyncRuns(10).catch(() => []),
  ]);
  const current = terms.find((t) => t.isCurrent) ?? terms[0];

  return (
    <div className="space-y-4">
      <div className="card">
        <h1 className="text-lg font-extrabold">همگام‌سازی سما → آفاق</h1>
        <p className="mt-1 text-xs leading-6 text-slate-600">
          فایل TSV انتخاب واحد سما را اینجا بارگذاری کنید. با «بررسی» فقط گزارش ساخته می‌شود و
          <b> هیچ چیزی در پایگاه داده تغییر نمی‌کند</b>؛ با «اجرا» فقط دو کار انجام می‌شود:
          افزودنِ ثبت‌نام‌هایی که در سما هستند و در آفاق نیستند، و پرکردنِ نمره‌های خالی.
          <b className="text-rose-700"> حذف واحد یا بازنویسی نمرهٔ موجود هرگز انجام نمی‌شود</b> —
          این‌ها به‌عنوان اختلاف گزارش می‌شوند تا کارشناس تصمیم بگیرد.
        </p>
        <p className="mt-1 text-2xs text-slate-500">
          دانشگاه فعال: <b>{uni.title}</b> · ترم جاری: <b>{current ? current.termCode : '—'}</b>
        </p>
      </div>

      <SamaSyncClient
        terms={terms.map((t) => ({ termCode: t.termCode, title: t.title, isCurrent: t.isCurrent }))}
        defaultTerm={current?.termCode ?? ''}
      />

      <div className="card">
        <h2 className="mb-2 font-bold">آخرین اجراها</h2>
        {runs.length === 0 ? (
          <p className="text-xs text-slate-500">تا امروز اجرایی ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="p-2">#</th>
                  <th className="p-2">زمان</th>
                  <th className="p-2">کاربر</th>
                  <th className="p-2">ترم</th>
                  <th className="p-2">افزوده</th>
                  <th className="p-2">نمره</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-2 font-mono text-slate-400" dir="ltr">{r.id}</td>
                    <td className="p-2 font-mono text-slate-600" dir="ltr">{r.at.slice(0, 19).replace('T', ' ')}</td>
                    <td className="p-2">{r.actor ?? '—'}</td>
                    <td className="p-2 font-mono" dir="ltr">{String(r.details?.termCode ?? '—')}</td>
                    <td className="p-2 font-bold text-emerald-700">{Number(r.details?.inserted ?? 0).toLocaleString('fa-IR')}</td>
                    <td className="p-2 font-bold text-sky-700">{Number(r.details?.gradesFilled ?? 0).toLocaleString('fa-IR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
