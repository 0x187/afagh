/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیت «فیلتر قبل از اجرا» + «چاپ ایزولهٔ گزارشها»
 *
 *  دو خطایی که کاربر در مرکز گزارشهای مالی گزارش داد:
 *   ۱) به محض کلیک روی کارتِ گزارش (و حتی ورود با ?kind=) صفحه بدون اجازه
 *      شروع به لود میکرد و اجازه نمیداد فیلترها اول تعریف شوند.
 *   ۲) خروجی چاپ: نوار تاریک کنار کاغذ، تاریخ/URL/«۱/۲» مرورگر، ستونهای
 *      لهشده، سربرگ ناموجود و اعداد لاتین بیتفکیک.
 *
 *  این تست قراردادهای سورس را قفل میکند تا دوباره برنگردند.
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
const read = (rel: string): string => readFileSync(path.join(ROOT, 'src', rel), 'utf8');

const client = read('app/admin/reports/ReportsClient.tsx');
const printComp = read('components/ui/ReportPrint.tsx');
const printLib = read('lib/print-report.ts');
const globals = read('app/globals.css');

/** توضیحات کد نباید مثبت کاذب بسازند (مثلاً داخل کامنت به باگ قدیمی اشاره شده) */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const clientCode = stripComments(client);
const printCompCode = stripComments(printComp);
const printLibCode = stripComments(printLib);

console.log('\n— ۱) کلیک روی کارت فقط «انتخاب» است، اجرا صریح است —');
const pickBody = /const pick = \(k: string\) => \{[\s\S]*?\n  \};/.exec(client)?.[0] ?? '';
ok(pickBody.length > 0, 'تابع pick وجود دارد');
ok(!/run\(/.test(pickBody), 'pick هیچ اجرای گزارشهای را فراخوانی نمیکند');
ok(!/void run\(1, k\)/.test(clientCode), 'کلیک روی کارت دیگر void run(1, k) ندارد');
ok(!/autoRan/.test(clientCode), 'اجرای خودکار (autoRan) حذف شده است');
ok(!/void run\(1, initialKind\)/.test(clientCode), 'اجرای خودکار با ?kind= حذف شده است');
ok(!/useRef/.test(clientCode), 'useRef بلااستفاده از ایمپورتها حذف شده است');
ok(/onClick=\{\(\) => run\(1\)\}/.test(client), 'دکمهٔ صریح «اجرای گزارش» همچنان هست');
ok(/فیلترهای بالا/.test(client), 'راهنمای «اول فیلترها، بعد اجرا» در حالت خالی دیده میشود');

console.log('\n— ۲) چاپ: سند ایزوله، نه overlay ثابت —');
ok(!/window\.print\(\)/.test(client), 'ReportsClient مستقیماً window.print نمیزند');
ok((client.match(/<ReportPrint/g) ?? []).length === 1, 'فقط یک دکمه/کامپوننت چاپ رندر میشود (تکراری حذف شد)');
ok(/printReportDocument\(orientation\)/.test(printComp), 'دکمهٔ چاپ از printReportDocument استفاده میکند');
ok(/from '@\/lib\/print-report'/.test(printComp), 'ReportPrint به ماژول ایزولهٔ چاپ وصل است');
ok(!/report-print-overlay/.test(printCompCode), 'overlay قدیمی position:fixed حذف شده است');
ok(!/print:p-6mm|print:mb-6mm/.test(printCompCode), 'کلاسهای نامعتبر Tailwind (print:p-6mm) حذف شدهاند');
ok(!/صفحه:\s*<span/.test(printComp), 'شمارهٔ صفحهٔ ثابت و دروغین «۱» حذف شده است');

console.log('\n— ۳) چاپ: حاشیهٔ صفر و ایزولاسیون بدنه —');
ok(/@page \{ size: \$\{size\}; margin: 0; \}/.test(printLib), '`@page` در سطح بالا با margin:0 تزریق میشود (حذف سربرگ مرورگر)');
ok(/document\.body\.classList\.add\('printing-report'\)/.test(printLib), 'کلاس printing-report روی body گذاشته میشود');
ok(/holder\.id = ROOT_ID/.test(printLibCode) && /ROOT_ID = 'report-print-root'/.test(printLibCode), 'کپی سند در ریشهٔ body ساخته میشود');
ok(/prepareReportPrint\(orientation\)/.test(printComp), 'مسیر پشتیبان beforeprint (Ctrl+P) وصل است');
ok(/body\.printing-report > \*:not\(#report-print-root\) \{ display: none !important; \}/.test(globals),
  'همهٔ فرزندان body جز سند چاپی پنهان میشوند (نوار تاریک حذف شود)');
ok(/box-decoration-break: clone;/.test(globals), 'حاشیهٔ داخلی در هر صفحهٔ چاپ تکرار میشود');

console.log('\n— ۴) چاپ: جدول خوانا —');
ok(/<colgroup>/.test(printComp) && /style=\{\{ width:/.test(printComp), 'پهنای ستونها با colgroup تثبیت شده است');
ok(/columns\.length >= 7 \? 'landscape' : 'portrait'/.test(printComp), 'گزارشهای عریض بهصورت افقی چاپ میشوند');
ok(/display: table-header-group;/.test(globals), 'سرستون جدول در همهٔ صفحات تکرار میشود');
ok(/table-layout: fixed !important;/.test(globals), 'جدول چاپی table-fixed است');
ok(/break-inside: avoid; page-break-inside: avoid;/.test(globals), 'ردیفها بین صفحات نصف نمیشوند');
ok(/overflow-wrap: anywhere;/.test(globals), 'متنهای فارسی بلند داخل سلول میشکنند');
ok(/c\.format \? formatted : faNum\(formatted\)/.test(printComp), 'اعداد ستونهای بدون format هم فارسی میشوند');
ok(/fmtCell\(row\[c\.key\], c\.format\)/.test(printComp), 'قالببندی تاریخ/مبلغ/عدد با منبع واحد report-format است');
ok(/rp-head/.test(printComp) && /rp-title/.test(printComp), 'سربرگ سند (نام دانشگاه + عنوان) وجود دارد');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
