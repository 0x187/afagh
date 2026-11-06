import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { course_offerings, course_rules, courses, degree_level_configs, enrollments, students } from '@/db/schema';
import { resolveStudentCurriculum } from '../curriculum-apply';
import { selectEffectiveRules } from '../curriculum-resolution';
import { expandPassedWithEquivalents } from './equivalence-expand';

// ═══ فیلتر ۴: ارزیابی درخت منطقی پیش‌نیاز (وفادار به فاز صفر — engines/enrollment.js) ═══
// ساختار: {"operator":"AND"|"OR","conditions":[{course:"code",minGrade:10}, ...]}
// برگ‌های غیردرسی هم پشتیبانی می‌شوند (از «جدول دروس» قدیم):
//   {unitsPassed: 47}  → دانشجو باید دست‌کم ۴۷ واحد پاس‌کرده باشد
//   {minSemester: 7}   → دانشجو باید دست‌کم در ترم ۷ باشد
type LogicCondition = {
  course?: string; minGrade?: number; unitsPassed?: number; minSemester?: number;
  operator?: string; conditions?: LogicCondition[];
};
type LogicNode = { operator?: string; conditions?: LogicCondition[] };

/** زمینهٔ ارزیابی برگ‌های غیردرسی (واحد پاس‌کرده و شمارهٔ ترمِ دانشجو) */
export type EvalContext = { unitsPassed?: number; semesterNo?: number };

export function evaluateLogicTree(
  node: LogicNode | null | undefined,
  passedMap: Map<string, number>,
  ctx: EvalContext = {},
): { ok: boolean; missing: string[] } {
  if (!node || typeof node !== 'object') return { ok: true, missing: [] };
  const results = (node.conditions || []).map(c => {
    if (c.course) {
      const grade = passedMap.get(c.course);
      const ok = grade !== undefined && (c.minGrade != null ? grade >= c.minGrade : true);
      return { ok, missing: ok ? [] : [c.course] };
    }
    if (c.operator) return evaluateLogicTree(c as LogicNode, passedMap, ctx);
    // برگ غیردرسی: واحد پاس‌کرده
    if (c.unitsPassed != null) {
      const ok = (ctx.unitsPassed ?? 0) >= Number(c.unitsPassed);
      return { ok, missing: ok ? [] : [`حداقل ${c.unitsPassed} واحد پاس‌کرده`] };
    }
    // برگ غیردرسی: حداقل ترم
    if (c.minSemester != null) {
      const ok = (ctx.semesterNo ?? 1) >= Number(c.minSemester);
      return { ok, missing: ok ? [] : [`حداقل ترم ${c.minSemester}`] };
    }
    return { ok: true, missing: [] };
  });
  const op = (node.operator || 'AND').toUpperCase();
  if (op === 'AND') return { ok: results.every(r => r.ok), missing: results.flatMap(r => r.missing) };
  return { ok: results.some(r => r.ok), missing: results.every(r => !r.ok) ? results.flatMap(r => r.missing) : [] };
}

export type PrereqContext = {
  passed: Map<string, number>;                                  // code → بهترین نمرهٔ قبولی
  ruleByCourse: Map<number, LogicNode>;                          // courseId → درخت PREREQ مؤثر
  titles: Map<string, string>;                                   // code → عنوان درس
  defaultPassing: number;
  /** جمع واحدهای دروس پاس‌شده (برای شرط «۴۷ واحد پاس‌کرده») */
  unitsPassed: number;
  /** شمارهٔ ترم جاری دانشجو (برای شرط «حداقل ترم ۷») */
  semesterNo: number;
};

/** نمرهٔ قبولی مؤثر: اورراید درس > پیش‌فرض مقطع (وفادار به regulations.js) */
function passingFor(courseId: number, overrides: Map<number, number>, defaultPassing: number) {
  return overrides.get(courseId) ?? defaultPassing;
}

/**
 * بافت پیش‌نیاز دانشجو:
 * ۱) نقشهٔ دروس پاس‌شده (FINALIZED و بالای نمرهٔ قبولی مؤثر؛ قائل‌شدن = نمرهٔ ۱)
 * ۲) قاعدهٔ PREREQ مؤثر هر درس — قاعدهٔ سیلابسیِ منطبق بر رشته/ورودی دانشجو بر قاعدهٔ عمومی مقدم است
 */
