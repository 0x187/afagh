'use server';

import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, withUserRls } from '@/db';
import {
  academic_terms, course_offerings, courses, curriculum_courses, departments, enrollments, financial_clearances, majors,
  offering_professors, schedules, staff, student_term_states, students, users,
} from '@/db/schema';
import { getSessionUser, requireRole } from '@/lib/auth';
import { getBool } from '@/lib/settings';
import { getCurrentUniversity } from '@/lib/university-scope';
import { buildPrereqContext, formatPrereq } from '@/lib/enroll-engine/prereqs';
import { currentExpertFilters, scopedMajorIds } from '@/lib/expert-scope';
import { resolveStudentCurriculum, resolutionReasonMessage } from '@/lib/curriculum-apply';
import { evaluateLogicTree } from '@/lib/enroll-engine/prereqs';
import { escapeLikeChars } from '@/lib/persian-search';

const EDU = ['ADMIN', 'EDU_EXPERT'];

async function uniId(): Promise<number | null> {
  try { return (await getCurrentUniversity())?.id ?? null; } catch { return null; }
}

// ─────────────── جست‌وجوی دانشجو (تک‌ثبت‌نام) ───────────────
export async function searchStudentsForManualEnroll(q: string): Promise<{
  ok: boolean; items?: { userId: number; studentId: number; studentCode: string; name: string; entryYear: number | null; status: string }[]; error?: string;
}> {
  try { await requireRole(EDU); } catch { return { ok: false, error: 'دسترسی ندارید.' }; }
  const u = await uniId();
  const needle = String(q || '').trim();
  if (!needle) return { ok: true, items: [] };
  const conds = [eq(students.status, 'ACTIVE')];
  if (u) conds.push(eq(students.universityId, u));
  // دامنهٔ کارشناس: رشته‌های مجازش را اعمال کن
  const eff = await currentExpertFilters();
  const majScope = await scopedMajorIds(eff, u);
  if (majScope) conds.push(inArray(students.majorId, majScope));
  const rows = await db
    .select({
      userId: students.userId, studentId: students.id, studentCode: students.studentCode,
      entryYear: students.entryYear, status: students.status,
      firstName: users.firstName, lastName: users.lastName,
    })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .where(and(...conds, or(
      sql`${students.studentCode} ILIKE ${'%' + escapeLikeChars(needle) + '%'} ESCAPE '\\'`,
      sql`coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '') ILIKE ${'%' + escapeLikeChars(needle) + '%'} ESCAPE '\\'`,
    )))
    .orderBy(desc(students.id)).limit(20);
  return { ok: true, items: rows.map(r => ({ userId: r.userId, studentId: r.studentId, studentCode: r.studentCode, status: r.status, entryYear: r.entryYear, name: `${r.firstName || ''} ${r.lastName || ''}`.trim() })) };
}

export interface ManualEnrollOffering {
  offeringId: number; code: string; title: string; groupNumber: number; units: number | null;
  capacity: number; enrolledCount: number; professorName: string;
}

export async function listOfferingsForManualEnroll(termId: number): Promise<ManualEnrollOffering[]> {
  try { await requireRole(EDU); } catch { return []; }
  const u = await uniId();
  const eff = await currentExpertFilters().catch(() => null);
  const majScope = await scopedMajorIds(eff, u).catch(() => null);
  let deptScope: number[] | null = null;
  if (majScope) {
    const mrows = await db.select({ departmentId: majors.departmentId }).from(majors).where(inArray(majors.id, majScope)).limit(5000).catch(() => []);
    const ds = [...new Set(mrows.map(r => r.departmentId).filter((n): n is number => typeof n === 'number'))];
    if (ds.length) deptScope = ds;
    else if (eff) return [];
  }
  const rows = await db
    .select({
      offeringId: course_offerings.id, code: courses.code, title: courses.title,
      groupNumber: course_offerings.groupNumber, units: courses.units,
      capacity: course_offerings.capacity, enrolledCount: course_offerings.enrolledCount, professorId: course_offerings.professorId,
    })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(eq(course_offerings.termId, termId), eq(course_offerings.isActive, 1),
      u ? eq(course_offerings.universityId, u) : sql`1 = 0`,
      deptScope ? inArray(courses.departmentId, deptScope) : undefined))
    .orderBy(asc(courses.title), asc(course_offerings.groupNumber)).limit(4000);
  const profIds = [...new Set(rows.map(r => r.professorId).filter((n): n is number => typeof n === 'number'))];
  const profName = new Map<number, string>();
  if (profIds.length) {
    const ps = await db.select({ id: staff.id, firstName: users.firstName, lastName: users.lastName })
      .from(staff).innerJoin(users, eq(users.id, staff.userId)).where(inArray(staff.id, profIds));
    for (const p of ps) profName.set(p.id, `${p.firstName || ''} ${p.lastName || ''}`.trim());
  }
  return rows.map(r => ({
    offeringId: r.offeringId, code: r.code, title: r.title, groupNumber: r.groupNumber,
    units: r.units == null ? null : Number(r.units), capacity: r.capacity,
    enrolledCount: r.enrolledCount ?? 0,
    professorName: (r.professorId != null && profName.get(r.professorId)) || '—',
  }));
}

// ─────────────── تک‌ثبت‌نام به‌جای دانشجو ───────────────
export interface ManualEnrollInput { studentId: number; offeringId: number; override: boolean; reason: string; }

