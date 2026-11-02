/**
 * «چه کسی حضورِ کلاس را ثبت می‌کند؟» — یک‌جا، بدون تکرارِ منطق.
 *
 * دو مسیرِ ثبت وجود دارد و مدیر سامانه انتخاب می‌کند کدام فعال باشد
 * (تنظیمِ `ATTENDANCE_RECORDER_MODE`):
 *
 *   PROFESSOR  → فقط خودِ استاد با اسکنِ QRِ سردر (رفتارِ کلاسیک)
 *   CONTROLLER → فقط کنترل‌کنندهٔ حضور و غیاب (نقشِ ATTENDANCE_CONTROLLER)
 *   BOTH       → هر دو (پیش‌فرض)
 *
 * نکتهٔ مهم: «کنترل‌کننده» ردیفِ حضور را به نامِ *استادِ همان درس* می‌نویسد،
 * نه به نامِ خودش. ستون‌های `professor_class_attendance`:
 *   staffId           → استادی که حضورش ثبت می‌شود
 *   confirmedByStaffId → کسی که واقعاً ثبت کرد (کنترل‌کننده/کارشناس)
 *   verificationMethod → QR_SCAN (خودِ استاد) یا QR_BY_CONTROLLER (کنترل‌کننده)
 * بنابراین موتور حقوق، کارنامهٔ عملکرد و گزارش‌های موجود بدون تغییر کار
 * می‌کنند و در همان حال زنجیرهٔ ممیزی کامل است.
 *
 * دامنهٔ اختیاراتِ کنترل‌کننده (از دقیق به کلی):
 *   ۱) `classroom_edu_experts`          → اتاق‌هایی که مدیر به او سپرده
 *   ۲) `course_offering_edu_experts`    → استثنای درس‌هایی که در همین اتاق‌اند
 *   ۳) `expert_scopes`                  → دانشکدهٔ اتاق / دانشگاه
 *   ۴) اگر تنظیمِ ROOM_SCOPED خاموش باشد → کلِ دانشگاهِ خودش
 *
 * این ماژول عمداً بدون 'use server' است تا هم در Server Action و هم در
 * Server Component قابل استفاده باشد.
 */

import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { db } from '@/db';
import {
  class_sessions,
  classroom_edu_experts,
  classrooms,
  faculties,
  course_offering_edu_experts,
  course_offerings,
  courses,
  expert_scopes,
  offering_professors,
  professor_class_attendance,
  roles,
  schedules,
  staff,
  user_roles,
  users,
} from '@/db/schema';
import { getBool, getSetting } from '@/lib/settings';
import { iranDowFromJalali } from '@/lib/room-checkin';
import { groupSessionsIntoMerged, type MergedSessionGroup } from '@/lib/merged-class-core';

export type AttendanceRecorderMode = 'PROFESSOR' | 'CONTROLLER' | 'BOTH';

/** تنظیمِ مدیر با اعتبارسنجیِ سخت — هر مقدارِ ناشناخته = BOTH (رفتارِ امن) */
export async function getAttendanceRecorderMode(): Promise<AttendanceRecorderMode> {
  const v = (await getSetting('ATTENDANCE_RECORDER_MODE').catch(() => 'BOTH')).trim().toUpperCase();
  return v === 'PROFESSOR' || v === 'CONTROLLER' ? v : 'BOTH';
}

export interface RecorderPolicy {
  mode: AttendanceRecorderMode;
  /** آیا خودِ استاد می‌تواند ثبت کند؟ */
  professorAllowed: boolean;
  /** آیا کنترل‌کننده/کارشناس می‌تواند به‌جای استاد ثبت کند؟ */
  controllerAllowed: boolean;
  /** کنترل‌کننده به اتاق‌های تخصیص‌یافته محدود است؟ */
  roomScoped: boolean;
}

export async function getRecorderPolicy(): Promise<RecorderPolicy> {
  const [mode, roomScoped] = await Promise.all([
    getAttendanceRecorderMode(),
    getBool('ATTENDANCE_CONTROLLER_ROOM_SCOPED').catch(() => true),
  ]);
  return {
    mode,
    professorAllowed: mode !== 'CONTROLLER',
    controllerAllowed: mode !== 'PROFESSOR',
    roomScoped,
  };
}

export type ControlSource = 'admin' | 'room' | 'offering' | 'faculty' | 'university' | null;

export interface ControlResult {
  allowed: boolean;
  source: ControlSource;
  /** نقش‌های کاربر — تا UI بداند چرا اجازه ندارد */
  roles: string[];
}

