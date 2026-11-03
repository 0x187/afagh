'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { academic_terms, course_offerings, courses, educational_regulations, enrollments, legacy_code_maps, legacy_grades, roles, staff, student_term_states, students, universities, user_roles, users, sessions, signature_otps, doc_sign_otps, grade_submission_otps } from '@/db/schema';
import { and, desc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { hashPassword, requireRole } from '@/lib/auth';
import { z } from 'zod';
import { clearPermissionCache } from '@/lib/permissions-enforcer';
import { getSessionUser } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { requireStudentUniversity } from '@/lib/security';
import { resolveCityMinistry } from '@/lib/shared-coding';
import { toGregorian } from '@/lib/calendar';
import { legacyRowOfSource, legacySourceCodeFor } from './transcript-utils';
import type { StaffItem } from './types';
import { execRowCount, execRows } from '@/lib/db-result';
import { checkNewPassword, PASSWORD_MIN_LENGTH_STUDENT } from '@/lib/password-policy';

/**
 * 🔐 رمز یکبارمصرف تصادفی با آنتروپی کافی (۹۶ بیت).
 * هرگز از کد ملی یا هر دادهٔ قابل‌حدس دیگری مشتق نمی‌شود.
 */
function randomOneTimePassword(): string {
  return randomBytes(12).toString('base64url').slice(0, 16);
}

/** پیکربندی اجرایی آیین‌نامه ملاک دانشجو برای محاسبات کارنامه */
export async function getTranscriptRegulation(studentId: number): Promise<{
  title: string | null;
  config: import('@/lib/regulations-engine').RegulationConfig;
} | null> {
  await requireRole(['ADMIN', 'EDU_EXPERT', 'ARCHIVE_EXPERT', 'MILITARY_OFFICER', 'GRADUATEAFFAIRS']);
  // 🔒 مرز دانشگاه (هم‌سطح getTranscript)
  const uniGate = await requireStudentUniversity(studentId);
  if (!uniGate.ok) return null;
  const { getRegulationConfig, DEFAULT_BACHELOR_REGULATION_1403 } = await import('@/lib/regulations-engine');
  const [stu] = await db
    .select({ regulationId: students.regulationId, degreeLevelId: students.degreeLevelId })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!stu) return null;
  const [reg] = stu.regulationId
    ? await db.select({ title: educational_regulations.title }).from(educational_regulations).where(eq(educational_regulations.id, stu.regulationId)).limit(1)
    : [];
  const config = await getRegulationConfig(stu.regulationId, stu.degreeLevelId).catch(() => DEFAULT_BACHELOR_REGULATION_1403);
  return { title: reg?.title ?? null, config };
}

/**
 * آمار هم‌رشته‌ای‌های ورودی برای پانوشت کارنامه سما
 * («رتبهٔ معدل کل در رشته ورودی / میانگین معدل و واحد هم‌رشته‌ای‌ها»).
 * هم‌رشته‌ای = همان رشته + همان سال ورود (+ همان ترم ورود در حالت ترم) + همان دانشگاه.
 * رتبه ۱ = بالاترین معدل. دانشجویان «عدم مراجعه / انصراف / اخراج» دخیل نیستند.
 * فقط دانشجویان دارای معدل (>۰ واحد موثر) شمرده می‌شوند.
 */
export async function getCohortStats(studentId: number, scope: 'year' | 'term' = 'year'): Promise<{
  scope: 'year' | 'term';
  rank: number | null;
  total: number;
  avgGpa: number | null;
  avgPassed: number | null;
} | null> {
  await requireRole(['ADMIN', 'EDU_EXPERT', 'ARCHIVE_EXPERT', 'MILITARY_OFFICER', 'GRADUATEAFFAIRS']);
  const [me] = await db
    .select({ id: students.id, majorId: students.majorId, entryYear: students.entryYear, entryTerm: students.entryTerm, universityId: students.universityId })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!me || me.majorId == null || me.entryYear == null) return null;
  const conds = [
    eq(students.majorId, me.majorId),
    eq(students.entryYear, me.entryYear),
    // عدم مراجعه / انصراف / اخراج در رتبه دخیل نیستند
    notInArray(students.status, ['NO_SHOW', 'WITHDRAWN', 'EXPELLED']),
  ];
  if (scope === 'term' && me.entryTerm != null) conds.push(eq(students.entryTerm, me.entryTerm));
  if (me.universityId != null) conds.push(eq(students.universityId, me.universityId));
  const cohort = await db
    .select({ id: students.id })
    .from(students)
    .where(and(...conds));
  if (cohort.length === 0) return null;
  const { calculateOfficialGPA } = await import('@/lib/regulations-engine');
  const gpas: { id: number; gpa: number; passed: number }[] = [];
  for (const s of cohort) {
    try {
      const r = await calculateOfficialGPA(s.id);
      if (r.totalUnits > 0 && r.gpa > 0) gpas.push({ id: s.id, gpa: r.gpa, passed: r.passedUnits });
    } catch { /* این دانشجو در آمار نمی‌آید */ }
  }
  if (gpas.length === 0) {
    console.warn(`[cohort] no GPA for major=${me.majorId} entryYear=${me.entryYear} scope=${scope} (cohort=${cohort.length})`);
    return null;
  }
  const mine = gpas.find(g => g.id === studentId);
  const rank = mine ? 1 + gpas.filter(g => g.gpa > mine.gpa).length : null;
  const avgGpa = gpas.reduce((a, g) => a + g.gpa, 0) / gpas.length;
  const avgPassed = gpas.reduce((a, g) => a + g.passed, 0) / gpas.length;
  return { scope, rank, total: gpas.length, avgGpa, avgPassed };
}

