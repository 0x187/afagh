#!/usr/bin/env tsx
/**
 * gm1 — offering-flow harness (QA, STAGING ONLY)
 *
 * Dynamically verifies the group-manager offering flow (specialized/shared
 * courses) and its interaction with student enrollment, after the G1–G7 + F1
 * fixes. Style S1: real engines + real DB on isolated staging
 * (afagh_pg_staging:5433 via DATABASE_URL), high synthetic ID ranges only.
 *
 * Covered scenario groups (see deliverables/gstack/test-plan-gm-offering-2026-10-19.md):
 *   B  targeting (اختصاصی/مشترک) — offeringVisible in pure + submit path
 *   C  scheduling conflicts   — detectScheduleConflicts (room/professor) + capacity
 *   A  dept-scope predicate   — courseInDept (cross-dept must fail)
 *   D  lifecycle              — isActive filter at submit (stale cart), deactivate
 *   E  concurrency            — claimSeatsBatch single-winner + duplicate insert probe
 *   F1 financial gate         — clearance lookup keyed on academicTermId (FK fix)
 *   H  open-findings closure  — H1 unique index (term+course+group), H3 entry-year range
 *                               (H2 soft-drop is asserted in B2/G4)
 *
 * De-isolated (like lt1/lt4): unit-cap -> 40, prereq -> empty, debt threshold -> 0,
 * Redis seat -> -2 (fall through to REAL DB capacity guard), notify -> off.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { processQueuedSubmit, claimSeatsBatch } from '@/lib/enroll-engine/submit';
import { offeringVisible } from '@/lib/offering-targeting';
import {
  capacityWarning, classroomOwnedBy, detectScheduleConflicts, findDuplicateOffering,
  listClassroomsForUniversity, professorInUniversity, readClassroom,
  readClassroomUni, roomAllowedForSchedule, toHM, timesOverlap,
  validateEntryYearRange, validateScheduleWindow,
} from '@/lib/offering-scheduling';

// ═══ رنج‌های شناسهٔ سنتتیک (بدون تداخل با دادهٔ واقعی و هارنس‌های lt*) ═══
const MY_UNI = 1;                 // دانشگاه آفاق (استیجینگ)
const FOREIGN_UNI = 2;
const TERM = 1_500_000;           // LOAD TERM — جاری و باز برای دانشگاه ۱
const REG_ID = 900;               // آیین‌نامهٔ LOADTEST موجود استیجینگ
const DEG_KAR = 8001, DEG_ARS = 8002; // کارشناسی / کارشناسی ارشد (واقعی)
const MA = 1_600_001, MB = 1_600_002;
const DEPT_ACAD = 1_600_010, DEPT_GEN = 1_600_011;
const GM_HEAD = 1_600_020, PROF_LOCAL = 1_600_021, PROF_FOREIGN = 1_600_022, PROF_INACTIVE = 1_600_023;
const COURSE_ACAD = 1_600_030, COURSE_GEN = 1_600_031;
const ROOM_LOCAL = 1_600_040, ROOM_SMALL = 1_600_041, ROOM_SYSTEM = 1_600_042, ROOM_FOREIGN = 1_600_043;
const FAC = 1_600_003;
const FT = 1_600_060;
const OFF_TARGETED = 1_600_050, OFF_SHARED = 1_600_051, OFF_INACTIVE = 1_600_052, OFF_SCHED_A = 1_600_053,
  OFF_SCHED_B = 1_600_054, OFF_INVERT = 1_600_055, OFF_SEAT = 1_600_056;
const U0 = 1_600_100;
const ST_IN_TARGET = 1_600_201, ST_OUT_MAJOR = 1_600_202, ST_OUT_DEG = 1_600_203, ST_OUT_YEAR = 1_600_204,
  ST_CLEARED = 1_600_205, ST_NOCLEAR = 1_600_206, ST_CLEARED_OUT = 1_600_207;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, max: 8, statement_timeout: 60_000,
});
const db = drizzle(pool, { schema });
const rls = async (userId: number, fn: any) => db.transaction(async (tx: any) => {
  await tx.execute(sql`select set_config('app.user_id', ${String(userId)}, true)`);
  return fn(tx);
});
const submitDeps = {
  db, withUserRls: rls,
  atomicSeat: async () => -2,          // -2 = به گارد ظرفیت واقعی DB برگرد
  releaseSeat: async () => {},
  nextWaitlistPosition: async () => 0,
  warmupCapacities: async () => 0,
  evaluateRegulations: async () => ({ effectiveMaxUnits: 40 }),
  buildPrereq: async () => ({ ruleByCourse: new Map<number, any>(), passed: new Map<string, number>(), titles: new Map<string, string>(), defaultPassing: 10, unitsPassed: 0, semesterNo: 1 }),
  getDebtThreshold: async () => 0,
  notifyEnrollmentDone: async () => {},
};

// ═══ ثبت نتایج ═══
type Rec = { id: string; title: string; ok: boolean; detail: string };
const results: Rec[] = [];
const check = (id: string, title: string, ok: boolean, detail: string) => { results.push({ id, title, ok, detail }); return ok; };
const sec = (t: string) => console.log('\n=== ' + t + ' ===');

async function reset() {
  const rm = async (q: string) => db.execute(sql.raw(q));
  await rm('DELETE FROM enrollments WHERE "studentId" BETWEEN 1600200 AND 1600400 OR "offeringId" BETWEEN ' + OFF_TARGETED + ' AND ' + (OFF_SEAT + 1));
  await rm('DELETE FROM cart_items WHERE "studentId" BETWEEN 1600200 AND 1600400');
  await rm('DELETE FROM schedules WHERE "offeringId" BETWEEN ' + OFF_TARGETED + ' AND ' + (OFF_SEAT + 1));
  await rm('DELETE FROM course_offerings WHERE id BETWEEN ' + OFF_TARGETED + ' AND ' + (OFF_SEAT + 1) + ' OR id BETWEEN ' + (OFF_SEAT + 100) + ' AND ' + (OFF_SEAT + 101) + ' OR id BETWEEN ' + (OFF_SEAT + 200) + ' AND ' + (OFF_SEAT + 201));
  await rm('DELETE FROM courses WHERE id IN (' + COURSE_ACAD + ',' + COURSE_GEN + ')');
  await rm('DELETE FROM financial_clearances WHERE "studentId" BETWEEN 1600200 AND 1600400');
  await rm('DELETE FROM financial_terms WHERE id BETWEEN ' + FT + ' AND ' + (FT + 1));
  await rm('DELETE FROM students WHERE id BETWEEN 1600200 AND 1600400');
  // FK order: staff + notifications reference users — delete them first
  await rm('DELETE FROM notifications WHERE "userId" BETWEEN ' + U0 + ' AND ' + (U0 + 40));
  await rm('DELETE FROM staff WHERE id BETWEEN ' + GM_HEAD + ' AND ' + (PROF_INACTIVE + 1));
  await rm('DELETE FROM users WHERE id BETWEEN ' + U0 + ' AND ' + (U0 + 40));
  await rm('DELETE FROM departments WHERE id BETWEEN ' + DEPT_ACAD + ' AND ' + (DEPT_GEN + 1));
  await rm('DELETE FROM faculties WHERE id BETWEEN ' + FAC + ' AND ' + (FAC + 1));
  await rm('DELETE FROM classrooms WHERE id BETWEEN ' + ROOM_LOCAL + ' AND ' + (ROOM_FOREIGN + 1));
  await rm('DELETE FROM majors WHERE id BETWEEN ' + MA + ' AND ' + (MB + 1));
}

async function seed() {
  // شناسایی گروه و دانشگاه
  const [uni1] = await db.select().from(schema.universities).where(eq(schema.universities.id, MY_UNI!)).limit(1);
  if (!uni1) throw new Error('university 1 not found on staging');
  // کاربران
  for (let i = 0; i < 10; i++) {
    await db.insert(schema.users).values({
      id: U0 + i, nationalCode: String(U0 + i).slice(-9), firstName: 'استاد' + i, lastName: 'تست',
      passwordHash: 'x', isActive: 1,
    }).onConflictDoNothing();
  }
  // کارمندان: مدیر گروه + سه استاد
  await db.insert(schema.staff).values({
    id: GM_HEAD, userId: U0, staffCode: 'GM1-HEAD', universityId: MY_UNI, isActive: 1, staffType: 'FACULTY',
  }).onConflictDoNothing();
  for (const [i, id] of [PROF_LOCAL, PROF_FOREIGN, PROF_INACTIVE].entries()) {
    await db.insert(schema.staff).values({
      id, userId: U0 + 1 + i, staffCode: 'GM1-P' + i, universityId: id === PROF_FOREIGN ? FOREIGN_UNI : MY_UNI,
      isActive: id === PROF_INACTIVE ? 0 : 1, staffType: 'FACULTY',
    }).onConflictDoNothing();
  }
  // گروه‌ها: تخصصی و عام (مدیر هر دو، همان GM_HEAD)
  await db.insert(schema.faculties).values({ id: FAC, name: 'دانشکدهٔ تست', universityId: MY_UNI }).onConflictDoNothing();
  await db.insert(schema.departments).values({ id: DEPT_ACAD, name: 'گروه تست مهندسی', kind: 'ACADEMIC', headStaffId: GM_HEAD, universityId: MY_UNI, isActive: 1, facultyId: FAC }).onConflictDoNothing();
  await db.insert(schema.departments).values({ id: DEPT_GEN, name: 'گروه تست دروس عمومی', kind: 'GENERAL', headStaffId: GM_HEAD, universityId: MY_UNI, isActive: 1, facultyId: FAC }).onConflictDoNothing();
  // دروس
  await db.insert(schema.courses).values({ id: COURSE_ACAD, code: 'GM1001', title: 'درس تخصصی تست', units: '3', departmentId: DEPT_ACAD, universityId: MY_UNI, courseIsActive: 1 }).onConflictDoNothing();
  await db.insert(schema.courses).values({ id: COURSE_GEN, code: 'GEN1001', title: 'درس عمومی تست', units: '2', departmentId: DEPT_GEN, universityId: MY_UNI, courseIsActive: 1 }).onConflictDoNothing();
  // رشته‌ها
  await db.insert(schema.majors).values({ id: MA, name: 'رشتهٔ تست الف', universityId: MY_UNI, isActive: 1, degreeLevelId: DEG_KAR }).onConflictDoNothing();
  await db.insert(schema.majors).values({ id: MB, name: 'رشتهٔ تست ب', universityId: MY_UNI, isActive: 1, degreeLevelId: DEG_KAR }).onConflictDoNothing();
  // کلاس‌ها
  await db.insert(schema.classrooms).values({ id: ROOM_LOCAL, name: 'کلاس تست ۱', capacity: 40, universityId: MY_UNI }).onConflictDoNothing();
  await db.insert(schema.classrooms).values({ id: ROOM_SMALL, name: 'کلاس تست ۲', capacity: 10, universityId: MY_UNI }).onConflictDoNothing();
  await db.insert(schema.classrooms).values({ id: ROOM_SYSTEM, name: 'کلاس عام تست', capacity: 50, universityId: null }).onConflictDoNothing();
  await db.insert(schema.classrooms).values({ id: ROOM_FOREIGN, name: 'کلاس دانشگاه دیگر', capacity: 60, universityId: FOREIGN_UNI }).onConflictDoNothing();
  // ارائه‌ها
  const offBase = { termId: TERM, universityId: MY_UNI, enrolledCount: 0, isActive: 1, waitlistCapacity: 0 };
  await db.insert(schema.course_offerings).values({ id: OFF_TARGETED, courseId: COURSE_ACAD, groupNumber: 1, capacity: 30, professorId: PROF_LOCAL, targetDegreeLevelId: DEG_KAR, targetMajorId: MA, entryYearStart: 1403, entryYearEnd: 1404, ...offBase }).onConflictDoNothing();
  await db.insert(schema.course_offerings).values({ id: OFF_SHARED, courseId: COURSE_GEN, groupNumber: 1, capacity: 40, professorId: null, ...offBase }).onConflictDoNothing();
  await db.insert(schema.course_offerings).values({ id: OFF_INACTIVE, courseId: COURSE_ACAD, groupNumber: 9, capacity: 20, professorId: null, isActive: 0, termId: TERM, universityId: MY_UNI, enrolledCount: 0, waitlistCapacity: 0 }).onConflictDoNothing();
  await db.insert(schema.course_offerings).values({ id: OFF_SCHED_A, courseId: COURSE_GEN, groupNumber: 7, capacity: 30, professorId: PROF_LOCAL, ...offBase }).onConflictDoNothing();
  await db.insert(schema.course_offerings).values({ id: OFF_SCHED_B, courseId: COURSE_ACAD, groupNumber: 8, capacity: 30, professorId: PROF_LOCAL, ...offBase }).onConflictDoNothing();
  await db.insert(schema.course_offerings).values({ id: OFF_INVERT, courseId: COURSE_ACAD, groupNumber: 6, capacity: 20, professorId: null, targetDegreeLevelId: DEG_KAR, targetMajorId: MA, entryYearStart: 1404, entryYearEnd: 1400, ...offBase }).onConflictDoNothing();
  await db.insert(schema.course_offerings).values({ id: OFF_SEAT, courseId: COURSE_GEN, groupNumber: 5, capacity: 1, professorId: null, ...offBase }).onConflictDoNothing();
  // جلسهٔ موجود روی A: روز ۱ (شنبه) ۱۰:۰۰–۱۲:۰۰ در کلاس ۱ با استاد محلی
  await db.insert(schema.schedules).values({
    offeringId: OFF_SCHED_A, scheduleType: 'CLASS', dayOfWeek: 1, startTime: '10:00:00', endTime: '12:00:00', roomId: ROOM_LOCAL, universityId: MY_UNI,
  }).onConflictDoNothing();
  // ترم مالی فعال → وصل‌شده به همان ترم تحصیلی (پل F1)
  await db.insert(schema.financial_terms).values({
    id: FT, universityId: MY_UNI, termCode: 'GM1-FT', title: 'ترم مالی تست', academicTermId: TERM,
    startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2027-01-31T00:00:00Z'), isActive: 1, sortOrder: -100,
  }).onConflictDoNothing();
  // دانشجویان
  const mkStudent = async (id: number, deg: number, major: number | null, year: number, scope: string) => {
    const uid = U0 + 10 + Number(String(id).slice(-2));
    await db.insert(schema.users).values({ id: uid, nationalCode: String(uid).slice(-9), firstName: 'دانشجو' + scope, lastName: 'تست', passwordHash: 'x', isActive: 1 }).onConflictDoNothing();
    await db.insert(schema.students).values({
      id, userId: uid, studentCode: 'GM1-' + scope, degreeLevelId: deg, majorId: major, entryYear: year,
      regulationId: REG_ID, status: 'ACTIVE', universityId: MY_UNI,
    }).onConflictDoNothing();
  };
  await mkStudent(ST_IN_TARGET, DEG_KAR, MA, 1403, 'IN');
  await mkStudent(ST_OUT_MAJOR, DEG_KAR, MB, 1404, 'OUTMAJ');
  await mkStudent(ST_OUT_DEG, DEG_ARS, MA, 1403, 'OUTDEG');
  await mkStudent(ST_OUT_YEAR, DEG_KAR, MA, 1400, 'OUTYR');
  await mkStudent(ST_CLEARED, DEG_KAR, MA, 1403, 'CLR');
  await mkStudent(ST_NOCLEAR, DEG_KAR, MA, 1403, 'NCLR');
  await mkStudent(ST_CLEARED_OUT, DEG_KAR, MB, 1404, 'CLROUT');  // تسویه‌حساب‌ها: فقط STUDENTها که باید رد شوند
  await db.insert(schema.financial_clearances).values({ studentId: ST_CLEARED, termId: TERM, isCleared: 1, universityId: MY_UNI }).onConflictDoNothing();
  await db.insert(schema.financial_clearances).values({ studentId: ST_NOCLEAR, termId: TERM, isCleared: 0, universityId: MY_UNI }).onConflictDoNothing();
  await db.insert(schema.financial_clearances).values({ studentId: ST_CLEARED_OUT, termId: TERM, isCleared: 1, universityId: MY_UNI }).onConflictDoNothing();
}

import { eq } from 'drizzle-orm';

/**
 * REPLICA of courseInDept (src/lib/group-manager.ts) — this module cannot be
 * imported outside Next runtime (it transitively imports `server-only` via
 * @/lib/auth -> settings). The predicate is one line: course.departmentId === deptId.
 * (Action-level authz of the GM panel itself is covered by static review / S2.)
 */
