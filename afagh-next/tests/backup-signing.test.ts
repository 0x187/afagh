/**
 * ════════════════════════════════════════════════════════════════════════
 *  گاردِ دامپ جریانی و امضای پشتیبان — src/lib/backup-signing.ts
 *
 *  چرا وجود دارد:
 *    دیتابیس پروداکشن ~۱ گیگابایت است و نسخۀ قبلی کل SQL را در یک رشتۀ JS
 *    میساخت ⇒ «Invalid string length». دامپ جدید قطعهقطعه نوشته میشود و امضا
 *    افزایشی حساب میگردد. این تست تضمین میکند:
 *      • فرمت خروجی دقیقاً همان چیزی است که restore قدیمی میپذیرد،
 *      • تقسیمقطعهبندی روی امضا/بایتها بیتأثیر است،
 *      • کلید مشتقشده از AFAGH_PII_KEY پایدار و از کلید خام جداست،
 *      • دستکاری/حذف امضا و فایل بیشازحد رد میشود.
 * ════════════════════════════════════════════════════════════════════════
 */
import { createHmac } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import {
  backupSigningKey, SignedBodyWriter, verifySignedBackup,
  BACKUP_SIGNATURE_MARKER,
  MISSING_SIGNING_KEY_ERROR, INVALID_BACKUP_SIZE_ERROR,
  MISSING_SIGNATURE_ERROR, BAD_SIGNATURE_ERROR,
} from '../src/lib/backup-signing';

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};

function signed(textChunks: string[], key: Buffer): { file: string; body: string } {
  const w = new SignedBodyWriter(key);
  const parts: Buffer[] = [];
  for (const c of textChunks) {
    const b = w.push(c);
    if (b.length) parts.push(b);
  }
  parts.push(w.finish());
  return { file: Buffer.concat(parts).toString('utf8'), body: '' };
}

function expectThrow(fn: () => unknown, msg: string): boolean {
  try { fn(); return false; } catch (e) {
    return e instanceof Error && e.message === msg;
  }
}

const explicit = backupSigningKey({ AFAGH_BACKUP_SIGNING_KEY: 'K'.repeat(48) });
const derived = backupSigningKey({ AFAGH_PII_KEY: 'P'.repeat(64) });

console.log('— منبع کلید امضا —');
ok(explicit.source === 'explicit' && explicit.key.equals(Buffer.from('K'.repeat(48))), 'کلید صریح همان مقدار env است');
ok(derived.source === 'derived', 'نبود متغیر اختصاصی ⇒ مشتق از AFAGH_PII_KEY');
ok(derived.key.length === 32, 'کلید مشتقشده ۳۲ بایت (خروجی HMAC-SHA256) است');
ok(!derived.key.equals(Buffer.from('P'.repeat(64)).subarray(0, 32)), 'کلید مشتقشده برش خام PII_KEY نیست');
ok(
  derived.key.equals(createHmac('sha256', Buffer.from('P'.repeat(64), 'utf8')).update('afagh/backup/signature/v1').digest()),
  'مشتقگیری پایدار و با جداسازی دامنه است',
);
ok(backupSigningKey({ AFAGH_PII_KEY: 'P'.repeat(64) }).key.equals(derived.key), 'دو فراخوانی کلید یکسان میدهند (امضا قابل تأیید میماند)');
ok(
  backupSigningKey({ AFAGH_BACKUP_SIGNING_KEY: 'CHANGE_ME_' + 'x'.repeat(40), AFAGH_PII_KEY: 'P'.repeat(64) }).source === 'derived',
  'مقدار CHANGE_ME_ نادیده گرفته میشود',
);
ok(expectThrow(() => backupSigningKey({}), MISSING_SIGNING_KEY_ERROR), 'نبود هر دو راز ⇒ خطای مشخص');

console.log('\n— امضای افزایشی و قالب فایل —');
const bodyChunks = [
  '-- ═══ پشتیبان آفاق ═══\n',
  'DROP TABLE IF EXISTS "students" CASCADE;\n',
  'CREATE TABLE "students" (\n  "id" integer NOT NULL\n);\n\n',
  'INSERT INTO "students" ("id") VALUES\n(1),\n(2),\n(3);\n',
  "INSERT INTO \"students\" (\"id\") VALUES\n(4); -- نام: زهرا\\true\n",
  '\n\n',
];
const rawBody = bodyChunks.join('').replace(/\r?\n+$/, '');
const one = signed([bodyChunks.join('')], explicit.key);
const many = signed(bodyChunks, explicit.key);

