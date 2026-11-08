import { and, eq, like } from 'drizzle-orm';
import { db } from '@/db';
import { academic_terms, course_offerings, courses, enrollments } from '@/db/schema';
import { parseGrade, parseUnits } from '../regulations-engine';
import { chargeTermTuition, getEquivFixedMode } from '../tuition-engine';
import { shouldChargeFixed } from '../tuition-rules';
import { EQUIV_MIN_GRADE, EQUIV_TERM_UNITS } from './constants';
import { NO_UNIVERSITY_MSG, resolveTargetCourse, type EnrollDb } from './transfer';
import { effectiveEquivLimits, equivalencyGate } from '@/lib/compliance-integrations';
import { resolveStudentCurriculum } from '@/lib/curriculum-apply';

// ══════════════════════════════════════════════════════════════════
//  ثبت دسته‌ای معادل‌سازی — پس از تأیید مدیر گروه و مدیرکل آموزش
//
//  طبق دستور: هر ۲۰ واحد معادل‌سازی‌شده در یک «نیمسال معادل‌سازی» جداگانه
//  ثبت می‌شود که پیش از اولین نیمسال واقعی در کارنامه نمایش داده می‌شود؛
//  وضعیت درس «قبولی در معادل‌سازی پذیرفته شده» است و مشروطیت در این ترم‌ها
//  معنا ندارد. فقط نمرات >= EQUIV_MIN_GRADE ثبت می‌شوند.
// ══════════════════════════════════════════════════════════════════

export type EquivalenceItem = {
  sourceTitle: string;
  sourceGrade: number | string | null;
  sourceUnits: number | string | null;
  targetCourseCode: string;
  headComment?: string | null;
};

export type EquivalenceBatchResult = {
  ok: boolean;
  message: string;
  termsCreated: number;
  chargedTotal?: number;
  registered: { courseTitle: string; termTitle: string; grade: number | null; units: number }[];
  rejected: { sourceTitle: string; reason: string }[];
};

/**
 * ترم معادل‌سازی «۰۰EQn» متعلق به «همان دانشگاه» — ایدمپوتنت.
 *
 * ⚠️ `uq_terms_uni_code` روی (universityId, termCode) است و PostgreSQL NULL را
 * DISTINCT می‌داند؛ پس درج بدون universityId در هر اجرا یک ردیف تکراری
 * «۰۰EQ۱» می‌ساخت و آن ردیف در هیچ گزارش `universityId = n` دیده نمی‌شد.
 * بنابراین: (۱) دامنه در WHERE، (۲) مهر دانشگاه در INSERT، (۳) هدف تعارض
 * صریح روی همان دو ستون، و (۴) بررسی وجود + تراکنش برای اجرای هم‌زمان.
 */
export async function ensureEquivalenceTerm(
  dbx: EnrollDb,
  input: { universityId: number; termCode: string; title: string },
): Promise<typeof academic_terms.$inferSelect | null> {
  const uid = Number(input.universityId);
  const scoped = and(eq(academic_terms.termCode, input.termCode), eq(academic_terms.universityId, uid));
  const inScope = (r: typeof academic_terms.$inferSelect) =>
    r.termCode === input.termCode && Number(r.universityId) === uid;

  return dbx.transaction(async (tx) => {
    const existing = await tx.select().from(academic_terms).where(scoped).limit(1);
    const found = existing.find(inScope);
    if (found) return found;

    const [made] = await tx.insert(academic_terms).values({
      universityId: uid,
      termCode: input.termCode,
      title: input.title,
      termType: 'EQUIVALENCE',
      isCurrent: 0,
      isSummer: 0,
      isEnrollmentOpen: 0,
      startDate: new Date(2000, 0, 1),
      endDate: new Date(2000, 5, 30),
    }).onConflictDoNothing({ target: [academic_terms.universityId, academic_terms.termCode] }).returning();
    if (made) return made;

    // اجرای هم‌زمان: ردیف را همان‌جا و همان‌دامنه دوباره می‌خوانیم
    const [again] = await tx.select().from(academic_terms).where(scoped).limit(1);
    return again && inScope(again) ? again : null;
  });
}

