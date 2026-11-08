'use client';

import { useMemo, useState } from 'react';
import {
  saveCompliancePolicyOverrideAction,
  resetCompliancePolicyOverrideAction,
  seed1402GraduateRegulationsAction,
} from './actions';
import type { ComplianceKey, PolicyKind } from '@/lib/compliance-policy';

export type PolicyRow = {
  key: ComplianceKey;
  label: string;
  group: string;
  kind: PolicyKind;
  reference: string;
  help: string;
  options?: string[];
  min?: number;
  max?: number;
  binding: boolean;
  value: unknown;
  legal: unknown;
  source: string;
  sourceLabel: string;
  legalConflict: boolean;
  shadowed: unknown;
  overrideId: number | null;
  overrideReason: string;
};

type Props = {
  rows: PolicyRow[];
  groups: string[];
  context: { family: string; level: string; entryYear: number; universityId: number | null };
  overrideCount: number;
};

function toText(kind: PolicyKind, v: unknown): string {
  if (v == null) return '';
  if (kind === 'list') return Array.isArray(v) ? v.map(String).join(', ') : String(v);
  if (kind === 'map') return typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
  return String(v);
}

function fromText(kind: PolicyKind, raw: string): unknown {
  if (kind === 'number') return raw.trim() === '' ? '' : Number(raw);
  if (kind === 'boolean') return raw === 'true';
  if (kind === 'map') return raw.trim();
  return raw;
}

function fmt(v: unknown): string {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.join('، ');
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'بله' : 'خیر';
  return String(v);
}

