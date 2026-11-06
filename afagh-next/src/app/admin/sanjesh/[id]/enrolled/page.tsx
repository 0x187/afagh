import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { admissions_staging, sanjesh_files, students } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { getScopedFile } from '@/lib/sanjesh/access';
import { Counter, Flash, SanjeshSteps } from '../../_ui';

export const dynamic = 'force-dynamic';

export default async function SanjeshEnrolledPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const fileId = Number(id);

  const uniScope = await getCurrentUniversity();
  const file = await getScopedFile(fileId, uniScope?.id ?? null);
  if (!file) return <div className="p-6 text-sm text-red-600">فایل یافت نشد.</div>;

  const staged = await db
    .select({
      id: admissions_staging.id,
      rowNo: admissions_staging.rowNo,
      fullName: admissions_staging.fullName,
      nationalCode: admissions_staging.nationalCode,
      studentId: admissions_staging.studentId,
      status: admissions_staging.status,
      onboardingStatus: admissions_staging.onboardingStatus,
      assignedStudentCode: admissions_staging.assignedStudentCode,
      studentCode: students.studentCode,
      matchedAt: admissions_staging.matchedAt,
    })
    .from(admissions_staging)
    .leftJoin(students, eq(students.id, admissions_staging.studentId))
    .where(eq(admissions_staging.fileId, fileId))
    .orderBy(asc(admissions_staging.rowNo))
    .limit(500);

  const withCode = staged.filter((s) => s.studentCode ?? s.assignedStudentCode).length;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <SanjeshSteps fileId={fileId} active="enrolled" />
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-base font-bold text-slate-800">ثبت‌نام‌شده — {file.title}</h1>
          <p className="text-2xs text-slate-500">
            ردیف‌هایی که به کارتابل پذیرش منتقل شده‌اند. ادامهٔ فرآیند (تخصیص شمارهٔ دانشجویی و ساخت کاربر) در کارتابل
            پذیرش انجام می‌شود.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Counter label="منتقل‌شده" value={staged.length} tone="sky" />
          <Counter label="دارای شمارهٔ دانشجویی" value={withCode} tone="emerald" />
        </div>
      </header>

      <Flash msg={sp.msg} err={sp.err} />

      <div className="mb-3">
        <Link prefetch={false} href="/admin/admissions" className="btn-ghost !py-1 text-xs">
          رفتن به کارتابل پذیرش ←
        </Link>
      </div>

      <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200">
        <table className="w-full text-right text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
            <tr>
              <th className="sticky right-0 z-20 w-12 bg-slate-100 p-2 font-medium shadow-[-2px_0_0_0_#cbd5e1]">ردیف</th>
              <th className="p-2 font-medium">نام</th>
              <th className="p-2 font-medium">کد ملی</th>
              <th className="p-2 font-medium">شمارهٔ دانشجویی</th>
              <th className="p-2 font-medium">وضعیت پذیرش</th>
              <th className="p-2 font-medium">وضعیت ثبت‌نام</th>
            </tr>
          </thead>
          <tbody>
            {staged.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-400">
                  هنوز ردیفی به پذیرش منتقل نشده است.
                </td>
              </tr>
            ) : (
              staged.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-800 dark:even:bg-slate-900">
                  <td className="sticky right-0 z-10 bg-inherit p-2 text-center tabular-nums text-slate-500 shadow-[-2px_0_0_0_#e2e8f0]">
                    {s.rowNo ?? '—'}
                  </td>
                  <td className="p-2 text-slate-700">{s.fullName ?? '—'}</td>
                  <td className="p-2 tabular-nums text-slate-600" dir="ltr">
                    {s.nationalCode ?? '—'}
                  </td>
                  <td className="p-2 tabular-nums text-slate-600" dir="ltr">
                    {s.studentCode ?? s.assignedStudentCode ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="p-2 text-slate-600">{s.status ?? '—'}</td>
                  <td className="p-2">
                    <span className="badge bg-slate-100 text-slate-600">{s.onboardingStatus ?? '—'}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {staged.length === 500 && <p className="mt-2 text-3xs text-slate-400">فقط ۵۰۰ ردیف اول نمایش داده شده است.</p>}
    </div>
  );
}
