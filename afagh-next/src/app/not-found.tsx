import Link from 'next/link';

/**
 * صفحهٔ ۴۰۴ سراسری. تا امروز Next صفحهٔ پیش‌فرضِ انگلیسیِ خودش را نشان
 * می‌داد که در سامانه‌ای تماماً فارسی و راست‌به‌چپ، مثل خرابیِ سایت به نظر
 * می‌رسید و هیچ راه بازگشتی به کاربر نمی‌داد.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-8 text-center space-y-5 border border-slate-200">
        <div className="text-5xl">🧭</div>
        <div>
          <h1 className="text-2xl font-black text-slate-900">صفحه پیدا نشد</h1>
          <p className="text-xs text-slate-500 mt-2 font-bold leading-6">
            نشانی‌ای که باز کرده‌اید وجود ندارد، جابه‌جا شده، یا دسترسی به آن برای نقش شما تعریف نشده است.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          <Link prefetch={false} href="/" className="px-5 py-2.5 rounded-2xl bg-indigo-900 hover:bg-indigo-950 text-white font-black text-xs shadow-md transition">
            بازگشت به صفحهٔ نخست
          </Link>
          <Link prefetch={false} href="/verify" className="px-5 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs transition">
            سامانهٔ استعلام مدارک
          </Link>
        </div>
      </div>
    </main>
  );
}
