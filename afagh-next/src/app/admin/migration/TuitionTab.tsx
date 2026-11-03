'use client';

import { useState } from 'react';
import { acceptLegacyBalanceAction, applyFormulasAction, compareTuitionAction } from './actions';
import { ImportReport, Msg, ReportBox, Stat, Uploader, fmt } from './ui';
import { askConfirm } from '@/lib/ui-feedback';

type Formula = {
  id: number; formulaCode: string; title: string | null; termCode: string | null; degreeCode: string | null;
  majorCode: string | null; fixedAmount: string; perUnitTheory: string; perUnitPractical: string;
  perUnitGeneral: string; expression: string | null;
};
type Run = {
  id: number; termCode: string | null; tolerance: string; totalRows: number | null; matched: number | null;
  mismatched: number | null; unresolved: number | null; sumLegacy: string | null; sumComputed: string | null;
  sumDiff: string | null; createdAt: string | null;
};
type Summary = {
  runId: number; total: number; matched: number; mismatched: number; unresolved: number;
  sumLegacy: number; sumComputed: number; sumDiff: number;
  worst: { studentCode: string; termCode: string | null; legacy: number; computed: number; diff: number; status: string; detail: string }[];
};

type OpeningBalance = {
  total: number; created: number; skippedExisting: number; skippedZero: number;
  noStudent: number; noTerm: number; sumDebit: number; sumCredit: number; errors: string[];
};

const ST_FA: Record<string, string> = { MATCH: 'منطبق', DIFF: 'اختلاف', NO_FORMULA: 'بدون فرمول', ERROR: 'خطای فرمول' };

