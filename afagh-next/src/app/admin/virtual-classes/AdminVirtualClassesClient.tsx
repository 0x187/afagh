'use client';
import { useState, useTransition } from 'react';
import { faNum } from '@/app/admin/curriculum/curriculum-core';
import { listVirtualClassroomsAdminAction, syncVirtualClassStatusAction, syncBbbRecordingsAction } from './actions';
import type { AdminVirtualRow } from '@/app/professor/virtual-classes/actions';

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString('fa-IR') : '—');

function statusLabel(r: AdminVirtualRow) {
  if (r.isRunning) return { text: '● در حال برگزاری', cls: 'bg-rose-100 text-rose-800 border-rose-300' };
  if (r.lastRunningAt) return { text: '✓ برگزار شده', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
  return { text: '○ آینده / برگزار نشده', cls: 'bg-slate-100 text-slate-700 border-slate-300' };
}

export default function AdminVirtualClassesClient({ terms, initialRows, initialError }: {
  terms: { id: number; title: string; termCode: string }[];
  initialRows: AdminVirtualRow[];
  initialError: string | null;
}) {
  const [rows, setRows] = useState(initialRows);
  const [termId, setTermId] = useState<number | ''>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'RUNNING' | 'DONE' | 'FUTURE'>('ALL');
  const [msg, setMsg] = useState<string | null>(initialError);
  const [pending, startTransition] = useTransition();

  const reload = (tid: number | '') => {
    startTransition(async () => {
      const r = await listVirtualClassroomsAdminAction(tid === '' ? undefined : tid);
      if (r.ok) { setRows(r.rows); setMsg(null); }
      else setMsg(r.error);
    });
  };

  const syncAll = () => {
    startTransition(async () => {
      const r = await syncVirtualClassStatusAction(null);
      if (r.ok) { setMsg(`✓ ${faNum(r.updated ?? 0)} کلاس همگام شد.`); reload(termId); }
      else setMsg(`✗ ${r.error}`);
    });
  };

  const syncRecordings = () => {
    startTransition(async () => {
      const r = await syncBbbRecordingsAction(null);
      if (r.ok) { setMsg(`✓ ${faNum(r.added ?? 0)} ضبط تازه از ${faNum(r.classrooms ?? 0)} کلاس ثبت شد.`); reload(termId); }
      else setMsg(`✗ ${r.error}`);
    });
  };

  const filtered = rows.filter(r => {
    if (statusFilter === 'RUNNING') return r.isRunning;
    if (statusFilter === 'DONE') return !r.isRunning && !!r.lastRunningAt;
    if (statusFilter === 'FUTURE') return !r.isRunning && !r.lastRunningAt;
    return true;
  });

  return (
    <div className="space-y-3">
      {msg && <div className="card text-xs font-bold text-slate-700">{msg}</div>}

      <div className="card flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-2xs font-bold text-slate-600">نیم‌سال:</label>
          <select
            value={String(termId)}
            onChange={e => { const v = e.target.value === '' ? '' : Number(e.target.value); setTermId(v); reload(v); }}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold bg-white"
          >
            <option value="">همهٔ نیم‌سال‌ها</option>
            {terms.map(t => <option key={t.id} value={t.id}>{t.title} ({t.termCode})</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-2xs font-bold text-slate-600">وضعیت:</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold bg-white">
            <option value="ALL">همه</option>
            <option value="RUNNING">در حال برگزاری</option>
            <option value="DONE">برگزار شده</option>
            <option value="FUTURE">برگزار نشده</option>
          </select>
        </div>
        <button disabled={pending} onClick={syncAll} className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-extrabold text-2xs disabled:opacity-50">
          {pending ? '…' : '🔄 همگام‌سازی وضعیت از BBB'}
        </button>
        <button disabled={pending} onClick={syncRecordings} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-extrabold text-2xs disabled:opacity-50">
          🎬 همگام‌سازی ضبط‌ها
        </button>
        <span className="text-2xs text-slate-500 mr-auto">{faNum(filtered.length)} کلاس</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-xs rt border-collapse">
          <thead>
            <tr className="bg-slate-900 text-white text-center">
              <th className="p-2.5 border border-slate-800">درس</th>
              <th className="p-2.5 border border-slate-800">استاد</th>
              <th className="p-2.5 border border-slate-800">نیم‌سال</th>
              <th className="p-2.5 border border-slate-800">گروه</th>
              <th className="p-2.5 border border-slate-800">دانشجو</th>
              <th className="p-2.5 border border-slate-800">وضعیت</th>
              <th className="p-2.5 border border-slate-800">حاضرین</th>
              <th className="p-2.5 border border-slate-800">ضبط</th>
              <th className="p-2.5 border border-slate-800">آخرین همگام‌سازی</th>
              <th className="p-2.5 border border-slate-800">آخرین برگزاری</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="p-6 text-center text-slate-500 font-bold">کلاس آنلاینی با این فیلتر یافت نشد.</td></tr>
            )}
            {filtered.map(r => {
              const st = statusLabel(r);
              return (
                <tr key={r.id} className="text-center border-t border-slate-200">
                  <td className="p-2.5 text-right font-extrabold text-slate-900">
                    <span className="font-mono text-2xs text-indigo-900 ml-1">{r.courseCode}</span>
                    {r.courseTitle}
                  </td>
                  <td className="p-2.5 font-bold">{r.professorName || '—'}</td>
                  <td className="p-2.5">{r.termTitle || '—'}</td>
                  <td className="p-2.5">{faNum(r.groupNumber)}</td>
                  <td className="p-2.5">{faNum(r.enrolledCount)}</td>
                  <td className="p-2.5"><span className={`px-2 py-0.5 rounded-full text-3xs font-black border ${st.cls}`}>{st.text}</span></td>
                  <td className="p-2.5">{faNum(r.participantCount)}</td>
                  <td className="p-2.5">{faNum(r.recordingsCount)}</td>
                  <td className="p-2.5 text-3xs text-slate-500">{fmtDate(r.lastSyncedAt)}</td>
                  <td className="p-2.5 text-3xs text-slate-500">{fmtDate(r.lastRunningAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}