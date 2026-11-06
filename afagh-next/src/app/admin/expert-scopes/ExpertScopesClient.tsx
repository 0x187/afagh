'use client';

import { useState } from 'react';
import { saveExpertScopes, type ScopeSelect } from './actions';

export default function ExpertScopesClient({ select, initialCandidates }: {
  select: ScopeSelect; initialCandidates: { userId: number; name: string; canEditGrades: boolean; scopes: { type: string; id: number | null; uni: number | null }[] }[];
}) {
  const [cands, setCands] = useState(initialCandidates);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [scopes, setScopes] = useState<{ type: string; id: number | null; uni: number | null }[]>([]);
  const [gradeFlag, setGradeFlag] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openEdit = (userId: number) => {
    const c = cands.find(x => x.userId === userId);
    setEditingId(userId);
    setScopes(c ? c.scopes.map(s => ({ ...s })) : []);
    setGradeFlag(c?.canEditGrades ?? false);
    setMsg(null);
  };
  const addScope = (type: string, id: number | null, uni: number | null) => {
    if (scopes.some(s => s.type === type && s.id === id)) return;
    setScopes(p => [...p, { type, id, uni }]);
  };
  const removeScope = (i: number) => setScopes(p => p.filter((_, x) => x !== i));

  const save = async () => {
    if (editingId == null) return;
    setBusy(true); setMsg(null);
    const r = await saveExpertScopes(editingId, scopes, gradeFlag).catch(() => ({ ok: false as const, error: 'خطا' }));
    setMsg(r.ok ? '✅ ذخیره شد.' : `⛔ ${r.error ?? ''}`);
    setBusy(false);
  };

  const sel = 'border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white';

  return (
    <div className="space-y-4" dir="rtl">
      <div className="card">
        <h1 className="font-black">🔐 دامنهٔ دسترسی کارشناسان آموزش</h1>
        <p className="text-xs text-slate-500 mt-1">برای هر کارشناس (EDU_EXPERT): دانشگاه/دانشکده/گروه/رشتهٔ مجاز. خالی = کل دانشگاه.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        {cands.map(c => (
          <div key={c.userId} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <span className="font-black text-slate-800">{c.name}</span>
            <span className="text-3xs text-slate-500">
              {c.scopes.length ? c.scopes.map(s => `${s.type === 'UNIVERSITY' ? 'دانشگاه' : s.type === 'FACULTY' ? 'دانشکده' : s.type === 'DEPARTMENT' ? 'گروه' : 'رشته'}(${s.id})`).join(' · ') : 'کل دانشگاه'}
            </span>
            <button onClick={() => openEdit(c.userId)} className="mr-auto rounded-lg bg-indigo-700 px-3 py-1 text-white font-black text-xs">
              {editingId === c.userId ? 'ویرایش…' : 'ویرایش'}
            </button>
          </div>
        ))}
        {!cands.length && <p className="text-xs text-slate-400">کارشناسی یافت نشد.</p>}
      </div>

      {editingId != null && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
          <h3 className="text-sm font-black text-indigo-900">ویرایش دامنهٔ {cands.find(x => x.userId === editingId)?.name}</h3>

          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-xs font-bold text-slate-600">دانشگاه
              <select className={sel + ' w-full mt-1'} value="" onChange={e => addScope('UNIVERSITY', Number(e.target.value), null)}>
                <option value="">+ افزودن دانشگاه…</option>
                {select.universities.map(x => <option key={x.id} value={x.id}>{x.title} ({x.code})</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">دانشکده
              <select className={sel + ' w-full mt-1'} value="" onChange={e => addScope('FACULTY', Number(e.target.value), null)}>
                <option value="">+ افزودن دانشکده…</option>
                {select.faculties.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-xs font-bold text-slate-600">گروه
              <select className={sel + ' w-full mt-1'} value="" onChange={e => addScope('DEPARTMENT', Number(e.target.value), null)}>
                <option value="">+ افزودن گروه…</option>
                {select.departments.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">رشته
              <select className={sel + ' w-full mt-1'} value="" onChange={e => addScope('MAJOR', Number(e.target.value), null)}>
                <option value="">+ افزودن رشته…</option>
                {select.majors.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {scopes.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-white border border-indigo-300 px-2 py-1 text-2xs font-bold">
                {s.type === 'UNIVERSITY' ? '🏛️ دانشگاه' : s.type === 'FACULTY' ? '🎓 دانشکده' : s.type === 'DEPARTMENT' ? '🏫 گروه' : '📚 رشته'}: {s.id}
                <button onClick={() => removeScope(i)} className="text-red-600 font-black">✕</button>
              </span>
            ))}
            {!scopes.length && <span className="text-2xs text-slate-400 font-bold">(بدون محدودیت → کل دانشگاه)</span>}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
              <input type="checkbox" checked={gradeFlag} onChange={e => setGradeFlag(e.target.checked)} className="w-4 h-4" />
              دسترسی «ویرایش نمره» برای این کارشناس (فقط کارشناسِ خاص)
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy} className="rounded-xl bg-emerald-700 px-5 py-2 text-white font-black text-xs disabled:opacity-50">ذخیره</button>
            <button onClick={() => setEditingId(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold">بستن</button>
            {msg && <span className="text-xs font-black">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}