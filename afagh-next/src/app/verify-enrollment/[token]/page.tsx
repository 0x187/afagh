import { verifyEnrollConfirm } from '@/lib/verification';
import { studentPhotoDataUrl, universityBrand } from '@/lib/verify-assets';
import NationalIdCheck from '@/components/NationalIdCheck';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

const faNum = (n: unknown) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

const ENROLL_STATUS_FA: Record<string, string> = {
  REGISTERED: 'ثبت قطعی',
  FINALIZED: 'نهایی‌شده',
  WAITLISTED: 'لیست انتظار',
  PENDING_COUNCIL: 'در انتظار شورا',
  DROPPED: 'حذف‌شده',
};

/**
 * استعلام برخط تأییدیهٔ انتخاب واحد — بدون نیاز به ورود؛ مقصد QR روی برگهٔ چاپی.
 * توکن باید امضای HMAC سامانه را داشته باشد (از «تأییدیه انتخاب واحد» در پنل
 * دانشجو یا از کارشناس آموزش صادر می‌شود). فهرست دروس به‌صورت زنده از پایگاه
 * داده خوانده می‌شود؛ توکن نامعتبر/منقضی صریحاً رد می‌شود.
 */
export default async function VerifyEnrollmentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken).trim();
  const res = await verifyEnrollConfirm(token);

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
                  ? 'تأییدیهٔ انتخاب واحد منقضی شده است'
                  : res.reason === 'EMPTY'
                    ? 'ثبت‌نامی برای استعلام وجود ندارد'
                    : 'تأییدیهٔ انتخاب واحد نامعتبر است'}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-slate-300">{res.message}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 text-2xs leading-5 text-slate-400">
              دانشجو باید از مسیر <span className="font-mono text-slate-200">پنل دانشجو ← تأییدیه انتخاب واحد</span> توکن تازه
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
              <h1 className="text-sm font-black text-white">تأییدیهٔ انتخاب واحد دانشگاه آفاق</h1>
              <p className="text-2xs text-emerald-300">استعلام برخط · {res.termTitle}</p>
            </div>
          </div>
          <span className="rounded-full border border-emerald-600/50 bg-emerald-950 px-2.5 py-1 text-3xs font-black text-emerald-300">
            ✓ معتبر
          </span>
        </div>

        {/* مشخصات دانشجو + عکس */}
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
            <div className="flex justify-between">
              <span className="text-slate-400">جمع واحد:</span>
              <span className="font-black text-white">{faNum(res.totalUnits)} واحد ({faNum(res.courses.length)} درس)</span>
            </div>
          </div>
        </div>

        <NationalIdCheck token={token} dark />

        {/* فهرست دروس */}
        <div className="space-y-2 text-xs">
          <h2 className="font-bold text-slate-300">📋 دروس ثبت‌شده در {res.termTitle}:</h2>
          <div className="overflow-x-auto rounded-2xl border border-slate-800">
            <table className="w-full text-right rt">
              <thead className="bg-slate-950 text-slate-400">
                <tr>
                  <th className="p-2">ردیف</th>
                  <th className="p-2">درس</th>
                  <th className="p-2">کد</th>
                  <th className="p-2 text-center">واحد</th>
                  <th className="p-2 text-center">گروه</th>
                  <th className="p-2">استاد</th>
                  <th className="p-2">وضعیت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {res.courses.map((c, i) => (
                  <tr key={i}>
                    <td className="p-2 text-slate-500">{faNum(i + 1)}</td>
                    <td className="p-2 font-bold text-white">{c.courseTitle}</td>
                    <td className="p-2 font-mono text-slate-300" dir="ltr">{c.courseCode}</td>
                    <td className="p-2 text-center">{faNum(c.units)}</td>
                    <td className="p-2 text-center">{faNum(c.groupNumber)}</td>
                    <td className="p-2 text-slate-300">{c.professorName ?? '—'}</td>
                    <td className="p-2 text-emerald-300">{ENROLL_STATUS_FA[c.status] ?? c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-center font-mono text-3xs text-slate-500">
          استعلام زنده در {new Date(res.checkedAt).toLocaleString('fa-IR')}
        </div>

        <PrintButton />
      </div>
    </div>
  );
}
