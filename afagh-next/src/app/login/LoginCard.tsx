'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { homeForClient } from './roles';
import { chooseLoginAccountAction, loginAndReport } from './actions';
import { toEnDigits } from '@/lib/persian-search';

type Candidate = {
  id: number; name: string; staffCodes: string[]; universityTitle: string | null; roles: string[];
};

/** فرم ورود — منطق قبلی صفحه لاگین، بدون تغییر رفتار */
export default function LoginCard() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<{ token: string; candidates: Candidate[] } | null>(null);
  /* تا وقتی React هیدراته نشده، دکمهٔ ورود غیرفعال می‌ماند تا ارسال بومیِ فرم
     (که هیچ اعتبارسنجی‌ای ندارد و فقط یک درخواست بی‌مصرف می‌فرستد) رخ ندهد. */
  const [ready, setReady] = useState(false);

  // پیام‌های بازگشتی (مثلاً کاربر بدون نقش) — بدون نیاز به useSearchParams
  useEffect(() => {
    setReady(true);
    const e = new URLSearchParams(window.location.search).get('e');
    if (e === 'norole') setErr('ورود موفق بود، اما برای این حساب هیچ نقشی تعریف نشده است. با مدیر سامانه تماس بگیرید.');
    if (e === 'expired') setErr('نشست شما منقضی شده است. دوباره وارد شوید.');
  }, []);

  function afterOk(mustChange?: boolean) {
    if (mustChange) {
      router.replace('/change-password');
      router.refresh();
      return;
    }
    // مسیر پس از ورود را سرور تعیین می‌کند؛ refresh لازم است تا کوکی تازه اعمال شود
    router.replace(homeForClient());
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // اعتبارسنجی داخل submit، نه صرفاً غیرفعال‌کردن دکمه — چون در برخی مرورگرهای
    // قدیمی رویداد onChange برای autofill/برخی روش‌های تایپ ممکن است به‌درستی
    // شلیک نشود و دکمه‌ی صرفاً وابسته به state برای همیشه غیرفعال بماند.
    if (!code.trim() || !pass) { setErr('کد (ملی یا پرسنلی) و رمز عبور را وارد کنید.'); return; }
    setBusy(true); setErr(''); setChoice(null);
    let res: Awaited<ReturnType<typeof loginAndReport>> | null;
    try {
      res = await loginAndReport(code, pass);
    } catch (e) {
      // خطای واقعی را نشان بده تا «ارتباط برقرار نشد» کلی، قابل عیب‌یابی باشد
      const msg = e instanceof Error ? e.message : String(e ?? '');
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setErr('به اینترنت متصل نیستید. اتصال را بررسی و دوباره تلاش کنید.');
      } else if (/failed to fetch|network|load failed|timeout/i.test(msg)) {
        setErr(`ارتباط با سرور برقرار نشد (${msg.slice(0, 80)}). اگر با فیلترشکن هستید آن را عوض کنید و دوباره تلاش کنید.`);
      } else {
        setErr(`خطای ورود: ${msg.slice(0, 120) || 'نامشخص'}`);
      }
      setBusy(false); return;
    }
    if (!res) {
      setErr('پاسخی از سرور نرسید. صفحه را رفرش کنید و دوباره وارد شوید.');
      setBusy(false); return;
    }
    if ((res as { needChoice?: boolean }).needChoice) {
      const r = res as unknown as { token: string; candidates: Candidate[] };
      setChoice({ token: r.token, candidates: r.candidates || [] });
      setBusy(false); return;
    }
    if (!res.ok) { setErr(res.error || 'خطا'); setBusy(false); return; }
    // حساب تازه‌پذیرش‌شده با رمز پیش‌فرض → ابتدا تغییر اجباری رمز
    afterOk(res.mustChange);
  }

  async function pick(id: number) {
    if (!choice) return;
    setBusy(true); setErr('');
    let res: Awaited<ReturnType<typeof chooseLoginAccountAction>> | null;
    try {
      res = await chooseLoginAccountAction(choice.token, id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? '');
      setErr(`خطای انتخاب حساب: ${msg.slice(0, 120) || 'نامشخص'}`);
      setBusy(false); return;
    }
    if (!res) { setErr('پاسخی از سرور نرسید.'); setBusy(false); return; }
    if (!res.ok) { setErr(res.error || 'خطا'); setBusy(false); return; }
    afterOk(res.mustChange);
  }

  return (
    /* method="post" عمدی است: پیش از hydration، ارسال فرم به‌صورت GET انجام می‌شد و
       رمز عبور در نوار آدرس، history مرورگر و لاگ دسترسی سرور ثبت می‌شد
       (/login?code=…&password=…). با POST، حتی در همان پنجرهٔ کوتاه هیچ رمزی در URL نمی‌رود. */
    <form onSubmit={submit} method="post" className="card w-full space-y-4 shadow-2xl">
      <div className="text-center">
        <h2 className="text-base font-black text-slate-900">ورود به سامانه</h2>
        <p className="text-xs text-slate-500 mt-1">ورود با کد پرسنلی / شماره دانشجویی + رمز عبور</p>
      </div>
      {!choice ? (
        <>
          <input
            className="input text-left"
            dir="ltr"
            placeholder="کد پرسنلی یا شماره دانشجویی"
            value={code}
            onChange={e => setCode(toEnDigits(e.target.value))}
            name="code"
            autoComplete="username"
            inputMode="text"
            enterKeyHint="next"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="کد پرسنلی یا شماره دانشجویی"
          />
          <input
            className="input text-left"
            dir="ltr"
            type="password"
            placeholder="رمز عبور"
            value={pass}
            onChange={e => setPass(toEnDigits(e.target.value))}
            name="password"
            autoComplete="current-password"
            enterKeyHint="go"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="رمز عبور"
          />
          {err && <p role="alert" className="rounded-xl bg-red-50 p-2 text-center text-sm text-red-700 dark:border dark:border-red-800 dark:bg-red-950 dark:text-red-200">{err}</p>}
          <button className="btn-primary w-full" disabled={!ready || busy}>{busy ? 'در حال ورود…' : 'ورود'}</button>
          <p className="text-center text-2xs text-slate-400">
            ورود اول؟ گذرواژهٔ اولیهٔ شما برابر همان کد است. <a href="/help?tab=shared" className="text-indigo-700 font-bold hover:underline">راهنمای ورود</a>
          </p>
        </>
      ) : (
        <>
          <p className="rounded-xl bg-amber-50 p-2 text-center text-sm font-bold text-amber-900 dark:border dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            این شناسه چند حساب دارد — وارد کدام کارتابل می‌شوید؟
          </p>
          <div className="space-y-2">
            {choice.candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={busy}
                onClick={() => pick(c.id)}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-right shadow-xs transition hover:border-emerald-500 hover:bg-emerald-50 disabled:opacity-60"
              >
                <span className="block text-sm font-extrabold text-slate-900">{c.name}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {c.staffCodes.length ? `کد پرسنلی: ${c.staffCodes.join('، ')}` : 'بدون کد پرسنلی'}
                  {c.universityTitle ? ` · ${c.universityTitle}` : ''}
                </span>
              </button>
            ))}
          </div>
          {err && <p className="rounded-xl bg-red-50 p-2 text-center text-sm text-red-700 dark:border dark:border-red-800 dark:bg-red-950 dark:text-red-200">{err}</p>}
          <button type="button" className="w-full text-center text-xs text-slate-500 hover:underline" disabled={busy} onClick={() => { setChoice(null); setErr(''); }}>
            بازگشت به ورود
          </button>
        </>
      )}
    </form>
  );
}
