/**
 * ═══════════════════════════════════════════════════════════════════════
 * فاز ۹ (برنامه‌ریزی امتحانات) + فاز ۱۰ (روز امتحان/دانشجو) — لایهٔ سرور
 * ───────────────────────────────────────────────────────────────────────
 * منطق خالص (زون‌بندی/تداخل/ظرفیت/امتیاز/صندلی) در `exam-scheduler.ts` است؛
 * این فایل فقط خواندن/نوشتن DB + قفل توافقی + audit را انجام می‌دهد — طبق
 * الگوی D3 (motor در lib، اکشن‌های گارددار در app).
 *
 * قرارداد تاریخ: **هر دو** ستونِ تاریخ شمسی‌اند — `exam_sessions.examDate`
 * (varchar) و `schedules.examDate` (نوع date) هر دو برچسبِ «شمسی» 'YYYY/MM/DD'
 * (یا 'YYYY-MM-DD') را نگه می‌دارند، هم‌قول با seed و `class_sessions`.
 * تبدیل به میلادی فقط در لایهٔ نمایش انجام می‌شود (`normalizeExamDate`).
 * ⚠ پیش‌تر `schedules.examDate` میلادی نوشته می‌شد و همان ستون دو قالب داشت؛
 * خواندنِ یکدست آن باگ «تاریخ‌های نامعتبر» (۱۴۰۵-۱۰-۲۸ → ۷۸۴/۰۸/۰۶) را می‌داد.
 *
 * مرجعیت تقویم (authoritative): تقویم معیار امتحانات = ردیف‌های `schedules`
 * با scheduleType='EXAM' (تاریخ/ساعت هر درس — همان که دانشجو در کارت ورود
 * به جلسه می‌بیند). ردیف‌های `exam_sessions` بلوک‌های فیزیکیِ «مشتق»‌اند که
 * فقط از رزرو شیفت (upsertExamBlock) ساخته می‌شوند؛ `exam_calendar_configs`
 * فقط پنجره‌های مجاز (زون‌بندی) است نه خود تقویم. سشن فیزیکیِ بدون درس
 * رزروشده = «یتیم» و باید بازبینی شود (نگاه کنید به orphanSessionCount در
 * getExamWorkspaceAction).
 * ═══════════════════════════════════════════════════════════════════════
 */
import 'server-only';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  academic_terms, course_exam_sessions, course_offerings, courses, enrollments,
  equivalence_clusters, exam_calendar_configs, exam_halls, exam_sessions, majors,
  schedules, seat_allocations,
} from '@/db/schema';
import { auditChain, type AuditTx } from '@/lib/audit-chain';
import { advisoryLock } from '@/lib/advisory-lock';
import { execFirstRow } from '@/lib/db-result';
import { jalaliDateOf, parseJalaliDate } from '@/lib/scheduling-core';
import { examDateColumnValue, normalizeExamDate } from '@/lib/shamsi';
import {
  allowedExamRange, examKindOf, examLevelOf, normJalali, planSeatAllocation,
  scoreExamSlot, slotAllowedInZone, validateAndSplitExam, validateZoning,
  type ExamZoning, type SplitVerdict,
} from '@/lib/exam-scheduler';

/** دانشگاه مالک یک ترم (ترم‌ها per-uni هستند: uq_terms_uni_code) */
export async function termUniversityId(termId: number): Promise<number | null> {
  const [t] = await db.select({ universityId: academic_terms.universityId }).from(academic_terms).where(eq(academic_terms.id, termId)).limit(1);
  return t?.universityId ?? null;
}

/** دانشگاه مالک یک ارائهٔ درسی */
async function offeringUniversityId(offeringId: number): Promise<number | null> {
  const [o] = await db.select({ universityId: course_offerings.universityId }).from(course_offerings).where(eq(course_offerings.id, offeringId)).limit(1);
  return o?.universityId ?? null;
}

