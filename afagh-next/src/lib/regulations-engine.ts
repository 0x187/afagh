import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { getSetting } from '@/lib/settings';
import { resolveStudentCurriculum } from '@/lib/curriculum-apply';
import {
  process_definitions,
  degree_level_configs,
  educational_regulations,
  students,
  enrollments,
  course_offerings,
  courses,
  academic_terms,
  student_requests,
  users,
  universities,
  legacy_grades,
} from '@/db/schema';
import {
  RegulationConfig,
  DEFAULT_BACHELOR_REGULATION_1403,
  DEFAULT_BACHELOR_REGULATION_1390,
  DEFAULT_MASTER_REGULATION_1403,
  applyLevelConfig,
  maghtaGroup,
} from './regulations-types';
import { getStudentCompliance } from './compliance-policy-server';
import { countableSemesters, type ComplianceValues } from './compliance-policy';
import {
  GpaAccumulator,
  aggregateOfficialGpaRows,
  parseGrade,
  parseUnits,
  round2,
} from './gpa-aggregation';

/**
 * ابزارهای عددی و انباشتگرِ معدل از ماژول خالصِ `gpa-aggregation` می‌آیند تا هر
 * دو موتور (آیین‌نامه و فارغ‌التحصیلی) و تست واحد، یک پیاده‌سازی داشته باشند.
 * اینجا باز-export می‌شوند تا قراردادِ قدیمیِ `from '@/lib/regulations-engine'`
 * سالم بماند.
 */
export { GpaAccumulator, parseGrade, parseUnits, round2 } from './gpa-aggregation';

export * from './regulations-types';

// ════════════════════════════════════════════════════════════════════════════
// موتور جامع آیین‌نامه‌های آموزشی (Afagh Regulation Engine)
// ════════════════════════════════════════════════════════════════════════════

/**
 * هر چند واحد معادل‌سازی = یک ترم کسر از سنوات.
 * 🔗 منبع واحد (M-3): enroll-engine از همین ثابت استفاده می‌کند.
 */
export const EQUIV_SEMESTER_UNITS = 20;

/**
 * بازیابی یا ایجاد پیش‌فرض آیین‌نامه برای یک دانشجو یا مقطع.
 * نرمال‌سازی سید/رکوردهای قدیمی با کلیدهای تخت فاز صفر به اسکیمای تودرتو
 * (seed اولیه failed_course_gpa_policy و probation_gpa_threshold را در ریشه می‌نوشت؛
 * بدون این نگاشت، رکورد نامعتبر دانسته شده و پیش‌فرض هاردکد برمی‌گشت).
 */
