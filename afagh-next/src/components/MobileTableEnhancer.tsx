'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * لایهٔ موبایل (طرح چهارلایه): برای هر جدولِ دارای کلاس `rt`، متنِ هر ستونِ
 * سرآیند (thead) را به عنوان `data-label` روی سلول‌های بدنه (td) تزریق می‌کند
 * تا در نمای «کارت به ازای هر سطر» برچسبِ هر فیلد نمایش داده شود.
 *
 * این کار روی DOM پس از رندر انجام می‌شود (فقط setAttribute) و با هدایت‌های
 * سمت کلاینتِ Next نیز همگام می‌شود (بازاجرا به ازای هر تغییر مسیر).
 * صفحه‌ها بازنویسی نمی‌شوند.
 */
export default function MobileTableEnhancer() {
  const pathname = usePathname();

  useEffect(() => {
    // ⚡ گاردِ عملکردی: `data-label` فقط در چیدمانِ کارتیِ موبایل مصرف می‌شود
    // (`styles/mobile-tables.css` → `@media (max-width: 768px)`). روی دسکتاپ این
    // پیمایش هیچ اثری ندارد ولی هزینه‌اش واقعی است: برای هر جدول، هر ردیف و هر
    // سلول یک `setAttribute` + باطل‌شدن چیدمان. در صفحه‌های پرجدول (کارتابل‌ها،
    // کارنامه‌ها) همین یک تابع، رشتهٔ اصلی را صدها میلی‌ثانیه مشغول می‌کرد و
    // «لگِ» محسوس می‌ساخت. حالا روی عرض‌های بزرگ‌تر اصلاً اجرا نمی‌شود.
    if (typeof window === 'undefined' || !window.matchMedia('(max-width: 768px)').matches) return;

    const apply = () => {
      const tables = document.querySelectorAll<HTMLTableElement>('table.rt');
      tables.forEach((table) => {
        const headerRow = table.querySelector('thead tr');
        if (!headerRow) return;
        const headers = Array.from(headerRow.querySelectorAll('th')).map((th) =>
          (th.getAttribute('data-label') || th.textContent || '').trim()
        );
        table.querySelectorAll('tbody tr').forEach((tr) => {
          const cells = tr.querySelectorAll('td');
          cells.forEach((td, i) => {
            const label = headers[i];
            if (label && !td.hasAttribute('data-label')) {
              td.setAttribute('data-label', label);
            }
          });
        });
      });
    };

    // اجرا در زمانِ بی‌کاریِ مرورگر تا اولین تعاملِ کاربر (کلیک/اسکرول) معطل نماند.
    // اگر مرورگر `requestIdleCallback` ندارد، به تایمرِ کوتاه برمی‌گردیم.
    type IdleWin = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    const w = window as IdleWin;
    let idle: number | undefined;
    let t: number | undefined;
    if (typeof w.requestIdleCallback === 'function') {
      idle = w.requestIdleCallback(apply, { timeout: 600 });
    } else {
      t = window.setTimeout(apply, 120);
    }

    return () => {
      if (idle !== undefined && typeof w.cancelIdleCallback === 'function') w.cancelIdleCallback(idle);
      if (t !== undefined) window.clearTimeout(t);
    };
  }, [pathname]);

  return null;
}
