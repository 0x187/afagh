'use server';

// ════════════════════════════════════════════════════════════════════════
// فاز ۶ — Server Actions صفحهٔ برنامه‌ریزی درسی (Scheduling)
// ────────────────────────────────────────────────────────────────────────
// D3: الگوی استاندارد ماژول‌ها «Server Actions» است — هر اکشن:
//   ① requireRole مستقیم (گارد CI: audit-actions.mjs)
//   ② تراکنش اتمی + auditChain (زنجیرهٔ حسابرسی) در همان تراکنش
//   ③ خطاها: هرگز throw خام به Client نمی‌رود؛ { ok:false, error } فارسی.
//
// فاز ۶ = اتصال واقعی صفحه به موتور موجود + تولید جلسات واقعی از schedules.
// هیچ UI جدیدی ساخته نشده؛ فقط دادهٔ واقعی جایگزین Mock می‌شود.
// ════════════════════════════════════════════════════════════════════════

import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import {
  academic_terms, class_sessions, classrooms, course_offerings, courses, curriculum_courses, curriculum_versions, departments,
  degree_level_configs, enrollments, faculties, majors, offering_professors, schedules,
  professor_availabilities, scheduling_room_grants, staff, students, term_scheduling_states, users,
} from '@/db/schema';
import { requireRole, getStaffByUser } from '@/lib/auth';
import { headedDepartments } from '@/lib/group-manager';
import { getCurrentUniversity, isRealUniversityId, universityEq } from '@/lib/university-scope';
import { getSchedulingState, transitionSchedulingPhase, supplyGroupDrafts, allocateSections, allocateRoomQuotas, releaseRoomShift, borrowReleasedShift, getSmartSuggestions } from '@/lib/scheduling-engine';
import { runSchedulingHealthCheck, type HealthReport } from '@/lib/scheduling-health';
import { generateClassSessionsForTerm, getTermSessionsSummary, inspectSchedulingHardConflicts } from '@/lib/class-session-generator';
import { detectScheduleConflicts, jalaliDateOf, type RoomCapacityInfo, type ScheduleConflictInput } from '@/lib/scheduling-core';
// ستون‌های تاریخِ جلالی هرگز نباید با `new Date` پارس شوند — از این helper بخوانید.
import { normalizeExamDate } from '@/lib/shamsi';

const EDITORS = ['ADMIN', 'EDU_EXPERT'];
const MANAGERS = EDITORS;

// ─────────────────────────── helpers (غیر export — گارد CI) ───────────────────────────

/** نیمسال‌های واقعی (id/title) برای انتخاب‌گر بالای صفحه */
async function listRealTerms(universityId?: number) {
  return db
    .select({ id: academic_terms.id, code: academic_terms.termCode, title: academic_terms.title, isCurrent: academic_terms.isCurrent })
    .from(academic_terms)
    .where(uniOrGlobal(academic_terms.universityId, universityId))
    .orderBy(desc(academic_terms.id));
}

/**
 * دانشگاه فعال سرور — تنها مرجع دامنه.
 * شناسهٔ کلاینت پذیرفته نمی‌شود و شناسهٔ ۰ (DENY_UNI) به `undefined` تبدیل می‌شود
 * تا همهٔ کوئری‌ها با «۱ = ۰» fail-closed شوند (نه حذف فیلتر ⇒ دیدن همهٔ دانشگاه‌ها).
 */
async function serverUniId(): Promise<number | undefined> {
  const uni = await getCurrentUniversity().catch(() => null);
  return isRealUniversityId(uni?.id) ? uni.id : undefined;
}

/**
 * شرط «همین دانشگاه یا ردیف‌های عمومی (universityId = NULL)» برای ستون‌های nullable.
 * شناسهٔ نامعتبر (0/null/نامشخص) ⇒ `۱ = ۰`؛ هرگز شرط حذف نمی‌شود.
 */
function uniOrGlobal(column: any, universityId: number | undefined): any {
  return isRealUniversityId(universityId) ? or(eq(column, universityId), isNull(column)) : sql`1 = 0`;
}

/**
 * دامنهٔ «مدیر گروه» — فقط وقتی نقشش صرفاً DEP_HEAD است (نه ادمین/کارشناس آموزش).
 * در این حالت دادهٔ کارتابل برنامه‌ریزی به دروسِ گروه‌های تحت مدیریتش محدود می‌شود.
 * ادمین/کارشناس آموزش همیشه دامنهٔ کامل دارند (بدون تغییر رفتار قبلی).
 */
async function deptHeadScope(user: { id: number; roles: string[] }): Promise<{ isDeptHead: boolean; deptIds: number[] }> {
  const isEditor = user.roles.some(r => EDITORS.includes(r));
  const isHead = user.roles.includes('DEP_HEAD');
  if (!isHead || isEditor) return { isDeptHead: false, deptIds: [] };
  const st = await getStaffByUser(user.id).catch(() => null);
  if (!st) return { isDeptHead: true, deptIds: [] };
  const depts = await headedDepartments(st.id, st.departmentId ?? null).catch(() => []);
  return { isDeptHead: true, deptIds: depts.map(d => d.id) };
}

/** رشته‌ها = majors + دانشکده (فقط فعال) — فیلتر شده بر اساس universityId */
async function listRealPrograms(universityId?: number) {
  const majorWhere = and(eq(majors.isActive, 1), universityEq(majors.universityId, universityId));
  return db
    .select({
      id: majors.id,
      code: majors.majorCode,
      title: majors.name,
      facultyName: faculties.name,
      degreeLevel: degree_level_configs.title,
      facultyId: majors.facultyId,
      deptFacultyId: departments.facultyId,
      departmentId: majors.departmentId,
    })
    .from(majors)
    .leftJoin(degree_level_configs, eq(degree_level_configs.id, majors.degreeLevelId))
    .leftJoin(departments, eq(departments.id, majors.departmentId))
    .leftJoin(faculties, eq(faculties.id, majors.facultyId))
    .where(majorWhere);
}

/**
 * ورودی‌های واقعی دانشجویان (cohort) = (ورودی، تعداد).
 *
 * ⚠️ پیش‌تر: همهٔ دانشجویانِ دانشگاه از هر وضعیتی و هر سالی (تا ۱۳۹۰) شمرده
 * می‌شد؛ نتیجه فهرستی با ورودی‌های بی‌ربط و اعداد بادکرده بود. حالا فقط
 * دانشجویانِ ACTIVE و فقط سال‌های قابل برنامه‌ریزی (۸ سال اخیر) و — اگر
 * مدیرگروه باشد — فقط رشته‌های گروه خودش.
 */
async function listRealCohorts(universityId?: number, majorIds?: number[]) {
  const currentJy = Number(jalaliDateOf(new Date()).slice(0, 4)) || 1405;
  const conds = [
    universityEq(students.universityId, universityId),
    eq(students.status, 'ACTIVE'),
    gte(students.entryYear, currentJy - 8),
    lte(students.entryYear, currentJy + 1),
  ];
  if (majorIds && majorIds.length) conds.push(inArray(students.majorId, majorIds));
  const rows = await db
    .select({
      majorId: students.majorId,
      entryYear: students.entryYear,
      entryTerm: students.entryTerm,
      expectedStudents: sql<number>`count(*)::int`,
    })
    .from(students)
    .innerJoin(majors, eq(majors.id, students.majorId))
    .where(and(...conds))
    .groupBy(students.majorId, students.entryYear, students.entryTerm)
    .orderBy(desc(students.entryYear), desc(students.entryTerm));
  return rows.map(r => ({
    majorId: r.majorId ?? null,
    entryYear: r.entryYear,
    entryTerm: r.entryTerm ?? 1,
    expectedStudents: Number(r.expectedStudents),
  }));
}

/** سالن‌های واقعی — فیلتر شده بر اساس universityId */
async function listRealClassrooms(universityId?: number) {
  const where = universityEq(classrooms.universityId, universityId);
  return db
    .select({
      id: classrooms.id,
      name: classrooms.name,
      buildingName: classrooms.buildingName,
      capacity: classrooms.capacity,
      roomType: classrooms.roomType,
      isActive: classrooms.isActive,
      facultyId: classrooms.facultyId,
      facultyName: faculties.name,
    })
    .from(classrooms)
    .leftJoin(faculties, eq(faculties.id, classrooms.facultyId))
    .where(where);
}

/** استادان واقعی (staff + users + گروه) — فیلتر شده بر اساس universityId */
async function listRealProfessors(universityId?: number) {
  const where = and(eq(staff.isActive, 1), universityEq(staff.universityId, universityId));
  return db
    .select({
      id: staff.id,
      name: users.firstName,
      lastName: users.lastName,
      staffCode: staff.staffCode,
      academicRank: staff.academicRank,
      departmentId: staff.departmentId,
      departmentName: departments.name,
    })
    .from(staff)
    .innerJoin(users, eq(users.id, staff.userId))
    .leftJoin(departments, eq(departments.id, staff.departmentId))
    .where(where)
    .orderBy(staff.id);
}