/** تغییر آیین‌نامه ملاک دانشجو (از پرونده یا مرکز آیین‌نامه‌ها) + بازمحاسبه کدهای وضعیت همه نمرات */
export async function setStudentRegulationAction(
  studentId: number, regulationId: number,
): Promise<{ ok: boolean; error?: string; scanned?: number; updated?: number }> {
  let user: { id: number; roles: string[] };
  try {
    user = await requireRole(['ADMIN', 'EDU_EXPERT', 'GRADUATEAFFAIRS']);
  } catch {
    return { ok: false, error: 'دسترسی لازم را ندارید.' };
  }
  if (!studentId || !regulationId) return { ok: false, error: 'دانشجو یا آیین‌نامه نامعتبر است.' };
  const uni = await getCurrentUniversity().catch(() => null);
  if (!uni) return { ok: false, error: 'دانشگاه فعال نامشخص است.' };
  const [stuRow] = await db.select({ universityId: students.universityId })
    .from(students).where(eq(students.id, studentId)).limit(1);
  if (!stuRow) return { ok: false, error: 'دانشجو یافت نشد.' };
  if (stuRow.universityId !== null && stuRow.universityId !== uni.id) {
    return { ok: false, error: 'دانشجو متعلق به دانشگاه دیگری است.' };
  }
  try {
    await db.update(students).set({ regulationId }).where(and(
      eq(students.id, studentId),
      or(eq(students.universityId, uni.id), isNull(students.universityId)),
    ));
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'ثبت نشد.' };
  }
  const actorRole = user.roles.includes('ADMIN')
    ? 'ADMIN' as const
    : user.roles.includes('GRADUATEAFFAIRS')
      ? 'GRADUATEAFFAIRS' as const
      : undefined;

  // بازمحاسبه کد وضعیت همه نمرات نهایی دانشجو با آیین‌نامه جدید
  const { resolveSamaGradeStatusCode, syncStudentCourseRegulations } = await import('@/lib/resolve-sama-code');
  const { logGradeChange } = await import('@/lib/grade-change-log');
  const { isPassedStatusCode, REGULATION_FROZEN_CODES } = await import('@/lib/grade-status-codes');
  let scanned = 0;
  let updated = 0;
  try {
    const enrs = await db
      .select({
        enrollmentId: enrollments.id,
        offeringId: enrollments.offeringId,
        courseId: course_offerings.courseId,
        gradeValue: enrollments.gradeValue,
        currentCode: enrollments.samaGradeStatusCode,
      })
      .from(enrollments)
      .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
      .where(and(eq(enrollments.studentId, studentId), eq(enrollments.gradeStatus, 'FINALIZED')));
    scanned = enrs.length;
    for (const enr of enrs) {
      const cur = enr.currentCode?.trim() || null;
      // کد قبولی خاص (مثل ۱۲ جبرانی) که دستی یا تعریفی ثبت شده حفظ شود
      if (cur && cur !== '1' && isPassedStatusCode(cur)) continue;
      // کدهای منجمد (۵/۶/۷/۲۲) هرگز با آبشار آیین‌نامه عوض نمی‌شوند
      if (cur && REGULATION_FROZEN_CODES.has(cur)) continue;
      const correct = await resolveSamaGradeStatusCode(studentId, enr.offeringId, enr.gradeValue, cur);
      if (correct === cur) continue;
      await db
        .update(enrollments)
        .set({
          samaGradeStatusCode: correct,
          originalSamaCode: sql`COALESCE(${enrollments.originalSamaCode}, ${enrollments.samaGradeStatusCode})`,
        })
        .where(eq(enrollments.id, enr.enrollmentId));
      await logGradeChange({
        enrollmentId: enr.enrollmentId,
        studentId,
        offeringId: enr.offeringId,
        action: 'REGULATION_CASCADE',
        oldGradeValue: enr.gradeValue,
        newGradeValue: enr.gradeValue,
        oldGradeStatus: 'FINALIZED',
        newGradeStatus: 'FINALIZED',
        oldSamaStatusCode: cur,
        newSamaStatusCode: correct,
        reason: 'بازبینی خودکار کد وضعیت پس از تغییر آیین‌نامه ملاک دانشجو',
        actorUserId: user.id,
        actorRole,
      });
      updated++;
    }
    // اطمینان زنجیره‌ای هر درس (اثر معدل مردودی پس از قبولی بعدی)
    const courseIds = [...new Set(enrs.map(e => e.courseId))];
    for (const cid of courseIds) {
      try {
        await syncStudentCourseRegulations(studentId, cid, { actorUserId: user.id, actorRole });
      } catch { /* ادامه با بقیه دروس */ }
    }
  } catch { /* آیین‌نامه عوض شده؛ خطای بازبینی کدها را گزارش نمی‌کنیم */ }
  revalidatePath('/admin/students');
  return { ok: true, scanned, updated };
}

export type TranscriptRow = {
  enrollmentId?: number | null;
  offeringId?: number | null;
  termCode: string;
  termTitle: string | null;
  courseCode: string;
  courseTitle: string;
  units: string | null;
  courseType: string | null;
  gradeValue: string | null;
  gradeStatus: string;
  /** عین عنوان ستون «عنوان» فایل وضع نمره (از میز تطبیق GRADE_STATUS) */
  gradeStatusTitle: string | null;
  /** کد خام وضع نمره (markStat) یا samaGradeStatusCode — برای نمایش کوتاه در جدول + راهنمای کد در پایین کارنامه */
  gradeStatusCode: string | null;
  offeringType: string | null;
  /** وضعیت همان نیمسال (از وضعيت نيمسال دانشجويان) + مشروطی فایل */
  termStatusTitle: string | null;
  termProbation: boolean | null;
  /** آیین‌نامه اعمال‌شده روی این درس (فقط وقتی نمره مردودی حذف شده باشد) */
  _excludedByRegulation?: string;
};

/** نقشه کد عددی وضع نمره → عین عنوان فایل مرجع (DB اول، ثابت سراسری fallback) */
async function gradeStatusTitleMap(): Promise<Map<string, string>> {
  const { GRADE_STATUS_CODES } = await import('@/lib/grade-status-codes');
  const map = new Map<string, string>();
  for (const g of GRADE_STATUS_CODES) {
    if (!map.has(g.code)) map.set(g.code, g.title);
  }
  try {
    const rows = await db
      .select({ code: legacy_code_maps.legacyCode, title: legacy_code_maps.legacyTitle })
      .from(legacy_code_maps)
      .where(eq(legacy_code_maps.domain, 'GRADE_STATUS'));
    for (const r of rows) {
      // عین عنوان فایل مرجع دانشگاه (اگر داشت) بر ثابت سراسری مقدم است
      if (r.code && r.title) map.set(r.code, r.title);
    }
  } catch { /* میز تطبیق خالی باشد، ثابت سراسری کافی است */ }
  return map;
}

function markStatOf(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    const ms = String(j?.markStat ?? '').trim();
    return ms || null;
  } catch { return null; }
}

