import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { academic_terms, departments, staff, users } from '@/db/schema';
import { getNumber, getSetting } from '@/lib/settings';
import { managementOverview, type TrendPoint } from '@/lib/bi-engine';
import { currentTermFor } from '@/lib/terms';

// ══════════════════════════════════════════════════════════════════════
//  کارنامهٔ عملکرد استاد (Professor Performance) — دادهٔ زنده
//
//  جایگزین دادهٔ نمونهٔ `sampleStaffPerformance` در executive-analytics.
//  هر عددی که در صفحهٔ /professor/performance دیده می‌شود از پایگاه داده
//  می‌آید؛ هیچ عدد ثابتی (میانگین دانشگاه، رتبه، درصد رشد) در کد نیست.
//
//  همان قواعد موتور BI: کوئری تجمیعی (بدون N+1)، Drizzle، و مقایسه با
//  «میانگین واقعی همکاران» که از همان کوئری GROUP BY به دست می‌آید.
// ══════════════════════════════════════════════════════════════════════

/** مالکیت کلاس: مدرس اصلی (همان تعریف موتور BI) */
const OWNERSHIP_CTE = sql`
  ownership as (
    select o.id as offering_id, o."professorId" as staff_id
      from course_offerings o where o."professorId" is not null
    union
    select op."offeringId", op."staffId"
      from offering_professors op where op.role = 'MAIN_LECTURER'
  )`;

const round1 = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 10) / 10);
const round2 = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 100) / 100);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
/** رقم‌های فارسی — برای اینکه متن دلایل با اعداد صفحه هم‌شکل باشد */
const fa = (n: number | null) => (n == null ? '—' : n.toLocaleString('fa-IR'));

export type ProfessorPerformance = {
  staffId: number;
  staffCode: string;
  fullName: string;
  academicRank: string | null;
  departmentName: string | null;
  term: string;
  period: string | null;

  teaching: { offerings: number; students: number; courses: string[] };
  sessions: { held: number; absent: number; makeUp: number; scheduled: number; heldRate: number | null; holdTarget: number };
  grades: { entered: number; pending: number; total: number; completionPercent: number | null; deadline: string | null; appealsOpen: number };

  desk: {
    resolvedThisMonth: number;
    resolvedPrevMonth: number;
    growthPercent: number | null;
    mttrHours: number | null;
    slaOnTimePercent: number | null;
    slaBreached: number;
    openQueue: number;
    csat: number | null;
    reviews: number;
    slaTarget: number;
  };

  evaluation: { score: number | null; respondents: number; deptAvg: number | null; trend: TrendPoint[]; evalTarget: number };

  peers: {
    count: number;
    evalRank: number | null;
    responseRank: number | null;
    responders: number;
    avgMttrHours: number | null;
    avgSlaOnTimePercent: number | null;
    avgEvalScore: number | null;
  };

  badge: { title: string; level: 'DIAMOND' | 'GOLD' | 'SILVER' | 'BRONZE' };
  incentive: { eligible: boolean; percent: number; reasons: string[] };
};

