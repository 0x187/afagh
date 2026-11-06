/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیتِ «هیچ prefetchی در پسزمینه اجرا نشود»
 *
 *  چرا وجود دارد:
 *    HAR زندهٔ ۱۴۰۵/۰۸/۱۳ (`/admin/payroll?tab=simulator`) نشان داد با وجود
 *    کامیت `5f53f194` (که خودش ۱۶۲ درخواست `_rsc` منو را حذف کرده بود) هنوز
 *    **۱۶ درخواست `Next-Router-Prefetch: 1`** صادر میشد، چون لینکهای تازهٔ
 *    طراحی مجدد (`HeaderActions`، داک مالی، لینک «امتحانات» در حقوق،
 *    «چارت درسی» در سربرگ برنامهريزي و …) بدون `prefetch={false}` اضافه
 *    شده بودند. هر prefetch = یک رندر کامل RSC + کوئری DB.
 *
 *    سیاست اعلامشدهٔ پروژه (پیام `5f53f194`): «هیچ رندری در پسزمینه اجرا
 *    نشود». پس **همهٔ** `<Link>`ها — حتی لینکهای تکصفحهای و صفحهبندی —
 *    باید prefetch خاموش داشته باشند. لینکهایی که واقعاً به prefetch نیاز
 *    دارند باید صریحاً `prefetch={true}` بنویسند.
 *
 *  این تست فقط متن فایلها را میخواند (بدون مرورگر/بدون سرور).
 * ════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** برش تگ `<Link …>` تا اولین `>` بیرون از پرانتزهای `{ }` (href={...}) */
function linkTags(src: string): string[] {
  const tags: string[] = [];
  const re = /<Link\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let j = re.lastIndex;
    let depth = 0;
    while (j < src.length) {
      const c = src[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
      j++;
    }
    tags.push(src.slice(m.index, j + 1));
    re.lastIndex = j + 1;
  }
  return tags;
}

const files = walk(SRC);
let total = 0;
const without: string[] = [];
const explicitTrue: string[] = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const tag of linkTags(src)) {
    total++;
    if (!/prefetch\s*=\s*\{/.test(tag)) {
      without.push(`${path.relative(ROOT, f)} :: ${tag.slice(0, 90).replace(/\s+/g, ' ')}`);
    } else if (/prefetch\s*=\s*\{\s*true\s*\}/.test(tag)) {
      explicitTrue.push(path.relative(ROOT, f));
    }
  }
}

console.log('— prefetch لینکها —');
ok(total > 150, `فهرست لینکها واقعاً پیمایش شد (یافتشده: ${total})`);
ok(without.length === 0,
  `همهٔ ${total} لینک prefetch={false} دارند (بدون گارد: ${without.length})`);
if (without.length) for (const w of without.slice(0, 12)) console.log('     ↳', w);

// پروندههایی که HAR زنده بهعنوان منبع prefetch معرفی کرد — محافظت دوتایی
console.log('\n— پروندههای پرخطرِ شناساییشده در HAR —');
const hot = [
  ['components', 'HeaderActions.tsx'],                       // «راهنما» ۲ بار
  ['app', 'admin', 'finance', 'page.tsx'],                   // داک مالی ۱۰ بار
  ['app', 'admin', 'payroll', 'PayrollEngineClient.tsx'],    // /admin/exams
  ['app', 'admin', 'scheduling', 'components', 'PlanningHeader.tsx'], // /admin/curriculum
  ['app', 'admin', 'finance', 'reports', 'page.tsx'],
  ['app', 'admin', 'AdminNav.tsx'],
];
for (const parts of hot) {
  const p = path.join(SRC, ...parts);
  const src = readFileSync(p, 'utf8');
  const tags = linkTags(src);
  ok(tags.length > 0 && tags.every(t => /prefetch\s*=\s*\{\s*false\s*\}/.test(t)),
    `${parts.join('/')}: ${tags.length} لینک، همگی prefetch={false}`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} قبول / ${fail} رد`);
if (fail > 0) process.exit(1);
