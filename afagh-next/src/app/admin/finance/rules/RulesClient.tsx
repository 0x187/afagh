'use client';

import { useState, useTransition } from 'react';
import {
  deleteDiscountTypeAction, deleteFormulaAction, deleteLoanProductAction,
  deleteSponsorAction, saveDiscountTypeAction, saveFormulaAction,
  saveLoanProductAction, saveSponsorAction,
} from '../actions';

type DiscountType = {
  id: number; code: string; title: string; kind: string;
  defaultPercent: number; defaultAmount: number; maxPercent: number | null;
  requiresApproval: boolean; requiresDocument: boolean; isActive: boolean; note: string | null;
};
type Sponsor = {
  id: number; code: string; title: string; contactInfo: string | null;
  settlementMethod: string; isActive: boolean; note: string | null;
};
type LoanProduct = {
  id: number; code: string; title: string; lender: string;
  maxAmount: number | null; defaultAmount: number; defaultInstallments: number;
  isInterestFree: boolean; requiresApproval: boolean; isActive: boolean; note: string | null;
};
type Formula = {
  id: number; code: string; title: string;
  degreeLevelId: number | null; majorId: number | null;
  entryYearFrom: number | null; entryYearTo: number | null;
  fixedAmount: number; perUnitTheory: number; perUnitPractical: number; perUnitGeneral: number;
  priority: number; isActive: boolean; note: string | null;
};
type Coefficient = {
  id: number; termId: number; variableCoefficient: number; fixedCoefficient: number;
  note: string | null; termTitle: string | null; termCode: string | null;
};
type SubjectFeeType = {
  id: number; code: string; title: string; kind: string;
  fixedAmount: number; variablePercent: number; appliesTo: string;
  isActive: boolean; note: string | null;
};
type Term = { id: number; termCode: string; termTitle: string };

const fa = (n: number) => Number(n || 0).toLocaleString('fa-IR');
const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500';
const labelCls = 'flex flex-col gap-1 text-2xs font-medium text-slate-600';
const btnCls =
  'rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50';
const ghostBtn =
  'rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 px-2 py-0.5 text-2xs font-medium text-slate-600';

