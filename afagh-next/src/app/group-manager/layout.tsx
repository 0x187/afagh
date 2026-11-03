import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { requireRole, getStaffByUser, endCurrentSession } from '@/lib/auth';
import { headedDepartments } from '@/lib/group-manager';
import { getSiblingAccounts } from '@/lib/account-switch';
import PanelSwitcher from '@/components/PanelSwitcher';
import HeaderActions from '@/components/HeaderActions';
import { ADMIN_PANEL_ROLES } from '@/lib/panel-links';
import SessionLock from '@/components/SessionLock';
import DeptSwitcher from './DeptSwitcher';
import GroupManagerNav from './GroupManagerNav';
import BackToDashboard from '@/components/BackToDashboard';

export default async function GroupManagerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(['DEP_HEAD']);

  // قفل خودکار بیکاری — سرور-محور (مدت به تفکیک نقش؛ ۰ = غیرفعال).
  // منبع حقیقت «زمان آخرین فعالیت» است؛ پس رفرش قفل را دور نمی‌زند و کاربرِ در حال کار بیرون نمی‌افتد.
  const { evaluateIdleLock, resolveIdleTimeoutMinutes, idleMinutes, resolveReauthMinutes } = await import('@/lib/session-lock');
  const lockMin = await resolveIdleTimeoutMinutes(user.roles).catch(() => 15);
  // غیبت طولانی (بیش از SESSION_REAUTH_MINUTES) → نشست همین دستگاه بسته شود و
  // کاربر به صفحهٔ ورود برود؛ نه قفل روی صفحهٔ کهنهٔ چند ساعت پیش.
  if (lockMin > 0) {
    const reauthMin = await resolveReauthMinutes(lockMin).catch(() => 0);
    const away = reauthMin > 0 ? await idleMinutes(user.id).catch(() => null) : null;
    if (away != null && away >= reauthMin) {
      await endCurrentSession().catch(() => {});
      redirect('/login?expired=1');
    }
  }
  const lockOn = await evaluateIdleLock(user.id, lockMin).catch(() => false);
  const st = await getStaffByUser(user.id);
  const depts = st ? await headedDepartments(st.id, st.departmentId ?? null) : [];
  const active = Number((await cookies()).get('gm_dept')?.value || 0) || depts[0]?.id || 0;
  const current = depts.find(d => d.id === active) ?? depts[0] ?? null;

  // مدیر گروهی که استاد/کارشناس مالی/آموزش هم هست، از همین‌جا (بالای صفحه) بین
  // همهٔ کارتابل‌هایش جابه‌جا می‌شود — پیش‌تر فقط لینک استاد و (برای ADMIN) مدیر بود.
  const alreadyAdmin = user.roles.some(r => (ADMIN_PANEL_ROLES as readonly string[]).includes(r));
  let permissionCount = 0;
  if (!alreadyAdmin) {
    // فقط مجوزهای «نقش سفارشی» شمرده می‌شود؛ نقش‌های سیستمی (DEP_HEAD/PROFESSOR/STUDENT)
    // مجوزهای ذاتی دارند و نباید لینک «داشبورد مدیریت» بسازند.
    const { getUserCustomPermissionCodes } = await import('@/lib/permissions-enforcer');
    permissionCount = (await getUserCustomPermissionCodes(user.id).catch(() => [])).length;
  }
  // حساب‌های هم‌شخصِ همین کدملی (کد پرسنلی/دانشجویی دیگر) در همان سوییچر می‌آیند
  const siblings = await getSiblingAccounts().catch(() => []);

  return (
    <div className="app-page min-h-screen bg-slate-50 print:!bg-white">
      <header className="app-header sticky top-0 z-40 bg-teal-900 text-white print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
          {/* هویت: نشانِ کارتابل + عنوان + نام/نقش — هم‌الگو با کارتابل استاد */}
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-700/70 text-base font-black ring-1 ring-white/15 shadow-inner"
            >
              گ
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold leading-tight">
                پنل مدیر گروه
                {current && <span className="ms-2 text-xs font-normal opacity-90">· {current.name}</span>}
              </p>
              <p className="truncate text-2xs leading-tight opacity-75">
                {user.name} · نقش‌ها: {user.roles.join('، ')}
              </p>
            </div>
          </div>
          {/* ابزارها: همان `HeaderActions` مشترکِ سه کارتابل دیگر (راهنما/PDF/تم/خروج) */}
          <div className="relative flex flex-wrap items-center gap-1.5">
            <PanelSwitcher
              roles={user.roles}
              current="group-manager"
              permissionCount={permissionCount}
              siblings={siblings}
              groupTitle={current?.name}
            />
            <HeaderActions helpHref="/help/group-manager" pdfHref="/help/pdfs/group-manager.pdf" />
          </div>
        </div>

        {depts.length > 1 && <DeptSwitcher depts={depts} activeId={current?.id ?? 0} />}

        <GroupManagerNav />
      </header>
      <main id="main" className="mx-auto max-w-7xl p-3 pb-16 sm:p-5">
        <BackToDashboard href="/group-manager" label="بازگشت به کارتابل مدیر گروه" />
        {children}
      </main>
      <SessionLock name={user.name} timeoutMin={lockMin} initialLocked={lockOn} />
    </div>
  );
}
