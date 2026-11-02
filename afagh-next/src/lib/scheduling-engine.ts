/**
 * ═══════════════════════════════════════════════════════════════════════
 * موتور برنامه‌ریزی درسی (PostgreSQL/Drizzle) — تکهٔ گردش کار
 *
 * فاز تأمین (SUPPLY): گروه‌های معارف/علوم پایه/خدمات، کلاس‌های دروس مشترک
 * را با ظرفیت/جنسیت/استاد/زمان/مکان می‌سازند (تعداد گروه تا ۲۰).
 * فاز تخصیص (ALLOCATION): مدیران گروه‌های تخصصی از استخر خدمات، کلاس‌های
 * بدون تداخل با برنامهٔ دانشجویان خود را سبدبندی می‌کنند.
 * بازبینی (REVIEW): کارشناس برنامه‌ریزی کل — ویرایش، بازپس‌گیری، آزادسازی.
 * منتشرشده (PUBLISHED): قفل برنامه + توزیع به پورتال انتخاب واحد.
 *
 * همزمانی: قفل توافقی pg_advisory_xact_lock روی (term) برای هر گلوگاه؛
 * تداخل استاد/مکان در لحظهٔ ثبت (تراکنشی) بررسی می‌شود.
 * SQL امن: فقط پارامتری — هیچ sql.raw روی ورودی کاربر نیست.
 * ═══════════════════════════════════════════════════════════════════════
 */
import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  classrooms, course_offerings, courses, offering_professors, schedules,
  scheduling_allocations, scheduling_room_grants, staff, term_scheduling_states,
} from '@/db/schema';
import { auditChain, type AuditTx } from '@/lib/audit-chain';
import { advisoryLock } from '@/lib/advisory-lock';
import {
  allocateQuotaShifts, canAllocateInPhase, canEditInPhase, canTransition,
  calculateSlotScore, countInternalGaps, distributeGroupsByFaculty, overlaps, suggestedGroupCount,
  toMinutes, validateGroupDrafts,
  type GroupDraftInput, type Shift, type RoomGrantInput,
} from '@/lib/scheduling-core';

const hm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : '');
const hhmmss = (t: string) => (t.length === 5 ? `${t}:00` : t);
const toHHMM = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** وضعیت فاز ترم — داخل تراکنش (هم‌خوانی با قفل) */
/** تبدیل userId → staffId برای ستون‌های *ByStaffId (آن‌ها به staff.id FK دارند) */
async function resolveStaffId(tx: AuditTx, userId: number | null): Promise<number | null> {
  if (!userId) return null;
  const rows = await tx.select({ id: staff.id }).from(staff).where(eq(staff.userId, userId)).limit(1);
  return rows[0]?.id ?? null;
}

async function stateInTx(tx: AuditTx, termId: number) {
  const [st] = await tx.select().from(term_scheduling_states).where(eq(term_scheduling_states.termId, termId)).limit(1);
  return st ?? { termId, phase: 'SUPPLY' as const };
}

export async function getSchedulingState(termId: number) {
  const [st] = await db.select().from(term_scheduling_states).where(eq(term_scheduling_states.termId, termId)).limit(1);
  return st ?? { termId, phase: 'SUPPLY' as const };
}

/** گذار فازها: SUPPLY → ALLOCATION → REVIEW → PUBLISHED (پلهای، نه پرشی) */
export async function transitionSchedulingPhase(actorUserId: number | null, termId: number, to: 'ALLOCATION' | 'REVIEW' | 'PUBLISHED') {
  return db.transaction(async tx => {
    await advisoryLock(tx, 'sched_phase', termId);
    const st = await stateInTx(tx, termId);
    if (!canTransition(st.phase as any, to)) {
      throw new Error(`گذار فاز ${st.phase} → ${to} مجاز نیست (فازها پلهای‌اند).`);
    }
    if (st.id) {
      await tx.update(term_scheduling_states).set({
        phase: to,
        publishedAt: to === 'PUBLISHED' ? new Date() : st.publishedAt,
        publishedByStaffId: to === 'PUBLISHED' ? await resolveStaffId(tx, actorUserId) : st.publishedByStaffId,
      }).where(eq(term_scheduling_states.id, st.id));
    } else {
      await tx.insert(term_scheduling_states).values({
        termId, phase: to,
        publishedAt: to === 'PUBLISHED' ? new Date() : null,
        publishedByStaffId: to === 'PUBLISHED' ? await resolveStaffId(tx, actorUserId) : null,
      });
    }
    await auditChain(tx, actorUserId, 'SCHEDULING_PHASE_TRANSITION', 'academic_term', termId, { from: st.phase, to });
    return { ok: true, phase: to };
  });
}