export async function getTranscript(studentId: number): Promise<TranscriptRow[]> {
  await requireRole(['ADMIN', 'EDU_EXPERT', 'ARCHIVE_EXPERT', 'MILITARY_OFFICER', 'GRADUATEAFFAIRS']);
  // 🔒 مرز دانشگاه: کارنامهٔ کامل دادهٔ حساس است. بدون این گیت، یک کارشناس
  //   با یک studentId دلخواه کارنامهٔ دانشجوی دانشگاه دیگر را می‌خواند.
  const uniGate = await requireStudentUniversity(studentId);
  if (!uniGate.ok) return [];
  const [stu] = await db
    .select({ id: students.id, code: students.studentCode, universityCode: universities.code })
    .from(students)
    .leftJoin(universities, eq(universities.id, students.universityId))
    .where(eq(students.id, studentId))
    .limit(1);
  if (!stu) return [];
  // دامنهٔ نمرات قدیمی: legacy_grades ستون دانشگاه ندارد و با sourceCode مرزبندی
  // می‌شود (قرارداد: sourceCode = universities.code). بدون این دامنه، پیوستن
  // روی studentCode کدِ وضعیتِ دانشگاهِ دیگر را روی کارنامه می‌نشاند ⇒ هیچ
  // پیوستِ بی‌دامنه‌ای انجام نمی‌دهیم (حتی وقتی دانشگاه دانشجو NULL است).
  const legacySource = legacySourceCodeFor(stu.universityCode);
  if (!legacySource) {
    console.warn(`[transcript] دانشگاه دانشجوی ${studentId} نامشخص — نمرات سیستم قدیمی نادیده گرفته شد.`);
  }
  const titleMap = await gradeStatusTitleMap();
  // وضعیت نیمسال‌ها (عنوان + مشروطی فایل) — یک کوئری برای همه ترم‌ها
  const termStates = new Map<string, { title: string | null; probation: boolean | null }>();
  try {
    const stRows = await db
      .select({ termCode: student_term_states.termCode, title: student_term_states.statusTitle, probation: student_term_states.isProbation })
      .from(student_term_states)
      .where(eq(student_term_states.studentId, studentId));
    for (const r of stRows) {
      termStates.set(r.termCode, {
        title: r.title,
        probation: r.probation == null ? null : Number(r.probation) === 1,
      });
    }
  } catch { /* جدول هنوز ساخته نشده باشد */ }
  const exactTitle = (markStat: string | null): string | null =>
    markStat ? titleMap.get(markStat) ?? null : null;
  // enrollments (سامانه جدید — از سما) + اتصال raw وضع نمره از legacy
  const ens = await db
    .select({
      enrollmentId: enrollments.id,
      offeringId: enrollments.offeringId,
      termCode: academic_terms.termCode,
      termTitle: academic_terms.title,
      courseCode: courses.code,
      courseTitle: courses.title,
      units: courses.units,
      courseType: courses.courseType,
      gradeValue: enrollments.gradeValue,
      gradeStatus: enrollments.gradeStatus,
      offeringType: course_offerings.offeringType,
      samaGradeStatusCode: enrollments.samaGradeStatusCode,
      legacyRaw: sql<string | null>`lg.raw`,
      legacySource: sql<string | null>`lg."sourceCode"`,
    })
    .from(enrollments)
    .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .innerJoin(academic_terms, eq(academic_terms.id, course_offerings.termId))
    .leftJoin(
      sql`legacy_grades lg`,
      legacySource
        ? sql`lg."studentCode" = ${stu.code} AND lg."termCode" = ${academic_terms.termCode} AND lg."courseCode" = ${courses.code} AND lg."sourceCode" = ${legacySource}`
        : sql`false`,
    )
    .where(eq(enrollments.studentId, studentId))
    .orderBy(desc(academic_terms.termCode), courses.code);
  if (ens.length) {
    const rows: TranscriptRow[] = ens.map(r => {
      const ts = termStates.get(r.termCode);
      // فقط raw همین مبدأ حق مهر کد وضعیت را دارد (نه ردیف هم‌کدِ دانشگاه دیگر)
      const ownRaw = legacyRowOfSource([{ sourceCode: r.legacySource }], legacySource).length ? r.legacyRaw : null;
      // اولویت: samaGradeStatusCode از enrollments (به‌روز توسط ادمین) و سپس markStat قدیمی
      const code = r.samaGradeStatusCode ?? markStatOf(ownRaw) ?? null;
      return {
        enrollmentId: r.enrollmentId,
        offeringId: r.offeringId,
        termCode: r.termCode,
        termTitle: r.termTitle,
        courseCode: r.courseCode,
        courseTitle: r.courseTitle,
        units: r.units ? String(r.units) : null,
        courseType: r.courseType,
        gradeValue: r.gradeValue ? String(r.gradeValue) : null,
        gradeStatus: r.gradeStatus,
        gradeStatusTitle: exactTitle(code),
        gradeStatusCode: code,
        offeringType: r.offeringType,
        termStatusTitle: ts?.title ?? null,
        termProbation: ts?.probation ?? null,
      };
    });
    // دروس حذف‌شده‌ای که enrollment ندارند (مثل حذف آموزشی کد ۷) فقط برای نمایش به کارنامه اضافه می‌شوند؛
    // حذف در حذف و اضافه (کد ۱-) در کارنامه نمی‌آید. این ردیف‌ها در جمع واحد/معدل اثر ندارند.
    try {
      const { isDroppedStatusCode } = await import('@/lib/grade-status-codes');
      const seen = new Set(ens.map(e => `${e.termCode}|${e.courseCode}`));
      const legRows = legacySource
        ? await db
            .select({
              sourceCode: legacy_grades.sourceCode,
              termCode: legacy_grades.termCode,
              courseCode: legacy_grades.courseCode,
              courseTitle: legacy_grades.courseTitle,
              units: legacy_grades.units,
              gradeValue: legacy_grades.gradeValue,
              gradeStatus: legacy_grades.gradeStatus,
              raw: legacy_grades.raw,
            })
            .from(legacy_grades)
            .where(and(eq(legacy_grades.studentCode, stu.code), eq(legacy_grades.sourceCode, legacySource)))
            .limit(1000)
        : [];
      const legs = legacyRowOfSource(legRows, legacySource);
      for (const l of legs) {
        if (seen.has(`${l.termCode}|${l.courseCode}`)) continue;
        const code = markStatOf(l.raw);
        if (!code || code === '-1' || !isDroppedStatusCode(code)) continue;
        const ts = termStates.get(l.termCode);
        rows.push({
          enrollmentId: null,
          offeringId: null,
          termCode: l.termCode,
          termTitle: null,
          courseCode: l.courseCode,
          courseTitle: l.courseTitle || `درس ${l.courseCode}`,
          units: l.units ? String(l.units) : null,
          courseType: null,
          gradeValue: l.gradeValue ? String(l.gradeValue) : null,
          gradeStatus: l.gradeStatus,
          gradeStatusTitle: exactTitle(code),
          gradeStatusCode: code,
          offeringType: null,
          termStatusTitle: ts?.title ?? null,
          termProbation: ts?.probation ?? null,
        });
      }
      rows.sort((a, b) => b.termCode.localeCompare(a.termCode, 'en') || a.courseCode.localeCompare(b.courseCode, 'en'));
    } catch { /* بدون ردیف حذف، همان نمرات ثبت‌شده برمی‌گردد */ }
    return rows;
  }
  // fallback: legacy_grades (اگر هنوز promote نشده) — فقط مبدأ همین دانشگاه
  const fallbackRows = legacySource
    ? await db
        .select({
          sourceCode: legacy_grades.sourceCode,
          termCode: legacy_grades.termCode,
          courseCode: legacy_grades.courseCode,
          courseTitle: legacy_grades.courseTitle,
          units: legacy_grades.units,
          gradeValue: legacy_grades.gradeValue,
          gradeStatus: legacy_grades.gradeStatus,
          raw: legacy_grades.raw,
        })
        .from(legacy_grades)
        .where(and(eq(legacy_grades.studentCode, stu.code), eq(legacy_grades.sourceCode, legacySource)))
        .orderBy(desc(legacy_grades.termCode), legacy_grades.courseCode)
        .limit(500)
    : [];
  const legs = legacyRowOfSource(fallbackRows, legacySource);
  return legs.map(r => {
    const ts = termStates.get(r.termCode);
    const code = markStatOf(r.raw);
    return {
      enrollmentId: null,
      offeringId: null,
      termCode: r.termCode,
      termTitle: null,
      courseCode: r.courseCode,
      courseTitle: r.courseTitle || `درس ${r.courseCode}`,
      units: r.units ? String(r.units) : null,
      courseType: null,
      gradeValue: r.gradeValue ? String(r.gradeValue) : null,
      gradeStatus: r.gradeStatus,
      gradeStatusTitle: exactTitle(code),
      gradeStatusCode: code,
      offeringType: null,
      termStatusTitle: ts?.title ?? null,
      termProbation: ts?.probation ?? null,
    };
  });
}

/** فعال/غیرفعال‌سازی «کامل» حساب کاربر (دانشجو / استاد / کاربر) — فقط ADMIN
 *  غیرفعال‌سازی = تمام نشست‌ها حذف می‌شوند، پرونده‌های استاف/دانشجو غیرفعال،
 *  کدهای یک‌بار مصرف (OTP) معلق لغو می‌شوند. ورود وب، کارتابل، برنامه‌ریزی
 *  و APIها برای این کاربر قطع می‌شود. */
export async function setUserActiveAction(
  userId: number, active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole(['ADMIN']);
  } catch {
    return { ok: false, error: 'فقط مدیر سیستم (ADMIN) اجازه فعال/غیرفعال‌سازی کاربر را دارد.' };
  }
  if (!userId) return { ok: false, error: 'کاربر نامعتبر است.' };
  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ isActive: active ? 1 : 0 }).where(eq(users.id, userId));
      if (!active) {
        // ۱) تمام نشست‌های فعال کاربر را حذف می‌کنیم (خارج از سامانه می‌شوند)
        await tx.delete(sessions).where(eq(sessions.userId, userId));
        // ۲) پرونده‌های استاف غیرفعال شوند تا در لیست‌های برنامه‌ریزی/مدیریت ناپدید شوند
        await tx.update(staff).set({ isActive: 0 }).where(eq(staff.userId, userId));
        // ۳) OTPهای معلقِ مرتبط با استاف‌های این کاربر را غیرفعال کنیم
        const staffIds = await tx.select({ id: staff.id }).from(staff).where(eq(staff.userId, userId));
        const sids = staffIds.map(s => s.id);
        if (sids.length) {
          await tx.delete(signature_otps).where(and(eq(signature_otps.isUsed, 0), inArray(signature_otps.staffId, sids)));
          await tx.delete(doc_sign_otps).where(and(eq(doc_sign_otps.isUsed, 0), inArray(doc_sign_otps.staffId, sids)));
          await tx.delete(grade_submission_otps).where(and(eq(grade_submission_otps.isUsed, 0), inArray(grade_submission_otps.staffId, sids)));
        }
      } else {
        // فعال‌سازی: پرونده استاف دوباره فعال می‌شود
        await tx.update(staff).set({ isActive: 1 }).where(eq(staff.userId, userId));
      }
    });
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'ثبت نشد.' };
  }
  revalidatePath('/admin/students');
  return { ok: true };
}

