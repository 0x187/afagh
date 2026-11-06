/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیت «`.input` باید داخل @layer components باشد»
 *
 *  چرا این تست وجود دارد:
 *    در globals.css دستورِ `@tailwind utilities;` در بالای فایل است و کلاس‌های
 *    کامپوننتی (`.input`, `.card`, `.btn`) در انتهای فایل تعریف شده بودند. در
 *    آبشار CSS، هر قاعده‌ای که **دیرتر** بیاید و وزن انتخابگرش برابر باشد
 *    برنده است. `.input` هم `w-full` دارد ⇒ `width:100%` آن بر
 *    `w-16` / `w-20` / `w-24` نوشته‌شده در JSX غالب می‌شد.
 *
 *  نتیجهٔ عملی: هر ورودیِ کوتاهِ عمدی تمام‌عرض می‌شد و «چیدمان فشرده» ناممکن
 *  بود. فرم‌های `flex flex-wrap` (کارتابل ارائه و کلاس‌های مدیر گروه) هر فیلد
 *  را در یک سطر جدا می‌ریختند — همان چیزی که کاربر گزارش داد.
 *
 *  کدبیس قبلاً با `!py-1 !px-2` دورش زده بود، ولی برای *عرض* راهی نداشت.
 *  راه‌حل: انتقال `.input` به `@layer components` تا محتوا پیش از utilities
 *  تزریق شود و utilities همیشه برنده باشند.
 * ════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = path.join(HERE, '..', 'src', 'app', 'globals.css');

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};

/** کامنت‌های CSS را حذف کن تا نمونه‌های توضیحی هشدار کاذب نسازند. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const css = stripComments(readFileSync(CSS, 'utf8'));

/** بازهٔ [start, end] بلوکِ `@layer <name> { ... }` را با شمارش آکولاد پیدا کن. */
function layerBlock(text: string, name: string): { start: number; end: number } | null {
  const open = new RegExp(`@layer\\s+${name}\\s*\\{`).exec(text);
  if (!open) return null;
  const start = open.index;
  let i = start + open[0].length;
  let depth = 1;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  return { start, end: i };
}

console.log('\n— جایگاه .input در آبشار CSS —');

const utilitiesAt = css.indexOf('@tailwind utilities');
ok(utilitiesAt >= 0, 'دستور @tailwind utilities در فایل هست');
ok(/@tailwind\s+components/.test(css), '@tailwind components وجود دارد (نقطهٔ تزریق لایه)');

const components = layerBlock(css, 'components');
ok(components !== null, 'بلوک @layer components وجود دارد');

const inputDefs: number[] = [];
for (let i = css.indexOf('.input'); i >= 0; i = css.indexOf('.input', i + 1)) inputDefs.push(i);
ok(inputDefs.length > 0, `تعریف .input پیدا شد (${inputDefs.length} مورد)`);

const outside = components ? inputDefs.filter(p => p < components.start || p > components.end) : inputDefs;
ok(outside.length === 0,
  outside.length === 0
    ? 'همهٔ تعریف‌های .input داخل @layer components هستند (پس w-* برنده می‌شود)'
    : `${outside.length} تعریفِ .input بیرون از @layer components است — w-16/w-20/w-24 بی‌اثر می‌شوند`);

ok(/\.input\s*\{[^}]*w-full/.test(css), '.input همچنان w-full دارد (پیش‌فرض تمام‌عرض درون سلول/گرید)');

// هیچ قاعدهٔ .input دیگری نباید بعد از @tailwind utilities و بیرون از لایه باشد
const strayAfter = components
  ? inputDefs.filter(p => p > utilitiesAt && (p < components.start || p > components.end))
  : [];
ok(strayAfter.length === 0, 'هیچ .input سرگردانی بعد از utilities تعریف نشده است');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} قبول / ${fail} رد`);
if (fail > 0) process.exit(1);
