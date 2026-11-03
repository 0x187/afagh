'use client';

import { useState, useTransition } from 'react';

/** دکمهٔ صدور لینک استعلام رسمی کارنامهٔ مالی — کارشناس مالی برای چاپ رسمی */
export default function StatementLinkButton({ studentId }: { studentId: number }) {
  const [busy, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issue = () =>
    start(async () => {
      setError(null);
      setUrl(null);
      try {
        const r = await fetch(`/api/admin/finance/statement?studentId=${studentId}`, { cache: 'no-store' });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error || 'issue_failed');
        setUrl(data.verifyUrl as string);
      } catch (e) {
        setError((e as Error)?.message || 'issue_failed');
      }
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={issue}
        disabled={busy}
        className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-50"
      >
        {busy ? 'در حال صدور…' : '🔗 لینک استعلام رسمی'}
      </button>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
        >
          باز کردن برگهٔ رسمی (چاپ با QR) ↗
        </a>
      )}
      {error && <span className="text-2xs text-rose-600">خطا: {error}</span>}
    </span>
  );
}
