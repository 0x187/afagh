import React from 'react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function VerifyIndexPage() {
  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col items-center justify-center py-12 px-4" dir="rtl">
      <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full border border-slate-200 text-center space-y-5">
        <div className="w-16 h-16 bg-gradient-to-tr from-indigo-950 to-indigo-800 rounded-full flex items-center justify-center mx-auto shadow-lg text-white font-black text-2xl border-2 border-amber-400">
          آ
        </div>

        <div>
          <h1 className="text-xl font-black text-slate-900">سامانه استعلام مدارک و گواهینامه‌ها</h1>
          <p className="text-xs text-slate-500 mt-1 font-bold">دانشگاه غیرانتفاعی آفاق ارومیه</p>
        </div>

        <form action="/verify/search" method="GET" className="space-y-3">
          <input
            type="text"
            name="code"
            placeholder="کد استعلام (مثال: AFG-984A-23X9)"
            className="w-full border border-slate-300 rounded-2xl p-3 text-center font-mono font-bold text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            dir="ltr"
            required
          />
          <button
            type="submit"
            className="w-full py-3 rounded-2xl bg-indigo-900 hover:bg-indigo-950 text-white font-black text-xs shadow-md transition"
          >
            🔍 استعلام اصالت گواهینامه
          </button>
        </form>

        <div className="text-2xs text-slate-500 pt-3 border-t border-slate-100 space-y-1">
          <p className="font-bold">کد استعلام روی کاغذِ گواهینامه/مدرک درج شده است. استعلام فقط از پایگاه دادهٔ رسمی دانشگاه انجام می‌شود.</p>
          <div className="flex flex-wrap gap-2 justify-center pt-1">
            <Link href="/verify-degree" className="text-indigo-600 hover:underline">استعلام دانشنامه/گواهینامهٔ تحصیلی</Link>
            <span className="text-slate-300">·</span>
            <Link href="/verify-certificate" className="text-indigo-600 hover:underline">استعلام گواهینامهٔ دورهٔ آزاد</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
