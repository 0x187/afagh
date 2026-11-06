// ════════════════════════════════════════════════════════════════════════
// فاز ۳ — هستهٔ اعتبارسنجی برنامهٔ درسی (Pure — بدون DB، قابل تست در CI)
// ────────────────────────────────────────────────────────────────────────
// این ماژول «گیت واقعی» تأیید است (پاسخ به بند ۶ بازبینی: هیچ ✓ ثابتی در UI؛
// خروجی، نتیجهٔ محاسبه از داده‌هاست). چک‌های زیر از همان ابتدا در
// submitForApproval اجرا می‌شوند؛ چک‌های تکمیلی فاز ۴ (SEMESTER_LOAD،
// COURSE_TYPES_COMPLETE، TRACK_INTEGRITY، EQUIVALENCY_DISJOINT) به همین
// ساختار اضافه خواهند شد — قرارداد CheckResult همین است.
// ════════════════════════════════════════════════════════════════════════

import type { CheckResult, LogicNode } from './curriculum-types';
import { SUMMER_SEMESTER } from './term-plan';

/** ورودی خالص ارزیابی — Actions داده را از DB بارگیری و پاس می‌دهند */
export interface CurriculumCheckInput {
  totalRequiredUnits: number;
  /** سقف واحد هر ترم (override نسخه یا مقطع) — null/تعریف‌نشده = بدون سقف (چک SEMESTER_LOAD رد می‌شود) */
  maxUnitsPerTerm?: number | null;
  /** گرایشِ نسخه — برای چک یکپارچگی گرایش (null = گرایش آزاد) */
  trackId?: number | null;
  /** کد نسخه — فقط برای پیام‌های خوانا */
  versionCode?: string;
  /** حداقل تعداد مقرر از هر نقش (خالی = چک ترکیب نقش‌ها اجرا نمی‌شود) */
  minRoleCounts?: Partial<Record<string, number>>;
  /**
   * سهم واحد مقرر هر نقش در این نسخه، مثل {GENERAL: 22, CORE: 25} (خالی/تعریف‌نشده = چک سهم واحد اجرا نمی‌شود).
   * جمع سهم‌ها معمولاً باید با totalRequiredUnits بخواند؛ خود جمع اجباری نیست، فقط هر سهم جداگانه کنترل می‌شود.
   */
  minRoleUnits?: Partial<Record<string, number>>;
  /** دروسِ نسخه به‌همراه مشخصات بانک (units: واحد مؤثر — override نسخه یا درس) */
  courses: {
    courseId: number;
    code: string;
    title: string;
    units: number;
    roleType: string;
    isRequired: number;
    isElective: number;
    isGraduationRequired: number;
    recommendedSemester: number | null;
    autoCorequisiteAllowed: number;
    clusterId: number | null; // خوشهٔ هم‌ارزی (NULL = درس مستقل)
    passGradeStatusCode?: string | null; // کد وضع نمرهٔ قبولی (12 = جبرانی)
    /** کدهای هم‌ارز بانک (کاما) — برای «خارج از نسخه» نساختنِ کدِ دارای هم‌ارز */
    equivalentCourseCodes?: string | null;
    /** نوع درس بانک («تخصصی»، «عمومی»، …) */
    courseType?: string | null;
  }[];
  /** قواعدِ مقیّد به همین نسخه (course_rules.syllabusId = نسخه) */
  rules: {
    courseId: number;
    ruleType: string;
    logicTree: LogicNode;
  }[];
  /** کدهای موجود در بانک دروس (courses.code) */
  existingCodes: Set<string>;
}

/**
 * پارس امن سهم واحد نقش‌ها (ستون minRoleUnits نسخه: رشتهٔ JSON یا آبجکت).
 * کلیدها بزرگ و فقط حروف/زیرخط‌خط؛ مقادیر عدد متناهی ≥ ۰. ورودی نامعتبر → {}.
 * هم سرور (buildCheckInput) و هم کلاینت (فرم سهم‌ها) از همین تابع استفاده می‌کنند.
 */
export function parseRoleUnitTargets(raw: unknown): Record<string, number> {
  try {
    const obj = typeof raw === 'string' ? (raw.trim() ? JSON.parse(raw) : null) : raw;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = String(k).trim().toUpperCase();
      const n = Number(v);
      if (/^[A-Z_]{2,20}$/.test(key) && Number.isFinite(n) && n >= 0) out[key] = n;
    }
    return out;
  } catch {
    return {};
  }
}