// ─────────────────────────── فاز تأمین: ساخت گروه‌ها ───────────────────────────

export interface SupplyInput {
  termId: number;
  courseId: number;
  ownerDepartmentId: number;
  isSharedService: boolean;
  drafts: GroupDraftInput[];
}

const WEEKLY_DURATION_MIN = 90;

/**
 * ساخت گروه‌های درسی (۱..۲۰ گروه) در یک تراکنش:
 * اعتبارسنجی هسته → تداخل استاد/مکان در لحظهٔ ثبت → درج دسته‌ای
 * offering + schedule + offering_professors.
 */
export async function supplyGroupDrafts(actorUserId: number | null, px: SupplyInput) {
  const { termId, courseId, ownerDepartmentId, isSharedService } = px;
  const { getCurrentUniversity } = await import('@/lib/university-scope');
  const curUni = await getCurrentUniversity().catch(() => null);
  const uniId = curUni && curUni.id > 0 ? curUni.id : null;

  const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!course) throw new Error('درس یافت نشد.');
  if (isSharedService && course.offeringScope !== 'GENERAL_SERVICE') {
    throw new Error('این درس در کاتالوگ به‌عنوان درس خدماتی سراسری تعریف نشده است.');
  }
  // درس باید متعلق به گروه سازنده باشد (قلمرو)
  if (course.departmentId != null && course.departmentId !== ownerDepartmentId) {
    throw new Error('این درس متعلق به گروه دیگری است و نمی‌توانید برای آن ارائه بسازید.');
  }
  // اساتید باید متعلق به گروه سازنده باشند (قلمرو)
  const profIds = px.drafts.map(d => Number(d.professorId));
  const profs = await db.select({ id: staff.id, departmentId: staff.departmentId, universityId: staff.universityId })
    .from(staff).where(inArray(staff.id, profIds));
  for (const p of profs) {
    if (Number(p.departmentId) !== ownerDepartmentId) {
      throw new Error(`استاد ${p.id} از گروه دیگری است — فقط اساتید گروه سازنده مجازند.`);
    }
    if (uniId && p.universityId && Number(p.universityId) !== uniId) {
      throw new Error('استاد انتخاب‌شده متعلق به دانشگاه دیگری است.');
    }
  }

  // ترم باید متعلق به دانشگاه فعال باشد
  const { academic_terms } = await import('@/db/schema');
  const [termRow] = await db.select({ id: academic_terms.id, universityId: academic_terms.universityId }).from(academic_terms).where(eq(academic_terms.id, termId)).limit(1);
  if (!termRow) throw new Error('ترم یافت نشد.');
  if (uniId && termRow.universityId && Number(termRow.universityId) !== uniId) {
    throw new Error('ترم انتخاب‌شده متعلق به دانشگاه دیگری است.');
  }

  const drafts = validateGroupDrafts(px.drafts, isSharedService);

  return db.transaction(async tx => {
    await advisoryLock(tx, 'sched_supply', termId);
    const state = await stateInTx(tx, termId);
    if (!canEditInPhase(state.phase as any)) throw new Error(`در فاز «${state.phase}» امکان ساخت گروه درسی نیست.`);

    // ۱) گروه تکراری در همین ترم؟
    const existing = await tx
      .select({ groupNumber: course_offerings.groupNumber })
      .from(course_offerings)
      .where(and(eq(course_offerings.termId, termId), eq(course_offerings.courseId, courseId)));
    const existingSet = new Set(existing.map(e => Number(e.groupNumber)));
    for (const d of drafts) {
      if (existingSet.has(d.groupNumber)) {
        throw new Error(`گروه ${d.groupNumber} این درس در ترم جاری قبلاً ساخته شده است.`);
      }
    }

    // ۲) برنامهٔ فعلی ترم (تداخل استاد/مکان — دفاع در عمق)
    const booked = await tx.execute(sql`
      select s."dayOfWeek", s."startTime", s."endTime", s."roomId", o."professorId"
      from schedules s join course_offerings o on o.id = s."offeringId"
      where o."termId" = ${termId}
    `);
    const bookedRows = (booked.rows as { dayOfWeek: number; startTime: string; endTime: string; roomId: number | null; professorId: number | null }[]);
    for (const d of drafts) {
      for (const b of bookedRows) {
        if (Number(b.dayOfWeek) !== d.dayOfWeek) continue;
        if (!overlaps(d.startMinutes, d.endMinutes, toMinutes(hm(b.startTime)), toMinutes(hm(b.endTime)))) continue;
        if (Number(b.professorId) === d.professorId) {
          throw new Error(`تداخل استاد در گروه ${d.groupNumber}: استاد در این روز/ساعت کلاس دیگری دارد.`);
        }
        if (Number(b.roomId) === d.classroomId) {
          throw new Error(`تداخل مکان در گروه ${d.groupNumber}: کلاس فیزیکی در این روز/ساعت اشغال است.`);
        }
      }
    }

    // ۳) ظرفیت فیزیکی کلاس و مالکیت دانشگاه
    const roomRows = await tx.select({ id: classrooms.id, capacity: classrooms.capacity, universityId: classrooms.universityId })
      .from(classrooms).where(inArray(classrooms.id, drafts.map(d => d.classroomId)));
    const roomCap = new Map(roomRows.map(r => [Number(r.id), { cap: Number(r.capacity), uni: r.universityId as number | null }]));
    for (const d of drafts) {
      const r = roomCap.get(d.classroomId);
      if (!r) throw new Error(`کلاس فیزیکی گروه ${d.groupNumber} یافت نشد.`);
      if (r.cap < d.capacity) throw new Error(`ظرفیت فیزیکی کلاس گروه ${d.groupNumber} (${r.cap}) کمتر از ظرفیت درخواستی (${d.capacity}) است.`);
      if (uniId && r.uni && Number(r.uni) !== uniId) throw new Error('کلاس انتخاب‌شده متعلق به دانشگاه دیگری است.');
    }

    // ۴) درج دسته‌ای (بدون N+1)
    const inserted = await tx.insert(course_offerings).values(drafts.map(d => ({
      termId, courseId, professorId: d.professorId,
      groupNumber: d.groupNumber, capacity: d.capacity,
      genderRestriction: d.gender,
      ownerDepartmentId, isSharedService: isSharedService ? 1 : 0,
      equivalenceClusterId: course.clusterId,
      offeringType: 'NORMAL',
      universityId: uniId,
    }))).returning({ id: course_offerings.id, groupNumber: course_offerings.groupNumber });

    const offeringByGroup = new Map(inserted.map(o => [Number(o.groupNumber), Number(o.id)]));
    await tx.insert(schedules).values(drafts.map(d => ({
      offeringId: offeringByGroup.get(d.groupNumber)!,
      scheduleType: 'CLASS',
      dayOfWeek: d.dayOfWeek,
      startTime: hhmmss(d.startTime),
      endTime: hhmmss(d.endTime),
      roomId: d.classroomId,
      universityId: uniId,
    })));
    await tx.insert(offering_professors).values(drafts.map(d => ({
      offeringId: offeringByGroup.get(d.groupNumber)!,
      staffId: d.professorId, role: 'MAIN_LECTURER', sharePercentage: '100.00',
      universityId: uniId,
    })));

    await auditChain(tx, actorUserId, 'SCHEDULING_SUPPLY_CREATED', 'academic_term', termId, {
      courseId, ownerDepartmentId, isSharedService: isSharedService ? 1 : 0,
      groups: inserted.length,
      offeringIds: inserted.map(o => o.id),
    });
    return { ok: true, created: inserted.length, offeringIds: inserted.map(o => o.id) };
  });
}

