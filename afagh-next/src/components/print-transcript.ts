'use client';

/**
 * منطق مشترک چاپ اسناد رسمی (کارنامهٔ تحصیلی و کارنامهٔ مالی).
 *
 * چرا این‌گونه؟ صفحهٔ اپ (منو/هدر/کارت‌ها) اگر در جریان چاپ بماند، صفحه‌های خالی
 * و بریدگی جدول‌ها می‌سازد. پس یک کپی از خودِ سند (`.transcript-print-area`) در
 * ریشهٔ body گذاشته می‌شود و هنگام چاپ فقط همان ریشه دیده می‌شود؛ سربرگ/پاصفحه
 * و اندازهٔ کاغذ هم فقط برای همین چاپ تزریق و پس از چاپ برداشته می‌شوند.
 *
 * این تابع قبلاً داخل StudentsManagerClient بود؛ حالا منبع واحد است و کارنامهٔ
 * مالی هم دقیقاً همان رفتار را دارد تا در چاپ به‌هم نریزد.
 */
export function doPrintTranscript(orientation: 'landscape' | 'portrait' = 'landscape'): void {
  if (typeof document === 'undefined') return;
  const src = document.querySelector('.transcript-print-area');
  const holder = document.createElement('div');
  holder.id = 'transcript-print-root';
  if (src) holder.appendChild(src.cloneNode(true));
  document.body.appendChild(holder);
  document.body.classList.add('printing-transcript');
  if (orientation === 'portrait') document.body.classList.add('printing-portrait');
  const pageStyle = document.createElement('style');
  pageStyle.id = 'transcript-page-size';
  // حاشیهٔ عمودی عمداً کم است تا فضای کاغذ به جدول برسد (پاصفحهٔ شمارهٔ صفحه ~۵mm می‌خواهد)
  const margins = orientation === 'portrait' ? '8mm 7mm 11mm 7mm' : '8mm 10mm 13mm 10mm';
  const size = orientation === 'portrait' ? 'A4 portrait' : 'A4 landscape';
  /**
   * ⚠ `@page` باید در سطحِ بالا باشد، نه داخلِ `@media print`.
   * قاعدهٔ گروهی (`@page` داخل `@media`) از نظر مشخصات CSS نامعتبر است و
   * مرورگر بی‌صدا نادیده‌اش می‌گرفت؛ نتیجه این بود که چاپ با اندازه و حاشیهٔ
   * پیش‌فرضِ مرورگر انجام می‌شد و سند به‌هم می‌ریخت.
   */
  pageStyle.textContent =
    `@page { size: ${size}; margin: ${margins}; }`;
  document.head.appendChild(pageStyle);
  const done = () => {
    document.body.classList.remove('printing-transcript', 'printing-portrait');
    pageStyle.remove();
    holder.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  // fallback اگر afterprint نیامد (بستن دستی دیالوگ)
  setTimeout(done, 3000);
}