/** مشخص کردن نقش‌های یک حساب بر اساس ردیف‌های دانشجوی/کارمند — ردیف‌های جاافتادهٔ user_roles ساخته می‌شوند */
async function ensureAccountRoles(userId: number): Promise<void> {
  const [stu] = await db.select({ id: students.id }).from(students).where(eq(students.userId, userId)).limit(1);
  const [stf] = await db.select({ id: staff.id }).from(staff).where(eq(staff.userId, userId)).limit(1);
  for (const code of [stu ? 'STUDENT' : null, stf ? 'PROFESSOR' : null].filter(Boolean) as string[]) {
    const [r] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, code)).limit(1);
    if (r) {
      await db.insert(user_roles).values({ userId, roleId: r.id })
        .onConflictDoNothing({ target: [user_roles.userId, user_roles.roleId] })
        .catch(() => {});
      clearPermissionCache();
    }
  }
}

/**
 * تغییر رمز عبور کاربر توسط مدیر — فقط ADMIN.
 * 🔒 کف/سقف طول دقیقاً با استاندارد سامانه (changePassword در auth.ts: ۱۰ تا ۱۲۸)
 * یکی است؛ پیش از این ۴ تا ۶۴ بود و رمز «abcd» پذیرفته می‌شد.
 */
export async function resetUserPasswordAction(
  userId: number, newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole(['ADMIN']);
  } catch {
    return { ok: false, error: 'فقط مدیر سیستم (ADMIN) اجازه تغییر رمز کاربران را دارد.' };
  }
  const pw = String(newPassword || '').trim();
  if (!userId) return { ok: false, error: 'کاربر نامعتبر است.' };
  const policyError = checkNewPassword(pw, { minLength: PASSWORD_MIN_LENGTH_STUDENT });
  if (policyError) return { ok: false, error: policyError };
  try {
    const passwordHash = await hashPassword(pw);
    // 🔒 ریست رمز = ابطال نشست‌ها در همان تراکنش (الگوی setUserActiveAction)
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, mustChangePassword: 1 }).where(eq(users.id, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    });
    await ensureAccountRoles(userId);
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'ثبت نشد.' };
  }
  revalidatePath('/admin/students');
  return { ok: true };
}

/**
 * بازنشانی گروهی رمز حساب‌های دانشجویان/اساتید با رمز یکبارمصرف تصادفی — فقط ADMIN.
 * نام تابع برای سازگاری با کلاینت حفظ شده است؛ دیگر رمز از کد ملی ساخته نمی‌شود.
 */
export async function bulkResetToNationalCodeAction(
  scope: 'student' | 'professor',
): Promise<{ ok: boolean; error?: string; count?: number; passwords?: { nationalCode: string; password: string }[] }> {
  try {
    await requireRole(['ADMIN']);
  } catch {
    return { ok: false, error: 'فقط مدیر سیستم (ADMIN) اجازه این عملیات را دارد.' };
  }
  const scopeWhere = scope === 'professor'
    ? `EXISTS (SELECT 1 FROM staff st WHERE st."userId" = users.id)`
    : `EXISTS (SELECT 1 FROM students st WHERE st."userId" = users.id)`;
  // 🔧 رفع باگ SQL: در INSERT زیر جدول با نام مستعار u آمده، پس شرط دامنه هم باید u.id باشد
  const scopeWhereAlias = scope === 'professor'
    ? `EXISTS (SELECT 1 FROM staff st WHERE st."userId" = u.id)`
    : `EXISTS (SELECT 1 FROM students st WHERE st."userId" = u.id)`;
  const roleCode = scope === 'professor' ? 'PROFESSOR' : 'STUDENT';
  const uni = await getCurrentUniversity().catch(() => null);
  if (!uni) return { ok: false, error: 'دانشگاه فعال نامشخص است.' };
  const uniWhere = sql`(users."universityId" = ${uni.id} OR users."universityId" IS NULL)`;
  try {
    type ResetRow = { id: number; nationalCode: string | null };
    const res = await db.execute(sql`
      SELECT id, "nationalCode" FROM users
      WHERE "isActive" = 1 AND "nationalCode" IS NOT NULL AND LENGTH("nationalCode") = 10 AND ${sql.raw(scopeWhere)} AND ${uniWhere}
    `);
    const rows = execRows<ResetRow>(res);
    let count = 0;
    const affectedIds: number[] = [];
    // ⚠️ رمزهای تولیدشده فقط یک‌بار به مدیر بازگردانده می‌شوند؛ در دیتابیس فقط هش ذخیره می‌شود.
    const generatedPasswords: { nationalCode: string; password: string }[] = [];
    // 🔒 ریست رمز = ابطال نشست‌ها در همان تراکنش (الگوی setUserActiveAction)
    await db.transaction(async (tx) => {
      // ① تولید هش (bcrypt عمداً کند است — ترتیبی می‌ماند)
      const hashes: { id: number; hash: string }[] = [];
      for (const row of rows) {
        if (!row.nationalCode) continue;
        // 🔐 رمز یکبارمصرف تصادفی — دیگر از کد ملی مشتق نمی‌شود (کد ملی قابل‌حدس است)
        const oneTimePassword = randomOneTimePassword();
        const hash = await hashPassword(oneTimePassword);
        hashes.push({ id: Number(row.id), hash });
        affectedIds.push(Number(row.id));
        generatedPasswords.push({ nationalCode: String(row.nationalCode), password: oneTimePassword });
        count++;
      }
      // ② نوشتن هش‌ها دسته‌ای — پیش‌تر یک UPDATE به‌ازای هر کاربر می‌رفت
      //    (مثلاً ۲٬۰۰۰ کاربر = ۲٬۰۰۰ رفت‌وبرگشت داخل یک تراکنش طولانی).
      const BATCH = 200;
      for (let i = 0; i < hashes.length; i += BATCH) {
        const chunk = hashes.slice(i, i + BATCH);
        const valuesSql = sql.join(chunk.map(h => sql`(${h.id}::int, ${h.hash}::text)`), sql`, `);
        await tx.execute(sql`
          UPDATE users AS u SET "passwordHash" = v.hash, "mustChangePassword" = 1
          FROM (VALUES ${valuesSql}) AS v(id, hash)
          WHERE u.id = v.id
        `);
      }
      if (affectedIds.length) {
        await tx.delete(sessions).where(inArray(sessions.userId, affectedIds));
      }
    });
    // ساخت نقش برای حساب‌های گروهی که ردیف user_roles ندارند
    await db.execute(sql`
      INSERT INTO user_roles ("userId", "roleId")
      SELECT u.id, r.id FROM users u
      JOIN roles r ON r.code = ${roleCode}
      WHERE ${sql.raw(scopeWhereAlias)}
        AND (u."universityId" = ${uni.id} OR u."universityId" IS NULL)
        AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur."userId" = u.id AND ur."roleId" = r.id)
      ON CONFLICT ("userId", "roleId") DO NOTHING
    `);
    return { ok: true, count, passwords: generatedPasswords };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'انجام نشد.' };
  } finally {
    revalidatePath('/admin/students');
  }
}

