import { requireRole } from '@/lib/auth';
import { db } from '@/db';
import { academic_terms } from '@/db/schema';
import { asc, desc, eq } from 'drizzle-orm';
import { getCurrentUniversity } from '@/lib/university-scope';
import { listVirtualClassroomsAdminAction } from './actions';
import AdminVirtualClassesClient from './AdminVirtualClassesClient';

export const dynamic = 'force-dynamic';

export default async function AdminVirtualClassesPage() {
  await requireRole(['ADMIN', 'EDU_EXPERT', 'VICE_EDU']);
  const uni = await getCurrentUniversity().catch(() => null);
  const terms = uni
    ? await db.select({ id: academic_terms.id, title: academic_terms.title, termCode: academic_terms.termCode })
        .from(academic_terms)
        .where(eq(academic_terms.universityId, uni.id))
        .orderBy(desc(academic_terms.id))
    : [];
  const res = await listVirtualClassroomsAdminAction();
  return (
    <div className="space-y-4" dir="rtl">
      <div className="card">
        <h1 className="font-black text-base sm:text-lg">📡 گزارش کلاس‌های آنلاین (BigBlueButton)</h1>
        <p className="mt-1 text-xs leading-6 text-slate-500">
          فهرست همهٔ کلاس‌های آنلاین تعریف‌شده، وضعیت برگزاری (برگزار شده / در حال برگزاری / آینده)،
          استاد، درس، نیم‌سال، تعداد دانشجو، ضبط‌ها و آخرین همگام‌سازی با سرور بیگ‌بلوباتن.
        </p>
      </div>
      <AdminVirtualClassesClient terms={terms} initialRows={res.ok ? res.rows : []} initialError={res.ok ? null : res.error} />
    </div>
  );
}