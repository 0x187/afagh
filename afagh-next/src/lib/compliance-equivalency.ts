// ════════════════════════════════════════════════════════════════════════════
//  گام ۵ — دروازهٔ خالص معادلسازی (مادهٔ ۱۲ + اصلاحیهٔ ۲/۱۵۵۶۵۵)
//
//  تمام قواعدی که در ممیزی «انجام نشده» بودند اینجا پیاده شدهاند و همه از
//  `ComplianceValues` تغذیه میکنند ⇒ پیشفرض قانونی، ولی همگی قابل اوررایداند.
//  خالص است (بدون DB) تا بتوان آن را در تست واحد و در هر دو مسیر (گردشکار و
//  موتور ثبت دستهای) دقیقاً یکسان صدا زد.
// ════════════════════════════════════════════════════════════════════════════
import { j2d } from './calendar';
import type { ComplianceValues } from './compliance-policy';

/** تاریخ شمسی «YYYY/MM/DD» → شمارهٔ روز ژولیانی؛ نامعتبر ⇒ null */
export function jalaliDay(date: unknown): number | null {
  const s = String(date ?? '').trim().replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const m = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  try { return j2d(y, mo, d); } catch { return null; }
}

/** اختلاف دو تاریخ شمسی بر حسب سال (کسر سال، مبنای ۳۶۵٫۲۴۲۵ روز) */
export function jalaliYearsBetween(from: unknown, to: unknown): number | null {
  const a = jalaliDay(from), b = jalaliDay(to);
  if (a === null || b === null) return null;
  return (b - a) / 365.2425;
}

export interface EquivalencyCheckInput {
  studentStatus: string;
  /** WITHDRAWAL | EXPELLED | MAJOR_CHANGE | TRANSFER | null */
  exitType?: string | null;
  /** تاریخ انصراف/اخراج در دورهٔ قبلی (شمسی) — مبدأ قانون جاری پنج سال */
  exitDate?: string | null;
  /** تاریخ گذراندن درس (فقط برای مبدأ قدیمی/تطبیق) */
  coursePassDate?: string | null;
  entryYear: number;
  /** تاریخ امروز شمسی — تزریقپذیر برای تست */
  today?: string;
  /** آیا درسها تا تاریخ ابلاغ اصلاحیه گذرانده شدهاند؟ (بند ۲ قاعدهٔ گذار) */
  passedBeforeNotification?: boolean;
  /** نسخهٔ برنامهٔ درسی وزارت تغییر نکرده و دانشگاه مقصد تأیید کرده است */
  curriculumUnchanged?: boolean;
  destinationConfirmed?: boolean;
  curriculumVersionCode?: string | null;
  destinationCurriculumVersionCode?: string | null;
  /** ضریب کیفیت دانشگاه/رشتهٔ مبدأ (بند ج) */
  qualityCoefficient?: number | null;
  /** دورهٔ مبدأ منتهی به مدرک رسمی شده است (بند ب) */
  sourceLedToOfficialDegree?: boolean;
  requestedUnits: number;
  totalProgramUnits: number;
  alreadyEquivalencedUnits: number;
  sourceGrade?: number | null;
}

export interface EquivalencyVerdict {
  ok: boolean;
  reasons: string[];
  warnings: string[];
  /** سقف مجاز واحدها (null = بدون سقف) */
  maxUnits: number | null;
  /** واحدهای قابل پذیرش پس از اعمال سقف */
  acceptedUnits: number;
  transitionRuleApplied: boolean;
  overMaxYearsExceptionApplied: boolean;
}

/**
 * بررسی کامل یک درخواست معادلسازی. ترتیب گاردها طوری است که پیامها از
 * «مانع قانونی قطعی» به «هشدار دادهٔ ناقص» مرتب شوند.
 */
