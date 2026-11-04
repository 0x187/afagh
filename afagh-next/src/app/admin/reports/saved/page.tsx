import { requireRole } from '@/lib/auth';
import { listSavedReports } from './actions';
import SavedReportsClient from './SavedReportsClient';

export const dynamic = 'force-dynamic';

const RUNNER_ROLES = [
  'ADMIN', 'EDU_EXPERT', 'ARCHIVE_EXPERT', 'MILITARY_OFFICER',
  'FINANCE_EXPERT', 'FINANCE', 'CASHIER',
];

export default async function SavedReportsPage() {
  await requireRole(RUNNER_ROLES);
  const reports = await listSavedReports();

  return (
    <div className="space-y-4">
      <div className="card !p-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-extrabold text-slate-900">📂 گزارش‌های ذخیره‌شده</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            گزارش‌هایی که در گزارش‌ساز ساخته شده‌اند — هرکس مجاز باشد می‌تواند اجرا و خروجی بگیرد.
          </p>
        </div>
      </div>

      <SavedReportsClient reports={reports} />
    </div>
  );
}
