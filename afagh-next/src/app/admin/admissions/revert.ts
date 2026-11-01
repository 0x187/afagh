'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { admissions_staging, sanjesh_files, sanjesh_file_rows } from '@/db/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';

/**
 * مرحلهٔ ۴ → ۳: برگشت ردیف‌های IMPORTED به RESOLVED.
 * پروندهٔ دانشجویی و ثبت‌نام‌ها دست‌نخورده می‌مانند؛ فقط پیوند staging و تصمیم پاک می‌شود.
 */
export async function revertImportedToResolvedAction(stagingIds: number[]) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  try {
    if (stagingIds.length === 0) return { ok: false, error: 'هیچ ردیفی انتخاب نشده است.' };
    const rows = await db
      .select({ id: admissions_staging.id, status: admissions_staging.status })
      .from(admissions_staging)
      .where(inArray(admissions_staging.id, stagingIds));
    const eligible = rows.filter(r => r.status === 'IMPORTED').map(r => r.id);
    if (eligible.length === 0) return { ok: false, error: 'هیچ ردیف IMPORTEDی برای برگشت نیست.' };
    await db
      .update(admissions_staging)
      .set({ status: 'RESOLVED', studentId: null, userId: null, onboardingStatus: 'IMPORTED', decisionNote: null })
      .where(inArray(admissions_staging.id, eligible));
    revalidatePath('/admin/admissions');
    return { ok: true, count: eligible.length, message: `${eligible.length} ردیف به RESOLVED برگشت.` };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در برگشت.' };
  }
}

/**
 * مرحلهٔ ۳ → ۲: برگشت ردیف‌های RESOLVED به PENDING_MAPPING.
 * mappedMajorId و decisionNote پاک می‌شوند.
 */
export async function revertResolvedToPendingAction(stagingIds: number[]) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  try {
    if (stagingIds.length === 0) return { ok: false, error: 'هیچ ردیفی انتخاب نشده است.' };
    const rows = await db
      .select({ id: admissions_staging.id, status: admissions_staging.status })
      .from(admissions_staging)
      .where(inArray(admissions_staging.id, stagingIds));
    const eligible = rows.filter(r => r.status === 'RESOLVED').map(r => r.id);
    if (eligible.length === 0) return { ok: false, error: 'هیچ ردیف RESOLVEDی برای برگشت نیست.' };
    await db
      .update(admissions_staging)
      .set({ status: 'PENDING_MAPPING', mappedMajorId: null, decisionNote: null, matchedAt: null })
      .where(inArray(admissions_staging.id, eligible));
    revalidatePath('/admin/admissions');
    return { ok: true, count: eligible.length, message: `${eligible.length} ردیف به PENDING_MAPPING برگشت.` };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در برگشت.' };
  }
}

/**
 * مرحلهٔ ۲ → ۱: برگشت فایل از STAGED به FIELDS_READY.
 * ردیف‌های staging این فایل حذف می‌شوند و فایل به وضعیت FIELDS_READY برمی‌گردد.
 */
export async function revertStagedToFieldsReadyAction(fileId: number) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  try {
    const uni = await getCurrentUniversity().catch(() => null);
    const uniScope = (c: any) => uni ? (c === uni.id ? true : false) : true;
    await db.transaction(async tx => {
      await tx.delete(admissions_staging).where(eq(admissions_staging.fileId, fileId));
      await tx.update(sanjesh_files).set({ status: 'FIELDS_READY', updatedAt: new Date() }).where(eq(sanjesh_files.id, fileId));
      // reset matchStatus of file rows back to PENDING
      await tx.update(sanjesh_file_rows).set({ matchStatus: 'PENDING', studentId: null, matchedAt: null }).where(eq(sanjesh_file_rows.fileId, fileId));
    });
    revalidatePath('/admin/admissions');
    return { ok: true, message: `فایل ${fileId} به FIELDS_READY برگشت.` };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در برگشت.' };
  }
}

/**
 * مرحلهٔ ۱ → حذف: حذف کامل فایل سنجش و تمام ردیف‌های آن.
 */
export async function deleteSanjeshFileAction(fileId: number) {
  await requireRole(['ADMIN']);
  try {
    await db.transaction(async tx => {
      await tx.delete(admissions_staging).where(eq(admissions_staging.fileId, fileId));
      await tx.delete(sanjesh_file_rows).where(eq(sanjesh_file_rows.fileId, fileId));
      await tx.delete(sanjesh_file_fields).where(eq(sanjesh_file_fields.fileId, fileId));
      await tx.delete(sanjesh_files).where(eq(sanjesh_files.id, fileId));
    });
    revalidatePath('/admin/admissions');
    return { ok: true, message: `فایل ${fileId} کاملاً حذف شد.` };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در حذف.' };
  }
}
