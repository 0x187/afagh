/**
 * تست هستهٔ اعتبارسنجی برنامهٔ درسی — بدون React و بدون DB (فاز ۳)
 *
 * اجرا: npm test
 * پوشش: پوشش واحد الزامی، ارجاع پیش‌نیاز به بانک دروس، حلقهٔ دورانی،
 * ترتیب ترمی پیش‌نیاز، هم‌نیازها (در نسخه/هم‌ترم)، پوشش فارغ‌التحصیلی،
 * و رفتار گیت تأیید (ERROR = مانع، WARN = قابل تأیید).
 */
import {
  validateCurriculumCore,
  hasBlockingErrors,
  parseRoleUnitTargets,
  type CurriculumCheckInput,
} from '../src/lib/curriculum-validator.ts';

let pass = 0;
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};
const hasCheck = (results: { check: string; severity: string }[], check: string, severity?: string) =>
  results.some((r) => r.check === check && (severity ? r.severity === severity : true));

// ── ورودی‌های پایه ──
const baseInput = (over?: Partial<CurriculumCheckInput>): CurriculumCheckInput => ({
  // مجموع دروس الزامی CORE/MAJOR: ساختمان داده ۴ + الگوریتم ۳ = ۷
  totalRequiredUnits: 7,
  courses: [
    { courseId: 1, code: 'MA101', title: 'ریاضی ۱', units: 3, roleType: 'GENERAL', isRequired: 1, isElective: 0, isGraduationRequired: 0, recommendedSemester: 1, autoCorequisiteAllowed: 0, clusterId: null },
    { courseId: 2, code: 'CS201', title: 'ساختمان داده', units: 4, roleType: 'CORE', isRequired: 1, isElective: 0, isGraduationRequired: 1, recommendedSemester: 3, autoCorequisiteAllowed: 0, clusterId: null },
    { courseId: 3, code: 'CS301', title: 'الگوریتم', units: 3, roleType: 'MAJOR', isRequired: 1, isElective: 0, isGraduationRequired: 1, recommendedSemester: 4, autoCorequisiteAllowed: 0, clusterId: null },
    { courseId: 4, code: 'CS401', title: 'پایان‌نامه', units: 6, roleType: 'THESIS', isRequired: 1, isElective: 0, isGraduationRequired: 0, recommendedSemester: 8, autoCorequisiteAllowed: 0, clusterId: null },
    { courseId: 5, code: 'EL101', title: 'اختیاری', units: 2, roleType: 'ELECTIVE', isRequired: 0, isElective: 1, isGraduationRequired: 0, recommendedSemester: 5, autoCorequisiteAllowed: 0, clusterId: null },
  ],
  rules: [],
  existingCodes: new Set(['MA101', 'CS201', 'CS301', 'CS401', 'EL101', 'PH101']),
  ...over,
});

console.log('— هستهٔ اعتبارسنجی برنامهٔ درسی —');

// ۱) پوشش واحد
const okUnits = validateCurriculumCore(baseInput());
eq('پوشش واحد: بدون یافته (۷ = ۷)', hasCheck(okUnits, 'UNITS_COVER_MIN'), false);

const lowUnits = validateCurriculumCore(baseInput({ totalRequiredUnits: 200 }));
eq('پوشش واحد: ۷ واحد از ۲۰۰ → ERROR', hasCheck(lowUnits, 'UNITS_COVER_MIN', 'ERROR'), true);
eq('affected شامل کد دروس الزامی است', (lowUnits.find(r => r.check === 'UNITS_COVER_MIN')?.affected ?? []).includes('CS201'), true);

const onlyOptional = validateCurriculumCore(baseInput({ totalRequiredUnits: 7, courses: baseInput().courses.map(c => ({ ...c, isRequired: 0 })) }));
eq('پوشش واحد: هیچ درس الزامی‌ای → ERROR', hasCheck(onlyOptional, 'UNITS_COVER_MIN', 'ERROR'), true);

