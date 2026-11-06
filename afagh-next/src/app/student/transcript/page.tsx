import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { ReactNode } from 'react';
import { academic_terms, course_offerings, courses, degree_level_configs, educational_regulations, enrollments, grade_objections, majors, process_definitions, student_requests, students, universities, users } from '@/db/schema';
import { db, withUserRls } from '@/db';
import { getStudentByUser, requireRole } from '@/lib/auth';
import { calculateOfficialGPA, getRegulationConfig } from '@/lib/regulations-engine';
import { maskNationalCode, issueTranscriptToken } from '@/lib/verification';
import { getPublicBaseUrl, getSetting } from '@/lib/settings';
import { qrSvg } from '@/lib/qr';
import VerifyQrBlock from '@/components/VerifyQrBlock';
import { isDemoStudentUser } from '@/lib/demo-accounts';
import { DEMO_STUDENT } from '@/lib/demo-student-data';
import { COURSE_TYPE_FA } from '@/lib/student-labels';
import { sortTermsForTranscript, groupTermsByAcademicYear, EQUIVALENCE_GROUP_YEAR } from '@/lib/scheduling-core';
import PrintTranscriptButton from '@/components/PrintTranscriptButton';
import GradeObjectionPanel from './GradeObjectionPanel';

export const dynamic = 'force-dynamic';

const statusFa: Record<string, string> = {
  REGISTERED: 'ثبت قطعی',
  WAITLISTED: 'اتاق انتظار',
  PENDING_COUNCIL: 'در انتظار شورا',
  DROPPED: 'حذف‌شده',
  ABSENT: 'غایب',
  REJECTED: 'مردود',
  ACTIVE: 'مجاز به ادامه تحصیل',
  PROBATION: 'مشروط',
  GRADUATED: 'فارغ‌التحصیل',
};

