import { Link, useLocation } from 'react-router-dom';

import { resolveBackTarget, BACK_BTN_CLASS, BACK_HOME_CLASS } from '@/lib/admin-back';
import { ADMIN_MODULES, canSeeModule } from '@/routes/admin/admin-modules';
import { useSession } from '@/lib/session';

/**
 * Two-level "back to cartable" bar for the admin area — port of
 * components/AdminBackBar.tsx. The module list comes from the central
 * registry (filtered by this user's roles) so the back link can never reach
 * a forbidden page, and sub-cartables return to their own parent cartable.
 */
export function AdminBackBar() {
  const { data } = useSession();
  const roles = data?.user?.roles ?? [];
  const modules = ADMIN_MODULES.filter(m => canSeeModule(roles, m)).map(m => ({ href: m.href, title: m.title }));
  const target = resolveBackTarget(useLocation().pathname, modules);
  // On the dashboard itself a "back to dashboard" link makes no sense.
  if (!target) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center justify-end gap-1.5 print:hidden">
      {!target.isHome ? (
        <Link to="/admin" title="داشبورد مدیریت" className={BACK_HOME_CLASS}>
          <span aria-hidden>🏠</span> داشبورد مدیریت
        </Link>
      ) : null}
      <Link to={target.href} title={`بازگشت به ${target.title}`} className={BACK_BTN_CLASS}>
        <span aria-hidden>→</span> بازگشت به {target.title}
      </Link>
    </div>
  );
}
