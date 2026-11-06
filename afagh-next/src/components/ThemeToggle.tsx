'use client';

import { useEffect, useState } from 'react';

/**
 * کلید تم روشن/تیره.
 *
 * دو تغییر مهم نسبت به نسخهٔ پیشین:
 *  ۱) دیگر تا mount شدن `null` برنمی‌گرداند. قبلاً دکمه بعد از اولین paint
 *     ظاهر می‌شد و نوار ابزار هدر یک پرش چیدمان (CLS) می‌خورد؛ حالا دکمه از
 *     همان ابتدا با ابعاد ثابت رندر می‌شود و فقط آیکونش تا مشخص‌شدن وضعیت
 *     پنهان است.
 *  ۲) وضعیت اولیه از کلاس `dark` روی <html> خوانده می‌شود (که اسکریپت
 *     ضدفلش در app/layout.tsx پیش از paint ست کرده است)، نه از localStorage؛
 *     این‌طور حالت مرورگر با حالتِ واقعیِ صفحه همیشه یکی است.
 * `aria-pressed` هم اضافه شد تا وضعیت کلید برای screen reader معلوم باشد.
 */
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* حالت приват/سهمیه‌پر — فقط ظاهر جابه‌جا می‌شود، خطا نباید بالا برود */
    }
    document.documentElement.classList.toggle('dark', next);
    document.documentElement.style.colorScheme = next ? 'dark' : 'light';
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'حالت روز' : 'حالت شب'}
      aria-pressed={dark}
      title={dark ? 'حالت روز' : 'حالت شب'}
      className="h-9 w-9 shrink-0 grid place-items-center rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
    >
      <span aria-hidden className={mounted ? 'contents' : 'invisible'}>
        {dark ? (
          <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-slate-600 dark:text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        )}
      </span>
    </button>
  );
}
