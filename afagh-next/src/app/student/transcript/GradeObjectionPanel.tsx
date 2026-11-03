'use client';

import { useState } from 'react';
import { submitGradeObjectionAction } from '../requests/actions';

export type ObjectionRow = {
  enrollmentId: number;
  code: string;
  title: string;
  grade: number | null;
  gradeStatus: string | null;
  isFinalized: boolean;
};

export type ObjectionTerm = {
  termTitle: string;
  termCode: string;
  isCurrent: boolean;
  rows: ObjectionRow[];
};

const statusBadge: Record<string, { label: string; cls: string }> = {
  PENDING: { label: '⏳ در حال بررسی', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  REVIEWED: { label: '🔎 بررسی شد', cls: 'bg-sky-100 text-sky-900 border-sky-300' },
  ACCEPTED: { label: '✅ پذیرفته شد', cls: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
  REJECTED: { label: '❌ رد شد', cls: 'bg-rose-100 text-rose-900 border-rose-300' },
};

function jdate(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

export default function GradeObjectionPanel({
  terms,
  windowOpen,
  deadline,
  existing,
}: {
  terms: ObjectionTerm[];
  windowOpen: boolean;
  deadline: string | null;
  existing: Record<number, { status: string; note: string | null }>;
}) {
  const [localStatus, setLocalStatus] = useState<Record<number, { status: string; note: string | null }>>(existing);
  const [openId, setOpenId] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const openRow = terms.flatMap(t => t.rows).find(r => r.enrollmentId === openId) ?? null;

  async function submit() {
    if (openId == null) return;
    setBusy(true);
    setError(null);
    const res = await submitGradeObjectionAction(openId, text);
    setBusy(false);
    if (res.ok) {
      setLocalStatus(s => ({ ...s, [openId]: { status: 'PENDING', note: null } }));
      setDone(openId);
      setOpenId(null);
      setText('');
    } else {
      setError(res.error || 'خطا در ثبت اعتراض.');
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
        <h3 className="font-extrabold text-sm">📑 کارنامه نیمسال و اعتراض به نمره</h3>
        <span className="text-2xs font-bold">
          {windowOpen ? (
            <span className="text-emerald-200">پنجره اعتراض باز تا {jdate(deadline)}</span>
          ) : (
            <span className="text-amber-200">پنجره اعتراض بسته است</span>
          )}
        </span>
      </div>

      <div className="p-3 text-xs text-slate-600 bg-slate-50 border-b border-slate-200">
        نمرات هر نیمسال را به تفکیک مشاهده کنید. اعتراض به نمره تنها در بازهٔ زمانی اعتراض (تعیین‌شده توسط آموزش) و برای
        دروسی که نمره‌شان قطعی شده امکان‌پذیر است. پس از ثبت، کارشناس آموزش آن را بررسی و نتیجه را اعلام می‌کند.
      </div>

      {!windowOpen && (
        <div className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-2xs font-bold text-amber-900">
          🔒 در حال حاضر پنجرهٔ اعتراض به نمره باز نیست (زمان‌بندی اعتراض توسط آموزش تعیین نشده یا به پایان رسیده). دکمه‌های اعتراض تا باز شدن پنجره قفل هستند.
        </div>
      )}

      <div className="p-3 space-y-3">
        {terms.length === 0 && (
          <div className="text-center text-slate-400 py-6">هنوز درسی در کارنامه ثبت نشده است.</div>
        )}
        {terms.map(t => (
          <div key={t.termCode} className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-100 px-3 py-1.5 font-bold text-slate-800 text-[12px] flex items-center justify-between">
              <span>📚 {t.termTitle}{t.isCurrent ? ' · جاری' : ''}</span>
              <span className="font-mono text-slate-500 text-3xs" dir="ltr">{t.termCode}</span>
            </div>
            <table className="w-full text-right text-2xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <th className="p-1.5 text-center w-16">کد درس</th>
                  <th className="p-1.5">نام درس</th>
                  <th className="p-1.5 text-center w-14">نمره</th>
                  <th className="p-1.5 text-center w-32">وضعیت / اعتراض</th>
                </tr>
              </thead>
              <tbody>
                {t.rows.map(r => {
                  const st = localStatus[r.enrollmentId];
                  const badge = st ? statusBadge[st.status] : undefined;
                  return (
                    <tr key={r.enrollmentId} className="border-b border-slate-100 last:border-0">
                      <td className="p-1.5 text-center font-mono text-3xs" dir="ltr">{r.code}</td>
                      <td className="p-1.5 font-semibold text-slate-900">{r.title}</td>
                      <td className="p-1.5 text-center font-black font-mono">
                        {r.grade != null ? r.grade.toFixed(2) : '—'}
                      </td>
                      <td className="p-1.5 text-center">
                        {badge ? (
                          <span className={`inline-block text-3xs font-bold px-2 py-0.5 rounded-full border ${badge.cls}`}>
                            {badge.label}
                          </span>
                        ) : !r.isFinalized ? (
                          <span className="text-3xs text-slate-400">نمره قطعی نشده</span>
                        ) : !windowOpen ? (
                          <span className="text-3xs text-slate-400">🔒 قفل</span>
                        ) : (
                          <button
                            onClick={() => { setOpenId(r.enrollmentId); setDone(null); setError(null); setText(''); }}
                            className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-3xs font-extrabold shadow"
                          >
                            اعتراض
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* مودال ثبت اعتراض */}
      {openRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpenId(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <h4 className="font-extrabold text-slate-900 text-sm">
              اعتراض به نمرهٔ {openRow.title} <span className="font-mono text-2xs text-slate-500" dir="ltr">({openRow.code})</span>
            </h4>
            {openRow.grade != null && (
              <p className="text-xs text-slate-600">نمرهٔ فعلی: <b className="font-mono">{openRow.grade.toFixed(2)}</b></p>
            )}
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={4}
              placeholder="دلیل اعتراض خود را به‌طور دقیق بنویسید (حداقل ۵ کاراکتر)..."
              className="w-full border border-slate-300 rounded-xl p-2 text-xs"
            />
            {error && <p className="text-2xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{error}</p>}
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setOpenId(null)} className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100">انصراف</button>
              <button
                onClick={submit}
                disabled={busy || text.trim().length < 5}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold shadow disabled:opacity-50"
              >
                {busy ? 'در حال ثبت...' : 'ثبت اعتراض'}
              </button>
            </div>
          </div>
        </div>
      )}

      {done != null && (
        <div className="m-3 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-2xs font-bold text-emerald-900">
          ✅ اعتراض شما ثبت شد و در حال بررسی توسط کارشناس آموزش است.
        </div>
      )}
    </div>
  );
}
