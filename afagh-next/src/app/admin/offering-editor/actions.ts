'use server';

import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, withUserRls } from '@/db';
import {
  academic_terms, classroom_edu_experts, classrooms, course_offering_edu_experts, course_offerings, courses, departments, schedules, staff, users,
} from '@/db/schema';
import { getCurrentUniversity } from '@/lib/university-scope';
import { requireRoleOrPermission } from '@/lib/permissions-enforcer';
import { currentExpertFilters } from '@/lib/expert-scope';
import { examDateColumnValue } from '@/lib/shamsi';

const EDU = ['ADMIN', 'EDU_EXPERT'];
const EDU_PERM = ['scheduling:manage_chart'];

export interface OfferingEditRow {
  offeringId: number;
  code: string; title: string; groupNumber: number; units: number | null;
  professorName: string; capacity: number; enrolledCount: number;
  departmentId: number | null;
  /** کارشناس آموزشِ اصلیِ این کلاس (اولین نفر — NULL = از نقش‌ها پایین می‌آید) */
  eduExpertUserId: number | null;
  /** همهٔ کارشناسانِ این کلاس — یک کلاس می‌تواند چند کارشناس داشته باشد */
  eduExpertUserIds: number[];
  /**
   * کارشناسانی که از «اتاقِ سانس‌های همین درس» به ارث می‌رسند
   * (`classroom_edu_experts`). تخصیصِ صریحِ درس لازم نیست؛ اگر این فهرست
   * خالی نباشد، UI نباید بگوید «تخصیص ندادی».
   */
  roomExpertUserIds: number[];
  classRows: { id: number; day: number | null; start: string | null; end: string | null; roomId: number | null }[];
  exam: { id: number | null; date: string | null; start: string | null; end: string | null } | null;
}

