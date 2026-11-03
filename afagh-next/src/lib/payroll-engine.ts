import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '@/db';
import {
  academic_terms, audit_logs, class_sessions, course_offerings, courses,
  electronic_documents, enrollments, offering_professors, payroll_calculation_rules,
  payroll_statements, professor_term_contracts, staff, teaching_coefficients,
  teaching_rates, users,
} from '@/db/schema';
import { loadTermEffectiveDuties } from '@/lib/payroll-roles';
import { getFiscalYear, getNumber, getSetting } from '@/lib/settings';
import { collapseMergedOfferings, mergedGroupKey } from '@/lib/professor-data';
import { notifyUserMultichannel } from '@/lib/messaging';
import { intToUnits, percentOf, ratioOf, sumUnits, toRial, UNIT_SCALE, unitsToInt } from '@/lib/money';
import { groupThousands } from '@/lib/calendar';
import { createLogger } from '@/lib/logger';
import { evalFormula } from './payroll-formula';

// ══════════════════════════════════════════════════════════════════════
//  موتور حق‌التدریس اساتید (Payroll Engine) — نسخهٔ PostgreSQL/Drizzle
//
//  سه اصلاح ساختاری نسبت به نسخهٔ SQLite:
//
//  ۱) حذف N+1 — پیش‌تر به ازای هر استاد، چند کوئری جدا اجرا می‌شد (کلاس‌ها،
//     جلسات، نمرات، اسناد، فیش). حالا کل ترم با «۱۱ کوئری SQL ثابت» بارگذاری
//     می‌شود (۷ کوئری حجمی دادهٔ ترم + ۴ کوئری پیکربندی کوچک که قابل کش است)
//     و محاسبات در حافظه انجام می‌گیرد؛ تعداد کوئری‌ها با تعداد استاد رشد
//     نمی‌کند (۱۵۰۰ استاد = همان ۱۱ کوئری — در تست بار روی PostgreSQL زنده
//     تأیید شد). همچنین در تسویهٔ نهایی، چک گلوگاه داخل تراکنش با دو کوئری
//     سبک سطری (loadStaffGates) انجام می‌شود نه بارگذاری مجدد کل ترم؛
//     پرداخت دسته‌ای ۵۰۰ استاد از ~۳۲۰ ثانیه به ~۶٫۶ ثانیه رسید.
//
//  ۲) پول با عدد صحیح — همهٔ محاسبات ریالی روی اعداد صحیح و با گردکردن به
//     مضرب ۱۰ ریال انجام می‌شود؛ دیگر `0.1 + 0.2` در فیش مالی ظاهر نمی‌شود.
//
//  ۳) کسور واقعی — «کسر غیبت بدون جلسهٔ جبرانی» پیش‌تر فقط در فیش نمایش داده
//     می‌شد ولی از مبلغ خالص کم نمی‌شد. حالا هم در deductions می‌نشیند و هم از
//     مأخذ مالیات و مبلغ خالص کسر می‌شود.
//
//  گردش پرداخت:  DRAFT → MID_TERM_PAID (علی‌الحساب) → FINAL_SETTLED
//  گلوگاه تسویه: ① همهٔ نمرات استاد FINALIZED  ② همهٔ اسناد او SIGNED
// ══════════════════════════════════════════════════════════════════════

const log = createLogger({ mod: 'payroll' });

/** اتصال تراکنشی موتور (برای قلاب afterSettle و فراخوان‌های داخل-تراکنشی) */
export type EngineTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PayrollStatus = 'DRAFT' | 'MID_TERM_PAID' | 'FINAL_SETTLED';

export type PayrollRow = {
  offeringId: number;
  courseCode: string;
  courseTitle: string;
  units: number;
  groupNumber: number | null;
  payRole: string;
  offeringType: string;
  coefficients: string;
  equivalentUnits: number;     // واحد معادل (با ضریب و سهم)
  sessions: { planned: number; held: number; absents: number; makeup: number; netAbsences: number };
  effectiveUnits: number;      // واحد مؤثر پس از کسر غیبت
  absenceDeductionRial: number;
  grossRial: number;           // مبلغ ناخالص این ردیف (پیش از کسر غیبت)
  ruleTitle?: string | null;
};

export type StaffPayroll = {
  staff: { id: number; name: string; staffCode: string | null; rank: string | null; base: string | null; degree: string | null; contractType: string | null };
  rate: number;
  /** منشأ نرخ: جدول ثابت / اسنپ‌شات قرارداد / کسری از حکم (۱/N) */
  rateSource: 'TABLE' | 'BASE' | 'SNAPSHOT' | 'FRACTION';
  rateDivisor: number;
  dutyUnits: number;
  taxRate: number;
  rows: PayrollRow[];
  totalEquivalentUnits: number;
  totalEffectiveUnits: number;
  payableUnits: number;
  gross: number;
  absenceDeductionRial: number;
  tax: number;
  net: number;
  gates: { gradesFinalized: boolean; pendingGrades: number; docsSigned: boolean; unsignedDocs: number };
  hasContract: boolean;
};

export type PayrollOverviewItem = StaffPayroll['staff'] & {
  rate: number;
  /** منشأ نرخ: سطر عمومی جدول / سطر پایه‌دار / اسنپ‌شات قرارداد / نسبت حکم */
  rateSource: StaffPayroll['rateSource'];
  dutyUnits: number;
  totalEquivalentUnits: number;
  totalEffectiveUnits: number;
  payableUnits: number;
  gross: number;
  tax: number;
  absenceDeductionRial: number;
  net: number;
  status: PayrollStatus | 'NOT_COMPUTED';
  statementId: number | null;
  midtermPaid: number;
  finalPaid: number;
  remaining: number;
  gates: StaffPayroll['gates'];
};

type Coefs = {
  practical: number; msLevel: number; crowded: number;
  /** پله‌بندی ردیف «کلاس جمعی» — NULL یعنی سراسری از تنظیمات (مهاجرت 0086) */
  crowdedTier: { minStudents: number | null; stepSize: number | null; stepIncrement: number | null } | null;
};

type StaffMeta = { name: string; staffCode: string | null; rank: string | null; base: string | null; degree: string | null; userId: number };

type StaffOffering = {
  offeringId: number; courseCode: string; courseTitle: string; unitsInt: number; practicalUnits: number;
  groupNumber: number | null; enrolledCount: number; offeringType: string; payRole: string; sharePct: number;
  mergeKey: string | null; mergedMemberIds?: number[];
  courseId: number; theoryUnits: number; deptId: number | null; courseType: string | null;
};

type SessionStats = { planned: number; held: number; absents: number; makeup: number; netAbsences: number };

type StatementRow = {
  id: number; contractId: number; staffId: number;
  totalEquivalentUnits: string | null; payableUnits: string | null; grossAmount: string | null;
  deductions: string | null; netAmount: string | null; status: string | null; detailJson: string | null;
  midtermPaidAmount: string | null; midtermPaidAt: Date | null; finalPaidAmount: string | null; finalPaidAt: Date | null;
  computedAt: Date | null;
};

type ContractRow = {
  id: number; staffId: number; contractType: string | null; baseDutyUnits: number; taxRate: number;
  // مهاجرت 0056 — اسنپ‌شات ترمی (NULL = ردیف قدیمی ← مقدار زنده خوانده می‌شود)
  rankSnapshot: string | null; baseSnapshot: string | null; rateSnapshot: number | null;
  // مهاجرت 0087 — مبنای حکم برای حالت نرخ ۱/N (NULL = جدول ثابت)
  salaryBase: number | null;
};

const ROLE_FA: Record<string, string> = {
  MAIN_LECTURER: 'مدرس اصلی', SUPERVISOR: 'استاد راهنما', ADVISOR: 'استاد مشاور',
  REVIEWER: 'داور', EXAMINER: 'ممتحن',
  ASSISTANT: 'کمک‌استاد', SELF_STUDY: 'استاد خودخوان',
};

// عنوان نقش: کاتالوگ قابل‌تعریف ← نقش‌های استاندارد ← خود کد
function roleLabel(data: TermData, code: string): string {
  return data.roleTitles.get(code) ?? ROLE_FA[code] ?? code;
}
const TYPE_FA: Record<string, string> = {
  THEORY: 'نظری', THESIS: 'پایان‌نامه', DIRECTED_READING: 'معرفی به استاد',
  INTERNSHIP: 'کارآموزی', NORMAL: 'نظری', TRANSFER: 'تطبیق واحد',
};

// ─────────────────── بارگذاری تنظیمات داده‌محور ───────────────────

/** ضرایب از جدول teaching_coefficients — نام ردیف‌ها از تنظیمات می‌آید */
async function loadCoefficients(): Promise<Coefs> {
  const [practicalName, msName, crowdedName] = await Promise.all([
    getSetting('PAYROLL_COEF_PRACTICAL'),
    getSetting('PAYROLL_COEF_MS_LEVEL'),
    getSetting('PAYROLL_COEF_CROWDED'),
  ]);
  const rows = await db
    .select({
      ruleName: teaching_coefficients.ruleName,
      multiplier: teaching_coefficients.multiplier,
      minStudents: teaching_coefficients.minStudents,
      stepSize: teaching_coefficients.stepSize,
      stepIncrement: teaching_coefficients.stepIncrement,
    })
    .from(teaching_coefficients);
  const map = new Map(rows.map(r => [r.ruleName, Number(r.multiplier)]));
  const num = (name: string, fallback: number) => {
    const v = map.get(name);
    return Number.isFinite(v) && (v as number) > 0 ? (v as number) : fallback;
  };
  const crowdedRow = rows.find(r => r.ruleName === crowdedName);
  return {
    practical: num(practicalName, 1),
    msLevel: num(msName, 1),
    crowded: num(crowdedName, 1),
    crowdedTier: crowdedRow
      ? {
          minStudents: crowdedRow.minStudents == null ? null : Number(crowdedRow.minStudents),
          stepSize: crowdedRow.stepSize == null ? null : Number(crowdedRow.stepSize),
          stepIncrement: crowdedRow.stepIncrement == null ? null : Number(crowdedRow.stepIncrement),
        }
      : null,
  };
}