/** شیفت‌های استاندارد امتحان (منبع تاریخ) — شروع + ۲ ساعت */
export const STANDARD_EXAM_SHIFTS: { startTime: string; endTime: string }[] = [
  { startTime: '08:00', endTime: '10:00' },
  { startTime: '10:30', endTime: '12:30' },
  { startTime: '14:00', endTime: '16:00' },
  { startTime: '16:30', endTime: '18:30' },
];

const hm = (t: unknown) => (t == null ? '' : String(t).slice(0, 5));

/**
 * تاریخ یک ردیفِ تقویمی (`schedules.examDate` / `exam_sessions.examDate`) به
 * شکل شمسی استاندارد 'YYYY/MM/DD'.
 *
 * منطق تحمل‌پذیر (هر دو قالب شمسی/میلادی) در `normalizeExamDate` است؛ اینجا
 * فقط یک نام محلی برای خواناییِ این فایل نگه داشته شده. پیش‌تر همه را میلادی
 * فرض می‌کرد و تاریخ‌های شمسیِ ایمپورت‌شده را دوباره تبدیل می‌کرد
 * (۱۴۰۵-۱۰-۲۸ → ۷۸۴/۰۸/۰۶) — همان باگ «تاریخ‌های نامعتبر» در رادار ظرفیت.
 */
const jalaliOfDateCol = (d: unknown): string | null => normalizeExamDate(d);

/** تاریخ یک «جلسهٔ امتحان» — همان منطق تحمل‌پذیر (نام قدیمی حفظ شده) */
const sessionDateJalali = (v: unknown): string | null => normalizeExamDate(v);

// ─────────────────────────── زون‌بندی ───────────────────────────

/** خواندن (یا null) تنظیمات تقویم امتحانات یک ترم */
export async function getExamZoningRow(termId: number): Promise<ExamZoning | null> {
  const [row] = await db.select().from(exam_calendar_configs).where(eq(exam_calendar_configs.termId, termId)).limit(1);
  if (!row) return null;
  return {
    globalStart: row.globalStart, globalEnd: row.globalEnd,
    generalStart: row.generalStart, generalEnd: row.generalEnd,
    specializedStart: row.specializedStart, specializedEnd: row.specializedEnd,
  };
}

/** ذخیره/به‌روزرسانی زون‌بندی با اعتبارسنجی ترتیب بازه‌ها */
export async function saveExamZoning(actorUserId: number, termId: number, z: ExamZoning, universityId?: number): Promise<{ ok: boolean; error?: string }> {
  const v = validateZoning(z);
  if (!v.ok) return { ok: false, error: v.error };
  const uni = universityId ?? await termUniversityId(termId);
  return db.transaction(async tx => {
    await advisoryLock(tx, 'exam_zone', termId);
    const [term] = await tx.select().from(academic_terms).where(eq(academic_terms.id, termId)).limit(1);
    if (!term) return { ok: false, error: 'نیمسال یافت نشد.' };
    const [row] = await tx.select().from(exam_calendar_configs).where(eq(exam_calendar_configs.termId, termId)).limit(1);
    if (row) {
      await tx.update(exam_calendar_configs).set({
        globalStart: normJalali(z.globalStart), globalEnd: normJalali(z.globalEnd),
        generalStart: normJalali(z.generalStart), generalEnd: normJalali(z.generalEnd),
        specializedStart: normJalali(z.specializedStart), specializedEnd: normJalali(z.specializedEnd),
        updatedByUserId: actorUserId, updatedAt: new Date(),
        ...(uni != null ? { universityId: uni } : {}),
      }).where(eq(exam_calendar_configs.id, row.id));
    } else {
      await tx.insert(exam_calendar_configs).values({
        termId,
        globalStart: normJalali(z.globalStart), globalEnd: normJalali(z.globalEnd),
        generalStart: normJalali(z.generalStart), generalEnd: normJalali(z.generalEnd),
        specializedStart: normJalali(z.specializedStart), specializedEnd: normJalali(z.specializedEnd),
        updatedByUserId: actorUserId,
        ...(uni != null ? { universityId: uni } : {}),
      });
    }
    await auditChain(tx, actorUserId, 'EXAM_ZONING_UPDATED', 'academic_term', termId, { zoning: z });
    return { ok: true };
  });
}

