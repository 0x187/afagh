'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import {
  ensureDefaultSanjeshMappings,
  importStagedToStudents,
  parseAndStageSanjeshData,
  registerManualStudent,
} from '@/lib/admissions-engine';
import { executeIrandocCheck } from '@/lib/api-integrations';
import { isEntryMethod } from '@/lib/entry-methods';
import { db } from '@/db';
import { admissions_staging, majors, sanjesh_mappings, student_id_formulas } from '@/db/schema';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { getCurrentUniversity } from '@/lib/university-scope';

export async function stageSanjeshDataAction(rawText: string, entryYear = 1405) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);

  try {
    const staged = await parseAndStageSanjeshData(rawText, entryYear);
    revalidatePath('/admin/admissions');
    revalidatePath('/admin/students');
    return { ok: true, count: staged.length, items: staged };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در پردازش فایل سنجش.' };
  }
}

export async function importStagedStudentsAction(
  stagingIds: number[],
  entryMethod: string,
  allowDuplicates: boolean = false,
) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);

  try {
    if (!isEntryMethod(entryMethod)) return { ok: false, error: 'روش ورود را انتخاب کنید.' };
    const result = await importStagedToStudents(stagingIds, { entryMethod, allowDuplicates });
    revalidatePath('/admin/admissions');
    revalidatePath('/admin/students');
    return {
      ok: true,
      count: result.imported.length,
      items: result.imported,
      failures: result.failures,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در ثبت نهایی دانشجویان.' };
  }
}

export async function saveSanjeshMappingAction(sanjeshCode: string, internalMajorId: number, quota?: string) {
  await requireRole(['ADMIN']);

  try {
    const uni = await getCurrentUniversity().catch(() => null);
    if (!uni) return { ok: false, error: 'دانشگاه فعال نامشخص است.' };
    const uniScope = (c: any) => or(eq(c, uni.id), isNull(c));
    // رشتهٔ داخلی باید متعلق به همین دانشگاه (یا سراسری) باشد
    const [mj] = await db.select({ universityId: majors.universityId })
      .from(majors).where(eq(majors.id, internalMajorId)).limit(1);
    if (!mj) return { ok: false, error: 'رشتهٔ داخلی یافت نشد.' };
    if (mj.universityId !== null && mj.universityId !== uni.id) {
      return { ok: false, error: 'رشته متعلق به دانشگاه دیگری است.' };
    }
    const [existing] = await db
      .select()
      .from(sanjesh_mappings)
      .where(and(eq(sanjesh_mappings.sanjeshCode, sanjeshCode), uniScope(sanjesh_mappings.universityId)))
      .limit(1);

    if (existing) {
      await db
        .update(sanjesh_mappings)
        .set({ internalMajorId, ...(quota ? { sanjeshQuota: quota } : {}) })
        .where(and(eq(sanjesh_mappings.id, existing.id), uniScope(sanjesh_mappings.universityId)));
    } else {
      await db.insert(sanjesh_mappings).values({
        universityId: uni.id,
        sanjeshCode,
        internalMajorId,
        sanjeshQuota: quota || 'سهمیه عادی',
        internalQuotaCode: 1,
      });
    }

    // به‌روزرسانی رکوردهای staging متناظر که در حالت انتظار بودند.
    // ⚠ فقط ردیف‌های **همین کد رشته** — پیش‌تر شرط کد نداشت و نگاشت یک کد،
    // همهٔ ردیف‌های در انتظار (حتی رشته‌های دیگر) را به همان رشته می‌چسباند.
    await db
      .update(admissions_staging)
      .set({ mappedMajorId: internalMajorId, status: 'RESOLVED' })
      .where(
        and(
          eq(admissions_staging.status, 'PENDING_MAPPING'),
          sql`(CASE WHEN ${admissions_staging.rawSanjeshData} LIKE '{%' THEN ${admissions_staging.rawSanjeshData}::jsonb ->> 'sanjeshCode' END) = ${sanjeshCode}`,
          uniScope(admissions_staging.universityId),
        ),
      );

    revalidatePath('/admin/admissions');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در ذخیره نگاشت.' };
  }
}

export async function saveStudentIdFormulaAction(degreeLevelId: number, formula: string) {
  await requireRole(['ADMIN']);

  try {
    const uni = await getCurrentUniversity().catch(() => null);
    if (!uni) return { ok: false, error: 'دانشگاه فعال نامشخص است.' };
    const uniScope = (c: any) => or(eq(c, uni.id), isNull(c));
    const [existing] = await db
      .select()
      .from(student_id_formulas)
      .where(and(eq(student_id_formulas.degreeLevelId, degreeLevelId), uniScope(student_id_formulas.universityId)))
      .limit(1);

    if (existing) {
      await db
        .update(student_id_formulas)
        .set({ formula })
        .where(and(eq(student_id_formulas.id, existing.id), uniScope(student_id_formulas.universityId)));
    } else {
      await db.insert(student_id_formulas).values({
        universityId: uni.id,
        degreeLevelId,
        entryYear: 1405,
        formula,
        currentSequence: 0,
      });
    }

    revalidatePath('/admin/admissions');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در ذخیره فرمول شماره دانشجویی.' };
  }
}

export async function registerManualStudentAction(data: {
  nationalCode: string;
  firstName: string;
  lastName: string;
  mobile: string;
  majorId: number;
  degreeLevelId: number;
  entryYear?: number;
  entryTerm?: number;
  quotaType?: string;
  admissionType?: 'NORMAL' | 'TRANSFER' | 'INTERNATIONAL' | 'FREE_COURSE';
  universityId?: number;
}) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);

  try {
    // دانشگاه هدف همیشه دانشگاه فعال سرور است (ورودی کلاینت نادیده گرفته می‌شود)
    const uni = await getCurrentUniversity().catch(() => null);
    if (!uni) return { ok: false, error: 'دانشگاه فعال نامشخص است.' };
    const res = await registerManualStudent({ ...data, universityId: uni.id });
    revalidatePath('/admin/admissions');
    revalidatePath('/admin/students');
    return { ok: true, student: res };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در ثبت‌نام دستی دانشجو.' };
  }
}

export async function testIrandocCheckAction(params: {
  nationalCode: string;
  trackingCode: string;
  thesisTitle: string;
  maxAllowedThreshold?: number;
}) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);

  try {
    const res = await executeIrandocCheck(params);
    revalidatePath('/admin/admissions');
    revalidatePath('/admin/workflows');
    return { ok: true, result: res };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در استعلام ایرانداک.' };
  }
}
