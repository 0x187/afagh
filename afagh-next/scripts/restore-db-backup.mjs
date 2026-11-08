#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════
 *  بازیابی امنِ بکاپ DR — جایگزین `gunzip -c … | psql` خام
 *
 *      node scripts/restore-db-backup.mjs backup.sql.gz --yes
 *      node scripts/restore-db-backup.mjs backup.sql.gz --dry-run
 *
 *  پیش از آنکه حتی یک دستور SQL اجرا شود:
 *    ۱) امضای HMAC کل فایل بهصورت جریانی تأیید میشود (verify-db-backup.mjs).
 *    ۲) هدر چک میشود که واقعاً بکاپ «کامل ساختاری» (`afagh-dr/1`) باشد.
 *    ۳) مقصد باید دیتابیس تازه/خالی باشد؛ در غیر اینصورت بدون `--force` رد میشود.
 *    ۴) تأیید صریح `--yes` لازم است (جلوگیری از اجرای تصادفی روی پروداکشن).
 *
 *  فایل هرگز به رشتۀ JS تبدیل نمیشود: استریم gzip مستقیم به stdin پsql میرود.
 *  مقادیر env:  AFAGH_BACKUP_SIGNING_KEY و AFAGH_PII_KEY (هر دو از .env سرور)،
 *  و DATABASE_URL (یا --database-url=...). برای اجرا درون کانتینر Postgres:
 *      docker exec -i afagh_pg psql "postgres://…"   ← psql باید در PATH باشد
 *
 *  کدهای خروج: ۰ موفق · ۲ استفاده · ۳ فایل · ۴ قالب · ۵ امضا · ۶ تأیید ·
 *               ۷ نشانی DB · ۸ psql · ۹ مقصد ناخالی · ۱۰ اجرای psql / جریان
 * ════════════════════════════════════════════════════════════════════════
 */
import { createReadStream, existsSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY = join(HERE, 'verify-db-backup.mjs');
const DR_MARKER = '-- AFAGH_BACKUP_MODE=dr-schema';

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const hit = args.find(a => a.startsWith(flag + '='));
  return hit ? hit.slice(flag.length + 1) : '';
};

const HELP = [
  'استفاده: node scripts/restore-db-backup.mjs <backup.sql.gz|backup.sql> [گزینهها]',
  '',
  'گزینهها:',
  '  --yes                 تأیید صریح بازیابی (الزامی، مگر --dry-run)',
  '  --dry-run             فقط تأیید امضا/قالب/مقصد؛ هیچ SQL اجرا نمیشود',
  '  --force               اجازهٔ بازیابی روی دیتابیس غیرخالی (خطرناک)',
  '  --database-url=URL    نشانی مقصد (پیشفرض: DATABASE_URL)',
  '  --psql=PATH           مسیر باینری psql (پیشفرض: psql در PATH)',
  '',
  'مقصد همیشه باید دیتابیس تازه باشد: این فایل اسکیمای public/drizzle را DROP میکند.',
].join('\n');

function die(code, message) {
  console.error('RESTORE_RESULT=ABORTED');
  console.error('ERROR=' + message);
  process.exit(code);
}

if (has('--help') || has('-h')) { console.log(HELP); process.exit(0); }
const file = positional[0];
if (!file) { console.error(HELP); process.exit(2); }
if (!existsSync(file)) die(3, 'فایل پشتیبان یافت نشد: ' + file);
if (!/\.(?:sql|gz|sql\.gz)$/i.test(file)) die(4, 'پسوند فایل باید .sql یا .sql.gz باشد.');

const isGz = /\.gz$/i.test(file);
const psqlBin = valueOf('--psql') || 'psql';
const dbUrl = valueOf('--database-url') || process.env.DATABASE_URL || '';

// ── ۱) هدر: فقط بکاپ DR کامل مجاز است ───────────────────────────────────────
async function readHeader() {
  const src = createReadStream(file);
  const stream = isGz ? src.pipe(createGunzip()) : src;
  let head = '';
  try {
    for await (const chunk of stream) {
      head += (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).toString('utf8');
      if (head.length >= 8192) break;
    }
  } finally {
    stream.destroy?.();
    src.destroy?.();
  }
  return head;
}

let header = '';
try { header = await readHeader(); } catch (e) { die(4, 'خواندن هدر فایل ناموفق: ' + (e.message ?? String(e))); }
if (!header.includes(DR_MARKER)) {
  die(4, 'این فایل بکاپ کامل ساختاری (dr-schema) نیست؛ اسکریپت فقط بکاپهای DR جدید را بازیابی میکند.');
}