ok(one.file === many.file, 'تقسیم قطعات هیچ اثری بر فایل نهایی/امضا ندارد');
ok(one.file.includes(BACKUP_SIGNATURE_MARKER), 'نشانگر امضا در انتهای فایل حضور دارد');
ok(/\r?\n-- AFAGH_BACKUP_SIGNATURE=[a-f0-9]{64}\r?\n?$/.test(one.file), 'قالب امضا با رگولار قدیمی restore همخوان است');
ok(one.file.startsWith(rawBody), 'بدنۀ ذخیرهشده دقیقاً همان بدنۀ بدون newline انتهایی است');
ok(one.file.slice(0, rawBody.length) === rawBody, 'هیچ بایت اضافهای پیش از نشانگر نیست');
ok(verifySignedBackup(one.file, explicit.key) === rawBody, 'تأیید امضا بدنۀ اصلی را برمیگرداند');
ok(one.file.includes('زهرا') && one.file.includes('true'), 'محتوای فارسی/رشتههای escaped بایتبهبایت حفظ میشوند');

console.log('\n— رد کردن فایلهای مخرب —');
ok(expectThrow(() => verifySignedBackup(one.file.replace('(1)', '(9)'), explicit.key), BAD_SIGNATURE_ERROR), 'دستکاری محتوا ⇒ امضا رد میشود');
ok(expectThrow(() => verifySignedBackup(rawBody + '\n', explicit.key), MISSING_SIGNATURE_ERROR), 'فایل بدون امضا رد میشود');
ok(expectThrow(() => verifySignedBackup(one.file, derived.key), BAD_SIGNATURE_ERROR), 'امضا با کلید دیگر رد میشود');
ok(expectThrow(() => verifySignedBackup(one.file, explicit.key, 16), INVALID_BACKUP_SIZE_ERROR), 'سقف حجم اعمال میشود');

console.log('\n— جریان قطعات کوچک (شبیهسازی FETCH cursor) —');
const manyPages: string[] = [];
for (let i = 0; i < 2000; i++) manyPages.push(`INSERT INTO "legacy_grades" ("id") VALUES\n(${i});\n`);
const streamed = signed(manyPages, derived.key);
const streamedBody = manyPages.join('').replace(/\r?\n+$/, '');
ok(streamed.file.length > 0 && verifySignedBackup(streamed.file, derived.key) === streamedBody, '۲۰۰۰ قطعه بدون ساخت رشتۀ واحد امضا میشود و تأیید میگردد');

// همان زنجیرۀ واقعی startDatabaseBackupAction: ژنراتور → Readable.from
// (objectMode:false) → gzip → فایل/شبکه. اگر objectMode یا finally ژنراتور
// اشتباه باشد، pipeline آویزان میماند یا امضا ناقص میشود.
async function roundTripGzip(chunks: string[], key: Buffer): Promise<string> {
  const w = new SignedBodyWriter(key);
  const gen = async function* (): AsyncGenerator<Buffer> {
    for (const c of chunks) {
      const b = w.push(c);
      if (b.length) yield b;
    }
    yield w.finish();
  };
  const out: Buffer[] = [];
  await pipeline(
    Readable.from(gen(), { objectMode: false }),
    createGzip({ level: 1 }),
    createGunzip(),
    new Writable({
      write(chunk: Buffer, _enc, cb) { out.push(Buffer.from(chunk)); cb(); },
    }),
  );
  return Buffer.concat(out).toString('utf8');
}

async function main() {
  console.log('\n— زنجیرۀ جریانی واقعی (gzip + pipeline) —');
  const viaStream = await roundTripGzip(bodyChunks, explicit.key);
  ok(viaStream === one.file, 'خروجی پس از gzip/gunzip بایتبهبایت با فایل مستقیم یکی است');
  ok(verifySignedBackup(viaStream, explicit.key) === rawBody, 'امضا پس از عبور از pipeline جریانی معتبر میماند');

  let finalized = false;
  const broken = async function* (): AsyncGenerator<Buffer> {
    try { yield Buffer.from('partial'); throw new Error('boom'); }
    finally { finalized = true; }
  };
  let threw = false;
  try {
    await pipeline(Readable.from(broken(), { objectMode: false }), new Writable({
      write(_c, _e, cb) { cb(); },
    }));
  } catch { threw = true; }
  ok(threw && finalized, 'خطای میانراه جریان را نابود و finally ژنراتور را اجرا میکند (آزادسازی اتصال DB)');

  console.log(`\n${pass} قبول / ${fail} رد`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
