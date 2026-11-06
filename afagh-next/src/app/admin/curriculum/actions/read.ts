'use server';

// ════════════════════════════════════════════════════════════════════════
//  خواندن‌های پنل برنامهٔ درسی — نمای کلی (رشته/نسخه/گرایش)، جزئیات نسخه +
//  یافته‌های اعتبارسنجی، بانک دروس و فهرست گروه‌ها.
//  همه فقط‌خواندنی‌اند و گاردشان requireRole(EDITORS) است.
// ════════════════════════════════════════════════════════════════════════

import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { courses, curriculum_approvals, curriculum_courses, curriculum_tracks, curriculum_versions, degree_level_configs, departments, financial_terms, majors } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { faSearchConds, capRows } from '@/lib/fa-list-query';
import { validateCurriculumCore } from '@/lib/curriculum-validator';
import { type CourseBankResult, type CurriculumOverviewResult, type CurriculumVersionDetailResult, type DepartmentListResult, EDITORS, buildCheckInput, loadVersionData } from './shared';

export async function getCurriculumOverviewAction(): Promise<CurriculumOverviewResult> {
  await requireRole(EDITORS);
  try {
    const { getCurrentUniversity } = await import('@/lib/university-scope');
    const uni = await getCurrentUniversity().catch(() => null);
    const uw = uni ? eq(majors.universityId, uni.id) : undefined;
    const [majorRows, versionRows, trackRows, termRows, countRows] = await Promise.all([
      db.select({
        id: majors.id, code: majors.majorCode, name: majors.name,
        degreeLevelId: majors.degreeLevelId, degreeTitle: degree_level_configs.title,
        degreeCode: degree_level_configs.code,
        degreeTermCount: degree_level_configs.termCount,
        degreeIsGraduate: degree_level_configs.isGraduate,
      }).from(majors)
        .leftJoin(degree_level_configs, eq(degree_level_configs.id, majors.degreeLevelId))
        .where(uw)
        .orderBy(asc(majors.name)),
      db.select({
        id: curriculum_versions.id,
        majorId: curriculum_versions.majorId,
        degreeLevelId: curriculum_versions.degreeLevelId,
        trackId: curriculum_versions.trackId,
        versionCode: curriculum_versions.versionCode,
        title: curriculum_versions.title,
        status: curriculum_versions.status,
        entryYearFrom: curriculum_versions.entryYearFrom,
        entryYearTo: curriculum_versions.entryYearTo,
        totalRequiredUnits: curriculum_versions.totalRequiredUnits,
      }).from(curriculum_versions)
        .where(uni ? eq(curriculum_versions.universityId, uni.id) : undefined)
        .orderBy(desc(curriculum_versions.id)),
      db.select().from(curriculum_tracks)
        .where(uni ? eq(curriculum_tracks.universityId, uni.id) : undefined)
        .orderBy(asc(curriculum_tracks.title)),
      db.select({ id: financial_terms.id, termCode: financial_terms.termCode, title: financial_terms.title })
        .from(financial_terms)
        .where(uni ? eq(financial_terms.universityId, uni.id) : undefined)
        .orderBy(desc(financial_terms.termCode))
        .limit(40),
      // تعداد درس هر نسخه — یک کوئری گروهی (به‌جای زیرکوئری هم‌بسته که عدد اشتباه می‌داد)
      db.select({ versionId: curriculum_courses.curriculumVersionId, n: sql<number>`count(*)::int` })
        .from(curriculum_courses)
        .groupBy(curriculum_courses.curriculumVersionId),
    ]);
    const countByVersion = new Map<number, number>(
      (countRows ?? []).map(r => [Number(r.versionId), Number(r.n)]),
    );
    const versionsWithCount = versionRows.map(v => ({ ...v, courseCount: countByVersion.get(Number(v.id)) ?? 0 }));
    return { ok: true, data: { majors: majorRows, versions: versionsWithCount, tracks: trackRows, terms: termRows } };
  } catch (err: any) {
    console.error('getCurriculumOverviewAction:', err);
    return { ok: false, error: 'خطا در بارگیری نمای کلی برنامهٔ درسی' };
  }
}

