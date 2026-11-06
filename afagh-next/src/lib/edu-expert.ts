/**
 * تخصیص کارشناس آموزش به کلاس.
 *
 * دو سطح تخصیص وجود دارد و اولویت با سطحِ ریزتر (کلاس) است:
 *
 *   ۱) سطحِ کلاس   → جدولِ `course_offering_edu_experts` (چند‌به‌چند، مهاجرت ۰۱۱۱)
 *                     ستونِ `course_offerings.eduExpertUserId` فقط «کارشناسِ اصلی»
 *                     (اولین نفر) را نگه می‌دارد تا مصرف‌کننده‌های تک‌مقداری نشکنند.
 *   ۲) سطحِ نقش    → `expert_scopes` (تخصیص دانشگاه/دانشکده/گروه/رشته)
 *
 * اگر برای کلاس تخصیص صریح نشده باشد، کارشناس از روی دامنهٔ نقشیِ
 * او پایین می‌آید: رشتهٔ درس → گروهِ سازنده → دانشکده → دانشگاه. این باعث
 * می‌شود صفحهٔ کارشناس آموزش همیشه مقداری داشته باشد، حتی پیش از اینکه
 * مدیر برای هر کلاس دستی تخصیص بدهد.
 *
 * «چند کارشناس برای یک کلاس» مجاز است: هر تعداد ردیف در جدولِ واسط. در آن
 * حالت `source` همچنان 'offering' است و `userIds` همهٔ آن‌ها را برمی‌گرداند.
 *
 * این ماژول عمداً بدون 'use server' است تا هم در Server Action و هم در
 * Server Component قابل استفاده باشد.
 */

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  classroom_edu_experts,
  classrooms,
  course_offering_edu_experts,
  course_offerings,
  courses,
  departments,
  expert_scopes,
  faculties,
  majors,
  roles,
  schedules,
  staff,
  universities,
  user_roles,
  users,
} from '@/db/schema';
import { getCurrentUniversity } from '@/lib/university-scope';

export interface EduExpertCandidate {
  userId: number;
  name: string;
  /** نقشِ کاندید — برای برچسبِ کنارِ نام در انتخاب‌گر */
  kind?: 'EDU_EXPERT' | 'ATTENDANCE_CONTROLLER';
}

/**
 * فهرست کاندیدهای «مسئولِ اتاق/کلاس» — برای dropdown در «تعریف کلاس» و
 * «تخصیص کارشناس به اتاق‌ها».
 *
 * دو نقش در این فهرست می‌آیند چون هر دو می‌توانند حضورِ کلاس را ثبت کنند:
 *   • EDU_EXPERT            → کارشناس آموزش
 *   • ATTENDANCE_CONTROLLER → کنترل‌کنندهٔ حضور و غیاب (مهاجرت ۰۱۱۳)
 * دامنهٔ هر دو یکی است (`classroom_edu_experts`)، پس یک انتخاب‌گر کافی است.
 */
