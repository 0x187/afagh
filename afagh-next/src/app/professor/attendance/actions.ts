'use server';

import { and, eq, inArray, max, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import {
  class_sessions, classrooms, course_offerings, enrollments, offering_professors, professor_class_attendance,
  schedules, student_class_attendance,
} from '@/db/schema';
import { getStaffByUser, requireRole } from '@/lib/auth';
import { generateClassSessionsForOffering, generateClassSessionsForTerm } from '@/lib/class-session-generator';
import { sessionIdsInMergedGroup } from '@/lib/merged-class-sessions';
import { logger } from '@/lib/logger';
import type { HardConflict } from '@/lib/scheduling-core';

export interface AttendanceEntry {
  studentId: number;
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';
  lateMinutes?: number;
}

/**
 * ذخیرهٔ حضور و غیاب یک جلسهٔ کلاس (استادِ خودِ درس) — تراکنشی: بازنویسی همان جلسه.
 *
 * **کلاس ادغامی:** اگر این جلسه جزءِ یک کلاسِ فیزیکیِ چندعرضه‌ای باشد (مثلاً
 * «ریاضی» و «ریاضی ۱» با یک استاد، یک اتاق، ساعت ۸)، استاد فقط یک بار برگهٔ
 * حضور را پر می‌کند و این‌جا روی **همهٔ** جلسه‌های عضو اعمال می‌شود. هر عرضه
 * ردیف‌های حضورِ دانشجویانِ خودش را می‌گیرد (دانشجویانشان فرق دارد)، ولی
 * «تشکیل کلاس» برای همه یک‌جا ثبت می‌شود تا حق‌التدریس ناقص نماند.
 *
 * ⚠ فقط عرضه‌هایی که استاد واقعاً استادِ آن‌هاست (مالک یا استادِ مشترک) ثبت
 *   می‌شوند؛ وگرنه حضورِ یک استاد روی کلاسِ استادِ دیگر نوشته می‌شد.
 */
export async function saveSessionAttendanceAction(sessionId: number, entries: AttendanceEntry[]): Promise<{ ok: boolean; error?: string; savedCount?: number; sessionCount?: number }> {
  try {
    const user = await requireRole(['PROFESSOR']);
    const me = await getStaffByUser(user.id);
    if (!me) return { ok: false, error: 'پروندهٔ هیئت علمی یافت نشد.' };

    const [session] = await db.select().from(class_sessions).where(eq(class_sessions.id, Number(sessionId))).limit(1);
    if (!session) return { ok: false, error: 'جلسه یافت نشد.' };
    const [offering] = await db.select({ professorId: course_offerings.professorId }).from(course_offerings)
      .where(eq(course_offerings.id, session.offeringId)).limit(1);
    if (!offering || offering.professorId !== me.id) return { ok: false, error: 'شما استاد این درس نیستید.' };

    const validStatuses = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];
    const clean = entries.filter(e =>
      Number.isInteger(e.studentId) && validStatuses.includes(e.status),
    );
    if (clean.length === 0) return { ok: false, error: 'ردیف حضوری برای ذخیره وجود ندارد.' };

    // ── گسترش به کلِ کلاس ادغامی ──
    const group = await sessionIdsInMergedGroup(Number(sessionId));
    const targetIds = group.sessionIds.length ? group.sessionIds : [Number(sessionId)];

    // مالکیتِ هر جلسه: استادِ اصلیِ عرضه یا استادِ مشترکِ ثبت‌شده
    const targetOfferings = await db
      .select({ sessionId: class_sessions.id, offeringId: class_sessions.offeringId, professorId: course_offerings.professorId })
      .from(class_sessions)
      .innerJoin(course_offerings, eq(course_offerings.id, class_sessions.offeringId))
      .where(inArray(class_sessions.id, targetIds));
    const sharedRows = targetOfferings.length
      ? await db
          .select({ offeringId: offering_professors.offeringId })
          .from(offering_professors)
          .where(and(
            eq(offering_professors.staffId, me.id),
            inArray(offering_professors.offeringId, targetOfferings.map(r => r.offeringId)),
          ))
      : [];
    const sharedOfferings = new Set(sharedRows.map(r => r.offeringId));
    const owned = new Map<number, number>(); // sessionId → offeringId
    for (const r of targetOfferings) {
      if (r.professorId === me.id || sharedOfferings.has(r.offeringId)) owned.set(r.sessionId, r.offeringId);
    }
    // جلسهٔ ورودی همیشه مجاز است (گاردِ بالا)
    owned.set(Number(sessionId), session.offeringId);

    const studentIds = [...new Set(clean.map(e => e.studentId))];
    let inserted = 0;
    await db.transaction(async tx => {
      for (const [sid, offeringId] of owned) {
        // ردیف‌های حضورِ دانشجویانِ همین عرضه (دانشجویانِ هر عرضه جداست)
        const enRows = studentIds.length > 0
          ? await tx.select({ id: enrollments.id, studentId: enrollments.studentId }).from(enrollments)
              .where(and(eq(enrollments.offeringId, offeringId), inArray(enrollments.studentId, studentIds)))
          : [];
        const enrollmentByStudent = new Map(enRows.map(r => [r.studentId, r.id]));
        const rows: (typeof student_class_attendance.$inferInsert)[] = [];
        for (const e of clean) {
          const enrollmentId = enrollmentByStudent.get(e.studentId);
          if (enrollmentId === undefined) continue;
          const mins = e.status === 'LATE' && Number.isFinite(e.lateMinutes)
            ? Math.min(60, Math.max(1, Math.round(Number(e.lateMinutes))))
            : null;
          rows.push({ sessionId: sid, enrollmentId, status: e.status, lateMinutes: mins });
        }
        await tx.delete(student_class_attendance).where(eq(student_class_attendance.sessionId, sid));
        if (rows.length) await tx.insert(student_class_attendance).values(rows);
        inserted += rows.length;
        // ثبت حضور استاد — همان جلسه (بدون تکرار)
        await tx.delete(professor_class_attendance).where(and(
          eq(professor_class_attendance.sessionId, sid),
          eq(professor_class_attendance.staffId, me.id),
        ));
        await tx.insert(professor_class_attendance).values({
          sessionId: sid, staffId: me.id,
          verificationMethod: 'MANUAL_ATTENDANCE_SHEET', status: 'VALID',
        });
      }
    });

    revalidatePath('/professor/attendance');
    return { ok: true, savedCount: inserted, sessionCount: owned.size };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'خطا در ذخیرهٔ حضور و غیاب.' };
  }
}