export function evaluateEquivalency(
  v: ComplianceValues,
  input: EquivalencyCheckInput,
): EquivalencyVerdict {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let transitionRuleApplied = false;
  let overMaxYearsExceptionApplied = false;

  // (الف) حداقل نمره — مقطعی ۱۲ / ۱۴ / ۱۶
  if (input.sourceGrade != null && input.sourceGrade < v.equiv_min_grade) {
    reasons.push(`نمرهٔ ${input.sourceGrade} کمتر از حداقل مجاز ${v.equiv_min_grade} برای این مقطع است (مادهٔ ۱۲ الف).`);
  }

  // (ب) منع معادلسازی از دورهٔ منتهی به مدرک رسمی
  if (v.equiv_official_degree_exclusion && input.sourceLedToOfficialDegree) {
    reasons.push('دروس متعلق به دورهای که منتهی به مدرک رسمی شده است قابل معادلسازی مجدد نیست (مادهٔ ۱۲ ب).');
  }

  // (ج) ضریب کیفیت دانشگاه/رشتهٔ مبدأ
  if (v.equiv_quality_coefficient_required) {
    const q = input.qualityCoefficient;
    if (q == null || !Number.isFinite(Number(q))) {
      warnings.push('ضریب کیفیت دانشگاه/رشتهٔ مبدأ ثبت نشده است؛ پیش از تأیید نهایی باید احراز شود (مادهٔ ۱۲ ج).');
    } else if (Number(q) <= 0) {
      reasons.push('ضریب کیفیت مبدأ نامعتبر است (مادهٔ ۱۲ ج).');
    }
  }

  // مبدأ پنج سال: «از زمان انصراف یا اخراج دانشجو در دورهٔ قبلی»
  const anchorDate = v.equiv_clock_anchor === 'EXIT_DATE'
    ? (input.exitDate ?? (input.exitType ? null : input.coursePassDate))
    : (input.coursePassDate ?? input.exitDate);
  const isWithdrawalOrExpulsion =
    v.equiv_cap_statuses.includes(String(input.studentStatus || '').toUpperCase()) ||
    ['WITHDRAWAL', 'EXPELLED'].includes(String(input.exitType || '').toUpperCase());

  if (!anchorDate) {
    warnings.push(
      v.equiv_clock_anchor === 'EXIT_DATE'
        ? 'تاریخ انصراف/اخراج در پرونده ثبت نشده است؛ قاعدهٔ پنج سال قابل احراز نیست. لطفاً از «پروندهٔ دانشجو» تکمیل شود (اصلاحیهٔ ۲/۱۵۵۶۵۵).'
        : 'تاریخ گذراندن درس ثبت نشده است؛ قاعدهٔ پنج سال قابل احراز نیست.',
    );
  } else if (input.today) {
    const years = jalaliYearsBetween(anchorDate, input.today);
    if (years != null && years > v.equiv_max_years) {
      const unchanged =
        input.curriculumUnchanged === true ||
        (!!input.curriculumVersionCode && input.curriculumVersionCode === input.destinationCurriculumVersionCode);
      const confirmed = input.destinationConfirmed !== false;
      if (v.equiv_allow_over_max_years_if_curriculum_unchanged && unchanged && confirmed) {
        overMaxYearsExceptionApplied = true;
      } else {
        reasons.push(
          `از ${v.equiv_clock_anchor === 'EXIT_DATE' ? 'تاریخ انصراف/اخراج' : 'تاریخ گذراندن درس'} بیش از ${v.equiv_max_years} سال گذشته است` +
          (v.equiv_allow_over_max_years_if_curriculum_unchanged
            ? ' و استثنای «عدم تغییر برنامهٔ درسی وزارت + تأیید دانشگاه مقصد» احراز نشده است.'
            : '.'),
        );
      }
    }
  }

  if (v.equiv_require_destination_confirmation && !input.destinationConfirmed && !overMaxYearsExceptionApplied) {
    warnings.push('تأیید دانشگاه مقصد مبنی بر عدم تغییر محتوای برنامهٔ درسی ثبت نشده است (تبصرهٔ الحاقی).');
  }

  // بند ۲ اصلاحیه: قاعدهٔ گذار برای ورودیهای ۱۴۰۳-۱۴۰۲ و ۱۴۰۴-۱۴۰۳
  const inTransition = v.equiv_transition_entry_years.map(Number).includes(Number(input.entryYear));
  if (inTransition) {
    transitionRuleApplied = true;
    if (input.passedBeforeNotification === true) {
      warnings.push(
        `ورودی ${input.entryYear} مشمول بند ۲ اصلاحیه است: فقط دروسی که تا ${v.equiv_notification_date} گذرانده نشدهاند مشمول قاعدهٔ جدیداند.`,
      );
    }
  }

  // بند ۴: سقف ۵۰٪ فقط انصرافی/اخراجی؛ تغییر رشته و انتقال بدون سقف
  let maxUnits: number | null = null;
  if (isWithdrawalOrExpulsion) {
    const total = Math.max(0, Number(input.totalProgramUnits) || 0);
    maxUnits = total > 0 ? (total * Math.min(100, Math.max(0, v.equiv_cap_percent))) / 100 : null;
    const used = Math.max(0, Number(input.alreadyEquivalencedUnits) || 0);
    const free = maxUnits == null ? Infinity : Math.max(0, maxUnits - used);
    const requested = Math.max(0, Number(input.requestedUnits) || 0);
    if (requested > free) {
      reasons.push(
        `سقف معادلسازی برای دانشجوی انصرافی/اخراجی ${v.equiv_cap_percent}٪ از ${total} واحد (${maxUnits ?? '—'} واحد) است؛ ` +
        `پیشتر ${used} واحد معادل شده و ${requested} واحد دیگر درخواست شده است (مادهٔ ۱۲ بند ۴).`,
      );
    }
  }

  const acceptedUnits = Math.max(0, Number(input.requestedUnits) || 0);
  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    maxUnits,
    acceptedUnits,
    transitionRuleApplied,
    overMaxYearsExceptionApplied,
  };
}

/** متن پویای حداقل نمره برای فرم رسمی ممهور (قبلاً «۱۲» هاردکد بود). */
export function equivalenceFormMinGradeNote(v: ComplianceValues): string {
  return `حداقل نمرهٔ قابل پذیرش برای معادلسازی ${v.equiv_min_grade} از ۲۰ است (مادهٔ ۱۲ الف، بر اساس مقطع تحصیلی).`;
}
