'use server';

// انتخاب واحد از راه صف Redis — سند §۱۰۱۶: «ثبت نهایی» بلافاصله پاسخ می‌گیرد
// («درخواست شما در صف پردازش قرار گرفت») و کارگر صف نتیجه را در PostgreSQL می‌نویسد.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  academic_terms,
  cart_items,
  classrooms,
  course_offerings,
  courses,
  curriculum_courses,
  curriculum_versions,
  degree_level_configs,
  enrollments,
  majors,
  notifications,
  process_definitions,
  process_steps,
  schedules,
  student_requests,
  students,
} from '@/db/schema';
import { getStudentByUser, requireRole } from '@/lib/auth';
import { assertServerActionOrigin } from '@/lib/security';
import { offeringVisible } from '@/lib/offering-targeting';
import { enqueueSubmit, ensureWorker, rateLimitSubmit, redisAvailable } from '@/lib/waitingRoom';
import { processQueuedSubmit, type SubmitResult } from '@/lib/enroll-engine';
import { buildPrereqContext, evaluateLogicTree } from '@/lib/enroll-engine';
import { evaluateStudentRegulationStatus } from '@/lib/regulations-engine';
import { resolveApplicableCurriculum, type ResolvableVersion } from '@/lib/curriculum-resolution';
import { listTermsForUniversity, termOrdinalForEntry } from '@/lib/term-scope';
import { createBypassRequest, cancelBypassRequest } from '@/lib/bypass-requests';

/**
 * زمینهٔ انتخاب واحد.
 *
 * 🔒 ترم جاری و ارائه‌ها فقط از **دانشگاه خودِ دانشجو** خوانده می‌شوند. پیش از این،
 * ترم با `WHERE isCurrent = 1` بدون فیلتر دانشگاه انتخاب می‌شد و ارائه هم با
 * `WHERE id = ?` خوانده می‌شد؛ یعنی دانشجوی دانشگاه الف می‌توانست با یک
 * `offeringId` متعلق به دانشگاه ب سبدش بسازد و ثبت نهایی کند.
 */
async function ctx() {
  const user = await requireRole(['STUDENT']);
  const me = await getStudentByUser(user.id);
  if (!me) throw new Error('پروندهٔ دانشجویی یافت نشد');
  const myUni = me.universityId ?? null;
  // بدون دانشگاه = نامشخص؛ deny (fail-closed) — نه «همهٔ دانشگاه‌ها»
  const uniCond = myUni == null ? sql`1 = 0` : eq(academic_terms.universityId, myUni);
  const [term] = await db.select().from(academic_terms)
    .where(and(eq(academic_terms.isCurrent, 1), uniCond)).limit(1);
  return { user, me, term, myUni };
}

/** ارائه باید در همان دانشگاهِ دانشجو و همان ترم جاری باشد — وگرنه رد شود */
async function offeringInMyScope(meUni: number | null, termId: number, offeringId: number) {
  if (meUni == null) return null;
  const [o] = await db.select({
    id: course_offerings.id, courseId: course_offerings.courseId,
    universityId: course_offerings.universityId,
    targetDegreeLevelId: course_offerings.targetDegreeLevelId,
    targetMajorId: course_offerings.targetMajorId,
    entryYearStart: course_offerings.entryYearStart,
    entryYearEnd: course_offerings.entryYearEnd,
  }).from(course_offerings).where(and(
    eq(course_offerings.id, offeringId),
    eq(course_offerings.termId, termId),
    eq(course_offerings.isActive, 1),
    eq(course_offerings.universityId, meUni),
  )).limit(1);
  return o ?? null;
}

function timeOverlap(s1: string, e1: string, s2: string, e2: string) {
  return s1.slice(0, 5) < e2.slice(0, 5) && s2.slice(0, 5) < e1.slice(0, 5);
}