// ─────────────────────────── رادار ظرفیت ───────────────────────────

export interface CapacitySlot {
  examDate: string;
  startTime: string;
  endTime: string;
  booked: number;
  available: number;
  status: 'OK' | 'OVERFLOW';
  usagePercent: number;
  splitOptions: { label: string; shifts: number; seatsPerShift: number }[];
}

/** رادار ظرفیت: به‌ازای هر (تاریخ شمسی، شیفت) — تقاضا در برابر صندلی‌های سالن‌های امتحانی همان دانشگاه */
export async function examCapacityRadar(termId: number, universityId?: number): Promise<CapacitySlot[]> {
  const uni = universityId ?? await termUniversityId(termId);
  const hallWhere = uni != null ? eq(exam_halls.universityId, uni) : undefined;
  const offUni = uni != null ? eq(course_offerings.universityId, uni) : undefined;
  const [halls, rows] = await Promise.all([
    db.select().from(exam_halls).where(hallWhere),
    db
      .select({ examDate: schedules.examDate, startTime: schedules.startTime, endTime: schedules.endTime, demand: course_offerings.enrolledCount })
      .from(schedules)
      .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
      .where(and(eq(schedules.scheduleType, 'EXAM'), eq(course_offerings.termId, termId), offUni)),
  ]);
  const available = halls.reduce((s, h) => s + Number(h.totalCapacity), 0);
  const bySlot = new Map<string, CapacitySlot>();
  for (const r of rows) {
    const jd = jalaliOfDateCol(r.examDate);
    if (!jd) continue;
    const key = normJalali(jd) + '|' + hm(r.startTime);
    const cur = bySlot.get(key) ?? {
      examDate: normJalali(jd), startTime: hm(r.startTime), endTime: hm(r.endTime),
      booked: 0, available, status: 'OK' as const, usagePercent: 0, splitOptions: [],
    };
    cur.booked += Number(r.demand ?? 0);
    bySlot.set(key, cur);
  }
  const out: CapacitySlot[] = [];
  for (const s of bySlot.values()) {
    const verdict = validateAndSplitExam(s.booked, s.available);
    if (verdict.status === 'OVERFLOW') {
      s.status = 'OVERFLOW';
      s.splitOptions = verdict.splitOptions;
    }
    s.usagePercent = s.available > 0 ? Math.round((s.booked / s.available) * 100) : 100;
    out.push(s);
  }
  return out.sort((a, b) => a.examDate.localeCompare(b.examDate) || a.startTime.localeCompare(b.startTime));
}

// ─────────────────────────── پروفایل درس (مقطع + ماهیت + تقاضا) ───────────────────────────

export interface ExamCourseProfile {
  offeringId: number;
  courseCode: string;
  courseTitle: string;
  level: 'UNDERGRADUATE' | 'POSTGRADUATE';
  kind: 'GENERAL_SHARED' | 'SPECIALIZED';
  enrolledCount: number;
  isWorkingClassMajority: boolean;
}