/** قوانین فرمول‌ساز (payroll_calculation_rules) — خاص‌ترین قاعده برنده است.
 * الگوریتم یکپارچه (0092): هر سطر = ابعاد اختیاری (خالی = همه) + یک عبارت
 * ریاضی با متغیرهای N/A/W/U/C/R/K/F/H که مستقیم ریال می‌دهد. */
type PayRule = {
  id: number; offeringType: string | null; professorRole: string | null; academicRank: string | null;
  classMode: string; minStudents: number | null; maxStudents: number | null;
  departmentId: number | null; courseType: string | null; repeatNumber: number | null;
  expression: string | null; flatBase: number | null; perStudentHours: number | null;
  title: string | null;
};

export type RuleMatch = {
  offeringType: string; role: string; rank: string | null; hasClass: boolean;
  enrolled: number; deptId: number | null; courseType: string | null; nth: number;
};

async function loadPayRules(): Promise<PayRule[]> {
  const rows = await db
    .select()
    .from(payroll_calculation_rules)
    .where(eq(payroll_calculation_rules.isActive, 1));
  return rows
    .filter(r => r.offeringType || r.professorRole || r.academicRank
      || (r.classMode && r.classMode !== 'ANY') || r.departmentId != null
      || r.courseType || r.repeatNumber != null
      || r.minStudents != null || r.maxStudents != null)   // قاعده باید اختصاصی باشد
    .map(r => ({
      id: r.id,
      offeringType: r.offeringType,
      professorRole: r.professorRole,
      academicRank: r.academicRank,
      classMode: r.classMode ?? 'ANY',
      minStudents: r.minStudents ?? null,
      maxStudents: r.maxStudents ?? null,
      departmentId: (r as { departmentId?: number | null }).departmentId ?? null,
      courseType: (r as { courseType?: string | null }).courseType ?? null,
      repeatNumber: (r as { repeatNumber?: number | null }).repeatNumber ?? null,
      expression: (r as { expression?: string | null }).expression ?? null,
      flatBase: (r as { flatBase?: string | number | null }).flatBase == null
        ? null : Number((r as { flatBase?: string | number | null }).flatBase),
      perStudentHours: (r as { perStudentHours?: string | number | null }).perStudentHours == null
        ? null : Number((r as { perStudentHours?: string | number | null }).perStudentHours),
      title: r.title,
    }))
    .sort((a, b) => score(b) - score(a) || a.id - b.id);
}

function score(r: PayRule) {
  return (r.offeringType ? 2 : 0) + (r.professorRole ? 2 : 0) + (r.academicRank ? 1 : 0)
    + (r.classMode && r.classMode !== 'ANY' ? 1 : 0)
    + (r.minStudents != null ? 1 : 0) + (r.maxStudents != null ? 1 : 0)
    + (r.departmentId != null ? 1 : 0) + (r.courseType ? 1 : 0) + (r.repeatNumber != null ? 2 : 0);
}

/** یک سطر نمای پوشش فرمول: هر ارائهٔ هر استاد چه فرمولی دارد یا چرا ندارد */
export type CoverageRow = {
  staffId: number; staffName: string; offeringId: number; courseCode: string; courseTitle: string;
  groupNumber: number | null; offeringType: string; offeringTypeFa: string; role: string; roleFa: string;
  enrolled: number; hasClass: boolean; nth: number; merged: boolean; memberCount: number;
  ruleId: number | null; ruleTitle: string | null; expression: string | null;
  missDim: string | null; missReason: string | null;
  /** نقش دستی ثبت‌شده برای این ارائه-استاد (offering_payroll_extras.payRoleOverride) */
  overrideCode: string | null; overrideTitle: string | null;
};

/** علت‌یابی پلکانی: اولین بُعدی که مجموعهٔ نامزدها را خالی می‌کند */
export function diagnoseRuleMiss(rules: PayRule[], m: RuleMatch): { dim: string; reason: string } {
  if (rules.length === 0) {
    return { dim: 'none', reason: 'هیچ قانون فرمول فعالی تعریف نشده است — از زبانهٔ قوانین، دست‌کم یک سطر بسازید.' };
  }
  const t = m.offeringType === 'NORMAL' ? 'THEORY' : m.offeringType;
  const tFa = TYPE_FA[t] ?? t;
  let cands = rules;
  const steps: { dim: string; keep: (r: PayRule) => boolean; reason: () => string }[] = [
    {
      dim: 'offeringType',
      keep: r => !r.offeringType || r.offeringType === t,
      reason: () => `نوع درس «${tFa}»: هیچ قانونی این نوع را پوشش نمی‌دهد.`,
    },
    {
      dim: 'professorRole',
      keep: r => !r.professorRole || r.professorRole === m.role,
      reason: () => `نقش «${m.role}»: قانونی برای این نقش تعریف نشده (نقش قابل تعریف است).`,
    },
    {
      dim: 'academicRank',
      keep: r => !r.academicRank || r.academicRank === m.rank,
      reason: () => `مرتبهٔ «${m.rank ?? '—'}»: قوانین موجود مرتبهٔ دیگری می‌خواهند.`,
    },
    {
      dim: 'classMode',
      keep: r => !r.classMode || r.classMode === 'ANY' || (r.classMode === 'WITH_CLASS') === m.hasClass,
      reason: () => m.hasClass
        ? 'وضعیت کلاس: ارائه باکلاس است ولی قوانینِ منطبق فقط «بدون‌کلاس» می‌خواهند.'
        : 'وضعیت کلاس: ارائه بدون‌کلاس است ولی قوانینِ منطبق فقط «باکلاس» می‌خواهند.',
    },
    {
      dim: 'studentRange',
      keep: r => (r.minStudents == null || m.enrolled >= r.minStudents) && (r.maxStudents == null || m.enrolled <= r.maxStudents),
      reason: () => `تعداد دانشجو (${m.enrolled} نفر): خارج از بازهٔ قوانین منطبق است.`,
    },
    {
      dim: 'department',
      keep: r => r.departmentId == null || r.departmentId === m.deptId,
      reason: () => 'گروه آموزشی: قوانین منطبق محدود به گروه دیگری هستند.',
    },
    {
      dim: 'courseType',
      keep: r => !r.courseType || r.courseType === m.courseType,
      reason: () => `نوع درس کاتالوگ («${m.courseType ?? '—'}»): قانونی برای این نوع نیست.`,
    },
    {
      dim: 'repeat',
      keep: r => r.repeatNumber == null || r.repeatNumber === m.nth,
      reason: () => `نوبت تکرار (بار ${m.nth}اُم): قوانین منطبق نوبت دیگری می‌خواهند.`,
    },
  ];
  for (const s of steps) {
    const next = cands.filter(s.keep);
    if (next.length === 0) return { dim: s.dim, reason: s.reason() };
    cands = next;
  }
  return { dim: 'unknown', reason: 'علت نامشخص — با پشتیبانی در میان بگذارید.' };
}

/** نمای پوشش یک ترم: هر ارائهٔ هر استاد → قانون برنده یا علت نبود فرمول */
export async function computeRuleCoverage(termId: number, universityId?: number): Promise<{ rows: CoverageRow[]; ruleCount: number }> {
  const data = await loadTermPayrollData(termId, universityId);
  const rows: CoverageRow[] = [];
  for (const [staffId, list] of data.offeringsByStaff) {
    const info = data.staffInfo.get(staffId);
    if (!info) {
      log.warn('coverage_skip_orphan_staff', { staffId, termId });
      continue;
    }
    const collapsed = collapseMergedOfferings(list, id => data.slotsByOffering.get(id) ?? null);
    for (const o of collapsed) {
      const memberIds = o.mergedMemberIds ?? [o.offeringId];
      const hasClass = memberIds.some(id => data.slotsByOffering.has(id));
      const nth = (data.repeatCount.get(`${staffId}:${o.courseId}`) ?? 0) + 1;
      const m: RuleMatch = {
        offeringType: o.offeringType, role: o.payRole, rank: info?.rank ?? null, hasClass,
        enrolled: o.enrolledCount, deptId: o.deptId, courseType: o.courseType, nth,
      };
      const rule = matchRule(data.rules, m);
      const miss = rule ? null : diagnoseRuleMiss(data.rules, m);
      rows.push({
        staffId, staffName: info?.name ?? `#${staffId}`,
        offeringId: o.offeringId, courseCode: o.courseCode, courseTitle: o.courseTitle,
        groupNumber: o.groupNumber, offeringType: o.offeringType,
        offeringTypeFa: TYPE_FA[o.offeringType] ?? o.offeringType,
        role: o.payRole, roleFa: roleLabel(data, o.payRole),
        enrolled: o.enrolledCount, hasClass, nth,
        merged: (o.mergedMemberIds?.length ?? 1) > 1, memberCount: memberIds.length,
        ruleId: rule?.id ?? null, ruleTitle: rule?.title ?? null, expression: rule?.expression ?? null,
        missDim: miss?.dim ?? null, missReason: miss?.reason ?? null,
        overrideCode: data.payRoleOverride.get(`${o.offeringId}:${staffId}`) ?? null,
        overrideTitle: (() => {
          const c = data.payRoleOverride.get(`${o.offeringId}:${staffId}`);
          return c ? (data.roleTitles.get(c) ?? c) : null;
        })(),
      });
    }
  }
  rows.sort((a, b) => (a.ruleId == null ? 0 : 1) - (b.ruleId == null ? 0 : 1) || a.courseTitle.localeCompare(b.courseTitle, 'fa'));
  return { rows, ruleCount: data.rules.length };
}

