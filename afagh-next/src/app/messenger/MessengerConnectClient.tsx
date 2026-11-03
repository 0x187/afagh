'use client';

import { useEffect, useRef, useState } from 'react';
import { checkPairingAction, confirmLinkAction, mintLinkTokenAction } from '@/lib/messenger-link-actions';

const CHANNELS = [
  { key: 'SOROUSH', label: 'سروش‌پلاس', bot: '@afaghbot', ready: true },
  { key: 'BALE', label: 'بله', bot: '', ready: true },
  { key: 'EITAA', label: 'ایتا', bot: '', ready: true },
  { key: 'TELEGRAM', label: 'تلگرام', bot: '', ready: false },
  { key: 'IGAP', label: 'آی‌گپ', bot: '', ready: false },
] as const;

/** فاصلهٔ هر polling وضعیت جفت‌سازی (میلی‌ثانیه) */
const POLL_MS = 2500;
/** حداکثر مدت polling — کمی بیشتر از TTL توکن (۱۰ دقیقه) */
const POLL_MAX_MS = 11 * 60 * 1000;

export default function MessengerConnectClient() {
  const [channel, setChannel] = useState<string>('SOROUSH');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef(0);
  // ── قفل «در حال پاسخ»: setInterval با بدنهٔ async اگر پاسخ کندتر از POLL_MS
  //    برسد، tick بعدی روی همان درخواست قبلی سوار می‌شود؛ آن‌وقت دو بار
  //    confirmLink صدا زده می‌شود و دومی خطای «کد مصرف‌شده» نشان می‌دهد —
  //    با اینکه اتصال درست برقرار شده است. این قفل اجازهٔ یک درخواست هم‌زمان می‌دهد.
  const pollBusyRef = useRef(false);

  // توقف polling هنگام unmount یا تغییر کد
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setWaiting(false);
  };

  const mint = async () => {
    setBusy(true);
    setMsg(null);
    setCode('');
    stopPolling();
    // ── تلاش خودکار دوباره (فقط خطای حمل‌ونقل، نه خطای منطقی) ──
    // اگر پاسخ اول در راه گم شود (شبکه/پروکسی)، کاربر نباید «حتی یک‌بار» خطا
    // ببیند؛ یک‌بار دیگر پس از مکث کوتاه تلاش می‌کنیم و فقط اگر هر دو شکست
    // خورد خطا نشان می‌دهیم. صدور تکراری بی‌ضرر است (قبلی ۱۰ دقیقه اعتبار دارد).
    let res: Awaited<ReturnType<typeof mintLinkTokenAction>> | null = null;
    let transportFailed = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        res = await mintLinkTokenAction(channel);
        transportFailed = false;
        break;
      } catch (e) {
        transportFailed = true;
        try { console.error('[messenger] mint attempt failed', attempt, (e as Error)?.message); } catch { /* ignore */ }
        if (attempt === 1) await new Promise(r => setTimeout(r, 1500));
      }
    }
    try {
      if (!res) {
        setMsg({ kind: 'err', text: transportFailed ? 'خطا در ارتباط با سرور — صفحه را رفرش کنید (Ctrl+F5) و دوباره تلاش کنید.' : 'پاسخی از سرور نرسید — دوباره تلاش کنید.' });
        return;
      }
      if (!res.ok) {
        setMsg({ kind: 'err', text: res.error });
        return;
      }
      setCode(res.code);
      setMsg({ kind: 'ok', text: `کد اتصال صادر شد (۱۰ دقیقه اعتبار). در پیام‌رسان به ${CHANNELS.find(c => c.key === channel)?.bot || 'بات'} پیام زیر را بفرستید — تأیید خودکار انجام می‌شود.` });
      startPolling(res.code);
    } catch {
      setMsg({ kind: 'err', text: 'خطا در ارتباط با سرور — صفحه را رفرش کنید (Ctrl+F5) و دوباره تلاش کنید.' });
    } finally {
      setBusy(false);
    }
  };

  const startPolling = (c: string) => {
    stopPolling();
    setWaiting(true);
    pollStartRef.current = Date.now();
    pollRef.current = setInterval(async () => {
      // توقف خودکار پس از سقف زمانی
      if (Date.now() - pollStartRef.current > POLL_MAX_MS) {
        stopPolling();
        setMsg({ kind: 'err', text: 'مهلت انتظار تمام شد. کد جدیدی بگیرید و دوباره تلاش کنید.' });
        return;
      }
      try {
        if (pollBusyRef.current) return;
        pollBusyRef.current = true;
        const st = await checkPairingAction(c);
        if (st.ok && st.paired) {
          stopPolling();
          const cf = await confirmLinkAction(c);
          if (cf.ok) {
            setMsg({ kind: 'ok', text: '✅ اتصال تأیید شد — از این پس اعلان‌ها را در پیام‌رسان می‌گیرید.' });
            setCode('');
          } else {
            setMsg({ kind: 'err', text: cf.error || 'تأیید نهایی ناموفق بود — دوباره تلاش کنید.' });
          }
        }
      } catch { /* polling بعدی تلاش می‌کند */ }
      finally { pollBusyRef.current = false; }
    }, POLL_MS);
  };

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`/start ${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: انتخاب متن
      const el = document.getElementById('link-code');
      if (el) {
        const r = document.createRange();
        r.selectNodeContents(el);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
      }
    }
  };

  const ch = CHANNELS.find(c => c.key === channel);

  return (
    <div className="card space-y-3">
      <label className="block text-xs font-bold text-slate-600">پیام‌رسان
        <select value={channel} onChange={e => { setChannel(e.target.value); setCode(''); setMsg(null); stopPolling(); }} className="mt-1 w-full rounded border px-2 py-2 text-sm">
          {CHANNELS.map(c => (
            <option key={c.key} value={c.key}>{c.label}{c.ready ? '' : ' (به‌زودی)'}</option>
          ))}
        </select>
      </label>

      <button onClick={mint} disabled={busy} className="w-full rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-800 disabled:opacity-40">
        {busy ? '⏳…' : '🎫 صدور کد اتصال یک‌بارمصرف'}
      </button>

      {code && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-center dark:border-emerald-800 dark:bg-emerald-950">
          <div className="text-2xs text-emerald-700 font-bold dark:text-emerald-200">
            در {ch?.label || 'پیام‌رسان'} به {ch?.bot || 'بات'} این پیام را بفرستید:
          </div>
          <button
            onClick={copyCode}
            className="mt-1.5 w-full rounded-lg border border-emerald-400 bg-white/70 px-3 py-2 font-mono text-lg font-black text-emerald-900 transition hover:bg-white active:scale-[0.98] dark:border-emerald-700 dark:bg-slate-900/60 dark:text-emerald-100"
            title="کلیک برای کپی"
            dir="ltr"
          >
            <span id="link-code">/start {code}</span>
            <span className="mr-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              {copied ? '✅ کپی شد' : '📋 کپی'}
            </span>
          </button>
          {waiting && (
            <div className="mt-2 flex items-center justify-center gap-1.5 text-2xs font-bold text-amber-700 dark:text-amber-300">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
              در انتظار ارسال پیام در بات — تأیید خودکار انجام می‌شود…
            </div>
          )}
        </div>
      )}

      {msg && (
        <div className={`rounded-xl border p-3 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-300 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-red-300 bg-red-50/70 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