/** تقاضای واقعی: درس‌های دارای offering در این ترم (با ظرفیت/گروه/استاد/رشتهٔ هدف) — فیلتر شده بر اساس universityId */
async function listRealDemands(termId: number, universityId?: number) {
  const uniFilter = universityEq(course_offerings.universityId, universityId);
  const rows = await db
    .select({
      offeringId: course_offerings.id,
      courseId: courses.id,
      courseDeptId: courses.departmentId,
      courseCode: courses.code,
      courseTitle: courses.title,
      units: courses.units,
      courseType: courses.courseType,
      capacity: course_offerings.capacity,
      groupNumber: course_offerings.groupNumber,
      professorId: course_offerings.professorId,
      enrolledCount: course_offerings.enrolledCount,
      targetMajorId: course_offerings.targetMajorId,
      targetMajorTitle: majors.name,
      entryYearStart: course_offerings.entryYearStart,
      entryYearEnd: course_offerings.entryYearEnd,
      isSharedService: course_offerings.isSharedService,
      offeringScope: courses.offeringScope,
    })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .leftJoin(majors, eq(majors.id, course_offerings.targetMajorId))
    .where(and(eq(course_offerings.termId, termId), uniFilter))
    .orderBy(courses.code);

  const profRows = await db
    .select({ offeringId: offering_professors.offeringId, staffId: offering_professors.staffId })
    .from(offering_professors)
    .innerJoin(course_offerings, eq(course_offerings.id, offering_professors.offeringId))
    .where(and(eq(course_offerings.termId, termId), uniFilter));

  // ⚠️ «دو استاد» فقط وقتی است که واقعاً دو (یا بیشتر) استاد روی ارائه باشد.
  // نسخهٔ قبلی هر ارائه‌ای را که *یک* ردیف در offering_professors داشت هم
  // دوـاستاد علامت می‌زد (`for (...) coTaught.add(...)`) — یعنی تقریباً همه.
  const profsByOffering = new Map<number, number[]>();
  for (const p of profRows) {
    const list = profsByOffering.get(p.offeringId) ?? [];
    if (!list.includes(p.staffId)) list.push(p.staffId);
    profsByOffering.set(p.offeringId, list);
  }

  // ورودی (cohort) واقعی: از دانشجویانِ ثبت‌نام‌شدهٔ همان ارائه خوانده می‌شود.
  // course_offerings.entryYearStart/End در عمل خالی است، پس تکیه بر آن همه را
  // «کلیهٔ ورودی‌ها» نشان می‌داد.
  const cohortRows = await db
    .select({ offeringId: enrollments.offeringId, entryYear: students.entryYear, entryTerm: students.entryTerm })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .where(and(eq(course_offerings.termId, termId), uniFilter))
    .groupBy(enrollments.offeringId, students.entryYear, students.entryTerm);
  const cohortsByOffering = new Map<number, { year: number; term: number }[]>();
  for (const c of cohortRows) {
    if (c.entryYear == null) continue;
    const list = cohortsByOffering.get(c.offeringId) ?? [];
    list.push({ year: Number(c.entryYear), term: Number(c.entryTerm ?? 1) });
    cohortsByOffering.set(c.offeringId, list);
  }

  // تاریخ امتحان واقعی از schedules (scheduleType='EXAM')
  const examRows = await db
    .select({ offeringId: schedules.offeringId, examDate: schedules.examDate })
    .from(schedules)
    .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
    .where(and(eq(course_offerings.termId, termId), eq(schedules.scheduleType, 'EXAM'), uniFilter));
  const examByOffering = new Map<number, string>();
  for (const e of examRows) {
    if (e.examDate) examByOffering.set(e.offeringId, String(e.examDate));
  }

  // ══ تفکیک «رشته به رشته» ══
  // یک گروه می‌تواند چند رشته داشته باشد و تابلو نمی‌تواند همهٔ دروس را
  // یک‌جا نشان دهد. targetMajorId روی اکثر ارائه‌ها خالی است، پس تعلق هر درس
  // به رشته از چارت درسی (curriculum_courses → curriculum_versions.majorId)
  // استخراج می‌شود. درسی که در هیچ چارتی نیست «مشترک» می‌ماند.
  const courseIds = Array.from(new Set(rows.map(r => r.courseId)));
  const majorsByCourse = new Map<number, number[]>();
  /** شمارهٔ ترم پیشنهادی چارت برای هر (درس، رشته) — برای «فاز ۰: رشته × ترم» */
  const semesterByCourseMajor = new Map<string, number>();
  if (courseIds.length) {
    const chartRows = await db
      .selectDistinct({
        courseId: curriculum_courses.courseId,
        majorId: curriculum_versions.majorId,
        semester: curriculum_courses.recommendedSemester,
      })
      .from(curriculum_courses)
      .innerJoin(curriculum_versions, eq(curriculum_versions.id, curriculum_courses.curriculumVersionId))
      .where(inArray(curriculum_courses.courseId, courseIds));
    for (const c of chartRows) {
      if (c.majorId == null) continue;
      const list = majorsByCourse.get(c.courseId) ?? [];
      if (!list.includes(c.majorId)) list.push(c.majorId);
      majorsByCourse.set(c.courseId, list);
      if (c.semester != null) {
        semesterByCourseMajor.set(`${c.courseId}:${c.majorId}`, Number(c.semester));
      }
    }
  }

  return rows.map(r => {
    const profs = profsByOffering.get(r.offeringId) ?? [];
    const isCoTaught = profs.length >= 2;
    // استادِ دومِ واقعی (اگر استاد اصلی در offering_professors نباشد، اولین نفر)
    const coProfId = isCoTaught ? (profs.find(id => id !== r.professorId) ?? profs[1]) : null;

    // «نیمسال ورود» (مهر/بهمن) به‌جای «ورودی سال» — منبع: students.entryYear/entryTerm
    const uniq = new Map<string, { year: number; term: number }>();
    for (const c of cohortsByOffering.get(r.offeringId) ?? []) {
      uniq.set(`${c.year}-${c.term}`, c);
    }
    const cohorts = [...uniq.values()].sort((a, b) => (b.year - a.year) || (b.term - a.term));
    let cohortId = 'ALL';
    let cohortTitle = 'کلیهٔ نیمسال‌های ورود';
    // تصمیمِ صریحِ ادغام (ستون‌های entryYearStart/End) بر استنتاج از ثبت‌نام اولویت دارد
    const explicitMerge = r.entryYearStart != null;
    if (explicitMerge) {
      const from = r.entryYearStart as number;
      const to = r.entryYearEnd ?? from;
      if (from === to) {
        cohortId = `${from}-ALL`;
        cohortTitle = `نیمسال ورود ${from} (ادغام مهر و بهمن)`;
      } else {
        cohortTitle = `نیمسال‌های ورود ${from}–${to} (ادغام‌شده)`;
      }
    } else if (cohorts.length === 1) {
      cohortId = `${cohorts[0].year}-${cohorts[0].term}`;
      cohortTitle = entryCohortTitle(cohorts[0].year, cohorts[0].term);
    } else if (cohorts.length === 2) {
      cohortTitle = `${entryCohortTitle(cohorts[0].year, cohorts[0].term)}، ${entryCohortTitle(cohorts[1].year, cohorts[1].term)}`;
    } else if (cohorts.length > 2) {
      cohortTitle = `نیمسال‌های ورود ${cohorts[cohorts.length - 1].year}–${cohorts[0].year}`;
    }

    const examRaw = examByOffering.get(r.offeringId);
    const progIds = r.targetMajorId != null ? [r.targetMajorId] : (majorsByCourse.get(r.courseId) ?? []);
    // ترمِ چارت: اول برای رشتهٔ هدف، بعد اولین رشته‌ای که ترم تعریف‌شده دارد
    let semesterNo: number | null = null;
    for (const pid of progIds) {
      const s = semesterByCourseMajor.get(`${r.courseId}:${pid}`);
      if (s != null) { semesterNo = s; break; }
    }
    // `schedules."examDate"` ستون `date` است ولی در این پروژه «برچسب جلالی»
    // نگه می‌دارد (`1405-11-03`). اگر آن را با `new Date(...)` پارس کنیم،
    // جاوااسکریپت سالِ ۱۴۰۵ را **میلادی** می‌فهمد و تبدیل به جلالی نتیجه را
    // به ۷۸۴ می‌برد (باگ گزارش‌شده: «۱۴۰۵ می‌شد ۷۸۴»).
    // `normalizeExamDate` هم `-` و هم `/` را می‌شناسد و سالِ کمتر از ۱۶۰۰ را
    // دست‌نخورده برمی‌گرداند — تنها نقطهٔ مجازِ خواندنِ این ستون.
    const examDateOut = normalizeExamDate(examRaw) ?? '';
    return {
      offeringId: r.offeringId,
      courseId: r.courseId,
      courseDeptId: r.courseDeptId,
      code: r.courseCode,
      title: r.courseTitle,
      units: String(r.units),
      // مقدار واقعی — دامنه باز است (تخصصي/پايه/اصلي/اختياري/…)
      courseType: r.courseType ?? '',
      capacity: r.capacity,
      groupNumber: r.groupNumber,
      professorId: r.professorId,
      isCoTaught,
      coProfId,
      enrolledCount: r.enrolledCount,
      programId: r.targetMajorId ?? 0,
      programTitle: r.targetMajorTitle ?? 'همهٔ رشته‌ها',
      programIds: progIds,
      semesterNo,
      cohortId,
      cohortTitle,
      cohortMerged: explicitMerge,
      examDate: examDateOut,
      isSharedService: r.isSharedService === 1,
      offeringScope: r.offeringScope ?? 'DEPARTMENTAL',
    };
  });
}