function matchRule(rules: PayRule[], m: RuleMatch): PayRule | null {
  const t = m.offeringType === 'NORMAL' ? 'THEORY' : m.offeringType;
  return rules.find(r =>
    (!r.offeringType || r.offeringType === t) &&
    (!r.professorRole || r.professorRole === m.role) &&
    (!r.academicRank || r.academicRank === m.rank) &&
    (!r.classMode || r.classMode === 'ANY' || (r.classMode === 'WITH_CLASS') === m.hasClass) &&
    (r.minStudents == null || m.enrolled >= r.minStudents) &&
    (r.maxStudents == null || m.enrolled <= r.maxStudents) &&
    (r.departmentId == null || r.departmentId === m.deptId) &&
    (!r.courseType || r.courseType === m.courseType) &&
    (r.repeatNumber == null || r.repeatNumber === m.nth),
  ) ?? null;
}

/** ضریب پلکانی کلاس پرجمعیت — آستانه T و گام S انتخابی؛ steps=‏⌊(n−T)/S⌋+۱ */
function crowdedMult(enrolled: number, data: TermData): { mult: number; label: string } {
  const tier = data.coefs.crowdedTier;
  const T = tier?.minStudents != null && tier.minStudents > 0 ? tier.minStudents : data.crowdedThreshold;
  const base = data.coefs.crowded;
  if (enrolled <= T) return { mult: base, label: '' };
  const S = Math.max(1, Math.round(tier?.stepSize ?? data.crowdedStep ?? 25));
  const up = Number(tier?.stepIncrement ?? data.crowdedStepUp ?? 0);
  const steps = Math.floor((enrolled - T) / S) + 1;
  // up=۰ یعنی رفتار قدیمی: یک جهش ثابت بدون پله
  if (!(up > 0) || steps <= 1) return { mult: base, label: `جمعی ×${base}` };
  const mult = Math.round((base + (steps - 1) * up) * 100) / 100;
  return { mult, label: `جمعی ×${mult} (${steps} پله)` };
}

// ─────────────────── بارگذاری دسته‌جمعی ترم (بدون N+1) ───────────────────

type TermData = {
  termId: number;
  termTitle: string;
  coefs: Coefs;
  rules: PayRule[];
  rateByStaff: Map<number, number>;
  contracts: Map<number, ContractRow>;
  // مهاجرت 0056 — موظفی مؤثر نقش‌محور (غایب = بدون نقش تدریسی ← fallback قدیمی)
  effectiveDuties: Map<number, number>;
  staffInfo: Map<number, StaffMeta>;
  offeringsByStaff: Map<number, StaffOffering[]>;
  sessionsByOffering: Map<number, SessionStats>;
  slotsByOffering: Map<number, string>;
  gatesByStaff: Map<number, { pendingGrades: number; unsignedDocs: number }>;
  statementsByStaff: Map<number, StatementRow>;
  msPrefixes: string[];
  crowdedThreshold: number;
  // ── پلکان پرجمعیت + سوییچ نرخ کسری (۱/N) ──
  crowdedStep: number;
  crowdedStepUp: number;
  rateFraction: boolean;
  rateDivisor: number;
  rateSource: Map<number, 'TABLE' | 'BASE' | 'SNAPSHOT' | 'FRACTION'>;
  plannedSessionsDefault: number;
  // ── الگوریتم یکپارچه (0092/0089): عناوین نقش‌ها، نقش دستی، دفعهٔ تدریس ──
  roleTitles: Map<string, string>;
  payRoleOverride: Map<string, string>;
  repeatCount: Map<string, number>;
};

/** ترم جاری (یا ترم مشخص‌شده) */
export async function currentTerm(termId?: number) {
  const row = termId
    ? (await db.select().from(academic_terms).where(eq(academic_terms.id, termId)).limit(1))[0]
    : (await db.select().from(academic_terms).where(eq(academic_terms.isCurrent, 1)).limit(1))[0];
  return row ?? null;
}

/**
 * بارگذاری کل دادهٔ لازم برای محاسبهٔ فیش همهٔ اساتید یک ترم.
 * تعداد کوئری‌ها ثابت است (۷) و به تعداد اساتید بستگی ندارد.
 */