export function normalizeLegacyRegulationConfig(parsed: unknown): Record<string, unknown> & { grading_and_gpa?: Record<string, unknown>; probation_and_tenure?: Record<string, unknown>; regular_term_rules?: Record<string, unknown> } {
  if (!parsed || typeof parsed !== 'object') return parsed as Record<string, unknown>;
  const p = parsed as Record<string, unknown>;
  if (p.grading_and_gpa && typeof p.grading_and_gpa === 'object') return p as never;
  const out: Record<string, unknown> = { ...p };
  const num = (v: unknown): number | undefined => {
    const n = v != null ? Number(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const gpa: Record<string, unknown> = {};
  if (typeof p.failed_course_gpa_policy === 'string') gpa.failed_course_gpa_policy = p.failed_course_gpa_policy;
  const dpg = num(p.default_passing_grade);
  if (dpg !== undefined) gpa.default_passing_grade = dpg;
  const rmg = num(p.retakeMinGrade);
  if (rmg !== undefined) gpa.retakeMinGrade = rmg;
  if (Object.keys(gpa).length) { out.grading_and_gpa = gpa; }
  const tenure: Record<string, unknown> = {};
  const pgt = num(p.probation_gpa_threshold);
  if (pgt !== undefined) tenure.probation_gpa_threshold = pgt;
  const mtp = num((p as Record<string, unknown>).max_total_probations ?? p.max_allowed_probations);
  if (mtp !== undefined) tenure.max_total_probations = mtp;
  const mss = num(p.max_study_semesters);
  if (mss !== undefined) tenure.max_study_semesters = mss;
  if (Object.keys(tenure).length) { out.probation_and_tenure = tenure; }
  const rules = out.regular_term_rules;
  if (rules && typeof rules === 'object') {
    const r = rules as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...r };
    const gmax = num((r as Record<string, unknown>).gpaA_MaxUnits);
    if (gmax !== undefined) merged.honors_max_units = gmax;
    const gthr = num((p as Record<string, unknown>).gpaA_threshold);
    if (gthr !== undefined) merged.honors_min_gpa = gthr;
    out.regular_term_rules = merged;
  }
  return out as never;
}

/**
 * نقطهٔ واحد حل سیاستهای انطباق. اگر جدول اورراید/مهاجرت هنوز وجود نداشته
 * باشد null برمیگرداند و موتور دقیقاً همان رفتار قبلی را ادامه میدهد (fail-safe).
 */
async function complianceFor(studentId: number): Promise<ComplianceValues | null> {
  try { return (await getStudentCompliance(studentId)).values; } catch { return null; }
}

export async function getRegulationConfig(regulationId?: number | null, degreeLevelId?: number | null): Promise<RegulationConfig> {
  if (!regulationId && !degreeLevelId) return DEFAULT_BACHELOR_REGULATION_1403;

  try {
    // یک رفت‌وبرگشت به‌جای دو کوئری متوالی: هر دو شرط با OR واکشی و در حافظه
    // اولویت‌بندی می‌شوند (آیین‌نامهٔ اختصاصی دانشجو مقدم بر آیین‌نامهٔ مقطع است).
    const conditions = [
      regulationId ? eq(educational_regulations.id, regulationId) : undefined,
      degreeLevelId ? eq(educational_regulations.degreeLevelId, degreeLevelId) : undefined,
    ].filter(Boolean);

    const rows = await db
      .select()
      .from(educational_regulations)
      .where(conditions.length === 1 ? conditions[0] : or(...conditions))
      .limit(20);

    const preferred = regulationId ? rows.find(r => r.id === regulationId) : undefined;
    const fallback = degreeLevelId ? rows.find(r => r.degreeLevelId === degreeLevelId) : undefined;

    for (const reg of [preferred, fallback]) {
      if (!reg?.rulesConfig) continue;
      const parsed = normalizeLegacyRegulationConfig(
        typeof reg.rulesConfig === 'string' ? JSON.parse(reg.rulesConfig) : reg.rulesConfig,
      ) as unknown as RegulationConfig;
      if (parsed && typeof parsed === 'object' && parsed.grading_and_gpa) {
        const merged: RegulationConfig = { ...DEFAULT_BACHELOR_REGULATION_1403, ...parsed };
        // تفاوت‌های مقطعی (فقط نیمسال/سنوات) از levels اعمال می‌شود
        if (merged.levels && degreeLevelId) {
          try {
            const [deg] = await db
              .select({ code: degree_level_configs.code })
              .from(degree_level_configs)
              .where(eq(degree_level_configs.id, degreeLevelId))
              .limit(1);
            if (deg?.code) return applyLevelConfig(merged, maghtaGroup(deg.code));
          } catch { /* fallback بدون levels */ }
        }
        return merged;
      }
    }
  } catch (err) {
    console.error('Error fetching regulation config:', err);
  }

  // Fallback default
  return DEFAULT_BACHELOR_REGULATION_1403;
}

export interface StudentAcademicSummary {
  studentId: number;
  totalRequiredUnits: number;
  passedUnits: number;
  remainingUnits: number;
  isGraduating: boolean;
  lastTermGpa: number | null;
  isProbatedLastTerm: boolean;
  totalProbations: number;
  completedSemesters: number;
  /** مجموع واحدهای قبول‌شدهٔ معادل‌سازی (EQUIV_PASSED/TRANSFER) */
  equivalenceUnits: number;
  /** تعداد ترم کسرشده از سنوات به ازای هر EQUIV_TERM_UNITS واحد معادل‌سازی */
  equivalenceSemesters: number;
  status: string;
  effectiveMaxUnits: number;
  minAllowedUnits: number;
  isSummer: boolean;
  quotaType: string;
  /** شاگرد ممتاز (تشخیص خودکار از معدل ترم قبل یا اورراید مدیر گروه) */
  isHonors: boolean;
  /** منبع تشخیص ممتازی: AUTO (معدل) یا OVERRIDE (دستی) */
  honorsSource: 'AUTO' | 'OVERRIDE';
  /** واحدهای جبرانیِ ثبت‌شده برای دانشجو (به سقف واحد اضافه می‌شود) */
  compensatoryUnits: number;
  /** سقف واحد پایهٔ آیین‌نامه، پیش از افزودن واحدهای جبرانی */
  baseMaxUnits: number;
  rulesConfig: RegulationConfig;
}

/**
 * محاسبه خلاصه وضعیت تحصیلی، شرایط ترم آخر، سهمیه و سقف مجاز انتخاب واحد
 */
export async function evaluateStudentRegulationStatus(
  studentId: number,
  termId?: number | null
): Promise<StudentAcademicSummary> {
  // ── موج اول: اطلاعات دانشجو + مقطع با یک JOIN، هم‌زمان با واکشی ترم جاری ──
  const [baseRows, termRows] = await Promise.all([
    db
      .select({ stu: students, deg: degree_level_configs })
      .from(students)
      .leftJoin(degree_level_configs, eq(degree_level_configs.id, students.degreeLevelId))
      .where(eq(students.id, studentId))
      .limit(1),
    db
      .select()
      .from(academic_terms)
      .where(termId ? eq(academic_terms.id, termId) : eq(academic_terms.isCurrent, 1))
      .limit(1),
  ]);

  const stu = baseRows[0]?.stu;
  if (!stu) {
    throw new Error('دانشجو یافت نشد.');
  }
  const deg = baseRows[0]?.deg ?? null;
  const currentTerm = termRows[0] ?? null;
  const isSummer = currentTerm?.isSummer === 1;

  // ── موج دوم: آیین‌نامه، نسخهٔ حل‌شدهٔ برنامه و کارنامه؛ هر سه مستقل‌اند و موازی اجرا می‌شوند ──
  // فاز ۵: به‌جای «جدیدترین نسخهٔ دارای پنجره» (بدون توجه به وضعیت)، نسخهٔ
  // قابل اعمال از Resolution (فقط PUBLISHED/ARCHIVED) تعیین می‌شود.
  const [config, resolved, studentEnrollments] = await Promise.all([
    getRegulationConfig(stu.regulationId, stu.degreeLevelId),
    resolveStudentCurriculum(stu.id),
    db
      .select({
        id: enrollments.id,
        offeringId: enrollments.offeringId,
        gradeValue: enrollments.gradeValue,
        gradeStatus: enrollments.gradeStatus,
        status: enrollments.status,
        termId: course_offerings.termId,
        termCode: academic_terms.termCode,
        isSummerTerm: academic_terms.isSummer,
        termTitle: academic_terms.title,
        offeringType: course_offerings.offeringType,
        units: courses.units,
        gradingType: courses.gradingType,
        affectsGpa: courses.affectsGpa,
        code: courses.code,
      })
      .from(enrollments)
      .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
      .leftJoin(academic_terms, eq(academic_terms.id, course_offerings.termId))
      .innerJoin(courses, eq(courses.id, course_offerings.courseId))
      .where(eq(enrollments.studentId, studentId)),
  ]);

  // محاسبه کل واحدهای لازم از نسخهٔ حل‌شده (یا مقدار پیش‌فرض مقطع)
  let totalRequiredUnits = deg?.code?.includes('MASTER') || deg?.title?.includes('ارشد') ? 32 : 140;
  if (resolved.version?.totalRequiredUnits) {
    totalRequiredUnits = Number(resolved.version.totalRequiredUnits);
  }

  const passingGrade = config.grading_and_gpa.default_passing_grade || (deg ? Number(deg.defaultPassingGrade) : 10);
  const probationGpaThreshold = config.probation_and_tenure.probation_gpa_threshold || (deg ? Number(deg.conditionalGpaThreshold) : 12);

  // تجمیع نمرات و واحدها (با حساب صحیح و ردکردن نمرات خالی/نامعتبر)
  let passedUnits = 0;
  let equivalenceUnits = 0;
  const termMap = new Map<number, GpaAccumulator>();
  const termMeta = new Map<number, { isSummer: boolean; isEquiv: boolean; termCode: string }>();

  for (const e of studentEnrollments) {
    if (e.termId && !termMeta.has(e.termId)) {
      const isSummerSem = e.isSummerTerm === 1 || (e.termCode ? e.termCode.endsWith('3') : false) || (e.termTitle ? e.termTitle.includes('تابستان') : false);
      const isEquivSem = (e.termCode ? (e.termCode.endsWith('5') || e.termCode.toUpperCase().includes('EQ')) : false) || (e.termTitle ? e.termTitle.includes('معادل') : false);
      termMeta.set(e.termId, { isSummer: isSummerSem, isEquiv: isEquivSem, termCode: e.termCode || '' });
    }

    if (e.gradeStatus !== 'FINALIZED') continue;
    const g = parseGrade(e.gradeValue);
    if (g === null) continue; // نمرهٔ ثبت‌نشده/خالی هرگز صفر حساب نمی‌شود
    const u = parseUnits(e.units);
    const isPassed = e.gradingType === 'DESCRIPTIVE' ? g === 1 : g >= passingGrade;

    if (isPassed) {
      passedUnits = round2(passedUnits + u);
    }

    /**
     * نوبت‌های معادل‌سازی (وضعیت EQUIV_PASSED یا گروه درسی TRANSFER):
     *  - در معدل کل (calculateOfficialGPA) مؤثرند و آنجا حساب می‌شوند؛
     *  - ولی در معدل هر ترم و مشروطیت منظور نمی‌شوند (معادل‌سازی «بدون مشروطیت» است)؛
     *  - واحدهای قبولی‌شان برای کسر سنوات شمارش می‌شود (هر EQUIV_TERM_UNITS واحد = یک ترم).
     */
    const isEquivalence = e.status === 'EQUIV_PASSED' || e.offeringType === 'TRANSFER';
    if (isEquivalence && isPassed) {
      equivalenceUnits = round2(equivalenceUnits + u);
    }

    // محاسبه معدل به ازای هر ترم (معادل‌سازی excluded)
    if (!isEquivalence && e.termId && (e.affectsGpa === 1 || e.affectsGpa == null) && e.gradingType !== 'DESCRIPTIVE') {
      const acc = termMap.get(e.termId) ?? new GpaAccumulator();
      acc.add(g, u);
      termMap.set(e.termId, acc);
    }
  }

  const remainingUnits = round2(Math.max(0, totalRequiredUnits - passedUnits));
  // تشخیص ترم آخر: باقیمانده کمتر یا مساوی سقف واحد فارغ‌التحصیلی تابستان (معمولاً ۸ واحد) یا سقف ترم عادی (۲۴ واحد)
  const isGraduating = isSummer ? remainingUnits <= (config.summer_term_rules.graduating_max_units || 8) : remainingUnits <= (config.graduating_term_rules.max_units || 24);

  // محاسبه مشروطی‌ها و معدل آخرین ترم
  // طبق آیین‌نامه رسمی دانشگاه‌های ایران، نیمسال تابستان و معادل‌سازی هرگز مشروطی به بار نمی‌آورند
  let totalProbations = 0;
  let lastTermGpa: number | null = null;
  const sortedTermIds = Array.from(termMap.keys()).sort((a, b) => b - a);

  if (sortedTermIds.length > 0) {
    lastTermGpa = termMap.get(sortedTermIds[0])!.rounded();
  }

  for (const [tId, acc] of termMap.entries()) {
    const meta = termMeta.get(tId);
    if (meta?.isSummer || meta?.isEquiv) continue; // نیمسال تابستان و معادل‌سازی مشروطی ندارد
    // مقایسهٔ مشروطی روی معدل دقیق انجام می‌شود، نه معدل گردشده
    const termGpa = acc.exact();
    if (termGpa !== null && termGpa < probationGpaThreshold) {
      totalProbations++;
    }
  }

  // برای تعیین سقف واحد مجاز در ترم‌های عادی، ملاک آخرین ترم عادی دانشجو است (نه دوره تابستان)
  const regularTermIds = sortedTermIds.filter(tId => {
    const meta = termMeta.get(tId);
    return !meta?.isSummer && !meta?.isEquiv;
  });
  const relevantLastTermExact = isSummer
    ? (sortedTermIds.length > 0 ? termMap.get(sortedTermIds[0])!.exact() : null)
    : (regularTermIds.length > 0 ? termMap.get(regularTermIds[0])!.exact() : null);

  const isProbatedLastTerm = relevantLastTermExact !== null && relevantLastTermExact < probationGpaThreshold;
  const isHonorsAuto = relevantLastTermExact !== null && relevantLastTermExact >= config.regular_term_rules.honors_min_gpa;
  /**
   * اورراید مدیر گروه: students.honorsOverride (NULL=خودکار، ۱=ممتاز، ۰=غیرممتاز).
   * تشخیص خودکار فقط بر اساس معدل ترم قبل است؛ مدیر گروه می‌تواند آن را نقض کند.
   */
  const honorsSource: 'AUTO' | 'OVERRIDE' = stu.honorsOverride == null ? 'AUTO' : 'OVERRIDE';
  const isHonors = stu.honorsOverride == null ? isHonorsAuto : stu.honorsOverride === 1;

  // واحدهای جبرانی: از سقف پایهٔ آیین‌نامه جدا نگه داشته می‌شود تا در UI قابل نمایش باشد
  const compensatoryUnits = Math.max(0, Number(stu.compensatoryUnits ?? 0));

  // محاسبه سقف واحد مجاز (Effective Max Units)
  let effectiveMaxUnits = config.regular_term_rules.max_units;
  let minAllowedUnits = config.regular_term_rules.min_units;

  if (isSummer) {
    minAllowedUnits = 0;
    effectiveMaxUnits = config.summer_term_rules.default_max_units;

    if (isGraduating) {
      effectiveMaxUnits = config.summer_term_rules.graduating_max_units;
    }

    // بررسی سهمیه شاهد و ایثارگر در تابستان
    const quota = stu.quotaType || 'NORMAL';
    if (config.quota_overrides && config.quota_overrides[quota]?.summer_term_rules?.default_max_units) {
      effectiveMaxUnits = Math.max(
        effectiveMaxUnits,
        config.quota_overrides[quota]!.summer_term_rules!.default_max_units!
      );
    }
  } else {
    // ترم عادی
    if (isGraduating && config.graduating_term_rules.can_take_with_probation) {
      effectiveMaxUnits = config.graduating_term_rules.max_units; // سقف ۲۴ واحد برای ترم آخر حتی در صورت مشروطی
      minAllowedUnits = 0;
    } else if (isProbatedLastTerm) {
      effectiveMaxUnits = config.regular_term_rules.probation_max_units; // سقف ۱۴ واحد برای مشروط
    } else if (isHonors) {
      effectiveMaxUnits = config.regular_term_rules.honors_max_units; // سقف ۲۴ واحد برای معدل الف (یا مقدار تنظیم‌شده)
    }
  }

  // ترم آخر: کف واحد اعمال نمی‌شود (مثلاً ۸ واحد باقی‌مانده همان‌طور اخذ می‌شود)
  if (isGraduating) minAllowedUnits = 0;

  // دروس جبرانی: سقف همان ترم به اندازهٔ واحدهای جبرانی بالا می‌رود
  // (ترم تابستان مستثنی است؛ دروس جبرانی فقط در ترم ۱ و حداکثر ۲ ارائه می‌شوند)
  const baseMaxUnits = effectiveMaxUnits;
  if (!isSummer && compensatoryUnits > 0) effectiveMaxUnits += compensatoryUnits;

  // تبصرهٔ ۵ مادهٔ ۱۷: نیمسال تابستان جزء سنوات محسوب نمیشود (مگر اورراید صریح مدیر)
  const tenurePolicy = await complianceFor(studentId);
  const completedSemesters = tenurePolicy
    ? countableSemesters(tenurePolicy, Array.from(termMeta.values()))
    : termMap.size;

  /**
   * قانون سنوات: به ازای هر ۲۰ واحد معادل‌سازی، یک ترم از سنوات مجاز دانشجو
   * کسر می‌شود (دانشجو معادل آن ترم را پیش‌تر در مبدأ گذرانده است).
   */
  const equivalenceSemesters = Math.floor(equivalenceUnits / EQUIV_SEMESTER_UNITS);

  return {
    studentId,
    totalRequiredUnits,
    passedUnits,
    remainingUnits,
    isGraduating,
    lastTermGpa,
    isProbatedLastTerm,
    totalProbations,
    completedSemesters,
    equivalenceUnits,
    equivalenceSemesters,
    status: stu.status,
    effectiveMaxUnits,
    minAllowedUnits,
    isSummer,
    quotaType: stu.quotaType || 'NORMAL',
    isHonors,
    honorsSource,
    compensatoryUnits,
    baseMaxUnits,
    rulesConfig: config,
  };
}

/**
 * پایش خودکار وضعیت سنوات و مشروطی جهت ارجاع به کمیسیون موارد خاص و سامانه سجاد
 */
export async function checkAndTriggerCommissionEvents(studentId: number): Promise<{
  blocked: boolean;
  reason?: string;
  requestId?: number;
  error?: string;
}> {
  const [stu] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!stu) return { blocked: false };

  const summary = await evaluateStudentRegulationStatus(studentId);
  const config = summary.rulesConfig;

  // مادهٔ ۱۶: ۲ (کاردانی/ناپیوسته) یا ۳ (کارشناسی پیوسته/ارشد/دکتری)، بهجای ۴ سراسری
  const probationPolicy = await complianceFor(studentId);
  const maxAllowedProbations =
    (probationPolicy?.max_total_probations ?? config.probation_and_tenure.max_total_probations) + stu.extraAllowedProbations;
  // قانون سنوات: هر ۲۰ واحد معادل‌سازی یک ترم از سقف سنوات مجاز کم می‌کند
  const maxAllowedSemesters =
    config.probation_and_tenure.max_study_semesters +
    stu.extraAllowedSemesters -
    summary.equivalenceSemesters;

  let blockReason: string | null = null;

  if (summary.totalProbations >= maxAllowedProbations) {
    blockReason = `تعداد مشروطی‌های تحصیلی (${summary.totalProbations} ترم) به سقف مجاز (${maxAllowedProbations} ترم) رسیده است. ادامه تحصیل منوط به تایید کمیسیون موارد خاص در سامانه سجاد می‌باشد.`;
  } else if (summary.completedSemesters >= maxAllowedSemesters) {
    const equivNote = summary.equivalenceSemesters > 0
      ? ` (شامل ${summary.equivalenceSemesters} ترم کسرشده بابت ${summary.equivalenceUnits} واحد معادل‌سازی)`
      : '';
    blockReason = `سنوات مجاز تحصیلی (${summary.completedSemesters} ترم از سقف ${maxAllowedSemesters} ترم${equivNote}) به پایان رسیده است. ادامه تحصیل منوط به دریافت سنوات ارفاقی از کمیسیون موارد خاص در سامانه سجاد است.`;
  }

  if (!blockReason) return { blocked: false };

  // اعلان تلگرامی خودکار — مشروطی یا سنوات
  try {
    const [userRow] = await db.select({ userId: users.id }).from(users)
      .innerJoin(students, eq(students.userId, users.id))
      .where(eq(students.id, studentId)).limit(1);
    if (userRow?.userId) {
      const { notifyProbationWarning, notifyYearsWarning } = await import('./telegram-notifications');
      if (summary.totalProbations >= maxAllowedProbations) {
        await notifyProbationWarning({
          userId: userRow.userId,
          semesterGpa: summary.lastTermGpa ?? 0,
          totalGpa: summary.lastTermGpa ?? 0,
        });
      } else if (summary.completedSemesters >= maxAllowedSemesters) {
        await notifyYearsWarning({
          userId: userRow.userId,
          currentTermNo: summary.completedSemesters,
          maxTerms: maxAllowedSemesters,
          remainingTerms: Math.max(0, maxAllowedSemesters - summary.completedSemesters),
        });
      }
    }
  } catch { /* ارسال تلگرام هرگز نباید فرایند اصلی را متوقف کند */ }

  // شناسهٔ فرایند «کمیسیون موارد خاص» از تنظیمات خوانده می‌شود (بدون مقدار سخت‌کد)
  const [processCode, sajjadUrl] = await Promise.all([
    getSetting('COMMISSION_PROCESS_CODE'),
    getSetting('SAJJAD_PORTAL_URL'),
  ]);
  const [proc] = await db
    .select({ id: process_definitions.id })
    .from(process_definitions)
    .where(eq(process_definitions.code, processCode.trim() || 'COMMISSION_PERMIT'))
    .limit(1);
  const [anyProc] = proc
    ? [proc]
    : await db.select({ id: process_definitions.id }).from(process_definitions).orderBy(asc(process_definitions.id)).limit(1);

  if (!anyProc) {
    // بدون فرایند مقصد، پروندهٔ کارتابل ساخته نمی‌شود؛ پس دانشجو را هم مسدود نمی‌کنیم
    // تا هرگز «دانشجوی مسدودِ بدون پرونده» به وجود نیاید.
    console.error('commission process definition not found; student not blocked', { studentId });
    return {
      blocked: false,
      reason: blockReason,
      error: 'فرایند «کمیسیون موارد خاص» در سامانه تعریف نشده است؛ مسدودسازی انجام نشد.',
    };
  }

  const formData = JSON.stringify({
    title: 'مجوز ادامه تحصیل — کمیسیون موارد خاص و سامانه سجاد',
    blockReason,
    sajjadUrl,
    instructions: '۱. ورود به سامانهٔ سجاد\n۲. ثبت دادخواست در کمیسیون بررسی موارد خاص دانشگاه\n۳. دریافت کد رهگیری و نامه ابلاغ رای\n۴. درج کد رهگیری و بارگذاری رای کمیسیون در این فرم',
  });

  try {
    // ⚠️ اتمی: مسدودسازی دانشجو و ساخت پروندهٔ کارتابل یا هر دو انجام می‌شوند یا هیچ‌کدام.
    // اگر ساخت درخواست شکست بخورد، وضعیت دانشجو Rollback می‌شود تا دانشجوی مسدودِ
    // بدون پرونده باقی نماند.
    const requestId = await db.transaction(async tx => {
      await tx
        .update(students)
        .set({ status: 'BLOCKED_COMMISSION' })
        .where(eq(students.id, studentId));

      // آیا پروندهٔ بازِ همین موضوع از قبل وجود دارد؟ (فقط همین فرایند، نه هر درخواست دیگری)
      const [existing] = await tx
        .select({ id: student_requests.id })
        .from(student_requests)
        .where(
          and(
            eq(student_requests.studentId, stu.id),
            eq(student_requests.processId, anyProc.id),
            inArray(student_requests.status, ['SUBMITTED', 'IN_REVIEW'])
          )
        )
        .orderBy(desc(student_requests.id))
        .limit(1);

      if (existing) return existing.id;

      const trackingCode = `REQ-COMM-${stu.id}-${Date.now().toString(36).toUpperCase()}`;
      const [newReq] = await tx
        .insert(student_requests)
        .values({
          studentId: stu.id,
          trackingCode,
          processId: anyProc.id,
          status: 'SUBMITTED',
          autoCreated: 1,
          formData,
        })
        .returning({ id: student_requests.id });

      if (!newReq?.id) throw new Error('ساخت پروندهٔ کمیسیون ناموفق بود.');
      return newReq.id;
    });

    return { blocked: true, reason: blockReason, requestId };
  } catch (err) {
    // تراکنش برگشت خورد: دانشجو دست‌نخورده ماند
    console.error('commission trigger failed, transaction rolled back:', err);
    return {
      blocked: false,
      reason: blockReason,
      error: err instanceof Error ? err.message : 'خطای نامشخص در ثبت پروندهٔ کمیسیون',
    };
  }
}

