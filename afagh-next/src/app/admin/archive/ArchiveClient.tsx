'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { notify } from '@/lib/ui-feedback';

type Row = {
  id: number; fileName: string; status: string; reason: string | null; uploadedAt: string | null;
  student: string; nationalCode: string; category: string; type: string;
};

export default function ArchiveClient(props: {
  rows: Row[];
  stFa: Record<string, string>;
  stColor: Record<string, string>;
  cats: { id: number; title: string }[];
  types: { id: number; title: string; categoryId: number }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState('ALL');
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = props.rows.filter(r => filter === 'ALL' || r.status === filter);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = fileRef.current?.files?.[0];
    const fd = new FormData(e.currentTarget);
    if (!f) { setMsg('فایلی انتخاب نشده.'); return; }
    setBusy(true); setMsg('');
    const r = await fetch('/api/admin/archive/upload', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? 'بارگذاری شد ✓ (' + (j.size ?? 0) + ' بایت در ' + j.key + ')' : 'خطا: ' + (j.error ?? r.status));
    if (r.ok) { e.currentTarget.reset(); router.refresh(); }
  }

  async function verify(docId: number, decision: 'VERIFIED' | 'REJECTED') {
    const reason = decision === 'REJECTED' ? prompt('دلیل رد مدرک:') ?? '' : undefined;
    setBusy(true);
    const r = await fetch('/api/admin/archive/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId, decision, reason }),
    });
    setBusy(false);
    if (r.ok) router.refresh(); else notify('خطا: ' + r.status, 'error');
  }

  return (
    <div className="space-y-4">
      <form onSubmit={upload} className="card grid gap-3 md:grid-cols-5">
        <input name="studentUserId" className="input" type="number" placeholder="userId دانشجو/متقاضی" required />
        <select name="categoryId" className="input" required>
          <option value="">دسته…</option>
          {props.cats.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <select name="typeId" className="input">
          <option value="">نوع (اختیاری)</option>
          {props.types.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <input ref={fileRef} name="file" type="file" className="input" required />
        <button className="btn-primary" disabled={busy}>بارگذاری به MinIO</button>
        {msg && <p className="md:col-span-5 text-xs text-slate-600">{msg}</p>}
      </form>

      <div className="flex gap-2 text-xs">
        {['ALL', 'PENDING', 'VERIFIED', 'REJECTED'].map(f => (
          <button key={f} onClick={() => setFilter(f)} className={'rounded-full px-3 py-1 ' + (filter === f ? 'bg-indigo-900 text-white' : 'bg-slate-200 text-slate-700')}>
            {f === 'ALL' ? 'همه' : props.stFa[f]}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-right text-sm rt">
          <thead><tr className="text-xs text-slate-500">
            <th className="p-2">#</th><th className="p-2">شخص</th><th className="p-2">دسته/نوع</th>
            <th className="p-2">فایل</th><th className="p-2">زمان</th><th className="p-2">وضعیت</th><th className="p-2">اقدام</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-400">مدرکی نیست.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-2 font-mono text-xs">{r.id}</td>
                <td className="p-2">{r.student}<span className="block font-mono text-3xs text-slate-400" dir="ltr">{r.nationalCode}</span></td>
                <td className="p-2 text-xs">{r.category} / {r.type}</td>
                <td className="p-2 text-xs">
                  <a className="text-indigo-700 underline" href={'/api/archive/' + r.id} target="_blank" rel="noreferrer">{r.fileName}</a>
                </td>
                <td className="p-2 text-xs text-slate-500">{r.uploadedAt ? new Date(r.uploadedAt).toLocaleString('fa-IR') : '—'}</td>
                <td className="p-2">
                  <span className={'badge ' + (props.stColor[r.status] ?? '')}>{props.stFa[r.status] ?? r.status}</span>
                  {r.status === 'REJECTED' && r.reason && <span className="block text-3xs text-red-600">{r.reason}</span>}
                </td>
                <td className="p-2">
                  <div className="flex gap-1 text-2xs">
                    <button className="rounded-lg bg-emerald-100 px-2 py-1 text-emerald-800" disabled={busy} onClick={() => verify(r.id, 'VERIFIED')}>تایید</button>
                    <button className="rounded-lg bg-red-100 px-2 py-1 text-red-700" disabled={busy} onClick={() => verify(r.id, 'REJECTED')}>رد</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
