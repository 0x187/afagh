import 'server-only';
import crypto from 'crypto';
import { and, eq, exists, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import {
  class_sessions,
  course_offerings,
  courses,
  offering_professors,
  schedules,
  staff,
  users,
  virtual_class_recordings,
  virtual_classrooms,
} from '@/db/schema';
import { jalaliDateOf } from '@/lib/scheduling-core';
import { getBbbConfig } from '@/lib/settings';
import { demoKindForUser } from '@/lib/demo-accounts';
import { DEMO_LIVE_SESSIONS as DEMO_STUDENT_LIVE_SESSIONS } from '@/lib/demo-student-data';
import { DEMO_LIVE_SESSIONS as DEMO_PROFESSOR_LIVE_SESSIONS } from '@/lib/demo-professor-data';

/** تاریخ جلالی امروز به شکل YYYY/MM/DD (هم‌راستا با ستون sessionDate) */
function todayJalali(): string {
  return jalaliDateOf(new Date());
}

/** اندیهٔ روز هفتهٔ جلالی: ۰ = شنبه … ۶ = جمعه (هم‌راستا با schedules.dayOfWeek) */
function jalaliWeekdayIndex(d: Date): number {
  const g = d.getDay();
  return (g + 1) % 7;
}

export interface VirtualClassSession {
  courseId: number;
  courseCode: string;
  courseTitle: string;
  professorName: string;
  meetingId: string;
  startTime: string;
  endTime: string;
  isRunning: boolean;
  activeParticipantsCount: number;
  recordingsCount: number;
}

/**
 * تولید Checksum امن برای درخواست‌های بیگ‌بلوباتن طبق استاندارد API.
 * کلید مخفی از پیکربندی سامانه (پنل مدیر ← ENV) خوانده می‌شود و هرگز در کد ثابت نیست.
 */
export function generateBbbChecksum(callName: string, queryString: string, secret: string, algo: 'SHA1' | 'SHA256' | 'SHA512' = 'SHA256'): string {
  const a = algo === 'SHA1' ? 'sha1' : algo === 'SHA512' ? 'sha512' : 'sha256';
  return crypto.createHash(a).update(`${callName}${queryString}${secret}`).digest('hex');
}

/**
 * دریافت لینک مستقیم ورود به جلسه آنلاین بیگ‌بلوباتن با SSO
 */
export async function getBigBlueButtonJoinUrl({
  meetingId,
  fullName,
  role,
  moderatorPw,
  attendeePw,
}: {
  meetingId: string;
  fullName: string;
  role: 'MODERATOR' | 'ATTENDEE';
  /** رمز ذخیره‌شدهٔ همین جلسه (اگر نبود از تنظیمات کلی) */
  moderatorPw?: string | null;
  attendeePw?: string | null;
}): Promise<{ ok: boolean; url: string; error?: string }> {
  const cfg = await getBbbConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      url: '',
      error: 'سرویس کلاس مجازی پیکربندی نشده است — پنل مدیر ← پیکربندی سامانه ← کلاس مجازی',
    };
  }

  const pw = role === 'MODERATOR'
    ? (moderatorPw || cfg.moderatorPw || 'mod')
    : (attendeePw || cfg.attendeePw || 'att');
  const queryParams = new URLSearchParams({
    fullName,
    meetingID: meetingId,
    password: pw,
    redirect: 'true',
    joinViaHtml5: 'true',
  });
  if (cfg.autoRecord) queryParams.set('record', 'true');

  const queryString = queryParams.toString();
  const checksum = generateBbbChecksum('join', queryString, cfg.secret, cfg.checksumAlgo);

  return { ok: true, url: `${cfg.url}/join?${queryString}&checksum=${checksum}` };
}

/**
 * لیست جلسات آنلاین امروز از جدول واقعی `virtual_classrooms`
 *
 * منبع داده: `virtual_classrooms` × `course_offerings` × `courses` × `staff`
 * (نام مدرس) و شمارش ضبط‌ها از `virtual_class_recordings`.
 * زمان شروع/پایان از `schedules` (ساعت کلاس همان روز هفته) خوانده می‌شود؛
 * اگر برای روز جاری برنامه‌ای ثبت نشده باشد، ساعت‌ها «—» می‌مانند.
 *
 * اگر هیچ کلاس مجازی‌ای ثبت نشده باشد، آرایهٔ خالی برمی‌گردد تا رابط کاربری
 * حالت خالی صادقانه نمایش دهد (نه دادهٔ ساختگی).
 *
 * `universityId`/`staffId` اختیاری‌اند و برای ایزوله‌سازی چنددانشگاهی استفاده
 * می‌شوند: هر استاد/دانشجو فقط جلسات دانشگاه و کلاس‌های خودش را می‌بیند.
 */
