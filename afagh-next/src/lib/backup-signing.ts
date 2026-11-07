/**
 * ════════════════════════════════════════════════════════════════════════
 *  امضای پشتیبان دیتابیس — بدون نیاز به نگهداری کل دامپ در یک رشتۀ JS
 *
 *  دیتابیس پروداکشن ~۱ گیگابایت است؛ نسخۀ قبلی کل SQL را در یک رشته میساخت
 *  (`parts.join('\n')`) و V8 با «Invalid string length» شکست میخورد. این ماژول
 *  امضا را بهصورت افزایشی (HMAC روی همان بایتهایی که به فایل مینویسیم) محاسبه
 *  میکند، بنابراین حافظه ثابت میماند. قالب خروجی عمداً دقیقاً همان قالب قدیمی
 *  است تا `restoreDatabaseAction` و فایلهای موجود بدون تغییر بمانند:
 *
 *      <body، بدون newline انتهایی>\\n-- AFAGH_BACKUP_SIGNATURE=<hex64>\\n
 *
 *  نکته: newlineهای انتهایی بدنه نگه داشته میشوند و فقط در `finish` حذف
 *  میگردند (معادل `.replace(/\r?\n+$/, '')` قدیمی) تا امضا و بدنۀ ذخیرهشده
 *  بایتبهبایت یکسان باشند.
 * ════════════════════════════════════════════════════════════════════════
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const BACKUP_SIGNATURE_MARKER = '-- AFAGH_BACKUP_SIGNATURE=';

/** جداسازی دامنه: کلید مشتقشده هرگز با کلید خام AFAGH_PII_KEY یکی نیست. */
export const BACKUP_SIGNING_DOMAIN = 'afagh/backup/signature/v1';

export const MISSING_SIGNING_KEY_ERROR = 'کلید امضای پشتیبان تنظیم نشده است؛ بازیابی امن غیرفعال است.';
export const INVALID_BACKUP_SIZE_ERROR = 'فایل پشتیبان نامعتبر یا بزرگ‌تر از حد مجاز است.';
export const MISSING_SIGNATURE_ERROR = 'پشتیبان امضای معتبر ندارد؛ بازیابی فایل‌های قدیمی و امضانشده مجاز نیست.';
export const BAD_SIGNATURE_ERROR = 'امضای پشتیبان معتبر نیست؛ هیچ دستوری اجرا نشد.';

export type SigningKeySource = 'explicit' | 'derived';

/**
 * کلید امضا: `AFAGH_BACKUP_SIGNING_KEY` اگر تنظیم و معتبر باشد؛ وگرنه مشتقی
 * پایدار از `AFAGH_PII_KEY` (رازی که در همة استقرارها داخل کانتینر app هست).
 *
 * چرا fallback: در پروداکشن متغیر اختصاصی خالی است و در docker-compose هم
 * عبور داده نشده؛ بدون آن هیچ پشتیبان SQLـای تاکنون ساخته نشده بود (signBackup
 * همیشه throw میکرد). مشتقگیری با HMAC + جداسازی دامنه، وابستگی به ویرایش
 * دستی `.env` سرور را حذف میکند و در عین حال کلید خام PII را افشا نمیکند.
 */
export function backupSigningKey(env: Record<string, string | undefined> = process.env): { key: Buffer; source: SigningKeySource } {
  const explicit = env.AFAGH_BACKUP_SIGNING_KEY?.trim() ?? '';
  if (explicit.length >= 32 && !explicit.startsWith('CHANGE_ME_')) {
    return { key: Buffer.from(explicit, 'utf8'), source: 'explicit' };
  }
  const pii = env.AFAGH_PII_KEY?.trim() ?? '';
  if (pii.length >= 32) {
    return {
      key: createHmac('sha256', Buffer.from(pii, 'utf8')).update(BACKUP_SIGNING_DOMAIN).digest(),
      source: 'derived',
    };
  }
  throw new Error(MISSING_SIGNING_KEY_ERROR);
}

/** نویسندة افزایشی بدنة امضاشده. هیچ رشتۀ بزرگی در حافظه نگه نمیدارد. */
export class SignedBodyWriter {
  private readonly hmac: ReturnType<typeof createHmac>;
  /** newlineهای انتهایی که هنوز هش/نوشته نشدهاند (منتظر قطعة بعدی یا finish). */
  private pending = '';

  constructor(key: Buffer) {
    this.hmac = createHmac('sha256', key);
  }

  /**
   * قطعة بعدی بدنه → بایتهایی که باید به خروجی نوشته شوند.
   * خروجی ممکن استBuffer تهی باشد (وقتی قطعه فقط newline انتهایی بوده).
   */
  push(text: string): Buffer {
    const combined = this.pending + text;
    const tail = /\r?\n+$/.exec(combined)?.[0] ?? '';
    const chunk = combined.slice(0, combined.length - tail.length);
    this.pending = tail;
    if (chunk.length === 0) return Buffer.alloc(0);
    const buf = Buffer.from(chunk, 'utf8');
    this.hmac.update(buf);
    return buf;
  }

  /** ردیف پایانی فایل: newline جداکننده + نشانگر + امضای نهایی. */
  finish(): Buffer {
    const signature = this.hmac.digest('hex');
    return Buffer.from(`\n${BACKUP_SIGNATURE_MARKER}${signature}\n`, 'utf8');
  }
}

/** تأیید امضا و بازگرداندن بدنة بدون امضا (همان رفتار restore قدیمی). */
export function verifySignedBackup(
  signedSql: string,
  key: Buffer,
  maxBytes = 50 * 1024 * 1024,
): string {
  if (typeof signedSql !== 'string' || Buffer.byteLength(signedSql, 'utf8') > maxBytes) {
    throw new Error(INVALID_BACKUP_SIZE_ERROR);
  }
  const match = /\r?\n-- AFAGH_BACKUP_SIGNATURE=([a-f0-9]{64})\r?\n?$/.exec(signedSql);
  if (!match) throw new Error(MISSING_SIGNATURE_ERROR);
  const body = signedSql.slice(0, match.index);
  const supplied = Buffer.from(match[1], 'hex');
  const expected = Buffer.from(createHmac('sha256', key).update(body, 'utf8').digest('hex'), 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error(BAD_SIGNATURE_ERROR);
  }
  return body;
}