export default function TuitionTab({ sourceCode, formulas, runs, financialCount }: {
  sourceCode: string; formulas: Formula[]; runs: Run[]; financialCount: number;
}) {
  const [report, setReport] = useState<(ImportReport & { error?: string }) | null>(null);
  const [termCode, setTermCode] = useState('');
  const [tolerance, setTolerance] = useState('0');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState('');
  const [balance, setBalance] = useState<OpeningBalance | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null);

  async function compare() {
    setBusy('cmp'); setMsg(null);
    const r = await compareTuitionAction({ sourceCode, termCode, tolerance: Number(tolerance) || 0 });
    setBusy('');
    if (!r.ok) { setMsg({ kind: 'err', text: r.error ?? 'مقایسه ناموفق بود.' }); return; }
    setSummary(r.summary ?? null);
  }

  async function acceptBalance(scope: 'all' | 'mismatch') {
    const what = scope === 'mismatch'
      ? 'همهٔ ردیف‌های مغایرِ آخرین مقایسه'
      : `همهٔ ردیف‌های مالی مبدأ ${sourceCode}` + (termCode ? ` در ترم ${termCode}` : '');
    const ok = await askConfirm({
      title: 'ثبت مانده اولیه',
      body: `تراز سیستم قدیمی برای ${what} به‌عنوان «مانده اولیه» در دفتر مالی ثبت شود؟` +
        ' مبلغ = شهریهٔ قدیمی − تخفیف − پرداختی. اسناد تکراری ثبت نمی‌شوند و همه‌چیز از تب «واگرد» قابل برگشت است.',
      confirmText: 'ثبت کن',
    });
    if (!ok) return;
    setBusy('bal'); setMsg(null);
    const r = await acceptLegacyBalanceAction({
      sourceCode, termCode,
      runId: scope === 'mismatch' ? summary?.runId : undefined,
    });
    setBusy('');
    if (!r.ok || !r.result) { setMsg({ kind: 'err', text: r.error ?? 'ثبت مانده اولیه ناموفق بود.' }); return; }
    const b = r.result;
    setBalance(b);
    setMsg({
      kind: b.noStudent || b.noTerm || b.errors.length ? 'warn' : 'ok',
      text: `${fmt(b.created)} سند مانده اولیه ثبت شد (بدهکار ${fmt(b.sumDebit)} ریال، بستانکار ${fmt(b.sumCredit)} ریال).` +
        (b.skippedExisting ? ` ${fmt(b.skippedExisting)} مورد قبلاً ثبت شده بود.` : '') +
        (b.skippedZero ? ` ${fmt(b.skippedZero)} مورد تراز صفر داشت.` : '') +
        (b.noStudent ? ` ${fmt(b.noStudent)} دانشجو در سامانهٔ جدید نبود.` : '') +
        (b.noTerm ? ` ${fmt(b.noTerm)} ترم تطبیق نخورده بود.` : ''),
    });
  }

  async function applyFormulas() {
    setBusy('apply'); setMsg(null);
    const r = await applyFormulasAction(sourceCode);
    setBusy('');
    setMsg({
      kind: r.skipped.length ? 'warn' : 'ok',
      text: `${fmt(r.applied)} فرمول روی «قواعد مالی ترم» اعمال شد.` +
        (r.skipped.length ? ` ${fmt(r.skipped.length)} مورد رد شد: ` + r.skipped.slice(0, 4).map(s => `${s.formulaCode} (${s.reason})`).join('؛ ') : ''),
    });
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <h3 className="font-bold">فرمول‌های شهریه و مقایسهٔ مالی</h3>
          <p className="mt-1 text-xs leading-6 text-slate-500">
            دو فایل لازم است: <b>فرمول‌های شهریهٔ سیستم قدیمی</b> و <b>صورت‌حساب واقعی دانشجویان</b> در همان سیستم.
            سامانه فرمول را روی داده‌های هر دانشجو اجرا می‌کند و نتیجه را با مبلغی که سیستم قدیمی گرفته مقایسه می‌کند؛
            هر اختلافی قبل از سوئیچ دیده می‌شود. سپس می‌توانید همان فرمول‌ها را روی «قواعد مالی ترم» سامانهٔ جدید بنشانید.
          </p>
        </div>

        <Uploader
          kind="tuition-formula" sourceCode={sourceCode} templateKind="tuition-formula" mappable
          label="۱) فرمول‌های شهریهٔ قدیمی"
          actions={[{ id: 'f', title: 'واردسازی فرمول‌ها', url: '/api/admin/migration/import', primary: true }]}
          onDone={r => setReport(r)}
        />
        <Uploader
          kind="legacy-financial" sourceCode={sourceCode} templateKind="legacy-financial" mappable
          label="۲) صورت‌حساب/شهریهٔ واقعی قدیمی"
          actions={[{ id: 'm', title: 'واردسازی داده مالی', url: '/api/admin/migration/import', primary: true }]}
          onDone={r => setReport(r)}
        />
        <ReportBox report={report} />
        <div className="flex flex-wrap gap-2">
          <a className="btn-ghost" href={`/api/admin/migration/export?kind=legacy-financial&sourceCode=${encodeURIComponent(sourceCode)}`}>⬇ خروجی اکسل داده‌های مالی و فرمول‌ها</a>
          <button className="btn-ghost" disabled={!!busy} onClick={applyFormulas}>
            {busy === 'apply' ? '…' : '⤴ اعمال فرمول‌ها روی قواعد مالی ترم'}
          </button>
          <button className="btn-ghost" disabled={!!busy || !financialCount} onClick={() => acceptBalance('all')}>
            {busy === 'bal' ? '…' : '💠 پذیرش تراز قدیمی به‌عنوان مانده اولیه'}
          </button>
        </div>
        <Msg kind="info">
          <b>مانده اولیه:</b> بعضی مبالغ قدیمی با هیچ فرمولی بازسازی نمی‌شوند (تخفیف موردی، بخشودگی، توافق).
          به‌جای جنگیدن با اعداد، همان تراز سیستم قدیمی (<span dir="ltr">شهریه − تخفیف − پرداختی</span>) به‌عنوان
          سند افتتاحیه در دفتر مالی دانشجو ثبت می‌شود. اسناد با پیشوند <b>[مهاجرت]</b> ثبت می‌شوند، تکراری نمی‌خورند
          و از تب «ناحیهٔ موقت و واگرد» کاملاً قابل برگشت‌اند.
        </Msg>
        {balance && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <Stat label="ردیف بررسی‌شده" value={balance.total} />
            <Stat label="سند ثبت‌شده" value={balance.created} tone="green" />
            <Stat label="قبلاً ثبت‌شده" value={balance.skippedExisting} />
            <Stat label="تراز صفر" value={balance.skippedZero} />
            <Stat label="جمع بدهکار" value={balance.sumDebit} tone="red" />
            <Stat label="جمع بستانکار" value={balance.sumCredit} tone="indigo" />
          </div>
        )}
        {msg && <Msg kind={msg.kind === 'err' ? 'err' : msg.kind === 'warn' ? 'warn' : 'ok'}>{msg.text}</Msg>}
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-bold">اجرای مقایسه</h3>
        <div className="grid gap-2 md:grid-cols-12 md:items-center">
          <input className="input md:col-span-3" placeholder="کد ترم (خالی = همهٔ ترم‌ها)" value={termCode} onChange={e => setTermCode(e.target.value)} />
          <input className="input md:col-span-3" type="number" min={0} placeholder="رواداری (ریال)" value={tolerance} onChange={e => setTolerance(e.target.value)} />
          <button className="btn-primary md:col-span-3" disabled={!!busy || !financialCount} onClick={compare}>
            {busy === 'cmp' ? '…' : '🔍 مقایسهٔ فرمول با دادهٔ قدیمی'}
          </button>
          <p className="md:col-span-3 text-2xs text-slate-400">
            {fmt(formulas.length)} فرمول · {fmt(financialCount)} ردیف مالی قدیمی
          </p>
        </div>
        {!financialCount && <Msg kind="info">هنوز دادهٔ مالی قدیمی وارد نشده — فایل مرحلهٔ ۲ را بارگذاری کنید.</Msg>}

        {summary && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="کل ردیف" value={summary.total} />
              <Stat label="منطبق" value={summary.matched} tone="green" />
              <Stat label="دارای اختلاف" value={summary.mismatched} tone="red" />
              <Stat label="بدون فرمول/خطا" value={summary.unresolved} tone="amber" />
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <Stat label="جمع شهریهٔ سیستم قدیمی (ریال)" value={summary.sumLegacy} />
              <Stat label="جمع محاسبهٔ فرمول (ریال)" value={summary.sumComputed} tone="indigo" />
              <Stat label="اختلاف کل (ریال)" value={summary.sumDiff} tone={summary.sumDiff === 0 ? 'green' : 'red'} />
            </div>
            <div className="flex flex-wrap gap-2">
              <a className="btn-ghost" href={`/api/admin/migration/export?kind=tuition-compare&runId=${summary.runId}`}>⬇ خروجی اکسل این مقایسه</a>
              {(summary.mismatched > 0 || summary.unresolved > 0) && (
                <button className="btn-ghost" disabled={!!busy} onClick={() => acceptBalance('mismatch')}>
                  {busy === 'bal' ? '…' : `💠 پذیرش تراز قدیمی برای ${fmt(summary.mismatched + summary.unresolved)} ردیف مغایر`}
                </button>
              )}
            </div>

            {summary.worst.length > 0 && (
              <div className="overflow-x-auto">
                <p className="mb-1 text-xs font-bold text-slate-600">بزرگ‌ترین اختلاف‌ها</p>
                <table className="w-full text-right text-xs rt">
                  <thead><tr className="text-slate-500"><th className="p-2">دانشجو</th><th className="p-2">ترم</th><th className="p-2">قدیمی</th><th className="p-2">فرمول</th><th className="p-2">اختلاف</th><th className="p-2">وضعیت</th><th className="p-2">توضیح</th></tr></thead>
                  <tbody>
                    {summary.worst.map((w, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="p-2 font-mono" dir="ltr">{w.studentCode}</td>
                        <td className="p-2">{w.termCode}</td>
                        <td className="p-2">{fmt(w.legacy)}</td>
                        <td className="p-2">{fmt(w.computed)}</td>
                        <td className={'p-2 font-bold ' + (w.diff === 0 ? 'text-slate-500' : w.diff > 0 ? 'text-red-600' : 'text-amber-600')}>{fmt(w.diff)}</td>
                        <td className="p-2">{ST_FA[w.status] ?? w.status}</td>
                        <td className="p-2 text-2xs text-slate-500">{w.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <h3 className="mb-2 text-sm font-bold">فرمول‌های منتقل‌شده ({fmt(formulas.length)})</h3>
        <table className="w-full text-right text-xs rt">
          <thead><tr className="text-slate-500"><th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2">ترم</th><th className="p-2">مقطع</th><th className="p-2">ثابت</th><th className="p-2">نظری</th><th className="p-2">عملی</th><th className="p-2">عمومی</th><th className="p-2">عبارت</th></tr></thead>
          <tbody>
            {formulas.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-slate-400">هنوز فرمولی وارد نشده.</td></tr>}
            {formulas.map(f => (
              <tr key={f.id} className="border-t border-slate-100">
                <td className="p-2 font-mono" dir="ltr">{f.formulaCode}</td>
                <td className="p-2">{f.title}</td>
                <td className="p-2">{f.termCode}</td>
                <td className="p-2">{f.degreeCode}</td>
                <td className="p-2">{fmt(f.fixedAmount)}</td>
                <td className="p-2">{fmt(f.perUnitTheory)}</td>
                <td className="p-2">{fmt(f.perUnitPractical)}</td>
                <td className="p-2">{fmt(f.perUnitGeneral)}</td>
                <td className="p-2 text-2xs text-slate-500" dir="ltr">{f.expression}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="mb-2 text-sm font-bold">تاریخچهٔ مقایسه‌ها</h3>
        <table className="w-full text-right text-xs rt">
          <thead><tr className="text-slate-500"><th className="p-2">#</th><th className="p-2">ترم</th><th className="p-2">رواداری</th><th className="p-2">ردیف</th><th className="p-2">منطبق</th><th className="p-2">اختلاف</th><th className="p-2">بدون فرمول</th><th className="p-2">اختلاف کل</th><th className="p-2">زمان</th><th className="p-2"></th></tr></thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={10} className="p-4 text-center text-slate-400">هنوز مقایسه‌ای اجرا نشده.</td></tr>}
            {runs.map(r => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-2 font-mono">{r.id}</td>
                <td className="p-2">{r.termCode || 'همه'}</td>
                <td className="p-2">{fmt(r.tolerance)}</td>
                <td className="p-2">{fmt(r.totalRows ?? 0)}</td>
                <td className="p-2 text-emerald-700">{fmt(r.matched ?? 0)}</td>
                <td className="p-2 text-red-600">{fmt(r.mismatched ?? 0)}</td>
                <td className="p-2 text-amber-600">{fmt(r.unresolved ?? 0)}</td>
                <td className="p-2 font-bold">{fmt(r.sumDiff ?? 0)}</td>
                <td className="p-2 text-slate-500" dir="ltr">{r.createdAt ? new Date(r.createdAt).toLocaleString('fa-IR') : ''}</td>
                <td className="p-2"><a className="text-indigo-600 hover:underline" href={`/api/admin/migration/export?kind=tuition-compare&runId=${r.id}`}>اکسل</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
