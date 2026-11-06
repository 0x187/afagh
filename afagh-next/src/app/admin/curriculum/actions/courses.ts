'use server';

// ════════════════════════════════════════════════════════════════════════
//  دروس: تعریف درس در بانک سراسری + افزودن/حذف/ویرایش درس در نسخه و
//  ترم‌بندی آن. همه روی نسخهٔ DRAFT (در غیر آن assertEditable می‌شکند) و
//  هر تغییر با تراکنش + appendAudit ثبت می‌شود.
// ════════════════════════════════════════════════════════════════════════

import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '@/db';
import { course_offerings, course_rules, courses, curriculum_courses, departments, enrollments } from '@/db/schema';
import { appendAudit } from '@/lib/audit';
import { requireRole } from '@/lib/auth';
import { roleFromBankType } from '@/lib/bank-roles';
import { type Act, type AddCourseInput, type CreateBankCourseInput, EDITORS, PHASE, assertEditable, revalidateCurriculumPaths } from './shared';

/**
 * تعریف درس جدید از صفر در بانک دروس (معادل «معرفی درس جدید» سامانهٔ قدیم).
 * بانک سراسری است و به نسخه گره نخورده؛ پیش‌نیاز/هم‌نیاز هر درس در سطح
 * کاتالوگ (course_rules هر نسخه) تعریف می‌شود نه روی رکورد بانک.
 */
export async function createCourseBankAction(input: CreateBankCourseInput): Promise<Act<{ message: string; data: { id: number } }>> {
  await requireRole(EDITORS);
  try {
    const code = (input.code ?? '').trim();
    const title = (input.title ?? '').trim();
    const theo = Number(input.theoreticalUnits ?? 0);
    const prac = Number(input.practicalUnits ?? 0);
    if (!code || !title) return { ok: false, error: 'کد درس و نام درس الزامی است.' };
    if (!(theo >= 0) || !(prac >= 0) || theo + prac <= 0) return { ok: false, error: 'واحد نظری/عملی نامعتبر است (مجموع باید بیشتر از صفر باشد).' };
    const [dup] = await db.select({ id: courses.id }).from(courses).where(eq(courses.code, code)).limit(1);
    if (dup) return { ok: false, error: `کد درس تکراری است: ${code}` };
    let departmentId: number | null = null;
    if (input.departmentId != null) {
      const [dept] = await db.select({ id: departments.id }).from(departments).where(eq(departments.id, input.departmentId)).limit(1);
      if (!dept) return { ok: false, error: 'گروه آموزشی انتخاب‌شده یافت نشد.' };
      departmentId = dept.id;
    }
    const [row] = await db.insert(courses).values({
      code,
      title,
      theoreticalUnits: String(theo),
      practicalUnits: String(prac),
      units: String(theo + prac),
      courseType: (input.courseType ?? '').trim() || 'تخصصی',
      gradingType: input.gradingType === 'PASS_FAIL' ? 'PASS_FAIL' : 'NUMERIC',
      affectsGpa: input.affectsGpa === 0 ? 0 : 1,
      departmentId,
    }).returning({ id: courses.id });
    await db.transaction(async (tx) => {
      await appendAudit(tx, {
        actorUserId: (await requireRole(EDITORS)).id,
        action: 'COURSE_BANK_CREATED', entityType: PHASE, entityId: row.id,
        details: JSON.stringify({ code, title, units: theo + prac, departmentId }),
      });
    });
    revalidateCurriculumPaths();
    return { ok: true, message: `درس «${title}» در بانک تعریف شد (${theo + prac} واحد).`, data: { id: row.id } };
  } catch (err: any) {
    console.error('createCourseBankAction:', err);
    return { ok: false, error: err.message || 'خطا در تعریف درس جدید' };
  }
}

export interface UpdateBankCourseInput {
  title?: string;
  theoreticalUnits?: number;
  practicalUnits?: number;
  courseType?: string;
  gradingType?: 'NUMERIC' | 'PASS_FAIL';
  affectsGpa?: number;
  departmentId?: number | null;
}