export async function listEduExpertCandidates(): Promise<EduExpertCandidate[]> {
  const roleRows = await db
    .select({ id: roles.id, code: roles.code })
    .from(roles)
    .where(inArray(roles.code, ['EDU_EXPERT', 'ATTENDANCE_CONTROLLER']))
    .catch(() => []);
  if (!roleRows.length) return [];

  const roleCode = new Map(roleRows.map((r) => [r.id, r.code] as const));
  const assignments = await db
    .select({ userId: user_roles.userId, roleId: user_roles.roleId })
    .from(user_roles)
    .where(inArray(user_roles.roleId, roleRows.map((r) => r.id)))
    .catch(() => []);

  // یک کاربر ممکن است هر دو نقش را داشته باشد؛ نقشِ «آموزش» اولویت دارد.
  const kindOf = new Map<number, 'EDU_EXPERT' | 'ATTENDANCE_CONTROLLER'>();
  for (const a of assignments) {
    const code = roleCode.get(a.roleId);
    if (code === 'EDU_EXPERT') kindOf.set(a.userId, 'EDU_EXPERT');
    else if (code === 'ATTENDANCE_CONTROLLER' && !kindOf.has(a.userId)) {
      kindOf.set(a.userId, 'ATTENDANCE_CONTROLLER');
    }
  }

  const userIds = [...kindOf.keys()];
  if (!userIds.length) return [];

  const uni = await getCurrentUniversity().catch(() => null);

  const us = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      isActive: users.isActive,
      universityId: users.universityId,
    })
    .from(users)
    .where(inArray(users.id, userIds));

  return us
    .filter((u) => (u.isActive ?? 0) === 1)
    // اگر دانشگاه جاری مشخص است، همان دانشگاه را ترجیح بده ولی متخصصان
    // بدون دانشگاه (سراسری) را هم حذف نکن.
    .filter((u) => !uni || u.universityId == null || u.universityId === uni.id)
    .map((u) => {
      const kind = kindOf.get(u.id) ?? 'EDU_EXPERT';
      const base = `${u.firstName || ''} ${u.lastName || ''}`.trim();
      return {
        userId: u.id,
        name: kind === 'ATTENDANCE_CONTROLLER' ? `${base} — کنترل‌کنندهٔ حضور` : base,
        kind,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fa'));
}

/** نقش‌های (دامنه‌های) تخصیص‌یافته به یک کارشناس — برای نمایش در UI. */
export async function getExpertScopeLabels(userId: number): Promise<string[]> {
  const rows = await db
    .select()
    .from(expert_scopes)
    .where(eq(expert_scopes.userId, userId))
    .catch(() => []);
  if (!rows.length) return [];

  const labels: string[] = [];
  for (const r of rows) {
    if (r.scopeType === 'UNIVERSITY') {
      const u = await db.select({ title: universities.title }).from(universities).where(eq(universities.id, r.scopeId ?? 0)).limit(1).catch(() => []);
      if (u[0]) labels.push(`دانشگاه ${u[0].title}`);
    } else if (r.scopeType === 'FACULTY') {
      const f = await db.select({ name: faculties.name }).from(faculties).where(eq(faculties.id, r.scopeId ?? 0)).limit(1).catch(() => []);
      if (f[0]) labels.push(`دانشکده ${f[0].name}`);
    } else if (r.scopeType === 'DEPARTMENT') {
      const d = await db.select({ name: departments.name }).from(departments).where(eq(departments.id, r.scopeId ?? 0)).limit(1).catch(() => []);
      if (d[0]) labels.push(`گروه ${d[0].name}`);
    } else if (r.scopeType === 'MAJOR') {
      const m = await db.select({ name: majors.name }).from(majors).where(eq(majors.id, r.scopeId ?? 0)).limit(1).catch(() => []);
      if (m[0]) labels.push(`رشته ${m[0].name}`);
    }
  }
  return labels;
}

export interface OfferingExpertResolution {
  /** کارشناس مسئول (اصلی) — از تخصیص سطح کلاس یا (اگر نبود) از دامنهٔ نقش */
  userId: number | null;
  /** همهٔ کارشناسانِ تخصیص‌یافته به این کلاس (۱ یا بیشتر). اگر از نقش‌ها آمده باشد، تک‌عضوی. */
  userIds: number[];
  /** منبع تصمیم: 'offering' = استثنای درس · 'classroom' = کارشناسِ اتاقِ همان سانس ·
   *  'scope' = از نقش‌ها · null = هیچ‌کدام */
  source: 'offering' | 'classroom' | 'scope' | null;
}

/**
 * فهرستِ کاملِ کارشناسانِ یک کلاس از جدولِ واسط (بدون fallback نقش‌ها).
 * برای ویرایشگرِ تک‌کلاس لازم است تا بداند دقیقاً چه چیزی ذخیره شده.
 */
export async function getOfferingEduExpertIds(offeringId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: course_offering_edu_experts.userId })
    .from(course_offering_edu_experts)
    .where(eq(course_offering_edu_experts.offeringId, offeringId))
    .orderBy(asc(course_offering_edu_experts.id))
    .catch(() => []);
  return rows.map((r) => r.userId);
}

/**
 * جایگزینیِ کاملِ فهرستِ کارشناسانِ یک کلاس.
 *
 * همهٔ نوشتن‌ها از این‌جا رد می‌شوند تا ستونِ «کارشناسِ اصلی» هرگز از جدولِ
 * واسط جدا نیفتد. `userIds` خالی = آزاد کردن کلاس (بازگشت به نقش‌ها).
 * خروجی، فهرستِ نهاییِ ذخیره‌شده است (تکراری‌ها حذف می‌شوند).
 */
export async function setOfferingEduExperts(
  offeringId: number,
  userIds: number[],
): Promise<number[]> {
  const ids = [...new Set(userIds.filter((n) => Number.isInteger(n) && n > 0))];

  await db.delete(course_offering_edu_experts).where(eq(course_offering_edu_experts.offeringId, offeringId));
  if (ids.length) {
    await db
      .insert(course_offering_edu_experts)
      .values(ids.map((userId) => ({ offeringId, userId })))
      .onConflictDoNothing();
  }

  // ستونِ تک‌مقداری = اولین نفر؛ خالی اگر کسی نمانده باشد.
  await db
    .update(course_offerings)
    .set({ eduExpertUserId: ids[0] ?? null })
    .where(eq(course_offerings.id, offeringId));

  return ids;
}

