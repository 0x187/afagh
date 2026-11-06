'use client';

import React, { useMemo, useState, useTransition, useEffect } from 'react';
import {
  payrollComputeAction, payrollConfigAction, payrollExportAction,
  payrollMidtermAction, payrollPayslipAction,
} from './actions';
import { normalizeFa, faIncludes } from '@/lib/persian-search';

// ═══ میز کار حق‌التدریس — دادهٔ واقعی از موتور مالی ═══

export type OverviewItem = {
  id: number; name: string; staffCode: string | null; rank: string | null; base: string | null; degree: string | null;
  contractType: string | null; rate: number; rateSource: 'TABLE' | 'BASE' | 'SNAPSHOT' | 'FRACTION'; dutyUnits: number;
  totalEquivalentUnits: number; totalEffectiveUnits: number;
  payableUnits: number; gross: number; tax: number; absenceDeductionRial: number; net: number;
  status: string; statementId: number | null; midtermPaid: number; finalPaid: number; remaining: number;
  gates: { gradesFinalized: boolean; pendingGrades: number; docsSigned: boolean; unsignedDocs: number };
};

export type OverviewTotals = { budget: number; paid: number; remaining: number; staffCount: number };

const faNum = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const money = (n: number) => faNum(Math.round(Number(n || 0)).toLocaleString('en-US')) + ' ریال';

const STATUS_FA: Record<string, string> = {
  NOT_COMPUTED: 'محاسبه‌نشده',
  DRAFT: 'پیش‌نویس',
  MID_TERM_PAID: 'میان‌ترم پرداخت‌شده',
  DEPT_HEAD_APPROVED: 'تأیید مدیر گروه',
  DEAN_APPROVED: 'تأیید معاونت آموزشی',
  REJECTED: 'ردّ نهایی',
  FINAL_SETTLED: 'تسویهٔ نهایی',
};
// رنگ نشان مرحلهٔ زنجیرهٔ تأیید
const STATUS_BADGE: Record<string, string> = {
  DEPT_HEAD_APPROVED: 'bg-indigo-600 text-white',
  DEAN_APPROVED: 'bg-blue-600 text-white',
  REJECTED: 'bg-rose-600 text-white',
  MID_TERM_PAID: 'bg-amber-200 text-amber-900',
  FINAL_SETTLED: 'bg-emerald-600 text-white',
};
const CONTRACT_FA: Record<string, string> = { FULL_TIME: 'هیئت علمی', ADJUNCT: 'مدعو', FULL_TIME_FACULTY: 'هیئت علمی' };
/** منبع نرخ هر واحد — کجا آمده؟ (مهاجرت 0090 تفکیک مرتبه/پایه) */
const RATE_SOURCE_FA: Record<string, string> = {
  BASE: 'سطر پایه‌دار جدول',
  TABLE: 'سطر عمومی جدول',
  SNAPSHOT: 'اسنپ‌شات قرارداد',
  FRACTION: 'نسبت حکم (۱/N)',
};

type LiveTab = 'overview' | 'coefficients_rules';

