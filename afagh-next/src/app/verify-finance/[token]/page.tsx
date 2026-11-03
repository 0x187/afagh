import { verifyFinanceStatement } from '@/lib/verification';
import { studentPhotoDataUrl, universityBrand } from '@/lib/verify-assets';
import NationalIdCheck from '@/components/NationalIdCheck';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

const faNum = (n: unknown) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

const faMoney = (n: number) => Number(n || 0).toLocaleString('fa-IR');

/**
 * استعلام برخط کارنامهٔ مالی دانشجو — بدون نیاز به ورود؛ مقصد QR روی برگهٔ چاپی.
 * توکن باید امضای HMAC سامانه را داشته باشد (از «امور مالی» در پنل
 * دانشجو یا از کارشناس مالی صادر می‌شود). ارقام به‌صورت زنده از دفتر کل
 * خوانده می‌شود؛ توکن نامعتبر/منقضی صریحاً رد می‌شود.
 */
export default async function VerifyFinancePage({ params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken).trim();
  const res = await verifyFinanceStatement(token);

  if (!res.ok) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 font-sans text-slate-100" dir="rtl">
        <div className="w-full max-w-lg">
          <div className="space-y-4 rounded-3xl border-2 border-rose-500 bg-slate-900 p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-rose-950 text-4xl text-rose-400">
              ✕
            </div>
            <div>
              <h2 className="text-xl font-black text-rose-400">
                {res.reason === 'EXPIRED'
                  ? 'کارنامهٔ مالی منقضی شده است'
                  : res.reason === 'EMPTY'
                    ? 'تراکنش مالی برای استعلام وجود ندارد'
                    : 'کارنامهٔ مالی نامعتبر است'}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-slate-300">{res.message}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 text-2xs leading-5 text-slate-400">
              دانشجو باید از مسیر <span className="font-mono text-slate-200">پنل دانشجو ← امور مالی و شهریه</span> توکن تازه
              دریافت کند.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const [photo, brand] = await Promise.all([
    studentPhotoDataUrl(res.userId),
    universityBrand(res.universityId),
  ]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 font-sans text-slate-100" dir="rtl">
      <div className="w-full max-w-2xl space-y-5 rounded-3xl border border-emerald-900/60 bg-slate-900 p-6 shadow-2xl">
        {/* سربرگ */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt="ارم دانشگاه" className="h-10 w-10 rounded-2xl bg-white/95 object-contain p-1" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-base font-black text-white">آ</div>
            )}
            <div>
              <h1 className="text-sm font-black text-white">کارنامهٔ مالی دانشجو — دانشگاه آفاق</h1>
              <p className="text-2xs text-emerald-300">استعلام برخط · جمع کل دوره</p>
            </div>
          </div>
          <span className="rounded-full border border-emerald-600/50 bg-emerald-950 px-2.5 py-1 text-3xs font-black text-emerald-300">
            ✓ معتبر
          </span>
        </div>

        {/* مشخصات دانشجو */}
        <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs">
          <div className="flex items-start gap-3">
            <div className="h-20 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
              {photo ? (
                <img src={photo} alt="عکس دانشجو" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl text-slate-500">👤</div>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">نام دانشجو:</span>
                <span className="font-black text-white">{res.studentName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">شمارهٔ دانشجویی:</span>
                <span className="font-mono font-bold text-amber-300" dir="ltr">{res.studentCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">کد ملی:</span>
                <span className="font-mono font-bold text-slate-200" dir="ltr">{res.nationalIdMasked}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">رشتهٔ تحصیلی:</span>
                <span className="text-slate-200">{res.majorName ?? '—'}</span>
              </div>
            </div>
          </div>
        </div>

        <NationalIdCheck token={token} dark />

        {/* جمع کل */}
        <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <p className="text-base font-black text-white">{faMoney(res.totals.charges)}</p>
            <p className="mt-1 text-3xs text-slate-400">جمع شهریه (ریال)</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <p className="text-base font-black text-violet-300">{faMoney(res.totals.discounts)}</p>
            <p className="mt-1 text-3xs text-slate-400">تخفیف‌ها</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <p className="text-base font-black text-indigo-300">{faMoney(res.totals.payments)}</p>
            <p className="mt-1 text-3xs text-slate-400">پرداخت‌ها</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <p className={`text-base font-black ${res.totals.balance > 0 ? 'text-rose-400' : 'text-emerald-300'}`}>
              {faMoney(Math.abs(res.totals.balance))}
            </p>
            <p className="mt-1 text-3xs text-slate-400">
              {res.totals.balance > 0 ? 'ماندهٔ بدهی' : res.totals.balance < 0 ? 'بستانکاری' : 'تسویه'}
            </p>
          </div>
        </div>

        {/* ریز ترم‌به‌ترم */}
        <div className="space-y-2 text-xs">
          <h2 className="font-bold text-slate-300">📋 ریز ترم‌به‌ترم:</h2>
          <div className="overflow-x-auto rounded-2xl border border-slate-800">
            <table className="w-full text-right rt">
              <thead className="bg-slate-950 text-slate-400">
                <tr>
                  <th className="p-2">نیمسال</th>
                  <th className="p-2">شهریه</th>
                  <th className="p-2">تخفیف</th>
                  <th className="p-2">پرداخت</th>
                  <th className="p-2">مانده</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {res.terms.map((t, i) => (
                  <tr key={i}>
                    <td className="p-2 font-bold text-white">{t.termTitle}</td>
                    <td className="p-2 text-slate-300">{faMoney(t.charges)}</td>
                    <td className="p-2 text-violet-300">{faMoney(t.discounts)}</td>
                    <td className="p-2 text-emerald-300">{faMoney(t.payments)}</td>
                    <td className={`p-2 font-bold ${t.balance > 0 ? 'text-rose-400' : 'text-emerald-300'}`}>
                      {faMoney(Math.abs(t.balance))}
                      {t.balance > 0 ? ' (بدهکار)' : t.balance < 0 ? ' (بستانکار)' : ' (تسویه)'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {res.totals.chequesPending > 0 && (
          <p className="text-center text-2xs text-amber-300">
            ⚠️ {faNum(res.totals.chequesPending)} ریال چک وصول‌نشده — در مانده لحاظ نشده است
          </p>
        )}

        <div className="text-center font-mono text-3xs text-slate-500">
          استعلام زنده در {new Date(res.checkedAt).toLocaleString('fa-IR')}
        </div>

        <PrintButton />
      </div>
    </div>
  );
}