// ─────────────────────────── فاز تخصیص: سبدبندی از استخر خدمات ───────────────────────────

/**
 * تخصیص کلاس‌های مشترک به یک گروه تخصصی: فقط فاز ALLOCATION/REVIEW؛
 * فقط کلاس‌های isSharedService؛ بدون تخصیص تکراری (unique)؛ با چک
 * تداخل زمانی نسبت به برنامهٔ فعلی همان گروه.
 */
export async function allocateSections(actorUserId: number | null, px: {
  termId: number; departmentId: number; offeringIds: number[];
}) {
  const { termId, departmentId, offeringIds } = px;
  if (!offeringIds.length) throw new Error('کلاسی برای تخصیص ارسال نشده است.');

  return db.transaction(async tx => {
    await advisoryLock(tx, 'sched_allocate', termId);
    const state = await stateInTx(tx, termId);
    if (!canAllocateInPhase(state.phase as any)) {
      throw new Error(`تخصیص فقط در فاز ALLOCATION/REVIEW ممکن است (فاز فعلی: ${state.phase}).`);
    }

    const offers = await tx
      .select({ id: course_offerings.id, isSharedService: course_offerings.isSharedService })
      .from(course_offerings)
      .where(inArray(course_offerings.id, offeringIds));
    const found = new Set(offers.map(o => Number(o.id)));
    for (const id of offeringIds) {
      if (!found.has(id)) throw new Error(`کلاس ${id} یافت نشد.`);
    }
    const nonShared = offers.find(o => Number(o.isSharedService) !== 1);
    if (nonShared) throw new Error(`کلاس ${nonShared.id} درس مشترک (خدماتی) نیست — تخصیص از استخر مجاز نیست.`);

    // برنامهٔ هفتگی فعلی گروه (کلاس‌های خودش + تخصیص‌های قبلی)
    const mine = await tx.execute(sql`
      select s."dayOfWeek", s."startTime", s."endTime", s."offeringId"
      from schedules s
      where s."offeringId" in (
        select o2.id from course_offerings o2 where o2."termId" = ${termId}
          and (o2."ownerDepartmentId" = ${departmentId}
               or o2.id in (select a."offeringId" from scheduling_allocations a
                            where a."termId" = ${termId} and a."departmentId" = ${departmentId}))
      )
    `);
    const mineRows = (mine.rows as { dayOfWeek: number; startTime: string; endTime: string; offeringId: number }[]);

    const chosen = await tx
      .select({
        id: course_offerings.id, dayOfWeek: schedules.dayOfWeek,
        startTime: schedules.startTime, endTime: schedules.endTime,
      })
      .from(course_offerings)
      .innerJoin(schedules, eq(schedules.offeringId, course_offerings.id))
      .where(inArray(course_offerings.id, offeringIds));

    const conflicts: string[] = [];
    for (const c of chosen) {
      const cStart = toMinutes(hm(c.startTime));
      const cEnd = toMinutes(hm(c.endTime));
      for (const m of mineRows) {
        if (Number(m.dayOfWeek) !== Number(c.dayOfWeek)) continue;
        if (!overlaps(cStart, cEnd, toMinutes(hm(m.startTime)), toMinutes(hm(m.endTime)))) continue;
        conflicts.push(`کلاس ${c.id} با برنامهٔ گروه شما (کلاس ${m.offeringId}) تداخل دارد.`);
      }
    }
    if (conflicts.length) throw new Error(conflicts.join(' | '));

    // درج تخصیص‌ها (unique — تخصیص دوباره ناممکن)
    const done: number[] = [];
    for (const o of offers) {
      const [ins] = await tx
        .insert(scheduling_allocations)
        .values({ termId, offeringId: o.id, departmentId, allocatedByStaffId: await resolveStaffId(tx, actorUserId) })
        .onConflictDoNothing()
        .returning({ id: scheduling_allocations.id });
      if (ins) done.push(Number(o.id));
    }
    await auditChain(tx, actorUserId, 'SCHEDULING_SECTIONS_ALLOCATED', 'academic_term', termId, {
      departmentId, allocated: done.length,
    });
    return { ok: true, allocated: done.length };
  });
}