export async function updateCourseBankAction(courseId: number, input: UpdateBankCourseInput): Promise<Act<{ message: string }>> {
  await requireRole(EDITORS);
  try {
    const [existing] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!existing) return { ok: false, error: 'درس یافت نشد.' };
    const patch: Record<string, unknown> = {};
    if (input.title != null) patch.title = input.title.trim();
    if (input.theoreticalUnits != null) patch.theoreticalUnits = String(input.theoreticalUnits);
    if (input.practicalUnits != null) patch.practicalUnits = String(input.practicalUnits);
    if (input.courseType != null) patch.courseType = input.courseType;
    if (input.gradingType != null) patch.gradingType = input.gradingType;
    if (input.affectsGpa != null) patch.affectsGpa = input.affectsGpa ? 1 : 0;
    if (input.departmentId !== undefined) patch.departmentId = input.departmentId || null;
    // محاسبه واحد کل
    const theo = Number(input.theoreticalUnits ?? existing.theoreticalUnits ?? 0);
    const prac = Number(input.practicalUnits ?? existing.practicalUnits ?? 0);
    patch.units = String(theo + prac);
    await db.update(courses).set(patch).where(eq(courses.id, courseId));
    revalidateCurriculumPaths();
    return { ok: true, message: `درس «${existing.title}» به‌روزرسانی شد.` };
  } catch (err: any) {
    console.error('updateCourseBankAction:', err);
    return { ok: false, error: err.message || 'خطا در به‌روزرسانی درس' };
  }
}

export async function addCourseToCurriculumAction(versionId: number, item: AddCourseInput): Promise<Act<{ message: string }>> {
  await requireRole(EDITORS);
  try {
    await assertEditable(versionId);
    const [courseRow] = await db.select().from(courses).where(eq(courses.id, item.courseId)).limit(1);
    if (!courseRow) return { ok: false, error: 'درس انتخابی در بانک دروس یافت نشد.' };
    const dup = await db.select({ id: curriculum_courses.id }).from(curriculum_courses)
      .where(and(eq(curriculum_courses.curriculumVersionId, versionId), eq(curriculum_courses.courseId, item.courseId))).limit(1);
    if (dup.length > 0) return { ok: false, error: 'این درس از قبل در نسخه وجود دارد.' };

    await db.insert(curriculum_courses).values({
      curriculumVersionId: versionId,
      courseId: item.courseId,
      roleType: item.roleType ?? 'CORE',
      recommendedSemester: item.recommendedSemester ?? null,
      isRequired: item.isRequired ?? 1,
      isElective: item.isElective ?? 0,
      isGraduationRequired: item.isGraduationRequired ?? 0,
      minGrade: item.minGrade != null ? String(item.minGrade) : null,
      autoCorequisiteAllowed: item.autoCorequisiteAllowed ?? 0,
      passGradeStatusCode: item.passGradeStatusCode ?? null,
      failGradeStatusCode: item.failGradeStatusCode ?? null,
    });
    await db.transaction(async (tx) => {
      await appendAudit(tx, {
        actorUserId: (await requireRole(EDITORS)).id,
        action: 'CURRICULUM_COURSE_ADDED', entityType: PHASE, entityId: versionId,
        details: JSON.stringify({ courseId: item.courseId, code: courseRow.code }),
      });
    });
    revalidateCurriculumPaths();
    return { ok: true, message: `درس «${courseRow.title}» به نسخه افزوده شد.` };
  } catch (err: any) {
    console.error('addCourseToCurriculumAction:', err);
    return { ok: false, error: err.message || 'خطا در افزودن درس' };
  }
}


export async function bulkAddCoursesAction(versionId: number, items: AddCourseInput[]) {
  await requireRole(EDITORS);
  try {
    await assertEditable(versionId);
    let added = 0; const skipped: number[] = [];
    for (const it of items) {
      const dup = await db.select({ id: curriculum_courses.id }).from(curriculum_courses)
        .where(and(eq(curriculum_courses.curriculumVersionId, versionId), eq(curriculum_courses.courseId, it.courseId))).limit(1);
      if (dup.length > 0) { skipped.push(it.courseId); continue; }
      await db.insert(curriculum_courses).values({
        curriculumVersionId: versionId,
        courseId: it.courseId,
        roleType: it.roleType ?? 'CORE',
        recommendedSemester: it.recommendedSemester ?? null,
        isRequired: it.isRequired ?? 1,
        isElective: it.isElective ?? 0,
        isGraduationRequired: it.isGraduationRequired ?? 0,
        minGrade: it.minGrade != null ? String(it.minGrade) : null,
        autoCorequisiteAllowed: it.autoCorequisiteAllowed ?? 0,
        passGradeStatusCode: it.passGradeStatusCode ?? null,
        failGradeStatusCode: it.failGradeStatusCode ?? null,
      });
      added++;
    }
    await db.transaction(async (tx) => {
      await appendAudit(tx, {
        actorUserId: (await requireRole(EDITORS)).id,
        action: 'CURRICULUM_COURSES_BULK_ADDED', entityType: PHASE, entityId: versionId,
        details: JSON.stringify({ added, skipped }),
      });
    });
    revalidateCurriculumPaths();
    return { ok: true, message: `${added} درس افزوده شد.`, data: { added, skipped } };
  } catch (err: any) {
    console.error('bulkAddCoursesAction:', err);
    return { ok: false, error: err.message || 'خطا در افزودن گروهی دروس' };
  }
}

