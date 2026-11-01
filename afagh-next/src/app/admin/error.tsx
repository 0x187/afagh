'use client';

import { useEffect } from 'react';

/**
 * مرزِ خطای بخش «مدیریت» — به‌جای صفحهٔ سفیدِ «Application error» پیام واقعی را
 * نشان می‌دهد تا گزارش کاربر قابل پیگیری باشد.
 *
 * نکته: اگر پیام «Failed to find Server Action» بود، علت نسخهٔ کهنهٔ مرورگر است
 * (VersionGuard باید نوار بازخوانی را نشان داده باشد)؛ با reload کامل رفع می‌شود.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[admin-error-boundary]', error);
    // استک را به لاگ سرور می‌فرستیم تا عیب‌یابی بدون اسکرین‌شات کاربر ممکن باشد
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        where: 'admin/error.tsx',
        url: window.location.href,
        message: error?.message,
        stack: error?.stack,
      }),
    }).catch(() => {});
  }, [error]);

  const msg = String(error?.message ?? '');
  const staleBundle = /Failed to find Server Action|Server Action .* was not found/i.test(msg);

  return (
    <div dir="rtl" className="mx-auto max-w-xl p-6">
      <div className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-extrabold text-slate-900">
          {staleBundle ? 'نسخهٔ صفحه قدیمی است' : 'خطا در اجرای این صفحه'}
        </h2>

        {staleBundle ? (
          <p className="mt-2 text-xs leading-6 text-slate-600">
            سامانه به‌روزرسانی شده ولی این تب هنوز باندل قدیمی را اجرا می‌کند. یک‌بار صفحه را کامل بازخوانی کنید؛
            داده‌های ثبت‌شدهٔ قبلی دست‌نخورده‌اند.
          </p>
        ) : (
          <p className="mt-2 text-xs leading-6 text-slate-600">
            اگر تکرار شد، متن زیر را برای پشتیبانی بفرستید (کد پیگیری برای یافتن خطا در لاگ سرور لازم است).
          </p>
        )}

        <pre
          dir="ltr"
          className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-700"
        >
          {msg || 'خطای نامشخص'}
          {error?.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-700"
          >
            بازخوانی صفحه
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            تلاش دوباره
          </button>
        </div>
      </div>
    </div>
  );
}
