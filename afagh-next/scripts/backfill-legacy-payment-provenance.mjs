#!/usr/bin/env node
/**
 * backfill-legacy-payment-provenance.mjs
 * بک‌فیلِ مستندسازت پرداختِ مهاجرت‌یافته از سیستم قدیمی (سما) به student_ledger.
 *
 * ورودی: فایل TSV حاصل از export-sama-payment-provenance.sql
 *   (ستون‌ها: stdpaysId, payerName, payerNationalCode, receiptNo, voucherNo,
 *    payTypeCode, accountNo, bankName, branchName, recorderCode, recorderName, legacyRem)
 *
 * منطق:
 *   • شماره کارت (cardNo) از longest digit-run ≥ ۱۲ رقم درون legacyRem استخراج می‌شود.
 *   • UPDATE فقط ستون‌هایی را پر می‌کند که مقدار منبع nonempty باشد
 *     (بنابراین اجرای مجدد بی‌ضرر / idempotent است).
 *   • فقط روی ردیف‌های PAYMENT / POS_PAYMENT با referenceId معتبر اثر می‌گذارد.
 *
 * اجرا:
 *   node scripts/backfill-legacy-payment-provenance.mjs --tsv <path> --dry-run
 *   node scripts/backfill-legacy-payment-provenance.mjs --tsv <path> --apply \
 *        --db-env /root/afagh/.env --db-host 172.20.0.3
 */

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const raw = process.argv.slice(2);
const args = {};
for (let i = 0; i < raw.length; i++) {
  if (raw[i].startsWith('--')) {
    const k = raw[i].slice(2);
    args[k] = (raw[i + 1] && !raw[i + 1].startsWith('--')) ? raw[++i] : 'true';
  }
}
const APPLY = args.apply === 'true';
const TSV = args.tsv || resolve(process.cwd(), 'scripts/legacy-payment-provenance.tsv');
const DB_ENV = args['db-env'] || '/root/afagh/.env';
const DB_HOST = args['db-host'] || '172.20.0.3';

const COLS = [
  'stdpaysId', 'payerName', 'payerNationalCode', 'receiptNo', 'voucherNo',
  'payTypeCode', 'accountNo', 'bankName', 'branchName', 'recorderCode',
  'recorderName', 'legacyRem',
];

function parseCardNo(rem) {
  if (!rem) return '';
  const runs = rem.match(/\d{12,19}/g) || [];
  if (!runs.length) return '';
  return runs.sort((a, b) => b.length - a.length)[0];
}

function readTsv(path) {
  if (!existsSync(path)) throw new Error('TSV not found: ' + path);
  const txt = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = txt.split(/\r?\n/).filter((l) => l.trim() !== '');
  // ردیف سرآیندِ sqlcmd (نام ستون‌ها، بدون تب) رد می‌شود؛ خطوط بی‌تب = ۱ ستون < ۱۲
  const rows = [];
  for (const line of lines) {
    const p = line.split('\t');
    if (p.length < COLS.length) continue;
    const o = {};
    COLS.forEach((c, i) => (o[c] = (p[i] ?? '').trim()));
    o.cardNo = parseCardNo(o.legacyRem);
    o.stdpaysId = Number(o.stdpaysId);
    if (!Number.isFinite(o.stdpaysId)) continue;
    rows.push(o);
  }
  return rows;
}

function stat(rows) {
  const n = rows.length;
  const c = (f) => rows.filter(f).length;
  console.log(`ردیف‌های معتبر: ${n}`);
  console.log(`دارای کارت استخراجی: ${c((r) => r.cardNo)} (${((100 * c((r) => r.cardNo)) / n).toFixed(1)}%)`);
  console.log(`دارای نام پرداخت‌کننده: ${c((r) => r.payerName)}`);
  console.log(`دارای شماره سند: ${c((r) => r.voucherNo)}`);
  console.log(`دارای شماره حساب: ${c((r) => r.accountNo)}`);
  console.log(`دارای یادداشت (Rem): ${c((r) => r.legacyRem)}`);
  const pt = {};
  for (const r of rows) pt[r.payTypeCode] = (pt[r.payTypeCode] || 0) + 1;
  console.log('توزیع payTypeCode:', pt);
  console.log('نمونهٔ ۳ ردیف (فیش | کارت | حساب | پرداخت‌کننده):');
  for (const r of rows.slice(0, 3))
    console.log(`  ${r.receiptNo} | ${r.cardNo} | ${r.accountNo} | ${r.payerName}`);
}

const esc = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;
const numOrNull = (s) => (s === '' || s == null ? 'NULL' : `${Number(s)}`);

