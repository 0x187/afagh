/**
 * گارد `scripts/verify-db-backup.mjs` — تأیید امضا بدون بارگذاری کل فایل در حافظه.
 * فایل واقعی پروداکشن ~۶۳۹ مگابایت است؛ readFileSync().toString() شکست میخورد.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { SignedBodyWriter, backupSigningKey } from '../src/lib/backup-signing';

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};

const PII = 't'.repeat(64);
const script = join(process.cwd(), 'scripts/verify-db-backup.mjs');
const dir = mkdtempSync(join(tmpdir(), 'afagh-verify-'));

function signedFile(key = backupSigningKey({ AFAGH_PII_KEY: PII }).key): Buffer {
  const w = new SignedBodyWriter(key);
  const parts: Buffer[] = [];
  // چند تکه، شامل متن فارسی و بکاسلش — امزا نباید به تقسیمبندی وابسته باشد.
  for (const text of [
    '-- AFAGH_BACKUP_MODE=dr-schema\n',
    '-- AFAGH_BACKUP_MANIFEST={"format":"afagh-dr/1"}\n',
    "INSERT INTO public.t (name) VALUES ('علی');\n",
    "INSERT INTO public.t (name) VALUES ('a\\\\b');\n",
  ]) {
    const b = w.push(text);
    if (b.length) parts.push(b);
  }
  parts.push(w.finish());
  return Buffer.concat(parts);
}

function run(file: string, env: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [script, file], {
    encoding: 'utf8',
    env: { ...process.env, AFAGH_BACKUP_SIGNING_KEY: '', AFAGH_PII_KEY: PII, ...env },
  });
}

try {
  const plain = signedFile();
  const gz = join(dir, 'backup.sql.gz');
  writeFileSync(gz, gzipSync(plain));
  const r = run(gz);
  ok(r.status === 0 && r.stdout.includes('SIGNATURE_MATCH=true'), 'فایل gzip سالم تأیید شد');
  ok(r.stdout.includes('KEY_SOURCE=derived-from-AFAGH_PII_KEY'), 'کلید مشتقشده گزارش شد');
  ok(r.stdout.includes('afagh-dr/1'), 'manifest از هدر استخراج شد');
  ok(/SQL_BYTES=\d+/.test(r.stdout), 'اندازة بدنه چاپ شد');

  const sql = join(dir, 'backup.sql');
  writeFileSync(sql, plain);
  const r2 = run(sql);
  ok(r2.status === 0 && r2.stdout.includes('SIGNATURE_MATCH=true'), 'فایل SQL فشردهزداییـشده هم تأیید شد');

  // دستکاری فقط در بدنه (نه خط امضا)
  const tampered = Buffer.from(plain);
  const at = tampered.indexOf(Buffer.from("'علی'"));
  tampered[at + 1] = tampered[at + 1] ^ 0x01;
  const bad = join(dir, 'bad.sql.gz');
  writeFileSync(bad, gzipSync(tampered));
  const r3 = run(bad);
  ok(r3.status !== 0 && r3.stdout.includes('SIGNATURE_MATCH=false'), 'دستکاری بدنه رد شد');

  const wrong = run(gz, { AFAGH_PII_KEY: 'w'.repeat(64) });
  ok(wrong.status !== 0 && wrong.stdout.includes('SIGNATURE_MATCH=false'), 'کلید اشتباه رد شد');

  const noSig = join(dir, 'nosig.sql');
  writeFileSync(noSig, plain.subarray(0, plain.length - 90));
  const r4 = run(noSig);
  ok(r4.status !== 0 && r4.stderr?.includes('یافت نشد'), 'نبود خط امضا رد شد');

  const noKey = run(gz, { AFAGH_PII_KEY: '' });
  ok(noKey.status === 3 && noKey.stderr?.includes('هیچ کلید'), 'نبود کلید امضا خطای مشخص میدهد');

  // ── گردش کلید: بکاپ قدیمی (مشتق) بعد از افزودن کلید صریح همچنان معتبر است ──
  const EXPLICIT = 'E'.repeat(48);
  const explicitKey = backupSigningKey({ AFAGH_BACKUP_SIGNING_KEY: EXPLICIT }).key;
  const withBoth = (file: string) => run(file, { AFAGH_BACKUP_SIGNING_KEY: EXPLICIT });

  const oldWithBoth = withBoth(gz);
  ok(oldWithBoth.status === 0 && oldWithBoth.stdout.includes('SIGNATURE_MATCH=true') &&
     oldWithBoth.stdout.includes('KEY_SOURCE=derived-from-AFAGH_PII_KEY'),
  'بکاپ قدیمی با هر دو کلید موجود تأیید شد (سازگاری عقبرَو)');

  const explicitGz = join(dir, 'explicit.sql.gz');
  writeFileSync(explicitGz, gzipSync(signedFile(explicitKey)));
  const newWithBoth = withBoth(explicitGz);
  ok(newWithBoth.status === 0 && newWithBoth.stdout.includes('KEY_SOURCE=explicit'),
    'بکاپ جدید با کلید صریح امضا و تأیید شد');
  const newWithoutExplicit = run(explicitGz, { AFAGH_BACKUP_SIGNING_KEY: '' });
  ok(newWithoutExplicit.status !== 0 && newWithoutExplicit.stdout.includes('KEY_SOURCE=none'),
    'بکاپ جدید بدون کلید صریح رد میشود (هیچ جایگزین پنهانی نیست)');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} قبول / ${fail} رد`);
if (fail) process.exit(1);