/**
 * افزودنِ یک کارشناس به کلاس بدون دست‌زدن به بقیه.
 * برای تخصیصِ گروهی («این ۵ کلاس را هم به آقای X بده») لازم است، وگرنه
 * تخصیصِ دوم کارشناسِ اول را پاک می‌کرد.
 */
export async function addOfferingEduExperts(
  offeringIds: number[],
  userId: number,
): Promise<number> {
  const ids = [...new Set(offeringIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length || !Number.isInteger(userId) || userId <= 0) return 0;

  await db
    .insert(course_offering_edu_experts)
    .values(ids.map((offeringId) => ({ offeringId, userId })))
    .onConflictDoNothing();

  // برای ارائه‌هایی که هنوز «کارشناسِ اصلی» ندارند، همین نفر اصلی می‌شود.
  // (اگر از قبل اصلی دارند، دست نمی‌زنیم — افزودن نفر دوم نباید اولی را جابه‌جا کند.)
  await db
    .update(course_offerings)
    .set({ eduExpertUserId: userId })
    .where(and(inArray(course_offerings.id, ids), isNull(course_offerings.eduExpertUserId)));

  return ids.length;
}

/* ────────────────────────────────────────────────────────────────────────
 *  سطحِ اتاق (کلاس فیزیکی) — مهاجرت ۰۱۱۲
 *
 *  کارشناس آموزش مسئولِ یک اتاق است و ساعت‌به‌ساعت همان اتاق را می‌گردد.
 *  پس تخصیص در سطحِ اتاق انجام می‌شود و مسئولیتِ هر درس خودکار از روی
 *  `schedules.roomId` پایین می‌آید. تخصیصِ سطحِ درس «استثنا» می‌ماند.
 *  ──────────────────────────────────────────────────────────────────────── */

/** کارشناسانِ یک اتاق (بدون fallback). */
export async function getClassroomExpertIds(classroomId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: classroom_edu_experts.userId })
    .from(classroom_edu_experts)
    .where(eq(classroom_edu_experts.classroomId, classroomId))
    .orderBy(asc(classroom_edu_experts.id))
    .catch(() => []);
  return rows.map((r) => r.userId);
}

/** جایگزینیِ کاملِ فهرستِ کارشناسانِ یک اتاق. خروجی، فهرستِ نهاییِ ذخیره‌شده است. */
export async function setClassroomEduExperts(
  classroomId: number,
  userIds: number[],
): Promise<number[]> {
  const ids = [...new Set(userIds.filter((n) => Number.isInteger(n) && n > 0))];
  await db.delete(classroom_edu_experts).where(eq(classroom_edu_experts.classroomId, classroomId));
  if (ids.length) {
    await db
      .insert(classroom_edu_experts)
      .values(ids.map((userId) => ({ classroomId, userId })))
      .onConflictDoNothing();
  }
  return ids;
}