/**
 * محاسبه رسمی معدل کل (GPA) بر اساس سیاست نمرات مردودی
 */
export async function calculateOfficialGPA(studentId: number): Promise<{
  gpa: number;
  totalUnits: number;
  passedUnits: number;
  excludedCount: number;
  policy: string;
}> {
  const [stu] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!stu) return { gpa: 0, totalUnits: 0, passedUnits: 0, excludedCount: 0, policy: 'UNKNOWN' };

  const config = (await getRegulationConfig(stu.regulationId, stu.degreeLevelId)) || DEFAULT_BACHELOR_REGULATION_1403;
  const policy = (await complianceFor(studentId))?.failed_course_gpa_policy
    ?? config?.grading_and_gpa?.failed_course_gpa_policy ?? 'EXCLUDE_IF_PASSED';
  const passingGrade = config?.grading_and_gpa?.default_passing_grade || 10;
  const retakeMinGrade = config?.grading_and_gpa?.retakeMinGrade ?? passingGrade;
  const dedupeRepeated = config?.grading_and_gpa?.dedupeRepeatedCourses === true;

  const rows = await loadGpaRowsWithFallback(studentId);

  // حدنصاب هر درس: اول minPassedMark خود درس، بعد پیش‌فرض آیین‌نامه
  // (مثلاً ارشد ۱۲، دکتری ۱۴ — نه همیشه ۱۰)، و سیاست حذف نمرهٔ مردودی — همه در
  // هستهٔ خالصِ aggregateOfficialGpaRows هستند تا با auditStudent قابل مقایسه باشند.
  const core = aggregateOfficialGpaRows(rows, {
    passingGrade,
    retakeMinGrade,
    policy,
    dedupeRepeated,
  });

  return {
    gpa: core.gpa,
    totalUnits: core.totalUnits,
    passedUnits: core.passedUnits,
    excludedCount: core.excludedCount,
    policy,
  };
}

