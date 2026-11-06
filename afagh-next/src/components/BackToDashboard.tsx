'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BACK_BTN_CLASS } from '@/lib/back-button';

/**
 * دکمهٔ «بازگشت به داشبورد/کارتابل» — در همهٔ زیرصفحه‌های هر پنل.
 *
 * چرا کامپوننت کلاینت است؟ چیدمان (layout) در App Router مسیر جاری را نمی‌بیند،
 * پس نمی‌تواند بداند کاربر روی ریشهٔ پنل است یا داخل یک ماژول. با `usePathname`
 * همین یک قطعه در layout هر پنل گذاشته می‌شود و روی **همهٔ** زیرصفحه‌ها ظاهر
 * می‌گردد — بدون نیاز به تکرار در ده‌ها `page.tsx`.
 *
 * روی ریشهٔ همان پنل (`/admin`، `/professor`، `/student`) رندر نمی‌شود، چون
 * دکمهٔ «بازگشت به جایی که همین‌جا هستید» بی‌معناست.
 *
 * 📍 جای دکمه: **سمت چپ** صفحه. سامانه RTL است (`<html dir="rtl">`)، پس
 * `justify-end` در محور افقی یعنی لبهٔ چپ. با کلاس منطقی نوشته شده تا اگر
 * روزی بخشی LTR شد، جای دکمه هم درست بماند.
 */
export default function BackToDashboard({
  href,
  label = 'بازگشت به داشبورد',
  className = '',
  wrapClassName = 'mb-2',
}: {
  /** ریشهٔ پنل — مثلاً `/admin` */
  href: string;
  label?: string;
  /** کلاس خودِ لینک (برای هم‌رنگ شدن با تم هر پنل) */
  className?: string;
  /** کلاس ظرف بیرونی (فاصله/چیدمان) */
  wrapClassName?: string;
}) {
  const pathname = usePathname();
  // ریشه یا هر مسیری که به آن برمی‌گردیم → دکمه لازم نیست
  if (pathname === href) return null;

  return (
    <div className={`flex justify-end print:hidden ${wrapClassName}`}>
      <Link prefetch={false}
        href={href}
        className={className || BACK_BTN_CLASS}
      >
        <span aria-hidden>→</span>
        {label}
      </Link>
    </div>
  );
}