// ── ۲) امضا (جریانی، همان کلیدهای سرور) ────────────────────────────────────
const verify = spawnSync(process.execPath, [VERIFY, file], { encoding: 'utf8', env: process.env });
if (verify.status !== 0) {
  console.error(verify.stdout ?? '');
  console.error(verify.stderr ?? '');
  die(5, 'امضای پشتیبان تأیید نشد؛ هیچ دستور SQL اجرا نگردید.');
}
process.stdout.write(verify.stdout ?? '');
const manifestLine = /-- AFAGH_BACKUP_MANIFEST=(\{[^\n]*\})/.exec(header)?.[1];
if (manifestLine) {
  try { console.log('REDACTED=' + String(JSON.parse(manifestLine).redacted)); } catch { /* هدر ناقص، مشکلی نیست */ }
}

// ── ۳) تأیید صریح ──────────────────────────────────────────────────────────
if (!has('--yes') && !has('--dry-run')) {
  die(6, 'بازیابی تمام دادههای مقصد را جایگزین میکند؛ برای تأیید --yes را اضافه کنید (یا --dry-run).');
}
if (!dbUrl && !has('--dry-run')) {
  die(7, 'نشانی دیتابیس مقصد مشخص نیست: DATABASE_URL یا --database-url=... بدهید.');
}

// رمز عبور را از argv خارج میکنیم تا در `ps` دیده نشود؛ libpq آن را از PGPASSWORD میخواند.
const cred = /^([a-z]+:\/\/[^:/@]+):([^@]*)@(.*)$/i.exec(dbUrl);
const conn = cred ? `${cred[1]}@${cred[3]}` : dbUrl;
const pgEnv = cred?.[2] ? { PGPASSWORD: decodeURIComponent(cred[2]) } : {};

function runPsql(extraArgs, input) {
  return spawnSync(psqlBin, [conn, ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, ...pgEnv },
    input,
    maxBuffer: 4 * 1024 * 1024,
  });
}

// ── ۴) مقصد باید خالی باشد ─────────────────────────────────────────────────
if (dbUrl) {
  const probe = runPsql(['-tAc', "SELECT count(*) FROM pg_tables WHERE schemaname IN ('public','drizzle')"], '');
  if (probe.error || probe.status !== 0) {
    die(8, `اتصال/باینری psql در دسترس نیست (${probe.error?.code ?? 'exit ' + probe.status}). ` +
      'روی سرور میتوانید psql را از ایمیج afagh_pg اجرا کنید؛ مسیر آن را با --psql بدهید.');
  }
  const tables = Number(String(probe.stdout ?? '').trim().split(/\s+/)[0]);
  console.log('TARGET_PUBLIC_TABLES=' + (Number.isFinite(tables) ? tables : 'unknown'));
  if (Number.isFinite(tables) && tables > 0 && !has('--force')) {
    die(9, 'دیتابیس مقصد خالی نیست. بکاپ DR اسکیمای مقصد را پاک میکند؛ یک دیتابیس تازه بسازید یا با آگاهی کامل --force بدهید.');
  }
}

if (has('--dry-run')) {
  console.log('DRY_RUN_OK=yes');
  console.log('RESTORE_RESULT=NOT_ATTEMPTED');
  process.exit(0);
}

// ── ۵) اجرای جریانی: فایل → gunzip → stdin پsql ─────────────────────────────
console.warn('⚠ در حال بازیابی کامل؛ تمام دادهها و ساختار مقصد جایگزین میشود.');
const child = spawn(psqlBin, [conn, '-v', 'ON_ERROR_STOP=1', '--quiet'], {
  env: { ...process.env, ...pgEnv },
  stdio: ['pipe', 'inherit', 'inherit'],
});
const src = createReadStream(file);
const input = isGz ? src.pipe(createGunzip()) : src;

let streamError = null;
try {
  await pipeline(input, child.stdin);
} catch (e) {
  streamError = e;
  child.kill('SIGTERM');
}

const exitCode = await new Promise((resolve) => {
  if (child.exitCode !== null) return resolve(child.exitCode);
  child.once('error', () => resolve(-1));
  child.once('close', code => resolve(code ?? -1));
});

if (streamError) die(10, 'خطای جریان فایل/گشودن gzip: ' + (streamError.message ?? String(streamError)));
if (exitCode !== 0) die(10, `psql با کد ${exitCode} خارج شد؛ لاگ بالا را ببینید.`);
console.log('RESTORE_RESULT=OK');
console.log('گام بعد: مقادیر .env و بستهٔ minio-*.zip را برگردانید، سپس اپ را بالا بیاورید.');
process.exit(0);