export async function manualEnrollAction(input: ManualEnrollInput): Promise<{ ok: boolean; error?: string; enrollmentId?: number }> {
  const me = await requireRole(EDU);
  const sid = Number(input.studentId), oid = Number(input.offeringId);
  if (!Number.isInteger(sid) || !Number.isInteger(oid)) return { ok: false, error: 'اطلاعات نامعتبر.' };
  const override = !!input.override;
  const reason = String(input.reason || '').trim();
  const overrideAllowed = await getBool('ENROLL_EXPERT_OVERRIDE').catch(() => true);
  if (override && !overrideAllowed) return { ok: false, error: 'نادیده‌گرفتن آیین‌نامه در حال حاضر غیرمجاز است (تنظیم سازمان).' };
  if (override && reason.length < 5) return { ok: false, error: 'وقتی آیین‌نامه را نادیده می‌گیری، دلیل (حداقل ۵ نویسه) الزامی است.' };

  const u = await uniId();
  const [stu] = await db.select().from(students).where(and(eq(students.id, sid), eq(students.status, 'ACTIVE'))).limit(1);
  if (!stu) return { ok: false, error: 'دانشجوی فعال یافت نشد.' };
  if (u && stu.universityId && stu.universityId !== u) return { ok: false, error: 'این دانشجو از دانشگاه دیگری است.' };
  // دامنهٔ کارشناس: اگر رشتهٔ دانشجو در محدوده‌اش نیست، رد کن
  const _eff = await currentExpertFilters();
  const _maj = await scopedMajorIds(_eff, u);
  if (_maj && !_maj.includes(stu.majorId ?? -1)) return { ok: false, error: 'این دانشجو در محدودهٔ دسترسی شما نیست.' };
  const [off] = await db.select().from(course_offerings)
    .where(and(eq(course_offerings.id, oid), eq(course_offerings.isActive, 1))).limit(1);
  if (!off) return { ok: false, error: 'کلاس یافت نشد یا غیرفعال است.' };
  if (u && off.universityId && off.universityId !== u) return { ok: false, error: 'این کلاس متعلق به دانشگاه دیگری است.' };
  if (u && off.universityId == null) return { ok: false, error: 'دانشگاه کلاس نامشخص است.' };
  const dup = await db.select({ id: enrollments.id }).from(enrollments)
    .where(and(eq(enrollments.studentId, sid), eq(enrollments.offeringId, oid))).limit(1);
  if (dup.length) return { ok: false, error: 'این دانشجو همین‌الان در این کلاس ثبت است.' };
  if (!override && off.enrolledCount != null && off.capacity > 0 && off.enrolledCount >= off.capacity) {
    return { ok: false, error: 'ظرفیت کلاس پر است — برای تخطی، نادیده‌گرفتن (با دلیل) لازم است.' };
  }
  // ── گیت سقف واحد (همان موتور آیین‌نامهٔ انتخاب واحد دانشجو) ──
  const offCourse = await db.select({ code: courses.code, title: courses.title, units: courses.units })
    .from(courses).where(eq(courses.id, off.courseId)).limit(1);
  const newUnits = Number(offCourse[0]?.units ?? 0);
  let allowedMax: number | null = null;
  try { allowedMax = (await evaluateStudentRegulationStatus(sid, off.termId)).effectiveMaxUnits; } catch { allowedMax = null; }
  const curUnitsRows = await db.select({ units: courses.units })
    .from(enrollments).innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(eq(enrollments.studentId, sid), eq(course_offerings.termId, off.termId),
      inArray(enrollments.status, ['REGISTERED', 'PENDING_COUNCIL'])));
  const curUnits = curUnitsRows.reduce((s, r) => s + Number(r.units || 0), 0);
  if (!override && allowedMax != null && curUnits + newUnits > allowedMax) {
    return { ok: false, error: `سقف واحد: ثبت‌شده ${curUnits} + این درس ${newUnits} = ${curUnits + newUnits} واحد، بیش از سقف مجاز ${allowedMax} واحد است — برای تخطی، نادیده‌گرفتن (با دلیل) لازم است.` };
  }
  // ── گیت پیش‌نیاز (درخت منطقی — خطای نرم، با override پذیرفته می‌شود) ──
  let prereqViolated: string | null = null;
  try {
    const pctx = await buildPrereqContext(sid);
    const rule = pctx.ruleByCourse.get(off.courseId);
    if (rule) {
      const ev = evaluateLogicTree(rule, pctx.passed, pctx);
      if (!ev.ok) prereqViolated = ev.missing.map(c => pctx.titles.get(c) ?? c).join('، ');
    }
  } catch { /* موتور در دسترس نیست */ }
  if (!override && prereqViolated) {
    return { ok: false, error: `پیش‌نیاز برآورده نشده: نیازمند گذراندن «${prereqViolated}» است — برای تخطی، نادیده‌گرفتن (با دلیل) لازم است.` };
  }
  // تداخل هفتگی/امتحانی → گیت «حکم شورا»
  const conflicts = (await buildConflictIndex(sid, off.termId)).get(oid);
  const gateErr = councilGate(conflicts, override);
  if (gateErr) return { ok: false, error: gateErr };
  // اخطارهای آیین‌نامه (مشروطی/سنوات/مالی/…) — سطح block نیازمند مجوز
  const warnings = (await getStudentWarnings(sid, off.termId)).items ?? [];
  const blocks = warnings.filter(w => w.level === 'block');
  if (blocks.length && !override) {
    return { ok: false, error: `اخطار آیین‌نامه: ${blocks.map(b => b.title).join('، ')} — برای صدور مجوز، نادیده‌گرفتن+دلیل را فعال کن.` };
  }
  const overriddenCodes = override ? JSON.stringify([
    ...new Set([
      ...warnings.map(w => w.code),
      ...(conflicts ? ['conflict'] : []),
      ...(prereqViolated ? ['prereq'] : []),
      ...(allowedMax != null && curUnits + newUnits > allowedMax ? ['max_units'] : []),
    ]),
  ]) : null;

  const ins = await withUserRls(me.id, tx => tx.insert(enrollments).values({
    studentId: sid, offeringId: oid, status: 'REGISTERED', universityId: stu.universityId ?? null,
    enrolledByUserId: me.id, enrollOverride: override ? 1 : 0, enrollOverrideReason: override ? reason : null,
    councilRuling: conflicts?.length ? 1 : 0, overriddenRules: overriddenCodes,
  }).returning({ id: enrollments.id }));
  await db.update(course_offerings).set({ enrolledCount: sql`${course_offerings.enrolledCount} + 1` })
    .where(and(eq(course_offerings.id, oid), u ? eq(course_offerings.universityId, u) : sql`1 = 1`));
  return { ok: true, enrollmentId: ins[0]?.id };
}

