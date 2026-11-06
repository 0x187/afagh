'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';

type Term = { id: number; title: string; isCurrent?: number };
type Row = {
  staffId: number; staffName: string; offeringId: number; courseCode: string; courseTitle: string;
  groupNumber: number | null; offeringType: string; offeringTypeFa: string; role: string; roleFa: string;
  enrolled: number; hasClass: boolean; nth: number; merged: boolean; memberCount: number;
  ruleId: number | null; ruleTitle: string | null; expression: string | null;
  missDim: string | null; missReason: string | null;
  overrideCode: string | null; overrideTitle: string | null;
};

const MISS_DIM_FA: Record<string, string> = {
  none: 'بدون قانون', offeringType: 'نوع درس', professorRole: 'نقش',
  academicRank: 'مرتبه', classMode: 'وضعیت کلاس', studentRange: 'بازه دانشجو',
  department: 'گروه آموزشی', courseType: 'نوع درس', repeat: 'تکرار تدریس', unknown: 'نامشخص',
};

async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `خطا ${r.status}`);
  return data;
}

export default function CoverageClient() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [termId, setTermId] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [ruleCount, setRuleCount] = useState(0);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [q, setQ] = useState('');
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api('/api/admin/enrollment-approvals?action=terms')
      .then(d => {
        const list: Term[] = d.terms ?? d.rows ?? [];
        setTerms(list);
        const cur = list.find(t => t.isCurrent === 1) ?? list[0];
        if (cur) setTermId(cur.id);
      })
      .catch(e => setErr((e as Error).message));
  }, []);

  const load = useCallback((tid: number) => {
    setErr(null);
    start(async () => {
      try {
        const d = await api(`/api/admin/payroll/rule-coverage?termId=${tid}`);
        setRows(d.rows ?? []);
        setRuleCount(d.ruleCount ?? 0);
      } catch (e) { setErr((e as Error).message); }
    });
  }, []);

  useEffect(() => { if (termId) load(termId); }, [termId, load]);

  const missing = useMemo(() => rows.filter(r => r.ruleId == null), [rows]);
  const shown = useMemo(() => {
    let list = onlyMissing ? missing : rows;
    const needle = q.trim();
    if (needle) {
      list = list.filter(r =>
        r.courseTitle.includes(needle) || r.courseCode.includes(needle)
        || r.staffName.includes(needle) || (r.ruleTitle ?? '').includes(needle));
    }
    return list;
  }, [rows, missing, onlyMissing, q]);

  // پرتکرارترین علت‌ها — راهنمای «اول چی را درست کنم»
  const topDims = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of missing) m.set(r.missDim ?? 'unknown', (m.get(r.missDim ?? 'unknown') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [missing]);

  return (
    <div dir="rtl" className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">پوشش فرمول‌ها</h1>
        <span className="text-sm text-gray-500">کدام درس‌ها فرمول دارند، کدام ندارند و چرا</span>
        <div className="ms-auto flex items-center gap-2">
          <label className="text-sm text-gray-600">ترم:</label>
          <select
            className="border rounded px-2 py-1.5 text-sm"
            value={termId ?? ''}
            onChange={e => setTermId(Number(e.target.value))}
          >
            {terms.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <button onClick={() => termId && load(termId)} disabled={busy}
            className="border rounded px-3 py-1.5 text-sm hover:bg-gray-50">↻ تازه‌سازی</button>
        </div>
      </div>

      {err && <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3 text-sm">{err}</div>}

      {/* نوار خلاصه */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border rounded-lg p-3 bg-white">
          <div className="text-xs text-gray-500">قانون فعال</div>
          <div className="text-2xl font-bold">{ruleCount}</div>
        </div>
        <div className="border rounded-lg p-3 bg-white">
          <div className="text-xs text-gray-500">ارائه‌ها</div>
          <div className="text-2xl font-bold">{rows.length}</div>
        </div>
        <div className="border rounded-lg p-3 bg-emerald-50 border-emerald-200">
          <div className="text-xs text-emerald-700">فرمول‌دار ✅</div>
          <div className="text-2xl font-bold text-emerald-800">{rows.length - missing.length}</div>
        </div>
        <div className="border rounded-lg p-3 bg-rose-50 border-rose-200">
          <div className="text-xs text-rose-700">بدون فرمول ❌</div>
          <div className="text-2xl font-bold text-rose-800">{missing.length}</div>
        </div>
      </div>

      {topDims.length > 0 && (
        <div className="border rounded-lg p-3 bg-amber-50 border-amber-200 text-sm">
          <span className="font-bold">اول این‌ها را درست کنید: </span>
          {topDims.map(([d, n]) => (
            <span key={d} className="inline-block bg-white border border-amber-300 rounded-full px-2.5 py-0.5 mx-1">
              {MISS_DIM_FA[d] ?? d} — {n} مورد
            </span>
          ))}
        </div>
      )}

      {/* فیلترها */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} />
          فقط بدون‌فرمول‌ها
        </label>
        <input
          className="border rounded px-2 py-1.5 w-64" placeholder="جستجو: درس، کد، استاد، قانون…"
          value={q} onChange={e => setQ(e.target.value)}
        />
        <span className="text-gray-500">{shown.length} سطر</span>
      </div>

      {/* جدول */}
      <div className="border rounded-lg overflow-x-auto bg-white">
        <table className="w-full text-sm min-w-[900px] rt rt--scroll">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-right">درس</th>
              <th className="p-2 text-right">استاد</th>
              <th className="p-2 text-right">نوع / نقش</th>
              <th className="p-2 text-center">دانشجو</th>
              <th className="p-2 text-center">کلاس</th>
              <th className="p-2 text-right">فرمول / علت نبود</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={`${r.staffId}-${r.offeringId}`} className="border-t hover:bg-gray-50/60">
                <td className="p-2">
                  <div className="font-medium">{r.courseTitle}</div>
                  <div className="text-xs text-gray-500">
                    {r.courseCode} · گروه {r.groupNumber ?? '—'}
                    {r.merged && <span className="text-indigo-600"> · 🔗 ادغامی ({r.memberCount})</span>}
                    {r.nth > 1 && <span className="text-amber-700"> · تکرار {r.nth}اُم</span>}
                  </div>
                </td>
                <td className="p-2">{r.staffName}</td>
                <td className="p-2 text-xs">
                  <div>{r.offeringTypeFa}</div>
                  <div className="text-gray-500">{r.roleFa}</div>
                  {r.overrideTitle && (
                    <div className="mt-0.5 inline-block bg-violet-100 text-violet-800 rounded px-1.5 py-0.5 text-3xs font-medium">
                      نقش دستی: {r.overrideTitle}
                    </div>
                  )}
                </td>
                <td className="p-2 text-center">{r.enrolled}</td>
                <td className="p-2 text-center">{r.hasClass ? '✅' : '—'}</td>
                <td className="p-2">
                  {r.ruleId != null ? (
                    <div>
                      <span className="inline-block bg-emerald-100 text-emerald-800 rounded px-2 py-0.5 text-xs font-medium">
                        {r.ruleTitle ?? `#${r.ruleId}`}
                      </span>
                      {r.expression && (
                        <div dir="ltr" className="text-left font-mono text-xs text-gray-600 mt-1">{r.expression}</div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <span className="inline-block bg-rose-100 text-rose-800 rounded px-2 py-0.5 text-xs font-medium">
                        بدون فرمول · {MISS_DIM_FA[r.missDim ?? 'unknown'] ?? r.missDim}
                      </span>
                      <div className="text-xs text-gray-600 mt-1">{r.missReason}</div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-gray-500">
                {busy ? 'در حال بارگذاری…' : 'موردی نیست — همهٔ ارائه‌ها فرمول دارند ✅'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
