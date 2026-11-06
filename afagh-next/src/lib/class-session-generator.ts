/**
 * ═══════════════════════════════════════════════════════════════════════
 * فاز ۶ — تولید جلسات واقعی (class_sessions) از schedules
 * ────────────────────────────────────────────────────────────────────────
 * پاسخ به «تولید ۱۶ جلسه» در UI سابق که فقط یک عدد ثابت نمایش می‌داد:
 *   این‌جا از روی سطرهای واقعی `schedules` (روز هفته + ساعت شروع/پایان)
 *   و `academic_terms.startDate`، تاریخ جلسات شمسی ساخته و در جدول
 *   `class_sessions` درج می‌شود — تراکنشی، idempotent و همراه audit.
 *
 * قواعد:
 *   ① فقط schedules با scheduleType='CLASS' و dayOfWeek معتبر (۰..۶)
 *   ② تعطیلات رسمی (لیست 'YYYY/MM/DD') از جلسات حذف می‌شود
 *   ③ اجرای مجدد: جلسات قبلیِ غیرجبرانیِ همان درس‌ها حذف و نو ساخته می‌شود
 *      (قفل توافقی pg_advisory_xact_lock روی termId — هم‌الگو با موتور)
 *   ④ گیت قیود سخت (استاد/سالن/ظرفیت) پیش از تولید؛ خطای صریح با جزئیات
 *   ⑤ هیچ عدد/متن ثابتی — همه‌چیز از DB.
 * ═══════════════════════════════════════════════════════════════════════
 */
import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  academic_terms, class_sessions, course_offerings, offering_professors,
  schedules, staff, users,
} from '@/db/schema';
import { auditChain, type AuditTx } from '@/lib/audit-chain';
import {
  analyzeHardConflicts, computeSessionDates, toMinutes,
  type HardConflict, type HardConflictEntry,
} from '@/lib/scheduling-core';
import { advisoryLock } from '@/lib/advisory-lock';
import { execRows } from '@/lib/db-result';

const hm = (t: unknown) => (t == null ? '' : String(t).slice(0, 5));

export interface GenerateSessionsInput {
  /** پیش‌فرض ۱۶ */
  sessionsCount?: number;
  /** تعطیلات رسمی 'YYYY/MM/DD' شمسی */
  holidays?: string[];
  /** اجرای خشک: فقط تشخیص، بدون درج */
  dryRun?: boolean;
  /** در صورت تداخل سخت خطا بده (پیش‌فرض: بله) */
  failOnHardConflict?: boolean;
}

export interface GenerateSessionsResult {
  ok: boolean;
  /** تعداد جلسات تازه ساخته‌شده */
  generated: number;
  /** تعداد جلساتی که از قبل وجود داشتند و رد شدند (idempotent) */
  skipped: number;
  /** هشدارهای غیرمسدودکننده (روز نامعتبر و…) */
  warnings: string[];
  error?: string;
  offerings: number;
  sessionsPerOffering: Record<number, number>;
  hardConflicts: HardConflict[];
  termStart: string | null;
}

interface SchedRow {
  offeringId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  roomId: number | null;
  courseCode: string;
  groupNumber: number;
  capacity: number;
  enrolledCount: number;
  professorId: number | null;
  /** 'ALL' | 'EVEN' | 'ODD' — هفتگی/زوج/فرد (ادغام قابلیت نسخهٔ ریموت) */
  recurrence: 'ALL' | 'EVEN' | 'ODD';
}