const courseInDept = async (courseId: number, deptId: number): Promise<boolean> => {
  const [r] = (await db.execute(sql`SELECT "departmentId" FROM courses WHERE id = ${courseId}`)).rows as any[];
  return r?.departmentId === deptId;
};

async function putInCart(studentId: number, offeringIds: number[]) {
  for (const oid of offeringIds) {
    await db.insert(schema.cart_items).values({ studentId, offeringId: oid, universityId: MY_UNI }).onConflictDoNothing();
  }
}
const clearCart = async (sid: number) => db.execute(sql.raw('DELETE FROM cart_items WHERE "studentId" = ' + sid));
const clearEnroll = async (sid: number) => db.execute(sql.raw('DELETE FROM enrollments WHERE "studentId" = ' + sid));
/** userId هر دانشجو در seed از همین ثابت مشتق می‌شود */
const uidOf = (sid: number) => U0 + 10 + Number(String(sid).slice(-2));

async function groupB() {
  sec('B — هدف‌گیری اختصاصی/مشترک (offeringVisible)');
  const targeted = { targetDegreeLevelId: DEG_KAR, targetMajorId: MA, entryYearStart: 1403, entryYearEnd: 1404 };
  const shared = { targetDegreeLevelId: null, targetMajorId: null, entryYearStart: null, entryYearEnd: null };
  const sIn = { degreeLevelId: DEG_KAR, majorId: MA, entryYear: 1403 };
  const sOutMajor = { degreeLevelId: DEG_KAR, majorId: MB, entryYear: 1404 };
  const sOutDeg = { degreeLevelId: DEG_ARS, majorId: MA, entryYear: 1403 };
  const sOutYear = { degreeLevelId: DEG_KAR, majorId: MA, entryYear: 1400 };
  check('B1a', 'درهدف = دیده، خارج از رشته = نامرئی', !offeringVisible(targeted, sOutMajor), 'major→false');
  check('B1b', 'درهدف = دیده، خارج از مقطع = نامرئی', !offeringVisible(targeted, sOutDeg), 'degree→false');
  check('B1c', 'درهدف = دیده، خارج از بازهٔ ورودی = نامرئی', !offeringVisible(targeted, sOutYear), 'year→false');
  check('B1d', 'درهدف = دیده', offeringVisible(targeted, sIn), 'in→true');
  check('B3a', 'مشترک برای همه دیده', offeringVisible(shared, sOutMajor) && offeringVisible(shared, sOutDeg) && offeringVisible(shared, sOutYear) && offeringVisible(shared, sIn), 'shared→all true');
  check('B4', 'بازهٔ وارونه (ys>ye) برای هیچ‌کس نامرئی (یافتهٔ محصول)', !offeringVisible({ targetDegreeLevelId: DEG_KAR, targetMajorId: MA, entryYearStart: 1404, entryYearEnd: 1400 }, sIn), 'inverted→all false');

  // B2/B5 — گیت سروری: submit مسیر اختصاصی/مشترک
  await clearEnroll(ST_CLEARED_OUT); await clearCart(ST_CLEARED_OUT);
  await putInCart(ST_CLEARED_OUT, [OFF_TARGETED, OFF_SHARED]);
  const rB2 = await processQueuedSubmit(uidOf(ST_CLEARED_OUT), ST_CLEARED_OUT, false, submitDeps);
  const b2CartLeft = (await db.execute(sql.raw('SELECT count(*)::int n FROM cart_items WHERE "studentId" = ' + ST_CLEARED_OUT + ' AND "offeringId" = ' + OFF_TARGETED))).rows as any[];
  check(
    'B2',
    'H2: ردیف خارج از هدف از سبد حذف + بقیهٔ سبد ثبت می‌شود (نه abort)',
    rB2.ok && rB2.registered.length === 1 && (rB2.droppedCart?.length ?? 0) === 1
      && (rB2.droppedCart![0].reason.includes('هدف') || rB2.droppedCart![0].reason.includes('مقطع'))
      && b2CartLeft[0].n === 0,
    JSON.stringify({ reg: rB2.registered, dropped: rB2.droppedCart, cartLeft: b2CartLeft[0].n, errs: rB2.hardErrors }),
  );

  await clearEnroll(ST_CLEARED); await clearCart(ST_CLEARED);
  await putInCart(ST_CLEARED, [OFF_TARGETED]);
  const rB5 = await processQueuedSubmit(uidOf(ST_CLEARED), ST_CLEARED, false, submitDeps);
  check('B5', 'دانشجوی در هدف: ثبت موفق', rB5.ok && rB5.registered.length === 1, JSON.stringify({ ok: rB5.ok, reg: rB5.registered.length, errs: rB5.hardErrors }));
}

