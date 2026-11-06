#!/usr/bin/env node
/**
 * backfill-bates-reason.mjs — آوردن «دلیل تخفیف» سما به دفتر مالی آفاق
 *
 * ── چرا ──────────────────────────────────────────────────────────────
 * سما دلیل تخفیف را در `PercentBates.Rem` و `Mab_Bates.Rem` نگه می‌داشت
 * («تخفيف بدستور رياست»، «رتبه برتر»، «ايثارگري»، «ثبت نام مجدد»، …).
 * هنگام مهاجرت، مبلغ به‌صورت ردیفِ `TUITION_BATES` در `student_ledger` درج
 * شد ولی دلیلش نیامد؛ نتیجه این بود که سند چاپی فقط می‌نوشت «تخفیف» و
 * کارشناس مالی نمی‌فهمید بابت چه چیزی است.
 *
 * ── ورودی ────────────────────────────────────────────────────────────
 * یک TSV سه‌ستونی از سما با جداکنندهٔ `|`:
 *
 *     stno|TermCode|reason
 *
 * که با `scripts/export-bates-reason.sql` و دستور زیر ساخته می‌شود:
 *
 *     sqlcmd -S "127.0.0.1,62133" -E -d uems -f 65001 -W -s "|" -h -1 \
 *            -i scripts/export-bates-reason.sql -o bates_reason.tsv
 *
 * ── خروجی ────────────────────────────────────────────────────────────
 * یک فایل SQL که با psql اجرا می‌شود:
 *
 *     node scripts/backfill-bates-reason.mjs <dir>
 *     ssh <server> 'docker exec -i afagh_pg psql -U afagh -d afagh_db -X -q' \
 *       < <dir>/apply_bates_reason.sql
 *
 * ── نکات ایمنی ───────────────────────────────────────────────────────
 * ۱) جدول ورودی **TEMP** است (pg_temp)، نه public: اسکریپت hardening سرویس
 *    migrator هر جدولِ public با ستون شناسهٔ شخصی را رد می‌کند و استقرار را
 *    متوقف می‌کند (fail-closed).
 * ۲) `academic_terms."termCode"` یکتا نیست (تا ۵ ردیف با یک کد)، پس join فقط
 *    روی کد ترم می‌تواند ردیفِ ترمِ دیگری را هم بگیرد. آپدیت با `id` ردیف دفتر
 *    کل انجام می‌شود.
 * ۳) idempotent است: فقط ردیف‌هایی که `legacyRem` خالی دارند پر می‌شوند.
 * ۴) دلیلِ «0» در سما یعنی «ثبت نشده» و حذف می‌شود.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || '.';
const src = join(dir, 'bates_reason.tsv');
const out = join(dir, 'apply_bates_reason.sql');

const raw = readFileSync(src, 'utf8').replace(/^\uFEFF/, '');

const rows = [];
let skipped = 0;
for (const line of raw.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const parts = line.split('|');
  if (parts.length < 3) { skipped++; continue; }
  const code = parts[0].trim();
  const term = parts[1].trim();
  // بقیهٔ خط = دلیل؛ ممکن است خودش «|» داشته باشد
  const reason = parts.slice(2).join('|').trim();
  if (!code || !term || !reason || reason === '0') { skipped++; continue; }
  rows.push([code, term, reason.replace(/\t/g, ' ')]);
}

const copy = rows.map((r) => r.join('\t')).join('\n');

const sql = `\\encoding UTF8
\\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _bates_reason (code text, term text, reason text) ON COMMIT DROP;

COPY _bates_reason (code, term, reason) FROM stdin;
${copy}
\\.

-- ⚠ academic_terms."termCode" یکتا نیست؛ آپدیت با شناسهٔ ردیف دفتر کل
WITH cand AS (
  SELECT l.id AS ledger_id, r.reason
    FROM _bates_reason r
    JOIN students s       ON s."studentCode" = r.code
    JOIN student_ledger l ON l."studentId"   = s.id
    JOIN academic_terms t ON t.id = l."termId" AND t."termCode" = r.term
   WHERE l."transactionType" = 'TUITION_BATES'
     AND (l."legacyRem" IS NULL OR btrim(l."legacyRem") = '')
)
UPDATE student_ledger l
   SET "legacyRem" = c.reason
  FROM cand c
 WHERE l.id = c.ledger_id;

\\echo == نتیجه ==
SELECT count(*) FILTER (WHERE btrim(COALESCE("legacyRem",'')) <> '') AS با_دلیل,
       count(*) FILTER (WHERE btrim(COALESCE("legacyRem",'')) =  '') AS بی_دلیل,
       count(*) AS جمع
  FROM student_ledger WHERE "transactionType" = 'TUITION_BATES';

COMMIT;
`;

writeFileSync(out, sql, 'utf8');
console.log(`rows=${rows.length} skipped=${skipped} -> ${out}`);
