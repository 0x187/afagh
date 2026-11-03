import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole, endCurrentSession } from '@/lib/auth';
import { getSiblingAccounts } from '@/lib/account-switch';
import PanelSwitcher from '@/components/PanelSwitcher';
import SessionLock from '@/components/SessionLock';
import { logoutAction } from '../login/actions';

export default async function ProctorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(['PROCTOR', 'VAULT_MANAGER', 'ADMIN', 'EDU_EXPERT', 'PROFESSOR']);

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
  // نقش‌های دیگر همین کاربر (استاد/ستادی) و حساب‌های هم‌کدملی در سوییچر بالای صفحه
  const siblings = await getSiblingAccounts().catch(() => []);
  const hasAdminRole = user.roles.some(r => ['ADMIN', 'EDU_EXPERT', 'VAULT_MANAGER'].includes(r));

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-slate-900 text-white shadow-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between p-3.5 px-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-black text-sm shadow-inner">
              آ
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-extrabold text-sm tracking-wide">سامانه هوشمند مراقبین آزمون دانشگاه آفاق</p>
                <span className="px-2 py-0.5 rounded-full text-3xs font-black bg-indigo-500/80 text-white">
                  پرتال مراقب
                </span>
              </div>
              <p className="text-xs text-slate-400">{user.name} · نقش: مراقب آزمون و کادر اجرایی</p>
            </div>
          </div>
          <div className="relative flex items-center gap-2">
            <PanelSwitcher
              roles={user.roles}
              current="proctor"
              siblings={siblings}
            />
            {hasAdminRole && (
              <Link
                href="/admin/exams"
                className="text-xs bg-indigo-900/90 hover:bg-indigo-800 text-indigo-200 border border-indigo-700/60 px-3 py-1.5 rounded-lg transition-colors font-bold"
              >
                مدیریت امتحانات ←
              </Link>
            )}
            <form action={logoutAction}>
              <button className="text-xs bg-rose-900/80 hover:bg-rose-900 text-rose-200 border border-rose-700/60 px-3 py-1.5 rounded-lg transition-colors font-medium">
                خروج
              </button>
            </form>
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-2 sm:gap-4 px-4 pb-2.5 text-xs sm:text-sm font-medium overflow-x-auto">
          <Link href="/proctor" className="px-3 py-1.5 rounded-lg bg-indigo-800/80 text-white border border-indigo-600/50 transition-colors whitespace-nowrap">
            📷 حضور و غیاب آزمون با QR-Code
          </Link>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-6xl p-3 sm:p-5 pb-16">{children}</main>
      <SessionLock name={user.name} timeoutMin={lockMin} initialLocked={lockOn} />
    </div>
  );
}