export async function examCourseProfile(offeringId: number): Promise<ExamCourseProfile | null> {
  const rows = await db
    .select({
      offeringId: course_offerings.id,
      courseCode: courses.code,
      courseTitle: courses.title,
      courseType: courses.courseType,
      enrolledCount: course_offerings.enrolledCount,
      isWorkingClassMajority: majors.isWorkingClassMajority,
    })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .leftJoin(majors, eq(majors.id, course_offerings.targetMajorId))
    .where(eq(course_offerings.id, offeringId));
  if (rows.length === 0) return null;
  const r = rows[0];
  const deg = await db.execute(sql`
    select d."title" as "degreeTitle"
      from course_offerings o
      join majors ma on ma.id = o."targetMajorId"
      left join degree_level_configs d on d.id = ma."degreeLevelId"
     where o.id = ${offeringId}
  `);
  const degTitle = execFirstRow<{ degreeTitle: string | null }>(deg)?.degreeTitle ?? null;
  return {
    offeringId: r.offeringId,
    courseCode: r.courseCode,
    courseTitle: r.courseTitle,
    level: examLevelOf(degTitle),
    kind: examKindOf(r.courseType),
    enrolledCount: Number(r.enrolledCount ?? 0),
    isWorkingClassMajority: r.isWorkingClassMajority === true,
  };
}

/** همهٔ رزروهای امتحانی یک ترم به‌صورت { تاریخ شمسی|شیفت → تقاضا } — بدون SQL مقایسهٔ تاریخ */
async function examBookingsMap(termId: number, universityId?: number): Promise<{ totalAvailable: number; bySlot: Map<string, number> }> {
  const uni = universityId ?? await termUniversityId(termId);
  const hallWhere = uni != null ? eq(exam_halls.universityId, uni) : undefined;
  const offUni = uni != null ? eq(course_offerings.universityId, uni) : undefined;
  const [halls, rows] = await Promise.all([
    db.select().from(exam_halls).where(hallWhere),
    db
      .select({ examDate: schedules.examDate, startTime: schedules.startTime, demand: course_offerings.enrolledCount })
      .from(schedules)
      .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
      .where(and(eq(schedules.scheduleType, 'EXAM'), eq(course_offerings.termId, termId), offUni)),
  ]);
  const totalAvailable = halls.reduce((s, h) => s + Number(h.totalCapacity), 0);
  const bySlot = new Map<string, number>();
  for (const r of rows) {
    const jd = jalaliOfDateCol(r.examDate);
    if (!jd) continue;
    const k = normJalali(jd) + '|' + hm(r.startTime);
    bySlot.set(k, (bySlot.get(k) ?? 0) + Number(r.demand ?? 0));
  }
  return { totalAvailable, bySlot };
}

// ─────────────────────────── رزرو شیفت (با قفل + گیت ظرفیت) ───────────────────────────

export type ScheduleOutcome =
  | { ok: true; message: string }
  | { ok: false; error: string; status?: 'OVERFLOW'; splitOptions?: { label: string; shifts: number; seatsPerShift: number }[] };

/** نوشتن ردیف exam_sessions (بلوک فیزیکی، شمسی) — upsert امن داخل تراکنش */
async function upsertExamBlock(tx: AuditTx, termId: number, examDate: string, startTime: string, endTime: string, universityId?: number) {
  const uni = universityId ?? null;
  const lookup = uni != null
    ? and(eq(exam_sessions.termId, termId), eq(exam_sessions.examDate, examDate), eq(exam_sessions.startTime, startTime), eq(exam_sessions.universityId, uni))
    : and(eq(exam_sessions.termId, termId), eq(exam_sessions.examDate, examDate), eq(exam_sessions.startTime, startTime));
  const [blk] = await tx
    .select({ id: exam_sessions.id })
    .from(exam_sessions)
    .where(lookup)
    .limit(1);
  if (blk) {
    await tx.update(exam_sessions).set({ endTime }).where(eq(exam_sessions.id, blk.id));
  } else {
    await tx.insert(exam_sessions).values({ termId, examDate, startTime, endTime, ...(uni != null ? { universityId: uni } : {}) });
  }
}

