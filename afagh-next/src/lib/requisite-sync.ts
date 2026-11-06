import 'server-only';

// ════════════════════════════════════════════════════════════════════════
//  همگام‌سازی «پیش‌نیاز / هم‌نیاز» از **جدول دروس** به `course_rules`.
//
//  چرا این ماژول لازم است؟
//  منبعِ اصلی این قواعد در سامانهٔ قدیمی، خودِ «جدول دروس» بود؛ ولی در
//  سامانهٔ جدید قواعد به **نسخهٔ برنامهٔ درسی** مقیّدند (`course_rules.syllabusId`).
//  پس دادهٔ سراسریِ درس باید برای هر نسخه‌ای که آن درس را در چارت دارد
//  «مادی‌سازی» شود. این ماژول همان پل است:
//
//    courses.prereqText / courses.coRequisites   ──►   course_rules
//                    (سراسری)                            (به‌ازای هر نسخه)
//
//  قواعدِ دستیِ کاربر هرگز بازنویسی نمی‌شوند (`overwrite` پیش‌فرض false)؛
//  فقط جای خالی پر می‌شود — همان سیاست «پر کردن جاهای خالی» در مهاجرت.
// ════════════════════════════════════════════════════════════════════════

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { course_rules, courses, curriculum_courses } from '@/db/schema';
import { parseRequisiteText, type ParsedLogic } from './prereq-text';

export type SyncStats = {
  /** نسخه‌هایی که بررسی شدند */
  versions: number;
  /** درس‌های بانک که متن پیش‌نیاز/هم‌نیاز داشتند */
  coursesWithPrereq: number;
  coursesWithCoreq: number;
  /** قاعده‌های تازه‌ساخته */
  prereqRules: number;
  coreqRules: number;
  /** قاعده‌هایی که از قبل بود (دست نخورد) */
  skippedExisting: number;
  /** کدهایی که در بانک دروس نیستند و در نتیجه قاعده‌شان ساخته نشد */
  unresolvedCodes: string[];
  /** کد نسخه‌های به‌روزشده — برای پیام UI */
  versionCodes: string[];
};

const emptyStats = (): SyncStats => ({
  versions: 0, coursesWithPrereq: 0, coursesWithCoreq: 0,
  prereqRules: 0, coreqRules: 0, skippedExisting: 0,
  unresolvedCodes: [], versionCodes: [],
});

/** کلید مقایسهٔ کد درس (حساس به حروف کوچک/بزرگ و فاصله نباشد) */
const codeKey = (c: unknown): string => String(c ?? '').trim().toUpperCase();

/**
 * درخت قاعده را به کدهای موجود در بانک محدود می‌کند.
 * کدِ ناشناخته حذف می‌شود (نه اینکه قاعدهٔ معیوب ساخته شود) و در
 * `unresolved` گزارش می‌شود تا کاربر بداند چه چیزی جا افتاد.
 */
function keepKnownCodes(tree: ParsedLogic, known: Set<string>, unresolved: Set<string>): ParsedLogic | null {
  const conditions: ParsedLogic['conditions'] = [];
  for (const cond of tree.conditions) {
    if ('operator' in cond) {
      const sub = keepKnownCodes(cond as ParsedLogic, known, unresolved);
      if (sub) conditions.push(sub);
      continue;
    }
    const code = codeKey((cond as { course: string }).course);
    if (known.has(code)) conditions.push({ course: code });
    else unresolved.add(code);
  }
  if (conditions.length === 0) return null;
  return { operator: tree.operator, conditions };
}

/**
 * قواعد پیش‌نیاز/هم‌نیاز را از جدول دروس می‌خواند و در `course_rules`
 * نسخه(های) هدف ثبت می‌کند.
 *
 * @param versionId اگر داده شود فقط همان نسخه؛ وگرنه همهٔ نسخه‌ها
 * @param overwrite اگر true باشد قواعد موجود هم با دادهٔ جدول دروس جایگزین می‌شوند
 */