export default function CompliancePolicyClient({ rows, groups, context, overrideCount }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map(r => [r.key, toText(r.kind, r.value)])));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => rows.filter(r =>
    !filter || `${r.label} ${r.key} ${r.reference} ${r.help}`.toLowerCase().includes(filter.toLowerCase())),
    [rows, filter]);

  async function save(row: PolicyRow) {
    setBusy(row.key); setMsg(null);
    const res = await saveCompliancePolicyOverrideAction({
      key: row.key,
      value: fromText(row.kind, draft[row.key] ?? ''),
      reason: reason.trim() || (row.binding ? '' : 'تغییر پیکربندی از پنل انطباق آییننامه'),
    });
    setBusy(null);
    setMsg(res.ok
      ? { ok: true, text: `«${row.label}» ذخیره شد. تغییر با دلیل ثبت گردید و بلافاصله در موتورها اعمال میشود.` }
      : { ok: false, text: res.error ?? 'خطا در ذخیره.' });
  }

  async function reset(row: PolicyRow) {
    if (row.overrideId == null) return;
    setBusy(row.key); setMsg(null);
    const res = await resetCompliancePolicyOverrideAction(row.overrideId);
    setBusy(null);
    setMsg(res.ok
      ? { ok: true, text: `اورراید «${row.label}» حذف شد → بازگشت به پیشفرض قانونی.` }
      : { ok: false, text: res.error ?? 'خطا در حذف.' });
  }

  async function seed() {
    setBusy('__seed'); setMsg(null);
    const res = await seed1402GraduateRegulationsAction();
    setBusy(null);
    setMsg(res.ok
      ? { ok: true, text: `ردیفهای ۱۴۰۲ تحصیلات تکمیلی: ${res.created.length} ایجاد، ${res.skipped.length} از پیش موجود.${res.created.length ? ' (' + res.created.join('، ') + ')' : ''}` }
      : { ok: false, text: res.error ?? 'خطا در ایجاد ردیفها.' });
  }

  const changed = (r: PolicyRow) => (draft[r.key] ?? '') !== toText(r.kind, r.value);

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-5 text-slate-800">
      <div className="card !p-5 bg-white rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-extrabold">انطباق آییننامهٔ ۱۴۰۲ — سیاستهای پیشفرض و قابل تغییر</h1>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              رفتارِ درست قانونی <b>پیشفرض</b> است. هر مقدار قابل اورراید دامنهدار است؛ برای تغییر احکام لازمالاجرا ثبت دلیل الزامی است.
              پیکربندی کهنهای که قانون را نقض کند اعمال نمیشود و در همین صفحه بهعنوان «تعارض» دیده میشود.
            </p>
          </div>
          <div className="flex gap-2">
            <span className="text-2xs bg-slate-100 rounded-lg px-2 py-1 font-mono" dir="ltr">
              {context.family} / {context.level} / {context.entryYear} / U{context.universityId ?? '—'}
            </span>
            <button onClick={seed} disabled={busy === '__seed'}
              className="text-2xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy === '__seed' ? 'در حال ایجاد…' : 'ایجاد ردیفهای ۱۴۰۲ ارشد/دکتری'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <label className="block md:col-span-2">
            <span className="text-2xs font-bold text-slate-600">دلیل تغییر (برای همهٔ ذخیرهها ثبت میشود)</span>
            <input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="مثال: بخشنامهٔ معاونت آموزشی شمارهٔ … / مصوبهٔ شورای آموزشی"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-xs" />
          </label>
          <label className="block">
            <span className="text-2xs font-bold text-slate-600">جستجوی سیاست</span>
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="مادهٔ ۱۲، معدل، غیبت…"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-xs" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 text-2xs">
          <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg px-2 py-1">
            {rows.length} سیاست · {rows.filter(r => r.binding).length} لازمالاجرا
          </span>
          <span className="bg-slate-50 text-slate-700 border border-slate-200 rounded-lg px-2 py-1">
            {overrideCount} اورراید فعال
          </span>
          <span className="bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-2 py-1">
            {rows.filter(r => r.legalConflict).length} تعارض پیکربندی قدیمی (اعمال نشد)
          </span>
        </div>
        {msg && (
          <div className={`text-xs rounded-lg px-3 py-2 border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
            {msg.text}
          </div>
        )}
      </div>

      {groups.map(g => {
        const list = visible.filter(r => r.group === g);
        if (!list.length) return null;
        return (
          <section key={g} className="card !p-5 bg-white rounded-2xl shadow-sm border border-slate-200 space-y-3">
            <h2 className="text-sm font-extrabold border-b border-slate-100 pb-2">{g}</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {list.map(r => (
                <div key={r.key} className={`rounded-xl border p-3 space-y-2 ${r.legalConflict ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-slate-50/50'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold">{r.label}</div>
                      <div className="text-2xs text-slate-400 font-mono" dir="ltr">{r.key}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-2xs rounded px-1.5 py-0.5 border font-bold ${r.source === 'override' ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : r.source === 'legal-guard' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>
                        {r.sourceLabel}
                      </span>
                      {r.binding && <span className="text-2xs text-rose-700 font-bold">قانون لازمالاجرا</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {r.kind === 'enum' ? (
                      <select value={draft[r.key] ?? ''} onChange={e => setDraft({ ...draft, [r.key]: e.target.value })}
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white min-w-[16rem]">
                        {(r.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : r.kind === 'boolean' ? (
                      <select value={draft[r.key] ?? ''} onChange={e => setDraft({ ...draft, [r.key]: e.target.value })}
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                        <option value="true">بله</option><option value="false">خیر</option>
                      </select>
                    ) : r.kind === 'map' ? (
                      <textarea value={draft[r.key] ?? ''} onChange={e => setDraft({ ...draft, [r.key]: e.target.value })}
                        rows={4} dir="ltr" className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-2xs font-mono bg-white" />
                    ) : (
                      <input
                        type={r.kind === 'number' ? 'number' : 'text'}
                        min={r.min} max={r.max}
                        value={draft[r.key] ?? ''}
                        onChange={e => setDraft({ ...draft, [r.key]: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white" />
                    )}
                  </div>

                  <div className="text-2xs text-slate-500 leading-relaxed">{r.help}</div>
                  <div className="text-2xs text-slate-400 leading-relaxed">مستند: {r.reference}</div>
                  <div className="text-2xs bg-white/70 border border-slate-100 rounded-lg px-2 py-1">
                    پیشفرض قانونی: <b>{fmt(r.legal)}</b>
                    {r.legalConflict && (
                      <span className="text-amber-700"> · مقدار قدیمی کنارگذاشتهشده: <b dir="ltr">{fmt(r.shadowed)}</b></span>
                    )}
                  </div>
                  {r.overrideId != null && (
                    <div className="text-2xs text-indigo-700">دلیل اورراید: {r.overrideReason}</div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => save(r)} disabled={!changed(r) || busy === r.key}
                      className="text-2xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                      {busy === r.key ? 'در حال ذخیره…' : 'ذخیرهٔ اورراید'}
                    </button>
                    {r.overrideId != null && (
                      <button onClick={() => reset(r)} disabled={busy === r.key}
                        className="text-2xs font-bold px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50">
                        بازگشت به پیشفرض قانونی
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
