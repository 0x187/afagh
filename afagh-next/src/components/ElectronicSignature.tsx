'use client';

// امضای الکترونیک سه‌وضعیتی — سند §۲۹۲۶:  IDLE → OTP_SENT → SIGNED
// OTP پنج‌رقمی، انقضای ۲ دقیقه، قفل پس از ۵ تلاش، مهر دیجیتال با زمان و اثر سوئیچ
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendOtpAction, verifySignAction } from '@/app/professor/documents/actions';

type Phase = 'IDLE' | 'OTP_SENT' | 'SIGNED';

export default function ElectronicSignature(props: {
  documentId: number;
  initialStatus: string; // PENDING / SIGNED
  documentHash: string;
  signedAt?: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(props.initialStatus === 'SIGNED' ? 'SIGNED' : 'IDLE');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [remain, setRemain] = useState(120);
  const [signedAt, setSignedAt] = useState(props.signedAt ?? null);

  useEffect(() => {
    if (phase !== 'OTP_SENT') return;
    const t = setInterval(() => setRemain(r => (r <= 0 ? 0 : r - 1)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  async function requestOtp() {
    setBusy(true); setError(''); setOtp('');
    const res = await sendOtpAction(props.documentId);
    setBusy(false);
    if (!res.ok) { setError(res.error || 'خطا در ارسال کد'); return; }
    setDevOtp(res.devOtp || '');
    setRemain(res.expiresInSeconds);
    setPhase('OTP_SENT');
  }

  async function sign() {
    setBusy(true); setError('');
    const res = await verifySignAction(props.documentId, otp.trim());
    setBusy(false);
    if (!res.ok) { setError(res.error || 'خطا در امضا'); setOtp(''); return; }
    setSignedAt(res.signedAt ?? null);
    setPhase('SIGNED');
    router.refresh(); // بنر و فهرست اسناد هم به‌روز شوند
  }

  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(remain % 60).padStart(2, '0');

  // ── وضعیت ۳: امضا شده — مهر دیجیتال ──
  if (phase === 'SIGNED') return (
    <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-5 text-center dark:border-emerald-700 dark:bg-emerald-950">
      <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full border-4 border-emerald-600 text-2xl text-emerald-700 dark:text-emerald-300">✓</div>
      <p className="font-bold text-emerald-800 dark:text-emerald-200">امضا شد</p>
      <p className="mt-1 text-xs text-emerald-700">
        {signedAt ? new Date(signedAt).toLocaleString('fa-IR') : ''}
      </p>
      <p className="mt-1 break-all font-mono text-3xs text-emerald-600" dir="ltr">SHA-256: {props.documentHash.slice(0, 32)}…</p>
    </div>
  );

  // ── وضعیت ۲: کد ارسال شد ──
  if (phase === 'OTP_SENT') return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm">کد تأیید شش‌رقمی به شمارهٔ همراه ثبت‌شده ارسال شد.</p>
      {devOtp && <p className="rounded-xl bg-amber-50 p-2 text-center text-sm text-amber-800 dark:border dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">[حالت توسعه] کد: <b className="font-mono" dir="ltr">{devOtp}</b></p>}
      <input
        className="input text-center font-mono text-2xl tracking-[0.6em]"
        dir="ltr" inputMode="numeric" maxLength={6} placeholder="••••••"
        value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
      />
      {error && <p className="rounded-xl bg-red-50 p-2 text-center text-sm text-red-700 dark:border dark:border-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      <div className="flex items-center justify-between">
        <span className={'text-xs ' + (remain <= 30 ? 'text-red-600' : 'text-slate-500')} dir="ltr">{mm}:{ss}</span>
        <button className="text-xs text-slate-500 underline" onClick={requestOtp} disabled={busy}>ارسال مجدد</button>
      </div>
      <button className="btn-primary w-full" disabled={busy || otp.length !== 6 || remain <= 0} onClick={sign}>
        {busy ? 'در حال تأیید…' : 'تأیید و امضا'}
      </button>
    </div>
  );

  // ── وضعیت ۱: خاموش ──
  return (
    <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
      <p className="text-sm text-slate-600">این سند منتظر امضای الکترونیک شماست.</p>
      {error && <p className="rounded-xl bg-red-50 p-2 text-sm text-red-700 dark:border dark:border-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      <button className="btn-primary" disabled={busy} onClick={requestOtp}>{busy ? 'در حال ارسال…' : 'درخواست کد تأیید'}</button>
    </div>
  );
}