async function groupF1() {
  sec('F1 — گیت مالی (کلید تسویه‌حساب روی ترم تحصیلی)');
  await clearEnroll(ST_CLEARED); await clearCart(ST_CLEARED);
  await putInCart(ST_CLEARED, [OFF_SHARED]);
  const ok = await processQueuedSubmit(uidOf(ST_CLEARED), ST_CLEARED, false, submitDeps);
  check('F1a', 'تسویه با academicTermId → ثبت مجاز', ok.ok && ok.registered.length === 1, JSON.stringify({ ok: ok.ok, reg: ok.registered.length, errs: ok.hardErrors }));
  await clearEnroll(ST_NOCLEAR); await clearCart(ST_NOCLEAR);
  await putInCart(ST_NOCLEAR, [OFF_SHARED]);
  const no = await processQueuedSubmit(uidOf(ST_NOCLEAR), ST_NOCLEAR, false, submitDeps);
  check('F1b', 'بدون تسویه → رد با پیام تسویه‌حساب', !no.ok && no.hardErrors.some(e => e.includes('تسویه‌حساب')), JSON.stringify({ ok: no.ok, errs: no.hardErrors }));
}

async function groupG4() {
  sec('G4 — ارائهٔ غیرفعال از سبد کهنه ثبت نشود');
  await clearEnroll(ST_CLEARED); await clearCart(ST_CLEARED);
  await putInCart(ST_CLEARED, [OFF_INACTIVE, OFF_SHARED]);
  const r = await processQueuedSubmit(uidOf(ST_CLEARED), ST_CLEARED, false, submitDeps);
  const left = (await db.execute(sql.raw('SELECT count(*)::int n FROM cart_items WHERE "studentId" = ' + ST_CLEARED + ' AND "offeringId" = ' + OFF_INACTIVE))).rows as any[];
  check(
    'G4',
    'H2: ارائهٔ غیرفعال از سبد حذف + درس معتبر ثبت می‌شود (نه abort)',
    r.ok && r.registered.length === 1 && (r.droppedCart?.length ?? 0) === 1
      && (r.droppedCart![0].reason.includes('غیرفعال'))
      && left[0].n === 0,
    JSON.stringify({ reg: r.registered, dropped: r.droppedCart, cartLeft: left[0].n, errs: r.hardErrors }),
  );
}

