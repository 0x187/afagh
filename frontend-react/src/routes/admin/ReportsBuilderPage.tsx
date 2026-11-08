import { useQuery } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toEnDigits } from '@/lib/fa';
import {
  getBuilderCatalog, listSavedReports, previewBuilderReport, saveSavedReport,
  type BuilderAggKind, type BuilderFilterOp, type BuilderResult,
  type ReportVisibility, type SavedReportConfig, type SourceFieldMeta, type SourceMeta,
} from '@/lib/reports-builder-api';

// ═══ Report builder — port of admin/reports/builder/BuilderClient.tsx ═══

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

const OP_LABELS: Record<BuilderFilterOp, string> = {
  eq: 'برابر', ne: 'نابرابر',
  gt: 'بزرگ‌تر', gte: 'بزرگ‌تر یا مساوی', lt: 'کوچک‌تر', lte: 'کوچک‌تر یا مساوی',
  like: 'شامل', in: 'یکی از', between: 'بین',
  isnull: 'خالی است', notnull: 'خالی نیست',
};

const AGG_LABELS: Record<BuilderAggKind, string> = {
  sum: 'جمع', avg: 'میانگین', min: 'کمینه', max: 'بیشینه',
  count: 'تعداد', count_distinct: 'تعداد یکتا',
};

const FORMAT_LABELS: Record<string, string> = {
  '': 'عادی', DATE: 'تاریخ', DATETIME: 'تاریخ و ساعت', MONEY: 'مبلغ', NUMBER: 'عدد',
};

type Col = { field: string; alias?: string; format?: string; agg?: BuilderAggKind };
type Flt = { field: string; op: BuilderFilterOp; value: string };

