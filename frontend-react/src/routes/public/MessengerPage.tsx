import { Navigate, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2, Loader2, Ticket, Unlink } from 'lucide-react';

import { useSession } from '@/lib/session';
import {
  MESSENGER_CHANNELS,
  checkPairing,
  confirmLink,
  listMyChannels,
  mintLinkToken,
  revokeChannel,
  type MessengerChannelKey,
  type UserChannel,
} from '@/lib/messenger-api';
import { ApiError } from '@/lib/api';

// ═══ صفحهٔ اتصال پیام‌رسان — پورت /messenger (page.tsx + MessengerConnectClient) ═══
//
// اتصال با کد یک‌بارمصرف (بدون رمز عبور در چت) — همهٔ نقش‌ها؛ صفحهٔ عمومی
// بدون شل ولی نیازمند نشست (بدون ورود → /login، همان redirect در Next).

/** فاصلهٔ هر polling وضعیت جفت‌سازی (میلی‌ثانیه) */
const POLL_MS = 2500;
/** حداکثر مدت polling — کمی بیشتر از TTL توکن (۱۰ دقیقه) */
const POLL_MAX_MS = 11 * 60 * 1000;

type Msg = { kind: 'ok' | 'err'; text: string } | null;

export function MessengerPage() {
  const { data, isLoading } = useSession();
  const location = useLocation();
  // پس از هر تأیید اتصال، فهرست کانال‌ها دوباره خوانده می‌شود.
  const [channelsVersion, setChannelsVersion] = useState(0);

  // گارد نشست — همان redirect('/login') در page.tsx
  if (!isLoading && !data?.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 dark:bg-slate-950" dir="rtl">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm dark:bg-slate-900">
          <h1 className="flex items-center gap-2 text-base font-black sm:text-lg">
            <Link2 className="size-5" aria-hidden /> اتصال پیام‌رسان برای اعلان‌ها
          </h1>
          <p className="mt-1 text-xs leading-6 text-slate-500 dark:text-slate-400">
            نمره، کلاس جبرانی و فیش حقوقی را در پیام‌رسان بگیرید. رمز عبورتان <b>هیچ‌وقت</b> در چت ننویسید —
            اتصال با کد یک‌بارمصرف (۱۰ دقیقه اعتبار) انجام می‌شود.
          </p>
        </div>
        <MessengerConnectCard onConfirmed={() => setChannelsVersion((v) => v + 1)} />
        <MyChannelsCard reloadKey={channelsVersion} />
      </div>
    </div>
  );
}

// ─────────────────── کارت اتصال (mint → poll → confirm) ───────────────────

