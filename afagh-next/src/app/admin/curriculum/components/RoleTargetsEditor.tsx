'use client';

// ویرایشگر سهم واحد هر نوع درس (مقرر نسخه) — ردیفی و پویا.
// کاربر خودش نوع درس را انتخاب می‌کند، تعداد واحد را می‌نویسد و در صورت نیاز
// ردیف تازه باز می‌کند. انواعی که اضافه نشوند «مقرر نیستند» — پس رشته‌ای که
// اصلاً عمومی یا جبرانی ندارد، فقط ردیف‌های موجود خودش را تعریف می‌کند.
import { useMemo, useState } from 'react';
import { faNum, ROLE_TARGET_KEYS, ROLE_LABELS, EXTRA_ROLE_LABELS } from '../curriculum-core';

type Row = { id: number; role: string; units: string };

const OPTIONS: { key: string; label: string; hint?: string }[] = ROLE_TARGET_KEYS.map(k => ({
  key: k,
  label: ROLE_LABELS[k] ?? EXTRA_ROLE_LABELS[k] ?? k,
  hint: ROLE_LABELS[k] ? undefined : 'خارج از چارت رسمی — فقط سهم واحد',
}));

export default function RoleTargetsEditor({ initial, unitsByRole, countsByRole, totalRequired, disabled, onSave }: {
  initial: Record<string, number>;
  unitsByRole: Map<string, number>;
  /** تعداد درس موجود هر نوع — از خود دروسِ همین چارت شمرده می‌شود */
  countsByRole?: Map<string, number>;
  totalRequired: number;
  disabled: boolean;
  onSave: (targets: Record<string, number>) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => {
    const entries = Object.entries(initial ?? {});
    if (entries.length === 0) return [{ id: 1, role: '', units: '' }];
    return entries.map(([role, v], i) => ({ id: i + 1, role, units: String(v) }));
  });
  const [seq, setSeq] = useState(rows.length + 1);

  const usedRoles = useMemo(() => new Set(rows.map(r => r.role).filter(Boolean)), [rows]);
  const sum = rows.reduce((s, r) => s + (Number(r.units) || 0), 0);
  const diff = totalRequired - sum;

  const addRow = () => {
    setRows(prev => [...prev, { id: seq, role: '', units: '' }]);
    setSeq(n => n + 1);
  };
  const removeRow = (id: number) => setRows(prev => (prev.length === 1 ? [{ id: prev[0].id, role: '', units: '' }] : prev.filter(r => r.id !== id)));
  const patch = (id: number, p: Partial<Row>) => setRows(prev => prev.map(r => (r.id === id ? { ...r, ...p } : r)));

  const submit = () => {
    const t: Record<string, number> = {};
    for (const r of rows) {
      if (!r.role) continue;
      const raw = (r.units ?? '').trim();
      if (raw === '') continue;            // نوع انتخاب‌شده بدون عدد = تعیین‌نشده
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) t[r.role] = n;
    }
    onSave(t);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rows.map((r, idx) => {
          const have = r.role ? (unitsByRole?.get(r.role) ?? 0) : 0;
          const want = Number(r.units) || 0;
          const filled = r.role !== '' && (r.units ?? '').trim() !== '';
          const short = filled && have < want;
          return (
            <div
              key={r.id}
              className={`flex flex-wrap items-center gap-2 p-2 rounded-xl border ${short ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50/60'}`}
            >
              <span className="w-6 h-6 shrink-0 rounded-lg bg-slate-900 text-white text-3xs font-black flex items-center justify-center">
                {faNum(idx + 1)}
              </span>

              <select
                value={r.role}
                disabled={disabled}
                onChange={e => patch(r.id, { role: e.target.value })}
                className="min-w-[9rem] flex-1 sm:flex-none border border-slate-300 rounded-lg px-2 py-1.5 font-bold bg-white text-slate-900 disabled:opacity-50"
              >
                <option value="">— نوع درس را انتخاب کنید —</option>
                {OPTIONS.map(o => (
                  <option key={o.key} value={o.key} disabled={usedRoles.has(o.key) && o.key !== r.role}>
                    {o.label}{o.hint ? ` (${o.hint})` : ''}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1.5">
                <input
                  type="number" min={0} inputMode="numeric"
                  value={r.units}
                  disabled={disabled || !r.role}
                  onChange={e => patch(r.id, { units: e.target.value })}
                  placeholder="واحد"
                  className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-center font-black bg-white disabled:opacity-50"
                />
                <span className="text-2xs font-bold text-slate-500">واحد</span>
              </div>

              <span className={`text-2xs font-bold ${short ? 'text-amber-700' : 'text-slate-500'}`}>
                {r.role
                  ? `${faNum(countsByRole?.get(r.role) ?? 0)} درس · ${faNum(have)} واحد${short ? ` (کسری ${faNum(want - have)})` : ''}`
                  : 'نوع درس تعیین نشده'}
              </span>

              <button
                type="button"
                onClick={() => removeRow(r.id)}
                disabled={disabled}
                title="حذف این ردیف"
                className="mr-auto px-2 py-1 rounded-lg border border-rose-200 text-rose-700 font-black text-2xs hover:bg-rose-50 disabled:opacity-40"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addRow}
          disabled={disabled || usedRoles.size >= OPTIONS.length}
          className="px-3 py-1.5 rounded-lg border border-teal-300 bg-teal-50 text-teal-900 font-extrabold text-2xs hover:bg-teal-100 disabled:opacity-40"
        >
          ＋ افزودن نوع درس
        </button>
        <span className="text-3xs font-bold text-slate-400">
          هر نوعی که اضافه نکنید، «مقرر» محسوب نمی‌شود (مثلاً رشتهٔ بدون درس عمومی).
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
        <p className="text-2xs font-black text-slate-700">
          جمع سهم‌ها: {faNum(sum)} واحد · واحد الزامی نسخه: {faNum(totalRequired)} واحد
          {diff !== 0 && (
            <span className="text-amber-700"> · اختلاف {faNum(Math.abs(diff))} واحد ({diff > 0 ? 'کمتر از سقف' : 'بیشتر از سقف'})</span>
          )}
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={disabled}
          className="px-3 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-extrabold text-2xs disabled:opacity-50"
        >
          💾 ذخیره سهم‌ها و اعتبارسنجی مجدد
        </button>
      </div>
    </div>
  );
}
