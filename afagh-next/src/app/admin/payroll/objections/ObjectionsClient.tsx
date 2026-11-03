'use client';

import { useState, useTransition } from 'react';

type Item = {
  id: number; statementId: number; termTitle: string | null;
  text: string; status: string; reviewNote: string | null;
  reopenedStatement: number; createdAt: string | null;
  staffName: string; staffCode: string | null;
  grossAmount?: string | null; statementStatus?: string | null;
};

const faNum = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export default function ObjectionsClient(props: {
  initialOpen: Item[];
  initialHistory: Item[];
  statusFa: Record<string, string>;
  actions: {
    reviewAction: (id: number, decision: 'RESOLVED' | 'REJECTED', reviewNote: string, reopen: boolean) => Promise<{ ok: boolean; error?: string }>;
  };
}) {
  const { statusFa, actions } = props;
  const [open, setOpen] = useState<Item[]>(props.initialOpen);
  const [history] = useState<Item[]>(props.initialHistory);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // فرم بررسی
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [reopen, setReopen] = useState(false);

  function doReview(id: number, decision: 'RESOLVED' | 'REJECTED') {
    setMsg(null);
    start(async () => {
      const res = await actions.reviewAction(id, decision, note, reopen);
      if (!res.ok) { setMsg(res.error ?? 'خطا در ثبت بررسی.'); return; }
      setOpen(os => os.filter(o => o.id !== id));
      setReviewId(null); setNote(''); setReopen(false);
      setMsg(decision === 'RESOLVED' ? 'اعتراض رسیدگی شد.' : 'اعتراض وارد تشخیص داده نشد.');
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-black text-slate-900">اعتراض‌های اساتید به فیش</h1>
        <a href="/admin/payroll" className="text-sm text-slate-600 underline">بازگشت به میز حق‌التدریس</a>
      </div>

      {msg ? <div className="rounded-xl border border-slate-300 bg-slate-50 p-2.5 text-sm text-slate-800">{msg}</div> : null}

      {/* ── صف بررسی ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="font-black text-slate-900 text-sm">
          صف بررسی <span className="text-xs font-normal text-slate-500">({faNum(open.length)} باز)</span>
        </h2>
        {open.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">
            اعتراض بازی نیست ✅
          </div>
        ) : (
          <div className="space-y-3">
            {open.map(o => (
              <div key={o.id} className="rounded-2xl border border-amber-200 bg-amber-50/40 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <b className="text-slate-900">{o.staffName}</b>
                  <span className="font-mono text-slate-500" dir="ltr">{o.staffCode}</span>
                  <span className="text-slate-500">· {o.termTitle ?? '—'}</span>
                  <span className="text-slate-500">· فیش #{faNum(o.statementId)}</span>
                </div>
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{o.text}</p>
                {reviewId === o.id ? (
                  <div className="space-y-2 pt-1">
                    <textarea
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="یادداشت بررسی (الزامی)…"
                      rows={2}
                      className="w-full border border-slate-300 rounded-xl px-2 py-1.5 text-sm"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input type="checkbox" checked={reopen} onChange={e => setReopen(e.target.checked)} />
                      فیش برای اصلاح بازگشایی شود
                    </label>
                    <div className="flex gap-2">
                      <button onClick={() => doReview(o.id, 'RESOLVED')} disabled={pending || note.trim().length < 3} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">
                        رسیدگی شد
                      </button>
                      <button onClick={() => doReview(o.id, 'REJECTED')} disabled={pending || note.trim().length < 3} className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm text-rose-700 disabled:opacity-50">
                        وارد نیست
                      </button>
                      <button onClick={() => { setReviewId(null); setNote(''); setReopen(false); }} className="text-xs text-slate-500">انصراف</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setReviewId(o.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs">
                    بررسی…
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── سوابق ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="font-black text-slate-900 text-sm">سوابق اعتراض‌ها</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm rt">
            <thead>
              <tr className="text-xs text-slate-500 border-b">
                <th className="p-2 text-right">استاد</th>
                <th className="p-2 text-right">ترم / فیش</th>
                <th className="p-2 text-right">متن</th>
                <th className="p-2">وضعیت</th>
                <th className="p-2 text-right">نتیجه بررسی</th>
              </tr>
            </thead>
            <tbody>
              {history.map(h => (
                <tr key={h.id} className="border-b border-slate-100">
                  <td className="p-2 font-bold whitespace-nowrap">{h.staffName}</td>
                  <td className="p-2 text-xs text-slate-500 whitespace-nowrap">{h.termTitle ?? '—'} · #{faNum(h.statementId)}</td>
                  <td className="p-2 text-xs max-w-64 truncate" title={h.text}>{h.text}</td>
                  <td className="p-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-3xs font-black ${h.status === 'OPEN' ? 'bg-amber-100 text-amber-900' : h.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-200 text-slate-600'}`}>
                      {statusFa[h.status] ?? h.status}
                    </span>
                  </td>
                  <td className="p-2 text-xs text-slate-600">
                    {h.reviewNote ?? '—'}
                    {h.reopenedStatement ? <span className="text-indigo-600"> (فیش بازگشایی شد)</span> : null}
                  </td>
                </tr>
              ))}
              {history.length === 0 ? (
                <tr><td colSpan={5} className="p-4 text-center text-xs text-slate-500">سابقه‌ای ثبت نشده است.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
