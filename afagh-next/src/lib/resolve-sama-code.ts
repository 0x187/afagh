/**
 * حل کد وضعیت نمرهٔ سما بر اساس تعریف درس و آیین‌نامهٔ آموزشی دانشجو
 *
 * منطق بر اساس دستور رسمی:
 * ۱) بررسی جدول دروس (courses):
 *    - تعیین حد نصاب قبولی: ابتدا minPassedMark خودِ درس (اگر تعریف شده باشد)، سپس کاتالوگ، سپس حد نصاب آیین‌نامه، سپس ۱۰.
 *    - در صورت قبولی (gradeValue >= passingGrade):
 *      اگر درس دارای defaultAcceptMarkState باشد (مانند کد ۱۲ برای جبرانی، ۴۴ برای پیش‌دانشگاهی،
 *      ۴۰ برای معرفی به استاد، ۵۰ برای خودخوان و ...)، دقیقاً از این کد تعریفی در جدول درس استفاده می‌شود.
 *    - در صورت مردودی (gradeValue < passingGrade):
 *      اگر درس دارای defaultRejectMarkState غیراستاندارد باشد (مانند کد ۲۲ جبرانی مردود،
 *      ۵۱ خودخوان مردود و ...)، از این کد تعریفی در جدول درس استفاده می‌شود.
 *
 * ۲) توجه به آیین‌نامه‌های آموزشی (educational_regulations):
 *    - در صورت مردودی، اگر درس کد رد خاصی نداشته باشد:
 *      بررسی تقدم و تأخر زمانی ترم‌ها (termChronologicalValue):
 *      تنها در صورتی کد حذف آیین‌نامه اعمال می‌شود (۹۳۱، -۹۱، ۹۴۱) که دانشجو این درس را در
 *      یکی از نیمسال‌های زمانی بعدی با موفقیت گذرانده باشد.
 *      اگر هنوز قبولی بعدی ثبت نشده باشد، وضعیت نمره درس عادی - مردود (کد ۲) باقی می‌ماند.
 *      اگر قبولی بعدی حذف یا لغو شود، وضعیت مجدداً به کد ۲ بازمی‌گردد.
 */
import 'server-only';

import { db } from '@/db';
import {
  courses,
  curriculum_courses,
  students,
  course_offerings,
  educational_regulations,
  academic_terms,
  enrollments,
} from '@/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { resolveStudentCurriculum } from './curriculum-apply';
import { isPassedStatusCode, REGULATION_FROZEN_CODES, resolveRetakeBar } from './grade-status-codes';
import { logGradeChange } from './grade-change-log';

const DEFAULT_PASS_CODE = '1';
const DEFAULT_FAIL_CODE = '2';

import { termChronologicalValue } from './term-chronology';

/**
 * تشخیص کد وضعیت آیین‌نامه برای نمره مردودی
 */
function getRegulationFailExcludeCode(
  studentRegTitle?: string | null,
  regCfg?: any,
): string | null {
  const regFailedCode = regCfg?.grading_and_gpa?.failed_sama_status_code;
  if (regFailedCode && String(regFailedCode).trim()) {
    return String(regFailedCode).trim();
  }

  const regPolicy = regCfg?.grading_and_gpa?.failed_course_gpa_policy;
  if (regPolicy === 'EXCLUDE_IF_PASSED_1391') {
    return '-91'; // آیین‌نامه ۱۳۹۱
  }
  // کد ۹۴۱ مخصوص مقطع ارشد/آیین‌نامه ۱۳۹۴ است — قبل از سیاست عمومی بررسی می‌شود
  // تا سیاست EXCLUDE_IF_PASSED آن را به اشتباه ۹۳۱ نکند
  if (studentRegTitle?.includes('۹۴') || studentRegTitle?.includes('94')) {
    return '941'; // آیین‌نامه ۱۳۹۴ ارشد
  }
  if (studentRegTitle?.includes('۹۵') || studentRegTitle?.includes('95')) {
    return '951'; // آیین‌نامه ۱۳۹۵ دکتری
  }
  // EXCLUDE_ALWAYS: مردودی با کد عادی «۲» در ریزنمرات میماند؛ حذف فقط در
  // معدل کل توسط هستهٔ تجمیع انجام میشود (دادنامهٔ دیوان)، نه با کد حذف سما.
  if (regPolicy === 'EXCLUDE_ALWAYS') return null;
  if (regPolicy === 'EXCLUDE_IF_PASSED') {
    return '931'; // آییننامه ۱۳۹۳
  }
  return null;
}

