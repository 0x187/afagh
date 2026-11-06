'use client';
import { useState, useTransition } from 'react';
import { faNum } from '@/app/admin/curriculum/curriculum-core';
import {
  upsertVirtualClassroomAction,
  deleteVirtualClassroomAction,
  syncVirtualClassStatusAction,
  type ProfOfferingRow,
} from './actions';
import { askConfirm } from '@/lib/ui-feedback';

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString('fa-IR') : '—');

export default function ProfVirtualClassesClient({ rows: initial }: { rows: ProfOfferingRow[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const refresh = () => window.location.reload();

  const save = (offeringId: number) => {
    startTransition(async () => {
      const r = await upsertVirtualClassroomAction(offeringId, editName);
      if (r.ok) { setMsg('✓ کلاس آنلاین ذخیره و در سرور بیگ‌بلوباتن ساخته شد.'); setEditId(null); refresh(); }
      else setMsg(`✗ ${r.error}`);
    });
  };

  const remove = async (id: number) => {
    const ok = await askConfirm({ title: 'حذف کلاس آنلاین', body: 'کلاس آنلاین حذف شود؟ (جلسه در سرور BBB باقی می‌ماند.)', confirmText: 'حذف کن', danger: true });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteVirtualClassroomAction(id);
      if (r.ok) { setMsg('✓ حذف شد.'); refresh(); }
      else setMsg(`✗ ${r.error}`);
    });
  };

  const syncOne = (id: number) => {
    startTransition(async () => {
      const r = await syncVirtualClassStatusAction(id);
      if (r.ok) { setMsg(`✓ وضعیت به‌روز شد (${faNum(r.updated ?? 0)}).`); refresh(); }
      else setMsg(`✗ ${r.error}`);
    });
  };

  return (
    <div className="space-y-3">
      {msg && <div className="card text-xs font-bold text-slate-700">{msg}</div>}
      <div className="card overflow-x-auto">
        <table className="w-full text-xs rt border-collapse">
          <thead>
            <tr className="bg-slate-900 text-white text-center">
              <th className="p-2.5 border border-slate-800">درس / گروه</th>
              <th className="p-2.5 border border-slate-800">دانشجو</th>
              <th className="p-2.5 border border-slate-800">وضعیت کلاس آنلاین</th>
              <th className="p-2.5 border border-slate-800">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="p-6 text-center text-slate-500 font-bold">در این نیم‌سال کلاسی برای شما ثبت نشده است.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.offeringId} className="text-center border-t border-slate-200">
                <td className="p-2.5 text-right font-extrabold text-slate-900">
                  <span className="font-mono text-2xs text-indigo-900 ml-1">{r.courseCode}</span>
                  {r.courseTitle}
                  <span className="text-3xs text-slate-500 mr-1">
                    {r.mergedGroupNumbers ? `— کلاس ادغامی (گروه‌های ${r.mergedGroupNumbers.map(faNum).join('، ')})` : `— گروه ${faNum(r.groupNumber)}`}
                  </span>
                </td>
                <td className="p-2.5 font-bold">{faNum(r.enrolledCount)}</td>
                <td className="p-2.5">
                  {r.classroom ? (
                    <div className="space-y-0.5">
                      <div className="font-bold text-slate-800">{r.classroom.name}</div>
                      <div className="text-3xs text-slate-500">
                        {r.classroom.isRunning ? <span className="text-rose-600 font-black animate-pulse">● در حال برگزاری ({faNum(r.classroom.participantCount)} نفر)</span> : 'برگزار نشده'}
                        {r.classroom.recordingsCount > 0 && <span className="mr-1">· {faNum(r.classroom.recordingsCount)} ضبط</span>}
                      </div>
                      <div className="text-3xs text-slate-400">
                        آخرین همگام‌سازی: {fmtDate(r.classroom.lastSyncedAt)}
                      </div>
                    </div>
                  ) : (
                    <span className="text-slate-400 font-bold">تعریف نشده</span>
                  )}
                </td>
                <td className="p-2.5">
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {editId === r.offeringId ? (
                      <>
                        <input
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          placeholder={r.courseCode + ' — ' + r.courseTitle}
                          className="border border-slate-300 rounded-lg px-2 py-1 text-2xs font-bold w-44"
                        />
                        <button disabled={pending} onClick={() => save(r.offeringId)} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-extrabold text-2xs disabled:opacity-50">
                          {pending ? '…' : '💾 ذخیره'}
                        </button>
                        <button disabled={pending} onClick={() => setEditId(null)} className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-bold text-2xs">✕</button>
                      </>
                    ) : (
                      <>
                        <button
                          disabled={pending}
                          onClick={() => { setEditId(r.offeringId); setEditName(r.classroom?.name ?? `${r.courseCode} — ${r.courseTitle}`); }}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-extrabold text-2xs disabled:opacity-50"
                        >
                          {r.classroom ? '✏️ ویرایش' : '➕ تعریف کلاس آنلاین'}
                        </button>
                        {r.classroom && (
                          <>
                            <button disabled={pending} onClick={() => syncOne(r.classroom!.id)} className="px-2.5 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-extrabold text-2xs disabled:opacity-50" title="خواندن وضعیت از سرور BBB">
                              🔄 همگام‌سازی
                            </button>
                            <button disabled={pending} onClick={() => remove(r.classroom!.id)} className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white font-extrabold text-2xs disabled:opacity-50">
                              🗑 حذف
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-2xs text-slate-500 leading-6">
        رمزهای Moderator/Attendee از «پنل مدیر ← پیکربندی سامانه ← کلاس مجازی» خوانده می‌شوند. بعد از تعریف، دانشجویان
        کلاس را در داشبورد خود (ویجت کلاس‌های آنلاین) می‌بینند و با یک کلیک وارد می‌شوند؛ استاد با «شروع جلسه»
        اتاق فرمان را باز می‌کند.
      </p>
    </div>
  );
}