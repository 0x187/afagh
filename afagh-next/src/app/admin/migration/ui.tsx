'use client';

import { useRef, useState } from 'react';

// ═══ اجزای مشترک میز کار مهاجرت ═══

export type ImportReport = {
  kind: string; fileName: string; sheet: string; total: number;
  inserted: number; updated: number; invalid: number;
  errors: { row: number; msg: string }[]; warnings: { row: number; msg: string }[];
  sample?: Record<string, unknown>[]; sheets?: string[];
};

export const fmt = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString('fa-IR');

export function Stat({ label, value, tone = 'slate' }: { label: string; value: number | string; tone?: 'slate' | 'green' | 'red' | 'amber' | 'indigo' }) {
  const color = {
    slate: 'text-slate-700', green: 'text-emerald-600', red: 'text-red-600',
    amber: 'text-amber-500', indigo: 'text-indigo-600',
  }[tone];
  return (
    <div className="rounded-xl bg-slate-50 p-2 text-center">
      <p className={'text-xl font-bold ' + color}>{typeof value === 'number' ? fmt(value) : value}</p>
      <p className="text-2xs text-slate-500">{label}</p>
    </div>
  );
}

export function Msg({ kind, children }: { kind: 'err' | 'ok' | 'warn' | 'info'; children: React.ReactNode }) {
  const cls = {
    err: 'bg-red-50 text-red-800', ok: 'bg-emerald-50 text-emerald-800',
    warn: 'bg-amber-50 text-amber-900', info: 'bg-slate-50 text-slate-700',
  }[kind];
  return <div className={`rounded-xl p-3 text-xs leading-6 ${cls}`}>{children}</div>;
}

export type InspectField = { key: string; title: string; required: boolean; hint?: string; detectedIndex: number; detectedHeader: string | null };
export type InspectSheet = { sheet: string; headers: string[]; rowCount: number; fields: InspectField[]; missingRequired: string[]; sample: string[][] };
export type InspectResult = { fileName: string; kind: string; sheets: InspectSheet[]; best: string | null };

/**
 * آپلودر مشترک: انتخاب فایل اکسل/CSV + (اختیاری) گام «بررسی و نگاشت ستون‌ها» + عملیات.
 * جادوگر سه‌گامی: ۱) انتخاب فایل  ۲) بررسی ستون‌ها و اصلاح نگاشت  ۳) واردسازی.
 */