/** فهرست ارائه‌های ترم برای ویرایش — کارشناس فقط دامنهٔ خودش */
export async function listOfferingsForEditor(termId: number): Promise<OfferingEditRow[]> {
  await requireRoleOrPermission(EDU, EDU_PERM);
  const u = await getCurrentUniversity().catch(() => null);
  const eff = await currentExpertFilters().catch(() => null);

  const offs = await db
    .select({
      offeringId: course_offerings.id, code: courses.code, title: courses.title,
      groupNumber: course_offerings.groupNumber, units: courses.units,
      professorId: course_offerings.professorId, capacity: course_offerings.capacity,
      enrolledCount: course_offerings.enrolledCount, departmentId: courses.departmentId,
      eduExpertUserId: course_offerings.eduExpertUserId,
    })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(
      eq(course_offerings.termId, termId), eq(course_offerings.isActive, 1),
      u ? eq(course_offerings.universityId, u.id) : undefined,
      ...await scopeOffConds(eff),
    ))
    .orderBy(asc(courses.title), asc(course_offerings.groupNumber)).limit(4000);
  const offIds = offs.map(o => o.offeringId);
  const schedRows = offIds.length
    ? await db.select({
        id: schedules.id, offeringId: schedules.offeringId, scheduleType: schedules.scheduleType,
        dayOfWeek: schedules.dayOfWeek, startTime: schedules.startTime, endTime: schedules.endTime,
        examDate: schedules.examDate, roomId: schedules.roomId,
      }).from(schedules).where(inArray(schedules.offeringId, offIds))
    : [];
  const profIds = [...new Set(offs.map(o => o.professorId).filter((n): n is number => typeof n === 'number'))];
  const profName = new Map<number, string>();
  if (profIds.length) {
    const ps = await db.select({ id: staff.id, firstName: users.firstName, lastName: users.lastName })
      .from(staff).innerJoin(users, eq(users.id, staff.userId)).where(inArray(staff.id, profIds));
    for (const p of ps) profName.set(p.id, `${p.firstName || ''} ${p.lastName || ''}`.trim());
  }
  /* کارشناسانِ سطح کلاس — چند‌به‌چند (جدولِ واسط، مهاجرت ۰۱۱۱) */
  const expertRows = offIds.length
    ? await db.select({ offeringId: course_offering_edu_experts.offeringId, userId: course_offering_edu_experts.userId })
        .from(course_offering_edu_experts)
        .where(inArray(course_offering_edu_experts.offeringId, offIds))
        .orderBy(asc(course_offering_edu_experts.id))
        .catch(() => [])
    : [];
  const expertsByOff = new Map<number, number[]>();
  for (const e of expertRows) {
    const list = expertsByOff.get(e.offeringId) ?? [];
    if (!list.includes(e.userId)) list.push(e.userId);
    expertsByOff.set(e.offeringId, list);
  }

  /* کارشناسانِ سطحِ اتاق — همان چیزی که در «تخصیص کارشناس به اتاق‌ها» ثبت
     می‌شود. بدون این، «تعریف برنامهٔ درس» می‌گفت «تخصیص ندادی» درحالی‌که
     مدیر کارشناس را به اتاقِ همان سانس سپرده بود (زنجیرهٔ حل: درس → اتاق → نقش). */
  const schedRoomIds = [...new Set(
    schedRows
      .filter(r => r.scheduleType !== 'EXAM' && r.roomId != null)
      .map(r => r.roomId as number),
  )];
  const roomExpertRows = schedRoomIds.length
    ? await db.select({ roomId: classroom_edu_experts.classroomId, userId: classroom_edu_experts.userId })
        .from(classroom_edu_experts)
        .where(inArray(classroom_edu_experts.classroomId, schedRoomIds))
        .orderBy(asc(classroom_edu_experts.id))
        .catch(() => [])
    : [];
  const expertsByRoom = new Map<number, number[]>();
  for (const e of roomExpertRows) {
    const list = expertsByRoom.get(e.roomId) ?? [];
    if (!list.includes(e.userId)) list.push(e.userId);
    expertsByRoom.set(e.roomId, list);
  }
  return offs.map(o => {
    const rows = schedRows.filter(s => s.offeringId === o.offeringId);
    const classRows = rows.filter(r => r.scheduleType === 'CLASS').map(r => ({
      id: r.id, day: r.dayOfWeek, start: r.startTime ? String(r.startTime).slice(0, 5) : null,
      end: r.endTime ? String(r.endTime).slice(0, 5) : null, roomId: r.roomId,
    }));
    const ex = rows.find(r => r.scheduleType === 'EXAM');
    const expertIds = expertsByOff.get(o.offeringId) ?? (o.eduExpertUserId ? [o.eduExpertUserId] : []);
    return {
      offeringId: o.offeringId, code: o.code, title: o.title, groupNumber: o.groupNumber,
      units: o.units == null ? null : Number(o.units),
      professorName: (o.professorId != null && profName.get(o.professorId)) || '—',
      capacity: o.capacity, enrolledCount: o.enrolledCount ?? 0, departmentId: o.departmentId ?? null,
      eduExpertUserId: expertIds[0] ?? null,
      eduExpertUserIds: expertIds,
      roomExpertUserIds: [
        ...new Set(
          classRows
            .map(c => c.roomId)
            .filter((v): v is number => typeof v === 'number')
            .flatMap(id => expertsByRoom.get(id) ?? []),
        ),
      ],
      classRows,
      exam: ex ? { id: ex.id, date: ex.examDate ?? null, start: ex.startTime ? String(ex.startTime).slice(0, 5) : null, end: ex.endTime ? String(ex.endTime).slice(0, 5) : null } : null,
    };
  });
}

export async function getRoomsForEditor(): Promise<{ id: number; name: string }[]> {
  await requireRoleOrPermission(EDU, EDU_PERM);
  const u = await getCurrentUniversity().catch(() => null);
  return (await db.select({ id: classrooms.id, name: classrooms.name }).from(classrooms)
    .where(u ? sql`${classrooms.universityId} = ${u.id} OR ${classrooms.universityId} IS NULL` : undefined)
    .orderBy(asc(classrooms.name))).map(r => ({ id: r.id, name: r.name }));
}

export interface OfferingEditInput {
  offeringId: number;
  capacity: number;
  classRows: { id: number; day: number; start: string; end: string; roomId: number | null }[];
  exam?: { id?: number | null; date: string; start: string; end: string } | null;
  overrideReason?: string;
}

function toMin(s: string): number { const [h, m] = String(s || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); }

