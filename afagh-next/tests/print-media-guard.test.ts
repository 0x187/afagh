/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیت «رسانهٔ چاپ» — قاعدهٔ موبایل نباید در چاپ اجرا شود
 *
 *  چرا این تست وجود دارد:
 *    لایهٔ موبایل (`src/styles/mobile-tables.css`) جدول‌های دارای کلاس `rt` را
 *    در عرض‌های کم به «کارتِ عمودی» تبدیل می‌کند:
 *        table.rt        { display: block }
 *        table.rt tbody  { display: block }
 *        table.rt tr     { display: block }
 *        table.rt td     { display: flex }
 *    این قاعده با `@media (max-width: 768px)` نوشته شده بود. اما عرضِ کاغذِ
 *    A4 عمودی پس از کسرِ حاشیه‌ها ≈ ۷۴۱px است — که **کمتر از ۷۶۸px** می‌شود.
 *    یعنی هنگام چاپ هم قاعده اجرا می‌شد و:
 *      • ساختارِ جدول (thead/tbody/tr/td) از بین می‌رفت،
 *      • ستون‌ها زیرِ هم تا می‌خوردند (سند ~۷۲mm عرض به‌جای ~۱۸۰mm)،
 *      • سند چند برابر بلندتر می‌شد (۱۲ صفحه به‌جای ۳) و از کاغذ بیرون می‌زد.
 *
 *    این تست سه چیز را قفل می‌کند:
 *      ۱) هیچ قاعدهٔ «وابسته به عرض» در CSS سراسری نباید بدونِ `screen` باشد،
 *      ۲) فایلِ موبایل باید تماماً `screen and (...)` باشد،
 *      ۳) بلوکِ چاپ باید ساختارِ جدول را به حالتِ استاندارد برگرداند (دفاع).
 * ════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};

const mobileCss = readFileSync(path.join(ROOT, 'src', 'styles', 'mobile-tables.css'), 'utf8');
const globalsCss = readFileSync(path.join(ROOT, 'src', 'app', 'globals.css'), 'utf8');
const printTs = readFileSync(path.join(ROOT, 'src', 'components', 'print-transcript.ts'), 'utf8');

// ── ۱) لایهٔ موبایل: هیچ media queryِ وابسته به عرض بدونِ `screen` نباشد ──
// نکته: کامنت‌های CSS در اسکن نادیده گرفته می‌شوند (خودِ توضیحِ قاعده شامل
// نمونهٔ متنیِ «@media (max-width: …)» است و نباید مثبت کاذب بدهد).
const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const mobileCssNoComments = stripCssComments(mobileCss);
const globalsCssNoComments = stripCssComments(globalsCss);