// ─────────────────────────── سهمیهٔ کلاس‌ها + استخر شناور ───────────────────────────

/** تخصیص اولیهٔ سهمیه (سالن، شیفت) گروه‌های هر دانشکده بر اساس جمعیت دانشجویی */
export async function allocateRoomQuotas(actorUserId: number | null, termId: number) {
  const faculties = await db.execute(sql`select id from faculties order by id`);
  const grantsAll: { departmentId: number; classroomId: number; shift: Shift }[] = [];

  for (const f of (faculties.rows as { id: number }[])) {
    const roomRows = (await db.execute(sql`
      select id, capacity from classrooms where "facultyId" = ${f.id} order by id
    `)).rows as { id: number; capacity: number }[];
    if (!roomRows.length) continue;
    const deptRows = (await db.execute(sql`
      select d.id as "departmentId", count(s.id)::int as n
      from departments d
      join majors m on m."departmentId" = d.id
      left join students s on s."majorId" = m.id and s.status = 'ACTIVE'
      where d."facultyId" = ${f.id}
      group by d.id order by n desc
    `)).rows as { departmentId: number; n: number }[];

    const rooms: RoomGrantInput[] = roomRows.map(r => ({
      classroomId: Number(r.id), capacity: Number(r.capacity), shifts: ['MORNING', 'EVENING'],
    }));
    // گروه‌های خدماتی (بدون دانشجوی چارت‌محور) سهمیه نمی‌گیرند
    const depts = deptRows
      .filter(d => Number(d.n) > 0)
      .map(d => ({ departmentId: Number(d.departmentId), activeStudents: Number(d.n) }));
    if (depts.length) grantsAll.push(...allocateQuotaShifts(rooms, depts));
  }

  if (!grantsAll.length) return { ok: true, grants: 0 };
  let n = 0;
  await db.transaction(async tx => {
    await advisoryLock(tx, 'sched_quota', termId);
    for (const g of grantsAll) {
      const [ins] = await tx
        .insert(scheduling_room_grants)
        .values({ termId, classroomId: g.classroomId, shift: g.shift, ownerDepartmentId: g.departmentId })
        .onConflictDoNothing()
        .returning({ id: scheduling_room_grants.id });
      if (ins) n++;
    }
    await auditChain(tx, actorUserId, 'SCHEDULING_QUOTA_ALLOCATED', 'academic_term', termId, { grants: n });
  });
  return { ok: true, grants: n };
}