// برنامهٔ واقعی چندنقشی (پایه/اصلی/اختیاری/عمومی): دروس الزامیِ اصلی به‌تنهایی
// کمتر از کل است ولی پوشش کلی کافی است → بدون خطا (رگرسیون باگ UNITS_COVER_MIN)
const mixedRoles = validateCurriculumCore({
  totalRequiredUnits: 142,
  courses: [
    { courseId: 1, code: 'BASE1', title: 'پایه', units: 22, roleType: 'BASE', isRequired: 1, isElective: 0, isGraduationRequired: 0, recommendedSemester: 1, autoCorequisiteAllowed: 0, clusterId: null },
    { courseId: 2, code: 'CORE1', title: 'اصلی', units: 80, roleType: 'CORE', isRequired: 1, isElective: 0, isGraduationRequired: 1, recommendedSemester: 3, autoCorequisiteAllowed: 0, clusterId: null },
    { courseId: 3, code: 'EL1', title: 'اختیاری', units: 16, roleType: 'ELECTIVE', isRequired: 0, isElective: 1, isGraduationRequired: 0, recommendedSemester: 5, autoCorequisiteAllowed: 0, clusterId: null },
    { courseId: 4, code: 'GEN1', title: 'عمومی', units: 24, roleType: 'GENERAL', isRequired: 1, isElective: 0, isGraduationRequired: 0, recommendedSemester: 2, autoCorequisiteAllowed: 0, clusterId: null },
  ],
  rules: [],
  existingCodes: new Set(['BASE1', 'CORE1', 'EL1', 'GEN1']),
});
eq('پوشش واحد: ۱۴۲ ارائه‌شده از ۱۴۲ لازم (با اختیاری) → بدون ERROR', hasCheck(mixedRoles, 'UNITS_COVER_MIN', 'ERROR'), false);

// ۲) ارجاع به بانک دروس
const badRef = validateCurriculumCore(baseInput({
  rules: [{ courseId: 2, ruleType: 'PREREQ', logicTree: { operator: 'AND', conditions: [{ course: 'ZZ999' }, { course: 'MA101' }] } }],
}));
eq('ارجاع ناموجود → ERROR', hasCheck(badRef, 'PREREQ_REFERENCES_VALID', 'ERROR'), true);
eq('affected شامل ZZ999', (badRef.find(r => r.check === 'PREREQ_REFERENCES_VALID')?.affected ?? []).includes('ZZ999'), true);

const goodRef = validateCurriculumCore(baseInput({
  rules: [{ courseId: 2, ruleType: 'PREREQ', logicTree: { operator: 'OR', conditions: [{ course: 'MA101', minGrade: 12 }, { course: 'PH101' }] } }],
}));
eq('ارجاع معتبر → بدون یافته', hasCheck(goodRef, 'PREREQ_REFERENCES_VALID'), false);

// ۳) حلقهٔ دورانی
const cyclic = validateCurriculumCore(baseInput({
  rules: [
    { courseId: 2, ruleType: 'PREREQ', logicTree: { operator: 'AND', conditions: [{ course: 'CS301' }] } }, // CS201 ← CS301
    { courseId: 3, ruleType: 'PREREQ', logicTree: { operator: 'AND', conditions: [{ course: 'CS201' }] } }, // CS301 ← CS201 (دور!)
  ],
}));
eq('حلقهٔ دورانی → ERROR', hasCheck(cyclic, 'PREREQ_CYCLE_FREE', 'ERROR'), true);

const acyclic = validateCurriculumCore(baseInput({
  rules: [
    { courseId: 2, ruleType: 'PREREQ', logicTree: { operator: 'AND', conditions: [{ course: 'MA101' }] } },
    { courseId: 3, ruleType: 'PREREQ', logicTree: { operator: 'AND', conditions: [{ course: 'CS201' }] } },
  ],
}));
eq('گراف بدون دور → بدون یافته', hasCheck(acyclic, 'PREREQ_CYCLE_FREE'), false);

