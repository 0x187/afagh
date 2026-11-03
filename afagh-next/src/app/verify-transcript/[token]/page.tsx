import { verifyTranscript } from '@/lib/verification';
import { studentPhotoDataUrl, universityBrand } from '@/lib/verify-assets';
import NationalIdCheck from '@/components/NationalIdCheck';
import { toJalaliFromDate, faDigits } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

const faNum = (n: unknown) =>
  n === null || n === undefined || n === '' ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

const jdate = (d: string | Date | null | undefined) => {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const { jy, jm, jd } = toJalaliFromDate(date);
  return faDigits(`${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`);
};

/**
 * استعلام برخط کارنامهٔ تحصیلی — بدون نیاز به ورود؛ مقصد QR روی کارنامهٔ چاپی.
 * توکن باید امضای HMAC سامانه را داشته باشد؛ واحدها و معدل زنده از موتور قوانین
 * آموزشی خوانده می‌شود و توکن نامعتبر/منقضی صریحاً رد می‌شود.
 */
export default async function VerifyTranscriptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken).trim();
  const res = await verifyTranscript(token);

  if (!res.ok) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 font-sans text-slate-100" dir="rtl">
        <div className="w-full max-w-lg space-y-4 rounded-3xl border-2 border-rose-500 bg-slate-900 p-6 text-center shadow-2xl">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-rose-950 text-4xl text-rose-400">✕</div>
          <h2 className="text-xl font-black text-rose-400">
            {res.reason === 'EXPIRED' ? 'کارنامهٔ تحصیلی منقضی شده است' : res.reason === 'EMPTY' ? 'کارنامه‌ای برای استعلام وجود ندارد' : 'کارنامهٔ تحصیلی نامعتبر است'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-slate-300">{res.message}</p>
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 text-2xs leading-5 text-slate-400">
            این صفحه فقط اسناد صادرشدهٔ سامانهٔ آفاق را تأیید می‌کند. برای دریافت کارنامهٔ تازه، به سامانهٔ آموزشی مراجعه کنید.
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
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 font-sans" dir="rtl">
      <div className="w-full max-w-2xl space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
        {/* سربرگ: ارم دانشگاه + عنوان + عکس دانشجو (برای تطبیق هویت) */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt="ارم دانشگاه" className="h-14 w-14 shrink-0 object-contain" />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-xl font-black text-white">آ</div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-emerald-500 bg-emerald-50 text-sm text-emerald-600">✓</span>
                <h1 className="text-base font-black text-slate-900">کارنامهٔ تحصیلی معتبر است</h1>
              </div>
              <p className="mt-1 text-xs text-slate-500">{brand.title ?? 'دانشگاه غیرانتفاعی آفاق ارومیه'} — استعلام برخط</p>
            </div>
          </div>
          <div className="text-center">
            {photo ? (
              <img src={photo} alt="عکس دانشجو" className="h-24 w-20 rounded-xl border-2 border-slate-200 object-cover shadow-sm" />
            ) : (
              <div className="flex h-24 w-20 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400">
                <span className="text-2xl">👤</span>
                <span className="mt-1 text-[9px] font-bold">بدون عکس</span>
              </div>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
          {[
            ['نام و نام خانوادگی', res.studentName],
            ['شمارهٔ دانشجویی', res.studentCode],
            ['کد ملی', res.nationalIdMasked],
            ['رشته', res.majorName ?? '—'],
            ['مقطع', res.degreeTitle ?? '—'],
            ['سال ورود', res.entryYear ? faNum(res.entryYear) : '—'],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <dt className="text-3xs font-bold text-slate-500">{k}</dt>
              <dd className="mt-0.5 font-black text-slate-800" dir={k === 'کد ملی' || k === 'شمارهٔ دانشجویی' ? 'ltr' : undefined}>{v}</dd>
            </div>
          ))}
        </dl>

        <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
            <p className="text-3xs font-bold text-emerald-700">معدل کل</p>
            <p className="mt-1 text-lg font-black text-emerald-800">{faNum(res.gpa)}</p>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3">
            <p className="text-3xs font-bold text-sky-700">واحد گذرانده</p>
            <p className="mt-1 text-lg font-black text-sky-800">{faNum(res.passedUnits)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-3xs font-bold text-slate-600">واحد محاسبه‌شده</p>
            <p className="mt-1 text-lg font-black text-slate-800">{faNum(res.totalUnits)}</p>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-3">
            <p className="text-3xs font-bold text-indigo-700">وضعیت تحصیلی (کل)</p>
            <p className="mt-1 text-sm font-black text-indigo-800">{res.statusLabel}</p>
          </div>
        </div>

        {/* وضعیت ترم‌به‌ترم: معدل، واحد و مشروطی همان نیمسال */}
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-2xs font-black text-slate-700">
            وضعیت تحصیلی در هر نیمسال <span className="font-normal text-slate-500">(مرز مشروطی این مقطع: {faNum(res.probationThreshold)})</span>
          </div>
          {res.terms.length ? (
            <table className="w-full text-xs rt">
              <thead>
                <tr className="bg-slate-100 text-3xs text-slate-600">
                  <th className="p-2 text-right">نیمسال</th>
                  <th className="p-2">معدل ترم</th>
                  <th className="p-2">واحد محاسبه‌شده</th>
                  <th className="p-2">واحد گذرانده</th>
                  <th className="p-2">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {res.terms.map(t => (
                  <tr key={t.termCode ?? t.termTitle} className="border-t border-slate-100">
                    <td className="p-2 text-right font-bold text-slate-700">{t.termTitle}</td>
                    <td className="p-2 text-center font-mono font-black text-slate-800">{t.gpa === null ? '—' : faNum(t.gpa.toFixed(2))}</td>
                    <td className="p-2 text-center font-mono text-slate-600">{faNum(t.units)}</td>
                    <td className="p-2 text-center font-mono text-slate-600">{faNum(t.passedUnits)}</td>
                    <td className="p-2 text-center">
                      {t.isProbation
                        ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-3xs font-black text-rose-800">مشروط</span>
                        : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-3xs font-black text-emerald-800">عادی</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-3 text-center text-2xs text-slate-500">نمرهٔ نهایی‌شده‌ای برای محاسبهٔ وضعیت نیمسال‌ها ثبت نشده است.</p>
          )}
        </div>

        <NationalIdCheck token={token} />

        {res.otherRecords.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-2xs leading-5 text-amber-900">
            <b>توجه — پروندهٔ چندمقطعی:</b> این شخص در پروندهٔ دیگری هم سابقه دارد:{' '}
            {res.otherRecords.map(r => `${r.degreeTitle ?? 'مقطع نامشخص'} (${r.studentCode}${r.isGraduated ? ' — فارغ‌التحصیل' : ''})`).join(' · ')}
            . این استعلام فقط مربوط به مقطع «{res.degreeTitle ?? '—'}» با شمارهٔ دانشجویی {res.studentCode} است.
          </div>
        )}

        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-3xs leading-5 text-slate-500">
          اعداد این صفحه به‌صورت زنده از موتور قوانین آموزشی سامانه خوانده می‌شود (سیاست معدل: {res.policy || '—'}).
          زمان استعلام: {jdate(res.checkedAt)}.{' '}
          {res.pinned
            ? 'تطبیق پرونده با شناسهٔ نهفته در همین QR انجام شد.'
            : 'این QR پیش از افزودن شناسهٔ پرونده صادر شده است؛ برای تطبیق دقیق مقطع، کارنامهٔ تازه بگیرید.'}
        </p>
      </div>
    </div>
  );
}