/** آزادسازی شیفت مازاد (فقط مالک) → ورود به استخر مشترک دانشکده */
export async function releaseRoomShift(actorUserId: number | null, px: {
  termId: number; departmentId: number; classroomId: number; shift: Shift;
}) {
  return db.transaction(async tx => {
    await advisoryLock(tx, 'sched_pool', px.termId, px.classroomId);
    const [g] = await tx
      .select().from(scheduling_room_grants)
      .where(and(
        eq(scheduling_room_grants.termId, px.termId),
        eq(scheduling_room_grants.classroomId, px.classroomId),
        eq(scheduling_room_grants.shift, px.shift),
      )).limit(1).for('update');
    if (!g) throw new Error('سهمیهٔ این (سالن، شیفت) برای این ترم وجود ندارد.');
    if (Number(g.ownerDepartmentId) !== px.departmentId) throw new Error('فقط گروه مالک می‌تواند این شیفت را آزاد کند.');
    await tx.update(scheduling_room_grants)
      .set({ status: 'RELEASED', releasedAt: new Date(), releasedByStaffId: await resolveStaffId(tx, actorUserId) })
      .where(eq(scheduling_room_grants.id, g.id));
    await auditChain(tx, actorUserId, 'SCHEDULING_SHIFT_RELEASED', 'classroom', px.classroomId, {
      termId: px.termId, shift: px.shift, fromDepartmentId: px.departmentId,
    });
    return { ok: true };
  });
}

/** قرض‌گرفتن شیفت آزادشده از استخر (هر گروه‌ای) */
export async function borrowReleasedShift(actorUserId: number | null, px: {
  termId: number; classroomId: number; shift: Shift; departmentId: number;
}) {
  return db.transaction(async tx => {
    await advisoryLock(tx, 'sched_pool', px.termId, px.classroomId);
    const [g] = await tx
      .select().from(scheduling_room_grants)
      .where(and(
        eq(scheduling_room_grants.termId, px.termId),
        eq(scheduling_room_grants.classroomId, px.classroomId),
        eq(scheduling_room_grants.shift, px.shift),
      )).limit(1).for('update');
    if (!g) throw new Error('این شیفت وجود ندارد.');
    if (g.status !== 'RELEASED') throw new Error('این شیفت در استخر آزاد نیست.');
    await tx.update(scheduling_room_grants)
      .set({ status: 'ALLOCATED', ownerDepartmentId: px.departmentId })
      .where(eq(scheduling_room_grants.id, g.id));
    await auditChain(tx, actorUserId, 'SCHEDULING_SHIFT_BORROWED', 'classroom', px.classroomId, {
      termId: px.termId, shift: px.shift, toDepartmentId: px.departmentId,
    });
    return { ok: true };
  });
}