const bareWidthMedia = [
  ...mobileCssNoComments.matchAll(/@media\s*\(\s*max-width\s*:/g),
];
ok(
  bareWidthMedia.length === 0,
  `mobile-tables.css: هیچ «@media (max-width: …)» بدونِ screen نماند (${bareWidthMedia.length} مورد)`
);
ok(
  (mobileCss.match(/@media screen and \(max-width: 768px\)/g) ?? []).length >= 6,
  'mobile-tables.css: بلوک‌های موبایل با «@media screen and (max-width: 768px)» محدود شده‌اند'
);

// ── ۲) globals.css: قاعده‌های وابسته به عرض که چاپ را تحت تأثیر می‌گذارند ──
for (const needle of ['@media (max-width: 768px) {', '@media (max-width: 640px) {']) {
  ok(!globalsCssNoComments.includes(needle), `globals.css: «${needle}» بدونِ screen وجود ندارد`);
}
ok(
  globalsCss.includes('@media screen and (max-width: 768px) {')
  && globalsCss.includes('@media screen and (max-width: 640px) {'),
  'globals.css: قاعده‌های ۷۶۸px/۶۴۰px به screen محدود شده‌اند'
);

// ── ۳) دفاعِ چاپ: ساختارِ جدول در چاپ باید به حالتِ استاندارد برگردد ──
ok(
  /\.transcript-print-area table\.rt[\s\S]*?\{\s*display:\s*revert\s*!important;/.test(globalsCss),
  'globals.css: قاعدهٔ چاپ «.transcript-print-area table.rt { display: revert }» وجود دارد'
);
ok(
  /\.transcript-print-area table\.rt th,\s*\n\s*\.transcript-print-area table\.rt td \{ display: table-cell !important; \}/.test(globalsCss),
  'globals.css: سلول‌های جدول در چاپ «table-cell» می‌شوند (نه flex)'
);
ok(
  /\.transcript-print-area table\.rt td::before \{ content: none !important; \}/.test(globalsCss),
  'globals.css: برچسب‌های تزریقیِ موبایل (data-label) در چاپ حذف می‌شوند'
);
ok(
  /\.transcript-print-area table\.rt tr \{ display: table-row !important; \}/.test(globalsCss),
  'globals.css: ردیف‌های جدول در چاپ «table-row» می‌شوند'
);

// ── ۴) چاپ هر دو جهت را پوشش دهد و «@page» در سطحِ بالا بماند ──
ok(
  printTs.includes("'A4 portrait'") && printTs.includes("'A4 landscape'"),
  'print-transcript.ts: هر دو جهتِ A4 (landscape/portrait) تعریف شده‌اند'
);
ok(
  /`@page \{ size: \$\{size\}; margin: \$\{margins\}; \}`/.test(printTs),
  'print-transcript.ts: قاعدهٔ «@page» در سطحِ بالا تزریق می‌شود (نه داخلِ @media print)'
);
ok(
  /printing-portrait/.test(printTs),
  'print-transcript.ts: کلاسِ «printing-portrait» برای تفکیکِ چیدمانِ عمودی اعمال می‌شود'
);

// ── ۵) چیدمانِ تککارتهٔ کارنامهٔ مالی (مدل کارتی) در چاپ قفل بماند ──
// جدول ریز دروس اکنون ۸ ستون دارد و سربرگ ترم چهار قلم است؛ دو کارتِ
// ~۹۶mm در A4 عمودی خوانا نیست. هم JSX و هم قاعدهٔ چاپ تکستونهاند.
ok(
  /\.tr-fin-root \.tr-fin-row \{ grid-template-columns: minmax\(0, 1fr\) !important;/.test(globalsCssNoComments),
  'globals.css: گریدِ ترم‌های کارنامهٔ مالی در چاپ تکستونه است (یک کارت تمامعرض)'
);
ok(
  !/\.tr-fin-root \.tr-fin-row \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/.test(globalsCssNoComments),
  'globals.css: قاعدهٔ ۲ستونهٔ قدیمیِ گریدِ ترم‌ها حذف شده است'
);
ok(
  /\.tr-fin-root \.term-block \{ break-inside: avoid !important; page-break-inside: avoid !important; \}/.test(globalsCss),
  'globals.css: کارتِ ترم (term-block) در چاپ avoid است تا نصف نشود'
);
ok(
  /\.tr-fin-root \.term-block \{ break-inside: avoid !important/.test(globalsCss)
    && /\.tr-fin-root table\.tr-doc > tbody > tr\.tr-doc-row \{ break-inside: auto !important/.test(globalsCss),
  'globals.css: ردیفِ بیرونی auto است تا کارت‌ها در صفحه جریان بگیرند'
);

// ── ۶) آرمِ دانشگاه در مدل تخت (FinancialTranscriptFlat) باید در سربرگ باشد ──
const flatTsx = readFileSync(path.join(ROOT, 'src', 'components', 'FinancialTranscriptFlat.tsx'), 'utf8');
// آرم داخل نوارِ عنوان (قبل از «جمهوری اسلامی ایران»)
ok(
  /tr-fin-titlebar[\s\S]{0,600}?<img src=\{logoUrl\} alt="آرم دانشگاه"/.test(flatTsx),
  'FinancialTranscriptFlat: آرم داخل نوارِ عنوان (سربرگ) است'
);
ok(
  /tr-fin-titlebar[\s\S]{0,1200}?جمهوری اسلامی ایران/.test(flatTsx)
    && flatTsx.indexOf('alt="آرم دانشگاه"') < flatTsx.indexOf('جمهوری اسلامی ایران', flatTsx.indexOf('tr-fin-titlebar')),
  'FinancialTranscriptFlat: آرم بالای متنِ «جمهوری اسلامی ایران» می‌نشیند'
);
// و دیگر در ناحیهٔ ۴ (کنار عکس دانشجو) نباشد
const area4 = flatTsx.slice(flatTsx.indexOf('ناحیهٔ ۴'));
ok(
  !area4.includes('آرم دانشگاه'),
  'FinancialTranscriptFlat: آرم از ناحیهٔ ۴ (کنار عکس دانشجو) حذف شده است'
);

console.log(`\nprint-media-guard: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
