/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیت‌های UI/UX — نگهبان دستاوردهای بازبینی طراحی
 *
 *  چرا این تست وجود دارد:
 *    در بازبینی UI/UX چند نقص ریشه‌ای پیدا و رفع شد که هیچ گاردی نداشتند و
 *    به‌راحتی برمی‌گردند:
 *      ۱) کلاس‌های نامعتبرِ تیلویند ۳ (`shadow-xs`, `backdrop-blur-xs`,
 *         `blur-xs`) که بی‌صدا حذف می‌شدند ⇒ باید در tailwind.config توکن
 *         داشته باشند.
 *      ۲) `animate-in/fade-in/zoom-in-*` که به پلاگین نصب‌نشده وابسته بودند
 *         ⇒ باید در globals.css پیاده شده باشند.
 *      ۳) نبودِ `loading.tsx` در شاخه‌ها ⇒ ناوبری بی‌واکنش.
 *      ۴) اندازه‌های هاردکد `text-[10px]/text-[11px]` (۲٬۰۶۰ مورد) ⇒
 *         جایگزین با پله‌های `2xs/3xs`.
 *      ۵) `text-align: left` در کارت‌های موبایلِ RTL.
 *      ۶) نبودِ جایگزین برای `alert()`/`confirm()` بومی.
 *      ۷) نبودِ فوکوس مرئی و skip-link.
 *  هر مورد اینجا با خواندن فایل‌ها (بدون اجرای مرورگر) بررسی می‌شود.
 * ════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = path.join(ROOT, 'src');

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};

const read = (p: string) => readFileSync(p, 'utf8');
const globals = read(path.join(SRC, 'app', 'globals.css'));
const twConfig = read(path.join(ROOT, 'tailwind.config.ts'));
const rootLayout = read(path.join(SRC, 'app', 'layout.tsx'));
const mobileTables = read(path.join(SRC, 'styles', 'mobile-tables.css'));

/** همهٔ فایل‌های tsx زیر src (برای گشت‌های سبک) */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}
const tsxFiles = walk(SRC);