export default async function StudentTranscriptPage({
  searchParams,
}: {
  searchParams: Promise<{ record?: string; view?: string; term?: string }>;
}) {
  const user = await requireRole(['STUDENT']);
  const picked = await getStudentByUser(user.id);
  if (!picked) return <p className="card p-6 text-center text-slate-500">پروندهٔ دانشجویی یافت نشد.</p>;

  // ── دانش‌آموختهٔ چندمقطعی: یک کاربر می‌تواند چند پرونده داشته باشد
  //    (کاردانی + کارشناسی + ارشد). کارنامهٔ هر مقطع باید جدا و درست بیاید،
  //    و QR هر کارنامه هم همان پرونده را در خود نهفته دارد.
  const myRecords = await db
    .select({
      id: students.id,
      studentCode: students.studentCode,
      status: students.status,
      degreeTitle: degree_level_configs.title,
      entryYear: students.entryYear,
    })
    .from(students)
    .leftJoin(degree_level_configs, eq(degree_level_configs.id, students.degreeLevelId))
    .where(eq(students.userId, user.id))
    .orderBy(desc(students.entryYear), desc(students.id));

  const sp = await searchParams;
  const wantedRecordId = Number(sp?.record ?? 0) || 0;
  let active = picked;
  if (wantedRecordId && wantedRecordId !== picked.id && myRecords.some(r => r.id === wantedRecordId)) {
    const [alt] = await db
      .select()
      .from(students)
      .where(and(eq(students.id, wantedRecordId), eq(students.userId, user.id)))
      .limit(1);
    if (alt) active = alt;
  }
  const me = active;

  const [major] = me.majorId ? await db.select().from(majors).where(eq(majors.id, me.majorId)).limit(1) : [null];
  const [level] = me.degreeLevelId ? await db.select().from(degree_level_configs).where(eq(degree_level_configs.id, me.degreeLevelId)).limit(1) : [null];
  const [uniRow] = me.universityId ? await db.select({ title: universities.title, logoUrl: universities.logoUrl }).from(universities).where(eq(universities.id, me.universityId)).limit(1) : [null];
  const universityLogo = uniRow?.logoUrl || (await getSetting('UNIVERSITY_LOGO').catch(() => '')) || null;
  // نام دانشگاه از رکورد دانشگاه و سپس تنظیمات سراسری — هیچ نامی هاردکد نیست
  const universityTitle = uniRow?.title || (await getSetting('UNIVERSITY_NAME').catch(() => '')) || null;
  const [identity] = await db.select({ nationalCode: users.nationalCode }).from(users).where(eq(users.id, user.id)).limit(1);

  const demo = await isDemoStudentUser(user.id);

  const regRows = me.degreeLevelId
    ? await db.select().from(educational_regulations).where(eq(educational_regulations.degreeLevelId, me.degreeLevelId))
    : [];
  const assignedReg = regRows.find(r => r.id === me.regulationId) ?? null;
  const inWindow = (r: typeof assignedReg) =>
    !!r && r.effectiveFromYear <= me.entryYear && (r.effectiveToYear == null || r.effectiveToYear >= me.entryYear);
  const reg =
    (inWindow(assignedReg) ? assignedReg : null) ??
    regRows.filter(inWindow).sort((a, b) => b.effectiveFromYear - a.effectiveFromYear)[0] ??
    assignedReg;

  const regCfg = await getRegulationConfig(me.regulationId, me.degreeLevelId);
  const regPolicy = regCfg.grading_and_gpa?.failed_course_gpa_policy === 'KEEP_ALWAYS'
    ? 'نگهداری همیشه نمرهٔ ردی در معدل کل'
    : 'حذف نمرهٔ مردودی از معدل کل پس از قبولی مجدد';

  const studyTypeRaw = (me.studyType || me.tuitionType || '').trim();
  const studyTypeFa = studyTypeRaw ? COURSE_TYPE_FA[studyTypeRaw] ?? studyTypeRaw : '—';

  const shownNationalCode = demo ? DEMO_STUDENT.nationalCodeFa : maskNationalCode(identity?.nationalCode);
  const shownLevel = level?.title || (demo ? DEMO_STUDENT.degreeTitle : '—');
  const shownMajor = major?.name || (demo ? DEMO_STUDENT.majorName : '—');
  const shownEntryYear = me.entryYear || (demo ? DEMO_STUDENT.entryYearFa : '—');
  const shownStudyType = demo ? DEMO_STUDENT.studyTypeFa : studyTypeFa;
  const shownRegulation = reg?.title
    || regCfg.grading_and_gpa?.regulationLabel
    || (demo ? DEMO_STUDENT.regulationTitle : 'آیین‌نامهٔ آموزشی دورهٔ تحصیلی');

  // خواندن کلیه سوابق دروس دانشجو از تمام ترم‌ها از مسیر امن RLS
  const allRows = await withUserRls(user.id, tx =>
    tx
      .select({
        id: enrollments.id,
        code: courses.code,
        title: courses.title,
        units: courses.units,
        practicalUnits: courses.practicalUnits,
        courseType: courses.courseType,
        gradingType: courses.gradingType,
        affectsGpa: courses.affectsGpa,
        courseMinMark: courses.minPassedMark,
        status: enrollments.status,
        emergencyWithdrawal: enrollments.emergencyWithdrawal,
        grade: enrollments.gradeValue,
        gradeStatus: enrollments.gradeStatus,
        ev: enrollments.hasEvaluated,
        termId: course_offerings.termId,
        termTitle: academic_terms.title,
        termCode: academic_terms.termCode,
        isCurrent: academic_terms.isCurrent,
      })
      .from(enrollments)
      .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
      .innerJoin(courses, eq(courses.id, course_offerings.courseId))
      .innerJoin(academic_terms, eq(academic_terms.id, course_offerings.termId))
      .where(eq(enrollments.studentId, me.id))
      .orderBy(asc(academic_terms.termCode), desc(enrollments.id))
  );

  // ── دو نمای سند: «کارنامهٔ کل دوره» و «کارنامهٔ نیمسال» ──
  // پیش‌تر فقط فیلترِ سراسریِ ترم (کوکیِ هدر) بود؛ دانشجو نمی‌فهمید سندش کل
  // دوره است یا یک نیمسال و دکمهٔ چاپ هم یکی بود. حالا دو سندِ مستقل با آدرس،
  // عنوان و دکمهٔ چاپ جدا:
  //     /student/transcript                    → کارنامهٔ کل تحصیلی
  //     /student/transcript?view=term&term=ID  → کارنامهٔ همان نیمسال
  const view: 'all' | 'term' = sp?.view === 'term' ? 'term' : 'all';
  const wantedTermId = Number(sp?.term ?? 0) || 0;

  type TermBucket = { termId: number; title: string; termCode: string; isCurrent: boolean; rows: typeof allRows };
  const bucketMap = new Map<number, TermBucket>();
  for (const row of allRows) {
    if (!bucketMap.has(row.termId)) {
      bucketMap.set(row.termId, {
        termId: row.termId, title: row.termTitle, termCode: row.termCode,
        isCurrent: !!row.isCurrent, rows: [],
      });
    }
    bucketMap.get(row.termId)!.rows.push(row);
  }
  const allTermsAsc = sortTermsForTranscript([...bucketMap.values()]);
  const currentBucket = allTermsAsc.find(t => t.isCurrent) ?? allTermsAsc[allTermsAsc.length - 1] ?? null;
  const activeBucket = view === 'term'
    ? (allTermsAsc.find(t => t.termId === wantedTermId) ?? currentBucket)
    : null;
  const scopedRows = activeBucket ? allRows.filter(r => r.termId === activeBucket.termId) : allRows;

  // دسته‌بندی دروس بر اساس ترم‌ها
  const termsMap = new Map<number, TermBucket>();
  for (const row of scopedRows) {
    const base = bucketMap.get(row.termId);
    if (!base) continue;
    if (!termsMap.has(row.termId)) termsMap.set(row.termId, { ...base, rows: [] });
    termsMap.get(row.termId)!.rows.push(row);
  }

  const termsList = Array.from(termsMap.values());

  // نرمال‌سازی و مرتب‌سازی ترم‌ها برای کارنامه
  // ۱. معادل‌سازی‌ها اول می‌آیند
  // ۲. بعد ترم‌های تحصیلی بر اساس سال و نیمسال
  const sortedTerms = sortTermsForTranscript(
    termsList.map(t => ({ termId: t.termId, termCode: t.termCode, title: t.title, isCurrent: t.isCurrent, rows: t.rows }))
  );

  const groupedYears = groupTermsByAcademicYear(
    sortedTerms,
    t => t.rows
  );
  const equivalenceGroups = groupedYears.filter(g => g.academicYear === EQUIVALENCE_GROUP_YEAR);
  const academicYears = [
    ...equivalenceGroups,
    ...groupedYears.filter(g => g.academicYear !== EQUIVALENCE_GROUP_YEAR).reverse(),
  ];

  // محاسبه رسمی معدل کل بر اساس موتور آیین‌نامه‌ها
  let officialGpaData = { gpa: 0, totalUnits: 0, passedUnits: 0, excludedCount: 0, policy: 'EXCLUDE_IF_PASSED' };
  try {
    officialGpaData = await calculateOfficialGPA(me.id);
  } catch (err) {
    console.warn('Error calculating official GPA:', err);
  }

  // محاسبات کل دوره
  let totalEnrolledUnits = 0;
  let totalPassedUnits = officialGpaData.passedUnits;
  let totalGradedUnits = officialGpaData.totalUnits;
  let failedUnits = 0;

  for (const r of allRows) {
    const u = Number(r.units || 0);
    if (r.status === 'REGISTERED' || r.status === 'PENDING_COUNCIL') {
      totalEnrolledUnits += u;
    }
    const isDescriptive = r.gradingType === 'DESCRIPTIVE' || Number(r.grade) === 1 || r.affectsGpa === 0;
    if (isDescriptive) {
      if (r.grade != null && Number(r.grade) === 0) failedUnits += u;
    } else {
      if (r.grade != null && Number(r.grade) < 10) failedUnits += u;
    }
  }

  const totalCumulativeGpa = officialGpaData.totalUnits > 0 ? officialGpaData.gpa.toFixed(2) : '—';

  // ── خلاصهٔ همان نیمسال (نمای «کارنامهٔ نیمسال») ──
  // معدل نیمسال فقط از دروسِ عددیِ همان ترم ساخته می‌شود؛ آوردن معدل کل روی
  // سندِ یک نیمسال، سند را گمراه‌کننده می‌کرد. نام‌ها با پیشوند `scope` تا با
  // متغیرهای محلیِ حلقهٔ ترم (termGpa/termGradedUnits) قاطی نشوند.
  let scopeEnrolledUnits = 0;
  let scopePassedUnits = 0;
  let scopeGradedUnits = 0;
  let scopeWeightedScore = 0;
  let scopeFailedUnits = 0;
  for (const r of scopedRows) {
    const u = Number(r.units || 0);
    const isDescriptive = r.gradingType === 'DESCRIPTIVE' || Number(r.grade) === 1 || r.affectsGpa === 0;
    if (r.status === 'REGISTERED' || r.status === 'PENDING_COUNCIL') scopeEnrolledUnits += u;
    if (isDescriptive) {
      if (r.grade != null && Number(r.grade) === 1) scopePassedUnits += u;
      if (r.grade != null && Number(r.grade) === 0) scopeFailedUnits += u;
    } else {
      if (r.grade != null && Number(r.grade) >= 10) scopePassedUnits += u;
      if (r.grade != null && Number(r.grade) < 10) scopeFailedUnits += u;
      if (r.grade != null && Number(r.grade) >= 0 && Number(r.grade) <= 20) {
        scopeGradedUnits += u;
        scopeWeightedScore += Number(r.grade) * u;
      }
    }
  }
  const scopeGpa = scopeGradedUnits > 0 ? (scopeWeightedScore / scopeGradedUnits).toFixed(2) : '—';
  const isTermView = view === 'term' && !!activeBucket;
  const docTitle = isTermView ? 'کارنامهٔ نیمسال' : 'کارنامهٔ کل تحصیلی دانشجو';
  const docSubtitle = isTermView
    ? `ریزنمرات نیمسال ${activeBucket!.title}`
    : 'ریزنمرات قطعی دوره‌های آموزشی';
  const todayFa = new Date().toLocaleDateString('fa-IR');

  // ── درخواست‌های «کارنامه معتبر» دانشجو + بلوک رسمیت (فقط پس از تأیید) ──
  const transcriptReqRows = await db
    .select({
      id: student_requests.id,
      status: student_requests.status,
      trackingCode: student_requests.trackingCode,
    })
    .from(student_requests)
    .innerJoin(process_definitions, eq(process_definitions.id, student_requests.processId))
    .where(and(eq(process_definitions.code, 'VALID_TRANSCRIPT'), eq(student_requests.studentId, me.id)))
    .orderBy(desc(student_requests.id));

  const approvedTranscriptReq = transcriptReqRows.find(r => r.status === 'APPROVED') ?? null;
  const pendingTranscriptReq = transcriptReqRows.find(r => r.status !== 'APPROVED' && r.status !== 'REJECTED') ?? null;

  // رمز تایید (QR) فقط وقتی درخواست تأیید شده باشد صادر می‌شود؛ کارنامهٔ خود‌نمایی فاقد اعتبار است.
  let transcriptQr: { url: string; qr: string; expiresAt: string | null } | null = null;
  if (approvedTranscriptReq) {
    try {
      const publicBaseUrl = await getPublicBaseUrl();
      const issued = await issueTranscriptToken(user.id, { id: me.id, code: me.studentCode, universityId: me.universityId });
      const url = `${publicBaseUrl}/verify-transcript/${encodeURIComponent(issued.token)}`;
      transcriptQr = { url, qr: await qrSvg(url, { errorCorrectionLevel: 'Q', size: 128, margin: 4 }), expiresAt: issued.expiresAt };
    } catch (err) {
      console.warn('transcript qr failed:', err);
    }
  }

  // ── دادهٔ پنل اعتراض به نمره (کارنامه نیمسال) ──
  const objectionCourseIds = allRows.map(r => r.id);
  const objectionExistingRows = objectionCourseIds.length
    ? await db
        .select({
          enrollmentId: grade_objections.enrollmentId,
          status: grade_objections.status,
          reviewerNote: grade_objections.reviewerNote,
        })
        .from(grade_objections)
        .where(and(eq(grade_objections.studentId, me.id), inArray(grade_objections.enrollmentId, objectionCourseIds)))
    : [];
  const objectionExisting: Record<number, { status: string; note: string | null }> = {};
  for (const o of objectionExistingRows) {
    objectionExisting[o.enrollmentId] = { status: o.status, note: o.reviewerNote };
  }
  const objectionDeadline = (await getSetting('GRADE_OBJECTION_DEADLINE').catch(() => '')) || null;
  const objectionWindowOpen =
    !!objectionDeadline &&
    /^\d{4}-\d{2}-\d{2}$/.test(objectionDeadline) &&
    new Date() <= new Date(objectionDeadline + 'T23:59:59');
  const objectionTerms = academicYears
    .flatMap(g => g.terms)
    .map(t => ({
      termTitle: t.title || `${t.normalized?.displayYear}/${t.normalized?.semester}`,
      termCode: `${t.normalized?.displayYear ?? ''}/${t.normalized?.semester ?? ''}`,
      isCurrent: t.isCurrent,
      rows: t.rows.map(r => ({
        enrollmentId: r.id,
        code: r.code,
        title: r.title,
        grade: r.grade != null ? Number(r.grade) : null,
        gradeStatus: r.gradeStatus,
        isFinalized: r.gradeStatus === 'FINALIZED' || r.grade != null,
      })),
    }));

  return (
    <div className="space-y-4">
      {myRecords.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm print:hidden">
          <span className="font-bold text-slate-600">پروندهٔ تحصیلی (مقطع):</span>
          {myRecords.map(r => (
            <a
              key={r.id}
              href={`/student/transcript?record=${r.id}`}
              className={`rounded-lg border px-2.5 py-1 font-bold ${r.id === me.id
                ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              {r.degreeTitle ?? 'مقطع نامشخص'} · <span className="font-mono" dir="ltr">{r.studentCode}</span>
              {r.status === 'GRADUATED' ? ' — فارغ‌التحصیل' : ''}
            </a>
          ))}
          <span className="text-3xs text-slate-400">هر مقطع کارنامهٔ جداگانه و QR جدا دارد.</span>
        </div>
      )}
      {/* نوار ابزار: انتخاب نمای سند (کل / نیمسال) + چاپ همان نما */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 px-4 shadow-sm print:hidden">
        <div className="flex items-center gap-2">
          <span className="text-xl">📜</span>
          <div>
            <h2 className="text-sm font-bold text-slate-800">
              کارنامه {isTermView ? 'نیمسال' : 'کل'} — نسخهٔ مشاهده‌ای
            </h2>
            <p className="text-xs text-slate-500">
              {docSubtitle} — این نسخه <b>فاقد اعتبار اداری (غیرقابل استناد)</b> است
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* دو سند جدا با دکمهٔ جدا */}
          <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs font-bold">
            <a
              href={`/student/transcript${wantedRecordId ? `?record=${wantedRecordId}` : ''}`}
              className={view === 'all'
                ? 'bg-slate-800 px-3 py-1.5 text-white'
                : 'bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50'}
            >
              کارنامهٔ کل
            </a>
            <a
              href={`/student/transcript?view=term&term=${activeBucket?.termId ?? ''}${wantedRecordId ? `&record=${wantedRecordId}` : ''}`}
              className={view === 'term'
                ? 'border-r border-slate-300 bg-slate-800 px-3 py-1.5 text-white'
                : 'border-r border-slate-300 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50'}
            >
              کارنامهٔ نیمسال
            </a>
          </div>
          {isTermView && allTermsAsc.length > 0 && (
            <form method="get" className="flex items-center gap-1">
              <input type="hidden" name="view" value="term" />
              {wantedRecordId ? <input type="hidden" name="record" value={wantedRecordId} /> : null}
              <select
                name="term"
                defaultValue={String(activeBucket?.termId ?? '')}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-700"
              >
                {[...allTermsAsc].reverse().map(t => (
                  <option key={t.termId} value={t.termId}>{t.title}</option>
                ))}
              </select>
              <button type="submit" className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                نمایش
              </button>
            </form>
          )}
          <PrintTranscriptButton
            orientation="landscape"
            label={isTermView ? 'چاپ کارنامهٔ نیمسال' : 'چاپ کارنامهٔ کل'}
          />
        </div>
      </div>

      {/* سند رسمی کارنامه (کاغذ رسمی کارنامه دانشگاهی) */}
      <div className="transcript-print-area bg-white text-slate-900 border-2 border-slate-800 p-5 sm:p-8 shadow-xl print-area print:shadow-none print:border print:m-0 print:p-4 text-xs font-sans">
        
        {/* ۱. سربرگ سه‌بخشی رسمی دانشگاه */}
        <div className="border-b-2 border-slate-800 pb-4 mb-4">
          <div className="grid grid-cols-3 items-center text-center">
            {/* ستون راست */}
            <div className="text-right space-y-1">
              <p className="font-bold text-slate-800">جمهوری اسلامی ایران</p>
              <p className="font-semibold text-slate-700">وزارت علوم، تحقیقات و فناوری</p>
              {universityTitle ? <p className="font-extrabold text-slate-900 text-sm">{universityTitle}</p> : null}
              <p className="text-2xs text-slate-500">معاونت آموزشی و تحصیلات تکمیلی</p>
            </div>

            {/* ستون وسط (نشان و عنوان سند) */}
            <div className="flex flex-col items-center justify-center">
            {universityLogo ? (
              <img src={universityLogo} alt={"آرم دانشگاه"} className={"mb-1 h-12 w-12 shrink-0 object-contain"} />
            ) : null}
              <h1 className="text-base font-black tracking-wide text-slate-950 border-b border-slate-800 pb-0.5 px-4">
                {docTitle}
              </h1>
              <p className="text-3xs text-slate-600 mt-0.5">{docSubtitle}</p>
            </div>

            {/* ستون چپ (اطلاعات سند) */}
            <div className="text-left space-y-1 font-mono text-2xs">
              <p><span className="font-sans text-slate-500">شماره پرونده: </span><b>{me.studentCode}</b></p>
              <p><span className="font-sans text-slate-500">تاریخ صدور: </span><b>{todayFa}</b></p>
              <p><span className="font-sans text-slate-500">صفحه: </span><b>۱ از ۱</b></p>
              <p><span className="font-sans text-slate-500">وضعیت: </span><b className="text-emerald-800 font-sans">{statusFa[me.status] ?? me.status}</b></p>
            </div>
          </div>
        </div>

        {/* ۱.۵ نوار «غیرقابل استناد» — باید در **چاپ** هم دیده شود، نه فقط روی صفحه.
            عمداً «متن + کادر ضخیم» است نه فقط پس‌زمینهٔ رنگی (بسیاری از چاپگرها
            پس‌زمینه را حذف می‌کنند). متنِ نوار همان سیاست سند است: نسخهٔ مشاهده‌ای
            تا تأیید کارشناس، سند استنادی نیست و نسخهٔ معتبر از مسیر درخواست صادر می‌شود. */}
        <div className="tr-unverified-band mb-3 flex flex-wrap items-center justify-between gap-2 border-2 border-amber-700 bg-amber-50 px-3 py-1.5 text-3xs font-black text-amber-950">
          <span>⚠️ این کارنامه تا تأیید کارشناس امور آموزشی <u>غیرقابل استناد</u> است.</span>
          <span className="shrink-0 font-mono text-[9px] text-amber-900">نسخهٔ مشاهده‌ای — بدون رمز تایید</span>
        </div>

        {/* ۲. جدول مشخصات هویتی، آموزشی و آیین‌نامه اجرایی */}
        <div className="border border-slate-800 mb-5 overflow-hidden">
          <div className="bg-slate-100 px-3 py-1 font-bold text-slate-900 border-b border-slate-800 text-2xs">
            مشخصات فردی، تحصیلی و آیین‌نامه ملاک عمل
          </div>
          <table className="w-full text-right text-2xs border-collapse rt">
            <tbody>
              <tr className="border-b border-slate-300">
                <td className="p-1.5 bg-slate-50 font-medium text-slate-600 w-1/6 border-l border-slate-300">نام و نام خانوادگی:</td>
                <td className="p-1.5 font-bold text-slate-900 w-2/6 border-l border-slate-300">{user.name}</td>
                <td className="p-1.5 bg-slate-50 font-medium text-slate-600 w-1/6 border-l border-slate-300">شماره دانشجویی:</td>
                <td className="p-1.5 font-bold font-mono text-slate-900 w-2/6" dir="ltr">{me.studentCode}</td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="p-1.5 bg-slate-50 font-medium text-slate-600 border-l border-slate-300">کد ملی:</td>
                <td className="p-1.5 font-mono text-slate-900 border-l border-slate-300" dir="ltr">{shownNationalCode}</td>
                <td className="p-1.5 bg-slate-50 font-medium text-slate-600 border-l border-slate-300">مقطع تحصیلی:</td>
                <td className="p-1.5 font-semibold text-slate-900">{shownLevel}</td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="p-1.5 bg-slate-50 font-medium text-slate-600 border-l border-slate-300">رشته تحصیلی:</td>
                <td className="p-1.5 font-bold text-slate-900 border-l border-slate-300">{shownMajor}</td>
                <td className="p-1.5 bg-slate-50 font-medium text-slate-600 border-l border-slate-300">سال ورود / نوع دوره:</td>
                <td className="p-1.5 font-semibold text-slate-900">{shownEntryYear} / {shownStudyType}</td>
              </tr>
              <tr>
                <td className="p-1.5 bg-slate-50 font-medium text-slate-600 border-l border-slate-300">آیین‌نامه ملاک عمل:</td>
                <td colSpan={3} className="p-1.5 font-semibold text-slate-900">
                  <span className="text-indigo-950 font-bold">{shownRegulation}</span>
                  <span className="text-slate-500 text-3xs mr-2">({regPolicy})</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ۳. ریزنمرات به تفکیک سال‌های تحصیلی و نیمسال‌ها */}
        {academicYears.length === 0 && (
          <div className="col-span-full p-8 text-center text-slate-400 border border-dashed border-slate-300">
            {isTermView
              ? `برای نیمسال «${activeBucket!.title}» درسی در کارنامه ثبت نشده است.`
              : 'هنوز درسی در پرونده کارنامه ثبت نشده است.'}
          </div>
        )}

        {academicYears.map(yearGroup => (
          <div key={yearGroup.academicYear} className="col-span-full space-y-3">
            {/* هدر سال تحصیلی — بلوک معادل‌سازی اول کارنامه با عنوان خودش */}
            <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-800 text-white rounded-xl px-4 py-2.5 font-extrabold text-sm border border-indigo-700">
              {yearGroup.academicYear === EQUIVALENCE_GROUP_YEAR ? (
                <span>📚 {yearGroup.displayYear}</span>
              ) : (
                <span>
                  📅 سال تحصیلی{' '}
                  <bdi dir="ltr" style={{ unicodeBidi: 'isolate' }} className="font-mono">
                    {yearGroup.displayYear}
                  </bdi>
                </span>
              )}
            </div>
            
            {/* ترم‌های این سال */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {yearGroup.terms.map((termItem, idx) => {
                let termUnits = 0;
                let termPassed = 0;
                let termGradedUnits = 0;
                let termWeightedScore = 0;

                for (const r of termItem.rows) {
                  const u = Number(r.units || 0);
                  termUnits += u;

                  const isDescriptive = r.gradingType === 'DESCRIPTIVE' || Number(r.grade) === 1 || r.affectsGpa === 0;

                  if (isDescriptive) {
                    if (Number(r.grade) === 1 || (r.grade != null && Number(r.grade) >= 10)) {
                      termPassed += u;
                    }
                  } else {
                    if (r.grade != null && Number(r.grade) >= 10) {
                      termPassed += u;
                    }
                    if (r.grade != null && Number(r.grade) >= 0 && Number(r.grade) <= 20) {
                      termGradedUnits += u;
                      termWeightedScore += Number(r.grade) * u;
                    }
                  }
                }

                const termGpa = termGradedUnits > 0 ? (termWeightedScore / termGradedUnits).toFixed(2) : '—';
                const isA = termGradedUnits > 0 && Number(termGpa) >= 17;
                const isProbation = termGradedUnits > 0 && Number(termGpa) < 12;

                // نمایش عنوان ترم: برای معادل‌سازی عنوان ثبت‌شده در دیتابیس
                // (مثل «سوابق پایه ۱۳۹۶»)، برای نرمال نیمسال
                const termDisplayTitle = termItem.normalized.termType === 'EQUIVALENCE'
                  ? (termItem.title || termItem.normalized.displaySemester)
                  : termItem.normalized.displaySemester;

                return (
                  <div key={`${yearGroup.academicYear}-${idx}`} className="border border-slate-700 overflow-hidden flex flex-col justify-between bg-white">
                    <div>
                      {/* هدر نیمسال */}
                      <div className="bg-slate-200/90 px-3 py-1.5 flex items-center justify-between border-b border-slate-700 font-bold">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-950 text-xs">
                            📚 {termDisplayTitle}
                            {termItem.normalized.termType === 'EQUIVALENCE' && (
                              <span className="text-[9px] bg-amber-100 text-amber-800 font-bold px-1 py-0.2 rounded">معادل‌سازی</span>
                            )}
                            {termItem.normalized.termType === 'SUMMER' && (
                              <span className="text-[9px] bg-sky-100 text-sky-800 font-bold px-1 py-0.2 rounded">تابستان</span>
                            )}
                          </span>
                          {termItem.isCurrent && (
                            <span className="text-3xs bg-emerald-700 text-white font-bold px-1.5 py-0.2 rounded">
                              جاری
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-slate-700 text-3xs" dir="ltr">
                          {termItem.normalized.displayYear} / {termItem.normalized.semester}
                        </span>
                      </div>
                    </div>

                    {/* جدول دروس */}
                  <table className="w-full text-right text-2xs border-collapse rt">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-700 font-bold text-slate-800">
                        <th className="p-1 border-l border-slate-300 text-center w-6">ردیف</th>
                        <th className="p-1 border-l border-slate-300 text-center w-16">کد درس</th>
                        <th className="p-1 border-l border-slate-300">نام درس</th>
                        <th className="p-1 border-l border-slate-300 text-center w-12">واحد</th>
                        <th className="p-1 border-l border-slate-300 text-center w-14">نمره</th>
                        <th className="p-1 text-center w-24">نتیجه / وضعیت</th>
                      </tr>
                    </thead>
                    <tbody>
                      {termItem.rows.map((row, rIdx) => {
                        const isDescriptive = row.gradingType === 'DESCRIPTIVE' || Number(row.grade) === 1 || row.affectsGpa === 0;
                        const _cm = row.courseMinMark != null ? Number(row.courseMinMark) : NaN;
                        const passMark = Number.isFinite(_cm) && _cm >= 0 && _cm <= 20 ? _cm : 10;
                        const isPassed = isDescriptive
                          ? (Number(row.grade) === 1 || (row.grade != null && Number(row.grade) >= passMark))
                          : (row.grade != null && Number(row.grade) >= passMark);
                        const isFailed = isDescriptive
                          ? (row.grade != null && Number(row.grade) === 0)
                          : (row.grade != null && Number(row.grade) < passMark);
                        const isPending = row.grade == null;
                        const isEquiv = row.status === 'EQUIV_PASSED';
                        const isEmergency = row.emergencyWithdrawal === 1;
                        const totalU = Number(row.units || 0);

                        let resultDisplay: ReactNode = '';
                        if (isEmergency) resultDisplay = <span className="text-rose-700">حذف اضطراری</span>;
                        else if (isEquiv) resultDisplay = <span className="text-teal-700">معادل</span>;
                        else if (isPending) resultDisplay = <span className="text-slate-500 font-normal">جاری</span>;
                        else if (isFailed) resultDisplay = <span className="text-red-700">مردود</span>;
                        else if (isPassed) resultDisplay = <span className="text-emerald-700">قبول</span>;
                        else resultDisplay = <span className="text-slate-500">{statusFa[row.status] ?? row.status}</span>;

                        return (
                          <tr key={row.id} className="border-b border-slate-200 hover:bg-slate-50">
                            <td className="p-1 border-l border-slate-200 text-center text-slate-600">{rIdx + 1}</td>
                            <td className="p-1 border-l border-slate-200 text-center font-mono text-3xs" dir="ltr">{row.code}</td>
                            <td className="p-1 border-l border-slate-200 font-semibold text-slate-900">
                              {row.title}
                            </td>
                            <td className="p-1 border-l border-slate-200 text-center font-bold font-mono">{totalU}</td>
                            <td className="p-1 border-l border-slate-200 text-center font-black text-slate-900">
                              {row.grade != null ? (
                                isDescriptive ? (
                                  <span className="text-emerald-800 text-3xs">قبول</span>
                                ) : (
                                  Number(row.grade).toFixed(2)
                                )
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="p-1 text-center font-bold text-3xs">
                              {resultDisplay}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                <div className="bg-slate-100 p-2 border-t border-slate-700 flex items-center justify-between font-bold text-3xs text-slate-800 mt-auto">
                  <div className="flex gap-2">
                    <span>اخذ: <b className="font-mono">{termUnits}</b></span>
                    <span>گذرانده: <b className="text-emerald-800 font-mono">{termPassed}</b></span>
                  </div>
                  <div>
                    <span>معدل: <b className="text-slate-950 font-mono">{termGpa}</b></span>
                  </div>
                </div>
              </div>
            );
          })}
            </div>
          </div>
        ))}

        <div className="border-2 border-slate-800 mt-6 overflow-hidden">
          <div className="bg-slate-800 text-white px-3 py-1 font-bold text-center text-xs">
            {isTermView
              ? `خلاصه وضعیت نیمسال ${activeBucket!.title}`
              : 'خلاصه وضعیت تحصیلی کل دوره تا تاریخ صدور کارنامه'}
          </div>
          <table className="w-full text-center text-2xs border-collapse font-bold rt">
            <tbody>
              <tr className="bg-slate-100 border-b border-slate-400 text-slate-700">
                <td className="p-2 border-l border-slate-300">{isTermView ? 'واحدهای اخذشده' : 'کل واحدهای اخذشده'}</td>
                <td className="p-2 border-l border-slate-300">{isTermView ? 'واحدهای گذرانده' : 'کل واحدهای گذرانده'}</td>
                <td className="p-2 border-l border-slate-300">{isTermView ? 'واحدهای مردودی' : 'کل واحدهای مردودی'}</td>
                <td className="p-2 border-l border-slate-300">واحدهای مؤثر در معدل</td>
                <td className="p-2 border-l border-slate-300 bg-slate-200 text-slate-950">
                  {isTermView ? 'معدل نیمسال' : 'معدل کل دوره (GPA)'}
                </td>
                <td className="p-2">{isTermView ? 'وضعیت دانشجو' : 'وضعیت نهایی دانشجو'}</td>
              </tr>
              <tr className="text-slate-950 text-xs font-mono">
                <td className="p-2 border-l border-slate-300">{isTermView ? scopeEnrolledUnits : totalEnrolledUnits} واحد</td>
                <td className="p-2 border-l border-slate-300 text-emerald-800">{isTermView ? scopePassedUnits : totalPassedUnits} واحد</td>
                <td className="p-2 border-l border-slate-300 text-red-700">{isTermView ? scopeFailedUnits : failedUnits} واحد</td>
                <td className="p-2 border-l border-slate-300">{isTermView ? scopeGradedUnits : totalGradedUnits} واحد</td>
                <td className="p-2 border-l border-slate-300 bg-emerald-50 text-emerald-950 font-black text-sm">
                  {isTermView ? scopeGpa : totalCumulativeGpa}
                </td>
                <td className="p-2 font-sans font-bold text-emerald-800">
                  {statusFa[me.status] ?? me.status}
                </td>
              </tr>
            </tbody>
          </table>
          {!isTermView && officialGpaData.excludedCount > 0 && (
            <div className="bg-emerald-50 px-3 py-1.5 border-t border-emerald-200 text-3xs text-emerald-900 font-medium flex items-center justify-between">
              <span>✨ {officialGpaData.policy === 'EXCLUDE_ALWAYS'
                ? <>تعداد <b>{officialGpaData.excludedCount} نمره مردودی</b> طبق دادنامهٔ هیئت عمومی دیوان عدالت اداری و بخشنامهٔ ۲/۲۱/۲۸۳۴۲۸ از معدل کل حذف شد؛ در ریزنمرات و میانگین نیمسال باقی است.</>
                : <>تعداد <b>{officialGpaData.excludedCount} نمره مردودی</b> پس از قبولی مجدد در درس، طبق آییننامهٔ ملاک از مخرج و صورت معدل کل کسر گردید.</>}</span>
              <span className="font-bold text-emerald-950">آیین‌نامه ملاک عمل</span>
            </div>
          )}
        </div>

        {/* ۵. بلوک رسمیت: در نسخهٔ مشاهده‌ای حذف شد — رمز تایید (QR) تنها پس از تأیید درخواست
            کارنامهٔ معتبر، در بخش تعاملیِ زیرِ سند نمایش داده می‌شود. */}

        {/* ۶. متن حقوقی سند و محل امضا و مهرهای رسمی */}
        <div className="mt-6 pt-3 border-t border-slate-400 text-3xs text-slate-600 space-y-4">
          <p className="leading-relaxed">
            <b>تذکر مهم:</b> این کارنامه صرفاً جهت اطلاع و مشاهدهٔ شخصی دانشجو صادر گردیده و <b>فاقد اعتبار اداری (غیرقابل استناد)</b> می‌باشد؛ هرگونه سوءاستفاده یا جعل قابل پیگرد قانونی است. برای دریافت کارنامهٔ معتبر با رمز تایید (QR) از بخش «درخواست‌ها → درخواست کارنامه معتبر» اقدام نمایید. نمرات دروس توصیفی در مخرج معدل عددی لحاظ نمی‌شوند.
          </p>

          <div className="grid grid-cols-3 text-center pt-6 pb-4 font-bold text-slate-800">
            <div>
              <p>کارشناس امور آموزشی و بایگانی</p>
              <div className="h-12 flex items-end justify-center text-[9px] text-slate-400">
                (امضا و تاریخ)
              </div>
            </div>
            <div>
              <p>محل مهر اداره کل آموزش دانشگاه</p>
              <div className="w-16 h-16 rounded-full border border-dashed border-slate-400 mx-auto mt-2 flex items-center justify-center text-[9px] text-slate-400">
                محل مهر
              </div>
            </div>
            <div>
              <p>مدیر کل امور آموزشی و تحصیلات تکمیلی</p>
              <div className="h-12 flex items-end justify-center text-[9px] text-slate-400">
                (امضا و تأیید نهایی)
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* بخش تعاملی: دسترس به کارنامهٔ معتبر + اعتراض به نمره (زیر کارنامه — چاپ نمی‌شود) */}
      <div className="space-y-3 print:hidden">
        {transcriptQr ? (
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 shadow-sm">
            <h3 className="font-extrabold text-emerald-900 text-sm mb-1">✅ کارنامهٔ معتبر (پس از تأیید کارشناس) — رمز تایید برخط</h3>
            <p className="text-xs text-emerald-800 mb-3">این کارنامه دارای اعتبار اداری است و با اسکن رمز تایید (QR) در آدرس زیر قابل استعلام می‌باشد.</p>
            <VerifyQrBlock title="استعلام برخط اصالت کارنامهٔ معتبر" url={transcriptQr.url} qr={transcriptQr.qr} expiresAt={transcriptQr.expiresAt} />
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
            <h3 className="font-extrabold text-amber-900 text-sm mb-1">⚠️ این کارنامه غیرقابل استناد است</h3>
            <p className="text-xs text-amber-800 leading-relaxed mb-3">
              کارنامهٔ نمایش‌داده‌شده در پرتال صرفاً جهت مشاهدهٔ شخصی است و فاقد اعتبار اداری می‌باشد. برای دریافت <b>کارنامهٔ معتبر با رمز تایید (QR)</b> که در مراجع رسمی معتبر باشد، باید از بخش درخواست‌ها اقدام کنید.
            </p>
            {pendingTranscriptReq ? (
              <div className="text-xs font-bold text-amber-900 bg-amber-100 border border-amber-200 rounded-lg p-2 mb-2">
                درخواست کارنامهٔ معتبر شما در حال بررسی است (کد رهگیری: <span className="font-mono" dir="ltr">{pendingTranscriptReq.trackingCode}</span>). پس از تأیید کارشناس، رمز تایید در همین صفحه نمایش داده می‌شود.
              </div>
            ) : null}
            <a href="/student/requests" className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-extrabold shadow">
              📨 درخواست کارنامه معتبر (با QR)
            </a>
          </div>
        )}

        <GradeObjectionPanel
          terms={objectionTerms}
          windowOpen={objectionWindowOpen}
          deadline={objectionDeadline}
          existing={objectionExisting}
        />
      </div>

    </div>
  );
}
