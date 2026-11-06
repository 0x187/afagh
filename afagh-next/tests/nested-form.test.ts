/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیت «فرم تودرتو» — JSX نامعتبر که مرورگر بی‌صدا دورش می‌ریزد
 *
 *  چرا این تست وجود دارد:
 *    در صفحهٔ قفل بیکاری (SessionLock) دکمهٔ «خروج از حساب کاربری» داخل یک
 *    <form action={logoutAction}> بود که خودش داخل <form onSubmit={unlock}>
 *    قرار داشت. HTML فرم تودرتو را مجاز نمی‌داند؛ وقتی این ساختار در HTML
 *    سمت سرور رندر شود (و صفحهٔ قفل با initialLocked=true دقیقاً همین‌طور
 *    رندر می‌شود)، پارسر مرورگر تگِ فرمِ داخلی را دور می‌ریزد. نتیجه:
 *      • دکمهٔ خروج هیچ فرمی برای ارسال نداشت،
 *      • کلیک روی آن فرمِ بیرونی (بازگشایی) را submit می‌کرد،
 *      • با رمز خالی → «رمز عبور را وارد کنید» و به‌ظاهر «هیچ اتفاقی نمی‌افتد».
 *
 *  چون React این ساختار را بی‌خطا می‌سازد و فقط مرورگر آن را می‌شکند، خطا در
 *  بازبینی کد و در تست‌های رفتاری دیده نمی‌شود — پس یک گیت استاتیک لازم است.
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
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** کامنت‌های JSX/بلوکی را حذف کن تا نمونه‌های داخل کامنت هشدار کاذب نسازند. */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

type Hit = { line: number; snippet: string };

/** هر <form> که داخل یک <form> بازِ دیگر شروع شود = تودرتویی نامعتبر. */
function findNestedForms(src: string): Hit[] {
  const clean = stripComments(src);
  const tag = /<(\/?)form\b[^>]*>/gi;
  const hits: Hit[] = [];
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(clean)) !== null) {
    const raw = m[0];
    if (m[1] === '/') {
      if (depth > 0) depth--;
      continue;
    }
    if (depth > 0) {
      const line = clean.slice(0, m.index).split('\n').length;
      hits.push({ line, snippet: raw.slice(0, 70) });
    }
    // <form ... /> خودبسته است و عمقی باز نمی‌کند
    if (!/\/>$/.test(raw)) depth++;
  }
  return hits;
}

console.log('\n— فرم تودرتو در کل src —');
{
  const files = walk(SRC);
  ok(files.length > 100, `تعداد فایل‌های tsx اسکن‌شده: ${files.length}`);

  const offenders: string[] = [];
  for (const f of files) {
    const hits = findNestedForms(readFileSync(f, 'utf8'));
    for (const h of hits) {
      offenders.push(`${path.relative(SRC, f)}:${h.line} → ${h.snippet}`);
    }
  }
  ok(offenders.length === 0, offenders.length === 0
    ? 'هیچ <form> تودرتویی وجود ندارد'
    : `فرم تودرتو یافت شد:\n      ${offenders.join('\n      ')}`);
}

console.log('\n— SessionLock: دو فرمِ خواهر (رگرسیون دکمهٔ خروج) —');
{
  const p = path.join(SRC, 'components', 'SessionLock.tsx');
  const src = stripComments(readFileSync(p, 'utf8'));
  const opens = (src.match(/<form\b[^>]*>/gi) ?? []).length;
  const closes = (src.match(/<\/form>/gi) ?? []).length;
  ok(opens === 2, `دقیقاً دو فرم دارد (یافت‌شده: ${opens})`);
  ok(closes === 2, `تعداد بستن‌ها هم دو است (یافت‌شده: ${closes})`);
  ok(findNestedForms(readFileSync(p, 'utf8')).length === 0, 'فرم‌ها تودرتو نیستند');
  ok(/<form action="\/api\/session\/logout" method="post"/.test(src), 'فرم خروج به مسیر HTTP خروج وصل است (بدون نیاز به JS)');
  // فرم خروج نباید داخل فرم بازگشایی باشد: بین شروع فرم بازگشایی و بسته‌شدنش
  // نباید هیچ <form action= دیگری باشد.
  const unlockStart = src.indexOf('<form onSubmit={unlock}');
  const unlockEnd = unlockStart >= 0 ? src.indexOf('</form>', unlockStart) : -1;
  const logoutAt = src.indexOf('<form action="/api/session/logout"');
  ok(unlockStart >= 0 && unlockEnd > unlockStart, 'فرم بازگشایی پیدا و بسته شد');
  ok(logoutAt > unlockEnd, 'فرم خروج بعد از بسته‌شدن فرم بازگشایی شروع می‌شود');
}

if (fail) {
  console.log(`\n✗ ${fail} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`\n✓ همه (${pass}) گذشت`);
