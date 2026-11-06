'use client';

import { useState, useTransition } from 'react';
import { saveFeeRuleAction, deleteFeeRuleAction, importLegacyFeeRulesAction, setEquivFixedModeAction, type FeeRuleInput } from './actions';
import type { EquivFixedMode } from '@/lib/tuition-rules';
import { askConfirm } from '@/lib/ui-feedback';

type Rule = {
  id: number;
  degreeLevelId: number | null;
  termType: string | null;
  offeringType: string | null;
  fixedTuition: number;
  perUnitTuition: number;
  effectiveFromYear: number | null;
  isActive: boolean;
  note: string | null;
};
type Degree = { id: number; title: string };

const TERM_TYPES = [
  { value: '', label: 'همهٔ ترم‌ها' },
  { value: 'NORMAL', label: 'ترم عادی' },
  { value: 'SUMMER', label: 'ترم تابستان' },
  { value: 'EQUIVALENCE', label: 'ترم معادل‌سازی' },
];
const OFFERING_TYPES = [
  { value: '', label: 'همهٔ انواع' },
  { value: 'NORMAL', label: 'عادی (NORMAL)' },
  { value: 'TRANSFER', label: 'معادل‌سازی (TRANSFER)' },
];

const EQUIV_MODES: { value: EquivFixedMode; label: string; hint: string }[] = [
  { value: 'ONCE', label: 'یک بار به ازای هر دانشجو', hint: 'شهریهٔ ثابت فقط روی اولین نیمسال معادل‌سازی شارژ می‌شود (پیشنهادی)' },
  { value: 'PER_TERM', label: 'به ازای هر نیمسال معادل‌سازی', hint: 'هر نیمسال ۰۰EQ شهریهٔ ثابت جدا می‌گیرد' },
  { value: 'NONE', label: 'بدون شهریهٔ ثابت', hint: 'فقط شهریهٔ متغیر به ازای هر واحد محاسبه می‌شود' },
];

const fa = (n: number) => Math.round(n).toLocaleString('fa-IR');
const termFa = (t: string | null) => TERM_TYPES.find(x => x.value === (t ?? ''))?.label ?? (t || '—');
const offFa = (t: string | null) => OFFERING_TYPES.find(x => x.value === (t ?? ''))?.label ?? (t || '—');

const emptyForm: FeeRuleInput = {
  degreeLevelId: null, termType: null, offeringType: null,
  fixedTuition: 0, perUnitTuition: 0, effectiveFromYear: null, isActive: true, note: '',
};

