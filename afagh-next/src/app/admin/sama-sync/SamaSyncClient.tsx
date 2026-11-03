'use client';

import { useActionState, useState } from 'react';
import { samaSyncAction, type SamaSyncResult } from './actions';

const INITIAL: SamaSyncResult | null = null;

const LBL = 'block text-xs font-bold text-slate-600';
const INP = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';

export default function SamaSyncClient({ terms, defaultTerm }: { terms: { termCode: string; title: string; isCurrent: number }[]; defaultTerm: string }) {
  const [state, action, pending] = useActionState(samaSyncAction, INITIAL);
  const [confirmed, setConfirmed] = useState(false);

  const st = state?.stats;

  return (
    <div className="space-y-4">
      <form action={action} className="card space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={LBL}>
            ترم مقصد
            <select name="term" defaultValue={defaultTerm} className={INP}>
              {terms.map((t) => (
                <option key={t.termCode} value={t.termCode}>
                  {t.termCode} — {t.title}{t.isCurrent ? ' (جاری)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className={LBL}>
            انکودینگ فایل
            <select name="enc" defaultValue="utf-8" className={INP}>
              <option value="utf-8">UTF-8 (خروجی sqlcmd -f 65001)</option>
              <option value="cp1256">Windows-1256 (خروجی قدیمی ویندوز)</option>
            </select>
          </label>
          <label className={LBL}>
            فایل انتخاب واحد سما (TSV) *
            <input type="file" name="enrollFile" accept=".tsv,.txt,.csv" required className={INP} />
          </label>
          <label className={LBL}>
            فایل دانشجویان سما (TSV، اختیاری)
            <input type="file" name="studentsFile" accept=".tsv,.txt,.csv" className={INP} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button name="mode" value="preview" disabled={pending} className="btn-primary !py-1.5">
            {pending ? 'در حال بررسی…' : '🔍 بررسی (بدون تغییر)'}
          </button>
          <button
            name="mode"
            value="apply"
            disabled={pending || !confirmed}
            onClick={(e) => {
              if (!confirmed) { e.preventDefault(); return; }
              if (!window.confirm('ثبت‌نام‌های تازه و نمره‌های خالی اعمال می‌شود. ادامه؟')) e.preventDefault();
            }}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-40"
          >
            ▶ اجرا
          </button>
          <label className="flex items-center gap-1.5 text-2xs text-slate-600">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="size-4" />
            می‌دانم اجرا رکورد اضافه می‌کند (حذف یا بازنویسی هرگز انجام نمی‌شود)
          </label>
        </div>

        {state && !state.ok && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">{state.error}</p>
        )}
        {state?.ok && state.mode === 'apply' && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
            ✅ {state.summary}
          </p>
        )}
        {state?.ok && state.mode === 'preview' && state.summary && (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-900">{state.summary}</p>
        )}
      </form>

      {st && (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="تطبیق" value={st.matched} />
          <Stat label="افزودن" value={st.addEnrollment} tone="ok" />
          <Stat label="نمرهٔ خالی" value={st.fillGrade} tone="ok" />
          <Stat label="اختلاف گروه" value={st.groupMismatch} tone={st.groupMismatch ? 'warn' : undefined} />
          <Stat label="ارائه ناموجود" value={st.offeringMissing} tone={st.offeringMissing ? 'warn' : undefined} />
          <Stat label="واحد اضافی" value={st.extraEnrollment} tone={st.extraEnrollment ? 'warn' : undefined} />
        </div>
      )}

      {state?.markdown && (
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">گزارش بررسی</h2>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([state.markdown ?? ''], { type: 'text/markdown;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `sama-sync-${new Date().toISOString().slice(0, 10)}.md`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="btn-ghost !py-1"
            >
              ⬇ دانلود مارک‌داون
            </button>
          </div>
          <pre dir="ltr" className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-2xs leading-6 text-slate-700">
            {state.markdown}
          </pre>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' }) {
  const cls = tone === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-slate-200 bg-slate-50 text-slate-800';
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`}>
      <p className="text-3xs opacity-80">{label}</p>
      <p className="font-mono text-base font-bold" dir="ltr">{value.toLocaleString('fa-IR')}</p>
    </div>
  );
}
