#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════
 *  پرکردن «پیش‌نیاز / هم‌نیاز» از فایل «جدول دروس» سیستم قدیمی
 * ════════════════════════════════════════════════════════════════════════
 *
 * چرا این اسکریپت لازم شد؟
 *  در سامانهٔ قدیمی این دو قاعده ستونِ خودِ جدول دروس بودند:
 *      كد | نام | مقطع | گروه_اموزشي | تعداد_واحد | ... | پيشنياز | ... | همنياز | ...
 *  ولی مهاجرت فقط کد/نام/واحد/نوع/مقطع/گروه را می‌خواند؛ پس `course_rules`
 *  خالی ماند و هیچ هشدار پیش‌نیازی روی چارت دیده نشد.
 *
 * چه می‌کند؟
 *  ۱. فایل TSV (کدگذاری windows-1256) را می‌خواند و سطر سرستون را **با نام**
 *     تشخیص می‌دهد (نه با شمارهٔ ستون — دانشگاه‌ها ستون‌بندی متفاوت دارند).
 *  ۲. برای هر سطر، متن خام «پیش‌نیاز» و «هم‌نیاز» را در
 *     `courses.prereqText` / `courses.coRequisites` می‌نویسد (فقط اگر خالی باشد).
 *  ۳. ترجمه به `course_rules` کارِ اپ است (دکمهٔ «🔗 پیش‌نیاز از جدول دروس»
 *     یا همگام‌سازی خودکار مهاجرت) — چون قواعد مقیّد به نسخهٔ برنامه‌اند.
 *
 * اجرا (پیش‌فرض dry-run است؛ برای نوشتن `--apply` بدهید):
 *   docker compose run --rm --no-deps \
 *     -v "/root/information-afagh:/data:ro" migrator \
 *     node scripts/backfill-course-requisites.mjs --file "/data/tatbigh dars.txt" --source AFAGH --apply
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

// ── آرگومان‌ها ──
const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

const FILE = arg('file');
const SOURCE = (arg('source', 'AFAGH') || '').toUpperCase();
const ENCODING = arg('encoding', 'windows-1256');
const APPLY = flag('apply');
const OVERWRITE = flag('overwrite');

if (!FILE) {
  console.error('استفاده: node scripts/backfill-course-requisites.mjs --file "<مسیر tatbigh dars.txt>" --source AFAGH [--apply] [--overwrite]');
  process.exit(2);
}

// ── یکسان‌سازی متن فارسی (همان قاعدهٔ src/lib/prereq-text.ts) ──
const FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';
function normTxt(s) {
  let t = String(s ?? '');
  t = t.replace(/[۰-۹]/g, d => String(FA.indexOf(d)));
  t = t.replace(/[٠-٩]/g, d => String(AR.indexOf(d)));
  t = t.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ').replace(/\u200f|\u200e/g, '');
  return t.replace(/\s+/g, ' ').trim();
}
/** کلید مقایسهٔ سرستون: بدون فاصله/زیرخط/اسلش و با حروف یکسان‌شده */
const key = (s) => normTxt(s).replace(/[\s_\-/\\()«».]+/g, '');

const EMPTY = new Set(['', '-', '—', '–', 'ندارد', 'هیچ', '0', 'ندارد.', 'بدون پیش نیاز', 'بدون پیشنیاز']);

// ── الگوهای سرستون (دقیق، تا ستون «عناوین دروس پیشنیاز» با «پیشنیاز» قاطی نشود) ──
const H_PREREQ = new Set(['پیشنیاز', 'پیش نیاز', 'prereq', 'prerequisite', 'prerequisites']);
const H_COREQ = new Set(['همنیاز', 'هم نیاز', 'coreq', 'corequisite', 'corequisites', 'co requisite']);
const H_EQUIV = new Set(['همارز', 'هم ارز', 'معادل', 'دروس معادل', 'equivalent']);

function detectColumns(headerCells) {
  const out = { prereq: -1, coreq: -1, equiv: -1, code: -1, title: -1 };
  headerCells.forEach((raw, i) => {
    const k = key(raw);
    if (out.code < 0 && (k === 'کد' || k === 'کددروس' || k === 'code')) out.code = i;
    if (out.title < 0 && (k === 'نام' || k === 'نامدرس' || k === 'title')) out.title = i;
    if (out.prereq < 0 && H_PREREQ.has(k)) out.prereq = i;
    if (out.coreq < 0 && H_COREQ.has(k)) out.coreq = i;
    // «دروس هم ارز / متضاد» بعد از حذف فاصله و اسلش → «دروسهمارزمتضاد»
    if (out.equiv < 0 && (H_EQUIV.has(k) || k.startsWith('دروسهمارز'))) out.equiv = i;
  });
  return out;
}

// ── خواندن فایل ──
const raw = readFileSync(FILE);
const text = new TextDecoder(ENCODING, { fatal: false }).decode(raw);
const lines = text.split(/\r?\n/);

