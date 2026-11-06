'use client';

import { useState } from 'react';
import { applyGradesAction, clearGradeStagingAction, compareGradesAction } from './actions';
import { ImportReport, Msg, ReportBox, Stat, Uploader, fmt } from './ui';
import { askConfirm } from '@/lib/ui-feedback';

type GradeCompare = {
  total: number; same: number; diff: number; missingInNew: number; noStudent: number; noTerm: number; noCourse: number;
  rows: { studentCode: string; termCode: string; courseCode: string; courseTitle: string | null; legacy: string; current: string; status: string; note: string }[];
};

const ST_FA: Record<string, string> = {
  SAME: 'یکسان', DIFF: 'اختلاف نمره', MISSING_IN_NEW: 'در سامانهٔ جدید نیست',
  NO_STUDENT: 'دانشجو یافت نشد', NO_TERM: 'ترم تطبیق نخورده', NO_COURSE: 'درس تطبیق نخورده', PENDING: 'مقایسه‌نشده',
};
const ST_CLS: Record<string, string> = {
  SAME: 'bg-emerald-100 text-emerald-700', DIFF: 'bg-red-100 text-red-700',
  MISSING_IN_NEW: 'bg-indigo-100 text-indigo-700', NO_STUDENT: 'bg-amber-100 text-amber-800',
  NO_TERM: 'bg-amber-100 text-amber-800', NO_COURSE: 'bg-amber-100 text-amber-800', PENDING: 'bg-slate-100 text-slate-500',
};

