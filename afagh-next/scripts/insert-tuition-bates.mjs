#!/usr/bin/env node
/**
 * درج تخفیفِ «بیتس» قدیمی در دفتر مالی — نوع TUITION_BATES
 *
 * راستی‌آزمایی (verify-legacy-rial.mjs) نشان داد تفاوت ریالیِ باقی‌مانده دقیقاً
 * برابر ستون‌های Fix_Bates + Units_Bates + Mab_Bates در TermAms است:
 *   delta = our − expected = −bates
 * یعنی سمت ما (فقط Fix_Price + Units_Price) به ازای هر (دانشجو، ترّم)
 * به اندازهٔ bates کمتر شارژ شده. با درج یک ردیف TUITION_BATES به مقدار
 * +bates، تراز ریالی صفر می‌شود.
 *
 * قاعدهٔ قدیمی: TermAcc = TermPays − (fix+units+bates) + adjust
 *   → تراز موردانتظار ما = (fix+units+bates) − پرداخت‌ها
 *
 * idempotent: dedupe با (referenceId = TermAmsId, transactionType) — دقیقاً
 * همان الگوی مهاجرت اصلی (migrate-legacy-finance.mjs). اجرای تکراری چیزی
 * اضافه نمی‌کند.
 *
 * اجرا (روی سرور، مثل verify):
 *   node insert-tuition-bates.mjs --dir /tmp/lp2v2/fin_export_uems --uni 1 \
 *     --db-host <ip>            # بدون --dry → درج واقعی
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const raw = process.argv.slice(2);
const args = {};
for (let i = 0; i < raw.length; i++) { if (raw[i].startsWith('--')) { const k = raw[i].slice(2); args[k] = (raw[i+1] && !raw[i+1].startsWith('--')) ? raw[++i] : 'true'; } }
const UNI = Number(args.uni || 1);
const DIR = args.dir || '/tmp/lp2v2/fin_export_uems';
const DB_ENV = args['db-env'] || '/root/afagh/.env';
const DB_HOST = args['db-host'] || '172.20.0.3';
const DRY = 'dry' in args;

const req = createRequire(resolve(DIR, '..', 'package.json'));
const { Pool } = req('pg');
const envTxt = readFileSync(DB_ENV, 'utf8');
const m = envTxt.match(/^POSTGRES_PASSWORD=(.*)$/m);
const pool = new Pool({ host: DB_HOST, port: 5432, user: 'afagh', password: m[1].replace(/\r$/, ''), database: 'afagh_db', max: 5 });
const q = async (t, p) => (await pool.query(t, p)).rows;

const readTsv = (name) => {
  const p = join(DIR, name);
  if (!existsSync(p)) throw new Error('missing ' + p);
  const txt = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  const lines = txt.split(/\r?\n/).filter(l => l.trim() !== '');
  const header = lines[0].split('\t');
  return { header, rows: lines.slice(1).map(l => l.split('\t')) };
};
const col = (row, header, ...names) => {
  for (const n of names) { const i = header.indexOf(n); if (i >= 0 && i < row.length) return String(row[i] ?? '').trim(); }
  return '';
};
const num = (s) => { const v = Number(String(s ?? '').replace(/[,\s]/g, '')); return Number.isFinite(v) ? v : 0; };
const toOurTerm = (legacy) => { const s = String(legacy ?? '').trim(); if (/^\d{3}$/.test(s)) return '13' + s; if (/^\d{4}$/.test(s)) return '1' + s; return s; };

(async () => {
  const students = await q('SELECT id, "studentCode" FROM students WHERE "universityId"=$1', [UNI]);
  const stuById = new Map(students.map(r => [String(r.studentCode), Number(r.id)]));
  const terms = await q('SELECT id, "termCode" FROM academic_terms WHERE "universityId"=$1', [UNI]);
  const termById = new Map(terms.map(r => [String(r.termCode), Number(r.id)]));

  const tams = readTsv('TermAms.tsv');

  const stat = { rows: tams.rows.length, insert: 0, skipZero: 0, skipNoStudent: 0, skipNoTerm: 0, dup: 0, sum: 0, badRef: 0 };

  // پیش‌شمارش: چه چیزی اضافه می‌شود (برای dry هم خروجی کامل است)
  const planned = [];
  for (const r of tams.rows) {
    const stno = col(r, tams.header, 'StnO', 'Stno');
    const sid = stuById.get(stno);
    const tid = termById.get(toOurTerm(col(r, tams.header, 'TermCode')));
    const bates = num(col(r, tams.header, 'Fix_Bates')) + num(col(r, tams.header, 'Units_Bates')) + num(col(r, tams.header, 'Mab_Bates'));
    const amsId = col(r, tams.header, 'TermAmsId');
    if (!sid) { stat.skipNoStudent++; continue; }
    if (!tid) { stat.skipNoTerm++; continue; }
    if (!bates) { stat.skipZero++; continue; }
    const ref = Number(amsId);
    const refSafe = Number.isSafeInteger(ref) && ref >= 0 && ref <= 2000000000 ? ref : null;
    if (refSafe === null) stat.badRef++;
    planned.push({ sid, tid, bates, refSafe, amsId });
  }

  // idempotency: قبلاً درج‌شده‌ها را حذف کن (همان dedoku با referenceId+type)
  // یک کوئری واحد برای کل نوع (نه به‌ازای هر ref)
  const have = new Set();
  {
    const rows = await q(`SELECT DISTINCT "referenceId" FROM student_ledger WHERE "transactionType"='TUITION_BATES' AND "referenceId" IS NOT NULL AND "universityId"=$1`, [UNI]);
    for (const x of rows) have.add(Number(x.referenceId));
  }
  // + بررسی ایمنی per-(student,term) برای ردیف‌های بدون ref معتبر
  const existingKeys = new Set();
  if (planned.some(p => p.refSafe === null)) {
    const ex = await q(`SELECT "studentId","termId" FROM student_ledger WHERE "transactionType"='TUITION_BATES' AND "universityId"=$1`, [UNI]);
    for (const e of ex) existingKeys.add(`${e.studentId}|${e.termId}`);
  }

  console.log(`== INSERT TUITION_BATES (uni ${UNI}) ${DRY ? '[DRY]' : '[APPLY]'} ==`);
  console.log(`planned rows: ${planned.length}  sum(rial): ${planned.reduce((a, p) => a + p.bates, 0).toLocaleString('en')}`);
  console.log(`already inserted (by ref): ${have.size}`);

  if (DRY) {
    const todo = planned.filter(p => p.refSafe === null ? !existingKeys.has(`${p.sid}|${p.tid}`) : !have.has(p.refSafe));
    console.log(`todo after dedupe: ${todo.length}  sum(rial): ${todo.reduce((a, p) => a + p.bates, 0).toLocaleString('en')}`);
    for (const t of todo.slice(0, 10)) console.log(`  sid=${t.sid} tid=${t.tid} bates=${t.bates} ref=${t.amsId}`);
    await pool.end();
    return;
  }

  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    for (const p of planned) {
      if (p.refSafe !== null) {
        if (have.has(p.refSafe)) { stat.dup++; continue; }
      } else {
        if (existingKeys.has(`${p.sid}|${p.tid}`)) { stat.dup++; continue; }
      }
      await tx.query(
        `INSERT INTO student_ledger ("studentId","termId","transactionType",amount,description,"referenceId","universityId")
         VALUES ($1,$2,'TUITION_BATES',$3,$4,$5,$6)`,
        [p.sid, p.tid, p.bates, `تخفیف بیتس (سما) (TermAms id=${p.amsId})`, p.refSafe, UNI],
      );
      stat.insert++;
      stat.sum += p.bates;
    }
    await tx.query('COMMIT');
  } catch (e) { await tx.query('ROLLBACK'); throw e; } finally { tx.release(); }

  console.log(`inserted: ${stat.insert}  skipped-dup: ${stat.dup}  skipZero: ${stat.skipZero}  skipNoStudent: ${stat.skipNoStudent}  skipNoTerm: ${stat.skipNoTerm}  badRef: ${stat.badRef}`);
  console.log(`sum inserted (rial): ${stat.sum.toLocaleString('en')}`);
  await pool.end();
})().catch(e => { console.error('FATAL', e); try { pool.end(); } catch {} process.exit(1); });
