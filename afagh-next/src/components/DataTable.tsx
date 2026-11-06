'use client';

/**
 * سرستون‌های مرتب‌شونده + فیلتر ستونی — مشترک همه لیست‌های افراد.
 * دو حالت:
 *  ۱) کلاینتی (داده کامل دست مرورگر است): useClientTable
 *  ۲) سروری (صفحه‌بندی سمت سرور): ServerTh + FilterBox که با nav/canonical URL کار می‌کند
 */

import { useMemo, useState } from 'react';
import { faIncludes } from '@/lib/persian-search';

export type SortDir = 'asc' | 'desc';

export type ColumnDef<T> = {
  /** کلید یکتای ستون (برای سورت سروری هم همین به سرور می‌رود) */
  key: string;
  label: string;
  /** خواندن مقدار نمایشی/مقایسه‌ای از ردیف */
  get: (row: T) => string | number | null | undefined;
  /** عددی است؟ (مرتب‌سازی عددی به‌جای رشته‌ای) */
  numeric?: boolean;
  /** آیا این ستون فیلتر متنی دارد؟ */
  filterable?: boolean;
  /** آیا این ستون سورت دارد؟ (پیش‌فرض true) */
  sortable?: boolean;
  className?: string;
};

/* ── حالت کلاینتی ── */

export function useClientTable<T>(rows: T[], columns: ColumnDef<T>[]) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filters, setFilters] = useState<Record<string, string>>({});

  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else {
      setSortKey(null);
    }
  };

  const setFilter = (key: string, v: string) =>
    setFilters(prev => {
      const next = { ...prev };
      if (!v.trim()) delete next[key];
      else next[key] = v.trim();
      return next;
    });

  const visible = useMemo(() => {
    const byKey = new Map(columns.map(c => [c.key, c]));
    let out = rows;
    const fKeys = Object.keys(filters);
    if (fKeys.length) {
      out = out.filter(r =>
        fKeys.every(k => {
          const col = byKey.get(k);
          if (!col) return true;
          const v = col.get(r);
          return faIncludes(String(v ?? ''), filters[k]);
        }),
      );
    }
    if (sortKey) {
      const col = byKey.get(sortKey);
      if (col) {
        const dir = sortDir === 'asc' ? 1 : -1;
        out = [...out].sort((a, b) => {
          const va = col.get(a);
          const vb = col.get(b);
          if (col.numeric) {
            const na = va == null || va === '' ? Number.NaN : Number(va);
            const nb = vb == null || vb === '' ? Number.NaN : Number(vb);
            if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
            if (Number.isNaN(na)) return 1;
            if (Number.isNaN(nb)) return -1;
            return (na - nb) * dir;
          }
          return String(va ?? '').localeCompare(String(vb ?? ''), 'fa') * dir;
        });
      }
    }
    return out;
  }, [rows, columns, sortKey, sortDir, filters]);

  return { visible, sortKey, sortDir, filters, toggleSort, setFilter };
}

/** سرستون کلاینتی: کلیک = سورت، باکس زیر = فیلتر */
export function ClientTh<T>({
  col, sortKey, sortDir, filter, onSort, onFilter,
}: {
  col: ColumnDef<T>;
  sortKey: string | null;
  sortDir: SortDir;
  filter: string;
  onSort: () => void;
  onFilter: (v: string) => void;
}) {
  const active = sortKey === col.key;
  return (
    <th className={`p-2 align-top ${col.className ?? ''}`}>
      {col.sortable === false ? (
        <span className="whitespace-nowrap">{col.label}</span>
      ) : (
        <button onClick={onSort} title="مرتب‌سازی" className={`font-bold hover:text-indigo-700 whitespace-nowrap ${active ? 'text-indigo-700' : ''}`}>
          {col.label}{' '}
          <span className="inline-block w-4 text-center">
            {active ? (sortDir === 'asc' ? '▲' : '▼') : <span className="opacity-30">⇅</span>}
          </span>
        </button>
      )}
      {col.filterable !== false && (
        <input
          value={filter}
          onChange={e => onFilter(e.target.value)}
          onClick={e => e.stopPropagation()}
          placeholder="فیلتر…"
          className="mt-1 block h-7 w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-2xs font-normal"
        />
      )}
    </th>
  );
}