/** تقاضای مبتنی بر چارت درسی: درس‌های تعریف‌شده در curriculum_versions برای یک رشته/مقطع/ورودی */
async function listCurriculumDemands(termId: number, programId: number, universityId?: number, entryYear?: number | null) {
  // 1) پیدا کردن ترم و سال تحصیلی
  const [term] = await db.select().from(academic_terms).where(and(eq(academic_terms.id, termId), uniOrGlobal(academic_terms.universityId, universityId))).limit(1);
  if (!term) return [];

  // 2) پیدا کردن رشته (major)
  const [major] = await db.select().from(majors).where(and(eq(majors.id, programId), uniOrGlobal(majors.universityId, universityId))).limit(1);
  if (!major) return [];

  // 3) پیدا کردن نسخهٔ برنامه درسی منتشرشده/بایگانی‌شده برای این رشته و مقطع و سال ورودی
  // ورودی‌های متنوع وجود دارند؛ باید تمام ورودی‌های فعال را پوشش دهد
  // ⚠️ چارت بر اساس «سال ورودیِ دانشجو» انتخاب می‌شود، نه سال تحصیلیِ ترم.
  // چارت یک رشته در طول زمان عوض می‌شود؛ ممکن است برای ورودی ۱۴۰۱ یک نسخه و
  // برای ورودی ۱۴۰۳ نسخهٔ دیگر معتبر باشد. نسخهٔ قبلی با term.academicYear
  // مقایسه می‌کرد و عملاً همیشه یک نسخه (یا هیچ) برمی‌گرداند.
  const cvUniFilter = universityEq(curriculum_versions.universityId, universityId);
  const targetEntryYear = entryYear ?? term.academicYear ?? null;
  const cvBase = and(
    eq(curriculum_versions.majorId, programId),
    eq(curriculum_versions.degreeLevelId, major.degreeLevelId),
    cvUniFilter,
    sql`${curriculum_versions.status} in ('PUBLISHED','ARCHIVED')`,
  );
  let cvRows = targetEntryYear == null ? [] : await db
    .select({ id: curriculum_versions.id, from: curriculum_versions.entryYearFrom, to: curriculum_versions.entryYearTo })
    .from(curriculum_versions)
    .where(and(
      cvBase,
      sql`${targetEntryYear} between ${curriculum_versions.entryYearFrom} and coalesce(${curriculum_versions.entryYearTo}, 9999)`
    ))
    .orderBy(desc(curriculum_versions.entryYearFrom), desc(curriculum_versions.id))
    .limit(1);
  // اگر برای آن ورودی چارتی تعریف نشده باشد، آخرین چارت مصوب رشته می‌آید
  // تا صفحه خالی نماند (و UI صریحاً بگوید «چارت این ورودی تعریف نشده»).
  if (!cvRows.length) {
    cvRows = await db
      .select({ id: curriculum_versions.id, from: curriculum_versions.entryYearFrom, to: curriculum_versions.entryYearTo })
      .from(curriculum_versions)
      .where(cvBase)
      .orderBy(desc(curriculum_versions.entryYearFrom), desc(curriculum_versions.id))
      .limit(1);
  }

  if (!cvRows.length) return [];
  const curriculumVersionId = cvRows[0].id;

  // 4) درس‌های این نسخهٔ برنامه با ترم پیشنهادی (recommendedSemester)
  // ترم فعلی را به شماره ترم (semester) مپ کنیم
  // academic_terms.sortOrder یا termCode می‌تواند به semester مپ شود
  // برای سادگی: اگر termType='SUMMER' → semester=9، وگرنه بر اساس sortOrder محاسبه می‌شود
  let currentSemester = 1;
  if (term.isSummer === 1) {
    currentSemester = 9;
  } else if (term.sortOrder) {
    currentSemester = ((term.sortOrder - 1) % 2) + 1; // ساده‌سازی: زوج/فرد
  }

  const ccRows = await db
    .select({
      courseId: curriculum_courses.courseId,
      roleType: curriculum_courses.roleType,
      recommendedSemester: curriculum_courses.recommendedSemester,
      units: curriculum_courses.units,
    })
    .from(curriculum_courses)
    .where(and(
      eq(curriculum_courses.curriculumVersionId, curriculumVersionId),
      or(
        eq(curriculum_courses.recommendedSemester, currentSemester),
        sql`${curriculum_courses.recommendedSemester} is null`
      )
    ));

  if (!ccRows.length) return [];

  const courseIds = ccRows.map(r => r.courseId);

  // 5) ارائهٔ این درس‌ها در ترم جاری (course_offerings)
  const offerRows = await db
    .select({
      offeringId: course_offerings.id,
      courseId: courses.id,
      courseDeptId: courses.departmentId,
      courseCode: courses.code,
      courseTitle: courses.title,
      units: courses.units,
      courseType: courses.courseType,
      capacity: course_offerings.capacity,
      groupNumber: course_offerings.groupNumber,
      professorId: course_offerings.professorId,
      enrolledCount: course_offerings.enrolledCount,
      targetMajorId: course_offerings.targetMajorId,
      targetMajorTitle: majors.name,
      entryYearStart: course_offerings.entryYearStart,
      entryYearEnd: course_offerings.entryYearEnd,
      isSharedService: course_offerings.isSharedService,
      offeringScope: courses.offeringScope,
    })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .leftJoin(majors, eq(majors.id, course_offerings.targetMajorId))
    .where(and(
      eq(course_offerings.termId, termId),
      inArray(courses.id, courseIds),
      uniOrGlobal(course_offerings.universityId, universityId)
    ))
    .orderBy(courses.code);

  const profRows = await db
    .select({ offeringId: offering_professors.offeringId, staffId: offering_professors.staffId })
    .from(offering_professors)
    .innerJoin(course_offerings, eq(course_offerings.id, offering_professors.offeringId))
    .where(and(eq(course_offerings.termId, termId), inArray(course_offerings.id, offerRows.map(r => r.offeringId))));
  // «دو استاد» = حداقل دو استاد روی ارائه (نه هر ارائه‌ای که یک استاد دارد)
  const profsByOffering = new Map<number, number[]>();
  for (const p of profRows) {
    const list = profsByOffering.get(p.offeringId) ?? [];
    if (!list.includes(p.staffId)) list.push(p.staffId);
    profsByOffering.set(p.offeringId, list);
  }

  return offerRows.map(r => {
    const hasSingleEntryYear = r.entryYearStart != null && r.entryYearStart === r.entryYearEnd;
    const profs = profsByOffering.get(r.offeringId) ?? [];
    const isCoTaught = profs.length >= 2;
    return {
      offeringId: r.offeringId,
      courseId: r.courseId,
      courseDeptId: r.courseDeptId,
      code: r.courseCode,
      title: r.courseTitle,
      units: String(r.units),
      // مقدار واقعی (دامنه باز) — پیش‌تر هر چیزی که در فهرست بسته نبود «عمومی» می‌شد
      courseType: r.courseType ?? '',
      capacity: r.capacity,
      groupNumber: r.groupNumber,
      professorId: r.professorId,
      isCoTaught,
      coProfId: isCoTaught ? (profs.find(id => id !== r.professorId) ?? profs[1]) : null,
      enrolledCount: r.enrolledCount,
      programId: r.targetMajorId ?? 0,
      programTitle: r.targetMajorTitle ?? 'همهٔ رشته‌ها',
      cohortId: hasSingleEntryYear ? String(r.entryYearStart) : 'ALL',
      cohortTitle: hasSingleEntryYear ? `ورودی ${r.entryYearStart}` : 'کلیهٔ ورودی‌ها',
      examDate: '',
      isSharedService: r.isSharedService === 1,
      offeringScope: r.offeringScope ?? 'DEPARTMENTAL',
    };
  });
}

