import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { assertCsrf } from '@/lib/security';
import { db } from '@/db';
import { z } from 'zod';
import { courses, departments, degree_level_configs, equivalence_clusters } from '@/db/schema';
import { eq, or, and, asc, sql, count, isNull } from 'drizzle-orm';
import { escapeLikeChars } from '@/lib/persian-search';
import { revalidatePath } from 'next/cache';
import { getCurrentUniversity } from '@/lib/university-scope';

const ALLOWED = ['ADMIN', 'EDU_EXPERT', 'VICE_EDU'];
const PAGE_SIZE = 100;

// نوع درس در بانک، دامنهٔ بسته ندارد: خروجی سما مقادیری مثل «نظري-عملي 2س»،
// «الزامي مشترک»، «تخصصي انتخابي» و… دارد. enum بسته باعث می‌شد ویرایشِ درس
// با خطای «داده ورودی معتبر نیست» رد شود و هیچ‌چیز ذخیره نشود.
const courseTypeSchema = z.string().trim().min(1).max(50);
const gradingTypeEnum = z.enum(['NUMERIC', 'PASS_FAIL']);
const offeringScopeEnum = z.enum(['DEPARTMENTAL', 'GENERAL_SERVICE', 'UNIVERSITY_WIDE']);
const locationTypeEnum = z.enum(['IN_CAMPUS', 'OUT_CAMPUS', 'ONLINE', 'HYBRID']);
const unitsNumber = z.coerce.number().min(0).max(20);
const nullableId = z.union([z.number().int().positive(), z.null()]).optional();

const bankCreateSchema = z.object({
  code: z.string().trim().min(1).max(20),
  title: z.string().trim().min(1).max(200),
  theoreticalUnits: z.coerce.number().min(0).max(20).default(0),
  practicalUnits: z.coerce.number().min(0).max(20).default(0),
  courseType: courseTypeSchema.default('تخصصی'),
  gradingType: gradingTypeEnum.default('NUMERIC'),
  affectsGpa: z.coerce.boolean().optional(),
  departmentId: z.coerce.number().int().positive().nullable().optional(),
  degreeLevelId: z.coerce.number().int().positive().nullable().optional(),
  clusterId: z.coerce.number().int().positive().nullable().optional(),
  offeringScope: offeringScopeEnum.default('DEPARTMENTAL'),
  locationType: locationTypeEnum.default('IN_CAMPUS'),
  courseNature: z.string().trim().max(50).nullable().optional(),
  englishName: z.string().trim().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  weeklyTheoryHours: unitsNumber.nullable().optional(),
  weeklyPracticalHours: unitsNumber.nullable().optional(),
  isThesis: z.coerce.boolean().optional(),
  hasProject: z.coerce.boolean().optional(),
  internshipUnits: unitsNumber.nullable().optional(),
  minPassedMark: z.coerce.number().min(0).max(20).nullable().optional(),
  defaultAcceptMarkState: z.string().trim().max(50).nullable().optional(),
  defaultRejectMarkState: z.string().trim().max(50).nullable().optional(),
  courseIsActive: z.coerce.boolean().optional(),
  emergencyWithdrawal: z.coerce.boolean().optional(),
  coRequisites: z.string().max(500).nullable().optional(),
  prereqText: z.string().max(1000).nullable().optional(),
  facesHours: unitsNumber.nullable().optional(),
  equivalentCourseCodes: z.string().max(500).nullable().optional(),
});