// ─────────────── حذف/اصلاح یک ثبت‌نامِ ثبت‌شدهٔ توسط کارشناس ───────────────
export async function dropEnrollAction(enrollmentId: number, reason: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireRole(EDU);
  const eid = Number(enrollmentId);
  if (!Number.isInteger(eid)) return { ok: false, error: 'اطلاعات نامعتبر.' };
  const [row] = await db.select({
    id: enrollments.id, studentId: enrollments.studentId, offeringId: enrollments.offeringId,
    status: enrollments.status, universityId: enrollments.universityId,
    studentUni: students.universityId,
  })
    .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId))
    .where(eq(enrollments.id, eid)).limit(1);
  if (!row) return { ok: false, error: 'ثبت‌نام یافت نشد.' };
  const u = await uniId();
  if (u && row.studentUni && row.studentUni !== u) return { ok: false, error: 'این دانشجو از دانشگاه دیگری است.' };
  // دامنهٔ کارشناس
  const eff = await currentExpertFilters();
  const majScope = await scopedMajorIds(eff, u);
  if (majScope) {
    const [stu] = await db.select({ majorId: students.majorId }).from(students).where(eq(students.id, row.studentId)).limit(1);
    if (!majScope.includes(stu?.majorId ?? -1)) return { ok: false, error: 'این دانشجو در محدودهٔ دسترسی شما نیست.' };
  }
  if (row.status === 'DROPPED' || row.status === 'COMPLETED') return { ok: false, error: 'این ثبت‌نام قبلاً حذف/نهایی شده است.' };
  const rs = String(reason || '').trim();
  await withUserRls(me.id, tx => tx.update(enrollments)
    .set({ status: 'DROPPED', enrolledByUserId: me.id, enrollOverrideReason: rs || null })
    .where(eq(enrollments.id, eid)));
  await db.update(course_offerings).set({ enrolledCount: sql`GREATEST(${course_offerings.enrolledCount} - 1, 0)` })
    .where(eq(course_offerings.id, row.offeringId));
  return { ok: true };
}

// ─────────────── فیلتر گروهی (ورودی/رشته/دانشکده/گروه/ترم/نیمسال ورود) ───────────────
export interface BulkFilter {
  termId: number;
  entryYear: number | null;
  entryTerm: number | null;
  majorId: number | null;
  departmentId: number | null;
  facultyId: number | null;
  /** انتخاب صریح دانشجو (جست‌وجو+افزودن) — اگر خالی نباشد، مقدم بر فیلتر گروهی است */
  studentIds?: number[] | null;
}

async function bulkStudentIds(f: BulkFilter): Promise<number[]> {
  // انتخاب صریح دانشجویان: فقط همان‌ها (با اعمال وضعیت فعال و مرز دانشگاه/کارشناس)
  if (Array.isArray(f.studentIds) && f.studentIds.length) {
    const u = await uniId();
    const conds: any[] = [inArray(students.id, f.studentIds.map(Number).filter(Number.isInteger))];
    if (u) conds.push(eq(students.universityId, u));
    const eff = await currentExpertFilters();
    const majScope = await scopedMajorIds(eff, u);
    if (majScope) conds.push(inArray(students.majorId, majScope));
    const rows = await db.select({ id: students.id }).from(students).where(and(...conds)).limit(5000);
    return rows.map(r => r.id);
  }
  const u = await uniId();
  const conds = [eq(students.status, 'ACTIVE'), u ? eq(students.universityId, u) : sql`1 = 0`];
  // دامنهٔ کارشناس
  const eff = await currentExpertFilters();
  const majScope = await scopedMajorIds(eff, u);
  if (majScope) conds.push(inArray(students.majorId, majScope));
  if (f.entryYear) conds.push(eq(students.entryYear, f.entryYear));
  if (f.entryTerm) conds.push(eq(students.entryTerm, f.entryTerm));
  if (f.majorId) conds.push(eq(students.majorId, f.majorId));
  if (f.departmentId || f.facultyId) {
    const mConds: any[] = [];
    if (f.departmentId) mConds.push(eq(majors.departmentId, f.departmentId));
    else if (f.facultyId) mConds.push(eq(majors.facultyId, f.facultyId));
    const mids = (await db.select({ id: majors.id }).from(majors).where(mConds.length ? and(...mConds) : undefined)).map(r => r.id);
    if (!mids.length) return [];
    conds.push(inArray(students.majorId, mids));
  }
  const rows = await db.select({ id: students.id }).from(students).where(and(...conds)).limit(20000);
  return rows.map(r => r.id);
}

/** شمارش گروه مخاطب پیش از اقدام دسته‌جمعی */
export async function countBulkStudents(f: BulkFilter): Promise<{ ok: boolean; count?: number; error?: string }> {
  try { await requireRole(EDU); } catch { return { ok: false, error: 'دسترسی ندارید.' }; }
  try { return { ok: true, count: (await bulkStudentIds(f)).length }; } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** انتخاب واحد دسته‌جمعی: همهٔ دانشجویان فیلتر → در یک یا چند کلاس ثبت می‌شوند */
export async function bulkEnrollAction(
  f: BulkFilter, offeringIds: number[], override: boolean, reason: string,
): Promise<{ ok: boolean; error?: string; inserted?: number; skipped?: number; total?: number }> {
  const me = await requireRole(EDU);
  const overrideAllowed = await getBool('ENROLL_EXPERT_OVERRIDE').catch(() => true);
  if (override && !overrideAllowed) return { ok: false, error: 'نادیده‌گرفتن آیین‌نامه غیرمجاز است (تنظیم سازمان).' };
  if (override && String(reason || '').trim().length < 5) return { ok: false, error: 'دلیل نادیده‌گرفتن (≥۵ نویسه) الزامی است.' };
  const ids = offeringIds.map(Number).filter(Number.isInteger);
  if (!ids.length) return { ok: false, error: 'حداقل یک کلاس انتخاب کنید.' };
  const sids = await bulkStudentIds(f);
  if (!sids.length) return { ok: false, error: 'هیچ دانشجویی با این فیلتر پیدا نشد.' };
  const ub = await uniId();

  // ── آماده‌سازی دسته‌ای ──────────────────────────────────────────────────
  // پیش‌تر برای هر جفت (کلاس × دانشجو) سه کوئری جدا می‌رفت: چک تکراری، درج،
  // و +۱ کردن ظرفیت. با ۱۰ کلاس × ۳۰۰ دانشجو یعنی ~۹٬۰۰۰ رفت‌وبرگشت.
  // حالا: ارائه‌ها یک‌بار، جفت‌های موجود یک‌بار، درج دسته‌ای، و یک آپدیت
  // ظرفیت به‌ازای هر کلاس. **قواعد و شمارش‌ها عیناً حفظ شده‌اند.**
  const CAP = 3000;
  const offRows = await db.select().from(course_offerings).where(inArray(course_offerings.id, ids));
  const offMap = new Map(offRows.map(o => [o.id, o]));

  const existingPairs = new Set<string>();
  const dupRows = await db
    .select({ sid: enrollments.studentId, oid: enrollments.offeringId })
    .from(enrollments)
    .where(and(inArray(enrollments.offeringId, ids), inArray(enrollments.studentId, sids)));
  for (const d of dupRows) existingPairs.add(`${d.oid}:${d.sid}`);

  let skipped = 0;
  let planned = 0;
  const toInsert: { studentId: number; offeringId: number; universityId: number | null }[] = [];

  for (const oid of ids) {
    if (planned + skipped >= CAP) break;
    const off = offMap.get(oid);
    // کلاس ناموجود یا متعلق به دانشگاه دیگر: یک «رد» (نه به‌ازای هر دانشجو)
    if (!off) { skipped++; continue; }
    if (ub && off.universityId && off.universityId !== ub) { skipped++; continue; }
    // گیت ظرفیت مگر با override — همان snapshot قبلی، ثابت برای همهٔ دانشجویان این کلاس
    const full = !override && off.enrolledCount != null && off.capacity > 0 && off.enrolledCount >= off.capacity;
    for (const sid of sids) {
      if (planned + skipped >= CAP) break;
      if (existingPairs.has(`${oid}:${sid}`)) { skipped++; continue; }
      if (full) { skipped++; continue; }
      existingPairs.add(`${oid}:${sid}`); // جلوگیری از تکرار داخل همین دسته
      toInsert.push({ studentId: sid, offeringId: oid, universityId: off.universityId ?? null });
      planned++;
    }
  }

  let inserted = 0;
  if (toInsert.length) {
    const perOffering = new Map<number, number>();
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      const done = await withUserRls(me.id, tx => tx.insert(enrollments).values(chunk.map(v => ({
        ...v, status: 'REGISTERED',
        enrolledByUserId: me.id,
        enrollOverride: override ? 1 : 0,
        enrollOverrideReason: override ? String(reason || '').trim() : null,
        councilRuling: override ? 1 : 0,
      }))).onConflictDoNothing().returning({ id: enrollments.id, offeringId: enrollments.offeringId }));
      inserted += done.length;
      for (const r of done) perOffering.set(r.offeringId, (perOffering.get(r.offeringId) ?? 0) + 1);
    }
    // یک آپدیت ظرفیت به‌ازای هر کلاس (به‌جای یکی به‌ازای هر دانشجو)
    for (const [oid, n] of perOffering) {
      await db.update(course_offerings).set({ enrolledCount: sql`${course_offerings.enrolledCount} + ${n}` })
        .where(and(eq(course_offerings.id, oid), ub ? eq(course_offerings.universityId, ub) : sql`1 = 1`));
    }
  }
  return { ok: true, inserted, skipped, total: sids.length };
}

