'use client';

import { useState, useTransition } from 'react';
import {
  addChequeAction, addDiscountAction, addLoanAction, addSponsorshipAction,
  chargeByFormulaAction, clearChequeAction, deleteChequeAction, deleteDiscountAction,
  deleteLoanAction, deleteSponsorshipAction, recordLedgerAction,
  setChequeStatusAction, setDiscountStatusAction, setLoanStatusAction,
  setSponsorshipStatusAction,
} from '../../actions';

type DiscountType = {
  id: number; title: string; kind: string;
  defaultPercent: number; defaultAmount: number; maxPercent: number | null;
};
type Sponsor = { id: number; title: string };
type DiscountRow = {
  id: number; typeTitle: string | null; kind: string;
  percent: number; amount: number; status: string; termId: number | null; reason: string | null;
};
type SponsorshipRow = {
  id: number; sponsorTitle: string | null; coverageKind: string;
  percent: number; amount: number; status: string; termId: number | null; referenceNo: string | null;
};
type ChequeRow = {
  id: number; chequeNo: string | null; bankName: string | null;
  amount: number; status: string; dueDate: string | null; remindedAt: string | null;
};
type LoanRow = {
  id: number; lender: string; loanCode: string | null;
  amount: number; installments: number; status: string;
  productTitle: string | null;
};
type LoanProduct = {
  id: number; code: string; title: string; lender: string;
  maxAmount: number | null; defaultAmount: number; defaultInstallments: number;
};
type FormulaInfo = {
  termTitle: string; formulaTitle: string | null;
  buckets: { theory: number; practical: number; general: number };
  fixed: number; variable: number; total: number; termId: number | null;
};
type EnhancedTuition = {
  fixedTuition: number; variableTuition: number;
  fixedCoefficient: number; variableCoefficient: number;
  fixedTuitionAfterCoeff: number; variableTuitionAfterCoeff: number;
  subjectFees: { code: string; title: string; kind: string; amount: number }[];
  subjectFeesTotal: number; totalTuition: number;
  overrideId: number | null; overrideReason: string | null;
};

const fa = (n: number) => Number(n || 0).toLocaleString('fa-IR');

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500';
const labelCls = 'flex flex-col gap-1 text-2xs font-medium text-slate-600';
const btnCls =
  'rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50';
const smBtn =
  'rounded border px-1.5 py-0.5 text-2xs font-medium transition-colors';