export default function LivePayrollClient({
  initialTerm, initialList, initialTotals, userRoles = [],
}: {
  initialTerm: string;
  initialList: OverviewItem[];
  initialTotals: OverviewTotals;
  userRoles?: string[];
}) {
  const [list, setList] = useState<OverviewItem[]>(initialList);
  const [totals, setTotals] = useState<OverviewTotals>(initialTotals);
  const [term, setTerm] = useState<string>(initialTerm);
  const [busy, startBusy] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [slip, setSlip] = useState<any | null>(null);
  const [query, setQuery] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [config, setConfig] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<LiveTab>('overview');

  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 5000);
  };

  // ── زنجیرهٔ تأیید فیش (سرورساید، از /api/admin/payroll/approvals) ──
  const isAdmin = userRoles.includes('ADMIN');
  const canDeptAct = isAdmin || userRoles.includes('DEP_HEAD');
  const canDeanAct = isAdmin || userRoles.includes('VICE_EDU') || userRoles.includes('EDU_EXPERT');
  const canSettle = isAdmin;
  // مدیر گروهِ خالص، اکشن نمای کلی موتور را ندارد؛ تازه‌سازی از مسیر دامنه‌دار
  const useScopedRefresh = !(
    isAdmin || userRoles.includes('EDU_EXPERT') || userRoles.includes('VICE_EDU') ||
    userRoles.includes('FINANCE_EXPERT') || userRoles.includes('FINANCE')
  );
  const canManageEngine = !useScopedRefresh;

  const filtered = useMemo(() => {
    const q = normalizeFa(query);
    return list.filter(x => {
      if (onlyOpen && x.status === 'FINAL_SETTLED') return false;
      if (!q) return true;
      return faIncludes(`${x.name} ${x.staffCode ?? ''} ${x.rank ?? ''}`, q);
    });
  }, [list, query, onlyOpen]);

  const reload = () =>
    new Promise<void>(resolve => {
      // بارگذاری دوباره از طریق اکشن محاسبه انجام می‌شود؛ اینجا فقط وضعیت را تازه می‌کنیم
      resolve();
    });

  const runCompute = () =>
    startBusy(async () => {
      const r = await payrollComputeAction();
      if (r.ok === false) return say(r.error);
      const ov = await (await import('./actions')).payrollOverviewAction();
      if (ov.ok) {
        setList(ov.list as OverviewItem[]);
        setTotals(ov.totals as OverviewTotals);
        setTerm(ov.term);
      }
      say(`فیش ${faNum(r.computed)} استاد محاسبه شد${r.skippedNoContract ? ` — ${faNum(r.skippedNoContract)} استاد بدون قرارداد کنار گذاشته شد` : ''}.`);
      await reload();
    });

  const runMidterm = (staffId: number, name: string) =>
    startBusy(async () => {
      const r = await payrollMidtermAction(staffId);
      if (r.ok === false) return say(r.error);
      say(`علی‌الحساب ${name} به مبلغ ${money(r.amount)} پرداخت شد.`);
      await runComputeSilent();
    });

  const runSettle = (staffId: number, name: string) =>
    startBusy(async () => {
      // تسویه فقط پس از تأیید معاونت آموزشی (پیش‌شرط در لایهٔ تأیید، بعد فراخوانی موتور)
      const res = await fetch('/api/admin/payroll/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'settle', staffId }),
      });
      const r = await res.json();
      if (!r.ok) return say(r.error || 'خطا در تسویه');
      say(r.info ?? `تسویهٔ نهایی ${name} به مبلغ ${money(r.amount ?? 0)} انجام شد.`);
      await runComputeSilent();
    });

  const runApproval = (op: 'approve-dept' | 'approve-dean' | 'return' | 'reject', statementId: number | null) =>
    startBusy(async () => {
      if (!statementId) return say('ابتدا فیش ترم را محاسبه کنید.');
      let note: string | undefined;
      if (op === 'return' || op === 'reject') {
        const m = prompt(op === 'return' ? 'یادداشت اصلاح (الزامی):' : 'دلیل ردّ نهایی (الزامی):');
        if (!m || !m.trim()) return say('بدون یادداشت، بازگشت/ردّ انجام نمی‌شود.');
        note = m.trim();
      }
      const res = await fetch('/api/admin/payroll/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, statementId, note }),
      });
      const r = await res.json();
      if (!r.ok) return say(r.error || 'خطا');
      say(r.info ?? 'تأیید ثبت شد.');
      await runComputeSilent();
    });

  const runComputeSilent = async () => {
    if (useScopedRefresh) {
      try {
        const res = await fetch('/api/admin/payroll/approvals');
        const j = await res.json();
        if (j.ok) {
          setList(j.list as OverviewItem[]);
          setTotals(j.totals as OverviewTotals);
          setTerm(j.term);
        }
      } catch { /* پیام خطا را همان اکشن قبلی نشان داده */ }
      return;
    }
    const ov = await (await import('./actions')).payrollOverviewAction();
    if (ov.ok) {
      setList(ov.list as OverviewItem[]);
      setTotals(ov.totals as OverviewTotals);
      setTerm(ov.term);
    }
  };

  const openSlip = (staffId: number) =>
    startBusy(async () => {
      const r = await payrollPayslipAction(staffId);
      if (r.ok === false) return say(r.error);
      setSlip(r);
    });

  const doExport = () =>
    startBusy(async () => {
      const r = await payrollExportAction();
      if (r.ok === false) return say(r.error);
      const blob = new Blob(['\ufeff' + r.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll-batch-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      say(`فایل واریز دسته‌جمعی با ${faNum(r.count)} ردیف ساخته شد.`);
    });

  const loadConfig = () =>
    startBusy(async () => {
      const r = await payrollConfigAction();
      if (r.ok === false) return say(r.error);
      setConfig(r);
    });

  const card = (title: string, value: string, hint?: string) => (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="mt-1 text-lg font-bold text-slate-800">{value}</div>
      {hint ? <div className="mt-1 text-2xs text-slate-400">{hint}</div> : null}
    </div>
  );

  return (
    <div className="space-y-4" dir="rtl">
      {toast ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{toast}</div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-slate-800">حق‌التدریس ترم {term || '—'}</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">دادهٔ زنده از موتور مالی</span>
        <div className="flex-1" />
        {canManageEngine ? (
          <>
            <button onClick={runCompute} disabled={busy} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
              محاسبهٔ فیش ترم
            </button>
            <button onClick={doExport} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">
              خروجی واریز دسته‌جمعی (CSV)
            </button>
          </>
        ) : (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">کارتابل تأیید مدیر گروه — فقط فیش‌های گروه شما</span>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-1.5 bg-white p-2 rounded-2xl shadow-xs border border-slate-200">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'overview'
              ? 'bg-indigo-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>📊 نمای کلی و فیش‌ها</span>
        </button>
        <button
          onClick={() => setActiveTab('coefficients_rules')}
          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 ${
            activeTab === 'coefficients_rules'
              ? 'bg-indigo-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>⚙️ ضرایب و قوانین محاسبه</span>
        </button>
      </div>

      {activeTab === 'overview' && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {card('بودجهٔ حق‌التدریس (خالص)', money(totals.budget))}
          {card('پرداخت‌شده', money(totals.paid))}
          {card('باقی‌مانده', money(totals.remaining))}
          {card('تعداد اساتید', faNum(totals.staffCount), 'اساتید دارای قرارداد ترمی')}
        </div>

        {config && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs leading-6">
            <div className="mb-2 font-bold">پیکربندی فعلی موتور (سال {faNum(config.year)})</div>
            <div>ضریب درس عملی ×{faNum(config.coefs.practical)} · ضریب مقطع ارشد ×{faNum(config.coefs.msLevel)} · ضریب کلاس جمعی ×{faNum(config.coefs.crowded)} (بالای {faNum(config.crowded)} نفر)</div>
            <div>مبنای جلسات ترم: {faNum(config.sessions)} · علی‌الحساب میان‌ترم: {faNum(config.midterm)}٪</div>
            <div className="mt-2 font-bold">نرخ پایهٔ هر واحد</div>
            <ul>
              {config.rates.map((r: any, i: number) => (
                <li key={i}>{r.academicRank} {r.academicBase ? `· پایه ${r.academicBase}` : ''} / {r.degree} — {money(r.baseRatePerUnit)} (سال {faNum(r.effectiveYear)})</li>
              ))}
            </ul>
            {config.rules.length && (
              <>
                <div className="mt-2 font-bold">فرمول‌های اختصاصی</div>
                <ul>
                  {config.rules.map((r: any) => (
                    <li key={r.id}>{r.title || `${r.offeringType ?? '—'} / ${r.professorRole ?? '—'}`}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="جست‌وجوی نام یا کد پرسنلی…"
            className="rounded-lg border border-slate-300 px-3 py-1.5"
          />
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} />
            فقط تسویه‌نشده‌ها
          </label>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-right text-xs rt">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-2">استاد</th>
                <th className="p-2">مرتبه / پایه</th>
                <th className="p-2">نرخ واحد</th>
                <th className="p-2">واحد معادل</th>
                <th className="p-2">واحد قابل پرداخت</th>
                <th className="p-2">ناخالص</th>
                <th className="p-2">کسر غیبت</th>
                <th className="p-2">مالیات</th>
                <th className="p-2">خالص</th>
                <th className="p-2">پرداخت‌شده</th>
                <th className="p-2">وضعیت</th>
                <th className="p-2">گلوگاه‌ها</th>
                <th className="p-2">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={14} className="p-6 text-center text-slate-400">ردیفی یافت نشد. ابتدا «محاسبهٔ فیش ترم» را بزنید.</td></tr>
              ) : null}
              {filtered.map(x => (
                <tr key={x.id} className="border-t border-slate-100">
                  <td className="p-2">
                    <div className="font-medium text-slate-800">{x.name}</div>
                    <div className="text-2xs text-slate-400">{faNum(x.staffCode ?? '—')}</div>
                  </td>
                  <td className="p-2">
                    <div className="font-medium text-slate-700">{x.rank ?? '—'}</div>
                    <div className="text-2xs text-slate-500">
                      پایه {x.base ? faNum(x.base) : '—'}
                      {x.degree && <span className="text-slate-400"> · {x.degree}</span>}
                    </div>
                  </td>
                  <td className="p-2">
                    <div className="font-mono text-2xs text-slate-800">{money(x.rate)}</div>
                    <div className="text-3xs text-slate-400">{RATE_SOURCE_FA[x.rateSource]}</div>
                  </td>
                  <td className="p-2 text-2xs text-slate-600">{CONTRACT_FA[x.contractType ?? ''] ?? x.contractType ?? '—'}</td>
                  <td className="p-2">{faNum(x.totalEquivalentUnits.toFixed(2))}</td>
                  <td className="p-2">{faNum(x.payableUnits.toFixed(2))}</td>
                  <td className="p-2">{money(x.gross)}</td>
                  <td className="p-2 text-rose-600">{money(x.absenceDeductionRial)}</td>
                  <td className="p-2">{money(x.tax)}</td>
                  <td className="p-2 font-bold">{money(x.net)}</td>
                  <td className="p-2">{money(x.midtermPaid + x.finalPaid)}</td>
                  <td className="p-2">
                    <span className={`rounded-full px-2 py-0.5 ${STATUS_BADGE[x.status] ?? 'bg-slate-100 text-slate-700'}`}>{STATUS_FA[x.status] ?? x.status}</span>
                  </td>
                  <td className="p-2 text-2xs">
                    <span className={x.gates.gradesFinalized ? 'text-emerald-600' : 'text-amber-600'}>
                      نمرات: {x.gates.gradesFinalized ? 'قطعی' : `${faNum(x.gates.pendingGrades)} باز`}
                    </span>
                    <br />
                    <span className={x.gates.docsSigned ? 'text-emerald-600' : 'text-amber-600'}>
                      اسناد: {x.gates.docsSigned ? 'امضاشده' : `${faNum(x.gates.unsignedDocs)} امضانشده`}
                    </span>
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      <button onClick={() => openSlip(x.id)} disabled={busy} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50">فیش</button>
                      {x.status === 'DRAFT' && canManageEngine ? (
                        <button onClick={() => runMidterm(x.id, x.name)} disabled={busy} className="rounded border border-indigo-300 px-2 py-1 text-indigo-700 disabled:opacity-50">
                          علی‌الحساب
                        </button>
                      ) : null}
                      {/* ── زنجیرهٔ تأیید: دکمهٔ هر مرحله فقط برای نقشِ عامل آن + ADMIN ── */}
                      {x.statementId && canDeptAct && (x.status === 'DRAFT' || x.status === 'MID_TERM_PAID') ? (
                        <button onClick={() => runApproval('approve-dept', x.statementId)} disabled={busy} className="rounded border border-indigo-300 px-2 py-1 text-indigo-700 disabled:opacity-50">
                          تأیید مدیر گروه
                        </button>
                      ) : null}
                      {x.statementId && canDeanAct && x.status === 'DEPT_HEAD_APPROVED' ? (
                        <button onClick={() => runApproval('approve-dean', x.statementId)} disabled={busy} className="rounded border border-blue-300 px-2 py-1 text-blue-700 disabled:opacity-50">
                          تأیید معاونت آموزشی
                        </button>
                      ) : null}
                      {x.statementId && (canDeptAct || canDeanAct) && (x.status === 'DEPT_HEAD_APPROVED' || x.status === 'DEAN_APPROVED') ? (
                        <button onClick={() => runApproval('return', x.statementId)} disabled={busy} className="rounded border border-amber-300 px-2 py-1 text-amber-700 disabled:opacity-50">
                          بازگشت برای اصلاح
                        </button>
                      ) : null}
                      {x.statementId && (canDeptAct || canDeanAct) && x.status !== 'FINAL_SETTLED' && x.status !== 'REJECTED' && x.status !== 'NOT_COMPUTED' ? (
                        <button onClick={() => runApproval('reject', x.statementId)} disabled={busy} className="rounded border border-rose-300 px-2 py-1 text-rose-700 disabled:opacity-50">
                          ردّ نهایی
                        </button>
                      ) : null}
                      {x.status === 'DEAN_APPROVED' && canSettle ? (
                        <button onClick={() => runSettle(x.id, x.name)} disabled={busy} className="rounded border border-emerald-300 px-2 py-1 text-emerald-700 disabled:opacity-50">
                          تسویهٔ نهایی
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

    {slip ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSlip(null)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-5 text-xs" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-base font-bold">فیش حق‌التدریس {slip.calc?.staff?.name} — {slip.term}</div>
              <button onClick={() => setSlip(null)} className="rounded border border-slate-300 px-2 py-1">بستن</button>
            </div>
            <div className="mb-2 text-slate-600">
              نرخ هر واحد: {money(slip.calc?.rate ?? 0)} · موظفی: {faNum(slip.calc?.dutyUnits ?? 0)} واحد · مالیات: {faNum(slip.calc?.taxRate ?? 0)}٪
            </div>
            <table className="w-full text-right rt">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-2">درس</th><th className="p-2">واحد</th><th className="p-2">نقش</th>
                  <th className="p-2">ضرایب</th><th className="p-2">معادل</th><th className="p-2">جلسات</th>
                  <th className="p-2">مؤثر</th><th className="p-2">کسر غیبت</th><th className="p-2">مبلغ</th>
                </tr>
              </thead>
              <tbody>
                {(slip.calc?.rows ?? []).map((r: any) => (
                  <tr key={r.offeringId} className="border-t border-slate-100">
                    <td className="p-2">{r.courseTitle}<div className="text-3xs text-slate-400">{r.courseCode}</div></td>
                    <td className="p-2">{faNum(r.units)}</td>
                    <td className="p-2">{r.payRole}</td>
                    <td className="p-2 text-3xs">{r.coefficients}</td>
                    <td className="p-2">{faNum(r.equivalentUnits.toFixed(2))}</td>
                    <td className="p-2 text-3xs">
                      {faNum(r.sessions.planned)}/{faNum(r.sessions.held)} · غیبت {faNum(r.sessions.netAbsences)}
                    </td>
                    <td className="p-2">{faNum(r.effectiveUnits.toFixed(2))}</td>
                    <td className="p-2 text-rose-600">{money(r.absenceDeductionRial)}</td>
                    <td className="p-2">{money(r.grossRial)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3">
              <div>واحد معادل کل: {faNum(slip.calc?.totalEquivalentUnits?.toFixed(2))}</div>
              <div>واحد مؤثر کل: {faNum(slip.calc?.totalEffectiveUnits?.toFixed(2))} — قابل پرداخت: {faNum(slip.calc?.payableUnits?.toFixed(2))}</div>
              <div>ناخالص: {money(slip.calc?.gross ?? 0)} · کسر غیبت: {money(slip.calc?.absenceDeductionRial ?? 0)} · مالیات: {money(slip.calc?.tax ?? 0)}</div>
              <div className="font-bold">خالص قابل پرداخت: {money(slip.calc?.net ?? 0)}</div>
              {slip.statement ? (
                <div className="text-slate-600">
                  وضعیت سند: {STATUS_FA[slip.statement.status] ?? slip.statement.status} ·
                  پرداخت‌شده: {money(Number(slip.statement.midtermPaidAmount ?? 0) + Number(slip.statement.finalPaidAmount ?? 0))} ·
                  باقی‌مانده: {money(slip.statement.remaining ?? 0)}
                </div>
              ) : (
                <div className="text-amber-600">هنوز فیش رسمی برای این استاد محاسبه نشده است.</div>
              )}
            </div>
          </div>
        </div>
      ) : (
      <CoefficientsRulesLiveTab
        term={term}
        onToast={setToast}
        busy={busy}
      />
    )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Coefficients & Rules Management Tab (Live Data)
// ─────────────────────────────────────────────────────────────────

interface CoefficientsRulesLiveTabProps {
  term: string;
  onToast: (msg: string) => void;
  busy: boolean;
}

function CoefficientsRulesLiveTab({ term, onToast, busy }: CoefficientsRulesLiveTabProps) {
  const [coefficients, setCoefficients] = useState<Array<{ruleName: string; multiplier: string}>>([]);
  const [rules, setRules] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [newRule, setNewRule] = useState({
    offeringType: '',
    professorRole: '',
    academicRank: '',
    multiplierUnit: '',
    multiplierPerStudent: '',
    flatFee: '',
    title: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [coefRes, ruleRes] = await Promise.all([
        fetch('/api/admin/payroll/coefficients'),
        fetch('/api/admin/payroll/calculation-rules'),
      ]);
      if (coefRes.ok) {
        const data = await coefRes.json();
        if (data.ok) setCoefficients(data.coefficients);
      }
      if (ruleRes.ok) {
        const data = await ruleRes.json();
        if (data.ok) setRules(data.rules);
      }
    } catch {
      onToast('خطا در بارگذاری داده‌ها');
    } finally {
      setLoading(false);
    }
  };

  const handleCoefficientChange = async (ruleName: string, value: string) => {
    const numValue = parseFloat(value) || 1;
    setSaving(ruleName);
    try {
      const res = await fetch('/api/admin/payroll/coefficients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleName, multiplier: numValue }),
      });
      const data = await res.json();
      if (data.ok) {
        onToast(`ضریب ${ruleName} به‌روزرسانی شد`);
        setCoefficients(c => c.map(c => c.ruleName === ruleName ? { ...c, multiplier: String(numValue) } : c));
      } else {
        onToast(`خطا: ${data.error}`);
      }
    } catch {
      onToast('خطا در ارتباط با سرور');
    } finally {
      setSaving(null);
    }
  };

  const handleRuleUpdate = async (rule: any) => {
    setSaving(`rule-${rule.id}`);
    try {
      const res = await fetch(`/api/admin/payroll/calculation-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeringType: rule.offeringType,
          professorRole: rule.professorRole,
          academicRank: rule.academicRank,
          multiplierUnit: rule.multiplierUnit ? parseFloat(rule.multiplierUnit) : null,
          multiplierPerStudent: rule.multiplierPerStudent ? parseFloat(rule.multiplierPerStudent) : null,
          flatFee: rule.flatFee ? parseFloat(rule.flatFee) : null,
          title: rule.title,
          isActive: rule.isActive,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onToast('قانون محاسبه به‌روزرسانی شد');
      } else {
        onToast(`خطا: ${data.error}`);
        loadData();
      }
    } catch {
      onToast('خطا در ارتباط با سرور');
      loadData();
    } finally {
      setSaving(null);
    }
  };

  const handleRuleDelete = async (id: number) => {
    if (!window.confirm('آیا از حذف این قانون اطمینان دارید؟')) return;
    try {
      const res = await fetch(`/api/admin/payroll/calculation-rules/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        onToast('قانون محاسبه حذف شد');
        setRules(r => r.filter(rule => rule.id !== id));
      } else {
        onToast(`خطا: ${data.error}`);
      }
    } catch {
      onToast('خطا در ارتباط با سرور');
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving('create');
    try {
      const res = await fetch('/api/admin/payroll/calculation-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeringType: newRule.offeringType || null,
          professorRole: newRule.professorRole || null,
          academicRank: newRule.academicRank || null,
          multiplierUnit: newRule.multiplierUnit ? parseFloat(newRule.multiplierUnit) : null,
          multiplierPerStudent: newRule.multiplierPerStudent ? parseFloat(newRule.multiplierPerStudent) : null,
          flatFee: newRule.flatFee ? parseFloat(newRule.flatFee) : null,
          title: newRule.title,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onToast('قانون جدید ایجاد شد');
        setNewRule({
          offeringType: '',
          professorRole: '',
          academicRank: '',
          multiplierUnit: '',
          multiplierPerStudent: '',
          flatFee: '',
          title: '',
        });
        loadData();
      } else {
        onToast(`خطا: ${data.error}`);
      }
    } catch {
      onToast('خطا در ارتباط با سرور');
    } finally {
      setSaving(null);
    }
  };

  const getRuleDescription = (rule: any) => {
    const parts: string[] = [];
    if (rule.offeringType) parts.push(`نوع درس: ${rule.offeringType}`);
    if (rule.professorRole) parts.push(`نقش: ${rule.professorRole}`);
    if (rule.academicRank) parts.push(`مرتبه: ${rule.academicRank}`);
    return parts.join(' · ') || '— (قانون پیش‌فرض)';
  };

  const getRuleFormula = (rule: any) => {
    if (rule.flatFee) return `مبلغ مقطوع: ${Number(rule.flatFee).toLocaleString()} ریال`;
    if (rule.multiplierPerStudent) return `نرخ × واحد × دانشجو × ${rule.multiplierPerStudent}`;
    if (rule.multiplierUnit) return `نرخ × واحد × ${rule.multiplierUnit}`;
    return '—';
  };

  const COEF_LABELS: Record<string, string> = {
    'PAYROLL_COEF_PRACTICAL': 'ضریب درس عملی',
    'PAYROLL_COEF_MS_LEVEL': 'ضریب مقطع کارشناسی ارشد',
    'PAYROLL_COEF_CROWDED': 'ضریب کلاس جمعی (بیش از آستانه)',
  };

  const OFFERING_TYPES = ['', 'THEORY', 'THESIS', 'DIRECTED_READING', 'INTERNSHIP', 'NORMAL', 'TRANSFER'];
  const PROFESSOR_ROLES = ['', 'MAIN_LECTURER', 'SUPERVISOR', 'ADVISOR', 'REVIEWER', 'EXAMINER'];
  const ACADEMIC_RANKS = ['', 'مربی', 'استادیار', 'دانشیار', 'استاد تمام'];

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-indigo-500 border-t-transparent mx-auto"></div>
        <p className="mt-2 text-slate-500">در حال بارگذاری ضرایب و قوانین...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* بخش ۱: ضرایب تدریس (teaching_coefficients) */}
      <div className="card space-y-4">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-xl">⚙️</div>
          <div>
            <h2 className="font-black text-slate-900 text-base">ضرایب تدریس (Teaching Coefficients)</h2>
            <p className="text-xs text-slate-500">این ضرایب بر روی واحدهای معادل دروس نظری اعمال می‌شوند. مقادیر از جدول teaching_coefficients خوانده می‌شوند.</p>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-2xl">
          <table className="w-full text-right text-xs border-collapse rt">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="p-2.5">کد قانون</th>
                <th className="p-2.5">عنوان</th>
                <th className="p-2.5 text-center">ضریب جاری</th>
                <th className="p-2.5 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {coefficients.map(coef => (
                <tr key={coef.ruleName} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-2.5 font-mono text-slate-700">{coef.ruleName}</td>
                  <td className="p-2.5 font-medium text-slate-900">{COEF_LABELS[coef.ruleName] || coef.ruleName}</td>
                  <td className="p-2.5 text-center">
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="5"
                      value={coef.multiplier}
                      onChange={e => handleCoefficientChange(coef.ruleName, e.target.value)}
                      disabled={saving === coef.ruleName || busy}
                      className="w-20 text-center border border-slate-300 rounded px-1.5 py-0.5 font-mono font-bold text-slate-800 text-xs"
                    />
                  </td>
                  <td className="p-2.5 text-center">
                    {saving === coef.ruleName && <span className="text-amber-600 text-3xs">⟳ ذخیره...</span>}
                  </td>
                </tr>
              ))}
              {coefficients.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-slate-400">هیچ ضریبی یافت نشد</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <strong>نحوه اعمال:</strong> واحد درس × ضریب درس عملی × ضریب مقطع ارشد × ضریب کلاس جمعی = واحد معادل نهایی.
          <br />آستانه کلاس جمعی از تنظیمات (PAYROLL_CROWDED_THRESHOLD) خوانده می‌شود (پیش‌فرض ۴۰ نفر).
        </div>
      </div>

      {/* بخش ۲: قوانین محاسبه حق‌التدریس (payroll_calculation_rules) */}
      <div className="card space-y-4">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-xl">📐</div>
          <div>
            <h2 className="font-black text-slate-900 text-base">قوانین محاسبه حق‌التدریس (Calculation Rules)</h2>
            <p className="text-xs text-slate-500">قوانین فرمول‌ساز برای موارد خاص (پایان‌نامه، معرفی به استاد، تدریس ارشد/دکتری). خاص‌ترین قانون (بیشترین فیلدهای پرشده) برنده می‌شود.</p>
          </div>
        </div>

        {/* فرم افزودن قانون جدید */}
        <form onSubmit={handleCreateRule} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
          <h3 className="font-bold text-slate-800">➕ افزودن قانون جدید</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <select
              value={newRule.offeringType}
              onChange={e => setNewRule({ ...newRule, offeringType: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            >
              <option value="">نوع درس (اختیاری)</option>
              {OFFERING_TYPES.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              value={newRule.professorRole}
              onChange={e => setNewRule({ ...newRule, professorRole: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            >
              <option value="">نقش استاد (اختیاری)</option>
              {PROFESSOR_ROLES.filter(Boolean).map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select
              value={newRule.academicRank}
              onChange={e => setNewRule({ ...newRule, academicRank: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            >
              <option value="">مرتبه علمی (اختیاری)</option>
              {ACADEMIC_RANKS.filter(Boolean).map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <input
              type="text"
              placeholder="عنوان قانون"
              value={newRule.title}
              onChange={e => setNewRule({ ...newRule, title: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs md:col-span-2"
              required
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <input
              type="number"
              step="0.05"
              placeholder="ضریب واحد (multiplierUnit)"
              value={newRule.multiplierUnit}
              onChange={e => setNewRule({ ...newRule, multiplierUnit: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            />
            <input
              type="number"
              step="0.05"
              placeholder="ضریب هر دانشجو"
              value={newRule.multiplierPerStudent}
              onChange={e => setNewRule({ ...newRule, multiplierPerStudent: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            />
            <input
              type="number"
              step="1000000"
              placeholder="مبلغ مقطوع (ریال)"
              value={newRule.flatFee}
              onChange={e => setNewRule({ ...newRule, flatFee: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={saving === 'create' || !newRule.title || busy}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold disabled:opacity-50"
          >
            {saving === 'create' ? '⟳ در حال ایجاد...' : 'ایجاد قانون'}
          </button>
        </form>

        {/* لیست قوانین */}
        <div className="overflow-x-auto border border-slate-200 rounded-2xl">
          <table className="w-full text-right text-xs border-collapse rt">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="p-2.5">شناسه</th>
                <th className="p-2.5">شرایط تطبیق</th>
                <th className="p-2.5">فرمول محاسبه</th>
                <th className="p-2.5">عنوان</th>
                <th className="p-2.5 text-center">فعال</th>
                <th className="p-2.5 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule: any) => (
                <tr key={rule.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-2.5 font-mono text-slate-700">#{rule.id}</td>
                  <td className="p-2.5 text-slate-600 text-3xs">{getRuleDescription(rule)}</td>
                  <td className="p-2.5 font-mono text-indigo-900 text-3xs">{getRuleFormula(rule)}</td>
                  <td className="p-2.5">
                    <input
                      type="text"
                      value={rule.title || ''}
                      onChange={e => {
                        const updated = { ...rule, title: e.target.value };
                        setRules(r => r.map(r => r.id === rule.id ? updated : r));
                      }}
                      className="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs"
                    />
                  </td>
                  <td className="p-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={rule.isActive === 1}
                      onChange={e => {
                        const updated = { ...rule, isActive: e.target.checked ? 1 : 0 };
                        setRules(r => r.map(r => r.id === rule.id ? updated : r));
                        handleRuleUpdate(updated);
                      }}
                    />
                  </td>
                  <td className="p-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {saving === `rule-${rule.id}` ? (
                        <span className="text-amber-600 text-3xs">⟳</span>
                      ) : (
                        <>
                          <button
                            onClick={() => handleRuleUpdate(rule)}
                            className="px-2 py-1 text-emerald-600 hover:bg-emerald-50 rounded text-3xs font-bold"
                            title="ذخیره تغییرات"
                          >
                            💾
                          </button>
                          <button
                            onClick={() => handleRuleDelete(rule.id)}
                            className="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded text-3xs font-bold"
                            title="حذف قانون"
                          >
                            🗑️
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400">هیچ قانون محاسبه‌ای یافت نشد</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-200 text-xs text-indigo-900">
          <strong>اولویت تطبیق:</strong> قانون با بیشترین تعداد فیلدهای مشخص (offeringType + professorRole + academicRank) برنده است.
          <br />• <strong>FlatFee:</strong> مبلغ ثابت برای هر واحد/دانشجو (مثلا پایان‌نامه)
          <br />• <strong>MultiplierPerStudent:</strong> نرخ پایه × واحد × تعداد دانشجویان × ضریب
          <br />• <strong>MultiplierUnit:</strong> نرخ پایه × واحد × ضریب (بدون وابستگی به تعداد دانشجو)
        </div>
      </div>
    </div>
  );
}