const bankPatchSchema = z.object({
  // «کد» در ویرایش قابل تغییر نیست و فیلد غیرفعال در FormData نمی‌آید؛
  // پس خالی/نبودنش نباید کل ذخیره را رد کند.
  code: z.string().trim().max(20).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  theoreticalUnits: unitsNumber.optional(),
  practicalUnits: unitsNumber.optional(),
  courseType: courseTypeSchema.optional(),
  gradingType: gradingTypeEnum.optional(),
  affectsGpa: z.coerce.boolean().optional(),
  departmentId: nullableId,
  degreeLevelId: nullableId,
  clusterId: nullableId,
  offeringScope: offeringScopeEnum.optional(),
  locationType: locationTypeEnum.optional(),
  courseNature: z.string().trim().max(50).nullable().optional(),
  englishName: z.string().trim().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  weeklyTheoryHours: unitsNumber.nullable().optional(),
  weeklyPracticalHours: unitsNumber.nullable().optional(),
  isThesis: z.coerce.boolean().optional(),
  hasProject: z.coerce.boolean().optional(),
  internshipUnits: unitsNumber.nullable().optional(),
  minPassedMark: z.coerce.number().min(0).max(20).nullable().optional(),
  defaultAcceptMarkState: z.string().trim().max(50).nullable().optional(),
  defaultRejectMarkState: z.string().trim().max(50).nullable().optional(),
  courseIsActive: z.coerce.boolean().optional(),
  emergencyWithdrawal: z.coerce.boolean().optional(),
  coRequisites: z.string().max(500).nullable().optional(),
  prereqText: z.string().max(1000).nullable().optional(),
  facesHours: unitsNumber.nullable().optional(),
  equivalentCourseCodes: z.string().max(500).nullable().optional(),
}).strict();

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.roles.some(r => ALLOWED.includes(r))) {
    return NextResponse.json({ ok: false, error: 'دسترسی غیرمجاز.' }, { status: 403 });
  }
  const q = req.nextUrl.searchParams.get('q') || '';
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || '1'));
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || String(PAGE_SIZE))));
  const offset = (page - 1) * limit;

  // دامنهٔ دانشگاه: ردیف‌های NULL هم «پایه/سراسری» حساب می‌شوند.
  const uni = await getCurrentUniversity().catch(() => null);
  const uniScope = uni ? or(eq(courses.universityId, uni.id), isNull(courses.universityId)) : undefined;

  // 🔒 فرار wildcard ورودی کاربر (با ESCAPE '\')
  const like = `%${escapeLikeChars(q)}%`;
  const search = q
    ? or(
        sql`${courses.code} ILIKE ${like} ESCAPE '\\'`,
        sql`${courses.title} ILIKE ${like} ESCAPE '\\'`,
      )
    : undefined;
  const where = and(search, uniScope);

  const [{ total }] = await db.select({ total: count() }).from(courses).where(where);

  const rows = await db
    .select({
      id: courses.id,
      code: courses.code,
      title: courses.title,
      theoreticalUnits: courses.theoreticalUnits,
      practicalUnits: courses.practicalUnits,
      units: courses.units,
      courseType: courses.courseType,
      gradingType: courses.gradingType,
      affectsGpa: courses.affectsGpa,
      departmentId: courses.departmentId,
      departmentName: departments.name,
      degreeLevelId: courses.degreeLevelId,
      degreeLevelTitle: degree_level_configs.title,
      clusterId: courses.clusterId,
      clusterTitle: equivalence_clusters.clusterTitle,
      offeringScope: courses.offeringScope,
      locationType: courses.locationType,
      courseNature: courses.courseNature,
      englishName: courses.englishName,
      description: courses.description,
      weeklyTheoryHours: courses.weeklyTheoryHours,
      weeklyPracticalHours: courses.weeklyPracticalHours,
      isThesis: courses.isThesis,
      hasProject: courses.hasProject,
      internshipUnits: courses.internshipUnits,
      minPassedMark: courses.minPassedMark,
      defaultAcceptMarkState: courses.defaultAcceptMarkState,
      defaultRejectMarkState: courses.defaultRejectMarkState,
      courseIsActive: courses.courseIsActive,
      emergencyWithdrawal: courses.emergencyWithdrawal,
      coRequisites: courses.coRequisites,
      prereqText: courses.prereqText,
      facesHours: courses.facesHours,
      equivalentCourseCodes: courses.equivalentCourseCodes,
    })
    .from(courses)
    .leftJoin(departments, eq(courses.departmentId, departments.id))
    .leftJoin(degree_level_configs, eq(courses.degreeLevelId, degree_level_configs.id))
    .leftJoin(equivalence_clusters, eq(courses.clusterId, equivalence_clusters.id))
    .where(where)
    .orderBy(asc(courses.code))
    .limit(limit)
    .offset(offset);
  return NextResponse.json({ ok: true, courses: rows, total, page, limit });
}

