import Link from 'next/link';
import { verifyStudentCard } from '@/lib/verification';
import { studentPhotoDataUrl, universityBrand } from '@/lib/verify-assets';
import NationalIdCheck from '@/components/NationalIdCheck';

export const dynamic = 'force-dynamic';

const faNum = (n: unknown) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

const jalali = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fa-IR');
};

/**
 * گیت حراست — استعلام برخط کارت دانشجویی.
 *
 * توکن از جدول `student_cards` خوانده می‌شود؛ توکن ناشناخته صریحاً «نامعتبر»
 * است و هیچ دانشجوی فرضی ساخته نمی‌شود (پیش‌تر هر توکنی که با 7F یا AF شروع
 * می‌شد یک دانشجوی فعالِ جعلی نشان می‌داد).
 */
export default async function StudentCardGatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken).trim();
  const res = await verifyStudentCard(token);

  if (res.verdict === 'NOT_FOUND') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 font-sans text-slate-100" dir="rtl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-xl font-black text-white shadow-lg shadow-indigo-600/40">آ</div>
          <h1 className="text-base font-black text-white sm:text-lg">سامانهٔ گیت حراست و استعلام کارت دانشجویی</h1>
          <p className="text-xs text-indigo-300">AFAGH University Smart ID & Campus Security Live Verification</p>
        </div>
        <div className="w-full max-w-md">
          <div className="space-y-4 rounded-3xl border-2 border-rose-500 bg-slate-900 p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-rose-600/50 bg-rose-950 text-4xl text-rose-400">✕</div>
            <div>
              <h2 className="text-xl font-black text-rose-400">کارت دانشجویی نامعتبر / فاقد هویت</h2>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                توکن امنیتی <span className="font-mono font-black text-white" dir="ltr">{token || '—'}</span> در جدول
                کارت‌های صادرشدهٔ دانشگاه ثبت نشده است.
              </p>
            </div>
            <div className="rounded-2xl border border-rose-800 bg-rose-950/40 p-3 text-xs font-bold text-rose-200">
              ⛔ ورود به محوطهٔ دانشگاه و اماکن آموزشی مجاز نیست.
            </div>
          </div>
          <div className="pt-4 text-center">
            <Link prefetch={false} href="/id" className="text-xs text-indigo-400 hover:underline">← بازگشت به اسکنر حراست</Link>
          </div>
        </div>
      </div>
    );
  }

  const tone = res.allowed ? 'border-emerald-500 shadow-emerald-950/50' : 'border-rose-500 shadow-rose-950/50';

  // عکس دانشجو + ارم دانشگاه: گیت حراست با همین دو تصویر هویت را تطبیق می‌دهد
  const [photo, brand] = await Promise.all([
    studentPhotoDataUrl(res.userId),
    universityBrand(res.universityId),
  ]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 font-sans text-slate-100" dir="rtl">
      <div className="mb-6 text-center">
        {brand.logoUrl ? (
          <img src={brand.logoUrl} alt="ارم دانشگاه" className="mx-auto mb-2 h-14 w-14 rounded-2xl bg-white/95 object-contain p-1 shadow-lg" />
        ) : (
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-xl font-black text-white shadow-lg shadow-indigo-600/40">آ</div>
        )}
        <h1 className="text-base font-black text-white sm:text-lg">سامانهٔ گیت حراست و استعلام کارت دانشجویی</h1>
        <p className="text-xs text-indigo-300">{brand.title ?? 'دانشگاه غیرانتفاعی آفاق ارومیه'} — استعلام برخط زنده</p>
      </div>

      <div className="w-full max-w-md">
        <div className={`overflow-hidden rounded-3xl border-2 bg-slate-900 shadow-2xl ${tone}`}>
          {/* بنر وضعیت */}
          <div className={`flex items-center justify-center gap-2 p-4 text-center text-sm font-black text-white ${res.allowed ? 'bg-emerald-600' : 'bg-rose-600'}`}>
            <span className="text-xl">{res.allowed ? '✓' : '⛔'}</span>
            <span>{res.reason}</span>
          </div>

          <div className="space-y-5 p-6 text-xs">
            <div className="flex items-center gap-4">
              <div className="h-28 w-24 shrink-0 overflow-hidden rounded-2xl border-2 border-indigo-400/50 bg-indigo-950 shadow-md">
                {photo ? (
                  <img src={photo} alt="عکس دانشجو" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center text-indigo-300">
                    <span className="text-4xl">👨‍🎓</span>
                    <span className="mt-1 text-[9px] font-bold text-slate-400">بدون عکس</span>
                  </div>
                )}
              </div>
              <div className="space-y-1">
                {res.degreeLevel && (
                  <span className="rounded bg-indigo-900/80 px-2 py-0.5 text-3xs font-bold text-indigo-300">{res.degreeLevel}</span>
                )}
                <h3 className="text-base font-black text-white">{res.fullName}</h3>
                <p className="font-bold text-slate-300">{res.majorName ?? 'رشتهٔ ثبت‌نشده'}</p>
                <p className="font-mono text-2xs text-slate-400">ورودی: {faNum(res.entranceYear)}</p>
              </div>
            </div>

            <div className="space-y-2.5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">شمارهٔ دانشجویی:</span>
                <span className="font-mono text-sm font-black tracking-wider text-amber-300" dir="ltr">{res.studentCode}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">کد ملی:</span>
                <span className="font-mono font-bold text-slate-200" dir="ltr">{res.nationalIdMasked}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">شناسهٔ RFID:</span>
                <span className="font-mono text-3xs text-slate-400" dir="ltr">{res.rfidSerialNumber ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">وضعیت تحصیلی:</span>
                <span className="font-bold text-slate-200">{res.statusLabel}</span>
              </div>
              {res.debt > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">بدهی مالی:</span>
                  <span className="font-mono font-bold text-rose-300">{faNum(res.debt)} ریال</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-slate-800 pt-2">
                <span className="text-slate-400">تاریخ انقضای کارت:</span>
                <span className="font-mono font-bold text-indigo-300">{jalali(res.expiresAt)}</span>
              </div>
            </div>

            <NationalIdCheck token={token} dark />

            {!res.allowed && (
              <div className="rounded-2xl border border-rose-700/80 bg-rose-950/70 p-3 text-xs font-bold leading-5 text-rose-200">
                ⚠️ <b>علت ممانعت سیستمی:</b> {res.reason}
              </div>
            )}

            <div className="pt-1 text-center font-mono text-3xs text-slate-500">
              استعلام زنده از پایگاه دادهٔ مرکزی · {new Date(res.checkedAt).toLocaleString('fa-IR')}
            </div>
          </div>
        </div>

        <div className="pt-4 text-center">
          <Link prefetch={false} href="/id" className="text-xs text-indigo-400 hover:underline">← بازگشت به اسکنر دوربین حراست</Link>
        </div>
      </div>
    </div>
  );
}
