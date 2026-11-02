'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { admissions_staging, sanjesh_files, sanjesh_file_rows, sanjesh_file_fields, students } from '@/db/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';

/**
 * مرحلهٔ ۴ → ۳: برگشت ردیف‌های IMPORTED به RESOLVED.
 * پروندهٔ دانشجویی و ثبت‌نام‌ها دست‌نخورده می‌مانند؛ فقط پیوند staging و تصمیم پاک می‌شود.
 */
/**
 * مرحلهٔ ۳ → ۲: برگشت ردیف‌های NUMBER_ASSIGNED به RESOLVED.
 * شمارهٔ صادرشدهٔ دانشجویی دست‌نخورده می‌ماند؛ فقط staging به RESOLVED برمی‌گردد.
 */
export async function revertNumberAssignedToResolvedAction(stagingIds: number[]) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  try {
    if (stagingIds.length === 0) return { ok: false, error: 'هیچ ردیفی انتخاب نشده است.' };
    const rows = await db
      .select({ id: admissions_staging.id, status: admissions_staging.status })
      .from(admissions_staging)
      .where(inArray(admissions_staging.id, stagingIds));
    const eligible = rows.filter(r => r.status === 'NUMBER_ASSIGNED').map(r => r.id);
    if (eligible.length === 0) return { ok: false, error: 'هیچ ردیف NUMBER_ASSIGNEDی برای برگشت نیست.' };
    await db
      .update(admissions_staging)
      .set({ status: 'RESOLVED', onboardingStatus: 'IMPORTED', decisionNote: null })
      .where(inArray(admissions_staging.id, eligible));
    revalidatePath('/admin/admissions');
    return { ok: true, count: eligible.length, message: `${eligible.length} ردیف به RESOLVED برگشت.` };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در برگشت.' };
  }
}

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

/**
 * جدول‌هایی که ممکن است یک پذیرشِ تازه (قبل از ثبت‌نام/نمره) در آن‌ها ردیف
 * داشته باشد. ترتیب: برگ‌ها قبل از والدها. ستون کلید همه `studentId` است
 * به‌جز student_subject_fees که `student_id` دارد.
 */
const PURGE_CHILD_TABLES: { table: string; col: string }[] = [
  { table: 'grade_objections', col: 'studentId' },
  { table: 'enroll_bypass_requests', col: 'studentId' },
  { table: 'student_course_grants', col: 'studentId' },
  { table: 'scheduled_warnings', col: 'studentId' },
  { table: 'english_enrollment_approvals', col: 'studentId' },
  { table: 'council_decisions', col: 'studentId' },
  { table: 'student_tuition_overrides', col: 'studentId' },
  { table: 'thesis_progress_reports', col: 'studentId' },
  { table: 'thesis_supervisions', col: 'studentId' },
  { table: 'defense_sessions', col: 'studentId' },
  { table: 'thesis_progress', col: 'studentId' },
  { table: 'irandoc_logs', col: 'studentId' },
  { table: 'discipline_cases', col: 'studentId' },
  { table: 'dorm_residences', col: 'studentId' },
  { table: 'exam_attendances', col: 'studentId' },
  { table: 'grade_change_log', col: 'studentId' },
  { table: 'transcript_snapshots', col: 'studentId' },
  { table: 'graduation_audits', col: 'studentId' },
  { table: 'clearance_checklist', col: 'studentId' },
  { table: 'student_cards', col: 'studentId' },
  { table: 'student_discounts', col: 'studentId' },
  { table: 'student_loans', col: 'studentId' },
  { table: 'student_sponsorships', col: 'studentId' },
  { table: 'student_requests', col: 'studentId' },
  { table: 'cart_items', col: 'studentId' },
  { table: 'payment_cheques', col: 'studentId' },
  { table: 'pos_transactions', col: 'studentId' },
  { table: 'payment_transactions', col: 'studentId' },
  { table: 'student_ledger', col: 'studentId' },
  { table: 'student_subject_fees', col: 'student_id' },
  { table: 'financial_clearances', col: 'studentId' },
  { table: 'student_term_states', col: 'studentId' },
  { table: 'enrollments', col: 'studentId' },
  { table: 'sanjesh_file_rows', col: 'studentId' },
  { table: 'alumni_profiles', col: 'studentId' },
  { table: 'alumni_requests', col: 'studentId' },
  { table: 'military_service_records', col: 'studentId' },
  { table: 'issued_degrees', col: 'studentId' },
];

