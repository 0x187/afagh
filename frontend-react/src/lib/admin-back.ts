// Two-level "back to cartable" target — port of lib/admin-back.ts.
// The deepest registered module ABOVE the current path is the back target, so
// an expert inside /admin/finance/pos returns to /admin/finance, not to the
// global dashboard. Pure and testable.

export interface BackTarget {
  href: string;
  title: string;
  /** The target is the global dashboard itself? */
  isHome: boolean;
}

const stripTrailing = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

export function resolveBackTarget(
  rawPathname: string | null | undefined,
  modules: readonly { href: string; title: string }[],
  homeHref = '/admin',
  homeLabel = 'داشبورد مدیریت',
): BackTarget | null {
  const pathname = stripTrailing(String(rawPathname ?? '').trim());
  if (!pathname || pathname === homeHref) return null;

  const isUnder = (href: string) => pathname === href || pathname.startsWith(href + '/');

  // Deepest module strictly above the current path (the path itself excluded).
  const parent = modules
    .filter(m => m.href !== pathname && m.href.length < pathname.length && isUnder(m.href))
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (parent) return { href: parent.href, title: parent.title, isHome: false };
  return { href: homeHref, title: homeLabel, isHome: true };
}

/** Shared back-button styles — amber, so it never competes with the primary CTA. */
export const BACK_BTN_CLASS =
  'inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-900 shadow-xs transition hover:border-amber-400 hover:bg-amber-100 hover:text-amber-950 dark:border-amber-600/60 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-900/60';

export const BACK_HOME_CLASS =
  'inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50/50 px-2 py-1 text-[10px] font-medium text-amber-700/80 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300/80 dark:hover:bg-amber-900/40';
