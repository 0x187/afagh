/**
 * Server Actions ماژول اختیاری «طرح درس» (Lesson-Plan) — مهاجرت 0055.
 *
 * معنای «اجباری‌بودن» (lesson_plan_settings.isRequired): فقط بنر اطلاع‌رسانی
 * + فشار برای ثبت نهایی در UI است؛ سدّ فنی هیچ قابلیت دیگری نیست و ذخیرهٔ
 * پیش‌نویس همیشه مجاز است.
 */
'use server';

import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import {
  course_offerings,
  courses,
  lesson_plan_sessions,
  lesson_plan_settings,
  lesson_plan_weights,
  lesson_plans,
  staff,
  universities,
  users,
} from '@/db/schema';
import { getSessionUser, getStaffByUser, requireRole } from '@/lib/auth';
import { faLikePattern, normCol } from '@/lib/persian-search';

const COURSE_MODES = ['THEORY', 'PRACTICAL', 'COMBINED'] as const;
const SESSION_KINDS = ['THEORY', 'PRACTICAL', 'COMBINED'] as const;
const PLAN_STATUSES = ['DRAFT', 'SUBMITTED'] as const;

export interface SaveLessonPlanSessionInput {
  sessionNo: number;
  sessionKind: string;
  topic: string;
  details?: string;
  weightId?: number | null;
}

export interface SaveLessonPlanWeightInput {
  title: string;
  percent: number;
}

export interface SaveLessonPlanInput {
  courseMode: 'THEORY' | 'PRACTICAL' | 'COMBINED';
  totalSessions: number;
  objectives: string;
  resources: string;
  status: 'DRAFT' | 'SUBMITTED';
  sessions: SaveLessonPlanSessionInput[];
  weights: SaveLessonPlanWeightInput[];
}

/** بارم با درصد عددی (ستون numeric دریزل رشته برمی‌گرداند؛ برای UI پارس می‌شود) */
export type PlanWeightRow = Omit<typeof lesson_plan_weights.$inferSelect, 'percent'> & { percent: number };

/** ریدایرکت Next را نباید ببلعد (الگوی try/catch اکشن‌های {ok:false}) */
function rethrowRedirect(err: unknown): void {
  if (String((err as Error)?.message ?? '').startsWith('NEXT_REDIRECT')) throw err;
}

/** حدس پیش‌فرض حالت درس از سرفصل (ماهیت/واحد نظری‌وعملی) */
function defaultCourseModeOf(c: {
  courseNature?: string | null;
  theoreticalUnits?: string | number | null;
  practicalUnits?: string | number | null;
}): string {
  const nature = String(c.courseNature ?? '');
  const hasTheory = /نظری/.test(nature) || Number(c.theoreticalUnits ?? 0) > 0;
  const hasPractical = /عملی|آزمایش|کارگاه/.test(nature) || Number(c.practicalUnits ?? 0) > 0;
  if (hasTheory && hasPractical) return 'COMBINED';
  if (hasPractical) return 'PRACTICAL';
  return 'THEORY';
}

// ─────────────────────────────────────────────────────────────────────────────
// خواندن طرح درس استادِ مالک (یا مشاهدهٔ فقط‌خواندنی ادمین)
// ─────────────────────────────────────────────────────────────────────────────

