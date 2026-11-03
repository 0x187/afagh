'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  auditGroupsAction, auditSummaryAction, batchRowsAction, deleteBatchAction,
  listBatchesAction, reprocessBatchAction, rollbackAction,
} from './actions';
import { Msg, Stat, fmt } from './ui';
import { askConfirm } from '@/lib/ui-feedback';

// ═══ ناحیهٔ موقت و واگرد ═══
// هر فایل آپلودشده یک «دسته» است؛ سطرهای خام نگه داشته می‌شوند تا:
//   • سطرهای خطادار بعد از تکمیل نگاشت کدها دوباره پردازش شوند (بدون آپلود مجدد)
//   • هر چیزی که روی جدول‌های عملیاتی نوشته شده قابل «واگرد» باشد

type Batch = {
  id: number; sourceCode: string; importType: string; fileName: string | null; sheetName: string | null;
  totalRows: number; okRows: number; errorRows: number; status: string;
  createdAt: string | null; processedAt: string | null; rolledBackAt: string | null;
  auditOpen: number; auditTotal: number;
};
type Row = { id: number; rowNumber: number; status: string; error: string | null; data: Record<string, string> };
type Group = { opGroup: string; batchId: number | null; count: number; revertable: number; at: string | null };
type Rollback = {
  batchId: number | null; total: number; deleted: number; restored: number;
  alreadyReverted: number; missing: number; changedAfterwards: number; blocked: number;
  details: { table: string; rowId: number; op: string; result: string; note?: string }[];
};

const KIND_FA: Record<string, string> = {
  codes: 'تطبیق کدها', 'tuition-formula': 'فرمول شهریه',
  'legacy-financial': 'دادهٔ مالی قدیمی', grades: 'نمرات',
};
const STATUS_FA: Record<string, string> = {
  PARSED: 'خوانده‌شده', PROCESSED: 'پردازش کامل', PARTIAL: 'ناقص (خطادار)', ROLLED_BACK: 'واگردشده',
};
const GROUP_FA: Record<string, string> = {
  'apply-grades': 'اعمال نمرات روی سامانه',
  'apply-formulas': 'اعمال فرمول روی قواعد مالی ترم',
  'opening-balance': 'ثبت مانده اولیه در دفتر مالی',
};
const TABLE_FA: Record<string, string> = {
  enrollments: 'ثبت‌نام/نمره', courses: 'درس', course_offerings: 'ارائهٔ درس',
  term_financial_rules: 'قاعدهٔ مالی ترم', student_ledger: 'دفتر مالی دانشجو',
  students: 'دانشجو', users: 'کاربر', academic_terms: 'ترم', financial_clearances: 'تسویه',
};
const RESULT_FA: Record<string, string> = {
  DELETED: 'حذف شد', RESTORED: 'بازگردانده شد', MISSING: 'سطر نبود',
  CHANGED_AFTER: 'بعد از مهاجرت تغییر کرده', BLOCKED: 'مسدود',
};

