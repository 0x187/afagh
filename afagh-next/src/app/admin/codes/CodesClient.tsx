'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { faIncludes, normalizeFa } from '@/lib/persian-search';
import { ADD_LABEL, CREATE_ELSEWHERE, EDIT_FIELDS, NEW_FIELDS, type CodeRow, type CodeStat, type CodeTable, type FormOptions } from './tables';
import { jalaliDateOf, parseJalaliDate } from '@/lib/scheduling-core';
import JalaliDateTimeInput from '@/components/JalaliDateTimeInput';
import Link from 'next/link';
import { askConfirm } from '@/lib/ui-feedback';

type Res = { ok: boolean; error?: string };

const PAGE = 200;

/** جدول‌هایی که با فرم عمومی ویرایش می‌شوند (دانشکده، گروه، رشته، درس) */
const GENERIC_EDIT_TABLES: CodeTable[] = ['faculty', 'department', 'major', 'course'];

/** 'YYYY-MM-DD' میلادی → 'YYYY/MM/DD' شمسی — برای فیلدهای نوع jdate */
const isoToJalali = (v: string): string => {
  if (!v) return '';
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return '';
  return jalaliDateOf(new Date(y, m - 1, d));
};

/** 'YYYY/MM/DD' شمسی → 'YYYY-MM-DD' میلادی — برای ورودی date */
const jalaliToIso = (v: string): string => {
  if (!v) return '';
  try {
    const d = parseJalaliDate(v);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return '';
  }
};

/** 'YYYY-MM-DDTHH:mm' یا 'YYYY-MM-DD' → تاریخ شمسی برای نمایش در جدول */
const fmtDateFa = (v?: string | null): string => {
  if (!v) return '—';
  return isoToJalali(v.slice(0, 10)) || v.slice(0, 10);
};

/** ارقام فارسی → لاتین (برای ساخت کد استاندارد از کد ترم) */
const toLatinDigits = (v: string): string =>
  v.replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));

/** کد استاندارد وزارت برای ترم — پیش‌فرض از روی کد ترم (مثلاً 13831 → TERM-13831) */
const defaultTermStandardCode = (code?: string | null): string =>
  code ? `TERM-${toLatinDigits(code)}` : '';

