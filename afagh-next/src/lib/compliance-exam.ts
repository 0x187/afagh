// ════════════════════════════════════════════════════════════════════════════
//  گام ۴ — موجودیت/قواعد «ارزیابی جامع» دکتری (مادهٔ ۴۱) و نمرهٔ کیفی
//
//  پیش از این فقط یک گزارش عمومی «واجدین آزمون جامع» وجود داشت. اینجا قواعد
//  خالصاند تا هم دروازهٔ فراغت، هم گزارش ادمین و هم فرم ثبت نمره یک حکم بدهند.
// ════════════════════════════════════════════════════════════════════════════
import type { ComplianceValues } from './compliance-policy';

export interface ComprehensiveExamInput {
  gpa: number | null;
  languageProficiencyConfirmed: boolean;
  attemptsUsed: number;
  /** نمرهٔ آخرین ارزیابی جامع ثبتشده */
  lastGrade: number | null;
  /** کد جایگزین تأییدشدهٔ مادهٔ ۴۴ (مثلاً GPA_18 / ARTICLE_ISI / PATENT) */
  approvedAlternative: string | null;
  alternativeConfirmed: boolean;
  /** شمارهٔ نیمسال فعلی */
  currentSemester: number;
  proposalApprovedSemester: number | null;
  supervisorAssignedSemester: number | null;
}

export interface ComprehensiveExamVerdict {
  eligibleToSit: boolean;
  passed: boolean;
  reasons: string[];
  warnings: string[];
  maxAttempts: number;
  remainingAttempts: number;
}

/** نمرهٔ کیفی پایاننامه/رساله خارج از معدل است و در دروازهٔ فراغت جدا بررسی میشود. */
export function isQualitativeThesisPassed(grade: string | null, v: ComplianceValues): boolean | null {
  if (!grade) return null;
  const labels = v.thesis_qualitative_labels;
  if (v.thesis_grade_mode !== 'QUALITATIVE') {
    const n = Number(grade);
    return Number.isFinite(n) ? n >= 10 : null;
  }
  const idx = labels.findIndex(l => l.trim() === grade.trim());
  if (idx < 0) return null;
  // آخرین برچسب «مردود» است
  return idx < labels.length - 1;
}

export function evaluateComprehensiveExam(
  v: ComplianceValues,
  input: ComprehensiveExamInput,
): ComprehensiveExamVerdict {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!v.comprehensive_exam_required) {
    return {
      eligibleToSit: true, passed: true, reasons: [],
      warnings: ['الزام ارزیابی جامع توسط مدیر خاموش شده است (اورراید).'],
      maxAttempts: v.comprehensive_exam_max_attempts,
      remainingAttempts: Math.max(0, v.comprehensive_exam_max_attempts - input.attemptsUsed),
    };
  }

  const remaining = Math.max(0, v.comprehensive_exam_max_attempts - input.attemptsUsed);
  const altOk = !!input.approvedAlternative &&
    v.comprehensive_exam_alternatives.includes(input.approvedAlternative) &&
    input.alternativeConfirmed;

  // مهلتهای مادههای ۳۲/۳۳/۴۵
  if (input.supervisorAssignedSemester == null) {
    warnings.push(`استاد راهنما هنوز معرفی نشده است؛ مهلت تا نیمسال ${v.supervisor_deadline_semester} است.`);
  } else if (input.supervisorAssignedSemester > v.supervisor_deadline_semester) {
    reasons.push(`معرفی استاد راهنما پس از نیمسال ${v.supervisor_deadline_semester} انجام شده است (مادهٔ ۴۵).`);
  }
  if (input.proposalApprovedSemester == null) {
    warnings.push(`پیشنهاده هنوز تصویب نشده است؛ مهلت تا نیمسال ${v.proposal_deadline_semester} است.`);
  } else if (input.proposalApprovedSemester > v.proposal_deadline_semester) {
    reasons.push(`تصویب پیشنهاده پس از نیمسال ${v.proposal_deadline_semester} انجام شده است (مادهٔ ۴۵).`);
  }

  if ((input.gpa ?? 0) < v.comprehensive_exam_min_gpa) {
    reasons.push(`معدل کل ${input.gpa ?? '—'} کمتر از ${v.comprehensive_exam_min_gpa} لازم برای ورود به ارزیابی جامع است (مادهٔ ۴۱).`);
  }
  if (v.comprehensive_exam_language_required && !input.languageProficiencyConfirmed) {
    reasons.push('بسندگی زبان خارجی احراز نشده است (مادهٔ ۴۱).');
  }

  const gradePassed = input.lastGrade != null && input.lastGrade >= v.comprehensive_exam_pass_grade;
  const passed = gradePassed || altOk;
  if (!passed && remaining === 0 && !altOk) {
    reasons.push(`هر ${v.comprehensive_exam_max_attempts} بار مجاز شرکت در ارزیابی جامع مصرف شده است (فقط یک بار تجدید، مادهٔ ۴۱).`);
  }
  if (altOk) {
    warnings.push(`جایگزین مادهٔ ۴۴ («${input.approvedAlternative}») بهعنوان جانشین ارزیابی جامع پذیرفته شد.`);
  }
  if (!passed && remaining > 0) {
    warnings.push(`${remaining} نوبت دیگر برای شرکت در ارزیابی جامع باقی است.`);
  }

  return {
    eligibleToSit: reasons.length === 0 && remaining > 0,
    passed,
    reasons,
    warnings,
    maxAttempts: v.comprehensive_exam_max_attempts,
    remainingAttempts: remaining,
  };
}

/** تاریخ دانشآموختگی = تاریخ دفاع، مگر اینکه مدیر مبنای دستی را اورراید کند. */
export function graduationDateOf(v: ComplianceValues, defenseDate: string | null, manualDate: string | null): string | null {
  if (v.graduation_date_source === 'DEFENSE_DATE') return defenseDate ?? manualDate;
  return manualDate ?? defenseDate;
}
