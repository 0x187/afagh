/**
 * گیت «پیشفرض قانونی + قابلیت تغییر هوشمند» برای انطباق آییننامهٔ ۱۴۰۲.
 *
 * پنج گام اصلاح ممیزی را پوشش میدهد: معدل/فراغت/پذیرش، یکسانسازی پیکربندی،
 * سنوات/غیبت/اعتراض، ارزیابی جامع و کیفی، و معادلسازی مادهٔ ۱۲ اصلاحی.
 */
import {
  legalDefaults,
  resolveCompliance,
  countableSemesters,
  evaluateAbsence,
  gradeObjectionDeadline,
  type ComplianceContext,
  type ComplianceValues,
} from '../src/lib/compliance-policy';
import {
  evaluateEquivalency,
  jalaliYearsBetween,
  equivalenceFormMinGradeNote,
} from '../src/lib/compliance-equivalency';
import {
  evaluateComprehensiveExam,
  graduationDateOf,
  isQualitativeThesisPassed,
} from '../src/lib/compliance-exam';

let pass = 0;
function ok(cond: unknown, label: string) {
  if (!cond) { console.error('❌ ' + label); process.exit(1); }
  pass++;
}
function eq(a: unknown, b: unknown, label: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${label} → got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}

const ctx = (over: Partial<ComplianceContext> = {}): ComplianceContext => ({
  family: 'REG_1402', level: 'LONG', entryYear: 1404,
  universityId: 1, regulationId: 5, degreeLevelId: 1, ...over,
});
const values = (over: Partial<ComplianceContext> = {}, layers: any = {}): ComplianceValues =>
  resolveCompliance(ctx(over), layers).values;

// ── گام ۱: پیشفرضهای قانونی ────────────────────────────────────────────────
const bs = values();
eq(bs.failed_course_gpa_policy, 'EXCLUDE_ALWAYS', 'گام۱: مادهٔ ۱۱ — پیشفرض ۱۴۰۲ عدم احتساب مردودی');
eq(bs.grad_min_gpa, 12, 'گام۱: مادهٔ ۲۴ — معدل فراغت کارشناسی ۱۲');
eq(bs.max_total_probations, 3, 'گام۱: مادهٔ ۱۶ — سقف مشروطی پیوسته ۳ (قبلاً ۴)');
eq(bs.regulation_resolution, 'SMART', 'گام۱: مادهٔ ۵۳ — حل هوشمند آییننامه');
eq(bs.default_passing_grade, 10, 'گام۱: کف قبولی کارشناسی ۱۰');

const short = values({ level: 'SHORT' });
eq(short.max_total_probations, 2, 'گام۱: مادهٔ ۱۶ — کاردانی/ناپیوسته ۲ مشروطی');
eq(short.grad_min_gpa, 12, 'گام۱: مادهٔ ۲۴ — کاردانی ۱۲');
const ms = values({ level: 'MS' });
eq(ms.grad_min_gpa, 14, 'گام۱: مادهٔ ۳۷ — ارشد ۱۴');
eq(ms.default_passing_grade, 12, 'گام۱: کف قبولی ارشد ۱۲');
eq(ms.probation_gpa_threshold, 14, 'گام۱: مرز مشروطی ارشد ۱۴');
const phd = values({ level: 'PHD' });
eq(phd.grad_min_gpa, 16, 'گام۱: مادهٔ ۴۹ — دکتری ۱۶');
eq(phd.default_passing_grade, 14, 'گام۱: کف قبولی دکتری ۱۴');

// مادهٔ ۵۳: آییننامههای قدیمی دستنخورده بمانند (ورودی پیش از ۱۴۰۲)
eq(values({ family: 'LEGACY', entryYear: 1393, legacyFailedPolicy: 'EXCLUDE_IF_PASSED' }).failed_course_gpa_policy,
  'EXCLUDE_IF_PASSED', 'گام۱: ورودی قدیمی ۱۳۹۳ سیاست خودش را نگه میدارد');
eq(values({ family: 'LEGACY', entryYear: 1393, legacyFailedPolicy: 'EXCLUDE_IF_PASSED_1391' }).failed_course_gpa_policy,
  'EXCLUDE_IF_PASSED_1391', 'گام۱: تبصرهٔ ۱۳۹۱ دستنخورده');
