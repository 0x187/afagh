/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیت «searchParams باید await شود» — تلهٔ Next.js 15/16
 *
 *  چرا این تست وجود دارد:
 *    در Next.js 15+ مقدار `searchParams` یک **Promise** است. اگر صفحه آن را
 *    مثل آبجکت خام بخواند (`sp.major`, `searchParams?.year`)، هیچ خطایی رخ
 *    نمی‌دهد: TypeScript هم اگر تایپ دستی نوشته شده باشد اعتراض نمی‌کند،
 *    بیلد سبز است، صفحه هم بالا می‌آید — فقط **همهٔ پارامترهای URL نادیده
 *    گرفته می‌شوند**.
 *
 *  دقیقاً همین اتفاق در «تخصیص درس ترم بالاتر» افتاد: کاربر رشته/ورودی را
 *  انتخاب می‌کرد و «نمایش دانشجویان» را می‌زد، ولی صفحه با پیش‌فرض رندر
 *  می‌شد و می‌گفت «دانشجویی یافت نشد». همین باگ در «جبرانی» هم بود.
 *
 *  چون خطا در زمان اجرا بی‌صدا است، یک گیت استاتیک لازم است.
 * ════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name === 'page.tsx') out.push(p);
  }
  return out;
}

/** کامنت‌ها را حذف کن تا نمونه‌های توضیحی هشدار کاذب نسازند. */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const pages = walk(SRC);
console.log(`\n— ${pages.length} صفحه بررسی شد —`);

let withParams = 0;
const badType: string[] = [];
const badAwait: string[] = [];

for (const file of pages) {
  const raw = readFileSync(file, 'utf8');
  const src = stripComments(raw);
  // آیا این صفحه searchParams را در امضای خود دارد؟
  if (!/\bsearchParams\b/.test(src)) continue;
  withParams++;
  const rel = path.relative(path.join(HERE, '..'), file).replace(/\\/g, '/');

  // ۱) تایپ باید Promise<...> باشد
  //    نکته: `searchParams?: Promise<...>` هم درست است (پارامتر اختیاری)؛
  //    نسخهٔ اولِ این تست `?` را نمی‌شناخت و هشدار کاذب می‌داد.
  const typeMatch = /searchParams\??\s*:\s*([^;\n}]+)/.exec(src);
  const typeText = typeMatch?.[1] ?? '';
  if (!/Promise\s*</.test(typeText)) badType.push(rel);

  // ۲) باید await شود: `await searchParams`، `await props.searchParams`،
  //    یا شکل پرانتزدار `await (searchParams ?? Promise.resolve(...))`.
  if (!/await\s*\(?\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?searchParams/.test(src)) badAwait.push(rel);
}

ok(withParams > 0, `صفحه‌های دارای searchParams پیدا شدند (${withParams})`);
ok(badType.length === 0,
  badType.length === 0
    ? 'همهٔ آن‌ها searchParams را Promise تایپ کرده‌اند'
    : `این صفحه‌ها searchParams را Promise تایپ نکرده‌اند: ${badType.join(' , ')}`);
ok(badAwait.length === 0,
  badAwait.length === 0
    ? 'همهٔ آن‌ها searchParams را await می‌کنند'
    : `این صفحه‌ها searchParams را await نمی‌کنند: ${badAwait.join(' , ')}`);

// فایل‌های مرجعِ اصلاح‌شده باید سبز باشند (رگرسیونِ همان باگ گزارش‌شده)
for (const must of [
  'src/app/group-manager/grants/page.tsx',
  'src/app/group-manager/compensatory/page.tsx',
]) {
  const src = stripComments(readFileSync(path.join(HERE, '..', must), 'utf8'));
  ok(/await\s+searchParams/.test(src), `${must} پارامترها را await می‌کند`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} قبول / ${fail} رد`);
if (fail > 0) process.exit(1);