/** خواندن زمان‌بندی کلاسی واقعی یک ترم + استادان + ظرفیت سالن (SQL پارامتری) */
async function loadTermSchedules(exec: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, termId: number) {
  const raw = await exec.execute(sql`
    select s."offeringId", s."dayOfWeek", to_char(s."startTime", 'HH24:MI') as "startTime",
           to_char(s."endTime", 'HH24:MI') as "endTime", s."roomId",
           coalesce(s."scheduleType", 'ALL')::text as "recurrence",
           coalesce(c."code", '#' || s."offeringId") as "courseCode",
           o."groupNumber", o."capacity", o."enrolledCount", o."professorId",
           coalesce(o."enrolledCount", 0)::int as "enrolled"
    from schedules s
    join course_offerings o on o.id = s."offeringId"
    left join courses c on c.id = o."courseId"
    where o."termId" = ${termId} and s."scheduleType" = 'CLASS' and s."dayOfWeek" is not null
    order by s."offeringId", s."dayOfWeek"
  `);
  const rows = execRows<Record<string, unknown>>(raw);
  return rows.map(r => ({
    offeringId: Number(r.offeringId),
    dayOfWeek: Number(r.dayOfWeek),
    startTime: String(r.startTime ?? ''),
    endTime: String(r.endTime ?? ''),
    roomId: r.roomId == null ? null : Number(r.roomId),
    courseCode: String(r.courseCode ?? ''),
    groupNumber: Number(r.groupNumber ?? 1),
    capacity: Number(r.capacity ?? 0),
    enrolledCount: Number(r.enrolled ?? 0),
    professorId: r.professorId == null ? null : Number(r.professorId),
    recurrence: (['ALL', 'EVEN', 'ODD'] as const).includes(r.recurrence as 'ALL' | 'EVEN' | 'ODD')
      ? (r.recurrence as 'ALL' | 'EVEN' | 'ODD') : 'ALL',
  })) as SchedRow[];
}

/** استادان (اصلی + دومِ Co-Teaching) به تفکیک offering */
async function loadProfessorsByOffering(exec: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, termId: number) {
  const raw = await exec.execute(sql`
    select op."offeringId", op."staffId" from offering_professors op
    join course_offerings o on o.id = op."offeringId"
    where o."termId" = ${termId}
  `);
  const map = new Map<number, number[]>();
  for (const r of execRows<{ offeringId: number; staffId: number }>(raw)) {
    const arr = map.get(Number(r.offeringId)) ?? [];
    arr.push(Number(r.staffId));
    map.set(Number(r.offeringId), arr);
  }
  return map;
}

/** ظرفیت سالن‌ها: id → ظرفیت */
async function loadRoomCapacities(exec: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }) {
  const raw = await exec.execute(sql`select id, "capacity" from classrooms`);
  const map = new Map<number, number>();
  for (const r of execRows<{ id: number; capacity: number | null }>(raw)) {
    map.set(Number(r.id), Number(r.capacity ?? 0));
  }
  return map;
}

/**
 * تولید/بازتولید جلسات واقعی یک ترم از روی schedules.
 * تراکنشی + قفل توافقی + audit؛ idempotent (حذف و ساخت دوبارهٔ غیرجبرانی‌ها).
 */