(async () => {
  const rows = readTsv(TSV);
  stat(rows);

  if (!APPLY) {
    console.log('\n[DRY-RUN] بدون تغییر پایگاه‌داده خارج شد. برای اعمال --apply بزنید.');
    return;
  }

  const req = createRequire(resolve(process.cwd(), 'package.json'));
  const { Pool } = req('pg');
  // رمز از فایل env یا (در کانتینر) از متغیر محیطی
  let pw = process.env.POSTGRES_PASSWORD || '';
  if (existsSync(DB_ENV)) {
    const m = readFileSync(DB_ENV, 'utf8').match(/^POSTGRES_PASSWORD=(.*)$/m);
    if (m) pw = m[1].replace(/\r$/, '');
  }
  if (!pw) throw new Error('POSTGRES_PASSWORD not found (env or ' + DB_ENV + ')');
  const pool = new Pool({
    host: DB_HOST, port: 5432, user: 'afagh',
    password: pw, database: 'afagh_db', max: 5,
  });
  const q = async (t, p) => (await pool.query(t, p)).rows;

  try {
    await q(`CREATE INDEX IF NOT EXISTS idx_student_ledger_ref_type
             ON student_ledger ("referenceId", "transactionType")`);
    console.log('index ensured');

    await q(`DROP TABLE IF EXISTS _tmp_pay_prov`);
    // شناسه‌ها باید نقل‌قول‌شده باشند وگرنه Postgres آن‌ها را lowercase می‌کند
    // (payerName → payername) و UPDATEِ camelCase نمی‌تواند به آن‌ها ارجاع دهد.
    await q(`CREATE TEMP TABLE _tmp_pay_prov (
      "stdpaysId" bigint PRIMARY KEY, "payerName" varchar(120), "payerNationalCode" varchar(12),
      "receiptNo" varchar(40), "voucherNo" varchar(80), "payTypeCode" integer, "accountNo" varchar(30),
      "cardNo" varchar(30), "bankName" varchar(60), "branchName" varchar(60), "recorderCode" integer,
      "recorderName" varchar(120), "legacyRem" text)`);

    // درج دسته‌ای (هر ۲۰۰۰ ردیف یک VALUES) + ON CONFLICT برای تحمل ردیف‌های تکراری
    const BATCH = 2000;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const vals = chunk
        .map(
          (r) =>
            `(${r.stdpaysId}, ${esc(r.payerName)}, ${esc(r.payerNationalCode)}, ${esc(r.receiptNo)}, ` +
            `${esc(r.voucherNo)}, ${numOrNull(r.payTypeCode)}, ${esc(r.accountNo)}, ${esc(r.cardNo)}, ` +
            `${esc(r.bankName)}, ${esc(r.branchName)}, ${numOrNull(r.recorderCode)}, ${esc(r.recorderName)}, ${esc(r.legacyRem)})`,
        )
        .join(', ');
      await q(`INSERT INTO _tmp_pay_prov VALUES ${vals} ON CONFLICT ("stdpaysId") DO NOTHING`);
    }
    console.log('temp table loaded:', rows.length);

    const res = await q(`
      UPDATE "student_ledger" AS l
      SET
        "payerName"         = COALESCE(NULLIF(t."payerName", ''), l."payerName"),
        "payerNationalCode" = COALESCE(NULLIF(t."payerNationalCode", ''), l."payerNationalCode"),
        "receiptNo"         = COALESCE(NULLIF(t."receiptNo", ''), l."receiptNo"),
        "voucherNo"         = COALESCE(NULLIF(t."voucherNo", ''), l."voucherNo"),
        "payTypeCode"       = COALESCE(t."payTypeCode", l."payTypeCode"),
        "accountNo"         = COALESCE(NULLIF(t."accountNo", ''), l."accountNo"),
        "cardNo"            = COALESCE(NULLIF(t."cardNo", ''), l."cardNo"),
        "bankName"          = COALESCE(NULLIF(t."bankName", ''), l."bankName"),
        "branchName"        = COALESCE(NULLIF(t."branchName", ''), l."branchName"),
        "recorderCode"      = COALESCE(t."recorderCode", l."recorderCode"),
        "recorderName"      = COALESCE(NULLIF(t."recorderName", ''), l."recorderName"),
        "legacyRem"         = COALESCE(NULLIF(t."legacyRem", ''), l."legacyRem")
      FROM _tmp_pay_prov AS t
      WHERE l."referenceId" = t."stdpaysId"
        AND l."transactionType" IN ('PAYMENT', 'POS_PAYMENT')`);
    console.log('updated rows:', res.rowCount ?? JSON.stringify(res));
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