eq(values({ family: 'LEGACY', entryYear: 1393, legacyFailedPolicy: 'KEEP_ALWAYS' }).failed_course_gpa_policy,
  'KEEP_ALWAYS', 'گام۱: PRE1391 دستنخورده');

// ── «پیشفرض + قابل تغییر»: محافظت قانونی و اورراید صریح ──────────────────
const rGuard = resolveCompliance(ctx(), {
  regulation: { failed_course_gpa_policy: 'EXCLUDE_IF_PASSED', grad_min_gpa: 10 },
  settings: { grad_min_gpa: 9 },
});
eq(rGuard.values.failed_course_gpa_policy, 'EXCLUDE_ALWAYS', 'محافظت: پیکربندی کهنه نمیتواند دادنامهٔ دیوان را دور بزند');
eq(rGuard.values.grad_min_gpa, 12, 'محافظت: GRAD_MIN_GPA قدیمی اعمال نشد');
eq(rGuard.provenance.failed_course_gpa_policy.source, 'legal-guard', 'منبع = پیشفرض قانونی محافظتشده');
ok(rGuard.provenance.failed_course_gpa_policy.legalConflict, 'تعارض پیکربندی قدیمی ثبت شد');
eq(rGuard.provenance.failed_course_gpa_policy.shadowed, 'EXCLUDE_IF_PASSED', 'مقدار کنارگذاشتهشده نگه داشته شد');

const rOverride = resolveCompliance(ctx(), {
  overrides: { failed_course_gpa_policy: 'KEEP_ALWAYS' },
  regulation: { failed_course_gpa_policy: 'EXCLUDE_IF_PASSED' },
});
eq(rOverride.values.failed_course_gpa_policy, 'KEEP_ALWAYS', 'اورراید صریح مدیر حتی روی حکم لازمالاجرا مقدم است');
eq(rOverride.provenance.failed_course_gpa_policy.source, 'override', 'منبع اورراید ثبت شد');

const rPrecedence = resolveCompliance(ctx(), {
  overrides: { grad_min_gpa: undefined, default_passing_grade: 11 },
  regulation: { default_passing_grade: 13, probation_gpa_threshold: 13 },
  settings: { probation_gpa_threshold: 15 },
});
eq(rPrecedence.values.default_passing_grade, 11, 'ترتیب: اورراید > پیکربندی آییننامه');
eq(rPrecedence.values.probation_gpa_threshold, 13, 'ترتیب: پیکربندی آییننامه > تنظیمات سراسری');
eq(rPrecedence.values.grad_min_gpa, 12, 'ترتیب: بدون اورراید ⇒ قانون');
eq(resolveCompliance(ctx(), { regulation: { default_passing_grade: 999 } }).values.default_passing_grade,
  20, 'اعتبارسنجی: clamp به سقف مجاز (نه شکستن موتور)');
eq(resolveCompliance(ctx(), { overrides: { failed_course_gpa_policy: 'NOT_A_POLICY' } }).values.failed_course_gpa_policy,
  'EXCLUDE_ALWAYS', 'اعتبارسنجی: مقدار نامعتبر به پیشفرض قانونی سقوط میکند');
eq(resolveCompliance(ctx(), { overrides: { equiv_cap_percent: '75' } }).values.equiv_cap_percent,
  75, 'اعتبارسنجی: رشتهٔ عددی نرمال شد');

// ── گام ۳: سنوات / غیبت / اعتراض ──────────────────────────────────────────
eq(countableSemesters(bs, [{ isSummer: false }, { isSummer: true }, { isSummer: false }]),
  2, 'گام۳: تبصرهٔ ۵ مادهٔ ۱۷ — تابستان جزو سنوات نیست');
eq(countableSemesters({ ...bs, count_summer_in_tenure: true }, [{ isSummer: false }, { isSummer: true }]),
  2, 'گام۳: اورراید شمردن تابستان قابل اعمال است');
