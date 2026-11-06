'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { lockNowAction, verifyOwnPasswordAction } from '@/lib/step-up-actions';

/**
 * قفل خودکار بیکاری — منبع حقیقت سمت سرور است.
 *
 * تایمر این کامپوننت فقط برای تجربهٔ کاربری است (نمایش سریع قفل + جلوگیری از
 * ادامهٔ تعامل). تصمیم نهایی با `/api/session/ping` است که «زمان آخرین فعالیت»
 * را در سرور نگه می‌دارد؛ بنابراین:
 *  • رفرش/تب جدید پس از قفل هم قفل نشان می‌دهد (دورزدن با رفرش ممکن نیست)،
 *  • کاربرِ در حال کار با ضربان‌های دوره‌ای هرگز بی‌دلیل بیرون نمی‌افتد،
 *  • مدت بی‌تعاملی برای هر نقش می‌تواند متفاوت باشد (SESSION_LOCK_MINUTES_ROLES).
 */
const HEARTBEAT_MS = 60_000;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click', 'wheel'] as const;

export default function SessionLock({ name, timeoutMin = 15, initialLocked = false }: { name: string; timeoutMin?: number; initialLocked?: boolean }) {
  const disabled = !(timeoutMin > 0);
  const [locked, setLocked] = useState(initialLocked);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPing = useRef(0);
  const lockedRef = useRef(initialLocked);

  useEffect(() => { lockedRef.current = locked; }, [locked]);

  // اگر سرور هنگام رندر قفل را گزارش کرد (مثلاً پس از رفرش)، همان را نشان بده
  useEffect(() => { if (initialLocked) { setPw(''); setErr(''); setLocked(true); } }, [initialLocked]);

  /** پرسش/ثبت وضعیت نزد سرور. active=true یعنی «در حال کارم». */
  const ping = useCallback(async (active: boolean): Promise<boolean | null> => {
    try {
      const r = await fetch('/api/session/ping', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active }),
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { locked?: unknown };
      return j.locked === true;
    } catch { return null; }
  }, []);

  /** ضربان «فعالیت» — حداکثر یک بار در دقیقه تا سرور نشست را گرم نگه دارد. */
  const beat = useCallback(() => {
    if (disabled) return;
    const now = Date.now();
    if (now - lastPing.current < HEARTBEAT_MS) return;
    lastPing.current = now;
    void ping(true);
  }, [disabled, ping]);

  const arm = useCallback(() => {
    if (disabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      // تصمیم نهایی با سرور است؛ اگر هنوز بیکار نمی‌داند، دوباره مسلح کن
      const srv = await ping(false);
      if (srv === false) { arm(); return; }
      setPw(''); setErr('');
      setLocked(true);
      lockedRef.current = true;
      // ثبت پرچم صریح هم (لایهٔ دوم)؛ خطای احتمالی نادیده — قفل بیکاری سرور-محور است
      lockNowAction().catch(() => {});
    }, Math.max(1, timeoutMin) * 60 * 1000);
  }, [timeoutMin, disabled, ping]);

  useEffect(() => {
    const onAct = () => {
      if (lockedRef.current) return; // پشت قفل، فعالیت نباید ساعت بیکاری را نو کند
      beat();
      arm();
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onAct, { passive: true });
    arm();
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onAct);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [arm, beat]);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw) { setErr('رمز عبور را وارد کنید.'); return; }
    setBusy(true);
    setErr('');
    try {
      let res: { ok: boolean; error?: string } | null = null;
      // مسیر HTTP اول (پشت پروکسی/آی‌فریم قابل‌اعتمادتر است)، سپس Server Action
      try {
        const r = await fetch('/api/session/unlock', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: pw }),
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (r.status === 200 || r.status === 400 || r.status === 401 || r.status === 429) {
          res = (await r.json()) as { ok: boolean; error?: string };
        }
      } catch { /* مسیر HTTP در دسترس نبود → Server Action */ }
      if (!res) {
        res = await verifyOwnPasswordAction(pw).catch(() => ({ ok: false as const, error: 'خطا در ارتباط با سرور.' }));
      }
      if (res.ok) {
        setLocked(false);
        lockedRef.current = false;
        setPw('');
        lastPing.current = 0;
        arm();
      } else {
        setErr(res.error || 'رمز نادرست است.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (disabled || !locked) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 print:hidden" dir="rtl">
      {/* ⚠ دو فرم باید «خواهر» باشند، نه تودرتو: HTML فرمِ تودرتو را نامعتبر
          می‌داند و پارسر مرورگر تگِ فرمِ داخلی را دور می‌ریزد؛ نتیجه این بود که
          دکمهٔ خروج فرمی برای ارسال نداشت و فقط فرمِ بازگشایی را submit می‌کرد
          (با رمز خالی → «رمز عبور را وارد کنید»). */}
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full border border-slate-300 overflow-hidden">
        <div className="bg-slate-900 text-white px-5 py-4 text-center">
          <div className="text-3xl">🔒</div>
          <h3 className="font-extrabold text-sm mt-1">صفحه به‌علت بیکاری قفل شد</h3>
          <p className="text-2xs text-slate-300 mt-1">{name} — برای ادامه رمز عبور را وارد کنید.</p>
        </div>
        <form onSubmit={unlock} className="p-5 space-y-3">
          <input
            type="password"
            autoFocus
            value={pw}
            onChange={e => setPw(e.target.value)}
            placeholder="رمز عبور"
            aria-label="رمز عبور"
            autoComplete="current-password"
            dir="ltr"
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-mono text-center focus:ring-2 focus:ring-slate-500 focus:outline-none"
          />
          {err && <p className="text-xs font-bold text-rose-700 text-center">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-black text-sm py-2.5"
          >
            {busy ? 'در حال بررسی…' : '🔓 بازگشایی'}
          </button>
        </form>
        {/* خروج از حساب — فرم جدا (فرم تودرتو نامعتبر است): نشست می‌بندد و به /login می‌رود.
            برای کارت‌خوان مشترک/سیستم عمومی که کاربر بعدی رمزِ قبلی را ندارد.
            عمداً به مسیر HTTP می‌رود نه Server Action: پشت پروکسی/CDN اگر اکشن
            به‌دلیل Origin/Host رد شود، کاربر پشت قفل گیر می‌کند و راه خروجی ندارد.
            فرم معمولی حتی بدون JS هم کار می‌کند. */}
        <form action="/api/session/logout" method="post" className="px-5 pb-5">
          <button
            type="submit"
            className="w-full rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 font-black text-xs py-2 transition-colors"
          >
            🚪 خروج از حساب کاربری
          </button>
        </form>
      </div>
    </div>
  );
}
