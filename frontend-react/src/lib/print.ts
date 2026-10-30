/**
 * منطق مشترک چاپ اسناد رسمی — پورت components/print-transcript.ts.
 *
 * یک کپی از سند (`.transcript-print-area`) در ریشهٔ body گذاشته و همهٔ اپ را
 * هنگام چاپ پنهان می‌کند تا صفحه‌های خالی و بریدگی جدول رخ ندهد؛ اندازهٔ کاغذ
 * هم فقط برای همین چاپ تزریق و پس از آن برداشته می‌شود.
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
  const margins = orientation === 'portrait' ? '8mm 7mm 11mm 7mm' : '8mm 10mm 13mm 10mm';
  const size = orientation === 'portrait' ? 'A4 portrait' : 'A4 landscape';
  pageStyle.textContent =
    `@media print { @page { size: ${size}; margin: ${margins};` +
    " @bottom-center { content: 'صفحه ' counter(page) ' از ' counter(pages); font-size: 8pt; color: #475569; font-family: \"Vazirmatn\", Tahoma, sans-serif; } } }";
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