const noAbsence = evaluateAbsence(bs, { absences: 3, totalSessions: 16, excused: 0, justifiedExcused: false });
ok(!noAbsence.zeroGrade && noAbsence.threshold === 3, 'گام۳: دقیقاً ۳/۱۶ غیبت مجاز است');
const tooAbsent = evaluateAbsence(bs, { absences: 4, totalSessions: 16, excused: 0, justifiedExcused: false });
ok(tooAbsent.zeroGrade && /صفر/.test(tooAbsent.reason), 'گام۳: بیش از ۳/۱۶ ⇒ نمرهٔ صفر');
const excused = evaluateAbsence(bs, { absences: 5, totalSessions: 16, excused: 2, justifiedExcused: true });
ok(!excused.zeroGrade && excused.dropFromTerm, 'گام۳: غیبت موجه ⇒ حذف درس از نیمسال');
ok(!evaluateAbsence({ ...bs, absence_auto_zero: false }, { absences: 9, totalSessions: 16, excused: 0, justifiedExcused: false }).zeroGrade,
  'گام۳: اعمال صفر قابل خاموششدن است');
const dl = gradeObjectionDeadline(bs, '2026-03-01T10:00:00');
ok(dl != null && dl!.getDate() === 11, 'گام۳: مادهٔ ۸ — ۱۰ روز پس از اعلام نمره');
const dlMs = gradeObjectionDeadline(ms, '2026-03-01T10:00:00');
ok(dlMs != null && dlMs!.getDate() === 21, 'گام۳: ارشد/دکتری ۲۰ روز');
const dlExplicit = gradeObjectionDeadline({ ...bs, grade_objection_explicit_deadline: '2026-12-31' }, '2026-03-01T10:00:00');
ok(dlExplicit != null && dlExplicit!.getFullYear() === 2026 && dlExplicit!.getMonth() === 11,
  'گام۳: مهلت صریح مدیر بر پنجرهٔ مقطعی مقدم است');

// ── گام ۴: ارزیابی جامع و نمرهٔ کیفی ──────────────────────────────────────
const examBase = { languageProficiencyConfirmed: true, attemptsUsed: 0, lastGrade: null as number | null, approvedAlternative: null as string | null, alternativeConfirmed: false, currentSemester: 5, proposalApprovedSemester: 2, supervisorAssignedSemester: 1 };
ok(!evaluateComprehensiveExam(bs, { ...examBase, gpa: 15.5 }).eligibleToSit, 'گام۴: مادهٔ ۴۱ — معدل زیر ۱۶ مجاز نیست');
ok(evaluateComprehensiveExam(bs, { ...examBase, gpa: 16.5 }).eligibleToSit, 'گام۴: معدل ≥۱۶ مجاز است');
const examPass = evaluateComprehensiveExam(bs, { ...examBase, gpa: 17, attemptsUsed: 1, lastGrade: 16 });
ok(examPass.passed && examPass.remainingAttempts === 1, 'گام۴: قبولی با ۱۶ و یک تجدید باقیمانده');
const examFail = evaluateComprehensiveExam(bs, { ...examBase, gpa: 17, attemptsUsed: 2, lastGrade: 14 });
ok(!examFail.passed && !examFail.eligibleToSit && examFail.reasons.some(r => /تجدید/.test(r)),
  'گام۴: فقط یک بار تجدید مجاز است');
const examAlt = evaluateComprehensiveExam(bs, { ...examBase, gpa: 17, attemptsUsed: 2, lastGrade: 14, approvedAlternative: 'ARTICLE_ISI', alternativeConfirmed: true });
ok(examAlt.passed, 'گام۴: جایگزین مادهٔ ۴۴ پذیرفته شد');
ok(evaluateComprehensiveExam(bs, { ...examBase, gpa: 17, languageProficiencyConfirmed: false }).reasons.some(r => /زبان/.test(r)),
  'گام۴: بسندگی زبان الزامی است');
eq(isQualitativeThesisPassed('عالی', bs), true, 'گام۴: نمرهٔ کیفی «عالی» قبول است');
eq(isQualitativeThesisPassed('مردود', bs), false, 'گام۴: آخرین درجه کیفی مردود است');
eq(graduationDateOf(bs, '1405/03/20', '1405/04/01'), '1405/03/20', 'گام۴: تاریخ دفاع = تاریخ دانشآموختگی');