export async function loadTermPayrollData(termId: number, universityId?: number): Promise<TermData> {
  const [term, coefs, rules, contracts, staffRows, offeringRows, sessionRows, gradeRows, docRows, statementRows, slotRows, overrideRows, repeatRows, roleDefRows] =
    await Promise.all([
      db.select().from(academic_terms).where(eq(academic_terms.id, termId)).limit(1).then(r => r[0] ?? null),
      loadCoefficients(),
      loadPayRules(),

      // ۱) قراردادهای ترمی
      db.select().from(professor_term_contracts).where(eq(professor_term_contracts.termId, termId)),

      // ۲) اساتید + نام کاربری
      db.select({
        id: staff.id, userId: staff.userId, staffCode: staff.staffCode,
        academicRank: staff.academicRank, academicBase: staff.academicBase, degree: staff.degree,
        firstName: users.firstName, lastName: users.lastName,
      }).from(staff).innerJoin(users, eq(users.id, staff.userId)),

      // ۳) کلاس‌های ترم + نقش و سهم هر استاد (یک کوئری برای همه)
      db.execute(sql`
        select o.id as "offeringId", o."professorId" as "professorId", o."groupNumber" as "groupNumber",
               o."enrolledCount" as "enrolledCount", o."offeringType" as "offeringType", o."courseId" as "courseId",
               coalesce(c."theoreticalUnits", 0) as "theoryUnits", c."departmentId" as "deptId", c."courseType" as "courseType",
               o."sharedScheduleGroupKey" as "mergeKey",
               c.code as "courseCode", c.title as "courseTitle", c.units as "units",
               coalesce(c."practicalUnits", 0) as "practicalUnits",
               op."staffId" as "coStaffId", op.role as "coRole", op."sharePercentage" as "sharePct"
        from course_offerings o
        join courses c on c.id = o."courseId"
        left join offering_professors op on op."offeringId" = o.id
        where o."termId" = ${termId} and o."isActive" = 1
      `),

      // ۴) آمار جلسات همهٔ کلاس‌های ترم — یک GROUP BY
      db.execute(sql`
        select cs."offeringId" as "offeringId",
               sum(case when cs."isMakeUpSession" = 0 then 1 else 0 end) as planned,
               sum(case when cs.status = 'HELD' and cs."isMakeUpSession" = 0 then 1 else 0 end) as held,
               sum(case when cs.status = 'ABSENT' then 1 else 0 end) as absents,
               sum(case when cs.status = 'HELD' and cs."isMakeUpSession" = 1 then 1 else 0 end) as makeup
        from class_sessions cs
        join course_offerings o on o.id = cs."offeringId"
        where o."termId" = ${termId}
        group by cs."offeringId"
      `),

      // ۵) گلوگاه ۱: نمرات قطعی‌نشده به تفکیک استاد.
      //
      // ⚠ بازنویسیِ عملکردی (این کوئری در پروفایلِ دیتابیس ۱ تا ۵ ثانیه طول
      //   می‌کشید و چون از صفحهٔ حقوق اجرا می‌شود، بقیهٔ کوئری‌های سامانه پشتِ
      //   آن صف می‌بستند).
      //
      //   شکلِ قبلی:
      //     from staff s
      //     join course_offerings o on o."termId" = X
      //       and (o."professorId" = s.id or exists (...))
      //   شرطِ اتصال یک `OR` با زیرکوئریِ همبسته بود؛ PostgreSQL نمی‌تواند برای
      //   آن hash/merge join بسازد و مجبور است **حاصل‌ضربِ دکارتیِ staff ×
      //   course_offerings** را با nested loop بپیماید (و برای هر جفت، یک
      //   EXISTS هم اجرا کند). با چند صد استاد و چند هزار ارائه، این می‌شود
      //   میلیون‌ها مقایسه.
      //
      //   شکلِ جدید: اول «جفت‌های (ارائه، استاد)» را با دو اتصالِ تساوی‌محور
      //   می‌سازیم و با `union` یکتا می‌کنیم (استادی که هم professorId است و هم
      //   در offering_professors، دوبار شمرده نمی‌شود)، بعد با enrollments
      //   اتصال می‌زنیم. نتیجه دقیقاً همان است، ولی با hash join.
      db.execute(sql`
        with teacher_offerings as (
          select o.id as "offeringId", o."professorId" as "staffId"
          from course_offerings o
          where o."termId" = ${termId} and o."professorId" is not null
          union
          select op."offeringId" as "offeringId", op."staffId" as "staffId"
          from offering_professors op
          join course_offerings o2 on o2.id = op."offeringId"
          where o2."termId" = ${termId}
        )
        select t."staffId" as "staffId", count(e.id) as "pendingGrades"
        from teacher_offerings t
        join enrollments e on e."offeringId" = t."offeringId"
          and e.status = 'REGISTERED' and coalesce(e."gradeStatus", '') <> 'FINALIZED'
        group by t."staffId"
      `),

      // ۶) گلوگاه ۲: اسناد امضانشده — یک GROUP BY
      db.execute(sql`
        select ed."staffId" as "staffId", count(*) as "unsignedDocs"
        from electronic_documents ed
        where ed."termId" = ${termId} and coalesce(ed."signatureStatus", '') <> 'SIGNED'
        group by ed."staffId"
      `),

      // ۷) فیش‌های محاسبه‌شده
      db.select({
        id: payroll_statements.id, contractId: payroll_statements.contractId,
        staffId: professor_term_contracts.staffId,
        totalEquivalentUnits: payroll_statements.totalEquivalentUnits,
        payableUnits: payroll_statements.payableUnits, grossAmount: payroll_statements.grossAmount,
        deductions: payroll_statements.deductions, netAmount: payroll_statements.netAmount,
        status: payroll_statements.status, detailJson: payroll_statements.detailJson,
        midtermPaidAmount: payroll_statements.midtermPaidAmount, midtermPaidAt: payroll_statements.midtermPaidAt,
        finalPaidAmount: payroll_statements.finalPaidAmount, finalPaidAt: payroll_statements.finalPaidAt,
        computedAt: payroll_statements.computedAt,
      }).from(payroll_statements).innerJoin(
        professor_term_contracts, eq(professor_term_contracts.id, payroll_statements.contractId),
      ).where(eq(professor_term_contracts.termId, termId)),

      db.execute(sql`
        select s."offeringId" as "offeringId", s."dayOfWeek" as "dayOfWeek",
               s."startTime" as "startTime", s."endTime" as "endTime", s."roomId" as "roomId"
        from schedules s
        join course_offerings o on o.id = s."offeringId"
        where o."termId" = ${termId} and s."scheduleType" = 'CLASS'
      `),

      // ۸) نقش دستی استاد در ارائه (مهاجرت 0089؛ خالی = خودکار)
      db.execute(sql`
        select e."offeringId" as "offeringId", e."staffId" as "staffId", e."payRoleOverride" as "role"
        from offering_payroll_extras e
        join course_offerings o on o.id = e."offeringId"
        where o."termId" = ${termId} and e."payRoleOverride" is not null
      `),

      // ۹) دفعهٔ تدریس: تعداد ترم‌های قبلیِ همین استاد+درس (پارامتر پنجم قدیم)
      db.execute(sql`
        select s."staffId" as "staffId", s."courseId" as "courseId", count(distinct s."termId") as "priorTerms"
        from (
          select o."courseId" as "courseId", o."termId" as "termId", o."professorId" as "staffId"
          from course_offerings o where o."isActive" = 1 and o."professorId" is not null
          union
          select o."courseId" as "courseId", o."termId" as "termId", op."staffId" as "staffId"
          from course_offerings o join offering_professors op on op."offeringId" = o.id
          where o."isActive" = 1
        ) s
        join academic_terms t on t.id = s."termId"
        where coalesce(t."sortOrder", 0) < coalesce((select "sortOrder" from academic_terms where id = ${termId}), 0)
        group by s."staffId", s."courseId"
      `),

      // ۱۰) عناوین نقش‌های قابل‌تعریف (مهاجرت 0089)
      db.execute(sql`
        select "code" as "code", "title" as "title" from teaching_role_defs where "isActive" = 1
      `),
    ]);

  const [crowdedThreshold, crowdedStep, crowdedStepUp, rateFractionRaw, rateDivisor, plannedSessionsDefault, msPrefixSetting, effectiveDuties] = await Promise.all([
    getNumber('PAYROLL_CROWDED_THRESHOLD', 40),
    getNumber('PAYROLL_CROWDED_STEP', 25),
    getNumber('PAYROLL_CROWDED_STEP_UP', 0),
    getSetting('PAYROLL_RATE_FRACTION'),
    getNumber('PAYROLL_RATE_DIVISOR', 50),
    getNumber('PAYROLL_TERM_SESSIONS', 16),
    getSetting('PAYROLL_MS_COURSE_PREFIX'),
    // مهاجرت 0056 — موظفی نقش‌محور (یک کوئری برای کل ترم)
    loadTermEffectiveDuties(termId),
  ]);
  const rateFraction = String(rateFractionRaw ?? '').toLowerCase() === 'true';

  // نرخ پایهٔ هر استاد: اسنپ‌شات قرارداد (ترمِ مهرشده) وگرنه بیشترین سال مؤثر ≤ سال جاری
  const year = Number(await getFiscalYear());
  const rateRows = await db
    .select().from(teaching_rates)
    .orderBy(teaching_rates.effectiveYear);
  const rateByStaff = new Map<number, number>();
  const rateSource = new Map<number, 'TABLE' | 'BASE' | 'SNAPSHOT' | 'FRACTION'>();
  const staffInfo = new Map<number, StaffMeta>();
  for (const s of staffRows) {
    staffInfo.set(s.id, {
      name: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim(),
      staffCode: s.staffCode,
      rank: s.academicRank,
      base: (s as { academicBase?: string | null }).academicBase ?? null,
      degree: s.degree,
      userId: s.userId,
    });
  }

  const contractsMap = new Map<number, ContractRow>();
  for (const c of contracts) {
    contractsMap.set(c.staffId, {
      id: c.id,
      staffId: c.staffId,
      contractType: c.contractType,
      baseDutyUnits: Number(c.baseDutyUnits ?? 0),
      taxRate: Number(c.taxRate ?? 0),
      // مهاجرت 0056 — NULL = ردیف قدیمی
      rankSnapshot: (c as { rankSnapshot?: string | null }).rankSnapshot ?? null,
      baseSnapshot: (c as { baseSnapshot?: string | null }).baseSnapshot ?? null,
      rateSnapshot: (c as { rateSnapshot?: string | number | null }).rateSnapshot == null
        ? null
        : Number((c as { rateSnapshot?: string | number | null }).rateSnapshot),
      // مهاجرت 0087 — NULL = ردیف قدیمی ← جدول ثابت
      salaryBase: (c as { salaryBase?: string | number | null }).salaryBase == null
        ? null
        : Number((c as { salaryBase?: string | number | null }).salaryBase),
    });
  }
  // مهاجرت 0056 — اسنپ‌شاتِ حاضر بر مقدار زنده غلبه می‌کند (ابلاغ/فیش ترم قدیمی
  // با همان اعدادِ همان ترم محاسبه می‌شود، نه اعداد امروز استاد).
  // مهاجرت 0090 — این بازنویسی حالا «قبل» از تفکیک نرخ جدول انجام می‌شود تا
  // نرخ ترم قدیمی از مرتبه/پایهٔ همان ترم بیاید، نه امروز استاد.
  for (const [staffId, c] of contractsMap) {
    const info = staffInfo.get(staffId);
    if (!info) continue;
    if (c.rankSnapshot != null) info.rank = c.rankSnapshot;
    if (c.baseSnapshot != null) info.base = c.baseSnapshot;
    if (c.rateSnapshot != null) {
      rateByStaff.set(staffId, c.rateSnapshot);
      rateSource.set(staffId, 'SNAPSHOT');
    }
  }

  // ── نرخ جدول با بُعد پایه (مهاجرت 0090): سطر دقیق (مرتبه+مدرک+پایه) بر
  // سطر عمومی (مرتبه+مدرک، پایه NULL) غلبه می‌کند؛ سطر پایه‌دارِ نامرتبط حذف.
  for (const s of staffRows) {
    const info = staffInfo.get(s.id);
    const rank = info?.rank ?? s.academicRank;
    const sBase = info?.base ?? null;
    const applicable = rateRows
      .filter(r =>
        r.academicRank === rank && r.degree === s.degree && Number(r.effectiveYear ?? 0) <= year &&
        (r.academicBase == null || (sBase != null && r.academicBase === sBase)))
      .sort((a, b) =>
        ((b.academicBase != null ? 1 : 0) - (a.academicBase != null ? 1 : 0)) ||
        Number(b.effectiveYear ?? 0) - Number(a.effectiveYear ?? 0));
    const winRate = applicable[0];
    rateByStaff.set(s.id, Number(winRate?.baseRatePerUnit ?? 0));
    rateSource.set(s.id, winRate?.academicBase != null ? 'BASE' : 'TABLE');
  }

  // ── سوییچ نرخ کسری از حکم (۱/N): مبنای حکم قرارداد ÷ مقسوم ──
  // بالاترین اولویت است (انتخاب صریح ادمین)؛ استاد بدون مبنای حکم از جدول/اسنپ‌شات می‌خواند.
  if (rateFraction && rateDivisor > 0) {
    for (const [staffId, c] of contractsMap) {
      if ((c.salaryBase ?? 0) > 0) {
        rateByStaff.set(staffId, Math.round((c.salaryBase as number) / rateDivisor));
        rateSource.set(staffId, 'FRACTION');
      }
    }
  }

  // ── مهاجرت 0089/0092: نقش دستی + عناوین نقش + شمارش تکرار ──
  const payRoleOverride = new Map<string, string>();
  for (const r of (overrideRows.rows ?? []) as { offeringId: number; staffId: number; role: string }[]) {
    if (r.role) payRoleOverride.set(`${Number(r.offeringId)}:${Number(r.staffId)}`, String(r.role));
  }
  const repeatCount = new Map<string, number>();
  for (const r of (repeatRows.rows ?? []) as { staffId: number; courseId: number; priorTerms: string }[]) {
    repeatCount.set(`${Number(r.staffId)}:${Number(r.courseId)}`, Number(r.priorTerms ?? 0));
  }
  const roleTitles = new Map<string, string>();
  for (const r of (roleDefRows.rows ?? []) as { code: string; title: string }[]) {
    if (r.code) roleTitles.set(String(r.code), String(r.title));
  }

  // کلاس‌ها به تفکیک استاد (اصلی + همکار)
  const offeringsByStaff = new Map<number, StaffOffering[]>();
  const offRows = (offeringRows.rows ?? []) as {
    offeringId: number; professorId: number | null; groupNumber: number | null; enrolledCount: number;
    offeringType: string; mergeKey: string | null; courseCode: string; courseTitle: string; units: string | number;
    practicalUnits: string | number; coStaffId: number | null; coRole: string | null; sharePct: string | number | null;
    courseId: number; theoryUnits: string | number; deptId: number | null; courseType: string | null;
  }[];
  const push = (staffId: number, row: any) => {
    const arr = offeringsByStaff.get(staffId);
    if (arr) arr.push(row);
    else offeringsByStaff.set(staffId, [row]);
  };
  for (const o of offRows) {
    const base = {
      offeringId: o.offeringId,
      courseCode: o.courseCode,
      courseTitle: o.courseTitle,
      unitsInt: unitsToInt(Number(o.units)),
      practicalUnits: Number(o.practicalUnits ?? 0),
      groupNumber: o.groupNumber,
      enrolledCount: Number(o.enrolledCount ?? 0),
      offeringType: o.offeringType ?? 'NORMAL',
      mergeKey: (o.mergeKey ?? null) as string | null,
      courseId: Number(o.courseId),
      theoryUnits: Number(o.theoryUnits ?? 0),
      deptId: o.deptId ?? null,
      courseType: o.courseType ?? null,
    };
    if (o.coStaffId != null) {
      const ov = payRoleOverride.get(`${o.offeringId}:${o.coStaffId}`);
      push(o.coStaffId, { ...base, payRole: ov ?? (o.coRole || 'MAIN_LECTURER'), sharePct: Number(o.sharePct ?? 100) });
    } else if (o.professorId != null) {
      const ov = payRoleOverride.get(`${o.offeringId}:${o.professorId}`);
      push(o.professorId, {
        ...base,
        payRole: ov ?? (base.offeringType === 'THESIS' ? 'SUPERVISOR' : 'MAIN_LECTURER'),
        sharePct: 100,
      });
    }
  }

  const sessionsByOffering = new Map<number, SessionStats>();
  for (const r of (sessionRows.rows ?? []) as { offeringId: number; planned: string; held: string; absents: string; makeup: string }[]) {
    const held = Number(r.held ?? 0);
    const absents = Number(r.absents ?? 0);
    const makeup = Number(r.makeup ?? 0);
    // مبنای تناسب = جلسات «برگزارشدهٔ» اصلی. اگر غیبت‌ها را هم در مخرج بگذاریم،
    // کسر غیبت به‌طور خودکار کوچک می‌شود و اهرم حضور بی‌اثر می‌گردد.
    sessionsByOffering.set(r.offeringId, {
      planned: held,
      held,
      absents,
      makeup,
      netAbsences: Math.max(0, absents - makeup),
    });
  }

  const gatesByStaff = new Map<number, { pendingGrades: number; unsignedDocs: number }>();
  for (const r of (gradeRows.rows ?? []) as { staffId: number; pendingGrades: string }[]) {
    gatesByStaff.set(Number(r.staffId), { pendingGrades: Number(r.pendingGrades ?? 0), unsignedDocs: 0 });
  }
  for (const r of (docRows.rows ?? []) as { staffId: number; unsignedDocs: string }[]) {
    const cur = gatesByStaff.get(Number(r.staffId)) ?? { pendingGrades: 0, unsignedDocs: 0 };
    cur.unsignedDocs = Number(r.unsignedDocs ?? 0);
    gatesByStaff.set(Number(r.staffId), cur);
  }

  const statementsByStaff = new Map<number, StatementRow>();
  for (const s of statementRows as StatementRow[]) statementsByStaff.set(Number(s.staffId), s);

  const slotsByOffering = new Map<number, string>();
  const slotLists = new Map<number, { dayOfWeek: number | null; startTime: string | null; endTime: string | null; roomKey: number | null }[]>();
  for (const r of (slotRows.rows ?? []) as { offeringId: number; dayOfWeek: number | null; startTime: string | null; endTime: string | null; roomId: number | null }[]) {
    const list = slotLists.get(Number(r.offeringId)) ?? [];
    list.push({ dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime, roomKey: r.roomId });
    slotLists.set(Number(r.offeringId), list);
  }
  for (const [id, slots] of slotLists) {
    const key = mergedGroupKey(null, slots);
    if (key) slotsByOffering.set(id, key);
  }

  return {
    termId,
    termTitle: term?.title ?? '',
    coefs,
    rules,
    rateByStaff,
    contracts: contractsMap,
    effectiveDuties,
    staffInfo,
    offeringsByStaff,
    sessionsByOffering,
    slotsByOffering,
    gatesByStaff,
    statementsByStaff,
    msPrefixes: msPrefixSetting.split(',').map(x => x.trim()).filter(Boolean),
    crowdedThreshold,
    crowdedStep,
    crowdedStepUp,
    rateFraction,
    rateDivisor,
    rateSource,
    plannedSessionsDefault,
    roleTitles,
    payRoleOverride,
    repeatCount,
  };
}

