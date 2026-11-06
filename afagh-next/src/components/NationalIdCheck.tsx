'use client';

import { useState } from 'react';

/**
 * کادر «تأیید کد ملی» برای صفحات استعلام.
 *
 * کد ملی در HTML صفحه نمی‌آید (فقط ماسک‌شده نمایش داده می‌شود)؛ استعلام‌کننده
 * ۱۰ رقم کامل را وارد می‌کند و سرور فقط نتیجهٔ تطبیق را برمی‌گرداند. این‌گونه
 * دارندهٔ لینک بدون دانستن کد ملی، چیزی به‌دست نمی‌آورد.
 */
export default function NationalIdCheck({ token, dark = false }: { token: string; dark?: boolean }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; match?: boolean; message: string } | null>(null);

  const fa = (n: unknown) => String(n ?? '').replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch('/api/verify/national-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, value }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; match?: boolean; error?: string } | null;
      if (d?.ok) {
        setResult(d.match
          ? { ok: true, match: true, message: '✓ کد ملی با سند مطابقت دارد.' }
          : { ok: false, match: false, message: '✗ کد ملی با سند مطابقت ندارد.' });
      } else if (d?.error === 'FORMAT') {
        setResult({ ok: false, message: 'کد ملی باید ۱۰ رقم کامل باشد.' });
      } else if (d?.error === 'RATE_LIMIT') {
        setResult({ ok: false, message: 'تعداد تلاش‌ها زیاد شد؛ چند دقیقه بعد دوباره امتحان کنید.' });
      } else {
        setResult({ ok: false, message: 'بررسی ممکن نشد؛ لینک را دوباره باز کنید.' });
      }
    } catch {
      setResult({ ok: false, message: 'خطا در ارتباط با سرور.' });
    } finally {
      setBusy(false);
    }
  }

  const wrap = dark
    ? 'rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs'
    : 'rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs';
  const label = dark ? 'text-slate-400' : 'text-slate-500';
  const input = dark
    ? 'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100'
    : 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-800';

  return (
    <div className={wrap}>
      <p className={`mb-2 font-bold ${dark ? 'text-slate-300' : 'text-slate-700'}`}>
        🔎 تأیید کد ملی (بدون نمایش کد در سند)
      </p>
      <p className={`mb-2 leading-5 ${label}`}>
        کد ملی روی این صفحه نمایش داده نمی‌شود تا لینک استعلام به «پروندهٔ هویتی کامل» تبدیل نشود.
        برای تطبیق، ۱۰ رقم کامل را وارد کنید؛ نتیجه فقط «می‌خواند/نمی‌خواند» است.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
          inputMode="numeric"
          maxLength={10}
          dir="ltr"
          placeholder="۰۰۱۲۳۴۵۶۷۸"
          className={input + ' max-w-[200px]'}
          aria-label="کد ملی"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || value.replace(/\D/g, '').length !== 10}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white transition hover:bg-indigo-700 disabled:opacity-40"
        >
          {busy ? '…' : 'تأیید'}
        </button>
        {result && (
          <span className={`rounded-lg px-2.5 py-1.5 font-bold ${
            result.match === true ? 'bg-emerald-100 text-emerald-800'
              : result.match === false ? 'bg-rose-100 text-rose-800'
              : dark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'}`}>
            {result.message}
          </span>
        )}
      </div>
      <p className={`mt-2 text-3xs ${label}`}>
        تلاش‌ها محدود است ({fa(8)} بار در {fa(10)} دقیقه برای هر سند).
      </p>
    </div>
  );
}