/** حذف دسته‌جمعی: ثبت‌نام دانشجویان فیلتر در کلاس‌های انتخابی → DROPPED */
export async function bulkDropAction(
  f: BulkFilter, offeringIds: number[], reason: string,
): Promise<{ ok: boolean; error?: string; dropped?: number; skipped?: number }> {
  const me = await requireRole(EDU);
  const ids = offeringIds.map(Number).filter(Number.isInteger);
  if (!ids.length) return { ok: false, error: 'حداقل یک کلاس انتخاب کنید.' };
  const sids = await bulkStudentIds(f);
  if (!sids.length) return { ok: false, error: 'هیچ دانشجویی با این فیلتر پیدا نشد.' };
  const ud = await uniId();
  let dropped = 0, skipped = 0;
  for (const oid of ids) {
    if (ud) {
      const [offChk] = await db.select({ universityId: course_offerings.universityId }).from(course_offerings).where(eq(course_offerings.id, oid)).limit(1);
      if (!offChk || (offChk.universityId && offChk.universityId !== ud)) { skipped += 0; continue; }
    }
    const res = await withUserRls(me.id, tx => tx.update(enrollments)
      .set({ status: 'DROPPED', enrolledByUserId: me.id, enrollOverrideReason: String(reason || '').trim() || null })
      .where(and(inArray(enrollments.studentId, sids), eq(enrollments.offeringId, oid), eq(enrollments.status, 'REGISTERED'),
        ud ? eq(enrollments.universityId, ud) : sql`1 = 1`))
      .returning({ id: enrollments.id }));
    dropped += res.length;
    await db.update(course_offerings).set({ enrolledCount: sql`GREATEST(${course_offerings.enrolledCount} - ${res.length}, 0)` })
      .where(and(eq(course_offerings.id, oid), ud ? eq(course_offerings.universityId, ud) : sql`1 = 1`));
  }
  return { ok: true, dropped, skipped };
}

// ─────────────── تاریخچهٔ (پیگیری کی/چرا) ───────────────
export async function manualEnrollHistory(limit = 50): Promise<{
  ok: boolean; items?: {
    id: number; studentCode: string; studentName: string; courseCode: string; courseTitle: string; groupNumber: number;
    termTitle: string; who: string; when: string | null; override: boolean; reason: string | null;
  }[]; error?: string;
}> {
  try { await requireRole(EDU); } catch { return { ok: false, error: 'دسترسی ندارید.' }; }
  const u = await uniId();
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = await db
    .select({
      id: enrollments.id, studentCode: students.studentCode,
      studentFirstName: users.firstName, studentLastName: users.lastName,
      courseCode: courses.code, courseTitle: courses.title, groupNumber: course_offerings.groupNumber,
      termTitle: academic_terms.title, whoId: enrollments.enrolledByUserId,
      createdAt: enrollments.registeredAt, override: enrollments.enrollOverride, reason: enrollments.enrollOverrideReason,
    })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(users, eq(users.id, students.userId))
    .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .innerJoin(academic_terms, eq(academic_terms.id, course_offerings.termId))
    .where(and(sql`${enrollments.enrolledByUserId} IS NOT NULL`, u ? eq(enrollments.universityId, u) : sql`1 = 0`))
    .orderBy(desc(enrollments.id)).limit(lim);
  const whoIds = [...new Set(rows.map(r => r.whoId).filter((n): n is number => typeof n === 'number'))];
  const whoName = new Map<number, string>();
  if (whoIds.length) {
    const ws = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(users.id, whoIds));
    for (const w of ws) whoName.set(w.id, `${w.firstName || ''} ${w.lastName || ''}`.trim() || `کاربر ${w.id}`);
  }
  const items = rows.map(r => ({
    id: r.id, studentCode: r.studentCode, studentName: `${r.studentFirstName || ''} ${r.studentLastName || ''}`.trim(),
    courseCode: r.courseCode, courseTitle: r.courseTitle, groupNumber: r.groupNumber, termTitle: r.termTitle,
    who: r.whoId ? (whoName.get(r.whoId) ?? '—') : '—',
    when: r.createdAt ? (r.createdAt as Date).toISOString() : null,
    override: (r.override ?? 0) === 1, reason: r.reason,
  }));
  return { ok: true, items };
}