// ─────────────────── محاسبهٔ فیش یک استاد ───────────────────

/**
 * گلوگاه‌های یک استاد با دو کوئری سبک (index-friendly) به‌جای بارگذاری کامل ترم.
 * هم‌ارز منطقیِ کوئری‌های ۵ و ۶ در loadTermPayrollData است — فقط برای یک استاد.
 * علت وجود: settleFinal برای هر استاد داخل تراکنش گلوگاه را می‌چکد؛ بارگذاری کامل
 * ترم در آن نقطه با ۱۵۰۰ استاد یعنی ۵۰۰×۱۱ کوئری سنگین (مشاهده‌شده: ۳۲۰ ثانیه).
 */
async function loadStaffGates(
  q: Parameters<Parameters<typeof db.transaction>[0]>[0],
  termId: number,
  staffId: number,
) {
  const [gradeRow, docRow] = await Promise.all([
    // همان بازنویسیِ گلوگاهِ ترم، ولی برای یک استاد: به‌جای
    // `professorId = X OR exists(...)` که برای هر ارائه یک زیرکوئریِ همبسته
    // اجرا می‌کرد، دو شاخهٔ تساوی‌محور را با `union` یکی می‌کنیم تا هر دو شاخه
    // از ایندکسِ خودشان (`idx_co_prof_term` و `idx_op_staff_offering`) بخوانند.
    q.execute(sql`
      with my_offerings as (
        select o.id as "offeringId"
        from course_offerings o
        where o."termId" = ${termId} and o."professorId" = ${staffId}
        union
        select op."offeringId" as "offeringId"
        from offering_professors op
        join course_offerings o2 on o2.id = op."offeringId"
        where o2."termId" = ${termId} and op."staffId" = ${staffId}
      )
      select count(e.id) as "pendingGrades"
      from my_offerings m
      join enrollments e on e."offeringId" = m."offeringId"
        and e.status = 'REGISTERED' and coalesce(e."gradeStatus", '') <> 'FINALIZED'
    `),
    q.execute(sql`
      select count(*) as "unsignedDocs"
      from electronic_documents ed
      where ed."termId" = ${termId} and ed."staffId" = ${staffId} and coalesce(ed."signatureStatus", '') <> 'SIGNED'
    `),
  ]);
  const pendingGrades = Number(gradeRow.rows[0]?.pendingGrades ?? 0);
  const unsignedDocs = Number(docRow.rows[0]?.unsignedDocs ?? 0);
  return { pendingGrades, unsignedDocs, gradesFinalized: pendingGrades === 0, docsSigned: unsignedDocs === 0 };
}

function gatesOf(data: TermData, staffId: number) {
  const g = data.gatesByStaff.get(staffId) ?? { pendingGrades: 0, unsignedDocs: 0 };
  return {
    pendingGrades: g.pendingGrades,
    unsignedDocs: g.unsignedDocs,
    gradesFinalized: g.pendingGrades === 0,
    docsSigned: g.unsignedDocs === 0,
  };
}

function pickMergedSessions(data: TermData, ids: number[]): SessionStats {
  let best: SessionStats | null = null;
  for (const id of ids) {
    const s = data.sessionsByOffering.get(id);
    if (!s) continue;
    if (!best || s.held > best.held) best = s;
  }
  return best ?? { planned: 0, held: 0, absents: 0, makeup: 0, netAbsences: 0 };
}