export async function syncRequisiteRulesFromCourses(
  opts: { versionId?: number; overwrite?: boolean } = {},
): Promise<SyncStats> {
  const stats = emptyStats();

  // ── ۱) بانک دروس: منبعِ حقیقت ──
  const bank = await db
    .select({
      id: courses.id,
      code: courses.code,
      prereqText: courses.prereqText,
      coRequisites: courses.coRequisites,
    })
    .from(courses);

  const known = new Set(bank.map(c => codeKey(c.code)));
  const byId = new Map(bank.map(c => [c.id, c]));

  const unresolved = new Set<string>();
  /** courseId → درخت پیش‌نیاز/هم‌نیازِ آماده برای نوشتن */
  const prereqTrees = new Map<number, ParsedLogic>();
  const coreqTrees = new Map<number, ParsedLogic>();

  for (const c of bank) {
    const p = parseRequisiteText(c.prereqText);
    if (p) {
      const t = keepKnownCodes(p, known, unresolved);
      if (t) { prereqTrees.set(c.id, t); stats.coursesWithPrereq++; }
    }
    const q = parseRequisiteText(c.coRequisites);
    if (q) {
      const t = keepKnownCodes(q, known, unresolved);
      if (t) { coreqTrees.set(c.id, t); stats.coursesWithCoreq++; }
    }
  }
  stats.unresolvedCodes = [...unresolved].sort();

  if (prereqTrees.size === 0 && coreqTrees.size === 0) return stats;

  // ── ۲) دامنه: کدام نسخه‌ها و کدام درس‌ها ──
  const scopeRows = await db
    .select({ versionId: curriculum_courses.curriculumVersionId, courseId: curriculum_courses.courseId })
    .from(curriculum_courses)
    .where(opts.versionId ? eq(curriculum_courses.curriculumVersionId, opts.versionId) : undefined);

  const versionIds = [...new Set(scopeRows.map(r => r.versionId))];
  stats.versions = versionIds.length;
  if (versionIds.length === 0) return stats;

  const existing = await db
    .select({
      id: course_rules.id,
      syllabusId: course_rules.syllabusId,
      courseId: course_rules.courseId,
      ruleType: course_rules.ruleType,
    })
    .from(course_rules)
    .where(inArray(course_rules.syllabusId, versionIds));

  const has = new Set(existing.map(r => `${r.syllabusId}|${r.courseId}|${r.ruleType}`));

  // ── ۳) نوشتن (فقط جاهای خالی) ──
  type NewRule = { courseId: number; syllabusId: number; ruleType: 'PREREQ' | 'COREQ'; logicTree: string };
  const toInsert: NewRule[] = [];

  for (const row of scopeRows) {
    if (!byId.has(row.courseId)) continue;   // درسِ حذف‌شده از بانک

    const p = prereqTrees.get(row.courseId);
    if (p) {
      const k = `${row.versionId}|${row.courseId}|PREREQ`;
      if (!has.has(k) || opts.overwrite) {
        toInsert.push({ courseId: row.courseId, syllabusId: row.versionId, ruleType: 'PREREQ', logicTree: JSON.stringify(p) });
        stats.prereqRules++;
      } else stats.skippedExisting++;
    }

    const q = coreqTrees.get(row.courseId);
    if (q) {
      const k = `${row.versionId}|${row.courseId}|COREQ`;
      if (!has.has(k) || opts.overwrite) {
        toInsert.push({ courseId: row.courseId, syllabusId: row.versionId, ruleType: 'COREQ', logicTree: JSON.stringify(q) });
        stats.coreqRules++;
      } else stats.skippedExisting++;
    }
  }

  if (opts.overwrite && toInsert.length > 0) {
    // جایگزینی: قاعده‌های همان نوع/نسخه/درس پاک می‌شوند تا تکرار نشود
    const courseIds = [...new Set(toInsert.map(r => r.courseId))];
    await db.delete(course_rules).where(and(
      inArray(course_rules.syllabusId, versionIds),
      inArray(course_rules.courseId, courseIds),
      inArray(course_rules.ruleType, ['PREREQ', 'COREQ']),
    ));
  }

  if (toInsert.length > 0) {
    // دسته‌ای می‌نویسیم تا تعداد رفت‌وبرگشت DB برای ۷۰۰۰ درس قابل تحمل بماند
    for (let i = 0; i < toInsert.length; i += 500) {
      await db.insert(course_rules).values(toInsert.slice(i, i + 500));
    }
  }

  stats.versionCodes = versionIds.map(String);
  return stats;
}

/** پیام فارسیِ آمادهٔ نمایش برای نتیجهٔ همگام‌سازی */
export function describeSyncStats(s: SyncStats): string {
  if (s.versions === 0) {
    return 'هیچ نسخهٔ برنامهٔ درسی‌ای با درس تعریف‌شده پیدا نشد — اول چارت رشته را بسازید.';
  }
  if (s.coursesWithPrereq === 0 && s.coursesWithCoreq === 0) {
    return 'در جدول دروس هیچ متنی برای پیش‌نیاز/هم‌نیاز ثبت نشده است. فایل «دروس» را با ستون‌های «پیش‌نیاز» و «هم‌نیاز» دوباره مهاجرت کنید.';
  }
  const parts = [
    `${s.prereqRules} قاعدهٔ پیش‌نیاز و ${s.coreqRules} قاعدهٔ هم‌نیاز در ${s.versions} نسخه ساخته شد.`,
  ];
  if (s.skippedExisting > 0) parts.push(`${s.skippedExisting} قاعدهٔ موجود دست‌نخورده ماند.`);
  if (s.unresolvedCodes.length > 0) {
    const head = s.unresolvedCodes.slice(0, 8).join('، ');
    const more = s.unresolvedCodes.length > 8 ? ` و ${s.unresolvedCodes.length - 8} کد دیگر` : '';
    parts.push(`این کدها در بانک دروس نبودند و قاعده‌شان ساخته نشد: ${head}${more}.`);
  }
  return parts.join(' ');
}