/**
 * شکل مشترک ردیفِ معدل: هم از `enrollments` (سامانهٔ جدید) پر می‌شود و هم از
 * `legacy_grades` (سیستم قدیمی) تا هر دو مسیر از یک هستهٔ تجمیع رد شوند.
 */
type GpaSourceRow = {
  enrollmentId: number | null;
  courseId: number | null;
  code: string | null;
  title: string | null;
  units: unknown;
  gradeValue: unknown;
  gradeStatus: string | null;
  samaGradeStatusCode: string | null;
  gradingType: string | null;
  affectsGpa: number | null;
  termId: number | null;
  termCode: string | null;
  termTitle: string | null;
  courseMinMark: unknown;
};

/** کد وضع نمرهٔ سما از ستون raw سیستم قدیمی (`markStat`) */
function markStatOfLegacy(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { markStat?: unknown };
    const v = parsed?.markStat;
    return v === null || v === undefined || v === '' ? null : String(v);
  } catch {
    return null;
  }
}

/**
 * ردیف‌های واجدِ معدل (نهایی/معاف/قبول بدون نمره) به‌همراه نیمسالِ هر درس.
 * یک نقطهٔ حقیقت برای هم معدل کل و هم ریزِ ترم‌به‌ترم.
 */
async function loadOfficialGpaRows(studentId: number): Promise<GpaSourceRow[]> {
  return db
    .select({
      enrollmentId: enrollments.id,
      courseId: courses.id,
      code: courses.code,
      title: courses.title,
      units: courses.units,
      gradeValue: enrollments.gradeValue,
      gradeStatus: enrollments.gradeStatus,
      samaGradeStatusCode: enrollments.samaGradeStatusCode,
      gradingType: courses.gradingType,
      affectsGpa: courses.affectsGpa,
      termId: course_offerings.termId,
      termCode: academic_terms.termCode,
      termTitle: academic_terms.title,
      courseMinMark: courses.minPassedMark,
    })
    .from(enrollments)
    .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .leftJoin(academic_terms, eq(academic_terms.id, course_offerings.termId))
    .where(and(
      eq(enrollments.studentId, studentId),
      inArray(enrollments.gradeStatus, ['FINALIZED', 'EXEMPT', 'PASSED_NO_GRADE'])
    ));
}

