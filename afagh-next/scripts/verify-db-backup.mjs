#!/usr/bin/env node
/**
 * تأیید امضای پشتیبان SQL پیش از بازیابی (خط فرمان، کاملاً جریانی).
 *
 *   node scripts/verify-db-backup.mjs backup.sql.gz
 *   node scripts/verify-db-backup.mjs backup.sql
 *
 * چرا جریانی؟ دامپ پروداکشن ~۶۳۹ مگابایت است؛ `readFileSync().toString()`
 * دقیقاً همان خطای «Invalid string length»ای را میدهد که دامپ قدیمی را شکست.
 * این اسکریپت فقط ۱ کیلوبایت انتهای فایل را نگه میدارد و HMAC را افزایشی
 * روی بایتها حساب میکند.
 *
 * کلید: AFAGH_BACKUP_SIGNING_KEY، وگرنه HMAC-SHA256(AFAGH_PII_KEY,
 * "afagh/backup/signature/v1") — همان منطق `src/lib/backup-signing.ts`.
 */
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createHmac, timingSafeEqual } from 'node:crypto';

const DOMAIN = 'afagh/backup/signature/v1';
const MARKER = /\n-- AFAGH_BACKUP_SIGNATURE=([a-f0-9]{64})\r?\n?$/;

const path = process.argv[2];
if (!path) {
  console.error('استفاده: node scripts/verify-db-backup.mjs <backup.sql.gz|backup.sql>');
  process.exit(2);
}

function signingKey() {
  const explicit = (process.env.AFAGH_BACKUP_SIGNING_KEY ?? '').trim();
  if (explicit.length >= 32 && !explicit.startsWith('CHANGE_ME_')) {
    return { key: Buffer.from(explicit, 'utf8'), source: 'explicit' };
  }
  const pii = (process.env.AFAGH_PII_KEY ?? '').trim();
  if (pii.length >= 32) {
    return {
      key: createHmac('sha256', Buffer.from(pii, 'utf8')).update(DOMAIN).digest(),
      source: 'derived-from-AFAGH_PII_KEY',
    };
  }
  throw new Error('هیچ کلید امضایی یافت نشد: AFAGH_BACKUP_SIGNING_KEY یا AFAGH_PII_KEY را تنظیم کنید.');
}

let key, keySource;
try {
  ({ key, source: keySource } = signingKey());
} catch (e) {
  console.error('SIGNATURE_MATCH=false');
  console.error('ERROR=' + e.message);
  process.exit(3);
}

const hmac = createHmac('sha256', key);
let tail = Buffer.alloc(0);          // بایتهایی که هنوز HMAC نشدهاند
let sqlBytes = 0;                    // اندازة بدنة SQL (بدون خط امضا)
let found = null;                    // هگز امضای یافتشده
let manifest = null;
const KEEP = 1024;

const source = createReadStream(path);
const stream = path.toLowerCase().endsWith('.gz') ? source.pipe(createGunzip()) : source;

try {
  for await (const chunk of stream) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const combined = tail.length ? Buffer.concat([tail, b]) : b;
    const text = combined.toString('utf8');
    if (!manifest) {
      const m = /-- AFAGH_BACKUP_MANIFEST=(\{[^\n]*\})/.exec(text);
      if (m) manifest = m[1];
    }
    const match = MARKER.exec(text);
    if (match) {
      const bodyBytes = Buffer.byteLength(text.slice(0, match.index), 'utf8');
      hmac.update(combined.subarray(0, bodyBytes));
      sqlBytes += bodyBytes;
      found = match[1];
      tail = Buffer.alloc(0);
      break;
    }
    // فقط KEEP بایت آخر را نگه میداریم؛ بقیه وارد HMAC میشوند.
    if (combined.length > KEEP) {
      const cut = combined.length - KEEP;
      hmac.update(combined.subarray(0, cut));
      sqlBytes += cut;
      tail = Buffer.from(combined.subarray(cut));
    } else {
      tail = Buffer.from(combined);
    }
  }
  if (!found) {
    // ممکن است امضا در همان KEEP بایت انتهایی مانده باشد.
    const m = MARKER.exec(tail.toString('utf8'));
    if (m) {
      const bodyBytes = Buffer.byteLength(tail.toString('utf8').slice(0, m.index), 'utf8');
      hmac.update(tail.subarray(0, bodyBytes));
      sqlBytes += bodyBytes;
      found = m[1];
    }
  }
} catch (e) {
  console.error('SIGNATURE_MATCH=false');
  console.error('ERROR=' + (e.message ?? String(e)));
  process.exit(4);
}

if (!found) {
  console.error('SIGNATURE_MATCH=false');
  console.error('ERROR=خط امضای AFAGH_BACKUP_SIGNATURE یافت نشد (فایل ناقص یا دستکاریشده).');
  process.exit(5);
}

const expected = hmac.digest();
const supplied = Buffer.from(found, 'hex');
const ok = supplied.length === expected.length && timingSafeEqual(supplied, expected);

console.log(`KEY_SOURCE=${keySource}`);
console.log(`SQL_BYTES=${sqlBytes}`);
console.log(`SIGNATURE=${found}`);
if (manifest) console.log(`MANIFEST=${manifest}`);
console.log(`SIGNATURE_MATCH=${ok}`);
process.exit(ok ? 0 : 6);