/** بازنشانی گروهی رمز حساب‌های دانشجویان/اساتید (+ ساخت نقش‌های جاافتاده) — فقط ADMIN */
export async function bulkResetPasswordsAction(
  scope: 'student' | 'professor', newPassword: string,
): Promise<{ ok: boolean; error?: string; count?: number }> {
  try {
    await requireRole(['ADMIN']);
  } catch {
    return { ok: false, error: 'فقط مدیر سیستم (ADMIN) اجازه این عملیات را دارد.' };
  }
  const pw = String(newPassword || '').trim();
  // 🔒 همان استاندارد سامانه — رمز مشترک گروهی هم نباید ضعیف باشد.
  const policyError = checkNewPassword(pw, { minLength: PASSWORD_MIN_LENGTH_STUDENT });
  if (policyError) return { ok: false, error: policyError };
  const scopeWhere = scope === 'professor'
    ? `EXISTS (SELECT 1 FROM staff st WHERE st."userId" = users.id)`
    : `EXISTS (SELECT 1 FROM students st WHERE st."userId" = users.id)`;
  // 🔧 رفع باگ SQL: در INSERT زیر جدول با نام مستعار u آمده، پس شرط دامنه هم باید u.id باشد
  const scopeWhereAlias = scope === 'professor'
    ? `EXISTS (SELECT 1 FROM staff st WHERE st."userId" = u.id)`
    : `EXISTS (SELECT 1 FROM students st WHERE st."userId" = u.id)`;
  const roleCode = scope === 'professor' ? 'PROFESSOR' : 'STUDENT';
  const uni2 = await getCurrentUniversity().catch(() => null);
  if (!uni2) return { ok: false, error: 'دانشگاه فعال نامشخص است.' };
  const uniWhere2 = sql`(users."universityId" = ${uni2.id} OR users."universityId" IS NULL)`;
  try {
    const hash = await hashPassword(pw);
    const idsRes = await db.execute(sql<{ id: number }>`
      SELECT id FROM users
      WHERE "isActive" = 1 AND ${sql.raw(scopeWhere)} AND ${uniWhere2}
    `);
    const idsRows = execRows<{ id: number }>(idsRes);
    const affectedIds = idsRows.map((r) => Number(r.id)).filter(Number.isInteger);
    // 🔒 ریست رمز = ابطال نشست‌ها در همان تراکنش (الگوی setUserActiveAction)
    const upd = await db.transaction(async (tx) => {
      const u = await tx.execute(sql`
        UPDATE users SET "passwordHash" = ${hash}, "mustChangePassword" = 1
        WHERE "isActive" = 1 AND ${sql.raw(scopeWhere)} AND ${uniWhere2}
      `);
      if (affectedIds.length) {
        await tx.delete(sessions).where(inArray(sessions.userId, affectedIds));
      }
      return u;
    });
    const count = execRowCount(upd);
    // ساخت نقش برای حساب‌های گروهی که ردیف user_roles ندارند
    await db.execute(sql`
      INSERT INTO user_roles ("userId", "roleId")
      SELECT u.id, r.id FROM users u
      JOIN roles r ON r.code = ${roleCode}
      WHERE ${sql.raw(scopeWhereAlias)}
        AND (u."universityId" = ${uni2.id} OR u."universityId" IS NULL)
        AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur."userId" = u.id AND ur."roleId" = r.id)
      ON CONFLICT ("userId", "roleId") DO NOTHING
    `);
    return { ok: true, count };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'انجام نشد.' };
  } finally {
    revalidatePath('/admin/students');
  }
}

/** اجبار تغییر رمز در ورود بعدی برای یک دسته (رمز فعلی دست نمی‌خورد) — فقط ADMIN */
export async function bulkForcePasswordChangeAction(
  scope: 'student' | 'professor',
): Promise<{ ok: boolean; error?: string; count?: number }> {
  try {
    await requireRole(['ADMIN']);
  } catch {
    return { ok: false, error: 'فقط مدیر سیستم (ADMIN) اجازه این عملیات را دارد.' };
  }
  const scopeWhere = scope === 'professor'
    ? `EXISTS (SELECT 1 FROM staff st WHERE st."userId" = users.id)`
    : `EXISTS (SELECT 1 FROM students st WHERE st."userId" = users.id)`;
  const uni = await getCurrentUniversity().catch(() => null);
  if (!uni) return { ok: false, error: 'دانشگاه فعال نامشخص است.' };
  const uniWhere = sql`(users."universityId" = ${uni.id} OR users."universityId" IS NULL)`;
  try {
    const idsRes = await db.execute(sql<{ id: number }>`
      SELECT id FROM users
      WHERE "isActive" = 1 AND ${sql.raw(scopeWhere)} AND ${uniWhere}
    `);
    const idsRows = execRows<{ id: number }>(idsRes);
    const affectedIds = idsRows.map((r) => Number(r.id)).filter(Number.isInteger);
    // 🔒 اجبار تغییر رمز = ابطال نشست‌ها در همان تراکنش (الگوی setUserActiveAction)
    const upd = await db.transaction(async (tx) => {
      const u = await tx.execute(sql`
        UPDATE users SET "mustChangePassword" = 1
        WHERE "isActive" = 1 AND ${sql.raw(scopeWhere)} AND ${uniWhere}
      `);
      if (affectedIds.length) {
        await tx.delete(sessions).where(inArray(sessions.userId, affectedIds));
      }
      return u;
    });
    const count = execRowCount(upd);
    return { ok: true, count };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'انجام نشد.' };
  } finally {
    revalidatePath('/admin/students');
  }
}

/** بازسازی نقش‌های جاافتاده برای همهٔ حساب‌ها (دانشجو=STUDENT، کارمند=PROFESSOR) — فقط ADMIN */
export async function backfillRolesAction(): Promise<{ ok: boolean; error?: string; inserted?: number }> {
  try {
    await requireRole(['ADMIN']);
  } catch {
    return { ok: false, error: 'فقط مدیر سیستم (ADMIN) اجازه این عملیات را دارد.' };
  }
  try {
    let inserted = 0;
    for (const [code, srcTable] of [['STUDENT', 'students'], ['PROFESSOR', 'staff']] as const) {
      const ins = await db.execute(sql`
        INSERT INTO user_roles ("userId", "roleId")
        SELECT u.id, r.id FROM users u
        JOIN roles r ON r.code = ${code}
        WHERE ${sql.raw(`EXISTS (SELECT 1 FROM ${srcTable} st WHERE st."userId" = u.id)`)}
          AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur."userId" = u.id AND ur."roleId" = r.id)
        ON CONFLICT ("userId", "roleId") DO NOTHING
      `);
      inserted += execRowCount(ins);
    }
    return { ok: true, inserted };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'انجام نشد.' };
  } finally {
    revalidatePath('/admin/students');
  }
}

