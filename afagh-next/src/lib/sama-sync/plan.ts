/**
 * موتور تطبیق سما → آفاق (خالص، بدون پایگاه داده).
 *
 * ورودی: دو «عکسِ لحظه‌ای» (snapshot) از دو سامانه.
 * خروجی: یک `SyncPlan` که هم فهرستِ عمل‌های بی‌خطر را دارد و هم فهرستِ
 * اختلاف‌هایی که تصمیمِ انسانی می‌خواهند. هیچ‌چیز در این فایل نمی‌نویسد؛
 * همین باعث می‌شود dry-run و تست بدون Postgres ممکن باشد.
 *
 * ── قواعدی که از تجربهٔ تلخِ همگام‌سازی‌های دستی آمده‌اند ──
 *
 *  ۱) **ارائهٔ تکراری**: ترم ۱۴۰۵۱ چند ارائهٔ هم‌کلید داشت (گروه‌های واقعی
 *     ۱–۸ در کنارِ ارائهٔ خالیِ گروه ۳۰/۶۰ که از مهاجرت مانده بود). اگر موتور
 *     «اولین تطبیق» را بردارد، ثبت‌نام‌ها روی ارائهٔ خالی می‌نشینند و شمارشِ
 *     ظرفیتِ کلاس غلط می‌شود. قاعده: ارائه‌ای انتخاب می‌شود که **دانشجو دارد**؛
 *     در تساوی، فعال‌تر و سپس کوچک‌ترین شناسه.
 *  ۲) **گروه متفاوت**: اگر دانشجو همان درس را در گروه دیگری دارد، «واحد
 *     تکراری» نمی‌سازیم. جابه‌جاییِ گروه تصمیمِ آموزش است (تغییر استاد/سایت)،
 *     پس فقط گزارش می‌شود.
 *  ۳) **حذف هرگز خودکار نیست**: واحدِ اضافی در آفاق می‌تواند «انصراف در سما»
 *     باشد یا «ثبت‌نام تازه در آفاق که هنوز به سما نرفته». تفکیکِ این دو از
 *     روی فایل ممکن نیست ⇒ فقط گزارش.
 *  ۴) **دانشجوی گم‌شده**: کد دانشجو در آفاق چند رکورد دارد (بین دانشگاه‌ها
 *     تکراری است) ⇒ تطبیق فقط داخل `universityId` همین دانشگاه انجام می‌شود
 *     و اگر باز هم چند رکورد بود، «مبهم» علامت می‌خورد و هیچ نوشتنی رخ نمی‌دهد.
 */

import type {
  AfaghSnapshot, SamaSnapshot, SyncAction, SyncIssue, SyncPlan, SyncStats,
} from './types';
import {
  courseKey, enrollKey, groupNumber, offeringKey, parseGrade,
  studentCourseKey, studentKey, termKey,
} from './normalize';

/** انتخابِ ارائهٔ درست از میانِ چند ارائهٔ هم‌کلید. */
function pickBestOffering<T extends { id: number; isActive: number; enrolledCount: number }>(list: T[]): T {
  return [...list].sort((a, b) => {
    if (b.enrolledCount !== a.enrolledCount) return b.enrolledCount - a.enrolledCount;
    if (b.isActive !== a.isActive) return b.isActive - a.isActive;
    return a.id - b.id;
  })[0];
}

const emptyStats = (): SyncStats => ({
  samaEnrollmentRows: 0,
  samaUniqueStudents: 0,
  samaUniqueOfferings: 0,
  afaghEnrollmentRows: 0,
  matched: 0,
  addEnrollment: 0,
  fillGrade: 0,
  groupMismatch: 0,
  offeringMissing: 0,
  extraEnrollment: 0,
  studentMissing: 0,
  studentAmbiguous: 0,
  duplicateOffering: 0,
});

