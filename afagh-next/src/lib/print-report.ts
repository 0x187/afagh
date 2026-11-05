'use client';

/**
 * چاپ ایزولهٔ گزارش‌ها (مرکز گزارش‌های مالی/آموزشی).
 *
 * چرا ایزوله؟ لایهٔ قدیمی (`position: fixed` overlay) داخل همان صفحه چاپ
 * میشد؛ نتیجه در پیشنمایش کروم: نوار تاریک کنار کاغذ، سربرگ/پاصفحهٔ مرورگر
 * (تاریخ، آدرس سایت، «۱/۲»)، ستون‌های لهشده و بیسرستان. این ماژول دقیقاً
 * همان الگوی اثباتشدهٔ `print-transcript.ts` را به کار میگیرد: یک کپی از سند
 * چاپی در **ریشهٔ body** گذاشته میشود و همهٔ فرزندان دیگر body پنهان میشوند.
 *
 * نکتهٔ کلیدی: `@page { margin: 0 }` در سطح بالا تزریق میشود (نه داخل
 * `@media print`). کروم سربرگ/پاصفحهٔ خود را فقط داخل حاشیهٔ `@page` رسم
 * میکند؛ با حاشیهٔ صفر دیگر جایی برای تاریخ/URL/شماره صفحه نیست. حاشیهٔ
 * واقعی کاغذ با `padding` روی ریشه و `box-decoration-break: clone` در هر
 * صفحه تکرار میشود (globals.css).
 */

export type ReportPrintOrientation = 'portrait' | 'landscape';

const ROOT_ID = 'report-print-root';
const STYLE_ID = 'report-print-page-style';
const TEMPLATE_SELECTOR = '.report-print-template';

/** آمادهسازی سند چاپی. چندبار فراخوانی شدنش بیخطر است (idempotent). */
export function prepareReportPrint(orientation: ReportPrintOrientation = 'landscape'): void {
  if (typeof document === 'undefined') return;
  const src = document.querySelector(TEMPLATE_SELECTOR);
  if (!src) return;

  // چاپ قبلی که دیالوگش بسته نشده / afterprint نیامده را پاک کن
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();

  const holder = document.createElement('div');
  holder.id = ROOT_ID;
  holder.appendChild(src.cloneNode(true));
  document.body.appendChild(holder);
  document.body.classList.add('printing-report');

  const pageStyle = document.createElement('style');
  pageStyle.id = STYLE_ID;
  const size = orientation === 'portrait' ? 'A4 portrait' : 'A4 landscape';
  // ⚠ `@page` باید در سطح بالا باشد، نه داخل `@media print`.
  pageStyle.textContent = `@page { size: ${size}; margin: 0; }`;
  document.head.appendChild(pageStyle);
}

/** پاکسازی بعد از چاپ. چندبار فراخوانی شدنش بیخطر است. */
export function cleanupReportPrint(): void {
  if (typeof document === 'undefined') return;
  document.body.classList.remove('printing-report');
  document.getElementById(STYLE_ID)?.remove();
  document.getElementById(ROOT_ID)?.remove();
}

/**
 * چاپ گزارش. `beforeprint` هم بهعنوان مسیر پشتیبان وصل است (مثلاً Ctrl+P)،
 * ولی اینجا صریحاً پیش از `window.print()` آماده میکنیم تا حتی اگر مرورگر
 * رویداد `beforeprint` را نفرستاد، سند ایزوله شده باشد.
 */
export function printReportDocument(orientation: ReportPrintOrientation = 'landscape'): void {
  if (typeof document === 'undefined') return;
  prepareReportPrint(orientation);
  const done = () => {
    cleanupReportPrint();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  // fallback اگر afterprint نیامد (بستن دستی دیالوگ / مرورگرهای قدیمی)
  setTimeout(done, 5000);
}
