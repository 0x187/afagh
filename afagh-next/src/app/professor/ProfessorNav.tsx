'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * منوی موبایل کارتابل استاد — ۵ مقصد پرتکرار در نوار پایین + دکمهٔ «منو» که
 * بقیهٔ مقاصد را در یک bottom sheet باز می‌کند (هم‌راستا با StudentNav).
 *
 * چرا: پیش‌تر MobileTabBar فقط ۴ تب داشت و راهی به قرارداد/اسناد/عملکرد و… در
 * موبایل نبود. این الگو (Material 3 + توصیهٔ NN/g) هم دسترسی شستی می‌دهد و هم
 * همهٔ مقاصد را بدون شلوغی نوار پایین در دسترس نگه می‌دارد.
 */

export const PROFESSOR_NAV = [
  { href: '/professor', label: 'داشبورد', icon: '📊', exact: true },
  { href: '/professor/schedule', label: 'برنامهٔ هفتگی تدریس', icon: '🗓️', exact: false },
  { href: '/professor/attendance', label: 'ثبت حضور و غیاب', icon: '📋', exact: false },
  { href: '/professor/grades', label: 'بارم‌بندی و ثبت نمرات', icon: '📝', exact: false },
  { href: '/professor/contract', label: 'قرارداد تدریس و مالی', icon: '📑', exact: false },
  { href: '/professor/availability', label: 'اعلام ساعات حضور ترم', icon: '⏰', exact: false },
  { href: '/professor/performance', label: 'کارنامهٔ عملکرد', icon: '📈', exact: false },
  { href: '/professor/evaluation', label: 'ارزشیابی دانشجویان', icon: '🎯', exact: false },
  { href: '/professor/broadcast', label: 'پیام به کلاس', icon: '📣', exact: false },
  { href: '/professor/virtual-classes', label: 'کلاس آنلاین', icon: '📡', exact: false },
  { href: '/professor/documents', label: 'اسناد و امضا', icon: '📄', exact: false },
];

const BOTTOM_TABS: { href: string; label: string }[] = [
  { href: '/professor', label: 'داشبورد' },
  { href: '/professor/schedule', label: 'برنامه' },
  { href: '/professor/attendance', label: 'حضور' },
  { href: '/professor/grades', label: 'نمرات' },
];

export default function ProfessorNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (n: (typeof PROFESSOR_NAV)[number]) =>
    n.exact ? pathname === n.href : pathname.startsWith(n.href);

  return (
    <>
      <nav
        className="ui-bottom-nav md:hidden fixed inset-x-0 bottom-0 z-50 print:hidden"
        style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
        aria-label="ناوبری اصلی استاد"
      >
        <div className="max-w-md mx-auto flex items-stretch justify-around px-1 py-1.5">
          {BOTTOM_TABS.map(t => {
            const n = PROFESSOR_NAV.find(x => x.href === t.href)!;
            const active = isActive(n);
            return (
              <Link
                key={t.href}
                href={t.href}
                style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[2.75rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 transition active:scale-95 ${
                  active
                    ? 'bg-indigo-50 font-extrabold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                <span className="text-lg leading-none" aria-hidden>{n.icon}</span>
                <span className="text-2xs leading-tight text-center">{t.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="باز کردن منوی کامل"
            className="flex min-h-[2.75rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 active:scale-95 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <span className="text-lg leading-none" aria-hidden>☰</span>
            <span className="text-2xs leading-tight">منو</span>
          </button>
        </div>
      </nav>

      {open && (
        <div className="md:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="منوی استاد">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} />
          <aside className="absolute bottom-0 inset-x-0 max-h-[82vh] overflow-y-auto rounded-t-3xl bg-white shadow-2xl flex flex-col pb-[env(safe-area-inset-bottom,0px)]">
            {/* دستگیرهٔ کشیدن — نشانهٔ بصریِ «شیت» و کمک به درکِ بستن */}
            <div aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
            <div className="flex items-center justify-between p-4 border-b border-slate-100 sticky top-0 bg-white">
              <p className="font-extrabold text-slate-900">منوی استاد</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="بستن منو"
                className="rounded-lg px-2 py-1 text-xl leading-none text-slate-500 hover:bg-slate-100"
              >
                ×
              </button>
            </div>
            <div className="p-2 space-y-1">
              {PROFESSOR_NAV.map(n => {
                const active = isActive(n);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl font-bold transition-all ${
                      active
                        ? 'bg-indigo-700 text-white shadow-md'
                        : 'text-slate-700 hover:text-slate-950 hover:bg-slate-100'
                    }`}
                  >
                    <span className="text-base">{n.icon}</span>
                    <span>{n.label}</span>
                  </Link>
                );
              })}
              <Link
                href="/help/professor"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:text-indigo-800 hover:bg-indigo-50 transition"
              >
                <div className="flex items-center gap-2.5">
                  <span>📖</span>
                  <span>راهنمای استاد</span>
                </div>
                <span className="text-3xs bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">راهنما</span>
              </Link>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