/** استخر شناور: شیفت‌های آزادشده (برای قرض‌گرفتن توسط سایر گروه‌ها) */
export async function listPoolShifts(termId: number, facultyId?: number) {
  return db.execute(sql`
    select g."classroomId", g.shift, g."releasedAt", g."ownerDepartmentId" as "originDepartmentId",
           c.name as "classroomName", c.capacity, c."facultyId"
    from scheduling_room_grants g
    join classrooms c on c.id = g."classroomId"
    where g."termId" = ${termId} and g.status = 'RELEASED'
      ${facultyId ? sql`and c."facultyId" = ${facultyId}` : sql``}
    order by c."facultyId", c.id, g.shift
  `);
}

// ─────────────────────────── پیش‌بینی تقاضا (کارنامه × چارت × خوشه) ───────────────────────────

/**
 * متقاضیان واقعی درس (یا کل خوشهٔ هم‌ارز): دانشجویان فعالی که چارت‌شان
 * (نسخهٔ برنامهٔ درسیِ ورودی/رشته) شامل درس است، منهای پاس‌شده‌ها (نمرهٔ قطعی ≥ ۱۰
 * روی هر کد هم‌ارز). خروجی به تفکیک دانشکده + تعداد گروه پیشنهادی.
 */
export async function forecastCourseDemand(courseId: number, standardCapacity = 40) {
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!course) throw new Error('درس یافت نشد.');

  let memberIds: number[] = [courseId];
  if (course.clusterId) {
    const members = await db.select({ id: courses.id }).from(courses).where(eq(courses.clusterId, course.clusterId));
    memberIds = members.map(m => Number(m.id));
    if (!memberIds.includes(courseId)) memberIds.push(courseId);
  }

  // آرایهٔ پارامتر به‌صورت اسکالر گسترش می‌یابد (سازگار با پیش‌پردازندهٔ pg)
  const memberIn = sql.join(memberIds.map(id => sql`${id}`), sql`, `);
  const needing = await db.execute(sql`
    select distinct s.id as "studentId", m."facultyId"
    from students s
    join majors m on m.id = s."majorId"
    join curriculum_versions cv on cv."majorId" = m.id
      and s."entryYear" between cv."entryYearFrom" and coalesce(cv."entryYearTo", 9999)
      and cv."status" in ('PUBLISHED','ARCHIVED')
    join curriculum_courses sc on sc."curriculumVersionId" = cv.id
    where s.status = 'ACTIVE' and sc."courseId" in (${memberIn})
  `);
  const needingRows = (needing.rows as { studentId: number; facultyId: number | null }[]);
  const needingSet = new Set(needingRows.map(r => Number(r.studentId)));
  if (!needingSet.size) {
    return { courseId, clusterId: course.clusterId ? Number(course.clusterId) : null, equivalentCourseIds: memberIds, activeNeedingCount: 0, alreadyPassedCount: 0, eligibleStudents: 0, suggestedGroups: 1, byFaculty: [] };
  }

  const needingIn = sql.join([...needingSet].map(id => sql`${id}`), sql`, `);
  const passed = await db.execute(sql`
    select distinct e."studentId"
    from enrollments e
    join course_offerings o on o.id = e."offeringId"
    where o."courseId" in (${memberIn})
      and e."gradeStatus" = 'FINALIZED' and e."gradeValue" >= 10
      and e."studentId" in (${needingIn})
  `);
  const passedSet = new Set((passed.rows as { studentId: number }[]).map(r => Number(r.studentId)));

  const facultyMap = new Map<number | null, number>();
  const eligibleSet = new Set<number>();
  for (const r of needingRows) {
    const sid = Number(r.studentId);
    if (passedSet.has(sid)) continue;
    eligibleSet.add(sid);
    const fid = r.facultyId ? Number(r.facultyId) : null;
    facultyMap.set(fid, (facultyMap.get(fid) ?? 0) + 1);
  }

  const byFaculty = distributeGroupsByFaculty(
    [...facultyMap.entries()].map(([facultyId, eligible]) => ({ facultyId, eligible })),
    standardCapacity,
  );

  return {
    courseId, clusterId: course.clusterId ? Number(course.clusterId) : null,
    equivalentCourseIds: memberIds,
    activeNeedingCount: needingSet.size,
    alreadyPassedCount: passedSet.size,
    eligibleStudents: eligibleSet.size,
    suggestedGroups: suggestedGroupCount(eligibleSet.size, standardCapacity),
    byFaculty,
  };
}

