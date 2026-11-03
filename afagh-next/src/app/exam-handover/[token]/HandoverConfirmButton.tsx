'use client';

import { useState, useTransition } from 'react';
import { examHandoverConfirmAction } from '@/lib/exam-actions';

/** تأیید تحویل توسط تحویلگیرنده — اکشن سرور، هویت از نشست */
export function HandoverConfirmButton({ token, stepLabel, userName }: { token: string; stepLabel: string; userName: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const confirm = () => {
    startTransition(async () => {
      const res = await examHandoverConfirmAction(token);
      setResult(
        typeof res === 'object' && res !== null && 'ok' in res && res.ok
          ? { ok: true, text: ('message' in res ? String((res as { message?: string }).message) : '') || 'تحویل ثبت شد.' }
          : { ok: false, text: (typeof res === 'object' && res !== null && 'error' in res ? String((res as { error?: string }).error) : '') || 'ثبت تحویل ممکن نشد.' },
      );
    });
  };

  if (result?.ok) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-center">
        <div className="text-2xl">✓</div>
        <p className="mt-1 text-sm font-black text-emerald-800">{result.text}</p>
        <p className="mt-1 text-2xs text-emerald-700">تحویلگیرنده: {userName}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={confirm}
        disabled={pending}
        className="w-full rounded-2xl bg-indigo-900 py-3 text-sm font-black text-white shadow transition hover:bg-indigo-950 disabled:opacity-50"
      >
        {pending ? 'در حال ثبت…' : `✅ تأیید ${stepLabel} (به‌عنوان ${userName})`}
      </button>
      {result && !result.ok && (
        <p className="rounded-xl border border-rose-300 bg-rose-50 p-2 text-center text-xs font-bold text-rose-800">{result.text}</p>
      )}
    </div>
  );
}