export async function getTodayLiveClasses(opts?: {
  universityId?: number | null;
  staffId?: number | null;
  viewerUserId?: number | null;
}): Promise<VirtualClassSession[]> {
  if (opts?.viewerUserId) {
    const kind = await demoKindForUser(opts.viewerUserId);
    if (kind === 'STUDENT') return DEMO_STUDENT_LIVE_SESSIONS;
    if (kind === 'PROFESSOR') return DEMO_PROFESSOR_LIVE_SESSIONS;
  }

  const cond: SQL[] = [];
  if (opts?.universityId) cond.push(eq(virtual_classrooms.universityId, opts.universityId));
  if (opts?.staffId) {
    const mine = or(
      eq(course_offerings.professorId, opts.staffId),
      exists(
        db
          .select({ one: sql`1` })
          .from(offering_professors)
          .where(
            and(
              eq(offering_professors.offeringId, course_offerings.id),
              eq(offering_professors.staffId, opts.staffId),
            ),
          ),
      ),
    );
    if (mine) cond.push(mine);
  }

  const rows = await db
    .select({
      classroomId: virtual_classrooms.id,
      offeringId: virtual_classrooms.courseOfferingId,
      meetingId: virtual_classrooms.bbbMeetingId,
      courseCode: courses.code,
      courseTitle: courses.title,
      professorName: sql<string>`coalesce(${users.firstName} || ' ' || ${users.lastName}, '')`,
      isRunning: virtual_classrooms.isRunning,
      activeParticipantsCount: virtual_classrooms.currentAttendanceCount,
    })
    .from(virtual_classrooms)
    .innerJoin(course_offerings, eq(course_offerings.id, virtual_classrooms.courseOfferingId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .leftJoin(staff, eq(staff.id, course_offerings.professorId))
    .leftJoin(users, eq(users.id, staff.userId))
    .where(cond.length ? and(...cond) : undefined);

  if (rows.length === 0) return [];

  const offeringIds = rows.map(r => r.offeringId);
  const classroomIds = rows.map(r => r.classroomId);

  const [recordings, schedulesToday, sessionsToday] = await Promise.all([
    db
      .select({ classroomId: virtual_class_recordings.classroomId, n: sql<number>`count(*)::int` })
      .from(virtual_class_recordings)
      .where(inArray(virtual_class_recordings.classroomId, classroomIds))
      .groupBy(virtual_class_recordings.classroomId),
    db
      .select({
        offeringId: schedules.offeringId,
        startTime: schedules.startTime,
        endTime: schedules.endTime,
      })
      .from(schedules)
      .where(
        and(
          inArray(schedules.offeringId, offeringIds),
          eq(schedules.scheduleType, 'CLASS'),
          eq(schedules.dayOfWeek, jalaliWeekdayIndex(new Date())),
        ),
      ),
    db
      .select({
        offeringId: class_sessions.offeringId,
        startTime: class_sessions.startTime,
        endTime: class_sessions.endTime,
      })
      .from(class_sessions)
      .where(and(inArray(class_sessions.offeringId, offeringIds), eq(class_sessions.sessionDate, todayJalali()))),
  ]);

  const recordingCount = new Map(recordings.map(r => [r.classroomId, Number(r.n)]));
  const timeOf = new Map<number, { start: string; end: string }>();
  for (const s of sessionsToday) {
    timeOf.set(s.offeringId, { start: String(s.startTime).slice(0, 5), end: String(s.endTime).slice(0, 5) });
  }
  for (const s of schedulesToday) {
    if (timeOf.has(s.offeringId)) continue;
    timeOf.set(s.offeringId, { start: String(s.startTime).slice(0, 5), end: String(s.endTime).slice(0, 5) });
  }

  return rows.map(r => ({
    courseId: r.offeringId,
    courseCode: r.courseCode,
    courseTitle: r.courseTitle,
    professorName: r.professorName || '—',
    meetingId: r.meetingId,
    startTime: timeOf.get(r.offeringId)?.start ?? '—',
    endTime: timeOf.get(r.offeringId)?.end ?? '—',
    isRunning: (r.isRunning ?? 0) === 1,
    activeParticipantsCount: Number(r.activeParticipantsCount ?? 0),
    recordingsCount: recordingCount.get(r.classroomId) ?? 0,
  }));
}

/**
 * آیا در سامانه برای این دامنه **اصلاً** اتاق کلاس مجازی تعریف شده است؟
 *
 * چرا جدا از `getTodayLiveClasses`: آن تابع فقط «جلسات امروز» را برمی‌گرداند و
 * آرایهٔ خالی می‌تواند دو معنا داشته باشد — «هیچ کلاسی امروز نیست» یا
 * «کلاس مجازی در سامانه راه‌اندازی نشده». برای تصمیمِ نمایش/عدم‌نمایشِ ویجت
 * باید این دو را از هم تشخیص داد: اگر هیچ اتاقی تعریف نشده باشد، ویجت
 * («کلاس‌های آنلاین امروز») در داشبورد استاد به‌کل رندر نمی‌شود.
 */
export async function hasVirtualClassroomSetup(opts?: {
  universityId?: number | null;
  staffId?: number | null;
  viewerUserId?: number | null;
}): Promise<boolean> {
  if (opts?.viewerUserId) {
    const kind = await demoKindForUser(opts.viewerUserId);
    if (kind === 'STUDENT' || kind === 'PROFESSOR') return true;
  }

  const cond: SQL[] = [];
  if (opts?.universityId) cond.push(eq(virtual_classrooms.universityId, opts.universityId));
  if (opts?.staffId) {
    const mine = or(
      eq(course_offerings.professorId, opts.staffId),
      exists(
        db
          .select({ one: sql`1` })
          .from(offering_professors)
          .where(
            and(
              eq(offering_professors.offeringId, course_offerings.id),
              eq(offering_professors.staffId, opts.staffId),
            ),
          ),
      ),
    );
    if (mine) cond.push(mine);
  }

  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(virtual_classrooms)
    .innerJoin(course_offerings, eq(course_offerings.id, virtual_classrooms.courseOfferingId))
    .where(cond.length ? and(...cond) : undefined)
    .limit(1);

  return !!row;
}