/** ذخیرهٔ تغییرات (ظرفیت + زمان کلاس/امتحان) با گارد تداخل؛ تداخل → نیازمند دلیل */
export async function saveOfferingEditorAction(input: OfferingEditInput): Promise<{ ok: boolean; error?: string }> {
  const me = await requireRoleOrPermission(EDU, EDU_PERM);
  const [off] = await db.select().from(course_offerings).where(eq(course_offerings.id, input.offeringId)).limit(1);
  if (!off) return { ok: false, error: 'ارائه یافت نشد.' };
  const u = await getCurrentUniversity().catch(() => null);
  if (u && off.universityId && off.universityId !== u.id) return { ok: false, error: 'این ارائه متعلق به دانشگاه دیگری است.' };
  if (u && off.universityId == null) return { ok: false, error: 'دانشگاه ارائه نامشخص است.' };
  // IDOR: هر شناسهٔ برنامه/امتحانِ ارسالی باید متعلق به همین ارائه باشد
  const suppliedIds = [...(input.classRows || []).map(c => Number(c.id)).filter(Number.isInteger),
    ...(input.exam?.id ? [Number(input.exam.id)] : [])].filter(Number.isInteger);
  if (suppliedIds.length) {
    const owned = await db.select({ id: schedules.id }).from(schedules)
      .where(and(inArray(schedules.id, suppliedIds), eq(schedules.offeringId, input.offeringId)));
    if (owned.length !== [...new Set(suppliedIds)].length) return { ok: false, error: 'شناسهٔ برنامه نامعتبر است.' };
  }
  // سالن‌ها باید متعلق به همین دانشگاه باشند
  const roomIds = [...new Set((input.classRows || []).map(c => c.roomId).filter((n): n is number => typeof n === 'number' && Number.isInteger(n)))];
  if (roomIds.length && u) {
    const roomRows = await db.select({ id: classrooms.id, universityId: classrooms.universityId }).from(classrooms).where(inArray(classrooms.id, roomIds));
    if (roomRows.length !== roomIds.length) return { ok: false, error: 'سالن نامعتبر است.' };
    if (roomRows.some(r => r.universityId && r.universityId !== u.id)) return { ok: false, error: 'این سالن متعلق به دانشگاه دیگری است.' };
  }

  const eff = await currentExpertFilters().catch(() => null);
  const [course] = await db.select({ departmentId: courses.departmentId }).from(courses).where(eq(courses.id, off.courseId)).limit(1);
  if (me.roles.includes('EDU_EXPERT') && eff) {
    if (eff.departmentIds) {
      if (!course?.departmentId || !eff.departmentIds.includes(course.departmentId)) return { ok: false, error: 'این درس در دامنهٔ شما نیست.' };
    } else if (eff.facultyIds) {
      if (course?.departmentId) {
        const [d] = await db.select({ facultyId: departments.facultyId }).from(departments).where(eq(departments.id, course.departmentId)).limit(1);
        if (!d || !eff.facultyIds.includes(d.facultyId)) return { ok: false, error: 'این درس در دامنهٔ شما نیست.' };
      } else return { ok: false, error: 'این درس در دامنهٔ شما نیست.' };
    }
  }

  // گارد تداخل: جلسات/امتحاناتِ دیگرِ همین ترم را بارگیری و با تغییرات مقایسه کن
  const others = await db
    .select({
      offeringId: schedules.offeringId, dayOfWeek: schedules.dayOfWeek,
      startTime: schedules.startTime, endTime: schedules.endTime,
      examDate: schedules.examDate, scheduleType: schedules.scheduleType, roomId: schedules.roomId, professorId: course_offerings.professorId,
    })
    .from(schedules)
    .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
    .where(and(eq(course_offerings.termId, off.termId), ne(schedules.offeringId, input.offeringId)));
  const conflicts: string[] = [];
  for (const c of input.classRows || []) {
    for (const o of others) {
      if (o.scheduleType === 'EXAM') continue;
      if (c.day === o.dayOfWeek && o.startTime && o.endTime && c.start && c.end &&
          toMin(c.start) < toMin(String(o.endTime)) && toMin(String(o.startTime)) < toMin(c.end)) {
        if (c.roomId && o.roomId === c.roomId) conflicts.push(`تداخل سالن در ${c.day} ${c.start}–${c.end}`);
        if (o.professorId && off.professorId && o.professorId === off.professorId) conflicts.push(`تداخل استاد در ${c.day}`);
      }
    }
  }
  if (input.exam) {
    for (const o of others) {
      if (o.scheduleType !== 'EXAM') continue;
      if (o.examDate && input.exam.date === String(o.examDate) && input.exam.start &&
          o.startTime && toMin(input.exam.start) < toMin(String(o.endTime || o.startTime)) && toMin(String(o.startTime)) < toMin(input.exam.end)) {
        conflicts.push(`تداخل امتحان در ${input.exam.date}`);
      }
    }
  }
  if (conflicts.length && !String(input.overrideReason || '').trim()) {
    return { ok: false, error: `تداخل: ${conflicts[0]} — برای ذخیره با وجود تداخل، دلیل (حکم/مجوز) را وارد کن.` };
  }
  const reason = String(input.overrideReason || '').trim();

  // ظرفیت
  if (Number.isInteger(input.capacity) && input.capacity >= 0) {
    await db.update(course_offerings).set({ capacity: input.capacity })
      .where(and(eq(course_offerings.id, input.offeringId), u ? eq(course_offerings.universityId, u.id) : sql`1 = 1`));
  }
  // جلسات کلاس
  await withUserRls(me.id, async tx => {
    for (const c of input.classRows || []) {
      await tx.update(schedules).set({
        dayOfWeek: c.day, startTime: c.start || '00:00', endTime: c.end || '00:00', roomId: c.roomId ?? null,
      }).where(and(eq(schedules.id, c.id), eq(schedules.offeringId, input.offeringId)));
    }
    // امتحان: به‌روزرسانی ردیف موجود یا درج یک EXAM اگر نبود
    if (input.exam) {
      if (input.exam.id) {
        await tx.update(schedules).set({ examDate: examDateColumnValue(input.exam.date), startTime: input.exam.start || '00:00', endTime: input.exam.end || '00:00' }).where(and(eq(schedules.id, input.exam.id), eq(schedules.offeringId, input.offeringId)));
      } else if (input.exam.date && input.exam.start) {
        await tx.insert(schedules).values({ offeringId: input.offeringId, scheduleType: 'EXAM', examDate: examDateColumnValue(input.exam.date), startTime: input.exam.start, endTime: input.exam.end || input.exam.start, universityId: off.universityId ?? null });
      }
    }
  });
  return { ok: true };
}