/**
 * نوشتن ردیف تقویمی درس (schedules — type EXAM).
 *
 * ⚠ قراردادِ تاریخ: `schedules.examDate` **شمسیِ برچسبی** است (`1405-10-22`)،
 * نه میلادی. ستون از نوع `date` است ولی همهٔ ۱۲۹۵ ردیفِ موجود و همچنین
 * `class_sessions.sessionDate` به همین شکل نوشته شده‌اند. پیش‌تر این تابع
 * میلادی می‌نوشت و نتیجه‌اش دو بود:
 *   • ردیف تازه با بقیهٔ ستون ناسازگار می‌شد و `ORDER BY exam_date` در
 *     گزارش‌ها بین دو قالب بی‌معنا می‌شد (۱۴۰۵ < ۲۰۲۷)،
 *   • فرم ویرایش ارائه تاریخ را با فرض میلادی می‌خواند و برای ردیف‌های شمسی
 *     تاریخِ بی‌معنا نشان می‌داد.
 * پس همان برچسبِ شمسی نوشته می‌شود؛ تبدیل به میلادی فقط در لایهٔ نمایش است.
 */
async function writeScheduleRow(tx: AuditTx, offeringId: number, examDateJalali: string, startTime: string, endTime: string, universityId?: number) {
  const uni = universityId ?? null;
  const examDate = examDateColumnValue(examDateJalali);
  const [sched] = await tx
    .select({ id: schedules.id })
    .from(schedules)
    .where(and(eq(schedules.offeringId, offeringId), eq(schedules.scheduleType, 'EXAM')))
    .limit(1);
  if (sched) {
    await tx.update(schedules).set({ examDate, startTime, endTime, ...(uni != null ? { universityId: uni } : {}) }).where(eq(schedules.id, sched.id));
  } else {
    await tx.insert(schedules).values({ offeringId, scheduleType: 'EXAM', examDate, startTime, endTime, ...(uni != null ? { universityId: uni } : {}) });
  }
  await tx.delete(course_exam_sessions).where(eq(course_exam_sessions.courseOfferingId, offeringId));
}

export async function scheduleExamForOffering(
  actorUserId: number,
  px: { termId: number; offeringId: number; examDate: string; startTime: string; endTime: string; universityId?: number },
): Promise<ScheduleOutcome> {
  const profile = await examCourseProfile(px.offeringId);
  if (!profile) return { ok: false, error: 'درس/ارائه یافت نشد.' };
  const uni = px.universityId ?? await offeringUniversityId(px.offeringId) ?? await termUniversityId(px.termId) ?? null;
  const zoning = await getExamZoningRow(px.termId);
  if (!zoning) return { ok: false, error: 'ابتدا بازه‌های تقویم امتحانات (زون‌بندی) را تعریف کنید.' };
  if (!slotAllowedInZone(zoning, profile.level, profile.kind, px.examDate)) {
    const range = allowedExamRange(zoning, profile.level, profile.kind);
    return {
      ok: false,
      error: `${range.message} (بازهٔ مجاز: ${range.allowedStart} تا ${range.allowedEnd}) — تاریخ ${px.examDate} در این بازه نیست.`,
    };
  }

  return db.transaction(async tx => {
    await advisoryLock(tx, 'exam_slot', px.offeringId, px.termId);
    const { totalAvailable, bySlot } = await examBookingsMap(px.termId, uni ?? undefined);
    const key = normJalali(px.examDate) + '|' + px.startTime.slice(0, 5);
    const bookedOthers = Math.max((bySlot.get(key) ?? 0) - profile.enrolledCount, 0);
    const verdict: SplitVerdict = validateAndSplitExam(bookedOthers + profile.enrolledCount, totalAvailable);
    if (verdict.status === 'OVERFLOW') {
      return { ok: false, error: verdict.message, status: 'OVERFLOW' as const, splitOptions: verdict.splitOptions };
    }

    await upsertExamBlock(tx, px.termId, normJalali(px.examDate), px.startTime, px.endTime, uni ?? undefined);
    await writeScheduleRow(tx, px.offeringId, px.examDate, px.startTime, px.endTime, uni ?? undefined);
    await tx.insert(course_exam_sessions).values({
      courseOfferingId: px.offeringId, totalExpectedSheets: profile.enrolledCount,
      ...(uni != null ? { universityId: uni } : {}),
    });

    await auditChain(tx, actorUserId, 'EXAM_SLOT_SCHEDULED', 'course_offering', px.offeringId, {
      examDate: normJalali(px.examDate), startTime: px.startTime, endTime: px.endTime, demand: profile.enrolledCount,
    });
    return { ok: true, message: `«${profile.courseCode}» در ${normJalali(px.examDate)} ساعت ${px.startTime}–${px.endTime} رزرو شد (${profile.enrolledCount} نفر).` };
  });
}

