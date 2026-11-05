import { requireRole } from '@/lib/auth';
import { getFilterOptions, allowedReportKinds } from './actions';
import { ALL_REPORT_KINDS } from './report-helpers';
import { getCurrentUniversity } from '@/lib/university-scope';
import ReportsClient from './ReportsClient';

export const dynamic = 'force-dynamic';

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; term?: string; courseCode?: string }>;
}) {
  await requireRole(['ADMIN', 'EDU_EXPERT', 'ARCHIVE_EXPERT', 'MILITARY_OFFICER']);

  const currentUniversity = await getCurrentUniversity();
  const currentUniversityId = currentUniversity?.id ?? null;

  const opts = await getFilterOptions({ universityId: currentUniversityId, signerForm: 'edu-report' });
  const allowed = await allowedReportKinds(ALL_REPORT_KINDS);

  // پیش‌تنظیم از لینک بیرونی (مثل دکمهٔ «لیست دانشجویان» در مدیریت جلسات درس)
  const sp = await searchParams;
  const initialKind = sp?.kind && ALL_REPORT_KINDS.includes(sp.kind) ? sp.kind : undefined;
  const initialExtra = sp?.courseCode ? { courseCode: sp.courseCode } : undefined;

  return (
    <div className="space-y-4">
      <div className="card !p-4 bg-white border-slate-300 shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-base font-extrabold text-slate-900">📑 مرکز گزارش‌های آموزشی (سما)</h1>
          <p className="text-xs text-slate-500 mt-0.5">فعال ترم، خلاصه وضعیت، تفکیک دانشکده/رشته، مشروطی، برترها، تکمیلی... — همه صفحه‌بندی‌شده با خروجی Excel</p>
        </div>
      </div>
      <ReportsClient
        opts={opts}
        initialUniversityId={currentUniversityId ?? 0}
        allowedKinds={allowed}
        scope="edu"
        initialKind={initialKind}
        initialTerm={sp?.term}
        initialExtra={initialExtra}
      />
    </div>
  );
}