console.log('\n— توکن‌های تیلویند (کلاس‌های بی‌صدا) —');
ok(/boxShadow:\s*\{[^}]*xs:/.test(twConfig), 'توکن shadow-xs در tailwind.config تعریف شده است');
ok(/backdropBlur:\s*\{\s*xs:/.test(twConfig), 'توکن backdrop-blur-xs در tailwind.config تعریف شده است');
ok(/blur:\s*\{\s*xs:/.test(twConfig), 'توکن blur-xs در tailwind.config تعریف شده است');
ok(/fontSize:\s*\{[\s\S]*?'2xs':/.test(twConfig), 'پلهٔ متن 2xs (جانشین text-[11px]) تعریف شده است');
ok(/fontSize:\s*\{[\s\S]*?'3xs':/.test(twConfig), 'پلهٔ متن 3xs (جانشین text-[10px]) تعریف شده است');

console.log('\n— انیمیشن ورود (بدون پلاگین) —');
ok(/\.animate-in\s*\{/.test(globals), 'کلاس .animate-in در globals.css پیاده شده است');
ok(/@keyframes\s+ui-enter/.test(globals), 'keyframes ورود (ui-enter) وجود دارد');
ok(/\.fade-in\s*\{/.test(globals), 'کلاس .fade-in با متغیر opacity پیاده شده است');
ok(/\.zoom-in-95\s*\{/.test(globals), 'کلاس .zoom-in-95 پیاده شده است');

console.log('\n— دسترسی‌پذیری پایه —');
ok(/:focus-visible\s*\{/.test(globals), 'قاعدهٔ سراسری :focus-visible وجود دارد');
ok(/\.skip-link\s*\{/.test(globals), 'استایل .skip-link تعریف شده است');
ok(/href="#main"/.test(rootLayout), 'لینک «پرش به محتوا» در layout ریشه هست');
ok(/id="main"/.test(read(path.join(SRC, 'app', 'admin', 'layout.tsx'))), 'عنصر <main> شاخهٔ مدیریت id="main" دارد');
ok(/prefers-reduced-motion/.test(globals), 'حالت «کاهش حرکت» رعایت شده است');

console.log('\n— حالت شب بدون فلش —');
ok(/localStorage\.getItem\('theme'\)/.test(rootLayout), 'اسکریپت ضدفلش کلاس dark را پیش از paint ست می‌کند');
ok(/suppressHydrationWarning/.test(rootLayout), 'hydrate شدن <html> با کلاس وارونه هشدار نمی‌دهد');
ok(/font-weight:\s*900/.test(globals), 'وزن ۹۰۰ فونت (font-black) تعریف شده است');

console.log('\n— لایهٔ بازخورد سراسری —');
ok(existsSync(path.join(SRC, 'components', 'ui', 'Toast.tsx')), 'ToastProvider ساخته شده است');
ok(existsSync(path.join(SRC, 'components', 'ui', 'Confirm.tsx')), 'دیالوگ تأیید (useConfirm) ساخته شده است');
ok(existsSync(path.join(SRC, 'components', 'ui', 'Modal.tsx')), 'Modal با ترپ فوکوس ساخته شده است');
ok(/<ToastProvider>/.test(rootLayout) && /<ConfirmProvider>/.test(rootLayout), 'هر دو Provider در layout ریشه نصب شده‌اند');
ok(/aria-live="polite"/.test(read(path.join(SRC, 'components', 'ui', 'Toast.tsx'))), 'توست ناحیهٔ زندهٔ aria-live دارد');
ok(/role="dialog"/.test(read(path.join(SRC, 'components', 'ui', 'Modal.tsx')))
  && /aria-modal/.test(read(path.join(SRC, 'components', 'ui', 'Modal.tsx'))), 'Modal نقش dialog + aria-modal دارد');

console.log('\n— حالت بارگذاری شاخه‌ها —');
for (const area of ['admin', 'student', 'professor', 'group-manager', 'alumni', 'proctor']) {
  ok(existsSync(path.join(SRC, 'app', area, 'loading.tsx')), `loading.tsx برای شاخهٔ /${area} وجود دارد`);
}

console.log('\n— RTL در کارت‌های موبایل —');
ok(!/text-align:\s*left/.test(mobileTables), 'هیچ text-align:left در کارت‌های موبایل نمانده است');
ok(!/margin-left:\s*8px/.test(mobileTables), 'فاصلهٔ برچسب با margin-inline-start داده می‌شود');

console.log('\n— اندازه‌های متن هاردکد —');
let tiny = 0;
for (const f of tsxFiles) {
  const s = read(f);
  tiny += (s.match(/text-\[10px\]/g) ?? []).length + (s.match(/text-\[11px\]/g) ?? []).length;
}
ok(tiny === 0, `هیچ text-[10px]/text-[11px] باقی نمانده است (یافت‌شده: ${tiny})`);

console.log('\n— دیالوگ‌های بومی (alert/confirm) —');
/** خطوط کامنت و رشته‌های توضیحی را حذف کن تا هشدار کاذب ندهد. */
const stripCommentLines = (s: string) =>
  s
    .split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

let nativeAlert = 0;
let nativeConfirm = 0;
for (const f of tsxFiles) {
  const body = stripCommentLines(read(f));
  nativeAlert += (body.match(/(^|[^.\w])alert\(/g) ?? []).length;
  // پلِ بازخورد (fallback) و ConfirmProvider مجازند
  if (f.endsWith(path.join('lib', 'ui-feedback.ts'))) continue;
  if (f.includes(path.join('components', 'ui'))) continue;
  nativeConfirm += (body.match(/(^|[^.\w])confirm\(/g) ?? []).length;
}
ok(nativeAlert === 0, `هیچ alert() بومی در کد نمانده است (یافت‌شده: ${nativeAlert})`);
ok(nativeConfirm === 0, `هیچ confirm() بومی در کد نمانده است (یافت‌شده: ${nativeConfirm})`);
ok(existsSync(path.join(SRC, 'lib', 'ui-feedback.ts')), 'پلِ بازخورد (notify/askConfirm) موجود است');

console.log('\n— ناوبری کارتابل مدیریت (سایدبار دسکتاپ) —');
const adminNavSrc = read(path.join(SRC, 'app', 'admin', 'AdminNav.tsx'));
const adminLayoutSrc = read(path.join(SRC, 'app', 'admin', 'layout.tsx'));
ok(/lg:static/.test(adminNavSrc) && /lg:sticky/.test(adminNavSrc),
  'AdminNav در دسکتاپ به سایدبار چسبان تبدیل می‌شود');
ok(/lg:hidden/.test(adminNavSrc), 'دکمهٔ شناور «منو» فقط در موبایل نمایش داده می‌شود');
ok(!/backdrop-blur/.test(adminNavSrc), 'بلورِ سنگین از کشو حذف شده است (لگ لمس در موبایل)');
ok(adminLayoutSrc.indexOf('<AdminNav') > adminLayoutSrc.indexOf('</header>'),
  'AdminNav بیرون از <header> و در ستون بدنه رندر می‌شود (سایدبار واقعی)');
ok(/aria-haspopup="dialog"/.test(adminNavSrc) && /aria-expanded/.test(adminNavSrc),
  'تریگر منو aria-haspopup/aria-expanded دارد');

console.log('\n— گزارش‌های پرداختی مالی (r-finance) —');
const financeR = read(path.join(SRC, 'app', 'admin', 'reports', 'r-finance.ts'));
const helpers = read(path.join(SRC, 'app', 'admin', 'reports', 'report-helpers.ts'));
const reportsClient = read(path.join(SRC, 'app', 'admin', 'reports', 'ReportsClient.tsx'));
const PAY_KINDS = [
  'total-payments',
  'student-payments',
  'term-payments',
  'accounting-voucher',
  'term-financial',
  // گزارش‌های مدیریتی تجمیعی شهریه
  'tuition-overview',
  'tuition-faculty-detail',
  'faculty-financial',
  'major-financial',
];
for (const k of PAY_KINDS) {
  ok(financeR.includes(`kind === '${k}'`), `منطق گزارش «${k}» در r-finance پیاده شده است`);
  ok(helpers.includes(`'${k}'`), `«${k}» در ALL_REPORT_KINDS ثبت شده است`);
  ok(reportsClient.includes(`kind: '${k}'`), `کارت «${k}» در مرکز گزارش‌ها موجود است`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} قبول / ${fail} رد`);
if (fail > 0) process.exit(1);