/**
 * نمراتِ «سیستم قدیمی» برای پرونده‌هایی که هنوز به `enrollments` ارتقا نیافته‌اند.
 *
 * ۲٬۶۶۵ دانشجو (که ۲٬۰۹۴ نفرشان فارغ‌التحصیل‌اند) فقط در `legacy_grades` نمره
 * دارند؛ پیش از این، کارنامهٔ چاپی/اداری آن‌ها عدد داشت ولی استعلام برخط ۰ نشان
 * می‌داد. دامنهٔ مبدأ همان قرارداد پروژه است: `legacy_grades.sourceCode = universities.code`
 * (بدون آن، کد وضع نمرهٔ دانشگاه دیگر روی کارنامه می‌نشیند).
 */
async function loadLegacyGpaRows(studentId: number): Promise<GpaSourceRow[]> {
  const [stu] = await db
    .select({ code: students.studentCode, uniCode: universities.code })
    .from(students)
    .leftJoin(universities, eq(universities.id, students.universityId))
    .where(eq(students.id, studentId))
    .limit(1);
  const source = String(stu?.uniCode ?? '').trim().toUpperCase();
  if (!stu?.code || !/^[A-Z0-9_-]{2,50}$/.test(source)) return [];

  const rows = await db
    .select({
      code: legacy_grades.courseCode,
      units: legacy_grades.units,
      // ⚠ در ایمپورت قدیمی، ستون units خالی است؛ واحد و مشخصات درس باید از
      //   کاتالوگ `courses` (بر پایهٔ کد درس) خوانده شود، وگرنه معدلِ دانشجویانی
      //   که نمره‌شان فقط در سیستم قدیمی است صفر می‌ماند.
      catalogUnits: sql<number | null>`(select c.units from courses c where c.code = "courseCode" order by c.id limit 1)`,
      catalogMinMark: sql<number | null>`(select c."minPassedMark" from courses c where c.code = "courseCode" order by c.id limit 1)`,
      catalogGradingType: sql<string | null>`(select c."gradingType" from courses c where c.code = "courseCode" order by c.id limit 1)`,
      catalogAffectsGpa: sql<number | null>`(select c."affectsGpa" from courses c where c.code = "courseCode" order by c.id limit 1)`,
      gradeValue: legacy_grades.gradeValue,
      gradeStatus: legacy_grades.gradeStatus,
      termCode: legacy_grades.termCode,
      raw: legacy_grades.raw,
    })
    .from(legacy_grades)
    .where(and(eq(legacy_grades.studentCode, stu.code), eq(legacy_grades.sourceCode, source)))
    .orderBy(asc(legacy_grades.termCode), asc(legacy_grades.courseCode))
    .limit(500);

  return rows.map(r => ({
    enrollmentId: null,
    courseId: null,
    code: r.code,
    title: null,
    units: Number(r.units ?? 0) > 0 ? r.units : r.catalogUnits,
    gradeValue: r.gradeValue,
    gradeStatus: r.gradeStatus,
    samaGradeStatusCode: markStatOfLegacy(r.raw),
    gradingType: r.catalogGradingType ?? null,
    affectsGpa: r.catalogAffectsGpa ?? 1,
    termId: null,
    termCode: r.termCode,
    termTitle: null,
    courseMinMark: r.catalogMinMark,
  }));
}

