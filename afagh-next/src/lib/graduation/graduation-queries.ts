import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  course_offerings, courses, curriculum_courses, degree_level_configs,
  enrollments, majors, students, users,
} from '@/db/schema';

/**
 * لایهٔ دسترسی دادهٔ موتور فارغ‌التحصیلی (Repository).
 *
 * چرا: `graduation-engine.ts` بیش از ۲۰ جدول را ایمپورت می‌کرد و کوئری‌ها
 * داخل منطق حل‌شده بودند؛ یعنی هر تغییر schema یا هر تستِ منطق، به کالبد
 * دیتابیس گره خورده بود. این ماژول کوئری‌های «خواندن» موتور را بیرون
 * می‌کشد و ردیف‌های ساده برمی‌گرداند تا موتور روی دادهٔ خالص کار کند.
 *
 * دامنه: فعلاً مسیر **تطبیق سرفصل** (`auditStudent`) منتقل شده — پرترافیک‌ترین
 * و پرریسک‌ترین بخش. بقیهٔ توابع موتور به‌تدریج و با همین الگو منتقل می‌شوند؛
 * انتقال یک‌بارهٔ ۱۴۰۰ خط کوئری، بدون تستِ یکپارچه با دیتابیس، ریسک بی‌جهت است.
 *
 * نکته: نوع خروجی عمداً با استنتاج تایپ گرفته می‌شود (نه interface دستی) تا با
 * تغییر ستون‌ها واگرا نشود.
 */

/** دانشجو + رشته + مقطع (یک ردیف، یا undefined اگر دانشجو نبود) */
export async function loadAuditStudentRow(studentId: number) {
  const [row] = await db.select({
    id: students.id, studentCode: students.studentCode, majorId: students.majorId,
    entryYear: students.entryYear, degreeLevelId: students.degreeLevelId, regulationId: students.regulationId,
    firstName: users.firstName, lastName: users.lastName,
    majorName: majors.name, degreeCode: degree_level_configs.code,
    passingGrade: degree_level_configs.defaultPassingGrade,
  }).from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .leftJoin(majors, eq(majors.id, students.majorId))
    .leftJoin(degree_level_configs, eq(degree_level_configs.id, students.degreeLevelId))
    .where(eq(students.id, studentId)).limit(1);
  return row;
}

/**
 * سوابق درسیِ قابل‌احتساب دانشجو: فقط نهایی/معاف/قبول‌بدون‌نمره.
 * نمرات موقت (PENDING) نه «گذرانده»‌اند نه در معدل می‌آیند.
 */
export async function loadGradedEnrollments(studentId: number) {
  return db.select({
    courseId: course_offerings.courseId,
    code: courses.code, title: courses.title, units: courses.units,
    affectsGpa: courses.affectsGpa,
    courseMinMark: courses.minPassedMark,
    gradeValue: enrollments.gradeValue, gradeStatus: enrollments.gradeStatus,
    samaGradeStatusCode: enrollments.samaGradeStatusCode,
  }).from(enrollments)
    .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(
      eq(enrollments.studentId, studentId),
      inArray(enrollments.gradeStatus, ['FINALIZED', 'EXEMPT', 'PASSED_NO_GRADE']),
    ));
}

/** دروس یک نسخهٔ سرفصل (برای یافتن دروس پاس‌نشده) */
export async function loadCurriculumRequirementRows(versionId: number) {
  return db.select({
    courseId: curriculum_courses.courseId, code: courses.code, title: courses.title, units: courses.units,
  }).from(curriculum_courses)
    .innerJoin(courses, eq(courses.id, curriculum_courses.courseId))
    .where(eq(curriculum_courses.curriculumVersionId, versionId));
}
