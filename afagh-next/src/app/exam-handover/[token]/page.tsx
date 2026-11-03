import Link from 'next/link';
import { verifyExamHandover } from '@/lib/verification';
import { requireRole } from '@/lib/auth';
import { HandoverConfirmButton } from './HandoverConfirmButton';

export const dynamic = 'force-dynamic';

const faNum = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * صفحهٔ تحویلگیرندهٔ اوراق امتحان — مقصد QR تحویل.
 *
 * فرستنده (مراقب/مخزن) QR را نشان میدهد؛ تحویلگیرنده اسکن میکند و اینجا جزئیات
 * تحویل را میبیند و با یک تأیید، همان مرحلهٔ زنجیرهٔ تحویل (دریافت مخزن /
 * نهاییسازی / تحویل به استاد) با هویتِ خودش ثبت میشود.
 */
export default async function ExamHandoverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken || '').trim();
  const res = await verifyExamHandover(token);

  if (!res.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 font-sans" dir="rtl">
        <div className="w-full max-w-lg space-y-4 rounded-3xl border-2 border-rose-500 bg-slate-900 p-6 text-center text-slate-100 shadow-2xl">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-rose-950 text-4xl text-rose-400">✕</div>
          <h2 className="text-xl font-black text-rose-400">
            {res.reason === 'EXPIRED' ? 'کد تحویل منقضی شده است' : 'کد تحویل نامعتبر است'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-slate-300">{res.message}</p>
          <Link href="/" className="inline-block rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200">بازگشت</Link>
        </div>
      </div>
    );
  }

  // تحویلگیرنده باید وارد شده باشد (هویت از نشست، نه از کد)
  let me: { name: string; roles: string[] } | null = null;
  try {
    const user = await requireRole(['ADMIN', 'EDU_EXPERT', 'PROCTOR', 'VAULT_MANAGER', 'PROFESSOR']);
    me = { name: user.name, roles: user.roles };
  } catch {
    me = null;
  }

  const stepLabel = res.step === 'VAULT' ? 'دریافت اوراق سالن توسط مخزن'
    : res.step === 'FINALIZE' ? 'نهاییسازی تحویل اوراق به مخزن'
      : 'تحویل اوراق درس به استاد';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 font-sans" dir="rtl">
      <div className="w-full max-w-xl space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full border-2 border-indigo-500 bg-indigo-50 text-2xl">🧾</div>
          <h1 className="text-lg font-black text-slate-900">{res.title}</h1>
          <p className="mt-1 text-xs font-bold text-indigo-700">{stepLabel}</p>
        </div>

        <dl className="space-y-2 text-xs">
          {res.details.map(d => (
            <div key={d.label} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <dt className="font-bold text-slate-500">{d.label}</dt>
              <dd className="font-black text-slate-800">{d.value}</dd>
            </div>
          ))}
        </dl>

        {me ? (
          <HandoverConfirmButton token={token} stepLabel={stepLabel} userName={me.name} />
        ) : (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-center text-xs font-bold text-amber-900">
            برای تأیید تحویل باید با حساب خودتان وارد سامانه شوید.
            <Link href="/login" className="mx-auto mt-2 block w-fit rounded-lg bg-amber-700 px-4 py-2 text-white">ورود به سامانه</Link>
          </div>
        )}

        <p className="text-center text-3xs text-slate-500">
          هر تحویل با هویت تحویلگیرنده و در زنجیرهٔ ممیزی سامانه ثبت میشود — کد یکبارمصرف و کوتاه‌مدت است ({faNum(3)} ساعت).
        </p>
      </div>
    </div>
  );
}