const hm = (t: unknown) => (t == null ? '' : String(t).slice(0, 5));

/** برچسب «نیمسال ورود» — ۱=مهر، ۲=بهمن، ۳=تابستان (students.entryTerm) */
const ENTRY_TERM_NAMES: Record<number, string> = { 1: 'مهر', 2: 'بهمن', 3: 'تابستان' };
const entryCohortTitle = (year: number, term: number | null | undefined) =>
  term && ENTRY_TERM_NAMES[term]
    ? `نیمسال ورود ${ENTRY_TERM_NAMES[term]} ${year}`
    : `نیمسال ورود ${year}`;

/** برنامهٔ مصوب واقعی: سطرهای schedules با scheduleType='CLASS' + جزئیات درس/استاد/سالن — فیلتر شده بر اساس universityId */
async function listApprovedOfferings(termId: number, universityId?: number) {
  const uniFilter = universityEq(course_offerings.universityId, universityId);
  const rows = await db
    .select({
      offeringId: course_offerings.id,
      code: courses.code,
      title: courses.title,
      units: courses.units,
      courseType: courses.courseType,
      groupNumber: course_offerings.groupNumber,
      professorId: course_offerings.professorId,
      profFirstName: users.firstName,
      profLastName: users.lastName,
      capacity: course_offerings.capacity,
      enrolledCount: course_offerings.enrolledCount,
      dayOfWeek: schedules.dayOfWeek,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
      roomId: schedules.roomId,
      roomName: classrooms.name,
      buildingName: classrooms.buildingName,
    })
    .from(schedules)
    .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .leftJoin(staff, eq(staff.id, course_offerings.professorId))
    .leftJoin(users, eq(users.id, staff.userId))
    .leftJoin(classrooms, eq(classrooms.id, schedules.roomId))
    .where(and(eq(schedules.scheduleType, 'CLASS'), eq(course_offerings.termId, termId), sql`${schedules.dayOfWeek} is not null`, uniFilter))
    .orderBy(courses.code, course_offerings.groupNumber);

  return rows.map(r => ({
    offeringId: r.offeringId,
    code: r.code,
    title: r.title,
    units: String(r.units),
    courseType: r.courseType ?? '',
    groupNumber: r.groupNumber,
    professorId: r.professorId,
    professorName: r.profFirstName ? `${r.profFirstName} ${r.profLastName ?? ''}`.trim() : 'تخصیص‌نیافته',
    capacity: r.capacity,
    enrolledCount: r.enrolledCount,
    dayOfWeek: r.dayOfWeek,
    dayName: ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'][r.dayOfWeek ?? -1] ?? '—',
    startTime: hm(r.startTime),
    endTime: hm(r.endTime),
    roomId: r.roomId,
    roomName: r.roomName ?? '—',
    buildingName: r.buildingName ?? '—',
  }));
}