/**
 * کنسل یا حذفِ کاملِ یک پذیرشِ ثبت‌شده (بعد از صدور شماره/ثبت نهایی).
 *
 * - mode = 'cancel': فقط دانشجو را «غیرفعال/CANCELLED» می‌کند (از فهرست‌های
 *   آموزش حذف می‌شود ولی رکورد و سابقه برای حسابرسی می‌ماند) و ردیف staging
 *   را به RESOLVED برمی‌گرداند.
 * - mode = 'purge' : دانشجو را فیزیکی حذف می‌کند — **فقط** اگر هیچ سابقهٔ
 *   آموزشی/مالی (ثبت‌نام/دفتر/پرداخت) نداشته باشد؛ وگرنه رد می‌شود.
 */
export async function cancelAdmissionAction(
  stagingIds: number[],
  mode: 'cancel' | 'purge',
) {
  await requireRole(mode === 'purge' ? ['ADMIN'] : ['ADMIN', 'EDU_EXPERT']);
  try {
    if (stagingIds.length === 0) return { ok: false, error: 'هیچ ردیفی انتخاب نشده است.' };
    const rows = await db
      .select()
      .from(admissions_staging)
      .where(inArray(admissions_staging.id, stagingIds));
    const eligible = rows.filter(
      r => (r.status === 'IMPORTED' || r.status === 'NUMBER_ASSIGNED') && r.studentId,
    );
    if (eligible.length === 0) {
      return { ok: false, error: 'ردیفی با شمارهٔ صادرشده یا ثبت‌شده برای کنسل/حذف نیست.' };
    }

    let done = 0;
    const failures: { stagingId: number; error: string }[] = [];

    for (const row of eligible) {
      try {
        await db.transaction(async tx => {
          const sid = row.studentId as number;

          if (mode === 'purge') {
            // گارد: اگر دانشجو سابقهٔ آموزشی/مالی دارد، حذف کامل ممنوع است
            const hist: any = await tx.execute(sql`
              SELECT
                (SELECT count(*) FROM enrollments WHERE "studentId" = ${sid}) AS en,
                (SELECT count(*) FROM student_ledger WHERE "studentId" = ${sid}) AS led,
                (SELECT count(*) FROM payment_transactions WHERE "studentId" = ${sid}) AS pay
            `);
            const h = (hist?.rows ?? hist)?.[0] ?? {};
            if (Number(h.en ?? 0) > 0 || Number(h.led ?? 0) > 0 || Number(h.pay ?? 0) > 0) {
              throw new Error('این دانشجو سابقهٔ آموزشی/مالی دارد و حذف کامل مجاز نیست؛ از «کنسل» استفاده کنید.');
            }
            for (const { table, col } of PURGE_CHILD_TABLES) {
              await tx.execute(sql.raw(`DELETE FROM "${table}" WHERE "${col}" = ${Number(sid)}`));
            }
            await tx.delete(students).where(eq(students.id, sid));
          } else {
            await tx.update(students).set({ status: 'CANCELLED' }).where(eq(students.id, sid));
          }

          await tx
            .update(admissions_staging)
            .set({
              status: 'RESOLVED',
              studentId: null,
              userId: null,
              assignedStudentCode: null,
              onboardingStatus: null,
              decisionNote: null,
            })
            .where(eq(admissions_staging.id, row.id));
        });
        done++;
      } catch (err: any) {
        failures.push({ stagingId: row.id, error: err?.message || 'خطا در کنسل/حذف.' });
      }
    }

    revalidatePath('/admin/admissions');
    revalidatePath('/admin/students');
    return {
      ok: true,
      count: done,
      failures,
      message: `${done} ردیف ${mode === 'purge' ? 'حذف' : 'کنسل'} شد.`,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در کنسل/حذف پذیرش.' };
  }
}

/**
 * حذف شمارهٔ صادرشده و آماده‌سازی برای تخصیص مجدد.
 *
 * برخلاف `revertNumberAssignedToResolvedAction` که شماره را عمداً نگه می‌دارد،
 * این اکشن شماره را **پاک** می‌کند و پروندهٔ دانشجوییِ ساخته‌شده را هم برمی‌دارد؛
 * وگرنه با منطق idempotentِ انتقال، اجرای دوباره به‌جای صدور شمارهٔ تازه، ردیف
 * را به همان پروندهٔ قبلی «وصل» می‌کرد و شمارهٔ جدیدی صادر نمی‌شد.
 *
 * گارد: دانشجویی که سابقهٔ آموزشی/مالی دارد حذف نمی‌شود (همان قاعدهٔ purge).
 */
export async function revokeAssignedNumbersAction(stagingIds: number[]) {
  await requireRole(['ADMIN']);
  try {
    if (stagingIds.length === 0) return { ok: false, error: 'هیچ ردیفی انتخاب نشده است.' };

    const rows = await db
      .select()
      .from(admissions_staging)
      .where(inArray(admissions_staging.id, stagingIds));

    const eligible = rows.filter(
      r => (r.status === 'NUMBER_ASSIGNED' || r.status === 'IMPORTED') && r.studentId,
    );
    if (eligible.length === 0) {
      return { ok: false, error: 'ردیفی با شمارهٔ صادرشده برای حذف نیست.' };
    }

    let done = 0;
    const failures: { stagingId: number; error: string }[] = [];

    for (const row of eligible) {
      try {
        await db.transaction(async tx => {
          const sid = row.studentId as number;

          const hist: any = await tx.execute(sql`
            SELECT
              (SELECT count(*) FROM enrollments WHERE "studentId" = ${sid}) AS en,
              (SELECT count(*) FROM student_ledger WHERE "studentId" = ${sid}) AS led,
              (SELECT count(*) FROM payment_transactions WHERE "studentId" = ${sid}) AS pay
          `);
          const h = (hist?.rows ?? hist)?.[0] ?? {};
          if (Number(h.en ?? 0) > 0 || Number(h.led ?? 0) > 0 || Number(h.pay ?? 0) > 0) {
            throw new Error('این دانشجو سابقهٔ آموزشی/مالی دارد؛ حذف شماره مجاز نیست.');
          }

          for (const { table, col } of PURGE_CHILD_TABLES) {
            await tx.execute(sql.raw(`DELETE FROM "${table}" WHERE "${col}" = ${Number(sid)}`));
          }
          await tx.delete(students).where(eq(students.id, sid));

          await tx
            .update(admissions_staging)
            .set({
              status: 'RESOLVED',
              studentId: null,
              userId: null,
              assignedStudentCode: null,
              onboardingStatus: null,
              decisionNote: null,
            })
            .where(eq(admissions_staging.id, row.id));
        });
        done++;
      } catch (err: any) {
        failures.push({ stagingId: row.id, error: err?.message || 'خطا در حذف شماره.' });
      }
    }

    revalidatePath('/admin/admissions');
    revalidatePath('/admin/students');
    return {
      ok: true,
      count: done,
      failures,
      message: `${done} شمارهٔ دانشجویی حذف شد و ردیف‌ها برای تخصیص مجدد آماده‌اند.`,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در حذف شماره‌های صادرشده.' };
  }
}