/** بانک دروس دانشگاه — برای افزودن درس به نسخهٔ DRAFT (Thin Client فاز ۷)
 *
 *  سقف + جست‌وجوی سروری: پیش‌تر *همه* دروس دانشگاه (بدون سقف) به کلاینت می‌آمد
 *  و این‌جا فیلتر می‌شد ⇒ در دانشگاه‌های بزرگ بانک چندهزارتایی بود و صفحهٔ
 *  «افزودن درس» سنگین می‌شد. حالا سرور فیلتر (نرمال‌سازی فارسی روی کد/عنوان)
 *  و سقف می‌گذارد؛ کلاینت فقط برای نمایشِ «X از Y» و فیلترِ پیشوند کد استفاده
 *  می‌کند.
 */
const BANK_SERVER_CAP = 100;

export async function listCourseBankAction(q?: string, limit?: number): Promise<CourseBankResult> {
  await requireRole(EDITORS);
  try {
    const { getCurrentUniversity } = await import('@/lib/university-scope');
    const uni = await getCurrentUniversity().catch(() => null);
    const query = (q ?? '').trim();
    const conds = faSearchConds(query, [courses.code, courses.title]);
    const where = and(
      uni ? eq(courses.universityId, uni.id) : undefined,
      conds.length ? or(...conds) : undefined,
    );
    const cap = capRows(limit ?? BANK_SERVER_CAP);
    const [rows, totalRow] = await Promise.all([
      db
        .select({ id: courses.id, code: courses.code, title: courses.title, units: courses.units, courseType: courses.courseType })
        .from(courses)
        .where(where)
        .orderBy(asc(courses.code))
        .limit(cap),
      db.select({ n: sql<number>`count(*)::int` }).from(courses).where(where),
    ]);
    return {
      ok: true,
      total: Number(totalRow[0]?.n ?? 0),
      data: rows.map((r) => ({ id: r.id, code: r.code, title: r.title, units: String(r.units), courseType: r.courseType ?? '—' })),
    };
  } catch (err: any) {
    console.error('listCourseBankAction:', err);
    return { ok: false, error: 'خطا در بارگیری بانک دروس' };
  }
}

/** فهرست گروه‌های آموزشی — برای فرم «تعریف درس جدید در بانک» (معادل فیلد «گروه آموزشی» سامانهٔ قدیم) */


export async function listDepartmentsAction(): Promise<DepartmentListResult> {
  await requireRole(EDITORS);
  try {
    const { getCurrentUniversity } = await import('@/lib/university-scope');
    const uni = await getCurrentUniversity().catch(() => null);
    const rows = await db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(uni ? eq(departments.universityId, uni.id) : undefined)
      .orderBy(asc(departments.name));
    return { ok: true, data: rows };
  } catch (err: any) {
    console.error('listDepartmentsAction:', err);
    return { ok: false, error: 'خطا در بارگیری گروه‌های آموزشی' };
  }
}


export async function getCurriculumVersionDetailAction(versionId: number): Promise<CurriculumVersionDetailResult> {
  await requireRole(EDITORS);
  try {
    const data = await loadVersionData(versionId);
    const approvals = await db
      .select({ id: curriculum_approvals.id, approvalType: curriculum_approvals.approvalType, fromStatus: curriculum_approvals.fromStatus, toStatus: curriculum_approvals.toStatus, decisionNote: curriculum_approvals.decisionNote, approvedAt: curriculum_approvals.approvedAt })
      .from(curriculum_approvals)
      .where(eq(curriculum_approvals.curriculumVersionId, versionId))
      .orderBy(desc(curriculum_approvals.approvedAt));
    return {
      ok: true,
      data: {
        version: data.version,
        courses: data.courses,
        rules: data.rules,
        approvals,
        checks: validateCurriculumCore(await buildCheckInput(data)),
        extraTitles: data.extraTitles ?? {},
      },
    };
  } catch (err: any) {
    console.error('getCurriculumVersionDetailAction:', err);
    return { ok: false, error: err.message || 'خطا در بارگیری جزئیات نسخه' };
  }
}

// ─────────────────────────── ساخت و ویرایش (فقط DRAFT) ───────────────────────────