// ─────────────────────────── پیشنهادهای طلایی (۴ کارت) ───────────────────────────

/**
 * چهار پیشنهاد برتر برای یک گروه: بازه‌های حضور استاد × سالن‌های با ظرفیت
 * کافی × خالی‌بودن (استاد/سالن) → امتیازدهی (نزدیکی دانشکده + ترجیح زمان +
 * تناسب ظرفیت) → ۴ کارت اول. بازهٔ ترجیحی = سطر اختصاصی ترم استاد.
 */
export async function getSmartSuggestions(px: {
  termId: number; professorId: number; capacity: number;
  targetFacultyId: number | null; durationMinutes?: number;
}) {
  const duration = px.durationMinutes ?? WEEKLY_DURATION_MIN;
  const [prof] = await db.select({ id: staff.id }).from(staff).where(eq(staff.id, px.professorId)).limit(1);
  if (!prof) throw new Error('استاد یافت نشد.');

  const availRows = (await db.execute(sql`
    select "dayOfWeek", "startTime", "endTime", "termId" from professor_availabilities
    where "staffId" = ${px.professorId}
      and ("termId" is null or "termId" = ${px.termId})
      and "startTime" is not null and "endTime" is not null
  `)).rows as { dayOfWeek: number; startTime: string; endTime: string; termId: number | null }[];
  if (!availRows.length) return [];

  const busyRaw = (await db.execute(sql`
    select s."dayOfWeek", s."startTime", s."endTime" from schedules s
    join course_offerings o on o.id = s."offeringId"
    where o."termId" = ${px.termId} and o."professorId" = ${px.professorId}
  `)).rows as { dayOfWeek: number; startTime: string; endTime: string }[];
  const busyRows = busyRaw.map(b => ({ day: Number(b.dayOfWeek), start: toMinutes(hm(b.startTime)), end: toMinutes(hm(b.endTime)) }));

  const roomRows = (await db.execute(sql`
    select id, name, capacity, "facultyId" from classrooms where capacity >= ${px.capacity}
  `)).rows as { id: number; name: string; capacity: number; facultyId: number | null }[];
  if (!roomRows.length) return [];

  const occupiedRaw = (await db.execute(sql`
    select s."dayOfWeek", s."startTime", s."endTime", s."roomId" from schedules s
    join course_offerings o on o.id = s."offeringId"
    where o."termId" = ${px.termId} and s."roomId" is not null
  `)).rows as { dayOfWeek: number; startTime: string; endTime: string; roomId: number }[];
  const occupiedRows = occupiedRaw.map(o => ({ day: Number(o.dayOfWeek), room: Number(o.roomId), start: toMinutes(hm(o.startTime)), end: toMinutes(hm(o.endTime)) }));

  const suggested: { dayOfWeek: number; startTime: string; endTime: string; classroomId: number; classroomName: string; classroomCapacity: number; score: number; reasons: string[] }[] = [];

  // بلوک‌های اشغالِ استاد به تفکیک روز — مبنای «پشت سر هم و بدون ساعت خالی».
  const busyByDay = new Map<number, { start: number; end: number }[]>();
  for (const b of busyRows) {
    const list = busyByDay.get(b.day) ?? [];
    list.push({ start: b.start, end: b.end });
    busyByDay.set(b.day, list);
  }

  for (const a of availRows) {
    const day = Number(a.dayOfWeek);
    const wStart = toMinutes(hm(a.startTime));
    const wEnd = toMinutes(hm(a.endTime));
    const preferred = a.termId !== null;
    const dayBlocks = busyByDay.get(day) ?? [];
    const dayAlreadyUsed = dayBlocks.length > 0;
    const gapsBefore = countInternalGaps(dayBlocks);
    for (let start = wStart; start + duration <= wEnd; start += 30) {
      const end = start + duration;
      if (busyRows.some(b => b.day === day && overlaps(start, end, b.start, b.end))) continue;
      // چسبیده به بلوک موجود؟ و آیا ساعت خالی جدید می‌سازد؟
      const adjacentToExisting = dayBlocks.some(b => b.end === start || b.start === end);
      const gapsAfter = countInternalGaps([...dayBlocks, { start, end }]);
      const gapsCreated = Math.max(0, gapsAfter - gapsBefore);
      for (const room of roomRows) {
        if (occupiedRows.some(o => o.day === day && o.room === Number(room.id) && overlaps(start, end, o.start, o.end))) continue;
        const { score, reasons } = calculateSlotScore({
          roomFacultyId: room.facultyId ? Number(room.facultyId) : null,
          targetFacultyId: px.targetFacultyId,
          inPreferredWindow: preferred,
          inAvailableWindow: true,
          roomCapacity: Number(room.capacity),
          requiredCapacity: px.capacity,
          adjacentToExisting,
          dayAlreadyUsed,
          gapsCreated,
        });
        // امتیاز فقط «ترتیب» می‌سازد، نه فیلتر: یک اسلاتِ معتبر نباید فقط
        // به‌خاطر جریمهٔ ساعت خالی از فهرست حذف شود.
        if (Number(room.capacity) < px.capacity) continue;
        suggested.push({
          dayOfWeek: day,
          startTime: toHHMM(start), endTime: toHHMM(end),
          classroomId: Number(room.id), classroomName: room.name, classroomCapacity: Number(room.capacity),
          score, reasons,
        });
      }
    }
  }
  return suggested.sort((a, b) => b.score - a.score).slice(0, 4);
}

