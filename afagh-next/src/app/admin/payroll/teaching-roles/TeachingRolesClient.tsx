'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { askConfirm } from '@/lib/ui-feedback';

type RoleDef = {
  id: number; code: string; title: string;
  description: string | null; isActive: number;
};

type Row = {
  staffId: number; staffName: string; offeringId: number;
  courseCode: string; courseTitle: string; groupNumber: number | null;
  role: string; roleFa: string; merged: boolean; memberCount: number;
  ruleId: number | null; ruleTitle: string | null; expression: string | null;
  missDim: string | null; missReason: string | null;
};

type TermsRes = { terms?: { id: number; title: string; isCurrent?: number }[] };

async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `خطا ${r.status}`);
  return data;
}

export default function TeachingRolesClient() {
  const [defs, setDefs] = useState<RoleDef[]>([]);
  const [terms, setTerms] = useState<{ id: number; title: string; isCurrent?: number }[]>([]);
  const [termId, setTermId] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [onlyNoFormula, setOnlyNoFormula] = useState(false);

  // فرم نقش جدید
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // override نقش دستی برای هر ارائه
  const [ovr, setOvr] = useState<Record<number, string>>({});

  const loadDefs = useCallback(async () => {
    try {
      const d = await api('/api/admin/payroll/role-defs');
      setDefs(d.roleDefs ?? []);
    } catch (e) { setErr((e as Error).message); }
  }, []);

  const loadCoverage = useCallback(async (tid: number) => {
    try {
      const d = await api(`/api/admin/payroll/rule-coverage?termId=${tid}`);
      setRows(d.rows ?? []);
      const m: Record<number, string> = {};
      for (const r of (d.rows ?? []) as (Row & { overrideCode?: string | null })[]) {
        if (r.overrideCode) m[r.offeringId] = r.overrideCode;
      }
      setOvr(m);
    } catch (e) { setErr((e as Error).message); }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadDefs();
      try {
        const t = await api('/api/admin/enrollment-approvals?action=terms') as TermsRes;
        const list = t.terms ?? [];
        setTerms(list);
        const cur = list.find(x => x.isCurrent === 1) ?? list[0];
        if (cur) { setTermId(cur.id); await loadCoverage(cur.id); }
      } catch (e) { setErr((e as Error).message); }
      setLoading(false);
    })();
  }, [loadDefs, loadCoverage]);

  const createDef = async () => {
    if (!code.trim() || !title.trim()) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api('/api/admin/payroll/role-defs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, title, description: description || null }),
      });
      setCode(''); setTitle(''); setDescription('');
      setMsg('نقش تدریس اضافه شد.');
      await loadDefs();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const toggleDef = async (d: RoleDef) => {
    setBusy(true); setErr(null);
    try {
      await api(`/api/admin/payroll/role-defs/${d.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: d.isActive === 1 ? 0 : 1 }),
      });
      await loadDefs();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const deleteDef = async (d: RoleDef) => {
    const ok = await askConfirm({ title: 'حذف نقش', body: `نقش «${d.title}» حذف شود؟`, confirmText: 'حذف کن', danger: true });
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      await api(`/api/admin/payroll/role-defs/${d.id}`, { method: 'DELETE' });
      setMsg('نقش حذف شد.');
      await loadDefs();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const saveOverride = async (offeringId: number, staffId: number, value: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await api(`/api/admin/payroll/offering-extras?offeringId=${offeringId}&staffId=${staffId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payRoleOverride: value || null }),
      });
      setOvr(m => ({ ...m, [offeringId]: value }));
      setMsg(value ? 'نقش دستی ثبت شد.' : 'نقش دستی برداشته شد (بازگشت به تشخیص خودکار).');
      if (res?.ok === false) throw new Error(res.error);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const shown = useMemo(() => {
    let list = rows;
    if (onlyNoFormula) list = list.filter(r => r.ruleId == null);
    const n = q.trim();
    if (n) list = list.filter(r => r.courseTitle.includes(n) || r.courseCode.includes(n) || r.staffName.includes(n));
    return list;
  }, [rows, onlyNoFormula, q]);

  if (loading) {
    return <div className="card p-8 text-center"><div className="animate-spin rounded-full h-8 w-8 border-4 border-indigo-500 border-t-transparent mx-auto"></div><p className="mt-2 text-slate-500">در حال بارگذاری…</p></div>;
  }

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-black text-slate-900 dark:text-slate-100">نقش تدریس در درس‌ها</h1>
        <div className="flex items-center gap-2">
          <select value={termId ?? ''} onChange={e => { const v = Number(e.target.value); setTermId(v); if (v) loadCoverage(v); }} className="border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded px-2 py-1.5 text-xs">
            {terms.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <button onClick={() => termId && loadCoverage(termId)} disabled={busy} className="border border-slate-300 dark:border-slate-600 rounded px-3 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-700">↻ تازه‌سازی</button>
        </div>
      </div>

      {err && <div className="border border-rose-300 bg-rose-50 dark:bg-rose-950 dark:border-rose-800 text-rose-800 dark:text-rose-200 rounded-xl p-3 text-xs">{err}</div>}
      {msg && <div className="border border-emerald-300 bg-emerald-50 dark:bg-emerald-950 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-xl p-3 text-xs">{msg}</div>}

      {/* کاتالوگ نقش‌ها */}
      <section className="card space-y-4">
        <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-700 pb-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-950 flex items-center justify-center text-xl">🎭</div>
          <div>
            <h2 className="font-black text-slate-900 dark:text-slate-100 text-base">کاتالوگ نقش‌های تدریس</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">نقش‌هایی که مدیر تعریف می‌کند (مثل کمک‌استاد، استاد خودخوان) و در قوانین فرمول و محاسبه به کار می‌روند.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="کد لاتین (مثل ASSISTANT)" dir="ltr" className="border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded px-2 py-1.5 text-xs font-mono" />
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="عنوان فارسی (مثل کمک‌استاد)" className="border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded px-2 py-1.5 text-xs" />
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="توضیح (اختیاری)" className="border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded px-2 py-1.5 text-xs" />
          <button onClick={createDef} disabled={busy || !code.trim() || !title.trim()} className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50">افزودن نقش</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {defs.map(d => (
            <div key={d.id} className={`rounded-2xl border p-3 space-y-1 ${d.isActive === 1 ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 opacity-70'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm text-slate-900 dark:text-slate-100">{d.title}</span>
                <span className="font-mono text-3xs text-slate-400" dir="ltr">{d.code}</span>
              </div>
              {d.description && <p className="text-2xs text-slate-500 dark:text-slate-400">{d.description}</p>}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={() => toggleDef(d)} disabled={busy} className="text-2xs font-bold text-amber-700 dark:text-amber-400">{d.isActive === 1 ? 'غیرفعال کن' : 'فعال کن'}</button>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <button onClick={() => deleteDef(d)} disabled={busy} className="text-2xs font-bold text-rose-600 dark:text-rose-400">حذف</button>
              </div>
            </div>
          ))}
          {defs.length === 0 && <div className="col-span-full text-center text-xs text-slate-400 py-4 border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">هنوز نقشی تعریف نشده است.</div>}
        </div>
      </section>

      {/* نقش و فرمول هر درس */}
      <section className="card space-y-4">
        <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-700 pb-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-xl">📚</div>
          <div>
            <h2 className="font-black text-slate-900 dark:text-slate-100 text-base">نقش و فرمول هر درس</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">نقش هر ارائه (تشخیص خودکار یا دستی) و اینکه کدام قانون فرمول روی آن نشسته است.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={onlyNoFormula} onChange={e => setOnlyNoFormula(e.target.checked)} />
            فقط بدون فرمول
          </label>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="جست‌وجوی درس/کد/استاد…" className="border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded px-2 py-1.5 w-64" />
          <span className="text-slate-500 dark:text-slate-400">{fa(shown.length)} سطر</span>
        </div>

        <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-2xl">
          <table className="w-full text-right text-xs border-collapse rt">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="p-2.5">درس</th>
                <th className="p-2.5">استاد</th>
                <th className="p-2.5">نقش (تشخیص خودکار)</th>
                <th className="p-2.5">نقش دستی</th>
                <th className="p-2.5">فرمول</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={`${r.staffId}-${r.offeringId}`} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="p-2.5">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{r.courseTitle}</div>
                    <div className="text-3xs text-slate-400">{r.courseCode} · گروه {r.groupNumber ?? '—'}{r.merged && <span className="text-indigo-600"> · 🔗 ادغامی</span>}</div>
                  </td>
                  <td className="p-2.5 text-slate-700 dark:text-slate-200">{r.staffName}</td>
                  <td className="p-2.5">
                    <span className="inline-block bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded px-2 py-0.5 text-3xs font-bold">{r.roleFa || r.role}</span>
                  </td>
                  <td className="p-2.5">
                    <select
                      value={ovr[r.offeringId] ?? ''}
                      onChange={e => saveOverride(r.offeringId, r.staffId, e.target.value)}
                      disabled={busy}
                      className="border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded px-1.5 py-1 text-3xs max-w-[10rem]"
                    >
                      <option value="">— خودکار —</option>
                      {defs.filter(d => d.isActive === 1).map(d => <option key={d.id} value={d.code}>{d.title}</option>)}
                    </select>
                  </td>
                  <td className="p-2.5">
                    {r.ruleId != null ? (
                      <div>
                        <span className="inline-block bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 rounded px-2 py-0.5 text-3xs font-bold">{r.ruleTitle ?? `#${r.ruleId}`}</span>
                        {r.expression && <div dir="ltr" className="text-left font-mono text-3xs text-slate-500 mt-1">{r.expression}</div>}
                      </div>
                    ) : (
                      <div>
                        <span className="inline-block bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200 rounded px-2 py-0.5 text-3xs font-bold">بدون فرمول</span>
                        {r.missReason && <div className="text-3xs text-slate-500 mt-1">{r.missReason}</div>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">موردی نیست.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function fa(v: number | string | null | undefined) {
  if (v === null || v === undefined || v === '') return '—';
  return String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}
