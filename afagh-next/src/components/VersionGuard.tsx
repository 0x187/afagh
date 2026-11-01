'use client';

import { useEffect, useState } from 'react';

/**
 * نگهبانِ نسخه — جلوی «دکمه‌هایی که بی‌صدا کار نمی‌کنند» را می‌گیرد.
 *
 * سناریو: کاربر تبِ باز دارد، ما deploy می‌کنیم. صفحهٔ بعدی که با ناوبری سمت
 * کلاینت باز می‌شود، RSC بیلدِ جدید را می‌گیرد ولی باندلِ JS همچنان قدیمی است؛
 * شناسهٔ Server Actionها در باندلِ قدیمی وجود ندارد، پس Next درخواست را با
 * «Failed to find Server Action» رد می‌کند و از دید کاربر «هیچ اتفاقی نمی‌افتد».
 *
 * این کامپوننت شناسهٔ نسخهٔ بیلدِ خودش را با پاسخِ /api/version مقایسه می‌کند و
 * در صورت تفاوت، نواری با دکمهٔ بازخوانی نشان می‌دهد. بازخوانی کامل (reload)
 * هم HTML تازه و هم چانک‌های تازه را می‌آورد و مشکل را رفع می‌کند.
 */
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

export default function VersionGuard() {
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // در توسعه (بدون شناسهٔ بیلد) هیچ بررسی‌ای لازم نیست
    if (!BUILD_ID || BUILD_ID === 'dev') return;

    let alive = true;

    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { id?: string };
        if (!alive) return;
        if (data.id && data.id !== BUILD_ID) setStale(true);
      } catch {
        // شبکه قطع یا سرور در حال restart — بررسی بعدی
      }
    };

    // بررسی اولیه کمی بعد از load تا بارگذاری صفحه کند نشود
    const first = window.setTimeout(check, 4000);
    const timer = window.setInterval(check, 60_000);

    // بازگشت به تب: محتمل‌ترین لحظهٔ برخورد با نسخهٔ کهنه
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  if (!stale || dismissed) return null;

  return (
    <div
      dir="rtl"
      role="alert"
      className="fixed inset-x-0 bottom-0 z-[9999] flex flex-wrap items-center justify-between gap-2 border-t border-amber-300 bg-amber-50 px-4 py-2.5 text-xs shadow-[0_-4px_16px_rgba(0,0,0,0.08)] print:hidden"
    >
      <span className="font-bold text-amber-900">
        🔄 نسخهٔ جدید سامانه منتشر شده است. تا صفحه بازخوانی نشود، دکمه‌ها و ذخیره‌سازی‌ها کار نمی‌کنند.
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-amber-600 px-3 py-1.5 font-bold text-white hover:bg-amber-700"
        >
          بازخوانی صفحه
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-lg border border-amber-300 px-2.5 py-1.5 font-medium text-amber-800 hover:bg-amber-100"
        >
          بعداً
        </button>
      </span>
    </div>
  );
}