export async function generateClassSessionsForTerm(
  actorUserId: number | null,
  termId: number,
  px: GenerateSessionsInput = {},
): Promise<GenerateSessionsResult> {
  const sessionsCount = px.sessionsCount ?? 16;
  const holidays = px.holidays ?? [];

  return db.transaction(async tx => {
    await advisoryLock(tx, 'sess_gen', termId);

    const [term] = await tx.select().from(academic_terms).where(eq(academic_terms.id, termId)).limit(1);
    if (!term) throw new Error('نیمسال تحصیلی یافت نشد.');
    // مبدأ/پایان جلسات = بازهٔ آموزشی (classStart/classEnd) با fallback به شروع/پایان ترم
    const classStart = term.classStartDate ?? term.startDate;
    const classEnd = term.classEndDate ?? null;
    if (!classStart) {
      throw new Error('تاریخ شروع نیمسال (startDate) ثبت نشده است؛ ابتدا تقویم ترم را تعریف کنید.');
    }

    const schedRows = await loadTermSchedules(tx, termId);
    if (schedRows.length === 0) {
      return {
        ok: false, generated: 0, skipped: 0, warnings: [], error: 'برای این نیمسال هیچ برنامهٔ هفتگی (schedule) ثبت نشده است.',
        offerings: 0, sessionsPerOffering: {}, hardConflicts: [], termStart: null,
      };
    }

    const profByOffering = await loadProfessorsByOffering(tx, termId);
    const roomCap = await loadRoomCapacities(tx);

    // ── گیت قیود سخت (قبل از تولید) ──
    const entries: HardConflictEntry[] = schedRows.map(s => {
      const profs = profByOffering.get(s.offeringId) ?? [];
      if (s.professorId != null && !profs.includes(s.professorId)) profs.unshift(s.professorId);
      return {
        offeringId: s.offeringId,
        groupNumber: s.groupNumber,
        courseCode: s.courseCode,
        professorIds: profs,
        roomId: s.roomId,
        dayOfWeek: s.dayOfWeek,
        startMinutes: toMinutes(s.startTime),
        endMinutes: toMinutes(s.endTime),
        enrolledCount: s.enrolledCount,
        capacity: s.roomId != null ? (roomCap.get(s.roomId) ?? 0) : 0,
      };
    });
    const conflictReport = analyzeHardConflicts(entries);
    const hardConflicts = conflictReport.conflicts;
    if ((px.failOnHardConflict ?? true) && conflictReport.total > 0) {
      throw new Error(
        `زمان‌بندی کنونی ${conflictReport.total} تداخل سخت دارد؛ پیش از تولید جلسات رفع کنید. مثال: ${hardConflicts[0].message}`,
      );
    }

    const offeringIds = [...new Set(schedRows.map(s => s.offeringId))];

    // ── Idempotency (ادغام با نسخهٔ ریموت): جلسات موجود (offeringId + sessionNo)
//    هرگز دوباره ساخته نمی‌شوند — اجرای دوباره فقط «جلسهٔ گم‌شده» را کامل
//    می‌کند و جلسات جبرانی (isMakeUpSession=1) دست‌نخورده می‌مانند. ──
    const existingRows = offeringIds.length
      ? await tx
          .select({ offeringId: class_sessions.offeringId, sessionNo: class_sessions.sessionNo })
          .from(class_sessions)
          .where(inArray(class_sessions.offeringId, offeringIds))
      : [];
    const existing = new Map<number, Set<number>>();
    let skipped = 0;
    const warnings: string[] = [];
    for (const e of existingRows) {
      const set = existing.get(e.offeringId) ?? new Set<number>();
      if (e.sessionNo != null) set.add(e.sessionNo);
      existing.set(e.offeringId, set);
    }

    // ── ساخت جلسات از هستهٔ خالص ──
    const sessionsPerOffering: Record<number, number> = {};
    const values: {
      offeringId: number; sessionDate: string; startTime: string; endTime: string;
      status: string; sessionNo: number; isMakeUpSession: number;
    }[] = [];
    for (const s of schedRows) {
      if (s.dayOfWeek == null || !Number.isInteger(s.dayOfWeek) || s.dayOfWeek < 0 || s.dayOfWeek > 6) {
        warnings.push(`برنامهٔ هفتگی offering ${s.offeringId} (درس ${s.courseCode}) روز هفتهٔ نامعتبر دارد و نادیده گرفته شد.`);
        if (sessionsPerOffering[s.offeringId] == null) sessionsPerOffering[s.offeringId] = 0;
        continue;
      }
      let dates;
      try {
        dates = computeSessionDates({
          termStart: classStart,
          classStartDate: classStart,
          classEndDate: classEnd ?? undefined,
          dayOfWeek: s.dayOfWeek,
          sessionsCount,
          holidays,
          recurrence: s.recurrence,
        });
      } catch {
        warnings.push(`برنامهٔ هفتگی offering ${s.offeringId} (درس ${s.courseCode}) روز هفتهٔ نامعتبر دارد و نادیده گرفته شد.`);
        if (sessionsPerOffering[s.offeringId] == null) sessionsPerOffering[s.offeringId] = 0;
        continue;
      }
      const existingSet = existing.get(s.offeringId) ?? new Set<number>();
      const kept = dates.filter(d => existingSet.has(d.sessionNo));
      skipped += kept.length;
      sessionsPerOffering[s.offeringId] = dates.length - kept.length;
      for (const d of dates) {
        if (existingSet.has(d.sessionNo)) continue;
        values.push({
          offeringId: s.offeringId,
          sessionDate: d.jalaliDate,
          startTime: hm(s.startTime),
          endTime: hm(s.endTime),
          status: 'SCHEDULED',
          sessionNo: d.sessionNo,
          isMakeUpSession: 0,
        });
      }
    }

    if (!px.dryRun && values.length > 0) {
      try {
        for (let i = 0; i < values.length; i += 400) {
          await tx.insert(class_sessions).values(values.slice(i, i + 400));
        }
      } catch {
        throw new Error('خطا در ذخیرهٔ جلسات تولیدشده؛ لطفاً دوباره تلاش کنید و در صورت تکرار به آموزش اطلاع دهید.');
      }
    }

    const termStartStr = classStart.toISOString().slice(0, 10);
    await auditChain(tx, actorUserId, 'SCHEDULING_SESSIONS_GENERATED', 'academic_term', termId, {
      generated: values.length,
      skipped,
      offerings: offeringIds.length,
      sessionsPerOffering,
      holidays: holidays.length,
      termStart: termStartStr,
    });

    return {
      ok: true,
      generated: px.dryRun ? 0 : values.length,
      skipped,
      warnings,
      offerings: offeringIds.length,
      sessionsPerOffering,
      hardConflicts,
      termStart: termStartStr,
    };
  });
}