export async function addToCartAction(offeringId: number) {
  const og = await assertServerActionOrigin();
  if (!og.ok) return { ok: false, error: og.error };
  const { user, me, term, myUni } = await ctx();
  if (!term) return { ok: false, error: 'ترم جاری فعال نیست' };

  // 🔒 ارائه باید متعلق به دانشگاه و ترمِ خودِ دانشجو باشد
  const targetOff = await offeringInMyScope(myUni, term.id, offeringId);
  if (!targetOff) return { ok: false, error: 'این ارائه برای دانشگاه/نیمسال شما در دسترس نیست' };

  // 🎯 هدف‌گیری (G1): ارائهٔ اختصاصیِ مقطع/رشته/ورودیِ دیگر قابل انتخاب نیست
  if (!offeringVisible(
    { targetDegreeLevelId: targetOff.targetDegreeLevelId, targetMajorId: targetOff.targetMajorId, entryYearStart: targetOff.entryYearStart, entryYearEnd: targetOff.entryYearEnd },
    { degreeLevelId: me.degreeLevelId, majorId: me.majorId ?? null, entryYear: me.entryYear },
  )) {
    return { ok: false, error: 'این ارائه به مقطع/رشته/سال ورودی شما اختصاص ندارد.' };
  }

  {
    // یافتن و حذف سایر گروه‌های همین درس از سبد دانشجو (جایگزینی گروه جدید)
    const otherGroupOfferings = await db
      .select({ id: course_offerings.id })
      .from(course_offerings)
      .where(and(eq(course_offerings.termId, term.id), eq(course_offerings.courseId, targetOff.courseId)));

    const otherIds = otherGroupOfferings.map(o => o.id);
    if (otherIds.length > 0) {
      await db.transaction(tx =>
        tx.delete(cart_items).where(and(eq(cart_items.studentId, me.id), inArray(cart_items.offeringId, otherIds)))
      );
    }
  }

  // درج ارائه جدید در سبد تحت RLS (§۲۱۷۰) با تمدید مهلت
  await db.transaction(tx =>
    tx
      .insert(cart_items)
      .values({ studentId: me.id, offeringId, createdAt: new Date() })
      .onConflictDoUpdate({
        target: [cart_items.studentId, cart_items.offeringId],
        set: { createdAt: new Date() },
      })
  );

  return { ok: true };
}

export async function removeFromCartAction(offeringId: number) {
  const og = await assertServerActionOrigin();
  if (!og.ok) return { ok: false, error: og.error };
  const { user, me } = await ctx();
  await db.transaction(tx =>
    tx.delete(cart_items).where(and(eq(cart_items.studentId, me.id), eq(cart_items.offeringId, offeringId)))
  );
  return { ok: true };
}

/** خالی کردن کامل سبد انتخاب واحد (حذف همه) */
export async function clearCartAction() {
  const og = await assertServerActionOrigin();
  if (!og.ok) return { ok: false, error: og.error };
  const { user, me } = await ctx();
  await db.transaction(tx =>
    tx.delete(cart_items).where(eq(cart_items.studentId, me.id))
  );
  return { ok: true };
}