/** افزودنِ یک کارشناس به یک یا چند اتاق، بدون دست‌زدن به بقیه. */
export async function addClassroomEduExperts(
  classroomIds: number[],
  userId: number,
): Promise<number> {
  const ids = [...new Set(classroomIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length || !Number.isInteger(userId) || userId <= 0) return 0;
  await db
    .insert(classroom_edu_experts)
    .values(ids.map((classroomId) => ({ classroomId, userId })))
    .onConflictDoNothing();
  return ids.length;
}

export interface ClassroomSessionRow {
  scheduleId: number;
  offeringId: number;
  dayOfWeek: number | null;
  start: string | null;
  end: string | null;
  courseTitle: string;
  groupNumber: number;
  professorName: string;
}

export interface ClassroomAssignRow {
  roomId: number;
  roomName: string;
  /** هم‌نویسیِ نام دانشکده در ستون قدیمیِ `buildingName` — فقط برای سازگاری */
  buildingName: string | null;
  /** نام دانشکدهٔ مالکِ اتاق (منبع حقیقت: `classrooms.facultyId`) */
  facultyName: string | null;
  floor: string | null;
  /** تعدادِ سانسِ هفتگیِ برگزارشده در این اتاق در این ترم */
  sessionCount: number;
  /** تعدادِ ارائه‌های متمایزی که در این اتاق سانس دارند */
  offeringCount: number;
  /** گروه‌های سازندهٔ درس‌های همین اتاق — برای اینکه معلوم باشد چه کسانی اینجا کلاس دارند */
  departments: string[];
  expertIds: number[];
  sessions: ClassroomSessionRow[];
}

/**
 * همهٔ اتاق‌هایی که در یک ترم سانس دارند + کارشناسانشان + جدولِ ساعتی.
 *
 * چرا همه‌چیز در یک تابع: صفحهٔ تخصیص با یک رفت‌وبرگشت پر می‌شود و جدولِ
 * ساعتیِ هر اتاق بدون درخواستِ دوم باز می‌شود (۱۴۶۱ سانس در ۴۹ اتاق — سبک).
 * اتاق‌هایی که هیچ سانسِ «کلاس» ندارند برنمی‌گردند؛ سانسِ امتحان هم کنار
 * گذاشته می‌شود چون سالنِ امتحان با اتاقِ درس یکی نیست.
 *
 * `universityId` = دانشگاهِ انتخاب‌شده در سوییچرِ بالای پنل. بدون آن، اتاق‌های
 * همهٔ دانشگاه‌ها در یک صفحه قاطی می‌شدند.
 */
export async function listClassroomExpertAssignments(
  termId: number,
  universityId?: number | null,
): Promise<ClassroomAssignRow[]> {
  const raw = await db
    .select({
      scheduleId: schedules.id,
      scheduleType: schedules.scheduleType,
      roomId: schedules.roomId,
      dayOfWeek: schedules.dayOfWeek,
      start: schedules.startTime,
      end: schedules.endTime,
      offeringId: course_offerings.id,
      courseTitle: courses.title,
      groupNumber: course_offerings.groupNumber,
      professorId: course_offerings.professorId,
      ownerDepartmentId: course_offerings.ownerDepartmentId,
    })
    .from(schedules)
    .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(
      eq(course_offerings.termId, termId),
      eq(course_offerings.isActive, 1),
      // مرزِ دانشگاه: سوییچرِ بالای صفحه باید فهرستِ اتاق‌ها را هم عوض کند.
      // ارائهٔ بی‌دانشگاه (دادهٔ مهاجرتی) حذف نمی‌شود.
      universityId != null ? eq(course_offerings.universityId, universityId) : undefined,
    ))
    .orderBy(asc(schedules.dayOfWeek), asc(schedules.startTime))
    .catch(() => []);

  const rows = raw.filter(
    (r) =>
      String(r.scheduleType ?? '').toUpperCase() !== 'EXAM' &&
      typeof r.roomId === 'number' &&
      r.roomId != null,
  );
  if (!rows.length) return [];

  const roomIds = [...new Set(rows.map((r) => r.roomId as number))];
  const deptIds = [...new Set(rows.map((r) => r.ownerDepartmentId).filter((v): v is number => typeof v === 'number'))];
  const profIds = [...new Set(rows.map((r) => r.professorId).filter((v): v is number => typeof v === 'number'))];

  /* ── فرادادهٔ اتاق‌ها (نام/ساختمان/طبقه/گروه مسئول) ──
     ⚠ درسِ تلخ: این کوئری قبلاً `.catch(() => [])` داشت. وقتی مهاجرت ۰۱۱۴
     (`classrooms.departmentId`) هنوز روی دیتابیس اجرا نشده بود، کوئری خطا
     می‌داد، آرایه خالی برمی‌گشت و `roomById.get(id)` برای همه undefined
     می‌شد — نتیجه: نامِ هر اتاق به `اتاق ۱۱`/`اتاق ۱۱۴` تبدیل می‌شد و
     ساختمان/طبقه/گروه مسئول همه خالی. صفحه دروغ می‌گفت ولی کسی نمی‌فهمید.
     پس حالا: اول با ستونِ تازه تلاش می‌کنیم، اگر خطای ساختار داد (مهاجرت
     اجرا نشده) بدونِ آن ستون دوباره تلاش می‌کنیم — صفحه هرگز جعلِ نام نمی‌کند. */
  type RoomMeta = {
    id: number; name: string; buildingName: string | null; floor: string | null;
    facultyId: number | null; departmentId: number | null;
  };
  const roomMetaOf = async (withDept: boolean): Promise<RoomMeta[]> => {
    const base = db
      .select({
        id: classrooms.id,
        name: classrooms.name,
        buildingName: classrooms.buildingName,
        floor: classrooms.floor,
        facultyId: classrooms.facultyId,
        ...(withDept ? { departmentId: classrooms.departmentId } : {}),
      })
      .from(classrooms)
      .where(inArray(classrooms.id, roomIds));
    const rs = withDept
      ? await base.catch(() => null)
      : await base.catch(() => []);
    if (withDept && rs === null) return roomMetaOf(false);
    return (rs as RoomMeta[]).map((r) => ({ ...r, departmentId: (r as RoomMeta).departmentId ?? null }));
  };
  const rooms = await roomMetaOf(true);
  // اگر باز هم خالی بود یعنی مشکل واقعی است — به جای جعلِ نام، خطا بده.
  if (!rooms.length) throw new Error('read_classroom_meta_failed');

  const [depts, profs, assignments] = await Promise.all([
    deptIds.length
      ? db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, deptIds)).catch(() => [])
      : Promise.resolve([] as { id: number; name: string }[]),
    profIds.length
      ? db.select({ id: staff.id, firstName: users.firstName, lastName: users.lastName })
          .from(staff).innerJoin(users, eq(users.id, staff.userId)).where(inArray(staff.id, profIds)).catch(() => [])
      : Promise.resolve([] as { id: number; firstName: string | null; lastName: string | null }[]),
    db.select({ classroomId: classroom_edu_experts.classroomId, userId: classroom_edu_experts.userId })
      .from(classroom_edu_experts).where(inArray(classroom_edu_experts.classroomId, roomIds))
      .orderBy(asc(classroom_edu_experts.id)).catch(() => []),
  ]);

  /* دانشکدهٔ مالکِ اتاق.
     «ساختمان» در سامانه موجودیت ندارد؛ از وقتی فرم کلاس‌ها به `facultyId`
     منتقل شد، `buildingName` فقط هم‌نویسیِ نام دانشکده است (برای مصرف‌کننده‌های
     قدیمی). اینجا نام را از منبع حقیقت می‌خوانیم و اگر نبود به همان هم‌نویسی
     برمی‌گردیم تا کارتِ اتاق هرگز خالی نماند. */
  const facultyIds = [...new Set(
    rooms.map((r) => r.facultyId).filter((v): v is number => typeof v === 'number'),
  )];
  const facultyRows = facultyIds.length
    ? await db.select({ id: faculties.id, name: faculties.name }).from(faculties)
        .where(inArray(faculties.id, facultyIds)).catch(() => [])
    : ([] as { id: number; name: string }[]);
  const facultyNameById = new Map(facultyRows.map((f) => [f.id, f.name]));

  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const deptName = new Map(depts.map((d) => [d.id, d.name]));
  const profName = new Map(profs.map((p) => [p.id, `${p.firstName || ''} ${p.lastName || ''}`.trim()]));

  const expertsByRoom = new Map<number, number[]>();
  for (const a of assignments) {
    const list = expertsByRoom.get(a.classroomId) ?? [];
    if (!list.includes(a.userId)) list.push(a.userId);
    expertsByRoom.set(a.classroomId, list);
  }

  const byRoom = new Map<number, ClassroomAssignRow>();
  for (const r of rows) {
    const roomId = r.roomId as number;
    let row = byRoom.get(roomId);
    if (!row) {
      const room = roomById.get(roomId);
      row = {
        roomId,
        roomName: room?.name ?? `اتاق ${roomId}`,
        buildingName: room?.buildingName ?? null,
        facultyName: room?.facultyId != null
          ? (facultyNameById.get(room.facultyId) ?? room.buildingName ?? null)
          : (room?.buildingName ?? null),
        floor: room?.floor ?? null,
        sessionCount: 0,
        offeringCount: 0,
        departments: [],
        expertIds: expertsByRoom.get(roomId) ?? [],
        sessions: [],
      };
      byRoom.set(roomId, row);
    }
    row.sessionCount += 1;
    row.sessions.push({
      scheduleId: r.scheduleId,
      offeringId: r.offeringId,
      dayOfWeek: r.dayOfWeek,
      start: r.start ? String(r.start).slice(0, 5) : null,
      end: r.end ? String(r.end).slice(0, 5) : null,
      courseTitle: r.courseTitle,
      groupNumber: r.groupNumber,
      professorName: (r.professorId != null && profName.get(r.professorId)) || '—',
    });
    const dn = r.ownerDepartmentId != null ? deptName.get(r.ownerDepartmentId) : null;
    if (dn && !row.departments.includes(dn)) row.departments.push(dn);
  }

  const out = [...byRoom.values()];
  for (const row of out) {
    row.offeringCount = new Set(row.sessions.map((s) => s.offeringId)).size;
  }
  // اول اتاق‌های پرکار، بعد بی‌کار — تا مدیر از بالا شروع کند
  out.sort((a, b) => b.sessionCount - a.sessionCount || a.roomName.localeCompare(b.roomName, 'fa'));
  return out;
}

