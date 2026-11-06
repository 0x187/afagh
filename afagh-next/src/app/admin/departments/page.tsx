import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import {
  assignOrphanCoursesAction,
  countOrphanCourses,
  createDepartmentAction,
  listDepartments,
  listFaculties,
  listStaffPicks,
  setDepartmentHeadAction,
  setFacultyCodeAction,
  setStaffDepartmentAction,
  updateDepartmentAction,
} from './actions';
import DepartmentsClient from './DepartmentsClient';
import OrphanCoursesPanel from './OrphanCoursesPanel';

export const dynamic = 'force-dynamic';

export default async function DepartmentsPage() {
  await requireRole(['ADMIN', 'VICE_EDU']);

  // فیلتر دانشگاه داخل خود action ها انجام می‌شود (getCurrentUniversity در actions.ts)
  const [depts, staffPicks, faculties, orphans] = await Promise.all([
    listDepartments(),
    listStaffPicks(),
    listFaculties(),
    countOrphanCourses(),
  ]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h1 className="text-lg font-extrabold text-slate-800">گروه‌های آموزشی و مدیران گروه</h1>
        <p className="mt-1 text-xs leading-6 text-slate-500">
          گروه‌های آموزشی را اینجا تعریف می‌کنید و برای هر گروه یک مدیر از میان اعضای هیئت علمی انتخاب می‌شود. با
          انتخاب مدیر، نقش «مدیر گروه» خودکار به حساب او اضافه می‌شود و بقیهٔ نقش‌هایش (مثلاً «استاد») دست‌نخورده
          می‌ماند؛ کارتابل استاد و مدیر گروه برای او یکی می‌شود.
        </p>
        <p className="mt-2 rounded-lg bg-amber-50 p-2.5 text-xs leading-6 text-amber-900">
          <b>گروه دروس عمومی و مشترک:</b> نوع گروه را «دروس عمومی و مشترک» بگذارید. مدیر چنین گروهی معمولاً عضو آن
          نیست و استادی از یک گروه تخصصی دیگر است؛ سامانه این را می‌پذیرد و او در پنل خود بین گروه‌هایش جابه‌جا می‌شود.
        </p>
      </div>

      <DepartmentsClient
        depts={depts}
        staffPicks={staffPicks}
        faculties={faculties}
        orphanCourses={orphans}
        createAction={createDepartmentAction}
        updateAction={updateDepartmentAction}
        setHeadAction={setDepartmentHeadAction}
        setStaffDeptAction={setStaffDepartmentAction}
        assignOrphansAction={assignOrphanCoursesAction}
        setFacultyCodeAction={setFacultyCodeAction}
      />

      <OrphanCoursesPanel
        depts={depts.map(d => ({ id: d.id, name: d.name }))}
        total={orphans}
      />

      <p className="text-center text-xs text-slate-400">
        برای دیدن فهرست کامل کارکنان و نقش‌هایشان به{' '}
        <Link prefetch={false} href="/admin/staff" className="text-indigo-600 hover:underline">
          صفحهٔ استاد و کارکنان
        </Link>{' '}
        بروید.
      </p>
    </div>
  );
}