/**
 * ردیف‌های معدل با ادغامِ کاملِ دو منبع:
 *   ۱) نمرات سامانهٔ جدید (`enrollments`) — مرجع هر درسی که آنجا هست؛
 *   ۲) نمرات سیستم قدیمی (`legacy_grades`) — فقط برای درسی که در `enrollments`
 *      معادلی ندارد (کلید: کد نیمسال + کد درس).
 *
 * چرا ادغام و نه «یا»؟ کارنامهٔ چاپی/اداری همین کار را می‌کند، پس اگر استعلام
 * فقط `enrollments` را می‌دید، معدل/واحدِ صفحهٔ استعلام با کارنامهٔ چاپی واگرا
 * می‌شد (دقیقاً همان اختلافی که گزارش شد). ۲٬۶۶۵ دانشجو هم کلاً نمره‌شان فقط در
 * سیستم قدیمی است و با این ادغام پوشش داده می‌شوند.
 */
async function loadGpaRowsWithFallback(studentId: number): Promise<GpaSourceRow[]> {
  const enrolled = await loadOfficialGpaRows(studentId);
  const legacy = await loadLegacyGpaRows(studentId);
  if (!legacy.length) return enrolled;

  const covered = new Set(enrolled.map(r => `${r.termCode ?? ''}|${r.code ?? ''}`));
  const extras = legacy.filter(r => !covered.has(`${r.termCode ?? ''}|${r.code ?? ''}`));
  return extras.length ? [...enrolled, ...extras] : enrolled;
}

