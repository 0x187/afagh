'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { previewReportAction, saveSavedReport } from '../saved/actions';
import type { CatalogOptions, SavedReportRow } from '../saved/types';
import type {
  AggKind,
  FilterOp,
  ReportVisibility,
  SavedReportConfig,
  SourceMeta,
} from '../catalog/types';
import { faNum, formatReportCell as fmtCell } from '@/lib/report-format';
import { faIncludes } from '@/lib/persian-search';
import ReportPrint from '@/components/ui/ReportPrint';

/** هویت بصری سند چاپی (از سرور؛ نام/آرم دانشگاه + امضاهای تنظیمات) */
type PrintBrand = { universityTitle: string; universityLogoUrl: string; signers: string[] };

const ROLE_OPTIONS = [
  { code: 'ADMIN', title: 'مدیر سامانه' },
  { code: 'EDU_EXPERT', title: 'کارشناس آموزشی' },
  { code: 'FINANCE_EXPERT', title: 'کارشناس مالی' },
  { code: 'FINANCE', title: 'کارشناس مالی ۲' },
  { code: 'CASHIER', title: 'صندوق' },
  { code: 'ARCHIVE_EXPERT', title: 'کارشناس بایگانی' },
  { code: 'VICE_EDU', title: 'معاون آموزشی' },
  { code: 'MILITARY_OFFICER', title: 'مسئول نظام وظیفه' },
];

const OP_LABELS: Record<FilterOp, string> = {
  eq: 'برابر', ne: 'نابرابر',
  gt: 'بزرگ‌تر', gte: 'بزرگ‌تر یا مساوی', lt: 'کوچک‌تر', lte: 'کوچک‌تر یا مساوی',
  like: 'شامل', in: 'یکی از', between: 'بین',
  isnull: 'خالی است', notnull: 'خالی نیست',
};

const AGG_LABELS: Record<AggKind, string> = {
  sum: 'جمع', avg: 'میانگین', min: 'کمینه', max: 'بیشینه',
  count: 'تعداد', count_distinct: 'تعداد یکتا',
};

const FORMAT_LABELS: Record<string, string> = {
  '': 'عادی', DATE: 'تاریخ', DATETIME: 'تاریخ و ساعت', MONEY: 'مبلغ', NUMBER: 'عدد',
};

type Col = { field: string; alias?: string; format?: string; agg?: AggKind };
type Flt = { field: string; op: FilterOp; value: string };