/** چیدمان هوشمند و خودکار دروس ترم بر اساس چارت، ظرفیت و کنترل عدم تداخل زمانی و امتحانی */
export async function autoFillCartFromChartAction(): Promise<{
  ok: boolean;
  count: number;
  units: number;
  message: string;
  conflictsResolved?: number;
}> {
  const og = await assertServerActionOrigin();
  if (!og.ok) return { ok: false, count: 0, units: 0, message: og.error };
  const { user, me, term, myUni } = await ctx();
  if (!term) return { ok: false, count: 0, units: 0, message: 'ترم جاری فعال نیست.' };
  if (myUni == null) return { ok: false, count: 0, units: 0, message: 'دانشگاه شما مشخص نیست.' };

  // ── سقف واحد از موتور آیین‌نامه (شامل ممتازی و واحدهای جبرانی) ──
  // پیش از این عدد ۲۰ سخت‌کد بود؛ دانشجوی ارشد/ممتاز/جبرانی چیدمان نادرست می‌گرفت.
  let maxUnitsLimit = 20;
  let minAllowedUnits = 0;
  try {
    const reg = await evaluateStudentRegulationStatus(me.id, term.id);
    maxUnitsLimit = reg.effectiveMaxUnits;
    minAllowedUnits = reg.minAllowedUnits;
  } catch {
    /* موتور آیین‌نامه در دسترس نبود → سقف پیش‌فرض */
  }

  // ── وضعیت پیش‌نیاز و دروس پاس‌شده ──
  const prereqCtx = await buildPrereqContext(me.id);
  const passesPrereqs = (courseId: number): boolean => {
    const rule = prereqCtx.ruleByCourse.get(courseId);
    if (!rule) return true;
    return evaluateLogicTree(rule, prereqCtx.passed, prereqCtx).ok;
  };

  // ── دروس ثبت‌شدهٔ همین ترم (نباید دوباره پیشنهاد شوند) ──
  const registeredRows = await db
    .select({ courseId: course_offerings.courseId })
    .from(enrollments)
    .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .where(and(
      eq(enrollments.studentId, me.id),
      eq(course_offerings.termId, term.id),
      inArray(enrollments.status, ['REGISTERED', 'PENDING_COUNCIL']),
    ));
  const registeredCourseIds = new Set(registeredRows.map(r => r.courseId));

  // ── چارت سرفصل: دروس ترم جاری و ترم‌های قبل ──
  // قاعده: دروس ترم‌های قبل که پاس نشده‌اند (افتاده/اخذنشده) همچنان قابل انتخاب‌اند؛
  // درسی که پیش‌نیازش پاس نشده پیشنهاد نمی‌شود (مسیر آن درخواست بایپس است).
  let chartResolved = false;
  let chartPicks: { courseId: number; code: string; recommendedSemester: number | null }[] | null = null;
  try {
    const versionRows = me.majorId
      ? await db
          .select({
            id: curriculum_versions.id,
            majorId: curriculum_versions.majorId,
            degreeLevelId: curriculum_versions.degreeLevelId,
            trackId: curriculum_versions.trackId,
            versionCode: curriculum_versions.versionCode,
            status: curriculum_versions.status,
            entryYearFrom: curriculum_versions.entryYearFrom,
            entryYearTo: curriculum_versions.entryYearTo,
          })
          .from(curriculum_versions)
          .where(
            me.universityId
              ? and(eq(curriculum_versions.majorId, me.majorId), eq(curriculum_versions.universityId, me.universityId))
              : eq(curriculum_versions.majorId, me.majorId)
          )
      : [];
    const resolution = me.majorId
      ? resolveApplicableCurriculum(versionRows as ResolvableVersion[], {
          majorId: me.majorId,
          degreeLevelId: me.degreeLevelId,
          trackId: null,
          entryYear: me.entryYear,
          entryTerm: me.entryTerm,
        })
      : null;
    const version = resolution?.version ?? null;
    if (version) {
      chartResolved = true;
      const chartRows = await db
        .select({
          courseId: curriculum_courses.courseId,
          recommendedSemester: curriculum_courses.recommendedSemester,
          code: courses.code,
        })
        .from(curriculum_courses)
        .innerJoin(courses, eq(courses.id, curriculum_courses.courseId))
        .where(eq(curriculum_courses.curriculumVersionId, version.id));
      const ordinalTerms = await listTermsForUniversity(me.universityId, { limit: null }).catch(() => []);
      const currentTermOrdinal = term
        ? termOrdinalForEntry({
            entryYear: me.entryYear,
            entryTerm: me.entryTerm,
            terms: ordinalTerms,
            targetTermCode: term.termCode,
          })
        : null;
      const targetSem = currentTermOrdinal ?? null;
      chartPicks = chartRows.filter(r => {
        if (registeredCourseIds.has(r.courseId)) return false;      // قبلاً همین ترم ثبت شده
        if (r.code && prereqCtx.passed.has(r.code)) return false;   // قبلاً پاس شده
        // فقط ترم جاری و ترم‌های قبل؛ درس ترم‌های بعد پیشنهاد نمی‌شود
        if (targetSem != null && r.recommendedSemester != null && r.recommendedSemester > targetSem) return false;
        return true;
      });
    }
  } catch {
    // در صورت خطا، بدون فیلتر چارت ادامه می‌دهیم (رفتار پیشین)
    chartResolved = false;
  }

  // ۱. پاکسازی سبد قبلی جهت چیدمان تازه و بدون تداخل
  await db.transaction(tx =>
    tx.delete(cart_items).where(eq(cart_items.studentId, me.id))
  );

  // ۲. دریافت تمام ارائه‌های فعال ترم جاری — فقط دانشگاه خودِ دانشجو
  const offerings = await db
    .select({
      id: course_offerings.id,
      courseId: course_offerings.courseId,
      code: courses.code,
      title: courses.title,
      units: courses.units,
      groupNumber: course_offerings.groupNumber,
      capacity: course_offerings.capacity,
      enrolledCount: course_offerings.enrolledCount,
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
      eq(course_offerings.universityId, myUni),   // 🔒 مرز دانشگاه
    ));

  // 🎯 هدف‌گیری (G1): چیدمان خودکار هم فقط از ارائه‌های قابل‌دیدنِ این دانشجو
  //    (مقطع/رشته/بازهٔ ورودی) انتخاب می‌کند.
  const studentScope = { degreeLevelId: me.degreeLevelId, majorId: me.majorId ?? null, entryYear: me.entryYear };
  const visibleOfferings = offerings.filter(o => offeringVisible(o, studentScope));

  // ۳. دریافت زمان‌بندی کلاس‌ها و امتحانات ارائه‌ها
  const allScheds = await db.select().from(schedules);
  const schedMap = new Map<
    number,
    {
      classes: { dayOfWeek: number; startTime: string; endTime: string }[];
      exam?: { examDate: string; startTime: string; endTime: string };
    }
  >();

  for (const s of allScheds) {
    if (!schedMap.has(s.offeringId)) schedMap.set(s.offeringId, { classes: [] });
    const entry = schedMap.get(s.offeringId)!;
    if (s.scheduleType === 'CLASS' && s.dayOfWeek != null) {
      entry.classes.push({ dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime });
    } else if (s.scheduleType === 'EXAM' && s.examDate) {
      entry.exam = { examDate: String(s.examDate), startTime: s.startTime, endTime: s.endTime };
    }
  }

  // ۴. دسته‌بندی ارائه‌ها بر اساس درس + ترتیب بر اساس ترم چارت (ترم‌های قبل اول)
  const allowedByChart = chartPicks ? new Set(chartPicks.map(p => p.courseId)) : null;
  const semOfCourse = new Map<number, number | null>(
    (chartPicks ?? []).map(p => [p.courseId, p.recommendedSemester])
  );

  const byCourse = new Map<number, typeof offerings>();
  for (const off of visibleOfferings) {
    // اگر چارت حل شده باشد، فقط دروس واجد شرایط همان چارت پیشنهاد می‌شوند
    if (allowedByChart && !allowedByChart.has(off.courseId)) continue;
    if (!passesPrereqs(off.courseId)) continue;
    if (registeredCourseIds.has(off.courseId)) continue;
    if (me.degreeLevelId === 1 && (off.code.startsWith('21') || off.title.includes('پایان‌نامه'))) continue;
    if (off.title.includes('معرفی به استاد') || off.title.includes('مطالعه فردی')) continue;

    if (!byCourse.has(off.courseId)) byCourse.set(off.courseId, []);
    byCourse.get(off.courseId)!.push(off);
  }

  // ۵. الگوریتم انتخاب بهینه گروه‌ها بدون تداخل و با اولویت ظرفیت خالی
  const chosenOfferings: typeof offerings = [];
  let totalUnits = 0;
  let conflictsAvoidedCount = 0;

  const orderedCourses = [...byCourse.entries()].sort((a, b) => {
    const sa = semOfCourse.get(a[0]) ?? 99;
    const sb = semOfCourse.get(b[0]) ?? 99;
    if (sa !== sb) return sa - sb;
    return a[0] - b[0];
  });

  for (const [courseId, groups] of orderedCourses) {
    const courseUnits = Number(groups[0].units || 0);
    if (totalUnits + courseUnits > maxUnitsLimit) continue;

    // رتبه‌بندی گروه‌ها بر اساس:
    // ۱) عدم تداخل کلاسی و امتحانی با دروس انتخاب‌شده تاکنون
    // ۲) داشتن ظرفیت خالی (enrolled < capacity)
    // ۳) شماره گروه کمتر
    let bestGroup: typeof groups[0] | null = null;
    let bestScore = -9999;

    for (const grp of groups) {
      const s = schedMap.get(grp.id);
      const hasCap = grp.enrolledCount < grp.capacity;
      let hasClassConflict = false;
      let hasExamConflict = false;

      // بررسی تداخل با دروس از قبل انتخاب‌شده
      for (const chosen of chosenOfferings) {
        const chSched = schedMap.get(chosen.id);
        if (!chSched || !s) continue;

        // بررسی تداخل کلاسی
        for (const c1 of s.classes) {
          for (const c2 of chSched.classes) {
            if (c1.dayOfWeek === c2.dayOfWeek && timeOverlap(c1.startTime, c1.endTime, c2.startTime, c2.endTime)) {
              hasClassConflict = true;
            }
          }
        }

        // بررسی تداخل امتحانی
        if (s.exam && chSched.exam && s.exam.examDate === chSched.exam.examDate) {
          if (timeOverlap(s.exam.startTime, s.exam.endTime, chSched.exam.startTime, chSched.exam.endTime)) {
            hasExamConflict = true;
          }
        }
      }

      let score = 0;
      if (hasCap) score += 100;
      if (!hasClassConflict) score += 500;
      else score -= 500;
      if (!hasExamConflict) score += 500;
      else score -= 500;

      // ترجیح گروه ۱ اگر شرایط یکسان باشد
      score -= grp.groupNumber * 2;

      if (score > bestScore) {
        bestScore = score;
        bestGroup = grp;
        if ((hasClassConflict || hasExamConflict) && groups.length > 1) {
          conflictsAvoidedCount++;
        }
      }
    }

    // اگر گروه بدون تداخل یافت شد، اضافه می‌شود
    if (bestGroup && bestScore > 0) {
      chosenOfferings.push(bestGroup);
      totalUnits += courseUnits;
    }
  }

  // ۶. ذخیره در سبد دانشجو
  const now = new Date();
  for (const off of chosenOfferings) {
    await db.transaction(tx =>
      tx
        .insert(cart_items)
        .values({ studentId: me.id, offeringId: off.id, createdAt: now })
        .onConflictDoNothing()
    );
  }

  // پیام شفاف: چه چیزی چیده شد و چرا ممکن است کمتر از سقف باشد
  const capNote = `سقف مجاز شما ${maxUnitsLimit} واحد است`;
  if (chosenOfferings.length === 0) {
    return {
      ok: true,
      count: 0,
      units: 0,
      conflictsResolved: 0,
      message: chartResolved
        ? `درسی برای چیدمان خودکار پیدا نشد. ${capNote}. ممکن است دروس واجد شرایط قبلاً گذرانده شده یا پیش‌نیازشان کامل نشده باشد؛ برای اخذ بدون رعایت پیش‌نیاز از «درخواست بایپس» استفاده کنید.`
        : `درسی برای چیدمان خودکار پیدا نشد. ${capNote}.`,
    };
  }
  const minNote = minAllowedUnits > 0
    ? ` حداقل واحد این ترم ${minAllowedUnits} واحد است.`
    : '';
  return {
    ok: true,
    count: chosenOfferings.length,
    units: totalUnits,
    conflictsResolved: conflictsAvoidedCount,
    message: `چیدمان هوشمند انجام شد: ${chosenOfferings.length} درس (${totalUnits} واحد) با بررسی ظرفیت، پیش‌نیاز، تداخل کلاسی و امتحانی در سبد شما چیده شد. ${capNote}.${minNote}`,
  };
}

