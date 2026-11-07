import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { S3, ARCHIVE_BUCKET } from '@/lib/objectStore';
import { getPlatformAdminUser } from '@/lib/backup-auth';

export const dynamic = 'force-dynamic';

// فقط کلیدهای ساخته‌شده توسط بکاپ (پیشوند afagh-backup/، پسوند sql/zip) مجازند —
// جلوگیری از دسترسی به سایر اشیاء باکت آرشیو.
const KEY_RE = /^afagh-backup\/[A-Za-z0-9][A-Za-z0-9._\-/]*\.(sql|zip)$/;

/**
 * دانلود جریانیِ فایل بکاپی که پیش‌تر توسط start*BackupAction در MinIO ذخیره شده.
 * پاسخ مستقیماً (بدون RSC) جریانی فرستاده می‌شود تا روی لبهٔ CDN مقاوم باشد.
 */
export async function GET(req: NextRequest) {
  const user = await getPlatformAdminUser();
  if (!user) return new NextResponse('دسترسی رد شد.', { status: 401 });

  const key = req.nextUrl.searchParams.get('key') || '';
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('\\')) {
    return new NextResponse('کلید دانلود نامعتبر است.', { status: 400 });
  }

  try {
    const obj = await S3.getObject(ARCHIVE_BUCKET, key);
    const nodeStream = obj as unknown as Readable;
    const webStream = Readable.toWeb(nodeStream);
    const fileName = key.split('/').pop() || 'backup';
    const headers: Record<string, string> = {
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
      'Content-Type': key.endsWith('.sql') ? 'text/plain; charset=utf-8' : 'application/zip',
    };
    return new NextResponse(webStream as unknown as BodyInit, { status: 200, headers });
  } catch (e) {
    // 🔒 جزئیات در لاگ سرور؛ پیام عمومی به کلاینت.
    console.error('[api] backup/download failed:', e instanceof Error ? e.message : e);
    return new NextResponse('فایل یافت نشد یا خواندن آن ناموفق بود.', { status: 404 });
  }
}
