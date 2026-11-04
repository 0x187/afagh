'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { verifyCertificateAction } from './actions';
import type { CertificateVerification } from '@/lib/verification';

const faNum = (n: unknown) =>
  n === null || n === undefined ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** دکمهٔ استعلام — pending را از useFormStatus می‌گیرد (بومی React 19) */
function SearchButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 text-xs font-black text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-500 disabled:opacity-50"
    >
      {pending ? <span className="animate-spin text-sm">⏳</span> : <span>استعلام اصالت</span>}
    </button>
  );
}

/**
 * درگاه عمومی اصالت‌سنجی گواهینامه.
 *
 * همهٔ داده‌ها با server action از پایگاه داده خوانده می‌شوند؛ هیچ گواهینامهٔ
 * نمونه‌ای در کد نیست. سند گواهینامه فقط وقتی渲染 می‌شود که حکم VALID باشد —
 * برای REVOKED / TAMPERED / NOT_FOUND پنل ردِ صریح نمایش داده می‌شود تا یک
 * مدرک باطل، «رسمی و قابل چاپ» به نظر نرسد.
 */
type FormState =
  | { ok: true; result: CertificateVerification; code: string }
  | { ok: false; error: string; code: string }
  | null;

export default function VerifyCertificateClient({
  initialCode = '',
  initialResult = null,
}: {
  initialCode?: string;
  initialResult?: CertificateVerification | null;
}) {
  // 🎯 گام ۴ سند (React 19): useActionState — وضعیت pending/error/result بومی React
  // است؛ بدون useState های دستی (isSearching/searchError). اکشن با FormData می‌گیرد
  // و خودِ React کل فرم را زیر نظر می‌گیرد (درخواست مجدد و رفع خطا نیز با state).
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const code = String(formData.get('searchCode') ?? '').trim();
      const res = await verifyCertificateAction(code);
      return res.ok
        ? { ok: true, result: res.result, code }
        : { ok: false, error: res.error, code };
    },
    initialResult ? { ok: true, result: initialResult, code: initialCode } : null,
  );

  const isSearching = isPending;
  const searchError = state && !state.ok ? state.error : '';
  const result = state?.ok ? state.result : null;
  const searchCode = state?.code ?? initialCode;

  const cert = result && result.verdict !== 'NOT_FOUND' ? result : null;
  const verdict = result?.verdict ?? null;
  const isValid = verdict === 'VALID';

  const rejection = (() => {
    if (!result) return null;
    if (result.verdict === 'NOT_FOUND') {
      return {
        tone: 'rose',
        icon: '✕',
        title: 'گواهینامه‌ای با این شماره یافت نشد',
        body: `شمارهٔ سریال «${searchCode.trim() || '—'}» در بایگانی دیجیتال آموزش‌های آزاد دانشگاه آفاق ثبت نشده است. اگر این شماره را روی یک برگهٔ چاپی دیده‌اید، آن برگه معتبر نیست.`,
      };
    }
    if (result.verdict === 'REVOKED') {
      return {
        tone: 'rose',
        icon: '⛔',
        title: 'این گواهینامه باطل شده است',
        body: result.message,
      };
    }
    if (result.verdict === 'TAMPERED') {
      return {
        tone: 'amber',
        icon: '⚠',
        title: 'اثر انگشت امنیتی گواهینامه همخوانی ندارد',
        body: result.message,
      };
    }
    return null;
  })();

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-100" dir="rtl">
      {/* سربرگ */}
      <header className="sticky top-0 z-40 border-b border-indigo-900/60 bg-slate-950/90 backdrop-blur-md print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-indigo-600 text-base font-black text-white shadow-lg shadow-indigo-600/30">آ</div>
            <div>
              <h1 className="text-sm font-black text-white sm:text-base">سامانهٔ برخط استعلام اصالت گواهینامه‌های دانشگاه آفاق</h1>
              <p className="text-2xs text-indigo-300">AFAGH University Official Certificate Verification Portal</p>
            </div>
          </div>
          <Link prefetch={false} href="/open-courses" className="rounded-xl bg-slate-800 px-3.5 py-1.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700">
            ← کاتالوگ دوره‌های آزاد
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        {/* فرم استعلام */}
        <div className="space-y-3 rounded-3xl border border-indigo-900/50 bg-slate-900 p-5 shadow-xl print:hidden">
          <h2 className="flex items-center gap-2 text-base font-black text-white">
            <span>🔍</span>
            <span>استعلام شمارهٔ سریال گواهینامه:</span>
          </h2>
          <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              name="searchCode"
              defaultValue={searchCode}
              placeholder="شمارهٔ سریال گواهی (مثال: AFQ-CERT-2026-1001)"
              className="flex-1 rounded-2xl border border-indigo-700/60 bg-slate-950 px-4 py-3 font-mono text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              dir="ltr"
            />
            <SearchButton />
          </form>
          {searchError && (
            <div className="rounded-2xl border border-rose-800/80 bg-rose-950/60 p-3 text-xs font-bold text-rose-300">⚠️ {searchError}</div>
          )}
          <p className="text-2xs text-slate-500">
            نتیجهٔ استعلام مستقیماً از پایگاه دادهٔ آموزش‌های آزاد خوانده می‌شود و اثر انگشت SHA-256 گواهینامه دوباره
            محاسبه و با مقدار ثبت‌شده مقایسه می‌گردد.
          </p>
        </div>

        {/* پنل رد — مدرک باطل هرگز به‌صورت سند رسمی رندر نمی‌شود */}
        {rejection && (
          <div
            className={`rounded-3xl border-2 p-6 text-center shadow-2xl print:hidden ${
              rejection.tone === 'amber' ? 'border-amber-500 bg-amber-950/40' : 'border-rose-500 bg-rose-950/40'
            }`}
          >
            <div
              className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full text-3xl ${
                rejection.tone === 'amber' ? 'bg-amber-900 text-amber-300' : 'bg-rose-900 text-rose-300'
              }`}
            >
              {rejection.icon}
            </div>
            <h3 className="mt-3 text-lg font-black text-white">{rejection.title}</h3>
            <p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-slate-300">{rejection.body}</p>
            {cert && (
              <dl className="mx-auto mt-4 grid max-w-md grid-cols-2 gap-2 text-2xs">
                <dt className="text-slate-500">شمارهٔ سریال</dt>
                <dd className="font-mono text-slate-200" dir="ltr">{cert.certificateNumber}</dd>
                <dt className="text-slate-500">دارنده</dt>
                <dd className="text-slate-200">{cert.fullNameFa}</dd>
                <dt className="text-slate-500">دوره</dt>
                <dd className="text-slate-200">{cert.courseTitleFa}</dd>
              </dl>
            )}
            <p className="mt-4 text-2xs text-slate-500">
              در صورت اعتراض، با مرکز آموزش‌های آزاد دانشگاه آفاق تماس بگیرید.
            </p>
          </div>
        )}

        {/* بنر تأیید */}
        {isValid && cert && (
          <div className="flex flex-col items-start justify-between gap-3 rounded-3xl border border-emerald-500/60 bg-emerald-950/80 p-4 text-emerald-100 shadow-xl sm:flex-row sm:items-center print:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-black text-white">✓</div>
              <div>
                <h3 className="text-sm font-black text-white">اصالت این گواهینامه رسماً تأیید می‌شود</h3>
                <p className="text-xs text-emerald-300">{cert.message}</p>
              </div>
            </div>
            <button
              onClick={() => window.print()}
              className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-md transition hover:bg-emerald-500"
            >
              <span>🖨️ چاپ / ذخیرهٔ PDF</span>
            </button>
          </div>
        )}

        {/* سند گواهینامه — فقط در صورت اعتبار */}
        {isValid && cert && (
          <div className="print-area relative overflow-hidden space-y-8 rounded-3xl border-8 border-double border-indigo-950/20 bg-white p-8 text-slate-900 shadow-2xl print:rounded-none print:border-4 print:p-8 print:shadow-none sm:p-12">
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.03]">
              <span className="text-[280px] font-black">AFAGH</span>
            </div>

            <div className="flex items-center justify-between border-b-2 border-slate-200 pb-6">
              <div className="space-y-0.5 text-right">
                <p className="text-xs font-bold text-slate-500">جمهوری اسلامی ایران</p>
                <p className="text-base font-black text-indigo-950">دانشگاه آفاق</p>
                <p className="text-2xs font-bold text-slate-600">مرکز آموزش‌های تخصصی و آزاد</p>
              </div>
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-4 border-amber-400 bg-gradient-to-tr from-indigo-950 to-indigo-800 text-2xl font-black text-amber-300 shadow-md">آ</div>
                <span className="mt-1 block text-3xs font-black tracking-widest text-slate-500">AFAGH</span>
              </div>
              <div className="space-y-0.5 text-left" dir="ltr">
                <p className="text-xs font-bold text-slate-500">ISLAMIC REPUBLIC OF IRAN</p>
                <p className="text-base font-black text-indigo-950">AFAGH UNIVERSITY</p>
                <p className="text-2xs font-bold text-slate-600">Continuing Education Center</p>
              </div>
            </div>

            <div className="space-y-1 text-center">
              <h2 className="text-2xl font-black tracking-tight text-indigo-950 sm:text-3xl">گواهینامهٔ پایان دورهٔ تخصصی</h2>
              <p className="font-mono text-sm font-black uppercase tracking-wider text-slate-500" dir="ltr">
                CERTIFICATE OF COMPLETION
              </p>
            </div>

            <div className="space-y-6 text-justify text-sm leading-8 text-slate-800 sm:text-base">
              <p>
                بدین‌وسیله گواهی می‌شود سرکار خانم / جناب آقای{' '}
                <b className="text-lg text-indigo-950 underline decoration-amber-400 decoration-2 underline-offset-4">{cert.fullNameFa}</b>{' '}
                (کد ملی: <span className="font-mono font-bold">{cert.nationalIdMasked}</span>) دورهٔ تخصصی{' '}
                <b className="text-base text-indigo-950">«{cert.courseTitleFa}»</b> به مدت{' '}
                <b className="font-mono font-black text-slate-950">{faNum(cert.courseHours)} ساعت آموزشی</b> را با تدریس{' '}
                <b>{cert.instructorName}</b> با موفقیت و کسب نمره{' '}
                <b className="font-mono font-black text-emerald-700">{faNum(cert.grade)} از ۲۰</b> ({cert.gradeStatus}) به پایان رسانده است.
              </p>
              {cert.fullNameEn && cert.courseTitleEn && (
                <p className="border-t border-slate-100 pt-4 font-sans text-xs leading-6 text-slate-600 sm:text-sm" dir="ltr">
                  This is to certify that <b>{cert.fullNameEn}</b> has successfully completed the professional course{' '}
                  <b>&ldquo;{cert.courseTitleEn}&rdquo;</b> comprising <b>{cert.courseHours} credit hours</b>, taught by{' '}
                  <b>{cert.instructorName}</b>, achieving a final grade of <b>{cert.grade}/20</b>.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 items-center gap-6 border-t-2 border-slate-200 pt-8 sm:grid-cols-3">
              <div className="space-y-1 text-center">
                <div className="flex h-12 items-center justify-center">
                  <span className="font-serif text-lg font-bold italic text-indigo-900">{cert.instructorName}</span>
                </div>
                <p className="text-xs font-black text-slate-900">مدرس و ارزیاب دوره</p>
                <p className="font-mono text-3xs text-slate-500" dir="ltr">Lead Course Instructor</p>
              </div>

              <div className="space-y-1 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center">
                <span className="block font-mono text-3xs font-black text-indigo-950" dir="ltr">{cert.certificateNumber}</span>
                <span className="mx-auto block max-w-[200px] truncate break-all font-mono text-[8px] text-slate-500" dir="ltr">
                  SHA-256: {cert.verificationHash}
                </span>
                <span className="block text-[9px] text-emerald-700">✓ اثر انگشت امنیتی تأیید شد</span>
              </div>

              <div className="space-y-1 text-center">
                <div className="flex h-12 items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-indigo-900/30 text-xs font-black text-indigo-900 shadow-inner">
                    مهر دانشگاه
                  </div>
                </div>
                <p className="text-xs font-black text-slate-900">رئیس مرکز آموزش‌های آزاد</p>
                <p className="font-mono text-3xs text-slate-500" dir="ltr">Director of Continuing Education</p>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3 font-mono text-2xs text-slate-500">
              <span>تاریخ صدور: {faNum(cert.issueDate)}</span>
              <span>استعلام برخط در: {new Date().toLocaleString('fa-IR')}</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