// ─────────────────────────── امتحان تجمیعی خوشه‌های هم‌ارز ───────────────────────────

export interface ClusterRow {
  clusterId: number;
  clusterTitle: string;
  courseCount: number;
  demand: number;
  scheduledSlot: { examDate: string; startTime: string; endTime: string } | null;
}

export async function listEquivClusters(termId: number, universityId?: number): Promise<ClusterRow[]> {
  const uni = universityId ?? await termUniversityId(termId);
  const offUni = uni != null ? eq(course_offerings.universityId, uni) : undefined;
  const rows = await db
    .select({
      clusterId: equivalence_clusters.id,
      clusterTitle: equivalence_clusters.clusterTitle,
      offeringId: course_offerings.id,
      demand: course_offerings.enrolledCount,
      examDate: schedules.examDate,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
      code: courses.code,
    })
    .from(equivalence_clusters)
    .innerJoin(courses, eq(courses.clusterId, equivalence_clusters.id))
    .innerJoin(course_offerings, eq(course_offerings.courseId, courses.id))
    .leftJoin(schedules, and(eq(schedules.offeringId, course_offerings.id), eq(schedules.scheduleType, 'EXAM')))
    .where(and(eq(course_offerings.termId, termId), offUni))
    .orderBy(asc(equivalence_clusters.id), asc(courses.code));
  const map = new Map<number, ClusterRow>();
  for (const r of rows) {
    const cur = map.get(r.clusterId) ?? { clusterId: r.clusterId, clusterTitle: r.clusterTitle, courseCount: 0, demand: 0, scheduledSlot: null };
    cur.clusterTitle = r.clusterTitle;
    cur.courseCount += 1;
    cur.demand += Number(r.demand ?? 0);
    const jd = jalaliOfDateCol(r.examDate);
    if (jd) cur.scheduledSlot = { examDate: normJalali(jd), startTime: hm(r.startTime), endTime: hm(r.endTime) };
    map.set(r.clusterId, cur);
  }
  return [...map.values()];
}