export default function BuilderClient({
  sources,
  options,
  initial,
  brand,
}: {
  sources: SourceMeta[];
  options: CatalogOptions;
  initial: SavedReportRow | null;
  brand: PrintBrand;
}) {
  const [sourceKey, setSourceKey] = useState<string>(initial?.sourceKey ?? sources[0]?.key ?? '');
  const [cols, setCols] = useState<Col[]>(initial?.config?.columns ?? []);
  const [filters, setFilters] = useState<Flt[]>(
    (initial?.config?.filters ?? []).map(f => ({
      field: f.field,
      op: f.op,
      value: Array.isArray(f.value) ? f.value[0] ?? '' : f.value ?? '',
    })),
  );
  const [groupBy, setGroupBy] = useState<string[]>(initial?.config?.groupBy ?? []);
  const [order, setOrder] = useState<Record<string, 'asc' | 'desc'>>(() => {
    const o: Record<string, 'asc' | 'desc'> = {};
    for (const x of initial?.config?.orderBy ?? []) o[x.field] = x.dir;
    return o;
  });
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [visibility, setVisibility] = useState<ReportVisibility>(initial?.visibility ?? 'PRIVATE');
  const [allowedRoles, setAllowedRoles] = useState<string[]>(initial?.allowedRoles ?? []);

  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<{
    columns: { key: string; title: string; format?: string }[];
    rows: Record<string, unknown>[];
    total: number; page: number; totalPages: number; notes?: string[];
  } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const source = useMemo(() => sources.find(s => s.key === sourceKey) ?? null, [sources, sourceKey]);
  const fieldMap = useMemo(() => new Map((source?.fields ?? []).map(f => [f.key, f])), [source]);

  const optionsFor = (f: { options?: { value: string; label: string }[]; ref?: string }) => {
    if (f.options?.length) return f.options;
    if (!f.ref) return null;
    const map: Record<string, { value: string; label: string }[]> = {
      terms: options.terms,
      financialTerms: options.financialTerms,
      ledgerTypes: options.ledgerTypes,
      depositTypes: options.depositTypes,
      paymentStatuses: options.paymentStatuses,
      faculties: options.faculties,
      majors: options.majors,
    };
    return map[f.ref] ?? null;
  };

  const visibleFields = useMemo(
    () => (source?.fields ?? []).filter(f => faIncludes(f.title, q) || faIncludes(f.key, q)),
    [source, q],
  );

  const hasAgg = cols.some(c => !!c.agg);

  // ── ستون‌ها ──
  const addField = (key: string) => {
    if (cols.some(c => c.field === key && !c.agg)) return;
    setCols(c => [...c, { field: key }]);
    setMsg(null);
  };
  const removeCol = (i: number) => setCols(c => c.filter((_, x) => x !== i));
  const moveCol = (i: number, dir: -1 | 1) =>
    setCols(c => {
      const n = [...c];
      const j = i + dir;
      if (j < 0 || j >= n.length) return n;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const setCol = (i: number, patch: Partial<Col>) =>
    setCols(c => c.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  // ── شرط‌ها ──
  const addFilter = () => {
    const first = (source?.fields ?? []).find(f => f.filterable);
    if (!first) return;
    setFilters(f => [...f, { field: first.key, op: first.ops?.[0] ?? 'eq', value: '' }]);
  };
  const setFilter = (i: number, patch: Partial<Flt>) =>
    setFilters(f => f.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const removeFilter = (i: number) => setFilters(f => f.filter((_, k) => k !== i));

  // ── گروه‌بندی و ترتیب ──
  const toggleGroup = (key: string) =>
    setGroupBy(g => (g.includes(key) ? g.filter(x => x !== key) : [...g, key]));
  const cycleOrder = (key: string) =>
    setOrder(o => {
      const cur = o[key];
      const next = { ...o };
      if (!cur) next[key] = 'asc';
      else if (cur === 'asc') next[key] = 'desc';
      else delete next[key];
      return next;
    });

  const buildConfig = (): SavedReportConfig => ({
    columns: cols.map(c => ({
      field: c.field,
      alias: c.alias?.trim() || undefined,
      format: c.format as SavedReportConfig['columns'][number]['format'],
      agg: c.agg,
    })),
    filters: filters.filter(f => f.field).map(f => ({ field: f.field, op: f.op, value: f.value })),
    groupBy,
    orderBy: Object.entries(order).map(([field, dir]) => ({ field, dir })),
  });

  const runPreview = async (page = 1) => {
    setBusy(true);
    setMsg(null);
    const res = await previewReportAction(sourceKey, buildConfig(), page);
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: 'err', text: res.error });
      setPreview(null);
      return;
    }
    setPreview({
      columns: res.result.columns,
      rows: res.result.rows,
      total: res.result.total,
      page: res.result.page,
      totalPages: res.result.totalPages,
      notes: res.result.notes,
    });
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const res = await saveSavedReport({
      id: initial?.id,
      name,
      description,
      sourceKey,
      config: buildConfig(),
      visibility,
      allowedRoles,
    });
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: 'err', text: res.error });
      return;
    }
    setMsg({ kind: 'ok', text: 'گزارش ذخیره شد. از «گزارش‌های ذخیره‌شده» می‌توانید اجرایش کنید.' });
  };

  if (!source) {
    return <div className="card p-4 text-sm text-slate-600">هیچ منبعِ گزارشی تعریف نشده است.</div>;
  }

  const filterableFields = source.fields.filter(f => f.filterable);
  const groupableFields = source.fields.filter(f => f.groupable);

  return (
    <div className="space-y-4">
      {/* ── گام ۱: منبع ── */}
      <div className="card !p-4">
        <h2 className="text-sm font-bold text-slate-900 mb-2">۱) منبعِ داده را انتخاب کن</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {sources.map(s => (
            <button
              key={s.key}
              type="button"
              onClick={() => { setSourceKey(s.key); setCols([]); setFilters([]); setGroupBy([]); setOrder({}); setPreview(null); }}
              className={`rounded-xl border p-3 text-right transition ${
                s.key === sourceKey ? 'border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-300' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="text-base font-bold text-slate-900">{s.icon} {s.title}</div>
              {s.description && <div className="text-2xs text-slate-500 mt-0.5 leading-5">{s.description}</div>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── پالت فیلدها ── */}
        <div className="card !p-4">
          <h2 className="text-sm font-bold text-slate-900">۲) ستون‌ها را اضافه کن</h2>
          <input
            className="input mt-2"
            placeholder="جست‌وجوی ستون…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <div className="mt-2 max-h-80 overflow-y-auto divide-y divide-slate-100">
            {visibleFields.map(f => {
              const added = cols.some(c => c.field === f.key);
              return (
                <div key={f.key} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-800 truncate">{f.title}</div>
                    {f.hint && <div className="text-2xs text-slate-400 truncate">{f.hint}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => addField(f.key)}
                    disabled={added}
                    className="shrink-0 rounded-lg border border-emerald-300 px-2 py-1 text-2xs font-bold text-emerald-700 disabled:opacity-40 disabled:border-slate-200 disabled:text-slate-400"
                  >
                    {added ? 'افزوده شد' : '+ افزودن'}
                  </button>
                </div>
              );
            })}
            {!visibleFields.length && <p className="text-xs text-slate-400 py-3">ستونی با این نام پیدا نشد.</p>}
          </div>
        </div>

        {/* ── ستون‌های انتخاب‌شده ── */}
        <div className="card !p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">۳) ستون‌های گزارش</h2>
            <span className="text-2xs text-slate-400">{cols.length.toLocaleString('fa-IR')} ستون</span>
          </div>

          {!cols.length && (
            <p className="text-xs text-slate-400 mt-3">هنوز ستونی اضافه نشده — از ستونِ «ستون‌ها را اضافه کن» انتخاب کن.</p>
          )}

          <div className="mt-2 space-y-2">
            {cols.map((c, i) => {
              const f = fieldMap.get(c.field);
              if (!f) return null;
              return (
                <div key={`${c.field}-${i}`} className="rounded-xl border border-slate-200 p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700 flex-1 truncate">{f.title}</span>
                    <button type="button" onClick={() => moveCol(i, -1)} className="rounded border border-slate-200 px-1.5 text-2xs text-slate-500 hover:bg-slate-50" title="بالا">▲</button>
                    <button type="button" onClick={() => moveCol(i, 1)} className="rounded border border-slate-200 px-1.5 text-2xs text-slate-500 hover:bg-slate-50" title="پایین">▼</button>
                    <button
                      type="button"
                      onClick={() => cycleOrder(c.field)}
                      className={`rounded border px-1.5 text-2xs ${order[c.field] ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-400'}`}
                      title="ترتیب نتیجه"
                    >
                      {order[c.field] === 'asc' ? '↑ صعودی' : order[c.field] === 'desc' ? '↓ نزولی' : '⇅'}
                    </button>
                    <button type="button" onClick={() => removeCol(i)} className="rounded border border-rose-200 px-1.5 text-2xs text-rose-600 hover:bg-rose-50" title="حذف">✕</button>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="text-2xs text-slate-500">
                      عنوان در گزارش
                      <input
                        className="input mt-0.5 !py-1 text-xs"
                        placeholder={f.title}
                        value={c.alias ?? ''}
                        onChange={e => setCol(i, { alias: e.target.value })}
                      />
                    </label>
                    <label className="text-2xs text-slate-500">
                      قالبِ نمایش
                      <select className="input mt-0.5 !py-1 text-xs" value={c.format ?? ''} onChange={e => setCol(i, { format: e.target.value || undefined })}>
                        {Object.entries(FORMAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </label>
                    <label className="text-2xs text-slate-500">
                      تجمیع
                      <select
                        className="input mt-0.5 !py-1 text-xs"
                        value={c.agg ?? (f.hasFixedAgg ? '__fixed' : '')}
                        onChange={e => {
                          const v = e.target.value;
                          // «محاسبهٔ ثابت» یعنی بدونِ تجمیعِ کاربر ⇒ موتور خودش
                          // از aggSql فیلد استفاده می‌کند (نه یک رشتهٔ جادویی که
                          // موتور آن را نمی‌شناسد و ستون را حذف کند).
                          setCol(i, { agg: !v || v === '__fixed' ? undefined : (v as AggKind) });
                        }}
                      >
                        {f.hasFixedAgg ? (
                          <option value="__fixed">محاسبهٔ ثابت</option>
                        ) : (
                          <>
                            <option value="">— بدون —</option>
                            {(f.agg ?? []).map(a => <option key={a} value={a}>{AGG_LABELS[a]}</option>)}
                            {/* شمارش روی هر ستونِ سطح‌ردیف مجاز است */}
                            <option value="count">{AGG_LABELS.count}</option>
                            <option value="count_distinct">{AGG_LABELS.count_distinct}</option>
                          </>
                        )}
                      </select>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          {hasAgg && (
            <p className="mt-2 rounded-lg bg-indigo-50 px-2 py-1.5 text-2xs text-indigo-800">
              چون یک ستونِ تجمیعی انتخاب شده، خروجی به‌صورت گروه‌بندی‌شده محاسبه می‌شود (هر گروه یک ردیف).
            </p>
          )}
        </div>
      </div>

      {/* ── گام ۴: شرط‌ها ── */}
      <div className="card !p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">۴) شرط‌ها (فیلترها)</h2>
          <button type="button" onClick={addFilter} className="rounded-lg border border-emerald-300 px-2 py-1 text-2xs font-bold text-emerald-700">
            + افزودن شرط
          </button>
        </div>

        {!filters.length && <p className="text-xs text-slate-400 mt-2">بدون شرط = همهٔ رکوردها.</p>}

        <div className="mt-2 space-y-2">
          {filters.map((fl, i) => {
            const f = fieldMap.get(fl.field);
            const opts = f ? optionsFor(f) : null;
            const ops = f?.ops ?? ['eq'];
            const noValue = fl.op === 'isnull' || fl.op === 'notnull';
            return (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-end">
                <label className="text-2xs text-slate-500">
                  ستون
                  <select
                    className="input mt-0.5 !py-1 text-xs"
                    value={fl.field}
                    onChange={e => {
                      const nf = filterableFields.find(x => x.key === e.target.value);
                      setFilter(i, { field: e.target.value, op: nf?.ops?.[0] ?? 'eq', value: '' });
                    }}
                  >
                    {filterableFields.map(x => <option key={x.key} value={x.key}>{x.title}</option>)}
                  </select>
                </label>
                <label className="text-2xs text-slate-500">
                  عملگر
                  <select className="input mt-0.5 !py-1 text-xs" value={fl.op} onChange={e => setFilter(i, { op: e.target.value as FilterOp })}>
                    {ops.map(o => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
                  </select>
                </label>
                <label className="text-2xs text-slate-500">
                  مقدار
                  {noValue ? (
                    <div className="input mt-0.5 !py-1 text-xs text-slate-400">—</div>
                  ) : opts ? (
                    <select className="input mt-0.5 !py-1 text-xs" value={fl.value} onChange={e => setFilter(i, { value: e.target.value })}>
                      <option value="">— همه —</option>
                      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      className="input mt-0.5 !py-1 text-xs"
                      value={fl.value}
                      onChange={e => setFilter(i, { value: e.target.value })}
                      placeholder={fl.op === 'between' ? 'از … تا …' : 'مقدار'}
                    />
                  )}
                </label>
                <button type="button" onClick={() => removeFilter(i)} className="rounded border border-rose-200 px-2 py-1.5 text-2xs text-rose-600 hover:bg-rose-50">✕</button>
              </div>
            );
          })}
        </div>

        {!!groupableFields.length && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <h3 className="text-xs font-bold text-slate-700">گروه‌بندی (اختیاری)</h3>
            <p className="text-2xs text-slate-400 mb-1.5">اگر ستونِ تجمیعی انتخاب کنی، این ستون‌ها گروه‌ها را می‌سازند.</p>
            <div className="flex flex-wrap gap-1.5">
              {groupableFields.map(f => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => toggleGroup(f.key)}
                  className={`rounded-full border px-2.5 py-1 text-2xs ${groupBy.includes(f.key) ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {f.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── گام ۵: نام و ذخیره ── */}
      <div className="card !p-4">
        <h2 className="text-sm font-bold text-slate-900">۵) نام‌گذاری و ذخیره</h2>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-2xs text-slate-500">
              نامِ گزارش
              <input className="input mt-0.5" value={name} onChange={e => setName(e.target.value)} placeholder="مثلاً: مانده بدهی دانشجویان ورودی ۱۴۰۳" />
            </label>
            <label className="block text-2xs text-slate-500">
              توضیح (اختیاری)
              <textarea className="input mt-0.5" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
            </label>
          </div>

          <div className="space-y-2">
            <span className="block text-2xs text-slate-500">چه کسانی می‌توانند اجرا کنند؟</span>
            <div className="space-y-1.5">
              {([
                ['PRIVATE', '🔒 فقط خودم'],
                ['ROLE', '👥 نقش‌های مشخص'],
                ['PUBLIC', '🌐 همهٔ کاربرانِ مجاز'],
              ] as [ReportVisibility, string][]).map(([v, l]) => (
                <label key={v} className="flex items-center gap-2 text-xs text-slate-700">
                  <input type="radio" name="vis" checked={visibility === v} onChange={() => setVisibility(v)} />
                  {l}
                </label>
              ))}
            </div>

            {visibility === 'ROLE' && (
              <div className="flex flex-wrap gap-1.5 rounded-lg bg-slate-50 p-2">
                {ROLE_OPTIONS.map(r => (
                  <button
                    key={r.code}
                    type="button"
                    onClick={() => setAllowedRoles(a => (a.includes(r.code) ? a.filter(x => x !== r.code) : [...a, r.code]))}
                    className={`rounded-full border px-2.5 py-1 text-2xs ${allowedRoles.includes(r.code) ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => runPreview(1)} disabled={busy || !cols.length} className="btn btn-ghost">
            {busy ? 'در حال اجرا…' : '👁 پیش‌نمایش'}
          </button>
          <button type="button" onClick={save} disabled={busy || !cols.length || !name.trim()} className="btn btn-primary">
            💾 {initial ? 'ذخیرهٔ تغییرات' : 'ذخیرهٔ گزارش'}
          </button>
          <Link prefetch={false} href="/admin/reports/saved" className="btn btn-ghost">📂 گزارش‌های ذخیره‌شده</Link>
          {msg && (
            <span className={`text-xs font-medium ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</span>
          )}
        </div>
      </div>

      {/* ── پیش‌نمایش ── */}
      {preview && (
        <div className="card !p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="text-sm font-bold text-slate-900">پیشنمایش نتیجه</h2>
            <div className="flex items-center gap-2">
              <span className="text-2xs text-slate-500">
                {preview.total.toLocaleString('fa-IR')} ردیف · صفحهٔ {preview.page.toLocaleString('fa-IR')} از {preview.totalPages.toLocaleString('fa-IR')}
              </span>
              {preview.rows.length > 0 && (
                <ReportPrint
                  title={name.trim() || 'پیشنمایش گزارش ساختهای'}
                  subtitle={`${faNum(preview.total)} رکورد`}
                  columns={preview.columns}
                  rows={preview.rows}
                  summary={preview.notes?.length ? preview.notes.join(' ') : undefined}
                  universityTitle={brand.universityTitle}
                  universityLogoUrl={brand.universityLogoUrl}
                  signers={brand.signers}
                />
              )}
            </div>
          </div>

          {!!preview.notes?.length && (
            <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1.5 text-2xs text-amber-800">{preview.notes.join(' ')}</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="text-2xs text-slate-500 border-b border-slate-200">
                <tr>
                  {preview.columns.map(c => <th key={c.key} className="p-2 whitespace-nowrap">{c.title}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {preview.columns.map(c => (
                      <td key={c.key} className="p-2 whitespace-nowrap text-slate-700">
                        {fmtCell(r[c.key], c.format)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!preview.rows.length && (
                  <tr><td colSpan={preview.columns.length} className="p-4 text-center text-slate-400">ردیفی برای نمایش نیست.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {preview.totalPages > 1 && (
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => runPreview(Math.max(1, preview.page - 1))} disabled={preview.page <= 1} className="btn btn-ghost !px-2 !py-1 text-2xs">قبلی</button>
              <span className="text-2xs text-slate-500">صفحهٔ {preview.page.toLocaleString('fa-IR')}</span>
              <button type="button" onClick={() => runPreview(Math.min(preview.totalPages, preview.page + 1))} disabled={preview.page >= preview.totalPages} className="btn btn-ghost !px-2 !py-1 text-2xs">بعدی</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
