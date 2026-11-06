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
 * میکند؛ با حاشیهٔ صفر دیگر جایی برای تاریخ/URL/شماره صفحه نیست.
 *
 * چون سربرگ/پاصفحهٔ مرورگر حذف شده، **خودمان** شمارهٔ برگه میزنیم:
 * `paginateReportPrint()` سند را پس از اندازهگیری واقعی ارتفاع ردیفها به
 * برگههای A4 تقسیم میکند و در پاصفحهٔ هر برگه «صفحۀ N از M» و جایگاه امضاها
 * را مینویسد. شمارهٔ وب (`res.page / res.totalPages`) که همیشه «۱ از ۱»
 * بود، دیگر به خروجی چاپی راه ندارد.
 */

export type ReportPrintOrientation = 'portrait' | 'landscape';

const ROOT_ID = 'report-print-root';
const STYLE_ID = 'report-print-page-style';
const TEMPLATE_SELECTOR = '.report-print-template';

/** ۱ میلیمتر در CSS = 96/25.4 پیکسل (مبنای getBoundingClientRect) */
const PX_PER_MM = 96 / 25.4;

/** ابعاد کاغذ و فضای رزروشدهٔ پاصفحه (امضا + شمارهٔ برگه)، بر حسب mm */
const PAPER: Record<ReportPrintOrientation, { w: number; h: number; pad: number; foot: number }> = {
  landscape: { w: 297, h: 210, pad: 8, foot: 21 },
  portrait: { w: 210, h: 297, pad: 9, foot: 21 },
};

const faDigits = (v: number | string): string =>
  String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * صفحهبندی سند چاپی.
 *
 * اندازهگیری در **همان چیدمانی** انجام میشود که چاپ میشود: قواعد
 * `#report-print-root …` در `globals.css` عمداً بیرون از `@media print`
 * نوشته شدهاند تا ریشهٔ خارج از دید (اما لایهبندیشده) ابعاد واقعی بدهد.
 * بنابراین ردیفهایی که متن بلند دارند و پیچیدهاند، درست اندازه گرفته میشوند
 * و هیچ ردیفی وسط برگه نصف نمیشود.
 */
function paginateReportPrint(root: HTMLElement, orientation: ReportPrintOrientation): void {
  const doc = root.querySelector<HTMLElement>('[data-rp-doc]');
  const head = doc?.querySelector<HTMLElement>('[data-rp-head]');
  const table = doc?.querySelector<HTMLTableElement>('[data-rp-table]');
  const tbody = doc?.querySelector<HTMLTableSectionElement>('[data-rp-tbody]');
  if (!doc || !head || !table || !tbody) return;

  const summary = doc.querySelector<HTMLElement>('[data-rp-summary]');
  const foot = doc.querySelector<HTMLElement>('[data-rp-foot]');
  const rows = Array.from(tbody.rows);
  const dim = PAPER[orientation];

  // ── ۱) پروب اندازهگیری: همان سربرگ + همان جدول با همهٔ ردیفها، بیرون از دید
  const probe = document.createElement('div');
  probe.className = 'rp-page rp-probe';
  const probeBody = document.createElement('div');
  probeBody.className = 'rp-page-body';
  const probeHead = head.cloneNode(true) as HTMLElement;
  const probeTable = table.cloneNode(true) as HTMLTableElement;
  probeBody.appendChild(probeHead);
  probeBody.appendChild(probeTable);
  const probeSummary = summary?.cloneNode(true) as HTMLElement | undefined;
  if (probeSummary) probeBody.appendChild(probeSummary);
  probe.appendChild(probeBody);
  root.appendChild(probe);

  // force layout
  void probe.offsetHeight;
  const fixedH =
    probeHead.getBoundingClientRect().height +
    (probeTable.tHead?.getBoundingClientRect().height ?? 0);
  const rowHeights = Array.from(probeTable.tBodies[0]?.rows ?? []).map(r => r.getBoundingClientRect().height);
  const summaryH = probeSummary ? probeSummary.getBoundingClientRect().height : 0;

  // ── ۲) تقسیم ردیفها بر اساس ارتفاع قابلاستفادهٔ هر برگه
  const maxBody = (dim.h - 2 * dim.pad - dim.foot - 2) * PX_PER_MM;
  const avail = Math.max(24, maxBody - fixedH);
  const chunks: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  rowHeights.forEach((rh, i) => {
    const h = Math.max(rh, 1);
    if (cur.length && used + h > avail) {
      chunks.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(i);
    used += h;
  });
  if (cur.length || chunks.length === 0) chunks.push(cur);

  // خلاصهٔ گزارش حتماً در برگهٔ آخر جا بگیرد (ردیفها به برگهٔ جدید منتقل شوند)
  if (summaryH > 0) {
    const last = chunks[chunks.length - 1];
    let h = last.reduce((a, i) => a + Math.max(rowHeights[i] ?? 0, 1), 0);
    const moved: number[] = [];
    while (last.length > 1 && h + summaryH > avail) {
      const i = last.pop() as number;
      h -= Math.max(rowHeights[i] ?? 0, 1);
      moved.unshift(i);
    }
    if (moved.length) chunks.push(moved);
  }

  // ── ۳) ساخت برگهها: سربرگ تکراری، سرستون تکراری، امضا و شماره در هر برگه
  const total = chunks.length;
  doc.textContent = '';
  chunks.forEach((chunk, idx) => {
    const page = document.createElement('div');
    page.className = idx === total - 1 ? 'rp-page rp-page-last' : 'rp-page';

    const body = document.createElement('div');
    body.className = 'rp-page-body';
    const h = head.cloneNode(true) as HTMLElement;
    if (idx > 0) h.classList.add('rp-head-repeat'); // سربرگ فشرده در برگههای ادامه
    body.appendChild(h);

    const t = table.cloneNode(true) as HTMLTableElement;
    const tb = t.tBodies[0];
    if (tb) {
      tb.textContent = '';
      chunk.forEach(i => {
        if (rows[i]) tb.appendChild(rows[i].cloneNode(true));
      });
    }
    body.appendChild(t);
    if (idx === total - 1 && summary) body.appendChild(summary.cloneNode(true));
    page.appendChild(body);

    if (foot) {
      const f = foot.cloneNode(true) as HTMLElement;
      const num = f.querySelector('[data-rp-pageno]');
      if (num) num.textContent = `صفحۀ ${faDigits(idx + 1)} از ${faDigits(total)}`;
      page.appendChild(f);
    }
    doc.appendChild(page);
  });
  probe.remove();
}

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
  holder.dataset.rpOrientation = orientation;
  holder.appendChild(src.cloneNode(true));
  document.body.appendChild(holder);
  document.body.classList.add('printing-report');

  const pageStyle = document.createElement('style');
  pageStyle.id = STYLE_ID;
  const size = orientation === 'portrait' ? 'A4 portrait' : 'A4 landscape';
  // ⚠ `@page` باید در سطح بالا باشد، نه داخل `@media print`.
  pageStyle.textContent = `@page { size: ${size}; margin: 0; }`;
  document.head.appendChild(pageStyle);

  paginateReportPrint(holder, orientation);
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
 * رویداد `beforeprint` را نفرستاد، سند ایزوله و صفحهبندی شده باشد.
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
