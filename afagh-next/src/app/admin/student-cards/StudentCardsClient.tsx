'use client';

import React, { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { issueCardAction, revokeCardAction } from './actions';

export type CardRow = {
  studentId: number;
  studentCode: string;
  fullName: string;
  nationalCode: string | null;
  status: string;
  entryYear: number | null;
  majorName: string | null;
  degreeLevel: string | null;
  card: {
    id: number;
    token: string;
    printStatus: string;
    rfidSerialNumber: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
    expired: boolean;
  } | null;
  debt: number;
};

type Stats = { total: number; issued: number; blocked: number; expired: number };

const fa = (n: unknown) => String(n ?? '—').replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const mask = (c: string | null) => (!c ? '—' : c.length <= 5 ? c : `${c.slice(0, 3)}${'*'.repeat(c.length - 5)}${c.slice(-2)}`);

const STATUS_TONE: Record<string, string> = {
  PRINTED: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  PENDING: 'bg-slate-100 text-slate-700 border-slate-300',
  LOST: 'bg-amber-100 text-amber-900 border-amber-300',
  REVOKED: 'bg-rose-100 text-rose-900 border-rose-300',
};

export default function StudentCardsClient({
  rows,
  q: qProp,
  page,
  totalPages,
  total,
  perPage,
  stats,
}: {
  rows: CardRow[];
  q: string;
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  stats: Stats;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(qProp);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const firstRender = useRef(true);

  // جستجوی سمت سرور با تأخیر کوتاه — ۴۸ هزار دانشجو هرگز یک‌جا به مرورگر نمی‌آید
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (query.trim()) p.set('q', query.trim());
      startTransition(() => router.replace(`/admin/student-cards${p.toString() ? `?${p}` : ''}`));
    }, 400);
    return () => clearTimeout(t);
  }, [query, router]);

  const notify = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(null), 6000);
  };

  const run = async (studentId: number, fn: () => Promise<unknown>, success: string) => {
    setBusy(studentId);
    try {
      await fn();
      notify(success);
    } catch (err) {
      notify(`⚠️ ${(err as Error)?.message || 'عملیات ناموفق بود.'}`);
    } finally {
      setBusy(null);
    }
  };

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (qProp) sp.set('q', qProp);
    if (p > 1) sp.set('page', String(p));
    const s = sp.toString();
    return `/admin/student-cards${s ? `?${s}` : ''}`;
  };

  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className="space-y-4">
      {message && (
        <div className="card !p-3 bg-indigo-50 border-indigo-300 text-xs font-bold text-indigo-900 flex items-center justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-indigo-500">✕</button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['دانشجویان', stats.total, 'bg-white'],
          ['کارت صادرشده', stats.issued, 'bg-emerald-50'],
          ['مسدودی مالی', stats.blocked, 'bg-rose-50'],
          ['باطل/منقضی/مفقود', stats.expired, 'bg-amber-50'],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className={`card !p-3 ${tone} border-slate-300`}>
            <div className="text-2xs text-slate-500 font-bold">{label}</div>
            <div className="text-lg font-black text-slate-900">{fa(value)}</div>
          </div>
        ))}
      </div>

      <div className="card !p-3 bg-white border-slate-300 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="جست‌وجو با شمارهٔ دانشجویی، کد ملی یا نام…"
          className="flex-1 min-w-52 rounded-xl border border-slate-300 p-2 text-xs"
        />
        {query && (
          <button onClick={() => setQuery('')} className="rounded-lg border border-slate-300 px-2 py-1 text-3xs font-bold text-slate-600">
            پاک‌کردن
          </button>
        )}
        <span className="text-2xs text-slate-500 font-bold">
          {pending ? '… در حال جست‌وجو' : qProp ? `${fa(total)} نتیجه برای «${qProp}»` : `${fa(total)} دانشجو`}
        </span>
      </div>

      <div className="card !p-0 bg-white border-slate-300 overflow-x-auto">
        <table className="w-full text-right text-xs rt">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              {['دانشجو', 'شمارهٔ دانشجویی', 'وضعیت تحصیلی', 'بدهی (ریال)', 'وضعیت کارت', 'انقضا', 'توکن امنیتی', 'عملیات'].map(h => (
                <th key={h} className="p-2.5 font-bold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.studentId} className="border-t border-slate-200 hover:bg-slate-50">
                <td className="p-2.5">
                  <div className="font-bold text-slate-900">{r.fullName}</div>
                  <div className="text-3xs text-slate-500">{r.degreeLevel ?? '—'} · {r.majorName ?? 'بدون رشته'}</div>
                </td>
                <td className="p-2.5 font-mono font-bold" dir="ltr">{r.studentCode}</td>
                <td className="p-2.5">
                  <span className={`rounded-lg border px-2 py-0.5 text-3xs font-bold ${r.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-300'}`}>
                    {r.status}
                  </span>
                </td>
                <td className={`p-2.5 font-mono font-bold ${r.debt > 0 ? 'text-rose-700' : 'text-slate-500'}`}>{fa(r.debt)}</td>
                <td className="p-2.5">
                  {r.card ? (
                    <span className={`rounded-lg border px-2 py-0.5 text-3xs font-bold ${STATUS_TONE[r.card.printStatus] ?? STATUS_TONE.PENDING}`}>
                      {r.card.printStatus}
                    </span>
                  ) : (
                    <span className="text-3xs text-slate-400 font-bold">صادر نشده</span>
                  )}
                </td>
                <td className="p-2.5 font-mono text-2xs">{r.card?.expiresAt ?? '—'}</td>
                <td className="p-2.5">
                  {r.card ? (
                    <span className="font-mono text-3xs text-slate-600" dir="ltr" title={r.card.token}>
                      {r.card.token.slice(0, 12)}…
                    </span>
                  ) : '—'}
                </td>
                <td className="p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      disabled={busy === r.studentId}
                      onClick={() =>
                        run(r.studentId, () => issueCardAction(r.studentId, false), `کارت «${r.fullName}» صادر/تمدید شد.`)
                      }
                      className="rounded-lg bg-indigo-700 px-2.5 py-1 text-3xs font-bold text-white hover:bg-indigo-800 disabled:opacity-50"
                    >
                      {r.card ? 'تمدید' : 'صدور کارت'}
                    </button>
                    {r.card && (
                      <>
                        <button
                          disabled={busy === r.studentId}
                          onClick={() =>
                            run(r.studentId, () => issueCardAction(r.studentId, true), 'توکن جدید ساخته شد؛ کارت قبلی از اعتبار افتاد.')
                          }
                          className="rounded-lg border border-slate-300 px-2 py-1 text-3xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                        >
                          تعویض توکن
                        </button>
                        <Link
                          href={`/admin/student-cards/card/${r.studentId}`}
                          target="_blank"
                          className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-3xs font-bold text-emerald-800 hover:bg-emerald-100"
                        >
                          🖨 چاپ کارت (QR)
                        </Link>
                        <Link
                          href={`/id/${r.card.token}`}
                          target="_blank"
                          className="rounded-lg border border-indigo-300 bg-indigo-50 px-2 py-1 text-3xs font-bold text-indigo-800 hover:bg-indigo-100"
                        >
                          تست گیت ↗
                        </Link>
                        <button
                          disabled={busy === r.studentId}
                          onClick={() => run(r.studentId, () => revokeCardAction(r.studentId, 'LOST'), 'کارت مفقود اعلام شد.')}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-3xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                        >
                          مفقودی
                        </button>
                        <button
                          disabled={busy === r.studentId}
                          onClick={() => run(r.studentId, () => revokeCardAction(r.studentId, 'REVOKED'), 'کارت باطل شد.')}
                          className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-3xs font-bold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                        >
                          ابطال
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-500">
                  {qProp ? `دانشجویی با «${qProp}» یافت نشد.` : 'دانشجویی یافت نشد.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-bold text-slate-600">
          <span>نمایش {fa(from)}–{fa(to)} از {fa(total)}</span>
          <div className="flex items-center gap-1.5">
            <Link
              href={pageHref(page - 1)}
              aria-disabled={page <= 1}
              className={`rounded-lg border px-3 py-1 ${page <= 1 ? 'pointer-events-none border-slate-200 text-slate-400' : 'border-slate-300 hover:bg-slate-100'}`}
            >
              ← قبلی
            </Link>
            <span className="px-2">صفحهٔ {fa(page)} از {fa(totalPages)}</span>
            <Link
              href={pageHref(page + 1)}
              aria-disabled={page >= totalPages}
              className={`rounded-lg border px-3 py-1 ${page >= totalPages ? 'pointer-events-none border-slate-200 text-slate-400' : 'border-slate-300 hover:bg-slate-100'}`}
            >
              بعدی →
            </Link>
          </div>
        </div>
      )}

      <p className="text-2xs text-slate-500 leading-5">
        کارت با وضعیت «باطل/مفقود/منقضی»، دانشجوی غیرفعال و دانشجوی دارای بدهی در گیت حراست قرمز می‌شود و ورود
        مجاز نیست. کد ملی در این فهرست ماسک‌شده نمایش داده می‌شود: <span className="font-mono">{mask(rows[0]?.nationalCode ?? null)}</span>
      </p>
    </div>
  );
}
