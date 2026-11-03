import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * درگاه استعلام دانشنامه/گواهینامهٔ تحصیلی.
 *
 * پیش از این فقط ‎/verify-degree/[code]‎ وجود داشت؛ یعنی هر کسی که روی پیوند
 * صفحهٔ ‎/verify‎ کلیک می‌کرد (یا کد را از روی مدرک داشت و آدرس را دستی می‌زد)
 * به صفحهٔ ۴۰۴ می‌رسید. این صفحه همان درگاهِ ورودِ کد است.
 */
export default function VerifyDegreeIndexPage() {
  return (
    <main className="min-h-screen bg-slate-100 font-sans flex flex-col items-center justify-center py-12 px-4" dir="rtl">
      <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full border border-slate-200 text-center space-y-5">
        <div className="w-16 h-16 bg-gradient-to-tr from-indigo-950 to-indigo-800 rounded-full flex items-center justify-center mx-auto shadow-lg text-white font-black text-2xl border-2 border-amber-400">
          آ
        </div>

        <div>
          <h1 className="text-xl font-black text-slate-900">استعلام اصالت مدرک تحصیلی</h1>
          <p className="text-xs text-slate-500 mt-1 font-bold">دانشگاه غیرانتفاعی آفاق ارومیه</p>
        </div>

        <form action="/verify-degree/search" method="GET" className="space-y-3">
          <input
            type="text"
            name="code"
            placeholder="کد استعلام روی مدرک"
            aria-label="کد استعلام مدرک"
            className="w-full border border-slate-300 rounded-2xl p-3 text-center font-mono font-bold text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            dir="ltr"
            required
          />
          <button
            type="submit"
            className="w-full py-3 rounded-2xl bg-indigo-900 hover:bg-indigo-950 text-white font-black text-xs shadow-md transition"
          >
            🎓 استعلام دانشنامه / گواهینامهٔ موقت
          </button>
        </form>

        <div className="text-2xs text-slate-500 pt-3 border-t border-slate-100 space-y-2">
          <p className="font-bold">
            کد استعلام زیر کد QR روی دانشنامه، گواهینامهٔ موقت یا ریزنمرات رسمی چاپ شده است.
            نتیجهٔ استعلام مستقیماً از پایگاه دادهٔ رسمی دانشگاه خوانده می‌شود.
          </p>
          <div className="flex flex-wrap gap-2 justify-center pt-1">
            <Link href="/verify" className="text-indigo-600 hover:underline">استعلام سایر مدارک</Link>
            <span className="text-slate-300">·</span>
            <Link href="/verify-certificate" className="text-indigo-600 hover:underline">گواهینامهٔ دورهٔ آزاد</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