void getSessionUser; void offering_professors; // (import refs نگه‌داری می‌شوند تا از حذف ناخواسته جلوگیری شود)

// ─────────────── فعال‌سازی ترم به‌ازای دانشجویان (فردی/گروهی، با دامنه) ───────────────
/** فعال/غیرفعال کردن دانشجویانِ فیلتر در یک ترم (student_term_states) — با ردیابی */
export async function activateTermForFilter(
  f: BulkFilter, active: boolean,
): Promise<{ ok: boolean; error?: string; updated?: number; total?: number }> {
  const me = await requireRole(EDU);
  const tid = Number(f.termId);
  const [term] = await db.select({ id: academic_terms.id, termCode: academic_terms.termCode, universityId: academic_terms.universityId })
    .from(academic_terms).where(eq(academic_terms.id, tid)).limit(1);
  if (!term) return { ok: false, error: 'ترم یافت نشد.' };
  const u0 = await uniId();
  if (u0 && term.universityId && term.universityId !== u0) return { ok: false, error: 'این ترم متعلق به دانشگاه دیگری است.' };
  if (u0 && term.universityId == null) return { ok: false, error: 'دانشگاه ترم نامشخص است.' };
  const sids = await bulkStudentIds(f);
  if (!sids.length) return { ok: false, error: 'هیچ دانشجویی با این فیلتر پیدا نشد.' };

  let updated = 0;
  for (const sid of sids) {
    await withUserRls(me.id, tx => tx.insert(student_term_states).values({
      studentId: sid, termId: tid, termCode: term.termCode,
      statusCode: active ? 'ACTIVE' : 'INACTIVE',
      statusTitle: active ? 'فعال در ترم' : 'غیرفعال در ترم',
      activatedByUserId: me.id, activatedAt: new Date(),
      universityId: term.universityId ?? null,
    }).onConflictDoUpdate({
      target: [student_term_states.studentId, student_term_states.termId],
      set: {
        statusCode: active ? 'ACTIVE' : 'INACTIVE',
        statusTitle: active ? 'فعال در ترم' : 'غیرفعال در ترم',
        activatedByUserId: me.id, activatedAt: new Date(),
      },
    }));
    updated++;
  }
  return { ok: true, updated, total: sids.length };
}

// ─────────────── تشخیص تداخل (هفتگی/امتحانی) — ثبت بر اساس حکم شورا ───────────────
function toMin(hhmm: string): number { const [h, m] = String(hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function rangesOverlap(a: string, b: string, c: string, d: string): boolean { return toMin(a) < toMin(d) && toMin(c) < toMin(b); }

interface SchedLike { dayOfWeek: number | null; startTime: string | null; endTime: string | null; examDate: string | null; }

/**
 * برای یک دانشجو در یک ترم: ایندکسِ تداخل هر ارائه با بقیهٔ ارائه‌های ثبت‌شده‌اش.
 * تداخل هفتگی: همان روز + بازهٔ زمانی همپوشان کلاس.
 * تداخل امتحانی: همان تاریخ امتحان + زمان همپوشان.
 */
async function buildConflictIndex(studentId: number, termId: number): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  const enrolledRows = await db
    .select({ offeringId: enrollments.offeringId, title: courses.title })
    .from(enrollments)
    .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(eq(enrollments.studentId, studentId), eq(course_offerings.termId, termId),
      inArray(enrollments.status, ['REGISTERED', 'WAITLISTED', 'PENDING_COUNCIL'])));
  const enrolledOffIds = enrolledRows.map(r => r.offeringId).filter((n): n is number => typeof n === 'number');
  if (!enrolledOffIds.length) return out;

  const schedRows = await db
    .select({
      offeringId: schedules.offeringId, dayOfWeek: schedules.dayOfWeek,
      startTime: schedules.startTime, endTime: schedules.endTime, examDate: schedules.examDate,
    })
    .from(schedules)
    .where(and(inArray(schedules.offeringId, enrolledOffIds), inArray(schedules.scheduleType, ['CLASS', 'EXAM'])));
  const byOff = new Map<number, SchedLike[]>();
  for (const s of schedRows) {
    const arr = byOff.get(s.offeringId) ?? [];
    arr.push({ dayOfWeek: s.dayOfWeek, startTime: (s.startTime as unknown as string) ?? null, endTime: (s.endTime as unknown as string) ?? null, examDate: s.examDate as unknown as string | null ?? null });
    byOff.set(s.offeringId, arr);
  }
  const titleBy = new Map(enrolledRows.map(r => [r.offeringId, r.title]));
  // ارائهٔ هدف یعنی هر ارائهای که در همین کوئری به‌عنوان «موازی» با یک ارائهٔ دیگر مقایسه میشود
  const offIds = [...byOff.keys()];
  for (let i = 0; i < offIds.length; i++) {
    for (let j = i + 1; j < offIds.length; j++) {
      const a = byOff.get(offIds[i])!, b = byOff.get(offIds[j])!;
      const aTitle = titleBy.get(offIds[i]) ?? `درس ${offIds[i]}`;
      const bTitle = titleBy.get(offIds[j]) ?? `درس ${offIds[j]}`;
      // هفتگی
      for (const sa of a) for (const sb of b) {
        if (sa.dayOfWeek != null && sb.dayOfWeek != null && sa.dayOfWeek === sb.dayOfWeek && sa.startTime && sb.startTime && sa.endTime && sb.endTime) {
          if (rangesOverlap(sa.startTime, sa.endTime, sb.startTime, sb.endTime)) {
            push(out, offIds[i], `تداخل هفتگی با «${bTitle}» (روز ${sa.dayOfWeek})`);
            push(out, offIds[j], `تداخل هفتگی با «${aTitle}» (روز ${sa.dayOfWeek})`);
          }
        }
      }
      // امتحانی
      for (const ea of a) for (const eb of b) {
        if (ea.examDate && eb.examDate && ea.examDate === eb.examDate && ea.startTime && eb.startTime) {
          push(out, offIds[i], `تداخل امتحانی با «${bTitle}» (${ea.examDate})`);
          push(out, offIds[j], `تداخل امتحانی با «${aTitle}» (${ea.examDate})`);
        }
      }
    }
  }
  return out;
}

function push(m: Map<number, string[]>, k: number, v: string) {
  const arr = m.get(k) ?? [];
  arr.push(v);
  m.set(k, arr);
}