export default function FinanceStudentClient(props: {
  studentId: number;
  terms: { id: number; termCode: string; termTitle: string; isCurrent: number | null }[];
  discountTypes: DiscountType[];
  sponsors: Sponsor[];
  discounts: DiscountRow[];
  sponsorships: SponsorshipRow[];
  cheques: ChequeRow[];
  loans: LoanRow[];
  loanProducts: LoanProduct[];
  welfareFunds: { id: number; title: string }[];
  formula: FormulaInfo | null;
  enhancedTuition: EnhancedTuition | null;
}) {
  const { studentId, terms } = props;
  const [tab, setTab] = useState<'discount' | 'sponsor' | 'cheque' | 'loan' | 'ledger'>('discount');
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const termName = (id: number | null) =>
    id === null ? 'همهٔ ترم‌ها' : terms.find((t) => t.id === id)?.termTitle || `ترم ${id}`;

  function run(fn: () => Promise<{ ok: boolean; error?: string; amount?: number }>, okText: string) {
    setMsg(null);
    startTransition(async () => {
      try {
        const r = await fn();
        setMsg(r.ok
          ? { ok: true, text: r.amount ? `${okText} — مبلغ ${fa(r.amount)} ریال` : okText }
          : { ok: false, text: r.error || 'عملیات ناموفق بود' });
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : 'خطای ناشناخته' });
      }
    });
  }

  const selectedType = props.discountTypes.find((d) => d.id === Number(discountTypeId));
  const [loanProductId, setLoanProductId] = useState<string>('');
  const selectedLoan = props.loanProducts.find((l) => l.id === Number(loanProductId));
  const [discountTypeId, setDiscountTypeId] = useState<string>(
    props.discountTypes[0] ? String(props.discountTypes[0].id) : ''
  );

  const tabs = [
    { id: 'discount', label: '🎖️ تخفیف شهریه' },
    { id: 'sponsor', label: '🏛️ پوشش بنیادها' },
    { id: 'cheque', label: '🧾 چک‌ها' },
    { id: 'loan', label: '💰 وام' },
    { id: 'ledger', label: '🧮 فرمول و پرداخت' },
  ] as const;

  return (
    <div className="card space-y-4 print:hidden">
      <div className="flex flex-wrap gap-1 border-b border-slate-100 pb-2">
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

      {/* ═══ تخفیف ═══ */}
      {tab === 'discount' && (
        <div className="space-y-4">
          {props.discountTypes.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              هنوز هیچ نوع تخفیفی تعریف نشده است. ابتدا از «⚙️ انواع تخفیف، بنیادها و فرمول‌ها» نوع تخفیف بسازید
              (مثلاً رتبهٔ برتر، قهرمان ورزشی، فعال فرهنگی).
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(() => addDiscountAction({
                  studentId,
                  termId: f.get('termId') ? Number(f.get('termId')) : null,
                  discountTypeId: Number(f.get('discountTypeId')),
                  percent: Number(f.get('percent')) || 0,
                  amount: Number(f.get('amount')) || 0,
                  appliesTo: 'BOTH',
                  reason: String(f.get('reason') || ''),
                }), 'تخفیف ثبت شد');
                e.currentTarget.reset();
              }}
              className="rounded-lg border border-slate-200 p-3"
            >
              <h4 className="mb-2 text-xs font-bold text-slate-800">افزودن تخفیف</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className={labelCls}>
                  نوع تخفیف
                  <select name="discountTypeId" value={discountTypeId}
                    onChange={(e) => setDiscountTypeId(e.target.value)} className={inputCls}>
                    {props.discountTypes.map((d) => (
                      <option key={d.id} value={d.id}>{d.title}</option>
                    ))}
                  </select>
                </label>
                <label className={labelCls}>
                  ترم
                  <select name="termId" className={inputCls}>
                    <option value="">همهٔ ترم‌ها</option>
                    {terms.map((t) => <option key={t.id} value={t.id}>{t.termTitle}</option>)}
                  </select>
                </label>
                {selectedType?.kind === 'PERCENT' ? (
                  <label className={labelCls}>
                    درصد{selectedType.maxPercent !== null ? ` (سقف ${fa(selectedType.maxPercent)}٪)` : ''}
                    <input name="percent" type="number" min={0} max={selectedType.maxPercent ?? 100}
                      step="0.5" defaultValue={selectedType.defaultPercent} className={inputCls} />
                  </label>
                ) : (
                  <label className={labelCls}>
                    مبلغ (ریال)
                    <input name="amount" type="number" min={0} defaultValue={selectedType?.defaultAmount ?? 0} className={inputCls} />
                  </label>
                )}
                <label className={`${labelCls} sm:col-span-2`}>
                  دلیل / مستندات
                  <input name="reason" placeholder="مثلاً رتبهٔ اول ورودی، قهرمانی کشوری…" className={inputCls} />
                </label>
              </div>
              <button type="submit" disabled={pending} className={`${btnCls} mt-3`}>ثبت تخفیف</button>
            </form>
          )}

          {props.discounts.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs rt rt--scroll">
                <thead>
                  <tr className="border-b border-slate-200 text-2xs text-slate-500">
                    <th className="p-2">نوع</th><th className="p-2">ترم</th><th className="p-2">مقدار</th>
                    <th className="p-2">وضعیت</th><th className="p-2">دلیل</th><th className="p-2">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {props.discounts.map((d) => (
                    <tr key={d.id} className="border-b border-slate-100 last:border-0">
                      <td className="p-2 text-slate-800">{d.typeTitle || '—'}</td>
                      <td className="p-2 text-slate-600">{termName(d.termId)}</td>
                      <td className="p-2">{d.kind === 'PERCENT' ? `${fa(d.percent)}٪` : fa(d.amount)}</td>
                      <td className="p-2">
                        <span className={`rounded px-1.5 py-0.5 text-3xs ${
                          d.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' :
                          d.status === 'REJECTED' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                          {d.status === 'APPROVED' ? 'تأییدشده' : d.status === 'REJECTED' ? 'ردشده' : 'در انتظار تأیید'}
                        </span>
                      </td>
                      <td className="p-2 text-slate-500">{d.reason || '—'}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {d.status !== 'APPROVED' && (
                            <button disabled={pending} onClick={() => run(() => setDiscountStatusAction(d.id, 'APPROVED'), 'تخفیف تأیید شد')}
                              className={`${smBtn} border-emerald-300 bg-emerald-50 text-emerald-700`}>تأیید</button>
                          )}
                          {d.status !== 'REJECTED' && (
                            <button disabled={pending} onClick={() => run(() => setDiscountStatusAction(d.id, 'REJECTED'), 'تخفیف رد شد')}
                              className={`${smBtn} border-rose-300 bg-rose-50 text-rose-700`}>رد</button>
                          )}
                          <button disabled={pending} onClick={() => run(() => deleteDiscountAction(d.id), 'تخفیف حذف شد')}
                            className={`${smBtn} border-slate-300 bg-slate-50 text-slate-600`}>حذف</button>
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
        <div className="space-y-4">
          {props.sponsors.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              هنوز هیچ بنیادی تعریف نشده است. ابتدا از «⚙️ انواع تخفیف، بنیادها و فرمول‌ها» بنیاد بسازید
              (مثلاً کمیتهٔ امداد، بنیاد شهید).
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(() => addSponsorshipAction({
                  studentId,
                  termId: f.get('termId') ? Number(f.get('termId')) : null,
                  sponsorId: Number(f.get('sponsorId')),
                  coverageKind: String(f.get('coverageKind')),
                  percent: Number(f.get('percent')) || 0,
                  amount: Number(f.get('amount')) || 0,
                  appliesTo: 'BOTH',
                  referenceNo: String(f.get('referenceNo') || ''),
                }), 'پوشش بنیاد ثبت شد');
                e.currentTarget.reset();
              }}
              className="rounded-lg border border-slate-200 p-3"
            >
              <h4 className="mb-2 text-xs font-bold text-slate-800">ثبت پوشش بنیاد</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className={labelCls}>
                  بنیاد / نهاد
                  <select name="sponsorId" className={inputCls}>
                    {props.sponsors.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </label>
                <label className={labelCls}>
                  ترم
                  <select name="termId" className={inputCls}>
                    <option value="">همهٔ ترم‌ها</option>
                    {terms.map((t) => <option key={t.id} value={t.id}>{t.termTitle}</option>)}
                  </select>
                </label>
                <label className={labelCls}>
                  نحوهٔ پوشش
                  <select name="coverageKind" className={inputCls}>
                    <option value="PERCENT">درصدی از شهریه</option>
                    <option value="FIXED">مبلغ ثابت</option>
                  </select>
                </label>
                <label className={labelCls}>
                  درصد
                  <input name="percent" type="number" min={0} max={100} step="0.5" className={inputCls} />
                </label>
                <label className={labelCls}>
                  مبلغ (ریال)
                  <input name="amount" type="number" min={0} className={inputCls} />
                </label>
                <label className={labelCls}>
                  شمارهٔ نامه / معرفی‌نامه
                  <input name="referenceNo" className={inputCls} />
                </label>
              </div>
              <button type="submit" disabled={pending} className={`${btnCls} mt-3`}>ثبت پوشش</button>
            </form>
          )}

          {props.sponsorships.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs rt rt--scroll">
                <thead>
                  <tr className="border-b border-slate-200 text-2xs text-slate-500">
                    <th className="p-2">بنیاد</th><th className="p-2">ترم</th><th className="p-2">پوشش</th>
                    <th className="p-2">شمارهٔ نامه</th><th className="p-2">وضعیت</th><th className="p-2">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {props.sponsorships.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0">
                      <td className="p-2 text-slate-800">{s.sponsorTitle || '—'}</td>
                      <td className="p-2 text-slate-600">{termName(s.termId)}</td>
                      <td className="p-2">{s.coverageKind === 'PERCENT' ? `${fa(s.percent)}٪` : fa(s.amount)}</td>
                      <td className="p-2 text-slate-500">{s.referenceNo || '—'}</td>
                      <td className="p-2">
                        <span className={`rounded px-1.5 py-0.5 text-3xs ${
                          s.status === 'PAID' ? 'bg-emerald-50 text-emerald-700' :
                          s.status === 'CONFIRMED' ? 'bg-sky-50 text-sky-700' :
                          s.status === 'REJECTED' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                          {s.status === 'PAID' ? 'پرداخت‌شده' : s.status === 'CONFIRMED' ? 'تأییدشده' :
                           s.status === 'REJECTED' ? 'ردشده' : 'در انتظار'}
                        </span>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          <button disabled={pending} onClick={() => run(() => setSponsorshipStatusAction(s.id, 'CONFIRMED'), 'پوشش تأیید شد')}
                            className={`${smBtn} border-sky-300 bg-sky-50 text-sky-700`}>تأیید</button>
                          <button disabled={pending} onClick={() => run(() => setSponsorshipStatusAction(s.id, 'PAID'), 'پرداخت ثبت شد')}
                            className={`${smBtn} border-emerald-300 bg-emerald-50 text-emerald-700`}>پرداخت</button>
                          <button disabled={pending} onClick={() => run(() => setSponsorshipStatusAction(s.id, 'REJECTED'), 'پوشش رد شد')}
                            className={`${smBtn} border-rose-300 bg-rose-50 text-rose-700`}>رد</button>
                          <button disabled={pending} onClick={() => run(() => deleteSponsorshipAction(s.id), 'پوشش حذف شد')}
                            className={`${smBtn} border-slate-300 bg-slate-50 text-slate-600`}>حذف</button>
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

      {/* ═══ چک ═══ */}
      {tab === 'cheque' && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(() => addChequeAction({
                studentId,
                termId: f.get('termId') ? Number(f.get('termId')) : null,
                chequeNo: String(f.get('chequeNo') || ''),
                bankName: String(f.get('bankName') || ''),
                branchCode: String(f.get('branchCode') || ''),
                amount: Number(f.get('amount')) || 0,
                dueDate: String(f.get('dueDate') || ''),
                note: String(f.get('note') || ''),
              }), 'چک ثبت شد');
              e.currentTarget.reset();
            }}
            className="rounded-lg border border-slate-200 p-3"
          >
            <h4 className="mb-2 text-xs font-bold text-slate-800">ثبت چک</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className={labelCls}>شمارهٔ چک *<input name="chequeNo" required className={inputCls} /></label>
              <label className={labelCls}>بانک<input name="bankName" className={inputCls} /></label>
              <label className={labelCls}>کد شعبه<input name="branchCode" className={inputCls} /></label>
              <label className={labelCls}>مبلغ (ریال) *<input name="amount" type="number" min={1} required className={inputCls} /></label>
              <label className={labelCls}>تاریخ سررسید *<input name="dueDate" type="date" required className={inputCls} /></label>
              <label className={labelCls}>
                ترم
                <select name="termId" className={inputCls}>
                  <option value="">—</option>
                  {terms.map((t) => <option key={t.id} value={t.id}>{t.termTitle}</option>)}
                </select>
              </label>
              <label className={`${labelCls} sm:col-span-3`}>یادداشت<input name="note" className={inputCls} /></label>
            </div>
            <p className="mt-2 text-2xs text-slate-500">
              پیش از سررسید، پیام یادآوری خودکار به دانشجو فرستاده می‌شود (افق یادآوری در تنظیمات سامانه).
            </p>
            <button type="submit" disabled={pending} className={`${btnCls} mt-2`}>ثبت چک</button>
          </form>

          {props.cheques.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs rt rt--scroll">
                <thead>
                  <tr className="border-b border-slate-200 text-2xs text-slate-500">
                    <th className="p-2">شماره</th><th className="p-2">بانک</th><th className="p-2">مبلغ</th>
                    <th className="p-2">سررسید</th><th className="p-2">وضعیت</th><th className="p-2">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {props.cheques.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100 last:border-0">
                      <td className="p-2 text-slate-800">{c.chequeNo || '—'}</td>
                      <td className="p-2 text-slate-600">{c.bankName || '—'}</td>
                      <td className="p-2">{fa(c.amount)}</td>
                      <td className="p-2">{c.dueDate || '—'}</td>
                      <td className="p-2">
                        <span className={`rounded px-1.5 py-0.5 text-3xs ${
                          c.status === 'CLEARED' ? 'bg-emerald-50 text-emerald-700' :
                          c.status === 'BOUNCED' ? 'bg-rose-50 text-rose-700' :
                          c.status === 'CANCELLED' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'}`}>
                          {c.status === 'CLEARED' ? 'وصول‌شده' : c.status === 'BOUNCED' ? 'برگشتی' :
                           c.status === 'CANCELLED' ? 'باطل‌شده' : 'در انتظار'}
                        </span>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {c.status === 'PENDING' && (
                            <>
                              <button disabled={pending} onClick={() => run(() => clearChequeAction(c.id), 'چک وصول و در دفتر مالی ثبت شد')}
                                className={`${smBtn} border-emerald-300 bg-emerald-50 text-emerald-700`}>وصول</button>
                              <button disabled={pending} onClick={() => run(() => setChequeStatusAction(c.id, 'BOUNCED'), 'چک برگشتی ثبت شد')}
                                className={`${smBtn} border-rose-300 bg-rose-50 text-rose-700`}>برگشت</button>
                              <button disabled={pending} onClick={() => run(() => setChequeStatusAction(c.id, 'CANCELLED'), 'چک باطل شد')}
                                className={`${smBtn} border-slate-300 bg-slate-50 text-slate-600`}>ابطال</button>
                            </>
                          )}
                          {c.status !== 'CLEARED' && (
                            <button disabled={pending} onClick={() => run(() => deleteChequeAction(c.id), 'چک حذف شد')}
                              className={`${smBtn} border-slate-300 bg-slate-50 text-slate-600`}>حذف</button>
                          )}
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

      {/* ═══ وام ═══ */}
      {tab === 'loan' && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(() => addLoanAction({
                studentId,
                termId: f.get('termId') ? Number(f.get('termId')) : null,
                loanProductId: f.get('loanProductId') ? Number(f.get('loanProductId')) : null,
                welfareFundId: f.get('welfareFundId') ? Number(f.get('welfareFundId')) : null,
                lender: String(f.get('lender') || ''),
                loanCode: String(f.get('loanCode') || ''),
                amount: Number(f.get('amount')) || 0,
                installments: Number(f.get('installments')) || 1,
                firstDueDate: String(f.get('firstDueDate') || ''),
                note: String(f.get('note') || ''),
              }), 'وام ثبت شد');
              e.currentTarget.reset();
              setLoanProductId('');
            }}
            className="rounded-lg border border-slate-200 p-3"
          >
            <h4 className="mb-2 text-xs font-bold text-slate-800">ثبت وام</h4>
            {props.loanProducts.length > 0 && (
              <label className={`${labelCls} mb-3`}>
                نوع وام (از کاتالوگ)
                <select
                  name="loanProductId"
                  value={loanProductId}
                  onChange={(e) => setLoanProductId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">— انتخاب از کاتالوگ (اختیاری) —</option>
                  {props.loanProducts.map((l) => (
                    <option key={l.id} value={l.id}>{l.title}</option>
                  ))}
                </select>
              </label>
            )}
            {props.loanProducts.length === 0 && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-2xs text-amber-800">
                هنوز نوع وامی در کاتالوگ تعریف نشده. از «⚙️ تعاریف موتور مالی ← وام‌ها» نوع وام بسازید.
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className={labelCls}>پرداخت‌کنندهٔ وام *<input name="lender" required key={selectedLoan?.id ?? 'lender'} defaultValue={selectedLoan?.lender} placeholder="مثلاً صندوق رفاه دانشجویان" className={inputCls} /></label>
              <label className={labelCls}>کد وام<input name="loanCode" key={selectedLoan ? `c${selectedLoan.id}` : 'loanCode'} defaultValue={selectedLoan?.code} className={inputCls} /></label>
              <label className={labelCls}>
                مبلغ (ریال) *{selectedLoan?.maxAmount ? ` (سقف ${fa(selectedLoan.maxAmount)})` : ''}
                <input name="amount" type="number" min={1} max={selectedLoan?.maxAmount ?? undefined} required key={selectedLoan ? `a${selectedLoan.id}` : 'amount'} defaultValue={selectedLoan?.defaultAmount || undefined} className={inputCls} />
              </label>
              <label className={labelCls}>تعداد اقساط<input name="installments" type="number" min={1} key={selectedLoan ? `i${selectedLoan.id}` : 'inst'} defaultValue={selectedLoan?.defaultInstallments ?? 1} className={inputCls} /></label>
              <label className={labelCls}>سررسید اولین قسط<input name="firstDueDate" type="date" className={inputCls} /></label>
              <label className={labelCls}>
                ترم
                <select name="termId" className={inputCls}>
                  <option value="">—</option>
                  {terms.map((t) => <option key={t.id} value={t.id}>{t.termTitle}</option>)}
                </select>
              </label>
              {props.welfareFunds.length > 0 && (
                <label className={labelCls}>
                  صندوق رفاه
                  <select name="welfareFundId" className={inputCls}>
                    <option value="">— بدون صندوق —</option>
                    {props.welfareFunds.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
                  </select>
                </label>
              )}
              <label className={`${labelCls} sm:col-span-3`}>یادداشت<input name="note" className={inputCls} /></label>
            </div>
            <button type="submit" disabled={pending} className={`${btnCls} mt-3`}>ثبت وام</button>
          </form>

          {props.loans.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs rt rt--scroll">
                <thead>
                  <tr className="border-b border-slate-200 text-2xs text-slate-500">
                    <th className="p-2">نوع وام</th><th className="p-2">پرداخت‌کننده</th><th className="p-2">کد</th><th className="p-2">مبلغ</th>
                    <th className="p-2">اقساط</th><th className="p-2">وضعیت</th><th className="p-2">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {props.loans.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100 last:border-0">
                      <td className="p-2 text-slate-800">{l.productTitle || '—'}</td>
                      <td className="p-2 text-slate-600">{l.lender}</td>
                      <td className="p-2 text-slate-500">{l.loanCode || '—'}</td>
                      <td className="p-2">{fa(l.amount)}</td>
                      <td className="p-2">{fa(l.installments)}</td>
                      <td className="p-2">
                        <span className={`rounded px-1.5 py-0.5 text-3xs ${
                          l.status === 'ACTIVE' ? 'bg-sky-50 text-sky-700' :
                          l.status === 'SETTLED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {l.status === 'ACTIVE' ? 'فعال' : l.status === 'SETTLED' ? 'تسویه‌شده' : 'لغوشده'}
                        </span>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {l.status === 'ACTIVE' && (
                            <button disabled={pending} onClick={() => run(() => setLoanStatusAction(l.id, 'SETTLED'), 'وام تسویه شد')}
                              className={`${smBtn} border-emerald-300 bg-emerald-50 text-emerald-700`}>تسویه</button>
                          )}
                          <button disabled={pending} onClick={() => run(() => setLoanStatusAction(l.id, 'CANCELLED'), 'وام لغو شد')}
                            className={`${smBtn} border-slate-300 bg-slate-50 text-slate-600`}>لغو</button>
                          <button disabled={pending} onClick={() => run(() => deleteLoanAction(l.id), 'وام حذف شد')}
                            className={`${smBtn} border-slate-300 bg-slate-50 text-slate-600`}>حذف</button>
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

      {/* ═══ فرمول تخصیص و پرداخت ═══ */}
      {tab === 'ledger' && (
        <div className="space-y-4">
          {/* شهریه با ضریب و مبالغ موضوعی */}
          {props.enhancedTuition && (props.enhancedTuition.fixedCoefficient !== 1 || props.enhancedTuition.variableCoefficient !== 1 || props.enhancedTuition.subjectFeesTotal !== 0 || props.enhancedTuition.overrideId !== null) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <h4 className="mb-2 text-xs font-bold text-amber-800">
                شهریهٔ ترم جاری با ضریب افزایشی و مبالغ موضوعی
                {props.enhancedTuition.overrideId !== null && (
                  <span className="mr-2 rounded-full bg-violet-100 px-2 py-0.5 text-3xs text-violet-800">
                    🎯 فرمول ویژه{props.enhancedTuition.overrideReason ? ` — ${props.enhancedTuition.overrideReason}` : ''}
                  </span>
                )}
              </h4>
              <div className="grid grid-cols-2 gap-2 text-2xs sm:grid-cols-3">
                <div><span className="text-slate-500">شهریه ثابت خام: </span><span className="font-medium">{fa(props.enhancedTuition.fixedTuition)}</span></div>
                {props.enhancedTuition.fixedCoefficient !== 1 && (
                  <div><span className="text-slate-500">ضریب ثابت: </span><span className="font-medium text-amber-700">×{props.enhancedTuition.fixedCoefficient} = {fa(props.enhancedTuition.fixedTuitionAfterCoeff)}</span></div>
                )}
                <div><span className="text-slate-500">شهریه متغیر خام: </span><span className="font-medium">{fa(props.enhancedTuition.variableTuition)}</span></div>
                {props.enhancedTuition.variableCoefficient !== 1 && (
                  <div><span className="text-slate-500">ضریب متغیر: </span><span className="font-medium text-amber-700">×{props.enhancedTuition.variableCoefficient} = {fa(props.enhancedTuition.variableTuitionAfterCoeff)}</span></div>
                )}
                <div><span className="text-slate-500">مبالغ موضوعی: </span><span className={`font-medium ${props.enhancedTuition.subjectFeesTotal > 0 ? 'text-rose-700' : props.enhancedTuition.subjectFeesTotal < 0 ? 'text-emerald-700' : 'text-slate-700'}`}>{props.enhancedTuition.subjectFeesTotal > 0 ? '+' : ''}{fa(props.enhancedTuition.subjectFeesTotal)}</span></div>
                <div className="col-span-2 sm:col-span-3 border-t border-amber-200 pt-2 mt-1">
                  <span className="text-slate-500">شهریه نهایی: </span>
                  <span className="font-bold text-amber-800">{fa(props.enhancedTuition.totalTuition)} ریال</span>
                </div>
              </div>
              {props.enhancedTuition.subjectFees.length > 0 && (
                <div className="mt-2 border-t border-amber-200 pt-2">
                  <p className="mb-1 text-3xs font-bold text-amber-700">اقلام موضوعی:</p>
                  <div className="flex flex-wrap gap-2">
                    {props.enhancedTuition.subjectFees.map((sf, i) => (
                      <span key={i} className={`rounded px-1.5 py-0.5 text-3xs ${sf.kind === 'ADDITIVE' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>
                        {sf.title}: {sf.amount > 0 ? '+' : ''}{fa(sf.amount)} ریال
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-3">
            <h4 className="mb-2 text-xs font-bold text-slate-800">فرمول تخصیص منطبق</h4>
            {!props.formula || !props.formula.formulaTitle ? (
              <p className="text-xs text-amber-700">
                هیچ فرمول تخصیصی با مقطع/رشته/ورودی این دانشجو نمی‌خواند. از «⚙️ انواع تخفیف، بنیادها و فرمول‌ها» فرمول بسازید.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                <div><span className="text-slate-500">فرمول: </span><span className="font-medium">{props.formula.formulaTitle}</span></div>
                <div><span className="text-slate-500">ترم: </span><span className="font-medium">{props.formula.termTitle}</span></div>
                <div><span className="text-slate-500">واحد نظری: </span><span className="font-medium">{fa(props.formula.buckets.theory)}</span></div>
                <div><span className="text-slate-500">واحد عملی: </span><span className="font-medium">{fa(props.formula.buckets.practical)}</span></div>
                <div><span className="text-slate-500">واحد عمومی: </span><span className="font-medium">{fa(props.formula.buckets.general)}</span></div>
                <div><span className="text-slate-500">مبلغ کل: </span><span className="font-bold text-slate-800">{fa(props.formula.total)} ریال</span></div>
              </div>
            )}
            {props.formula?.formulaTitle && props.formula.termId && (
              <button
                disabled={pending}
                onClick={() => run(() => chargeByFormulaAction({ studentId, termId: props.formula!.termId! }), 'شهریه بر اساس فرمول ثبت شد')}
                className={`${btnCls} mt-3`}
              >
                ثبت شهریه بر اساس این فرمول
              </button>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(() => recordLedgerAction({
                studentId,
                termId: f.get('termId') ? Number(f.get('termId')) : null,
                transactionType: String(f.get('transactionType')) === 'CHARGE' ? 'CHARGE' : 'PAYMENT',
                amount: Number(f.get('amount')) || 0,
                description: String(f.get('description') || ''),
              }), 'تراکنش ثبت شد');
              e.currentTarget.reset();
            }}
            className="rounded-lg border border-slate-200 p-3"
          >
            <h4 className="mb-2 text-xs font-bold text-slate-800">ثبت دستی در دفتر مالی</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <label className={labelCls}>
                نوع
                <select name="transactionType" className={inputCls}>
                  <option value="PAYMENT">پرداخت (کاهش بدهی)</option>
                  <option value="CHARGE">بدهی (افزایش بدهی)</option>
                </select>
              </label>
              <label className={labelCls}>
                ترم
                <select name="termId" className={inputCls}>
                  <option value="">بدون ترم</option>
                  {terms.map((t) => <option key={t.id} value={t.id}>{t.termTitle}</option>)}
                </select>
              </label>
              <label className={labelCls}>مبلغ (ریال) *<input name="amount" type="number" min={1} required className={inputCls} /></label>
              <label className={labelCls}>شرح<input name="description" className={inputCls} /></label>
            </div>
            <button type="submit" disabled={pending} className={`${btnCls} mt-3`}>ثبت تراکنش</button>
          </form>
        </div>
      )}
    </div>
  );
}