/**
 * همگام‌سازی نقش دروس نسخه از روی نوع بانک (lib/bank-roles — تنها منبع نگاشت).
 * برای ردیف‌هایی که با نقش پیش‌فرض اشتباه ثبت شده‌اند (مثلاً همه CORE)؛ فقط DRAFT.
 */


/**
 * همگام‌سازی نقش دروس نسخه از روی نوع بانک (lib/bank-roles — تنها منبع نگاشت).
 * برای ردیف‌هایی که با نقش پیش‌فرض اشتباه ثبت شده‌اند (مثلاً همه CORE)؛ فقط DRAFT.
 */
export async function syncRolesFromBankAction(versionId: number): Promise<Act<{ message: string; data: { updated: number } }>> {
  await requireRole(EDITORS);
  try {
    await assertEditable(versionId);
    const rows = await db
      .select({ courseId: curriculum_courses.courseId, roleType: curriculum_courses.roleType, courseType: courses.courseType })
      .from(curriculum_courses)
      .innerJoin(courses, eq(courses.id, curriculum_courses.courseId))
      .where(eq(curriculum_courses.curriculumVersionId, versionId));
    let updated = 0;
    // Batch update: group courseIds by their mapped role type, then update in bulk per group
    const roleGroups: Record<string, number[]> = {};
    for (const r of rows) {
      const mapped = roleFromBankType(r.courseType);
      if (mapped !== r.roleType) {
        if (!roleGroups[mapped]) roleGroups[mapped] = [];
        roleGroups[mapped].push(r.courseId);
      }
    }
    for (const [targetRole, courseIds] of Object.entries(roleGroups)) {
      await db.update(curriculum_courses)
        .set({ roleType: targetRole })
        .where(and(
          eq(curriculum_courses.curriculumVersionId, versionId),
          inArray(curriculum_courses.courseId, courseIds)
        ));
      updated += courseIds.length;
    }
    await db.transaction(async (tx) => {
      await appendAudit(tx, {
        actorUserId: (await requireRole(EDITORS)).id,
        action: 'CURRICULUM_ROLES_SYNCED', entityType: PHASE, entityId: versionId,
        details: JSON.stringify({ updated, total: rows.length }),
      });
    });
    revalidateCurriculumPaths();
    return { ok: true, message: updated > 0 ? `نقش ${updated} درس از روی نوع بانک اصلاح شد.` : 'همهٔ نقش‌ها از قبل با بانک هماهنگ بودند.', data: { updated } };
  } catch (err: any) {
    console.error('syncRolesFromBankAction:', err);
    return { ok: false, error: err.message || 'خطا در همگام‌سازی نقش‌ها' };
  }
}

/**
 * علامت‌زدن گروهی «شرط فارغ‌التحصیلی»: همهٔ دروس الزامی (isRequired=1) یا
 * نقش‌های CORE/MAJOR که هنوز علامت نخورده‌اند → isGraduationRequired=1.
 * فقط ۰→۱ می‌رود؛ چیزی که قبلاً علامت خورده دست‌نخورده می‌ماند.
 */
