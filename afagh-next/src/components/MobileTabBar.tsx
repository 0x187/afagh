'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type TabItem = { href: string; label: string; icon?: string; exact?: boolean };

/**
 * نوار پایین موبایل (Bottom tab) — ۳ تا ۵ مقصد اصلی برای دسترسی سریع با شست
 * (الگوی Material Design 3 + توصیهٔ NN/g به ناوبری مرکب). فقط روی موبایل
 * (md:hidden) نمایش داده می‌شود؛ دسکتاپ منوی افقی خودش را نگه می‌دارد.
 *
 * ⚡ بهینه‌سازی پاسخ‌دهی لمسی (رفع «کندی دکمه‌ها» در موبایل):
 * - بدون backdrop-blur: بلورِ پس‌زمینه روی عنصر fixed، سنگین‌ترین عامل لگ
 *   اسکرول و تأخیر لمس در مرورگرهای موبایل است؛ پس‌زمینهٔ solid کافی است.
 * - touch-action: manipulation + tap-highlight شفاف: حذف تأخیر ~۳۰۰ میلی‌ثانیهٔ
 *   مرورگر برای تشخیص «دوبار-برای-زوم»، تا تب‌ها فوری پاسخ دهند.
 * - حالت active (مقیاس/رنگ): بازخورد لمسی فوری به‌جای انتظار برای تغییر صفحه.
 */
export default function MobileTabBar({
  items,
  activeClass = 'text-indigo-700',
}: {
  items: TabItem[];
  activeClass?: string;
}) {
  const pathname = usePathname();
  return (
    <nav
      dir="rtl"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-slate-200 print:hidden"
      style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
      aria-label="ناوبری اصلی موبایل"
    >
      <div className="max-w-md mx-auto flex items-stretch justify-around px-1 py-1">
        {items.map(it => {
          const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
          return (
            <Link prefetch={false}
              key={it.href}
              href={it.href}
              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition active:bg-slate-100 active:scale-95 ${
                active ? `${activeClass} font-bold` : 'text-slate-500'
              }`}
            >
              {it.icon && <span className="text-base leading-none">{it.icon}</span>}
              <span className="text-2xs leading-tight text-center">{it.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
