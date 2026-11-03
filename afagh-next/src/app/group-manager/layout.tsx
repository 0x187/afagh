import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { requireRole, getStaffByUser, endCurrentSession } from '@/lib/auth';
import { headedDepartments } from '@/lib/group-manager';
import { getSiblingAccounts } from '@/lib/account-switch';
import PanelSwitcher from '@/components/PanelSwitcher';
import { ADMIN_PANEL_ROLES } from '@/lib/panel-links';
import ThemeToggle from '@/components/ThemeToggle';
import SessionLock from '@/components/SessionLock';
import { logoutAction } from '../login/actions';
import DeptSwitcher from './DeptSwitcher';
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
    <div className="min-h-screen bg-slate-50">
      <header className="bg-teal-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 p-4">
          <div>
            <p className="font-bold">
              پنل مدیر گروه
              {current && <span className="mr-2 text-sm font-normal opacity-90">· {current.name}</span>}
            </p>
            <p className="text-xs opacity-70">{user.name} · نقش‌ها: {user.roles.join('، ')}</p>
          </div>
          <div className="relative flex flex-wrap items-center gap-3">
            <PanelSwitcher
              roles={user.roles}
              current="group-manager"
              permissionCount={permissionCount}
              siblings={siblings}
              groupTitle={current?.name}
            />
            <Link href="/help/group-manager" className="rounded-lg bg-teal-800 px-3 py-1.5 text-xs font-bold hover:bg-teal-700">
              📖 راهنمای مدیر گروه
            </Link>
            <ThemeToggle />
              <form action={logoutAction}><button className="text-xs underline opacity-70">خروج</button></form>
          </div>
        </div>

        {depts.length > 1 && <DeptSwitcher depts={depts} activeId={current?.id ?? 0} />}

        <nav className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 pb-3 text-sm">
          <Link href="/group-manager" className="hover:underline">خانه</Link>
          <Link href="/group-manager/courses" className="hover:underline">دروس گروه</Link>
          <Link href="/group-manager/offerings" className="hover:underline">ارائه‌های ترم</Link>
          <Link href="/group-manager/scheduling" className="hover:underline">برنامه‌ریزی درسی</Link>
          <Link href="/group-manager/grants" className="hover:underline">تخصیص درس ترم بالاتر</Link>
          <Link href="/group-manager/classrooms" className="hover:underline">کلاس‌ها</Link>
          <Link href="/group-manager/equivalence" className="hover:underline">معادل‌سازی دروس</Link>
          <Link href="/group-manager/bypass" className="hover:underline">درخواست‌های بدون پیش‌نیاز</Link>
          <Link href="/group-manager/compensatory" className="hover:underline">دانشجویان جبرانی</Link>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-6xl p-4">
        <BackToDashboard href="/group-manager" label="بازگشت به کارتابل مدیر گروه" />
        {children}
      </main>
      <SessionLock name={user.name} timeoutMin={lockMin} initialLocked={lockOn} />
    </div>
  );
}
