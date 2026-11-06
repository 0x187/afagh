import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  academic_terms, course_offerings, courses, enrollments, students, tuition_term_tariff,
} from '@/db/schema';
import { toNum } from '@/lib/finance-rules';
import { pickTariffRate, tariffAmountOrZero, tariffCourseAmount, type TariffLine, type TariffRate } from '@/lib/tuition-tariff-core';

export type { TariffLine, TariffRate } from '@/lib/tuition-tariff-core';
export { pickTariffRate, tariffCourseAmount, tariffAmountOrZero } from '@/lib/tuition-tariff-core';

/**
 * بازتولید ریز شهریهٔ متغیر دروس بر پایهٔ «تعرفهٔ تفصیلی سما».
 *
 * سامانهٔ مبدأ (سما) شهریهٔ هر درس را این‌گونه می‌ساخته:
 *
 *     مبلغ درس = واحدهای نظری × Th(نوع درس مالی) + واحدهای عملی × OP(نوع درس مالی)
 *
 * و Th/OP برای هر (نیمسال، رشته، سالِ ورود) جداگانه تعریف می‌شده است. بنابراین
 * برای این‌که ریز کارنامهٔ مالی با کارنامهٔ رسمیِ همان نیمسال (سند دانشگاه)
 * ریال‌به‌ریال بخواند، باید همان تعرفه و همان «نوع درس مالی» به کار برود.
 *
 * ⚠️ موتور `tuition_rules` عمداً دست‌نخورده مانده: آن موتور با سه نرخ (نظری/عملی/
 * عمومی) شهریهٔ نیمسال‌های جاری/آینده را می‌سازد و «نوع درس مالی» و «نیمسال» را
 * نمی‌شناسد. این ماژول فقط برای ریزِ نیمسال‌هایی است که تعرفهٔ تفصیلی‌شان موجود
 * است؛ در نبود تعرفه، لایهٔ فراخوان به موتور برمی‌گردد.
 */

/** فرادادهٔ تعرفهٔ هر نیمسال — همان کد گروهی که نرخها از آن خوانده شدند. */
export interface TariffTermMeta {
  /** «کد گروه تعرفه» (tuition_term_tariff.uPriceCode) بهازای هر نیمسال */
  groupCodes: Record<number, string | null>;
}

/**
 * ریز شهریهٔ متغیر دروس بر پایهٔ تعرفهٔ تفصیلی، برای چند نیمسال.
 * هر نیمسال بدون تعرفه در نتیجه نمیآید (کلید غایب) تا فراخوان از موتور استفاده کند.
 * meta اختیاری است: کد گروه تعرفهٔ هر نیمسال را بدون پرسوجوی اضافه برمیگرداند.
 */