// ─────────────── اخطارهای آیین‌نامه برای کارشناس (مشروطی/سنوات/مالی/…) ───────────────
import { evaluateStudentRegulationStatus } from '@/lib/regulations-engine';

export interface StudentWarning { code: string; level: 'block' | 'warn'; title: string; detail: string; }

/** اخطارهای قابلتوجه برای انتخاب واحد یک دانشجو — همگام با موتور آیین‌نامه */
export async function getStudentWarnings(studentId: number, termId: number): Promise<{
  ok: boolean; items?: StudentWarning[]; error?: string;
}> {
  try { await requireRole(EDU); } catch { return { ok: false, error: 'دسترسی ندارید.' }; }
  const sid = Number(studentId), tid = Number(termId);
  const items: StudentWarning[] = [];
  const [stu] = await db.select().from(students).where(eq(students.id, sid)).limit(1);
  if (!stu) return { ok: false, error: 'دانشجو یافت نشد.' };
  const u = await uniId();
  if (u && stu.universityId && stu.universityId !== u) return { ok: false, error: 'این دانشجو از دانشگاه دیگری است.' };
  if (u && stu.universityId == null) return { ok: false, error: 'دانشگاه دانشجو نامشخص است.' };
  const _eff0 = await currentExpertFilters().catch(() => null);
  const _maj0 = await scopedMajorIds(_eff0, u).catch(() => null);
  if (_maj0 && !_maj0.includes(stu.majorId ?? -1)) return { ok: false, error: 'این دانشجو در محدودهٔ دسترسی شما نیست.' };

  // ① وضعیت پرونده
  if (stu.status) {
    const mapTitle: Record<string, string> = { PROBATION: 'مشروط', BLOCKED_COMMISSION: 'مسدود (کمیسیون)', DROPPED: 'انصرافی', GRADUATED: 'فارغ‌التحصیل', NO_SHOW: 'NO_SHOW' };
    if (stu.status === 'BLOCKED_COMMISSION') items.push({ code: 'status_blocked', level: 'block', title: 'مسدود', detail: 'پروندهٔ دانشجو برای کمیسیون مسدود است.' });
    else if (stu.status === 'PROBATION') items.push({ code: 'status_probation', level: 'warn', title: 'مشروط', detail: 'دانشجو در وضعیت مشروط است.' });
  }

  // ② سنوات / مشروطیت (موتور آیین‌نامه)
  try {
    const summary = await evaluateStudentRegulationStatus(sid);
    const cfg = summary.rulesConfig;
    const maxProb = (cfg.probation_and_tenure?.max_total_probations ?? 3) + (stu.extraAllowedProbations ?? 0);
    const maxSem = (cfg.probation_and_tenure?.max_study_semesters ?? 8) + (stu.extraAllowedSemesters ?? 0) - (summary.equivalenceSemesters ?? 0);
    if (summary.totalProbations >= maxProb) {
      items.push({ code: 'probation_limit', level: 'block', title: 'سقف مشروطیت', detail: `${summary.totalProbations} ترم مشروطی از سقف ${maxProb} ترم — ادامهٔ تحصیل نیازمند کمیسیون است.` });
    }
    if (summary.completedSemesters >= maxSem) {
      items.push({ code: 'tenure_limit', level: 'block', title: 'پایان سنوات', detail: `${summary.completedSemesters} ترم از سقف ${maxSem} ترم — نیازمند سنوات ارفاقی.` });
    }
  } catch { /* موتور در دسترس نیست */ }

  // ③ مالی (تسویه/بدهی)
  try {
    const [clear] = await db.select({ isCleared: financial_clearances.isCleared }).from(financial_clearances)
      .where(and(eq(financial_clearances.studentId, sid), eq(financial_clearances.termId, tid))).limit(1);
    if (!clear || (clear.isCleared ?? 0) !== 1) {
      items.push({ code: 'not_settled', level: 'warn', title: 'تسویهٔ ترم', detail: 'تسویهٔ مالی این ترم ثبت نشده است.' });
    }
  } catch { /* ignore */ }

  return { ok: true, items };
}

/** کدهای اخطار برای ثبت «مجوز» — وقتی override فعال است چه چیزهایی نادیده گرفته میشود */
async function warningCodesFor(sid: number, tid: number): Promise<string[]> {
  const w = await getStudentWarnings(sid, tid).catch(() => ({ items: [] as StudentWarning[] }));
  return (w.items ?? []).map(x => x.code);
}

/** منطق گیت «حکم شورا»: تداخل داریم؛ اگر نادیده نگرفتیم رد کن */
function councilGate(conflicts: string[] | undefined, override: boolean): string | null {
  if (!conflicts || !conflicts.length) return null;
  if (!override) return `درس با برنامهٔ دانشجو تداخل دارد — برای ثبت «بر اساس حکم شورا» باید نادیده‌گرفتن+دلیل فعال باشد. (${conflicts[0]})`;
  return null;
}

// ─────────────── کاتالوگِ همان دانشجو (راهنمای کارشناس) ───────────────
// مانند «انتخاب واحد» خودِ دانشجو: چارت+ارائه‌ها+پیش‌نیازها را نشان می‌دهد
// تا کارشناس مثل خودِ دانشجو درس‌ها را ببیند و انتخاب کند.

export interface CatalogOffering extends ManualEnrollOffering {
  courseId: number;
  /** آیا این درس در ترمِ انتخابی واقعاً ارائه شده است؟ (false = فقط در چارت هست، ارائه ندارد) */
  offered: boolean;
  alreadyEnrolled: boolean;
  /** اگر در این ترم ثبت شده، شناسهٔ ثبت‌نام و وضعیتش (برای حذف/اصلاح) */
  enrollmentId: number | null;
  enrollmentStatus: string | null;
  prereq: string | null;
  /** پیش‌نیازِ برآورده‌نشدهٔ این درس (اگر ناقص باشد) */
  prereqMissing: string | null;
  conflicts: string[];
  /** دامنهٔ درس برای این دانشجو: چارتِ رشته · مشترک/عمومی · خارج از چارت */
  scope: 'chart' | 'common' | 'other';
}

/** درسِ ثبت‌شدهٔ فعلی دانشجو در یک ترم — برای نمایش و حذف/اصلاح توسط کارشناس */
export interface StudentTermEnrollment {
  enrollmentId: number;
  offeringId: number;
  courseId: number;
  code: string;
  title: string;
  groupNumber: number;
  units: number | null;
  status: string;
  professorName: string;
  registeredAt: string | null;
  override: boolean;
}