export async function markGraduationRequiredBulkAction(versionId: number): Promise<Act<{ message: string; data: { updated: number; total: number } }>> {
  await requireRole(EDITORS);
  try {
    await assertEditable(versionId);
    const rows = await db
      .select({ courseId: curriculum_courses.courseId, isGraduationRequired: curriculum_courses.isGraduationRequired })
      .from(curriculum_courses)
      .where(and(
        eq(curriculum_courses.curriculumVersionId, versionId),
        or(eq(curriculum_courses.isRequired, 1), inArray(curriculum_courses.roleType, ['CORE', 'MAJOR', 'SPECIALIZED', 'THESIS', 'INTERNSHIP'])),
      ));
    const toUpdate = rows.filter(r => r.isGraduationRequired !== 1).map(r => r.courseId);
    if (toUpdate.length) {
      await db.update(curriculum_courses)
        .set({ isGraduationRequired: 1 })
        .where(and(
          eq(curriculum_courses.curriculumVersionId, versionId),
          inArray(curriculum_courses.courseId, toUpdate)
        ));
    }
    const updated = toUpdate.length;
    await db.transaction(async (tx) => {
      await appendAudit(tx, {
        actorUserId: (await requireRole(EDITORS)).id,
        action: 'CURRICULUM_GRADREQ_MARKED', entityType: PHASE, entityId: versionId,
        details: JSON.stringify({ updated, total: rows.length }),
      });
    });
    revalidateCurriculumPaths();
    if (rows.length === 0) {
      return { ok: true, message: 'هیچ درس الزامی (یا CORE/MAJOR) در این نسخه نیست؛ اول نقش/الزامی دروس را مشخص کنید.', data: { updated: 0, total: 0 } };
    }
    return { ok: true, message: `شرط فارغ‌التحصیلی برای ${updated} درس از ${rows.length} درس الزامی علامت خورد.`, data: { updated, total: rows.length } };
  } catch (err: any) {
    console.error('markGraduationRequiredBulkAction:', err);
    return { ok: false, error: err.message || 'خطا در علامت‌زدن گروهی' };
  }
}


export async function removeCourseFromCurriculumAction(versionId: number, courseId: number): Promise<Act<{ message: string }>> {
  await requireRole(EDITORS);
  try {
    await assertEditable(versionId);
    const [courseRow] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!courseRow) return { ok: false, error: 'درس یافت نشد.' };

    // گارد وابستگی: اگر این درس در هر ارائهٔ ثبتنامشدهٔ فعال باشد، حذف مجاز نیست
    const dep = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
      .where(eq(course_offerings.courseId, courseId))
      .limit(5);
    if (dep.length > 0) {
      return { ok: false, error: 'این درس دارای ثبتنام فعال است و امکان حذف از نسخه وجود ندارد.' };
    }

    await db.transaction(async (tx) => {
      await tx.delete(curriculum_courses).where(and(
        eq(curriculum_courses.curriculumVersionId, versionId),
        eq(curriculum_courses.courseId, courseId),
      ));
      // قواعد وابسته به این درس در همین نسخه هم پاک می‌شوند
      await tx.delete(course_rules).where(and(
        eq(course_rules.syllabusId, versionId),
        eq(course_rules.courseId, courseId),
      ));
      await appendAudit(tx, {
        actorUserId: (await requireRole(EDITORS)).id,
        action: 'CURRICULUM_COURSE_REMOVED', entityType: PHASE, entityId: versionId,
        details: JSON.stringify({ courseId, code: courseRow.code }),
      });
    });
    revalidateCurriculumPaths();
    return { ok: true, message: `درس «${courseRow.title}» از نسخه حذف شد.` };
  } catch (err: any) {
    console.error('removeCourseFromCurriculumAction:', err);
    return { ok: false, error: err.message || 'خطا در حذف درس' };
  }
}


