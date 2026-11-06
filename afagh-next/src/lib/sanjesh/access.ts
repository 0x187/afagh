/**
 * دامنهٔ دسترسی فایل‌های سنجش — **چنددانشگاهی**
 *
 * این سامانه چنددانشگاهی است: هر رکورد `universityId` دارد و هیچ کوئری‌ای نباید
 * بدون فیلتر دانشگاه اجرا شود. دو قاعده:
 *
 *   ۱. فهرست فایل‌ها فقط فایل‌های دانشگاه جاری را نشان می‌دهد.
 *   ۲. دسترسی به یک فایل با شناسه، ابتدا مالکیت آن را بررسی می‌کند؛ در غیر این
 *      صورت `null` برمی‌گردد و صفحه پیام «یافت نشد» می‌دهد (نه نشت داده).
 *
 * استثنا: رکوردهای با `universityId = null` (قالب‌های پیش‌فرض سراسری) برای همه
 * قابل خواندن‌اند.
 */

import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { db } from '@/db';
import { sanjesh_files } from '@/db/schema';

/** شرط دامنه: رکوردهای همین دانشگاه یا رکوردهای سراسری (NULL) */
export function universityScope(col: PgColumn, universityId: number | null): SQL | undefined {
  if (universityId == null) return undefined;
  return or(eq(col, universityId), isNull(col));
}

/** شرط سختِ مالکیت: فقط همین دانشگاه (بدون پذیرش رکورد سراسری) */
export function strictUniversityScope(col: PgColumn, universityId: number | null): SQL | undefined {
  if (universityId == null) return undefined;
  return eq(col, universityId);
}

/** فایل را در دامنهٔ دانشگاه می‌خواند؛ اگر متعلق نباشد `null`. */
export async function getScopedFile(fileId: number, universityId: number | null) {
  if (!Number.isFinite(fileId)) return null;
  const scope = universityScope(sanjesh_files.universityId, universityId);
  const where = scope ? and(eq(sanjesh_files.id, fileId), scope) : eq(sanjesh_files.id, fileId);
  const [file] = await db.select().from(sanjesh_files).where(where).limit(1);
  return file ?? null;
}