export function calcStaffPayrollFromData(data: TermData, staffId: number): StaffPayroll {
  const info = data.staffInfo.get(staffId);
  if (!info) throw new Error('استاد یافت نشد.');
  const contract = data.contracts.get(staffId);
  const rate = data.rateByStaff.get(staffId) ?? 0;
  // مهاجرت 0056 — موظفی از «نقش» می‌آید نه مرتبه: نقش تدریسی منتسب باشد ←
  // موظفی مؤثر نقش‌محور، وگرنه بازگشت به baseDutyUnits قدیمی (سازگار با گذشته)
  const roleDuty = data.effectiveDuties.get(staffId);
  const dutyUnits = roleDuty ?? contract?.baseDutyUnits ?? 0;
  const taxRate = contract?.taxRate ?? 0;
  const offerings = collapseMergedOfferings(
    data.offeringsByStaff.get(staffId) ?? [],
    id => data.slotsByOffering.get(id) ?? null,
  );

  const rows: PayrollRow[] = [];
  let totalEquivInt = 0;
  let totalEffectiveInt = 0;
  let absenceDeductionRial = 0;

  for (const o of offerings) {
    const memberIds = o.mergedMemberIds ?? [o.offeringId];
    const sessions = pickMergedSessions(data, memberIds);
    // وضعیت کلاس: داشتن جلسه CLASS یعنی باکلاس (خودخوان/معرفی/کارآموزی بدون کلاس)
    const hasClass = memberIds.some(id => data.slotsByOffering.has(id));
    const nth = (data.repeatCount.get(`${staffId}:${o.courseId}`) ?? 0) + 1;
    const rule = matchRule(data.rules, {
      offeringType: o.offeringType, role: o.payRole, rank: info.rank, hasClass,
      enrolled: o.enrolledCount, deptId: o.deptId, courseType: o.courseType, nth,
    });
    const mergedMark = o.mergedMemberIds && o.mergedMemberIds.length > 1 ? ' (کلاس ادغامی)' : '';

    // ── مسیر عبارت یکپارچه (0092): یک عبارت، خروجی مستقیم ریال ──
    if (rule) {
      const students = o.enrolledCount;
      const crowd = crowdedMult(students, data);
      const expr = (rule.expression ?? '').trim() || 'RT*UN';
      let rial = 0;
      let err: string | null = null;
      try {
        rial = toRial(evalFormula(expr, {
          TH: o.theoryUnits,
          PH: o.practicalUnits * 2,
          WH: 0,
          UN: intToUnits(o.unitsInt),
          ST: students,
          RT: rate,
          CF: crowd.mult,
          BS: rule.flatBase ?? 0,
          HR: rule.perStudentHours ?? 0,
        }));
      } catch (e) { err = (e as Error).message; }
      const equivInt = rate > 0 ? Math.round((rial / rate) * UNIT_SCALE) : 0;
      const roleFa = roleLabel(data, o.payRole);
      const label = err
        ? `فرمول ${TYPE_FA[o.offeringType] || o.offeringType}/${roleFa} — خطا: ${err}`
        : `فرمول ${TYPE_FA[o.offeringType] || o.offeringType}/${roleFa}${nth > 1 ? ` (تکرار ${nth})` : ''}: ${expr} = ${groupThousands(rial)}`;
      totalEquivInt += equivInt;
      totalEffectiveInt += equivInt;
      rows.push({
        offeringId: o.offeringId, courseCode: o.courseCode, courseTitle: o.courseTitle,
        units: intToUnits(o.unitsInt), groupNumber: o.groupNumber, payRole: o.payRole, offeringType: o.offeringType,
        coefficients: label + mergedMark, equivalentUnits: intToUnits(equivInt), sessions,
        effectiveUnits: intToUnits(equivInt), absenceDeductionRial: 0, grossRial: rial, ruleTitle: rule.title,
      });
      continue;
    }

    // ── مسیر ضرایب استاندارد ──
    const applied: string[] = [];
    let multiplierInt = UNIT_SCALE; // 1.00 با مقیاس ۱۰۰
    if (o.practicalUnits > 0) { multiplierInt = Math.round(multiplierInt * data.coefs.practical); applied.push(`عملی ×${data.coefs.practical}`); }
    if (o.courseCode.split('/').some(c => data.msPrefixes.some(p => c.startsWith(p)))) { multiplierInt = Math.round(multiplierInt * data.coefs.msLevel); applied.push(`ارشد ×${data.coefs.msLevel}`); }
    const crowd = crowdedMult(o.enrolledCount, data);
    if (crowd.label) { multiplierInt = Math.round(multiplierInt * crowd.mult); applied.push(crowd.label); }
    if (mergedMark) applied.push('کلاس ادغامی');

    const sharePct = Number.isFinite(o.sharePct) ? o.sharePct : 100;
    if (sharePct < 100) applied.push(`سهم ${Math.round(sharePct)}٪`);

    const equivInt = Math.round((o.unitsInt * multiplierInt) / UNIT_SCALE * sharePct / 100);
    const planned = sessions.planned || data.plannedSessionsDefault;
    const effectiveInt = ratioOf(equivInt, planned - sessions.netAbsences, planned);
    const grossRial = toRial(intToUnits(equivInt) * rate);
    const deduction = toRial(intToUnits(equivInt - effectiveInt) * rate);

    totalEquivInt += equivInt;
    totalEffectiveInt += effectiveInt;
    absenceDeductionRial += deduction;

    rows.push({
      offeringId: o.offeringId, courseCode: o.courseCode, courseTitle: o.courseTitle,
      units: intToUnits(o.unitsInt), groupNumber: o.groupNumber, payRole: o.payRole, offeringType: o.offeringType,
      coefficients: applied.length ? applied.join('، ') : '—',
      equivalentUnits: intToUnits(equivInt), sessions,
      effectiveUnits: intToUnits(effectiveInt), absenceDeductionRial: deduction, grossRial, ruleTitle: null,
    });
  }

  const dutyInt = unitsToInt(dutyUnits);
  const payableInt = Math.max(0, totalEffectiveInt - dutyInt);
  const gross = toRial(intToUnits(payableInt) * rate);
  const absenceTotal = toRial(absenceDeductionRial);
  const taxable = Math.max(0, gross - absenceTotal);
  const tax = toRial((taxable * taxRate) / 100);
  const net = Math.max(0, taxable - tax);

  return {
    staff: {
      id: staffId, name: info.name, staffCode: info.staffCode,
      rank: info.rank, base: info.base, degree: info.degree,
      contractType: contract?.contractType ?? null,
    },
    rate, dutyUnits, taxRate, rows,
    rateSource: data.rateSource.get(staffId) ?? 'TABLE',
    rateDivisor: data.rateDivisor,
    totalEquivalentUnits: intToUnits(totalEquivInt),
    totalEffectiveUnits: intToUnits(totalEffectiveInt),
    payableUnits: intToUnits(payableInt),
    gross,
    absenceDeductionRial: absenceTotal,
    tax,
    net,
    gates: gatesOf(data, staffId),
    hasContract: Boolean(contract),
  };
}

/** محاسبهٔ فیش یک استاد (با بارگذاری مستقل داده) */
export async function calcStaffPayroll(staffId: number, termId?: number): Promise<StaffPayroll> {
  const term = await currentTerm(termId);
  if (!term) throw new Error('ترم جاری مشخص نیست.');
  const data = await loadTermPayrollData(term.id);
  return calcStaffPayrollFromData(data, staffId);
}

// ─────────────────── فیش کل ترم (کارشناس مالی) ───────────────────

export type ComputeTermResult = {
  ok: boolean;
  termTitle: string;
  computed: number;
  skippedNoContract: number;
  skippedSettled: number;
  /** فیش‌های در زنجیرهٔ تأیید/ردشده که بدون بازگشت به DRAFT دست نخوردند */
  skippedLocked: number;
  totals: { gross: number; deductions: number; net: number };
};

/**
 * محاسبهٔ فیش همهٔ اساتید ترم — یک بار بارگذاری داده، سپس upsert دسته‌جمعی.
 * اساتید بدون قرارداد از محاسبه کنار گذاشته می‌شوند (نه خطا).
 */
export async function computeTermPayroll(actorUserId?: number | null, termId?: number): Promise<ComputeTermResult> {
  const term = await currentTerm(termId);
  if (!term) throw new Error('ترم جاری مشخص نیست.');
  const data = await loadTermPayrollData(term.id);

  const staffIds = Array.from(data.offeringsByStaff.keys());
  const values: (typeof payroll_statements.$inferInsert)[] = [];
  let computed = 0;
  let skippedNoContract = 0;
  let skippedSettled = 0;
  let skippedLocked = 0;
  const lockedIds: number[] = [];
  const totals = { gross: 0, deductions: 0, net: 0 };
  const updates: { id: number; set: Record<string, unknown> }[] = [];

  for (const staffId of staffIds) {
    const contract = data.contracts.get(staffId);
    if (!contract) { skippedNoContract++; continue; }
    const existing = data.statementsByStaff.get(staffId);
    if (existing && existing.status === 'FINAL_SETTLED') { skippedSettled++; continue; }
    // 🔒 محاسبهٔ مجدد روی فیشِ در زنجیرهٔ تأیید (مدیر گروه/معاونت) یا ردشده
    // ممنوع است مگر با بازگشت صریح به DRAFT (returnStatement با audit)؛
    // وگرنه تأییدِ در جریان بی‌اثر/دورزده می‌شد. MID_TERM_PAID استثناست چون
    // وضعیتش پرداختِ واقعی است نه مرحلهٔ تأیید (مبالغ فقط به‌روز می‌شوند).
    if (existing?.id && !['DRAFT', 'MID_TERM_PAID'].includes(existing.status ?? '')) {
      skippedLocked++;
      lockedIds.push(existing.id);
      continue;
    }
    const calc = calcStaffPayrollFromData(data, staffId);
    const deductions = calc.tax + calc.absenceDeductionRial;
    const detail = JSON.stringify({
      rows: calc.rows, rate: calc.rate, dutyUnits: calc.dutyUnits, taxRate: calc.taxRate,
      rateSource: calc.rateSource, rateDivisor: calc.rateDivisor,
      absenceDeductionRial: calc.absenceDeductionRial, staff: calc.staff, gates: calc.gates,
      engine: 'payroll-engine.v2', scale: UNIT_SCALE,
    });
    totals.gross += calc.gross;
    totals.deductions += deductions;
    totals.net += calc.net;

    // مهاجرت 0056 — مهر اسنپ‌شات ترمی روی فیش: اسنپ‌شات قرارداد اگر هست،
    // وگرنه مقدارِ همین محاسبه (که خودش اسنپ‌شات-یا-زنده است)؛ NULL نمی‌ماند
    const snapRank = contract.rankSnapshot ?? calc.staff.rank ?? null;
    const snapBase = contract.baseSnapshot ?? null;
    const snapRate = contract.rateSnapshot ?? calc.rate;

    if (existing?.id) {
      updates.push({
        id: existing.id,
        set: {
          totalEquivalentUnits: String(calc.totalEquivalentUnits),
          payableUnits: String(calc.payableUnits),
          grossAmount: String(calc.gross),
          deductions: String(deductions),
          netAmount: String(calc.net),
          detailJson: detail,
          computedAt: new Date(),
          rankSnapshot: snapRank,
          baseSnapshot: snapBase,
          rateSnapshot: String(snapRate),
        },
      });
    } else {
      values.push({
        contractId: contract.id,
        totalEquivalentUnits: String(calc.totalEquivalentUnits),
        payableUnits: String(calc.payableUnits),
        grossAmount: String(calc.gross),
        deductions: String(deductions),
        netAmount: String(calc.net),
        detailJson: detail,
        status: 'DRAFT',
        rankSnapshot: snapRank,
        baseSnapshot: snapBase,
        rateSnapshot: String(snapRate),
      });
    }
    computed++;
  }

  await db.transaction(async tx => {
    if (values.length) await tx.insert(payroll_statements).values(values);
    for (const u of updates) await tx.update(payroll_statements).set(u.set).where(eq(payroll_statements.id, u.id));
    // 🔒 فیش‌های قفل (در زنجیرهٔ تأیید) که دست نخوردند، با شناسه در audit می‌مانند.
    await writeAudit(tx, actorUserId ?? null, 'PAYROLL_COMPUTED', 'term', term.id, {
      computed, skippedNoContract, skippedSettled, skippedLocked, lockedIds, totals,
    });
  });

  log.info('payroll_computed', { termId: term.id, computed, skippedNoContract, skippedSettled, skippedLocked });
  return { ok: true, termTitle: term.title, computed, skippedNoContract, skippedSettled, skippedLocked, totals };
}

