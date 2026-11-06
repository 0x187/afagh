import Link from 'next/link';
import { verifyExamTicket } from '@/lib/verification';
import { studentPhotoDataUrl, universityBrand } from '@/lib/verify-assets';
import NationalIdCheck from '@/components/NationalIdCheck';

export const dynamic = 'force-dynamic';

const faNum = (n: unknown) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * گیت ورود به حوزهٔ امتحانات — استعلام برخط کارت ورود به جلسه.
 *
 * توکن باید امضای HMAC سامانه را داشته باشد (از دکمهٔ «کارت ورود به جلسه» در
 * پنل دانشجو صادر می‌شود). پیش‌تر هر توکن ناشناخته یک کارت معتبرِ جعلی با
 * «تسویهٔ مالی قطعی» نشان می‌داد؛ حالا توکن نامعتبر/منقضی صریحاً رد می‌شود و
 * بدهی مالی مانع صدور می‌گردد.
 */
export default async function ExamTicketGatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken).trim();
  const res = await verifyExamTicket(token);

  if (!res.ok) {
    const tone = res.reason === 'NOT_CLEARED' ? 'amber' : 'rose';
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 font-sans text-slate-100" dir="rtl">
        <div className="w-full max-w-lg">
          <div className={`space-y-4 rounded-3xl border-2 p-6 text-center shadow-2xl ${tone === 'amber' ? 'border-amber-500 bg-slate-900' : 'border-rose-500 bg-slate-900'}`}>
            <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full text-4xl ${tone === 'amber' ? 'bg-amber-950 text-amber-300' : 'bg-rose-950 text-rose-400'}`}>
              {tone === 'amber' ? '⚠' : '✕'}
            </div>
            <div>
              <h2 className={`text-xl font-black ${tone === 'amber' ? 'text-amber-300' : 'text-rose-400'}`}>
                {res.reason === 'NOT_CLEARED'
                  ? 'کارت ورود به جلسه صادر نمی‌شود'
                  : res.reason === 'EXPIRED'
                  ? 'کارت ورود به جلسه منقضی شده است'
                  : 'کارت ورود به جلسه نامعتبر است'}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-slate-300">{res.message}</p>
            </div>
            {res.debt != null && res.debt > 0 && (
              <div className="rounded-2xl border border-amber-700 bg-amber-950/40 p-3 text-xs font-bold text-amber-200">
                بدهی معوق: <span className="font-mono">{faNum(res.debt)}</span> ریال
              </div>
            )}
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 text-2xs leading-5 text-slate-400">
              دانشجو باید از مسیر <span className="font-mono text-slate-200">پنل دانشجو ← کارت ورود به جلسه</span> توکن تازه
              دریافت کند. مراقب سالن در صورت عدم احراز هویت، دانشجو را به دفتر حوزه ارجاع دهد.
            </div>
          </div>
          <div className="pt-4 text-center">
            <Link prefetch={false} href="/proctor" className="text-xs text-indigo-400 hover:underline">ورود به سامانهٔ مراقبین سالن ←</Link>
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
      <div className="w-full max-w-lg space-y-5 rounded-3xl border border-indigo-900/60 bg-slate-900 p-6 shadow-2xl">
        {/* سربرگ */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt="ارم دانشگاه" className="h-10 w-10 rounded-2xl bg-white/95 object-contain p-1" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-base font-black text-white">آ</div>
            )}
            <div>
              <h1 className="text-sm font-black text-white">گیت ورود به حوزهٔ امتحانات دانشگاه آفاق</h1>
              <p className="text-2xs text-indigo-300">استعلام برخط کارت ورود به جلسه · {res.termTitle}</p>
            </div>
          </div>
          <span className="rounded-full border border-emerald-600/50 bg-emerald-950 px-2.5 py-1 text-3xs font-black text-emerald-300">
            ✓ تسویهٔ مالی تأیید شده
          </span>
        </div>

        {/* مشخصات دانشجو + عکس (برای تطبیق هویت در گیت حوزه) */}
        <div className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs">
          <div className="h-24 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
            {photo ? (
              <img src={photo} alt="عکس دانشجو" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center text-slate-500">
                <span className="text-2xl">👤</span>
                <span className="mt-1 text-[9px] font-bold">بدون عکس</span>
              </div>
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

        <NationalIdCheck token={token} dark />

        {/* برنامهٔ امتحانات */}
        <div className="space-y-3 text-xs">
          <h2 className="font-bold text-slate-300">📋 دروس امتحانی و صندلی‌های تخصیص‌یافته:</h2>
          {res.exams.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-center text-slate-400">
              برای این دانشجو در ترم جاری امتحانی زمان‌بندی نشده است.
            </div>
          ) : (
            res.exams.map((ex, i) => (
              <div key={i} className="space-y-2 rounded-2xl border border-indigo-900/40 bg-slate-950 p-3.5 transition hover:border-indigo-600">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black text-white">{ex.courseTitle}</span>
                  <span className="rounded-lg bg-indigo-900 px-2.5 py-0.5 font-mono text-2xs font-bold text-indigo-200">
                    {ex.seatNumber != null ? `صندلی: ${faNum(ex.seatNumber)}` : 'صندلی: تخصیص نیافته'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-2xs text-slate-400">
                  <div>📅 تاریخ: {faNum(ex.examDate) || '—'}</div>
                  <div>⏱️ ساعت: {faNum(ex.examTime)}</div>
                  <div>🏛️ سالن: {ex.hallName ?? '—'}{ex.buildingName ? ` (${ex.buildingName})` : ''}</div>
                  <div>👨‍🏫 استاد: {ex.professorName ?? '—'}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="text-center font-mono text-3xs text-slate-500">
          استعلام زنده در {new Date(res.checkedAt).toLocaleString('fa-IR')}
        </div>

        <Link prefetch={false}
          href="/proctor"
          className="block w-full rounded-2xl bg-indigo-600 py-3 text-center text-xs font-black text-white shadow-lg transition hover:bg-indigo-500"
        >
          ورود به سامانهٔ حضور و غیاب مراقبین سالن ←
        </Link>
      </div>
    </div>
  );
}