export default function GradesTab({ sourceCode, stats }: { sourceCode: string; stats: { status: string; count: number }[] }) {
  const [report, setReport] = useState<(ImportReport & { error?: string }) | null>(null);
  const [termCode, setTermCode] = useState('');
  const [cmp, setCmp] = useState<GradeCompare | null>(null);
  const [filter, setFilter] = useState('ALL');
  const [busy, setBusy] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [withDiff, setWithDiff] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null);

  const staged = stats.reduce((s, x) => s + x.count, 0);

  async function compare() {
    setBusy('cmp'); setMsg(null);
    const r = await compareGradesAction(sourceCode, termCode);
    setBusy('');
    if (!r.ok) { setMsg({ kind: 'err', text: r.error ?? 'مقایسه ناموفق بود.' }); return; }
    setCmp(r.result ?? null);
  }

  async function apply() {
    setBusy('apply'); setMsg(null);
    const statuses = withDiff ? ['MISSING_IN_NEW', 'DIFF'] : ['MISSING_IN_NEW'];
    const r = await applyGradesAction({ sourceCode, termCode, statuses, overwrite: withDiff && overwrite });
    setBusy('');
    if (!r.ok) { setMsg({ kind: 'err', text: r.error ?? 'اعمال ناموفق بود.' }); return; }
    setMsg({
      kind: 'ok',
      text: `${fmt(r.result?.created ?? 0)} نمره ثبت شد، ${fmt(r.result?.updated ?? 0)} به‌روزرسانی، ${fmt(r.result?.skipped ?? 0)} رد شد.`,
    });
    compare();
  }

  async function clearStaging() {
    const ok = await askConfirm({
      title: 'پاک‌کردن نمرات موقت',
      body: 'همهٔ نمرات موقتِ این مبدأ از جدول staging حذف شود؟ (نمرات ثبت‌شده در سامانه دست نمی‌خورد)',
      confirmText: 'پاک کن',
      danger: true,
    });
    if (!ok) return;
    setBusy('clear');
    const r = await clearGradeStagingAction(sourceCode);
    setBusy('');
    setCmp(null);
    setMsg({ kind: 'ok', text: `${fmt(r.deleted)} ردیف موقت حذف شد.` });
  }

  const shown = cmp?.rows.filter(r => filter === 'ALL' || r.status === filter) ?? [];

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <h3 className="font-bold">انتقال نمرات</h3>
          <p className="mt-1 text-xs leading-6 text-slate-500">
            نمرات اول در یک جدول موقت (staging) می‌نشینند، بعد با نمرات فعلی سامانه <b>مقایسه</b> می‌شوند و تنها
            چیزی که شما تأیید کنید اعمال می‌شود. نمرهٔ کیفی (قبول/مردود/معاف/الف‌ب‌ج) هم پشتیبانی می‌شود.
            درس و ترم از «میز تطبیق کدها» ترجمه می‌شوند.
          </p>
        </div>

        <Uploader
          kind="grades" sourceCode={sourceCode} templateKind="grades" mappable
          label="فایل نمرات سیستم قدیمی"
          actions={[{ id: 'g', title: 'واردسازی نمرات', url: '/api/admin/migration/import', primary: true }]}
          onDone={r => setReport(r)}
        />
        <ReportBox report={report} />

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="ردیف در جدول موقت" value={staged} tone="indigo" />
          {stats.filter(s => s.status !== 'PENDING').slice(0, 3).map(s => (
            <Stat key={s.status} label={ST_FA[s.status] ?? s.status} value={s.count} />
          ))}
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-bold">مقایسه و اعمال</h3>
        <div className="grid gap-2 md:grid-cols-12 md:items-center">
          <input className="input md:col-span-3" placeholder="کد ترم (خالی = همه)" value={termCode} onChange={e => setTermCode(e.target.value)} />
          <button className="btn-ghost md:col-span-3" disabled={!!busy || !staged} onClick={compare}>{busy === 'cmp' ? '…' : '🔍 مقایسه با سامانه'}</button>
          <button className="btn-primary md:col-span-3" disabled={!!busy || !cmp} onClick={apply}>{busy === 'apply' ? '…' : '⤴ اعمال نمرات'}</button>
          <a className="btn-ghost md:col-span-3 text-center" href={`/api/admin/migration/export?kind=grades&sourceCode=${encodeURIComponent(sourceCode)}${termCode ? `&termCode=${encodeURIComponent(termCode)}` : ''}`}>⬇ خروجی اکسل نمرات</a>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={withDiff} onChange={e => setWithDiff(e.target.checked)} />
            ردیف‌های «اختلاف نمره» هم اعمال شوند
          </label>
          <label className={'flex items-center gap-2 ' + (withDiff ? '' : 'opacity-40')}>
            <input type="checkbox" disabled={!withDiff} checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
            نمرهٔ موجود در سامانه بازنویسی شود
          </label>
          <button className="ms-auto text-2xs text-slate-400 hover:text-red-600" disabled={!!busy} onClick={clearStaging}>پاک‌کردن جدول موقت</button>
        </div>
        {msg && <Msg kind={msg.kind === 'err' ? 'err' : msg.kind === 'warn' ? 'warn' : 'ok'}>{msg.text}</Msg>}
        {!staged && <Msg kind="info">هنوز نمره‌ای وارد نشده — فایل اکسل نمرات را بارگذاری کنید.</Msg>}

        {cmp && (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
              <Stat label="کل" value={cmp.total} />
              <Stat label="یکسان" value={cmp.same} tone="green" />
              <Stat label="اختلاف نمره" value={cmp.diff} tone="red" />
              <Stat label="در سامانه نیست" value={cmp.missingInNew} tone="indigo" />
              <Stat label="دانشجو نیست" value={cmp.noStudent} tone="amber" />
              <Stat label="کد تطبیق‌نشده" value={cmp.noTerm + cmp.noCourse} tone="amber" />
            </div>
            <div className="flex flex-wrap gap-2">
              {['ALL', 'DIFF', 'MISSING_IN_NEW', 'SAME', 'NO_STUDENT', 'NO_TERM', 'NO_COURSE'].map(s => (
                <button key={s} onClick={() => setFilter(s)}
                  className={'rounded-lg px-2 py-1 text-2xs ' + (filter === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600')}>
                  {s === 'ALL' ? 'همه' : ST_FA[s]}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs rt">
                <thead><tr className="text-slate-500"><th className="p-2">دانشجو</th><th className="p-2">ترم</th><th className="p-2">درس</th><th className="p-2">نمرهٔ قدیمی</th><th className="p-2">نمرهٔ فعلی</th><th className="p-2">وضعیت</th><th className="p-2">توضیح</th></tr></thead>
                <tbody>
                  {shown.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-400">ردیفی با این فیلتر نیست.</td></tr>}
                  {shown.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="p-2 font-mono" dir="ltr">{r.studentCode}</td>
                      <td className="p-2">{r.termCode}</td>
                      <td className="p-2">{r.courseTitle || r.courseCode}</td>
                      <td className="p-2 font-bold">{r.legacy}</td>
                      <td className="p-2">{r.current}</td>
                      <td className="p-2"><span className={'badge ' + (ST_CLS[r.status] ?? '')}>{ST_FA[r.status] ?? r.status}</span></td>
                      <td className="p-2 text-2xs text-slate-500">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > 200 && <p className="p-2 text-2xs text-slate-400">۲۰۰ ردیف اول نمایش داده شد — برای فهرست کامل خروجی اکسل بگیرید.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
