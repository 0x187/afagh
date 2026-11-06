/**
 * ═══════════════════════════════════════════════════════════════════════
 * عارضه‌یابی خودکار برنامهٔ درسی (Global Health Check) — تکهٔ مستقل
 *
 * پس از پایان برنامه‌ریزی گروه‌ها، کارشناس آموزش کل این موتور را اجرا می‌کند:
 *  - تداخل‌های پنهان استاد/مکان (باید صفر باشد؛ اگر دستی/Override داشته باشد پیدا می‌شود)
 *  - عرضه در برابر تقاضا (گروه پیشنهادی از کارنامه/چارت در برابر گروه ساخته‌شده)
 *  - کلاس‌های مشترک بدون تخصیص (یتیم)
 *  - بهره‌وری (سالن، شیفت) و شیفت‌های خالی
 *  - استخر شناور استفاده‌نشده
 * ═══════════════════════════════════════════════════════════════════════
 */
import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  course_offerings, courses, schedules, scheduling_allocations,
  scheduling_room_grants,
} from '@/db/schema';
import { countInternalGaps, overlaps, shiftUtilization, toMinutes, type Shift } from '@/lib/scheduling-core';
import { detectExamConflicts } from '@/lib/exam-scheduler';
import { forecastCourseDemand } from '@/lib/scheduling-engine';

const hm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : '');

export interface HealthReport {
  termId: number;
  hiddenConflicts: { kind: 'PROFESSOR' | 'ROOM'; dayOfWeek: number; startTime: string; endTime: string; a: number; b: number }[];
  supplyVsDemand: { courseId: number; title: string; suppliedGroups: number; suggestedGroups: number; gap: number; eligibleStudents: number }[];
  unallocatedShared: { offeringId: number; courseId: number; groupNumber: number }[];
  roomShiftUsage: { classroomId: number; classroomName: string; facultyId: number | null; shift: Shift; occupiedMinutes: number; utilization: number }[];
  releasedUnused: { classroomId: number; shift: Shift }[];
  /** تداخل‌های امتحانی — قطعی (هم‌زمان) و نرم (همان روز) */
  examConflicts: {
    hard: { a: number; b: number; courseA: string; courseB: string; examDate: string; message: string }[];
    soft: { a: number; b: number; courseA: string; courseB: string; examDate: string; message: string }[];
  };
  /** استادانی که روزهایشان پراکنده است (ساعت خالی بین کلاس‌ها) — بند ۴ب */
  fragmentedProfessorDays: { professorId: number; dayOfWeek: number; gaps: number; blocks: number }[];
  lines: string[];
}