/**
 * معدل کل تا پایان یک نیمسال مشخص.
 *
 * چرا لازم است؟ آیین‌نامه‌ها به «معدل تا پایان ترم N» استناد می‌کنند (مثلاً پذیرش
 * بدون کنکور استعداد درخشان: معدل تا پایان ترم ۶ کارشناسی). ردیف‌های با کد نیمسال
 * ≤ ملاک شمرده می‌شوند و همان هستهٔ خالص معدل اجرا می‌گردد تا با معدل کل و
 * معدل ترم هیچ‌گاه واگرا نشود.
 */
export async function calculateOfficialGpaUpToTerm(
  studentId: number,
  upToTermCode: string,
  fromTermCode?: string | null,
): Promise<{
  gpa: number;
  totalUnits: number;
  passedUnits: number;
  excludedCount: number;
  policy: string;
  termCode: string;
}> {
  const [stu] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  const config = (await getRegulationConfig(stu?.regulationId, stu?.degreeLevelId)) || DEFAULT_BACHELOR_REGULATION_1403;
  const policy = (await complianceFor(studentId))?.failed_course_gpa_policy
    ?? config?.grading_and_gpa?.failed_course_gpa_policy ?? 'EXCLUDE_IF_PASSED';
  const passingGrade = config?.grading_and_gpa?.default_passing_grade || 10;
  const retakeMinGrade = config?.grading_and_gpa?.retakeMinGrade ?? passingGrade;
  const dedupeRepeated = config?.grading_and_gpa?.dedupeRepeatedCourses === true;

  const code = String(upToTermCode ?? '').trim();
  const from = String(fromTermCode ?? '').trim();
  const all = await loadGpaRowsWithFallback(studentId);
  // کدهای نیمسال در این سامانه با طول ثابت‌اند (مثل 14031) پس مقایسهٔ رشته‌ای
  // با مقایسهٔ زمانی یکسان است. `from` اختیاری است (بازهٔ ترم در فرم گزارش).
  const rows = all.filter(r => {
    const tc = String(r.termCode ?? '').trim();
    if (tc === '') return false;
    if (code && tc > code) return false;
    if (from && tc < from) return false;
    return true;
  });

  const core = aggregateOfficialGpaRows(rows, { passingGrade, retakeMinGrade, policy, dedupeRepeated });
  return {
    gpa: core.gpa,
    totalUnits: core.totalUnits,
    passedUnits: core.passedUnits,
    excludedCount: core.excludedCount,
    policy,
    termCode: code,
  };
}