/** امتحان تجمیعی: یک تاریخ/شیفت واحد برای همهٔ دروس هم‌ارزِ خوشه (آزمون واحد ≡ سؤال واحد) */
export async function scheduleUnifiedCluster(
  actorUserId: number,
  px: { termId: number; clusterId: number; examDate: string; startTime: string; endTime: string; universityId?: number },
): Promise<ScheduleOutcome> {
  const uni = px.universityId ?? await termUniversityId(px.termId) ?? null;
  const offUni = uni != null ? eq(course_offerings.universityId, uni) : undefined;
  const offerings = await db
    .select({ id: course_offerings.id, code: courses.code, enrolledCount: course_offerings.enrolledCount })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(eq(courses.clusterId, px.clusterId), eq(course_offerings.termId, px.termId), offUni));
  if (offerings.length === 0) return { ok: false, error: 'هیچ ارائه‌ای برای این خوشه در ترم جاری نیست.' };
  const [cluster] = await db.select().from(equivalence_clusters).where(eq(equivalence_clusters.id, px.clusterId)).limit(1);
  if (!cluster) return { ok: false, error: 'خوشهٔ هم‌ارزی یافت نشد.' };

  return db.transaction(async tx => {
    await advisoryLock(tx, 'exam_cluster', px.clusterId, px.termId);
    const { totalAvailable, bySlot } = await examBookingsMap(px.termId, uni ?? undefined);
    const demand = offerings.reduce((s, o) => s + Number(o.enrolledCount ?? 0), 0);
    const key = normJalali(px.examDate) + '|' + px.startTime.slice(0, 5);
    const bookedOthers = Math.max((bySlot.get(key) ?? 0) - demand, 0);
    const verdict = validateAndSplitExam(bookedOthers + demand, totalAvailable);
    if (verdict.status === 'OVERFLOW') {
      return { ok: false, error: verdict.message, status: 'OVERFLOW' as const, splitOptions: verdict.splitOptions };
    }

    await upsertExamBlock(tx, px.termId, normJalali(px.examDate), px.startTime, px.endTime, uni ?? undefined);
    for (const o of offerings) {
      await writeScheduleRow(tx, o.id, px.examDate, px.startTime, px.endTime, uni ?? undefined);
      await tx.insert(course_exam_sessions).values({ courseOfferingId: o.id, totalExpectedSheets: Number(o.enrolledCount ?? 0), ...(uni != null ? { universityId: uni } : {}) });
    }

    await auditChain(tx, actorUserId, 'EXAM_CLUSTER_UNIFIED', 'equivalence_cluster', px.clusterId, {
      offerings: offerings.length, demand, examDate: normJalali(px.examDate), startTime: px.startTime,
    });
    return {
      ok: true,
      message: `امتحان تجمیعی «${cluster.clusterTitle}» برای ${offerings.length} درس هم‌ارز در ${normJalali(px.examDate)} ساعت ${px.startTime} ثبت شد.`,
    };
  });
}

// ─────────────────────────── پیشنهاد هوشمند زمان (امتیازدهی) ───────────────────────────

export interface SlotSuggestion {
  examDate: string;
  startTime: string;
  endTime: string;
  score: number;
  reasons: string[];
  booked: number;
  available: number;
}

