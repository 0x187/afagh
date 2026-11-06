// ════════════════════════════════════════════════════════════════════════════
// فاز ۱ — Domain Model برنامهٔ درسی (Pure Types & Domain Rules)
// ────────────────────────────────────────────────────────────────────────────
// این فایل عمداً هیچ import ای از DB / React / Next ندارد؛ فقط نوع‌ها و
// منطق خالص کیفی برنامهٔ درسی است — قابل تست واحد در CI (بدون سرویس).
//
// مستند مرجع: docs/design/CURRICULUM-SCHEDULING-DESIGN-V1.md (بخش ۵ و ۶)
// ════════════════════════════════════════════════════════════════════════════

// ─────────────────────── چرخهٔ حیات نسخهٔ برنامه (State Machine) ───────────────────────

/** وضعیت‌های مجاز نسخهٔ برنامه درسی */
export const CURRICULUM_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] as const;
export type CurriculumVersionStatus = (typeof CURRICULUM_STATUSES)[number];

/**
 * ماشین حالت — تنها گذارهای مجاز (بخش ۵.۶ سند طراحی)
 *
 *   DRAFT ──submit──▶ REVIEW ──approve──▶ APPROVED ──publish──▶ PUBLISHED ──archive──▶ ARCHIVED
 *     ▲                 │
 *     └──── reject ─────┘
 *
 * قاعدهٔ طلایی: «نسخه هرگز Mutable نیست» — هر تغییرِ لازم پس از تأیید،
 * یک نسخهٔ جدید (createRevision → 1404-R1) است، نه UPDATE روی همان رکورد.
 * بنابراین گذار APPROVED/PUBLISHED → DRAFT عمداً در این جدول نیست.
 */
export const CURRICULUM_TRANSITIONS: Record<CurriculumVersionStatus, readonly CurriculumVersionStatus[]> = {
  DRAFT: ['REVIEW'],
  REVIEW: ['APPROVED', 'DRAFT'], // APPROVE یا REJECT (بازگشت به DRAFT = قابل ویرایش دوباره)
  APPROVED: ['PUBLISHED'],
  PUBLISHED: ['ARCHIVED'],
  ARCHIVED: [],
};

/** فقط در DRAFT ویرایش مجاز است (بخش ۵.۶ — قاعدهٔ ۱) */
export const EDITABLE_STATUSES: readonly CurriculumVersionStatus[] = ['DRAFT'];

export function canTransitionStatus(from: CurriculumVersionStatus, to: CurriculumVersionStatus): boolean {
  return CURRICULUM_TRANSITIONS[from]?.includes(to) ?? false;
}

/** گذار غیرمجاز → خطای صریح فارسی (fail-fast در لایهٔ Actions) */
export function assertTransition(from: CurriculumVersionStatus, to: CurriculumVersionStatus, action: string): void {
  if (!canTransitionStatus(from, to)) {
    throw new Error(
      `گذار غیرمجاز برنامهٔ درسی: «${action}» از وضعیت ${from} به ${to} ممکن نیست. ` +
        `گذارهای مجاز: ${CURRICULUM_TRANSITIONS[from].join('، ') || '—'}`
    );
  }
}