/** ثبت حساب کاربری جدید «استاد/کارکن» (مثل کارشناس اداری یا همکار آموزشی) — فقط ADMIN */
export async function createStaffExpertAction(input: {
  nationalCode: string; firstName: string; lastName: string;
  fatherName?: string; birthCertNo?: string; gender?: string; mobile?: string;
  email?: string; staffCode?: string; staffType?: string;
}): Promise<{ ok: boolean; error?: string; userId?: number }> {
  try {
    await requireRole(['ADMIN']);
  } catch {
    return { ok: false, error: 'فقط مدیر سیستم (ADMIN) می‌تواند حساب ایجاد کند.' };
  }
  const nc = String(input.nationalCode || '').trim();
  const fn = String(input.firstName || '').trim();
  const ln = String(input.lastName || '').trim();
  const sc = String(input.staffCode || '').trim() || nc;
  if (!nc || !fn || !ln) return { ok: false, error: 'کد ملی، نام و نام خانوادگی الزامی است.' };
  if (!/^\d{10}$/.test(nc)) return { ok: false, error: 'کد ملی باید ۱۰ رقم باشد.' };
  const uni = await getCurrentUniversity().catch(() => null);
  if (!uni) return { ok: false, error: 'دانشگاه فعال نامشخص است.' };
  try {
    const dupNc = await db.select({ id: users.id }).from(users).where(and(eq(users.nationalCode, nc), or(eq(users.universityId, uni.id), isNull(users.universityId)))).limit(1);
    if (dupNc.length) return { ok: false, error: 'کاربری با این کد ملی از قبل وجود دارد.' };
    const dupSc = await db.select({ id: staff.id }).from(staff).where(and(eq(staff.staffCode, sc), or(eq(staff.universityId, uni.id), isNull(staff.universityId)))).limit(1);
    if (dupSc.length) return { ok: false, error: 'کد پرسنلی تکراری است.' };
    const tempPassword = randomBytes(9).toString('base64url').slice(0, 12);
            const passwordHash = await hashPassword(tempPassword);
    const [u] = await db.insert(users).values({
      universityId: uni.id,
      nationalCode: nc, firstName: fn, lastName: ln,
      fatherName: String(input.fatherName || '').trim() || null,
      birthCertNo: String(input.birthCertNo || '').trim() || null,
      gender: String(input.gender || '').trim() || null,
      mobile: String(input.mobile || '').trim() || null,
      email: String(input.email || '').trim() || null,
      passwordHash, isActive: 1, mustChangePassword: 1,
    }).returning({ id: users.id });
    await db.insert(staff).values({
      universityId: uni.id,
      userId: u.id, staffCode: sc,
      staffType: String(input.staffType || '').trim() || 'اداری',
    }).onConflictDoNothing();
    // اگر نوع سمت آموزشی است، همین‌جا نقش «استاد» را می‌دهیم تا بدون نقش نماند
    const stType = String(input.staffType || '').trim();
    if (stType.includes('هیئت') || stType.includes('مربی') || stType.includes('استاد')) {
      const [prof] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, 'PROFESSOR')).limit(1);
      if (prof) {
        await db.insert(user_roles).values({ userId: u.id, roleId: prof.id }).onConflictDoNothing();
        clearPermissionCache();
      }
    }
    revalidatePath('/admin/students');
    revalidatePath('/admin/staff');
    return { ok: true, userId: u.id };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'ثبت نشد.' };
  }
}

/** تنظیم نقش‌های یک کاربر (کارشناس/استاد) — فقط ADMIN؛ از تب اساتید در پنل دانشجویان */
export async function saveUserRolesAction(userId: number, roleIds: number[]): Promise<{ ok: boolean; error?: string; added?: number; removed?: number }> {
  try {
    await requireRole(['ADMIN']);
  } catch {
    return { ok: false, error: 'فقط مدیر سیستم (ADMIN) می‌تواند نقش‌ها را تغییر دهد.' };
  }
  if (!userId || !Number.isInteger(userId)) return { ok: false, error: 'کاربر نامعتبر است.' };
  const me = await getSessionUser();
  const want = new Set(roleIds.map(Number).filter(Number.isInteger));
  const have = new Set((await db.select({ roleId: user_roles.roleId }).from(user_roles).where(eq(user_roles.userId, userId))).map(x => x.roleId));
  // 🔒 گارد قفل‌شدن: مدیر ارشد نباید نقش ADMIN خودش را بردارد
  if (want.size < have.size) {
    const [adm] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, 'ADMIN')).limit(1);
    if (adm && me?.id === userId && have.has(adm.id) && !want.has(adm.id)) {
      return { ok: false, error: 'نقش «مدیر ارشد» را نمی‌توان از خودتان برداشت (خطر قفل‌شدن سامانه).' };
    }
  }
  let added = 0;
  let removed = 0;
  // 🔒 تغییر نقش = ابطال نشست‌ها در همان تراکنش تا مجوزهای کش‌شدهٔ نشست‌های باز سوءاستفاده نشوند
  await db.transaction(async (tx) => {
    for (const rid of [...want]) {
      if (!have.has(rid)) {
        await tx.insert(user_roles).values({ userId, roleId: rid }).onConflictDoNothing().catch(() => {});
        added++;
      }
    }
    for (const rid of [...have]) {
      if (!want.has(rid)) {
        await tx.delete(user_roles).where(and(eq(user_roles.userId, userId), eq(user_roles.roleId, rid)));
        removed++;
      }
    }
    if (added || removed) {
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    }
  });
  if (added || removed) clearPermissionCache();
  revalidatePath('/admin/students');
  return { ok: true, added, removed };
}

/** فیلدهای قابل‌ذخیرهٔ پروندهٔ دانشجو (هم‌گام با تفاوت‌های types.ts) */
export type StudentProfilePatch = {
  fatherName?: string | null;
  birthCertNo?: string | null;
  placeOfBirth?: string | null;
  placeOfIssue?: string | null;
  gender?: string | null;
  mobile?: string | null;
  email?: string | null;
  postalCode?: string | null;
  address?: string | null;
  passportNumber?: string | null;
  nationality?: string | null;
  advisorCode?: string | null;
  documentStatus?: string | null;
  scholarshipType?: string | null;
  militaryStatus?: string | null;
  militaryExemptionNo?: string | null;
  homeTell?: string | null;
  studentCardStatus?: string | null;
  archiveNo?: string | null;
  parvandehNo?: string | null;
  dormName?: string | null;
  dormRoom?: string | null;
  hasDorm?: number | null;
  guardianJobTitle?: string | null;
  guardianPhone?: string | null;
  guardianAddress?: string | null;
  guardianEmail?: string | null;
  diplomaType?: string | null;
  diplomaPlace?: string | null;
  diplomaYear?: string | null;
  diplomaGrade?: string | null;
  pishdPlace?: string | null;
  pishdYear?: string | null;
  pishdGrade?: string | null;
  tuitionType?: string | null;
  tuitionPayer?: number | null;
  englishExamType?: string | null;
  englishScore?: string | null;
  certIssued3m?: number | null;
  documentDeficiency?: string | null;
  unitsRemaining?: number | null;
  eqSemesters?: number | null;
  entryYear?: number | null;
  entryTerm?: number | null;
  entryDate?: string | null;
};

/** Zod allow-list گیت اعتبارسنجی وصلهٔ پروندهٔ دانشجو (maxها هم‌گام با slicing داخل اکشن) */
const studentProfilePatchSchema = z.object({
  fatherName: z.coerce.string().max(100).nullish(),
  birthCertNo: z.coerce.string().max(20).nullish(),
  placeOfBirth: z.coerce.string().max(150).nullish(),
  placeOfIssue: z.coerce.string().max(150).nullish(),
  gender: z.coerce.string().max(10).nullish(),
  mobile: z.coerce.string().max(11).nullish(),
  email: z.coerce.string().max(150).nullish(),
  postalCode: z.coerce.string().max(10).nullish(),
  address: z.coerce.string().max(300).nullish(),
  passportNumber: z.coerce.string().max(20).nullish(),
  nationality: z.coerce.string().max(10).nullish(),
  advisorCode: z.coerce.string().max(300).nullish(),
  documentStatus: z.coerce.string().max(300).nullish(),
  scholarshipType: z.coerce.string().max(300).nullish(),
  militaryStatus: z.coerce.string().max(300).nullish(),
  militaryExemptionNo: z.coerce.string().max(300).nullish(),
  homeTell: z.coerce.string().max(300).nullish(),
  studentCardStatus: z.coerce.string().max(300).nullish(),
  archiveNo: z.coerce.string().max(300).nullish(),
  parvandehNo: z.coerce.string().max(300).nullish(),
  dormName: z.coerce.string().max(300).nullish(),
  dormRoom: z.coerce.string().max(300).nullish(),
  guardianJobTitle: z.coerce.string().max(300).nullish(),
  guardianPhone: z.coerce.string().max(300).nullish(),
  guardianAddress: z.coerce.string().max(300).nullish(),
  guardianEmail: z.coerce.string().max(300).nullish(),
  diplomaType: z.coerce.string().max(300).nullish(),
  diplomaPlace: z.coerce.string().max(300).nullish(),
  diplomaYear: z.coerce.string().max(300).nullish(),
  diplomaGrade: z.coerce.string().max(300).nullish(),
  pishdPlace: z.coerce.string().max(300).nullish(),
  pishdYear: z.coerce.string().max(300).nullish(),
  pishdGrade: z.coerce.string().max(300).nullish(),
  tuitionType: z.coerce.string().max(300).nullish(),
  englishExamType: z.coerce.string().max(300).nullish(),
  englishScore: z.coerce.string().max(300).nullish(),
  documentDeficiency: z.coerce.string().max(300).nullish(),
  entryDate: z.coerce.string().max(300).nullish(),
  hasDorm: z.coerce.number().nullish(),
  tuitionPayer: z.coerce.number().nullish(),
  certIssued3m: z.coerce.number().nullish(),
  unitsRemaining: z.coerce.number().nullish(),
  eqSemesters: z.coerce.number().nullish(),
  entryYear: z.coerce.number().int().min(1300).max(1500).nullish(),
  entryTerm: z.coerce.number().int().min(1).max(3).nullish(),
}).strict();