/** درخواست‌های جلسهٔ جبرانی واقعی (class_sessions.isMakeUpSession = 1) — فیلتر شده بر اساس universityId */
async function listMakeupSessions(termId: number, universityId?: number) {
  const uniFilter = universityEq(course_offerings.universityId, universityId);
  const rows = await db
    .select({
      id: class_sessions.id,
      offeringId: class_sessions.offeringId,
      courseCode: courses.code,
      courseTitle: courses.title,
      profFirstName: users.firstName,
      profLastName: users.lastName,
      sessionNo: class_sessions.sessionNo,
      sessionDate: class_sessions.sessionDate,
      startTime: class_sessions.startTime,
      endTime: class_sessions.endTime,
      replacedSessionId: class_sessions.replacedSessionId,
    })
    .from(class_sessions)
    .innerJoin(course_offerings, eq(course_offerings.id, class_sessions.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .leftJoin(staff, eq(staff.id, course_offerings.professorId))
    .leftJoin(users, eq(users.id, staff.userId))
    .where(and(eq(class_sessions.isMakeUpSession, 1), eq(course_offerings.termId, termId), uniFilter))
    .orderBy(class_sessions.sessionDate);

  return rows.map(r => ({
    id: r.id,
    offeringId: r.offeringId,
    courseCode: r.courseCode,
    courseTitle: r.courseTitle,
    profName: r.profFirstName ? `${r.profFirstName} ${r.profLastName ?? ''}`.trim() : '—',
    sessionNo: r.sessionNo ?? 0,
    sessionDate: r.sessionDate,
    sessionTime: `${hm(r.startTime)} تا ${hm(r.endTime)}`,
    replacedSessionId: r.replacedSessionId,
  }));
}

/** سالن‌هایی که در این ترم سهمیهٔ ALLOCATED دارند — فیلتر شده بر اساس universityId */
async function listAllocatedRoomIds(termId: number, universityId?: number) {
  const uniFilter = universityEq(classrooms.universityId, universityId);
  const rows = await db
    .select({ classroomId: scheduling_room_grants.classroomId })
    .from(scheduling_room_grants)
    .innerJoin(classrooms, eq(classrooms.id, scheduling_room_grants.classroomId))
    .where(and(eq(scheduling_room_grants.termId, termId), eq(scheduling_room_grants.status, 'ALLOCATED'), uniFilter));
  return rows.map(r => r.classroomId);
}

/** سهمیهٔ سالن‌ها در این ترم (ALLOCATED/RELEASED) — برای مدیریت لغو/واگذاری */
async function listRoomGrants(termId: number, universityId?: number) {
  const uniFilter = universityEq(classrooms.universityId, universityId);
  const rows = await db
    .select({
      id: scheduling_room_grants.id,
      classroomId: scheduling_room_grants.classroomId,
      shift: scheduling_room_grants.shift,
      ownerDepartmentId: scheduling_room_grants.ownerDepartmentId,
      status: scheduling_room_grants.status,
    })
    .from(scheduling_room_grants)
    .innerJoin(classrooms, eq(classrooms.id, scheduling_room_grants.classroomId))
    .where(and(eq(scheduling_room_grants.termId, termId), uniFilter));
  return rows.map(r => ({
    id: r.id,
    classroomId: r.classroomId,
    shift: String(r.shift),
    ownerDepartmentId: r.ownerDepartmentId,
    status: String(r.status),
  }));
}

// ─────────────────────────── اکشن‌ها — Page Data ───────────────────────────

/** تایپ صریح نتیجهٔ کارتابل — برای narrowing صحیح در کلاینت
 *  ⚠️ این تایپ باید آینهٔ `SchedulingWorkspace` در `./types.ts` بماند؛
 *  اگر فیلدی به خروجی اضافه/حذف شد، هر دو جا هم‌زمان به‌روز شوند. */
export type SchedulingWorkspaceResult =
  | {
      ok: true;
      terms: { id: number; code: string; title: string; isCurrent: boolean }[];
      selectedTermId: number | null;
      programs: { id: number; code: string; title: string; facultyName: string; degreeLevel: string; facultyId: number | null }[];
      cohorts: { majorId: number | null; entryYear: number; entryTerm: number; expectedStudents: number }[];
      classrooms: { id: number; name: string; buildingName: string; capacity: number; roomType: string; isActive: number | null; facultyId: number | null; facultyName: string | null }[];
      allocatedRoomIds: number[];
      roomGrants: { id: number; classroomId: number; shift: string; ownerDepartmentId: number; status: string }[];
      departments: { id: number; name: string; departmentCode: string | null }[];
      availabilities: { staffId: number; dayOfWeek: number | null; startTime: string | null; endTime: string | null; status: string | null }[];
      professors: { id: number; name: string; staffCode: string | null; academicRank: string | null; departmentId: number | null; departmentName: string | null }[];
      demands: {
        offeringId: number; courseId: number; courseDeptId: number | null;
        code: string; title: string; units: string; courseType: string;
        capacity: number; groupNumber: number; professorId: number | null; isCoTaught: boolean;
        enrolledCount: number; programId: number; programTitle: string;
        cohortId: string; cohortTitle: string;
        isSharedService: boolean; offeringScope: string;
      }[];
      phases: Record<number, string>;
      termCalendar: { id: number; startJalali: string | null; endJalali: string | null; startDate: string | null } | null;
      sessionsTotal: number;
      sessionsByOffering: Record<number, { total: number; makeup: number; firstDate: string | null }>;
      hardConflictCount: number;
      approvedOfferings: {
        offeringId: number; code: string; title: string; units: string; courseType: string;
        groupNumber: number; professorId: number | null; professorName: string; capacity: number;
        enrolledCount: number; dayOfWeek: number | null; dayName: string; startTime: string;
        endTime: string; roomId: number | null; roomName: string; buildingName: string;
      }[];
      makeupSessions: {
        id: number; courseCode: string; courseTitle: string; profName: string;
        sessionNo: number; sessionDate: string; sessionTime: string; replacedSessionId: number | null;
      }[];
    }
  | { ok: false; error: string };

/** دادهٔ اولیهٔ واقعی صفحه (جایگزین INITIAL_* های Mock) */
export async function getSchedulingWorkspaceAction(termId?: number, _universityId?: number): Promise<SchedulingWorkspaceResult> {
  try {
    const actor = await requireRole([...EDITORS, 'DEP_HEAD']);
    const { isDeptHead, deptIds } = await deptHeadScope(actor);
    const uid = await serverUniId();
    // رشته‌های گروه‌های تحت مدیریت — برای محدود کردن فهرست ورودی‌ها
    let deptMajorIds: number[] | undefined;
    if (isDeptHead && deptIds.length) {
      const ownMajors = await db.select({ id: majors.id }).from(majors).where(inArray(majors.departmentId, deptIds));
      deptMajorIds = ownMajors.map(m => m.id);
    }
    const [terms, programRows, classrooms, professorsRaw, deptRows] = await Promise.all([
      listRealTerms(uid),
      listRealPrograms(uid),
      listRealClassrooms(uid),
      listRealProfessors(uid),
      db.select({ id: departments.id, name: departments.name, departmentCode: departments.departmentCode }).from(departments).where(uniOrGlobal(departments.universityId, uid)).orderBy(departments.name),
    ]);
    let professors = professorsRaw;
    // دامنهٔ مدیرگروه: فقط استادانِ دپارتمان‌های تحت مدیریتِ خودش را ببیند
    // (نه همهٔ استادان دانشگاه) — تا در «تخصیص درس» فقط استادان گروه خودش را انتخاب کند.
    if (isDeptHead && deptIds.length) {
      professors = professors.filter(p => p.departmentId != null && deptIds.includes(p.departmentId));
    }
    let programs = programRows;
    const resolvedTermId = termId ?? terms.find(t => t.isCurrent === 1)?.id ?? terms[0]?.id ?? null;

    let demands: Awaited<ReturnType<typeof listRealDemands>> = [];
    let phases: { termId: number; phase: string }[] = [];
    let termCalendar: { id: number; startJalali: string | null; endJalali: string | null; startDate: string | null } | null = null;
    let sessionsTotal = 0;
    let sessionsByOffering: Record<number, { total: number; makeup: number; firstDate: string | null }> = {};
    let hardConflictCount = 0;
    let cohorts: { majorId: number | null; entryYear: number; entryTerm: number; expectedStudents: number }[] = [];
    let approvedOfferings: Awaited<ReturnType<typeof listApprovedOfferings>> = [];
    let makeupSessions: Awaited<ReturnType<typeof listMakeupSessions>> = [];
    let allocatedRoomIds: number[] = [];
    let roomGrants: Awaited<ReturnType<typeof listRoomGrants>> = [];
    let availRows: { staffId: number; dayOfWeek: number | null; startTime: unknown; endTime: unknown; status: string | null }[] = [];

    if (resolvedTermId != null) {
      [demands, phases, cohorts, availRows] = await Promise.all([
        listRealDemands(resolvedTermId, uid),
        db.select({ termId: term_scheduling_states.termId, phase: term_scheduling_states.phase }).from(term_scheduling_states)
          .where(uniOrGlobal(term_scheduling_states.universityId, uid)),
        listRealCohorts(uid, deptMajorIds),
        db.select({
          staffId: professor_availabilities.staffId,
          dayOfWeek: professor_availabilities.dayOfWeek,
          startTime: professor_availabilities.startTime,
          endTime: professor_availabilities.endTime,
          status: professor_availabilities.status,
        }).from(professor_availabilities).where(and(
          or(eq(professor_availabilities.termId, resolvedTermId), sql`${professor_availabilities.termId} is null`),
          uniOrGlobal(professor_availabilities.universityId, uid),
        )),
      ]);
      const [inspect, term] = await Promise.all([
        inspectSchedulingHardConflicts(resolvedTermId),
        db.select().from(academic_terms).where(and(
          eq(academic_terms.id, resolvedTermId),
          uniOrGlobal(academic_terms.universityId, uid),
        )).limit(1).then(rows => rows[0] ?? null),
      ]);
      hardConflictCount = inspect.total;
      [approvedOfferings, makeupSessions, allocatedRoomIds, roomGrants] = await Promise.all([
        listApprovedOfferings(resolvedTermId, uid),
        listMakeupSessions(resolvedTermId, uid),
        listAllocatedRoomIds(resolvedTermId, uid),
        listRoomGrants(resolvedTermId, uid),
      ]);
      if (term) {
      // تقویم برنامه‌ریزی از «تعریف ترم» خوانده می‌شود، نه از اعداد پیش‌فرض UI
      // (قبلاً هفته‌ها همیشه ۱۶ و تاریخ‌ها خالی بود).
      termCalendar = {
        id: term.id,
        startJalali: term.startDate ? jalaliDateOf(term.startDate) : null,
        endJalali: term.endDate ? jalaliDateOf(term.endDate) : null,
        startDate: term.startDate ? term.startDate.toISOString() : null,
        weeksCount: term.weeksCount ?? null,
        classStartJalali: term.classStartDate ? jalaliDateOf(term.classStartDate) : (term.startDate ? jalaliDateOf(term.startDate) : null),
        classEndJalali: term.classEndDate ? jalaliDateOf(term.classEndDate) : (term.endDate ? jalaliDateOf(term.endDate) : null),
        examStartJalali: term.examStartDate ? jalaliDateOf(term.examStartDate) : null,
        examEndJalali: term.examEndDate ? jalaliDateOf(term.examEndDate) : null,
      } as any;
      }
      const summary = await getTermSessionsSummary(resolvedTermId);
      for (const s of summary) {
        sessionsTotal += s.total;
        sessionsByOffering[s.offeringId] = { total: s.total, makeup: s.makeup, firstDate: s.firstDate };
      }
    }

    // ── دامنهٔ مدیرگروه: فقط ارائههای دروسِ گروههای تحت مدیریتِ خودش ──
    // (ادمین/کارشناس آموزش: isDeptHead=false ⇒ هیچ فیلتری اعمال نمیشود)
    if (isDeptHead) {
      const allowed = new Set(deptIds);
      demands = demands.filter(d => d.courseDeptId != null && allowed.has(d.courseDeptId));
      const offIds = new Set(demands.map(d => d.offeringId));
      approvedOfferings = approvedOfferings.filter(o => offIds.has(o.offeringId));
      makeupSessions = makeupSessions.filter(m => offIds.has(m.offeringId));
      sessionsByOffering = Object.fromEntries(
        Object.entries(sessionsByOffering).filter(([k]) => offIds.has(Number(k))),
      ) as typeof sessionsByOffering;
      sessionsTotal = Object.values(sessionsByOffering).reduce((n, v) => n + (v?.total ?? 0), 0);
      // رشته‌ها هم فقط رشته‌های گروه‌های خودش — وگرنه انتخاب رشتهٔ دیگر، چارت
      // دانشگاه را در همین تابلو نشان می‌داد.
      const ownPrograms = programs.filter(p => p.departmentId != null && allowed.has(p.departmentId));
      if (ownPrograms.length) programs = ownPrograms;
    }

    return {
      ok: true,
      terms: terms.map(t => ({ id: t.id, code: t.code, title: t.title, isCurrent: t.isCurrent === 1 })),
      selectedTermId: resolvedTermId,
      programs: programs.map(p => ({
        id: p.id, code: p.code ?? String(p.id), title: p.title,
        facultyName: p.facultyName ?? '—', degreeLevel: p.degreeLevel ?? '—',
        facultyId: (p as any).facultyId ?? (p as any).deptFacultyId ?? null,
      })),
      cohorts,
      classrooms: classrooms.map(c => ({
        id: c.id, name: c.name, buildingName: c.buildingName ?? '—',
        capacity: c.capacity, roomType: c.roomType ?? 'THEORY', isActive: c.isActive ?? 1, facultyId: c.facultyId ?? null, facultyName: c.facultyName ?? '—',
      })),
      professors: professors.map(p => ({
        id: p.id, name: `${p.name} ${p.lastName}`.trim(), staffCode: p.staffCode,
        academicRank: p.academicRank ?? '—', departmentId: p.departmentId ?? null, departmentName: p.departmentName ?? '—',
      })),
      departments: deptRows,
      availabilities: availRows.map(a => ({
        staffId: a.staffId, dayOfWeek: a.dayOfWeek,
        startTime: a.startTime == null ? null : String(a.startTime).slice(0, 5),
        endTime: a.endTime == null ? null : String(a.endTime).slice(0, 5),
        status: a.status ?? 'AVAIL',
      })),
      demands: (demands as any[]).map(d => ({
        ...d,
        programIds: d.programIds ?? [],
        semesterNo: d.semesterNo ?? null,
        cohortMerged: d.cohortMerged ?? false,
        examDate: d.examDate ?? '',
        isCoTaught: d.isCoTaught ?? false,
        coProfId: d.coProfId ?? null,
      })),
      phases: Object.fromEntries(phases.map(p => [p.termId, p.phase])),
      termCalendar,
      sessionsTotal,
      sessionsByOffering,
      hardConflictCount,
      approvedOfferings,
      makeupSessions,
      allocatedRoomIds,
      roomGrants,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در بارگذاری دادهٔ صفحه.' };
  }
}

/** تقاضای مبتنی بر چارت درسی برای یک رشته خاص — برای فیلتر کردن دروس در CurriculumAssignTab */
export type CurriculumDemandsResult =
  | {
      ok: true;
      demands: Awaited<ReturnType<typeof listCurriculumDemands>>;
      /** بازهٔ ورودیِ چارت استفاده‌شده — «چارت معتبر برای ورودی ۱۴۰۱ تا ۱۴۰۴» */
      chartRange?: { from: number; to: number | null } | null;
      requestedEntryYear?: number | null;
    }
  | { ok: false; error: string };

export async function getCurriculumDemandsAction(termId: number, programId: number, entryYear?: number | null, _universityId?: number): Promise<CurriculumDemandsResult> {
  try {
    // خواندنِ تقاضای چارت — مدیرگروه هم مجاز است (فقط مشاهده، فقط رشته‌های خودش)
    const actor = await requireRole([...EDITORS, 'DEP_HEAD']);
    const { isDeptHead, deptIds } = await deptHeadScope(actor);
    if (isDeptHead) {
      const owned = await db
        .select({ id: majors.id })
        .from(majors)
        .where(and(eq(majors.id, programId), inArray(majors.departmentId, deptIds.length ? deptIds : [-1])))
        .limit(1);
      if (!owned.length) return { ok: false, error: 'این رشته در دپارتمان‌های تحت مدیریت شما نیست.' };
    }
    const demands = await listCurriculumDemands(termId, programId, await serverUniId(), entryYear ?? null);
    // بازهٔ ورودیِ چارتی که واقعاً استفاده شد — UI می‌گوید «چارت معتبر برای
    // ورودی‌های فلان تا فلان» یا «برای این ورودی چارت تعریف نشده».
    const chart = await db
      .select({ from: curriculum_versions.entryYearFrom, to: curriculum_versions.entryYearTo })
      .from(curriculum_versions)
      .where(and(
        eq(curriculum_versions.majorId, programId),
        sql`${curriculum_versions.status} in ('PUBLISHED','ARCHIVED')`,
      ))
      .orderBy(desc(curriculum_versions.entryYearFrom))
      .limit(1);
    return {
      ok: true,
      demands,
      chartRange: chart.length ? { from: chart[0].from, to: chart[0].to } : null,
      requestedEntryYear: entryYear ?? null,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در بارگذاری دروس چارت درسی.' };
  }
}

// ─────────────────────────── اکشن‌ها — تولید جلسات ───────────────────────────

/** تولید/بازتولید جلسات واقعی از schedules (تراکنشی + audit + گیت قیود سخت) */
export type GenerateSessionsOutcome =
  | { ok: true; generated: number; offerings: number; sessionsPerOffering: Record<number, number>; hardConflicts: unknown[]; termStart: string | null }
  | { ok: false; generated: 0; error: string };

export async function generateClassSessionsAction(px: {
  termId: number;
  sessionsCount?: number;
  holidays?: string[];
  dryRun?: boolean;
}): Promise<GenerateSessionsOutcome> {
  try {
    const user = await requireRole([...EDITORS, 'DEP_HEAD']);
    const { isDeptHead } = await deptHeadScope(user);
    if (isDeptHead) {
      return { ok: false as const, generated: 0 as const, error: 'تولید جلسات برای کل ترم توسط کارشناس آموزش انجام می‌شود.' };
    }
    const result = await generateClassSessionsForTerm(user.id, px.termId, {
      sessionsCount: px.sessionsCount,
      holidays: px.holidays,
      dryRun: px.dryRun,
    });
    revalidatePath('/admin/scheduling');
    if (!result.ok) return { ok: false as const, generated: 0 as const, error: 'تولید جلسات ناموفق بود.' };
    return {
      ok: true,
      generated: result.generated,
      offerings: result.offerings,
      sessionsPerOffering: result.sessionsPerOffering,
      hardConflicts: result.hardConflicts,
      termStart: result.termStart,
    };
  } catch (e: any) {
    return { ok: false, generated: 0, error: e?.message ?? 'خطا در تولید جلسات.' };
  }
}

/** گذار فاز برنامه‌ریزی (SUPPLY→ALLOCATION→REVIEW→PUBLISHED پله‌ای) — گیت: انتشار فقط بدون تداخل سخت */
export async function transitionSchedulingPhaseAction(termId: number, to: 'ALLOCATION' | 'REVIEW' | 'PUBLISHED'): Promise<{ ok: true; phase: 'ALLOCATION' | 'REVIEW' | 'PUBLISHED'; from: string } | { ok: false; error: string }> {
  try {
    const user = await requireRole([...EDITORS, 'DEP_HEAD']);
    const { isDeptHead } = await deptHeadScope(user);
    if (isDeptHead) {
      return { ok: false as const, error: 'گذار فاز برنامه‌ریزی (انتشار ترم) مخصوص کارشناس آموزش است.' };
    }
    if (to === 'PUBLISHED') {
      const insp = await inspectSchedulingHardConflicts(termId);
      if (insp.total > 0) {
        return {
          ok: false,
          error: `انتشار برنامه متوقف شد: ${insp.total} قید سخت (تداخل استاد/سالن/ظرفیت) باقی است. نمونه: ${insp.hardConflicts[0]?.message ?? ''}`,
        };
      }
    }
    const state = await getSchedulingState(termId);
    const result = await transitionSchedulingPhase(user.id, termId, to);
    revalidatePath('/admin/scheduling');
    return { ok: true as const, phase: result.phase as 'ALLOCATION' | 'REVIEW' | 'PUBLISHED', from: state.phase };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'گذار فاز ناموفق بود.' };
  }
}

export async function getSchedulingDashboardAction(termId?: number) {
  await requireRole(MANAGERS);
  try {
    const uni = await getCurrentUniversity().catch(() => null);
    const uid = uni?.id;
    const scopeOf = (c: any) => uniOrGlobal(c, uid);
    const [terms, rooms, profs, phases] = await Promise.all([
      db.select({ id: academic_terms.id, termCode: academic_terms.termCode, title: academic_terms.title, isCurrent: academic_terms.isCurrent, isSummer: academic_terms.isSummer, startDate: academic_terms.startDate })
        .from(academic_terms).where(scopeOf(academic_terms.universityId)).orderBy(desc(academic_terms.id)),
      db.select().from(classrooms).where(scopeOf(classrooms.universityId)).orderBy(asc(classrooms.name)),
      db.select({ id: staff.id, staffCode: staff.staffCode, departmentId: staff.departmentId, title: staff.title, name: users.firstName, lastname: users.lastName, isActive: staff.isActive, departmentName: departments.name, facultyName: faculties.name })
        .from(staff)
        .innerJoin(users, eq(users.id, staff.userId))
        .leftJoin(departments, eq(departments.id, staff.departmentId))
        .leftJoin(faculties, eq(faculties.id, departments.facultyId))
        .where(scopeOf(staff.universityId))
        .orderBy(asc(staff.staffCode)),
      db.select().from(term_scheduling_states).where(scopeOf(term_scheduling_states.universityId)),
    ]);

    const current = await db.select().from(academic_terms).where(and(eq(academic_terms.isCurrent, 1), scopeOf(academic_terms.universityId))).limit(1);
    const targetTermId = termId ?? current[0]?.id ?? terms[0]?.id ?? null;
    if (termId != null && !terms.some(t => t.id === termId)) {
      return { ok: false, error: 'ترم متعلق به دانشگاه دیگری است.' };
    }
    let offerings: any[] = [];
    let schedulesRows: any[] = [];
    let generatedCount = 0;
    let offeringProfMap: { offeringId: number; staffId: number | null; role: string | null }[] = [];

    if (targetTermId != null) {
      offerings = await db
        .select({
          id: course_offerings.id, termId: course_offerings.termId, courseId: course_offerings.courseId,
          groupNumber: course_offerings.groupNumber, capacity: course_offerings.capacity,
          isActive: course_offerings.isActive, code: courses.code, title: courses.title, units: courses.units,
        })
        .from(course_offerings)
        .innerJoin(courses, eq(courses.id, course_offerings.courseId))
        .where(and(eq(course_offerings.termId, targetTermId), scopeOf(course_offerings.universityId)))
        .orderBy(asc(course_offerings.courseId), asc(course_offerings.groupNumber));

      const offeringIds = offerings.map((o) => o.id);
      if (offeringIds.length) {
        const [sched, profsOf] = await Promise.all([
          db.select().from(schedules).where(inArray(schedules.offeringId, offeringIds)).orderBy(asc(schedules.offeringId)),
          db.select({ offeringId: offering_professors.offeringId, staffId: offering_professors.staffId, role: offering_professors.role })
            .from(offering_professors).where(inArray(offering_professors.offeringId, offeringIds)),
        ]);
        schedulesRows = sched;
        const gen = await db.select({ id: class_sessions.id }).from(class_sessions).where(inArray(class_sessions.offeringId, offeringIds));
        generatedCount = gen.length;
        offeringProfMap = profsOf as { offeringId: number; staffId: number | null; role: string | null }[];
      }
    }

    const state = phases.find((p) => p.termId === targetTermId) ?? null;

    return {
      ok: true,
      data: {
        terms, rooms, professors: profs, phases: state ? [state] : [],
        activeTermId: targetTermId,
        offerings, schedules: schedulesRows,
        offeringProfessors: offeringProfMap,
        generatedSessionCount: generatedCount,
        phase: state?.phase ?? 'SUPPLY',
      },
    };
  } catch (err: any) {
    console.error('getSchedulingDashboardAction:', err);
    return { ok: false, error: err.message || 'خطا در بارگیری دادهٔ زمان‌بندی' };
  }
}


export async function checkScheduleConflictsAction(termId: number) {
  await requireRole(MANAGERS);
  try {
    const uni = await getCurrentUniversity().catch(() => null);
    const uid = uni?.id;
    const offScope = uniOrGlobal(course_offerings.universityId, uid);
    // ترم باید متعلق به همین دانشگاه باشد
    const [term] = await db.select({ id: academic_terms.id }).from(academic_terms)
      .where(and(eq(academic_terms.id, termId), uniOrGlobal(academic_terms.universityId, uid))).limit(1);
    if (!term) return { ok: false, error: 'ترم متعلق به دانشگاه دیگری است.' };
    const rows = await db
      .select({
        offeringId: schedules.offeringId,
        dayOfWeek: schedules.dayOfWeek,
        startTime: schedules.startTime,
        endTime: schedules.endTime,
        roomId: schedules.roomId,
        capacity: course_offerings.capacity,
        courseTitle: courses.title,
        groupNumber: course_offerings.groupNumber,
      })
      .from(schedules)
      .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
      .innerJoin(courses, eq(courses.id, course_offerings.courseId))
      .where(and(eq(course_offerings.termId, termId), offScope));

    const profRows = await db
      .select({ offeringId: offering_professors.offeringId, staffId: offering_professors.staffId })
      .from(offering_professors)
      .innerJoin(course_offerings, eq(course_offerings.id, offering_professors.offeringId))
      .where(and(eq(course_offerings.termId, termId), offScope));
    const profByOffering = new Map<number, (number | null)[]>();
    for (const p of profRows) {
      if (!profByOffering.has(p.offeringId)) profByOffering.set(p.offeringId, []);
      profByOffering.get(p.offeringId)!.push(p.staffId);
    }

    const roomRows = await db.select().from(classrooms).where(uniOrGlobal(classrooms.universityId, uid));
    const rooms: RoomCapacityInfo[] = roomRows.map((r) => ({ id: r.id, capacity: r.capacity, title: r.name }));

    const entries: ScheduleConflictInput[] = rows.map((r) => ({
      offeringId: r.offeringId,
      groupNumber: r.groupNumber,
      dayOfWeek: r.dayOfWeek,
      startTime: String(r.startTime).slice(0, 5),
      endTime: String(r.endTime).slice(0, 5),
      roomId: r.roomId,
      requiredCapacity: r.capacity,
      professorIds: profByOffering.get(r.offeringId) ?? [null],
      offeringTitle: r.courseTitle + (r.groupNumber > 1 ? ` (گروه ${r.groupNumber})` : ''),
    }));

    const conflicts = detectScheduleConflicts(entries, rooms);
    return { ok: true, data: { conflicts, hasConflicts: conflicts.length > 0 } };
  } catch (err: any) {
    console.error('checkScheduleConflictsAction:', err);
    return { ok: false, error: err.message || 'خطا در بررسی تداخل‌ها' };
  }
}

// ─────────────────────────── اکشن‌ها — موتور واقعی (فاز ۱۲: تأمین/تخصیص/پیشنهاد/سلامت) ───────────────────────────

/** نتیجهٔ پیشنهاد هوشمند موتور (اسلات‌های ممکن برای یک درس/استاد) */
export type SmartSlot = {
  dayOfWeek: number; startTime: string; endTime: string;
  classroomId: number; classroomName: string; classroomCapacity: number;
  score: number; reasons: string[];
};

/** تأمین گروه درسی: درج واقعی offering + schedule + offering_professors (موتور — تراکنشی + قفل + audit) */
export async function supplyGroupDraftsAction(px: {
  termId: number; courseId: number; ownerDepartmentId: number; isSharedService?: boolean;
  drafts: { groupNumber: number; capacity: number; gender: 'MALE' | 'FEMALE' | 'MIXED';
            professorId: number; classroomId: number; dayOfWeek: number; startTime: string; endTime: string }[];
}): Promise<{ ok: true; created: number; offeringIds: number[] } | { ok: false; error: string }> {
  try {
    const user = await requireRole([...EDITORS, 'DEP_HEAD']);
    const { isDeptHead, deptIds } = await deptHeadScope(user);
    if (isDeptHead && !deptIds.includes(px.ownerDepartmentId)) {
      return { ok: false as const, error: 'فقط برای گروه‌های تحت مدیریت خودتان مجاز هستید.' };
    }
    // اعتبارسنجی درس در برابر گروه تحت مدیریت
    if (isDeptHead) {
      const [c] = await db.select({ id: courses.id, departmentId: courses.departmentId }).from(courses).where(eq(courses.id, px.courseId)).limit(1);
      if (c && c.departmentId != null && !deptIds.includes(Number(c.departmentId))) {
        return { ok: false as const, error: 'این درس متعلق به گروه‌های تحت مدیریت شما نیست.' };
      }
    }
    const res = await supplyGroupDrafts(user.id, {
      termId: px.termId, courseId: px.courseId, ownerDepartmentId: px.ownerDepartmentId,
      isSharedService: !!px.isSharedService, drafts: px.drafts,
    });
    revalidatePath('/admin/scheduling');
    revalidatePath('/group-manager/offerings');
    revalidatePath('/student/enroll');
    return { ok: true, created: res.created, offeringIds: res.offeringIds };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در تأمین گروه درسی.' };
  }
}

/** تخصیص کلاس‌های مشترک (استخر خدمات) به یک گروه — فقط فاز ALLOCATION/REVIEW */
export async function allocateSectionsAction(px: { termId: number; departmentId: number; offeringIds: number[] }) {
  try {
    const user = await requireRole(EDITORS);
    const res = await allocateSections(user.id, px);
    revalidatePath('/admin/scheduling');
    return res;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در تخصیص کلاس‌های مشترک.' };
  }
}

/** سهمیه‌بندی (سالن، شیفت) گروه‌ها بر اساس جمعیت دانشجویی — موتور واقعی */
export async function allocateRoomQuotasAction(termId: number): Promise<{ ok: true; grants: number } | { ok: false; error: string }> {
  try {
    const user = await requireRole(EDITORS);
    const res = await allocateRoomQuotas(user.id, termId);
    revalidatePath('/admin/scheduling');
    return res;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در سهمیه‌بندی سالن‌ها.' };
  }
}

export async function copyRoomQuotasFromPreviousTermAction(termId: number): Promise<{ ok: true; copied: number } | { ok: false; error: string }> {
  try {
    await requireRole(EDITORS);
    const uid = await serverUniId();
    const terms = await db
      .select({ id: academic_terms.id })
      .from(academic_terms)
      .orderBy(desc(academic_terms.id));
    // «ترم قبل» = نزدیک‌ترین ترم با شناسهٔ کمتر. به `idx + 1` تکیه نمی‌کنیم چون
    // اگر termId در فهرست نباشد (یا ترتیب شناسه‌ها زمانی نباشد) نتیجه غلط می‌شد.
    const prevTermId = terms.find(t => t.id < termId)?.id ?? null;
    if (!prevTermId) return { ok: false, error: 'ترم قبلی یافت نشد.' };

    // فقط سهمیهٔ سالن‌های همین دانشگاه منتقل می‌شود. بدون این شرط، مدیرِ یک
    // دانشگاه سهمیهٔ سالن‌های بقیهٔ دانشگاه‌ها را هم به این ترم کپی می‌کرد.
    const prevGrants = await db
      .select({
        classroomId: scheduling_room_grants.classroomId,
        shift: scheduling_room_grants.shift,
        ownerDepartmentId: scheduling_room_grants.ownerDepartmentId,
      })
      .from(scheduling_room_grants)
      .innerJoin(classrooms, eq(classrooms.id, scheduling_room_grants.classroomId))
      .where(and(
        eq(scheduling_room_grants.termId, prevTermId),
        universityEq(classrooms.universityId, uid),
      ));

    let copied = 0;
    for (const g of prevGrants) {
      const [ins] = await db
        .insert(scheduling_room_grants)
        .values({
          termId,
          classroomId: g.classroomId,
          shift: g.shift,
          ownerDepartmentId: g.ownerDepartmentId,
          status: 'ALLOCATED',
          universityId: uid ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: scheduling_room_grants.id });
      if (ins) copied++;
    }
    revalidatePath('/admin/scheduling');
    return { ok: true, copied };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در انتقال سهمیه از ترم قبل.' };
  }
}

/**
 * بازخوانی سبک فقط سهمیه‌های سالن (بدون تحلیل تداخل/جلسات/تقاضا) — برای استفاده
 * بعد از عملیاتِ تخصیص/لغو/واگذاری سهمیه، تا کل کارتابل دوباره بارگذاری نشود و
 * سرعت کلیک بالا بماند. هزینه: ۲ کوئری به‌جای ~۱۳ کوئریٔ سنگینِ getSchedulingWorkspaceAction.
 */
export async function getRoomGrantsAction(termId: number) {
  try {
    await requireRole([...EDITORS, 'DEP_HEAD']);
    const uid = await serverUniId();
    const [roomGrants, allocatedRoomIds] = await Promise.all([
      listRoomGrants(termId, uid),
      listAllocatedRoomIds(termId, uid),
    ]);
    return { ok: true as const, roomGrants, allocatedRoomIds };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? 'خطا در بازخوانی سهمیه‌های سالن.' };
  }
}

export async function releaseRoomShiftAction(px: { termId: number; departmentId: number; classroomId: number; shift: 'MORNING' | 'EVENING' }) {
  try {
    const user = await requireRole(EDITORS);
    const res = await releaseRoomShift(user.id, { termId: px.termId, departmentId: px.departmentId, classroomId: px.classroomId, shift: px.shift });
    return res;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در لغو سهمیهٔ سالن.' };
  }
}

export async function borrowReleasedShiftAction(px: { termId: number; classroomId: number; shift: 'MORNING' | 'EVENING'; departmentId: number }) {
  try {
    const user = await requireRole(EDITORS);
    const res = await borrowReleasedShift(user.id, { termId: px.termId, classroomId: px.classroomId, shift: px.shift, departmentId: px.departmentId });
    return res;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در واگذاری سهمیهٔ سالن.' };
  }
}

export async function upsertRoomGrantAction(px: { termId: number; classroomId: number; shift: 'MORNING' | 'EVENING'; departmentId: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireRole(EDITORS);
    const uid = await serverUniId();
    // سالن باید در دامنهٔ همین دانشگاه باشد؛ وگرنه مدیرِ یک دانشگاه می‌توانست
    // برای سالنِ دانشگاه دیگر سهمیه بسازد (نشتی بین‌دانشگاهی).
    const [room] = await db
      .select({ id: classrooms.id })
      .from(classrooms)
      .where(and(eq(classrooms.id, px.classroomId), universityEq(classrooms.universityId, uid)))
      .limit(1);
    if (!room) return { ok: false, error: 'این سالن در دامنهٔ دانشگاه شما نیست.' };
    await db
      .insert(scheduling_room_grants)
      .values({
        termId: px.termId,
        classroomId: px.classroomId,
        shift: px.shift,
        ownerDepartmentId: px.departmentId,
        status: 'ALLOCATED',
        universityId: uid ?? null,
      })
      .onConflictDoUpdate({
        target: [scheduling_room_grants.termId, scheduling_room_grants.classroomId, scheduling_room_grants.shift],
        set: { ownerDepartmentId: px.departmentId, status: 'ALLOCATED', releasedAt: null },
      });
    revalidatePath('/admin/scheduling');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در تخصیص سالن.' };
  }
}

/**
 * ادغام/جداکردن «نیمسال ورود» یک ارائه.
 *
 * سناریوی واقعی: گروهی ورودی بهمن با ۶ نفر دارد؛ برای ۶ نفر کلاس جدا گذاشتن
 * بی‌معنی است، پس همان ارائهٔ ورودی مهر (یا برعکس) برای هر دو نیمسال ورود
 * اعلام می‌شود. تصمیم روی ستون‌های موجود `course_offerings.entryYearStart/End`
 * ذخیره می‌شود (بدون جدول جدید) و `listRealDemands` اول همین را می‌خواند و
 * تنها در نبود آن به دانشجویانِ ثبت‌نام‌شده برمی‌گردد.
 */
export async function setOfferingCohortMergeAction(px: {
  offeringId: number;
  merge: boolean;
}): Promise<{ ok: true; entryYearStart: number | null; entryYearEnd: number | null } | { ok: false; error: string }> {
  try {
    const user = await requireRole([...EDITORS, 'DEP_HEAD']);
    const { isDeptHead, deptIds } = await deptHeadScope(user);

    const [off] = await db
      .select({ id: course_offerings.id, courseDeptId: courses.departmentId, termId: course_offerings.termId })
      .from(course_offerings)
      .innerJoin(courses, eq(courses.id, course_offerings.courseId))
      .where(eq(course_offerings.id, px.offeringId))
      .limit(1);
    if (!off) return { ok: false as const, error: 'ارائه یافت نشد.' };
    if (isDeptHead && (off.courseDeptId == null || !deptIds.includes(off.courseDeptId))) {
      return { ok: false as const, error: 'این درس در گروه‌های تحت مدیریت شما نیست.' };
    }

    // ادغام مهر+بهمن فقط برای نمایش/گروه‌بندی در تابلو است؛ هرگز ستون‌های هدف‌گیری ثبت‌نام را تغییر ندهد.
    if (!px.merge) {
      revalidatePath('/admin/scheduling');
      revalidatePath('/group-manager/scheduling');
      return { ok: true as const, entryYearStart: null, entryYearEnd: null };
    }

    // فقط برای اطلاع UI: بازهٔ ورودی دانشجویانِ همین ارائه (بدون نوشتن در entryYearStart/End)
    const rows = await db
      .select({ year: students.entryYear })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(eq(enrollments.offeringId, px.offeringId));
    const years = rows.map(r => Number(r.year)).filter(y => Number.isFinite(y) && y > 0);
    if (!years.length) {
      return { ok: false as const, error: 'برای این ارائه دانشجوی ثبت‌نام‌شده‌ای نیست؛ بازهٔ ورودی قابل تعیین نیست.' };
    }
    const from = Math.min(...years);
    const to = Math.max(...years);
    revalidatePath('/admin/scheduling');
    revalidatePath('/group-manager/scheduling');
    return { ok: true as const, entryYearStart: from, entryYearEnd: to };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? 'ثبت ادغام نیمسال ورود ناموفق بود.' };
  }
}

/** پیشنهاد هوشمند موتور: اسلات‌های ممکن بر اساس درٔ دسترس بودنِ واقعی استاد + اشغال سالن‌ها + زونینگ */
export async function getSmartSuggestionsAction(px: {
  termId: number; professorId: number; capacity: number;
  targetFacultyId: number | null; durationMinutes?: number;
}): Promise<{ ok: true; suggestions: SmartSlot[] } | { ok: false; error: string }> {
  try {
    // پیشنهاد هوشمند = محاسبهٔ فقط‌خواندنی؛ مدیرگروه هم می‌تواند ببیند
    await requireRole([...EDITORS, 'DEP_HEAD']);
    const rows = await getSmartSuggestions(px);
    return { ok: true, suggestions: rows };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در محاسبهٔ پیشنهادها.' };
  }
}

/** عارضه‌یابی خودکار برنامه (عرضه در برابر تقاضا، تداخل‌های پنهان، بهره‌وری سالن‌ها، کلاس‌های یتیم) */
export type SchedulingHealthReport = HealthReport;
export async function getSchedulingHealthAction(termId: number): Promise<{ ok: true; health: HealthReport } | { ok: false; error: string }> {
  try {
    // عارضه‌یابی = فقط‌خواندنی؛ مدیرگروه هم می‌تواند ببیند
    await requireRole([...EDITORS, 'DEP_HEAD']);
    const health = await runSchedulingHealthCheck(termId);
    return { ok: true, health };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در عارضه‌یابی برنامه.' };
  }
}