/**
 * ورود به اتاق انتظار — پاسخ فوری با شمارهٔ نوبت (§۱۰۱۶ + §۶۹۰۶).
 *
 * اگر Redis پایین باشد، صف وجود ندارد. در آن حالت *ثبت را رها نمی‌کنیم*:
 * همین‌جا مستقیم روی دیتابیس پردازش می‌شود (`direct`). همهٔ قواعد سخت —
 * سقف واحد، پیش‌نیاز، ظرفیت، تداخل کلاس و امتحان، بدهی مالی — داخل همان
 * `processQueuedSubmit` و روی دیتابیس اعمال می‌شوند؛ صف فقط برای مهار هجوم
 * همزمان است، نه برای درستیِ ثبت. پیش از این، قطعی Redis یعنی «هیچ دانشجویی
 * نمی‌تواند انتخاب واحد کند».
 */
export async function submitCartAction(acceptSameDayRisk = false): Promise<{
  queued: boolean; ticketId: string; position: number; limited?: boolean;
  direct?: boolean; result?: SubmitResult; error?: string;
}> {
  const og = await assertServerActionOrigin();
  if (!og.ok) return { queued: false, ticketId: '', position: 0, error: og.error };
  const { user, me } = await ctx();

  // سپر نرخ (§۲۰۷۷): بیش از ۵ درخواست ثبت در ثانیه → رد سریع
  if (!(await rateLimitSubmit(user.id))) {
    return { queued: false, ticketId: '', position: 0, limited: true };
  }

  if (!(await redisAvailable())) {
    const result = await processQueuedSubmit(user.id, me.id, acceptSameDayRisk);
    return { queued: false, direct: true, ticketId: '', position: 0, result };
  }

  ensureWorker(); // کارگر صف در همین فرایند Next فعال است

  // فاز ۱۰: اگر کاربر دو امتحانِ هم‌روز (شیفت‌های متفاوت) را با «تأیید عواقب» پذیرفت،
  // همین پرچم در بلیت صف می‌ماند تا در کارگر صف، در ردیف ثبت‌نام ذخیره شود.
  try {
    const { ticket, position } = await enqueueSubmit(user.id, me.id, acceptSameDayRisk);
    return { queued: true, ticketId: ticket.id, position };
  } catch {
    // Redis وسط کار افتاد → همان مسیر مستقیم
    const result = await processQueuedSubmit(user.id, me.id, acceptSameDayRisk);
    return { queued: false, direct: true, ticketId: '', position: 0, result };
  }
}

