import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { listLessonPlanStatus } from '@/app/professor/lesson-plan/actions';
import LessonPlansClient from './LessonPlansClient';

export const dynamic = 'force-dynamic';

export default async function LessonPlansPage() {
  await requireRole(['ADMIN', 'EDU_EXPERT', 'VICE_EDU']);
  const uni = await getCurrentUniversity().catch(() => null);
  const universityId = uni?.id ?? null;

  // فقط صفحهٔ اول (سقف ۲۰۰ ردیف) در رندر اولیه می‌آید — بقیه با جست‌وجوی
  // سروری/«بیشتر» لود می‌شود. قبلاً «همهٔ» ارائه‌ها (~۲MB payload) در همان
  // بار اول رندر می‌رفت و صفحهٔ آموزش را چندده ثانیه‌ای می‌کرد.
  const data = universityId
    ? await listLessonPlanStatus(universityId)
    : { rows: [], total: 0, submitted: 0, filtered: 0 };

  return (
    <div className="space-y-4" dir="rtl">
      <LessonPlansClient
        universityId={universityId}
        universityTitle={uni?.title ?? 'دانشگاه'}
        initialRows={data.rows.map(r => ({
          offeringId: r.offeringId,
          courseTitle: r.courseTitle,
          professorName: r.professorName,
          status: r.status,
          sessionsCount: r.sessionsCount,
          weightsSum: r.weightsSum,
          updatedAt: r.updatedAt ? String(r.updatedAt) : null,
        }))}
        initialStats={{ total: data.total, submitted: data.submitted, filtered: data.filtered }}
      />
    </div>
  );
}