export async function PATCH(req: NextRequest) {
  const csrf = assertCsrf(req);
  if (csrf) return csrf;
  const user = await getSessionUser();
  if (!user || !user.roles.some(r => ALLOWED.includes(r))) {
    return NextResponse.json({ ok: false, error: 'دسترسی غیرمجاز.' }, { status: 403 });
  }
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: 'شناسه درس نامعتبر.' }, { status: 400 });

  // نگهبان دانشگاه: ویرایش درسِ دانشگاه دیگر ممنوع (NULL = سراسری، مجاز).
  const uni = await getCurrentUniversity().catch(() => null);
  if (uni) {
    const [target] = await db.select({ universityId: courses.universityId }).from(courses).where(eq(courses.id, id)).limit(1);
    if (!target) return NextResponse.json({ ok: false, error: 'درس یافت نشد.' }, { status: 404 });
    if (target.universityId != null && target.universityId !== uni.id) {
      return NextResponse.json({ ok: false, error: 'این درس متعلق به دانشگاه دیگری است.' }, { status: 403 });
    }
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنهٔ درخواست نامعتبر است.' }, { status: 400 });
  }
  const parsed = bankPatchSchema.safeParse(rawBody);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path?.join('.') || '—';
    return NextResponse.json({
      ok: false,
      error: `داده ورودی معتبر نیست — فیلد «${field}»: ${first?.message ?? ''}`,
      details: parsed.error.flatten(),
    }, { status: 400 });
  }
  const body = parsed.data;
  const patch: Record<string, unknown> = {};
  if (body.title != null) patch.title = body.title;
  if (body.theoreticalUnits != null) patch.theoreticalUnits = String(body.theoreticalUnits);
  if (body.practicalUnits != null) patch.practicalUnits = String(body.practicalUnits);
  if (body.courseType != null) patch.courseType = body.courseType;
  if (body.gradingType != null) patch.gradingType = body.gradingType;
  if (body.affectsGpa != null) patch.affectsGpa = body.affectsGpa ? 1 : 0;
  if (body.departmentId !== undefined) patch.departmentId = body.departmentId || null;
  if (body.degreeLevelId !== undefined) patch.degreeLevelId = body.degreeLevelId || null;
  if (body.clusterId !== undefined) patch.clusterId = body.clusterId || null;
  if (body.offeringScope != null) patch.offeringScope = body.offeringScope;
  if (body.locationType != null) patch.locationType = body.locationType;
  // فیلدهای جدید سما
  if (body.courseNature != null) patch.courseNature = body.courseNature || null;
  if (body.englishName != null) patch.englishName = body.englishName || null;
  if (body.description != null) patch.description = body.description || null;
  if (body.weeklyTheoryHours != null) patch.weeklyTheoryHours = String(body.weeklyTheoryHours);
  if (body.weeklyPracticalHours != null) patch.weeklyPracticalHours = String(body.weeklyPracticalHours);
  if (body.isThesis != null) patch.isThesis = body.isThesis ? 1 : 0;
  if (body.hasProject != null) patch.hasProject = body.hasProject ? 1 : 0;
  if (body.internshipUnits != null) patch.internshipUnits = String(body.internshipUnits);
  if (body.minPassedMark != null) patch.minPassedMark = String(body.minPassedMark);
  if (body.defaultAcceptMarkState != null) patch.defaultAcceptMarkState = body.defaultAcceptMarkState || null;
  if (body.defaultRejectMarkState != null) patch.defaultRejectMarkState = body.defaultRejectMarkState || null;
  if (body.courseIsActive != null) patch.courseIsActive = body.courseIsActive ? 1 : 0;
  if (body.emergencyWithdrawal != null) patch.emergencyWithdrawal = body.emergencyWithdrawal ? 1 : 0;
  if (body.coRequisites != null) patch.coRequisites = body.coRequisites || null;
  if (body.prereqText != null) patch.prereqText = body.prereqText || null;
  if (body.facesHours != null) patch.facesHours = String(body.facesHours);
  if (body.equivalentCourseCodes != null) patch.equivalentCourseCodes = body.equivalentCourseCodes || null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'فیلدی برای ویرایش ارسال نشد.' }, { status: 400 });
  }

  // محاسبه واحد کل
  if (patch.theoreticalUnits != null || patch.practicalUnits != null) {
    const [current] = await db.select({ theoreticalUnits: courses.theoreticalUnits, practicalUnits: courses.practicalUnits }).from(courses).where(eq(courses.id, id)).limit(1);
    if (current) {
      const theo = Number(patch.theoreticalUnits ?? current.theoreticalUnits ?? 0);
      const prac = Number(patch.practicalUnits ?? current.practicalUnits ?? 0);
      patch.units = String(theo + prac);
    }
  }

  await db.update(courses).set(patch).where(eq(courses.id, id));
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const csrf = assertCsrf(req);
  if (csrf) return csrf;
  const user = await getSessionUser();
  if (!user || !user.roles.some(r => ALLOWED.includes(r))) {
    return NextResponse.json({ ok: false, error: 'دسترسی غیرمجاز.' }, { status: 403 });
  }
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنهٔ درخواست نامعتبر است.' }, { status: 400 });
  }
  const result = bankCreateSchema.safeParse(rawBody);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path?.join('.') || '—';
    return NextResponse.json({
      ok: false,
      error: `داده ورودی معتبر نیست — فیلد «${field}»: ${first?.message ?? ''}`,
      details: result.error.flatten(),
    }, { status: 400 });
  }
  const body = result.data;
  const code = body.code;
  const title = body.title;
  const theo = body.theoreticalUnits ?? 0;
  const prac = body.practicalUnits ?? 0;
  if (!code || !title) {
    return NextResponse.json({ ok: false, error: 'کد درس و عنوان الزامی است.' }, { status: 400 });
  }
  if (theo + prac <= 0) {
    return NextResponse.json({ ok: false, error: 'مجموع واحد نظری و عملی باید بیشتر از صفر باشد.' }, { status: 400 });
  }
  const uni = await getCurrentUniversity().catch(() => null);
  const [dup] = await db.select({ id: courses.id }).from(courses).where(
    uni
      ? and(eq(courses.code, code), or(eq(courses.universityId, uni.id), isNull(courses.universityId)))
      : eq(courses.code, code)
  ).limit(1);
  if (dup) {
    return NextResponse.json({ ok: false, error: `کد درس تکراری است: ${code}` }, { status: 409 });
  }
  const departmentId = Number(body.departmentId || 0) || null;
  const degreeLevelId = Number(body.degreeLevelId || 0) || null;
  const clusterId = Number(body.clusterId || 0) || null;
  const [row] = await db.insert(courses).values({
    code,
    title,
    universityId: uni ? uni.id : null,
    theoreticalUnits: String(theo),
    practicalUnits: String(prac),
    units: String(theo + prac),
    courseType: String(body.courseType || 'تخصصی'),
    gradingType: body.gradingType === 'PASS_FAIL' ? 'PASS_FAIL' : 'NUMERIC',
    affectsGpa: body.affectsGpa ? 1 : 1,
    departmentId,
    degreeLevelId,
    clusterId,
    offeringScope: String(body.offeringScope || 'DEPARTMENTAL'),
    locationType: String(body.locationType || 'IN_CAMPUS'),
    // فیلدهای جدید سما
    courseNature: body.courseNature || null,
    englishName: body.englishName || null,
    description: body.description || null,
    weeklyTheoryHours: body.weeklyTheoryHours ? String(body.weeklyTheoryHours) : null,
    weeklyPracticalHours: body.weeklyPracticalHours ? String(body.weeklyPracticalHours) : null,
    isThesis: body.isThesis ? 1 : 0,
    hasProject: body.hasProject ? 1 : 0,
    internshipUnits: body.internshipUnits ? String(body.internshipUnits) : '0',
    minPassedMark: body.minPassedMark ? String(body.minPassedMark) : null,
    defaultAcceptMarkState: body.defaultAcceptMarkState || null,
    defaultRejectMarkState: body.defaultRejectMarkState || null,
    courseIsActive: body.courseIsActive != null ? (body.courseIsActive ? 1 : 0) : 1,
    emergencyWithdrawal: body.emergencyWithdrawal ? 1 : 0,
    coRequisites: body.coRequisites || null,
    prereqText: body.prereqText || null,
    facesHours: body.facesHours ? String(body.facesHours) : null,
    equivalentCourseCodes: body.equivalentCourseCodes || null,
  }).returning({ id: courses.id });
  revalidatePath('/admin/grade-status-codes');
  return NextResponse.json({ ok: true, data: { id: row.id } });
}
