'use client';

import { useEffect, useState } from 'react';
import {
  listMyClassMessages,
  previewMyClass,
  sendMyClassMessage,
  type ClassMsgReport,
  type MyClass,
  type MyMsgRecord,
} from './actions';
import type { Channel } from '@/lib/messaging';

const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'INAPP', label: '📥 داخل پورتال' },
  { key: 'SOROUSH', label: '🟣 سروش' },
  { key: 'BALE', label: '🟢 بله' },
  { key: 'EITAA', label: '🟠 ایتا' },
];

const CH_FA: Record<string, string> = { SOROUSH: 'سروش', BALE: 'بله', EITAA: 'ایتا', SMS: 'پیامک' };

export default function ProfBroadcastClient({ classes }: { classes: MyClass[] }) {
  const [offeringId, setOfferingId] = useState(classes[0] ? String(classes[0].offeringId) : '');
  const [channels, setChannels] = useState<Channel[]>(['INAPP']);
  const [text, setText] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ClassMsgReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<MyMsgRecord[]>([]);

  const selCls = classes.find(c => String(c.offeringId) === offeringId);

  useEffect(() => {
    listMyClassMessages().then(setHistory).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preview = async () => {
    if (!offeringId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await previewMyClass(Number(offeringId));
      if (r.ok) setCount(r.count);
      else setError(r.error);
    } catch {
      setError('خطا در ارتباط با سرور.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!text.trim()) {
      setError('اول متن پیام را بنویسید.');
      return;
    }
    if (!window.confirm(`به دانشجویان این کلاس (${selCls?.label ?? ''}) ارسال شود؟`)) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const r = await sendMyClassMessage(Number(offeringId), channels, text.trim());
      if (r.ok) {
        setReport(r.report);
        listMyClassMessages().then(setHistory).catch(() => {});
      } else {
        setError(r.error);
      }
    } catch {
      setError('خطا در ارتباط با سرور.');
    } finally {
      setBusy(false);
    }
  };

  if (!classes.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-xs text-slate-500" dir="rtl">
        در ترم‌های اخیر کلاسی به نام شما ثبت نشده است.
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <label className="block text-xs font-bold text-slate-700">🏫 کلاس من
          <select
            value={offeringId}
            onChange={e => { setOfferingId(e.target.value); setCount(null); setReport(null); }}
            className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white"
          >
            {classes.map(c => (
              <option key={c.offeringId} value={c.offeringId}>
                {c.label} — {c.termTitle} ({c.enrolled.toLocaleString('fa-IR')} نفر)
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map(c => (
            <button
              key={c.key}
              onClick={() => setChannels(prev => (prev.includes(c.key) ? prev.filter(x => x !== c.key) : [...prev, c.key]))}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition border ${
                channels.includes(c.key) ? 'bg-indigo-700 text-white border-indigo-700' : 'bg-white text-slate-600 border-slate-300'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="مثلاً: کلاس فردا ساعت ۱۰ به‌صورت مجازی برگزار می‌شود…"
          className="w-full border border-slate-300 rounded-2xl p-3 text-sm leading-7 focus:border-indigo-600"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={preview} disabled={busy} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-black text-white hover:bg-slate-900 disabled:opacity-60">
            {busy ? '…' : '🔍 شمارش'}
          </button>
          {count !== null && <span className="text-xs font-black text-indigo-800">{count.toLocaleString('fa-IR')} دانشجوی فعال</span>}
          <button onClick={send} disabled={busy || !offeringId} className="mr-auto rounded-xl bg-indigo-700 px-6 py-2.5 text-sm font-black text-white hover:bg-indigo-800 disabled:opacity-60">
            {busy ? 'در حال ارسال…' : '🚀 ارسال به کلاس'}
          </button>
        </div>
      </div>

      {report && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50/70 p-4 text-xs leading-7">
          <p className="font-black text-emerald-900">✅ ارسال شد — {report.total.toLocaleString('fa-IR')} نفر:</p>
          <ul className="mt-1 list-disc pr-5 text-emerald-900">
            <li>📥 صندوق داخل پورتال: <strong>{report.inbox.toLocaleString('fa-IR')} نفر</strong></li>
            {report.sent.map(s => (
              <li key={s.channel}>🟣 {CH_FA[s.channel] ?? s.channel}: <strong>{s.n.toLocaleString('fa-IR')} ارسال شد</strong></li>
            ))}
            {report.noAddress.map(s => (
              <li key={s.channel}>{CH_FA[s.channel] ?? s.channel}: {s.n.toLocaleString('fa-IR')} نفر عضو نیستند</li>
            ))}
            {report.failedRequests > 0 && <li className="text-red-700">{report.failedRequests.toLocaleString('fa-IR')} خطا</li>}
          </ul>
        </div>
      )}
      {error && <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-xs font-black text-red-800">{error}</div>}

      {history.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
          <h3 className="text-sm font-black text-slate-900">🗂️ پیام‌های قبلی من به کلاس‌ها</h3>
          {history.map(h => (
            <div key={h.eventCode} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs leading-6">
              <p className="font-bold text-slate-800">{h.body || '—'}</p>
              <p className="text-2xs text-slate-500">
                🕐 {h.sentAt ? new Date(h.sentAt).toLocaleString('fa-IR') : '—'} · 👥 {h.total.toLocaleString('fa-IR')} نفر
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