/** پیش‌نمایش تداخل امتحانی سبد (قبل از ثبت): HARD = قطعی (همان روز + هم‌ساعت)، SOFT = نرم (هم‌روز، ساعت متفاوت) */
export async function previewExamConflictsAction(): Promise<{
  ok: boolean;
  hard: { courseCode: string; title: string; examDate: string; startTime: string; withCourse: string }[];
  soft: { courseCode: string; title: string; examDate: string; startTime: string; withCourse: string }[];
}> {
  const { user, me, term } = await ctx();
  if (!term) return { ok: false, hard: [], soft: [] };
  const cart = await db.select().from(cart_items).where(eq(cart_items.studentId, me.id));
  const cartIds = cart.map(c => c.offeringId);
  const own = await db
    .select({ offeringId: enrollments.offeringId })
    .from(enrollments)
    .where(and(eq(enrollments.studentId, me.id), inArray(enrollments.status, ['REGISTERED', 'PENDING_COUNCIL'])));
  const allIds = [...new Set([...cartIds, ...own.map(o => o.offeringId)])];
  if (allIds.length < 2) return { ok: true, hard: [], soft: [] };

  const rows = await db
    .select({
      offeringId: schedules.offeringId,
      courseCode: courses.code,
      title: courses.title,
      examDate: schedules.examDate,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
    })
    .from(schedules)
    .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(and(eq(schedules.scheduleType, 'EXAM'), sql`${schedules.examDate} is not null`, inArray(schedules.offeringId, allIds)));

  const hard: { courseCode: string; title: string; examDate: string; startTime: string; withCourse: string }[] = [];
  const soft: { courseCode: string; title: string; examDate: string; startTime: string; withCourse: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (!a.examDate || String(a.examDate) !== String(b.examDate)) continue;
      const aS = String(a.startTime).slice(0, 5), aE = String(a.endTime).slice(0, 5);
      const bS = String(b.startTime).slice(0, 5), bE = String(b.endTime).slice(0, 5);
      const info = { courseCode: a.courseCode, title: a.title, examDate: String(a.examDate), startTime: aS, withCourse: b.courseCode };
      if (aS < bE && bS < aE) hard.push(info);
      else soft.push(info);
    }
  }
  return { ok: true, hard, soft };
}