/** آیا این وضعیت قابل ویرایش است؟ (فقط DRAFT) */
export function canEditStatus(status: CurriculumVersionStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** مقصدهای ممکن یک وضعیت (برای رندر UI دکمه‌ها و Audit) */
export function transitionTargets(status: CurriculumVersionStatus): readonly CurriculumVersionStatus[] {
  return CURRICULUM_TRANSITIONS[status] ?? [];
}

// ─────────────────────────── نقش درس در نسخهٔ برنامه ───────────────────────────

/** نوع نقش هر درس در برنامه (جایگزینِ courseType آزادِ UI قدیم) */
export const COURSE_ROLE_TYPES = [
  'CORE',        // پایه
  'MAJOR',       // اصلی
  'SPECIALIZED', // تخصصی  ← در بانک دروس از «اصلی» جدا است
  'ELECTIVE',    // اختیاری
  'GENERAL',     // عمومی
  'THESIS',      // پایان‌نامه
  'INTERNSHIP',  // کارآموزی
  'WORKSHOP',    // کارگاه/مهارتی
  'COMPENSATORY',// جبرانی
] as const;
export type CourseRoleType = (typeof COURSE_ROLE_TYPES)[number];

/** مقادیر مجاز ruleType در course_rules (تکمیل: COREQ، بدون جدول جدید — تصمیم D2) */
export const COURSE_RULE_TYPES = [
  'PREREQ',          // پیش‌نیاز — موجود در enroll-engine
  'COREQ',           // هم‌نیاز — جدید (همان ساختار درخت)
  'UNIT_BOUNDARY',   // مرز واحد (مثلاً «حداقل ۶۰ واحد گذرانده») — جدید
  'EQUIV_OVERRIDE',  // هم‌ارزی اختصاصی نسخه — جدید
] as const;
export type CourseRuleType = (typeof COURSE_RULE_TYPES)[number];

// ─────────────────────────────── درخت منطقی قواعد ───────────────────────────────
// این ساختار همان ساختار JSON موجود در course_rules.logicTree است که
// evaluateLogicTree در enroll-engine.ts آن را می‌فهمد (بخش ۵.۴ سند).
// تایپ‌های اینجا «نسخهٔ متعارف» هستند؛ ارزیاب موجود بدون تغییر استفاده می‌شود.

/** شرط برگ: قبولی درس با حداقل نمره، یا حداقل واحد گذرانده، یا حداقل ترم */
export interface LogicCondition {
  course?: string;       // کد درس (مثلاً "RS30")
  minGrade?: number;     // کف نمره (مثلاً 12)
  unitsPassed?: number;  // حداقل واحد گذرانده (مثلاً 60) — «تعداد واحد گذرانده لازم» جدول دروس قدیم
  /**
   * حداقل ترمِ لازم برای اخذ (مثلاً ۷) — «ترم لازم» جدول دروس قدیم.
   * معنایش: دانشجو باید دست‌کم در ترم N (از نظر تعداد ترم گذرانده) باشد.
   */
  minSemester?: number;
  /** زیردرخت AND/OR (شرط مرکب تو در تو: A AND (B OR C)) */
  operator?: 'AND' | 'OR';
  conditions?: LogicCondition[];
}

export interface LogicNode {
  operator: 'AND' | 'OR';
  conditions: LogicCondition[];
}

/**
 * نرمال‌سازی و اعتبارسنجی ساختار درخت — هر رکورد legacy یا ورودی UI
 * باید از این گذر کند تا Validator و موتورها روی ساختار تضمین‌شده کار کنند.
 * خطا = throw (fail-fast؛ هرگز ساکت به «گذرنده» تبدیل نمی‌شود).
 */
export function normalizeLogicNode(raw: unknown): LogicNode {
  if (raw == null) return { operator: 'AND', conditions: [] };
  if (typeof raw !== 'object') {
    throw new Error(`ساختار قاعده باید یک درخت JSON باشد؛ دریافت شد: ${typeof raw}`);
  }
  const o = raw as { operator?: unknown; conditions?: unknown };
  const op = String(o.operator ?? 'AND').toUpperCase();
  if (op !== 'AND' && op !== 'OR') {
    throw new Error(`عملگر نامعتبر در درخت قاعده: «${String(o.operator)}» (فقط AND/OR مجاز است)`);
  }
  const arr = Array.isArray(o.conditions) ? o.conditions : [];
  const conditions: LogicCondition[] = arr.map((c) => {
    if (c == null || typeof c !== 'object') {
      throw new Error('هر شرط داخل درخت قاعده باید یک شیء باشد');
    }
    const cc = c as Record<string, unknown>;
    if ('operator' in cc) return normalizeLogicNode(cc) as LogicCondition; // زیردرخت
    const cond: LogicCondition = {};
    if (cc.course != null) cond.course = String(cc.course);
    if (cc.minGrade != null) cond.minGrade = Number(cc.minGrade);
    if (cc.unitsPassed != null) cond.unitsPassed = Number(cc.unitsPassed);
    if (cc.minSemester != null) cond.minSemester = Number(cc.minSemester);
    if (cond.course == null && cond.unitsPassed == null && cond.minSemester == null) {
      throw new Error('شرط قاعده باید شامل course یا unitsPassed یا minSemester باشد');
    }
    return cond;
  });
  return { operator: op as 'AND' | 'OR', conditions };
}

/**
 * همهٔ کدهای درسیِ برگِ درخت (پیمایش عمق‌نخست، شامل زیردرخت‌ها).
 * برای «کدام درس‌ها در قاعده ارجاع شده‌اند؟» استفاده می‌شود.
 */
export function collectCourseCodes(node: LogicNode | null | undefined, out: string[] = []): string[] {
  if (!node) return out;
  for (const c of node.conditions ?? []) {
    if (c.operator) collectCourseCodes(c as LogicNode, out);
    else if (c.course) out.push(c.course);
  }
  return out;
}

/**
 * مرتب‌سازی «طبیعی» کد درس: ارقام به‌صورت عددی مقایسه می‌شوند تا
 * ۹۹۹ قبل از ۱۱۰۰ بیاید (مرتب‌سازی رشته‌ای این را خراب می‌کند).
 * هم چارت ترمی و هم متنِ پیش‌نیاز/هم‌نیاز از همین تابع استفاده می‌کنند.
 */
export function compareCourseCode(a: string | null | undefined, b: string | null | undefined): number {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  const re = /(\d+)|(\D+)/g;
  const pa = sa.match(re) ?? [];
  const pb = sb.match(re) ?? [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else {
      const d = x.localeCompare(y, 'fa');
      if (d !== 0) return d;
    }
  }
  return pa.length - pb.length;
}

/** رقم فارسی برای متن‌های نمایشی این ماژول (بدون وابستگی به UI) */
const faDigits = (n: number | string | null | undefined): string =>
  String(n ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * درخت را به متن فارسیِ نمایشی تبدیل می‌کند (مثلاً برای Tooltip و گزارش).
 * با `sortByCode` شرط‌های درسی بر اساس **کد** مرتب می‌شوند (نه ترتیب ذخیره‌شده
 * و نه الفبای عنوان) و شرط‌های غیردرسی («۴۷ واحد پاس‌کرده»، «حداقل ترم ۷»)
 * در انتها می‌آیند — همان چیزی که در ستون «پیش‌نیاز / هم‌نیاز» دیده می‌شود.
 */
export function describeLogicNode(
  node: LogicNode,
  titles: (code: string) => string,
  opts: { sortByCode?: boolean } = {},
): string {
  const op = node.operator === 'OR' ? ' یا ' : ' و ';
  let conds = node.conditions ?? [];
  if (opts.sortByCode) {
    const courseConds = conds
      .filter((c) => !c.operator && c.course)
      .slice()
      .sort((a, b) => compareCourseCode(a.course, b.course));
    const otherConds = conds.filter((c) => c.operator || !c.course);
    conds = [...courseConds, ...otherConds];
  }
  const parts = conds.map((c) => {
    if (c.operator) return '(' + describeLogicNode(c as LogicNode, titles, opts) + ')';
    if (c.course) {
      const base = titles(c.course);
      return c.minGrade != null ? `${base} (نمرهٔ ≥ ${faDigits(c.minGrade)})` : base;
    }
    if (c.unitsPassed != null) return `${faDigits(c.unitsPassed)} واحد پاس‌کرده`;
    if (c.minSemester != null) return `حداقل ترم ${faDigits(c.minSemester)}`;
    return '';
  });
  return parts.filter(Boolean).join(op) || (node.operator === 'AND' ? '—' : '—');
}

// ─────────────────────────────── چرخهٔ تأیید (Audit) ───────────────────────────────

/** انواع رویدادهای append-only در curriculum_approvals */
export const CURRICULUM_APPROVAL_TYPES = [
  'DRAFT_SUBMIT',      // DRAFT → REVIEW
  'HEAD_APPROVE',      // تایید مدیر گروه  REVIEW → APPROVED
  'COUNCIL_APPROVE',   // تایید شورای گسترش (اختیاری، همان وضعیت APPROVED)
  'REJECT',            // بازگشت به DRAFT
  'PUBLISH',           // APPROVED → PUBLISHED
  'ARCHIVE',           // PUBLISHED → ARCHIVED
  'CREATE_REVISION',   // ساخت نسخهٔ جدید (مثلاً 1404-R1) از نسخهٔ تأییدشده
] as const;
export type CurriculumApprovalType = (typeof CURRICULUM_APPROVAL_TYPES)[number];

// ─────────────────────── خروجی Validation Engine (فاز ۴) ───────────────────────
// تعریف نوع‌ها همین‌جا (Phase 1) تا لایهٔ Actions و Client از همین قرارداد استفاده
// کنند؛ خودِ ارزیاب‌ها در فاز ۴ پیاده می‌شوند.

export type CheckSeverity = 'ERROR' | 'WARN';

export interface CheckResult {
  check: string;                 // مثلاً 'PREREQ_CYCLE_FREE'
  severity: CheckSeverity;       // ERROR = مانع تأیید · WARN = قابل تأیید با یادداشت
  message: string;               // متن فارسیِ ساخته‌شده از داده‌ها (نه ثابت UI)
  affected: (string | number)[]; // کد دروس / شماره ترم‌های مرتبط
}

// ─────────────────────────────── کدگذاری نسخه ───────────────────────────────

export interface ParsedVersionCode {
  base: string;     // «1404»
  revision: number; // 0 برای 1404 · 1 برای 1404-R1
}

/** «1404» → {base:'1404', revision:0} · «1404-R1» → {base:'1404', revision:1} */
export function parseVersionCode(code: string): ParsedVersionCode {
  const m = /^(.+)-R(\d+)$/.exec(code.trim());
  if (m) return { base: m[1], revision: parseInt(m[2], 10) };
  return { base: code.trim(), revision: 0 };
}

export function buildVersionCode(base: string, revision: number): string {
  const b = base.trim();
  if (!b) throw new Error('کد پایهٔ نسخه نمی‌تواند خالی باشد');
  if (!/^\d+$/.test(b)) throw new Error(`کد پایهٔ نسخه باید عددی باشد (مثلاً 1404): «${b}»`);
  return revision > 0 ? `${b}-R${revision}` : b;
}

/** «1404» → «1404-R1» · «1404-R1» → «1404-R2» */
export function nextRevisionCode(code: string): string {
  const { base, revision } = parseVersionCode(code);
  return buildVersionCode(base, revision + 1);
}

/** مقایسهٔ دو نسخه‌کد (نزولی به‌کار می‌رود: جدیدتر مقدم) */
export function compareVersionCodes(a: string, b: string): number {
  const pa = parseVersionCode(a);
  const pb = parseVersionCode(b);
  const numA = /^\d+$/.test(pa.base) ? parseInt(pa.base, 10) : null;
  const numB = /^\d+$/.test(pb.base) ? parseInt(pb.base, 10) : null;
  const baseCmp = numA != null && numB != null ? numA - numB : pa.base.localeCompare(pb.base, 'en');
  if (baseCmp !== 0) return baseCmp;
  return pa.revision - pb.revision;
}

// ─────────────────── موجودیت‌های Domain (آینهٔ جداول — بدون Drizzle) ───────────────────
// این تایپ‌ها صرفاً «شکل داده» هستند؛ کوئری‌های واقعی در لایهٔ Actions/DB نوشته
// می‌شوند. وجودشان کمک می‌کند Client و Validator وابستهٔ Drizzle نشوند.

export interface CurriculumTrack {
  id: number;
  majorId: number;
  title: string;        // «هوش مصنوعی و رباتیک»
  code: string | null;  // کد سازمانی گرایش
  isActive: number;     // 0/1
}

export interface CurriculumVersion {
  id: number;
  majorId: number;
  degreeLevelId: number;
  trackId: number | null;            // NULL = گرایش آزاد (برای همهٔ گرایش‌ها)
  versionCode: string;               // «1404» یا «1404-R1»
  title: string;                     // «برنامهٔ مهندسی نرم‌افزار ۱۴۰۴»
  status: CurriculumVersionStatus;
  entryYearFrom: number;
  entryYearTo: number | null;        // NULL = به بعد
  entryTermId: number | null;        // نیمسال ورودی مربوطه (NULL = همه نیمسال‌ها)
  effectiveFrom: string | null;      // تاریخ مصوبه (شمسی varchar)
  effectiveTo: string | null;
  totalRequiredUnits: number;        // سقف واحد لازم برای فارغ‌التحصیلی
  maxUnitsPerTerm: number | null;    // override سقف واحد ترم (NULL = از degree_level_configs)
  approvalId: number | null;         // آخرین رویداد تأیید (NULL تا DRAFT_SUBMIT)
  createdByStaffId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CurriculumCourse {
  id: number;
  curriculumVersionId: number;
  courseId: number;
  roleType: CourseRoleType;
  units: number | null;              // NULL = همان courses.units
  theoryUnits: number | null;
  practicalUnits: number | null;
  isRequired: number;                // 0/1
  isElective: number;                // 0/1
  isGraduationRequired: number;      // 0/1 — شرط الزامی فارغ‌التحصیلی
  recommendedSemester: number | null; // ۱..۸ + ۹=تابستان (NULL = آزاد/نامشخص)
  minGrade: number | null;           // کف قبولیِ خاص این درس در این نسخه
  autoCorequisiteAllowed: number;    // 0/1 — «هم‌نیاز خودکار در ترم آخر» (از آیین‌نامه)
}

export interface CurriculumApproval {
  id: number;
  curriculumVersionId: number;
  approvalType: CurriculumApprovalType;
  fromStatus: CurriculumVersionStatus | null;
  toStatus: CurriculumVersionStatus;
  approvedByStaffId: number;
  approvedByUserId: number;
  decisionNote: string | null;
  approvedAt: string;
  signatureDocumentId: number | null; // امضای الکترونیک (مکانیزم موجود پروژه)
}

/** آینهٔ course_rules — مقیّد به نسخه از طریق ستون syllabusId (= curriculum_versions.id)؛ نام ستون طبق تصمیم D2 حفظ شده */
export interface CurriculumCourseRule {
  id: number;
  courseId: number;
  curriculumVersionId: number | null; // NULL = قاعدهٔ سراسری درس
  ruleType: CourseRuleType;
  logicTree: LogicNode;               // نرمال‌شده با normalizeLogicNode
  customPassingGrade: number | null;
}