/** ذخیرهٔ تغییرات پروندهٔ دانشجو (هویت + تکمیلی سما) توسط ادمین — فقط ADMIN */
export async function updateStudentProfileAction(
  studentId: number, patch: StudentProfilePatch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole(['ADMIN']);
  } catch {
    return { ok: false, error: 'فقط مدیر سیستم (ADMIN) اجازه ویرایش پروندهٔ دانشجو را دارد.' };
  }
  if (!z.coerce.number().int().positive().safeParse(studentId).success) return { ok: false, error: 'شناسهٔ دانشجو یا مقادیر نامعتبر است.' };
  const gated = studentProfilePatchSchema.safeParse(patch);
  if (!gated.success) return { ok: false, error: gated.error.errors[0]?.message ?? 'مقادیر نامعتبر است.' };
  if (!studentId || !patch || typeof patch !== 'object') return { ok: false, error: 'شناسهٔ دانشجو یا مقادیر نامعتبر است.' };
  const uni = await getCurrentUniversity().catch(() => null);
  if (!uni) return { ok: false, error: 'دانشگاه فعال نامشخص است.' };
  const [row] = await db.select({ userId: students.userId, universityId: students.universityId })
    .from(students).where(eq(students.id, studentId)).limit(1);
  if (!row) return { ok: false, error: 'دانشجو یافت نشد.' };
  if (row.universityId !== null && row.universityId !== uni.id) {
    return { ok: false, error: 'دانشجو متعلق به دانشگاه دیگری است.' };
  }
  const clean = (v: unknown, max: number) => {
    if (v == null) return undefined;
    const s = String(v).trim();
    return s === '' ? null : s.slice(0, max);
  };
  const cleanNum = (v: unknown) => {
    if (v == null) return undefined;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };
  try {
    // ── سال/ترم ورود: سال ۱۳۰۰..۱۵۰۰، ترم ۱..۳ (می‌آید از کد ورود ۵ رقمی کلاینت) ──
    if ('entryYear' in patch || 'entryTerm' in patch) {
      const ey = patch.entryYear == null ? undefined : Number(patch.entryYear);
      const et = patch.entryTerm == null ? undefined : Number(patch.entryTerm);
      if (ey !== undefined && (!Number.isInteger(ey) || ey < 1300 || ey > 1500)) {
        return { ok: false, error: 'سال ورود باید عددی صحیح بین ۱۳۰۰ تا ۱۵۰۰ باشد.' };
      }
      if (et !== undefined && (!Number.isInteger(et) || et < 1 || et > 3)) {
        return { ok: false, error: 'ترم ورود باید ۱ (مهر)، ۲ (بهمن) یا ۳ (تابستان) باشد.' };
      }
    }
    const userSet: Record<string, unknown> = {};
    const us = [
      ['fatherName', 100], ['birthCertNo', 20], ['placeOfBirth', 150], ['placeOfIssue', 150],
      ['gender', 10], ['mobile', 11], ['email', 150], ['postalCode', 10], ['address', 300],
      ['passportNumber', 20], ['nationality', 10],
    ] as const;
    for (const [k, max] of us) {
      if (k in patch) { const v = clean((patch as Record<string, unknown>)[k], max); if (v !== undefined) userSet[k] = v; }
    }
    // محل تولد/صدور از دراپ‌داون geo می‌آید (عنوان) — کد وزارت شهر هم‌زمان
    // در birthPlaceCode/issuePlaceCode می‌نشیند تا ثمین کد دقیق داشته باشد.
    // اگر عنوان به دقیقاً یک شهر نخورد، کد قبلی دست‌نخورده می‌ماند.
    if (typeof userSet.placeOfBirth === 'string') {
      const hit = await resolveCityMinistry(userSet.placeOfBirth).catch(() => null);
      if (hit) userSet.birthPlaceCode = hit.cityCode;
    }
    if (typeof userSet.placeOfIssue === 'string') {
      const hit = await resolveCityMinistry(userSet.placeOfIssue).catch(() => null);
      if (hit) userSet.issuePlaceCode = hit.cityCode;
    }
    if (Object.keys(userSet).length) {
      await db.update(users).set(userSet as never).where(eq(users.id, row.userId));
    }
    const stuSet: Record<string, unknown> = {};
    const ss = [
      'advisorCode', 'documentStatus', 'scholarshipType', 'militaryStatus', 'militaryExemptionNo', 'homeTell',
      'studentCardStatus', 'archiveNo', 'parvandehNo', 'dormName', 'dormRoom', 'guardianJobTitle',
      'guardianPhone', 'guardianAddress', 'guardianEmail', 'diplomaType', 'diplomaPlace',
      'diplomaYear', 'diplomaGrade', 'pishdPlace', 'pishdYear', 'pishdGrade', 'tuitionType',
      'englishExamType', 'englishScore', 'documentDeficiency', 'entryDate',
    ] as const;
    for (const k of ss) {
      if (k in patch) { const v = clean((patch as Record<string, unknown>)[k], 300); if (v !== undefined) stuSet[k] = v; }
    }
    const ns = ['hasDorm', 'tuitionPayer', 'certIssued3m', 'unitsRemaining', 'eqSemesters', 'entryYear', 'entryTerm'] as const;
    for (const k of ns) {
      if (k in patch) { const v = cleanNum((patch as Record<string, unknown>)[k]); if (v !== undefined) stuSet[k] = v; }
    }
    if (Object.keys(stuSet).length) {
      await db.update(students).set(stuSet as never).where(and(
        eq(students.id, studentId),
        or(eq(students.universityId, uni.id), isNull(students.universityId)),
      ));
    }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'ثبت نشد.' };
  }
  revalidatePath('/admin/students');
  return { ok: true };
}

/** وصلهٔ ویرایش پروندهٔ استاد/کارمند (فرم info_combined) — فقط ADMIN */
export type StaffProfilePatch = {
  firstName?: string; lastName?: string; nationalCode?: string;
  mobile?: string; email?: string; address?: string; birthDate?: string;
  academicRank?: string; degree?: string; cooperationType?: string; staffType?: string;
  personnelNo?: string; hireDate?: string; bankAccountNo?: string; academicBase?: string;
  fieldOfStudy?: string; lastDegreeUniversity?: string; lastDegreeCountryCode?: string;
  maritalStatus?: string; phone?: string; isActive?: number;
};