function jalaliSmart(value: unknown, withTime = false): string {
  if (value === null || value === undefined || value === '') return '—';
  const raw = String(value).trim();
  if (/^1[34]\d{2}[/-]\d{1,2}[/-]\d{1,2}/.test(raw)) return raw.replace(/-/g, '/');
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  try {
    const date = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
    if (!withTime) return date;
    return `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return raw;
  }
}

function fmtCell(value: unknown, format?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (format) {
    case 'DATE': return jalaliSmart(value);
    case 'DATETIME': return jalaliSmart(value, true);
    case 'MONEY': return `${Math.round(Number(value) || 0).toLocaleString('en-US')} ریال`;
    case 'NUMBER': return Number(value).toLocaleString('en-US');
    default: return String(value);
  }
}

export function AdminReportsBuilderPage() {
  const [params] = useSearchParams();
  const editId = Number(params.get('edit') ?? '') || 0;

  const { data: catalog, isLoading } = useQuery({
    queryKey: ['reports-builder-catalog'],
    queryFn: getBuilderCatalog,
    staleTime: 5 * 60_000,
  });

  // Edit mode: hydrate the builder from the saved report found in the list.
  const { data: savedList } = useQuery({
    queryKey: ['reports-saved-list'],
    queryFn: listSavedReports,
    enabled: editId > 0,
    staleTime: 15_000,
  });
  const initial = editId > 0 ? savedList?.find((r) => r.id === editId) ?? null : null;

  const sources = catalog?.sources ?? [];
  const options = catalog?.options;

  const [sourceKey, setSourceKey] = useState('');
  const [cols, setCols] = useState<Col[]>([]);
  const [filters, setFilters] = useState<Flt[]>([]);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [order, setOrder] = useState<Record<string, 'asc' | 'desc'>>({});
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ReportVisibility>('PRIVATE');
  const [allowedRoles, setAllowedRoles] = useState<string[]>([]);

  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<BuilderResult | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const hydratedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!initial || hydratedFor.current === initial.id) return;
    hydratedFor.current = initial.id;
    setSourceKey(initial.sourceKey);
    setCols(initial.config?.columns ?? []);
    setFilters(
      (initial.config?.filters ?? []).map((f) => ({
        field: f.field,
        op: f.op,
        value: Array.isArray(f.value) ? f.value[0] ?? '' : f.value ?? '',
      })),
    );
    setGroupBy(initial.config?.groupBy ?? []);
    const o: Record<string, 'asc' | 'desc'> = {};
    for (const x of initial.config?.orderBy ?? []) o[x.field] = x.dir;
    setOrder(o);
    setName(initial.name);
    setDescription(initial.description ?? '');
    setVisibility(initial.visibility);
    setAllowedRoles(initial.allowedRoles ?? []);
  }, [initial]);

  const source: SourceMeta | null = useMemo(
    () => sources.find((s) => s.key === sourceKey) ?? null,
    [sources, sourceKey],
  );
  const fieldMap = useMemo(
    () => new Map<string, SourceFieldMeta>((source?.fields ?? []).map((f) => [f.key, f])),
    [source],
  );

  const optionsFor = (f: SourceFieldMeta): { value: string; label: string }[] | null => {
    if (f.options?.length) return f.options;
    if (!f.ref || !options) return null;
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

  const visibleFields = useMemo(() => {
    const needle = toEnDigits(q.trim().toLowerCase());
    const all = source?.fields ?? [];
    if (!needle) return all;
    return all.filter((f) => toEnDigits(f.title.toLowerCase()).includes(needle) || f.key.toLowerCase().includes(needle));
  }, [source, q]);

  // ── columns ──
  const addField = (key: string) => {
    if (cols.some((c) => c.field === key && !c.agg)) return;
    setCols((c) => [...c, { field: key }]);
    setMsg(null);
  };
  const removeCol = (i: number) => setCols((c) => c.filter((_, x) => x !== i));
  const moveCol = (i: number, dir: -1 | 1) =>
    setCols((c) => {
      const n = [...c];
      const j = i + dir;
      if (j < 0 || j >= n.length) return n;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const setCol = (i: number, patch: Partial<Col>) =>
    setCols((c) => c.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  // ── filters ──
  const addFilter = () => {
    const first = (source?.fields ?? []).find((f) => f.filterable);
    if (!first) return;
    setFilters((f) => [...f, { field: first.key, op: first.ops?.[0] ?? 'eq', value: '' }]);
  };
  const setFilter = (i: number, patch: Partial<Flt>) =>
    setFilters((f) => f.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const removeFilter = (i: number) => setFilters((f) => f.filter((_, k) => k !== i));

  // ── grouping + ordering ──
  const toggleGroup = (key: string) =>
    setGroupBy((g) => (g.includes(key) ? g.filter((x) => x !== key) : [...g, key]));
  const cycleOrder = (key: string) =>
    setOrder((o) => {
      const cur = o[key];
      const next = { ...o };
      if (!cur) next[key] = 'asc';
      else if (cur === 'asc') next[key] = 'desc';
      else delete next[key];
      return next;
    });

  function buildConfig(): SavedReportConfig {
    return {
      columns: cols.map((c) => ({
        field: c.field,
        alias: c.alias?.trim() || undefined,
        format: c.format as SavedReportConfig['columns'][number]['format'],
        agg: c.agg,
      })),
      filters: filters.filter((f) => f.field).map((f) => ({ field: f.field, op: f.op, value: f.value })),
      groupBy,
      orderBy: Object.entries(order).map(([field, dir]) => ({ field, dir })),
    };
  }

  async function runPreview(page = 1) {
    if (!sourceKey) return;
    setBusy(true);
    setMsg(null);
    try {
      setPreview(await previewBuilderReport(sourceKey, buildConfig(), page));
    } catch (e) {
      setPreview(null);
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطای نامشخص در پیش‌نمایش' });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!sourceKey) return;
    setBusy(true);
    setMsg(null);
    try {
      await saveSavedReport({
        id: initial?.id,
        name,
        description,
        sourceKey,
        config: buildConfig(),
        visibility,
        allowedRoles,
      });
      setMsg({ kind: 'ok', text: 'گزارش ذخیره شد. از «گزارش‌های ذخیره‌شده» می‌توانید اجرایش کنید.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'خطای نامشخص در ذخیره' });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <Skeleton className="h-72 w-full" />;

  if (!sources.length) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">هیچ منبعِ گزارشی تعریف نشده است.</CardContent>
      </Card>
    );
  }

  const filterableFields = (source?.fields ?? []).filter((f) => f.filterable);
  const groupableFields = (source?.fields ?? []).filter((f) => f.groupable);
  const hasAgg = cols.some((c) => !!c.agg);

  return (
    <div className="space-y-4">
      {/* ── Step 1: source ── */}
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 text-sm font-black">۱) منبعِ داده را انتخاب کن</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {sources.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setSourceKey(s.key);
                  setCols([]);
                  setFilters([]);
                  setGroupBy([]);
                  setOrder({});
                  setPreview(null);
                }}
                className={`rounded-xl border p-3 text-right transition ${
                  s.key === sourceKey
                    ? 'border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-300 dark:bg-emerald-950/40'
                    : 'border-border bg-card hover:border-emerald-300'
                }`}
              >
                <div className="text-base font-black">{s.icon} {s.title}</div>
                {s.description && <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{s.description}</div>}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Field palette ── */}
        <Card>
          <CardContent className="p-4">
            <h2 className="text-sm font-black">۲) ستون‌ها را اضافه کن</h2>
            <Input className="mt-2" placeholder="جست‌وجوی ستون…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mt-2 max-h-80 divide-y divide-border overflow-y-auto">
              {visibleFields.map((f) => {
                const added = cols.some((c) => c.field === f.key);
                return (
                  <div key={f.key} className="flex items-center justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold">{f.title}</div>
                      {f.hint && <div className="truncate text-[10px] text-muted-foreground">{f.hint}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => addField(f.key)}
                      disabled={added}
                      className="shrink-0 rounded-lg border border-emerald-300 px-2 py-1 text-[10px] font-black text-emerald-700 disabled:border-border disabled:text-muted-foreground disabled:opacity-40 dark:border-emerald-700 dark:text-emerald-300"
                    >
                      {added ? 'افزوده شد' : '+ افزودن'}
                    </button>
                  </div>
                );
              })}
              {!visibleFields.length && <p className="py-3 text-xs text-muted-foreground">ستونی با این نام پیدا نشد.</p>}
            </div>
          </CardContent>
        </Card>

        {/* ── Selected columns ── */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black">۳) ستون‌های گزارش</h2>
              <span className="text-[10px] text-muted-foreground">{cols.length.toLocaleString('fa-IR')} ستون</span>
            </div>

            {!cols.length && (
              <p className="mt-3 text-xs text-muted-foreground">هنوز ستونی اضافه نشده — از پالتِ «ستون‌ها را اضافه کن» انتخاب کن.</p>
            )}

            <div className="mt-2 space-y-2">
              {cols.map((c, i) => {
                const f = fieldMap.get(c.field);
                if (!f) return null;
                return (
                  <div key={`${c.field}-${i}`} className="space-y-2 rounded-xl border border-border p-2">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate text-xs font-black">{f.title}</span>
                      <button type="button" onClick={() => moveCol(i, -1)} className="rounded border border-border px-1.5 text-[10px] text-muted-foreground hover:bg-muted" title="بالا">▲</button>
                      <button type="button" onClick={() => moveCol(i, 1)} className="rounded border border-border px-1.5 text-[10px] text-muted-foreground hover:bg-muted" title="پایین">▼</button>
                      <button
                        type="button"
                        onClick={() => cycleOrder(c.field)}
                        className={`rounded border px-1.5 text-[10px] ${order[c.field] ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200' : 'border-border text-muted-foreground'}`}
                        title="ترتیب نتیجه"
                      >
                        {order[c.field] === 'asc' ? '↑ صعودی' : order[c.field] === 'desc' ? '↓ نزولی' : '⇅'}
                      </button>
                      <button type="button" onClick={() => removeCol(i)} className="rounded border border-rose-200 px-1.5 text-[10px] text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40" title="حذف">✕</button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="text-[10px] text-muted-foreground">
                        عنوان در گزارش
                        <input
                          className="mt-0.5 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs"
                          placeholder={f.title}
                          value={c.alias ?? ''}
                          onChange={(e) => setCol(i, { alias: e.target.value })}
                        />
                      </label>
                      <label className="text-[10px] text-muted-foreground">
                        قالبِ نمایش
                        <select
                          className="mt-0.5 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs"
                          value={c.format ?? ''}
                          onChange={(e) => setCol(i, { format: e.target.value || undefined })}
                        >
                          {Object.entries(FORMAT_LABELS).map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[10px] text-muted-foreground">
                        تجمیع
                        <select
                          className="mt-0.5 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs"
                          value={c.agg ?? (f.hasFixedAgg ? '__fixed' : '')}
                          onChange={(e) => {
                            const v = e.target.value;
                            // '__fixed' = no user aggregate — the engine uses the field's
                            // own fixed aggregate expression (e.g. balance).
                            setCol(i, { agg: !v || v === '__fixed' ? undefined : (v as BuilderAggKind) });
                          }}
                        >
                          {f.hasFixedAgg ? (
                            <option value="__fixed">محاسبهٔ ثابت</option>
                          ) : (
                            <>
                              <option value="">— بدون —</option>
                              {(f.agg ?? []).map((a) => (
                                <option key={a} value={a}>{AGG_LABELS[a]}</option>
                              ))}
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
              <p className="mt-2 rounded-lg bg-indigo-50 px-2 py-1.5 text-[10px] text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">
                چون یک ستونِ تجمیعی انتخاب شده، خروجی به‌صورت گروه‌بندی‌شده محاسبه می‌شود (هر گروه یک ردیف).
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Step 4: filters ── */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black">۴) شرط‌ها (فیلترها)</h2>
            <Button size="sm" variant="outline" type="button" onClick={addFilter}>+ افزودن شرط</Button>
          </div>

          {!filters.length && <p className="mt-2 text-xs text-muted-foreground">بدون شرط = همهٔ رکوردها.</p>}

          <div className="mt-2 space-y-2">
            {filters.map((fl, i) => {
              const f = fieldMap.get(fl.field);
              const opts = f ? optionsFor(f) : null;
              const ops = f?.ops ?? ['eq'];
              const noValue = fl.op === 'isnull' || fl.op === 'notnull';
              return (
                <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <label className="text-[10px] text-muted-foreground">
                    ستون
                    <select
                      className="mt-0.5 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs"
                      value={fl.field}
                      onChange={(e) => {
                        const nf = filterableFields.find((x) => x.key === e.target.value);
                        setFilter(i, { field: e.target.value, op: nf?.ops?.[0] ?? 'eq', value: '' });
                      }}
                    >
                      {filterableFields.map((x) => (
                        <option key={x.key} value={x.key}>{x.title}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[10px] text-muted-foreground">
                    عملگر
                    <select
                      className="mt-0.5 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs"
                      value={fl.op}
                      onChange={(e) => setFilter(i, { op: e.target.value as BuilderFilterOp })}
                    >
                      {ops.map((o) => (
                        <option key={o} value={o}>{OP_LABELS[o]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[10px] text-muted-foreground">
                    مقدار
                    {noValue ? (
                      <div className="mt-0.5 h-8 rounded-lg border border-input px-2 py-1.5 text-xs text-muted-foreground">—</div>
                    ) : opts ? (
                      <select
                        className="mt-0.5 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs"
                        value={fl.value}
                        onChange={(e) => setFilter(i, { value: e.target.value })}
                      >
                        <option value="">— همه —</option>
                        {opts.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="mt-0.5 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs"
                        value={fl.value}
                        onChange={(e) => setFilter(i, { value: e.target.value })}
                        placeholder={fl.op === 'between' ? 'از … تا …' : 'مقدار'}
                      />
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={() => removeFilter(i)}
                    className="rounded border border-rose-200 px-2 py-1.5 text-[10px] text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          {!!groupableFields.length && (
            <div className="mt-3 border-t border-border pt-3">
              <h3 className="text-xs font-black">گروه‌بندی (اختیاری)</h3>
              <p className="mb-1.5 text-[10px] text-muted-foreground">اگر ستونِ تجمیعی انتخاب کنی، این ستون‌ها گروه‌ها را می‌سازند.</p>
              <div className="flex flex-wrap gap-1.5">
                {groupableFields.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => toggleGroup(f.key)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] ${
                      groupBy.includes(f.key)
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {f.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Step 5: name + save ── */}
      <Card>
        <CardContent className="p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-black">
            <Wrench className="size-4" aria-hidden /> ۵) نام‌گذاری و ذخیره
          </h2>
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-[10px] text-muted-foreground">
                نامِ گزارش
                <input
                  className="mt-0.5 h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثلاً: مانده بدهی دانشجویان ورودی ۱۴۰۳"
                />
              </label>
              <label className="block text-[10px] text-muted-foreground">
                توضیح (اختیاری)
                <textarea
                  className="mt-0.5 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
            </div>

            <div className="space-y-2">
              <span className="block text-[10px] text-muted-foreground">چه کسانی می‌توانند اجرا کنند؟</span>
              <div className="space-y-1.5">
                {([
                  ['PRIVATE', '🔒 فقط خودم'],
                  ['ROLE', '👥 نقش‌های مشخص'],
                  ['PUBLIC', '🌐 همهٔ کاربرانِ مجاز'],
                ] as [ReportVisibility, string][]).map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2 text-xs">
                    <input type="radio" name="vis" checked={visibility === v} onChange={() => setVisibility(v)} />
                    {l}
                  </label>
                ))}
              </div>

              {visibility === 'ROLE' && (
                <div className="flex flex-wrap gap-1.5 rounded-lg bg-muted p-2">
                  {ROLE_OPTIONS.map((r) => (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => setAllowedRoles((a) => (a.includes(r.code) ? a.filter((x) => x !== r.code) : [...a, r.code]))}
                      className={`rounded-full border px-2.5 py-1 text-[10px] ${
                        allowedRoles.includes(r.code)
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                          : 'border-border text-muted-foreground'
                      }`}
                    >
                      {r.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void runPreview(1)} disabled={busy || !cols.length}>
              {busy ? 'در حال اجرا…' : '👁 پیش‌نمایش'}
            </Button>
            <Button type="button" onClick={() => void save()} disabled={busy || !cols.length || !name.trim()}>
              💾 {initial ? 'ذخیرهٔ تغییرات' : 'ذخیرهٔ گزارش'}
            </Button>
            <Link to="/admin/reports/saved">
              <Button type="button" variant="ghost">📂 گزارش‌های ذخیره‌شده</Button>
            </Link>
            {msg && (
              <span className={`text-xs font-bold ${msg.kind === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                {msg.text}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Preview ── */}
      {preview && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-black">پیش‌نمایش نتیجه</h2>
              <span className="text-[11px] text-muted-foreground">
                {preview.total.toLocaleString('fa-IR')} ردیف · صفحهٔ {preview.page.toLocaleString('fa-IR')} از {preview.totalPages.toLocaleString('fa-IR')}
              </span>
            </div>

            {!!preview.notes?.length && (
              <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {preview.notes.join(' ')}
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-xs">
                <thead className="border-b border-border font-bold text-muted-foreground">
                  <tr>
                    {preview.columns.map((c) => (
                      <th key={c.key} className="whitespace-nowrap p-2">{c.title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                      {preview.columns.map((c) => (
                        <td key={c.key} className="whitespace-nowrap p-2">{fmtCell(r[c.key], c.format)}</td>
                      ))}
                    </tr>
                  ))}
                  {!preview.rows.length && (
                    <tr>
                      <td colSpan={preview.columns.length} className="p-4 text-center text-muted-foreground">ردیفی برای نمایش نیست.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {preview.totalPages > 1 && (
              <div className="mt-2 flex items-center justify-center gap-2">
                <Button size="sm" variant="outline" disabled={preview.page <= 1} onClick={() => void runPreview(Math.max(1, preview.page - 1))}>قبلی</Button>
                <span className="text-[11px] text-muted-foreground">صفحهٔ {preview.page.toLocaleString('fa-IR')}</span>
                <Button size="sm" variant="outline" disabled={preview.page >= preview.totalPages} onClick={() => void runPreview(Math.min(preview.totalPages, preview.page + 1))}>بعدی</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