export function Uploader({
  kind, sourceCode, label, actions, onDone, templateKind, mappable,
}: {
  kind: string;
  sourceCode: string;
  label: string;
  templateKind?: string;
  /** گام «بررسی ستون‌ها» را فعال می‌کند (فقط برای انواعی که فرهنگ ستون دارند) */
  mappable?: boolean;
  actions: { id: string; title: string; url: string; primary?: boolean; extra?: Record<string, string> }[];
  onDone: (report: ImportReport & { error?: string }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [name, setName] = useState('');
  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [sheet, setSheet] = useState('');
  const [map, setMap] = useState<Record<string, number>>({});

  const curSheet = inspect?.sheets.find(s => s.sheet === sheet) ?? null;

  /** گام ۲: فایل را بررسی کن و حدس ستون‌ها را نشان بده */
  async function doInspect() {
    const f = fileRef.current?.files?.[0];
    if (!f) { onDone({ error: 'اول فایل اکسل (xlsx) یا CSV را انتخاب کنید.' } as ImportReport & { error: string }); return; }
    setBusy('inspect');
    try {
      const fd = new FormData();
      fd.set('file', f); fd.set('kind', kind);
      const r = await fetch('/api/admin/migration/inspect', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) { onDone({ error: j.error || `HTTP ${r.status}` } as ImportReport & { error: string }); return; }
      const res = j as InspectResult;
      setInspect(res);
      const best = res.best ?? res.sheets[0]?.sheet ?? '';
      setSheet(best);
      const sh = res.sheets.find(s => s.sheet === best);
      setMap(Object.fromEntries((sh?.fields ?? []).map(f2 => [f2.key, f2.detectedIndex])));
    } catch (e) {
      onDone({ error: (e as Error).message } as ImportReport & { error: string });
    } finally { setBusy(''); }
  }

  function selectSheet(name2: string) {
    setSheet(name2);
    const sh = inspect?.sheets.find(s => s.sheet === name2);
    setMap(Object.fromEntries((sh?.fields ?? []).map(f2 => [f2.key, f2.detectedIndex])));
  }

  async function run(a: { id: string; url: string; extra?: Record<string, string> }) {
    const f = fileRef.current?.files?.[0];
    if (!f) { onDone({ error: 'اول فایل اکسل (xlsx) یا CSV را انتخاب کنید.' } as ImportReport & { error: string }); return; }
    setBusy(a.id);
    const fd = new FormData();
    fd.set('file', f);
    fd.set('kind', kind);
    fd.set('sourceCode', sourceCode);
    // اگر کاربر ستون‌ها را دستی نگاشت کرده، همان اولویت دارد
    if (inspect && sheet) { fd.set('sheet', sheet); fd.set('columnMap', JSON.stringify(map)); }
    for (const [k, v] of Object.entries(a.extra ?? {})) fd.set(k, v);
    try {
      const r = await fetch(a.url, { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({ error: 'پاسخ نامعتبر از سرور' }));
      onDone(r.ok ? j : { ...j, error: j.error || `HTTP ${r.status}` });
    } catch (e) {
      onDone({ error: (e as Error).message } as ImportReport & { error: string });
    } finally {
      setBusy('');
    }
  }

  // چیدمان عمدی: دکمه‌ها **زیرِ** انتخاب فایل و در تمام عرض.
  // پیش‌تر همه در یک ردیف ۱۲ستونی بودند و چون این کامپوننت خودش داخل یک
  // ستون باریک قرار می‌گیرد، چهار دکمه در فضای بسیار کم فشرده و عملاً از
  // دید کاربر خارج می‌شدند («دکمهٔ بارگذاری نمی‌بینم»).
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {label && <label className="shrink-0 text-xs font-bold text-slate-600">{label}</label>}
        <input
          ref={fileRef} type="file" className="input min-w-0 flex-1"
          accept=".xlsx,.xlsm,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          onChange={e => { setName(e.target.files?.[0]?.name ?? ''); setInspect(null); setMap({}); }}
        />
      </div>

      {name && (
        <p className="rounded-lg bg-emerald-50 px-2 py-1 text-2xs text-emerald-800">
          فایل انتخاب‌شده: <span dir="ltr" className="font-mono">{name}</span> — حالا یکی از دکمه‌های زیر را بزنید.
        </p>
      )}

      <div className="flex flex-wrap items-stretch gap-2">
        {mappable && (
          <button className="btn-ghost whitespace-nowrap" disabled={!!busy} onClick={doInspect}>
            {busy === 'inspect' ? '…' : '🔎 بررسی ستون‌ها'}
          </button>
        )}
        {actions.map(a => (
          <button key={a.id} disabled={!!busy}
            className={(a.primary ? 'btn-primary' : 'btn-ghost') + ' whitespace-nowrap px-4 font-bold'}
            onClick={() => run(a)}>
            {busy === a.id ? '… در حال پردازش' : a.title}
          </button>
        ))}
        {templateKind && (
          <a className="btn-ghost whitespace-nowrap" href={`/api/admin/migration/template?kind=${templateKind}`}>
            ⬇ قالب اکسل
          </a>
        )}
      </div>

      {curSheet && (
        <div className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-700">نگاشت ستون‌ها</span>
            {inspect!.sheets.length > 1 && (
              <select className="input w-48 py-1 text-xs" value={sheet} onChange={e => selectSheet(e.target.value)}>
                {inspect!.sheets.map(s2 => <option key={s2.sheet} value={s2.sheet}>{s2.sheet} ({fmt(s2.rowCount)} ردیف)</option>)}
              </select>
            )}
            <span className="text-2xs text-slate-500">
              {fmt(curSheet.rowCount)} ردیف · {fmt(curSheet.headers.length)} ستون
            </span>
            <button className="btn-ghost py-1 text-2xs" onClick={() => setInspect(null)}>بستن</button>
          </div>
          {curSheet.missingRequired.length > 0 && (
            <Msg kind="warn">ستون‌های الزامیِ تشخیص‌داده‌نشده: <b>{curSheet.missingRequired.join('، ')}</b> — از فهرست زیر ستون درست را انتخاب کنید.</Msg>
          )}
          <div className="grid gap-2 md:grid-cols-3">
            {curSheet.fields.map(f2 => (
              <label key={f2.key} className="flex items-center gap-2 text-2xs" title={f2.hint ?? ''}>
                <span className={'w-28 shrink-0 ' + (f2.required ? 'font-bold text-slate-700' : 'text-slate-500')}>
                  {f2.title}{f2.required ? ' *' : ''}{f2.hint ? ' ⓘ' : ''}
                </span>
                <select
                  className={'input flex-1 py-1 text-2xs ' + ((map[f2.key] ?? -1) < 0 && f2.required ? 'border-red-300' : '')}
                  value={String(map[f2.key] ?? -1)}
                  onChange={e => setMap(m => ({ ...m, [f2.key]: Number(e.target.value) }))}>
                  <option value="-1">— ندارد —</option>
                  {curSheet.headers.map((h, i) => <option key={i} value={i}>{h || `ستون ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {curSheet.sample.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-3xs rt">
                <thead><tr className="text-slate-500">{curSheet.headers.map((h, i) => <th key={i} className="p-1">{h || i + 1}</th>)}</tr></thead>
                <tbody>
                  {curSheet.sample.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {curSheet.headers.map((_, c) => <td key={c} className="p-1 text-slate-600">{r[c]}</td>)}
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

export function ReportBox({ report }: { report: (ImportReport & { error?: string }) | null }) {
  if (!report) return null;
  if (report.error) return <Msg kind="err">{report.error}</Msg>;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="ردیف فایل" value={report.total} />
        <Stat label="ثبت جدید" value={report.inserted} tone="green" />
        <Stat label="به‌روزرسانی" value={report.updated} tone="indigo" />
        <Stat label="نامعتبر" value={report.invalid} tone="red" />
        <Stat label="هشدار" value={report.warnings?.length ?? 0} tone="amber" />
      </div>
      {report.sheets?.length ? <p className="text-2xs text-slate-400">برگه‌های فایل: {report.sheets.join('، ')} — برگهٔ استفاده‌شده: <b>{report.sheet}</b></p> : null}
      {report.errors?.length > 0 && (
        <Msg kind="err">
          <p className="mb-1 font-bold">خطاها:</p>
          {report.errors.slice(0, 8).map((e, i) => <p key={i}>{e.row ? `خط ${e.row}: ` : ''}{e.msg}</p>)}
          {report.errors.length > 8 && <p>… و {fmt(report.errors.length - 8)} مورد دیگر</p>}
        </Msg>
      )}
      {report.warnings?.length > 0 && (
        <Msg kind="warn">
          <p className="mb-1 font-bold">هشدارها:</p>
          {report.warnings.slice(0, 6).map((w, i) => <p key={i}>{w.row ? `خط ${w.row}: ` : ''}{w.msg}</p>)}
          {report.warnings.length > 6 && <p>… و {fmt(report.warnings.length - 6)} مورد دیگر</p>}
        </Msg>
      )}
    </div>
  );
}