export async function getMyPlan(offeringId: number): Promise<{
  plan: typeof lesson_plans.$inferSelect | null;
  sessions: (typeof lesson_plan_sessions.$inferSelect)[] | null;
  weights: PlanWeightRow[] | null;
  required: boolean;
  notice: string | null;
  isOwner: boolean;
  courseTitle: string;
  courseModeDefault: string;
}> {
  const user = await requireRole(['PROFESSOR']);
  const oid = Number(offeringId);
  if (!Number.isInteger(oid) || oid <= 0) throw new Error('شناسهٔ ارائهٔ درس نامعتبر است.');

  const [off] = await db
    .select({
      offering: course_offerings,
      courseTitle: courses.title,
      courseNature: courses.courseNature,
      theoreticalUnits: courses.theoreticalUnits,
      practicalUnits: courses.practicalUnits,
    })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(eq(course_offerings.id, oid))
    .limit(1);
  if (!off) throw new Error('ارائهٔ درس یافت نشد.');

  const me = await getStaffByUser(user.id);
  const isOwner = !!me && off.offering.professorId === me.id;

  const uniId = off.offering.universityId ?? user.universityId ?? null;
  let required = false;
  let notice: string | null = null;
  if (uniId) {
    const [s] = await db
      .select()
      .from(lesson_plan_settings)
      .where(eq(lesson_plan_settings.universityId, uniId))
      .limit(1);
    if (s) {
      required = s.isRequired === 1;
      notice = s.notice;
    }
  }

  const [plan] = await db
    .select()
    .from(lesson_plans)
    .where(eq(lesson_plans.offeringId, oid))
    .limit(1);
  if (!plan) {
    return {
      plan: null,
      sessions: null,
      weights: null,
      required,
      notice,
      isOwner,
      courseTitle: off.courseTitle,
      courseModeDefault: defaultCourseModeOf(off),
    };
  }

  const srows = await db
    .select()
    .from(lesson_plan_sessions)
    .where(eq(lesson_plan_sessions.planId, plan.id))
    .orderBy(asc(lesson_plan_sessions.sessionNo));
  const wrows = await db
    .select()
    .from(lesson_plan_weights)
    .where(eq(lesson_plan_weights.planId, plan.id))
    .orderBy(asc(lesson_plan_weights.sortOrder), asc(lesson_plan_weights.id));

  return {
    plan,
    sessions: srows,
    weights: wrows.map((w): PlanWeightRow => ({ ...w, percent: Number(w.percent) })),
    required,
    notice,
    isOwner,
    courseTitle: off.courseTitle,
    courseModeDefault: defaultCourseModeOf(off),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ذخیرهٔ طرح درس (فقط استاد مالک)
// ─────────────────────────────────────────────────────────────────────────────

export async function saveLessonPlan(
  offeringId: number,
  input: SaveLessonPlanInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireRole(['PROFESSOR']);
    const oid = Number(offeringId);
    if (!Number.isInteger(oid) || oid <= 0) return { ok: false, error: 'شناسهٔ ارائهٔ درس نامعتبر است.' };

    const [off] = await db
      .select({ id: course_offerings.id, professorId: course_offerings.professorId })
      .from(course_offerings)
      .where(eq(course_offerings.id, oid))
      .limit(1);
    if (!off) return { ok: false, error: 'ارائهٔ درس یافت نشد.' };
    const me = await getStaffByUser(user.id);
    if (!me || off.professorId !== me.id) return { ok: false, error: 'شما استاد مسئول این درس نیستید.' };

    // ── اعتبارسنجی سرجمع ──
    if (!COURSE_MODES.includes(input.courseMode)) return { ok: false, error: 'حالت درس نامعتبر است.' };
    const total = Number(input.totalSessions);
    if (!Number.isInteger(total) || total < 1 || total > 32)
      return { ok: false, error: 'تعداد جلسات باید عددی بین ۱ تا ۳۲ باشد.' };
    if (!PLAN_STATUSES.includes(input.status)) return { ok: false, error: 'وضعیت طرح درس نامعتبر است.' };
    const objectives = String(input.objectives ?? '').trim();
    const resources = String(input.resources ?? '').trim();
    if (objectives.length > 10000) return { ok: false, error: 'متن اهداف بیش از حد طولانی است.' };
    if (resources.length > 10000) return { ok: false, error: 'متن منابع بیش از حد طولانی است.' };

    // ── اعتبارسنجی جلسات: دقیقاً ۱..totalSessions یکتا ──
    const sessions = Array.isArray(input.sessions) ? input.sessions : [];
    if (sessions.length !== total)
      return { ok: false, error: `تعداد جلسات ارسالی (${sessions.length}) با تعداد اعلام‌شده (${total}) هم‌خوان نیست.` };
    const seen = new Set<number>();
    for (const s of sessions) {
      const no = Number(s.sessionNo);
      if (!Number.isInteger(no) || no < 1 || no > total || seen.has(no))
        return { ok: false, error: 'شمارهٔ جلسات باید دقیقاً اعداد ۱ تا تعداد جلسات، بدون تکرار باشد.' };
      seen.add(no);
    }

    type CleanSession = {
      sessionNo: number;
      sessionKind: string;
      topic: string;
      details: string | null;
      weightId: number | null;
    };
    const cleanSessions: CleanSession[] = [];
    for (const s of sessions) {
      const no = Number(s.sessionNo);
      const kind = String(s.sessionKind ?? '').trim().toUpperCase() || 'THEORY';
      if (!SESSION_KINDS.includes(kind as (typeof SESSION_KINDS)[number]))
        return { ok: false, error: `نوع جلسهٔ شمارهٔ ${no} نامعتبر است.` };
      const topic = String(s.topic ?? '').trim();
      if (topic.length > 300) return { ok: false, error: `موضوع جلسهٔ شمارهٔ ${no} بیش از ۳۰۰ نویسه است.` };
      if (input.status === 'SUBMITTED' && !topic)
        return { ok: false, error: `برای ثبت نهایی، موضوع جلسهٔ شمارهٔ ${no} الزامی است.` };
      const details = String(s.details ?? '').trim();
      if (details.length > 5000) return { ok: false, error: `شرح جلسهٔ شمارهٔ ${no} بیش از حد طولانی است.` };
      const rawW: unknown = s.weightId;
      const weightId = rawW === null || rawW === undefined || rawW === '' ? null : Number(rawW);
      if (weightId !== null && (!Number.isInteger(weightId) || weightId <= 0))
        return { ok: false, error: `بارم جلسهٔ شمارهٔ ${no} نامعتبر است.` };
      cleanSessions.push({ sessionNo: no, sessionKind: kind, topic, details: details || null, weightId });
    }

    // ── اعتبارسنجی بارم‌ها: جمع ۱۰۰ ± ۰٫۰۱ وقتی خالی نیست ──
    const weights = Array.isArray(input.weights) ? input.weights : [];
    if (weights.length > 32) return { ok: false, error: 'تعداد بارم‌ها بیش از حد مجاز است.' };
    type CleanWeight = { title: string; percent: number };
    const cleanWeights: CleanWeight[] = [];
    for (const w of weights) {
      const title = String(w.title ?? '').trim();
      if (!title) return { ok: false, error: 'عنوان همهٔ بارم‌ها الزامی است.' };
      if (title.length > 100) return { ok: false, error: `عنوان بارم «${title.slice(0, 30)}…» بیش از ۱۰۰ نویسه است.` };
      const p = Number(w.percent);
      if (!Number.isFinite(p) || p < 0 || p > 100)
        return { ok: false, error: `درصد بارم «${title}» باید بین ۰ تا ۱۰۰ باشد.` };
      cleanWeights.push({ title, percent: Math.round(p * 100) / 100 });
    }
    if (cleanWeights.length > 0) {
      const sum = cleanWeights.reduce((a, w) => a + w.percent, 0);
      if (Math.abs(sum - 100) > 0.01)
        return {
          ok: false,
          error: `جمع درصد بارم‌ها باید ۱۰۰ باشد (جمع فعلی: ${Math.round(sum * 100) / 100}).`,
        };
    }

    // ── ذخیرهٔ تراکنشی: upsert سرجمع + حذف‌ودرج جلسات/بارم‌ها در محدودهٔ همین طرح ──
    await db.transaction(async tx => {
      let [plan] = await tx
        .select()
        .from(lesson_plans)
        .where(eq(lesson_plans.offeringId, oid))
        .limit(1);

      // نگاشت شناسه‌های قدیمی بارم → عنوان (برای حفظ اتصال جلسات پس از درج مجدد؛
      // ورودی weights شناسه ندارد پس اتصال بر اساس عنوانِ یکتا در نظر گرفته می‌شود)
      let oldById = new Map<number, string>();
      if (plan) {
        const oldW = await tx
          .select({ id: lesson_plan_weights.id, title: lesson_plan_weights.title })
          .from(lesson_plan_weights)
          .where(eq(lesson_plan_weights.planId, plan.id));
        oldById = new Map(oldW.map(r => [r.id, r.title]));
      }

      const planValues = {
        courseMode: input.courseMode,
        totalSessions: total,
        objectives: objectives || null,
        resources: resources || null,
        status: input.status,
        submittedAt: input.status === 'SUBMITTED' ? new Date() : null,
        updatedAt: new Date(),
      };
      if (!plan) {
        const rows = await tx
          .insert(lesson_plans)
          .values({ offeringId: oid, ...planValues })
          .returning();
        plan = rows[0];
      } else {
        await tx.update(lesson_plans).set(planValues).where(eq(lesson_plans.id, plan.id));
      }

      await tx.delete(lesson_plan_sessions).where(eq(lesson_plan_sessions.planId, plan.id));
      await tx.delete(lesson_plan_weights).where(eq(lesson_plan_weights.planId, plan.id));

      // درج بارم‌ها به ترتیب ورودی + نگاشت عنوان → شناسهٔ جدید
      const newIdByTitle = new Map<string, number[]>();
      if (cleanWeights.length > 0) {
        const rows = await tx
          .insert(lesson_plan_weights)
          .values(
            cleanWeights.map((w, i) => ({
              planId: plan.id,
              title: w.title,
              percent: String(w.percent),
              sortOrder: i,
            })),
          )
          .returning({ id: lesson_plan_weights.id, title: lesson_plan_weights.title });
        for (const r of rows) {
          const arr = newIdByTitle.get(r.title) ?? [];
          arr.push(r.id);
          newIdByTitle.set(r.title, arr);
        }
      }
      const usedNewIds = new Set<number>();
      const resolveWeight = (oldId: number | null): number | null => {
        if (oldId === null) return null;
        const title = oldById.get(oldId);
        if (!title) return null; // شناسهٔ ناآشنا/متعلق به طرح دیگر → قطع اتصال
        const candidates = newIdByTitle.get(title) ?? [];
        const free = candidates.find(id => !usedNewIds.has(id));
        if (free === undefined) return null;
        usedNewIds.add(free);
        return free;
      };

      if (cleanSessions.length > 0) {
        await tx.insert(lesson_plan_sessions).values(
          cleanSessions.map(s => ({
            planId: plan.id,
            sessionNo: s.sessionNo,
            sessionKind: s.sessionKind,
            topic: s.topic || null,
            details: s.details,
            weightId: resolveWeight(s.weightId),
          })),
        );
      }
    });

    revalidatePath('/professor/lesson-plan');
    return { ok: true };
  } catch (err) {
    rethrowRedirect(err);
    return { ok: false, error: (err as Error)?.message || 'خطا در ذخیرهٔ طرح درس.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// خواندن عمومی طرحِ منتشرشده (هر کاربر احرازهویت‌شده؛ بدون کنترل ثبت‌نام —
// مطابق قرارداد «ساده نگه داشته شود». انتخاب گزارش شده است.)
// ─────────────────────────────────────────────────────────────────────────────

export async function getPlanForStudent(offeringId: number): Promise<{
  published: boolean;
  plan: typeof lesson_plans.$inferSelect | null;
  sessions: (typeof lesson_plan_sessions.$inferSelect)[] | null;
  weights: PlanWeightRow[] | null;
  courseTitle: string;
}> {
  const user = await getSessionUser();
  if (!user) throw new Error('برای مشاهدهٔ طرح درس ابتدا وارد شوید.');
  const oid = Number(offeringId);
  if (!Number.isInteger(oid) || oid <= 0) throw new Error('شناسهٔ ارائهٔ درس نامعتبر است.');

  const [off] = await db
    .select({ id: course_offerings.id, courseTitle: courses.title })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .where(eq(course_offerings.id, oid))
    .limit(1);
  if (!off) throw new Error('ارائهٔ درس یافت نشد.');

  const [plan] = await db
    .select()
    .from(lesson_plans)
    .where(eq(lesson_plans.offeringId, oid))
    .limit(1);
  if (!plan || plan.status !== 'SUBMITTED')
    return { published: false, plan: null, sessions: null, weights: null, courseTitle: off.courseTitle };

  const srows = await db
    .select()
    .from(lesson_plan_sessions)
    .where(eq(lesson_plan_sessions.planId, plan.id))
    .orderBy(asc(lesson_plan_sessions.sessionNo));
  const wrows = await db
    .select()
    .from(lesson_plan_weights)
    .where(eq(lesson_plan_weights.planId, plan.id))
    .orderBy(asc(lesson_plan_weights.sortOrder), asc(lesson_plan_weights.id));

  return {
    published: true,
    plan,
    sessions: srows,
    weights: wrows.map((w): PlanWeightRow => ({ ...w, percent: Number(w.percent) })),
    courseTitle: off.courseTitle,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// مدیریت (ادمینِ دانشگاه) — در همین فایل نگه داشته شده تا نیازی به
// src/app/admin/lesson-plans/actions.ts نباشد.
// ─────────────────────────────────────────────────────────────────────────────

export async function setLessonPlanRequired(
  universityId: number,
  isRequired: boolean,
  notice?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireRole(['ADMIN']);
    const uid = Number(universityId);
    if (!Number.isInteger(uid) || uid <= 0) return { ok: false, error: 'شناسهٔ دانشگاه نامعتبر است.' };
    const [u] = await db
      .select({ id: universities.id })
      .from(universities)
      .where(eq(universities.id, uid))
      .limit(1);
    if (!u) return { ok: false, error: 'دانشگاه یافت نشد.' };

    const cleanNotice = String(notice ?? '').trim().slice(0, 2000) || null;
    await db
      .insert(lesson_plan_settings)
      .values({ universityId: uid, isRequired: isRequired ? 1 : 0, notice: cleanNotice, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [lesson_plan_settings.universityId],
        set: { isRequired: isRequired ? 1 : 0, notice: cleanNotice, updatedAt: new Date() },
      });

    revalidatePath('/admin/lesson-plans');
    revalidatePath('/professor/lesson-plan');
    return { ok: true };
  } catch (err) {
    rethrowRedirect(err);
    return { ok: false, error: (err as Error)?.message || 'خطا در ذخیرهٔ تنظیمات طرح درس.' };
  }
}

/**
 * سقفِ ردیف‌های هر پاسخِ «پایش طرح درس».
 *
 * ⚠ نسخهٔ پیشین «همهٔ» ارائه‌های دانشگاه را بدون سقف برمی‌گرداند؛ برای
 * دانشگاهی با ده‌ها هزار ارائه یعنی ~۲MB payload در هر بارِ بازکردن صفحه —
 * ریشهٔ کندیِ صفحهٔ آموزش. اکنون الگوی «جستجوی سروری + سقف ردیف» این مخزن:
 * آمارِ سربرگ در SQL، جست‌وجو/فیلتر سمتِ سرور و سقفِ سختِ ردیف.
 */
export const LESSON_PLAN_PAGE_SIZE = 200;

export type LessonPlanStatusRow = {
  offeringId: number;
  courseTitle: string;
  professorName: string;
  status: string;
  sessionsCount: number;
  weightsSum: number;
  updatedAt: Date | null;
};

export async function listLessonPlanStatus(
  universityId: number,
  opts?: { query?: string; status?: string; limit?: number; offset?: number },
): Promise<{
  rows: LessonPlanStatusRow[];
  /** همهٔ ارائه‌های دانشگاه (بدون فیلتر) — برای سربرگ */
  total: number;
  /** تعدادِ ثبت‌نهایی (بدون فیلتر) — برای سربرگ */
  submitted: number;
  /** تعدادِ نتایجِ فیلترِ فعلی — برای صفحه‌بندی */
  filtered: number;
}> {
  await requireRole(['ADMIN', 'EDU_EXPERT', 'VICE_EDU']);
  const uid = Number(universityId);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error('شناسهٔ دانشگاه نامعتبر است.');

  const limit = Math.min(Math.max(1, Math.trunc(Number(opts?.limit) || LESSON_PLAN_PAGE_SIZE)), 500);
  const offset = Math.max(0, Math.trunc(Number(opts?.offset) || 0));

  // ── شرط‌ها: دانشگاه (همیشه) + جست‌وجوی سروری + وضعیت ──
  const conds: SQL[] = [eq(course_offerings.universityId, uid)];
  const q = String(opts?.query ?? '').trim();
  if (q) {
    const like = faLikePattern(q);
    // هر دو سمت نرمال می‌شوند تا «ي/ی» و «ك/ک» بخورد (همان قرارداد جست‌وجوی مخزن)
    conds.push(
      sql`(${normCol(courses.title)} ILIKE ${like} ESCAPE '\\' OR ${normCol(sql`${users.firstName} || ' ' || ${users.lastName}`)} ILIKE ${like} ESCAPE '\\')`,
    );
  }
  const want = String(opts?.status ?? '').toUpperCase();
  if (want === 'DRAFT' || want === 'SUBMITTED') conds.push(sql`${lesson_plans.status} = ${want}`);
  else if (want === 'NONE') conds.push(sql`${lesson_plans.status} IS NULL`);
  const where = and(...conds);

  // ── آمارِ سربرگ در SQL — مستقل از فیلترها و ارزان ──
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      submitted: sql<number>`count(*) FILTER (WHERE ${lesson_plans.status} = 'SUBMITTED')::int`,
    })
    .from(course_offerings)
    .leftJoin(lesson_plans, eq(lesson_plans.offeringId, course_offerings.id))
    .where(eq(course_offerings.universityId, uid));

  const [fRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .leftJoin(staff, eq(staff.id, course_offerings.professorId))
    .leftJoin(users, eq(users.id, staff.userId))
    .leftJoin(lesson_plans, eq(lesson_plans.offeringId, course_offerings.id))
    .where(where);

  // ── فقط یک صفحه از ردیف‌ها ──
  const offs = await db
    .select({
      offeringId: course_offerings.id,
      courseTitle: courses.title,
      professorFirst: users.firstName,
      professorLast: users.lastName,
      planId: lesson_plans.id,
      status: lesson_plans.status,
      updatedAt: lesson_plans.updatedAt,
    })
    .from(course_offerings)
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .leftJoin(staff, eq(staff.id, course_offerings.professorId))
    .leftJoin(users, eq(users.id, staff.userId))
    .leftJoin(lesson_plans, eq(lesson_plans.offeringId, course_offerings.id))
    .where(where)
    .orderBy(asc(course_offerings.id))
    .limit(limit)
    .offset(offset);

  // جمعِ جلسات/بارم فقط برای «همین صفحه» — نه همهٔ طرح‌های دانشگاه
  const planIds = offs.map(o => o.planId).filter((v): v is number => v !== null);
  const countByPlan = new Map<number, number>();
  const sumByPlan = new Map<number, number>();
  if (planIds.length > 0) {
    const counts = await db
      .select({ planId: lesson_plan_sessions.planId, c: sql<number>`count(*)::int` })
      .from(lesson_plan_sessions)
      .where(inArray(lesson_plan_sessions.planId, planIds))
      .groupBy(lesson_plan_sessions.planId);
    for (const r of counts) countByPlan.set(r.planId, Number(r.c));
    const sums = await db
      .select({ planId: lesson_plan_weights.planId, s: sql<string | null>`sum(${lesson_plan_weights.percent})` })
      .from(lesson_plan_weights)
      .where(inArray(lesson_plan_weights.planId, planIds))
      .groupBy(lesson_plan_weights.planId);
    for (const r of sums) sumByPlan.set(r.planId, r.s === null ? 0 : Number(r.s));
  }

  const rows: LessonPlanStatusRow[] = offs.map(o => ({
    offeringId: o.offeringId,
    courseTitle: o.courseTitle,
    professorName: `${o.professorFirst ?? ''} ${o.professorLast ?? ''}`.trim() || '—',
    status: o.status ?? 'NONE',
    sessionsCount: o.planId == null ? 0 : (countByPlan.get(o.planId) ?? 0),
    weightsSum: o.planId == null ? 0 : (sumByPlan.get(o.planId) ?? 0),
    updatedAt: o.updatedAt,
  }));

  return {
    rows,
    total: Number(stats?.total ?? 0),
    submitted: Number(stats?.submitted ?? 0),
    filtered: Number(fRow?.n ?? 0),
  };
}
