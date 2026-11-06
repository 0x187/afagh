// ════════════════════════════════════════════════════════════════════════════
//  آداپتورهای سروریِ «سیاستهای انطباق» — نقطهٔ تماس موتورهای قدیمی با لایهٔ
//  جدید. هر آداپتور:
//    • مقادیر حلشده (پیشفرض قانونی / اورراید مدیر) را میگیرد،
//    • قاعدهٔ خالص مربوطه را صدا میزند،
//    • و در صورت خطا/نبود جدول، بیدرنگ به رفتار قبلی سقوط میکند (fail-safe)
//      تا استقرار روی محیط نیمههمگام هیچ مسیری را نشکند.
// ════════════════════════════════════════════════════════════════════════════
import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  class_sessions,
  comprehensive_exams,
  defense_sessions,
  enrollments,
  student_class_attendance,
} from '@/db/schema';
import { getComplianceValues, getStudentCompliance, makeContext } from './compliance-policy-server';
import {
  evaluateAbsence,
  gradeObjectionDeadline,
  legalDefaults,
  type ComplianceValues,
} from './compliance-policy';
import {
  evaluateComprehensiveExam,
  graduationDateOf,
  isQualitativeThesisPassed,
} from './compliance-exam';
import {
  evaluateEquivalency,
  type EquivalencyCheckInput,
  type EquivalencyVerdict,
} from './compliance-equivalency';
import { toJalaliFromDate } from './calendar';

/** تاریخ امروز شمسی «YYYY/MM/DD» — تزریقپذیر نیست، ولی قاعدۀ خالص تستپذیر است. */
export function todayJalaliString(): string {
  const j = toJalaliFromDate(new Date());
  return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
}

