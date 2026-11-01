'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changePasswordAction } from '@/app/login/actions';

/**
 * تغییر رمز عبور — حلقهٔ «الزام تغییر رمز در اولین ورود» (mustChangePassword).
 * کاربران تازه‌پذیرش‌شده پس از ورود با رمز پیش‌فرض به این صفحه هدایت می‌شوند
 * و تا تغییر رمز، دسترسی به داشبوردها ندارند (گیت در requireRole).
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // اگر کاربر بدون فلگ (یا بدون نشست) مستقیم وارد این صفحه شود، پیام راهنما می‌بیند
    setErr('');
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (next !== confirm) { setErr('تکرار رمز جدید با رمز جدید یکسان نیست.'); return; }
    setBusy(true);
    const res = await changePasswordAction(current, next).catch(() => null);
    setBusy(false);
    if (!res) { setErr('ارتباط با سرور برقرار نشد.'); return; }
    if (!res.ok) { setErr(res.error || 'خطا'); return; }
    setOk(true);
    setTimeout(() => { router.replace('/'); router.refresh(); }, 900);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white">آ</div>
          <h1 className="text-lg font-bold">تغییر رمز عبور</h1>
          <p className="text-xs text-slate-500">برای حساب شما رمز اولیه (پیش‌فرض) تعیین شده است؛ پیش از ورود به سامانه باید آن را تغییر دهید.</p>
        </div>
        <input className="input text-left" dir="ltr" type="password" placeholder="رمز فعلی" value={current} onChange={e => setCurrent(e.target.value)} />
        <input className="input text-left" dir="ltr" type="password" placeholder="رمز جدید (حداقل ۱۰ کاراکتر)" value={next} onChange={e => setNext(e.target.value)} />
        <input className="input text-left" dir="ltr" type="password" placeholder="تکرار رمز جدید" value={confirm} onChange={e => setConfirm(e.target.value)} />
        {err && <p className="rounded-xl bg-red-50 p-2 text-center text-sm text-red-700 dark:border dark:border-red-800 dark:bg-red-950 dark:text-red-200">{err}</p>}
        {ok && <p className="rounded-xl bg-emerald-50 p-2 text-center text-sm text-emerald-700 dark:border dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">✓ رمز با موفقیت تغییر کرد. در حال انتقال…</p>}
        <button className="btn-primary w-full" disabled={busy || !current || !next || !confirm}>{busy ? 'در حال ثبت…' : 'تغییر رمز و ورود'}</button>
      </form>
    </main>
  );
}