// ─────────────────── داشبورد مالی ───────────────────

export async function getOverview(termId?: number, universityId?: number): Promise<{
  term: string;
  list: PayrollOverviewItem[];
  totals: { budget: number; paid: number; remaining: number; staffCount: number };
}> {
  const term = await currentTerm(termId);
  if (!term) throw new Error('ترم جاری مشخص نیست.');
  const data = await loadTermPayrollData(term.id, universityId);

  const list: PayrollOverviewItem[] = [];
  for (const staffId of Array.from(data.offeringsByStaff.keys())) {
    if (!data.contracts.has(staffId)) continue;   // بدون قرارداد → در فهرست پرداخت نیست
    if (!data.staffInfo.get(staffId)) {
      // استاد یتیم (کاربر حذف‌شده): یک ردیف خراب نباید کل نمای ترم را بخواباند
      log.warn('overview_skip_orphan_staff', { staffId, termId: term.id });
      continue;
    }
    let calc;
    try {
      calc = calcStaffPayrollFromData(data, staffId);
    } catch (e) {
      log.warn('overview_skip_failed_staff', { staffId, termId: term.id, err: (e as Error).message });
      continue;
    }
    const ps = data.statementsByStaff.get(staffId);
    const midtermPaid = toRial(Number(ps?.midtermPaidAmount ?? 0));
    const finalPaid = toRial(Number(ps?.finalPaidAmount ?? 0));
    const status = (ps?.status as PayrollStatus | undefined) ?? 'NOT_COMPUTED';
    list.push({
      ...calc.staff,
      rate: calc.rate,
      rateSource: calc.rateSource,
      dutyUnits: calc.dutyUnits,
      totalEquivalentUnits: calc.totalEquivalentUnits,
      totalEffectiveUnits: calc.totalEffectiveUnits,
      payableUnits: calc.payableUnits,
      gross: calc.gross,
      tax: calc.tax,
      absenceDeductionRial: calc.absenceDeductionRial,
      net: calc.net,
      status,
      statementId: ps?.id ?? null,
      midtermPaid,
      finalPaid,
      remaining: status === 'FINAL_SETTLED' ? 0 : Math.max(0, calc.net - midtermPaid - finalPaid),
      gates: calc.gates,
    });
  }

  const totals = list.reduce(
    (a, x) => ({
      budget: a.budget + x.net,
      paid: a.paid + x.midtermPaid + x.finalPaid,
      remaining: a.remaining + x.remaining,
      staffCount: a.staffCount + 1,
    }),
    { budget: 0, paid: 0, remaining: 0, staffCount: 0 },
  );

  return { term: term.title, list, totals };
}

/** فیش جاری یک استاد — برای پرتال استاد */
export async function getStaffPayslip(staffId: number, termId?: number) {
  const term = await currentTerm(termId);
  if (!term) throw new Error('ترم جاری مشخص نیست.');
  const data = await loadTermPayrollData(term.id);
  const calc = calcStaffPayrollFromData(data, staffId);
  const ps = data.statementsByStaff.get(staffId);
  const midtermPaid = toRial(Number(ps?.midtermPaidAmount ?? 0));
  const finalPaid = toRial(Number(ps?.finalPaidAmount ?? 0));
  return {
    term: term.title,
    computed: Boolean(ps),
    calc,
    statement: ps
      ? {
          id: ps.id,
          status: ps.status as PayrollStatus,
          midtermPaidAmount: midtermPaid,
          midtermPaidAt: ps.midtermPaidAt,
          finalPaidAmount: finalPaid,
          finalPaidAt: ps.finalPaidAt,
          remaining: Math.max(0, calc.net - midtermPaid - finalPaid),
        }
      : null,
  };
}

// ─────────────────── پرداخت‌ها ───────────────────

/** زنجیرهٔ هش ممیزی — هر رکورد به رکورد قبلی گره می‌خورد */
async function writeAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  actorUserId: number | null,
  action: string,
  entityType: string,
  entityId: number | null,
  details: Record<string, unknown>,
) {
  // قفل آخرین رکورد → زنجیرهٔ هش در نوشتن‌های همزمان خطی می‌ماند
  const [last] = await tx.select({ hash: audit_logs.hash }).from(audit_logs).orderBy(sql`${audit_logs.id} desc`).limit(1).for('update');
  const prevHash = last?.hash ?? '';
  const hash = crypto
    .createHash('sha256')
    .update(`${prevHash}|${action}|${entityType}|${entityId ?? ''}|${JSON.stringify(details)}`)
    .digest('hex');
  await tx.insert(audit_logs).values({
    actorUserId, action, entityType, entityId,
    details: JSON.stringify(details), prevHash, hash,
  });
}

/** علی‌الحساب میان‌ترم — درصد از تنظیمات، پرداخت در تراکنش با قفل سطری */
export async function payMidterm(staffId: number, actorUserId?: number | null, termId?: number) {
  const term = await currentTerm(termId);
  if (!term) throw new Error('ترم جاری مشخص نیست.');
  const pct = await getNumber('PAYROLL_MIDTERM_PERCENT', 40);

  const { amount, userId } = await db.transaction(async tx => {
    const [ps] = await tx
      .select({
        id: payroll_statements.id, status: payroll_statements.status, netAmount: payroll_statements.netAmount,
        midtermPaidAmount: payroll_statements.midtermPaidAmount,
      })
      .from(payroll_statements)
      .innerJoin(professor_term_contracts, eq(professor_term_contracts.id, payroll_statements.contractId))
      .where(and(eq(professor_term_contracts.staffId, staffId), eq(professor_term_contracts.termId, term.id)))
      .for('update');
    if (!ps) throw new Error('ابتدا فیش ترم را محاسبه کنید.');
    if (ps.status !== 'DRAFT') throw new Error('علی‌الحساب میان‌ترم قبلاً پرداخت یا تسویه شده است.');

    const net = toRial(Number(ps.netAmount ?? 0));
    const amount = percentOf(net, pct);
    await tx
      .update(payroll_statements)
      .set({ midtermPaidAmount: String(amount), midtermPaidAt: new Date(), status: 'MID_TERM_PAID' })
      .where(eq(payroll_statements.id, ps.id));
    await writeAudit(tx, actorUserId ?? null, 'PAYROLL_MIDTERM', 'staff', staffId, { amount, pct, statementId: ps.id });

    const [st] = await tx.select({ userId: staff.userId }).from(staff).where(eq(staff.id, staffId)).limit(1);
    return { amount, userId: st?.userId ?? null };
  });

  if (userId) {
    await safeNotify(userId, 'PAYROLL_MIDTERM',
      `استاد گرامی، علی‌الحساب میان‌ترم حق‌التدریس شما به مبلغ ${groupThousands(amount)} ریال پرداخت شد.`);
  }
  return { ok: true, amount };
}

/** تسویهٔ نهایی — هر دو گلوگاه باید بسته باشد */
export async function settleFinal(
  staffId: number,
  actorUserId?: number | null,
  termId?: number,
  opts?: {
    /** قلابِ داخلِ همان تراکنش تسویه (مثلاً درج ردیف FINANCE در تاریخچهٔ تأیید) — اتمی با پرداخت */
    afterSettle?: (tx: EngineTx, statementId: number) => Promise<void>;
  },
) {
  const term = await currentTerm(termId);
  if (!term) throw new Error('ترم جاری مشخص نیست.');

  const { amount, userId, gates } = await db.transaction(async tx => {
    const [ps] = await tx
      .select({
        id: payroll_statements.id, status: payroll_statements.status, netAmount: payroll_statements.netAmount,
        midtermPaidAmount: payroll_statements.midtermPaidAmount, finalPaidAmount: payroll_statements.finalPaidAmount,
      })
      .from(payroll_statements)
      .innerJoin(professor_term_contracts, eq(professor_term_contracts.id, payroll_statements.contractId))
      .where(and(eq(professor_term_contracts.staffId, staffId), eq(professor_term_contracts.termId, term.id)))
      .for('update');
    if (!ps) throw new Error('ابتدا فیش ترم را محاسبه کنید.');
    if (ps.status === 'FINAL_SETTLED') throw new Error('این فیش قبلاً تسویه شده است.');
    // پیش‌شرط زنجیرهٔ تأیید — بررسی زودهنگام (خطای واضح) + محموله در UPDATE (ضد-رقابت) هر دو.
    if (ps.status !== 'DEAN_APPROVED') {
      throw new Error('تسویهٔ نهایی فقط پس از تأیید معاونت آموزشی ممکن است (وضعیت فعلی نیازمند طی زنجیرهٔ تأیید است).');
    }

    // گلوگاه‌ها داخل همان تراکنش خوانده می‌شوند تا بین بررسی و پرداخت چیزی عوض نشود
    // (دو کوئری سبک به‌جای بارگذاری کامل ترم — برای پرداخت دسته‌ای صدها برابر سریع‌تر)
    const g = await loadStaffGates(tx, term.id, staffId);
    if (!g.gradesFinalized) throw new Error(`گلوگاه تسویه: ${g.pendingGrades} نمره هنوز FINALIZED نشده است.`);
    if (!g.docsSigned) throw new Error(`گلوگاه تسویه: ${g.unsignedDocs} سند الکترونیکی امضانشده دارید.`);

    const net = toRial(Number(ps.netAmount ?? 0));
    const paid = toRial(Number(ps.midtermPaidAmount ?? 0)) + toRial(Number(ps.finalPaidAmount ?? 0));
    const amount = Math.max(0, net - paid);

    // 🔒 محمولهٔ وضعیت داخل تراکنش: فقط DEAN_APPROVED → FINAL_SETTLED؛
    // اگر وضعیت در همین لحظه عوض شده باشد rowCount≠1 و تراکنش برمی‌گردد.
    const upd = await tx
      .update(payroll_statements)
      .set({ finalPaidAmount: String(amount), finalPaidAt: new Date(), status: 'FINAL_SETTLED' })
      .where(and(eq(payroll_statements.id, ps.id), eq(payroll_statements.status, 'DEAN_APPROVED')));
    if (upd.rowCount !== 1) {
      throw new Error('وضعیت فیش در همین لحظه تغییر کرده است؛ تسویه انجام نشد. دوباره تلاش کنید.');
    }
    await writeAudit(tx, actorUserId ?? null, 'PAYROLL_SETTLED', 'staff', staffId, { amount, statementId: ps.id, gates: g });
    // ردیف تکمیلی فراخواننده (تاریخچهٔ FINANCE) در همان تراکنش — نه جدا.
    if (opts?.afterSettle) await opts.afterSettle(tx, ps.id);

    const [st] = await tx.select({ userId: staff.userId }).from(staff).where(eq(staff.id, staffId)).limit(1);
    return { amount, userId: st?.userId ?? null, gates: g };
  });

  if (userId) {
    await safeNotify(userId, 'PAYROLL_SETTLED',
      `استاد گرامی، تسویهٔ نهایی حق‌التدریس ترم به مبلغ ${groupThousands(amount)} ریال انجام شد. سپاس از به‌موقع‌بودن ثبت نمرات.`);
  }
  return { ok: true, amount, gates };
}

