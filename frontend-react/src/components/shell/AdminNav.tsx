import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { groupedModules, navModules } from '@/routes/admin/admin-modules';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/**
 * Admin navigation drawer/sidebar — port of app/admin/AdminNav.tsx.
 * Mobile: fixed top-right button + full-height slide-over. Desktop (lg+):
 * the same content becomes a sticky permanent sidebar. Search filters modules
 * by normalized Persian text; the default list shows the 8 category rows only
 * (module links appear on search or on the category pages).
 */

/** Minimal Persian text normalization for the search box. */
function normFa(s: string): string {
  return s
    .replace(/[يﻱ]/g, 'ی')
    .replace(/[كﮐ]/g, 'ک')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u200c/g, ' ')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .toLowerCase();
}

function faIncludes(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return normFa(haystack).includes(normFa(needle));
}

export function AdminNav() {
  const { data } = useSession();
  const roles = data?.user?.roles ?? [];
  const location = useLocation();
  const pathname = location.pathname;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  // Close on route change; Escape closes; body scroll locks while open.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const modules = useMemo(() => navModules(roles), [roles]);
  const grouped = useMemo(() => groupedModules(roles), [roles]);
  // Active category — inferred from the current path (longest href first so
  // /admin/x/y never matches /admin/x); the dashboard itself is excluded.
  const activeGroup = useMemo(() => {
    const hit = modules
      .filter(m => m.href !== '/admin')
      .sort((a, b) => b.href.length - a.href.length)
      .find(m => pathname === m.href || pathname.startsWith(m.href + '/'));
    return hit?.group;
  }, [modules, pathname]);
  const filtered = useMemo(() => {
    const t = normFa(q);
    if (!t) return modules;
    return modules.filter(m => faIncludes(m.title, t) || faIncludes(m.desc, t));
  }, [modules, q]);

  const navRow = (active: boolean) =>
    cn(
      'flex items-center gap-2 rounded-lg px-3 py-2 transition-colors',
      active ? 'bg-indigo-700 font-bold' : 'hover:bg-indigo-500 dark:hover:bg-indigo-900/70',
    );

  return (
    <>
      {/* Fixed top-right button (mobile only) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="باز کردن منوی مدیریت"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="fixed top-3 right-3 z-40 flex items-center gap-1.5 rounded-xl border border-indigo-600/60 bg-indigo-900/90 px-3 py-2 text-xs font-bold text-white shadow-lg transition-colors hover:bg-indigo-900 lg:hidden"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        منو
      </button>

      {/* Mobile: full drawer controlled by `open`. Desktop: permanent sticky sidebar. */}
      <div
        className={cn('print:hidden', open ? 'fixed inset-0 z-50' : 'hidden', 'lg:static lg:inset-auto lg:z-auto lg:block lg:shrink-0')}
        {...(open ? { role: 'dialog', 'aria-modal': true as const, 'aria-label': 'منوی مدیریت' } : {})}
      >
        <div className="absolute inset-0 bg-slate-950/60 lg:hidden" onClick={() => setOpen(false)} aria-hidden />
        <aside className="absolute top-0 right-0 flex h-full w-80 max-w-[85vw] flex-col border-indigo-500 bg-indigo-600 text-white shadow-2xl dark:border-indigo-700/50 dark:bg-indigo-950 lg:static lg:top-auto lg:right-auto lg:sticky lg:top-[4.5rem] lg:min-h-[calc(100dvh-8rem)] lg:w-64 lg:max-w-none lg:rounded-2xl lg:border xl:w-72">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-indigo-200 p-3 dark:border-indigo-700/60">
            <p className="flex items-center gap-2 text-sm font-extrabold">
              <span aria-hidden className="text-base leading-none">🧭</span> منوی مدیریت
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="بستن منو"
              className="rounded-lg p-1.5 hover:bg-indigo-500 dark:hover:bg-indigo-900/70 lg:hidden"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          {/* Search */}
          <div className="border-b border-indigo-200 p-3 dark:border-indigo-700/60">
            <div className="relative">
              <span aria-hidden className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs opacity-70">🔍</span>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="جست‌وجوی ماژول…"
                className="w-full rounded-lg border border-indigo-200 bg-white py-1.5 pl-3 pr-8 text-xs placeholder:text-indigo-400 focus:border-indigo-500 focus:outline-none dark:border-indigo-700/60 dark:bg-indigo-900/70 dark:placeholder:text-indigo-400"
              />
            </div>
          </div>

          {/* Dashboard + (search results | the 8 category rows) */}
          <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3 text-[13px]">
            <Link
              to="/admin"
              aria-current={pathname === '/admin' ? 'page' : undefined}
              className={navRow(pathname === '/admin')}
            >
              <span aria-hidden className="shrink-0 text-base leading-none">🏠</span>
              <span className="flex-1">داشبورد</span>
            </Link>

            {q.trim() !== '' ? (
              filtered.length > 0 ? (
                filtered.map(m => {
                  const active = pathname === m.href || pathname.startsWith(m.href + '/');
                  return (
                    <Link
                      key={m.href}
                      to={m.href}
                      title={m.desc}
                      aria-current={active ? 'page' : undefined}
                      className={cn(navRow(active), 'text-[12.5px]')}
                    >
                      <span aria-hidden className="shrink-0 text-base leading-none">{m.emoji}</span>
                      <span className="flex-1 truncate">{m.title}</span>
                    </Link>
                  );
                })
              ) : (
                <p className="px-3 py-4 text-center text-xs text-indigo-200 dark:text-indigo-400">ماژولی یافت نشد.</p>
              )
            ) : (
              grouped.map(g => {
                const href = `/admin/c/${g.key}`;
                const active = pathname === href || pathname.startsWith(href + '/') || activeGroup === g.key;
                return (
                  <Link
                    key={g.key}
                    to={href}
                    title={g.desc}
                    aria-current={active ? 'page' : undefined}
                    className={cn(navRow(active), 'font-bold')}
                  >
                    <span aria-hidden className="shrink-0 text-base leading-none">{g.emoji}</span>
                    <span className="flex-1 truncate">{g.title}</span>
                    <span className="shrink-0 rounded px-1 text-[10px] font-black tabular-nums text-indigo-200 dark:text-indigo-400">
                      {g.modules.length}
                    </span>
                  </Link>
                );
              })
            )}
          </nav>

          {/* Guide */}
          <div className="border-t border-indigo-200 p-2 dark:border-indigo-700/60">
            <Link
              to="/help/admin"
              className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-700/70 px-3 py-2 text-[13px] font-bold transition-colors hover:bg-emerald-700"
            >
              <span aria-hidden className="shrink-0 text-base leading-none">📖</span> راهنمای کاربری و PDF
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