export async function getProfessorPerformance(staffId: number): Promise<ProfessorPerformance> {
  const [me] = await db
    .select({
      id: staff.id,
      code: staff.staffCode,
      name: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      rank: staff.academicRank,
      department: departments.name,
      universityId: staff.universityId,
    })
    .from(staff)
    .innerJoin(users, eq(users.id, staff.userId))
    .leftJoin(departments, eq(departments.id, staff.departmentId))
    .where(eq(staff.id, staffId))
    .limit(1);
  if (!me) throw new Error('پروندهٔ پرسنلی یافت نشد.');

  const term = await currentTermFor(me.universityId ?? null);
  if (!term) throw new Error('ترم جاری مشخص نیست.');

  const [slaTarget, evalTarget, holdTarget, incentivePercent] = await Promise.all([
    getNumber('PERF_SLA_TARGET', 90),
    getNumber('PERF_EVAL_TARGET', 4),
    getNumber('PERF_SESSION_HOLD_TARGET', 90),
    getNumber('PERF_INCENTIVE_PERCENT', 10),
  ]);

  // ── ۱) بار تدریس (یک کوئری) ──
  // ⚠ بازنویسی: پیش‌تر تعداد دانشجو از یک «جدولِ مشتق» می‌آمد:
  //     left join (select "offeringId", count(*) from enrollments
  //                 where status <> 'DROPPED' group by "offeringId") e
  //   زیرکوئری با GROUP BY قابلِ pull-up نیست و PostgreSQL شرطِ join را هم به
  //   داخلش هل نمی‌دهد، پس برای نمایشِ کارنامهٔ **یک** استاد، هر ۶۹۱٬۹۵۳ ردیفِ
  //   `enrollments` تجمیع می‌شد. حالا شمارش به‌صورت زیرکوئریِ همبسته در SELECT
  //   است و فقط برای ارائه‌های همان استاد (چند ده ردیف) اجرا می‌شود.
  //   پیش‌نیازِ سرعتش: ایندکسِ `idx_enr_offering` روی `enrollments("offeringId")`
  //   — که تا پیش از این وجود نداشت (فقط ایندکسِ جزئیِ «نمراتِ قطعی‌نشده» بود و
  //   predicateش با `status <> 'DROPPED'` جور درنمی‌آید).
  const [teach] = (await db.execute(sql`
    with ${OWNERSHIP_CTE}
    select count(distinct o.id)::int as offerings,
           coalesce(sum((
             select count(*) from enrollments e
              where e."offeringId" = o.id and e.status <> 'DROPPED'
           )), 0)::int as students,
           coalesce(string_agg(distinct c.code, '، '), '—') as courses
      from ownership ow
      join course_offerings o on o.id = ow.offering_id and o."termId" = ${term.id}
      join courses c on c.id = o."courseId"
     where ow.staff_id = ${staffId}
  `)).rows as unknown as { offerings: number; students: number; courses: string }[];

  // ── ۲) جلسات (یک GROUP BY) ──
  const sessionRows = (await db.execute(sql`
    with ${OWNERSHIP_CTE}
    select cs.status as status, count(*)::int as n, coalesce(sum(cs."isMakeUpSession"), 0)::int as makeup
      from class_sessions cs
      join ownership ow on ow.offering_id = cs."offeringId"
      join course_offerings o on o.id = cs."offeringId" and o."termId" = ${term.id}
     where ow.staff_id = ${staffId}
     group by cs.status
  `)).rows as unknown as { status: string; n: number; makeup: number }[];
  const held = sessionRows.filter(r => r.status === 'HELD').reduce((a, r) => a + r.n, 0);
  const absent = sessionRows.filter(r => r.status === 'ABSENT').reduce((a, r) => a + r.n, 0);
  const makeUp = sessionRows.reduce((a, r) => a + r.makeup, 0);
  const scheduled = sessionRows.reduce((a, r) => a + r.n, 0);

  // ── ۳) وضعیت نمرات (یک GROUP BY) ──
  const gradeRows = (await db.execute(sql`
    with ${OWNERSHIP_CTE}
    select en."gradeStatus" as st, count(*)::int as n
      from enrollments en
      join ownership ow on ow.offering_id = en."offeringId"
      join course_offerings o on o.id = en."offeringId" and o."termId" = ${term.id}
     where ow.staff_id = ${staffId} and en.status <> 'DROPPED'
     group by en."gradeStatus"
  `)).rows as unknown as { st: string; n: number }[];
  const gradesTotal = gradeRows.reduce((a, r) => a + r.n, 0);
  const gradesPending = gradeRows.filter(r => r.st === 'PENDING').reduce((a, r) => a + r.n, 0);
  const gradesEntered = gradesTotal - gradesPending;

  // مهلتِ نزدیک‌ترین درسِ همین استاد — با همان CTEِ مالکیت.
  // ⚠ قبلاً به‌صورت `o."professorId" = X OR exists (...)` نوشته شده بود؛ برای
  //   PostgreSQL قابلِ hash join نیست و به nested loop روی حاصل‌ضربِ
  //   course_offerings × offering_professors می‌افتد (همان الگویی که کوئریِ
  //   گلوگاهِ حقوق را ۱ تا ۵ ثانیه‌ای کرده بود). `min()` از تکرار اثر نمی‌گیرد،
  //   پس unionِ یکتاسازِ OWNERSHIP_CTE دقیقاً همان نتیجه را می‌دهد.
  const [deadlineRow] = (await db.execute(sql`
    with ${OWNERSHIP_CTE}
    select min(coalesce(o."customGradeDeadline", t."gradeEntryDeadline")) as deadline
      from ownership ow
      join course_offerings o on o.id = ow.offering_id and o."termId" = ${term.id}
      join academic_terms t on t.id = o."termId"
     where ow.staff_id = ${staffId}
  `)).rows as unknown as { deadline: Date | string | null }[];

  const [appealsRow] = (await db.execute(sql`
    with ${OWNERSHIP_CTE}
    select count(*)::int as n
      from grade_appeals ga
      join enrollments en on en.id = ga."enrollmentId"
      join ownership ow on ow.offering_id = en."offeringId"
      join course_offerings o on o.id = en."offeringId" and o."termId" = ${term.id}
     where ow.staff_id = ${staffId} and ga.status = 'OPEN'
  `)).rows as unknown as { n: number }[];

  // ── ۴) کارتابل: همهٔ اساتید یک‌جا (یک GROUP BY) → من + میانگین همکاران + رتبه ──
  const deskRows = (await db.execute(sql`
    select l."actorStaffId" as "staffId",
           count(*) filter (where l."completedAt" is not null
                              and l."completedAt" >= date_trunc('month', now()))::int as this_month,
           count(*) filter (where l."completedAt" is not null
                              and l."completedAt" >= date_trunc('month', now()) - interval '1 month'
                              and l."completedAt" <  date_trunc('month', now()))::int as prev_month,
           avg(case when l."completedAt" is not null and l."assignedAt" is not null
                    then coalesce(l."durationMinutes",
                                  extract(epoch from (l."completedAt" - l."assignedAt")) / 60.0)
               end)::numeric as mttr_minutes,
           count(*) filter (where l."completedAt" is not null)::int as completed,
           count(*) filter (where l."completedAt" is not null
                              and coalesce(l."slaStatus", 'ON_TIME') in ('ON_TIME', 'WARNING'))::int as on_time,
           count(*) filter (where coalesce(l."slaStatus", '') in ('SLA_BREACHED', 'ESCALATED'))::int as breached,
           count(*) filter (where l."completedAt" is null)::int as open_queue,
           avg(l."satisfactionScore") filter (where l."satisfactionScore" is not null)::numeric as csat,
           count(l."satisfactionScore")::int as reviews
      from request_step_logs l
     where l."actorStaffId" is not null
     group by l."actorStaffId"
  `)).rows as unknown as {
    staffId: number; this_month: number; prev_month: number; mttr_minutes: string | null;
    completed: number; on_time: number; breached: number; open_queue: number; csat: string | null; reviews: number;
  }[];

  const mine = deskRows.find(r => Number(r.staffId) === staffId);
  const mttrOf = (r: (typeof deskRows)[number]) => (r.mttr_minutes == null ? null : Number(r.mttr_minutes) / 60);
  const slaOf = (r: (typeof deskRows)[number]) => (r.completed > 0 ? Math.round((r.on_time / r.completed) * 1000) / 10 : null);

  const responders = deskRows.filter(r => (r.completed ?? 0) > 0);
  const mttrs = responders.map(mttrOf).filter((v): v is number => v != null);
  const slas = responders.map(slaOf).filter((v): v is number => v != null);
  const sortedByMttr = [...responders].sort((a, b) => (mttrOf(a) ?? Infinity) - (mttrOf(b) ?? Infinity));

  // ── ۵) ارزشیابی: از داشبورد کش‌شدهٔ BI (یک خواندن کش برای همهٔ اساتید) ──
  const overview = await managementOverview();
  const myEval = overview.list.find(r => r.staffId === staffId) ?? null;
  const evalRank = myEval
    ? overview.list.filter(r => r.score > myEval.score).length + 1
    : null;
  // میانگین گروه آموزشی — یک کوئری تجمیعی (به‌جای صدا زدن professorPanel که
  // نمرهٔ دوره‌ها، پاسخ‌دهندگان و ابر کلمات را دوباره محاسبه می‌کرد)
  const [deptRow] = (await db.execute(sql`
    with ${OWNERSHIP_CTE}
    select avg(qo."scoreValue")::numeric as dept
      from evaluation_responses r
      join course_offerings o on o.id = r."offeringId" and o."termId" = ${term.id}
      join ownership ow on ow.offering_id = r."offeringId"
      join evaluation_questions q on q.id = r."questionId"
      join evaluation_forms f on f.id = q."formId"
      join question_options qo on qo.id = r."selectedOptionId"
      join staff s2 on s2.id = ow.staff_id
     where f."targetType" = 'PROFESSOR'
       and q."questionType" = 'SINGLE_CHOICE'
       and s2."departmentId" = (select "departmentId" from staff where id = ${staffId})
  `)).rows as unknown as { dept: string | null }[];

  const responseRank = mine && mine.completed > 0
    ? sortedByMttr.findIndex(r => Number(r.staffId) === staffId) + 1
    : null;

  const evalScore = myEval?.score ?? null;
  const slaOnTimePercent = mine ? slaOf(mine) : null;
  const mttrHours = mine ? round1(mttrOf(mine)) : null;
  const heldRate = held + absent > 0 ? pct(held, held + absent) : null;
  const gradeCompletion = pct(gradesEntered, gradesTotal);
  const growth = mine && mine.prev_month > 0
    ? Math.round(((mine.this_month - mine.prev_month) / mine.prev_month) * 1000) / 10
    : null;

  // ── ۶) نشان و پاداش (بر پایهٔ آستانه‌های تنظیم‌شدنی، نه عدد ثابت) ──
  const evalOk = evalScore != null && evalScore >= evalTarget;
  const slaOk = slaOnTimePercent != null && slaOnTimePercent >= slaTarget;
  const holdOk = heldRate == null || heldRate >= holdTarget;
  const gradesOk = gradesTotal === 0 || gradesPending === 0;

  const level: ProfessorPerformance['badge']['level'] =
    evalOk && slaOk ? 'DIAMOND' : evalOk || slaOk ? 'GOLD' : evalScore != null ? 'SILVER' : 'BRONZE';
  const badgeTitle = {
    DIAMOND: 'استاد ممتاز ترم',
    GOLD: 'عملکرد قابل تقدیر',
    SILVER: 'در مسیر بهبود',
    BRONZE: 'در انتظار نخستین ارزشیابی',
  }[level];

  const reasons: string[] = [];
  if (!evalOk) reasons.push(evalScore == null ? 'نمرهٔ ارزشیابی ثبت نشده است' : `نمرهٔ ارزشیابی ${fa(evalScore)} زیر هدف ${fa(evalTarget)} است`);
  if (!slaOk) reasons.push(slaOnTimePercent == null ? 'پروندهٔ مختومه‌ای برای سنجش SLA ندارید' : `پایبندی SLA برابر ${fa(slaOnTimePercent)}٪ زیر هدف ${fa(slaTarget)}٪ است`);
  if (!holdOk) reasons.push(`نرخ برگزاری جلسات ${fa(heldRate)}٪ زیر هدف ${fa(holdTarget)}٪ است`);
  if (!gradesOk) reasons.push(`${fa(gradesPending)} نمرهٔ ثبت‌نشده در کارنامه دارید`);

  return {
    staffId,
    staffCode: me.code,
    fullName: me.name,
    academicRank: me.rank,
    departmentName: me.department,
    term: term.title,
    period: overview.period,

    teaching: {
      offerings: Number(teach?.offerings ?? 0),
      students: Number(teach?.students ?? 0),
      courses: (teach?.courses ?? '—').split('، ').filter(Boolean),
    },
    sessions: { held, absent, makeUp, scheduled, heldRate, holdTarget },
    grades: {
      entered: gradesEntered,
      pending: gradesPending,
      total: gradesTotal,
      completionPercent: gradeCompletion,
      deadline: deadlineRow?.deadline ? new Date(deadlineRow.deadline as string).toISOString().slice(0, 10) : null,
      appealsOpen: Number(appealsRow?.n ?? 0),
    },
    desk: {
      resolvedThisMonth: Number(mine?.this_month ?? 0),
      resolvedPrevMonth: Number(mine?.prev_month ?? 0),
      growthPercent: growth,
      mttrHours,
      slaOnTimePercent,
      slaBreached: Number(mine?.breached ?? 0),
      openQueue: Number(mine?.open_queue ?? 0),
      csat: mine?.csat == null ? null : round2(Number(mine.csat)),
      reviews: Number(mine?.reviews ?? 0),
      slaTarget,
    },
    evaluation: {
      score: evalScore,
      respondents: myEval?.respondents ?? 0,
      deptAvg: deptRow?.dept == null ? null : Math.round(Number(deptRow.dept) * 100) / 100,
      trend: myEval?.trend ?? [],
      evalTarget,
    },
    peers: {
      count: overview.list.length,
      evalRank,
      responseRank: (responseRank ?? 0) > 0 ? responseRank : null,
      responders: responders.length,
      avgMttrHours: mttrs.length ? round1(mttrs.reduce((a, b) => a + b, 0) / mttrs.length) : null,
      avgSlaOnTimePercent: slas.length ? round1(slas.reduce((a, b) => a + b, 0) / slas.length) : null,
      avgEvalScore: overview.avgScore,
    },
    badge: { title: badgeTitle, level },
    incentive: { eligible: evalOk && slaOk && holdOk && gradesOk, percent: incentivePercent, reasons },
  };
}