// ۴) ترتیب ترمی
const semOrder = validateCurriculumCore(baseInput({
  rules: [{ courseId: 2, ruleType: 'PREREQ', logicTree: { operator: 'AND', conditions: [{ course: 'CS401' }] } }], // CS401 (ترم ۸) پیش‌نیاز CS201 (ترم ۳)
}));
eq('پیش‌نیاز در ترم دیرتر → WARN', hasCheck(semOrder, 'PREREQ_SEMESTER_ORDER', 'WARN'), true);

// ۵) هم‌نیاز
const coreqMissing = validateCurriculumCore(baseInput({
  rules: [{ courseId: 3, ruleType: 'COREQ', logicTree: { operator: 'AND', conditions: [{ course: 'ZZ999' }] } }],
}));
eq('هم‌نیاز خارج از نسخه → WARN', hasCheck(coreqMissing, 'COREQ_PRESENT', 'WARN'), true);

const coreqLater = validateCurriculumCore(baseInput({
  rules: [{ courseId: 3, ruleType: 'COREQ', logicTree: { operator: 'AND', conditions: [{ course: 'CS401' }] } }], // CS401 ترم ۸ > الگوریتم ترم ۴
}));
eq('هم‌نیاز در ترم بعدتر → WARN', hasCheck(coreqLater, 'COREQ_PRESENT', 'WARN'), true);

const coreqEarlierOk = validateCurriculumCore(baseInput({
  rules: [{ courseId: 3, ruleType: 'COREQ', logicTree: { operator: 'AND', conditions: [{ course: 'CS201' }] } }], // CS201 ترم ۳ < الگوریتم ترم ۴
}));
eq('هم‌نیاز در ترم زودتر → بدون یافته', hasCheck(coreqEarlierOk, 'COREQ_PRESENT'), false);

const coreqAutoOk = validateCurriculumCore(baseInput({
  courses: baseInput().courses.map(c => c.courseId === 3 ? { ...c, autoCorequisiteAllowed: 1 } : c),
  rules: [{ courseId: 3, ruleType: 'COREQ', logicTree: { operator: 'AND', conditions: [{ course: 'CS201' }] } }],
}));
eq('هم‌نیاز خودکار مجاز (ترم آخر) → بدون یافته', hasCheck(coreqAutoOk, 'COREQ_PRESENT'), false);

const coreqSameSem = validateCurriculumCore(baseInput({
  courses: baseInput().courses.map(c => c.courseId === 3 ? { ...c, recommendedSemester: 3 } : c),
  rules: [{ courseId: 3, ruleType: 'COREQ', logicTree: { operator: 'AND', conditions: [{ course: 'CS201' }] } }],
}));
eq('هم‌نیاز هم‌ترم → بدون یافته', hasCheck(coreqSameSem, 'COREQ_PRESENT'), false);

// ۶) پوشش فارغ‌التحصیلی
eq('دو درس الزامی فارغ‌التحصیلی → بدون یافته', hasCheck(okUnits, 'GRADUATION_COVERAGE'), false);
const noGrad = validateCurriculumCore(baseInput({
  courses: baseInput().courses.map(c => ({ ...c, isGraduationRequired: 0 })),
}));
eq('هیچ درس فارغ‌التحصیلی → ERROR', hasCheck(noGrad, 'GRADUATION_COVERAGE', 'ERROR'), true);

// ۷) گیت تأیید
eq('گیت: ERROR ها مانع‌اند', hasBlockingErrors(noGrad), true);
// PH101 در بانک هست ولی در نسخه نیست → فقط WARN (هم‌نیاز)، نه ERROR ارجاع
eq('گیت: فقط WARN مانع نیست', hasBlockingErrors(validateCurriculumCore(baseInput({
  rules: [{ courseId: 2, ruleType: 'COREQ', logicTree: { operator: 'AND', conditions: [{ course: 'PH101' }] } }],
}))), false);
eq('گیت: نسخهٔ سالم آزاد است', hasBlockingErrors(okUnits), false);