import { emergencyDropAction, emergencyDropFormAction } from '../actions';

export { emergencyDropAction, emergencyDropFormAction };

export async function referCouncilAction(offeringId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const og = await assertServerActionOrigin();
  if (!og.ok) return { ok: false, error: og.error };
  const { user, me, term, myUni } = await ctx();
  if (!term) return { ok: false, error: 'ترم جاری یافت نشد.' };
  // 🔒 فقط ارائهٔ همین دانشگاه و همین ترم — وگرنه درخواست معرفی به کمیته
  //    برای درسی از دانشگاه/نیمسال دیگر ثبت می‌شد.
  const target = await offeringInMyScope(myUni, term.id, offeringId);
  if (!target) return { ok: false, error: 'این ارائه برای دانشگاه/نیمسال شما در دسترس نیست' };
  const [o] = await db
    .select({ title: courses.title })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(eq(course_offerings.id, target.id));

  // ثبت PENDING_COUNCIL + پروندهٔ گردش کار
  const [ins] = await db.transaction(tx =>
    tx
      .insert(enrollments)
      .values({ studentId: me.id, offeringId, status: 'PENDING_COUNCIL' })
      .onConflictDoUpdate({ target: [enrollments.studentId, enrollments.offeringId], set: { status: 'PENDING_COUNCIL' } })
      .returning({ id: enrollments.id })
  );

  const [proc] = await db.select().from(process_definitions).where(eq(process_definitions.code, 'PREREQ_WAIVER')).limit(1);
  if (proc) {
    const [firstStep] = await db
      .select()
      .from(process_steps)
      .where(eq(process_steps.processId, proc.id))
      .orderBy(process_steps.stepOrder)
      .limit(1);
    const tracking = 'WR-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 90 + 10);
    const [req] = await db.transaction(tx =>
      tx
        .insert(student_requests)
        .values({
          trackingCode: tracking,
          studentId: me.id,
          processId: proc.id,
          currentStepId: firstStep?.id ?? null,
          status: 'SUBMITTED',
          formData: JSON.stringify({ offeringId, offeringTitle: o?.title ?? '', reasons: reason ? [reason] : ['خطای نرم انتخاب واحد'] }),
          relatedEnrollmentId: ins?.id ?? null,
        })
        .returning({ id: student_requests.id })
    );
    if (req && ins) await db.transaction(tx => tx.update(enrollments).set({ workflowRequestId: req.id }).where(eq(enrollments.id, ins.id)));
  }

  await db.transaction(tx =>
    tx.delete(cart_items).where(and(eq(cart_items.studentId, me.id), eq(cart_items.offeringId, offeringId)))
  );
  await db.transaction(tx =>
    tx.insert(notifications).values({
      userId: user.id,
      eventCode: 'COUNCIL_REFERRAL',
      payload: JSON.stringify({ course: o?.title ?? '', termId: term.id }),
    })
  );
  return { ok: true };
}