/**
 * کارشناس مسئولِ یک کلاس را برمی‌گرداند.
 *
 * `offering` باید دست‌کم `id`، `ownerDepartmentId` و `universityId` را داشته باشد.
 * زنجیرهٔ تصمیم از دقیق به کلی:
 *   ۱) استثنای درس (`course_offering_edu_experts`)
 *   ۲) کارشناسِ اتاقِ سانس‌های همان درس (`classroom_edu_experts`)
 *   ۳) دامنهٔ نقش‌ها (`expert_scopes`): رشته → گروه → دانشگاه
 * اگر کلاس چند کارشناس داشته باشد، همه در `userIds` برمی‌گردند و `userId`
 * اولین نفر (کارشناسِ اصلی) است.
 */
export async function resolveEduExpertForOffering(offering: {
  id: number;
  ownerDepartmentId?: number | null;
  universityId?: number | null;
  targetMajorId?: number | null;
  eduExpertUserId?: number | null;
}): Promise<OfferingExpertResolution> {
  // ۱) استثنای درس (چند‌به‌چند) — برندهٔ قطعی
  const assigned = await getOfferingEduExpertIds(offering.id);
  if (assigned.length) {
    return { userId: assigned[0], userIds: assigned, source: 'offering' };
  }
  // سازگاری با فراخوانی‌هایی که خودشان رکورد را خوانده‌اند و ستون را پاس می‌دهند
  if (offering.eduExpertUserId) {
    return { userId: offering.eduExpertUserId, userIds: [offering.eduExpertUserId], source: 'offering' };
  }

  // ۲) کارشناسِ اتاقِ سانس‌های همین درس
  const roomIds = await getOfferingClassroomIds(offering.id);
  if (roomIds.length) {
    const roomExperts = await db
      .select({ userId: classroom_edu_experts.userId })
      .from(classroom_edu_experts)
      .where(inArray(classroom_edu_experts.classroomId, roomIds))
      .orderBy(asc(classroom_edu_experts.id))
      .catch(() => []);
    const uniq = [...new Set(roomExperts.map((r) => r.userId))];
    if (uniq.length) return { userId: uniq[0], userIds: uniq, source: 'classroom' };
  }

  // ۳) دامنهٔ نقش‌ها
  const scopes = await db.select().from(expert_scopes).catch(() => []);
  if (!scopes.length) return { userId: null, userIds: [], source: null };

  // دقتِ هر سطح: MAJOR (۴) > DEPARTMENT (۳) > FACULTY (۲) > UNIVERSITY (۱)
  const byPrecision = (type: string, id: number | null | undefined) => {
    const match = scopes.find((s) => s.scopeType === type && (s.scopeId ?? null) === (id ?? null));
    return match ? match.userId : null;
  };

  const candidates: { precision: number; userId: number }[] = [];

  // ۱) رشتهٔ هدفِ کلاس (اگر کلاس به رشتهٔ خاصی هدف گرفته شده)
  if (offering.targetMajorId) {
    const hit = byPrecision('MAJOR', offering.targetMajorId);
    if (hit) candidates.push({ precision: 4, userId: hit });
  }

  // ۲) گروه سازندهٔ کلاس
  if (offering.ownerDepartmentId) {
    const hit = byPrecision('DEPARTMENT', offering.ownerDepartmentId);
    if (hit) candidates.push({ precision: 3, userId: hit });
  }

  // ۳) دانشگاه
  if (offering.universityId) {
    const hit = byPrecision('UNIVERSITY', offering.universityId);
    if (hit) candidates.push({ precision: 1, userId: hit });
  }

  if (!candidates.length) return { userId: null, userIds: [], source: null };
  candidates.sort((a, b) => b.precision - a.precision);
  return { userId: candidates[0].userId, userIds: [candidates[0].userId], source: 'scope' };
}

