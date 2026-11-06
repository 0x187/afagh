import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  academic_terms,
  cart_items,
  classrooms,
  course_offerings,
  courses,
  degree_level_configs,
  enrollments,
  majors,
  schedules,
  staff,
  users,
  tuition_rules,
  financial_terms,
} from '@/db/schema';
import { getStudentByUser, requireRole } from '@/lib/auth';
import { getTermScope, termOrdinalForEntry } from '@/lib/term-scope';
import { resolveStudentCurriculumScope, scopeOfferingsByCurriculum } from '@/lib/enroll-curriculum-scope';
import { buildPrereqContext, evaluateLogicTree, formatPrereq } from '@/lib/enroll-engine';
import { openBypassRequestsOfStudent } from '@/lib/bypass-requests';
import { offeringVisible } from '@/lib/offering-targeting';
import { evaluateStudentRegulationStatus, type StudentAcademicSummary } from '@/lib/regulations-engine';
import { getBool, getSetting } from '@/lib/settings';
import { toShamsi } from '@/lib/shamsi';
import EnrollClient from './EnrollClient';
import { emergencyDropFormAction } from './actions';
import { resolveTuitionRule, type TuitionRuleContext } from '@/lib/tuition-resolver';
import { toNum } from '@/lib/finance-rules';

export const dynamic = 'force-dynamic';

const DAY_NAMES = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