/** Zod allow-list گیت اعتبارسنجی وصلهٔ پروندهٔ استاد/کارمند (maxها هم‌گام با slicing داخل اکشن) */
const staffProfilePatchSchema = z.object({
  firstName: z.coerce.string().max(100).nullish(),
  lastName: z.coerce.string().max(100).nullish(),
  nationalCode: z.coerce.string().max(10).nullish(),
  mobile: z.coerce.string().max(11).nullish(),
  email: z.coerce.string().max(150).nullish(),
  address: z.coerce.string().max(300).nullish(),
  birthDate: z.coerce.string().max(10).nullish(),
  academicRank: z.coerce.string().max(50).nullish(),
  degree: z.coerce.string().max(50).nullish(),
  cooperationType: z.coerce.string().max(50).nullish(),
  staffType: z.coerce.string().max(50).nullish(),
  personnelNo: z.coerce.string().max(50).nullish(),
  hireDate: z.coerce.string().max(10).nullish(),
  bankAccountNo: z.coerce.string().max(50).nullish(),
  academicBase: z.coerce.string().max(20).nullish(),
  fieldOfStudy: z.coerce.string().max(200).nullish(),
  lastDegreeUniversity: z.coerce.string().max(200).nullish(),
  lastDegreeCountryCode: z.coerce.string().max(10).nullish(),
  maritalStatus: z.coerce.string().max(20).nullish(),
  phone: z.coerce.string().max(20).nullish(),
  isActive: z.union([z.coerce.number().int().min(0).max(1), z.null(), z.undefined()]),
}).strict();

/** ذخیرهٔ تغییرات پروندهٔ استاد/کارمند توسط ادمین — فقط ADMIN */
export async function updateStaffProfileAction(
  staffId: number, patch: StaffProfilePatch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole(['ADMIN']);
  } catch {
    return { ok: false, error: 'فقط مدیر سیستم (ADMIN) اجازه ویرایش پروندهٔ استاد را دارد.' };
  }
  if (!z.coerce.number().int().positive().safeParse(staffId).success) return { ok: false, error: 'شناسهٔ پرونده یا مقادیر نامعتبر است.' };
  const gated = staffProfilePatchSchema.safeParse(patch);
  if (!gated.success) return { ok: false, error: gated.error.errors[0]?.message ?? 'مقادیر نامعتبر است.' };
  if (!staffId || !patch || typeof patch !== 'object') return { ok: false, error: 'شناسهٔ پرونده یا مقادیر نامعتبر است.' };
  const uni = await getCurrentUniversity().catch(() => null);
  if (!uni) return { ok: false, error: 'دانشگاه فعال نامشخص است.' };
  const [row] = await db.select({ userId: staff.userId, universityId: staff.universityId, nationalCode: users.nationalCode })
    .from(staff).leftJoin(users, eq(users.id, staff.userId)).where(eq(staff.id, staffId)).limit(1);
  if (!row) return { ok: false, error: 'پرونده یافت نشد.' };
  if (row.universityId !== null && row.universityId !== uni.id) {
    return { ok: false, error: 'پرونده متعلق به دانشگاه دیگری است.' };
  }
  const clean = (v: unknown, max: number) => {
    if (v == null) return undefined;
    const s = String(v).trim();
    if (s === '' || s === '—') return undefined;
    return s.slice(0, max);
  };
  try {
    // ── users ──
    const userSet: Record<string, unknown> = {};
    for (const [k, max] of [['firstName', 100], ['lastName', 100], ['mobile', 11], ['email', 150], ['address', 300]] as const) {
      if (k in patch) { const v = clean((patch as Record<string, unknown>)[k], max); if (v !== undefined) userSet[k] = v; }
    }
    if ('nationalCode' in patch) {
      const nc = clean(patch.nationalCode, 10);
      if (nc !== undefined && nc !== (row.nationalCode ?? null)) {
        // مقدار جدید است → باید کد ملی معتبر ۱۰ رقمی باشد.
        // قید یکتایی (UNIQUE nationalCode) حذف شده؛ دوقلوها/اشخاص با کد
        // مشترک قانونی‌اند و دیگر برخورد (clash) را رد نمی‌کنیم.
        // اگر کاربر کد را دست نزده (حتی کدهای قدیمی SA/SS/…)، بدون اعتبارسنجی
        // رد می‌شویم تا ویرایش بقیهٔ فیلدها (موبایل و…) قفل نشود.
        if (!/^\d{10}$/.test(nc)) return { ok: false, error: 'کد ملی باید ۱۰ رقم باشد.' };
        userSet.nationalCode = nc;
      }
    }
    if ('birthDate' in patch) {
      const raw = clean(patch.birthDate, 10);
      if (raw !== undefined) {
        const m = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
        if (!m) return { ok: false, error: 'قالب تاریخ تولد نامعتبر است (نمونه: ۱۳۶۰/۰۱/۰۱).' };
        const fa = (s: string) => Number(String(s).replace(/[۰-۹]/g, (ch: string) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch))));
        const jy = fa(m[1]); const jm = fa(m[2]); const jd = fa(m[3]);
        if (jy < 1300 || jy > 1450 || jm < 1 || jm > 12 || jd < 1 || jd > 31) {
          return { ok: false, error: 'تاریخ تولد خارج از بازهٔ مجاز است.' };
        }
        const g = toGregorian(jy, jm, jd);
        userSet.birthDate = new Date(Date.UTC(g.gy, g.gm - 1, g.gd));
      }
    }
    if (Object.keys(userSet).length) {
      await db.update(users).set(userSet as never).where(eq(users.id, row.userId));
    }
    // ── staff ──
    const staffSet: Record<string, unknown> = {};
    for (const [k, max] of [
      ['academicRank', 50], ['degree', 50], ['cooperationType', 50], ['staffType', 50],
      ['personnelNo', 50], ['hireDate', 10], ['bankAccountNo', 50], ['academicBase', 20],
      ['fieldOfStudy', 200], ['lastDegreeUniversity', 200], ['lastDegreeCountryCode', 10],
      ['maritalStatus', 20], ['phone', 20],
    ] as const) {
      if (k in patch) { const v = clean((patch as Record<string, unknown>)[k], max); if (v !== undefined) staffSet[k] = v; }
    }
    if ('isActive' in patch && (patch.isActive === 0 || patch.isActive === 1)) {
      staffSet.isActive = patch.isActive;
    }
    if (Object.keys(staffSet).length) {
      await db.update(staff).set(staffSet as never).where(and(
        eq(staff.id, staffId),
        or(eq(staff.universityId, uni.id), isNull(staff.universityId)),
      ));
    }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'ثبت نشد.' };
  }
  revalidatePath('/admin/students');
  return { ok: true };
}

/**
 * ── فهرست استادان/پرسنل، **تنبل** ──
 * قبلاً همین داده در رندر اولیهٔ صفحه برای همهٔ استادان (~۱۴۰۰ ردیف × ۳۵ فیلد)
 * خوانده و به کلاینت فرستاده می‌شد؛ نتیجه HTML ۱.۶۶MB و رندر ۶۷۳ms بود.
 * حالا فقط وقتی ادمین تب «استادان» را باز می‌کند یک‌بار واکشی می‌شود.
 *
 * 🔒 همان گاردِ خود صفحه: نقش‌ها/مجوزها + دامنهٔ دانشگاه فعال.
 */
export async function loadStaffListAction(q?: string): Promise<{
  ok: boolean;
  staffList?: StaffItem[];
  userRoleIds?: Record<number, number[]>;
  /** تعداد کل نتایجِ جست‌وجو (ممکن است از سقفِ ۱۰۰ ردیف بیشتر باشد) */
  total?: number;
  error?: string;
}> {
  try {
    const { requireRoleOrPermission } = await import('@/lib/permissions-enforcer');
    const user = await requireRoleOrPermission(
      ['ADMIN', 'EDU_EXPERT', 'ARCHIVE_EXPERT', 'MILITARY_OFFICER', 'GRADUATEAFFAIRS'],
      ['students:view_dossier'],
    );
    const uni = await getCurrentUniversity();
    const { loadStaffBundle } = await import('./staff-data');
    const { staffList, userRoleIds, total } = await loadStaffBundle({
      universityId: uni?.id ?? null,
      roles: user.roles,
      q,
    });
    return { ok: true, staffList, userRoleIds, total };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'فهرست استادان بارگذاری نشد.' };
  }
}
