'use client';

import React from 'react';
import { faNum, formatReportCell as fmtCell } from '@/lib/report-format';

/**
 * لایهٔ چاپی گزارش — فقط در حالتِ چاپ (print media) نمایش داده می‌شود.
 * وقتی کاربر دکمهٔ چاپ مرورگر را می‌زند، این لایه overlay می‌شود و محتوای
 * ReportResult را با چیدمانِ چاپی (سرтанه، جدول، شماره، تاریخ، امضاء،
 * حاشیهٔ A4) نمایش می‌دهد.
 *
 * چرا: گزارش‌های مالی برای حسابرس باید کاغذی، عدد با جداکنندهٔ هزارگان،
 * تاریخ شمسی، جدول ردیف‌به‌ردیف و امضاء داشته باشد. نمایشِ screen (HTML)
 * مناسب-print نیست (سرтанه، رنگ‌های پس‌زمینه، دکمه‌ها، …).
 */
export default function ReportPrint({
  title,
  subtitle,
  columns,
  rows,
  summary,
  universityTitle,
  reportDate,
}: {
  /** عنوان گزارش */
  title: string;
  /** زیرعنوان */
  subtitle: string;
  /** ستون‌ها (همان ReportColumn[]) */
  columns: { key: string; title: string; format?: string }[];
  /** ردیف‌ها (همان ReportResult.rows[]) */
  rows: Record<string, unknown>[];
  /** متن خلاصه */
  summary?: string;
  /** نام دانشگاه */
  universityTitle?: string;
  /** تاریخ گزارش */
  reportDate?: string;
}) {
  const faDate = reportDate || new Date().toLocaleDateString('fa-IR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  return (
    <>
      {/* دکمهٔ چاپ — فقط روی نمایش (screen) */}
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg bg-indigo-700 px-4 py-2 text-xs font-bold text-white transition hover:bg-indigo-800 print:hidden"
      >
        🖨️ چاپ گزارش
      </button>

      {/* لایهٔ چاپی — فقط در حالتِ print (screen پرزنه است) */}
      <div
        className="report-print-overlay hidden print:!flex print:items-center print:justify-center print:bg-white print:fixed print:inset-0 print:z-[100] print:p-4 print:text-black print:font-[Vazirmatn]"
      >
        <div
          className="hidden print:block print:w-full print:max-w-[180mm] print:p-6mm print:bg-white print:border print:border-black"
        >
          {/* سرтанه */}
          <div className="print:mb-6mm print:flex print:flex-col print:items-start print:gap-1">
            <div className="print:flex print:items-center print:gap-2 print:font-bold print:text-sm">
              <span className="print:h-4 print:w-4">🏛️</span>
              <span>{universityTitle ?? 'سامانه جامع آفاق'}</span>
            </div>
            <div className="print:text-xl print:font-black print:leading-tight">{title}</div>
            {subtitle && <div className="print:text-xs print:text-slate-600">{subtitle}</div>}
            <div className="print:flex print:gap-4 print:text-xs print:text-slate-600 print:mt-1">
              <span>تاریخ گزارش: {faDate}</span>
              <span>صفحه: <span className="print:font-bold">۱</span></span>
            </div>
          </div>

          {/* جدول */}
          <table className="print:w-full print:border print:border-collapse print:mt-4mm print:text-xs print:leading-5">
            <thead className="print:bg-slate-100 print:text-black print:font-bold print:uppercase print:text-[9px]">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className="print:p-1mm print:text-right print:border print:border-black print:text-[9px] print:leading-4"
                  >
                    {c.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="print:bg-white print:text-black print:text-[9px] print:leading-4 print:border-b print:border-black">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className="print:p-1mm print:text-right print:border-b print:border-black/30 print:text-[9px] print:leading-4"
                      dir={
                        /^[0-9]/.test(String(row[c.key] ?? ''))
                          ? 'ltr'
                          : 'auto'
                      }
                    >
                      {fmtCell(row[c.key], c.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {/* خلاصه */}
          {summary && (
            <div className="print:mt-4mm print:pt-2mm print:border-t print:border-black print:text-xs print:text-slate-700 print:font-bold">
              {summary}
            </div>
          )}

          {/* امضاء */}
          <div className="print:mt-8mm print:flex print:justify-between print:text-xs print:text-slate-600">
            <div className="print:w-1/3 print:border-t print:border-black print:pt-1mm print:text-center">
              اجرا شده توسط
            </div>
            <div className="print:w-1/3 print:border-t print:border-black print:pt-1mm print:text-center">
              تایید حسابدار
            </div>
            <div className="print:w-1/3 print:border-t print:border-black print:pt-1mm print:text-center">
              مدیر مالی
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