export async function computeTariffCourseLinesForTerms(
  studentId: number,
  termIds: number[],
  meta?: TariffTermMeta,
): Promise<Record<number, TariffLine[]>> {
  const ids = [...new Set((termIds || []).filter((t) => Number.isFinite(t) && t > 0))];
  if (!ids.length) return {};
  // هر نیمسال ابتدا «بدون کد» فرض میشود؛ اگر تعرفهای یافت شد پر میشود.
  if (meta) for (const id of ids) meta.groupCodes[id] = null;

  const [stu] = await db
    .select({ majorId: students.majorId, entryYear: students.entryYear, universityId: students.universityId })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!stu?.universityId || !stu.majorId || !stu.entryYear) return {};

  const termRows = await db
    .select({ id: academic_terms.id, termCode: academic_terms.termCode })
    .from(academic_terms)
    .where(inArray(academic_terms.id, ids));
  const codeById = new Map<number, string>();
  for (const t of termRows) {
    const code = String(t.termCode ?? '').trim();
    if (code) codeById.set(t.id, code);
  }
  if (!codeById.size) return {};

  const rateRows = await db
    .select({
      termYear: tuition_term_tariff.termYear,
      termCode: tuition_term_tariff.termCode,
      maliType: tuition_term_tariff.maliType,
      th: tuition_term_tariff.thPrice,
      op: tuition_term_tariff.opPrice,
      uPriceCode: tuition_term_tariff.uPriceCode,
    })
    .from(tuition_term_tariff)
    .where(and(
      eq(tuition_term_tariff.universityId, stu.universityId),
      eq(tuition_term_tariff.majorId, stu.majorId),
      eq(tuition_term_tariff.entryYear, stu.entryYear),
    ));
  // کلید تطبیق «سالِ تعرفه» است (نرخ سما سالانه است، نه هر نیمسال)
  const byYear = new Map<number, Map<number, TariffRate>>();
  // رأیگیریِ «کد گروه تعرفه» برای هر سال: ردیفها بهازای هر نوع درس مالی تکرار
  // میشوند؛ پرتکرارترین کد همان گروه تعرفهای است که نرخها از آن آمدند.
  const groupVotes = new Map<number, Map<string, number>>();
  for (const r of rateRows) {
    const raw = r.termYear ?? Number(String(r.termCode ?? '').slice(0, 4));
    const year = Number(raw);
    if (!Number.isFinite(year) || year <= 0) continue;
    const m = byYear.get(year) || new Map<number, TariffRate>();
    m.set(Number(r.maliType), { th: toNum(r.th), op: toNum(r.op) });
    byYear.set(year, m);
    const code = String(r.uPriceCode ?? '').trim();
    if (code) {
      const votes = groupVotes.get(year) || new Map<string, number>();
      votes.set(code, (votes.get(code) ?? 0) + 1);
      groupVotes.set(year, votes);
    }
  }
  if (meta) {
    const groupByYear = new Map<number, string>();
    for (const [year, votes] of groupVotes) {
      let best = '';
      let bestN = 0;
      for (const [code, n] of votes) {
        if (n > bestN) { best = code; bestN = n; }
      }
      if (best) groupByYear.set(year, best);
    }
    for (const [termId, code] of codeById) {
      meta.groupCodes[termId] = groupByYear.get(Number(String(code).slice(0, 4))) ?? null;
    }
  }
  if (!byYear.size) return {};

  const rows = await db
    .select({
      termId: course_offerings.termId,
      courseCode: courses.code,
      courseTitle: courses.title,
      units: courses.units,
      theoreticalUnits: courses.theoreticalUnits,
      practicalUnits: courses.practicalUnits,
      legacyMaliType: courses.legacyMaliType,
    })
    .from(enrollments)
    .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    // درسِ منتقل‌شده از دانشگاه دیگر شهریه‌اش آنجا پرداخت شده — مثل موتور شهریه.
    .where(and(
      eq(enrollments.studentId, studentId),
      inArray(course_offerings.termId, ids),
      isNull(enrollments.sourceUniversityId),
    ));

  const out: Record<number, TariffLine[]> = {};
  // نیمسال‌هایی که تعرفهٔ سالشان موجود است «پوشش‌داده‌شده»اند (حتی اگر درس ثبت‌شده‌ای
  // نداشته باشند) تا فراخوان برایشان سراغ موتور نرود و مبنای ریز یکدست بماند.
  for (const [termId, code] of codeById) {
    const year = Number(String(code).slice(0, 4));
    if (byYear.has(year)) out[termId] = [];
  }
  for (const r of rows) {
    const code = codeById.get(r.termId);
    if (!code) continue;
    const rates = byYear.get(Number(String(code).slice(0, 4)));
    if (!rates) continue;
    const theoryUnits = toNum(r.theoreticalUnits);
    const practicalUnits = toNum(r.practicalUnits);
    const maliType = r.legacyMaliType ?? null;
    const rate = pickTariffRate(rates, maliType);
    // بی‌نرخ = صفر، عیناً مثل سند رسمی (درسِ بدون «نوع درس مالی» شارژ نمی‌شود)
    const amount = tariffAmountOrZero(theoryUnits, practicalUnits, rate);
    const units = toNum(r.units);
    const list = out[r.termId] || [];
    list.push({
      courseCode: r.courseCode,
      courseTitle: r.courseTitle,
      units,
      theoryUnits,
      practicalUnits,
      maliType,
      perUnit: units > 0 ? Math.round(amount / units) : 0,
      amount,
    });
    out[r.termId] = list;
  }
  return out;
}
