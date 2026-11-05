'use client';

import React, { useEffect, useMemo } from 'react';
import { faNum, formatReportCell as fmtCell } from '@/lib/report-format';
import {
  cleanupReportPrint,
  prepareReportPrint,
  printReportDocument,
  type ReportPrintOrientation,
} from '@/lib/print-report';

/**
 * سند چاپی گزارش — **یک کپی ایزوله در ریشهٔ body** چاپ میشود، نه overlay
 * داخل صفحه. الگوی کار همان `print-transcript.ts` است (نگاه کنید به
 * `src/lib/print-report.ts`).
 *
 * مشکلاتی که این نسخه برطرف میکند (پیشنمایش چاپ گزارش‌های مالی):
 *   • نوار تاریک عمودی کنار کاغذ  → همهٔ فرزندان body جز ریشهٔ چاپی پنهانند
 *   • تاریخ/آدرس سایت/«۱/۲» مرورگر → `@page { margin: 0 }`
 *   • نبود سربرگ و تیتر گزارش    → سربرگ ثابت با نام دانشگاه/تاریخ/تعداد ردیف
 *   • ستون‌های لهشده و شکسته     → جهت افقی برای جدولهای عریض + `<colgroup>`
 *   • تکرار نشدن سرستونها       → `thead { display: table-header-group }`
 *   • اعداد لاتین بیتفکیک       → `faNum` + `formatReportCell`
 *   • شمارهٔ صفحهٔ ثابت «۱»     → حذف شد (مرورگر خودش شماره میزند)
 *
 * تمام قالببندی مخصوص کاغذ در `globals.css` (بلوک `#report-print-root`)
 * نوشته شده تا در باندل کلاینت کلاسهای `print:...` ناشناخته
 * (مثل `print:p-6mm`) تولید نشود.
 */

type ReportColumn = { key: string; title: string; format?: string };

/** وزن نسبی پهنای ستونها؛ ستونهای متنی عریضتر، اعداد/تاریخ باریکتر. */
function columnWeights(columns: ReportColumn[]): number[] {
  const weight = (c: ReportColumn): number => {
    if (c.format === 'DATE' || c.format === 'DATETIME') return 1.0;
    if (c.format === 'NUMBER') return 0.95;
    if (c.format === 'MONEY') return 1.4;
    // عناوین بلند متنی (نام، رشته، دانشکده، شرح…) جای بیشتری میخواهند
    if (/نام|رشته|دانشکده|عنوان|شرح|توضیح|آدرس|درس|استاد/.test(c.title)) return 1.9;
    return 1.25;
  };
  const raw = columns.map(weight);
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map(w => (w / total) * 100);
}

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
  /** زیرعنوان (فیلترهای اعمالشده) */
  subtitle: string;
  /** ستونها (همان ReportColumn[]) */
  columns: ReportColumn[];
  /** ردیفها (همان ReportResult.rows[]) */
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
  const orientation: ReportPrintOrientation = columns.length >= 7 ? 'landscape' : 'portrait';
  const widths = useMemo(() => columnWeights(columns), [columns]);

  // مسیر پشتیبان: Ctrl+P / چاپ از منوی مرورگر هم همان سند ایزوله را بگیرد
  useEffect(() => {
    const before = () => prepareReportPrint(orientation);
    const after = () => cleanupReportPrint();
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      cleanupReportPrint();
    };
  }, [orientation]);

  return (
    <>
      <button
        type="button"
        onClick={() => printReportDocument(orientation)}
        title="چاپ / ذخیرهٔ PDF — فقط جدول گزارش، بدون منو و سربرگ مرورگر"
        className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white font-bold rounded print:hidden"
      >
        🖨️ چاپ گزارش
      </button>

      {/* الگوی چاپی: روی صفحه پنهان است؛ هنگام چاپ کلون شده به ریشهٔ body میرود.
          از تگهای header/footer/nav/button عمداً استفاده نشده چون قواعد
          سراسری `@media print` آنها را `display:none` میکنند. */}
      <div className="report-print-template" aria-hidden="true">
        <div className="rp-doc">
          <div className="rp-head">
            <div className="rp-brand">🏛️ {universityTitle || 'سامانه جامع آفاق'}</div>
            <div className="rp-title">{title}</div>
            {subtitle && <div className="rp-sub">{subtitle}</div>}
            <div className="rp-meta">
              <span>تاریخ تهیهٔ گزارش: {faDate}</span>
              <span>تعداد ردیفها: {faNum(rows.length)}</span>
            </div>
          </div>

          <table className="rp-table">
            <colgroup>
              {columns.map((c, i) => (
                <col key={c.key} style={{ width: `${widths[i].toFixed(2)}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {columns.map(c => <th key={c.key} scope="col">{c.title}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map(c => {
                    const formatted = fmtCell(row[c.key], c.format);
                    // ستونهای بدون format (کد دانشجو، شماره فیش، …) هم ارقام
                    // فارسی بگیرند؛ ستونهای DATE/MONEY/NUMBER قبلتر قالب خوردهاند.
                    const text = c.format ? formatted : faNum(formatted);
                    const isNumeric = /^[\d\u06F0-\u06F9,.،\s—-]+$/.test(text);
                    return (
                      <td key={c.key} dir="auto" className={isNumeric ? 'rp-num' : undefined}>
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {summary && <div className="rp-summary">{summary}</div>}

          <div className="rp-signs">
            <div className="rp-sign">تهیهکنندهٔ گزارش</div>
            <div className="rp-sign">تأیید حسابدار</div>
            <div className="rp-sign">مدیر مالی</div>
          </div>
        </div>
      </div>
    </>
  );
}