async function groupH() {
  sec('H — یافته‌های باز: یکتایی DB (H1) و بازهٔ سال ورودی (H3)');
  // H1a — ایندکس یکتای (ترم+درس+گروه) واقعاً در DB هست و «جزئی» است (فقط فعال‌ها)
  const idx = (await db.execute(sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'course_offerings' AND indexname = 'uq_course_offerings_term_course_group'`)).rows as any[];
  const idxDef = String(idx[0]?.indexdef ?? '');
  check(
    'H1a',
    'ایندکس یکتای (term+course+group) در DB موجود و جزئی روی isActive=1 است',
    idx.length === 1 && /UNIQUE/i.test(idxDef) && /isActive/i.test(idxDef),
    JSON.stringify(idx),
  );
  // H1b — درج تکراری مستقیم (بدون گارد اپ) باید با unique violation رد شود
  const probe = { courseId: COURSE_GEN, groupNumber: 91, capacity: 5, professorId: null, termId: TERM, universityId: MY_UNI, enrolledCount: 0, isActive: 1, waitlistCapacity: 0 };
  await db.execute(sql.raw('DELETE FROM course_offerings WHERE "courseId" = ' + COURSE_GEN + ' AND "groupNumber" = 91 AND "termId" = ' + TERM));
  await db.insert(schema.course_offerings).values({ id: OFF_SEAT + 200, ...probe });
  const rejected = await db.insert(schema.course_offerings).values({ id: OFF_SEAT + 201, ...probe })
    .then(() => false)
    .catch((e: any) => String(e?.code ?? e?.cause?.code ?? '') === '23505');
  check('H1b', 'درج تکراری مستقیم در DB با 23505 رد می‌شود', rejected, 'unique violation');
  await db.execute(sql.raw('DELETE FROM course_offerings WHERE id IN (' + (OFF_SEAT + 200) + ',' + (OFF_SEAT + 201) + ')'));
  // H3 — اعتبارسنجی بازهٔ سال ورودی (مرجع مشترک فرم مدیر گروه/ادمین)
  check('H3a', 'بازهٔ وارونه (۱۴۰۴→۱۴۰۰) رد می‌شود', (validateEntryYearRange(1404, 1400) ?? '').includes('نامعتبر'), '');
  check('H3b', 'بازهٔ درست (۱۴۰۳→۱۴۰۴) مجاز', validateEntryYearRange(1403, 1404) === null, '');
  check('H3c', 'بدون محدودیت (null,null) مجاز', validateEntryYearRange(null, null) === null, '');
  check('H3d', 'فقط شروع (۱۴۰۳,null) مجاز', validateEntryYearRange(1403, null) === null, '');
  check('H3e', 'شروع = پایان (۱۴۰۳,۱۴۰۳) مجاز', validateEntryYearRange(1403, 1403) === null, '');
}

async function groupC() {
  sec('C — تداخل زمان‌بندی و ظرفیت (offering-scheduling)');
  // C1 پنجره
  check('C1a', 'پایان بعد از شروع = مجاز', validateScheduleWindow('08:00', '09:30') === null, '');
  check('C1b', 'پایان = شروع = رد', (validateScheduleWindow('08:00', '08:00') ?? '').includes('پایان'), '');
  check('C1c', 'پایان قبل از شروع = رد', (validateScheduleWindow('09:00', '08:00') ?? '').includes('پایان'), '');
  // C2/C3 تداخل روی جلسهٔ موجود OFF_SCHED_A (روز ۱، ۱۰–۱۲، کلاس ۱، استاد محلی)
  const roomClash = await detectScheduleConflicts(db, { offeringId: OFF_SCHED_B, termId: TERM, day: 1, start: '10:30', end: '11:30', roomId: ROOM_LOCAL, professorId: PROF_LOCAL });
  check('C2', 'تداخل سالن → رد', roomClash.some(m => m.includes('تداخل سالن')), JSON.stringify(roomClash));
  const profClash = await detectScheduleConflicts(db, { offeringId: OFF_SCHED_B, termId: TERM, day: 1, start: '10:30', end: '11:30', roomId: ROOM_SMALL, professorId: PROF_LOCAL });
  check('C3', 'تداخل استاد → رد', profClash.some(m => m.includes('تداخل استاد')), JSON.stringify(profClash));
  const clean = await detectScheduleConflicts(db, { offeringId: OFF_SCHED_B, termId: TERM, day: 2, start: '08:00', end: '09:30', roomId: ROOM_LOCAL, professorId: PROF_LOCAL });
  check('C7', 'روز دیگر/ساعت آزاد = بدون تداخل', clean.length === 0, JSON.stringify(clean));
  const boundary = await detectScheduleConflicts(db, { offeringId: OFF_SCHED_B, termId: TERM, day: 1, start: '12:00', end: '13:00', roomId: ROOM_LOCAL, professorId: PROF_LOCAL });
  check('C7b', 'مرز مشترک (۱۲:۰۰) تداخل نیست', boundary.length === 0, JSON.stringify(boundary));
  // C5/G7 ظرفیت
  check('C5', 'ظرفیت سالن < ظرفیت ارائه → هشدار', (capacityWarning(10, 30) ?? '').includes('ظرفیت سالن'), '');
  check('C5b', 'ظرفیت سالن ≥ ارائه → بی‌هشدار', capacityWarning(40, 30) === null, '');
  // C6 مرز دانشگاه سالن
  check('C6a', 'سالن دانشگاه دیگر = رد', !roomAllowedForSchedule(FOREIGN_UNI, MY_UNI), '');
  check('C6b', 'سالن عام/سیستمی = مجاز', roomAllowedForSchedule(null, MY_UNI), '');
  check('C6c', 'سالن خودم = مجاز', roomAllowedForSchedule(MY_UNI, MY_UNI), '');
}

async function groupA() {
  sec('A — دامنهٔ گروه و کلاس (predicates)');
  check('A1', 'درس گروه دیگر → courseInDept=false', !(await courseInDept(COURSE_GEN, DEPT_ACAD)) && !(await courseInDept(COURSE_ACAD, DEPT_GEN)), 'cross-dept false');
  check('A1b', 'درس همان گروه → courseInDept=true', (await courseInDept(COURSE_ACAD, DEPT_ACAD)) && (await courseInDept(COURSE_GEN, DEPT_GEN)), 'same-dept true');
  check('G3a', 'فهرست کلاس‌ها فقط دانشگاه خود', (await listClassroomsForUniversity(db, MY_UNI)).every((r: any) => r.universityId === MY_UNI), 'own uni only');
  check('G3b', 'کلاس عام در فهرست مدیر گروه نیست', !(await listClassroomsForUniversity(db, MY_UNI)).some((r: any) => r.id === ROOM_SYSTEM), 'system excluded');
  check('G3c', 'کلاس دانشگاه دیگر در فهرست نیست', !(await listClassroomsForUniversity(db, MY_UNI)).some((r: any) => r.id === ROOM_FOREIGN), 'foreign excluded');
  check('A4', 'مالکیت کلاس: تطابق دقیق دانشگاه', !classroomOwnedBy(null, MY_UNI) && !classroomOwnedBy(FOREIGN_UNI, MY_UNI) && classroomOwnedBy(MY_UNI, MY_UNI), '');
  // G6 استاد
  check('G6a', 'استاد فعال همان دانشگاه = مجاز', await professorInUniversity(db, PROF_LOCAL, MY_UNI), '');
  check('G6b', 'استاد دانشگاه دیگر = رد', !(await professorInUniversity(db, PROF_FOREIGN, MY_UNI)), '');
  check('G6c', 'استاد غیرفعال = رد', !(await professorInUniversity(db, PROF_INACTIVE, MY_UNI)), '');
  check('G6d', 'بی‌استاد = مجاز', await professorInUniversity(db, null, MY_UNI), '');
}

async function groupD() {
  sec('D — چرخهٔ عمر و یونیک‌بودن');
  check('G5a', 'تکراری (درس+گروه) پیدا می‌شود', (await findDuplicateOffering(db, { termId: TERM, courseId: COURSE_ACAD, groupNumber: 1 })) === OFF_TARGETED, '');
  check('G5b', 'خودِ ردیف تکراری نیست (ویرایش)', (await findDuplicateOffering(db, { termId: TERM, courseId: COURSE_ACAD, groupNumber: 1, excludeId: OFF_TARGETED })) === null, '');
  check('G5c', 'گروه تازه تکراری نیست', (await findDuplicateOffering(db, { termId: TERM, courseId: COURSE_ACAD, groupNumber: 77 })) === null, '');
}

async function groupE() {
  sec('E — ثبات و هم‌زمانی');
  // E2: دو ادعای هم‌زمان روی ظرفیت ۱ → دقیقاً یک برنده
  await db.execute(sql.raw('DELETE FROM enrollments WHERE "offeringId" = ' + OFF_SEAT));
  await db.execute(sql.raw('UPDATE course_offerings SET "enrolledCount" = 0 WHERE id = ' + OFF_SEAT));
  const [a, b] = await Promise.all([claimSeatsBatch(db, [OFF_SEAT]), claimSeatsBatch(db, [OFF_SEAT])]);
  check('E2', 'claimSeatsBatch ظرفیت ۱ → یک برنده', a.size + b.size === 1, 'a=' + a.size + ' b=' + b.size);
  // E1: درج هم‌زمان (درس+گروه) تکراری — پس از H1، ایندکس یکتا باید یکی را رد کند
  await db.execute(sql.raw('DELETE FROM course_offerings WHERE "courseId" = ' + COURSE_GEN + ' AND "groupNumber" = 88 AND "termId" = ' + TERM));
  const dupRow = { courseId: COURSE_GEN, groupNumber: 88, capacity: 10, professorId: null, termId: TERM, universityId: MY_UNI, enrolledCount: 0, isActive: 1, waitlistCapacity: 0 };
  const ins = [
    db.insert(schema.course_offerings).values({ id: OFF_SEAT + 100, ...dupRow }),
    db.insert(schema.course_offerings).values({ id: OFF_SEAT + 101, ...dupRow }),
  ];
  const settled = await Promise.allSettled(ins);
  const okCount = settled.filter(s => s.status === 'fulfilled').length;
  const [cnt] = (await db.execute(sql.raw('SELECT count(*)::int n FROM course_offerings WHERE "courseId" = ' + COURSE_GEN + ' AND "groupNumber" = 88 AND "termId" = ' + TERM))).rows as any[];
  check('E1', 'H1: درج هم‌زمان تکراری → ایندکس یکتا دقیقاً یک ردیف می‌پذیرد', cnt.n === 1 && okCount === 1, 'insertsOk=' + okCount + ' rows=' + cnt.n);
}

async function report() {
  const pass = results.filter(r => r.ok).length, fail = results.filter(r => !r.ok).length;
  sec('گزارش gm1');
  for (const r of results) console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.id + ' — ' + r.title + (r.ok ? '' : ' :: ' + r.detail));
  console.log('\nGM1_TOTAL=' + results.length + ' GM1_PASS=' + pass + ' GM1_FAIL=' + fail);
  await pool.end();
  process.exit(fail > 0 ? 2 : 0);
}

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
  await reset();
  await seed();
  await groupB();
  await groupF1();
  await groupG4();
  await groupC();
  await groupA();
  await groupD();
  await groupE();
  await groupH();
  await report();
})().catch(async (e) => { console.error('GM1_FATAL', e); await pool.end(); process.exit(1); });