// سطر سرستون: نخستین سطری که ستون «کد» دارد
let headerIdx = -1, cols = null;
for (let i = 0; i < Math.min(lines.length, 20); i++) {
  const cells = lines[i].split('\t');
  if (cells.length < 4) continue;
  const c = detectColumns(cells);
  if (c.code >= 0 && c.title >= 0) { headerIdx = i; cols = c; break; }
}
if (headerIdx < 0) {
  console.error('❌ سطر سرستون پیدا نشد (ستون‌های «کد» و «نام» لازم است).');
  process.exit(1);
}

console.log(`📄 فایل: ${FILE}`);
console.log(`   سطر سرستون: ${headerIdx + 1} · ستون پیش‌نیاز: ${cols.prereq >= 0 ? cols.prereq : '—'} · هم‌نیاز: ${cols.coreq >= 0 ? cols.coreq : '—'} · هم‌ارز: ${cols.equiv >= 0 ? cols.equiv : '—'}`);

if (cols.prereq < 0 && cols.coreq < 0) {
  console.error('❌ هیچ ستون «پیش‌نیاز» یا «هم‌نیاز» در سرستون این فایل نیست — مهاجرت لازم نیست.');
  process.exit(1);
}

const rows = [];
let skippedEmpty = 0, malformed = 0;
for (let i = headerIdx + 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line || !line.trim()) continue;
  const cells = line.split('\t');
  const code = (cells[cols.code] || '').trim();
  if (!code) { malformed++; continue; }
  const pre = cols.prereq >= 0 ? normTxt(cells[cols.prereq]) : '';
  const co = cols.coreq >= 0 ? normTxt(cells[cols.coreq]) : '';
  const eq = cols.equiv >= 0 ? normTxt(cells[cols.equiv]) : '';
  if (EMPTY.has(pre.toLowerCase()) && EMPTY.has(co.toLowerCase())) { skippedEmpty++; continue; }
  rows.push({
    code: code.slice(0, 20),
    prereqText: EMPTY.has(pre.toLowerCase()) ? null : pre,
    coRequisites: EMPTY.has(co.toLowerCase()) ? null : co.replace(/\s*[|،]\s*/g, ',').slice(0, 200),
    equiv: EMPTY.has(eq.toLowerCase()) ? null : eq,
  });
}

console.log(`   سطرهای دارای قاعده: ${rows.length} · بی‌قاعده: ${skippedEmpty} · بی‌کد: ${malformed}`);

// ── نوشتن در دیتابیس ──
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://afagh:afagh@postgres:5432/afagh_db',
  max: 4,
});

const [uni] = (await pool.query('SELECT id, code FROM universities WHERE code = $1', [SOURCE])).rows;
if (!uni) {
  console.error(`❌ دانشگاه «${SOURCE}» در جدول universities نیست.`);
  await pool.end();
  process.exit(1);
}
console.log(`🏛 دانشگاه: ${uni.code} (id=${uni.id})`);

const bank = new Map(
  (await pool.query('SELECT id, code, "prereqText", "coRequisites" FROM courses WHERE "universityId" = $1', [uni.id]))
    .rows.map(r => [String(r.code).trim(), r]),
);
console.log(`📚 دروس این دانشگاه در سامانه: ${bank.size}`);

let matched = 0, missing = 0, written = 0, kept = 0;
const missingCodes = [];

for (const r of rows) {
  const cur = bank.get(r.code);
  if (!cur) { missing++; if (missingCodes.length < 15) missingCodes.push(r.code); continue; }
  matched++;
  const setPre = r.prereqText && (OVERWRITE || !cur.prereqText);
  const setCo = r.coRequisites && (OVERWRITE || !cur.coRequisites);
  if (!setPre && !setCo) { kept++; continue; }
  if (!APPLY) { written++; continue; }
  const sets = [], vals = [];
  if (setPre) { vals.push(r.prereqText); sets.push(`"prereqText" = $${vals.length}`); }
  if (setCo) { vals.push(r.coRequisites); sets.push(`"coRequisites" = $${vals.length}`); }
  vals.push(cur.id);
  await pool.query(`UPDATE courses SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  written++;
}

console.log(`\n${APPLY ? '✅ نوشته شد' : '🔍 dry-run (بدون نوشتن)'}`);
console.log(`   تطبیق‌یافته: ${matched} · بدون تغییر: ${kept} · ${APPLY ? 'به‌روزشده' : 'قابل‌به‌روزرسانی'}: ${written}`);
console.log(`   کدِ درسِ نبودِ سامانه: ${missing}${missingCodes.length ? ` (نمونه: ${missingCodes.join('، ')})` : ''}`);
if (!APPLY) console.log('\nبرای اعمال واقعی:  --apply');

await pool.end();
