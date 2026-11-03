'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { groupedModules, navModules } from '@/lib/admin-modules';
import { normalizeFa, faIncludes } from '@/lib/persian-search';
import type { UniTheme } from '@/lib/university-theme';
import Icon from '@/components/ui/Icon';

/**
 * منوی کشویی سمت راست کارتابل مدیریت — جایگزین نوار افقی قبلی.
 * دکمهٔ ثابت بالا-راست + پنل لغزنده از راست با جست‌وجو؛ فقط نقش‌های مجاز.
 */
export default function AdminNav({ roles, permissions, theme }: { roles: string[]; permissions?: string[]; theme?: UniTheme }) {
  const th: UniTheme = theme ?? {
    header: 'bg-indigo-950', badge: 'bg-indigo-900/90 hover:bg-indigo-900 border-indigo-600/60',
    ring: 'border-indigo-700/60', soft: 'bg-indigo-900/80 text-indigo-200',
    navPanel: 'bg-indigo-600 text-white border-indigo-500 dark:bg-indigo-950 dark:border-indigo-700/50', navBorder: 'border-indigo-200',
    navHover: 'hover:bg-indigo-500 dark:hover:bg-indigo-900/70', navActive: 'bg-indigo-700 font-bold',
    navMuted: 'text-indigo-200 dark:text-indigo-400',
    navInput: 'bg-white border-indigo-200 dark:bg-indigo-900/70 dark:border-indigo-700/60 placeholder:text-indigo-400 focus:border-indigo-500 dark:focus:border-indigo-400',
  };
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // دسته‌ها پیش‌فرض بسته‌اند؛ با کلیک روی سرصفحه باز می‌شوند
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // با عوض‌شدن مسیر، کشو بسته شود
  useEffect(() => { setOpen(false); }, [pathname]);
  // Escape ببندد
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  // اسکرول بدنه قفل شود تا کشو روی محتوایِ در حال اسکرول شناور نماند
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const modules = useMemo(() => navModules(roles, permissions), [roles, permissions]);
  const grouped = useMemo(() => groupedModules(roles, permissions), [roles, permissions]);
  const filtered = useMemo(() => {
    const t = normalizeFa(q);
    if (!t) return modules;
    return modules.filter(m => faIncludes(m.title, t) || faIncludes(m.desc, t));
  }, [modules, q]);

  return (
    <>
      {/* دکمهٔ ثابت بالا-راست (موبایل) */}
      <button
        onClick={() => setOpen(true)}
        aria-label="باز کردن منوی مدیریت"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`lg:hidden fixed top-3 right-3 z-40 flex items-center gap-1.5 rounded-xl ${th.badge} px-3 py-2 text-xs font-bold text-white shadow-lg transition-colors`}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        منو
      </button>

      {/* ── پوستهٔ ناوبری ──
          موبایل: کشوی تمام‌قد که فقط با `open` باز می‌شود.
          دسکتاپ (`lg+`): همان محتوا به سایدبارِ دائمیِ چسبان تبدیل می‌شود
          (`lg:static` + `lg:sticky` روی aside) تا کاربر بدون دو کلیک به
          همهٔ ماژول‌ها دسترسی داشته باشد. */}
      <div
        className={`${open ? 'fixed inset-0 z-50' : 'hidden'} lg:static lg:inset-auto lg:z-auto lg:block lg:shrink-0 print:hidden`}
        {...(open ? { role: 'dialog', 'aria-modal': true as const, 'aria-label': 'منوی مدیریت' } : {})}
      >
        {/* پس‌زمینهٔ نیمه‌شفاف (فقط موبایل) */}
        <div className="absolute inset-0 bg-slate-950/60 lg:hidden" onClick={() => setOpen(false)} aria-hidden />
        <aside
          className={`absolute top-0 right-0 h-full w-80 max-w-[85vw] ${th.navPanel} text-white shadow-2xl flex flex-col
            lg:static lg:top-auto lg:right-auto lg:min-h-[calc(100dvh-8rem)] lg:w-64 xl:w-72 lg:max-w-none lg:sticky lg:top-[6.5rem]
            lg:rounded-2xl lg:border lg:shadow-sm`}
        >
          {/* هدر */}
          <div className={`flex items-center justify-between p-3 border-b ${th.navBorder}`}>
            <p className="flex items-center gap-2 font-extrabold text-sm">
              <Icon emoji="🧭" className="h-4 w-4" /> منوی مدیریت
            </p>
            <button
              onClick={() => setOpen(false)}
              aria-label="بستن منو"
              className={`lg:hidden rounded-lg p-1.5 ${th.navHover}`}
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          {/* جست‌وجو */}
          <div className={`p-3 border-b ${th.navBorder}`}>
            <div className="relative">
              <Icon emoji="🔍" className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 opacity-70" />
              <input
                autoFocus={open}
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="جست‌وجوی ماژول…"
                className={`w-full rounded-lg border py-1.5 pr-8 pl-3 text-xs focus:outline-none ${th.navInput}`}
              />
            </div>
          </div>

          {/* لیست ماژول‌ها (اسکرول‌پذیر) */}
          <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-3 text-[13px]">
            <Link
              href="/admin"
              aria-current={pathname === '/admin' ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${pathname === '/admin' ? th.navActive : th.navHover}`}
            >
              <Icon emoji="🏠" className="h-4 w-4 shrink-0" />
              <span className="flex-1">داشبورد</span>
            </Link>

            {filtered.length > 0 && q.trim() === '' ? (
              grouped.map(g => {
                // همهٔ دسته‌ها پیش‌فرض بسته‌اند؛ فقط با کلیکِ کاربر باز می‌شوند.
                // (نام `isOpen` است تا با state بیرونیِ `open` — که کشوی موبایل را
                //  کنترل می‌کند — قاطی نشود.)
                const isOpen = !!expanded[g.group.key];
                return (
                  <div key={g.group.key}>
                    {/* سرصفحهٔ دسته — کلیک‌پذیر برای باز/بسته‌کردن (پیش‌فرض بسته) */}
                    <button
                      type="button"
                      onClick={() => setExpanded(p => ({ ...p, [g.group.key]: !isOpen }))}
                      aria-expanded={isOpen}
                      className={`flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-extrabold tracking-wide transition-colors ${th.navHover}`}
                    >
                      <span aria-hidden className="shrink-0">{g.group.icon}</span>
                      <span className="flex-1 text-start">{g.group.title}</span>
                      <span className={`shrink-0 rounded px-1 text-3xs font-black tabular-nums ${th.navMuted}`}>
                        {g.modules.length}
                      </span>
                      <span
                        aria-hidden
                        className={`shrink-0 text-3xs transition-transform duration-150 ${th.navMuted} ${isOpen ? '' : 'rotate-[-90deg]'}`}
                      >
                        ▼
                      </span>
                    </button>
                    {isOpen && (
                      <div className="mb-1 mt-0.5 space-y-0.5">
                        {g.modules.map(m => {
                          const active = pathname === m.href || pathname.startsWith(m.href + '/');
                          return (
                            <Link
                              key={m.href}
                              href={m.href}
                              title={m.desc}
                              aria-current={active ? 'page' : undefined}
                              className={`flex items-center gap-2 rounded-lg py-2 pe-3 ps-4 text-[12.5px] transition-colors ${active ? th.navActive : th.navHover}`}
                            >
                              <span aria-hidden className="shrink-0">{m.icon}</span>
                              <span className="flex-1 truncate">{m.title}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            ) : filtered.map(m => {
              const active = pathname === m.href || pathname.startsWith(m.href + '/');
              return (
                <Link
                  key={m.href}
                  href={m.href}
                  title={m.desc}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] transition-colors ${active ? th.navActive : th.navHover}`}
                >
                  <span aria-hidden className="shrink-0">{m.icon}</span>
                  <span className="flex-1 truncate">{m.title}</span>
                </Link>
              );
            })}

            {filtered.length === 0 && (
              <p className={`px-3 py-4 text-center text-xs ${th.navMuted}`}>ماژولی یافت نشد.</p>
            )}
          </nav>

          {/* دکمهٔ راهنما */}
          <div className={`p-2 border-t ${th.navBorder}`}>
            <Link
              href="/help/admin"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] bg-emerald-700/70 hover:bg-emerald-700 border border-emerald-500/40 font-bold transition-colors"
            >
              <Icon emoji="📖" className="h-4 w-4 shrink-0" /> راهنمای کاربری و PDF
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
