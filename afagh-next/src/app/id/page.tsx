'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { findCardTokenByStudentCodeAction } from './actions';

/**
 * اسکنر گیت حراست.
 *
 * دو مسیر استعلام واقعی:
 *   ۱) اسکن/ورود توکن امنیتی چاپ‌شده روی کارت (`student_cards.secureToken`)
 *   ۲) جست‌وجو با شمارهٔ دانشجویی وقتی QR خوانده نمی‌شود
 * دکمهٔ «سناریوی آزمایشی» با توکن‌های جعلی حذف شده است.
 */
export default function SecurityGuardScannerPage() {
  const router = useRouter();
  const [inputToken, setInputToken] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const openToken = (token: string) => {
    if (!token) return;
    router.push(`/id/${encodeURIComponent(token)}`);
  };

  const handleScanToken = (e: React.FormEvent) => {
    e.preventDefault();
    openToken(inputToken.trim());
  };

  const handleFindByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = studentCode.trim();
    if (!code) return;
    setBusy(true);
    setMessage('');
    const res = await findCardTokenByStudentCodeAction(code);
    setBusy(false);
    if (!res.ok) {
      setMessage(res.error || 'خطا در استعلام.');
      return;
    }
    if (!res.found) {
      setMessage(`برای شمارهٔ دانشجویی «${code}» کارتی صادر نشده است.`);
      return;
    }
    openToken(res.token);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 font-sans text-slate-100" dir="rtl">
      <div className="w-full max-w-md space-y-6 rounded-3xl border border-indigo-900/60 bg-slate-900 p-6 text-center shadow-2xl sm:p-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-700 to-indigo-500 text-2xl font-black text-white shadow-lg shadow-indigo-600/40">
          🛡️
        </div>

        <div>
          <h1 className="text-lg font-black text-white sm:text-xl">اپلیکیشن حراست و گیت ورود دانشگاه</h1>
          <p className="mt-1 text-xs font-bold text-indigo-300">استعلام برخط کارت دانشجویی از پایگاه دادهٔ مرکزی</p>
        </div>

        {/* نمای دوربین */}
        <div className="group relative flex h-48 w-full flex-col items-center justify-center space-y-2 overflow-hidden rounded-2xl border-2 border-dashed border-indigo-500/60 bg-slate-950">
          <div className="absolute inset-x-8 top-1/2 h-0.5 animate-pulse bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          <span className="text-3xl">📷</span>
          <span className="text-xs font-bold text-slate-400">بارکد کارت دانشجویی را در کادر قرار دهید</span>
        </div>

        {/* ورود دستی توکن */}
        <form onSubmit={handleScanToken} className="space-y-2">
          <input
            type="text"
            placeholder="توکن امنیتی چاپ‌شده روی کارت"
            value={inputToken}
            onChange={e => setInputToken(e.target.value)}
            className="w-full rounded-xl border border-indigo-700/60 bg-slate-950 p-3 text-center font-mono text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            dir="ltr"
          />
          <button type="submit" className="w-full rounded-xl bg-indigo-600 py-3 text-xs font-black text-white shadow-lg transition hover:bg-indigo-500">
            🔍 بررسی وضعیت کارت در پایگاه داده
          </button>
        </form>

        {/* جست‌وجو با شمارهٔ دانشجویی */}
        <form onSubmit={handleFindByCode} className="space-y-2 border-t border-slate-800 pt-4">
          <span className="block text-xs font-bold text-slate-400">اگر بارکد خوانده نشد، با شمارهٔ دانشجویی استعلام بگیرید:</span>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="شمارهٔ دانشجویی"
              value={studentCode}
              onChange={e => setStudentCode(e.target.value)}
              className="flex-1 rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-center font-mono text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
              dir="ltr"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-slate-800 px-4 text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
            >
              {busy ? '⏳' : 'استعلام'}
            </button>
          </div>
          {message && <p className="text-2xs font-bold text-amber-300">{message}</p>}
        </form>

        <div className="border-t border-slate-800 pt-3 text-2xs leading-5 text-slate-500">
          کارت‌ها از مسیر «امور دانشجویی ← صدور کارت» صادر می‌شوند. کارت باطل/مفقود/منقضی و دانشجوی دارای بدهی مالی
          به‌صورت سیستمی قرمز می‌شوند.
        </div>

        <Link href="/" className="block text-xs text-indigo-400 hover:underline">← بازگشت به سامانه</Link>
      </div>
    </div>
  );
}