export async function updateCourseInCurriculumAction(
  versionId: number,
  courseId: number,
  patch: {
    roleType?: string; units?: number | null; theoryUnits?: number | null; practicalUnits?: number | null;
    isRequired?: number; isElective?: number; isGraduationRequired?: number;
    minGrade?: number | null; autoCorequisiteAllowed?: number;
    passGradeStatusCode?: string | null; failGradeStatusCode?: string | null;
  }
): Promise<Act<{ message: string }>> {
  await requireRole(EDITORS);
  try {
    await assertEditable(versionId);
    const existing = await db.select().from(curriculum_courses)
      .where(and(eq(curriculum_courses.curriculumVersionId, versionId), eq(curriculum_courses.courseId, courseId))).limit(1);
    if (existing.length === 0) return { ok: false, error: 'درس در این نسخه وجود ندارد.' };
    const row = existing[0];

    const nextRequired = patch.isRequired ?? row.isRequired;
    // «الزامی در ترم» ⇒ «شرط فارغ‌التحصیلی» فقط در لحظهٔ روشن‌شدن الزامی.
    // اگر کاربر بعداً خودش تیک «شرط فارغ‌التحصیلی» را بردارد، دیگر برنمی‌گردد.
    const requirementTurnedOn = patch.isRequired === 1 && row.isRequired !== 1;
    const nextGradRequired = patch.isGraduationRequired ?? (requirementTurnedOn ? 1 : (row.isGraduationRequired ?? 0));

    await db.update(curriculum_courses).set({
      roleType: patch.roleType ?? row.roleType,
      units: patch.units !== undefined ? (patch.units != null ? String(patch.units) : null) : row.units,
      theoryUnits: patch.theoryUnits !== undefined ? (patch.theoryUnits != null ? String(patch.theoryUnits) : null) : row.theoryUnits,
      practicalUnits: patch.practicalUnits !== undefined ? (patch.practicalUnits != null ? String(patch.practicalUnits) : null) : row.practicalUnits,
      isRequired: nextRequired,
      isElective: patch.isElective ?? row.isElective,
      isGraduationRequired: nextGradRequired,
      minGrade: patch.minGrade !== undefined ? (patch.minGrade != null ? String(patch.minGrade) : null) : row.minGrade,
      autoCorequisiteAllowed: patch.autoCorequisiteAllowed ?? row.autoCorequisiteAllowed,
      passGradeStatusCode: patch.passGradeStatusCode !== undefined ? patch.passGradeStatusCode : row.passGradeStatusCode,
      failGradeStatusCode: patch.failGradeStatusCode !== undefined ? patch.failGradeStatusCode : row.failGradeStatusCode,
    }).where(and(
      eq(curriculum_courses.curriculumVersionId, versionId),
      eq(curriculum_courses.courseId, courseId),
    ));
    await db.transaction(async (tx) => {
      await appendAudit(tx, {
        actorUserId: (await requireRole(EDITORS)).id,
        action: 'CURRICULUM_COURSE_UPDATED', entityType: PHASE, entityId: versionId,
        details: JSON.stringify({ courseId, patch }),
      });
    });
    revalidateCurriculumPaths();
    return { ok: true, message: 'مشخصات درس بهروزرسانی شد.' };
  } catch (err: any) {
    console.error('updateCourseInCurriculumAction:', err);
    return { ok: false, error: err.message || 'خطا در بهروزرسانی درس' };
  }
}


export async function assignCourseToSemesterAction(versionId: number, courseId: number, semesterNo: number | null): Promise<Act<{ message: string }>> {
  await requireRole(EDITORS);
  try {
    await assertEditable(versionId);
    if (semesterNo != null && (semesterNo < 1 || semesterNo > 9)) {
      return { ok: false, error: 'شماره ترم باید بین ۱ تا ۹ باشد (۹ = تابستان، خالی = نامشخص).' };
    }
    await db.update(curriculum_courses).set({ recommendedSemester: semesterNo })
      .where(and(eq(curriculum_courses.curriculumVersionId, versionId), eq(curriculum_courses.courseId, courseId)));
    revalidateCurriculumPaths();
    return { ok: true, message: semesterNo ? (semesterNo === 9 ? 'درس به ترم تابستان تخصیص یافت.' : `درس به ترم ${semesterNo} تخصیص یافت.`) : 'ترم درس آزاد شد.' };
  } catch (err: any) {
    console.error('assignCourseToSemesterAction:', err);
    return { ok: false, error: err.message || 'خطا در تخصیص ترم' };
  }
}


export async function bulkAssignSemestersAction(versionId: number, assignments: { courseId: number; semesterNo: number | null }[]) {
  await requireRole(EDITORS);
  try {
    await assertEditable(versionId);
    for (const a of assignments) {
      if (a.semesterNo != null && (a.semesterNo < 1 || a.semesterNo > 9)) {
        return { ok: false, error: `ترم نامعتبر برای درس ${a.courseId}: باید بین ۱ تا ۹ باشد (۹ = تابستان).` };
      }
      await db.update(curriculum_courses).set({ recommendedSemester: a.semesterNo })
        .where(and(eq(curriculum_courses.curriculumVersionId, versionId), eq(curriculum_courses.courseId, a.courseId)));
    }
    revalidateCurriculumPaths();
    return { ok: true, message: `${assignments.length} تخصیص ترمی ثبت شد.` };
  } catch (err: any) {
    console.error('bulkAssignSemestersAction:', err);
    return { ok: false, error: err.message || 'خطا در تخصیص گروهی ترم' };
  }
}

// ─────────────────────────── قواعد (پیش‌نیاز/هم‌نیاز/نمره) — D2 ───────────────────────────