export async function generateClassSessionsForOffering(
  actorUserId: number | null,
  termId: number,
  offeringId: number,
  px: GenerateSessionsInput = {},
  exec?: { transaction: <T>(cb: (tx: any) => Promise<T>) => Promise<T> },
): Promise<GenerateSessionsResult> {
  const sessionsCount = px.sessionsCount ?? 16;
  const holidays = px.holidays ?? [];
  const runTx = exec ?? db;

  return runTx.transaction(async (tx: any) => {
    await advisoryLock(tx, 'sess_gen', termId);

    const [term] = await tx.select().from(academic_terms).where(eq(academic_terms.id, termId)).limit(1);
    if (!term) throw new Error('نیمسال تحصیلی یافت نشد.');
    // مبدأ/پایان جلسات = بازهٔ آموزشی (classStart/classEnd) با fallback به شروع/پایان ترم
    const classStart = term.classStartDate ?? term.startDate;
    const classEnd = term.classEndDate ?? null;
    if (!classStart) {
      throw new Error('تاریخ شروع نیمسال (startDate) ثبت نشده است؛ ابتدا تقویم ترم را تعریف کنید.');
    }

    const schedRows = await loadTermSchedules(tx, termId);
    const targetRows = schedRows.filter(s => s.offeringId === offeringId);
    if (targetRows.length === 0) {
      return {
        ok: false, generated: 0, skipped: 0, warnings: [], error: 'برای این درس هیچ برنامهٔ هفتگی (schedule) ثبت نشده است.',
        offerings: 0, sessionsPerOffering: {}, hardConflicts: [], termStart: null,
      };
    }

    const profByOffering = await loadProfessorsByOffering(tx, termId);
    const roomCap = await loadRoomCapacities(tx);

    const entries: HardConflictEntry[] = schedRows.map(s => {
      const profs = profByOffering.get(s.offeringId) ?? [];
      if (s.professorId != null && !profs.includes(s.professorId)) profs.unshift(s.professorId);
      return {
        offeringId: s.offeringId,
        groupNumber: s.groupNumber,
        courseCode: s.courseCode,
        professorIds: profs,
        roomId: s.roomId,
        dayOfWeek: s.dayOfWeek,
        startMinutes: toMinutes(s.startTime),
        endMinutes: toMinutes(s.endTime),
        enrolledCount: s.enrolledCount,
        capacity: s.roomId != null ? (roomCap.get(s.roomId) ?? 0) : 0,
      };
    });
    const conflictReport = analyzeHardConflicts(entries);
    const hardConflicts = conflictReport.conflicts;
    if ((px.failOnHardConflict ?? true) && conflictReport.total > 0) {
      throw new Error(
        `زمان‌بندی کنونی ${conflictReport.total} تداخل سخت دارد؛ پیش از تولید جلسات رفع کنید. مثال: ${hardConflicts[0].message}`,
      );
    }

    const existingRows = await tx
      .select({ offeringId: class_sessions.offeringId, sessionNo: class_sessions.sessionNo })
      .from(class_sessions)
      .where(eq(class_sessions.offeringId, offeringId));
    const existing = new Set<number>();
    let skipped = 0;
    const warnings: string[] = [];
    for (const e of existingRows) {
      if (e.sessionNo != null) existing.add(e.sessionNo);
    }

    const sessionsPerOffering: Record<number, number> = {};
    const values: {
      offeringId: number; sessionDate: string; startTime: string; endTime: string;
      status: string; sessionNo: number; isMakeUpSession: number;
    }[] = [];
    for (const s of targetRows) {
      if (s.dayOfWeek == null || !Number.isInteger(s.dayOfWeek) || s.dayOfWeek < 0 || s.dayOfWeek > 6) {
        warnings.push(`برنامهٔ هفتگی offering ${s.offeringId} (درس ${s.courseCode}) روز هفتهٔ نامعتبر دارد و نادیده گرفته شد.`);
        if (sessionsPerOffering[s.offeringId] == null) sessionsPerOffering[s.offeringId] = 0;
        continue;
      }
      let dates;
      try {
        dates = computeSessionDates({
          termStart: classStart,
          classStartDate: classStart,
          classEndDate: classEnd ?? undefined,
          dayOfWeek: s.dayOfWeek,
          sessionsCount,
          holidays,
          recurrence: s.recurrence,
        });
      } catch {
        warnings.push(`برنامهٔ هفتگی offering ${s.offeringId} (درس ${s.courseCode}) روز هفتهٔ نامعتبر دارد و نادیده گرفته شد.`);
        if (sessionsPerOffering[s.offeringId] == null) sessionsPerOffering[s.offeringId] = 0;
        continue;
      }
      const kept = dates.filter(d => existing.has(d.sessionNo));
      skipped += kept.length;
      sessionsPerOffering[s.offeringId] = dates.length - kept.length;
      for (const d of dates) {
        if (existing.has(d.sessionNo)) continue;
        values.push({
          offeringId: s.offeringId,
          sessionDate: d.jalaliDate,
          startTime: hm(s.startTime),
          endTime: hm(s.endTime),
          status: 'SCHEDULED',
          sessionNo: d.sessionNo,
          isMakeUpSession: 0,
        });
      }
    }

    if (!px.dryRun && values.length > 0) {
      try {
        for (let i = 0; i < values.length; i += 400) {
          await tx.insert(class_sessions).values(values.slice(i, i + 400));
        }
      } catch {
        throw new Error('خطا در ذخیرهٔ جلسات تولیدشده؛ لطفاً دوباره تلاش کنید و در صورت تکرار به آموزش اطلاع دهید.');
      }
    }

    const termStartStr = classStart.toISOString().slice(0, 10);
    await auditChain(tx, actorUserId, 'SCHEDULING_SESSIONS_GENERATED', 'academic_term', termId, {
      generated: values.length,
      skipped,
      offerings: 1,
      offeringId,
      sessionsPerOffering,
      holidays: holidays.length,
      termStart: termStartStr,
    });

    return {
      ok: true,
      generated: px.dryRun ? 0 : values.length,
      skipped,
      warnings,
      offerings: 1,
      sessionsPerOffering,
      hardConflicts,
      termStart: termStartStr,
    };
  });
}

