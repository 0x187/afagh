/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیت «نسخهٔ دوم چاپ گزارشها» + «چندترمها» + «امضاکنندگان پیکربندیپذیر»
 *
 *  بازخورد کاربر بعد از اصلاح نخست (PDFـهای ۵۶ صفحهای):
 *   ۱) بهجای 🏛️، آرم واقعی دانشگاه + نام دانشگاه در سربرگ بیاید.
 *   ۲) تاریخ تهیۀ报告 به سمت چپ منتقل شود.
 *   ۳) «صفحۀ ۱ از ۱» وب، در سند ۵۶ صفحهای دروغین بود → شمارهگذاری
 *      واقعی برگهها «صفحۀ N از M» زیر هر برگه.
 *   ۴) جایگاه امضا زیر برگهها مشخص نبود → پاصفحۀ تکرارشونده با امضاها.
 *   ۵) فیلتر ترم فقط یک ترم میگرفت → «چند ترم» و «همهٔ ترمها».
 *   ۶) شماره فیش/حساب بلند به ستون تاریخ سرریز میکرد → nowrap حذف شد.
 *   ۷) عناوین امضاکنندگان نباید هاردکد باشند → تنظیمات سامانه، به تفکیک فرم.
 *
 *  قراردادهای سورس قفل میشوند تا دوباره برنگردند.
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
const actions = read('app/admin/reports/actions.ts');
const helpers = read('app/admin/reports/report-helpers.ts');
const settings = read('lib/settings.ts');
const brandLib = read('lib/report-print-brand.ts');
const financePage = read('app/admin/finance/reports/page.tsx');
const eduPage = read('app/admin/reports/page.tsx');
const savedPage = read('app/admin/reports/saved/page.tsx');
const savedClient = read('app/admin/reports/saved/SavedReportsClient.tsx');
const builderPage = read('app/admin/reports/builder/page.tsx');
const builderClient = read('app/admin/reports/builder/BuilderClient.tsx');

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const clientCode = stripComments(client);
const printCompCode = stripComments(printComp);
const printLibCode = stripComments(printLib);

console.log('\n— ۱) سربرگ: آرم و نام دانشگاه، تاریخ در چپ —');
ok(/universityLogoUrl/.test(printComp) && /rp-logo/.test(printComp), 'آرم دانشگاه در سربرگ چاپ رندر میشود');
ok(/universityTitle \|\| 'سامانه جامع آفاق'/.test(printComp), 'نام دانشگاه در سربرگ چاپ رندر میشود');
ok(/universityTitle=\{opts\.universityTitle\}/.test(client), 'نام دانشگاه از سرور به کامپوننت چاپ میرسد');
ok(/universityLogoUrl=\{opts\.universityLogoUrl\}/.test(client), 'آرم دانشگاه از سرور به کامپوننت چاپ میرسد');
ok(/getSetting\('UNIVERSITY_LOGO'\)/.test(brandLib), 'ارم سراسری تنظیمات بهعنوان پشتیبان خوانده میشود');
ok(/"logoUrl" FROM universities/.test(brandLib), 'ارم اختصاصی دانشگاه از پروفایل دانشگاه خوانده میشود');
ok(/universityLogoUrl: uniRow\?\.logoUrl\?\.trim\(\) \|\| globalLogo\.trim\(\)/.test(brandLib),
  'اولویت: آرم دانشگاه ← آرم سراسری تنظیمات');
