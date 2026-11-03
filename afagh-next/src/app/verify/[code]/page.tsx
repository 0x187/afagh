import React from 'react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { rateLimit } from '@/lib/rateLimit';
import { verifyCertificate, type CertificateVerification } from '@/lib/verification';

export const dynamic = 'force-dynamic';

// 🔒 M-1: سقف استعلام اصالت از هر IP (ضد شمارش/بروت‌فورس کدهای رهگیری)
async function verifyQuota(): Promise<boolean> {
  try {
    const h = await headers();
    const ip = (h.get('x-forwarded-for') || '').split(',')[0]?.trim() || h.get('x-real-ip') || 'local';
    const r = await rateLimit(`verify-legacy:${ip}`, 15, 10 * 60);
    return r.ok;
  } catch {
    return true;
  }
}

const faDigits = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]));

/** درگاه استعلام قدیمی — اکنون فقط از پایگاه دادهٔ واقعی می‌خواند (هیچ دادهٔ نمونه‌ای در کد نیست) */
export default async function VerifyLegacyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode).trim().toUpperCase();

  // 🔒 M-1: در صورت عبور از سقف استعلام، به‌جای داده، پیام محدودیت نمایش داده می‌شود
  if (!(await verifyQuota())) {
    return (
      <div className="min-h-screen bg-slate-100 font-sans flex flex-col items-center py-10 px-4" dir="rtl">
        <div className="bg-white p-8 rounded-3xl shadow-xl border-t-4 border-amber-500 text-center space-y-3 max-w-lg">
          <p className="text-4xl">⏳</p>
          <h1 className="text-lg font-black text-slate-900">تعداد استعلام‌ها بیش از حد مجاز شد</h1>
          <p className="text-xs text-slate-500 font-bold">چند دقیقهٔ دیگر دوباره تلاش کنید.</p>
          <Link href="/" className="inline-block mt-2 text-xs font-bold text-indigo-700 underline">بازگشت به صفحهٔ اصلی</Link>
        </div>
      </div>
    );
  }

  let cert: CertificateVerification | null = null;
  let lookupError = '';
  try {
    cert = await verifyCertificate(code);
  } catch (err) {
    lookupError = (err as Error)?.message || 'خطا در استعلام.';
  }

  const notFound = !cert || cert.verdict === 'NOT_FOUND' || !!lookupError;
  type Verified = Exclude<CertificateVerification, { verdict: 'NOT_FOUND' }>;
  const data = !cert || cert.verdict === 'NOT_FOUND' ? null : (cert as Verified);
  const isTampered = data?.verdict === 'TAMPERED';
  const isRevoked = data?.verdict === 'REVOKED';
  const isValid = data?.verdict === 'VALID';

  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col items-center py-10 px-4" dir="rtl">
      {/* هدر رسمی دانشگاه */}
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-gradient-to-tr from-indigo-950 to-indigo-800 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg text-white font-black text-2xl border-2 border-amber-400">
          آ
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900">سامانه اصالت‌سنجی مدارک رسمی</h1>
        <p className="text-xs text-slate-500 mt-1 font-bold">دانشگاه غیرانتفاعی آفاق ارومیه · مرکز آموزش‌های آزاد</p>
      </div>

      <div className="w-full max-w-lg space-y-4">
        {notFound && (
          <div className="bg-white p-8 rounded-3xl shadow-xl border-t-4 border-rose-500 text-center animate-fadeIn space-y-4">
            <div className="w-20 h-20 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900">گواهینامه‌ای با این کد یافت نشد</h2>
              <p className="text-xs text-slate-600 mt-2 leading-6">
                کد رهگیری <span className="font-mono text-rose-600 font-black tracking-widest text-sm" dir="ltr">{code}</span> در پایگاه دادهٔ دانشگاه آفاق یافت نشد. این سند فاقد هرگونه اعتبار قانونی است.
                {lookupError && <span className="block text-2xs text-amber-700 mt-1 font-bold">{lookupError}</span>}
              </p>
            </div>
            <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
              <Link href="/open-courses" className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition">
                کاتالوگ دوره‌های معتبر
              </Link>
              <Link href="/verify-certificate" className="px-5 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 font-bold text-xs transition">
                🔎 استعلام با شمارهٔ سریال رسمی
              </Link>
            </div>
          </div>
        )}

        {(isTampered || isRevoked) && data && (
          <div className="bg-white p-8 rounded-3xl shadow-xl border-t-4 border-amber-500 text-center animate-fadeIn space-y-4">
            <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto shadow-inner text-4xl">
              {isRevoked ? '⛔' : '⚠️'}
            </div>
            <h2 className="text-xl font-black text-slate-900">{isRevoked ? 'این گواهینامه باطل شده است' : 'هشدار: اثر انگشت دیجیتال ناهمخوان است'}</h2>
            <p className="text-xs text-slate-600 leading-6">{data.message}</p>
            <div className="grid grid-cols-2 gap-2.5 text-2xs font-bold">
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100"><p className="text-slate-500">شمارهٔ گواهینامه</p><p className="font-mono text-slate-900 mt-0.5" dir="ltr">{data.certificateNumber}</p></div>
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100"><p className="text-slate-500">نام فراگیر</p><p className="text-slate-900 mt-0.5">{data.fullNameFa}</p></div>
            </div>
          </div>
        )}

        {isValid && data && (
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-200 animate-fadeIn">
            <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-6 text-center text-white space-y-2">
              <div className="w-16 h-16 bg-white text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-md">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-black">اصالت گواهینامه رسماً تأیید شد</h2>
              <p className="text-emerald-100 text-xs tracking-widest font-mono font-bold" dir="ltr">کد رهگیری: {data.certificateNumber}</p>
            </div>

            <div className="p-6 sm:p-7 space-y-6 text-xs">
              <div>
                <h3 className="text-2xs font-black text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3">👤 مشخصات هویتی فراگیر</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <p className="text-2xs text-slate-500 font-bold">نام و نام خانوادگی:</p>
                    <p className="font-black text-slate-900 text-sm mt-0.5">{data.fullNameFa}</p>
                    <p className="font-mono text-3xs text-slate-400 mt-0.5" dir="ltr">{data.fullNameEn}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <p className="text-2xs text-slate-500 font-bold">کد ملی (ماسک‌شده):</p>
                    <p className="font-mono font-black text-slate-900 text-sm mt-0.5 tracking-widest" dir="ltr">{data.nationalIdMasked}</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-2xs font-black text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3">🎓 مشخصات دوره و ارزیابی</h3>
                <div className="space-y-2.5">
                  <div className="bg-indigo-50/70 p-3 rounded-2xl border border-indigo-100">
                    <p className="text-2xs text-indigo-950 font-bold">عنوان دورهٔ تخصصی:</p>
                    <p className="font-black text-indigo-950 text-sm mt-0.5">{data.courseTitleFa}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-100">
                      <p className="text-3xs text-slate-500 font-bold">استاد و ارزیاب دوره:</p>
                      <p className="font-bold text-slate-800 text-xs mt-0.5">{data.instructorName}</p>
                    </div>
                    <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-100">
                      <p className="text-3xs text-slate-500 font-bold">طول مدت دوره:</p>
                      <p className="font-mono font-bold text-slate-800 text-xs mt-0.5">{faDigits(data.courseHours)} ساعت</p>
                    </div>
                    <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-100">
                      <p className="text-3xs text-slate-500 font-bold">تاریخ صدور رسمی:</p>
                      <p className="font-mono font-bold text-slate-800 text-xs mt-0.5">{faDigits(data.issueDate)}</p>
                    </div>
                    <div className="bg-emerald-50 p-2.5 rounded-2xl border border-emerald-100">
                      <p className="text-3xs text-emerald-800 font-bold">نمرهٔ نهایی فراگیر:</p>
                      <p className="font-mono font-black text-emerald-800 text-sm mt-0.5">{faDigits(data.grade)} از ۲۰</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-4 text-center text-2xs text-slate-500 border-t border-slate-200 space-y-1 font-bold">
              <p>🔒 اثر انگشت امنیتی: <span className="font-mono" dir="ltr">{String(data.verificationHash).slice(0, 20)}…</span></p>
              <p>این استعلام به‌صورت برخط و مستقیماً از پایگاه دادهٔ امن دانشگاه آفاق صادر شده است.</p>
            </div>
          </div>
        )}

        <div className="text-center">
          <Link href="/open-courses" className="text-xs text-indigo-900 font-bold hover:underline">← بازگشت به صفحهٔ اصلی دوره‌های آموزشی</Link>
        </div>
      </div>
    </div>
  );
}