/** اتاق‌های سانس‌های «کلاس» یک ارائه (بدون سانسِ امتحان). */
async function getOfferingClassroomIds(offeringId: number): Promise<number[]> {
  const rs = await db
    .select({ roomId: schedules.roomId, scheduleType: schedules.scheduleType })
    .from(schedules)
    .where(eq(schedules.offeringId, offeringId))
    .catch(() => []);
  return [
    ...new Set(
      rs
        .filter((r) => String(r.scheduleType ?? '').toUpperCase() !== 'EXAM')
        .map((r) => r.roomId)
        .filter((v): v is number => typeof v === 'number'),
    ),
  ];
}

/**
 * همهٔ کلاس‌های یک ترم را با کارشناس مسئولشان برمی‌گرداند — برای صفحهٔ
 * «تخصیص کارشناس به کلاس‌ها» (جدول انبوه، بدون رفتن به تک‌تک کلاس‌ها).
 */
export async function listOfferingExpertAssignments(
  termId: number,
  universityId?: number | null,
): Promise<
  {
    offeringId: number;
    courseTitle: string;
    groupNumber: number;
    departmentName: string | null;
    /** نامِ اتاق‌های همان درس از برنامهٔ هفتگی — مثل «كلاس 5 انساني» */
    rooms: string[];
    /** آیا برای این درس اصلاً سانس/اتاق تعریف شده؟ (برای فیلترِ جدول) */
    hasSchedule: boolean;
    /** کارشناسِ اصلی (اولین نفر) — برای سازگاری با UIهای تک‌مقداری */
    assignedUserId: number | null;
    /** همهٔ کارشناسانِ تخصیص‌یافته به این کلاس (۰ یا بیشتر) */
    assignedUserIds: number[];
    resolvedUserId: number | null;
    source: 'offering' | 'classroom' | 'scope' | null;
    isActive: number;
  }[]