export default function CodesClient({
  stats,
  initialTable,
  initialRows,
  listAction,
  setCodeAction,
  createAction,
  deleteAction,
  options,
  getDegreeAction,
  updateDegreeAction,
  getTermAction,
  updateTermAction,
  getCodeRowAction,
  updateCodeRowAction,
}: {
  stats: CodeStat[];
  initialTable: CodeTable;
  initialRows: CodeRow[];
  listAction: (table: CodeTable, q: string) => Promise<CodeRow[]>;
  setCodeAction: (fd: FormData) => Promise<Res>;
  createAction: (fd: FormData) => Promise<Res & { id?: number }>;
  deleteAction: (fd: FormData) => Promise<Res>;
  options: FormOptions;
  getDegreeAction?: (id: number) => Promise<Record<string, string> | null>;
  updateDegreeAction?: (fd: FormData) => Promise<Res>;
  getTermAction?: (id: number) => Promise<Record<string, string> | null>;
  updateTermAction?: (fd: FormData) => Promise<Res>;
  getCodeRowAction?: (table: CodeTable, id: number) => Promise<Record<string, string> | null>;
  updateCodeRowAction?: (fd: FormData) => Promise<Res>;
}) {
  const [table, setTable] = useState<CodeTable>(initialTable);
  const [rows, setRows] = useState<CodeRow[]>(initialRows);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'ALL' | 'MISSING' | 'DUP'>('ALL');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: 'code' | 'title' | 'context'; dir: 1 | -1 } | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [dirty, setDirty] = useState<Record<number, string>>({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);

  const cur = stats.find(s => s.id === table);
  const isTerm = table === 'term';
  const newFields = NEW_FIELDS[table] ?? [];
  const elsewhere = CREATE_ELSEWHERE[table];
  // فرمِ ویرایش ممکن است از فرمِ ساخت متفاوت باشد (ترم: زمان‌بندی کامل)
  const editFields = EDIT_FIELDS[table] ?? newFields;
  const formFields = editingId != null ? editFields : newFields;

  // با عوض‌شدن جدول، فرمِ باز را ببند و مقادیر پیش‌فرض را بگذار
  useEffect(() => {
    setAdding(false);
    setEditingId(null);
    setForm(Object.fromEntries((NEW_FIELDS[table] ?? []).map(f => [f.name, f.def ?? ''])));
  }, [table]);

  const closeForm = () => {
    setAdding(false);
    setEditingId(null);
    setForm(Object.fromEntries(newFields.map(f => [f.name, f.def ?? ''])));
  };

  const submitNew = () =>
    start(async () => {
      const fd = new FormData();
      fd.set('table', table);
      for (const f of formFields) {
        // فیلد شمسی (jdate) با تبدیل میلادی→شمسی فرستاده می‌شود
        const raw = form[f.name] ?? '';
        fd.set(f.name, f.kind === 'jdate' && raw ? isoToJalali(raw) : raw);
      }
      if (editingId != null && table === 'degree' && updateDegreeAction) {
        fd.set('id', String(editingId));
        const r = await updateDegreeAction(fd);
        if (r.ok) {
          setMsg({ kind: 'ok', text: 'مقطع به‌روزرسانی شد.' });
          closeForm();
          setRows(await listAction(table, ''));
        } else {
          setMsg({ kind: 'err', text: r.error ?? 'به‌روزرسانی نشد.' });
        }
        return;
      }
      if (editingId != null && table === 'term' && updateTermAction) {
        fd.set('id', String(editingId));
        const r = await updateTermAction(fd);
        if (r.ok) {
          setMsg({ kind: 'ok', text: 'زمان‌بندی ترم به‌روزرسانی شد.' });
          closeForm();
          setRows(await listAction(table, ''));
        } else {
          setMsg({ kind: 'err', text: r.error ?? 'به‌روزرسانی نشد.' });
        }
        return;
      }
      // ویرایش عمومی: رشته، گروه آموزشی، درس، دانشکده
      if (editingId != null && updateCodeRowAction) {
        fd.set('id', String(editingId));
        const r = await updateCodeRowAction(fd);
        if (r.ok) {
          setMsg({ kind: 'ok', text: 'با موفقیت ویرایش شد.' });
          closeForm();
          setRows(await listAction(table, ''));
        } else {
          setMsg({ kind: 'err', text: r.error ?? 'به‌روزرسانی نشد.' });
        }
        return;
      }
      const r = await createAction(fd);
      if (r.ok) {
        setMsg({ kind: 'ok', text: 'رکورد تازه ثبت شد. برای دیده‌شدن در فهرست‌های دیگر، صفحه را تازه کنید.' });
        closeForm();
        setRows(await listAction(table, ''));
      } else {
        setMsg({ kind: 'err', text: r.error ?? 'ثبت نشد.' });
      }
    });

  const startEditDegree = (row: CodeRow) =>
    start(async () => {
      if (!getDegreeAction) return;
      const d = await getDegreeAction(row.id);
      if (!d) {
        setMsg({ kind: 'err', text: 'خواندن مقطع ناموفق بود.' });
        return;
      }
      setForm(Object.fromEntries(newFields.map(f => [f.name, d[f.name] ?? f.def ?? ''])));
      setEditingId(row.id);
      setAdding(true);
      setMsg({ kind: 'ok', text: `در حال ویرایش مقطع «${row.title}» — برای انصراف، «انصراف» را بزنید.` });
    });

  const startEditTerm = (row: CodeRow) =>
    start(async () => {
      if (!getTermAction) return;
      const d = await getTermAction(row.id);
      if (!d) {
        setMsg({ kind: 'err', text: 'خواندن ترم ناموفق بود.' });
        return;
      }
setForm(Object.fromEntries(editFields.map(f => {
        let v = d[f.name] ?? f.def ?? '';
        // اگر کد استاندارد وزارت خالی است، از کد ترم ساخته می‌شود (قابل تغییر)
        if (f.name === 'standardCode' && !v) v = defaultTermStandardCode(row.code);
        // فیلد شمسی (jdate) از 'YYYY/MM/DD' به 'YYYY-MM-DD' تبدیل می‌شود
        return [f.name, f.kind === 'jdate' ? jalaliToIso(v) : v];
      })));
      setEditingId(row.id);
      setAdding(true);
      setMsg({ kind: 'ok', text: `در حال ویرایش ترم «${row.title}» — برای انصراف، «انصراف» را بزنید.` });
    });

  /** ویرایش عمومی: دانشکده، گروه آموزشی، رشته، درس */
  const startEditRow = (row: CodeRow) =>
    start(async () => {
      if (!getCodeRowAction) return;
      const d = await getCodeRowAction(table, row.id);
      if (!d) {
        setMsg({ kind: 'err', text: 'خواندن اطلاعات سطر ناموفق بود.' });
        return;
      }
      setForm(Object.fromEntries(editFields.map(f => [f.name, d[f.name] ?? f.def ?? ''])));
      setEditingId(row.id);
      setAdding(true);
      setMsg({ kind: 'ok', text: `در حال ویرایش «${row.title}» — برای انصراف، «انصراف» را بزنید.` });
    });

  const remove = (row: CodeRow) =>
    start(async () => {
      const ok = await askConfirm({
        title: 'حذف کد',
        body: `«${row.title}» حذف شود؟ اگر جایی استفاده شده باشد، حذف نمی‌شود.`,
        confirmText: 'حذف کن',
        danger: true,
      });
      if (!ok) return;
      const fd = new FormData();
      fd.set('table', table);
      fd.set('id', String(row.id));
      const r = await deleteAction(fd);
      if (r.ok) {
        setMsg({ kind: 'ok', text: `«${row.title}» حذف شد.` });
        setRows(await listAction(table, ''));
      } else {
        setMsg({ kind: 'err', text: r.error ?? 'حذف نشد.' });
      }
    });

  // بارگذاری جدول انتخاب‌شده
  useEffect(() => {
    start(async () => {
      setRows(await listAction(table, ''));
      setPage(0);
      setDirty({});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  const filtered = useMemo(() => {
    const t = normalizeFa(q);
    const base = rows.filter(r => {
      if (only === 'MISSING' && r.code) return false;
      if (only === 'DUP' && !r.duplicate) return false;
      if (!t) return true;
      return faIncludes(r.title, t) || (r.code ?? '').includes(t) || faIncludes(r.context, t);
    });
    if (!sort) return base;
    const get = (r: CodeRow) => (sort.key === 'code' ? (r.code ?? '') : sort.key === 'title' ? r.title : (r.context ?? ''));
    return [...base].sort((a, b) => get(a).localeCompare(get(b), 'fa', { numeric: true }) * sort.dir);
  }, [rows, q, only, sort]);

  const toggleSort = (key: 'code' | 'title' | 'context') => {
    setPage(0);
    setSort(s => {
      if (!s || s.key !== key) return { key, dir: 1 };
      if (s.dir === 1) return { key, dir: -1 };
      return null;
    });
  };
  const sortMark = (key: 'code' | 'title' | 'context') =>
    sort?.key !== key ? ' ↕' : sort.dir === 1 ? ' ▲' : ' ▼';

  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.ceil(filtered.length / PAGE);

  const save = (row: CodeRow, code: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set('table', table);
      fd.set('id', String(row.id));
      fd.set('code', code);
      const r = await setCodeAction(fd);
      if (r.ok) {
        setMsg({ kind: 'ok', text: `کد «${row.title}» ذخیره شد.` });
        setRows(await listAction(table, ''));
        setDirty(d => { const n = { ...d }; delete n[row.id]; return n; });
      } else {
        setMsg({ kind: 'err', text: r.error ?? 'ذخیره نشد.' });
      }
    });

  return (
    <div className="space-y-4">
      {/* کارت‌های سلامت کد */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map(s => {
          const active = s.id === table;
          const bad = s.missing > 0 || s.duplicate > 0;
          return (
            <button
              key={s.id}
              onClick={() => setTable(s.id)}
              className={
                'rounded-xl border p-3 text-right transition-colors ' +
                (active ? 'border-indigo-500 bg-indigo-50' : bad ? 'border-amber-200 bg-white hover:bg-amber-50' : 'border-slate-200 bg-white hover:bg-slate-50')
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-800">{s.title}</span>
                <span className="text-xs tabular-nums text-slate-400">{s.total.toLocaleString('fa-IR')}</span>
              </div>
              <p className="mt-0.5 text-2xs leading-5 text-slate-500">{s.hint}</p>
              <div className="mt-1 flex flex-wrap gap-1 text-3xs">
                {s.missing > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">{s.missing.toLocaleString('fa-IR')} بدون کد</span>}
                {s.duplicate > 0 && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">{s.duplicate.toLocaleString('fa-IR')} کد تکراری</span>}
                {s.missing === 0 && s.duplicate === 0 && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">✓ همه کد دارند</span>}
                {!s.editable && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                    {s.id === 'term' ? 'کد ثابت · زمان‌بندی ویرایش‌پذیر' : s.creatable ? 'کد ثابت — فقط افزودن' : 'فقط خواندنی'}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {msg && (
        <div className={'rounded-xl border p-3 text-sm ' + (msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700')}>
          {msg.text}
          <button onClick={() => setMsg(null)} className="float-left text-xs opacity-60 hover:opacity-100">بستن</button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <h2 className="text-sm font-extrabold text-slate-800">{cur?.title}</h2>
          <input
            value={q}
            onChange={e => { setQ(e.target.value); setPage(0); }}
            placeholder="جستجوی کد، عنوان یا زمینه…"
            className="w-56 rounded-lg border border-slate-300 p-1.5 text-xs"
          />
          <div className="flex gap-1 text-2xs">
            {([['ALL', 'همه'], ['MISSING', 'بدون کد'], ['DUP', 'کد تکراری']] as const).map(([k, lbl]) => (
              <button
                key={k}
                onClick={() => { setOnly(k); setPage(0); }}
                className={'rounded-lg border px-2 py-1 ' + (only === k ? 'border-indigo-400 bg-indigo-50 font-bold text-indigo-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}
              >
                {lbl}
              </button>
            ))}
          </div>
          <span className="mr-auto text-2xs text-slate-400">
            {filtered.length.toLocaleString('fa-IR')} ردیف
            {pending && ' · در حال بارگذاری…'}
          </span>
          {cur?.creatable && (
            <button
              onClick={() => (adding ? closeForm() : setAdding(true))}
              className={'rounded-lg px-3 py-1.5 text-xs font-bold ' + (adding ? 'bg-slate-200 text-slate-700' : 'bg-emerald-600 text-white hover:bg-emerald-700')}
            >
              {adding ? 'انصراف' : `➕ ${ADD_LABEL[table] ?? 'افزودن'}`}
            </button>
          )}
          {elsewhere && (
            <Link href={elsewhere.href} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
              ➕ {elsewhere.label}
            </Link>
          )}
        </div>

        {/* فرم افزودن / ویرایش — به‌صورت پاپ‌آپ */}
        {adding && (cur?.creatable || editingId != null) && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-3 backdrop-blur-[1px]"
            onClick={closeForm}
          >
          <div
            className="my-6 w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className={'mb-2 rounded-lg px-3 py-2 text-2xs font-bold text-slate-700 ' + (editingId != null ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700')}>
              {editingId != null ? `✏️ ویرایش ${cur?.title}` : `➕ ${ADD_LABEL[table] ?? 'افزودن'} جدید`}
              <button onClick={closeForm} className="float-left rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-2xs text-slate-600">بستن</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {formFields.map(f => (
                <label key={f.name} className="block">
                  <span className="mb-1 block text-2xs font-bold text-slate-700">
                    {f.label}{f.required && <span className="text-red-600"> *</span>}
                  </span>
                  {f.kind === 'select' ? (
                    <select
                      value={form[f.name] ?? ''}
                      onChange={e => setForm(v => ({ ...v, [f.name]: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white p-1.5 text-xs"
                    >
                      <option value="">— انتخاب کنید —</option>
                      {(f.choices ?? options[f.optionsFrom ?? 'degree'] ?? []).map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : f.kind === 'date' ? (
                    <JalaliDateTimeInput
                      value={form[f.name] ?? ''}
                      onChange={v => setForm(s => ({ ...s, [f.name]: v }))}
                      withTime
                    />
                  ) : f.kind === 'jdate' ? (
                    <JalaliDateTimeInput
                      value={form[f.name] ?? ''}
                      onChange={v => setForm(s => ({ ...s, [f.name]: v }))}
                      withTime={false}
                    />
                  ) : (
                    <input
                      dir={f.kind === 'text' ? 'rtl' : 'ltr'}
                      inputMode={f.kind === 'number' ? 'decimal' : undefined}
                      value={form[f.name] ?? ''}
                      onChange={e => setForm(v => ({ ...v, [f.name]: e.target.value }))}
                      className={'w-full rounded-lg border border-slate-300 p-1.5 text-xs ' + (f.kind === 'text' ? '' : 'text-center font-mono')}
                    />
                  )}
                  {f.hint && <span className="mt-0.5 block text-3xs leading-4 text-slate-500">{f.hint}</span>}
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                disabled={pending}
                onClick={submitNew}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {editingId != null ? 'ذخیرهٔ تغییرات' : 'ثبت'}
              </button>
              <button onClick={closeForm} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600">انصراف</button>
              <span className="text-2xs text-slate-500">
                {table === 'term'
                  ? 'تاریخ‌ها را وارد کنید؛ «ترم جاری» و «انتخاب واحد باز» در هر دانشگاه فقط برای یک ترم فعال می‌شود.'
                  : 'کد را همان‌طور بنویسید که در فایل‌های اکسل مبدأ آمده — تطبیق انتقال داده اول با کد انجام می‌شود.'}
              </span>
            </div>
          </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs rt">
            <thead className="bg-slate-50 text-slate-500">
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
              {shown.map(r => {
                const val = dirty[r.id] ?? r.code ?? '';
                const changed = (dirty[r.id] ?? null) !== null && dirty[r.id] !== (r.code ?? '');
                return (
                  <tr key={r.id} className={'border-t border-slate-100 ' + (r.duplicate ? 'bg-red-50/60' : !r.code ? 'bg-amber-50/40' : '')}>
                    <td className="p-2">
                      <input
                        dir="ltr"
                        value={val}
                        disabled={!cur?.editable || pending}
                        onChange={e => setDirty(d => ({ ...d, [r.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter' && changed) save(r, val.trim()); }}
                        placeholder="بدون کد"
                        className={
                          'w-32 rounded border p-1 text-center font-mono disabled:bg-slate-50 disabled:text-slate-500 ' +
                          (r.duplicate ? 'border-red-400 bg-red-50' : !r.code ? 'border-amber-400 bg-amber-50' : 'border-slate-300')
                        }
                      />
                    </td>
                    <td className="p-2 font-medium text-slate-800">
                      {r.title}
                      {r.duplicate && <span className="mr-1 rounded bg-red-100 px-1 text-3xs text-red-700">کد تکراری</span>}
                      {(r.standardCode || r.ministryCode) && (
                        <span className="mt-0.5 block text-3xs font-normal text-slate-400">
                          {[r.standardCode ? `استاندارد ${r.standardCode}` : null, r.ministryCode ? `وزارت ${r.ministryCode}` : null]
                            .filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-slate-500">{r.context ?? '—'}</td>
                    {isTerm && (
                      <td className="p-2 font-mono text-2xs text-slate-600" dir="ltr" title={r.startDate ?? 'بدون تاریخ'}>
                        {fmtDateFa(r.startDate)}
                      </td>
                    )}
                    {isTerm && (
                      <td className="p-2 font-mono text-2xs text-slate-600" dir="ltr" title={r.endDate ?? 'بدون تاریخ'}>
                        {fmtDateFa(r.endDate)}
                      </td>
                    )}
                    <td className="p-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {changed && (
                          <button
                            disabled={pending}
                            onClick={() => save(r, val.trim())}
                            className="rounded bg-indigo-600 px-2 py-1 text-2xs font-bold text-white disabled:opacity-50"
                          >
                            ذخیره
                          </button>
                        )}
                        {table === 'degree' && cur?.editable && getDegreeAction && (
                          <button
                            disabled={pending}
                            onClick={() => startEditDegree(r)}
                            title="ویرایش همهٔ فیلدهای مقطع (نمره‌ها، سقف واحد، تعداد ترم، تکمیلی)"
                            className="rounded border border-indigo-200 px-2 py-1 text-2xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                          >
                            ویرایش
                          </button>
                        )}
                        {isTerm && getTermAction && (
                          <button
                            disabled={pending}
                            onClick={() => startEditTerm(r)}
                            title="ویرایش زمان‌بندی ترم: شروع/پایان، انتخاب واحد، حذف و اضافه، امتحانات، اعتراضات"
                            className="rounded border border-indigo-200 px-2 py-1 text-2xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                          >
                            ویرایش
                          </button>
                        )}
                        {GENERIC_EDIT_TABLES.includes(table) && getCodeRowAction && (
                          <button
                            disabled={pending}
                            onClick={() => startEditRow(r)}
                            title="ویرایش مشخصات و کد استاندارد"
                            className="rounded border border-indigo-200 px-2 py-1 text-2xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                          >
                            ویرایش
                          </button>
                        )}
                        {cur?.creatable && (
                          <button
                            disabled={pending}
                            onClick={() => remove(r)}
                            title="حذف — فقط اگر هیچ‌جا استفاده نشده باشد"
                            className="rounded border border-red-200 px-2 py-1 text-2xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            حذف
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={isTerm ? 6 : 4} className="p-6 text-center text-slate-400">ردیفی نیست.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 border-t border-slate-100 p-2 text-xs">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">قبلی</button>
            <span className="text-slate-500">صفحهٔ {(page + 1).toLocaleString('fa-IR')} از {pages.toLocaleString('fa-IR')}</span>
            <button disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">بعدی</button>
          </div>
        )}
      </div>
    </div>
  );
}