export type OfficialGpaTermRow = {
  termId: number | null;
  termCode: string | null;
  termTitle: string;
  /** معدل همان نیمسال (null = نمرهٔ واحدی برای معدل نداشته) */
  gpa: number | null;
  /** واحدهای محاسبه‌شده در معدلِ همان نیمسال */
  units: number;
  passedUnits: number;
  /** مشروط: معدل ترم زیر مرزِ آیین‌نامه (پیش‌فرض ۱۲ لیسانس / ۱۴ ارشد) */
  isProbation: boolean;
};

export type OfficialGpaBreakdown = {
  gpa: number;
  totalUnits: number;
  passedUnits: number;
  excludedCount: number;
  policy: string;
  /** مرز مشروطی از آیین‌نامهٔ همان مقطع */
  probationThreshold: number;
  /** ریزِ ترم‌به‌ترم، مرتب بر اساس کد نیمسال */
  terms: OfficialGpaTermRow[];
};

/**
 * معدل کل + وضعیت هر نیمسال (برای استعلام کارنامه).
 *
 * همان هستهٔ خالصِ `aggregateOfficialGpaRows` روی زیرمجموعهٔ ردیف‌های هر نیمسال
 * اجرا می‌شود؛ بنابراین عدد هر ترم با عدد کل از یک قاعده می‌آید و «مشروطی» هم
 * با مرزِ خودِ آیین‌نامه سنجیده می‌شود، نه با یک ثابتِ دستی.
 */
export async function calculateOfficialGpaBreakdown(studentId: number): Promise<OfficialGpaBreakdown> {
  const [stu] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  const config = (await getRegulationConfig(stu?.regulationId, stu?.degreeLevelId)) || DEFAULT_BACHELOR_REGULATION_1403;
  const policy = (await complianceFor(studentId))?.failed_course_gpa_policy
    ?? config?.grading_and_gpa?.failed_course_gpa_policy ?? 'EXCLUDE_IF_PASSED';
  const passingGrade = config?.grading_and_gpa?.default_passing_grade || 10;
  const retakeMinGrade = config?.grading_and_gpa?.retakeMinGrade ?? passingGrade;
  const dedupeRepeated = config?.grading_and_gpa?.dedupeRepeatedCourses === true;
  const probationThreshold = Number(config?.probation_and_tenure?.probation_gpa_threshold ?? 12);

  const rows = await loadGpaRowsWithFallback(studentId);
  const input = { passingGrade, retakeMinGrade, policy, dedupeRepeated };
  const core = aggregateOfficialGpaRows(rows, input);

  // گروه‌بندی ترم‌به‌ترم: کلید بر پایهٔ کد نیمسال است تا ردیف‌های سامانهٔ جدید
  // (termId) و ردیف‌های سیستم قدیمی (فقط termCode) در یک سطر بیایند.
  const groups = new Map<string, { termId: number | null; termCode: string | null; termTitle: string | null; rows: GpaSourceRow[] }>();
  for (const r of rows) {
    const key = r.termCode ? `c:${r.termCode}` : `t:${r.termId ?? '?'}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.rows.push(r);
      if (!bucket.termTitle && r.termTitle) bucket.termTitle = r.termTitle;
      if (bucket.termId == null && r.termId != null) bucket.termId = r.termId;
    } else {
      groups.set(key, { termId: r.termId, termCode: r.termCode, termTitle: r.termTitle, rows: [r] });
    }
  }

  const terms: OfficialGpaTermRow[] = [...groups.values()]
    .map(g => {
      const c = aggregateOfficialGpaRows(g.rows, input);
      return {
        termId: g.termId,
        termCode: g.termCode,
        termTitle: g.termTitle ?? g.termCode ?? '—',
        gpa: c.totalUnits > 0 ? c.gpa : null,
        units: c.totalUnits,
        passedUnits: c.passedUnits,
        isProbation: c.totalUnits > 0 && c.gpa < probationThreshold,
      };
    })
    .sort((a, b) => String(a.termCode ?? '').localeCompare(String(b.termCode ?? ''), 'en'));

  return {
    gpa: core.gpa,
    totalUnits: core.totalUnits,
    passedUnits: core.passedUnits,
    excludedCount: core.excludedCount,
    policy,
    probationThreshold: Number.isFinite(probationThreshold) ? probationThreshold : 12,
    terms,
  };
}