/** ۴ پیشنهاد طلایی — ظرفیت گیت می‌کند، امتیاز (عصر/ارشد/شاغل) مرتب می‌کند */
export async function suggestExamSlots(termId: number, offeringId: number, universityId?: number): Promise<SlotSuggestion[]> {
  const profile = await examCourseProfile(offeringId);
  if (!profile) return [];
  const zoning = await getExamZoningRow(termId);
  if (!zoning) return [];

  const range = allowedExamRange(zoning, profile.level, profile.kind);
  const start = parseJalaliDate(range.allowedStart);
  const end = parseJalaliDate(range.allowedEnd);
  const dates: string[] = [];
  for (let d = new Date(start), i = 0; d <= end && i < 120; i++, d.setDate(d.getDate() + 1)) {
    dates.push(jalaliDateOf(d));
  }

  const { totalAvailable, bySlot } = await examBookingsMap(termId, universityId);
  const out: SlotSuggestion[] = [];
  for (const date of dates) {
    for (const shift of STANDARD_EXAM_SHIFTS) {
      if (!slotAllowedInZone(zoning, profile.level, profile.kind, date)) continue;
      const key = normJalali(date) + '|' + shift.startTime;
      const bookedNow = Math.max((bySlot.get(key) ?? 0) - profile.enrolledCount, 0);
      const free = totalAvailable - bookedNow;
      if (free < profile.enrolledCount) continue;
      const sc = scoreExamSlot({
        level: profile.level,
        isAfternoon: shift.startTime >= '13:00',
        isWorkingClassMajority: profile.isWorkingClassMajority,
        hasEnoughCapacity: true,
      });
      out.push({
        examDate: date, startTime: shift.startTime, endTime: shift.endTime,
        score: sc.score, reasons: sc.reasons,
        booked: bookedNow + profile.enrolledCount, available: totalAvailable,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.examDate.localeCompare(b.examDate) || a.startTime.localeCompare(b.startTime)).slice(0, 4);
}

// ─────────────────────────── فاز ۱۰: تخصیص صندلی (روز امتحان) ───────────────────────────

export interface SeatAllocationSummary {
  ok: boolean;
  sessionCount: number;
  allocated: number;
  perSession: { sessionId: number; examDate: string; startTime: string; allocated: number; hallsUsed: number }[];
}

/** تولید/بازتولید تخصیص صندلی برای همهٔ سشن‌های ترم (فقط REGISTERED) */
export async function generateSeatAllocations(actorUserId: number, termId: number, universityId?: number): Promise<SeatAllocationSummary> {
  const uni = universityId ?? await termUniversityId(termId) ?? null;
  const sessUni = uni != null ? eq(exam_sessions.universityId, uni) : undefined;
  const offUni = uni != null ? eq(course_offerings.universityId, uni) : undefined;
  const hallWhere = uni != null ? eq(exam_halls.universityId, uni) : undefined;
  return db.transaction(async tx => {
    await advisoryLock(tx, 'exam_seats', termId);
    const sessions = await tx.select().from(exam_sessions).where(and(eq(exam_sessions.termId, termId), sessUni)).orderBy(asc(exam_sessions.examDate), asc(exam_sessions.startTime));
    const halls = await tx.select({ id: exam_halls.id, capacity: exam_halls.totalCapacity }).from(exam_halls).where(hallWhere);
    const hallList = halls.map(h => ({ id: h.id, capacity: Number(h.capacity) }));
    const perSession: SeatAllocationSummary['perSession'] = [];
    let totalAllocated = 0;

    for (const s of sessions) {
      // ارائه‌هایی که در همین (تاریخ شمسی، شیفت) امتحان دارند — یک‌جا، بدون N+1
      const schedRows = await tx
        .select({ offeringId: schedules.offeringId, examDate: schedules.examDate, startTime: schedules.startTime })
        .from(schedules)
        .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
        .where(and(eq(schedules.scheduleType, 'EXAM'), eq(course_offerings.termId, termId), offUni));
      const matched = schedRows
        .filter(r => {
          const jd = jalaliOfDateCol(r.examDate);
          return jd != null && normJalali(jd) === sessionDateJalali(s.examDate) && hm(r.startTime) === s.startTime;
        })
        .map(r => r.offeringId);

      let allocated = 0;
      let hallsUsed = 0;
      if (matched.length > 0) {
        const ents = await tx
          .select({ enrollmentId: enrollments.id, studentId: enrollments.studentId, offeringId: enrollments.offeringId })
          .from(enrollments)
          .where(and(inArray(enrollments.offeringId, matched), eq(enrollments.status, 'REGISTERED')));
        const plan = planSeatAllocation(ents, hallList);
        await tx.delete(seat_allocations).where(eq(seat_allocations.sessionId, s.id));
        if (plan.length > 0) {
          await tx.insert(seat_allocations).values(plan.map(p => ({
            enrollmentId: p.enrollmentId, sessionId: s.id, hallId: p.hallId, seatNumber: p.seatNumber, blockKey: p.blockKey,
            ...(uni != null ? { universityId: uni } : {}),
          })));
        }
        allocated = plan.length;
        hallsUsed = new Set(plan.map(p => p.hallId)).size;
        totalAllocated += allocated;
      }
      perSession.push({ sessionId: s.id, examDate: s.examDate, startTime: s.startTime, allocated, hallsUsed });
    }

    await auditChain(tx, actorUserId, 'EXAM_SEATS_ALLOCATED', 'academic_term', termId, {
      sessionCount: sessions.length, allocated: totalAllocated,
    });
    return { ok: true, sessionCount: sessions.length, allocated: totalAllocated, perSession };
  });
}