async function roleCodesOf(userId: number): Promise<string[]> {
  const rows = await db
    .select({ code: roles.code })
    .from(user_roles)
    .innerJoin(roles, eq(roles.id, user_roles.roleId))
    .where(eq(user_roles.userId, userId))
    .catch(() => []);
  return rows.map((r) => r.code).filter(Boolean) as string[];
}

/**
 * آیا این کاربر اجازه دارد حضورِ جلساتِ این اتاق را ثبت کند؟
 * (به‌تنهایی دربارهٔ تنظیمِ حالت تصمیم نمی‌گیرد — آن با getRecorderPolicy است.)
 */
export async function canControlRoom(userId: number, roomId: number): Promise<ControlResult> {
  const roleCodes = await roleCodesOf(userId);
  if (roleCodes.includes('ADMIN')) return { allowed: true, source: 'admin', roles: roleCodes };

  const isController = roleCodes.includes('ATTENDANCE_CONTROLLER');
  const isExpert = roleCodes.includes('EDU_EXPERT');
  if (!isController && !isExpert) return { allowed: false, source: null, roles: roleCodes };

  const [room] = await db
    .select({ id: classrooms.id, universityId: classrooms.universityId, facultyId: classrooms.facultyId })
    .from(classrooms)
    .where(eq(classrooms.id, roomId))
    .limit(1)
    .catch(() => []);
  if (!room) return { allowed: false, source: null, roles: roleCodes };

  // ۱) تخصیصِ مستقیمِ اتاق (صفحهٔ «تخصیص کارشناس به اتاق‌ها»)
  const [direct] = await db
    .select({ id: classroom_edu_experts.id })
    .from(classroom_edu_experts)
    .where(and(eq(classroom_edu_experts.classroomId, roomId), eq(classroom_edu_experts.userId, userId)))
    .limit(1)
    .catch(() => []);
  if (direct) return { allowed: true, source: 'room', roles: roleCodes };

  // ۲) استثنای درس: کارشناسِ درسی که در همین اتاق برگزار می‌شود
  const roomOfferings = await db
    .select({ offeringId: schedules.offeringId })
    .from(schedules)
    .where(and(eq(schedules.roomId, roomId), ne(schedules.scheduleType, 'EXAM')))
    .catch(() => []);
  const offeringIds = [...new Set(roomOfferings.map((r) => r.offeringId).filter((v): v is number => typeof v === 'number'))];
  if (offeringIds.length) {
    const [byOffering] = await db
      .select({ id: course_offering_edu_experts.id })
      .from(course_offering_edu_experts)
      .where(and(
        inArray(course_offering_edu_experts.offeringId, offeringIds),
        eq(course_offering_edu_experts.userId, userId),
      ))
      .limit(1)
      .catch(() => []);
    if (byOffering) return { allowed: true, source: 'offering', roles: roleCodes };
  }

  // ۳) دامنهٔ نقش: دانشکدهٔ اتاق یا دانشگاهِ آن
  const scopes = await db
    .select({ scopeType: expert_scopes.scopeType, scopeId: expert_scopes.scopeId })
    .from(expert_scopes)
    .where(eq(expert_scopes.userId, userId))
    .catch(() => []);
  if (scopes.length) {
    const hitFaculty = room.facultyId != null
      && scopes.some((s) => s.scopeType === 'FACULTY' && s.scopeId === room.facultyId);
    if (hitFaculty) return { allowed: true, source: 'faculty', roles: roleCodes };
    const hitUni = room.universityId != null
      && scopes.some((s) => s.scopeType === 'UNIVERSITY' && s.scopeId === room.universityId);
    if (hitUni) return { allowed: true, source: 'university', roles: roleCodes };
  }

  // ۴) دانشگاهِ خودِ کاربر — فقط اگر مدیر «محدود به اتاق» را خاموش کرده باشد
  const roomScoped = await getBool('ATTENDANCE_CONTROLLER_ROOM_SCOPED').catch(() => true);
  if (!roomScoped) {
    const [u] = await db
      .select({ universityId: users.universityId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .catch(() => []);
    const mine = u?.universityId ?? null;
    if (mine != null && (room.universityId == null || room.universityId === mine)) {
      return { allowed: true, source: 'university', roles: roleCodes };
    }
  }

  return { allowed: false, source: null, roles: roleCodes };
}

/**
 * اتاق‌هایی که این کاربر مسئولشان است — برای کارتابل «حضور و غیاب امروز».
 * `ADMIN` → همهٔ اتاق‌های فعالِ دانشگاه. بقیه → فقط اتاق‌های تخصیص‌یافته
 * (و اگر تنظیمِ ROOM_SCOPED خاموش باشد، همهٔ اتاق‌های دانشگاهِ خودش).
 */
export async function listControlledRooms(
  userId: number,
  universityId: number | null,
): Promise<{ id: number; name: string; buildingName: string | null }[]> {
  const roleCodes = await roleCodesOf(userId);
  const isAdmin = roleCodes.includes('ADMIN');
  const roomScoped = await getBool('ATTENDANCE_CONTROLLER_ROOM_SCOPED').catch(() => true);

  const base = await db
    .select({ id: classrooms.id, name: classrooms.name, buildingName: classrooms.buildingName })
    .from(classrooms)
    .where(and(
      eq(classrooms.isActive, 1),
      universityId != null ? eq(classrooms.universityId, universityId) : undefined,
    ))
    .orderBy(classrooms.name)
    .catch(() => []);

  if (isAdmin || !roomScoped) return base;

  const mine = await db
    .select({ roomId: classroom_edu_experts.classroomId })
    .from(classroom_edu_experts)
    .where(eq(classroom_edu_experts.userId, userId))
    .catch(() => []);
  const ids = new Set(mine.map((m) => m.roomId));

  // اتاق‌های درس‌هایی که به‌عنوان استثنا به این کاربر سپرده شده‌اند
  const offeringRows = await db
    .select({ offeringId: course_offering_edu_experts.offeringId })
    .from(course_offering_edu_experts)
    .where(eq(course_offering_edu_experts.userId, userId))
    .catch(() => []);
  if (offeringRows.length) {
    const rs = await db
      .select({ roomId: schedules.roomId })
      .from(schedules)
      .where(and(
        inArray(schedules.offeringId, offeringRows.map((o) => o.offeringId)),
        ne(schedules.scheduleType, 'EXAM'),
      ))
      .catch(() => []);
    for (const r of rs) if (r.roomId != null) ids.add(r.roomId);
  }

  return base.filter((r) => ids.has(r.id));
}

/** 'HH:MM' */
const hm5 = (v: string | null | undefined) => String(v ?? '').slice(0, 5);

export interface ControlSessionRow {
  roomId: number;
  roomName: string;
  buildingName: string | null;
  sessionId: number;
  offeringId: number;
  startTime: string;
  endTime: string;
  courseTitle: string;
  courseCode: string;
  groupNumber: number;
  professorStaffId: number | null;
  professorStaffCode: string | null;
  professorName: string;
  facultyId: number | null;
  facultyName: string | null;
  /** ردیفِ حضورِ موجود (اگر ثبت شده باشد) */
  recordedAt: Date | null;
  recordedMethod: string | null;
  recordedStatus: string | null;
  recordedBy: string | null;
  /** کلیدِ ادغامِ دستی — برای تشخیصِ «کلاس ادغامی» (یک جلسه، چند عرضه) */
  sharedScheduleGroupKey: string | null;
}

/**
 * جلساتِ «امروزِ» چند اتاق در یک کوئری — برای کارتابل کنترل‌کننده.
 *
 * چرا مثل `listSessionsInRoom` تک‌اتاق نیست: کنترل‌کننده چند اتاق دارد و
 * صدا زدنِ آن تابع در حلقه برای ۴۹ اتاق یعنی ~۱۰۰ کوئری در هر بار باز کردنِ
 * صفحه. این‌جا همان منطقِ حلِ اتاق (اسلاتِ هفتگی ↔ جلسه) یک‌جا و دسته‌ای
 * اجرا می‌شود.
 */
export async function listTodaySessionsForRooms(
  roomIds: number[],
  jalaliDate: string,
): Promise<ControlSessionRow[]> {
  if (!roomIds.length) return [];
  const dow = iranDowFromJalali(jalaliDate);
  if (dow == null) return [];

  const slots = await db
    .select({ roomId: schedules.roomId, offeringId: schedules.offeringId, startTime: schedules.startTime })
    .from(schedules)
    .where(and(
      inArray(schedules.roomId, roomIds),
      eq(schedules.scheduleType, 'CLASS'),
      eq(schedules.dayOfWeek, dow),
    ))
    .catch(() => []);

  // roomId → مجموعهٔ «offeringId|HH:MM» و فهرستِ offeringId
  const slotByRoom = new Map<number, Set<string>>();
  const offeringIds = new Set<number>();
  for (const s of slots) {
    if (s.roomId == null) continue;
    const set = slotByRoom.get(s.roomId) ?? new Set<string>();
    set.add(`${s.offeringId}|${hm5(s.startTime)}`);
    slotByRoom.set(s.roomId, set);
    offeringIds.add(s.offeringId);
  }

  const scope = [inArray(class_sessions.roomId, roomIds)];
  if (offeringIds.size) scope.push(inArray(class_sessions.offeringId, [...offeringIds]));

  const rows = await db
    .select({
      sessionId: class_sessions.id,
      offeringId: class_sessions.offeringId,
      startTime: class_sessions.startTime,
      endTime: class_sessions.endTime,
      explicitRoomId: class_sessions.roomId,
      courseTitle: courses.title,
      courseCode: courses.code,
      groupNumber: course_offerings.groupNumber,
      professorStaffId: course_offerings.professorId,
      sharedScheduleGroupKey: course_offerings.sharedScheduleGroupKey,
    })
    .from(class_sessions)
    .innerJoin(course_offerings, eq(course_offerings.id, class_sessions.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(
      eq(class_sessions.sessionDate, jalaliDate),
      eq(class_sessions.isActive, 1),
      or(...scope),
    ))
    .orderBy(class_sessions.startTime)
    .catch(() => []);
  if (!rows.length) return [];

  // نگاشتِ اتاق‌ها
  const roomMeta = new Map(
    (await db
      .select({ id: classrooms.id, name: classrooms.name, buildingName: classrooms.buildingName, facultyId: classrooms.facultyId })
      .from(classrooms)
      .where(inArray(classrooms.id, roomIds))
      .catch(() => []))
      .map((r) => [r.id, r] as const),
  );

  const facultyIds = [...new Set([...roomMeta.values()].map((r) => r.facultyId).filter((v): v is number => typeof v === 'number'))];
  const facultyName = new Map<number, string>();
  if (facultyIds.length) {
    const fs = await db.select({ id: faculties.id, name: faculties.name }).from(faculties).where(inArray(faculties.id, facultyIds)).catch(() => []);
    for (const f of fs) facultyName.set(f.id, f.name);
  }

  // استادها
  const profIds = [...new Set(rows.map((r) => r.professorStaffId).filter((v): v is number => typeof v === 'number'))];
  const profName = new Map<number, string>();
  const profCode = new Map<number, string | null>();
  if (profIds.length) {
    const ps = await db
      .select({ id: staff.id, firstName: users.firstName, lastName: users.lastName, staffCode: staff.staffCode })
      .from(staff)
      .innerJoin(users, eq(users.id, staff.userId))
      .where(inArray(staff.id, profIds))
      .catch(() => []);
    for (const p of ps) { profName.set(p.id, `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()); profCode.set(p.id, p.staffCode ?? null); }
  }

  // حضورهای ثبت‌شده (همهٔ روش‌ها؛ آخرین ردیفِ معتبر برنده است)
  const sessionIds = rows.map((r) => r.sessionId);
  const att = await db
    .select({
      sessionId: professor_class_attendance.sessionId,
      staffId: professor_class_attendance.staffId,
      recordedAt: professor_class_attendance.recordedAt,
      method: professor_class_attendance.verificationMethod,
      status: professor_class_attendance.status,
      confirmedBy: professor_class_attendance.confirmedByStaffId,
    })
    .from(professor_class_attendance)
    .where(and(
      inArray(professor_class_attendance.sessionId, sessionIds),
      ne(professor_class_attendance.status, 'REVOKED'),
    ))
    .catch(() => []);

  const confirmIds = [...new Set(att.map((a) => a.confirmedBy).filter((v): v is number => typeof v === 'number'))];
  const confirmName = new Map<number, string>();
  if (confirmIds.length) {
    const cs = await db
      .select({ id: staff.id, firstName: users.firstName, lastName: users.lastName, staffCode: staff.staffCode })
      .from(staff)
      .innerJoin(users, eq(users.id, staff.userId))
      .where(inArray(staff.id, confirmIds))
      .catch(() => []);
    for (const c of cs) confirmName.set(c.id, `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim());
  }

  const attBySession = new Map<number, (typeof att)[number]>();
  for (const a of att) if (!attBySession.has(a.sessionId)) attBySession.set(a.sessionId, a);

  const out: ControlSessionRow[] = [];
  for (const r of rows) {
    // حلِ اتاق: اگر جلسه اتاقِ صریح دارد همان است؛ وگرنه از اسلاتِ هفتگی
    let roomId: number | null = null;
    if (r.explicitRoomId != null) {
      if (roomIds.includes(r.explicitRoomId)) roomId = r.explicitRoomId;
    } else {
      for (const id of roomIds) {
        if (slotByRoom.get(id)?.has(`${r.offeringId}|${hm5(r.startTime)}`)) {
          roomId = id;
          break;
        }
      }
    }
    if (roomId == null) continue;

    const meta = roomMeta.get(roomId);
    const a = attBySession.get(r.sessionId) ?? null;
    out.push({
      roomId,
      roomName: meta?.name ?? `اتاق #${roomId}`,
      buildingName: meta?.buildingName ?? null,
      sessionId: r.sessionId,
      offeringId: r.offeringId,
      startTime: hm5(r.startTime),
      endTime: hm5(r.endTime),
      courseTitle: r.courseTitle,
      courseCode: r.courseCode,
      groupNumber: r.groupNumber,
      professorStaffId: r.professorStaffId,
      professorName: (r.professorStaffId != null && profName.get(r.professorStaffId)) || '—',
      professorStaffCode: (r.professorStaffId != null && profCode.get(r.professorStaffId)) || null,
      facultyId: meta?.facultyId ?? null,
      facultyName: (meta?.facultyId != null && facultyName.get(meta.facultyId)) || null,
      recordedAt: a?.recordedAt ?? null,
      recordedMethod: a?.method ?? null,
      recordedStatus: a?.status ?? null,
      recordedBy: (a?.confirmedBy != null && confirmName.get(a.confirmedBy)) || null,
      sharedScheduleGroupKey: r.sharedScheduleGroupKey ?? null,
    });
  }

  return out.sort((x, y) => x.startTime.localeCompare(y.startTime) || x.roomName.localeCompare(y.roomName, 'fa'));
}

/**
 * همان جلساتِ امروز، ولی گروه‌بندی‌شده به «کلاس فیزیکی».
 *
 * چرا لازم شد: در یک اتاق و یک ساعت ممکن است چند عرضه (مثلاً «ریاضی» و
 * «ریاضی ۱») با یک استاد برگزار شوند که در عمل **یک** کلاس‌اند. اگر تک‌تک
 * نشان داده شوند، کنترل‌کننده باید چند بار «ثبت حضور» بزند و اگر یکی را
 * فراموش کند، حضورِ آن کلاس ناقص می‌ماند.
 *
 * UI فقط ردیفِ نماینده را نشان می‌دهد؛ ثبت روی نماینده، خودکار روی همهٔ
 * اعضا اعمال می‌شود (`recordCore` در `p/[code]/actions.ts`).
 */
export async function listMergedTodaySessionsForRooms(
  roomIds: number[],
  jalaliDate: string,
): Promise<MergedSessionGroup<ControlSessionRow>[]> {
  const rows = await listTodaySessionsForRooms(roomIds, jalaliDate);
  return groupSessionsIntoMerged(rows.map(r => ({
    sessionId: r.sessionId,
    offeringId: r.offeringId,
    roomId: r.roomId,
    startTime: r.startTime,
    endTime: r.endTime,
    professorId: r.professorStaffId,
    sharedScheduleGroupKey: r.sharedScheduleGroupKey,
    row: r,
  }))).map(g => ({ ...g, members: g.members.map(m => m.row) }));
}

/**
 * استادی که حضورِ او باید ثبت شود (صاحبِ کلاس).
 * اگر ارائه استادِ اصلی نداشته باشد، اولین استادِ مشترک را برمی‌گرداند.
 */
export async function resolveClassProfessorStaffId(offeringId: number): Promise<number | null> {
  const [o] = await db
    .select({ professorId: course_offerings.professorId })
    .from(course_offerings)
    .where(eq(course_offerings.id, offeringId))
    .limit(1)
    .catch(() => []);
  if (o?.professorId != null) return o.professorId;

  const [shared] = await db
    .select({ staffId: offering_professors.staffId })
    .from(offering_professors)
    .where(eq(offering_professors.offeringId, offeringId))
    .limit(1)
    .catch(() => []);
  return shared?.staffId ?? null;
}

/** آیا این کاربر پروندهٔ هیئت علمی دارد؟ (کنترل‌کننده لازم ندارد، ولی استاد باید) */
export async function hasStaffRecord(userId: number): Promise<boolean> {
  const [s] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.userId, userId))
    .limit(1)
    .catch(() => []);
  return !!s;
}