ok(/getReportPrintBrand\(signerForm/.test(actions), 'مراکز گزارش از همان منبع واحد هویت چاپی استفاده میکنند');
const meta = /<div className="rp-meta">[\s\S]*?<\/div>/.exec(printCompCode)?.[0] ?? '';
ok(/تعداد ردیفها/.test(meta) && /تاریخ تهیۀ گزارش/.test(meta), 'ردیف متا دو قلم دارد');
ok(meta.indexOf('تعداد ردیفها') < meta.indexOf('تاریخ تهیۀ گزارش'),
  'در RTL، تاریخ دومین فرزند است ⇒ سمت چپ قرار میگیرد');

console.log('\n— ۲) شمارهگذاری واقعی برگهها (نه «صفحۀ ۱ از ۱» وب) —');
ok(!/صفحهٔ \$\{faNum\(res\.page\)\}/.test(clientCode), 'شمارهٔ صفحهٔ وب دیگر وارد زیرعنوان چاپ نمیشود');
ok(/`\$\{faNum\(res\.total\)\} رکورد`/.test(clientCode), 'زیرعنوان چاپ تعداد کل رکوردها را نشان میدهد');
ok(/function paginateReportPrint\(/.test(printLib), 'تابع صفحهبندی سند چاپی وجود دارد');
ok(/صفحۀ \$\{faDigits\(idx \+ 1\)\} از \$\{faDigits\(total\)\}/.test(printLibCode),
  'هر برگه «صفحۀ N از M» فارسی میگیرد');
ok(/probe\.className = 'rp-page rp-probe'/.test(printLibCode), 'ارتفاع ردیفها پیش از تقسیم اندازهگیری میشود');
ok(/getBoundingClientRect\(\)\.height/.test(printLibCode), 'اندازهگیری بر اساس ارتفاع واقعی DOM است');
ok(/break-after: page|page-break-after: always/.test(globals), 'هر برگه شکست صفحه دارد');
ok(/data-rp-pageno/.test(printComp) && /rp-page-num/.test(globals), 'پاصفحۀ شمارهٔ برگه وجود دارد');

console.log('\n— ۳) جایگاه امضا زیر برگهها، قابلتنظیم از تنظیمات —');
ok(/rp-page-foot/.test(globals) && /data-rp-foot/.test(printComp), 'پاصفحۀ تکرارشونده در سند چاپی هست');
ok(/signLabels\.map/.test(printCompCode), 'برچسبهای امضا رندر میشوند (نه هاردکد سهتایی)');
ok(/signers=\{opts\.signers\}/.test(client), 'برچسبهای امضا از تنظیمات به چاپ میرسند');
ok(/SIGNERS_FINANCE_REPORTS/.test(settings) && /SIGNERS_EDU_REPORTS/.test(settings),
  'تنظیمات جداگانه برای فرمهای مالی و آموزشی تعریف شده است');
ok(/export async function getFormSigners\(form: string\)/.test(settings),
  'هلپر خواندن امضاکنندگان به تفکیک فرم وجود دارد');
ok(/signerForm: 'finance-report'/.test(financePage) && /signerForm: 'edu-report'/.test(eduPage),
  'هر مرکز گزارش، فرم امضای خودش را به سرور میدهد');
ok(/امضاکنندگان فرمها و اسناد/.test(settings), 'گروه تنظیمات امضاکنندگان در پنل مدیر دیده میشود');

console.log('\n— ۴) اعداد بلند دیگر به ستون تاریخ سرریز نمیکنند —');
const numRule = /#report-print-root table\.rp-table td\.rp-num \{[\s\S]*?\}/.exec(globals)?.[0] ?? '';
ok(!/white-space:\s*nowrap/.test(numRule), 'قاعدهٔ nowrap قدیمی روی سلولهای عددی حذف شده است');
ok(/overflow-wrap: anywhere/.test(numRule), 'سلول عددی اجازهٔ شکستن دارد');
ok(/td\.rp-longnum \{ word-break: break-all; \}/.test(globals), 'ارقام خیلی بلند شکسته میشوند');
ok(/rp-longnum/.test(printComp), 'کامپوننت چاپ ارقام بلند را علامتگذاری میکند');
ok(/شماره\|فیش\|حساب\|پیگیری\|سند\|شناسه\|کد\|شبا/.test(printComp),
  'ستونهای شناسه/فیش وزن عرض بیشتری میگیرند');

console.log('\n— ۵) فیلتر ترم: یک / چند / همه —');
ok(/useState<'one' \| 'many' \| 'all'>/.test(client), 'فیلتر ترم سه حالت دارد');
ok(/<option value="all">همهٔ ترمها<\/option>/.test(client), 'گزینهٔ «همهٔ ترمها» در UI هست');
ok(/<option value="many">چند ترم…<\/option>/.test(client), 'گزینهٔ «چند ترم» در UI هست');
ok(/manyTerms/.test(client) && /type="checkbox"/.test(client), 'چند ترم با چکباکس انتخاب میشوند');
ok(/termMode === 'all' \? '' :/.test(clientCode), 'همهٔ ترمها = فیلتر ترم خالی (بدون فیلتر SQL)');
ok(/terms: multiTerms/.test(clientCode), 'فهرست ترمها به سرور فرستاده میشود');
ok(/terms\?: string/.test(helpers), 'ReportFilters فیلد terms را میشناسد');
ok(/function parseTermList\(/.test(actions) && /runReportMultiTerm\(/.test(actions),
  'سرور فهرست ترمها را جدا اجرا و ادغام میکند');
ok(/__term/.test(actions), 'نتیجهٔ چندترمهای ستون «ترم» دارد');
ok(/terms: undefined/.test(actions), 'اجرای درونی هر ترم از بازگشت به حالت چندترمهای جلوگیری میکند');

console.log('\n— ۶) گزارشساز و گزارشهای ذخیرهشده هم همان موتور چاپ را دارند —');
ok(/SIGNERS_CUSTOM_REPORTS/.test(settings) && /'custom-report': 'SIGNERS_CUSTOM_REPORTS'/.test(settings),
  'امضاکنندگان ویژهٔ گزارشهای ساختهای در تنظیمات تعریف شده است');
ok(/getReportPrintBrand\('custom-report'/.test(savedPage) && /getReportPrintBrand\('custom-report'/.test(builderPage),
  'هر دو صفحهٔ گزارشساز و ذخیرهشده هویت چاپی را از سرور میگیرند');
ok(/brand=\{brand\}/.test(savedPage) && /brand=\{brand\}/.test(builderPage),
  'هویت چاپی به کلاینتها پاس داده میشود');
ok(/import ReportPrint from '@\/components\/ui\/ReportPrint'/.test(savedClient)
  && /import ReportPrint from '@\/components\/ui\/ReportPrint'/.test(builderClient),
  'هر دو کلاینت از همان کامپوننت ایزولهٔ چاپ استفاده میکنند');
ok(/<ReportPrint/.test(savedClient) && /<ReportPrint/.test(builderClient),
  'دکمهٔ چاپ در نتیجهٔ اجرا و پیشنمایش رندر میشود');
ok(/signers=\{brand\.signers\}/.test(savedClient) && /signers=\{brand\.signers\}/.test(builderClient),
  'امضاهای قابلتنظیم به چاپ گزارشهای ساختهای هم میرسند');
ok(/universityLogoUrl=\{brand\.universityLogoUrl\}/.test(savedClient)
  && /universityLogoUrl=\{brand\.universityLogoUrl\}/.test(builderClient),
  'آرم دانشگاه به چاپ گزارشهای ساختهای هم میرسد');
ok(!/صفحهٔ \$\{faNum\(result\.page\)\}/.test(savedClient) && !/صفحهٔ \$\{faNum\(preview\.page\)\}/.test(builderClient),
  'شمارهٔ صفحهٔ وب وارد زیرعنوان چاپ نمیشود');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