function MessengerConnectCard({ onConfirmed }: { onConfirmed?: () => void }) {
  const [channel, setChannel] = useState<MessengerChannelKey>('SOROUSH');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
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
  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setWaiting(false);
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
        const st = await checkPairing(c);
        if (st.ok && st.paired) {
          stopPolling();
          const cf = await confirmLink(c);
          if (cf.ok) {
            setMsg({ kind: 'ok', text: '✅ اتصال تأیید شد — از این پس اعلان‌ها را در پیام‌رسان می‌گیرید.' });
            setCode('');
            onConfirmed?.();
          } else {
            setMsg({ kind: 'err', text: cf.error || 'تأیید نهایی ناموفق بود — دوباره تلاش کنید.' });
          }
        }
      } catch {
        /* polling بعدی تلاش می‌کند */
      } finally {
        pollBusyRef.current = false;
      }
    }, POLL_MS);
  };

  const mint = async () => {
    setBusy(true);
    setMsg(null);
    setCode('');
    stopPolling();
    // ── تلاش خودکار دوباره (فقط خطای حمل‌ونقل، نه خطای منطقی) ──
    // اگر پاسخ اول در راه گم شود (شبکه/پروکسی)، کاربر نباید «حتی یک‌بار» خطا
    // ببیند؛ یک‌بار دیگر پس از مکث کوتاه تلاش می‌کنیم. صدور تکراری بی‌ضرر است
    // (قبلی ۱۰ دقیقه اعتبار دارد). خطای منطقی (ok:false) همان‌جا نشان داده می‌شود.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let res: Awaited<ReturnType<typeof mintLinkToken>> | null = null;
    let transportFailed = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        res = await mintLinkToken(channel);
        transportFailed = false;
        break;
      } catch (e) {
        transportFailed = e instanceof ApiError && e.status === 0;
        if (attempt === 1) await sleep(1500);
      }
    }
    try {
      if (!res) {
        setMsg({
          kind: 'err',
          text: transportFailed
            ? 'خطا در ارتباط با سرور — صفحه را رفرش کنید (Ctrl+F5) و دوباره تلاش کنید.'
            : 'پاسخی از سرور نرسید — دوباره تلاش کنید.',
        });
        return;
      }
      if (!res.ok) {
        setMsg({ kind: 'err', text: res.error || 'صدور کد ناموفق بود — دوباره تلاش کنید.' });
        return;
      }
      setCode(res.code ?? '');
      setMsg({
        kind: 'ok',
        text: `کد اتصال صادر شد (۱۰ دقیقه اعتبار). در پیام‌رسان به ${
          MESSENGER_CHANNELS.find((c) => c.key === channel)?.bot || 'بات'
        } پیام زیر را بفرستید — تأیید خودکار انجام می‌شود.`,
      });
      if (res.code) startPolling(res.code);
    } catch {
      setMsg({ kind: 'err', text: 'خطا در ارتباط با سرور — صفحه را رفرش کنید (Ctrl+F5) و دوباره تلاش کنید.' });
    } finally {
      setBusy(false);
    }
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

  const ch = MESSENGER_CHANNELS.find((c) => c.key === channel);

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4 shadow-sm dark:bg-slate-900">
      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
        پیام‌رسان
        <select
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value as MessengerChannelKey);
            setCode('');
            setMsg(null);
            stopPolling();
          }}
          className="mt-1 w-full rounded border px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          {MESSENGER_CHANNELS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
              {c.ready ? '' : ' (به‌زودی)'}
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={mint}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-800 disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Ticket className="size-4" aria-hidden />}
        {busy ? '…' : 'صدور کد اتصال یک‌بارمصرف'}
      </button>

      {code && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-center dark:border-emerald-800 dark:bg-emerald-950">
          <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-200">
            در {ch?.label || 'پیام‌رسان'} به {ch?.bot || 'بات'} این پیام را بفرستید:
          </div>
          <button
            onClick={copyCode}
            className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400 bg-white/70 px-3 py-2 font-mono text-lg font-black text-emerald-900 transition hover:bg-white active:scale-[0.98] dark:border-emerald-700 dark:bg-slate-900/60 dark:text-emerald-100"
            title="کلیک برای کپی"
            dir="ltr"
          >
            <span id="link-code">/start {code}</span>
            <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
              {copied ? 'کپی شد' : 'کپی'}
            </span>
          </button>
          {waiting && (
            <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              در انتظار ارسال پیام در بات — تأیید خودکار انجام می‌شود…
            </div>
          )}
        </div>
      )}

      {msg && (
        <div
          className={`rounded-xl border p-3 text-xs font-bold ${
            msg.kind === 'ok'
              ? 'border-emerald-300 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : 'border-red-300 bg-red-50/70 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

// ─────────────────── کارت وضعیت کانال‌ها + لغو اتصال ───────────────────

function MyChannelsCard({ reloadKey }: { reloadKey: number }) {
  const [channels, setChannels] = useState<UserChannel[] | null>(null);
  const [busyChannel, setBusyChannel] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setChannels(await listMyChannels());
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'خواندن کانال‌ها ناموفق بود.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, reloadKey]);

  const revoke = async (channel: string) => {
    setBusyChannel(channel);
    try {
      await revokeChannel(channel);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'لغو اتصال ناموفق بود.');
    } finally {
      setBusyChannel('');
    }
  };

  const rows = (channels ?? []).filter((c) => MESSENGER_CHANNELS.some((m) => m.key === c.channel));

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4 shadow-sm dark:bg-slate-900">
      <h2 className="text-sm font-black text-slate-700 dark:text-slate-200">کانال‌های متصل</h2>
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50/70 p-2 text-xs font-bold text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}
      {channels === null ? (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
          <Loader2 className="size-4 animate-spin" aria-hidden /> در حال بارگذاری…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs leading-6 text-slate-500 dark:text-slate-400">
          هنوز هیچ پیام‌رسانی متصل نشده — با کد یک‌بارمصرف بالا اتصال را برقرار کنید.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((c) => {
            const label = MESSENGER_CHANNELS.find((m) => m.key === c.channel)?.label ?? c.label ?? c.channel;
            return (
              <li key={c.channel} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{label}</div>
                  <div className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400" dir="ltr">
                    {c.address}
                  </div>
                </div>
                <button
                  onClick={() => revoke(c.channel)}
                  disabled={busyChannel === c.channel}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-red-300 px-2.5 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                >
                  {busyChannel === c.channel ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                  ) : (
                    <Unlink className="size-3" aria-hidden />
                  )}
                  لغو اتصال
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
