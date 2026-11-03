'use client';

import { useEffect } from 'react';

/**
 * مرز خطای سراسری برای صفحه‌ها. بدون این فایل، هر خطای رندر در سرور به
 * صفحهٔ سفیدِ انگلیسیِ Next ختم می‌شد و کاربر حتی دکمهٔ «تلاش دوباره» نداشت.
 *
 * نکتهٔ امنیتی: متن خطا هرگز به کاربر نشان داده نمی‌شود (ممکن است نام جدول،
 * کوئری یا مسیر فایل در آن باشد)؛ فقط `digest` نمایش داده می‌شود تا کاربر
 * بتواند همان شناسه را به پشتیبانی بدهد و ما در لاگ سرور پیدایش کنیم.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[UI error]', error);
  }, [error]);

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-8 text-center space-y-5 border border-slate-200">
        <div className="text-5xl">⚠️</div>
        <div>
          <h1 className="text-2xl font-black text-slate-900">خطایی رخ داد</h1>
          <p className="text-xs text-slate-500 mt-2 font-bold leading-6">
            پردازش این صفحه ناتمام ماند. داده‌ای ثبت یا حذف نشده است؛ می‌توانید دوباره تلاش کنید.
          </p>
          {error.digest && (
            <p className="text-2xs text-slate-400 mt-3 font-mono" dir="ltr">
              کد پیگیری: {error.digest}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          <button
            onClick={reset}
            className="px-5 py-2.5 rounded-2xl bg-indigo-900 hover:bg-indigo-950 text-white font-black text-xs shadow-md transition"
          >
            تلاش دوباره
          </button>
          <a href="/" className="px-5 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs transition">
            بازگشت به صفحهٔ نخست
          </a>
        </div>
      </div>
    </main>
  );
}