const err = (check: string, message: string, affected: (string | number)[] = []): CheckResult => ({
  check, severity: 'ERROR', message, affected,
});
const warn = (check: string, message: string, affected: (string | number)[] = []): CheckResult => ({
  check, severity: 'WARN', message, affected,
});

/**
 * حداقل تعداد مقرر از هر نقش.
 *
 * ⚠️ دیگر «حداقل ثابت» تعیین نمی‌کنیم: چارت هر رشته ترکیب خودش را دارد و
 * تحمیل «حتماً یک درس اصلی» روی چارتی که مثلاً همهٔ دروسش پایه/تخصصی است،
 * هشدار کاذب می‌سازد. حدِ انتظار فقط از روی «سهم واحد»ی که خودِ نسخه اعلام
 * کرده ساخته می‌شود (پایین‌تر در validateCurriculumCore).
 */
export function defaultMinRoles(_opts: { isGraduate?: boolean | null } = {}): Record<string, number> {
  return {};
}

/** کدهای هم‌ارز یک ردیف درس (کاما/فاصله/لوله) */
function equivList(c: { equivalentCourseCodes?: string | null }): string[] {
  return String(c.equivalentCourseCodes ?? '')
    .split(/[,،|\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
}

/**
 * آیا این کدِ «خارج از نسخه» درس هم‌ارزی در نسخه دارد؟
 * اگر بله، «خارج از نسخه» خطا نیست — باید با پیام هم‌ارزی هشدار داده شود.
 */
export function equivalentInVersion(
  code: string,
  courses: { code: string; equivalentCourseCodes?: string | null }[],
): string | null {
  const target = String(code ?? '').trim().toUpperCase();
  if (!target) return null;
  for (const c of courses) {
    if (equivList(c).includes(target)) return c.code;
  }
  return null;
}

/** برگ‌های درخت (course و unitsPassed) — پیمایش عمق‌نخست */
function leafCourseCodes(node: LogicNode | null | undefined, out: string[] = []): string[] {
  if (!node) return out;
  for (const c of node.conditions ?? []) {
    if (c.operator) leafCourseCodes(c as LogicNode, out);
    else if (c.course) out.push(c.course);
  }
  return out;
}

/** لبه‌های گراف پیش‌نیاز: پیش‌نیاز → درسِ وابسته (بر اساس کد درس) */
function prereqEdges(input: CurriculumCheckInput): { prereq: string; dependent: string }[] {
  const byCourseId = new Map(input.courses.map((c) => [c.courseId, c.code]));
  const edges: { prereq: string; dependent: string }[] = [];
  for (const r of input.rules) {
    if (r.ruleType !== 'PREREQ') continue;
    const dependent = byCourseId.get(r.courseId);
    if (!dependent) continue; // قاعدهٔ درسِ خارج از نسخه — توسط چک ۲ رصد می‌شود
    for (const prereq of leafCourseCodes(r.logicTree)) edges.push({ prereq, dependent });
  }
  return edges;
}

/** تشخیص دور در گراف جهت‌دار (DFS با سه‌رنگ) — خالص و امن برای درخت‌های عمیق */
function hasCycle(nodes: Set<string>, edges: { prereq: string; dependent: string }[]): string | null {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.prereq)) adj.set(e.prereq, []);
    adj.get(e.prereq)!.push(e.dependent);
  }
  const color = new Map<string, 0 | 1 | 2>();
  const cycle: string[] = [];
  const dfs = (u: string): boolean => {
    color.set(u, 1);
    for (const v of adj.get(u) ?? []) {
      if (!nodes.has(v)) continue;
      const c = color.get(v) ?? 0;
      if (c === 1) { cycle.push(u, v); return true; }
      if (c === 0 && dfs(v)) { cycle.push(u); return true; }
    }
    color.set(u, 2);
    return false;
  };
  for (const n of nodes) {
    if ((color.get(n) ?? 0) === 0 && dfs(n)) return [...new Set(cycle)].join(' ← ');
  }
  return null;
}

/**
 * ارزیابی هستهٔ برنامهٔ درسی — خروجی همیشه آرایه‌است (خالی = بدون یافته).
 * ERROR = مانع تأیید · WARN = قابل تأیید با یادداشت.
 */