/**
 * کد وضعیت سما را بر اساس نمرهٔ دانشجو، تعریف درس، سوابق تحصیلی و آیین‌نامه برمی‌گرداند.
 */
export async function resolveSamaGradeStatusCode(
  studentId: number,
  offeringId: number,
  gradeValue: string | number | null,
  currentCode?: string | null,
): Promise<string | null> {
  // بدون نمره چیزی برای حل نیست — کد فعلی حفظ می‌شود (نه پاک‌سازی!)
  if (gradeValue == null || gradeValue === '') return (currentCode || '').trim() || null;

  const numGrade = Number(gradeValue);
  // نمرهٔ غیرعددی هم چیزی را عوض نمی‌کند — کد فعلی حفظ می‌شود
  if (!Number.isFinite(numGrade)) return (currentCode || '').trim() || null;

  // ۱) پیدا کردن دانشجو و آیین‌نامهٔ مربوطه
  const [student] = await db
    .select({
      id: students.id,
      studentCode: students.studentCode,
      entryYear: students.entryYear,
      regulationId: students.regulationId,
      regTitle: educational_regulations.title,
      regConfig: educational_regulations.rulesConfig,
    })
    .from(students)
    .leftJoin(educational_regulations, eq(educational_regulations.id, students.regulationId))
    .where(eq(students.id, studentId))
    .limit(1);
  if (!student) return null;

  // ۲) پیدا کردن ارائه + مشخصات خودِ درس از جدول courses و ترم
  const [offering] = await db
    .select({
      courseId: course_offerings.courseId,
      termId: course_offerings.termId,
      termSortOrder: academic_terms.sortOrder,
      termCode: academic_terms.termCode,
      defaultAccept: courses.defaultAcceptMarkState,
      defaultReject: courses.defaultRejectMarkState,
      courseMinMark: courses.minPassedMark,
      gradingType: courses.gradingType,
    })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .leftJoin(academic_terms, eq(academic_terms.id, course_offerings.termId))
    .where(eq(course_offerings.id, offeringId))
    .limit(1);
  if (!offering) return null;

  const courseDefaultPass = offering.defaultAccept?.trim() || null;
  const courseDefaultFail = offering.defaultReject?.trim() || null;

  // ۳) پارس تنظیمات آیین‌نامه
  let regCfg: any = null;
  try {
    regCfg = student.regConfig ? JSON.parse(student.regConfig) : null;
  } catch {
    regCfg = null;
  }

  // ۴) پیدا کردن تخصیص کاتالوگ (در صورت وجود)
  let cc: { passGradeStatusCode?: string | null; failGradeStatusCode?: string | null; minGrade?: unknown } | undefined;
  try {
    const { version } = await resolveStudentCurriculum(studentId);
    if (version) {
      const [row] = await db
        .select({
          passGradeStatusCode: curriculum_courses.passGradeStatusCode,
          failGradeStatusCode: curriculum_courses.failGradeStatusCode,
          minGrade: curriculum_courses.minGrade,
        })
        .from(curriculum_courses)
        .where(and(
          eq(curriculum_courses.curriculumVersionId, version.id),
          eq(curriculum_courses.courseId, offering.courseId),
        ))
        .limit(1);
      cc = row;
    }
  } catch {
    cc = undefined;
  }

  // ۵) تعیین حد نصاب قبولی: اول minPassedMark خودِ درس، بعد کاتالوگ، بعد آیین‌نامه، بعد ۱۰
  let passingGrade = 10;
  const courseMin = offering.courseMinMark != null ? Number(offering.courseMinMark) : NaN;
  const ccMin = cc?.minGrade != null ? Number(cc.minGrade) : NaN;
  const regPass = regCfg?.grading_and_gpa?.default_passing_grade != null ? Number(regCfg.grading_and_gpa.default_passing_grade) : NaN;

  if (Number.isFinite(courseMin) && courseMin > 0) {
    passingGrade = courseMin;
  } else if (Number.isFinite(ccMin) && ccMin > 0) {
    passingGrade = ccMin;
  } else if (Number.isFinite(regPass) && regPass > 0) {
    passingGrade = regPass;
  }

  const passed = offering.gradingType === 'DESCRIPTIVE' ? numGrade === 1 : numGrade >= passingGrade;

  // ۶) تعیین کد وضعیت سما
  if (passed) {
    if (courseDefaultPass && courseDefaultPass !== '1') {
      return courseDefaultPass;
    }
    if (cc?.passGradeStatusCode?.trim()) {
      return cc.passGradeStatusCode.trim();
    }
    return courseDefaultPass || DEFAULT_PASS_CODE;
  } else {
    // کد فعلیِ منجمد (۵/۶/۷/۲۲) هرگز با منطق آیین‌نامه عوض نمی‌شود
    const frozen = (currentCode || '').trim();
    if (frozen && REGULATION_FROZEN_CODES.has(frozen)) return frozen;
    // اولویت ۱: اگر درس کد رد خاصی در جدول دروس داشته باشد (مثل ۲۲ برای جبرانی مردود، ۵۱ برای خودخوان)
    if (courseDefaultFail && courseDefaultFail !== '2') {
      return courseDefaultFail;
    }
    if (cc?.failGradeStatusCode?.trim() && cc.failGradeStatusCode.trim() !== '2') {
      return cc.failGradeStatusCode.trim();
    }

    // اولویت ۲: آیین‌نامه‌های حذف نمره مردودی (۹۳۱، -۹۱، ۹۴۱، ۹۵۱)
    // طبق دستور صریح: کد آیین‌نامه «فقط» در صورتی اعمال می‌شود که قبولی بعدی در ترم‌های بعد وجود داشته باشد
    // (در تبصره ۱۳۹۱: فقط قبولی با حد نصاب retakeMinGrade)
    const targetExcludeCode = getRegulationFailExcludeCode(student.regTitle, regCfg);
    const retakeNeed = resolveRetakeBar(
      regCfg?.grading_and_gpa?.failed_course_gpa_policy,
      regCfg?.grading_and_gpa?.retakeMinGrade,
      passingGrade,
    );

    if (targetExcludeCode) {
      const currentChrono = termChronologicalValue(offering.termCode, offering.termSortOrder);

      const otherEnrollments = await db
        .select({
          gradeValue: enrollments.gradeValue,
          gradeStatus: enrollments.gradeStatus,
          samaGradeStatusCode: enrollments.samaGradeStatusCode,
          termSortOrder: academic_terms.sortOrder,
          termCode: academic_terms.termCode,
        })
        .from(enrollments)
        .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
        .leftJoin(academic_terms, eq(academic_terms.id, course_offerings.termId))
        .where(and(
          eq(enrollments.studentId, studentId),
          eq(course_offerings.courseId, offering.courseId),
        ));

      const hasLaterPass = otherEnrollments.some(e => {
        const otherChrono = termChronologicalValue(e.termCode, e.termSortOrder);
        // الزام تقدم و تأخر زمانی: قبولی باید در ترم بعد باشد
        if (otherChrono <= currentChrono) return false;

        const isExemptOrNoGrade = e.gradeStatus === 'EXEMPT' || e.gradeStatus === 'PASSED_NO_GRADE' || isPassedStatusCode(e.samaGradeStatusCode);
        if (isExemptOrNoGrade) return true;

        if (e.gradeStatus !== 'FINALIZED') return false;
        const g = Number(e.gradeValue);
        if (!Number.isFinite(g)) return false;
        if (offering.gradingType === 'DESCRIPTIVE') return g === 1;
        return g >= (retakeNeed ?? passingGrade);
      });

      if (hasLaterPass) {
        return targetExcludeCode;
      }
    }

    // در صورت عدم وجود قبولی بعدی یا عدم شمول آیین‌نامه، نمره درس عادی - مردود (۲) باقی می‌ماند
    return courseDefaultFail || DEFAULT_FAIL_CODE;
  }
}