// ───────────────────── درخواست بدون رعایت محدودیت (پیش‌نیاز/تداخل امتحانی) ─────────────────────
export async function requestBypassAction(
  offeringId: number,
  kind: 'PREREQ' | 'EXAM_CONFLICT',
): Promise<{ ok: boolean; error?: string }> {
  const og = await assertServerActionOrigin();
  if (!og.ok) return { ok: false, error: og.error };
  const { me, term, myUni } = await ctx();
  if (!term) return { ok: false, error: 'ترم جاری یافت نشد.' };
  if (kind !== 'PREREQ' && kind !== 'EXAM_CONFLICT') return { ok: false, error: 'نوع درخواست نامعتبر است.' };

  const target = await offeringInMyScope(myUni, term.id, offeringId);
  if (!target) return { ok: false, error: 'این ارائه برای دانشگاه/نیمسال شما در دسترس نیست' };

  if (!offeringVisible(
    { targetDegreeLevelId: target.targetDegreeLevelId, targetMajorId: target.targetMajorId, entryYearStart: target.entryYearStart, entryYearEnd: target.entryYearEnd },
    { degreeLevelId: me.degreeLevelId, majorId: me.majorId ?? null, entryYear: me.entryYear },
  )) {
    return { ok: false, error: 'این ارائه به مقطع/رشته/سال ورودی شما اختصاص ندارد.' };
  }

  // ✅ برای پیش‌نیاز: درخواست فقط وقتی معنا دارد که واقعاً پیش‌نیاز پاس نشده باشد
  if (kind === 'PREREQ') {
    const prereqCtx = await buildPrereqContext(me.id);
    const node = prereqCtx.ruleByCourse.get(target.courseId);
    if (node && evaluateLogicTree(node, prereqCtx.passed, prereqCtx).ok) {
      return { ok: false, error: 'پیش‌نیاز این درس را پاس کرده‌اید؛ نیازی به درخواست نیست.' };
    }
  }

  // ✅ برای تداخل امتحانی: درخواست فقط وقتی معنا دارد که واقعاً تداخل امتحانی وجود داشته باشد
  if (kind === 'EXAM_CONFLICT') {
    const targetExams = await db.select({
      examDate: schedules.examDate, startTime: schedules.startTime, endTime: schedules.endTime,
    }).from(schedules).where(and(eq(schedules.offeringId, offeringId), eq(schedules.scheduleType, 'EXAM')));
    if (targetExams.length === 0) {
      return { ok: false, error: 'برای این درس جلسهٔ امتحانی ثبت نشده است.' };
    }
    const regRows = await db.select({ offeringId: enrollments.offeringId })
      .from(enrollments)
      .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
      .where(and(
        eq(enrollments.studentId, me.id),
        eq(course_offerings.termId, term.id),
        inArray(enrollments.status, ['REGISTERED', 'PENDING_COUNCIL']),
      ));
    const regIds = regRows.map(r => r.offeringId);
    const regExams = regIds.length
      ? await db.select({ examDate: schedules.examDate, startTime: schedules.startTime, endTime: schedules.endTime })
          .from(schedules).where(and(inArray(schedules.offeringId, regIds), eq(schedules.scheduleType, 'EXAM')))
      : [];
    const hasConflict = targetExams.some(te =>
      regExams.some(re =>
        te.examDate && re.examDate &&
        String(te.examDate) === String(re.examDate) &&
        timeOverlap(te.startTime, te.endTime, re.startTime, re.endTime)
      )
    );
    if (!hasConflict) {
      return { ok: false, error: 'تداخل امتحانی برای این درس با دروس ثبت‌شدهٔ شما یافت نشد.' };
    }
  }

  const res = await createBypassRequest({ studentId: me.id, offeringId, kind });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

export async function cancelBypassAction(requestId: number): Promise<{ ok: boolean; error?: string }> {
  const og = await assertServerActionOrigin();
  if (!og.ok) return { ok: false, error: og.error };
  const { me } = await ctx();
  return cancelBypassRequest(requestId, me.id);
}

