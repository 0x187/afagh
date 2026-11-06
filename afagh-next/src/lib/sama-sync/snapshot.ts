/**
 * گرفتنِ «عکسِ لحظه‌ای» از آفاق برای یک ترم/دانشگاه.
 *
 * فقط همان ستون‌هایی خوانده می‌شود که موتور تطبیق لازم دارد؛ عمداً از
 * `select *` پرهیز شده تا این ماژول با تغییر ستون‌های دیگر نشکند و کوئری روی
 * جدول‌های بزرگ سبک بماند.
 *
 * 🔒 مرز دانشگاهی: هر سه کوئری با `universityId` بسته شده‌اند. `studentCode`
 * در آفاق بین دانشگاه‌ها تکراری است (۲٬۹۳۹ کد مشترک) — بدون این فیلتر،
 * ثبت‌نامِ دانشجوی هم‌شمارهٔ یک موسسهٔ منحله به دانشجوی آفاق می‌چسبد.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { AfaghSnapshot } from './types';

export async function resolveTermId(universityId: number, termCode: string): Promise<number> {
  const r = await db.execute<{ id: number }>(sql`
    SELECT id FROM academic_terms
    WHERE "universityId" = ${universityId} AND "termCode" = ${termCode}
    LIMIT 1`);
  return r.rows[0] ? Number(r.rows[0].id) : 0;
}

export async function loadSnapshot(opts: {
  universityId: number;
  termCode: string;
}): Promise<AfaghSnapshot | null> {
  const { universityId, termCode } = opts;
  const termId = await resolveTermId(universityId, termCode);
  if (!termId) return null;

  const [students, offerings, enrollments] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      SELECT id, "studentCode", status FROM students
      WHERE "universityId" = ${universityId}`),
    db.execute<Record<string, unknown>>(sql`
      SELECT o.id, o."termId", t."termCode", c.code AS "courseCode",
             o."groupNumber", o."isActive", o."enrolledCount"
      FROM course_offerings o
      JOIN courses c ON c.id = o."courseId"
      JOIN academic_terms t ON t.id = o."termId"
      WHERE o."termId" = ${termId}
        AND (o."universityId" = ${universityId} OR o."universityId" IS NULL)`),
    db.execute<Record<string, unknown>>(sql`
      SELECT e.id, e."studentId", e."offeringId", e.status, e."gradeValue"
      FROM enrollments e
      JOIN course_offerings o ON o.id = e."offeringId"
      WHERE o."termId" = ${termId}
        AND (e."universityId" = ${universityId} OR e."universityId" IS NULL)`),
  ]);

  return {
    universityId,
    termCode,
    termId,
    students: students.rows.map((s) => ({ id: Number(s.id), studentCode: String(s.studentCode ?? ''), status: String(s.status ?? '') })),
    offerings: offerings.rows.map((o) => ({
      id: Number(o.id),
      termId: Number(o.termId),
      termCode: String(o.termCode ?? ''),
      courseCode: String(o.courseCode ?? ''),
      groupNumber: Number(o.groupNumber ?? 0),
      isActive: Number(o.isActive ?? 0),
      enrolledCount: Number(o.enrolledCount ?? 0),
    })),
    enrollments: enrollments.rows.map((e) => ({
      id: Number(e.id),
      studentId: Number(e.studentId),
      offeringId: Number(e.offeringId),
      status: String(e.status ?? ''),
      gradeValue: e.gradeValue == null ? null : String(e.gradeValue),
    })),
  };
}

/** ترم‌های موجود یک دانشگاه (برای انتخابگرِ صفحهٔ همگام‌سازی). */
export async function listTerms(universityId: number): Promise<{ termCode: string; title: string; isCurrent: number }[]> {
  const r = await db.execute<{ termCode: string; title: string | null; isCurrent: number }>(sql`
    SELECT "termCode", title, "isCurrent" FROM academic_terms
    WHERE "universityId" = ${universityId}
    ORDER BY "termCode" DESC`);
  return r.rows.map((x) => ({ termCode: String(x.termCode), title: String(x.title ?? ''), isCurrent: Number(x.isCurrent ?? 0) }));
}
