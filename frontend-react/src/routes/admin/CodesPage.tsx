import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, toEnDigits } from '@/lib/fa';
import {
  ADD_LABEL, CODE_TABLES, CREATE_ELSEWHERE, EDIT_FIELDS, NEW_FIELDS,
  type CodeRow, type CodeStat, type CodeTable, type FormOptions,
  createCodeRow, deleteCodeRow, exportCodesCsv, getCodeFormOptions, getCodeRow,
  getCodeRows, getCodeStats, getDegreeRow, getMissingCodeSummary, getTermRow,
  setCode, updateCodeRow, updateDegreeRow, updateTermRow,
} from '@/lib/codes-api';

// ═══ Code center — port of admin/codes/page.tsx + CodesClient.tsx ═══
// The code is the authenticity document of every record; here the codes of all reference tables are viewed and fixed,
// and records with no code or a duplicate code are found.

const PAGE = 200;

/** Tables edited via the generic form (faculty, group, major, course) */
const GENERIC_EDIT_TABLES: CodeTable[] = ['faculty', 'department', 'major', 'course'];

// ── Persian search normalization — port of persian-search ──
const FA_NORM: Record<string, string> = {
  'ي': 'ی', 'ك': 'ک', 'ة': 'ه', 'ؤ': 'و', 'ئ': 'ی', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ـ': '', '\u200C': ' ',
};

function normalizeFa(s: string): string {
  let out = '';
  for (const ch of s) {
    if ((ch >= '\u064B' && ch <= '\u0656') || ch === '\u0670') continue;
    out += FA_NORM[ch] ?? ch;
  }
  return out.trim().split(/\s+/).filter(Boolean).join(' ');
}

function faIncludes(haystack: string, needle: string): boolean {
  const n = toEnDigits(normalizeFa(needle));
  if (!n) return true;
  return toEnDigits(normalizeFa(haystack)).includes(n);
}

// ── Gregorian → Jalali date conversion for display (port of jalaliDateOf) ──
function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const div = (a: number, b: number) => Math.trunc(a / b);
  let jy = gy <= 1600 ? 0 : 979;
  let y = gy - (gy <= 1600 ? 621 : 1600);
  const gy2 = gm > 2 ? y + 1 : y;
  let days = 365 * y + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) - 80 + gd + gdm[gm - 1];
  jy += 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

/** 'YYYY-MM-DDTHH:mm' or 'YYYY-MM-DD' → Jalali date for display in the table */
function fmtDateFa(v?: string | null): string {
  if (!v) return '—';
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return v.slice(0, 10);
  const [jy, jm, jd] = gregorianToJalali(y, m, d);
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

/** Persian digits → Latin (for building the standard code from the term code) */
const toLatinDigits = (v: string): string => toEnDigits(v);

/** Ministry standard code for the term — defaults from the term code (e.g. 13831 → TERM-13831) */
const defaultTermStandardCode = (code?: string | null): string =>
  code ? `TERM-${toLatinDigits(code)}` : '';

const errMsg = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'عملیات ناموفق بود.');