/** درخواست/ثبت جلسهٔ جبرانی — ردیف واقعی class_sessions (isMakeUpSession=1) */
export async function scheduleMakeupSessionAction(input: {
  offeringId: number;
  replacedSessionId?: number;
  sessionDate: string; // شمسی YYYY/MM/DD
  startTime: string;   // HH:MM
  endTime: string;
  roomName: string;
  isDirect: boolean;   // بدون نیاز به تأیید آموزش
  topic?: string;
  absenceReason?: string;
}): Promise<{ ok: boolean; error?: string; sessionId?: number }> {
  try {
    const user = await requireRole(['PROFESSOR']);
    const me = await getStaffByUser(user.id);
    if (!me) return { ok: false, error: 'پروندهٔ هیئت علمی یافت نشد.' };

    const offeringId = Number(input.offeringId);
    const [offering] = await db.select({ professorId: course_offerings.professorId }).from(course_offerings)
      .where(eq(course_offerings.id, offeringId)).limit(1);
    if (!offering || offering.professorId !== me.id) return { ok: false, error: 'شما استاد این درس نیستید.' };

    const [room] = await db.select({ id: classrooms.id }).from(classrooms).where(eq(classrooms.name, String(input.roomName))).limit(1);

    const [maxRow] = await db.select({ m: max(class_sessions.sessionNo) }).from(class_sessions).where(eq(class_sessions.offeringId, offeringId));
    const nextNo = (maxRow?.m ?? 0) + 1;

    const [row] = await db.insert(class_sessions).values({
      offeringId,
      sessionDate: String(input.sessionDate),
      startTime: String(input.startTime),
      endTime: String(input.endTime),
      status: input.isDirect ? 'SCHEDULED' : 'PROPOSED',
      isMakeUpSession: 1,
      replacedSessionId: input.replacedSessionId ? Number(input.replacedSessionId) : null,
      sessionNo: nextNo,
      roomId: room?.id ?? null,
      topic: (input.topic ?? '').slice(0, 300) || null,
      absenceReason: input.absenceReason?.trim() || null,
    }).returning({ id: class_sessions.id });

    logger.info('makeup_session_created', { sessionId: row.id, offeringId, direct: input.isDirect });
    revalidatePath('/professor/attendance');
    return { ok: true, sessionId: row.id };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'خطا در ثبت جلسهٔ جبرانی.' };
  }
}