export function validateCurriculumCore(input: CurriculumCheckInput): CheckResult[] {
  const results: CheckResult[] = [];

  // ── ۱) پوشش واحد الزامی: نسخه باید دست‌کم به‌اندازهٔ کل واحد لازم، درس
  // ارائه دهد (الزامی + مخزن اختیاری)، و دست‌کم یک درس الزامی داشته باشد.
  // (مقایسهٔ قبلی فقط دروس اصلی/تخصصی را می‌شمرد و برای برنامه‌های دارای
  // دروس پایه/عمومی/اختیاری همیشه خطای کاذب می‌داد.)
  const requiredSum = input.courses
    .filter((c) => c.isRequired === 1)
    .reduce((s, c) => s + c.units, 0);
  const offeredSum = input.courses.reduce((s, c) => s + c.units, 0);
  if (requiredSum === 0 || offeredSum < input.totalRequiredUnits) {
    results.push(err(
      'UNITS_COVER_MIN',
      requiredSum === 0
        ? `هیچ درس الزامی‌ای در نسخه تعریف نشده است (کل واحدهای لازم برنامه: ${input.totalRequiredUnits}).`
        : `مجموع واحدهای ارائه‌شده در نسخه (${offeredSum}) از کل واحدهای لازم برنامه (${input.totalRequiredUnits}) کمتر است.`,
      input.courses.filter((c) => c.isRequired === 1).map((c) => c.code)
    ));
  }

  // ── ۲) اعتبار ارجاع پیش‌نیازها: هر کد داخل درخت باید در بانک دروس تعریف شده باشد ──
  const unknownRefs = new Set<string>();
  for (const r of input.rules) {
    if (r.ruleType !== 'PREREQ' && r.ruleType !== 'COREQ') continue;
    for (const code of leafCourseCodes(r.logicTree)) {
      if (!input.existingCodes.has(code)) unknownRefs.add(code);
    }
  }
  if (unknownRefs.size > 0) {
    results.push(err(
      'PREREQ_REFERENCES_VALID',
      `کدهای درسیِ ناموجود در بانک دروس: ${[...unknownRefs].join('، ')}`,
      [...unknownRefs]
    ));
  }

  // ── ۳) آزادی از دور: گراف پیش‌نیازها نباید حلقهٔ دورانی داشته باشد ──
  const edges = prereqEdges(input);
  const cycle = hasCycle(new Set(input.courses.map((c) => c.code)), edges);
  if (cycle) {
    results.push(err(
      'PREREQ_CYCLE_FREE',
      `حلقهٔ دورانی در گراف پیش‌نیازها یافت شد: ${cycle}`,
      cycle.split(' ← ')
    ));
  }

  // ── ۴) ترتیب ترمی پیش‌نیازها: پیش‌نیاز باید در ترمی زودتر از درس باشد (هم‌ترم هم غلط است) ──
  const semOf = new Map(input.courses.map((c) => [c.code, c.recommendedSemester]));
  const semIssues: string[] = [];
  for (const e of edges) {
    const ps = semOf.get(e.prereq);
    const ds = semOf.get(e.dependent);
    // ترم ۱ توسط چک ۱۳ (PREREQ_FIRST_TERM) به‌عنوان خطای مسدودکننده گزارش می‌شود
    if (ps != null && ds != null && ds > 1 && ps >= ds) semIssues.push(`${e.prereq}(${ps})→${e.dependent}(${ds})`);
  }
  if (semIssues.length > 0) {
    results.push(warn(
      'PREREQ_SEMESTER_ORDER',
      `پیش‌نیازهایی که در ترمی دیرتر یا هم‌ترم با درس وابسته چیده شده‌اند: ${semIssues.join('، ')}`,
      semIssues
    ));
  }

  // ── ۱۳) درس دارای پیش‌نیاز نباید در اولین ترم (ترم ۱) باشد: ترم ۰ وجود ندارد ──
  // پیش‌نیاز باید در ترمی زودتر گذرانده شود؛ بنابرین کم‌ترین ترمِ درسِ وابسته، ۲ است.
  const firstTermIssues: string[] = [];
  for (const r of input.rules) {
    if (r.ruleType !== 'PREREQ') continue;
    const dep = input.courses.find((c) => c.courseId === r.courseId);
    if (!dep || dep.recommendedSemester == null) continue;
    const leaves = leafCourseCodes(r.logicTree);
    if (leaves.length === 0) continue;
    if ((dep.recommendedSemester as number) <= 1) {
      firstTermIssues.push(`${dep.code} (ترم ${dep.recommendedSemester})`);
    }
  }
  if (firstTermIssues.length > 0) {
    results.push(err(
      'PREREQ_FIRST_TERM',
      `دروس دارای پیش‌نیاز نمی‌توانند در اولین ترم (ترم ۱) قرار گیرند، زیرا امکان گذراندن پیش‌نیاز در ترم ۰ (که وجود ندارد) وجود ندارد: ${firstTermIssues.join('، ')} — پیش‌نیاز باید در ترمی زودتر گذرانده شود.`,
      firstTermIssues
    ));
  }

  // ── ۵) هم‌نیازها: در همین نسخه تعریف و هم‌ترم یا در ترمی زودتر باشند (یا هم‌نیاز خودکار مجاز) ──
  const codesInVersion = new Set(input.courses.map((c) => c.code));
  const coreqIssues: string[] = [];
  const coreqEquiv: string[] = [];
  for (const r of input.rules) {
    if (r.ruleType !== 'COREQ') continue;
    const dep = input.courses.find((c) => c.courseId === r.courseId);
    for (const code of leafCourseCodes(r.logicTree)) {
      if (!codesInVersion.has(code)) {
        // اگر هم‌ارزش در همین چارت هست، «خارج از نسخه» گفتن گمراه‌کننده است:
        // دانشجو با گذراندن درس هم‌ارز، شرط را برآورده می‌کند.
        const eq = equivalentInVersion(code, input.courses);
        if (eq) coreqEquiv.push(`${code} ⇄ ${eq}`);
        else coreqIssues.push(`${code} (خارج از نسخه)`);
        continue;
      }
      const coreq = input.courses.find((c) => c.code === code);
      const autoOk = dep?.autoCorequisiteAllowed === 1;
      if (!autoOk && coreq && dep && coreq.recommendedSemester != null && dep.recommendedSemester != null
        && coreq.recommendedSemester > dep.recommendedSemester) {
        coreqIssues.push(`${code} (ترم ${coreq.recommendedSemester} > ${dep.recommendedSemester})`);
      }
    }
  }
  if (coreqIssues.length > 0) {
    results.push(warn(
      'COREQ_PRESENT',
      `هم‌نیازهایی که باید هم‌ترم یا در ترمی زودتر باشند و در نسخه تعریف شوند: ${coreqIssues.join('، ')}`,
      coreqIssues
    ));
  }
  if (coreqEquiv.length > 0) {
    results.push(warn(
      'COREQ_EQUIVALENT',
      `هم‌نیازهایی که کدشان در این چارت نیست، ولی درس هم‌ارزشان ارائه شده است (با گذراندن هم‌ارز، شرط برآورده می‌شود): ${coreqEquiv.join('، ')}`,
      coreqEquiv
    ));
  }

  // ── ۵ب) پیش‌نیازِ بیرون از چارت: با هم‌ارزی بسنج، بعد هشدار بده ──
  // (پیش از این، پیش‌نیازی که کدش در چارت نبود کاملاً بی‌صدا رد می‌شد؛ حالا یا
  // «از طریق هم‌ارزی پوشش داده می‌شود» گزارش می‌شود یا «بدون هم‌ارز» — دومی
  // یعنی دانشجو هرگز نمی‌تواند آن پیش‌نیاز را در این چارت بگذراند.)
  const prereqEquiv: string[] = [];
  const prereqOutside: string[] = [];
  for (const r of input.rules) {
    if (r.ruleType !== 'PREREQ') continue;
    const dep = input.courses.find((c) => c.courseId === r.courseId);
    if (!dep) continue;
    for (const code of leafCourseCodes(r.logicTree)) {
      if (codesInVersion.has(code)) continue;
      const eq = equivalentInVersion(code, input.courses);
      if (eq) prereqEquiv.push(`${code} ⇄ ${eq} (برای ${dep.code})`);
      else prereqOutside.push(`${code} → ${dep.code}`);
    }
  }
  const capList = (arr: string[]) =>
    arr.length <= 12 ? arr.join('، ') : `${arr.slice(0, 12).join('، ')} و ${arr.length - 12} مورد دیگر`;
  if (prereqEquiv.length > 0) {
    results.push(warn(
      'PREREQ_EQUIVALENT',
      `پیش‌نیازهایی که کدشان در چارت نیست، ولی درس هم‌ارزشان در همین چارت ارائه شده است: ${capList(prereqEquiv)}`,
      prereqEquiv.slice(0, 40)
    ));
  }
  if (prereqOutside.length > 0) {
    results.push(warn(
      'PREREQ_OUTSIDE_VERSION',
      `پیش‌نیازهایی که نه خودشان و نه هم‌ارزشان در این چارت نیست — دانشجو نمی‌تواند آن‌ها را در این برنامه بگذراند: ${capList(prereqOutside)}`,
      prereqOutside.slice(0, 40)
    ));
  }

  // ── ۶) پوشش فارغ‌التحصیلی: حداقل یک درس الزامیِ فارغ‌التحصیلی علامت‌خورده ──
  const gradRequired = input.courses.filter((c) => c.isGraduationRequired === 1);
  if (gradRequired.length === 0) {
    results.push(err(
      'GRADUATION_COVERAGE',
      'هیچ درسی به‌عنوان «شرط الزامی فارغ‌التحصیلی» علامت‌گذاری نشده است؛ بدون آن تطبیق سرفصل در فارغ‌التحصیلی ممکن نیست.',
      input.courses.filter((c) => ['CORE', 'MAJOR', 'SPECIALIZED', 'THESIS', 'INTERNSHIP'].includes(c.roleType)).slice(0, 10).map((c) => c.code)
    ));
  }

  // ── ۷) بار ترم: مجموع واحد هر ترم نباید از سقف مجاز بگذرد ──
  if (input.maxUnitsPerTerm != null) {
    const bySemester = new Map<number, { units: number; codes: string[] }>();
    for (const c of input.courses) {
      if (c.recommendedSemester == null) continue;
      const cur = bySemester.get(c.recommendedSemester) ?? { units: 0, codes: [] };
      cur.units += c.units;
      cur.codes.push(c.code);
      bySemester.set(c.recommendedSemester, cur);
    }
    for (const [sem, info] of [...bySemester.entries()].sort((a, b) => a[0] - b[0])) {
      if (info.units > input.maxUnitsPerTerm) {
        const semLabel = sem === SUMMER_SEMESTER ? 'تابستان' : sem;
        results.push(warn(
          'SEMESTER_LOAD',
          `بار ترم ${semLabel} (${info.units} واحد) از سقف مجاز (${input.maxUnitsPerTerm} واحد) بیشتر است.`,
          info.codes
        ));
      }
    }
  }

  // ── ۸) ترکیب نقش‌ها: شمارش از روی دروسِ همین چارت ──
  // انتظار را از خودِ نسخه می‌گیریم: هر نقشی که «سهم واحد» اعلام کرده باید
  // دست‌کم یک درس در چارت داشته باشد؛ هیچ حداقلِ ثابتی تحمیل نمی‌شود.
  {
    const countByRole = new Map<string, number>();
    for (const c of input.courses) {
      countByRole.set(c.roleType, (countByRole.get(c.roleType) ?? 0) + 1);
    }
    const roleFa: Record<string, string> = {
      CORE: 'پایه', MAJOR: 'اصلی', SPECIALIZED: 'تخصصی', ELECTIVE: 'اختیاری', GENERAL: 'عمومی',
      THESIS: 'پایان‌نامه', INTERNSHIP: 'کارآموزی', WORKSHOP: 'کارگاه',
      COMPENSATORY: 'جبرانی',
    };
    const declaredRoles = new Set<string>();
    for (const [role, v] of Object.entries(input.minRoleUnits ?? {})) {
      if ((v ?? 0) > 0) declaredRoles.add(role);
    }
    for (const [role, v] of Object.entries(input.minRoleCounts ?? {})) {
      if ((v ?? 0) > 0) declaredRoles.add(role);
    }
    for (const role of declaredRoles) {
      const count = countByRole.get(role) ?? 0;
      const min = input.minRoleCounts?.[role] ?? 1;
      if (count < min) {
        const summary = [...countByRole.entries()]
          .filter(([, n]) => n > 0)
          .map(([r, n]) => `${roleFa[r] ?? r}: ${n}`)
          .join('، ') || 'هیچ درسی ثبت نشده';
        results.push(warn(
          'COURSE_TYPES_COMPLETE',
          `نقش «${roleFa[role] ?? role}» در این چارت ${count} درس دارد ولی سهم واحد برایش تعیین شده است. شمارش از روی دروس همین چارت — ${summary}.`,
          input.courses.filter((c) => c.roleType === role).map((c) => c.code)
        ));
      }
    }
  }

  // ── ۸ب) سهم واحد نقش‌ها: هر سهم مقرر نسخه باید با واحد تأمین‌شده پوشش داده شود ──
  if (input.minRoleUnits && Object.keys(input.minRoleUnits).length > 0) {
    const unitsByRole = new Map<string, number>();
    for (const c of input.courses) {
      unitsByRole.set(c.roleType, (unitsByRole.get(c.roleType) ?? 0) + (Number(c.units) || 0));
    }
    const roleFa: Record<string, string> = {
      CORE: 'پایه', MAJOR: 'اصلی', SPECIALIZED: 'تخصصی', ELECTIVE: 'اختیاری', GENERAL: 'عمومی',
      THESIS: 'پایان‌نامه', INTERNSHIP: 'کارآموزی', WORKSHOP: 'کارگاه',
      COMPENSATORY: 'جبرانی',
    };
    for (const [role, min] of Object.entries(input.minRoleUnits)) {
      const have = unitsByRole.get(role) ?? 0;
      if (have < (min ?? 0)) {
        results.push(warn(
          'ROLE_UNITS_COVERAGE',
          `سهم واحد نقش «${roleFa[role] ?? role}»: فقط ${have} واحد تأمین شده؛ مقرر ${min} واحد است.`,
          input.courses.filter((c) => c.roleType === role).map((c) => c.code)
        ));
      }
    }
  }

  // ── ۹) یکپارچگی گرایش: نسخهٔ گرایش‌دار باید دست‌کم یک درس انتخابیِ متمایز داشته باشد ──
  if (input.trackId != null) {
    const electives = input.courses.filter((c) => c.roleType === 'ELECTIVE');
    if (electives.length === 0) {
      results.push(warn(
        'TRACK_INTEGRITY',
        `نسخهٔ گرایشی (${input.trackId}) هیچ درس انتخابی متمایزی ندارد؛ در عمل با نسخهٔ گرایش آزاد یکسان است.`,
        []
      ));
    }
  }

  // ── ۱۰) تفکیک هم‌ارزها: دو درس هم‌ارز (یک خوشه) نباید هم‌زمان در یک نسخه باشند ──
  const byCluster = new Map<number, { code: string; title: string }[]>();
  for (const c of input.courses) {
    if (c.clusterId == null) continue;
    const cur = byCluster.get(c.clusterId) ?? [];
    cur.push({ code: c.code, title: c.title });
    byCluster.set(c.clusterId, cur);
  }
  for (const [clusterId, members] of byCluster) {
    if (members.length > 1) {
      results.push(warn(
        'EQUIVALENCY_DISJOINT',
        `دروس هم‌ارز «${members.map((m) => m.title).join('» و «')}» (خوشهٔ ${clusterId}) هر دو در این نسخه‌اند؛ گذراندن یکی باید دیگری را پوشش دهد وگرنه واحدها دوبار شمرده می‌شوند.`,
        members.map((m) => m.code)
      ));
    }
  }

  // ── ۱۱) دروس بدون ترم مصوب: تخصیص ترمی برای چیدمان درسی الزامی است ──
  const unassigned = input.courses.filter((c) => c.recommendedSemester == null);
  if (unassigned.length > 0) {
    results.push(warn(
      'SEMESTER_UNASSIGNED',
      `${unassigned.length} درس بدون ترم مصوب‌اند: ${unassigned.map((c) => c.code).join('، ')} — پیش از چیدمان ترمی تعیین شوند.`,
      unassigned.map((c) => c.code)
    ));
  }

  // ── ۱۲) درس جبرانی (کد قبولی ۱۲) فقط در ترم ۱ یا حداکثر ترم ۲ ──
  const compensatoryLate = input.courses.filter((c) =>
    c.passGradeStatusCode === '12' && c.recommendedSemester != null && c.recommendedSemester > 2
  );
  if (compensatoryLate.length > 0) {
    results.push(err(
      'COMPENSATORY_TERM_LIMIT',
      `دروس جبرانی فقط در ترم ۱ (و در صورت ضرورت ترم ۲) قابل ارائه‌اند: ${compensatoryLate.map((c) => c.code).join('، ')} در ترم ${compensatoryLate.map((c) => c.recommendedSemester).join('، ')} قرار گرفته‌اند.`,
      compensatoryLate.map((c) => c.code)
    ));
  }

  return results;
}

/** آیا مجموعهٔ نتایج، مانعی برای تأیید دارد؟ */
export function hasBlockingErrors(results: CheckResult[]): boolean {
  return results.some((r) => r.severity === 'ERROR');
}