export function buildPlan(sama: SamaSnapshot, afagh: AfaghSnapshot): SyncPlan {
  const issues: SyncIssue[] = [];
  const actions: SyncAction[] = [];
  const warnings: string[] = [...sama.warnings];
  const stats = emptyStats();
  stats.afaghEnrollmentRows = afagh.enrollments.length;

  const term = termKey(sama.termCode || afagh.termCode);

  /* ── ۱) فهرست دانشجویان آفاق (فقط همین دانشگاه) ── */
  const studentsByKey = new Map<string, { id: number; status: string }[]>();
  for (const s of afagh.students) {
    const k = studentKey(s.studentCode);
    if (!k) continue;
    const list = studentsByKey.get(k) ?? [];
    list.push({ id: s.id, status: s.status });
    studentsByKey.set(k, list);
  }

  /* ── ۲) فهرست ارائه‌های آفاق ── */
  const offeringsByKey = new Map<string, { id: number; groupNumber: number; isActive: number; enrolledCount: number; courseCode: string }[]>();
  for (const o of afagh.offerings) {
    const k = offeringKey(o.termCode, o.courseCode, o.groupNumber);
    const list = offeringsByKey.get(k) ?? [];
    list.push({
      id: o.id, groupNumber: o.groupNumber, isActive: o.isActive,
      enrolledCount: o.enrolledCount, courseCode: o.courseCode,
    });
    offeringsByKey.set(k, list);
  }
  const chosenOffering = new Map<string, { id: number; groupNumber: number }>();
  for (const [k, list] of offeringsByKey) {
    const best = pickBestOffering(list);
    chosenOffering.set(k, { id: best.id, groupNumber: best.groupNumber });
    if (list.length > 1) {
      stats.duplicateOffering++;
      issues.push({
        code: 'DUPLICATE_OFFERING',
        message: `ارائهٔ تکراری برای «${k.split('|')[1]}» گروه ${k.split('|')[2]}: ${list.length} ردیف — `
          + `ارائهٔ ${best.id} (${best.enrolledCount} ثبت‌نام) انتخاب شد`,
        courseCode: k.split('|')[1],
        groupNumber: Number(k.split('|')[2]) || null,
        offeringId: best.id,
      });
    }
  }

  /* ── ۳) ثبت‌نام‌های موجود آفاق ── */
  const enrollByPair = new Map<string, { id: number; gradeValue: string | null }>();
  /** دانشجو → درس → ثبت‌نام (برای تشخیص اختلافِ گروه) */
  const enrollByStudentCourse = new Map<string, { id: number; offeringId: number }[]>();
  const offeringById = new Map(afagh.offerings.map((o) => [o.id, o]));
  for (const e of afagh.enrollments) {
    enrollByPair.set(`${e.studentId}|${e.offeringId}`, { id: e.id, gradeValue: e.gradeValue });
    const off = offeringById.get(e.offeringId);
    if (!off) continue;
    const k = `${e.studentId}|${courseKey(off.courseCode)}`;
    const list = enrollByStudentCourse.get(k) ?? [];
    list.push({ id: e.id, offeringId: e.offeringId });
    enrollByStudentCourse.set(k, list);
  }

  /* ── ۴) سما: ردیف‌های یکتا ── */
  const samaByKey = new Map<string, { row: SamaSnapshot['enrollments'][number]; grade: number | null }>();
  for (const row of sama.enrollments) {
    if (!termKey(row.termCode) || termKey(row.termCode) !== term) continue; // ترمِ دیگر
    const k = enrollKey(row.studentCode, row.termCode, row.courseCode, row.groupNumber);
    const g = parseGrade(row.grade);
    const prev = samaByKey.get(k);
    // ردیفِ تکراری: نمرهٔ موجود را از دست نده
    if (!prev) samaByKey.set(k, { row, grade: g });
    else if (prev.grade == null && g != null) samaByKey.set(k, { row, grade: g });
  }
  stats.samaEnrollmentRows = samaByKey.size;

  const samaStudents = new Set<string>();
  const samaOfferings = new Set<string>();
  const missingStudents = new Set<string>();
  const ambiguousStudents = new Set<string>();

  for (const { row, grade } of samaByKey.values()) {
    const sKey = studentKey(row.studentCode);
    const cKey = courseKey(row.courseCode);
    if (!sKey || !cKey) {
      warnings.push(`ردیف نامعتبر در سما نادیده گرفته شد: دانشجو «${row.studentCode}» درس «${row.courseCode}»`);
      continue;
    }
    samaStudents.add(sKey);
    samaOfferings.add(`${cKey}|${groupNumber(row.groupNumber) ?? ''}`);

    /* دانشجو */
    const candidates = studentsByKey.get(sKey) ?? [];
    if (candidates.length === 0) {
      if (!missingStudents.has(sKey)) {
        missingStudents.add(sKey);
        stats.studentMissing++;
        issues.push({
          code: 'ADD_STUDENT',
          message: `دانشجو ${sKey} در سما واحد دارد ولی در آفاق ثبت نشده است`,
          studentCode: sKey,
        });
      }
      continue;
    }
    if (candidates.length > 1) {
      if (!ambiguousStudents.has(sKey)) {
        ambiguousStudents.add(sKey);
        stats.studentAmbiguous++;
        issues.push({
          code: 'STUDENT_AMBIGUOUS',
          message: `کد دانشجو ${sKey} در آفاق ${candidates.length} رکورد دارد — تطبیق انجام نشد`,
          studentCode: sKey,
          to: candidates.map((c) => c.id).join('، '),
        });
      }
      continue;
    }
    const studentId = candidates[0].id;

    /* ارائه */
    const oKey = offeringKey(row.termCode, row.courseCode, row.groupNumber);
    const off = chosenOffering.get(oKey);
    if (!off) {
      stats.offeringMissing++;
      issues.push({
        code: 'OFFERING_MISSING',
        message: `درس ${cKey} گروه ${groupNumber(row.groupNumber) ?? '—'} در ترم ${term} ارائه ندارد — `
          + `ثبت‌نامِ دانشجو ${sKey} انجام نشد`,
        studentCode: sKey,
        courseCode: cKey,
        groupNumber: groupNumber(row.groupNumber),
        studentId,
      });
      continue;
    }

    /* ثبت‌نام موجود؟ */
    const existing = enrollByPair.get(`${studentId}|${off.id}`);
    if (existing) {
      stats.matched++;
      if (grade != null) {
        const current = existing.gradeValue == null ? null : Number(existing.gradeValue);
        if (current == null) {
          stats.fillGrade++;
          actions.push({
            kind: 'FILL_GRADE',
            studentId, offeringId: off.id, enrollmentId: existing.id,
            studentCode: sKey, courseCode: cKey, groupNumber: off.groupNumber,
            termCode: term, grade,
            originalSamaCode: cKey,
          });
        } else if (Math.abs(current - grade) > 0.001) {
          issues.push({
            code: 'STATUS_MISMATCH',
            message: `نمرهٔ درس ${cKey} برای ${sKey} در آفاق ${current} و در سما ${grade} است — بازنویسی نشد`,
            studentCode: sKey, courseCode: cKey, groupNumber: off.groupNumber,
            studentId, offeringId: off.id, enrollmentId: existing.id,
            from: current, to: grade,
          });
        }
      }
      continue;
    }

    /* همان درس در گروه دیگر؟ */
    const sameCourse = enrollByStudentCourse.get(`${studentId}|${cKey}`) ?? [];
    if (sameCourse.length > 0) {
      const other = offeringById.get(sameCourse[0].offeringId);
      stats.groupMismatch++;
      issues.push({
        code: 'GROUP_MISMATCH',
        message: `دانشجو ${sKey} درس ${cKey} را در آفاق گروه ${other?.groupNumber ?? '—'} دارد ولی سما گروه `
          + `${groupNumber(row.groupNumber) ?? '—'} می‌گوید — جابه‌جایی خودکار انجام نشد`,
        studentCode: sKey, courseCode: cKey, groupNumber: groupNumber(row.groupNumber),
        studentId, offeringId: off.id, enrollmentId: sameCourse[0].id,
        from: other?.groupNumber ?? null, to: groupNumber(row.groupNumber),
      });
      continue;
    }

    /* افزودنیِ محض */
    stats.addEnrollment++;
    actions.push({
      kind: 'INSERT_ENROLLMENT',
      studentId, offeringId: off.id,
      studentCode: sKey, courseCode: cKey, groupNumber: off.groupNumber,
      termCode: term, originalSamaCode: cKey,
      // نمره‌ای که سما برای همین واحد دارد هم همراه می‌آید؛ وگرنه ثبت‌نامِ
      // بدونِ نمره ساخته می‌شود و کارنامه بی‌دلیل ناقص می‌ماند.
      grade,
    });
  }

  stats.samaUniqueStudents = samaStudents.size;
  stats.samaUniqueOfferings = samaOfferings.size;

  /* ── ۵) واحدهای اضافیِ آفاق (فقط گزارش) ── */
  const samaPairs = new Set<string>();
  for (const { row } of samaByKey.values()) {
    const sKey = studentKey(row.studentCode);
    const candidates = studentsByKey.get(sKey) ?? [];
    if (candidates.length !== 1) continue;
    const oKey = offeringKey(row.termCode, row.courseCode, row.groupNumber);
    const off = chosenOffering.get(oKey);
    if (!off) continue;
    samaPairs.add(`${candidates[0].id}|${off.id}`);
  }
  for (const e of afagh.enrollments) {
    if (e.status === 'DROPPED') continue;
    if (samaPairs.has(`${e.studentId}|${e.offeringId}`)) continue;
    const off = offeringById.get(e.offeringId);
    stats.extraEnrollment++;
    issues.push({
      code: 'EXTRA_ENROLLMENT',
      message: `ثبت‌نام ${e.id} (دانشجو ${e.studentId}، درس ${off?.courseCode ?? '—'} گروه ${off?.groupNumber ?? '—'}) `
        + `در سما نیست — حذف خودکار انجام نمی‌شود`,
      studentId: e.studentId,
      offeringId: e.offeringId,
      enrollmentId: e.id,
      courseCode: off?.courseCode,
      groupNumber: off?.groupNumber ?? null,
    });
  }

  return {
    universityId: afagh.universityId,
    termCode: term,
    termId: afagh.termId,
    actions,
    issues,
    stats,
    warnings,
  };
}

/** شمارشِ اختلاف‌ها بر اساس کد — برای کارت‌های خلاصه. */
export function countByCode(plan: SyncPlan): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of plan.issues) out[i.code] = (out[i.code] ?? 0) + 1;
  return out;
}