export interface GenerateOfferingSessionsResult {
  ok: boolean;
  error?: string;
  generated?: number;
  skipped?: number;
  offerings?: number;
  perOffering?: number;
  already?: boolean;
  conflicts?: HardConflict[];
  termStart?: string | null;
}

const GENERATE_SESSIONS_GENERIC_ERROR = 'خطای غیرمنتظره در تولید جلسات؛ لطفاً دوباره تلاش کنید و در صورت تکرار به آموزش اطلاع دهید.';

const toSafeError = (message: unknown): string => String(message ?? '').slice(0, 300) || GENERATE_SESSIONS_GENERIC_ERROR;

export async function generateOfferingSessionsAction(offeringId: number): Promise<GenerateOfferingSessionsResult> {
  try {
    const user = await requireRole(['PROFESSOR']);
    const me = await getStaffByUser(user.id);
    if (!me) return { ok: false, error: 'پروندهٔ هیئت علمی یافت نشد.' };

    const oid = Number(offeringId);
    if (!Number.isInteger(oid) || oid <= 0) return { ok: false, error: 'درس نامعتبر است.' };

    const [offering] = await db
      .select({ id: course_offerings.id, professorId: course_offerings.professorId, termId: course_offerings.termId })
      .from(course_offerings)
      .where(eq(course_offerings.id, oid))
      .limit(1);
    if (!offering) return { ok: false, error: 'درس یافت نشد.' };

    let owned = offering.professorId === me.id;
    if (!owned) {
      const [shared] = await db
        .select({ id: offering_professors.id })
        .from(offering_professors)
        .where(and(eq(offering_professors.offeringId, oid), eq(offering_professors.staffId, me.id)))
        .limit(1);
      owned = !!shared;
    }
    if (!owned) return { ok: false, error: 'شما استاد این درس نیستید.' };

    const classRows = await db
      .select({ id: schedules.id })
      .from(schedules)
      .where(and(
        eq(schedules.offeringId, oid),
        eq(schedules.scheduleType, 'CLASS'),
        sql`${schedules.dayOfWeek} is not null`,
      ))
      .limit(1);
    if (classRows.length === 0) {
      return { ok: false, error: 'برای این درس زمان‌بندی هفتگی (CLASS) ثبت نشده است؛ با ادارهٔ آموزش هماهنگ کنید.' };
    }

    const regular = await db
      .select({ id: class_sessions.id })
      .from(class_sessions)
      .where(and(eq(class_sessions.offeringId, oid), eq(class_sessions.isMakeUpSession, 0)))
      .limit(1);
    if (regular.length > 0) {
      return { ok: true, generated: 0, skipped: 0, offerings: 0, perOffering: 0, already: true };
    }

    const preview = await generateClassSessionsForTerm(user.id, offering.termId, { dryRun: true, failOnHardConflict: false });
    if (!preview.ok) {
      return { ok: false, error: toSafeError(preview.error) };
    }
    const scoped = preview.hardConflicts.filter(h => h.offeringIds.includes(oid));
    if (scoped.length > 0) {
      return {
        ok: false,
        error: toSafeError(`زمان‌بندی این درس ${scoped.length} تداخل سخت دارد؛ پیش از تولید جلسات با ادارهٔ آموزش رفع کنید. نمونه: ${scoped[0].message}`),
        conflicts: scoped,
      };
    }

    const result = await generateClassSessionsForOffering(user.id, offering.termId, oid, { failOnHardConflict: false });
    if (!result.ok) {
      return { ok: false, error: toSafeError(result.error) };
    }
    logger.info('offering_sessions_generated_by_professor', { offeringId: oid, termId: offering.termId, generated: result.generated });
    revalidatePath('/professor/attendance');
    return {
      ok: true,
      generated: result.generated,
      skipped: result.skipped,
      offerings: result.offerings,
      perOffering: result.sessionsPerOffering[oid] ?? 0,
      conflicts: result.hardConflicts.filter(h => h.offeringIds.includes(oid)),
      termStart: result.termStart,
    };
  } catch (err) {
    console.error('generateOfferingSessionsAction failed', err);
    return { ok: false, error: GENERATE_SESSIONS_GENERIC_ERROR };
  }
}