export async function buildPrereqContext(studentId: number): Promise<PrereqContext> {
  const [stu] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  const [deg] = stu
    ? await db.select().from(degree_level_configs).where(eq(degree_level_configs.id, stu.degreeLevelId)).limit(1)
    : [];
  const defaultPassing = Number(deg?.defaultPassingGrade ?? 10);

  const allRules = await db.select().from(course_rules);

  // اورراید نمرهٔ قبولی هر درس (اولین قاعدهٔ دارای customPassingGrade)
  const overrides = new Map<number, number>();
  for (const r of allRules) if (r.customPassingGrade != null && !overrides.has(r.courseId)) overrides.set(r.courseId, Number(r.customPassingGrade));

  // ── فاز ۵: نسخهٔ مؤثر = نتیجهٔ Resolution (فقط PUBLISHED/ARCHIVED) ──
  // پیش از این، هر قاعدهٔ مقیّد به هر نسخهٔ دارای «پنجرهٔ ورودی منطبق» اعمال
  // می‌شد (حتی نسخهٔ DRAFT!)؛ اکنون دقیقاً یک نسخهٔ حل‌شده مبنای قواعد است.
  const { version: resolved } = await resolveStudentCurriculum(studentId);
  const resolvedVersionId = resolved?.id ?? null;

  // قاعدهٔ مؤثر: قاعدهٔ مقیّد به «نسخهٔ حل‌شدهٔ دانشجو» مقدم بر عمومی
  const { global: globalRules, scoped: scopedRules } = selectEffectiveRules(
    allRules, resolvedVersionId, ['PREREQ']
  );
  const globalRule = new Map<number, LogicNode>();
  const scopedRule = new Map<number, LogicNode>();
  for (const r of globalRules) {
    if (!globalRule.has(r.courseId)) globalRule.set(r.courseId, JSON.parse(r.logicTree) as LogicNode);
  }
  for (const r of scopedRules) {
    if (!scopedRule.has(r.courseId)) scopedRule.set(r.courseId, JSON.parse(r.logicTree) as LogicNode);
  }
  const ruleByCourse = new Map<number, LogicNode>([...globalRule, ...scopedRule]); // scoped بازنویسی می‌کند

  // دروس پاس‌شده
  const rows = await db
    .select({ code: courses.code, courseId: courses.id, grade: enrollments.gradeValue, status: enrollments.gradeStatus, gradingType: courses.gradingType, units: courses.units })
    .from(enrollments)
    .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(eq(enrollments.studentId, studentId));
  const passed = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== 'FINALIZED' || r.grade == null) continue;
    const g = Number(r.grade);
    const ok = r.gradingType === 'DESCRIPTIVE' ? g === 1 : g >= passingFor(r.courseId, overrides, defaultPassing);
    if (ok && (!passed.has(r.code) || (passed.get(r.code) as number) < g)) passed.set(r.code, g);
  }

  // جمع واحدهای پاس‌شده — پیش از گسترش هم‌ارزی‌ها محاسبه می‌شود تا واحدِ هم‌ارز
  // دوباره شمرده نشود (هر درس فقط یک بار در جمع می‌آید).
  const unitsOf = new Map<string, number>();
  for (const r of rows) if (!unitsOf.has(r.code)) unitsOf.set(r.code, Number(r.units) || 0);
  let unitsPassed = 0;
  for (const code of passed.keys()) unitsPassed += unitsOf.get(code) ?? 0;

  const courseRows = await db.select({ code: courses.code, title: courses.title, clusterId: courses.clusterId }).from(courses);
  const titles = new Map(courseRows.map(c => [c.code, c.title]));
  const members = courseRows
    .filter(c => c.clusterId != null)
    .map(c => ({ clusterCode: Number(c.clusterId), code: c.code }));
  return {
    passed: expandPassedWithEquivalents(passed, members),
    ruleByCourse,
    titles,
    defaultPassing,
    unitsPassed,
    semesterNo: Number(stu?.currentTermNo ?? 1) || 1,
  };
}

/** برچسب خوانأ پیش‌نیاز برای UI: «برنامه‌نویسی پیشرفته و ریاضی عمومی ۱» */
export function formatPrereq(node: LogicNode | undefined, titles: Map<string, string>): string | null {
  if (!node || !node.conditions || node.conditions.length === 0) return null;
  const joiner = (node.operator || 'AND').toUpperCase() === 'OR' ? ' یا ' : ' و ';
  const parts = node.conditions.map(c => {
    if (c.course) return titles.get(c.course) ?? c.course;
    if (c.operator) return '(' + formatPrereq(c as LogicNode, titles) + ')';
    if (c.unitsPassed != null) return `گذراندن ${c.unitsPassed} واحد`;
    if (c.minSemester != null) return `حداقل ترم ${c.minSemester}`;
    return '';
  }).filter(Boolean);
  return parts.length ? parts.join(joiner) : null;
}
