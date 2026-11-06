#!/usr/bin/env node
/**
 * backfill-course-nature.mjs
 * بک‌فیلِ «نوع درس آموزشی» (courses.courseNature) از سما (LT7.Type → LT9.Title).
 *
 * ورودی: TSV حاصل از export-sama-course-nature.sql (ستون‌ها: code \t title)
 * منطق: فقط ردیف‌هایی را پر می‌کند که courseNature خالی است (idempotent).
 *
 * اجرا:
 *   node scripts/backfill-course-nature.mjs --tsv scripts/sama-course-nature.tsv --dry-run
 *   node scripts/backfill-course-nature.mjs --tsv scripts/sama-course-nature.tsv --apply \
 *        --db-env /root/afagh/.env --db-host 172.20.0.3
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const raw = process.argv.slice(2);
const args = {};
for (let i = 0; i < raw.length; i++) {
  if (raw[i].startsWith('--')) {
    const k = raw[i].slice(2);
    args[k] = (raw[i + 1] && !raw[i + 1].startsWith('--')) ? raw[++i] : 'true';
  }
}
const APPLY = args.apply === 'true';
const TSV = args.tsv || resolve(process.cwd(), 'scripts/sama-course-nature.tsv');
const DB_ENV = args['db-env'] || '/root/afagh/.env';
const DB_HOST = args['db-host'] || '172.20.0.3';

function readTsv(path) {
  if (!existsSync(path)) throw new Error('TSV not found: ' + path);
  const txt = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [code, title] = line.split('\t');
    if (!code || !title) continue;
    if (!/^\d+$/.test(code.trim())) continue; // سرآیند یا خط نامعتبر
    if (title.trim() === 'نامشخص') continue;  // «نامشخص» = بدون ماهیت؛ ننویس
    rows.push({ code: code.trim(), title: title.trim() });
  }
  return rows;
}

const esc = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;

(async () => {
  const rows = readTsv(TSV);
  console.log('ردیف‌های معتبر:', rows.length);
  console.log('نمونه:', rows.slice(0, 5).map((r) => `${r.code}=${r.title}`).join(' | '));

  if (!APPLY) {
    console.log('\n[DRY-RUN] بدون تغییر پایگاه‌داده خارج شد.');
    return;
  }

  const req = createRequire(resolve(process.cwd(), 'package.json'));
  const { Pool } = req('pg');
  let pw = process.env.POSTGRES_PASSWORD || '';
  if (existsSync(DB_ENV)) {
    const m = readFileSync(DB_ENV, 'utf8').match(/^POSTGRES_PASSWORD=(.*)$/m);
    if (m) pw = m[1].replace(/\r$/, '');
  }
  if (!pw) throw new Error('POSTGRES_PASSWORD not found (env or ' + DB_ENV + ')');
  const pool = new Pool({ host: DB_HOST, port: 5432, user: 'afagh', password: pw, database: 'afagh_db', max: 5 });
  const q = async (t, p) => (await pool.query(t, p)).rows;
  try {
    await q(`DROP TABLE IF EXISTS _tmp_course_nature`);
    await q(`CREATE TEMP TABLE _tmp_course_nature (code varchar(20) PRIMARY KEY, title varchar(80))`);
    const BATCH = 2000;
    for (let i = 0; i < rows.length; i += BATCH) {
      const vals = rows.slice(i, i + BATCH).map((r) => `(${esc(r.code)}, ${esc(r.title)})`).join(', ');
      await q(`INSERT INTO _tmp_course_nature VALUES ${vals}`);
    }
    const res = await q(`
      UPDATE "courses" AS c
      SET "courseNature" = t.title
      FROM _tmp_course_nature AS t
      WHERE c."code" = t.code
        AND (c."courseNature" IS NULL OR c."courseNature" = '')`);
    console.log('updated courses:', res.rowCount ?? JSON.stringify(res));
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
