'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * ناوبریِ کارتابل مدیر گروه — نسخهٔ قرصی (pill) با حالتِ فعالِ واقعی.
 *
 * چرا کلاینت شد: پیش‌تر لینک‌ها در `layout.tsx` (سرور) رندر می‌شدند و هیچ‌کدام
 * نمی‌دانستند کدام صفحه باز است؛ نتیجه اینکه در همهٔ زیرصفحه‌ها همهٔ لینک‌ها
 * یک‌شکل بودند و کاربر جای خودش را گم می‌کرد. `usePathname` این را حل می‌کند.
 *
 * در موبایل نوار به‌صورت افقی اسکرول می‌شود (بدون شکستنِ خط) تا ارتفاعِ سربرگ
 * سه‌ردیفه نشود؛ اسکرول‌بار هم پنهان است تا ظاهر تمیز بماند.
 */

const ITEMS = [
  { href: '/group-manager', label: 'خانه', icon: '🏠', exact: true },
  { href: '/group-manager/courses', label: 'دروس گروه', icon: '📚' },
  { href: '/group-manager/offerings', label: 'ارائه‌های ترم', icon: '🗂️' },
  { href: '/group-manager/scheduling', label: 'برنامه‌ریزی درسی', icon: '🗓️' },
  { href: '/group-manager/grants', label: 'تخصیص درس ترم بالاتر', icon: '⬆️' },
  { href: '/group-manager/classrooms', label: 'کلاس‌ها', icon: '🏫' },
  { href: '/group-manager/equivalence', label: 'معادل‌سازی دروس', icon: '🔁' },
  { href: '/group-manager/bypass', label: 'درخواست‌های بدون پیش‌نیاز', icon: '⤴️' },
  { href: '/group-manager/compensatory', label: 'دانشجویان جبرانی', icon: '🧾' },
];

export default function GroupManagerNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="ناوبری کارتابل مدیر گروه"
      className="mx-auto max-w-7xl px-2 pb-2.5 sm:px-4"
    >
      <ul
        className="flex items-center gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {ITEMS.map(it => {
          const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
          return (
            <li key={it.href} className="shrink-0">
              <Link
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-bold transition-colors ${
                  active
                    ? 'bg-white text-teal-900 shadow-sm'
                    : 'text-teal-100/85 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span aria-hidden className="text-[13px] leading-none">{it.icon}</span>
                <span>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