/** سیاستهای سراسری/دانشگاهی بدون بافت دانشجو (برای قواعد غیرشخصی مثل غیبت). */
export async function globalCompliance(universityId?: number | null): Promise<ComplianceValues> {
  try {
    return await getComplianceValues(await makeContext({ universityId }));
  } catch {
    // اگر حتی لایهٔ سیاستها در دسترس نبود، پیشفرضهای قانونی خالص کافیاند
    return legalDefaults({ family: 'REG_1402', level: 'LONG', entryYear: 1405, universityId });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  گام ۳ / مادهٔ ۷ — غیبت ۳/۱۶ ⇒ نمرهٔ صفر هنگام نهاییسازی
// ════════════════════════════════════════════════════════════════════════════

/**
 * بعد از ذخیرهٔ حضور و غیاب، پرچم «مشمول نمرهٔ صفر» را روی enrollments
 * بهروزمیکند. نمره خودش اینجا نوشته نمیشود (تا اختیار استاد در نهاییسازی
 * حفظ شود)؛ اعمال صفر در `professor/grades/actions.ts` هنگام FINALIZED انجام
 * میشود. اورراید `absence_auto_zero = false` کل رفتار را خاموش میکند.
 */
export async function refreshAbsencePenalties(
  offeringIds: readonly number[],
  universityId?: number | null,
): Promise<{ checked: number; flagged: number }> {
  const ids = [...new Set(offeringIds.map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!ids.length) return { checked: 0, flagged: 0 };
  const v = await globalCompliance(universityId);
  try {
    const sessions = await db
      .select({ id: class_sessions.id, offeringId: class_sessions.offeringId })
      .from(class_sessions)
      .where(inArray(class_sessions.offeringId, ids));
    if (!sessions.length) return { checked: 0, flagged: 0 };

    const sessionsByOffering = new Map<number, number>();
    const sessionIds: number[] = [];
    for (const s of sessions) {
      sessionsByOffering.set(s.offeringId, (sessionsByOffering.get(s.offeringId) ?? 0) + 1);
      sessionIds.push(s.id);
    }

    const attendance = await db
      .select({
        enrollmentId: student_class_attendance.enrollmentId,
        status: student_class_attendance.status,
        sessionId: student_class_attendance.sessionId,
      })
      .from(student_class_attendance)
      .where(inArray(student_class_attendance.sessionId, sessionIds));

    // تعداد جلسات هر عرضه برای محاسبهٔ نسبت ۳/۱۶ (مبنای قانونی = مخرج سیاست)
    const enrOfferings = await db
      .select({ id: enrollments.id, offeringId: enrollments.offeringId })
      .from(enrollments)
      .where(inArray(enrollments.offeringId, ids));
    const offeringOf = new Map(enrOfferings.map(e => [e.id, e.offeringId]));

    const counters = new Map<number, { absences: number; excused: number }>();
    for (const a of attendance) {
      const c = counters.get(a.enrollmentId) ?? { absences: 0, excused: 0 };
      if (a.status === 'ABSENT') c.absences++;
      else if (a.status === 'EXCUSED') c.excused++;
      counters.set(a.enrollmentId, c);
    }

    const flagged: number[] = [];
    const allIds = [...new Set([...enrOfferings.map(e => e.id), ...counters.keys()])];
    for (const enrollmentId of allIds) {
      const c = counters.get(enrollmentId) ?? { absences: 0, excused: 0 };
      const offeringId = offeringOf.get(enrollmentId) ?? ids[0];
      const totalSessions = Math.max(
        v.absence_ratio_denominator,
        sessionsByOffering.get(offeringId) ?? v.absence_ratio_denominator,
      );
      const verdict = evaluateAbsence(v, {
        absences: c.absences,
        totalSessions,
        excused: c.excused,
        justifiedExcused: true,
      });
      if (verdict.zeroGrade) flagged.push(enrollmentId);
    }

    if (allIds.length) {
      await db.update(enrollments).set({ absencePenalty: 0 }).where(inArray(enrollments.id, allIds));
    }
    if (flagged.length) {
      await db.update(enrollments).set({ absencePenalty: 1 }).where(inArray(enrollments.id, flagged));
    }
    return { checked: allIds.length, flagged: flagged.length };
  } catch {
    return { checked: 0, flagged: 0 };
  }
}

/** مادهٔ ۸: مهلت اعتراض = اعلام نمره + ۱۰/۲۰ روز، مگر مهلت صریح مدیر. */
export async function objectionDeadlineFor(
  studentId: number,
  gradeAnnouncedAt: Date | string | null,
): Promise<Date | null> {
  try {
    const v = (await getStudentCompliance(studentId)).values;
    return gradeObjectionDeadline(v, gradeAnnouncedAt);
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  گام ۴ / مادهٔ ۴۱ — دروازهٔ ارزیابی جامع دکتری و نمرهٔ کیفی رساله
// ════════════════════════════════════════════════════════════════════════════

export async function comprehensiveExamGraduationReasons(
  studentId: number,
  gpa: number | null,
): Promise<string[]> {
  try {
    const sc = await getStudentCompliance(studentId);
    const v = sc.values;
    if (sc.ctx?.level !== 'PHD' || !v.comprehensive_exam_required) return [];
    const attempts = await db.select().from(comprehensive_exams)
      .where(eq(comprehensive_exams.studentId, studentId));
    const last = attempts.length
      ? attempts.reduce((a, b) => (Number(a.attemptNo) > Number(b.attemptNo) ? a : b))
      : null;
    const verdict = evaluateComprehensiveExam(v, {
      gpa,
      languageProficiencyConfirmed: attempts.some(a => Number(a.languageConfirmed) === 1),
      attemptsUsed: attempts.length,
      lastGrade: last?.gradeValue != null ? Number(last.gradeValue) : null,
      approvedAlternative: last?.alternativeCode ?? null,
      alternativeConfirmed: Number(last?.alternativeConfirmed ?? 0) === 1,
      currentSemester: 0,
      proposalApprovedSemester: null,
      supervisorAssignedSemester: null,
    });
    if (verdict.passed) return [];
    const reasons = verdict.reasons.filter(r => /تجدید|معدل|زبان|پیشنهاده|استاد راهنما/.test(r));
    return reasons.length ? reasons : [
      'ارزیابی جامع دکتری (مادهٔ ۴۱) با نمرهٔ قبولی ثبت نشده و جایگزین مادهٔ ۴۴ تأیید نشده است.',
    ];
  } catch {
    return []; // جدول پیش از مهاجرت وجود ندارد ⇒ مسدودسازی بیدلیل ممنوع
  }
}

/** مواد ۳۶ و ۴۸: نمرهٔ کیفی پایاننامه/رساله خارج از معدل، فقط در دروازهٔ فراغت. */
export async function thesisQualitativeGraduationReasons(studentId: number): Promise<string[]> {
  try {
    const v = (await getStudentCompliance(studentId)).values;
    if (v.thesis_grade_mode !== 'QUALITATIVE') return [];
    const sessions = await db.select({
      qualitativeGrade: defense_sessions.qualitativeGrade,
      result: defense_sessions.result,
    }).from(defense_sessions).where(eq(defense_sessions.studentId, studentId));
    const graded = sessions.filter(s => !!s.qualitativeGrade);
    if (!graded.length) return []; // هنوز نمرهای ثبت نشده ⇒ جلوگیری از پسرفت رفتاری
    if (graded.some(s => isQualitativeThesisPassed(s.qualitativeGrade, v) === true)) return [];
    return ['نمرهٔ کیفی پایاننامه/رساله مردود است یا در درجات مجاز ثبت نشده (مواد ۳۶ و ۴۸)؛ این نمره خارج از معدل محاسبه میشود.'];
  } catch {
    return [];
  }
}

/** مواد ۳۸ و ۵۰: تاریخ دانشآموختگی = تاریخ دفاع، مگر اورراید مبنای دستی. */
export async function graduationDateFor(
  studentId: number,
  manualDate: string | null,
): Promise<string | null> {
  try {
    const v = (await getStudentCompliance(studentId)).values;
    const [row] = await db.select({
      defenseDate: defense_sessions.defenseDate,
      scheduledAt: defense_sessions.scheduledAt,
    }).from(defense_sessions).where(eq(defense_sessions.studentId, studentId)).limit(1);
    const auto = row?.defenseDate ?? (row?.scheduledAt ? String(row.scheduledAt).slice(0, 10) : null);
    return graduationDateOf(v, auto, manualDate);
  } catch {
    return manualDate;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  گام ۵ / مادهٔ ۱۲ — دروازهٔ معادلسازی با دادهٔ ساختاریافتۀ پرونده
// ════════════════════════════════════════════════════════════════════════════

export async function effectiveEquivLimits(studentId: number): Promise<{ minGrade: number; termUnits: number }> {
  try {
    const v = (await getStudentCompliance(studentId)).values;
    return { minGrade: v.equiv_min_grade, termUnits: v.equiv_term_units };
  } catch {
    return { minGrade: 12, termUnits: 20 };
  }
}

/** حداقل نمرهٔ معادلسازی بدون بافت دانشجو (برای فرمها و اکشنهای گردشکار). */
export async function effectiveEquivMinGrade(studentId?: number | null): Promise<number> {
  return (await effectiveEquivLimits(studentId ?? 0)).minGrade;
}

/** دروازهٔ کامل مادهٔ ۱۲ اصلاحی؛ فیلدهای پروندهای بهصورت خودکار تزریق میشوند. */
export async function equivalencyGate(
  studentId: number,
  input: Partial<EquivalencyCheckInput> & Pick<EquivalencyCheckInput, 'requestedUnits' | 'totalProgramUnits' | 'alreadyEquivalencedUnits'>,
): Promise<EquivalencyVerdict> {
  const sc = await getStudentCompliance(studentId).catch(() => null);
  const v = sc?.values ?? await globalCompliance();
  const merged: EquivalencyCheckInput = {
    studentStatus: input.studentStatus ?? sc?.studentStatus ?? 'ACTIVE',
    exitType: input.exitType ?? sc?.exitType ?? null,
    exitDate: input.exitDate ?? sc?.exitDate ?? null,
    coursePassDate: input.coursePassDate ?? null,
    entryYear: input.entryYear ?? sc?.ctx?.entryYear ?? 1405,
    today: input.today ?? todayJalaliString(),
    passedBeforeNotification: input.passedBeforeNotification,
    curriculumUnchanged: input.curriculumUnchanged,
    destinationConfirmed: input.destinationConfirmed ?? sc?.destinationConfirmed,
    curriculumVersionCode: input.curriculumVersionCode ?? null,
    destinationCurriculumVersionCode: input.destinationCurriculumVersionCode ?? null,
    qualityCoefficient: input.qualityCoefficient ?? sc?.qualityCoefficient,
    sourceLedToOfficialDegree: input.sourceLedToOfficialDegree ?? sc?.sourceLedToOfficialDegree,
    requestedUnits: input.requestedUnits,
    totalProgramUnits: input.totalProgramUnits,
    alreadyEquivalencedUnits: input.alreadyEquivalencedUnits,
    sourceGrade: input.sourceGrade ?? null,
  };
  return evaluateEquivalency(v, merged);
}

/** گام ۲: کف قبولی از «یک منبع حقیقت» (سیاست انطباق) بهجای degree_level_configs. */
export async function effectivePassingGrade(studentId: number, fallback: number): Promise<number> {
  try {
    const v = (await getStudentCompliance(studentId)).values;
    return v.single_source_passing_grade ? v.default_passing_grade : fallback;
  } catch {
    return fallback;
  }
}