export interface CatalogResult {
  ok: boolean;
  items?: CatalogOffering[];
  error?: string;
  /** درس‌های ثبت‌شدهٔ فعلی دانشجو در این ترم (برای اصلاح/حذف) */
  enrolled?: StudentTermEnrollment[];
  /** خلاصهٔ فیلتر چارت و سقف واحد — برای نمایش بالای کاتالوگ */
  chart?: {
    versionCode: string | null; title: string | null;
    chartCount: number; commonCount: number; otherCount: number; message?: string;
    /** سقف واحد آیین‌نامه‌ای و جمع ثبت‌شده — برای هشدار سقف */
    effectiveMaxUnits: number | null; currentUnits: number;
  };
  /** تعداد درس‌های چارتی که در ترمِ جاری واقعاً ارائه شده‌اند */
  chartOfferedCount?: number;
  /** تعداد کل درس‌های چارتی رشتهٔ دانشجو */
  chartTotalCount?: number;
}

/**
 * کاتالوگِ همان دانشجو برای کارشناس — مثل «انتخاب واحد» خودِ دانشجو:
 *   ۱) ارائه‌هایی که در «چارت/برنامهٔ درسی» رشتهٔ دانشجو هستند (scope='chart')
 *   ۲) دروس مشترک/عمومیِ قابل‌انتخاب برای همه (گروه GENERAL یا offeringScope خدماتی) (scope='common')
 *   ۳) بقیهٔ ارائه‌های ترم (خارج از چارت) — برای تخطی آگاهانه (scope='other')
 * جست‌وجوی کد/نام درس هم سمت سرور اعمال می‌شود.
 */