/**
 * همگام‌سازی زنجیره‌ای آیین‌نامهٔ آموزشی برای تمام نوبت‌های اخذ یک درس توسط دانشجو
 *
 * هرگاه نمره‌ای برای درسی ثبت، تغییر، یا حذف شود:
 * ۱) تمام نوبت‌های اخذ آن درس بر اساس ترتیب زمانی ترم‌ها مرتب می‌شوند.
 * ۲) وضعیت قبولی هر نوبت بررسی می‌شود.
 * ۳) برای هر نوبت مردودی:
 *    - اگر قبولی بعدی در ترم‌های آینده وجود داشته باشد: به ۹۳۱ (یا -۹۱، ۹۴۱) ارتقا می‌یابد.
 *    - اگر قبولی بعدی وجود نداشته باشد: به ۲ بازگردانده می‌شود.
 * ۴) تغییرات در دیتابیس اعمال و در grade_change_log ثبت می‌شوند.
 */
export async function syncStudentCourseRegulations(
  studentId: number,
  courseId: number,
  options?: {
    actorUserId?: number;
    actorRole?: 'ADMIN' | 'GRADUATEAFFAIRS';
  },
): Promise<{ updatedCount: number }> {
  // ۱) استخراج دانشجو و آیین‌نامه
  const [student] = await db
    .select({
      id: students.id,
      regTitle: educational_regulations.title,
      regConfig: educational_regulations.rulesConfig,
    })
    .from(students)
    .leftJoin(educational_regulations, eq(educational_regulations.id, students.regulationId))
    .where(eq(students.id, studentId))
    .limit(1);
  if (!student) return { updatedCount: 0 };

  let regCfg: any = null;
  try {
    regCfg = student.regConfig ? JSON.parse(student.regConfig) : null;
  } catch {
    regCfg = null;
  }

  const targetExcludeCode = getRegulationFailExcludeCode(student.regTitle, regCfg);

  // ۲) استخراج خودِ درس
  const [course] = await db
    .select({
      id: courses.id,
      minPassedMark: courses.minPassedMark,
      gradingType: courses.gradingType,
      defaultReject: courses.defaultRejectMarkState,
    })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  if (!course) return { updatedCount: 0 };

  const courseMin = course.minPassedMark != null ? Number(course.minPassedMark) : NaN;
  const regPass = regCfg?.grading_and_gpa?.default_passing_grade != null ? Number(regCfg.grading_and_gpa.default_passing_grade) : NaN;
  const passingGrade = Number.isFinite(courseMin) && courseMin > 0 ? courseMin : (Number.isFinite(regPass) && regPass > 0 ? regPass : 10);
  // حد نصاب قبولی مجدد (فقط تبصره ۱۳۹۱): قبولی بعدیِ پایین‌تر از این، مردودی قبلی را حذف نمی‌کند
  const retakeBar = resolveRetakeBar(
    regCfg?.grading_and_gpa?.failed_course_gpa_policy,
    regCfg?.grading_and_gpa?.retakeMinGrade,
    passingGrade,
  );

  // ۳) استخراج کلیه نوبت‌های اخذ این درس برای دانشجو
  const rows = await db
    .select({
      enrollmentId: enrollments.id,
      offeringId: enrollments.offeringId,
      gradeValue: enrollments.gradeValue,
      gradeStatus: enrollments.gradeStatus,
      samaGradeStatusCode: enrollments.samaGradeStatusCode,
      originalSamaCode: enrollments.originalSamaCode,
      termId: course_offerings.termId,
      termCode: academic_terms.termCode,
      termSortOrder: academic_terms.sortOrder,
    })
    .from(enrollments)
    .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .leftJoin(academic_terms, eq(academic_terms.id, course_offerings.termId))
    .where(and(
      eq(enrollments.studentId, studentId),
      eq(course_offerings.courseId, courseId),
    ));

  if (rows.length === 0) return { updatedCount: 0 };

  // مرتب‌سازی زمانی بر اساس ترتیب ترم
  const sortedRows = [...rows].sort((a, b) => {
    const ca = termChronologicalValue(a.termCode, a.termSortOrder);
    const cb = termChronologicalValue(b.termCode, b.termSortOrder);
    return ca - cb;
  });

  // بررسی وضعیت قبولی هر نوبت
  const isPassed = (r: typeof sortedRows[number]): boolean => {
    if (r.gradeStatus === 'EXEMPT' || r.gradeStatus === 'PASSED_NO_GRADE') return true;
    if (isPassedStatusCode(r.samaGradeStatusCode)) return true;
    if (r.gradeStatus !== 'FINALIZED') return false;
    const g = Number(r.gradeValue);
    if (!Number.isFinite(g)) return false;
    return course.gradingType === 'DESCRIPTIVE' ? g === 1 : g >= passingGrade;
  };

  const passFlags = sortedRows.map(r => isPassed(r));
  let updatedCount = 0;

  // قبولیِ واجد شرایط برای حذف مردودی قبلی (تبصره ۱۳۹۱: با حد نصاب retake)
  const isQualifyingPass = (r: typeof sortedRows[number]): boolean => {
    if (r.gradeStatus === 'EXEMPT' || r.gradeStatus === 'PASSED_NO_GRADE') return true;
    if (isPassedStatusCode(r.samaGradeStatusCode)) return true;
    if (r.gradeStatus !== 'FINALIZED') return false;
    const g = Number(r.gradeValue);
    if (!Number.isFinite(g)) return false;
    if (course.gradingType === 'DESCRIPTIVE') return g === 1;
    return g >= (retakeBar ?? passingGrade);
  };
  const hasQualifyingLaterPass = (i: number): boolean => {
    for (let j = i + 1; j < sortedRows.length; j++) {
      if (isQualifyingPass(sortedRows[j])) return true;
    }
    return false;
  };

  for (let i = 0; i < sortedRows.length; i++) {
    const current = sortedRows[i];
    if (passFlags[i]) continue; // رکوردهای قبولی دست‌نخورده می‌مانند
    // فقط نوبت‌های نهایی‌شده بازمحاسبه می‌شوند — ردیف بدون نمره (در حال اخذ/PENDING)
    // نباید کد حذف آیین‌نامه (۹۳۱/-۹۱/…) بگیرد، حتی اگر همان درس بعداً پاس شود
    if (current.gradeStatus !== 'FINALIZED') continue;

    // نکته: رکوردِ تازه‌ویرایش‌شده هم باید توسط آیین‌نامه کنترل شود تا کد دستی اشتباه باقی نماند

    // کدهای خاص دانشجویی/اداری نباید توسط آیین‌نامه دستکاری شوند:
    // معادل‌سازی (۳،۱۶،۱۷،۳۲)، معرفی به استاد (۴۰)، پیش‌دانشگاهی (۴۴)، خودخوان (۵۰،۵۱،۵۳)،
    // حذف‌ها (۶،۷،۸،۹،۱۴)، غیبت (۵)، جبرانی مردود بدون احتساب (۲۲) و کدهای نامشخص.
    // به‌ویژه ۵ (غیبت)، ۶ (اضطراری)، ۷ (شورا) و ۲۲ (جبرانی مردود) در آیین‌نامه ۹۳
    // و جدیدترها هرگز تغییر نمی‌کنند — حتی اگر بعداً همان درس پاس شود؛ وگرنه
    // نمرهٔ بی‌اثر قبلی (مثلاً با ۹۳۱ که در معدل ترم اثر دارد) معدل را به‌هم می‌ریزد.
    // فقط کدهای عمومی (۱،۲،۱۱)، کدهای نوع درس (۱۲،۲۳،۲۴) و کدهای آیین‌نامه‌ای (۹۳۱،-۹۱،۹۴۱،۹۵۱) قابل بازمحاسبه‌اند.
    const oldCode = current.samaGradeStatusCode?.trim() || null;
    const origCode = current.originalSamaCode?.trim() || null;
    // خودترمیمی: اگر کد اصلی منجمد (۵/۶/۷/۲۲) بوده ولی کد فعلی (یا پاک‌شده)
    // با منطق آیین‌نامه به کد دیگری رفته، به کد اصلی برگردان — برای همهٔ آیین‌نامه‌ها
    if (origCode && REGULATION_FROZEN_CODES.has(origCode) && (!oldCode || !REGULATION_FROZEN_CODES.has(oldCode))) {
      await db
        .update(enrollments)
        .set({ samaGradeStatusCode: origCode })
        .where(eq(enrollments.id, current.enrollmentId));

      await logGradeChange({
        enrollmentId: current.enrollmentId,
        studentId,
        offeringId: current.offeringId,
        action: 'REGULATION_CASCADE',
        oldGradeValue: current.gradeValue,
        newGradeValue: current.gradeValue,
        oldGradeStatus: current.gradeStatus,
        newGradeStatus: current.gradeStatus,
        oldSamaStatusCode: oldCode,
        newSamaStatusCode: origCode,
        reason: `بازگردانی خودکار کد منجمد ${origCode} (کد ${oldCode ?? '—'} به‌اشتباه با آیین‌نامه نشسته بود)`,
        actorUserId: options?.actorUserId,
        actorRole: options?.actorRole,
      });

      updatedCount++;
      continue;
    }
    if (oldCode && ['3', '4', '5', '6', '7', '14', '16', '17', '18', '22', '32', '40', '44', '50', '51', '53', '52', '300', '400', '-1', '-5', '-4', '-3', '0', '8', '9', '10', '13', '15', '19', '20', '28', '29', '36', '46'].includes(oldCode)) {
      continue;
    }

    // اگر درس کد رد خاصی در جدول دروس دارد که ۲ نیست (مانند ۲۲ یا ۵۱)، آن را تغییر ندهیم
    const curCustomFail = course.defaultReject?.trim() || null;
    if (curCustomFail && curCustomFail !== '2' && curCustomFail !== '931' && curCustomFail !== '-91' && curCustomFail !== '941') {
      continue;
    }

    // قبولی واجد شرایط حذف مردودی قبلی: در تبصره ۱۳۹۱ فقط قبولی با حد نصاب
    // retakeMinGrade (مثلاً ۱۴)؛ در بقیه سیاست‌ها همان قبولی عادی.
    // (بدون این قید، کدهای -۹۱ قدیمیِ زیر حد هم «بعداً پاس شده» حساب می‌شدند و می‌ماندند.)
    const hasLaterPass = hasQualifyingLaterPass(i);

    // نوبت مردود بدون قبولی بعدی به کد مردودی عمومی برمی‌گردد.
    // (کدهای محافظت‌شدهٔ ۵/۶/۷/۲۲ بالاتر ادامه پیدا نمی‌کنند و به اینجا نمی‌رسند.)
    const defaultFail = DEFAULT_FAIL_CODE;
    const newCode = hasLaterPass ? (targetExcludeCode || defaultFail) : defaultFail;

    if (newCode !== oldCode) {
      await db
        .update(enrollments)
        .set({ samaGradeStatusCode: newCode })
        .where(eq(enrollments.id, current.enrollmentId));

      await logGradeChange({
        enrollmentId: current.enrollmentId,
        studentId,
        offeringId: current.offeringId,
        action: 'REGULATION_CASCADE',
        oldGradeValue: current.gradeValue,
        newGradeValue: current.gradeValue,
        oldGradeStatus: current.gradeStatus,
        newGradeStatus: current.gradeStatus,
        oldSamaStatusCode: oldCode,
        newSamaStatusCode: newCode,
        reason: hasLaterPass
          ? `تبدیل خودکار نمره مردودی به کد حذف آیین‌نامه (${newCode}) پس از قبولی در ترم بعد`
          : `بازگشت خودکار کد مردودی به ۲ پس از حذف/عدم احراز قبولی بعدی`,
        actorUserId: options?.actorUserId,
        actorRole: options?.actorRole,
      });

      updatedCount++;
    }
  }

  return { updatedCount };
}