// ─────────────────────────── اساتید هر گروه (قلمرو) ───────────────────────────

/** فقط اساتیدِ همان گروه (فیلتر قلمرو — مدیر حسابداری استاد روانشناسی را نمی‌بیند) */
export async function getDepartmentProfessors(departmentId: number) {
  return db
    .select({ id: staff.id, staffCode: staff.staffCode, name: staff.title, departmentId: staff.departmentId, canManageServicePool: staff.canManageServicePool })
    .from(staff)
    .where(and(eq(staff.departmentId, departmentId), eq(staff.isActive, 1)))
    .orderBy(staff.staffCode);
}

// ─────────────────────────── کارتابل کارشناس کل (Override) ───────────────────────────

/** بازتخصیص/بازپس‌گیری سهمیه توسط کارشناس (فقط فاز REVIEW) */
export async function expertOverrideGrant(actorUserId: number | null, px: {
  termId: number; classroomId: number; shift: Shift; toDepartmentId: number;
}) {
  return db.transaction(async tx => {
    await advisoryLock(tx, 'sched_expert', px.termId, px.classroomId);
    const state = await stateInTx(tx, px.termId);
    if (state.phase !== 'REVIEW') throw new Error(`Override فقط در فаз REVIEW ممکن است (فعلی: ${state.phase}).`);

    // آزادسازی هر سهمیهٔ موجود و تخصیص به گروه هدف
    const [g] = await tx
      .select().from(scheduling_room_grants)
      .where(and(
        eq(scheduling_room_grants.termId, px.termId),
        eq(scheduling_room_grants.classroomId, px.classroomId),
        eq(scheduling_room_grants.shift, px.shift),
      )).limit(1).for('update');

    await tx.insert(scheduling_room_grants)
      .values({ termId: px.termId, classroomId: px.classroomId, shift: px.shift, ownerDepartmentId: px.toDepartmentId })
      .onConflictDoUpdate({
        target: [scheduling_room_grants.termId, scheduling_room_grants.classroomId, scheduling_room_grants.shift],
        set: { ownerDepartmentId: px.toDepartmentId, status: 'ALLOCATED', releasedAt: null },
      });
    await auditChain(tx, actorUserId, 'SCHEDULING_EXPERT_GRANT_OVERRIDE', 'classroom', px.classroomId, {
      termId: px.termId, shift: px.shift, toDepartmentId: px.toDepartmentId,
      previousOwnerId: g ? Number(g.ownerDepartmentId) : null,
    });
    return { ok: true };
  });
}