/* ── خروجی Excel (CSV) و متنی (TSV) با انتخاب ستون ── */

export type ExportColumn = { key: string; label: string };

function downloadFile(filename: string, mime: string, content: string) {
  const blob = new Blob(['\uFEFF' + content], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

const escCsv = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * دکمه‌های خروجی بالای لیست (سمت چپ) + پنل انتخاب ستون‌ها.
 * getRows: ماتریس رشته‌ای سطرها به ترتیب ستون‌های انتخاب‌شده.
 */
export function ExportButtons({
  columns,
  getRows,
  filename,
  pending,
}: {
  columns: ExportColumn[];
  getRows: (cols: ExportColumn[]) => string[][] | Promise<string[][]>;
  filename: string;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>(() => Object.fromEntries(columns.map(c => [c.key, true])));
  const chosen = columns.filter(c => sel[c.key]);
  const toggle = (key: string) => setSel(prev => ({ ...prev, [key]: !prev[key] }));

  const doExport = async (kind: 'csv' | 'tsv') => {
    if (!chosen.length || busy) return;
    setBusy(true);
    try {
      const rows = await getRows(chosen);
      const sep = kind === 'csv' ? ',' : '\t';
      const body = [chosen.map(c => escCsv(c.label)).join(sep), ...rows.map(r => r.map(escCsv).join(sep))].join('\r\n');
      downloadFile(`${filename}.${kind === 'csv' ? 'csv' : 'txt'}`, kind === 'csv' ? 'text/csv' : 'text/plain', body);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={pending || busy}
        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-bold rounded disabled:opacity-50"
      >
        {busy ? 'در حال آماده‌سازی…' : '📤 خروجی'}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-64 rounded-xl border border-slate-300 bg-white p-3 shadow-xl space-y-2">
          <p className="text-2xs font-bold text-slate-600">ستون‌های خروجی:</p>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {columns.map(c => (
              <label key={c.key} className="flex items-center gap-1.5 text-xs cursor-pointer hover:bg-slate-50 rounded px-1 py-0.5">
                <input type="checkbox" checked={!!sel[c.key]} onChange={() => toggle(c.key)} className="w-3.5 h-3.5" />
                {c.label}
              </label>
            ))}
          </div>
          <div className="flex gap-1.5 pt-1 border-t border-slate-100">
            <button onClick={() => doExport('csv')} disabled={!chosen.length || pending} className="flex-1 px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-2xs font-bold rounded disabled:opacity-50">
              Excel (CSV)
            </button>
            <button onClick={() => doExport('tsv')} disabled={!chosen.length || pending} className="flex-1 px-2 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-2xs font-bold rounded disabled:opacity-50">
              فایل متنی
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── حالت سروری (صفحه‌بندی سمت سرور) ── */

/** سرستون سروری: کلیک = nav با sort=key:dir */
export function ServerTh({
  label, sortKey, activeKey, dir, onSort, filter, onFilter, onApply, filterPlaceholder, className,
}: {
  label: string;
  sortKey: string;
  activeKey: string | null;
  dir: SortDir;
  onSort: () => void;
  filter?: string;
  onFilter?: (v: string) => void;
  onApply?: () => void;
  filterPlaceholder?: string;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th className={`p-2 align-top ${className ?? ''}`}>
      <button onClick={onSort} title="مرتب‌سازی" className={`font-bold hover:text-indigo-700 whitespace-nowrap ${active ? 'text-indigo-700' : ''}`}>
        {label}{' '}
        <span className="inline-block w-4 text-center">
          {active ? (dir === 'asc' ? '▲' : '▼') : <span className="opacity-30">⇅</span>}
        </span>
      </button>
      {onFilter && (
        <input
          value={filter ?? ''}
          onChange={e => onFilter(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onApply?.(); } }}
          placeholder={filterPlaceholder ?? 'فیلتر…'}
          className="mt-1 block h-7 w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-2xs font-normal"
        />
      )}
    </th>
  );
}
