#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════
 *  ممیزی استاتیک Server Actions — «هیچ اکشن بدون گارد» (بازبینی: P0)
 *
 *  برای هر تابع export شده در فایل‌های 'use server' بررسی می‌شود که در
 *  بدنهٔ آن (یا از طریق helper گارد محلی / اکشن گارددار دیگر) حداقل یک
 *  احراز/مجوز باشد:
 *    requireRole | requireRoleOrPermission | requireDepHead
 *    | requireMigrationAdmin | getSessionUser | requireStudentScope
 *    | assertServerActionOrigin
 *
 *  سه منبع «گارد» پذیرفته می‌شود:
 *    ۱) فراخوانی مستقیم یکی از گاردهای بالا در بدنهٔ همان تابع
 *    ۲) فراخوانی یک helper محلیِ همان فایل که خودش گارد دارد (guard/ctx/me/…)
 *    ۳) فراخوانی یک اکشن گارددارِ دیگر (واگذاری/delegation) — حتی از فایل
 *       دیگر. مثال واقعی: `boardAction` فقط `loadBoard()` را صدا می‌زند و
 *       گارد داخل `loadBoard` است؛ یا `uploadShowcaseLogoAction` کار را به
 *       `uploadUniversityLogoAction` در فایل universities می‌سپارد.
 *       زنجیره تا رسیدن به ثبات (fixed point) دنبال می‌شود.
 *
 *  تشخیص فایل 'use server' دقیق است: دایرکتیو باید اولین «statement» فایل
 *  باشد. صرفِ وجود رشته در یک کامنت کافی نیست — قبلاً فایل
 *  `admin/reports/report-helpers.ts` که در کامنتش نوشته «بدون 'use server'»
 *  اشتباهاً ممیزی می‌شد.
 *
 *  فایل‌های عمداً عمومی (ورود، استعلام‌های عمومی) در لیست سفیدند.
 *
 *  در CI اجرا می‌شود: هر اکشن بدون گارد → خروجی ۱ و نام فایل/تابع.
 * ════════════════════════════════════════════════════════════════════════
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'src/app');

// گاردهای شناخته‌شده. `requireRoleOrPermission` همان کار requireRole را
// می‌کند (نقش یا مجوز ریزدانه) و باید در همین لیست باشد.
const GUARDS = /requireRole\(|requireRoleOrPermission\(|requireDepHead\(|requireMigrationAdmin\(|requirePlatformAdmin\(|getSessionUser\(|requireStudentScope\(|assertServerActionOrigin\(/;

// مسیرهای عمومی عمدی (نیاز به گارد ندارند) — با دلیل
const PUBLIC_FILES = [
  'login/actions.ts',             // ورود/تغییر رمز: خودِ login گارد داخلی دارد + origin guard
  'id/actions.ts',                // استعلام عمومی کارت (rate-limited)
  'verify-certificate/actions.ts',// استعلام عمومی اصالت گواهینامه (rate-limited)
  'verify/[code]/page.tsx',       // صفحهٔ عمومی (rate-limited)
  'open-courses/actions.ts',      // ثبت‌نام دوره‌های آزاد و استعلام کد تخفیف: عمداً برای عموم (بدون ورود) + rate-limit داخلی
];

/**
 * آیا این فایل واقعاً دایرکتیو 'use server' دارد؟
 * کامنت‌های ابتدای فایل مجازند (Next هم اجازه می‌دهد)، ولی رشتهٔ داخل کامنت
 * یا داخل import/توضیح، دایرکتیو نیست.
 */
function isUseServerFile(src) {
  const s = src.replace(/^\uFEFF/, '');
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { i++; continue; }
    if (s.startsWith('//', i)) {
      const nl = s.indexOf('\n', i);
      if (nl === -1) return false;
      i = nl + 1;
      continue;
    }
    if (s.startsWith('/*', i)) {
      const end = s.indexOf('*/', i + 2);
      if (end === -1) return false;
      i = end + 2;
      continue;
    }
    break;
  }
  return /^(['"])use server\1\s*;?/.test(s.slice(i));
}

function collect(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (e.endsWith('.ts') || e.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** helperهای محلی گارددار: «async function name(...)[: ReturnType] { ... }» */
function localHelpers(src) {
  const names = [];
  const helperRe = /async\s+function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*(?::[^{;]+)?\{([\s\S]*?)\n\}/g;
  let hm;
  while ((hm = helperRe.exec(src)) !== null) {
    if (GUARDS.test(hm[2]) || /getStudentByUser\(|getStaffByUser\(/.test(hm[2])) names.push(hm[1]);
  }
  return names;
}

/** بدنهٔ هر تابع export شدهٔ async در فایل */
function exportedBodies(src) {
  const out = [];
  const parts = src.split(/export\s+async\s+function\s+/);
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    const name = (chunk.match(/^([A-Za-z0-9_]+)/) || [])[1];
    if (!name) continue;
    const body = chunk.split(/export\s+(?:async\s+)?function\s+/)[0].split(/export\s+const\s+/)[0];
    out.push({ name, body });
  }
  return out;
}

// ── مرحلهٔ ۱: خواندن و استخراج ──────────────────────────────────────────
const files = collect(ROOT);
const units = [];   // { relApp, src, helpers, exports }
const publicSeen = [];

for (const f of files) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  if (!isUseServerFile(src)) continue;
  const relApp = path.relative(process.cwd(), f).replace(/\\/g, '/').replace('src/app/', '');
  if (PUBLIC_FILES.some((p) => relApp === p)) {
    publicSeen.push(relApp);
    continue;
  }
  const exports = exportedBodies(src);
  if (!exports.length) continue;
  units.push({ relApp, src, helpers: localHelpers(src), exports });
}

// ── مرحلهٔ ۲: مجموعهٔ «اکشن‌های گارددار» و بستن زنجیرهٔ واگذاری ───────────
const guardedNames = new Set();

function isGuarded(body, helpers) {
  if (GUARDS.test(body)) return true;
  if (helpers.some((h) => new RegExp(`\\b${h}\\s*\\(`).test(body))) return true;
  for (const g of guardedNames) {
    if (new RegExp(`\\b${g}\\s*\\(`).test(body)) return true;
  }
  return false;
}

// سه دور کافی است: گارددارهای مستقیم → یک‌واسطه → دو‌واسطه
for (let round = 0; round < 3; round++) {
  let changed = false;
  for (const u of units) {
    for (const ex of u.exports) {
      if (guardedNames.has(ex.name)) continue;
      if (isGuarded(ex.body, u.helpers)) { guardedNames.add(ex.name); changed = true; }
    }
  }
  if (!changed) break;
}

// ── مرحلهٔ ۳: گزارش ─────────────────────────────────────────────────────
let problems = [];
let scanned = 0;

for (const p of publicSeen) console.log(`  ⚪ عمومی (سفید): ${p}`);

for (const u of units) {
  for (const ex of u.exports) {
    scanned++;
    if (!guardedNames.has(ex.name)) problems.push(`${u.relApp} → ${ex.name}()`);
  }
}

console.log(`\n🔎 اکشن‌های ممیزی‌شده: ${scanned}`);
if (problems.length) {
  console.error(`❌ ${problems.length} اکشن بدون گارد:`);
  for (const p of problems) console.error(`   • ${p}`);
  process.exit(1);
}
console.log('✅ همهٔ Server Actionهای غیرعمومی گارد دارند (Role/Object/Origin).');