export async function runSchedulingHealthCheck(termId: number): Promise<HealthReport> {
  const report: HealthReport = {
    termId, hiddenConflicts: [], supplyVsDemand: [], unallocatedShared: [],
    roomShiftUsage: [], releasedUnused: [], lines: [],
    examConflicts: { hard: [], soft: [] }, fragmentedProfessorDays: [],
  };

  // ── ۱) تداخل‌های پنهان (استاد/مکان) ──
  const rows = (await db.execute(sql`
    select s.id as "scheduleId", s."dayOfWeek", s."startTime", s."endTime", s."roomId",
           o."professorId", o."courseId"
    from schedules s join course_offerings o on o.id = s."offeringId"
    where o."termId" = ${termId}
  `)).rows as { scheduleId: number; dayOfWeek: number; startTime: string; endTime: string; roomId: number | null; professorId: number | null; courseId: number }[];

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]; const b = rows[j];
      if (Number(a.dayOfWeek) !== Number(b.dayOfWeek)) continue;
      const aS = toMinutes(hm(a.startTime)); const aE = toMinutes(hm(a.endTime));
      const bS = toMinutes(hm(b.startTime)); const bE = toMinutes(hm(b.endTime));
      if (!overlaps(aS, aE, bS, bE)) continue;
      if (a.professorId !== null && Number(a.professorId) === Number(b.professorId)) {
        report.hiddenConflicts.push({ kind: 'PROFESSOR', dayOfWeek: Number(a.dayOfWeek), startTime: hm(a.startTime), endTime: hm(a.endTime), a: a.scheduleId, b: b.scheduleId });
      }
      if (a.roomId !== null && Number(a.roomId) === Number(b.roomId)) {
        report.hiddenConflicts.push({ kind: 'ROOM', dayOfWeek: Number(a.dayOfWeek), startTime: hm(a.startTime), endTime: hm(a.endTime), a: a.scheduleId, b: b.scheduleId });
      }
    }
  }
  report.lines.push(report.hiddenConflicts.length
    ? `🚨 ${report.hiddenConflicts.length} تداخل پنهان (استاد/مکان) یافت شد.`
    : `✅ تداخل پنهان استاد/مکان: صفر.`);

  // ── ۲) کلاس‌های مشترک بدون تخصیص ──
  const unalloc = (await db.execute(sql`
    select o.id as "offeringId", o."courseId", o."groupNumber"
    from course_offerings o
    where o."termId" = ${termId} and o."isSharedService" = 1
      and o.id not in (select a."offeringId" from scheduling_allocations a where a."termId" = ${termId})
    order by o."courseId", o."groupNumber"
  `)).rows as { offeringId: number; courseId: number; groupNumber: number }[];
  report.unallocatedShared = unalloc;
  report.lines.push(unalloc.length
    ? `⚠ ${unalloc.length} کلاس مشترک هنوز به هیچ گروهی تخصیص نیافته (یتیم).`
    : '✅ همهٔ کلاس‌های مشترک تخصیص یافته‌اند.');

  // ── ۳) عرضه در برابر تقاضا ──
  const sharedCourses = (await db.execute(sql`
    select o."courseId", count(*)::int as n
    from course_offerings o where o."termId" = ${termId} and o."isSharedService" = 1
    group by o."courseId"
  `)).rows as { courseId: number; n: number }[];
  for (const sc of sharedCourses) {
    try {
      const demand = await forecastCourseDemand(Number(sc.courseId));
      const [course] = await db.select({ title: courses.title }).from(courses).where(eq(courses.id, sc.courseId)).limit(1);
      const gap = Number(sc.n) - demand.suggestedGroups;
      report.supplyVsDemand.push({
        courseId: Number(sc.courseId), title: course?.title ?? '؟',
        suppliedGroups: Number(sc.n), suggestedGroups: demand.suggestedGroups,
        gap, eligibleStudents: demand.eligibleStudents,
      });
      report.lines.push(gap > 0
        ? `📉 درس «${course?.title}»: ${demand.eligibleStudents} متقاضی واقعی → ${demand.suggestedGroups} گروه پیشنهادی، ولی ${sc.n} گروه ساخته شده (${gap} مازاد).`
        : gap < 0
          ? `📈 درس «${course?.title}»: ${demand.eligibleStudents} متقاضی واقعی → ${demand.suggestedGroups} گروه پیشنهادی، فقط ${sc.n} گروه ساخته شده (کمبود ${-gap}).`
          : `✅ درس «${course?.title}»: عرضه دقیقاً با تقاضا (${demand.suggestedGroups} گروه) هم‌خوان است.`);
    } catch { /* درس بدون syllabus → رد شدن در پیش‌بینی بی‌خطر است */ }
  }

  // ── ۴) بهره‌وری (سالن، شیفت) ──
  const usage = (await db.execute(sql`
    select s."roomId", c.name as "classroomName", c."facultyId", s."dayOfWeek",
           s."startTime", s."endTime"
    from schedules s
    join course_offerings o on o.id = s."offeringId"
    join classrooms c on c.id = s."roomId"
    where o."termId" = ${termId} and s."roomId" is not null
  `)).rows as { roomId: number; classroomName: string; facultyId: number | null; dayOfWeek: number; startTime: string; endTime: string }[];

  const perShift = new Map<string, { classroomId: number; classroomName: string; facultyId: number | null; shift: Shift; minutes: number }>();
  for (const u of usage) {
    const start = toMinutes(hm(u.startTime));
    const end = toMinutes(hm(u.endTime));
    const key = `${u.roomId}:${end <= 12 * 60 ? 'MORNING' : 'EVENING'}`;
    const cur = perShift.get(key) ?? { classroomId: Number(u.roomId), classroomName: u.classroomName, facultyId: u.facultyId ? Number(u.facultyId) : null, shift: (end <= 12 * 60 ? 'MORNING' : 'EVENING') as Shift, minutes: 0 };
    cur.minutes += end - start;
    perShift.set(key, cur);
  }
  for (const ps of perShift.values()) {
    const capMinutes = ps.shift === 'MORNING' ? 4 * 60 : 4 * 60;
    report.roomShiftUsage.push({ ...ps, occupiedMinutes: ps.minutes, utilization: shiftUtilization(ps.minutes, capMinutes) });
  }
  report.lines.push(`🏛️ بهره‌وری سالن‌ها: ${report.roomShiftUsage.filter(r => r.utilization === 0).length} شیفت کاملاً خالی از ${report.roomShiftUsage.length} شیفتِ برنامه‌دار.`);

  // ── ۵) استخر شناور استفاده‌نشده ──
  const released = (await db.execute(sql`
    select g."classroomId", g.shift from scheduling_room_grants g
    where g."termId" = ${termId} and g.status = 'RELEASED'
  `)).rows as { classroomId: number; shift: Shift }[];
  report.releasedUnused = released;
  report.lines.push(released.length
    ? `🔄 ${released.length} شیفت در استخر شناور آزاد و قابل استفاده است.`
    : '✅ استخر شناور خالی است (یا همهٔ شیفت‌ها مصرف شده‌اند).');

  // ── ۶) تداخل‌های امتحانی (قطعی و نرم) ──
  // موتور امتحانات از قبل وجود داشت (`exam-scheduler.ts`) ولی تابلوی برنامه‌ریزی
  // هیچ‌وقت صدایش نمی‌زد؛ حالا هر دو نوع تداخل اینجا دیده می‌شود.
  const examRows = (await db.execute(sql`
    select o.id as "offeringId", c.code as "courseCode", s."examDate", s."startTime", s."endTime"
    from schedules s
    join course_offerings o on o.id = s."offeringId"
    join courses c on c.id = o."courseId"
    where o."termId" = ${termId} and s."scheduleType" = 'EXAM' and s."examDate" is not null
  `)).rows as { offeringId: number; courseCode: string; examDate: string; startTime: string; endTime: string }[];

  const examSlots = examRows.map(r => ({
    offeringId: Number(r.offeringId),
    courseCode: r.courseCode ?? '—',
    // ستون date در درایور به شکل 'YYYY-MM-DD' یا Date برمی‌گردد؛ یکسان‌سازی
    examDate: String(r.examDate).slice(0, 10).replace(/-/g, '/'),
    startTime: hm(r.startTime),
    endTime: hm(r.endTime),
  }));
  report.examConflicts = detectExamConflicts(examSlots);
  report.lines.push(
    report.examConflicts.hard.length
      ? `📝 ${report.examConflicts.hard.length} تداخل قطعی امتحانی (هم‌زمان) پیدا شد.`
      : `✅ هیچ تداخل قطعی امتحانی وجود ندارد (${examSlots.length} امتحان زمان‌بندی‌شده).`,
  );
  if (report.examConflicts.soft.length) {
    report.lines.push(`⚠️ ${report.examConflicts.soft.length} امتحان در همان روز (تداخل نرم — برای دانشجویان مشترک خسته‌کننده است).`);
  }

  // ── ۷) پراکندگی روزهای استاد (ساعت خالی بین کلاس‌ها) ──
  const profBlocks = new Map<string, { professorId: number; dayOfWeek: number; blocks: { start: number; end: number }[] }>();
  for (const r of rows) {
    if (r.professorId == null || r.dayOfWeek == null) continue;
    const key = `${r.professorId}:${r.dayOfWeek}`;
    const cur = profBlocks.get(key) ?? { professorId: Number(r.professorId), dayOfWeek: Number(r.dayOfWeek), blocks: [] };
    cur.blocks.push({ start: toMinutes(hm(r.startTime)), end: toMinutes(hm(r.endTime)) });
    profBlocks.set(key, cur);
  }
  for (const v of profBlocks.values()) {
    const gaps = countInternalGaps(v.blocks);
    if (gaps > 0) report.fragmentedProfessorDays.push({ ...v, gaps, blocks: v.blocks.length });
  }
  report.fragmentedProfessorDays.sort((a, b) => b.gaps - a.gaps);
  report.lines.push(report.fragmentedProfessorDays.length
    ? `⏳ ${report.fragmentedProfessorDays.length} روزِ استاد با ساعت خالی بین کلاس‌ها (بیشترین: ${report.fragmentedProfessorDays[0].gaps} ساعت خالی).`
    : '✅ هیچ روزی با ساعت خالیِ میانی برای استادان پیدا نشد.');

  return report;
}