/** خروجی واریز دسته‌جمعی (CSV بانکی ۳۰ ستونه) */
export async function exportBatch(termId?: number) {
  const ov = await getOverview(termId);
  // ۳۰ ستون استاندارد دیسکت بانکی + جزئیات محاسبه حق‌التدریس
  const headers = [
    'ردیف',
    'شناسه پرسنلی',
    'کد ملی',
    'نام استاد',
    'مرتبه علمی',
    'مدرک تحصیلی',
    'نوع قرارداد',
    'شماره حساب بانکی',
    'نام بانک',
    'شعبه بانک',
    'شبا',
    'مبلغ ناخالص حق‌التدریس (ریال)',
    'کسر غیبت (ریال)',
    'مالیات (ریال)',
    'بیمه (ریال)',
    'سایر کسورات (ریال)',
    'مجموع کسورات (ریال)',
    'مبلغ خالص قابل واریز (ریال)',
    'واحدهای تدریس (معادل)',
    'ساعات تدریس',
    'ساعات غیبت',
    'واحدهای موظفی (الزامی)',
    'واحدهای مشمول محاسبه',
    'ضریب درس عملی',
    'ضریب مقطع ارشد',
    'ضریب کلاس جمعی',
    'نرخ پایه هر واحد (ریال)',
    'نرخ موثر با ضرایب (ریال)',
    'وضعیت فیش',
    'پرداخت میان‌ترم (ریال)',
    'پرداخت نهایی (ریال)',
    'باقی‌مانده قابل پرداخت (ریال)',
  ];
  const lines = [headers.join(',')];
  let count = 0;

  for (const x of ov.list) {
    if (x.status === 'NOT_COMPUTED') continue;

    // دریافت اطلاعات تکمیلی پرسنل (حساب بانکی، کد ملی، شعبه)
    const staffDetail = await db
      .select({
        bankAccountNo: staff.bankAccountNo,
        nationalCode: users.nationalCode,
        staffCode: staff.staffCode,
      })
      .from(staff)
      .innerJoin(users, eq(users.id, staff.userId))
      .where(eq(staff.id, x.id))
      .limit(1);

    const detail = staffDetail[0] ?? {};
    const bankAccountNo = detail.bankAccountNo ?? '';
    const nationalCode = detail.nationalCode ?? '';
    const staffCode = detail.staffCode ?? String(x.id);

    // محاسبه ساعات تدریس و غیبت از ردیف‌های فیش
    const slips = await getStaffPayslip(x.id, termId);
    const calcRows = slips.calc?.rows ?? [];

    let totalTeachingUnits = 0;
    let totalTeachingHours = 0;
    let totalAbsenceHours = 0;
    let obligatoryUnits = x.dutyUnits ?? 0;
    let includedUnits = x.payableUnits ?? 0;
    let practicalCoef = 1;
    let msCoef = 1;
    let crowdedCoef = 1;
    let baseRate = x.rate ?? 0;
    let effectiveRate = baseRate;

    // استخراج ضرایب از ردیف‌های محاسبه
    for (const row of calcRows) {
      totalTeachingUnits += Number(row.equivalentUnits ?? 0);
      const sessionsHeld = Number(row.sessions?.held ?? 0);
      const sessionHours = sessionsHeld * 2; // فرض: هر جلسه ۲ ساعته
      totalTeachingHours += sessionHours;
      totalAbsenceHours += Number(row.sessions?.netAbsences ?? 0) * 2;

      // استخراج ضرایب از متن coefficients
      const coefText = row.coefficients ?? '';
      if (coefText.includes('عملی')) {
        const match = coefText.match(/عملی\s*[×x]\s*([\d.]+)/);
        if (match) practicalCoef = parseFloat(match[1]);
      }
      if (coefText.includes('ارشد')) {
        const match = coefText.match(/ارشد\s*[×x]\s*([\d.]+)/);
        if (match) msCoef = parseFloat(match[1]);
      }
      if (coefText.includes('جمعی')) {
        const match = coefText.match(/جمعی\s*[×x]\s*([\d.]+)/);
        if (match) crowdedCoef = parseFloat(match[1]);
      }
    }

    // نرخ موثر = نرخ پایه × حاصل‌ضرب ضرایب
    effectiveRate = Math.round(baseRate * practicalCoef * msCoef * crowdedCoef);

    const amt = x.status === 'FINAL_SETTLED' ? 0 : x.remaining;
    const insurance = 0; // بیمه در مدل فعلی جداگانه محاسبه می‌شود (در InsuranceAdvancesTab)
    const otherDeductions = 0;
    const totalDeductions = x.tax + x.absenceDeductionRial + insurance + otherDeductions;

    const row = [
      String(count + 1),                    // ردیف
      `"${staffCode}"`,                     // شناسه پرسنلی
      `"${nationalCode}"`,                  // کد ملی
      `"${x.name}"`,                        // نام استاد
      `"${x.rank ?? ''}"`,                  // مرتبه علمی
      `"${x.degree ?? ''}"`,                // مدرک تحصیلی
      `"${x.contractType ?? ''}"`,          // نوع قرارداد
      `"${bankAccountNo}"`,                 // شماره حساب بانکی
      '""',                                 // نام بانک (نیاز به جدول بانکی جداگانه)
      '""',                                 // شعبه بانک
      '""',                                 // شبا
      String(x.gross),                      // مبلغ ناخالص
      String(x.absenceDeductionRial),       // کسر غیبت
      String(x.tax),                        // مالیات
      String(insurance),                    // بیمه
      String(otherDeductions),              // سایر کسورات
      String(totalDeductions),              // مجموع کسورات
      String(amt),                          // مبلغ خالص قابل واریز
      String(totalTeachingUnits.toFixed(2)), // واحدهای تدریس (معادل)
      String(totalTeachingHours),           // ساعات تدریس
      String(totalAbsenceHours),            // ساعات غیبت
      String(obligatoryUnits.toFixed(2)),   // واحدهای موظفی (الزامی)
      String(includedUnits.toFixed(2)),     // واحدهای مشمول محاسبه
      String(practicalCoef.toFixed(2)),     // ضریب درس عملی
      String(msCoef.toFixed(2)),            // ضریب مقطع ارشد
      String(crowdedCoef.toFixed(2)),       // ضریب کلاس جمعی
      String(baseRate),                     // نرخ پایه هر واحد
      String(effectiveRate),                // نرخ موثر با ضرایب
      `"${x.status}"`,                      // وضعیت فیش
      String(x.midtermPaid),                // پرداخت میان‌ترم
      String(x.finalPaid),                  // پرداخت نهایی
      String(x.remaining),                  // باقی‌مانده قابل پرداخت
    ];
    lines.push(row.join(','));
    count++;
  }
  return { csv: lines.join('\n'), count, term: ov.term, totals: ov.totals };
}

async function safeNotify(userId: number, eventCode: string, text: string) {
  try {
    await notifyUserMultichannel({ userId, eventCode, text });
  } catch (err) {
    log.warn('payroll_notify_failed', { userId, eventCode, err: (err as Error).message });
  }
}

/** فهرست اساتیدی که در ترم کلاس دارند — برای کارتابل مالی */
export async function listPayableStaff(termId?: number) {
  const term = await currentTerm(termId);
  if (!term) return [];
  const data = await loadTermPayrollData(term.id);
  return Array.from(data.offeringsByStaff.keys())
    .map(id => ({ staffId: id, ...(data.staffInfo.get(id) ?? { name: '', staffCode: null, rank: null, base: null, degree: null, userId: 0 }), hasContract: data.contracts.has(id) }))
    .filter(x => x.hasContract);
}

/** قوانین فرمول‌ساز و ضرایب فعلی — برای نمایش شفاف در پنل مالی */
export async function listPayConfiguration() {
  const [rules, coefs, rates, year] = await Promise.all([
    loadPayRules(), loadCoefficients(), db.select().from(teaching_rates).orderBy(teaching_rates.effectiveYear), getFiscalYear(),
  ]);
  const [crowded, sessions, midterm] = await Promise.all([
    getNumber('PAYROLL_CROWDED_THRESHOLD', 40),
    getNumber('PAYROLL_TERM_SESSIONS', 16),
    getNumber('PAYROLL_MIDTERM_PERCENT', 40),
  ]);
  return { rules, coefs, rates, year, crowded, sessions, midterm };
}

/** مجموع واحد معادل تجمیعی (برای گزارش بودجه) */
export function sumPayroll(list: { net: number }[]) {
  return { net: sumUnits(list.map(x => x.net)), count: list.length };
}

export const PAYROLL_CONSTANTS = { UNIT_SCALE };
export type { PayRule };
