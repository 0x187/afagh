'use client';

import { useState } from 'react';
import { reviewUnfinalizeAction } from '../actions';
import { requestStepUpAction } from '@/lib/step-up-actions';
import { notify } from '@/lib/ui-feedback';

interface Props {
  requestId: number;
  currentStage: 'PENDING' | 'REVIEWED';
  canFinalApprove?: boolean;
}

export default function UnfinalizeReviewClient({ requestId, currentStage, canFinalApprove }: Props) {
  const [note, setNote] = useState('');
  const [extendTo, setExtendTo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [needStepUp, setNeedStepUp] = useState(false);
  const [password, setPassword] = useState('');
  const [pendingRetry, setPendingRetry] = useState<null | { decision: 'REVIEWED' | 'APPROVED' | 'REJECTED' }>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (decision: 'REVIEWED' | 'APPROVED' | 'REJECTED') => {
    setBusy(decision);
    try {
      const res = await reviewUnfinalizeAction(requestId, decision, note.trim() || null, extendTo.trim() || null);
      if (!res.ok && (res.error ?? '').startsWith('STEPUP_REQUIRED')) {
        setNeedStepUp(true);
        setPendingRetry({ decision });
        notify('برای ادامه، رمز عبور خود را تأیید کنید (تأیید دومرحله‌ای).', 'error');
        return;
      }
      if (!res.ok) {
        notify(res.error || 'عملیات ناموفق بود.', 'error');
        return;
      }
      setDone(res.message || 'انجام شد.');
    } finally {
      setBusy(null);
    }
  };

  const confirmStepUp = async () => {
    if (!password) {
      notify('رمز عبور را وارد کنید.', 'error');
      return;
    }
    setBusy('STEPUP');
    try {
      const s = await requestStepUpAction('grades:edit', password);
      if (!s.ok) {
        notify(s.error || 'تأیید رمز ناموفق بود.', 'error');
        return;
      }
      setNeedStepUp(false);
      setPassword('');
      if (pendingRetry) {
        const d = pendingRetry.decision;
        setPendingRetry(null);
        await run(d);
      }
    } finally {
      setBusy(null);
    }
  };

  if (done) return <span className="text-2xs font-black text-emerald-700">{done}</span>;

  return (
    <div className="space-y-2 min-w-[220px]">
      <input
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="توضیح بررسی (اختیاری)"
        className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-2xs"
      />
      {(currentStage === 'REVIEWED' || canFinalApprove) && (
        <input
          type="date"
          value={extendTo}
          onChange={e => setExtendTo(e.target.value)}
          title="تمدید مهلت اختصاصی ثبت نمره (اختیاری، نمایشی)"
          className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-2xs"
        />
      )}
      {needStepUp && (
        <div className="flex gap-1">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="رمز عبور برای تأیید دومرحله‌ای"
            className="flex-1 bg-white border-2 border-amber-400 rounded px-2 py-1 text-2xs"
          />
          <button
            onClick={confirmStepUp}
            disabled={busy === 'STEPUP'}
            className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 text-2xs font-black rounded disabled:opacity-50"
          >
            تأیید رمز
          </button>
        </div>
      )}
      <div className="flex gap-1">
        {currentStage === 'PENDING' ? (
          <>
            <button
              onClick={() => run('REVIEWED')}
              disabled={!!busy}
              className="flex-1 px-2 py-1 bg-indigo-700 hover:bg-indigo-800 text-white text-2xs font-bold rounded disabled:opacity-50"
            >
              {busy === 'REVIEWED' ? '…' : 'تأیید مرحلهٔ اول'}
            </button>
            <button
              onClick={() => run('REJECTED')}
              disabled={!!busy}
              className="flex-1 px-2 py-1 bg-white border border-rose-300 text-rose-700 text-2xs font-bold rounded disabled:opacity-50"
            >
              {busy === 'REJECTED' ? '…' : 'رد'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => run('APPROVED')}
              disabled={!!busy}
              className="flex-1 px-2 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-2xs font-bold rounded disabled:opacity-50"
            >
              {busy === 'APPROVED' ? '…' : 'تأیید نهایی (معاون آموزشی)'}
            </button>
            <button
              onClick={() => run('REJECTED')}
              disabled={!!busy}
              className="flex-1 px-2 py-1 bg-white border border-rose-300 text-rose-700 text-2xs font-bold rounded disabled:opacity-50"
            >
              {busy === 'REJECTED' ? '…' : 'رد'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