// ── گام ۵: معادلسازی مادهٔ ۱۲ + اصلاحیهٔ ۲/۱۵۵۶۵۵ ────────────────────────
eq(ms.equiv_min_grade, 14, 'گام۵: حداقل نمرهٔ ارشد ۱۴');
eq(phd.equiv_min_grade, 16, 'گام۵: حداقل نمرهٔ دکتری ۱۶');
eq(bs.equiv_min_grade, 12, 'گام۵: حداقل نمرهٔ کارشناسی ۱۲');
eq(bs.equiv_term_units, 20, 'گام۵: هر ۲۰ واحد یک نیمسال');
eq(ms.equiv_term_units, 13, 'گام۵: ارشد هر ۱۳ واحد یک نیمسال');
eq(bs.equiv_clock_anchor, 'EXIT_DATE', 'گام۵: مبدأ پنج سال = تاریخ انصراف/اخراج');
eq(bs.equiv_notification_date, '1402/06/27', 'گام۵: مرز گذار ابلاغیه');
eq(bs.equiv_transition_entry_years, [1402, 1403], 'گام۵: ورودیهای مشمول قاعدهٔ گذار');
eq(bs.equiv_cap_percent, 50, 'گام۵: سقف ۵۰٪');
eq(bs.equiv_cap_statuses, ['WITHDRAWN', 'EXPELLED'], 'گام۵: سقف فقط انصرافی/اخراجی');
ok(jalaliYearsBetween('1400/01/01', '1405/01/01')! > 4.99, 'گام۵: محاسبهٔ سال شمسی');

const eqBase = {
  studentStatus: 'WITHDRAWN', exitType: 'WITHDRAWAL', exitDate: '1403/01/01',
  entryYear: 1405, today: '1405/01/01', passedBeforeNotification: false,
  curriculumUnchanged: false, destinationConfirmed: true, qualityCoefficient: 1,
  sourceLedToOfficialDegree: false, requestedUnits: 20, totalProgramUnits: 140,
  alreadyEquivalencedUnits: 0,
};
const vOk = evaluateEquivalency(bs, eqBase);
ok(vOk.ok && vOk.maxUnits === 70, 'گام۵: انصرافی در مهلت ۵ساله و زیر سقف ۵۰٪ مجاز است');
ok(!evaluateEquivalency(bs, { ...eqBase, requestedUnits: 71 }).ok, 'گام۵: عبور از سقف ۵۰٪ رد میشود');
const vTransfer = evaluateEquivalency(bs, { ...eqBase, studentStatus: 'TRANSFERRED', exitType: 'TRANSFER', requestedUnits: 100 });
ok(vTransfer.ok && vTransfer.maxUnits === null, 'گام۵: تغییر رشته/انتقال بدون سقف است');
const vOld = evaluateEquivalency(bs, { ...eqBase, exitDate: '1398/01/01' });
ok(!vOld.ok && vOld.reasons.some(r => /بیش از [۵5] سال/.test(r)), 'گام۵: بیش از ۵ سال از انصراف رد میشود');
const vOldOk = evaluateEquivalency(bs, {
  ...eqBase, exitDate: '1398/01/01', curriculumUnchanged: true,
  curriculumVersionCode: 'V1402', destinationCurriculumVersionCode: 'V1402', destinationConfirmed: true,
});
ok(vOldOk.ok && vOldOk.overMaxYearsExceptionApplied, 'گام۵: استثنای عدم تغییر برنامه + تأیید مقصد اعمال شد');
ok(!evaluateEquivalency(bs, { ...eqBase, sourceLedToOfficialDegree: true }).ok, 'گام۵: منع مدرک رسمی (ب)');
ok(!evaluateEquivalency(bs, { ...eqBase, sourceGrade: 11 }).ok, 'گام۵: نمرهٔ کمتر از ۱۲ رد شد');
const vNoDate = evaluateEquivalency(bs, { ...eqBase, exitDate: null });
ok(vNoDate.ok && vNoDate.warnings.some(w => /انصراف/.test(w)), 'گام۵: نبود تاریخ، هشدار میدهد ولی مانع قطعی نیست');
const vTransition = evaluateEquivalency(bs, { ...eqBase, entryYear: 1402, passedBeforeNotification: true });
ok(vTransition.transitionRuleApplied && vTransition.warnings.some(w => /بند ۲/.test(w)), 'گام۵: قاعدهٔ گذار بند ۲');
const vQ = evaluateEquivalency(bs, { ...eqBase, qualityCoefficient: null });
ok(vQ.ok && vQ.warnings.some(w => /ضریب کیفیت/.test(w)), 'گام۵: بند (ج) ضریب کیفیت');
ok(equivalenceFormMinGradeNote(ms).includes('14'), 'گام۵: متن فرم رسمی دیگر ۱۲ هاردکد نیست');

console.log(`✅ compliance-policy: ${pass} assertion passed`);
