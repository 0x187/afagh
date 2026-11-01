/**
 * Shared logic for printing official documents — port of components/print-transcript.ts.
 *
 * A copy of the document (`.transcript-print-area`) is placed at the root of body and the whole app is
 * hidden while printing so blank pages and clipped tables do not occur; the paper size
 * is also injected just for this print and removed afterwards.
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
  // Fallback if afterprint does not fire (manual dialog close)
  setTimeout(done, 3000);
}