export async function getStudentCatalog(
  studentId: number,
  termId: number,
  opts?: { q?: string },
): Promise<CatalogResult> {
  try { await requireRole(EDU); } catch { return { ok: false, error: 'دسترسی ندارید.' }; }
  const sid = Number(studentId), tid = Number(termId);
  if (!Number.isInteger(sid) || !Number.isInteger(tid)) return { ok: false, error: 'اطلاعات نامعتبر.' };
  const [stu] = await db.select().from(students).where(eq(students.id, sid)).limit(1);
  if (!stu) return { ok: false, error: 'دانشجو یافت نشد.' };
  const u = await uniId();
  if (u && stu.universityId && stu.universityId !== u) return { ok: false, error: 'این دانشجو از دانشگاه دیگری است.' };
  if (u && stu.universityId == null) return { ok: false, error: 'دانشگاه دانشجو نامشخص است.' };
  const _effC = await currentExpertFilters().catch(() => null);
  const _majC = await scopedMajorIds(_effC, u).catch(() => null);
  if (_majC && !_majC.includes(stu.majorId ?? -1)) return { ok: false, error: 'این دانشجو در محدودهٔ دسترسی شما نیست.' };

  // ── ۱) چارتِ رشتهٔ دانشجو: courseIdهای نسخهٔ قابل‌اعمال ──
  const chartCourseIds = new Set<number>();
  let chart: NonNullable<CatalogResult['chart']> = { versionCode: null, title: null, chartCount: 0, commonCount: 0, otherCount: 0, effectiveMaxUnits: null, currentUnits: 0 };
  let chartMessage: string | undefined;
  try {
    const res = await resolveStudentCurriculum(sid);
    if (res.version) {
      const cc = await db.select({ courseId: curriculum_courses.courseId })
        .from(curriculum_courses).where(eq(curriculum_courses.curriculumVersionId, res.version.id));
      for (const r of cc) chartCourseIds.add(r.courseId);
      chart = { ...chart, versionCode: res.version.versionCode, title: res.version.title };
    } else {
      chartMessage = resolutionReasonMessage(res.reason);
    }
  } catch { chartMessage = 'چارت این دانشجو قابل محاسبه نیست.'; }

  // ── ۲) دروس مشترک/عمومی: گروه GENERAL یا offeringScope خدماتی/سراسری ──
  const enrolled = await db.select({
    courseId: courses.id, enrollmentId: enrollments.id, status: enrollments.status,
  })
    .from(enrollments)
    .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(eq(enrollments.studentId, sid), eq(course_offerings.termId, tid),
      inArray(enrollments.status, ['REGISTERED', 'WAITLISTED', 'PENDING_COUNCIL'])));
  const takenCourseIds = new Set(enrolled.map(e => e.courseId));
  const enrollByCourse = new Map(enrolled.map(e => [e.courseId, { enrollmentId: e.enrollmentId, status: e.status } as const]));

  const q = String(opts?.q || '').trim();
  const rows = await db.select({
    offeringId: course_offerings.id, courseId: courses.id, code: courses.code, title: courses.title,
    groupNumber: course_offerings.groupNumber, units: courses.units, capacity: course_offerings.capacity,
    enrolledCount: course_offerings.enrolledCount, professorId: course_offerings.professorId,
    offeringScope: courses.offeringScope, deptKind: departments.kind,
  })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .leftJoin(departments, eq(departments.id, courses.departmentId))
    .where(and(eq(course_offerings.termId, tid), eq(course_offerings.isActive, 1),
      u ? eq(course_offerings.universityId, u) : sql`1 = 0`))
    .orderBy(asc(courses.title), asc(course_offerings.groupNumber))
    .limit(4000);

  const isCommon = (r: { offeringScope: string | null; deptKind: string | null }) =>
    r.deptKind === 'GENERAL' || r.offeringScope === 'GENERAL_SERVICE' || r.offeringScope === 'UNIVERSITY_WIDE';

  const profIds = [...new Set(rows.map(r => r.professorId).filter((n): n is number => typeof n === 'number'))];
  const profName = new Map<number, string>();
  if (profIds.length) {
    const ps = await db.select({ id: staff.id, firstName: users.firstName, lastName: users.lastName })
      .from(staff).innerJoin(users, eq(users.id, staff.userId)).where(inArray(staff.id, profIds));
    for (const p of ps) profName.set(p.id, `${p.firstName || ''} ${p.lastName || ''}`.trim());
  }

  const prereqCtx = await buildPrereqContext(sid).catch(() => null);
  const conflictIndex = await buildConflictIndex(sid, tid);

  // ── سقف واحد آیین‌نامه‌ای + جمع ثبت‌شده (برای هشدار سقف در کاتالوگ) ──
  let effectiveMaxUnits: number | null = null;
  let currentUnits = 0;
  try {
    const regSummary = await evaluateStudentRegulationStatus(sid, tid);
    effectiveMaxUnits = regSummary.effectiveMaxUnits;
  } catch { effectiveMaxUnits = null; }
  const enrollRowsFull = await db.select({ units: courses.units, status: enrollments.status })
    .from(enrollments)
    .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(eq(enrollments.studentId, sid), eq(course_offerings.termId, tid),
      inArray(enrollments.status, ['REGISTERED', 'PENDING_COUNCIL'])));
  for (const r of enrollRowsFull) currentUnits += Number(r.units || 0);

  // ── فهرست درس‌های ثبت‌شدهٔ فعلی (برای نمایش/حذف/اصلاح توسط کارشناس) ──
  const enrolledDetail = await db.select({
    enrollmentId: enrollments.id, offeringId: enrollments.offeringId, courseId: courses.id,
    code: courses.code, title: courses.title, groupNumber: course_offerings.groupNumber,
    units: courses.units, status: enrollments.status, professorId: course_offerings.professorId,
    registeredAt: enrollments.registeredAt, override: enrollments.enrollOverride,
  })
    .from(enrollments)
    .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(eq(enrollments.studentId, sid), eq(course_offerings.termId, tid),
      inArray(enrollments.status, ['REGISTERED', 'WAITLISTED', 'PENDING_COUNCIL'])))
    .orderBy(asc(courses.title));
  const enrProfIds = [...new Set(enrolledDetail.map(r => r.professorId).filter((n): n is number => typeof n === 'number'))];
  const enrProfName = new Map<number, string>();
  if (enrProfIds.length) {
    const ps = await db.select({ id: staff.id, firstName: users.firstName, lastName: users.lastName })
      .from(staff).innerJoin(users, eq(users.id, staff.userId)).where(inArray(staff.id, enrProfIds));
    for (const p of ps) enrProfName.set(p.id, `${p.firstName || ''} ${p.lastName || ''}`.trim());
  }
  const enrolledList: StudentTermEnrollment[] = enrolledDetail.map(r => ({
    enrollmentId: r.enrollmentId, offeringId: r.offeringId, courseId: r.courseId,
    code: r.code, title: r.title, groupNumber: r.groupNumber,
    units: r.units == null ? null : Number(r.units), status: r.status,
    professorName: (r.professorId != null && enrProfName.get(r.professorId)) || '—',
    registeredAt: r.registeredAt ? (r.registeredAt as Date).toISOString() : null,
    override: (r.override ?? 0) === 1,
  }));

  let chartCount = 0, commonCount = 0, otherCount = 0;
  const items: CatalogOffering[] = [];
  for (const r of rows) {
    const scope: CatalogOffering['scope'] = chartCourseIds.has(r.courseId) ? 'chart' : (isCommon(r) ? 'common' : 'other');
    if (scope === 'chart') chartCount++; else if (scope === 'common') commonCount++; else otherCount++;
    if (q) {
      const hay = `${r.code} ${r.title}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) continue;
    }
    // پیش‌نیازِ ناقصِ این درس (برای نمایش/اعمال gate)
    let prereqMissing: string | null = null;
    if (prereqCtx) {
      const rule = prereqCtx.ruleByCourse.get(r.courseId);
      if (rule) {
        const ev = evaluateLogicTree(rule, prereqCtx.passed, prereqCtx);
        if (!ev.ok) prereqMissing = ev.missing.map(c => prereqCtx.titles.get(c) ?? c).join('، ');
      }
    }
    const enr = enrollByCourse.get(r.courseId);
    items.push({
      offeringId: r.offeringId, courseId: r.courseId, code: r.code, title: r.title, groupNumber: r.groupNumber,
      units: r.units == null ? null : Number(r.units), capacity: r.capacity,
      enrolledCount: r.enrolledCount ?? 0,
      professorName: (r.professorId != null && profName.get(r.professorId)) || '—',
      offered: true,
      alreadyEnrolled: takenCourseIds.has(r.courseId),
      enrollmentId: enr?.enrollmentId ?? null,
      enrollmentStatus: enr?.status ?? null,
      prereq: prereqCtx ? formatPrereq(prereqCtx.ruleByCourse.get(r.courseId), prereqCtx.titles) : null,
      prereqMissing,
      conflicts: conflictIndex.get(r.offeringId) ?? [],
      scope,
    });
  }

  // ── درس‌های چارتی که در این ترم ارائه نشده‌اند ──
  // کارشناس باید کل چارتِ دانشجو را ببیند (نه فقط ارائه‌شده‌های این ترم)؛
  // این‌ها با offeringId=0 و offered=false می‌آیند تا در UI غیرقابل انتخاب باشند.
  const chartTotalCount = chartCount;
  const offeredCourseIds = new Set(rows.map(r => r.courseId));
  const missingChartIds = [...chartCourseIds].filter(id => !offeredCourseIds.has(id));
  if (missingChartIds.length) {
    const missingRows = await db.select({ id: courses.id, code: courses.code, title: courses.title, units: courses.units })
      .from(courses).where(inArray(courses.id, missingChartIds)).orderBy(asc(courses.title)).limit(2000);
    for (const m of missingRows) {
      if (q) {
        const hay = `${m.code} ${m.title}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) continue;
      }
      let prereqMissing: string | null = null;
      if (prereqCtx) {
        const rule = prereqCtx.ruleByCourse.get(m.id);
        if (rule) {
          const ev = evaluateLogicTree(rule, prereqCtx.passed, prereqCtx);
          if (!ev.ok) prereqMissing = ev.missing.map(c => prereqCtx.titles.get(c) ?? c).join('، ');
        }
      }
      items.push({
        offeringId: 0, courseId: m.id, code: m.code, title: m.title, groupNumber: 0,
        units: m.units == null ? null : Number(m.units), capacity: 0, enrolledCount: 0,
        professorName: '—', offered: false,
        alreadyEnrolled: takenCourseIds.has(m.id),
        enrollmentId: enrollByCourse.get(m.id)?.enrollmentId ?? null,
        enrollmentStatus: enrollByCourse.get(m.id)?.status ?? null,
        prereq: prereqCtx ? formatPrereq(prereqCtx.ruleByCourse.get(m.id), prereqCtx.titles) : null,
        prereqMissing,
        conflicts: [],
        scope: 'chart',
      });
    }
  }

  return {
    ok: true, items, enrolled: enrolledList,
    chart: { ...chart, chartCount, commonCount, otherCount, message: chartMessage, effectiveMaxUnits, currentUnits },
    chartOfferedCount: chartCount,
    chartTotalCount,
  };
}