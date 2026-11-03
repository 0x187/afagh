'use client';

import { useState, useTransition } from 'react';

export type GradeObjectionItem = {
  id: number;
  studentName: string;
  studentCode: string | null;
  termTitle: string | null;
  courseCode: string | null;
  courseTitle: string | null;
  gradeAtObjection: string | null;
  gradeStatus: string | null;
  requestText: string;
  status: string;
  reviewerNote: string | null;
  createdAt: string | null;
};

const faNum = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export default function GradeObjectionsClient(props: {
  initialOpen: GradeObjectionItem[];
  initialHistory: GradeObjectionItem[];
  statusFa: Record<string, string>;
  actions: {
    reviewAction: (
      id: number,
      decision: 'ACCEPTED' | 'REJECTED',
      reviewNote: string,
    ) => Promise<{ ok: boolean; error?: string }>;
  };
}) {
  const { statusFa, actions } = props;
  const [open, setOpen] = useState<GradeObjectionItem[]>(props.initialOpen);
  const [history] = useState<GradeObjectionItem[]>(props.initialHistory);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [reviewId, setReviewId] = useState<number | null>(null);
  const [note, setNote] = useState('');

  function doReview(id: number, decision: 'ACCEPTED' | 'REJECTED') {
    setMsg(null);
    start(async () => {
      const res = await actions.reviewAction(id, decision, note);
      if (!res.ok) {
        setMsg(res.error ?? 'خطا در ثبت بررسی.');
        return;
      }
      setOpen(os => os.filter(o => o.id !== id));
      setReviewId(null);
      setNote('');
      setMsg(decision === 'ACCEPTED' ? 'اعتراض پذیرفته شد ✅' : 'اعتراض رد شد.');
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-black text-slate-900">اعتراض‌های دانشجویان به نمره</h1>
      </div>

      {msg ? (
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-2.5 text-sm text-slate-800">{msg}</div>
      ) : null}

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
                  <b className="text-slate-900">{o.studentName}</b>
                  <span className="font-mono text-slate-500" dir="ltr">
                    {o.studentCode}
                  </span>
                  <span className="text-slate-500">· {o.termTitle ?? '—'}</span>
                  <span className="text-slate-500">
                    · {o.courseTitle ?? '—'}{' '}
                    <span className="font-mono" dir="ltr">
                      ({o.courseCode ?? '—'})
                    </span>
                  </span>
                  <span className="text-slate-500">· نمره {o.gradeAtObjection ?? '—'}</span>
                </div>
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{o.requestText}</p>
                {reviewId === o.id ? (
                  <div className="space-y-2 pt-1">
                    <textarea
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="یادداشت بررسی (الزامی، حداقل ۳ کاراکتر)…"
                      rows={2}
                      className="w-full border border-slate-300 rounded-xl px-2 py-1.5 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => doReview(o.id, 'ACCEPTED')}
                        disabled={pending || note.trim().length < 3}
                        className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                      >
                        پذیرفته شد
                      </button>
                      <button
                        onClick={() => doReview(o.id, 'REJECTED')}
                        disabled={pending || note.trim().length < 3}
                        className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm text-rose-700 disabled:opacity-50"
                      >
                        وارد نیست (رد)
                      </button>
                      <button
                        onClick={() => {
                          setReviewId(null);
                          setNote('');
                        }}
                        className="text-xs text-slate-500"
                      >
                        انصراف
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setReviewId(o.id)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  >
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
        <h2 className="font-black text-slate-900 text-sm">سوابق بررسی‌ها</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b">
                <th className="p-2 text-right">دانشجو</th>
                <th className="p-2 text-right">درس / ترم</th>
                <th className="p-2 text-right">متن اعتراض</th>
                <th className="p-2">وضعیت</th>
                <th className="p-2 text-right">یادداشت کارشناس</th>
              </tr>
            </thead>
            <tbody>
              {history.map(h => (
                <tr key={h.id} className="border-b border-slate-100">
                  <td className="p-2 font-bold whitespace-nowrap">
                    {h.studentName}
                    <div className="font-mono text-3xs text-slate-400" dir="ltr">
                      {h.studentCode ?? ''}
                    </div>
                  </td>
                  <td className="p-2 text-xs text-slate-500 whitespace-nowrap">
                    {h.courseTitle ?? '—'} · {h.termTitle ?? '—'}
                  </td>
                  <td className="p-2 text-xs max-w-64 truncate" title={h.requestText}>
                    {h.requestText}
                  </td>
                  <td className="p-2 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-3xs font-black ${
                        h.status === 'PENDING'
                          ? 'bg-amber-100 text-amber-900'
                          : h.status === 'ACCEPTED'
                            ? 'bg-emerald-100 text-emerald-900'
                            : h.status === 'REJECTED'
                              ? 'bg-rose-100 text-rose-900'
                              : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {statusFa[h.status] ?? h.status}
                    </span>
                  </td>
                  <td className="p-2 text-xs text-slate-600">{h.reviewerNote ?? '—'}</td>
                </tr>
              ))}
              {history.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-xs text-slate-500">
                    سابقه‌ای ثبت نشده است.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
