/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیت «ستون‌شماری جدول» — پنل تعریف درس مدیر گروه
 *
 *  چرا این تست وجود دارد:
 *    کاربر گزارش داد «پنل تعریف درس مدیرگروه به‌هم‌ریخته». خطای اجرایی نداشت:
 *    صفحه رندر می‌شد و ذخیره/حذف هم کار می‌کرد، ولی **جدول درهم می‌ریخت**.
 *
 *  ریشه: سرصفحه ۹ ستون داشت، ولی هر ردیف بدنه ۱۰ خانه:
 *      <td colSpan={8}>  ← کل فرمِ ویرایش با flex-wrap داخلش
 *      <td> ذخیره
 *      <td> حذف
 *    خانهٔ پهنِ colSpan با flex-wrap همهٔ فیلدها را روی چند خط می‌ریخت، پس
 *    برچسب‌ها/ورودی‌ها از ستون‌های سرصفحه جدا می‌افتادند.
 *
 *  چرا تست رفتاری کافی نیست: page.tsx یک Server Component با دسترسی DB و
 *  requireDepHead() است و در تست رندر نمی‌شود. پس ساختار منبع سنجیده می‌شود
 *  — همان روشی که tests/nested-form.test.ts برای فرم تودرتو به کار می‌برد.
 * ════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, '..', 'src', 'app', 'group-manager', 'courses', 'page.tsx');

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};

/** کامنت‌ها را حذف کن تا نمونه‌های داخل کامنت هشدار کاذب نسازند. */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const raw = readFileSync(FILE, 'utf8');
const src = stripComments(raw);

const count = (s: string, needle: string): number => s.split(needle).length - 1;

function between(text: string, start: string, end: string): string {
  const a = text.indexOf(start);
  if (a < 0) return '';
  const b = text.indexOf(end, a + start.length);
  return b < 0 ? '' : text.slice(a + start.length, b);
}

console.log('\n— جدول دروس گروه: سرصفحه و بدنه هم‌ستون باشند —');

const thead = between(src, '<thead>', '</thead>');
const thCount = count(thead, '<th');
ok(thCount === 9, `سرصفحه ۹ ستون دارد (واقعی: ${thCount})`);

// قالبِ یک ردیفِ داده = از شروع map تا ردیفِ حالت خالی
const rowBlock = between(src, 'rows.map(c =>', 'rows.length === 0');
ok(rowBlock.length > 0, 'قالب ردیف داده پیدا شد');

const tdInRow = count(rowBlock, '<td');
ok(tdInRow === 9, `هر ردیف دقیقاً ۹ خانه دارد (واقعی: ${tdInRow})`);
ok(tdInRow === thCount, 'تعداد خانه‌های ردیف با تعداد ستون‌های سرصفحه برابر است');

// هیچ ردیفی نباید colSpan بزرگ داشته باشد (همان چیزی که جدول را درهم ریخت)
ok(!/colSpan=\{?8\}?/.test(rowBlock), 'ردیف داده دیگر <td colSpan={8}> ندارد');

// ردیفِ حالت خالی باید کل عرض را بپوشاند
const emptyRow = between(src, 'rows.length === 0', '</tbody>');
ok(/colSpan=\{?9\}?/.test(emptyRow), 'ردیف «درسی تعریف نشده» با colSpan={9} کل عرض را می‌پوشاند');

console.log('\n— اتصال فیلدها به فرمِ ردیف با ویژگی form= —');

// هر ورودی/انتخابگرِ نام‌دار در ردیف باید با form={formId} به فرمِ ردیف وصل باشد،
// چون یک <form> نمی‌تواند چند <td> را در بر بگیرد.
const namedFields = rowBlock.match(/<(input|select)\b[^>]*name="[^"]+"[^>]*>/g) ?? [];
const bound = namedFields.filter((tag) => tag.includes('form={formId}'));
// دو فیلدِ hidden id داخل خودِ <form> هستند و نیازی به form= ندارند.
const hiddenIds = namedFields.filter((tag) => tag.includes('type="hidden"') && tag.includes('name="id"'));
ok(namedFields.length >= 8, `فیلدهای نام‌دار ردیف شناسایی شدند (${namedFields.length})`);
ok(bound.length === namedFields.length - hiddenIds.length,
  `همهٔ فیلدهای بیرونِ فرم با form={formId} وصل‌اند (${bound.length}/${namedFields.length - hiddenIds.length})`);
ok(hiddenIds.length === 2, `دو فیلد id پنهان (ذخیره و حذف) وجود دارد (${hiddenIds.length})`);

// نام فیلدها باید با updateCourseAction بخوانند
for (const name of ['code', 'title', 'theo', 'prac', 'type', 'grading', 'gpa', 'id']) {
  ok(rowBlock.includes(`name="${name}"`), `فیلد «${name}» در ردیف هست`);
}

// دو فرمِ خواهر (نه تودرتو) برای ذخیره و حذف
ok(count(rowBlock, 'id={formId}') === 1, 'دقیقاً یک <form id={formId}> برای ویرایش');
ok(rowBlock.includes('action={updateCourseAction}'), 'فرم ویرایش به updateCourseAction وصل است');
ok(rowBlock.includes('action={deleteCourseAction}'), 'فرم حذف به deleteCourseAction وصل است');

console.log('\n— فرم «تعریف درس جدید» —');

const createForm = between(src, 'createCourseAction', '</form>');
ok(createForm.length > 0, 'فرم ایجاد درس پیدا شد');
ok(createForm.includes('md:grid-cols-6'), 'گرید شش‌ستونیِ عمدی دارد');
ok(!createForm.includes('grid-cols-7'), 'دیگر grid-cols-7 (۹ فرزند در ۷ ستون) ندارد');

// مجموع span هر ردیف باید ۶ باشد، وگرنه دوباره می‌شکند.
const spans = [...createForm.matchAll(/md:col-span-(\d)/g)].map((m) => Number(m[1]));
const totalChildren = 9;
const explicitSpan = spans.reduce((a, b) => a + b, 0);
const implicitOne = totalChildren - spans.length;
ok(explicitSpan + implicitOne === 12,
  `مجموع عرض فرزندان = ۱۲ یعنی دو ردیفِ ۶ستونی (واقعی: ${explicitSpan + implicitOne})`);

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} قبول / ${fail} رد`);
if (fail > 0) process.exit(1);
