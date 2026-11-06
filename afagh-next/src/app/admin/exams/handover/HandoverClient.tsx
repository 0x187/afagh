'use client';

import { useState, useTransition } from 'react';
import VerifyQrBlock from '@/components/VerifyQrBlock';
import { examFinalizeHandoverAction } from '@/lib/exam-actions';

export interface ChainSession {
  sessionId: number;
  examDate: string;
  time: string;
  hallId: number | null;
  hallName: string;
  present: number;
  total: number;
  minutesSigned: number;
  vaultReceived: number;
  packets: number;
}

export interface DeliveryRow {
  deliveryId: number;
  offeringId: number;
  status: string;
  sheetCount: number;
  returnedToArchive: boolean;
  returnedAt: string | null;
  courseCode: string | null;
  courseTitle: string | null;
  professorName: string;
}

const faNum = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

type Qr = { url: string; qr: string; expiresAt: string | null; label: string };

/** زنجیرهٔ تحویل اوراق — ساخت QR تحویل برای هر مرحله + نهایی‌سازی مخزن */
export default function HandoverClient({
  terms, termId, termTitle, sessions, deliveries,
}: {
  terms: { id: number; title: string; termCode: string; isActive: boolean }[];
  termId: number;
  termTitle: string;
  sessions: ChainSession[];
  deliveries: DeliveryRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);

  const makeQr = async (label: string, params: string) => {
    setQr(null);
    try {
      const r = await fetch(`/api/admin/exams/handover-qr?${params}`);
      const d = r.ok ? await r.json() : null;
      if (d?.qr) setQr({ url: d.url, qr: d.qr, expiresAt: d.expiresAt, label });
      else setMsg({ ok: false, text: 'ساخت QR تحویل ممکن نشد.' });
    } catch {
      setMsg({ ok: false, text: 'خطا در ارتباط با سرور.' });
    }
  };

  const finalize = (s: ChainSession) => {
    startTransition(async () => {
      const res = await examFinalizeHandoverAction({ sessionId: s.sessionId });
      if (typeof res === 'object' && res !== null && 'ok' in res && res.ok) {
        setMsg({ ok: true, text: `نهایی‌سازی جلسهٔ ${faNum(s.sessionId)} انجام شد (بسته‌های اوراق ساخته شد).` });
      } else {
        setMsg({ ok: false, text: (typeof res === 'object' && res !== null && 'error' in res ? String((res as { error?: string }).error) : '') || 'نهایی‌سازی ممکن نشد.' });
      }
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="overflow-hidden rounded-2xl border border-slate-800/20 bg-gradient-to-l from-slate-900 via-slate-800 to-indigo-900 p-4 text-white shadow-lg">
        <h1 className="text-lg font-black">🧾 زنجیرهٔ تحویل اوراق امتحان</h1>
        <p className="mt-1 text-xs text-slate-200/90">
          مراقب → مخزن (QR) · نهایی‌سازی مخزن · مخزن → استاد (QR) · استاد → بایگانی (QR، شرط پرداخت حق‌الزحمهٔ تصحیح).
          هر QR کوتاه‌مدت است و تحویل‌گیرنده با هویت خودش آن را تأیید می‌کند.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-300 bg-white p-3">
        <label className="text-2xs font-bold text-slate-700">
          نیمسال
          <select
            value={termId}
            onChange={e => { window.location.href = `/admin/exams/handover?term=${e.target.value}`; }}
            className="mt-1 block min-w-[220px] rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          >
            {terms.map(t => <option key={t.id} value={t.id}>{t.title} ({t.termCode}){t.isActive ? ' — فعال' : ''}</option>)}
          </select>
        </label>
        <span className="mr-auto text-2xs text-slate-500">{faNum(sessions.length)} جلسه · {faNum(deliveries.length)} تحویل — {termTitle}</span>
      </div>

      {msg && (
        <div className={`rounded-lg border px-3 py-2 text-xs font-bold ${msg.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-rose-300 bg-rose-50 text-rose-800'}`}>
          {msg.text}
        </div>
      )}

      {qr && (
        <VerifyQrBlock
          title={qr.label}
          url={qr.url}
          qr={qr.qr}
          expiresAt={qr.expiresAt}
          hint="تحویل‌گیرنده این کد را اسکن می‌کند و در صفحهٔ تحویل، دریافت را با هویت خودش تأیید می‌کند."
        />
      )}

      <section className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
        <h2 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-800">جلسه‌های امتحان</h2>
        <table className="w-full text-xs rt">
          <thead>
            <tr className="bg-slate-900 text-center text-2xs text-white">
              <th className="p-2.5">جلسه</th>
              <th className="p-2.5">تاریخ / ساعت</th>
              <th className="p-2.5">سالن</th>
              <th className="p-2.5">حضور</th>
              <th className="p-2.5">صورتجلسه</th>
              <th className="p-2.5">دریافت مخزن</th>
              <th className="p-2.5">بسته‌ها</th>
              <th className="p-2.5">اقدام</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.sessionId} className="border-b border-slate-100">
                <td className="p-2.5 text-center font-mono font-black text-slate-700">{faNum(s.sessionId)}</td>
                <td className="p-2.5 text-center text-slate-600">
                  <span className="block font-mono">{faNum(s.examDate)}</span>
                  <span className="block text-3xs text-slate-400" dir="ltr">{s.time}</span>
                </td>
                <td className="p-2.5 text-center font-bold text-slate-700">{s.hallName}</td>
                <td className="p-2.5 text-center font-mono">{faNum(s.present)}/{faNum(s.total)}</td>
                <td className="p-2.5 text-center">{s.minutesSigned ? '✓' : '—'}</td>
                <td className="p-2.5 text-center">{s.vaultReceived ? '✓' : '—'}</td>
                <td className="p-2.5 text-center font-mono">{faNum(s.packets)}</td>
                <td className="p-2.5 text-center">
                  <button
                    type="button"
                    disabled={pending || !s.hallId}
                    onClick={() => void makeQr(`تحویل اوراق سالن ${s.hallName} به مخزن`, `step=VAULT&sessionId=${s.sessionId}&hallId=${s.hallId ?? 0}`)}
                    className="rounded-lg bg-indigo-700 px-2 py-1 text-3xs font-black text-white hover:bg-indigo-800 disabled:opacity-40"
                  >
                    QR تحویل به مخزن
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void makeQr(`نهایی‌سازی تحویل جلسه ${s.sessionId}`, `step=FINALIZE&sessionId=${s.sessionId}`)}
                    className="mr-1 rounded-lg border border-slate-300 px-2 py-1 text-3xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  >
                    QR نهایی‌سازی
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => finalize(s)}
                    className="mr-1 rounded-lg bg-slate-800 px-2 py-1 text-3xs font-black text-white hover:bg-slate-900 disabled:opacity-40"
                  >
                    نهایی‌سازی
                  </button>
                </td>
              </tr>
            ))}
            {sessions.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-500">جلسه‌ای برای این نیمسال ثبت نشده است.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
        <h2 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-800">تحویل اوراق به استاد و بازگشت به بایگانی</h2>
        <table className="w-full text-xs rt">
          <thead>
            <tr className="bg-slate-900 text-center text-2xs text-white">
              <th className="p-2.5">درس</th>
              <th className="p-2.5">استاد</th>
              <th className="p-2.5">وضعیت تحویل</th>
              <th className="p-2.5">اوراق</th>
              <th className="p-2.5">بایگانی</th>
              <th className="p-2.5">اقدام</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map(d => (
              <tr key={d.deliveryId} className="border-b border-slate-100">
                <td className="p-2.5">
                  <span className="font-black text-indigo-950">{d.courseCode}</span>
                  <span className="block text-3xs text-slate-500">{d.courseTitle}</span>
                </td>
                <td className="p-2.5 font-bold text-slate-800">{d.professorName}</td>
                <td className="p-2.5 text-center">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-3xs font-black text-slate-700">{d.status}</span>
                </td>
                <td className="p-2.5 text-center font-mono">{faNum(d.sheetCount)}</td>
                <td className="p-2.5 text-center">
                  {d.returnedToArchive
                    ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-3xs font-black text-emerald-800">✓ تحویل بایگانی</span>
                    : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-3xs font-black text-amber-800">در انتظار (شرط پرداخت)</span>}
                </td>
                <td className="p-2.5 text-center">
                  {!d.returnedToArchive && (
                    <button
                      type="button"
                      onClick={() => void makeQr(`بازگشت اوراق ${d.courseCode} به بایگانی`, `step=ARCHIVE&offeringId=${d.offeringId}`)}
                      className="rounded-lg bg-emerald-700 px-2 py-1 text-3xs font-black text-white hover:bg-emerald-800"
                    >
                      QR تحویل به بایگانی
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void makeQr(`تحویل اوراق ${d.courseCode} به استاد`, `step=INSTRUCTOR&offeringId=${d.offeringId}`)}
                    className="mr-1 rounded-lg border border-indigo-300 bg-indigo-50 px-2 py-1 text-3xs font-black text-indigo-800 hover:bg-indigo-100"
                  >
                    QR تحویل به استاد
                  </button>
                </td>
              </tr>
            ))}
            {deliveries.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">هنوز تحویلی برای این نیمسال ثبت نشده است (ابتدا جلسه را نهایی کنید).</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