export default async function EnrollPage() {
  const user = await requireRole(['STUDENT']);
  const me = await getStudentByUser(user.id);
  if (!me) return <p className="card">پروندهٔ دانشجویی یافت نشد.</p>;

  const termScope = await getTermScope(me.universityId);
  const filteredTerm = termScope.selectedId
    ? termScope.terms.find(t => t.id === termScope.selectedId) ?? null
    : null;
  const term = filteredTerm
    ? ((await db.select().from(academic_terms).where(eq(academic_terms.id, filteredTerm.id)).limit(1))[0] ?? null)
    : ((await db.select().from(academic_terms).where(eq(academic_terms.isCurrent, 1)))[0] ?? null);

  let regulationStatus: StudentAcademicSummary | null = null;
  try {
    regulationStatus = await evaluateStudentRegulationStatus(me.id, term?.id);
  } catch (err) {
    console.warn('Error evaluating regulation status in enroll page:', err);
  }

  // دریافت تمام ارائه‌های فعال ترم جاری
  const rawOfferings = term
    ? await db
        .select({
          id: course_offerings.id,
          courseId: course_offerings.courseId,
          code: courses.code,
          title: courses.title,
          units: courses.units,
          capacity: course_offerings.capacity,
          enrolled: course_offerings.enrolledCount,
          group: course_offerings.groupNumber,
          professorId: course_offerings.professorId,
          offeringType: course_offerings.offeringType,
          targetDegreeLevelId: course_offerings.targetDegreeLevelId,
          targetMajorId: course_offerings.targetMajorId,
          entryYearStart: course_offerings.entryYearStart,
          entryYearEnd: course_offerings.entryYearEnd,
        })
        .from(course_offerings)
        .innerJoin(courses, eq(courses.id, course_offerings.courseId))
        .where(and(
          eq(course_offerings.termId, term.id),
          eq(course_offerings.isActive, 1),
          // 🔒 مرز دانشگاه: کاتالوگ فقط ارائه‌های دانشگاه خودِ دانشجو
          // (پیش از این بی‌فیلتر بود و ارائه‌های سایر دانشگاه‌ها هم دیده می‌شد)
          me.universityId == null ? sql`1 = 0` : eq(course_offerings.universityId, me.universityId),
        ))
    : [];

  // 🎯 هدف‌گیری ارائه (G1): فقط ارائه‌هایی که مقطع/رشته/بازهٔ ورودیِشان با
  //    این دانشجو هم‌خوان است دیده شود — پیش از این هدف‌گیری ست می‌شد ولی در
  //    کاتالوگ اعمال نمی‌شد. offeringVisible تنها مرجع درست است.
  const offeringsForStudent = rawOfferings.filter(o => offeringVisible(
    o,
    { degreeLevelId: me.degreeLevelId, majorId: me.majorId ?? null, entryYear: me.entryYear },
  ));

  // ── 🗺️ اعمال چارت تحصیلی (چارت درسی مصوب): دانشجو فقط دروسِ ترم خودش را ببیند ──
  // حل نسخهٔ برنامه بر اساس رشته/مقطع/سال ورود (هم‌راستا با صفحهٔ چارت)؛
  // در صورت عدم وجود نسخه، اسکوپ اعمال نمی‌شود و رفتار پیشین حفظ می‌گردد.
  const curriculumScope = await resolveStudentCurriculumScope(me.id);
  const studentTermOrdinal = term
    ? termOrdinalForEntry({
        entryYear: me.entryYear,
        entryTerm: me.entryTerm,
        terms: termScope.terms,
        targetTermCode: term.termCode,
      })
    : null;

  // محاسبهٔ دروس مردودی برای «تکرار» (تا کاتالوگِ محدود به ترم، انتخاب واحد را مسدود نکند)
  const allEnr = term
    ? await db
        .select({
          courseId: courses.id,
          grade: enrollments.gradeValue,
          status: enrollments.status,
          gradingType: courses.gradingType,
          affectsGpa: courses.affectsGpa,
          minPassedMark: courses.minPassedMark,
        })
        .from(enrollments)
        .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
        .innerJoin(courses, eq(courses.id, course_offerings.courseId))
        .where(eq(enrollments.studentId, me.id))
    : [];
  const passedCourseIds = new Set<number>();
  const inProgressCourseIds = new Set<number>();
  const failedCourseIds = new Set<number>();
  for (const r of allEnr) {
    const isDescriptive = r.gradingType === 'DESCRIPTIVE' || r.affectsGpa === 0;
    const minMark = Number(r.minPassedMark ?? 10);
    const grade = r.grade != null ? Number(r.grade) : null;
    const passed = r.status === 'EQUIV_PASSED' || (grade != null && (isDescriptive ? grade !== 0 : grade >= minMark));
    if (passed) { passedCourseIds.add(r.courseId); continue; }
    if (r.status === 'DROPPED') continue;
    if (grade == null && ['REGISTERED', 'FINALIZED', 'WAITLISTED', 'PENDING_COUNCIL'].includes(r.status)) {
      inProgressCourseIds.add(r.courseId);
      continue;
    }
    failedCourseIds.add(r.courseId);
  }
  const retakeCourseIds = new Set<number>(
    [...failedCourseIds].filter(c => !passedCourseIds.has(c) && !inProgressCourseIds.has(c)),
  );

  const requireChart = await getBool('ENROLL_REQUIRE_CURRICULUM_CHART').catch(() => true);
  const scopedOfferings = scopeOfferingsByCurriculum(
    offeringsForStudent,
    curriculumScope,
    studentTermOrdinal,
    retakeCourseIds,
    requireChart,
  );

  // دریافت اطلاعات اساتید
  const profUsers = await db
    .select({
      staffId: staff.id,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(staff)
    .innerJoin(users, eq(users.id, staff.userId));

  const profMap = new Map<number, string>();
  for (const p of profUsers) {
    profMap.set(p.staffId, `${p.firstName || ''} ${p.lastName || ''}`.trim());
  }

  // دریافت زمان‌بندی کلاس‌ها و امتحانات — فقط برای ارائه‌های همین ترم
  // (پیش از این کل جدول schedules بی‌فیلتر خوانده می‌شد).
  const termOffIds = rawOfferings.map(o => o.id);
  const rawSchedules = term && termOffIds.length
    ? await db
        .select({
          offeringId: schedules.offeringId,
          scheduleType: schedules.scheduleType,
          dayOfWeek: schedules.dayOfWeek,
          examDate: schedules.examDate,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          roomName: classrooms.name,
        })
        .from(schedules)
        .leftJoin(classrooms, eq(classrooms.id, schedules.roomId))
        .where(inArray(schedules.offeringId, termOffIds))
    : [];

  const schedMap = new Map<
    number,
    {
      classes: { dayOfWeek: number; dayName: string; startTime: string; endTime: string; room?: string }[];
      exam?: { examDate: string; startTime: string; endTime: string };
    }
  >();

  for (const s of rawSchedules) {
    if (!schedMap.has(s.offeringId)) {
      schedMap.set(s.offeringId, { classes: [] });
    }
    const entry = schedMap.get(s.offeringId)!;

    if (s.scheduleType === 'CLASS' && s.dayOfWeek != null) {
      entry.classes.push({
        dayOfWeek: s.dayOfWeek,
        dayName: DAY_NAMES[s.dayOfWeek] || `روز ${s.dayOfWeek}`,
        startTime: s.startTime.slice(0, 5),
        endTime: s.endTime.slice(0, 5),
        room: s.roomName || undefined,
      });
    } else if (s.scheduleType === 'EXAM' && s.examDate) {
      entry.exam = {
        examDate: toShamsi(String(s.examDate)),
        startTime: s.startTime.slice(0, 5),
        endTime: s.endTime.slice(0, 5),
      };
    }
  }

  // برچسب پیش‌نیاز هر درس از قاعدهٔ مؤثر دانشجو
  const prereqCtx = await buildPrereqContext(me.id);
  const prereqLabel = new Map<number, string>();
  const prereqMet = new Map<number, boolean>();
  for (const o of scopedOfferings) {
    const node = prereqCtx.ruleByCourse.get(o.courseId ?? -1);
    const lbl = formatPrereq(node, prereqCtx.titles);
    if (lbl) prereqLabel.set(o.id, lbl);
    prereqMet.set(o.id, !node || evaluateLogicTree(node, prereqCtx.passed, prereqCtx).ok);
  }

  // درخواست‌های باز «بدون رعایت پیش‌نیاز / تداخل امتحانی» همین دانشجو
  const bypassRequests = await openBypassRequestsOfStudent(me.id).catch(() => []);

  // محاسبه شهریه برای هر ارائه بر اساس قوانین جدید
  // بارگذاری تمام قواعد شهریه فعال
  const allTuitionRules = await db.select().from(tuition_rules).where(eq(tuition_rules.isActive, 1));
  
  // پیدا کردن ترم مالی جاری
  const finTerms = await db.select().from(financial_terms)
    .where(and(eq(financial_terms.universityId, me.universityId ?? 0), eq(financial_terms.isActive, 1)))
    .orderBy(sql`"sortOrder" ASC NULLS LAST`);
  const currentFinTerm = finTerms[0];

  // بافت دانشجو برای resolver
  const [majorRow] = me.majorId
    ? await db.select({ facultyId: majors.facultyId }).from(majors).where(eq(majors.id, me.majorId)).limit(1)
    : [null];
  const [degreeLevelRow] = me.degreeLevelId
    ? await db.select({ title: degree_level_configs.title }).from(degree_level_configs).where(eq(degree_level_configs.id, me.degreeLevelId)).limit(1)
    : [null];
  const tuitionCtx: TuitionRuleContext = {
    degreeLevelId: me.degreeLevelId,
    majorId: me.majorId,
    facultyId: majorRow?.facultyId ?? null,
    entryYear: me.entryYear,
    termType: term?.termType ?? 'NORMAL',
    offeringType: 'NORMAL',
    clinicalPhase: 'NORMAL',
    entryTermId: currentFinTerm?.id ?? null,
    currentTermId: currentFinTerm?.id ?? null,
    termLevelOnly: false,
  };

  // محاسبه شهریه برای هر درس
  const tuitionMap = new Map<number, { fixed: number; variable: number; perUnit: number; total: number }>();
  for (const o of scopedOfferings) {
    const ctx = { ...tuitionCtx, offeringType: o.offeringType || 'NORMAL' };
    const rule = resolveTuitionRule(allTuitionRules, ctx);
    if (rule) {
      const rates = { 
        fixed: toNum(rule.fixedAmount), 
        theory: toNum(rule.perUnitTheory), 
        practical: toNum(rule.perUnitPractical), 
        general: toNum(rule.perUnitGeneral) 
      };
      // تعیین نوع درس (نظری/عملی/عمومی) - در اینجا ساده‌سازی شده
      const perUnit = rates.theory; // پیش‌فرض: نظری
      const fixed = rates.fixed;
      const variable = perUnit * Number(o.units);
      tuitionMap.set(o.id, { fixed, variable, perUnit, total: fixed + variable });
    } else {
      tuitionMap.set(o.id, { fixed: 0, variable: 0, perUnit: 0, total: 0 });
    }
  }

  // سبد جاری دانشجو
  const cart = await db.select().from(cart_items).where(eq(cart_items.studentId, me.id));
  const cartOfferingIds = cart.map(c => c.offeringId);
  const cartCourses = cartOfferingIds.length
    ? await db
        .select({
          id: course_offerings.id,
          courseId: course_offerings.courseId,
          code: courses.code,
          title: courses.title,
          units: courses.units,
          group: course_offerings.groupNumber,
        })
        .from(course_offerings)
        .innerJoin(courses, eq(courses.id, course_offerings.courseId))
        .where(inArray(course_offerings.id, cartOfferingIds))
    : [];

  const offerings = scopedOfferings.map(o => {
    const s = schedMap.get(o.id);
    const tuition = tuitionMap.get(o.id) ?? { fixed: 0, variable: 0, perUnit: 0, total: 0 };
    return {
      ...o,
      units: Number(o.units),
      professor: o.professorId ? profMap.get(o.professorId) || 'نامشخص' : 'نامشخص',
      prereq: prereqLabel.get(o.id) ?? null,
      prereqMet: prereqMet.get(o.id) ?? true,
      classSchedules: s?.classes || [],
      examSchedule: s?.exam || null,
      tuitionFixed: tuition.fixed,
      tuitionVariable: tuition.variable,
      tuitionPerUnit: tuition.perUnit,
      tuitionTotal: tuition.total,
    };
  });

  // ── وضعیت پنجرهٔ انتخاب واحد: پرچم ترم + کلید سراسری مدیر + مهلت حذف و اضافه ──
  // پیش از این فقط isEnrollmentOpen ترم بررسی می‌شد؛ اگر تاریخ مهلت گذشته
  // یا مدیر کلید سراسری را خاموش کرده بود، صفحه هنوز باز نشان داده می‌شد.
  const [enrollmentWindowOpen, emergencyWithdrawOpen] = await Promise.all([
    getBool('ENROLLMENT_WINDOW_OPEN').catch(() => true),
    getBool('EMERGENCY_WITHDRAW_OPEN').catch(() => false),
  ]);
  const addDropEnd = term?.addDropEndDate ?? null;
  const addDropTimeOpen = !addDropEnd || addDropEnd.getTime() >= Date.now();
  const enrollOpen = !!term?.isEnrollmentOpen && enrollmentWindowOpen && addDropTimeOpen;

  // ── دروس ثبت‌شدهٔ همین نیمسال (از داشبورد به اینجا منتقل شد) ──
  const studentEnrollments = term
    ? await db
        .select({
          enrollmentId: enrollments.id,
          offeringId: enrollments.offeringId,
          status: enrollments.status,
          code: courses.code,
          title: courses.title,
          units: courses.units,
          group: course_offerings.groupNumber,
          professorId: course_offerings.professorId,
          emergencyWithdrawal: enrollments.emergencyWithdrawal,
        })
        .from(enrollments)
        .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
        .innerJoin(courses, eq(courses.id, course_offerings.courseId))
        .where(
          and(
            eq(enrollments.studentId, me.id),
            eq(course_offerings.termId, term.id),
            inArray(enrollments.status, ['REGISTERED', 'FINALIZED', 'WAITLISTED', 'PENDING_COUNCIL', 'DROPPED']),
          ),
        )
    : [];
  // استاد دروس ثبت‌شده ممکن است در فهرست ارائه‌های فعال نباشد (مثلاً ارائه غیرفعال)
  const enrolledProfIds = [...new Set(studentEnrollments.map(e => e.professorId).filter((v): v is number => v != null))];
  const missingProfIds = enrolledProfIds.filter(id => !profMap.has(id));
  if (missingProfIds.length > 0) {
    const extraProfs = await db
      .select({ staffId: staff.id, firstName: users.firstName, lastName: users.lastName })
      .from(staff)
      .innerJoin(users, eq(users.id, staff.userId))
      .where(inArray(staff.id, missingProfIds));
    for (const p of extraProfs) profMap.set(p.staffId, `${p.firstName || ''} ${p.lastName || ''}`.trim());
  }

  const cartList = cartCourses.map(c => {
    const s = schedMap.get(c.id);
    return {
      id: c.id,
      courseId: c.courseId,
      code: c.code,
      title: c.title,
      units: Number(c.units),
      group: c.group,
      classSchedules: s?.classes || [],
      examSchedule: s?.exam || null,
    };
  });

  return (
    <div className="space-y-4">
      {filteredTerm && (
        <>
          {offerings.length === 0 && (
            <p className="card p-5 text-center text-xs text-slate-500">
              برای نیمسال «{filteredTerm.title}» هیچ گروه درسی فعالی ثبت نشده است. برای ثبت انتخاب واحد، فیلتر نیمسال را پاک کنید و نیمسال جاری را انتخاب کنید.
            </p>
          )}
        </>
      )}
      <EnrollClient
        sajjadPortalUrl={await getSetting('SAJJAD_PORTAL_URL')}
        student={{ id: me.id, status: me.status }}
        term={{ id: term?.id ?? null, title: term?.title ?? '', open: !!term?.isEnrollmentOpen, isSummer: !!term?.isSummer }}
        offerings={offerings}
        cart={cartList}
        cartStartedAt={cart.length ? cart.map(c => c.createdAt?.getTime?.() ?? 0).filter(Boolean).sort((a, b) => a - b)[0] || null : null}
        regulationStatus={regulationStatus}
        bypassRequests={bypassRequests}
        degreeLevelTitle={degreeLevelRow?.title ?? undefined}
        curriculumScoped={curriculumScope.resolved}
        curriculumRequired={requireChart}
        curriculumReason={curriculumScope.reason}
        curriculumVersionLabel={curriculumScope.versionCode ?? null}
        studentTermOrdinal={studentTermOrdinal}
      />
    </div>
  );
}