// ─────────────────────── فاز ۴: چک‌های تکمیلی ───────────────────────
console.log('— فاز ۴: بار ترم، ترکیب نقش‌ها، گرایش، هم‌ارزی، ترم‌های نامشخص —');

// ۷) SEMESTER_LOAD
const heavySem = validateCurriculumCore(baseInput({
  maxUnitsPerTerm: 20,
  courses: baseInput().courses.map(c => ({
    ...c,
    units: c.courseId === 4 ? 25 : c.units, // پایان‌نامه ۲۵ واحد در ترم ۸
  })),
}));
eq('بار ترم ۸ از سقف ۲۰ → WARN', hasCheck(heavySem, 'SEMESTER_LOAD', 'WARN'), true);
eq('affected شامل CS401', (heavySem.find(r => r.check === 'SEMESTER_LOAD')?.affected ?? []).includes('CS401'), true);

const lightSem = validateCurriculumCore(baseInput({ maxUnitsPerTerm: 30 }));
eq('بار ترم زیر سقف → بدون یافته', hasCheck(lightSem, 'SEMESTER_LOAD'), false);

const noCap = validateCurriculumCore(baseInput({ maxUnitsPerTerm: null }));
eq('بدون سقف (null) → چک رد می‌شود', hasCheck(noCap, 'SEMESTER_LOAD'), false);

// ۸) COURSE_TYPES_COMPLETE
const missingGeneral = validateCurriculumCore(baseInput({
  minRoleCounts: { GENERAL: 2, MAJOR: 1 },
}));
eq('گروهی بدون حداقل ۲ درس عمومی → WARN', hasCheck(missingGeneral, 'COURSE_TYPES_COMPLETE', 'WARN'), true);

const rolesOk = validateCurriculumCore(baseInput({ minRoleCounts: { GENERAL: 1, MAJOR: 1, CORE: 1 } }));
eq('حداقل نقش‌ها تأمین → بدون یافته', hasCheck(rolesOk, 'COURSE_TYPES_COMPLETE'), false);

const noRolesSpec = validateCurriculumCore(baseInput({ minRoleCounts: {} }));
eq('بدون حداقل مقرر → چک اجرا نمی‌شود', hasCheck(noRolesSpec, 'COURSE_TYPES_COMPLETE'), false);

// ۹) TRACK_INTEGRITY
const trackNoElective = validateCurriculumCore(baseInput({
  trackId: 7,
  courses: baseInput().courses.map(c => c.courseId === 5 ? { ...c, roleType: 'CORE' } : c), // EL101 دیگر انتخابی نیست
}));
eq('نسخهٔ گرایشی بدون درس انتخابی → WARN', hasCheck(trackNoElective, 'TRACK_INTEGRITY', 'WARN'), true);

const trackWithElective = validateCurriculumCore(baseInput({ trackId: 7 })); // EL101 هست
eq('نسخهٔ گرایشی با انتخابی → بدون یافته', hasCheck(trackWithElective, 'TRACK_INTEGRITY'), false);

const freeTrack = validateCurriculumCore(baseInput({ trackId: null }));
eq('گرایش آزاد → چک اجرا نمی‌شود', hasCheck(freeTrack, 'TRACK_INTEGRITY'), false);