/**
 * تشخیص قیود سخت روی زمان‌بندی واقعی یک ترم.
 *
 * `hardConflicts` سقف‌دار است (برای نمایش)؛ `total` شمار واقعی. پیش از این،
 * فهرست بی‌سقف بود و روی ترم‌های بزرگ حافظهٔ سرور را تمام می‌کرد.
 */
export async function inspectSchedulingHardConflicts(termId: number): Promise<{
  hardConflicts: HardConflict[];
  total: number;
  truncated: boolean;
  rowCount: number;
}> {
  // این سه پرسوجو به هم وابسته نیستند — قبلاً پشتسرهم اجرا میشدند (۳ RTT
  // جداگانه) و در صفحهٔ برنامهريزي روی ترمهای بزرگ ~۱ ثانیه به TTFB اضافه
  // میکردند. `Promise.all` همان نتایج را در یک RTT میدهد.
  const [schedRows, profByOffering, roomCap] = await Promise.all([
    loadTermSchedules(db, termId),
    loadProfessorsByOffering(db, termId),
    loadRoomCapacities(db),
  ]);
  const entries: HardConflictEntry[] = schedRows.map(s => {
    const profs = profByOffering.get(s.offeringId) ?? [];
    if (s.professorId != null && !profs.includes(s.professorId)) profs.unshift(s.professorId);
    return {
      offeringId: s.offeringId,
      groupNumber: s.groupNumber,
      courseCode: s.courseCode,
      professorIds: profs,
      roomId: s.roomId,
      dayOfWeek: s.dayOfWeek,
      startMinutes: toMinutes(s.startTime),
      endMinutes: toMinutes(s.endTime),
      enrolledCount: s.enrolledCount,
      capacity: s.roomId != null ? (roomCap.get(s.roomId) ?? 0) : 0,
    };
  });
  const rep = analyzeHardConflicts(entries);
  return { hardConflicts: rep.conflicts, total: rep.total, truncated: rep.truncated, rowCount: entries.length };
}