export default function BatchesTab({ sourceCode }: { sourceCode: string }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openBatch, setOpenBatch] = useState<number | null>(null);
  const [audit, setAudit] = useState<{ table: string; op: string; count: number; reverted: number }[] | null>(null);
  const [rollback, setRollback] = useState<Rollback | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'warn' | 'info'; text: string } | null>(null);
  const [force, setForce] = useState(false);

  const reload = useCallback(async () => {
    const [b, g] = await Promise.all([listBatchesAction(sourceCode), auditGroupsAction(sourceCode)]);
    setBatches(b.batches); setGroups(g.groups);
  }, [sourceCode]);

  useEffect(() => { reload().catch(() => {}); }, [reload]);

  async function showRows(id: number) {
    if (openBatch === id) { setOpenBatch(null); setRows(null); setAudit(null); return; }
    setBusy('rows:' + id);
    const [r, a] = await Promise.all([batchRowsAction(id, 'ERROR'), auditSummaryAction({ batchId: id })]);
    setBusy(''); setOpenBatch(id); setRows(r.rows); setAudit(a.rows);
  }

  async function reprocess(id: number, all: boolean) {
    setBusy('re:' + id); setMsg(null); setRollback(null);
    const r = await reprocessBatchAction(id, all);
    setBusy('');
    if (!r.ok) { setMsg({ kind: 'err', text: r.error ?? 'پردازش دوباره ناموفق بود.' }); return; }
    setMsg({
      kind: r.invalid ? 'warn' : 'ok',
      text: `${fmt(r.reprocessed ?? 0)} سطر دوباره پردازش شد — ثبت جدید ${fmt(r.inserted ?? 0)}، به‌روزرسانی ${fmt(r.updated ?? 0)}، هنوز خطادار ${fmt(r.invalid ?? 0)}.`,
    });
    await reload();
    if (openBatch === id) { const rr = await batchRowsAction(id, 'ERROR'); setRows(rr.rows); }
  }

  async function doRollback(input: { batchId?: number; opGroup?: string }) {
    const what = input.batchId ? `دستهٔ ${input.batchId}` : GROUP_FA[input.opGroup ?? ''] ?? input.opGroup;
    const okRollback = await askConfirm({
      title: 'واگرد عملیات مهاجرت',
      body: `واگرد ${what}؟ هر چیزی که این عملیات روی سامانه نوشته حذف یا به مقدار قبلی برگردانده می‌شود.` +
        (force ? ' ⚠ حالت اجباری فعال است: سطرهایی که بعد از مهاجرت دستی تغییر کرده‌اند هم برگردانده می‌شوند.' : ''),
      confirmText: 'واگرد کن',
      danger: true,
    });
    if (!okRollback) return;
    setBusy('rb'); setMsg(null);
    const r = await rollbackAction({ ...input, sourceCode: input.opGroup ? sourceCode : undefined, force });
    setBusy('');
    if (!r.ok) { setMsg({ kind: 'err', text: r.error ?? 'واگرد ناموفق بود.' }); return; }
    setRollback(r.result ?? null);
    const res = r.result!;
    setMsg({
      kind: res.blocked || res.changedAfterwards ? 'warn' : 'ok',
      text: `واگرد انجام شد: ${fmt(res.deleted)} حذف، ${fmt(res.restored)} بازگردانده‌شده` +
        (res.changedAfterwards ? `، ${fmt(res.changedAfterwards)} سطر چون بعد از مهاجرت تغییر کرده دست‌نخورده ماند` : '') +
        (res.blocked ? `، ${fmt(res.blocked)} مورد مسدود (وابستگی)` : '') + '.',
    });
    await reload();
  }

  async function removeBatch(id: number) {
    if (!(await askConfirm({ title: 'تأیید عملیات', body: `دستهٔ ${id} از ناحیهٔ موقت حذف شود؟ (دادهٔ ثبت‌شده روی سامانه دست نمی‌خورد؛ برای برگرداندن آن از «واگرد» استفاده کنید.)`, confirmText: 'تأیید', cancelText: 'انصراف', danger: true }))) return;
    setBusy('del:' + id);
    await deleteBatchAction(id);
    setBusy(''); setOpenBatch(null); setRows(null);
    await reload();
  }

  const totalRows = batches.reduce((s, b) => s + b.totalRows, 0);
  const totalErr = batches.reduce((s, b) => s + b.errorRows, 0);
  const totalOpen = batches.reduce((s, b) => s + b.auditOpen, 0);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <h3 className="font-bold">ناحیهٔ موقت و واگرد</h3>
          <p className="mt-1 text-xs leading-6 text-slate-500">
            هر فایلی که بارگذاری می‌کنید ابتدا <b>خام</b> در ناحیهٔ موقت ذخیره می‌شود و بعد پردازش.
            به همین دلیل دو کار همیشه ممکن است: <b>پردازش دوبارهٔ سطرهای خطادار</b> بعد از تکمیل نگاشت کدها
            (بدون آپلود مجدد فایل) و <b>واگرد کامل</b> هر عملیاتی که روی سامانه نوشته شده — مثلاً نمراتی که
            اشتباهی روی ترم دیگری اعمال شده‌اند.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="دسته" value={batches.length} />
          <Stat label="سطر خام" value={totalRows} tone="indigo" />
          <Stat label="سطر خطادار" value={totalErr} tone="red" />
          <Stat label="نوشتهٔ واگردپذیر" value={totalOpen} tone="amber" />
        </div>
        <label className="flex items-center gap-2 text-2xs text-slate-600">
          <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
          واگرد اجباری: سطرهایی که <b>بعد از</b> مهاجرت دستی تغییر کرده‌اند هم برگردانده شوند (با احتیاط)
        </label>
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      </div>

      <div className="card overflow-x-auto">
        <h3 className="mb-2 text-sm font-bold">دسته‌های واردشده</h3>
        <table className="w-full text-right text-xs rt">
          <thead>
            <tr className="text-slate-500">
              <th className="p-2">#</th><th className="p-2">نوع</th><th className="p-2">فایل / برگه</th>
              <th className="p-2">سطر</th><th className="p-2">موفق</th><th className="p-2">خطادار</th>
              <th className="p-2">وضعیت</th><th className="p-2">واگردپذیر</th><th className="p-2">زمان</th><th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 && <tr><td colSpan={10} className="p-4 text-center text-slate-400">هنوز فایلی وارد نشده.</td></tr>}
            {batches.map(b => (
              <tr key={b.id} className={'border-t border-slate-100 ' + (openBatch === b.id ? 'bg-indigo-50/40' : '')}>
                <td className="p-2 font-mono">{b.id}</td>
                <td className="p-2">{KIND_FA[b.importType] ?? b.importType}</td>
                <td className="p-2" dir="ltr">{b.fileName}<span className="text-slate-400"> / {b.sheetName}</span></td>
                <td className="p-2">{fmt(b.totalRows)}</td>
                <td className="p-2 text-emerald-700">{fmt(b.okRows)}</td>
                <td className={'p-2 ' + (b.errorRows ? 'font-bold text-red-600' : 'text-slate-400')}>{fmt(b.errorRows)}</td>
                <td className="p-2">
                  <span className={'badge ' + (b.status === 'PROCESSED' ? 'bg-emerald-100 text-emerald-700'
                    : b.status === 'PARTIAL' ? 'bg-amber-100 text-amber-800'
                    : b.status === 'ROLLED_BACK' ? 'bg-slate-200 text-slate-600' : 'bg-slate-100 text-slate-600')}>
                    {STATUS_FA[b.status] ?? b.status}
                  </span>
                </td>
                <td className="p-2 text-amber-600">{fmt(b.auditOpen)}<span className="text-slate-400"> / {fmt(b.auditTotal)}</span></td>
                <td className="p-2 text-slate-500" dir="ltr">{b.createdAt ? new Date(b.createdAt).toLocaleString('fa-IR') : ''}</td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    <button className="text-indigo-600 hover:underline" disabled={!!busy} onClick={() => showRows(b.id)}>
                      {openBatch === b.id ? 'بستن' : 'جزئیات'}
                    </button>
                    {b.errorRows > 0 && (
                      <button className="text-emerald-700 hover:underline" disabled={!!busy} onClick={() => reprocess(b.id, false)}>
                        {busy === 're:' + b.id ? '…' : 'پردازش دوبارهٔ خطادارها'}
                      </button>
                    )}
                    <button className="text-slate-500 hover:underline" disabled={!!busy} onClick={() => reprocess(b.id, true)}>پردازش کل دسته</button>
                    {b.auditOpen > 0 && (
                      <button className="font-bold text-red-600 hover:underline" disabled={!!busy} onClick={() => doRollback({ batchId: b.id })}>
                        ↩ واگرد این دسته
                      </button>
                    )}
                    <button className="text-slate-400 hover:underline" disabled={!!busy} onClick={() => removeBatch(b.id)}>حذف</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {openBatch && audit && audit.length > 0 && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-2xs">
            <p className="mb-1 font-bold text-slate-600">این دسته روی سامانه چه نوشته است:</p>
            <ul className="space-y-0.5">
              {audit.map((a, i) => (
                <li key={i}>
                  {TABLE_FA[a.table] ?? a.table} — {a.op === 'INSERT' ? 'ثبت جدید' : 'به‌روزرسانی'}: <b>{fmt(a.count)}</b>
                  {a.reverted > 0 && <span className="text-slate-400"> (واگردشده: {fmt(a.reverted)})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {openBatch && rows && (
          <div className="mt-3 overflow-x-auto">
            <p className="mb-1 text-xs font-bold text-slate-600">سطرهای خطادار دستهٔ {openBatch} ({fmt(rows.length)})</p>
            {rows.length === 0 ? <p className="p-2 text-2xs text-slate-400">سطر خطاداری نمانده.</p> : (
              <table className="w-full text-right text-2xs rt">
                <thead><tr className="text-slate-500"><th className="p-1">خط</th><th className="p-1">خطا</th><th className="p-1">دادهٔ خام</th></tr></thead>
                <tbody>
                  {rows.slice(0, 100).map(r => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="p-1 font-mono">{r.rowNumber}</td>
                      <td className="p-1 text-red-600">{r.error}</td>
                      <td className="p-1 text-slate-500" dir="auto">
                        {Object.entries(r.data).slice(0, 6).map(([k, v]) => `${k}: ${v}`).join(' | ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <h3 className="mb-2 text-sm font-bold">عملیات واگردپذیر</h3>
        <p className="mb-2 text-2xs text-slate-500">
          کارهایی مثل «اعمال نمرات» یا «ثبت مانده اولیه» فایل ندارند، ولی همه‌شان سند دارند و برگشت‌پذیرند.
        </p>
        <table className="w-full text-right text-xs rt">
          <thead><tr className="text-slate-500"><th className="p-2">عملیات</th><th className="p-2">دسته</th><th className="p-2">تعداد نوشته</th><th className="p-2">واگردپذیر</th><th className="p-2">آخرین اجرا</th><th className="p-2"></th></tr></thead>
          <tbody>
            {groups.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">هنوز چیزی روی سامانه نوشته نشده.</td></tr>}
            {groups.map((g, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="p-2">{GROUP_FA[g.opGroup] ?? g.opGroup}</td>
                <td className="p-2 font-mono">{g.batchId ?? '—'}</td>
                <td className="p-2">{fmt(g.count)}</td>
                <td className={'p-2 ' + (g.revertable ? 'text-amber-600' : 'text-slate-400')}>{fmt(g.revertable)}</td>
                <td className="p-2 text-slate-500" dir="ltr">{g.at ? new Date(g.at).toLocaleString('fa-IR') : ''}</td>
                <td className="p-2">
                  {g.revertable > 0 && (
                    <button className="font-bold text-red-600 hover:underline" disabled={!!busy}
                      onClick={() => doRollback(g.batchId ? { batchId: g.batchId } : { opGroup: g.opGroup })}>
                      ↩ واگرد
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rollback && (
        <div className="card space-y-2">
          <h3 className="text-sm font-bold">نتیجهٔ آخرین واگرد</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat label="کل سند" value={rollback.total} />
            <Stat label="حذف‌شده" value={rollback.deleted} tone="green" />
            <Stat label="بازگردانده‌شده" value={rollback.restored} tone="indigo" />
            <Stat label="تغییرکرده (دست‌نخورده)" value={rollback.changedAfterwards} tone="amber" />
            <Stat label="مسدود" value={rollback.blocked} tone="red" />
          </div>
          {rollback.details.filter(d => d.result !== 'DELETED' && d.result !== 'RESTORED').length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-2xs rt">
                <thead><tr className="text-slate-500"><th className="p-1">جدول</th><th className="p-1">شناسه</th><th className="p-1">نتیجه</th><th className="p-1">توضیح</th></tr></thead>
                <tbody>
                  {rollback.details.filter(d => d.result !== 'DELETED' && d.result !== 'RESTORED').slice(0, 50).map((d, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="p-1">{TABLE_FA[d.table] ?? d.table}</td>
                      <td className="p-1 font-mono">{d.rowId}</td>
                      <td className="p-1">{RESULT_FA[d.result] ?? d.result}</td>
                      <td className="p-1 text-slate-500">{d.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