// ۱۰) EQUIVALENCY_DISJOINT
const equivDup = validateCurriculumCore(baseInput({
  courses: baseInput().courses.map(c =>
    c.courseId === 1 ? { ...c, clusterId: 5 } : c.courseId === 2 ? { ...c, clusterId: 5 } : c
  ),
}));
eq('دو درس هم‌ارز در یک نسخه → WARN', hasCheck(equivDup, 'EQUIVALENCY_DISJOINT', 'WARN'), true);
eq('affected هر دو کد هم‌ارز', (equivDup.find(r => r.check === 'EQUIVALENCY_DISJOINT')?.affected ?? []).join(',') === 'MA101,CS201', true);

const equivSingle = validateCurriculumCore(baseInput({
  courses: baseInput().courses.map(c => c.courseId === 1 ? { ...c, clusterId: 5 } : c),
}));
eq('یک عضو خوشه → بدون یافته', hasCheck(equivSingle, 'EQUIVALENCY_DISJOINT'), false);

// ۱۱) SEMESTER_UNASSIGNED
const unassignedSem = validateCurriculumCore(baseInput({
  courses: baseInput().courses.map(c => c.courseId === 5 ? { ...c, recommendedSemester: null } : c),
}));
eq('درس بدون ترم مصوب → WARN', hasCheck(unassignedSem, 'SEMESTER_UNASSIGNED', 'WARN'), true);
eq('همه دارای ترم → بدون یافته', hasCheck(okUnits, 'SEMESTER_UNASSIGNED'), false);

// ۱۲) نسخهٔ خالی — هیچ ERROR ساختاری نباید بدهد (فقط پوشش)
const empty = validateCurriculumCore({ ...baseInput(), courses: [], rules: [] });
eq('نسخهٔ خالی: دور ندارد', hasCheck(empty, 'PREREQ_CYCLE_FREE'), false);
eq('نسخهٔ خالی: ارجاع ندارد', hasCheck(empty, 'PREREQ_REFERENCES_VALID'), false);

// سهم واحد نقش‌ها (ROLE_UNITS_COVERAGE) + پارس امن اهداف
eq('پارس JSON رشته‌ای', JSON.stringify(parseRoleUnitTargets('{"GENERAL":22,"CORE":25}')), '{"GENERAL":22,"CORE":25}');
eq('پارس آبجکت (کلید کوچک + مقدار رشته‌ای)', JSON.stringify(parseRoleUnitTargets({ general: 9, CORE: '25' })), '{"GENERAL":9,"CORE":25}');
eq('کلید نامعتبر/مقدار منفی حذف', JSON.stringify(parseRoleUnitTargets({ 'X;DROP': 5, CORE: -3, MAJOR: 10 })), '{"MAJOR":10}');
eq('رشتهٔ نامعتبر → {}', JSON.stringify(parseRoleUnitTargets('ناقص{')), '{}');
eq('null → {}', JSON.stringify(parseRoleUnitTargets(null)), '{}');

const noTargets = validateCurriculumCore(baseInput());
eq('بدون سهم مقرر → چکی صادر نمی‌شود', hasCheck(noTargets, 'ROLE_UNITS_COVERAGE'), false);

const shortGeneral = validateCurriculumCore(baseInput({ minRoleUnits: { GENERAL: 9, CORE: 4, MAJOR: 3 } }));
eq('کسری عمومی (۳ از ۹) → WARN', hasCheck(shortGeneral, 'ROLE_UNITS_COVERAGE', 'WARN'), true);

const allMet = validateCurriculumCore(baseInput({ minRoleUnits: { GENERAL: 3, CORE: 4, MAJOR: 3, THESIS: 6, ELECTIVE: 2 } }));
eq('همه سهم‌ها تأمین → بدون یافته', hasCheck(allMet, 'ROLE_UNITS_COVERAGE'), false);
eq('کسری واحد، مانع تأیید نیست (WARN)', hasBlockingErrors(shortGeneral.filter(r => r.check === 'ROLE_UNITS_COVERAGE')), false);