export default function RulesClient(props: {
  discountTypes: DiscountType[];
  sponsors: Sponsor[];
  formulas: Formula[];
  loanProducts: LoanProduct[];
  degrees: { id: number; title: string }[];
  majorsOptions: { id: number; title: string }[];
  coefficients: Coefficient[];
  subjectFeeTypes: SubjectFeeType[];
  terms: Term[];
}) {
  const [tab, setTab] = useState<'discount' | 'sponsor' | 'formula' | 'loan' | 'coefficient' | 'subjectFee'>('discount');
  const [editingDiscount, setEditingDiscount] = useState<DiscountType | null>(null);
  const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null);
  const [editingFormula, setEditingFormula] = useState<Formula | null>(null);
  const [editingLoan, setEditingLoan] = useState<LoanProduct | null>(null);
  const [editingCoefficient, setEditingCoefficient] = useState<Coefficient | null>(null);
  const [editingSubjectFee, setEditingSubjectFee] = useState<SubjectFeeType | null>(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string, after?: () => void) {
    setMsg(null);
    startTransition(async () => {
      try {
        const r = await fn();
        setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error || 'عملیات ناموفق بود' });
        if (r.ok && after) after();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : 'خطای ناشناخته' });
      }
    });
  }

  const tabs = [
    { id: 'discount', label: '🎖️ انواع تخفیف' },
    { id: 'sponsor', label: '🏛️ بنیادهای حامی' },
    { id: 'formula', label: '🧮 فرمول تخصیص' },
    { id: 'loan', label: '💰 وام‌ها' },
    { id: 'coefficient', label: '📈 ضریب افزایشی نیمسال' },
    { id: 'subjectFee', label: '🏷️ مبالغ موضوعی' },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-1 border-b border-slate-100 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.id ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {msg && (
        <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {msg.text}
        </p>
      )}

      {/* ═══ انواع تخفیف ═══ */}
      {tab === 'discount' && (
        <div className="card space-y-4">
          <form
            key={editingDiscount?.id ?? 'new-discount'}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const draft = editingDiscount;
              run(() => saveDiscountTypeAction({
                id: draft?.id,
                code: String(f.get('code') || ''),
                title: String(f.get('title') || ''),
                kind: String(f.get('kind') || 'PERCENT'),
                defaultPercent: Number(f.get('defaultPercent')) || 0,
                defaultAmount: Number(f.get('defaultAmount')) || 0,
                maxPercent: f.get('maxPercent') === '' ? null : Number(f.get('maxPercent')),
                requiresApproval: f.get('requiresApproval') === 'on',
                requiresDocument: f.get('requiresDocument') === 'on',
                isActive: f.get('isActive') === 'on',
                note: String(f.get('note') || ''),
              }), draft ? 'نوع تخفیف به‌روز شد' : 'نوع تخفیف ساخته شد', () => setEditingDiscount(null));
              e.currentTarget.reset();
            }}
            className="rounded-lg border border-slate-200 p-3"
          >
            <h4 className="mb-2 text-xs font-bold text-slate-800">
              {editingDiscount ? `ویرایش: ${editingDiscount.title}` : 'افزودن نوع تخفیف'}
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className={labelCls}>کد *<input name="code" required defaultValue={editingDiscount?.code} placeholder="TOP_RANK" className={inputCls} /></label>
              <label className={`${labelCls} sm:col-span-2`}>عنوان *<input name="title" required defaultValue={editingDiscount?.title} placeholder="رتبهٔ برتر" className={inputCls} /></label>
              <label className={labelCls}>
                نوع
                <select name="kind" defaultValue={editingDiscount?.kind || 'PERCENT'} className={inputCls}>
                  <option value="PERCENT">درصدی</option>
                  <option value="FIXED">مبلغ ثابت</option>
                </select>
              </label>
              <label className={labelCls}>درصد پیش‌فرض<input name="defaultPercent" type="number" min={0} max={100} step="0.5" defaultValue={editingDiscount?.defaultPercent ?? 0} className={inputCls} /></label>
              <label className={labelCls}>مبلغ پیش‌فرض (ریال)<input name="defaultAmount" type="number" min={0} defaultValue={editingDiscount?.defaultAmount ?? 0} className={inputCls} /></label>
              <label className={labelCls}>سقف درصد مجاز (خالی = بدون سقف)<input name="maxPercent" type="number" min={0} max={100} step="0.5" defaultValue={editingDiscount?.maxPercent ?? ''} className={inputCls} /></label>
              <label className={`${labelCls} sm:col-span-2`}>یادداشت<input name="note" defaultValue={editingDiscount?.note ?? ''} className={inputCls} /></label>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
                <label className="flex items-center gap-1.5 text-2xs text-slate-700">
                  <input type="checkbox" name="requiresApproval" defaultChecked={editingDiscount?.requiresApproval ?? true} className="accent-emerald-700" />
                  نیازمند تأیید کارشناس مالی
                </label>
                <label className="flex items-center gap-1.5 text-2xs text-slate-700">
                  <input type="checkbox" name="requiresDocument" defaultChecked={editingDiscount?.requiresDocument ?? false} className="accent-emerald-700" />
                  نیازمند مستندات
                </label>
                <label className="flex items-center gap-1.5 text-2xs text-slate-700">
                  <input type="checkbox" name="isActive" defaultChecked={editingDiscount?.isActive ?? true} className="accent-emerald-700" />
                  فعال
                </label>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button type="submit" disabled={pending} className={btnCls}>{editingDiscount ? 'ذخیرهٔ تغییرات' : 'افزودن'}</button>
              {editingDiscount && (
                <button type="button" onClick={() => setEditingDiscount(null)} className={ghostBtn}>انصراف</button>
              )}
            </div>
          </form>

          {props.discountTypes.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">هنوز نوع تخفیفی تعریف نشده است.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs rt">
                <thead>
                  <tr className="border-b border-slate-200 text-2xs text-slate-500">
                    <th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2">نوع</th>
                    <th className="p-2">پیش‌فرض</th><th className="p-2">سقف</th><th className="p-2">وضعیت</th><th className="p-2">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {props.discountTypes.map((d) => (
                    <tr key={d.id} className="border-b border-slate-100 last:border-0">
                      <td className="p-2 text-slate-500">{d.code}</td>
                      <td className="p-2 font-medium text-slate-800">{d.title}</td>
                      <td className="p-2">{d.kind === 'PERCENT' ? 'درصدی' : 'مبلغ ثابت'}</td>
                      <td className="p-2">{d.kind === 'PERCENT' ? `${fa(d.defaultPercent)}٪` : fa(d.defaultAmount)}</td>
                      <td className="p-2 text-slate-500">{d.maxPercent === null ? '—' : `${fa(d.maxPercent)}٪`}</td>
                      <td className="p-2">
                        <span className={`rounded px-1.5 py-0.5 text-3xs ${d.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {d.isActive ? 'فعال' : 'غیرفعال'}
                        </span>
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <button onClick={() => setEditingDiscount(d)} className={ghostBtn}>ویرایش</button>
                          <button disabled={pending} onClick={() => run(() => deleteDiscountTypeAction(d.id), 'حذف شد')} className={ghostBtn}>حذف</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ بنیادها ═══ */}
      {tab === 'sponsor' && (
        <div className="card space-y-4">
          <form
            key={editingSponsor?.id ?? 'new-sponsor'}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const draft = editingSponsor;
              run(() => saveSponsorAction({
                id: draft?.id,
                code: String(f.get('code') || ''),
                title: String(f.get('title') || ''),
                contactInfo: String(f.get('contactInfo') || ''),
                settlementMethod: String(f.get('settlementMethod') || 'DIRECT'),
                isActive: f.get('isActive') === 'on',
                note: String(f.get('note') || ''),
              }), draft ? 'بنیاد به‌روز شد' : 'بنیاد ساخته شد', () => setEditingSponsor(null));
              e.currentTarget.reset();
            }}
            className="rounded-lg border border-slate-200 p-3"
          >
            <h4 className="mb-2 text-xs font-bold text-slate-800">
              {editingSponsor ? `ویرایش: ${editingSponsor.title}` : 'افزودن بنیاد / نهاد حامی'}
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className={labelCls}>کد *<input name="code" required defaultValue={editingSponsor?.code} placeholder="EMDAD" className={inputCls} /></label>
              <label className={`${labelCls} sm:col-span-2`}>عنوان *<input name="title" required defaultValue={editingSponsor?.title} placeholder="کمیتهٔ امداد امام خمینی" className={inputCls} /></label>
              <label className={labelCls}>
                نحوهٔ تسویه
                <select name="settlementMethod" defaultValue={editingSponsor?.settlementMethod || 'DIRECT'} className={inputCls}>
                  <option value="DIRECT">پرداخت مستقیم به دانشگاه</option>
                  <option value="REIMBURSE">پرداخت دانشجو و بازپرداخت بنیاد</option>
                </select>
              </label>
              <label className={`${labelCls} sm:col-span-2`}>اطلاعات تماس<input name="contactInfo" defaultValue={editingSponsor?.contactInfo ?? ''} className={inputCls} /></label>
              <label className={`${labelCls} sm:col-span-2`}>یادداشت<input name="note" defaultValue={editingSponsor?.note ?? ''} className={inputCls} /></label>
              <label className="flex items-end gap-1.5 pb-1.5 text-2xs text-slate-700">
                <input type="checkbox" name="isActive" defaultChecked={editingSponsor?.isActive ?? true} className="accent-emerald-700" />
                فعال
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button type="submit" disabled={pending} className={btnCls}>{editingSponsor ? 'ذخیرهٔ تغییرات' : 'افزودن'}</button>
              {editingSponsor && <button type="button" onClick={() => setEditingSponsor(null)} className={ghostBtn}>انصراف</button>}
            </div>
          </form>

          {props.sponsors.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">هنوز بنیادی تعریف نشده است.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs rt">
                <thead>
                  <tr className="border-b border-slate-200 text-2xs text-slate-500">
                    <th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2">تسویه</th>
                    <th className="p-2">تماس</th><th className="p-2">وضعیت</th><th className="p-2">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {props.sponsors.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0">
                      <td className="p-2 text-slate-500">{s.code}</td>
                      <td className="p-2 font-medium text-slate-800">{s.title}</td>
                      <td className="p-2 text-slate-600">{s.settlementMethod === 'REIMBURSE' ? 'بازپرداخت' : 'مستقیم'}</td>
                      <td className="p-2 text-slate-500">{s.contactInfo || '—'}</td>
                      <td className="p-2">
                        <span className={`rounded px-1.5 py-0.5 text-3xs ${s.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {s.isActive ? 'فعال' : 'غیرفعال'}
                        </span>
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <button onClick={() => setEditingSponsor(s)} className={ghostBtn}>ویرایش</button>
                          <button disabled={pending} onClick={() => run(() => deleteSponsorAction(s.id), 'حذف شد')} className={ghostBtn}>حذف</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ فرمول تخصیص ═══ */}
      {tab === 'formula' && (
        <div className="card space-y-4">
          <form
            key={editingFormula?.id ?? 'new-formula'}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const draft = editingFormula;
              const intOr = (v: FormDataEntryValue | null) => (v === '' || v === null ? null : Number(v));
              run(() => saveFormulaAction({
                id: draft?.id,
                code: String(f.get('code') || ''),
                title: String(f.get('title') || ''),
                degreeLevelId: intOr(f.get('degreeLevelId')),
                majorId: intOr(f.get('majorId')),
                entryYearFrom: intOr(f.get('entryYearFrom')),
                entryYearTo: intOr(f.get('entryYearTo')),
                fixedAmount: Number(f.get('fixedAmount')) || 0,
                perUnitTheory: Number(f.get('perUnitTheory')) || 0,
                perUnitPractical: Number(f.get('perUnitPractical')) || 0,
                perUnitGeneral: Number(f.get('perUnitGeneral')) || 0,
                priority: Number(f.get('priority')) || 100,
                isActive: f.get('isActive') === 'on',
                note: String(f.get('note') || ''),
              }), draft ? 'فرمول به‌روز شد' : 'فرمول ساخته شد', () => setEditingFormula(null));
              e.currentTarget.reset();
            }}
            className="rounded-lg border border-slate-200 p-3"
          >
            <h4 className="mb-2 text-xs font-bold text-slate-800">
              {editingFormula ? `ویرایش: ${editingFormula.title}` : 'افزودن فرمول تخصیص'}
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className={labelCls}>کد *<input name="code" required defaultValue={editingFormula?.code} className={inputCls} /></label>
              <label className={`${labelCls} sm:col-span-2`}>عنوان *<input name="title" required defaultValue={editingFormula?.title} className={inputCls} /></label>
              <label className={labelCls}>
                مقطع (خالی = همه)
                <select name="degreeLevelId" defaultValue={editingFormula?.degreeLevelId ?? ''} className={inputCls}>
                  <option value="">همهٔ مقاطع</option>
                  {props.degrees.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              </label>
              <label className={labelCls}>
                رشته (خالی = همه)
                <select name="majorId" defaultValue={editingFormula?.majorId ?? ''} className={inputCls}>
                  <option value="">همهٔ رشته‌ها</option>
                  {props.majorsOptions.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </label>
              <label className={labelCls}>اولویت (کوچک‌تر = بالاتر)<input name="priority" type="number" defaultValue={editingFormula?.priority ?? 100} className={inputCls} /></label>
              <label className={labelCls}>ورودی از<input name="entryYearFrom" type="number" defaultValue={editingFormula?.entryYearFrom ?? ''} className={inputCls} /></label>
              <label className={labelCls}>ورودی تا<input name="entryYearTo" type="number" defaultValue={editingFormula?.entryYearTo ?? ''} className={inputCls} /></label>
              <label className={labelCls}>شهریهٔ ثابت (ریال)<input name="fixedAmount" type="number" min={0} defaultValue={editingFormula?.fixedAmount ?? 0} className={inputCls} /></label>
              <label className={labelCls}>هر واحد نظری<input name="perUnitTheory" type="number" min={0} defaultValue={editingFormula?.perUnitTheory ?? 0} className={inputCls} /></label>
              <label className={labelCls}>هر واحد عملی<input name="perUnitPractical" type="number" min={0} defaultValue={editingFormula?.perUnitPractical ?? 0} className={inputCls} /></label>
              <label className={labelCls}>هر واحد عمومی<input name="perUnitGeneral" type="number" min={0} defaultValue={editingFormula?.perUnitGeneral ?? 0} className={inputCls} /></label>
              <label className={`${labelCls} sm:col-span-2`}>یادداشت<input name="note" defaultValue={editingFormula?.note ?? ''} className={inputCls} /></label>
              <label className="flex items-end gap-1.5 pb-1.5 text-2xs text-slate-700">
                <input type="checkbox" name="isActive" defaultChecked={editingFormula?.isActive ?? true} className="accent-emerald-700" />
                فعال
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button type="submit" disabled={pending} className={btnCls}>{editingFormula ? 'ذخیرهٔ تغییرات' : 'افزودن'}</button>
              {editingFormula && <button type="button" onClick={() => setEditingFormula(null)} className={ghostBtn}>انصراف</button>}
            </div>
          </form>

          {props.formulas.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">هنوز فرمولی تعریف نشده است.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs rt">
                <thead>
                  <tr className="border-b border-slate-200 text-2xs text-slate-500">
                    <th className="p-2">اولویت</th><th className="p-2">عنوان</th><th className="p-2">مقطع</th>
                    <th className="p-2">رشته</th><th className="p-2">ورودی</th><th className="p-2">ثابت</th>
                    <th className="p-2">نظری</th><th className="p-2">عملی</th><th className="p-2">عمومی</th>
                    <th className="p-2">وضعیت</th><th className="p-2">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {props.formulas.map((f) => (
                    <tr key={f.id} className="border-b border-slate-100 last:border-0">
                      <td className="p-2 text-slate-600">{fa(f.priority)}</td>
                      <td className="p-2 font-medium text-slate-800">{f.title}<span className="mr-1 text-3xs text-slate-400">{f.code}</span></td>
                      <td className="p-2 text-slate-600">{f.degreeLevelId ? props.degrees.find((d) => d.id === f.degreeLevelId)?.title || '—' : 'همه'}</td>
                      <td className="p-2 text-slate-600">{f.majorId ? props.majorsOptions.find((m) => m.id === f.majorId)?.title || '—' : 'همه'}</td>
                      <td className="p-2 text-slate-600">
                        {f.entryYearFrom || f.entryYearTo
                          ? `${f.entryYearFrom ? fa(f.entryYearFrom) : '…'} تا ${f.entryYearTo ? fa(f.entryYearTo) : '…'}`
                          : 'همه'}
                      </td>
                      <td className="p-2">{fa(f.fixedAmount)}</td>
                      <td className="p-2">{fa(f.perUnitTheory)}</td>
                      <td className="p-2">{fa(f.perUnitPractical)}</td>
                      <td className="p-2">{fa(f.perUnitGeneral)}</td>
                      <td className="p-2">
                        <span className={`rounded px-1.5 py-0.5 text-3xs ${f.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {f.isActive ? 'فعال' : 'غیرفعال'}
                        </span>
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <button onClick={() => setEditingFormula(f)} className={ghostBtn}>ویرایش</button>
                          <button disabled={pending} onClick={() => run(() => deleteFormulaAction(f.id), 'حذف شد')} className={ghostBtn}>حذف</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ وام‌ها ═══ */}
      {tab === 'loan' && (
        <div className="card space-y-4">
          <form
            key={editingLoan?.id ?? 'new-loan'}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const draft = editingLoan;
              run(() => saveLoanProductAction({
                id: draft?.id,
                code: String(f.get('code') || ''),
                title: String(f.get('title') || ''),
                lender: String(f.get('lender') || ''),
                maxAmount: f.get('maxAmount') === '' ? null : Number(f.get('maxAmount')),
                defaultAmount: Number(f.get('defaultAmount')) || 0,
                defaultInstallments: Number(f.get('defaultInstallments')) || 1,
                isInterestFree: f.get('isInterestFree') === 'on',
                requiresApproval: f.get('requiresApproval') === 'on',
                isActive: f.get('isActive') === 'on',
                note: String(f.get('note') || ''),
              }), draft ? 'نوع وام به‌روز شد' : 'نوع وام ساخته شد', () => setEditingLoan(null));
              e.currentTarget.reset();
            }}
            className="rounded-lg border border-slate-200 p-3"
          >
            <h4 className="mb-2 text-xs font-bold text-slate-800">
              {editingLoan ? `ویرایش: ${editingLoan.title}` : 'افزودن نوع وام'}
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className={labelCls}>کد *<input name="code" required defaultValue={editingLoan?.code} placeholder="REF_WELFARE" className={inputCls} /></label>
              <label className={`${labelCls} sm:col-span-2`}>عنوان *<input name="title" required defaultValue={editingLoan?.title} placeholder="وام صندوق رفاه دانشجویان" className={inputCls} /></label>
              <label className={labelCls}>نهاد پرداخت‌کننده *<input name="lender" required defaultValue={editingLoan?.lender} className={inputCls} /></label>
              <label className={labelCls}>سقف مبلغ مجاز (خالی = بدون سقف)<input name="maxAmount" type="number" min={0} defaultValue={editingLoan?.maxAmount ?? ''} className={inputCls} /></label>
              <label className={labelCls}>مبلغ پیش‌فرض (ریال)<input name="defaultAmount" type="number" min={0} defaultValue={editingLoan?.defaultAmount ?? 0} className={inputCls} /></label>
              <label className={labelCls}>تعداد اقساط پیش‌فرض<input name="defaultInstallments" type="number" min={1} defaultValue={editingLoan?.defaultInstallments ?? 1} className={inputCls} /></label>
              <label className={`${labelCls} sm:col-span-2`}>یادداشت<input name="note" defaultValue={editingLoan?.note ?? ''} className={inputCls} /></label>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
                <label className="flex items-center gap-1.5 text-2xs text-slate-700">
                  <input type="checkbox" name="isInterestFree" defaultChecked={editingLoan?.isInterestFree ?? true} className="accent-emerald-700" />
                  بدون کارمزد
                </label>
                <label className="flex items-center gap-1.5 text-2xs text-slate-700">
                  <input type="checkbox" name="requiresApproval" defaultChecked={editingLoan?.requiresApproval ?? true} className="accent-emerald-700" />
                  نیازمند تأیید
                </label>
                <label className="flex items-center gap-1.5 text-2xs text-slate-700">
                  <input type="checkbox" name="isActive" defaultChecked={editingLoan?.isActive ?? true} className="accent-emerald-700" />
                  فعال
                </label>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button type="submit" disabled={pending} className={btnCls}>{editingLoan ? 'ذخیرهٔ تغییرات' : 'افزودن'}</button>
              {editingLoan && <button type="button" onClick={() => setEditingLoan(null)} className={ghostBtn}>انصراف</button>}
            </div>
          </form>

          {props.loanProducts.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">هنوز نوع وامی تعریف نشده است.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs rt">
                <thead>
                  <tr className="border-b border-slate-200 text-2xs text-slate-500">
                    <th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2">نهاد</th>
                    <th className="p-2">پیش‌فرض</th><th className="p-2">سقف</th><th className="p-2">اقساط</th>
                    <th className="p-2">کارمزد</th><th className="p-2">وضعیت</th><th className="p-2">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {props.loanProducts.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100 last:border-0">
                      <td className="p-2 text-slate-500">{l.code}</td>
                      <td className="p-2 font-medium text-slate-800">{l.title}</td>
                      <td className="p-2 text-slate-600">{l.lender}</td>
                      <td className="p-2">{fa(l.defaultAmount)}</td>
                      <td className="p-2 text-slate-500">{l.maxAmount === null ? '—' : fa(l.maxAmount)}</td>
                      <td className="p-2">{fa(l.defaultInstallments)}</td>
                      <td className="p-2 text-slate-600">{l.isInterestFree ? 'ندارد' : 'دارد'}</td>
                      <td className="p-2">
                        <span className={`rounded px-1.5 py-0.5 text-3xs ${l.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {l.isActive ? 'فعال' : 'غیرفعال'}
                        </span>
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <button onClick={() => setEditingLoan(l)} className={ghostBtn}>ویرایش</button>
                          <button disabled={pending} onClick={() => run(() => deleteLoanProductAction(l.id), 'حذف شد')} className={ghostBtn}>حذف</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ ضریب افزایشی نیمسال ═══ */}
      {tab === 'coefficient' && (
        <CoefficientTab
          coefficients={props.coefficients}
          terms={props.terms}
          editing={editingCoefficient}
          setEditing={setEditingCoefficient}
          pending={pending}
          run={run}
        />
      )}

      {/* ═══ مبالغ موضوعی ═══ */}
      {tab === 'subjectFee' && (
        <SubjectFeeTab
          subjectFeeTypes={props.subjectFeeTypes}
          editing={editingSubjectFee}
          setEditing={setEditingSubjectFee}
          pending={pending}
          run={run}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  تب ضریب افزایشی نیمسال
// ═══════════════════════════════════════════════════════════════

function CoefficientTab(props: {
  coefficients: Coefficient[];
  terms: Term[];
  editing: Coefficient | null;
  setEditing: (c: Coefficient | null) => void;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string, after?: () => void) => void;
}) {
  const [form, setForm] = useState({
    termId: '',
    variableCoefficient: '1.00',
    fixedCoefficient: '1.00',
    note: '',
  });

  const usedTermIds = new Set(props.coefficients.map((c) => c.termId));
  const availableTerms = props.terms.filter((t) => !usedTermIds.has(t.id) || t.id === props.editing?.termId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const termId = Number(f.get('termId'));
    const data = {
      termId,
      variableCoefficient: Number(f.get('variableCoefficient')) || 1,
      fixedCoefficient: Number(f.get('fixedCoefficient')) || 1,
      note: String(f.get('note') || ''),
    };
    props.run(
      async () => {
        const res = await fetch('/admin/finance/coefficients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const r = await res.json();
        return r;
      },
      props.editing ? 'ضریب به‌روز شد' : 'ضریب اضافه شد',
      () => { props.setEditing(null); (e.currentTarget as HTMLFormElement).reset(); }
    );
  };

  const handleDelete = (id: number) => {
    props.run(
      async () => {
        const res = await fetch(`/admin/finance/coefficients?id=${id}`, { method: 'DELETE' });
        return res.json();
      },
      'ضریب حذف شد'
    );
  };

  return (
    <div className="card space-y-4">
      <form
        key={props.editing?.id ?? 'new-coeff'}
        onSubmit={handleSubmit}
        className="rounded-lg border border-slate-200 p-3"
      >
        <h4 className="mb-2 text-xs font-bold text-slate-800">
          {props.editing ? `ویرایش ضریب ترم «${props.editing.termTitle || props.editing.termCode}»` : 'افزودن ضریب افزایشی نیمسال'}
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className={labelCls}>
            نیمسال *
            <select name="termId" defaultValue={props.editing?.termId ?? ''} className={inputCls} disabled={!!props.editing}>
              <option value="">— انتخاب —</option>
              {availableTerms.map((t) => (
                <option key={t.id} value={t.id}>{t.termTitle}</option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            ضریب شهریه متغیر *
            <input name="variableCoefficient" type="number" min={0.5} max={5} step={0.01}
              defaultValue={props.editing?.variableCoefficient ?? 1.00} className={inputCls} />
          </label>
          <label className={labelCls}>
            ضریب شهریه ثابت *
            <input name="fixedCoefficient" type="number" min={0.5} max={5} step={0.01}
              defaultValue={props.editing?.fixedCoefficient ?? 1.00} className={inputCls} />
          </label>
          <label className={labelCls}>یادداشت<input name="note" defaultValue={props.editing?.note ?? ''} className={inputCls} /></label>
        </div>
        <p className="mt-1 text-2xs text-slate-500">
          ضریب ۱.۰۰ = بدون تغییر. مثلاً ۱.۱۰ = افزایش ۱۰٪ نسبت به نیمسال قبل.
        </p>
        <div className="mt-3 flex gap-2">
          <button type="submit" disabled={props.pending} className={btnCls}>
            {props.editing ? 'ذخیرهٔ تغییرات' : 'افزودن'}
          </button>
          {props.editing && (
            <button type="button" onClick={() => props.setEditing(null)} className={ghostBtn}>انصراف</button>
          )}
        </div>
      </form>

      {props.coefficients.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500">
          هنوز ضریب افزایشی برای هیچ نیمسالی تعریف نشده است. ضریب پیش‌فرض ۱.۰۰ (بدون تغییر) اعمال می‌شود.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs rt">
            <thead>
              <tr className="border-b border-slate-200 text-2xs text-slate-500">
                <th className="p-2">نیمسال</th><th className="p-2">ضریب متغیر</th><th className="p-2">ضریب ثابت</th>
                <th className="p-2">یادداشت</th><th className="p-2">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {props.coefficients.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0">
                  <td className="p-2 font-medium text-slate-800">{c.termTitle || c.termCode || `ترم ${c.termId}`}</td>
                  <td className="p-2">{c.variableCoefficient.toFixed(2)}</td>
                  <td className="p-2">{c.fixedCoefficient.toFixed(2)}</td>
                  <td className="p-2 text-slate-500">{c.note || '—'}</td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <button onClick={() => props.setEditing(c)} className={ghostBtn}>ویرایش</button>
                      <button disabled={props.pending} onClick={() => handleDelete(c.id)} className={ghostBtn}>حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  تب مبالغ موضوعی
// ═══════════════════════════════════════════════════════════════

function SubjectFeeTab(props: {
  subjectFeeTypes: SubjectFeeType[];
  editing: SubjectFeeType | null;
  setEditing: (s: SubjectFeeType | null) => void;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string, after?: () => void) => void;
}) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const data = {
      id: props.editing?.id,
      code: String(f.get('code') || ''),
      title: String(f.get('title') || ''),
      kind: String(f.get('kind') || 'ADDITIVE'),
      fixedAmount: Number(f.get('fixedAmount')) || 0,
      variablePercent: Number(f.get('variablePercent')) || 0,
      appliesTo: String(f.get('appliesTo') || 'BOTH'),
      isActive: f.get('isActive') === 'on',
      note: String(f.get('note') || ''),
    };
    props.run(
      async () => {
        const res = await fetch('/admin/finance/subject-fees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        return res.json();
      },
      props.editing ? 'نوع مبلغ به‌روز شد' : 'نوع مبلغ اضافه شد',
      () => { props.setEditing(null); (e.currentTarget as HTMLFormElement).reset(); }
    );
  };

  const handleDelete = (id: number) => {
    props.run(
      async () => {
        const res = await fetch(`/admin/finance/subject-fees?id=${id}`, { method: 'DELETE' });
        return res.json();
      },
      'نوع مبلغ حذف شد'
    );
  };

  return (
    <div className="card space-y-4">
      <form
        key={props.editing?.id ?? 'new-subject-fee'}
        onSubmit={handleSubmit}
        className="rounded-lg border border-slate-200 p-3"
      >
        <h4 className="mb-2 text-xs font-bold text-slate-800">
          {props.editing ? `ویرایش: ${props.editing.title}` : 'افزودن نوع مبلغ موضوعی'}
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className={labelCls}>کد *<input name="code" required defaultValue={props.editing?.code} placeholder="INSURANCE" className={inputCls} /></label>
          <label className={`${labelCls} sm:col-span-2`}>عنوان *<input name="title" required defaultValue={props.editing?.title} placeholder="هزینه بیمه دانشجویی" className={inputCls} /></label>
          <label className={labelCls}>
            نوع
            <select name="kind" defaultValue={props.editing?.kind || 'ADDITIVE'} className={inputCls}>
              <option value="ADDITIVE">افزایشی (+)</option>
              <option value="DEDUCTIVE">کاهشی (-)</option>
            </select>
          </label>
          <label className={labelCls}>مبلغ ثابت (ریال)<input name="fixedAmount" type="number" min={0} defaultValue={props.editing?.fixedAmount ?? 0} className={inputCls} /></label>
          <label className={labelCls}>درصد از شهریه متغیر<input name="variablePercent" type="number" min={0} max={100} step={0.5} defaultValue={props.editing?.variablePercent ?? 0} className={inputCls} /></label>
          <label className={labelCls}>
            روی چه بخشی اثر بگذارد
            <select name="appliesTo" defaultValue={props.editing?.appliesTo || 'BOTH'} className={inputCls}>
              <option value="BOTH">هر دو (ثابت + متغیر)</option>
              <option value="FIXED">فقط شهریه ثابت</option>
              <option value="VARIABLE">فقط شهریه متغیر</option>
            </select>
          </label>
          <label className={`${labelCls} sm:col-span-2`}>یادداشت<input name="note" defaultValue={props.editing?.note ?? ''} className={inputCls} /></label>
          <label className="flex items-end gap-1.5 pb-1.5 text-2xs text-slate-700">
            <input type="checkbox" name="isActive" defaultChecked={props.editing?.isActive ?? true} className="accent-emerald-700" />
            فعال
          </label>
        </div>
        <p className="mt-1 text-2xs text-slate-500">
          مثال: هزینه بیمه = ۵۰,۰۰۰ ریال ثابت. حق نظارت = ۲٪ از شهریه متغیر.
        </p>
        <div className="mt-3 flex gap-2">
          <button type="submit" disabled={props.pending} className={btnCls}>
            {props.editing ? 'ذخیرهٔ تغییرات' : 'افزودن'}
          </button>
          {props.editing && (
            <button type="button" onClick={() => props.setEditing(null)} className={ghostBtn}>انصراف</button>
          )}
        </div>
      </form>

      {props.subjectFeeTypes.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500">
          هنوز هیچ نوع مبلغ موضوعی تعریف نشده است. نمونه: هزینه بیمه، حق نظارت، هزینه کارگاه.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs rt">
            <thead>
              <tr className="border-b border-slate-200 text-2xs text-slate-500">
                <th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2">نوع</th>
                <th className="p-2">مبلغ ثابت</th><th className="p-2">درصد متغیر</th><th className="p-2">اعمال روی</th>
                <th className="p-2">وضعیت</th><th className="p-2">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {props.subjectFeeTypes.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-0">
                  <td className="p-2 text-slate-500">{s.code}</td>
                  <td className="p-2 font-medium text-slate-800">{s.title}</td>
                  <td className="p-2">
                    <span className={`rounded px-1.5 py-0.5 text-3xs ${s.kind === 'ADDITIVE' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
                      {s.kind === 'ADDITIVE' ? 'افزایشی' : 'کاهشی'}
                    </span>
                  </td>
                  <td className="p-2">{fa(s.fixedAmount)}</td>
                  <td className="p-2">{s.variablePercent > 0 ? `${s.variablePercent}٪` : '—'}</td>
                  <td className="p-2 text-slate-600">{s.appliesTo === 'BOTH' ? 'ثابت+متغیر' : s.appliesTo === 'FIXED' ? 'ثابت' : 'متغیر'}</td>
                  <td className="p-2">
                    <span className={`rounded px-1.5 py-0.5 text-3xs ${s.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                      {s.isActive ? 'فعال' : 'غیرفعال'}
                    </span>
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <button onClick={() => props.setEditing(s)} className={ghostBtn}>ویرایش</button>
                      <button disabled={props.pending} onClick={() => handleDelete(s.id)} className={ghostBtn}>حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
