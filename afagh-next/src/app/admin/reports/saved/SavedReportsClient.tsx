'use client';

import { useState } from 'react';
import Link from 'next/link';
import { deleteSavedReport, exportSavedReportAction, runSavedReportAction } from './actions';
import type { SavedReportRow } from './types';
import { formatReportCell as fmtCell } from '@/lib/report-format';
import { askConfirm } from '@/lib/ui-feedback';

const VIS_FA: Record<string, string> = {
  PRIVATE: '🔒 خصوصی',
  ROLE: '👥 نقش‌های مشخص',
  PUBLIC: '🌐 عمومی',
};

export default function SavedReportsClient({ reports }: { reports: SavedReportRow[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [result, setResult] = useState<{
    columns: { key: string; title: string; format?: string }[];
    rows: Record<string, unknown>[];
    total: number; page: number; totalPages: number; notes?: string[];
  } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (id: number, page = 1) => {
    setBusy(true);
    setErr('');
    const res = await runSavedReportAction(id, page);
    setBusy(false);
    if (!res.ok) { setErr(res.error); setResult(null); return; }
    setActive(id);
    setResult({
      columns: res.result.columns,
      rows: res.result.rows,
      total: res.result.total,
      page: res.result.page,
      totalPages: res.result.totalPages,
      notes: res.result.notes,
    });
  };

  const doExport = async (r: SavedReportRow) => {
    setBusy(true);
    setErr('');
    const res = await exportSavedReportAction(r.id);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    const quote = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = '﻿' + [res.header.map(quote).join(','), ...res.lines.map(l => l.map(quote).join(','))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `report-${r.id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doDelete = async (r: SavedReportRow) => {
    const ok = await askConfirm({
      title: 'حذف گزارش ذخیره‌شده',
      body: `گزارشِ «${r.name}» حذف شود؟`,
      confirmText: 'حذف کن',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await deleteSavedReport(r.id);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    location.reload();
  };

  if (!reports.length) {
    return (
      <div className="card !p-6 text-center">
        <p className="text-sm text-slate-500">هنوز گزارشی ذخیره نشده است.</p>
        <Link prefetch={false} href="/admin/reports/builder" className="btn btn-primary mt-3">🛠️ ساختِ گزارش تازه</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link prefetch={false} href="/admin/reports/builder" className="btn btn-primary">🛠️ گزارش‌ساز</Link>
      </div>

      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map(r => (
          <div key={r.id} className="card !p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">{r.sourceIcon} {r.name}</div>
                {r.description && <div className="text-2xs text-slate-500 mt-0.5 leading-5">{r.description}</div>}
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-2xs text-slate-600">
                {VIS_FA[r.visibility] ?? r.visibility}
              </span>
            </div>

            <div className="text-2xs text-slate-400">
              منبع: {r.sourceTitle} · سازنده: {r.ownerName} · {r.config?.columns?.length ?? 0} ستون
            </div>

            <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
              <button type="button" onClick={() => run(r.id, 1)} disabled={busy} className="btn btn-primary !px-2.5 !py-1 text-2xs">
                ▶ اجرا
              </button>
              <button type="button" onClick={() => doExport(r)} disabled={busy} className="btn btn-ghost !px-2.5 !py-1 text-2xs">
                📥 خروجی
              </button>
              {r.isOwner && (
                <>
                  <Link prefetch={false} href={`/admin/reports/builder?edit=${r.id}`} className="btn btn-ghost !px-2.5 !py-1 text-2xs">✏️ ویرایش</Link>
                  <button type="button" onClick={() => doDelete(r)} disabled={busy} className="btn btn-ghost !px-2.5 !py-1 text-2xs !text-rose-600">🗑 حذف</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {result && active !== null && (
        <div className="card !p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-slate-900">نتیجهٔ گزارش</h2>
            <span className="text-2xs text-slate-500">
              {result.total.toLocaleString('fa-IR')} ردیف · صفحهٔ {result.page.toLocaleString('fa-IR')} از {result.totalPages.toLocaleString('fa-IR')}
            </span>
          </div>

          {!!result.notes?.length && (
            <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1.5 text-2xs text-amber-800">{result.notes.join(' ')}</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="text-2xs text-slate-500 border-b border-slate-200">
                <tr>{result.columns.map(c => <th key={c.key} className="p-2 whitespace-nowrap">{c.title}</th>)}</tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {result.columns.map(c => (
                      <td key={c.key} className="p-2 whitespace-nowrap text-slate-700">{fmtCell(r[c.key], c.format)}</td>
                    ))}
                  </tr>
                ))}
                {!result.rows.length && (
                  <tr><td colSpan={result.columns.length} className="p-4 text-center text-slate-400">ردیفی برای نمایش نیست.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {result.totalPages > 1 && (
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => active && run(active, Math.max(1, result.page - 1))} disabled={result.page <= 1} className="btn btn-ghost !px-2 !py-1 text-2xs">قبلی</button>
              <span className="text-2xs text-slate-500">صفحهٔ {result.page.toLocaleString('fa-IR')}</span>
              <button type="button" onClick={() => active && run(active, Math.min(result.totalPages, result.page + 1))} disabled={result.page >= result.totalPages} className="btn btn-ghost !px-2 !py-1 text-2xs">بعدی</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