export default function TuitionRulesClient({ rules, degrees, equivFixedMode }: { rules: Rule[]; degrees: Degree[]; equivFixedMode: EquivFixedMode }) {
  const [form, setForm] = useState<FeeRuleInput>(emptyForm);
  const [editing, setEditing] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<EquivFixedMode>(equivFixedMode);

  const set = (patch: Partial<FeeRuleInput>) => setForm(f => ({ ...f, ...patch }));

  const edit = (r: Rule) => {
    setEditing(r.id);
    setForm({
      id: r.id, degreeLevelId: r.degreeLevelId, termType: r.termType, offeringType: r.offeringType,
      fixedTuition: r.fixedTuition, perUnitTuition: r.perUnitTuition,
      effectiveFromYear: r.effectiveFromYear, isActive: r.isActive, note: r.note ?? '',
    });
    setMsg(null);
  };
  const reset = () => { setEditing(null); setForm(emptyForm); setMsg(null); };

  const submit = () => {
    start(async () => {
      const res = await saveFeeRuleAction(form);
      if (res.ok) { reset(); setMsg({ ok: true, text: 'قاعدهٔ شهریه ذخیره شد.' }); }
      else setMsg({ ok: false, text: res.error || 'ذخیره ناموفق بود.' });
    });
  };

  const remove = async (id: number) => {
    if (!(await askConfirm({ title: 'تأیید عملیات', body: 'این قاعدهٔ شهریه حذف شود؟', confirmText: 'تأیید', cancelText: 'انصراف', danger: true }))) return;
    start(async () => {
      const res = await deleteFeeRuleAction(id);
      setMsg(res.ok ? { ok: true, text: 'حذف شد.' } : { ok: false, text: res.error || 'حذف ناموفق بود.' });
      if (editing === id) reset();
    });
  };

  const saveMode = (next: EquivFixedMode) => {
    setMode(next);
    start(async () => {
      const res = await setEquivFixedModeAction(next);
      if (res.ok) setMsg({ ok: true, text: 'سیاست شهریهٔ ثابت معادل‌سازی ذخیره شد.' });
      else setMsg({ ok: false, text: res.error || 'ذخیرهٔ سیاست ناموفق بود.' });
    });
  };

  const importLegacy = async () => {
    if (!(await askConfirm({ title: 'تأیید عملیات', body: 'قواعد مالی قدیمی به موتور جدید درون‌ریزی شوند؟ قواعد تکراری ساخته نمی‌شوند.', confirmText: 'تأیید', cancelText: 'انصراف', danger: false }))) return;
    start(async () => {
      const res = await importLegacyFeeRulesAction();
      if (res.ok) {
        setMsg({
          ok: true,
          text: `درون‌ریزی انجام شد: ${fa(res.created ?? 0)} قاعدهٔ جدید، ${fa(res.skipped ?? 0)} مورد تکراری رد شد.`,
        });
      } else {
        setMsg({ ok: false, text: res.error || 'درون‌ریزی ناموفق بود.' });
      }
    });
  };

  return (
    <div dir="rtl" className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900">موتور شهریه — قواعد قابل تنظیم</h1>
        <p className="text-sm text-slate-500 mt-1">
          شهریهٔ ثابت بر اساس <b>نوع ترم</b> و شهریهٔ متغیر بر اساس <b>نوع گذراندن درس</b> اعمال می‌شود.
          خاص‌ترین قاعدهٔ منطبق برنده است؛ برای معادل‌سازی یک قاعده با نوع ترم «معادل‌سازی» و/یا نوع درس «TRANSFER» بسازید.
        </p>
      </div>

      {/* سیاست شهریهٔ ثابت معادل‌سازی */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h2 className="font-bold text-slate-800">شهریهٔ ثابت معادل‌سازی</h2>
        <p className="text-xs text-slate-500 mt-1 mb-4">
          دروس معادل‌سازی هر ۲۰ واحد در یک نیمسال جدا (۰۰EQ) ثبت می‌شوند. این گزینه تعیین می‌کند
          شهریهٔ ثابت چند بار شارژ شود. <b>شهریهٔ متغیر در همهٔ حالت‌ها به ازای هر واحد محاسبه می‌شود.</b>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {EQUIV_MODES.map(m => (
            <button
              key={m.value}
              onClick={() => saveMode(m.value)}
              disabled={pending}
              className={`text-right rounded-xl border p-3 transition disabled:opacity-50 ${
                mode === m.value
                  ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600'
                  : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
              }`}
            >
              <span className={`block text-sm font-bold ${mode === m.value ? 'text-indigo-800' : 'text-slate-800'}`}>
                {m.label}
              </span>
              <span className="block text-xs text-slate-500 mt-1">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* فرم ایجاد/ویرایش */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h2 className="font-bold text-slate-800 mb-4">{editing ? 'ویرایش قاعده' : 'قاعدهٔ شهریهٔ جدید'}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-xs font-bold text-slate-600">مقطع</span>
            <select
              className="mt-1 w-full border border-slate-300 rounded-lg p-2 text-sm bg-white"
              value={form.degreeLevelId ?? ''}
              onChange={e => set({ degreeLevelId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">همهٔ مقاطع</option>
              {degrees.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-bold text-slate-600">نوع ترم (برای شهریهٔ ثابت)</span>
            <select
              className="mt-1 w-full border border-slate-300 rounded-lg p-2 text-sm bg-white"
              value={form.termType ?? ''}
              onChange={e => set({ termType: e.target.value || null })}
            >
              {TERM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-bold text-slate-600">نوع گذراندن درس (برای شهریهٔ متغیر)</span>
            <select
              className="mt-1 w-full border border-slate-300 rounded-lg p-2 text-sm bg-white"
              value={form.offeringType ?? ''}
              onChange={e => set({ offeringType: e.target.value || null })}
            >
              {OFFERING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-bold text-slate-600">شهریهٔ ثابت (ریال)</span>
            <input type="number" min={0} className="mt-1 w-full border border-slate-300 rounded-lg p-2 text-sm"
              value={form.fixedTuition} onChange={e => set({ fixedTuition: Number(e.target.value) })} />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-slate-600">شهریهٔ هر واحد (ریال)</span>
            <input type="number" min={0} className="mt-1 w-full border border-slate-300 rounded-lg p-2 text-sm"
              value={form.perUnitTuition} onChange={e => set({ perUnitTuition: Number(e.target.value) })} />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-slate-600">از ورودیِ (سال)</span>
            <input type="number" min={0} placeholder="همه" className="mt-1 w-full border border-slate-300 rounded-lg p-2 text-sm"
              value={form.effectiveFromYear ?? ''} onChange={e => set({ effectiveFromYear: e.target.value ? Number(e.target.value) : null })} />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-xs font-bold text-slate-600">یادداشت</span>
            <input className="mt-1 w-full border border-slate-300 rounded-lg p-2 text-sm"
              value={form.note ?? ''} onChange={e => set({ note: e.target.value })} />
          </label>

          <label className="flex items-center gap-2 text-sm font-bold text-slate-700 self-end pb-2">
            <input type="checkbox" className="size-4" checked={form.isActive !== false}
              onChange={e => set({ isActive: e.target.checked })} />
            فعال
          </label>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={submit} disabled={pending}
            className="px-5 py-2 rounded-lg bg-indigo-700 text-white text-sm font-bold hover:bg-indigo-800 disabled:opacity-50">
            {editing ? 'به‌روزرسانی قاعده' : 'افزودن قاعده'}
          </button>
          {editing && (
            <button onClick={reset} className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-bold text-slate-600 hover:bg-slate-50">
              انصراف
            </button>
          )}
          <button onClick={importLegacy} disabled={pending}
            className="mr-auto px-4 py-2 rounded-lg border border-indigo-300 text-sm font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
            درون‌ریزی از قواعد مالی قدیمی
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          درون‌ریزی، قواعد جدول قدیمی را به ازای <b>نوع ترم</b> جمع می‌کند (جدیدترین ترم هر نوع برنده است).
          نرخ خاص <b>معادل‌سازی (TRANSFER)</b> در جدول قدیمی وجود ندارد و باید دستی تعریف شود.
        </p>
        {msg && (
          <p className={`mt-3 text-sm font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</p>
        )}
      </div>

      {/* فهرست قواعد */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm rt">
          <thead className="bg-slate-100 text-slate-600 text-xs">
            <tr>
              {['مقطع', 'نوع ترم', 'نوع درس', 'ثابت', 'هر واحد', 'از ورودی', 'وضعیت', 'یادداشت', ''].map(h => (
                <th key={h} className="p-3 text-right font-bold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-slate-400">هنوز قاعده‌ای تعریف نشده است.</td></tr>
            )}
            {rules.map(r => {
              const deg = degrees.find(d => d.id === r.degreeLevelId)?.title ?? 'همهٔ مقاطع';
              return (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3">{deg}</td>
                  <td className="p-3">{termFa(r.termType)}</td>
                  <td className="p-3">{offFa(r.offeringType)}</td>
                  <td className="p-3 font-mono">{fa(r.fixedTuition)}</td>
                  <td className="p-3 font-mono">{fa(r.perUnitTuition)}</td>
                  <td className="p-3">{r.effectiveFromYear ?? '—'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${r.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                      {r.isActive ? 'فعال' : 'غیرفعال'}
                    </span>
                  </td>
                  <td className="p-3 text-slate-500 max-w-[180px] truncate">{r.note || '—'}</td>
                  <td className="p-3 whitespace-nowrap">
                    <button onClick={() => edit(r)} className="text-indigo-700 font-bold hover:underline ml-3">ویرایش</button>
                    <button onClick={() => remove(r.id)} className="text-rose-600 font-bold hover:underline">حذف</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