> {
  const rows = await db
    .select({
      offeringId: course_offerings.id,
      courseTitle: courses.title,
      groupNumber: course_offerings.groupNumber,
      ownerDepartmentId: course_offerings.ownerDepartmentId,
      universityId: course_offerings.universityId,
      eduExpertUserId: course_offerings.eduExpertUserId,
      isActive: course_offerings.isActive,
    })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(
      eq(course_offerings.termId, termId),
      eq(course_offerings.isActive, 1),
      universityId != null ? eq(course_offerings.universityId, universityId) : undefined,
    ))
    .orderBy(asc(courses.title))
    .catch(() => []);

  const deptIds = [...new Set(rows.map((r) => r.ownerDepartmentId).filter((v): v is number => typeof v === 'number'))];
  const depts = deptIds.length
    ? await db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, deptIds))
    : [];
  const deptName = (id: number | null) => (id == null ? null : depts.find((d) => d.id === id)?.name ?? null);

  /* اتاق‌های هر درس — از `schedules`.
     چرا لازم است: این صفحه «تخصیص کارشناس به کلاس» است، ولی تا امروز هر سطر
     فقط «درس + گروه» را نشان می‌داد و مدیر نمی‌دانست این درس در کدام اتاق
     برگزار می‌شود (در دادهٔ واقعی، ۱۷۸ درس از ۲۱۶ درسِ یک ترم هنوز هیچ سانس/
     اتاقی ندارند). یک درس می‌تواند چند سانس در چند اتاق داشته باشد، پس فهرستِ
     یکتا از نام‌ها برمی‌گردانیم. */
  const offeringIds = rows.map((r) => r.offeringId);
  const schedRows = offeringIds.length
    ? await db
        .select({ offeringId: schedules.offeringId, roomId: schedules.roomId, scheduleType: schedules.scheduleType })
        .from(schedules)
        .where(inArray(schedules.offeringId, offeringIds))
        // سانسِ «امتحان» اتاقش سالنِ امتحان است، نه کلاسِ درس — بیرونش می‌گذاریم
        .then((rs) => rs.filter((s) => String(s.scheduleType ?? '').toUpperCase() !== 'EXAM'))
        .catch(() => [])
    : [];
  const roomIds = [...new Set(schedRows.map((s) => s.roomId).filter((v): v is number => typeof v === 'number'))];
  const roomRows = roomIds.length
    ? await db
        .select({ id: classrooms.id, name: classrooms.name })
        .from(classrooms)
        .where(inArray(classrooms.id, roomIds))
        .catch(() => [])
    : [];
  const roomNameOf = (id: number | null) => (id == null ? null : roomRows.find((r) => r.id === id)?.name ?? null);
  const roomsByOffering = new Map<number, string[]>();
  const scheduledOfferings = new Set<number>();
  const roomIdsByOffering = new Map<number, number[]>();
  for (const s of schedRows) {
    scheduledOfferings.add(s.offeringId);
    if (typeof s.roomId === 'number') {
      const rl = roomIdsByOffering.get(s.offeringId) ?? [];
      if (!rl.includes(s.roomId)) rl.push(s.roomId);
      roomIdsByOffering.set(s.offeringId, rl);
    }
    const name = roomNameOf(s.roomId);
    if (!name) continue;
    const list = roomsByOffering.get(s.offeringId) ?? [];
    if (!list.includes(name)) list.push(name);
    roomsByOffering.set(s.offeringId, list);
  }

  /* کارشناسانِ سطحِ اتاق (۰۱۱۲) — یک کوئری برای همهٔ اتاق‌های این ترم.
     این لایه بین «استثنای درس» و «نقش‌ها» می‌نشیند. */
  const roomExpertRows = roomIds.length
    ? await db
        .select({ classroomId: classroom_edu_experts.classroomId, userId: classroom_edu_experts.userId })
        .from(classroom_edu_experts)
        .where(inArray(classroom_edu_experts.classroomId, roomIds))
        .orderBy(asc(classroom_edu_experts.id))
        .catch(() => [])
    : [];
  const expertsByRoom = new Map<number, number[]>();
  for (const e of roomExpertRows) {
    const list = expertsByRoom.get(e.classroomId) ?? [];
    if (!list.includes(e.userId)) list.push(e.userId);
    expertsByRoom.set(e.classroomId, list);
  }

  // برای عملکرد: نقش‌ها را یک بار می‌خوانیم و در حافظه جستجو می‌کنیم
  const scopes = await db.select().from(expert_scopes).catch(() => []);
  const scopeHit = (type: string, id: number | null | undefined) => {
    const m = scopes.find((s) => s.scopeType === type && (s.scopeId ?? null) === (id ?? null));
    return m ? m.userId : null;
  };

  /* کارشناسانِ سطحِ کلاس — یک کوئری برای همهٔ ارائه‌های ترم (چند‌به‌چند، ۰۱۱۱).
     ستونِ قدیمی `eduExpertUserId` هم به‌عنوان تورِ ایمنی خوانده می‌شود تا اگر
     جایی خارج از این ماژول نوشته شده باشد، در جدول دیده شود. */
  const expertRows = offeringIds.length
    ? await db
        .select({ offeringId: course_offering_edu_experts.offeringId, userId: course_offering_edu_experts.userId })
        .from(course_offering_edu_experts)
        .where(inArray(course_offering_edu_experts.offeringId, offeringIds))
        .orderBy(asc(course_offering_edu_experts.id))
        .catch(() => [])
    : [];
  const expertsByOffering = new Map<number, number[]>();
  for (const e of expertRows) {
    const list = expertsByOffering.get(e.offeringId) ?? [];
    if (!list.includes(e.userId)) list.push(e.userId);
    expertsByOffering.set(e.offeringId, list);
  }

  return rows.map((r) => {
    const explicit = expertsByOffering.get(r.offeringId) ?? (r.eduExpertUserId ? [r.eduExpertUserId] : []);
    if (explicit.length) {
      return {
        offeringId: r.offeringId,
        courseTitle: r.courseTitle,
        groupNumber: r.groupNumber,
        departmentName: deptName(r.ownerDepartmentId),
        rooms: roomsByOffering.get(r.offeringId) ?? [],
        hasSchedule: scheduledOfferings.has(r.offeringId),
        assignedUserId: explicit[0],
        assignedUserIds: explicit,
        resolvedUserId: explicit[0],
        source: 'offering' as const,
        isActive: r.isActive ?? 0,
      };
    }

    // ۲) کارشناسِ اتاق‌های همین درس
    const fromRooms = [
      ...new Set(
        (roomIdsByOffering.get(r.offeringId) ?? []).flatMap((roomId) => expertsByRoom.get(roomId) ?? []),
      ),
    ];
    if (fromRooms.length) {
      return {
        offeringId: r.offeringId,
        courseTitle: r.courseTitle,
        groupNumber: r.groupNumber,
        departmentName: deptName(r.ownerDepartmentId),
        rooms: roomsByOffering.get(r.offeringId) ?? [],
        hasSchedule: scheduledOfferings.has(r.offeringId),
        assignedUserId: fromRooms[0],
        assignedUserIds: fromRooms,
        resolvedUserId: fromRooms[0],
        source: 'classroom' as const,
        isActive: r.isActive ?? 0,
      };
    }

    // ۳) از نقش‌ها: گروه سازنده → دانشگاه (سطح MAJOR در اینجا قیمت ندارد چون
    // هدفِ رشته به سطح کلاس مربوط است و در جدول انبوه دقتِ کمتری می‌خواهیم)
    const fromScope = scopeHit('DEPARTMENT', r.ownerDepartmentId) ?? scopeHit('UNIVERSITY', r.universityId) ?? null;
    return {
      offeringId: r.offeringId,
      courseTitle: r.courseTitle,
      groupNumber: r.groupNumber,
      departmentName: deptName(r.ownerDepartmentId),
      rooms: roomsByOffering.get(r.offeringId) ?? [],
      hasSchedule: scheduledOfferings.has(r.offeringId),
      assignedUserId: null,
      assignedUserIds: [],
      resolvedUserId: fromScope,
      source: fromScope ? ('scope' as const) : null,
      isActive: r.isActive ?? 0,
    };
  });
}