export async function listTermsForEditor(): Promise<{ id: number; title: string; isCurrent: boolean }[]> {
  await requireRoleOrPermission(EDU, EDU_PERM);
  const u = await getCurrentUniversity().catch(() => null);
  const rows = await db.select({ id: academic_terms.id, title: academic_terms.title, isCurrent: academic_terms.isCurrent })
    .from(academic_terms)
    .where(u ? eq(academic_terms.universityId, u.id) : undefined)
    .orderBy(desc(academic_terms.id));
  return rows.map(r => ({ id: r.id, title: r.title, isCurrent: (r.isCurrent ?? 0) === 1 }));
}

async function scopeOffConds(eff: Awaited<ReturnType<typeof currentExpertFilters>>): Promise<any[]> {
  if (!eff) return [];
  if (eff.departmentIds) return [inArray(courses.departmentId, eff.departmentIds)];
  if (eff.facultyIds) {
    const ids = (await db.select({ id: departments.id }).from(departments).where(inArray(departments.facultyId, eff.facultyIds))).map(r => r.id);
    return ids.length ? [inArray(courses.departmentId, ids)] : [eq(courses.id, -1)];
  }
  return [];
}
/** فهرست کارشناسان آموزش برای dropdown در «تعریف کلاس». */
export async function listEduExpertsForEditor(): Promise<{ userId: number; name: string }[]> {
  await requireRoleOrPermission(EDU, EDU_PERM);
  const { listEduExpertCandidates } = await import('@/lib/edu-expert');
  return listEduExpertCandidates();
}

/** تخصیص/آزادکردن کارشناس آموزش برای یک کلاس — از داخل «تعریف کلاس».
 *  ⚠ جایگزینِ کامل است؛ برای افزودنِ نفرِ دوم از `addEduExpertToOfferingAction`. */
export async function assignEduExpertForOfferingAction(
  offeringId: number,
  userId: number | null,
): Promise<{ ok: boolean; error?: string }> {
  await requireRoleOrPermission(EDU, EDU_PERM);
  const { setOfferingEduExpertAction } = await import('@/app/admin/edu-expert-assign/actions');
  return setOfferingEduExpertAction(offeringId, userId);
}

/** افزودنِ یک کارشناس دیگر به همین کلاس (کارشناسانِ فعلی می‌مانند). */
export async function addEduExpertToOfferingAction(
  offeringId: number,
  userId: number,
): Promise<{ ok: boolean; error?: string }> {
  await requireRoleOrPermission(EDU, EDU_PERM);
  const { addOfferingEduExpertAction } = await import('@/app/admin/edu-expert-assign/actions');
  return addOfferingEduExpertAction(offeringId, userId);
}

/** حذفِ یک کارشناس از این کلاس (بقیه می‌مانند). */
export async function removeEduExpertFromOfferingAction(
  offeringId: number,
  userId: number,
): Promise<{ ok: boolean; userIds?: number[]; error?: string }> {
  await requireRoleOrPermission(EDU, EDU_PERM);
  const { removeOfferingEduExpertAction } = await import('@/app/admin/edu-expert-assign/actions');
  return removeOfferingEduExpertAction(offeringId, userId);
}