export async function applyEquivalenceBatch(input: {
  studentId: number;
  /** دانشگاه مالکِ دانشجو/چارت مقصد — اجباری: بدون آن کوئری سراسری ممنوع است */
  universityId: number;
  items: EquivalenceItem[];
  previousUniversity?: string;
  workflowRequestId?: number | null;
}): Promise<EquivalenceBatchResult> {
  const registered: EquivalenceBatchResult['registered'] = [];
  const rejected: EquivalenceBatchResult['rejected'] = [];

  if (!Number.isFinite(Number(input.universityId)) || Number(input.universityId) <= 0) {
    return { ok: false, message: NO_UNIVERSITY_MSG, termsCreated: 0, registered, rejected };
  }

  // مادهٔ ۱۲ (الف): حداقل نمره و واحدهای هر نیمسال، مقطعی و قابل اورراید
  const limits = await effectiveEquivLimits(input.studentId);

  // ۱) فیلتر نمره و تطبیق درس مقصد (فقط چارت دانشگاه خودِ دانشجو)
  type Ready = { course: typeof courses.$inferSelect; grade: number; units: number; sourceTitle: string };
  const ready: Ready[] = [];
  for (const it of input.items) {
    const grade = parseGrade(it.sourceGrade);
    if (grade === null || grade < limits.minGrade) {
      rejected.push({ sourceTitle: it.sourceTitle, reason: grade === null ? 'نمره نامعتبر' : `نمرهٔ کمتر از ${limits.minGrade} (غیرقابل معادلسازی)` });
      continue;
    }
    const course = await resolveTargetCourse(db, input.universityId, String(it.targetCourseCode ?? '').trim());
    if (!course) {
      rejected.push({ sourceTitle: it.sourceTitle, reason: `درس مقصد «${it.targetCourseCode}» در چارت دانشگاه یافت نشد` });
      continue;
    }
    const units = parseUnits(it.sourceUnits) || Number(course.units || 0);
    ready.push({ course, grade, units, sourceTitle: it.sourceTitle });
  }

  if (ready.length === 0) {
    return { ok: false, message: 'هیچ درس واجد شرایطی برای معادلسازی یافت نشد.', termsCreated: 0, registered, rejected };
  }

  // اصلاحیهٔ ۲/۱۵۵۶۵۵ + بند ۴ مادهٔ ۱۲: سقف ۵۰٪ فقط برای انصرافی/اخراجی،
  // قاعدهٔ پنج سال از تاریخ انصراف/اخراج، استثنای عدم تغییر برنامهٔ درسی.
  // وقتی دادهٔ پروندهای ثبت نشده باشد، دروازه فقط «هشدار» میدهد و مسدود نمیکند.
  let totalProgramUnits = 0;
  let alreadyEquivalencedUnits = 0;
  try {
    const cv = await resolveStudentCurriculum(input.studentId);
    totalProgramUnits = Number((cv as any)?.version?.totalRequiredUnits ?? 0) || 0;
    const eqRows = await db
      .select({ units: courses.units })
      .from(enrollments)
      .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
      .innerJoin(courses, eq(courses.id, course_offerings.courseId))
      .innerJoin(academic_terms, eq(academic_terms.id, course_offerings.termId))
      .where(and(eq(enrollments.studentId, input.studentId), like(academic_terms.termCode, '%EQ%')));
    alreadyEquivalencedUnits = eqRows.reduce((s, r) => s + (Number(r.units) || 0), 0);
  } catch { /* دادهٔ ناقص ⇒ فقط هشدار */ }
  const verdict = await equivalencyGate(input.studentId, {
    requestedUnits: ready.reduce((s, r) => s + r.units, 0),
    totalProgramUnits,
    alreadyEquivalencedUnits,
  }).catch(() => null);
  if (verdict && !verdict.ok) {
    return { ok: false, message: verdict.reasons.join(' '), termsCreated: 0, registered, rejected };
  }

  // ۲) دسته‌بندی هر ۲۰ واحد در یک ترم معادل‌سازی
  const chunks: Ready[][] = [];
  let cur: Ready[] = [];
  let curUnits = 0;
  for (const r of ready) {
    if (curUnits + r.units > limits.termUnits && cur.length > 0) {
      chunks.push(cur);
      cur = [];
      curUnits = 0;
    }
    cur.push(r);
    curUnits += r.units;
  }
  if (cur.length) chunks.push(cur);

  // ۳) ساخت ترم‌های معادل‌سازی پیش از اولین نیمسال و ثبت دروس
  let termsCreated = 0;
  const equivTermIds: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const termCode = `00EQ${i + 1}`;
    const term = await ensureEquivalenceTerm(db, {
      universityId: input.universityId,
      termCode,
      title: `معادل‌سازی — نوبت ${i + 1}`,
    });
    if (!term) continue;
    termsCreated++;
    equivTermIds.push(term.id);

    for (const r of chunks[i]) {
      let [offering] = await db
        .select()
        .from(course_offerings)
        .where(and(eq(course_offerings.courseId, r.course.id), eq(course_offerings.termId, term.id), eq(course_offerings.offeringType, 'TRANSFER')))
        .limit(1);
      if (!offering) {
        const [made] = await db
          .insert(course_offerings)
          .values({ termId: term.id, courseId: r.course.id, groupNumber: 900, capacity: 500, enrolledCount: 0, offeringType: 'TRANSFER', isActive: 1 })
          .onConflictDoNothing()
          .returning();
        offering = made ?? (await db.select().from(course_offerings).where(and(eq(course_offerings.courseId, r.course.id), eq(course_offerings.termId, term.id), eq(course_offerings.offeringType, 'TRANSFER'))).limit(1))[0];
      }
      if (!offering) continue;

      const [existing] = await db.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.studentId, input.studentId), eq(enrollments.offeringId, offering.id))).limit(1);
      const payload = {
        status: 'EQUIV_PASSED',
        workflowRequestId: input.workflowRequestId ?? null,
        gradeValue: String(r.grade),
        gradeStatus: 'FINALIZED',
      };
      if (existing) {
        await db.update(enrollments).set(payload).where(eq(enrollments.id, existing.id));
      } else {
        await db.insert(enrollments).values({ studentId: input.studentId, offeringId: offering.id, isDirectedReading: 0, ...payload });
      }
      registered.push({ courseTitle: r.course.title, termTitle: term.title, grade: r.grade, units: r.units });
    }
  }

  // ۴) شارژ شهریهٔ معادل‌سازی بر اساس نوع ترم و نوع گذراندن درس (موتور شهریه)
  //
  // شهریهٔ ثابت مطابق سیاست EQUIV_FIXED_TUITION_MODE اعمال می‌شود (قابل تنظیم از
  // پنل مدیر، بدون مقدار سخت‌کد). چون دروس معادل‌سازی هر ۲۰ واحد در یک نیمسال
  // جدا ثبت می‌شوند، بدون این سیاست شهریهٔ ثابت به ازای هر نیمسال تکرار می‌شد
  // (مثلاً ۴۵ واحد = ۳ نیمسال = ۳ برابر شهریهٔ ثابت).
  const fixedMode = await getEquivFixedMode();
  let chargedTotal = 0;
  for (let i = 0; i < equivTermIds.length; i++) {
    const tid = equivTermIds[i];
    try {
      const { charged } = await chargeTermTuition(input.studentId, tid, {
        includeFixed: shouldChargeFixed(fixedMode, i === 0),
      });
      chargedTotal += charged;
    } catch (e) {
      // نبود قاعدهٔ شهریه نباید معادل‌سازی را شکست دهد؛ فقط ثبت نمی‌شود
      console.error('equivalence tuition charge failed', { studentId: input.studentId, termId: tid, e });
    }
  }

  return {
    ok: true,
    message: `${registered.length} درس معادلسازیشده در ${termsCreated} نیمسال معادلسازی (هر ${limits.termUnits} واحد) پیش از اولین ترم ثبت شد.` +
      (chargedTotal > 0 ? ` شهریهٔ معادل‌سازی: ${chargedTotal.toLocaleString('fa-IR')} ریال.` : ''),
    termsCreated,
    chargedTotal,
    registered,
    rejected,
  };
}