/** خلاصهٔ جلسات موجود یک ترم (برای داشبورد صفحه) */
export async function getTermSessionsSummary(termId: number) {
  return db
    .select({
      offeringId: class_sessions.offeringId,
      total: sql<number>`count(*)::int`,
      makeup: sql<number>`coalesce(sum(case when ${class_sessions.isMakeUpSession} = 1 then 1 else 0 end), 0)::int`,
      firstDate: sql<string | null>`min(${class_sessions.sessionDate})`,
    })
    .from(class_sessions)
    .innerJoin(course_offerings, eq(course_offerings.id, class_sessions.offeringId))
    .where(eq(course_offerings.termId, termId))
    .groupBy(class_sessions.offeringId);
}

/** نام استادان برای نمایش در گزارش (JOIN کمکی به‌جای N+1) */
export async function professorNamesForOfferings(offeringIds: number[]): Promise<Map<number, string>> {
  if (offeringIds.length === 0) return new Map();
  const rows = await db
    .select({
      offeringId: offering_professors.offeringId,
      name: sql<string>`u."firstName" || ' ' || u."lastName"`,
    })
    .from(offering_professors)
    .innerJoin(staff, eq(staff.id, offering_professors.staffId))
    .innerJoin(users, eq(users.id, staff.userId))
    .where(inArray(offering_professors.offeringId, offeringIds));
  return new Map(rows.map(r => [r.offeringId, r.name]));
}