// ── «جبرانی» (کلید COMPENSATORY) — از مهاجرت ۰۱۲۹ نقشِ رسمیِ چارت است و
//     همچنان هدفِ سهم واحد (minRoleUnits) معتبری است ──
const compShort = validateCurriculumCore(baseInput({ minRoleUnits: { COMPENSATORY: 5 } }));
const compRow = compShort.find(r => r.check === 'ROLE_UNITS_COVERAGE');
eq('جبرانی با کسری → WARN', !!compRow, true);
eq('پیام جبرانی با نام فارسی می‌آید', (compRow?.message ?? '').includes('جبرانی'), true);
eq('پیام، کلید خام COMPENSATORY را لو نمی‌دهد', (compRow?.message ?? '').includes('COMPENSATORY'), false);

const compZero = validateCurriculumCore(baseInput({ minRoleUnits: { COMPENSATORY: 0 } }));
eq('جبرانی صفر (تعیین‌شده ولی لازم نیست) → بدون هشدار', hasCheck(compZero, 'ROLE_UNITS_COVERAGE'), false);

// ── رشتهٔ بدون درس عمومی: چون سهم GENERAL تعریف نشده، هیچ هشدار عمومی نمی‌آید ──
const noGeneral = validateCurriculumCore(baseInput({ minRoleUnits: { MAJOR: 3 } }));
eq('رشتهٔ بدون عمومی: سهم اصلی تأمین است → بدون هشدار', hasCheck(noGeneral, 'ROLE_UNITS_COVERAGE'), false);
eq('رشتهٔ بدون عمومی: هیچ پیام «عمومی» ساخته نمی‌شود',
  noGeneral.some(r => r.check === 'ROLE_UNITS_COVERAGE' && r.message.includes('عمومی')), false);

// ۱۳) درس دارای پیش‌نیاز در ترم ۱ → ERROR (ترم ۰ وجود ندارد)
const prereqTerm1 = validateCurriculumCore(baseInput({
  courses: baseInput().courses.map(c => c.courseId === 2 ? { ...c, recommendedSemester: 1 } : c),
  rules: [{ courseId: 2, ruleType: 'PREREQ', logicTree: { operator: 'AND', conditions: [{ course: 'MA101' }] } }],
}));
eq('درس دارای پیش‌نیاز در ترم ۱ → ERROR', hasCheck(prereqTerm1, 'PREREQ_FIRST_TERM', 'ERROR'), true);
eq('… و مانع تأیید است', hasBlockingErrors(prereqTerm1), true);

// پیش‌نیاز هم‌ترم (هر دو ترم ۳) → WARN ترتیب (نه ترم ۱)
const sameTermPrereq = validateCurriculumCore(baseInput({
  courses: baseInput().courses.map(c => c.courseId === 1 ? { ...c, recommendedSemester: 3 } : c),
  rules: [{ courseId: 2, ruleType: 'PREREQ', logicTree: { operator: 'AND', conditions: [{ course: 'MA101' }] } }],
}));
eq('پیش‌نیاز هم‌ترم (ترم ۳) → WARN', hasCheck(sameTermPrereq, 'PREREQ_SEMESTER_ORDER', 'WARN'), true);
eq('پیش‌نیاز هم‌ترم → PREREQ_FIRST_TERM نمی‌دهد', hasCheck(sameTermPrereq, 'PREREQ_FIRST_TERM'), false);

// پیش‌نیاز در ترم زودتر → هیچ‌کدام
const correctOrder = validateCurriculumCore(baseInput({
  rules: [{ courseId: 2, ruleType: 'PREREQ', logicTree: { operator: 'AND', conditions: [{ course: 'MA101' }] } }], // MA101 ترم ۱ ← CS201 ترم ۳
}));
eq('ترتیب درست (۱ ← ۳) → بدون یافته ترتیبی', hasCheck(correctOrder, 'PREREQ_SEMESTER_ORDER') || hasCheck(correctOrder, 'PREREQ_FIRST_TERM'), false);

console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
process.exit(fail === 0 ? 0 : 1);