export function AdminCodesPage() {
  const qc = useQueryClient();
  const [table, setTable] = useState<CodeTable>('faculty');
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'ALL' | 'MISSING' | 'DUP'>('ALL');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: 'code' | 'title' | 'context'; dir: 1 | -1 } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [dirty, setDirty] = useState<Record<number, string>>({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);

  const statsQ = useQuery({ queryKey: ['codes-stats'], queryFn: getCodeStats });
  const rowsQ = useQuery({ queryKey: ['codes-rows', table], queryFn: () => getCodeRows(table) });
  const optionsQ = useQuery({ queryKey: ['codes-form-options'], queryFn: getCodeFormOptions });
  const missingQ = useQuery({ queryKey: ['codes-missing-summary'], queryFn: getMissingCodeSummary });

  const stats: CodeStat[] = statsQ.data ?? [];
  const rows: CodeRow[] = rowsQ.data ?? [];
  const options: FormOptions = optionsQ.data ?? { degree: [], department: [], faculty: [] };
  const pending = statsQ.isFetching || rowsQ.isFetching || rowsQ.isLoading;

  const cur = stats.find((s) => s.id === table);
  const isTerm = table === 'term';
  const newFields = NEW_FIELDS[table] ?? [];
  const elsewhere = CREATE_ELSEWHERE[table];
  // The edit form may differ from the create form (term: full scheduling)
  const editFields = EDIT_FIELDS[table] ?? newFields;
  const formFields = editingId != null ? editFields : newFields;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['codes-stats'] });
    void qc.invalidateQueries({ queryKey: ['codes-rows', table] });
    void qc.invalidateQueries({ queryKey: ['codes-missing-summary'] });
  };

  // When the table changes, close the open form and set the default values
  useEffect(() => {
    setAdding(false);
    setEditingId(null);
    setPage(0);
    setDirty({});
    setSort(null);
    setForm(Object.fromEntries((NEW_FIELDS[table] ?? []).map((f) => [f.name, f.def ?? ''])));
  }, [table]);

  const closeForm = () => {
    setAdding(false);
    setEditingId(null);
    setForm(Object.fromEntries(newFields.map((f) => [f.name, f.def ?? ''])));
  };

  // ── Mutations ──

  const saveCodeMut = useMutation({
    mutationFn: (v: { id: number; code: string; title: string }) => setCode(table, v.id, v.code),
    onSuccess: (_d, v) => {
      setMsg({ kind: 'ok', text: `کد «${v.title}» ذخیره شد.` });
      setDirty((d) => {
        const n = { ...d };
        delete n[v.id];
        return n;
      });
      refresh();
    },
    onError: (e) => setMsg({ kind: 'err', text: errMsg(e) }),
  });

  const deleteMut = useMutation({
    mutationFn: (v: { id: number; title: string }) => deleteCodeRow(table, v.id),
    onSuccess: (_d, v) => {
      setMsg({ kind: 'ok', text: `«${v.title}» حذف شد.` });
      refresh();
    },
    onError: (e) => setMsg({ kind: 'err', text: errMsg(e) }),
  });

  const remove = (row: CodeRow) => {
    if (!window.confirm(`«${row.title}» حذف شود؟ اگر جایی استفاده شده باشد، حذف نمی‌شود.`)) return;
    deleteMut.mutate({ id: row.id, title: row.title });
  };

  // ── Opening the edit form (per row type) ──

  const startEditDegree = async (row: CodeRow) => {
    try {
      const d = await getDegreeRow(row.id);
      if (!d) {
        setMsg({ kind: 'err', text: 'خواندن مقطع ناموفق بود.' });
        return;
      }
      setForm(Object.fromEntries(newFields.map((f) => [f.name, d[f.name] ?? f.def ?? ''])));
      setEditingId(row.id);
      setAdding(true);
      setMsg({ kind: 'ok', text: `در حال ویرایش مقطع «${row.title}» — برای انصراف، «انصراف» را بزنید.` });
    } catch (e) {
      setMsg({ kind: 'err', text: errMsg(e) });
    }
  };

  const startEditTerm = async (row: CodeRow) => {
    try {
      const d = await getTermRow(row.id);
      if (!d) {
        setMsg({ kind: 'err', text: 'خواندن ترم ناموفق بود.' });
        return;
      }
      setForm(Object.fromEntries(editFields.map((f) => {
        let v = d[f.name] ?? f.def ?? '';
        // If the ministry standard code is empty, it is built from the term code (editable)
        if (f.name === 'standardCode' && !v) v = defaultTermStandardCode(row.code);
        return [f.name, v];
      })));
      setEditingId(row.id);
      setAdding(true);
      setMsg({ kind: 'ok', text: `در حال ویرایش ترم «${row.title}» — برای انصراف، «انصراف» را بزنید.` });
    } catch (e) {
      setMsg({ kind: 'err', text: errMsg(e) });
    }
  };

  const startEditRow = async (row: CodeRow) => {
    try {
      const d = await getCodeRow(table, row.id);
      if (!d) {
        setMsg({ kind: 'err', text: 'خواندن اطلاعات سطر ناموفق بود.' });
        return;
      }
      setForm(Object.fromEntries(editFields.map((f) => [f.name, d[f.name] ?? f.def ?? ''])));
      setEditingId(row.id);
      setAdding(true);
      setMsg({ kind: 'ok', text: `در حال ویرایش «${row.title}» — برای انصراف، «انصراف» را بزنید.` });
    } catch (e) {
      setMsg({ kind: 'err', text: errMsg(e) });
    }
  };

  // ── Submitting the add/edit form ──

  const [savingForm, setSavingForm] = useState(false);
  const submitForm = async () => {
    setSavingForm(true);
    const values: Record<string, string> = {};
    for (const f of formFields) values[f.name] = form[f.name] ?? '';
    try {
      if (editingId != null && table === 'degree') {
        await updateDegreeRow(editingId, values);
        setMsg({ kind: 'ok', text: 'مقطع به‌روزرسانی شد.' });
      } else if (editingId != null && table === 'term') {
        await updateTermRow(editingId, values);
        setMsg({ kind: 'ok', text: 'زمان‌بندی ترم به‌روزرسانی شد.' });
      } else if (editingId != null) {
        await updateCodeRow(table, editingId, values);
        setMsg({ kind: 'ok', text: 'با موفقیت ویرایش شد.' });
      } else {
        await createCodeRow(table, values);
        setMsg({ kind: 'ok', text: 'رکورد تازه ثبت شد. برای دیده‌شدن در فهرست‌های دیگر، صفحه را تازه کنید.' });
      }
      closeForm();
      refresh();
    } catch (e) {
      setMsg({ kind: 'err', text: errMsg(e) });
    } finally {
      setSavingForm(false);
    }
  };

  // ── CSV export (download from text) ──

  const [exporting, setExporting] = useState(false);
  const downloadCsv = async () => {
    setExporting(true);
    try {
      const csv = await exportCodesCsv(table);
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `codes-${table}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg({ kind: 'err', text: errMsg(e) });
    } finally {
      setExporting(false);
    }
  };

  // ── Client-side filter/sort/pagination (like CodesClient) ──

  const filtered = useMemo(() => {
    const t = normalizeFa(q);
    const base = rows.filter((r) => {
      if (only === 'MISSING' && r.code) return false;
      if (only === 'DUP' && !r.duplicate) return false;
      if (!t) return true;
      return faIncludes(r.title, t) || (r.code ?? '').includes(t) || faIncludes(r.context ?? '', t);
    });
    if (!sort) return base;
    const get = (r: CodeRow) => (sort.key === 'code' ? (r.code ?? '') : sort.key === 'title' ? r.title : (r.context ?? ''));
    return [...base].sort((a, b) => get(a).localeCompare(get(b), 'fa', { numeric: true }) * sort.dir);
  }, [rows, q, only, sort]);

  const toggleSort = (key: 'code' | 'title' | 'context') => {
    setPage(0);
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 1 };
      if (s.dir === 1) return { key, dir: -1 };
      return null;
    });
  };
  const sortMark = (key: 'code' | 'title' | 'context') =>
    sort?.key !== key ? ' ↕' : sort.dir === 1 ? ' ▲' : ' ▼';

  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.ceil(filtered.length / PAGE);

  const totalMissing = stats.reduce((s, x) => s + x.missing, 0);
  const totalDup = stats.reduce((s, x) => s + x.duplicate, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-0 bg-gradient-to-l from-indigo-800 to-sky-700 text-white">
        <CardContent className="p-5">
          <h1 className="flex items-center gap-2 text-base font-black"><KeyRound className="size-5" aria-hidden /> مرکز کدها</h1>
          <p className="mt-1 text-xs leading-6 text-indigo-100">
            کد، سند اصالت هر رکورد است: کد رشته می‌گوید کدام رشته، در چه مقطعی، ذیل کدام گروه و کدام دانشکده. انتقال
            داده هم <b>اول با کد</b> تطبیق می‌دهد و تنها اگر کد نبود سراغ نام می‌رود. اینجا می‌توانید کد همهٔ جدول‌های
            مرجع را ببینید، اصلاح کنید و رکوردهای بی‌کد یا دارای کد تکراری را پیدا کنید.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {totalMissing > 0 && (
              <span className="rounded-lg bg-amber-100 px-2.5 py-1 font-bold text-amber-800">
                {faNumber(totalMissing)} رکورد بدون کد
              </span>
            )}
            {totalDup > 0 && (
              <span className="rounded-lg bg-red-100 px-2.5 py-1 font-bold text-red-700">
                {faNumber(totalDup)} کد تکراری
              </span>
            )}
            {totalMissing === 0 && totalDup === 0 && stats.length > 0 && (
              <span className="rounded-lg bg-emerald-100 px-2.5 py-1 font-bold text-emerald-700">✓ همهٔ کدها سالم‌اند</span>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-6 text-indigo-200">
            پیش از هر انتقال داده، این صفحه را بررسی کنید. رکوردهای بی‌کد فقط با نام تطبیق می‌خورند و اگر نام تکراری
            باشد، سامانه به‌جای حدس‌زدن خطا می‌دهد و آن ردیف وصل نمی‌شود.
          </p>
        </CardContent>
      </Card>

      {/* Tabs of the coded tables */}
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {CODE_TABLES.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === table}
            onClick={() => setTable(t.id)}
            className={
              'rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ' +
              (t.id === table
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                : 'border-border text-muted-foreground hover:bg-muted/40')
            }
          >
            {t.title}
          </button>
        ))}
      </div>

      {/* Code health cards */}
      {statsQ.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((s) => {
            const bad = s.missing > 0 || s.duplicate > 0;
            return (
              <button
                key={s.id}
                onClick={() => setTable(s.id)}
                className={
                  'rounded-xl border p-3 text-right transition-colors ' +
                  (s.id === table
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
                    : bad
                      ? 'border-amber-200 bg-card hover:bg-amber-50 dark:border-amber-900'
                      : 'border-border bg-card hover:bg-muted/40')
                }
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{s.title}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{faNumber(s.total)}</span>
                </div>
                <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{s.hint}</p>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                  {s.missing > 0 && <Badge variant="warning" className="px-1.5 py-0">{faNumber(s.missing)} بدون کد</Badge>}
                  {s.duplicate > 0 && <Badge variant="destructive" className="px-1.5 py-0">{faNumber(s.duplicate)} کد تکراری</Badge>}
                  {s.missing === 0 && s.duplicate === 0 && <Badge variant="success" className="px-1.5 py-0">✓ همه کد دارند</Badge>}
                  {!s.editable && (
                    <Badge variant="secondary" className="px-1.5 py-0">
                      {s.id === 'term' ? 'کد ثابت · زمان‌بندی ویرایش‌پذیر' : s.creatable ? 'کد ثابت — فقط افزودن' : 'فقط خواندنی'}
                    </Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Summary of incomplete codes */}
      <Card>
        <CardContent className="p-4">
          <h2 className="text-xs font-black text-slate-700 dark:text-slate-200">رکوردهای بی‌کد</h2>
          {missingQ.isLoading ? (
            <Skeleton className="mt-2 h-6 w-48" />
          ) : (missingQ.data?.length ?? 0) === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">هیچ جدولی رکورد بی‌کد ندارد.</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-[11px]">
              {missingQ.data?.map((m) => (
                <li key={m.table} className="text-amber-800 dark:text-amber-300">
                  {m.table}: {faNumber(m.missing)} رکورد بدون کد
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {msg && (
        <div
          className={
            'rounded-xl border p-3 text-sm ' +
            (msg.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950')
          }
        >
          {msg.text}
          <button onClick={() => setMsg(null)} className="float-left text-xs opacity-60 hover:opacity-100">بستن</button>
        </div>
      )}

      {/* Codes table */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <h2 className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{cur?.title}</h2>
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder="جستجوی کد، عنوان یا زمینه…"
            className="h-8 w-56 text-xs"
          />
          <div className="flex gap-1 text-[11px]">
            {([['ALL', 'همه'], ['MISSING', 'بدون کد'], ['DUP', 'کد تکراری']] as const).map(([k, lbl]) => (
              <button
                key={k}
                onClick={() => { setOnly(k); setPage(0); }}
                className={
                  'rounded-lg border px-2 py-1 ' +
                  (only === k
                    ? 'border-indigo-400 bg-indigo-50 font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                    : 'border-border text-muted-foreground hover:bg-muted/40')
                }
              >
                {lbl}
              </button>
            ))}
          </div>
          <span className="ms-auto text-[11px] text-muted-foreground">
            {faNumber(filtered.length)} ردیف
            {pending && ' · در حال بارگذاری…'}
          </span>
          <Button variant="outline" size="sm" disabled={exporting} onClick={() => void downloadCsv()} className="h-8 text-xs">
            <Download className="size-3.5" aria-hidden /> خروجی CSV
          </Button>
          {cur?.creatable && (
            <Button
              size="sm"
              onClick={() => (adding ? closeForm() : setAdding(true))}
              className={'h-8 text-xs ' + (adding ? 'bg-muted text-foreground hover:bg-muted' : 'bg-emerald-600 text-white hover:bg-emerald-700')}
            >
              {adding ? 'انصراف' : <><Plus className="size-3.5" aria-hidden /> {ADD_LABEL[table] ?? 'افزودن'}</>}
            </Button>
          )}
          {elsewhere && (
            <Link
              to={elsewhere.href}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-muted/40"
            >
              ➕ {elsewhere.label}
            </Link>
          )}
        </div>

        {/* Add / edit form — modal */}
        {adding && (cur?.creatable || editingId != null) && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-3 backdrop-blur-[1px]"
            onClick={closeForm}
          >
            <div
              className="my-6 w-full max-w-4xl rounded-2xl border border-border bg-card p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={
                  'mb-2 rounded-lg px-3 py-2 text-[11px] font-bold ' +
                  (editingId != null ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300')
                }
              >
                {editingId != null ? `✏️ ویرایش ${cur?.title}` : `➕ ${ADD_LABEL[table] ?? 'افزودن'} جدید`}
                <button onClick={closeForm} className="float-left rounded-lg border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">بستن</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {formFields.map((f) => (
                  <label key={f.name} className="block">
                    <span className="mb-1 block text-[11px] font-bold text-slate-700 dark:text-slate-200">
                      {f.label}{f.required && <span className="text-red-600"> *</span>}
                    </span>
                    {f.kind === 'select' ? (
                      <select
                        value={form[f.name] ?? ''}
                        onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))}
                        className="h-8 w-full rounded-lg border border-input bg-card p-1 text-xs"
                      >
                        <option value="">— انتخاب کنید —</option>
                        {(f.choices ?? options[f.optionsFrom ?? 'degree'] ?? []).map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : f.kind === 'date' ? (
                      <Input
                        type="datetime-local"
                        dir="ltr"
                        value={form[f.name] ?? ''}
                        onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                        className="h-8 text-xs"
                      />
                    ) : f.kind === 'jdate' ? (
                      <Input
                        dir="ltr"
                        placeholder="1404/01/15"
                        value={form[f.name] ?? ''}
                        onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                        className="h-8 text-center font-mono text-xs"
                      />
                    ) : (
                      <Input
                        dir={f.kind === 'text' ? 'rtl' : 'ltr'}
                        inputMode={f.kind === 'number' ? 'decimal' : undefined}
                        value={form[f.name] ?? ''}
                        onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))}
                        className={'h-8 text-xs ' + (f.kind === 'text' ? '' : 'text-center font-mono')}
                      />
                    )}
                    {f.hint && <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{f.hint}</span>}
                  </label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  disabled={savingForm}
                  onClick={() => void submitForm()}
                  className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                >
                  {editingId != null ? 'ذخیرهٔ تغییرات' : 'ثبت'}
                </Button>
                <Button variant="outline" size="sm" onClick={closeForm} className="h-8 text-xs">انصراف</Button>
                <span className="text-[11px] text-muted-foreground">
                  {table === 'term'
                    ? 'تاریخ‌ها را وارد کنید؛ «ترم جاری» و «انتخاب واحد باز» در هر دانشگاه فقط برای یک ترم فعال می‌شود.'
                    : 'کد را همان‌طور بنویسید که در فایل‌های اکسل مبدأ آمده — تطبیق انتقال داده اول با کد انجام می‌شود.'}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="w-40 p-2.5">
                  <button onClick={() => toggleSort('code')} className="font-bold hover:text-indigo-600" title="مرتب‌سازی بر اساس کد">
                    کد{sortMark('code')}
                  </button>
                </th>
                <th className="p-2.5">
                  <button onClick={() => toggleSort('title')} className="font-bold hover:text-indigo-600" title="مرتب‌سازی بر اساس عنوان">
                    عنوان{sortMark('title')}
                  </button>
                </th>
                <th className="p-2.5">
                  <button onClick={() => toggleSort('context')} className="font-bold hover:text-indigo-600" title="مرتب‌سازی بر اساس زمینه">
                    زمینه{sortMark('context')}
                  </button>
                </th>
                {isTerm && <th className="w-28 p-2.5">شروع ترم</th>}
                {isTerm && <th className="w-28 p-2.5">پایان ترم</th>}
                <th className="w-32 p-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const val = dirty[r.id] ?? r.code ?? '';
                const changed = (dirty[r.id] ?? null) !== null && dirty[r.id] !== (r.code ?? '');
                return (
                  <tr
                    key={r.id}
                    className={
                      'border-t border-border ' +
                      (r.duplicate
                        ? 'bg-red-50/60 dark:bg-red-950/30'
                        : !r.code
                          ? 'bg-amber-50/40 dark:bg-amber-950/20'
                          : '')
                    }
                  >
                    <td className="p-2">
                      <Input
                        dir="ltr"
                        value={val}
                        disabled={!cur?.editable || pending}
                        onChange={(e) => setDirty((d) => ({ ...d, [r.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter' && changed) saveCodeMut.mutate({ id: r.id, code: val.trim(), title: r.title }); }}
                        placeholder="بدون کد"
                        className={
                          'h-7 w-32 border p-1 text-center font-mono text-xs ' +
                          (r.duplicate
                            ? 'border-red-400 bg-red-50 dark:bg-red-950'
                            : !r.code
                              ? 'border-amber-400 bg-amber-50 dark:bg-amber-950'
                              : '')
                        }
                      />
                    </td>
                    <td className="p-2 font-medium text-slate-800 dark:text-slate-100">
                      {r.title}
                      {r.duplicate && <span className="ms-1 rounded bg-red-100 px-1 text-[10px] text-red-700 dark:bg-red-950 dark:text-red-300">کد تکراری</span>}
                      {(r.standardCode || r.ministryCode) && (
                        <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                          {[r.standardCode ? `استاندارد ${r.standardCode}` : null, r.ministryCode ? `وزارت ${r.ministryCode}` : null]
                            .filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-muted-foreground">{r.context ?? '—'}</td>
                    {isTerm && (
                      <td className="p-2 font-mono text-[11px] text-muted-foreground" dir="ltr" title={r.startDate ?? 'بدون تاریخ'}>
                        {fmtDateFa(r.startDate)}
                      </td>
                    )}
                    {isTerm && (
                      <td className="p-2 font-mono text-[11px] text-muted-foreground" dir="ltr" title={r.endDate ?? 'بدون تاریخ'}>
                        {fmtDateFa(r.endDate)}
                      </td>
                    )}
                    <td className="p-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {changed && (
                          <Button
                            size="sm"
                            disabled={pending || saveCodeMut.isPending}
                            onClick={() => saveCodeMut.mutate({ id: r.id, code: val.trim(), title: r.title })}
                            className="h-7 bg-indigo-600 px-2 text-[11px] text-white hover:bg-indigo-700"
                          >
                            ذخیره
                          </Button>
                        )}
                        {table === 'degree' && cur?.editable && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pending}
                            onClick={() => void startEditDegree(r)}
                            title="ویرایش همهٔ فیلدهای مقطع (نمره‌ها، سقف واحد، تعداد ترم، تکمیلی)"
                            className="h-7 border-indigo-200 px-2 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300"
                          >
                            <Pencil className="size-3" aria-hidden /> ویرایش
                          </Button>
                        )}
                        {isTerm && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pending}
                            onClick={() => void startEditTerm(r)}
                            title="ویرایش زمان‌بندی ترم: شروع/پایان، انتخاب واحد، حذف و اضافه، امتحانات، اعتراضات"
                            className="h-7 border-indigo-200 px-2 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300"
                          >
                            <Pencil className="size-3" aria-hidden /> ویرایش
                          </Button>
                        )}
                        {GENERIC_EDIT_TABLES.includes(table) && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pending}
                            onClick={() => void startEditRow(r)}
                            title="ویرایش مشخصات و کد استاندارد"
                            className="h-7 border-indigo-200 px-2 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300"
                          >
                            <Pencil className="size-3" aria-hidden /> ویرایش
                          </Button>
                        )}
                        {cur?.creatable && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pending || deleteMut.isPending}
                            onClick={() => remove(r)}
                            title="حذف — فقط اگر هیچ‌جا استفاده نشده باشد"
                            className="h-7 border-red-200 px-2 text-[11px] text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400"
                          >
                            <Trash2 className="size-3" aria-hidden /> حذف
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={isTerm ? 6 : 4} className="p-6 text-center text-muted-foreground">ردیفی نیست.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 border-t border-border p-2 text-xs">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="h-7">قبلی</Button>
            <span className="text-muted-foreground">صفحهٔ {faDigits(page + 1)} از {faDigits(pages)}</span>
            <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="h-7">بعدی</Button>
          </div>
        )}
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        نگاشت کد قدیمی به کد جدید در{' '}
        <Link to="/admin/migration" className="text-indigo-600 hover:underline dark:text-indigo-400">انتقال داده ← تطبیق کدها</Link>{' '}
        انجام می‌شود · ساخت گروه آموزشی در{' '}
        <Link to="/admin/departments" className="text-indigo-600 hover:underline dark:text-indigo-400">گروه‌های آموزشی</Link>{' '}
        · مقطع، دانشکده و رشته را از دکمهٔ «افزودن» همین صفحه بسازید
      </p>
    </div>
  );
}
